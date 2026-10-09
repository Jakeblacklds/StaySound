package expo.modules.playerchrome

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TabGlyphMotionTest {
    private val beats = listOf(0f to .5f, .2f to .34f, 0f to .45f, .3f to .6f, .18f to .6f, .18f to .35f)

    @Test fun everyBeatRestsAtBothEndsSoTapsNeverJump() {
        beats.forEach { (start, duration) ->
            listOf(0f, 1f).forEach { f ->
                assertEquals(0f, TabBeats.hop(f, start, duration), 1e-6f)
                assertEquals(0f, TabBeats.wobble(f, start, duration), 1e-6f)
            }
        }
    }

    @Test fun hopRisesAndWobbleSwingsBothWays() {
        assertEquals(1f, TabBeats.hop(.25f, 0f, .5f), 1e-6f)
        val swing = (1..99).map { TabBeats.wobble(it / 100f, 0f, 1f) }
        assertTrue(swing.any { it > .3f } && swing.any { it < -.05f })
    }
}
