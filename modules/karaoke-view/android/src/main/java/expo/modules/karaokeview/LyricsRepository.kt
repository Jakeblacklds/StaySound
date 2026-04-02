package expo.modules.karaokeview

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale

data class LyricsPayload(
    val canonicalKey: String,
    val payloadJson: String,
    val updatedAt: String? = null,
)

interface LocalLyricsStore {
    fun read(canonicalKey: String): LyricsPayload?
    fun write(record: LyricsPayload)
}

interface RemoteLyricsDataSource {
    fun fetchLyrics(songTitle: String, artist: String, canonicalKey: String): LyricsPayload?
}

class LyricsRepository(
    private val localStore: LocalLyricsStore,
    private val remoteDataSource: RemoteLyricsDataSource,
) {
    private fun hasWords(record: LyricsPayload?): Boolean {
        if (record == null) return false
        return try {
            val payload = JSONObject(record.payloadJson)
            val lyrics = payload.optJSONArray("lyrics")
            lyrics != null && lyrics.length() > 0
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val TAG = "LyricsRepository"
        private val DIACRITICS = Regex("\\p{M}+")
        private val PUNCTUATION = Regex("[^\\p{Alnum}\\s]")
        private val MULTI_SPACE = Regex("\\s+")

        fun normalizeKeyPart(rawValue: String): String {
            val normalized = Normalizer.normalize(rawValue.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            val withoutDiacritics = DIACRITICS.replace(normalized, "")
            val noPunctuation = PUNCTUATION.replace(withoutDiacritics, " ")
            return MULTI_SPACE.replace(noPunctuation.trim(), " ")
        }

        fun canonicalKey(songTitle: String, artist: String): String {
            return "${normalizeKeyPart(artist)}::${normalizeKeyPart(songTitle)}"
        }

        fun cleanLookupValue(rawValue: String): String {
            return rawValue.trim()
                .split("(")[0]
                .split("[")[0]
                .split("-")[0]
                .trim()
        }

        fun primaryArtistValue(rawValue: String): String {
            return rawValue.trim()
                .replace(Regex("(?i)\\b(feat\\.?|ft\\.?|featuring|with)\\b.*$"), "")
                .split(",", "&", ";", "/", "|")
                .firstOrNull()
                ?.trim()
                .orEmpty()
        }

        fun candidateCanonicalKeys(songTitle: String, artist: String): List<String> {
            val titleCandidates = listOf(songTitle, cleanLookupValue(songTitle))
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
            val artistCandidates = listOf(artist, cleanLookupValue(artist))
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()

            return titleCandidates.flatMap { titleCandidate ->
                artistCandidates.map { artistCandidate ->
                    canonicalKey(titleCandidate, artistCandidate)
                }
            }.distinct()
        }
    }

    fun getLyrics(songTitle: String, artist: String): LyricsPayload? {
        val canonicalKey = canonicalKey(songTitle, artist)
        android.util.Log.d(TAG, "getLyrics request title='$songTitle' artist='$artist' canonical='$canonicalKey'")
        readCachedLyrics(songTitle, artist)?.let {
            if (hasWords(it)) {
                return it
            }
            android.util.Log.w(TAG, "Ignoring cached synced lyrics without words for canonical='${it.canonicalKey}'")
        }

        return try {
            val remote = remoteDataSource.fetchLyrics(songTitle, artist, canonicalKey) ?: return null
            localStore.write(remote)
            android.util.Log.d(TAG, "getLyrics remote hit canonical='${remote.canonicalKey}' updatedAt='${remote.updatedAt}'")
            remote
        } catch (_: Exception) {
            android.util.Log.w(TAG, "getLyrics remote failed title='$songTitle' artist='$artist'")
            null
        }
    }

    fun forceRefreshLyrics(songTitle: String, artist: String): LyricsPayload? {
        val canonicalKey = canonicalKey(songTitle, artist)

        return try {
            val remote = remoteDataSource.fetchLyrics(songTitle, artist, canonicalKey)
            if (remote != null) {
                localStore.write(remote)
                remote
            } else {
                readCachedLyrics(songTitle, artist)
            }
        } catch (_: Exception) {
            readCachedLyrics(songTitle, artist)
        }
    }

    private fun readCachedLyrics(songTitle: String, artist: String): LyricsPayload? {
        val requestedKey = canonicalKey(songTitle, artist)

        for (candidate in candidateCanonicalKeys(songTitle, artist)) {
            android.util.Log.d(TAG, "readCachedLyrics trying candidate='$candidate' requested='$requestedKey'")
            val cached = localStore.read(candidate) ?: continue
            if (candidate != requestedKey) {
                localStore.write(
                    cached.copy(canonicalKey = requestedKey)
                )
            }
            android.util.Log.d(TAG, "readCachedLyrics hit candidate='$candidate' updatedAt='${cached.updatedAt}'")
            return cached
        }

        android.util.Log.d(TAG, "readCachedLyrics miss for requested='$requestedKey'")
        return null
    }
}

class FileLyricsStore(private val context: Context) : LocalLyricsStore {
    private val cacheDir = File(context.filesDir, "lyrics-cache")

    init {
        if (!cacheDir.exists()) {
            cacheDir.mkdirs()
        }
    }

    override fun read(canonicalKey: String): LyricsPayload? {
        val file = fileFor(canonicalKey)
        if (!file.exists()) return null

        return try {
            val cached = JSONObject(file.readText())
            LyricsPayload(
                canonicalKey = cached.optString("canonical_key", canonicalKey),
                payloadJson = cached.getJSONObject("payload").toString(),
                updatedAt = cached.optString("updated_at").ifBlank { null },
            )
        } catch (_: Exception) {
            null
        }
    }

    override fun write(record: LyricsPayload) {
        val file = fileFor(record.canonicalKey)
        val wrapper = JSONObject()
            .put("canonical_key", record.canonicalKey)
            .put("updated_at", record.updatedAt)
            .put("payload", JSONObject(record.payloadJson))
        file.writeText(wrapper.toString())
    }

    private fun fileFor(canonicalKey: String): File {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(canonicalKey.toByteArray())
            .joinToString(separator = "") { "%02x".format(it) }
        return File(cacheDir, "$digest.json")
    }
}

class SupabaseLyricsDataSource : RemoteLyricsDataSource {
    companion object {
        private const val TAG = "SupabaseLyrics"
    }

    @Volatile
    private var supabaseUrl: String? = null

    @Volatile
    private var supabaseSecretKey: String? = null

    fun configure(url: String?, secretKey: String?) {
        supabaseUrl = url?.trim()?.trimEnd('/')
        supabaseSecretKey = secretKey?.trim()
    }

    override fun fetchLyrics(songTitle: String, artist: String, canonicalKey: String): LyricsPayload? {
        val url = supabaseUrl
        val key = supabaseSecretKey
        if (url.isNullOrBlank() || key.isNullOrBlank()) return null

        val titleCandidates = searchVariants(songTitle)
        val artistCandidates = searchVariants(artist)
        android.util.Log.d(TAG, "fetchLyrics titleCandidates=$titleCandidates artistCandidates=$artistCandidates canonical='$canonicalKey'")

        for (titleCandidate in titleCandidates) {
            for (artistCandidate in artistCandidates) {
                val exactQuery = "song=eq.${Uri.encode(titleCandidate)}&artist=eq.${Uri.encode(artistCandidate)}&limit=1"
                android.util.Log.d(TAG, "fetchLyrics exactQuery title='$titleCandidate' artist='$artistCandidate'")
                val exactRows = queryRows(url, key, exactQuery)
                parseRow(exactRows, canonicalKey)?.let {
                    android.util.Log.d(TAG, "Exact lyrics match: $artistCandidate - $titleCandidate")
                    return it
                }
            }
        }

        val songLike = "%${escapeLike(titleCandidates.first())}%"
        val artistLike = "%${escapeLike(artistCandidates.first())}%"
        val fallbackQuery = "song=ilike.${Uri.encode(songLike)}&artist=ilike.${Uri.encode(artistLike)}&limit=25"
        android.util.Log.d(TAG, "fetchLyrics fallbackQuery songLike='$songLike' artistLike='$artistLike'")
        val fallbackRows = queryRows(url, key, fallbackQuery)

        for (index in 0 until fallbackRows.length()) {
            val row = fallbackRows.optJSONObject(index) ?: continue
            val rowSong = row.optString("song")
            val rowArtist = row.optString("artist")
            
            // Lenient matching: canonical keys match OR (normalized song matches AND artist starts with artist)
            val rowCanonical = LyricsRepository.canonicalKey(rowSong, rowArtist)
            if (rowCanonical == canonicalKey) {
                android.util.Log.d(TAG, "Canonical fallback match: $rowArtist - $rowSong")
                parseRecord(row, canonicalKey)?.let { return it }
            } else {
                val normRowSong = LyricsRepository.normalizeKeyPart(rowSong)
                val normTargetSong = LyricsRepository.normalizeKeyPart(songTitle)
                if (normRowSong == normTargetSong) {
                    val normRowArtist = LyricsRepository.normalizeKeyPart(rowArtist)
                    val normTargetArtist = LyricsRepository.normalizeKeyPart(artist)
                    if (normRowArtist.contains(normTargetArtist) || normTargetArtist.contains(normRowArtist)) {
                        android.util.Log.d(TAG, "Lenient fallback match: $rowArtist - $rowSong")
                        parseRecord(row, canonicalKey)?.let { return it }
                    }
                }
            }
        }

        return null
    }

    private fun parseRow(rows: JSONArray, canonicalKey: String): LyricsPayload? {
        if (rows.length() <= 0) return null
        val row = rows.optJSONObject(0) ?: return null
        android.util.Log.d(TAG, "parseRow found candidate song='${row.optString("song")}' artist='${row.optString("artist")}'")
        return parseRecord(row, canonicalKey)
    }

    private fun parseRecord(row: JSONObject, canonicalKey: String): LyricsPayload? {
        val payload = row.optJSONObject("payload") ?: return null
        return LyricsPayload(
            canonicalKey = canonicalKey,
            payloadJson = payload.toString(),
            updatedAt = row.optString("updated_at").ifBlank { null },
        )
    }

    private fun queryRows(baseUrl: String, secretKey: String, query: String): JSONArray {
        val endpoint = "$baseUrl/rest/v1/song_alignments?select=payload,updated_at,song,artist&$query"
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("apikey", secretKey)
            setRequestProperty("Authorization", "Bearer $secretKey")
            setRequestProperty("Accept", "application/json")
        }

        return try {
            val code = connection.responseCode
            if (code !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader()?.use { it.readText() }
                android.util.Log.w(TAG, "Supabase request failed ($code): $endpoint :: $errorBody")
                throw IOException("Supabase request failed with HTTP $code")
            }
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            JSONArray(response)
        } finally {
            connection.disconnect()
        }
    }

    private fun escapeLike(value: String): String {
        return LyricsRepository.cleanLookupValue(value)
            .replace("%", "")
            .replace("_", "")
    }

    private fun searchVariants(value: String): List<String> {
        val trimmed = value.trim()
        val cleaned = escapeLike(trimmed)
        val primaryArtist = escapeLike(LyricsRepository.primaryArtistValue(trimmed))
        return listOf(primaryArtist, cleaned, trimmed)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
    }
}

// ─── LRCLIB Integration ────────────────────────────────────────────────────────

data class LrcLibLine(
    val startSec: Double,
    val text: String,
)

class LrcLibDataSource {

    companion object {
        private const val API_URL = "https://lrclib.net/api/get"
        private val TIME_REGEX = Regex("""^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)""")
    }

    /**
     * Fetches synced lyrics from LRCLIB using native HttpURLConnection (no JS fetch issues).
     * Returns a JSON string in KaraokeLyricsJSON format, or null on failure.
     */
    fun fetchLyrics(title: String, artist: String, durationSec: Double? = null): String? {
        val encodedTitle = Uri.encode(title)
        val encodedArtist = Uri.encode(artist)
        var url = "$API_URL?track_name=$encodedTitle&artist_name=$encodedArtist"
        if (durationSec != null) {
            url += "&duration=${durationSec.toLong()}"
        }

        android.util.Log.d("LrcLib", "Fetching from: $url")

        val connection = try {
            (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 15_000
                readTimeout = 20_000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "StaySound-App/1.0 (contact@staysound.app)")
                setRequestProperty("Accept", "application/json")
                // Prevents "unexpected end of stream" issue with OkHttp keep-alive
                setRequestProperty("Connection", "close")
            }
        } catch (e: Exception) {
            android.util.Log.e("LrcLib", "Connection error: ${e.message}")
            return null
        }

        return try {
            val code = connection.responseCode
            android.util.Log.d("LrcLib", "Response code: $code")
            if (code !in 200..299) return null

            val responseText = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(responseText)

            val syncedLyrics = json.optString("syncedLyrics").takeIf { it.isNotBlank() } ?: return null
            val totalDuration = json.optDouble("duration", 0.0)

            parseLrc(syncedLyrics, title, artist, totalDuration)
        } catch (e: Exception) {
            android.util.Log.e("LrcLib", "Error: ${e.message}")
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun parseLrc(lrc: String, title: String, artist: String, totalDuration: Double): String {
        val lines = mutableListOf<LrcLibLine>()

        for (rawLine in lrc.lines()) {
            val match = TIME_REGEX.find(rawLine.trim()) ?: continue
            val (minsStr, secsStr, msStr, textRaw) = match.destructured
            val mins = minsStr.toInt()
            val secs = secsStr.toInt()
            val ms = msStr.padEnd(3, '0').toInt()
            val startSec = mins * 60.0 + secs + ms / 1000.0
            val text = textRaw.trim()
            if (text.isNotEmpty()) {
                lines.add(LrcLibLine(startSec, text))
            }
        }

        // Build KaraokeLyricsJSON-compatible JSON
        val lyricsArray = JSONArray()
        for (i in lines.indices) {
            val line = lines[i]
            val endSec = if (i < lines.size - 1) {
                lines[i + 1].startSec
            } else {
                if (totalDuration > line.startSec) totalDuration else line.startSec + 5.0
            }

            val wordObj = JSONObject()
                .put("w", line.text)
                .put("s", line.startSec)
                .put("e", endSec)
                .put("n", true)
            lyricsArray.put(wordObj)
        }

        val meta = JSONObject()
            .put("song", title)
            .put("artist", artist)
            .put("total_duration", totalDuration)

        val result = JSONObject()
            .put("meta", meta)
            .put("lyrics", lyricsArray)

        return result.toString()
    }
}
