/**
 * useDynamicColors
 *
 * Extracts colors from album artwork and:
 *   1. Returns them for local use (FullPlayer backgrounds, etc.)
 *   2. Pushes the full extracted palette to ThemeProvider so the ENTIRE
 *      app theme adapts to the artwork — but only when dynamicColors is ON.
 *
 * Performance notes:
 *   - react-native-image-colors has its own disk cache (key = URI).
 *   - We maintain an in-memory JS cache in colorExtractor.ts (50 entries).
 *   - setDynamicPalette is stable (useCallback) so it never triggers
 *     extra re-renders of this hook.
 *   - The theme useMemo in ThemeProvider only re-runs when the palette changes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AlbumColors, getImageColors } from '../services/colorExtractor';
import { useTheme } from '../theme/ThemeProvider';

const DEFAULT_COLORS: AlbumColors = {
    primary: '#6750A4',
    secondary: '#625B71',
    background: '#080B12',
    text: '#FFFFFF',
    onPrimary: '#FFFFFF',
    onSurface: '#FFFFFF',
    accent: '#6750A4',
    isDark: true,
};

export function useDynamicColors(imageUri: string | undefined, options?: UseDynamicColorsOptions) {
    return useDynamicColorsWithOptions(imageUri, options);
}

interface UseDynamicColorsOptions {
    enabled?: boolean;
}

export function useDynamicColorsWithOptions(imageUri: string | undefined, options?: UseDynamicColorsOptions) {
    const { config, isDark, theme, setDynamicPalette } = useTheme();
    const fallbackColors = useMemo<AlbumColors>(() => ({
        primary: theme.colors.primary,
        secondary: theme.colors.secondary,
        background: theme.colors.surface,
        text: theme.colors.onSurface,
        onPrimary: theme.colors.onPrimary,
        onSurface: theme.colors.onSurface,
        accent: theme.colors.primary,
        isDark,
    }), [isDark, theme.colors.onPrimary, theme.colors.onSurface, theme.colors.primary, theme.colors.secondary, theme.colors.surface]);
    const [rawColors, setRawColors] = useState<AlbumColors>(fallbackColors);
    const [isLoading, setIsLoading] = useState(false);
    const enabled = options?.enabled ?? true;

    // Shared values for smooth per-frame color transitions in the UI
    const primary = useSharedValue(DEFAULT_COLORS.primary);
    const secondary = useSharedValue(DEFAULT_COLORS.secondary);
    const background = useSharedValue(DEFAULT_COLORS.background);
    const accent = useSharedValue(DEFAULT_COLORS.accent);
    const text = useSharedValue(DEFAULT_COLORS.text);
    const onPrimary = useSharedValue(DEFAULT_COLORS.onPrimary);
    const onSurface = useSharedValue(DEFAULT_COLORS.onSurface);

    const animated = useMemo(() => ({
        primary,
        secondary,
        background,
        accent,
        text,
        onPrimary,
        onSurface,
    }), [accent, background, onPrimary, onSurface, primary, secondary, text]);

    const animatePalette = React.useCallback((palette: AlbumColors) => {
        const cfg = { duration: 600 };
        primary.value = withTiming(palette.primary, cfg);
        secondary.value = withTiming(palette.secondary, cfg);
        background.value = withTiming(palette.background, cfg);
        accent.value = withTiming(palette.accent, cfg);
        text.value = withTiming(palette.text, cfg);
        onPrimary.value = withTiming(palette.onPrimary, cfg);
        onSurface.value = withTiming(palette.onSurface, cfg);
    }, [accent, background, onPrimary, onSurface, primary, secondary, text]);

    useEffect(() => {
        if (!enabled) {
            setRawColors(fallbackColors);
            setIsLoading(false);
            animatePalette(fallbackColors);
            return;
        }

        if (!imageUri) {
            setRawColors(fallbackColors);
            animatePalette(fallbackColors);
            // Reset theme to default colors when no artwork
            if (config.dynamicColors) {
                setDynamicPalette(fallbackColors);
            }
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        getImageColors(imageUri)
            .then((extracted) => {
                if (cancelled) return;

                setRawColors(extracted);
                setIsLoading(false);

                // Animate local shared values (for FullPlayer background, etc.)
                animatePalette(extracted);

                // Push the full palette to ThemeProvider → allows using REAL background/primary.
                if (config.dynamicColors && config.style === 'material3') {
                    setDynamicPalette(extracted);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setRawColors(fallbackColors);
                setIsLoading(false);
                animatePalette(fallbackColors);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animatePalette, config.dynamicColors, enabled, fallbackColors, imageUri, setDynamicPalette]);

    return {
        colors: rawColors,
        isLoading,
        animated,
    };
}
