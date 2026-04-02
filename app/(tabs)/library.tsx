/**
 * LibraryScreen - Main library view with tabs for songs, albums, artists, playlists
 */

import { AlphabetScrubber, ArtistCard, CustomIcon, EmptyState, ScanButton, TrackListItem } from '@/src/components/ui';
import { useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo } from 'react';
import { InteractionManager, NativeSyntheticEvent, NativeScrollEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type LibraryTab = 'songs' | 'albums' | 'artists';
const ESTIMATED_ALBUM_SIZE = 212;
const ESTIMATED_ARTIST_SIZE = 138;
const DEFAULT_TRACK_SIZE = 76;
const BASE_TRACK_DRAW_DISTANCE = 360;
const SCRUB_TRACK_DRAW_DISTANCE = 560;
const THUMBNAIL_PRELOAD_COUNT = 72;
const THUMBNAIL_PRELOAD_DELAY_MS = 450;

const normalizeSearchValue = (value: string) =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

export default function LibraryScreen() {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const { t } = useI18n();
    const screenEntryKey = useScreenEntryKey('library-tab');
    const headerEntryStyle = useScreenEntryAnimation(screenEntryKey);
    const tabsEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 80 });
    const contentEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 140, duration: 280, translateY: 0 });
    const [tab, setTab] = React.useState<LibraryTab>('songs');
    const [searchQuery, setSearchQuery] = React.useState('');
    const [isAlphabetScrubbing, setIsAlphabetScrubbing] = React.useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const lightweightMode = useSettingsStore(s => s.lightweightMode);

    const libraryTabs = useMemo(
        () => [
            { value: 'songs' as const, label: t('library.tab.songs') },
            { value: 'albums' as const, label: t('library.tab.albums') },
            { value: 'artists' as const, label: t('library.tab.artists') },
        ],
        [t],
    );

    const isScanning = useLibraryStore(s => s.isScanning);
    const scanLibrary = useLibraryStore(s => s.scanLibrary);
    const refreshArtistPhotos = useLibraryStore(s => s.refreshArtistPhotos);
    const ensureArtworkThumbsForTracks = useLibraryStore(s => s.ensureArtworkThumbsForTracks);
    const getAllPlaylists = useLibraryStore(s => s.getAllPlaylists);
    const createPlaylist = useLibraryStore(s => s.createPlaylist);
    const addToPlaylist = useLibraryStore(s => s.addToPlaylist);
    const deleteTrack = useLibraryStore(s => s.deleteTrack);

    const tracksMap = useLibraryStore(s => s.tracks);
    const albumsMap = useLibraryStore(s => s.albums);
    const artistsMap = useLibraryStore(s => s.artists);

    const toValues = useCallback(<T,>(source: unknown): T[] => {
        if (source instanceof Map) return Array.from(source.values()) as T[];
        if (Array.isArray(source)) return (source as Array<[string, T]>).map(([, value]) => value);
        return [];
    }, []);

    const tracks = useMemo(() => {
        const values = toValues<Track>(tracksMap as unknown);
        return values.sort((a, b) => a.title.localeCompare(b.title));
    }, [toValues, tracksMap]);

    const albums = useMemo(() => toValues<Album>(albumsMap as unknown), [toValues, albumsMap]);
    const artists = useMemo(() => {
        const values = toValues<Artist>(artistsMap as unknown);
        return values.sort((a, b) => a.name.localeCompare(b.name));
    }, [toValues, artistsMap]);

    const normalizedSearch = normalizeSearchValue(deferredSearchQuery);

    const searchableTracks = useMemo(() => tracks.map(track => ({
        item: track,
        searchKey: normalizeSearchValue(`${track.title} ${track.artist} ${track.album}`),
    })), [tracks]);

    const searchableAlbums = useMemo(() => albums.map(album => ({
        item: album,
        searchKey: normalizeSearchValue(`${album.name} ${album.artist}`),
    })), [albums]);

    const searchableArtists = useMemo(() => artists.map(artist => ({
        item: artist,
        searchKey: normalizeSearchValue(artist.name),
    })), [artists]);

    const filteredTracks = useMemo(() => {
        if (!normalizedSearch) return tracks;
        return searchableTracks
            .filter(track => track.searchKey.includes(normalizedSearch))
            .map(track => track.item);
    }, [normalizedSearch, searchableTracks, tracks]);

    const filteredAlbums = useMemo(() => {
        if (!normalizedSearch) return albums;
        return searchableAlbums
            .filter(album => album.searchKey.includes(normalizedSearch))
            .map(album => album.item);
    }, [albums, normalizedSearch, searchableAlbums]);

    const filteredArtists = useMemo(() => {
        if (!normalizedSearch) return artists;
        return searchableArtists
            .filter(artist => artist.searchKey.includes(normalizedSearch))
            .map(artist => artist.item);
    }, [artists, normalizedSearch, searchableArtists]);

    useEffect(() => {
        if (tab !== 'artists' || isScanning || artists.length === 0) return;
        refreshArtistPhotos();
    }, [artists.length, isScanning, refreshArtistPhotos, tab]);

    useEffect(() => {
        if (tab !== 'songs' || isScanning || tracks.length === 0 || !performanceProfile.enableArtworkPreload) return;
        let isCancelled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const task = InteractionManager.runAfterInteractions(() => {
            timeoutId = setTimeout(() => {
                if (isCancelled) return;
                void ensureArtworkThumbsForTracks(tracks.slice(0, THUMBNAIL_PRELOAD_COUNT).map(track => track.id));
            }, THUMBNAIL_PRELOAD_DELAY_MS);
        });
        return () => {
            isCancelled = true;
            task.cancel();
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        };
    }, [ensureArtworkThumbsForTracks, isScanning, performanceProfile.enableArtworkPreload, tab, tracks]);

    const play = usePlayerStore(s => s.play);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const currentTrackId = usePlayerStore(s => s.currentTrack?.id);

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
    const approximateVisibleIndexRef = React.useRef(0);

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
        approximateVisibleIndexRef.current = 0;
    }, [filteredTracks]);

    useEffect(() => {
        if (tab !== 'songs' || searchQuery) {
            setIsAlphabetScrubbing(false);
        }
    }, [searchQuery, tab]);

    useEffect(() => {
        return () => {
            if (rafScrollRef.current !== null) {
                cancelAnimationFrame(rafScrollRef.current);
                rafScrollRef.current = null;
            }
        };
    }, []);

    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <TrackListItem
            track={item}
            index={index}
            outerInset={0}
            contentPaddingHorizontal={8}
            visualStyle="library"
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
            onOptionsPress={handleAddToQueue}
        />
    ), [currentTrackId, handleTrackPress, handleAddToQueue]);

    const renderArtistItem = useCallback(({ item, index }: { item: Artist; index: number }) => {
        const isLeft = index % 2 === 0;
        const colIndex = Math.floor(index / 2);
        const isCompact = isLeft ? (colIndex % 3 === 1) : (colIndex % 3 === 0);
        const height = isCompact ? 228 : 270;

        return (
            <View style={[styles.masonryWrapper, { padding: 6 }]}>
                <ArtistCard artist={item} size="full" height={height} presentation="masonry" onPress={handleArtistPress} />
            </View>
        );
    }, [handleArtistPress]);

    const renderAlbumItem = useCallback(({ item }: { item: Album }) => (
        <Pressable
            onPress={() => handleAlbumPress(item)}
            style={({ pressed }) => [
                styles.albumRow,
                { borderColor: `${theme.colors.outline}22` },
                pressed && styles.albumRowPressed,
            ]}
        >
            <View style={[styles.albumArtworkWrap, { backgroundColor: theme.colors.surfaceVariant }]}>
                {item.artwork || item.artworkThumb ? (
                    <Image
                        source={{ uri: item.artworkThumb || item.artwork }}
                        style={styles.albumArtwork}
                        contentFit="cover"
                        recyclingKey={item.id}
                        cachePolicy={performanceProfile.imageCachePolicyList}
                        transition={0}
                    />
                ) : (
                    <CustomIcon name="Album" size={32} color={theme.colors.primary} />
                )}
            </View>
            <View style={styles.albumRowInfo}>
                <Text variant="titleMedium" numberOfLines={2} style={[styles.albumRowTitle, { color: theme.colors.onSurface }]}>
                    {item.name}
                </Text>
                <Text variant="bodySmall" numberOfLines={1} style={[styles.albumRowSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                    {item.artist}
                </Text>
            </View>
        </Pressable>
    ), [handleAlbumPress, theme.colors.onSurface, theme.colors.onSurfaceVariant, theme.colors.outline, theme.colors.primary, theme.colors.surfaceVariant]);

    const trackKeyExtractor = useCallback((item: Track) => item.id, []);
    const albumKeyExtractor = useCallback((item: Album) => item.id, []);
    const artistKeyExtractor = useCallback((item: Artist) => item.id, []);
    const getTrackItemType = useCallback(() => 'track', []);

    const insets = useSafeAreaInsets();
    const screenPadding = theme.components.global?.screenPadding || 16;
    const listContentStyle = useMemo(
        () => ({
            paddingBottom: 120 + insets.bottom,
            paddingLeft: Math.max(10, screenPadding - 4),
            paddingRight: screenPadding + 26,
        }),
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
    const albumListContentStyle = useMemo(
        () => ({
            paddingBottom: 120 + insets.bottom,
            paddingHorizontal: screenPadding,
            paddingTop: 10,
        }),
        [insets.bottom, screenPadding],
    );

    const isMaterial3 = theme.id.startsWith('material3');
    const trackVerticalMargin = theme.components.trackItem.variant === 'brutal' ? 16 : (isMaterial3 ? 8 : 0);
    const trackSize = (theme.components.trackItem.height || DEFAULT_TRACK_SIZE) + trackVerticalMargin;
    const scrubAnimatedIndexThreshold = 18;
    const trackListDrawDistance = performanceProfile.reducedListWindowing
        ? Math.round((isAlphabetScrubbing ? SCRUB_TRACK_DRAW_DISTANCE : BASE_TRACK_DRAW_DISTANCE) * 0.65)
        : (isAlphabetScrubbing ? SCRUB_TRACK_DRAW_DISTANCE : BASE_TRACK_DRAW_DISTANCE);

    const handleSongsScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
        approximateVisibleIndexRef.current = Math.round(offsetY / Math.max(trackSize, 1));
    }, [trackSize]);

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

            const distance = Math.abs(index - approximateVisibleIndexRef.current);
            const shouldAnimate = distance <= scrubAnimatedIndexThreshold;
            const targetOffset = Math.max(0, index * trackSize);

            lastScrolledIndexRef.current = index;
            approximateVisibleIndexRef.current = index;
            if (typeof songsListRef.current.scrollToOffset === 'function') {
                songsListRef.current.scrollToOffset({ offset: targetOffset, animated: shouldAnimate });
                return;
            }

            songsListRef.current.scrollToIndex({ index, animated: shouldAnimate, viewPosition: 0 });
        });
    }, [filteredTracks.length, firstIndexByLetter, scrubAnimatedIndexThreshold, trackSize]);

    const aC = useAnimatedColors();
    const animBg = useAnimatedStyle(() => ({ backgroundColor: aC.background.value }));

    return (
        <Animated.View style={[styles.container, animBg]}>
            <SafeAreaView style={styles.container} edges={['top']}>
                <Animated.View
                    style={[
                        headerEntryStyle,
                        {
                            paddingHorizontal: screenPadding,
                        }
                    ]}
                >
                    <Animated.View style={styles.header}>
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
                            {t('library.title')}
                        </Text>
                        <Searchbar
                            placeholder={t('library.searchPlaceholder')}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant + 'A6', borderColor: 'transparent' }]}
                            iconColor={theme.colors.primary}
                        />
                    </Animated.View>
                </Animated.View>

                <Animated.View
                    style={[styles.tabSection, { paddingHorizontal: screenPadding }, tabsEntryStyle]}
                >
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
                        {libraryTabs.map(item => {
                            const selected = tab === item.value;

                            return (
                                <Pressable
                                    key={item.value}
                                    style={[
                                        styles.tabButton,
                                        selected ? { backgroundColor: theme.colors.primaryContainer + '56' } : null
                                    ]}
                                    onPress={() => setTab(item.value)}
                                >
                                    <Text
                                        style={{
                                            color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                                            fontWeight: selected ? '700' : '500',
                                        }}
                                    >
                                        {item.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Animated.View>

                <Animated.View
                    style={[styles.content, contentEntryStyle]}
                >
                    {tab === 'songs' ? (
                        <Animated.View
                            entering={FadeIn.duration(180)}
                            exiting={FadeOut.duration(130)}
                            style={styles.tabPane}
                        >
                            {filteredTracks.length === 0 ? (
                                <View style={styles.emptyContainer}>
                                    <EmptyState
                                        icon="Canción"
                                        title={tracks.length === 0 ? t('library.emptySongs.none.title') : t('library.emptySongs.search.title')}
                                        description={tracks.length === 0 ? t('library.emptySongs.none.description') : t('library.emptySongs.search.description')}
                                    />
                                    {tracks.length === 0 ? <ScanButton isScanning={isScanning} onScan={scanLibrary} /> : null}
                                </View>
                            ) : (
                                <View style={{ flex: 1 }}>
                                    <FlashList
                                        ref={songsListRef}
                                        data={filteredTracks}
                                        keyExtractor={trackKeyExtractor}
                                        renderItem={renderTrackItem}
                                    contentContainerStyle={listContentStyle}
                                    // @ts-ignore - FlashList v2 still supports estimatedItemSize in runtime
                                    estimatedItemSize={trackSize}
                                    getItemType={getTrackItemType}
                                    removeClippedSubviews={lightweightMode}
                                    drawDistance={trackListDrawDistance}
                                    onScroll={handleSongsScroll}
                                    scrollEventThrottle={16}
                                    showsVerticalScrollIndicator={false}
                                />
                                    {!searchQuery && (
                                        <AlphabetScrubber
                                            onLetterChange={handleLetterScrub}
                                            onScrubStateChange={setIsAlphabetScrubbing}
                                        />
                                    )}
                                </View>
                            )}
                        </Animated.View>
                    ) : null}

                    {tab === 'albums' ? (
                        <Animated.View
                            entering={FadeIn.duration(180)}
                            exiting={FadeOut.duration(130)}
                            style={styles.tabPane}
                        >
                            {filteredAlbums.length === 0 ? (
                                <EmptyState
                                    icon="Album"
                                    title={albums.length === 0 ? t('library.emptyAlbums.none.title') : t('library.emptyAlbums.search.title')}
                                    description={albums.length === 0 ? t('library.emptyAlbums.none.description') : t('library.emptyAlbums.search.description')}
                                    actionLabel={albums.length === 0 ? t('library.scanAction') : undefined}
                                    onAction={albums.length === 0 ? scanLibrary : undefined}
                                />
                            ) : (
                                <FlashList
                                    data={filteredAlbums}
                                    keyExtractor={albumKeyExtractor}
                                    renderItem={renderAlbumItem}
                                    contentContainerStyle={albumListContentStyle}
                                    showsVerticalScrollIndicator={false}
                                    removeClippedSubviews
                                />
                            )}
                        </Animated.View>
                    ) : null}

                    {tab === 'artists' ? (
                        <Animated.View
                            entering={FadeIn.duration(180)}
                            exiting={FadeOut.duration(130)}
                            style={styles.tabPane}
                        >
                            {filteredArtists.length === 0 ? (
                                <EmptyState
                                    icon="Artista"
                                    title={artists.length === 0 ? t('library.emptyArtists.none.title') : t('library.emptyArtists.search.title')}
                                    description={artists.length === 0 ? t('library.emptyArtists.none.description') : t('library.emptyArtists.search.description')}
                                    actionLabel={artists.length === 0 ? t('library.scanAction') : undefined}
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
                            )}
                        </Animated.View>
                    ) : null}
                </Animated.View>
            </SafeAreaView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingTop: 10,
        paddingBottom: 8,
    },
    title: {
        fontWeight: 'bold',
    },
    searchbar: {
        marginTop: 8,
        borderRadius: 14,
        elevation: 0,
    },
    tabRow: {
        gap: 8,
        paddingHorizontal: 2,
        paddingRight: 8,
    },
    tabSection: {
        paddingTop: 6,
        paddingBottom: 10,
    },
    tabButton: {
        minWidth: 96,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        position: 'relative',
    },
    tabPane: {
        ...StyleSheet.absoluteFillObject,
    },
    emptyContainer: {
        flex: 1,
    },
    albumRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    albumRowPressed: {
        opacity: 0.82,
    },
    albumArtworkWrap: {
        width: 72,
        height: 72,
        borderRadius: 16,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    albumArtwork: {
        width: '100%',
        height: '100%',
    },
    albumRowInfo: {
        flex: 1,
        marginLeft: 14,
        paddingRight: 8,
    },
    albumRowTitle: {
        fontWeight: '700',
        letterSpacing: -0.2,
    },
    albumRowSubtitle: {
        marginTop: 4,
    },
    masonryWrapper: {
        flex: 1,
        marginBottom: 8,
    },
});




