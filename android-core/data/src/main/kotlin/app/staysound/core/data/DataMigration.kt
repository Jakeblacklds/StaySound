package app.staysound.core.data

import android.util.AtomicFile
import androidx.room.withTransaction
import app.staysound.core.model.DownloadStatus
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Checkpoints are also used to test process-death recovery at each durable boundary. */
internal enum class MigrationCheckpoint { BACKUP_READY, IMPORT_STARTED, ROOM_IMPORTED, SETTINGS_IMPORTED, NATIVE_COMMITTED, EXPORT_READY, EXPORT_STARTED, FILE_EXPORTED, ARTIST_CACHE_EXPORTED, LEGACY_COMMITTED }

internal class DataMigration(
    private val db: LibraryDatabase, private val settings: SettingsRepository,
    private val ownership: StorageOwnership,
    private val checkpoint: (MigrationCheckpoint) -> Unit = {},
) {
    private val storage = File(ownership.filesDir, "storage")
    suspend fun activate() = ownership.exclusive {
        when (ownership.read().owner) {
            Owner.NATIVE -> return@exclusive
            Owner.EXPORTING -> error("Rollback must finish before another import")
            Owner.IMPORTING -> importSnapshot(ownership.read().generation!!)
            Owner.LEGACY -> {
                val files = readLegacy()
                LegacyImport.parse(files) // Parse all user collections before touching either destination.
                val generation = UUID.randomUUID().toString()
                writeSnapshot("imports", generation, files)
                checkpoint(MigrationCheckpoint.BACKUP_READY)
                ownership.write(Ownership(Owner.IMPORTING, generation))
                checkpoint(MigrationCheckpoint.IMPORT_STARTED)
                importSnapshot(generation)
            }
        }
    }
    suspend fun cancelInterruptedImport() = ownership.exclusive {
        val state = ownership.read()
        check(state.owner == Owner.IMPORTING) { "Only an uncommitted import can be cancelled" }
        val manifest = JSONObject(AtomicFile(File(snapshotDir("imports", state.generation!!), "manifest")).readFully().toString(Charsets.UTF_8))
        val originals = readLegacy()
        check(originals.keys == manifest.keys().asSequence().toSet()) { "Original file set changed during import" }
        originals.forEach { (name, value) ->
            check(sha256(value.toByteArray()) == manifest.getString(name)) { "Original data changed during import" }
        }
        // Room/DataStore staging is inaccessible in legacy mode and is replaced on the next import.
        ownership.write(Ownership(Owner.LEGACY, state.generation))
    }
    suspend fun recover() = ownership.exclusive {
        when (ownership.read().owner) {
            Owner.IMPORTING -> importSnapshot(ownership.read().generation!!)
            Owner.EXPORTING -> finishExport(ownership.read().generation!!)
            else -> Unit
        }
    }
    private suspend fun importSnapshot(generation: String) {
        val source = readSnapshot("imports", generation)
        val data = LegacyImport.parse(source)
        db.withTransaction {
            val dao = db.library()
            dao.clearArtistInfo(); dao.clearPlaylists(); dao.clearTracks(); dao.clearCloudTracks(); dao.clearHistory(); dao.clearDownloads(); dao.clearDocuments()
            dao.putTracks(data.tracks); dao.putArtistInfo(data.artistInfo)
            data.playlists.forEachIndexed { index, playlist ->
                dao.putPlaylist(playlist.row(index))
                dao.putEntries(playlist.trackIds.mapIndexed { position, id -> PlaylistEntry(playlist.id, position, id) })
            }
            dao.putCloudTracks(data.cloud); dao.putHistory(data.history); dao.putDownloads(data.downloads); dao.putDocuments(data.documents)
        }
        checkpoint(MigrationCheckpoint.ROOM_IMPORTED)
        settings.replace(data.preferences)
        checkpoint(MigrationCheckpoint.SETTINGS_IMPORTED)
        // Full semantic roundtrip of known records, unknown fields and opaque documents before ownership changes.
        val actual = LegacyImport.parse(exportDocuments())
        check(data == actual) { "Migration verification failed; original files remain authoritative" }
        ownership.write(Ownership(Owner.NATIVE, generation))
        checkpoint(MigrationCheckpoint.NATIVE_COMMITTED)
    }
    suspend fun rollback() = ownership.exclusive {
        when (ownership.read().owner) {
            Owner.LEGACY -> return@exclusive
            Owner.IMPORTING -> error("Recover the interrupted import before rollback")
            Owner.EXPORTING -> finishExport(ownership.read().generation!!)
            Owner.NATIVE -> {
                val active = db.library().downloads().any { it.download.status in setOf(DownloadStatus.RUNNING, DownloadStatus.QUEUED) }
                check(!active) { "Drain downloads before rollback; the legacy client cannot resume native tasks" }
                val documents = exportDocuments()
                LegacyImport.parse(documents)
                val generation = UUID.randomUUID().toString()
                writeSnapshot("exports", generation, documents)
                checkpoint(MigrationCheckpoint.EXPORT_READY)
                ownership.write(Ownership(Owner.EXPORTING, generation))
                checkpoint(MigrationCheckpoint.EXPORT_STARTED)
                finishExport(generation)
            }
        }
    }
    private fun finishExport(generation: String) {
        val documents = readSnapshot("exports", generation)
        documents.forEach { (name, value) ->
            atomicWrite(File(storage, "$name.json"), value.toByteArray())
            checkpoint(MigrationCheckpoint.FILE_EXPORTED)
        }
        documents.forEach { (name, expected) ->
            check(AtomicFile(File(storage, "$name.json")).readFully().toString(Charsets.UTF_8) == expected)
        }
        documents[ArtistCache.DOCUMENT]?.let { ArtistCache.restore(ownership.filesDir, it) }
        checkpoint(MigrationCheckpoint.ARTIST_CACHE_EXPORTED)
        ownership.write(Ownership(Owner.LEGACY, generation))
        checkpoint(MigrationCheckpoint.LEGACY_COMMITTED)
    }
    private suspend fun exportDocuments(): Map<String, String> = db.withTransaction {
        val dao = db.library()
        val result = settings.documents().toMutableMap()
        val storedDocuments = dao.documents()
        storedDocuments.filter { it.name.startsWith("opaque:") }.forEach { result[it.name.removePrefix("opaque:")] = it.json }
        val library = LegacyCodec.envelope(dao.documents().firstOrNull { it.name == LegacyCodec.LIBRARY }?.json)
        val state = library.getJSONObject("state")
        state.put("tracks", JSONArray().apply { dao.tracks().forEach { put(LegacyCodec.pair(it.key, LegacyCodec.track(it.track))) } })
        state.put("playlists", JSONArray().apply { dao.playlists().forEach { put(LegacyCodec.pair(it.row.id, LegacyCodec.playlist(it.model()))) } })
        // Empty cloud containers may carry references in old libraries: retain their original keys as metadata.
        state.put("cloudPlaylistTracks", JSONArray().apply {
            val cloud = dao.cloudTracks().groupBy { it.playlistId }
            val keys = (JSONArray(storedDocuments.firstOrNull { it.name == "cloud-order" }?.json ?: "[]").let(LegacyCodec::strings) + cloud.keys).distinct()
            keys.forEach { key -> put(LegacyCodec.pair(key, JSONArray().apply {
                cloud[key].orEmpty().forEach { put(LegacyCodec.pair(it.key, LegacyCodec.track(it.track))) }
            })) }
        })
        result[LegacyCodec.LIBRARY] = library.toString()
        val player = LegacyCodec.envelope(result[LegacyCodec.PLAYER])
        player.getJSONObject("state").put("recentlyPlayed", JSONArray().apply { dao.history().forEach { put(LegacyCodec.track(it.track)) } })
        result[LegacyCodec.PLAYER] = player.toString()
        result[ArtistCache.DOCUMENT] = ArtistCache.encode(dao.artistInfo())
        result[LegacyCodec.DOWNLOADS] = JSONObject().put("version", 1).put("downloads", JSONArray().apply {
            dao.downloads().sortedBy { it.key }.forEach { row ->
                val d = row.download
                put(JSONObject().put("id", d.id).put("trackId", d.trackId).put("status", d.status.name)
                    .put("bytesDownloaded", d.bytesDownloaded).put("totalBytes", d.totalBytes ?: JSONObject.NULL)
                    .put("uri", d.uri ?: JSONObject.NULL).put("error", d.error ?: JSONObject.NULL).put("updatedAt", d.updatedAt))
            }
        }).toString()
        result
    }
    private fun readLegacy(): Map<String, String> {
        if (!storage.exists()) return ArtistCache.snapshot(ownership.filesDir)?.let { mapOf(ArtistCache.DOCUMENT to it) } ?: emptyMap()
        check(storage.isDirectory)
        // AtomicFile backups belong to the same logical entry and must be recovered before snapshotting.
        val names = storage.walkTopDown().onEnter { dir ->
            check(dir.canonicalPath == storage.canonicalPath || dir.canonicalPath.startsWith(storage.canonicalPath + File.separator))
            true
        }.filter { it.isFile && (it.name.endsWith(".json") || it.name.endsWith(".json.bak")) }
            .map { it.relativeTo(storage).path.removeSuffix(".bak").removeSuffix(".json") }.distinct().toList()
        return names.associateWith { name -> AtomicFile(File(storage, "$name.json")).readFully().toString(Charsets.UTF_8) }.toMutableMap().apply {
            ArtistCache.snapshot(ownership.filesDir)?.let { put(ArtistCache.DOCUMENT, it) }
        }
    }
    private fun writeSnapshot(kind: String, generation: String, documents: Map<String, String>) {
        val dir = snapshotDir(kind, generation)
        check(!dir.exists()) { "Snapshot already exists" }
        val manifest = JSONObject()
        documents.forEach { (name, value) ->
            validateKey(name)
            val bytes = value.toByteArray()
            atomicWrite(File(dir, "$name.json"), bytes)
            manifest.put(name, sha256(bytes))
        }
        atomicWrite(File(dir, "manifest"), manifest.toString().toByteArray())
        check(readSnapshot(kind, generation) == documents)
    }
    private fun readSnapshot(kind: String, generation: String): Map<String, String> {
        val dir = snapshotDir(kind, generation)
        val manifest = JSONObject(AtomicFile(File(dir, "manifest")).readFully().toString(Charsets.UTF_8))
        return manifest.keys().asSequence().associateWith { name ->
            validateKey(name)
            val bytes = AtomicFile(File(dir, "$name.json")).readFully()
            check(sha256(bytes) == manifest.getString(name)) { "Migration backup checksum mismatch" }
            bytes.toString(Charsets.UTF_8)
        }
    }
    private fun snapshotDir(kind: String, generation: String): File {
        UUID.fromString(generation) // Do not trust a persisted path.
        return File(ownership.root, "$kind/$generation")
    }
    private fun validateKey(key: String) { require(key.isNotEmpty() && !key.startsWith("/") && key.split('/').none { it == "." || it == ".." } && key.none { it == '\\' || it == '\u0000' }) }
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
