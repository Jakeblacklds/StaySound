package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

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
