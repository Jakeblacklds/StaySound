package expo.modules.soulseeknative

import java.text.Normalizer
import java.util.Locale

internal data class SoulseekSearchIdentity(
  val titleWords: List<String>,
  val artistWords: List<String>,
  val extensions: List<String> = emptyList(),
) {
  fun matches(match: SoulseekMatch): Boolean {
    val leaf = match.filename.replace('\\', '/').substringAfterLast('/')
    if (extensions.isNotEmpty() && extensionOf(match) !in extensions) return false
    val title = words(leaf.substringBeforeLast('.', leaf))
    val path = words(match.filename)
    return titleWords.all { it in title } && artistWords.all { it in path }
  }

  /** The first listed extension is the one the user asked for (FLAC for lossless). */
  fun isPreferredFormat(match: SoulseekMatch): Boolean =
    extensions.isEmpty() || extensionOf(match) == extensions.first()

  companion object {
    private fun extensionOf(match: SoulseekMatch): String =
      match.filename.replace('\\', '/').substringAfterLast('/').substringAfterLast('.', "").lowercase(Locale.ROOT)

    private fun words(value: String): Set<String> = Normalizer.normalize(value, Normalizer.Form.NFD)
      .replace(Regex("[\\u0300-\\u036f]"), "")
      .lowercase(Locale.ROOT).split(Regex("[^a-z0-9]+")).filter { it.isNotBlank() }.toSet()

    fun from(value: Any?): SoulseekSearchIdentity? {
      val map = value as? Map<*, *> ?: return null
      fun terms(key: String) = (map[key] as? List<*>)?.filterIsInstance<String>()?.filter { it.isNotBlank() }.orEmpty()
      val title = terms("titleWords")
      val artist = terms("artistWords")
      if (title.isEmpty() || artist.isEmpty()) return null
      return SoulseekSearchIdentity(title, artist, terms("extensions"))
    }
  }
}

/** Only eligible files count toward the cap or the early-completion threshold. */
internal class SoulseekSearchCollector(private val identity: SoulseekSearchIdentity?, private val maxResults: Int) {
  val matches = ArrayList<SoulseekMatch>()
  private val seen = HashSet<String>()
  private val readyPeers = HashSet<String>()
  private var lastMatchAtMs = 0L

  fun add(match: SoulseekMatch, nowMs: Long) {
    if (identity?.matches(match) == false || matches.size >= maxResults) return
    if (!seen.add("${match.username}::${match.filename}::${match.size}")) return
    matches.add(match)
    lastMatchAtMs = nowMs
    // Only peers that can send the requested format right now may end the
    // search early: three free MP3 peers must not cut off the FLAC replies.
    if (match.slotsFree == true && (match.speed ?: 0) > 0 && identity?.isPreferredFormat(match) != false) {
      readyPeers.add(match.username)
    }
  }

  /**
   * Like Seeker's inactivity timeout: once someone can serve the file, a quiet
   * stream means the useful replies are in, so stop waiting for the deadline.
   */
  fun isComplete(nowMs: Long): Boolean {
    if (matches.size >= maxResults) return true
    val quietMs = nowMs - lastMatchAtMs
    return when {
      readyPeers.size >= 8 -> true
      readyPeers.size >= 3 -> quietMs >= 350L
      readyPeers.isNotEmpty() -> quietMs >= 1_500L
      else -> false
    }
  }
}
