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
        assertTrue(LyricsVisualWords.isGrowableVisualWord("愛", 0, 1800))
        assertFalse(LyricsVisualWords.isGrowableVisualWord("beautiful", 0, 1800))
        assertFalse(LyricsVisualWords.isGrowableVisualWord("alive", 0, 999))
        assertFalse(LyricsVisualWords.isGrowableVisualWord("سلام", 0, 1800))
    }

    @Test
    fun `pre highlight covers point three seven five em at source velocity`() {
        // 100px over 1000ms => 0.1px/ms. A 20px font yields a 7.5px lead,
        // therefore the pre-wipe lasts 75ms and begins at t=925ms.
        assertEquals(
            0f,
            LyricsSweepPhysics.preHighlightProgress(100f, 20f, 0, 1000, 925),
            0.0001f,
        )
        assertEquals(
            0.5f,
            LyricsSweepPhysics.preHighlightProgress(100f, 20f, 0, 1000, 962),
            0.01f,
        )
        assertEquals(
            1f,
            LyricsSweepPhysics.preHighlightProgress(100f, 20f, 0, 1000, 1000),
            0.0001f,
        )
    }

    @Test
    fun `resolves every Tauri font with calibrated sweep and lift metrics`() {
        val ids = listOf("newsreader", "classic", "syne", "grotesk", "fraunces", "nunito")

        assertEquals(ids, ids.map { LyricsTypography.from(it).id })
        assertTrue(ids.map { LyricsTypography.from(it).wipeWidthEm }.distinct().size > 1)
        assertTrue(ids.map { LyricsTypography.from(it).foregroundLiftRatio }.distinct().size > 1)
        assertEquals(LyricsTypography.CLASSIC, LyricsTypography.from("unknown"))
    }
}
