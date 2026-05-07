package expo.modules.soulseeknative

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream
import java.net.ServerSocket
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.InflaterInputStream
import kotlin.random.Random

internal fun openIncomingPeerServer(preferredPort: Int): ServerSocket {
  return try {
    if (preferredPort > 0) {
      ServerSocket(preferredPort)
    } else {
      ServerSocket(0)
    }
  } catch (_: Exception) {
    ServerSocket(0)
  }
}

internal fun ensureNotCancelled(cancelled: AtomicBoolean) {
  if (cancelled.get()) {
    throw IllegalStateException("Operacion Soulseek cancelada")
  }
}

internal fun randomTokenBytes(): ByteArray {
  val bytes = ByteArray(4)
  Random.Default.nextBytes(bytes)
  return bytes
}

internal fun inflateBytes(data: ByteArray): ByteArray {
  InflaterInputStream(ByteArrayInputStream(data)).use { inflater ->
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(32 * 1024)

    while (true) {
      val read = inflater.read(buffer)
      if (read <= 0) break
      output.write(buffer, 0, read)
    }

    return output.toByteArray()
  }
}

internal fun normalizeOutputPath(raw: String): String {
  val trimmed = raw.trim()
  if (trimmed.startsWith("file://")) {
    return trimmed.removePrefix("file://")
  }
  return trimmed
}

internal fun md5Hex(input: String): String {
  val digest = MessageDigest.getInstance("MD5")
  val bytes = digest.digest(input.toByteArray(StandardCharsets.UTF_8))
  return bytes.joinToString(separator = "") { "%02x".format(Locale.US, it) }
}

internal fun readUInt32LE(bytes: ByteArray): Long {
  return ((bytes[0].toLong() and 0xFFL)) or
    ((bytes[1].toLong() and 0xFFL) shl 8) or
    ((bytes[2].toLong() and 0xFFL) shl 16) or
    ((bytes[3].toLong() and 0xFFL) shl 24)
}

internal fun readExact(input: InputStream, count: Int): ByteArray {
  val out = ByteArray(count)
  var offset = 0
  while (offset < count) {
    val read = input.read(out, offset, count - offset)
    if (read < 0) throw EOFException("Socket cerrado")
    offset += read
  }
  return out
}

internal fun mapString(map: Map<String, Any?>, key: String, default: String = ""): String {
  val value = map[key] ?: return default
  return when (value) {
    is String -> value.trim()
    else -> value.toString().trim()
  }
}

internal fun mapOptionalString(map: Map<String, Any?>, key: String): String? {
  val value = map[key] ?: return null
  val normalized = when (value) {
    is String -> value.trim()
    else -> value.toString().trim()
  }
  return normalized.ifBlank { null }
}

internal fun mapInt(map: Map<String, Any?>, key: String, default: Int = 0): Int {
  val value = map[key] ?: return default
  return when (value) {
    is Number -> value.toInt()
    is String -> value.toIntOrNull() ?: default
    else -> default
  }
}

internal fun mapOptionalInt(map: Map<String, Any?>, key: String): Int? {
  val value = map[key] ?: return null
  return when (value) {
    is Number -> value.toInt()
    is String -> value.toIntOrNull()
    else -> null
  }
}

internal fun mapLong(map: Map<String, Any?>, key: String, default: Long = 0L): Long {
  val value = map[key] ?: return default
  return when (value) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull() ?: default
    else -> default
  }
}

internal fun mapOptionalLong(map: Map<String, Any?>, key: String): Long? {
  val value = map[key] ?: return null
  return when (value) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull()
    else -> null
  }
}

internal fun mapOptionalBoolean(map: Map<String, Any?>, key: String): Boolean? {
  val value = map[key] ?: return null
  return when (value) {
    is Boolean -> value
    is Number -> value.toInt() != 0
    is String -> {
      when (value.trim().lowercase(Locale.US)) {
        "1", "true", "yes" -> true
        "0", "false", "no" -> false
        else -> null
      }
    }
    else -> null
  }
}
