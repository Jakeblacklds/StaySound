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
import { createTidalStreamTrack, getTidalArtistDetail, getTidalSimilarArtists, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';
import { TidalArtist, TidalArtistDetail, TidalTrack, Track } from '@/src/types';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HERO_HEIGHT = Math.round(SCREEN_HEIGHT * 0.5);
const DEFAULT_VISIBLE_TOP_TRACKS = 8;

// Resolve a list of Tidal tracks into playable stream tracks (batched so we
// start playback fast without hammering the mirror). Failed tracks are dropped.
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

function TidalArtistController() {
    const { id, name, source } = useLocalSearchParams<{ id: string; name?: string; source?: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);
    const isSoulseekSource = source === 'soulseek';
    const isQobuzSource = source === 'qobuz';

    const [artistDetail, setArtistDetail] = useState<TidalArtistDetail | null>(null);
    const [similarArtists, setSimilarArtists] = useState<TidalArtist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tracksExpanded, setTracksExpanded] = useState(false);
    const [isPreparing, setIsPreparing] = useState<null | 'play' | 'shuffle'>(null);
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
            setError('Artist ID invalido');
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        getTidalArtistDetail(numericId, name)
            .then(detail => {
                if (cancelled) return;
                setArtistDetail(detail);
            })
            .catch((artistError: unknown) => {
                if (cancelled) return;
                const message = artistError instanceof Error ? artistError.message : 'No se pudo cargar el artista';
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
    }, [id, name]);

    useEffect(() => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return;

        let cancelled = false;
        setSimilarArtists([]);
        getTidalSimilarArtists(numericId)
            .then(list => {
                if (!cancelled) setSimilarArtists(list.slice(0, 12));
            })
            .catch(() => { /* similar artists are optional enrichment */ });

        return () => {
            cancelled = true;
        };
    }, [id]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const heroStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(scrollY.value, [-120, 0], [1.12, 1], 'clamp') },
            { translateY: interpolate(scrollY.value, [0, HERO_HEIGHT], [0, -HERO_HEIGHT * 0.3], 'clamp') },
        ],
        opacity: interpolate(scrollY.value, [0, HERO_HEIGHT * 0.7], [1, 0], 'clamp'),
    }));

    const handleTrackDownload = useCallback(async (track: TidalTrack) => {
        try {
            const state = downloads.get(track.id);
            if (isDownloaded(track.id) || state?.status === 'done') {
                return;
            }
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
    }, [cancelDownload, download, downloadFromSoulseek, downloads, isDownloaded, isSoulseekSource]);

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
            Alert.alert('Error', message);
        }
    }, [download, forgetDownloadedTrack, getDownloadedTrack, handleTrackDownload, isQobuzSource, isSoulseekSource, play, setPendingTrackPreview]);

    const openAlbum = useCallback((albumId: number) => {
        router.push({
            pathname: '/tidal-album/[id]',
            params: {
                id: String(albumId),
                source: isSoulseekSource ? 'soulseek' : isQobuzSource ? 'qobuz' : 'tidal',
            },
        });
    }, [isQobuzSource, isSoulseekSource]);

    const sortedAlbums = useMemo(() => {
        if (!artistDetail || !artistDetail.albums) return [];
        return [...artistDetail.albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    }, [artistDetail]);
    // Sencillos y EP llegan aparte desde la API de catálogo; los mirrors no los separan.
    const sortedSingles = useMemo(() => (
        [...(artistDetail?.singles ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    ), [artistDetail]);

    const visibleTopTracks = useMemo(() => {
        const tracks = artistDetail?.topTracks ?? [];
        return tracksExpanded ? tracks : tracks.slice(0, DEFAULT_VISIBLE_TOP_TRACKS);
    }, [artistDetail?.topTracks, tracksExpanded]);

    const qualityLabel = useMemo(() => deriveQualityLabel(artistDetail?.topTracks ?? []), [artistDetail?.topTracks]);

    const discographyItems = useMemo<MediaRailItem[]>(() => (
        [...sortedAlbums, ...sortedSingles].map(album => ({
            key: String(album.id),
            imageUri: album.artworkUrl,
            title: album.title,
            subtitle: `${album.year ?? 'Sin fecha'} · ${album.numberOfTracks ?? 0} pistas`,
            fallbackIcon: 'disc' as const,
            onPress: () => openAlbum(album.id),
        }))
    ), [sortedAlbums, sortedSingles, openAlbum]);

    const openArtist = useCallback((artist: TidalArtist) => {
        router.push({
            pathname: '/tidal-artist/[id]',
            params: {
                id: String(artist.id),
                name: artist.name,
                source: isSoulseekSource ? 'soulseek' : isQobuzSource ? 'qobuz' : 'tidal',
            },
        });
    }, [isQobuzSource, isSoulseekSource]);

    const similarItems = useMemo<MediaRailItem[]>(() => (
        similarArtists.map(similar => ({
            key: String(similar.id),
            imageUri: similar.artworkUrl,
            title: similar.name,
            fallbackIcon: 'person' as const,
            onPress: () => openArtist(similar),
        }))
    ), [similarArtists, openArtist]);

    const handlePlayAll = useCallback(async (shuffle: boolean) => {
        const tracks = artistDetail?.topTracks ?? [];
        if (tracks.length === 0 || isPreparing) return;

        setIsPreparing(shuffle ? 'shuffle' : 'play');
        const ordered = shuffle ? fisherYates(tracks, createRng()) : tracks;
        const first = ordered[0];
        setPendingTrackPreview({
            id: `tidal_pending_${first.id}`,
            title: first.title,
            artist: first.artist,
            artwork: first.artworkUrl,
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
    }, [artistDetail?.topTracks, isPreparing, isQobuzSource, play, setPendingTrackPreview, showNotification]);

    if (hasNativeTidalDetails) return <NativeTidalDetail
        kind="artist" id={id} source={source} loading={isLoading} error={error}
        title={artistDetail?.artist.name || name || 'Artista'} kicker="ARTISTA"
        artwork={artistDetail?.artist.artworkUrl} quality={qualityLabel}
        meta={[
            sortedAlbums.length ? `${sortedAlbums.length} ${sortedAlbums.length === 1 ? 'álbum' : 'álbumes'}` : '',
            sortedSingles.length ? `${sortedSingles.length} ${sortedSingles.length === 1 ? 'sencillo o EP' : 'sencillos y EP'}` : '',
        ].filter(Boolean).join(' · ') || `${artistDetail?.topTracks.length ?? 0} canciones`}
        tracks={artistDetail?.topTracks} downloads={downloads} isDownloaded={isDownloaded}
        activeId={isPlayerPlaying || pendingTrackPreview ? activeTidalTrackId : null} playing={isPlayerPlaying}
        preparing={isPreparing} onPlay={handleTidalPlay} onPlayAll={handlePlayAll}
        onDownload={handleTrackDownload} onCancelDownload={cancelDownload}
        sections={[
            { title: 'Álbumes', kicker: 'Discografía', size: 158, items: sortedAlbums.map(album => ({
                kind: 'album', id: String(album.id), title: album.title, artwork: album.artworkUrl,
                subtitle: `${album.year ?? 'Sin fecha'} · ${album.numberOfTracks ?? 0} pistas`,
            })) },
            { title: 'Sencillos y EP', kicker: 'Lanzamientos', size: 140, items: sortedSingles.map(album => ({
                kind: 'album', id: String(album.id), title: album.title, artwork: album.artworkUrl,
                subtitle: `${album.year ?? 'Sin fecha'} · ${album.type === 'EP' ? 'EP' : 'Sencillo'}`,
            })) },
            { title: 'Fans también escuchan', kicker: 'También te puede gustar', size: 108, circle: true,
                items: similarArtists.map(artist => ({ kind: 'artist', id: String(artist.id), title: artist.name, artwork: artist.artworkUrl })) },
        ]}
    />;

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
                <Stack.Screen options={{ headerShown: false }} />
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + 100 }}>
                    <Skeleton height={260} width="100%" />
                    <View style={{ padding: 20 }}>
                        <Skeleton height={40} width="60%" style={{ marginBottom: 20 }} />
                        <Skeleton height={54} width="100%" borderRadius={radius.lg} style={{ marginBottom: 20 }} />
                        <Skeleton height={60} width="100%" style={{ marginBottom: 10 }} />
                        <Skeleton height={60} width="100%" style={{ marginBottom: 10 }} />
                    </View>
                </ScrollView>
            </SafeAreaView>
        );
    }

    if (error || !artistDetail) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <SafeAreaView style={[styles.centered, { backgroundColor: theme.colors.background }]}>
                    <EmptyState title="Artista no disponible" description={error ?? 'No se pudo cargar'} />
                    <Button onPress={() => router.back()}>Volver / Back</Button>
                </SafeAreaView>
            </>
        );
    }

    const artistName = artistDetail?.artist?.name || 'Unknown';

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle="light-content" />

            <TidalAtmosphere sourceUri={artistDetail?.artist?.artworkUrl} mode="fog" scrollY={scrollY} onColors={setAtmos} />

            {/* Sharp portrait hero pinned to the top, fades into the fog on scroll */}
            <Animated.View style={[styles.hero, heroStyle]} pointerEvents="none">
                {artistDetail?.artist?.artworkUrl ? (
                    <Image source={{ uri: artistDetail.artist.artworkUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={400} />
                ) : (
                    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="person" size={96} color={accentColor} />
                    </View>
                )}
                <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.15)', withAlpha(theme.colors.background, 'E6'), theme.colors.background]}
                    style={StyleSheet.absoluteFillObject}
                    locations={[0, 0.45, 0.86, 1]}
                />
            </Animated.View>

            <DetailTopBar title={artistName} scrollY={scrollY} threshold={HERO_HEIGHT * 0.5} onBack={() => router.back()} />

            <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ height: HERO_HEIGHT - 150 }} pointerEvents="none" />

                {/* Name + actions overlaid on the lower hero / fog seam */}
                <Animated.View entering={FadeIn.delay(120)} style={styles.heroCopy}>
                    <Text style={[styles.kicker, { color: accentColor }]}>ARTISTA</Text>
                    <Text style={[styles.artistName, { color: '#FFFFFF' }]} numberOfLines={2}>
                        {artistName}
                    </Text>
                    <View style={styles.metaRow}>
                        {qualityLabel ? (
                            <View style={[styles.qualityBadge, { backgroundColor: withAlpha(accentColor, '33'), borderColor: withAlpha(accentColor, '66') }]}>
                                <Text style={[styles.qualityBadgeLabel, { color: '#FFFFFF' }]}>{qualityLabel}</Text>
                            </View>
                        ) : null}
                        <Text style={[styles.artistMeta, { color: 'rgba(255,255,255,0.82)' }]}>
                            {artistDetail?.topTracks?.length || 0} canciones · {sortedAlbums.length} álbumes
                        </Text>
                    </View>
                </Animated.View>

                <Animated.View entering={FadeIn.delay(180)} style={styles.actionWrap}>
                    <DetailActionBar
                        accent={atmos?.animated.primary}
                        accentColor={accentColor}
                        onPrimaryColor={atmos?.colors.onPrimary ?? theme.colors.onPrimary}
                        preparing={isPreparing}
                        onPlay={() => handlePlayAll(false)}
                        onShuffle={() => handlePlayAll(true)}
                        onDownloadAll={() => handlePlayAll(true)}
                    />
                </Animated.View>

                {artistDetail?.topTracks && artistDetail.topTracks.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(200)} style={styles.section}>
                        <SectionHeader kicker="Lo más sonado" title="Popular" accent={accentColor} />
                        <GlassPanel style={styles.tracksPanel} radius={radius.xl} blurred={false}>
                            {visibleTopTracks.map((track, index) => {
                                const state = downloads.get(track.id);
                                const downloaded = isDownloaded(track.id) || state?.status === 'done';
                                const isDownloading = state?.status === 'downloading';
                                const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);

                                return (
                                    <Animated.View key={track.id} entering={FadeInRight.delay(250 + Math.min(index, 6) * 40)}>
                                        <TidalTrackRow
                                            title={track.title || 'Unknown Title'}
                                            artist={track.artist || artistName || 'Unknown Artist'}
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
                                            onDownloadPress={() => handleTrackDownload(track)}
                                        />
                                    </Animated.View>
                                );
                            })}
                            {artistDetail.topTracks.length > DEFAULT_VISIBLE_TOP_TRACKS ? (
                                <Pressable onPress={() => setTracksExpanded(value => !value)} style={styles.expandButton}>
                                    <Text style={[styles.expandButtonLabel, { color: accentColor }]}>
                                        {tracksExpanded ? 'Mostrar menos' : `Ver ${artistDetail.topTracks.length - DEFAULT_VISIBLE_TOP_TRACKS} más`}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </GlassPanel>
                    </Animated.View>
                )}

                {discographyItems.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(350)} style={styles.section}>
                        <SectionHeader kicker="Discografía" title="Álbumes" accent={accentColor} />
                        <MediaRail items={discographyItems} cardSize={158} />
                    </Animated.View>
                )}

                {similarItems.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(420)} style={styles.section}>
                        <SectionHeader kicker="También te puede gustar" title="Artistas similares" accent={accentColor} />
                        <MediaRail items={similarItems} cardSize={108} variant="circle" />
                    </Animated.View>
                )}

            </Animated.ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
    },
    hero: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: HERO_HEIGHT,
        zIndex: 0,
    },
    content: {
        paddingBottom: 140,
        zIndex: 1,
    },
    heroCopy: {
        paddingHorizontal: 20,
        marginBottom: 20,
        gap: 6,
    },
    kicker: {
        ...typeScale.micro,
        letterSpacing: 1.6,
    },
    artistName: {
        ...typeScale.hero,
    },
    artistMeta: {
        ...typeScale.bodyStrong,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 4,
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
    expandButton: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
    },
    expandButtonLabel: {
        ...typeScale.label,
        fontWeight: '700',
    },
});

export function TidalArtistScreen() {
    const { id, name, source } = useLocalSearchParams<{ id: string; name?: string; source?: string }>();
    return <TidalArtistController key={`${id}:${name ?? ''}:${source ?? ''}`} />;
}
export default TidalArtistScreen;
