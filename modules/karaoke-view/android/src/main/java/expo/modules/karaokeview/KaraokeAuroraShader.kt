package expo.modules.karaokeview

import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build

/**
 * AGSL ambient field for the player's artwork spectrum. One shader paints a small
 * family of visual materials so the themes feel related instead of like separate demos:
 *
 * - HALO: album-as-lens, a circular luminous field breathing from the cover.
 * - SILK: slow illuminated fabric, broad folds without rigid lines.
 * - LIQUID: softened refracted lens caustics.
 *
 * Output is premultiplied for PorterDuff.ADD. On API < 33 [get] returns null.
 */
internal object KaraokeAuroraShader {

    const val STYLE_HALO = 0
    const val STYLE_SILK = 1
    const val STYLE_LIQUID = 2
    const val STYLE_AURORA = STYLE_HALO
    const val STYLE_CAUSTICS = STYLE_LIQUID

    private const val FIELD_AGSL = """
        uniform float2 res;
        uniform float time;
        uniform float mid;
        uniform float treble;
        uniform float master;
        uniform float topFrac;
        uniform float focusY;
        uniform float style;
        uniform float4 tint;
        uniform float4 hot;

        float hash(float2 p) {
            p = fract(p * float2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        float vnoise(float2 p) {
            float2 i = floor(p);
            float2 f = fract(p);
            float2 u = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + float2(1.0, 0.0));
            float c = hash(i + float2(0.0, 1.0));
            float d = hash(i + float2(1.0, 1.0));
            return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(float2 p) {
            float s = 0.0;
            float amp = 0.5;
            for (int k = 0; k < 3; k++) {
                s += amp * vnoise(p);
                p *= 2.0;
                amp *= 0.5;
            }
            return s;
        }

        float radialMask(float2 uv, float focus) {
            float aspect = res.x / max(res.y, 1.0);
            float2 q = float2((uv.x - 0.5) * aspect, uv.y - focus);
            float d = length(q);
            float outer = 1.0 - smoothstep(0.08, 0.58, d);
            float innerAir = smoothstep(0.035, 0.18, d);
            return outer * innerAir;
        }

        float haloField(float2 uv, float2 p, float t, float midE, float treE, out float hotMix) {
            float mask = radialMask(uv, focusY);
            float aspect = res.x / max(res.y, 1.0);
            float2 q = float2((uv.x - 0.5) * aspect, uv.y - focusY);
            float d = length(q);
            float angle = atan(q.y, q.x);
            float flow = t * (0.42 + 0.34 * midE);

            float ringA = 0.5 + 0.5 * sin(d * 19.0 - flow * 1.9);
            float ringB = 0.5 + 0.5 * sin(d * 31.0 - flow * 2.7 + 1.7);
            float sweep = 0.5 + 0.5 * sin(angle * 2.0 + flow * 0.58);
            float breathing = 0.82 + 0.18 * sin(flow * 0.72);

            float core = pow(mask, 1.08) * (0.48 + 0.52 * midE);
            float contour = pow(mask, 1.55) * (0.22 * ringA + 0.13 * ringB + 0.18 * sweep);
            float rim = smoothstep(0.42, 0.03, abs(d - (0.22 + 0.045 * midE))) * 0.18;
            float glint = pow(mask, 2.4) * treE * (0.12 + 0.18 * sweep);

            hotMix = clamp(core * 0.42 + contour * 0.75 + glint * 1.4, 0.0, 1.0);
            return (core + contour + rim + glint) * breathing;
        }

        float silkField(float2 uv, float2 p, float t, float midE, float treE, out float hotMix) {
            float flow = t * (0.035 + 0.045 * midE);
            float2 q = float2(
                fbm(p + float2(0.0, flow)),
                fbm(p + float2(5.2, flow * 1.3))
            );
            float folds = fbm(p * float2(1.15, 0.78) + q * 1.9 + float2(0.0, flow * 0.5));
            float canopy = 1.0 - smoothstep(0.04, topFrac, uv.y);
            float albumLift = radialMask(uv, focusY) * 0.7;
            float mask = clamp(canopy * 0.85 + albumLift, 0.0, 1.0);
            float silk = pow(clamp(folds, 0.0, 1.0), 2.05) * mask * (0.36 + 0.95 * midE);
            float thread = smoothstep(0.74, 1.0, fbm(p * float2(5.0, 1.6) + flow)) * treE * mask;
            hotMix = clamp(folds * 0.56 + thread * 0.7, 0.0, 1.0);
            return silk + thread * 0.22;
        }

        float liquidField(float2 uv, float2 p, float t, float midE, float treE, out float hotMix) {
            float2 i = p;
            float c = 0.0;
            float inten = 0.0065;
            float tt0 = t * (0.34 + 0.32 * midE);
            for (int n = 0; n < 4; n++) {
                float tt = tt0 * (1.0 - (3.5 / float(n + 1)));
                i = p + float2(cos(tt - i.x) + sin(tt + i.y),
                               sin(tt - i.y) + cos(tt + i.x));
                c += 1.0 / length(float2(p.x / (sin(i.x + tt) / inten),
                                         p.y / (cos(i.y + tt) / inten)));
            }
            c /= 4.0;
            c = 1.10 - pow(c, 1.28);
            float web = pow(abs(c), 4.8);
            web = clamp(web, 0.0, 1.0);
            float lens = radialMask(uv, focusY);
            float bottomFalloff = 1.0 - smoothstep(0.74, 1.0, uv.y);
            float mask = clamp(lens * 1.15 + bottomFalloff * 0.45, 0.0, 1.0);
            float softWeb = smoothstep(0.16, 0.92, web) * mask * (0.28 + 0.9 * midE);
            float glint = smoothstep(0.82, 1.0, web) * treE * mask * 0.34;
            hotMix = clamp(web * 0.72 + glint, 0.0, 1.0);
            return softWeb + glint;
        }

        half4 main(float2 frag) {
            float2 uv = frag / res;
            float2 p = float2(uv.x * (res.x / res.y), uv.y) * 2.0;

            float hotMix = 0.0;
            float field = 0.0;
            if (style < 0.5) {
                field = haloField(uv, p, time, mid, treble, hotMix);
            } else if (style < 1.5) {
                field = silkField(uv, p, time, mid, treble, hotMix);
            } else {
                field = liquidField(uv, p * 1.45, time, mid, treble, hotMix);
            }

            float edgeFade = smoothstep(0.0, 0.05, uv.x)
                           * (1.0 - smoothstep(0.95, 1.0, uv.x))
                           * smoothstep(0.0, 0.05, uv.y)
                           * (1.0 - smoothstep(0.92, 1.0, uv.y));
            float a = clamp(field * edgeFade * master * 0.82, 0.0, 1.0);
            float3 col = mix(tint.rgb, hot.rgb, clamp(hotMix, 0.0, 1.0));

            return half4(col * a, a);
        }
    """

    private var shader: RuntimeShader? = null
    private var initialized = false

    private fun ensureInitialized() {
        if (initialized) return
        initialized = true
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                shader = RuntimeShader(FIELD_AGSL)
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

    fun get(
        width: Float,
        height: Float,
        timeSec: Float,
        mid: Float,
        treble: Float,
        master: Float,
        topFrac: Float,
        focusY: Float,
        style: Int,
        tintR: Float, tintG: Float, tintB: Float,
        hotR: Float, hotG: Float, hotB: Float,
    ): Shader? {
        ensureInitialized()
        val s = shader ?: return null
        if (Build.VERSION.SDK_INT >= 33) {
            s.setFloatUniform("res", width, height)
            s.setFloatUniform("time", timeSec)
            s.setFloatUniform("mid", mid)
            s.setFloatUniform("treble", treble)
            s.setFloatUniform("master", master)
            s.setFloatUniform("topFrac", topFrac)
            s.setFloatUniform("focusY", focusY)
            s.setFloatUniform("style", style.toFloat())
            s.setFloatUniform("tint", tintR, tintG, tintB, 1f)
            s.setFloatUniform("hot", hotR, hotG, hotB, 1f)
        }
        return s
    }
}
