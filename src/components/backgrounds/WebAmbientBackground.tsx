/**
 * App-wide ambient background inspired by StaySound Web's body backdrop.
 *
 * The current artwork supplies the palette; two very soft radial glows sit on
 * top of a deep multi-stop gradient and drift slowly. The effect is rendered
 * as one Skia shader so it does not add several full-screen translucent React
 * Native layers or trigger React renders on every frame.
 */
import {
  Canvas,
  Fill,
  Shader,
  Skia,
  useClock,
} from "@shopify/react-native-skia";
import { LinearGradient } from "expo-linear-gradient";
import React, { memo, useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useDynamicColorsWithOptions } from "@/src/hooks/useDynamicColors";
import { usePlayerStore } from "@/src/stores";
import { usePerformanceProfile, useTheme } from "@/src/theme";

type Rgb = [number, number, number];

const AMBIENT_SKSL = `
uniform float2 resolution;
uniform float time;
uniform float motion;
uniform float3 cRoot;
uniform float3 cBg;
uniform float3 cBgAlt;
uniform float3 cPrimary;
uniform float3 cSecondary;

float3 screenBlend(float3 base, float3 tint) {
  return 1.0 - (1.0 - base) * (1.0 - tint);
}

half4 main(float2 fragcoord) {
  float2 uv = fragcoord / resolution;
  float t = time * (0.020 + motion * 0.014);

  // CSS equivalent: a 160-degree base gradient with a darker final stop.
  float diagonal = clamp(uv.x * 0.34 + uv.y * 0.94, 0.0, 1.0);
  float3 base = mix(cRoot, cBgAlt, smoothstep(0.05, 0.58, diagonal));
  base = mix(base, mix(cBg, cRoot, 0.52), smoothstep(0.46, 1.0, diagonal));

  // Web's top-left and lower-right radial glows, with a restrained drift.
  float2 p1 = float2(
    0.10 + sin(t * 0.82) * 0.035 * motion,
    0.05 + cos(t * 0.68) * 0.025 * motion
  );
  float2 p2 = float2(
    0.90 + cos(t * 0.61 + 1.7) * 0.030 * motion,
    0.80 + sin(t * 0.74 + 0.8) * 0.035 * motion
  );

  float d1 = length((uv - p1) / float2(0.72, 0.46));
  float d2 = length((uv - p2) / float2(0.58, 0.40));
  float glow1 = (1.0 - smoothstep(0.05, 0.68, d1)) * 0.16;
  float glow2 = (1.0 - smoothstep(0.04, 0.66, d2)) * 0.12;

  base = mix(base, screenBlend(base, cPrimary), glow1);
  base = mix(base, screenBlend(base, cSecondary), glow2);

  // A gentle edge falloff keeps text and cards readable over the atmosphere.
  float edge = smoothstep(0.40, 0.88, distance(uv, float2(0.50, 0.48)));
  base = mix(base, cRoot, edge * 0.10);
  return half4(base, 1.0);
}
`;

const DARK_FALLBACK: Rgb = [0.024, 0.035, 0.063];
const LIGHT_FALLBACK: Rgb = [0.965, 0.95, 0.985];

function hexToRgb(value: string | undefined, fallback: Rgb): Rgb {
  if (!value) return fallback;
  const normalized = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  const numeric = Number.parseInt(normalized, 16);
  return [
    ((numeric >> 16) & 255) / 255,
    ((numeric >> 8) & 255) / 255,
    (numeric & 255) / 255,
  ];
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

export const WebAmbientBackground = memo(function WebAmbientBackground() {
  const { theme, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const performanceProfile = usePerformanceProfile();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const artworkUri = currentTrack?.artwork || currentTrack?.artworkThumb;
  const { colors } = useDynamicColorsWithOptions(artworkUri, {
    enabled: performanceProfile.enableDynamicColors,
    applyToTheme: false,
  });

  const effect = useMemo(() => Skia.RuntimeEffect.Make(AMBIENT_SKSL), []);
  const fallback = isDark ? DARK_FALLBACK : LIGHT_FALLBACK;
  const palette = useMemo(() => {
    const root = hexToRgb(theme.colors.background, fallback);
    const primary = hexToRgb(
      colors.primary,
      hexToRgb(theme.colors.primary, root),
    );
    const secondary = hexToRgb(colors.secondary, primary);
    const extractedBackground = hexToRgb(colors.background, root);
    const background = isDark
      ? extractedBackground
      : mixRgb(root, primary, 0.07);
    const backgroundAlt = isDark
      ? mixRgb(extractedBackground, secondary, 0.16)
      : mixRgb(root, secondary, 0.055);
    return { root, primary, secondary, background, backgroundAlt };
  }, [
    colors.background,
    colors.primary,
    colors.secondary,
    fallback,
    isDark,
    theme.colors.background,
    theme.colors.primary,
  ]);

  const root = useSharedValue<Rgb>(palette.root);
  const background = useSharedValue<Rgb>(palette.background);
  const backgroundAlt = useSharedValue<Rgb>(palette.backgroundAlt);
  const primary = useSharedValue<Rgb>(palette.primary);
  const secondary = useSharedValue<Rgb>(palette.secondary);
  const motion = useSharedValue(isPlaying ? 1 : 0.42);

  useEffect(() => {
    const transition = { duration: 1400, easing: Easing.out(Easing.cubic) };
    root.set(withTiming(palette.root, transition));
    background.set(withTiming(palette.background, transition));
    backgroundAlt.set(withTiming(palette.backgroundAlt, transition));
    primary.set(withTiming(palette.primary, transition));
    secondary.set(withTiming(palette.secondary, transition));
  }, [background, backgroundAlt, palette, primary, root, secondary]);

  useEffect(() => {
    motion.set(withTiming(isPlaying ? 1 : 0.42, { duration: 900 }));
  }, [isPlaying, motion]);

  const clock = useClock();
  const uniforms = useDerivedValue(
    () => ({
      resolution: [Math.max(width, 1), Math.max(height, 1)],
      time: clock.get() / 1000,
      motion: motion.get(),
      cRoot: root.get(),
      cBg: background.get(),
      cBgAlt: backgroundAlt.get(),
      cPrimary: primary.get(),
      cSecondary: secondary.get(),
    }),
    [height, width],
  );

  if (!performanceProfile.enableAnimatedBackgrounds || !effect) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={[
            theme.colors.background,
            colors.background,
            theme.colors.background,
          ]}
          locations={[0, 0.48, 1]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: theme.colors.background },
      ]}
      pointerEvents="none"
      renderToHardwareTextureAndroid
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
});
