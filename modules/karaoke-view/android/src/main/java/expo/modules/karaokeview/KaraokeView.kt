package expo.modules.karaokeview

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

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
            when (motionProfile) {
                MotionProfile.FIRE -> drawContinuousFireLine(
                    canvas = canvas,
                    line = line,
                    words = words,
                    currentTimeMs = currentTimeMs,
                    rowHeight = rowHeight,
                    translateY = translateY,
                )
                MotionProfile.VELVET -> drawContinuousWaterTrails(
                    canvas = canvas,
                    line = line,
                    words = words,
                    currentTimeMs = currentTimeMs,
                    rowHeight = rowHeight,
                    translateY = translateY,
                )
                MotionProfile.PULSE -> drawBouncingBallTrails(
                    canvas = canvas,
                    line = line,
                    words = words,
                    currentTimeMs = currentTimeMs,
                    rowHeight = rowHeight,
                    translateY = translateY,
                )
                else -> Unit
            }
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
    private val suspendedParticles = Array(MAX_SPECTRAL_PARTICLES) { SuspendedParticle() }
    private val particleEmissionBuckets = mutableMapOf<Long, Long>()
    private val retainedProfileAccents = Array(MAX_RETAINED_PROFILE_ACCENTS) { RetainedProfileAccent() }
    private val retainedAccentEmissionBuckets = mutableMapOf<Long, Long>()

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
            drawRetainedProfileAccents(canvas, currentTimeMs)
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
            drawSuspendedSpectralParticles(canvas, currentTimeMs)
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
        drawVisualWordCharactersWithLift(canvas, line, listOf(word), progress, paint, rowHeight, finalLiftRatio)
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
        val profileGlowColor = getProfileGlowColor()

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
            getProfileGlowStops(),
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

    private fun getProfileGlowColor(): Int {
        val tint = when (motionProfile) {
            MotionProfile.AMBIENT -> Color.rgb(100, 220, 255)  // Aurora - cyan-blue
            MotionProfile.PULSE -> Color.rgb(80, 255, 200)     // Neon - electric green-cyan
            MotionProfile.FIRE -> Color.rgb(255, 170, 70)      // Ember - warm amber
            MotionProfile.VELVET -> Color.rgb(220, 190, 255)   // Silk - soft lavender
            MotionProfile.COSMIC -> glowColor
        }
        return blendColors(glowColor, tint, 0.36f)
    }

    private fun getProfileGlowStops(): FloatArray {
        return when (motionProfile) {
            MotionProfile.AMBIENT -> floatArrayOf(0f, 0.12f, 0.88f, 1f)  // Aurora - wide soft spread
            MotionProfile.PULSE -> floatArrayOf(0f, 0.38f, 0.62f, 1f)   // Neon - tight concentrated
            MotionProfile.FIRE -> floatArrayOf(0f, 0.2f, 0.7f, 1f)     // Ember - trailing warmth
            MotionProfile.VELVET -> floatArrayOf(0f, 0.14f, 0.86f, 1f)  // Silk - very diffuse
            MotionProfile.COSMIC -> floatArrayOf(0f, 0.24f, 0.76f, 1f)
        }
    }

    private fun blendColors(from: Int, to: Int, amount: Float): Int {
        val t = amount.coerceIn(0f, 1f)
        val inv = 1f - t
        return Color.argb(
            ((Color.alpha(from) * inv) + (Color.alpha(to) * t)).toInt().coerceIn(0, 255),
            ((Color.red(from) * inv) + (Color.red(to) * t)).toInt().coerceIn(0, 255),
            ((Color.green(from) * inv) + (Color.green(to) * t)).toInt().coerceIn(0, 255),
            ((Color.blue(from) * inv) + (Color.blue(to) * t)).toInt().coerceIn(0, 255),
        )
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
        emitRetainedProfileAccent(
            currentTimeMs = currentTimeMs,
            line = line,
            words = words,
            sweepX = sweepX,
            rowHeight = rowHeight,
            translateY = translateY,
            glowProgress = glowProgress,
        )
        when (motionProfile) {
            MotionProfile.COSMIC -> {
                emitSpectralParticles(
                    currentTimeMs = currentTimeMs,
                    line = line,
                    words = words,
                    sweepX = sweepX,
                    glowProgress = glowProgress,
                    rowHeight = rowHeight,
                    translateY = translateY,
                )
                drawSweepStarDust(
                    canvas = canvas,
                    line = line,
                    words = words,
                    sweepX = sweepX,
                    glowProgress = glowProgress,
                    rowHeight = rowHeight,
                    translateY = translateY,
                )
            }
            MotionProfile.AMBIENT -> drawAmbientDrift(canvas, line, words, sweepX, glowProgress, rowHeight, translateY, currentTimeMs)
            MotionProfile.PULSE -> Unit
            MotionProfile.FIRE -> Unit
            MotionProfile.VELVET -> Unit
        }
    }

    private fun drawSweepStarDust(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (glowProgress <= 0.08f || words.isEmpty()) return
        val preset = motionProfile.preset

        val seed = (words.first().startMs % 997L).toFloat() * 0.013f
        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.34f + translateY
        val alphaBase = ((preset.starDustAlphaBase + preset.starDustAlphaRange * glowProgress) * preset.starDustAlphaMultiplier)
            .toInt()
            .coerceIn(0, preset.starDustAlphaClamp)
        val orbitX = LEADING_GLOW_WIDTH_PX * preset.glowWidthScale * (preset.starDustOrbitXBase + preset.starDustOrbitXRange * glowProgress)
        val orbitY = rowHeight * (preset.starDustOrbitYBase + preset.starDustOrbitYRange * glowProgress)

        sparklePaint.color = glowColor
        sparklePaint.setShadowLayer(
            rowHeight * preset.starDustShadowRadius,
            0f,
            0f,
            Color.argb((alphaBase * preset.starDustShadowBoost).toInt().coerceIn(0, preset.starDustShadowClamp), Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor))
        )

        for (index in 0 until preset.starDustCount) {
            val phase = glowProgress * preset.starDustPhaseSpeed + seed + index * preset.starDustPhaseStep
            val localAlpha = (alphaBase * (preset.starDustLocalAlphaBase - index * preset.starDustLocalAlphaDrop)).toInt().coerceIn(0, preset.starDustLocalAlphaClamp)
            if (localAlpha <= 0) continue

            val x = sweepX + cos(phase) * orbitX + index * density * preset.starDustDriftStepX
            val y = centerY + sin(phase * (preset.starDustWaveBase + index * preset.starDustWaveStep)) * orbitY - index * density * preset.starDustDriftStepY
            val radius = density * (preset.starDustRadiusBase + glowProgress * preset.starDustRadiusRange - index * preset.starDustRadiusDrop).coerceAtLeast(preset.starDustMinRadius)

            sparklePaint.alpha = localAlpha
            canvas.drawCircle(x, y, radius, sparklePaint)
            canvas.drawCircle(x, y, radius * 0.45f, sparklePaint)
        }

        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
    }

    private fun drawAmbientDrift(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
        currentTimeMs: Long,
    ) {
        if (glowProgress < 0.05f || words.isEmpty()) return

        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.34f + translateY
        val auroraColor = blendColors(glowColor, Color.rgb(100, 220, 255), 0.28f)
        sparklePaint.style = Paint.Style.STROKE
        sparklePaint.strokeCap = Paint.Cap.ROUND
        sparklePaint.color = auroraColor

        val rippleCount = 3
        val cycleDurationMs = 900f
        val phaseOffset = currentTimeMs % cycleDurationMs.toLong()
        
        for (i in 0 until rippleCount) {
            val ringPhase = ((phaseOffset + i * (cycleDurationMs / rippleCount)) % cycleDurationMs) / cycleDurationMs
            val expandProgress = ringPhase.coerceIn(0f, 1f)
            val maxRadius = rowHeight * (0.6f + glowProgress * 0.4f)
            val radius = maxRadius * expandProgress
            val fadeAlpha = (1f - expandProgress) * (1f - expandProgress)
            val alpha = (fadeAlpha * (40f + glowProgress * 55f)).toInt().coerceIn(0, 80)
            if (alpha <= 2) continue
            
            sparklePaint.alpha = alpha
            sparklePaint.strokeWidth = density * (2.8f - expandProgress * 1.8f).coerceAtLeast(0.6f)
            sparklePaint.setShadowLayer(
                density * (6f + glowProgress * 4f),
                0f,
                0f,
                Color.argb((alpha * 1.6f).toInt().coerceIn(0, 100), Color.red(auroraColor), Color.green(auroraColor), Color.blue(auroraColor))
            )
            
            canvas.drawOval(
                sweepX - radius * 1.3f,
                centerY - radius * 0.8f,
                sweepX + radius * 1.3f,
                centerY + radius * 0.8f,
                sparklePaint
            )
        }

        sparklePaint.style = Paint.Style.FILL
        val dotAlpha = (50f + glowProgress * 60f).toInt().coerceIn(0, 100)
        sparklePaint.alpha = dotAlpha
        sparklePaint.setShadowLayer(
            density * 8f,
            0f,
            0f,
            Color.argb((dotAlpha * 1.8f).toInt().coerceIn(0, 130), Color.red(auroraColor), Color.green(auroraColor), Color.blue(auroraColor))
        )
        canvas.drawCircle(sweepX, centerY, density * (2.2f + glowProgress * 1.5f), sparklePaint)
        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
        sparklePaint.style = Paint.Style.FILL
    }

    /**
     * Neon/Water wave accent — smooth sinusoidal water surface using sin²(x).
     *
     * Physics model: a water surface wave obeys y = A · sin²(kx − ωt).
     * sin²(θ) = (1 − cos(2θ)) / 2, which produces a perfectly smooth, never-bouncing
     * wave shape — the crests and troughs are rounded arcs, not sharp peaks.
     * The wave travels left-to-right with the music, so the phase advances with time.
     */
    private fun drawPulseRings(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
        currentTimeMs: Long,
    ) {
        if (glowProgress < 0.05f || words.isEmpty()) return

        val baseY = line.y + words.minOf { it.yOffset } + rowHeight * 0.88f + translateY
        val waveColor = blendColors(glowColor, Color.rgb(80, 255, 200), 0.24f)
        val crestColor = blendColors(glowColor, Color.rgb(200, 255, 240), 0.30f)
        val leftBound  = marginLeft + words.first().xOffset
        val rightBound = marginLeft + words.last().xOffset + words.last().width
        val clampedSweepX = sweepX.coerceIn(leftBound, rightBound)
        val trailLength = (rowHeight * 2.2f).coerceAtLeast(48f * density)
        val startX = (clampedSweepX - trailLength).coerceAtLeast(leftBound)
        if (clampedSweepX <= startX + density * 2f) return

        val seed = (words.first().startMs % 997L).toFloat() * 0.013f
        // ω: angular frequency in rad/ms ≈ 0.8 Hz — languid ocean swell
        val omega = 0.00502f
        // k: one full wave cycle per ~2.4 × trailLength — long, graceful waves
        val pathWidth = clampedSweepX - startX
        val k = 6.28318f / (pathWidth * 2.4f).coerceAtLeast(1f)
        // Amplitude: very subtle — just 8–13 % of row height
        val amplitude = rowHeight * (0.08f + glowProgress * 0.05f)
        val waveAlpha = (40f + glowProgress * 72f).toInt().coerceIn(0, 118)

        val wavePath = Path()
        val sampleCount = 32  // smooth enough at any trail length
        for (s in 0..sampleCount) {
            val t  = s.toFloat() / sampleCount.toFloat()   // 0 = tail, 1 = head
            val x  = startX + pathWidth * t
            // sin²(θ) = (1 − cos(2θ)) / 2  →  range [0, 1], always smooth
            val theta = k * (x - startX) - omega * currentTimeMs + seed
            val sinSq = (1f - cos(2f * theta)) * 0.5f
            // Map [0,1] to [-amplitude, +amplitude] centred on baseY
            val y = baseY - amplitude * (sinSq * 2f - 1f)
            // Fade the tail in smoothly so it doesn't pop in hard
            if (s == 0) wavePath.moveTo(x, y) else wavePath.lineTo(x, y)
        }

        sparklePaint.style = Paint.Style.STROKE
        sparklePaint.strokeCap = Paint.Cap.ROUND
        sparklePaint.strokeJoin = Paint.Join.ROUND
        sparklePaint.strokeWidth = density * (1.4f + glowProgress * 0.6f)
        sparklePaint.color = waveColor
        sparklePaint.alpha = waveAlpha
        sparklePaint.setShadowLayer(
            density * (4.5f + glowProgress * 3f),
            0f, 0f,
            Color.argb((waveAlpha * 1.4f).toInt().coerceIn(0, 140),
                Color.red(waveColor), Color.green(waveColor), Color.blue(waveColor))
        )
        canvas.drawPath(wavePath, sparklePaint)

        // Leading droplet — soft oval that rides the crest of the wave at sweepX
        val headTheta = k * pathWidth - omega * currentTimeMs + seed
        val headSinSq = (1f - cos(2f * headTheta)) * 0.5f
        val headY = baseY - amplitude * (headSinSq * 2f - 1f)
        val headAlpha = (70f + glowProgress * 80f).toInt().coerceIn(0, 160)
        sparklePaint.style = Paint.Style.FILL
        sparklePaint.color = crestColor
        sparklePaint.alpha = headAlpha
        sparklePaint.setShadowLayer(
            density * (6f + glowProgress * 4f),
            0f, 0f,
            Color.argb((headAlpha * 1.3f).toInt().coerceIn(0, 170),
                Color.red(crestColor), Color.green(crestColor), Color.blue(crestColor))
        )
        val rx = density * (2.6f + glowProgress * 0.8f)
        val ry = density * (1.8f + glowProgress * 0.5f)
        canvas.drawOval(clampedSweepX - rx, headY - ry, clampedSweepX + rx, headY + ry, sparklePaint)

        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
        sparklePaint.style = Paint.Style.FILL
        sparklePaint.strokeJoin = Paint.Join.MITER
    }

    /**
     * Word-synchronized parabolic bouncing ball.
     *
     * Physics:
     *   - One parabolic arc per word: launches at word[i].startMs, lands at word[i+1].startMs.
     *   - Arc shape: h(t) = 4 * arcHeight * t * (1-t)  where t is LOCAL arc progress [0,1].
     *   - Arc height scales with horizontal distance: arcH = clamp(dx * 0.30, 8dp, 52% rowH).
     *   - Ball is a PERFECT CIRCLE (drawCircle, never drawOval).
     *   - Trail samples the same parabolic formula so it traces the ball's real path.
     *   - Landing shadow: flat ellipse on the floor that shrinks as the ball rises.
     */
    private fun drawBouncingBallTrails(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        currentTimeMs: Long,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (words.isEmpty()) return

        val trailFadeMs = 1400L
        val ballColor  = blendColors(glowColor, Color.rgb(200, 255, 230), 0.36f)
        val trailColor = blendColors(glowColor, Color.rgb(80,  255, 200), 0.24f)
        val ballRadius = density * 3.8f
        val floorOffset = rowHeight * 0.85f

        val rows = words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            val rowEndMs   = rowWords.maxOf  { it.endMs }
            if (currentTimeMs < rowStartMs) continue
            if (currentTimeMs > rowEndMs + trailFadeMs) continue

            val floorY = line.y + rowY + floorOffset + translateY

            // Build one arc per word boundary -----------------------------------------
            // Arc i: from words[i].startMs to words[i+1].startMs
            // Last arc ends at words.last().endMs
            data class BounceArc(
                val startMs: Long, val endMs: Long,
                val x0: Float, val x1: Float, val arcH: Float,
            )
            val arcs = mutableListOf<BounceArc>()
            for (i in rowWords.indices) {
                val w        = rowWords[i]
                val x0       = marginLeft + w.xOffset
                val x1       = if (i < rowWords.lastIndex) marginLeft + rowWords[i + 1].xOffset
                               else marginLeft + w.xOffset + w.width
                val launchMs = w.startMs
                val landMs   = if (i < rowWords.lastIndex) rowWords[i + 1].startMs else w.endMs
                if (landMs <= launchMs) continue
                val dx   = (x1 - x0).coerceAtLeast(1f)
                val arcH = (dx * 0.30f).coerceIn(density * 8f, rowHeight * 0.52f)
                arcs += BounceArc(launchMs, landMs, x0, x1, arcH)
            }
            if (arcs.isEmpty()) continue

            // Evaluate the parabolic arc at any given time ----------------------------
            fun evalArc(arc: BounceArc, t: Long): Pair<Float, Float> {
                val dur = (arc.endMs - arc.startMs).toFloat().coerceAtLeast(1f)
                val p   = ((t - arc.startMs).toFloat() / dur).coerceIn(0f, 1f)
                val x   = arc.x0 + (arc.x1 - arc.x0) * p
                val y   = floorY - arc.arcH * 4f * p * (1f - p)
                return x to y
            }

            val currentArc = arcs.lastOrNull { currentTimeMs >= it.startMs }

            // Draw trail (samples from the same arcs) ---------------------------------
            val trailDuration  = (rowEndMs - rowStartMs).coerceAtLeast(1L)
            val trailStartMs   = (currentTimeMs - trailDuration / 3L).coerceAtLeast(rowStartMs)
            val trailEndMs     = currentTimeMs.coerceAtMost(rowEndMs)

            if (trailEndMs > trailStartMs) {
                sparklePaint.style      = Paint.Style.STROKE
                sparklePaint.strokeCap  = Paint.Cap.ROUND
                sparklePaint.strokeJoin = Paint.Join.ROUND
                sparklePaint.color      = trailColor

                var prevX = 0f; var prevY = 0f; var hasPrev = false
                val samples = 28

                for (s in 0..samples) {
                    val t         = s.toFloat() / samples
                    val sampleMs  = trailStartMs + ((trailEndMs - trailStartMs) * t).toLong()
                    val sampleArc = arcs.lastOrNull { sampleMs >= it.startMs } ?: continue
                    val (sx, sy)  = evalArc(sampleArc, sampleMs)

                    if (hasPrev) {
                        val age     = (currentTimeMs - sampleMs).toFloat() / (trailDuration / 3f)
                        val vis     = smootherStep((1f - age).coerceIn(0f, 1f))
                        val rowFade = if (currentTimeMs > rowEndMs)
                            (1f - ((currentTimeMs - rowEndMs).toFloat() / trailFadeMs)).coerceIn(0f, 1f)
                        else 1f
                        val alpha   = (105f * vis * rowFade).toInt().coerceIn(0, 120)
                        if (alpha > 2) {
                            sparklePaint.alpha       = alpha
                            sparklePaint.strokeWidth = density * (1.0f + vis * 1.4f)
                            sparklePaint.setShadowLayer(
                                density * (3f + vis * 3f), 0f, 0f,
                                Color.argb((alpha + 20).coerceIn(0, 140),
                                    Color.red(trailColor), Color.green(trailColor), Color.blue(trailColor))
                            )
                            canvas.drawLine(prevX, prevY, sx, sy, sparklePaint)
                        }
                    }
                    prevX = sx; prevY = sy; hasPrev = true
                }
            }

            // Draw ball head ----------------------------------------------------------
            if (currentTimeMs <= rowEndMs && currentArc != null) {
                val (headX, headY) = evalArc(currentArc, currentTimeMs)

                val dur      = (currentArc.endMs - currentArc.startMs).toFloat().coerceAtLeast(1f)
                val arcT     = ((currentTimeMs - currentArc.startMs).toFloat() / dur).coerceIn(0f, 1f)
                val height01 = 4f * arcT * (1f - arcT)   // 0 at launch/land, 1 at peak

                val ballAlpha = (155f + 55f * height01).toInt().coerceIn(0, 220)
                sparklePaint.style = Paint.Style.FILL
                sparklePaint.color = ballColor
                sparklePaint.alpha = ballAlpha
                sparklePaint.setShadowLayer(
                    density * (6f + 5f * height01), 0f, 0f,
                    Color.argb((ballAlpha * 1.2f).toInt().coerceIn(0, 240),
                        Color.red(ballColor), Color.green(ballColor), Color.blue(ballColor))
                )
                // Perfect circle — single radius, never distorted
                canvas.drawCircle(headX, headY, ballRadius, sparklePaint)

                // Landing shadow: flat ellipse on floor, vanishes as ball rises
                val shadowAlpha = (55f * (1f - height01)).toInt().coerceIn(0, 55)
                if (shadowAlpha > 4) {
                    val shadowRx = ballRadius * (0.45f + 0.55f * (1f - height01))
                    val shadowRy = density * 1.1f * (1f - height01 * 0.75f)
                    sparklePaint.clearShadowLayer()
                    sparklePaint.alpha = shadowAlpha
                    canvas.drawOval(
                        headX - shadowRx, floorY - shadowRy,
                        headX + shadowRx, floorY + shadowRy,
                        sparklePaint
                    )
                }
            }
        }

        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
        sparklePaint.style = Paint.Style.FILL
        sparklePaint.strokeJoin = Paint.Join.MITER
    }


    /**
     * Ember accent — drawn in real-time as the sweep advances over the active word group.
     * Draws a small hot-tip flare at the sweep point using the physics underline helper.
     */
    private fun drawFireTrails(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (glowProgress < 0.08f || words.isEmpty()) return

        val firstWord = words.first()
        val sourceWords = if (firstWord.isBackground) line.backgroundWords else line.words
        val rowStartWord = sourceWords
            .filter { it.yOffset == firstWord.yOffset && it.isBackground == firstWord.isBackground }
            .minByOrNull { it.xOffset }
            ?: firstWord
        val baseY = line.y + words.minOf { it.yOffset } + rowHeight * 0.82f + translateY
        val underlineLeft = marginLeft + rowStartWord.xOffset

        // Delegate to the physics underline — pass currentTimeMs = 0 so we use a stable seed
        // (the accent fires per-frame from drawSweepGlowForWords which has no currentTimeMs here)
        drawEmberUnderlinePhysics(
            canvas = canvas,
            fromX = underlineLeft,
            toX = sweepX,
            baseY = baseY,
            rowHeight = rowHeight,
            trailAlpha = (55f + glowProgress * 85f).toInt().coerceIn(0, 140),
            currentTimeMs = (words.first().startMs + (glowProgress * 1000f).toLong()),
            glowProgress = glowProgress,
        )
    }

    private fun drawContinuousFireTrails(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        currentTimeMs: Long,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (words.isEmpty()) return

        val lineFadeOutProgress = ((currentTimeMs - line.endMs).toFloat() / fireTrailFadeOutDurationMs).coerceIn(0f, 1f)
        val lineFadeOutEase = 1f - smootherStep(lineFadeOutProgress)
        if (currentTimeMs > line.endMs + fireTrailFadeOutDurationMs || lineFadeOutEase <= 0.01f) return

        val rows = words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            if (currentTimeMs < rowStartMs) continue

            val rowEndMs = rowWords.maxOf { it.endMs }
            val underlineLeft = marginLeft + rowWords.first().xOffset
            val rowRight = marginLeft + rowWords.maxOf { it.xOffset + it.width }
            val underlineRight = calculateContinuousSweepX(rowWords, currentTimeMs).coerceIn(underlineLeft, rowRight)
            if (underlineRight <= underlineLeft + density * 0.5f) continue

            val rowProgress = if (rowEndMs > rowStartMs) {
                ((currentTimeMs - rowStartMs).toFloat() / (rowEndMs - rowStartMs).toFloat()).coerceIn(0f, 1f)
            } else 1f

            val lineBaseY = line.y + rowY + rowHeight * 0.82f + translateY
            val compositeAlpha = ((136f * smootherStep(rowProgress)) * lineFadeOutEase).toInt().coerceIn(0, 140)
            if (compositeAlpha <= 2) continue

            drawEmberUnderlinePhysics(
                canvas = canvas,
                fromX = underlineLeft,
                toX = underlineRight,
                baseY = lineBaseY,
                rowHeight = rowHeight,
                trailAlpha = compositeAlpha,
                currentTimeMs = currentTimeMs,
                glowProgress = smootherStep(rowProgress),
            )
        }
    }

    /**
     * Lantern + Firefly effect for the FIRE motion profile.
     *
     *   1. LANTERN GLOW — a warm RadialGradient light cone that illuminates the text
     *      from below, making letters look lit by a hand-held lantern.
     *
     *   2. BIOLUMINESCENT TRAIL — short fading history of the firefly's path,
     *      drawn as stamp circles that decay quickly in radius and alpha.
     *
     *   3. FIREFLY ORB — a pulsing bright orb at the current sweep position,
     *      with an inner core and a diffuse outer aura, blinking ~1.4 Hz.
     */
    private fun drawContinuousFireLine(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        currentTimeMs: Long,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (words.isEmpty()) return

        // Early-out: if the entire LyricLine is long past, skip.
        // Per-row fading is handled independently below.
        if (currentTimeMs > line.endMs + 500L) return

        // Color palette — warm bioluminescent green-gold blended with album glow color
        val fireflyCore = blendColors(glowColor, Color.rgb(228, 255, 158), 0.22f)
        val fireflyMid  = blendColors(glowColor, Color.rgb(188, 255, 118), 0.18f)
        val lanternWarm = blendColors(glowColor, Color.rgb(255, 218, 128), 0.20f)

        // Per-row fade window: firefly vanishes this many ms after the row ends
        val rowFadeWindowMs = 400L

        val rows = words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            if (currentTimeMs < rowStartMs) continue

            val rowEndMs = rowWords.maxOf { it.endMs }
            // Skip rows that have fully faded out
            if (currentTimeMs > rowEndMs + rowFadeWindowMs) continue

            val rowLeft  = marginLeft + rowWords.first().xOffset
            val rowRight = marginLeft + rowWords.maxOf { it.xOffset + it.width }
            val sweepX   = calculateContinuousSweepX(rowWords, currentTimeMs).coerceIn(rowLeft, rowRight)
            if (sweepX <= rowLeft + density) continue

            val rowProgress = if (rowEndMs > rowStartMs)
                ((currentTimeMs - rowStartMs).toFloat() / (rowEndMs - rowStartMs)).coerceIn(0f, 1f)
            else 1f

            // Fade IN: first 10% of the row
            val appearT  = smootherStep((rowProgress.coerceAtMost(0.10f)) / 0.10f)
            // Fade OUT: after rowEndMs, fade over rowFadeWindowMs
            val fadeOutT = if (currentTimeMs > rowEndMs)
                1f - smootherStep(((currentTimeMs - rowEndMs).toFloat() / rowFadeWindowMs).coerceIn(0f, 1f))
            else 1f

            val baseY = line.y + rowY + rowHeight * 0.88f + translateY

            val masterAlpha = (appearT * fadeOutT).coerceIn(0f, 1f)
            if (masterAlpha <= 0.02f) continue

            // 1. Lantern glow — radiates FROM the firefly upward to the text ──────────
            // Center is at the firefly's position (baseY). A tall elliptical gradient
            // reaches upward so it bathes the characters above in warm light.
            val lanternRadius = rowHeight * (1.55f + rowProgress * 0.25f)
            val lanternAlpha  = (masterAlpha * 55f).toInt().coerceIn(0, 65)
            if (lanternAlpha > 3) {
                val lanternShader = RadialGradient(
                    sweepX, baseY,          // ← centered ON the firefly
                    lanternRadius,
                    intArrayOf(
                        Color.argb(lanternAlpha,
                            Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                        Color.argb(lanternAlpha / 3,
                            Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                        Color.argb(0, Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                    ),
                    floatArrayOf(0f, 0.48f, 1f),
                    Shader.TileMode.CLAMP
                )
                sparklePaint.style  = Paint.Style.FILL
                sparklePaint.shader = lanternShader
                sparklePaint.alpha  = 255
                sparklePaint.clearShadowLayer()
                // Draw a taller oval so the light reaches up into the text lines
                val halfW = lanternRadius
                val halfH = lanternRadius * 1.3f   // stretch upward
                canvas.drawOval(
                    sweepX - halfW, baseY - halfH,
                    sweepX + halfW, baseY + halfH * 0.4f,
                    sparklePaint
                )
                sparklePaint.shader = null
            }

            // 2. Bioluminescent trail — short decaying history -------------------------
            val trailDurationMs = 360L
            val trailSteps      = 16
            sparklePaint.style  = Paint.Style.FILL
            sparklePaint.shader = null

            for (step in 1..trailSteps) {
                val stepAge = step.toFloat() / trailSteps.toFloat()  // 0=newest, 1=oldest
                val stepMs  = currentTimeMs - (stepAge * trailDurationMs).toLong()
                if (stepMs < rowStartMs) continue
                val stepX = calculateContinuousSweepX(rowWords, stepMs).coerceIn(rowLeft, rowRight)
                if (stepX >= sweepX - density * 0.5f) continue
                val decay = 1f - stepAge
                val trailRadius = density * (1.5f + 1.6f * decay * decay)
                val trailAlpha  = (masterAlpha * decay * decay * 72f).toInt().coerceIn(0, 72)
                if (trailAlpha <= 2) continue
                val trailColor = blendColors(fireflyMid, Color.rgb(70, 150, 70), stepAge * 0.45f)
                sparklePaint.color = trailColor
                sparklePaint.alpha = trailAlpha
                sparklePaint.clearShadowLayer()
                canvas.drawCircle(stepX, baseY, trailRadius, sparklePaint)
            }

            // 3. Firefly orb — pulsing bioluminescent body ----------------------------
            if (currentTimeMs <= rowEndMs) {
                val phaseSeed   = (rowLeft * 0.041f) % 6.28318f
                val pulse       = (sin(currentTimeMs * 0.00880f + phaseSeed) + 1f) * 0.5f  // [0,1]

                // Outer diffuse aura
                val auraRadius  = density * (8.5f + 4.5f * pulse)
                val auraAlpha   = (masterAlpha * (28f + 20f * pulse)).toInt().coerceIn(0, 55)
                sparklePaint.style = Paint.Style.FILL
                sparklePaint.color = fireflyMid
                sparklePaint.alpha = auraAlpha
                sparklePaint.setShadowLayer(
                    auraRadius * 1.5f, 0f, 0f,
                    Color.argb((auraAlpha * 2f).toInt().coerceIn(0, 110),
                        Color.red(fireflyMid), Color.green(fireflyMid), Color.blue(fireflyMid))
                )
                canvas.drawCircle(sweepX, baseY, auraRadius * 0.52f, sparklePaint)

                // Inner bright core
                val coreRadius  = density * (2.6f + 1.2f * pulse)
                val coreAlpha   = (masterAlpha * (155f + 65f * pulse)).toInt().coerceIn(0, 240)
                sparklePaint.color = fireflyCore
                sparklePaint.alpha = coreAlpha
                sparklePaint.setShadowLayer(
                    coreRadius * 2.4f, 0f, 0f,
                    Color.argb((coreAlpha * 0.88f).toInt().coerceIn(0, 215),
                        Color.red(fireflyCore), Color.green(fireflyCore), Color.blue(fireflyCore))
                )
                canvas.drawCircle(sweepX, baseY, coreRadius, sparklePaint)
            }
        }

        sparklePaint.shader = null
        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
        sparklePaint.style = Paint.Style.FILL
    }


    private fun drawContinuousWaterTrails(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        currentTimeMs: Long,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (words.isEmpty()) return

        val lineFadeOutProgress = ((currentTimeMs - line.endMs).toFloat() / fireTrailFadeOutDurationMs).coerceIn(0f, 1f)
        val lineFadeOutEase = 1f - smootherStep(lineFadeOutProgress)
        if (currentTimeMs > line.endMs + fireTrailFadeOutDurationMs || lineFadeOutEase <= 0.01f) return

        val rows = words.groupBy { it.yOffset }
        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            if (currentTimeMs < rowStartMs) continue

            val rowEndMs = rowWords.maxOf { it.endMs }
            val underlineLeft = marginLeft + rowWords.first().xOffset
            val rowRight = marginLeft + rowWords.maxOf { it.xOffset + it.width }
            val underlineRight = calculateContinuousSweepX(rowWords, currentTimeMs).coerceIn(underlineLeft, rowRight)
            if (underlineRight <= underlineLeft + density * 0.5f) continue

            val rowProgress = if (rowEndMs > rowStartMs) {
                ((currentTimeMs - rowStartMs).toFloat() / (rowEndMs - rowStartMs).toFloat()).coerceIn(0f, 1f)
            } else 1f
            val alpha = ((118f * smootherStep(rowProgress)) * lineFadeOutEase).toInt().coerceIn(0, 136)
            if (alpha <= 2) continue

            drawEmberUnderlinePhysics(
                canvas = canvas,
                fromX = underlineLeft,
                toX = underlineRight,
                baseY = line.y + rowY + rowHeight * 0.82f + translateY,
                rowHeight = rowHeight,
                trailAlpha = alpha,
                currentTimeMs = currentTimeMs,
                glowProgress = smootherStep(rowProgress),
                coolColor = blendColors(glowColor, Color.rgb(60, 185, 255), 0.34f),
                midColor = blendColors(glowColor, Color.rgb(105, 225, 255), 0.28f),
                tipColor = blendColors(glowColor, Color.rgb(210, 250, 255), 0.22f),
            )
        }
    }

    /**
     * Physics-accurate ember underline renderer.
     *
     * Model: a burning ember trail has three distinct zones:
     *   1. COOL BASE (origin) — low temperature, dim orange, thick stroke, oscillates slowly
     *   2. BODY — medium temperature, amber, medium stroke, sinusoidal flicker
     *   3. HOT TIP (toX) — maximum temperature, bright white-yellow core, thinnest but most intense glow
     *
     * Implementation: We sample N points along [fromX, toX], apply per-point:
     *   - Vertical offset: A(x) * sin(ωt + kx) — standing wave on a string with damping A(x)
     *     where A(x) = max_amplitude * (1 - x_normalized)^0.6  (more flutter near tip)
     *   - Color: lerp(coolAmber, hotWhite, x_normalized^1.5)
     *   - Radius: r_base * (1 - x_normalized)^0.55 + r_min  (cubic taper)
     *   - Alpha: alpha_base * (0.35 + 0.65 * x_normalized)  (brighter toward tip)
     * Then we draw each segment as a filled circle (stamp technique) to achieve
     * true variable-width stroke that Android Paint doesn't support natively.
     */
    /**
     * Candle-flame underline renderer.
     *
     * Physics model based on a real candle flame:
     *
     *   1. THICKNESS — a candle flame is thickest in its middle and tapers to
     *      near-zero at both ends (the wick base and the flickering tip).
     *      We model this with a Gaussian-like bell curve: r(t) = rMax · e^(−k·(t−0.5)²)
     *      where t ∈ [0,1] is the position along the trail.
     *
     *   2. VERTICAL OSCILLATION — a candle flame has two superimposed motions:
     *      a) Slow sway: low-frequency (≈0.3 Hz) buoyancy-driven oscillation.
     *      b) Fast shimmer: high-frequency (≈8 Hz) micro-turbulence with tiny amplitude.
     *      Both amplitudes are very small — a real 3 cm flame sways only 1–2 mm.
     *      We scale this proportionally: maxAmpSlow ≈ 4 % of rowHeight.
     *
     *   3. COLOR — base is dim amber (cool), peak is warm gold (hot), tip is pale
     *      yellow-white (maximum temperature zone of a flame).
     *
     *   4. ALPHA — brighter at the center-peak, very transparent at both ends.
     */
    private fun drawEmberUnderlinePhysics(
        canvas: Canvas,
        fromX: Float,
        toX: Float,
        baseY: Float,
        rowHeight: Float,
        trailAlpha: Int,
        currentTimeMs: Long,
        glowProgress: Float,
        coolColor: Int? = null,
        midColor: Int? = null,
        tipColor: Int? = null,
    ) {
        val totalWidth = toX - fromX
        if (totalWidth < density * 2f || trailAlpha <= 2) return

        // --- Color palette ---
        val coolAmber = coolColor ?: blendColors(glowColor, Color.rgb(255, 130, 30), 0.30f)
        val midFlame  = midColor  ?: blendColors(glowColor, Color.rgb(255, 190, 70), 0.24f)
        val hotTip    = tipColor  ?: blendColors(glowColor, Color.rgb(255, 230, 155), 0.18f)

        // --- Phase seed (unique per line position, prevents synchronised flickering) ---
        val phaseSeed = (fromX * 0.037f) % 6.28318f

        // --- Dual-frequency oscillation parameters ---
        // Slow buoyancy sway: ~0.35 Hz
        val omegaSlow = 0.00220f
        // Fast micro-turbulence: ~7 Hz
        val omegaFast = 0.04398f
        // Amplitudes — small and pleasant
        val ampSlow = density * (1.6f + glowProgress * 0.8f)   // ≈ 3–5 % rowHeight
        val ampFast = density * (0.4f + glowProgress * 0.3f)   // tiny shimmer

        // --- Stamp density: one circle per ~1.6 px ---
        val stepPx = density * 1.6f
        val steps  = ((totalWidth / stepPx).toInt()).coerceIn(2, 300)

        // Bell-curve shape coefficient: controls how quickly radius falls off from centre
        // higher k = narrower flame body (use 6–9 for candle-like)
        val bellK = 7.5f

        // Maximum radius at the centre of the flame
        val rMax = density * (1.6f + glowProgress * 0.5f)
        val rMin = density * 0.3f

        sparklePaint.style = Paint.Style.FILL
        sparklePaint.clearShadowLayer()

        for (i in 0..steps) {
            val t = i.toFloat() / steps.toFloat()   // 0 = left (base), 1 = right (tip)
            val x = fromX + t * totalWidth

            // --- Bell-curve radius ---
            val dt = t - 0.5f   // distance from centre, ∈ [−0.5, 0.5]
            val bellFactor = kotlin.math.exp((-bellK * dt * dt).toDouble()).toFloat()
            val radius = rMin + (rMax - rMin) * bellFactor

            // --- Vertical oscillation (2 superimposed waves, both gentle) ---
            val phaseSlow = omegaSlow * currentTimeMs + phaseSeed
            val phaseFast = omegaFast * currentTimeMs + phaseSeed * 1.7f
            // Oscillation is strongest near the tip (t → 1) — flame tip sways the most
            val oscEnvelope = t.pow(0.7f).coerceIn(0f, 1f)
            val yOffset = (sin(phaseSlow) * ampSlow + sin(phaseFast) * ampFast) * oscEnvelope
            val y = baseY + yOffset

            // --- Alpha: bell-shaped, matching the thickness ---
            val alphaT = 0.22f + 0.78f * bellFactor
            val pointAlpha = (trailAlpha * alphaT).toInt().coerceIn(0, 255)
            if (pointAlpha <= 1) continue

            // --- Color through three stops ---
            val pointColor = when {
                t < 0.42f -> blendColors(coolAmber, midFlame, t / 0.42f)
                else      -> blendColors(midFlame, hotTip, (t - 0.42f) / 0.58f)
            }

            sparklePaint.color = pointColor
            sparklePaint.alpha = pointAlpha

            // Shadow every 4th stamp (keeps GPU load low, flame still glows)
            if (i % 4 == 0) {
                val shadowAlpha = (pointAlpha * (0.6f + bellFactor * 0.7f)).toInt().coerceIn(0, 160)
                sparklePaint.setShadowLayer(
                    radius * (1.8f + bellFactor),
                    0f, 0f,
                    Color.argb(shadowAlpha, Color.red(pointColor), Color.green(pointColor), Color.blue(pointColor))
                )
            } else {
                sparklePaint.clearShadowLayer()
            }

            canvas.drawCircle(x, y, radius, sparklePaint)
        }

        // --- Tip flare: soft glow at the leading edge ---
        val tipPhaseSlow = omegaSlow * currentTimeMs + phaseSeed
        val tipPhaseFast = omegaFast * currentTimeMs + phaseSeed * 1.7f
        val tipY = baseY + sin(tipPhaseSlow) * ampSlow + sin(tipPhaseFast) * ampFast
        val tipFlareRadius = density * (1.4f + glowProgress * 0.8f)
        val tipFlareAlpha  = (trailAlpha * 0.88f).toInt().coerceIn(0, 210)
        sparklePaint.color = hotTip
        sparklePaint.alpha = tipFlareAlpha
        sparklePaint.setShadowLayer(
            tipFlareRadius * 2.2f, 0f, 0f,
            Color.argb((tipFlareAlpha * 0.9f).toInt().coerceIn(0, 200),
                Color.red(hotTip), Color.green(hotTip), Color.blue(hotTip))
        )
        canvas.drawCircle(toX, tipY, tipFlareRadius, sparklePaint)

        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
        sparklePaint.style = Paint.Style.FILL
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

    private fun drawVelvetRibbon(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
        currentTimeMs: Long,
    ) {
        if (glowProgress < 0.06f || words.isEmpty()) return

        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.34f + translateY
        val silkColor = blendColors(glowColor, Color.rgb(220, 190, 255), 0.22f)
        val silkInnerColor = blendColors(glowColor, Color.rgb(240, 220, 255), 0.18f)

        sparklePaint.style = Paint.Style.FILL
        sparklePaint.color = silkColor

        val breathSlow = (sin(currentTimeMs * 0.0012f) * 0.5f + 0.5f)
        val outerRadius = rowHeight * (0.55f + breathSlow * 0.15f + glowProgress * 0.25f)
        val outerAlpha = (18f + glowProgress * 28f).toInt().coerceIn(0, 52)
        sparklePaint.alpha = outerAlpha
        sparklePaint.setShadowLayer(
            outerRadius * 0.9f,
            0f,
            0f,
            Color.argb((outerAlpha * 1.4f).toInt().coerceIn(0, 72), Color.red(silkColor), Color.green(silkColor), Color.blue(silkColor))
        )
        canvas.drawCircle(sweepX, centerY, outerRadius, sparklePaint)

        val breathFast = (sin(currentTimeMs * 0.002f + 1.2f) * 0.5f + 0.5f)
        val midRadius = rowHeight * (0.28f + breathFast * 0.1f + glowProgress * 0.12f)
        val midAlpha = (28f + glowProgress * 38f).toInt().coerceIn(0, 68)
        sparklePaint.color = silkInnerColor
        sparklePaint.alpha = midAlpha
        sparklePaint.setShadowLayer(
            midRadius * 0.7f,
            0f,
            0f,
            Color.argb((midAlpha * 1.3f).toInt().coerceIn(0, 85), Color.red(silkInnerColor), Color.green(silkInnerColor), Color.blue(silkInnerColor))
        )
        val driftX = sin(currentTimeMs * 0.0008f) * density * 2f
        val driftY = cos(currentTimeMs * 0.0006f) * density * 1.2f
        canvas.drawCircle(sweepX + driftX, centerY + driftY, midRadius, sparklePaint)

        val coreRadius = density * (2.5f + glowProgress * 1.8f + breathSlow * 0.8f)
        val coreAlpha = (35f + glowProgress * 45f).toInt().coerceIn(0, 80)
        sparklePaint.alpha = coreAlpha
        sparklePaint.setShadowLayer(
            density * 6f,
            0f,
            0f,
            Color.argb((coreAlpha * 1.6f).toInt().coerceIn(0, 110), Color.red(silkInnerColor), Color.green(silkInnerColor), Color.blue(silkInnerColor))
        )
        canvas.drawCircle(sweepX, centerY, coreRadius, sparklePaint)

        sparklePaint.clearShadowLayer()
        sparklePaint.alpha = 255
    }

    private fun emitSpectralParticles(
        currentTimeMs: Long,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
    ) {
        if (!enableSpectralParticles || glowProgress <= 0.12f || words.isEmpty()) return
        val preset = motionProfile.preset

        val firstWord = words.first()
        val lastWord = words.last()
        val emissionKey = firstWord.startMs * 31L + lastWord.endMs * 17L + if (firstWord.isBackground) 7L else 0L
        val baseBucketSizeMs = if (firstWord.isBackground) 180L else 120L
        val bucketSizeMs = (baseBucketSizeMs * preset.particleBucketScale).toLong().coerceAtLeast(50L)
        val bucket = currentTimeMs / bucketSizeMs
        if (particleEmissionBuckets[emissionKey] == bucket) return
        particleEmissionBuckets[emissionKey] = bucket

        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.26f + translateY
        val baseSeed = ((emissionKey % 4096L).toFloat() * 0.017f) + glowProgress * 2.4f + bucket * 0.19f
        val emissionCount = if (glowProgress > 0.58f) preset.particleEmissionHigh else preset.particleEmissionLow
        val horizontalSpread = rowHeight * (if (firstWord.isBackground) 0.1f else 0.16f) * preset.particleSpreadX
        val verticalSpread = rowHeight * (if (firstWord.isBackground) 0.06f else 0.1f) * preset.particleSpreadY

        repeat(emissionCount) { index ->
            val particle = suspendedParticles.firstOrNull { !it.active } ?: return@repeat
            val phase = baseSeed + index * 1.73f
            val lifetimeMs = (preset.particleLifetimeBaseMs + ((sin(phase) * 0.5f + 0.5f) * preset.particleLifetimeRangeMs).toLong())
                .coerceIn(preset.particleLifetimeMinMs, preset.particleLifetimeMaxMs)
            val brightness = (0.78f + 0.22f * ((cos(phase * 1.41f) * 0.5f) + 0.5f)).coerceIn(0.78f, 1f)
            val alpha = (((if (firstWord.isBackground) 84f else 112f) * brightness) * preset.particleAlphaMultiplier).toInt().coerceIn(48, preset.particleAlphaClamp)
            val radius = density * (((if (firstWord.isBackground) 0.95f else 1.2f) + ((sin(phase * 0.83f) * 0.5f) + 0.5f) * 1.5f) * preset.particleRadiusScale)
            val blur = rowHeight * (((if (firstWord.isBackground) 0.04f else 0.05f) + ((cos(phase * 1.13f) * 0.5f) + 0.5f) * 0.035f) * preset.particleBlurScale)
            val offsetX = cos(phase) * horizontalSpread + sin(phase * 0.51f) * density * 3.5f * preset.particleOffsetXScale
            val offsetY = sin(phase * 1.27f) * verticalSpread - rowHeight * 0.04f * preset.particleOffsetYScale
            val driftX = cos(phase * 0.73f) * density * 7.5f * preset.particleDriftXScale
            val driftY = -(rowHeight * (0.12f + (((sin(phase * 1.57f) * 0.5f) + 0.5f) * 0.14f)) * preset.particleRiseScale)
            val wobbleAmplitude = density * (2.4f + ((cos(phase * 0.67f) * 0.5f) + 0.5f) * 4.8f) * preset.particleWobbleAmplitudeScale
            val wobbleFrequency = (0.85f + (((sin(phase * 0.93f) * 0.5f) + 0.5f) * 1.15f)) * preset.particleWobbleFrequencyScale

            particle.active = true
            particle.x = sweepX + offsetX
            particle.y = centerY + offsetY
            particle.startMs = currentTimeMs
            particle.endMs = currentTimeMs + lifetimeMs
            particle.driftX = driftX
            particle.driftY = driftY
            particle.radius = radius
            particle.alpha = alpha
            particle.blurRadius = blur
            particle.wobbleAmplitude = wobbleAmplitude
            particle.wobbleFrequency = wobbleFrequency
            particle.seed = phase
            particle.color = glowColor
        }
    }

    private fun drawSuspendedSpectralParticles(canvas: Canvas, currentTimeMs: Long) {
        if (!enableSpectralParticles) return

        for (particle in suspendedParticles) {
            if (!particle.active) continue
            if (currentTimeMs >= particle.endMs) {
                particle.active = false
                continue
            }

            val duration = (particle.endMs - particle.startMs).coerceAtLeast(1L).toFloat()
            val progress = ((currentTimeMs - particle.startMs).coerceAtLeast(0L).toFloat() / duration).coerceIn(0f, 1f)
            val fadeIn = (progress / 0.18f).coerceIn(0f, 1f)
            val fadeOut = (1f - ((progress - 0.58f) / 0.42f).coerceIn(0f, 1f))
            val lifeAlpha = (fadeIn * fadeOut).coerceIn(0f, 1f)
            if (lifeAlpha <= 0.01f) continue

            val riseEase = 1f - (1f - progress) * (1f - progress)
            val driftX = particle.driftX * progress
            val driftY = particle.driftY * riseEase
            val wobble = sin(progress * particle.wobbleFrequency * 6.28318f + particle.seed) * particle.wobbleAmplitude * (1f - progress * 0.55f)
            val x = particle.x + driftX + wobble
            val y = particle.y + driftY
            val alpha = (particle.alpha * lifeAlpha).toInt().coerceIn(0, 160)
            val outerRadius = particle.radius * (0.95f + 0.38f * riseEase)
            val coreRadius = outerRadius * 0.42f

            particlePaint.color = particle.color
            particlePaint.alpha = alpha
            particlePaint.setShadowLayer(
                particle.blurRadius * (0.85f + 0.25f * riseEase),
                0f,
                0f,
                Color.argb((alpha * 1.7f).toInt().coerceIn(0, 150), Color.red(particle.color), Color.green(particle.color), Color.blue(particle.color))
            )
            canvas.drawCircle(x, y, outerRadius, particlePaint)

            particlePaint.clearShadowLayer()
            particlePaint.alpha = (alpha * 0.95f).toInt().coerceIn(0, 255)
            canvas.drawCircle(x, y, coreRadius, particlePaint)

            val sparkleAlpha = (alpha * 0.34f).toInt().coerceIn(0, 96)
            particlePaint.alpha = sparkleAlpha
            canvas.drawCircle(x + outerRadius * 0.9f, y - outerRadius * 0.72f, coreRadius * 0.52f, particlePaint)
        }

        particlePaint.clearShadowLayer()
        particlePaint.alpha = 255
    }

    private fun emitRetainedProfileAccent(
        currentTimeMs: Long,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        rowHeight: Float,
        translateY: Float,
        glowProgress: Float,
    ) {
        if (!enableSpectralParticles || words.isEmpty() || glowProgress < 0.1f) return
        // Leave cosmic/stardust untouched: user prefers the original behavior.
        if (motionProfile == MotionProfile.COSMIC || motionProfile == MotionProfile.FIRE || motionProfile == MotionProfile.PULSE || motionProfile == MotionProfile.VELVET) return

        val firstWord = words.first()
        val lastWord = words.last()
        val emissionKey =
            firstWord.startMs * 29L +
                lastWord.endMs * 37L +
                motionProfile.ordinal * 97L +
                if (firstWord.isBackground) 13L else 0L
        val bucketSizeMs = when (motionProfile) {
            MotionProfile.PULSE -> 135L
            MotionProfile.FIRE -> 120L
            MotionProfile.COSMIC -> 125L
            MotionProfile.AMBIENT -> 190L
            MotionProfile.VELVET -> 210L
        }
        val bucket = currentTimeMs / bucketSizeMs
        if (retainedAccentEmissionBuckets[emissionKey] == bucket) return
        retainedAccentEmissionBuckets[emissionKey] = bucket

        val baseY = line.y + words.minOf { it.yOffset } + rowHeight * 0.33f + translateY
        val baseSeed = ((emissionKey % 1009L).toFloat() * 0.011f) + bucket * 0.17f + glowProgress * 2.1f
        val emissionCount = 1
        repeat(emissionCount) { index ->
            val accent = retainedProfileAccents.firstOrNull { !it.active } ?: return@repeat
            val phase = baseSeed + index * 1.93f
            val profileColor = getProfileGlowColor()
            val lifetimeMs = when (motionProfile) {
                MotionProfile.AMBIENT -> 1700L
                MotionProfile.PULSE -> 2000L
                MotionProfile.FIRE -> 1500L
                MotionProfile.VELVET -> 1850L
                MotionProfile.COSMIC -> 2000L
            }
            val baseSize = when (motionProfile) {
                MotionProfile.AMBIENT -> rowHeight * 0.52f
                MotionProfile.PULSE -> rowHeight * 0.36f
                MotionProfile.FIRE -> rowHeight * 0.3f
                MotionProfile.VELVET -> rowHeight * 0.42f
                MotionProfile.COSMIC -> rowHeight * 0.52f
            }

            accent.active = true
            accent.profile = motionProfile
            accent.startMs = currentTimeMs
            accent.endMs = currentTimeMs + lifetimeMs
            accent.x = sweepX + sin(phase) * rowHeight * 0.14f
            accent.y = baseY - rowHeight * 0.08f + cos(phase * 1.23f) * rowHeight * 0.06f
            accent.driftX = when (motionProfile) {
                MotionProfile.AMBIENT -> cos(phase * 0.7f) * density * 2.8f
                MotionProfile.PULSE -> cos(phase * 0.54f) * density * 1.1f
                MotionProfile.FIRE -> cos(phase * 0.9f) * density * 0.8f
                MotionProfile.VELVET -> cos(phase * 0.42f) * density * 1.9f
                MotionProfile.COSMIC -> cos(phase * 0.8f) * density * 5.1f
            }
            accent.driftY = when (motionProfile) {
                MotionProfile.AMBIENT -> -rowHeight * 0.1f
                MotionProfile.PULSE -> -rowHeight * 0.03f
                MotionProfile.FIRE -> -rowHeight * 0.24f
                MotionProfile.VELVET -> -rowHeight * 0.06f
                MotionProfile.COSMIC -> -rowHeight * 0.24f
            }
            accent.size = baseSize * (0.84f + ((sin(phase * 1.37f) * 0.5f + 0.5f) * 0.22f))
            accent.alpha = when (motionProfile) {
                MotionProfile.AMBIENT -> 36
                MotionProfile.PULSE -> 60
                MotionProfile.FIRE -> 58
                MotionProfile.VELVET -> 44
                MotionProfile.COSMIC -> 102
            }
            accent.strokeWidth = density * when (motionProfile) {
                MotionProfile.AMBIENT -> 1.4f
                MotionProfile.PULSE -> 1.3f
                MotionProfile.FIRE -> 1.5f
                MotionProfile.VELVET -> 1.6f
                MotionProfile.COSMIC -> 1.9f
            }
            accent.blurRadius = rowHeight * when (motionProfile) {
                MotionProfile.AMBIENT -> 0.06f
                MotionProfile.PULSE -> 0.05f
                MotionProfile.FIRE -> 0.05f
                MotionProfile.VELVET -> 0.06f
                MotionProfile.COSMIC -> 0.08f
            }
            accent.seed = phase
            accent.color = profileColor
        }
    }

    private fun drawRetainedProfileAccents(canvas: Canvas, currentTimeMs: Long) {
        if (!enableSpectralParticles) return

        for (accent in retainedProfileAccents) {
            if (!accent.active) continue
            if (currentTimeMs >= accent.endMs) {
                accent.active = false
                continue
            }

            val duration = (accent.endMs - accent.startMs).coerceAtLeast(1L).toFloat()
            val progress = ((currentTimeMs - accent.startMs).coerceAtLeast(0L).toFloat() / duration).coerceIn(0f, 1f)
            val fadeIn = (progress / 0.16f).coerceIn(0f, 1f)
            val fadeOut = (1f - ((progress - 0.56f) / 0.44f).coerceIn(0f, 1f))
            val lifeAlpha = (fadeIn * fadeOut).coerceIn(0f, 1f)
            if (lifeAlpha <= 0.02f) continue

            val x = accent.x + accent.driftX * progress + sin(progress * 6.28318f + accent.seed) * density * 1.7f
            val y = accent.y + accent.driftY * (0.2f + progress * 0.8f)
            val alpha = (accent.alpha * lifeAlpha).toInt().coerceIn(0, 92)
            val color = accent.color

            when (accent.profile) {
                MotionProfile.AMBIENT -> {
                    // Aurora Retained - fading ripple ring expanding outward
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.STROKE
                    particlePaint.strokeCap = Paint.Cap.ROUND
                    val life = 1f - progress
                    val ringAlpha = (alpha * life * life * 0.7f).toInt().coerceIn(0, 55)
                    particlePaint.alpha = ringAlpha
                    particlePaint.strokeWidth = density * (1.6f * life).coerceAtLeast(0.4f)
                    
                    val ringRadius = accent.size * (0.2f + progress * 0.6f)
                    particlePaint.setShadowLayer(
                        density * 5f * life,
                        0f,
                        0f,
                        Color.argb((ringAlpha * 1.5f).toInt().coerceIn(0, 70), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawOval(
                        x - ringRadius * 1.3f,
                        y - ringRadius * 0.8f,
                        x + ringRadius * 1.3f,
                        y + ringRadius * 0.8f,
                        particlePaint
                    )
                }
                MotionProfile.PULSE -> {
                    // Neon Retained - flickering electric spark point
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val flicker = (sin(progress * 18f + accent.seed * 3f) * 0.5f + 0.5f)
                    val sparkAlpha = (alpha * life * flicker * 0.9f).toInt().coerceIn(0, 70)
                    particlePaint.alpha = sparkAlpha
                    
                    particlePaint.setShadowLayer(
                        accent.size * 0.3f * life,
                        0f,
                        0f,
                        Color.argb((sparkAlpha * 1.8f).toInt().coerceIn(0, 100), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, y, accent.size * 0.1f * life, particlePaint)
                    
                    if (sparkAlpha > 15) {
                        particlePaint.style = Paint.Style.STROKE
                        particlePaint.strokeWidth = density * 0.8f * life
                        val armLength = accent.size * 0.15f * life
                        canvas.drawLine(x - armLength, y, x + armLength, y, particlePaint)
                        canvas.drawLine(x, y - armLength * 0.7f, x, y + armLength * 0.7f, particlePaint)
                    }
                }
                MotionProfile.FIRE -> {
                    // Ember Retained - rising glowing dot
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val riseY = y - progress * accent.size * 0.8f
                    val emberAlpha = (alpha * life * life * 0.8f).toInt().coerceIn(0, 60)
                    particlePaint.alpha = emberAlpha
                    
                    particlePaint.setShadowLayer(
                        density * (3f + life * 3f),
                        0f,
                        0f,
                        Color.argb((emberAlpha * 1.6f).toInt().coerceIn(0, 80), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, riseY, accent.size * 0.08f * (0.4f + life * 0.6f), particlePaint)
                }
                MotionProfile.VELVET -> {
                    // Silk Retained - soft dissolving bloom circle
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val bloomRadius = accent.size * (0.15f + progress * 0.25f)
                    val bloomAlpha = (alpha * life * life * 0.6f).toInt().coerceIn(0, 50)
                    particlePaint.alpha = bloomAlpha
                    
                    particlePaint.setShadowLayer(
                        bloomRadius * 0.9f,
                        0f,
                        0f,
                        Color.argb((bloomAlpha * 1.3f).toInt().coerceIn(0, 65), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, y, bloomRadius, particlePaint)
                }
                MotionProfile.COSMIC -> {
                    continue
                }
            }
        }

        particlePaint.clearShadowLayer()
        particlePaint.alpha = 255
        particlePaint.style = Paint.Style.FILL
        particlePaint.strokeCap = Paint.Cap.BUTT
        particlePaint.strokeJoin = Paint.Join.MITER
    }

    private fun clearSpectralParticles() {
        for (particle in suspendedParticles) {
            particle.active = false
        }
        for (accent in retainedProfileAccents) {
            accent.active = false
        }
        particleEmissionBuckets.clear()
        retainedAccentEmissionBuckets.clear()
    }

    private fun drawVisualWordCharactersWithLift(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
    ) {
        if (words.isEmpty()) return

        val visualWordDurationMs = (words.last().endMs - words.first().startMs).coerceAtLeast(1L).toFloat()
        val charCount = words.sumOf { word ->
            word.text.count { char -> !char.isWhitespace() }
        }.coerceAtLeast(1)
        val durationProgress = ((visualWordDurationMs - 1000f) / 4000f).coerceIn(0f, 1f)
        val durationEase = durationProgress * durationProgress * durationProgress
        val isLongWord = charCount > 5
        val isShortDuration = visualWordDurationMs < 1500f
        var maxDecayRate = 0f
        if (isLongWord || isShortDuration) {
            var decayStrength = 0f
            if (isLongWord) {
                decayStrength += (((charCount - 5).toFloat() / 3f).coerceIn(0f, 1f)) * 0.4f
            }
            if (isShortDuration) {
                decayStrength += ((1f - ((visualWordDurationMs - 1000f) / 500f)).coerceIn(0f, 1f)) * 0.4f
            }
            maxDecayRate = decayStrength.coerceAtMost(0.85f)
        }
        var drawableIndex = 0

        for (word in words) {
            var cursorX = marginLeft + word.xOffset
            val baseY = line.y + word.yOffset + rowHeight * 0.7f

            for (char in word.text) {
                val charText = char.toString()
                val charWidth = paint.measureText(charText)

                if (char.isWhitespace()) {
                    cursorX += charWidth
                    continue
                }

                val startRatio = drawableIndex.toFloat() / charCount.toFloat()
                val localProgress = ((progress - startRatio) / (1f / charCount.toFloat())).coerceIn(0f, 1f)
                val charPosition = if (charCount > 1) drawableIndex.toFloat() / (charCount - 1).toFloat() else 0f
                val decayFactor = 1f - charPosition * maxDecayRate
                val charEnergy = durationEase * decayFactor
                val baseGrowth = if (charCount <= 3) 0.07f else 0.05f
                val charMaxScale = 1f + baseGrowth + charEnergy * 0.1f
                val riseProgress = (localProgress / 0.56f).coerceIn(0f, 1f)
                val riseEase = smootherStep(riseProgress)
                val settleProgress = ((localProgress - 0.56f) / 0.44f).coerceIn(0f, 1f)
                val settleEase = smootherStep(settleProgress)
                val liftEnvelope = (riseEase * (1f - 0.76f * settleEase)).coerceIn(0f, 1f)
                val scaleEnvelope = (riseEase * (1f - settleEase)).coerceIn(0f, 1f)
                val shadowEnvelope = (riseEase * (1f - 0.92f * settleEase)).coerceIn(0f, 1f)
                val shadowIntensity = (0.28f + charEnergy * 0.34f) * shadowEnvelope
                val normalizedGrowth = ((charMaxScale - 1f) / 0.13f).coerceIn(0f, 1.4f)
                val extraTranslateY = -normalizedGrowth * 6f * density * (1f - settleEase)
                val scale = 1f + (charMaxScale - 1f) * scaleEnvelope
                val translateY = -rowHeight * finalLiftRatio * liftEnvelope + extraTranslateY * scaleEnvelope
                val horizontalOffset = ((charPosition - 0.5f) * 2f) * ((charMaxScale - 1f) * 25f * density) * scaleEnvelope
                val originalAlpha = paint.alpha

                canvas.save()
                paint.setShadowLayer(
                    rowHeight * 0.055f * (0.7f + scaleEnvelope * 0.7f),
                    0f,
                    0f,
                    Color.argb(
                        (255f * shadowIntensity).toInt().coerceIn(0, 110),
                        Color.red(glowColor),
                        Color.green(glowColor),
                        Color.blue(glowColor)
                    )
                )
                paint.alpha = (originalAlpha * (0.97f + 0.03f * scaleEnvelope)).toInt().coerceIn(0, 255)
                canvas.translate(horizontalOffset, translateY)
                canvas.scale(scale, scale, cursorX + charWidth * 0.5f, baseY - rowHeight * 0.32f)
                canvas.drawText(charText, cursorX, baseY, paint)
                canvas.restore()
                paint.clearShadowLayer()
                paint.alpha = originalAlpha

                cursorX += charWidth
                drawableIndex += 1
            }
        }
    }

    private class SuspendedParticle {
        var active: Boolean = false
        var x: Float = 0f
        var y: Float = 0f
        var startMs: Long = 0L
        var endMs: Long = 0L
        var driftX: Float = 0f
        var driftY: Float = 0f
        var radius: Float = 0f
        var alpha: Int = 0
        var blurRadius: Float = 0f
        var wobbleAmplitude: Float = 0f
        var wobbleFrequency: Float = 0f
        var seed: Float = 0f
        var color: Int = Color.WHITE
    }

    private class RetainedProfileAccent {
        var active: Boolean = false
        var profile: MotionProfile = MotionProfile.COSMIC
        var x: Float = 0f
        var y: Float = 0f
        var startMs: Long = 0L
        var endMs: Long = 0L
        var driftX: Float = 0f
        var driftY: Float = 0f
        var size: Float = 0f
        var alpha: Int = 0
        var strokeWidth: Float = 0f
        var blurRadius: Float = 0f
        var seed: Float = 0f
        var color: Int = Color.WHITE
    }

    companion object {
        private const val MAX_SPECTRAL_PARTICLES = 32
        private const val MAX_RETAINED_PROFILE_ACCENTS = 128
    }

    private enum class MotionProfile(val preset: MotionProfilePreset) {
        AMBIENT(
            MotionProfilePreset(
                glowAlphaBase = 16f,
                glowAlphaRange = 24f,
                glowAlphaMultiplier = 0.88f,
                glowAlphaClamp = 56,
                glowRadiusBase = 0.1f,
                glowRadiusRange = 0.06f,
                glowWidthScale = 1.28f,
                glowBandStartScale = 1.34f,
                glowBandEndScale = 0.82f,
                glowFadeScale = 1.15f,
                glowShadowBoost = 1.45f,
                glowShadowClamp = 90,
                starDustCount = 3,
                starDustAlphaBase = 18f,
                starDustAlphaRange = 34f,
                starDustAlphaMultiplier = 0.78f,
                starDustAlphaClamp = 68,
                starDustOrbitXBase = 0.86f,
                starDustOrbitXRange = 0.48f,
                starDustOrbitYBase = 0.17f,
                starDustOrbitYRange = 0.12f,
                starDustShadowRadius = 0.05f,
                starDustShadowBoost = 1.75f,
                starDustShadowClamp = 84,
                starDustPhaseSpeed = 4.8f,
                starDustPhaseStep = 1.11f,
                starDustLocalAlphaBase = 0.84f,
                starDustLocalAlphaDrop = 0.18f,
                starDustLocalAlphaClamp = 58,
                starDustWaveBase = 0.94f,
                starDustWaveStep = 0.04f,
                starDustRadiusBase = 0.9f,
                starDustRadiusRange = 0.72f,
                starDustRadiusDrop = 0.14f,
                starDustMinRadius = 0.5f,
                starDustDriftStepX = 0.75f,
                starDustDriftStepY = 1.2f,
                particleBucketScale = 1.5f,
                particleEmissionLow = 1,
                particleEmissionHigh = 1,
                particleSpreadX = 1.34f,
                particleSpreadY = 1.2f,
                particleLifetimeBaseMs = 1500L,
                particleLifetimeRangeMs = 1200f,
                particleLifetimeMinMs = 1400L,
                particleLifetimeMaxMs = 2700L,
                particleAlphaMultiplier = 0.82f,
                particleAlphaClamp = 112,
                particleRadiusScale = 1.08f,
                particleBlurScale = 1.18f,
                particleOffsetXScale = 0.9f,
                particleOffsetYScale = 0.72f,
                particleDriftXScale = 0.72f,
                particleRiseScale = 1.46f,
                particleWobbleAmplitudeScale = 1.28f,
                particleWobbleFrequencyScale = 0.88f,
            )
        ),
        PULSE(
            MotionProfilePreset(
                glowAlphaBase = 24f,
                glowAlphaRange = 36f,
                glowAlphaMultiplier = 1.02f,
                glowAlphaClamp = 78,
                glowRadiusBase = 0.092f,
                glowRadiusRange = 0.05f,
                glowWidthScale = 1.02f,
                glowBandStartScale = 1.05f,
                glowBandEndScale = 0.7f,
                glowFadeScale = 0.9f,
                glowShadowBoost = 1.9f,
                glowShadowClamp = 118,
                starDustCount = 4,
                starDustAlphaBase = 26f,
                starDustAlphaRange = 56f,
                starDustAlphaMultiplier = 1.05f,
                starDustAlphaClamp = 104,
                starDustOrbitXBase = 0.5f,
                starDustOrbitXRange = 0.28f,
                starDustOrbitYBase = 0.1f,
                starDustOrbitYRange = 0.06f,
                starDustShadowRadius = 0.05f,
                starDustShadowBoost = 2.24f,
                starDustShadowClamp = 122,
                starDustPhaseSpeed = 7.2f,
                starDustPhaseStep = 1.44f,
                starDustLocalAlphaBase = 0.96f,
                starDustLocalAlphaDrop = 0.16f,
                starDustLocalAlphaClamp = 92,
                starDustWaveBase = 1.22f,
                starDustWaveStep = 0.08f,
                starDustRadiusBase = 1.06f,
                starDustRadiusRange = 0.92f,
                starDustRadiusDrop = 0.14f,
                starDustMinRadius = 0.6f,
                starDustDriftStepX = 1f,
                starDustDriftStepY = 1.6f,
                particleBucketScale = 0.82f,
                particleEmissionLow = 1,
                particleEmissionHigh = 2,
                particleSpreadX = 0.94f,
                particleSpreadY = 0.9f,
                particleLifetimeBaseMs = 1080L,
                particleLifetimeRangeMs = 700f,
                particleLifetimeMinMs = 950L,
                particleLifetimeMaxMs = 1800L,
                particleAlphaMultiplier = 1f,
                particleAlphaClamp = 136,
                particleRadiusScale = 1f,
                particleBlurScale = 0.96f,
                particleOffsetXScale = 1f,
                particleOffsetYScale = 1f,
                particleDriftXScale = 0.9f,
                particleRiseScale = 1.04f,
                particleWobbleAmplitudeScale = 0.92f,
                particleWobbleFrequencyScale = 1.2f,
            )
        ),
        FIRE(
            MotionProfilePreset(
                glowAlphaBase = 30f,
                glowAlphaRange = 46f,
                glowAlphaMultiplier = 1.12f,
                glowAlphaClamp = 92,
                glowRadiusBase = 0.1f,
                glowRadiusRange = 0.06f,
                glowWidthScale = 0.94f,
                glowBandStartScale = 1.08f,
                glowBandEndScale = 0.76f,
                glowFadeScale = 0.86f,
                glowShadowBoost = 2.1f,
                glowShadowClamp = 132,
                starDustCount = 5,
                starDustAlphaBase = 32f,
                starDustAlphaRange = 62f,
                starDustAlphaMultiplier = 1.1f,
                starDustAlphaClamp = 116,
                starDustOrbitXBase = 0.42f,
                starDustOrbitXRange = 0.22f,
                starDustOrbitYBase = 0.16f,
                starDustOrbitYRange = 0.12f,
                starDustShadowRadius = 0.062f,
                starDustShadowBoost = 2.5f,
                starDustShadowClamp = 138,
                starDustPhaseSpeed = 8.4f,
                starDustPhaseStep = 1.16f,
                starDustLocalAlphaBase = 1f,
                starDustLocalAlphaDrop = 0.14f,
                starDustLocalAlphaClamp = 98,
                starDustWaveBase = 1.32f,
                starDustWaveStep = 0.1f,
                starDustRadiusBase = 1.12f,
                starDustRadiusRange = 1.14f,
                starDustRadiusDrop = 0.12f,
                starDustMinRadius = 0.65f,
                starDustDriftStepX = 0.68f,
                starDustDriftStepY = 1.9f,
                particleBucketScale = 0.72f,
                particleEmissionLow = 2,
                particleEmissionHigh = 3,
                particleSpreadX = 0.78f,
                particleSpreadY = 1.18f,
                particleLifetimeBaseMs = 860L,
                particleLifetimeRangeMs = 620f,
                particleLifetimeMinMs = 820L,
                particleLifetimeMaxMs = 1560L,
                particleAlphaMultiplier = 1.08f,
                particleAlphaClamp = 148,
                particleRadiusScale = 1.12f,
                particleBlurScale = 1.08f,
                particleOffsetXScale = 0.82f,
                particleOffsetYScale = 1.24f,
                particleDriftXScale = 0.54f,
                particleRiseScale = 1.72f,
                particleWobbleAmplitudeScale = 0.84f,
                particleWobbleFrequencyScale = 1.24f,
            )
        ),
        VELVET(
            MotionProfilePreset(
                glowAlphaBase = 20f,
                glowAlphaRange = 28f,
                glowAlphaMultiplier = 0.92f,
                glowAlphaClamp = 62,
                glowRadiusBase = 0.11f,
                glowRadiusRange = 0.055f,
                glowWidthScale = 1.14f,
                glowBandStartScale = 1.2f,
                glowBandEndScale = 0.78f,
                glowFadeScale = 1.06f,
                glowShadowBoost = 1.7f,
                glowShadowClamp = 98,
                starDustCount = 3,
                starDustAlphaBase = 22f,
                starDustAlphaRange = 38f,
                starDustAlphaMultiplier = 0.9f,
                starDustAlphaClamp = 78,
                starDustOrbitXBase = 0.62f,
                starDustOrbitXRange = 0.26f,
                starDustOrbitYBase = 0.11f,
                starDustOrbitYRange = 0.08f,
                starDustShadowRadius = 0.058f,
                starDustShadowBoost = 1.96f,
                starDustShadowClamp = 94,
                starDustPhaseSpeed = 5.3f,
                starDustPhaseStep = 1.52f,
                starDustLocalAlphaBase = 0.9f,
                starDustLocalAlphaDrop = 0.17f,
                starDustLocalAlphaClamp = 64,
                starDustWaveBase = 0.98f,
                starDustWaveStep = 0.05f,
                starDustRadiusBase = 1f,
                starDustRadiusRange = 0.82f,
                starDustRadiusDrop = 0.18f,
                starDustMinRadius = 0.56f,
                starDustDriftStepX = 0.9f,
                starDustDriftStepY = 1.28f,
                particleBucketScale = 1.2f,
                particleEmissionLow = 1,
                particleEmissionHigh = 1,
                particleSpreadX = 1f,
                particleSpreadY = 0.86f,
                particleLifetimeBaseMs = 1320L,
                particleLifetimeRangeMs = 940f,
                particleLifetimeMinMs = 1240L,
                particleLifetimeMaxMs = 2280L,
                particleAlphaMultiplier = 0.9f,
                particleAlphaClamp = 118,
                particleRadiusScale = 1.02f,
                particleBlurScale = 1.24f,
                particleOffsetXScale = 0.94f,
                particleOffsetYScale = 0.84f,
                particleDriftXScale = 0.66f,
                particleRiseScale = 1.1f,
                particleWobbleAmplitudeScale = 0.68f,
                particleWobbleFrequencyScale = 0.82f,
            )
        ),
        COSMIC(
            MotionProfilePreset(
                glowAlphaBase = 22f,
                glowAlphaRange = 34f,
                glowAlphaMultiplier = 1f,
                glowAlphaClamp = 72,
                glowRadiusBase = 0.09f,
                glowRadiusRange = 0.045f,
                glowWidthScale = 1f,
                glowBandStartScale = 1.15f,
                glowBandEndScale = 0.65f,
                glowFadeScale = 0.95f,
                glowShadowBoost = 1.75f,
                glowShadowClamp = 110,
                starDustCount = 4,
                starDustAlphaBase = 28f,
                starDustAlphaRange = 52f,
                starDustAlphaMultiplier = 1f,
                starDustAlphaClamp = 96,
                starDustOrbitXBase = 0.55f,
                starDustOrbitXRange = 0.35f,
                starDustOrbitYBase = 0.12f,
                starDustOrbitYRange = 0.08f,
                starDustShadowRadius = 0.055f,
                starDustShadowBoost = 2.1f,
                starDustShadowClamp = 110,
                starDustPhaseSpeed = 6.2f,
                starDustPhaseStep = 1.37f,
                starDustLocalAlphaBase = 0.92f,
                starDustLocalAlphaDrop = 0.14f,
                starDustLocalAlphaClamp = 90,
                starDustWaveBase = 1.08f,
                starDustWaveStep = 0.06f,
                starDustRadiusBase = 1.15f,
                starDustRadiusRange = 0.95f,
                starDustRadiusDrop = 0.16f,
                starDustMinRadius = 0.6f,
                starDustDriftStepX = 1.2f,
                starDustDriftStepY = 1.6f,
                particleBucketScale = 1f,
                particleEmissionLow = 1,
                particleEmissionHigh = 2,
                particleSpreadX = 1f,
                particleSpreadY = 1f,
                particleLifetimeBaseMs = 1200L,
                particleLifetimeRangeMs = 900f,
                particleLifetimeMinMs = 1200L,
                particleLifetimeMaxMs = 2200L,
                particleAlphaMultiplier = 1f,
                particleAlphaClamp = 130,
                particleRadiusScale = 1f,
                particleBlurScale = 1f,
                particleOffsetXScale = 1f,
                particleOffsetYScale = 1f,
                particleDriftXScale = 1f,
                particleRiseScale = 1f,
                particleWobbleAmplitudeScale = 1f,
                particleWobbleFrequencyScale = 1f,
            )
        );

        companion object {
            fun from(value: String?): MotionProfile {
                return when (value?.trim()?.lowercase()) {
                    "ambient" -> AMBIENT
                    "pulse" -> PULSE
                    "fire" -> FIRE
                    "velvet" -> VELVET
                    else -> COSMIC
                }
            }
        }
    }

    private data class MotionProfilePreset(
        val glowAlphaBase: Float,
        val glowAlphaRange: Float,
        val glowAlphaMultiplier: Float,
        val glowAlphaClamp: Int,
        val glowRadiusBase: Float,
        val glowRadiusRange: Float,
        val glowWidthScale: Float,
        val glowBandStartScale: Float,
        val glowBandEndScale: Float,
        val glowFadeScale: Float,
        val glowShadowBoost: Float,
        val glowShadowClamp: Int,
        val starDustCount: Int,
        val starDustAlphaBase: Float,
        val starDustAlphaRange: Float,
        val starDustAlphaMultiplier: Float,
        val starDustAlphaClamp: Int,
        val starDustOrbitXBase: Float,
        val starDustOrbitXRange: Float,
        val starDustOrbitYBase: Float,
        val starDustOrbitYRange: Float,
        val starDustShadowRadius: Float,
        val starDustShadowBoost: Float,
        val starDustShadowClamp: Int,
        val starDustPhaseSpeed: Float,
        val starDustPhaseStep: Float,
        val starDustLocalAlphaBase: Float,
        val starDustLocalAlphaDrop: Float,
        val starDustLocalAlphaClamp: Int,
        val starDustWaveBase: Float,
        val starDustWaveStep: Float,
        val starDustRadiusBase: Float,
        val starDustRadiusRange: Float,
        val starDustRadiusDrop: Float,
        val starDustMinRadius: Float,
        val starDustDriftStepX: Float,
        val starDustDriftStepY: Float,
        val particleBucketScale: Float,
        val particleEmissionLow: Int,
        val particleEmissionHigh: Int,
        val particleSpreadX: Float,
        val particleSpreadY: Float,
        val particleLifetimeBaseMs: Long,
        val particleLifetimeRangeMs: Float,
        val particleLifetimeMinMs: Long,
        val particleLifetimeMaxMs: Long,
        val particleAlphaMultiplier: Float,
        val particleAlphaClamp: Int,
        val particleRadiusScale: Float,
        val particleBlurScale: Float,
        val particleOffsetXScale: Float,
        val particleOffsetYScale: Float,
        val particleDriftXScale: Float,
        val particleRiseScale: Float,
        val particleWobbleAmplitudeScale: Float,
        val particleWobbleFrequencyScale: Float,
    )

    // ========================================================================
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
