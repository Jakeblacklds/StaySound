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

    // ── Binimum static energy model ────────────────────────────────────────────
    // easedWordProgress: [0,1] cubic easing of duration in [400ms, 3000ms].
    // This is the "word-level energy" — same as Binimum's `easedProgress`.
    val minDurationMs = 400f
    val maxDurationMs = 3000f
    val rawProgress = ((liftDurationMs - minDurationMs) / (maxDurationMs - minDurationMs))
        .coerceIn(0f, 1f)
    // Binimum uses easingPower = 3
    val easedWordProgress = rawProgress * rawProgress * rawProgress

    // Decay rate: later characters get less energy (Binimum: positionInWord * maxDecayRate)
    val isLongWord = charCount > 5
    val isShortDuration = liftDurationMs < 1200f
    var maxDecayRate = 0f
    if (isLongWord || isShortDuration) {
        var decayStrength = 0f
        if (isLongWord) decayStrength += ((charCount - 5).toFloat() / 5f).coerceIn(0f, 1f) * 0.4f
        if (isShortDuration && charCount > 3) {
            decayStrength += (1f - (liftDurationMs - 800f) / 400f).coerceIn(0f, 1f) * 0.3f
        } else if (isShortDuration) {
            decayStrength += (1f - (liftDurationMs - 800f) / 400f).coerceIn(0f, 1f) * 0.1f
        }
        maxDecayRate = decayStrength.coerceAtMost(0.7f)
    }

    // Syllable imbalance penalty (multi-word visual groups with uneven first syllable)
    val firstDurationMs = words.firstOrNull()?.let { (it.endMs - it.startMs).coerceAtLeast(1L).toFloat() }
        ?: liftDurationMs
    val penaltyFactor = if (words.size > 1) {
        val ratio = firstDurationMs / liftDurationMs
        if (ratio < 0.25f) 0.5f + 0.5f * (ratio / 0.25f).coerceIn(0f, 1f) else 1f
    } else 1f

    // Binimum glow intensity scale (duration × length factors)
    val glowDurFactor = (liftDurationMs / 1500f).coerceAtMost(1.1f)
    val glowLenFactor = when {
        charCount <= 3 -> 0.85f
        charCount >= 6 -> 1.1f
        else -> 1.0f
    }
    val glowIntensityScale = glowDurFactor * glowLenFactor

    // Binimum riseDuration: 1.2s + 0.6s/second of note, capped at 2.5s
    val riseDurationMs = (1200f + (liftDurationMs / 1000f) * 600f).coerceIn(1200f, 2500f)
    val releaseDurationMs = (riseDurationMs * 0.25f).coerceIn(250f, 600f)
    val sharedLiftProgress = (easedWordProgress * penaltyFactor).coerceIn(0f, 1f)
    val sharedBaseGrowth = if (charCount <= 3) 0.05f else 0.04f
    val sharedNormalizedGrowth = (sharedBaseGrowth + sharedLiftProgress * 0.08f) / 0.1f
    val sharedPeakMultiplier = (liftDurationMs / 2000f).coerceIn(0.3f, 1f)
    val sharedTranslateYPeak = -sharedNormalizedGrowth * (2f * sharedPeakMultiplier) * density

    val wordElapsedMs = progress.coerceAtLeast(0f) * liftDurationMs

    // animT: 0→animTAtEnd during rise, stays at animTAtEnd during hold,
    // animTAtEnd→0 during release.
    // KEY: riseDuration can be longer than the word, so animT may not reach 1.0
    // by the time the word ends. The release must start from the ACTUAL value
    // (animTAtEnd), not from 1.0, otherwise there's a visible pop in scale/glow.
    val animTAtEnd = smootherStep((liftDurationMs / riseDurationMs).coerceIn(0f, 1f))
    val sustainedReleaseT = if (progress >= 1f) {
        val postMs = (progress - 1f) * liftDurationMs
        smootherStep((postMs / releaseDurationMs).coerceIn(0f, 1f))
    } else {
        0f
    }
    val animT: Float = when {
        progress >= 1f -> {
            // Release: eased out from animTAtEnd → 0
            animTAtEnd * (1f - sustainedReleaseT)
        }
        else -> {
            // Rise: smootherstep toward animTAtEnd over riseDurationMs
            smootherStep((wordElapsedMs / riseDurationMs).coerceIn(0f, 1f))
        }
    }

    // For non-sustained words: grow toward final lift, then hold there permanently.
    // Never release from here — the line renderer handles lowering via scale/alpha
    // when the line becomes inactive. Releasing here caused completed words to descend.
    val nonSustainedGrowT: Float = run {
        val growDurationMs = (liftDurationMs * 1.4f).coerceAtLeast(400f)
        smootherStep((wordElapsedMs / growDurationMs).coerceIn(0f, 1f))
    }

    var drawableIndex = 0
    for ((wordIndex, word) in words.withIndex()) {
        val wordBaseX = marginLeft + word.xOffset
        val baseY = line.y + word.yOffset + rowHeight * 0.7f
        val glyphUnits = wordGlyphUnits[wordIndex]

        for (unit in glyphUnits) {
            if (unit.isWhitespace || unit.width <= 0f) {
                drawableIndex += 1
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
            val baseGrowth = if (charCount <= 3) 0.05f else 0.04f
            val charMaxScale = 1f + baseGrowth + charProgress * 0.08f

            // Glow: Binimum formula — (0.35 + charProgress * 0.45) * glowIntensityScale
            val charShadowIntensity = if (isSustainedVisualWord && enableGlow) {
                (0.35f + charProgress * 0.45f) * glowIntensityScale
            } else 0f

            // Lift: Binimum formula — -normalizedGrowth * (2 * peakMultiplier)
            val charTranslateYPeak = sharedTranslateYPeak

            // Horizontal spread: symmetric outward (Binimum)
            val horizontalOffsetTarget = (widthPosition - 0.5f) * 2f * ((charMaxScale - 1f) * 25f)

            val finalTranslateY = -rowHeight * finalLiftRatio

            // ── Apply animT to interpolate toward targets ───────────────────
            val scale: Float
            val translateY: Float
            val horizontalOffset: Float
            val shadowIntensity: Float
            val whiteCoreMix: Float

            if (isSustainedVisualWord) {
                scale = 1f + (charMaxScale - 1f) * animT
                // Peak lift + a small portion of final line lift (Binimum: very subtle)
                val settledLiftMix = animT * 0.35f + (1f - animT * 0.35f) * sustainedReleaseT
                translateY = charTranslateYPeak * animT + finalTranslateY * settledLiftMix
                horizontalOffset = horizontalOffsetTarget * animT
                shadowIntensity = charShadowIntensity * animT
                // White core: blend from 0 → ~0.65 as animT rises
                whiteCoreMix = if (enableGlow) (0.15f + 0.50f * animT).coerceIn(0f, 0.65f) * animT else 0f
            } else {
                scale = 1f + (charMaxScale - 1f) * nonSustainedGrowT
                translateY = (finalTranslateY + charTranslateYPeak) * nonSustainedGrowT
                horizontalOffset = horizontalOffsetTarget * nonSustainedGrowT
                shadowIntensity = 0f
                whiteCoreMix = 0f
            }

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
            val wordCharPosition = if (charCount > 1) {
                val wordStartGlyphIndex = drawableIndex - glyphUnits.size
                (wordStartGlyphIndex + glyphUnits.size / 2f) / (charCount - 1).toFloat()
            } else 0.5f
            
            val wordDecayFactor = 1f - wordCharPosition * maxDecayRate
            val wordCharProgress = (easedWordProgress * wordDecayFactor * penaltyFactor).coerceIn(0f, 1f)
            val wordCharMaxScale = 1f + (if (charCount <= 3) 0.05f else 0.04f) + wordCharProgress * 0.08f
            
            val wordScale = if (isSustainedVisualWord) {
                1f + (wordCharMaxScale - 1f) * animT
            } else {
                1f + (wordCharMaxScale - 1f) * nonSustainedGrowT
            }
            
            val wordTranslateY = if (isSustainedVisualWord) {
                sharedTranslateYPeak * animT + finalTranslateY * (animT * 0.35f)
            } else {
                (finalTranslateY + sharedTranslateYPeak) * nonSustainedGrowT
            }
            
            val wordHorizontalOffset = if (charCount > 1) {
                val wordGlyphCenterX = wordBaseX + word.width * 0.5f
                val wordWidthPosition = ((wordGlyphCenterX - minWordX) / visualWordWidth).coerceIn(0f, 1f)
                ((wordWidthPosition - 0.5f) * 2f) * ((wordCharMaxScale - 1f) * 25f) * (if (isSustainedVisualWord) animT else nonSustainedGrowT)
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
    val preDistancePx = paint.textSize * 0.375f
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
