package expo.modules.homeview

import org.json.JSONArray
import org.json.JSONObject

internal data class HomeItem(
    val id: String,
    val title: String,
    val artist: String = "",
    val artwork: String = "",
    val thumbnail: String = "",
    val codec: String = "",
    val sampleRate: Int = 0,
    val bitDepth: Int = 0,
    val dateAdded: Long = 0,
    val downloadedAt: Long? = null,
    val trackIds: List<String> = emptyList(),
) {
    /**
     * Home cards can be considerably larger than the 128 px thumbnail generated for
     * compact lists. Prefer the full artwork and let Glide downsample it to the exact
     * rendered size; the thumbnail remains a cheap fallback for missing/broken art.
     */
    val displayArtwork: String get() = artwork.ifEmpty { thumbnail }
    val fallbackThumbnail: String get() = thumbnail.takeUnless { it == displayArtwork }.orEmpty()

    companion object {
        fun parse(item: JSONObject) = HomeItem(
            id = item.getString("id"), title = item.optString("title"), artist = item.optString("artist"),
            artwork = item.optString("artwork"), thumbnail = item.optString("thumbnail"),
            codec = item.optString("codec"), sampleRate = item.optInt("sampleRate"), bitDepth = item.optInt("bitDepth"),
            dateAdded = item.optLong("dateAdded"),
            downloadedAt = if (item.opt("downloadedAt") is Number) item.optLong("downloadedAt") else null,
            trackIds = item.optJSONArray("trackIds")?.let { ids -> (0 until ids.length()).map { ids.getString(it) } }.orEmpty(),
        )
        fun parseList(array: JSONArray): List<HomeItem> = (0 until array.length())
            .map { parse(array.getJSONObject(it)) }.filter { it.id.isNotBlank() }.distinctBy { it.id }
    }
}

internal data class HomePlaylist(val id: String, val name: String, val updatedAt: Long)
internal data class HomeRow(val key: String, val items: List<HomeItem> = emptyList())

/** Immutable projections calculated on the worker; no sorting on the UI thread or during playback. */
internal class HomeCatalog(raw: String, seed: Long) {
    private val json = JSONObject(raw)
    val songs = HomeItem.parseList(json.optJSONArray("songs") ?: JSONArray())
    private val byId = songs.associateBy { it.id }
    val picks = songs.sortedBy { (it.id + seed).hashCode() }.take(10)
    private val added = songs.sortedByDescending { it.dateAdded }.take(15)
    private val downloads = songs.filter { it.downloadedAt != null }.sortedByDescending { it.downloadedAt }.take(12)
    private val albums = HomeItem.parseList(json.optJSONArray("albums") ?: JSONArray())
        .sortedByDescending { album -> album.trackIds.maxOfOrNull { byId[it]?.dateAdded ?: 0 } ?: 0 }.take(6)
    val playlists = (json.optJSONArray("playlists") ?: JSONArray()).let { items ->
        (0 until items.length()).map { index -> items.getJSONObject(index).let {
            HomePlaylist(it.getString("id"), it.optString("name"), it.optLong("updatedAt"))
        } }.sortedByDescending { it.updatedAt }
    }

    fun rows(recent: List<HomeItem>, lightweight: Boolean): List<HomeRow> = buildList {
        add(HomeRow("hero", picks.take(if (lightweight) 8 else 5)))
        if (picks.isNotEmpty()) add(HomeRow("picks", picks))
        if (recent.isNotEmpty()) add(HomeRow("recentlyPlayed", recent.take(10).map { byId[it.id] ?: it }))
        if (downloads.isNotEmpty()) add(HomeRow("recentDownloads", downloads))
        if (added.isNotEmpty()) add(HomeRow("recentlyAdded", added))
        if (albums.isNotEmpty()) add(HomeRow("albumsSection", albums))
        if (songs.isEmpty()) add(HomeRow("empty"))
    }
}
