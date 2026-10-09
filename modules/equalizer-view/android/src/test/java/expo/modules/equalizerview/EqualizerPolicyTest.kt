package expo.modules.equalizerview

import org.junit.Assert.*
import org.junit.Test

class EqualizerPolicyTest {
    @Test fun clampsBandLevels() {
        assertEquals(-1500f, EqualizerPolicy.level(-2000f, -1500f, 1500f), 0f)
        assertEquals(1500f, EqualizerPolicy.level(2000f, -1500f, 1500f), 0f)
        assertEquals(0f, EqualizerPolicy.level(Float.NaN, -1500f, 1500f), 0f)
        assertEquals(250f, EqualizerPolicy.level(250f, -1500f, 1500f), 0f)
    }
    @Test fun validatesModeAndPreset() {
        assertEquals("off", EqualizerPolicy.mode("unknown"))
        assertEquals("app", EqualizerPolicy.mode("app"))
        assertEquals(2, EqualizerPolicy.nativePresetIndex("native:2", setOf(1, 2)))
        assertNull(EqualizerPolicy.nativePresetIndex("native:3", setOf(1, 2)))
    }
}
