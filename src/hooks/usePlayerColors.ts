import type { AlbumColors } from '@/src/services/colorExtractor';
import { ensureColorContrast, getContrastRatio, getRelativeLuminance, mixHexColors, withAlpha } from '@/src/utils/colorContrast';
import { useMemo } from 'react';

export const LYRICS_BACKDROP_BLUR_RADIUS = 64;
export const LYRICS_BACKDROP_SCALE = 2.75;
export const LYRICS_BASE_MIX_COLOR = '#05070D';

const PLAYER_ACCENT_SPREAD_MIN = 28;
const PLAYER_ACCENT_PROTECTION_BLEND = 0.42;

const LYRICS_TEXT_MIN_RATIO = 7;
const LYRICS_ACCENT_MIN_RATIO = 4.8;
const LYRICS_HIGHLIGHT_MIN_RATIO = 5.1;
const LYRICS_GLOW_MIN_RATIO = 5.4;
const SPECTRUM_CHROMA_SATURATION_MIN = 0.18;
const SPECTRUM_CHROMA_SPREAD_MIN = 30;
const SPECTRUM_MIN_SURFACE_CONTRAST = 1.5;
// Inactive is intentionally lower contrast — it should read as dim, not active.
// Clamped just high enough to be legible but clearly subdued vs the highlight.
const LYRICS_INACTIVE_MIN_RATIO = 2.6;

type RgbColor = { r: number; g: number; b: number };
type HslColor = { h: number; s: number; l: number };

function parseHexColor(value?: string) {
  if (!value) return null;
  const hex = value.trim().replace('#', '');
  if (hex.length < 6) return null;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;

  return { r, g, b };
}

function getChannelSpread(color?: string) {
  const parsed = parseHexColor(color);
  if (!parsed) return 255;
  return Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHexByte(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: RgbColor) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const normalizedR = r / 255;
  const normalizedG = g / 255;
  const normalizedB = b / 255;
  const max = Math.max(normalizedR, normalizedG, normalizedB);
  const min = Math.min(normalizedR, normalizedG, normalizedB);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue = 0;

  if (max === normalizedR) {
    hue = (normalizedG - normalizedB) / delta + (normalizedG < normalizedB ? 6 : 0);
  } else if (max === normalizedG) {
    hue = (normalizedB - normalizedR) / delta + 2;
  } else {
    hue = (normalizedR - normalizedG) / delta + 4;
  }

  return { h: hue / 6, s: saturation, l: lightness };
}

function hueToRgb(p: number, q: number, t: number) {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToHex({ h, s, l }: HslColor) {
  if (s === 0) {
    const channel = l * 255;
    return rgbToHex({ r: channel, g: channel, b: channel });
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex({
    r: hueToRgb(p, q, h + 1 / 3) * 255,
    g: hueToRgb(p, q, h) * 255,
    b: hueToRgb(p, q, h - 1 / 3) * 255,
  });
}

function protectDynamicAccent(accentColor: string, fallbackColor: string) {
  const spread = getChannelSpread(accentColor);
  if (spread >= PLAYER_ACCENT_SPREAD_MIN) {
    return accentColor;
  }

  return mixHexColors(accentColor, fallbackColor, PLAYER_ACCENT_PROTECTION_BLEND);
}

function getSpectrumColorStats(color?: string) {
  const parsed = parseHexColor(color);
  if (!parsed) return null;

  const normalizedColor = rgbToHex(parsed);
  return {
    color: normalizedColor,
    hsl: rgbToHsl(parsed),
    luminance: getRelativeLuminance(normalizedColor) ?? 0.5,
    spread: getChannelSpread(normalizedColor),
  };
}

function isChromaticSpectrumColor(stats: NonNullable<ReturnType<typeof getSpectrumColorStats>>) {
  return stats.hsl.s >= SPECTRUM_CHROMA_SATURATION_MIN
    && stats.spread >= SPECTRUM_CHROMA_SPREAD_MIN;
}

function tuneSpectrumColor(sourceColor: string, baseSurface: string, paletteIsNeutral: boolean) {
  const stats = getSpectrumColorStats(sourceColor);
  if (!stats) return sourceColor;

  const surfaceLuminance = getRelativeLuminance(baseSurface) ?? 0.08;
  const surfaceIsDark = surfaceLuminance < 0.42;
  let saturation = paletteIsNeutral ? Math.min(stats.hsl.s, 0.16) : clamp(Math.max(stats.hsl.s, 0.44), 0.24, 0.88);
  let lightness = surfaceIsDark
    ? clamp(stats.hsl.l, 0.44, paletteIsNeutral ? 0.7 : 0.74)
    : clamp(stats.hsl.l, paletteIsNeutral ? 0.24 : 0.2, 0.46);

  let tunedColor = hslToHex({ h: stats.hsl.h, s: saturation, l: lightness });

  for (let step = 0; step < 8 && getContrastRatio(tunedColor, baseSurface) < SPECTRUM_MIN_SURFACE_CONTRAST; step += 1) {
    lightness = clamp(lightness + (surfaceIsDark ? 0.035 : -0.035), 0.16, 0.82);
    tunedColor = hslToHex({ h: stats.hsl.h, s: saturation, l: lightness });
  }

  return tunedColor;
}

function pickSpectrumGlowColor(playerColors: AlbumColors, baseSurface: string, fallbackGlowColor: string) {
  const candidates = [
    playerColors.accent,
    playerColors.primary,
    playerColors.secondary,
    playerColors.text,
  ]
    .map(getSpectrumColorStats)
    .filter((stats): stats is NonNullable<ReturnType<typeof getSpectrumColorStats>> => Boolean(stats));

  const chromaticCandidates = candidates.filter(isChromaticSpectrumColor);
  const paletteIsNeutral = chromaticCandidates.length === 0;
  const surfaceLuminance = getRelativeLuminance(baseSurface) ?? 0.08;
  const source = paletteIsNeutral
    ? candidates.sort((a, b) => {
      const aScore =
        Math.min(getContrastRatio(a.color, baseSurface), 3) / 3
        + Math.min(Math.abs(a.luminance - surfaceLuminance), 0.42);
      const bScore =
        Math.min(getContrastRatio(b.color, baseSurface), 3) / 3
        + Math.min(Math.abs(b.luminance - surfaceLuminance), 0.42);
      return bScore - aScore;
    })[0]?.color ?? fallbackGlowColor
    : chromaticCandidates.sort((a, b) => {
      const aScore =
        a.hsl.s * 2
        + a.spread / 255
        + Math.min(getContrastRatio(a.color, baseSurface), 3) / 3
        + Math.min(Math.abs(a.luminance - surfaceLuminance), 0.42);
      const bScore =
        b.hsl.s * 2
        + b.spread / 255
        + Math.min(getContrastRatio(b.color, baseSurface), 3) / 3
        + Math.min(Math.abs(b.luminance - surfaceLuminance), 0.42);
      return bScore - aScore;
    })[0]?.color ?? fallbackGlowColor;

  return tuneSpectrumColor(source, baseSurface, paletteIsNeutral);
}

export function usePlayerColors(args: {
  themeBackground: string;
  themePrimary: string;
  isDark: boolean;
  shouldUseThemePlayerColors: boolean;
  playerColors: AlbumColors;
  accentColor: string;
  textColor: string;
}) {
  const {
    themeBackground,
    themePrimary,
    isDark,
    shouldUseThemePlayerColors,
    playerColors,
    accentColor,
    textColor,
  } = args;

  const playerSurfaceColor = useMemo(() => {
    if (shouldUseThemePlayerColors) {
      return themeBackground;
    }

    return mixHexColors(
      themeBackground,
      playerColors.background || themeBackground,
      isDark ? 1.0 : 0.25
    );
  }, [isDark, playerColors.background, shouldUseThemePlayerColors, themeBackground]);

  const lyricsBaseSurface = useMemo(
    () => mixHexColors(playerColors.background, LYRICS_BASE_MIX_COLOR, playerColors.isDark ? 0.52 : 0.7),
    [playerColors.background, playerColors.isDark]
  );

  const lyricsTextColor = useMemo(
    () => ensureColorContrast(playerColors.text || textColor, lyricsBaseSurface, { minRatio: LYRICS_TEXT_MIN_RATIO }),
    [playerColors.text, lyricsBaseSurface, textColor]
  );

  const protectedAccentColor = useMemo(
    () => ensureColorContrast(
      protectDynamicAccent(accentColor, themePrimary),
      lyricsBaseSurface,
      { minRatio: LYRICS_ACCENT_MIN_RATIO, targetColor: lyricsTextColor }
    ),
    [accentColor, themePrimary, lyricsBaseSurface, lyricsTextColor]
  );

  const lyricsHighlightColor = useMemo(
    () => ensureColorContrast(
      mixHexColors(protectedAccentColor, lyricsTextColor, 0.1),
      lyricsBaseSurface,
      { minRatio: LYRICS_HIGHLIGHT_MIN_RATIO, targetColor: lyricsTextColor }
    ),
    [lyricsBaseSurface, lyricsTextColor, protectedAccentColor]
  );

  const protectedGlowColor = useMemo(
    () => ensureColorContrast(
      mixHexColors(lyricsHighlightColor, lyricsTextColor, 0.28),
      lyricsBaseSurface,
      { minRatio: LYRICS_GLOW_MIN_RATIO, targetColor: lyricsTextColor }
    ),
    [lyricsBaseSurface, lyricsHighlightColor, lyricsTextColor]
  );

  const protectedSpectrumGlowColor = useMemo(
    () => pickSpectrumGlowColor(playerColors, lyricsBaseSurface, protectedGlowColor),
    [lyricsBaseSurface, playerColors, protectedGlowColor]
  );

  const protectedInactiveColor = useMemo(
    () => ensureColorContrast(
      // Mix further toward the surface (0.55) so inactive is clearly dimmer than active.
      mixHexColors(lyricsTextColor, lyricsBaseSurface, 0.55),
      lyricsBaseSurface,
      { minRatio: LYRICS_INACTIVE_MIN_RATIO, targetColor: lyricsTextColor }
    ),
    [lyricsBaseSurface, lyricsTextColor]
  );

  const secondaryLyricsTextColor = useMemo(() => withAlpha(lyricsTextColor, 0.74), [lyricsTextColor]);
  const modeSwitcherBackground = useMemo(
    () => withAlpha(playerColors.background, playerColors.isDark ? 0.34 : 0.18),
    [playerColors.background, playerColors.isDark]
  );
  const modeTabActiveBackground = useMemo(
    () => withAlpha(lyricsTextColor, playerColors.isDark ? 0.14 : 0.08),
    [playerColors.isDark, lyricsTextColor]
  );
  const motionRailBackground = useMemo(
    () => withAlpha(lyricsBaseSurface, playerColors.isDark ? 0.66 : 0.56),
    [playerColors.isDark, lyricsBaseSurface]
  );
  const motionRailBorder = useMemo(
    () => withAlpha(lyricsTextColor, playerColors.isDark ? 0.14 : 0.12),
    [playerColors.isDark, lyricsTextColor]
  );
  const inactiveMotionIconColor = useMemo(() => withAlpha(lyricsTextColor, 0.58), [lyricsTextColor]);

  // --- Dynamic chrome -------------------------------------------------------
  // Replacements for the hardcoded rgba(255,255,255,...) surfaces/borders so the
  // glass, pills and dividers pick up the album's ink instead of pure white.
  // Tinting off `lyricsTextColor` (the contrast-protected on-surface ink) keeps
  // them legible against either a light or dark album while staying in-family.
  const chromeSurfaceColor = useMemo(
    () => withAlpha(lyricsTextColor, playerColors.isDark ? 0.1 : 0.07),
    [lyricsTextColor, playerColors.isDark]
  );
  const chromeSurfaceStrongColor = useMemo(
    () => withAlpha(lyricsTextColor, playerColors.isDark ? 0.18 : 0.13),
    [lyricsTextColor, playerColors.isDark]
  );
  const chromeBorderColor = useMemo(
    () => withAlpha(lyricsTextColor, playerColors.isDark ? 0.16 : 0.14),
    [lyricsTextColor, playerColors.isDark]
  );
  // Accent-tinted divider/border for the active reading rail (e.g. the lrc
  // preview's left bar) — anchors the moment to the album's own accent.
  const accentBorderColor = useMemo(
    () => withAlpha(protectedAccentColor, playerColors.isDark ? 0.55 : 0.45),
    [protectedAccentColor, playerColors.isDark]
  );

  return {
    playerSurfaceColor,
    lyricsBaseSurface,
    lyricsTextColor,
    protectedAccentColor,
    lyricsHighlightColor,
    protectedGlowColor,
    protectedSpectrumGlowColor,
    protectedInactiveColor,
    secondaryLyricsTextColor,
    modeSwitcherBackground,
    modeTabActiveBackground,
    motionRailBackground,
    motionRailBorder,
    inactiveMotionIconColor,
    chromeSurfaceColor,
    chromeSurfaceStrongColor,
    chromeBorderColor,
    accentBorderColor,
  };
}
