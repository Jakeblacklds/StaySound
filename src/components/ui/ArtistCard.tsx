/**
 * ArtistCard - Card component for artist display
 * 
 * Performance: No Reanimated — uses native Pressable opacity for press feedback.
 * NO useArtistInfo hook here — network requests inside list items kill scroll perf.
 * Artist info (photos, bios) should be pre-fetched and stored in the Artist model.
 * For the grid listing, we show local data only (initials or cached artwork).
 */

import { useTheme } from '@/src/theme';
import { Artist } from '@/src/types';
import { Image as ExpoImage } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

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

function ArtistCardInner({ artist, size = 'medium', onPress }: ArtistCardProps) {
    const { theme } = useTheme();
    const isMaterial3 = theme.id.startsWith('material3');
    const cardSize = SIZES[size];
    const [imageFailed, setImageFailed] = useState(false);

    const cardStyles = theme.components.card;
    const globalStyles = theme.components.global;

    // Use artwork already stored in the Artist model (pre-fetched during scan/background)
    const artworkUri = artist.artwork?.trim();

    useEffect(() => {
        setImageFailed(false);
    }, [artist.id, artworkUri]);

    // Get initials for placeholder (memoized)
    const initials = useMemo(() =>
        artist.name
            .split(' ')
            .map(word => word[0])
            .join('')
            .slice(0, 2)
            .toUpperCase(),
        [artist.name]
    );

    // Determine radius based on theme
    const borderRadius = cardStyles.variant === 'brutal' ? 0 : cardSize / 2;

    const imageContainerStyle = useMemo(() => {
        const base: any[] = [
            styles.imageContainer,
            {
                backgroundColor: theme.colors.primaryContainer,
                width: cardSize,
                height: cardSize,
                borderRadius,
                borderWidth: cardStyles.variant === 'brutal' ? globalStyles.borderWidth : 1,
                borderColor: cardStyles.variant === 'brutal'
                    ? globalStyles.borderColor
                    : (isMaterial3 ? `${theme.colors.outline}66` : 'rgba(255,255,255,0.1)'),
                shadowColor: isMaterial3 ? theme.colors.shadow : 'transparent',
                shadowOffset: { width: 0, height: isMaterial3 ? 6 : 0 },
                shadowOpacity: isMaterial3 ? 0.14 : 0,
                shadowRadius: isMaterial3 ? 10 : 0,
                elevation: isMaterial3 ? 4 : 0,
            }
        ];

        if (cardStyles.variant === 'brutal') {
            base.push({
                shadowColor: '#000',
                shadowOffset: { width: 4, height: 4 },
                shadowOpacity: 1,
                shadowRadius: 0,
                elevation: 4,
            });
        }

        return base;
    }, [theme.colors.primaryContainer, cardSize, borderRadius, cardStyles.variant, globalStyles.borderWidth, globalStyles.borderColor, isMaterial3, theme.colors.outline, theme.colors.shadow]);

    const containerWidth = useMemo(() => ({ width: cardSize }), [cardSize]);

    return (
        <Pressable
            onPress={() => onPress(artist)}
            style={({ pressed }) => [
                styles.container,
                containerWidth,
                pressed && styles.pressed,
            ]}
        >
            <View style={imageContainerStyle}>
                {artworkUri && !imageFailed ? (
                    <ExpoImage
                        source={{ uri: artworkUri }}
                        style={styles.image}
                        contentFit="cover"
                        recyclingKey={artist.id}
                        cachePolicy="memory-disk"
                        transition={0}
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <Text
                        style={[
                            styles.initials,
                            {
                                color: theme.colors.onPrimaryContainer,
                                fontSize: cardSize * 0.3,
                                fontFamily: theme.typography.fontFamily.bold
                            }
                        ]}
                    >
                        {initials}
                    </Text>
                )}
            </View>

            <View style={styles.info}>
                <Text
                    variant="bodyMedium"
                    numberOfLines={1}
                    style={[
                        styles.name,
                        {
                            color: theme.colors.onSurface,
                            fontFamily: theme.typography.fontFamily.bold,
                            textTransform: cardStyles.variant === 'brutal' ? 'uppercase' : 'none'
                        }
                    ]}
                >
                    {artist.name}
                </Text>
                <Text
                    variant="bodySmall"
                    style={{
                        color: theme.colors.onSurfaceVariant,
                        textAlign: 'center',
                        fontFamily: theme.typography.fontFamily.regular
                    }}
                >
                    {artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}
                </Text>
            </View>
        </Pressable>
    );
}

// Custom comparator: only re-render if visual data changes
function arePropsEqual(prev: ArtistCardProps, next: ArtistCardProps): boolean {
    return (
        prev.artist.id === next.artist.id &&
        prev.artist.name === next.artist.name &&
        prev.artist.artwork === next.artist.artwork &&
        prev.artist.albumCount === next.artist.albumCount &&
        prev.size === next.size
    );
}

export const ArtistCard = React.memo(ArtistCardInner, arePropsEqual);

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        marginBottom: 16,
    },
    pressed: {
        opacity: 0.7,
    },
    imageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    initials: {
        fontWeight: 'bold',
    },
    name: {
        marginTop: 8,
        textAlign: 'center',
    },
    info: {
        width: '100%',
    }
});
