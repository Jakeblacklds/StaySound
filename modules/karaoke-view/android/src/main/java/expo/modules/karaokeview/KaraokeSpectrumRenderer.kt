package expo.modules.karaokeview

import android.graphics.*
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * KaraokeSpectrumRenderer — full-screen "cinematic aurora" visualizer.
 *
 * Design philosophy (vs. the old literal bottom ribbon):
 * - NOT A SPECTRUM. The X axis no longer maps 1:1 to frequency bands. That literal
 *   mapping read as a "data chart" and killed the cinematic feel. Instead we collapse
 *   the bands into perceptual energies and let each DRIVE a distinct, generative
 *   visual. The form is its own; the audio is the soul.
 *
 *     · GRAVES (bass, lowest ~25%)  → a slow-breathing radial BLOOM + a grounding
 *       horizon glow. Spring-smoothed so it has momentum and inertia.
 *     · MEDIOS (mid, ~25–62%)       → STAGE LIGHTS. In artwork (player) mode the mid slice
 *       is split into [MID_BEAMS] sub-bands, each driving its OWN diagonal light column
 *       anchored at the top edge, that ignites/grows long with its frequency. Play a chord
 *       and several columns light up at once. In lyrics mode it stays the discreet MIST.
 *     · AGUDOS (treble, ~62–100%)   → a whisper-faint airy VEIL along the very top that
 *       gently breathes with the treble level. Deliberately subtle — no flashes, no
 *       glints — just a hint of "air" that never draws the eye.
 *
 * - READABILITY FIRST. This draws full-screen BEHIND the lyrics/controls. All alphas
 *   are conservative; a vertical reading-safe falloff keeps the text band calm.
 *
 * - SAME PERF DISCIPLINE. Zero BlurMaskFilter. Cached radial/linear shaders scaled via
 *   the canvas (GPU). A handful of drawRect / drawCircle ops per frame.
 */
internal class KaraokeSpectrumRenderer(
    private val density: Float,
    private val bandCount: Int,
) {
    /**
     * Where the composition is anchored — this flips the readability rules:
     *  · LYRICS  : bright core low (behind the transport), the upper-middle reading band
     *              is dimmed so the words stay legible. (Karaoke default.)
     *  · ARTWORK : bright core centered low behind the album cover so the glow reads as a
     *              HALO breathing out — Apple "now playing" feel. Stage lights + shimmer
     *              veil are the hero here.
     */
    enum class AnchorMode { LYRICS, ARTWORK }

    /**
     * The visual treatment for the medios+agudos in ARTWORK (player) mode — user-selectable
     * from the FullPlayer options sheet. Graves (horizon + bloom) are unaffected:
     *  · COLUMNS  : the diagonal stage-light rig (directional, energetic).
     *  · AURORA   : a domain-warped curtain field framing the bloom (ambient).
     *  · CAUSTICS : a liquid water-light web (ambient, "liquid").
     *  · WAVEFORM_ARC : a sparse mid-frequency waveform that grazes the album edge.
     * AURORA/CAUSTICS need AGSL (API 33+); on older devices they fall back to mist + veil.
     */
    enum class Theme { COLUMNS, AURORA, CAUSTICS, WAVEFORM_ARC, REFRACTION_VEIL }

    private var anchorMode = AnchorMode.LYRICS
    private var theme = Theme.AURORA
    private var focusYNorm = 0.62f
    private var particleIntensity = 1f
    private var artworkDiameterPx = 0f

    // --- Perceptual energy envelopes -------------------------------------------------
    // Bass uses a light spring (position + velocity) for that weighty, inertial breath.
    private var bassDisplay = 0f
    private var bassVel = 0f
    private var midDisplay = 0f
    private var trebleDisplay = 0f

    // Per-ray smoothed levels for the mid god-rays (one envelope per ray).
    private val midBeamDisplay = FloatArray(MID_BEAMS)
    private val waveformBarDisplay = FloatArray(WAVEFORM_BARS)

    private var lastTimeMs = -1f

    // --- Paints ----------------------------------------------------------------------
    private val bloomPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val horizonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val mistPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val veilPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val beamPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val auroraPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val waveformPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }

    private var glowColor = Color.WHITE
    private var whiteGlow = Color.WHITE

    // --- Cached geometry / shaders ---------------------------------------------------
    private var cx = 0f
    private var cy = 0f
    private var bloomBaseR = 1f
    private var bloomShader: RadialGradient? = null
    private var horizonShader: LinearGradient? = null
    private var mistShader: LinearGradient? = null
    private var waveformShader: SweepGradient? = null
    // Stage-light column: a cone narrow at the top-edge fixture, widening toward the far
    // tip. Three nested trapezoids (halo → body → hot core) drawn ADDITIVELY sum into a
    // soft bell across the width — feathered lateral edges with zero blur cost.
    private var beamShader: LinearGradient? = null     // tinted (halo + body)
    private var beamShaderHot: LinearGradient? = null   // near-white ignite core
    private var beamBaseLen = 1f
    private val beamCore = Path()
    private val beamBody = Path()
    private val beamHalo = Path()
    // Local geometry the AGSL liquid shader samples in (apex/glow half-widths).
    private var beamApexHalf = 1f
    private var beamGlowHalf = 1f
    // The soft hotspot pool where each column is born (the "fixture lens").
    private val fixturePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private var fixtureShader: RadialGradient? = null
    private var fixtureBaseR = 1f
    // Premium finish detail: a crisp inner filament, the bright spine of the column.
    private val beamFilament = Path()
    // Light is additive: crossings BRIGHTEN instead of muddying.
    private val addXfer = PorterDuffXfermode(PorterDuff.Mode.ADD)
    private var veilShader: LinearGradient? = null
    private var cachedW = -1
    private var cachedH = -1
    private var cachedColor = 0

    fun setGlowColor(color: Int) {
        glowColor = color
        // Was blendToWhite(color, 0.55f) → washed every hot core to white.
        // Now a LUMINOUS TINT of the album color: bright ignite, same hue family.
        whiteGlow = luminousTint(color, lift = 0.52f, satBoost = 0.12f)
    }

    fun setAnchorMode(mode: AnchorMode) {
        if (mode == anchorMode) return
        anchorMode = mode
        cachedW = -1 // force a geometry/shader rebuild on the next frame
    }

    fun setTheme(value: Theme) {
        theme = value
    }

    /** Vertical focus of the bright core, normalized [0,1] (e.g. the album-cover center). */
    fun setFocusY(norm: Float) {
        val v = norm.coerceIn(0.12f, 0.9f)
        if (kotlin.math.abs(v - focusYNorm) < 0.002f) return
        focusYNorm = v
        cachedW = -1
    }

    fun setArtworkSize(diameterPx: Float) {
        val v = diameterPx.coerceAtLeast(0f)
        if (abs(v - artworkDiameterPx) < 1f) return
        artworkDiameterPx = v
        cachedW = -1
    }

    fun setParticleIntensity(value: Float) {
        particleIntensity = value.coerceIn(0.15f, 1.2f)
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

        // Mid → continuous level driving the low mist density (lyrics mode).
        // Treble → gentle easing for the subtle airy veil.
        midDisplay = ease(midDisplay, mid, dt, attack = 0.05f, release = 0.006f)
        trebleDisplay = ease(trebleDisplay, treble, dt, attack = 0.06f, release = 0.014f)

        // --- Draw order: horizon → bloom → mids/agudos → (lyrics veil) ---------------
        // GRAVES stay the hero (horizon + bloom). In ARTWORK mode the medios+agudos are
        // one cohesive AGSL AURORA field framing that core; in LYRICS mode they remain the
        // discreet mist + airy veil.
        if (anchorMode == AnchorMode.ARTWORK) {
            when (theme) {
                Theme.WAVEFORM_ARC -> {
                    drawHorizon(canvas, w, h, alpha)
                    drawBloom(canvas, alpha)
                    drawWaveformArc(canvas, bands, w, h, t, dt, isPlaying, alpha)
                }
                Theme.REFRACTION_VEIL -> {
                    // The veil itself is a separate overlay (KaraokeRefractionView) painted ON
                    // the cover. Here we only contribute the calm graves ambience behind it.
                    drawHorizon(canvas, w, h, alpha)
                    drawBloom(canvas, alpha)
                }
                Theme.COLUMNS -> {
                    drawHorizon(canvas, w, h, alpha)
                    drawBloom(canvas, alpha)
                    drawStageLights(canvas, bands, w, h, t, dt, alpha)
                    drawShimmerVeil(canvas, w, h, t, alpha)
                }
                Theme.AURORA, Theme.CAUSTICS -> {
                    drawHorizon(canvas, w, h, alpha)
                    drawBloom(canvas, alpha)
                    val style = if (theme == Theme.CAUSTICS) {
                        KaraokeAuroraShader.STYLE_CAUSTICS
                    } else {
                        KaraokeAuroraShader.STYLE_AURORA
                    }
                    if (!drawAurora(canvas, w, h, t, alpha, style)) {
                        // API < 33 (no AGSL): soft, column-free ambient fallback.
                        drawMist(canvas, w, h, t, alpha)
                        drawShimmerVeil(canvas, w, h, t, alpha)
                    }
                }
            }
        } else {
            drawHorizon(canvas, w, h, alpha)
            drawBloom(canvas, alpha)
            drawMist(canvas, w, h, t, alpha)
            drawShimmerVeil(canvas, w, h, t, alpha)
        }
    }

    // --- Waveform Arc (artwork/player mode): discreet mid-band bars around the cover ----
    private fun drawWaveformArc(
        canvas: Canvas,
        bands: FloatArray,
        w: Float,
        h: Float,
        t: Float,
        dt: Float,
        isPlaying: Boolean,
        alpha: Float,
    ) {
        val midLo = bandCount * 25 / 100
        val midHi = (bandCount * 62 / 100).coerceAtLeast(midLo + 1)
        val span = midHi - midLo
        val coverRadius = if (artworkDiameterPx > 0f) {
            artworkDiameterPx * 0.5f
        } else {
            min(w - 56f * density, h * 0.36f) * 0.5f
        }
        if (coverRadius <= 0f) return

        val orbit = coverRadius + 10f * density
        val minLen = 4f * density
        val maxLen = 24f * density
        val baseStart = 18f
        val arcSweep = 128f
        val drift = if (isPlaying) sin(t * 0.00018f) * 5.5f else 0f
        val masterBreath = 0.82f + 0.18f * sin(t * 0.001f)

        waveformPaint.strokeWidth = 2.4f * density
        waveformPaint.shader = waveformShader
        waveformPaint.color = luminousTint(glowColor, lift = 0.5f, satBoost = 0.1f)
        waveformPaint.xfermode = null

        for (i in 0 until WAVEFORM_BARS) {
            val from = midLo + span * i / WAVEFORM_BARS
            val to = (midLo + span * (i + 1) / WAVEFORM_BARS).coerceAtLeast(from + 1)
            val target = bandAverage(bands, from, to)
            waveformBarDisplay[i] = ease(waveformBarDisplay[i], target, dt, attack = 0.035f, release = 0.0045f)

            val raw = waveformBarDisplay[i].coerceIn(0f, 1f)
            val shaped = Math.pow(raw.toDouble(), 0.72).toFloat()
            val position = i / (WAVEFORM_BARS - 1f)
            val tapered = 0.35f + 0.65f * sin(PI.toFloat() * position)
            val micro = 0.82f + 0.18f * sin(t * 0.0014f + i * 0.73f)
            val len = minLen + (maxLen - minLen) * shaped * tapered * micro
            val degree = baseStart + arcSweep * position + drift
            val rad = degree * PI.toFloat() / 180f
            val nx = cos(rad)
            val ny = sin(rad)
            val px = cx + nx * orbit
            val py = cy + ny * orbit
            val inner = orbit - len * 0.42f
            val outer = orbit + len * 0.58f
            val quietAlpha = if (isPlaying) 74f else 40f
            val liveAlpha = if (isPlaying) 176f * shaped * tapered * masterBreath else 0f

            waveformPaint.alpha = (alpha * (quietAlpha + liveAlpha)).toInt().coerceIn(0, 236)
            canvas.drawLine(
                cx + nx * inner,
                cy + ny * inner,
                cx + nx * outer,
                cy + ny * outer,
                waveformPaint,
            )

            if (i % 4 == 1 && shaped > 0.08f) {
                waveformPaint.alpha = (alpha * 52f * shaped * tapered).toInt().coerceIn(0, 72)
                canvas.drawPoint(px, py, waveformPaint)
            }
        }
        waveformPaint.shader = null
    }

    // --- Horizon: a soft grounding glow rising from the bottom edge -------------------
    private fun drawHorizon(canvas: Canvas, w: Float, h: Float, alpha: Float) {
        val shader = horizonShader ?: return
        horizonPaint.shader = shader
        val e = bassDisplay.coerceIn(0f, 1f)
        // In artwork (player) mode the bottom breathing IS the hero, so give it more
        // presence than the karaoke variant.
        val artwork = anchorMode == AnchorMode.ARTWORK
        val modeFactor = if (artwork) 1.40f else 1f
        horizonPaint.alpha = (alpha * (22f + 55f * e) * modeFactor).toInt().coerceIn(0, if (artwork) 130 else 90)
        canvas.drawRect(0f, h * 0.45f, w, h, horizonPaint)
    }

    // --- Bloom: spring-driven radial core centered low on screen ----------------------
    private fun drawBloom(canvas: Canvas, alpha: Float) {
        val shader = bloomShader ?: return
        val e = bassDisplay.coerceIn(0f, 1.2f)
        val scale = 0.58f + 0.56f * e
        bloomPaint.shader = shader
        val artwork = anchorMode == AnchorMode.ARTWORK
        val boost = if (artwork) 1.55f else 1f
        bloomPaint.alpha = (alpha * (34f + 90f * e) * boost).toInt().coerceIn(0, if (artwork) 190 else 130)
        canvas.save()
        canvas.scale(scale, scale, cx, cy)
        canvas.drawCircle(cx, cy, bloomBaseR, bloomPaint)
        canvas.restore()
    }

    // --- Mist: a formless low haze whose density gently thickens with the mids --------
    // (Lyrics/karaoke mode only — the deliberately discreet mid layer.)
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

    // --- Aurora (artwork/player mode): one ambient AGSL field for medios + agudos --------
    // Replaces the old diagonal light columns. A single domain-warped noise field paints
    // slow aurora curtains (driven by the mids) woven with a fine treble grain — formless,
    // atmospheric, and confined to the upper canopy so it FRAMES the grave bloom instead of
    // competing with it. Premultiplied additive output. Returns false when AGSL is
    // unavailable so the caller can fall back to the mist + veil.
    private fun drawAurora(canvas: Canvas, w: Float, h: Float, t: Float, alpha: Float, style: Int): Boolean {
        if (!KaraokeAuroraShader.isAvailable) return false
        val mid = midDisplay.coerceIn(0f, 1f)
        val tre = (trebleDisplay * particleIntensity).coerceIn(0f, 1f)
        val shader = KaraokeAuroraShader.get(
            width = w,
            height = h,
            timeSec = t / 1000f,
            mid = mid,
            treble = tre,
            master = alpha,
            topFrac = AURORA_TOP_FRAC,
            focusY = focusYNorm,
            style = style,
            tintR = Color.red(glowColor) / 255f,
            tintG = Color.green(glowColor) / 255f,
            tintB = Color.blue(glowColor) / 255f,
            hotR = Color.red(whiteGlow) / 255f,
            hotG = Color.green(whiteGlow) / 255f,
            hotB = Color.blue(whiteGlow) / 255f,
        ) ?: return false
        auroraPaint.shader = shader
        auroraPaint.alpha = 255 // intensity baked into the uniforms (premultiplied)
        auroraPaint.xfermode = addXfer
        canvas.drawRect(0f, 0f, w, h, auroraPaint)
        auroraPaint.xfermode = null
        return true
    }

    // --- Stage lights (artwork/player mode): diagonal light columns for the mids ---------
    // The mid slice is split into MID_BEAMS sub-bands, each driving its own column anchored
    // at the top edge and rotated to a diagonal. A column ignites, grows long and brightens
    // with ITS sub-band, so a chord lights several at once. Each sways slowly like a
    // moving-head fixture.
    //
    // LIQUID LIGHT: on API 33+ each STRAIGHT column is painted by ONE AGSL fragment shader
    // ([KaraokeBeamShader]) — the same GPU family as the karaoke liquid wipe — giving
    // smoothstep edges and a melting tint↔hot tone blend (no bending). On older devices it
    // falls back to four additive trapezoids (halo → body → hot core → filament).
    // Either way a multi-stop lens bloom sells the source; a shallow exposure drift keeps it alive.
    private fun drawStageLights(
        canvas: Canvas,
        bands: FloatArray,
        w: Float,
        h: Float,
        t: Float,
        dt: Float,
        alpha: Float,
    ) {
        val tintShader = beamShader ?: return
        val hotShader = beamShaderHot ?: return
        val midLo = bandCount * 25 / 100
        val midHi = (bandCount * 62 / 100).coerceAtLeast(midLo + 1)
        val span = midHi - midLo
        // Prefer the AGSL liquid shader (GPU) — same family as the karaoke wipe; the flat
        // trapezoid stack is the API<33 fallback.
        val liquid = KaraokeBeamShader.isAvailable
        val timeSec = t / 1000f
        val tintR = Color.red(glowColor) / 255f
        val tintG = Color.green(glowColor) / 255f
        val tintB = Color.blue(glowColor) / 255f
        val hotR = Color.red(whiteGlow) / 255f
        val hotG = Color.green(whiteGlow) / 255f
        val hotB = Color.blue(whiteGlow) / 255f
        val rectHalf = beamGlowHalf * 1.4f
        beamPaint.xfermode = addXfer
        for (i in 0 until MID_BEAMS) {
            // Each column owns a contiguous chunk of the mid slice.
            val from = midLo + span * i / MID_BEAMS
            val to = (midLo + span * (i + 1) / MID_BEAMS).coerceAtLeast(from + 1)
            val target = bandAverage(bands, from, to)
            midBeamDisplay[i] = ease(midBeamDisplay[i], target, dt, attack = 0.06f, release = 0.010f)
            val raw = midBeamDisplay[i].coerceIn(0f, 1f)
            // Perceptual curve: light VOLUME swelling, not a meter tracking the FFT 1:1.
            val level = Math.pow(raw.toDouble(), 0.62).toFloat()

            // Origin spread evenly across the top edge.
            val ox = w * ((i + 0.5f) / MID_BEAMS)
            val pulse = 0.5f + 0.5f * sin(t * 0.0007f + i * 2f)
            // Slow moving-head sway. Hand-placed-feeling tilt: alternate side but vary the
            // magnitude per fixture so the rig never reads as a mechanical mirror.
            val sway = 3.8f * sin(t * 0.00035f + i * 1.3f)
            val baseTilt = (if (i % 2 == 0) 1f else -1f) * (12f + 7f * (0.5f + 0.5f * sin(i * 2.4f)))
            val angleDeg = baseTilt + sway
            val lengthScale = 0.66f + 1.42f * level + 0.06f * pulse * level
            val widthScale = 0.78f + 0.30f * level
            // Slow exposure drift, not a nightclub flicker.
            val flicker = 0.97f + 0.03f * sin(t * 0.004f + i * 5.3f)
            val a = alpha * (6f + 72f * level) * flicker

            canvas.save()
            canvas.translate(ox, 0f)
            canvas.rotate(angleDeg)
            canvas.scale(widthScale, lengthScale)
            if (liquid) {
                // One AGSL pass paints the whole STRAIGHT column as liquid light: smoothstep
                // edges and a melting tint↔hot tone blend (no bending). Premultiplied output,
                // so paint.alpha stays 255 (intensity is baked into the uniforms).
                val master = (flicker * 0.68f).coerceIn(0f, 1f)
                val shader = KaraokeBeamShader.get(
                    beamLen = beamBaseLen,
                    apexHalf = beamApexHalf,
                    baseHalf = beamGlowHalf,
                    level = level,
                    master = master,
                    timeSec = timeSec,
                    seed = i * 0.37f,
                    tintR = tintR, tintG = tintG, tintB = tintB,
                    hotR = hotR, hotG = hotG, hotB = hotB,
                )
                if (shader != null) {
                    beamPaint.shader = shader
                    beamPaint.alpha = 255
                    canvas.drawRect(-rectHalf, 0f, rectHalf, beamBaseLen, beamPaint)
                }
            } else {
                // Four additive passes sum to a soft, feathered cross-section (no blur):
                // wide faint halo → tinted body → near-white core → crisp hot filament.
                beamPaint.shader = tintShader
                beamPaint.alpha = (a * 0.30f).toInt().coerceIn(0, 70)
                canvas.drawPath(beamHalo, beamPaint)
                beamPaint.alpha = (a * 0.58f).toInt().coerceIn(0, 120)
                canvas.drawPath(beamBody, beamPaint)
                beamPaint.shader = hotShader
                beamPaint.alpha = a.toInt().coerceIn(0, 165)
                canvas.drawPath(beamCore, beamPaint)
                beamPaint.alpha = (a * 0.7f).toInt().coerceIn(0, 150)
                canvas.drawPath(beamFilament, beamPaint)
            }
            canvas.restore()

            // Fixture pool: the soft round hotspot where the column is born sells the source.
            if (level > 0.04f) {
                canvas.save()
                canvas.translate(ox, 0f)
                val pr = 0.55f + 0.9f * level
                canvas.scale(pr, pr)
                fixturePaint.xfermode = addXfer
                fixturePaint.shader = fixtureShader
                fixturePaint.alpha = (alpha * 74f * level).toInt().coerceIn(0, 82)
                canvas.drawCircle(0f, 0f, fixtureBaseR, fixturePaint)
                canvas.restore()
            }

        }
        beamPaint.xfermode = null
        fixturePaint.xfermode = null
    }

    // --- Treble: a whisper-faint airy veil along the very top --------------------------
    // Deliberately subtle: NO onset flashes and NO bright drifting glints (those read too
    // busy). Just a barely-there band of light that gently breathes with the treble level,
    // so the agudos add a hint of "air" above the reading band without ever drawing the eye.
    private fun drawShimmerVeil(canvas: Canvas, w: Float, h: Float, t: Float, alpha: Float) {
        val shader = veilShader ?: return
        val tre = trebleDisplay.coerceIn(0f, 1f)
        val energy = tre * particleIntensity
        if (energy < 0.02f) return

        // Slow, soft waver so it never reads as a static bar — but kept very low alpha.
        val wave = 0.6f + 0.4f * sin(t * 0.0022f)
        veilPaint.shader = shader
        veilPaint.alpha = (alpha * (3f + 44f * energy) * wave).toInt().coerceIn(0, 46)
        canvas.drawRect(0f, 0f, w, h * 0.20f, veilPaint)
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

    private fun rebuildIfNeeded(width: Int, height: Int) {
        if (cachedW == width && cachedH == height && cachedColor == glowColor) return
        cachedW = width
        cachedH = height
        cachedColor = glowColor

        val w = width.toFloat()
        val h = height.toFloat()
        cx = w * 0.5f
        cy = h * focusYNorm
        bloomBaseR = if (anchorMode == AnchorMode.ARTWORK) {
            hypot(w, h) * 0.42f
        } else {
            hypot(w, h) * 0.42f
        }

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
            0f, h * 0.45f, 0f, h,
            intArrayOf(Color.argb(0, r, g, b), Color.argb(200, r, g, b)),
            floatArrayOf(0f, 1f),
            Shader.TileMode.CLAMP,
        )

        // A soft floating haze band (lyrics mode mids).
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

        val arcTint = luminousTint(glowColor, lift = 0.46f, satBoost = 0.1f)
        val arcHot = luminousTint(glowColor, lift = 0.72f, satBoost = 0.14f)
        waveformShader = SweepGradient(
            cx,
            cy,
            intArrayOf(
                Color.argb(0, r, g, b),
                Color.argb(215, Color.red(arcTint), Color.green(arcTint), Color.blue(arcTint)),
                Color.argb(255, Color.red(arcHot), Color.green(arcHot), Color.blue(arcHot)),
                Color.argb(210, r, g, b),
                Color.argb(0, r, g, b),
                Color.argb(0, r, g, b),
            ),
            floatArrayOf(0f, 0.05f, 0.22f, 0.41f, 0.50f, 1f),
        )

        // Stage-light column geometry, built in local space with the fixture at the origin
        // (0,0) and the column running straight down +Y. Per frame it gets translated to the
        // top edge, rotated to its diagonal and scaled (length + width) into the cone.
        val wr = Color.red(whiteGlow)
        val wg = Color.green(whiteGlow)
        val wb = Color.blue(whiteGlow)

        beamBaseLen = h * 0.72f
        val apexHalf = w * 0.006f             // narrow at the fixture (top edge)
        // Three nested base widths → the additive stack feathers from a hot center out.
        val coreBaseHalf = w * 0.032f         // tight hot core
        val bodyBaseHalf = w * 0.068f         // tinted body
        val haloBaseHalf = w * 0.13f          // wide, faint outer feather
        fun cone(path: Path, apex: Float, base: Float) {
            path.reset()
            path.moveTo(-apex, 0f)
            path.lineTo(apex, 0f)
            path.lineTo(base, beamBaseLen)
            path.lineTo(-base, beamBaseLen)
            path.close()
        }
        cone(beamCore, apexHalf, coreBaseHalf)
        cone(beamBody, apexHalf * 1.2f, bodyBaseHalf)
        cone(beamHalo, apexHalf * 1.5f, haloBaseHalf)
        // The crisp inner filament — a tight spine for internal structure.
        cone(beamFilament, apexHalf * 0.6f, coreBaseHalf * 0.4f)
        // Local widths the AGSL liquid shader samples (a generous glow spread).
        beamApexHalf = apexHalf
        beamGlowHalf = haloBaseHalf

        // Length gradient with COLOR DEPTH (kills the flat look): a luminous-tinted mouth at
        // the fixture → pure tint through the body → fading to nothing at the far tip.
        val hot = luminousTint(glowColor, lift = 0.4f, satBoost = 0.1f)
        val hr = Color.red(hot); val hg = Color.green(hot); val hb = Color.blue(hot)
        beamShader = LinearGradient(
            0f, 0f, 0f, beamBaseLen,
            intArrayOf(
                Color.argb(190, hr, hg, hb),
                Color.argb(150, r, g, b),
                Color.argb(60, r, g, b),
                Color.argb(0, r, g, b),
            ),
            floatArrayOf(0f, 0.18f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )
        // Hot core runs near-white and burns out a touch sooner → the "ignite" highlight.
        beamShaderHot = LinearGradient(
            0f, 0f, 0f, beamBaseLen,
            intArrayOf(
                Color.argb(215, wr, wg, wb),
                Color.argb(120, wr, wg, wb),
                Color.argb(0, wr, wg, wb),
            ),
            floatArrayOf(0f, 0.32f, 1f),
            Shader.TileMode.CLAMP,
        )
        // Fixture lens: a richer multi-stop bloom — white-hot pinpoint → tint glow → air.
        fixtureBaseR = w * 0.075f
        fixtureShader = RadialGradient(
            0f, 0f, fixtureBaseR,
            intArrayOf(
                Color.argb(240, wr, wg, wb),
                Color.argb(150, wr, wg, wb),
                Color.argb(55, r, g, b),
                Color.argb(0, r, g, b),
            ),
            floatArrayOf(0f, 0.25f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )
        veilShader = LinearGradient(
            0f, 0f, 0f, h * 0.20f,
            intArrayOf(Color.argb(150, wr, wg, wb), Color.argb(0, wr, wg, wb)),
            floatArrayOf(0f, 1f),
            Shader.TileMode.CLAMP,
        )
    }

    companion object {
        // Fraction of the screen height the aurora field occupies, from the top edge down.
        // It fades to nothing well before the low grave bloom so the bass stays the hero.
        private const val AURORA_TOP_FRAC = 0.68f

        // Number of diagonal light columns across the mid slice (artwork mode).
        private const val MID_BEAMS = 5
        private const val WAVEFORM_BARS = 34

        // Bass spring tuning (per-ms). Stiffer + a touch more damping so the breath
        // punches ON the beat while still keeping some inertia.
        private const val BASS_STIFFNESS = 0.00048f
        private const val BASS_DAMPING = 0.016f
    }
}
