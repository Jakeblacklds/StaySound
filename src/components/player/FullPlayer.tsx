/**
 * FullPlayer - Full-screen player with dynamic colors
 * 
 * Extracts colors from album artwork and creates a premium,
 * immersive player experience.
 */

import { useDynamicColors } from '@/src/hooks';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Dimensions, Image, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
    FadeIn,
    SlideInDown,
    useAnimatedStyle,
    useSharedValue,
    withSpring
} from 'react-native-reanimated';
import { ProgressSlider } from './ProgressSlider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ARTWORK_SIZE = SCREEN_WIDTH - 80;

export function FullPlayer() {
    const { theme, isDark } = useTheme();
    const {
        currentTrack,
        isPlaying,
        position,
        shuffleEnabled,
        repeatMode,
        togglePlayPause,
        next,
        previous,
        seek,
        toggleShuffle,
        cycleRepeatMode,
    } = usePlayerStore();

    // Extract colors from artwork
    const { colors: albumColors, isLoading: colorsLoading } = useDynamicColors(currentTrack?.artwork);

    // Use album colors for the player UI
    const playerColors = useMemo(() => ({
        background: albumColors.background,
        primary: albumColors.primary,
        text: albumColors.text,
        textSecondary: albumColors.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
        accent: albumColors.accent,
        gradientStart: albumColors.background,
        gradientEnd: albumColors.isDark
            ? `${albumColors.background}00`
            : `${albumColors.background}00`,
    }), [albumColors]);

    const playButtonScale = useSharedValue(1);

    if (!currentTrack) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>No track playing</Text>
            </View>
        );
    }

    const handlePlayPress = () => {
        playButtonScale.value = withSpring(0.9, {}, () => {
            playButtonScale.value = withSpring(1);
        });
        togglePlayPause();
    };

    const playButtonStyle = useAnimatedStyle(() => ({
        transform: [{ scale: playButtonScale.value }],
    }));

    const repeatIcon = repeatMode === 'off'
        ? 'repeat-off'
        : repeatMode === 'one'
            ? 'repeat-once'
            : 'repeat';

    return (
        <View style={[styles.container, { backgroundColor: playerColors.background }]}>
            <StatusBar barStyle={albumColors.isDark ? 'light-content' : 'dark-content'} />

            {/* Dynamic gradient background */}
            <LinearGradient
                colors={[
                    playerColors.primary + '40',
                    playerColors.background,
                    playerColors.background,
                ]}
                style={StyleSheet.absoluteFill}
                locations={[0, 0.4, 1]}
            />

            {/* Artwork blur overlay for extra depth */}
            {currentTrack.artwork && (
                <View style={[StyleSheet.absoluteFill, styles.artworkBlurContainer]}>
                    <Image
                        source={{ uri: currentTrack.artwork }}
                        style={styles.backgroundImage}
                        blurRadius={50}
                    />
                    <View style={[
                        styles.overlay,
                        { backgroundColor: playerColors.background + 'CC' }
                    ]} />
                </View>
            )}

            {/* Header */}
            <Animated.View
                entering={FadeIn.delay(100)}
                style={styles.header}
            >
                <IconButton
                    icon="chevron-down"
                    size={28}
                    iconColor={playerColors.text}
                    onPress={() => router.back()}
                />
                <View style={styles.headerCenter}>
                    <Text
                        variant="labelMedium"
                        style={{ color: playerColors.textSecondary }}
                    >
                        PLAYING FROM
                    </Text>
                    <Text
                        variant="bodyMedium"
                        numberOfLines={1}
                        style={{ color: playerColors.text, fontWeight: '600' }}
                    >
                        {currentTrack.album}
                    </Text>
                </View>
                <IconButton
                    icon="dots-vertical"
                    size={24}
                    iconColor={playerColors.text}
                    onPress={() => { }}
                />
            </Animated.View>

            {/* Album Art with glow effect */}
            <Animated.View
                entering={SlideInDown.delay(200).springify()}
                style={styles.artworkContainer}
            >
                {/* Glow effect */}
                <View style={[
                    styles.artworkGlow,
                    {
                        backgroundColor: playerColors.primary,
                        shadowColor: playerColors.primary,
                    }
                ]} />

                <View
                    style={[
                        styles.artwork,
                        {
                            backgroundColor: theme.colors.surfaceVariant,
                        }
                    ]}
                >
                    {currentTrack.artwork ? (
                        <Image
                            source={{ uri: currentTrack.artwork }}
                            style={styles.artworkImage}
                        />
                    ) : (
                        <Text style={{ fontSize: ARTWORK_SIZE * 0.3 }}>🎵</Text>
                    )}
                </View>
            </Animated.View>

            {/* Track Info */}
            <Animated.View
                entering={FadeIn.delay(300)}
                style={styles.trackInfo}
            >
                <View style={styles.titleRow}>
                    <View style={styles.titleContainer}>
                        <Text
                            variant="headlineSmall"
                            numberOfLines={1}
                            style={[styles.title, { color: playerColors.text }]}
                        >
                            {currentTrack.title}
                        </Text>
                        <Text
                            variant="bodyLarge"
                            numberOfLines={1}
                            style={{ color: playerColors.textSecondary }}
                        >
                            {currentTrack.artist}
                        </Text>
                    </View>
                    <IconButton
                        icon="heart-outline"
                        size={24}
                        iconColor={playerColors.textSecondary}
                        onPress={() => { }}
                    />
                </View>
            </Animated.View>

            {/* Progress */}
            <View style={styles.progressContainer}>
                <ProgressSlider
                    position={position}
                    duration={currentTrack.duration}
                    onSeek={seek}
                    activeColor={playerColors.primary}
                    inactiveColor={playerColors.textSecondary + '40'}
                    textColor={playerColors.textSecondary}
                />
            </View>

            {/* Main Controls */}
            <Animated.View
                entering={FadeIn.delay(400)}
                style={styles.controls}
            >
                <IconButton
                    icon={shuffleEnabled ? "shuffle" : "shuffle-disabled"}
                    size={24}
                    iconColor={shuffleEnabled ? playerColors.primary : playerColors.textSecondary}
                    onPress={toggleShuffle}
                />

                <IconButton
                    icon="skip-previous"
                    size={36}
                    iconColor={playerColors.text}
                    onPress={previous}
                />

                <Animated.View style={playButtonStyle}>
                    <View style={[
                        styles.playButtonContainer,
                        { backgroundColor: playerColors.primary }
                    ]}>
                        <IconButton
                            icon={isPlaying ? "pause" : "play"}
                            size={36}
                            iconColor={albumColors.isDark ? '#000000' : '#FFFFFF'}
                            onPress={handlePlayPress}
                        />
                    </View>
                </Animated.View>

                <IconButton
                    icon="skip-next"
                    size={36}
                    iconColor={playerColors.text}
                    onPress={next}
                />

                <IconButton
                    icon={repeatIcon}
                    size={24}
                    iconColor={repeatMode !== 'off' ? playerColors.primary : playerColors.textSecondary}
                    onPress={cycleRepeatMode}
                />
            </Animated.View>

            {/* Bottom actions */}
            <View style={styles.bottomActions}>
                <IconButton
                    icon="devices"
                    size={20}
                    iconColor={playerColors.textSecondary}
                    onPress={() => { }}
                />
                <IconButton
                    icon="playlist-music"
                    size={20}
                    iconColor={playerColors.textSecondary}
                    onPress={() => { }}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: StatusBar.currentHeight || 44,
    },
    artworkBlurContainer: {
        opacity: 0.3,
    },
    backgroundImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        height: 56,
    },
    headerCenter: {
        flex: 1,
        alignItems: 'center',
    },
    artworkContainer: {
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 32,
    },
    artworkGlow: {
        position: 'absolute',
        width: ARTWORK_SIZE - 20,
        height: ARTWORK_SIZE - 20,
        borderRadius: 20,
        top: 20,
        opacity: 0.4,
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.8,
        shadowRadius: 30,
        elevation: 20,
    },
    artwork: {
        width: ARTWORK_SIZE,
        height: ARTWORK_SIZE,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    trackInfo: {
        paddingHorizontal: 32,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    titleContainer: {
        flex: 1,
    },
    title: {
        fontWeight: 'bold',
    },
    progressContainer: {
        paddingHorizontal: 32,
        marginTop: 16,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 16,
        gap: 8,
    },
    playButtonContainer: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 32,
        marginTop: 'auto',
        marginBottom: 32,
    },
});
