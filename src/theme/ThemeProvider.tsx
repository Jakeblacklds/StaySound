import React, { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AlbumColors } from '../services/colorExtractor';
import { useSettingsStore } from '../stores/settingsStore';
import { Theme, ThemeMode, ThemeStyle } from '../types/theme';
import { auroraDark } from './styles/aurora';
import { brutalDark } from './styles/brutal';
import { cyberDark } from './styles/cyber';
import { material3Dark, material3Light } from './styles/material3';
import { generateM3Palette, SchemeVariant } from './utils';

const themes: Record<ThemeStyle, { dark: Theme; light: Theme }> = {
    material3: { dark: material3Dark, light: material3Light },
    aurora: { dark: auroraDark, light: auroraDark },
    cyber: { dark: cyberDark, light: cyberDark },
    brutal: { dark: brutalDark, light: brutalDark },
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
        schemeVariant?: string;
    };
    animatedColors: AnimatedColors;
    setThemeStyle: (style: ThemeStyle) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (color: string) => void;
    setSchemeVariant: (variant: SchemeVariant) => void;
    toggleDynamicColors: () => void;
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
        const themeVariants = themes[settings.style] || themes.material3;
        const selectedTheme = isDark ? themeVariants.dark : themeVariants.light;

        if (settings.style === 'material3') {
            const isDynamic = settings.dynamicColors && dynamicPalette;
            const seed = isDynamic ? dynamicPalette.primary : settings.accentColor;
            const colorToUse = seed.startsWith('#') ? seed : `#${seed}`;

            try {
                const variant = isDynamic ? 'content' : (settings.schemeVariant as SchemeVariant) || 'expressive';
                const m3Colors = generateM3Palette(colorToUse, isDark, variant);

                let finalColors: Theme['colors'];

                if (isDynamic) {
                    finalColors = {
                        ...selectedTheme.colors,
                        ...m3Colors,
                        // We only force the background/surface to match the album's mood.
                        // All other colors (primary, onSurface, etc.) are left to the 
                        // M3 generator (m3Colors) which computes valid tonal shifts
                        // (e.g. making them light enough in dark mode) for legibility.
                        background: dynamicPalette.background,
                        surface: dynamicPalette.background,
                    };
                } else {
                    finalColors = { ...selectedTheme.colors, ...m3Colors };
                }

                // ── Animate shared values towards the new colors ──────────
                aPrimary.value = withTiming(finalColors.primary, COLOR_ANIM_CONFIG);
                aBackground.value = withTiming(finalColors.background, COLOR_ANIM_CONFIG);
                aSurface.value = withTiming(finalColors.surface, COLOR_ANIM_CONFIG);
                aSurfaceVariant.value = withTiming(finalColors.surfaceVariant, COLOR_ANIM_CONFIG);
                aPrimaryContainer.value = withTiming(finalColors.primaryContainer, COLOR_ANIM_CONFIG);
                aOnPrimaryContainer.value = withTiming(finalColors.onPrimaryContainer ?? finalColors.onPrimary, COLOR_ANIM_CONFIG);
                aOnSurface.value = withTiming(finalColors.onSurface, COLOR_ANIM_CONFIG);
                aOnSurfaceVariant.value = withTiming(finalColors.onSurfaceVariant ?? finalColors.onSurface, COLOR_ANIM_CONFIG);
                aOnBackground.value = withTiming(finalColors.onBackground, COLOR_ANIM_CONFIG);

                return { ...selectedTheme, colors: finalColors };
            } catch {
                return selectedTheme;
            }
        }
        return selectedTheme;
    }, [settings.style, settings.mode, settings.accentColor, settings.dynamicColors, settings.schemeVariant, isDark, dynamicPalette, aPrimary, aBackground, aSurface, aSurfaceVariant, aPrimaryContainer, aOnPrimaryContainer, aOnSurface, aOnSurfaceVariant, aOnBackground]);

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
            schemeVariant: settings.schemeVariant,
        },
        animatedColors,
        setThemeStyle: settings.setThemeStyle,
        setThemeMode: settings.setThemeMode,
        setAccentColor: settings.setAccentColor,
        setSchemeVariant: (v) => settings.setSchemeVariant(v as string),
        toggleDynamicColors: () => settings.setDynamicColors(!settings.dynamicColors),
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
