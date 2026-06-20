/**
 * TidalAtmosphere
 *
 * Full-screen, absolutely-positioned dynamic background shared by the Tidal /
 * library / home screens. Colors extracted from the hero artwork drive the
 * backdrop:
 *   - 'artwork' mode → a blurred artwork backdrop (used where one cover is the
 *     hero, e.g. album / playlist detail).
 *   - 'tint' mode    → a smooth top-down gradient of the extracted color fading
 *     into the app background. NO circular fog blobs — just a soft color wash.
 *
 * Color extraction happens HERE and only here — one extraction per screen,
 * never per list row. `getImageColors` is cached, so revisits are free.
 *
 * Lite mode (perf profile): renders a flat background with no extraction/blur.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useDynamicColorsWithOptions } from '@/src/hooks/useDynamicColors';
import { AlbumColors } from '@/src/services/colorExtractor';
import { usePerformanceProfile, useTheme, withAlpha } from '@/src/theme';
import { ThemeBackground } from '@/src/components/player/backgrounds/ThemeBackground';

export interface TidalAtmosphereColors {
    /** Animated shared values for the extracted palette (or theme fallback). */
    animated: ReturnType<typeof useDynamicColorsWithOptions>['animated'];
    /** Resolved (non-animated) snapshot of the palette. */
    colors: AlbumColors;
}

interface TidalAtmosphereProps {
    /** Artwork URI to extract colors from. */
    sourceUri?: string;
    /**
     * 'fog' / 'tint' → smooth color-wash gradient (no circular blobs).
     * 'artwork'      → blurred artwork backdrop (needs a sourceUri).
     */
    mode?: 'fog' | 'tint' | 'artwork';
    /** Accepted for API symmetry; the backdrop is intentionally static. */
    scrollY?: SharedValue<number>;
    /**
     * Force a fixed cool palette (used by the Soulseek view, which has no
     * artwork and should feel distinct from artwork-tinted Tidal results).
     */
    coolFallback?: boolean;
    /** Reports the live palette back to the screen (for accent colors, etc.). */
    onColors?: (atmos: TidalAtmosphereColors) => void;
}

const COOL_PALETTE: AlbumColors = {
    primary: '#03DAC6',
    secondary: '#3700B3',
    background: '#0A0E12',
    text: '#FFFFFF',
    onPrimary: '#00201C',
    onSurface: '#FFFFFF',
    accent: '#03DAC6',
    isDark: true,
};

export const TidalAtmosphere: React.FC<TidalAtmosphereProps> = ({
    sourceUri,
    mode = 'tint',
    coolFallback = false,
    onColors,
}) => {
    const { theme, isDark } = useTheme();
    const perf = usePerformanceProfile();

    const extractionEnabled = perf.enableDynamicColors && !coolFallback;
    const { colors, animated } = useDynamicColorsWithOptions(sourceUri, {
        enabled: extractionEnabled,
        applyToTheme: false,
    });

    const resolvedColors = coolFallback ? COOL_PALETTE : colors;

    // Surface the live palette to the parent screen (memoized object).
    const atmos = useMemo<TidalAtmosphereColors>(() => ({ animated, colors: resolvedColors }), [animated, resolvedColors]);
    React.useEffect(() => {
        onColors?.(atmos);
    }, [atmos, onColors]);

    const primaryTintStyle = useAnimatedStyle(() => ({
        backgroundColor: animated.primary.value,
    }));
    const secondaryTintStyle = useAnimatedStyle(() => ({
        backgroundColor: animated.secondary.value,
    }));

    // Lite mode → flat background, no extraction / blur / tint.
    if (perf.mode === 'lite' || !perf.enableAnimatedBackgrounds) {
        return (
            <View
                style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}
                pointerEvents="none"
            />
        );
    }

    const showArtwork = mode === 'artwork' && !!sourceUri && !coolFallback;

    if (showArtwork) {
        return (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <ThemeBackground
                    colors={resolvedColors}
                    artwork={sourceUri}
                    isDark={isDark}
                    lightweight={false}
                />
                {/* Fade the lower half into the real app background for legibility. */}
                <LinearGradient
                    colors={[
                        'transparent',
                        withAlpha(theme.colors.background, isDark ? 'B0' : 'C8'),
                        theme.colors.background,
                    ]}
                    locations={[0.35, 0.72, 1]}
                    style={StyleSheet.absoluteFill}
                />
            </View>
        );
    }

    // Smooth color-wash tint — animated layers driven by shared values so color
    // transitions over ~1200ms instead of snapping on extraction completion.
    return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]} pointerEvents="none">
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: isDark ? 0.30 : 0.25 }, primaryTintStyle]} />
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: isDark ? 0.12 : 0.10 }, secondaryTintStyle]} />
            <LinearGradient
                colors={['transparent', theme.colors.background]}
                locations={[0.18, 0.85]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
};
