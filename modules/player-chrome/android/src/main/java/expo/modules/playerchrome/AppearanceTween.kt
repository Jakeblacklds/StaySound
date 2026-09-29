package expo.modules.playerchrome

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.animation.PathInterpolator
import androidx.core.graphics.ColorUtils

/**
 * Eases a theme map from one album palette to the next instead of snapping every surface at once.
 * Hex colours are blended; every other entry (dark, motion, rgba strings…) switches immediately.
 * Hidden views, lightweight mode and disabled animator scale apply the target directly.
 * [frameMs] throttles screens whose repaint rebinds whole lists.
 */
class AppearanceTween(
    private val view: View,
    private val duration: Long = 600L,
    private val frameMs: Long = 0L,
    private val apply: (Map<String, String>) -> Unit,
) {
    private var rendered: Map<String, String>? = null
    private var target: Map<String, String> = emptyMap()
    private var from: Map<String, Int> = emptyMap()
    private var animator: ValueAnimator? = null
    private var lastFrame = 0L

    fun set(value: Map<String, String>) {
        if (value == target && (animator != null || rendered == value)) return
        val previous = rendered
        target = value
        stop()
        val enabled = Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()
        if (previous == null || !enabled || value["motion"] == "off" || !view.isShown || !colorsDiffer(previous, value)) {
            publish(value); return
        }
        from = previous.mapNotNull { (key, raw) -> parse(raw)?.let { key to it } }.toMap()
        lastFrame = 0L
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = this@AppearanceTween.duration
            interpolator = EASE
            addUpdateListener { frame(it.animatedValue as Float) }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (animator !== animation) return
                    animator = null; publish(target)
                }
            })
            start()
        }
    }
    /** Jumps to the latest palette, e.g. when the view detaches mid-transition. */
    fun finish() { if (animator != null) { stop(); publish(target) } }

    private fun stop() { animator?.let { animator = null; it.removeAllUpdateListeners(); it.cancel() } }
    private fun frame(progress: Float) {
        val now = SystemClock.uptimeMillis()
        if (frameMs > 0 && now - lastFrame < frameMs) return
        lastFrame = now
        publish(target.mapValues { (key, raw) ->
            val start = from[key]; val end = parse(raw)
            if (start == null || end == null || start == end) raw else hex(ColorUtils.blendARGB(start, end, progress))
        })
    }
    private fun publish(value: Map<String, String>) { rendered = value; apply(value) }
    private fun colorsDiffer(a: Map<String, String>, b: Map<String, String>) =
        b.any { (key, raw) -> val end = parse(raw); end != null && parse(a[key]).let { it != null && it != end } }

    companion object {
        private val EASE = PathInterpolator(0.2f, 0f, 0f, 1f)
        private fun parse(raw: String?): Int? =
            if (raw == null || !raw.startsWith('#')) null else runCatching { Color.parseColor(raw) }.getOrNull()
        private fun hex(color: Int) = String.format("#%08X", color)
    }
}
