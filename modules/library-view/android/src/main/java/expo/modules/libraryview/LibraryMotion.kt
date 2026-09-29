package expo.modules.libraryview

import android.content.Context
import android.view.animation.PathInterpolator
import android.widget.LinearLayout

/** Follows native pressed/cancelled states, including scrolling and keyboard activation. */
internal class LibraryPressRow(context: Context, private val motionEnabled: () -> Boolean) : LinearLayout(context) {
    override fun setPressed(pressed: Boolean) {
        val changed = isPressed != pressed
        super.setPressed(pressed)
        if (!changed) return
        animate().cancel()
        val scale = if (pressed && motionEnabled()) .985f else 1f
        if (!motionEnabled()) { scaleX = scale; scaleY = scale }
        else animate().scaleX(scale).scaleY(scale).setDuration(if (pressed) 100L else 240L)
            .setInterpolator(SETTLE).start()
    }
    fun resetMotion() { animate().cancel(); scaleX = 1f; scaleY = 1f }
    override fun onDetachedFromWindow() { resetMotion(); super.onDetachedFromWindow() }
    companion object { val SETTLE = PathInterpolator(.16f, 1f, .3f, 1f) }
}
