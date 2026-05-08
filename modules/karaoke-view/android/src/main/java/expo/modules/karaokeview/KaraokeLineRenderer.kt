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
    val isLineByLine: Boolean,
    val basePaint: Paint,
    val highlightPaint: Paint,
    val backgroundBasePaint: Paint,
    val backgroundHighlightPaint: Paint,
)

internal data class ActiveHighlightState(
    val activeWordIndex: Int,
    val completedLimit: Int,
    val activeRange: IntRange,
    val progress: Float,
    val sweepX: Float,
    val isGrowable: Boolean,
)

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
    )
    fun drawWordPreHighlight(
        canvas: Canvas,
        line: LyricLine,
        word: LyricWord,
        progress: Float,
        paint: Paint,
        rowHeight: Float,
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
    private val foregroundLiftRatio = 0.035f
    private val backgroundLiftRatio = 0.025f

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
        val isRecedingFromActive = isPast &&
            relativeIndex == -1 &&
            recedingAgeMs < config.hierarchyTransitionWindowMs.toLong()
        // Keep a line visually active while its own timing window is still active,
        // and through its final lift/sweep settle.
        val visualRelativeIndex = if (isActive || isFinishingAfterEnd) 0 else relativeIndex
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
        // No setShadowLayer blur — only soft BlurMaskFilter for lines far below (2+)
        val blurRadius = when {
            isBelowActive && distance == 2 -> 3.5f * config.density
            isBelowActive && distance >= 3 -> 5.5f * config.density
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
            isAboveActive -> 0f
            else -> 2f * config.density
        }

        canvas.save()
        canvas.scale(scale, scale, config.marginLeft, line.y + line.focusCenterYOffset)
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
                callbacks.drawWordTail(
                    canvas = canvas,
                    line = line,
                    word = word,
                    paint = config.basePaint,
                    revealX = activeHighlightState.sweepX,
                    rowHeight = config.lineHeight,
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
            isFinishingAfterEnd ||
            isRecedingFromActive

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
        val resolvedActiveHighlightState = activeHighlightState ?: run {
            if (!keepCompletedCharacterLift || completedWordCount <= 0) {
                null
            } else {
                buildHeldHighlightState(
                    words = line.words,
                    anchorIndex = (completedWordCount - 1).coerceIn(0, line.words.lastIndex),
                    currentTimeMs = currentTimeMs,
                    marginLeft = config.marginLeft,
                    overshootPx = config.featherPx,
                )
            }
        }
        config.highlightPaint.alpha = lineHighlightAlpha
        config.highlightPaint.maskFilter = if (lineHighlightBlurRadius > 0f) {
            BlurMaskFilter(lineHighlightBlurRadius, BlurMaskFilter.Blur.NORMAL)
        } else {
            null
        }

        val completedLimit = resolvedActiveHighlightState?.completedLimit ?: completedWordCount
        for (index in 0 until completedLimit.coerceAtMost(line.words.size)) {
            callbacks.drawCompletedWordWithLift(
                canvas = canvas,
                line = line,
                word = line.words[index],
                paint = config.highlightPaint,
                rowHeight = config.lineHeight,
                finalLiftRatio = foregroundLiftRatio,
                currentTimeMs = currentTimeMs,
                keepCharacterLift = keepCompletedCharacterLift,
            )
        }

        callbacks.drawMotionAccent(
            canvas = canvas,
            line = line,
            words = line.words,
            currentTimeMs = currentTimeMs,
            rowHeight = config.lineHeight,
            translateY = -config.lineHeight * foregroundLiftRatio,
        )

        drawNextWordPreHighlight(
            canvas = canvas,
            line = line,
            words = line.words,
            activeHighlightState = resolvedActiveHighlightState,
            currentTimeMs = currentTimeMs,
            paint = config.highlightPaint,
            rowHeight = config.lineHeight,
            callbacks = callbacks,
        )

        if (resolvedActiveHighlightState == null || (isPast && !keepCompletedCharacterLift)) {
            config.highlightPaint.maskFilter = null
            return
        }

        if (resolvedActiveHighlightState.isGrowable) {
            callbacks.drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = line.words.slice(resolvedActiveHighlightState.activeRange),
                progress = resolvedActiveHighlightState.progress,
                sweepX = resolvedActiveHighlightState.sweepX,
                paint = config.highlightPaint,
                rowHeight = config.lineHeight,
                finalLiftRatio = foregroundLiftRatio,
                currentTimeMs = currentTimeMs,
            )
        } else {
            callbacks.drawWordWipeHighlight(
                canvas = canvas,
                line = line,
                word = line.words[resolvedActiveHighlightState.activeWordIndex],
                progress = resolvedActiveHighlightState.progress,
                paint = config.highlightPaint,
                rowHeight = config.lineHeight,
                finalLiftRatio = foregroundLiftRatio,
                useCharacterLift = true,
                currentTimeMs = currentTimeMs,
            )
        }
        config.highlightPaint.maskFilter = null
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

        config.backgroundBasePaint.alpha = (188f * layerVisibility).toInt().coerceIn(0, 188)
        for ((index, word) in line.backgroundWords.withIndex()) {
            if (resolvedActiveHighlightState != null && index in resolvedActiveHighlightState.activeRange) {
                if (!resolvedActiveHighlightState.isGrowable) {
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

        config.backgroundHighlightPaint.alpha = (255f * layerVisibility).toInt().coerceIn(0, 255)
        val completedLimit = resolvedActiveHighlightState?.completedLimit ?: completedWordCount
        for (index in 0 until completedLimit.coerceAtMost(line.backgroundWords.size)) {
            callbacks.drawCompletedWordWithLift(
                canvas = canvas,
                line = line,
                word = line.backgroundWords[index],
                paint = config.backgroundHighlightPaint,
                rowHeight = config.backgroundLineHeight,
                finalLiftRatio = backgroundLiftRatio,
                currentTimeMs = currentTimeMs,
                keepCharacterLift = keepCompletedCharacterLift,
            )
        }

        callbacks.drawMotionAccent(
            canvas = canvas,
            line = line,
            words = line.backgroundWords,
            currentTimeMs = currentTimeMs,
            rowHeight = config.backgroundLineHeight,
            translateY = -config.backgroundLineHeight * 0.025f,
        )

        drawNextWordPreHighlight(
            canvas = canvas,
            line = line,
            words = line.backgroundWords,
            activeHighlightState = resolvedActiveHighlightState,
            currentTimeMs = currentTimeMs,
            paint = config.backgroundHighlightPaint,
            rowHeight = config.backgroundLineHeight,
            callbacks = callbacks,
        )

        if (resolvedActiveHighlightState == null) {
            return
        }

        if (resolvedActiveHighlightState.isGrowable) {
            callbacks.drawGrowableVisualWordWipeHighlight(
                canvas = canvas,
                line = line,
                words = line.backgroundWords.slice(resolvedActiveHighlightState.activeRange),
                progress = resolvedActiveHighlightState.progress,
                sweepX = resolvedActiveHighlightState.sweepX,
                paint = config.backgroundHighlightPaint,
                rowHeight = config.backgroundLineHeight,
                finalLiftRatio = backgroundLiftRatio,
                currentTimeMs = currentTimeMs,
            )
        } else {
            callbacks.drawWordWipeHighlight(
                canvas = canvas,
                line = line,
                word = line.backgroundWords[resolvedActiveHighlightState.activeWordIndex],
                progress = resolvedActiveHighlightState.progress,
                paint = config.backgroundHighlightPaint,
                rowHeight = config.backgroundLineHeight,
                finalLiftRatio = backgroundLiftRatio,
                useCharacterLift = true,
                currentTimeMs = currentTimeMs,
            )
        }
    }

    private fun buildActiveHighlightState(
        words: List<LyricWord>,
        currentTimeMs: Long,
        marginLeft: Float,
    ): ActiveHighlightState? {
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

        val activeRange = if (isGrowable && !visualWordRange.isEmpty()) {
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
            completedLimit = if (isGrowable) activeRange.first else anchorIndex,
            activeRange = activeRange,
            progress = holdProgress,
            sweepX = sweepX,
            isGrowable = isGrowable,
        )
    }

    private fun drawNextWordPreHighlight(
        canvas: Canvas,
        line: LyricLine,
        words: List<LyricWord>,
        activeHighlightState: ActiveHighlightState?,
        currentTimeMs: Long,
        paint: Paint,
        rowHeight: Float,
        callbacks: KaraokeLineRenderCallbacks,
    ) {
        if (activeHighlightState == null) return
        val activeWordIndex = activeHighlightState.activeWordIndex
        if (activeWordIndex !in words.indices) return
        if (activeWordIndex >= words.lastIndex) return

        val currentWord = words[activeWordIndex]
        val nextWord = words[activeWordIndex + 1]
        if (currentTimeMs >= nextWord.startMs) return
        val nextIsLastWord = activeWordIndex + 1 == words.lastIndex
        if (LyricsVisualWords.shouldInsertSpacing(currentWord, nextWord) && !nextIsLastWord) return

        val currentDurationMs = (currentWord.endMs - currentWord.startMs).coerceAtLeast(1L).toFloat()
        val currentWidth = currentWord.width.coerceAtLeast(0.1f)
        val gradientDistancePx = 0.375f * paint.textSize
        val gradientDurationMs = (gradientDistancePx / currentWidth) * currentDurationMs
        if (gradientDurationMs <= 0f) return

        val clampedGradientDurationMs = gradientDurationMs.coerceIn(1f, currentDurationMs)
        val preHighlightDelayMs = currentDurationMs - clampedGradientDurationMs
        val elapsedMs = (currentTimeMs - currentWord.startMs).toFloat()
        if (elapsedMs < preHighlightDelayMs || elapsedMs > currentDurationMs) return

        val preProgress = ((elapsedMs - preHighlightDelayMs) / clampedGradientDurationMs).coerceIn(0f, 1f)
        callbacks.drawWordPreHighlight(
            canvas = canvas,
            line = line,
            word = nextWord,
            progress = preProgress,
            paint = paint,
            rowHeight = rowHeight,
        )
    }

    private fun smoothStep(value: Float): Float {
        val t = value.coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }
}
