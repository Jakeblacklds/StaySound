/**
 * AlbumCard - Card component for album grid display
 * 
 * Performance: No Reanimated — uses native Pressable opacity for press feedback.
 * No transition animation on images in list context (causes frame drops).
 * Custom React.memo comparator to prevent unnecessary re-renders.
 */

import { useTheme } from '@/src/theme';
import { Album } from '@/src/types';
import { Image as ExpoImage } from 'expo-image';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

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
    const isMaterial3 = theme.id.startsWith('material3');
    const cardSize = SIZES[size];

    const cardStyles = theme.components.card;
    const globalStyles = theme.components.global;

    const artworkStyle = useMemo(() => {
        const base: any[] = [
            styles.artwork,
            {
                backgroundColor: theme.colors.surfaceVariant,
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
    }, [theme.colors.surfaceVariant, cardSize, cardStyles.imageRadius, cardStyles.variant, globalStyles.borderWidth, globalStyles.borderColor, isMaterial3, theme.colors.outline, theme.colors.shadow]);

    const containerWidth = useMemo(() => ({ width: cardSize }), [cardSize]);

    const infoAlign = useMemo(() => ({
        alignItems: cardStyles.textAlign === 'center' ? 'center' as const : 'flex-start' as const,
    }), [cardStyles.textAlign]);

    return (
        <Pressable
            onPress={() => onPress(album)}
            style={({ pressed }) => [
                styles.container,
                containerWidth,
                pressed && styles.pressed,
            ]}
        >
            <View style={artworkStyle}>
                {album.artwork ? (
                    <ExpoImage
                        source={{ uri: album.artwork }}
                        style={styles.artworkImage}
                        contentFit="cover"
                        recyclingKey={album.id}
                        cachePolicy="memory-disk"
                        transition={0}
                    />
                ) : (
                    <Text style={{ fontSize: cardSize * 0.3 }}>💿</Text>
                )}
            </View>

            <View style={[styles.info, infoAlign]}>
                <Text
                    variant="bodyMedium"
                    numberOfLines={1}
                    style={[
                        styles.name,
                        {
                            color: theme.colors.onSurface,
                            fontFamily: theme.typography.fontFamily.bold,
                            textAlign: cardStyles.textAlign as any
                        }
                    ]}
                >
                    {album.name}
                </Text>
                <Text
                    variant="bodySmall"
                    numberOfLines={1}
                    style={{
                        color: theme.colors.onSurfaceVariant,
                        fontFamily: theme.typography.fontFamily.regular,
                        textAlign: cardStyles.textAlign as any
                    }}
                >
                    {album.artist}
                </Text>
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
    },
});
