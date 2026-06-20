package expo.modules.karaokeview

import android.content.Context
import android.graphics.*
import android.os.Build
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.karaokeview.motionprofiles.AmbientProfileRenderer
import expo.modules.karaokeview.motionprofiles.CosmicProfileRenderer
import expo.modules.karaokeview.motionprofiles.FireProfileRenderer
import expo.modules.karaokeview.motionprofiles.PulseProfileRenderer
import expo.modules.karaokeview.motionprofiles.VelvetProfileRenderer

/**
 * KaraokeView - Apple Music-style 120fps lyrics renderer
 *
 * Architecture:
 * - GLOBAL LINE SWEEP: One continuous mask per line (not per word)
 * - LEADING GLOW: Soft aura runs slightly ahead of the sweep
 * - TOUCH-TO-SEEK: Tap any line to jump to that point in the song
 * - MANUAL SCROLL: Drag to browse lyrics, auto-scroll resumes after 3s
 * - 120FPS: Choreographer-synced animator for butter-smooth rendering
 */
class KaraokeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private companion object {
        private const val MONOCHROME_FONT_ASSET = "fonts/SFPRODISPLAYMEDIUM.ttf"
        private const val MONOCHROME_FONT_WEIGHT = 600
        private const val MONOCHROME_FONT_SIZE_MIN_DP = 28f
        private const val MONOCHROME_FONT_SIZE_MAX_DP = 37.6f
        private const val MONOCHROME_FONT_SIZE_VW = 0.07f
        private const val MONOCHROME_LINE_HEIGHT = 1.2f
        private const val MONOCHROME_PADDING_LINE_DP = 6f
        private const val MONOCHROME_LETTER_SPACING_EM = -0.04f
        private const val MONOCHROME_SUBTEXT_SCALE = 0.6f
        private const val MAX_SPECTRAL_PARTICLES = 128
        private const val MAX_RETAINED_PROFILE_ACCENTS = 128
        private const val SPECTRUM_BANDS = 28
    }

    private val lyricsParser = LyricsParser()
    private val lyricsLayoutEngine = LyricsLayoutEngine()
    private val touchController = KaraokeTouchController(resources.displayMetrics.density)
    private val introRenderer = KaraokeIntroRenderer(resources.displayMetrics.density)
    private val lineRenderer = KaraokeLineRenderer()
    private val lineRenderCallbacks = object : KaraokeLineRenderCallbacks {
        override fun smootherStep(value: Float): Float = this@KaraokeView.smootherStep(value)

        override fun drawWord(canvas: Canvas, line: LyricLine, word: LyricWord, paint: Paint) {
            this@KaraokeView.drawWord(canvas, line, word, paint)
        }

        override fun drawWordTail(
            canvas: Canvas,
            line: LyricLine,
            word: LyricWord,
            paint: Paint,
            revealX: Float,
            rowHeight: Float,
            fadeWidth: Float,
            translateY: Float,
        ) {
            this@KaraokeView.drawWordTail(canvas, line, word, paint, revealX, rowHeight, fadeWidth, translateY)
        }

        override fun drawWordTranslated(
            canvas: Canvas,
            line: LyricLine,
            word: LyricWord,
            paint: Paint,
            translateY: Float,
        ) {
            this@KaraokeView.drawWordTranslated(canvas, line, word, paint, translateY)
        }

        override fun drawCompletedWordWithLift(
            canvas: Canvas,
            line: LyricLine,
            word: LyricWord,
            paint: Paint,
            rowHeight: Float,
            finalLiftRatio: Float,
            currentTimeMs: Long,
            keepCharacterLift: Boolean,
            visualWordDurationMs: Float,
            visualWordStartMs: Long,
        ) {
            this@KaraokeView.drawCompletedWordWithLift(
                canvas = canvas,
                line = line,
                word = word,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                currentTimeMs = currentTimeMs,
                keepCharacterLift = keepCharacterLift,
                visualWordDurationMs = visualWordDurationMs,
                visualWordStartMs = visualWordStartMs,
            )
        }

        override fun drawGrowableVisualWordWipeHighlight(
            canvas: Canvas,
            line: LyricLine,
            words: List<LyricWord>,
            progress: Float,
            sweepX: Float,
            paint: Paint,
            rowHeight: Float,
            finalLiftRatio: Float,
            currentTimeMs: Long,
        ) {
            this@KaraokeView.drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = words,
                progress = progress,
                sweepX = sweepX,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                currentTimeMs = currentTimeMs,
            )
        }

        override fun drawWordWipeHighlight(
            canvas: Canvas,
            line: LyricLine,
            word: LyricWord,
            progress: Float,
            paint: Paint,
            rowHeight: Float,
            finalLiftRatio: Float,
            useCharacterLift: Boolean,
            currentTimeMs: Long,
            visualWordDurationMs: Float,
            visualWordStartMs: Long,
        ) {
            this@KaraokeView.drawWordWipeHighlight(
                canvas = canvas,
                line = line,
                word = word,
                progress = progress,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                useCharacterLift = useCharacterLift,
                currentTimeMs = currentTimeMs,
                visualWordDurationMs = visualWordDurationMs,
                visualWordStartMs = visualWordStartMs,
            )
        }

        override fun drawWordPreHighlight(
            canvas: Canvas,
            line: LyricLine,
            word: LyricWord,
            progress: Float,
            paint: Paint,
            rowHeight: Float,
        ) {
            this@KaraokeView.drawWordPreHighlight(
                canvas = canvas,
                line = line,
                word = word,
                progress = progress,
                paint = paint,
                rowHeight = rowHeight,
            )
        }

        override fun drawMotionAccent(
            canvas: Canvas,
            line: LyricLine,
            words: List<LyricWord>,
            currentTimeMs: Long,
            rowHeight: Float,
            translateY: Float,
        ) {
            profileRenderer.drawContinuous(
                KaraokeContinuousContext(
                    canvas = canvas,
                    line = line,
                    words = words,
                    currentTimeMs = currentTimeMs,
                    rowHeight = rowHeight,
                    translateY = translateY,
                    glowColor = glowColor,
                    density = density,
                    marginLeft = marginLeft,
                    sparklePaint = sparklePaint,
                    fireTrailFadeOutDurationMs = fireTrailFadeOutDurationMs,
                    calculateContinuousSweepX = ::calculateContinuousSweepX,
                    smootherStep = ::smootherStep,
                )
            )
        }

        override fun drawRowSweepHighlight(
            canvas: Canvas,
            line: LyricLine,
            rowWords: List<LyricWord>,
            sweepX: Float,
            paint: Paint,
            rowHeight: Float,
            finalLiftRatio: Float,
            currentTimeMs: Long,
            isRowComplete: Boolean,
        ) {
            this@KaraokeView.drawRowSweepHighlight(
                canvas = canvas,
                line = line,
                rowWords = rowWords,
                sweepX = sweepX,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                currentTimeMs = currentTimeMs,
                isRowComplete = isRowComplete,
            )
        }
    }

    // --- Layout ---
    private var lineHeight = 0f
    private var fontSize = 0f
    private var marginLeft = 40f
    private var marginRight = 64f
    private var fadeHeight = 160f
    private var lineSpacing = 0f
    private var spaceWidth = 0f
    private var backgroundFontSize = 0f
    private var backgroundLineHeight = 0f
    private var backgroundSpaceWidth = 0f
    private var backgroundGap = 0f
    private var density = 1f

    // --- Colors ---
    private var activeColor: Int = Color.WHITE
    private var inactiveColor: Int = Color.parseColor("#4DFFFFFF")
    private var glowColor: Int = Color.WHITE
    private var backgroundColor: Int = Color.BLACK
    private var introTitle: String = ""
    private var introSubtitle: String = ""

    // --- Ambient background ---
    // Enabled by default; React can still disable it for lite mode.
    private var enableAmbientBackground = true
    private val ambientBackgroundRenderer = KaraokeAmbientBackgroundRenderer(resources.displayMetrics.density)
    private var firstLineStartMs: Long = 0L

    // --- Bottom spectrum ("aurora ridge") ---
    // Reacts to the live audio spectrum (FFT) of the playing track. Disabled until
    // both a valid ExoPlayer audio session id and the enable flag arrive from JS.
    private val spectrumCapture = KaraokeSpectrumCapture(SPECTRUM_BANDS)
    private val spectrumRenderer = KaraokeSpectrumRenderer(resources.displayMetrics.density, SPECTRUM_BANDS)
    private var audioSessionId: Int = 0
    private var enableBottomSpectrum = false

    // --- Paints ---
    private val monochromeTypeface: Typeface by lazy { createMonochromeTypeface() }
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = monochromeTypeface
        textAlign = Paint.Align.LEFT
        letterSpacing = MONOCHROME_LETTER_SPACING_EM
    }
    private val highlightPaint = Paint(basePaint)
    private val backgroundBasePaint = Paint(basePaint)
    private val backgroundHighlightPaint = Paint(basePaint)
    private val fadePaint = Paint().apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    }
    private val sweepMaskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    }
    private val sparklePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val particlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private var fadeShaderTop: Shader? = null
    private var fadeShaderBottom: Shader? = null
    // Edge fades ("blur") melt away while the user is browsing the lyrics and ease back
    // in once auto-scroll resumes. 1f = full fade, 0f = no fade (edges fully visible).
    private var edgeFadeStrength = 1f
    private var builtFadeStrength = -1f

    // --- Data ---
    private var lines: List<LyricLine> = emptyList()
    private var lookupTable: LyricsLookupTable? = null
    private var lyricsSignature: String = ""
    private var outgoingLines: List<LyricLine>? = null
    private var outgoingLookupTable: LyricsLookupTable? = null
    private var outgoingScrollY: Float = 0f
    private var lyricsTransitionStartNanos: Long = 0L
    private val lyricsTransitionDurationNanos = 420_000_000L

    // --- Time interpolation ---
    // A continuously-advancing render clock. Instead of hard-resetting to each JS time
    // update (which makes the sweep jump by the full error every update — very visible
    // when JS delivers updates late/unevenly, e.g. heavy animated themes), the clock
    // runs off nanoTime and gently ABSORBS the small drift between its prediction and
    // the authoritative JS time. Real discontinuities (seeks) still snap immediately.
    private var renderBaseTimeMs: Double = 0.0
    private var renderBaseNanos: Long = System.nanoTime()
    private var hasTimeBase: Boolean = false
    private var isPlaying: Boolean = false

    private val seekBackThresholdMs = 300.0   // backward jump beyond this = real seek → snap
    private val seekFwdThresholdMs = 400.0     // forward jump beyond this = real seek → snap
    private val timeCorrectionFactor = 0.2     // fraction of drift absorbed per update

    // --- Scrolling ---
    private val scrollDampingDefault = 0.08f
    private val scrollDampingLineByLine = 0.16f

    // --- Animator ---
    private var animator: LyricsAnimator? = null
    private var lastEmittedLineIndex = -1

    // --- Event dispatchers (Expo Modules pattern) ---
    private val onSeek by EventDispatcher<Map<String, Any>>()

    // --- Feather width for liquid effect ---
    private val FEATHER_PX: Float
    private val LEADING_GLOW_WIDTH_PX: Float
    private val scrollAnchorRatio = 0.38f
    private val hierarchyTransitionWindowMs = 700f
    private val backgroundRevealDurationMs = 450f
    private val backgroundFadeOutDurationMs = 420f
    private val fireTrailFadeOutDurationMs = 520f
    private val completedLiftShadowRadiusRatio = 0.034f
    private val completedLiftShadowAlphaFactor = 0.09f
    private val completedLiftShadowAlphaCap = 48
    private val completedLiftShadowYOffsetRatio = -0.018f

    init {
        density = resources.displayMetrics.density
        marginLeft = 42f * density
        marginRight = 42f * density
        fadeHeight = 180f * density
        FEATHER_PX = 22f * density // Wider feather for organic liquid fill
        LEADING_GLOW_WIDTH_PX = 24f * density

        basePaint.color = inactiveColor
        highlightPaint.color = activeColor
        backgroundBasePaint.color = inactiveColor
        backgroundHighlightPaint.color = activeColor
        applyMonochromeTypography()
        applyReadablePalette()

        setBackgroundColor(Color.TRANSPARENT)
        setLayerType(LAYER_TYPE_HARDWARE, null)
        isClickable = true
        isFocusable = true
        isFocusableInTouchMode = true
    }

    // --- Public setters (called from JS via props) ---

    // --- Settings ---
    private var isLineByLine = false
    private var enableSpectralParticles = true
    private var displayMode = "none"
    private var motionProfile = MotionProfile.COSMIC
    private var profileRenderer: MotionProfileRenderer = CosmicProfileRenderer()
    private val suspendedParticles = Array(MAX_SPECTRAL_PARTICLES) { SuspendedParticle() }
    private val particleEmissionBuckets = mutableMapOf<Long, Long>()
    private val retainedProfileAccents = Array(MAX_RETAINED_PROFILE_ACCENTS) { RetainedProfileAccent() }
    private val retainedAccentEmissionBuckets = mutableMapOf<Long, Long>()
    private val particleSystem = KaraokeParticleSystem(suspendedParticles, particleEmissionBuckets)
    private val retainedAccents = KaraokeRetainedAccents(retainedProfileAccents, retainedAccentEmissionBuckets)

    fun setIsLineByLine(isLineByLine: Boolean) {
        this.isLineByLine = isLineByLine
        invalidate()
    }

    fun setDisplayMode(mode: String?) {
        val newMode = mode?.trim()?.lowercase() ?: "none"
        if (displayMode == newMode) return
        displayMode = newMode
        precomputePositions()
        invalidate()
    }

    fun setEnableSpectralParticles(enabled: Boolean) {
        enableSpectralParticles = enabled
        if (!enabled) {
            clearSpectralParticles()
        }
        invalidate()
    }

    fun setMotionProfile(profileName: String?) {
        val resolved = MotionProfile.from(profileName)
        if (resolved == motionProfile) return
        motionProfile = resolved
        profileRenderer = when (resolved) {
            MotionProfile.FIRE -> FireProfileRenderer()
            MotionProfile.VELVET -> VelvetProfileRenderer()
            MotionProfile.PULSE -> PulseProfileRenderer()
            MotionProfile.AMBIENT -> AmbientProfileRenderer()
            MotionProfile.COSMIC -> CosmicProfileRenderer()
        }
        clearSpectralParticles()
        invalidate()
    }

    private fun getScrollDamping(): Float {
        return if (isLineByLine) scrollDampingLineByLine else scrollDampingDefault
    }

    fun setFontSize(_size: Float) {
        applyMonochromeTypography()
        precomputePositions()
        invalidate()
    }

    private fun createMonochromeTypeface(): Typeface {
        return try {
            val assetTypeface = Typeface.createFromAsset(context.assets, MONOCHROME_FONT_ASSET)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Typeface.create(assetTypeface, MONOCHROME_FONT_WEIGHT, false)
            } else {
                assetTypeface
            }
        } catch (_: Throwable) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Typeface.create(Typeface.create("sans-serif", Typeface.NORMAL), MONOCHROME_FONT_WEIGHT, false)
            } else {
                Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }
        }
    }

    private fun resolveMonochromeFontSizePx(viewWidthPx: Int = width): Float {
        val widthDp = if (viewWidthPx > 0 && density > 0f) {
            viewWidthPx / density
        } else {
            360f
        }
        return (widthDp * MONOCHROME_FONT_SIZE_VW)
            .coerceIn(MONOCHROME_FONT_SIZE_MIN_DP, MONOCHROME_FONT_SIZE_MAX_DP) * density
    }

    private fun applyMonochromeTypography(viewWidthPx: Int = width) {
        fontSize = resolveMonochromeFontSizePx(viewWidthPx)
        lineHeight = fontSize * MONOCHROME_LINE_HEIGHT
        lineSpacing = MONOCHROME_PADDING_LINE_DP * density
        backgroundFontSize = fontSize * MONOCHROME_SUBTEXT_SCALE
        backgroundLineHeight = backgroundFontSize * 1.15f
        backgroundGap = fontSize * 0.3f

        listOf(basePaint, highlightPaint).forEach { paint ->
            paint.typeface = monochromeTypeface
            paint.textSize = fontSize
            paint.letterSpacing = MONOCHROME_LETTER_SPACING_EM
        }
        listOf(backgroundBasePaint, backgroundHighlightPaint).forEach { paint ->
            paint.typeface = monochromeTypeface
            paint.textSize = backgroundFontSize
            paint.letterSpacing = MONOCHROME_LETTER_SPACING_EM
        }

        spaceWidth = basePaint.measureText(" ")
        backgroundSpaceWidth = backgroundBasePaint.measureText(" ")
    }

    fun setActiveColor(color: Int) {
        activeColor = color
        applyReadablePalette()
        invalidate()
    }

    fun setInactiveColor(color: Int) {
        inactiveColor = color
        applyReadablePalette()
        invalidate()
    }

    fun setGlowColor(color: Int) {
        glowColor = color
        applyReadablePalette()
        invalidate()
    }

    fun setPlayerBackgroundColor(color: Int) {
        backgroundColor = color
        applyReadablePalette()
        invalidate()
    }

    fun setEnableAmbientBackground(enabled: Boolean) {
        enableAmbientBackground = enabled
        invalidate()
    }

    fun setAudioSessionId(sessionId: Int) {
        if (sessionId == audioSessionId) return
        audioSessionId = sessionId
        updateSpectrumCaptureState()
    }

    fun setEnableBottomSpectrum(enabled: Boolean) {
        if (enabled == enableBottomSpectrum) return
        enableBottomSpectrum = enabled
        updateSpectrumCaptureState()
        invalidate()
    }

    private fun updateSpectrumCaptureState() {
        if (enableBottomSpectrum) {
            // Prefer an explicit session id from JS; otherwise read the ExoPlayer
            // session id that the track-player MusicService persisted to prefs so we
            // capture the player's OWN session (no RECORD_AUDIO prompt). Falling back
            // to 0 would capture the global output mix (requires the mic permission).
            val resolved = if (audioSessionId > 0) audioSessionId else readExoAudioSessionId()
            spectrumCapture.attach(resolved.coerceAtLeast(0))
            if (isPlaying) spectrumCapture.start() else spectrumCapture.stop()
        } else {
            spectrumCapture.release()
        }
    }

    private fun readExoAudioSessionId(): Int {
        return try {
            context.getSharedPreferences("staysound_audio", Context.MODE_PRIVATE)
                .getInt("exo_audio_session_id", 0)
        } catch (_: Throwable) {
            0
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyMonochromeTypography(w)
        buildFadeShaders(edgeFadeStrength)
        precomputePositions()
    }

    /**
     * Multi-stop DST_IN mask gradient for a premium cinematic edge fade.
     *
     * [strength] scales how much the top/bottom edges are eaten away:
     *  - 1f → full fade (top/bottom fully transparent, the default cinematic look).
     *  - 0f → no fade at all (the gradient becomes solid black, so DST_IN keeps every
     *         pixel and the lyrics are fully visible to the screen edges).
     * Interpolating the per-stop alpha lets the fade dissolve smoothly while scrolling.
     */
    private fun buildFadeShaders(strength: Float) {
        val s = strength.coerceIn(0f, 1f)
        val inv = 1f - s
        // Edge stop: TRANSPARENT at full strength → BLACK as the fade dissolves.
        val edgeAlpha = (255f * inv).toInt().coerceIn(0, 255)
        // Mid stop: argb(80) at full strength → BLACK as the fade dissolves.
        val midAlpha = (80f + (255f - 80f) * inv).toInt().coerceIn(0, 255)
        fadeShaderTop = LinearGradient(
            0f, 0f, 0f, fadeHeight,
            intArrayOf(Color.argb(edgeAlpha, 0, 0, 0), Color.argb(midAlpha, 0, 0, 0), Color.BLACK),
            floatArrayOf(0f, 0.45f, 1f),
            Shader.TileMode.CLAMP,
        )
        fadeShaderBottom = LinearGradient(
            0f, 0f, 0f, fadeHeight,
            intArrayOf(Color.BLACK, Color.argb(midAlpha, 0, 0, 0), Color.argb(edgeAlpha, 0, 0, 0)),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )
        builtFadeStrength = s
    }

    fun setLyrics(lyricsData: List<Map<String, Any>>) {
        val parsedLines = lyricsParser.parse(lyricsData)
        val retimedLines = LyricsRetimer.retime(parsedLines)
        val nextLines = LyricsGapGenerator.generateGaps(retimedLines)
        val nextSignature = buildLyricsSignature(nextLines)
        val shouldTransitionLyrics =
            lines.isNotEmpty() &&
                nextLines.isNotEmpty() &&
                nextSignature.isNotEmpty() &&
                nextSignature != lyricsSignature &&
                width > 0 &&
                height > 0

        if (shouldTransitionLyrics) {
            outgoingLines = lines
            outgoingLookupTable = lookupTable
            outgoingScrollY = touchController.scrollY
            lyricsTransitionStartNanos = System.nanoTime()
        } else if (nextSignature != lyricsSignature) {
            outgoingLines = null
            outgoingLookupTable = null
            lyricsTransitionStartNanos = 0L
        }

        lines = nextLines
        lyricsSignature = nextSignature
        firstLineStartMs = lines.firstOrNull()?.startMs ?: 0L
        lookupTable = if (lines.isNotEmpty()) LyricsLookupTable(lines) else null
        lastEmittedLineIndex = -1
        clearSpectralParticles()
        precomputePositions()
        startAnimator()
        invalidate()
    }

    fun updateTime(timeMs: Long) {
        val now = System.nanoTime()
        if (!hasTimeBase || !isPlaying) {
            // First sample, or paused → authoritative time is exact; anchor directly.
            renderBaseTimeMs = timeMs.toDouble()
            renderBaseNanos = now
            hasTimeBase = true
            return
        }

        val predicted = renderBaseTimeMs + (now - renderBaseNanos) / 1_000_000.0
        val error = timeMs - predicted
        renderBaseTimeMs = if (error < -seekBackThresholdMs || error > seekFwdThresholdMs) {
            timeMs.toDouble() // seek / large discontinuity → snap
        } else {
            predicted + error * timeCorrectionFactor // absorb small drift smoothly
        }
        renderBaseNanos = now
    }

    fun setIsPlaying(isPlaying: Boolean) {
        if (isPlaying != this.isPlaying && hasTimeBase) {
            if (isPlaying) {
                // Resuming: re-anchor so wall-clock time spent paused isn't counted.
                renderBaseNanos = System.nanoTime()
            } else {
                // Pausing: freeze the clock at the current interpolated value.
                renderBaseTimeMs = liveTimeMs()
                renderBaseNanos = System.nanoTime()
            }
        }
        this.isPlaying = isPlaying
        updateSpectrumCaptureState()
    }

    fun setSeekOnTapEnabled(enabled: Boolean) {
        touchController.setSeekOnTapEnabled(enabled)
    }

    fun setIntroTitle(value: String?) {
        introTitle = value?.trim().orEmpty()
        invalidate()
    }

    fun setIntroSubtitle(value: String?) {
        introSubtitle = value?.trim().orEmpty()
        invalidate()
    }

    private fun liveTimeMs(): Double {
        if (!hasTimeBase) return 0.0
        if (!isPlaying) return renderBaseTimeMs
        return renderBaseTimeMs + (System.nanoTime() - renderBaseNanos) / 1_000_000.0
    }

    private fun getInterpolatedTime(): Long = liveTimeMs().toLong()

    private fun startAnimator() {
        animator?.stop()
        animator = LyricsAnimator {
            touchController.onFrame(System.nanoTime())
            val diff = touchController.targetScrollY - touchController.scrollY
            val damping = getScrollDamping()
            if (Math.abs(diff) > 0.01f) {
                touchController.scrollY += diff * damping
            } else {
                touchController.scrollY = touchController.targetScrollY
            }

            // Dissolve the edge fades while browsing, ease them back when auto-scroll resumes.
            val fadeTarget = if (touchController.isManualScrolling) 0f else 1f
            if (edgeFadeStrength != fadeTarget) {
                edgeFadeStrength += (fadeTarget - edgeFadeStrength) * 0.12f
                if (Math.abs(edgeFadeStrength - fadeTarget) < 0.004f) edgeFadeStrength = fadeTarget
            }

            invalidate()
        }.also { it.start() }
    }

    // ========================================================================
    // TOUCH HANDLING: Tap-to-seek + Manual scroll
    // ========================================================================

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        touchController.dispatchTouchEvent(event, parent)
        return onTouchEvent(event) || super.dispatchTouchEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val handled = touchController.onTouchEvent(
            event = event,
            parent = parent,
            lines = lines,
            layout = KaraokeTouchLayout(
                marginLeft = marginLeft,
                lineHeight = lineHeight,
                backgroundLineHeight = backgroundLineHeight,
                density = density,
            ),
            invalidate = ::invalidate,
            onSeek = { timeMs -> onSeek(mapOf("timeMs" to timeMs)) },
        )
        return handled || super.onTouchEvent(event)
    }

    // ========================================================================
    // DRAWING
    // ========================================================================

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (lines.isEmpty() && outgoingLines.isNullOrEmpty()) return

        val currentTimeMs = getInterpolatedTime()
        val activeLineIndex = lookupTable?.getLineIndexAt(currentTimeMs) ?: -1
        val transitionProgress = getLyricsTransitionProgress()

        // Update auto-scroll target (only if not manually scrolling)
        if (!touchController.isManualScrolling) {
            if (activeLineIndex >= 0 && activeLineIndex < lines.size) {
                val activeLine = lines[activeLineIndex]
                touchController.targetScrollY = -(activeLine.y + activeLine.focusCenterYOffset) + height * scrollAnchorRatio
                emitLineChangeIfNeeded(activeLineIndex)
            }
        }

        // Background radial animation intentionally disabled.

        // Main drawing layer (for edge fades)
        val saveCount = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)

        val oldLines = outgoingLines
        if (oldLines != null && transitionProgress < 1f) {
            val oldActiveLineIndex = outgoingLookupTable?.getLineIndexAt(currentTimeMs) ?: -1
            drawLyricsLayer(
                canvas = canvas,
                layerLines = oldLines,
                activeLineIndex = oldActiveLineIndex,
                currentTimeMs = currentTimeMs,
                layerScrollY = outgoingScrollY - 10f * density * transitionProgress,
                alpha = ((1f - transitionProgress) * 255f).toInt().coerceIn(0, 255),
                includeAccents = false,
            )
            drawLyricsLayer(
                canvas = canvas,
                layerLines = lines,
                activeLineIndex = activeLineIndex,
                currentTimeMs = currentTimeMs,
                layerScrollY = touchController.scrollY + 14f * density * (1f - transitionProgress),
                alpha = (transitionProgress * 255f).toInt().coerceIn(0, 255),
                includeAccents = true,
            )
        } else {
            outgoingLines = null
            outgoingLookupTable = null
            drawLyricsLayer(
                canvas = canvas,
                layerLines = lines,
                activeLineIndex = activeLineIndex,
                currentTimeMs = currentTimeMs,
                layerScrollY = touchController.scrollY,
                alpha = 255,
                includeAccents = true,
            )
        }

        introRenderer.draw(
            canvas = canvas,
            currentTimeMs = currentTimeMs,
            state = KaraokeIntroState(
                title = introTitle,
                subtitle = introSubtitle,
                firstLineStartMs = firstLineStartMs,
                activeColor = activeColor,
            ),
            layout = KaraokeIntroLayout(
                width = width,
                height = height,
                density = density,
            ),
        )
        drawFades(canvas)
        canvas.restoreToCount(saveCount)

        // Bottom spectrum is drawn on the raw view canvas (outside the lyrics fade
        // layer) so the live audio "aurora ridge" sits cleanly along the bottom edge.
        if (enableBottomSpectrum) {
            spectrumRenderer.draw(
                canvas = canvas,
                bands = spectrumCapture.snapshot(),
                width = width,
                height = height,
                currentTimeMs = currentTimeMs,
                isPlaying = isPlaying,
                alphaScale = 1f,
            )
        }
    }

    private fun drawLyricsLayer(
        canvas: Canvas,
        layerLines: List<LyricLine>,
        activeLineIndex: Int,
        currentTimeMs: Long,
        layerScrollY: Float,
        alpha: Int,
        includeAccents: Boolean,
    ) {
        if (layerLines.isEmpty() || alpha <= 0) return

        val layerSave = canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), alpha)
        canvas.translate(0f, layerScrollY)
        if (includeAccents) {
            // Keep retained accents under text so they don't compete with lyrics readability.
            retainedAccents.drawRetainedProfileAccents(
                canvas = canvas,
                currentTimeMs = currentTimeMs,
                enableSpectralParticles = enableSpectralParticles,
                density = density,
                particlePaint = particlePaint,
            )
        }
        for (index in layerLines.indices) {
            val line = layerLines[index]
            val screenY = line.y + layerScrollY
            if (screenY < -line.totalHeight * 2f || screenY > height + line.totalHeight * 2f) continue
            lineRenderer.drawLine(
                canvas = canvas,
                line = line,
                lineIndex = index,
                activeLineIndex = activeLineIndex,
                currentTimeMs = currentTimeMs,
                config = KaraokeLineRenderConfig(
                    density = density,
                    marginLeft = marginLeft,
                    lineHeight = lineHeight,
                    backgroundLineHeight = backgroundLineHeight,
                    hierarchyTransitionWindowMs = hierarchyTransitionWindowMs,
                    backgroundRevealDurationMs = backgroundRevealDurationMs,
                    backgroundFadeOutDurationMs = backgroundFadeOutDurationMs,
                    featherPx = FEATHER_PX,
                    isLineByLine = isLineByLine,
                    basePaint = basePaint,
                    highlightPaint = highlightPaint,
                    backgroundBasePaint = backgroundBasePaint,
                    backgroundHighlightPaint = backgroundHighlightPaint,
                    displayMode = displayMode,
                ),
                callbacks = lineRenderCallbacks,
            )
        }
        if (includeAccents) {
            particleSystem.drawSuspendedSpectralParticles(
                canvas = canvas,
                currentTimeMs = currentTimeMs,
                enableSpectralParticles = enableSpectralParticles,
                particlePaint = particlePaint,
            )
        }
        canvas.restoreToCount(layerSave)
    }

    private fun getLyricsTransitionProgress(): Float {
        if (outgoingLines == null || lyricsTransitionStartNanos <= 0L) return 1f

        val elapsed = (System.nanoTime() - lyricsTransitionStartNanos).coerceAtLeast(0L)
        val raw = (elapsed.toFloat() / lyricsTransitionDurationNanos.toFloat()).coerceIn(0f, 1f)
        if (raw >= 1f) {
            outgoingLines = null
            outgoingLookupTable = null
            lyricsTransitionStartNanos = 0L
            return 1f
        }
        return smootherStep(raw)
    }

    private fun buildLyricsSignature(value: List<LyricLine>): String {
        if (value.isEmpty()) return ""

        val first = value.first()
        val last = value.last()
        val wordCount = value.sumOf { it.words.size + it.backgroundWords.size }
        return "${value.size}:${wordCount}:${first.startMs}:${first.endMs}:${last.startMs}:${last.endMs}"
    }



    private fun smootherStep(value: Float): Float {
        val t = value.coerceIn(0f, 1f)
        return t * t * t * (t * (t * 6f - 15f) + 10f)
    }

    private fun ellipsizeCenter(value: String, maxChars: Int): String {
        if (value.length <= maxChars) return value
        return value.take(maxChars - 1) + "…"
    }

    // ========================================================================
    // GLOBAL LINE SWEEP (Apple Music style)
    // ========================================================================

    private fun drawWordWipeHighlight(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        useCharacterLift: Boolean,
        currentTimeMs: Long,
        visualWordDurationMs: Float = 0f,
        visualWordStartMs: Long = 0L,
    ) {
        val wordX = marginLeft + word.xOffset
        val clampedProgress = progress.coerceIn(0f, 1f)
        val postEndSettle = smootherStep(((progress - 1f) / 0.35f).coerceIn(0f, 1f))
        // The ONLY word that gets a soft "start-wipe" entry (sweep begins slightly
        // before the glyphs) is the first word of a row — there is no previous word
        // to flow from, so a wider lead-in reads as the phrase starting.
        // Every subsequent word MUST begin exactly at its left edge (offset 0), i.e.
        // exactly where the previous word's sweep ended. Any negative offset here makes
        // the reveal edge jump BACKWARD at each word boundary, which is what made the
        // barrido look like it "starts from zero" on every word instead of flowing
        // continuously across the whole phrase.
        val isFirstWord = line.words
            .filter { !it.isBackground && Math.abs(it.yOffset - word.yOffset) < density }
            .minByOrNull { it.xOffset } == word
        val initialOffset = if (isFirstWord) {
            -paint.textSize * 0.375f * (1f - smootherStep((clampedProgress * 4f).coerceIn(0f, 1f)))
        } else {
            0f
        }
        val sweepX = wordX + initialOffset + word.width * clampedProgress + FEATHER_PX * 2f * postEndSettle
        val shouldRenderWipeShader = KaraokeHighlightStateMachine.shouldRenderWipeShader(progress)

        // Compute lift progress from visual word timing (not syllable progress).
        // The syllable progress drives the sweep position, but the lift should
        // animate over the full visual word duration to avoid jumps between syllables.
        val liftProgress = if (visualWordStartMs > 0L && visualWordDurationMs > 0f) {
            ((currentTimeMs - visualWordStartMs).toFloat() / visualWordDurationMs).coerceAtLeast(0f)
        } else {
            progress.coerceAtLeast(0f)
        }

        if (!shouldRenderWipeShader) {
            if (useCharacterLift) {
                drawWordCharactersWithLift(
                    canvas = canvas,
                    line = line,
                    word = word,
                    progress = liftProgress,
                    paint = paint,
                    rowHeight = rowHeight,
                    finalLiftRatio = finalLiftRatio,
                    overrideDurationMs = visualWordDurationMs,
                )
            } else {
                drawWordTranslated(canvas, line, word, paint, -rowHeight * finalLiftRatio)
            }

            return
        }

        // Shader on the paint itself — no saveLayer/DST_IN, no visible boundary line.
        // The bright text fades to transparent at sweepX; the dim base text underneath
        // shows through organically, matching Apple Music's liquid fill look.
        val endSettleT = smootherStep(((clampedProgress - 0.82f) / 0.18f).coerceIn(0f, 1f))
        val fadeWidth = FEATHER_PX * (4f * (1f - endSettleT * 0.88f))
        val r = Color.red(paint.color)
        val g = Color.green(paint.color)
        val b = Color.blue(paint.color)
        val a = paint.alpha
        val originalShader = paint.shader
        val agslShader = KaraokeWipeShader.getWipeColorShader(sweepX, fadeWidth, paint.color, a)
        if (agslShader != null) {
            paint.shader = agslShader
        } else {
            paint.shader = LinearGradient(
                sweepX - fadeWidth, 0f,
                sweepX + fadeWidth * 0.4f, 0f,
                intArrayOf(
                    Color.argb(a, r, g, b),
                    Color.argb(a, r, g, b),
                    Color.argb((a * 0.65f).toInt(), r, g, b),
                    Color.argb((a * 0.2f).toInt(), r, g, b),
                    Color.argb(0, r, g, b),
                ),
                floatArrayOf(0f, 0.40f, 0.65f, 0.85f, 1f),
                Shader.TileMode.CLAMP,
            )
        }

        if (useCharacterLift) {
            drawWordCharactersWithLift(
                canvas = canvas,
                line = line,
                word = word,
                progress = liftProgress,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                overrideDurationMs = visualWordDurationMs,
            )
        } else {
            drawWordTranslated(canvas, line, word, paint, -rowHeight * finalLiftRatio)
        }

        paint.shader = originalShader
        // Keep stardust visible on short notes only for the cosmic profile.
        // Long notes still use the stronger cross-theme glow path below.
        val wordDurationMs = word.endMs - word.startMs
        if (wordDurationMs < 900L && motionProfile == MotionProfile.COSMIC) {
            paint.shader = null
            drawProfileAccent(
                canvas = canvas,
                line = line,
                words = listOf(word),
                sweepX = sweepX,
                glowProgress = clampedProgress.coerceAtLeast(0.24f),
                rowHeight = rowHeight,
                translateY = -rowHeight * finalLiftRatio,
                currentTimeMs = currentTimeMs,
            )
            paint.shader = originalShader
        }

    }

    private fun drawWordPreHighlight(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
    ) {
        val wordX = marginLeft + word.xOffset
        val wordTop = line.y + word.yOffset
        val wordBottom = wordTop + rowHeight
        val wordRight = wordX + word.width + FEATHER_PX * 2

        // YouLyPlus pre-wipe-char (lyrics.css @keyframes pre-wipe-universal):
        // background-size = 0.75em, background-position (LEFT edge) from -0.75em to -0.375em.
        // The band's CENTER (its color peak) therefore travels from -0.375em to 0 — i.e.
        // it ends ON the word's left edge, not in the empty space before it.
        // Previously centerEnd was wordX - 0.1em, leaving the peak short of the glyphs, so
        // the masked glow barely landed on the letters and the pre-sweep looked invisible
        // until the word became active. Landing the peak at wordX makes the glow lead the
        // word exactly like the web reference (and ahead of the wipe fill, which follows it).
        val preBandWidth = (paint.textSize * 0.75f).coerceAtLeast(4f * density)
        val preBandHalf = preBandWidth * 0.5f
        val centerStart = wordX - paint.textSize * 0.375f
        val centerEnd = wordX
        val bandCenter = centerStart + (centerEnd - centerStart) * progress.coerceIn(0f, 1f)
        val liftRatio = if (word.isBackground) 0.025f else 0.035f
        val preLiftY = -rowHeight * liftRatio * smootherStep(progress)

        canvas.save()
        canvas.saveLayer(wordX - FEATHER_PX, wordTop - rowHeight, wordRight, wordBottom + rowHeight, null)
        drawWordTranslated(canvas, line, word, paint, preLiftY)

        val agslPreGlow = KaraokeWipeShader.getPreGlowShader(bandCenter, preBandHalf)
        val preMaskShader: Shader = agslPreGlow ?: LinearGradient(
            bandCenter - preBandHalf,
            0f,
            bandCenter + preBandHalf,
            0f,
            intArrayOf(
                Color.TRANSPARENT,
                Color.argb(40, 0, 0, 0),
                Color.argb(180, 0, 0, 0),
                Color.argb(40, 0, 0, 0),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.18f, 0.5f, 0.82f, 1f),
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = preMaskShader
        canvas.drawRect(
            wordX - FEATHER_PX,
            wordTop - rowHeight,
            wordRight,
            wordBottom + rowHeight,
            sweepMaskPaint,
        )
        canvas.restore()
        canvas.restore()
    }

    private fun drawCompletedWordWithLift(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        currentTimeMs: Long,
        keepCharacterLift: Boolean,
        visualWordDurationMs: Float = 0f,
        visualWordStartMs: Long = 0L,
    ) {
        // Keep completed words in lifted character style while this line stays active
        // (including silent gap until next estrofa starts).
        if (keepCharacterLift) {
            val wordDurationMs = (word.endMs - word.startMs).coerceAtLeast(1L).toFloat()
            val completedAgeMs = (currentTimeMs - word.endMs).coerceAtLeast(0L).toFloat()
            // Only use visual word timing for words that are actually PART of the
            // current visual word (i.e. earlier syllables of the same spoken word).
            // Words from other visual word groups use their own timing for release.
            val visualWordEndMs = visualWordStartMs + visualWordDurationMs.toLong()
            val belongsToActiveVisualWord = visualWordStartMs > 0L && visualWordDurationMs > 0f &&
                word.startMs >= visualWordStartMs && word.endMs <= visualWordEndMs
            var liftProgress = if (belongsToActiveVisualWord) {
                // Still within the active visual word → continuous rise
                ((currentTimeMs - visualWordStartMs).toFloat() / visualWordDurationMs).coerceAtLeast(0f)
            } else {
                // Different visual word → standard release from completion
                1f + (completedAgeMs / wordDurationMs)
            }
            val sustainedPhraseTiming = findSustainedPhraseTiming(
                phraseTimings = buildSustainedPhraseTimings(line.words),
                wordStartMs = word.startMs,
                wordEndMs = word.endMs,
                exactBounds = false,
            )
            val phraseVisualWord = sustainedPhraseTiming?.second
            if (sustainedPhraseTiming != null) {
                liftProgress = getSustainedPhraseLiftProgress(
                    wordTiming = sustainedPhraseTiming.second,
                    phraseTiming = sustainedPhraseTiming.first,
                    currentTimeMs = currentTimeMs,
                )
            }
            // For sustained words that just completed, keep glow enabled so the
            // animT release curve fades it naturally (instead of cutting to 0 instantly).
            val recentlyCompleted = completedAgeMs < 600f
            val isSustained = phraseVisualWord != null || (belongsToActiveVisualWord && visualWordDurationMs >= 850f)
            drawWordCharactersWithLift(
                canvas = canvas,
                line = line,
                word = word,
                progress = liftProgress,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                enableGlow = phraseVisualWord != null || (recentlyCompleted && isSustained),
                overrideDurationMs = phraseVisualWord?.durationMs
                    ?: if (belongsToActiveVisualWord) visualWordDurationMs else 0f,
            )
            return
        }

        val originalAlpha = paint.alpha
        val shadowAlpha = (originalAlpha * completedLiftShadowAlphaFactor)
            .toInt()
            .coerceIn(0, completedLiftShadowAlphaCap)

        canvas.save()
        canvas.translate(0f, -rowHeight * finalLiftRatio)
        if (shadowAlpha > 0) {
            paint.setShadowLayer(
                rowHeight * completedLiftShadowRadiusRatio,
                0f,
                rowHeight * completedLiftShadowYOffsetRatio,
                Color.argb(
                    shadowAlpha,
                    Color.red(glowColor),
                    Color.green(glowColor),
                    Color.blue(glowColor),
                ),
            )
        }
        drawWord(canvas, line, word, paint)
        paint.clearShadowLayer()
        paint.alpha = originalAlpha
        canvas.restore()
    }

    private fun drawGrowableVisualWordWipeHighlight(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        progress: Float,
        sweepX: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        currentTimeMs: Long,
    ) {
        if (words.isEmpty()) return
        val clampedProgress = progress.coerceIn(0f, 1f)
        val shouldRenderWipeShader = KaraokeHighlightStateMachine.shouldRenderWipeShader(progress)

        if (!shouldRenderWipeShader) {
            // Wipe complete: draw with lift/glow held at their target values
            drawVisualWordCharactersWithLift(
                canvas = canvas,
                line = line,
                words = words,
                progress = progress.coerceAtLeast(0f),
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                marginLeft = marginLeft,
                density = density,
                glowColor = glowColor,
                enableGlow = true,
                smootherStep = ::smootherStep,
            )
            return
        }

        // Active wipe: use saveLayer + DST_IN mask to clip BOTH text AND shadow
        // to the revealed area. This lets us keep enableGlow=true so the glow
        // builds gradually as the wipe reveals each character — no pop at the end.
        // (The old shader approach couldn't clip the shadow layer, causing bleed.)
        val firstWord = words.first()
        val lastWord = words.last()
        val wordLeft = marginLeft + firstWord.xOffset - FEATHER_PX * 2
        val wordRight = marginLeft + lastWord.xOffset + lastWord.width + FEATHER_PX * 4
        val wordTop = line.y + words.minOf { it.yOffset } - rowHeight * 1.5f
        val wordBottom = line.y + words.maxOf { it.yOffset } + rowHeight * 2.5f

        canvas.saveLayer(wordLeft, wordTop, wordRight, wordBottom, null)

        drawVisualWordCharactersWithLift(
            canvas = canvas,
            line = line,
            words = words,
            progress = progress.coerceAtLeast(0f),
            paint = paint,
            rowHeight = rowHeight,
            finalLiftRatio = finalLiftRatio,
            marginLeft = marginLeft,
            density = density,
            glowColor = glowColor,
            enableGlow = true, // Glow is ON — the DST_IN mask clips it to the revealed area
            smootherStep = ::smootherStep,
        )

        // Same settling logic: shrink feather toward end so no characters are left partially
        // revealed when the word completes and transitions to the full-glow post-wipe state.
        val endSettleT = smootherStep(((clampedProgress - 0.82f) / 0.18f).coerceIn(0f, 1f))
        val fadeWidth = FEATHER_PX * (4f * (1f - endSettleT * 0.88f))
        val agslMask = KaraokeWipeShader.getWipeMaskShader(sweepX, fadeWidth)
        val maskShader: Shader = agslMask ?: LinearGradient(
            sweepX - fadeWidth, 0f,
            sweepX + fadeWidth * 0.4f, 0f,
            intArrayOf(
                Color.BLACK,
                Color.BLACK,
                Color.argb(166, 0, 0, 0),
                Color.argb(51, 0, 0, 0),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.40f, 0.65f, 0.85f, 1f),
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = maskShader
        canvas.drawRect(wordLeft, wordTop, wordRight, wordBottom, sweepMaskPaint)

        canvas.restore()
    }

    /**
     * Draw the highlight layer for an entire row as a single continuous sweep.
     *
     * When [isRowComplete], all words are simply drawn with lift — the sweep
     * is already past. When the row is active, all words are drawn into a
     * saveLayer and then a single AGSL/LinearGradient mask clips everything
     * past [sweepX] to transparent, producing one liquid wipe head that
     * travels across the entire phrase without ever resetting.
     */
    private fun drawRowSweepHighlight(
        canvas: Canvas,
        line: LyricLine,
        rowWords: List<LyricWord>,
        sweepX: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        currentTimeMs: Long,
        isRowComplete: Boolean,
    ) {
        if (rowWords.isEmpty()) return

        val visualWordGroups = buildRowVisualWordGroups(rowWords)
        val sustainedPhraseTimings = buildSustainedPhraseTimings(line.words)

        if (isRowComplete) {
            for (visualWord in visualWordGroups) {
                drawVisualWordCharactersWithLift(
                    canvas = canvas,
                    line = line,
                    words = visualWord,
                    progress = getVisualWordLiftProgress(visualWord, currentTimeMs, sustainedPhraseTimings),
                    paint = paint,
                    rowHeight = rowHeight,
                    finalLiftRatio = finalLiftRatio,
                    marginLeft = marginLeft,
                    density = density,
                    glowColor = glowColor,
                    enableGlow = true,
                    smootherStep = ::smootherStep,
                )
            }
            return
        }

        val firstWord = rowWords.first()
        val lastWord  = rowWords.last()
        val rowLeft   = marginLeft + firstWord.xOffset - FEATHER_PX * 2
        val rowRight  = marginLeft + lastWord.xOffset + lastWord.width + FEATHER_PX * 4
        val rowTop    = line.y + firstWord.yOffset - rowHeight * 1.5f
        val rowBottom = line.y + firstWord.yOffset + rowHeight * 2.5f

        // saveLayer so the DST_IN mask clips ALL character draws (including glow shadow)
        canvas.saveLayer(rowLeft, rowTop, rowRight, rowBottom, null)

        // Draw every visual word with one shared lift clock. The wipe can still
        // reveal per glyph, but the vertical motion cannot split by syllable.
        for (visualWord in visualWordGroups) {
            drawVisualWordCharactersWithLift(
                canvas = canvas,
                line = line,
                words = visualWord,
                progress = getVisualWordLiftProgress(visualWord, currentTimeMs, sustainedPhraseTimings),
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                marginLeft = marginLeft,
                density = density,
                glowColor = glowColor,
                enableGlow = true,
                smootherStep = ::smootherStep,
            )
        }

        // Single feathered wipe mask for the whole row.
        val fadeWidth = FEATHER_PX * 3.5f
        val agslMask = KaraokeWipeShader.getWipeMaskShader(sweepX, fadeWidth)
        val maskShader: Shader = agslMask ?: LinearGradient(
            sweepX - fadeWidth, 0f,
            sweepX + fadeWidth * 0.4f, 0f,
            intArrayOf(
                Color.BLACK,
                Color.BLACK,
                Color.argb(166, 0, 0, 0),
                Color.argb(51, 0, 0, 0),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.40f, 0.65f, 0.85f, 1f),
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = maskShader
        canvas.drawRect(rowLeft, rowTop, rowRight, rowBottom, sweepMaskPaint)

        canvas.restore()
    }

    private fun buildRowVisualWordGroups(rowWords: List<LyricWord>): List<List<LyricWord>> {
        if (rowWords.isEmpty()) return emptyList()

        val groups = mutableListOf<List<LyricWord>>()
        var currentGroup = mutableListOf<LyricWord>()

        for (word in rowWords) {
            val previous = currentGroup.lastOrNull()
            if (previous != null && LyricsVisualWords.shouldInsertSpacing(previous, word)) {
                groups += currentGroup
                currentGroup = mutableListOf()
            }
            currentGroup += word
        }

        if (currentGroup.isNotEmpty()) {
            groups += currentGroup
        }

        return groups
    }

    private data class SustainedVisualWordTiming(
        val startMs: Long,
        val endMs: Long,
        val durationMs: Float,
        val releaseDurationMs: Float,
    )

    private data class SustainedPhraseTiming(
        val phraseEndMs: Long,
        val sharedReleaseDurationMs: Float,
        val words: List<SustainedVisualWordTiming>,
    )

    private fun buildSustainedPhraseTimings(words: List<LyricWord>): List<SustainedPhraseTiming> {
        val phraseTimings = mutableListOf<SustainedPhraseTiming>()
        var currentRun = mutableListOf<SustainedVisualWordTiming>()

        fun appendCurrentRun() {
            if (currentRun.size >= 2) {
                val run = currentRun.toList()
                phraseTimings += SustainedPhraseTiming(
                    phraseEndMs = run.maxOf { it.endMs },
                    sharedReleaseDurationMs = run.maxOf { it.releaseDurationMs }.coerceAtLeast(1f),
                    words = run,
                )
            }
            currentRun = mutableListOf()
        }

        for (visualWord in buildRowVisualWordGroups(words)) {
            val startMs = visualWord.firstOrNull()?.startMs
            val endMs = visualWord.lastOrNull()?.endMs
            if (startMs == null || endMs == null) {
                appendCurrentRun()
                continue
            }
            val combinedText = visualWord.joinToString(separator = "") { it.text }
            if (!LyricsVisualWords.isGrowableVisualWord(combinedText, startMs, endMs)) {
                appendCurrentRun()
                continue
            }

            val durationMs = (endMs - startMs).coerceAtLeast(1L).toFloat()
            currentRun += SustainedVisualWordTiming(
                startMs = startMs,
                endMs = endMs,
                durationMs = durationMs,
                releaseDurationMs = getSustainedReleaseDurationMs(durationMs),
            )
        }

        appendCurrentRun()

        return phraseTimings
    }

    private fun getSustainedReleaseDurationMs(durationMs: Float): Float {
        val riseDurationMs = (1200f + (durationMs / 1000f) * 600f).coerceIn(1200f, 2500f)
        return (riseDurationMs * 0.25f).coerceIn(250f, 600f)
    }

    private fun findSustainedPhraseTiming(
        phraseTimings: List<SustainedPhraseTiming>,
        wordStartMs: Long,
        wordEndMs: Long,
        exactBounds: Boolean,
    ): Pair<SustainedPhraseTiming, SustainedVisualWordTiming>? {
        for (phraseTiming in phraseTimings) {
            val wordTiming = phraseTiming.words.firstOrNull {
                if (exactBounds) {
                    it.startMs == wordStartMs && it.endMs == wordEndMs
                } else {
                    wordStartMs >= it.startMs && wordEndMs <= it.endMs
                }
            }
            if (wordTiming != null) return phraseTiming to wordTiming
        }

        return null
    }

    private fun getSustainedPhraseLiftProgress(
        wordTiming: SustainedVisualWordTiming,
        phraseTiming: SustainedPhraseTiming,
        currentTimeMs: Long,
    ): Float {
        if (currentTimeMs <= wordTiming.endMs) {
            return ((currentTimeMs - wordTiming.startMs).toFloat() / wordTiming.durationMs).coerceIn(0f, 1f)
        }
        if (currentTimeMs <= phraseTiming.phraseEndMs) {
            return 1f
        }

        val sharedReleaseT = (
            (currentTimeMs - phraseTiming.phraseEndMs).coerceAtLeast(0L).toFloat() /
                phraseTiming.sharedReleaseDurationMs
            ).coerceIn(0f, 1f)
        val rendererPostMs = wordTiming.releaseDurationMs * sharedReleaseT
        return 1f + (rendererPostMs / wordTiming.durationMs)
    }

    private fun getVisualWordLiftProgress(
        words: List<LyricWord>,
        currentTimeMs: Long,
        sustainedPhraseTimings: List<SustainedPhraseTiming> = emptyList(),
    ): Float {
        if (words.isEmpty()) return 0f

        val startMs = words.first().startMs
        val endMs = words.last().endMs
        val durationMs = (endMs - startMs).coerceAtLeast(1L).toFloat()
        val combinedText = words.joinToString(separator = "") { it.text }
        val isSustained = LyricsVisualWords.isGrowableVisualWord(combinedText, startMs, endMs)
        val sustainedTiming = if (isSustained) {
            findSustainedPhraseTiming(
                phraseTimings = sustainedPhraseTimings,
                wordStartMs = startMs,
                wordEndMs = endMs,
                exactBounds = true,
            )
        } else {
            null
        }
        if (sustainedTiming != null) {
            return getSustainedPhraseLiftProgress(
                wordTiming = sustainedTiming.second,
                phraseTiming = sustainedTiming.first,
                currentTimeMs = currentTimeMs,
            )
        }

        val maxProgress = if (isSustained) 1.6f else 1.5f

        return ((currentTimeMs - startMs).toFloat() / durationMs).coerceIn(0f, maxProgress)
    }

    private fun drawWordCharactersWithLift(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        enableGlow: Boolean = true,
        overrideDurationMs: Float = 0f,
    ) {
        drawVisualWordCharactersWithLift(
            canvas = canvas,
            line = line,
            words = listOf(word),
            progress = progress,
            paint = paint,
            rowHeight = rowHeight,
            finalLiftRatio = finalLiftRatio,
            marginLeft = marginLeft,
            density = density,
            glowColor = glowColor,
            enableGlow = enableGlow,
            smootherStep = ::smootherStep,
            overrideDurationMs = overrideDurationMs,
        )
    }

    private fun drawWordTranslated(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        translateY: Float,
    ) {
        canvas.save()
        canvas.translate(0f, translateY)
        drawWord(canvas, line, word, paint)
        canvas.restore()
    }

    private fun drawWord(canvas: Canvas, line: LyricLine, word: LyricWord, paint: Paint) {
        val wordX = marginLeft + word.xOffset
        val rowHeight = if (word.isBackground) backgroundLineHeight else lineHeight
        val wordY = line.y + word.yOffset + rowHeight * 0.7f
        canvas.drawText(word.text, wordX, wordY, paint)

        // Inline Romanization (Word-Synced)
        val showRomanization = displayMode == "romanize" || displayMode == "both"
        if (showRomanization && word.romanizedText != null && !word.isBackground) {
            val romPaint = Paint(paint).apply {
                textSize = backgroundFontSize
                shader = null // Clear wipe shader for transliterations
                alpha = (paint.alpha * 0.7f).toInt().coerceIn(0, 255)
            }
            LyricsTranslationManager.drawWordSyncedRomanization(
                canvas = canvas,
                word = word,
                paint = romPaint,
                line = line,
                originalRowHeight = rowHeight,
                subtextRowHeight = backgroundLineHeight,
                marginLeft = marginLeft,
                isRtl = false
            )
        }
    }

    private fun drawWordTail(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        revealX: Float,
        rowHeight: Float,
        fadeWidth: Float = 0f,
        translateY: Float = 0f,
    ) {
        val wordLeft = marginLeft + word.xOffset
        val wordRight = wordLeft + word.width

        // Mathematically perfect continuous boundaries for complementary fading:
        // 1. If transition hasn't touched the word yet, draw the full dim word.
        if (fadeWidth > 0f && revealX + fadeWidth * 0.25f <= wordLeft) {
            drawWordTranslated(canvas, line, word, paint, translateY)
            return
        }
        if (fadeWidth <= 0f && revealX <= wordLeft) {
            drawWordTranslated(canvas, line, word, paint, translateY)
            return
        }

        // 2. If transition has completely passed the word, render nothing.
        if (fadeWidth > 0f && revealX - fadeWidth * 0.25f >= wordRight) {
            return
        }
        if (fadeWidth <= 0f && revealX >= wordRight) {
            return
        }

        val wordTop = line.y + word.yOffset
        val wordBottom = wordTop + rowHeight
        canvas.save()
        if (translateY != 0f) {
            canvas.translate(0f, translateY)
        }

        if (fadeWidth > 0f) {
            val startX = revealX - fadeWidth * 0.4f
            val endX = revealX + fadeWidth * 0.4f

            val originalShader = paint.shader
            val baseColor = paint.color
            val bR = Color.red(baseColor)
            val bG = Color.green(baseColor)
            val bB = Color.blue(baseColor)
            val bA = Color.alpha(baseColor)

            // Complementary curve: mirrors the wipe gradient so the sum ≈ constant
            val maskShader = LinearGradient(
                startX, 0f,
                endX, 0f,
                intArrayOf(
                    Color.argb(0, bR, bG, bB),
                    Color.argb((bA * 0.35f).toInt(), bR, bG, bB),
                    Color.argb((bA * 0.80f).toInt(), bR, bG, bB),
                    Color.argb(bA, bR, bG, bB),
                ),
                floatArrayOf(0f, 0.3f, 0.7f, 1f),
                Shader.TileMode.CLAMP
            )
            paint.shader = maskShader

            // Optimization & safety: clip from startX to prevent overdraw and ensure smooth clipping
            canvas.clipRect(startX.coerceAtLeast(wordLeft), wordTop - rowHeight, wordRight + FEATHER_PX, wordBottom + rowHeight)
            drawWord(canvas, line, word, paint)

            paint.shader = originalShader
        } else {
            canvas.clipRect(revealX, wordTop - rowHeight, wordRight + FEATHER_PX, wordBottom + rowHeight)
            drawWord(canvas, line, word, paint)
        }
        canvas.restore()
    }

    private fun drawSweepGlowForWords(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        paint: Paint,
        rowHeight: Float,
        translateY: Float,
        currentTimeMs: Long,
    ) {
        if (words.isEmpty() || glowProgress <= 0f) return
        val preset = motionProfile.preset

        val firstWord = words.first()
        val lastWord = words.last()
        val wordLeft = marginLeft + firstWord.xOffset
        val profileGlowWidth = LEADING_GLOW_WIDTH_PX * preset.glowWidthScale
        val wordRight = marginLeft + lastWord.xOffset + lastWord.width
        if (sweepX <= wordLeft || sweepX >= wordRight + profileGlowWidth) return

        val wordTop = line.y + words.minOf { it.yOffset }
        val wordBottom = line.y + words.maxOf { it.yOffset } + rowHeight
        val glowAlpha = ((preset.glowAlphaBase + preset.glowAlphaRange * glowProgress) * preset.glowAlphaMultiplier)
            .toInt()
            .coerceIn(0, preset.glowAlphaClamp)
        val glowRadius = rowHeight * (preset.glowRadiusBase + preset.glowRadiusRange * glowProgress)
        val glowBandStart = sweepX - profileGlowWidth * preset.glowBandStartScale
        val glowBandEnd = sweepX + profileGlowWidth * preset.glowBandEndScale
        val glowFadeWidth = profileGlowWidth * preset.glowFadeScale
        val originalAlpha = paint.alpha
        val glowCoreAlpha = (glowAlpha * 0.78f).toInt().coerceIn(72, 178)
        val profileGlowColor = getProfileGlowColor(motionProfile, glowColor)
        val baseGlowRadius = glowRadius * 0.58f

        // Core first: keep letterforms bright/defined inside the glow band
        paint.alpha = glowCoreAlpha
        paint.setShadowLayer(
            baseGlowRadius,
            0f,
            0f,
            Color.argb(
                (glowAlpha * 0.52f).toInt().coerceIn(0, (preset.glowShadowClamp * 0.72f).toInt()),
                Color.red(profileGlowColor),
                Color.green(profileGlowColor),
                Color.blue(profileGlowColor)
            )
        )

        canvas.saveLayer(
            glowBandStart - glowFadeWidth,
            wordTop - rowHeight,
            glowBandEnd + glowFadeWidth,
            wordBottom + rowHeight,
            null
        )
        canvas.translate(0f, translateY)
        for (word in words) {
            drawWord(canvas, line, word, paint)
        }
        canvas.translate(0f, -translateY)

        val glowMaskShader = LinearGradient(
            glowBandStart - glowFadeWidth,
            0f,
            glowBandEnd + glowFadeWidth,
            0f,
            intArrayOf(Color.TRANSPARENT, Color.BLACK, Color.BLACK, Color.TRANSPARENT),
            getProfileGlowStops(motionProfile),
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = glowMaskShader
        canvas.drawRect(
            glowBandStart - glowFadeWidth,
            wordTop - rowHeight,
            glowBandEnd + glowFadeWidth,
            wordBottom + rowHeight,
            sweepMaskPaint
        )
        canvas.restore()

        paint.clearShadowLayer()
        paint.alpha = originalAlpha
    }

    private fun drawProfileAccent(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
        currentTimeMs: Long,
    ) {
        retainedAccents.emitRetainedProfileAccent(
            enableSpectralParticles = enableSpectralParticles,
            motionProfile = motionProfile,
            currentTimeMs = currentTimeMs,
            line = line,
            words = words,
            sweepX = sweepX,
            rowHeight = rowHeight,
            translateY = translateY,
            glowProgress = glowProgress,
            density = density,
            glowColor = glowColor,
        )
        particleSystem.emitSpectralParticles(
            enableSpectralParticles = enableSpectralParticles,
            motionProfile = motionProfile,
            currentTimeMs = currentTimeMs,
            line = line,
            words = words,
            sweepX = sweepX,
            glowProgress = glowProgress,
            rowHeight = rowHeight,
            translateY = translateY,
            density = density,
            glowColor = glowColor,
        )
        profileRenderer.drawAccent(
            KaraokeAccentContext(
                canvas = canvas,
                line = line,
                words = words,
                sweepX = sweepX,
                glowProgress = glowProgress,
                rowHeight = rowHeight,
                translateY = translateY,
                currentTimeMs = currentTimeMs,
                glowColor = glowColor,
                density = density,
                marginLeft = marginLeft,
                sparklePaint = sparklePaint,
                preset = motionProfile.preset,
                leadingGlowWidthPx = LEADING_GLOW_WIDTH_PX,
            )
        )
    }

    private fun calculateContinuousSweepX(rowWords: List<LyricWord>, currentTimeMs: Long): Float {
        val firstWord = rowWords.first()
        val firstWordLeft = marginLeft + firstWord.xOffset
        val lastWord = rowWords.last()
        val rowRight = marginLeft + lastWord.xOffset + lastWord.width
        val rowStart = firstWord.startMs
        val rowEnd = rowWords.maxOf { it.endMs }
        val rowDuration = (rowEnd - rowStart).coerceAtLeast(1L).toFloat()
        val rowProgress = ((currentTimeMs - rowStart).toFloat() / rowDuration).coerceIn(0f, 1f)
        val rowSweepX = firstWordLeft + (rowRight - firstWordLeft) * smootherStep(rowProgress)
        var syncedSweepX = rowSweepX

        for (index in rowWords.indices) {
            val word = rowWords[index]
            val wordLeft = marginLeft + word.xOffset
            val wordRight = wordLeft + word.width
            val wordStart = word.startMs
            val wordEnd = word.endMs

            if (currentTimeMs < wordStart) {
                if (index == 0) {
                    syncedSweepX = firstWordLeft
                    break
                }

                val previousWord = rowWords[index - 1]
                val previousRight = marginLeft + previousWord.xOffset + previousWord.width
                val gapDuration = (wordStart - previousWord.endMs).coerceAtLeast(1L).toFloat()
                val gapProgress = ((currentTimeMs - previousWord.endMs).toFloat() / gapDuration).coerceIn(0f, 1f)
                syncedSweepX = previousRight + (wordLeft - previousRight) * smootherStep(gapProgress)
                break
            }

            if (currentTimeMs <= wordEnd) {
                val duration = (wordEnd - wordStart).coerceAtLeast(1L).toFloat()
                val wordProgress = ((currentTimeMs - wordStart).toFloat() / duration).coerceIn(0f, 1f)
                syncedSweepX = wordLeft + word.width * smootherStep(wordProgress)
                break
            }

            if (index == rowWords.lastIndex) {
                syncedSweepX = wordRight
                break
            }
        }

        return (syncedSweepX * 0.68f + rowSweepX * 0.32f).coerceIn(firstWordLeft, rowRight)
    }

    private fun clearSpectralParticles() {
        particleSystem.clearSpectralParticles()
        retainedAccents.clearRetainedProfileAccents()
    }

    private fun applyReadablePalette() {
        val readableActive = ensureContrast(activeColor, backgroundColor, 4.6f)
        val readableInactive = ensureContrast(inactiveColor, backgroundColor, 2.35f)
        val softenedGlowSource = blendColors(glowColor, readableActive, 0.38f)
        val readableGlow = ensureContrast(softenedGlowSource, backgroundColor, 3.15f)

        activeColor = readableActive
        inactiveColor = readableInactive
        glowColor = readableGlow

        highlightPaint.color = readableActive
        backgroundHighlightPaint.color = readableActive
        basePaint.color = readableInactive
        backgroundBasePaint.color = readableInactive
        ambientBackgroundRenderer.setColors(readableGlow, backgroundColor)
        spectrumRenderer.setGlowColor(readableGlow)
    }


    // EDGE FADES
    // ========================================================================

    private fun drawFades(canvas: Canvas) {
        // Rebuild the gradients only when the browse-driven strength has actually moved.
        if (Math.abs(edgeFadeStrength - builtFadeStrength) > 0.01f) {
            buildFadeShaders(edgeFadeStrength)
        }
        fadeShaderTop?.let {
            fadePaint.shader = it
            canvas.drawRect(0f, 0f, width.toFloat(), fadeHeight, fadePaint)
        }
        fadeShaderBottom?.let {
            canvas.save()
            canvas.translate(0f, height - fadeHeight)
            fadePaint.shader = it
            canvas.drawRect(0f, 0f, width.toFloat(), fadeHeight, fadePaint)
            canvas.restore()
        }
    }

    // ========================================================================
    // PRE-COMPUTATION & PARSING
    // ========================================================================

    private fun precomputePositions() {
        lyricsLayoutEngine.layout(
            lines = lines,
            mainPaint = basePaint,
            backgroundPaint = backgroundBasePaint,
            config = LyricsLayoutConfig(
                width = width,
                marginLeft = marginLeft,
                marginRight = marginRight,
                lineHeight = lineHeight,
                lineSpacing = lineSpacing,
                spaceWidth = spaceWidth,
                backgroundLineHeight = backgroundLineHeight,
                backgroundSpaceWidth = backgroundSpaceWidth,
                backgroundGap = backgroundGap,
            ),
            displayMode = displayMode,
        )
    }

    private fun emitLineChangeIfNeeded(lineIndex: Int) {
        if (lineIndex != lastEmittedLineIndex && lineIndex >= 0) {
            lastEmittedLineIndex = lineIndex
        }
    }

    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); animator?.stop(); animator = null; spectrumCapture.release() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (lines.isNotEmpty() && animator?.isRunning != true) startAnimator(); updateSpectrumCaptureState() }
}
