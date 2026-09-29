package expo.modules.searchview

import org.json.JSONArray
import org.json.JSONObject

// Editing invalidates the previous request immediately, before the debounce fires.
// Matching query text alone is insufficient for A -> B -> A and retry races.
internal class SearchSession {
    var query: String = ""
        private set
    var revision: Int = 0
        private set
    var dispatchedRevision: Int = -1
        private set

    fun edit(value: String) { query = value.trim(); revision++ }
    fun retry() { revision++ }
    fun dispatch(): Boolean {
        if (revision == dispatchedRevision) return false
        dispatchedRevision = revision
        return true
    }
    fun accepts(id: Int, text: String): Boolean = query.isNotEmpty() && id == revision && text == query
}

internal data class SearchTrack(val id: String, val title: String, val artist: String,
    val artwork: String, val durationMs: Long, val artistId: String = "") {
    val subtitle: String get() {
        val seconds = durationMs.coerceAtLeast(0) / 1000
        return if (seconds == 0L) artist else "$artist · ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}

internal fun parseTracks(array: JSONArray?): List<SearchTrack> = buildList {
    val seen = HashSet<String>()
    if (array != null) for (i in 0 until array.length()) {
        val track = parseTrack(array.optJSONObject(i)) ?: continue
        if (seen.add(track.id)) add(track)
    }
}

internal fun parseTrack(item: JSONObject?): SearchTrack? {
    val id = item?.optString("id").orEmpty()
    if (item == null || id.isBlank()) return null
    return SearchTrack(id, item.optString("title"), item.optString("artist"),
        item.optString("artwork"), item.optLong("durationMs").coerceAtLeast(0), item.optString("artistId"))
}

/**
 * An artist, album, recent search or the top result. `kind` is "artist",
 * "album", "track" or "query"; artists are the only round artwork.
 */
internal data class SearchEntity(val kind: String, val id: String, val title: String,
    val subtitle: String = "", val artwork: String = "", val label: String = "",
    val key: String = "$kind:$id", val query: String = title, val track: SearchTrack? = null) {
    val round: Boolean get() = kind == "artist" || kind == "query"
}

internal fun parseEntity(item: JSONObject?): SearchEntity? {
    val kind = item?.optString("kind").orEmpty()
    val id = item?.optString("id").orEmpty()
    if (item == null || kind.isBlank() || id.isBlank()) return null
    val title = item.optString("title")
    return SearchEntity(kind, id, title, item.optString("subtitle"), item.optString("artwork"),
        item.optString("label"), item.optString("key").ifBlank { "$kind:$id" },
        item.optString("query").ifBlank { title }, parseTrack(item.optJSONObject("track")))
}

internal fun parseEntities(array: JSONArray?, kind: String): List<SearchEntity> = buildList {
    val seen = HashSet<String>()
    if (array != null) for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        if (!item.has("kind")) item.put("kind", kind)
        val entity = parseEntity(item) ?: continue
        if (seen.add(entity.id)) add(entity)
    }
}

/** Recents arrive as JSON strings; a bare string is a legacy text search. */
internal fun parseRecent(value: String): SearchEntity? {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.startsWith("{")) return runCatching { parseEntity(JSONObject(trimmed)) }.getOrNull()
    return SearchEntity("query", trimmed, trimmed, "Búsqueda", key = "query:${trimmed.lowercase()}")
}

internal data class Transfer(val status: String = "idle", val progress: Int = 0)
internal fun parseTransfers(array: JSONArray?): Map<String, Transfer> = buildMap {
    if (array != null) for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        put(item.optString("id"), Transfer(item.optString("status", "idle"),
            (item.optDouble("progress", 0.0).takeIf { it.isFinite() }?.times(100)?.toInt() ?: 0).coerceIn(0, 100)))
    }
}

internal data class SearchRow(val key: String, val kind: Int, val title: String = "",
    val description: String = "", val track: SearchTrack? = null, val action: String = "",
    val entity: SearchEntity? = null, val entities: List<SearchEntity> = emptyList()) {
    companion object {
        const val TRACK = 0; const val HEADING = 1; const val RECENT = 2; const val MESSAGE = 3; const val SKELETON = 4
        const val TOP = 5; const val RAIL = 6; const val ENTITY = 7; const val CHIPS = 8
    }
}

/** Spotify's result filters. "all" mixes the top result, songs and rails. */
internal val SEARCH_FILTERS = listOf("all" to "Todo", "songs" to "Canciones", "artists" to "Artistas", "albums" to "Álbumes")
