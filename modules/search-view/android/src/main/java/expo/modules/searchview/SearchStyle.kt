package expo.modules.searchview

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import com.facebook.react.common.assets.ReactFontManager

internal class SearchStyle(val context: Context) {
    var colors: Map<String, String> = emptyMap()
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun color(key: String): Int = runCatching { Color.parseColor(colors[key]) }.getOrDefault(
        when (key) {
            "background", "surface" -> Color.rgb(18, 18, 18)
            "surfaceVariant" -> Color.rgb(38, 38, 38)
            "primary" -> Color.rgb(177, 205, 247)
            "onPrimary" -> Color.BLACK
            "error" -> Color.rgb(255, 180, 171)
            else -> Color.WHITE
        })
    fun ink(key: String = "onSurface", surface: String = "background"): Int {
        val background = ColorUtils.setAlphaComponent(color(surface), 255)
        val candidate = ColorUtils.setAlphaComponent(color(key), 255)
        if (ColorUtils.calculateContrast(candidate, background) >= 4.5) return candidate
        val target = if (ColorUtils.calculateLuminance(background) < 0.4) Color.WHITE else Color.BLACK
        for (i in 1..20) {
            val next = ColorUtils.blendARGB(candidate, target, i / 20f)
            if (ColorUtils.calculateContrast(next, background) >= 4.5) return next
        }
        return target
    }
    fun shape(fill: Int, radius: Int = 12) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat()
    }
    fun ripple(fill: Int = Color.TRANSPARENT) = RippleDrawable(
        ColorStateList.valueOf(ColorUtils.setAlphaComponent(color("primary"), 36)),
        shape(fill), shape(Color.WHITE))
    fun font(weight: Int) = ReactFontManager.getInstance().getTypeface("StaySound", weight, false, context.assets)
    fun text(size: Float, weight: Int = 500) = TextView(context).apply {
        textSize = size; typeface = font(weight); includeFontPadding = false; setTextColor(ink())
    }
}
