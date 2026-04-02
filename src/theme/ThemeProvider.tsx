import React, { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AlbumColors } from '../services/colorExtractor';
import { useSettingsStore } from '../stores/settingsStore';
import { Theme, ThemeMode, ThemeStyle } from '../types/theme';
import { material3Dark, material3Light } from './styles/material3';
import { generateM3Palette, generateManualAccentPalette, SchemeVariant } from './utils';

function parseHexColor(value: string) {
    const hex = value.trim().replace('#', '');
    if (hex.length < 6) return null;

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }) {
    const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixHexColors(from: string, to: string, amount: number) {
    const source = parseHexColor(from);
    const target = parseHexColor(to);
    if (!source || !target) return from;

    const t = Math.max(0, Math.min(1, amount));
    return toHex({
        r: source.r + (target.r - source.r) * t,
        g: source.g + (target.g - source.g) * t,
        b: source.b + (target.b - source.b) * t,
    });
}

const themes: Record<ThemeStyle, { dark: Theme; light: Theme }> = {
    material3: { dark: material3Dark, light: material3Light },
};

// ─── Animated color transition config ───────────────────────────
// 700ms ease-out — feels natural without being distracting
const COLOR_ANIM_CONFIG = { duration: 700 };

// Default colors that match the material3Dark theme so there's no flash on boot
const DEFAULT_ANIM_COLORS = {
    primary: '#8AB4FF',
    background: '#080B12',
    surface: '#101623',
    surfaceVariant: '#1A2335',
    primaryContainer: '#12315C',
    onPrimaryContainer: '#D8E6FF',
    onSurface: '#E8EEF9',
    onSurfaceVariant: '#9BAAC4',
    onBackground: '#E8EEF9',
};

export type AnimatedColors = {
    primary: ReturnType<typeof useSharedValue<string>>;
    background: ReturnType<typeof useSharedValue<string>>;
    surface: ReturnType<typeof useSharedValue<string>>;
    surfaceVariant: ReturnType<typeof useSharedValue<string>>;
    primaryContainer: ReturnType<typeof useSharedValue<string>>;
    onPrimaryContainer: ReturnType<typeof useSharedValue<string>>;
    onSurface: ReturnType<typeof useSharedValue<string>>;
    onSurfaceVariant: ReturnType<typeof useSharedValue<string>>;
    onBackground: ReturnType<typeof useSharedValue<string>>;
};

interface ThemeContextType {
    theme: Theme;
    config: {
        style: ThemeStyle;
        mode: ThemeMode;
        accentColor: string;
        dynamicColors: boolean;
        lightweightMode: boolean;
        schemeVariant?: string;
    };
    animatedColors: AnimatedColors;
    setThemeStyle: (style: ThemeStyle) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (color: string) => void;
    setSchemeVariant: (variant: SchemeVariant) => void;
    toggleDynamicColors: () => void;
    toggleLightweightMode: () => void;
    /** Called by useDynamicColors when a new album's palette is extracted.
     *  Only takes effect when config.dynamicColors === true. */
    setDynamicPalette: (colors: AlbumColors) => void;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const systemColorScheme = useColorScheme();
    const settings = useSettingsStore();
    const [dynamicPalette, setDynamicPaletteState] = useState<AlbumColors | null>(null);

    const isDark = settings.mode === 'system' ? systemColorScheme === 'dark' : settings.mode === 'dark';

    // ─── Animated shared values for smooth color transitions ───
    const aPrimary = useSharedValue(DEFAULT_ANIM_COLORS.primary);
    const aBackground = useSharedValue(DEFAULT_ANIM_COLORS.background);
    const aSurface = useSharedValue(DEFAULT_ANIM_COLORS.surface);
    const aSurfaceVariant = useSharedValue(DEFAULT_ANIM_COLORS.surfaceVariant);
    const aPrimaryContainer = useSharedValue(DEFAULT_ANIM_COLORS.primaryContainer);
    const aOnPrimaryContainer = useSharedValue(DEFAULT_ANIM_COLORS.onPrimaryContainer);
    const aOnSurface = useSharedValue(DEFAULT_ANIM_COLORS.onSurface);
    const aOnSurfaceVariant = useSharedValue(DEFAULT_ANIM_COLORS.onSurfaceVariant);
    const aOnBackground = useSharedValue(DEFAULT_ANIM_COLORS.onBackground);

    const animatedColors: AnimatedColors = React.useMemo(() => ({
        primary: aPrimary,
        background: aBackground,
        surface: aSurface,
        surfaceVariant: aSurfaceVariant,
        primaryContainer: aPrimaryContainer,
        onPrimaryContainer: aOnPrimaryContainer,
        onSurface: aOnSurface,
        onSurfaceVariant: aOnSurfaceVariant,
        onBackground: aOnBackground,
    }), [aPrimary, aBackground, aSurface, aSurfaceVariant, aPrimaryContainer, aOnPrimaryContainer, aOnSurface, aOnSurfaceVariant, aOnBackground]);

    const theme = React.useMemo(() => {
        const themeVariants = themes.material3;
        const selectedTheme = isDark ? themeVariants.dark : themeVariants.light;

        const isDynamic = settings.dynamicColors && dynamicPalette;
        const seed = isDynamic ? dynamicPalette.primary : settings.accentColor;
        const colorToUse = seed.startsWith('#') ? seed : `#${seed}`;

        try {
            const variant = isDynamic ? 'content' : (settings.schemeVariant as SchemeVariant) || 'expressive';
            const m3Colors = isDynamic
                ? generateM3Palette(colorToUse, isDark, variant)
                : generateManualAccentPalette(colorToUse, isDark, variant);

            let finalColors: Theme['colors'];

            if (isDynamic) {
                if (isDark) {
                    const mutedBackground = mixHexColors(
                        dynamicPalette.background,
                        selectedTheme.colors.background,
                        0.34
                    );

                    finalColors = {
                        ...selectedTheme.colors,
                        ...m3Colors,
                        background: mutedBackground,
                        surface: dynamicPalette.background,
                        onSurface: dynamicPalette.onSurface,
                        onSurfaceVariant: dynamicPalette.onSurface,
                    };
                } else {
                    finalColors = {
                        ...selectedTheme.colors,
                        ...m3Colors,
                        background: mixHexColors(selectedTheme.colors.background, dynamicPalette.background, 0.06),
                        surface: mixHexColors(selectedTheme.colors.surface, dynamicPalette.background, 0.08),
                        surfaceVariant: mixHexColors(selectedTheme.colors.surfaceVariant, dynamicPalette.background, 0.14),
                        primaryContainer: mixHexColors(m3Colors.primaryContainer, dynamicPalette.primary, 0.14),
                        secondaryContainer: mixHexColors(m3Colors.secondaryContainer ?? selectedTheme.colors.secondaryContainer, dynamicPalette.secondary, 0.12),
                        onSurface: selectedTheme.colors.onSurface,
                        onSurfaceVariant: selectedTheme.colors.onSurfaceVariant,
                        onBackground: selectedTheme.colors.onBackground,
                    };
                }
            } else {
                finalColors = { ...selectedTheme.colors, ...m3Colors };
            }

            return { ...selectedTheme, colors: finalColors };
        } catch {
            return selectedTheme;
        }
    }, [settings.mode, settings.accentColor, settings.dynamicColors, settings.schemeVariant, isDark, dynamicPalette]);

    // ─── Sync Shared Values ──────────────────────────────────────────
    // We do this in useEffect to avoid "Writing to value during render" warnings.
    React.useEffect(() => {
        const finalColors = theme.colors;
        aPrimary.value = withTiming(finalColors.primary, COLOR_ANIM_CONFIG);
        aBackground.value = withTiming(finalColors.background, COLOR_ANIM_CONFIG);
        aSurface.value = withTiming(finalColors.surface, COLOR_ANIM_CONFIG);
        aSurfaceVariant.value = withTiming(finalColors.surfaceVariant, COLOR_ANIM_CONFIG);
        aPrimaryContainer.value = withTiming(finalColors.primaryContainer, COLOR_ANIM_CONFIG);
        aOnPrimaryContainer.value = withTiming(finalColors.onPrimaryContainer ?? finalColors.onPrimary, COLOR_ANIM_CONFIG);
        aOnSurface.value = withTiming(finalColors.onSurface, COLOR_ANIM_CONFIG);
        aOnSurfaceVariant.value = withTiming(finalColors.onSurfaceVariant ?? finalColors.onSurface, COLOR_ANIM_CONFIG);
        aOnBackground.value = withTiming(finalColors.onBackground, COLOR_ANIM_CONFIG);
    }, [theme.colors, aPrimary, aBackground, aSurface, aSurfaceVariant, aPrimaryContainer, aOnPrimaryContainer, aOnSurface, aOnSurfaceVariant, aOnBackground]);

    const setDynamicPalette = useCallback((colors: AlbumColors) => {
        setDynamicPaletteState(prev => {
            if (prev?.primary === colors.primary && prev?.background === colors.background) return prev;
            return colors;
        });
    }, []);

    const value: ThemeContextType = {
        theme,
        config: {
            style: settings.style,
            mode: settings.mode,
            accentColor: settings.accentColor,
            dynamicColors: settings.dynamicColors,
            lightweightMode: settings.lightweightMode,
            schemeVariant: settings.schemeVariant,
        },
        animatedColors,
        setThemeStyle: settings.setThemeStyle,
        setThemeMode: settings.setThemeMode,
        setAccentColor: settings.setAccentColor,
        setSchemeVariant: (v) => settings.setSchemeVariant(v as string),
        toggleDynamicColors: () => settings.setDynamicColors(!settings.dynamicColors),
        toggleLightweightMode: () => settings.setLightweightMode(!settings.lightweightMode),
        setDynamicPalette,
        isDark,
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within a ThemeProvider');
    return context;
};

/** Returns animated shared values for key colors.
 *  Use these with useAnimatedStyle() for smooth color transitions.
 *  The animation runs entirely on the UI thread — zero per-frame JS cost. */
export const useAnimatedColors = () => useTheme().animatedColors;

export const useColors = () => useTheme().theme.colors;
export const useSpacing = () => useTheme().theme.spacing;
export const useComponentStyles = () => useTheme().theme.components;
