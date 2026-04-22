package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors
import android.graphics.Paint

class VelvetProfileRenderer : MotionProfileRenderer {
    // No radial accent on letters — the elastic underline is enough.
    override fun drawAccent(ctx: KaraokeAccentContext) = Unit

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
}
