/**
 * AlbumCard - Card component for album grid display
 *
 * Performance: backgroundColor for the artwork placeholder is driven by a
 * Reanimated SharedValue (surfaceVariant) so dynamic-color changes cross-fade
 * smoothly on the UI thread without a React re-render.
 * Custom React.memo comparator to prevent unnecessary re-renders.
 */

import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Album } from '@/src/types';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { CustomIcon } from './CustomIcon';

interface AlbumCardProps {
    album: Album;
    size?: 'small' | 'medium' | 'large' | 'full';
    height?: number;
    presentation?: 'overlay' | 'stacked';
    onPress: (album: Album) => void;
}

const SIZES = {
    small: 100,
    medium: 150,
    large: 180,
    full: '100%' as any,
};

function AlbumCardInner({ album, size = 'medium', height: customHeight, presentation = 'overlay', onPress }: AlbumCardProps) {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const aC = useAnimatedColors();
    const isMaterial3 = theme.id.startsWith('material3');
    const cardWidth = SIZES[size as keyof typeof SIZES] || SIZES.medium;
    const isStacked = presentation === 'stacked';

    const cardStyles = theme.components.card;
    const globalStyles = theme.components.global;

    // Static layout / border / shadow — backgroundColor excluded (handled by animatedArtworkStyle).
    const artworkStyle = useMemo(() => {
        const base: any[] = [
            styles.artwork,
            {
                width: cardWidth,
                height: customHeight || cardWidth,
                borderRadius: isStacked ? 16 : cardStyles.imageRadius,
                borderWidth: cardStyles.variant === 'brutal' ? globalStyles.borderWidth : 0,
                borderColor: cardStyles.variant === 'brutal' ? globalStyles.borderColor : 'transparent',
                overflow: 'hidden' as const,
                shadowColor: 'transparent',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0,
                shadowRadius: 0,
                elevation: 0,
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
    }, [cardWidth, customHeight, cardStyles.imageRadius, cardStyles.variant, globalStyles.borderWidth, globalStyles.borderColor, isMaterial3, isStacked, theme.colors.outline, theme.colors.shadow]);

    // Animated background — UI-thread worklet, zero JS overhead during scroll.
    const animatedArtworkStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.surfaceVariant.value,
    }));

    const containerWidthStyle = useMemo(() => ({ width: cardWidth }), [cardWidth]);

    const infoAlign = useMemo(() => ({
        alignItems: cardStyles.textAlign === 'center' ? 'center' as const : 'flex-start' as const,
    }), [cardStyles.textAlign]);

    const animatedNameStyle = useAnimatedStyle(() => ({
        color: aC.onSurface.value,
    }));
    const animatedSubtitleStyle = useAnimatedStyle(() => ({
        color: aC.onSurfaceVariant.value,
        opacity: 0.76,
    }));

    return (
        <Pressable
            onPress={() => onPress(album)}
            style={({ pressed }) => [
                styles.container,
                containerWidthStyle,
                isStacked && styles.stackedContainer,
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
                        cachePolicy={performanceProfile.imageCachePolicyList}
                        transition={0}
                    />
                ) : (
                    <CustomIcon name="Album" size={cardWidth === '100%' ? 60 : (cardWidth as number) * 0.4} color={theme.colors.primary} />
                )}

                {!isStacked ? (
                    <View style={styles.infoOverlay}>
                        <LinearGradient
                            colors={['transparent', 'rgba(8,11,18,0.18)', 'rgba(8,11,18,0.72)']}
                            style={StyleSheet.absoluteFill}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                        />

                        <View style={[styles.info, infoAlign]}>
                            <Animated.Text
                                numberOfLines={1}
                                style={[
                                    styles.name,
                                    {
                                        fontFamily: theme.typography.fontFamily.bold,
                                        textAlign: cardStyles.textAlign as any,
                                        color: '#FFFFFF'
                                    },
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
                                        color: 'rgba(255,255,255,0.7)'
                                    },
                                ]}
                            >
                                {album.artist}
                            </Animated.Text>
                        </View>
                    </View>
                ) : null}
            </Animated.View>

            {isStacked ? (
                <View style={styles.stackedInfo}>
                    <Animated.Text
                        numberOfLines={2}
                        style={[
                            styles.stackedName,
                            animatedNameStyle,
                            {
                                fontFamily: theme.typography.fontFamily.bold,
                            },
                        ]}
                    >
                        {album.name}
                    </Animated.Text>
                    <Animated.Text
                        numberOfLines={1}
                        style={[
                            styles.stackedSubtitle,
                            animatedSubtitleStyle,
                            {
                                fontFamily: theme.typography.fontFamily.regular,
                            },
                        ]}
                    >
                        {album.artist}
                    </Animated.Text>
                </View>
            ) : null}
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
    stackedContainer: {
        marginBottom: 20,
    },
    pressed: {
        opacity: 0.82,
    },
    artwork: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    infoOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 2,
    },
    info: {
        paddingTop: 18,
        paddingBottom: 12,
        paddingHorizontal: 12,
    },
    name: {
        ...typeScale.bodyStrong,
        fontWeight: '700',
        letterSpacing: -0.1,
    },
    subtitle: {
        ...typeScale.label,
        marginTop: 2,
        opacity: 0.9,
    },
    stackedInfo: {
        paddingTop: 10,
        paddingHorizontal: 2,
    },
    stackedName: {
        ...typeScale.bodyStrong,
        letterSpacing: -0.15,
        lineHeight: 18,
    },
    stackedSubtitle: {
        ...typeScale.caption,
        marginTop: 3,
    },
});
