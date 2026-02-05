/**
 * PlaylistCard - Card component for playlist display
 */

import { useTheme } from '@/src/theme';
import { Playlist } from '@/src/types';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PlaylistCardProps {
    playlist: Playlist;
    trackCount?: number;
    artwork?: string;
    onPress: (playlist: Playlist) => void;
    onOptionsPress?: (playlist: Playlist) => void;
}

export function PlaylistCard({
    playlist,
    trackCount,
    artwork,
    onPress,
    onOptionsPress
}: PlaylistCardProps) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);

    const handlePressIn = () => {
        scale.value = withSpring(0.98);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1);
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const count = trackCount ?? playlist.trackIds.length;

    return (
        <AnimatedPressable
            onPress={() => onPress(playlist)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[
                styles.container,
                { backgroundColor: theme.colors.surface },
                animatedStyle,
            ]}
        >
            {/* Playlist artwork - mosaic of 4 covers or single image */}
            <View style={[styles.artwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                {artwork || playlist.artwork ? (
                    <Image
                        source={{ uri: artwork || playlist.artwork }}
                        style={styles.artworkImage}
                    />
                ) : (
                    <View style={styles.placeholderArtwork}>
                        <Text style={{ fontSize: 32 }}>🎵</Text>
                    </View>
                )}
            </View>

            {/* Playlist info */}
            <View style={styles.info}>
                <Text
                    variant="titleMedium"
                    numberOfLines={1}
                    style={[styles.name, { color: theme.colors.onSurface }]}
                >
                    {playlist.name}
                </Text>
                <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                >
                    {count} {count === 1 ? 'song' : 'songs'}
                </Text>
            </View>

            {/* Options button */}
            {onOptionsPress && (
                <IconButton
                    icon="dots-vertical"
                    size={20}
                    iconColor={theme.colors.onSurfaceVariant}
                    onPress={() => onOptionsPress(playlist)}
                />
            )}
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginBottom: 8,
    },
    artwork: {
        width: 56,
        height: 56,
        borderRadius: 8,
        overflow: 'hidden',
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    placeholderArtwork: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    info: {
        flex: 1,
        marginLeft: 12,
    },
    name: {
        fontWeight: '600',
    },
});
