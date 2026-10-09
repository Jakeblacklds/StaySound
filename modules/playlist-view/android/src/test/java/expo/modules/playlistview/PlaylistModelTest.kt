package expo.modules.playlistview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaylistModelTest {
    private val detail = Selection("detail", "p")
    private fun song(id: String, date: Long = 0, remote: Boolean = false, playable: Boolean = true) = JSONObject()
        .put("id", id).put("title", "Title $id").put("artist", "Artist").put("album", "Album")
        .put("dateAdded", date).put("duration", 61000).put("remote", remote).put("playable", playable)
    private fun entry(id: String, resolvedId: String = id, remote: Boolean = false, playable: Boolean = true) = JSONObject()
        .put("memberId", id).put("song", song(resolvedId, remote = remote, playable = playable))
    private fun playlist(id: String = "p", updated: Long = 0, readonly: Boolean = false, vararg entries: JSONObject) = JSONObject()
        .put("id", id).put("name", "Playlist $id").put("updatedAt", updated).put("readonly", readonly).put("entries", JSONArray(entries.toList()))
    private fun catalog(playlists: List<JSONObject> = listOf(playlist(entries = arrayOf(entry("a"), entry("b")))) , library: List<JSONObject> = listOf(song("a"), song("b"))) =
        PlaylistCatalog(JSONObject().put("playlists", JSONArray(playlists)).put("library", JSONArray(library)).toString())

    @Test fun playlistsSortByUpdatedAtWithStableTies() {
        val c = catalog(listOf(playlist("old", 1), playlist("new", 9), playlist("tie", 9)))
        assertEquals(listOf("new", "tie", "old"), c.playlists.map { it.id })
    }
    @Test fun detailKeepsPersistedRelationshipOrder() {
        val c = catalog(listOf(playlist(entries = arrayOf(entry("b"), entry("a"), entry("b")))))
        assertEquals(listOf("b", "a"), c.find("p")!!.entries.map { it.memberId })
        assertEquals(listOf("b", "a"), c.action(detail, "play", "a", "a")!!.trackIds)
        assertEquals(122000, c.find("p")!!.duration)
    }
    @Test fun distinctRelationshipsCanResolveToSameLocalTrack() {
        val c = catalog(listOf(playlist(entries = arrayOf(entry("spotify_1", "local"), entry("tidal_2", "local")))))
        assertEquals(2, c.find("p")!!.entries.size)
        val remove = c.action(detail, "remove", "local", "spotify_1")!!
        assertEquals("spotify_1", remove.memberId); assertEquals("local", remove.id)
        assertNull(c.action(detail, "remove", "local", "local"))
    }
    @Test fun opaqueActionIdsAreNeverHashedOrNormalized() {
        val ids = listOf("Aa", "BB", "á/曲 🪷", "content://media/1", "001", "1")
        val c = catalog(listOf(playlist(entries = ids.map { entry(it) }.toTypedArray())))
        ids.forEach { assertEquals(it, c.action(detail, "queue", it, it)?.id) }
        assertEquals(ids, c.action(detail, "play", "BB", "BB")?.trackIds)
    }
    @Test fun actionsIncludeScreenPlaylistAndMemberIdentity() {
        val payload = catalog().action(detail, "remove", "a", "a")!!.payload()
        assertEquals("detail", payload["screen"]); assertEquals("p", payload["playlistId"])
        assertEquals("a", payload["memberId"]); assertEquals("remove", payload["action"])
        assertEquals(emptyList<String>(), payload["trackIds"])
    }
    @Test fun createTrimsNameAndRejectsBlank() {
        val c = catalog(); val selection = Selection("create")
        assertEquals("Road Trip", c.action(selection, "create", name = "  Road Trip \n")?.name)
        assertNull(c.action(selection, "create", name = " \n "))
        assertNull(c.action(detail, "create", name = "X"))
        assertNull(c.find("Road Trip")) // The command never creates a second source of truth.
    }
    @Test fun editPreservesDescriptionArtworkAndSession() {
        val c = catalog()
        val a = c.action(detail, "edit", name = " New ", description = "  words\n", artwork = "file:///cover.jpg", requestId = "session")!!
        assertEquals("New", a.name); assertEquals("  words\n", a.description)
        assertEquals("file:///cover.jpg", a.artwork); assertEquals("session", a.requestId)
        assertNull(c.action(detail, "edit", name = " "))
        assertEquals("Playlist p", c.find("p")!!.name)
    }
    @Test fun removalAndDeleteCommandsRequireExistingEditablePlaylist() {
        val c = catalog()
        assertNotNull(c.action(detail, "deletePlaylist")); assertNotNull(c.action(detail, "remove", "a", "a"))
        assertNull(c.action(detail, "remove", "gone", "gone"))
        val after = catalog(emptyList())
        assertNull(after.action(detail, "deletePlaylist")); assertNull(after.action(detail, "edit", name = "X"))
        assertNull(after.action(detail, "remove", "a", "a")); assertNotNull(after.action(detail, "back"))
    }
    @Test fun readonlyBlocksEveryPlaylistMutationButKeepsPlayback() {
        val c = catalog(listOf(playlist(readonly = true, entries = arrayOf(entry("a")))))
        for (action in listOf("edit", "deletePlaylist", "remove", "toggle", "pickCover", "cancelCover")) {
            assertNull(action, c.action(detail, action, "a", "a", name = "Changed"))
        }
        assertNotNull(c.action(detail, "play", "a", "a")); assertNotNull(c.action(detail, "queue", "a", "a"))
    }
    @Test fun librarySortAndFilterUseMetadataAndExcludeCloud() {
        val c = catalog(library = listOf(song("old", 1), song("NEW", 5), song("remote", 9, remote = true)))
        assertEquals(listOf("NEW", "old"), c.library.map { it.id })
        assertEquals(listOf("NEW"), c.library(" new ").map { it.id })
        assertEquals(2, c.library("artist").size); assertEquals(2, c.library("album").size)
        assertTrue(c.library("absent").isEmpty())
    }
    @Test fun libraryPlaybackKeepsFilteredOrder() {
        val c = catalog(library = listOf(song("aa", 1), song("ab", 3), song("bb", 2)))
        assertEquals(listOf("ab", "aa"), c.action(detail, "libraryPlay", "aa", query = "Title a")?.trackIds)
        assertNull(c.action(detail, "libraryPlay", "bb", query = "Title a"))
    }
    @Test fun queueAndDownloadRejectUnavailableTracks() {
        val c = catalog(listOf(playlist(entries = arrayOf(entry("remote", remote = true), entry("blocked", remote = true, playable = false), entry("local")))))
        assertNotNull(c.action(detail, "download", "remote", "remote"))
        assertNull(c.action(detail, "download", "local", "local"))
        assertNull(c.action(detail, "queue", "blocked", "blocked"))
        assertNull(c.action(detail, "play", "blocked", "blocked"))
        assertEquals(listOf("remote", "local"), c.action(detail, "shuffle", "remote", "remote")?.trackIds)
    }
    @Test fun libraryDeletionRequiresLocalMembership() {
        val c = catalog(listOf(playlist(entries = arrayOf(entry("a"), entry("remote", remote = true)))))
        assertNotNull(c.action(detail, "deleteTrack", "a", "a")); assertNotNull(c.action(detail, "deleteFile", "a", "a"))
        assertNull(c.action(detail, "deleteFile", "remote", "remote"))
    }
    @Test fun destinationIdsMustResolveToWritablePlaylist() {
        val c = catalog(listOf(playlist(entries = arrayOf(entry("a"))), playlist("target"), playlist("locked", readonly = true)))
        assertEquals("target", c.action(detail, "addToPlaylist", "a", "a", "target")?.targetId)
        assertNull(c.action(detail, "addToPlaylist", "a", "a", "locked"))
        assertNull(c.action(detail, "addToPlaylist", "a", "a", "gone"))
    }
    @Test fun emptyListEmptyPlaylistAndMissingPlaylistAreDistinct() {
        val c = catalog(emptyList(), emptyList())
        assertEquals("emptyPlaylists", c.emptyState(Selection("list")))
        assertEquals("notFound", c.emptyState(detail))
        val empty = catalog(listOf(playlist()), emptyList())
        assertEquals("emptyTracks", empty.emptyState(detail))
        assertEquals("", empty.emptyState(Selection("list")))
        assertTrue(empty.find("p")!!.playable.isEmpty()); assertNull(empty.action(detail, "play"))
        assertNotNull(empty.action(detail, "edit", name = "Named"))
    }
    @Test fun unknownAndStaleCommandsDoNotExecute() {
        val before = catalog(); val after = catalog(listOf(playlist()))
        assertNotNull(before.action(detail, "remove", "a", "a"))
        assertNull(after.action(detail, "remove", "a", "a"))
        assertNull(before.action(detail, "reorder", "a", "a"))
        assertNull(before.action(Selection("other", "p"), "play", "a", "a"))
        assertNull(before.action(detail, "play", "wrong", "a"))
    }
    @Test fun importValidatesSpotifyUrlAndUri() {
        val c = catalog(); val s = Selection("create")
        assertNotNull(c.action(s, "import", name = "https://open.spotify.com/playlist/123"))
        assertNotNull(c.action(s, "import", name = "spotify:playlist:123"))
        assertNull(c.action(s, "import", name = "https://example.com/playlist/123"))
        assertNotNull(c.action(s, "clipboard"))
    }
    @Test fun navigationAlwaysUsesOpaquePlaylistId() {
        val c = catalog(listOf(playlist("a/b?c")))
        assertEquals("a/b?c", c.action(Selection("list"), "open", "a/b?c")?.id)
        assertNull(c.action(Selection("list"), "open", "missing"))
        assertNotNull(c.action(Selection("list"), "openCreate"))
        assertNotNull(c.action(Selection("detail", "missing"), "back"))
    }
}
