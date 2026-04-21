package expo.modules.karaokeview

import android.graphics.Color

internal fun blendColors(from: Int, to: Int, amount: Float): Int {
    val t = amount.coerceIn(0f, 1f)
    val inv = 1f - t
    return Color.argb(
        ((Color.alpha(from) * inv) + (Color.alpha(to) * t)).toInt().coerceIn(0, 255),
        ((Color.red(from) * inv) + (Color.red(to) * t)).toInt().coerceIn(0, 255),
        ((Color.green(from) * inv) + (Color.green(to) * t)).toInt().coerceIn(0, 255),
        ((Color.blue(from) * inv) + (Color.blue(to) * t)).toInt().coerceIn(0, 255),
    )
}

internal fun getProfileGlowColor(profile: MotionProfile, glowColor: Int): Int {
    val tint = when (profile) {
        MotionProfile.AMBIENT -> Color.rgb(100, 220, 255)
        MotionProfile.PULSE -> Color.rgb(80, 255, 200)
        MotionProfile.FIRE -> Color.rgb(255, 170, 70)
        MotionProfile.VELVET -> Color.rgb(220, 190, 255)
        MotionProfile.COSMIC -> glowColor
    }
    return blendColors(glowColor, tint, 0.36f)
}

internal fun getProfileGlowStops(profile: MotionProfile): FloatArray {
    return when (profile) {
        MotionProfile.AMBIENT -> floatArrayOf(0f, 0.12f, 0.88f, 1f)
        MotionProfile.PULSE -> floatArrayOf(0f, 0.38f, 0.62f, 1f)
        MotionProfile.FIRE -> floatArrayOf(0f, 0.2f, 0.7f, 1f)
        MotionProfile.VELVET -> floatArrayOf(0f, 0.14f, 0.86f, 1f)
        MotionProfile.COSMIC -> floatArrayOf(0f, 0.24f, 0.76f, 1f)
    }
}
