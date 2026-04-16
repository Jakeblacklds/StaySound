package expo.modules.karaokeview

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import kotlin.math.sin

internal data class KaraokeIntroState(
    val title: String,
    val subtitle: String,
    val firstLineStartMs: Long,
    val activeColor: Int,
)

internal data class KaraokeIntroLayout(
    val width: Int,
    val height: Int,
    val density: Float,
)

internal class KaraokeIntroRenderer(density: Float) {
    private val introCardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val introCardStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.1f * density
    }
    private val introTitlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 19f * density
    }
    private val introSubtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 14f * density
    }
    private val introCountdownPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 11.5f * density
    }
    private val introAuraBasePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.1f * density
    }
    private val introAuraTrailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 2.4f * density
    }
    private val introAuraOrbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    fun draw(
        canvas: Canvas,
        currentTimeMs: Long,
        state: KaraokeIntroState,
        layout: KaraokeIntroLayout,
    ) {
        if (state.firstLineStartMs < 700L) return

        val introEndMs = (state.firstLineStartMs - 120L).coerceAtLeast(260L)
        if (currentTimeMs >= introEndMs) return

        val title = if (state.title.isNotBlank()) state.title else "Preparando intro"
        val subtitle = if (state.subtitle.isNotBlank()) state.subtitle else "La primera estrofa viene en breve"

        val progress = (currentTimeMs.toFloat() / state.firstLineStartMs.toFloat()).coerceIn(0f, 1f)
        val reveal = smootherStep((currentTimeMs / 260f).coerceIn(0f, 1f))
        val fadeOutStart = introEndMs * 0.78f
        val fadeOut = if (currentTimeMs <= fadeOutStart) {
            1f
        } else {
            1f - ((currentTimeMs - fadeOutStart) / (introEndMs - fadeOutStart)).coerceIn(0f, 1f)
        }
        val visibility = (reveal * fadeOut).coerceIn(0f, 1f)
        if (visibility <= 0.02f) return

        val density = layout.density
        val cardWidth = layout.width * 0.78f
        val cardHeight = 96f * density
        val left = (layout.width - cardWidth) * 0.5f
        val top = layout.height * 0.14f
        val right = left + cardWidth
        val bottom = top + cardHeight
        val radius = 18f * density
        val cardRect = RectF(left, top, right, bottom)

        val cardAlpha = (156f * visibility).toInt().coerceIn(0, 196)
        val strokeAlpha = (88f * visibility).toInt().coerceIn(0, 140)
        introCardPaint.color = Color.argb(cardAlpha, 15, 17, 24)
        introCardStrokePaint.color = Color.argb(strokeAlpha, 255, 255, 255)
        canvas.drawRoundRect(cardRect, radius, radius, introCardPaint)
        canvas.drawRoundRect(cardRect, radius, radius, introCardStrokePaint)

        val titleY = top + 30f * density
        val subtitleY = titleY + 20f * density
        val centerX = cardRect.centerX()
        introTitlePaint.color = Color.argb((236f * visibility).toInt().coerceIn(0, 255), 255, 255, 255)
        introSubtitlePaint.color = Color.argb((170f * visibility).toInt().coerceIn(0, 255), 235, 239, 255)
        introCountdownPaint.color = Color.argb((140f * visibility).toInt().coerceIn(0, 255), 206, 220, 255)

        canvas.drawText(ellipsizeCenter(title, 34), centerX, titleY, introTitlePaint)
        canvas.drawText(ellipsizeCenter(subtitle, 44), centerX, subtitleY, introSubtitlePaint)
        drawAura(
            canvas = canvas,
            cardRect = cardRect,
            progress = smootherStep(progress),
            visibility = visibility,
            currentTimeMs = currentTimeMs,
            activeColor = state.activeColor,
            density = density,
        )
    }

    private fun drawAura(
        canvas: Canvas,
        cardRect: RectF,
        progress: Float,
        visibility: Float,
        currentTimeMs: Long,
        activeColor: Int,
        density: Float,
    ) {
        val auraPadding = 12f * density
        val auraRect = RectF(
            cardRect.left - auraPadding,
            cardRect.top - auraPadding,
            cardRect.right + auraPadding,
            cardRect.bottom + auraPadding,
        )
        val auraRadius = 24f * density
        val accentR = Color.red(activeColor)
        val accentG = Color.green(activeColor)
        val accentB = Color.blue(activeColor)

        val pulse = (sin(currentTimeMs / 320f) + 1f) * 0.5f
        val baseAlpha = ((30f + 15f * pulse) * visibility).toInt().coerceIn(0, 100)
        introAuraBasePaint.color = Color.argb(baseAlpha, accentR, accentG, accentB)
        canvas.drawRoundRect(auraRect, auraRadius, auraRadius, introAuraBasePaint)

        if (progress <= 0f) return

        val revealAlpha = (180f * visibility).toInt().coerceIn(0, 255)
        introAuraTrailPaint.color = Color.argb(revealAlpha, accentR, accentG, accentB)
        val centerX = cardRect.centerX()
        val expandWidth = (cardRect.width() * 0.5f) * progress
        val growRect = RectF(centerX - expandWidth, cardRect.bottom + 4f * density, centerX + expandWidth, cardRect.bottom + 6f * density)
        canvas.drawRoundRect(growRect, 2f * density, 2f * density, introAuraTrailPaint)

        val corePulse = 0.85f + 0.15f * ((sin(currentTimeMs / 250f) + 1f) * 0.5f)
        val orbRadius = 6f * corePulse * density
        introAuraOrbPaint.color = Color.argb((255f * visibility * progress).toInt().coerceIn(0, 255), accentR, accentG, accentB)
        canvas.drawCircle(cardRect.centerX(), cardRect.bottom + 5f * density, orbRadius, introAuraOrbPaint)
    }

    private fun smootherStep(value: Float): Float {
        val t = value.coerceIn(0f, 1f)
        return t * t * t * (t * (t * 6f - 15f) + 10f)
    }

    private fun ellipsizeCenter(value: String, maxChars: Int): String {
        if (value.length <= maxChars) return value
        return value.take(maxChars - 1) + "…"
    }
}
