package app.staysound.core.data

import android.util.AtomicFile
import android.net.Uri
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException

internal enum class Owner { LEGACY, IMPORTING, NATIVE, EXPORTING }
internal data class Ownership(val owner: Owner, val generation: String? = null)

/** Held for the lifetime of a runtime, not just a write: two runtimes cannot both hydrate writable state. */
internal class StorageOwnership(val filesDir: File) : Closeable {
    val root = File(filesDir, "staysound-core").apply { check(mkdirs() || isDirectory) }
    private val file = RandomAccessFile(File(root, "runtime.lock"), "rw")
    private val lease: FileLock = try {
        checkNotNull(file.channel.tryLock()) { "Another StaySound runtime owns storage" }
    } catch (error: Exception) {
        file.close()
        throw IllegalStateException("Another StaySound runtime owns storage", error)
    }
    private val mutex = Mutex()
    private var closed = false
    private val marker = File(root, "ownership.json")
    suspend fun <T> exclusive(block: suspend () -> T): T = withContext(Dispatchers.IO) {
        mutex.withLock { check(!closed) { "Storage runtime closed" }; block() }
    }
    suspend fun <T> native(block: suspend () -> T): T = exclusive {
        check(read().owner == Owner.NATIVE) { "Native storage does not own user data" }
        block()
    }
    fun read(): Ownership {
        val atomic = AtomicFile(marker)
        if (!marker.exists() && !File(marker.path + ".bak").exists()) return Ownership(Owner.LEGACY)
        val json = JSONObject(atomic.readFully().toString(Charsets.UTF_8))
        return Ownership(Owner.valueOf(json.getString("owner")), json.optString("generation").takeIf { it.isNotEmpty() })
    }
    fun write(value: Ownership) = atomicWrite(marker, JSONObject().put("owner", value.owner.name)
        .put("generation", value.generation).toString().toByteArray())
    override fun close() { check(!closed); closed = true; lease.release(); file.close() }
}

internal fun atomicWrite(file: File, bytes: ByteArray) {
    check(file.parentFile!!.mkdirs() || file.parentFile!!.isDirectory)
    val target = AtomicFile(file)
    val stream = target.startWrite()
    try { stream.write(bytes); target.finishWrite(stream) }
    catch (error: Throwable) { target.failWrite(stream); throw error }
}

/** Read without taking the lease so bootstrap can choose a runtime. Callers re-check under the lease. */
internal fun peekOwner(filesDir: File): Owner {
    val marker = File(File(filesDir, "staysound-core"), "ownership.json")
    if (!marker.exists() && !File(marker.path + ".bak").exists()) return Owner.LEGACY
    return Owner.valueOf(JSONObject(AtomicFile(marker).readFully().toString(Charsets.UTF_8)).getString("owner"))
}

/** Key/value document store the JavaScript runtime persists through. Exactly one authority is open at a time. */
interface StorageAuthority {
    suspend fun getItem(name: String): String?
    suspend fun setItem(name: String, value: String)
    suspend fun removeItem(name: String)
    suspend fun close()
}

/** Transitional Android adapter. No migration entry point is exposed to JavaScript. */
class LegacyStorageSession private constructor(private val ownership: StorageOwnership) : StorageAuthority {
    private val storage = File(ownership.filesDir, "storage")
    private fun file(name: String): File {
        require(name.isNotEmpty() && !name.contains('\u0000')) { "Invalid storage key" }
        // Expo readAsStringAsync used Uri.path, which decodes percent escapes in cache keys.
        val path = checkNotNull(Uri.parse("${Uri.fromFile(storage)}/$name.json").path)
        val target = File(path).canonicalFile
        require(target.path.startsWith(storage.canonicalPath + File.separator)) { "Storage key escapes its directory" }
        return target
    }
    override suspend fun getItem(name: String): String? = ownership.exclusive {
        check(ownership.read().owner == Owner.LEGACY) { "Kotlin owns user data; legacy runtime is disabled" }
        AtomicFile(file(name)).let { if (file(name).exists() || File(file(name).path + ".bak").exists()) it.readFully().toString(Charsets.UTF_8) else null }
    }
    override suspend fun setItem(name: String, value: String) = ownership.exclusive {
        check(ownership.read().owner == Owner.LEGACY)
        atomicWrite(file(name), value.toByteArray())
    }
    override suspend fun removeItem(name: String) = ownership.exclusive {
        check(ownership.read().owner == Owner.LEGACY)
        AtomicFile(file(name)).delete()
    }
    override suspend fun close() = withContext(NonCancellable) { ownership.exclusive { ownership.close() } }
    companion object {
        fun open(filesDir: File): LegacyStorageSession {
            val ownership = StorageOwnership(filesDir)
            try {
                check(ownership.read().owner == Owner.LEGACY) { "Legacy startup blocked until migration recovery/rollback" }
                return LegacyStorageSession(ownership)
            } catch (error: Throwable) { ownership.close(); throw error }
        }
    }
}
