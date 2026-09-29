package expo.modules.playerchrome

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.View
import androidx.core.graphics.ColorUtils
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.PI
import kotlin.math.cos

/**
 * Lyric-shaped placeholder that lives inside the karaoke stage: word pills laid out like
 * phrases, one "current" line in focus, a single diagonal shimmer sweeping every row,
 * a staggered entrance and a soft fade into the transport area.
 */
internal class PlayerLyricsSkeleton(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shine = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shineMatrix = Matrix()
    private val rect = RectF()
    private var start = SystemClock.uptimeMillis()
    private var ink = Color.WHITE
    private var accent = Color.WHITE
    private var dark = true
    private var rows = emptyList<Row>()
    private var contentHeight = 0f

    private class Row(val y: Float, val height: Float, val focus: Boolean, val phrase: Int, val words: List<Pair<Float, Float>>)

    // Word widths per phrase (dp). The second phrase is the "current" line the karaoke would focus.
    private val phrases = arrayOf(
        floatArrayOf(74f, 46f, 92f), floatArrayOf(118f, 54f, 86f), floatArrayOf(112f, 72f, 132f, 58f),
        floatArrayOf(86f, 154f, 68f), floatArrayOf(96f, 64f, 108f), floatArrayOf(62f, 128f),
        floatArrayOf(82f, 58f, 116f), floatArrayOf(132f, 74f), floatArrayOf(68f, 146f, 52f), floatArrayOf(104f, 88f, 64f),
    )

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = "Buscando letras"
        accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
        label.typeface = ReactFontManager.getInstance().getTypeface("StaySound", 700, false, context.assets)
        label.textSize = dp(11f); label.letterSpacing = .16f
    }

    fun colors(ink: Int, accent: Int, dark: Boolean) {
        if (this.ink == ink && this.accent == accent && this.dark == dark) return
        this.ink = ink; this.accent = accent; this.dark = dark
        buildShine(); invalidate()
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (changedView === this && visibility == VISIBLE) { start = SystemClock.uptimeMillis(); invalidate() }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        layoutRows(); buildShine()
    }

    private fun layoutRows() {
        val available = width / resources.displayMetrics.density - 60f
        val limit = height / resources.displayMetrics.density
        val out = mutableListOf<Row>()
        var y = 28f; var phrase = 0
        // Repeat the phrase bank until the stage is filled; rows past the fade are never seen.
        while (y < limit && available > 40f) {
            val widths = phrases[phrase % phrases.size]
            val focus = phrase == 1
            val h = if (focus) 26f else 20f
            var line = mutableListOf<Pair<Float, Float>>(); var x = 0f
            widths.forEach { raw ->
                val word = raw * if (focus) 1.12f else 1f
                if (x > 0 && x + word > available) { out += Row(y, h, focus, phrase, line); line = mutableListOf(); x = 0f; y += h + 12f }
                line += x to minOf(word, available); x += word + if (focus) 10f else 8f
            }
            out += Row(y, h, focus, phrase, line)
            y += h + if (focus) 32f else 26f; phrase++
        }
        rows = out; contentHeight = y
    }

    private fun buildShine() {
        val band = dp(220f)
        val peak = alphaColor(ink, if (dark) .16f else .22f)
        shine.shader = LinearGradient(0f, 0f, band, band * .28f,
            intArrayOf(Color.TRANSPARENT, peak, Color.TRANSPARENT), floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP)
    }

    override fun onDraw(canvas: Canvas) {
        if (rows.isEmpty()) return
        val animate = android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled()
        val now = if (animate) (SystemClock.uptimeMillis() - start).toFloat() else 10_000f
        val density = resources.displayMetrics.density
        val stage = height / density
        val fadeFrom = stage - 150f

        // One sweep for the whole block, left to right with a short rest, like a single light passing.
        val cycle = 1700f; val sweep = 1250f
        val t = ((now + 400f) % cycle / sweep).coerceAtMost(1f)
        val eased = if (t < .5f) 2 * t * t else 1 - (-2 * t + 2) * (-2 * t + 2) / 2
        shineMatrix.setTranslate(-dp(220f) + (width + dp(440f)) * eased - dp(110f), 0f)
        shine.shader?.setLocalMatrix(shineMatrix)
        val shineOn = animate && t < 1f

        val baseAlpha = if (dark) .09f else .07f
        val focusInk = ColorUtils.blendARGB(ink, accent, .35f)
        val breath = if (animate) ((1 - cos(now / 2400f * 2 * PI)) / 2).toFloat() else .5f

        for (row in rows) {
            if (row.y > stage) break
            // Staggered entrance per phrase: rise 8dp and fade in with an ease-out.
            val enter = FullPlayerMotion.range(now, row.phrase * 55f, row.phrase * 55f + 420f)
            val lift = 1 - (1 - enter) * (1 - enter) * (1 - enter)
            val edge = if (row.y + row.height > fadeFrom) (1 - (row.y + row.height - fadeFrom) / 150f).coerceIn(0f, 1f) else 1f
            val visibility = lift * edge
            if (visibility <= 0f) continue
            val dy = 8f * (1 - lift)
            paint.color = if (row.focus) alphaColor(focusInk, (baseAlpha * 2.1f + .04f * breath) * visibility)
                else alphaColor(ink, baseAlpha * visibility)
            shine.alpha = (255 * visibility).toInt()
            val radius = dp(row.height / 2f)
            row.words.forEach { (x, w) ->
                rect.set(dp(30f + x), dp(row.y + dy), dp(30f + x + w), dp(row.y + dy + row.height))
                canvas.drawRoundRect(rect, radius, radius, paint)
                if (shineOn) canvas.drawRoundRect(rect, radius, radius, shine)
            }
        }

        // Status caption with three breathing dots, centered on the stage's lower edge.
        val caption = "BUSCANDO LETRAS"
        val labelAlpha = FullPlayerMotion.range(now, 180f, 600f) * if (dark) .62f else .54f
        label.color = alphaColor(ink, labelAlpha)
        val textWidth = label.measureText(caption)
        val left = (width - textWidth - dp(26f)) / 2
        val baseline = height - dp(22f)
        canvas.drawText(caption, left, baseline, label)
        for (i in 0..2) {
            val phase = ((now - i * 180f).coerceAtLeast(0f) % 1200f) / 1200f
            val pulse = ((1 - cos(phase * 2 * PI)) / 2).toFloat()
            label.color = alphaColor(accent, labelAlpha * (.35f + .65f * pulse))
            canvas.drawCircle(left + textWidth + dp(9f + i * 7f), baseline - dp(4f), dp(1.8f + .5f * pulse), label)
        }

        if (animate && isShown && windowVisibility == VISIBLE) postInvalidateOnAnimation()
    }
}
