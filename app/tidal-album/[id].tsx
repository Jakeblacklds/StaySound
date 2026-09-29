import { hasNativeTidalDetails, NativeTidalDetail } from '@/src/features/tidal/details/NativeTidalDetail';
import { EmptyState, Skeleton, TidalTrackRow } from '@/src/components/ui';
import {
    DetailActionBar,
    DetailTopBar,
    GlassPanel,
    MediaRail,
    MediaRailItem,
    SectionHeader,
    TidalAtmosphere,
    TidalAtmosphereColors,
} from '@/src/components/tidal';
import { Ionicons } from '@expo/vector-icons';
import { useTidalDownload } from '@/src/hooks';
import { SoulseekCompressedFallbackError } from '@/src/services/soulseekDownloadService';
import { createRng, fisherYates } from '@/src/services/shuffle';
import { createTidalStreamTrack, getTidalAlbumDetail, getTidalSimilarAlbums, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';
import { TidalAlbum, TidalAlbumDetail, TidalTrack, Track } from '@/src/types';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

async function resolveTidalQueue(tracks: TidalTrack[], qobuzOnly: boolean, batchSize = 6): Promise<Track[]> {
    const opts = qobuzOnly ? { qobuzOnly: true } : {};
    const out: Track[] = [];
    for (let i = 0; i < tracks.length; i += batchSize) {
        const slice = tracks.slice(i, i + batchSize);
        const settled = await Promise.allSettled(slice.map(track => createTidalStreamTrack(track, opts)));
        for (const result of settled) {
            if (result.status === 'fulfilled') out.push(result.value);
        }
    }
    return out;
}

function deriveQualityLabel(tracks: TidalTrack[]): string | null {
    let lossless = false;
    for (const track of tracks) {
        const q = (track.quality || '').toUpperCase();
        if (track.isHiRes || q.includes('HI_RES') || q.includes('HIRES')) return 'Hi-Res';
        if (q.includes('LOSSLESS') || q.includes('FLAC')) lossless = true;
    }
    return lossless ? 'Lossless' : null;
}

function formatTotalDuration(ms: number): string {
    const totalMinutes = Math.round(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} h ${minutes} min`;
}

function TidalAlbumController() {
    const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);
    const isSoulseekSource = source === 'soulseek';
    const isQobuzSource = source === 'qobuz';

    const [albumDetail, setAlbumDetail] = useState<TidalAlbumDetail | null>(null);
    const [similarAlbums, setSimilarAlbums] = useState<TidalAlbum[]>([]);
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
        downloadFromSoulseek,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    } = useTidalDownload({ qobuzOnly: isQobuzSource });

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

    useEffect(() => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) {
            setError('Album ID invalido');
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        getTidalAlbumDetail(numericId)
            .then(detail => {
                if (cancelled) return;
                setAlbumDetail(detail);
            })
            .catch((albumError: unknown) => {
                if (cancelled) return;
                const message = albumError instanceof Error ? albumError.message : 'No se pudo cargar el album';
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

    useEffect(() => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return;

        let cancelled = false;
        setSimilarAlbums([]);
        getTidalSimilarAlbums(numericId)
            .then(list => {
                if (!cancelled) setSimilarAlbums(list.slice(0, 12));
            })
            .catch(() => { /* similar albums are optional enrichment */ });

        return () => {
            cancelled = true;
        };
    }, [id]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const handleTrackDownload = useCallback(async (track: TidalTrack) => {
        try {
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            if (isSoulseekSource) {
                try {
                    await downloadFromSoulseek(track);
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
                                        void downloadFromSoulseek(track, { allowCompressedFallback: true });
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

            await download(track);
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            Alert.alert('Descarga fallida', message);
        }
    }, [cancelDownload, download, downloadFromSoulseek, downloads, isSoulseekSource]);

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

            if (isSoulseekSource) {
                await handleTrackDownload(track);
                const localTrack = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                if (!localTrack) {
                    throw new Error('No se pudo preparar el archivo local');
                }
                await play(localTrack, [localTrack]);
                return;
            }

            try {
                const streamTrack = await createTidalStreamTrack(
                    track,
                    isQobuzSource ? { qobuzOnly: true } : {},
                );
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
    }, [download, forgetDownloadedTrack, getDownloadedTrack, handleTrackDownload, isQobuzSource, isSoulseekSource, play, setPendingTrackPreview]);

    const handlePlayAll = useCallback(async (shuffle: boolean) => {
        const tracks = albumDetail?.tracks ?? [];
        if (tracks.length === 0 || isPreparing) return;

        setIsPreparing(shuffle ? 'shuffle' : 'play');
        const ordered = shuffle ? fisherYates(tracks, createRng()) : tracks;
        const first = ordered[0];
        setPendingTrackPreview({
            id: `tidal_pending_${first.id}`,
            title: first.title,
            artist: first.artist,
            artwork: first.artworkUrl ?? albumDetail?.album.artworkUrl,
            tidalId: first.id,
        });

        try {
            const resolved = await resolveTidalQueue(ordered, isQobuzSource);
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
    }, [albumDetail?.album.artworkUrl, albumDetail?.tracks, isPreparing, isQobuzSource, play, setPendingTrackPreview, showNotification]);

    const handleDownloadAll = useCallback(async () => {
        const tracks = albumDetail?.tracks ?? [];
        if (tracks.length === 0 || isDownloadingAll) return;

        const pending = tracks.filter(track => {
            const state = downloads.get(track.id);
            return !isDownloaded(track.id) && state?.status !== 'done' && state?.status !== 'downloading';
        });

        if (pending.length === 0) {
            showNotification('El álbum ya está descargado', 'info');
            return;
        }

        setIsDownloadingAll(true);
        showNotification(`Descargando ${pending.length} canciones…`, 'info');
        try {
            for (const track of pending) {
                await handleTrackDownload(track);
            }
        } finally {
            setIsDownloadingAll(false);
        }
    }, [albumDetail?.tracks, downloads, handleTrackDownload, isDownloaded, isDownloadingAll, showNotification]);

    const openArtist = useCallback(() => {
        const artistId = albumDetail?.album.artistId;
        if (!artistId) return;
        router.push({
            pathname: '/tidal-artist/[id]',
            params: {
                id: String(artistId),
                name: albumDetail?.album.artistName,
                source: isSoulseekSource ? 'soulseek' : isQobuzSource ? 'qobuz' : 'tidal',
            },
        });
    }, [albumDetail?.album.artistId, albumDetail?.album.artistName, isQobuzSource, isSoulseekSource]);

    const openAlbum = useCallback((albumId: number) => {
        router.push({
            pathname: '/tidal-album/[id]',
            params: {
                id: String(albumId),
                source: isSoulseekSource ? 'soulseek' : isQobuzSource ? 'qobuz' : 'tidal',
            },
        });
    }, [isQobuzSource, isSoulseekSource]);

    const albumMeta = useMemo(() => {
        const tracks = albumDetail?.tracks ?? [];
        const totalMs = tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0);
        return {
            qualityLabel: deriveQualityLabel(tracks),
            durationLabel: totalMs > 0 ? formatTotalDuration(totalMs) : null,
            explicit: albumDetail?.album.explicit || tracks.some(track => track.explicit),
        };
    }, [albumDetail?.album.explicit, albumDetail?.tracks]);

    const similarRailItems = useMemo<MediaRailItem[]>(() => (
        similarAlbums.map(similar => ({
            key: String(similar.id),
            imageUri: similar.artworkUrl,
            title: similar.title,
            subtitle: similar.artistName,
            fallbackIcon: 'disc' as const,
            onPress: () => openAlbum(similar.id),
        }))
    ), [similarAlbums, openAlbum]);

    if (hasNativeTidalDetails) return <NativeTidalDetail
        kind="album" id={id} source={source} loading={isLoading} error={error}
        title={albumDetail?.album.title || 'Álbum'} kicker={`ÁLBUM${albumDetail?.album.year ? ` · ${albumDetail.album.year}` : ''}`}
        artwork={albumDetail?.album.artworkUrl} subtitle={albumDetail?.album.artistName}
        meta={`${albumDetail?.tracks.length ?? 0} canciones${albumMeta.durationLabel ? ` · ${albumMeta.durationLabel}` : ''}`}
        quality={albumMeta.qualityLabel} explicit={albumMeta.explicit}
        artistLink={albumDetail?.album.artistId ? { kind: 'artist', id: String(albumDetail.album.artistId), title: albumDetail.album.artistName } : undefined}
        tracks={albumDetail?.tracks} downloads={downloads} isDownloaded={isDownloaded}
        activeId={isPlayerPlaying || pendingTrackPreview ? activeTidalTrackId : null} playing={isPlayerPlaying}
        preparing={isPreparing} downloadingAll={isDownloadingAll}
        onPlay={handleTidalPlay} onPlayAll={handlePlayAll} onDownload={handleTrackDownload}
        onCancelDownload={cancelDownload} onDownloadAll={handleDownloadAll}
        sections={[{ title: albumDetail?.album.artistName ? `Más de ${albumDetail.album.artistName}` : 'Más álbumes',
            kicker: 'Discografía', size: 150, items: similarAlbums.map(album => ({
            kind: 'album', id: String(album.id), title: album.title, artwork: album.artworkUrl,
            subtitle: [album.year, album.type === 'SINGLE' ? 'Sencillo' : album.type === 'EP' ? 'EP' : 'Álbum'].filter(Boolean).join(' · '),
        })) }]}
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
                    <View style={{ width: '100%' }}>
                        {[1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={`s-tra-${i}`} height={56} width="100%" borderRadius={14} style={{ marginBottom: 8 }} />
                        ))}
                    </View>
                </ScrollView>
            </SafeAreaView>
        );
    }

    if (error || !albumDetail) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <SafeAreaView style={[styles.centered, { backgroundColor: theme.colors.background }]}>
                    <EmptyState title="Álbum no disponible" description={error ?? 'No se pudo cargar'} />
                    <Button onPress={() => router.back()}>Volver</Button>
                </SafeAreaView>
            </>
        );
    }

    const coverUri = albumDetail.album.artworkUrl;
    const hasArtist = !!albumDetail.album.artistId;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle={theme.id.includes('dark') ? 'light-content' : 'dark-content'} />

            <TidalAtmosphere sourceUri={coverUri} mode="artwork" scrollY={scrollY} onColors={setAtmos} />

            <DetailTopBar title={albumDetail.album.title} scrollY={scrollY} onBack={() => router.back()} />

            <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={[styles.content, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Editorial cover-left hero */}
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
                        <Text style={[styles.kicker, { color: accentColor }]}>
                            ÁLBUM{albumDetail.album.year ? ` · ${albumDetail.album.year}` : ''}
                        </Text>
                        <Text numberOfLines={3} style={[styles.albumTitle, { color: theme.colors.onBackground }]}>
                            {albumDetail.album.title}
                        </Text>
                        <Pressable onPress={openArtist} disabled={!hasArtist} hitSlop={8} style={styles.artistChip}>
                            {hasArtist ? <Ionicons name="person" size={12} color={accentColor} /> : null}
                            <Text numberOfLines={1} style={[styles.albumArtist, { color: hasArtist ? accentColor : theme.colors.onSurfaceVariant }]}>
                                {albumDetail.album.artistName}
                            </Text>
                        </Pressable>
                        <Text style={[styles.albumMeta, { color: withAlpha(theme.colors.onSurfaceVariant, 'D0') }]}>
                            {albumDetail.tracks.length} canciones{albumMeta.durationLabel ? ` · ${albumMeta.durationLabel}` : ''}
                        </Text>
                        {(albumMeta.qualityLabel || albumMeta.explicit) ? (
                            <View style={styles.badgeRow}>
                                {albumMeta.qualityLabel ? (
                                    <View style={[styles.qualityBadge, { backgroundColor: withAlpha(accentColor, '26'), borderColor: withAlpha(accentColor, '55') }]}>
                                        <Text style={[styles.qualityBadgeLabel, { color: theme.colors.onBackground }]}>{albumMeta.qualityLabel}</Text>
                                    </View>
                                ) : null}
                                {albumMeta.explicit ? (
                                    <View style={[styles.explicitBadge, { borderColor: withAlpha(theme.colors.onSurfaceVariant, '55') }]}>
                                        <Text style={[styles.explicitBadgeLabel, { color: theme.colors.onSurfaceVariant }]}>E</Text>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
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
                    <GlassPanel style={styles.tracksPanel} radius={radius.xl} blurred={false}>
                        {albumDetail.tracks.map((track, index) => {
                            const state = downloads.get(track.id);
                            const downloaded = isDownloaded(track.id) || state?.status === 'done';
                            const isDownloading = state?.status === 'downloading';
                            const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

                            return (
                                <Animated.View key={track.id} entering={FadeInRight.delay(180 + Math.min(index, 8) * 35)}>
                                    <TidalTrackRow
                                        title={track.title || 'Unknown Title'}
                                        artist={track.artist || albumDetail.album.artistName || 'Unknown Artist'}
                                        durationMs={track.durationMs}
                                        index={index}
                                        showArtwork={false}
                                        showIndex
                                        tone="glass"
                                        accentColor={accentColor}
                                        isActive={isTrackActive}
                                        isPlaying={isPlayerPlaying}
                                        downloadStatus={isDownloading ? 'downloading' : downloaded ? 'done' : state?.status === 'error' ? 'error' : 'idle'}
                                        progress={state?.progress ?? 0}
                                        onPress={() => handleTidalPlay(track)}
                                        onDownloadPress={() => handleTrackDownload(track)}
                                    />
                                </Animated.View>
                            );
                        })}
                    </GlassPanel>
                </Animated.View>

                {similarRailItems.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(300)} style={styles.section}>
                        <SectionHeader kicker="Descubre" title="Más álbumes" accent={accentColor} />
                        <MediaRail items={similarRailItems} cardSize={150} />
                    </Animated.View>
                )}
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
    albumTitle: {
        ...typeScale.headline,
    },
    artistChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 2,
    },
    albumArtist: {
        ...typeScale.title,
        fontWeight: '700',
    },
    albumMeta: {
        ...typeScale.caption,
    },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
    },
    qualityBadge: {
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
    },
    qualityBadgeLabel: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    explicitBadge: {
        width: 20,
        height: 20,
        borderRadius: 5,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    explicitBadgeLabel: {
        fontSize: 11,
        fontWeight: '800',
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

export function TidalAlbumScreen() {
    const { id, name, source } = useLocalSearchParams<{ id: string; name?: string; source?: string }>();
    return <TidalAlbumController key={`${id}:${name ?? ''}:${source ?? ''}`} />;
}
export default TidalAlbumScreen;
