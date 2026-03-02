/**
 * AlbumCard - Card component for album grid display
 *
 * Performance: backgroundColor for the artwork placeholder is driven by a
 * Reanimated SharedValue (surfaceVariant) so dynamic-color changes cross-fade
 * smoothly on the UI thread without a React re-render.
 * Custom React.memo comparator to prevent unnecessary re-renders.
 */

import { useAnimatedColors, useTheme } from '@/src/theme';
import { Album } from '@/src/types';
import { Image as ExpoImage } from 'expo-image';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

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

function AlbumCardInner({ album, size = 'medium', onPress }: AlbumCardProps) {
    const { theme } = useTheme();
    const aC = useAnimatedColors();
    const isMaterial3 = theme.id.startsWith('material3');
    const cardSize = SIZES[size];

    const cardStyles = theme.components.card;
    const globalStyles = theme.components.global;

    // Static layout / border / shadow — backgroundColor excluded (handled by animatedArtworkStyle).
    const artworkStyle = useMemo(() => {
        const base: any[] = [
            styles.artwork,
            {
                width: cardSize,
                height: cardSize,
                borderRadius: cardStyles.imageRadius,
                borderWidth: cardStyles.variant === 'brutal' ? globalStyles.borderWidth : (isMaterial3 ? 1 : 0),
                borderColor: cardStyles.variant === 'brutal' ? globalStyles.borderColor : (isMaterial3 ? `${theme.colors.outline}55` : globalStyles.borderColor),
                overflow: 'hidden' as const,
                shadowColor: isMaterial3 ? theme.colors.shadow : 'transparent',
                shadowOffset: { width: 0, height: isMaterial3 ? 8 : 0 },
                shadowOpacity: isMaterial3 ? 0.16 : 0,
                shadowRadius: isMaterial3 ? 12 : 0,
                elevation: isMaterial3 ? 5 : 0,
            }
        ];

        if (cardStyles.variant === 'brutal') {
            base.push({
                shadowColor: '#000',
                shadowOffset: { width: 6, height: 6 },
                shadowOpacity: 1,
                shadowRadius: 0,
                elevation: 6,
            });
        }

        return base;
    }, [cardSize, cardStyles.imageRadius, cardStyles.variant, globalStyles.borderWidth, globalStyles.borderColor, isMaterial3, theme.colors.outline, theme.colors.shadow]);

    // Animated background — UI-thread worklet, zero JS overhead during scroll.
    const animatedArtworkStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.surfaceVariant.value,
    }));

    const containerWidth = useMemo(() => ({ width: cardSize }), [cardSize]);

    const infoAlign = useMemo(() => ({
        alignItems: cardStyles.textAlign === 'center' ? 'center' as const : 'flex-start' as const,
    }), [cardStyles.textAlign]);

    // Animated text colors — cross-fade in sync with the background
    const animatedNameStyle = useAnimatedStyle(() => ({
        color: aC.onSurface.value,
    }));
    const animatedSubtitleStyle = useAnimatedStyle(() => ({
        color: aC.onSurfaceVariant.value,
    }));

    return (
        <Pressable
            onPress={() => onPress(album)}
            style={({ pressed }) => [
                styles.container,
                containerWidth,
                pressed && styles.pressed,
            ]}
        >
            <Animated.View style={[artworkStyle, animatedArtworkStyle]}>
                {album.artwork || album.artworkThumb ? (
                    <ExpoImage
                        source={{ uri: album.artworkThumb || album.artwork }}
                        style={styles.artworkImage}
                        contentFit="cover"
                        recyclingKey={album.id}
                        cachePolicy="memory-disk"
                        transition={0}
                    />
                ) : (
                    <Text style={{ fontSize: cardSize * 0.3 }}>💿</Text>
                )}
            </Animated.View>

            <View style={[styles.info, infoAlign]}>
                <Animated.Text
                    numberOfLines={1}
                    style={[
                        styles.name,
                        {
                            fontFamily: theme.typography.fontFamily.bold,
                            textAlign: cardStyles.textAlign as any,
                        },
                        animatedNameStyle,
                    ]}
                >
                    {album.name}
                </Animated.Text>
                <Animated.Text
                    numberOfLines={1}
                    style={[
                        styles.subtitle,
                        {
                            fontFamily: theme.typography.fontFamily.regular,
                            textAlign: cardStyles.textAlign as any,
                        },
                        animatedSubtitleStyle,
                    ]}
                >
                    {album.artist}
                </Animated.Text>
            </View>
        </Pressable>
    );
}

// Custom comparator: only re-render if visual data changes
function arePropsEqual(prev: AlbumCardProps, next: AlbumCardProps): boolean {
    return (
        prev.album.id === next.album.id &&
        prev.album.name === next.album.name &&
        prev.album.artist === next.album.artist &&
        prev.album.artwork === next.album.artwork &&
        prev.album.artworkThumb === next.album.artworkThumb &&
        prev.size === next.size
    );
}

export const AlbumCard = React.memo(AlbumCardInner, arePropsEqual);

const styles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    pressed: {
        opacity: 0.7,
    },
    artwork: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    info: {
        marginTop: 12,
        paddingHorizontal: 2,
    },
    name: {
        fontSize: 14,
        fontWeight: '600',
    },
    subtitle: {
        fontSize: 12,
    },
});
