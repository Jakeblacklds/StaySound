import { useDynamicColorsWithOptions } from '@/src/hooks/useDynamicColors';
import { createTidalStreamTrack, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import { DownloadState, TidalTrack } from '@/src/types/audio';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router, Stack, useFocusEffect } from '@/src/navigation/navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { NativeSyntheticEvent, Platform, StatusBar, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TidalDetailKind = 'artist' | 'album' | 'playlist' | 'genre';
export type DetailLink = { kind: TidalDetailKind; id: string; title: string; subtitle?: string; artwork?: string; name?: string };
export type DetailSection = { title: string; kicker: string; size: number; circle?: boolean; items: DetailLink[] };
type Action = { screenKey: string; action: 'back' | 'play' | 'playAll' | 'shuffle' | 'queue' | 'download' | 'cancelDownload' | 'downloadAll' | 'navigate'; id?: string; kind?: TidalDetailKind };
interface NativeProps extends ViewProps {
    model: string;
    appearance: Record<string, string>;
    topInset: number;
    bottomInset: number;
    onAction: (event: NativeSyntheticEvent<Action>) => void;
}
// Never request an Android view manager on web/iOS or an APK without this module.
export const hasNativeTidalDetails = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundTidalDetailView') !== null;
const NativeView = hasNativeTidalDetails ? requireNativeViewManager<NativeProps>('StaySoundTidalDetailView') : null;

interface Props {
    kind: TidalDetailKind; id: string; source?: string; loading: boolean; error: string | null;
    title: string; kicker: string; artwork?: string; subtitle?: string; description?: string;
    meta?: string; quality?: string | null; explicit?: boolean; artistLink?: DetailLink;
    tracks?: TidalTrack[]; sections?: DetailSection[]; grid?: DetailLink[];
    downloads?: Map<number, DownloadState>; isDownloaded?: (id: number) => boolean;
    activeId?: number | null; playing?: boolean; preparing?: string | null; downloadingAll?: boolean;
    onPlay?: (track: TidalTrack) => Promise<void>; onPlayAll?: (shuffle: boolean) => Promise<void>;
    onDownload?: (track: TidalTrack) => Promise<void>; onCancelDownload?: (id: number) => Promise<void>;
    onDownloadAll?: () => Promise<void>;
}
const noTracks: TidalTrack[] = [];

/** Presentation adapter only. The route's existing TS handlers remain shared with RN. */
export function NativeTidalDetail(props: Props) {
    const { theme, isDark } = useTheme();
    const perf = usePerformanceProfile();
    const insets = useSafeAreaInsets();
    const { colors } = useDynamicColorsWithOptions(props.artwork, { enabled: perf.enableDynamicColors, applyToTheme: false });
    const [batchDownload, setBatchDownload] = useState(false);
    const screenKey = `${props.kind}:${props.id}:${props.source || 'tidal'}`;
    const focused = useRef(false);
    const pending = useRef(new Set<string>());
    useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
    const tracks = props.tracks ?? noTracks;
    const model = JSON.stringify({
        version: 1, screenKey, kind: props.kind, id: props.id, title: props.title, kicker: props.kicker,
        artwork: props.artwork, subtitle: props.subtitle, description: props.description,
        meta: props.meta, quality: props.quality, explicit: props.explicit, artistLink: props.artistLink,
        loading: props.loading, error: props.error, preparing: props.preparing,
        downloadingAll: props.downloadingAll || batchDownload,
        sections: props.sections ?? [], grid: props.grid ?? [],
        tracks: tracks.map(track => {
            const state = props.downloads?.get(track.id);
            return { id: String(track.id), title: track.title || 'Unknown Title', artist: track.artist || 'Unknown Artist',
                artwork: track.artworkUrl, durationMs: track.durationMs,
                active: props.activeId === track.id, playing: !!props.playing,
                status: state?.status === 'downloading' ? 'downloading' : props.isDownloaded?.(track.id) || state?.status === 'done' ? 'done' : state?.status === 'error' ? 'error' : 'idle',
                progress: state?.progress ?? 0 };
        }),
    });
    const appearance = useMemo(() => ({
        background: theme.colors.background, surface: theme.colors.surface, surfaceVariant: theme.colors.surfaceVariant,
        text: theme.colors.onBackground, subtle: theme.colors.onSurfaceVariant, outline: theme.colors.outline, error: theme.colors.error,
        primary: colors.primary, secondary: colors.secondary, onPrimary: colors.onPrimary,
        dark: String(isDark), lightweight: String(perf.mode === 'lite' || !perf.enableAnimatedBackgrounds),
    }), [theme.colors, colors, isDark, perf.mode, perf.enableAnimatedBackgrounds]);
    const onAction = ({ nativeEvent: event }: NativeSyntheticEvent<Action>) => {
        if (!focused.current || event.screenKey !== screenKey) return;
        const key = event.action === 'playAll' || event.action === 'shuffle' ? 'playAll' : `${event.action}:${event.id ?? ''}`;
        if (pending.current.has(key)) return;
        const run = async () => {
            if (event.action === 'back') { router.back(); return; }
            if (props.loading || props.error) return;
            if (event.action === 'navigate') {
                const links = [...(props.sections ?? []).flatMap(section => section.items), ...(props.grid ?? []), ...(props.artistLink ? [props.artistLink] : [])];
                const link = links.find(item => item.id === event.id && item.kind === event.kind);
                if (link) router.push({ pathname: `/tidal-${link.kind}/[id]`, params: { id: link.id, name: link.name ?? link.title, source: props.source ?? 'tidal' } });
                return;
            }
            if (event.action === 'playAll' || event.action === 'shuffle') {
                if (!props.preparing && tracks.length) await props.onPlayAll?.(event.action === 'shuffle');
                return;
            }
            if (event.action === 'downloadAll') {
                if (props.downloadingAll || batchDownload) return;
                setBatchDownload(true);
                try {
                    if (props.onDownloadAll) await props.onDownloadAll();
                    else for (const track of tracks) {
                        if (!props.isDownloaded?.(track.id) && props.downloads?.get(track.id)?.status !== 'downloading') await props.onDownload?.(track);
                    }
                } finally { setBatchDownload(false); }
                return;
            }
            const track = tracks.find(item => String(item.id) === event.id);
            if (!track) return;
            if (event.action === 'play') await props.onPlay?.(track);
            if (event.action === 'download' && !props.isDownloaded?.(track.id) && props.downloads?.get(track.id)?.status !== 'downloading') await props.onDownload?.(track);
            if (event.action === 'cancelDownload' && props.downloads?.get(track.id)?.status === 'downloading') await props.onCancelDownload?.(track.id);
            if (event.action === 'queue') {
                let local = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                if (local && !await isValidAudioFile(local.uri, local.uri.split('.').pop() || 'flac')) {
                    throw new Error('El archivo local no es válido. Reproduce la canción para repararlo antes de agregarla a la cola.');
                }
                if (!local && props.source === 'soulseek') {
                    if (props.downloads?.get(track.id)?.status === 'downloading') {
                        useNotificationStore.getState().showNotification('Espera a que termine la descarga para agregarla a la cola', 'info');
                        return;
                    }
                    await props.onDownload?.(track);
                    local = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                    if (!local) return;
                }
                const resolved = local ?? await createTidalStreamTrack(track, props.source === 'qobuz' ? { qobuzOnly: true } : {});
                usePlayerStore.getState().addToQueue(resolved);
            }
        };
        pending.current.add(key);
        void run().catch(error => useNotificationStore.getState().showNotification(
            error instanceof Error ? error.message : 'No se pudo completar la acción', 'error',
        )).finally(() => pending.current.delete(key));
    };
    if (!NativeView) return null;
    return <>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle={props.kind === 'artist' || isDark ? 'light-content' : 'dark-content'} />
        <NativeView style={{ flex: 1 }} model={model} appearance={appearance}
            topInset={insets.top} bottomInset={140 + insets.bottom} onAction={onAction} />
    </>;
}
