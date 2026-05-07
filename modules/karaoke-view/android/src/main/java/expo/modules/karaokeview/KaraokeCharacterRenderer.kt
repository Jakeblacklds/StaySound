package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import java.text.BreakIterator

internal fun drawVisualWordCharactersWithLift(
    canvas: Canvas,
    line: LyricLine,
    words: List<LyricWord>,
    progress: Float,
    paint: Paint,
    rowHeight: Float,
    finalLiftRatio: Float,
    marginLeft: Float,
    density: Float,
    glowColor: Int,
    smootherStep: (Float) -> Float,
) {
    if (words.isEmpty()) return

    val visualWordDurationMs = (words.last().endMs - words.first().startMs).coerceAtLeast(1L).toFloat()
    val wordGlyphUnits = words.map { word ->
        if (word.glyphUnits.isNotEmpty()) {
            word.glyphUnits
        } else {
            buildFallbackGlyphUnits(word.text, paint)
        }
    }
    var charCount = 0
    var minWordX = Float.POSITIVE_INFINITY
    var maxWordX = Float.NEGATIVE_INFINITY

    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        val glyphUnits = wordGlyphUnits[wordIndex]
        for (unit in glyphUnits) {
            if (unit.isWhitespace || unit.width <= 0f) continue
            val glyphLeft = wordBaseX + unit.advanceX
            val glyphRight = glyphLeft + unit.width
            if (glyphLeft < minWordX) minWordX = glyphLeft
            if (glyphRight > maxWordX) maxWordX = glyphRight
            charCount += 1
        }
    }
    if (charCount <= 0) return

    val visualWordWidth = (maxWordX - minWordX).coerceAtLeast(1f)
    val durationProgress = ((visualWordDurationMs - 1000f) / 4000f).coerceIn(0f, 1f)
    val durationEase = durationProgress * durationProgress * durationProgress
    val combinedText = words.joinToString(separator = "") { it.text }
    val isSustainedVisualWord = LyricsVisualWords.isGrowableVisualWord(
        text = combinedText,
        startMs = words.first().startMs,
        endMs = words.last().endMs,
    )
    val firstDurationMs = words.firstOrNull()?.let { (it.endMs - it.startMs).coerceAtLeast(1L).toFloat() }
        ?: visualWordDurationMs
    val penaltyFactor = if (words.size > 1) {
        val imbalanceRatio = firstDurationMs / visualWordDurationMs
        val penaltyThreshold = 0.25f
        if (imbalanceRatio < penaltyThreshold) {
            val minPenaltyFactor = 0.5f
            val penaltyProgress = (imbalanceRatio / penaltyThreshold).coerceIn(0f, 1f)
            minPenaltyFactor + (1f - minPenaltyFactor) * penaltyProgress
        } else {
            1f
        }
    } else {
        1f
    }
    val isLongWord = charCount > 5
    val isShortDuration = visualWordDurationMs < 1500f
    val hasUnbalancedSyllables = penaltyFactor < 0.95f
    var maxDecayRate = 0f
    if (isLongWord || isShortDuration || hasUnbalancedSyllables) {
        var decayStrength = 0f
        if (isLongWord) {
            decayStrength += (((charCount - 5).toFloat() / 3f).coerceIn(0f, 1f)) * 0.4f
        }
        if (isShortDuration) {
            decayStrength += ((1f - ((visualWordDurationMs - 1000f) / 500f)).coerceIn(0f, 1f)) * 0.4f
        }
        if (hasUnbalancedSyllables) {
            decayStrength += Math.pow((1f - penaltyFactor).toDouble(), 0.7).toFloat() * 1.2f
        }
        maxDecayRate = decayStrength.coerceAtMost(0.85f)
    }
    var drawableIndex = 0

    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        val baseY = line.y + word.yOffset + rowHeight * 0.7f
        val glyphUnits = wordGlyphUnits[wordIndex]

        for (unit in glyphUnits) {
            if (unit.isWhitespace || unit.width <= 0f) {
                continue
            }

            val glyphLeft = wordBaseX + unit.advanceX
            val glyphCenterX = glyphLeft + unit.width * 0.5f
            val widthPosition = if (charCount > 1) {
                ((glyphCenterX - minWordX) / visualWordWidth).coerceIn(0f, 1f)
            } else {
                0.5f
            }
            // Allow progress > 1f so completed words keep their lifted grow state.
            val wordElapsedMs = progress.coerceAtLeast(0f) * visualWordDurationMs
            val charDelayMs = drawableIndex.toFloat() * visualWordDurationMs * 0.09f
            val growDurationMs = visualWordDurationMs * 1.5f
            val growProgress = ((wordElapsedMs - charDelayMs) / growDurationMs).coerceIn(0f, 1f)
            val charPosition = if (charCount > 1) drawableIndex.toFloat() / (charCount - 1).toFloat() else 0f
            val decayFactor = 1f - charPosition * maxDecayRate
            val charEnergy = durationEase * penaltyFactor * decayFactor
            val motionEnergy = charEnergy
            val baseGrowth = if (charCount <= 3) 0.07f else 0.05f
            val charMaxScale = 1f + baseGrowth + motionEnergy * 0.1f
            val highlightState = KaraokeHighlightStateMachine.resolve(
                progress = growProgress,
                sustained = isSustainedVisualWord,
                smootherStep = smootherStep,
            )
            val growEnvelope = highlightState.growEnvelope
            val peakEnvelope = highlightState.peakEnvelope
            val holdEnvelope = highlightState.holdEnvelope
            val glowPulse = highlightState.glowEnvelope
            val shadowIntensity = if (isSustainedVisualWord) {
                (0.46f + charEnergy * 0.48f) * glowPulse
            } else {
                0f
            }
            val normalizedGrowth = ((charMaxScale - 1f) / 0.13f).coerceIn(0f, 1.4f)
            val peakTranslateY = -normalizedGrowth * 6f * density
            val finalTranslateY = -rowHeight * finalLiftRatio
            val scale = if (isSustainedVisualWord) {
                val peakScale = 1f + (charMaxScale - 1f) * peakEnvelope
                val holdScale = 1f + (charMaxScale - 1f) * 0.12f * holdEnvelope
                maxOf(peakScale, holdScale)
            } else {
                1f + (charMaxScale - 1f) * growEnvelope
            }
            val translateY = if (isSustainedVisualWord) {
                val peakLiftY = peakTranslateY * peakEnvelope
                val holdLiftY = finalTranslateY * holdEnvelope
                peakLiftY + holdLiftY
            } else {
                (finalTranslateY + peakTranslateY) * growEnvelope
            }
            val horizontalOffsetEnvelope = if (isSustainedVisualWord) peakEnvelope else growEnvelope
            val horizontalOffset = ((widthPosition - 0.5f) * 2f) * ((charMaxScale - 1f) * 25f) * horizontalOffsetEnvelope
            val originalAlpha = paint.alpha
            val originalColor = paint.color
            val shadowAlpha = (255f * shadowIntensity).toInt().coerceIn(0, 216)
            val whiteCoreMix = if (isSustainedVisualWord) {
                (0.24f + 0.56f * glowPulse).coerceIn(0f, 0.78f)
            } else {
                0f
            }
            val renderColor = if (whiteCoreMix > 0f) {
                blendColorsInt(originalColor, Color.WHITE, whiteCoreMix)
            } else {
                originalColor
            }

            canvas.save()
            if (shadowAlpha > 0) {
                paint.setShadowLayer(
                    paint.textSize * (0.095f + 0.05f * peakEnvelope),
                    0f,
                    0f,
                    Color.argb(
                        shadowAlpha,
                        255,
                        255,
                        255,
                    )
                )
            }
            paint.alpha = originalAlpha
            paint.color = renderColor
            canvas.translate(horizontalOffset, translateY)
            canvas.scale(scale, scale, glyphCenterX, baseY - rowHeight * 0.32f)
            canvas.drawText(unit.text, glyphLeft, baseY, paint)
            canvas.restore()
            paint.clearShadowLayer()
            paint.alpha = originalAlpha
            paint.color = originalColor

            drawableIndex += 1
        }
    }
}

private fun blendColorsInt(from: Int, to: Int, amount: Float): Int {
    val t = amount.coerceIn(0f, 1f)
    val r = Color.red(from) + ((Color.red(to) - Color.red(from)) * t).toInt()
    val g = Color.green(from) + ((Color.green(to) - Color.green(from)) * t).toInt()
    val b = Color.blue(from) + ((Color.blue(to) - Color.blue(from)) * t).toInt()
    return Color.rgb(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))
}

private fun buildFallbackGlyphUnits(text: String, paint: Paint): List<LyricGlyphUnit> {
    if (text.isEmpty()) return emptyList()

    val iterator = BreakIterator.getCharacterInstance()
    iterator.setText(text)
    val units = mutableListOf<LyricGlyphUnit>()
    var advanceX = 0f
    var start = iterator.first()
    var end = iterator.next()

    while (end != BreakIterator.DONE) {
        val glyphText = text.substring(start, end)
        val glyphWidth = paint.measureText(glyphText)
        units += LyricGlyphUnit(
            text = glyphText,
            width = glyphWidth,
            advanceX = advanceX,
            centerRatio = 0.5f,
            isWhitespace = glyphText.all { it.isWhitespace() },
        )
        advanceX += glyphWidth
        start = end
        end = iterator.next()
    }

    return units
}
