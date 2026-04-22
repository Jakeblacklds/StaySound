import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
    Easing,
    SharedValue,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { AlbumColors } from '../../../services/colorExtractor';

interface ThemeBackgroundProps {
    colors: AlbumColors;
    animColors?: {
        primary: SharedValue<string>;
        secondary: SharedValue<string>;
        background: SharedValue<string>;
        accent: SharedValue<string>;
        text: SharedValue<string>;
    };
    artwork?: string;
    isVisible?: boolean;
    expansion?: SharedValue<number>;
    lightweight?: boolean;
    isDark?: boolean;
}

// ─── Keyframe definitions ────────────────────────────────────────────────────
// All declared outside the component so they are created only once.

/** Slow-drift for the artwork blur layer: subtle scale + slight translate */
const artworkDrift = {
    '0%':   { transform: [{ scale: 1.80 }, { translateX: 0 },   { translateY: 0 }] },
    '25%':  { transform: [{ scale: 1.86 }, { translateX: 18 },  { translateY: -12 }] },
    '50%':  { transform: [{ scale: 1.82 }, { translateX: 0 },   { translateY: -24 }] },
    '75%':  { transform: [{ scale: 1.88 }, { translateX: -18 }, { translateY: -12 }] },
    '100%': { transform: [{ scale: 1.80 }, { translateX: 0 },   { translateY: 0 }] },
};

/** Lightweight version: only scale, no translate */
const artworkDriftLight = {
    '0%':   { transform: [{ scale: 1.80 }] },
    '50%':  { transform: [{ scale: 1.86 }] },
    '100%': { transform: [{ scale: 1.80 }] },
};

/** Primary blob drift — top-left to center-right */
const blobPrimaryDrift = {
    '0%':   { transform: [{ translateX: 0 },   { translateY: 0 },   { scale: 1.00 }] },
    '33%':  { transform: [{ translateX: 24 },  { translateY: -18 }, { scale: 1.08 }] },
    '66%':  { transform: [{ translateX: -12 }, { translateY: 20 },  { scale: 0.95 }] },
    '100%': { transform: [{ translateX: 0 },   { translateY: 0 },   { scale: 1.00 }] },
};

/** Secondary blob drift — bottom-right to center-left */
const blobSecondaryDrift = {
    '0%':   { transform: [{ translateX: 0 },   { translateY: 0 },   { scale: 1.00 }] },
    '40%':  { transform: [{ translateX: -20 }, { translateY: 16 },  { scale: 1.06 }] },
    '70%':  { transform: [{ translateX: 16 },  { translateY: -20 }, { scale: 0.96 }] },
    '100%': { transform: [{ translateX: 0 },   { translateY: 0 },   { scale: 1.00 }] },
};

export function ThemeBackground({ colors, animColors, artwork, isVisible, expansion, lightweight, isDark = true }: ThemeBackgroundProps) {
    // Fade the whole layer in with expansion
    const bgStyle = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0, 0.35, 1], [0, 0.2, 1], 'clamp'),
    }));

    return (
        <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} pointerEvents="none">
            {/* Artwork-derived atmospheric blur — the core visual */}
            {artwork ? (
                <View style={StyleSheet.absoluteFill}>
                    {/* Heavily blurred album art scaled up to fill the screen — now always drifting */}
                    <Animated.View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                // Reanimated v4 CSS keyframe animation — runs 100% on UI thread,
                                // zero JS overhead. Paused when not visible to save GPU.
                                animationName: lightweight ? artworkDriftLight : artworkDrift,
                                animationDuration: lightweight ? '28000ms' : '22000ms',
                                animationTimingFunction: 'ease-in-out',
                                animationIterationCount: 'infinite',
                                animationDirection: 'alternate',
                                animationFillMode: 'both',
                                animationPlayState: isVisible ? 'running' : 'paused',
                            },
                        ]}
                    >
                        <Image
                            source={{ uri: artwork }}
                            style={StyleSheet.absoluteFill}
                            blurRadius={isDark ? 72 : 60}
                            contentFit="cover"
                            transition={1400}
                            cachePolicy="memory-disk"
                        />
                    </Animated.View>
                    {/* Tint overlay — keeps colors vibrant but controlled */}
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: isDark ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.44)' },
                        ]}
                    />
                </View>
            ) : (
                /* Fallback: animated color fog from dynamic palette */
                <ColorFog colors={colors} animColors={animColors} isDark={isDark} isVisible={isVisible} lightweight={lightweight} />
            )}

            {/* Soft readability scrim */}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)' },
                ]}
            />
        </Animated.View>
    );
}

// ─── ColorFog ────────────────────────────────────────────────────────────────
// Fallback without artwork: two animated blobs that drift and pulse using
// Reanimated v4 CSS keyframes — no withRepeat, no JS callbacks per frame.
interface SubComponentProps {
    colors: AlbumColors;
    animColors?: {
        primary: SharedValue<string>;
        secondary: SharedValue<string>;
        background: SharedValue<string>;
        accent: SharedValue<string>;
        text: SharedValue<string>;
    };
    isDark?: boolean;
    isVisible?: boolean;
    lightweight?: boolean;
}

function ColorFog({ colors, animColors, isDark = true, isVisible, lightweight }: SubComponentProps) {
    // Opacity only — fades in once on mount
    const fogOpacity = useSharedValue(0);

    useEffect(() => {
        fogOpacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) });
    }, []);

    const fog1Style = useAnimatedStyle(() => ({
        opacity: fogOpacity.value * (isDark ? 0.55 : 0.45),
        backgroundColor: animColors ? animColors.primary.value : colors.primary,
    }));

    const fog2Style = useAnimatedStyle(() => ({
        opacity: fogOpacity.value * (isDark ? 0.42 : 0.32),
        backgroundColor: animColors ? animColors.secondary.value : colors.secondary,
    }));

    const blobDuration = lightweight ? '20000ms' : '14000ms';
    const blob2Duration = lightweight ? '26000ms' : '18000ms';
    const playState = isVisible ? 'running' : 'paused';

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View
                style={[
                    styles.fogPrimary,
                    fog1Style,
                    {
                        animationName: blobPrimaryDrift,
                        animationDuration: blobDuration,
                        animationTimingFunction: 'ease-in-out',
                        animationIterationCount: 'infinite',
                        animationDirection: 'alternate',
                        animationFillMode: 'both',
                        animationPlayState: playState,
                    },
                ]}
            />
            <Animated.View
                style={[
                    styles.fogSecondary,
                    fog2Style,
                    {
                        animationName: blobSecondaryDrift,
                        animationDuration: blob2Duration,
                        animationTimingFunction: 'ease-in-out',
                        animationIterationCount: 'infinite',
                        animationDirection: 'alternate',
                        animationFillMode: 'both',
                        animationDelay: '-4000ms',
                        animationPlayState: playState,
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    fogPrimary: {
        position: 'absolute',
        top: '-10%',
        left: '-20%',
        width: '100%',
        height: '70%',
        borderBottomRightRadius: 999,
        borderBottomLeftRadius: 400,
    },
    fogSecondary: {
        position: 'absolute',
        bottom: '-10%',
        right: '-20%',
        width: '90%',
        height: '65%',
        borderTopLeftRadius: 999,
        borderTopRightRadius: 400,
    },
});
