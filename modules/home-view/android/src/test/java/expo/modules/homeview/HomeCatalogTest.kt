package expo.modules.homeview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HomeCatalogTest {
    private fun song(id: String, added: Long = 0, downloaded: Long? = null) = JSONObject()
        .put("id", id).put("title", "Song $id").put("dateAdded", added)
        .apply { downloaded?.let { put("downloadedAt", it) } }
    private fun catalog(songs: List<JSONObject>, albums: List<JSONObject> = emptyList()) = HomeCatalog(
        JSONObject().put("songs", JSONArray(songs)).put("albums", JSONArray(albums)).toString(), 42L)

    @Test fun emptyLibraryKeepsHistoryAndScanAction() {
        val rows = catalog(emptyList()).rows(listOf(HomeItem("stream", "Stream")), false)
        assertEquals(listOf("hero", "recentlyPlayed", "empty"), rows.map { it.key })
        assertEquals("stream", rows[1].items.single().id)
    }
    @Test fun sectionsRetainTheirOrderAndLimits() {
        val songs = (1..30).map { song("$it", it.toLong(), it.toLong()) }
        val rows = catalog(songs).rows((1..20).map { HomeItem("r$it", "Recent") }, false)
        assertEquals(listOf("hero", "picks", "recentlyPlayed", "recentDownloads", "recentlyAdded"), rows.map { it.key })
        assertEquals(listOf(5, 10, 10, 12, 15), rows.map { it.items.size })
        assertEquals("30", rows.first { it.key == "recentDownloads" }.items.first().id)
        assertEquals("30", rows.first { it.key == "recentlyAdded" }.items.first().id)
    }
    @Test fun picksMatchExistingSignedHashAndRemainStableWhenHistoryChanges() {
        val input = (1..25).map { song("track_$it") }
        val catalog = catalog(input)
        val expected = input.sortedBy { (it.getString("id") + 42L).hashCode() }.take(10).map { it.getString("id") }
        assertEquals(expected, catalog.picks.map { it.id })
        assertEquals(catalog.rows(emptyList(), false).first(), catalog.rows(listOf(HomeItem("recent", "Recent")), false).first())
        assertEquals(8, catalog.rows(emptyList(), true).first().items.size)
    }
    @Test fun albumRecencyUsesLatestMemberAndMissingMembersDoNotWin() {
        val older = JSONObject().put("id", "old").put("title", "Old").put("trackIds", JSONArray(listOf("a", "missing")))
        val newest = JSONObject().put("id", "new").put("title", "New").put("trackIds", JSONArray(listOf("b")))
        val empty = JSONObject().put("id", "empty").put("trackIds", JSONArray())
        val row = catalog(listOf(song("a", 10), song("b", 100)), listOf(older, empty, newest))
            .rows(emptyList(), false).first { it.key == "albumsSection" }
        assertEquals(listOf("new", "old", "empty"), row.items.map { it.id })
    }
    @Test fun missingDownloadDatesAreExcludedButEpochZeroIsValid() {
        val rows = catalog(listOf(song("none"), song("zero", downloaded = 0),
            song("null").put("downloadedAt", JSONObject.NULL), song("text").put("downloadedAt", "3")))
            .rows(emptyList(), false)
        assertEquals(listOf("zero"), rows.first { it.key == "recentDownloads" }.items.map { it.id })
    }
    @Test fun duplicateIdsAreRemovedAndHistoryUsesCurrentMetadata() {
        val rows = catalog(listOf(song("a"), song("a"), song("b")))
            .rows(listOf(HomeItem("a", "Stale title"), HomeItem("remote", "Remote")), false)
        assertEquals(2, rows.first { it.key == "picks" }.items.size)
        assertEquals(listOf("Song a", "Remote"), rows.first { it.key == "recentlyPlayed" }.items.map { it.title })
    }
    @Test fun playlistsSortByUpdateTimeAndMalformedCatalogSurfacesFailure() {
        val json = """{"playlists":[{"id":"a","name":"A","updatedAt":1},{"id":"b","name":"B","updatedAt":2}]}"""
        assertEquals(listOf("b", "a"), HomeCatalog(json, 1).playlists.map { it.id })
        assertTrue(runCatching { HomeCatalog("invalid json", 1) }.isFailure)
    }
    @Test fun artworkUsesFullResolutionWithThumbnailAsFallback() {
        val full = HomeItem("1", "Song", artwork = "content://full", thumbnail = "file:///thumb.jpg")
        assertEquals("content://full", full.displayArtwork)
        assertEquals("file:///thumb.jpg", full.fallbackThumbnail)
        val thumbnailOnly = HomeItem("1", "Song", thumbnail = "file:///thumb.jpg")
        assertEquals("file:///thumb.jpg", thumbnailOnly.displayArtwork)
        assertEquals("", thumbnailOnly.fallbackThumbnail)
        val duplicate = HomeItem("1", "Song", artwork = "https://cover", thumbnail = "https://cover")
        assertEquals("https://cover", duplicate.displayArtwork)
        assertEquals("", duplicate.fallbackThumbnail)
    }
}
