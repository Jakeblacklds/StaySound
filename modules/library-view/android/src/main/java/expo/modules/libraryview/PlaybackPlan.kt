package expo.modules.libraryview

import org.json.JSONObject
import java.util.Locale
import kotlin.random.Random

internal data class PlaybackTrack(
    val id: String, val uri: String, val title: String, val artist: String,
    val album: String, val artwork: String, val duration: Long,
    val format: String = "", val codec: String = "", val cloudOnly: Boolean = false,
    val sampleRate: Int = 0, val bitDepth: Int = 0, val quality: String = "",
) {
    val playable: Boolean get() {
        val extension = format.trim().lowercase(Locale.ROOT).removePrefix(".").ifEmpty {
            Regex("\\.([a-z0-9]+)(?:\\?|$)").find(uri.lowercase(Locale.ROOT))?.groupValues?.get(1).orEmpty()
        }
        return !cloudOnly && extension !in unsupported &&
            listOf("content://", "file://", "http://", "https://", "/").any(uri::startsWith)
    }
    companion object {
        private val unsupported = setOf("wma", "asf", "ra", "rm", "ape", "dsf", "dff", "mka", "tta", "wv")
        fun parse(item: JSONObject) = PlaybackTrack(
            item.getString("id"), item.optString("uri").trim(), item.optString("title"),
            item.optString("artist"), item.optString("album"),
            item.optString("artworkThumb").ifEmpty { item.optString("artwork") }, item.optLong("duration"),
            item.optString("format"), item.optString("codec"), item.optBoolean("cloudOnly"),
            item.optInt("sampleRate"), item.optInt("bitDepth"), item.optString("quality"),
        )
    }
}

internal data class PlaybackPlan(val queue: List<PlaybackTrack>, val index: Int, val linear: List<PlaybackTrack>) {
    companion object {
        fun create(source: List<PlaybackTrack>, id: String, shuffle: Boolean = false,
                   contextLimit: Int = 700, recent: List<String> = emptyList(), random: Random = Random.Default): PlaybackPlan {
            val playable = source.filter { it.playable }.distinctBy { it.id }
            val selected = playable.indexOfFirst { it.id == id }
            require(selected >= 0) { "Selected song is not playable" }
            val contextStart = (selected - 50).coerceAtLeast(0).coerceAtMost((playable.size - contextLimit.coerceIn(1, 5000)).coerceAtLeast(0))
            val linear = playable.drop(contextStart).take(contextLimit.coerceIn(1, 5000))
            val focus = selected - contextStart
            if (!shuffle) {
                val start = (focus - 50).coerceAtLeast(0).coerceAtMost((linear.size - 500).coerceAtLeast(0))
                return PlaybackPlan(linear.drop(start).take(500), focus - start, linear)
            }
            // Same artist dispersion and soft recency penalty as the existing shuffle.
            val penalties = recent.mapIndexed { i, trackId -> trackId to (recent.size - i).toDouble() / recent.size }.toMap()
            val ranked = linear.filter { it.id != id }.groupBy { it.artist.lowercase(Locale.ROOT).ifBlank { it.album.ifBlank { it.id } } }
                .values.flatMap { group ->
                    val spacing = 1.0 / group.size
                    val offset = random.nextDouble() * spacing
                    group.shuffled(random).mapIndexed { i, track ->
                        track to (offset + i * spacing + (random.nextDouble() - 0.5) * spacing * 0.5 + (penalties[track.id] ?: 0.0) * 0.6)
                    }
                }.sortedBy { it.second }.map { it.first }
            return PlaybackPlan((listOf(linear[focus]) + ranked).take(500), 0, linear)
        }
    }
}
