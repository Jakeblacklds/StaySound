package expo.modules.searchview

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.view.animation.PathInterpolator
import android.widget.Button
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

internal object SearchMotion {
    /** Material "emphasized decelerate": fast out, long settle. */
    val SETTLE = PathInterpolator(.05f, .7f, .1f, 1f)
    val STANDARD = PathInterpolator(.2f, 0f, 0f, 1f)
    val EXIT = PathInterpolator(.3f, 0f, .8f, .15f)
    fun enabled(): Boolean = Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()
}

/**
 * The row's download control. One view owns every state so transitions can
 * morph instead of swapping icons: the arrow folds into a progress ring, the
 * ring fills and bursts into a check that draws itself, errors shake into a
 * retry glyph. Pressing lifts it and lights it from behind.
 */
internal class DownloadStateButton(context: Context, private val style: SearchStyle) : View(context) {
    private val density = resources.displayMetrics.density
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arcBounds = RectF()
    private val iconPath = Path()
    private val iconMatrix = Matrix()
    private val measure = PathMeasure()
    private val partial = Path()

    private var boundKey = ""
    var status = "idle"; private set
    private var previous = "idle"
    private var targetProgress = 0f
    private var shownProgress = 0f
    private var morph = 1f       // 0 → 1 while `previous` hands over to `status`
    private var burst = 0f       // completion ring flash
    private var checkDraw = 1f   // how much of the check is drawn
    private var shake = 0f
    private var lift = 0f

    private var progressAnimator: ValueAnimator? = null
    private var morphAnimator: ValueAnimator? = null
    private var burstAnimator: ValueAnimator? = null
    private var shakeAnimator: ValueAnimator? = null
    private var liftAnimator: ValueAnimator? = null

    init {
        isClickable = true; isFocusable = true
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    /**
     * [key] identifies the track; a recycled view bound to another track
     * snaps to its state instead of animating someone else's transition.
     */
    fun bind(key: String, nextStatus: String, progress: Int) {
        val animate = key == boundKey && SearchMotion.enabled() && isAttachedToWindow
        boundKey = key
        val nextProgress = progress.coerceIn(0, 100) / 100f
        if (!animate) {
            cancelAll()
            previous = nextStatus; status = nextStatus
            targetProgress = if (nextStatus == "done") 1f else nextProgress
            shownProgress = targetProgress
            morph = 1f; burst = 0f; checkDraw = 1f; shake = 0f
            invalidate(); return
        }
        if (nextStatus != status) {
            previous = status; status = nextStatus
            when (nextStatus) {
                "done" -> {
                    // Hold the stop glyph until the ring closes; complete()
                    // then hands over to the check.
                    morphAnimator?.cancel(); morph = 0f; checkDraw = 0f
                    targetProgress = 1f; complete()
                }
                "error" -> { startMorph(260L); startShake() }
                "downloading" -> { shownProgress = 0f; startMorph(340L) }
                else -> startMorph(260L)
            }
        }
        if (nextStatus == "downloading" && nextProgress != targetProgress) {
            targetProgress = nextProgress
            animateProgress()
        }
        invalidate()
    }

    private fun animateProgress() {
        progressAnimator?.cancel()
        val from = shownProgress
        progressAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 520L; interpolator = SearchMotion.STANDARD
            addUpdateListener { shownProgress = from + (targetProgress - from) * it.animatedFraction; invalidate() }
            start()
        }
    }

    private fun startMorph(ms: Long) {
        morphAnimator?.cancel()
        morph = 0f
        morphAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = ms; interpolator = SearchMotion.SETTLE
            addUpdateListener { morph = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    /** Ring closes, flashes outward, then the check draws itself in. */
    private fun complete() {
        val from = shownProgress
        progressAnimator?.cancel()
        progressAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = ((1f - from) * 420L).toLong().coerceAtLeast(160L); interpolator = SearchMotion.STANDARD
            addUpdateListener { shownProgress = from + (1f - from) * it.animatedFraction; invalidate() }
            addListener(object : AnimatorListenerAdapter() {
                private var cancelled = false
                override fun onAnimationCancel(animation: Animator) { cancelled = true }
                override fun onAnimationEnd(animation: Animator) {
                    if (cancelled || status != "done") return
                    checkDraw = 0f
                    startMorph(420L)
                    burstAnimator?.cancel()
                    burstAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
                        duration = 720L; interpolator = SearchMotion.SETTLE
                        addUpdateListener {
                            burst = it.animatedValue as Float
                            checkDraw = min(1f, it.animatedFraction * 1.8f)
                            invalidate()
                        }
                        start()
                    }
                    if (Build.VERSION.SDK_INT >= 30) performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                }
            })
            start()
        }
    }

    private fun startShake() {
        shakeAnimator?.cancel()
        shakeAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 460L; interpolator = LinearInterpolator()
            addUpdateListener {
                val t = it.animatedValue as Float
                // Damped oscillation: three swings that die out.
                shake = (sin(t * Math.PI * 6).toFloat() * (1f - t) * 5f * density)
                translationX = shake
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) { translationX = 0f }
            })
            start()
        }
        if (Build.VERSION.SDK_INT >= 30) performHapticFeedback(HapticFeedbackConstants.REJECT)
    }

    override fun drawableStateChanged() {
        super.drawableStateChanged()
        val target = if (isPressed && isEnabled) 1f else 0f
        if (target == lift) return
        liftAnimator?.cancel()
        if (!SearchMotion.enabled()) { lift = target; translationY = -2f * density * lift; invalidate(); return }
        val from = lift
        liftAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = if (target > from) 120L else 320L
            interpolator = if (target > from) SearchMotion.STANDARD else OvershootInterpolator(2.2f)
            addUpdateListener {
                lift = from + (target - from) * it.animatedFraction
                translationY = -2f * density * lift
                invalidate()
            }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val primary = style.color("primary")
        val ringRadius = 14.5f * density

        // Press glow: soft accent light behind the control.
        if (lift > 0.01f) {
            glowPaint.shader = RadialGradient(cx, cy, 24f * density,
                intArrayOf(ColorUtils.setAlphaComponent(primary, (70 * lift).toInt()), 0), null, Shader.TileMode.CLAMP)
            canvas.drawCircle(cx, cy, 24f * density, glowPaint)
        }

        val ringNow = ringWeight(status)
        val ringBefore = ringWeight(previous)
        val ring = ringBefore + (ringNow - ringBefore) * morph
        if (ring > 0.01f) drawRing(canvas, cx, cy, ringRadius, ring, primary)

        // Completion flash: a ring that expands and fades past the button.
        if (burst in 0.001f..0.999f) {
            stroke.strokeWidth = 2f * density * (1f - burst)
            stroke.color = ColorUtils.setAlphaComponent(primary, (200 * (1f - burst)).toInt())
            canvas.drawCircle(cx, cy, ringRadius + 8f * density * burst, stroke)
            fill.color = ColorUtils.setAlphaComponent(primary, (60 * (1f - burst)).toInt())
            canvas.drawCircle(cx, cy, ringRadius, fill)
        }

        // Icons cross-scale: the outgoing one shrinks away, the incoming one
        // grows in with a little overshoot.
        if (morph < 1f) drawIcon(canvas, previous, cx, cy, 1f - morph, 0.6f + 0.4f * (1f - morph), 1f)
        val incomingScale = if (morph < 1f) 0.6f + 0.4f * overshoot(morph) else 1f
        drawIcon(canvas, status, cx, cy, morph, incomingScale, if (status == "done") checkDraw else 1f)
    }

    private fun ringWeight(value: String) = when (value) { "downloading" -> 1f; "done" -> if (burst > 0f || shownProgress < 1f) 1f - burst else 0f; else -> 0f }

    private fun drawRing(canvas: Canvas, cx: Float, cy: Float, r: Float, weight: Float, primary: Int) {
        arcBounds.set(cx - r, cy - r, cx + r, cy + r)
        stroke.strokeWidth = 2.4f * density
        stroke.color = ColorUtils.setAlphaComponent(primary, (56 * weight).toInt())
        canvas.drawCircle(cx, cy, r, stroke)
        stroke.color = ColorUtils.setAlphaComponent(primary, (255 * weight).toInt())
        if (status == "downloading" && targetProgress <= 0f) {
            // Waiting on the peer: a comet that orbits and breathes.
            val now = SystemClock.uptimeMillis()
            val start = (now % 1100L) / 1100f * 360f - 90f
            val sweep = 50f + 55f * (0.5f + 0.5f * sin(now / 520.0).toFloat())
            canvas.drawArc(arcBounds, start, sweep, false, stroke)
            postInvalidateOnAnimation()
        } else if (shownProgress > 0f) {
            canvas.drawArc(arcBounds, -90f, 360f * shownProgress, false, stroke)
        }
    }

    private fun drawIcon(canvas: Canvas, value: String, cx: Float, cy: Float, alpha: Float, scale: Float, drawn: Float) {
        if (alpha <= 0.01f) return
        val tint = if (value == "error") style.ink("error") else style.color("primary")
        if (value == "downloading") {
            // Stop square: tapping cancels.
            val half = 3.6f * density * scale
            fill.color = ColorUtils.setAlphaComponent(tint, (255 * alpha).toInt())
            canvas.drawRoundRect(cx - half, cy - half, cx + half, cy + half, 1.6f * density, 1.6f * density, fill)
            return
        }
        val data = when (value) { "done" -> CHECK; "error" -> REFRESH; else -> DOWNLOAD }
        val size = (if (value == "done") 20f else 22f) * density * scale
        iconPath.set(data)
        iconMatrix.setScale(size / 24f, size / 24f)
        iconMatrix.postTranslate(cx - size / 2f, cy - size / 2f)
        iconPath.transform(iconMatrix)
        stroke.strokeWidth = 1.9f * density * max(scale, 0.8f)
        stroke.color = ColorUtils.setAlphaComponent(tint, (255 * alpha).toInt())
        if (drawn >= 1f) { canvas.drawPath(iconPath, stroke); return }
        partial.reset()
        measure.setPath(iconPath, false)
        measure.getSegment(0f, measure.length * drawn, partial, true)
        canvas.drawPath(partial, stroke)
    }

    private fun overshoot(t: Float): Float {
        val s = 1.9f; val x = t - 1f
        return x * x * ((s + 1f) * x + s) + 1f
    }

    private fun cancelAll() {
        progressAnimator?.cancel(); morphAnimator?.cancel(); burstAnimator?.cancel(); shakeAnimator?.cancel()
        translationX = 0f
    }

    override fun onDetachedFromWindow() {
        cancelAll(); liftAnimator?.cancel(); lift = 0f; translationY = 0f
        morph = 1f; burst = 0f; checkDraw = 1f
        if (status == "done") shownProgress = 1f
        super.onDetachedFromWindow()
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = Button::class.java.name
    }

    private companion object {
        val DOWNLOAD: Path = PathParser.createPathFromPathData("M12,3L12,15M7,10L12,15L17,10M5,17L5,21L19,21L19,17")
        val CHECK: Path = PathParser.createPathFromPathData("M5,12L10,17L20,7")
        val REFRESH: Path = PathParser.createPathFromPathData("M20,10A8,8 0,1 0,19 17M20,3L20,10L13,10")
    }
}

/**
 * Placeholder row shown while results load: artwork tile and two text bars
 * with a light sweep, time-based so every row shimmers in sync.
 */
internal class SkeletonRowView(context: Context, private val style: SearchStyle) : View(context) {
    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shine = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    var titleFraction = .62f
    var subtitleFraction = .38f

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), (52 * density).toInt())
    }

    override fun onDraw(canvas: Canvas) {
        val base = ColorUtils.setAlphaComponent(style.color("surfaceVariant"), 150)
        paint.color = base
        val art = 52f * density
        val copyStart = art + 14f * density
        val copyWidth = width - copyStart - 56f * density
        rect.set(0f, 0f, art, art)
        canvas.drawRoundRect(rect, 12f * density, 12f * density, paint)
        val bar = 11f * density
        rect.set(copyStart, 12f * density, copyStart + copyWidth * titleFraction, 12f * density + bar)
        canvas.drawRoundRect(rect, bar / 2, bar / 2, paint)
        rect.set(copyStart, 31f * density, copyStart + copyWidth * subtitleFraction, 31f * density + bar)
        canvas.drawRoundRect(rect, bar / 2, bar / 2, paint)

        if (!SearchMotion.enabled()) return
        val span = width * 1.6f
        val phase = (SystemClock.uptimeMillis() % 1500L) / 1500f
        val x = -width * 0.6f + span * phase
        val highlight = ColorUtils.setAlphaComponent(style.color("onSurface"), 22)
        shine.shader = LinearGradient(x - 90f * density, 0f, x + 90f * density, 0f,
            intArrayOf(0, highlight, 0), floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP)
        rect.set(0f, 0f, art, art); canvas.drawRoundRect(rect, 12f * density, 12f * density, shine)
        rect.set(copyStart, 12f * density, copyStart + copyWidth * titleFraction, 12f * density + bar)
        canvas.drawRoundRect(rect, bar / 2, bar / 2, shine)
        rect.set(copyStart, 31f * density, copyStart + copyWidth * subtitleFraction, 31f * density + bar)
        canvas.drawRoundRect(rect, bar / 2, bar / 2, shine)
        if (isShown) postInvalidateOnAnimation()
    }
}

/** A dot that breathes, for the service-health pill. */
internal class PulseDot(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var color = 0
        set(value) { field = value; invalidate() }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val core = 3.5f * density
        if (SearchMotion.enabled()) {
            val t = (SystemClock.uptimeMillis() % 1600L) / 1600f
            paint.color = ColorUtils.setAlphaComponent(color, (110 * (1f - t)).toInt())
            canvas.drawCircle(cx, cy, core + 5f * density * t, paint)
            if (isShown) postInvalidateOnAnimation()
        }
        paint.color = color
        canvas.drawCircle(cx, cy, core, paint)
    }
}
