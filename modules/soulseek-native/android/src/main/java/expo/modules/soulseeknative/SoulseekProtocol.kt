package expo.modules.soulseeknative

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import kotlin.math.max

internal class SlskSocket(private val socket: Socket) : Closeable {
  private val input = socket.getInputStream()
  private val output = socket.getOutputStream()
  private val packetReader = SlskPacketReader(socket, input)

  companion object {
    fun connect(host: String, port: Int): SlskSocket {
      val socket = Socket()
      socket.connect(java.net.InetSocketAddress(host, port), 12000)
      socket.tcpNoDelay = true
      socket.keepAlive = true
      socket.soTimeout = 6000
      return SlskSocket(socket)
    }
  }

  /** Set once any read/write fails, so a pooled session knows to re-login. */
  @Volatile
  private var failed = false

  fun isOpen(): Boolean = !failed && socket.isConnected && !socket.isClosed

  fun send(payload: ByteArray) {
    try {
      synchronized(output) {
        output.write(payload)
        output.flush()
      }
    } catch (error: java.io.IOException) {
      failed = true
      throw error
    }
  }

  /** When the last complete packet arrived; a quiet server may be a dead route. */
  @Volatile
  var lastPacketAtMs = System.currentTimeMillis()
    private set

  fun readPacket(timeoutMs: Int): ByteArray? {
    return try {
      socket.soTimeout = timeoutMs
      packetReader.readPacket(timeoutMs)?.also { lastPacketAtMs = System.currentTimeMillis() }
    } catch (error: java.io.IOException) {
      failed = true
      throw error
    }
  }

  /** Mobile NATs drop idle TCP silently; the owner marks such a route dead. */
  fun markFailed() { failed = true }

  fun input(): InputStream = input

  fun setReadTimeout(timeoutMs: Int) {
    socket.soTimeout = timeoutMs
  }

  override fun close() {
    runCatching { socket.close() }
  }
}

/**
 * Reads length-prefixed packets without ever losing bytes: a timeout in the
 * middle of a header or payload keeps what already arrived and resumes on the
 * next call. (Dropping partial bytes desynchronises the stream for good, which
 * a long-lived server session eventually hits.) It also reads exactly the
 * packet's bytes, never beyond, so raw file data that follows stays in the
 * socket for whoever takes it over.
 */
internal class SlskPacketReader(
  private val socket: Socket,
  private val input: InputStream,
) {
  private val header = ByteArray(4)
  private var headerRead = 0
  private var payload: ByteArray? = null
  private var payloadRead = 0

  fun readPacket(timeoutMs: Int): ByteArray? {
    // Callers rely on the socket's own timeout for raw reads afterwards.
    val previousTimeout = socket.soTimeout
    try {
      return readPacketUntil(System.currentTimeMillis() + max(timeoutMs, 1))
    } finally {
      runCatching { socket.soTimeout = previousTimeout }
    }
  }

  private fun readPacketUntil(initialDeadline: Long): ByteArray? {
    var deadline = initialDeadline
    while (true) {
      if (headerRead < 4) {
        headerRead += readSome(header, headerRead, 4 - headerRead, deadline) ?: return null
        if (headerRead < 4) continue
        val payloadSize = readUInt32LE(header)
        if (payloadSize <= 0L) {
          headerRead = 0
          return ByteArray(0)
        }
        if (payloadSize > MAX_PACKET_BYTES) throw java.io.IOException("Paquete Soulseek invalido ($payloadSize bytes)")
        payload = ByteArray(payloadSize.toInt())
        payloadRead = 0
        // Once a packet has started, give its body a fair chance to arrive.
        deadline = max(deadline, System.currentTimeMillis() + 2_500L)
      }
      val body = payload ?: return null
      if (payloadRead < body.size) {
        payloadRead += readSome(body, payloadRead, body.size - payloadRead, deadline) ?: return null
      }
      if (payloadRead == body.size) {
        headerRead = 0; payload = null; payloadRead = 0
        return body
      }
    }
  }

  /** Bytes read, or null when the deadline passes first. */
  private fun readSome(buffer: ByteArray, offset: Int, length: Int, deadline: Long): Int? {
    val remaining = deadline - System.currentTimeMillis()
    if (remaining <= 0) return null
    socket.soTimeout = remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
    val read = try {
      input.read(buffer, offset, length)
    } catch (_: SocketTimeoutException) {
      return null
    }
    if (read < 0) throw EOFException("Socket cerrado")
    return read
  }

  private companion object {
    const val MAX_PACKET_BYTES = 64L * 1024 * 1024
  }
}

internal class SlskMessageBuilder {
  private val output = ByteArrayOutputStream()

  fun writeUInt8(value: Int): SlskMessageBuilder {
    output.write(value and 0xFF)
    return this
  }

  fun writeUInt32(value: Int): SlskMessageBuilder {
    return writeUInt32(value.toLong())
  }

  fun writeUInt32(value: Long): SlskMessageBuilder {
    val normalized = value and 0xFFFFFFFFL
    output.write((normalized and 0xFF).toInt())
    output.write(((normalized shr 8) and 0xFF).toInt())
    output.write(((normalized shr 16) and 0xFF).toInt())
    output.write(((normalized shr 24) and 0xFF).toInt())
    return this
  }

  fun writeString(value: String): SlskMessageBuilder {
    val bytes = value.toByteArray(StandardCharsets.UTF_8)
    writeUInt32(bytes.size)
    output.write(bytes)
    return this
  }

  fun writeBytes(value: ByteArray): SlskMessageBuilder {
    output.write(value)
    return this
  }

  fun writeUInt64(value: Long): SlskMessageBuilder {
    writeUInt32(value and 0xFFFFFFFFL)
    return writeUInt32((value ushr 32) and 0xFFFFFFFFL)
  }

  /** Body without the length prefix, e.g. to compress it first. */
  fun toBytes(): ByteArray = output.toByteArray()

  fun toPacket(): ByteArray {
    val body = output.toByteArray()
    val packet = ByteArrayOutputStream(body.size + 4)

    packet.write((body.size and 0xFF))
    packet.write(((body.size shr 8) and 0xFF))
    packet.write(((body.size shr 16) and 0xFF))
    packet.write(((body.size shr 24) and 0xFF))
    packet.write(body)

    return packet.toByteArray()
  }
}

internal class SlskMessageParser(private val data: ByteArray) {
  private var pointer = 0

  fun readUInt8(): Int {
    if (!canRead(1)) throw EOFException("No hay mas datos")
    return data[pointer++].toInt() and 0xFF
  }

  fun readUInt32(): Long {
    if (!canRead(4)) throw EOFException("No hay mas datos")

    val value = ((data[pointer].toLong() and 0xFFL)) or
      ((data[pointer + 1].toLong() and 0xFFL) shl 8) or
      ((data[pointer + 2].toLong() and 0xFFL) shl 16) or
      ((data[pointer + 3].toLong() and 0xFFL) shl 24)

    pointer += 4
    return value and 0xFFFFFFFFL
  }

  fun readUInt32Safe(): Long? {
    return if (canRead(4)) readUInt32() else null
  }

  fun readString(): String {
    val length = readUInt32().toInt()
    if (length <= 0) return ""

    if (!canRead(length)) throw EOFException("String incompleto")

    val value = String(data, pointer, length, StandardCharsets.UTF_8)
    pointer += length
    return value
  }

  fun readStringSafe(): String {
    return runCatching { readString() }.getOrDefault("")
  }

  fun readBytes(length: Int): ByteArray {
    if (length <= 0) return ByteArray(0)
    if (!canRead(length)) throw EOFException("Bytes incompletos")

    val bytes = data.copyOfRange(pointer, pointer + length)
    pointer += length
    return bytes
  }

  fun readRemainingBytes(): ByteArray {
    if (pointer >= data.size) return ByteArray(0)
    return data.copyOfRange(pointer, data.size)
  }

  fun canRead(length: Int): Boolean {
    return pointer + length <= data.size
  }
}

