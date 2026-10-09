package app.staysound.core.model

import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class LibraryTest {
    @Test fun idsMatchLegacyUtf16AndDoNotDependOnDeviceLocale() {
        val old = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"))
            assertEquals("artist_1968b", LibraryIds.artist("ICE"))
            assertEquals("artist_1b0ef9", LibraryIds.artist("🎵"))
            assertEquals("artist_80000000", LibraryIds.artist("polygenelubricants"))
        } finally { Locale.setDefault(old) }
    }
    @Test fun cloudPlaylistSelectsLocalEquivalentWithoutMatchingAnotherArtist() {
        val remote = Track("remote", "https://stream", "Canción (feat. Guest)", "Édith", "Álbum", 180000, 1, cloudOnly = true)
        val wrong = remote.copy(id = "wrong", artist = "Other", cloudOnly = false)
        val local = remote.copy(id = "local", uri = "content://audio/1", title = "Cancion", artist = "Edith", duration = 182000, cloudOnly = false)
        assertEquals(local, localEquivalent(remote, listOf(remote, wrong, local)))
    }
    @Test fun differentRecordingDurationDoesNotReplaceCloudTrack() {
        val remote = Track("remote", "https://stream", "Song", "Artist", "Album", 180000, 1)
        assertNull(localEquivalent(remote, listOf(remote.copy(id = "live", duration = 240000))))
    }
    @Test fun catalogHasOneTrackSourceAndPreservesInsertionOrder() {
        val first = Track("a", "content://a", "A", "Artist", "Album", 1234, 42)
        val second = first.copy(id = "b", artwork = "cover")
        val catalog = catalogOf(listOf(first, second), emptyList())
        assertEquals(listOf("a", "b"), catalog.albums.single().trackIds)
        assertEquals("cover", catalog.albums.single().artwork)
        assertEquals(1, catalog.artists.single().albumIds.size)
        assertEquals(emptyList<Album>(), catalogOf(emptyList(), emptyList()).albums)
    }
}
