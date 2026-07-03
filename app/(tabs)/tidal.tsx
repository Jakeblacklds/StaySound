import { EmptyState, Skeleton, TidalCoverCard, TidalTrackRow } from '@/src/components/ui';
import {
    GlassPanel,
    MediaRail,
    MediaRailItem,
    OptionRow,
    SectionHeader,
    TidalBottomSheet,
} from '@/src/components/tidal';
import { Ionicons } from '@expo/vector-icons';
import { useTidalDownload } from '@/src/hooks';
import { getSoulseekCredentials, searchSoulseekTracksByQuery, setSoulseekCredentials, SoulseekCompressedFallbackError, type SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import { FileSystemStorage } from '@/src/services/storage';
import {
    createTidalStreamTrack,
    getTidalAlbumDetail,
    getTidalArtistInfo,
    getTidalMirrorAvailability,
    getTidalMirrorOptions,
    getTidalSimilarArtists,
    getTidalTrackRecommendations,
    isValidAudioFile,
    searchTidal,
    searchTidalAlbums,
    searchTidalArtists,
    searchTidalPlaylists,
    TIDAL_API_BASES,
    TIDAL_MIRROR_NAMES,
    TidalMirrorAvailability,
} from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalPlaylist, TidalTrack } from '@/src/types/audio';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useRootNavigationState } from 'expo-router';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, InteractionManager, Keyboard, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Searchbar, Text, TextInput } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TidalTab = 'all' | 'artists' | 'albums' | 'tracks' | 'playlists';
type TidalSourceTab = 'tidal' | 'soulseek';
type DownloadSource = TidalSourceTab;
type SoulseekFolderGroup = {
    key: string;
    username: string;
    folderPath: string;
    results: SoulseekSearchResult[];
};
type TidalVirtualListItem =
    | { type: 'auth' }
    | { type: 'loading' }
    | { type: 'error' }
    | { type: 'soulseek-empty' }
    | { type: 'soulseek-summary'; count: number }
    | { type: 'soulseek-folder-header'; group: SoulseekFolderGroup }
    | { type: 'soulseek-track'; result: SoulseekSearchResult }
    | { type: 'home' }
    | { type: 'empty' }
    | { type: 'feature'; artist: TidalArtist }
    | { type: 'label'; key: string; label: string }
    | { type: 'track'; track: TidalTrack }
    | { type: 'albums-rail' }
    | { type: 'artists-rail' }
    | { type: 'playlists-rail' };
const RECENT_SEARCHES_STORAGE_KEY = 'tidal-recent-searches';
const MAX_RECENT_SEARCHES = 8;
const SOULSEEK_FLOW_LOG = '[SoulseekFlow]';
function formatRecentSearchTitle(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return 'Busqueda';
    return trimmed.length > 26 ? `${trimmed.slice(0, 26).trim()}…` : trimmed;
}

function formatTrackDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSoulseekMatchLabel(match: SoulseekSearchResult['match']): string {
    const extension = (match.extension || match.format || '').toString().replace(/^\./, '').toUpperCase();
    const bitrate = typeof match.bitRate === 'number' && match.bitRate > 0
        ? `${Math.round(match.bitRate)} kbps`
        : '';
    return [extension, bitrate].filter(Boolean).join(' · ');
}

function splitSoulseekResultPath(filename: string): string[] {
    return filename
        .replace(/\//g, '\\')
        .split('\\')
        .map(segment => segment.trim())
        .filter(Boolean);
}

function getSoulseekLeafFilename(filename: string): string {
    const segments = splitSoulseekResultPath(filename);
    if (segments.length === 0) return filename.trim();
    return segments[segments.length - 1] || filename.trim();
}

function stripSoulseekLeafExtension(value: string): string {
    return value.replace(/\.[a-z0-9]+$/i, '').trim();
}

function getSoulseekFolderPath(filename: string): string {
    const segments = splitSoulseekResultPath(filename);
    if (segments.length <= 1) return 'Raiz compartida';
    return segments.slice(0, -1).join(' \\ ');
}

function normalizeTrackText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Bounded edit distance between two short strings (Levenshtein).
function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array<number>(bl + 1);
    let curr = new Array<number>(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
        curr[0] = i;
        const ai = a.charCodeAt(i - 1);
        for (let j = 1; j <= bl; j++) {
            const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[bl];
}

// 0..1 score of how well `candidate` matches the typed `query`, tolerant to typos
// and word order. Used to re-rank API results so the closest match floats to the top.
function fuzzyRelevance(query: string, candidate: string): number {
    const q = normalizeTrackText(query);
    const c = normalizeTrackText(candidate);
    if (!q || !c) return 0;
    if (c === q) return 1;
    if (c.startsWith(q)) return 0.95;
    if (c.includes(q)) return 0.85;

    const qTokens = q.split(' ').filter(Boolean);
    const cTokens = c.split(' ').filter(Boolean);
    let tokenScore = 0;
    for (const qt of qTokens) {
        let best = 0;
        for (const ct of cTokens) {
            if (ct === qt) { best = 1; break; }
            if (ct.startsWith(qt) || qt.startsWith(ct)) { best = Math.max(best, 0.8); continue; }
            const dist = levenshtein(qt, ct);
            best = Math.max(best, 1 - dist / Math.max(qt.length, ct.length));
        }
        tokenScore += best;
    }
    tokenScore = qTokens.length ? tokenScore / qTokens.length : 0;

    const whole = 1 - levenshtein(q, c) / Math.max(q.length, c.length);
    return Math.max(tokenScore, whole) * 0.8;
}

// Stable re-rank by fuzzy relevance (ties keep the original API order).
function rankByRelevance<T>(items: T[], query: string, getText: (item: T) => string): T[] {
    const trimmed = query.trim();
    if (!trimmed || items.length < 2) return items;
    return items
        .map((item, index) => ({ item, index, score: fuzzyRelevance(trimmed, getText(item)) }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map(entry => entry.item);
}

function scoreDownloadCandidate(source: TidalTrack, candidate: TidalTrack): number {
    let score = 0;

    if (source.id === candidate.id) score += 100;

    const sourceTitle = normalizeTrackText(source.title);
    const sourceArtist = normalizeTrackText(source.artist);
    const sourceAlbum = normalizeTrackText(source.album);
    const candidateTitle = normalizeTrackText(candidate.title);
    const candidateArtist = normalizeTrackText(candidate.artist);
    const candidateAlbum = normalizeTrackText(candidate.album);

    if (sourceTitle === candidateTitle) score += 50;
    else if (sourceTitle && candidateTitle && (sourceTitle.includes(candidateTitle) || candidateTitle.includes(sourceTitle))) score += 20;

    if (sourceArtist === candidateArtist) score += 40;
    else if (sourceArtist && candidateArtist && (sourceArtist.includes(candidateArtist) || candidateArtist.includes(sourceArtist))) score += 15;

    if (sourceAlbum && sourceAlbum === candidateAlbum) score += 15;

    if (source.durationMs > 0 && candidate.durationMs > 0) {
        const delta = Math.abs(source.durationMs - candidate.durationMs);
        if (delta <= 1200) score += 20;
        else if (delta <= 4000) score += 10;
    }

    return score;
}

const GRID_GAP = 12;
const SEARCH_COMMIT_DELAY_MS = 350;

function normalizeCardImageUri(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    return trimmed
        .replace('100x100', '500x500')
        .replace('200x200', '500x500')
        .replace('300x300', '500x500');
}

function formatMirrorStatus(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Verificando disponibilidad...';
    if (availability.status === 'available') {
        return availability.latencyMs ? `Disponible (${availability.latencyMs} ms)` : 'Disponible';
    }
    if (availability.status === 'slow') {
        return availability.latencyMs ? `Lento (${availability.latencyMs} ms)` : 'Disponible con latencia alta';
    }
    return 'No disponible ahora';
}

function formatMirrorCapabilities(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Busqueda ?, Stream ?, Descarga ?';
    const search = availability.supportsSearch ? 'Busqueda OK' : 'Busqueda KO';
    const stream = availability.supportsStream ? 'Stream OK' : 'Stream KO';
    const download = availability.supportsDownload ? 'Descarga OK' : 'Descarga KO';
    return `${search} · ${stream} · ${download}`;
}

function getPrimaryMirrorOptions(availableMirrors: string[]): string[] {
    const pinnedMirrors = [
        'https://hifi.geeked.wtf',
        'https://eu-central.monochrome.tf',
        'https://api.monochrome.tf',
    ];

    return [...pinnedMirrors, ...availableMirrors.slice(0, 3)]
        .filter((mirror, index, all) => availableMirrors.includes(mirror) && all.indexOf(mirror) === index);
}

export default function TidalScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const coverSize = Math.floor((windowWidth - 32 - GRID_GAP) / 2);

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
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [searchRunId, setSearchRunId] = useState(0);
    const [activeSourceTab, setActiveSourceTab] = useState<TidalSourceTab>('tidal');
    const [activeTab, setActiveTab] = useState<TidalTab>('all');
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
    const [soulseekUsername, setSoulseekUsername] = useState('');
    const [soulseekPassword, setSoulseekPassword] = useState('');
    const [hasSoulseekCredentials, setHasSoulseekCredentials] = useState(false);
    const [isSavingSoulseekCredentials, setIsSavingSoulseekCredentials] = useState(false);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const [showLegacyMirrors, setShowLegacyMirrors] = useState(false);
    const rootNavigationState = useRootNavigationState();
    const canNavigate = Boolean(rootNavigationState?.key);
    const [showSettingsSheet, setShowSettingsSheet] = useState(false);
    const accentColor = theme.colors.primary;
    const [mirrorAvailability, setMirrorAvailability] = useState<Record<string, TidalMirrorAvailability>>({});
    const [isRefreshingMirrors, setIsRefreshingMirrors] = useState(false);
    const [recommendedArtists, setRecommendedArtists] = useState<TidalArtist[]>([]);
    const [recommendedTracks, setRecommendedTracks] = useState<TidalTrack[]>([]);
    const [isRecommending, setIsRecommending] = useState(false);
    const {
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror
    } = useSettingsStore();

    const showNotification = useNotificationStore(s => s.showNotification);

    useEffect(() => {
        let cancelled = false;

        FileSystemStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)
            .then(raw => {
                if (!raw || cancelled) return;
                try {
                    const parsed = JSON.parse(raw) as unknown;
                    if (!Array.isArray(parsed)) return;
                    const nextRecent = parsed
                        .filter((value): value is string => typeof value === 'string')
                        .map(value => value.trim())
                        .filter(Boolean)
                        .slice(0, MAX_RECENT_SEARCHES);
                    if (!cancelled) {
                        setRecentSearches(nextRecent);
                    }
                } catch {
                    // ignore invalid persisted history
                }
            })
            .catch(() => {
                // ignore storage errors
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        getSoulseekCredentials()
            .then((saved) => {
                if (cancelled || !saved) return;
                setSoulseekUsername(saved.username);
                setSoulseekPassword(saved.password);
                setHasSoulseekCredentials(true);
            })
            .catch(() => {
                // ignore
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleSaveSoulseekCredentials = useCallback(async () => {
        const username = soulseekUsername.trim();
        const password = soulseekPassword.trim();
        if (!username || !password) {
            showNotification('Usuario y password son obligatorios.', 'error');
            return;
        }

        setIsSavingSoulseekCredentials(true);
        try {
            await setSoulseekCredentials(username, password);
            setHasSoulseekCredentials(true);
            setSoulseekError(null);
            showNotification('Sesion de Soulseek guardada.', 'success');
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : 'No se pudo guardar la sesion de Soulseek';
            showNotification(message, 'error');
        } finally {
            setIsSavingSoulseekCredentials(false);
        }
    }, [showNotification, soulseekPassword, soulseekUsername]);

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
    const activeTabRef = useRef<TidalTab>('all');
    const activeSourceTabRef = useRef<TidalSourceTab>('tidal');
    const soulseekResultCommitRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);

    useEffect(() => {
        activeSourceTabRef.current = activeSourceTab;
    }, [activeSourceTab]);

    useEffect(() => {
        return () => {
            soulseekResultCommitRef.current?.cancel();
            soulseekResultCommitRef.current = null;
        };
    }, []);

    const commitSoulseekResults = useCallback((
        nextResults: SoulseekSearchResult[],
        afterCommit?: () => void,
        shouldCommit: () => boolean = () => true,
    ) => {
        soulseekResultCommitRef.current?.cancel();
        soulseekResultCommitRef.current = InteractionManager.runAfterInteractions(() => {
            soulseekResultCommitRef.current = null;
            if (!shouldCommit()) return;
            startTransition(() => {
                setSoulseekResults(nextResults);
                afterCommit?.();
            });
        });
    }, []);

    const {
        downloads,
        download,
        downloadFromSoulseek,
        downloadFromSoulseekMatch,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    } = useTidalDownload({ qobuzOnly: true });

    const play = usePlayerStore(s => s.play);
    const currentPlayerTrack = usePlayerStore(s => s.currentTrack);
    const pendingTrackPreview = usePlayerStore(s => s.pendingTrackPreview);
    const isPlayerPlaying = usePlayerStore(s => s.isPlaying);
    const setPendingTrackPreview = usePlayerStore(s => s.setPendingTrackPreview);
    const activeTidalTrackId = useMemo(() => {
        const sourceTrack = pendingTrackPreview ?? currentPlayerTrack;
        if (!sourceTrack) return null;
        if (typeof sourceTrack.tidalId === 'number') return sourceTrack.tidalId;

        const match = sourceTrack.id?.match(/tidal(?:_stream)?_(\d+)/);
        return match ? Number(match[1]) : null;
    }, [currentPlayerTrack, pendingTrackPreview]);

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
        if (source === 'tidal') {
            setActiveTab(tab);
        }
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
            setRecentSearches(prev => {
                const nextRecent = [trimmed, ...prev.filter(item => item.toLowerCase() !== trimmed.toLowerCase())]
                    .slice(0, MAX_RECENT_SEARCHES);
                void FileSystemStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(nextRecent));
                return nextRecent;
            });
        }
    }, [activeSourceTab, activeTab, committedQuery, hasResolvedSearch]);

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
        // ── Always search Tidal regardless of source tab ──
        // The Soulseek tab reuses this metadata to find the best match
        // via handleSoulseekOnlyDownload / renderSoulseekMirrorTrackRow.
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

        if (activeSourceTab === 'soulseek') {
            setTracks([]);
            setArtists([]);
            setAlbums([]);
            setPlaylists([]);
            setArtistArtworkOverrides(new Map());
            artistArtworkAttempted.current.clear();
            setHasResolvedSearch(true);
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

    useEffect(() => {
        const currentQuery = committedQuery.trim();
        if (activeSourceTab !== 'soulseek' || !currentQuery || !hasSoulseekCredentials) {
            setSoulseekResults([]);
            setSoulseekError(null);
            setHasResolvedSoulseekSearch(false);
            setIsSoulseekLoading(false);
            return;
        }

        const controller = new AbortController();
        let cancelled = false;

        setSoulseekResults([]);
        setSoulseekError(null);
        setHasResolvedSoulseekSearch(false);
        setIsSoulseekLoading(true);
        console.log(`${SOULSEEK_FLOW_LOG} native search start`, {
            query: currentQuery,
            run: searchRunId,
        });

        searchSoulseekTracksByQuery(currentQuery, tidalDownloadQuality, controller.signal)
            .then((nextResults) => {
                if (cancelled) return;
                console.log(`${SOULSEEK_FLOW_LOG} native search result`, {
                    query: currentQuery,
                    results: nextResults.length,
                    folders: new Set(nextResults.map(result => `${result.match.username}:${getSoulseekFolderPath(result.match.filename || '')}`)).size,
                });
                commitSoulseekResults(nextResults, () => {
                    setHasResolvedSoulseekSearch(true);
                    setIsSoulseekLoading(false);
                }, () => !cancelled && !controller.signal.aborted);
            })
            .catch((searchError: unknown) => {
                if (cancelled || controller.signal.aborted) return;
                const message = searchError instanceof Error ? searchError.message : 'No se pudo consultar Soulseek';
                console.log(`${SOULSEEK_FLOW_LOG} native search error`, {
                    query: currentQuery,
                    message,
                });
                setSoulseekError(message);
                setSoulseekResults([]);
                setHasResolvedSoulseekSearch(true);
                setIsSoulseekLoading(false);
            });

        return () => {
            cancelled = true;
            controller.abort();
            soulseekResultCommitRef.current?.cancel();
            soulseekResultCommitRef.current = null;
        };
    }, [activeSourceTab, commitSoulseekResults, committedQuery, hasSoulseekCredentials, searchRunId, tidalDownloadQuality]);

    const handleSoulseekMatchDownload = useCallback(async (
        result: SoulseekSearchResult,
        allowCompressedFallback = false,
    ) => {
        const track = result.track;
        try {
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            await downloadFromSoulseekMatch(track, result.match, { allowCompressedFallback });
            showNotification(`Descarga lista: ${track.title}`, 'success');
        } catch (downloadError) {
            if (downloadError instanceof SoulseekCompressedFallbackError) {
                Alert.alert(
                    'No hay FLAC disponible',
                    'Descargar en calidad comprimida.',
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                            text: 'Descargar',
                            onPress: () => {
                                void handleSoulseekMatchDownload(result, true);
                            },
                        },
                    ],
                );
                return;
            }

            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [cancelDownload, downloadFromSoulseekMatch, downloads, showNotification]);

    const handleSoulseekMatchPlay = useCallback(async (result: SoulseekSearchResult) => {
        const track = result.track;

        try {
            const existing = getDownloadedTrack(track.id);
            if (existing) {
                await play(existing, [existing]);
                return;
            }

            await handleSoulseekMatchDownload(result);
            const downloadedTrack = getDownloadedTrack(track.id);
            if (downloadedTrack) {
                await play(downloadedTrack, [downloadedTrack]);
            }
        } catch (playError) {
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir esta pista';
            showNotification(message, 'error');
        }
    }, [getDownloadedTrack, handleSoulseekMatchDownload, play, showNotification]);

    const handleTidalPlay = useCallback(async (track: TidalTrack) => {
        if (activeSourceTabRef.current === 'soulseek') {
            console.log(`${SOULSEEK_FLOW_LOG} blocked tidal play in soulseek tab`, {
                id: track.id,
                title: track.title,
                artist: track.artist,
            });
            return;
        }

        console.log(`${SOULSEEK_FLOW_LOG} tidal play start`, {
            id: track.id,
            title: track.title,
            artist: track.artist,
            activeSourceRef: activeSourceTabRef.current,
        });
        setPendingTrackPreview({
            id: `tidal_pending_${track.id}`,
            title: track.title,
            artist: track.artist,
            artwork: track.artworkUrl,
            tidalId: track.id,
        });

        try {
            const downloadedTrack = getDownloadedTrack(track.id);
            if (downloadedTrack) {
                const extension = downloadedTrack.uri.split('.').pop()?.toLowerCase() || 'flac';
                const validLocal = await isValidAudioFile(downloadedTrack.uri, extension);
                if (!validLocal) {
                    await forgetDownloadedTrack(track.id);
                    await download(track);

                    const repairedTrack = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                    if (!repairedTrack) {
                        throw new Error('Se detecto archivo invalido y no se pudo reparar');
                    }

                    await play(repairedTrack, [repairedTrack]);
                    return;
                }

                await play(downloadedTrack, [downloadedTrack]);
                return;
            }

            try {
                const streamTrack = await createTidalStreamTrack(track, { qobuzOnly: true });
                await play(streamTrack, [streamTrack]);
            } catch (streamError) {
                const message = streamError instanceof Error ? streamError.message : '';
                const requiresPreparation = message.includes('Segmented manifest') || message.includes('not a direct audio file');

                if (!requiresPreparation) {
                    throw streamError;
                }

                Alert.alert('Preparando reproduccion', 'Este track requiere descarga local para reproducirse.');
                await download(track);

                const localTrack = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                if (!localTrack) {
                    throw new Error('No se pudo preparar el archivo local');
                }

                await play(localTrack, [localTrack]);
            }
        } catch (playError) {
            setPendingTrackPreview(null);
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir esta pista';
            showNotification(message, 'error');
        }
    }, [download, forgetDownloadedTrack, getDownloadedTrack, play, setPendingTrackPreview, showNotification]);

    const handleTidalDownload = useCallback(async (track: TidalTrack, source: DownloadSource = 'tidal') => {
        try {
            console.log(`${SOULSEEK_FLOW_LOG} download pressed`, {
                source,
                activeSourceTab,
                activeSourceRef: activeSourceTabRef.current,
                id: track.id,
                title: track.title,
                artist: track.artist,
            });
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            const isSoulseekDownloadSource = source === 'soulseek';
            let resolvedTrack = track;
            if (!isSoulseekDownloadSource) {
                try {
                    let candidates: TidalTrack[] = [];

                    if (track.albumId) {
                        const albumDetail = await getTidalAlbumDetail(track.albumId);
                        candidates = albumDetail.tracks;
                    }

                    if (candidates.length === 0) {
                        candidates = await searchTidal(`${track.artist} ${track.title}`.trim());
                    }

                    if (candidates.length > 0) {
                        const bestMatch = [...candidates]
                            .map(candidate => ({ candidate, score: scoreDownloadCandidate(track, candidate) }))
                            .sort((a, b) => b.score - a.score)[0];

                        if (bestMatch && bestMatch.score >= 55) {
                            resolvedTrack = {
                                ...bestMatch.candidate,
                                artworkUrl: bestMatch.candidate.artworkUrl ?? track.artworkUrl,
                                albumId: bestMatch.candidate.albumId ?? track.albumId,
                                artistId: bestMatch.candidate.artistId ?? track.artistId,
                            };
                        }
                    }
                } catch {
                    resolvedTrack = track;
                }
            }

            const downloadTargetTrack = isSoulseekDownloadSource
                ? {
                    ...resolvedTrack,
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album || resolvedTrack.album,
                    durationMs: track.durationMs || resolvedTrack.durationMs,
                    artworkUrl: track.artworkUrl ?? resolvedTrack.artworkUrl,
                    artistId: track.artistId ?? resolvedTrack.artistId,
                    albumId: track.albumId ?? resolvedTrack.albumId,
                }
                : resolvedTrack;
            const currentMirror = useSettingsStore.getState().tidalMirror;
            if (isSoulseekDownloadSource) {
                showNotification(`Buscando fuente Soulseek para "${downloadTargetTrack.title}"`, 'info');
            } else if (currentMirror !== 'auto') {
                showNotification(`Bajando desde: ${TIDAL_MIRROR_NAMES[currentMirror] || 'Servidor Manual'}`, 'info');
            } else {
                showNotification(`Iniciando descarga de "${downloadTargetTrack.title}"`, 'info');
            }

            if (isSoulseekDownloadSource) {
                console.log('[TidalScreen] Soulseek download route', {
                    id: downloadTargetTrack.id,
                    title: downloadTargetTrack.title,
                    artist: downloadTargetTrack.artist,
                });
                try {
                    await downloadFromSoulseek(downloadTargetTrack);
                } catch (soulseekError) {
                    if (soulseekError instanceof SoulseekCompressedFallbackError) {
                        Alert.alert(
                            'No hay FLAC',
                            'Soulseek encontro MP3 para esta cancion.',
                            [
                                { text: 'Cancelar', style: 'cancel' },
                                {
                                    text: 'Descargar MP3',
                                    onPress: () => {
                                        void downloadFromSoulseek(downloadTargetTrack, { allowCompressedFallback: true });
                                    },
                                },
                            ],
                        );
                        return;
                    }
                    throw soulseekError;
                }
                return;
            }

            await download(downloadTargetTrack, false, { throwOnError: true });
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [cancelDownload, download, downloadFromSoulseek, downloads, showNotification]);

    const handleSoulseekOnlyDownload = useCallback(async (track: TidalTrack) => {
        try {
            console.log(`${SOULSEEK_FLOW_LOG} soulseek-only button pressed`, {
                activeSourceTab,
                activeSourceRef: activeSourceTabRef.current,
                id: track.id,
                title: track.title,
                artist: track.artist,
            });

            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            const soulseekTrack = {
                ...track,
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                durationMs: track.durationMs,
                artworkUrl: track.artworkUrl,
                artistId: track.artistId,
                albumId: track.albumId,
            };

            showNotification(`Buscando fuente Soulseek para "${soulseekTrack.title}"`, 'info');
            console.log(`${SOULSEEK_FLOW_LOG} soulseek-only route`, {
                id: soulseekTrack.id,
                title: soulseekTrack.title,
                artist: soulseekTrack.artist,
            });

            try {
                await downloadFromSoulseek(soulseekTrack);
            } catch (soulseekError) {
                if (soulseekError instanceof SoulseekCompressedFallbackError) {
                    Alert.alert(
                        'No hay FLAC',
                        'Soulseek encontro MP3 para esta cancion.',
                        [
                            { text: 'Cancelar', style: 'cancel' },
                            {
                                text: 'Descargar MP3',
                                onPress: () => {
                                    void downloadFromSoulseek(soulseekTrack, { allowCompressedFallback: true });
                                },
                            },
                        ],
                    );
                    return;
                }
                throw soulseekError;
            }
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [activeSourceTab, cancelDownload, downloadFromSoulseek, downloads, showNotification]);

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

    const handleSourceTabChange = useCallback((nextSource: TidalSourceTab) => {
        console.log(`${SOULSEEK_FLOW_LOG} source tab press`, {
            from: activeSourceTab,
            to: nextSource,
            currentRef: activeSourceTabRef.current,
            query: query.trim(),
            committedQuery: committedQuery.trim(),
        });
        if (nextSource === activeSourceTab) {
            console.log(`${SOULSEEK_FLOW_LOG} source tab unchanged`, {
                source: nextSource,
            });
            return;
        }

        activeSourceTabRef.current = nextSource;
        setActiveSourceTab(nextSource);
        if (nextSource === 'soulseek') {
            setActiveTab('tracks');
            activeTabRef.current = 'tracks';
        }
        console.log(`${SOULSEEK_FLOW_LOG} source ref updated`, {
            nextSource,
            ref: activeSourceTabRef.current,
        });
        if (query.trim()) {
            triggerSearch(query, activeTabRef.current, nextSource);
            return;
        }

        const committed = committedQuery.trim();
        if (committed) {
            triggerSearch(committed, activeTabRef.current, nextSource);
            return;
        }

        setHasResolvedSearch(false);
        setHasResolvedSoulseekSearch(false);
        setError(null);
        setSoulseekError(null);
        setIsLoading(false);
        setIsSoulseekLoading(false);
    }, [activeSourceTab, committedQuery, query, triggerSearch]);

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

    const renderTidalTrackRow = useCallback((track: TidalTrack) => {
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

        return (
            <TidalTrackRow
                title={track.title}
                artist={track.artist}
                artworkUrl={normalizeCardImageUri(track.artworkUrl)}
                durationMs={track.durationMs}
                tone="glass"
                accentColor={accentColor}
                isActive={isTrackActive}
                isPlaying={isPlayerPlaying}
                downloadStatus={isDownloadingItem ? 'downloading' : downloaded ? 'done' : isError ? 'error' : 'idle'}
                progress={state?.progress ?? 0}
                onPress={() => handleTidalPlay(track)}
                onDownloadPress={() => void handleTidalDownload(track, 'tidal')}
            />
        );
    }, [accentColor, activeTidalTrackId, downloads, handleTidalDownload, handleTidalPlay, isDownloaded, isPlayerPlaying, pendingTrackPreview]);

    const renderSoulseekMirrorTrackRow = useCallback((track: TidalTrack) => {
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

        return (
            <TidalTrackRow
                title={track.title}
                artist={track.artist}
                artworkUrl={normalizeCardImageUri(track.artworkUrl)}
                durationMs={track.durationMs}
                tone="glass"
                accentColor={accentColor}
                isActive={isTrackActive}
                isPlaying={isPlayerPlaying}
                downloadStatus={isDownloadingItem ? 'downloading' : downloaded ? 'done' : isError ? 'error' : 'idle'}
                progress={state?.progress ?? 0}
                onPress={() => void handleSoulseekOnlyDownload(track)}
                onDownloadPress={() => void handleSoulseekOnlyDownload(track)}
            />
        );
    }, [accentColor, activeTidalTrackId, downloads, handleSoulseekOnlyDownload, isDownloaded, isPlayerPlaying, pendingTrackPreview]);

    const renderSoulseekTrackRow = useCallback((result: SoulseekSearchResult) => {
        const track = result.track;
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);
        const formatLabel = formatSoulseekMatchLabel(result.match);
        const rawLeafFilename = getSoulseekLeafFilename(result.match.filename || '');
        const normalizedLeaf = normalizeTrackText(stripSoulseekLeafExtension(rawLeafFilename));
        const normalizedTitle = normalizeTrackText(track.title || '');
        const showRawLeafFilename = normalizedLeaf.length > 0 && normalizedLeaf !== normalizedTitle;
        const subtitleArtist = track.artist || result.match.username;

        return (
            <TidalTrackRow
                title={track.title}
                artist={`${subtitleArtist}${formatLabel ? ` · ${formatLabel}` : ''}`}
                durationMs={track.durationMs > 0 ? track.durationMs : undefined}
                showArtwork
                tone="glass"
                accentColor={accentColor}
                isActive={isTrackActive}
                isPlaying={isPlayerPlaying}
                extraLine={showRawLeafFilename ? rawLeafFilename : undefined}
                downloadStatus={isDownloadingItem ? 'downloading' : downloaded ? 'done' : isError ? 'error' : 'idle'}
                progress={state?.progress ?? 0}
                onPress={() => handleSoulseekMatchPlay(result)}
                onDownloadPress={() => void handleSoulseekMatchDownload(result)}
            />
        );
    }, [accentColor, activeTidalTrackId, downloads, handleSoulseekMatchDownload, handleSoulseekMatchPlay, isDownloaded, isPlayerPlaying, pendingTrackPreview]);


    const [isFocused, setIsFocused] = useState(false);
    const [availableMirrors, setAvailableMirrors] = useState<string[]>(() => [
        ...TIDAL_API_BASES,
    ].filter((mirror, index, all) => all.indexOf(mirror) === index));
    const recommendedMirrors = useMemo(
        () => getPrimaryMirrorOptions(availableMirrors),
        [availableMirrors],
    );
    const legacyMirrors = useMemo(
        () => availableMirrors.filter(mirror => !recommendedMirrors.includes(mirror)),
        [availableMirrors, recommendedMirrors],
    );
    const qualityModalOptions = useMemo(
        () => ['LOSSLESS', 'MP3', 'HI_RES_LOSSLESS', 'LOW'] as const,
        [],
    );
    const activeMirrorAvailability = useMemo(() => {
        if (tidalMirror !== 'auto') {
            return mirrorAvailability[tidalMirror];
        }

        const knownAvailabilities = availableMirrors
            .map(mirror => mirrorAvailability[mirror])
            .filter((entry): entry is TidalMirrorAvailability => Boolean(entry));

        if (knownAvailabilities.length === 0) return undefined;

        const preferred = knownAvailabilities.find(
            entry => entry.status === 'available' && entry.supportsSearch && entry.supportsStream,
        );
        if (preferred) return preferred;

        const slowCapable = knownAvailabilities.find(
            entry => entry.status === 'slow' && entry.supportsSearch,
        );
        return slowCapable ?? knownAvailabilities[0];
    }, [availableMirrors, mirrorAvailability, tidalMirror]);
    const searchHealthBanner = useMemo(() => {
        if (!activeMirrorAvailability) return null;

        const searchOk = activeMirrorAvailability.supportsSearch;
        const streamOk = activeMirrorAvailability.supportsStream;
        const downloadOk = activeMirrorAvailability.supportsDownload;

        if (activeMirrorAvailability.status === 'unavailable' || (!searchOk && !streamOk && !downloadOk)) {
            return {
                tone: 'error' as const,
            };
        }

        if (activeMirrorAvailability.status === 'slow') {
            return {
                tone: 'warning' as const,
            };
        }

        if (!streamOk && !downloadOk) {
            return {
                tone: 'error' as const,
            };
        }

        if (!streamOk) {
            return {
                tone: 'error' as const,
            };
        }

        if (!downloadOk) {
            return {
                tone: 'warning' as const,
            };
        }

        if (!searchOk) {
            return {
                tone: 'warning' as const,
            };
        }

        return null;
    }, [activeMirrorAvailability]);
    const refreshMirrorAvailability = useCallback(async (force = false) => {
        setIsRefreshingMirrors(true);
        try {
            const nextMirrors = await getTidalMirrorOptions({ force });
            setAvailableMirrors(nextMirrors);
            const nextAvailability = await getTidalMirrorAvailability(nextMirrors, { force });
            setMirrorAvailability(nextAvailability);
        } finally {
            setIsRefreshingMirrors(false);
        }
    }, []);

    useEffect(() => {
        void refreshMirrorAvailability(false);
    }, [refreshMirrorAvailability]);

    useEffect(() => {
        if (!showMirrorModal) return;
        void refreshMirrorAvailability(true);
    }, [refreshMirrorAvailability, showMirrorModal]);

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
        { key: 'all' as const, label: 'Todo' },
        { key: 'artists' as const, label: 'Artistas' },
        { key: 'albums' as const, label: 'Álbumes' },
        { key: 'playlists' as const, label: 'Playlists' },
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
        if (activeSourceTab === 'soulseek' && !hasSoulseekCredentials) {
            return [{ type: 'auth' }];
        }

        if (isSoulseekSource ? isSoulseekLoading : isLoading) {
            return [{ type: 'loading' }];
        }

        if (isSoulseekSource ? soulseekError : error) {
            return [{ type: 'error' }];
        }

        if (isSoulseekSource && hasCommittedQuery) {
            if (hasResolvedSoulseekSearch && soulseekFolderGroups.length === 0) {
                return [{ type: 'soulseek-empty' }];
            }

            const nextItems: TidalVirtualListItem[] = [{ type: 'soulseek-summary', count: soulseekResults.length }];
            for (const group of soulseekFolderGroups) {
                nextItems.push({ type: 'soulseek-folder-header', group });
                for (const result of group.results) {
                    nextItems.push({ type: 'soulseek-track', result });
                }
            }
            return nextItems;
        }

        if (!hasQuery && !isFocused) {
            return [{ type: 'home' }];
        }

        if (hasResolvedSearch && !tracks.length && !albums.length && !artists.length && !playlists.length) {
            return [{ type: 'empty' }];
        }

        const showArtists = activeTab === 'all' || activeTab === 'artists';
        const showAlbums = activeTab === 'all' || activeTab === 'albums';
        const showPlaylists = activeTab === 'all' || activeTab === 'playlists';
        const showTracks = activeTab === 'all' || activeTab === 'tracks';

        const nextItems: TidalVirtualListItem[] = [];
        if (showArtists && visibleArtistResults.length > 0) {
            if (activeTab === 'artists') {
                nextItems.push({ type: 'label', key: 'label-artists', label: 'Artistas' });
                nextItems.push({ type: 'artists-rail' });
            } else {
                nextItems.push({ type: 'feature', artist: visibleArtistResults[0] });
            }
        }
        if (showTracks && visibleTrackResults.length > 0) {
            nextItems.push({ type: 'label', key: 'label-tracks', label: 'Canciones' });
            for (const track of visibleTrackResults) {
                nextItems.push({ type: 'track', track });
            }
        }
        if (showAlbums && visibleAlbumResults.length > 0) {
            nextItems.push({ type: 'label', key: 'label-albums', label: 'Álbumes' });
            nextItems.push({ type: 'albums-rail' });
        }
        if (activeTab !== 'artists' && showArtists && visibleArtistResults.length > 1) {
            nextItems.push({ type: 'label', key: 'label-artists', label: 'Más artistas' });
            nextItems.push({ type: 'artists-rail' });
        }
        if (showPlaylists && visiblePlaylistResults.length > 0) {
            nextItems.push({ type: 'label', key: 'label-playlists', label: 'Playlists' });
            nextItems.push({ type: 'playlists-rail' });
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

    const virtualListHeader = useMemo(() => (
        <>
            <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                    <View style={styles.headerTitleBlock}>
                        <Text style={[styles.headerKicker, { color: accentColor }]}>EXPLORAR</Text>
                        <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>Buscar</Text>
                    </View>
                    <Pressable
                        onPress={() => setShowSettingsSheet(true)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.62 : 1 }]}
                    >
                        <Ionicons name="options" size={21} color={theme.colors.onSurface} />
                    </Pressable>
                </View>

                <View style={[
                    styles.searchDock,
                    {
                        backgroundColor: palette.searchBackground,
                        borderColor: isFocused ? withAlpha(accentColor, '8A') : palette.searchBorder,
                    },
                ]}>
                    <Searchbar
                        placeholder="Artistas, canciones, álbumes…"
                        value={query}
                        onChangeText={setQuery}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        onSubmitEditing={handleSubmitSearch}
                        returnKeyType="search"
                        submitBehavior="submit"
                        style={[styles.searchbar, { backgroundColor: 'transparent' }]}
                        iconColor={accentColor}
                        inputStyle={[styles.searchInput, { color: theme.colors.onSurface }]}
                        placeholderTextColor={withAlpha(theme.colors.onSurfaceVariant, '66')}
                    />
                </View>

                <View style={styles.sourceTabsRow}>
                    <Pressable
                        onPress={() => handleSourceTabChange('tidal')}
                        style={styles.sourceTab}
                    >
                        <Text style={[styles.sourceTabLabel, { color: !isSoulseekSource ? theme.colors.onSurface : withAlpha(theme.colors.onSurfaceVariant, 'A0') }]}>
                            Tidal
                        </Text>
                        <View style={[styles.sourceTabUnderline, { backgroundColor: !isSoulseekSource ? accentColor : 'transparent' }]} />
                    </Pressable>
                    <Pressable
                        onPress={() => handleSourceTabChange('soulseek')}
                        style={styles.sourceTab}
                    >
                        <Text style={[styles.sourceTabLabel, { color: isSoulseekSource ? theme.colors.onSurface : withAlpha(theme.colors.onSurfaceVariant, 'A0') }]}>
                            Soulseek
                        </Text>
                        <View style={[styles.sourceTabUnderline, { backgroundColor: isSoulseekSource ? accentColor : 'transparent' }]} />
                    </Pressable>
                </View>
            </View>

            {hasCommittedQuery ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    contentContainerStyle={styles.filterRow}
                    style={styles.filterScroller}
                >
                    {resultTabs.map((tab) => {
                        const selected = activeTab === tab.key;
                        return (
                            <Pressable
                                key={tab.key}
                                onPress={() => setActiveTab(tab.key)}
                                style={[
                                    styles.filterChip,
                                    {
                                        backgroundColor: selected ? accentColor : withAlpha(theme.colors.surfaceVariant, '5A'),
                                        borderColor: selected ? accentColor : palette.cardBorder,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.filterChipLabel,
                                        { color: selected ? theme.colors.onPrimary : theme.colors.onSurfaceVariant },
                                    ]}
                                >
                                    {tab.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            ) : null}

            {searchHealthBanner && (hasCommittedQuery || hasQuery) ? (
                <View
                    style={[
                        styles.searchBanner,
                        {
                            borderColor:
                                searchHealthBanner.tone === 'error'
                                    ? withAlpha(theme.colors.error, '66')
                                    : withAlpha('#F59E0B', '66'),
                            backgroundColor:
                                searchHealthBanner.tone === 'error'
                                    ? withAlpha(theme.colors.error, '14')
                                    : withAlpha('#F59E0B', '14'),
                        },
                    ]}
                >
                    <Text
                        variant="labelSmall"
                        style={[
                            styles.searchBannerText,
                            {
                                color:
                                    searchHealthBanner.tone === 'error'
                                        ? theme.colors.error
                                        : withAlpha(theme.colors.onSurfaceVariant, 'DD'),
                            },
                        ]}
                    >
                        {searchHealthBanner.tone === 'error' ? 'Servicio no disponible.' : 'Servicio inestable.'}
                    </Text>
                </View>
            ) : null}

            {!hasQuery && isFocused && recentSearches.length > 0 ? (
                <View style={styles.recentSection}>
                    <View style={styles.sectionHeader}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Búsquedas recientes</Text>
                    </View>
                    <View style={styles.recentSearchList}>
                        {recentSearches.map((item, index) => (
                            <Pressable
                                key={item}
                                onPress={() => applySuggestion(item)}
                                style={[styles.recentSearchCard, { borderBottomColor: palette.cardBorder }]}
                            >
                                <Text style={[styles.recentSearchIndex, { color: withAlpha(theme.colors.onSurfaceVariant, 'CC') }]}>
                                    {String(index + 1).padStart(2, '0')}
                                </Text>
                                <View style={styles.recentSearchContent}>
                                    <Text numberOfLines={1} style={[styles.recentSearchTitle, { color: theme.colors.onSurface }]}>
                                        {formatRecentSearchTitle(item)}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : null}
        </>
    ), [
        accentColor,
        activeTab,
        applySuggestion,
        handleSourceTabChange,
        handleSubmitSearch,
        hasCommittedQuery,
        hasQuery,
        isFocused,
        isSoulseekSource,
        palette.cardBorder,
        query,
        recentSearches,
        resultTabs,
        searchHealthBanner,
        theme.colors,
    ]);

    const renderVirtualListItem = useCallback(({ item }: ListRenderItemInfo<TidalVirtualListItem>) => {
        switch (item.type) {
            case 'auth':
                return (
                    <View style={styles.centered}>
                        <GlassPanel style={styles.soulseekAuthPanel} radius={radius.xl}>
                            <View style={[styles.soulseekAuthIcon, { backgroundColor: withAlpha(accentColor, '22') }]}>
                                <Ionicons name="lock-closed" size={22} color={accentColor} />
                            </View>
                            <Text style={[styles.soulseekAuthKicker, { color: accentColor }]}>SOULSEEK</Text>
                            <Text variant="titleMedium" style={[styles.soulseekAuthTitle, { color: theme.colors.onBackground }]}>
                                Inicia sesión
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="Usuario"
                                value={soulseekUsername}
                                onChangeText={setSoulseekUsername}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={styles.soulseekAuthInput}
                            />
                            <TextInput
                                mode="outlined"
                                label="Password"
                                value={soulseekPassword}
                                onChangeText={setSoulseekPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                secureTextEntry
                                style={styles.soulseekAuthInput}
                            />
                            <Button
                                mode="contained"
                                onPress={handleSaveSoulseekCredentials}
                                loading={isSavingSoulseekCredentials}
                                disabled={isSavingSoulseekCredentials}
                                contentStyle={styles.soulseekAuthButtonContent}
                            >
                                Guardar
                            </Button>
                        </GlassPanel>
                    </View>
                );
            case 'loading':
                return (
                    <View>
                        <View style={styles.feature}>
                            <Skeleton height={232} width={windowWidth - 32} borderRadius={26} />
                        </View>
                        <View style={styles.labelRow}>
                            <Skeleton height={12} width={90} borderRadius={4} />
                        </View>
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <View key={`s-tra-${i}`} style={styles.songRow}>
                                <Skeleton height={52} width={52} borderRadius={12} />
                                <View style={styles.songCopy}>
                                    <Skeleton height={15} width="70%" borderRadius={4} style={{ marginBottom: 7 }} />
                                    <Skeleton height={12} width="45%" borderRadius={4} />
                                </View>
                                <Skeleton height={26} width={26} borderRadius={13} />
                            </View>
                        ))}
                    </View>
                );
            case 'error':
                return (
                    <View style={styles.centered}>
                        <EmptyState
                            title={isSoulseekSource ? 'No se pudo cargar Soulseek' : 'No se pudo cargar Tidal'}
                            description={(isSoulseekSource ? soulseekError : error) ?? undefined}
                        />
                    </View>
                );
            case 'soulseek-empty':
                return (
                    <View style={styles.centered}>
                        <EmptyState title="Sin resultados" description={`No encontramos resultados para "${committedQuery.trim()}"`} />
                    </View>
                );
            case 'soulseek-summary':
                return (
                    <View style={styles.soulseekSummary}>
                        <SectionHeader kicker="Soulseek" title="Carpetas" meta={`${item.count} pistas`} accent={accentColor} />
                    </View>
                );
            case 'soulseek-folder-header':
                return (
                    <View style={styles.soulseekVirtualGroupHeader}>
                        <View style={[styles.soulseekFolderHeader, { backgroundColor: withAlpha(theme.colors.onSurface, '0C'), borderColor: withAlpha(theme.colors.outline, '3A') }]}>
                            <View style={[styles.soulseekFolderIcon, { backgroundColor: withAlpha(accentColor, '22') }]}>
                                <Ionicons name="folder-open" size={16} color={accentColor} />
                            </View>
                            <View style={styles.soulseekFolderTitleBlock}>
                                <Text numberOfLines={1} style={[styles.soulseekFolderPath, { color: theme.colors.onSurface }]}>
                                    {item.group.folderPath}
                                </Text>
                                <Text numberOfLines={1} style={[styles.soulseekFolderPeer, { color: withAlpha(theme.colors.onSurfaceVariant, 'B8') }]}>
                                    {item.group.username}
                                </Text>
                            </View>
                            <View style={[styles.soulseekFolderBadge, { backgroundColor: withAlpha(theme.colors.onSurface, '14') }]}>
                                <Text style={[styles.soulseekFolderCount, { color: theme.colors.onSurface }]}>
                                    {item.group.results.length}
                                </Text>
                            </View>
                        </View>
                    </View>
                );
            case 'soulseek-track':
                return renderSoulseekTrackRow(item.result);
            case 'home':
                return (
                    <View style={styles.coverWall}>
                        <View>
                            <View style={styles.homeHeaderRow}>
                                <View style={{ gap: 4 }}>
                                    <Text style={[styles.headerKicker, { color: accentColor }]}>PARA TI</Text>
                                    <Text style={[styles.homeTitle, { color: theme.colors.onBackground }]}>Descubre</Text>
                                </View>
                                <Button mode="text" compact onPress={fetchHomeRecommendations} textColor={accentColor}>
                                    Refrescar
                                </Button>
                            </View>
                            {isRecommending && recommendedTracks.length === 0 ? (
                                <View style={styles.coverWallGrid}>
                                    {[1, 2, 3, 4].map((i) => (
                                        <View key={`s-rec-tra-${i}`} style={{ width: coverSize }}>
                                            <Skeleton height={coverSize} width={coverSize} borderRadius={20} />
                                            <Skeleton height={13} width="80%" borderRadius={4} style={{ marginTop: 8 }} />
                                        </View>
                                    ))}
                                </View>
                            ) : recommendedTracks.length > 0 ? (
                                <View style={styles.coverWallGrid}>
                                    {recommendedTracks.map(track => (
                                        <TidalCoverCard
                                            key={track.id}
                                            imageUri={normalizeCardImageUri(track.artworkUrl)}
                                            title={track.title}
                                            subtitle={track.artist}
                                            size={coverSize}
                                            badge="play"
                                            tone="glass"
                                            onPress={() => handleTidalPlay(track)}
                                        />
                                    ))}
                                </View>
                            ) : null}
                        </View>

                        {recommendedArtists.length > 0 ? (
                            <View>
                                <Text style={[styles.homeSubLabel, { color: withAlpha(theme.colors.onSurfaceVariant, 'CC') }]}>Artistas para ti</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} contentContainerStyle={styles.homeRail}>
                                    {recommendedArtists.map(artist => (
                                        <TidalCoverCard
                                            key={artist.id}
                                            imageUri={normalizeCardImageUri(artistArtworkOverrides.get(artist.id) || artist.artworkUrl)}
                                            title={artist.name}
                                            size={104}
                                            variant="circle"
                                            fallbackIcon="person"
                                            tone="glass"
                                            onPress={() => openArtist(artist)}
                                        />
                                    ))}
                                </ScrollView>
                            </View>
                        ) : null}
                    </View>
                );
            case 'empty':
                return (
                    <View style={styles.centered}>
                        <EmptyState title="Sin resultados" description={`No encontramos resultados para "${committedQuery.trim()}"`} />
                    </View>
                );
            case 'feature': {
                const heroArtwork = normalizeCardImageUri(artistArtworkOverrides.get(item.artist.id) || item.artist.artworkUrl);
                return (
                    <View style={styles.feature}>
                        <Pressable onPress={() => openArtist(item.artist)} style={StyleSheet.absoluteFill}>
                            {heroArtwork ? (
                                <Image source={{ uri: heroArtwork }} style={StyleSheet.absoluteFill} contentFit="cover" transition={350} />
                            ) : (
                                <View style={[StyleSheet.absoluteFill, styles.centerFill, { backgroundColor: theme.colors.surfaceVariant }]}>
                                    <Ionicons name="person" size={52} color={theme.colors.onSurfaceVariant} />
                                </View>
                            )}
                            <LinearGradient
                                colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.86)']}
                                locations={[0, 0.5, 1]}
                                style={StyleSheet.absoluteFill}
                            />
                            <View style={styles.featureCopy}>
                                <Text style={[styles.featureKicker, { color: withAlpha('#FFFFFF', 'C0') }]}>Mejor resultado</Text>
                                <Text numberOfLines={2} style={styles.featureName}>{item.artist.name}</Text>
                                <View style={styles.featureCta}>
                                    <Text style={styles.featureCtaLabel}>Ver artista</Text>
                                    <Ionicons name="chevron-forward" size={14} color="#0B0B0C" />
                                </View>
                            </View>
                        </Pressable>
                    </View>
                );
            }
            case 'label':
                return (
                    <View style={styles.labelRow}>
                        <Text style={[styles.labelText, { color: withAlpha(theme.colors.onSurfaceVariant, 'CC') }]}>{item.label}</Text>
                    </View>
                );
            case 'track':
                return isSoulseekSource ? renderSoulseekMirrorTrackRow(item.track) : renderTidalTrackRow(item.track);
            case 'albums-rail':
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {visibleAlbumResults.map(album => (
                            <TidalCoverCard
                                key={album.id}
                                imageUri={normalizeCardImageUri(album.artworkUrl)}
                                title={album.title}
                                subtitle={album.artistName || 'Álbum'}
                                size={150}
                                fallbackIcon="disc"
                                tone="glass"
                                onPress={() => openAlbum(album)}
                            />
                        ))}
                    </ScrollView>
                );
            case 'artists-rail': {
                const artistRailResults = activeTab === 'artists'
                    ? visibleArtistResults
                    : visibleArtistResults.slice(1);
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {artistRailResults.map(artist => (
                            <TidalCoverCard
                                key={artist.id}
                                imageUri={normalizeCardImageUri(artistArtworkOverrides.get(artist.id) || artist.artworkUrl)}
                                title={artist.name}
                                subtitle="Artista"
                                size={118}
                                variant="portrait"
                                fallbackIcon="person"
                                tone="glass"
                                onPress={() => openArtist(artist)}
                            />
                        ))}
                    </ScrollView>
                );
            }
            case 'playlists-rail':
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {visiblePlaylistResults.map(playlist => (
                            <TidalCoverCard
                                key={playlist.uuid}
                                imageUri={normalizeCardImageUri(playlist.artworkUrl)}
                                title={playlist.title}
                                subtitle="Playlist"
                                size={150}
                                fallbackIcon="musical-notes"
                                tone="glass"
                                onPress={() => openPlaylist(playlist)}
                            />
                        ))}
                    </ScrollView>
                );
            default:
                return null;
        }
    }, [
        accentColor,
        artistArtworkOverrides,
        committedQuery,
        coverSize,
        error,
        fetchHomeRecommendations,
        handleSaveSoulseekCredentials,
        handleTidalPlay,
        isRecommending,
        isSavingSoulseekCredentials,
        isSoulseekSource,
        openAlbum,
        openArtist,
        openPlaylist,
        recommendedArtists,
        recommendedTracks,
        renderSoulseekMirrorTrackRow,
        renderSoulseekTrackRow,
        renderTidalTrackRow,
        soulseekError,
        soulseekPassword,
        soulseekUsername,
        theme.colors,
        visibleAlbumResults,
        visibleArtistResults,
        visiblePlaylistResults,
        windowWidth,
    ]);
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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

            {/* Mirror Selection Sheet */}
            <TidalBottomSheet
                visible={showMirrorModal}
                onClose={() => setShowMirrorModal(false)}
                title="Servidores"
                subtitle="Elige el origen de streaming y descargas"
            >
                <OptionRow
                    icon="sparkles"
                    title="Enrutamiento automático"
                    description="Alterna servidores si falla la conexión."
                    selected={tidalMirror === 'auto'}
                    onPress={() => handleMirrorChange('auto')}
                />
                {recommendedMirrors.map((mirror) => {
                    const availability = mirrorAvailability[mirror];
                    const isUnavailable = availability?.status === 'unavailable';
                    const isSlow = availability?.status === 'slow';
                    return (
                        <OptionRow
                            key={mirror}
                            icon="server"
                            title={TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                            description={mirror.replace('https://', '')}
                            status={`${formatMirrorStatus(availability)} · ${formatMirrorCapabilities(availability)}`}
                            statusTone={isUnavailable ? 'error' : isSlow ? 'warning' : 'success'}
                            selected={tidalMirror === mirror}
                            disabled={isUnavailable}
                            onPress={() => handleMirrorChange(mirror)}
                        />
                    );
                })}
                <Button
                    mode="text"
                    compact
                    onPress={() => setShowLegacyMirrors(value => !value)}
                    textColor={accentColor}
                    style={{ alignSelf: 'flex-start', marginTop: 2, marginLeft: 6 }}
                >
                    {showLegacyMirrors ? 'Ocultar otros servidores' : 'Mostrar otros servidores'}
                </Button>
                {showLegacyMirrors ? legacyMirrors.map((mirror) => {
                    const availability = mirrorAvailability[mirror];
                    const isUnavailable = availability?.status === 'unavailable';
                    return (
                        <OptionRow
                            key={mirror}
                            icon="server-outline"
                            title={TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                            description={mirror.replace('https://', '')}
                            status={formatMirrorCapabilities(availability)}
                            selected={tidalMirror === mirror}
                            disabled={isUnavailable}
                            onPress={() => handleMirrorChange(mirror)}
                        />
                    );
                }) : null}
            </TidalBottomSheet>

            {/* Quality Selection Sheet */}
            <TidalBottomSheet
                visible={showQualityModal}
                onClose={() => setShowQualityModal(false)}
                title="Fidelidad"
                subtitle="Calidad de flujo y descarga"
            >
                {qualityModalOptions.map((q) => {
                    const details = {
                        HI_RES_LOSSLESS: {
                            title: 'Hi-Res Lossless (FLAC)',
                            desc: 'Calidad de estudio (24-bit). El mejor sonido posible.',
                            adv: '✓ Máximo detalle · ✗ Archivos gigantes',
                            icon: 'diamond' as const,
                        },
                        LOSSLESS: {
                            title: 'Lossless (FLAC)',
                            desc: 'Calidad de CD (16-bit). Sonido puro sin pérdida.',
                            adv: '✓ Alta fidelidad · ✗ Archivos grandes',
                            icon: 'disc' as const,
                        },
                        MP3: {
                            title: 'MP3 (320kbps)',
                            desc: 'Compatibilidad amplia y buen balance tamaño/calidad.',
                            adv: '✓ Más compatible · ✓ Tamaño moderado',
                            icon: 'musical-note' as const,
                        },
                        LOW: {
                            title: 'Básica (AAC)',
                            desc: 'Calidad estándar eficiente (96kbps).',
                            adv: '✓ Ahorro máximo · ✓ Poco espacio',
                            icon: 'leaf' as const,
                        },
                    } as const;
                    const selectedQuality = q as keyof typeof details;
                    const optionDetails = details[selectedQuality];
                    return (
                        <OptionRow
                            key={selectedQuality}
                            icon={optionDetails.icon}
                            title={optionDetails.title}
                            description={optionDetails.desc}
                            status={optionDetails.adv}
                            statusTone="success"
                            selected={tidalDownloadQuality === selectedQuality}
                            onPress={() => {
                                setTidalDownloadQuality(selectedQuality);
                                setShowQualityModal(false);
                            }}
                        />
                    );
                })}
            </TidalBottomSheet>

            {/* Settings Sheet */}
            <TidalBottomSheet
                visible={showSettingsSheet}
                onClose={() => setShowSettingsSheet(false)}
                title="Ajustes de Tidal"
            >
                <OptionRow
                    icon="musical-notes"
                    title="Calidad de audio"
                    description="Formato de flujo y descarga"
                    onPress={() => { setShowSettingsSheet(false); setShowQualityModal(true); }}
                />
                <OptionRow
                    icon="server"
                    title="Servidor"
                    description="Origen de streaming y descargas"
                    onPress={() => { setShowSettingsSheet(false); setShowMirrorModal(true); }}
                />
                <OptionRow
                    icon="person-circle-outline"
                    title="Sesión Soulseek"
                    description="Cambia tus credenciales"
                    onPress={() => { setShowSettingsSheet(false); setHasSoulseekCredentials(false); }}
                />
            </TidalBottomSheet>
        </View>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    pageContent: {
        paddingBottom: 120,
    },
    flex: {
        flex: 1,
    },
    header: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 18,
        paddingHorizontal: 0,
        paddingTop: 8,
        gap: 16,
        elevation: 0,
    },
    headerTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 4,
        elevation: 4,
    },
    headerTitleBlock: {
        flex: 1,
        paddingRight: 10,
        justifyContent: 'center',
        gap: 4,
    },
    headerKicker: {
        ...typeScale.micro,
        letterSpacing: 1.6,
    },
    headerTitle: {
        ...typeScale.hero,
    },
    headerSubtitle: {
        ...typeScale.body,
        fontSize: 14,
        marginTop: 3,
        letterSpacing: -0.1,
    },
    settingsButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        ...typeScale.titleLarge,
    },
    searchDock: {
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 2,
        overflow: 'hidden',
        zIndex: 1,
    },
    searchShell: {
        borderRadius: 20,
        borderWidth: 1.5,
        paddingHorizontal: 4,
        overflow: 'hidden',
        zIndex: 1,
    },
    searchbar: {
        borderRadius: 18,
        minHeight: 56,
        elevation: 0,
    },
    searchInput: {
        ...typeScale.bodyStrong,
        fontSize: 16,
        lineHeight: 22,
        letterSpacing: 0,
        alignSelf: 'center',
    },
    sourceTabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 24,
        minHeight: 36,
    },
    sourceTabsCaption: {
        ...typeScale.micro,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1.1,
        fontWeight: '700',
        marginRight: -6,
    },
    sourceTab: {
        minWidth: 58,
        paddingTop: 2,
        paddingBottom: 6,
        alignItems: 'flex-start',
    },
    sourceTabLabel: {
        ...typeScale.label,
        fontWeight: '800',
        letterSpacing: 0,
        fontSize: 15,
    },
    sourceTabUnderline: {
        alignSelf: 'stretch',
        height: 2,
        borderRadius: 999,
        marginTop: 6,
    },
    filterScroller: {
        paddingHorizontal: 16,
        marginBottom: 22,
    },
    filterRow: {
        gap: 10,
        paddingRight: 16,
    },
    filterChip: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filterChipLabel: {
        ...typeScale.label,
        fontWeight: '700',
        letterSpacing: 0.2,
        fontSize: 13,
    },
    artistHeroCard: {
        marginHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 14,
        borderRadius: 24,
        borderWidth: 1,
    },
    artistHeroAvatar: {
        width: 84,
        height: 84,
        borderRadius: 42,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    artistHeroCopy: {
        flex: 1,
        gap: 6,
    },
    artistHeroName: {
        fontSize: 22,
        lineHeight: 26,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    artistHeroMeta: {
        fontSize: 13,
    },
    artistHeroCta: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
    },
    artistHeroCtaLabel: {
        fontSize: 13,
        fontWeight: '700',
    },
    searchBanner: {
        marginHorizontal: 16,
        marginTop: -8,
        marginBottom: 14,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    searchBannerText: {
        ...typeScale.micro,
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    recentSection: {
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    recentSearchList: {
        gap: 0,
    },
    recentSearchCard: {
        borderRadius: 0,
        borderWidth: 0,
        borderBottomWidth: 1,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    recentSearchIndex: {
        ...typeScale.micro,
        width: 26,
        letterSpacing: 0.8,
        fontWeight: '700',
    },
    recentSearchContent: {
        flex: 1,
    },
    recentSearchTitle: {
        ...typeScale.body,
        fontWeight: '600',
    },
    centered: {
        minHeight: 320,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        gap: 12,
    },
    soulseekArtworkFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    soulseekRawFilename: {
        ...typeScale.micro,
        marginTop: 4,
    },
    soulseekFolderGroup: {
        marginBottom: 8,
    },
    soulseekVirtualGroupHeader: {
        paddingHorizontal: 16,
        marginTop: 4,
        marginBottom: 8,
    },
    soulseekSummary: {
        marginTop: 6,
        marginBottom: 6,
    },
    soulseekFolderHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 12,
    },
    soulseekFolderIcon: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    soulseekFolderTitleBlock: {
        flex: 1,
        minWidth: 0,
    },
    soulseekFolderPath: {
        ...typeScale.label,
        fontWeight: '700',
    },
    soulseekFolderBadge: {
        minWidth: 28,
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    soulseekFolderCount: {
        ...typeScale.micro,
        fontWeight: '800',
    },
    soulseekFolderPeer: {
        ...typeScale.micro,
        marginTop: 2,
        textTransform: 'uppercase',
    },
    discoveryContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 26,
    },
    discoveryPanel: {
        borderRadius: 28,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
    },
    discoveryAccent: {
        width: 36,
        height: 3,
        borderRadius: 999,
    },
    genreCloud: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    genreChip: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    genreChipLabel: {
        ...typeScale.label,
        fontWeight: '700',
    },
    suggestionWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 6,
    },
    suggestionChip: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    suggestionChipLabel: {
        ...typeScale.label,
    },
    resultsContent: {
        paddingBottom: 8,
    },
    section: {
        marginBottom: 28,
        paddingHorizontal: 16,
    },
    sectionHeaderOnly: {
        paddingHorizontal: 16,
        marginBottom: 10,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    sectionTitle: {
        ...typeScale.title,
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    trackRow: {
        borderRadius: 18,
        padding: 11,
        borderWidth: 1,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    virtualTrackRow: {
        paddingHorizontal: 16,
    },
    trackRowActiveOverlay: {
        borderRadius: 18,
    },
    artwork: {
        width: 52,
        height: 52,
        borderRadius: 12,
    },
    trackContent: {
        flex: 1,
        justifyContent: 'center',
        paddingLeft: 12,
    },
    trackTitle: {
        ...typeScale.bodyStrong,
        fontSize: 15,
    },
    trackRowActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    soulseekDownloadButton: {
        minWidth: 66,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    soulseekDownloadLabel: {
        ...typeScale.micro,
        fontWeight: '700',
        fontSize: 10,
        letterSpacing: 0.2,
    },
    soulseekRoutePill: {
        paddingHorizontal: 7,
        borderRadius: 5,
    },
    soulseekRoutePillLabel: {
        fontSize: 9,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    qualityPill: {
        paddingVertical: 1,
    },
    entityRow: {
        borderRadius: 18,
        padding: 11,
        borderWidth: 1,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    sectionNoPadding: {
        marginBottom: 28,
    },
    horizontalScroll: {
        paddingLeft: 0,
        paddingRight: 16,
        gap: 14,
        paddingBottom: 4,
    },
    artistCircleCard: {
        alignItems: 'flex-start',
        width: 108,
        gap: 10,
    },
    artistCircleImage: {
        width: 92,
        height: 112,
        borderRadius: 24,
        backgroundColor: 'rgba(127,127,127,0.1)',
    },
    artistCircleName: {
        ...typeScale.label,
        textAlign: 'left',
        fontWeight: '600',
    },
    trackCard: {
        width: 154,
        gap: 10,
    },
    trackCardImage: {
        width: 154,
        height: 186,
        borderRadius: 26,
        backgroundColor: 'rgba(127,127,127,0.1)',
    },
    trackCardContent: {
        gap: 2,
    },
    trackCardTitle: {
        ...typeScale.bodyStrong,
        fontSize: 15,
        letterSpacing: -0.2,
    },
    trackCardArtist: {
        ...typeScale.caption,
        fontSize: 12,
        opacity: 0.84,
    },
    genreGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    genreCard: {
        width: '48%',
        height: 74,
        borderRadius: 24,
        borderWidth: 1,
        justifyContent: 'flex-end',
        paddingHorizontal: 16,
        paddingBottom: 14,
        overflow: 'hidden',
        position: 'relative',
    },
    genreCardLabel: {
        ...typeScale.body,
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    genreCardDot: {
        display: 'none',
    },
    entityContent: {
        flex: 1,
    },
    entityTitle: {
        ...typeScale.title,
    },
    soulseekAuthPanel: {
        width: '100%',
        padding: 22,
        gap: 12,
        alignItems: 'stretch',
    },
    soulseekAuthIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    soulseekAuthKicker: {
        ...typeScale.micro,
        letterSpacing: 1.6,
        marginTop: 2,
    },
    soulseekAuthTitle: {
        ...typeScale.titleLarge,
        marginBottom: 2,
    },
    soulseekAuthInput: {
        backgroundColor: 'transparent',
    },
    soulseekAuthButtonContent: {
        minHeight: 44,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.22)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        padding: 24,
        paddingBottom: 40,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
        elevation: 12,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 18,
    },
    premiumOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 18,
        borderWidth: 1,
        gap: 16,
    },
    optionIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gridContainer: {
        flexDirection: 'row',
        gap: GRID_GAP,
    },
    gridColumn: {
        flex: 1,
        gap: GRID_GAP,
    },
    gridCard: {
        borderRadius: 28,
        padding: 20,
        overflow: 'hidden',
    },
    gridCardFooter: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        minHeight: 72,
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    gridCardContent: {
        padding: 14,
        paddingBottom: 16,
        zIndex: 2,
    },
    gridCardTitle: {
        ...typeScale.titleLarge,
        color: '#fff',
        fontSize: 18,
        lineHeight: 22,
        letterSpacing: -0.5,
        textShadowColor: 'rgba(0,0,0,0.24)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    gridCardSubtitle: {
        ...typeScale.caption,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 4,
        textShadowColor: 'rgba(0,0,0,0.18)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    gridIconPlaceholder: {
        position: 'absolute',
        bottom: 20,
        right: 20,
        opacity: 0.3,
    },
    gridImageContainer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    gridImage: {
        width: '100%',
        height: '100%',
    },
    gridImageGradientOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },

    // ─── Editorial redesign ────────────────────────────────────────────────
    centerFill: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    labelRow: {
        paddingHorizontal: 16,
        marginTop: 18,
        marginBottom: 8,
    },
    labelText: {
        ...typeScale.micro,
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    feature: {
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 8,
        height: 264,
        borderRadius: 28,
        overflow: 'hidden',
        backgroundColor: 'rgba(127,127,127,0.12)',
    },
    featureCopy: {
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 20,
        gap: 10,
    },
    featureKicker: {
        ...typeScale.micro,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
    featureName: {
        fontSize: 30,
        lineHeight: 33,
        fontWeight: '800',
        letterSpacing: -0.8,
        color: '#FFFFFF',
    },
    featureCta: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: '#FFFFFF',
        marginTop: 2,
    },
    featureCtaLabel: {
        ...typeScale.label,
        fontSize: 13,
        fontWeight: '800',
        color: '#0B0B0C',
    },
    band: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    bandArt: {
        width: 58,
        height: 58,
        overflow: 'hidden',
    },
    bandCopy: {
        flex: 1,
        gap: 3,
    },
    bandTitle: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.3,
    },
    bandSubtitle: {
        fontSize: 13,
    },
    songRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 14,
    },
    songArt: {
        width: 52,
        height: 52,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: 'rgba(127,127,127,0.1)',
    },
    songArtScrim: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.42)',
    },
    songCopy: {
        flex: 1,
        gap: 3,
    },
    songTitle: {
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
    songSub: {
        fontSize: 13,
    },
    songFile: {
        ...typeScale.micro,
        marginTop: 1,
    },
    coverWall: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 24,
        gap: 26,
    },
    coverWallGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GRID_GAP,
    },
    coverTileTitle: {
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: -0.2,
        marginTop: 8,
    },
    coverTileSub: {
        fontSize: 12,
        marginTop: 2,
        opacity: 0.82,
    },
    coverPlayBadge: {
        position: 'absolute',
        right: 10,
        bottom: 10,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    homeHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    homeTitle: {
        ...typeScale.hero,
        fontSize: 34,
        lineHeight: 38,
    },
    homeSubLabel: {
        ...typeScale.micro,
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 14,
    },
    homeRail: {
        paddingRight: 16,
        gap: 16,
    },
    resultRail: {
        paddingHorizontal: 16,
        paddingBottom: 4,
        gap: 16,
    },
});
