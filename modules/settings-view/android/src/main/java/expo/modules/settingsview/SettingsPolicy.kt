package expo.modules.settingsview

/** Validation at the native UI boundary. The persisted store remains in TypeScript. */
internal object SettingsPolicy {
    val qualities = listOf("LOW", "HIGH", "MP3", "LOSSLESS", "HI_RES_LOSSLESS")
    fun language(value: String?) = if (value == "en") "en" else "es"
    fun themeMode(value: String?) = if (value in listOf("system", "light", "dark")) value!! else "system"
    fun quality(value: String?) = if (value in qualities) value!! else "MP3"
    fun color(value: String?): String? {
        val hex = value?.trim()?.uppercase()?.let { if (it.startsWith('#')) it else "#$it" }
        return hex?.takeIf { it.matches(Regex("#[0-9A-F]{6}")) }
    }
    fun spectrumDelay(value: String?) = (value?.toIntOrNull() ?: 380).coerceIn(0, 650)
    fun mirror(value: String?, available: List<String>): String =
        if (value == "auto" || (value != null && value in available)) value!! else "auto"
    fun updateState(enabled: Boolean, otaReady: Boolean, binaryVersion: String?, status: String, error: String?): String = when {
        !enabled -> "release-only"
        otaReady -> "ota-ready"
        !binaryVersion.isNullOrBlank() -> "binary-ready"
        status in listOf("checking", "downloading", "installing", "awaiting-install-permission") -> status
        !error.isNullOrBlank() -> "error"
        else -> "idle"
    }
}
