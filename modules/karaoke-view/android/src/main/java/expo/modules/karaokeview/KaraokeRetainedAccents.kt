package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.cos
import kotlin.math.sin

internal class RetainedProfileAccent {
    var active: Boolean = false
    var profile: MotionProfile = MotionProfile.COSMIC
    var x: Float = 0f
    var y: Float = 0f
    var startMs: Long = 0L
    var endMs: Long = 0L
    var driftX: Float = 0f
    var driftY: Float = 0f
    var size: Float = 0f
    var alpha: Int = 0
    var strokeWidth: Float = 0f
    var blurRadius: Float = 0f
    var seed: Float = 0f
    var color: Int = Color.WHITE
}

internal class KaraokeRetainedAccents(
    private val retainedProfileAccents: Array<RetainedProfileAccent>,
    private val retainedAccentEmissionBuckets: MutableMap<Long, Long>,
) {
    fun emitRetainedProfileAccent(
        enableSpectralParticles: Boolean,
        motionProfile: MotionProfile,
        currentTimeMs: Long,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        rowHeight: Float,
        translateY: Float,
        glowProgress: Float,
        density: Float,
        glowColor: Int,
    ) {
        if (!enableSpectralParticles || words.isEmpty() || glowProgress < 0.1f) return
        if (motionProfile == MotionProfile.COSMIC || motionProfile == MotionProfile.FIRE || motionProfile == MotionProfile.PULSE || motionProfile == MotionProfile.VELVET) return

        val firstWord = words.first()
        val lastWord = words.last()
        val emissionKey =
            firstWord.startMs * 29L +
                lastWord.endMs * 37L +
                motionProfile.ordinal * 97L +
                if (firstWord.isBackground) 13L else 0L
        val bucketSizeMs = when (motionProfile) {
            MotionProfile.PULSE -> 135L
            MotionProfile.FIRE -> 120L
            MotionProfile.COSMIC -> 125L
            MotionProfile.AMBIENT -> 190L
            MotionProfile.VELVET -> 210L
        }
        val bucket = currentTimeMs / bucketSizeMs
        if (retainedAccentEmissionBuckets[emissionKey] == bucket) return
        retainedAccentEmissionBuckets[emissionKey] = bucket

        val baseY = line.y + words.minOf { it.yOffset } + rowHeight * 0.33f + translateY
        val baseSeed = ((emissionKey % 1009L).toFloat() * 0.011f) + bucket * 0.17f + glowProgress * 2.1f
        val emissionCount = 1
        repeat(emissionCount) { index ->
            val accent = retainedProfileAccents.firstOrNull { !it.active } ?: return@repeat
            val phase = baseSeed + index * 1.93f
            val profileColor = getProfileGlowColor(motionProfile, glowColor)
            val lifetimeMs = when (motionProfile) {
                MotionProfile.AMBIENT -> 1700L
                MotionProfile.PULSE -> 2000L
                MotionProfile.FIRE -> 1500L
                MotionProfile.VELVET -> 1850L
                MotionProfile.COSMIC -> 2000L
            }
            val baseSize = when (motionProfile) {
                MotionProfile.AMBIENT -> rowHeight * 0.52f
                MotionProfile.PULSE -> rowHeight * 0.36f
                MotionProfile.FIRE -> rowHeight * 0.3f
                MotionProfile.VELVET -> rowHeight * 0.42f
                MotionProfile.COSMIC -> rowHeight * 0.52f
            }

            accent.active = true
            accent.profile = motionProfile
            accent.startMs = currentTimeMs
            accent.endMs = currentTimeMs + lifetimeMs
            accent.x = sweepX + sin(phase) * rowHeight * 0.14f
            accent.y = baseY - rowHeight * 0.08f + cos(phase * 1.23f) * rowHeight * 0.06f
            accent.driftX = when (motionProfile) {
                MotionProfile.AMBIENT -> cos(phase * 0.7f) * density * 2.8f
                MotionProfile.PULSE -> cos(phase * 0.54f) * density * 1.1f
                MotionProfile.FIRE -> cos(phase * 0.9f) * density * 0.8f
                MotionProfile.VELVET -> cos(phase * 0.42f) * density * 1.9f
                MotionProfile.COSMIC -> cos(phase * 0.8f) * density * 5.1f
            }
            accent.driftY = when (motionProfile) {
                MotionProfile.AMBIENT -> -rowHeight * 0.1f
                MotionProfile.PULSE -> -rowHeight * 0.03f
                MotionProfile.FIRE -> -rowHeight * 0.24f
                MotionProfile.VELVET -> -rowHeight * 0.06f
                MotionProfile.COSMIC -> -rowHeight * 0.24f
            }
            accent.size = baseSize * (0.84f + ((sin(phase * 1.37f) * 0.5f + 0.5f) * 0.22f))
            accent.alpha = when (motionProfile) {
                MotionProfile.AMBIENT -> 36
                MotionProfile.PULSE -> 60
                MotionProfile.FIRE -> 58
                MotionProfile.VELVET -> 44
                MotionProfile.COSMIC -> 102
            }
            accent.strokeWidth = density * when (motionProfile) {
                MotionProfile.AMBIENT -> 1.4f
                MotionProfile.PULSE -> 1.3f
                MotionProfile.FIRE -> 1.5f
                MotionProfile.VELVET -> 1.6f
                MotionProfile.COSMIC -> 1.9f
            }
            accent.blurRadius = rowHeight * when (motionProfile) {
                MotionProfile.AMBIENT -> 0.06f
                MotionProfile.PULSE -> 0.05f
                MotionProfile.FIRE -> 0.05f
                MotionProfile.VELVET -> 0.06f
                MotionProfile.COSMIC -> 0.08f
            }
            accent.seed = phase
            accent.color = profileColor
        }
    }

    fun drawRetainedProfileAccents(
        canvas: Canvas,
        currentTimeMs: Long,
        enableSpectralParticles: Boolean,
        density: Float,
        particlePaint: Paint,
    ) {
        if (!enableSpectralParticles) return

        for (accent in retainedProfileAccents) {
            if (!accent.active) continue
            if (currentTimeMs >= accent.endMs) {
                accent.active = false
                continue
            }

            val duration = (accent.endMs - accent.startMs).coerceAtLeast(1L).toFloat()
            val progress = ((currentTimeMs - accent.startMs).coerceAtLeast(0L).toFloat() / duration).coerceIn(0f, 1f)
            val fadeIn = (progress / 0.16f).coerceIn(0f, 1f)
            val fadeOut = (1f - ((progress - 0.56f) / 0.44f).coerceIn(0f, 1f))
            val lifeAlpha = (fadeIn * fadeOut).coerceIn(0f, 1f)
            if (lifeAlpha <= 0.02f) continue

            val x = accent.x + accent.driftX * progress + sin(progress * 6.28318f + accent.seed) * density * 1.7f
            val y = accent.y + accent.driftY * (0.2f + progress * 0.8f)
            val alpha = (accent.alpha * lifeAlpha).toInt().coerceIn(0, 92)
            val color = accent.color

            when (accent.profile) {
                MotionProfile.AMBIENT -> {
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.STROKE
                    particlePaint.strokeCap = Paint.Cap.ROUND
                    val life = 1f - progress
                    val ringAlpha = (alpha * life * life * 0.7f).toInt().coerceIn(0, 55)
                    particlePaint.alpha = ringAlpha
                    particlePaint.strokeWidth = density * (1.6f * life).coerceAtLeast(0.4f)

                    val ringRadius = accent.size * (0.2f + progress * 0.6f)
                    particlePaint.setShadowLayer(
                        density * 5f * life,
                        0f,
                        0f,
                        Color.argb((ringAlpha * 1.5f).toInt().coerceIn(0, 70), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawOval(
                        x - ringRadius * 1.3f,
                        y - ringRadius * 0.8f,
                        x + ringRadius * 1.3f,
                        y + ringRadius * 0.8f,
                        particlePaint
                    )
                }
                MotionProfile.PULSE -> {
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val flicker = (sin(progress * 18f + accent.seed * 3f) * 0.5f + 0.5f)
                    val sparkAlpha = (alpha * life * flicker * 0.9f).toInt().coerceIn(0, 70)
                    particlePaint.alpha = sparkAlpha

                    particlePaint.setShadowLayer(
                        accent.size * 0.3f * life,
                        0f,
                        0f,
                        Color.argb((sparkAlpha * 1.8f).toInt().coerceIn(0, 100), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, y, accent.size * 0.1f * life, particlePaint)

                    if (sparkAlpha > 15) {
                        particlePaint.style = Paint.Style.STROKE
                        particlePaint.strokeWidth = density * 0.8f * life
                        val armLength = accent.size * 0.15f * life
                        canvas.drawLine(x - armLength, y, x + armLength, y, particlePaint)
                        canvas.drawLine(x, y - armLength * 0.7f, x, y + armLength * 0.7f, particlePaint)
                    }
                }
                MotionProfile.FIRE -> {
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val riseY = y - progress * accent.size * 0.8f
                    val emberAlpha = (alpha * life * life * 0.8f).toInt().coerceIn(0, 60)
                    particlePaint.alpha = emberAlpha

                    particlePaint.setShadowLayer(
                        density * (3f + life * 3f),
                        0f,
                        0f,
                        Color.argb((emberAlpha * 1.6f).toInt().coerceIn(0, 80), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, riseY, accent.size * 0.08f * (0.4f + life * 0.6f), particlePaint)
                }
                MotionProfile.VELVET -> {
                    particlePaint.color = color
                    particlePaint.style = Paint.Style.FILL
                    val life = 1f - progress
                    val bloomRadius = accent.size * (0.15f + progress * 0.25f)
                    val bloomAlpha = (alpha * life * life * 0.6f).toInt().coerceIn(0, 50)
                    particlePaint.alpha = bloomAlpha

                    particlePaint.setShadowLayer(
                        bloomRadius * 0.9f,
                        0f,
                        0f,
                        Color.argb((bloomAlpha * 1.3f).toInt().coerceIn(0, 65), Color.red(color), Color.green(color), Color.blue(color))
                    )
                    canvas.drawCircle(x, y, bloomRadius, particlePaint)
                }
                MotionProfile.COSMIC -> {
                    continue
                }
            }
        }

        particlePaint.clearShadowLayer()
        particlePaint.alpha = 255
        particlePaint.style = Paint.Style.FILL
        particlePaint.strokeCap = Paint.Cap.BUTT
        particlePaint.strokeJoin = Paint.Join.MITER
    }

    fun clearRetainedProfileAccents() {
        for (accent in retainedProfileAccents) {
            accent.active = false
        }
        retainedAccentEmissionBuckets.clear()
    }
}
