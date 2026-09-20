import unittest
from types import SimpleNamespace

from experimental_alignment import matched_intervals, select_intervals, context_window, token


def item(text, start, end):
    return SimpleNamespace(text=text, start_time=start, end_time=end)


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
        self.assertEqual(select_intervals(self.words, spans, 1000, 2500), [None, (1600, 2100)])

    def test_partial_alignment_still_requires_exact_text(self):
        with self.assertRaises(ValueError):
            matched_intervals(self.words, [item("different", 0, .5), item("go", .6, 1.1)],
                              1, 1000, 2500, partial=True)

    def test_proposals_cannot_overlap_unchanged_fallback(self):
        self.assertEqual(select_intervals(self.words, [None, (1400, 2100)], 1000, 2500), [None, None])

    def test_conflicts_are_rechecked_after_restoring_baseline(self):
        words = [{"startMs": 0, "endMs": 500}, {"startMs": 500, "endMs": 1000},
                 {"startMs": 1000, "endMs": 1500}]
        self.assertEqual(select_intervals(words, [(0, 400), (400, 800), (750, 1400)], 0, 1500),
                         [(0, 400), None, None])

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
