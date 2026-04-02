import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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
    if (lightweight) {
        return (
            <View style={StyleSheet.absoluteFill}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.08)' }]} />
            </View>
        );
    }

    return (
        <View style={StyleSheet.absoluteFill}>
            <FluidGradients colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} lightweight={lightweight} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: lightweight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.1)' }]} />
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
                    duration: 24000,
                    easing: Easing.inOut(Easing.sin)
                }), -1, true);
            }
        } else {
            // Cancel animation entirely for performance
            cancelAnimation(anim);
            anim.value = 0;
        }
    }, [isVisible, lightweight]);

    const blob1Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: interpolate(expansion?.value ?? 0, [0, 1], [72, Math.sin(phase.value) * 138], 'clamp') },
            { translateY: interpolate(expansion?.value ?? 0, [0, 1], [-28, Math.cos(phase.value) * 78], 'clamp') },
            { scale: interpolate(expansion?.value ?? 0, [0, 0.2, 1], [0.72, lightweight ? 0.8 : 0.86, lightweight ? 0.92 : 1], 'clamp') },
        ],
        backgroundColor: animColors ? animColors.primary.value + '20' : colors.primary + '20',
        opacity: interpolate(expansion?.value ?? 0, [0, 0.08, 0.45, 1], [0, 0.16, lightweight ? 0.48 : 0.72, lightweight ? 0.62 : 0.88], 'clamp'),
    }));

    const blob2Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: interpolate(expansion?.value ?? 0, [0, 1], [-54, Math.cos(phase.value) * 112], 'clamp') },
            { translateY: interpolate(expansion?.value ?? 0, [0, 1], [40, Math.sin(phase.value) * 92], 'clamp') },
            { scale: interpolate(expansion?.value ?? 0, [0, 0.2, 1], [0.76, lightweight ? 0.82 : 0.88, lightweight ? 0.9 : 1], 'clamp') },
        ],
        backgroundColor: animColors ? animColors.secondary.value + '1A' : colors.secondary + '1A',
        opacity: interpolate(expansion?.value ?? 0, [0, 0.1, 0.5, 1], [0, 0.12, lightweight ? 0.4 : 0.62, lightweight ? 0.54 : 0.82], 'clamp'),
    }));

    const blob3Style = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.primary.value + '0D' : colors.primary + '0D',
        opacity: interpolate(expansion?.value ?? 0, [0.12, 0.4, 1], [0, lightweight ? 0.1 : 0.18, lightweight ? 0.14 : 0.22], 'clamp'),
        transform: [
            { scale: interpolate(expansion?.value ?? 0, [0, 1], [0.88, lightweight ? 0.95 : 1], 'clamp') },
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
        top: '12%',
        left: '6%',
        width: 400,
        height: 400,
        borderRadius: 200,
    },
    blobSecondary: {
        position: 'absolute',
        bottom: '16%',
        right: '6%',
        width: 380,
        height: 380,
        borderRadius: 190,
    },
    blobAmbient: {
        position: 'absolute',
        top: '42%',
        left: '18%',
        width: 520,
        height: 520,
        borderRadius: 260,
    },
});
