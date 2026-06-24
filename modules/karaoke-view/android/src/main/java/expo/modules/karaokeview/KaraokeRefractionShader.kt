package expo.modules.karaokeview

import android.graphics.RuntimeShader
import android.os.Build

/**
 * KaraokeRefractionShader — an Apple-style "liquid glass" VEIL hugging the album cover's curved
 * edge (the "Refraction Veil" theme), driven as a [android.graphics.RenderEffect].
 *
 * It receives the view's OWN rendered content (`uniform shader content` — the cover, drawn live
 * and rotating by [KaraokeRefractionView]) and bends a CURVED BAND along an arc of the circle's
 * rim (by default 11 o'clock → 5 o'clock, clockwise over the top + right). Everything else is
 * pass-through, so the centre and the opposite side of the cover stay perfectly clean.
 *
 * The refraction is EDGE-CONCENTRATED (Apple liquid glass), not a magnifier: the bend ramps up
 * toward the rim and pulls content inward, so the cover compresses/curves at the edge under the
 * glass. A strong edge blur, a fine luminous specular rim and a soft inner shadow finish it.
 *
 * Output is premultiplied for the RenderEffect. Requires AGSL (API 33+).
 */
internal object KaraokeRefractionShader {

    private const val AGSL = """
        uniform shader content;    // the view's own rendered content (the rotating cover)
        uniform float2 center;     // cover centre, px
        uniform float radius;      // cover radius, px
        uniform float arcCenter;   // arc centre angle, radians
        uniform float arcHalf;     // arc half-sweep, radians
        uniform float arcFeather;  // arc soft edge, radians
        uniform float bandInner;   // inner radius of the veil band, px
        uniform float strength;    // refraction displacement at the rim, px
        uniform float chroma;      // chromatic dispersion, 0..1
        uniform float blurPx;      // edge blur tap radius, px
        uniform float rimWidth;    // specular rim thickness, px
        uniform float intensity;   // veil presence, 0..1
        uniform float4 hot;        // luminous rim highlight, rgb

        half4 main(float2 frag) {
            half4 baseC = content.eval(frag);
            if (radius < 1.0) { return baseC; }

            float2 rel = frag - center;
            float d = length(rel);
            if (d < bandInner || d > radius + rimWidth) { return baseC; }

            float2 dir = rel / max(d, 0.0001);     // outward
            float ang = atan(rel.y, rel.x);

            // Arc mask (curved band over the chosen clock range), feathered at both ends.
            float da = ang - arcCenter;
            da = da - 6.2831853 * floor((da + 3.1415927) / 6.2831853);
            float arc = smoothstep(arcHalf + arcFeather, arcHalf - arcFeather, abs(da));
            if (arc <= 0.001) { return baseC; }

            // u: 0 at the inner edge of the band .. 1 at the rim.
            float u = clamp((d - bandInner) / max(radius - bandInner, 1.0), 0.0, 1.0);

            // Apple liquid-glass bevel: bend ramps up toward the rim, pulling content INWARD.
            float bevel = u * u;
            float disp = -bevel * strength * arc;
            float2 off = dir * disp;

            // Chromatic dispersion, stronger toward the rim.
            float ca = chroma * u;
            float3 sharp = float3(
                content.eval(frag + off * (1.0 + ca)).r,
                content.eval(frag + off).g,
                content.eval(frag + off * (1.0 - ca)).b
            );

            // Strong edge blur (9-tap), ramped toward the rim.
            float bo = blurPx * (0.3 + 0.7 * u) * arc;
            float2 cG = frag + off;
            float3 blur = (content.eval(cG).rgb
                + content.eval(cG + float2(bo, 0.0)).rgb
                + content.eval(cG - float2(bo, 0.0)).rgb
                + content.eval(cG + float2(0.0, bo)).rgb
                + content.eval(cG - float2(0.0, bo)).rgb
                + content.eval(cG + float2(bo, bo) * 0.7).rgb
                + content.eval(cG - float2(bo, bo) * 0.7).rgb
                + content.eval(cG + float2(bo, -bo) * 0.7).rgb
                + content.eval(cG - float2(bo, -bo) * 0.7).rgb) / 9.0;
            float3 col = mix(sharp, blur, smoothstep(0.25, 1.0, u) * arc);

            // Fine luminous specular rim near the outer edge, brighter toward the top.
            float rimBand = smoothstep(radius - rimWidth, radius, d)
                          * (1.0 - smoothstep(radius, radius + rimWidth, d));
            float2 lightDir = normalize(float2(-0.3, -1.0));
            float ndl = clamp(dot(dir, lightDir) * 0.5 + 0.5, 0.0, 1.0);
            float spec = rimBand * arc * (0.35 + 0.65 * pow(ndl, 1.6));
            col = mix(col, hot.rgb, clamp(spec, 0.0, 1.0));

            // Soft inner shadow for depth at the band's inner edge.
            float innerSh = (1.0 - smoothstep(0.0, 0.25, u)) * arc * 0.12;
            col = col * (1.0 - innerSh);

            // Seamless fade-in from the clean cover (inner edge + arc ends).
            float veil = arc * smoothstep(0.0, 0.18, u) * intensity;
            float a = baseC.a;
            float3 outc = mix(baseC.rgb, col * a, veil);
            return half4(outc, a);
        }
    """

    private var shader: RuntimeShader? = null
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        initialized = true
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                shader = RuntimeShader(AGSL)
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
     * Configures the veil uniforms and returns the shared RuntimeShader (the `content` input is
     * bound by the RenderEffect), or null if AGSL is unavailable. Angles are in radians.
     */
    fun build(
        centerX: Float,
        centerY: Float,
        radius: Float,
        arcCenter: Float,
        arcHalf: Float,
        arcFeather: Float,
        bandInner: Float,
        strength: Float,
        chroma: Float,
        blurPx: Float,
        rimWidth: Float,
        intensity: Float,
        hotR: Float, hotG: Float, hotB: Float,
    ): RuntimeShader? {
        ensureInitialized()
        val s = shader ?: return null
        if (Build.VERSION.SDK_INT >= 33) {
            s.setFloatUniform("center", centerX, centerY)
            s.setFloatUniform("radius", radius)
            s.setFloatUniform("arcCenter", arcCenter)
            s.setFloatUniform("arcHalf", arcHalf)
            s.setFloatUniform("arcFeather", arcFeather)
            s.setFloatUniform("bandInner", bandInner)
            s.setFloatUniform("strength", strength)
            s.setFloatUniform("chroma", chroma)
            s.setFloatUniform("blurPx", blurPx)
            s.setFloatUniform("rimWidth", rimWidth)
            s.setFloatUniform("intensity", intensity)
            s.setFloatUniform("hot", hotR, hotG, hotB, 1f)
        }
        return s
    }
}
