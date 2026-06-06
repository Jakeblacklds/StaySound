package expo.modules.karaokeview

import android.graphics.*
import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/**
 * KaraokeSpectrumRenderer — full-screen "cinematic aurora" visualizer.
 *
 * Design philosophy (vs. the old literal bottom ribbon):
 * - NOT A SPECTRUM. The X axis no longer maps 1:1 to frequency bands. That literal
 *   mapping read as a "data chart" and killed the cinematic feel. Instead we collapse
 *   the bands into THREE perceptual energies (bass / mid / treble) and let each DRIVE
 *   a distinct, generative visual. The form is its own; the audio is the soul.
 *
 *     · GRAVES (bass, bands 0–3)   → a slow-breathing radial BLOOM. Spring-smoothed so
 *       it has momentum and inertia — the eye loves "follow and settle", not twitch.
 *     · MEDIOS (mid, bands 4–9)    → a barely-there low MIST. A soft, formless haze
 *       band floating near the bottom whose density gently thickens with the mid energy
 *       (plus a slow breath + tiny vertical bob). No shape, no edges — you feel it more
 *       than you see it. Deliberately the most discreet layer.
 *     · AGUDOS (treble, bands 10–15) → floating PARTICLES (embers/stars) spawned on
 *       high-frequency transients (hats/cymbals), drifting up and fading. The "wow".
 *
 * - READABILITY FIRST. This draws full-screen BEHIND the lyrics. The lyrics are the
 *   star, so the bright core lives in the LOWER third (focus at ~0.62h, like a glow
 *   rising from behind the transport) and a vertical reading-safe falloff keeps the
 *   text band calm. All alphas are conservative; nothing ever competes with the words.
 *
 * - SAME PERF DISCIPLINE. Zero BlurMaskFilter. Cached radial/linear shaders scaled via
 *   the canvas (GPU). A fixed-size particle pool → no per-frame allocation.
 *   A handful of drawRect / drawCircle ops per frame even at full screen.
 */
internal class KaraokeSpectrumRenderer(
    private val density: Float,
    private val bandCount: Int,
) {
    // --- Perceptual energy envelopes -------------------------------------------------
    // Bass uses a light spring (position + velocity) for that weighty, inertial breath.
    private var bassDisplay = 0f
    private var bassVel = 0f
    private var midDisplay = 0f
    private var trebleDisplay = 0f

    // Slow baseline for treble transient (onset) detection — "louder than usual?".
    private var trebleBaseline = 0f
    private var trebleCooldown = 0f

    private var lastTimeMs = -1f

    // --- Particle pool (treble) ------------------------------------------------------
    private val pX = FloatArray(MAX_PARTICLES)
    private val pY = FloatArray(MAX_PARTICLES)
    private val pVx = FloatArray(MAX_PARTICLES)
    private val pVy = FloatArray(MAX_PARTICLES)
    private val pLife = FloatArray(MAX_PARTICLES)    // remaining ms, <=0 == inactive
    private val pMaxLife = FloatArray(MAX_PARTICLES)
    private val pSize = FloatArray(MAX_PARTICLES)
    private val pSeed = FloatArray(MAX_PARTICLES)
    private var nextParticle = 0

    private val rng = java.util.Random()

    // --- Paints ----------------------------------------------------------------------
    private val bloomPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val horizonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val mistPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val particlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private var glowColor = Color.WHITE
    private var whiteGlow = Color.WHITE

    // --- Cached geometry / shaders ---------------------------------------------------
    private var cx = 0f
    private var cy = 0f
    private var bloomBaseR = 1f
    private var bloomShader: RadialGradient? = null
    private var horizonShader: LinearGradient? = null
    private var mistShader: LinearGradient? = null
    private var cachedW = -1
    private var cachedH = -1
    private var cachedColor = 0

    fun setGlowColor(color: Int) {
        glowColor = color
        whiteGlow = blendToWhite(color, 0.55f)
    }

    fun draw(
        canvas: Canvas,
        bands: FloatArray,
        width: Int,
        height: Int,
        currentTimeMs: Long,
        isPlaying: Boolean,
        alphaScale: Float,
    ) {
        if (width <= 0 || height <= 0 || alphaScale <= 0.01f) return
        val w = width.toFloat()
        val h = height.toFloat()
        val alpha = alphaScale.coerceIn(0f, 1f)
        val t = currentTimeMs.toFloat()

        val dt = if (lastTimeMs < 0f) 16f else (t - lastTimeMs).coerceIn(0f, 64f)
        lastTimeMs = t

        rebuildIfNeeded(width, height)

        // --- Collapse the FFT bands into three perceptual energies -------------------
        val bass = bandAverage(bands, 0, bandCount * 25 / 100)        // lowest ~25%
        val mid = bandAverage(bands, bandCount * 25 / 100, bandCount * 62 / 100)
        val treble = bandAverage(bands, bandCount * 62 / 100, bandCount)

        // Bass → light spring (momentum). Quiet idle breath so it never looks dead.
        val idleBreath = if (!isPlaying) (0.5f + 0.5f * sin(t * 0.0011f)) * 0.06f else 0f
        val bassTarget = max(bass, idleBreath)
        // Semi-implicit spring integration (framerate independent via dt).
        bassVel += (bassTarget - bassDisplay) * BASS_STIFFNESS * dt
        bassVel *= 1f - (BASS_DAMPING * dt).coerceAtMost(0.95f)
        bassDisplay += bassVel * dt
        bassDisplay = bassDisplay.coerceIn(0f, 1.4f)

        // Mid → continuous level driving the low mist density (fast attack, soft release).
        // Treble → same easing, plus onset detection for the particle sparkle.
        midDisplay = ease(midDisplay, mid, dt, attack = 0.02f, release = 0.005f)
        trebleDisplay = ease(trebleDisplay, treble, dt, attack = 0.03f, release = 0.012f)

        trebleBaseline += (treble - trebleBaseline) * (0.006f * dt).coerceIn(0f, 1f)
        trebleCooldown = (trebleCooldown - dt).coerceAtLeast(0f)
        if (isPlaying && treble - trebleBaseline > TREBLE_ONSET && treble > 0.08f && trebleCooldown <= 0f) {
            spawnParticles(w, h, trebleDisplay)
            trebleCooldown = TREBLE_COOLDOWN_MS
        }

        // --- Draw order: horizon → bloom → mist → particles (back to front) ----------
        drawHorizon(canvas, w, h, alpha)
        drawBloom(canvas, alpha)
        drawMist(canvas, w, h, t, alpha)
        advanceAndDrawParticles(canvas, dt, h, alpha, t)
    }

    // --- Horizon: a soft grounding glow rising from the bottom edge -------------------
    private fun drawHorizon(canvas: Canvas, w: Float, h: Float, alpha: Float) {
        val shader = horizonShader ?: return
        horizonPaint.shader = shader
        val e = bassDisplay.coerceIn(0f, 1f)
        horizonPaint.alpha = (alpha * (22f + 42f * e)).toInt().coerceIn(0, 80)
        canvas.drawRect(0f, h * 0.55f, w, h, horizonPaint)
    }

    // --- Bloom: spring-driven radial core centered low on screen ----------------------
    private fun drawBloom(canvas: Canvas, alpha: Float) {
        val shader = bloomShader ?: return
        val e = bassDisplay.coerceIn(0f, 1.2f)
        val scale = 0.62f + 0.46f * e
        bloomPaint.shader = shader
        bloomPaint.alpha = (alpha * (30f + 78f * e)).toInt().coerceIn(0, 118)
        canvas.save()
        canvas.scale(scale, scale, cx, cy)
        canvas.drawCircle(cx, cy, bloomBaseR, bloomPaint)
        canvas.restore()
    }

    // --- Mist: a formless low haze whose density gently thickens with the mids --------
    private fun drawMist(canvas: Canvas, w: Float, h: Float, t: Float, alpha: Float) {
        val shader = mistShader ?: return
        val mid = midDisplay.coerceIn(0f, 1f)
        // Slow breath + a tiny vertical bob so the haze feels alive without any shape.
        val breath = 0.5f + 0.5f * sin(t * 0.0007f)
        val bob = sin(t * 0.0005f) * h * 0.012f
        mistPaint.shader = shader
        mistPaint.alpha = (alpha * (18f + 46f * mid) * (0.7f + 0.3f * breath))
            .toInt().coerceIn(0, 80)
        canvas.save()
        canvas.translate(0f, bob)
        // Generous rect; the shader fades to transparent on all sides so there are no
        // hard edges even as the band bobs past the screen bottom.
        canvas.drawRect(0f, h * 0.40f, w, h + 40f, mistPaint)
        canvas.restore()
    }

    // --- Particles: embers rising and swaying, brightest of all (treble sparkle) ------
    private fun advanceAndDrawParticles(
        canvas: Canvas,
        dt: Float,
        h: Float,
        alpha: Float,
        t: Float,
    ) {
        particlePaint.color = whiteGlow
        for (i in 0 until MAX_PARTICLES) {
            if (pLife[i] <= 0f) continue
            pLife[i] -= dt
            if (pLife[i] <= 0f) continue
            // Horizontal sway via a per-particle phase; vertical drift upward.
            val sway = sin(t * 0.0018f + pSeed[i]) * 0.012f * density * dt
            pX[i] += pVx[i] * dt + sway
            pY[i] += pVy[i] * dt
            val lifeFrac = (pLife[i] / pMaxLife[i]).coerceIn(0f, 1f)
            // Fade in quickly, out slowly: bell over life for a twinkle.
            val twinkle = (sin(lifeFrac * PI.toFloat()) * 0.6f + 0.4f).coerceIn(0f, 1f)
            val a = alpha * lifeFrac * twinkle * 170f * readingSafe(pY[i] / h)
            particlePaint.alpha = a.toInt().coerceIn(0, 180)
            canvas.drawCircle(pX[i], pY[i], pSize[i] * (0.6f + 0.4f * lifeFrac), particlePaint)
        }
    }

    // --- Emission --------------------------------------------------------------------
    private fun spawnParticles(w: Float, h: Float, strength: Float) {
        val count = (2 + (strength.coerceIn(0f, 1f) * 5f)).toInt().coerceIn(2, 6)
        repeat(count) {
            val i = nextParticle
            nextParticle = (nextParticle + 1) % MAX_PARTICLES
            // Spawn low and spread horizontally; rise up and fade.
            pX[i] = w * (0.15f + 0.70f * rng.nextFloat())
            pY[i] = h * (0.72f + 0.20f * rng.nextFloat())
            pVx[i] = (rng.nextFloat() - 0.5f) * 0.04f * density
            pVy[i] = -(0.12f + 0.26f * rng.nextFloat()) * density
            pMaxLife[i] = 2400f + 2200f * rng.nextFloat()
            pLife[i] = pMaxLife[i]
            pSize[i] = (1.4f + 2.4f * rng.nextFloat()) * density
            pSeed[i] = rng.nextFloat() * TWO_PI
        }
    }

    // --- Reading-safe vertical falloff ----------------------------------------------
    // Returns a [0,1] multiplier that dims the prime lyrics band (upper-middle) so the
    // text always stays legible; full strength toward the bottom and very top.
    private fun readingSafe(ny: Float): Float {
        val y = ny.coerceIn(0f, 1f)
        // Notch centered around the reading zone (~0.18..0.55 of the screen).
        return if (y in 0.14f..0.58f) {
            val d = ((y - 0.36f) / 0.22f).coerceIn(-1f, 1f)
            0.35f + 0.65f * (d * d) // dip to 0.35 at center of the text band
        } else 1f
    }

    // --- Helpers ---------------------------------------------------------------------
    private fun bandAverage(bands: FloatArray, from: Int, to: Int): Float {
        if (bands.isEmpty()) return 0f
        val lo = from.coerceIn(0, bands.size)
        val hi = to.coerceIn(lo + 1, bands.size)
        var sum = 0f
        for (i in lo until hi) sum += bands[i].coerceAtLeast(0f)
        return (sum / (hi - lo)).coerceIn(0f, 1.5f)
    }

    private fun ease(cur: Float, target: Float, dt: Float, attack: Float, release: Float): Float {
        val coef = (if (target > cur) attack else release) * dt
        return cur + (target - cur) * coef.coerceIn(0f, 1f)
    }

    private fun blendToWhite(color: Int, amount: Float): Int {
        val a = amount.coerceIn(0f, 1f)
        val r = (Color.red(color) + (255 - Color.red(color)) * a).toInt()
        val g = (Color.green(color) + (255 - Color.green(color)) * a).toInt()
        val b = (Color.blue(color) + (255 - Color.blue(color)) * a).toInt()
        return Color.rgb(r, g, b)
    }

    private fun rebuildIfNeeded(width: Int, height: Int) {
        if (cachedW == width && cachedH == height && cachedColor == glowColor) return
        cachedW = width
        cachedH = height
        cachedColor = glowColor

        val w = width.toFloat()
        val h = height.toFloat()
        cx = w * 0.5f
        cy = h * 0.62f // focus low — bright core sits behind the transport, not the text
        bloomBaseR = hypot(w, h) * 0.42f

        val r = Color.red(glowColor)
        val g = Color.green(glowColor)
        val b = Color.blue(glowColor)

        bloomShader = RadialGradient(
            cx, cy, bloomBaseR,
            intArrayOf(
                Color.argb(150, r, g, b),
                Color.argb(70, r, g, b),
                Color.argb(0, r, g, b),
            ),
            floatArrayOf(0f, 0.45f, 1f),
            Shader.TileMode.CLAMP,
        )

        horizonShader = LinearGradient(
            0f, h * 0.55f, 0f, h,
            intArrayOf(Color.argb(0, r, g, b), Color.argb(200, r, g, b)),
            floatArrayOf(0f, 1f),
            Shader.TileMode.CLAMP,
        )

        // A soft floating haze band: transparent on top AND bottom so it has no hard
        // edges — just a faint thickening of density toward its middle. Low alphas keep
        // it a whisper; drawMist scales it further by the mid energy.
        mistShader = LinearGradient(
            0f, h * 0.48f, 0f, h,
            intArrayOf(
                Color.argb(0, r, g, b),
                Color.argb(40, r, g, b),
                Color.argb(64, r, g, b),
                Color.argb(0, r, g, b),
            ),
            floatArrayOf(0f, 0.5f, 0.82f, 1f),
            Shader.TileMode.CLAMP,
        )
    }

    companion object {
        private const val MAX_PARTICLES = 32

        // Bass spring tuning (per-ms). Soft + slightly under-damped → an inertial breath.
        private const val BASS_STIFFNESS = 0.00016f
        private const val BASS_DAMPING = 0.012f

        // Treble onset threshold (energy above slow baseline) + cooldown to avoid spamming.
        private const val TREBLE_ONSET = 0.05f
        private const val TREBLE_COOLDOWN_MS = 70f

        private val TWO_PI = (2.0 * PI).toFloat()
    }
}
