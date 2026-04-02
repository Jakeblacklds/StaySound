import { EmptyState, Skeleton } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { createTidalStreamTrack, getTidalPlaylistDetail, isValidAudioFile } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalPlaylistDetail, TidalTrack } from '@/src/types/audio';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatTrackDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TidalPlaylistScreen() {

    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [playlistDetail, setPlaylistDetail] = useState<TidalPlaylistDetail | null>(null);
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
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir esta pista';
            Alert.alert('Error de reproduccion', message);
        }
    }, [download, forgetDownloadedTrack, getDownloadedTrack, play]);

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

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
                <Stack.Screen options={{ headerShown: false }} />
                <LinearGradient
                    colors={[theme.colors.secondaryContainer, theme.colors.background, theme.colors.background]}
                    style={StyleSheet.absoluteFill}
                />
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.heroWrap}>
                        <View style={[styles.hero, { backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden' }]}>
                            <Skeleton height={300} width="100%" borderRadius={24} />
                            <View style={styles.heroContent}>
                                <Skeleton height={32} width="80%" borderRadius={8} style={{ marginBottom: 12 }} />
                                <Skeleton height={18} width="40%" borderRadius={4} style={{ marginBottom: 16 }} />
                                <View style={styles.statsRow}>
                                    <Skeleton height={32} width={100} borderRadius={16} />
                                    <Skeleton height={32} width={100} borderRadius={16} />
                                </View>
                            </View>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Skeleton height={24} width={100} borderRadius={4} style={{ marginBottom: 16 }} />
                        {[1, 2, 3, 4, 5].map((i) => (
                            <View key={`s-tra-${i}`} style={[styles.trackRow, { backgroundColor: theme.colors.surface, opacity: 0.6 }]}>
                                <View style={styles.trackContent}>
                                    <Skeleton height={18} width="70%" borderRadius={4} style={{ marginBottom: 8 }} />
                                    <Skeleton height={14} width="30%" borderRadius={4} />
                                </View>
                                <Skeleton height={36} width={36} borderRadius={18} />
                                <Skeleton height={36} width={80} borderRadius={18} />
                            </View>
                        ))}
                    </View>
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
                    <Button onPress={() => router.back()}>Back</Button>
                </SafeAreaView>
            </>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle="light-content" />

            <LinearGradient
                colors={[theme.colors.secondaryContainer, theme.colors.background, theme.colors.background]}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.backButton, { top: insets.top + 8 }]}>
                <BlurView intensity={60} tint="dark" style={styles.backButtonBlur}>
                    <IconButton icon="arrow-left" iconColor="#FFFFFF" onPress={() => router.back()} />
                </BlurView>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Animated.View entering={FadeIn.duration(500)} style={styles.heroWrap}>
                    <View style={[styles.hero, { backgroundColor: theme.colors.surfaceVariant }]}>
                        <Image source={playlistDetail.playlist.artworkUrl ? { uri: playlistDetail.playlist.artworkUrl } : undefined} style={styles.cover} contentFit="cover" />
                        <LinearGradient
                            colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.72)']}
                            style={styles.heroOverlay}
                        />
                        <View style={styles.heroContent}>
                            <Text variant="headlineSmall" numberOfLines={2} style={styles.heroTitle}>
                                {playlistDetail.playlist.title}
                            </Text>
                            <Text numberOfLines={2} style={styles.heroSubtitle}>
                                {playlistDetail.playlist.description || 'Playlist de Tidal'}
                            </Text>
                            <View style={styles.statsRow}>
                                <View style={styles.statChip}>
                                    <Text style={styles.statChipLabel}>{playlistDetail.tracks.length} tracks</Text>
                                </View>
                            </View>
                        </View>
                    </View>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Tracks</Text>
                    {playlistDetail.tracks.map(track => {
                        const state = downloads.get(track.id);
                        const downloaded = isDownloaded(track.id) || state?.status === 'done';
                        const isDownloadingItem = state?.status === 'downloading';
                        const isError = state?.status === 'error';
                        const progressLabel = `${Math.round((state?.progress ?? 0) * 100)}%`;
                        const buttonLabel = downloaded ? 'Saved' : isDownloadingItem ? progressLabel : isError ? 'Retry' : 'Save';

                        return (
                            <View key={track.id} style={[styles.trackRow, { backgroundColor: theme.colors.surface }]}>
                                <Pressable style={styles.trackContent} onPress={() => handleTidalPlay(track)}>
                                    <Text numberOfLines={1} style={[styles.trackTitle, { color: theme.colors.onSurface }]}>{track.title}</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{track.artist} • {formatTrackDuration(track.durationMs)}</Text>
                                </Pressable>
                                <IconButton icon="play" mode="contained" size={18} onPress={() => handleTidalPlay(track)} />
                                <Button
                                    compact
                                    mode={downloaded ? 'contained' : 'contained-tonal'}
                                    onPress={() => handleTidalDownload(track)}
                                    style={{ minWidth: 80 }}
                                >
                                    {buttonLabel}
                                </Button>
                            </View>
                        );
                    })}
                </Animated.View>
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
    backButton: {
        position: 'absolute',
        left: 12,
        zIndex: 20,
    },
    backButtonBlur: {
        borderRadius: 22,
        overflow: 'hidden',
    },
    content: {
        paddingTop: 64,
        paddingBottom: 120,
    },
    heroWrap: {
        paddingHorizontal: 16,
    },
    hero: {
        height: 300,
        borderRadius: 24,
        overflow: 'hidden',
    },
    heroOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    cover: {
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
    },
    heroSubtitle: {
        color: 'rgba(255,255,255,0.85)',
        marginTop: 6,
        marginBottom: 10,
        fontSize: 13,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 8,
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
    trackContent: {
        flex: 1,
    },
    trackTitle: {
        fontWeight: '700',
    },
});

export default TidalPlaylistScreen;

