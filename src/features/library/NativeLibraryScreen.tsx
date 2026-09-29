import { useI18n } from '@/src/i18n';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { getNativeLibraryPlayback } from '@/src/services/nativeLibraryPlayback';
import { useTheme, usePerformanceProfile } from '@/src/theme';
import { Album, Artist, Playlist, Track } from '@/src/types';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router } from '@/src/navigation/navigation';
import React, { useCallback, useDeferredValue, useEffect, useMemo } from 'react';
import { Alert, Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type LibraryAction = {
    action: 'songs' | 'albums' | 'artists' | 'artistsVisible' | 'scan' | 'queue'
        | 'playlist' | 'createPlaylist' | 'remove' | 'deleteFile';
    id: string;
    value: string;
};
interface NativeProps extends ViewProps {
    catalog: string;
    appearance: Record<string, string>;
    labels: Record<string, string>;
    currentTrackId: string;
    scanning: boolean;
    topInset: number;
    bottomInset: number;
    playbackOptions: { shuffle: boolean; contextLimit: number; recentIds: string[] };
    onAction: (event: NativeSyntheticEvent<LibraryAction>) => void;
}

// Old installed APKs can still run an OTA bundle until they install the native build.
export const hasNativeLibrary = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundLibraryView') !== null;
const NativeView = hasNativeLibrary
    ? requireNativeViewManager<NativeProps>('StaySoundLibraryView')
    : null;

function values<T,>(source: Map<string, T> | unknown): T[] {
    if (source instanceof Map) return Array.from(source.values()) as T[];
    if (Array.isArray(source)) return source.map(([, item]) => item as T);
    return [];
}

const actionLabels = {
    es: {
        closeSearch: 'Cerrar búsqueda', options: 'Opciones', queue: 'Agregar a cola',
        playlist: 'Agregar a playlist', newPlaylist: 'Nueva playlist', playlistName: 'Nombre de la playlist',
        remove: 'Quitar de la biblioteca', deleteFile: 'Borrar del dispositivo',
        removeMessage: 'Se quitará “{title}” de tu biblioteca. El archivo permanecerá en tu dispositivo.',
        deleteFileMessage: 'Se borrará “{title}” permanentemente del dispositivo. Esta acción no se puede deshacer.',
        downloads: 'Descargas', music: 'Música', allFolders: 'Todas las carpetas',
        loadError: 'No se pudo cargar la biblioteca', loadErrorDescription: 'Intenta cargarla de nuevo.',
        retry: 'Reintentar', actionError: 'No se pudo completar la acción. Inténtalo de nuevo.',
        favorite: 'Favorita', nowPlaying: 'Reproduciéndose ahora',
    },
    en: {
        closeSearch: 'Close search', options: 'Options', queue: 'Add to queue',
        playlist: 'Add to playlist', newPlaylist: 'New playlist', playlistName: 'Playlist name',
        remove: 'Remove from library', deleteFile: 'Delete from device',
        removeMessage: '“{title}” will be removed from your library. The file will remain on your device.',
        deleteFileMessage: '“{title}” will be permanently deleted from this device. This cannot be undone.',
        downloads: 'Downloads', music: 'Music', allFolders: 'All folders',
        loadError: 'Could not load the library', loadErrorDescription: 'Try loading it again.',
        retry: 'Retry', actionError: 'Could not complete this action. Please try again.',
        favorite: 'Favorite', nowPlaying: 'Now playing',
    },
};

export default function NativeLibraryScreen() {
    const { theme, config } = useTheme();
    const { t, language, locale } = useI18n();
    const insets = useSafeAreaInsets();
    const performance = usePerformanceProfile();
    const shuffle = usePlayerStore(s => s.shuffleEnabled);
    const recent = usePlayerStore(s => s.recentlyPlayed);
    const playbackOptions = useMemo(() => ({
        shuffle, contextLimit: performance.queueContextLimit, recentIds: recent.map(track => track.id),
    }), [shuffle, performance.queueContextLimit, recent]);
    const tracks = useLibraryStore(s => s.tracks);
    const albums = useLibraryStore(s => s.albums);
    const artists = useLibraryStore(s => s.artists);
    const playlists = useLibraryStore(s => s.playlists);
    const scanning = useLibraryStore(s => s.isScanning);
    const currentTrackId = usePlayerStore(s => s.currentTrack?.id ?? '');

    // Native display/playback snapshots are prepared once per catalog revision. Scroll, search,
    // tab selection, row recycling and image loading are entirely owned by Kotlin.
    const snapshot = useMemo(() => ({ tracks, albums, artists, playlists }), [tracks, albums, artists, playlists]);
    const deferred = useDeferredValue(snapshot);
    const catalog = useMemo(() => JSON.stringify({
        songs: values<Track>(deferred.tracks).map(track => ({
            id: track.id, title: track.title, uri: track.uri, artist: track.artist, album: track.album,
            format: track.format, codec: track.codec, cloudOnly: track.cloudOnly,
            artworkThumb: track.artworkThumb, sampleRate: track.sampleRate, bitDepth: track.bitDepth, quality: track.quality,
            subtitle: track.album && track.album !== 'Unknown Album' ? `${track.artist} - ${track.album}` : track.artist,
            artwork: track.artworkThumb || track.artwork || '', fallbackArtwork: track.artwork || '',
            duration: track.duration, favorite: !!track.favorite,
        })),
        albums: values<Album>(deferred.albums).map(album => ({
            id: album.id, title: album.name, subtitle: album.artist,
            artwork: album.artworkThumb || album.artwork || '', fallbackArtwork: album.artwork || '',
        })),
        artists: values<Artist>(deferred.artists).map(artist => ({
            id: artist.id, title: artist.name, artwork: artist.artwork || '', count: artist.albumCount,
        })),
        playlists: values<Playlist>(deferred.playlists).sort((a, b) => b.updatedAt - a.updatedAt)
            .map(playlist => ({ id: playlist.id, name: playlist.name })),
    }), [deferred]);

    const labels = useMemo(() => {
        const result: Record<string, string> = {
            ...actionLabels[language], locale,
            album: language === 'es' ? 'álbum' : 'album',
            title: t('library.title'), search: t('library.searchPlaceholder'),
            songs: t('library.tab.songs'), albums: t('library.tab.albums'), artists: t('library.tab.artists'),
            scan: t('library.scanAction'), scanning: t('settings.library.scanning'), scanWhere: t('scan.where'),
            cancel: t('common.cancel'), create: t('common.create'),
        };
        for (const [tab, key] of [['songs', 'emptySongs'], ['albums', 'emptyAlbums'], ['artists', 'emptyArtists']] as const) {
            for (const state of ['none', 'search'] as const) {
                for (const field of ['title', 'description'] as const) {
                    result[`${tab}.${state}.${field}`] = t(`library.${key}.${state}.${field}`);
                }
            }
        }
        return result;
    }, [language, locale, t]);
    useEffect(() => {
        const subscription = getNativeLibraryPlayback()?.addListener('onPlaybackFailed', () => {
            Alert.alert(t('library.title'), actionLabels[language].actionError);
        });
        return () => subscription?.remove();
    }, [language, t]);

    const appearance = useMemo(() => ({
        motion: config.lightweightMode || performance.mode === 'lite' ? 'off' : 'on',
        background: theme.colors.background,
        primary: theme.colors.primary, primaryContainer: theme.colors.primaryContainer,
        onPrimaryContainer: theme.colors.onPrimaryContainer, onBackground: theme.colors.onBackground,
        surfaceVariant: theme.colors.surfaceVariant, onSurface: theme.colors.onSurface,
        onSurfaceVariant: theme.colors.onSurfaceVariant,
    }), [theme.colors, config.lightweightMode, performance.mode]);

    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<LibraryAction>) => {
        const library = useLibraryStore.getState();
        const player = usePlayerStore.getState();
        const run = async () => {
            switch (event.action) {
                case 'albums':
                    if (library.albums.has(event.id)) router.push({ pathname: '/album/[id]', params: { id: event.id } });
                    return;
                case 'artists':
                    if (library.artists.has(event.id)) router.push({ pathname: '/artist/[id]', params: { id: event.id } });
                    return;
                case 'artistsVisible':
                    if (!library.isScanning) await library.refreshArtistPhotos();
                    return;
                case 'scan':
                    if (!library.isScanning) await library.scanLibrary(event.value);
                    return;
            }
            // Resolve from the latest store: deletion or a rescan can race a native tap.
            const track = library.tracks.get(event.id);
            if (!track) return;
            switch (event.action) {
                case 'songs':
                    await player.play(track, values<Track>(library.tracks).sort((a, b) => a.title.localeCompare(b.title, locale)));
                    break;
                case 'queue': player.addToQueue(track); break;
                case 'playlist':
                    if (library.playlists.has(event.value)) library.addToPlaylist(event.value, track.id);
                    break;
                case 'createPlaylist': {
                    const name = event.value.trim();
                    if (name) library.addToPlaylist(library.createPlaylist(name), track.id);
                    break;
                }
                case 'remove': await library.deleteTrack(track.id, false); break;
                case 'deleteFile': await library.deleteTrack(track.id, true); break;
            }
        };
        void run().catch(error => {
            console.error('[NativeLibrary]', error);
            Alert.alert(t('library.title'), actionLabels[language].actionError);
        });
    }, [language, locale, t]);

    if (!NativeView) return null;
    // The navigation slot sizes only its direct child, so the Kotlin view must be that child.
    return <NativeView style={styles.screen} catalog={catalog} labels={labels} appearance={appearance}
        currentTrackId={currentTrackId} scanning={scanning} topInset={insets.top} bottomInset={120 + insets.bottom}
        onAction={onAction} playbackOptions={playbackOptions} />;
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
