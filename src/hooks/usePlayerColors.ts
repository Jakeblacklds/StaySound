import type { AlbumColors } from '@/src/services/colorExtractor';
import { ensureColorContrast, getRelativeLuminance, mixHexColors, withAlpha } from '@/src/utils/colorContrast';
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
const LYRICS_INACTIVE_MIN_RATIO = 3.1;

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

function protectDynamicAccent(accentColor: string, fallbackColor: string) {
  const spread = getChannelSpread(accentColor);
  if (spread >= PLAYER_ACCENT_SPREAD_MIN) {
    return accentColor;
  }

  return mixHexColors(accentColor, fallbackColor, PLAYER_ACCENT_PROTECTION_BLEND);
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

  const protectedInactiveColor = useMemo(
    () => ensureColorContrast(
      mixHexColors(lyricsTextColor, lyricsBaseSurface, 0.44),
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

  return {
    playerSurfaceColor,
    lyricsBaseSurface,
    lyricsTextColor,
    protectedAccentColor,
    lyricsHighlightColor,
    protectedGlowColor,
    protectedInactiveColor,
    secondaryLyricsTextColor,
    modeSwitcherBackground,
    modeTabActiveBackground,
    motionRailBackground,
    motionRailBorder,
    inactiveMotionIconColor,
  };
}

function toHexByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function withAlphaHex(color: string, alphaHex: string) {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  return `${rgbToHex(parsed.r, parsed.g, parsed.b)}${alphaHex}`;
}

export function getMiniPlayerButtonColors(baseColor: string, fallbackBorder: string) {
  const baseRgb = parseHexColor(baseColor);
  if (!baseRgb) {
    return {
      fill: withAlphaHex(baseColor, '24'),
      border: withAlphaHex(fallbackBorder, '78'),
    };
  }

  const luminance = getRelativeLuminance(baseColor) ?? 0.5;
  const contrastTarget = luminance > 0.42
    ? { r: 12, g: 16, b: 24 }
    : { r: 255, g: 255, b: 255 };

  const fill = rgbToHex(
    baseRgb.r + (contrastTarget.r - baseRgb.r) * 0.12,
    baseRgb.g + (contrastTarget.g - baseRgb.g) * 0.12,
    baseRgb.b + (contrastTarget.b - baseRgb.b) * 0.12
  );
  const border = rgbToHex(
    baseRgb.r + (contrastTarget.r - baseRgb.r) * 0.68,
    baseRgb.g + (contrastTarget.g - baseRgb.g) * 0.68,
    baseRgb.b + (contrastTarget.b - baseRgb.b) * 0.68
  );

  return {
    fill: withAlphaHex(fill, '22'),
    border: withAlphaHex(border, 'D6'),
  };
}
