package expo.modules.soulseeknative

import java.util.concurrent.atomic.AtomicBoolean

internal class SoulseekClient(private val cancelled: AtomicBoolean) {
  fun search(
    config: SoulseekConfig,
    query: String,
    timeoutMs: Int,
    maxResults: Int,
  ): List<SoulseekMatch> {
    ensureNotCancelled(cancelled)

    val session = SoulseekSession(config, cancelled)
    return try {
      session.connectAndLogin()
      session.search(query, timeoutMs, maxResults)
    } finally {
      session.close()
    }
  }

  fun download(
    config: SoulseekConfig,
    match: SoulseekMatch,
    outputPath: String,
  ): DownloadResult {
    ensureNotCancelled(cancelled)

    val session = SoulseekSession(config, cancelled)
    return try {
      session.connectAndLogin()
      session.download(match, outputPath)
    } finally {
      session.close()
    }
  }
}
