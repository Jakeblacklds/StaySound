/**
 * TrackListItem - Single track row for lists
 * Uses theme component styles for visual differentiation
 */

import { formatDuration } from '@/src/services';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Divider, IconButton, Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TrackListItemProps {
    track: Track;
    index?: number;
    isPlaying?: boolean;
    showArtwork?: boolean;
    showIndex?: boolean;
    onPress: (track: Track) => void;
    onOptionsPress?: (track: Track) => void;
}

export function TrackListItem({
    track,
    index,
    isPlaying = false,
    showArtwork = true,
    showIndex = false,
    onPress,
    onOptionsPress,
}: TrackListItemProps) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);

    // Get component styles from theme
    const trackStyles = theme.components.trackItem;

    const handlePressIn = () => {
        scale.value = withSpring(trackStyles.activeScale);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1);
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return (
        <>
            <AnimatedPressable
                onPress={() => onPress(track)}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                style={[
                    styles.container,
                    {
                        backgroundColor: isPlaying ? theme.colors.primaryContainer + '30' : 'transparent',
                        height: trackStyles.height,
                    },
                    animatedStyle,
                ]}
            >
                {/* Index or Artwork */}
                {showIndex && index !== undefined ? (
                    <View style={[styles.indexContainer, { width: trackStyles.artworkSize }]}>
                        {isPlaying ? (
                            <Text style={{ color: theme.colors.primary, fontSize: 16 }}>♪</Text>
                        ) : (
                            <Text
                                variant="bodyMedium"
                                style={{ color: theme.colors.onSurfaceVariant }}
                            >
                                {index + 1}
                            </Text>
                        )}
                    </View>
                ) : showArtwork ? (
                    <View style={[
                        styles.artwork,
                        {
                            backgroundColor: theme.colors.surfaceVariant,
                            width: trackStyles.artworkSize,
                            height: trackStyles.artworkSize,
                            borderRadius: trackStyles.artworkRadius,
                        }
                    ]}>
                        {track.artwork ? (
                            <Image
                                source={{ uri: track.artwork }}
                                style={[
                                    styles.artworkImage,
                                    { borderRadius: trackStyles.artworkRadius }
                                ]}
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
                        style={[
                            styles.title,
                            { color: isPlaying ? theme.colors.primary : theme.colors.onSurface }
                        ]}
                    >
                        {track.title}
                    </Text>
                    <Text
                        variant="bodySmall"
                        numberOfLines={1}
                        style={{ color: theme.colors.onSurfaceVariant }}
                    >
                        {track.artist}
                    </Text>
                </View>

                {/* Duration */}
                <Text
                    variant="bodySmall"
                    style={[styles.duration, { color: theme.colors.onSurfaceVariant }]}
                >
                    {formatDuration(track.duration)}
                </Text>

                {/* Options button */}
                {onOptionsPress && (
                    <IconButton
                        icon="dots-vertical"
                        size={20}
                        iconColor={theme.colors.onSurfaceVariant}
                        onPress={() => onOptionsPress(track)}
                        style={styles.optionsButton}
                    />
                )}
            </AnimatedPressable>

            {/* Divider based on theme style */}
            {trackStyles.showDivider && (
                <Divider
                    style={{
                        marginLeft: trackStyles.dividerInset,
                        backgroundColor: theme.colors.outline + '40',
                    }}
                />
            )}
        </>
    );
}

// Memoize to prevent re-renders during scroll
export default React.memo(TrackListItem, (prevProps, nextProps) => {
    return (
        prevProps.track.id === nextProps.track.id &&
        prevProps.isPlaying === nextProps.isPlaying &&
        prevProps.index === nextProps.index
    );
});

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
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
        fontWeight: '500',
    },
    duration: {
        marginRight: 4,
    },
    optionsButton: {
        margin: 0,
    },
});
