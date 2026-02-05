/**
 * ArtistCard - Card component for artist display
 */

import { useTheme } from '@/src/theme';
import { Artist } from '@/src/types';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ArtistCardProps {
    artist: Artist;
    size?: 'small' | 'medium' | 'large';
    onPress: (artist: Artist) => void;
}

const SIZES = {
    small: 80,
    medium: 120,
    large: 150,
};

export function ArtistCard({ artist, size = 'medium', onPress }: ArtistCardProps) {
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

    // Get initials for placeholder
    const initials = artist.name
        .split(' ')
        .map(word => word[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    return (
        <AnimatedPressable
            onPress={() => onPress(artist)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[styles.container, { width: cardSize }, animatedStyle]}
        >
            {/* Artist Image (circular) */}
            <View
                style={[
                    styles.imageContainer,
                    {
                        backgroundColor: theme.colors.primaryContainer,
                        width: cardSize,
                        height: cardSize,
                    }
                ]}
            >
                {artist.artwork ? (
                    <Image source={{ uri: artist.artwork }} style={styles.image} />
                ) : (
                    <Text
                        style={[
                            styles.initials,
                            {
                                color: theme.colors.onPrimaryContainer,
                                fontSize: cardSize * 0.3,
                            }
                        ]}
                    >
                        {initials}
                    </Text>
                )}
            </View>

            {/* Artist Info */}
            <Text
                variant="bodyMedium"
                numberOfLines={1}
                style={[styles.name, { color: theme.colors.onSurface }]}
            >
                {artist.name}
            </Text>
            <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
            >
                {artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}
            </Text>
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        marginRight: 16,
    },
    imageContainer: {
        borderRadius: 9999, // Full circle
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    initials: {
        fontWeight: 'bold',
    },
    name: {
        fontWeight: '600',
        marginTop: 8,
        textAlign: 'center',
    },
});
