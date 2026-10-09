package app.staysound.core.data

import androidx.room.*
import app.staysound.core.model.*
import kotlinx.coroutines.flow.Flow
import org.json.JSONObject

@Entity(tableName = "tracks")
internal data class TrackRow(@PrimaryKey val key: String, @Embedded val track: Track, val ordinal: Int)
@Entity(tableName = "playlists")
internal data class PlaylistRow(
    @PrimaryKey val id: String, val name: String, val createdAt: Long, val updatedAt: Long,
    val description: String?, val artwork: String?, val source: String?, val readonly: Boolean?,
    val externalUrl: String?, val extensions: Map<String, String>, val ordinal: Int,
)
@Entity(tableName = "playlist_entries", primaryKeys = ["playlistId", "position"],
    foreignKeys = [ForeignKey(entity = PlaylistRow::class, parentColumns = ["id"], childColumns = ["playlistId"], onDelete = ForeignKey.CASCADE)])
internal data class PlaylistEntry(val playlistId: String, val position: Int, val trackId: String)
@Entity(tableName = "cloud_tracks", primaryKeys = ["playlistId", "key"])
internal data class CloudTrackRow(val playlistId: String, val key: String, @Embedded val track: Track, val ordinal: Int)
@Entity(tableName = "history")
internal data class HistoryRow(@PrimaryKey val position: Int, @Embedded val track: Track)
@Entity(tableName = "downloads")
internal data class DownloadRow(@PrimaryKey val key: String, @Embedded val download: Download)
/** Envelope metadata only; collections and settings have separate canonical owners. */
@Entity(tableName = "artist_info")
internal data class ArtistInfoRow(@PrimaryKey val name: String, val legacyId: Long?, val photoUrl: String?, val biography: String?, val timestamp: Long)
@Entity(tableName = "documents")
internal data class DocumentRow(@PrimaryKey val name: String, val json: String)

internal data class PlaylistWithEntries(@Embedded val row: PlaylistRow,
    @Relation(parentColumn = "id", entityColumn = "playlistId") val entries: List<PlaylistEntry>) {
    fun model() = Playlist(row.id, row.name, entries.sortedBy { it.position }.map { it.trackId }, row.createdAt,
        row.updatedAt, row.description, row.artwork, row.source, row.readonly, row.externalUrl, row.extensions)
}
internal fun Playlist.row(ordinal: Int) = PlaylistRow(id, name, createdAt, updatedAt, description, artwork, source, readonly, externalUrl, extensions, ordinal)

internal class Converters {
    @TypeConverter fun encode(value: Map<String, String>): String = JSONObject(value).toString()
    @TypeConverter fun decode(value: String): Map<String, String> = JSONObject(value).let { obj -> obj.keys().asSequence().associateWith { obj.getString(it) } }
    @TypeConverter fun status(value: DownloadStatus): String = value.name
    @TypeConverter fun status(value: String): DownloadStatus = DownloadStatus.valueOf(value)
}

@Dao
internal interface LibraryDao {
    @Query("SELECT * FROM tracks ORDER BY ordinal") suspend fun tracks(): List<TrackRow>
    @Query("SELECT * FROM tracks ORDER BY ordinal") fun observeTracks(): Flow<List<TrackRow>>
    @Query("SELECT COALESCE(MAX(ordinal), -1) FROM tracks") suspend fun maxTrackOrdinal(): Int
    @Query("SELECT * FROM tracks WHERE `key` = :id") suspend fun track(id: String): TrackRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putTracks(rows: List<TrackRow>)
    @Query("DELETE FROM tracks WHERE `key` = :id") suspend fun deleteTrack(id: String)
    @Query("SELECT * FROM playlists ORDER BY ordinal") @Transaction suspend fun playlists(): List<PlaylistWithEntries>
    @Query("SELECT * FROM playlists ORDER BY ordinal") @Transaction fun observePlaylists(): Flow<List<PlaylistWithEntries>>
    @Query("SELECT COALESCE(MAX(ordinal), -1) FROM playlists") suspend fun maxPlaylistOrdinal(): Int
    @Query("SELECT * FROM playlists WHERE id = :id") @Transaction suspend fun playlist(id: String): PlaylistWithEntries?
    @Upsert suspend fun putPlaylist(row: PlaylistRow)
    @Insert suspend fun putEntries(rows: List<PlaylistEntry>)
    @Query("DELETE FROM playlist_entries WHERE playlistId = :id") suspend fun deleteEntries(id: String)
    @Query("DELETE FROM playlist_entries WHERE trackId = :id") suspend fun deleteTrackEntries(id: String)
    @Query("DELETE FROM playlists WHERE id = :id") suspend fun deletePlaylist(id: String)
    @Query("SELECT * FROM cloud_tracks ORDER BY playlistId, ordinal") suspend fun cloudTracks(): List<CloudTrackRow>
    @Query("SELECT * FROM cloud_tracks WHERE playlistId = :id ORDER BY ordinal") suspend fun cloudTracks(id: String): List<CloudTrackRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCloudTracks(rows: List<CloudTrackRow>)
    @Query("SELECT * FROM history ORDER BY position") suspend fun history(): List<HistoryRow>
    @Query("SELECT * FROM history ORDER BY position") fun observeHistory(): Flow<List<HistoryRow>>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putHistory(rows: List<HistoryRow>)
    @Query("DELETE FROM history") suspend fun clearHistory()
    @Query("SELECT * FROM downloads ORDER BY updatedAt DESC") suspend fun downloads(): List<DownloadRow>
    @Query("SELECT * FROM downloads ORDER BY updatedAt DESC") fun observeDownloads(): Flow<List<DownloadRow>>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putDownloads(rows: List<DownloadRow>)
    @Query("SELECT * FROM artist_info ORDER BY name") suspend fun artistInfo(): List<ArtistInfoRow>
    @Query("SELECT * FROM artist_info ORDER BY name") fun observeArtistInfo(): Flow<List<ArtistInfoRow>>
    @Query("SELECT * FROM artist_info WHERE name = :name") suspend fun artistInfo(name: String): ArtistInfoRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putArtistInfo(rows: List<ArtistInfoRow>)
    @Query("DELETE FROM artist_info") suspend fun clearArtistInfo()
    @Query("SELECT * FROM documents") suspend fun documents(): List<DocumentRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putDocuments(rows: List<DocumentRow>)
    @Query("DELETE FROM tracks") suspend fun clearTracks()
    @Query("DELETE FROM playlists") suspend fun clearPlaylists()
    @Query("DELETE FROM cloud_tracks") suspend fun clearCloudTracks()
    @Query("DELETE FROM downloads") suspend fun clearDownloads()
    @Query("DELETE FROM documents") suspend fun clearDocuments()
    @Query("DELETE FROM documents WHERE name = :name") suspend fun deleteDocument(name: String)
}

@Database(entities = [TrackRow::class, PlaylistRow::class, PlaylistEntry::class, CloudTrackRow::class,
    HistoryRow::class, DownloadRow::class, DocumentRow::class, ArtistInfoRow::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)
internal abstract class LibraryDatabase : RoomDatabase() { abstract fun library(): LibraryDao }
