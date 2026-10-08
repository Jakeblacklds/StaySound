import { useDynamicColors } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { resolveRemoteTrackForPlayback } from '@/src/services/remotePlaybackService';
import { createTidalStreamTrack } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import { Album, Playlist, Track } from '@/src/types';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router } from '@/src/navigation/navigation';
import React, { useCallback, useDeferredValue, useMemo } from 'react';
import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type HomeAction = {
    action: 'play' | 'album' | 'library' | 'scan' | 'queue' | 'playlist' | 'createPlaylist' | 'remove' | 'deleteFile';
    id: string;
    value: string;
};
interface NativeProps extends ViewProps {
    catalog: string;
    recentlyPlayed: string;
    appearance: Record<string, string>;
    labels: Record<string, string>;
    userName: string;
    scanning: boolean;
    lightweight: boolean;
    topInset: number;
    bottomInset: number;
    onAction: (event: NativeSyntheticEvent<HomeAction>) => void;
}

export const hasNativeHome = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundHomeView') !== null;
const NativeView = hasNativeHome ? requireNativeViewManager<NativeProps>('StaySoundHomeView') : null;

function values<T,>(source: unknown): T[] {
    if (source instanceof Map) return Array.from(source.values());
    if (Array.isArray(source)) return source.map(item => Array.isArray(item) && item.length === 2 ? item[1] : item);
    return [];
}
function displayTrack(track: Track) {
    return {
        id: track.id, title: track.title, artist: track.artist,
        artwork: track.artwork || '', thumbnail: track.artworkThumb || '',
        codec: track.codec || '', sampleRate: track.sampleRate, bitDepth: track.bitDepth,
        dateAdded: track.dateAdded, downloadedAt: track.downloadedAt,
    };
}

const actionLabels = {
    es: {
        queue: 'Agregar a cola', queueHint: 'Se reproducirá al final de la cola', queued: 'Agregada a la cola', playlist: 'Agregar a playlist', newPlaylist: 'Nueva playlist',
        playlistName: 'Nombre de la playlist', remove: 'Quitar de la biblioteca', deleteFile: 'Borrar del dispositivo',
        removeMessage: 'Se quitará “{title}” de tu biblioteca. El archivo permanecerá en tu dispositivo.',
        deleteFileMessage: 'Se borrará “{title}” permanentemente del dispositivo. Esta acción no se puede deshacer.',
        options: 'Opciones', page: 'Selección {page} de {count}',
        loadError: 'No se pudo cargar Inicio', loadErrorDescription: 'Intenta cargarlo de nuevo.', retry: 'Reintentar',
        actionError: 'No se pudo completar la acción. Inténtalo de nuevo.',
    },
    en: {
        queue: 'Add to queue', queueHint: 'Plays at the end of the queue', queued: 'Added to queue', playlist: 'Add to playlist', newPlaylist: 'New playlist',
        playlistName: 'Playlist name', remove: 'Remove from library', deleteFile: 'Delete from device',
        removeMessage: '“{title}” will be removed from your library. The file will remain on your device.',
        deleteFileMessage: '“{title}” will be permanently deleted from this device. This cannot be undone.',
        options: 'Options', page: 'Pick {page} of {count}',
        loadError: 'Could not load Home', loadErrorDescription: 'Try loading it again.', retry: 'Retry',
        actionError: 'Could not complete this action. Please try again.',
    },
};

export default function NativeHomeScreen() {
    const { theme, config } = useTheme();
    const { t, language, locale } = useI18n();
    const performance = usePerformanceProfile();
    const insets = useSafeAreaInsets();
    const tracks = useLibraryStore(s => s.tracks);
    const albums = useLibraryStore(s => s.albums);
    const playlists = useLibraryStore(s => s.playlists);
    const scanning = useLibraryStore(s => s.isScanning);
    const recent = usePlayerStore(s => s.recentlyPlayed);
    const artwork = usePlayerStore(s => s.currentTrack?.artwork || s.currentTrack?.artworkThumb);
    const userName = useOnboardingStore(s => s.userName);
    const { colors } = useDynamicColors(artwork, { enabled: performance.enableDynamicColors, applyToTheme: false });
    const snapshot = useMemo(() => ({ tracks, albums, playlists }), [tracks, albums, playlists]);
    const deferred = useDeferredValue(snapshot);
    // Only display metadata crosses the bridge. Kotlin owns selection, sorting, recycling and gestures.
    const catalog = useMemo(() => JSON.stringify({
        songs: values<Track>(deferred.tracks).map(displayTrack),
        albums: values<Album>(deferred.albums).map(album => ({
            id: album.id, title: album.name, artist: album.artist, trackIds: album.tracks,
            artwork: album.artwork || '', thumbnail: album.artworkThumb || '',
        })),
        playlists: values<Playlist>(deferred.playlists).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
    }), [deferred]);
    // A new song must not serialize/reparse the whole library.
    const recentlyPlayed = useMemo(() => JSON.stringify(recent.slice(0, 10).map(displayTrack)), [recent]);
    const appearance = useMemo(() => ({
        background: theme.colors.background, onBackground: theme.colors.onBackground,
        primary: colors.primary || theme.colors.primary, onPrimary: theme.colors.onPrimary,
        primaryContainer: theme.colors.primaryContainer, onPrimaryContainer: theme.colors.onPrimaryContainer,
        surfaceVariant: theme.colors.surfaceVariant, onSurface: theme.colors.onSurface,
        onSurfaceVariant: theme.colors.onSurfaceVariant, outline: theme.colors.outline,
    }), [colors.primary, theme.colors]);
    const labels = useMemo(() => ({
        ...actionLabels[language], locale, appName: t('common.appName'),
        morning: t('home.greeting.morning'), afternoon: t('home.greeting.afternoon'), night: t('home.greeting.night'),
        play: t('home.play'), seeAll: t('home.seeAll'), picks: t('home.picks'),
        recentlyPlayed: t('home.recentlyPlayed'), recentDownloads: t('home.recentDownloads'),
        recentlyAdded: t('home.recentlyAdded'), albumsSection: t('home.albumsSection'),
        emptyTitle: t('home.empty.title'), emptyDescription: t('home.empty.description'),
        scan: t('home.empty.action'), scanning: t('settings.library.scanning'),
        cancel: t('common.cancel'), create: t('common.create'),
    }), [language, locale, t]);

    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<HomeAction>) => {
        const library = useLibraryStore.getState();
        const player = usePlayerStore.getState();
        const run = async () => {
            switch (event.action) {
                case 'library': router.push('/library'); return;
                case 'album':
                    if (library.albums.has(event.id)) router.push({ pathname: '/album/[id]', params: { id: event.id } });
                    return;
                case 'scan': if (!library.isScanning) await library.scanLibrary(); return;
            }
            // Resolve against live state; the displayed catalog may be a deferred revision.
            const local = library.tracks.get(event.id);
            const track = local ?? player.recentlyPlayed.find(item => item.id === event.id);
            if (!track) return;
            switch (event.action) {
                case 'play': {
                    if (local) { await player.play(local, values<Track>(library.tracks)); return; }
                    const tidalId = track.tidalId ?? Number(track.id.match(/^tidal(?:_stream)?_(\d+)$/)?.[1]);
                    const downloaded = tidalId ? library.tracks.get(`tidal_${tidalId}`) : undefined;
                    if (downloaded) { await player.play(downloaded, [downloaded]); return; }
                    if (!Number.isFinite(tidalId) || !tidalId) { await player.play(track, [track]); return; }
                    player.setPendingTrackPreview({ id: track.id, title: track.title, artist: track.artist,
                        artwork: track.artwork, tidalId });
                    try {
                        const stream = await createTidalStreamTrack({
                            id: tidalId, title: track.title, artist: track.artist, album: track.album,
                            durationMs: track.duration, quality: track.quality || 'LOSSLESS',
                            isHiRes: (track.quality || '').toUpperCase().includes('HI_RES'),
                            artworkUrl: track.artwork, trackNumber: track.trackNumber, year: track.year,
                            sampleRate: track.sampleRate, bitDepth: track.bitDepth, codec: track.codec, albumId: track.tidalAlbumId,
                        }, { qobuzOnly: true });
                        await player.play(stream, [stream]);
                    } catch (error) { player.setPendingTrackPreview(null); throw error; }
                    return;
                }
                case 'queue': {
                    // Recent streams can have expired URLs. Reuse a download when available,
                    // otherwise resolve a fresh stream just as the play action does.
                    const tidalId = track.tidalId ?? Number(track.id.match(/^tidal(?:_stream)?_(\d+)$/)?.[1]);
                    const downloaded = tidalId ? library.tracks.get(`tidal_${tidalId}`) : undefined;
                    const resolved = local ?? downloaded ?? (Number.isFinite(tidalId) && tidalId
                        ? await createTidalStreamTrack({
                            id: tidalId, title: track.title, artist: track.artist, album: track.album,
                            durationMs: track.duration, quality: track.quality || 'LOSSLESS',
                            isHiRes: (track.quality || '').toUpperCase().includes('HI_RES'),
                            artworkUrl: track.artwork, trackNumber: track.trackNumber, year: track.year,
                            sampleRate: track.sampleRate, bitDepth: track.bitDepth, codec: track.codec, albumId: track.tidalAlbumId,
                        }, { qobuzOnly: true }) : await resolveRemoteTrackForPlayback(track));
                    if (await player.addToQueue(resolved)) useNotificationStore.getState().showNotification(
                        `${actionLabels[language].queued} · ${track.title}`, 'success');
                    return;
                }
                case 'playlist':
                    if (library.playlists.has(event.value)) library.addToPlaylist(event.value, track.id);
                    return;
                case 'createPlaylist': {
                    const name = event.value.trim();
                    if (name) library.addToPlaylist(library.createPlaylist(name), track.id);
                    return;
                }
                case 'remove': if (local) await library.deleteTrack(local.id, false); return;
                case 'deleteFile': if (local) await library.deleteTrack(local.id, true); return;
            }
        };
        void run().catch(error => {
            console.error('[NativeHome]', error);
            useNotificationStore.getState().showNotification(
                error instanceof Error ? error.message : actionLabels[language].actionError, 'error');
        });
    }, [language]);

    if (!NativeView) return null;
    return <NativeView style={styles.screen} catalog={catalog} recentlyPlayed={recentlyPlayed}
        appearance={appearance} labels={labels} userName={userName || ''} scanning={scanning}
        lightweight={config.lightweightMode} topInset={insets.top} bottomInset={180 + insets.bottom}
        onAction={onAction} />;
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
