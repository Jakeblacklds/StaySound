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
        displayMode: String = "none"
    ) {
        if (config.width <= 0) return

        val maxWidth = config.width - config.marginLeft - config.marginRight
        var currentY = 0f

        val showTranslation = displayMode == "translate" || displayMode == "both"
        val showRomanization = displayMode == "romanize" || displayMode == "both"

        for (line in lines) {
            line.y = currentY
            val hasMain = line.words.isNotEmpty()
            val hasBackground = line.backgroundWords.isNotEmpty()

            // Check if this line has word-synced romanization (words contain non-null romanizedText)
            val hasWordSyncedRom = showRomanization && line.words.any { it.romanizedText != null }

            val mainMetrics = if (hasMain) {
                layoutWords(
                    words = line.words,
                    paint = mainPaint,
                    subtextPaint = backgroundPaint,
                    maxWidth = maxWidth,
                    topOffset = 0f,
                    rowHeight = config.lineHeight,
                    subtextRowHeight = config.backgroundLineHeight,
                    spacingWidth = config.spaceWidth,
                    showRomanization = hasWordSyncedRom
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
                    subtextPaint = backgroundPaint,
                    maxWidth = maxWidth,
                    topOffset = line.backgroundTopOffset,
                    rowHeight = config.backgroundLineHeight,
                    subtextRowHeight = config.backgroundLineHeight,
                    spacingWidth = config.backgroundSpaceWidth,
                    showRomanization = false // No word-synced romanization for background vocals
                )
            } else {
                LayoutMetrics(0f, 0f)
            }

            line.backgroundHeight = backgroundMetrics.height
            
            // RTL shifting helper
            val isRtl = line.words.any { LyricsBidiHelper.isRtl(it.text) }
            if (isRtl) {
                val mainRows = line.words.groupBy { it.yOffset }
                for ((_, rowWords) in mainRows) {
                    LyricsBidiHelper.adjustOffsetsForRtl(rowWords, maxWidth)
                }
                val bgRows = line.backgroundWords.groupBy { it.yOffset }
                for ((_, rowWords) in bgRows) {
                    LyricsBidiHelper.adjustOffsetsForRtl(rowWords, maxWidth)
                }
            }
            // Translation & Romanization block layouts
            var blockY = maxOf(
                line.mainTopOffset + line.mainHeight,
                line.backgroundTopOffset + line.backgroundHeight
            )

            // Block Translation:
            if (showTranslation && !line.translatedText.isNullOrBlank()) {
                val gap = if (blockY > 0f) config.backgroundGap else 0f
                val (rows, offset, height) = LyricsTranslationManager.layoutBlockText(
                    text = line.translatedText!!,
                    paint = backgroundPaint,
                    maxWidth = maxWidth,
                    topOffset = blockY + gap,
                    lineHeight = config.backgroundLineHeight
                )
                line.translationRows = rows
                line.translationY = offset
                line.translationHeight = height
                blockY = offset + height
            } else {
                line.translationRows = emptyList()
                line.translationY = 0f
                line.translationHeight = 0f
            }

            // Block Romanization (only if line has romanizedText and is NOT word-synced):
            if (showRomanization && !line.romanizedText.isNullOrBlank() && !hasWordSyncedRom) {
                val gap = if (blockY > 0f) config.backgroundGap else 0f
                val (rows, offset, height) = LyricsTranslationManager.layoutBlockText(
                    text = line.romanizedText!!,
                    paint = backgroundPaint,
                    maxWidth = maxWidth,
                    topOffset = blockY + gap,
                    lineHeight = config.backgroundLineHeight
                )
                line.romanizationRows = rows
                line.romanizationY = offset
                line.romanizationHeight = height
                blockY = offset + height
            } else {
                line.romanizationRows = emptyList()
                line.romanizationY = 0f
                line.romanizationHeight = 0f
            }

            line.totalWidth = maxOf(mainMetrics.width, backgroundMetrics.width)
            line.totalHeight = blockY.coerceAtLeast(config.lineHeight)
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
        subtextPaint: Paint,
        maxWidth: Float,
        topOffset: Float,
        rowHeight: Float,
        subtextRowHeight: Float,
        spacingWidth: Float,
        showRomanization: Boolean
    ): LayoutMetrics {
        if (words.isEmpty()) {
            return LayoutMetrics(0f, 0f)
        }

        var offsetX = 0f
        var rowOffset = 0f
        var maxRowWidth = 0f
        var previousWord: LyricWord? = null
        var rowMaxHeight = rowHeight

        for (word in words) {
            var wordWidth = paint.measureText(word.text)
            
            // Adjust size for word-synced romanization if active
            if (showRomanization && word.romanizedText != null) {
                val romWidth = subtextPaint.measureText(word.romanizedText!!)
                wordWidth = maxOf(wordWidth, romWidth)
                rowMaxHeight = rowHeight + subtextRowHeight
            }

            word.width = wordWidth
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
                rowOffset += rowMaxHeight
                rowMaxHeight = rowHeight // Reset row height
                if (showRomanization && word.romanizedText != null) {
                    rowMaxHeight = rowHeight + subtextRowHeight
                }
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
            height = rowOffset + rowMaxHeight,
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
