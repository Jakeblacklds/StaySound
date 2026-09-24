import unittest
from types import SimpleNamespace

from experimental_alignment import matched_intervals, resolve_line, context_window, token, vote_word


def item(text, start, end):
    return SimpleNamespace(text=text, start_time=start, end_time=end)


class WitnessVoteTest(unittest.TestCase):
    def test_two_agreeing_witnesses_beat_the_draft_clock(self):
        # Whisper is 900 ms early; MFA and Qwen agree on the sung onset.
        self.assertEqual(vote_word(14500, (15390, 15800), (15350, 15820), None), ((15350, 15820), "phrase"))
        self.assertEqual(vote_word(14500, (15390, 15800), None, (15300, 15790)), ((15300, 15790), "context"))

    def test_lone_outlier_loses_to_the_witness_near_the_draft(self):
        # MFA jumped to a repeated "veces" a second later; Qwen stayed put.
        self.assertEqual(vote_word(24060, (25130, 25600), (24100, 24500), None), ((24100, 24500), "phrase"))

    def test_no_witness_near_the_draft_keeps_the_baseline(self):
        self.assertEqual(vote_word(10000, None, (13000, 13400), None), (None, "baseline"))
        self.assertEqual(vote_word(10000, None, None, None), (None, "baseline"))


class AlignmentGuardsTest(unittest.TestCase):
    def setUp(self):
        self.words = [{"text": "Don't", "startMs": 1000, "endMs": 1500},
                      {"text": "go!", "startMs": 1600, "endMs": 2100}]

    def align(self, items):
        return matched_intervals(self.words, items, 1.0, 1000, 2500)

    def test_subword_merging_keeps_punctuation_and_clock(self):
        self.assertEqual(self.align([item("Don", 0, .2), item("'t", .2, .5), item("go", .6, 1.1)]),
                         [(1000, 1500), (1600, 2100)])
        self.assertEqual(token("DON’T!"), "don't")

    def test_zero_duration_singing_is_rejected(self):
        with self.assertRaises(ValueError):
            self.align([item("don't", 0, 0), item("go", .6, 1.1)])

    def test_partial_alignment_preserves_good_word_after_collapsed_word(self):
        spans = matched_intervals(self.words, [item("don't", 0, 0), item("go", .6, 1.1)],
                                  1, 1000, 2500, partial=True)
        self.assertEqual(spans, [None, (1600, 2100)])

    def test_partial_alignment_still_requires_exact_text(self):
        with self.assertRaises(ValueError):
            matched_intervals(self.words, [item("different", 0, .5), item("go", .6, 1.1)],
                              1, 1000, 2500, partial=True)

    def test_unvoted_word_yields_to_a_voted_neighbour(self):
        # "Don't" kept a stale time that overlaps the voted "go".
        spans, kinds = resolve_line(self.words, [None, (1400, 2100)], 1000, 2500)
        self.assertEqual(spans, [(1000, 1400), (1400, 2100)])
        self.assertEqual(kinds, ["spread", "voted"])

    def test_unvoted_word_that_fits_is_kept(self):
        spans, kinds = resolve_line(self.words, [None, (1700, 2100)], 1000, 2500)
        self.assertEqual(spans, [(1000, 1500), (1700, 2100)])
        self.assertEqual(kinds, ["kept", "voted"])

    def test_word_between_touching_anchors_borrows_room(self):
        # Shivers: Qwen collapsed "you" between "and" and "got".
        words = [{"text": t, "startMs": s, "endMs": e} for t, s, e in
                 (("and", 39500, 39700), ("you", 39700, 39780), ("got", 39780, 39940))]
        spans, kinds = resolve_line(words, [(39500, 39780), None, (39780, 39940)], 39000, 41000)
        self.assertEqual(kinds, ["voted", "spread", "voted"])
        self.assertTrue(all(e - s >= 40 for s, e in spans))
        self.assertTrue(all(a[1] <= b[0] for a, b in zip(spans, spans[1:])))

    def test_out_of_order_vote_is_dropped_for_the_longest_chain(self):
        words = [{"text": t, "startMs": 1000 * n, "endMs": 1000 * n + 500} for n, t in enumerate("abcd")]
        spans, kinds = resolve_line(words, [(0, 400), (3500, 3900), (2000, 2400), (3000, 3400)], 0, 4000)
        self.assertEqual(kinds, ["voted", "kept", "voted", "voted"])
        self.assertTrue(all(a[1] <= b[0] and a[0] < a[1] for a, b in zip(spans, spans[1:])))

    def test_context_includes_neighbour_text_without_crossing_language(self):
        lines = [{"startMs": n * 4000, "endMs": n * 4000 + 3000,
                  "language": "en" if n < 2 else "es", "words": [{}]} for n in range(3)]
        self.assertEqual(context_window(lines, 1, "en", 12000), (0, 1, 0, 7500))
        lines[0]["language"] = None
        self.assertEqual(context_window(lines, 1, "en", 12000, "en-es")[:2], (1, 1))

    def test_text_mismatch_and_missing_or_extra_tokens_are_rejected(self):
        for items in ([item("do", 0, .5), item("go", .6, 1.1)],
                      [item("don't", 0, .5)],
                      [item("don't", 0, .5), item("go", .6, 1.1), item("now", 1.2, 1.4)]):
            with self.subTest(items=items), self.assertRaises(ValueError):
                self.align(items)

    def test_overlapping_nonfinite_and_out_of_window_intervals_are_rejected(self):
        for end, start in ((.8, .6), (float('nan'), .6), (.5, 4)):
            with self.subTest(end=end, start=start), self.assertRaises(ValueError):
                self.align([item("don't", 0, end), item("go", start, start + .5)])

    def test_repeated_words_keep_order(self):
        words = [{"text": "go", "startMs": 0, "endMs": 400},
                 {"text": "go", "startMs": 600, "endMs": 1000}]
        self.assertEqual(matched_intervals(words, [item("go", 0, .4), item("go", .6, 1)], 0, 0, 1100),
                         [(0, 400), (600, 1000)])


if __name__ == "__main__":
    unittest.main()
