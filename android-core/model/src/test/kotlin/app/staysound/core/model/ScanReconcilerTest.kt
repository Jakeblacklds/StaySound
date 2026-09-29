package app.staysound.core.model

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every case in scan-golden.json was produced by running src/services/scanReconcile.ts; Kotlin must match it exactly. */
class ScanReconcilerTest {
    private fun JSONObject.text(key: String) = if (has(key) && !isNull(key)) getString(key) else null
    private fun JSONObject.long(key: String) = if (has(key) && !isNull(key)) getLong(key) else null
    private fun JSONObject.int(key: String) = long(key)?.toInt()
    private fun JSONObject.bool(key: String) = if (has(key) && !isNull(key)) getBoolean(key) else null

    private fun quote(value: String) = JSONObject.quote(value)
    /** `_filename` is not a model field: it travels as an extension, like the legacy JSON importer stores it. */
    private fun track(o: JSONObject) = Track(
        id = o.getString("id"), uri = o.getString("uri"), title = o.getString("title"), artist = o.getString("artist"),
        album = o.getString("album"), duration = o.getLong("duration"), dateAdded = o.getLong("dateAdded"),
        artwork = o.text("artwork"), artworkThumb = o.text("artworkThumb"), trackNumber = o.int("trackNumber"), year = o.int("year"),
        genre = o.text("genre"), format = o.text("format"), codec = o.text("codec"), sampleRate = o.int("sampleRate"),
        bitDepth = o.int("bitDepth"), quality = o.text("quality"), source = o.text("source"), tidalId = o.long("tidalId"),
        tidalAlbumId = o.long("tidalAlbumId"), favorite = o.bool("favorite"), relativePath = o.text("relativePath"),
        extensions = o.text("_filename")?.let { mapOf(ScanReconciler.FILENAME_KEY to quote(it)) } ?: emptyMap(),
    )
    /** JSON escaping differs between implementations; what matters is the decoded value. */
    private fun normalized(t: Track) = t.copy(extensions = t.extensions.mapValues { org.json.JSONTokener(it.value).nextValue().toString() })
    private fun tracks(a: JSONArray) = (0 until a.length()).map { track(a.getJSONObject(it)) }
    private fun scanned(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it).let { o -> ScannedTrack(track(o).copy(extensions = emptyMap()), o.text("_filename")) } }

    @Test fun kotlinMatchesTheTypeScriptOnEveryGoldenCase() {
        val golden = JSONObject(checkNotNull(javaClass.getResourceAsStream("/scan-golden.json")).reader().readText())
        val cases = golden.getJSONArray("cases")
        assertTrue(cases.length() >= 13)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val actual = ScanReconciler.reconcileAll(tracks(case.getJSONArray("existing")), scanned(case.getJSONArray("scanned")))
            assertEquals(case.getString("name"), tracks(case.getJSONArray("expected")).map(::normalized), actual.map(::normalized))
        }
    }

    @Test fun sanitizeAndParseFollowTheJavaScriptRules() {
        assertEquals("AC_DC - Who_ Made _Who_", ScanReconciler.sanitizeFilename("AC/DC  -\tWho? Made <Who>"))
        assertEquals(160, ScanReconciler.sanitizeFilename("x".repeat(400)).length)
        assertEquals(ScanReconciler.Parsed("Song", "Jay-Z", "Unknown Album"), ScanReconciler.parseFilename("Jay-Z - Song.mp3"))
        assertEquals(ScanReconciler.Parsed("Unknown Title", "Unknown Artist", "Unknown Album"), ScanReconciler.parseFilename(""))
    }

    @Test fun anUndecodableNameDoesNotAbortTheScan() {
        val bad = ScannedTrack(Track("x", "content://x/100%.mp3", "Unknown", "Unknown Artist", "Unknown Album", 1000, 1), "100% Pure - Song.mp3")
        assertEquals(1, ScanReconciler.reconcileAll(emptyList(), listOf(bad)).size)
    }
}
