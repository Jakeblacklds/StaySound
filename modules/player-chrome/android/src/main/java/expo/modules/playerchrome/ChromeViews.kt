package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.TextView
import android.text.TextUtils
import com.facebook.react.common.assets.ReactFontManager

internal fun View.dp(value: Float) = value * resources.displayMetrics.density
internal fun View.px(value: Int) = dp(value.toFloat()).toInt()
internal fun color(value: String?, fallback: Int = Color.WHITE): Int =
    try { Color.parseColor(value) } catch (_: Exception) { fallback }
internal fun Context.chromeText(size: Float, weight: Int) = TextView(this).apply {
    textSize = size
    includeFontPadding = false
    setSingleLine(true)
    ellipsize = TextUtils.TruncateAt.END
    typeface = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, assets)
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
}
internal fun roundSurface(ink: Int, radius: Float) = GradientDrawable().apply {
    setColor(ink); cornerRadius = radius
}

/** Native click semantics also handle keyboard, TalkBack, long press and ACTION_CANCEL. */
internal class ChromeButton(context: Context, private val press: (Boolean) -> Unit) : FrameLayout(context) {
    var tab = false
    init { isClickable = true; isFocusable = true }
    override fun setPressed(pressed: Boolean) {
        if (isPressed != pressed) press(pressed)
        super.setPressed(pressed)
    }
    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = if (tab) "android.app.ActionBar\$Tab" else "android.widget.Button"
    }
    override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
        // Keyboard focus remains visible without changing the resting design.
        foreground = if (gainFocus) GradientDrawable().apply {
            cornerRadius = dp(18f); setColor(Color.TRANSPARENT); setStroke(px(2), Color.GRAY)
        } else null
    }
}
