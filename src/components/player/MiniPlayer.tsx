/**
 * MiniPlayer - Floating player bar at bottom of screen with dynamic colors
 */

import { useDynamicColors } from '@/src/hooks';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MiniPlayer() {
    const { theme } = useTheme();
    const {
        currentTrack,
        isPlaying,
        togglePlayPause,
        next,
        position
    } = usePlayerStore();

    // Extract colors from artwork
    const { colors: albumColors } = useDynamicColors(currentTrack?.artwork);

    // Dynamic colors for the mini player
    const playerColors = useMemo(() => ({
        background: albumColors.background,
        primary: albumColors.primary,
        text: albumColors.text,
        textSecondary: albumColors.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
    }), [albumColors]);

    const scale = useSharedValue(1);

    // Don't render if no track
    if (!currentTrack) return null;

    const handlePress = () => {
        (router as any).push('/player');
    };

    const handlePressIn = () => {
        scale.value = withSpring(0.98);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1);
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    // Calculate progress percentage
    const progress = currentTrack.duration > 0
        ? (position / currentTrack.duration) * 100
        : 0;

    return (
        <AnimatedPressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[
                styles.container,
                { backgroundColor: playerColors.background },
                animatedStyle,
            ]}
        >
            {/* Subtle glow effect */}
            <View style={[
                styles.glowEffect,
                { backgroundColor: playerColors.primary + '20' }
            ]} />

            {/* Progress bar at top */}
            <View style={[styles.progressBar, { backgroundColor: playerColors.textSecondary + '30' }]}>
                <View
                    style={[
                        styles.progressFill,
                        {
                            backgroundColor: playerColors.primary,
                            width: `${progress}%`,
                        }
                    ]}
                />
            </View>

            <View style={styles.content}>
                {/* Album Art */}
                <View style={[styles.artwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                    {currentTrack.artwork ? (
                        <Image
                            source={{ uri: currentTrack.artwork }}
                            style={styles.artworkImage}
                        />
                    ) : (
                        <Text style={{ fontSize: 20 }}>🎵</Text>
                    )}
                </View>

                {/* Track Info */}
                <View style={styles.info}>
                    <Text
                        variant="bodyMedium"
                        numberOfLines={1}
                        style={[styles.title, { color: playerColors.text }]}
                    >
                        {currentTrack.title}
                    </Text>
                    <Text
                        variant="bodySmall"
                        numberOfLines={1}
                        style={{ color: playerColors.textSecondary }}
                    >
                        {currentTrack.artist}
                    </Text>
                </View>

                {/* Controls */}
                <View style={styles.controls}>
                    <IconButton
                        icon={isPlaying ? "pause" : "play"}
                        size={28}
                        iconColor={playerColors.text}
                        onPress={(e) => {
                            e.stopPropagation?.();
                            togglePlayPause();
                        }}
                    />
                    <IconButton
                        icon="skip-next"
                        size={24}
                        iconColor={playerColors.textSecondary}
                        onPress={(e) => {
                            e.stopPropagation?.();
                            next();
                        }}
                    />
                </View>
            </View>
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 85, // Above tab bar
        left: 8,
        right: 8,
        borderRadius: 12,
        overflow: 'hidden',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    glowEffect: {
        ...StyleSheet.absoluteFillObject,
    },
    progressBar: {
        height: 2,
        width: '100%',
    },
    progressFill: {
        height: '100%',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        paddingLeft: 12,
    },
    artwork: {
        width: 48,
        height: 48,
        borderRadius: 8,
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
        fontWeight: '600',
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});
