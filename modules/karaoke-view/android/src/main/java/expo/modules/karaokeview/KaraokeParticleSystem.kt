package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.cos
import kotlin.math.sin

internal class SuspendedParticle {
    var active: Boolean = false
    var x: Float = 0f
    var y: Float = 0f
    var startMs: Long = 0L
    var endMs: Long = 0L
    var driftX: Float = 0f
    var driftY: Float = 0f
    var radius: Float = 0f
    var alpha: Int = 0
    var blurRadius: Float = 0f
    var wobbleAmplitude: Float = 0f
    var wobbleFrequency: Float = 0f
    var seed: Float = 0f
    var color: Int = Color.WHITE
}

internal class KaraokeParticleSystem(
    private val suspendedParticles: Array<SuspendedParticle>,
    private val particleEmissionBuckets: MutableMap<Long, Long>,
) {
    fun emitSpectralParticles(
        enableSpectralParticles: Boolean,
        motionProfile: MotionProfile,
        currentTimeMs: Long,
        line: LyricLine,
        words: List<LyricWord>,
        sweepX: Float,
        glowProgress: Float,
        rowHeight: Float,
        translateY: Float,
        density: Float,
        glowColor: Int,
    ) {
        if (!enableSpectralParticles || glowProgress <= 0.12f || words.isEmpty()) return
        val preset = motionProfile.preset

        val firstWord = words.first()
        val lastWord = words.last()
        val emissionKey = firstWord.startMs * 31L + lastWord.endMs * 17L + if (firstWord.isBackground) 7L else 0L
        val baseBucketSizeMs = if (firstWord.isBackground) 180L else 120L
        val bucketSizeMs = (baseBucketSizeMs * preset.particleBucketScale).toLong().coerceAtLeast(50L)
        val bucket = currentTimeMs / bucketSizeMs
        if (particleEmissionBuckets[emissionKey] == bucket) return
        particleEmissionBuckets[emissionKey] = bucket

        val centerY = line.y + words.minOf { it.yOffset } + rowHeight * 0.26f + translateY
        val baseSeed = ((emissionKey % 4096L).toFloat() * 0.017f) + glowProgress * 2.4f + bucket * 0.19f
        val emissionCount = if (glowProgress > 0.58f) preset.particleEmissionHigh else preset.particleEmissionLow
        val horizontalSpread = rowHeight * (if (firstWord.isBackground) 0.1f else 0.16f) * preset.particleSpreadX
        val verticalSpread = rowHeight * (if (firstWord.isBackground) 0.06f else 0.1f) * preset.particleSpreadY

        repeat(emissionCount) { index ->
            val particle = suspendedParticles.firstOrNull { !it.active } ?: return@repeat
            val phase = baseSeed + index * 1.73f
            val lifetimeMs = (preset.particleLifetimeBaseMs + ((sin(phase) * 0.5f + 0.5f) * preset.particleLifetimeRangeMs).toLong())
                .coerceIn(preset.particleLifetimeMinMs, preset.particleLifetimeMaxMs)
            val brightness = (0.78f + 0.22f * ((cos(phase * 1.41f) * 0.5f) + 0.5f)).coerceIn(0.78f, 1f)
            val alpha = (((if (firstWord.isBackground) 84f else 112f) * brightness) * preset.particleAlphaMultiplier).toInt().coerceIn(48, preset.particleAlphaClamp)
            val radius = density * (((if (firstWord.isBackground) 0.95f else 1.2f) + ((sin(phase * 0.83f) * 0.5f) + 0.5f) * 1.5f) * preset.particleRadiusScale)
            val blur = rowHeight * (((if (firstWord.isBackground) 0.04f else 0.05f) + ((cos(phase * 1.13f) * 0.5f) + 0.5f) * 0.035f) * preset.particleBlurScale)
            val offsetX = cos(phase) * horizontalSpread + sin(phase * 0.51f) * density * 3.5f * preset.particleOffsetXScale
            val offsetY = sin(phase * 1.27f) * verticalSpread - rowHeight * 0.04f * preset.particleOffsetYScale
            val driftX = cos(phase * 0.73f) * density * 7.5f * preset.particleDriftXScale
            val driftY = -(rowHeight * (0.12f + (((sin(phase * 1.57f) * 0.5f) + 0.5f) * 0.14f)) * preset.particleRiseScale)
            val wobbleAmplitude = density * (2.4f + ((cos(phase * 0.67f) * 0.5f) + 0.5f) * 4.8f) * preset.particleWobbleAmplitudeScale
            val wobbleFrequency = (0.85f + (((sin(phase * 0.93f) * 0.5f) + 0.5f) * 1.15f)) * preset.particleWobbleFrequencyScale

            particle.active = true
            particle.x = sweepX + offsetX
            particle.y = centerY + offsetY
            particle.startMs = currentTimeMs
            particle.endMs = currentTimeMs + lifetimeMs
            particle.driftX = driftX
            particle.driftY = driftY
            particle.radius = radius
            particle.alpha = alpha
            particle.blurRadius = blur
            particle.wobbleAmplitude = wobbleAmplitude
            particle.wobbleFrequency = wobbleFrequency
            particle.seed = phase
            particle.color = glowColor
        }
    }

    fun drawSuspendedSpectralParticles(
        canvas: Canvas,
        currentTimeMs: Long,
        enableSpectralParticles: Boolean,
        particlePaint: Paint,
    ) {
        if (!enableSpectralParticles) return

        for (particle in suspendedParticles) {
            if (!particle.active) continue
            if (currentTimeMs >= particle.endMs) {
                particle.active = false
                continue
            }

            val duration = (particle.endMs - particle.startMs).coerceAtLeast(1L).toFloat()
            val progress = ((currentTimeMs - particle.startMs).coerceAtLeast(0L).toFloat() / duration).coerceIn(0f, 1f)
            val fadeIn = (progress / 0.18f).coerceIn(0f, 1f)
            val fadeOut = (1f - ((progress - 0.58f) / 0.42f).coerceIn(0f, 1f))
            val lifeAlpha = (fadeIn * fadeOut).coerceIn(0f, 1f)
            if (lifeAlpha <= 0.01f) continue

            val riseEase = 1f - (1f - progress) * (1f - progress)
            val driftX = particle.driftX * progress
            val driftY = particle.driftY * riseEase
            val wobble = sin(progress * particle.wobbleFrequency * 6.28318f + particle.seed) * particle.wobbleAmplitude * (1f - progress * 0.55f)
            val x = particle.x + driftX + wobble
            val y = particle.y + driftY
            val alpha = (particle.alpha * lifeAlpha).toInt().coerceIn(0, 160)
            val outerRadius = particle.radius * (0.95f + 0.38f * riseEase)
            val coreRadius = outerRadius * 0.42f

            particlePaint.color = particle.color
            particlePaint.alpha = alpha
            particlePaint.setShadowLayer(
                particle.blurRadius * (0.85f + 0.25f * riseEase),
                0f,
                0f,
                Color.argb((alpha * 1.7f).toInt().coerceIn(0, 150), Color.red(particle.color), Color.green(particle.color), Color.blue(particle.color))
            )
            canvas.drawCircle(x, y, outerRadius, particlePaint)

            particlePaint.clearShadowLayer()
            particlePaint.alpha = (alpha * 0.95f).toInt().coerceIn(0, 255)
            canvas.drawCircle(x, y, coreRadius, particlePaint)

            val sparkleAlpha = (alpha * 0.34f).toInt().coerceIn(0, 96)
            particlePaint.alpha = sparkleAlpha
            canvas.drawCircle(x + outerRadius * 0.9f, y - outerRadius * 0.72f, coreRadius * 0.52f, particlePaint)
        }

        particlePaint.clearShadowLayer()
        particlePaint.alpha = 255
    }

    fun clearSpectralParticles() {
        for (particle in suspendedParticles) {
            particle.active = false
        }
        particleEmissionBuckets.clear()
    }
}
