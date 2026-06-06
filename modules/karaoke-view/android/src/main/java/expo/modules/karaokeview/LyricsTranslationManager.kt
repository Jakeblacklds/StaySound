package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Paint

internal object LyricsTranslationManager {

    /**
     * Splits translation or romanization text into multiple rows to fit inside maxWidth.
     * Returns a Triple of (list of wrapped rows, yOffset, total height).
     */
    fun layoutBlockText(
        text: String,
        paint: Paint,
        maxWidth: Float,
        topOffset: Float,
        lineHeight: Float
    ): Triple<List<String>, Float, Float> {
        val rows = mutableListOf<String>()
        val words = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        
        if (words.isEmpty()) {
            return Triple(emptyList(), topOffset, 0f)
        }

        var currentRow = StringBuilder(words[0])
        for (i in 1 until words.size) {
            val word = words[i]
            val testRow = "$currentRow $word"
            if (paint.measureText(testRow) > maxWidth) {
                rows.add(currentRow.toString())
                currentRow = StringBuilder(word)
            } else {
                currentRow.append(" ").append(word)
            }
        }
        if (currentRow.isNotEmpty()) {
            rows.add(currentRow.toString())
        }

        val height = rows.size * lineHeight
        return Triple(rows, topOffset, height)
    }

    /**
     * Renders translation block text below the main/background vocals.
     */
    fun drawTranslationBlock(
        canvas: Canvas,
        line: LyricLine,
        paint: Paint,
        marginLeft: Float,
        lineHeight: Float,
        isRtlLine: Boolean,
        maxWidth: Float
    ) {
        val yOffset = line.y + line.translationY
        val originalAlpha = paint.alpha
        // Translate text is at 50% opacity of active/inactive state
        paint.alpha = (originalAlpha * 0.5f).toInt().coerceIn(0, 255)

        for (i in line.translationRows.indices) {
            val rowText = line.translationRows[i]
            val textWidth = paint.measureText(rowText)
            val x = if (isRtlLine) {
                marginLeft + maxWidth - textWidth
            } else {
                marginLeft
            }
            canvas.drawText(rowText, x, yOffset + i * lineHeight + lineHeight * 0.7f, paint)
        }
        paint.alpha = originalAlpha
    }

    /**
     * Renders romanization block text below the main/background vocals.
     */
    fun drawRomanizationBlock(
        canvas: Canvas,
        line: LyricLine,
        paint: Paint,
        marginLeft: Float,
        lineHeight: Float,
        isRtlLine: Boolean,
        maxWidth: Float
    ) {
        val yOffset = line.y + line.romanizationY
        val originalAlpha = paint.alpha
        paint.alpha = (originalAlpha * 0.8f).toInt().coerceIn(0, 255) // Romanization is slightly brighter

        for (i in line.romanizationRows.indices) {
            val rowText = line.romanizationRows[i]
            val textWidth = paint.measureText(rowText)
            val x = if (isRtlLine) {
                marginLeft + maxWidth - textWidth
            } else {
                marginLeft
            }
            canvas.drawText(rowText, x, yOffset + i * lineHeight + lineHeight * 0.7f, paint)
        }
        paint.alpha = originalAlpha
    }

    /**
     * Helper to render word-synced inline romanization (transliteration) stacked vertically under a word.
     */
    fun drawWordSyncedRomanization(
        canvas: Canvas,
        word: LyricWord,
        paint: Paint,
        line: LyricLine,
        originalRowHeight: Float,
        subtextRowHeight: Float,
        marginLeft: Float,
        isRtl: Boolean
    ) {
        val romanized = word.romanizedText ?: return
        val originalAlpha = paint.alpha
        paint.alpha = (originalAlpha * 0.7f).toInt().coerceIn(0, 255) // Stacked transliteration opacity

        val originalWidth = paint.measureText(word.text)
        val romanizedWidth = paint.measureText(romanized)
        val wordX = marginLeft + word.xOffset

        // Center the romanized text under the original word if its width differs
        val x = wordX + (originalWidth - romanizedWidth) / 2f
        val y = line.y + word.yOffset + originalRowHeight + subtextRowHeight * 0.7f

        canvas.drawText(romanized, x, y, paint)
        paint.alpha = originalAlpha
    }
}
