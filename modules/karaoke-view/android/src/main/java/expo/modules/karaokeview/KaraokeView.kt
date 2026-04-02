package expo.modules.karaokeview

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.VelocityTracker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.abs
import kotlin.math.cos
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

    // --- Time interpolation ---
    private var lastJsTimeMs: Long = 0
    private var lastJsUpdateNanos: Long = System.nanoTime()
    private var isPlaying: Boolean = false

    // --- Scrolling ---
    private var scrollY: Float = 0f
    private var targetScrollY: Float = 0f
    private val scrollDampingDefault = 0.08f
    private val scrollDampingLineByLine = 0.16f

    // --- Manual scroll ---
    private var isManualScrolling = false
    private var manualScrollTimeoutNanos: Long = 0
    private val MANUAL_SCROLL_TIMEOUT_NS = 3_000_000_000L // 3 seconds
    private var touchStartY = 0f
    private var touchStartScrollY = 0f
    private var lastTouchY = 0f
    private var velocityTracker: VelocityTracker? = null
    private var scrollVelocity = 0f
    private val SCROLL_FRICTION = 0.95f

    // --- Tap detection ---
    private var touchStartX = 0f
    private var isTap = true
    private val TAP_SLOP = 10f * resources.displayMetrics.density
    private var seekOnTapEnabled = false

    // --- Animator ---
    private var animator: LyricsAnimator? = null
    private var lastEmittedLineIndex = -1

    // --- Event dispatchers (Expo Modules pattern) ---
    private val onSeek by EventDispatcher<Map<String, Any>>()

    // --- Feather width for liquid effect ---
    private val FEATHER_PX: Float
    private val LEADING_GLOW_WIDTH_PX: Float
    private val scrollAnchorRatio = 0.26f
    private val hierarchyTransitionWindowMs = 700f

    init {
        density = resources.displayMetrics.density
        fontSize = 30f * density
        lineHeight = 60f * density
        marginLeft = 24f * density
        fadeHeight = 156f * density
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
    }

    // --- Public setters (called from JS via props) ---

    // --- Settings ---
    private var isLineByLine = false
    private var enableSpectralParticles = true
    private val suspendedParticles = Array(MAX_SPECTRAL_PARTICLES) { SuspendedParticle() }
    private val particleEmissionBuckets = mutableMapOf<Long, Long>()

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
        lines = parseLyrics(lyricsData)
        lookupTable = if (lines.isNotEmpty()) LyricsLookupTable(lines) else null
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
        seekOnTapEnabled = enabled
    }

    private fun getInterpolatedTime(): Long {
        if (!isPlaying) return lastJsTimeMs
        val elapsedMs = (System.nanoTime() - lastJsUpdateNanos) / 1_000_000
        return lastJsTimeMs + elapsedMs
    }

    private fun startAnimator() {
        animator?.stop()
        animator = LyricsAnimator {
            // Handle manual scroll timeout
            if (isManualScrolling) {
                if (System.nanoTime() > manualScrollTimeoutNanos) {
                    isManualScrolling = false
                    scrollVelocity = 0f
                }
            }

            // Apply fling velocity
            if (!isManualScrolling && scrollVelocity != 0f) {
                // This handles the fling after finger lift but before auto-scroll resumes
            }

            val diff = targetScrollY - scrollY
            val damping = getScrollDamping()
            if (Math.abs(diff) > 0.01f) scrollY += diff * damping else scrollY = targetScrollY
            invalidate()
        }.also { it.start() }
    }

    // ========================================================================
    // TOUCH HANDLING: Tap-to-seek + Manual scroll
    // ========================================================================

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // Start tracking
                touchStartX = event.x
                touchStartY = event.y
                touchStartScrollY = scrollY
                lastTouchY = event.y
                isTap = true
                scrollVelocity = 0f

                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain()
                velocityTracker?.addMovement(event)

                parent?.requestDisallowInterceptTouchEvent(true)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                val dx = Math.abs(event.x - touchStartX)
                val dy = Math.abs(event.y - touchStartY)

                if (dx > TAP_SLOP || dy > TAP_SLOP) {
                    isTap = false
                }

                if (!isTap) {
                    // Manual scroll mode
                    isManualScrolling = true
                    val deltaY = event.y - lastTouchY
                    scrollY += deltaY
                    targetScrollY = scrollY
                    lastTouchY = event.y
                    invalidate()
                }
                return true
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (seekOnTapEnabled && isTap && event.actionMasked == MotionEvent.ACTION_UP) {
                    // TAP: Find which line was tapped and seek
                    handleTap(event.x, event.y)
                } else {
                    // FLING: Set timeout for auto-scroll resume
                    isManualScrolling = true
                    manualScrollTimeoutNanos = System.nanoTime() + MANUAL_SCROLL_TIMEOUT_NS
                }

                velocityTracker?.recycle()
                velocityTracker = null
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun handleTap(x: Float, y: Float) {
        // Convert screen Y to content Y (accounting for scroll)
        val contentY = y - scrollY

        // Find which line was tapped
        for (i in lines.indices) {
            val line = lines[i]
            val lineTop = line.y
            val lineBottom = line.y + line.totalHeight

            if (contentY >= lineTop && contentY <= lineBottom) {
                // Emit seek event via Expo EventDispatcher delegate
                onSeek(mapOf("timeMs" to line.startMs))
                break
            }
        }
    }

    // ========================================================================
    // DRAWING
    // ========================================================================

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (lines.isEmpty()) return

        val currentTimeMs = getInterpolatedTime()
        val activeLineIndex = lookupTable?.getLineIndexAt(currentTimeMs) ?: -1

        // Update auto-scroll target (only if not manually scrolling)
        if (!isManualScrolling) {
            if (activeLineIndex >= 0 && activeLineIndex < lines.size) {
                val activeLine = lines[activeLineIndex]
                targetScrollY = -(activeLine.y + activeLine.focusCenterYOffset) + height * scrollAnchorRatio
                emitLineChangeIfNeeded(activeLineIndex)
            }
        }

        // Main drawing layer (for edge fades)
        val saveCount = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)

        canvas.save()
        canvas.translate(0f, scrollY)
        for (index in lines.indices) {
            val line = lines[index]
            val screenY = line.y + scrollY
            if (screenY < -line.totalHeight * 2f || screenY > height + line.totalHeight * 2f) continue
            drawLine(canvas, line, index, activeLineIndex, currentTimeMs)
        }
        drawSuspendedSpectralParticles(canvas, currentTimeMs)
        canvas.restore()

        drawFades(canvas)
        canvas.restoreToCount(saveCount)
    }

    // ========================================================================
    // GLOBAL LINE SWEEP (Apple Music style)
    // ========================================================================

    private data class ActiveHighlightState(
        val activeWordIndex: Int,
        val completedLimit: Int,
        val activeRange: IntRange,
        val progress: Float,
        val sweepX: Float,
        val isGrowable: Boolean,
    )

    private fun drawLine(canvas: Canvas, line: LyricLine, lineIndex: Int, activeLineIndex: Int, currentTimeMs: Long) {
        val timeSec = currentTimeMs / 1000f
        val lineStartSec = line.startMs / 1000f
        val lineEndSec = line.endMs / 1000f

        val isActive = timeSec in lineStartSec..lineEndSec
        val isPast = timeSec > lineEndSec
        val relativeIndex = if (activeLineIndex >= 0) lineIndex - activeLineIndex else 0
        val distance = abs(relativeIndex)
        val transitionProgress = when {
            lineIndex == activeLineIndex + 1 -> {
                val timeUntilStart = (line.startMs - currentTimeMs).toFloat()
                (1f - (timeUntilStart / hierarchyTransitionWindowMs)).coerceIn(0f, 1f)
            }
            lineIndex == activeLineIndex - 1 -> {
                val timeSinceEnd = (currentTimeMs - line.endMs).toFloat()
                (1f - (timeSinceEnd / hierarchyTransitionWindowMs)).coerceIn(0f, 1f)
            }
            else -> 0f
        }
        val transitionEase = transitionProgress * transitionProgress * (3f - 2f * transitionProgress)

        val scale = when {
            relativeIndex == 0 -> 1.001f
            relativeIndex == 1 -> 0.93f + 0.071f * transitionEase
            else -> 0.93f
        }
        val baseAlpha = when {
            relativeIndex == 0 -> 204
            relativeIndex == 1 -> (204 + 51 * transitionEase).toInt()
            distance == 1 -> 196
            distance == 2 -> 186
            distance == 3 -> 176
            else -> 164
        }.coerceIn(112, 255)
        val blurRadius = when {
            relativeIndex == 0 -> 0f
            relativeIndex == 1 -> (2f * density) * (1f - transitionEase)
            distance == 1 -> 1f * density
            else -> 2f * density
        }

        canvas.save()
        canvas.scale(scale, scale, marginLeft, line.y + line.focusCenterYOffset)
        basePaint.alpha = baseAlpha
        if (blurRadius > 0f) {
            basePaint.setShadowLayer(
                blurRadius,
                0f,
                0f,
                Color.argb((baseAlpha * 0.28f).toInt().coerceIn(0, 96), 255, 255, 255)
            )
        } else {
            basePaint.clearShadowLayer()
        }

        val activeWordIndex = if (isActive) {
            line.words.indexOfFirst { currentTimeMs in it.startMs..it.endMs }
        } else {
            -1
        }
        val completedWordCount = if (isActive || isPast) {
            line.words.count { currentTimeMs >= it.endMs }
        } else {
            0
        }
        val activeHighlightState = if (isActive && !isLineByLine) {
            buildActiveHighlightState(line.words, currentTimeMs)
        } else {
            null
        }

        // --- Draw all words as inactive (base layer) ---
        for ((index, word) in line.words.withIndex()) {
            if (isPast) continue
            if (activeHighlightState != null && index in activeHighlightState.activeRange) {
                drawWordTail(
                    canvas = canvas,
                    line = line,
                    word = word,
                    paint = basePaint,
                    revealX = activeHighlightState.sweepX,
                    rowHeight = lineHeight,
                )
                continue
            }
            if (isActive && index < completedWordCount) continue
            drawWord(canvas, line, word, basePaint)
        }
        basePaint.clearShadowLayer()

        // --- Draw highlighted layer ---
        if (isActive || isPast) {
            if (!isLineByLine) {
                drawSyncedHighlight(canvas, line, currentTimeMs, isPast, activeHighlightState)
                if (isActive && line.backgroundWords.isNotEmpty()) {
                    drawBackgroundVocalLayer(canvas, line, currentTimeMs)
                }
                canvas.restore()
                return
            }

            val rows = line.words.groupBy { it.yOffset }
            val sortedRowOffsets = rows.keys.sorted()

            for (rowY in sortedRowOffsets) {
                val rowWords = rows[rowY] ?: continue
                val rowStartSec = rowWords.first().startMs / 1000f
                val rowEndSec = rowWords.last().endMs / 1000f

                val isRowPast = timeSec > rowEndSec
                val isRowActive = timeSec in rowStartSec..rowEndSec

                val shouldDrawRowHighlight = if (isLineByLine) {
                    true
                } else {
                    isRowPast || isRowActive || isPast
                }
                if (!shouldDrawRowHighlight) continue

                val rowTop = line.y + rowY
                val rowBottom = rowTop + lineHeight
                val rowRight = marginLeft + rowWords.last().xOffset + rowWords.last().width + FEATHER_PX * 2

                canvas.saveLayer(marginLeft - FEATHER_PX, rowTop - lineHeight, rowRight, rowBottom + lineHeight, null)

                // 1. Draw Active Text (no glow)
                highlightPaint.alpha = 255
                for (word in rowWords) {
                    canvas.drawText(word.text, marginLeft + word.xOffset, line.y + word.yOffset + lineHeight * 0.7f, highlightPaint)
                }

                // 2. Apply Sweep Mask for the row (Skip if isLineByLine is true)
                if (!isLineByLine && !isRowPast && !isPast) {
                    var sweepX = marginLeft
                    val rowTimeSec = timeSec.coerceIn(rowStartSec, rowEndSec)

                    for (i in rowWords.indices) {
                        val word = rowWords[i]
                        val ws = word.startMs / 1000f
                        val we = word.endMs / 1000f
                        val wordX = marginLeft + word.xOffset

                        if (rowTimeSec >= we) {
                            sweepX = wordX + word.width + FEATHER_PX
                        } else if (rowTimeSec >= ws) {
                            val wordProgress = ((rowTimeSec - ws) / (we - ws)).coerceIn(0f, 1f)
                            val easedProgress = wordProgress * wordProgress * (3 - 2 * wordProgress)
                            sweepX = wordX + word.width * easedProgress
                            break
                        } else {
                            if (i > 0) {
                                val prevWord = rowWords[i - 1]
                                val prevEnd = prevWord.endMs / 1000f
                                val gapDuration = ws - prevEnd
                                if (gapDuration > 0) {
                                    val gapProgress = ((rowTimeSec - prevEnd) / gapDuration).coerceIn(0f, 1f)
                                    val prevEndX = marginLeft + prevWord.xOffset + prevWord.width
                                    sweepX = prevEndX + (wordX - prevEndX) * gapProgress
                                }
                            }
                            break
                        }
                    }

                    val maskShader = LinearGradient(sweepX - FEATHER_PX, 0f, sweepX, 0f, intArrayOf(Color.BLACK, Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
                    sweepMaskPaint.shader = maskShader
                    canvas.drawRect(marginLeft - FEATHER_PX, rowTop, rowRight, rowBottom + lineHeight, sweepMaskPaint)
                }

                canvas.restore()
            }
        }

        if (isActive && line.backgroundWords.isNotEmpty()) {
            drawBackgroundVocalLayer(canvas, line, currentTimeMs)
        }

        canvas.restore()
    }

    private fun drawSyncedHighlight(
        canvas: Canvas,
        line: LyricLine,
        currentTimeMs: Long,
        isPast: Boolean,
        activeHighlightState: ActiveHighlightState?,
    ) {
        val completedWordCount = line.words.count { currentTimeMs >= it.endMs }
        highlightPaint.alpha = 255

        val completedLimit = activeHighlightState?.completedLimit ?: completedWordCount
        for (index in 0 until completedLimit.coerceAtMost(line.words.size)) {
            drawWordTranslated(canvas, line, line.words[index], highlightPaint, -lineHeight * 0.035f)
        }

        if (isPast || activeHighlightState == null) {
            return
        }

        if (activeHighlightState.isGrowable) {
            drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = line.words.slice(activeHighlightState.activeRange),
                progress = activeHighlightState.progress,
                sweepX = activeHighlightState.sweepX,
                paint = highlightPaint,
                rowHeight = lineHeight,
                finalLiftRatio = 0.035f,
                currentTimeMs = currentTimeMs,
            )
        } else {
            val activeWord = line.words[activeHighlightState.activeWordIndex]
            drawWordWipeHighlight(
                canvas = canvas,
                line = line,
                word = activeWord,
                progress = activeHighlightState.progress,
                paint = highlightPaint,
                rowHeight = lineHeight,
                finalLiftRatio = 0.035f,
                useCharacterLift = false,
                currentTimeMs = currentTimeMs,
            )
        }
    }

    private fun drawBackgroundVocalLayer(canvas: Canvas, line: LyricLine, currentTimeMs: Long) {
        if (line.backgroundWords.isEmpty()) return

        val revealProgress = ((currentTimeMs - line.startMs).toFloat() / 450f).coerceIn(0f, 1f)
        val revealEase = revealProgress * revealProgress * (3f - 2f * revealProgress)
        val completedWordCount = line.backgroundWords.count { currentTimeMs >= it.endMs }
        val activeHighlightState = buildActiveHighlightState(line.backgroundWords, currentTimeMs)

        backgroundBasePaint.alpha = (188f * revealEase).toInt().coerceIn(0, 188)
        for ((index, word) in line.backgroundWords.withIndex()) {
            if (activeHighlightState != null && index in activeHighlightState.activeRange) {
                drawWordTail(
                    canvas = canvas,
                    line = line,
                    word = word,
                    paint = backgroundBasePaint,
                    revealX = activeHighlightState.sweepX,
                    rowHeight = backgroundLineHeight,
                )
                continue
            }
            if (index < completedWordCount) continue
            drawWord(canvas, line, word, backgroundBasePaint)
        }

        backgroundHighlightPaint.alpha = (255f * revealEase).toInt().coerceIn(0, 255)
        val completedLimit = activeHighlightState?.completedLimit ?: completedWordCount
        for (index in 0 until completedLimit.coerceAtMost(line.backgroundWords.size)) {
            drawWordTranslated(canvas, line, line.backgroundWords[index], backgroundHighlightPaint, -backgroundLineHeight * 0.025f)
        }

        if (activeHighlightState == null) {
            return
        }

        if (activeHighlightState.isGrowable) {
            drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = line.backgroundWords.slice(activeHighlightState.activeRange),
                progress = activeHighlightState.progress,
                sweepX = activeHighlightState.sweepX,
                paint = backgroundHighlightPaint,
                rowHeight = backgroundLineHeight,
                finalLiftRatio = 0.025f,
                currentTimeMs = currentTimeMs,
            )
        } else {
            val activeWord = line.backgroundWords[activeHighlightState.activeWordIndex]
            drawWordWipeHighlight(
                canvas = canvas,
                line = line,
                word = activeWord,
                progress = activeHighlightState.progress,
                paint = backgroundHighlightPaint,
                rowHeight = backgroundLineHeight,
                finalLiftRatio = 0.025f,
                useCharacterLift = false,
                currentTimeMs = currentTimeMs,
            )
        }
    }

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

        val firstWord = words.first()
        val lastWord = words.last()
        val wordLeft = marginLeft + firstWord.xOffset
        val wordRight = marginLeft + lastWord.xOffset + lastWord.width
        if (sweepX <= wordLeft || sweepX >= wordRight + LEADING_GLOW_WIDTH_PX) return

        val wordTop = line.y + words.minOf { it.yOffset }
        val wordBottom = line.y + words.maxOf { it.yOffset } + rowHeight
        val glowAlpha = (22f + 34f * glowProgress).toInt().coerceIn(0, 72)
        val glowRadius = rowHeight * (0.09f + 0.045f * glowProgress)
        val glowBandStart = sweepX - LEADING_GLOW_WIDTH_PX * 1.15f
        val glowBandEnd = sweepX + LEADING_GLOW_WIDTH_PX * 0.65f
        val glowFadeWidth = LEADING_GLOW_WIDTH_PX * 0.95f
        val originalAlpha = paint.alpha

        paint.alpha = glowAlpha
        paint.setShadowLayer(
            glowRadius,
            0f,
            0f,
            Color.argb(
                (glowAlpha * 1.75f).toInt().coerceIn(0, 110),
                Color.red(glowColor),
                Color.green(glowColor),
                Color.blue(glowColor)
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
        canvas.translate(0f, -translateY)

        val glowMaskShader = LinearGradient(
            glowBandStart - glowFadeWidth,
            0f,
            glowBandEnd + glowFadeWidth,
            0f,
            intArrayOf(Color.TRANSPARENT, Color.BLACK, Color.BLACK, Color.TRANSPARENT),
            floatArrayOf(0f, 0.24f, 0.76f, 1f),
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

        val seed = (words.first().startMs % 997L).toFloat() * 0.013f
        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.34f + translateY
        val alphaBase = (28f + 52f * glowProgress).toInt().coerceIn(0, 96)
        val orbitX = LEADING_GLOW_WIDTH_PX * (0.55f + 0.35f * glowProgress)
        val orbitY = rowHeight * (0.12f + 0.08f * glowProgress)

        sparklePaint.color = glowColor
        sparklePaint.setShadowLayer(
            rowHeight * 0.055f,
            0f,
            0f,
            Color.argb((alphaBase * 2.1f).toInt().coerceIn(0, 110), Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor))
        )

        for (index in 0 until 4) {
            val phase = glowProgress * 6.2f + seed + index * 1.37f
            val localAlpha = (alphaBase * (0.92f - index * 0.14f)).toInt().coerceIn(0, 90)
            if (localAlpha <= 0) continue

            val x = sweepX + cos(phase) * orbitX + index * density * 1.2f
            val y = centerY + sin(phase * (1.08f + index * 0.06f)) * orbitY - index * density * 1.6f
            val radius = density * (1.15f + glowProgress * 0.95f - index * 0.16f).coerceAtLeast(0.6f)

            sparklePaint.alpha = localAlpha
            canvas.drawCircle(x, y, radius, sparklePaint)
            canvas.drawCircle(x, y, radius * 0.45f, sparklePaint)
        }

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

        val firstWord = words.first()
        val lastWord = words.last()
        val emissionKey = firstWord.startMs * 31L + lastWord.endMs * 17L + if (firstWord.isBackground) 7L else 0L
        val bucketSizeMs = if (firstWord.isBackground) 180L else 120L
        val bucket = currentTimeMs / bucketSizeMs
        if (particleEmissionBuckets[emissionKey] == bucket) return
        particleEmissionBuckets[emissionKey] = bucket

        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.26f + translateY
        val baseSeed = ((emissionKey % 4096L).toFloat() * 0.017f) + glowProgress * 2.4f + bucket * 0.19f
        val emissionCount = if (glowProgress > 0.58f) 2 else 1
        val horizontalSpread = rowHeight * if (firstWord.isBackground) 0.1f else 0.16f
        val verticalSpread = rowHeight * if (firstWord.isBackground) 0.06f else 0.1f

        repeat(emissionCount) { index ->
            val particle = suspendedParticles.firstOrNull { !it.active } ?: return@repeat
            val phase = baseSeed + index * 1.73f
            val lifetimeMs = (1200L + ((sin(phase) * 0.5f + 0.5f) * 900f).toLong()).coerceIn(1200L, 2200L)
            val brightness = (0.78f + 0.22f * ((cos(phase * 1.41f) * 0.5f) + 0.5f)).coerceIn(0.78f, 1f)
            val alpha = ((if (firstWord.isBackground) 84f else 112f) * brightness).toInt().coerceIn(48, 130)
            val radius = density * ((if (firstWord.isBackground) 0.95f else 1.2f) + ((sin(phase * 0.83f) * 0.5f) + 0.5f) * 1.5f)
            val blur = rowHeight * ((if (firstWord.isBackground) 0.04f else 0.05f) + ((cos(phase * 1.13f) * 0.5f) + 0.5f) * 0.035f)
            val offsetX = cos(phase) * horizontalSpread + sin(phase * 0.51f) * density * 3.5f
            val offsetY = sin(phase * 1.27f) * verticalSpread - rowHeight * 0.04f
            val driftX = cos(phase * 0.73f) * density * 7.5f
            val driftY = -(rowHeight * (0.12f + (((sin(phase * 1.57f) * 0.5f) + 0.5f) * 0.14f)))
            val wobbleAmplitude = density * (2.4f + ((cos(phase * 0.67f) * 0.5f) + 0.5f) * 4.8f)
            val wobbleFrequency = 0.85f + (((sin(phase * 0.93f) * 0.5f) + 0.5f) * 1.15f)

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

    private fun clearSpectralParticles() {
        for (particle in suspendedParticles) {
            particle.active = false
        }
        particleEmissionBuckets.clear()
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
                val riseEase = riseProgress * riseProgress * (3f - 2f * riseProgress)
                val settleProgress = ((localProgress - 0.56f) / 0.44f).coerceIn(0f, 1f)
                val settleEase = settleProgress * settleProgress * (3f - 2f * settleProgress)
                val liftEnvelope = (riseEase * (1f - 0.88f * settleEase)).coerceIn(0f, 1f)
                val scaleEnvelope = (riseEase * (1f - 0.58f * settleEase)).coerceIn(0f, 1f)
                val shadowEnvelope = (riseEase * (1f - 0.72f * settleEase)).coerceIn(0f, 1f)
                val shadowIntensity = (0.28f + charEnergy * 0.34f) * shadowEnvelope
                val normalizedGrowth = ((charMaxScale - 1f) / 0.13f).coerceIn(0f, 1.4f)
                val extraTranslateY = -normalizedGrowth * 6f * density
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

    private fun buildActiveHighlightState(words: List<LyricWord>, currentTimeMs: Long): ActiveHighlightState? {
        val activeWordIndex = words.indexOfFirst { currentTimeMs in it.startMs..it.endMs }
        if (activeWordIndex < 0) return null

        val activeWord = words[activeWordIndex]
        val visualWordRange = LyricsVisualWords.findVisualWordRange(words, activeWordIndex)
        val visualWord = if (!visualWordRange.isEmpty()) words.slice(visualWordRange) else listOf(activeWord)
        val singleRowVisualWord = visualWord.map { it.yOffset }.distinct().size == 1
        val combinedText = visualWord.joinToString(separator = "") { it.text }
        val combinedStartMs = visualWord.firstOrNull()?.startMs ?: activeWord.startMs
        val combinedEndMs = visualWord.lastOrNull()?.endMs ?: activeWord.endMs
        val isGrowable = singleRowVisualWord &&
            LyricsVisualWords.isGrowableVisualWord(combinedText, combinedStartMs, combinedEndMs)

        val activeRange = if (isGrowable && !visualWordRange.isEmpty()) {
            visualWordRange
        } else {
            activeWordIndex..activeWordIndex
        }
        val rangeWords = words.slice(activeRange)
        val highlightStartMs = if (isGrowable) combinedStartMs else activeWord.startMs
        val highlightEndMs = if (isGrowable) combinedEndMs else activeWord.endMs
        val durationMs = (highlightEndMs - highlightStartMs).coerceAtLeast(1L).toFloat()
        val progress = ((currentTimeMs - highlightStartMs).coerceAtLeast(0L).toFloat() / durationMs).coerceIn(0f, 1f)
        val rangeLeft = marginLeft + rangeWords.first().xOffset
        val rangeWidth = (rangeWords.last().xOffset + rangeWords.last().width) - rangeWords.first().xOffset
        val sweepX = rangeLeft + rangeWidth.coerceAtLeast(0f) * progress

        return ActiveHighlightState(
            activeWordIndex = activeWordIndex,
            completedLimit = if (isGrowable) activeRange.first else activeWordIndex,
            activeRange = activeRange,
            progress = progress,
            sweepX = sweepX,
            isGrowable = isGrowable,
        )
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

    companion object {
        private const val MAX_SPECTRAL_PARTICLES = 32
    }

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

    private data class LayoutMetrics(
        val height: Float,
        val width: Float,
    )

    private fun shouldInsertSpacing(previous: LyricWord?, current: LyricWord): Boolean {
        if (previous == null) return false
        if (previous.trailingSpace) return true
        if (current.isPart) return false

        val prevText = previous.text
        val currentText = current.text

        if (prevText.endsWith("-")) return false
        if (prevText.endsWith("'") || prevText.endsWith("’")) return false
        if (currentText.startsWith("'") || currentText.startsWith("’")) return false
        if (currentText.matches(Regex("^[,.;:!?)]"))) return false

        return true
    }

    private fun layoutWords(
        words: MutableList<LyricWord>,
        paint: Paint,
        maxWidth: Float,
        topOffset: Float,
        rowHeight: Float,
        spacingWidth: Float,
    ): LayoutMetrics {
        if (words.isEmpty()) {
            return LayoutMetrics(0f, 0f)
        }

        var offsetX = 0f
        var rowOffset = 0f
        var maxRowWidth = 0f
        var previousWord: LyricWord? = null

        for (word in words) {
            word.width = paint.measureText(word.text)
            val spacingBefore = if (LyricsVisualWords.shouldInsertSpacing(previousWord, word)) spacingWidth else 0f

            if (offsetX + spacingBefore + word.width > maxWidth && offsetX > 0f) {
                maxRowWidth = maxOf(maxRowWidth, offsetX)
                offsetX = 0f
                rowOffset += rowHeight
            }

            if (offsetX > 0f) {
                offsetX += spacingBefore
            }

            word.xOffset = offsetX
            word.yOffset = topOffset + rowOffset
            offsetX += word.width
            previousWord = word
        }

        maxRowWidth = maxOf(maxRowWidth, offsetX)
        return LayoutMetrics(
            height = rowOffset + rowHeight,
            width = maxRowWidth,
        )
    }

    private fun precomputePositions() {
        if (width <= 0) return
        val maxWidth = width - marginLeft * 2
        var currentY = 0f

        for (line in lines) {
            line.y = currentY
            val hasMain = line.words.isNotEmpty()
            val hasBackground = line.backgroundWords.isNotEmpty()
            val mainMetrics = if (hasMain) {
                layoutWords(
                    words = line.words,
                    paint = basePaint,
                    maxWidth = maxWidth,
                    topOffset = 0f,
                    rowHeight = lineHeight,
                    spacingWidth = spaceWidth,
                )
            } else {
                LayoutMetrics(0f, 0f)
            }

            line.backgroundPlacement = BackgroundPlacement.AFTER
            line.mainTopOffset = 0f
            line.mainHeight = mainMetrics.height
            line.backgroundTopOffset = if (hasBackground && hasMain) mainMetrics.height + backgroundGap else 0f
            val backgroundMetrics = if (hasBackground) {
                layoutWords(
                    words = line.backgroundWords,
                    paint = backgroundBasePaint,
                    maxWidth = maxWidth,
                    topOffset = line.backgroundTopOffset,
                    rowHeight = backgroundLineHeight,
                    spacingWidth = backgroundSpaceWidth,
                )
            } else {
                LayoutMetrics(0f, 0f)
            }
            line.backgroundHeight = backgroundMetrics.height
            line.totalWidth = maxOf(mainMetrics.width, backgroundMetrics.width)
            line.totalHeight = maxOf(
                line.mainTopOffset + line.mainHeight,
                line.backgroundTopOffset + line.backgroundHeight
            ).coerceAtLeast(lineHeight)
            line.focusCenterYOffset = if (line.mainHeight > 0f) {
                line.mainTopOffset + line.mainHeight * 0.5f
            } else {
                line.totalHeight * 0.5f
            }

            currentY += line.totalHeight + lineSpacing
        }
    }

    private fun finalizeParsedLine(
        result: MutableList<LyricLine>,
        mainWords: MutableList<LyricWord>,
        backgroundWords: MutableList<LyricWord>,
    ) {
        val normalizedMainWords = if (mainWords.isNotEmpty()) {
            mainWords.toMutableList()
        } else {
            backgroundWords.map { it.copy(isBackground = false) }.toMutableList()
        }
        val normalizedBackgroundWords = if (mainWords.isNotEmpty()) {
            backgroundWords.toMutableList()
        } else {
            mutableListOf()
        }

        if (normalizedMainWords.isEmpty() && normalizedBackgroundWords.isEmpty()) {
            return
        }

        val allWords = normalizedMainWords + normalizedBackgroundWords
        result.add(
            LyricLine(
                words = normalizedMainWords,
                backgroundWords = normalizedBackgroundWords,
                startMs = allWords.minOf { it.startMs },
                endMs = allWords.maxOf { it.endMs },
            )
        )
    }

    private fun parseLyrics(data: List<Map<String, Any>>): List<LyricLine> {
        val result = mutableListOf<LyricLine>()
        var currentMainWords = mutableListOf<LyricWord>()
        var currentBackgroundWords = mutableListOf<LyricWord>()

        for (wordMap in data) {
            val text = wordMap["w"] as? String ?: ""
            val startSec = (wordMap["s"] as? Number)?.toDouble() ?: 0.0
            val endSec = (wordMap["e"] as? Number)?.toDouble() ?: startSec
            val startMs = (startSec * 1000).toLong()
            val endMs = (endSec * 1000).toLong()
            val hasSourceSpacing = wordMap.containsKey("sp")
            val trailingSpace = wordMap["sp"] as? Boolean ?: false
            val isBackground = wordMap["bg"] as? Boolean ?: false
            val isPart = wordMap["p"] as? Boolean ?: false
            val normalizedText = text.replace(Regex("\\s+"), " ").trim()
            val targetWords = if (isBackground) currentBackgroundWords else currentMainWords

            if (hasSourceSpacing) {
                if (normalizedText.isNotEmpty()) {
                    targetWords.add(
                        LyricWord(
                            text = normalizedText,
                            startMs = startMs,
                            endMs = endMs,
                            trailingSpace = trailingSpace,
                            isBackground = isBackground,
                            isPart = isPart,
                        )
                    )
                }
            } else {
                val tokens = normalizedText
                    .split(Regex("\\s+"))
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }

                if (tokens.size <= 1) {
                    if (normalizedText.isNotEmpty()) {
                        targetWords.add(
                            LyricWord(
                                text = normalizedText,
                                startMs = startMs,
                                endMs = endMs,
                                trailingSpace = false,
                                isBackground = isBackground,
                                isPart = isPart,
                            )
                        )
                    }
                } else {
                    val total = (endMs - startMs).coerceAtLeast(1L)
                    for (index in tokens.indices) {
                        val tokenStart = startMs + (total * index) / tokens.size
                        val tokenEnd = if (index == tokens.lastIndex) {
                            endMs
                        } else {
                            startMs + (total * (index + 1)) / tokens.size
                        }
                        targetWords.add(
                            LyricWord(
                                text = tokens[index],
                                startMs = tokenStart,
                                endMs = tokenEnd,
                                trailingSpace = index < tokens.lastIndex,
                                isBackground = isBackground,
                                isPart = isPart,
                            )
                        )
                    }
                }
            }

            if (wordMap["n"] as? Boolean == true) {
                finalizeParsedLine(result, currentMainWords, currentBackgroundWords)
                currentMainWords = mutableListOf()
                currentBackgroundWords = mutableListOf()
            }
        }
        finalizeParsedLine(result, currentMainWords, currentBackgroundWords)
        return result
    }

    private fun emitLineChangeIfNeeded(lineIndex: Int) {
        if (lineIndex != lastEmittedLineIndex && lineIndex >= 0) {
            lastEmittedLineIndex = lineIndex
        }
    }

    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); animator?.stop(); animator = null }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (lines.isNotEmpty() && animator?.isRunning != true) startAnimator() }
}
