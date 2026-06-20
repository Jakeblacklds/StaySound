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

/**
 * "Luminous tint" — the harmonious replacement for blending toward white.
 *
 * Instead of washing a color toward #FFFFFF (which desaturates and kills the
 * album hue, making every "hot core" read white), this lifts the color in HSL:
 * it pushes LIGHTNESS toward 1.0 and nudges SATURATION up, so the ignite/peak
 * highlight glows BRIGHT while staying in the same chromatic family as the
 * extracted album color. Alpha is preserved.
 *
 *   lift     — how far lightness travels toward white (0 = none, 1 = white).
 *   satBoost — absolute saturation added before the lightness lift.
 */
internal fun luminousTint(color: Int, lift: Float = 0.5f, satBoost: Float = 0.1f): Int {
    val hsl = FloatArray(3)
    rgbToHsl(Color.red(color), Color.green(color), Color.blue(color), hsl)
    // Boost saturation first so the lift carries visible hue, not gray.
    hsl[1] = (hsl[1] + satBoost).coerceIn(0f, 1f)
    // Ease lightness toward white; near-white inputs barely move (already bright).
    hsl[2] = (hsl[2] + (1f - hsl[2]) * lift.coerceIn(0f, 1f)).coerceIn(0f, 1f)
    return hslToRgb(hsl[0], hsl[1], hsl[2], Color.alpha(color))
}

private fun rgbToHsl(r: Int, g: Int, b: Int, out: FloatArray) {
    val rf = r / 255f
    val gf = g / 255f
    val bf = b / 255f
    val max = maxOf(rf, gf, bf)
    val min = minOf(rf, gf, bf)
    val l = (max + min) / 2f
    val d = max - min
    var h = 0f
    var s = 0f
    if (d > 1e-5f) {
        s = if (l > 0.5f) d / (2f - max - min) else d / (max + min)
        h = when (max) {
            rf -> (gf - bf) / d + (if (gf < bf) 6f else 0f)
            gf -> (bf - rf) / d + 2f
            else -> (rf - gf) / d + 4f
        } / 6f
    }
    out[0] = h
    out[1] = s
    out[2] = l
}

private fun hslToRgb(h: Float, s: Float, l: Float, alpha: Int): Int {
    if (s <= 1e-5f) {
        val v = (l * 255f).toInt().coerceIn(0, 255)
        return Color.argb(alpha, v, v, v)
    }
    val q = if (l < 0.5f) l * (1f + s) else l + s - l * s
    val p = 2f * l - q
    fun hue(t0: Float): Float {
        var t = t0
        if (t < 0f) t += 1f
        if (t > 1f) t -= 1f
        return when {
            t < 1f / 6f -> p + (q - p) * 6f * t
            t < 1f / 2f -> q
            t < 2f / 3f -> p + (q - p) * (2f / 3f - t) * 6f
            else -> p
        }
    }
    val r = (hue(h + 1f / 3f) * 255f).toInt().coerceIn(0, 255)
    val g = (hue(h) * 255f).toInt().coerceIn(0, 255)
    val b = (hue(h - 1f / 3f) * 255f).toInt().coerceIn(0, 255)
    return Color.argb(alpha, r, g, b)
}

private fun linearizedChannel(channel: Int): Float {
    val normalized = channel.coerceIn(0, 255) / 255f
    return if (normalized <= 0.04045f) {
        normalized / 12.92f
    } else {
        Math.pow(((normalized + 0.055f) / 1.055f).toDouble(), 2.4).toFloat()
    }
}

internal fun relativeLuminance(color: Int): Float {
    val r = linearizedChannel(Color.red(color))
    val g = linearizedChannel(Color.green(color))
    val b = linearizedChannel(Color.blue(color))
    return (0.2126f * r) + (0.7152f * g) + (0.0722f * b)
}

internal fun contrastRatio(foreground: Int, background: Int): Float {
    val lumA = relativeLuminance(foreground) + 0.05f
    val lumB = relativeLuminance(background) + 0.05f
    val lighter = maxOf(lumA, lumB)
    val darker = minOf(lumA, lumB)
    return lighter / darker
}

internal fun ensureContrast(color: Int, background: Int, minRatio: Float): Int {
    if (contrastRatio(color, background) >= minRatio) return color

    val bgIsDark = relativeLuminance(background) < 0.35f
    val target = if (bgIsDark) Color.WHITE else Color.BLACK

    var lower = 0f
    var upper = 1f
    var best = color
    repeat(9) {
        val blend = (lower + upper) / 2f
        val candidate = blendColors(color, target, blend)
        val ratio = contrastRatio(candidate, background)
        if (ratio >= minRatio) {
            best = candidate
            upper = blend
        } else {
            lower = blend
        }
    }

    return best
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
