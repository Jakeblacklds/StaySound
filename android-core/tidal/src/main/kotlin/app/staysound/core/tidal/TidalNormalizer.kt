package app.staysound.core.tidal

import app.staysound.core.model.JsText
import org.json.JSONObject

/** Port of `src/services/tidal/normalize.ts`: TIDAL API payloads to the app models. Golden-tested against the TypeScript. */
object TidalNormalizer {
    private const val ARTWORK_BASE = "https://resources.tidal.com/images"
    private const val NIL_UUID = "00000000-0000-0000-0000-000000000000"

    fun artworkUrl(coverUuid: String?): String? {
        if (coverUuid.isNullOrEmpty() || coverUuid == NIL_UUID || coverUuid == "null") return null
        if (coverUuid.startsWith("http")) return coverUuid
        return "$ARTWORK_BASE/${coverUuid.replace('-', '/')}/640x640.jpg"
    }

    /** Some playlist images are square hashes and others use the UUID pattern; only the latter are re-pathed. */
    fun playlistArtworkUrl(imageId: String?): String? {
        if (imageId.isNullOrEmpty()) return null
        val normalized = if (imageId.contains('-')) imageId.replace('-', '/') else imageId
        return "$ARTWORK_BASE/$normalized/640x640.jpg"
    }

    /** "DtMF" and "DtMF (Live)" are different songs, and Soulseek searches by title. */
    fun withVersion(title: String, version: String?): String {
        val trimmed = version?.let(JsText::trim)
        if (title.isEmpty() || trimmed.isNullOrEmpty() || JsText.lower(title).contains(JsText.lower(trimmed))) return title
        return "$title ($trimmed)"
    }

    fun track(item: JSONObject): TidalTrack {
        val quality = item.text("audioQuality") ?: "LOSSLESS"
        val tags = item.obj("mediaMetadata")?.array("tags")?.values().orEmpty()
        val isHiRes = "HIRES_LOSSLESS" in tags || quality == "HI_RES_LOSSLESS"
        val artist = item.obj("artist")
        val album = item.obj("album")
        val coverUuid = album?.text("cover")
        return TidalTrack(
            id = item.long("id") ?: 0,
            title = withVersion(item.text("title").orEmpty(), item.text("version")),
            artist = artist?.text("name") ?: item.array("artists")?.objects()?.firstOrNull()?.text("name") ?: "Unknown Artist",
            artistId = artist?.long("id"),
            album = album?.text("title") ?: "Unknown Album",
            albumId = album?.long("id"),
            durationMs = maxOf(0L, JsText.round((item.double("duration") ?: 0.0) * 1000)),
            quality = quality,
            isHiRes = isHiRes,
            coverUuid = coverUuid,
            artworkUrl = artworkUrl(coverUuid),
            trackNumber = item.int("trackNumber"),
            explicit = item.flag("explicit"),
            popularity = item.double("popularity"),
            isrc = item.text("isrc"),
        )
    }

    fun artist(item: JSONObject): TidalArtist {
        val picture = item.text("picture").orElse(null)
        return TidalArtist(id = item.long("id") ?: 0, name = item.text("name").orEmpty(), picture = picture,
            artworkUrl = artworkUrl(picture), popularity = item.double("popularity"))
    }

    fun album(item: JSONObject): TidalAlbum {
        val artist = item.obj("artist")
        val first = item.array("artists")?.objects()?.firstOrNull()
        val releaseDate = item.text("releaseDate")
        return TidalAlbum(
            id = item.long("id") ?: 0,
            title = withVersion(item.text("title").orEmpty(), item.text("version")),
            type = item.text("type"),
            popularity = item.double("popularity"),
            artistId = artist?.long("id") ?: first?.long("id"),
            artistName = artist?.text("name") ?: first?.text("name") ?: "Artista Desconocido",
            releaseDate = releaseDate,
            year = releaseDate.takeUnless { it.isNullOrEmpty() }?.let(::releaseYear),
            numberOfTracks = item.int("numberOfTracks"),
            explicit = item.flag("explicit"),
            artworkUrl = artworkUrl(item.text("cover")),
        )
    }

    /**
     * The year of a release date. TIDAL sends ISO dates; JavaScript read them as UTC midnight but then took the year
     * in the device's zone, so 1 January could land in the previous year west of Greenwich. This uses the date as written.
     */
    private val isoYear = Regex("^\\s*([+-]?\\d{4,6})(?:-\\d{2}(?:-\\d{2})?)?(?:[T ].*)?$")
    fun releaseYear(releaseDate: String): Int? = isoYear.matchEntire(releaseDate)?.groupValues?.get(1)?.toIntOrNull()

    fun playlist(item: JSONObject): TidalPlaylist {
        val rawImage = item.text("image").orElse(null) ?: item.text("cover").orElse(null)
            ?: item.text("picture").orElse(null) ?: item.text("squareImage").orElse(null)
        val artworkUrl = when {
            rawImage == null -> null
            rawImage.startsWith("http") -> rawImage
            else -> playlistArtworkUrl(rawImage)
        }
        return TidalPlaylist(uuid = item.text("uuid").orEmpty(), title = item.text("title").orEmpty(),
            description = item.text("description"), numberOfTracks = item.int("numberOfTracks"), artworkUrl = artworkUrl)
    }

    fun topHit(hit: JSONObject?): TidalTopResult? {
        val value = hit?.obj("value") ?: return null
        if (!truthy(value.value("id"))) return null
        return when (hit.text("type")) {
            "ARTISTS" -> if (truthy(value.value("name"))) TidalTopResult.Artist(artist(value)) else null
            "TRACKS" -> if (truthy(value.value("title"))) TidalTopResult.Track(track(value)) else null
            "ALBUMS" -> if (truthy(value.value("title"))) TidalTopResult.Album(album(value)) else null
            else -> null
        }
    }

    /** One album per album id, in first-seen order; tracks without an album id are skipped. */
    fun albumsFromTracks(tracks: List<TidalTrack>): List<TidalAlbum> {
        val albums = LinkedHashMap<Long, TidalAlbum>()
        for (track in tracks) {
            val albumId = track.albumId?.takeIf { it != 0L } ?: continue
            albums.putIfAbsent(albumId, TidalAlbum(id = albumId, title = track.album, artistId = track.artistId,
                artistName = track.artist, coverUuid = track.coverUuid, artworkUrl = track.artworkUrl))
        }
        return albums.values.toList()
    }
}
