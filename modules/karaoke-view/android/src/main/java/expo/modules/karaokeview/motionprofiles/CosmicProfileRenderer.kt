package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import kotlin.math.cos
import kotlin.math.sin

class CosmicProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        drawSweepStarDust(ctx)
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) = Unit

    private fun drawSweepStarDust(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress <= 0.08f || ctx.words.isEmpty()) return

        val seed = (ctx.words.first().startMs % 997L).toFloat() * 0.013f
        val centerY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.34f + ctx.translateY
        val alphaBase = ((ctx.preset.starDustAlphaBase + ctx.preset.starDustAlphaRange * ctx.glowProgress) * ctx.preset.starDustAlphaMultiplier)
            .toInt()
            .coerceIn(0, ctx.preset.starDustAlphaClamp)
        val orbitX = ctx.leadingGlowWidthPx * ctx.preset.glowWidthScale * (ctx.preset.starDustOrbitXBase + ctx.preset.starDustOrbitXRange * ctx.glowProgress)
        val orbitY = ctx.rowHeight * (ctx.preset.starDustOrbitYBase + ctx.preset.starDustOrbitYRange * ctx.glowProgress)

        ctx.sparklePaint.color = ctx.glowColor
        ctx.sparklePaint.setShadowLayer(
            ctx.rowHeight * ctx.preset.starDustShadowRadius,
            0f,
            0f,
            Color.argb((alphaBase * ctx.preset.starDustShadowBoost).toInt().coerceIn(0, ctx.preset.starDustShadowClamp), Color.red(ctx.glowColor), Color.green(ctx.glowColor), Color.blue(ctx.glowColor))
        )

        for (index in 0 until ctx.preset.starDustCount) {
            val phase = ctx.glowProgress * ctx.preset.starDustPhaseSpeed + seed + index * ctx.preset.starDustPhaseStep
            val localAlpha = (alphaBase * (ctx.preset.starDustLocalAlphaBase - index * ctx.preset.starDustLocalAlphaDrop)).toInt().coerceIn(0, ctx.preset.starDustLocalAlphaClamp)
            if (localAlpha <= 0) continue

            val x = ctx.sweepX + cos(phase) * orbitX + index * ctx.density * ctx.preset.starDustDriftStepX
            val y = centerY + sin(phase * (ctx.preset.starDustWaveBase + index * ctx.preset.starDustWaveStep)) * orbitY - index * ctx.density * ctx.preset.starDustDriftStepY
            val radius = ctx.density * (ctx.preset.starDustRadiusBase + ctx.glowProgress * ctx.preset.starDustRadiusRange - index * ctx.preset.starDustRadiusDrop).coerceAtLeast(ctx.preset.starDustMinRadius)

            ctx.sparklePaint.alpha = localAlpha
            ctx.canvas.drawCircle(x, y, radius, ctx.sparklePaint)
            ctx.canvas.drawCircle(x, y, radius * 0.45f, ctx.sparklePaint)
        }

        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
    }
}
