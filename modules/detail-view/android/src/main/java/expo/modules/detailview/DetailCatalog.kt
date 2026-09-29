package expo.modules.detailview

import org.json.JSONArray
import org.json.JSONObject

/** Display-only projection of the existing Zustand catalog. IDs are opaque, never hashed. */
internal data class DetailTrack(
    val id: String, val title: String, val artist: String, val album: String,
    val artistId: String, val canonicalArtistId: String, val artwork: String,
    val thumbnail: String, val duration: Long, val favorite: Boolean,
)
internal data class DetailAlbum(
    val id: String, val title: String, val artist: String, val artwork: String,
    val thumbnail: String, val trackIds: List<String>,
)
internal data class DetailArtist(val id: String, val name: String, val artwork: String, val albumIds: List<String>)
internal data class DetailSelection(val kind: String, val id: String) {
    companion object {
        fun parse(raw: String) = JSONObject(raw).let { DetailSelection(it.string("kind"), it.string("id")) }
    }
}
internal data class DetailAction(
    val action: String, val kind: String, val detailId: String,
    val id: String = "", val trackIds: List<String> = emptyList(),
) {
    fun payload(): Map<String, Any> = mapOf(
        "action" to action, "kind" to kind, "detailId" to detailId, "id" to id, "trackIds" to trackIds,
    )
}
internal data class DetailPage(
    val selection: DetailSelection, val found: Boolean, val title: String = "", val artist: String = "",
    val artwork: String = "", val thumbnail: String = "", val tracks: List<DetailTrack> = emptyList(),
    val albums: List<DetailAlbum> = emptyList(),
) {
    val visibleTracks get() = if (selection.kind == "artist") tracks.take(5) else tracks
    val duration get() = tracks.sumOf { it.duration }
    fun action(name: String, id: String = ""): DetailAction? {
        if (name == "back") return DetailAction(name, selection.kind, selection.id)
        if (!found) return null
        return when (name) {
            "play" -> tracks.firstOrNull { it.id == id }?.let {
                DetailAction(name, selection.kind, selection.id, id, tracks.map { track -> track.id })
            }
            "queue" -> tracks.firstOrNull { it.id == id }?.let { DetailAction(name, selection.kind, selection.id, id) }
            "album" -> albums.firstOrNull { it.id == id }?.let { DetailAction(name, selection.kind, selection.id, id) }
            else -> null
        }
    }
}

internal class DetailCatalog(raw: String) {
    private val json = JSONObject(raw)
    private val tracks = json.objects("songs").map {
        DetailTrack(it.string("id"), it.string("title"), it.string("artist"), it.string("album"),
            it.string("artistId"), it.string("canonicalArtistId"), it.string("artwork"), it.string("thumbnail"),
            it.optLong("duration").coerceAtLeast(0), it.optBoolean("favorite"))
    }.filter { it.id.isNotEmpty() }.distinctBy { it.id }
    private val tracksById = tracks.associateBy { it.id }
    private val albums = json.objects("albums").map {
        DetailAlbum(it.string("id"), it.string("title"), it.string("artist"), it.string("artwork"),
            it.string("thumbnail"), it.ids("trackIds"))
    }.filter { it.id.isNotEmpty() }.distinctBy { it.id }.associateBy { it.id }
    private val artists = json.objects("artists").map {
        DetailArtist(it.string("id"), it.string("name"), it.string("artwork"), it.ids("albumIds"))
    }.filter { it.id.isNotEmpty() }.distinctBy { it.id }.associateBy { it.id }

    fun page(selection: DetailSelection): DetailPage {
        when (selection.kind) {
            "album" -> albums[selection.id]?.let { album ->
                // album.tracks is already the authoritative order (including multi-disc albums).
                return DetailPage(selection, true, album.title, album.artist, album.artwork, album.thumbnail,
                    album.trackIds.distinct().mapNotNull(tracksById::get))
            }
            "artist" -> artists[selection.id]?.let { artist ->
                // Match all three legacy store relationships; retain catalog insertion order.
                return DetailPage(selection, true, artist.name, artwork = artist.artwork,
                    tracks = tracks.filter { it.artistId == artist.id || it.canonicalArtistId == artist.id || it.artist == artist.name },
                    albums = artist.albumIds.distinct().mapNotNull(albums::get))
            }
        }
        return DetailPage(selection, false)
    }
}

private fun JSONObject.string(key: String) = if (isNull(key)) "" else optString(key)
private fun JSONObject.objects(key: String): List<JSONObject> = (optJSONArray(key) ?: JSONArray()).let { array ->
    (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}
private fun JSONObject.ids(key: String): List<String> = (optJSONArray(key) ?: JSONArray()).let { array ->
    (0 until array.length()).mapNotNull { (array.opt(it) as? String)?.takeIf(String::isNotEmpty) }
}

internal fun detailDuration(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}
