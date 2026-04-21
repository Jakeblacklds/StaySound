package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import android.graphics.Paint
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors

class AmbientProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress < 0.05f || ctx.words.isEmpty()) return

        val centerY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.34f + ctx.translateY
        val auroraColor = blendColors(ctx.glowColor, Color.rgb(100, 220, 255), 0.28f)
        ctx.sparklePaint.style = Paint.Style.STROKE
        ctx.sparklePaint.strokeCap = Paint.Cap.ROUND
        ctx.sparklePaint.color = auroraColor

        val rippleCount = 3
        val cycleDurationMs = 900f
        val phaseOffset = ctx.currentTimeMs % cycleDurationMs.toLong()

        for (i in 0 until rippleCount) {
            val ringPhase = ((phaseOffset + i * (cycleDurationMs / rippleCount)) % cycleDurationMs) / cycleDurationMs
            val expandProgress = ringPhase.coerceIn(0f, 1f)
            val maxRadius = ctx.rowHeight * (0.6f + ctx.glowProgress * 0.4f)
            val radius = maxRadius * expandProgress
            val fadeAlpha = (1f - expandProgress) * (1f - expandProgress)
            val alpha = (fadeAlpha * (40f + ctx.glowProgress * 55f)).toInt().coerceIn(0, 80)
            if (alpha <= 2) continue

            ctx.sparklePaint.alpha = alpha
            ctx.sparklePaint.strokeWidth = ctx.density * (2.8f - expandProgress * 1.8f).coerceAtLeast(0.6f)
            ctx.sparklePaint.setShadowLayer(
                ctx.density * (6f + ctx.glowProgress * 4f),
                0f,
                0f,
                Color.argb((alpha * 1.6f).toInt().coerceIn(0, 100), Color.red(auroraColor), Color.green(auroraColor), Color.blue(auroraColor))
            )

            ctx.canvas.drawOval(
                ctx.sweepX - radius * 1.3f,
                centerY - radius * 0.8f,
                ctx.sweepX + radius * 1.3f,
                centerY + radius * 0.8f,
                ctx.sparklePaint
            )
        }

        ctx.sparklePaint.style = Paint.Style.FILL
        val dotAlpha = (50f + ctx.glowProgress * 60f).toInt().coerceIn(0, 100)
        ctx.sparklePaint.alpha = dotAlpha
        ctx.sparklePaint.setShadowLayer(
            ctx.density * 8f,
            0f,
            0f,
            Color.argb((dotAlpha * 1.8f).toInt().coerceIn(0, 130), Color.red(auroraColor), Color.green(auroraColor), Color.blue(auroraColor))
        )
        ctx.canvas.drawCircle(ctx.sweepX, centerY, ctx.density * (2.2f + ctx.glowProgress * 1.5f), ctx.sparklePaint)
        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
        ctx.sparklePaint.style = Paint.Style.FILL
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) = Unit
}
