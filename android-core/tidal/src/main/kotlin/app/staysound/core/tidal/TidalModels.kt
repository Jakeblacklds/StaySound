package app.staysound.core.tidal

/** Domain models the app works with (`src/types/audio.ts`). API payloads are normalized into these. */
data class TidalTrack(
    val id: Long,
    val title: String,
    val artist: String,
    val artistId: Long? = null,
    val album: String,
    val albumId: Long? = null,
    val durationMs: Long,
    val quality: String,
    val isHiRes: Boolean,
    val coverUuid: String? = null,
    val artworkUrl: String? = null,
    val trackNumber: Int? = null,
    val year: Int? = null,
    val explicit: Boolean? = null,
    val popularity: Double? = null,
    val sampleRate: Int? = null,
    val bitDepth: Int? = null,
    val codec: String? = null,
    val isrc: String? = null,
)

data class TidalArtist(
    val id: Long,
    val name: String,
    val picture: String? = null,
    val artworkUrl: String? = null,
    val popularity: Double? = null,
)

data class TidalAlbum(
    val id: Long,
    val title: String,
    val artistId: Long? = null,
    val artistName: String,
    val coverUuid: String? = null,
    val artworkUrl: String? = null,
    val releaseDate: String? = null,
    val year: Int? = null,
    val numberOfTracks: Int? = null,
    val explicit: Boolean? = null,
    /** ALBUM, EP, SINGLE or COMPILATION when the source says so. */
    val type: String? = null,
    val popularity: Double? = null,
)

data class TidalPlaylist(
    val uuid: String,
    val title: String,
    val description: String? = null,
    val numberOfTracks: Int? = null,
    val artworkUrl: String? = null,
)

/** The best result of a unified search. */
sealed interface TidalTopResult {
    data class Artist(val artist: TidalArtist) : TidalTopResult
    data class Track(val track: TidalTrack) : TidalTopResult
    data class Album(val album: TidalAlbum) : TidalTopResult
}

/** What a mirror returned for a track: either direct file URLs or DASH segments (`ParsedManifest`). */
data class ParsedManifest(
    val urls: List<String>,
    val isSegmented: Boolean,
    val mimeType: String? = null,
    val codecs: String? = null,
    val manifestUrl: String? = null,
)
