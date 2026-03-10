/**
 * TrackListItem - Single track row for lists
 * 
 * Performance notes:
 * - NO per-item Reanimated animations tied to scroll (position, opacity, etc.) —
 *   those would run a worklet every frame per cell, killing 120fps scroll.
 * - Two useAnimatedStyle hooks read singleton shared values from ThemeProvider
 *   (surface + surfaceVariant colors). Their worklets only execute during the
 *   700ms dynamic-color transition when the song changes — never during scroll.
 *   FlashList recycles ~15-20 cells max, so overhead is negligible.
 * - Uses plain Pressable with native ripple for zero-cost press feedback.
 * - Playing state is passed from parent to avoid hundreds of store subscribers.
 */

import { formatDuration } from '@/src/services';
import { useAnimatedColors, useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle } from 'react-native-reanimated';
import { CustomIcon, IconName } from './CustomIcon';

const AnimatedCustomIcon = Animated.createAnimatedComponent(CustomIcon);

interface TrackListItemProps {
    track: Track;
    index?: number;
    showArtwork?: boolean;
    showIndex?: boolean;
    isPlaying?: boolean;
    onPress: (track: Track) => void;
    onOptionsPress?: (track: Track) => void;
    optionsIcon?: IconName;
    optionsIconColor?: string;
}

function TrackListItemInner({
    track,
    index,
    showArtwork = true,
    showIndex = false,
    isPlaying: isPlayingProp,
    onPress,
    onOptionsPress,
    optionsIcon,
    optionsIconColor,
}: TrackListItemProps) {
    const { theme } = useTheme();
    const aC = useAnimatedColors();
    const isMaterial3 = theme.id.startsWith('material3');

    const isPlaying = !!isPlayingProp;

    // Get component styles from theme
    const trackStyles = theme.components.trackItem;
    const globalStyles = theme.components.global;

    // Static parts of Styles (Pre-calculated)
    // Note: backgroundColor is handled via animatedContainerStyle to react to dynamic color changes
    // without requiring a React re-render (which React.memo's custom comparator would block).
    const containerBaseStyle = useMemo(() => [
        styles.container,
        {
            height: trackStyles.height,
            borderRadius: globalStyles.buttonRadius,
            borderWidth: isMaterial3 ? 1 : 0,
            borderColor: isMaterial3 ? `${theme.colors.outline}4D` : globalStyles.borderColor,
            marginHorizontal: globalStyles.screenPadding / 2,
            marginVertical: isMaterial3 ? 4 : 0,
            overflow: 'hidden' as const,
            shadowColor: 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    ], [trackStyles.height, trackStyles.variant, globalStyles.buttonRadius, globalStyles.borderWidth, globalStyles.borderColor, globalStyles.screenPadding, isMaterial3, theme.colors.outline]);

    // Animated background — runs on the UI thread, bypasses React.memo block
    const animatedContainerStyle = useAnimatedStyle(() => ({
        backgroundColor: isMaterial3 ? aC.surface.value : 'transparent',
    }));

    const animatedArtworkStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.surfaceVariant.value,
    }));

    // Playing highlight — animated so it cross-fades smoothly on song change
    const suffix = isMaterial3 ? '66' : '40';
    const animatedPlayingStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.primaryContainer.value + suffix,
    }));

    const artworkContainerBaseStyle = useMemo(() => [
        styles.artwork,
        {
            width: trackStyles.artworkSize,
            height: trackStyles.artworkSize,
            borderRadius: trackStyles.artworkRadius,
        }
    ], [trackStyles.artworkSize, trackStyles.artworkRadius]);

    const subtitle = track.album && track.album !== 'Unknown Album'
        ? `${track.artist} - ${track.album}`
        : track.artist;

    // Animated text colors — UI-thread worklets, only active during the 700ms transition
    const animatedTitleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
    }));
    const animatedSubtleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
        opacity: isPlaying ? 0.85 : 0.65,
    }));
    const animatedIndexStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value,
        opacity: isPlaying ? 1 : 0.8,
    }));

    const animatedIconProps = useAnimatedProps(() => ({
        color: optionsIconColor ?? (isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value),
    }));

    const animatedHeartProps = useAnimatedProps(() => ({
        color: aC.primary.value,
    }));

    return (
        <Animated.View style={[containerBaseStyle, animatedContainerStyle]}>
            {/* Playing highlight — at Animated.View level so it fills the full container */}
            {isPlaying ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        {
                            borderRadius: globalStyles.buttonRadius,
                        },
                        animatedPlayingStyle,
                    ]}
                />
            ) : null}
            <Pressable
                onPress={() => onPress(track)}
                android_ripple={{ color: theme.colors.primary + '15' }}
                style={({ pressed }) => [
                    styles.pressableInner,
                    pressed && styles.pressed,
                ]}
            >

                {/* Index or Artwork */}
                {showIndex && index !== undefined ? (
                    <View style={[styles.indexContainer, { width: trackStyles.artworkSize || 40 }]}>
                        <Animated.Text style={[styles.indexText, animatedIndexStyle]}>
                            {isPlaying ? '♪' : (index + 1).toString().padStart(2, '0')}
                        </Animated.Text>
                    </View>
                ) : showArtwork ? (
                    <Animated.View style={[artworkContainerBaseStyle, animatedArtworkStyle]}>
                        {track.artwork || track.artworkThumb ? (
                            <Image
                                source={{ uri: track.artworkThumb || track.artwork }}
                                style={styles.artworkImage}
                                contentFit="cover"
                                recyclingKey={track.id}
                                cachePolicy="memory-disk"
                                transition={0}
                            />
                        ) : (
                            <CustomIcon name="Canción" size={trackStyles.artworkSize * 0.6} color={theme.colors.primary} />
                        )}
                    </Animated.View>
                ) : null}

                {/* Track Info */}
                <View style={styles.info}>
                    <Animated.Text
                        numberOfLines={1}
                        style={[
                            styles.title,
                            {
                                fontFamily: theme.typography.fontFamily.bold,
                                fontWeight: '900' as const,
                            },
                            animatedTitleStyle,
                        ]}
                    >
                        {track.title}
                    </Animated.Text>
                    <Animated.Text
                        numberOfLines={1}
                        style={[
                            styles.subtitle,
                            {
                                fontFamily: theme.typography.fontFamily.regular,
                            },
                            animatedSubtleStyle,
                        ]}
                    >
                        {subtitle}
                    </Animated.Text>
                </View>

                {/* Duration */}
                <View style={styles.rightContainer}>
                    <Animated.Text
                        style={[styles.duration, { fontFamily: theme.typography.fontFamily.medium }, animatedSubtleStyle]}
                    >
                        {formatDuration(track.duration)}
                    </Animated.Text>
                    {track.favorite && (
                        <AnimatedCustomIcon
                            name="Play"
                            size={12}
                            animatedProps={animatedHeartProps}
                            style={{ marginLeft: 6, opacity: 0.9 }}
                        />
                    )}
                    {onOptionsPress ? (
                        <Pressable
                            hitSlop={8}
                            android_ripple={{ color: theme.colors.primary + '15', borderless: true }}
                            style={styles.queueBtn}
                            onPress={() => onOptionsPress(track)}
                        >
                            <AnimatedCustomIcon
                                name={optionsIcon ?? 'Cola'}
                                size={19}
                                animatedProps={animatedIconProps}
                                style={{ opacity: isPlaying ? 0.9 : 0.75 }}
                            />
                        </Pressable>
                    ) : null}
                </View>
            </Pressable>
        </Animated.View>
    );
}

// Custom comparator: only re-render when data that affects visuals actually changes.
// Ignore callback reference changes (onPress, onOptionsPress) since they're stable via useCallback.
function arePropsEqual(prev: TrackListItemProps, next: TrackListItemProps): boolean {
    return (
        prev.track.id === next.track.id &&
        prev.track.title === next.track.title &&
        prev.track.artist === next.track.artist &&
        prev.track.album === next.track.album &&
        prev.track.artwork === next.track.artwork &&
        prev.track.artworkThumb === next.track.artworkThumb &&
        prev.track.duration === next.track.duration &&
        prev.track.favorite === next.track.favorite &&
        prev.index === next.index &&
        prev.isPlaying === next.isPlaying &&
        prev.showArtwork === next.showArtwork &&
        prev.showIndex === next.showIndex &&
        prev.optionsIcon === next.optionsIcon &&
        prev.optionsIconColor === next.optionsIconColor
    );
}

export const TrackListItem = React.memo(TrackListItemInner, arePropsEqual);
export default TrackListItem;

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pressableInner: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
    },
    pressed: {
        opacity: 0.82,
    },
    noPadding: {
        paddingHorizontal: 0,
    },
    withPadding: {
        paddingHorizontal: 4,
    },
    indexContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    artwork: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    info: {
        flex: 1,
        marginLeft: 12,
        marginRight: 8,
    },
    title: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    queueBtn: {
        marginLeft: 8,
        padding: 4,
        borderRadius: 99,
    },
    indexText: {
        fontSize: 18,
    },
    subtitle: {
        fontSize: 13,
    },
    duration: {
        fontSize: 12,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        opacity: 0.2,
    },
});
