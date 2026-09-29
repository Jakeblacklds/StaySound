package app.staysound.core.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import kotlinx.coroutines.*
import java.io.File

/** One application-owned instance. Opening another instance (including a JS runtime) fails the lease. */
class StaySoundData private constructor(
    private val ownership: StorageOwnership,
    private val db: LibraryDatabase,
    private val scope: CoroutineScope,
    val settings: SettingsRepository,
    private val migration: DataMigration,
) {
    val library = LibraryRepository(db, ownership)
    /** Called only by a native startup after all legacy consumers have been stopped. Not exported to JS. */
    suspend fun importLegacyAtStartup() = migration.activate()
    suspend fun recoverInterruptedMigration() = migration.recover()
    suspend fun cancelInterruptedImport() = migration.cancelInterruptedImport()
    suspend fun exportForLegacyAtShutdown() = migration.rollback()
    /** The application must stop collectors/workers before closing its graph. */
    suspend fun close() = withContext(NonCancellable + Dispatchers.IO) {
        ownership.exclusive {
            scope.coroutineContext[Job]!!.cancelAndJoin()
            db.close()
            ownership.close()
        }
    }
    companion object {
        suspend fun open(context: Context): StaySoundData = create(context)
        internal suspend fun create(context: Context, checkpoint: (MigrationCheckpoint) -> Unit = {}): StaySoundData = withContext(Dispatchers.IO) {
            val app = context.applicationContext
            val ownership = StorageOwnership(app.filesDir)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            var db: LibraryDatabase? = null
            try {
                db = Room.databaseBuilder(app, LibraryDatabase::class.java, "staysound-core-v1.db").build()
                val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(ownership.root, "settings.preferences_pb") })
                val settings = SettingsRepository(store, ownership)
                StaySoundData(ownership, db, scope, settings, DataMigration(db, settings, ownership, checkpoint))
            } catch (error: Throwable) {
                scope.cancel(); db?.close(); ownership.close(); throw error
            }
        }
    }
}
