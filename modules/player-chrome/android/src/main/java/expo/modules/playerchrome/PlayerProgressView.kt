package expo.modules.playerchrome

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.roundToLong

/** Seeks only on release; cancel, a new track, and stale progress cannot commit a drag. */
internal class PlayerProgressView(context: Context, private val seek: (Long) -> Unit) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val font = ReactFontManager.getInstance().getTypeface("StaySound", 600, false, context.assets)
    private val thumb = ChromeMotion(1f) { invalidate() }
    var accent = Color.WHITE
    var ink = Color.WHITE
    var durationMs = 0L
        set(value) { field = value.coerceAtLeast(0); invalidate() }
    private var position = 0L
    private var dragging = false
    private var dragged = 0L
    private var holdUntil = 0L
    private val releaseHold = Runnable { invalidate() }
    init { isFocusable = true; isClickable = true; contentDescription = "Progreso de la canción" }
    fun position(value: Long) {
        position = value.coerceIn(0, durationMs)
        if (!dragging) invalidate()
    }
    fun reset() { dragging = false; holdUntil = 0; position = 0; thumb.snap(1f); invalidate() }
    private fun shown() = if (dragging || SystemClock.uptimeMillis() < holdUntil) dragged else position
    private fun time(ms: Long): String { val s = ms.coerceAtLeast(0) / 1000; return "${s / 60}:${(s % 60).toString().padStart(2, '0')}" }
    override fun onDraw(canvas: Canvas) {
        val x = if (durationMs > 0) width * (shown().toDouble() / durationMs).toFloat() else 0f
        val y = dp(20f)
        paint.color = alphaColor(ink, 0.14f)
        canvas.drawRoundRect(0f, y - dp(2f), width.toFloat(), y + dp(2f), dp(2f), dp(2f), paint)
        paint.color = accent
        canvas.drawRoundRect(0f, y - dp(2f), x, y + dp(2f), dp(2f), dp(2f), paint)
        canvas.drawCircle(x, y, dp(8f) * thumb.value, paint)
        paint.typeface = font; paint.textSize = 11f * resources.displayMetrics.scaledDensity
        paint.color = alphaColor(ink, 0.6f)
        paint.textAlign = Paint.Align.LEFT; canvas.drawText(time(shown()), 0f, dp(43f), paint)
        paint.textAlign = Paint.Align.RIGHT; canvas.drawText(time(durationMs), width.toFloat(), dp(43f), paint)
    }
    private fun drag(x: Float) { dragged = (durationMs * (x / width.coerceAtLeast(1)).coerceIn(0f, 1f)).roundToLong(); invalidate() }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (durationMs <= 0) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { parent.requestDisallowInterceptTouchEvent(true); dragging = true; drag(event.x); thumb.spring(1.5f, 10f, 100f, 1f) }
            MotionEvent.ACTION_MOVE -> if (dragging) drag(event.x)
            MotionEvent.ACTION_UP -> {
                if (!dragging) { parent.requestDisallowInterceptTouchEvent(false); return true }
                drag(event.x); dragging = false; holdUntil = SystemClock.uptimeMillis() + 150
                thumb.spring(1f, 10f, 100f, 1f); seek(dragged); performClick()
                removeCallbacks(releaseHold); postDelayed(releaseHold, 150); parent.requestDisallowInterceptTouchEvent(false)
            }
            MotionEvent.ACTION_CANCEL -> { dragging = false; thumb.spring(1f, 10f, 100f, 1f); parent.requestDisallowInterceptTouchEvent(false); invalidate() }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = "android.widget.SeekBar"
        info.rangeInfo = AccessibilityNodeInfo.RangeInfo.obtain(AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT, 0f, durationMs.toFloat(), shown().toFloat())
        info.text = "${time(shown())} de ${time(durationMs)}"
        if (durationMs > 0) {
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS)
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD)
        }
    }
    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        val next = when (action) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD -> shown() + 10000
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> shown() - 10000
            android.R.id.accessibilityActionSetProgress -> arguments?.getFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE)?.toLong() ?: return false
            else -> return super.performAccessibilityAction(action, arguments)
        }
        if (durationMs <= 0) return false
        dragged = next.coerceIn(0, durationMs); holdUntil = SystemClock.uptimeMillis() + 150; seek(dragged)
        invalidate(); removeCallbacks(releaseHold); postDelayed(releaseHold, 150); return true
    }
    override fun onDetachedFromWindow() { removeCallbacks(releaseHold); thumb.cancel(); super.onDetachedFromWindow() }
}
