package expo.modules.karaokeview

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * KaraokeSpectrumView
 *
 * A thin, full-width view meant to be pinned to the very bottom of the screen
 * (below the lyrics, transport controls and everything else). It renders the live
 * audio "aurora" spectrum using the shared [KaraokeSpectrumCapture] +
 * [KaraokeSpectrumRenderer].
 *
 * It is a SEPARATE view from KaraokeView precisely so React Native can position it
 * independently — KaraokeView is clipped to the (padded) lyrics viewport and can't
 * draw at the screen's bottom edge.
 *
 * Audio source: prefers an explicit session id; otherwise reads the ExoPlayer
 * session id that track-player's MusicService persisted to prefs, so it captures
 * the player's OWN session (no RECORD_AUDIO prompt). 0 → global output mix.
 */
class KaraokeSpectrumView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val density = resources.displayMetrics.density
    private val capture = KaraokeSpectrumCapture(BANDS)
    private val renderer = KaraokeSpectrumRenderer(density, BANDS)
    private var animator: LyricsAnimator? = null

    private var enabled = false
    private var isPlaying = false
    private var audioSessionId = 0
    private var renderDelayMs = DEFAULT_RENDER_DELAY_MS
    private val startNanos = System.nanoTime()

    // Frame throttle: the spectrum doesn't need the lyrics' 120fps. We cap it so it
    // stops competing for the shared UI-thread frame budget (the cause of the lyrics
    // stutter). 60fps while playing, 30fps while idle (just the gentle breathing).
    private var lastFrameNanos = 0L

    init {
        setBackgroundColor(Color.TRANSPARENT)
        // No LAYER_TYPE_HARDWARE: this view repaints every frame, so an offscreen
        // hardware layer only adds an extra texture copy. The default RenderNode path
        // is already GPU-accelerated and cheaper for continuously-animated content.
    }

    fun setSpectrumEnabled(value: Boolean) {
        if (value == enabled) return
        enabled = value
        updateState()
        invalidate()
    }

    fun setSpectrumPlaying(value: Boolean) {
        isPlaying = value
        updateState()
    }

    fun setAudioSessionId(value: Int) {
        if (value == audioSessionId) return
        audioSessionId = value
        updateState()
    }

    fun setRenderDelayMs(value: Int) {
        renderDelayMs = value.toLong().coerceIn(0L, MAX_RENDER_DELAY_MS)
    }

    fun setGlowColor(color: Int) {
        renderer.setGlowColor(color)
        invalidate()
    }

    private fun resolveSessionId(): Int {
        if (audioSessionId > 0) return audioSessionId
        return try {
            context.getSharedPreferences("staysound_audio", Context.MODE_PRIVATE)
                .getInt("exo_audio_session_id", 0)
        } catch (_: Throwable) {
            0
        }
    }

    private fun updateState() {
        if (enabled) {
            val resolved = resolveSessionId()
            android.util.Log.w(
                "KaraokeSpectrum",
                "SpectrumView updateState enabled=$enabled playing=$isPlaying resolvedSessionId=$resolved",
            )
            capture.attach(resolved.coerceAtLeast(0))
            if (isPlaying) capture.start() else capture.stop()
            startAnimator()
        } else {
            capture.release()
            animator?.stop()
            animator = null
        }
    }

    private fun startAnimator() {
        if (animator?.isRunning == true) return
        animator = LyricsAnimator {
            // Throttle invalidations to the target interval so we don't redraw on
            // every vsync (up to 120Hz) and steal frames from the lyrics renderer.
            val now = System.nanoTime()
            val interval = if (isPlaying) PLAYING_FRAME_NS else IDLE_FRAME_NS
            if (now - lastFrameNanos >= interval) {
                lastFrameNanos = now
                invalidate()
            }
        }.also { it.start() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!enabled) return
        val nowMs = (System.nanoTime() - startNanos) / 1_000_000L
        renderer.draw(
            canvas = canvas,
            bands = capture.snapshot(renderDelayMs),
            width = width,
            height = height,
            currentTimeMs = nowMs,
            isPlaying = isPlaying,
            alphaScale = 1f,
        )
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        updateState()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        animator?.stop()
        animator = null
        capture.release()
    }

    companion object {
        private const val BANDS = 16
        private const val DEFAULT_RENDER_DELAY_MS = 350L
        private const val MAX_RENDER_DELAY_MS = 650L
        private const val PLAYING_FRAME_NS = 16_000_000L // ~60fps
        private const val IDLE_FRAME_NS = 33_000_000L    // ~30fps
    }
}
