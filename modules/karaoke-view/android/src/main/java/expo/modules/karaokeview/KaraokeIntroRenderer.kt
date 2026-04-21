package expo.modules.karaokeview

import android.graphics.*
import kotlin.math.cos
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
        textSize = 26f * density
    }
    
    private val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textAlign = Paint.Align.CENTER
        textSize = 15f * density
    }

    private val activeTitlePaint = Paint(titlePaint)
    private val activeSubtitlePaint = Paint(subtitlePaint)

    private val radialGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    private val orbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

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

        val title = if (state.title.isNotBlank()) state.title else "Disfruta el intro"
        val subtitle = if (state.subtitle.isNotBlank()) state.subtitle else "La música está por comenzar"

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

        val centerX = layout.width / 2f
        val centerY = layout.height * 0.32f
        val density = layout.density

        // Colors
        val accentR = Color.red(state.activeColor)
        val accentG = Color.green(state.activeColor)
        val accentB = Color.blue(state.activeColor)

        // 1. Draw Radial Background Aura (Replacing the "Box")
        drawBackgroundAura(canvas, centerX, centerY, visibility, progress, currentTimeMs, accentR, accentG, accentB, density, layout)

        // 2. Setup text positions
        val titleY = centerY - 2f * density
        val subtitleY = centerY + 24f * density

        // 3. Draw Base (Inactive) Text
        titlePaint.color = Color.argb((80f * visibility).toInt(), 255, 255, 255)
        subtitlePaint.color = Color.argb((60f * visibility).toInt(), 230, 230, 255)
        
        canvas.drawText(ellipsizeCenter(title, 32), centerX, titleY, titlePaint)
        canvas.drawText(ellipsizeCenter(subtitle, 42), centerX, subtitleY, subtitlePaint)

        // 4. Draw Liquid (Active) Text Reveal (Replacing the "Bar")
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
            activeColor = state.activeColor,
            density = density,
            layout = layout
        )

        // 5. Orbital Particles (Replacing the "Count-down" feel)
        drawOrbitalEnergy(canvas, centerX, centerY, progress, visibility, currentTimeMs, accentR, accentG, accentB, density)
    }

    private fun drawBackgroundAura(
        canvas: Canvas,
        cx: Float,
        cy: Float,
        visibility: Float,
        progress: Float,
        currentTimeMs: Long,
        r: Int, g: Int, b: Int,
        density: Float,
        layout: KaraokeIntroLayout
    ) {
        val pulse = (sin(currentTimeMs / 450f) + 1f) * 0.5f
        val baseRadius = 140f * density * (0.85f + 0.1f * pulse + 0.15f * progress)
        
        // Define a radial gradient for a soft "glow" behavior
        val colors = intArrayOf(
            Color.argb((22f * visibility).toInt(), r, g, b),
            Color.argb((6f * visibility).toInt(), r, g, b),
            Color.TRANSPARENT
        )
        val radialShader = RadialGradient(cx, cy, baseRadius, colors, null, Shader.TileMode.CLAMP)
        radialGlowPaint.shader = radialShader
        
        canvas.drawCircle(cx, cy, baseRadius, radialGlowPaint)
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
        activeColor: Int,
        density: Float,
        layout: KaraokeIntroLayout
    ) {
        if (progress <= 0f) return

        // Total vertical span of the intro text group
        val totalTop = titleY - 30f * density
        val totalBottom = subtitleY + 10f * density
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

    private fun drawOrbitalEnergy(
        canvas: Canvas,
        cx: Float,
        cy: Float,
        progress: Float,
        visibility: Float,
        currentTimeMs: Long,
        r: Int, g: Int, b: Int,
        density: Float
    ) {
        // Two orbs that orbit the center and converge as progress -> 1
        val rotation = currentTimeMs * 0.003f
        val orbitRadius = (120f * density) * (1f - progress).coerceAtLeast(0.1f)
        
        for (i in 0..1) {
            val angle = rotation + i * Math.PI.toFloat()
            val orbX = cx + cos(angle) * orbitRadius
            val orbY = cy + sin(angle) * orbitRadius
            
            val orbSize = (4f + 2f * sin(currentTimeMs / 300f + i)) * density * visibility
            
            // Outer glow
            orbPaint.color = Color.argb((100f * visibility * (1f - progress * 0.5f)).toInt(), r, g, b)
            canvas.drawCircle(orbX, orbY, orbSize * 2.5f, orbPaint)
            
            // Core
            orbPaint.color = Color.argb((255f * visibility).toInt(), 255, 255, 255)
            canvas.drawCircle(orbX, orbY, orbSize, orbPaint)
        }
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
