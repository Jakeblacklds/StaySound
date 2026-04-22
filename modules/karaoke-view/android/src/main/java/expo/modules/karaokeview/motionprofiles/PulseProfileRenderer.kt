package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import android.graphics.Paint
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors

class PulseProfileRenderer : MotionProfileRenderer {

    // No per-word accent — the sinusoidal crest was not wanted.
    override fun drawAccent(ctx: KaraokeAccentContext) = Unit

    /** Bouncing ball that arcs between words, leaving a glowing arc trail behind it. */
    override fun drawContinuous(ctx: KaraokeContinuousContext) {
        drawBouncingBallTrails(ctx)
    }

    private fun drawBouncingBallTrails(ctx: KaraokeContinuousContext) {
        if (ctx.words.isEmpty()) return

        val trailFadeMs = 1400L
        val ballColor = blendColors(ctx.glowColor, Color.rgb(200, 255, 230), 0.36f)
        val trailColor = blendColors(ctx.glowColor, Color.rgb(80, 255, 200), 0.24f)
        val ballRadius = ctx.density * 3.8f
        val floorOffset = ctx.rowHeight * 0.85f

        val rows = ctx.words.groupBy { it.yOffset }

        for ((rowY, rowWordsRaw) in rows) {
            val rowWords = rowWordsRaw.sortedBy { it.xOffset }
            if (rowWords.isEmpty()) continue

            val rowStartMs = rowWords.first().startMs
            val rowEndMs = rowWords.maxOf { it.endMs }
            if (ctx.currentTimeMs < rowStartMs) continue
            if (ctx.currentTimeMs > rowEndMs + trailFadeMs) continue

            val floorY = ctx.line.y + rowY + floorOffset + ctx.translateY

            data class BounceArc(
                val startMs: Long,
                val endMs: Long,
                val x0: Float,
                val x1: Float,
                val arcH: Float,
            )
            val arcs = mutableListOf<BounceArc>()
            for (i in rowWords.indices) {
                val w = rowWords[i]
                val x0 = ctx.marginLeft + w.xOffset
                val x1 = if (i < rowWords.lastIndex)
                    ctx.marginLeft + rowWords[i + 1].xOffset
                else
                    ctx.marginLeft + w.xOffset + w.width
                val launchMs = w.startMs
                val landMs = if (i < rowWords.lastIndex) rowWords[i + 1].startMs else w.endMs
                if (landMs <= launchMs) continue
                val dx = (x1 - x0).coerceAtLeast(1f)
                val arcH = (dx * 0.30f).coerceIn(ctx.density * 8f, ctx.rowHeight * 0.52f)
                arcs += BounceArc(launchMs, landMs, x0, x1, arcH)
            }
            if (arcs.isEmpty()) continue

            fun evalArc(arc: BounceArc, t: Long): Pair<Float, Float> {
                val dur = (arc.endMs - arc.startMs).toFloat().coerceAtLeast(1f)
                val p = ((t - arc.startMs).toFloat() / dur).coerceIn(0f, 1f)
                val x = arc.x0 + (arc.x1 - arc.x0) * p
                val y = floorY - arc.arcH * 4f * p * (1f - p)
                return x to y
            }

            val currentArc = arcs.lastOrNull { ctx.currentTimeMs >= it.startMs }
            val trailDuration = (rowEndMs - rowStartMs).coerceAtLeast(1L)
            val trailStartMs = (ctx.currentTimeMs - trailDuration / 3L).coerceAtLeast(rowStartMs)
            val trailEndMs = ctx.currentTimeMs.coerceAtMost(rowEndMs)

            // ---- Arc trail ----
            if (trailEndMs > trailStartMs) {
                ctx.sparklePaint.style = Paint.Style.STROKE
                ctx.sparklePaint.strokeCap = Paint.Cap.ROUND
                ctx.sparklePaint.strokeJoin = Paint.Join.ROUND
                ctx.sparklePaint.color = trailColor

                var prevX = 0f
                var prevY = 0f
                var hasPrev = false
                val samples = 28

                for (s in 0..samples) {
                    val t = s.toFloat() / samples
                    val sampleMs = trailStartMs + ((trailEndMs - trailStartMs) * t).toLong()
                    val sampleArc = arcs.lastOrNull { sampleMs >= it.startMs } ?: continue
                    val (sx, sy) = evalArc(sampleArc, sampleMs)

                    if (hasPrev) {
                        val age = (ctx.currentTimeMs - sampleMs).toFloat() / (trailDuration / 3f)
                        val vis = ctx.smootherStep((1f - age).coerceIn(0f, 1f))
                        val rowFade = if (ctx.currentTimeMs > rowEndMs) {
                            (1f - ((ctx.currentTimeMs - rowEndMs).toFloat() / trailFadeMs)).coerceIn(0f, 1f)
                        } else {
                            1f
                        }
                        val alpha = (105f * vis * rowFade).toInt().coerceIn(0, 120)
                        if (alpha > 2) {
                            ctx.sparklePaint.alpha = alpha
                            ctx.sparklePaint.strokeWidth = ctx.density * (1.0f + vis * 1.4f)
                            ctx.sparklePaint.setShadowLayer(
                                ctx.density * (3f + vis * 3f),
                                0f, 0f,
                                Color.argb((alpha + 20).coerceIn(0, 140),
                                    Color.red(trailColor), Color.green(trailColor), Color.blue(trailColor))
                            )
                            ctx.canvas.drawLine(prevX, prevY, sx, sy, ctx.sparklePaint)
                        }
                    }
                    prevX = sx
                    prevY = sy
                    hasPrev = true
                }
            }

            // ---- Ball + floor shadow ----
            if (ctx.currentTimeMs <= rowEndMs && currentArc != null) {
                val (headX, headY) = evalArc(currentArc, ctx.currentTimeMs)

                val dur = (currentArc.endMs - currentArc.startMs).toFloat().coerceAtLeast(1f)
                val arcT = ((ctx.currentTimeMs - currentArc.startMs).toFloat() / dur).coerceIn(0f, 1f)
                val height01 = 4f * arcT * (1f - arcT)

                val ballAlpha = (155f + 55f * height01).toInt().coerceIn(0, 220)
                ctx.sparklePaint.style = Paint.Style.FILL
                ctx.sparklePaint.color = ballColor
                ctx.sparklePaint.alpha = ballAlpha
                ctx.sparklePaint.setShadowLayer(
                    ctx.density * (6f + 5f * height01),
                    0f, 0f,
                    Color.argb((ballAlpha * 1.2f).toInt().coerceIn(0, 240),
                        Color.red(ballColor), Color.green(ballColor), Color.blue(ballColor))
                )
                ctx.canvas.drawCircle(headX, headY, ballRadius, ctx.sparklePaint)

                val shadowAlpha = (55f * (1f - height01)).toInt().coerceIn(0, 55)
                if (shadowAlpha > 4) {
                    val shadowRx = ballRadius * (0.45f + 0.55f * (1f - height01))
                    val shadowRy = ctx.density * 1.1f * (1f - height01 * 0.75f)
                    ctx.sparklePaint.clearShadowLayer()
                    ctx.sparklePaint.alpha = shadowAlpha
                    ctx.canvas.drawOval(
                        headX - shadowRx, floorY - shadowRy,
                        headX + shadowRx, floorY + shadowRy,
                        ctx.sparklePaint
                    )
                }
            }
        }

        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
        ctx.sparklePaint.style = Paint.Style.FILL
        ctx.sparklePaint.strokeJoin = Paint.Join.MITER
    }
}
