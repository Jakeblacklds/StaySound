package expo.modules.karaokeview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class LyricsRepositoryTest {
    @Test
    fun `cache miss downloads and stores locally`() {
        val store = InMemoryLocalStore()
        val remote = FakeRemoteDataSource(
            response = LyricsPayload(
                canonicalKey = LyricsRepository.canonicalKey("Cancion", "Artista"),
                payloadJson = "{\"meta\":{\"song\":\"Cancion\",\"artist\":\"Artista\",\"total_duration\":1},\"lyrics\":[]}",
                updatedAt = "2026-01-01T00:00:00Z",
            ),
        )
        val repository = LyricsRepository(store, remote)

        val result = repository.getLyrics("Cancion", "Artista")

        assertNotNull(result)
        assertEquals(1, remote.calls)
        assertEquals(result?.canonicalKey, store.lastWritten?.canonicalKey)
    }

    @Test
    fun `cache hit does not call network`() {
        val canonicalKey = LyricsRepository.canonicalKey("Song", "Artist")
        val cached = LyricsPayload(
            canonicalKey = canonicalKey,
            payloadJson = "{\"meta\":{\"song\":\"Song\",\"artist\":\"Artist\",\"total_duration\":1},\"lyrics\":[]}",
            updatedAt = "2026-01-01T00:00:00Z",
        )
        val store = InMemoryLocalStore().apply { seed(cached) }
        val remote = FakeRemoteDataSource(response = null)
        val repository = LyricsRepository(store, remote)

        val result = repository.getLyrics("Song", "Artist")

        assertEquals(cached, result)
        assertEquals(0, remote.calls)
    }

    @Test
    fun `offline still serves local after first download`() {
        val canonicalKey = LyricsRepository.canonicalKey("Offline Song", "Offline Artist")
        val downloaded = LyricsPayload(
            canonicalKey = canonicalKey,
            payloadJson = "{\"meta\":{\"song\":\"Offline Song\",\"artist\":\"Offline Artist\",\"total_duration\":1},\"lyrics\":[]}",
            updatedAt = "2026-01-01T00:00:00Z",
        )
        val store = InMemoryLocalStore()
        val remote = FakeRemoteDataSource(response = downloaded)
        val repository = LyricsRepository(store, remote)

        val first = repository.getLyrics("Offline Song", "Offline Artist")
        remote.shouldThrow = true
        val second = repository.getLyrics("Offline Song", "Offline Artist")

        assertNotNull(first)
        assertEquals(first, second)
        assertEquals(1, remote.calls)
    }

    @Test
    fun `normalization matches accents spaces and punctuation`() {
        val keyA = LyricsRepository.canonicalKey("  Cancion: De Amor!  ", "JULIETA Venegas")
        val keyB = LyricsRepository.canonicalKey("cancion de amor", "julieta venegas")
        val keyC = LyricsRepository.canonicalKey("Canción de   amor", "Julieta VÉNEGAS")

        assertEquals(keyA, keyB)
        assertEquals(keyB, keyC)
        assertEquals("julieta venegas::cancion de amor", keyA)
    }

    @Test
    fun `force refresh keeps previous local when remote misses`() {
        val canonicalKey = LyricsRepository.canonicalKey("Song", "Artist")
        val cached = LyricsPayload(
            canonicalKey = canonicalKey,
            payloadJson = "{\"meta\":{\"song\":\"Song\",\"artist\":\"Artist\",\"total_duration\":1},\"lyrics\":[]}",
            updatedAt = "2026-01-01T00:00:00Z",
        )
        val store = InMemoryLocalStore().apply { seed(cached) }
        val remote = FakeRemoteDataSource(response = null)
        val repository = LyricsRepository(store, remote)

        val result = repository.forceRefreshLyrics("Song", "Artist")

        assertEquals(cached, result)
    }

    private class InMemoryLocalStore : LocalLyricsStore {
        private val map = mutableMapOf<String, LyricsPayload>()
        var lastWritten: LyricsPayload? = null

        override fun read(canonicalKey: String): LyricsPayload? = map[canonicalKey]

        override fun write(record: LyricsPayload) {
            map[record.canonicalKey] = record
            lastWritten = record
        }

        fun seed(record: LyricsPayload) {
            map[record.canonicalKey] = record
        }
    }

    private class FakeRemoteDataSource(
        private val response: LyricsPayload?,
    ) : RemoteLyricsDataSource {
        var calls = 0
        var shouldThrow = false

        override fun fetchLyrics(songTitle: String, artist: String, canonicalKey: String): LyricsPayload? {
            calls += 1
            if (shouldThrow) {
                throw IllegalStateException("Network unavailable")
            }
            return response?.copy(canonicalKey = canonicalKey)
        }
    }
}
