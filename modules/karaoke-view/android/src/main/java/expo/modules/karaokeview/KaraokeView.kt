package expo.modules.karaokeview

import android.content.Context
import android.graphics.*
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
        ) {
            this@KaraokeView.drawWordTail(canvas, line, word, paint, revealX, rowHeight, fadeWidth)
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

    // --- Paints ---
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        // binimum relies on the platform UI stack; on Android the closest match is the sans-serif family.
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textAlign = Paint.Align.LEFT
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
    private var lastJsTimeMs: Long = 0
    private var lastJsUpdateNanos: Long = System.nanoTime()
    private var isPlaying: Boolean = false

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
        fontSize = 30f * density
        lineHeight = 47f * density
        marginLeft = 24f * density
        marginRight = 58f * density
        fadeHeight = 180f * density
        lineSpacing = 14f * density
        backgroundFontSize = fontSize * 0.6f
        backgroundLineHeight = backgroundFontSize * 1.45f
        backgroundGap = fontSize * 0.2f
        FEATHER_PX = 22f * density // Wider feather for organic liquid fill
        LEADING_GLOW_WIDTH_PX = 24f * density

        basePaint.color = inactiveColor
        basePaint.textSize = fontSize
        highlightPaint.color = activeColor
        highlightPaint.textSize = fontSize
        backgroundBasePaint.color = inactiveColor
        backgroundBasePaint.textSize = backgroundFontSize
        backgroundHighlightPaint.color = activeColor
        backgroundHighlightPaint.textSize = backgroundFontSize
        spaceWidth = basePaint.measureText(" ")
        backgroundSpaceWidth = backgroundBasePaint.measureText(" ")
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

    fun setFontSize(size: Float) {
        fontSize = size * density
        lineHeight = fontSize * 1.44f
        lineSpacing = fontSize * 0.46f
        backgroundFontSize = fontSize * 0.6f
        backgroundLineHeight = backgroundFontSize * 1.45f
        backgroundGap = fontSize * 0.2f
        basePaint.textSize = fontSize
        highlightPaint.textSize = fontSize
        backgroundBasePaint.textSize = backgroundFontSize
        backgroundHighlightPaint.textSize = backgroundFontSize
        spaceWidth = basePaint.measureText(" ")
        backgroundSpaceWidth = backgroundBasePaint.measureText(" ")
        precomputePositions()
        invalidate()
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

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        // Multi-stop gradient for a premium cinematic fade (not cheap 2-stop)
        fadeShaderTop = LinearGradient(
            0f, 0f, 0f, fadeHeight,
            intArrayOf(Color.TRANSPARENT, Color.argb(80, 0, 0, 0), Color.BLACK),
            floatArrayOf(0f, 0.45f, 1f),
            Shader.TileMode.CLAMP,
        )
        fadeShaderBottom = LinearGradient(
            0f, 0f, 0f, fadeHeight,
            intArrayOf(Color.BLACK, Color.argb(80, 0, 0, 0), Color.TRANSPARENT),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )
        precomputePositions()
    }

    fun setLyrics(lyricsData: List<Map<String, Any>>) {
        val nextLines = lyricsParser.parse(lyricsData)
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
        lastJsTimeMs = timeMs
        lastJsUpdateNanos = System.nanoTime()
    }

    fun setIsPlaying(isPlaying: Boolean) {
        this.isPlaying = isPlaying
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

    private fun getInterpolatedTime(): Long {
        if (!isPlaying) return lastJsTimeMs
        val elapsedMs = (System.nanoTime() - lastJsUpdateNanos) / 1_000_000
        return lastJsTimeMs + elapsedMs
    }

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
        // Warm-in: start sweepX slightly before the word edge so the first letters
        // appear through the feathered gradient (matching the pre-highlight that was
        // just showing). Over the first 15% of progress, ease from -FEATHER_PX to 0.
        val warmInT = smootherStep((clampedProgress / 0.15f).coerceIn(0f, 1f))
        val warmInOffset = FEATHER_PX * 1.5f * (1f - warmInT)
        val sweepX = wordX - warmInOffset + word.width * clampedProgress + FEATHER_PX * 2f * postEndSettle
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

        // YouLyPlus pre-wipe-char:
        // background-size = 0.75em, background-position from -0.75em to -0.375em.
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
            val liftProgress = if (belongsToActiveVisualWord) {
                // Still within the active visual word → continuous rise
                ((currentTimeMs - visualWordStartMs).toFloat() / visualWordDurationMs).coerceAtLeast(0f)
            } else {
                // Different visual word → standard release from completion
                1f + (completedAgeMs / wordDurationMs)
            }
            // For sustained words that just completed, keep glow enabled so the
            // animT release curve fades it naturally (instead of cutting to 0 instantly).
            val recentlyCompleted = completedAgeMs < 600f
            val isSustained = belongsToActiveVisualWord && visualWordDurationMs >= 850f
            drawWordCharactersWithLift(
                canvas = canvas,
                line = line,
                word = word,
                progress = liftProgress,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
                enableGlow = recentlyCompleted && isSustained,
                overrideDurationMs = if (belongsToActiveVisualWord) visualWordDurationMs else 0f,
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
    }

    private fun drawWordTail(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        revealX: Float,
        rowHeight: Float,
        fadeWidth: Float = 0f,
    ) {
        val wordLeft = marginLeft + word.xOffset
        val wordRight = wordLeft + word.width
        
        // Mathematically perfect continuous boundaries for complementary fading:
        // 1. If transition hasn't touched the word yet, draw the full dim word.
        if (fadeWidth > 0f && revealX + fadeWidth * 0.25f <= wordLeft) {
            drawWord(canvas, line, word, paint)
            return
        }
        if (fadeWidth <= 0f && revealX <= wordLeft) {
            drawWord(canvas, line, word, paint)
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
    }

    companion object {
        private const val MAX_SPECTRAL_PARTICLES = 128
        private const val MAX_RETAINED_PROFILE_ACCENTS = 128
    }
    // EDGE FADES
    // ========================================================================

    private fun drawFades(canvas: Canvas) {
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
        )
    }

    private fun emitLineChangeIfNeeded(lineIndex: Int) {
        if (lineIndex != lastEmittedLineIndex && lineIndex >= 0) {
            lastEmittedLineIndex = lineIndex
        }
    }

    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); animator?.stop(); animator = null }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (lines.isNotEmpty() && animator?.isRunning != true) startAnimator() }
}

