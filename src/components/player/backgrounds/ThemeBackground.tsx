import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
    SharedValue,
    interpolate,
    useAnimatedStyle,
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

export function ThemeBackground({ colors, animColors, artwork, isVisible, expansion, lightweight, isDark = true }: ThemeBackgroundProps) {
    const bgStyle = useAnimatedStyle(() => ({
        opacity: interpolate(expansion?.value ?? 1, [0, 0.35, 1], [0, 0.2, 1], 'clamp'),
    }));

    const artworkDriftStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: lightweight ? 1.84 : 1.86 },
            { translateX: lightweight ? 0 : 4 },
            { translateY: lightweight ? 0 : -2 },
        ],
    }));

    return (
        <Animated.View
            style={[StyleSheet.absoluteFill, bgStyle]}
            pointerEvents="none"
            // Flatten this whole (mostly static) subtree — blurred artwork + overlays +
            // fog — into a single GPU texture. Otherwise each full-screen translucent
            // layer adds per-frame overdraw behind the karaoke views, starving the
            // lyrics renderer's frame budget and making the sweep stutter.
            renderToHardwareTextureAndroid
        >
            {artwork ? (
                <View style={StyleSheet.absoluteFill}>
                    <Animated.View style={[StyleSheet.absoluteFill, artworkDriftStyle]}>
                        <Image
                            source={{ uri: artwork }}
                            style={StyleSheet.absoluteFill}
                            blurRadius={isDark ? 72 : 60}
                            contentFit="cover"
                            transition={1400}
                            cachePolicy="memory-disk"
                        />
                    </Animated.View>
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: isDark ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.44)' },
                        ]}
                    />
                </View>
            ) : (
                <ColorFog
                    colors={colors}
                    animColors={animColors}
                    isDark={isDark}
                    lightweight={lightweight}
                />
            )}

            <View
                style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)' },
                ]}
            />
        </Animated.View>
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
    isDark?: boolean;
    lightweight?: boolean;
}

function ColorFog({ colors, animColors, isDark = true, lightweight }: SubComponentProps) {

    const fog1Style = useAnimatedStyle(() => ({
        opacity: isDark ? 0.55 : 0.45,
        backgroundColor: animColors ? animColors.primary.value : colors.primary,
        transform: [
            { translateX: lightweight ? -4 : -8 },
            { translateY: lightweight ? 4 : 8 },
            { scale: lightweight ? 1.02 : 1.04 },
        ],
    }));

    const fog2Style = useAnimatedStyle(() => ({
        opacity: isDark ? 0.42 : 0.32,
        backgroundColor: animColors ? animColors.secondary.value : colors.secondary,
        transform: [
            { translateX: lightweight ? 4 : 10 },
            { translateY: lightweight ? -4 : -8 },
            { scale: lightweight ? 1.01 : 1.03 },
        ],
    }));

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View style={[styles.fogPrimary, fog1Style]} />
            <Animated.View style={[styles.fogSecondary, fog2Style]} />
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
