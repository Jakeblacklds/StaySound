package expo.modules.soulseeknative


internal data class SoulseekConfig(
  val username: String,
  val password: String,
  val serverHost: String,
  val serverPort: Int,
  val listenPort: Int,
  val clientVersion: Int,
) {
  companion object {
    fun from(config: Map<String, Any?>): SoulseekConfig {
      val username = mapString(config, "username").ifBlank {
        throw IllegalArgumentException("Configura SOULSEEK_USERNAME en app.config.js")
      }
      val password = mapString(config, "password").ifBlank {
        throw IllegalArgumentException("Configura SOULSEEK_PASSWORD en app.config.js")
      }

      val serverHost = mapString(config, "serverHost", "server.slsknet.org")
      val serverPort = mapInt(config, "serverPort", 2242).coerceIn(1, 65535)
      val listenPort = mapInt(config, "listenPort", 2234).coerceIn(0, 65535)
      val clientVersion = mapInt(config, "clientVersion", 160).coerceIn(1, 9999)

      return SoulseekConfig(
        username = username,
        password = password,
        serverHost = serverHost,
        serverPort = serverPort,
        listenPort = listenPort,
        clientVersion = clientVersion,
      )
    }
  }
}

internal data class SoulseekMatch(
  val username: String,
  val filename: String,
  val size: Long,
  val extension: String?,
  val format: String?,
  val codec: String?,
  val bitRate: Int?,
  val sampleRate: Int?,
  val bitDepth: Int?,
  val durationMs: Long?,
  val slotsFree: Boolean?,
  val queueLength: Int?,
  val speed: Int?,
  val host: String?,
  val port: Int?,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "username" to username,
      "filename" to filename,
      "size" to size,
      "extension" to extension,
      "format" to format,
      "codec" to codec,
      "bitRate" to bitRate,
      "sampleRate" to sampleRate,
      "bitDepth" to bitDepth,
      "durationMs" to durationMs,
      "slotsFree" to slotsFree,
      "queueLength" to queueLength,
      "speed" to speed,
      "host" to host,
      "port" to port,
    )
  }

  companion object {
    fun from(map: Map<String, Any?>): SoulseekMatch {
      val username = mapString(map, "username").ifBlank {
        throw IllegalArgumentException("Falta username en el match de Soulseek")
      }
      val filename = mapString(map, "filename").ifBlank {
        throw IllegalArgumentException("Falta filename en el match de Soulseek")
      }

      return SoulseekMatch(
        username = username,
        filename = filename,
        size = mapLong(map, "size", 0L).coerceAtLeast(0L),
        extension = mapOptionalString(map, "extension"),
        format = mapOptionalString(map, "format"),
        codec = mapOptionalString(map, "codec"),
        bitRate = mapOptionalInt(map, "bitRate"),
        sampleRate = mapOptionalInt(map, "sampleRate"),
        bitDepth = mapOptionalInt(map, "bitDepth"),
        durationMs = mapOptionalLong(map, "durationMs"),
        slotsFree = mapOptionalBoolean(map, "slotsFree"),
        queueLength = mapOptionalInt(map, "queueLength"),
        speed = mapOptionalInt(map, "speed"),
        host = mapOptionalString(map, "host"),
        port = mapOptionalInt(map, "port")?.coerceIn(1, 65535),
      )
    }
  }
}

internal data class PeerAddress(
  val host: String,
  val port: Int,
)

internal data class ConnectToPeerInfo(
  val user: String,
  val type: String,
  val host: String,
  val port: Int,
  val token: ByteArray,
)

internal data class TransferResponse(
  val allowed: Boolean,
  val reason: String?,
  val expectedSize: Long?,
)

internal data class TransferHandshakeResult(
  val response: TransferResponse,
  val peerSocket: SlskSocket?,
)

internal data class DownloadResult(
  val path: String,
  val bytesWritten: Long,
)

