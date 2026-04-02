package expo.modules.karaokeview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsVisualWordsTest {
    @Test
    fun `keeps adjacent syllable fragments attached without inserting spaces`() {
        val words = listOf(
            LyricWord(text = "a", startMs = 0, endMs = 180, trailingSpace = false),
            LyricWord(text = "live", startMs = 180, endMs = 720, trailingSpace = false),
        )

        assertFalse(LyricsVisualWords.shouldInsertSpacing(words[0], words[1]))
        assertEquals(0..1, LyricsVisualWords.findVisualWordRange(words, 1))
    }

    @Test
    fun `preserves explicit word boundaries from source spacing`() {
        val words = listOf(
            LyricWord(text = "hello", startMs = 0, endMs = 300, trailingSpace = true),
            LyricWord(text = "world", startMs = 300, endMs = 700, trailingSpace = false),
        )

        assertTrue(LyricsVisualWords.shouldInsertSpacing(words[0], words[1]))
        assertEquals(1..1, LyricsVisualWords.findVisualWordRange(words, 1))
    }

    @Test
    fun `matches binimum growable heuristic for short latin visual words`() {
        assertTrue(LyricsVisualWords.isGrowableVisualWord("alive", 0, 1800))
        assertFalse(LyricsVisualWords.isGrowableVisualWord("state-of-mind", 0, 1800))
        assertFalse(LyricsVisualWords.isGrowableVisualWord("愛", 0, 1800))
    }
}
