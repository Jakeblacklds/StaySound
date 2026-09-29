package expo.modules.detailview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DetailCatalogTest {
    private fun song(id: String, artistId: String = "artist", name: String = "Artist", canonical: String = "artist", duration: Long = 1000) =
        JSONObject().put("id", id).put("title", "Title $id").put("artist", name).put("artistId", artistId)
            .put("canonicalArtistId", canonical).put("duration", duration)
    private fun album(id: String, vararg tracks: String) = JSONObject().put("id", id).put("title", "Album $id")
        .put("artist", "Artist").put("trackIds", JSONArray(tracks.toList()))
    private fun artist(id: String = "artist", vararg albums: String) = JSONObject().put("id", id)
        .put("name", "Artist").put("albumIds", JSONArray(albums.toList()))
    private fun catalog(songs: List<JSONObject> = emptyList(), albums: List<JSONObject> = emptyList(), artists: List<JSONObject> = emptyList()) =
        DetailCatalog(JSONObject().put("songs", JSONArray(songs)).put("albums", JSONArray(albums)).put("artists", JSONArray(artists)).toString())
    private fun DetailCatalog.album(id: String = "album") = page(DetailSelection("album", id))
    private fun DetailCatalog.artist(id: String = "artist") = page(DetailSelection("artist", id))

    @Test fun albumUsesCatalogRelationshipOrderNotTitleOrNumber() {
        val page = catalog(listOf(song("a"), song("b"), song("c")), listOf(album("album", "c", "a", "b"))).album()
        assertEquals(listOf("c", "a", "b"), page.tracks.map { it.id })
        assertEquals(page.tracks, page.visibleTracks)
        assertEquals(3000L, page.duration)
    }
    @Test fun albumSkipsMissingAndDuplicateReferences() {
        val page = catalog(listOf(song("a"), song("b")), listOf(album("album", "missing", "b", "b", "a"))).album()
        assertEquals(listOf("b", "a"), page.tracks.map { it.id })
    }
    @Test fun artistMatchesExplicitCanonicalAndLegacyNameKeepingInsertionOrder() {
        val page = catalog(listOf(
            song("explicit", "artist", "Different", "other"),
            song("canonical", "old", "Different", "artist"),
            song("legacy", "old", "Artist", "old"),
            song("foreign", "other", "Other", "other"),
        ), artists = listOf(artist())).artist()
        assertEquals(listOf("explicit", "canonical", "legacy"), page.tracks.map { it.id })
    }
    @Test fun artistShowsFiveButPlaysFullArtistContext() {
        val page = catalog((1..8).map { song("$it") }, artists = listOf(artist())).artist()
        assertEquals(listOf("1", "2", "3", "4", "5"), page.visibleTracks.map { it.id })
        val action = page.action("play", "4")!!
        assertEquals((1..8).map(Int::toString), action.trackIds)
        assertEquals("4", action.id)
    }
    @Test fun artistAlbumsFollowRelationshipOrderAndDiscardDanglingReferences() {
        val page = catalog(albums = listOf(album("a"), album("b")), artists = listOf(artist("artist", "b", "gone", "a", "b"))).artist()
        assertEquals(listOf("b", "a"), page.albums.map { it.id })
        assertEquals("b", page.action("album", "b")?.id)
        assertNull(page.action("album", "gone"))
    }
    @Test fun emptyAndUnknownDetailsAreDistinctAndBackAlwaysWorks() {
        val catalog = catalog(albums = listOf(album("empty")))
        val empty = catalog.album("empty")
        assertTrue(empty.found); assertTrue(empty.tracks.isEmpty()); assertNull(empty.action("play", ""))
        val missing = catalog.album("missing")
        assertFalse(missing.found); assertNotNull(missing.action("back")); assertNull(missing.action("queue", "a"))
        assertFalse(catalog.page(DetailSelection("playlist", "empty")).found)
    }
    @Test fun opaqueIdsAreNeverNormalizedOrHashed() {
        // These strings also collide under String.hashCode(). They must stay distinct.
        val ids = listOf("Aa", "BB", "tidal_123", "content://media/7", "á/曲 🪷", "001", "1")
        val page = catalog(ids.map { song(it) }, listOf(album("detail/á", *ids.toTypedArray()))).album("detail/á")
        assertEquals(ids, page.tracks.map { it.id })
        assertEquals("detail/á", page.action("play", "BB")?.detailId)
        assertEquals(ids, page.action("play", "Aa")?.trackIds)
    }
    @Test fun actionsRejectTracksOutsideDetailAndUnknownCommands() {
        val page = catalog(listOf(song("a"), song("foreign")), listOf(album("album", "a"))).album()
        assertNull(page.action("play", "foreign")); assertNull(page.action("queue", "foreign"))
        assertNull(page.action("deleteFile", "a")); assertNull(page.action("album", "album"))
        assertEquals(emptyList<String>(), page.action("queue", "a")!!.trackIds)
    }
    @Test fun actionPayloadCarriesOriginAndOrderedContext() {
        val page = catalog(listOf(song("a"), song("b")), listOf(album("album", "b", "a"))).album()
        assertEquals(mapOf("action" to "play", "kind" to "album", "detailId" to "album", "id" to "a", "trackIds" to listOf("b", "a")),
            page.action("play", "a")!!.payload())
    }
    @Test fun catalogRevisionRemovesStaleActions() {
        val before = catalog(listOf(song("a")), listOf(album("album", "a"))).album()
        val after = catalog(albums = listOf(album("album", "a"))).album()
        assertNotNull(before.action("queue", "a")); assertNull(after.action("queue", "a"))
        assertNull(after.action("play", "a"))
    }
    @Test fun parsingPreservesArtworkAndSanitizesAbsentMetadata() {
        val rawSong = song("a", duration = -100).put("artwork", JSONObject.NULL).put("thumbnail", "thumb")
            .put("favorite", true)
        val rawAlbum = album("album", "a").put("artwork", "full").put("thumbnail", "small")
        val page = catalog(listOf(rawSong, rawSong, song("")), listOf(rawAlbum)).album()
        assertEquals("full", page.artwork); assertEquals("small", page.thumbnail)
        assertEquals(1, page.tracks.size); assertEquals("", page.tracks[0].artwork)
        assertEquals("thumb", page.tracks[0].thumbnail); assertTrue(page.tracks[0].favorite)
        assertEquals(0L, page.duration)
    }
    @Test fun durationUsesMillisecondsAndDoesNotWrapAtAnHour() {
        assertEquals("0:00", detailDuration(-1)); assertEquals("0:59", detailDuration(59999))
        assertEquals("1:00", detailDuration(60000)); assertEquals("61:01", detailDuration(3661000))
    }
    @Test fun selectionKeepsKindAndIdTogether() {
        val selection = DetailSelection.parse("""{"kind":"artist","id":"artist/á"}""")
        assertEquals(DetailSelection("artist", "artist/á"), selection)
        assertFalse(DetailCatalog("{}").page(selection).found)
    }
    @Test(expected = org.json.JSONException::class) fun malformedCatalogCanBeSurfacedAsRetryableError() {
        DetailCatalog("not json")
    }
}
