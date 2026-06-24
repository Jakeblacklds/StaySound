package expo.modules.karaokeview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RenderEffect
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.min

/**
 * KaraokeRefractionView — the "Refraction Veil" theme: an Apple-style liquid-glass veil hugging
 * the album cover's curved edge over an arc (11 o'clock → 5 o'clock by default).
 *
 * The view simply draws the album cover clipped to a circle and rotating with the CD spin; a
 * [RenderEffect] running [KaraokeRefractionShader] then bends a curved band of that LIVE content
 * along the arc. The lens stays static and the album flows under it; there is NO surrounding halo
 * — only the cover is drawn, so beyond the circle the real player background shows through.
 *
 * Requires AGSL (API 33+). Below that it draws the plain rotating cover with no veil.
 */
class KaraokeRefractionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val loader = Executors.newSingleThreadExecutor()
    private var animator: LyricsAnimator? = null
    private val coverPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    private var enabled = false
    private var isPlaying = false
    private var artworkUri: String? = null

    private var glowColor = Color.WHITE
    private var hotColor = Color.WHITE

    // Tunables (RN props). Defaults: a curved veil over the top + right rim (11 → 5 o'clock).
    private var arcCenterDeg = -30f     // screen space: 0 = right (3 o'clock), -90 = up (12)
    private var arcSweepDeg = 180f
    private var arcFeatherDeg = 20f
    private var bandInnerFrac = 0.5f    // inner radius of the band as a fraction of the cover radius
    private var strengthFrac = 0.18f    // rim refraction displacement as a fraction of the radius
    private var chroma = 0.04f
    private var blurFrac = 0.05f        // blur tap radius as a fraction of the radius
    private var rimFrac = 0.03f         // specular rim thickness as a fraction of the radius
    private var intensity = 1.0f
    private var coverFrac = 0.94f       // cover diameter ÷ view size (tiny margin for the rim)

    private var spinDeg = 0f
    private var lastTimeMs = -1f
    private var lastFrameNanos = 0L
    private val startNanos = System.nanoTime()

    @Volatile private var bitmap: Bitmap? = null
    private val coverPath = Path()
    private var pathW = -1
    private var pathH = -1
    private var pathCoverFrac = -1f
    private var effectDirty = true
    private var effectW = -1
    private var effectH = -1

    init {
        setBackgroundColor(Color.TRANSPARENT)
    }

    fun setRefractionEnabled(value: Boolean) {
        if (value == enabled) return
        enabled = value
        if (enabled) {
            startAnimator()
        } else {
            animator?.stop(); animator = null
            if (Build.VERSION.SDK_INT >= 31) setRenderEffect(null)
        }
        invalidate()
    }

    fun setRefractionPlaying(value: Boolean) { isPlaying = value }

    fun setGlowColor(color: Int) {
        glowColor = color
        hotColor = luminousTint(color, lift = 0.66f, satBoost = 0.06f)
        effectDirty = true
        invalidate()
    }

    fun setArtworkUri(value: String?) {
        val next = value?.takeIf { it.isNotBlank() }
        if (next == artworkUri) return
        artworkUri = next
        spinDeg = 0f
        loadBitmap(next)
    }

    fun setArcCenterDeg(value: Float) { arcCenterDeg = value; effectDirty = true; invalidate() }
    fun setArcSweepDeg(value: Float) { arcSweepDeg = value.coerceIn(20f, 360f); effectDirty = true; invalidate() }
    fun setArcFeatherDeg(value: Float) { arcFeatherDeg = value.coerceIn(2f, 60f); effectDirty = true; invalidate() }
    fun setBandInnerFrac(value: Float) { bandInnerFrac = value.coerceIn(0.1f, 0.95f); effectDirty = true; invalidate() }
    fun setRefractionStrength(value: Float) { strengthFrac = value.coerceIn(0f, 0.6f); effectDirty = true; invalidate() }
    fun setChroma(value: Float) { chroma = value.coerceIn(0f, 0.4f); effectDirty = true; invalidate() }
    fun setBlur(value: Float) { blurFrac = value.coerceIn(0f, 0.2f); effectDirty = true; invalidate() }
    fun setRimWidth(value: Float) { rimFrac = value.coerceIn(0.005f, 0.15f); effectDirty = true; invalidate() }
    fun setIntensity(value: Float) { intensity = value.coerceIn(0f, 1f); effectDirty = true; invalidate() }
    fun setCoverFrac(value: Float) {
        coverFrac = value.coerceIn(0.5f, 1f)
        effectDirty = true
        pathCoverFrac = -1f
        invalidate()
    }

    private fun loadBitmap(uri: String?) {
        bitmap = null
        invalidate()
        if (uri == null) return
        loader.execute {
            val sharp = runCatching { decodeScaledSquare(uri, TARGET_PX) }.getOrNull()
            if (sharp != null && uri == artworkUri) {
                post {
                    bitmap = sharp
                    invalidate()
                }
            }
        }
    }

    private fun decodeScaledSquare(uri: String, target: Int): Bitmap? {
        val raw = openBitmap(uri) ?: return null
        val side = min(raw.width, raw.height)
        val left = (raw.width - side) / 2
        val top = (raw.height - side) / 2
        val square = Bitmap.createBitmap(raw, left, top, side, side)
        if (square != raw) raw.recycle()
        if (square.width <= target) return square
        val scaled = Bitmap.createScaledBitmap(square, target, target, true)
        if (scaled != square) square.recycle()
        return scaled
    }

    private fun openBitmap(uri: String): Bitmap? {
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        return when {
            uri.startsWith("http://") || uri.startsWith("https://") -> {
                val conn = (URL(uri).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    instanceFollowRedirects = true
                }
                try {
                    conn.inputStream.use { BitmapFactory.decodeStream(it, null, opts) }
                } finally {
                    conn.disconnect()
                }
            }
            uri.startsWith("content://") ->
                context.contentResolver.openInputStream(Uri.parse(uri))?.use {
                    BitmapFactory.decodeStream(it, null, opts)
                }
            uri.startsWith("file://") -> BitmapFactory.decodeFile(Uri.parse(uri).path, opts)
            else -> BitmapFactory.decodeFile(uri, opts)
        }
    }

    private fun startAnimator() {
        if (animator?.isRunning == true) return
        animator = LyricsAnimator {
            val now = System.nanoTime()
            val interval = if (isPlaying) PLAYING_FRAME_NS else IDLE_FRAME_NS
            if (now - lastFrameNanos >= interval) {
                lastFrameNanos = now
                invalidate()
            }
        }.also { it.start() }
    }

    private fun ensureCoverPath(w: Int, h: Int) {
        if (pathW == w && pathH == h && pathCoverFrac == coverFrac) return
        val coverR = min(w, h) * 0.5f * coverFrac
        coverPath.reset()
        coverPath.addCircle(w * 0.5f, h * 0.5f, coverR, Path.Direction.CW)
        pathW = w; pathH = h; pathCoverFrac = coverFrac
    }

    private fun ensureRenderEffect(w: Int, h: Int) {
        if (Build.VERSION.SDK_INT < 33) return
        if (!effectDirty && effectW == w && effectH == h) return
        val coverR = min(w, h) * 0.5f * coverFrac
        val cx = w * 0.5f
        val cy = h * 0.5f
        val toRad = (PI / 180.0).toFloat()
        val rs = KaraokeRefractionShader.build(
            centerX = cx,
            centerY = cy,
            radius = coverR,
            arcCenter = arcCenterDeg * toRad,
            arcHalf = arcSweepDeg * 0.5f * toRad,
            arcFeather = arcFeatherDeg * toRad,
            bandInner = coverR * bandInnerFrac,
            strength = coverR * strengthFrac,
            chroma = chroma,
            blurPx = coverR * blurFrac,
            rimWidth = coverR * rimFrac,
            intensity = intensity,
            hotR = Color.red(hotColor) / 255f,
            hotG = Color.green(hotColor) / 255f,
            hotB = Color.blue(hotColor) / 255f,
        ) ?: return
        setRenderEffect(RenderEffect.createRuntimeShaderEffect(rs, "content"))
        effectDirty = false
        effectW = w
        effectH = h
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!enabled) return
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return
        val cover = bitmap ?: return

        ensureCoverPath(w, h)
        ensureRenderEffect(w, h)

        val t = (System.nanoTime() - startNanos) / 1_000_000L.toFloat()
        val dt = if (lastTimeMs < 0f) 16f else (t - lastTimeMs).coerceIn(0f, 64f)
        lastTimeMs = t
        if (isPlaying) spinDeg = (spinDeg + dt * SPIN_DEG_PER_MS) % 360f

        val cx = w * 0.5f
        val cy = h * 0.5f
        val coverR = min(w, h) * 0.5f * coverFrac
        canvas.save()
        canvas.clipPath(coverPath)
        canvas.rotate(spinDeg, cx, cy)
        val d = coverR * 2f
        val m = Matrix().apply {
            setScale(d / cover.width, d / cover.height)
            postTranslate(cx - coverR, cy - coverR)
        }
        canvas.drawBitmap(cover, m, coverPaint)
        canvas.restore()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (enabled) startAnimator()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        animator?.stop()
        animator = null
    }

    companion object {
        private const val TARGET_PX = 256
        private const val PLAYING_FRAME_NS = 16_000_000L // ~60fps
        private const val IDLE_FRAME_NS = 33_000_000L    // ~30fps
        // Match the RN FullPlayer CD spin: 360° every 60s.
        private const val SPIN_DEG_PER_MS = 360f / 60_000f
    }
}
