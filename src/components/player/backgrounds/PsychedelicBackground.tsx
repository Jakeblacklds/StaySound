/**
 * PsychedelicBackground — a smooth flowing MESH GRADIENT generated from the album
 * palette. A few soft color anchors drift on slow Lissajous paths and blend with
 * gaussian weights, so the album's colors melt into each other as big, clean, blurry
 * regions (no noise / no smoke texture) — GPU-rendered with a Skia runtime shader.
 * Cross-platform, no native rebuild required. It drifts a touch faster while playing.
 */
import {
    Canvas,
    Fill,
    Shader,
    Skia,
    useClock,
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import {
    useDerivedValue,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import { AlbumColors } from '../../../services/colorExtractor';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const SKSL = `
uniform float2 resolution;
uniform float time;
uniform float intensity;   // 0 idle .. 1 playing
uniform float3 cBg;        // background floor
uniform float3 cA;         // primary
uniform float3 cB;         // secondary
uniform float3 cC;         // accent

half4 main(float2 fragcoord) {
    // Aspect-corrected so the blobs stay round, not stretched.
    float aspect = resolution.x / resolution.y;
    float2 uv = float2((fragcoord.x / resolution.x) * aspect, fragcoord.y / resolution.y);
    float t = time * (0.05 + 0.05 * intensity);

    // Four soft color anchors drifting on slow, smooth paths.
    float2 p0 = float2((0.26 + 0.16 * sin(t * 0.70)) * aspect, 0.30 + 0.16 * cos(t * 0.90));
    float2 p1 = float2((0.76 + 0.15 * cos(t * 0.62)) * aspect, 0.28 + 0.17 * sin(t * 0.83));
    float2 p2 = float2((0.30 + 0.18 * sin(t * 0.54 + 1.5)) * aspect, 0.76 + 0.14 * cos(t * 0.71 + 2.0));
    float2 p3 = float2((0.74 + 0.16 * cos(t * 0.85 + 0.5)) * aspect, 0.74 + 0.16 * sin(t * 0.66 + 1.0));

    // Gaussian weights → big, soft, smoothly blended regions (a mesh gradient).
    float s = 0.26;
    float w0 = exp(-dot(uv - p0, uv - p0) / s);
    float w1 = exp(-dot(uv - p1, uv - p1) / s);
    float w2 = exp(-dot(uv - p2, uv - p2) / s);
    float w3 = exp(-dot(uv - p3, uv - p3) / s);
    float wb = 0.22;   // gentle background floor so gaps fall back to the album bg
    float sum = w0 + w1 + w2 + w3 + wb;

    float3 col = (cA * w0 + cC * w1 + cB * w2 + cA * w3 + cBg * wb) / sum;
    return half4(col, 1.0);
}
`;

interface PsychedelicBackgroundProps {
    colors: AlbumColors;
    isPlaying?: boolean;
}

type Rgb = [number, number, number];

function hexToRgb(value: string | undefined, fallback: Rgb): Rgb {
    if (!value) return fallback;
    const v = value.trim();
    if (v.startsWith('#')) {
        let h = v.slice(1);
        if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
        const n = parseInt(h.slice(0, 6), 16);
        if (Number.isNaN(n)) return fallback;
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const m = v.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
        if (parts.length >= 3) return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
    return fallback;
}

export const PsychedelicBackground = React.memo(function PsychedelicBackground({
    colors,
    isPlaying = false,
}: PsychedelicBackgroundProps) {
    const effect = useMemo(() => Skia.RuntimeEffect.Make(SKSL), []);

    const cBg = useMemo(() => hexToRgb(colors.background, [0.07, 0.05, 0.09]), [colors.background]);
    const cA = useMemo(() => hexToRgb(colors.primary, [0.6, 0.3, 0.8]), [colors.primary]);
    const cB = useMemo(() => hexToRgb(colors.secondary, [0.2, 0.5, 0.7]), [colors.secondary]);
    const cC = useMemo(() => hexToRgb(colors.accent, [0.9, 0.5, 0.3]), [colors.accent]);

    const clock = useClock();
    const energy = useSharedValue(isPlaying ? 1 : 0.35);
    useEffect(() => {
        energy.value = withTiming(isPlaying ? 1 : 0.35, { duration: 900 });
    }, [isPlaying, energy]);

    const uniforms = useDerivedValue(
        () => ({
            resolution: [SCREEN_W, SCREEN_H],
            time: clock.value / 1000,
            intensity: energy.value,
            cBg,
            cA,
            cB,
            cC,
        }),
        [cBg, cA, cB, cC],
    );

    if (!effect) return null;

    return (
        <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
                <Shader source={effect} uniforms={uniforms} />
            </Fill>
        </Canvas>
    );
});
