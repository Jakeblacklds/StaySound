package expo.modules.karaokeview

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Shader
import kotlin.math.abs

internal data class KaraokeLineRenderConfig(
    val density: Float,
    val marginLeft: Float,
    val lineHeight: Float,
    val backgroundLineHeight: Float,
    val hierarchyTransitionWindowMs: Float,
    val backgroundRevealDurationMs: Float,
    val backgroundFadeOutDurationMs: Float,
    val featherPx: Float,
    val wipeWidthEm: Float,
    val preWipeDistanceEm: Float,
    val foregroundLiftRatio: Float,
    val backgroundLiftRatio: Float,
    val isLineByLine: Boolean,
    val basePaint: Paint,
    val highlightPaint: Paint,
    val backgroundBasePaint: Paint,
    val backgroundHighlightPaint: Paint,
    val displayMode: String,
)

internal data class ActiveHighlightState(
    val activeWordIndex: Int,
    val completedLimit: Int,
    val activeRange: IntRange,
    val progress: Float,
    val sweepX: Float,
    val isGrowable: Boolean,
    val visualWordDurationMs: Float,
    val visualWordStartMs: Long,
) {
    // True when the active range spans more than one syllable (or is a sustained
    // growable note). Either way the sweep must be drawn as one continuous unit
    // via the multi-word wipe path instead of the single-word wipe.
    val isContinuousRange: Boolean
        get() = isGrowable || activeRange.first != activeRange.last
}

internal interface KaraokeLineRenderCallbacks {
    fun smootherStep(value: Float): Float
    fun drawWord(canvas: Canvas, line: LyricLine, word: LyricWord, paint: Paint)
    fun drawWordTail(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        revealX: Float,
        rowHeight: Float,
        fadeWidth: Float = 0f,
        translateY: Float = 0f,
    )
    fun drawWordTranslated(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        paint: Paint,
        translateY: Float,
    )
    fun drawCompletedWordWithLift(
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
    )
    fun drawGrowableVisualWordWipeHighlight(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        progress: Float,
        sweepX: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        currentTimeMs: Long,
    )
    fun drawWordWipeHighlight(
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
    )
    fun drawWordPreHighlight(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
    )
    /**
     * Draw the highlight layer for an entire row using a single continuous sweepX.
     * All words in the row share the same sweep position — no per-word restart.
     */
    fun drawRowSweepHighlight(
        canvas: Canvas,
        line: LyricLine,
        rowWords: List<LyricWord>,
        sweepX: Float,
        paint: Paint,
        rowHeight: Float,
        finalLiftRatio: Float,
        currentTimeMs: Long,
        isRowComplete: Boolean,
    )
    fun drawMotionAccent(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        currentTimeMs: Long,
        rowHeight: Float,
        translateY: Float,
    )
}

internal class KaraokeLineRenderer {
    private val lineSweepMaskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    }

    fun drawLine(
        canvas: Canvas,
        line: LyricLine,
        lineIndex: Int,
        activeLineIndex: Int,
        currentTimeMs: Long,
        config: KaraokeLineRenderConfig,
        callbacks: KaraokeLineRenderCallbacks,
    ) {
        val timeSec = currentTimeMs / 1000f
        val lineStartSec = line.startMs / 1000f
        val lineEndSec = line.endMs / 1000f

        val isActive = timeSec in lineStartSec..lineEndSec
        val isPast = timeSec > lineEndSec
        val relativeIndex = if (activeLineIndex >= 0) lineIndex - activeLineIndex else 0
        val postLineGraceMs = calculatePostLineGraceMs(line)
        val timeSinceLineEndMs = (currentTimeMs - line.endMs).coerceAtLeast(0L)
        val isFinishingAfterEnd = isPast && timeSinceLineEndMs < postLineGraceMs
        val recedingAgeMs = if (isPast) {
            (timeSinceLineEndMs - postLineGraceMs).coerceAtLeast(0L)
        } else {
            0L
        }
        // Keep sung lines in the active visual state instead of shrinking/fading
        // into the inactive hierarchy once they move above the current phrase.
        val visualRelativeIndex = if (isActive || isPast || isFinishingAfterEnd) 0 else relativeIndex
        val distance = abs(visualRelativeIndex)
        val isAboveActive = visualRelativeIndex < 0
        val isBelowActive = visualRelativeIndex > 0
        val transitionProgress = when {
            lineIndex == activeLineIndex + 1 -> {
                val timeUntilStart = (line.startMs - currentTimeMs).toFloat()
                (1f - (timeUntilStart / config.hierarchyTransitionWindowMs)).coerceIn(0f, 1f)
            }
            lineIndex == activeLineIndex - 1 -> {
                val timeSinceEnd = recedingAgeMs.toFloat()
                (1f - (timeSinceEnd / config.hierarchyTransitionWindowMs)).coerceIn(0f, 1f)
            }
            else -> 0f
        }
        val transitionEase = callbacks.smootherStep(transitionProgress)

        val scale = when {
            visualRelativeIndex == 0 -> 1.0f
            visualRelativeIndex == 1 -> 0.94f + 0.06f * transitionEase
            // Fades from 1.0 → 0.94 as the line recedes above active.
            isAboveActive && distance == 1 -> 1.0f - 0.06f * (1f - transitionEase)
            else -> 0.94f
        }
        val baseAlpha = when {
            visualRelativeIndex == 0  -> 210
            visualRelativeIndex == 1  -> (175 + 35 * transitionEase).toInt()
            isBelowActive && distance == 2 -> 130
            isBelowActive       -> 95
            // Fades from 210 → 110 over the transition window after line ends.
            isAboveActive && distance == 1 -> (210f - (210f - 110f) * (1f - transitionEase)).toInt()
            isAboveActive && distance == 2 -> (110f - (110f - 82f) * (1f - transitionEase)).toInt()
            isAboveActive       -> 62
            else                -> 140
        }.coerceIn(50, 255)
        // Soft BlurMaskFilter for lines far from active (both above and below)
        val blurRadius = when {
            isBelowActive && distance == 2 -> 3.5f * config.density
            isBelowActive && distance >= 3 -> 5.5f * config.density
            // Past lines: progressive blur so they don't compete with song info header
            isAboveActive && distance == 2 -> 2.5f * config.density
            isAboveActive && distance == 3 -> 4.5f * config.density
            isAboveActive && distance >= 4 -> 6f * config.density
            else -> 0f
        }
        val highlightAlpha = when {
            visualRelativeIndex == 0 -> 255
            // Line just above active (distance=1): transitionEase goes 1→0 as time passes since it ended.
            // So (1 - transitionEase) goes 0→1 → alpha fades from 255 down to 72 over the window.
            isAboveActive && distance == 1 -> (255f - (255f - 72f) * (1f - transitionEase)).toInt()
            // Two lines above: blend 72 → 46 as it recedes further.
            isAboveActive && distance == 2 -> (72f - (72f - 46f) * (1f - transitionEase)).toInt()
            isAboveActive -> 46
            isBelowActive && distance == 1 -> 182
            isBelowActive && distance == 2 -> 100
            isBelowActive -> 68
            else -> 180
        }.coerceIn(24, 255)
        val highlightBlurRadius = when {
            visualRelativeIndex == 0 -> 0f
            isBelowActive && distance == 1 -> 2.2f * config.density
            isBelowActive && distance == 2 -> 5f * config.density
            isBelowActive -> 7.2f * config.density
            // Past lines: blur the highlight text so it recedes visually
            isAboveActive && distance == 1 -> 1.5f * config.density
            isAboveActive && distance == 2 -> 3.5f * config.density
            isAboveActive && distance >= 3 -> 5.5f * config.density
            else -> 2f * config.density
        }

        canvas.save()
        canvas.scale(scale, scale, config.marginLeft, line.y + line.focusCenterYOffset)

        if (line.isGap) {
            config.basePaint.alpha = baseAlpha
            config.highlightPaint.alpha = highlightAlpha

            val dotRadius = 3.1f * config.density
            val activeRadiusLift = 0.45f * config.density
            val dotSpacing = 11f * config.density
            val firstDotCenterX = config.marginLeft + dotRadius
            val idleAlpha = (baseAlpha * 0.46f).toInt().coerceIn(34, 118)
            val completedAlpha = (highlightAlpha * 0.64f).toInt().coerceIn(74, 178)
            val activeAlpha = (highlightAlpha * 0.86f).toInt().coerceIn(118, 218)

            for ((index, word) in line.words.withIndex()) {
                val isWordCompleted = currentTimeMs >= word.endMs
                val isWordCurrent = currentTimeMs in word.startMs..word.endMs
                val dotCenterX = firstDotCenterX + index * dotSpacing
                val dotCenterY = line.y + word.yOffset + config.lineHeight * 0.55f

                if (isWordCurrent) {
                    val duration = (word.endMs - word.startMs).coerceAtLeast(1L).toFloat()
                    val progress = ((currentTimeMs - word.startMs).toFloat() / duration).coerceIn(0f, 1f)
                    val ease = smoothStep(progress)
                    val settle = 1f - smoothStep(((progress - 0.78f) / 0.22f).coerceIn(0f, 1f))
                    val radius = dotRadius + activeRadiusLift * ease * (0.72f + 0.28f * settle)
                    val alpha = (idleAlpha + (activeAlpha - idleAlpha) * ease).toInt().coerceIn(0, 255)

                    config.highlightPaint.alpha = alpha
                    canvas.drawCircle(dotCenterX, dotCenterY, radius, config.highlightPaint)
                    config.highlightPaint.alpha = highlightAlpha
                } else if (isWordCompleted || isPast) {
                    config.highlightPaint.alpha = completedAlpha
                    canvas.drawCircle(dotCenterX, dotCenterY, dotRadius, config.highlightPaint)
                    config.highlightPaint.alpha = highlightAlpha
                } else {
                    val timeUntilMs = (word.startMs - currentTimeMs).coerceAtLeast(0L).toFloat()
                    val anticipationWindow = 1100f
                    val anticipation = (1f - timeUntilMs / anticipationWindow).coerceIn(0f, 1f)
                    val alpha = (idleAlpha + 28f * smoothStep(anticipation)).toInt().coerceIn(0, 255)
                    config.basePaint.alpha = alpha
                    canvas.drawCircle(dotCenterX, dotCenterY, dotRadius, config.basePaint)
                    config.basePaint.alpha = baseAlpha
                }
            }
            canvas.restore()
            return
        }

        config.basePaint.alpha = baseAlpha
        // Apply subtle BlurMaskFilter only to lines that are far below active
        // (never use setShadowLayer on basePaint — it produces low-quality system blur)
        if (blurRadius > 0f) {
            config.basePaint.maskFilter = BlurMaskFilter(blurRadius, BlurMaskFilter.Blur.NORMAL)
        } else {
            config.basePaint.maskFilter = null
        }
        config.basePaint.clearShadowLayer()

        val completedWordCount = if (isActive || isPast) {
            line.words.count { currentTimeMs >= it.endMs }
        } else {
            0
        }
        val activeHighlightState = if (isActive && !config.isLineByLine) {
            buildActiveHighlightState(line.words, currentTimeMs, config.marginLeft)
        } else {
            null
        }

        for ((index, word) in line.words.withIndex()) {
            if (isPast) continue
            if (activeHighlightState != null && index in activeHighlightState.activeRange) {
                // For any continuously-swept range, calculate fadeWidth to perform a
                // smooth, complementary fade of the base (dim) text under the highlight
                // sweep. This eliminates the "double letter" artifact without creating
                // empty gaps between the reveal edge and the dim text (liquid sweep feel).
                val fadeWidth = config.highlightPaint.textSize * config.wipeWidthEm
                callbacks.drawWordTail(
                    canvas = canvas,
                    line = line,
                    word = word,
                    paint = config.basePaint,
                    revealX = activeHighlightState.sweepX,
                    rowHeight = config.lineHeight,
                    fadeWidth = fadeWidth,
                    translateY = if (activeHighlightState.isContinuousRange) {
                        -config.lineHeight * config.foregroundLiftRatio *
                            callbacks.smootherStep(activeHighlightState.progress.coerceIn(0f, 1f))
                    } else {
                        0f
                    },
                )
                continue
            }
            if (isActive && index < completedWordCount) continue
            callbacks.drawWord(canvas, line, word, config.basePaint)
        }
        config.basePaint.maskFilter = null
        config.basePaint.clearShadowLayer()

        val isWithinGrace = isFinishingAfterEnd
        val keepLineCharacterLift = lineIndex == activeLineIndex ||
            isActive ||
            isPast ||
            isFinishingAfterEnd

        if (isActive || isPast) {
            if (!config.isLineByLine) {
                drawSyncedHighlight(
                    canvas = canvas,
                    line = line,
                    currentTimeMs = currentTimeMs,
                    isPast = isPast,
                    keepCompletedCharacterLift = keepLineCharacterLift || isWithinGrace,
                    activeHighlightState = activeHighlightState,
                    lineHighlightAlpha = highlightAlpha,
                    lineHighlightBlurRadius = highlightBlurRadius,
                    config = config,
                    callbacks = callbacks,
                )
                if (line.backgroundWords.isNotEmpty()) {
                    drawBackgroundVocalLayer(
                        canvas = canvas,
                        line = line,
                        currentTimeMs = currentTimeMs,
                        keepCompletedCharacterLift = keepLineCharacterLift || isWithinGrace,
                        fadeOutDelayMs = postLineGraceMs,
                        config = config,
                        callbacks = callbacks,
                    )
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
                val shouldDrawRowHighlight = isRowPast || (timeSec in rowStartSec..rowEndSec) || isPast
                if (!shouldDrawRowHighlight) continue

                val rowTop = line.y + rowY
                val rowBottom = rowTop + config.lineHeight
                val rowRight = config.marginLeft + rowWords.last().xOffset + rowWords.last().width + config.featherPx * 2

                canvas.saveLayer(
                    config.marginLeft - config.featherPx,
                    rowTop - config.lineHeight,
                    rowRight,
                    rowBottom + config.lineHeight,
                    null,
                )

                config.highlightPaint.alpha = 255
                for (word in rowWords) {
                    canvas.drawText(
                        word.text,
                        config.marginLeft + word.xOffset,
                        line.y + word.yOffset + config.lineHeight * 0.7f,
                        config.highlightPaint,
                    )
                }

                if (!isRowPast && !isPast) {
                    var sweepX = config.marginLeft
                    val rowTimeSec = timeSec.coerceIn(rowStartSec, rowEndSec)

                    for (index in rowWords.indices) {
                        val word = rowWords[index]
                        val wordStartSec = word.startMs / 1000f
                        val wordEndSec = word.endMs / 1000f
                        val wordX = config.marginLeft + word.xOffset

                        if (rowTimeSec >= wordEndSec) {
                            sweepX = wordX + word.width + config.featherPx
                        } else if (rowTimeSec >= wordStartSec) {
                            val wordProgress = ((rowTimeSec - wordStartSec) / (wordEndSec - wordStartSec)).coerceIn(0f, 1f)
                            sweepX = wordX + word.width * callbacks.smootherStep(wordProgress)
                            break
                        } else {
                            if (index > 0) {
                                val previousWord = rowWords[index - 1]
                                val previousEndSec = previousWord.endMs / 1000f
                                val gapDuration = wordStartSec - previousEndSec
                                if (gapDuration > 0f) {
                                    val gapProgress = ((rowTimeSec - previousEndSec) / gapDuration).coerceIn(0f, 1f)
                                    val previousEndX = config.marginLeft + previousWord.xOffset + previousWord.width
                                    sweepX = previousEndX + (wordX - previousEndX) * gapProgress
                                }
                            }
                            break
                        }
                    }

                    val maskShader = LinearGradient(
                        sweepX - config.featherPx,
                        0f,
                        sweepX,
                        0f,
                        intArrayOf(Color.BLACK, Color.TRANSPARENT),
                        null,
                        Shader.TileMode.CLAMP,
                    )
                    lineSweepMaskPaint.shader = maskShader
                    canvas.drawRect(
                        config.marginLeft - config.featherPx,
                        rowTop,
                        rowRight,
                        rowBottom + config.lineHeight,
                        lineSweepMaskPaint,
                    )
                }

                canvas.restore()
            }

            callbacks.drawMotionAccent(
                canvas = canvas,
                line = line,
                words = line.words,
                currentTimeMs = currentTimeMs,
                rowHeight = config.lineHeight,
                translateY = 0f,
            )
        }

        if (line.backgroundWords.isNotEmpty()) {
            drawBackgroundVocalLayer(
                canvas = canvas,
                line = line,
                currentTimeMs = currentTimeMs,
                keepCompletedCharacterLift = lineIndex == activeLineIndex,
                fadeOutDelayMs = 0L,
                config = config,
                callbacks = callbacks,
            )
        }

        // Draw Block Translation
        if (line.translationRows.isNotEmpty()) {
            val transPaint = if (visualRelativeIndex == 0) config.backgroundHighlightPaint else config.backgroundBasePaint
            LyricsTranslationManager.drawTranslationBlock(
                canvas = canvas,
                line = line,
                paint = transPaint,
                marginLeft = config.marginLeft,
                lineHeight = config.backgroundLineHeight,
                isRtlLine = line.words.any { LyricsBidiHelper.isRtl(it.text) },
                maxWidth = canvas.width.toFloat() - config.marginLeft * 2f
            )
        }

        // Draw Block Romanization
        if (line.romanizationRows.isNotEmpty()) {
            val romPaint = if (visualRelativeIndex == 0) config.backgroundHighlightPaint else config.backgroundBasePaint
            LyricsTranslationManager.drawRomanizationBlock(
                canvas = canvas,
                line = line,
                paint = romPaint,
                marginLeft = config.marginLeft,
                lineHeight = config.backgroundLineHeight,
                isRtlLine = line.words.any { LyricsBidiHelper.isRtl(it.text) },
                maxWidth = canvas.width.toFloat() - config.marginLeft * 2f
            )
        }

        canvas.restore()
    }

    private fun calculatePostLineGraceMs(line: LyricLine): Long {
        val mainSettleMs = calculateWordsSettleMs(line.words)
        val backgroundSettleMs = calculateWordsSettleMs(line.backgroundWords)
        return maxOf(mainSettleMs, backgroundSettleMs)
            .coerceAtLeast(900L)
            .coerceAtMost(2600L)
    }

    private fun calculateWordsSettleMs(words: List<LyricWord>): Long {
        val lastWord = words.lastOrNull() ?: return 0L
        val durationMs = (lastWord.endMs - lastWord.startMs).coerceAtLeast(1L)
        val glyphCount = getDrawableGlyphCount(lastWord).coerceAtLeast(1)
        return (durationMs * (0.55f + glyphCount * 0.09f)).toLong()
    }

    private fun getDrawableGlyphCount(word: LyricWord): Int {
        return if (word.drawableGlyphCount > 0) {
            word.drawableGlyphCount
        } else {
            word.text.count { !it.isWhitespace() }
        }
    }

    private fun drawSyncedHighlight(
        canvas: Canvas,
        line: LyricLine,
        currentTimeMs: Long,
        isPast: Boolean,
        keepCompletedCharacterLift: Boolean,
        activeHighlightState: ActiveHighlightState?,
        lineHighlightAlpha: Int,
        lineHighlightBlurRadius: Float,
        config: KaraokeLineRenderConfig,
        callbacks: KaraokeLineRenderCallbacks,
    ) {
        val completedWordCount = line.words.count { currentTimeMs >= it.endMs }
        config.highlightPaint.alpha = lineHighlightAlpha
        config.highlightPaint.maskFilter = if (lineHighlightBlurRadius > 0f) {
            BlurMaskFilter(lineHighlightBlurRadius, BlurMaskFilter.Blur.NORMAL)
        } else {
            null
        }

        // Check if the active word is a growable sustained note — those still use
        // character-level scale/glow and need the old path.
        val isGrowableActive = activeHighlightState?.isGrowable == true

        if (isGrowableActive) {
            // ── GROWABLE PATH (unchanged) ────────────────────────────────────
            val completedLimit = activeHighlightState!!.completedLimit
            for (index in 0 until completedLimit.coerceAtMost(line.words.size)) {
                callbacks.drawCompletedWordWithLift(
                    canvas = canvas, line = line, word = line.words[index],
                    paint = config.highlightPaint, rowHeight = config.lineHeight,
                    finalLiftRatio = config.foregroundLiftRatio, currentTimeMs = currentTimeMs,
                    keepCharacterLift = keepCompletedCharacterLift,
                    visualWordDurationMs = activeHighlightState.visualWordDurationMs,
                    visualWordStartMs = activeHighlightState.visualWordStartMs,
                )
            }
            callbacks.drawMotionAccent(
                canvas = canvas, line = line, words = line.words,
                currentTimeMs = currentTimeMs, rowHeight = config.lineHeight,
                translateY = -config.lineHeight * config.foregroundLiftRatio,
            )
            drawNextWordPreHighlight(
                canvas = canvas, line = line, words = line.words,
                activeHighlightState = activeHighlightState, currentTimeMs = currentTimeMs,
                marginLeft = config.marginLeft, paint = config.highlightPaint,
                rowHeight = config.lineHeight,
                preWipeDistanceEm = config.preWipeDistanceEm,
                callbacks = callbacks,
            )
            if (!isPast || keepCompletedCharacterLift) {
                callbacks.drawGrowableVisualWordWipeHighlight(
                    canvas = canvas, line = line,
                    words = line.words.slice(activeHighlightState.activeRange),
                    progress = activeHighlightState.progress,
                    sweepX = activeHighlightState.sweepX,
                    paint = config.highlightPaint, rowHeight = config.lineHeight,
                    finalLiftRatio = config.foregroundLiftRatio, currentTimeMs = currentTimeMs,
                )
            }
            config.highlightPaint.maskFilter = null
            return
        }

        // ── CONTINUOUS LINE SWEEP PATH ────────────────────────────────────────
        // One sweepX per row, computed across ALL words + gaps on that row.
        // This mirrors lyricsRenderer.js: a single feathered gradient head
        // that travels left→right across the full phrase continuously.

        callbacks.drawMotionAccent(
            canvas = canvas, line = line, words = line.words,
            currentTimeMs = currentTimeMs, rowHeight = config.lineHeight,
            translateY = -config.lineHeight * config.foregroundLiftRatio,
        )

        if (isPast && !keepCompletedCharacterLift) {
            config.highlightPaint.maskFilter = null
            return
        }

        // Group words by row and draw one continuous sweep per row.
        val rowGroups = line.words.groupBy { it.yOffset }
        for ((_, rowWords) in rowGroups) {
            if (rowWords.isEmpty()) continue
            val rowComplete = currentTimeMs >= rowWords.last().endMs
            val sweepX = computeRowSweepX(
                rowWords = rowWords,
                currentTimeMs = currentTimeMs,
                marginLeft = config.marginLeft,
                featherPx = config.highlightPaint.textSize * config.preWipeDistanceEm,
                smootherStep = callbacks::smootherStep,
            )
            callbacks.drawRowSweepHighlight(
                canvas = canvas,
                line = line,
                rowWords = rowWords,
                sweepX = sweepX,
                paint = config.highlightPaint,
                rowHeight = config.lineHeight,
                finalLiftRatio = config.foregroundLiftRatio,
                currentTimeMs = currentTimeMs,
                isRowComplete = rowComplete || isPast,
            )
        }

        config.highlightPaint.maskFilter = null
    }

    /**
     * Compute a single continuous sweep position for an entire row.
     *
     * The head travels left→right across every word and every gap,
     * without ever resetting. Inside each word it follows the word's
     * own timing with smootherStep easing; inside gaps it interpolates
     * linearly so the head never freezes between syllables.
     */
    private fun computeRowSweepX(
        rowWords: List<LyricWord>,
        currentTimeMs: Long,
        marginLeft: Float,
        featherPx: Float,
        smootherStep: (Float) -> Float,
    ): Float {
        val rowStart = rowWords.first().startMs
        val rowEnd   = rowWords.last().endMs

        // Before the row starts: head is featherPx to the left of the first word.
        if (currentTimeMs <= rowStart) {
            return marginLeft + rowWords.first().xOffset - featherPx
        }
        // After the row ends: head is past the last word.
        if (currentTimeMs >= rowEnd) {
            val last = rowWords.last()
            return marginLeft + last.xOffset + last.width + featherPx
        }

        for (i in rowWords.indices) {
            val word = rowWords[i]
            val wordStartX = marginLeft + word.xOffset

            when {
                // ── Inside this word ─────────────────────────────────────────
                currentTimeMs in word.startMs..word.endMs -> {
                    val durationMs = (word.endMs - word.startMs).coerceAtLeast(1L).toFloat()
                    val rawProgress = (currentTimeMs - word.startMs).toFloat() / durationMs
                    return wordStartX + word.width * rawProgress.coerceIn(0f, 1f)
                }
                // ── In the gap BEFORE this word ───────────────────────────────
                i > 0 && currentTimeMs < word.startMs -> {
                    val prevWord = rowWords[i - 1]
                    if (currentTimeMs > prevWord.endMs) {
                        val gapDurationMs = (word.startMs - prevWord.endMs).coerceAtLeast(1L).toFloat()
                        val gapProgress = ((currentTimeMs - prevWord.endMs).toFloat() / gapDurationMs).coerceIn(0f, 1f)
                        val prevEndX = marginLeft + prevWord.xOffset + prevWord.width
                        return prevEndX + (wordStartX - prevEndX) * gapProgress
                    }
                }
            }
        }

        // Fallback: past last word.
        val last = rowWords.last()
        return marginLeft + last.xOffset + last.width
    }

    private fun drawBackgroundVocalLayer(
        canvas: Canvas,
        line: LyricLine,
        currentTimeMs: Long,
        keepCompletedCharacterLift: Boolean,
        fadeOutDelayMs: Long,
        config: KaraokeLineRenderConfig,
        callbacks: KaraokeLineRenderCallbacks,
    ) {
        if (line.backgroundWords.isEmpty()) return

        val revealProgress = ((currentTimeMs - line.startMs).toFloat() / config.backgroundRevealDurationMs).coerceIn(0f, 1f)
        val revealEase = smoothStep(revealProgress)
        val fadeOutStartMs = line.endMs + fadeOutDelayMs.coerceAtLeast(0L)
        val fadeOutProgress = ((currentTimeMs - fadeOutStartMs).toFloat() / config.backgroundFadeOutDurationMs).coerceIn(0f, 1f)
        val fadeOutEase = 1f - smoothStep(fadeOutProgress)
        val layerVisibility = (revealEase * fadeOutEase).coerceIn(0f, 1f)
        if (layerVisibility <= 0.01f) return

        val completedWordCount = line.backgroundWords.count { currentTimeMs >= it.endMs }
        val activeHighlightState = buildActiveHighlightState(line.backgroundWords, currentTimeMs, config.marginLeft)
        val resolvedActiveHighlightState = activeHighlightState ?: run {
            if (!keepCompletedCharacterLift || completedWordCount <= 0) {
                null
            } else {
                buildHeldHighlightState(
                    words = line.backgroundWords,
                    anchorIndex = (completedWordCount - 1).coerceIn(0, line.backgroundWords.lastIndex),
                    currentTimeMs = currentTimeMs,
                    marginLeft = config.marginLeft,
                    overshootPx = config.featherPx,
                )
            }
        }

        // Check if the active highlight is a growable sustained note — those still
        // need the per-word wipe path with character-level scale/glow.
        val isGrowableActive = resolvedActiveHighlightState?.isGrowable == true

        // ── Base (dim) text layer ──────────────────────────────────────────────
        config.backgroundBasePaint.alpha = (188f * layerVisibility).toInt().coerceIn(0, 188)

        if (isGrowableActive) {
            // Growable path: use per-word tail masking for the active range.
            for ((index, word) in line.backgroundWords.withIndex()) {
                if (resolvedActiveHighlightState != null && index in resolvedActiveHighlightState.activeRange) {
                    if (!resolvedActiveHighlightState.isContinuousRange) {
                        callbacks.drawWordTail(
                            canvas = canvas,
                            line = line,
                            word = word,
                            paint = config.backgroundBasePaint,
                            revealX = resolvedActiveHighlightState.sweepX,
                            rowHeight = config.backgroundLineHeight,
                        )
                    }
                    continue
                }
                if (index < completedWordCount) continue
                callbacks.drawWord(canvas, line, word, config.backgroundBasePaint)
            }
        } else {
            // Continuous sweep path: compute per-row sweepX and fade base text
            // behind the sweep, matching the foreground treatment.
            val bgTimeSec = currentTimeMs / 1000f
            val bgIsPast = bgTimeSec > line.backgroundWords.last().endMs / 1000f
            val bgIsActive = bgTimeSec >= line.backgroundWords.first().startMs / 1000f && !bgIsPast

            if (bgIsPast) {
                // All words past: don't draw dim base (highlight covers everything)
            } else {
                val bgRowGroups = line.backgroundWords.groupBy { it.yOffset }
                for ((_, rowWords) in bgRowGroups) {
                    if (rowWords.isEmpty()) continue
                    val rowSweepX = if (bgIsActive) {
                        computeRowSweepX(
                            rowWords = rowWords,
                            currentTimeMs = currentTimeMs,
                            marginLeft = config.marginLeft,
                            featherPx = config.featherPx,
                            smootherStep = callbacks::smootherStep,
                        )
                    } else {
                        // Before the background starts: draw all words in dim
                        config.marginLeft + rowWords.first().xOffset - config.featherPx
                    }
                    for (word in rowWords) {
                        val wordLeft = config.marginLeft + word.xOffset
                        // Only draw dim text AFTER the sweep
                        if (rowSweepX < wordLeft + word.width) {
                            callbacks.drawWordTail(
                                canvas = canvas,
                                line = line,
                                word = word,
                                paint = config.backgroundBasePaint,
                                revealX = rowSweepX,
                                rowHeight = config.backgroundLineHeight,
                            )
                        }
                    }
                }
            }
        }

        // ── Highlight layer ────────────────────────────────────────────────────
        config.backgroundHighlightPaint.alpha = (255f * layerVisibility).toInt().coerceIn(0, 255)

        callbacks.drawMotionAccent(
            canvas = canvas,
            line = line,
            words = line.backgroundWords,
            currentTimeMs = currentTimeMs,
            rowHeight = config.backgroundLineHeight,
            translateY = -config.backgroundLineHeight * config.backgroundLiftRatio,
        )

        if (isGrowableActive) {
            // ── GROWABLE PATH: per-word wipe with character lift ───────────────
            val completedLimit = resolvedActiveHighlightState!!.completedLimit
            for (index in 0 until completedLimit.coerceAtMost(line.backgroundWords.size)) {
                callbacks.drawCompletedWordWithLift(
                    canvas = canvas,
                    line = line,
                    word = line.backgroundWords[index],
                    paint = config.backgroundHighlightPaint,
                    rowHeight = config.backgroundLineHeight,
                    finalLiftRatio = config.backgroundLiftRatio,
                    currentTimeMs = currentTimeMs,
                    keepCharacterLift = keepCompletedCharacterLift,
                    visualWordDurationMs = resolvedActiveHighlightState.visualWordDurationMs,
                    visualWordStartMs = resolvedActiveHighlightState.visualWordStartMs,
                )
            }

            drawNextWordPreHighlight(
                canvas = canvas,
                line = line,
                words = line.backgroundWords,
                activeHighlightState = resolvedActiveHighlightState,
                currentTimeMs = currentTimeMs,
                marginLeft = config.marginLeft,
                paint = config.backgroundHighlightPaint,
                rowHeight = config.backgroundLineHeight,
                preWipeDistanceEm = config.preWipeDistanceEm,
                callbacks = callbacks,
            )

            callbacks.drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = line.backgroundWords.slice(resolvedActiveHighlightState.activeRange),
                progress = resolvedActiveHighlightState.progress,
                sweepX = resolvedActiveHighlightState.sweepX,
                paint = config.backgroundHighlightPaint,
                rowHeight = config.backgroundLineHeight,
                finalLiftRatio = config.backgroundLiftRatio,
                currentTimeMs = currentTimeMs,
            )
        } else {
            // ── CONTINUOUS ROW SWEEP: same engine as foreground ────────────────
            val bgTimeSec = currentTimeMs / 1000f
            val bgFirstStartSec = line.backgroundWords.first().startMs / 1000f
            val bgLastEndSec = line.backgroundWords.last().endMs / 1000f
            val bgIsPast = bgTimeSec > bgLastEndSec
            val bgIsActive = bgTimeSec >= bgFirstStartSec

            if (!bgIsActive && !bgIsPast) {
                // Nothing to highlight yet
                return
            }

            val rowGroups = line.backgroundWords.groupBy { it.yOffset }
            for ((_, rowWords) in rowGroups) {
                if (rowWords.isEmpty()) continue
                val rowComplete = currentTimeMs >= rowWords.last().endMs
                val sweepX = computeRowSweepX(
                    rowWords = rowWords,
                    currentTimeMs = currentTimeMs,
                    marginLeft = config.marginLeft,
                    featherPx = config.featherPx,
                    smootherStep = callbacks::smootherStep,
                )
                callbacks.drawRowSweepHighlight(
                    canvas = canvas,
                    line = line,
                    rowWords = rowWords,
                    sweepX = sweepX,
                    paint = config.backgroundHighlightPaint,
                    rowHeight = config.backgroundLineHeight,
                    finalLiftRatio = config.backgroundLiftRatio,
                    currentTimeMs = currentTimeMs,
                    isRowComplete = rowComplete || bgIsPast,
                )
            }
        }
    }

    private fun buildActiveHighlightState(
        words: List<LyricWord>,
        currentTimeMs: Long,
        marginLeft: Float,
    ): ActiveHighlightState? {
        val activeWordIndex = words.indexOfFirst { currentTimeMs in it.startMs..it.endMs }
        if (activeWordIndex < 0) {
            // No word is actively being sung — check if we're in a gap between
            // two same-row words. If so, return a synthetic state that sweeps
            // through the whitespace for liquid cross-word continuity.
            return buildGapTraversalState(words, currentTimeMs, marginLeft)
        }

        val activeWord = words[activeWordIndex]
        val visualWordRange = LyricsVisualWords.findVisualWordRange(words, activeWordIndex)
        val visualWord = if (!visualWordRange.isEmpty()) words.slice(visualWordRange) else listOf(activeWord)
        val singleRowVisualWord = visualWord.map { it.yOffset }.distinct().size == 1
        val combinedText = visualWord.joinToString(separator = "") { it.text }
        val combinedStartMs = visualWord.firstOrNull()?.startMs ?: activeWord.startMs
        val combinedEndMs = visualWord.lastOrNull()?.endMs ?: activeWord.endMs
        val isGrowable = singleRowVisualWord &&
            LyricsVisualWords.isGrowableVisualWord(combinedText, combinedStartMs, combinedEndMs)

        // Sweep the whole visual word (all of its syllables) as ONE continuous wipe
        // whenever those syllables share a row — NOT only for sustained "growable"
        // notes. Without this, fast multi-syllable words restart the wipe on every
        // syllable, which reads as a jumpy syllable-by-syllable sweep instead of a
        // single continuous barrido. `isGrowable` is kept separately — it only drives
        // the sustained glow styling, which the character renderer self-gates by
        // duration, so fast words still sweep smoothly without heavy bloom.
        val isMultiSyllable = singleRowVisualWord && !visualWordRange.isEmpty() &&
            visualWordRange.first != visualWordRange.last
        val sweepContinuously = isGrowable || isMultiSyllable

        val activeRange = if (sweepContinuously && !visualWordRange.isEmpty()) {
            visualWordRange
        } else {
            activeWordIndex..activeWordIndex
        }
        val rangeWords = words.slice(activeRange)
        val highlightStartMs = if (sweepContinuously) combinedStartMs else activeWord.startMs
        val highlightEndMs = if (sweepContinuously) combinedEndMs else activeWord.endMs
        val durationMs = (highlightEndMs - highlightStartMs).coerceAtLeast(1L).toFloat()
        val progress = ((currentTimeMs - highlightStartMs).coerceAtLeast(0L).toFloat() / durationMs).coerceIn(0f, 1f)
        val rangeLeft = marginLeft + rangeWords.first().xOffset
        val rangeWidth = (rangeWords.last().xOffset + rangeWords.last().width) - rangeWords.first().xOffset
        val sweepX = rangeLeft + rangeWidth.coerceAtLeast(0f) * progress

        val visualWordDurationMs = (combinedEndMs - combinedStartMs).coerceAtLeast(1L).toFloat()

        return ActiveHighlightState(
            activeWordIndex = activeWordIndex,
            completedLimit = if (sweepContinuously) activeRange.first else activeWordIndex,
            activeRange = activeRange,
            progress = progress,
            sweepX = sweepX,
            isGrowable = isGrowable,
            visualWordDurationMs = visualWordDurationMs,
            visualWordStartMs = combinedStartMs,
        )
    }

    private fun buildHeldHighlightState(
        words: List<LyricWord>,
        anchorIndex: Int,
        currentTimeMs: Long,
        marginLeft: Float,
        overshootPx: Float,
    ): ActiveHighlightState? {
        if (words.isEmpty() || anchorIndex !in words.indices) return null

        val anchorWord = words[anchorIndex]
        val visualWordRange = LyricsVisualWords.findVisualWordRange(words, anchorIndex)
        val visualWord = if (!visualWordRange.isEmpty()) words.slice(visualWordRange) else listOf(anchorWord)
        val singleRowVisualWord = visualWord.map { it.yOffset }.distinct().size == 1
        val combinedText = visualWord.joinToString(separator = "") { it.text }
        val combinedStartMs = visualWord.firstOrNull()?.startMs ?: anchorWord.startMs
        val combinedEndMs = visualWord.lastOrNull()?.endMs ?: anchorWord.endMs
        val isGrowable = singleRowVisualWord &&
            LyricsVisualWords.isGrowableVisualWord(combinedText, combinedStartMs, combinedEndMs)

        // Keep the same continuous-sweep grouping the active state uses so a
        // multi-syllable word holds (and releases) as one unit after it completes.
        val isMultiSyllable = singleRowVisualWord && !visualWordRange.isEmpty() &&
            visualWordRange.first != visualWordRange.last
        val sweepContinuously = isGrowable || isMultiSyllable

        val activeRange = if (sweepContinuously && !visualWordRange.isEmpty()) {
            visualWordRange
        } else {
            anchorIndex..anchorIndex
        }

        val rangeWords = words.slice(activeRange)
        val rangeLeft = marginLeft + rangeWords.first().xOffset
        val rangeWidth = (rangeWords.last().xOffset + rangeWords.last().width) - rangeWords.first().xOffset
        val clampedRangeWidth = rangeWidth.coerceAtLeast(1f)
        val visualDurationMs = (combinedEndMs - combinedStartMs).coerceAtLeast(1L).toFloat()
        val completedAgeMs = (currentTimeMs - combinedEndMs).coerceAtLeast(0L).toFloat()
        val sweepSettle = smoothStep((completedAgeMs / (visualDurationMs * 0.35f)).coerceIn(0f, 1f))
        val sweepX = rangeLeft + clampedRangeWidth + overshootPx.coerceAtLeast(0f) * sweepSettle
        val drawableGlyphCount = rangeWords.sumOf(::getDrawableGlyphCount).coerceAtLeast(1)
        val settledProgress = 1.5f + (drawableGlyphCount - 1).coerceAtLeast(0) * 0.09f
        val holdProgress = (1f + completedAgeMs / visualDurationMs)
            .coerceIn(1f, settledProgress)

        return ActiveHighlightState(
            activeWordIndex = anchorIndex,
            completedLimit = if (sweepContinuously) activeRange.first else anchorIndex,
            activeRange = activeRange,
            progress = holdProgress,
            sweepX = sweepX,
            isGrowable = isGrowable,
            visualWordDurationMs = visualDurationMs,
            visualWordStartMs = combinedStartMs,
        )
    }

    private fun drawNextWordPreHighlight(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        activeHighlightState: ActiveHighlightState?,
        currentTimeMs: Long,
        marginLeft: Float,
        paint: Paint,
        rowHeight: Float,
        preWipeDistanceEm: Float,
        callbacks: KaraokeLineRenderCallbacks,
    ) {
        if (activeHighlightState == null) return

        // For any continuous visual word the active range spans multiple syllables.
        // The pre-highlight must start from the LAST word in the range, not from
        // activeWordIndex (which may be mid-range). Otherwise it would target the
        // next *syllable of the same word* — which is already part of the continuous
        // sweep — instead of the next real word, causing a double draw and an abrupt
        // snap at the boundary.
        val isContinuousRange = activeHighlightState.isContinuousRange
        val anchorIndex = if (isContinuousRange) {
            activeHighlightState.activeRange.last
        } else {
            activeHighlightState.activeWordIndex
        }
        if (anchorIndex !in words.indices) return
        if (anchorIndex >= words.lastIndex) return

        val currentWord = words[anchorIndex]
        val nextWord = words[anchorIndex + 1]
        if (currentTimeMs >= nextWord.endMs) return

        // Only skip pre-highlight if the next word is on a DIFFERENT row.
        // Cross-word pre-highlight on the same row is essential for liquid continuity.
        if (currentWord.yOffset != nextWord.yOffset) return

        val preProgress = LyricsSweepPhysics.preHighlightProgress(
            sourceWidthPx = currentWord.width,
            fontSizePx = paint.textSize,
            preWipeDistanceEm = preWipeDistanceEm,
            sourceStartMs = currentWord.startMs,
            sourceEndMs = currentWord.endMs,
            currentTimeMs = currentTimeMs,
        )
        if (preProgress <= 0f) return

        callbacks.drawWordPreHighlight(
            canvas = canvas,
            line = line,
            word = nextWord,
            progress = preProgress,
            paint = paint,
            rowHeight = rowHeight,
        )
    }

    /**
     * During inter-word gaps (after word[i] ends, before word[i+1] starts),
     * return a synthetic state that sweeps through the whitespace. This keeps
     * the animation alive between words instead of creating a dead zone.
     *
     * The returned state has progress > 1 so shouldRenderWipeShader returns
     * false — no wipe shader is drawn. Instead, the sweep position moves
     * forward organically, and drawNextWordPreHighlight keeps the next word
     * "warm" with its held pre-highlight.
     */
    private fun buildGapTraversalState(
        words: List<LyricWord>,
        currentTimeMs: Long,
        marginLeft: Float,
    ): ActiveHighlightState? {
        for (i in 0 until words.size - 1) {
            val prevWord = words[i]
            val nextWord = words[i + 1]
            if (currentTimeMs > prevWord.endMs && currentTimeMs < nextWord.startMs
                && prevWord.yOffset == nextWord.yOffset
            ) {
                val gapStartMs = prevWord.endMs
                val gapEndMs = nextWord.startMs
                val gapDurationMs = (gapEndMs - gapStartMs).coerceAtLeast(1L).toFloat()
                val gapProgress = smoothStep(
                    ((currentTimeMs - gapStartMs).toFloat() / gapDurationMs).coerceIn(0f, 1f)
                )

                val prevEndX = marginLeft + prevWord.xOffset + prevWord.width
                val nextStartX = marginLeft + nextWord.xOffset
                val sweepX = prevEndX + (nextStartX - prevEndX) * gapProgress

                val visualWordDuration = (prevWord.endMs - prevWord.startMs).coerceAtLeast(1L).toFloat()

                return ActiveHighlightState(
                    activeWordIndex = i,
                    completedLimit = i + 1,
                    activeRange = i..i,
                    progress = 1.2f, // > 1 so wipe shader is skipped
                    sweepX = sweepX,
                    isGrowable = false,
                    visualWordDurationMs = visualWordDuration,
                    visualWordStartMs = prevWord.startMs,
                )
            }
        }
        return null
    }

    private fun smoothStep(value: Float): Float {
        val t = value.coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }
}
