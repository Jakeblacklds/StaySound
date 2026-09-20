import unittest

from phoneme_timing import is_vowel, make_syllables, trusted_word_interval


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
        self.assertEqual(trusted_word_interval(1000, 1600, 1100, 1650, 900, 1800, .9, [(1.1, 1.65, "ɛ")], "en"), (1100, 1650))

    def test_large_mfa_disagreement_interpolation_or_collision_is_rejected(self):
        for start, end, low, high, confidence in [
            (61700, 63000, 60000, 68000, .9),  # Powerless: 4 s disagreement
            (65840, 67080, 65000, 68000, 0),  # provider-only timing
            (65840, 67080, 66100, 68000, .9),  # preceding word occupies onset
            (65840, 67080, 65000, 66800, .9),  # following word occupies ending
            (65840, 70000, 65000, 71000, .9),  # implausible duration
        ]:
            with self.subTest(start=start, end=end, confidence=confidence):
                self.assertIsNone(trusted_word_interval(65840, 67080, start, end, low, high, confidence, [(65.84, 67.08, "aw")], "en"))


if __name__ == "__main__":
    unittest.main()
