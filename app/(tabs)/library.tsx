/**
 * LibraryScreen - Main library view with tabs for songs, albums, artists, playlists
 * 
 * Performance architecture for 120fps scroll:
 * 1. FlashList v2 recycling tuned with low-overhead item types and draw distance
 * 2. isPlaying check moved INSIDE TrackListItem via separate lightweight subscription
 * 3. Stable key extractors and callbacks via useCallback with minimal deps
 * 4. Tap-to-play prioritizes instant playback start
 * 5. removeClippedSubviews for off-screen view detachment
 */

import { AlbumCard, AlphabetScrubber, ArtistCard, EmptyState, ScanButton, TrackListItem } from '@/src/components/ui';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useAnimatedColors, useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { InteractionManager, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const LIBRARY_TABS = [
    { value: 'songs', label: 'Songs' },
    { value: 'albums', label: 'Albums' },
    { value: 'artists', label: 'Artists' },
] as const;

type LibraryTab = (typeof LIBRARY_TABS)[number]['value'];

// Performance constants (stable for FlashList)
const ESTIMATED_ALBUM_SIZE = 212;
const ESTIMATED_ARTIST_SIZE = 138;
const DEFAULT_TRACK_SIZE = 76;
const TRACK_DRAW_DISTANCE = 160;


export default function LibraryScreen() {
    const { theme } = useTheme();
    const [tab, setTab] = React.useState<LibraryTab>('songs');
    const [searchQuery, setSearchQuery] = React.useState('');

    // Use focused selectors to prevent re-renders on unrelated state changes
    const isScanning = useLibraryStore(s => s.isScanning);
    const scanLibrary = useLibraryStore(s => s.scanLibrary);
    const refreshArtistPhotos = useLibraryStore(s => s.refreshArtistPhotos);
    const ensureArtworkThumbsForTracks = useLibraryStore(s => s.ensureArtworkThumbsForTracks);
    const getAllPlaylists = useLibraryStore(s => s.getAllPlaylists);
    const createPlaylist = useLibraryStore(s => s.createPlaylist);
    const addToPlaylist = useLibraryStore(s => s.addToPlaylist);
    const deleteTrack = useLibraryStore(s => s.deleteTrack);

    // Select the Maps (stable references — only change when library is scanned)
    const tracksMap = useLibraryStore(s => s.tracks);
    const albumsMap = useLibraryStore(s => s.albums);
    const artistsMap = useLibraryStore(s => s.artists);

    // Derive arrays — support both Map and persisted entry arrays during hydration
    const toValues = useCallback(<T,>(source: unknown): T[] => {
        if (source instanceof Map) return Array.from(source.values()) as T[];
        if (Array.isArray(source)) return (source as Array<[string, T]>).map(([, value]) => value);
        return [];
    }, []);

    const tracks = useMemo(() => {
        const values = toValues<Track>(tracksMap as unknown);
        return values.sort((a, b) => a.title.localeCompare(b.title));
    }, [toValues, tracksMap]);

    const albums = useMemo(() => {
        return toValues<Album>(albumsMap as unknown);
    }, [toValues, albumsMap]);

    const artists = useMemo(() => {
        return toValues<Artist>(artistsMap as unknown);
    }, [toValues, artistsMap]);
    const tabCounts = useMemo(
        () => ({ songs: tracks.length, albums: albums.length, artists: artists.length }),
        [albums.length, artists.length, tracks.length],
    );
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const filteredTracks = useMemo(() => {
        if (!normalizedSearch) return tracks;
        return tracks.filter(track => (
            track.title.toLowerCase().includes(normalizedSearch)
            || track.artist.toLowerCase().includes(normalizedSearch)
            || track.album.toLowerCase().includes(normalizedSearch)
        ));
    }, [normalizedSearch, tracks]);

    const filteredAlbums = useMemo(() => {
        if (!normalizedSearch) return albums;
        return albums.filter(album => (
            album.name.toLowerCase().includes(normalizedSearch)
            || album.artist.toLowerCase().includes(normalizedSearch)
        ));
    }, [albums, normalizedSearch]);

    const filteredArtists = useMemo(() => {
        if (!normalizedSearch) return artists;
        return artists.filter(artist => artist.name.toLowerCase().includes(normalizedSearch));
    }, [artists, normalizedSearch]);

    useEffect(() => {
        if (tab !== 'artists') return;
        if (isScanning) return;
        if (artists.length === 0) return;
        refreshArtistPhotos();
    }, [artists.length, isScanning, refreshArtistPhotos, tab]);

    useEffect(() => {
        if (tab !== 'songs') return;
        if (isScanning) return;
        if (tracks.length === 0) return;
        const task = InteractionManager.runAfterInteractions(() => {
            void ensureArtworkThumbsForTracks(tracks.slice(0, 180).map(track => track.id));
        });
        return () => task.cancel();
    }, [ensureArtworkThumbsForTracks, isScanning, tab, tracks]);

    // Focused player selector
    const play = usePlayerStore(s => s.play);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const currentTrackId = usePlayerStore(s => s.currentTrack?.id);

    // ─── Handlers (stable callbacks) ─────────────────────
    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [play, tracks]);

    const handleAddToQueue = useCallback((track: Track) => {
        openTrackActionsMenu({
            track,
            playlists: getAllPlaylists(),
            addToQueue,
            addToPlaylist,
            createPlaylist,
            deleteTrack,
        });
    }, [addToPlaylist, addToQueue, createPlaylist, deleteTrack, getAllPlaylists]);

    const handleAlbumPress = useCallback((album: Album) => {
        router.push({ pathname: '/album/[id]', params: { id: album.id } });
    }, []);

    const handleArtistPress = useCallback((artist: Artist) => {
        router.push({ pathname: '/artist/[id]', params: { id: artist.id } });
    }, []);

    const songsListRef = React.useRef<any>(null);
    const pendingScrollIndexRef = React.useRef<number | null>(null);
    const rafScrollRef = React.useRef<number | null>(null);
    const lastScrolledIndexRef = React.useRef(-1);

    const firstIndexByLetter = useMemo(() => {
        const indexMap = new Map<string, number>();

        for (let i = 0; i < filteredTracks.length; i++) {
            const firstChar = filteredTracks[i].title.charAt(0).toUpperCase();
            const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';
            if (!indexMap.has(letter)) indexMap.set(letter, i);
        }

        return indexMap;
    }, [filteredTracks]);

    useEffect(() => {
        lastScrolledIndexRef.current = -1;
        pendingScrollIndexRef.current = null;
    }, [filteredTracks]);

    useEffect(() => {
        return () => {
            if (rafScrollRef.current !== null) {
                cancelAnimationFrame(rafScrollRef.current);
                rafScrollRef.current = null;
            }
        };
    }, []);

    const handleLetterScrub = useCallback((letter: string) => {
        if (!songsListRef.current || filteredTracks.length === 0) return;

        const targetIndex = firstIndexByLetter.get(letter) ?? (filteredTracks.length - 1);
        pendingScrollIndexRef.current = targetIndex;

        if (rafScrollRef.current !== null) return;

        rafScrollRef.current = requestAnimationFrame(() => {
            rafScrollRef.current = null;
            const index = pendingScrollIndexRef.current;
            if (index == null || !songsListRef.current) return;
            if (lastScrolledIndexRef.current === index) return;

            lastScrolledIndexRef.current = index;
            songsListRef.current.scrollToIndex({ index, animated: false, viewPosition: 0 });
        });
    }, [filteredTracks.length, firstIndexByLetter]);

    // ─── Memoized render item functions ──────────────────
    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <TrackListItem
            track={item}
            index={index}
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
            onOptionsPress={handleAddToQueue}
        />
    ), [currentTrackId, handleTrackPress, handleAddToQueue]);

    const renderAlbumItem = useCallback(({ item }: { item: Album }) => (
        <View style={styles.albumWrapper}>
            <AlbumCard album={item} size="medium" onPress={handleAlbumPress} />
        </View>
    ), [handleAlbumPress]);

    const renderArtistItem = useCallback(({ item, index }: { item: Artist; index: number }) => {
        const isLeft = index % 2 === 0;
        const colIndex = Math.floor(index / 2);
        const isSquare = !isLeft && colIndex === 0;
        const height = isSquare ? 180 : 260;

        return (
            <View style={[styles.masonryWrapper, { padding: 6 }]}>
                <ArtistCard
                    artist={item}
                    size="full"
                    height={height}
                    onPress={handleArtistPress}
                />
            </View>
        );
    }, [handleArtistPress]);

    // ─── Key extractors (stable) ─────────────────────────
    const trackKeyExtractor = useCallback((item: Track) => item.id, []);
    const albumKeyExtractor = useCallback((item: Album) => item.id, []);
    const artistKeyExtractor = useCallback((item: Artist) => item.id, []);
    const getTrackItemType = useCallback(() => 'track', []);
    const getAlbumItemType = useCallback(() => 'album', []);
    const getArtistItemType = useCallback(() => 'artist', []);

    const overrideAlbumItemLayout = useCallback((layout: { size?: number }) => {
        layout.size = ESTIMATED_ALBUM_SIZE;
    }, []);
    const overrideArtistItemLayout = useCallback((layout: { size?: number }) => {
        layout.size = ESTIMATED_ARTIST_SIZE;
    }, []);
    // ─── Content padding ─────────────────────────────────
    const insets = useSafeAreaInsets();
    const screenPadding = theme.components.global?.screenPadding || 16;
    const listContentStyle = useMemo(
        () => ({ paddingBottom: 120 + insets.bottom, paddingHorizontal: screenPadding }),
        [screenPadding, insets.bottom],
    );
    const gridContentStyle = useMemo(
        () => ({
            paddingBottom: 120 + insets.bottom,
            paddingHorizontal: screenPadding - 6,
            paddingTop: 12
        }),
        [insets.bottom, screenPadding],
    );

    // Dynamic but stable track size based on theme (including vertical margins)
    const isMaterial3 = theme.id.startsWith('material3');
    const trackVerticalMargin = theme.components.trackItem.variant === 'brutal' ? 16 : (isMaterial3 ? 8 : 0);
    const trackSize = (theme.components.trackItem.height || DEFAULT_TRACK_SIZE) + trackVerticalMargin;
    const overrideTrackItemLayout = useCallback((layout: { size?: number }) => {
        layout.size = trackSize;
    }, [trackSize]);


    const aC = useAnimatedColors();
    const animBg = useAnimatedStyle(() => ({
        backgroundColor: aC.background.value,
    }));

    return (
        <Animated.View style={[styles.container, animBg]}>
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={[styles.header, { paddingHorizontal: screenPadding }]}>
                    <Text
                        variant="headlineMedium"
                        style={[
                            styles.title,
                            {
                                color: theme.colors.onBackground,
                                fontFamily: theme.typography.fontFamily.bold
                            }
                        ]}
                    >
                        Library
                    </Text>
                    <Searchbar
                        placeholder="Search your library"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
                        iconColor={theme.colors.primary}
                    />
                </View>

                {/* Segment Control */}
                <View style={styles.segmentContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
                        {LIBRARY_TABS.map(item => {
                            const selected = tab === item.value;

                            return (
                                <Pressable key={item.value} style={styles.tabButton} onPress={() => setTab(item.value)}>
                                    <Text
                                        style={{
                                            color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                                            fontWeight: selected ? '700' : '500',
                                        }}
                                    >
                                        {item.label}
                                    </Text>
                                    <Text style={{ color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant, opacity: 0.8 }}>
                                        {tabCounts[item.value]}
                                    </Text>
                                    {selected ? <View style={[styles.tabIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Content */}
                <View style={styles.content}>
                    {tab === 'songs' ? (
                        filteredTracks.length === 0 ? (
                            <View style={styles.emptyContainer}>
                                <EmptyState
                                    icon="Canción"
                                    title={tracks.length === 0 ? 'No songs yet' : 'No songs match your search'}
                                    description={tracks.length === 0 ? 'Scan your device to find music files' : 'Try another title, artist, or album'}
                                />
                                {tracks.length === 0 ? (
                                    <ScanButton
                                        isScanning={isScanning}
                                        onScan={scanLibrary}
                                    />
                                ) : null}
                            </View>
                        ) : (
                            <View style={{ flex: 1 }}>
                                <FlashList
                                    ref={songsListRef}
                                    data={filteredTracks}
                                    keyExtractor={trackKeyExtractor}
                                    renderItem={renderTrackItem}
                                    contentContainerStyle={listContentStyle}
                                    // @ts-ignore - estimatedItemSize is required for FlashList performance
                                    estimatedItemSize={trackSize}
                                    getItemType={getTrackItemType}
                                    // @ts-ignore - FlashList accepts overrideItemLayout for fixed-height rows
                                    removeClippedSubviews
                                    drawDistance={TRACK_DRAW_DISTANCE}
                                    showsVerticalScrollIndicator={false}
                                />
                                {!searchQuery && <AlphabetScrubber onLetterChange={handleLetterScrub} />}
                            </View>
                        )
                    ) : null}

                    {tab === 'albums' ? (
                        filteredAlbums.length === 0 ? (
                            <EmptyState
                                icon="Album"
                                title={albums.length === 0 ? 'No albums yet' : 'No albums match your search'}
                                description={albums.length === 0 ? 'Albums will appear after scanning your music' : 'Try searching another album or artist'}
                                actionLabel={albums.length === 0 ? 'Scan Library' : undefined}
                                onAction={albums.length === 0 ? scanLibrary : undefined}
                            />
                        ) : (
                            <FlashList
                                data={filteredAlbums}
                                keyExtractor={albumKeyExtractor}
                                numColumns={3}
                                masonry={true}
                                optimizeItemArrangement={true}
                                renderItem={({ item, index }: any) => {
                                    // Staggered pattern: ensure they never align
                                    const isTall = index % 4 === 0;
                                    const height = isTall ? 190 : (index % 3 === 0 ? 130 : 160);
                                    return (
                                        <View style={{ padding: 4 }}>
                                            <AlbumCard
                                                album={item}
                                                size="full"
                                                height={height}
                                                onPress={handleAlbumPress}
                                            />
                                        </View>
                                    );
                                }}
                                contentContainerStyle={gridContentStyle}
                                showsVerticalScrollIndicator={false}
                                removeClippedSubviews
                            />
                        )
                    ) : null}

                    {tab === 'artists' ? (
                        filteredArtists.length === 0 ? (
                            <EmptyState
                                icon="Artista"
                                title={artists.length === 0 ? 'No artists yet' : 'No artists match your search'}
                                description={artists.length === 0 ? 'Artists will appear after scanning your music' : 'Try searching another artist name'}
                                actionLabel={artists.length === 0 ? 'Scan Library' : undefined}
                                onAction={artists.length === 0 ? scanLibrary : undefined}
                            />
                        ) : (
                            <FlashList
                                data={filteredArtists}
                                keyExtractor={artistKeyExtractor}
                                numColumns={2}
                                masonry={true}
                                optimizeItemArrangement={true}
                                renderItem={renderArtistItem}
                                contentContainerStyle={gridContentStyle}
                                showsVerticalScrollIndicator={false}
                                removeClippedSubviews
                            />
                        )
                    ) : null}
                </View>
            </SafeAreaView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
    },
    title: {
        fontWeight: 'bold',
    },
    searchbar: {
        marginTop: 10,
        borderRadius: 12,
        elevation: 0,
    },
    segmentContainer: {
        paddingHorizontal: 16,
        paddingBottom: 6,
    },
    tabRow: {
        gap: 10,
        paddingRight: 12,
    },
    tabButton: {
        minWidth: 92,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    tabIndicator: {
        marginTop: 4,
        width: '80%',
        height: 3,
        borderRadius: 999,
    },
    content: {
        flex: 1,
    },
    emptyContainer: {
        flex: 1,
    },
    albumWrapper: {
        flex: 1,
        padding: 8,
        maxWidth: '50%',
    },
    masonryWrapper: {
        flex: 1,
        marginBottom: 8,
    },
});
