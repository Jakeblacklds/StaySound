package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import android.graphics.Paint
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors
import kotlin.math.cos
import kotlin.math.sin

class VelvetProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        drawVelvetRibbon(ctx)
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) {
        drawContinuousWaterTrails(ctx)
    }

    private fun drawContinuousWaterTrails(ctx: KaraokeContinuousContext) {
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
            val alpha = ((118f * ctx.smootherStep(rowProgress)) * lineFadeOutEase).toInt().coerceIn(0, 136)
            if (alpha <= 2) continue

            drawEmberUnderlinePhysics(
                canvas = ctx.canvas,
                sparklePaint = ctx.sparklePaint,
                density = ctx.density,
                glowColor = ctx.glowColor,
                fromX = underlineLeft,
                toX = underlineRight,
                baseY = ctx.line.y + rowY + ctx.rowHeight * 0.82f + ctx.translateY,
                rowHeight = ctx.rowHeight,
                trailAlpha = alpha,
                currentTimeMs = ctx.currentTimeMs,
                glowProgress = ctx.smootherStep(rowProgress),
                coolColor = blendColors(ctx.glowColor, Color.rgb(60, 185, 255), 0.34f),
                midColor = blendColors(ctx.glowColor, Color.rgb(105, 225, 255), 0.28f),
                tipColor = blendColors(ctx.glowColor, Color.rgb(210, 250, 255), 0.22f),
            )
        }
    }

    private fun drawVelvetRibbon(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress < 0.06f || ctx.words.isEmpty()) return

        val centerY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.34f + ctx.translateY
        val silkColor = blendColors(ctx.glowColor, Color.rgb(220, 190, 255), 0.22f)
        val silkInnerColor = blendColors(ctx.glowColor, Color.rgb(240, 220, 255), 0.18f)

        ctx.sparklePaint.style = Paint.Style.FILL
        ctx.sparklePaint.color = silkColor

        val breathSlow = (sin(ctx.currentTimeMs * 0.0012f) * 0.5f + 0.5f)
        val outerRadius = ctx.rowHeight * (0.55f + breathSlow * 0.15f + ctx.glowProgress * 0.25f)
        val outerAlpha = (18f + ctx.glowProgress * 28f).toInt().coerceIn(0, 52)
        ctx.sparklePaint.alpha = outerAlpha
        ctx.sparklePaint.setShadowLayer(
            outerRadius * 0.9f,
            0f,
            0f,
            Color.argb((outerAlpha * 1.4f).toInt().coerceIn(0, 72), Color.red(silkColor), Color.green(silkColor), Color.blue(silkColor))
        )
        ctx.canvas.drawCircle(ctx.sweepX, centerY, outerRadius, ctx.sparklePaint)

        val breathFast = (sin(ctx.currentTimeMs * 0.002f + 1.2f) * 0.5f + 0.5f)
        val midRadius = ctx.rowHeight * (0.28f + breathFast * 0.1f + ctx.glowProgress * 0.12f)
        val midAlpha = (28f + ctx.glowProgress * 38f).toInt().coerceIn(0, 68)
        ctx.sparklePaint.color = silkInnerColor
        ctx.sparklePaint.alpha = midAlpha
        ctx.sparklePaint.setShadowLayer(
            midRadius * 0.7f,
            0f,
            0f,
            Color.argb((midAlpha * 1.3f).toInt().coerceIn(0, 85), Color.red(silkInnerColor), Color.green(silkInnerColor), Color.blue(silkInnerColor))
        )
        val driftX = sin(ctx.currentTimeMs * 0.0008f) * ctx.density * 2f
        val driftY = cos(ctx.currentTimeMs * 0.0006f) * ctx.density * 1.2f
        ctx.canvas.drawCircle(ctx.sweepX + driftX, centerY + driftY, midRadius, ctx.sparklePaint)

        val coreRadius = ctx.density * (2.5f + ctx.glowProgress * 1.8f + breathSlow * 0.8f)
        val coreAlpha = (35f + ctx.glowProgress * 45f).toInt().coerceIn(0, 80)
        ctx.sparklePaint.alpha = coreAlpha
        ctx.sparklePaint.setShadowLayer(
            ctx.density * 6f,
            0f,
            0f,
            Color.argb((coreAlpha * 1.6f).toInt().coerceIn(0, 110), Color.red(silkInnerColor), Color.green(silkInnerColor), Color.blue(silkInnerColor))
        )
        ctx.canvas.drawCircle(ctx.sweepX, centerY, coreRadius, ctx.sparklePaint)

        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
    }
}
