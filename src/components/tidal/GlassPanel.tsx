/**
 * GlassPanel
 *
 * The standard translucent "glass" surface for the Tidal redesign: a blurred
 * panel with a hairline border and large rounded corners. Degrades to a solid
 * translucent surface in lite mode (same approach as ActionSheet).
 */
import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { radius as radiusTokens, usePerformanceProfile, useTheme, withAlpha } from '@/src/theme';

interface GlassPanelProps {
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    /** Corner radius. Defaults to the xl token (28). */
    radius?: number;
    /** Blur intensity when blur is enabled. Defaults to 40. */
    intensity?: number;
    /** Hide the hairline border (e.g. when the panel sits flush in a list). */
    borderless?: boolean;
    /** Extra tint laid over the blur (e.g. a faint primary wash). */
    tintColor?: string;
    /**
     * Real BlurView vs. a solid translucent surface. Defaults to true.
     * Set false for surfaces that wrap SCROLLING content — a live BlurView over
     * a moving list recomputes the blur every frame and tanks Android scroll FPS.
     */
    blurred?: boolean;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
    children,
    style,
    radius = radiusTokens.xl,
    intensity = 40,
    borderless = false,
    tintColor,
    blurred = true,
}) => {
    const { theme, isDark } = useTheme();
    const perf = usePerformanceProfile();

    const borderColor = withAlpha(theme.colors.outline, isDark ? '40' : '55');
    const containerStyle: ViewStyle = {
        borderRadius: radius,
        borderWidth: borderless ? 0 : StyleSheet.hairlineWidth,
        borderColor,
        overflow: 'hidden',
    };

    if (!blurred || !perf.enableBlurEffects) {
        // Cheap translucent surface — no live blur. Lite mode leans opaque for
        // legibility; otherwise stay see-through so the atmosphere bleeds in.
        const solidAlpha = perf.enableBlurEffects ? (isDark ? 'D0' : 'E0') : 'F2';
        return (
            <View style={[containerStyle, { backgroundColor: withAlpha(theme.colors.surface, solidAlpha) }, style]}>
                {tintColor ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" /> : null}
                {children}
            </View>
        );
    }

    return (
        <View style={[containerStyle, style]}>
            <BlurView
                intensity={intensity}
                tint={isDark ? 'dark' : 'light'}
                experimentalBlurMethod="dimezisBlurView"
                style={StyleSheet.absoluteFill}
            />
            <View
                style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(theme.colors.surface, isDark ? '4D' : '66') }]}
                pointerEvents="none"
            />
            {tintColor ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" /> : null}
            {children}
        </View>
    );
};
