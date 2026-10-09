package expo.modules.settingsview

import org.junit.Assert.*
import org.junit.Test

class SettingsPolicyTest {
    @Test fun normalizesValues() {
        assertEquals("es", SettingsPolicy.language("fr"))
        assertEquals("system", SettingsPolicy.themeMode("invalid"))
        assertEquals("#12ABEF", SettingsPolicy.color("12abef"))
        assertNull(SettingsPolicy.color("#xyz"))
        assertEquals(650, SettingsPolicy.spectrumDelay("900"))
        assertEquals(0, SettingsPolicy.spectrumDelay("-1"))
    }
    @Test fun qualityAndMirrorSelection() {
        assertEquals("MP3", SettingsPolicy.quality("ULTRA"))
        assertEquals("HI_RES_LOSSLESS", SettingsPolicy.quality("HI_RES_LOSSLESS"))
        assertEquals("auto", SettingsPolicy.mirror("https://unknown", listOf("https://known")))
        assertEquals("https://known", SettingsPolicy.mirror("https://known", listOf("https://known")))
    }
    @Test fun updateStates() {
        assertEquals("release-only", SettingsPolicy.updateState(false, true, "2", "idle", null))
        assertEquals("ota-ready", SettingsPolicy.updateState(true, true, "2", "idle", null))
        assertEquals("binary-ready", SettingsPolicy.updateState(true, false, "2", "idle", null))
        assertEquals("awaiting-install-permission", SettingsPolicy.updateState(true, false, null, "awaiting-install-permission", null))
        assertEquals("error", SettingsPolicy.updateState(true, false, null, "idle", "network"))
        assertEquals("idle", SettingsPolicy.updateState(true, false, null, "idle", null))
    }
}
