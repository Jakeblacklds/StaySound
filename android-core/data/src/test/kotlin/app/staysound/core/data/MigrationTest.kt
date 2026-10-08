package app.staysound.core.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.staysound.core.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MigrationTest {
    private lateinit var context: Context
    private var runtime: StaySoundData? = null
    private val a = Track("ms_51", "content://media/external/audio/media/51", "Niña 🎵", "Édith", "Álbum", 185123, 100,
        artwork = "file:///private/portada.png", artworkThumb = "content://thumb", format = "flac", sampleRate = 96000, bitDepth = 24,
        downloadedAt = 123, favorite = true, tidalId = 567, relativePath = "Music/StaySound", extensions = mapOf("future" to "{\"a\":[1,true]}"))
    private val b = a.copy(id = "cloud_1", uri = "https://example.org/audio", cloudOnly = true, downloadedAt = null, spotifyId = "spotify-1")
    @Before fun setup() {
        context = ApplicationProvider.getApplicationContext()
        File(context.filesDir, "storage").deleteRecursively()
        File(context.filesDir, "staysound-core").deleteRecursively()
        context.deleteDatabase("staysound-core-v1.db")
        File(context.filesDir, "SQLite").deleteRecursively()
    }
    @After fun tearDown() = runBlocking { runtime?.close(); runtime = null }
    private fun fixture(): Map<String, String> {
        val playlists = listOf(
            Playlist("z", "Viaje", listOf(a.id, "missing", a.id, b.id), 12, 15, extensions = mapOf("extra" to "false")),
            Playlist("a", "Spotify", listOf(b.id), 11, 18, source = "spotify", readonly = true, externalUrl = "https://open.spotify.com/playlist/1"),
        )
        fun envelope(state: JSONObject) = JSONObject().put("state", state).put("version", 0).put("envelopeExtra", 7).toString()
        return mapOf(
            LegacyCodec.LIBRARY to envelope(JSONObject().put("tracks", JSONArray().put(LegacyCodec.pair(a.id, LegacyCodec.track(a))))
                .put("playlists", JSONArray().apply { playlists.forEach { put(LegacyCodec.pair(it.id, LegacyCodec.playlist(it))) } })
                .put("cloudPlaylistTracks", JSONArray().put(LegacyCodec.pair("z", JSONArray().put(LegacyCodec.pair(b.id, LegacyCodec.track(b)))))
                    .put(LegacyCodec.pair("a", JSONArray().put(LegacyCodec.pair(b.id, LegacyCodec.track(b)))))
                    .put(LegacyCodec.pair("empty", JSONArray())))
                .put("recentSearches", JSONArray(listOf("Édith", "Álbum"))).put("lastScanDate", 4321).put("unknown", "preserve")),
            LegacyCodec.PLAYER to envelope(JSONObject().put("recentlyPlayed", JSONArray().put(LegacyCodec.track(b)).put(LegacyCodec.track(a)))
                .put("volume", 0.37).put("repeatMode", "all").put("shuffleEnabled", true).put("playerVariant", "aurora")),
            LegacyCodec.SETTINGS to envelope(JSONObject().put("language", "en").put("tidalMirror", "https://example.org")
                .put("tidalDownloadQuality", "LOSSLESS").put("lyricsSources", JSONArray(listOf("apple", "lrclib")))
                .put("spectrumDelayMs", 500).put("equalizer", JSONObject().put("mode", "app").put("enabled", true)
                    .put("presetId", JSONObject.NULL).put("bandLevels", JSONObject().put("60", 4.5))).put("futureSetting", JSONArray(listOf(1, 2)))),
            "staysound-onboarding" to envelope(JSONObject().put("hasCompletedOnboarding", true).put("userName", "Jacob")),
            "staysound-auth" to envelope(JSONObject().put("session", JSONObject().put("refreshToken", "synthetic-test-token"))),
            "tidal-public-downloads-permission" to "\"content://tree/primary%3AMusic\"",
            "soulseek-native-credentials" to "{\"username\":\"test\",\"password\":\"synthetic\"}",
            "lyrics-%C3%89dith%20%2F%20Song" to "{\"lyrics\":[{\"time\":42}],\"source\":\"test\"}",
        )
    }
    private fun seed(files: Map<String, String> = fixture()) = files.forEach { (key, value) -> atomicWrite(File(context.filesDir, "storage/$key.json"), value.toByteArray()) }
    private fun legacy() = File(context.filesDir, "storage").listFiles().orEmpty().filter { it.name.endsWith(".json") }.associate { it.name.removeSuffix(".json") to it.readText() }
    private suspend fun open(checkpoint: (MigrationCheckpoint) -> Unit = {}): StaySoundData = StaySoundData.create(context, checkpoint).also { runtime = it }
    private suspend fun close() { runtime!!.close(); runtime = null }
    private suspend fun throws(block: suspend () -> Unit) { try { block(); fail("Expected failure") } catch (expected: IllegalStateException) { /* expected */ } }

    @Test fun importsAllCollectionsAndPreservesOriginalFiles() = runBlocking {
        val source = fixture(); seed(source)
        val data = open(); data.importLegacyAtStartup()
        assertEquals(source, legacy())
        val catalog = data.library.snapshot()
        assertEquals(listOf(a), catalog.tracks)
        assertEquals(listOf(a.id, "missing", a.id, b.id), catalog.playlists.first().trackIds)
        assertEquals(listOf(a, a, a), data.library.playlistTracks("z"))
        assertEquals(listOf(b, a), data.library.history.first())
        assertEquals(a.uri, data.library.downloads.first().single().uri)
        assertEquals(0, data.library.downloads.first().single().bytesDownloaded)
        assertEquals("en", data.settings.read().language)
        assertEquals(4.5, data.settings.read().equalizer.bandLevels["60"])
        assertEquals(null, data.settings.read().equalizer.presetId)
        data.importLegacyAtStartup() // Idempotent, never duplicates or overwrites native changes.
        assertEquals(1, data.library.snapshot().tracks.size)
    }
    @Test fun rollbackExportsLatestNativeChangesIncludingUnknownFields() = runBlocking {
        val source = fixture(); seed(source)
        val data = open(); data.importLegacyAtStartup()
        data.library.upsert(a.copy(title = "Renamed"))
        data.library.toggleFavorite(a.id, 999)
        data.settings.setLanguage("es")
        data.library.recordPlayed(a)
        val id = data.library.createPlaylist("New", now = 900)
        data.library.addToPlaylist(id, a.id, 901)
        data.exportForLegacyAtShutdown()
        throws { data.library.upsert(a) }
        val restored = LegacyImport.parse(legacy())
        assertEquals("Renamed", restored.tracks.single().track.title)
        assertEquals(false, restored.tracks.single().track.favorite)
        assertEquals(a.extensions, restored.tracks.single().track.extensions)
        assertEquals(listOf(a.id), restored.playlists.first { it.id == id }.trackIds)
        assertEquals("es", LegacyCodec.settingsEnvelope(legacy()[LegacyCodec.SETTINGS]).getJSONObject("state").getString("language"))
        assertEquals(source["staysound-auth"], legacy()["staysound-auth"])
        assertEquals(source["lyrics-%C3%89dith%20%2F%20Song"], legacy()["lyrics-%C3%89dith%20%2F%20Song"])
        close()
        val legacySession = LegacyStorageSession.open(context.filesDir)
        try { assertNotNull(legacySession.getItem(LegacyCodec.LIBRARY)) } finally { legacySession.close() }
        val again = open(); again.importLegacyAtStartup()
        assertEquals("Renamed", again.library.snapshot().tracks.single().title)
    }
    @Test fun dataSurvivesNativeProcessRestartAndImportDoesNotOverwriteChanges() = runBlocking {
        seed(); open().importLegacyAtStartup(); runtime!!.settings.setLanguage("es"); runtime!!.library.upsert(a.copy(title = "Kept")); close()
        val data = open(); data.importLegacyAtStartup()
        assertEquals("es", data.settings.read().language)
        assertEquals("Kept", data.library.snapshot().tracks.single().title)
    }
    @Test fun incompatibleRuntimeAndDuplicateDataStoreAreBlockedBeforeHydration() = runBlocking {
        seed(); val legacy = LegacyStorageSession.open(context.filesDir)
        try { throws { open() } } finally { legacy.close() }
        val data = open(); data.importLegacyAtStartup()
        throws { LegacyStorageSession.open(context.filesDir) }
        throws { StaySoundData.open(context) }
        close()
        throws { LegacyStorageSession.open(context.filesDir) }
    }
    @Test fun malformedLibraryDoesNotBecomeEmptyData() = runBlocking {
        seed(fixture() + (LegacyCodec.LIBRARY to "{bad"))
        val data = open()
        try { data.importLegacyAtStartup(); fail() } catch (expected: org.json.JSONException) { }
        assertEquals("{bad", legacy()[LegacyCodec.LIBRARY])
        throws { data.library.snapshot() }
        close()
        LegacyStorageSession.open(context.filesDir).close()
    }
    @Test fun everyImportBoundaryRecoversAfterProcessDeath() = runBlocking {
        for (target in listOf(MigrationCheckpoint.IMPORT_STARTED, MigrationCheckpoint.ROOM_IMPORTED, MigrationCheckpoint.SETTINGS_IMPORTED, MigrationCheckpoint.NATIVE_COMMITTED)) {
            setup(); seed()
            val data = open { if (it == target) error("Simulated process death") }
            throws { data.importLegacyAtStartup() }; close()
            val recovered = open(); recovered.recoverInterruptedMigration()
            assertEquals(listOf(a), recovered.library.snapshot().tracks)
            assertEquals(listOf(b, a), recovered.library.history.first())
            close()
        }
    }
    @Test fun everyRollbackBoundaryRecoversWithoutRevertingNativeEdits() = runBlocking {
        for (target in listOf(MigrationCheckpoint.EXPORT_READY, MigrationCheckpoint.EXPORT_STARTED, MigrationCheckpoint.FILE_EXPORTED, MigrationCheckpoint.ARTIST_CACHE_EXPORTED, MigrationCheckpoint.LEGACY_COMMITTED)) {
            setup(); seed()
            var armed = false
            val data = open { if (armed && it == target) error("Simulated process death") }
            data.importLegacyAtStartup(); data.settings.setLanguage("es"); data.library.upsert(a.copy(title = "Newer")); armed = true
            throws { data.exportForLegacyAtShutdown() }; close()
            val recovered = open(); recovered.recoverInterruptedMigration(); recovered.exportForLegacyAtShutdown(); close()
            assertEquals("Newer", LegacyImport.parse(legacy()).tracks.single().track.title)
            assertEquals("es", LegacyCodec.settingsEnvelope(legacy()[LegacyCodec.SETTINGS]).getJSONObject("state").getString("language"))
        }
    }
    @Test fun damagedBackupNeverActivatesPartialMigration() = runBlocking {
        seed(); val data = open { if (it == MigrationCheckpoint.IMPORT_STARTED) error("Simulated process death") }
        throws { data.importLegacyAtStartup() }; close()
        val imports = File(context.filesDir, "staysound-core/imports").listFiles()!!.single()
        File(imports, "${LegacyCodec.LIBRARY}.json").writeText("{}")
        val recovered = open(); throws { recovered.recoverInterruptedMigration() }; throws { recovered.library.snapshot() }
        assertEquals(fixture(), legacy())
        recovered.cancelInterruptedImport()
        close()
        LegacyStorageSession.open(context.filesDir).close()
    }
    @Test fun concurrentFavoritesRemainAtomicWithLikedPlaylist() = runBlocking {
        seed(); val data = open(); data.importLegacyAtStartup()
        coroutineScope { repeat(20) { launch(Dispatchers.Default) { data.library.toggleFavorite(a.id) } } }
        val catalog = data.library.snapshot()
        assertEquals(true, catalog.tracks.single().favorite)
        assertEquals(listOf(a.id), catalog.playlists.first { it.id == "playlist_liked" }.trackIds)
    }
    @Test fun readOnlyPlaylistAndMissingReferencesArePreserved() = runBlocking {
        seed(); val data = open(); data.importLegacyAtStartup()
        throws { data.library.addToPlaylist("a", a.id) }
        data.library.removeTrack(a.id)
        assertEquals(listOf("missing", b.id), data.library.snapshot().playlists.first().trackIds)
        assertEquals(listOf(b, a), data.library.history.first())
    }
    @Test fun downloadAndTrackPublishTogetherAndRollbackDoesNotTouchAudio() = runBlocking {
        seed(); val audio = File(context.filesDir, "song.flac").apply { writeBytes(byteArrayOf(102, 76, 97, 67)) }
        val data = open(); data.importLegacyAtStartup()
        val track = a.copy(id = "new", uri = audio.toURI().toString(), downloadedAt = 999)
        data.library.completeDownload(Download("job", track.id, DownloadStatus.COMPLETED, 4, 4, track.uri, updatedAt = 999), track)
        assertEquals(track, data.library.track("new"))
        assertEquals(2, data.library.downloads.first().size)
        data.exportForLegacyAtShutdown()
        assertTrue(audio.exists())
        val restored = LegacyImport.parse(legacy())
        assertEquals(track, restored.tracks.last().track)
        assertEquals(4L, restored.downloads.first { it.key == "job" }.download.bytesDownloaded)
    }
    @Test fun olderDownloadedTracksWithoutDownloadedAtAreRecovered() = runBlocking {
        val oldTrack = a.copy(downloadedAt = null, source = "tidal")
        val source = fixture().toMutableMap()
        val envelope = LegacyCodec.envelope(source[LegacyCodec.LIBRARY])
        envelope.getJSONObject("state").put("tracks", JSONArray().put(LegacyCodec.pair(oldTrack.id, LegacyCodec.track(oldTrack))))
        source[LegacyCodec.LIBRARY] = envelope.toString()
        seed(source)
        val data = open(); data.importLegacyAtStartup()
        assertEquals(oldTrack, data.library.snapshot().tracks.single())
        assertEquals(oldTrack.dateAdded, data.library.downloads.first().single().updatedAt)
    }
    @Test fun legacySettingsEnableLrcRedAndVersionOnePreservesDisabledSources() = runBlocking {
        seed(); val data = open(); data.importLegacyAtStartup()
        assertEquals(listOf("lrc-red", "apple", "lrclib"), data.settings.read().lyricsSources)
        data.settings.setLyricsSourceEnabled("lrc-red", false)
        assertEquals(listOf("apple", "lrclib"), data.settings.read().lyricsSources)
        close()
        assertEquals(listOf("apple", "lrclib"), open().settings.read().lyricsSources)
    }
    @Test fun nativeStorageAcceptsSettingsV1AndRejectsUnknownVersions() = runBlocking {
        seed(); val data = open(); data.importLegacyAtStartup()
        val storage = data.documents
        val state = JSONObject().put("lyricsSources", JSONArray(listOf("lrc-red", "lrclib")))
        val document = JSONObject().put("state", state).put("version", 1)
        storage.set(LegacyCodec.SETTINGS, document.toString())
        assertEquals(listOf("lrc-red", "lrclib"), data.settings.read().lyricsSources)
        try {
            storage.set(LegacyCodec.SETTINGS, document.put("version", 2).toString())
            fail("Unknown settings version must be rejected")
        } catch (_: IllegalArgumentException) { }
        assertEquals(listOf("lrc-red", "lrclib"), data.settings.read().lyricsSources)
    }
    @Test fun settingsEditsKeepUnknownSettingsAndLastLyricsProvider() = runBlocking {
        seed(); val data = open(); data.importLegacyAtStartup()
        data.settings.setLyricsSourceEnabled("lrc-red", false)
        data.settings.setLyricsSourceEnabled("apple", false)
        data.settings.setLyricsSourceEnabled("lrclib", false)
        assertEquals(listOf("lrclib"), data.settings.read().lyricsSources)
        data.settings.setLyricsFont("invalid")
        data.settings.setSpectrumDelay(1000)
        data.settings.setAppearance("material3", "dark", "#112233", false, true, "expressive")
        data.settings.setEqualizer(EqualizerSettings("system", true, "flat", mapOf("100" to 2.0)))
        data.exportForLegacyAtShutdown()
        val settings = LegacyCodec.settingsEnvelope(legacy()[LegacyCodec.SETTINGS]).getJSONObject("state")
        assertEquals("classic", settings.getString("lyricsFont"))
        assertEquals(650, settings.getInt("spectrumDelayMs"))
        assertEquals("dark", settings.getString("mode"))
        assertEquals("[1,2]", settings.getJSONArray("futureSetting").toString())
    }
    @Test fun legacyWritesAreAtomicAndUnsafeKeysCannotEscapeStorage() = runBlocking {
        val legacy = LegacyStorageSession.open(context.filesDir)
        try {
            atomicWrite(File(context.filesDir, "storage/lyrics-Édith.json"), "original".toByteArray())
            assertEquals("original", legacy.getItem("lyrics-%C3%89dith"))
            legacy.setItem("lyrics-%C3%89dith", "one")
            legacy.setItem("lyrics-%C3%89dith", "two")
            assertEquals("two", legacy.getItem("lyrics-%C3%89dith"))
            try { legacy.setItem("../escape", "bad"); fail() } catch (expected: IllegalArgumentException) { }
            try { legacy.setItem("%2E%2E%2Fescape", "bad"); fail() } catch (expected: IllegalArgumentException) { }
            legacy.removeItem("lyrics-%C3%89dith")
            assertNull(legacy.getItem("lyrics-%C3%89dith"))
        } finally { legacy.close() }
        assertFalse(File(context.filesDir, "escape.json").exists())
    }
    @Test fun artistSnapshotReadsCommittedWalBeforeCheckpoint() {
        val file = File(context.filesDir, "SQLite/staysound.db")
        file.parentFile!!.mkdirs()
        android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            db.enableWriteAheadLogging()
            db.rawQuery("PRAGMA wal_autocheckpoint=0", null).use { assertTrue(it.moveToFirst()) }
            db.execSQL("CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT UNIQUE, photo_url TEXT, biography TEXT, timestamp INTEGER)")
            db.execSQL("INSERT INTO artists VALUES (1,'WAL artist','https://photo','Committed in WAL',42)")
            assertTrue(File(file.path + "-wal").length() > 0)
            val snapshot = ArtistCache.decode(ArtistCache.snapshot(context.filesDir))
            assertEquals("Committed in WAL", snapshot.single().biography)
        }
    }
    @Test fun artistSqliteWalCacheMigratesAndExportsLatestMetadata() = runBlocking {
        seed()
        val sqliteFile = File(context.filesDir, "SQLite/staysound.db")
        sqliteFile.parentFile!!.mkdirs()
        android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(sqliteFile, null).use { db ->
            db.enableWriteAheadLogging()
            db.execSQL("CREATE TABLE artists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, photo_url TEXT, biography TEXT, timestamp INTEGER NOT NULL, future TEXT)")
            db.execSQL("INSERT INTO artists (id,name,photo_url,biography,timestamp,future) VALUES (31,'Édith','https://old','Old biography',1,'preserve')")
        }
        val data = open(); data.importLegacyAtStartup()
        assertEquals("Old biography", data.library.artistInfo("Édith")!!.biography)
        assertEquals("https://old", data.library.snapshot().artists.single().artwork)
        data.library.updateArtistInfo(ArtistInfo("Édith", "https://new", "New biography", 222))
        data.exportForLegacyAtShutdown()
        android.database.sqlite.SQLiteDatabase.openDatabase(sqliteFile.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT id,biography,future FROM artists WHERE name='Édith'", null).use { cursor ->
                assertTrue(cursor.moveToFirst()); assertEquals(31, cursor.getInt(0)); assertEquals("New biography", cursor.getString(1)); assertEquals("preserve", cursor.getString(2))
            }
        }
        close()
        val again = open(); again.importLegacyAtStartup()
        assertEquals("New biography", again.library.artistInfo("Édith")!!.biography)
    }
    @Test fun emptyInstallCanMigrateAndRollback() = runBlocking {
        val data = open(); data.importLegacyAtStartup()
        assertTrue(data.library.snapshot().tracks.isEmpty())
        assertEquals("es", data.settings.read().language)
        data.exportForLegacyAtShutdown()
        assertTrue(LegacyImport.parse(legacy()).tracks.isEmpty())
    }
}
