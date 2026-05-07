import { CustomIcon, DownloadAnimatedButton, EmptyState, Skeleton, TrackListItem } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { SoulseekCompressedFallbackError } from '@/src/services/soulseekDownloadService';
import { createTidalStreamTrack, getTidalArtistDetail, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalArtistDetail, TidalTrack } from '@/src/types';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeInRight, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const HEADER_HEIGHT = 400;
const DEFAULT_VISIBLE_TOP_TRACKS = 8;
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export default function TidalArtistScreen() {
    const { id, name, source } = useLocalSearchParams<{ id: string; name?: string; source?: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);
    const isSoulseekSource = source === 'soulseek';
    const isQobuzSource = source === 'qobuz';

    const [artistDetail, setArtistDetail] = useState<TidalArtistDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tracksExpanded, setTracksExpanded] = useState(false);

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

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const headerStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(scrollY.value, [-100, 0], [1.08, 1], 'clamp') },
        ],
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT * 0.55], [1, 0.78], 'clamp'),
    }));

    const heroBlurStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT * 0.42], [0.04, 1], 'clamp'),
    }));

    const heroScrimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT * 0.38], [0, 0.38], 'clamp'),
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

    const visibleTopTracks = useMemo(() => {
        const tracks = artistDetail?.topTracks ?? [];
        return tracksExpanded ? tracks : tracks.slice(0, DEFAULT_VISIBLE_TOP_TRACKS);
    }, [artistDetail?.topTracks, tracksExpanded]);

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.backButtonWrap, { top: insets.top + 8 }]}>
                    <Skeleton height={44} width={44} borderRadius={22} />
                </View>
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + 100 }}>
                    <Skeleton height={200} width="100%" />
                    <View style={{ padding: 20 }}>
                        <Skeleton height={40} width="60%" style={{ marginBottom: 20 }} />
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

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle={theme.id.includes('dark') ? 'light-content' : 'dark-content'} />

            {/* Full Width Edge-to-Edge Hero Image */}
            <View style={styles.absoluteTop}>
                <Animated.View style={[styles.heroImageContainer, headerStyle]}>
                    {artistDetail?.artist?.artworkUrl ? (
                        <Image source={{ uri: artistDetail.artist.artworkUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={400} />
                    ) : (
                        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
                            <CustomIcon name="Artista" size={80} color={theme.colors.primary} />
                        </View>
                    )}
                    <LinearGradient
                        colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.4)', theme.colors.background]}
                        style={StyleSheet.absoluteFillObject}
                        locations={[0, 0.4, 0.98]}
                    />
                    <AnimatedBlurView
                        intensity={95}
                        tint={theme.id.includes('dark') ? 'dark' : 'light'}
                        experimentalBlurMethod="dimezisBlurView"
                        style={[StyleSheet.absoluteFillObject, heroBlurStyle]}
                    />
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            {
                                backgroundColor: theme.id.includes('dark')
                                    ? 'rgba(8,10,14,0.82)'
                                    : 'rgba(248,250,252,0.54)',
                            },
                            heroScrimStyle,
                        ]}
                    />
                </Animated.View>
            </View>

            <View style={[styles.backButtonWrap, { top: insets.top + 8 }]}>
                <Pressable
                    hitSlop={20}
                    onPress={() => router.back()}
                    style={styles.backButton}
                >
                    <CustomIcon name="Previous" size={24} color="#FFFFFF" />
                </Pressable>
            </View>

            <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={[styles.content, { paddingTop: HEADER_HEIGHT - 110 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Clean, minimalist text hero */}
                <Animated.View entering={FadeIn.delay(150)} style={styles.artistInfo}>
                    <Text
                        style={[styles.artistName, { color: theme.colors.onBackground, fontFamily: theme.typography.fontFamily.bold }]}
                        numberOfLines={2}
                    >
                        {artistDetail?.artist?.name || 'Unknown'}
                    </Text>
                    <Text
                        variant="bodyLarge"
                        style={[styles.artistMeta, { color: theme.colors.onSurfaceVariant }]}
                    >
                        {artistDetail?.topTracks?.length || 0} canciones · {sortedAlbums.length} albums
                    </Text>
                </Animated.View>

                {artistDetail?.topTracks && artistDetail.topTracks.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(200)} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text
                                variant="titleMedium"
                                style={[styles.sectionTitle, { color: theme.colors.onBackground, fontFamily: theme.typography.fontFamily.bold }]}
                            >
                                Top Tracks
                            </Text>
                        </View>

                        <View style={styles.tracksWrap}>
                            {visibleTopTracks.map((track, index) => {
                                const state = downloads.get(track.id);
                                const downloaded = isDownloaded(track.id) || state?.status === 'done';
                                const isDownloading = state?.status === 'downloading';
                                const isTrackActive = activeTidalTrackId === track.id && (isPlayerPlaying || !!pendingTrackPreview);
                                const progress = state?.progress ?? 0;

                                // Adapt TidalTrack to Track for TrackListItem compatibility
                                const uiTrack = {
                                    id: `tidal_ui_${track.id}`,
                                    uri: '',
                                    title: track.title || 'Unknown Title',
                                    artist: track.artist || artistDetail?.artist?.name || 'Unknown Artist',
                                    album: track.album || 'Unknown Album',
                                    artwork: track.artworkUrl,
                                    duration: Math.floor((track.durationMs || 0) / 1000),
                                    format: 'flac',
                                    dateAdded: Date.now()
                                };

                                return (
                                    <Animated.View key={track.id} entering={FadeInRight.delay(250 + index * 40)}>
                                        <TrackListItem
                                            track={uiTrack}
                                            index={index}
                                            showArtwork={false}
                                            showIndex={true}
                                            visualStyle="library"
                                            isPlaying={isTrackActive}
                                            onPress={() => handleTidalPlay(track)}
                                            onOptionsPress={downloaded ? undefined : () => handleTrackDownload(track)}
                                            optionsIcon={downloaded ? 'Checkmark' : (isDownloading ? 'Pause' : 'Descargar')}
                                            optionsIconColor={downloaded ? theme.colors.primary : theme.colors.onSurfaceVariant}
                                            optionsBusy={isDownloading}
                                            optionsDisabled={downloaded}
                                            optionsAccessory={(
                                                <DownloadAnimatedButton
                                                    status={
                                                        isDownloading ? 'downloading' :
                                                        downloaded ? 'done' :
                                                        state?.status === 'error' ? 'error' : 'idle'
                                                    }
                                                    progress={progress}
                                                    size={20}
                                                    onPress={() => handleTrackDownload(track)}
                                                />
                                            )}
                                        />
                                    </Animated.View>
                                );
                            })}
                        </View>

                        {artistDetail.topTracks.length > DEFAULT_VISIBLE_TOP_TRACKS ? (
                            <Pressable onPress={() => setTracksExpanded(value => !value)} style={styles.expandButton}>
                                <Text style={[styles.expandButtonLabel, { color: theme.colors.primary }]}>
                                    {tracksExpanded ? 'Mostrar menos' : `Ver ${artistDetail.topTracks.length - DEFAULT_VISIBLE_TOP_TRACKS} mas`}
                                </Text>
                            </Pressable>
                        ) : null}
                    </Animated.View>
                )}

                {sortedAlbums.length > 0 && (
                    <Animated.View entering={FadeInDown.delay(350)} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text
                                variant="titleMedium"
                                style={[styles.sectionTitle, { color: theme.colors.onBackground, fontFamily: theme.typography.fontFamily.bold }]}
                            >
                                Albums
                            </Text>
                        </View>

                        <View style={styles.albumsList}>
                            {sortedAlbums.map((album, index) => (
                                <Animated.View
                                    key={album.id}
                                    entering={FadeInRight.delay(320 + index * 45)}
                                >
                                    <Pressable onPress={() => openAlbum(album.id)} style={styles.albumRow}>
                                        <View style={[styles.albumArtWrap, { backgroundColor: theme.colors.surfaceVariant }]}>
                                            {album.artworkUrl ? (
                                                <Image source={{ uri: album.artworkUrl }} style={styles.albumArt} contentFit="cover" transition={200} />
                                            ) : (
                                                <CustomIcon name="Album" size={28} color={theme.colors.onSurfaceVariant} />
                                            )}
                                        </View>
                                        <View style={styles.albumCopy}>
                                            <Text numberOfLines={1} style={[styles.albumTitle, { color: theme.colors.onBackground }]}>
                                                {album.title}
                                            </Text>
                                            <Text numberOfLines={1} style={[styles.albumMetaLine, { color: theme.colors.onSurfaceVariant }]}>
                                                {album.year ?? 'Sin fecha'} · {album.numberOfTracks ?? 0} tracks
                                            </Text>
                                        </View>
                                        <CustomIcon name="Next" size={16} color={theme.colors.onSurfaceVariant} />
                                    </Pressable>
                                </Animated.View>
                            ))}
                        </View>
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
    absoluteTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: HEADER_HEIGHT,
        zIndex: 0,
    },
    heroImageContainer: {
        flex: 1,
    },
    backButtonWrap: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.3)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        paddingBottom: 120,
        zIndex: 1,
    },
    artistInfo: {
        paddingHorizontal: 20,
        marginBottom: 32,
    },
    artistName: {
        fontSize: 42,
        lineHeight: 46,
        letterSpacing: -1.5,
    },
    artistMeta: {
        marginTop: 6,
        fontWeight: '500',
    },
    section: {
        marginBottom: 36,
    },
    sectionHeader: {
        paddingHorizontal: 20,
        marginBottom: 10,
    },
    sectionTitle: {
        letterSpacing: -0.3,
    },
    tracksWrap: {
        paddingHorizontal: 8,
    },
    expandButton: {
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    expandButtonLabel: {
        fontWeight: '700',
        letterSpacing: -0.1,
    },
    albumsList: {
        paddingHorizontal: 20,
        gap: 14,
    },
    albumRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 4,
    },
    albumArtWrap: {
        width: 72,
        height: 72,
        borderRadius: 18,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    albumArt: {
        width: '100%',
        height: '100%',
    },
    albumCopy: {
        flex: 1,
        justifyContent: 'center',
        gap: 4,
    },
    albumTitle: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '700',
        letterSpacing: -0.35,
    },
    albumMetaLine: {
        fontSize: 13,
        lineHeight: 18,
    },
});
