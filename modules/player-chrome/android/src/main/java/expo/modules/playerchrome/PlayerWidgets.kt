package expo.modules.playerchrome

import android.content.Context
import android.graphics.*
import android.view.View
import android.view.Gravity
import android.widget.FrameLayout
import androidx.core.graphics.ColorUtils
import kotlin.math.*

internal fun Context.playerText(size: Float, weight: Int) = chromeText(size, weight).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO }

internal fun alphaColor(ink: Int, alpha: Float) = ColorUtils.setAlphaComponent(ink, (255 * alpha).toInt().coerceIn(0, 255))
internal fun playerColor(value: String, fallback: Int = Color.WHITE): Int = try {
    when {
        value.startsWith("rgba(") -> {
            val parts = value.removePrefix("rgba(").removeSuffix(")").split(',').map { it.trim().toFloat() }
            Color.argb((parts[3] * 255).toInt(), parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
        }
        value.length == 9 && value.startsWith('#') -> Color.parseColor("#" + value.takeLast(2) + value.substring(1, 7))
        else -> Color.parseColor(value)
    }
} catch (_: Exception) { fallback }

/** Reanimated's default RGB interpolation uses gamma 2.2. */
internal fun gammaColor(from: Int, to: Int, progress: Float): Int {
    val p=progress.coerceIn(0f,1f)
    fun channel(a:Int,b:Int) = (255.0*((a/255.0).pow(2.2)*(1-p)+(b/255.0).pow(2.2)*p).pow(1/2.2)).roundToInt().coerceIn(0,255)
    return Color.argb((Color.alpha(from)+(Color.alpha(to)-Color.alpha(from))*p).roundToInt(),channel(Color.red(from),Color.red(to)),channel(Color.green(from),Color.green(to)),channel(Color.blue(from),Color.blue(to)))
}

internal class PlayerIcon(context: Context, name: String, val sizeDp: Float) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var glyph = ""
    var name = name
        set(value) { field = value; glyph = String(Character.toChars(PlayerIcons.glyphs[value] ?: 983925)); invalidate() }
    var ink = Color.WHITE
        set(value) { field = value; invalidate() }
    init {
        if (font == null) font = Typeface.createFromAsset(context.assets, "player/MaterialCommunityIcons.ttf")
        paint.typeface = font; paint.textAlign = Paint.Align.CENTER
        this.name = name
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    override fun onDraw(canvas: Canvas) {
        paint.color = ink; paint.textSize = dp(sizeDp)
        val fm = paint.fontMetrics
        canvas.drawText(glyph, width / 2f, (height - fm.ascent - fm.descent) / 2f, paint)
    }
    companion object { private var font: Typeface? = null }
}

internal class PlayerControl(context: Context, name: String, size: Float, label: String, action: () -> Unit) : FrameLayout(context) {
    val icon = PlayerIcon(context, name, size)
    private val pause = PlayerIcon(context, "pause", size).apply { alpha = 0f }
    private val particles = FavoriteParticles(context)
    private val selectedPill = View(context).apply { alpha=0f }
    private var active = false
    private var first = true
    private var baseInk = Color.WHITE
    private var selectedInk = Color.WHITE
    private val press = ChromeMotion(0f) { update() }
    private val toggle = ChromeMotion(0f) { update() }
    private val pop = ChromeMotion(0f) { update() }
    private val playState = ChromeMotion(0f) { update() }
    private val favoriteScale = ChromeMotion(1f) { update() }
    private val burst = ChromeMotion(1f) { particles.progress = it }
    var lyricsControl = false
    var pressedScale = .9f
    var toggleControl = false
    var favoriteControl = false
    var playControl = false
    private val button = ChromeButton(context) { held ->
        if (lyricsControl) {
            if (held) press.timing(1f,120) else press.curve(0f,170,android.view.animation.OvershootInterpolator(1.2f))
        } else press.timing(if (held) 1f else 0f, if (held) 80 else 150, !held)
    }
    init {
        clipChildren = false; clipToPadding = false
        button.contentDescription = label
        button.addView(selectedPill, LayoutParams(-1,-1))
        button.addView(icon, LayoutParams(-1, -1))
        button.addView(pause, LayoutParams(-1, -1))
        addView(particles, LayoutParams(px(90), px(90), Gravity.CENTER))
        addView(button, LayoutParams(-1, -1))
        button.setOnClickListener {
            if (favoriteControl) {
                if (!active) {
                    favoriteScale.timing(1.8f, 200) { favoriteScale.spring(1.1f, 30f, 600f, 0.8f) }
                    burst.snap(0f); burst.timing(1f, 400)
                } else favoriteScale.timing(1f, 100)
            }
            action()
        }
    }
    fun setLabel(value: String) { button.contentDescription = value }
    fun onTap(action: () -> Unit) { button.setOnClickListener { action() } }
    fun onHold(action: () -> Unit) { button.setOnLongClickListener { action(); true } }
    fun colors(inactive: Int, selected: Int = inactive) {
        baseInk = inactive; selectedInk = selected; particles.ink = selected; update()
    }
    fun selected(value: Boolean) {
        if (value == active && !first) return
        val becoming = value && !first
        active = value; button.isSelected = value
        if (first) toggle.snap(if (value) 1f else 0f)
        else if(lyricsControl) toggle.spring(if(value)1f else 0f,18f,260f,.6f)
        else toggle.timing(if (value) 1f else 0f, 220, true)
        if (becoming && toggleControl && !lyricsControl) pop.timing(1f, 130) { pop.spring(0f, 9f, 240f, 0.5f) }
        if (favoriteControl) icon.name = if (value) "heart" else "heart-outline"
        first = false
    }
    fun playing(value: Boolean) {
        if (!playControl) return
        playState.curve(if (value) 1f else 0f, if(lyricsControl)220 else 200, FullPlayerMotion.cubicInOut)
        setLabel(if (value) "Pausar" else "Reproducir")
    }
    private fun update() {
        val scale = (1f - press.value * if (toggleControl) 0.16f else 0.14f) * (1f + pop.value * 0.28f) * favoriteScale.value
        if (lyricsControl) { scaleX=1-press.value*(1-pressedScale); scaleY=scaleX }
        selectedPill.background=roundSurface(selectedInk,dp(99f))
        selectedPill.alpha=if(lyricsControl && toggleControl) toggle.value.coerceIn(0f,1f)*.2f else 0f
        selectedPill.scaleX=.5f+toggle.value*.5f;selectedPill.scaleY=selectedPill.scaleX
        val glyphScale=if(lyricsControl)1f else scale
        icon.scaleX = glyphScale; icon.scaleY = glyphScale; pause.scaleX = glyphScale; pause.scaleY = glyphScale
        button.alpha = if(lyricsControl)1f else 1f - press.value * 0.4f
        icon.ink = gammaColor(baseInk, selectedInk, toggle.value); pause.ink = baseInk
        if (playControl) {
            icon.alpha = 1f - playState.value; pause.alpha = playState.value
            icon.scaleX *= 1f - playState.value * 0.3f; icon.scaleY = icon.scaleX
            pause.scaleX *= 0.7f + playState.value * 0.3f; pause.scaleY = pause.scaleX
        }
    }
    override fun onDetachedFromWindow() {
        listOf(press, toggle, pop, playState, favoriteScale, burst).forEach { it.cancel() }
        super.onDetachedFromWindow()
    }
}

private class FavoriteParticles(context: Context) : View(context) {
    var ink = Color.WHITE
    var progress = 1f
        set(value) { field = value; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
        val p = progress
        val opacity = when { p < 0.2f -> p / 0.2f; p < 0.8f -> 1f; else -> (1f - p) / 0.2f }
        val scale = if (p < 0.2f) p / 0.2f * 1.2f else (1f - p) / 0.8f * 1.2f
        paint.color = alphaColor(ink, opacity)
        for (i in 0..7) {
            val angle = i * PI / 4
            canvas.drawCircle(width / 2f + (cos(angle) * dp(35f) * p).toFloat(),
                height / 2f + (sin(angle) * dp(35f) * p).toFloat(), dp(3f) * scale, paint)
        }
    }
}
