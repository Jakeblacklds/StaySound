package expo.modules.playerchrome

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.widget.TextViewCompat

internal class PlayerPreview(context: Context, open: () -> Unit) : FrameLayout(context) {
    private val rule = android.view.View(context)
    private val marker = android.view.View(context)
    private fun line() = context.playerText(19f, 700).apply {
        setSingleLine(false); maxLines = 2; gravity = Gravity.CENTER; letterSpacing = -0.25f / 19f
        TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(this, 14, 19, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
    }
    private val incoming = line()
    private val outgoing = line()
    private val following = context.playerText(12f, 500).apply { gravity = Gravity.CENTER }
    private val after = context.playerText(12f, 500).apply { gravity = Gravity.CENTER }
    private var previous = "···"
    private val handoff = ChromeMotion(1f) { p ->
        incoming.alpha = if (p < 0.22f) p / 0.22f * 0.82f else 0.82f + (p - 0.22f) / 0.78f * 0.18f
        incoming.translationY = dp(13f) * (1f - p); incoming.scaleX = 0.975f + p * 0.025f; incoming.scaleY = incoming.scaleX
        outgoing.alpha = if (p < 0.72f) 0.58f - p / 0.72f * 0.42f else 0.16f * (1f - p) / 0.28f
        outgoing.translationY = -dp(13f) * p
        marker.alpha = if (p < 0.35f) 0.42f + p / 0.35f * 0.58f else 1f - (p - 0.35f) / 0.65f * 0.24f
        marker.scaleX = if (p < 0.35f) 0.4f + p / 0.35f * 0.72f else 1.12f - (p - 0.35f) / 0.65f * 0.12f
        marker.scaleY = if (p < 0.35f) 0.8f + p / 0.35f * 0.4f else 1.2f - (p - 0.35f) / 0.65f * 0.2f
    }
    init {
        isClickable = true; isFocusable = true; contentDescription = "Mostrar letras"; setOnClickListener { open() }
        addView(rule, LayoutParams(-1, 1))
        addView(marker, LayoutParams(px(34), px(2), Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        addView(outgoing, LayoutParams(-1, px(46)).apply { topMargin = px(5) })
        addView(incoming, LayoutParams(-1, px(46)).apply { topMargin = px(5) })
        addView(following, LayoutParams(-1, px(16)).apply { topMargin = px(55) })
        addView(after, LayoutParams(-1, px(16)).apply { topMargin = px(75) })
        incoming.text = previous
    }
    fun colors(accent: Int, ink: Int) {
        incoming.setTextColor(accent); outgoing.setTextColor(accent); marker.setBackgroundColor(accent)
        val ghost = alphaColor(ink, 0.208f); following.setTextColor(ghost); after.setTextColor(ghost); rule.setBackgroundColor(ghost)
    }
    fun phrase(text: String, next: String, nextNext: String) {
        val visible = text.ifEmpty { "···" }
        following.text = next.ifEmpty { " " }; after.text = nextNext.ifEmpty { " " }
        if (visible == previous) return
        outgoing.text = if (previous == "···") "" else previous
        previous = visible; incoming.text = visible
        handoff.snap(0f); handoff.timing(1f, 440, true)
    }
    override fun onDetachedFromWindow() { handoff.cancel(); super.onDetachedFromWindow() }
}
