package expo.modules.androidshell

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.accessibility.AccessibilityManager
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private val SETTLE = PathInterpolator(.05f, .7f, .1f, 1f)
private val EXIT = PathInterpolator(.3f, 0f, .8f, .15f)
private fun motionEnabled() = Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()

/**
 * StaySound's notification card. Replaces the stock Snackbar: a deep surface
 * lightly tinted by the notice type, a glyph badge, a countdown hairline that
 * pauses while touched, swipe-to-dismiss, and spring-like entry/exit.
 *
 * [onDismiss] fires once, only for user/timeout dismissals; [dispose] removes
 * the card silently (replacement, unmount) with its exit animation.
 */
@SuppressLint("ViewConstructor")
internal class ShellToast(
    context: Context,
    private val style: ShellStyle,
    message: String,
    private val type: String,
    private val onDismiss: () -> Unit,
) : LinearLayout(context) {
    private val density = resources.displayMetrics.density
    private val accent = when (type) {
        "error" -> style.error
        "success" -> style.primary
        "warning" -> style.color("tertiary", "#FFB95C")
        else -> style.color("onSurfaceVariant", "#CDD1DA")
    }
    private val badge = ToastGlyph(context, type, accent)
    private val text = TextView(context)
    private val close = ToastGlyph(context, "close", style.secondary)
    private val countdown = View(context)
    private val card = LinearLayout(context)
    private var finished = false
    private var timer: ValueAnimator? = null
    private var velocity: VelocityTracker? = null
    private var downX = 0f
    private var downY = 0f
    private var dragging = false
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    init {
        orientation = VERTICAL
        clipChildren = false; clipToPadding = false
        val surface = ColorUtils.blendARGB(ColorUtils.blendARGB(style.surface, Color.WHITE, .06f), accent, .14f)
        background = GradientDrawable().apply {
            setColor(surface); cornerRadius = 20 * density
            setStroke(max(1, density.toInt()), ColorUtils.setAlphaComponent(accent, 72))
        }
        elevation = 14 * density
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, 20 * density)
            }
        }
        clipToOutline = true

        card.gravity = Gravity.CENTER_VERTICAL
        card.setPadding(dp(14), dp(12), dp(6), dp(12))
        card.addView(badge, LayoutParams(dp(34), dp(34)).apply { marginEnd = dp(12) })
        text.text = message
        text.textSize = 14f
        text.setTextColor(style.text)
        text.maxLines = 6
        text.ellipsize = TextUtils.TruncateAt.END
        text.setLineSpacing(0f, 1.12f)
        card.addView(text, LayoutParams(0, -2, 1f))
        close.contentDescription = "Cerrar"
        close.isClickable = true; close.isFocusable = true
        close.setOnClickListener { finish(userAction = true, towardX = 0f) }
        close.background = android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(ColorUtils.setAlphaComponent(accent, 60)), null, null)
        card.addView(close, LayoutParams(dp(44), dp(44)).apply { marginStart = dp(4) })
        addView(card, LayoutParams(-1, -2))

        countdown.setBackgroundColor(ColorUtils.setAlphaComponent(accent, 150))
        countdown.pivotX = 0f
        addView(countdown, LayoutParams(-1, max(1, (2 * density).toInt())))

        accessibilityLiveRegion = if (type == "error") ACCESSIBILITY_LIVE_REGION_ASSERTIVE else ACCESSIBILITY_LIVE_REGION_POLITE
        contentDescription = message
    }

    private fun dp(value: Int) = (value * density).toInt()

    fun show() {
        val base = (2_600L + text.text.length * 45L).coerceIn(3_500L, 8_000L)
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        val duration = if (Build.VERSION.SDK_INT >= 29 && manager != null) {
            manager.getRecommendedTimeoutMillis(base.toInt(), AccessibilityManager.FLAG_CONTENT_TEXT or AccessibilityManager.FLAG_CONTENT_CONTROLS).toLong()
        } else base

        if (type == "error" && Build.VERSION.SDK_INT >= 30) performHapticFeedback(HapticFeedbackConstants.REJECT)
        if (!motionEnabled()) { startTimer(duration); return }
        alpha = 0f; translationY = 28 * density; scaleX = .94f; scaleY = .94f
        animate().alpha(1f).translationY(0f).scaleX(1f).scaleY(1f)
            .setDuration(460L).setInterpolator(SETTLE).start()
        badge.pop(delayMs = 110L)
        startTimer(duration)
    }

    private fun startTimer(duration: Long) {
        timer = ValueAnimator.ofFloat(1f, 0f).apply {
            this.duration = duration; interpolator = LinearInterpolator()
            addUpdateListener { countdown.scaleX = it.animatedValue as Float }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                private var cancelled = false
                override fun onAnimationCancel(animation: android.animation.Animator) { cancelled = true }
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (!cancelled) finish(userAction = true, towardX = 0f)
                }
            })
            start()
        }
    }

    /** Silent removal: replaced by a newer notice or the host went away. */
    fun dispose() = finish(userAction = false, towardX = 0f)

    private fun finish(userAction: Boolean, towardX: Float) {
        if (finished) return
        finished = true
        timer?.cancel()
        if (userAction) onDismiss()
        val parent = parent as? FrameLayout
        val remove = { parent?.removeView(this) }
        if (!motionEnabled() || !isAttachedToWindow) { remove(); return }
        animate().cancel()
        val exit = animate().alpha(0f).setDuration(220L).setInterpolator(EXIT)
        if (towardX != 0f) exit.translationX(towardX) else exit.translationY(22 * density).scaleX(.97f).scaleY(.97f)
        exit.withEndAction { remove() }.start()
    }

    // Touch: hold to pause the countdown, drag sideways (or down) to dismiss.
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; dragging = false; timer?.pause() }
            MotionEvent.ACTION_MOVE -> if (abs(event.rawX - downX) > touchSlop || event.rawY - downY > touchSlop) {
                dragging = true; parent?.requestDisallowInterceptTouchEvent(true); return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> timer?.resume()
        }
        return false
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (finished) return false
        if (velocity == null) velocity = VelocityTracker.obtain()
        velocity?.addMovement(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; timer?.pause(); return true }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downX
                val dy = max(0f, event.rawY - downY)
                if (abs(dx) >= dy) {
                    translationX = dx; translationY = 0f
                    alpha = 1f - min(1f, abs(dx) / (width * .9f))
                } else {
                    translationY = dy * .7f; translationX = 0f
                    alpha = 1f - min(1f, dy / (height * 1.6f))
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                velocity?.computeCurrentVelocity(1000)
                val vx = velocity?.xVelocity ?: 0f
                val vy = velocity?.yVelocity ?: 0f
                velocity?.recycle(); velocity = null
                val flungX = abs(vx) > 900 * density && abs(vx) > abs(vy)
                val farX = abs(translationX) > width * .35f
                val downward = translationY > height * .45f || vy > 900 * density
                when {
                    flungX || farX -> finish(userAction = true,
                        towardX = (if ((if (flungX) vx else translationX) > 0) 1 else -1) * width * 1.1f)
                    downward -> finish(userAction = true, towardX = 0f)
                    else -> {
                        animate().translationX(0f).translationY(0f).alpha(1f)
                            .setDuration(320L).setInterpolator(SETTLE).start()
                        timer?.resume()
                    }
                }
                dragging = false
            }
        }
        return true
    }

    override fun onDetachedFromWindow() {
        timer?.cancel(); velocity?.recycle(); velocity = null
        super.onDetachedFromWindow()
    }
}

/** Line glyphs matching the app's 24-unit icon family, drawn in a tinted disc. */
@SuppressLint("ViewConstructor")
internal class ToastGlyph(context: Context, private val kind: String, private val tint: Int) : View(context) {
    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val disc = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()

    fun pop(delayMs: Long) {
        scaleX = .4f; scaleY = .4f; alpha = 0f
        animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(delayMs).setDuration(420L)
            .setInterpolator(android.view.animation.OvershootInterpolator(2.4f)).start()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val unit = if (kind == "close") 16f * density / 24f else 18f * density / 24f
        if (kind != "close") {
            disc.color = ColorUtils.setAlphaComponent(tint, 46)
            canvas.drawCircle(cx, cy, min(width, height) / 2f, disc)
        }
        paint.color = tint
        paint.strokeWidth = 2f * density
        path.reset()
        fun p(x: Float, y: Float) = Pair(cx + (x - 12f) * unit, cy + (y - 12f) * unit)
        fun move(x: Float, y: Float) = p(x, y).let { path.moveTo(it.first, it.second) }
        fun line(x: Float, y: Float) = p(x, y).let { path.lineTo(it.first, it.second) }
        when (kind) {
            "success" -> { move(5f, 12.5f); line(10f, 17f); line(19f, 7.5f) }
            "error" -> { move(12f, 6f); line(12f, 13.5f); move(12f, 18f); line(12f, 18.1f) }
            "warning" -> { move(12f, 4.5f); line(20.5f, 19f); line(3.5f, 19f); path.close(); move(12f, 10f); line(12f, 13.5f); move(12f, 16.4f); line(12f, 16.5f) }
            "close" -> { move(6f, 6f); line(18f, 18f); move(18f, 6f); line(6f, 18f) }
            else -> { move(12f, 11f); line(12f, 17f); move(12f, 7f); line(12f, 7.1f) }
        }
        canvas.drawPath(path, paint)
    }
}
