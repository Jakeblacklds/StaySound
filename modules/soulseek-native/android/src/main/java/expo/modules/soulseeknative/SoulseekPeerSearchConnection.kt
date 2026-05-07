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
) : Closeable {
  private val reader = SlskPacketReader(socket, socket.getInputStream())
  private val running = AtomicBoolean(true)
  private var worker: Thread? = null

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
        if (first == 0 || first == 1) {
          // peer init / pierce firewall handshake message
          continue
        }

        val parser = SlskMessageParser(packet)
        val code = parser.readUInt32Safe()?.toInt() ?: continue

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

