package expo.modules.playlistview

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else
    (0 until length()).mapNotNull { optJSONObject(it) }

internal data class Song(val id: String, val title: String, val artist: String, val album: String,
    val artwork: String, val duration: Long, val dateAdded: Long, val remote: Boolean,
    val playable: Boolean, val tidalId: String, val spotifyId: String) {
    companion object {
        fun parse(j: JSONObject) = Song(j.getString("id"), j.optString("title"), j.optString("artist"),
            j.optString("album"), j.optString("artwork"), j.optLong("duration").coerceAtLeast(0),
            j.optLong("dateAdded"), j.optBoolean("remote"), j.optBoolean("playable", true),
            j.optString("tidalId"), j.optString("spotifyId"))
    }
}
// memberId is the persisted relationship ID, song.id can be a downloaded local replacement.
internal data class Entry(val memberId: String, val song: Song)
internal data class LocalPlaylist(val id: String, val name: String, val description: String,
    val artwork: String, val updatedAt: Long, val readonly: Boolean, val entries: List<Entry>) {
    val playable get() = entries.filter { it.song.playable }
    val duration get() = entries.sumOf { it.song.duration }
}
internal data class Selection(val screen: String, val id: String = "") {
    companion object { fun parse(raw: String): Selection { val j = JSONObject(raw); return Selection(j.optString("screen"), j.optString("id")) } }
}
internal data class PlaylistAction(val action: String, val selection: Selection, val id: String = "",
    val memberId: String = "", val targetId: String = "", val name: String = "",
    val description: String = "", val artwork: String = "", val requestId: String = "",
    val trackIds: List<String> = emptyList()) {
    fun payload(): Map<String, Any> = mapOf("action" to action, "screen" to selection.screen,
        "playlistId" to selection.id, "id" to id, "memberId" to memberId, "targetId" to targetId,
        "name" to name, "description" to description, "artwork" to artwork, "requestId" to requestId, "trackIds" to trackIds)
}
internal class PlaylistCatalog(raw: String) {
    private val root = JSONObject(raw)
    val playlists = root.optJSONArray("playlists").objects().map { j ->
        LocalPlaylist(j.getString("id"), j.optString("name"), j.optString("description"), j.optString("artwork"),
            j.optLong("updatedAt"), j.optBoolean("readonly"), j.optJSONArray("entries").objects().map {
                Entry(it.getString("memberId"), Song.parse(it.getJSONObject("song")))
            }.distinctBy { it.memberId })
    }.distinctBy { it.id }.sortedByDescending { it.updatedAt }
    val library = root.optJSONArray("library").objects().map(Song::parse).filter { !it.remote }
        .distinctBy { it.id }.sortedByDescending { it.dateAdded }
    fun find(id: String) = playlists.find { it.id == id }
    fun library(query: String): List<Song> {
        val needle = query.trim().lowercase(Locale.ROOT)
        return library.filter { needle.isEmpty() || "${it.title} ${it.artist} ${it.album}".lowercase(Locale.ROOT).contains(needle) }
    }
    fun emptyState(selection: Selection) = when {
        selection.screen == "list" && playlists.isEmpty() -> "emptyPlaylists"
        selection.screen == "detail" && find(selection.id) == null -> "notFound"
        selection.screen == "detail" && find(selection.id)?.entries?.isEmpty() == true -> "emptyTracks"
        else -> ""
    }
    fun action(selection: Selection, action: String, id: String = "", memberId: String = "",
        targetId: String = "", name: String = "", description: String = "", artwork: String = "",
        requestId: String = "", query: String = ""): PlaylistAction? {
        fun result(ids: List<String> = emptyList()) = PlaylistAction(action, selection, id, memberId, targetId,
            name.trim(), description, artwork, requestId, ids)
        if (action == "back") return result()
        if (selection.screen == "create") return when (action) {
            "create" -> if (name.isNotBlank()) result() else null
            "import" -> if (Regex("(spotify\\.com/playlist/|spotify:playlist:)", RegexOption.IGNORE_CASE).containsMatchIn(name)) result() else null
            "clipboard" -> result()
            else -> null
        }
        if (selection.screen == "list") return when (action) {
            "open" -> if (find(id) != null) result() else null
            "openCreate" -> result()
            else -> null
        }
        if (selection.screen != "detail") return null
        val playlist = find(selection.id) ?: return null
        val entry = playlist.entries.find { it.memberId == memberId && it.song.id == id }
        return when (action) {
            "edit" -> if (!playlist.readonly && name.isNotBlank()) result() else null
            "deletePlaylist", "pickCover", "cancelCover" -> if (!playlist.readonly) result() else null
            "play", "shuffle" -> if (entry?.song?.playable == true) result(playlist.playable.map { it.memberId }) else null
            "remove" -> if (!playlist.readonly && entry != null) result() else null
            "queue", "download" -> if (entry?.song?.playable == true && (action != "download" || entry.song.remote)) result() else null
            "deleteTrack", "deleteFile" -> if (entry != null && !entry.song.remote && library.any { it.id == id }) result() else null
            "addToPlaylist" -> if (entry != null && find(targetId)?.readonly == false) result() else null
            "newWithTrack" -> if (entry != null) result() else null
            "toggle" -> if (!playlist.readonly && library.any { it.id == id }) result() else null
            "libraryPlay" -> if (library(query).any { it.id == id }) result(library(query).map { it.id }) else null
            else -> null
        }
    }
}
