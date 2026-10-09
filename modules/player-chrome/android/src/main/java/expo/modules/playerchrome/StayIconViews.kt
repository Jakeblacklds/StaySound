package expo.modules.playerchrome

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.Drawable
import android.view.View
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator

/** [IconPen] on a real Canvas, in the icon's 24-unit grid. */
class CanvasPen : IconPen {
    lateinit var canvas: Canvas
    var ink = Color.WHITE
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val path = Path()
    private val trimmed = Path()
    private val rect = RectF()
    private val measure = PathMeasure()
    private companion object { val parsed = HashMap<String, Path>() }

    override fun save() { canvas.save() }
    override fun restore() { canvas.restore() }
    override fun translate(x: Float, y: Float) = canvas.translate(x, y)
    override fun rotate(degrees: Float, px: Float, py: Float) = canvas.rotate(degrees, px, py)
    override fun scale(sx: Float, sy: Float, px: Float, py: Float) = canvas.scale(sx, sy, px, py)
    override fun skewX(k: Float) = canvas.skew(k, 0f)
    override fun begin() = path.reset()
    override fun moveTo(x: Float, y: Float) = path.moveTo(x, y)
    override fun lineTo(x: Float, y: Float) = path.lineTo(x, y)
    override fun quadTo(x1: Float, y1: Float, x: Float, y: Float) = path.quadTo(x1, y1, x, y)
    override fun cubicTo(x1: Float, y1: Float, x2: Float, y2: Float, x: Float, y: Float) = path.cubicTo(x1, y1, x2, y2, x, y)
    override fun arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float) {
        rect.set(cx - r, cy - r, cx + r, cy + r); path.arcTo(rect, start, sweep, path.isEmpty)
    }
    override fun circle(cx: Float, cy: Float, r: Float) = path.addCircle(cx, cy, r, Path.Direction.CW)
    override fun roundRect(left: Float, top: Float, right: Float, bottom: Float, radius: Float) {
        rect.set(left, top, right, bottom); path.addRoundRect(rect, radius, radius, Path.Direction.CW)
    }
    override fun svgPath(d: String) { path.addPath(parsed.getOrPut(d) { androidx.core.graphics.PathParser.createPathFromPathData(d) }) }
    override fun close() = path.close()
    private fun paint(style: Paint.Style, width: Float, opacity: Float) {
        paint.style = style; paint.strokeWidth = width
        paint.color = ink; paint.alpha = (Color.alpha(ink) * opacity.coerceIn(0f, 1f)).toInt()
    }
    override fun stroke(width: Float, opacity: Float) { paint(Paint.Style.STROKE, width, opacity); canvas.drawPath(path, paint) }
    override fun fill(opacity: Float) { paint(Paint.Style.FILL, 0f, opacity); canvas.drawPath(path, paint) }
    override fun solid(round: Float, opacity: Float) { paint(Paint.Style.FILL_AND_STROKE, round, opacity); canvas.drawPath(path, paint) }
    override fun strokeTrim(width: Float, end: Float) {
        if (end <= 0f) return
        measure.setPath(path, false)
        trimmed.reset(); measure.getSegment(0f, measure.length * end.coerceAtMost(1f), trimmed, true)
        paint(Paint.Style.STROKE, width, 1f); canvas.drawPath(trimmed, paint)
    }

    /** Draws [kind] into [width]×[height] (a square, centred). */
    fun draw(canvas: Canvas, kind: String, width: Float, height: Float, press: Float, flourish: Float, state: Float) {
        this.canvas = canvas
        val size = minOf(width, height)
        canvas.save()
        canvas.translate((width - size) / 2f, (height - size) / 2f)
        canvas.scale(size / 24f, size / 24f)
        StayIcons.draw(this, kind, press, flourish, state)
        canvas.restore()
    }
}

/**
 * Press + flourish for one icon. Held: winds in; released: an underdamped spring (ζ≈.38)
 * swings past rest and, for [StayIcons.ANIMATED] kinds, the tap flourish plays.
 */
class IconMotion(private val changed: () -> Unit) {
    internal val press = ChromeMotion(0f) { changed() }
    internal val flourish = ChromeMotion(1f) { changed() }
    val pressValue get() = press.value
    val flourishValue get() = flourish.value
    /** Holds the flourish at its start pose until [play] (e.g. a check that draws on later). */
    fun rewind() = flourish.snap(0f)
    var enabled = true
    private var held = false
    fun setPressed(value: Boolean, kind: String?) {
        if (value == held) return
        held = value
        if (!enabled) { settle(); return }
        if (value) press.curve(1f, 110L, EASE_OUT)
        else {
            press.spring(0f, 15.6f, 420f, 1f)
            if (kind in StayIcons.ANIMATED) play()
        }
    }
    fun play() { if (enabled) { flourish.snap(0f); flourish.curve(1f, 720L, LinearInterpolator()) } }
    fun settle() { press.snap(0f); flourish.snap(1f) }
    private companion object { val EASE_OUT = PathInterpolator(.33f, 1f, .68f, 1f) }
}

/**
 * A catalogue icon as a View. Put it inside any clickable parent: ViewGroup passes the
 * parent's pressed state to non-clickable children, so the press/flourish run by themselves.
 */
open class StayIconView(context: Context, name: String) : View(context) {
    var name = name
        set(value) { field = value; kind = StayIcons.resolve(value); state = StayIcons.stateOf(value); invalidate() }
    private var kind: String? = StayIcons.resolve(name)
    var ink = Color.WHITE
        set(value) { field = value; invalidate() }
    var state = StayIcons.stateOf(name)
        set(value) { field = value; invalidate() }
    /** Decorative icons (placeholders, status marks) never animate. */
    var interactive = true
    val motion = IconMotion { invalidate() }
    private val pen = CanvasPen()
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    override fun setPressed(pressed: Boolean) {
        super.setPressed(pressed)
        if (interactive) motion.setPressed(pressed, kind)
    }
    override fun onDraw(canvas: Canvas) {
        val kind = kind ?: return
        pen.ink = ink
        canvas.save(); canvas.translate(paddingLeft.toFloat(), paddingTop.toFloat())
        pen.draw(canvas, kind, (width - paddingLeft - paddingRight).toFloat(), (height - paddingTop - paddingBottom).toFloat(),
            motion.press.value, motion.flourish.value, state)
        canvas.restore()
    }
    override fun onDetachedFromWindow() { motion.settle(); super.onDetachedFromWindow() }
}

/**
 * A catalogue icon as a Drawable, for ImageView/ImageButton, compound drawables and Glide
 * placeholders. Stateful: the host view's pressed state drives the same motion as [StayIconView].
 */
class StayIconDrawable(name: String, ink: Int = Color.WHITE, private val sizePx: Int = -1, private val interactive: Boolean = true) : Drawable() {
    private val kind = StayIcons.resolve(name)
    private val state = StayIcons.stateOf(name)
    var ink = ink
        set(value) { field = value; invalidateSelf() }
    private var tint: ColorStateList? = null
    private val pen = CanvasPen()
    private val motion = IconMotion { invalidateSelf() }

    override fun draw(canvas: Canvas) {
        val kind = kind ?: return
        val color = tint?.getColorForState(getState(), ink) ?: ink
        pen.ink = Color.argb(Color.alpha(color) * drawAlpha / 255, Color.red(color), Color.green(color), Color.blue(color))
        canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        pen.draw(canvas, kind, bounds.width().toFloat(), bounds.height().toFloat(), motion.press.value, motion.flourish.value, state)
        canvas.restore()
    }
    override fun isStateful() = interactive || tint?.isStateful == true
    override fun onStateChange(state: IntArray): Boolean {
        if (interactive) motion.setPressed(android.R.attr.state_pressed in state, kind)
        return tint?.isStateful == true
    }
    override fun setTintList(tint: ColorStateList?) { this.tint = tint; invalidateSelf() }
    private var drawAlpha = 255
    override fun setAlpha(alpha: Int) { drawAlpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { pen.paint.colorFilter = colorFilter; invalidateSelf() }
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
    override fun getIntrinsicWidth() = sizePx
    override fun getIntrinsicHeight() = sizePx
    override fun setVisible(visible: Boolean, restart: Boolean): Boolean {
        if (!visible) motion.settle()
        return super.setVisible(visible, restart)
    }
}

/** A catalogue drawable sized like the vector icons it replaces (24dp, mid-grey until tinted). */
fun Context.stayIcon(name: String, sizeDp: Float = 24f, interactive: Boolean = true) =
    StayIconDrawable(name, 0xFF888888.toInt(), (sizeDp * resources.displayMetrics.density).toInt(), interactive)
