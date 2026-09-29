package expo.modules.playerchrome

import android.view.animation.PathInterpolator

/** Mirrors playerLayout / FullPlayer. All coordinates are dp; the host uses the same progress. */
internal object FullPlayerMotion {
    val emphasized by lazy { PathInterpolator(0.2f, 0f, 0f, 1f) }
    val decelerated by lazy { PathInterpolator(0.05f, 0.7f, 0.1f, 1f) }
    val accelerated by lazy { PathInterpolator(0.3f, 0f, 0.8f, 0.15f) }
    val cubicInOut by lazy { PathInterpolator(0.65f, 0f, 0.35f, 1f) }
    fun mix(a: Float, b: Float, p: Float) = a + (b - a) * p
    fun range(p: Float, a: Float, b: Float) = ((p - a) / (b - a)).coerceIn(0f, 1f)
    fun artworkProgress(p: Float): Float = when {
        p < 0.22f -> mix(0f, 0.18f, range(p, 0f, 0.22f))
        p < 0.72f -> mix(0.18f, 0.82f, range(p, 0.22f, 0.72f))
        else -> mix(0.82f, 1f, range(p, 0.72f, 1f))
    }
    fun artworkSize(w: Float, h: Float, top: Float, bottom: Float) =
        maxOf(218f, minOf(w * 0.8f, h - maxOf(top + 10f, 30f) - 58f - 414f - maxOf(bottom + 8f, 26f)))
    fun dismiss(distance: Float, velocity: Float) = distance > 180f || velocity > 1200f
    fun expand(distance: Float, velocity: Float) = distance < -120f || velocity < -800f
}
