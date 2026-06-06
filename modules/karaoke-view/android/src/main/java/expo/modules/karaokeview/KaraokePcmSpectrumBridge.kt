package expo.modules.karaokeview

import kotlin.math.abs

/**
 * Process-local bridge fed by TrackPlayer's PCM AudioProcessor.
 *
 * The audio processor lives in the react-native-track-player Gradle module, so it
 * publishes via reflection to avoid a hard module dependency. Both modules run in
 * the same app process, making this a cheap in-memory handoff.
 *
 * Latency alignment: the processor taps PCM inside the audio sink BEFORE it reaches
 * the speaker, so the freshly published bands describe audio that is still ~150ms
 * away from being heard. Returning the newest frame therefore makes the visualizer
 * run AHEAD of the music. To fix that we keep a short ring buffer of recent frames
 * and, on [snapshot], return the frame captured [RENDER_DELAY_MS] ago — i.e. the
 * audio that is actually reaching the ear right now.
 */
object KaraokePcmSpectrumBridge {
    private const val DEFAULT_BAND_COUNT = 16
    private const val STALE_AFTER_MS = 700L

    // Approximate audio-output latency (sink/AudioTrack buffering). Increase if the
    // visualizer still leads the sound; decrease if it lags behind it.
    private const val DEFAULT_RENDER_DELAY_MS = 350L
    private const val MAX_RENDER_DELAY_MS = 650L

    // ~64 frames of history. At hop=512 / 44.1kHz (~11.6ms/frame) that's ~740ms,
    // comfortably covering the render delay above.
    private const val HISTORY = 64

    private val timestamps = LongArray(HISTORY)
    private val frames = arrayOfNulls<FloatArray>(HISTORY)

    @Volatile
    private var writeIndex = 0

    @Volatile
    private var latestUptimeMs: Long = 0L

    @Volatile
    private var latestSampleRate: Int = 0

    private var logCount = 0

    @JvmStatic
    fun publishBands(bands: FloatArray, sampleRate: Int) {
        val now = android.os.SystemClock.uptimeMillis()
        val slot = writeIndex
        frames[slot] = bands.copyOf()
        timestamps[slot] = now
        writeIndex = (slot + 1) % HISTORY
        latestUptimeMs = now
        latestSampleRate = sampleRate

        if (logCount < 3 && bands.isNotEmpty()) {
            logCount++
            android.util.Log.w(
                "KaraokeSpectrum",
                "bridge pcm bands sr=$sampleRate band0=${bands[0]} bandMid=${bands[bands.size / 2]} bandLast=${bands[bands.lastIndex]}",
            )
        }
    }

    fun snapshot(targetBandCount: Int, renderDelayMs: Long = DEFAULT_RENDER_DELAY_MS): FloatArray {
        val now = android.os.SystemClock.uptimeMillis()
        val newest = latestUptimeMs
        if (newest == 0L || now - newest > STALE_AFTER_MS) {
            return FloatArray(targetBandCount)
        }

        // Pick the frame whose capture time is closest to (now - render delay), so the
        // visuals line up with what the speaker is emitting at this instant.
        val targetTs = now - renderDelayMs.coerceIn(0L, MAX_RENDER_DELAY_MS)
        var bestIdx = -1
        var bestDelta = Long.MAX_VALUE
        for (i in 0 until HISTORY) {
            val ts = timestamps[i]
            if (ts == 0L) continue
            val delta = abs(ts - targetTs)
            if (delta < bestDelta) {
                bestDelta = delta
                bestIdx = i
            }
        }

        val source = if (bestIdx >= 0) frames[bestIdx] else null
        if (source == null || source.isEmpty()) return FloatArray(targetBandCount)
        if (source.size == targetBandCount) return source.copyOf()

        return FloatArray(targetBandCount) { index ->
            val sourceIndex = ((index.toFloat() / (targetBandCount - 1).coerceAtLeast(1)) *
                (source.size - 1).coerceAtLeast(0)).toInt()
            source[sourceIndex.coerceIn(0, source.lastIndex)]
        }
    }

    fun sampleRate(): Int = latestSampleRate
}
