import {
    formatMirrorCapabilities,
    getSoulseekFolderPath,
    getSoulseekLeafFilename,
    rankByRelevance,
} from '@/src/features/tidal/model/tidalScreenUtils';
import type {
    SoulseekFolderGroup,
    TidalSourceTab,
    TidalTab,
    TidalVirtualListItem,
} from '@/src/features/tidal/model/tidalScreenTypes';
import { useTidalRecentSearches } from '@/src/features/tidal/hooks/useTidalRecentSearches';
import { useSoulseekCredentials } from '@/src/features/tidal/hooks/useSoulseekCredentials';
import { useTidalMirrorHealth } from '@/src/features/tidal/hooks/useTidalMirrorHealth';
import { useTidalPlaybackActions } from '@/src/features/tidal/hooks/useTidalPlaybackActions';
import { tidalScreenStyles as styles } from '@/src/features/tidal/ui/tidalScreenStyles';
import { TidalSettingsSheets } from '@/src/features/tidal/ui/TidalSettingsSheets';
import { CatalogTrackRow, SoulseekTrackRow } from '@/src/features/tidal/ui/TidalResultTrackRows';
import { TidalVirtualListItemView } from '@/src/features/tidal/ui/TidalVirtualListItemView';
import { TidalSearchHeader } from '@/src/features/tidal/ui/TidalSearchHeader';
import { type SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import {
    getTidalArtistInfo,
    getTidalSimilarArtists,
    searchTidal,
    searchTidalAlbums,
    searchTidalArtists,
    searchTidalPlaylists,
    TIDAL_MIRROR_NAMES,
} from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, useSettingsStore } from '@/src/stores';
import { useTheme, withAlpha } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalPlaylist, TidalTrack } from '@/src/types/audio';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { router, useRootNavigationState } from 'expo-router';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Keyboard, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const SOULSEEK_FLOW_LOG = '[SoulseekFlow]';

const SEARCH_COMMIT_DELAY_MS = 350;


export default function TidalScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();

    const palette = useMemo(() => ({
        searchBackground: withAlpha(theme.colors.surface, 'F2'),
        searchBorder: withAlpha(theme.colors.outline, '54'),
        cardBackground: withAlpha(theme.colors.surface, 'F5'),
        cardBorder: withAlpha(theme.colors.outline, '42'),
        mutedSurface: withAlpha(theme.colors.surfaceVariant, 'B8'),
        strongBorder: withAlpha(theme.colors.outline, '70'),
    }), [theme.colors]);

    const [query, setQuery] = useState('');
    const [committedQuery, setCommittedQuery] = useState('');
    const { recentSearches, rememberRecentSearch } = useTidalRecentSearches();
    const [searchRunId, setSearchRunId] = useState(0);
    const [activeSourceTab, setActiveSourceTab] = useState<TidalSourceTab>('soulseek');
    const [activeTab, setActiveTab] = useState<TidalTab>('tracks');
    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [artists, setArtists] = useState<TidalArtist[]>([]);
    const [artistArtworkOverrides, setArtistArtworkOverrides] = useState<Map<number, string>>(new Map());
    const [playlists, setPlaylists] = useState<TidalPlaylist[]>([]);
    const [albums, setAlbums] = useState<TidalAlbum[]>([]);
    const [soulseekResults, setSoulseekResults] = useState<SoulseekSearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSoulseekLoading, setIsSoulseekLoading] = useState(false);
    const [hasResolvedSearch, setHasResolvedSearch] = useState(false);
    const [hasResolvedSoulseekSearch, setHasResolvedSoulseekSearch] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [soulseekError, setSoulseekError] = useState<string | null>(null);
    const {
        username: soulseekUsername,
        password: soulseekPassword,
        hasCredentials: hasSoulseekCredentials,
        isSaving: isSavingSoulseekCredentials,
        setUsername: setSoulseekUsername,
        setPassword: setSoulseekPassword,
        save: saveSoulseekCredentials,
    } = useSoulseekCredentials();
    const [showSoulseekAuthModal, setShowSoulseekAuthModal] = useState(false);
    const requireSoulseekCredentials = useCallback(() => {
        setShowSoulseekAuthModal(true);
    }, []);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const [showLegacyMirrors, setShowLegacyMirrors] = useState(false);
    const rootNavigationState = useRootNavigationState();
    const canNavigate = Boolean(rootNavigationState?.key);
    const [showSettingsSheet, setShowSettingsSheet] = useState(false);
    const accentColor = theme.colors.primary;
    const [recommendedArtists, setRecommendedArtists] = useState<TidalArtist[]>([]);
    const [recommendedTracks, setRecommendedTracks] = useState<TidalTrack[]>([]);
    const [isRecommending, setIsRecommending] = useState(false);
    const {
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror
    } = useSettingsStore();

    const showNotification = useNotificationStore(s => s.showNotification);

    const handleSaveSoulseekCredentials = useCallback(async () => {
        const saved = await saveSoulseekCredentials();
        if (saved) {
            setShowSoulseekAuthModal(false);
            setSoulseekError(null);
        }
    }, [saveSoulseekCredentials]);

    const handleMirrorChange = (mirror: string) => {
        const availability = mirrorAvailability[mirror];
        setTidalMirror(mirror);
        setShowMirrorModal(false);

        if (mirror !== 'auto') {
            showNotification(`Fuente seleccionada: ${TIDAL_MIRROR_NAMES[mirror]}`, 'success');
            if (availability && (!availability.supportsSearch || !availability.supportsStream || !availability.supportsDownload)) {
                showNotification(formatMirrorCapabilities(availability), 'warning');
            }
        } else {
            showNotification('Modo automático activado', 'info');
        }
    };

    const artistArtworkAttempted = useRef<Set<number>>(new Set());
    const pendingSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeTabRef = useRef<TidalTab>('tracks');
    const activeSourceTabRef = useRef<TidalSourceTab>('soulseek');

    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);

    useEffect(() => {
        activeSourceTabRef.current = activeSourceTab;
    }, [activeSourceTab]);

    const {
        downloads,
        isDownloaded,
        pendingTrackPreview,
        isPlayerPlaying,
        activeTidalTrackId,
        handleSoulseekMatchDownload,
        handleSoulseekMatchPlay,
        handleTidalPlay,
        handleTidalDownload,
        handleSoulseekOnlyDownload,
    } = useTidalPlaybackActions({
        activeSourceTab,
        activeSourceTabRef,
        hasSoulseekCredentials,
        onRequireSoulseekCredentials: requireSoulseekCredentials,
    });
    const triggerSearch = useCallback((
        nextQuery: string,
        tab: TidalTab = 'all',
        source: TidalSourceTab = activeSourceTabRef.current,
    ) => {
        const trimmed = nextQuery.trim();
        console.log(`${SOULSEEK_FLOW_LOG} triggerSearch`, {
            requestedSource: source,
            activeSourceTab,
            activeSourceRef: activeSourceTabRef.current,
            tab,
            query: trimmed,
        });
        const sameQuery = trimmed === committedQuery.trim();
        const sameSource = source === activeSourceTab;
        const isResolved = hasResolvedSearch;

        if (pendingSearchTimeoutRef.current) {
            clearTimeout(pendingSearchTimeoutRef.current);
            pendingSearchTimeoutRef.current = null;
        }

        if (sameQuery && sameSource && isResolved && (source === 'soulseek' || tab === activeTab)) {
            console.log(`${SOULSEEK_FLOW_LOG} triggerSearch skipped`, {
                source,
                tab,
                query: trimmed,
            });
            return;
        }

        setActiveSourceTab(source);
        setActiveTab(tab);
        setCommittedQuery(trimmed);
        setSearchRunId(prev => prev + 1);
        setHasResolvedSearch(false);
        setHasResolvedSoulseekSearch(false);
        setError(null);
        setSoulseekError(null);
        setIsLoading(Boolean(trimmed));
        if (!trimmed) {
            setSoulseekResults([]);
        }
        if (trimmed) {
            rememberRecentSearch(trimmed);
        }
    }, [activeSourceTab, activeTab, committedQuery, hasResolvedSearch, rememberRecentSearch]);

    useEffect(() => {
        if (!query.trim()) {
            if (pendingSearchTimeoutRef.current) {
                clearTimeout(pendingSearchTimeoutRef.current);
                pendingSearchTimeoutRef.current = null;
            }
            setCommittedQuery('');
            setSearchRunId(prev => prev + 1);
            setHasResolvedSearch(false);
            setHasResolvedSoulseekSearch(false);
            setError(null);
            setSoulseekError(null);
            setIsLoading(false);
            setIsSoulseekLoading(false);
            setSoulseekResults([]);
            return;
        }

        pendingSearchTimeoutRef.current = setTimeout(() => {
            triggerSearch(query, activeTabRef.current, activeSourceTabRef.current);
        }, SEARCH_COMMIT_DELAY_MS);

        return () => {
            if (pendingSearchTimeoutRef.current) {
                clearTimeout(pendingSearchTimeoutRef.current);
                pendingSearchTimeoutRef.current = null;
            }
        };
    }, [query, triggerSearch]);

    const handleSubmitSearch = useCallback(() => {
        Keyboard.dismiss();
        triggerSearch(query, activeTabRef.current, activeSourceTabRef.current);
    }, [query, triggerSearch]);

    useEffect(() => {
        // TIDAL is always the canonical catalog, including in Soulseek mode.
        // Soulseek is only queried after the user chooses a concrete track.
        const currentQuery = committedQuery.trim();
        if (!currentQuery) {
            setTracks([]);
            setArtists([]);
            setAlbums([]);
            setPlaylists([]);
            setArtistArtworkOverrides(new Map());
            artistArtworkAttempted.current.clear();
            setHasResolvedSearch(false);
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        let resultCommit: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
        setIsLoading(true);
        setError(null);
        console.log(`${SOULSEEK_FLOW_LOG} mirror search start`, {
            activeSourceTab,
            activeSourceRef: activeSourceTabRef.current,
            query: currentQuery,
            run: searchRunId,
        });

        Promise.all([
            searchTidal(currentQuery),
            searchTidalArtists(currentQuery),
            searchTidalAlbums(currentQuery),
            searchTidalPlaylists(currentQuery),
        ])
            .then(([nextTracks, nextArtists, nextAlbums, nextPlaylists]) => {
                if (cancelled) return;
                console.log(`${SOULSEEK_FLOW_LOG} mirror search result`, {
                    activeSourceTab,
                    query: currentQuery,
                    tracks: nextTracks.length,
                    artists: nextArtists.length,
                    albums: nextAlbums.length,
                    playlists: nextPlaylists.length,
                });
                resultCommit = InteractionManager.runAfterInteractions(() => {
                    if (cancelled) return;
                    startTransition(() => {
                        setTracks(nextTracks);
                        setArtists(nextArtists);
                        setAlbums(nextAlbums);
                        setPlaylists(nextPlaylists);
                        setArtistArtworkOverrides(new Map());
                        artistArtworkAttempted.current.clear();
                        setHasResolvedSearch(true);
                        setIsLoading(false);
                    });
                });
            })
            .catch((searchError: unknown) => {
                if (cancelled) return;
                const message = searchError instanceof Error ? searchError.message : 'No se pudo consultar Tidal';
                console.log(`${SOULSEEK_FLOW_LOG} mirror search error`, {
                    activeSourceTab,
                    query: currentQuery,
                    message,
                });
                startTransition(() => {
                    setTracks([]);
                    setArtists([]);
                    setAlbums([]);
                    setPlaylists([]);
                    setError(message);
                    setHasResolvedSearch(true);
                    setIsLoading(false);
                });
            });

        return () => {
            cancelled = true;
            resultCommit?.cancel();
        };
    }, [activeSourceTab, committedQuery, searchRunId]);

    const openArtist = useCallback((artist: TidalArtist) => {
        if (!canNavigate) {
            console.warn('[TidalScreen] Navigation blocked: root layout not mounted yet (artist).');
            return;
        }
        router.push({
            pathname: '/tidal-artist/[id]',
            params: {
                id: String(artist.id),
                name: artist.name,
                source: activeSourceTab === 'soulseek' ? 'soulseek' : 'qobuz',
            },
        });
    }, [activeSourceTab, canNavigate]);

    const openAlbum = useCallback((album: TidalAlbum) => {
        if (!canNavigate) {
            console.warn('[TidalScreen] Navigation blocked: root layout not mounted yet (album).');
            return;
        }
        router.push({
            pathname: '/tidal-album/[id]',
            params: {
                id: String(album.id),
                source: activeSourceTab === 'soulseek' ? 'soulseek' : 'qobuz',
            },
        });
    }, [activeSourceTab, canNavigate]);

    const openPlaylist = useCallback((playlist: TidalPlaylist) => {
        if (!canNavigate) {
            console.warn('[TidalScreen] Navigation blocked: root layout not mounted yet (playlist).');
            return;
        }
        router.push({
            pathname: '/tidal-playlist/[id]',
            params: { id: playlist.uuid },
        });
    }, [canNavigate]);

    const resolveArtistArtwork = useCallback(async (artist: TidalArtist) => {
        if (artistArtworkAttempted.current.has(artist.id)) return;
        artistArtworkAttempted.current.add(artist.id);

        try {
            const artistInfo = await getTidalArtistInfo(artist.id, artist.name);
            const nextArtwork = artistInfo.artworkUrl;
            if (!nextArtwork) return;

            setArtistArtworkOverrides(prev => {
                const next = new Map(prev);
                next.set(artist.id, nextArtwork);
                return next;
            });
        } catch {
            // Keep placeholder if fetch fails.
        }
    }, []);

    const hasQuery = query.length > 0;
    const hasCommittedQuery = committedQuery.trim().length > 0;
    const isSoulseekSource = activeSourceTab === 'soulseek';
    const soulseekFolderGroups = useMemo<SoulseekFolderGroup[]>(() => {
        if (soulseekResults.length === 0) return [];

        const groups = new Map<string, SoulseekFolderGroup>();

        for (const result of soulseekResults) {
            const folderPath = getSoulseekFolderPath(result.match.filename || '');
            const username = (result.match.username || '').trim() || 'Peer';
            const key = `${username.toLowerCase()}::${folderPath.toLowerCase()}`;

            const existing = groups.get(key);
            if (existing) {
                existing.results.push(result);
                continue;
            }

            groups.set(key, {
                key,
                username,
                folderPath,
                results: [result],
            });
        }

        return Array.from(groups.values())
            .map(group => ({
                ...group,
                results: [...group.results].sort((left, right) => {
                    const leftLeaf = getSoulseekLeafFilename(left.match.filename || left.track.title);
                    const rightLeaf = getSoulseekLeafFilename(right.match.filename || right.track.title);
                    const titleDiff = leftLeaf.localeCompare(rightLeaf, 'es', { numeric: true, sensitivity: 'base' });
                    if (titleDiff !== 0) return titleDiff;
                    return left.track.durationMs - right.track.durationMs;
                }),
            }))
            .sort((left, right) => {
                const countDiff = right.results.length - left.results.length;
                if (countDiff !== 0) return countDiff;
                return left.folderPath.localeCompare(right.folderPath, 'es', { sensitivity: 'base' });
            });
    }, [soulseekResults]);

    const visibleArtistsForArtwork = useMemo(() => {
        if (hasCommittedQuery) {
            return artists.slice(0, activeTab === 'all' ? 6 : artists.length);
        }

        return recommendedArtists;
    }, [activeTab, artists, hasCommittedQuery, recommendedArtists]);

    // Fetches artist artwork in background without slowing down search results
    useEffect(() => {
        const artistsToResolve = visibleArtistsForArtwork.filter(
            artist => !artistArtworkOverrides.has(artist.id),
        );
        if (artistsToResolve.length === 0) return;
        artistsToResolve.forEach(artist => {
            void resolveArtistArtwork(artist);
        });
    }, [artistArtworkOverrides, resolveArtistArtwork, visibleArtistsForArtwork]);

    const getDownloadPresentation = useCallback((trackId: number) => {
        const state = downloads.get(trackId);
        const status = state?.status === 'downloading'
            ? 'downloading'
            : isDownloaded(trackId) || state?.status === 'done'
                ? 'done'
                : state?.status === 'error'
                    ? 'error'
                    : 'idle';

        return { status, progress: state?.progress ?? 0 } as const;
    }, [downloads, isDownloaded]);

    const isTrackActive = useCallback((trackId: number) => (
        activeTidalTrackId === trackId && (isPlayerPlaying || !!pendingTrackPreview)
    ), [activeTidalTrackId, isPlayerPlaying, pendingTrackPreview]);

    const renderTidalTrackRow = useCallback((track: TidalTrack) => {
        const downloadPresentation = getDownloadPresentation(track.id);

        return (
            <CatalogTrackRow
                track={track}
                accentColor={accentColor}
                isActive={isTrackActive(track.id)}
                isPlaying={isPlayerPlaying}
                downloadStatus={downloadPresentation.status}
                progress={downloadPresentation.progress}
                onPress={() => handleTidalPlay(track)}
                onDownload={() => void handleTidalDownload(track, 'tidal')}
            />
        );
    }, [accentColor, getDownloadPresentation, handleTidalDownload, handleTidalPlay, isPlayerPlaying, isTrackActive]);

    const renderSoulseekMirrorTrackRow = useCallback((track: TidalTrack) => {
        const downloadPresentation = getDownloadPresentation(track.id);

        return (
            <CatalogTrackRow
                track={track}
                accentColor={accentColor}
                isActive={isTrackActive(track.id)}
                isPlaying={isPlayerPlaying}
                downloadStatus={downloadPresentation.status}
                progress={downloadPresentation.progress}
                onPress={() => void handleSoulseekOnlyDownload(track)}
                onDownload={() => void handleSoulseekOnlyDownload(track)}
            />
        );
    }, [accentColor, getDownloadPresentation, handleSoulseekOnlyDownload, isPlayerPlaying, isTrackActive]);

    const renderSoulseekTrackRow = useCallback((result: SoulseekSearchResult) => {
        const downloadPresentation = getDownloadPresentation(result.track.id);

        return (
            <SoulseekTrackRow
                result={result}
                accentColor={accentColor}
                isActive={isTrackActive(result.track.id)}
                isPlaying={isPlayerPlaying}
                downloadStatus={downloadPresentation.status}
                progress={downloadPresentation.progress}
                onPress={() => handleSoulseekMatchPlay(result)}
                onDownload={() => void handleSoulseekMatchDownload(result)}
            />
        );
    }, [accentColor, getDownloadPresentation, handleSoulseekMatchDownload, handleSoulseekMatchPlay, isPlayerPlaying, isTrackActive]);

    const [isFocused, setIsFocused] = useState(false);
    const {
        availability: mirrorAvailability,
        recommendedMirrors,
        legacyMirrors,
        searchHealth: searchHealthBanner,
    } = useTidalMirrorHealth(tidalMirror, showMirrorModal);

    const fetchHomeRecommendations = useCallback(async () => {
        const library = useLibraryStore.getState().getAllArtists();
        
        setIsRecommending(true);
        try {
            let seedArtistsArr = [];
            if (library.length > 0) {
                const shuffled = [...library].sort(() => 0.5 - Math.random());
                seedArtistsArr = shuffled.slice(0, 2);
            } else {
                // Fallback seeds for new users
                seedArtistsArr = [{ name: 'SZA' }, { name: 'PinkPantheress' }, { name: 'Metro Boomin' }].sort(() => 0.5 - Math.random()).slice(0, 2);
            }

            const allRecommended: TidalArtist[] = [];
            const allRecommendedTracks: TidalTrack[] = [];

            for (const seed of seedArtistsArr) {
                const searchResults = await searchTidalArtists(seed.name);
                const match = searchResults[0];
                if (match?.id) {
                    const [similar, recommendations] = await Promise.all([
                        getTidalSimilarArtists(match.id),
                        searchTidal(seed.name).catch(() => [] as TidalTrack[])
                    ]);
                    allRecommended.push(...similar.slice(0, 5));
                    allRecommendedTracks.push(...recommendations.slice(0, 6));
                }
            }

            const uniqueArtists = Array.from(new Map(allRecommended.map(a => [a.id, a])).values())
                .sort(() => 0.5 - Math.random());
            const uniqueTracks = Array.from(new Map(allRecommendedTracks.map(t => [t.id, t])).values())
                .sort(() => 0.5 - Math.random());

            setRecommendedArtists(uniqueArtists.slice(0, 12));
            setRecommendedTracks(uniqueTracks.slice(0, 12));
        } catch (error) {
            console.warn('[TidalScreen] Failed to fetch recommendations:', error);
        } finally {
            setIsRecommending(false);
        }
    }, []);

    useEffect(() => {
        if (!hasCommittedQuery) {
            void fetchHomeRecommendations();
        }
    }, [hasCommittedQuery, fetchHomeRecommendations]);

    const applySuggestion = useCallback((nextQuery: string) => {
        setQuery(nextQuery);
        triggerSearch(nextQuery, activeTabRef.current);
    }, [triggerSearch]);

    const resultTabs = useMemo(() => ([
        { key: 'tracks' as const, label: 'Canciones' },
    ]), []);

    const visibleArtistResults = useMemo(
        () => rankByRelevance(artists, committedQuery, a => a.name).slice(0, activeTab === 'all' ? 6 : artists.length),
        [activeTab, artists, committedQuery],
    );
    const visibleAlbumResults = useMemo(
        () => rankByRelevance(albums, committedQuery, a => `${a.title} ${a.artistName ?? ''}`).slice(0, activeTab === 'all' ? 8 : albums.length),
        [activeTab, albums, committedQuery],
    );
    const visiblePlaylistResults = useMemo(
        () => rankByRelevance(playlists, committedQuery, p => p.title).slice(0, activeTab === 'all' ? 6 : playlists.length),
        [activeTab, playlists, committedQuery],
    );
    const visibleTrackResults = useMemo(
        () => rankByRelevance(tracks, committedQuery, t => `${t.artist} ${t.title}`).slice(0, activeTab === 'all' ? 12 : tracks.length),
        [activeTab, tracks, committedQuery],
    );

    const virtualListData = useMemo<TidalVirtualListItem[]>(() => {
        if (isLoading) {
            return [{ type: 'loading' }];
        }

        if (error) {
            return [{ type: 'error' }];
        }

        if (!hasQuery && !isFocused) {
            return [{ type: 'home' }];
        }

        if (hasResolvedSearch && !tracks.length && !albums.length && !artists.length && !playlists.length) {
            return [{ type: 'empty' }];
        }

        const nextItems: TidalVirtualListItem[] = [];
        if (visibleTrackResults.length > 0) {
            nextItems.push({ type: 'label', key: 'label-tracks', label: 'Canciones' });
            for (const track of visibleTrackResults) {
                nextItems.push({ type: 'track', track });
            }
        }
        return nextItems;
    }, [
        activeSourceTab,
        activeTab,
        albums.length,
        artists.length,
        error,
        hasCommittedQuery,
        hasQuery,
        hasResolvedSearch,
        hasResolvedSoulseekSearch,
        hasSoulseekCredentials,
        isFocused,
        isLoading,
        isSoulseekLoading,
        isSoulseekSource,
        playlists.length,
        soulseekError,
        soulseekFolderGroups,
        soulseekResults.length,
        tracks.length,
        visibleAlbumResults,
        visibleArtistResults,
        visiblePlaylistResults,
        visibleTrackResults,
    ]);

    const virtualListKeyExtractor = useCallback((item: TidalVirtualListItem, index: number) => {
        switch (item.type) {
            case 'soulseek-folder-header':
                return `soulseek-folder-${item.group.key}`;
            case 'soulseek-track':
                return `soulseek-track-${item.result.track.id}-${item.result.match.id ?? item.result.match.filename ?? index}`;
            case 'label':
                return item.key;
            case 'feature':
                return `feature-${item.artist.id}`;
            case 'track':
                return `track-${item.track.id}`;
            default:
                return item.type;
        }
    }, []);
    const getVirtualListItemType = useCallback((item: TidalVirtualListItem) => item.type, []);
    const virtualListContentStyle = useMemo(
        () => [styles.pageContent, { paddingBottom: styles.pageContent.paddingBottom + insets.bottom }],
        [insets.bottom],
    );
    const virtualListExtraData = useMemo(() => ({
        activeTidalTrackId,
        downloads,
        isPlayerPlaying,
        pendingTrackPreviewId: pendingTrackPreview?.id ?? null,
    }), [activeTidalTrackId, downloads, isPlayerPlaying, pendingTrackPreview?.id]);

    const virtualListHeader = (
        <TidalSearchHeader
            accentColor={accentColor}
            colors={theme.colors}
            palette={palette}
            query={query}
            isFocused={isFocused}
            hasQuery={hasQuery}
            hasCommittedQuery={hasCommittedQuery}
            activeTab={activeTab}
            resultTabs={resultTabs}
            recentSearches={recentSearches}
            searchHealth={searchHealthBanner}
            onQueryChange={setQuery}
            onFocusChange={setIsFocused}
            onSubmit={handleSubmitSearch}
            onOpenSettings={() => setShowSettingsSheet(true)}
            onTabChange={setActiveTab}
            onSuggestion={applySuggestion}
        />
    );
    const renderVirtualListItem = useCallback(({ item }: ListRenderItemInfo<TidalVirtualListItem>) => (
        <TidalVirtualListItemView
            item={item}
            accentColor={accentColor}
            colors={theme.colors}
            windowWidth={windowWidth}
            error={error}
            committedQuery={committedQuery}
            soulseekUsername={soulseekUsername}
            soulseekPassword={soulseekPassword}
            isSavingSoulseekCredentials={isSavingSoulseekCredentials}
            setSoulseekUsername={setSoulseekUsername}
            setSoulseekPassword={setSoulseekPassword}
            handleSaveSoulseekCredentials={handleSaveSoulseekCredentials}
            renderSoulseekTrackRow={renderSoulseekTrackRow}
            renderSoulseekMirrorTrackRow={renderSoulseekMirrorTrackRow}
            renderTidalTrackRow={renderTidalTrackRow}
            fetchHomeRecommendations={fetchHomeRecommendations}
            isRecommending={isRecommending}
            recommendedTracks={recommendedTracks}
            artistArtworkOverrides={artistArtworkOverrides}
            openArtist={openArtist}
            openAlbum={openAlbum}
            openPlaylist={openPlaylist}
            isSoulseekSource={isSoulseekSource}
            activeTab={activeTab}
            visibleAlbumResults={visibleAlbumResults}
            visibleArtistResults={visibleArtistResults}
            visiblePlaylistResults={visiblePlaylistResults}
        />
    ), [
        accentColor,
        activeTab,
        artistArtworkOverrides,
        committedQuery,
        error,
        fetchHomeRecommendations,
        handleSaveSoulseekCredentials,
        isRecommending,
        isSavingSoulseekCredentials,
        isSoulseekSource,
        openAlbum,
        openArtist,
        openPlaylist,
        recommendedTracks,
        renderSoulseekMirrorTrackRow,
        renderSoulseekTrackRow,
        renderTidalTrackRow,
        setSoulseekPassword,
        setSoulseekUsername,
        soulseekPassword,
        soulseekUsername,
        theme.colors,
        visibleAlbumResults,
        visibleArtistResults,
        visiblePlaylistResults,
        windowWidth,
    ]);
    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
                <FlashList
                    data={virtualListData}
                    extraData={virtualListExtraData}
                    renderItem={renderVirtualListItem}
                    keyExtractor={virtualListKeyExtractor}
                    ListHeaderComponent={virtualListHeader}
                    contentContainerStyle={virtualListContentStyle}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="none"
                    drawDistance={640}
                    getItemType={getVirtualListItemType}
                />
            </SafeAreaView>

            <TidalSettingsSheets
                mirror={{
                    visible: showMirrorModal,
                    selectedMirror: tidalMirror,
                    recommendedMirrors,
                    legacyMirrors,
                    availability: mirrorAvailability,
                    showLegacy: showLegacyMirrors,
                    accentColor,
                    onClose: () => setShowMirrorModal(false),
                    onSelect: handleMirrorChange,
                    onToggleLegacy: () => setShowLegacyMirrors(value => !value),
                }}
                quality={{
                    visible: showQualityModal,
                    selectedQuality: tidalDownloadQuality,
                    onClose: () => setShowQualityModal(false),
                    onSelect: quality => {
                        setTidalDownloadQuality(quality);
                        setShowQualityModal(false);
                    },
                }}
                settings={{
                    visible: showSettingsSheet,
                    onClose: () => setShowSettingsSheet(false),
                    onOpenQuality: () => {
                        setShowSettingsSheet(false);
                        setShowQualityModal(true);
                    },
                    onOpenMirrors: () => {
                        setShowSettingsSheet(false);
                        setShowMirrorModal(true);
                    },
                    onOpenSoulseek: () => {
                        setShowSettingsSheet(false);
                        setShowSoulseekAuthModal(true);
                    },
                }}
                soulseekAuth={{
                    visible: showSoulseekAuthModal,
                    username: soulseekUsername,
                    password: soulseekPassword,
                    isSaving: isSavingSoulseekCredentials,
                    onClose: () => setShowSoulseekAuthModal(false),
                    onUsernameChange: setSoulseekUsername,
                    onPasswordChange: setSoulseekPassword,
                    onSave: handleSaveSoulseekCredentials,
                }}
            />
        </View>
    );
}
