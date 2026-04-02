package expo.modules.karaokeview

/**
 * Data classes for karaoke lyrics
 */

enum class BackgroundPlacement {
    BEFORE,
    AFTER,
}

data class LyricWord(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val trailingSpace: Boolean = true,
    val isBackground: Boolean = false,
    val isPart: Boolean = false,
    var xOffset: Float = 0f,    // Pre-computed X position within line
    var yOffset: Float = 0f,    // Pre-computed Y offset (for multi-line)
    var width: Float = 0f       // Pre-computed width
)

data class LyricLine(
    val words: MutableList<LyricWord>,
    val backgroundWords: MutableList<LyricWord> = mutableListOf(),
    var startMs: Long = 0,
    var endMs: Long = 0,
    var y: Float = 0f,          // Pre-computed Y position
    var totalWidth: Float = 0f, // Pre-computed total width
    var totalHeight: Float = 0f,
    var mainTopOffset: Float = 0f,
    var mainHeight: Float = 0f,
    var backgroundTopOffset: Float = 0f,
    var backgroundHeight: Float = 0f,
    var focusCenterYOffset: Float = 0f,
    var backgroundPlacement: BackgroundPlacement = BackgroundPlacement.AFTER
)

internal object LyricsVisualWords {
    private val punctuationRegex = Regex("^[,.;:!?)]")
    private val cjkRegex = Regex("[\\u4e00-\\u9fff\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7af]")
    private val rtlRegex = Regex("[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\u0590-\\u05FF]")

    fun shouldInsertSpacing(previous: LyricWord?, current: LyricWord): Boolean {
        if (previous == null) return false
        if (previous.trailingSpace) return true
        if (current.isPart) return false

        val prevText = previous.text
        val currentText = current.text

        if (prevText.endsWith("-")) return false
        if (prevText.endsWith("'") || prevText.endsWith("’")) return false
        if (currentText.startsWith("'") || currentText.startsWith("’")) return false
        if (punctuationRegex.matches(currentText)) return false

        // KPoe/Apple syllable payloads use spacing markers to separate visual words.
        // If there is no explicit boundary, keep the fragments attached like binimum does.
        return false
    }

    fun findVisualWordRange(words: List<LyricWord>, anchorIndex: Int): IntRange {
        if (words.isEmpty() || anchorIndex !in words.indices) {
            return IntRange.EMPTY
        }

        var start = anchorIndex
        while (start > 0 && !shouldInsertSpacing(words[start - 1], words[start])) {
            start -= 1
        }

        var end = anchorIndex
        while (end < words.lastIndex && !shouldInsertSpacing(words[end], words[end + 1])) {
            end += 1
        }

        return start..end
    }

    fun isGrowableVisualWord(text: String, startMs: Long, endMs: Long): Boolean {
        val combinedText = text.replace(Regex("\\s+"), "").trim()
        if (combinedText.isEmpty()) return false

        val durationMs = (endMs - startMs).coerceAtLeast(0L)
        val isCjk = cjkRegex.containsMatchIn(combinedText)
        val isRtl = rtlRegex.containsMatchIn(combinedText)
        val hasHyphen = combinedText.contains('-')
        val length = combinedText.length

        return !isCjk &&
            !isRtl &&
            !hasHyphen &&
            length <= 7 &&
            durationMs >= 900 &&
            durationMs >= length * 300L &&
            (length >= 4 || durationMs / length >= 600L)
    }
}

/**
 * O(1) lookup table for finding active line by time
 * Uses 10ms buckets for fast access
 */
class LyricsLookupTable(private val lines: List<LyricLine>) {
    private val buckets: IntArray
    private val bucketSizeMs = 10

    init {
        val maxTime = lines.lastOrNull()?.endMs ?: 0L
        val numBuckets = ((maxTime / bucketSizeMs) + 1).toInt().coerceAtLeast(1)
        buckets = IntArray(numBuckets) { -1 }

        // Fill buckets with line indices
        lines.forEachIndexed { index, line ->
            val startBucket = (line.startMs / bucketSizeMs).toInt()
            val endBucket = (line.endMs / bucketSizeMs).toInt().coerceAtMost(numBuckets - 1)
            for (b in startBucket..endBucket) {
                if (b in buckets.indices) {
                    buckets[b] = index
                }
            }
        }

        // Fill gaps with previous line (for silences between lyrics)
        var lastFilled = -1
        for (i in buckets.indices) {
            if (buckets[i] >= 0) {
                lastFilled = buckets[i]
            } else if (lastFilled >= 0) {
                buckets[i] = lastFilled
            }
        }
        
        // Fill pre-lyrics buckets with line 0
        if (lines.isNotEmpty()) {
            val firstLineStart = (lines[0].startMs / bucketSizeMs).toInt()
            for (b in 0 until firstLineStart.coerceAtMost(buckets.size)) {
                if (buckets[b] < 0) buckets[b] = 0
            }
        }
    }

    fun getLineIndexAt(timeMs: Long): Int {
        val bucket = (timeMs / bucketSizeMs).toInt()
        return if (bucket in buckets.indices) buckets[bucket] else -1
    }
}
