package expo.modules.soulseeknative

import java.io.Closeable
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.net.SocketTimeoutException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

internal class SoulseekTransferClient(
  private val config: SoulseekConfig,
  private val cancelled: AtomicBoolean,
  private val serverSocket: SlskSocket,
  private val closeables: CopyOnWriteArrayList<Closeable>,
  private val peerAddresses: ConcurrentHashMap<String, PeerAddress>,
  private val pumpIncomingPeerSocket: () -> Unit,
  private val handleUnhandledServerCode: (Int, SlskMessageParser) -> Unit,
) {
  fun download(match: SoulseekMatch, outputPath: String): DownloadResult {
    ensureNotCancelled(cancelled)

    val address = resolvePeerAddress(match.username, match.host, match.port)
    ensureNotCancelled(cancelled)

    val token = randomTokenBytes()

    val transferHandshake = requestTransferWithFallback(
      host = address.host,
      port = address.port,
      token = token,
      filename = match.filename,
    )

    val transferResponse = transferHandshake.response

    ensureNotCancelled(cancelled)

    val targetPath = normalizeOutputPath(outputPath)
    val targetFile = File(targetPath)
    targetFile.parentFile?.mkdirs()
    if (targetFile.exists()) {
      targetFile.delete()
    }

    val expectedSize = listOf(
      transferResponse.expectedSize,
      match.size.takeIf { it > 0L },
    ).firstOrNull { it != null && it > 0L } ?: 0L

    if (transferResponse.allowed) {
      downloadFileWithFallback(
        host = address.host,
        port = address.port,
        token = token,
        targetFile = targetFile,
        expectedSize = expectedSize,
      )
    } else if (isQueuedReason(transferResponse.reason)) {
      val queuedSocket = transferHandshake.peerSocket
        ?: throw IllegalStateException("El peer dejo la descarga en cola. Reintenta en unos segundos.")

      val queuedTransfer = waitForQueuedTransferStartRequest(
        peerSocket = queuedSocket,
        expectedFilename = match.filename,
        timeoutMs = 90_000,
      )

      val queuedExpectedSize = listOf(
        queuedTransfer.expectedSize,
        expectedSize.takeIf { it > 0L },
      ).firstOrNull { it != null && it > 0L } ?: 0L

      sendQueuedTransferAcceptance(
        peerSocket = queuedSocket,
        token = queuedTransfer.token,
        expectedSize = queuedExpectedSize,
      )

      downloadFileWithFallback(
        host = address.host,
        port = address.port,
        token = queuedTransfer.token,
        targetFile = targetFile,
        expectedSize = queuedExpectedSize,
      )
    } else {
      val reason = transferResponse.reason?.takeIf { it.isNotBlank() } ?: "Peer rechazo la descarga."
      throw IllegalStateException(reason)
    }

    return DownloadResult(
      path = targetFile.absolutePath,
      bytesWritten = targetFile.length(),
    )
  }

  private fun requestTransferWithFallback(
    host: String,
    port: Int,
    token: ByteArray,
    filename: String,
  ): TransferHandshakeResult {
    val attemptErrors = ArrayList<String>()
    val modes = listOf("plain", "peer-init-p", "pierce-fw")

    for (mode in modes) {
      ensureNotCancelled(cancelled)
      var peerSocket: SlskSocket? = null
      try {
        peerSocket = SlskSocket.connect(host, port)
        closeables.add(peerSocket)

        when (mode) {
          "peer-init-p" -> {
            peerSocket.send(
              SlskMessageBuilder()
                .writeUInt8(1)
                .writeString(config.username)
                .writeString("P")
                .writeBytes(token)
                .toPacket(),
            )
            Thread.sleep(120)
          }

          "pierce-fw" -> {
            peerSocket.send(
              SlskMessageBuilder()
                .writeUInt8(0)
                .writeBytes(token)
                .toPacket(),
            )
            Thread.sleep(120)
          }
        }

        peerSocket.send(
          SlskMessageBuilder()
            .writeUInt32(40)
            .writeUInt32(0)
            .writeBytes(token)
            .writeString(filename)
            .toPacket(),
        )

        val response = waitForTransferResponse(peerSocket)

        return if (response.allowed || isQueuedReason(response.reason)) {
          TransferHandshakeResult(
            response = response,
            peerSocket = peerSocket,
          )
        } else {
          TransferHandshakeResult(
            response = response,
            peerSocket = null,
          )
        }
      } catch (error: Exception) {
        runCatching { peerSocket?.close() }
        attemptErrors.add("$mode: ${error.message ?: error::class.java.simpleName}")
      }
    }

    throw IllegalStateException("Soulseek no pudo iniciar transferencia (${attemptErrors.joinToString(" | ")})")
  }

  private fun isQueuedReason(reason: String?): Boolean {
    val normalized = reason?.trim()?.lowercase(Locale.US) ?: return false
    return normalized.startsWith("queued")
  }

  private fun waitForQueuedTransferStartRequest(
    peerSocket: SlskSocket,
    expectedFilename: String,
    timeoutMs: Int,
  ): QueuedTransferStart {
    val normalizedExpected = expectedFilename.trim().lowercase(Locale.US)
    val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(10_000)

    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)

      val packet = peerSocket.readPacket(900) ?: continue
      if (packet.isEmpty()) continue

      val first = packet[0].toInt() and 0xFF
      if (first == 0 || first == 1) {
        continue
      }

      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32Safe()?.toInt() ?: continue

      when (code) {
        40 -> {
          val direction = parser.readUInt32Safe()?.toInt() ?: continue
          val queuedToken = parser.readBytes(4)
          val filename = parser.readStringSafe().trim().lowercase(Locale.US)

          if (direction != 1) {
            continue
          }

          if (normalizedExpected.isNotBlank() && filename.isNotBlank() && filename != normalizedExpected) {
            continue
          }

          val sizeLow = parser.readUInt32Safe()
          val sizeHigh = parser.readUInt32Safe()
          val expectedSize = if (sizeLow == null) {
            null
          } else {
            val low = sizeLow and 0xFFFFFFFFL
            val high = (sizeHigh ?: 0L) and 0xFFFFFFFFL
            (high shl 32) or low
          }

          return QueuedTransferStart(
            token = queuedToken,
            expectedSize = expectedSize,
          )
        }

        44 -> {
          // place in queue updates while we wait
        }

        46 -> {
          val failedFile = parser.readStringSafe()
          throw IllegalStateException("El peer reporto fallo de subida (${failedFile.ifBlank { "archivo" }}).")
        }
      }
    }

    throw SocketTimeoutException("El peer no inicio la descarga desde la cola a tiempo.")
  }

  private fun sendQueuedTransferAcceptance(
    peerSocket: SlskSocket,
    token: ByteArray,
    expectedSize: Long,
  ) {
    val low = expectedSize and 0xFFFFFFFFL
    val high = (expectedSize ushr 32) and 0xFFFFFFFFL

    peerSocket.send(
      SlskMessageBuilder()
        .writeUInt32(41)
        .writeBytes(token)
        .writeUInt8(1)
        .writeUInt32(low)
        .writeUInt32(high)
        .toPacket(),
    )
  }

  private fun downloadFileWithFallback(
    host: String,
    port: Int,
    token: ByteArray,
    targetFile: File,
    expectedSize: Long,
  ) {
    val errors = ArrayList<String>()
    val modes = listOf("peer-init-f", "pierce-fw")

    repeat(3) { round ->
      for (mode in modes) {
        ensureNotCancelled(cancelled)
        try {
          val bytesWritten = downloadFileOnce(host, port, token, targetFile, expectedSize, mode)
          if (bytesWritten > 0L) return
        } catch (error: Exception) {
          errors.add("r${round + 1}-$mode: ${error.message ?: error::class.java.simpleName}")
        }
      }

      if (round < 2) {
        Thread.sleep(220L + (round * 180L))
      }
    }

    throw EOFException("Socket cerrado (${errors.joinToString(" | ")})")
  }

  private fun downloadFileOnce(
    host: String,
    port: Int,
    token: ByteArray,
    targetFile: File,
    expectedSize: Long,
    mode: String,
  ): Long {
    if (targetFile.exists()) targetFile.delete()

    val fileSocket = SlskSocket.connect(host, port)
    closeables.add(fileSocket)

    val input = fileSocket.input()

    when (mode) {
      "peer-init-f" -> {
        fileSocket.send(
          SlskMessageBuilder()
            .writeUInt8(1)
            .writeString(config.username)
            .writeString("F")
            .writeBytes(token)
            .toPacket(),
        )
      }

      "pierce-fw" -> {
        fileSocket.send(
          SlskMessageBuilder()
            .writeUInt8(0)
            .writeBytes(token)
            .toPacket(),
        )
      }
    }

    Thread.sleep(160)

    fileSocket.send(token)

    fileSocket.send(ByteArray(8) { 0 })

    FileOutputStream(targetFile).use { output ->
      val buffer = ByteArray(64 * 1024)
      var totalBytes = 0L
      fileSocket.setReadTimeout(12_000)

      while (true) {
        ensureNotCancelled(cancelled)

        val read = try {
          input.read(buffer)
        } catch (_: SocketTimeoutException) {
          if (expectedSize > 0L && totalBytes >= expectedSize) break
          continue
        }

        if (read <= 0) break
        output.write(buffer, 0, read)
        totalBytes += read.toLong()
        if (expectedSize > 0L && totalBytes >= expectedSize) break
      }

      output.flush()
      if (totalBytes <= 0L) throw EOFException("Socket cerrado")
      return totalBytes
    }
  }

  private fun resolvePeerAddress(username: String, hostHint: String?, portHint: Int?): PeerAddress {
    if (!hostHint.isNullOrBlank() && portHint != null && portHint > 0) {
      return PeerAddress(hostHint, portHint)
    }

    val cached = peerAddresses[username]
    if (cached != null) {
      return cached
    }

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(3)
        .writeString(username)
        .toPacket(),
    )

    val deadline = System.currentTimeMillis() + 12000L
    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)

      pumpIncomingPeerSocket()

      val packet = serverSocket.readPacket(600) ?: continue
      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()

      if (code == 3) {
        val user = parser.readStringSafe()
        if (user.isBlank()) continue

        val ipBytes = ByteArray(4)
        for (i in 0 until 4) {
          ipBytes[i] = parser.readUInt8().toByte()
        }

        val host = "${ipBytes[3].toUByte().toInt()}.${ipBytes[2].toUByte().toInt()}.${ipBytes[1].toUByte().toInt()}.${ipBytes[0].toUByte().toInt()}"
        val port = parser.readUInt32().toInt()

        val address = PeerAddress(host, port)
        peerAddresses[user] = address

        if (user == username) {
          return address
        }
      } else {
        handleUnhandledServerCode(code, parser)
      }
    }

    throw IllegalStateException("No se pudo resolver la direccion del peer en Soulseek.")
  }

  private fun waitForTransferResponse(peerSocket: SlskSocket): TransferResponse {
    val deadline = System.currentTimeMillis() + 15000L

    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)

      val packet = peerSocket.readPacket(900) ?: continue

      if (packet.isEmpty()) continue
      if (packet[0].toInt() == 0 || packet[0].toInt() == 1) {
        // peer init / pierce firewall handshake packet
        continue
      }

      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()
      if (code != 41) {
        continue
      }

      parser.readBytes(4) // token
      val allowed = parser.readUInt8() == 1
      if (!allowed) {
        return TransferResponse(
          allowed = false,
          reason = parser.readStringSafe(),
          expectedSize = null,
        )
      }

      val sizeLow = parser.readUInt32Safe()
      val sizeHigh = parser.readUInt32Safe()
      val size = if (sizeLow == null) {
        null
      } else {
        val low = sizeLow and 0xFFFFFFFFL
        val high = (sizeHigh ?: 0L) and 0xFFFFFFFFL
        (high shl 32) or low
      }

      return TransferResponse(
        allowed = true,
        reason = null,
        expectedSize = size,
      )
    }

    throw IllegalStateException("Soulseek no confirmo la transferencia a tiempo.")
  }
}

private data class QueuedTransferStart(
  val token: ByteArray,
  val expectedSize: Long?,
)
