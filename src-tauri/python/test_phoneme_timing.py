import unittest

from phoneme_timing import fill_gaps, is_vowel, make_syllables, trusted_word_interval, widen_short_words


class PhonemeTimingTests(unittest.TestCase):
    def test_actual_mfa_ipa_inventory_and_legacy_arpabet(self):
        for label in ["ɛ", "ə", "ɪ", "ɑ", "ɚ", "ʉː", "aw", "ow", "aj", "iː", "ɫ̩", "n̩", "AH0", "IY1"]:
            with self.subTest(label=label):
                self.assertTrue(is_vowel(label, "en"))
        for label in ["ã", "e", "i", "o", "u", "ˈa"]:
            self.assertTrue(is_vowel(label, "es"))
        for label in ["pʰ", "vʲ", "ɹ", "l", "j", "sil", "spn", "", "UNKNOWN"]:
            self.assertFalse(is_vowel(label, "en"))

    def test_unequal_sung_syllables_follow_vowels_not_letter_lengths(self):
        phones = [(0, .1, "d"), (.1, .7, "ɛ"), (.7, .8, "v"), (.8, .95, "ə"), (.95, 1, "ɫ")]
        result = make_syllables("devil,", 0, 1, phones, "en")
        self.assertEqual([s["text"] for s in result], ["dev", "il,"])
        self.assertEqual(result[0]["endMs"], 750)
        self.assertEqual(result[1]["startMs"], 750)
        self.assertTrue(all(any(is_vowel(p, "en") for p in s["phones"]) for s in result))

    def test_powerless_reduced_pronunciation_never_invents_empty_er(self):
        phones = [(0, .1, "pʰ"), (.1, .6, "aw"), (.6, .7, "ɹ"), (.7, .8, "l"), (.8, 1.2, "ə"), (1.2, 1.4, "s")]
        result = make_syllables("Powerless,", 0, 1.4, phones, "en")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "Powerless,")
        self.assertEqual(result[0]["endMs"], 1400)

    def test_typographic_skeletons_split_does_not_override_three_nuclei(self):
        phones = [(0, .3, "ɛ"), (.3, .6, "ə"), (.6, 1, "ə")]
        result = make_syllables("skeletons", 0, 1, phones, "en")
        self.assertEqual([s["text"] for s in result], ["skeletons"])

    def test_unknown_or_collapsed_phones_keep_text_and_word_interval(self):
        for phones in [[], [(0, .005, "ɛ"), (.005, .009, "ə")]]:
            result = make_syllables("(devil)", 0, 1, phones, "en")
            self.assertEqual([s["text"] for s in result], ["(devil)"])
            self.assertEqual((result[0]["startMs"], result[0]["endMs"]), (0, 1000))

    def test_literal_hyphens_are_preserved(self):
        result = make_syllables("care-less", 0, 1, [(0, .5, "ɛ"), (.5, 1, "ə")], "en")
        self.assertEqual("".join(s["text"] for s in result), "care-less")

    def test_small_supported_correction_is_accepted(self):
        self.assertEqual(trusted_word_interval(1000, 1600, 1100, 1650, 900, 1800, [(1.1, 1.65, "ɛ")], "en"), (1100, 1650))

    def test_whisper_phrase_onset_error_is_corrected(self):
        # Eres Tú: Whisper starts "Tengo" 850 ms before the singer does.
        self.assertEqual(trusted_word_interval(14500, 15200, 15350, 15800, 14320, 17800,
                                               [(15.35, 15.45, "t"), (15.45, 15.8, "e")], "es"),
                         (15350, 15800))
        # A different duration from Whisper's guess is not evidence against MFA.
        self.assertEqual(trusted_word_interval(1000, 1200, 1000, 1900, 800, 2500,
                                               [(1.0, 1.9, "ɛ")], "en"), (1000, 1900))

    def test_failed_mfa_words_are_rejected(self):
        for start, end, low, high, phones in [
            (61700, 63000, 60000, 68000, [(61.7, 63.0, "aw")]),  # Powerless: 4 s jump
            (65840, 65870, 65000, 68000, [(65.84, 65.87, "aw")]),  # collapsed word
            (65840, 65930, 65000, 68000, [(65.84, 65.87, "pʰ"), (65.87, 65.9, "aw"), (65.9, 65.93, "ɹ")]),
            (65840, 67080, 66100, 68000, [(65.84, 67.08, "aw")]),  # starts outside the clip
            (65840, 67080, 65000, 68000, [(65.84, 67.08, "s")]),  # no vocal nucleus
        ]:
            with self.subTest(start=start, end=end):
                self.assertIsNone(trusted_word_interval(65840, 67080, start, end, low, high, phones, "en"))

    def test_unmeasured_word_is_never_a_flash_between_measured_ones(self):
        words = [{"text": t, "startMs": s, "endMs": e} for t, s, e in
                 (("so", 1000, 1300), ("tell", 1300, 1600), ("me", 1600, 1900))]
        intervals = [[1000, 1450], None, [1450, 1900]]
        self.assertEqual(fill_gaps(intervals, words), {1: "spread"})
        self.assertTrue(all(e - s >= 40 for s, e in intervals))
        self.assertTrue(all(a[1] <= b[0] for a, b in zip(intervals, intervals[1:])))

    def test_unmeasured_run_keeps_its_rhythm_when_squeezed(self):
        words = [{"text": t, "startMs": s, "endMs": e} for t, s, e in
                 (("a", 0, 100), ("bb", 100, 300), ("c", 300, 400), ("d", 400, 500))]
        intervals = [None, None, None, [350, 500]]
        fill_gaps(intervals, words)
        self.assertEqual(intervals[:3], [[0, 88], [88, 262], [262, 350]])

    def test_short_words_take_silence_first_then_a_roomy_neighbour(self):
        intervals = [[0, 500], [500, 520], [600, 900]]
        widen_short_words(intervals)
        self.assertEqual(intervals, [[0, 500], [500, 540], [600, 900]])
        intervals = [[0, 500], [500, 510], [510, 900]]
        widen_short_words(intervals)
        self.assertEqual(intervals, [[0, 500], [500, 540], [540, 900]])


if __name__ == "__main__":
    unittest.main()
