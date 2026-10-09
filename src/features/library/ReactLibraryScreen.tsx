/**
 * LibraryScreen - Main library view with tabs for songs, albums, artists, playlists
 */

import { AlbumCard, ArtistCard, EmptyState, ScanButton, SegmentedTabs, TrackListItem } from '@/src/components/ui';
import { useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo } from 'react';
import { InteractionManager, Pressable, StyleSheet, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    LinearTransition,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type LibraryTab = 'songs' | 'albums' | 'artists';
const DEFAULT_TRACK_SIZE = 76;
const BASE_TRACK_DRAW_DISTANCE = 360;
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
    const [isSearchExpanded, setIsSearchExpanded] = React.useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const lightweightMode = useSettingsStore(s => s.lightweightMode);
    const searchInputRef = React.useRef<any>(null);
    const searchProgress = useSharedValue(0);

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

    useEffect(() => {
        if (!isSearchExpanded && searchQuery) {
            setIsSearchExpanded(true);
        }
    }, [isSearchExpanded, searchQuery]);

    useEffect(() => {
        searchProgress.value = withTiming(isSearchExpanded ? 1 : 0, {
            duration: isSearchExpanded ? 320 : 220,
            easing: isSearchExpanded ? Easing.bezier(0.22, 1, 0.36, 1) : Easing.bezier(0.4, 0, 1, 1),
        });
    }, [isSearchExpanded, searchProgress]);

    useEffect(() => {
        if (!isSearchExpanded) return;
        const task = InteractionManager.runAfterInteractions(() => {
            searchInputRef.current?.focus?.();
        });
        return () => task.cancel();
    }, [isSearchExpanded]);

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

    const renderArtistItem = useCallback(({ item }: { item: Artist }) => {
        return (
            <View style={[styles.masonryWrapper, { padding: 6 }]}>
                <ArtistCard artist={item} size="full" height={218} presentation="masonry" onPress={handleArtistPress} />
            </View>
        );
    }, [handleArtistPress]);

    const renderAlbumItem = useCallback(({ item }: { item: Album }) => (
        <View style={styles.albumGridItem}>
            <AlbumCard album={item} size="full" presentation="stacked" onPress={handleAlbumPress} />
        </View>
    ), [handleAlbumPress]);

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
            paddingRight: screenPadding,
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
    const trackListDrawDistance = performanceProfile.reducedListWindowing
        ? Math.round(BASE_TRACK_DRAW_DISTANCE * 0.65)
        : BASE_TRACK_DRAW_DISTANCE;

    const aC = useAnimatedColors();
    const animSearchbarBg = useAnimatedStyle(() => ({ backgroundColor: aC.surfaceVariant.value + 'A6' }));
    // Icon inside the circle — search glyph fades out, X fades in
    const searchGlyphStyle = useAnimatedStyle(() => ({
        opacity: 1 - searchProgress.value,
        transform: [{ scale: interpolate(searchProgress.value, [0, 1], [1, 0.6]) }],
        position: 'absolute',
    }));
    const closeGlyphStyle = useAnimatedStyle(() => ({
        opacity: searchProgress.value,
        transform: [{ scale: interpolate(searchProgress.value, [0, 1], [0.6, 1]) }],
        position: 'absolute',
    }));
    // Search input rail: slides in from the right when expanding
    const searchInputShellStyle = useAnimatedStyle(() => ({
        opacity: searchProgress.value,
        transform: [{ translateX: interpolate(searchProgress.value, [0, 1], [20, 0]) }],
        // pointerEvents handled via the wrapper View
    }));

    const openSearch = useCallback(() => {
        setIsSearchExpanded(true);
    }, []);

    const closeSearch = useCallback(() => {
        setSearchQuery('');
        setIsSearchExpanded(false);
        searchInputRef.current?.blur?.();
    }, []);

    const handleSearchBlur = useCallback(() => {
        if (searchQuery.trim().length > 0) return;
        setIsSearchExpanded(false);
    }, [searchQuery]);

    return (
        <View style={styles.container}>
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
                        <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>{t('library.title')}</Text>
                    </Animated.View>
                </Animated.View>

                <Animated.View
                    layout={LinearTransition.duration(220).easing(Easing.bezier(0.22, 1, 0.36, 1))}
                    style={[styles.tabSection, { paddingHorizontal: screenPadding }, tabsEntryStyle]}
                >
                    <View style={styles.tabSectionRow}>
                        {/* LEFT SLOT — tabs pill row OR search input */}
                        <View style={styles.tabSlot}>
                            {/* Tabs are always mounted; hidden via opacity/pointer when search is open */}
                            <Animated.View
                                pointerEvents={isSearchExpanded ? 'none' : 'auto'}
                                entering={FadeIn.duration(220)}
                                exiting={FadeOut.duration(150)}
                                style={[styles.tabsFadeWrap, isSearchExpanded && styles.tabsFadeHidden]}
                            >
                                <SegmentedTabs tabs={libraryTabs} value={tab} onChange={setTab} />
                            </Animated.View>

                            {/* Search input rail — overlays the tab row when open */}
                            <Animated.View
                                pointerEvents={isSearchExpanded ? 'auto' : 'none'}
                                style={[
                                    styles.searchInputRail,
                                    styles.searchbar,
                                    styles.searchInputAbsolute,
                                    animSearchbarBg,
                                    searchInputShellStyle,
                                ]}
                            >
                                <Searchbar
                                    ref={searchInputRef}
                                    placeholder={t('library.searchPlaceholder')}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    onBlur={handleSearchBlur}
                                    style={styles.searchbarInner}
                                    iconColor={theme.colors.primary}
                                />
                            </Animated.View>
                        </View>

                        {/* RIGHT CIRCLE — always visible; shows ⌕ or ✕ */}
                        <View style={styles.searchAccordion}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={isSearchExpanded ? 'Cerrar búsqueda' : t('library.searchPlaceholder')}
                                onPress={isSearchExpanded ? closeSearch : openSearch}
                                style={[
                                    styles.searchToggleButton,
                                    { backgroundColor: theme.colors.surfaceVariant }
                                ]}
                            >
                                <Animated.View pointerEvents="none" style={searchGlyphStyle}>
                                    <Ionicons name="search" size={21} color={theme.colors.onSurface} />
                                </Animated.View>
                                <Animated.View pointerEvents="none" style={closeGlyphStyle}>
                                    <Ionicons name="close" size={23} color={theme.colors.onSurface} />
                                </Animated.View>
                            </Pressable>
                        </View>
                    </View>
                </Animated.View>

                <Animated.View
                    layout={LinearTransition.duration(220).easing(Easing.bezier(0.22, 1, 0.36, 1))}
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
                                        data={filteredTracks}
                                        keyExtractor={trackKeyExtractor}
                                        renderItem={renderTrackItem}
                                    contentContainerStyle={listContentStyle}
                                    // @ts-ignore - FlashList v2 still supports estimatedItemSize in runtime
                                    estimatedItemSize={trackSize}
                                    getItemType={getTrackItemType}
                                    removeClippedSubviews={lightweightMode}
                                    drawDistance={trackListDrawDistance}
                                    showsVerticalScrollIndicator={false}
                                />
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
                                    numColumns={2}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingTop: 18,
        paddingBottom: 10,
    },
    screenTitle: {
        fontFamily: 'StaySound',
        fontSize: 30,
        lineHeight: 36,
        fontWeight: '900',
        letterSpacing: -1.25,
    },
    libraryOverview: {
        flexDirection: 'row',
        gap: 9,
        marginTop: 18,
    },
    overviewPrimary: {
        flex: 1.28,
        minHeight: 86,
        borderRadius: 25,
        paddingHorizontal: 16,
        justifyContent: 'center',
    },
    overviewTile: {
        flex: 1,
        minHeight: 86,
        borderRadius: 25,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        justifyContent: 'center',
    },
    overviewNumber: {
        fontSize: 28,
        lineHeight: 31,
        fontWeight: '900',
        letterSpacing: -1,
    },
    overviewNumberSmall: {
        fontSize: 23,
        lineHeight: 27,
        fontWeight: '900',
        letterSpacing: -0.7,
    },
    overviewLabel: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: '700',
    },
    title: {
        fontWeight: 'bold',
    },
    tabSectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tabSlot: {
        flex: 1,
        minHeight: 36,
        justifyContent: 'center',
    },
    tabsFadeWrap: {
        flex: 1,
        justifyContent: 'center',
    },
    tabsFadeHidden: {
        opacity: 0,
    },
    searchAccordion: {
        height: 36,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 36,
    },
    searchToggleButton: {
        width: '100%',
        height: '100%',
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.12)',
    },
    searchToggleGlyph: {
        fontSize: 19,
        lineHeight: 19,
        fontWeight: '600',
    },
    searchInputRail: {
        width: '100%',
    },
    // Positions the search input on top of the tab row so layout never shifts
    searchInputAbsolute: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
    // Outer Animated.View wrapper — receives animated background color
    searchbar: {
        borderRadius: 20,
        overflow: 'hidden',
        justifyContent: 'center',
    },
    // Inner Paper Searchbar — transparent so outer wrapper controls bg
    searchbarInner: {
        height: 48,
        backgroundColor: 'transparent',
        elevation: 0,
        borderColor: 'transparent',
    },
    tabSection: {
        paddingTop: 4,
        paddingBottom: 12,
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
    albumGridItem: {
        flex: 1,
        padding: 6,
        marginBottom: 12,
    },
    masonryWrapper: {
        flex: 1,
        marginBottom: 8,
    },
});
