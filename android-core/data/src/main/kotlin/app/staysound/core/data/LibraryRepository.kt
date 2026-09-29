package app.staysound.core.data

import androidx.room.withTransaction
import app.staysound.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.util.UUID

class LibraryRepository internal constructor(private val db: LibraryDatabase, private val ownership: StorageOwnership) {
    private val dao get() = db.library()
    val catalog: Flow<Catalog> = combine(dao.observeTracks(), dao.observePlaylists(), dao.observeArtistInfo()) { _, _, _ -> snapshot() }
    // Re-read in one transaction: independent table invalidations must never publish a torn catalog.
    suspend fun snapshot(): Catalog = ownership.native { db.withTransaction {
        val catalog = catalogOf(dao.tracks().map { it.track }, dao.playlists().map { it.model() })
        val metadata = dao.artistInfo().associateBy { it.name }
        catalog.copy(artists = catalog.artists.map { artist ->
            metadata[artist.name]?.let { artist.copy(artwork = it.photoUrl, biography = it.biography) } ?: artist
        })
    } }
    val history: Flow<List<Track>> = dao.observeHistory().map { rows -> ownership.native { rows.map { it.track } } }
    val downloads: Flow<List<Download>> = dao.observeDownloads().map { rows -> ownership.native { rows.map { it.download } } }
    suspend fun artistInfo(name: String): ArtistInfo? = ownership.native {
        dao.artistInfo(name)?.let { ArtistInfo(it.name, it.photoUrl, it.biography, it.timestamp) }
    }
    suspend fun updateArtistInfo(info: ArtistInfo) = ownership.native { db.withTransaction {
        val existing = dao.artistInfo(info.name)
        dao.putArtistInfo(listOf(ArtistInfoRow(info.name, existing?.legacyId, info.photoUrl, info.biography, info.timestamp)))
    } }
    suspend fun track(id: String): Track? = ownership.native { dao.track(id)?.track }
    suspend fun upsert(track: Track) = ownership.native { db.withTransaction {
        val ordinal = dao.track(track.id)?.ordinal ?: (dao.maxTrackOrdinal() + 1)
        dao.putTracks(listOf(TrackRow(track.id, track, ordinal)))
    } }
    suspend fun createPlaylist(name: String, description: String? = null, artwork: String? = null, now: Long = System.currentTimeMillis()): String = ownership.native {
        require(name.isNotBlank())
        val playlist = Playlist("playlist_${UUID.randomUUID()}", name.trim(), emptyList(), now, now, description, artwork)
        db.withTransaction { writePlaylist(playlist) }
        playlist.id
    }
    suspend fun editPlaylist(id: String, name: String, description: String?, artwork: String?, now: Long = System.currentTimeMillis()) = ownership.native {
        require(name.isNotBlank())
        db.withTransaction {
            val playlist = checkNotNull(dao.playlist(id)).model()
            check(playlist.readonly != true) { "Read-only playlist" }
            writePlaylist(playlist.copy(name = name.trim(), description = description, artwork = artwork, updatedAt = now))
        }
    }
    suspend fun addToPlaylist(id: String, trackId: String, now: Long = System.currentTimeMillis()) = changeEntries(id, now) { if (trackId in it) it else it + trackId }
    suspend fun removeFromPlaylist(id: String, trackId: String, now: Long = System.currentTimeMillis()) = changeEntries(id, now) { it.filterNot { value -> value == trackId } }
    private suspend fun changeEntries(id: String, now: Long, transform: (List<String>) -> List<String>) = ownership.native {
        db.withTransaction {
            val playlist = checkNotNull(dao.playlist(id)).model()
            check(playlist.readonly != true) { "Read-only playlist" }
            writePlaylist(playlist.copy(trackIds = transform(playlist.trackIds), updatedAt = now))
        }
    }
    suspend fun deletePlaylist(id: String) = ownership.native {
        db.withTransaction { check(dao.playlist(id)?.row?.readonly != true); dao.deletePlaylist(id) }
    }
    suspend fun playlistTracks(id: String): List<Track> = ownership.native { db.withTransaction {
        val local = dao.tracks().associateBy { it.key }
        val localTracks = local.values.map { it.track }
        val cloud = dao.cloudTracks(id).associateBy { it.key }
        dao.playlist(id)?.model()?.trackIds?.mapNotNull { local[it]?.track ?: cloud[it]?.track?.let { remote -> localEquivalent(remote, localTracks) ?: remote } } ?: emptyList()
    } }
    suspend fun toggleFavorite(id: String, now: Long = System.currentTimeMillis()) = ownership.native { db.withTransaction {
        val row = checkNotNull(dao.track(id))
        val favorite = row.track.favorite != true
        dao.putTracks(listOf(row.copy(track = row.track.copy(favorite = favorite))))
        val liked = dao.playlist("playlist_liked")?.model() ?: Playlist("playlist_liked", "Me gusta", emptyList(), now, now,
            description = "Canciones que te gustan")
        val ids = if (favorite) listOf(id) + liked.trackIds.filterNot { it == id } else liked.trackIds.filterNot { it == id }
        writePlaylist(liked.copy(trackIds = ids, updatedAt = now))
    } }
    /** Removes a library reference only. Deleting physical media requires a separate explicit operation. */
    suspend fun removeTrack(id: String) = ownership.native { db.withTransaction { dao.deleteTrack(id); dao.deleteTrackEntries(id) } }
    suspend fun recordPlayed(track: Track) = ownership.native { db.withTransaction {
        val next = (listOf(track) + dao.history().map { it.track }.filterNot { it.id == track.id }).take(50)
        dao.clearHistory(); dao.putHistory(next.mapIndexed { index, item -> HistoryRow(index, item) })
    } }
    data class ScanSummary(val added: Int, val updated: Int, val removed: Int)
    /**
     * A finished scan replaces the local catalog with what the device reports, keeping the metadata, artwork and
     * favorites of files the library already knew (see [ScanReconciler]). Playlists are left alone: they may
     * reference files that are temporarily unavailable. One transaction, so a crash never leaves a partial scan.
     */
    suspend fun applyScan(scanned: List<ScannedTrack>): ScanSummary = ownership.native { db.withTransaction {
        val current = dao.tracks().associateBy { it.key }
        val result = ScanReconciler.reconcileAll(current.values.map { it.track }, scanned)
        val kept = result.mapTo(HashSet()) { it.id }
        val removed = current.keys.filterNot { it in kept }
        removed.forEach { dao.deleteTrack(it) }
        val rows = result.mapIndexed { index, track -> TrackRow(track.id, track, index) }
        dao.putTracks(rows.filter { current[it.key] != it })
        ScanSummary(added = result.count { it.id !in current }, updated = rows.count { current[it.key]?.let { old -> old != it } == true }, removed = removed.size)
    } }
    /** Download completion and publication become visible in the same Room transaction. */
    suspend fun completeDownload(download: Download, track: Track) = ownership.native { db.withTransaction {
        require(download.status == DownloadStatus.COMPLETED && download.uri == track.uri && download.trackId == track.id)
        require(track.downloadedAt != null)
        val ordinal = dao.track(track.id)?.ordinal ?: (dao.maxTrackOrdinal() + 1)
        dao.putTracks(listOf(TrackRow(track.id, track, ordinal)))
        dao.putDownloads(listOf(DownloadRow(download.id, download)))
    } }
    internal suspend fun writePlaylist(playlist: Playlist) {
        val ordinal = dao.playlist(playlist.id)?.row?.ordinal ?: (dao.maxPlaylistOrdinal() + 1)
        dao.putPlaylist(playlist.row(ordinal)); dao.deleteEntries(playlist.id)
        dao.putEntries(playlist.trackIds.mapIndexed { index, id -> PlaylistEntry(playlist.id, index, id) })
    }
}
