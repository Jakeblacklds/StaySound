package expo.modules.searchview

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class SearchStateTest {
    @Test fun olderResponseIsRejectedBeforeNextDebounce() {
        val state = SearchSession()
        state.edit("SZA"); state.dispatch()
        val oldRequest = state.revision
        state.edit("PinkPantheress")
        assertFalse(state.accepts(oldRequest, "SZA"))
        assertTrue(state.dispatch())
        assertTrue(state.accepts(state.revision, "PinkPantheress"))
    }
    @Test fun sameTextAfterEditingAndRetryStillRequiresFreshRequest() {
        val state = SearchSession()
        state.edit("A"); state.dispatch(); val original = state.revision
        state.edit("B"); state.edit("A"); state.dispatch()
        assertFalse(state.accepts(original, "A"))
        val beforeRetry = state.revision
        state.retry(); assertTrue(state.dispatch())
        assertFalse(state.accepts(beforeRetry, "A"))
        assertTrue(state.accepts(state.revision, "A"))
    }
    @Test fun submitAndDebounceDoNotDuplicateSearchAndClearInvalidatesIt() {
        val state = SearchSession()
        state.edit("  Beyoncé  ")
        assertEquals("Beyoncé", state.query)
        assertTrue(state.dispatch()); assertFalse(state.dispatch())
        val pending = state.revision
        state.edit(" "); assertTrue(state.dispatch())
        assertFalse(state.accepts(pending, "Beyoncé"))
        assertFalse(state.accepts(state.revision, ""))
    }
    @Test fun parsingPreservesIdsAndSkipsMalformedOrDuplicateSongs() {
        val songs = parseTracks(JSONArray("""[
            {"id":"123", "title":"Song", "artist":"Artist", "durationMs":125000},
            {"id":"123", "title":"Duplicate"}, null, {"title":"Missing ID"},
            {"id":"456", "durationMs":-1}
        ]"""))
        assertEquals(listOf("123", "456"), songs.map { it.id })
        assertEquals("Artist · 2:05", songs[0].subtitle)
        assertEquals(0L, songs[1].durationMs)
        assertTrue(parseTracks(null).isEmpty())
    }
    @Test fun transferProgressIsBoundedAndDoesNotLeakAcrossRows() {
        val transfers = parseTransfers(JSONArray("""[
            {"id":"1", "status":"downloading", "progress":0.34},
            {"id":"2", "status":"done", "progress":9},
            {"id":"3", "status":"error", "progress":-1}
        ]"""))
        assertEquals(Transfer("downloading", 34), transfers["1"])
        assertEquals(100, transfers["2"]?.progress)
        assertEquals(0, transfers["3"]?.progress)
        assertTrue(parseTransfers(null).isEmpty())
    }
    @Test fun entitiesKeepTheirKindAndSkipDuplicatesOrMissingIds() {
        val artists = parseEntities(JSONArray("""[
            {"id":"1", "title":"Bad Bunny", "subtitle":"Artista"},
            {"id":"1", "title":"Duplicate"}, {"title":"Missing"}, null
        ]"""), "artist")
        assertEquals(listOf("1"), artists.map { it.id })
        assertEquals("artist", artists[0].kind)
        assertTrue(artists[0].round)
        val album = parseEntities(JSONArray("""[{"id":"9", "kind":"album", "title":"X"}]"""), "artist")[0]
        assertEquals("album", album.kind)
        assertFalse(album.round)
    }
    @Test fun recentsAcceptJsonEntitiesAndLegacyStrings() {
        val artist = parseRecent("""{"kind":"artist","id":"8","title":"ROSALÍA","subtitle":"Artista","key":"artist:8"}""")
        assertEquals("artist:8", artist?.key)
        val legacy = parseRecent("  Beyoncé ")
        assertEquals("query", legacy?.kind)
        assertEquals("Beyoncé", legacy?.query)
        val track = parseRecent("""{"kind":"track","id":"5","title":"DtMF","query":"DtMF Bad Bunny"}""")
        assertEquals("DtMF Bad Bunny", track?.query)
        assertNull(parseRecent("   "))
        assertNull(parseRecent("{not json"))
    }
    @Test fun topResultCarriesItsTrackForDownloadState() {
        val top = parseEntity(org.json.JSONObject("""{"kind":"track","id":"7","title":"Song","label":"Canción",
            "track":{"id":"7","title":"Song","artist":"A","artistId":"3","durationMs":1000}}"""))
        assertEquals("7", top?.track?.id)
        assertEquals("3", top?.track?.artistId)
    }
}
