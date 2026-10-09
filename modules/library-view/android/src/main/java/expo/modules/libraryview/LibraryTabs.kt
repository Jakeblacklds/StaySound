package expo.modules.libraryview

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import androidx.core.graphics.ColorUtils
import android.graphics.Canvas
import android.graphics.Paint
import android.text.TextUtils
import android.view.accessibility.AccessibilityNodeInfo
import android.view.Gravity
import android.view.animation.PathInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.common.assets.ReactFontManager

/** The incumbent text tabs and one sliding underline, drawn without relaying frames to JS. */
internal class LibraryTabs(context: Context, private val select: (String) -> Unit) : LinearLayout(context) {
    private val keys = listOf("songs", "albums", "artists")
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var active = "songs"
    private var underlineLeft = 0f
    private var underlineRight = 0f
    private var animator: ValueAnimator? = null
    private var ready = false
    var motionEnabled = true
    private val density = resources.displayMetrics.density
    private fun dp(value: Int) = (value * density).toInt()
    init {
        gravity = Gravity.CENTER_VERTICAL
        keys.forEach { key ->
            addView(object : TextView(context) {
                override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
                    super.onInitializeAccessibilityNodeInfo(info)
                    info.className = "android.app.ActionBar\$Tab"
                }
            }.apply {
                gravity = Gravity.CENTER
                textSize = 14f
                includeFontPadding = false
                minimumHeight = dp(48)
                isFocusable = true
                maxLines = 2; ellipsize = TextUtils.TruncateAt.END
                setPadding(dp(4), dp(8), dp(4), dp(12))
                typeface = ReactFontManager.getInstance().getTypeface("StaySound", 600, false, context.assets)
                setOnClickListener { select(key) }
            }, LayoutParams(0, -2, 1f))
        }
        setWillNotDraw(false)
    }
    fun update(labels: Map<String, String>, selection: String, accent: Int, muted: Int) {
        val changed = selection != active
        active = selection
        paint.color = accent
        keys.forEachIndexed { index, key ->
            (getChildAt(index) as TextView).apply {
                text = labels[key]
                isSelected = selection == key
                setTextColor(if (isSelected) accent else muted)
                alpha = 1f
                background = RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(accent, 32)),
                    null, GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(12).toFloat() })
            }
        }
        if (isLaidOut && (changed || !motionEnabled)) moveIndicator(changed && motionEnabled)
        invalidate()
    }
    private fun moveIndicator(animate: Boolean) {
        val child = getChildAt(keys.indexOf(active))
        val targetLeft = child.left + dp(10).toFloat()
        val targetRight = child.right - dp(10).toFloat()
        animator?.cancel()
        if (animate && motionEnabled && ready && ValueAnimator.areAnimatorsEnabled()) {
            val oldLeft = underlineLeft
            val oldRight = underlineRight
            animator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 280
                interpolator = PathInterpolator(0.22f, 1f, 0.36f, 1f)
                addUpdateListener {
                    val progress = it.animatedValue as Float
                    underlineLeft = oldLeft + (targetLeft - oldLeft) * progress
                    underlineRight = oldRight + (targetRight - oldRight) * progress
                    invalidate()
                }
                start()
            }
        } else {
            underlineLeft = targetLeft
            underlineRight = targetRight
            ready = true
            invalidate()
        }
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        super.onLayout(changed, l, t, r, b)
        if (changed || !ready) moveIndicator(false)
    }
    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        canvas.drawRoundRect(underlineLeft, height - dp(4).toFloat(), underlineRight, height - dp(1).toFloat(), density * 1.5f, density * 1.5f, paint)
    }
    override fun onDetachedFromWindow() { animator?.cancel(); super.onDetachedFromWindow() }
}
