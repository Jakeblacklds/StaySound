package expo.modules.karaokeview

import android.graphics.Paint
import java.text.BreakIterator

internal data class LyricsLayoutConfig(
    val width: Int,
    val marginLeft: Float,
    val marginRight: Float,
    val lineHeight: Float,
    val lineSpacing: Float,
    val spaceWidth: Float,
    val backgroundLineHeight: Float,
    val backgroundSpaceWidth: Float,
    val backgroundGap: Float,
)

internal class LyricsLayoutEngine {
    fun layout(
        lines: List<LyricLine>,
        mainPaint: Paint,
        backgroundPaint: Paint,
        config: LyricsLayoutConfig,
    ) {
        if (config.width <= 0) return

        val maxWidth = config.width - config.marginLeft - config.marginRight
        var currentY = 0f

        for (line in lines) {
            line.y = currentY
            val hasMain = line.words.isNotEmpty()
            val hasBackground = line.backgroundWords.isNotEmpty()
            val mainMetrics = if (hasMain) {
                layoutWords(
                    words = line.words,
                    paint = mainPaint,
                    maxWidth = maxWidth,
                    topOffset = 0f,
                    rowHeight = config.lineHeight,
                    spacingWidth = config.spaceWidth,
                )
            } else {
                LayoutMetrics(0f, 0f)
            }

            line.backgroundPlacement = BackgroundPlacement.AFTER
            line.mainTopOffset = 0f
            line.mainHeight = mainMetrics.height
            line.backgroundTopOffset = if (hasBackground && hasMain) {
                mainMetrics.height + config.backgroundGap
            } else {
                0f
            }

            val backgroundMetrics = if (hasBackground) {
                layoutWords(
                    words = line.backgroundWords,
                    paint = backgroundPaint,
                    maxWidth = maxWidth,
                    topOffset = line.backgroundTopOffset,
                    rowHeight = config.backgroundLineHeight,
                    spacingWidth = config.backgroundSpaceWidth,
                )
            } else {
                LayoutMetrics(0f, 0f)
            }

            line.backgroundHeight = backgroundMetrics.height
            line.totalWidth = maxOf(mainMetrics.width, backgroundMetrics.width)
            line.totalHeight = maxOf(
                line.mainTopOffset + line.mainHeight,
                line.backgroundTopOffset + line.backgroundHeight
            ).coerceAtLeast(config.lineHeight)
            line.focusCenterYOffset = if (line.mainHeight > 0f) {
                line.mainTopOffset + line.mainHeight * 0.5f
            } else {
                line.totalHeight * 0.5f
            }

            currentY += line.totalHeight + config.lineSpacing
        }
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
            val (glyphUnits, drawableGlyphCount) = buildGlyphUnits(word.text, paint, word.width)
            word.glyphUnits = glyphUnits
            word.drawableGlyphCount = drawableGlyphCount
            val spacingBefore = if (LyricsVisualWords.shouldInsertSpacing(previousWord, word)) {
                spacingWidth
            } else {
                0f
            }

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

    private fun buildGlyphUnits(
        text: String,
        paint: Paint,
        measuredWordWidth: Float,
    ): Pair<List<LyricGlyphUnit>, Int> {
        if (text.isEmpty()) return emptyList<LyricGlyphUnit>() to 0

        val iterator = BreakIterator.getCharacterInstance()
        iterator.setText(text)
        val rawUnits = mutableListOf<LyricGlyphUnit>()
        var advanceX = 0f
        var start = iterator.first()
        var end = iterator.next()
        var drawableWidth = 0f
        var drawableCount = 0

        while (end != BreakIterator.DONE) {
            val glyphText = text.substring(start, end)
            val glyphWidth = paint.measureText(glyphText)
            val isWhitespace = glyphText.all { it.isWhitespace() }
            rawUnits += LyricGlyphUnit(
                text = glyphText,
                width = glyphWidth,
                advanceX = advanceX,
                centerRatio = 0.5f,
                isWhitespace = isWhitespace,
            )
            if (!isWhitespace && glyphWidth > 0f) {
                drawableWidth += glyphWidth
                drawableCount += 1
            }
            advanceX += glyphWidth
            start = end
            end = iterator.next()
        }

        val targetWidth = when {
            measuredWordWidth > 0f -> measuredWordWidth
            drawableWidth > 0f -> drawableWidth
            else -> 1f
        }

        var drawableCursor = 0f
        val units = rawUnits.map { unit ->
            if (unit.isWhitespace || unit.width <= 0f) {
                unit
            } else {
                val center = drawableCursor + unit.width * 0.5f
                val ratio = (center / targetWidth).coerceIn(0f, 1f)
                drawableCursor += unit.width
                unit.copy(centerRatio = ratio)
            }
        }

        return units to drawableCount
    }

    private data class LayoutMetrics(
        val height: Float,
        val width: Float,
    )
}
