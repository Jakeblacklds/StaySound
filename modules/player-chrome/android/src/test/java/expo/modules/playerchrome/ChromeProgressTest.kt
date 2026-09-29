package expo.modules.playerchrome

import org.junit.Assert.assertEquals
import org.junit.Test

class ChromeProgressTest {
    @Test fun `mini controls remain visible until artwork starts expanding`() {
        assertEquals(1f, ChromeProgress.contentAlpha(0f), 0f)
        assertEquals(1f, ChromeProgress.contentAlpha(0.22f), 0f)
        assertEquals(1f, ChromeProgress.controlsAlpha(0.18f), 0f)
    }
    @Test fun `metadata and play pill disappear before the mini container`() {
        assertEquals(0.5f, ChromeProgress.controlsAlpha(0.26f), 0.0001f)
        assertEquals(0f, ChromeProgress.controlsAlpha(0.34f), 0f)
        assertEquals(0.25f, ChromeProgress.contentAlpha(0.34f), 0.0001f)
        assertEquals(0f, ChromeProgress.contentAlpha(0.38f), 0f)
    }
    @Test fun `gesture overshoot never produces an invalid alpha`() {
        for (p in listOf(-1f, -0.01f, 0f, 0.18f, 0.26f, 0.34f, 0.38f, 1f, 1.2f)) {
            val content = ChromeProgress.contentAlpha(p)
            val controls = ChromeProgress.controlsAlpha(p)
            assert(content in 0f..1f && controls in 0f..1f)
        }
        assertEquals(1f, ChromeProgress.contentAlpha(-1f), 0f)
        assertEquals(0f, ChromeProgress.contentAlpha(1.2f), 0f)
    }
}
