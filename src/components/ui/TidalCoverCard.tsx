import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    cancelAnimation,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { useTheme, withAlpha } from '@/src/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TidalCoverCardProps {
    imageUri?: string;
    title?: string;
    subtitle?: string;
    size: number;
    variant?: 'square' | 'circle' | 'portrait';
    fallbackIcon?: keyof typeof Ionicons.glyphMap;
    badge?: 'play';
    /** Small chip rendered over the cover (e.g. "Hi-Res"). */
    meta?: string;
    /** 'glass' tunes label colors brighter for translucent backgrounds. */
    tone?: 'default' | 'glass';
    /** Download state shown as a rising layer inside the artwork. */
    downloadStatus?: 'idle' | 'downloading' | 'done' | 'error';
    downloadProgress?: number;
    onPress: () => void;
}

export const TidalCoverCard: React.FC<TidalCoverCardProps> = ({
    imageUri,
    title,
    subtitle,
    size,
    variant = 'square',
    fallbackIcon = 'musical-notes',
    badge,
    meta,
    tone = 'default',
    downloadStatus = 'idle',
    downloadProgress = 0,
    onPress,
}) => {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const downloadFill = useSharedValue(downloadStatus === 'done' ? 1 : 0);
    const shimmer = useSharedValue(-1);
    const completion = useSharedValue(downloadStatus === 'done' ? 1 : 0);
    const circle = variant === 'circle';
    const portrait = variant === 'portrait';
    const glass = tone === 'glass';
    const coverHeight = portrait ? Math.round(size * 1.22) : size;
    const titleColor = glass ? theme.colors.onBackground : theme.colors.onSurface;
    const subtitleColor = glass
        ? withAlpha(theme.colors.onBackground, 'A6')
        : theme.colors.onSurfaceVariant;

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    useEffect(() => {
        const nextProgress = downloadStatus === 'done'
            ? 1
            : downloadStatus === 'downloading'
                ? Math.max(0.04, Math.min(0.96, downloadProgress))
                : downloadStatus === 'error' ? 0.32 : 0;

        downloadFill.value = withTiming(nextProgress, { duration: 280, easing: Easing.out(Easing.cubic) });
        completion.value = withTiming(downloadStatus === 'done' ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });

        if (downloadStatus === 'downloading') {
            shimmer.value = -1;
            shimmer.value = withRepeat(
                withTiming(1, { duration: 1250, easing: Easing.linear }),
                -1,
                false,
            );
        } else {
            cancelAnimation(shimmer);
        }
    }, [downloadProgress, downloadStatus]);

    const downloadFillStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: (1 - downloadFill.value) * coverHeight }],
    }));

    const shimmerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: shimmer.value * size * 2 }],
    }));

    const completionStyle = useAnimatedStyle(() => ({
        opacity: completion.value,
        transform: [{ scale: 0.7 + completion.value * 0.3 }],
    }));

    const handlePressIn = () => {
        scale.value = withTiming(0.97, { duration: 80, easing: Easing.out(Easing.quad) });
    };
    const handlePressOut = () => {
        scale.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
    };
    const handlePress = () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
    };

    return (
        <AnimatedPressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[{ width: size }, animatedStyle]}
        >
            <View
                style={[
                    styles.cover,
                    {
                        width: size,
                        height: coverHeight,
                        borderRadius: circle ? size / 2 : portrait ? 22 : 20,
                        backgroundColor: theme.colors.surfaceVariant,
                        borderColor: withAlpha(theme.colors.outline, portrait ? '66' : '00'),
                        borderWidth: portrait ? StyleSheet.hairlineWidth : 0,
                    },
                ]}
            >
                {imageUri ? (
                    <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={300} />
                ) : (
                    <View style={[StyleSheet.absoluteFill, styles.center]}>
                        <Ionicons name={fallbackIcon} size={26} color={theme.colors.onSurfaceVariant} />
                    </View>
                )}
                {portrait ? (
                    <LinearGradient
                        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.34)', 'rgba(0,0,0,0.74)']}
                        locations={[0, 0.58, 1]}
                        pointerEvents="none"
                        style={styles.portraitFade}
                    />
                ) : null}
                {meta ? (
                    <View style={styles.metaChip}>
                        <Text numberOfLines={1} style={styles.metaChipLabel}>{meta}</Text>
                    </View>
                ) : null}
                {badge === 'play' ? (
                    <View style={styles.playBadge}>
                        <Ionicons name="play" size={15} color="#FFFFFF" />
                    </View>
                ) : null}
                {downloadStatus !== 'idle' ? (
                    <Animated.View pointerEvents="none" style={[styles.downloadTide, { height: coverHeight }, downloadFillStyle]}>
                        <LinearGradient
                            colors={[
                                withAlpha(theme.colors.primary, 'EE'),
                                withAlpha((theme.colors as any).tertiary ?? theme.colors.secondary, 'D9'),
                            ]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFill}
                        />
                        {downloadStatus === 'downloading' ? (
                            <Animated.View style={[styles.downloadShimmer, shimmerStyle]} />
                        ) : null}
                        <View style={styles.downloadTideContent}>
                            {downloadStatus === 'done' ? (
                                <Animated.View style={completionStyle}>
                                    <Ionicons name="checkmark" size={32} color={theme.colors.onPrimary} />
                                </Animated.View>
                            ) : downloadStatus === 'error' ? (
                                <Ionicons name="alert" size={26} color={theme.colors.onError} />
                            ) : (
                                <Ionicons name="arrow-down" size={28} color={theme.colors.onPrimary} />
                            )}
                        </View>
                    </Animated.View>
                ) : null}
            </View>
            {title ? (
                <Text numberOfLines={1} style={[styles.title, { color: titleColor, textAlign: circle ? 'center' : 'left' }]}>
                    {title}
                </Text>
            ) : null}
            {subtitle ? (
                <Text numberOfLines={1} style={[styles.subtitle, { color: subtitleColor, textAlign: circle ? 'center' : 'left' }]}>
                    {subtitle}
                </Text>
            ) : null}
        </AnimatedPressable>
    );
};

const styles = StyleSheet.create({
    cover: {
        overflow: 'hidden',
    },
    portraitFade: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '54%',
    },
    center: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    playBadge: {
        position: 'absolute',
        right: 10,
        bottom: 10,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    metaChip: {
        position: 'absolute',
        left: 10,
        top: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.28)',
    },
    metaChipLabel: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    downloadTide: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    downloadTideContent: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    downloadShimmer: {
        position: 'absolute',
        top: -24,
        bottom: -24,
        width: '42%',
        backgroundColor: 'rgba(255,255,255,0.18)',
        transform: [{ skewX: '-18deg' }],
    },
    title: {
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: -0.2,
        marginTop: 8,
    },
    subtitle: {
        fontSize: 12,
        marginTop: 2,
        opacity: 0.82,
    },
});
