package app.staysound.core.data

import android.content.Context
import androidx.room.withTransaction

/**
 * Room/DataStore-backed implementation of the JavaScript persistence contract. The JS stores keep their
 * logic for now, but every document they load or save is owned by Kotlin: collections become rows, the rest
 * stays in DataStore or opaque documents. Writes are diffed so a persist of a large library rewrites only
 * what changed.
 */
internal class NativeDocuments(
    private val db: LibraryDatabase, private val settings: SettingsRepository,
    private val ownership: StorageOwnership, private val migration: DataMigration,
) {
    // Guarded by the ownership mutex. Rebuilt lazily because JS reads each document once, at hydration.
    private var exported: Map<String, String>? = null
    private val emptyEnvelope = """{"state":{},"version":0}"""

    suspend fun get(name: String): String? = ownership.native {
        (exported ?: migration.exportDocuments().also { exported = it })[name]
    }

    suspend fun set(name: String, value: String) = ownership.native {
        exported = null
        when (name) {
            LegacyCodec.LIBRARY -> writeLibrary(value)
            LegacyCodec.PLAYER -> writePlayer(value)
            LegacyCodec.SETTINGS, ONBOARDING -> { LegacyCodec.envelope(value); settings.put(name, value) }
            LegacyCodec.DOWNLOADS -> error("Downloads are owned by Kotlin and cannot be written by JavaScript")
            ArtistCache.DOCUMENT -> writeArtists(value)
            else -> db.library().putDocuments(listOf(DocumentRow("opaque:$name", value)))
        }
    }

    suspend fun remove(name: String) = ownership.native {
        exported = null
        when (name) {
            LegacyCodec.LIBRARY -> writeLibrary(emptyEnvelope)
            LegacyCodec.PLAYER -> writePlayer(emptyEnvelope)
            LegacyCodec.SETTINGS, ONBOARDING -> settings.remove(name)
            LegacyCodec.DOWNLOADS, ArtistCache.DOCUMENT -> error("$name is owned by Kotlin and cannot be removed by JavaScript")
            else -> db.library().deleteDocument("opaque:$name")
        }
    }

    private suspend fun writeLibrary(value: String) {
        // Parse before touching Room: a malformed document must never turn into an empty library.
        val incoming = LegacyImport.parse(mapOf(LegacyCodec.LIBRARY to value))
        db.withTransaction {
            val dao = db.library()
            val tracks = dao.tracks().associateBy { it.key }
            val keep = incoming.tracks.mapTo(HashSet()) { it.key }
            tracks.keys.filterNot { it in keep }.forEach { dao.deleteTrack(it) }
            dao.putTracks(incoming.tracks.filter { tracks[it.key] != it })

            val playlists = dao.playlists().associateBy { it.row.id }
            val kept = incoming.playlists.mapTo(HashSet()) { it.id }
            playlists.keys.filterNot { it in kept }.forEach { dao.deletePlaylist(it) }
            incoming.playlists.forEachIndexed { index, playlist ->
                val existing = playlists[playlist.id]
                if (existing != null && existing.row.ordinal == index && existing.model() == playlist) return@forEachIndexed
                dao.putPlaylist(playlist.row(index)); dao.deleteEntries(playlist.id)
                dao.putEntries(playlist.trackIds.mapIndexed { position, id -> PlaylistEntry(playlist.id, position, id) })
            }

            if (dao.cloudTracks().toSet() != incoming.cloud.toSet()) { dao.clearCloudTracks(); dao.putCloudTracks(incoming.cloud) }
            dao.putDocuments(incoming.documents)
        }
    }

    private suspend fun writePlayer(value: String) {
        val incoming = LegacyImport.parse(mapOf(LegacyCodec.PLAYER to value))
        db.withTransaction {
            val dao = db.library()
            if (dao.history() != incoming.history) { dao.clearHistory(); dao.putHistory(incoming.history) }
        }
        settings.put(LegacyCodec.PLAYER, checkNotNull(incoming.preferences[LegacyCodec.PLAYER]))
    }

    private suspend fun writeArtists(value: String) {
        val rows = ArtistCache.decode(value)
        db.withTransaction { val dao = db.library(); dao.clearArtistInfo(); dao.putArtistInfo(rows) }
    }

    private companion object { const val ONBOARDING = "staysound-onboarding" }
}

/** What the JavaScript runtime talks to when Kotlin owns user data. `data` is the one shared graph for Kotlin consumers. */
class NativeStorageSession internal constructor(val data: StaySoundData) : StorageAuthority {
    override suspend fun getItem(name: String) = data.documents.get(name)
    override suspend fun setItem(name: String, value: String) = data.documents.set(name, value)
    override suspend fun removeItem(name: String) = data.documents.remove(name)
    override suspend fun close() = data.close()
}

/**
 * Chooses the runtime that owns storage for this process. Native mode imports the legacy files once (originals stay
 * frozen as a backup). Legacy mode after a native run exports the current data back first, so switching a build
 * flag never strands the user's changes.
 */
object StorageBootstrap {
    suspend fun open(context: Context, nativeData: Boolean): StorageAuthority {
        if (nativeData) {
            val data = StaySoundData.open(context)
            try {
                data.recoverInterruptedMigration()
                data.importLegacyAtStartup()
            } catch (error: Throwable) {
                runCatching { data.close() }
                throw error
            }
            return NativeStorageSession(data)
        }
        val filesDir = context.applicationContext.filesDir
        if (peekOwner(filesDir) != Owner.LEGACY) {
            val data = StaySoundData.open(context)
            try {
                data.recoverInterruptedMigration()
                data.exportForLegacyAtShutdown()
            } finally { data.close() }
        }
        return LegacyStorageSession.open(filesDir)
    }
}
