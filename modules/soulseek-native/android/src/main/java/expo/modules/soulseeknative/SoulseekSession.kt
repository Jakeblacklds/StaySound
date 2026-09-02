package expo.modules.soulseeknative

import java.io.Closeable
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

internal class SoulseekSession(
  private val config: SoulseekConfig,
  private val cancelled: AtomicBoolean,
) : Closeable {
  private val closeables = CopyOnWriteArrayList<Closeable>()
  private val peerConnections = CopyOnWriteArrayList<PeerSearchConnection>()
  private val searchResults = LinkedBlockingQueue<SoulseekMatch>()
  private val incomingTransferRequests = LinkedBlockingQueue<IncomingTransferRequest>()
  private val incomingTransferFailures = LinkedBlockingQueue<String>()
  private val incomingFileSockets = LinkedBlockingQueue<Socket>()
  private val incomingFileConnectRequests = LinkedBlockingQueue<ConnectToPeerInfo>()
  private val peerAddresses = ConcurrentHashMap<String, PeerAddress>()
  private val peerMessageConnections = ConcurrentHashMap<String, PeerSearchConnection>()

  private lateinit var serverSocket: SlskSocket
  private lateinit var incomingPeerServer: ServerSocket

  fun connectAndLogin() {
    ensureNotCancelled(cancelled)

    incomingPeerServer = openIncomingPeerServer(config.listenPort)
    closeables.add(incomingPeerServer)

    serverSocket = SlskSocket.connect(config.serverHost, config.serverPort)
    closeables.add(serverSocket)

    val loginMessage = SlskMessageBuilder()
      .writeUInt32(1)
      .writeString(config.username)
      .writeString(config.password)
      .writeUInt32(config.clientVersion)
      .writeString(md5Hex(config.username + config.password))
      .writeUInt32(17)
      .toPacket()

    serverSocket.send(loginMessage)

    val loginStartMs = System.currentTimeMillis()
    var loginReason: String? = null
    var loginSucceeded = false

    while (System.currentTimeMillis() - loginStartMs < 15000L) {
      ensureNotCancelled(cancelled)

      val packet = serverSocket.readPacket(600) ?: continue
      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()

      if (code == 1) {
        val success = parser.readUInt8()
        if (success == 1) {
          loginSucceeded = true
        } else {
          loginReason = parser.readStringSafe()
        }
        break
      }
    }

    if (!loginSucceeded) {
      val reason = loginReason?.takeIf { it.isNotBlank() } ?: "No se pudo iniciar sesion en Soulseek."
      throw IllegalStateException(reason)
    }

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(35)
        .writeUInt32(0)
        .writeUInt32(0)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(2)
        .writeUInt32(incomingPeerServer.localPort)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(126)
        .writeUInt32(0)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(127)
        .writeString(config.username)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(100)
        .writeUInt32(0)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(71)
        .writeUInt32(1)
        .toPacket(),
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(28)
        .writeUInt32(2)
        .toPacket(),
    )
  }

  fun search(query: String, timeoutMs: Int, maxResults: Int): List<SoulseekMatch> {
    ensureNotCancelled(cancelled)

    val token = randomTokenBytes()
    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(26)
        .writeBytes(token)
        .writeString(query)
        .toPacket(),
    )

    val collected = ArrayList<SoulseekMatch>()
    val dedup = HashSet<String>()
    val deadline = System.currentTimeMillis() + timeoutMs
    var lastResultAtMs = System.currentTimeMillis()

    while (System.currentTimeMillis() < deadline && collected.size < maxResults) {
      ensureNotCancelled(cancelled)

      handleIncomingPeerSocketsBurst()
      handleServerPacketsForSearchBurst()

      while (true) {
        val next = searchResults.poll() ?: break
        val key = "${next.username}::${next.filename}::${next.size}"
        if (dedup.add(key)) {
          collected.add(next)
          lastResultAtMs = System.currentTimeMillis()
          if (collected.size >= maxResults) break
        }
      }

      // Popular tracks usually produce many replies immediately. As soon as
      // several ready, measurable peers have answered and the stream has gone
      // quiet, return them instead of always burning the full search timeout.
      val readyPeers = collected.count {
        it.slotsFree == true && (it.speed ?: 0) > 0
      }
      if (
        readyPeers >= 3 &&
        (collected.size >= 12 || System.currentTimeMillis() - lastResultAtMs >= 350L)
      ) {
        break
      }
    }

    return collected
  }

  fun download(match: SoulseekMatch, outputPath: String): DownloadResult {
    return SoulseekTransferClient(
      config = config,
      cancelled = cancelled,
      serverSocket = serverSocket,
      closeables = closeables,
      peerAddresses = peerAddresses,
      acquirePeerMessageConnection = ::acquirePeerMessageConnection,
      pumpIncomingPeerSocket = ::handleIncomingPeerSocket,
      pumpServerPackets = { handleServerPacketsForSearchBurst(6) },
      pollIncomingTransferRequest = { incomingTransferRequests.poll() },
      pollIncomingTransferFailure = { incomingTransferFailures.poll() },
      pollIncomingFileSocket = { incomingFileSockets.poll() },
      pollIncomingFileConnectRequest = { incomingFileConnectRequests.poll() },
      handleUnhandledServerCode = ::handleServerCode,
    ).download(match, outputPath)
  }

  private fun handleIncomingPeerSocket() {
    ensureNotCancelled(cancelled)

    incomingPeerServer.soTimeout = 60

    val socket = try {
      incomingPeerServer.accept()
    } catch (_: SocketTimeoutException) {
      null
    }

    if (socket != null) {
      socket.soTimeout = 4000
      val connection = PeerSearchConnection(
        socket = socket,
        onMatch = { match -> searchResults.offer(match) },
        onTransferRequest = { request -> incomingTransferRequests.offer(request) },
        onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
        onIdentity = { username, identifiedConnection ->
          peerMessageConnections[username] = identifiedConnection
        },
        onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
      )
      peerConnections.add(connection)
      closeables.add(connection)
      connection.start()
    }
  }

  private fun handleIncomingPeerSocketsBurst(maxAccepts: Int = 3) {
    repeat(maxAccepts.coerceAtLeast(1)) {
      handleIncomingPeerSocket()
    }
  }

  private fun handleServerPacketsForSearchBurst(maxPackets: Int = 12) {
    repeat(maxPackets.coerceAtLeast(1)) {
      val packet = serverSocket.readPacket(80) ?: return
      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()
      handleServerCode(code, parser)
    }
  }

  private fun handleServerCode(code: Int, parser: SlskMessageParser) {
    when (code) {
      3 -> {
        val user = parser.readStringSafe()
        if (user.isBlank()) return

        val ipBytes = ByteArray(4)
        for (i in 0 until 4) {
          ipBytes[i] = parser.readUInt8().toByte()
        }

        val host = "${ipBytes[3].toUByte().toInt()}.${ipBytes[2].toUByte().toInt()}.${ipBytes[1].toUByte().toInt()}.${ipBytes[0].toUByte().toInt()}"
        val port = parser.readUInt32().toInt()

        peerAddresses[user] = PeerAddress(host, port)
      }

      18 -> {
        val info = readConnectToPeer(parser) ?: return
        when {
          info.type.equals("F", ignoreCase = true) -> incomingFileConnectRequests.offer(info)
          info.type.equals("P", ignoreCase = true) -> connectPeerForSearch(info)
        }
      }

      102 -> {
        val numberOfParents = parser.readUInt32().toInt().coerceAtLeast(0)
        repeat(numberOfParents) {
          val user = parser.readStringSafe()
          val ipBytes = ByteArray(4)
          for (i in 0 until 4) {
            ipBytes[i] = parser.readUInt8().toByte()
          }
          val host = "${ipBytes[3].toUByte().toInt()}.${ipBytes[2].toUByte().toInt()}.${ipBytes[1].toUByte().toInt()}.${ipBytes[0].toUByte().toInt()}"
          val port = parser.readUInt32().toInt()

          serverSocket.send(
            SlskMessageBuilder()
              .writeUInt32(73)
              .writeUInt8(ipBytes[0].toUByte().toInt())
              .writeUInt8(ipBytes[1].toUByte().toInt())
              .writeUInt8(ipBytes[2].toUByte().toInt())
              .writeUInt8(ipBytes[3].toUByte().toInt())
              .toPacket(),
          )

          // Parent candidates are part of distributed routing. We avoid blocking
          // search on synchronous parent connects here.
          if (user.isNotBlank() && port > 0) {
            peerAddresses[user] = PeerAddress(host, port)
          }
        }
      }
    }
  }

  private fun readConnectToPeer(parser: SlskMessageParser): ConnectToPeerInfo? {
    val user = parser.readStringSafe()
    val type = parser.readStringSafe()

    if (user.isBlank()) return null

    val ipBytes = ByteArray(4)
    for (i in 0 until 4) {
      ipBytes[i] = parser.readUInt8().toByte()
    }

    val host = "${ipBytes[3].toUByte().toInt()}.${ipBytes[2].toUByte().toInt()}.${ipBytes[1].toUByte().toInt()}.${ipBytes[0].toUByte().toInt()}"
    val port = parser.readUInt32().toInt()
    val token = parser.readBytes(4)

    if (port <= 0) return null

    return ConnectToPeerInfo(
      user = user,
      type = type,
      host = host,
      port = port,
      token = token,
    )
  }

  private fun connectPeerForSearch(info: ConnectToPeerInfo) {
    val worker = Thread {
      try {
        val socket = Socket()
        socket.connect(java.net.InetSocketAddress(info.host, info.port), 1800)
        socket.soTimeout = 4500

        val slskSocket = SlskSocket(socket)
        closeables.add(slskSocket)

        slskSocket.send(
          SlskMessageBuilder()
            .writeUInt8(0)
            .writeBytes(info.token)
            .toPacket(),
        )

        val connection = PeerSearchConnection(
          socket = socket,
          onMatch = { match -> searchResults.offer(match) },
          onTransferRequest = { request -> incomingTransferRequests.offer(request) },
          onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
          onIdentity = { username, identifiedConnection ->
            peerMessageConnections[username] = identifiedConnection
          },
          onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
        )
        peerConnections.add(connection)
        closeables.add(connection)
        peerMessageConnections[info.user] = connection
        connection.start()
      } catch (_: Exception) {
        // best effort only
      }
    }

    worker.name = "SoulseekConnectPeerSearch"
    worker.isDaemon = true
    worker.start()
  }

  private fun acquirePeerMessageConnection(
    username: String,
    address: PeerAddress,
  ): PeerSearchConnection {
    peerMessageConnections[username]?.takeIf { it.isOpen() }?.let { return it }

    val connectionToken = randomTokenBytes()

    // Ask the Soulseek server for a reverse connection before trying the
    // peer's public address. If carrier NAT blocks the direct route, the
    // pending ConnectToPeer request gives us an indirect P channel.
    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(18)
        .writeBytes(connectionToken)
        .writeString(username)
        .writeString("P")
        .toPacket(),
    )

    try {
      val socket = Socket()
      socket.connect(InetSocketAddress(address.host, address.port), 2_400)
      socket.soTimeout = 4_500

      val slskSocket = SlskSocket(socket)
      closeables.add(slskSocket)
      slskSocket.send(
        SlskMessageBuilder()
          .writeUInt8(1)
          .writeString(config.username)
          .writeString("P")
          .writeBytes(connectionToken)
          .toPacket(),
      )

      val connection = PeerSearchConnection(
        socket = socket,
        onMatch = { match -> searchResults.offer(match) },
        onTransferRequest = { request -> incomingTransferRequests.offer(request) },
        onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
        onIdentity = { identity, identifiedConnection ->
          peerMessageConnections[identity] = identifiedConnection
        },
        onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
      )
      peerConnections.add(connection)
      closeables.add(connection)
      peerMessageConnections[username] = connection
      connection.start()
      return connection
    } catch (_: Exception) {
      // Continue pumping the server and listening socket for the indirect path.
    }

    val deadline = System.currentTimeMillis() + 12_000L
    while (System.currentTimeMillis() < deadline) {
      ensureNotCancelled(cancelled)
      handleIncomingPeerSocketsBurst(2)
      handleServerPacketsForSearchBurst(6)
      peerMessageConnections[username]?.takeIf { it.isOpen() }?.let { return it }
    }

    throw IllegalStateException("No se pudo abrir el canal P directo ni indirecto con $username.")
  }

  override fun close() {
    peerConnections.forEach { runCatching { it.close() } }
    closeables.forEach { runCatching { it.close() } }
    peerConnections.clear()
    peerMessageConnections.clear()
    closeables.clear()
  }
}

