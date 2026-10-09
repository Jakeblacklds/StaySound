package expo.modules.tidaldetailview

import org.json.JSONArray
import org.json.JSONObject

internal enum class DetailKind { artist, album, playlist, genre }
internal data class DetailLink(val kind: DetailKind, val id: String, val title: String, val subtitle: String, val artwork: String)
internal data class DetailTrack(val id: String, val title: String, val artist: String, val artwork: String,
    val durationMs: Long, val status: String, val progress: Double, val active: Boolean, val playing: Boolean)
internal data class DetailSection(val title: String, val kicker: String, val size: Int, val circle: Boolean, val items: List<DetailLink>)
internal data class TidalDetailModel(
    val screenKey: String = "", val kind: DetailKind = DetailKind.album, val id: String = "",
    val title: String = "", val kicker: String = "", val artwork: String = "", val subtitle: String = "",
    val description: String = "", val meta: String = "", val quality: String = "", val explicit: Boolean = false,
    val artistLink: DetailLink? = null, val loading: Boolean = true, val error: String = "",
    val preparing: String = "", val downloadingAll: Boolean = false,
    val tracks: List<DetailTrack> = emptyList(), val sections: List<DetailSection> = emptyList(), val grid: List<DetailLink> = emptyList(),
) {
    val ready get() = !loading && error.isEmpty()
    fun links() = sections.flatMap { it.items } + grid + listOfNotNull(artistLink)
    companion object {
        fun parse(raw: String): TidalDetailModel = try {
            val o = JSONObject(raw)
            require(o.optInt("version") == 1) { "Versión de detalle no compatible" }
            val kind = DetailKind.valueOf(o.string("kind"))
            require(o.string("screenKey").isNotBlank() && o.string("id").isNotBlank())
            TidalDetailModel(o.string("screenKey"), kind, o.string("id"), o.string("title"), o.string("kicker"),
                o.string("artwork"), o.string("subtitle"), o.string("description"), o.string("meta"), o.string("quality"),
                o.optBoolean("explicit"), o.optJSONObject("artistLink")?.link(), o.optBoolean("loading"), o.string("error"),
                o.string("preparing"), o.optBoolean("downloadingAll"),
                o.optJSONArray("tracks").objects().mapNotNull { t ->
                    val id = t.string("id")
                    if (id.toLongOrNull()?.let { it > 0 } != true) null else DetailTrack(id,
                        t.string("title").ifBlank { "Unknown Title" }, t.string("artist").ifBlank { "Unknown Artist" },
                        t.string("artwork"), t.optLong("durationMs").coerceAtLeast(0),
                        t.string("status").takeIf { it in setOf("idle", "downloading", "done", "error") } ?: "idle",
                        t.optDouble("progress", 0.0).let { if (it.isFinite()) it.coerceIn(0.0, 1.0) else 0.0 },
                        t.optBoolean("active"), t.optBoolean("playing"))
                }, // Playlist order and repeated tracks are intentional; row keys include position.
                o.optJSONArray("sections").objects().map { s -> DetailSection(s.string("title"), s.string("kicker"),
                    s.optInt("size", 150).coerceIn(80, 220), s.optBoolean("circle"), s.optJSONArray("items").objects().mapNotNull { it.link() }) },
                o.optJSONArray("grid").objects().mapNotNull { it.link() }.distinctBy { "${it.kind}:${it.id}" }.take(96))
        } catch (_: Exception) { TidalDetailModel(loading = false, error = "No se pudo cargar el detalle") }
    }
}
private fun JSONObject.string(key: String) = if (isNull(key)) "" else optString(key, "")
private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.link(): DetailLink? {
    val kind = runCatching { DetailKind.valueOf(string("kind")) }.getOrNull() ?: return null
    val id = string("id").trim()
    if (id.isEmpty() || id == "undefined" || id == "null") return null
    return DetailLink(kind, id, string("title"), string("subtitle"), string("artwork"))
}

/** Only presentation state lives here. Download/player state is replaced by TS snapshots. */
internal class DetailListState {
    private var screenKey = ""
    var expanded = false; private set
    var visibleCount = 16; private set
    fun accept(model: TidalDetailModel) {
        if (screenKey != model.screenKey) { screenKey = model.screenKey; expanded = false; visibleCount = 16 }
    }
    fun toggleTracks() { expanded = !expanded }
    fun loadMore(total: Int) { visibleCount = (visibleCount + 16).coerceAtMost(total.coerceAtMost(96)).coerceAtLeast(16) }
    fun tracks(model: TidalDetailModel) = if (model.kind == DetailKind.artist && !expanded) model.tracks.take(8) else model.tracks
    fun grid(model: TidalDetailModel) = model.grid.take(visibleCount)
    fun phase(model: TidalDetailModel) = when {
        model.loading -> "loading"
        model.error.isNotEmpty() -> "error"
        model.tracks.isEmpty() && model.grid.isEmpty() && model.sections.all { it.items.isEmpty() } -> "empty"
        else -> "content"
    }
}

internal data class DetailAction(val screenKey: String, val action: String, val id: String = "", val kind: String = "") {
    fun payload() = mapOf("screenKey" to screenKey, "action" to action, "id" to id, "kind" to kind)
}
internal object DetailActions {
    fun create(model: TidalDetailModel, action: String, id: String = "", kind: String = ""): DetailAction? {
        if (action == "back") return DetailAction(model.screenKey, action)
        if (!model.ready) return null
        val allowed = when (action) {
            "navigate" -> model.links().any { it.id == id && it.kind.name == kind }
            "playAll", "shuffle" -> model.tracks.isNotEmpty() && model.preparing.isEmpty()
            "downloadAll" -> model.tracks.isNotEmpty() && !model.downloadingAll
            "play", "queue" -> model.tracks.any { it.id == id }
            "download" -> model.tracks.any { it.id == id && it.status in listOf("idle", "error") }
            "cancelDownload" -> model.tracks.any { it.id == id && it.status == "downloading" }
            else -> false
        }
        return if (allowed) DetailAction(model.screenKey, action, id, kind) else null
    }
}
