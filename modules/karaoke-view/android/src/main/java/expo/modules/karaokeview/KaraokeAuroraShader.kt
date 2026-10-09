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
 * - DOT MATRIX: the Tauri OriginKit field; the beat fuses cells into blobs.
 *
 * Output is premultiplied for PorterDuff.ADD. On API < 33 [get] returns null.
 */
internal object KaraokeAuroraShader {

    const val STYLE_HALO = 0
    const val STYLE_SILK = 1
    const val STYLE_LIQUID = 2
    const val STYLE_DOT_MATRIX = 3
    const val STYLE_AURORA = STYLE_DOT_MATRIX
    const val STYLE_CAUSTICS = STYLE_LIQUID

    private const val FIELD_AGSL = """
        uniform float2 res;
        uniform float time;
        uniform float bass;
        uniform float mid;
        uniform float treble;
        uniform float2 flow;
        uniform float master;
        uniform float topFrac;
        uniform float focusY;
        uniform float style;
        uniform float4 tint;
        uniform float4 hot;
        // Dot matrix only: integrated noise phase, loudness, and (pulse, swell, pulseAge).
        uniform float phase;
        uniform float level;
        uniform float3 beat;

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

        float3 mod289(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        float4 mod289(float4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        float4 permute(float4 x) { return mod289(((x * 34.0) + 1.0) * x); }
        float4 taylorInvSqrt(float4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        float snoise(float3 v) {
            float2 C = float2(1.0 / 6.0, 1.0 / 3.0);
            float4 D = float4(0.0, 0.5, 1.0, 2.0);
            float3 i = floor(v + dot(v, C.yyy));
            float3 x0 = v - i + dot(i, C.xxx);
            float3 g = step(x0.yzx, x0.xyz);
            float3 l = 1.0 - g;
            float3 i1 = min(g.xyz, l.zxy);
            float3 i2 = max(g.xyz, l.zxy);
            float3 x1 = x0 - i1 + C.xxx;
            float3 x2 = x0 - i2 + C.yyy;
            float3 x3 = x0 - D.yyy;
            i = mod289(i);
            float4 p = permute(permute(permute(
                i.z + float4(0.0, i1.z, i2.z, 1.0))
                + i.y + float4(0.0, i1.y, i2.y, 1.0))
                + i.x + float4(0.0, i1.x, i2.x, 1.0));
            float n = 0.142857142857;
            float3 ns = n * D.wyz - D.xzx;
            float4 j = p - 49.0 * floor(p * ns.z * ns.z);
            float4 x_ = floor(j * ns.z);
            float4 y_ = floor(j - 7.0 * x_);
            float4 x = x_ * ns.x + ns.yyyy;
            float4 y = y_ * ns.x + ns.yyyy;
            float4 h = 1.0 - abs(x) - abs(y);
            float4 b0 = float4(x.xy, y.xy);
            float4 b1 = float4(x.zw, y.zw);
            float4 s0 = floor(b0) * 2.0 + 1.0;
            float4 s1 = floor(b1) * 2.0 + 1.0;
            float4 sh = -step(h, float4(0.0));
            float4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            float4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            float3 p0 = float3(a0.xy, h.x);
            float3 p1 = float3(a0.zw, h.y);
            float3 p2 = float3(a1.xy, h.z);
            float3 p3 = float3(a1.zw, h.w);
            float4 norm = taylorInvSqrt(float4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
            p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
            float4 m = max(0.6 - float4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m *= m;
            return 42.0 * dot(m * m, float4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }

        float3 hsv2rgb(float3 c) {
            float4 K = float4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            float3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
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

        // Port of the Tauri OriginKit field (src/components/originkit/ui/dotmatrix.tsx).
        // Audio never moves geometry directly: the beat tightens the surface tension so
        // neighbouring cells agree and fuse into blobs, one soft wavefront leaves the
        // cover per onset, and the brightest cores are allowed past radius 0.5 so
        // touching dots merge. Everything is continuous in time — nothing can jump.
        half4 dotMatrixColor(float2 uv, float opacity) {
            float cell = 16.363636;
            float2 pixel = uv * res;
            float2 cellIndex = floor(pixel / cell);
            float2 centerPixel = (cellIndex + 0.5) * cell;
            float2 centerUv = centerPixel / res;
            float aspect = res.x / max(res.y, 1.0);

            float pulse = clamp(beat.x, 0.0, 1.0);
            float swell = clamp(beat.y, 0.0, 1.0);
            float age = beat.z;

            // Inhale on the downbeat, about the centre of the screen.
            float2 p = (centerUv - 0.5) * float2(aspect, 1.0);
            float zoom = 1.0 - swell * 0.030 - pulse * 0.026;
            p = p * zoom + flow;

            // frequency=1 -> 0.3. At rest the fine lobe keeps the field grainy; on a
            // transient it is pulled into the coarse body so blobs coalesce, then they
            // slowly separate again on the decay.
            float coarse = snoise(float3(p * 0.3, phase));
            float fine = snoise(float3(p * 0.81 + float2(19.3, 7.1), phase * 1.31 + 5.0));
            float cohesion = clamp(pulse * 1.15 + swell * 0.30, 0.0, 1.0);
            float grain = mix(0.22, 0.06, cohesion);
            float hue = abs(coarse * (1.0 - grain) + fine * grain);

            float3 rainbow = hsv2rgb(float3(hue, 1.0, 1.0));
            float gray = dot(rainbow, float3(0.3, 0.59, 0.11));
            gray = pow(clamp(gray, 0.0001, 1.0), 1.6842105);

            // One wavefront per onset, leaving the cover and fading before the corners.
            float2 rq = (centerUv - float2(0.5, focusY)) * float2(aspect, 1.0);
            float travel = age * 0.72;
            float front = (length(rq) - travel) / 0.30;
            float ring = exp(-front * front) * pulse * (1.0 - smoothstep(0.30, 1.20, travel));

            float density = clamp(level, 0.0, 1.0) * 0.030;
            float bloom = 1.0 + swell * 0.035 + pulse * 0.030 + ring * 0.090;
            float g2 = clamp(gray + 0.5 + density, 0.0, 1.0);

            // Palette [primary @0.72 -> transparent], identical to OriginKit's upper half.
            float paletteFade = clamp((g2 - 0.5) * 2.0, 0.0, 1.0);
            float3 dotColor = mix(tint.rgb, tint.rgb * 0.025, paletteFade);
            float dotOpacity = mix(0.72, 0.0, paletteFade);
            dotOpacity = min(1.0, dotOpacity * (1.0 + ring * 0.10 + swell * 0.03));

            // Halftone falloff: dots shrink as they fade instead of stepping cell by
            // cell, so blob edges read as a gradient rather than pixelation.
            float fade = clamp(dotOpacity / 0.637, 0.0, 1.0);
            float radius = g2 * 0.5 * bloom * mix(0.3, 1.0, sqrt(fade));
            float2 local = fract(pixel / cell) - 0.5;
            float dist = length(local);
            float aa = 1.0 / cell + 0.0001;
            float mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);

            float a = mark * dotOpacity * clamp(opacity, 0.0, 1.0);
            return half4(dotColor * a, a);
        }

        half4 main(float2 frag) {
            float2 uv = frag / res;
            float2 p = float2(uv.x * (res.x / res.y), uv.y) * 2.0;

            if (style >= 2.5) {
                return dotMatrixColor(uv, master);
            }

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
        bass: Float,
        mid: Float,
        treble: Float,
        flowX: Float,
        flowY: Float,
        phase: Float,
        level: Float,
        pulse: Float,
        swell: Float,
        pulseAge: Float,
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
            s.setFloatUniform("bass", bass)
            s.setFloatUniform("mid", mid)
            s.setFloatUniform("treble", treble)
            s.setFloatUniform("flow", flowX, flowY)
            s.setFloatUniform("phase", phase)
            s.setFloatUniform("level", level)
            s.setFloatUniform("beat", pulse, swell, pulseAge)
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
