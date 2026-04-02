import { CustomIcon, EmptyState, Skeleton } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { createTidalStreamTrack, getTidalArtistDetail, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalAlbum, TidalArtistDetail, TidalTrack } from '@/src/types';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatTrackDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function TidalArtistScreen() {
    const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [artistDetail, setArtistDetail] = useState<TidalArtistDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    const openAlbum = useCallback((album: TidalAlbum) => {
        router.push({ pathname: '/tidal-album/[id]', params: { id: String(album.id) } });
    }, []);

    const sortedAlbums = useMemo(() => {
        if (!artistDetail) return [];
        return [...artistDetail.albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    }, [artistDetail]);

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
                <Stack.Screen options={{ headerShown: false }} />
                <LinearGradient
                    colors={[theme.colors.primaryContainer, theme.colors.background, theme.colors.background]}
                    style={StyleSheet.absoluteFill}
                />
                <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}>
                    <View style={styles.topBar}>
                        <Skeleton height={44} width={120} borderRadius={999} />
                    </View>

                    <View style={styles.heroWrap}>
                        <View style={[styles.hero, { backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden' }]}>
                            <Skeleton height={270} width="100%" borderRadius={24} />
                            <View style={styles.heroContent}>
                                <Skeleton height={32} width="60%" borderRadius={8} style={{ marginBottom: 12 }} />
                                <View style={styles.statsRow}>
                                    <Skeleton height={32} width={150} borderRadius={16} />
                                    <Skeleton height={32} width={150} borderRadius={16} />
                                </View>
                            </View>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Skeleton height={24} width={180} borderRadius={4} style={{ marginBottom: 16 }} />
                        {[1, 2, 3, 4].map((i) => (
                            <View key={`s-tra-${i}`} style={[styles.trackRow, { backgroundColor: theme.colors.surface, opacity: 0.6 }]}>
                                <View style={styles.trackContent}>
                                    <Skeleton height={18} width="70%" borderRadius={4} style={{ marginBottom: 8 }} />
                                    <Skeleton height={14} width="50%" borderRadius={4} style={{ marginBottom: 8 }} />
                                    <Skeleton height={12} width="30%" borderRadius={4} />
                                </View>
                                <Skeleton height={36} width={94} borderRadius={18} />
                            </View>
                        ))}
                    </View>

                    <View style={styles.section}>
                        <Skeleton height={24} width={170} borderRadius={4} style={{ marginBottom: 16 }} />
                        {[1, 2].map((i) => (
                            <View key={`s-alb-${i}`} style={[styles.albumRow, { backgroundColor: theme.colors.surface, opacity: 0.6 }]}>
                                <Skeleton height={56} width={56} borderRadius={8} />
                                <View style={styles.albumContent}>
                                    <Skeleton height={18} width="60%" borderRadius={4} style={{ marginBottom: 8 }} />
                                    <Skeleton height={14} width="30%" borderRadius={4} />
                                </View>
                                <Skeleton height={20} width={80} borderRadius={10} />
                            </View>
                        ))}
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
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle="light-content" />

            <LinearGradient
                colors={[theme.colors.primaryContainer, theme.colors.background, theme.colors.background]}
                style={StyleSheet.absoluteFill}
            />

            <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}>
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()}>
                        <BlurView intensity={45} tint="light" style={styles.backChip}>
                            <Text style={[styles.backChipLabel, { color: theme.colors.onSurface }]}>Volver / Back</Text>
                        </BlurView>
                    </Pressable>
                </View>

                <Animated.View entering={FadeIn.duration(500)} style={styles.heroWrap}>
                    <View style={[styles.hero, { backgroundColor: theme.colors.surfaceVariant }]}>
                        <Image source={artistDetail.artist.artworkUrl ? { uri: artistDetail.artist.artworkUrl } : undefined} style={styles.artistImage} contentFit="cover" />
                        <LinearGradient
                            colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.65)']}
                            style={styles.heroOverlay}
                        />
                        <View style={styles.heroContent}>
                            <Text variant="headlineSmall" style={styles.heroTitle}>
                                {artistDetail.artist.name}
                            </Text>
                            <View style={styles.statsRow}>
                                <View style={styles.statChip}>
                                    <Text style={styles.statChipLabel}>{artistDetail.topTracks.length} Top Tracks / Canciones</Text>
                                </View>
                                <View style={styles.statChip}>
                                    <Text style={styles.statChipLabel}>{sortedAlbums.length} Albums / Álbumes</Text>
                                </View>
                            </View>
                        </View>
                    </View>
                </Animated.View>

                {artistDetail.topTracks.length > 0 ? (
                    <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Top Tracks / Canciones</Text>
                        {artistDetail.topTracks.map(track => {
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
                                            backgroundColor: isTrackActive ? 'rgba(255,255,255,0.16)' : theme.colors.surface,
                                            borderColor: isTrackActive ? theme.colors.primary : 'rgba(255,255,255,0.08)',
                                        },
                                    ]}
                                >
                                    {isTrackActive ? (
                                        <Animated.View
                                            entering={FadeIn.duration(180)}
                                            exiting={FadeOut.duration(180)}
                                            pointerEvents="none"
                                            style={[StyleSheet.absoluteFillObject, styles.trackRowActiveOverlay, { backgroundColor: 'rgba(255,255,255,0.05)' }]}
                                        />
                                    ) : null}
                                    <View style={styles.trackContent}>
                                        <Text numberOfLines={1} style={[styles.trackTitle, { color: theme.colors.onSurface }]}>{track.title}</Text>
                                        <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>{track.album}</Text>
                                        <Text style={{ color: theme.colors.onSurfaceVariant }}>{formatTrackDuration(track.durationMs)}</Text>
                                    </View>
                                    <Button
                                        compact
                                        mode={downloaded ? 'contained' : 'contained-tonal'}
                                        onPress={(event) => {
                                            event.stopPropagation();
                                            void handleTidalDownload(track);
                                        }}
                                        style={{ minWidth: 94 }}
                                        icon={downloaded ? undefined : () => <CustomIcon name="Descargar" size={14} color={theme.colors.primary} />}
                                    >
                                        {downloaded ? 'Guardado' : isDownloadingItem ? progressLabel : isError ? 'Reintentar' : 'Descargar'}
                                    </Button>
                                </Pressable>
                            );
                        })}
                    </Animated.View>
                ) : null}

                {sortedAlbums.length > 0 ? (
                    <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Albums / Álbumes</Text>
                        {sortedAlbums.map(album => (
                            <Pressable key={album.id} style={[styles.albumRow, { backgroundColor: theme.colors.surface }]} onPress={() => openAlbum(album)}>
                                <Image source={album.artworkUrl ? { uri: album.artworkUrl } : undefined} style={styles.albumImage} contentFit="cover" />
                                <View style={styles.albumContent}>
                                    <Text numberOfLines={1} style={[styles.trackTitle, { color: theme.colors.onSurface }]}>{album.title}</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{album.year ?? 'Año desconocido / Unknown year'}</Text>
                                </View>
                                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Abrir / Open</Text>
                            </Pressable>
                        ))}
                    </Animated.View>
                ) : null}
            </ScrollView>
        </SafeAreaView>
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
        paddingBottom: 120,
    },
    topBar: {
        paddingHorizontal: 16,
        marginBottom: 14,
    },
    backChip: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        overflow: 'hidden',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    backChipLabel: {
        fontWeight: '700',
    },
    heroWrap: {
        paddingHorizontal: 16,
    },
    hero: {
        height: 270,
        borderRadius: 24,
        overflow: 'hidden',
    },
    heroOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    artistImage: {
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(127,127,127,0.2)',
    },
    heroContent: {
        position: 'absolute',
        bottom: 18,
        left: 18,
        right: 18,
    },
    heroTitle: {
        color: '#FFFFFF',
        fontWeight: '800',
        marginBottom: 10,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    statChip: {
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    statChipLabel: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    section: {
        marginTop: 18,
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    sectionTitle: {
        marginBottom: 12,
        fontWeight: '800',
    },
    trackRow: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        padding: 10,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    trackRowActiveOverlay: {
        borderRadius: 16,
    },
    trackContent: {
        flex: 1,
    },
    trackTitle: {
        fontWeight: '700',
    },
    albumRow: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        padding: 10,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    albumImage: {
        width: 56,
        height: 56,
        borderRadius: 8,
        backgroundColor: 'rgba(127,127,127,0.2)',
    },
    albumContent: {
        flex: 1,
    },
});
