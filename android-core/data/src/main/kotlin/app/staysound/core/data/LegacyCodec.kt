package app.staysound.core.data

import app.staysound.core.model.*
import org.json.JSONArray
import org.json.JSONObject

/** Strict at the boundary: malformed data aborts migration, never silently becomes an empty library. */
internal object LegacyCodec {
    const val LIBRARY = "staysound-library"
    const val PLAYER = "staysound-player"
    const val SETTINGS = "staysound-settings"
    const val DOWNLOADS = "staysound-native-downloads-v1"
    private val trackKeys = setOf("id", "uri", "title", "artist", "album", "duration", "dateAdded", "artwork", "artworkThumb",
        "albumId", "artistId", "trackNumber", "year", "genre", "format", "codec", "sampleRate", "bitDepth", "quality",
        "source", "tidalId", "tidalAlbumId", "spotifyId", "spotifyUri", "spotifyUrl", "isrc", "downloadedAt", "favorite", "relativePath", "cloudOnly")
    private val playlistKeys = setOf("id", "name", "trackIds", "createdAt", "updatedAt", "description", "artwork", "source", "readonly", "externalUrl")
    private fun JSONObject.text(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null
    private fun JSONObject.long(key: String): Long? = if (has(key) && !isNull(key)) getLong(key) else null
    private fun JSONObject.int(key: String): Int? = long(key)?.also { require(it in Int.MIN_VALUE..Int.MAX_VALUE) }?.toInt()
    private fun JSONObject.bool(key: String): Boolean? = if (has(key) && !isNull(key)) getBoolean(key) else null
    private fun JSONObject.extras(known: Set<String>) = keys().asSequence().filter { it !in known }.associateWith { JSONArray().put(get(it)).toString().let { encoded -> encoded.substring(1, encoded.length - 1) } }
    private fun base(extras: Map<String, String>, known: Set<String>): JSONObject = JSONObject().apply {
        require(extras.keys.none { it in known }) { "Extension shadows a known field" }
        extras.forEach { (key, value) -> put(key, org.json.JSONTokener(value).nextValue()) }
    }
    fun track(o: JSONObject) = Track(
        id = o.getString("id").also { require(it.isNotBlank()) }, uri = o.getString("uri"), title = o.getString("title"),
        artist = o.getString("artist"), album = o.getString("album"), duration = o.getLong("duration"), dateAdded = o.getLong("dateAdded"),
        artwork = o.text("artwork"), artworkThumb = o.text("artworkThumb"), albumId = o.text("albumId"), artistId = o.text("artistId"),
        trackNumber = o.int("trackNumber"), year = o.int("year"), genre = o.text("genre"), format = o.text("format"), codec = o.text("codec"),
        sampleRate = o.int("sampleRate"), bitDepth = o.int("bitDepth"), quality = o.text("quality"), source = o.text("source"),
        tidalId = o.long("tidalId"), tidalAlbumId = o.long("tidalAlbumId"), spotifyId = o.text("spotifyId"), spotifyUri = o.text("spotifyUri"),
        spotifyUrl = o.text("spotifyUrl"), isrc = o.text("isrc"), downloadedAt = o.long("downloadedAt"), favorite = o.bool("favorite"),
        relativePath = o.text("relativePath"), cloudOnly = o.bool("cloudOnly"), extensions = o.extras(trackKeys),
    )
    fun track(t: Track): JSONObject = base(t.extensions, trackKeys).apply {
        put("id", t.id); put("uri", t.uri); put("title", t.title); put("artist", t.artist); put("album", t.album)
        put("duration", t.duration); put("dateAdded", t.dateAdded); put("artwork", t.artwork); put("artworkThumb", t.artworkThumb)
        put("albumId", t.albumId); put("artistId", t.artistId); put("trackNumber", t.trackNumber); put("year", t.year)
        put("genre", t.genre); put("format", t.format); put("codec", t.codec); put("sampleRate", t.sampleRate); put("bitDepth", t.bitDepth)
        put("quality", t.quality); put("source", t.source); put("tidalId", t.tidalId); put("tidalAlbumId", t.tidalAlbumId)
        put("spotifyId", t.spotifyId); put("spotifyUri", t.spotifyUri); put("spotifyUrl", t.spotifyUrl); put("isrc", t.isrc)
        put("downloadedAt", t.downloadedAt); put("favorite", t.favorite); put("relativePath", t.relativePath); put("cloudOnly", t.cloudOnly)
    }
    fun playlist(o: JSONObject) = Playlist(o.getString("id"), o.getString("name"), strings(o.getJSONArray("trackIds")),
        o.getLong("createdAt"), o.getLong("updatedAt"), o.text("description"), o.text("artwork"), o.text("source"),
        o.bool("readonly"), o.text("externalUrl"), o.extras(playlistKeys))
    fun playlist(p: Playlist): JSONObject = base(p.extensions, playlistKeys).apply {
        put("id", p.id); put("name", p.name); put("trackIds", JSONArray(p.trackIds)); put("createdAt", p.createdAt)
        put("updatedAt", p.updatedAt); put("description", p.description); put("artwork", p.artwork); put("source", p.source)
        put("readonly", p.readonly); put("externalUrl", p.externalUrl)
    }
    fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }
    fun objects(a: JSONArray): List<JSONObject> = (0 until a.length()).map { a.getJSONObject(it) }
    fun pairs(a: JSONArray): List<Pair<String, Any>> {
        val seen = mutableSetOf<String>()
        return (0 until a.length()).map { index ->
            val pair = a.getJSONArray(index)
            require(pair.length() == 2) { "Invalid map entry" }
            val key = pair.getString(0)
            require(seen.add(key)) { "Duplicate map key: $key" }
            key to pair.get(1)
        }
    }
    fun envelope(raw: String?): JSONObject = if (raw == null) JSONObject().put("state", JSONObject()).put("version", 0) else JSONObject(raw).also {
        require(it.has("state") && it.get("state") is JSONObject) { "Invalid Zustand envelope" }
        require(!it.has("version") || it.getInt("version") == 0) { "Unsupported Zustand version" }
    }
    fun array(state: JSONObject, name: String): JSONArray = if (state.has(name)) state.getJSONArray(name) else JSONArray()
    fun pair(key: String, value: Any) = JSONArray().put(key).put(value)
}

internal data class LegacyImport(
    val tracks: List<TrackRow>, val playlists: List<Playlist>, val cloud: List<CloudTrackRow>,
    val history: List<HistoryRow>, val downloads: List<DownloadRow>,
    val artistInfo: List<ArtistInfoRow>, val documents: List<DocumentRow>, val preferences: Map<String, String>,
) {
    companion object {
        fun parse(files: Map<String, String>): LegacyImport = with(LegacyCodec) {
            val library = envelope(files[LIBRARY])
            val state = library.getJSONObject("state")
            val tracks = pairs(array(state, "tracks")).mapIndexed { index, (key, value) ->
                val track = track(value as JSONObject)
                require(key == track.id) { "Track key/id mismatch" }
                TrackRow(key, track, index)
            }
            val playlists = pairs(array(state, "playlists")).map { (key, value) -> playlist(value as JSONObject).also {
                require(key == it.id) { "Playlist key/id mismatch" }
            } }
            val cloud = pairs(array(state, "cloudPlaylistTracks")).flatMap { (playlistId, value) ->
                pairs(value as JSONArray).mapIndexed { index, (key, raw) ->
                    CloudTrackRow(playlistId, key, track(raw as JSONObject).also { require(key == it.id) }, index)
                }
            }
            val player = envelope(files[PLAYER])
            val playerState = player.getJSONObject("state")
            val history = objects(array(playerState, "recentlyPlayed")).mapIndexed { index, o -> HistoryRow(index, track(o)) }
            val cloudOrder = JSONArray(pairs(array(state, "cloudPlaylistTracks")).map { it.first }).toString()
            listOf("tracks", "playlists", "cloudPlaylistTracks").forEach(state::remove)
            playerState.remove("recentlyPlayed")
            // Original client persists neither albums/artists nor in-flight downloads. Do not prune media here.
            val nativeDownloads = files[DOWNLOADS]?.let { raw ->
                val root = JSONObject(raw)
                require(root.getInt("version") == 1) { "Unsupported native download export version" }
                objects(root.getJSONArray("downloads")).map { o ->
                    val id = o.getString("id")
                    DownloadRow(id, Download(id, o.getString("trackId"), DownloadStatus.valueOf(o.getString("status")),
                        o.getLong("bytesDownloaded"), if (o.isNull("totalBytes")) null else o.getLong("totalBytes"),
                        if (o.isNull("uri")) null else o.getString("uri"), if (o.isNull("error")) null else o.getString("error"), o.getLong("updatedAt")))
                }.also { rows -> require(rows.map { it.key }.distinct().size == rows.size) }
            }.orEmpty()
            val completedIds = nativeDownloads.filter { it.download.status == DownloadStatus.COMPLETED }.map { it.download.trackId }.toSet()
            val downloads = nativeDownloads + tracks.filter { it.key !in completedIds }.filter {
                it.track.downloadedAt != null || (it.track.source == "tidal" && (it.track.uri.startsWith("content://") || it.track.uri.startsWith("file://") || it.track.uri.startsWith("/")))
            }.map { row ->
                DownloadRow("legacy:${row.key}", Download("legacy:${row.key}", row.key, DownloadStatus.COMPLETED,
                    uri = row.track.uri, updatedAt = row.track.downloadedAt ?: row.track.dateAdded))
            }
            files[SETTINGS]?.let { envelope(it) }
            LegacyImport(tracks, playlists, cloud, history, downloads.sortedBy { it.key }, ArtistCache.decode(files[ArtistCache.DOCUMENT]),
                listOf(DocumentRow(LIBRARY, library.toString()), DocumentRow("cloud-order", cloudOrder)) +
                    files.filterKeys { it !in setOf(LIBRARY, PLAYER, SETTINGS, DOWNLOADS, ArtistCache.DOCUMENT, "staysound-onboarding") }
                        .map { (name, raw) -> DocumentRow("opaque:$name", raw) }.sortedBy { it.name },
                files.filterKeys { it == SETTINGS || it == "staysound-onboarding" } + (PLAYER to player.toString()))
        }
    }
}
