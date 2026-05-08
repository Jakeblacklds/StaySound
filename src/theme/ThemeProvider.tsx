import React, { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AlbumColors, isAlbumPaletteMonochrome } from '../services/colorExtractor';
import { useSettingsStore } from '../stores/settingsStore';
import { Theme, ThemeMode, ThemeStyle } from '../types/theme';
import { ensureColorContrast, mixHexColors, pickReadableColor } from '../utils/colorContrast';
import { material3Dark, material3Light } from './styles/material3';
import { generateM3Palette, generateManualAccentPalette, SchemeVariant } from './utils';

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

function buildReadableLightDynamicColors(
    selectedTheme: Theme,
    m3Colors: Theme['colors'],
    dynamicPalette: AlbumColors,
) {
    const background = mixHexColors(selectedTheme.colors.background, m3Colors.background, 0.18);
    const surface = mixHexColors(selectedTheme.colors.surface, m3Colors.surface, 0.26);
    const surfaceVariantBase = mixHexColors(selectedTheme.colors.surfaceVariant, m3Colors.surfaceVariant, 0.58);
    const surfaceVariant = ensureColorContrast(surfaceVariantBase, surface, {
        minRatio: 1.14,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: selectedTheme.colors.surfaceVariant,
    });
    const primary = ensureColorContrast(m3Colors.primary, surface, {
        minRatio: 4.8,
        targetColor: selectedTheme.colors.onBackground,
        fallbackColor: selectedTheme.colors.primary,
    });
    const secondary = ensureColorContrast(m3Colors.secondary, surface, {
        minRatio: 4.5,
        targetColor: selectedTheme.colors.onBackground,
        fallbackColor: selectedTheme.colors.secondary,
    });
    const primaryContainerBase = mixHexColors(m3Colors.primaryContainer, dynamicPalette.primary, 0.08);
    const primaryContainer = ensureColorContrast(primaryContainerBase, surface, {
        minRatio: 1.2,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: m3Colors.primaryContainer,
    });
    const secondaryContainerBase = mixHexColors(
        m3Colors.secondaryContainer ?? selectedTheme.colors.secondaryContainer,
        dynamicPalette.secondary,
        0.06,
    );
    const secondaryContainer = ensureColorContrast(secondaryContainerBase, surface, {
        minRatio: 1.16,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: selectedTheme.colors.secondaryContainer,
    });
    const tertiaryContainerBase = mixHexColors(
        m3Colors.tertiaryContainer ?? selectedTheme.colors.surfaceVariant,
        dynamicPalette.primary,
        0.05,
    );
    const tertiaryContainer = ensureColorContrast(tertiaryContainerBase, surface, {
        minRatio: 1.16,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: m3Colors.tertiaryContainer ?? selectedTheme.colors.surfaceVariant,
    });
    const outline = ensureColorContrast(
        mixHexColors(m3Colors.outline, selectedTheme.colors.outline, 0.45),
        surface,
        {
            minRatio: 2.2,
            targetColor: selectedTheme.colors.onSurfaceVariant,
            fallbackColor: selectedTheme.colors.outline,
        }
    );

    const onBackground = ensureColorContrast(selectedTheme.colors.onBackground, background, {
        minRatio: 9,
        targetColor: selectedTheme.colors.onBackground,
        fallbackColor: selectedTheme.colors.onBackground,
    });
    const onSurface = ensureColorContrast(selectedTheme.colors.onSurface, surface, {
        minRatio: 9,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: selectedTheme.colors.onSurface,
    });
    const onSurfaceVariant = ensureColorContrast(m3Colors.onSurfaceVariant, surfaceVariant, {
        minRatio: 5.2,
        targetColor: selectedTheme.colors.onSurface,
        fallbackColor: selectedTheme.colors.onSurfaceVariant,
    });
    const onPrimary = pickReadableColor(primary, [
        m3Colors.onPrimary,
        selectedTheme.colors.onPrimary,
        onBackground,
    ]);
    const onSecondary = pickReadableColor(secondary, [
        m3Colors.onSecondary,
        selectedTheme.colors.onSecondary,
        onBackground,
    ]);
    const onPrimaryContainer = pickReadableColor(primaryContainer, [
        m3Colors.onPrimaryContainer,
        selectedTheme.colors.onPrimaryContainer,
        onSurface,
        onBackground,
    ]);
    const onSecondaryContainer = pickReadableColor(secondaryContainer, [
        m3Colors.onSecondaryContainer,
        selectedTheme.colors.onSurface,
        onBackground,
    ]);
    const onTertiary = m3Colors.tertiary
        ? pickReadableColor(m3Colors.tertiary, [
            m3Colors.onTertiary,
            selectedTheme.colors.onPrimary,
            onBackground,
        ])
        : undefined;
    const onTertiaryContainer = pickReadableColor(tertiaryContainer, [
        m3Colors.onTertiaryContainer,
        selectedTheme.colors.onSurface,
        onBackground,
    ]);

    return {
        ...selectedTheme.colors,
        ...m3Colors,
        background,
        surface,
        surfaceVariant,
        primary,
        onPrimary,
        primaryContainer,
        onPrimaryContainer,
        secondary,
        onSecondary,
        secondaryContainer,
        onSecondaryContainer,
        tertiaryContainer,
        onTertiary,
        onTertiaryContainer,
        outline,
        onBackground,
        onSurface,
        onSurfaceVariant,
    };
}

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
            const dynamicVariant = isDynamic && isAlbumPaletteMonochrome(dynamicPalette)
                ? 'monochrome'
                : 'content';
            const variant = isDynamic ? dynamicVariant : (settings.schemeVariant as SchemeVariant) || 'expressive';
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
                    finalColors = buildReadableLightDynamicColors(selectedTheme, m3Colors, dynamicPalette);
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
