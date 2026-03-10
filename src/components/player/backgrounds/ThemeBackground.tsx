import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    SharedValue,
    cancelAnimation,
    interpolate,
    useAnimatedStyle,
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
}

export function ThemeBackground({ colors, animColors, artwork, isVisible, expansion }: ThemeBackgroundProps) {
    return (
        <View style={StyleSheet.absoluteFill}>
            <FluidGradients colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.1)' }]} />
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
}

function FluidGradients({ colors, animColors, isVisible, expansion }: SubComponentProps) {
    const anim = useSharedValue(0);

    useEffect(() => {
        if (isVisible) {
            anim.value = withRepeat(withTiming(1, {
                duration: 20000,
                easing: Easing.inOut(Easing.sin)
            }), -1, true);
        } else {
            // Cancel animation entirely for performance
            cancelAnimation(anim);
            anim.value = 0;
        }
    }, [isVisible]);

    const blob1Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: Math.sin(anim.value * Math.PI * 2) * 160 },
            { translateY: Math.cos(anim.value * Math.PI * 2) * 90 },
        ],
        backgroundColor: animColors ? animColors.primary.value + '25' : colors.primary + '25'
    }));

    const blob2Style = useAnimatedStyle(() => ({
        transform: [
            { translateX: Math.cos(anim.value * Math.PI * 2) * 130 },
            { translateY: Math.sin(anim.value * Math.PI * 2) * 110 },
        ],
        backgroundColor: animColors ? animColors.secondary.value + '20' : colors.secondary + '20'
    }));

    const blob3Style = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.primary.value + '10' : colors.primary + '10',
        opacity: interpolate(expansion?.value ?? 1, [0.1, 0.4], [0, 0.25], 'clamp')
    }));

    return (
        <View style={StyleSheet.absoluteFill}>
            <Animated.View style={[styles.blob, blob1Style, { top: '10%', left: '5%' }]} />
            <Animated.View style={[styles.blob, blob2Style, { bottom: '15%', right: '5%' }]} />
            <Animated.View style={[styles.blob, { top: '40%', left: '20%', width: 600, height: 600, opacity: 0.25 }, blob3Style]} />
        </View>
    );
}

const styles = StyleSheet.create({
    gridLineH: { position: 'absolute', width: '100%', height: 1 },
    gridLineV: { position: 'absolute', width: 1, height: '100%' },
    scanline: { position: 'absolute', width: '100%', shadowRadius: 15, shadowColor: 'white', shadowOpacity: 0.6 },
    glow: { position: 'absolute', width: 500, height: 500, borderRadius: 250 },
    brutalShape: { position: 'absolute', width: 250, height: 250, borderWidth: 4 },
    blob: { position: 'absolute', width: 450, height: 450, borderRadius: 225 },
});
