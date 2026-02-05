/**
 * AlbumCard - Card component for album grid display
 */

import { useTheme } from '@/src/theme';
import { Album } from '@/src/types';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface AlbumCardProps {
    album: Album;
    size?: 'small' | 'medium' | 'large';
    onPress: (album: Album) => void;
}

const SIZES = {
    small: 100,
    medium: 150,
    large: 180,
};

export function AlbumCard({ album, size = 'medium', onPress }: AlbumCardProps) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const cardSize = SIZES[size];

    const handlePressIn = () => {
        scale.value = withSpring(0.95);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1);
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return (
        <AnimatedPressable
            onPress={() => onPress(album)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[styles.container, { width: cardSize }, animatedStyle]}
        >
            {/* Album Art */}
            <View
                style={[
                    styles.artwork,
                    {
                        backgroundColor: theme.colors.surfaceVariant,
                        width: cardSize,
                        height: cardSize,
                    }
                ]}
            >
                {album.artwork ? (
                    <Image source={{ uri: album.artwork }} style={styles.artworkImage} />
                ) : (
                    <Text style={{ fontSize: cardSize * 0.3 }}>💿</Text>
                )}
            </View>

            {/* Album Info */}
            <View style={styles.info}>
                <Text
                    variant="bodyMedium"
                    numberOfLines={1}
                    style={[styles.name, { color: theme.colors.onSurface }]}
                >
                    {album.name}
                </Text>
                <Text
                    variant="bodySmall"
                    numberOfLines={1}
                    style={{ color: theme.colors.onSurfaceVariant }}
                >
                    {album.artist}
                </Text>
            </View>
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        marginRight: 12,
    },
    artwork: {
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    info: {
        marginTop: 8,
        paddingHorizontal: 2,
    },
    name: {
        fontWeight: '600',
    },
});
