import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

import refine_sustains


class RefineSustainsTests(unittest.TestCase):
    def test_next_onset_keeps_nearby_and_overlapping_following_lines(self):
        # A word ending at 1000 ms must not extend through a new line at
        # 1020 ms (previously skipped by the +40 ms lookup tolerance).
        self.assertEqual(refine_sustains.next_onset_after([100, 1020, 2500], 100), 1020)
        self.assertEqual(refine_sustains.next_onset_after([100, 900, 2500], 100), 900)
        self.assertIsNone(refine_sustains.next_onset_after([100], 100))

    def test_extends_a_connected_sung_vowel_but_stops_at_silence(self):
        sample_rate = refine_sustains.TARGET_SR
        time = np.arange(round(sample_rate * 2.2)) / sample_rate
        envelope = np.zeros_like(time)
        envelope[(time >= 0.1) & (time < 1.55)] = 0.28
        audio = np.sin(2 * np.pi * 220 * time) * envelope
        lyrics = {
            "language": "es",
            "model": "fixture",
            "lines": [
                {
                    "text": "va",
                    "startMs": 100,
                    "endMs": 800,
                    "words": [
                        {
                            "text": "va",
                            "startMs": 100,
                            "endMs": 800,
                            "confidence": 1,
                            "syllables": [
                                {
                                    "text": "va",
                                    "startMs": 100,
                                    "endMs": 800,
                                    "phones": ["b", "a"],
                                }
                            ],
                        }
                    ],
                }
            ],
        }

        with tempfile.TemporaryDirectory() as folder:
            audio_path = Path(folder) / "vocals.wav"
            lyrics_path = Path(folder) / "lyrics.json"
            sf.write(audio_path, audio, sample_rate)
            lyrics_path.write_text(json.dumps(lyrics), encoding="utf-8")
            refine_sustains.main(str(audio_path), str(lyrics_path))
            refined = json.loads(lyrics_path.read_text(encoding="utf-8"))

        word = refined["lines"][0]["words"][0]
        syllable = word["syllables"][0]
        self.assertGreaterEqual(word["endMs"], 1_450)
        self.assertLessEqual(word["endMs"], 1_700)
        self.assertTrue(syllable["sustained"])
        self.assertGreater(syllable["timingConfidence"], 0.5)
        self.assertTrue(syllable["notes"])
        self.assertTrue(all(note["endMs"] <= word["endMs"] for note in syllable["notes"]))


if __name__ == "__main__":
    unittest.main()
