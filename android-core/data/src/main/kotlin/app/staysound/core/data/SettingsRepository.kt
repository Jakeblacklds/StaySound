package app.staysound.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

/** One DataStore owns settings, player preferences and onboarding; large opaque documents stay in Room. */
class SettingsRepository internal constructor(
    private val store: DataStore<Preferences>, private val ownership: StorageOwnership,
) {
    internal suspend fun replace(documents: Map<String, String>) {
        store.edit { prefs -> prefs.clear(); documents.forEach { (key, value) -> prefs[stringPreferencesKey(key)] = value } }
    }
    internal suspend fun documents(): Map<String, String> = store.data.first().asMap().map { (key, value) -> key.name to (value as String) }.toMap()
    val settings: Flow<Settings> = store.data.map { prefs ->
        ownership.native { Settings.from(LegacyCodec.envelope(prefs[stringPreferencesKey(LegacyCodec.SETTINGS)]).getJSONObject("state")) }
    }
    suspend fun read(): Settings = ownership.native {
        Settings.from(LegacyCodec.envelope(documents()[LegacyCodec.SETTINGS]).getJSONObject("state"))
    }
    suspend fun setLanguage(language: String) { require(language in setOf("es", "en")); update { put("language", language) } }
    suspend fun setMirror(mirror: String) { require(mirror.isNotBlank()); update { put("tidalMirror", mirror) } }
    suspend fun setDownloadQuality(quality: String) {
        require(quality in setOf("HI_RES_LOSSLESS", "LOSSLESS", "MP3", "HIGH", "LOW"))
        update { put("tidalDownloadQuality", quality) }
    }
    suspend fun setSpectrumDelay(delayMs: Int) = update { put("spectrumDelayMs", delayMs.coerceIn(0, 650)) }
    suspend fun setAppearance(style: String, mode: String, accent: String, dynamic: Boolean, lightweight: Boolean, variant: String) {
        require(style == "material3" && mode in setOf("light", "dark", "system"))
        update { put("style", style); put("mode", mode); put("accentColor", accent); put("dynamicColors", dynamic)
            put("lightweightMode", lightweight); put("schemeVariant", variant) }
    }
    suspend fun setSpectrumTheme(theme: String) {
        require(theme in setOf("columns", "aurora", "caustics", "waveformArc", "refractionVeil"))
        update { put("spectrumTheme", theme) }
    }
    suspend fun setLyricsFont(font: String) = update { put("lyricsFont", font.takeIf { it in LYRICS_FONTS } ?: "classic") }
    suspend fun setLyricsSourceEnabled(source: String, enabled: Boolean) {
        require(source in DEFAULT_LYRICS_SOURCES)
        update {
            val current = Settings.from(this).lyricsSources.toMutableSet()
            if (enabled) current.add(source) else if (current.size > 1) current.remove(source)
            put("lyricsSources", org.json.JSONArray(DEFAULT_LYRICS_SOURCES.filter { it in current }))
        }
    }
    suspend fun setEqualizer(settings: EqualizerSettings) {
        require(settings.mode in setOf("off", "app", "system"))
        require(settings.bandLevels.values.all { it.isFinite() })
        update {
            val equalizer = optJSONObject("equalizer") ?: JSONObject()
            equalizer.put("mode", settings.mode).put("enabled", settings.enabled)
                .put("presetId", settings.presetId ?: JSONObject.NULL).put("bandLevels", JSONObject(settings.bandLevels))
            put("equalizer", equalizer)
        }
    }
    private suspend fun update(mutate: JSONObject.() -> Unit) = ownership.native {
        store.edit { prefs ->
            val key = stringPreferencesKey(LegacyCodec.SETTINGS)
            val envelope = LegacyCodec.envelope(prefs[key])
            envelope.getJSONObject("state").mutate()
            prefs[key] = envelope.toString()
        }
    }
}

internal val LYRICS_FONTS = setOf("newsreader", "classic", "syne", "grotesk", "fraunces", "nunito")
internal val DEFAULT_LYRICS_SOURCES = listOf("apple", "lyricsplus", "musixmatch", "spotify", "lrclib")

data class Settings(
    val language: String, val downloadQuality: String, val mirror: String,
    val themeStyle: String, val themeMode: String, val accentColor: String,
    val dynamicColors: Boolean, val lightweightMode: Boolean, val schemeVariant: String,
    val spectrumDelayMs: Int, val spectrumTheme: String, val lyricsFont: String,
    val lyricsSources: List<String>, val equalizer: EqualizerSettings,
) {
    companion object {
        internal fun from(o: JSONObject): Settings = Settings(
            o.optString("language", "es"), o.optString("tidalDownloadQuality", "MP3"), o.optString("tidalMirror", "auto"),
            o.optString("style", "material3"), o.optString("mode", "system"), o.optString("accentColor", "#6750A4"),
            o.optBoolean("dynamicColors", true), o.optBoolean("lightweightMode", false), o.optString("schemeVariant", "expressive"),
            o.optInt("spectrumDelayMs", 380), o.optString("spectrumTheme", "aurora"), o.optString("lyricsFont", "classic").takeIf { it in LYRICS_FONTS } ?: "classic",
            o.optJSONArray("lyricsSources")?.let(LegacyCodec::strings)?.let { requested ->
                DEFAULT_LYRICS_SOURCES.filter { it in requested }.ifEmpty { DEFAULT_LYRICS_SOURCES }
            } ?: DEFAULT_LYRICS_SOURCES,
            EqualizerSettings.from(o.optJSONObject("equalizer") ?: JSONObject()),
        )
    }
}
data class EqualizerSettings(val mode: String, val enabled: Boolean, val presetId: String?, val bandLevels: Map<String, Double>) {
    companion object {
        internal fun from(o: JSONObject) = EqualizerSettings(o.optString("mode", "off"), o.optBoolean("enabled", false),
            if (o.has("presetId") && o.isNull("presetId")) null else o.optString("presetId", "flat"),
            (o.optJSONObject("bandLevels") ?: JSONObject()).let { bands -> bands.keys().asSequence().associateWith { bands.getDouble(it) } })
    }
}
