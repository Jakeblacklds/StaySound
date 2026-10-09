package expo.modules.tidaldetailview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TidalDetailModelTest {
    private fun snapshot(kind: String = "artist", count: Int = 12): JSONObject = JSONObject().apply {
        put("version", 1); put("screenKey", "$kind:42:qobuz"); put("kind", kind); put("id", "42")
        put("title", "Björk"); put("loading", false)
        put("tracks", JSONArray().apply { repeat(count) { put(JSONObject().put("id", it + 1).put("title", "Track $it")) } })
    }
    private fun model(kind: String = "artist", count: Int = 12) = TidalDetailModel.parse(snapshot(kind, count).toString())
    private fun link(kind: String, id: String) = JSONObject().put("kind", kind).put("id", id).put("title", "Detalle")

    @Test fun parsesEveryScreenAndUnicode() {
        for (kind in DetailKind.entries) {
            val m = model(kind.name)
            assertEquals(kind, m.kind); assertEquals("Björk", m.title)
            assertEquals("${kind.name}:42:qobuz", m.screenKey); assertTrue(m.ready)
        }
    }
    @Test fun malformedAndUnsupportedSnapshotsFailClosed() {
        for (raw in listOf("", "[]", "{", snapshot().put("version", 2).toString(), snapshot().put("kind", "unknown").toString(), snapshot().put("id", "").toString())) {
            val m = TidalDetailModel.parse(raw)
            assertFalse(m.ready); assertTrue(m.error.isNotBlank()); assertTrue(m.tracks.isEmpty())
        }
    }
    @Test fun nullsAndBadRowsDoNotLeakIntoLabels() {
        val o = snapshot().put("quality", JSONObject.NULL).put("subtitle", JSONObject.NULL)
        o.put("tracks", JSONArray().put(JSONObject().put("id", "abc")).put(JSONObject().put("id", -1)).put(JSONObject().put("id", 7).put("title", JSONObject.NULL)))
        val m = TidalDetailModel.parse(o.toString())
        assertEquals("", m.quality); assertEquals("", m.subtitle)
        assertEquals(1, m.tracks.size); assertEquals("Unknown Title", m.tracks[0].title)
    }
    @Test fun clampsProgressDurationAndUnknownDownloadState() {
        val o = snapshot("album", 0).put("tracks", JSONArray()
            .put(JSONObject().put("id", 1).put("durationMs", -2).put("progress", 3).put("status", "broken"))
            .put(JSONObject().put("id", 2).put("progress", -.2).put("status", "downloading").put("active", true).put("playing", true)))
        val m = TidalDetailModel.parse(o.toString())
        assertEquals(0L, m.tracks[0].durationMs); assertEquals(1.0, m.tracks[0].progress, .0)
        assertEquals("idle", m.tracks[0].status); assertEquals(0.0, m.tracks[1].progress, .0)
        assertTrue(m.tracks[1].active); assertTrue(m.tracks[1].playing)
    }
    @Test fun preservesPlaylistOrderAndRepeatedTracks() {
        val o = snapshot("playlist", 0).put("id", "playlist-uuid").put("tracks", JSONArray().put(JSONObject().put("id", 9)).put(JSONObject().put("id", 3)).put(JSONObject().put("id", 9)))
        assertEquals(listOf("9", "3", "9"), TidalDetailModel.parse(o.toString()).tracks.map { it.id })
    }
    @Test fun parsesArtistLinkAndRailAppearance() {
        val o = snapshot("album").put("artistLink", link("artist", "55")).put("sections", JSONArray().put(JSONObject()
            .put("title", "Similares").put("kicker", "Descubre").put("size", 108).put("circle", true).put("items", JSONArray().put(link("artist", "66")))))
        val m = TidalDetailModel.parse(o.toString())
        assertEquals("55", m.artistLink?.id); assertEquals(108, m.sections[0].size); assertTrue(m.sections[0].circle)
        assertEquals(2, m.links().size)
    }
    @Test fun gridDeduplicatesByKindAndCapsAt96() {
        val grid = JSONArray().put(link("album", "1")).put(link("album", "1")).put(link("playlist", "1"))
        repeat(110) { grid.put(link("album", "${it + 2}")) }
        val m = TidalDetailModel.parse(snapshot("genre", 0).put("grid", grid).toString())
        assertEquals(96, m.grid.size); assertEquals(DetailKind.playlist, m.grid[1].kind)
    }
    @Test fun invalidLinksAreDropped() {
        val grid = JSONArray().put(link("bad", "1")).put(link("album", "")).put(link("album", "undefined")).put(link("playlist", "uuid"))
        assertEquals(listOf("uuid"), TidalDetailModel.parse(snapshot("genre", 0).put("grid", grid).toString()).grid.map { it.id })
    }
    @Test fun artistExpansionSurvivesStatusUpdatesButResetsOnNavigation() {
        val state = DetailListState(); val m = model()
        state.accept(m); assertEquals(8, state.tracks(m).size)
        state.toggleTracks(); assertEquals(12, state.tracks(m).size)
        state.accept(m.copy(downloadingAll = true)); assertTrue(state.expanded)
        state.accept(m.copy(screenKey = "artist:43:tidal")); assertFalse(state.expanded)
    }
    @Test fun albumAndPlaylistShowAllTracks() {
        for (kind in listOf("album", "playlist")) assertEquals(60, DetailListState().tracks(model(kind, 60)).size)
    }
    @Test fun genrePagingIsBoundedAndSurvivesUpdates() {
        val grid = JSONArray(); repeat(50) { grid.put(link("album", "$it")) }
        val m = TidalDetailModel.parse(snapshot("genre", 0).put("grid", grid).toString())
        val state = DetailListState(); state.accept(m)
        assertEquals(16, state.grid(m).size); state.loadMore(50); assertEquals(32, state.grid(m).size)
        state.accept(m.copy(title = "Rock")); assertEquals(32, state.visibleCount)
        repeat(10) { state.loadMore(50) }; assertEquals(50, state.grid(m).size)
        state.accept(m.copy(screenKey = "genre:next")); assertEquals(16, state.visibleCount)
    }
    @Test fun loadingErrorEmptyAndContentAreDistinct() {
        val state = DetailListState(); val m = model()
        assertEquals("loading", state.phase(m.copy(loading = true)))
        assertEquals("error", state.phase(m.copy(error = "Offline")))
        assertEquals("empty", state.phase(model(count = 0)))
        assertEquals("content", state.phase(m))
        assertEquals("content", state.phase(model(count = 0).copy(sections = listOf(DetailSection("Albums", "", 150, false, listOf(DetailLink(DetailKind.album, "2", "", "", "")))))))
    }
    @Test fun allowsOnlyDeclaredNavigationTargetsAndPreservesIdentity() {
        for (kind in DetailKind.entries) {
            val m = model().copy(grid = listOf(DetailLink(kind, "target", "Title", "", "")))
            val action = DetailActions.create(m, "navigate", "target", kind.name)!!
            assertEquals(kind.name, action.payload()["kind"]); assertEquals(m.screenKey, action.payload()["screenKey"])
            assertNull(DetailActions.create(m, "navigate", "unknown", kind.name))
        }
        assertNull(DetailActions.create(model(), "navigate", "1", "album"))
    }
    @Test fun rejectsUnknownActionsAndNonmemberTrackIds() {
        val m = model()
        assertNull(DetailActions.create(m, "delete", "1"))
        for (action in listOf("play", "queue", "download", "cancelDownload")) assertNull(DetailActions.create(m, action, "999"))
        assertNotNull(DetailActions.create(m, "play", "1")); assertNotNull(DetailActions.create(m, "queue", "1"))
    }
    @Test fun downloadAndCancelAreExplicitAndReflectTsState() {
        val m = model("album", 1)
        assertEquals("download", DetailActions.create(m, "download", "1")?.action)
        assertNull(DetailActions.create(m, "cancelDownload", "1"))
        val downloading = m.copy(tracks = listOf(m.tracks[0].copy(status = "downloading", progress = .5)))
        assertNull(DetailActions.create(downloading, "download", "1"))
        assertEquals("cancelDownload", DetailActions.create(downloading, "cancelDownload", "1")?.action)
        val done = m.copy(tracks = listOf(m.tracks[0].copy(status = "done")))
        assertNull(DetailActions.create(done, "download", "1")); assertNull(DetailActions.create(done, "cancelDownload", "1"))
        assertNotNull(DetailActions.create(m.copy(tracks = listOf(m.tracks[0].copy(status = "error"))), "download", "1"))
    }
    @Test fun busyAndEmptyStatesDisableBatchActions() {
        val m = model()
        for (action in listOf("playAll", "shuffle", "downloadAll")) {
            assertNotNull(DetailActions.create(m, action)); assertNull(DetailActions.create(model(count = 0), action))
        }
        assertNull(DetailActions.create(m.copy(preparing = "play"), "playAll"))
        assertNull(DetailActions.create(m.copy(preparing = "shuffle"), "shuffle"))
        assertNull(DetailActions.create(m.copy(downloadingAll = true), "downloadAll"))
    }
    @Test fun loadingAndErrorsAllowBackOnly() {
        for (m in listOf(model().copy(loading = true), model().copy(error = "Offline"))) {
            assertNotNull(DetailActions.create(m, "back"))
            for (action in listOf("play", "queue", "download", "cancelDownload", "playAll", "shuffle", "downloadAll", "navigate")) assertNull(DetailActions.create(m, action, "1", "album"))
        }
    }
}
