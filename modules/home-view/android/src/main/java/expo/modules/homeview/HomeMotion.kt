package expo.modules.homeview

import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout

/** Native pressed state also covers keyboard input and RecyclerView gesture cancellation. */
internal class HomePressMotion(private val view: View, private val style: HomeStyle) {
    private var pressed = false
    fun update() {
        val next = view.isPressed && view.isEnabled && style.motionEnabled
        if (next == pressed) return
        pressed = next
        view.animate().cancel()
        val scale = if (next) .975f else 1f
        if (!style.motionEnabled) {
            view.scaleX = scale; view.scaleY = scale
        } else {
            view.animate().scaleX(scale).scaleY(scale)
                .setDuration(if (next) 110L else 260L)
                .setInterpolator(if (next) PRESS else SETTLE).start()
        }
    }
    fun reset() {
        pressed = false
        view.animate().cancel()
        view.scaleX = 1f; view.scaleY = 1f
    }
    companion object {
        val PRESS = PathInterpolator(.2f, 0f, 0f, 1f)
        val SETTLE = PathInterpolator(.16f, 1f, .3f, 1f)
    }
}

internal class HomePressFrame(style: HomeStyle) : FrameLayout(style.context) {
    private val motion = HomePressMotion(this, style)
    override fun drawableStateChanged() { super.drawableStateChanged(); motion?.update() }
    override fun onDetachedFromWindow() { motion.reset(); super.onDetachedFromWindow() }
}

internal class HomePressLayout(style: HomeStyle) : LinearLayout(style.context) {
    private val motion = HomePressMotion(this, style)
    override fun drawableStateChanged() { super.drawableStateChanged(); motion?.update() }
    override fun onDetachedFromWindow() { motion.reset(); super.onDetachedFromWindow() }
}
