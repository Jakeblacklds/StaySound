package expo.modules.karaokeview

import android.graphics.*
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * KaraokeAmbientBackgroundRenderer
 *
 * Draws a slow, cinematic animated background behind the karaoke lyrics:
 * three large radial-gradient "orbs" that drift organically using sine/cosine
 * functions keyed to `currentTimeMs`.
 *
 * Performance contract:
 * - Zero per-frame heap allocations: all Paint/Shader objects are recycled.
 * - Only recomputes shader when orb position changes (guarded by a delta threshold).
 * - Falls back gracefully if the view is too small.
 * - Lightweight mode: single orb, 50% opacity cap.
 */
internal class KaraokeAmbientBackgroundRenderer(private val density: Float) {

    // --- Pre-allocated paint (one per orb) ---
    private val paint0 = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val paint1 = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val paint2 = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    // --- Orb color channels (updated via setGlowColor) ---
    private var r0 = 100; private var g0 = 80;  private var b0 = 200  // Primary (accent)
    private var r1 = 60;  private var g1 = 120; private var b1 = 220  // Secondary
    private var r2 = 30;  private var g2 = 60;  private var b2 = 160  // Deep / background

    // --- Cache: last painted orb centers to avoid unnecessary shader rebuilds ---
    private var lastCx0 = -999f; private var lastCy0 = -999f
    private var lastCx1 = -999f; private var lastCy1 = -999f
    private var lastCx2 = -999f; private var lastCy2 = -999f
    private val rebuildThreshold = 6f * density  // Only rebuild shader if moved > 6dp

    /**
     * Call once whenever the accent/glow color changes.
     * Splits the single int into three orb color variants.
     */
    fun setColors(glowColor: Int, backgroundColor: Int) {
        val gr = Color.red(glowColor)
        val gg = Color.green(glowColor)
        val gb = Color.blue(glowColor)

        // Orb 0 — pure accent
        r0 = gr; g0 = gg; b0 = gb

        // Orb 1 — shifted hue toward blue/violet (complementary feel)
        r1 = (gr * 0.55f + gb * 0.45f).toInt().coerceIn(0, 255)
        g1 = (gg * 0.60f + 40).toInt().coerceIn(0, 255)
        b1 = (gb * 0.85f + gr * 0.15f).toInt().coerceIn(0, 255)

        // Orb 2 — blends with background for depth
        val br = Color.red(backgroundColor)
        val bg = Color.green(backgroundColor)
        val bb = Color.blue(backgroundColor)
        r2 = ((gr + br) / 2).coerceIn(0, 255)
        g2 = ((gg + bg) / 2).coerceIn(0, 255)
        b2 = ((gb + bb) / 2).coerceIn(0, 255)

        // Force shader rebuild on next draw
        lastCx0 = -999f; lastCx1 = -999f; lastCx2 = -999f
    }

    /**
     * Draws the animated ambient background.
     *
     * @param canvas       Target canvas (must be inside a saveLayer if transparency is needed).
     * @param currentTimeMs Current playback/animation time in milliseconds.
     * @param width        View width in px.
     * @param height       View height in px.
     * @param alpha        Global alpha 0–255 (controls overall visibility).
     * @param lightweight  If true, render a single orb at reduced opacity (low-end devices).
     */
    fun draw(
        canvas: Canvas,
        currentTimeMs: Long,
        width: Int,
        height: Int,
        alpha: Int,
        lightweight: Boolean,
    ) {
        if (width <= 0 || height <= 0 || alpha <= 0) return

        val t = currentTimeMs.toFloat()
        val w = width.toFloat()
        val h = height.toFloat()

        // ------------------------------------------------------------------
        // Orb 0 — large primary blob, slow drift, top half
        // Frequency: ~22s cycle  |  Amplitude: 15% of screen
        // ------------------------------------------------------------------
        val cx0 = w * 0.50f + w * 0.16f * sin(t * 0.000285f)
        val cy0 = h * 0.32f + h * 0.12f * cos(t * 0.000220f)
        val r0radius = (h * 0.65f)

        if (needsRebuild(cx0, cy0, lastCx0, lastCy0)) {
            paint0.shader = buildRadialShader(cx0, cy0, r0radius, r0, g0, b0, alpha, maxAlpha = if (lightweight) 55 else 90)
            lastCx0 = cx0; lastCy0 = cy0
        }
        canvas.drawCircle(cx0, cy0, r0radius, paint0)

        if (lightweight) return  // Lightweight: single orb only

        // ------------------------------------------------------------------
        // Orb 1 — medium secondary blob, medium drift, bottom-right
        // Frequency: ~17s cycle  |  Amplitude: 18% of screen
        // ------------------------------------------------------------------
        val cx1 = w * 0.72f + w * 0.18f * cos(t * 0.000370f + 1.1f)
        val cy1 = h * 0.70f + h * 0.14f * sin(t * 0.000290f + 2.2f)
        val r1radius = (h * 0.55f)

        if (needsRebuild(cx1, cy1, lastCx1, lastCy1)) {
            paint1.shader = buildRadialShader(cx1, cy1, r1radius, r1, g1, b1, alpha, maxAlpha = 70)
            lastCx1 = cx1; lastCy1 = cy1
        }
        canvas.drawCircle(cx1, cy1, r1radius, paint1)

        // ------------------------------------------------------------------
        // Orb 2 — deep small blob, faster drift, left side — adds depth
        // Frequency: ~13s cycle  |  Amplitude: 20% of screen
        // ------------------------------------------------------------------
        val cx2 = w * 0.22f + w * 0.20f * sin(t * 0.000480f + 3.3f)
        val cy2 = h * 0.58f + h * 0.18f * cos(t * 0.000410f + 0.7f)
        val r2radius = (h * 0.42f)

        if (needsRebuild(cx2, cy2, lastCx2, lastCy2)) {
            paint2.shader = buildRadialShader(cx2, cy2, r2radius, r2, g2, b2, alpha, maxAlpha = 55)
            lastCx2 = cx2; lastCy2 = cy2
        }
        canvas.drawCircle(cx2, cy2, r2radius, paint2)
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Returns true if the orb moved more than the threshold → needs shader rebuild. */
    private fun needsRebuild(cx: Float, cy: Float, lastCx: Float, lastCy: Float): Boolean {
        val dx = abs(cx - lastCx)
        val dy = abs(cy - lastCy)
        return dx > rebuildThreshold || dy > rebuildThreshold
    }

    /**
     * Builds a radial gradient that fades from the orb color at center
     * to fully transparent at the edge.  Accepts `alpha` (0–255) and
     * `maxAlpha` to cap brightness regardless of the passed alpha.
     */
    private fun buildRadialShader(
        cx: Float, cy: Float, radius: Float,
        r: Int, g: Int, b: Int,
        alpha: Int, maxAlpha: Int,
    ): RadialGradient {
        val a0 = ((alpha / 255f) * maxAlpha).toInt().coerceIn(0, maxAlpha)
        val a1 = (a0 * 0.35f).toInt()
        return RadialGradient(
            cx, cy, radius,
            intArrayOf(
                Color.argb(a0, r, g, b),
                Color.argb(a1, r, g, b),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )
    }
}
