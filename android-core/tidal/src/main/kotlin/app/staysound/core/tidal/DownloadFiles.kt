package app.staysound.core.tidal

import app.staysound.core.model.Filenames
import app.staysound.core.model.JsText
import app.staysound.core.model.Track
import java.net.URI

/** Port of `src/services/tidal/files.ts`: how a downloaded or streamed track is named, typed and turned into a library track. */
object DownloadFiles {
    private val flacUrl = Regex("\\.flac(\\?|$)", RegexOption.IGNORE_CASE)
    private val httpUrl = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val hasScheme = Regex("^[A-Za-z][A-Za-z0-9+.\\-]*:")

    fun trackBaseFilename(id: Long, title: String, artist: String, album: String): String =
        Filenames.sanitize("$artist - $album - $title").ifEmpty { "tidal_$id" }

    fun extensionFromMime(mimeType: String?, codecs: String?): String {
        val mime = JsText.lower(mimeType.orEmpty())
        val codec = JsText.lower(codecs.orEmpty())
        return when {
            mime.contains("flac") || codec.contains("flac") -> "flac"
            mime.contains("mp4") || mime.contains("aac") || mime.contains("m4a") || codec.contains("mp4") || codec.contains("aac") -> "m4a"
            mime.contains("mpeg") || mime.contains("mp3") -> "mp3"
            else -> "flac"
        }
    }

    /** A URL's path decides; only a string that is not a URL at all is searched for an extension. */
    private fun extensionFromUrl(url: String?): String? {
        if (url.isNullOrEmpty()) return null
        val path = if (hasScheme.containsMatchIn(url)) runCatching { URI(url).rawPath }.getOrNull() else null
        if (path != null) {
            val lowered = JsText.lower(path)
            return when {
                lowered.endsWith(".flac") -> "flac"
                lowered.endsWith(".m4a") || lowered.endsWith(".mp4") -> "m4a"
                lowered.endsWith(".mp3") -> "mp3"
                else -> null
            }
        }
        val lowered = JsText.lower(url)
        return when {
            lowered.contains(".flac") -> "flac"
            lowered.contains(".m4a") || lowered.contains(".mp4") -> "m4a"
            lowered.contains(".mp3") -> "mp3"
            else -> null
        }
    }

    private fun isFlacSource(url: String, manifest: ParsedManifest) =
        flacUrl.containsMatchIn(url) || JsText.lower(manifest.mimeType.orEmpty()).contains("flac") || JsText.lower(manifest.codecs.orEmpty()).contains("flac")

    fun resolveDownloadExtension(manifest: ParsedManifest, sourceUrl: String?): String {
        if (manifest.isSegmented && JsText.lower(manifest.mimeType.orEmpty()).contains("mp4")) return "m4a"
        if (sourceUrl != null && isFlacSource(sourceUrl, manifest)) return "flac"
        extensionFromUrl(sourceUrl ?: manifest.manifestUrl)?.let { return it }
        return extensionFromMime(manifest.mimeType, manifest.codecs)
    }

    fun requiresFlacDownload(quality: String) = quality == "LOSSLESS" || quality == "HI_RES_LOSSLESS"

    /** A single plain file to download or stream directly, as opposed to DASH segments. */
    fun directUrl(manifest: ParsedManifest): String? {
        val direct = manifest.urls.filter { httpUrl.containsMatchIn(it) }
        return if (manifest.isSegmented || direct.size != 1) null else direct[0]
    }

    fun playableUrl(manifest: ParsedManifest): String? =
        directUrl(manifest) ?: manifest.manifestUrl?.takeIf { httpUrl.containsMatchIn(it) }

    /** The last path segment of a Storage Access Framework URI, without the provider prefix ("primary:"). */
    fun safEntityName(uri: String): String {
        val decoded = JsText.decodeUriComponent(uri)
        val segment = decoded.substring(decoded.lastIndexOf('/') + 1)
        val withoutProvider = segment.substring(segment.lastIndexOf(':') + 1)
        return withoutProvider.split('/').lastOrNull { it.isNotEmpty() } ?: withoutProvider
    }

    /**
     * The library entry for a finished download. The extension is whatever follows the last dot, so a URI with no dot
     * yields the whole URI as its "extension" (kept from the TypeScript: it only affects the stored codec).
     */
    fun toLibraryTrack(track: TidalTrack, uri: String, now: Long): Track {
        val extension = uri.substringAfterLast('.', uri).let(JsText::lower).ifEmpty { "flac" }
        val format = when (extension) { "flac" -> "FLAC"; "m4a" -> "AAC"; "mp3" -> "MP3"; else -> "FLAC" }
        return Track(
            id = "tidal_${track.id}", uri = uri, title = track.title, artist = track.artist, album = track.album,
            duration = track.durationMs, dateAdded = now, artwork = track.artworkUrl, trackNumber = track.trackNumber, year = track.year,
            format = format, codec = track.codec ?: extension, sampleRate = track.sampleRate, bitDepth = track.bitDepth,
            quality = track.quality, source = "tidal", tidalId = track.id, tidalAlbumId = track.albumId,
        )
    }
}
