package expo.modules.karaokeview

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.VelocityTracker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

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
    private var spaceWidth = 0f
    private var density = 1f

    // --- Colors ---
    private var activeColor: Int = Color.WHITE
    private var inactiveColor: Int = Color.parseColor("#4DFFFFFF")
    private var glowColor: Int = Color.WHITE

    // --- Paints ---
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.LEFT
    }
    private val highlightPaint = Paint(basePaint)
    private val glowPaint = Paint(highlightPaint)
    private val fadePaint = Paint().apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    }
    private val sweepMaskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
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

    // --- Animator ---
    private var animator: LyricsAnimator? = null
    private var lastEmittedLineIndex = -1

    // --- Event dispatchers (Expo Modules pattern) ---
    private val onSeek by EventDispatcher<Map<String, Any>>()

    // --- Feather width for liquid effect ---
    private val FEATHER_PX: Float

    init {
        density = resources.displayMetrics.density
        fontSize = 28f * density
        lineHeight = 64f * density
        marginLeft = 40f * density
        fadeHeight = 110f * density
        FEATHER_PX = 8f * density // Tight feather

        basePaint.color = inactiveColor
        basePaint.textSize = fontSize
        highlightPaint.color = activeColor
        highlightPaint.textSize = fontSize
        glowPaint.color = activeColor
        glowPaint.textSize = fontSize
        glowPaint.clearShadowLayer()

        spaceWidth = basePaint.measureText(" ")

        setBackgroundColor(Color.TRANSPARENT)
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    // --- Public setters (called from JS via props) ---

    // --- Settings ---
    private var isLineByLine = false

    fun setIsLineByLine(isLineByLine: Boolean) {
        this.isLineByLine = isLineByLine
        invalidate()
    }

    private fun getScrollDamping(): Float {
        return if (isLineByLine) scrollDampingLineByLine else scrollDampingDefault
    }

    fun setFontSize(size: Float) {
        fontSize = size * density
        lineHeight = fontSize * 2.0f
        basePaint.textSize = fontSize
        highlightPaint.textSize = fontSize
        glowPaint.textSize = fontSize
        precomputePositions()
        invalidate()
    }

    fun setActiveColor(color: Int) {
        activeColor = color
        highlightPaint.color = color
        invalidate()
    }

    fun setInactiveColor(color: Int) {
        inactiveColor = color
        basePaint.color = color
        invalidate()
    }

    fun setGlowColor(color: Int) {
        glowColor = color
        // Reuse glowColor as active text color (without bloom)
        highlightPaint.color = color
        glowPaint.clearShadowLayer()
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
                if (isTap && event.actionMasked == MotionEvent.ACTION_UP) {
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
            val lastWord = line.words.lastOrNull()
            val lineBottom = if (lastWord != null) {
                line.y + lastWord.yOffset + lineHeight
            } else {
                line.y + lineHeight
            }

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

        // Update auto-scroll target (only if not manually scrolling)
        if (!isManualScrolling) {
            lookupTable?.let { table ->
                val lineIndex = table.getLineIndexAt(currentTimeMs)
                if (lineIndex >= 0 && lineIndex < lines.size) {
                    targetScrollY = -lines[lineIndex].y + height * 0.35f
                    emitLineChangeIfNeeded(lineIndex)
                }
            }
        }

        // Main drawing layer (for edge fades)
        val saveCount = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)

        canvas.save()
        canvas.translate(0f, scrollY)
        for (line in lines) {
            val screenY = line.y + scrollY
            if (screenY < -lineHeight * 4 || screenY > height + lineHeight * 2) continue
            drawLine(canvas, line, currentTimeMs)
        }
        canvas.restore()

        drawFades(canvas)
        canvas.restoreToCount(saveCount)
    }

    // ========================================================================
    // GLOBAL LINE SWEEP (Apple Music style)
    // ========================================================================

    private fun drawLine(canvas: Canvas, line: LyricLine, currentTimeMs: Long) {
        val timeSec = currentTimeMs / 1000f
        val lineStartSec = line.startMs / 1000f
        val lineEndSec = line.endMs / 1000f

        val isActive = timeSec in lineStartSec..lineEndSec
        val isPast = timeSec > lineEndSec

        // --- Proximity animations ---
        val timeDist = when {
            timeSec < lineStartSec -> lineStartSec - timeSec
            timeSec > lineEndSec -> timeSec - lineEndSec
            else -> 0f
        }
        val proximityWindowSec = if (isLineByLine) 0.9f else 1.5f
        val animProgress = (1f - (timeDist / proximityWindowSec)).coerceIn(0f, 1f)
        val smooth = animProgress * animProgress * (3 - 2 * animProgress)

        val scale = if (isActive) 1.08f else (1.0f + 0.08f * smooth)
        val baseAlpha = if (isActive) {
            if (isLineByLine) 85 else 255
        } else {
            (100 + (155 * smooth * 0.5f)).toInt()
        }

        canvas.save()
        canvas.scale(scale, scale, marginLeft, line.y + lineHeight / 2)
        basePaint.alpha = baseAlpha

        // --- Draw all words as inactive (base layer) ---
        for (word in line.words) {
            val wordX = marginLeft + word.xOffset
            val wordY = line.y + word.yOffset + lineHeight * 0.7f
            canvas.drawText(word.text, wordX, wordY, basePaint)
        }

        // --- Draw highlighted layer row-by-row ---
        if (isActive || isPast) {
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

        canvas.restore()
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

    private fun precomputePositions() {
        if (width <= 0) return
        val maxWidth = width - marginLeft * 2
        var currentY = 0f

        for (line in lines) {
            line.y = currentY
            var offsetX = 0f
            var offsetY = 0f

            for (word in line.words) {
                word.width = basePaint.measureText(word.text)
                if (offsetX + word.width > maxWidth && offsetX > 0) {
                    offsetX = 0f
                    offsetY += lineHeight
                }
                word.xOffset = offsetX
                word.yOffset = offsetY
                offsetX += word.width + spaceWidth
            }

            line.totalWidth = if (line.words.isNotEmpty()) maxWidth else 0f
            currentY += offsetY + lineHeight + (16f * density)
        }
    }

    private fun parseLyrics(data: List<Map<String, Any>>): List<LyricLine> {
        val result = mutableListOf<LyricLine>()
        var currentLine = LyricLine(words = mutableListOf())
        for (wordMap in data) {
            val text = wordMap["w"] as? String ?: ""
            val startSec = (wordMap["s"] as? Number)?.toDouble() ?: 0.0
            val endSec = (wordMap["e"] as? Number)?.toDouble() ?: startSec
            val startMs = (startSec * 1000).toLong()
            val endMs = (endSec * 1000).toLong()

            val tokens = text
                .split(Regex("\\s+"))
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            if (tokens.size <= 1) {
                val single = text.trim()
                if (single.isNotEmpty()) {
                    currentLine.words.add(LyricWord(single, startMs, endMs))
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
                    currentLine.words.add(LyricWord(tokens[index], tokenStart, tokenEnd))
                }
            }

            if (wordMap["n"] as? Boolean == true) {
                if (currentLine.words.isNotEmpty()) {
                    currentLine.startMs = currentLine.words.first().startMs
                    currentLine.endMs = currentLine.words.last().endMs
                    result.add(currentLine)
                }
                currentLine = LyricLine(words = mutableListOf())
            }
        }
        if (currentLine.words.isNotEmpty()) {
            currentLine.startMs = currentLine.words.first().startMs
            currentLine.endMs = currentLine.words.last().endMs
            result.add(currentLine)
        }
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
