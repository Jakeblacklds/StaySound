package expo.modules.karaokeview.motionprofiles

import android.graphics.Paint
import expo.modules.karaokeview.KaraokeAccentContext
import expo.modules.karaokeview.KaraokeContinuousContext
import expo.modules.karaokeview.MotionProfileRenderer
import expo.modules.karaokeview.luminousTint
import kotlin.math.sin

/**
 * Aurora profile — Apple Music-style minimal accent.
 * Only renders on sustained notes (≥ 600 ms), exactly like Apple's
 * held-note breath effect: a single, very soft shimmer dot that
 * breathes underneath the sweeping word. No ripples, no radial rings.
 */
class AmbientProfileRenderer : MotionProfileRenderer {
    override fun drawAccent(ctx: KaraokeAccentContext) {
        drawHeldNoteBreath(ctx)
    }

    override fun drawContinuous(ctx: KaraokeContinuousContext) = Unit

    private fun drawHeldNoteBreath(ctx: KaraokeAccentContext) {
        if (ctx.glowProgress < 0.08f || ctx.words.isEmpty()) return

        // Only trigger on sustained (long) notes — ≥ 600 ms total duration.
        val totalDuration = ctx.words.maxOf { it.endMs } - ctx.words.minOf { it.startMs }
        if (totalDuration < 600L) return

        // How long the note has been held (0 → 1 over the first 400 ms)
        val heldProgress = ((ctx.currentTimeMs - ctx.words.minOf { it.startMs }).toFloat() / 400f)
            .coerceIn(0f, 1f)

        // Soft breath oscillation (~0.9 Hz)
        val breath = (sin(ctx.currentTimeMs * 0.0055f) * 0.5f + 0.5f)

        val centerY = ctx.line.y + ctx.words.minOf { it.yOffset } + ctx.rowHeight * 0.5f + ctx.translateY

        // Single soft aura — radius breathes gently
        val auraRadius = ctx.rowHeight * (0.22f + breath * 0.08f + ctx.glowProgress * 0.10f) *
            heldProgress
        val auraAlpha = ((12f + ctx.glowProgress * 18f) * heldProgress).toInt().coerceIn(0, 36)
        if (auraAlpha <= 1) return

        // Luminous tint of the album glow (was a wash toward white).
        val auraColor = luminousTint(ctx.glowColor, lift = 0.3f, satBoost = 0.08f)

        ctx.sparklePaint.style = Paint.Style.FILL
        ctx.sparklePaint.color = auraColor
        ctx.sparklePaint.alpha = auraAlpha
        ctx.sparklePaint.clearShadowLayer()
        ctx.canvas.drawCircle(ctx.sweepX, centerY, auraRadius, ctx.sparklePaint)

        // Tiny bright core — only when the note is well into being held
        if (heldProgress > 0.5f && ctx.glowProgress > 0.25f) {
            val coreAlpha = ((auraAlpha * 1.6f) * ((heldProgress - 0.5f) * 2f))
                .toInt().coerceIn(0, 52)
            val coreRadius = ctx.density * (1.4f + breath * 0.6f)
            ctx.sparklePaint.alpha = coreAlpha
            ctx.canvas.drawCircle(ctx.sweepX, centerY, coreRadius, ctx.sparklePaint)
        }

        ctx.sparklePaint.alpha = 255
        ctx.sparklePaint.style = Paint.Style.FILL
    }
}
