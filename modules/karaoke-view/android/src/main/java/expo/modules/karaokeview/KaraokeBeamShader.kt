package expo.modules.karaokeview

import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build

/**
 * AGSL (Android Graphics Shading Language) shader for the player's stage-light
 * columns — the same GPU technique as the karaoke liquid wipe ([KaraokeWipeShader]).
 *
 * Instead of stacking flat trapezoids, ONE fragment shader paints each STRAIGHT
 * column as LIQUID light (no bending — the wobble looked wrong; "liquid" here is the
 * softness and the melting tones, not a curved beam):
 *  · smoothstep cross-section → perfectly soft lateral edges, zero banding.
 *  · a length brightness curve (dim at the fixture → glowing body → fading tip).
 *  · a gentle brightness ripple flowing down the length so it never sits dead.
 *  · a FLOWING TONE blend between the tint and a near-white hot core, so the
 *    different tones melt into each other instead of sitting in hard stops.
 *
 * Output is premultiplied so it composites cleanly with PorterDuff.ADD (additive
 * light). On API < 33 [get] returns null and the renderer falls back to the
 * LinearGradient trapezoid stack.
 */
internal object KaraokeBeamShader {

    private const val BEAM_AGSL = """
        uniform float beamLen;     // local length (apex at y=0 → tip at y=beamLen)
        uniform float apexHalf;    // half-width at the fixture
        uniform float baseHalf;    // half-width at the tip (the glow spread)
        uniform float level;       // this column's audio energy, 0..1
        uniform float master;      // global alpha * flicker
        uniform float time;        // seconds
        uniform float seed;        // per-column phase offset
        uniform float4 tint;       // rgb 0..1 (a unused)
        uniform float4 hot;        // near-white rgb 0..1

        float smooth(float e0, float e1, float x) {
            float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
            return t * t * (3.0 - 2.0 * t);
        }

        half4 main(float2 c) {
            float f = clamp(c.y / beamLen, 0.0, 1.0);          // 0 apex .. 1 tip
            float hw = mix(apexHalf, baseHalf, f);

            // Straight column — NO lateral wobble. The "liquid" feel comes purely from the
            // smoothstep edges and the melting tones, not from bending the beam.
            float d = abs(c.x) / max(hw, 0.0001);
            float cross = 1.0 - smooth(0.0, 1.0, d);
            cross = cross * cross;

            // Length brightness: dim at the source, glowing body, fading tip.
            float lengthB = smooth(0.0, 0.22, f) * (1.0 - smooth(0.45, 1.0, f));

            // Flowing shimmer rippling down the length so it never sits still.
            float ripple = 0.85 + 0.15 * sin(c.y * 0.030 - time * 2.3 + seed * 2.0);

            float a = cross * lengthB * ripple * level * master;

            // Flowing tone blend: hotter at the centre & near the source, the tint
            // washing outward, modulated by a slow wave so the tones melt like liquid.
            float toneFlow = 0.5 + 0.5 * sin(c.y * 0.012 + time * 0.9 + seed);
            float hotMix = clamp(cross * (0.6 + 0.4 * toneFlow) * (1.0 - f * 0.5), 0.0, 1.0);
            float3 col = mix(tint.rgb, hot.rgb, hotMix);

            return half4(col * a, a);   // premultiplied → additive-friendly
        }
    """

    private var shader: RuntimeShader? = null
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        initialized = true
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                shader = RuntimeShader(BEAM_AGSL)
            } catch (_: Exception) {
                shader = null
            }
        }
    }

    val isAvailable: Boolean
        get() {
            ensureInitialized()
            return shader != null
        }

    /**
     * Updates the uniforms for one column and returns the shared RuntimeShader,
     * or null if AGSL is unavailable (caller falls back to LinearGradient).
     */
    fun get(
        beamLen: Float,
        apexHalf: Float,
        baseHalf: Float,
        level: Float,
        master: Float,
        timeSec: Float,
        seed: Float,
        tintR: Float, tintG: Float, tintB: Float,
        hotR: Float, hotG: Float, hotB: Float,
    ): Shader? {
        ensureInitialized()
        val s = shader ?: return null
        if (Build.VERSION.SDK_INT >= 33) {
            s.setFloatUniform("beamLen", beamLen)
            s.setFloatUniform("apexHalf", apexHalf)
            s.setFloatUniform("baseHalf", baseHalf)
            s.setFloatUniform("level", level)
            s.setFloatUniform("master", master)
            s.setFloatUniform("time", timeSec)
            s.setFloatUniform("seed", seed)
            s.setFloatUniform("tint", tintR, tintG, tintB, 1f)
            s.setFloatUniform("hot", hotR, hotG, hotB, 1f)
        }
        return s
    }
}
