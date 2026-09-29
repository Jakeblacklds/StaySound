package expo.modules.soulseeknative

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

internal data class SharedFileEntry(
  val virtualPath: String,
  val virtualDir: String,
  val name: String,
  val file: File,
  val size: Long,
  val extension: String,
)

/**
 * The files StaySound re-shares: only its own completed Soulseek downloads,
 * exposed under a virtual `StaySound\Soulseek` folder.
 */
internal class SoulseekShareIndex(private val rootDir: File?) {
  @Volatile
  private var entries: Map<String, SharedFileEntry> = emptyMap()

  val fileCount: Int get() = entries.size
  val folderCount: Int get() = entries.values.map { it.virtualDir }.distinct().size

  fun rescan() {
    val root = rootDir?.takeIf { it.isDirectory } ?: run {
      entries = emptyMap()
      return
    }
    // A file still being written (or one that just failed) is not shareable.
    val settledBefore = System.currentTimeMillis() - 10_000L
    val next = HashMap<String, SharedFileEntry>()
    root.walkTopDown().maxDepth(4)
      .filter { it.isFile && it.length() > 0 && it.lastModified() < settledBefore }
      .forEach { file ->
        val extension = file.extension.lowercase(Locale.US)
        if (extension !in SHAREABLE_EXTENSIONS) return@forEach
        val relativeDir = file.parentFile?.relativeTo(root)?.path.orEmpty()
          .split(File.separatorChar).filter { it.isNotBlank() }
        val virtualDir = (listOf(VIRTUAL_ROOT) + relativeDir).joinToString("\\")
        val virtualPath = "$virtualDir\\${file.name}"
        next[virtualPath.lowercase(Locale.ROOT)] = SharedFileEntry(
          virtualPath = virtualPath,
          virtualDir = virtualDir,
          name = file.name,
          file = file,
          size = file.length(),
          extension = extension,
        )
      }
    entries = next
  }

  fun resolve(virtualPath: String): SharedFileEntry? =
    entries[virtualPath.replace('/', '\\').lowercase(Locale.ROOT)]?.takeIf { it.file.isFile }

  /** Peer message 5 (SharedFileList), zlib-compressed as the protocol requires. */
  fun sharedFileListPacket(): ByteArray {
    val byDir = entries.values.groupBy { it.virtualDir }.toSortedMap()
    val body = SlskMessageBuilder().writeUInt32(byDir.size)
    byDir.forEach { (dir, files) ->
      body.writeString(dir).writeUInt32(files.size)
      files.sortedBy { it.name.lowercase(Locale.ROOT) }.forEach { entry ->
        body.writeUInt8(1)
          .writeString(entry.name)
          .writeUInt64(entry.size)
          .writeString(entry.extension)
          .writeUInt32(0)
      }
    }
    body.writeUInt32(0) // unknown, always 0
    body.writeUInt32(0) // private directories
    return SlskMessageBuilder()
      .writeUInt32(5)
      .writeBytes(deflateBytes(body.toBytes()))
      .toPacket()
  }

  private companion object {
    const val VIRTUAL_ROOT = "StaySound\\Soulseek"
    val SHAREABLE_EXTENSIONS = setOf("flac", "mp3", "m4a", "ogg", "opus", "wav")
  }
}

/** Handles peer requests that concern our shares; returns true when consumed. */
internal interface SoulseekPeerRequestHandler {
  fun handlePeerMessage(code: Int, parser: SlskMessageParser, connection: PeerSearchConnection): Boolean

  /** An inbound socket opened with PierceFirewall(token); true if it was ours. */
  fun claimPierceFirewall(token: ByteArray, socket: Socket): Boolean
}

private data class PendingUpload(
  val user: String,
  val entry: SharedFileEntry,
  val connection: PeerSearchConnection,
)

/**
 * Serves uploads from [SoulseekShareIndex] with a single slot on its own
 * thread, so it keeps working while the worker thread searches or downloads.
 */
internal class SoulseekUploadService(
  private val config: SoulseekConfig,
  private val shares: SoulseekShareIndex,
  private val lookupPeerAddress: (String) -> PeerAddress?,
  private val requestIndirectFileConnection: (user: String, token: ByteArray) -> Unit,
  private val reportUploadSpeed: (Int) -> Unit,
) : SoulseekPeerRequestHandler, Closeable {
  private val queue = LinkedBlockingDeque<PendingUpload>()
  private val transferResponses = ConcurrentHashMap<String, LinkedBlockingQueue<Boolean>>()
  private val pierceWaiters = ConcurrentHashMap<String, LinkedBlockingQueue<Socket>>()
  private val running = AtomicBoolean(true)
  private val transferring = AtomicBoolean(false)
  private val completedUploads = AtomicInteger(0)
  private val worker = Thread(::runQueue, "SoulseekUploads").apply {
    isDaemon = true
    priority = Thread.MIN_PRIORITY
    start()
  }

  fun isTransferring(): Boolean = transferring.get()

  override fun handlePeerMessage(code: Int, parser: SlskMessageParser, connection: PeerSearchConnection): Boolean {
    when (code) {
      // GetShareFileList → SharedFileList
      4 -> connection.send(shares.sharedFileListPacket())
      // UserInfoRequest → UserInfoResponse
      15 -> connection.send(
        SlskMessageBuilder()
          .writeUInt32(16)
          .writeString("StaySound")
          .writeUInt8(0)
          .writeUInt32(completedUploads.get())
          .writeUInt32(queue.size)
          .writeUInt8(if (transferring.get()) 0 else 1)
          .toPacket(),
      )
      // QueueUpload
      43 -> enqueue(parser.readStringSafe(), connection)
      // TransferResponse to one of our upload offers
      41 -> {
        val token = runCatching { parser.readBytes(4) }.getOrNull() ?: return true
        val allowed = parser.canRead(1) && parser.readUInt8() == 1
        transferResponses[tokenKey(token)]?.offer(allowed)
      }
      // PlaceInQueueRequest → PlaceInQueueResponse
      51 -> {
        val filename = parser.readStringSafe()
        val place = queue.indexOfFirst { it.entry.virtualPath.equals(filename, ignoreCase = true) } + 1
        connection.send(
          SlskMessageBuilder().writeUInt32(44).writeString(filename).writeUInt32(place.coerceAtLeast(0)).toPacket(),
        )
      }
      else -> return false
    }
    return true
  }

  override fun claimPierceFirewall(token: ByteArray, socket: Socket): Boolean {
    val waiter = pierceWaiters.remove(tokenKey(token)) ?: return false
    return waiter.offer(socket)
  }

  private fun enqueue(filename: String, connection: PeerSearchConnection) {
    val user = connection.peerUsername
    val entry = shares.resolve(filename)
    val denial = when {
      user.isNullOrBlank() -> return
      entry == null -> "File not shared."
      queue.any { it.user == user && it.entry.virtualPath == entry.virtualPath } -> return
      queue.size >= MAX_QUEUE || queue.count { it.user == user } >= MAX_QUEUE_PER_USER -> "Too many files"
      else -> null
    }
    if (denial != null || entry == null) {
      connection.send(
        SlskMessageBuilder().writeUInt32(50).writeString(filename).writeString(denial ?: "File not shared.").toPacket(),
      )
      return
    }
    connection.pinned = true
    queue.offer(PendingUpload(user!!, entry, connection))
  }

  private fun runQueue() {
    while (running.get()) {
      val job = try {
        queue.poll(1, TimeUnit.SECONDS)
      } catch (_: InterruptedException) {
        return
      } ?: continue
      transferring.set(true)
      try {
        upload(job)
      } catch (_: Exception) {
        runCatching {
          job.connection.send(
            SlskMessageBuilder().writeUInt32(46).writeString(job.entry.virtualPath).toPacket(),
          )
        }
      } finally {
        transferring.set(false)
        if (queue.none { it.connection === job.connection }) job.connection.pinned = false
      }
    }
  }

  private fun upload(job: PendingUpload) {
    if (!job.connection.isOpen()) return
    val token = randomTokenBytes()
    val responses = LinkedBlockingQueue<Boolean>()
    transferResponses[tokenKey(token)] = responses
    val allowed = try {
      job.connection.send(
        SlskMessageBuilder()
          .writeUInt32(40)
          .writeUInt32(1)
          .writeBytes(token)
          .writeString(job.entry.virtualPath)
          .writeUInt64(job.entry.size)
          .toPacket(),
      )
      responses.poll(60, TimeUnit.SECONDS) ?: false
    } finally {
      transferResponses.remove(tokenKey(token))
    }
    if (!allowed || !running.get()) return

    val socket = openFileConnection(job.user)
      ?: throw IllegalStateException("No se pudo abrir la conexión F con ${job.user}")
    socket.use { fileSocket ->
      fileSocket.soTimeout = 30_000
      val output = fileSocket.getOutputStream()
      // FileTransferInit: the raw transfer token, then the peer answers
      // with the offset it already has.
      output.write(token)
      output.flush()
      val offset = readUInt64LE(readExact(fileSocket.getInputStream(), 8))
        .coerceIn(0L, job.entry.size)

      val startedAt = System.currentTimeMillis()
      var sent = 0L
      RandomAccessFile(job.entry.file, "r").use { file ->
        file.seek(offset)
        val buffer = ByteArray(64 * 1024)
        while (running.get()) {
          val read = file.read(buffer)
          if (read <= 0) break
          output.write(buffer, 0, read)
          sent += read
        }
        output.flush()
      }
      if (sent + offset < job.entry.size) throw IllegalStateException("Subida interrumpida")

      // The downloader closes once it has everything; don't cut it short.
      runCatching {
        fileSocket.soTimeout = 10_000
        fileSocket.getInputStream().read()
      }
      completedUploads.incrementAndGet()
      val elapsedMs = (System.currentTimeMillis() - startedAt).coerceAtLeast(1L)
      if (sent > 256 * 1024) reportUploadSpeed((sent * 1000L / elapsedMs).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
    }
  }

  /** Direct connection first; otherwise ask the server to have the peer dial us. */
  private fun openFileConnection(user: String): Socket? {
    val address = lookupPeerAddress(user)
    if (address != null && address.port > 0) {
      val direct = runCatching {
        Socket().apply {
          connect(InetSocketAddress(address.host, address.port), 5_000)
          getOutputStream().apply {
            write(
              SlskMessageBuilder()
                .writeUInt8(1)
                .writeString(config.username)
                .writeString("F")
                .writeUInt32(0)
                .toPacket(),
            )
            flush()
          }
        }
      }.getOrNull()
      if (direct != null) return direct
    }

    val connectToken = randomTokenBytes()
    val waiter = LinkedBlockingQueue<Socket>()
    pierceWaiters[tokenKey(connectToken)] = waiter
    return try {
      requestIndirectFileConnection(user, connectToken)
      waiter.poll(20, TimeUnit.SECONDS)
    } finally {
      pierceWaiters.remove(tokenKey(connectToken))
    }
  }

  override fun close() {
    running.set(false)
    worker.interrupt()
    queue.clear()
  }

  private companion object {
    const val MAX_QUEUE = 20
    const val MAX_QUEUE_PER_USER = 5

    fun tokenKey(token: ByteArray): String = token.joinToString(",")

    fun readUInt64LE(bytes: ByteArray): Long {
      var value = 0L
      for (i in 7 downTo 0) value = (value shl 8) or (bytes[i].toLong() and 0xFF)
      return value
    }
  }
}
