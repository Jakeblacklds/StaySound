package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors
import kotlin.math.pow
import kotlin.math.sin

class FireProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        drawFireTrails(ctx)
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) {
        drawContinuousFireLine(ctx)
    }

    private fun drawFireTrails(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress < 0.08f || ctx.words.isEmpty()) return

        val firstWord = ctx.words.first()
        val sourceWords = if (firstWord.isBackground) ctx.line.backgroundWords else ctx.line.words
        val rowStartWord = sourceWords
            .filter { it.yOffset == firstWord.yOffset && it.isBackground == firstWord.isBackground }
            .minByOrNull { it.xOffset }
            ?: firstWord
        val baseY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.82f + ctx.translateY
        val underlineLeft = ctx.marginLeft + rowStartWord.xOffset

        drawEmberUnderlinePhysics(
            canvas = ctx.canvas,
            sparklePaint = ctx.sparklePaint,
            density = ctx.density,
            glowColor = ctx.glowColor,
            fromX = underlineLeft,
            toX = ctx.sweepX,
            baseY = baseY,
            rowHeight = ctx.rowHeight,
            trailAlpha = (55f + ctx.glowProgress * 85f).toInt().coerceIn(0, 140),
            currentTimeMs = (ctx.words.first().startMs + (ctx.glowProgress * 1000f).toLong()),
            glowProgress = ctx.glowProgress,
        )
    }

    internal fun drawContinuousFireTrails(ctx: KaraokeContinuousContext) {
        if (ctx.words.isEmpty()) return

        val lineFadeOutProgress = ((ctx.currentTimeMs - ctx.line.endMs).toFloat() / ctx.fireTrailFadeOutDurationMs).coerceIn(0f, 1f)
        val lineFadeOutEase = 1f - ctx.smootherStep(lineFadeOutProgress)
        if (ctx.currentTimeMs > ctx.line.endMs + ctx.fireTrailFadeOutDurationMs || lineFadeOutEase <= 0.01f) return

        val rows = ctx.words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            if (ctx.currentTimeMs < rowStartMs) continue

            val rowEndMs = rowWords.maxOf { it.endMs }
            val underlineLeft = ctx.marginLeft + rowWords.first().xOffset
            val rowRight = ctx.marginLeft + rowWords.maxOf { it.xOffset + it.width }
            val underlineRight = ctx.calculateContinuousSweepX(rowWords, ctx.currentTimeMs).coerceIn(underlineLeft, rowRight)
            if (underlineRight <= underlineLeft + ctx.density * 0.5f) continue

            val rowProgress = if (rowEndMs > rowStartMs) {
                ((ctx.currentTimeMs - rowStartMs).toFloat() / (rowEndMs - rowStartMs).toFloat()).coerceIn(0f, 1f)
            } else {
                1f
            }

            val lineBaseY = ctx.line.y + rowY + ctx.rowHeight * 0.82f + ctx.translateY
            val compositeAlpha = ((136f * ctx.smootherStep(rowProgress)) * lineFadeOutEase).toInt().coerceIn(0, 140)
            if (compositeAlpha <= 2) continue

            drawEmberUnderlinePhysics(
                canvas = ctx.canvas,
                sparklePaint = ctx.sparklePaint,
                density = ctx.density,
                glowColor = ctx.glowColor,
                fromX = underlineLeft,
                toX = underlineRight,
                baseY = lineBaseY,
                rowHeight = ctx.rowHeight,
                trailAlpha = compositeAlpha,
                currentTimeMs = ctx.currentTimeMs,
                glowProgress = ctx.smootherStep(rowProgress),
            )
        }
    }

    private fun drawContinuousFireLine(ctx: KaraokeContinuousContext) {
        if (ctx.words.isEmpty()) return
        if (ctx.currentTimeMs > ctx.line.endMs + 500L) return

        val fireflyCore = blendColors(ctx.glowColor, Color.rgb(228, 255, 158), 0.22f)
        val fireflyMid = blendColors(ctx.glowColor, Color.rgb(188, 255, 118), 0.18f)
        val lanternWarm = blendColors(ctx.glowColor, Color.rgb(255, 218, 128), 0.20f)

        val rowFadeWindowMs = 400L
        val rows = ctx.words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            if (ctx.currentTimeMs < rowStartMs) continue

            val rowEndMs = rowWords.maxOf { it.endMs }
            if (ctx.currentTimeMs > rowEndMs + rowFadeWindowMs) continue

            val rowLeft = ctx.marginLeft + rowWords.first().xOffset
            val rowRight = ctx.marginLeft + rowWords.maxOf { it.xOffset + it.width }
            val sweepX = ctx.calculateContinuousSweepX(rowWords, ctx.currentTimeMs).coerceIn(rowLeft, rowRight)
            if (sweepX <= rowLeft + ctx.density) continue

            val rowProgress = if (rowEndMs > rowStartMs) {
                ((ctx.currentTimeMs - rowStartMs).toFloat() / (rowEndMs - rowStartMs)).coerceIn(0f, 1f)
            } else {
                1f
            }

            val appearT = ctx.smootherStep((rowProgress.coerceAtMost(0.10f)) / 0.10f)
            val fadeOutT = if (ctx.currentTimeMs > rowEndMs) {
                1f - ctx.smootherStep(((ctx.currentTimeMs - rowEndMs).toFloat() / rowFadeWindowMs).coerceIn(0f, 1f))
            } else {
                1f
            }

            val baseY = ctx.line.y + rowY + ctx.rowHeight * 0.88f + ctx.translateY
            val masterAlpha = (appearT * fadeOutT).coerceIn(0f, 1f)
            if (masterAlpha <= 0.02f) continue

            val lanternRadius = ctx.rowHeight * (1.55f + rowProgress * 0.25f)
            val lanternAlpha = (masterAlpha * 55f).toInt().coerceIn(0, 65)
            if (lanternAlpha > 3) {
                val lanternShader = RadialGradient(
                    sweepX,
                    baseY,
                    lanternRadius,
                    intArrayOf(
                        Color.argb(lanternAlpha, Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                        Color.argb(lanternAlpha / 3, Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                        Color.argb(0, Color.red(lanternWarm), Color.green(lanternWarm), Color.blue(lanternWarm)),
                    ),
                    floatArrayOf(0f, 0.48f, 1f),
                    Shader.TileMode.CLAMP
                )
                ctx.sparklePaint.style = Paint.Style.FILL
                ctx.sparklePaint.shader = lanternShader
                ctx.sparklePaint.alpha = 255
                ctx.sparklePaint.clearShadowLayer()
                val halfW = lanternRadius
                val halfH = lanternRadius * 1.3f
                ctx.canvas.drawOval(
                    sweepX - halfW,
                    baseY - halfH,
                    sweepX + halfW,
                    baseY + halfH * 0.4f,
                    ctx.sparklePaint
                )
                ctx.sparklePaint.shader = null
            }

            val trailDurationMs = 360L
            val trailSteps = 16
            ctx.sparklePaint.style = Paint.Style.FILL
            ctx.sparklePaint.shader = null

            for (step in 1..trailSteps) {
                val stepAge = step.toFloat() / trailSteps.toFloat()
                val stepMs = ctx.currentTimeMs - (stepAge * trailDurationMs).toLong()
                if (stepMs < rowStartMs) continue
                val stepX = ctx.calculateContinuousSweepX(rowWords, stepMs).coerceIn(rowLeft, rowRight)
                if (stepX >= sweepX - ctx.density * 0.5f) continue
                val decay = 1f - stepAge
                val trailRadius = ctx.density * (1.5f + 1.6f * decay * decay)
                val trailAlpha = (masterAlpha * decay * decay * 72f).toInt().coerceIn(0, 72)
                if (trailAlpha <= 2) continue
                val trailColor = blendColors(fireflyMid, Color.rgb(70, 150, 70), stepAge * 0.45f)
                ctx.sparklePaint.color = trailColor
                ctx.sparklePaint.alpha = trailAlpha
                ctx.sparklePaint.clearShadowLayer()
                ctx.canvas.drawCircle(stepX, baseY, trailRadius, ctx.sparklePaint)
            }

            if (ctx.currentTimeMs <= rowEndMs) {
                val phaseSeed = (rowLeft * 0.041f) % 6.28318f
                val pulse = (sin(ctx.currentTimeMs * 0.00880f + phaseSeed) + 1f) * 0.5f

                val auraRadius = ctx.density * (8.5f + 4.5f * pulse)
                val auraAlpha = (masterAlpha * (28f + 20f * pulse)).toInt().coerceIn(0, 55)
                ctx.sparklePaint.style = Paint.Style.FILL
                ctx.sparklePaint.color = fireflyMid
                ctx.sparklePaint.alpha = auraAlpha
                ctx.sparklePaint.setShadowLayer(
                    auraRadius * 1.5f,
                    0f,
                    0f,
                    Color.argb((auraAlpha * 2f).toInt().coerceIn(0, 110), Color.red(fireflyMid), Color.green(fireflyMid), Color.blue(fireflyMid))
                )
                ctx.canvas.drawCircle(sweepX, baseY, auraRadius * 0.52f, ctx.sparklePaint)

                val coreRadius = ctx.density * (2.6f + 1.2f * pulse)
                val coreAlpha = (masterAlpha * (155f + 65f * pulse)).toInt().coerceIn(0, 240)
                ctx.sparklePaint.color = fireflyCore
                ctx.sparklePaint.alpha = coreAlpha
                ctx.sparklePaint.setShadowLayer(
                    coreRadius * 2.4f,
                    0f,
                    0f,
                    Color.argb((coreAlpha * 0.88f).toInt().coerceIn(0, 215), Color.red(fireflyCore), Color.green(fireflyCore), Color.blue(fireflyCore))
                )
                ctx.canvas.drawCircle(sweepX, baseY, coreRadius, ctx.sparklePaint)
            }
        }

        ctx.sparklePaint.shader = null
        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
        ctx.sparklePaint.style = Paint.Style.FILL
    }
}

internal fun drawEmberUnderlinePhysics(
    canvas: android.graphics.Canvas,
    sparklePaint: Paint,
    density: Float,
    glowColor: Int,
    fromX: Float,
    toX: Float,
    baseY: Float,
    rowHeight: Float,
    trailAlpha: Int,
    currentTimeMs: Long,
    glowProgress: Float,
    coolColor: Int? = null,
    midColor: Int? = null,
    tipColor: Int? = null,
) {
    val totalWidth = toX - fromX
    if (totalWidth < density * 2f || trailAlpha <= 2) return

    val coolAmber = coolColor ?: blendColors(glowColor, Color.rgb(255, 130, 30), 0.30f)
    val midFlame = midColor ?: blendColors(glowColor, Color.rgb(255, 190, 70), 0.24f)
    val hotTip = tipColor ?: blendColors(glowColor, Color.rgb(255, 230, 155), 0.18f)
    val phaseSeed = (fromX * 0.037f) % 6.28318f
    val omegaSlow = 0.00220f
    val omegaFast = 0.04398f
    val ampSlow = density * (1.6f + glowProgress * 0.8f)
    val ampFast = density * (0.4f + glowProgress * 0.3f)
    val stepPx = density * 1.6f
    val steps = ((totalWidth / stepPx).toInt()).coerceIn(2, 300)
    val bellK = 7.5f
    val rMax = density * (1.6f + glowProgress * 0.5f)
    val rMin = density * 0.3f

    sparklePaint.style = Paint.Style.FILL
    sparklePaint.clearShadowLayer()

    for (i in 0..steps) {
        val t = i.toFloat() / steps.toFloat()
        val x = fromX + t * totalWidth
        val dt = t - 0.5f
        val bellFactor = kotlin.math.exp((-bellK * dt * dt).toDouble()).toFloat()
        val radius = rMin + (rMax - rMin) * bellFactor

        val phaseSlow = omegaSlow * currentTimeMs + phaseSeed
        val phaseFast = omegaFast * currentTimeMs + phaseSeed * 1.7f
        val oscEnvelope = t.pow(0.7f).coerceIn(0f, 1f)
        val yOffset = (sin(phaseSlow) * ampSlow + sin(phaseFast) * ampFast) * oscEnvelope
        val y = baseY + yOffset

        val alphaT = 0.22f + 0.78f * bellFactor
        val pointAlpha = (trailAlpha * alphaT).toInt().coerceIn(0, 255)
        if (pointAlpha <= 1) continue

        val pointColor = when {
            t < 0.42f -> blendColors(coolAmber, midFlame, t / 0.42f)
            else -> blendColors(midFlame, hotTip, (t - 0.42f) / 0.58f)
        }

        sparklePaint.color = pointColor
        sparklePaint.alpha = pointAlpha

        if (i % 4 == 0) {
            val shadowAlpha = (pointAlpha * (0.6f + bellFactor * 0.7f)).toInt().coerceIn(0, 160)
            sparklePaint.setShadowLayer(
                radius * (1.8f + bellFactor),
                0f,
                0f,
                Color.argb(shadowAlpha, Color.red(pointColor), Color.green(pointColor), Color.blue(pointColor))
            )
        } else {
            sparklePaint.clearShadowLayer()
        }

        canvas.drawCircle(x, y, radius, sparklePaint)
    }

    val tipPhaseSlow = omegaSlow * currentTimeMs + phaseSeed
    val tipPhaseFast = omegaFast * currentTimeMs + phaseSeed * 1.7f
    val tipY = baseY + sin(tipPhaseSlow) * ampSlow + sin(tipPhaseFast) * ampFast
    val tipFlareRadius = density * (1.4f + glowProgress * 0.8f)
    val tipFlareAlpha = (trailAlpha * 0.88f).toInt().coerceIn(0, 210)
    sparklePaint.color = hotTip
    sparklePaint.alpha = tipFlareAlpha
    sparklePaint.setShadowLayer(
        tipFlareRadius * 2.2f,
        0f,
        0f,
        Color.argb((tipFlareAlpha * 0.9f).toInt().coerceIn(0, 200), Color.red(hotTip), Color.green(hotTip), Color.blue(hotTip))
    )
    canvas.drawCircle(toX, tipY, tipFlareRadius, sparklePaint)

    sparklePaint.clearShadowLayer()
    sparklePaint.alpha = 255
    sparklePaint.style = Paint.Style.FILL
}
