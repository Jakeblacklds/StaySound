package expo.modules.androidshell

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import org.json.JSONObject

internal class ShellStyle(val context: Context) {
    var colors = JSONObject()
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun color(key: String, fallback: String): Int = runCatching { Color.parseColor(colors.optString(key, fallback)) }.getOrDefault(Color.parseColor(fallback))
    val surface get() = color("surface", "#141820")
    val text get() = color("onSurface", "#FFFFFF")
    val secondary get() = color("onSurfaceVariant", "#CDD1DA")
    val primary get() = color("primary", "#B9C3FF")
    val error get() = color("error", "#FFB4AB")
    fun text(value: String, size: Float = 16f) = TextView(context).apply {
        text = value; textSize = size; setTextColor(this@ShellStyle.text)
    }
    fun button(label: String, destructive: Boolean = false, action: () -> Unit) = MaterialButton(context, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
        text = label; isAllCaps = false; minHeight = dp(48)
        setTextColor(if (destructive) this@ShellStyle.error else primary)
        rippleColor = ColorStateList.valueOf(primary and 0x00ffffff or 0x22000000)
        setOnClickListener { action() }
    }
}
