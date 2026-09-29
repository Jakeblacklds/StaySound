import { useArtistInfo, useDynamicColors } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { generateArtistId } from '@/src/services/metadataService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router, useFocusEffect } from '@/src/navigation/navigation';
import React, { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { Platform, StatusBar, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Kind = 'artist' | 'album';
type DetailAction = { action: 'play' | 'queue' | 'album' | 'back'; kind: Kind; detailId: string; id: string; trackIds: string[] };
interface NativeProps extends ViewProps {
    catalog: string;
    selection: string;
    artistInfo: Record<string, string>;
    appearance: Record<string, string>;
    labels: Record<string, string>;
    currentTrackId: string;
    topInset: number;
    bottomInset: number;
    onAction: (event: NativeSyntheticEvent<DetailAction>) => void;
}

// Feature detection keeps OTA bundles usable on older APKs, iOS and web.
export const hasNativeDetails = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundDetailView') !== null;
const NativeView = hasNativeDetails ? requireNativeViewManager<NativeProps>('StaySoundDetailView') : null;
const labelsByLanguage = {
    es: { artist: 'ARTISTA', album: 'ÁLBUM', songs: 'canciones', albums: 'Álbumes', tracks: 'CANCIONES',
        topSongs: 'Top Songs', play: 'Reproducir', back: 'Volver', queue: 'Agregar a cola', cancel: 'Cancelar',
        about: 'Acerca del artista', more: 'Leer más', less: 'Leer menos', loading: 'Buscando información del artista…',
        noBiography: 'Artista verificado en Deezer. No hay biografía disponible.',
        notFound: 'No se encontró este detalle en la biblioteca.', empty: 'No hay canciones disponibles.',
        error: 'No se pudo cargar el detalle.', retry: 'Reintentar', actionError: 'No se pudo completar la acción.',
        nowPlaying: 'Reproduciéndose ahora', favorite: 'Favorita' },
    en: { artist: 'ARTIST', album: 'ALBUM', songs: 'songs', albums: 'Albums', tracks: 'TRACKS',
        topSongs: 'Top Songs', play: 'Play', back: 'Back', queue: 'Add to queue', cancel: 'Cancel',
        about: 'About the Artist', more: 'Read more', less: 'Read less', loading: 'Searching artist info…',
        noBiography: 'Artist verified on Deezer. No biography available.',
        notFound: 'This detail was not found in your library.', empty: 'No songs available.',
        error: 'Could not load this detail.', retry: 'Retry', actionError: 'Could not complete this action.',
        nowPlaying: 'Now playing', favorite: 'Favorite' },
};

export default function NativeDetailScreen({ kind, id }: { kind: Kind; id: string }) {
    const { theme, config } = useTheme();
    const performance = usePerformanceProfile();
    const { language } = useI18n();
    const insets = useSafeAreaInsets();
    const tracks = useLibraryStore(s => s.tracks);
    const albums = useLibraryStore(s => s.albums);
    const artists = useLibraryStore(s => s.artists);
    const currentTrackId = usePlayerStore(s => s.currentTrack?.id || '');
    const artist = kind === 'artist' ? artists.get(id) : undefined;
    const album = kind === 'album' ? albums.get(id) : undefined;
    const { info, isLoading } = useArtistInfo(artist?.name);
    const artwork = artist?.artwork || (kind === 'artist' ? info?.photo_url : album?.artwork || album?.artworkThumb);
    const { colors } = useDynamicColors(artwork || undefined, {
        enabled: performance.enableDynamicColors && config.dynamicColors, applyToTheme: false,
    });
    const snapshot = useMemo(() => ({ tracks, albums, artists }), [tracks, albums, artists]);
    const deferred = useDeferredValue(snapshot);
    // Only metadata and canonical relationships cross the bridge; Kotlin selects and lists.
    const catalog = useMemo(() => JSON.stringify({
        songs: Array.from(deferred.tracks.values(), track => ({
            id: track.id, title: track.title, artist: track.artist, album: track.album,
            artistId: track.artistId, canonicalArtistId: generateArtistId(track.artist),
            artwork: track.artwork || '', thumbnail: track.artworkThumb || '',
            duration: track.duration, favorite: !!track.favorite,
        })),
        albums: Array.from(deferred.albums.values(), item => ({
            id: item.id, title: item.name, artist: item.artist, trackIds: item.tracks,
            artwork: item.artwork || '', thumbnail: item.artworkThumb || '',
        })),
        artists: Array.from(deferred.artists.values(), item => ({
            id: item.id, name: item.name, artwork: item.artwork || '', albumIds: item.albums,
        })),
    }), [deferred]);
    const selection = useMemo(() => JSON.stringify({ kind, id }), [kind, id]);
    const artistInfo = useMemo(() => ({
        photo: info?.photo_url || '', biography: info?.biography || '', loading: String(isLoading),
    }), [info, isLoading]);
    const appearance = useMemo(() => ({
        background: theme.colors.background, surface: theme.colors.surfaceVariant,
        primary: colors.primary, onPrimary: colors.onPrimary, text: colors.text,
        paletteBackground: colors.background, dark: String(colors.isDark),
        lightweight: String(config.lightweightMode || !performance.enableAnimatedBackgrounds),
    }), [theme.colors, colors, config.lightweightMode, performance.enableAnimatedBackgrounds]);
    const focused = useRef(false);
    useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<DetailAction>) => {
        if (!focused.current || event.kind !== kind || event.detailId !== id) return;
        const library = useLibraryStore.getState();
        const player = usePlayerStore.getState();
        const run = async () => {
            if (event.action === 'back') { router.back(); return; }
            if (event.action === 'album') {
                if (kind === 'artist' && library.artists.get(id)?.albums.includes(event.id) && library.albums.has(event.id)) {
                    router.push({ pathname: '/album/[id]', params: { id: event.id } });
                }
                return;
            }
            // Validate stale taps against live state. Native order remains the playback context.
            const members = kind === 'artist' ? library.getTracksByArtist(id) : library.getTracksByAlbum(id);
            const allowed = new Set(members.map(track => track.id));
            const track = library.tracks.get(event.id);
            if (!track || !allowed.has(track.id)) return;
            if (event.action === 'queue') { player.addToQueue(track); return; }
            if (event.action === 'play') {
                const context = Array.from(new Set(event.trackIds))
                    .filter(trackId => allowed.has(trackId)).map(trackId => library.tracks.get(trackId))
                    .filter((item): item is Track => !!item);
                if (context.some(item => item.id === track.id)) await player.play(track, context);
            }
        };
        void run().catch(error => {
            console.error('[NativeDetail]', error);
            useNotificationStore.getState().showNotification(labelsByLanguage[language].actionError, 'error');
        });
    }, [kind, id, language]);

    if (!NativeView) return null;
    // The Kotlin container owns Android hardware and predictive Back.
    return <>
        <StatusBar barStyle={colors.isDark ? 'light-content' : 'dark-content'} />
        <NativeView style={styles.screen} catalog={catalog} selection={selection} artistInfo={artistInfo}
            appearance={appearance} labels={labelsByLanguage[language]} currentTrackId={currentTrackId}
            topInset={insets.top} bottomInset={120 + insets.bottom} onAction={onAction} />
    </>;
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
