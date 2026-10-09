import { hasNativeTidalDetails, NativeTidalDetail } from '@/src/features/tidal/details/NativeTidalDetail';
import { EmptyState, Skeleton, TidalTrackRow } from '@/src/components/ui';
import {
    DetailActionBar,
    DetailTopBar,
    GlassPanel,
    SectionHeader,
    TidalAtmosphere,
    TidalAtmosphereColors,
} from '@/src/components/tidal';
import { useTidalDownload } from '@/src/hooks';
import { createRng, fisherYates } from '@/src/services/shuffle';
import { createTidalStreamTrack, getTidalPlaylistDetail, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';
import { TidalPlaylistDetail, TidalTrack, Track } from '@/src/types/audio';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

async function resolveTidalQueue(tracks: TidalTrack[], batchSize = 6): Promise<Track[]> {
    const out: Track[] = [];
    for (let i = 0; i < tracks.length; i += batchSize) {
        const slice = tracks.slice(i, i + batchSize);
        const settled = await Promise.allSettled(slice.map(track => createTidalStreamTrack(track)));
        for (const result of settled) {
            if (result.status === 'fulfilled') out.push(result.value);
        }
    }
    return out;
}

function TidalPlaylistController() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    const [playlistDetail, setPlaylistDetail] = useState<TidalPlaylistDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPreparing, setIsPreparing] = useState<null | 'play' | 'shuffle'>(null);
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [atmos, setAtmos] = useState<TidalAtmosphereColors | null>(null);
    const accentColor = atmos?.colors.primary ?? theme.colors.primary;

    const showNotification = useNotificationStore(s => s.showNotification);

    const {
        downloads,
        download,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    } = useTidalDownload();

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

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    useEffect(() => {
        if (!id) {
            setError('Playlist ID invalido');
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        getTidalPlaylistDetail(id)
            .then(detail => {
                if (cancelled) return;
                setPlaylistDetail(detail);
            })
            .catch((playlistError: unknown) => {
                if (cancelled) return;
                const message = playlistError instanceof Error ? playlistError.message : 'No se pudo cargar la playlist';
                setError(message);
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [id]);

    const handleTidalPlay = useCallback(async (track: TidalTrack) => {
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
                const streamTrack = await createTidalStreamTrack(track);
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
            Alert.alert('Error de reproduccion', message);
        }
    }, [download, forgetDownloadedTrack, getDownloadedTrack, play, setPendingTrackPreview]);

    const handleTidalDownload = useCallback(async (track: TidalTrack) => {
        try {
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            await download(track);
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            Alert.alert('Descarga fallida', message);
        }
    }, [cancelDownload, download, downloads]);

    const handlePlayAll = useCallback(async (shuffle: boolean) => {
        const tracks = playlistDetail?.tracks ?? [];
        if (tracks.length === 0 || isPreparing) return;

        setIsPreparing(shuffle ? 'shuffle' : 'play');
        const ordered = shuffle ? fisherYates(tracks, createRng()) : tracks;
        const first = ordered[0];
        setPendingTrackPreview({
            id: `tidal_pending_${first.id}`,
            title: first.title,
            artist: first.artist,
            artwork: first.artworkUrl ?? playlistDetail?.playlist.artworkUrl,
            tidalId: first.id,
        });

        try {
            const resolved = await resolveTidalQueue(ordered);
            if (resolved.length === 0) {
                throw new Error('No se pudo preparar la reproducción');
            }
            await play(resolved[0], resolved);
        } catch (playError) {
            setPendingTrackPreview(null);
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir';
            showNotification(message, 'error');
        } finally {
            setIsPreparing(null);
        }
    }, [isPreparing, play, playlistDetail?.playlist.artworkUrl, playlistDetail?.tracks, setPendingTrackPreview, showNotification]);

    const handleDownloadAll = useCallback(async () => {
        const tracks = playlistDetail?.tracks ?? [];
        if (tracks.length === 0 || isDownloadingAll) return;

        const pending = tracks.filter(track => {
            const state = downloads.get(track.id);
            return !isDownloaded(track.id) && state?.status !== 'done' && state?.status !== 'downloading';
        });

        if (pending.length === 0) {
            showNotification('La playlist ya está descargada', 'info');
            return;
        }

        setIsDownloadingAll(true);
        showNotification(`Descargando ${pending.length} canciones…`, 'info');
        try {
            for (const track of pending) {
                await handleTidalDownload(track);
            }
        } finally {
            setIsDownloadingAll(false);
        }
    }, [downloads, handleTidalDownload, isDownloaded, isDownloadingAll, playlistDetail?.tracks, showNotification]);

    if (hasNativeTidalDetails) return <NativeTidalDetail
        kind="playlist" id={id} loading={isLoading} error={error}
        title={playlistDetail?.playlist.title || 'Playlist'} kicker="PLAYLIST"
        artwork={playlistDetail?.playlist.artworkUrl} description={playlistDetail?.playlist.description}
        meta={`${playlistDetail?.tracks.length ?? 0} canciones`}
        tracks={playlistDetail?.tracks} downloads={downloads} isDownloaded={isDownloaded}
        activeId={isPlayerPlaying || pendingTrackPreview ? activeTidalTrackId : null} playing={isPlayerPlaying}
        preparing={isPreparing} downloadingAll={isDownloadingAll}
        onPlay={handleTidalPlay} onPlayAll={handlePlayAll} onDownload={handleTidalDownload}
        onCancelDownload={cancelDownload} onDownloadAll={handleDownloadAll}
    />;

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
                <Stack.Screen options={{ headerShown: false }} />
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: 20 }}>
                    <View style={{ flexDirection: 'row', gap: 18, marginBottom: 28 }}>
                        <Skeleton height={148} width={148} borderRadius={radius.lg} />
                        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 10 }}>
                            <Skeleton height={14} width="40%" borderRadius={6} />
                            <Skeleton height={26} width="90%" borderRadius={8} />
                            <Skeleton height={18} width="55%" borderRadius={6} />
                        </View>
                    </View>
                    <Skeleton height={54} width="100%" borderRadius={radius.lg} style={{ marginBottom: 28 }} />
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={`s-tra-${i}`} height={56} width="100%" borderRadius={14} style={{ marginBottom: 8 }} />
                    ))}
                </ScrollView>
            </SafeAreaView>
        );
    }

    if (error || !playlistDetail) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <SafeAreaView style={[styles.centered, { backgroundColor: theme.colors.background }]}>
                    <EmptyState title="Playlist no disponible" description={error ?? 'No se pudo cargar'} />
                    <Button onPress={() => router.back()}>Volver</Button>
                </SafeAreaView>
            </>
        );
    }

    const coverUri = playlistDetail.playlist.artworkUrl;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle={theme.id.includes('dark') ? 'light-content' : 'dark-content'} />

            <TidalAtmosphere sourceUri={coverUri} mode="artwork" scrollY={scrollY} onColors={setAtmos} />

            <DetailTopBar title={playlistDetail.playlist.title} scrollY={scrollY} onBack={() => router.back()} />

            <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={[styles.content, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeIn.duration(450)} style={styles.hero}>
                    <View style={[styles.coverShadow, { shadowColor: theme.id.includes('dark') ? '#000' : '#475569' }]}>
                        <Image
                            source={coverUri ? { uri: coverUri } : undefined}
                            style={[styles.cover, { backgroundColor: theme.colors.surfaceVariant }]}
                            contentFit="cover"
                            transition={300}
                        />
                    </View>
                    <View style={styles.heroCopy}>
                        <Text style={[styles.kicker, { color: accentColor }]}>PLAYLIST</Text>
                        <Text numberOfLines={3} style={[styles.title, { color: theme.colors.onBackground }]}>
                            {playlistDetail.playlist.title}
                        </Text>
                        {playlistDetail.playlist.description ? (
                            <Text numberOfLines={2} style={[styles.desc, { color: withAlpha(theme.colors.onSurfaceVariant, 'D0') }]}>
                                {playlistDetail.playlist.description}
                            </Text>
                        ) : null}
                        <Text style={[styles.meta, { color: withAlpha(theme.colors.onSurfaceVariant, 'C0') }]}>
                            {playlistDetail.tracks.length} canciones
                        </Text>
                    </View>
                </Animated.View>

                <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.actionWrap}>
                    <DetailActionBar
                        accent={atmos?.animated.primary}
                        accentColor={accentColor}
                        onPrimaryColor={atmos?.colors.onPrimary ?? theme.colors.onPrimary}
                        preparing={isPreparing}
                        downloadingAll={isDownloadingAll}
                        onPlay={() => handlePlayAll(false)}
                        onShuffle={() => handlePlayAll(true)}
                        onDownloadAll={handleDownloadAll}
                    />
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(150)} style={styles.section}>
                    <SectionHeader kicker="En esta lista" title="Canciones" accent={accentColor} />
                    <GlassPanel style={styles.tracksPanel} radius={radius.xl} blurred={false}>
                        {playlistDetail.tracks.map((track, index) => {
                            const state = downloads.get(track.id);
                            const downloaded = isDownloaded(track.id) || state?.status === 'done';
                            const isDownloading = state?.status === 'downloading';
                            const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

                            return (
                                <Animated.View key={track.id} entering={FadeInRight.delay(180 + Math.min(index, 8) * 30)}>
                                    <TidalTrackRow
                                        title={track.title || 'Unknown Title'}
                                        artist={track.artist || 'Unknown Artist'}
                                        artworkUrl={track.artworkUrl}
                                        durationMs={track.durationMs}
                                        showArtwork
                                        tone="glass"
                                        accentColor={accentColor}
                                        isActive={isTrackActive}
                                        isPlaying={isPlayerPlaying}
                                        downloadStatus={isDownloading ? 'downloading' : downloaded ? 'done' : state?.status === 'error' ? 'error' : 'idle'}
                                        progress={state?.progress ?? 0}
                                        onPress={() => handleTidalPlay(track)}
                                        onDownloadPress={() => handleTidalDownload(track)}
                                    />
                                </Animated.View>
                            );
                        })}
                    </GlassPanel>
                </Animated.View>
            </Animated.ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
    },
    content: {
        paddingBottom: 140,
    },
    hero: {
        flexDirection: 'row',
        gap: 18,
        paddingHorizontal: 20,
        marginBottom: 22,
        alignItems: 'flex-end',
    },
    coverShadow: {
        borderRadius: radius.lg,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.45,
        shadowRadius: 24,
        elevation: 14,
    },
    cover: {
        width: 148,
        height: 148,
        borderRadius: radius.lg,
    },
    heroCopy: {
        flex: 1,
        gap: 6,
        paddingBottom: 2,
    },
    kicker: {
        ...typeScale.micro,
        letterSpacing: 1.4,
    },
    title: {
        ...typeScale.headline,
    },
    desc: {
        ...typeScale.caption,
    },
    meta: {
        ...typeScale.caption,
    },
    actionWrap: {
        paddingHorizontal: 20,
        marginBottom: 30,
    },
    section: {
        marginBottom: 32,
    },
    tracksPanel: {
        marginHorizontal: 16,
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
});

export function TidalPlaylistScreen() {
    const { id, name, source } = useLocalSearchParams<{ id: string; name?: string; source?: string }>();
    return <TidalPlaylistController key={`${id}:${name ?? ''}:${source ?? ''}`} />;
}
export default TidalPlaylistScreen;
