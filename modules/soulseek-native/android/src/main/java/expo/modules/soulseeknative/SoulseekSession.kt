package expo.modules.soulseeknative

import java.io.Closeable
import java.io.File
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One logged-in Soulseek server connection, reused across searches and
 * downloads by [SoulseekSessionManager]. The server treats every login as a
 * new client; logging in per operation is what gets accounts and IPs banned.
 */
internal class SoulseekSession(
  val config: SoulseekConfig,
) : Closeable {
  /** Cancellation flag of the operation currently using this session. */
  @Volatile
  private var cancelled = AtomicBoolean(false)

  private val shareIndex = SoulseekShareIndex(config.shareDir?.let(::File))
  private var uploads: SoulseekUploadService? = null

  private val closeables = CopyOnWriteArrayList<Closeable>()
  private val peerConnections = CopyOnWriteArrayList<PeerSearchConnection>()
  @Volatile private var activeSearchToken: ByteArray? = null
  private val searchResults = LinkedBlockingQueue<SoulseekMatch>()
  private val incomingTransferRequests = LinkedBlockingQueue<IncomingTransferRequest>()
  private val incomingTransferFailures = LinkedBlockingQueue<String>()
  private val incomingFileSockets = LinkedBlockingQueue<Socket>()
  private val incomingFileConnectRequests = LinkedBlockingQueue<ConnectToPeerInfo>()
  private val peerAddresses = ConcurrentHashMap<String, PeerAddress>()
  private val peerMessageConnections = ConcurrentHashMap<String, PeerSearchConnection>()

  private lateinit var serverSocket: SlskSocket
  private lateinit var incomingPeerServer: ServerSocket

  fun isUsable(): Boolean =
    ::serverSocket.isInitialized && serverSocket.isOpen() && !incomingPeerServer.isClosed

  fun connectAndLogin(operationCancelled: AtomicBoolean) {
    cancelled = operationCancelled
    ensureNotCancelled(cancelled)

    incomingPeerServer = openIncomingPeerServer(config.listenPort)
    serverSocket = SlskSocket.connect(config.serverHost, config.serverPort)

    val loginMessage = SlskMessageBuilder()
      .writeUInt32(1)
      .writeString(config.username)
      .writeString(config.password)
      .writeUInt32(config.clientVersion)
      .writeString(md5Hex(config.username + config.password))
      // Minor version identifies the client. StaySound uses its own value
      // (Nicotine+ uses 1-3 under major 160) so the network can tell it apart.
      .writeUInt32(STAYSOUND_MINOR_VERSION)
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

    shareIndex.rescan()
    sendShareCounts()
    uploads = SoulseekUploadService(
      config = config,
      shares = shareIndex,
      lookupPeerAddress = ::lookupPeerAddress,
      requestIndirectFileConnection = { user, token ->
        serverSocket.send(
          SlskMessageBuilder().writeUInt32(18).writeBytes(token).writeString(user).writeString("F").toPacket(),
        )
      },
      reportUploadSpeed = { speed ->
        runCatching { serverSocket.send(SlskMessageBuilder().writeUInt32(121).writeUInt32(speed).toPacket()) }
      },
    )

    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(2)
        .writeUInt32(incomingPeerServer.localPort)
        .toPacket(),
    )

    // StaySound does not join the distributed search network (it would keep
    // the radio busy on mobile), so it never claims a BranchLevel/BranchRoot:
    // it accepts no children and truthfully reports having no parent.
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

  /**
   * Runs one search/download on the shared login. Per-operation peer sockets
   * and queued events are discarded afterwards so the next operation starts
   * clean without touching the server connection.
   */
  fun <T> runOperation(operationCancelled: AtomicBoolean, block: SoulseekSession.() -> T): T {
    cancelled = operationCancelled
    releaseTransientState()
    val startedAt = System.currentTimeMillis()
    return try {
      block()
    } catch (error: Throwable) {
      // A failure while the server stayed silent the whole time smells like a
      // dead route (mobile NAT). Check it so the next operation logs in fresh.
      if (!operationCancelled.get() && serverSocket.lastPacketAtMs < startedAt) probeAlive(4_000L)
      throw error
    } finally {
      releaseTransientState()
    }
  }

  private var lastHeartbeatAtMs = 0L

  fun lastServerPacketAtMs(): Long = serverSocket.lastPacketAtMs

  /**
   * Sends a cheap request (our own GetUserStatus) and waits for any server
   * packet. Mobile networks drop idle TCP silently: writes still "succeed"
   * but nothing ever answers, so silence is the only symptom.
   */
  fun probeAlive(timeoutMs: Long): Boolean {
    val sentAt = System.currentTimeMillis()
    runCatching { serverSocket.send(getUserStatusPacket()) }.onFailure { return false }
    val deadline = sentAt + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      runCatching { handleServerPacketsForSearchBurst(8) }.onFailure { return false }
      if (serverSocket.lastPacketAtMs >= sentAt) return true
    }
    serverSocket.markFailed()
    return false
  }

  /** Idle upkeep: a heartbeat after a quiet minute, dead if it goes unanswered. */
  private fun heartbeat() {
    val now = System.currentTimeMillis()
    val lastPacket = serverSocket.lastPacketAtMs
    if (lastHeartbeatAtMs > lastPacket && now - lastHeartbeatAtMs > 20_000L) {
      serverSocket.markFailed(); return
    }
    if (now - lastPacket > 60_000L && now - lastHeartbeatAtMs > 60_000L) {
      lastHeartbeatAtMs = now
      runCatching { serverSocket.send(getUserStatusPacket()) }
    }
  }

  private fun getUserStatusPacket() =
    SlskMessageBuilder().writeUInt32(7).writeString(config.username).toPacket()

  /**
   * Between operations the login stays useful: it answers the server (peer
   * addresses, ConnectToPeer requests) and accepts peers that want to browse
   * or download our shares.
   */
  fun serveIdle() {
    cancelled = AtomicBoolean(false)
    handleIncomingPeerSocketsBurst(2)
    handleServerPacketsForSearchBurst(16)
    heartbeat()
    // Nothing is waiting on these between operations.
    searchResults.clear()
    incomingTransferRequests.clear()
    incomingTransferFailures.clear()
    incomingFileConnectRequests.clear()
    peerConnections.removeAll { !it.isOpen() }
  }

  fun isUploading(): Boolean = uploads?.isTransferring() == true

  /** Re-index after a download lands in the shared folder. */
  fun refreshShares() {
    shareIndex.rescan()
    runCatching { sendShareCounts() }
  }

  private fun sendShareCounts() {
    serverSocket.send(
      SlskMessageBuilder()
        .writeUInt32(35)
        .writeUInt32(shareIndex.folderCount)
        .writeUInt32(shareIndex.fileCount)
        .toPacket(),
    )
  }

  /** Asks the server for a peer's address; the reply lands via code 3. */
  private fun lookupPeerAddress(username: String): PeerAddress? {
    peerAddresses.remove(username)
    runCatching {
      serverSocket.send(SlskMessageBuilder().writeUInt32(3).writeString(username).toPacket())
    }.onFailure { return null }
    val deadline = System.currentTimeMillis() + 10_000L
    while (System.currentTimeMillis() < deadline) {
      peerAddresses[username]?.let { return it }
      Thread.sleep(100)
    }
    return null
  }

  private fun releaseTransientState() {
    // Connections with a queued upload survive; everything else is per-operation.
    val keep = peerConnections.filter { it.pinned && it.isOpen() }
    peerConnections.filterNot { it in keep }.forEach { runCatching { it.close() } }
    closeables.filterNot { it in keep }.forEach { runCatching { it.close() } }
    peerConnections.retainAll(keep)
    peerMessageConnections.clear()
    closeables.retainAll(keep)
    searchResults.clear()
    incomingTransferRequests.clear()
    incomingTransferFailures.clear()
    incomingFileConnectRequests.clear()
    while (true) {
      val socket = incomingFileSockets.poll() ?: break
      runCatching { socket.close() }
    }
  }

  /** Per-search counters, logged so a miss says where the replies were lost. */
  private val searchPeerRequests = java.util.concurrent.atomic.AtomicInteger()
  private val searchPeerDials = java.util.concurrent.atomic.AtomicInteger()
  private val searchPeerDialFailures = java.util.concurrent.atomic.AtomicInteger()

  fun search(query: String, timeoutMs: Int, maxResults: Int, identity: SoulseekSearchIdentity? = null): List<SoulseekMatch> {
    ensureNotCancelled(cancelled)
    searchPeerRequests.set(0)
    searchPeerDials.set(0)
    searchPeerDialFailures.set(0)
    var rawFiles = 0
    val rawPeers = HashSet<String>()
    val startedAt = System.currentTimeMillis()
    val token = randomTokenBytes()
    activeSearchToken = token
    val collector = SoulseekSearchCollector(identity, maxResults)
    val deadline = System.currentTimeMillis() + timeoutMs
    searchActiveUntilMs = deadline
    try {
      serverSocket.send(
        SlskMessageBuilder().writeUInt32(26).writeBytes(token).writeString(query).toPacket(),
      )
      while (System.currentTimeMillis() < deadline && !collector.isComplete(System.currentTimeMillis())) {
        ensureNotCancelled(cancelled)
        handleIncomingPeerSocketsBurst()
        handleServerPacketsForSearchBurst()
        while (System.currentTimeMillis() < deadline) {
          val next = searchResults.poll() ?: break
          rawFiles += 1
          rawPeers.add(next.username)
          collector.add(next, System.currentTimeMillis())
          if (collector.isComplete(System.currentTimeMillis())) break
        }
      }
      android.util.Log.i(
        "StaySoundSoulseek",
        "search \"$query\": ${System.currentTimeMillis() - startedAt} ms, avisos P=${searchPeerRequests.get()}, " +
          "conexiones=${searchPeerDials.get()} (fallidas=${searchPeerDialFailures.get()}), " +
          "archivos=$rawFiles de ${rawPeers.size} peers, aceptados=${collector.matches.size}",
      )
      return collector.matches
    } finally {
      activeSearchToken = null
      searchActiveUntilMs = System.currentTimeMillis()
    }
  }

  /** Remote filename of the download in progress; offers for anything else are stale. */
  @Volatile
  private var awaitedDownload: String? = null

  /**
   * Peers offer a file when our queued request reaches the front of their
   * queue. Offers for requests we abandoned (another peer won, the user
   * cancelled, the session restarted) get "Cancelled" right away so the
   * uploader frees the slot and drops the entry instead of waiting on us.
   */
  private fun acceptOrCancelTransferRequest(request: IncomingTransferRequest) {
    if (awaitedDownload?.equals(request.filename, ignoreCase = true) == true) {
      incomingTransferRequests.offer(request)
      return
    }
    runCatching {
      request.reply(
        SlskMessageBuilder()
          .writeUInt32(41)
          .writeBytes(request.token)
          .writeUInt8(0)
          .writeString("Cancelled")
          .toPacket(),
      )
    }
  }

  fun download(match: SoulseekMatch, outputPath: String): DownloadResult {
    awaitedDownload = match.filename
    awaitedPeer = match.username
    try {
      return downloadAwaited(match, outputPath)
    } finally {
      awaitedDownload = null
      awaitedPeer = null
    }
  }

  private fun downloadAwaited(match: SoulseekMatch, outputPath: String): DownloadResult {
    return SoulseekTransferClient(
      config = config,
      cancelled = cancelled,
      serverSocket = serverSocket,
      closeables = closeables,
      peerAddresses = peerAddresses,
      acquirePeerMessageConnection = ::acquirePeerMessageConnection,
      pumpIncomingPeerSocket = { handleIncomingPeerSocket() },
      pumpServerPackets = { handleServerPacketsForSearchBurst(64) },
      pollIncomingTransferRequest = { incomingTransferRequests.poll() },
      pollIncomingTransferFailure = { incomingTransferFailures.poll() },
      pollIncomingFileSocket = { incomingFileSockets.poll() },
      pollIncomingFileConnectRequest = { incomingFileConnectRequests.poll() },
      handleUnhandledServerCode = ::handleServerCode,
    ).download(match, outputPath)
  }

  /** Accepts one pending inbound peer socket; false when none was waiting. */
  private fun handleIncomingPeerSocket(): Boolean {
    ensureNotCancelled(cancelled)

    incomingPeerServer.soTimeout = 15

    val socket = try {
      incomingPeerServer.accept()
    } catch (_: SocketTimeoutException) {
      null
    } ?: return false

    if (socket != null) {
      socket.soTimeout = 4000
      val connection = PeerSearchConnection(
        socket = socket,
        onMatch = { match -> searchResults.offer(match) },
        acceptSearchToken = { token -> activeSearchToken?.contentEquals(token) == true },
        onTransferRequest = ::acceptOrCancelTransferRequest,
        onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
        onIdentity = { username, identifiedConnection ->
          peerMessageConnections[username] = identifiedConnection
        },
        onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
        requestHandler = uploads,
      )
      peerConnections.add(connection)
      closeables.add(connection)
      connection.start()
    }
    return true
  }

  private fun handleIncomingPeerSocketsBurst(maxAccepts: Int = 3) {
    repeat(maxAccepts.coerceAtLeast(1)) {
      if (!handleIncomingPeerSocket()) return
    }
  }

  /**
   * Drains the server stream quickly. After a search the server relays
   * hundreds of ConnectToPeer requests; reading them slowly queues every
   * other answer (e.g. GetPeerAddress) behind them for many seconds.
   */
  private fun handleServerPacketsForSearchBurst(maxPackets: Int = 64) {
    repeat(maxPackets.coerceAtLeast(1)) { index ->
      val packet = serverSocket.readPacket(if (index == 0) 80 else 5) ?: return
      val parser = SlskMessageParser(packet)
      val code = parser.readUInt32().toInt()
      handleServerCode(code, parser)
    }
  }

  /** Until when ConnectToPeer(P) requests are worth answering for our search. */
  @Volatile
  private var searchActiveUntilMs = 0L

  /** Username of the peer the current download is waiting on. */
  @Volatile
  private var awaitedPeer: String? = null

  private val shareConnectTimes = java.util.ArrayDeque<Long>()

  /**
   * Which ConnectToPeer(P) requests we dial back. Late search results from a
   * finished search are useless (hundreds arrive), so only: while our search
   * runs, the peer we are downloading from, and a small budget for people
   * browsing or downloading our shares.
   */
  private fun shouldAnswerPeerRequest(user: String): Boolean {
    val now = System.currentTimeMillis()
    if (now < searchActiveUntilMs) return true
    if (awaitedPeer?.equals(user, ignoreCase = true) == true) return true
    if (config.shareDir == null) return false
    while (shareConnectTimes.isNotEmpty() && now - shareConnectTimes.first() > 60_000L) shareConnectTimes.removeFirst()
    if (shareConnectTimes.size >= 8) return false
    shareConnectTimes.addLast(now)
    return true
  }

  /** Set when the server dropped us because this account logged in elsewhere. */
  @Volatile
  var relogged = false
    private set

  private fun handleServerCode(code: Int, parser: SlskMessageParser) {
    when (code) {
      // Relogged: another client (the desktop app, Nicotine+…) logged in with
      // this account, so the server is closing this session.
      41 -> { relogged = true; serverSocket.markFailed() }

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
          info.type.equals("P", ignoreCase = true) -> {
            if (activeSearchToken != null) searchPeerRequests.incrementAndGet()
            if (shouldAnswerPeerRequest(info.user)) connectPeerForSearch(info)
          }
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


          // PossibleParents only matters to clients that join the distributed
          // network. Keep the addresses (they help reach those peers) but never
          // claim one as our parent (deprecated ParentIP, and it would be false).
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
        if (activeSearchToken != null) searchPeerDials.incrementAndGet()
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
        acceptSearchToken = { token -> activeSearchToken?.contentEquals(token) == true },
          onTransferRequest = ::acceptOrCancelTransferRequest,
          onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
          onIdentity = { username, identifiedConnection ->
            peerMessageConnections[username] = identifiedConnection
          },
          onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
        requestHandler = uploads,
        )
        peerConnections.add(connection)
        closeables.add(connection)
        connection.peerUsername = info.user
        peerMessageConnections[info.user] = connection
        connection.start()
      } catch (_: Exception) {
        // best effort only
        if (activeSearchToken != null) searchPeerDialFailures.incrementAndGet()
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
      // Unknown address: skip straight to the indirect route below.
      if (address.port <= 0 || address.host.isBlank()) throw IllegalStateException("sin direccion directa")
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
        acceptSearchToken = { token -> activeSearchToken?.contentEquals(token) == true },
        onTransferRequest = ::acceptOrCancelTransferRequest,
        onTransferFailure = { failure -> incomingTransferFailures.offer(failure) },
        onIdentity = { identity, identifiedConnection ->
          peerMessageConnections[identity] = identifiedConnection
        },
        onFileConnection = { fileSocket -> incomingFileSockets.offer(fileSocket) },
        requestHandler = uploads,
      )
      peerConnections.add(connection)
      closeables.add(connection)
      connection.peerUsername = username
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
      handleServerPacketsForSearchBurst(64)
      peerMessageConnections[username]?.takeIf { it.isOpen() }?.let { return it }
    }

    throw IllegalStateException("No se pudo abrir el canal P directo ni indirecto con $username.")
  }

  private companion object {
    const val STAYSOUND_MINOR_VERSION = 1026
  }

  override fun close() {
    uploads?.close()
    peerConnections.forEach { runCatching { it.close() } }
    peerConnections.clear()
    releaseTransientState()
    if (::serverSocket.isInitialized) runCatching { serverSocket.close() }
    if (::incomingPeerServer.isInitialized) runCatching { incomingPeerServer.close() }
  }
}

