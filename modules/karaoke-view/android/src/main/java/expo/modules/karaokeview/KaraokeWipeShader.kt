package expo.modules.karaokeview

import android.graphics.Color
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build

/**
 * AGSL (Android Graphics Shading Language) wipe shaders for API 33+.
 *
 * These produce mathematically smooth opacity curves with zero banding,
 * compared to LinearGradient's discrete color stops. On API < 33 the
 * factory methods return null and callers fall back to LinearGradient.
 *
 * Two shader variants:
 * 1. wipeColorShader — replaces the paint's shader for regular word wipe
 *    (outputs the highlight color with smoothstep alpha).
 * 2. wipeMaskShader — used as DST_IN mask for growable word wipe
 *    (outputs black with smoothstep alpha).
 */
internal object KaraokeWipeShader {

    // ── AGSL source for the color wipe (regular words) ──────────────────
    // Uniforms: sweepX, fadeLeft (start of fade zone), fadeRight (end),
    //           highlightColor (straight RGBA; premultiplied in the shader).
    private const val WIPE_COLOR_AGSL = """
        uniform float sweepX;
        uniform float fadeLeft;
        uniform float fadeRight;
        uniform float4 highlightColor;
        uniform float invert;

        float smoother(float edge0, float edge1, float x) {
            float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
            return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
        }

        float liquidAlpha(float2 coord) {
            float width = max(fadeRight - fadeLeft, 1.0);
            float center = (fadeLeft + fadeRight) * 0.5;
            float y = coord.y / width;
            float phase = sweepX / width;
            float warp = (
                sin(y * 1.45 + phase * 0.72) * 0.13
                + sin(y * 3.35 - phase * 0.41 + 1.7) * 0.045
            ) * width;
            float widthBreath = width * (
                0.92 + 0.08 * sin(y * 2.15 + phase * 0.31 + 0.8)
            );
            return 1.0 - smoother(
                center + warp - widthBreath * 0.5,
                center + warp + widthBreath * 0.5,
                coord.x
            );
        }

        half4 main(float2 coord) {
            float alpha = liquidAlpha(coord);
            alpha = mix(alpha, 1.0 - alpha, invert);
            float finalAlpha = highlightColor.a * alpha;
            return half4(highlightColor.rgb * finalAlpha, finalAlpha);
        }
    """

    // ── AGSL source for the mask wipe (growable words, DST_IN) ──────────
    private const val WIPE_MASK_AGSL = """
        uniform float fadeLeft;
        uniform float fadeRight;
        uniform float sweepX;

        float smoother(float edge0, float edge1, float x) {
            float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
            return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
        }

        float liquidAlpha(float2 coord) {
            float width = max(fadeRight - fadeLeft, 1.0);
            float center = (fadeLeft + fadeRight) * 0.5;
            float y = coord.y / width;
            float phase = sweepX / width;
            float warp = (
                sin(y * 1.45 + phase * 0.72) * 0.13
                + sin(y * 3.35 - phase * 0.41 + 1.7) * 0.045
            ) * width;
            float widthBreath = width * (
                0.92 + 0.08 * sin(y * 2.15 + phase * 0.31 + 0.8)
            );
            return 1.0 - smoother(
                center + warp - widthBreath * 0.5,
                center + warp + widthBreath * 0.5,
                coord.x
            );
        }

        half4 main(float2 coord) {
            float alpha = liquidAlpha(coord);
            return half4(0.0, 0.0, 0.0, alpha);
        }
    """

    // ── AGSL source for the pre-highlight glow ──────────────────────────
    private const val PRE_GLOW_AGSL = """
        uniform float bandCenter;
        uniform float bandHalf;

        float smooth(float edge0, float edge1, float x) {
            float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
            return t * t * (3.0 - 2.0 * t);
        }

        half4 main(float2 coord) {
            float dist = abs(coord.x - bandCenter) / bandHalf;
            // Double smoothstep for an even softer bell curve
            float t = 1.0 - smooth(0.0, 1.0, dist);
            float alpha = t * t;
            return half4(0.0, 0.0, 0.0, alpha);
        }
    """

    // Cached RuntimeShader instances (created once, uniforms updated per frame)
    private var wipeColorShader: RuntimeShader? = null
    private var wipeMaskShader: RuntimeShader? = null
    private var preGlowShader: RuntimeShader? = null
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        initialized = true
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                wipeColorShader = RuntimeShader(WIPE_COLOR_AGSL)
                wipeMaskShader = RuntimeShader(WIPE_MASK_AGSL)
                preGlowShader = RuntimeShader(PRE_GLOW_AGSL)
            } catch (_: Exception) {
                // Some devices may fail to compile AGSL; fall back gracefully
                wipeColorShader = null
                wipeMaskShader = null
                preGlowShader = null
            }
        }
    }

    val isAvailable: Boolean
        get() {
            ensureInitialized()
            return wipeColorShader != null
        }

    /**
     * Returns a shader for the regular word wipe highlight, or null if AGSL
     * is unavailable. The caller should fall back to LinearGradient.
     */
    fun getWipeColorShader(
        sweepX: Float,
        fadeWidth: Float,
        color: Int,
        alpha: Int,
    ): Shader? = configureWipeColorShader(
        sweepX = sweepX,
        fadeWidth = fadeWidth,
        color = color,
        alpha = alpha,
        inverted = false,
    )

    /** Complementary liquid tail used by the dim text beneath the highlight. */
    fun getWipeTailColorShader(
        sweepX: Float,
        fadeWidth: Float,
        color: Int,
        alpha: Int,
    ): Shader? = configureWipeColorShader(
        sweepX = sweepX,
        fadeWidth = fadeWidth,
        color = color,
        alpha = alpha,
        inverted = true,
    )

    private fun configureWipeColorShader(
        sweepX: Float,
        fadeWidth: Float,
        color: Int,
        alpha: Int,
        inverted: Boolean,
    ): Shader? {
        ensureInitialized()
        val shader = wipeColorShader ?: return null
        val fadeLeft = sweepX - fadeWidth * 0.5f
        val fadeRight = sweepX + fadeWidth * 0.5f
        if (Build.VERSION.SDK_INT >= 33) {
            shader.setFloatUniform("sweepX", sweepX)
            shader.setFloatUniform("fadeLeft", fadeLeft)
            shader.setFloatUniform("fadeRight", fadeRight)
            val r = Color.red(color) / 255f
            val g = Color.green(color) / 255f
            val b = Color.blue(color) / 255f
            val a = alpha / 255f
            shader.setFloatUniform("highlightColor", r, g, b, a)
            shader.setFloatUniform("invert", if (inverted) 1f else 0f)
        }
        return shader
    }

    /**
     * Returns a DST_IN mask shader for the growable word wipe, or null.
     */
    fun getWipeMaskShader(
        sweepX: Float,
        fadeWidth: Float,
    ): Shader? {
        ensureInitialized()
        val shader = wipeMaskShader ?: return null
        val fadeLeft = sweepX - fadeWidth * 0.5f
        val fadeRight = sweepX + fadeWidth * 0.5f
        if (Build.VERSION.SDK_INT >= 33) {
            shader.setFloatUniform("sweepX", sweepX)
            shader.setFloatUniform("fadeLeft", fadeLeft)
            shader.setFloatUniform("fadeRight", fadeRight)
        }
        return shader
    }

    /**
     * Returns the pre-highlight glow mask shader, or null.
     */
    fun getPreGlowShader(
        bandCenter: Float,
        bandHalf: Float,
    ): Shader? {
        ensureInitialized()
        val shader = preGlowShader ?: return null
        if (Build.VERSION.SDK_INT >= 33) {
            shader.setFloatUniform("bandCenter", bandCenter)
            shader.setFloatUniform("bandHalf", bandHalf)
        }
        return shader
    }
}
