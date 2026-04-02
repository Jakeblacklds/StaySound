/**
 * ArtistCard - Card component for artist display
 * 
 * Performance: No Reanimated — uses native Pressable opacity for press feedback.
 * NO useArtistInfo hook here — network requests inside list items kill scroll perf.
 * Artist info (photos, bios) should be pre-fetched and stored in the Artist model.
 * For the grid listing, we show local data only (initials or cached artwork).
 */

import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Artist } from '@/src/types';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { CustomIcon } from './CustomIcon';

interface ArtistCardProps {
    artist: Artist;
    size?: 'small' | 'medium' | 'large' | 'full';
    height?: number;
    presentation?: 'overlay' | 'masonry';
    onPress: (artist: Artist) => void;
}

const SIZES = {
    small: 80,
    medium: 120,
    large: 150,
    full: '100%' as any,
};

function ArtistCardInner({ artist, size = 'medium', height: customHeight, presentation = 'overlay', onPress }: ArtistCardProps) {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const aC = useAnimatedColors();
    const isMaterial3 = theme.id.startsWith('material3');
    const cardSize = SIZES[size as keyof typeof SIZES] || SIZES.medium;
    const [imageFailed, setImageFailed] = useState(false);
    const isMasonry = presentation === 'masonry';

    const cardStyles = theme.components.card;
    const globalStyles = theme.components.global;

    // Use artwork already stored in the Artist model (pre-fetched during scan/background)
    const artworkUri = artist.artwork?.trim();

    useEffect(() => {
        setImageFailed(false);
    }, [artist.id, artworkUri]);

    // Determine radius based on theme - matching the premium Tidal card look
    const borderRadius = cardStyles.variant === 'brutal' ? 0 : (isMasonry ? 22 : 28);

    const imageContainerStyle = useMemo(() => {
        const base: any[] = [
            styles.imageContainer,
            {
                // backgroundColor excluded — driven by animatedCircleStyle
                width: cardSize,
                height: customHeight || cardSize,
                borderRadius,
                borderWidth: cardStyles.variant === 'brutal' ? globalStyles.borderWidth : 0,
                borderColor: cardStyles.variant === 'brutal'
                    ? globalStyles.borderColor
                    : 'transparent',
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
                shadowOffset: { width: 4, height: 4 },
                shadowOpacity: 1,
                shadowRadius: 0,
                elevation: 4,
            });
        }

        return base;
    }, [cardSize, customHeight, borderRadius, cardStyles.variant, globalStyles.borderWidth, globalStyles.borderColor, isMaterial3, theme.colors.outline, theme.colors.shadow]);

    // Animated circle background + initials color — UI-thread worklets, zero JS
    // overhead during scroll. Only executes during the 700ms color transition.
    const animatedCircleStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.primaryContainer.value,
    }));

    // Artist name / subtitle text colors — cross-fade with the background
    const animatedNameStyle = useAnimatedStyle(() => ({
        color: aC.onSurface.value,
    }));
    const animatedCountStyle = useAnimatedStyle(() => ({
        color: aC.onSurfaceVariant.value,
        opacity: 0.72,
    }));

    const containerStyle = useMemo(() => ([
        styles.container,
        { width: cardSize }
    ]), [cardSize]);

    return (
        <Pressable
            onPress={() => onPress(artist)}
            style={({ pressed }) => [
                containerStyle,
                isMasonry && styles.masonryContainer,
                pressed && styles.pressed,
            ]}
        >
            <Animated.View style={[imageContainerStyle, animatedCircleStyle]}>
                {artworkUri && !imageFailed ? (
                    <ExpoImage
                        source={{ uri: artworkUri }}
                        style={styles.image}
                        contentFit="cover"
                        recyclingKey={artist.id}
                        cachePolicy={performanceProfile.imageCachePolicyList}
                        transition={0}
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <CustomIcon name="Artista" size={cardSize * 0.5} color={aC.onPrimaryContainer.value} />
                )}

                <View style={styles.infoOverlay}>
                    {performanceProfile.enableBlurEffects ? (
                        <BlurView
                            intensity={isMasonry ? 12 : 20}
                            tint="dark"
                            style={StyleSheet.absoluteFill}
                        />
                    ) : null}
                    <LinearGradient
                        colors={isMasonry
                            ? ['transparent', 'rgba(8,11,18,0.14)', 'rgba(8,11,18,0.64)']
                            : ['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                    />

                    <View style={[styles.info, isMasonry && styles.masonryInfo]}>
                        <Animated.Text
                            numberOfLines={isMasonry ? 2 : 1}
                            style={[
                                styles.name,
                                isMasonry && styles.masonryName,
                                {
                                    fontFamily: theme.typography.fontFamily.bold,
                                    textTransform: cardStyles.variant === 'brutal' ? 'uppercase' : 'none',
                                    color: '#FFFFFF'
                                },
                            ]}
                        >
                            {artist.name}
                        </Animated.Text>
                        <Animated.Text
                            style={[
                                styles.albumCount,
                                isMasonry && styles.masonryAlbumCount,
                                {
                                    fontFamily: theme.typography.fontFamily.regular,
                                    color: 'rgba(255,255,255,0.74)'
                                },
                            ]}
                        >
                            {artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}
                        </Animated.Text>
                    </View>
                </View>
            </Animated.View>
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
        marginBottom: 10,
    },
    masonryContainer: {
        marginBottom: 14,
    },
    pressed: {
        opacity: 0.82,
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
    infoOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 10,
    },
    info: {
        width: '100%',
        paddingHorizontal: 8,
    },
    masonryInfo: {
        paddingHorizontal: 12,
        paddingBottom: 6,
    },
    name: {
        ...typeScale.caption,
        textAlign: 'center',
        fontWeight: '600',
    },
    masonryName: {
        ...typeScale.bodyStrong,
        textAlign: 'left',
        lineHeight: 20,
        letterSpacing: -0.2,
    },
    albumCount: {
        ...typeScale.micro,
        textAlign: 'center',
    },
    masonryAlbumCount: {
        ...typeScale.label,
        textAlign: 'left',
        marginTop: 5,
        opacity: 0.82,
    },
});
