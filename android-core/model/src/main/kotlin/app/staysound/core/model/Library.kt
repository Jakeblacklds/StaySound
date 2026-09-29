package app.staysound.core.model

import java.util.Locale

/** Durations and timestamps have the same millisecond units as the existing library. */
data class Track(
    val id: String,
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Long,
    val dateAdded: Long,
    val artwork: String? = null,
    val artworkThumb: String? = null,
    val albumId: String? = null,
    val artistId: String? = null,
    val trackNumber: Int? = null,
    val year: Int? = null,
    val genre: String? = null,
    val format: String? = null,
    val codec: String? = null,
    val sampleRate: Int? = null,
    val bitDepth: Int? = null,
    val quality: String? = null,
    val source: String? = null,
    val tidalId: Long? = null,
    val tidalAlbumId: Long? = null,
    val spotifyId: String? = null,
    val spotifyUri: String? = null,
    val spotifyUrl: String? = null,
    val isrc: String? = null,
    val downloadedAt: Long? = null,
    val favorite: Boolean? = null,
    val relativePath: String? = null,
    val cloudOnly: Boolean? = null,
    /** Forward-compatible fields, encoded individually as JSON; never overwrite known fields. */
    val extensions: Map<String, String> = emptyMap(),
)

data class Playlist(
    val id: String,
    val name: String,
    val trackIds: List<String>,
    val createdAt: Long,
    val updatedAt: Long,
    val description: String? = null,
    val artwork: String? = null,
    val source: String? = null,
    val readonly: Boolean? = null,
    val externalUrl: String? = null,
    val extensions: Map<String, String> = emptyMap(),
)

data class Album(
    val id: String, val name: String, val artist: String, val artistId: String,
    val trackIds: List<String>, val artwork: String?, val artworkThumb: String?, val year: Int?,
)
data class Artist(val id: String, val name: String, val albumIds: List<String>, val trackIds: List<String>, val artwork: String? = null, val biography: String? = null)
data class Catalog(val tracks: List<Track>, val albums: List<Album>, val artists: List<Artist>, val playlists: List<Playlist>)

enum class DownloadStatus { QUEUED, RUNNING, COMPLETED, CANCELLED, FAILED }
data class Download(
    val id: String, val trackId: String, val status: DownloadStatus,
    val bytesDownloaded: Long = 0, val totalBytes: Long? = null,
    val uri: String? = null, val error: String? = null, val updatedAt: Long,
)

/** These IDs deliberately match JS's signed 32-bit hash, including UTF-16 and MIN_VALUE. */
object LibraryIds {
    private fun hash(value: String) = kotlin.math.abs(value.hashCode().toLong()).toString(16)
    fun album(album: String, artist: String) = "album_" + hash(
        "${album.ifEmpty { "Unknown Album" }.lowercase(Locale.ROOT)}_${artist.ifEmpty { "Unknown Artist" }.lowercase(Locale.ROOT)}",
    )
    fun artist(artist: String) = "artist_" + hash(artist.ifEmpty { "Unknown Artist" }.lowercase(Locale.ROOT))
}

/** Derived, immutable projections. Albums/artists are not separately writable catalogs. */
fun catalogOf(tracks: List<Track>, playlists: List<Playlist>): Catalog {
    val albums = tracks.groupBy { LibraryIds.album(it.album, it.artist) }.map { (id, group) ->
        val first = group.first()
        Album(id, first.album, first.artist, LibraryIds.artist(first.artist), group.map { it.id },
            group.firstOrNull { !it.artwork.isNullOrEmpty() }?.artwork,
            group.firstOrNull { !it.artworkThumb.isNullOrEmpty() }?.artworkThumb, first.year)
    }
    val artists = tracks.groupBy { LibraryIds.artist(it.artist) }.map { (id, group) ->
        Artist(id, group.first().artist, group.map { LibraryIds.album(it.album, it.artist) }.distinct(), group.map { it.id })
    }
    return Catalog(tracks, albums, artists, playlists)
}

/** Legacy cloud playlists prefer a matching local file when their remote ID differs. */
fun localEquivalent(remote: Track, local: List<Track>): Track? {
    fun normalize(value: String) = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
        .replace(Regex("[\\u0300-\\u036f]"), "").lowercase(Locale.ROOT)
        .replace(Regex("\\((feat|ft)\\.?.*?\\)"), " ").replace(Regex("\\[(feat|ft)\\.?.*?\\]"), " ")
        .replace(Regex("[^a-z0-9_\\s]"), " ").replace(Regex("\\s+"), " ").trim()
    fun matches(a: String, b: String): Boolean {
        val left = normalize(a); val right = normalize(b)
        return left.isNotEmpty() && right.isNotEmpty() && (left.contains(right) || right.contains(left))
    }
    fun score(track: Track): Int {
        if (track.cloudOnly == true || !matches(remote.title, track.title) || !matches(remote.artist, track.artist)) return -1
        var value = 11 + if (!remote.isrc.isNullOrEmpty() && remote.isrc == track.isrc) 100 else 0
        if (matches(remote.album, track.album)) value += 2
        if (remote.duration > 0 && track.duration > 0) {
            val delta = kotlin.math.abs(remote.duration - track.duration)
            if (delta > 15000) return -1
            value += if (delta <= 2500) 4 else if (delta <= 6000) 2 else 0
        }
        return value
    }
    return local.map { it to score(it) }.maxByOrNull { it.second }?.takeIf { it.second >= 11 }?.first
}
