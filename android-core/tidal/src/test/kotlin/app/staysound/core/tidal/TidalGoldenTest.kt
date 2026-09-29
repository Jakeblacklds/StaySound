package app.staysound.core.tidal

import app.staysound.core.model.Track
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every case in tidal-golden.json was produced by running the real TypeScript (src/services/tidal, see mirrorPolicy.ts, normalize.ts and files.ts) over the same
 * inputs, so this fails when the Kotlin port and the TypeScript disagree. Regenerate with scripts/generate-goldens.mjs.
 */
class TidalGoldenTest {
    // ---- canonical form: JSON with null values dropped and every number as a double, so TS `undefined`/`null` and 3/3.0 agree ----
    private fun canon(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keySet().sorted().mapNotNull { key -> canon(value.get(key))?.let { key to it } }.toMap()
        is JSONArray -> (0 until value.length()).map { canon(value.get(it)) }
        is Number -> value.toDouble()
        else -> value
    }

    private fun JSONObject.put2(key: String, value: Any?): JSONObject = put(key, value ?: JSONObject.NULL)
    private fun JSONObject.text(key: String) = if (has(key) && !isNull(key)) getString(key) else null
    private fun JSONObject.long(key: String) = if (has(key) && !isNull(key)) getLong(key) else null
    private fun JSONObject.bool(key: String) = if (has(key) && !isNull(key)) getBoolean(key) else null

    // ---- domain objects <-> JSON (field names as in src/types/audio.ts) ----
    private fun TidalTrack.json() = JSONObject().put("id", id).put("title", title).put("artist", artist).put2("artistId", artistId).put("album", album)
        .put2("albumId", albumId).put("durationMs", durationMs).put("quality", quality).put("isHiRes", isHiRes).put2("coverUuid", coverUuid)
        .put2("artworkUrl", artworkUrl).put2("trackNumber", trackNumber).put2("year", year).put2("explicit", explicit).put2("popularity", popularity)
        .put2("sampleRate", sampleRate).put2("bitDepth", bitDepth).put2("codec", codec).put2("isrc", isrc)
    private fun TidalArtist.json() = JSONObject().put("id", id).put("name", name).put2("picture", picture).put2("artworkUrl", artworkUrl).put2("popularity", popularity)
    private fun TidalAlbum.json() = JSONObject().put("id", id).put("title", title).put2("artistId", artistId).put("artistName", artistName)
        .put2("coverUuid", coverUuid).put2("artworkUrl", artworkUrl).put2("releaseDate", releaseDate).put2("year", year)
        .put2("numberOfTracks", numberOfTracks).put2("explicit", explicit).put2("type", type).put2("popularity", popularity)
    private fun TidalPlaylist.json() = JSONObject().put("uuid", uuid).put("title", title).put2("description", description)
        .put2("numberOfTracks", numberOfTracks).put2("artworkUrl", artworkUrl)
    private fun TidalTopResult?.json(): Any? = when (this) {
        null -> null
        is TidalTopResult.Artist -> JSONObject().put("kind", "artist").put("artist", artist.json())
        is TidalTopResult.Track -> JSONObject().put("kind", "track").put("track", track.json())
        is TidalTopResult.Album -> JSONObject().put("kind", "album").put("album", album.json())
    }
    private fun MirrorCatalogEntry.json() = JSONObject().put("baseUrl", baseUrl).put("provider", provider).put("enabled", enabled).put("priority", priority)
        .put("supportsSearch", supportsSearch).put("supportsStream", supportsStream).put("supportsDownload", supportsDownload)
        .put("status", status.name.lowercase()).put2("latencyMs", latencyMs).put2("lastCheckedAt", lastCheckedAt).put2("lastError", lastError)
        .put("source", source.name.lowercase())
    private fun MirrorCatalog?.json(): Any? = this?.let {
        JSONObject().put("api", JSONArray(it.api.map { e -> e.json() })).put("streaming", JSONArray(it.streaming.map { e -> e.json() }))
            .put("all", JSONArray(it.all.map { e -> e.json() })).put("source", it.source.name.lowercase())
    }
    private fun Track.json() = JSONObject().put("id", id).put("uri", uri).put("title", title).put("artist", artist).put("album", album)
        .put("duration", duration).put2("artwork", artwork).put2("trackNumber", trackNumber).put2("year", year).put2("format", format)
        .put2("codec", codec).put2("sampleRate", sampleRate).put2("bitDepth", bitDepth).put2("quality", quality).put2("source", source)
        .put2("tidalId", tidalId).put2("tidalAlbumId", tidalAlbumId)

    private fun trackOf(o: JSONObject) = TidalTrack(id = o.getLong("id"), title = o.getString("title"), artist = o.getString("artist"),
        artistId = o.long("artistId"), album = o.getString("album"), albumId = o.long("albumId"), durationMs = o.long("durationMs") ?: 0,
        quality = o.text("quality") ?: "LOSSLESS", isHiRes = o.bool("isHiRes") ?: false, coverUuid = o.text("coverUuid"), artworkUrl = o.text("artworkUrl"),
        trackNumber = o.long("trackNumber")?.toInt(), year = o.long("year")?.toInt(), sampleRate = o.long("sampleRate")?.toInt(),
        bitDepth = o.long("bitDepth")?.toInt(), codec = o.text("codec"))
    private fun manifestOf(o: JSONObject) = ParsedManifest(urls = (0 until o.getJSONArray("urls").length()).map { o.getJSONArray("urls").getString(it) },
        isSegmented = o.getBoolean("isSegmented"), mimeType = o.text("mimeType"), codecs = o.text("codecs"), manifestUrl = o.text("manifestUrl"))
    private fun entryOf(o: JSONObject?) = o?.let { MirrorCatalogEntry("x", supportsSearch = it.getBoolean("supportsSearch"),
        supportsStream = it.getBoolean("supportsStream"), supportsDownload = it.getBoolean("supportsDownload")) }
    private fun capabilityOf(name: String) = MirrorCapability.valueOf(name.uppercase())

    /** Runs the Kotlin implementation of the function a case names. */
    private fun run(fn: String, a: JSONArray): Any? {
        fun str(i: Int) = if (a.isNull(i)) null else a.getString(i)
        fun obj(i: Int) = if (a.isNull(i)) null else a.get(i) as? JSONObject
        return when (fn) {
            "artworkUrl" -> TidalNormalizer.artworkUrl(str(0))
            "playlistArtworkUrl" -> TidalNormalizer.playlistArtworkUrl(str(0))
            "withVersion" -> TidalNormalizer.withVersion(a.getString(0), str(1))
            "normalizeTrack" -> TidalNormalizer.track(a.getJSONObject(0)).json()
            "normalizeArtist" -> TidalNormalizer.artist(a.getJSONObject(0)).json()
            "normalizeAlbum" -> TidalNormalizer.album(a.getJSONObject(0)).json()
            "normalizePlaylist" -> TidalNormalizer.playlist(a.getJSONObject(0)).json()
            "normalizeTopHit" -> TidalNormalizer.topHit(obj(0)).json()
            "extractAlbums" -> JSONArray(TidalNormalizer.albumsFromTracks(a.getJSONArray(0).let { l -> (0 until l.length()).map { trackOf(l.getJSONObject(it)) } }).map { it.json() })
            "shouldFallback" -> MirrorPolicy.shouldFallback(a.getString(0), a.getInt(1), a.getString(2))
            "isHtml" -> MirrorPolicy.isHtmlResponse(str(0), a.getString(1))
            "isReachable" -> MirrorPolicy.isReachableStatus(a.getInt(0))
            "catalogUrl" -> MirrorPolicy.normalizeCatalogUrl(if (a.isNull(0)) null else a.get(0))
            "staticCatalog" -> MirrorPolicy.staticCatalog().json()
            "remoteCatalog" -> MirrorPolicy.fromRemotePayload(if (a.isNull(0)) null else a.get(0)).json()
            "capability" -> MirrorPolicy.isCapabilitySupported(entryOf(obj(0)), capabilityOf(a.getString(1)))
            "capabilityMessage" -> MirrorPolicy.capabilityErrorMessage(capabilityOf(a.getString(0)))
            "resolveExtension" -> DownloadFiles.resolveDownloadExtension(manifestOf(a.getJSONObject(0)), str(1))
            "requiresFlac" -> DownloadFiles.requiresFlacDownload(a.getString(0))
            "directUrl" -> DownloadFiles.directUrl(manifestOf(a.getJSONObject(0)))
            "playableUrl" -> DownloadFiles.playableUrl(manifestOf(a.getJSONObject(0)))
            "baseFilename" -> a.getJSONObject(0).let { DownloadFiles.trackBaseFilename(it.getLong("id"), it.getString("title"), it.getString("artist"), it.getString("album")) }
            "safEntityName" -> DownloadFiles.safEntityName(a.getString(0))
            "libraryTrack" -> DownloadFiles.toLibraryTrack(trackOf(a.getJSONObject(0)), a.getString(1), now = 0).json()
            else -> error("Unknown golden function: $fn")
        }
    }

    @Test fun kotlinMatchesTheTypeScriptOnEveryGoldenCase() {
        val golden = JSONObject(checkNotNull(javaClass.getResourceAsStream("/tidal-golden.json")).reader().readText())
        val cases = golden.getJSONArray("cases")
        assertTrue(cases.length() > 100)
        val failures = mutableListOf<String>()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val fn = case.getString("fn")
            val input = case.getJSONArray("input")
            val expected = canon(case.opt("expected"))
            val actual = try { canon(run(fn, input)) } catch (error: Exception) { "threw ${error::class.simpleName}: ${error.message}" }
            if (expected != actual) failures += "$fn(${input.toString().take(140)})\n   expected: $expected\n   actual:   $actual"
        }
        assertEquals("${failures.size} of ${cases.length()} golden cases differ:\n" + failures.joinToString("\n"), 0, failures.size)
    }
}
