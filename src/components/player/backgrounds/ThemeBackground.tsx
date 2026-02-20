import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
    variant: string;
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

export function ThemeBackground({ variant, colors, animColors, artwork, isVisible, expansion }: ThemeBackgroundProps) {
    switch (variant) {
        case 'aurora':
            return <LiquidGlassBackground artwork={artwork} colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />;
        case 'cyber':
            return <CyberBackground colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />;
        case 'brutal':
            return <BrutalBackground colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />;
        case 'immersive': // Material 3 variant
            return (
                <View style={StyleSheet.absoluteFill}>
                    <FluidGradients colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.1)' }]} />
                </View>
            );
        default:
            return <FluidGradients colors={colors} animColors={animColors} isVisible={isVisible} expansion={expansion} />;
    }
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

function LiquidGlassBackground({ artwork, colors, animColors, isVisible, expansion }: { artwork?: string } & SubComponentProps) {
    const drift = useSharedValue(0);

    useEffect(() => {
        if (isVisible) {
            drift.value = withRepeat(
                withTiming(1, {
                    duration: 20000,
                    easing: Easing.inOut(Easing.sin)
                }),
                -1,
                true
            );
        } else {
            // Cancel animation entirely for performance
            cancelAnimation(drift);
            drift.value = 0;
        }
    }, [isVisible]);

    const animatedImageStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: 1.4 + Math.sin(drift.value * Math.PI) * 0.15 },
            { rotate: `${Math.sin(drift.value * Math.PI) * 10}deg` },
        ] as any,
    } as any));

    const auroraBlob1Style = useAnimatedStyle(() => {
        const primary = animColors ? animColors.primary.value : colors.primary;
        return {
            backgroundColor: primary + '80',
            transform: [
                { translateX: Math.sin(drift.value * Math.PI * 2) * 120 },
                { translateY: Math.cos(drift.value * Math.PI) * 180 },
                { scale: 1.8 + Math.sin(drift.value * Math.PI) * 0.6 },
            ] as any,
            borderRadius: 250,
        } as any;
    });

    const auroraBlob2Style = useAnimatedStyle(() => {
        const secondary = animColors ? animColors.secondary.value : colors.secondary;
        return {
            backgroundColor: secondary + '70',
            transform: [
                { translateX: Math.cos(drift.value * Math.PI * 1.5) * 180 },
                { translateY: Math.sin(drift.value * Math.PI * 2) * 120 },
                { scale: 2.2 + Math.cos(drift.value * Math.PI) * 0.9 },
            ] as any,
            borderRadius: 300,
        } as any;
    });

    const auroraBlob3Style = useAnimatedStyle(() => {
        const primary = animColors ? animColors.primary.value : colors.primary;
        return {
            backgroundColor: primary + '50',
            transform: [
                { translateX: Math.sin(drift.value * Math.PI * 1.2) * -150 },
                { translateY: Math.cos(drift.value * Math.PI * 0.8) * -100 },
                { scale: 1.5 + Math.sin(drift.value * Math.PI * 1.5) * 0.7 },
            ] as any,
            borderRadius: 200,
        } as any;
    });

    const overlayStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.background.value + '70' : colors.background + '70'
    }));

    const blob1Opacity = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0.1, 0.4], [0, 0.8], 'clamp')
    }));

    const blob2Opacity = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0.15, 0.45], [0, 0.7], 'clamp')
    }));

    const blob3Opacity = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0.2, 0.5], [0, 0.6], 'clamp')
    }));

    return (
        <View style={StyleSheet.absoluteFill}>
            {/* 1. Base Blurred Image */}
            <Animated.View style={[StyleSheet.absoluteFill, animatedImageStyle]}>
                <Image
                    source={{ uri: artwork }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    blurRadius={100}
                />
            </Animated.View>

            {/* 2. Dynamic Aurora Blobs */}
            <Animated.View style={[
                styles.blob,
                auroraBlob1Style,
                { top: '5%', left: '0%', width: 500, height: 500 },
                blob1Opacity
            ]} />
            <Animated.View style={[
                styles.blob,
                auroraBlob2Style,
                { bottom: '5%', right: '0%', width: 600, height: 600 },
                blob2Opacity
            ]} />
            <Animated.View style={[
                styles.blob,
                auroraBlob3Style,
                { top: '30%', left: '20%', width: 400, height: 400 },
                blob3Opacity
            ]} />

            {/* 3. Glass Depth Overlay */}
            <Animated.View style={[StyleSheet.absoluteFill, overlayStyle]}>
                <LinearGradient
                    colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.6)']}
                    locations={[0, 0.4, 1]}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </View>
    );
}

function CyberBackground({ colors, animColors, isVisible, expansion }: SubComponentProps) {
    const scanlinePos = useSharedValue(0);

    useEffect(() => {
        if (isVisible) {
            scanlinePos.value = withRepeat(withTiming(1, {
                duration: 3500,
                easing: Easing.linear
            }), -1, false);
        } else {
            // Cancel animation entirely for performance
            cancelAnimation(scanlinePos);
            scanlinePos.value = 0;
        }
    }, [isVisible]);

    const scanlineStyle = useAnimatedStyle(() => ({
        top: `${scanlinePos.value * 100}%`,
        backgroundColor: animColors ? animColors.primary.value + '40' : colors.primary + '40',
        height: 2,
    } as any));

    const gridStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.primary.value + '08' : colors.primary + '08',
        opacity: interpolate(expansion?.value ?? 1, [0.1, 0.5], [0, 1], 'clamp')
    }));

    const glowPrimaryStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.primary.value + '20' : colors.primary + '20'
    }));

    const glowSecondaryStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.secondary.value + '15' : colors.secondary + '15',
        opacity: interpolate(expansion?.value ?? 1, [0.2, 0.6], [0, 1], 'clamp')
    }));

    return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#020202' }]}>
            <View style={StyleSheet.absoluteFill}>
                {[...Array(25)].map((_, i) => (
                    <Animated.View key={`h-${i}`} style={[styles.gridLineH, { top: `${(i * 4.1)}%` }, gridStyle]} />
                ))}
                {[...Array(15)].map((_, i) => (
                    <Animated.View key={`v-${i}`} style={[styles.gridLineV, { left: `${(i * 7.1)}%` }, gridStyle]} />
                ))}
            </View>
            <Animated.View style={[styles.scanline, scanlineStyle]} />
            <Animated.View style={[styles.glow, { top: -150, right: -150 }, glowPrimaryStyle]} />
            <Animated.View style={[styles.glow, { bottom: -150, left: -150 }, glowSecondaryStyle]} />
        </View>
    );
}

function BrutalBackground({ colors, animColors, isVisible, expansion }: SubComponentProps) {
    const jitter = useSharedValue(0);

    useEffect(() => {
        if (isVisible) {
            jitter.value = withRepeat(
                withTiming(1, {
                    duration: 4000,
                    easing: Easing.bezier(0.65, 0, 0.35, 1)
                }),
                -1,
                true
            );
        } else {
            // Cancel animation entirely for performance
            cancelAnimation(jitter);
            jitter.value = 0;
        }
    }, [isVisible]);

    const bgStyle = useAnimatedStyle(() => ({
        backgroundColor: animColors ? animColors.background.value : colors.background
    }));

    const shape1Style = useAnimatedStyle(() => {
        const c = animColors ? animColors.primary.value : colors.primary;
        return {
            backgroundColor: c + '40',
            borderColor: c,
            transform: [
                { rotate: `${jitter.value * 360}deg` },
                { scale: 0.8 + Math.sin(jitter.value * Math.PI) * 0.4 },
                { translateX: Math.sin(jitter.value * Math.PI * 2) * 50 },
            ] as any,
        } as any;
    });

    const shape2Style = useAnimatedStyle(() => {
        const c = animColors ? animColors.secondary.value : colors.secondary;
        return {
            backgroundColor: c + '30',
            borderColor: c,
            transform: [
                { rotate: `${-jitter.value * 180}deg` },
                { scale: 1.2 + Math.cos(jitter.value * Math.PI) * 0.3 },
                { translateY: Math.cos(jitter.value * Math.PI * 2) * 80 },
            ] as any,
        } as any;
    });

    const shape3Style = useAnimatedStyle(() => {
        const c = animColors ? animColors.primary.value : colors.primary;
        return {
            borderColor: c,
            transform: [
                { rotate: `${jitter.value * 90}deg` },
                { skewX: `${Math.sin(jitter.value * Math.PI) * 20}deg` },
            ] as any,
        } as any;
    });

    const brutalOpacity = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0, 0.5], [0, 1], 'clamp')
    }));

    return (
        <Animated.View style={[
            StyleSheet.absoluteFill,
            bgStyle,
            brutalOpacity
        ]}>
            {/* Chaotic overlapping shapes */}
            <Animated.View style={[styles.brutalShape, shape1Style, { top: '10%', left: '5%', width: 300, height: 300 }]} />
            <Animated.View style={[styles.brutalShape, shape2Style, { bottom: '15%', right: '-10%', width: 350, height: 350 }]} />
            <Animated.View style={[styles.brutalShape, shape3Style, { top: '35%', left: '20%', width: 200, height: 200, borderWidth: 8, backgroundColor: 'transparent' }]} />
            <Animated.View style={[styles.brutalShape, shape1Style, { bottom: '5%', left: '-5%', width: 150, height: 150, opacity: 0.5 }]} />
        </Animated.View>
    );
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
