import { CustomIcon, DownloadAnimatedButton, EmptyState, Skeleton } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { getSoulseekCredentials, setSoulseekCredentials, SoulseekCompressedFallbackError, type SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
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
import { typeScale, useTheme } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalPlaylist, TidalTrack } from '@/src/types/audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useRootNavigationState } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Menu, Searchbar, Text, TextInput } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
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
const CARD_HEIGHT_SQUARE = 180;
const CARD_HEIGHT_TALL = 260;
const SEARCH_COMMIT_DELAY_MS = 2_000;
const DISCOVERY_GENRES: Array<{ label: string; query: string; id: string }> = [
    { id: 'hip_hop', label: 'Hip-Hop', query: 'hip hop' },
    { id: 'rnb', label: 'R&B / Soul', query: 'rnb soul' },
    { id: 'blues', label: 'Blues', query: 'blues' },
    { id: 'classical', label: 'Classical', query: 'classical' },
    { id: 'country', label: 'Country', query: 'country' },
    { id: 'dance_electronic', label: 'Electronic', query: 'dance electronic' },
    { id: 'americana', label: 'Folk', query: 'folk americana' },
    { id: 'world', label: 'Global', query: 'world' },
    { id: 'jazz', label: 'Jazz', query: 'jazz' },
    { id: 'kpop', label: 'K-Pop', query: 'kpop' },
    { id: 'latin', label: 'Latin', query: 'latin' },
    { id: 'metal', label: 'Metal', query: 'metal' },
    { id: 'pop', label: 'Pop', query: 'pop' },
    { id: 'reggae', label: 'Reggae', query: 'reggae dancehall' },
    { id: 'retro', label: 'Legacy', query: 'retro' },
    { id: 'indierock', label: 'Rock / Indie', query: 'rock indie' },
];

// ─── Standalone card to prevent remounting flicker ─────────────────────────
interface GridCardProps {
    item: any;
    colIndex: number;
    isLeft: boolean;
    type: 'artists' | 'albums' | 'playlists';
    artistArtworkUri?: string;
    onPress: () => void;
}

function normalizeCardImageUri(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    return trimmed
        .replace('100x100', '500x500')
        .replace('200x200', '500x500')
        .replace('300x300', '500x500');
}

const MasonryGridCard = React.memo(function MasonryGridCard({ item, colIndex, isLeft, type, artistArtworkUri, onPress }: GridCardProps) {
    const { theme } = useTheme();

    let height = CARD_HEIGHT_TALL;
    if (type === 'albums') {
        // Zig-zag pattern for albums: 
        // Left: [Tall, Square, Tall...]
        // Right: [Square, Tall, Square...]
        const isSquare = isLeft ? (colIndex % 2 !== 0) : (colIndex % 2 === 0);
        height = isSquare ? CARD_HEIGHT_SQUARE : CARD_HEIGHT_TALL;
    } else {
        // Simple unaligned pattern for artists/playlists:
        // Right col starts with a square to shift the whole column
        const isSquare = !isLeft && colIndex === 0;
        height = isSquare ? CARD_HEIGHT_SQUARE : CARD_HEIGHT_TALL;
    }

    const title = type === 'artists' ? item.name : item.title;
    const subtitle = type === 'artists' ? 'Artista' : type === 'playlists' ? 'Playlist' : item.artistName;
    const rawImageUri = type === 'artists' ? (artistArtworkUri || item.artworkUrl) : item.artworkUrl;
    const imageUri = normalizeCardImageUri(rawImageUri);

    const fallbackBg = theme.colors.surfaceVariant || '#1E1E1E';

    return (
        <View style={{ height, borderRadius: 28, overflow: 'hidden', backgroundColor: fallbackBg }}>
            <Pressable
                onPress={onPress}
                style={StyleSheet.absoluteFill}
            >
                {/* Background color placeholder/fallback */}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackBg }]} />

                {imageUri ? (
                    <Image
                        source={{ uri: imageUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={400}
                    />
                ) : (
                    <LinearGradient
                        colors={[fallbackBg, withAlpha(fallbackBg, 'CC')]}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    />
                )}

                {/* Calm footer overlay so artwork stays the focus */}
                <View style={styles.gridCardFooter}>
                    <LinearGradient
                        colors={['transparent', 'rgba(12,12,14,0.34)', 'rgba(12,12,14,0.78)']}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                    />

                    {/* Content */}
                    <View style={styles.gridCardContent}>
                        <Text numberOfLines={2} style={styles.gridCardTitle}>{title}</Text>
                        <Text numberOfLines={1} style={styles.gridCardSubtitle}>{subtitle}</Text>
                    </View>
                </View>
            </Pressable>
        </View>
    );
});

interface MasonryGridProps {
    items: any[];
    type: 'artists' | 'albums' | 'playlists';
    artistArtworkOverrides: Map<number, string>;
    openArtist: (a: any) => void;
    openAlbum: (a: any) => void;
    openPlaylist: (p: any) => void;
}

const MasonryGrid = React.memo(function MasonryGrid({ items, type, artistArtworkOverrides, openArtist, openAlbum, openPlaylist }: MasonryGridProps) {
    const leftCol: any[] = [];
    const rightCol: any[] = [];
    items.forEach((item, index) => {
        if (index % 2 === 0) leftCol.push(item);
        else rightCol.push(item);
    });

    return (
        <View style={styles.gridContainer}>
            <View style={styles.gridColumn}>
                {leftCol.map((item, idx) => (
                    <MasonryGridCard
                        key={String(item.id || item.uuid)}
                        item={item}
                        colIndex={idx}
                        isLeft={true}
                        type={type}
                        artistArtworkUri={type === 'artists' ? artistArtworkOverrides.get(item.id) : undefined}
                        onPress={() => {
                            if (type === 'artists') openArtist(item);
                            else if (type === 'albums') openAlbum(item);
                            else openPlaylist(item);
                        }}
                    />
                ))}
            </View>
            <View style={styles.gridColumn}>
                {rightCol.map((item, idx) => (
                    <MasonryGridCard
                        key={String(item.id || item.uuid)}
                        item={item}
                        colIndex={idx}
                        isLeft={false}
                        type={type}
                        artistArtworkUri={type === 'artists' ? artistArtworkOverrides.get(item.id) : undefined}
                        onPress={() => {
                            if (type === 'artists') openArtist(item);
                            else if (type === 'albums') openAlbum(item);
                            else openPlaylist(item);
                        }}
                    />
                ))}
            </View>
        </View>
    );
});

function withAlpha(color: string, alphaHex: string): string {
    if (!color) return color;
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 6) return `#${hex}${alphaHex}`;
        if (hex.length === 8) return `#${hex.slice(0, 6)}${alphaHex}`;
    }
    return color;
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
        'https://dabmusic.xyz/api',
        'https://beta.dabmusic.xyz',
    ];

    return [...pinnedMirrors, ...availableMirrors.slice(0, 3)]
        .filter((mirror, index, all) => availableMirrors.includes(mirror) && all.indexOf(mirror) === index);
}

export default function TidalScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

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
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
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

    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);

    useEffect(() => {
        activeSourceTabRef.current = activeSourceTab;
    }, [activeSourceTab]);

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
            setArtistArtworkOverrides(new Map());
            artistArtworkAttempted.current.clear();
            setHasResolvedSearch(false);
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
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
                setTracks(nextTracks);
                setArtists(nextArtists);
                setAlbums(nextAlbums);
                setPlaylists(nextPlaylists);
                setArtistArtworkOverrides(new Map());
                artistArtworkAttempted.current.clear();
            })
            .catch((searchError: unknown) => {
                if (cancelled) return;
                setTracks([]);
                setArtists([]);
                setAlbums([]);
                setPlaylists([]);
                const message = searchError instanceof Error ? searchError.message : 'No se pudo consultar Tidal';
                console.log(`${SOULSEEK_FLOW_LOG} mirror search error`, {
                    activeSourceTab,
                    query: currentQuery,
                    message,
                });
                setError(message);
            })
            .finally(() => {
                if (!cancelled) {
                    setHasResolvedSearch(true);
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeSourceTab, committedQuery, searchRunId]);

    useEffect(() => {
        setSoulseekResults([]);
        setSoulseekError(null);
        setHasResolvedSoulseekSearch(false);
        setIsSoulseekLoading(false);
    }, [activeSourceTab, committedQuery, searchRunId]);

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
            const artistInfo = await getTidalArtistInfo(artist.id);
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
                    const titleDiff = left.track.title.localeCompare(right.track.title, 'es', { sensitivity: 'base' });
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

    const renderTrackRow = useCallback((track: TidalTrack) => {
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const progressLabel = `${Math.round((state?.progress ?? 0) * 100)}%`;
        const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

        return (
            <Pressable
                key={track.id}
                onPress={() => handleTidalPlay(track)}
                style={[
                    styles.trackRow,
                    {
                        backgroundColor: isTrackActive ? withAlpha(theme.colors.primaryContainer, 'A0') : 'transparent',
                        borderBottomColor: palette.cardBorder,
                        borderBottomWidth: 1,
                    },
                ]}
            >
                <Image
                    source={track.artworkUrl ? { uri: track.artworkUrl } : undefined}
                    style={styles.artwork}
                    contentFit="cover"
                    transition={200}
                />
                <View style={[styles.trackContent, { marginLeft: 4 }]}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: isTrackActive ? theme.colors.primary : theme.colors.onSurface }]}>
                        {track.title}
                    </Text>
                    <View style={styles.metaRow}>
                    <Text numberOfLines={1} style={[typeScale.body, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
                            {track.artist}
                        </Text>
                        <View style={[styles.qualityPill, { backgroundColor: withAlpha(theme.colors.onSurfaceVariant, '0A'), paddingHorizontal: 6, borderRadius: 4 }]}>
                            <Text style={[typeScale.micro, { color: theme.colors.onSurfaceVariant, fontSize: 9 }]}>
                                {track.isHiRes ? 'HI-RES' : 'LOSSLESS'}
                            </Text>
                        </View>
                    </View>
                </View>
                
                <View style={styles.trackRowActions}>
                    <Text style={[typeScale.body, { color: theme.colors.onSurfaceVariant, marginRight: 12 }]}>
                        {formatTrackDuration(track.durationMs)}
                    </Text>
                    <DownloadAnimatedButton
                        status={
                            isDownloadingItem ? 'downloading' :
                            downloaded ? 'done' :
                            isError ? 'error' : 'idle'
                        }
                        progress={state?.progress ?? 0}
                        size={22}
                        onPress={(event) => {
                            event.stopPropagation();
                            console.log(`${SOULSEEK_FLOW_LOG} row download button press`, {
                                rowSource: 'tidal',
                                activeSourceRef: activeSourceTabRef.current,
                                id: track.id,
                                title: track.title,
                                artist: track.artist,
                            });
                            void handleTidalDownload(track, 'tidal');
                        }}
                    />
                </View>
            </Pressable>
        );
    }, [activeTidalTrackId, downloads, handleTidalDownload, handleTidalPlay, isDownloaded, isPlayerPlaying, palette.cardBorder, pendingTrackPreview, theme.colors]);

    const renderSoulseekMirrorTrackRow = useCallback((track: TidalTrack) => {
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);
        const progressValue = Math.round((state?.progress ?? 0) * 100);
        const buttonLabel = isDownloadingItem
            ? `${progressValue}%`
            : downloaded
                ? 'SS ✓'
                : isError
                    ? 'SS !'
                    : 'SS ↓';
        const buttonTextColor = isError
            ? theme.colors.error
            : downloaded
                ? theme.colors.primary
                : isDownloadingItem
                    ? theme.colors.primary
                    : theme.colors.onSurface;
        const buttonBorderColor = isError
            ? withAlpha(theme.colors.error, '70')
            : downloaded
                ? withAlpha(theme.colors.primary, '6E')
                : withAlpha(theme.colors.onSurfaceVariant, '4A');
        const buttonBackgroundColor = isError
            ? withAlpha(theme.colors.error, '12')
            : downloaded
                ? withAlpha(theme.colors.primary, '16')
                : isDownloadingItem
                    ? withAlpha(theme.colors.primary, '0F')
                    : withAlpha(theme.colors.surfaceVariant, '94');

        return (
            <View
                key={`soulseek-mirror-${track.id}`}
                style={[
                    styles.trackRow,
                    {
                        backgroundColor: isTrackActive ? withAlpha(theme.colors.primaryContainer, 'A0') : 'transparent',
                        borderBottomColor: palette.cardBorder,
                        borderBottomWidth: 1,
                    },
                ]}
            >
                <Image
                    source={track.artworkUrl ? { uri: track.artworkUrl } : undefined}
                    style={styles.artwork}
                    contentFit="cover"
                    transition={200}
                />
                <View style={[styles.trackContent, { marginLeft: 4 }]}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: isTrackActive ? theme.colors.primary : theme.colors.onSurface }]}>
                        {track.title}
                    </Text>
                    <View style={styles.metaRow}>
                        <Text numberOfLines={1} style={[typeScale.body, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
                            {track.artist}
                        </Text>
                        <View style={[styles.qualityPill, styles.soulseekRoutePill, { backgroundColor: withAlpha(theme.colors.primary, '14') }]}>
                            <Text style={[typeScale.micro, styles.soulseekRoutePillLabel, { color: theme.colors.primary }]}>
                                SS Route
                            </Text>
                        </View>
                    </View>
                </View>

                <View style={styles.trackRowActions}>
                    <Text style={[typeScale.body, { color: theme.colors.onSurfaceVariant, marginRight: 12 }]}>
                        {formatTrackDuration(track.durationMs)}
                    </Text>
                    <Pressable
                        hitSlop={12}
                        onPress={() => {
                            console.log(`${SOULSEEK_FLOW_LOG} soulseek-only row button`, {
                                id: track.id,
                                title: track.title,
                                artist: track.artist,
                            });
                            void handleSoulseekOnlyDownload(track);
                        }}
                        style={[
                            styles.soulseekDownloadButton,
                            {
                                borderColor: buttonBorderColor,
                                backgroundColor: buttonBackgroundColor,
                            },
                        ]}
                    >
                        <Text style={[styles.soulseekDownloadLabel, { color: buttonTextColor }]}>
                            {buttonLabel}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }, [activeTidalTrackId, downloads, handleSoulseekOnlyDownload, isDownloaded, isPlayerPlaying, palette.cardBorder, pendingTrackPreview, theme.colors]);

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

        return (
            <Pressable
                key={`${track.id}:${result.match.id ?? result.match.filename}`}
                onPress={() => handleSoulseekMatchPlay(result)}
                style={[
                    styles.trackRow,
                    {
                        backgroundColor: isTrackActive ? withAlpha(theme.colors.primaryContainer, 'A0') : 'transparent',
                        borderBottomColor: palette.cardBorder,
                        borderBottomWidth: 1,
                    },
                ]}
            >
                <View style={[styles.artwork, styles.soulseekArtworkFallback, { backgroundColor: withAlpha(theme.colors.primary, '14') }]}>
                    <Text style={[typeScale.micro, { color: theme.colors.primary }]}>SS</Text>
                </View>
                <View style={[styles.trackContent, { marginLeft: 4 }]}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: isTrackActive ? theme.colors.primary : theme.colors.onSurface }]}>
                        {track.title}
                    </Text>
                    <View style={styles.metaRow}>
                        <Text numberOfLines={1} style={[typeScale.body, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
                            {track.artist || result.match.username}
                        </Text>
                        {formatLabel ? (
                            <View style={[styles.qualityPill, { backgroundColor: withAlpha(theme.colors.onSurfaceVariant, '0A'), paddingHorizontal: 6, borderRadius: 4 }]}>
                                <Text style={[typeScale.micro, { color: theme.colors.onSurfaceVariant, fontSize: 9 }]}>
                                    {formatLabel}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                    {showRawLeafFilename ? (
                        <Text numberOfLines={1} style={[styles.soulseekRawFilename, { color: withAlpha(theme.colors.onSurfaceVariant, 'BD') }]}>
                            {rawLeafFilename}
                        </Text>
                    ) : null}
                </View>
                <View style={styles.trackRowActions}>
                    <Text style={[typeScale.body, { color: theme.colors.onSurfaceVariant, marginRight: 12 }]}>
                        {track.durationMs > 0 ? formatTrackDuration(track.durationMs) : '--:--'}
                    </Text>
                    <DownloadAnimatedButton
                        status={
                            isDownloadingItem ? 'downloading'
                                : downloaded ? 'done'
                                    : isError ? 'error'
                                        : 'idle'
                        }
                        progress={state?.progress ?? 0}
                        size={22}
                        onPress={(event) => {
                            event.stopPropagation();
                            void handleSoulseekMatchDownload(result);
                        }}
                    />
                </View>
            </Pressable>
        );
    }, [activeTidalTrackId, downloads, handleSoulseekMatchDownload, handleSoulseekMatchPlay, isDownloaded, isPlayerPlaying, palette.cardBorder, pendingTrackPreview, theme.colors]);

    // MasonryGrid and MasonryGridCard are defined at module level above

    const [isFocused, setIsFocused] = useState(false);
    const [availableMirrors, setAvailableMirrors] = useState<string[]>(() => [
        'https://dabmusic.xyz/api',
        'https://beta.dabmusic.xyz',
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

    const applyGenreSuggestion = useCallback((genre: { id: string; label: string; query: string }) => {
        if (!canNavigate) {
            console.warn('[TidalScreen] Navigation blocked: root layout not mounted yet (genre).');
            return;
        }
        router.push({
            pathname: '/tidal-genre/[id]',
            params: { id: genre.id, name: genre.label },
        });
    }, [canNavigate]);

    const resultTabs = useMemo(() => ([
        { key: 'all' as const, label: 'Todo' },
        { key: 'artists' as const, label: 'Artistas' },
        { key: 'albums' as const, label: 'Álbumes' },
        { key: 'playlists' as const, label: 'Playlists' },
        { key: 'tracks' as const, label: 'Canciones' },
    ]), []);
    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
            <ScrollView
                contentContainerStyle={[styles.pageContent, { paddingBottom: styles.pageContent.paddingBottom + insets.bottom }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                <Animated.View style={styles.header}>
                    <View pointerEvents="none" style={[styles.headerOrbit, { borderColor: withAlpha(theme.colors.primary, '24') }]} />
                    <View pointerEvents="none" style={[styles.headerOrbitSecondary, { borderColor: withAlpha(theme.colors.tertiary ?? theme.colors.primary, '18') }]} />
                    <View style={styles.headerTitleRow}>
                        <View style={styles.headerTitleBlock}>
                            <Text variant="headlineMedium" style={[styles.headerTitle, { color: theme.colors.onBackground }]}>Buscar</Text>
                        </View>
                        <Menu
                            visible={showSettingsMenu}
                            onDismiss={() => setShowSettingsMenu(false)}
                            anchor={
                                <IconButton
                                    icon="cog-outline"
                                    iconColor={theme.colors.onSurface}
                                    size={20}
                                    onPress={() => setShowSettingsMenu(true)}
                                    style={styles.settingsButton}
                                    containerColor={withAlpha(theme.colors.surfaceVariant, 'B8')}
                                />
                            }
                            contentStyle={{ backgroundColor: theme.colors.surface, borderRadius: 16 }}
                        >
                            <Menu.Item
                                onPress={() => { setShowSettingsMenu(false); setShowQualityModal(true); }}
                                title="Calidad de audio"
                                leadingIcon="tune-variant"
                            />
                            <Divider style={{ opacity: 0.1 }} />
                            <Menu.Item
                                onPress={() => { setShowSettingsMenu(false); setShowMirrorModal(true); }}
                                title="Servidor"
                                leadingIcon="server-network"
                            />
                            <Divider style={{ opacity: 0.1 }} />
                            <Menu.Item
                                onPress={() => {
                                    setShowSettingsMenu(false);
                                    setHasSoulseekCredentials(false);
                                }}
                                title="Sesion Soulseek"
                                leadingIcon="account-cog-outline"
                            />
                        </Menu>
                    </View>

                    <View
                        style={[
                            styles.searchShell,
                            {
                                borderColor: palette.searchBorder,
                            },
                        ]}
                    >
                        <Searchbar
                            placeholder="Buscar"
                            value={query}
                            onChangeText={setQuery}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            onSubmitEditing={handleSubmitSearch}
                            returnKeyType="search"
                            submitBehavior="submit"
                            style={[
                                styles.searchbar,
                                {
                                    backgroundColor: 'transparent',
                                    minHeight: 52,
                                }
                            ]}
                            iconColor={theme.colors.primary}
                            inputStyle={[styles.searchInput, { color: theme.colors.onSurface }]}
                            placeholderTextColor={withAlpha(theme.colors.onSurfaceVariant, '40')}
                        />
                    </View>

                    <View style={styles.sourceTabsRow}>
                        <Pressable
                            onPress={() => handleSourceTabChange('tidal')}
                            style={styles.sourceTab}
                        >
                            <Text style={[styles.sourceTabLabel, { color: !isSoulseekSource ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                                Tidal
                            </Text>
                            <View style={[styles.sourceTabUnderline, { backgroundColor: !isSoulseekSource ? theme.colors.primary : 'transparent' }]} />
                        </Pressable>
                        <Pressable
                            onPress={() => handleSourceTabChange('soulseek')}
                            style={styles.sourceTab}
                        >
                            <Text style={[styles.sourceTabLabel, { color: isSoulseekSource ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                                Soulseek
                            </Text>
                            <View style={[styles.sourceTabUnderline, { backgroundColor: isSoulseekSource ? theme.colors.primary : 'transparent' }]} />
                        </Pressable>
                    </View>
                </Animated.View>

                {hasCommittedQuery ? (
                    <Animated.ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterRow}
                        style={styles.filterScroller}
                    >
                        {resultTabs.map((tab) => {
                            const selected = activeTab === tab.key;
                            return (
                                <Pressable
                                    key={tab.key}
                                    onPress={() => setActiveTab(tab.key)}
                                    style={styles.filterChip}
                                >
                                    <View style={styles.filterChipInner}>
                                        <Text style={[styles.filterChipLabel, { color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                                            {tab.label}
                                        </Text>
                                        <View
                                            style={[
                                                styles.filterChipUnderline,
                                                { backgroundColor: selected ? theme.colors.primary : 'transparent' },
                                            ]}
                                        />
                                    </View>
                                </Pressable>
                            );
                        })}
                    </Animated.ScrollView>
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
                            {searchHealthBanner.tone === 'error'
                                ? 'Servicio no disponible.'
                                : 'Servicio inestable.'}
                        </Text>
                    </View>
                ) : null}

                {!hasQuery && isFocused && recentSearches.length > 0 ? (
                    <Animated.View entering={FadeInDown.duration(300)} style={styles.recentSection}>
                        <View style={styles.sectionHeader}>
                            <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Búsquedas recientes</Text>
                        </View>
                        <View style={styles.recentSearchList}>
                            {recentSearches.map((item, index) => (
                                <Pressable
                                    key={item}
                                    onPress={() => applySuggestion(item)}
                                    style={[
                                        styles.recentSearchCard,
                                        {
                                            borderBottomColor: palette.cardBorder,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.recentSearchIndex, { color: withAlpha(theme.colors.onSurfaceVariant, 'CC') }]}>
                                        {String(index + 1).padStart(2, '0')}
                                    </Text>
                                    <View style={styles.recentSearchContent}>
                                        <Text numberOfLines={1} style={[styles.recentSearchTitle, { color: theme.colors.onSurface }]}>
                                            {formatRecentSearchTitle(item)}
                                        </Text>
                                    </View>
                                    <CustomIcon name="Next" size={16} color={theme.colors.onSurfaceVariant} />
                                </Pressable>
                            ))}
                        </View>
                    </Animated.View>
                ) : null}

                {activeSourceTab === 'soulseek' && !hasSoulseekCredentials ? (
                        <View style={styles.centered}>
                            <View style={[styles.soulseekAuthPanel, { borderColor: palette.cardBorder, backgroundColor: palette.cardBackground }]}>
                                <Text variant="titleMedium" style={[styles.soulseekAuthTitle, { color: theme.colors.onBackground }]}>
                                    Inicia sesion en Soulseek
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
                            </View>
                        </View>
                ) : isLoading ? (
                    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {/* Masonry skeleton: two columns */}
                                <View style={styles.gridContainer}>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_SQUARE} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                </View>
                            </View>
                        )}

                        {(activeTab === 'all' || activeTab === 'albums') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                <View style={styles.gridContainer}>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_SQUARE} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                </View>
                            </View>
                        )}

                        {(activeTab === 'all' || activeTab === 'tracks') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <View key={`s-tra-${i}`} style={[styles.trackRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder, opacity: 0.6 }]}>
                                        <Skeleton height={62} width={62} borderRadius={12} />
                                        <View style={styles.trackContent}>
                                            <Skeleton height={16} width="80%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <Skeleton height={14} width="60%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <View style={styles.metaRow}>
                                                <Skeleton height={12} width={40} borderRadius={4} />
                                                <Skeleton height={18} width={60} borderRadius={10} />
                                            </View>
                                        </View>
                                        <Skeleton height={36} width={36} borderRadius={18} />
                                        <Skeleton height={32} width={80} borderRadius={20} />
                                    </View>
                                ))}
                            </View>
                        )}
                    </Animated.View>
                ) : error ? (
                    <View style={styles.centered}>
                        <EmptyState title="No se pudo cargar Tidal" description={error} />
                    </View>
                ) : !hasQuery && !isFocused ? (
                    <Animated.View entering={FadeInDown.duration(320)} style={styles.discoveryContainer}>
                        {isRecommending && recommendedTracks.length === 0 ? (
                            <View style={styles.sectionNoPadding}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={180} borderRadius={6} />
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <View key={`s-rec-tra-${i}`} style={styles.trackCard}>
                                            <Skeleton height={150} width={150} borderRadius={24} />
                                            <View style={[styles.trackCardContent, { marginTop: 8 }]}>
                                                <Skeleton height={14} width="90%" borderRadius={4} style={{ marginBottom: 6 }} />
                                                <Skeleton height={12} width="60%" borderRadius={4} />
                                            </View>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        ) : recommendedTracks.length > 0 ? (
                            <View style={styles.sectionNoPadding}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Recomendados para ti</Text>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                    {recommendedTracks.map(track => (
                                        <Pressable key={track.id} onPress={() => handleTidalPlay(track)} style={styles.trackCard}>
                                            <Image
                                                source={track.artworkUrl ? { uri: track.artworkUrl } : undefined}
                                                style={styles.trackCardImage}
                                                contentFit="cover"
                                            />
                                            <View style={styles.trackCardContent}>
                                                <Text numberOfLines={1} style={[styles.trackCardTitle, { color: theme.colors.onSurface }]}>{track.title}</Text>
                                                <Text numberOfLines={1} style={[styles.trackCardArtist, { color: theme.colors.onSurfaceVariant }]}>{track.artist}</Text>
                                            </View>
                                        </Pressable>
                                    ))}
                                </ScrollView>
                            </View>
                        ) : null}

                        <View style={styles.sectionNoPadding}>
                            <View style={styles.sectionHeader}>
                                <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Géneros</Text>
                            </View>
                            <View style={styles.genreGrid}>
                                {DISCOVERY_GENRES.map((genre) => (
                                    <Pressable
                                        key={genre.id}
                                        onPress={() => applyGenreSuggestion(genre)}
                                        style={[
                                            styles.genreCard,
                                            {
                                                backgroundColor: theme.colors.surfaceVariant + '35',
                                                borderColor: theme.colors.outline + '10',
                                            },
                                        ]}
                                    >
                                        <Text style={[styles.genreCardLabel, { color: theme.colors.onSurface }]}>
                                            {genre.label}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {isRecommending && recommendedArtists.length === 0 ? (
                            <View style={styles.sectionNoPadding}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={150} borderRadius={6} />
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <View key={`s-rec-art-${i}`} style={styles.artistCircleCard}>
                                            <Skeleton height={80} width={80} borderRadius={40} />
                                            <Skeleton height={12} width={60} borderRadius={4} style={{ marginTop: 8 }} />
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        ) : recommendedArtists.length > 0 ? (
                            <View style={styles.sectionNoPadding}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Artistas para ti</Text>
                                    <Button mode="text" compact onPress={fetchHomeRecommendations} textColor={theme.colors.primary}>Refrescar</Button>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                    {recommendedArtists.map(artist => {
                                        const finalArtwork = normalizeCardImageUri(artistArtworkOverrides.get(artist.id) || artist.artworkUrl);
                                        return (
                                            <Pressable key={artist.id} onPress={() => openArtist(artist)} style={styles.artistCircleCard}>
                                                <View style={[styles.artistCircleImage, { backgroundColor: theme.colors.surfaceVariant + '60', justifyContent: 'center', alignItems: 'center' }]}>
                                                    {finalArtwork ? (
                                                        <Image
                                                            source={{ uri: finalArtwork }}
                                                            style={StyleSheet.absoluteFill}
                                                            contentFit="cover"
                                                        />
                                                    ) : (
                                                        <CustomIcon name="Artista" size={24} color={theme.colors.onSurfaceVariant + '80'} />
                                                    )}
                                                </View>
                                                <Text numberOfLines={1} style={[styles.artistCircleName, { color: theme.colors.onSurface }]}>{artist.name}</Text>
                                            </Pressable>
                                        );
                                    })}
                                </ScrollView>
                            </View>
                        ) : null}
                    </Animated.View>
                ) : hasResolvedSearch && !tracks.length && !albums.length && !artists.length && !playlists.length ? (
                    <View style={styles.centered}>
                        <EmptyState title="Sin resultados" description={`No encontramos resultados para "${committedQuery.trim()}"`} />
                    </View>
                ) : (
                    <Animated.View key={`results-${committedQuery}-${searchRunId}`} entering={FadeInDown.duration(260)} exiting={FadeOut.duration(180)} style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && artists.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Artistas</Text>
                                </View>
                                {<MasonryGrid items={artists.slice(0, activeTab === 'all' ? 6 : artists.length)} type="artists" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'albums') && albums.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Álbumes</Text>
                                </View>
                                {<MasonryGrid items={albums.slice(0, activeTab === 'all' ? 8 : albums.length)} type="albums" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'playlists') && playlists.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(250).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Playlists</Text>
                                </View>
                                {<MasonryGrid items={playlists.slice(0, activeTab === 'all' ? 6 : playlists.length)} type="playlists" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'tracks') && tracks.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Canciones</Text>
                                </View>
                                {tracks
                                    .slice(0, activeTab === 'all' ? 12 : tracks.length)
                                    .map(isSoulseekSource ? renderSoulseekMirrorTrackRow : renderTrackRow)}
                            </Animated.View>
                        ) : null}
                    </Animated.View>
                )}
            </ScrollView>

            {/* Mirror Selection Modal */}
            <Modal
                visible={showMirrorModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowMirrorModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text variant="titleLarge" style={[typeScale.titleLarge, { color: theme.colors.onSurface }]}>
                                    Servidores
                                </Text>
                            </View>
                            <IconButton icon="close" mode="contained-tonal" onPress={() => setShowMirrorModal(false)} />
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
                            <Pressable
                                onPress={() => handleMirrorChange('auto')}
                                style={({ pressed }) => [
                                    styles.premiumOption,
                                    {
                                        backgroundColor: tidalMirror === 'auto' ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                        borderColor: tidalMirror === 'auto' ? theme.colors.primary : 'transparent',
                                        opacity: pressed ? 0.7 : 1
                                    }
                                ]}
                            >
                                <View style={[styles.optionIconContainer, { backgroundColor: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                    <IconButton icon="auto-fix" size={20} iconColor={tidalMirror === 'auto' ? theme.colors.onPrimary : theme.colors.onSurface} style={{ margin: 0 }} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text variant="titleMedium" style={[typeScale.title, { color: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurface }]}>
                                        Enrutamiento Automático
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Alterna servidores si falla la conexión.
                                    </Text>
                                </View>
                                {tidalMirror === 'auto' && (
                                    <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                        <CustomIcon name="Play" size={12} color={theme.colors.onPrimary} />
                                    </View>
                                )}
                            </Pressable>

                            {recommendedMirrors.map((mirror) => {
                                const availability = mirrorAvailability[mirror];
                                const isUnavailable = availability?.status === 'unavailable';
                                const isSlow = availability?.status === 'slow';
                                const titleColor = isUnavailable
                                    ? theme.colors.onSurfaceVariant
                                    : tidalMirror === mirror
                                        ? theme.colors.primary
                                        : theme.colors.onSurface;
                                const statusColor = isUnavailable
                                    ? theme.colors.error
                                    : isSlow
                                        ? '#F59E0B'
                                        : '#10B981';

                                return (
                                    <Pressable
                                        key={mirror}
                                        disabled={isUnavailable}
                                        onPress={() => handleMirrorChange(mirror)}
                                        style={({ pressed }) => [
                                            styles.premiumOption,
                                            {
                                                backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                                borderColor: tidalMirror === mirror ? theme.colors.primary : (isUnavailable ? withAlpha(theme.colors.error, '7D') : 'transparent'),
                                                opacity: isUnavailable ? 0.5 : (pressed ? 0.7 : 1)
                                            }
                                        ]}
                                    >
                                        <View style={[styles.optionIconContainer, { backgroundColor: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                            <IconButton
                                                icon="server"
                                                size={20}
                                                iconColor={tidalMirror === mirror ? theme.colors.onPrimary : theme.colors.onSurface}
                                                style={{ margin: 0 }}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={[typeScale.title, { color: titleColor }]}>
                                                {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                                {mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="labelSmall" style={{ color: statusColor, marginTop: 4 }}>
                                                {formatMirrorStatus(availability)}
                                            </Text>
                                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                                                {formatMirrorCapabilities(availability)}
                                            </Text>
                                        </View>
                                        {tidalMirror === mirror && (
                                            <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                                <IconButton icon="check" size={12} iconColor={theme.colors.onPrimary} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </Pressable>
                                );
                            })}

                            <Button
                                mode="text"
                                compact
                                onPress={() => setShowLegacyMirrors(value => !value)}
                                textColor={theme.colors.primary}
                                style={{ alignSelf: 'flex-start', marginTop: 2 }}
                            >
                                {showLegacyMirrors ? 'Ocultar otros servidores' : 'Mostrar otros servidores'}
                            </Button>

                            {showLegacyMirrors ? legacyMirrors.map((mirror) => {
                                const availability = mirrorAvailability[mirror];
                                const isUnavailable = availability?.status === 'unavailable';
                                const titleColor = isUnavailable
                                    ? theme.colors.onSurfaceVariant
                                    : tidalMirror === mirror
                                        ? theme.colors.primary
                                        : theme.colors.onSurface;

                                return (
                                    <Pressable
                                        key={mirror}
                                        disabled={isUnavailable}
                                        onPress={() => handleMirrorChange(mirror)}
                                        style={({ pressed }) => [
                                            styles.premiumOption,
                                            {
                                                backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                                borderColor: tidalMirror === mirror ? theme.colors.primary : 'transparent',
                                                opacity: isUnavailable ? 0.45 : (pressed ? 0.7 : 0.88),
                                            }
                                        ]}
                                    >
                                        <View style={[styles.optionIconContainer, { backgroundColor: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                            <IconButton
                                                icon="server-outline"
                                                size={20}
                                                iconColor={tidalMirror === mirror ? theme.colors.onPrimary : theme.colors.onSurface}
                                                style={{ margin: 0 }}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={[typeScale.title, { color: titleColor }]}>
                                                {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                                {mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                                                {formatMirrorCapabilities(availability)}
                                            </Text>
                                        </View>
                                        {tidalMirror === mirror && (
                                            <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                                <IconButton icon="check" size={12} iconColor={theme.colors.onPrimary} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </Pressable>
                                );
                            }) : null}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Quality Selection Modal */}
            <Modal
                visible={showQualityModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowQualityModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text variant="titleLarge" style={[typeScale.titleLarge, { color: theme.colors.onSurface }]}>
                                    Fidelidad
                                </Text>
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                    Calidad de flujo y descarga
                                </Text>
                            </View>
                            <IconButton icon="close" mode="contained-tonal" onPress={() => setShowQualityModal(false)} />
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                Selecciona el formato preferido para tus descargas de Tidal.
                            </Text>

                            {qualityModalOptions.map((q) => {
                                const details = {
                                    HI_RES_LOSSLESS: {
                                        title: 'Hi-Res Lossless (FLAC)',
                                        desc: 'Calidad de estudio (24-bit). El mejor sonido posible.',
                                        adv: '✓ Máximo detalle / ✗ Archivos gigantes (~100MB)',
                                        icon: 'crown'
                                    },
                                    LOSSLESS: {
                                        title: 'Lossless (FLAC)',
                                        desc: 'Calidad de CD (16-bit). Sonido puro sin pérdida.',
                                        adv: '✓ Alta fidelidad / ✗ Archivos grandes (~30-50MB)',
                                        icon: 'disc'
                                    },
                                    MP3: {
                                        title: 'MP3 (320kbps)',
                                        desc: 'Compatibilidad amplia y buen balance entre tamaño y calidad.',
                                        adv: '✓ Más compatible / ✓ Tamaño moderado',
                                        icon: 'file-music-outline'
                                    },
                                    LOW: {
                                        title: 'Básica (AAC)',
                                        desc: 'Calidad estándar eficiente (96kbps).',
                                        adv: '✓ Ahorro máximo / ✓ Ideal para poco espacio',
                                        icon: 'leaf'
                                    }
                                } as const;
                                const selectedQuality = q as keyof typeof details;
                                const optionDetails = details[selectedQuality];

                                return (
                                    <Pressable
                                        key={selectedQuality}
                                        onPress={() => {
                                            setTidalDownloadQuality(selectedQuality);
                                            setShowQualityModal(false);
                                        }}
                                        style={({ pressed }) => [
                                            styles.premiumOption,
                                            {
                                                backgroundColor: tidalDownloadQuality === selectedQuality ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                                borderColor: tidalDownloadQuality === selectedQuality ? theme.colors.primary : 'transparent',
                                                opacity: pressed ? 0.7 : 1
                                            }
                                        ]}
                                    >
                                        <View style={[styles.optionIconContainer, { backgroundColor: tidalDownloadQuality === selectedQuality ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                            <IconButton
                                                icon={optionDetails.icon}
                                                size={22}
                                                iconColor={tidalDownloadQuality === selectedQuality ? theme.colors.onPrimary : theme.colors.onSurface}
                                                style={{ margin: 0 }}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={[typeScale.title, { color: tidalDownloadQuality === selectedQuality ? theme.colors.primary : theme.colors.onSurface }]}>
                                                {optionDetails.title}
                                            </Text>
                                            <Text variant="labelSmall" style={[typeScale.micro, { color: theme.colors.primary, marginBottom: 2 }]}>
                                                {optionDetails.adv.split(' / ')[0]}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {optionDetails.desc}
                                            </Text>
                                        </View>
                                        {tidalDownloadQuality === selectedQuality && (
                                            <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                                <IconButton icon="check" size={12} iconColor={theme.colors.onPrimary} style={{ margin: 0 }} />
                                            </View>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    pageContent: {
        paddingBottom: 120,
    },
    headerGlow: {
        position: 'absolute',
        top: 10,
        right: 8,
        width: 180,
        height: 180,
        borderRadius: 120,
    },
    header: {
        marginHorizontal: 16,
        marginTop: 6,
        marginBottom: 18,
        paddingHorizontal: 0,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 16,
        elevation: 0,
        overflow: 'hidden',
    },
    headerOrbit: {
        position: 'absolute',
        width: 220,
        height: 220,
        borderRadius: 220,
        borderWidth: 1.5,
        top: -126,
        right: -104,
        transform: [{ rotate: '18deg' }],
    },
    headerOrbitSecondary: {
        position: 'absolute',
        width: 140,
        height: 140,
        borderRadius: 140,
        borderWidth: 1,
        top: -38,
        right: 54,
        transform: [{ rotate: '-12deg' }],
    },
    headerTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        zIndex: 4,
        elevation: 4,
    },
    headerTitleBlock: {
        flex: 1,
        paddingRight: 10,
        justifyContent: 'center',
    },
    headerTitle: {
        ...typeScale.screenTitle,
        letterSpacing: -1,
    },
    settingsButton: {
        margin: 0,
        width: 40,
        height: 40,
        borderRadius: 12,
        zIndex: 5,
        elevation: 5,
    },
    title: {
        ...typeScale.titleLarge,
    },
    searchShell: {
        borderRadius: 0,
        borderBottomWidth: 1,
        paddingHorizontal: 0,
        paddingVertical: 2,
        zIndex: 1,
    },
    searchbar: {
        borderRadius: 0,
        minHeight: 52,
        elevation: 0,
    },
    searchInput: {
        ...typeScale.bodyStrong,
        paddingLeft: 0,
        fontSize: 20,
        lineHeight: 28,
        letterSpacing: -0.35,
    },
    sourceTabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 22,
        marginTop: -2,
    },
    sourceTab: {
        paddingVertical: 4,
    },
    sourceTabLabel: {
        ...typeScale.label,
        fontWeight: '700',
        letterSpacing: 0.35,
        fontSize: 13,
    },
    sourceTabUnderline: {
        width: 22,
        height: 2,
        borderRadius: 999,
        marginTop: 8,
    },
    filterScroller: {
        paddingHorizontal: 16,
        marginBottom: 22,
    },
    filterRow: {
        gap: 18,
        paddingRight: 16,
    },
    filterChip: {
        borderRadius: 0,
        borderWidth: 0,
        paddingHorizontal: 0,
        paddingVertical: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filterChipInner: {
        alignItems: 'flex-start',
    },
    filterChipLabel: {
        ...typeScale.label,
        fontWeight: '700',
        letterSpacing: 0.3,
        fontSize: 13,
    },
    filterChipUnderline: {
        width: 24,
        height: 2,
        borderRadius: 999,
        marginTop: 8,
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
    soulseekFolderHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        paddingBottom: 4,
        marginBottom: 6,
    },
    soulseekFolderPath: {
        ...typeScale.label,
        flex: 1,
        fontWeight: '700',
        marginRight: 12,
    },
    soulseekFolderCount: {
        ...typeScale.micro,
        fontWeight: '700',
    },
    soulseekFolderPeer: {
        ...typeScale.micro,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
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
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    sectionTitle: {
        ...typeScale.title,
        letterSpacing: -0.35,
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
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
        gap: 10,
    },
    soulseekAuthTitle: {
        ...typeScale.title,
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
});
