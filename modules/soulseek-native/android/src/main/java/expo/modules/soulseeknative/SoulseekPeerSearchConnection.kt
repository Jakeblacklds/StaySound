package expo.modules.soulseeknative

import java.io.Closeable
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

internal class PeerSearchConnection(
  private val socket: Socket,
  private val onMatch: (SoulseekMatch) -> Unit,
  private val onTransferRequest: ((IncomingTransferRequest) -> Unit)? = null,
  private val onIdentity: ((String, PeerSearchConnection) -> Unit)? = null,
) : Closeable {
  private val reader = SlskPacketReader(socket, socket.getInputStream())
  private val output = socket.getOutputStream()
  private val running = AtomicBoolean(true)
  private var worker: Thread? = null

  fun send(payload: ByteArray) {
    synchronized(output) {
      output.write(payload)
      output.flush()
    }
  }

  fun isOpen(): Boolean = running.get() && socket.isConnected && !socket.isClosed

  fun start() {
    worker = Thread {
      while (running.get()) {
        val packet = try {
          reader.readPacket(socket.soTimeout)
        } catch (_: SocketTimeoutException) {
          continue
        } catch (_: Exception) {
          break
        } ?: continue

        if (packet.isEmpty()) continue

        val first = packet[0].toInt() and 0xFF
        if (first == 1) {
          handlePeerInitPacket(packet)
          continue
        }
        if (first == 0) {
          // pierce firewall handshake message
          continue
        }

        val parser = SlskMessageParser(packet)
        val code = parser.readUInt32Safe()?.toInt() ?: continue

        if (code == 40) {
          handleTransferRequestPacket(parser)
          continue
        }

        if (code != 9) continue

        val compressed = parser.readRemainingBytes()
        if (compressed.isEmpty()) continue

        val inflated = runCatching { inflateBytes(compressed) }.getOrNull() ?: continue
        parseSearchReply(inflated).forEach(onMatch)
      }
    }

    worker?.name = "SoulseekPeerSearch"
    worker?.isDaemon = true
    worker?.start()
  }

  override fun close() {
    running.set(false)
    runCatching { socket.close() }
  }

  private fun handlePeerInitPacket(packet: ByteArray) {
    val parser = SlskMessageParser(packet)
    if (parser.readUInt8() != 1) return
    val username = parser.readStringSafe()
    val type = parser.readStringSafe()
    if (username.isBlank() || !type.equals("P", ignoreCase = true)) return
    onIdentity?.invoke(username, this)
  }

  private fun handleTransferRequestPacket(parser: SlskMessageParser) {
    val callback = onTransferRequest ?: return

    val direction = parser.readUInt32Safe()?.toInt() ?: return
    if (direction != 1) return

    val token = runCatching { parser.readBytes(4) }.getOrNull() ?: return
    val filename = parser.readStringSafe()
    if (filename.isBlank()) return

    val sizeLow = parser.readUInt32Safe()
    val sizeHigh = parser.readUInt32Safe()
    val expectedSize = if (sizeLow == null) {
      null
    } else {
      ((sizeHigh ?: 0L) and 0xFFFFFFFFL shl 32) or (sizeLow and 0xFFFFFFFFL)
    }

    callback(
      IncomingTransferRequest(
        token = token,
        filename = filename,
        expectedSize = expectedSize,
        reply = ::send,
      ),
    )
  }

  private fun parseSearchReply(data: ByteArray): List<SoulseekMatch> {
    val parser = SlskMessageParser(data)
    val username = parser.readStringSafe().ifBlank { return emptyList() }
    parser.readBytes(4) // token

    val fileCount = parser.readUInt32Safe()?.toInt()?.coerceAtLeast(0) ?: return emptyList()
    val output = ArrayList<SoulseekMatch>(min(fileCount, 120))

    repeat(fileCount) {
      if (!parser.canRead(1)) return@repeat
      parser.readUInt8() // code

      val filename = parser.readStringSafe()
      if (filename.isBlank()) return@repeat

      val low = parser.readUInt32Safe() ?: return@repeat
      val high = parser.readUInt32Safe() ?: 0L
      val size = ((high and 0xFFFFFFFFL) shl 32) or (low and 0xFFFFFFFFL)

      parser.readStringSafe() // ext from wire, usually empty

      val attribCount = parser.readUInt32Safe()?.toInt()?.coerceAtLeast(0) ?: 0
      var bitRate: Int? = null
      var sampleRate: Int? = null
      var bitDepth: Int? = null
      var durationMs: Long? = null

      repeat(attribCount) {
        val key = parser.readUInt32Safe()?.toInt() ?: return@repeat
        val value = parser.readUInt32Safe()?.toInt() ?: return@repeat

        when (key) {
          0 -> bitRate = value
          1 -> durationMs = value.toLong() * 1000L
          4 -> sampleRate = value
          5 -> bitDepth = value
        }
      }

      val extension = filename.substringAfterLast('.', "").lowercase(Locale.US)

      output.add(
        SoulseekMatch(
          username = username,
          filename = filename,
          size = max(0L, size),
          extension = extension.ifBlank { null },
          format = extension.ifBlank { null }?.uppercase(Locale.US),
          codec = extension.ifBlank { null },
          bitRate = bitRate,
          sampleRate = sampleRate,
          bitDepth = bitDepth,
          durationMs = durationMs,
          slotsFree = null,
          queueLength = null,
          speed = null,
          host = null,
          port = null,
        ),
      )
    }

    val hasSlots = if (parser.canRead(1)) parser.readUInt8() == 1 else null
    val speed = parser.readUInt32Safe()?.toInt()
    val queueLength = parser.readUInt32Safe()?.toInt()

    if (hasSlots != null || speed != null || queueLength != null) {
      return output.map {
        it.copy(
          slotsFree = hasSlots,
          speed = speed,
          queueLength = queueLength,
        )
      }
    }

    return output
  }
}

