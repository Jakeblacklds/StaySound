package expo.modules.karaokeview

import android.animation.ValueAnimator
import android.view.animation.LinearInterpolator

/**
 * High-frequency animator for 120fps rendering
 * Uses ValueAnimator which syncs with Choreographer for optimal timing
 */
class LyricsAnimator(private val onFrame: () -> Unit) {

    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = Long.MAX_VALUE
        interpolator = LinearInterpolator()
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener { onFrame() }
    }

    fun start() {
        if (!animator.isRunning) {
            animator.start()
        }
    }

    fun stop() {
        animator.cancel()
    }

    val isRunning: Boolean
        get() = animator.isRunning
}
