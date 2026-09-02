package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import java.text.BreakIterator

/**
 * drawVisualWordCharactersWithLift
 *
 * Binimum / Apple Music model:
 *  1. Compute a STATIC charProgress per character based on word duration + position decay.
 *     This never changes during playback — it is the "target intensity" for this character.
 *  2. Derive fixed target values: charMaxScale, charTranslateYPeak, charShadowIntensity.
 *  3. Animate toward those targets over riseDuration (1.2–2.5s, capped like Binimum).
 *  4. During hold: values stay constant at the target (no oscillation / state-machine drift).
 *  5. After word ends: quick eased release back to 1.0 / 0.0.
 */
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
    enableGlow: Boolean = true,
    smootherStep: (Float) -> Float,
    overrideDurationMs: Float = 0f,
) {
    if (words.isEmpty()) return

    val visualWordDurationMs = (words.last().endMs - words.first().startMs).coerceAtLeast(1L).toFloat()
    // For lift calculations, use the full visual word duration when available.
    // This makes the lift animate per-word instead of per-syllable, while the
    // sweep (driven by the paint shader) remains at syllable granularity.
    val liftDurationMs = if (overrideDurationMs > 0f) overrideDurationMs else visualWordDurationMs
    val wordGlyphUnits = words.map { word ->
        if (word.glyphUnits.isNotEmpty()) word.glyphUnits
        else buildFallbackGlyphUnits(word.text, paint)
    }

    var charCount = 0
    var minWordX = Float.POSITIVE_INFINITY
    var maxWordX = Float.NEGATIVE_INFINITY
    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        for (unit in wordGlyphUnits[wordIndex]) {
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
    val combinedText = words.joinToString(separator = "") { it.text }
    val isSustainedVisualWord = LyricsVisualWords.isGrowableVisualWord(
        text = combinedText,
        startMs = words.first().startMs,
        endMs = words.last().endMs,
    )

    // Desktop only splits growable notes into graphemes. Ordinary words remain a
    // single text run and receive the subtle -3.5% active lift; scaling every glyph
    // made Android typography look restless and changed its kerning during playback.
    if (!isSustainedVisualWord) {
        val liftT = smootherStep(progress.coerceIn(0f, 1f))
        val translateY = -rowHeight * finalLiftRatio * liftT
        for (word in words) {
            val wordBaseX = marginLeft + word.xOffset
            val baseY = line.y + word.yOffset + rowHeight * 0.7f
            canvas.save()
            canvas.translate(0f, translateY)
            canvas.drawText(word.text, wordBaseX, baseY, paint)
            canvas.restore()

            word.romanizedText?.let { romanized ->
                val romanizedPaint = Paint(paint).apply {
                    textSize = paint.textSize * 0.6f
                    shader = null
                    alpha = (paint.alpha * 0.7f).toInt().coerceIn(0, 255)
                }
                val romanizedX = wordBaseX +
                    (paint.measureText(word.text) - romanizedPaint.measureText(romanized)) * 0.5f
                val romanizedY = line.y + word.yOffset + rowHeight +
                    romanizedPaint.textSize * 1.45f * 0.7f
                canvas.save()
                canvas.translate(0f, translateY)
                canvas.drawText(romanized, romanizedX, romanizedY, romanizedPaint)
                canvas.restore()
            }
        }
        return
    }

    // ── Binimum static energy model ────────────────────────────────────────────
    // easedWordProgress: [0,1] cubic easing of duration in [1000ms, 5000ms].
    // This is the "word-level energy" — same as Binimum's `easedProgress`.
    val minDurationMs = 1000f
    val maxDurationMs = 5000f
    val rawProgress = ((liftDurationMs - minDurationMs) / (maxDurationMs - minDurationMs))
        .coerceIn(0f, 1f)
    // Binimum uses easingPower = 3
    val easedWordProgress = rawProgress * rawProgress * rawProgress

    // Syllable imbalance penalty (multi-fragment visual words with an uneven start).
    val firstDurationMs = words.firstOrNull()?.let { (it.endMs - it.startMs).coerceAtLeast(1L).toFloat() }
        ?: liftDurationMs
    val penaltyFactor = if (words.size > 1) {
        val ratio = firstDurationMs / liftDurationMs
        if (ratio < 0.25f) 0.5f + 0.5f * (ratio / 0.25f).coerceIn(0f, 1f) else 1f
    } else 1f

    // Decay rate: later characters get less energy (Binimum: positionInWord * maxDecayRate)
    val isLongWord = charCount > 5
    val isShortDuration = liftDurationMs < 1500f
    var maxDecayRate = 0f
    val hasUnbalancedSyllables = penaltyFactor < 0.95f
    if (isLongWord || isShortDuration || hasUnbalancedSyllables) {
        var decayStrength = 0f
        if (isLongWord) decayStrength += ((charCount - 5).toFloat() / 3f).coerceIn(0f, 1f) * 0.4f
        if (isShortDuration) decayStrength += (1f - (liftDurationMs - 1000f) / 500f).coerceIn(0f, 1f) * 0.4f
        if (hasUnbalancedSyllables) {
            decayStrength += Math.pow((1f - penaltyFactor).toDouble(), 0.7).toFloat() * 1.2f
        }
        maxDecayRate = decayStrength.coerceAtMost(0.85f)
    }

    val wordElapsedMs = progress.coerceAtLeast(0f) * liftDurationMs
    val growDurationMs = liftDurationMs * 1.5f
    val baseDelayPerGlyphMs = liftDurationMs * 0.09f

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
            } else 0.5f

            // ── Per-character static energy (Binimum model) ────────────────
            val charPosition = if (charCount > 1) drawableIndex.toFloat() / (charCount - 1).toFloat() else 0f
            val decayFactor = 1f - charPosition * maxDecayRate
            // charProgress = the static target energy for this character
            val charProgress = (easedWordProgress * decayFactor * penaltyFactor).coerceIn(0f, 1f)

            // Fixed target values derived from charProgress (like Binimum CSS targets)
            val baseGrowth = if (charCount <= 3) 0.07f else 0.05f
            val charMaxScale = 1f + baseGrowth + charProgress * 0.1f

            // Glow: Binimum formula — (0.35 + charProgress * 0.45) * glowIntensityScale
            val charShadowIntensity = if (isSustainedVisualWord && enableGlow) {
                0.4f + charProgress * 0.4f
            } else 0f

            val normalizedGrowth = (charMaxScale - 1f) / 0.13f
            val charTranslateYPeak = -normalizedGrowth * 6f * density

            // Horizontal spread: symmetric outward (Binimum)
            val horizontalOffsetTarget = (widthPosition - 0.5f) * 2f * ((charMaxScale - 1f) * 25f)

            val finalTranslateY = -rowHeight * finalLiftRatio

            // ── Apply animT to interpolate toward targets ───────────────────
            val scale: Float
            val translateY: Float
            val horizontalOffset: Float
            val shadowIntensity: Float
            val whiteCoreMix: Float

            // CSS reference: grow-dynamic lasts 1.5× the note, is staggered by
            // 9% of the note per grapheme, peaks at 25–30%, then settles to the
            // ordinary -3.5% lift. `forwards` holds the settled result.
            val delayedElapsedMs = wordElapsedMs - baseDelayPerGlyphMs * drawableIndex
            val keyframeT = (delayedElapsedMs / growDurationMs).coerceIn(0f, 1f)
            val peakT = when {
                keyframeT <= 0f -> 0f
                keyframeT < 0.25f -> smootherStep(keyframeT / 0.25f)
                else -> 1f
            }
            val settleT = if (keyframeT <= 0.30f) 0f
                else smootherStep((keyframeT - 0.30f) / 0.70f)
            val livePeakT = peakT * (1f - settleT)
            scale = 1f + (charMaxScale - 1f) * livePeakT
            translateY = charTranslateYPeak * livePeakT + finalTranslateY * settleT
            horizontalOffset = horizontalOffsetTarget * livePeakT
            shadowIntensity = charShadowIntensity * livePeakT
            whiteCoreMix = 0f

            val originalAlpha = paint.alpha
            val originalColor = paint.color
            val shadowAlpha = (255f * shadowIntensity).toInt().coerceIn(0, 220)
            val renderColor = if (whiteCoreMix > 0f) {
                blendColorsInt(originalColor, luminousTint(originalColor), whiteCoreMix)
            } else originalColor

            canvas.save()
            if (shadowAlpha > 0) {
                // Fixed blur radius (GPU-friendly: no per-frame radius changes)
                paint.setShadowLayer(
                    paint.textSize * 0.10f,
                    0f,
                    0f,
                    Color.argb(shadowAlpha, Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor))
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
        
        val wordRomanized = word.romanizedText
        if (wordRomanized != null) {
            val finalTranslateY = -rowHeight * finalLiftRatio
            val romPaint = Paint(paint).apply {
                textSize = paint.textSize * 0.6f
                shader = null
                alpha = (paint.alpha * 0.7f).toInt().coerceIn(0, 255)
            }
            val originalWidth = paint.measureText(word.text)
            val romanizedWidth = romPaint.measureText(wordRomanized)
            val rx = wordBaseX + (originalWidth - romanizedWidth) / 2f
            val ry = line.y + word.yOffset + rowHeight + (paint.textSize * 0.6f) * 1.45f * 0.7f

            canvas.save()
            canvas.translate(0f, finalTranslateY * smootherStep(progress.coerceIn(0f, 1f)))
            canvas.drawText(wordRomanized, rx, ry, romPaint)
            canvas.restore()
        }
    }
}

/**
 * drawGrowableVisualWordUnifiedWipe
 *
 * Handles the karaoke wipe sweep for sustained/growable visual words.
 * Each glyph reveals left-to-right based on its proportional position
 * within the word's time window. The state machine drives per-glyph
 * scale/lift/glow during and after the reveal.
 */
internal fun drawGrowableVisualWordUnifiedWipe(
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
    preWipeDistanceEm: Float = 0.375f,
) {
    if (words.isEmpty()) return

    val visualWordDurationMs = (words.last().endMs - words.first().startMs).coerceAtLeast(1L).toFloat()
    val wordGlyphUnits = words.map { word ->
        if (word.glyphUnits.isNotEmpty()) word.glyphUnits
        else buildFallbackGlyphUnits(word.text, paint)
    }

    var charCount = 0
    var minWordX = Float.POSITIVE_INFINITY
    var maxWordX = Float.NEGATIVE_INFINITY
    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        for (unit in wordGlyphUnits[wordIndex]) {
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

    // Static energy for the whole word (same Binimum model)
    val minDurationMs = 400f
    val maxDurationMs = 3000f
    val rawP = ((visualWordDurationMs - minDurationMs) / (maxDurationMs - minDurationMs)).coerceIn(0f, 1f)
    val easedWordProgress = rawP * rawP * rawP

    val firstDurationMs = words.firstOrNull()?.let { (it.endMs - it.startMs).coerceAtLeast(1L).toFloat() }
        ?: visualWordDurationMs
    val penaltyFactor = if (words.size > 1) {
        val ratio = firstDurationMs / visualWordDurationMs
        if (ratio < 0.25f) 0.5f + 0.5f * (ratio / 0.25f).coerceIn(0f, 1f) else 1f
    } else 1f

    val isLongWord = charCount > 5
    val isShortDuration = visualWordDurationMs < 1500f
    val hasUnbalancedSyllables = penaltyFactor < 0.95f
    var maxDecayRate = 0f
    if (isLongWord || isShortDuration || hasUnbalancedSyllables) {
        var decayStrength = 0f
        if (isLongWord) decayStrength += (((charCount - 5).toFloat() / 3f).coerceIn(0f, 1f)) * 0.4f
        if (isShortDuration) decayStrength += ((1f - ((visualWordDurationMs - 1000f) / 500f)).coerceIn(0f, 1f)) * 0.4f
        if (hasUnbalancedSyllables) decayStrength += Math.pow((1f - penaltyFactor).toDouble(), 0.7).toFloat() * 1.2f
        maxDecayRate = decayStrength.coerceAtMost(0.85f)
    }

    val elapsedMs = progress.coerceAtLeast(0f) * visualWordDurationMs
    val velocityPxPerMs = (visualWordWidth / visualWordDurationMs).coerceAtLeast(0.0001f)
    val preDistancePx = paint.textSize * preWipeDistanceEm
    val preDurationMs = (preDistancePx / velocityPxPerMs).coerceIn(1f, visualWordDurationMs)

    val glowDurFactor = (visualWordDurationMs / 1500f).coerceAtMost(1.1f)
    val glowLenFactor = when {
        charCount <= 3 -> 0.85f
        charCount >= 6 -> 1.1f
        else -> 1.0f
    }
    val glowIntensityScale = glowDurFactor * glowLenFactor

    // Word-level animT for scale/lift/glow — ALL characters move together as a unit.
    // This is the key fix: Binimum animates the whole word's scale simultaneously,
    // not each glyph independently based on its wipe timing.
    val riseDurationMs = (1200f + (visualWordDurationMs / 1000f) * 600f).coerceIn(1200f, 2500f)
    val wordAnimT = smootherStep((elapsedMs / riseDurationMs).coerceIn(0f, 1f))
    val sharedLiftProgress = (easedWordProgress * penaltyFactor).coerceIn(0f, 1f)
    val sharedBaseGrowth = if (charCount <= 3) 0.05f else 0.04f
    val sharedNormalizedGrowth = ((sharedBaseGrowth + sharedLiftProgress * 0.08f) / 0.13f).coerceIn(0f, 1.4f)
    val sharedTranslateYPeak =
        -sharedNormalizedGrowth * (2f * (visualWordDurationMs / 2000f).coerceIn(0.3f, 1f)) * density

    val originalAlpha = paint.alpha
    val originalColor = paint.color
    val originalShader = paint.shader
    var drawableIndex = 0
    var cumulativeWidth = 0f

    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        val baseY = line.y + word.yOffset + rowHeight * 0.7f
        val glyphUnits = wordGlyphUnits[wordIndex]

        for (unit in glyphUnits) {
            if (unit.isWhitespace || unit.width <= 0f) continue

            val glyphLeft = wordBaseX + unit.advanceX
            val glyphCenterX = glyphLeft + unit.width * 0.5f
            val widthPosition = if (charCount > 1) {
                ((glyphCenterX - minWordX) / visualWordWidth).coerceIn(0f, 1f)
            } else 0.5f

            val glyphStartMs = visualWordDurationMs * (cumulativeWidth / visualWordWidth).coerceIn(0f, 1f)
            val glyphDurationMs = (visualWordDurationMs * (unit.width / visualWordWidth)).coerceAtLeast(1f)
            val glyphEndMs = glyphStartMs + glyphDurationMs
            val preStartMs = glyphStartMs - preDurationMs
            val glyphProgress = when {
                elapsedMs < glyphStartMs -> (elapsedMs - glyphStartMs) / glyphDurationMs
                elapsedMs <= glyphEndMs -> (elapsedMs - glyphStartMs) / glyphDurationMs
                else -> 1f + ((elapsedMs - glyphEndMs) / glyphDurationMs)
            }

            val highlightState = KaraokeHighlightStateMachine.resolve(
                progress = glyphProgress,
                sustained = true,
                smootherStep = smootherStep,
            )

            // Static energy per character
            val charPosition = if (charCount > 1) drawableIndex.toFloat() / (charCount - 1).toFloat() else 0f
            val decayFactor = 1f - charPosition * maxDecayRate
            val charProgress = (easedWordProgress * decayFactor * penaltyFactor).coerceIn(0f, 1f)

            val baseGrowth = if (charCount <= 3) 0.05f else 0.04f
            val charMaxScale = 1f + baseGrowth + charProgress * 0.08f

            val peakEnvelope = highlightState.peakEnvelope
            val holdEnvelope = highlightState.holdEnvelope
            val growEnvelope = highlightState.growEnvelope
            val glowPulse = highlightState.glowEnvelope

            val preEnvelope = if (elapsedMs < glyphStartMs) {
                smootherStep(((elapsedMs - preStartMs) / preDurationMs).coerceIn(0f, 1f))
            } else 0f
            val wipeEnvelope = smootherStep(((elapsedMs - glyphStartMs) / glyphDurationMs).coerceIn(0f, 1f))
            val revealEnvelope = when {
                elapsedMs < glyphStartMs -> (preEnvelope * 0.44f).coerceIn(0f, 0.44f)
                elapsedMs <= glyphEndMs -> wipeEnvelope
                else -> 1f
            }.coerceIn(0f, 1f)

            // Scale/lift/glow use wordAnimT (all glyphs move together).
            // Only revealEnvelope (color reveal) is per-glyph.
            val charTranslateYPeak = sharedTranslateYPeak
            val finalTranslateY = -rowHeight * finalLiftRatio
            val scale = 1f + (charMaxScale - 1f) * wordAnimT
            val translateY = charTranslateYPeak * wordAnimT + finalTranslateY * (wordAnimT * 0.35f)
            val horizontalOffset = ((widthPosition - 0.5f) * 2f) * ((charMaxScale - 1f) * 25f) * wordAnimT

            val dimAlpha = (originalAlpha * 0.38f).toInt().coerceIn(0, originalAlpha)
            val renderAlpha = lerpInt(dimAlpha, originalAlpha, revealEnvelope)

            // Glow: appears AS the wipe passes over each character (revealEnvelope, not wordAnimT).
            // wordAnimT only controls scale/lift so the whole word moves together.
            // Using wordAnimT here caused all glyphs to go white simultaneously at 2.5s.
            val charShadowIntensity = (0.35f + charProgress * 0.45f) * glowIntensityScale
            val shadowIntensity = charShadowIntensity * revealEnvelope
            val shadowAlpha = (255f * shadowIntensity).toInt().coerceIn(0, 210)
            val whiteCoreMix = (0.14f + 0.52f * revealEnvelope).coerceIn(0f, 0.66f) * revealEnvelope
            val renderColor = if (whiteCoreMix > 0f) {
                blendColorsInt(originalColor, luminousTint(originalColor), whiteCoreMix)
            } else originalColor

            canvas.save()
            paint.shader = null
            if (shadowAlpha > 0) {
                paint.setShadowLayer(
                    paint.textSize * 0.10f, // Fixed radius — no dynamic changes
                    0f,
                    0f,
                    Color.argb(shadowAlpha, Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor)),
                )
            }
            paint.alpha = renderAlpha
            paint.color = renderColor
            canvas.translate(horizontalOffset, translateY)
            canvas.scale(scale, scale, glyphCenterX, baseY - rowHeight * 0.32f)
            canvas.drawText(unit.text, glyphLeft, baseY, paint)
            canvas.restore()
            paint.clearShadowLayer()
            paint.alpha = originalAlpha
            paint.color = originalColor
            paint.shader = originalShader

            drawableIndex += 1
            cumulativeWidth += unit.width
        }
        
        val wordRomanized = word.romanizedText
        if (wordRomanized != null) {
            val finalTranslateY = -rowHeight * finalLiftRatio
            val wordCharPosition = if (charCount > 1) {
                val wordStartGlyphIndex = drawableIndex - glyphUnits.size
                (wordStartGlyphIndex + glyphUnits.size / 2f) / (charCount - 1).toFloat()
            } else 0.5f

            val wordDecayFactor = 1f - wordCharPosition * maxDecayRate
            val wordCharProgress = (easedWordProgress * wordDecayFactor * penaltyFactor).coerceIn(0f, 1f)
            val wordCharMaxScale = 1f + (if (charCount <= 3) 0.05f else 0.04f) + wordCharProgress * 0.08f

            val wordScale = 1f + (wordCharMaxScale - 1f) * wordAnimT
            val wordTranslateY = sharedTranslateYPeak * wordAnimT + finalTranslateY * (wordAnimT * 0.35f)

            val wordHorizontalOffset = if (charCount > 1) {
                val wordGlyphCenterX = wordBaseX + word.width * 0.5f
                val wordWidthPosition = ((wordGlyphCenterX - minWordX) / visualWordWidth).coerceIn(0f, 1f)
                ((wordWidthPosition - 0.5f) * 2f) * ((wordCharMaxScale - 1f) * 25f) * wordAnimT
            } else 0f

            val romPaint = Paint(paint).apply {
                textSize = paint.textSize * 0.6f
                shader = null
                alpha = (paint.alpha * 0.7f).toInt().coerceIn(0, 255)
            }
            val originalWidth = paint.measureText(word.text)
            val romanizedWidth = romPaint.measureText(wordRomanized)
            val rx = wordBaseX + (originalWidth - romanizedWidth) / 2f
            val ry = line.y + word.yOffset + rowHeight + (paint.textSize * 0.6f) * 1.45f * 0.7f

            canvas.save()
            canvas.translate(wordHorizontalOffset, wordTranslateY)
            canvas.scale(wordScale, wordScale, wordBaseX + originalWidth / 2f, baseY - rowHeight * 0.32f)
            canvas.drawText(wordRomanized, rx, ry, romPaint)
            canvas.restore()
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

private fun lerpInt(start: Int, end: Int, amount: Float): Int {
    val t = amount.coerceIn(0f, 1f)
    return (start + ((end - start) * t)).toInt()
}

private fun buildFallbackGlyphUnits(text: String, paint: Paint): List<LyricGlyphUnit> {
    if (text.isEmpty()) return emptyList()
    // Run-context advances (getTextWidths) so letterSpacing is distributed exactly like
    // drawText. Isolated measureText per glyph drifts from the whole-word draw when
    // letterSpacing != 0 (ghosting / jammed glyphs).
    val charWidths = FloatArray(text.length)
    paint.getTextWidths(text, charWidths)
    val iterator = BreakIterator.getCharacterInstance()
    iterator.setText(text)
    val units = mutableListOf<LyricGlyphUnit>()
    var advanceX = 0f
    var start = iterator.first()
    var end = iterator.next()
    while (end != BreakIterator.DONE) {
        val glyphText = text.substring(start, end)
        var glyphWidth = 0f
        for (i in start until end) glyphWidth += charWidths[i]
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
