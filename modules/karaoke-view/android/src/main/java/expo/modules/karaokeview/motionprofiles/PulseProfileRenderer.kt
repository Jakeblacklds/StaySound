package expo.modules.karaokeview.motionprofiles

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.blendColors
import kotlin.math.cos
import kotlin.math.sin

class PulseProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        drawPulseRings(ctx)
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) {
        drawBouncingBallTrails(ctx)
    }

    private fun drawPulseRings(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress < 0.05f || ctx.words.isEmpty()) return

        val baseY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.88f + ctx.translateY
        val waveColor = blendColors(ctx.glowColor, Color.rgb(80, 255, 200), 0.24f)
        val crestColor = blendColors(ctx.glowColor, Color.rgb(200, 255, 240), 0.30f)
        val leftBound = ctx.marginLeft + ctx.words.first().xOffset
        val rightBound = ctx.marginLeft + ctx.words.last().xOffset + ctx.words.last().width
        val clampedSweepX = ctx.sweepX.coerceIn(leftBound, rightBound)
        val trailLength = (ctx.rowHeight * 2.2f).coerceAtLeast(48f * ctx.density)
        val startX = (clampedSweepX - trailLength).coerceAtLeast(leftBound)
        if (clampedSweepX <= startX + ctx.density * 2f) return

        val seed = (ctx.words.first().startMs % 997L).toFloat() * 0.013f
        val omega = 0.00502f
        val pathWidth = clampedSweepX - startX
        val k = 6.28318f / (pathWidth * 2.4f).coerceAtLeast(1f)
        val amplitude = ctx.rowHeight * (0.08f + ctx.glowProgress * 0.05f)
        val waveAlpha = (40f + ctx.glowProgress * 72f).toInt().coerceIn(0, 118)

        val wavePath = Path()
        val sampleCount = 32
        for (s in 0..sampleCount) {
            val t = s.toFloat() / sampleCount.toFloat()
            val x = startX + pathWidth * t
            val theta = k * (x - startX) - omega * ctx.currentTimeMs + seed
            val sinSq = (1f - cos(2f * theta)) * 0.5f
            val y = baseY - amplitude * (sinSq * 2f - 1f)
            if (s == 0) wavePath.moveTo(x, y) else wavePath.lineTo(x, y)
        }

        ctx.sparklePaint.style = Paint.Style.STROKE
        ctx.sparklePaint.strokeCap = Paint.Cap.ROUND
        ctx.sparklePaint.strokeJoin = Paint.Join.ROUND
        ctx.sparklePaint.strokeWidth = ctx.density * (1.4f + ctx.glowProgress * 0.6f)
        ctx.sparklePaint.color = waveColor
        ctx.sparklePaint.alpha = waveAlpha
        ctx.sparklePaint.setShadowLayer(
            ctx.density * (4.5f + ctx.glowProgress * 3f),
            0f,
            0f,
            Color.argb((waveAlpha * 1.4f).toInt().coerceIn(0, 140), Color.red(waveColor), Color.green(waveColor), Color.blue(waveColor))
        )
        ctx.canvas.drawPath(wavePath, ctx.sparklePaint)

        val headTheta = k * pathWidth - omega * ctx.currentTimeMs + seed
        val headSinSq = (1f - cos(2f * headTheta)) * 0.5f
        val headY = baseY - amplitude * (headSinSq * 2f - 1f)
        val headAlpha = (70f + ctx.glowProgress * 80f).toInt().coerceIn(0, 160)
        ctx.sparklePaint.style = Paint.Style.FILL
        ctx.sparklePaint.color = crestColor
        ctx.sparklePaint.alpha = headAlpha
        ctx.sparklePaint.setShadowLayer(
            ctx.density * (6f + ctx.glowProgress * 4f),
            0f,
            0f,
            Color.argb((headAlpha * 1.3f).toInt().coerceIn(0, 170), Color.red(crestColor), Color.green(crestColor), Color.blue(crestColor))
        )
        val rx = ctx.density * (2.6f + ctx.glowProgress * 0.8f)
        val ry = ctx.density * (1.8f + ctx.glowProgress * 0.5f)
        ctx.canvas.drawOval(clampedSweepX - rx, headY - ry, clampedSweepX + rx, headY + ry, ctx.sparklePaint)

        ctx.sparklePaint.clearShadowLayer()
        ctx.sparklePaint.alpha = 255
        ctx.sparklePaint.style = Paint.Style.FILL
        ctx.sparklePaint.strokeJoin = Paint.Join.MITER
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
                val x1 = if (i < rowWords.lastIndex) ctx.marginLeft + rowWords[i + 1].xOffset else ctx.marginLeft + w.xOffset + w.width
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
                                0f,
                                0f,
                                Color.argb((alpha + 20).coerceIn(0, 140), Color.red(trailColor), Color.green(trailColor), Color.blue(trailColor))
                            )
                            ctx.canvas.drawLine(prevX, prevY, sx, sy, ctx.sparklePaint)
                        }
                    }
                    prevX = sx
                    prevY = sy
                    hasPrev = true
                }
            }

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
                    0f,
                    0f,
                    Color.argb((ballAlpha * 1.2f).toInt().coerceIn(0, 240), Color.red(ballColor), Color.green(ballColor), Color.blue(ballColor))
                )
                ctx.canvas.drawCircle(headX, headY, ballRadius, ctx.sparklePaint)

                val shadowAlpha = (55f * (1f - height01)).toInt().coerceIn(0, 55)
                if (shadowAlpha > 4) {
                    val shadowRx = ballRadius * (0.45f + 0.55f * (1f - height01))
                    val shadowRy = ctx.density * 1.1f * (1f - height01 * 0.75f)
                    ctx.sparklePaint.clearShadowLayer()
                    ctx.sparklePaint.alpha = shadowAlpha
                    ctx.canvas.drawOval(
                        headX - shadowRx,
                        floorY - shadowRy,
                        headX + shadowRx,
                        floorY + shadowRy,
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
