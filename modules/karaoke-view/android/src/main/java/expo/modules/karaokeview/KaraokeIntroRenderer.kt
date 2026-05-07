package expo.modules.karaokeview

import android.graphics.*
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

internal class KaraokeIntroRenderer(private val density: Float) {
    private val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 24f * density
    }
    
    private val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 13f * density
    }

    private val activeTitlePaint = Paint(titlePaint)
    private val activeSubtitlePaint = Paint(subtitlePaint)

    private val wavePath = Path()

    fun draw(
        canvas: Canvas,
        currentTimeMs: Long,
        state: KaraokeIntroState,
        layout: KaraokeIntroLayout,
    ) {
        // Only show if there is a significant intro wait
        if (state.firstLineStartMs < 800L) return

        val introEndMs = (state.firstLineStartMs - 150L).coerceAtLeast(300L)
        if (currentTimeMs >= introEndMs) return


        // Timing variables
        val progress = (currentTimeMs.toFloat() / state.firstLineStartMs.toFloat()).coerceIn(0f, 1f)
        val reveal = smootherStep((currentTimeMs / 400f).coerceIn(0f, 1f))
        val fadeOutStart = introEndMs * 0.82f
        val fadeOut = if (currentTimeMs <= fadeOutStart) {
            1f
        } else {
            1f - ((currentTimeMs - fadeOutStart) / (introEndMs - fadeOutStart)).coerceIn(0f, 1f)
        }
        val visibility = (reveal * fadeOut).coerceIn(0f, 1f)
        if (visibility <= 0.01f) return

        if (state.title.isBlank() && state.subtitle.isBlank()) {
            drawIntroDots(canvas, currentTimeMs, state.activeColor, layout, visibility)
            return
        }

        val title = state.title
        val subtitle = state.subtitle

        val centerX = layout.width / 2f
        // Position in the lower third — safely below the lyrics scroll area and the bottom fade zone.
        // Lyrics anchor at ~28% and span downward; the bottom fade starts at ~(height - 180dp).
        // Placing the title at 72% keeps it in clean visual space.
        val centerY = layout.height * 0.72f
        val density = layout.density

        // Compute precise vertical positions using font metrics (no more guesswork)
        val titleMetrics = titlePaint.fontMetrics
        val subtitleMetrics = subtitlePaint.fontMetrics
        val titleLineHeight = titleMetrics.descent - titleMetrics.ascent
        val subtitleLineHeight = subtitleMetrics.descent - subtitleMetrics.ascent
        val lineGap = 10f * density
        val blockHeight = titleLineHeight + lineGap + subtitleLineHeight

        // Center the block around centerY
        val blockTop = centerY - blockHeight / 2f
        // drawText baseline = top of block - ascent (ascent is negative)
        val titleY = blockTop - titleMetrics.ascent
        val subtitleY = blockTop + titleLineHeight + lineGap - subtitleMetrics.ascent

        // Draw Base (Inactive) Text
        titlePaint.color = Color.argb((80f * visibility).toInt(), 255, 255, 255)
        subtitlePaint.color = Color.argb((60f * visibility).toInt(), 230, 230, 255)
        
        canvas.drawText(ellipsizeCenter(title, 32), centerX, titleY, titlePaint)
        canvas.drawText(ellipsizeCenter(subtitle, 42), centerX, subtitleY, subtitlePaint)

        // Draw Liquid (Active) Text Reveal
        drawLiquidReveal(
            canvas = canvas,
            centerX = centerX,
            title = title,
            subtitle = subtitle,
            titleY = titleY,
            subtitleY = subtitleY,
            progress = progress,
            visibility = visibility,
            currentTimeMs = currentTimeMs,
            density = density,
            layout = layout,
            titleMetrics = titleMetrics,
            subtitleMetrics = subtitleMetrics,
        )

        // Orbital particles intentionally removed.
    }

    private fun drawLiquidReveal(
        canvas: Canvas,
        centerX: Float,
        title: String,
        subtitle: String,
        titleY: Float,
        subtitleY: Float,
        progress: Float,
        visibility: Float,
        currentTimeMs: Long,
        density: Float,
        layout: KaraokeIntroLayout,
        titleMetrics: Paint.FontMetrics,
        subtitleMetrics: Paint.FontMetrics,
    ) {
        if (progress <= 0f) return

        // Use actual font metrics for precise bounds
        val titleTop = titleY + titleMetrics.ascent
        val subtitleBottom = subtitleY + subtitleMetrics.descent
        val totalTop = titleTop - 4f * density
        val totalBottom = subtitleBottom + 4f * density
        val heightRange = totalBottom - totalTop
        
        // The liquid level rises from bottom to top
        val fillLevelY = totalBottom - (heightRange * progress)

        // Create the wave path
        wavePath.reset()
        wavePath.moveTo(-100f, layout.height.toFloat() + 100f) // Start below everything
        wavePath.lineTo(layout.width.toFloat() + 100f, layout.height.toFloat() + 100f)
        wavePath.lineTo(layout.width.toFloat() + 100f, fillLevelY)
        
        // Add animated wave at the surface
        val waveAmplitude = 3f * density
        val waveFrequency = 0.025f / density
        val waveShift = currentTimeMs * 0.006f
        
        var x = layout.width.toFloat() + 100f
        while (x > -100f) {
            val y = fillLevelY + sin(x * waveFrequency + waveShift) * waveAmplitude
            wavePath.lineTo(x, y)
            x -= 4f * density
        }
        wavePath.close()

        canvas.save()
        canvas.clipPath(wavePath)

        activeTitlePaint.color = Color.argb((255f * visibility).toInt(), 255, 255, 255)
        activeSubtitlePaint.color = Color.argb((220f * visibility).toInt(), 235, 240, 255)
        
        canvas.drawText(ellipsizeCenter(title, 32), centerX, titleY, activeTitlePaint)
        canvas.drawText(ellipsizeCenter(subtitle, 42), centerX, subtitleY, activeSubtitlePaint)

        canvas.restore()
    }

    private fun smootherStep(value: Float): Float {
        val t = value.coerceIn(0f, 1f)
        return t * t * t * (t * (t * 6f - 15f) + 10f)
    }

    private fun drawIntroDots(
        canvas: Canvas,
        currentTimeMs: Long,
        color: Int,
        layout: KaraokeIntroLayout,
        visibility: Float,
    ) {
        val centerX = layout.width / 2f
        val centerY = layout.height * 0.72f
        val spacing = 13f * density
        val baseRadius = 3.5f * density
        activeTitlePaint.clearShadowLayer()

        for (index in 0 until 3) {
            val pulse = ((sin(currentTimeMs / 220f - index * 0.72f) + 1f) * 0.5f).coerceIn(0f, 1f)
            val alpha = ((92f + pulse * 132f) * visibility).toInt().coerceIn(0, 255)
            activeTitlePaint.color = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
            canvas.drawCircle(
                centerX + (index - 1) * spacing,
                centerY,
                baseRadius + pulse * 1.2f * density,
                activeTitlePaint,
            )
        }
    }

    private fun ellipsizeCenter(value: String, maxChars: Int): String {
        if (value.length <= maxChars) return value
        return value.take(maxChars - 1) + "…"
    }
}
