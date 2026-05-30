package expo.modules.libraryindexer

import android.content.ContentUris
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

class LibraryIndexerModule : Module() {
    private var mediaStoreObserver: ContentObserver? = null
    private var lastMediaStoreEventMs = 0L

    override fun definition() = ModuleDefinition {
        Name("LibraryIndexer")
        Events("onAudioLibraryChanged")

        Function("isAvailable") {
            true
        }

        AsyncFunction("scanTracks") { folderPattern: String? ->
            val context = appContext.reactContext?.applicationContext
            if (context == null) {
                return@AsyncFunction emptyList<Map<String, Any?>>()
            }

            val resolver = context.contentResolver
            val audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            val projection = arrayOf(
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.ALBUM_ID,
                MediaStore.Audio.Media.RELATIVE_PATH,
                MediaStore.MediaColumns.DATA,
                MediaStore.Audio.Media.IS_MUSIC,
            )

            val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
            val sortOrder = "${MediaStore.Audio.Media.DATE_ADDED} DESC"

            val results = mutableListOf<Map<String, Any?>>()
            val folderHint = extractFolderHint(folderPattern)
            val artworkEntriesByFolder = queryArtworkEntriesByFolder(folderHint)
            resolver.query(audioUri, projection, selection, null, sortOrder)?.use { cursor ->
                val idIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val nameIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val titleIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val mimeTypeIx = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE)
                val durationIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val dateAddedIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
                val dateModifiedIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
                val sizeIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                val albumIdIx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val dataPathIx = cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
                val relativePathIx = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                } else {
                    -1
                }

                while (cursor.moveToNext()) {
                    val mediaId = cursor.getLong(idIx)
                    val title = normalize(cursor.getString(titleIx), "Unknown Title")
                    val mimeType = if (mimeTypeIx >= 0) cursor.getString(mimeTypeIx) else null
                    val displayName = resolveDisplayName(
                        cursor.getString(nameIx),
                        if (dataPathIx >= 0) cursor.getString(dataPathIx) else null,
                        title,
                        mimeType
                    )
                    val relativePath = if (relativePathIx >= 0) cursor.getString(relativePathIx) ?: "" else ""

                    if (!matchesFolder(relativePath, folderHint)) {
                        continue
                    }

                    val duration = cursor.getLong(durationIx)
                    val dateAddedMs = cursor.getLong(dateAddedIx) * 1000L
                    val dateModifiedMs = cursor.getLong(dateModifiedIx) * 1000L
                    val size = cursor.getLong(sizeIx)
                    val albumId = cursor.getLong(albumIdIx)
                    val dataPath = if (dataPathIx >= 0) cursor.getString(dataPathIx) else null

                    if (shouldSkipAudioRow(relativePath, dataPath, displayName, size, duration)) {
                        continue
                    }

                    val contentUri = ContentUris.withAppendedId(audioUri, mediaId).toString()
                    val artworkUri = if (albumId > 0L) {
                        ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId).toString()
                    } else {
                        null
                    }

                    results.add(
                        mapOf(
                            "id" to "ms_$mediaId",
                            "uri" to contentUri,
                            "title" to title,
                            "artist" to normalize(cursor.getString(artistIx), "Unknown Artist"),
                            "album" to normalize(cursor.getString(albumIx), "Unknown Album"),
                            "durationMs" to duration,
                            "dateAddedMs" to dateAddedMs,
                            "dateModifiedMs" to dateModifiedMs,
                            "size" to size,
                            "artwork" to artworkUri,
                            "albumId" to albumId.toString(),
                            "relativePath" to relativePath,
                            "displayName" to displayName,
                            "artworkEntries" to artworkEntriesByFolder[normalizeRelativePath(relativePath)],
                        )
                    )
                }
            }

            results
        }

        AsyncFunction("resolveContentUriToFileUri") { contentUri: String ->
            val context = appContext.reactContext?.applicationContext
            if (context == null || contentUri.isBlank()) {
                return@AsyncFunction null
            }

            val resolver = context.contentResolver
            val parsedUri = runCatching { Uri.parse(contentUri) }.getOrNull()
                ?: return@AsyncFunction null

            val projection = arrayOf(
                MediaStore.MediaColumns.DATA,
                MediaStore.Audio.Media.RELATIVE_PATH,
                MediaStore.Audio.Media.DISPLAY_NAME,
            )

            resolver.query(parsedUri, projection, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val dataIx = cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
                    if (dataIx >= 0) {
                        val absolutePath = cursor.getString(dataIx)?.trim().orEmpty()
                        if (absolutePath.isNotEmpty()) {
                            return@AsyncFunction Uri.fromFile(File(absolutePath)).toString()
                        }
                    }

                    val relativePathIx = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                    val displayNameIx = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
                    val relativePath = if (relativePathIx >= 0) cursor.getString(relativePathIx).orEmpty() else ""
                    val displayName = if (displayNameIx >= 0) cursor.getString(displayNameIx).orEmpty() else ""
                    if (relativePath.isNotBlank() && displayName.isNotBlank()) {
                        val basePath = "/storage/emulated/0/${relativePath.trim().trimEnd('/')}"
                        val absolutePath = "$basePath/$displayName"
                        val file = File(absolutePath)
                        if (file.exists() && file.canRead()) {
                            return@AsyncFunction Uri.fromFile(file).toString()
                        }
                    }
                }
            }

            copyContentUriToCacheFile(context, parsedUri)
        }

        OnStartObserving("onAudioLibraryChanged") {
            registerMediaStoreObserver()
        }

        OnStopObserving("onAudioLibraryChanged") {
            unregisterMediaStoreObserver()
        }

        OnDestroy {
            unregisterMediaStoreObserver()
        }
    }

    private fun copyContentUriToCacheFile(context: android.content.Context, contentUri: Uri): String? {
        return runCatching {
            val resolver = context.contentResolver
            val extension = resolver.getType(contentUri)
                ?.lowercase()
                ?.let { mime ->
                    when {
                        mime.contains("flac") -> "flac"
                        mime.contains("mpeg") || mime.contains("mp3") -> "mp3"
                        mime.contains("mp4") || mime.contains("aac") -> "m4a"
                        mime.contains("wav") -> "wav"
                        mime.contains("ogg") -> "ogg"
                        mime.contains("opus") -> "opus"
                        else -> "bin"
                    }
                } ?: "bin"

            val hash = sha1(contentUri.toString())
            val targetDir = File(context.cacheDir, "staysound-ms-resolved")
            if (!targetDir.exists()) targetDir.mkdirs()

            val outFile = File(targetDir, "$hash.$extension")
            if (outFile.exists() && outFile.length() > 0L) {
                return@runCatching Uri.fromFile(outFile).toString()
            }

            resolver.openInputStream(contentUri)?.use { input ->
                FileOutputStream(outFile).use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                }
            } ?: return@runCatching null

            if (outFile.exists() && outFile.length() > 0L) {
                Uri.fromFile(outFile).toString()
            } else {
                null
            }
        }.getOrNull()
    }

    private fun sha1(value: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
        val bytes = digest.digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun registerMediaStoreObserver() {
        if (mediaStoreObserver != null) return
        val context = appContext.reactContext?.applicationContext ?: return
        val handler = Handler(Looper.getMainLooper())

        mediaStoreObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) {
                notifyAudioLibraryChanged(null)
            }

            override fun onChange(selfChange: Boolean, uri: Uri?) {
                notifyAudioLibraryChanged(uri)
            }
        }

        context.contentResolver.registerContentObserver(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            true,
            mediaStoreObserver!!
        )
    }

    private fun unregisterMediaStoreObserver() {
        val observer = mediaStoreObserver ?: return
        val context = appContext.reactContext?.applicationContext
        if (context != null) {
            runCatching {
                context.contentResolver.unregisterContentObserver(observer)
            }
        }
        mediaStoreObserver = null
    }

    private fun notifyAudioLibraryChanged(uri: Uri?) {
        val now = System.currentTimeMillis()
        if (now - lastMediaStoreEventMs < 750L) return
        lastMediaStoreEventMs = now

        sendEvent(
            "onAudioLibraryChanged",
            bundleOf(
                "uri" to uri?.toString(),
                "changedAt" to now
            )
        )
    }

    private fun queryArtworkEntriesByFolder(folderHint: String): Map<String, List<Map<String, String>>> {
        val context = appContext.reactContext?.applicationContext ?: return emptyMap()
        val resolver = context.contentResolver
        val imageUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.RELATIVE_PATH,
        )
        val results = mutableMapOf<String, MutableList<Map<String, String>>>()

        runCatching {
            resolver.query(imageUri, projection, null, null, null)?.use { cursor ->
                val idIx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameIx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val relativePathIx = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cursor.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH)
                } else {
                    -1
                }

                while (cursor.moveToNext()) {
                    val displayName = cursor.getString(nameIx)?.trim().orEmpty()
                    if (!isArtworkFilename(displayName)) continue

                    val relativePath = if (relativePathIx >= 0) cursor.getString(relativePathIx).orEmpty() else ""
                    if (!matchesFolder(relativePath, folderHint)) continue

                    val mediaId = cursor.getLong(idIx)
                    val contentUri = ContentUris.withAppendedId(imageUri, mediaId).toString()
                    val folderKey = normalizeRelativePath(relativePath)

                    results.getOrPut(folderKey) { mutableListOf() }.add(
                        mapOf(
                            "name" to displayName,
                            "uri" to contentUri,
                        )
                    )
                }
            }
        }

        return results
    }

    private fun isArtworkFilename(displayName: String): Boolean {
        val normalized = displayName.lowercase().trim()
        return normalized.endsWith(".jpg")
            || normalized.endsWith(".jpeg")
            || normalized.endsWith(".png")
    }

    private fun normalizeRelativePath(relativePath: String): String {
        return relativePath.lowercase().replace('\\', '/').trim().trim('/')
    }

    private fun normalize(value: String?, fallback: String): String {
        if (value == null) return fallback
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return fallback
        if (trimmed.equals("<unknown>", ignoreCase = true)) return fallback
        return trimmed
    }

    private fun resolveDisplayName(
        rawDisplayName: String?,
        dataPath: String?,
        normalizedTitle: String,
        mimeType: String?
    ): String {
        val direct = rawDisplayName?.trim().orEmpty()
        if (direct.isNotEmpty()) return direct

        val fromData = dataPath
            ?.substringAfterLast('/')
            ?.trim()
            .orEmpty()
        if (fromData.isNotEmpty()) return fromData

        if (normalizedTitle == "Unknown Title") return ""
        val extension = extensionFromMimeType(mimeType)
        return if (extension.isEmpty()) normalizedTitle else "$normalizedTitle.$extension"
    }

    private fun extensionFromMimeType(mimeType: String?): String {
        val normalized = mimeType?.lowercase()?.trim().orEmpty()
        return when {
            normalized.contains("flac") -> "flac"
            normalized.contains("mpeg") || normalized.contains("mp3") -> "mp3"
            normalized.contains("mp4") || normalized.contains("aac") -> "m4a"
            normalized.contains("wav") -> "wav"
            normalized.contains("ogg") -> "ogg"
            normalized.contains("opus") -> "opus"
            else -> ""
        }
    }

    private fun extractFolderHint(folderPattern: String?): String {
        if (folderPattern.isNullOrBlank()) return ""
        val normalized = folderPattern.lowercase().replace('\\', '/').trim()
        val segments = normalized.split('/').filter { it.isNotBlank() }
        if (segments.isEmpty()) return ""

        val ignored = setOf("storage", "emulated", "0")
        for (i in segments.size - 1 downTo 0) {
            val segment = segments[i]
            if (!ignored.contains(segment)) {
                return segment
            }
        }
        return segments.last()
    }

    private fun matchesFolder(relativePath: String, folderHint: String): Boolean {
        if (folderHint.isBlank()) return true
        if (relativePath.isBlank()) return false

        val normalized = relativePath.lowercase().replace('\\', '/')
        return normalized.startsWith("$folderHint/") || normalized.contains("/$folderHint/")
    }

    private fun shouldSkipAudioRow(
        relativePath: String,
        dataPath: String?,
        displayName: String,
        size: Long,
        duration: Long
    ): Boolean {
        if (size <= 0L) return true

        val normalizedRelative = normalizeRelativePath(relativePath)
        val normalizedData = dataPath.orEmpty().lowercase().replace('\\', '/')
        val normalizedName = displayName.lowercase().trim()
        val combined = "$normalizedRelative/$normalizedData/$normalizedName"

        if (combined.contains("/cache/staysound/downloads/")) return true
        if (combined.contains("/android/data/") && combined.contains("/cache/")) return true

        val isStaySoundDownload = normalizedRelative.contains("staysound")
        val looksLikeAudio = normalizedName.endsWith(".flac")
            || normalizedName.endsWith(".mp3")
            || normalizedName.endsWith(".m4a")
            || normalizedName.endsWith(".aac")
            || normalizedName.endsWith(".wav")
            || normalizedName.endsWith(".ogg")
            || normalizedName.endsWith(".opus")

        return isStaySoundDownload && looksLikeAudio && (size < 16 * 1024L || duration <= 0L)
    }
}
