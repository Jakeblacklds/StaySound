package expo.modules.karaokeview

/**
 * Data classes for karaoke lyrics
 */

data class LyricWord(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    var xOffset: Float = 0f,    // Pre-computed X position within line
    var yOffset: Float = 0f,    // Pre-computed Y offset (for multi-line)
    var width: Float = 0f       // Pre-computed width
)

data class LyricLine(
    val words: MutableList<LyricWord>,
    var startMs: Long = 0,
    var endMs: Long = 0,
    var y: Float = 0f,          // Pre-computed Y position
    var totalWidth: Float = 0f  // Pre-computed total width
)

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
