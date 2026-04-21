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
        ) {
            this@KaraokeView.drawWordTail(canvas, line, word, paint, revealX, rowHeight)
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
    private var fadeHeight = 120f
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
    private var introTitle: String = ""
    private var introSubtitle: String = ""
    private var firstLineStartMs: Long = 0L

    // --- Paints ---
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        // binimum relies on the platform UI stack; on Android the closest match is the sans-serif family.
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
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
    private val scrollAnchorRatio = 0.33f
    private val hierarchyTransitionWindowMs = 700f
    private val backgroundRevealDurationMs = 450f
    private val backgroundFadeOutDurationMs = 420f
    private val fireTrailFadeOutDurationMs = 520f

    init {
        density = resources.displayMetrics.density
        fontSize = 30f * density
        lineHeight = 60f * density
        marginLeft = 24f * density
        fadeHeight = 132f * density
        lineSpacing = 30f * density
        backgroundFontSize = fontSize * 0.6f
        backgroundLineHeight = backgroundFontSize * 1.45f
        backgroundGap = fontSize * 0.2f
        FEATHER_PX = 8f * density // Tight feather
        LEADING_GLOW_WIDTH_PX = 18f * density

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
        lineHeight = fontSize * 1.78f
        lineSpacing = fontSize * 1.0f
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
        highlightPaint.color = color
        backgroundHighlightPaint.color = color
        invalidate()
    }

    fun setInactiveColor(color: Int) {
        inactiveColor = color
        basePaint.color = color
        backgroundBasePaint.color = color
        invalidate()
    }

    fun setGlowColor(color: Int) {
        glowColor = color
        highlightPaint.color = color
        backgroundHighlightPaint.color = color
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        fadeShaderTop = LinearGradient(0f, 0f, 0f, fadeHeight, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
        fadeShaderBottom = LinearGradient(0f, 0f, 0f, fadeHeight, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
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
    ) {
        val wordX = marginLeft + word.xOffset
        val wordTop = line.y + word.yOffset
        val wordBottom = wordTop + rowHeight
        val wordRight = wordX + word.width + FEATHER_PX * 2
        val sweepX = wordX + word.width * progress

        canvas.save()
        canvas.saveLayer(wordX - FEATHER_PX, wordTop - rowHeight, wordRight, wordBottom + rowHeight, null)
        if (useCharacterLift) {
            drawWordCharactersWithLift(
                canvas = canvas,
                line = line,
                word = word,
                progress = progress,
                paint = paint,
                rowHeight = rowHeight,
                finalLiftRatio = finalLiftRatio,
            )
        } else {
            drawWordTranslated(canvas, line, word, paint, -rowHeight * finalLiftRatio)
        }
        drawSweepGlowForWords(
            canvas = canvas,
            line = line,
            words = listOf(word),
            sweepX = sweepX,
            glowProgress = progress,
            paint = paint,
            rowHeight = rowHeight,
            translateY = -rowHeight * finalLiftRatio,
            currentTimeMs = currentTimeMs,
        )

        val maskShader = LinearGradient(
            sweepX - FEATHER_PX,
            0f,
            sweepX,
            0f,
            intArrayOf(Color.BLACK, Color.TRANSPARENT),
            null,
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = maskShader
        canvas.drawRect(wordX - FEATHER_PX, wordTop, wordRight, wordBottom + rowHeight, sweepMaskPaint)
        canvas.restore()
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

        val firstWord = words.first()
        val lastWord = words.last()
        val wordLeft = marginLeft + firstWord.xOffset
        val wordTop = line.y + words.minOf { it.yOffset }
        val wordBottom = line.y + words.maxOf { it.yOffset } + rowHeight
        val wordRight = marginLeft + lastWord.xOffset + lastWord.width + FEATHER_PX * 2

        canvas.save()
        canvas.saveLayer(wordLeft - FEATHER_PX, wordTop - rowHeight, wordRight, wordBottom + rowHeight, null)
        drawVisualWordCharactersWithLift(
            canvas = canvas,
            line = line,
            words = words,
            progress = progress,
            paint = paint,
            rowHeight = rowHeight,
            finalLiftRatio = finalLiftRatio,
            marginLeft = marginLeft,
            density = density,
            glowColor = glowColor,
            smootherStep = ::smootherStep,
        )
        drawSweepGlowForWords(
            canvas = canvas,
            line = line,
            words = words,
            sweepX = sweepX,
            glowProgress = progress,
            paint = paint,
            rowHeight = rowHeight,
            translateY = -rowHeight * finalLiftRatio,
            currentTimeMs = currentTimeMs,
        )

        val maskShader = LinearGradient(
            sweepX - FEATHER_PX,
            0f,
            sweepX,
            0f,
            intArrayOf(Color.BLACK, Color.TRANSPARENT),
            null,
            Shader.TileMode.CLAMP,
        )
        sweepMaskPaint.shader = maskShader
        canvas.drawRect(wordLeft - FEATHER_PX, wordTop, wordRight, wordBottom + rowHeight, sweepMaskPaint)
        canvas.restore()
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
            smootherStep = ::smootherStep,
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
    ) {
        val wordLeft = marginLeft + word.xOffset
        val wordRight = wordLeft + word.width
        if (revealX <= wordLeft) {
            drawWord(canvas, line, word, paint)
            return
        }
        if (revealX >= wordRight) {
            return
        }

        val wordTop = line.y + word.yOffset
        val wordBottom = wordTop + rowHeight
        canvas.save()
        canvas.clipRect(revealX, wordTop - rowHeight, wordRight + FEATHER_PX, wordBottom + rowHeight)
        drawWord(canvas, line, word, paint)
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
        val profileGlowColor = getProfileGlowColor(motionProfile, glowColor)

        paint.alpha = glowAlpha
        paint.setShadowLayer(
            glowRadius,
            0f,
            0f,
            Color.argb(
                (glowAlpha * preset.glowShadowBoost).toInt().coerceIn(0, preset.glowShadowClamp),
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
        drawProfileAccent(
            canvas = canvas,
            line = line,
            words = words,
            sweepX = sweepX,
            glowProgress = glowProgress,
            rowHeight = rowHeight,
            translateY = translateY,
            currentTimeMs = currentTimeMs,
        )
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
        if (motionProfile == MotionProfile.COSMIC) {
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
        }
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

    companion object {
        private const val MAX_SPECTRAL_PARTICLES = 32
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
