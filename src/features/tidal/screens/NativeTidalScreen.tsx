import { useSoulseekCredentials } from '../hooks/useSoulseekCredentials';
import { useTidalMirrorHealth } from '../hooks/useTidalMirrorHealth';
import { useTidalPlaybackActions } from '../hooks/useTidalPlaybackActions';
import { recentItemKey, useTidalRecentItems, type TidalRecentItem } from '../hooks/useTidalRecentItems';
import { formatMirrorCapabilities, formatMirrorStatus, normalizeCardImageUri } from '../model/tidalScreenUtils';
import type { TidalSourceTab } from '../model/tidalScreenTypes';
import { router } from '@/src/navigation/navigation';
import { searchTidal, searchTidalCatalogAll, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import type { TidalAlbum, TidalArtist, TidalCatalogSearch, TidalQuality, TidalTrack } from '@/src/types/audio';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SearchAction = { action: string; id: string; value: string; requestId: number };
interface NativeProps extends ViewProps {
    result: string;
    recommendations: string;
    transfers: string;
    settings: string;
    credentials: { username: string; password: string };
    recentSearches: string[];
    appearance: Record<string, string>;
    topInset: number;
    bottomInset: number;
    authRequest: number;
    onAction: (event: NativeSyntheticEvent<SearchAction>) => void;
}

export const hasNativeTidal = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundSearchView') !== null;
const NativeView = hasNativeTidal ? requireNativeViewManager<NativeProps>('StaySoundSearchView') : null;
const displayTrack = (track: TidalTrack) => ({
    id: String(track.id), title: track.title, artist: track.artist,
    artistId: track.artistId ? String(track.artistId) : '',
    artwork: normalizeCardImageUri(track.artworkUrl) || '', durationMs: track.durationMs,
});

function albumKindLabel(album: TidalAlbum): string {
    if (album.type === 'SINGLE') return 'Sencillo';
    if (album.type === 'EP') return 'EP';
    if (album.type === 'COMPILATION') return 'Recopilatorio';
    return 'Álbum';
}

const displayArtist = (artist: TidalArtist) => ({
    kind: 'artist', id: String(artist.id), title: artist.name, subtitle: 'Artista',
    artwork: normalizeCardImageUri(artist.artworkUrl) || '',
});
const displayAlbum = (album: TidalAlbum) => ({
    kind: 'album', id: String(album.id), title: album.title,
    subtitle: [albumKindLabel(album), album.artistName, album.year].filter(Boolean).join(' · '),
    artwork: normalizeCardImageUri(album.artworkUrl) || '',
});

function displayTop(top: TidalCatalogSearch['top']) {
    if (!top) return null;
    if (top.kind === 'artist') return { ...displayArtist(top.artist), label: 'Artista', subtitle: '' };
    if (top.kind === 'album') return { ...displayAlbum(top.album), label: albumKindLabel(top.album), subtitle: top.album.artistName };
    return { kind: 'track', id: String(top.track.id), title: top.track.title, subtitle: top.track.artist,
        label: 'Canción', artwork: normalizeCardImageUri(top.track.artworkUrl) || '', track: displayTrack(top.track) };
}

/** Lo que Kotlin necesita para pintar un reciente: el objeto viaja como JSON en un string. */
const recentPayload = (item: TidalRecentItem) => JSON.stringify({ ...item, key: recentItemKey(item),
    // Una canción reciente vuelve a buscarse (título + artista) para mostrarla con su estado.
    query: item.kind === 'track' ? `${item.title} ${item.subtitle.replace(/^Canción · /, '')}` : item.title });

// Kotlin owns editing, debounce, request identity, focus, lists and all settings sheets.
// This adapter keeps the existing catalog/download/library stores as the single source of truth.
export default function NativeTidalScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const credentials = useSoulseekCredentials();
    const { recentItems, rememberRecentItem, forgetRecentItem, clearRecentItems } = useTidalRecentItems();
    const recentSearches = useMemo(() => recentItems.map(recentPayload), [recentItems]);
    const quality = useSettingsStore(s => s.tidalDownloadQuality);
    const mirror = useSettingsStore(s => s.tidalMirror);
    const [mirrorVisible, setMirrorVisible] = useState(false);
    const health = useTidalMirrorHealth(mirror, mirrorVisible);
    const [authRequest, setAuthRequest] = useState(0);
    const [authRevision, setAuthRevision] = useState(0);
    const requestCredentials = useCallback(() => setAuthRequest(value => value + 1), []);
    const source = useRef<TidalSourceTab>('soulseek');
    const actions = useTidalPlaybackActions({ activeSourceTab: 'soulseek', activeSourceTabRef: source,
        hasSoulseekCredentials: credentials.hasCredentials, onRequireSoulseekCredentials: requestCredentials });
    const [result, setResult] = useState('{}');
    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [catalog, setCatalog] = useState<TidalCatalogSearch | null>(null);
    const [recommendations, setRecommendations] = useState<TidalTrack[]>([]);
    const [recommending, setRecommending] = useState(false);
    const [recommendationError, setRecommendationError] = useState('');
    const mounted = useRef(true);
    const searchGeneration = useRef(0);
    const recommendationGeneration = useRef(0);
    const recommendationBusy = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; searchGeneration.current++; };
    }, []);

    const fetchRecommendations = useCallback(async () => {
        if (recommendationBusy.current) return;
        recommendationBusy.current = true;
        const generation = ++recommendationGeneration.current;
        setRecommending(true);
        setRecommendationError('');
        const libraryArtists = useLibraryStore.getState().getAllArtists();
        const seeds = (libraryArtists.length ? libraryArtists.map(artist => artist.name)
            : ['SZA', 'PinkPantheress', 'Metro Boomin']).sort(() => Math.random() - 0.5).slice(0, 2);
        try {
            // Artist/album/playlist rails are not reachable in the current Buscar screen.
            // Request only its visible songs; an unrelated endpoint failure must not hide them.
            const responses = await Promise.allSettled(seeds.map(seed => searchTidal(seed)));
            if (!mounted.current || generation !== recommendationGeneration.current) return;
            const songs = responses.flatMap(response => response.status === 'fulfilled' ? response.value : []);
            if (!songs.length && responses.some(response => response.status === 'rejected')) {
                setRecommendationError('No se pudieron cargar las sugerencias. Inténtalo de nuevo.');
            }
            setRecommendations(Array.from(new Map(songs.map(track => [track.id, track])).values())
                .sort(() => Math.random() - 0.5).slice(0, 12));
        } finally {
            recommendationBusy.current = false;
            if (mounted.current && generation === recommendationGeneration.current) setRecommending(false);
        }
    }, []);
    useEffect(() => { void fetchRecommendations(); }, [fetchRecommendations]);

    // Canciones, artistas y álbumes en una sola búsqueda ya ordenada por
    // relevancia (catalogRanking.ts, el mismo ranking de escritorio). Lo que se
    // escribe no se guarda en recientes: solo lo que se envía o se abre.
    const search = useCallback(async (query: string, requestId: number) => {
        const generation = ++searchGeneration.current;
        if (!query) { setTracks([]); setCatalog(null); return; }
        try {
            const found = await searchTidalCatalogAll(query);
            if (!mounted.current || generation !== searchGeneration.current) return;
            const topTrack = found.top?.kind === 'track' ? [found.top.track] : [];
            setTracks([...topTrack, ...found.tracks]);
            setCatalog(found);
            setResult(JSON.stringify({ requestId, query, status: 'ready',
                top: displayTop(found.top),
                tracks: found.tracks.map(displayTrack),
                artists: found.artists.slice(0, 24).map(displayArtist),
                albums: found.albums.slice(0, 24).map(displayAlbum) }));
        } catch (error) {
            if (!mounted.current || generation !== searchGeneration.current) return;
            setTracks([]);
            setCatalog(null);
            setResult(JSON.stringify({ requestId, query, status: 'error',
                error: error instanceof Error ? error.message : 'No se pudo consultar el catálogo.', tracks: [] }));
        }
    }, []);

    const openEntity = useCallback((kind: string, id: string) => {
        const artist = catalog?.artists.find(item => String(item.id) === id)
            ?? (catalog?.top?.kind === 'artist' && String(catalog.top.artist.id) === id ? catalog.top.artist : undefined);
        const album = catalog?.albums.find(item => String(item.id) === id)
            ?? (catalog?.top?.kind === 'album' && String(catalog.top.album.id) === id ? catalog.top.album : undefined);
        const recent = recentItems.find(item => item.kind === kind && item.id === id);
        if (kind === 'artist') {
            const name = artist?.name ?? recent?.title ?? '';
            rememberRecentItem({ kind: 'artist', id, title: name, subtitle: 'Artista',
                artwork: normalizeCardImageUri(artist?.artworkUrl) || recent?.artwork });
            router.push({ pathname: '/tidal-artist/[id]', params: { id, name, source: 'soulseek' } });
        } else if (kind === 'album') {
            rememberRecentItem({ kind: 'album', id, title: album?.title ?? recent?.title ?? 'Álbum',
                subtitle: album ? `${albumKindLabel(album)} · ${album.artistName}` : recent?.subtitle ?? 'Álbum',
                artwork: normalizeCardImageUri(album?.artworkUrl) || recent?.artwork });
            router.push({ pathname: '/tidal-album/[id]', params: { id, source: 'soulseek' } });
        }
    }, [catalog, recentItems, rememberRecentItem]);

    const displayedTracks = useMemo(() => new Map([...recommendations, ...tracks].map(track => [String(track.id), track])),
        [recommendations, tracks]);
    const transferSnapshot = useMemo(() => JSON.stringify({
        activeId: actions.activeTidalTrackId ? String(actions.activeTidalTrackId) : '',
        playing: actions.isPlayerPlaying,
        tracks: Array.from(displayedTracks.values()).map(track => {
            const state = actions.downloads.get(track.id);
            return { id: String(track.id), progress: state?.progress ?? 0,
                status: state?.status === 'downloading' ? 'downloading'
                    : actions.isDownloaded(track.id) || state?.status === 'done' ? 'done'
                        : state?.status === 'error' ? 'error' : 'idle' };
        }),
    }), [actions.activeTidalTrackId, actions.downloads, actions.isDownloaded, actions.isPlayerPlaying, displayedTracks]);
    const recommendationSnapshot = useMemo(() => JSON.stringify({ loading: recommending,
        error: recommendationError, tracks: recommendations.map(displayTrack) }), [recommending, recommendationError, recommendations]);
    const settingsSnapshot = useMemo(() => JSON.stringify({ quality, mirror, authRevision,
        saving: credentials.isSaving,
        mirrors: [...health.recommendedMirrors, ...health.legacyMirrors].map(server => ({
            id: server, title: TIDAL_MIRROR_NAMES[server] || server.replace('https://', ''),
            description: `${formatMirrorStatus(health.availability[server])} · ${formatMirrorCapabilities(health.availability[server])}`,
            enabled: health.availability[server]?.status !== 'unavailable',
            legacy: health.legacyMirrors.includes(server),
        })),
    }), [quality, mirror, authRevision, credentials.isSaving, health.recommendedMirrors,
        health.legacyMirrors, health.availability]);

    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<SearchAction>) => {
        const run = async () => {
            switch (event.action) {
                case 'search': await search(event.value, event.requestId); return;
                case 'remember':
                    if (event.value.trim()) rememberRecentItem({ kind: 'query', id: event.value.trim(), title: event.value.trim(), subtitle: 'Búsqueda' });
                    return;
                case 'open': openEntity(event.id, event.value); return;
                case 'forgetRecent': forgetRecentItem(event.value); return;
                case 'clearRecent': clearRecentItems(); return;
                case 'refresh': await fetchRecommendations(); return;
                case 'mirrorsVisible': setMirrorVisible(event.value === 'true'); return;
                case 'quality':
                    if (['LOSSLESS', 'MP3', 'HI_RES_LOSSLESS', 'LOW'].includes(event.value)) {
                        useSettingsStore.getState().setTidalDownloadQuality(event.value as TidalQuality);
                    }
                    return;
                case 'mirror':
                    if (event.value === 'auto' || [...health.recommendedMirrors, ...health.legacyMirrors].includes(event.value)) {
                        useSettingsStore.getState().setTidalMirror(event.value);
                        useNotificationStore.getState().showNotification(event.value === 'auto'
                            ? 'Modo automático activado' : `Fuente seleccionada: ${TIDAL_MIRROR_NAMES[event.value] || event.value}`, 'info');
                    }
                    return;
                case 'saveCredentials':
                    if (await credentials.save({ username: event.id, password: event.value })) {
                        if (mounted.current) setAuthRevision(value => value + 1);
                    }
                    return;
                case 'download':
                case 'track': {
                    const track = displayedTracks.get(event.id);
                    if (!track) return;
                    if (tracks.some(item => item.id === track.id)) {
                        rememberRecentItem({ kind: 'track', id: String(track.id), title: track.title,
                            subtitle: `Canción · ${track.artist}`, artwork: normalizeCardImageUri(track.artworkUrl) || undefined });
                    }
                    // A downloaded song is immediately playable; the separate download target stays independent.
                    const local = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                    if (local && event.action === 'track') {
                        await usePlayerStore.getState().play(local, [local]);
                    } else {
                        await actions.handleSoulseekOnlyDownload(track);
                    }
                }
            }
        };
        void run().catch(error => useNotificationStore.getState().showNotification(
            error instanceof Error ? error.message : 'No se pudo completar la acción.', 'error'));
    }, [actions.handleSoulseekOnlyDownload, credentials.save, displayedTracks, fetchRecommendations,
        health.legacyMirrors, health.recommendedMirrors, search, openEntity, rememberRecentItem, forgetRecentItem,
        clearRecentItems, tracks]);

    if (!NativeView) return null;
    return <NativeView style={styles.screen} result={result} recommendations={recommendationSnapshot}
        transfers={transferSnapshot} settings={settingsSnapshot}
        credentials={{ username: credentials.username, password: credentials.password }}
        recentSearches={recentSearches} appearance={{ ...theme.colors }} topInset={insets.top}
        bottomInset={180 + insets.bottom} authRequest={authRequest} onAction={onAction} />;
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
