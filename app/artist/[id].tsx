/**
 * Artist Detail Screen - Shows artist info with albums and top songs
 */

import { AlbumCard, ArtistAbout, CustomIcon, MemoizedTrackListItem } from '@/src/components/ui';
import { TidalAtmosphere } from '@/src/components/tidal';
import { useArtistInfo, useDynamicColors } from '@/src/hooks';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Album, Track } from '@/src/types';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BACK_BUTTON_TOP_OFFSET = 10;

export default function ArtistDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const getArtistById = useLibraryStore(state => state.getArtistById);
    const getTracksByArtist = useLibraryStore(state => state.getTracksByArtist);
    const getAlbumsByArtist = useLibraryStore(state => state.getAlbumsByArtist);

    const play = usePlayerStore(state => state.play);
    const currentTrackId = usePlayerStore(state => state.currentTrack?.id);

    const artist = getArtistById(id);
    const tracks = useMemo(() => getTracksByArtist(id), [id, getTracksByArtist]);
    const albums = useMemo(() => getAlbumsByArtist(id), [id, getAlbumsByArtist]);

    // Fetch dynamic info (artwork/bio)
    const { info: artistInfo } = useArtistInfo(artist?.name || undefined);
    const artworkUri = artist?.artwork || artistInfo?.photo_url || undefined;

    // Extract dynamic colors from artist artwork
    const { colors: artistColors } = useDynamicColors(artworkUri);

    // Show top 5 songs
    const topTracks = tracks.slice(0, 5);

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const handleAlbumPress = useCallback((album: Album) => {
        router.push({ pathname: '/album/[id]', params: { id: album.id } });
    }, []);

    if (!artist) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Artist not found</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle={artistColors.isDark ? 'light-content' : 'dark-content'} />
            <TidalAtmosphere sourceUri={artworkUri} mode={artworkUri ? 'artwork' : 'tint'} />

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + BACK_BUTTON_TOP_OFFSET }]}>
                <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
                    <IconButton
                        icon={() => <CustomIcon name="Previous" size={24} color={artistColors.text} />}
                        size={24}
                        onPress={() => router.back()}
                    />
                </BlurView>
            </View>

            {/* Content */}
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: insets.top + 72 }
                ]}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeIn.delay(120)} style={styles.artistHero}>
                    <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceVariant }]}>
                        {artworkUri ? (
                            <Image source={{ uri: artworkUri }} style={styles.avatarImage} />
                        ) : (
                            <CustomIcon name="Artista" size={72} color={theme.colors.onSurfaceVariant} />
                        )}
                    </View>
                    <View style={styles.artistInfo}>
                        <Text style={[styles.artistKicker, { color: artistColors.primary }]}>ARTISTA</Text>
                        <Text style={[styles.artistName, { color: artistColors.text }]} numberOfLines={3}>
                            {artist.name}
                        </Text>
                        <Text style={[styles.artistMeta, { color: artistColors.isDark ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.56)' }]}>
                            {tracks.length} canciones · {albums.length} álbumes
                        </Text>
                        {topTracks[0] ? (
                            <Pressable
                                onPress={() => handleTrackPress(topTracks[0])}
                                style={[styles.artistPlayButton, { backgroundColor: artistColors.primary }]}
                            >
                                <CustomIcon name="Play" size={18} color={artistColors.onPrimary} />
                                <Text style={[styles.artistPlayLabel, { color: artistColors.onPrimary }]}>Reproducir</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </Animated.View>

                {/* Top Songs */}
                {topTracks.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(300)} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text
                                variant="titleMedium"
                                style={[styles.sectionTitle, { color: artistColors.text }]}
                            >
                                Top Songs
                            </Text>
                        </View>

                        {topTracks.map((track, index) => (
                            <Animated.View
                                key={track.id}
                                entering={FadeInRight.delay(400 + index * 50)}
                            >
                                <MemoizedTrackListItem
                                    track={track}
                                    index={index}
                                    showIndex={true}
                                    isPlaying={currentTrackId === track.id}
                                    onPress={handleTrackPress}
                                />
                            </Animated.View>
                        ))}
                    </Animated.View>
                )}

                {/* Albums */}
                {albums.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(500)} style={styles.section}>
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
                                    entering={FadeInRight.delay(600 + index * 100)}
                                    style={styles.albumWrapper}
                                >
                                    <AlbumCard
                                        album={album}
                                        size="medium"
                                        presentation="stacked"
                                        onPress={handleAlbumPress}
                                    />
                                </Animated.View>
                            ))}
                        </ScrollView>
                    </Animated.View>
                )}

                {/* About Section */}
                <ArtistAbout artistName={artist.name} accentColor={artistColors.primary} />

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    avatar: {
        width: '45%',
        aspectRatio: 1,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.22)',
        elevation: 10,
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
    artistHero: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        paddingHorizontal: 18,
        marginBottom: 38,
    },
    artistInfo: {
        flex: 1,
        alignItems: 'flex-start',
    },
    artistKicker: {
        letterSpacing: 1.4,
        marginBottom: 8,
    },
    artistName: {
        fontSize: 31,
        lineHeight: 32,
        fontWeight: '900',
        textAlign: 'left',
        letterSpacing: -1.25,
    },
    artistMeta: {
        marginTop: 8,
        fontSize: 11,
        lineHeight: 15,
    },
    artistPlayButton: {
        minHeight: 40,
        marginTop: 14,
        paddingHorizontal: 14,
        borderRadius: 15,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    artistPlayLabel: {
        fontSize: 12,
        fontWeight: '900',
    },
    section: {
        marginBottom: 36,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        marginBottom: 14,
    },
    sectionTitle: {
        fontWeight: '800',
        letterSpacing: -0.45,
        fontSize: 20,
    },
    albumsScroll: {
        paddingHorizontal: 24,
        gap: 10,
    },
    albumWrapper: {
        width: 148,
    },
});
