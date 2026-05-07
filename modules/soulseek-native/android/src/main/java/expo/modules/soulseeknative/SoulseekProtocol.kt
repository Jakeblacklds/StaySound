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

  fun send(payload: ByteArray) {
    synchronized(output) {
      output.write(payload)
      output.flush()
    }
  }

  fun readPacket(timeoutMs: Int): ByteArray? {
    socket.soTimeout = timeoutMs
    return packetReader.readPacket(timeoutMs)
  }

  fun input(): InputStream = input

  fun setReadTimeout(timeoutMs: Int) {
    socket.soTimeout = timeoutMs
  }

  override fun close() {
    runCatching { socket.close() }
  }
}

internal class SlskPacketReader(
  private val socket: Socket,
  private val input: InputStream,
) {
  fun readPacket(timeoutMs: Int): ByteArray? {
    val header = try {
      readFully(4)
    } catch (_: SocketTimeoutException) {
      return null
    }

    val payloadSize = readUInt32LE(header).toInt()
    if (payloadSize <= 0) {
      return ByteArray(0)
    }

    val previousTimeout = socket.soTimeout
    socket.soTimeout = max(timeoutMs, 2500)
    return try {
      readFully(payloadSize)
    } catch (_: SocketTimeoutException) {
      null
    } finally {
      socket.soTimeout = previousTimeout
    }
  }

  private fun readFully(length: Int): ByteArray {
    val buffer = ByteArray(length)
    var offset = 0

    while (offset < length) {
      val read = input.read(buffer, offset, length - offset)
      if (read < 0) {
        throw EOFException("Socket cerrado")
      }
      offset += read
    }

    return buffer
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

