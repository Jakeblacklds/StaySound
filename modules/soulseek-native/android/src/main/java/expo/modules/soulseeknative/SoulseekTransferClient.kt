package expo.modules.soulseeknative

import java.io.Closeable
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.Socket
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
  private val acquirePeerMessageConnection: (String, PeerAddress) -> PeerSearchConnection,
  private val pumpIncomingPeerSocket: () -> Unit,
  private val pumpServerPackets: () -> Unit,
  private val pollIncomingTransferRequest: () -> IncomingTransferRequest?,
  private val pollIncomingTransferFailure: () -> String?,
  private val pollIncomingFileSocket: () -> Socket?,
  private val pollIncomingFileConnectRequest: () -> ConnectToPeerInfo?,
  private val handleUnhandledServerCode: (Int, SlskMessageParser) -> Unit,
) {
  fun download(match: SoulseekMatch, outputPath: String): DownloadResult {
    ensureNotCancelled(cancelled)

    val address = resolvePeerAddress(match.username, match.host, match.port)
    ensureNotCancelled(cancelled)

    val targetPath = normalizeOutputPath(outputPath)
    val targetFile = File(targetPath)
    targetFile.parentFile?.mkdirs()
    if (targetFile.exists()) {
      targetFile.delete()
    }

    val queuedTransfer = requestModernQueuedTransfer(
      username = match.username,
      address = address,
      filename = match.filename,
      // A peer that advertised a free slot offers the file within seconds;
      // when it doesn't, the next candidate is a better bet than waiting.
      // Queued peers get longer, but Seeker's experience is that peers with
      // no free slot rarely start at all, so they are ranked last anyway.
      timeoutMs = if (match.slotsFree == true) 25_000 else 60_000,
    )
    val expectedSize = listOf(
      queuedTransfer.expectedSize,
      match.size.takeIf { it > 0L },
    ).firstOrNull { it != null && it > 0L } ?: 0L

    sendQueuedTransferAcceptance(
      reply = queuedTransfer.reply,
      token = queuedTransfer.token,
    )
    receiveQueuedFileLikeDesktop(
      username = match.username,
      address = address,
      token = queuedTransfer.token,
      targetFile = targetFile,
      expectedSize = expectedSize,
    )

    return DownloadResult(
      path = targetFile.absolutePath,
      bytesWritten = targetFile.length(),
    )
  }

  private fun requestModernQueuedTransfer(
    username: String,
    address: PeerAddress,
    filename: String,
    timeoutMs: Int,
  ): QueuedTransferStart {
    val peerConnection = acquirePeerMessageConnection(username, address)
    peerConnection.send(
      SlskMessageBuilder()
        .writeUInt32(43)
        .writeString(filename)
        .toPacket(),
    )
    peerConnection.send(
      SlskMessageBuilder()
        .writeUInt32(51)
        .writeString(filename)
        .toPacket(),
    )

    val normalizedExpected = filename.trim().lowercase(Locale.US)
    val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(5_000)
    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)
      pumpIncomingPeerSocket()
      pumpServerPackets()

      pollIncomingTransferFailure()?.let { failure ->
        throw IllegalStateException(failure)
      }

      while (true) {
        val incoming = pollIncomingTransferRequest() ?: break
        val incomingFilename = incoming.filename.trim().lowercase(Locale.US)
        if (
          normalizedExpected.isNotBlank() &&
          incomingFilename.isNotBlank() &&
          incomingFilename != normalizedExpected
        ) {
          continue
        }

        return QueuedTransferStart(
          token = incoming.token,
          expectedSize = incoming.expectedSize,
          reply = incoming.reply,
        )
      }
    }

    throw SocketTimeoutException("El peer no inicio QueueUpload a tiempo.")
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

      // The uploader may deliver its TransferRequest over a brand-new connection
      // (direct to our listen socket or indirect via server ConnectToPeer) instead
      // of the peer socket we opened, so pump those sources too.
      pumpIncomingPeerSocket()
      pumpServerPackets()

      while (true) {
        val incoming = pollIncomingTransferRequest() ?: break
        val incomingFilename = incoming.filename.trim().lowercase(Locale.US)
        if (normalizedExpected.isNotBlank() && incomingFilename.isNotBlank() && incomingFilename != normalizedExpected) {
          continue
        }

        return QueuedTransferStart(
          token = incoming.token,
          expectedSize = incoming.expectedSize,
          reply = incoming.reply,
        )
      }

      val packet = try {
        peerSocket.readPacket(400)
      } catch (_: Exception) {
        null
      } ?: continue
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
            reply = { payload -> peerSocket.send(payload) },
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
    reply: (ByteArray) -> Unit,
    token: ByteArray,
  ) {
    // This mirrors the desktop client: TransferResponse for an uploader's
    // direction=1 request contains only token + allowed. The file size belongs
    // to TransferRequest and must not be echoed back.
    reply(
      SlskMessageBuilder()
        .writeUInt32(41)
        .writeBytes(token)
        .writeUInt8(1)
        .toPacket(),
    )
  }

  private fun receiveQueuedFileLikeDesktop(
    username: String,
    address: PeerAddress,
    token: ByteArray,
    targetFile: File,
    expectedSize: Long,
  ) {
    val errors = ArrayList<String>()
    val secondChanceAt = System.currentTimeMillis() + 3_000L
    // True once the uploader answered on an F channel with our token: from
    // then on a stall is the peer's doing, and dialing it again won't help.
    var engaged = false

    // Tauri first lets the uploader create the F connection. This may arrive
    // directly on our listen socket or as a server-assisted ConnectToPeer F.
    while (System.currentTimeMillis() < secondChanceAt) {
      ensureNotCancelled(cancelled)
      pumpIncomingPeerSocket()
      pumpServerPackets()

      while (true) {
        val socket = pollIncomingFileSocket() ?: break
        try {
          val fileSocket = SlskSocket(socket)
          closeables.add(fileSocket)
          val receivedToken = readRawToken(fileSocket.input())
          if (!receivedToken.contentEquals(token)) {
            fileSocket.close()
            continue
          }
          engaged = true
          val startOffset = sendFileOffset(fileSocket, targetFile)
          android.util.Log.i(LOG_TAG, "F entrante de $username listo, offset=$startOffset")
          receiveFilePayload(fileSocket, targetFile, expectedSize, startOffset)
          return
        } catch (error: Exception) {
          android.util.Log.w(LOG_TAG, "incoming-f $username: ${error.message}")
          errors.add("incoming-f: ${error.message ?: error::class.java.simpleName}")
          runCatching { socket.close() }
        }
      }

      while (true) {
        val request = pollIncomingFileConnectRequest() ?: break
        if (!request.type.equals("F", ignoreCase = true) || request.user != username) continue
        try {
          val fileSocket = SlskSocket.connect(request.host, request.port)
          closeables.add(fileSocket)
          fileSocket.send(
            SlskMessageBuilder()
              .writeUInt8(0)
              .writeBytes(request.token)
              .toPacket(),
          )
          val receivedToken = readRawToken(fileSocket.input())
          if (!receivedToken.contentEquals(token)) {
            fileSocket.close()
            continue
          }
          engaged = true
          val startOffset = sendFileOffset(fileSocket, targetFile)
          android.util.Log.i(LOG_TAG, "F indirecto con $username listo, offset=$startOffset")
          receiveFilePayload(fileSocket, targetFile, expectedSize, startOffset)
          return
        } catch (error: Exception) {
          android.util.Log.w(LOG_TAG, "connect-to-peer-f $username: ${error.message}")
          errors.add("connect-to-peer-f: ${error.message ?: error::class.java.simpleName}")
        }
      }

      Thread.sleep(20)
    }

    if (engaged) {
      // The peer took the transfer and then stopped sending: move on to the
      // next source now instead of spending another stall timeout here.
      throw EOFException("El peer dejo de enviar datos (${errors.joinToString(" | ")})")
    }

    // Same second chance as Tauri: if the uploader could not reach our phone,
    // connect to its advertised port with PeerInit F, then raw token + offset.
    try {
      downloadFileOnce(
        host = address.host,
        port = address.port,
        token = token,
        targetFile = targetFile,
        expectedSize = expectedSize,
        mode = "peer-init-f",
      )
    } catch (error: Exception) {
      errors.add("second-chance-f: ${error.message ?: error::class.java.simpleName}")
      throw EOFException("No se pudo abrir el canal F (${errors.joinToString(" | ")})")
    }
  }

  private fun readRawToken(input: InputStream): ByteArray {
    val token = ByteArray(4)
    var offset = 0
    while (offset < token.size) {
      val read = input.read(token, offset, token.size - offset)
      if (read < 0) throw EOFException("El peer cerro el canal F antes del token")
      offset += read
    }
    return token
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
          downloadFileOnce(host, port, token, targetFile, expectedSize, mode)

          val complete = if (expectedSize > 0L) {
            targetFile.length() >= expectedSize
          } else {
            targetFile.length() > 0L
          }
          if (complete) return

          errors.add("r${round + 1}-$mode: transferencia incompleta (${targetFile.length()}/$expectedSize)")
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
    // Resume from whatever a previous attempt already wrote instead of restarting.
    val startOffset = if (targetFile.exists()) targetFile.length() else 0L
    if (expectedSize in 1..startOffset) return 0L

    if (port <= 0 || host.isBlank()) throw IllegalStateException("sin direccion directa del peer")
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
            .writeBytes(ByteArray(4))
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

    val offsetBytes = ByteArray(8)
    for (i in 0 until 8) {
      offsetBytes[i] = ((startOffset ushr (i * 8)) and 0xFFL).toByte()
    }
    fileSocket.send(offsetBytes)

    return receiveFilePayload(fileSocket, targetFile, expectedSize, startOffset)
  }

  private fun receiveFilePayload(
    fileSocket: SlskSocket,
    targetFile: File,
    expectedSize: Long,
    startOffset: Long = if (targetFile.exists()) targetFile.length() else 0L,
  ): Long {
    val input = fileSocket.input()
    FileOutputStream(targetFile, true).use { output ->
      val buffer = ByteArray(64 * 1024)
      var totalBytes = startOffset
      var newBytes = 0L
      var lastDataAtMs = System.currentTimeMillis()
      fileSocket.setReadTimeout(12_000)

      while (true) {
        ensureNotCancelled(cancelled)

        val read = try {
          input.read(buffer)
        } catch (_: SocketTimeoutException) {
          if (expectedSize > 0L && totalBytes >= expectedSize) break
          if (System.currentTimeMillis() - lastDataAtMs > 30_000L) {
            android.util.Log.w(LOG_TAG, "Transferencia estancada tras ${totalBytes - startOffset} bytes nuevos")
            throw SocketTimeoutException("Transferencia estancada")
          }
          continue
        }

        if (read <= 0) break
        output.write(buffer, 0, read)
        totalBytes += read.toLong()
        newBytes += read.toLong()
        lastDataAtMs = System.currentTimeMillis()
        if (expectedSize > 0L && totalBytes >= expectedSize) break
      }

      output.flush()
      if (newBytes <= 0L && startOffset <= 0L) throw EOFException("Socket cerrado")
      return newBytes
    }
  }

  private fun sendFileOffset(fileSocket: SlskSocket, targetFile: File): Long {
    val startOffset = if (targetFile.exists()) targetFile.length() else 0L
    val offsetBytes = ByteArray(8)
    for (i in 0 until 8) {
      offsetBytes[i] = ((startOffset ushr (i * 8)) and 0xFFL).toByte()
    }
    fileSocket.send(offsetBytes)
    return startOffset
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

    val deadline = System.currentTimeMillis() + 8_000L
    val seenCodes = ArrayList<Int>()
    android.util.Log.i(LOG_TAG, "GetPeerAddress($username) enviado; socket abierto=${serverSocket.isOpen()}")
    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)

      pumpIncomingPeerSocket()
      // Another pump (search, uploads) may already have stored the answer.
      peerAddresses[username]?.let { return it }

      // Drain quickly: the answer may be queued behind a flood of
      // ConnectToPeer requests from the search that just finished.
      val packet = serverSocket.readPacket(if (seenCodes.isEmpty()) 600 else 20) ?: continue
      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()
      if (seenCodes.size < 40) seenCodes.add(code)

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

        android.util.Log.i(LOG_TAG, "PeerAddress($user) = $host:$port")
        if (user == username) {
          return address
        }
      } else {
        handleUnhandledServerCode(code, parser)
      }
    }

    android.util.Log.w(LOG_TAG, "GetPeerAddress($username) sin respuesta en 8 s; codigos recibidos=$seenCodes")
    // Not fatal: without an address the direct attempts simply fail fast and
    // the transfer continues over the server-brokered (indirect) connections,
    // which is also what works for most peers behind NAT.
    return UNKNOWN_ADDRESS
  }

  private companion object {
    val UNKNOWN_ADDRESS = PeerAddress("", 0)
    const val LOG_TAG = "StaySoundSoulseek"
  }

  private fun waitForTransferResponse(peerSocket: SlskSocket): TransferResponse {
    val deadline = System.currentTimeMillis() + 8000L

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

private class QueuedTransferStart(
  val token: ByteArray,
  val expectedSize: Long?,
  val reply: (ByteArray) -> Unit,
)
