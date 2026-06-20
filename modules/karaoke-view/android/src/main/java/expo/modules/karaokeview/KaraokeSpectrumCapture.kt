package expo.modules.karaokeview

/**
 * Reads spectrum bands produced by the TrackPlayer PCM audio processor.
 *
 * This intentionally avoids android.media.audiofx.Visualizer: no mic permission,
 * no output-mix session, no OEM-specific Visualizer failures. The audio has
 * already been decoded by ExoPlayer, analyzed in-process, and published through
 * [KaraokePcmSpectrumBridge].
 */
internal class KaraokeSpectrumCapture(private val bandCount: Int = 16) {
    private var started = false
    private var attachLogged = false

    fun snapshot(renderDelayMs: Long = DEFAULT_RENDER_DELAY_MS): FloatArray {
        return if (started) {
            KaraokePcmSpectrumBridge.snapshot(bandCount, renderDelayMs)
        } else {
            FloatArray(bandCount)
        }
    }

    fun attach(newSessionId: Int) {
        if (!attachLogged) {
            attachLogged = true
            android.util.Log.w(
                "KaraokeSpectrum",
                "pcm capture attached sessionHint=$newSessionId source=TrackPlayerAudioProcessor",
            )
        }
    }

    fun start() {
        if (started) return
        started = true
        android.util.Log.w("KaraokeSpectrum", "pcm capture start")
    }

    fun stop() {
        started = false
    }

    fun release() {
        started = false
        attachLogged = false
    }

    companion object {
        private const val DEFAULT_RENDER_DELAY_MS = 380L
    }
}
