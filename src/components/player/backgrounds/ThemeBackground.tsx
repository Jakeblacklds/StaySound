import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
    Easing,
    SharedValue,
    cancelAnimation,
    interpolate,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withRepeat,
    withTiming
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
}

export function ThemeBackground({ colors, animColors, artwork, isVisible, expansion, lightweight }: ThemeBackgroundProps) {
    const bgStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.background.value : colors.background,
        opacity: interpolate(expansion?.value ?? 0, [0, 1], [0.1, 0.62]),
    }));

    return (
        <View style={StyleSheet.absoluteFill}>
            {/* Base color to prevent flickering */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
            
            {/* Atmospheric Artwork Blur */}
            {artwork && (
                <View style={StyleSheet.absoluteFill}>
                    <Image
                        source={{ uri: artwork }}
                        style={[StyleSheet.absoluteFill, { transform: [{ scale: 3 }] }]}
                        blurRadius={80}
                        contentFit="cover"
                        transition={1200}
                    />
                    {/* Darkening overlay for the artwork blur */}
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
                </View>
            )}

            <FluidGradients colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} lightweight={lightweight} />
            
            {/* Fog of color transitioning between songs */}
            <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} pointerEvents="none" />
            
            {/* Finisher subtle darkening for readability */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.12)' }]} pointerEvents="none" />
        </View>
    );
}

interface SubComponentProps {
    colors: AlbumColors;
    animColors?: {
        primary: SharedValue<string>;
        secondary: SharedValue<string>;
        background: SharedValue<string>;
        accent: SharedValue<string>;
        text: SharedValue<string>;
    };
    isVisible?: boolean;
    expansion?: SharedValue<number>;
    lightweight?: boolean;
}

function FluidGradients({ colors, animColors, isVisible, expansion, lightweight }: SubComponentProps) {
    const anim = useSharedValue(0);
    const phase = useDerivedValue(() => anim.value * Math.PI * 2);

    useEffect(() => {
        if (isVisible) {
            if (lightweight) {
                cancelAnimation(anim);
                anim.value = withTiming(0.18, {
                    duration: 420,
                    easing: Easing.out(Easing.quad),
                });
            } else {
                anim.value = withRepeat(withTiming(1, {
                    duration: 32000, // Even slower, more majestic movement
                    easing: Easing.inOut(Easing.sin)
                }), -1, true);
            }
        } else {
            cancelAnimation(anim);
            anim.value = 0;
        }
    }, [isVisible, lightweight]);

    const blob1Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: interpolate(expansion?.value ?? 0, [0, 1], [72, Math.sin(phase.value) * 150], 'clamp') },
            { translateY: interpolate(expansion?.value ?? 0, [0, 1], [-28, Math.cos(phase.value) * 85], 'clamp') },
            { scale: interpolate(expansion?.value ?? 0, [0, 0.2, 1], [0.72, 1.2, 1.5], 'clamp') },
        ],
        // Boosted presence from +20 (12%) to +40 (25%) or +50 (31%)
        backgroundColor: animColors ? animColors.primary.value + '40' : colors.primary + '40',
        opacity: interpolate(expansion?.value ?? 0, [0, 0.08, 1], [0, 0.4, lightweight ? 0.6 : 0.85], 'clamp'),
    }));

    const blob2Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: interpolate(expansion?.value ?? 0, [0, 1], [-54, Math.cos(phase.value) * 125], 'clamp') },
            { translateY: interpolate(expansion?.value ?? 0, [0, 1], [40, Math.sin(phase.value) * 105], 'clamp') },
            { scale: interpolate(expansion?.value ?? 0, [0, 0.2, 1], [0.76, 1.1, 1.4], 'clamp') },
        ],
        backgroundColor: animColors ? animColors.secondary.value + '35' : colors.secondary + '35',
        opacity: interpolate(expansion?.value ?? 0, [0, 0.1, 1], [0, 0.35, lightweight ? 0.55 : 0.75], 'clamp'),
    }));

    const blob3Style = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.primary.value + '25' : colors.primary + '25',
        opacity: interpolate(expansion?.value ?? 0, [0.12, 1], [0, lightweight ? 0.25 : 0.35], 'clamp'),
        transform: [
            { scale: interpolate(expansion?.value ?? 0, [0, 1], [0.88, 1.6], 'clamp') },
        ],
    }));

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Animated.View style={[styles.blobPrimary, blob1Style]} />
            <Animated.View style={[styles.blobSecondary, blob2Style]} />
            <Animated.View style={[styles.blobAmbient, blob3Style]} />
        </View>
    );
}

const styles = StyleSheet.create({
    blobBase: { position: 'absolute' },
    blobPrimary: {
        position: 'absolute',
        top: '5%',
        left: '-10%',
        width: 500,
        height: 500,
        borderRadius: 250,
    },
    blobSecondary: {
        position: 'absolute',
        bottom: '5%',
        right: '-10%',
        width: 450,
        height: 450,
        borderRadius: 225,
    },
    blobAmbient: {
        position: 'absolute',
        top: '35%',
        left: '10%',
        width: 600,
        height: 600,
        borderRadius: 300,
    },
});
