/**
 * TrackListItem - Single track row for lists
 * 
 * Performance: NO Reanimated here. Each shared value + worklet per item
 * adds up fast in lists with 200+ items, killing scroll performance.
 * Uses plain Pressable with native ripple for zero-cost press feedback.
 * Playing state is passed from parent to avoid hundreds of store subscribers.
 */

import { formatDuration } from '@/src/services';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

interface TrackListItemProps {
    track: Track;
    index?: number;
    showArtwork?: boolean;
    showIndex?: boolean;
    isPlaying?: boolean;
    onPress: (track: Track) => void;
    onOptionsPress?: (track: Track) => void;
    optionsIcon?: string;
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
    const isMaterial3 = theme.id.startsWith('material3');

    const isPlaying = !!isPlayingProp;

    // Get component styles from theme
    const trackStyles = theme.components.trackItem;
    const globalStyles = theme.components.global;

    // Static parts of Styles (Pre-calculated)
    const containerStyle = useMemo(() => [
        styles.container,
        {
            height: trackStyles.height,
            backgroundColor: isMaterial3 ? `${theme.colors.surface}CC` : 'transparent',
            borderRadius: trackStyles.variant === 'glass' ? 16 : globalStyles.buttonRadius,
            borderWidth: trackStyles.variant === 'brutal' ? globalStyles.borderWidth : (isMaterial3 ? 1 : 0),
            borderColor: trackStyles.variant === 'brutal' ? globalStyles.borderColor : (isMaterial3 ? `${theme.colors.outline}4D` : globalStyles.borderColor),
            marginHorizontal: globalStyles.screenPadding / 2,
            marginVertical: trackStyles.variant === 'brutal' ? 8 : (isMaterial3 ? 4 : 0),
            overflow: 'hidden' as const,
            shadowColor: 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    ], [trackStyles.height, trackStyles.variant, globalStyles.buttonRadius, globalStyles.borderWidth, globalStyles.borderColor, globalStyles.screenPadding, isMaterial3, theme.colors.surface, theme.colors.outline]);

    const artworkContainerStyle = useMemo(() => [
        styles.artwork,
        {
            backgroundColor: theme.colors.surfaceVariant,
            width: trackStyles.artworkSize,
            height: trackStyles.artworkSize,
            borderRadius: trackStyles.artworkRadius,
        }
    ], [theme.colors.surfaceVariant, trackStyles.artworkSize, trackStyles.artworkRadius]);

    const titleColor = isPlaying ? theme.colors.primary : theme.colors.onSurface;
    const subtitle = track.album && track.album !== 'Unknown Album'
        ? `${track.artist} - ${track.album}`
        : track.artist;

    return (
        <Pressable
            onPress={() => onPress(track)}
            android_ripple={{ color: theme.colors.primary + '15' }}
            style={({ pressed }) => [
                containerStyle,
                pressed && styles.pressed,
            ]}
        >
            {isPlaying ? (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        {
                            backgroundColor: theme.colors.primaryContainer + (isMaterial3 ? '66' : '40'),
                            borderRadius: trackStyles.variant === 'glass' ? 16 : globalStyles.buttonRadius,
                        },
                    ]}
                />
            ) : null}

            {/* Index or Artwork */}
            {showIndex && index !== undefined ? (
                <View style={[styles.indexContainer, { width: trackStyles.artworkSize || 40 }]}>
                    <Text
                        variant="bodyMedium"
                        style={[styles.indexText, { color: isPlaying ? theme.colors.primary : theme.colors.onSurfaceVariant }]}
                    >
                        {isPlaying ? '♪' : (index + 1).toString().padStart(2, '0')}
                    </Text>
                </View>
            ) : showArtwork ? (
                <View style={artworkContainerStyle}>
                    {track.artwork ? (
                        <Image
                            source={{ uri: track.artwork }}
                            style={styles.artworkImage}
                            contentFit="cover"
                            recyclingKey={track.id}
                            cachePolicy="memory-disk"
                            transition={0}
                        />
                    ) : (
                        <Text style={{ fontSize: trackStyles.artworkSize * 0.4 }}>🎵</Text>
                    )}
                </View>
            ) : null}

            {/* Track Info */}
            <View style={styles.info}>
                <Text
                    variant="bodyLarge"
                    numberOfLines={1}
                    style={[styles.title, { color: titleColor, fontFamily: theme.typography.fontFamily.bold, textTransform: trackStyles.variant === 'cyber' ? 'uppercase' as const : 'none' as const, }]}
                >
                    {track.title}
                </Text>
                <Text
                    variant="bodySmall"
                    numberOfLines={1}
                    style={{ color: theme.colors.onSurfaceVariant, fontFamily: theme.typography.fontFamily.regular, letterSpacing: trackStyles.variant === 'cyber' ? 1 : 0, }}
                >
                    {subtitle}
                </Text>
            </View>

            {/* Duration */}
            <View style={styles.rightContainer}>
                <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, fontFamily: theme.typography.fontFamily.medium, }}
                >
                    {formatDuration(track.duration)}
                </Text>
                {onOptionsPress ? (
                    <IconButton
                        icon={optionsIcon ?? 'playlist-plus'}
                        size={18}
                        iconColor={optionsIconColor ?? theme.colors.onSurfaceVariant}
                        style={styles.queueBtn}
                        onPress={() => onOptionsPress(track)}
                    />
                ) : null}
            </View>
        </Pressable>
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
        prev.track.duration === next.track.duration &&
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
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    queueBtn: {
        margin: 0,
        marginLeft: 2,
    },
    indexText: {
        fontSize: 18,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        opacity: 0.2,
    },
});
