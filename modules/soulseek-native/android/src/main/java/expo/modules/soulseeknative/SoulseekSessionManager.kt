package expo.modules.soulseeknative

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns the single Soulseek login used by the app. Not thread-safe: every call
 * must come from the module's single worker thread.
 *
 * The Soulseek server bans accounts/IPs that log in or search in bursts, so:
 * - one login is reused across operations and only replaced when it dies,
 *   credentials change, or it sits idle for [IDLE_SESSION_MS]. While open it
 *   re-shares StaySound's Soulseek downloads, so sharing costs no battery
 *   outside the window after the user's last search or download;
 * - failed logins back off exponentially (30 s, 1 min, 2 min... up to 30 min);
 * - searches are spaced at least [MIN_SEARCH_GAP_MS] apart.
 */
internal class SoulseekSessionManager {
  private var session: SoulseekSession? = null
  private var lastUsedAtMs = 0L
  private var lastLoginAttemptAtMs = 0L
  private var lastSearchAtMs = 0L
  private var consecutiveLoginFailures = 0
  private var loginNotBeforeMs = 0L
  private var cooldownReason: String? = null

  fun search(
    config: SoulseekConfig,
    cancelled: AtomicBoolean,
    query: String,
    timeoutMs: Int,
    maxResults: Int,
    identity: SoulseekSearchIdentity? = null,
  ): List<SoulseekMatch> = withSession(config, cancelled) {
    waitUntil(lastSearchAtMs + MIN_SEARCH_GAP_MS, cancelled)
    lastSearchAtMs = System.currentTimeMillis()
    search(query, timeoutMs, maxResults, identity)
  }

  fun download(
    config: SoulseekConfig,
    cancelled: AtomicBoolean,
    match: SoulseekMatch,
    outputPath: String,
  ): DownloadResult = withSession(config, cancelled) {
    download(match, outputPath).also { refreshShares() }
  }

  /** Periodic housekeeping, run on the worker thread between operations. */
  fun maintain() {
    val current = session ?: return
    val idle = System.currentTimeMillis() - lastUsedAtMs > IDLE_SESSION_MS
    // Never cut an upload mid-file; the window closes right after it.
    if (!current.isUsable() || (idle && !current.isUploading())) {
      closeSession()
      return
    }
    runCatching { current.serveIdle() }
    if (!current.isUsable()) closeSession()
  }

  fun closeSession() {
    session?.let {
      // Logging straight back in would kick the other device in turn and the
      // two would fight over the account; wait and say why.
      if (it.relogged) {
        loginNotBeforeMs = maxOf(loginNotBeforeMs, System.currentTimeMillis() + RELOGGED_COOLDOWN_MS)
        cooldownReason = RELOGGED_MESSAGE
      }
      runCatching { it.close() }
    }
    session = null
  }

  private fun <T> withSession(
    config: SoulseekConfig,
    cancelled: AtomicBoolean,
    block: SoulseekSession.() -> T,
  ): T {
    ensureNotCancelled(cancelled)
    // A session quiet for a while may sit on a route the network already
    // dropped; one cheap round-trip tells us before we rely on it.
    val reusable = session?.takeIf { it.config == config && it.isUsable() }?.takeIf {
      System.currentTimeMillis() - it.lastServerPacketAtMs() < QUIET_PROBE_MS || it.probeAlive(5_000L)
    }
    val current = reusable ?: login(config, cancelled)
    try {
      return current.runOperation(cancelled, block)
    } finally {
      lastUsedAtMs = System.currentTimeMillis()
      if (!current.isUsable()) closeSession()
    }
  }

  private fun login(config: SoulseekConfig, cancelled: AtomicBoolean): SoulseekSession {
    closeSession()

    val now = System.currentTimeMillis()
    if (now < loginNotBeforeMs) {
      val seconds = ((loginNotBeforeMs - now) / 1000L).coerceAtLeast(1L)
      throw IllegalStateException(
        "${cooldownReason ?: "Soulseek rechazo la conexion recientemente."} Espera $seconds s antes de reintentar.",
      )
    }
    // Even successful logins must not come in bursts (e.g. a flaky network
    // dropping the session between two downloads).
    waitUntil(lastLoginAttemptAtMs + MIN_LOGIN_GAP_MS, cancelled)
    lastLoginAttemptAtMs = System.currentTimeMillis()

    val fresh = SoulseekSession(config)
    try {
      fresh.connectAndLogin(cancelled)
    } catch (error: Throwable) {
      runCatching { fresh.close() }
      val wasCancelled = (error.message ?: "").contains("cancel", ignoreCase = true)
      if (!wasCancelled) {
        consecutiveLoginFailures += 1
        val backoff = (LOGIN_BACKOFF_BASE_MS shl (consecutiveLoginFailures - 1).coerceAtMost(6))
          .coerceAtMost(LOGIN_BACKOFF_MAX_MS)
        loginNotBeforeMs = System.currentTimeMillis() + backoff
        cooldownReason = null
      }
      throw error
    }

    consecutiveLoginFailures = 0
    loginNotBeforeMs = 0L
    cooldownReason = null
    session = fresh
    lastUsedAtMs = System.currentTimeMillis()
    return fresh
  }

  private fun waitUntil(targetMs: Long, cancelled: AtomicBoolean) {
    while (true) {
      ensureNotCancelled(cancelled)
      val remaining = targetMs - System.currentTimeMillis()
      if (remaining <= 0) return
      Thread.sleep(remaining.coerceAtMost(250L))
    }
  }

  companion object {
    private const val MIN_SEARCH_GAP_MS = 4_000L
    private const val MIN_LOGIN_GAP_MS = 15_000L
    private const val LOGIN_BACKOFF_BASE_MS = 30_000L
    private const val LOGIN_BACKOFF_MAX_MS = 30 * 60_000L
    const val IDLE_SESSION_MS = 15 * 60_000L
    private const val QUIET_PROBE_MS = 45_000L
    private const val RELOGGED_COOLDOWN_MS = 2 * 60_000L
    private const val RELOGGED_MESSAGE =
      "Otra sesion (otro dispositivo o programa) entro con esta misma cuenta de Soulseek y el servidor cerro esta. Usa una cuenta distinta en cada dispositivo."
  }
}
