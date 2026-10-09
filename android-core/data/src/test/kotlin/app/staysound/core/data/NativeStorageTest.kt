package app.staysound.core.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.staysound.core.model.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeStorageTest {
    private lateinit var context: Context
    private var authority: StorageAuthority? = null
    private val a = Track("ms_1", "content://media/1", "Niña 🎵", "Édith", "Álbum", 1000, 10, favorite = true,
        extensions = mapOf("future" to "{\"a\":[1,true]}"))
    private val b = Track("ms_2", "content://media/2", "Second", "Artist", "Other", 2000, 20)
    @Before fun setup() {
        context = ApplicationProvider.getApplicationContext()
        File(context.filesDir, "storage").deleteRecursively()
        File(context.filesDir, "staysound-core").deleteRecursively()
        context.deleteDatabase("staysound-core-v1.db")
        File(context.filesDir, "SQLite").deleteRecursively()
    }
    @After fun tearDown() = runBlocking { authority?.close(); authority = null }

    private fun envelope(state: JSONObject) = JSONObject().put("state", state).put("version", 0).toString()
    private fun library(tracks: List<Track>, playlists: List<Playlist> = emptyList()) = envelope(JSONObject()
        .put("tracks", JSONArray().apply { tracks.forEach { put(LegacyCodec.pair(it.id, LegacyCodec.track(it))) } })
        .put("playlists", JSONArray().apply { playlists.forEach { put(LegacyCodec.pair(it.id, LegacyCodec.playlist(it))) } })
        .put("cloudPlaylistTracks", JSONArray()).put("lastScanDate", 7).put("unknown", "kept"))
    private fun player(history: List<Track>, volume: Double = 0.5) = envelope(JSONObject()
        .put("recentlyPlayed", JSONArray().apply { history.forEach { put(LegacyCodec.track(it)) } }).put("volume", volume))
    private fun seed(name: String, value: String) = atomicWrite(File(context.filesDir, "storage/$name.json"), value.toByteArray())
    private fun legacyFile(name: String) = File(context.filesDir, "storage/$name.json").takeIf { it.exists() }?.readText()
    private suspend fun open(native: Boolean) = StorageBootstrap.open(context, native).also { authority = it }
    private suspend fun close() { authority!!.close(); authority = null }
    private fun data() = (authority as NativeStorageSession).data
    private fun state(raw: String?) = JSONObject(raw!!).getJSONObject("state")
    private fun tracksOf(raw: String?) = LegacyImport.parse(mapOf(LegacyCodec.LIBRARY to raw!!)).tracks.map { it.track }

    @Test fun nativeModeServesTheImportedLegacyDocumentsAndKeepsTheOriginalsFrozen() = runBlocking {
        val original = library(listOf(a, b), listOf(Playlist("p", "Mix", listOf(a.id, b.id), 1, 2)))
        seed(LegacyCodec.LIBRARY, original); seed(LegacyCodec.PLAYER, player(listOf(b, a)))
        seed("lyrics-%C3%89dith", "{\"lyrics\":[]}")
        val session = open(true)
        assertEquals(listOf(a, b), tracksOf(session.getItem(LegacyCodec.LIBRARY)))
        assertEquals("kept", state(session.getItem(LegacyCodec.LIBRARY)).getString("unknown"))
        assertEquals(listOf(b.id, a.id), state(session.getItem(LegacyCodec.PLAYER)).getJSONArray("recentlyPlayed").let { r -> (0 until r.length()).map { r.getJSONObject(it).getString("id") } })
        assertEquals("{\"lyrics\":[]}", session.getItem("lyrics-%C3%89dith"))
        assertNull(session.getItem("never-written"))
        assertEquals(original, legacyFile(LegacyCodec.LIBRARY))
        assertEquals(listOf(a, b), data().library.snapshot().tracks)
    }

    @Test fun libraryWritesAreDiffedIntoRoomAndVisibleToKotlinConsumers() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a, b)))
        val session = open(true)
        val renamed = a.copy(title = "Renamed", favorite = false)
        val added = Track("ms_3", "content://media/3", "Third", "Artist", "Other", 3000, 30)
        val liked = Playlist("playlist_liked", "Me gusta", listOf(added.id, a.id), 5, 6)
        session.setItem(LegacyCodec.LIBRARY, library(listOf(added, renamed), listOf(liked)))   // b removed, a edited, c added, order changed
        val catalog = data().library.snapshot()
        assertEquals(listOf(added, renamed), catalog.tracks)
        assertEquals(listOf(added.id, a.id), catalog.playlists.single().trackIds)
        assertEquals(listOf(added, renamed), tracksOf(session.getItem(LegacyCodec.LIBRARY)))
        assertEquals("kept", state(session.getItem(LegacyCodec.LIBRARY)).getString("unknown"))
        // Removing a playlist cascades its entries.
        session.setItem(LegacyCodec.LIBRARY, library(listOf(added, renamed)))
        assertTrue(data().library.snapshot().playlists.isEmpty())
    }

    @Test fun aScanInProgressNeverWipesTheLibrary() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a, b)))
        val session = open(true)
        // The JS store persists an empty track list plus a marker while a scan is running.
        val scanning = JSONObject(library(emptyList(), listOf(Playlist("p", "Mix", listOf(a.id), 1, 2)))).apply {
            getJSONObject("state").put("scanInProgress", true)
        }.toString()
        session.setItem(LegacyCodec.LIBRARY, scanning)
        assertEquals(listOf(a, b), data().library.snapshot().tracks)
        assertEquals(listOf(a.id), data().library.snapshot().playlists.single().trackIds)
        assertFalse(state(session.getItem(LegacyCodec.LIBRARY)).has("scanInProgress"))
        assertEquals(listOf(a, b), tracksOf(session.getItem(LegacyCodec.LIBRARY)))
        // The finished scan persists the real result, which is now applied (b was deleted from disk).
        session.setItem(LegacyCodec.LIBRARY, library(listOf(a)))
        assertEquals(listOf(a), data().library.snapshot().tracks)
        // Outside a scan an empty library is a deliberate clear.
        session.setItem(LegacyCodec.LIBRARY, library(emptyList()))
        assertTrue(data().library.snapshot().tracks.isEmpty())
    }

    @Test fun aFinishedScanKeepsKnownMetadataAndReplacesTheRest() = runBlocking {
        val known = Track("saf_1", "content://saf/Artist%20-%20Album%20-%20Real%20Title.flac", "Real Title", "Artist", "Album", 1000, 5,
            favorite = true, artwork = "https://img/a.jpg", artworkThumb = "file:///t.jpg")
        val gone = Track("gone", "content://media/9", "Gone", "Nobody", "Nothing", 1000, 6)
        seed(LegacyCodec.LIBRARY, library(listOf(known, gone), listOf(Playlist("p", "Mix", listOf(known.id, gone.id), 1, 2))))
        open(true)
        val scan = listOf(
            ScannedTrack(Track("ms_1", "content://media/1", "Unknown", "Unknown Artist", "Unknown Album", 2000, 7, artwork = "content://media/external/audio/albumart/1"),
                "Artist - Album - Real Title.flac"),
            ScannedTrack(Track("ms_2", "content://media/2", "Unknown", "Unknown Artist", "Unknown Album", 3000, 8), "Other - Disc - Fresh.mp3"),
            ScannedTrack(Track("junk", "file:///cache/staysound/downloads/x.flac", "x", "y", "z", 10, 9), null),
        )
        val summary = data().library.applyScan(scan)
        assertEquals(LibraryRepository.ScanSummary(added = 2, updated = 0, removed = 2), summary)
        val catalog = data().library.snapshot()
        assertEquals(listOf("ms_1", "ms_2"), catalog.tracks.map { it.id })
        val first = catalog.tracks.first()
        assertEquals(listOf("Real Title", "Artist", "Album", true, "https://img/a.jpg", "file:///t.jpg"),
            listOf(first.title, first.artist, first.album, first.favorite, first.artwork, first.artworkThumb))
        assertEquals("Fresh", catalog.tracks.last().title)
        assertEquals(listOf(known.id, gone.id), catalog.playlists.single().trackIds)   // playlists are untouched
        // Repeating the same scan changes nothing.
        assertEquals(LibraryRepository.ScanSummary(added = 0, updated = 0, removed = 0), data().library.applyScan(scan))
    }

    @Test fun malformedWritesAreRejectedWithoutTouchingTheLibrary() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a)))
        val session = open(true)
        try { session.setItem(LegacyCodec.LIBRARY, "{bad"); fail() } catch (expected: org.json.JSONException) { }
        try { session.setItem(LegacyCodec.LIBRARY, envelope(JSONObject().put("tracks", JSONArray().put(LegacyCodec.pair("wrong", LegacyCodec.track(a)))))); fail() }
        catch (expected: IllegalArgumentException) { }
        assertEquals(listOf(a), data().library.snapshot().tracks)
        try { session.setItem(LegacyCodec.DOWNLOADS, "{}"); fail() } catch (expected: IllegalStateException) { }
    }

    @Test fun playerSettingsOnboardingAndOpaqueDocumentsRoundTripAndSurviveRestart() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a)))
        val session = open(true)
        session.setItem(LegacyCodec.PLAYER, player(listOf(a, b), volume = 0.9))
        session.setItem(LegacyCodec.SETTINGS, envelope(JSONObject().put("language", "en")))
        session.setItem("staysound-onboarding", envelope(JSONObject().put("hasCompletedOnboarding", true)))
        session.setItem("staysound-auth", "{\"secret\":\"opaque\"}")
        assertEquals(listOf(a, b), data().library.history.first())
        assertEquals("en", data().settings.read().language)
        close()

        val again = open(true)
        assertEquals(0.9, state(again.getItem(LegacyCodec.PLAYER)).getDouble("volume"), 0.0)
        assertEquals(2, state(again.getItem(LegacyCodec.PLAYER)).getJSONArray("recentlyPlayed").length())
        assertTrue(state(again.getItem("staysound-onboarding")).getBoolean("hasCompletedOnboarding"))
        assertEquals("{\"secret\":\"opaque\"}", again.getItem("staysound-auth"))
        again.removeItem("staysound-auth")
        assertNull(again.getItem("staysound-auth"))
        again.removeItem(LegacyCodec.PLAYER)
        assertEquals(0, state(again.getItem(LegacyCodec.PLAYER)).optJSONArray("recentlyPlayed")?.length() ?: 0)
        assertTrue(data().library.history.first().isEmpty())
    }

    @Test fun disablingTheFlagExportsTheLatestNativeDataBackToLegacy() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a, b)))
        seed("staysound-auth", "{\"secret\":\"opaque\"}")
        val session = open(true)
        session.setItem(LegacyCodec.LIBRARY, library(listOf(b, a.copy(title = "Edited"))))
        session.setItem("staysound-auth", "{\"secret\":\"newer\"}")
        close()

        val legacy = open(false)
        assertTrue(authority is LegacyStorageSession)
        assertEquals(listOf(b, a.copy(title = "Edited")), tracksOf(legacy.getItem(LegacyCodec.LIBRARY)))
        assertEquals("{\"secret\":\"newer\"}", legacy.getItem("staysound-auth"))
        close()

        // Flipping back re-imports the exported files and nothing is lost either way.
        val native = open(true)
        assertEquals(listOf(b, a.copy(title = "Edited")), data().library.snapshot().tracks)
        assertEquals("{\"secret\":\"newer\"}", native.getItem("staysound-auth"))
    }

    @Test fun legacyModeIsUntouchedWhenNativeWasNeverEnabled() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a)))
        val legacy = open(false)
        assertTrue(authority is LegacyStorageSession)
        legacy.setItem(LegacyCodec.LIBRARY, library(listOf(a, b)))
        assertEquals(listOf(a, b), tracksOf(legacyFile(LegacyCodec.LIBRARY)))
        assertFalse(File(context.filesDir, "staysound-core/ownership.json").exists())
    }

    @Test fun rollbackNeverReplacesNewerArtistRowsThatJavaScriptKeptWriting() = runBlocking {
        seed(LegacyCodec.LIBRARY, library(listOf(a)))
        val sqlite = File(context.filesDir, "SQLite/staysound.db").apply { parentFile!!.mkdirs() }
        android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(sqlite, null).use { db ->
            db.execSQL("CREATE TABLE artists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, photo_url TEXT, biography TEXT, timestamp INTEGER NOT NULL)")
            db.execSQL("INSERT INTO artists (name, photo_url, biography, timestamp) VALUES ('Édith', 'old', 'bio', 100)")
        }
        open(true); close()
        // The JS runtime keeps updating expo-sqlite directly while Kotlin owns everything else.
        android.database.sqlite.SQLiteDatabase.openDatabase(sqlite.path, null, 0).use { db ->
            db.execSQL("UPDATE artists SET photo_url = 'newer', timestamp = 500 WHERE name = 'Édith'")
        }
        open(false)
        android.database.sqlite.SQLiteDatabase.openDatabase(sqlite.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT photo_url, timestamp FROM artists WHERE name = 'Édith'", null).use { c ->
                assertTrue(c.moveToFirst()); assertEquals("newer", c.getString(0)); assertEquals(500L, c.getLong(1))
            }
        }
    }
}
