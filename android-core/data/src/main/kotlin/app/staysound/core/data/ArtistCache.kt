package app.staysound.core.data

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Artist photos/biographies used to live in Expo SQLite, separately from the library JSON. */
internal object ArtistCache {
    const val DOCUMENT = "staysound-native-artist-cache-v1"
    private fun database(filesDir: File) = File(filesDir, "SQLite/staysound.db")
    fun snapshot(filesDir: File): String? {
        val file = database(filesDir)
        if (!file.exists()) return null
        return SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            val exists = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='artists'", null).use { it.moveToFirst() }
            if (!exists) return@use null
            val rows = db.rawQuery("SELECT id, name, photo_url, biography, timestamp FROM artists ORDER BY id", null).use { cursor ->
                buildList {
                    while (cursor.moveToNext()) add(ArtistInfoRow(cursor.getString(1), cursor.getLong(0),
                        if (cursor.isNull(2)) null else cursor.getString(2), if (cursor.isNull(3)) null else cursor.getString(3), cursor.getLong(4)))
                }
            }
            encode(rows)
        }
    }
    fun encode(rows: List<ArtistInfoRow>): String = JSONObject().put("version", 1).put("artists", JSONArray().apply {
        rows.sortedBy { it.name }.forEach { row -> put(JSONObject().put("name", row.name).put("legacyId", row.legacyId ?: JSONObject.NULL)
            .put("photoUrl", row.photoUrl ?: JSONObject.NULL).put("biography", row.biography ?: JSONObject.NULL).put("timestamp", row.timestamp)) }
    }).toString()
    fun decode(raw: String?): List<ArtistInfoRow> {
        if (raw == null) return emptyList()
        val root = JSONObject(raw)
        require(root.getInt("version") == 1)
        return LegacyCodec.objects(root.getJSONArray("artists")).map { row ->
            ArtistInfoRow(row.getString("name"), if (row.isNull("legacyId")) null else row.getLong("legacyId"),
                if (row.isNull("photoUrl")) null else row.getString("photoUrl"),
                if (row.isNull("biography")) null else row.getString("biography"), row.getLong("timestamp"))
        }.sortedBy { it.name }.also { rows -> require(rows.map { it.name }.distinct().size == rows.size) }
    }
    /** Replayed safely by the export journal after a crash. Preserve other tables and unrecognized columns. */
    fun restore(filesDir: File, raw: String) {
        val rows = decode(raw)
        val file = database(filesDir)
        if (rows.isEmpty() && !file.exists()) return
        check(file.parentFile!!.mkdirs() || file.parentFile!!.isDirectory)
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            db.beginTransaction()
            try {
                db.execSQL("CREATE TABLE IF NOT EXISTS artists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, photo_url TEXT, biography TEXT, timestamp INTEGER NOT NULL)")
                rows.forEach { row ->
                    val values = ContentValues().apply {
                        put("name", row.name); put("photo_url", row.photoUrl); put("biography", row.biography); put("timestamp", row.timestamp)
                    }
                    if (db.update("artists", values, "name = ?", arrayOf(row.name)) == 0) {
                        db.insertOrThrow("artists", null, values)
                    }
                }
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
        }
    }
}

data class ArtistInfo(val name: String, val photoUrl: String?, val biography: String?, val timestamp: Long)
