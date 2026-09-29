package expo.modules.playerchrome

import android.animation.ValueAnimator
import android.os.Build
import android.view.animation.DecelerateInterpolator
import android.animation.TimeInterpolator
import androidx.dynamicanimation.animation.FloatValueHolder
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import kotlin.math.sqrt

/** Matches the existing Reanimated timing and physical spring parameters. */
internal class ChromeMotion(initial: Float, private val update: (Float) -> Unit) {
    private fun animationsEnabled() = Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()
    var value = initial
        private set
    private var timing: ValueAnimator? = null
    private var spring: SpringAnimation? = null

    fun snap(target: Float) { cancel(); publish(target) }
    fun cancel() {
        timing?.removeAllListeners()
        timing?.cancel()
        timing = null
        spring?.cancel()
        spring = null
    }
    private fun publish(next: Float) { value = next; update(next) }
    fun curve(target: Float, duration: Long, easing: TimeInterpolator, then: (() -> Unit)? = null) {
        cancel()
        if (!animationsEnabled()) { publish(target); then?.invoke(); return }
        timing = ValueAnimator.ofFloat(value, target).apply {
            this.duration = duration; interpolator = easing
            addUpdateListener { publish(it.animatedValue as Float) }
            if (then != null) addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) { then() }
            })
            start()
        }
    }
    fun timing(target: Float, duration: Long, cubic: Boolean = false, then: (() -> Unit)? = null) {
        cancel()
        if (!animationsEnabled()) { publish(target); then?.invoke(); return }
        timing = ValueAnimator.ofFloat(value, target).apply {
            this.duration = duration
            interpolator = DecelerateInterpolator(if (cubic) 1.5f else 1f)
            addUpdateListener { publish(it.animatedValue as Float) }
            if (then != null) addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) { then() }
            })
            start()
        }
    }
    fun spring(target: Float, damping: Float, stiffness: Float, mass: Float) {
        // Retarget an in-flight spring without discarding its velocity.
        if (animationsEnabled() && spring?.isRunning == true) {
            spring?.animateToFinalPosition(target)
            return
        }
        cancel()
        if (!animationsEnabled()) { publish(target); return }
        spring = SpringAnimation(FloatValueHolder(value)).apply {
            this.spring = SpringForce(target).apply {
                this.stiffness = stiffness / mass
                dampingRatio = damping / (2f * sqrt(stiffness * mass))
            }
            minimumVisibleChange = 0.001f
            addUpdateListener { _, next, _ -> publish(next) }
            start()
        }
    }
}

/** Expansion coordinates remain shared with FullPlayer, on the UI thread. */
internal object ChromeProgress {
    fun ramp(p: Float, start: Float, end: Float) = ((p - start) / (end - start)).coerceIn(0f, 1f)
    fun contentAlpha(p: Float) = 1f - ramp(p, 0.22f, 0.38f)
    fun controlsAlpha(p: Float) = 1f - ramp(p, 0.18f, 0.34f)
}
