package expo.modules.libraryview

import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class LibraryCatalogTest {
    private val json = """{
      "songs": [
        {"id":"2","title":"Zénit","subtitle":"Björk - Debut","duration":123000},
        {"id":"1","title":"Ángel","subtitle":"Zoé - Reptilectric","artwork":"file:///thumb.jpg","fallbackArtwork":"content://art/1","favorite":true},
        {"id":"1","title":"Duplicate"}
      ],
      "albums": [{"id":"1","title":"Reptilectric","subtitle":"Zoé"}],
      "artists": [{"id":"1","title":"Björk","count":12}],
      "playlists": [{"id":"p1","name":"Favoritas"}]
    }"""
    private fun catalog() = LibraryCatalog.parse(json, Locale.forLanguageTag("es-MX"))

    @Test fun searchIsAccentAndCaseInsensitiveAcrossMetadata() {
        val catalog = catalog()
        assertEquals(listOf("1"), catalog.search("songs", "  ZOE ").map { it.id })
        assertEquals(listOf("2"), catalog.search("songs", "bjork").map { it.id })
        assertEquals(listOf("1"), catalog.search("songs", "reptilectric").map { it.id })
        assertTrue(catalog.search("songs", "missing").isEmpty())
        assertEquals(2, catalog.search("songs", " ").size)
    }

    @Test fun idsAreScopedByTabAndDuplicateRowsAreRemoved() {
        val catalog = catalog()
        assertEquals(listOf("1", "2"), catalog.songs.map { it.id })
        assertEquals("albums", catalog.search("albums", "zoe").single().kind)
        assertEquals("artists", catalog.search("artists", "BJÖRK").single().kind)
        assertTrue(catalog.search("artists", "zoe").isEmpty())
    }

    @Test fun snapshotPreservesArtworkAndActionsMetadata() {
        val catalog = catalog()
        assertEquals("file:///thumb.jpg", catalog.songs.first().artwork)
        assertEquals("content://art/1", catalog.songs.first().fallbackArtwork)
        assertTrue(catalog.songs.first().favorite)
        assertEquals(123000L, catalog.songs.last().duration)
        assertEquals(12, catalog.artists.single().count)
        assertEquals("p1", catalog.playlists.single().id)
    }

    @Test fun emptyCatalogIsValidAndSearchDoesNotMutateSource() {
        assertTrue(LibraryCatalog.parse("{}", Locale.US).songs.isEmpty())
        val catalog = catalog()
        catalog.search("songs", "angel")
        assertEquals(2, catalog.songs.size)
    }

    @Test fun artworkUsesOriginalWithThumbnailAsFallback() {
        val full = catalog().songs.first()
        assertEquals("content://art/1", full.displayArtwork)
        assertEquals("file:///thumb.jpg", full.fallbackThumbnail)
        val thumbnailOnly = LibraryEntry("1", "songs", "Song", "Artist", "file:///thumb.jpg", "",
            0, false, 0, "song artist")
        assertEquals("file:///thumb.jpg", thumbnailOnly.displayArtwork)
        assertEquals("", thumbnailOnly.fallbackThumbnail)
        val originalOnly = LibraryEntry("1", "artists", "Artist", "", "https://portrait", "",
            0, false, 0, "artist")
        assertEquals("https://portrait", originalOnly.displayArtwork)
        assertEquals("", originalOnly.fallbackThumbnail)
    }
}
