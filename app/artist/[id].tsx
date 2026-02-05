/**
 * Artist Detail Screen - Shows artist info with albums and top songs
 */

import { AlbumCard, MemoizedTrackListItem } from '@/src/components/ui';
import { useDynamicColors } from '@/src/hooks';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Album, Track } from '@/src/types';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Dimensions, Image, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_HEIGHT = 280;
const AVATAR_SIZE = 160;

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export default function ArtistDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    const { getArtistById, getTracksByArtist, getAlbumsByArtist } = useLibraryStore();
    const { play, currentTrack } = usePlayerStore();

    const artist = getArtistById(id);
    const tracks = useMemo(() => getTracksByArtist(id), [id, getTracksByArtist]);
    const albums = useMemo(() => getAlbumsByArtist(id), [id, getAlbumsByArtist]);

    // Extract dynamic colors from artist artwork
    const { colors: artistColors } = useDynamicColors(artist?.artwork);

    // Show top 5 songs
    const topTracks = tracks.slice(0, 5);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const headerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT - 100], [1, 0]),
        transform: [
            { translateY: interpolate(scrollY.value, [0, HEADER_HEIGHT], [0, -HEADER_HEIGHT / 2]) },
        ],
    }));

    const avatarStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(scrollY.value, [-100, 0, 100], [1.3, 1, 0.8], 'clamp') },
        ],
        opacity: interpolate(scrollY.value, [0, 150], [1, 0.3]),
    }));

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const handleAlbumPress = useCallback((album: Album) => {
        router.push({ pathname: '/album/[id]', params: { id: album.id } });
    }, []);

    const handlePlayAll = useCallback(() => {
        if (tracks.length > 0) {
            play(tracks[0], tracks);
        }
    }, [tracks, play]);

    const handleShuffle = useCallback(() => {
        if (tracks.length > 0) {
            const randomIndex = Math.floor(Math.random() * tracks.length);
            play(tracks[randomIndex], tracks);
        }
    }, [tracks, play]);

    if (!artist) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Artist not found</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: artistColors.background }]}>
            <StatusBar barStyle={artistColors.isDark ? 'light-content' : 'dark-content'} />

            {/* Gradient Background */}
            <Animated.View style={[StyleSheet.absoluteFill, headerStyle]}>
                <LinearGradient
                    colors={[artistColors.primary + '40', artistColors.background]}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>

            {/* Artist Avatar */}
            <Animated.View style={[styles.avatarContainer, { paddingTop: insets.top + 60 }, avatarStyle]}>
                <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceVariant }]}>
                    {artist.artwork ? (
                        <Image source={{ uri: artist.artwork }} style={styles.avatarImage} />
                    ) : (
                        <Text style={{ fontSize: 64 }}>🎤</Text>
                    )}
                </View>
            </Animated.View>

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + 8 }]}>
                <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
                    <IconButton
                        icon="arrow-left"
                        size={24}
                        iconColor={artistColors.text}
                        onPress={() => router.back()}
                    />
                </BlurView>
            </View>

            {/* Content */}
            <AnimatedScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: HEADER_HEIGHT + 20 }
                ]}
                showsVerticalScrollIndicator={false}
            >
                {/* Artist Info */}
                <Animated.View entering={FadeIn.delay(200)} style={styles.artistInfo}>
                    <Text
                        variant="headlineLarge"
                        style={[styles.artistName, { color: artistColors.text }]}
                    >
                        {artist.name}
                    </Text>
                    <Text
                        variant="bodyMedium"
                        style={{ color: artistColors.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', marginTop: 4 }}
                    >
                        {tracks.length} songs • {albums.length} albums
                    </Text>
                </Animated.View>

                {/* Action Buttons */}
                <Animated.View entering={FadeIn.delay(300)} style={styles.actions}>
                    <Button
                        mode="contained"
                        icon="play"
                        onPress={handlePlayAll}
                        style={[styles.playButton, { backgroundColor: artistColors.primary }]}
                        labelStyle={{ color: artistColors.isDark ? '#000000' : '#FFFFFF' }}
                        contentStyle={styles.playButtonContent}
                    >
                        Play All
                    </Button>
                    <Button
                        mode="contained-tonal"
                        icon="shuffle"
                        onPress={handleShuffle}
                        style={[styles.shuffleButton, { backgroundColor: artistColors.primary + '20' }]}
                        labelStyle={{ color: artistColors.primary }}
                    >
                        Shuffle
                    </Button>
                </Animated.View>

                {/* Top Songs */}
                {topTracks.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(400)} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text
                                variant="titleMedium"
                                style={[styles.sectionTitle, { color: artistColors.text }]}
                            >
                                Top Songs
                            </Text>
                            <Button
                                mode="text"
                                compact
                                labelStyle={{ color: artistColors.primary }}
                                onPress={() => { }}
                            >
                                See All
                            </Button>
                        </View>

                        {topTracks.map((track, index) => (
                            <Animated.View
                                key={track.id}
                                entering={FadeInRight.delay(500 + index * 50)}
                            >
                                <MemoizedTrackListItem
                                    track={track}
                                    index={index}
                                    showIndex={true}
                                    isPlaying={currentTrack?.id === track.id}
                                    onPress={handleTrackPress}
                                />
                            </Animated.View>
                        ))}
                    </Animated.View>
                )}

                {/* Albums */}
                {albums.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(600)} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text
                                variant="titleMedium"
                                style={[styles.sectionTitle, { color: artistColors.text }]}
                            >
                                Albums
                            </Text>
                        </View>

                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.albumsScroll}
                        >
                            {albums.map((album, index) => (
                                <Animated.View
                                    key={album.id}
                                    entering={FadeInRight.delay(700 + index * 100)}
                                    style={styles.albumWrapper}
                                >
                                    <AlbumCard
                                        album={album}
                                        size="medium"
                                        onPress={handleAlbumPress}
                                    />
                                </Animated.View>
                            ))}
                        </ScrollView>
                    </Animated.View>
                )}

                {/* About Section (placeholder for future artist bio) */}
                <Animated.View
                    entering={FadeInDown.delay(800)}
                    style={[styles.aboutCard, { backgroundColor: artistColors.primary + '15' }]}
                >
                    <Text variant="titleSmall" style={{ color: artistColors.primary, marginBottom: 8 }}>
                        ℹ️ About
                    </Text>
                    <Text variant="bodyMedium" style={{ color: artistColors.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }}>
                        Artist information will be loaded from online sources when available.
                    </Text>
                </Animated.View>

            </AnimatedScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    avatarContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
    },
    blurButton: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    content: {
        paddingBottom: 120,
    },
    artistInfo: {
        alignItems: 'center',
        paddingHorizontal: 24,
        marginBottom: 24,
    },
    artistName: {
        fontWeight: 'bold',
        textAlign: 'center',
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 24,
        marginBottom: 32,
    },
    playButton: {
        flex: 1,
        borderRadius: 24,
    },
    playButtonContent: {
        paddingVertical: 6,
    },
    shuffleButton: {
        flex: 1,
        borderRadius: 24,
    },
    section: {
        marginBottom: 32,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        marginBottom: 12,
    },
    sectionTitle: {
        fontWeight: 'bold',
    },
    albumsScroll: {
        paddingHorizontal: 20,
        gap: 12,
    },
    albumWrapper: {
        width: 160,
    },
    aboutCard: {
        marginHorizontal: 24,
        padding: 20,
        borderRadius: 16,
    },
});
