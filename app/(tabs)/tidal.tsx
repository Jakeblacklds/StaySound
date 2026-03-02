import { EmptyState, Skeleton } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { createTidalStreamTrack, extractAlbumsFromTracks, getTidalArtistDetail, isValidAudioFile, searchTidal, searchTidalArtists, TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalQuality, TidalTrack } from '@/src/types/audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Searchbar, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TidalTab = 'all' | 'artists' | 'albums' | 'tracks';

const TIDAL_TABS: ReadonlyArray<{ value: TidalTab; label: string }> = [
    { value: 'all', label: 'Todo' },
    { value: 'artists', label: 'Artistas' },
    { value: 'albums', label: 'Álbumes' },
    { value: 'tracks', label: 'Canciones' },
];

function formatTrackDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function withAlpha(color: string, alphaHex: string): string {
    if (!color) return color;
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 6) return `#${hex}${alphaHex}`;
        if (hex.length === 8) return `#${hex.slice(0, 6)}${alphaHex}`;
    }
    return color;
}

export default function TidalScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [activeTab, setActiveTab] = useState<TidalTab>('all');
    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [artists, setArtists] = useState<TidalArtist[]>([]);
    const [artistArtworkOverrides, setArtistArtworkOverrides] = useState<Map<number, string>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const {
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror
    } = useSettingsStore();

    const showNotification = useNotificationStore(s => s.showNotification);

    const handleMirrorChange = (mirror: string) => {
        setTidalMirror(mirror);
        setShowMirrorModal(false);

        if (mirror !== 'auto') {
            showNotification(`Fuente seleccionada: ${TIDAL_MIRROR_NAMES[mirror]}`, 'success');
        } else {
            showNotification('Modo automático activado', 'info');
        }
    };

    const artistArtworkAttempted = useRef<Set<number>>(new Set());

    const {
        downloads,
        download,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    } = useTidalDownload();

    const play = usePlayerStore(s => s.play);

    const palette = useMemo(() => ({
        heroBackground: withAlpha(theme.colors.primaryContainer, '99'),
        heroBorder: withAlpha(theme.colors.primary, '4D'),
        searchBackground: withAlpha(theme.colors.surface, 'F0'),
        chipBackground: withAlpha(theme.colors.surfaceVariant, 'E6'),
        chipSelectedBackground: theme.colors.primary,
        cardBackground: withAlpha(theme.colors.surface, 'F5'),
        cardBorder: withAlpha(theme.colors.outline, '42'),
        qualityBackground: theme.colors.primaryContainer,
        floatingGlow: withAlpha(theme.colors.primary, '1A'),
    }), [theme.colors]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedQuery(query);
        }, 320);

        return () => clearTimeout(timeout);
    }, [query]);

    useEffect(() => {
        const currentQuery = debouncedQuery.trim();
        if (!currentQuery) {
            setTracks([]);
            setArtists([]);
            setArtistArtworkOverrides(new Map());
            artistArtworkAttempted.current.clear();
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        Promise.all([
            searchTidal(currentQuery),
            searchTidalArtists(currentQuery),
        ])
            .then(([nextTracks, nextArtists]) => {
                if (cancelled) return;
                setTracks(nextTracks);
                setArtists(nextArtists);
                setArtistArtworkOverrides(new Map());
                artistArtworkAttempted.current.clear();
            })
            .catch((searchError: unknown) => {
                if (cancelled) return;
                setTracks([]);
                setArtists([]);
                const message = searchError instanceof Error ? searchError.message : 'No se pudo consultar Tidal';
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
    }, [debouncedQuery]);

    const albums = useMemo(() => extractAlbumsFromTracks(tracks), [tracks]);

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

            const currentMirror = useSettingsStore.getState().tidalMirror;
            if (currentMirror !== 'auto') {
                showNotification(`Bajando desde: ${TIDAL_MIRROR_NAMES[currentMirror] || 'Servidor Manual'}`, 'info');
            } else {
                showNotification(`Iniciando descarga de "${track.title}"`, 'info');
            }

            await download(track);
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [cancelDownload, download, downloads]);

    const openArtist = useCallback((artist: TidalArtist) => {
        router.push({
            pathname: '/tidal-artist/[id]',
            params: { id: String(artist.id), name: artist.name },
        });
    }, []);

    const openAlbum = useCallback((album: TidalAlbum) => {
        router.push({
            pathname: '/tidal-album/[id]',
            params: { id: String(album.id) },
        });
    }, []);

    const resolveArtistArtwork = useCallback(async (artist: TidalArtist) => {
        if (artistArtworkAttempted.current.has(artist.id)) return;
        artistArtworkAttempted.current.add(artist.id);

        try {
            const detail = await getTidalArtistDetail(artist.id, artist.name);
            const nextArtwork = detail.artist.artworkUrl;
            if (!nextArtwork) return;

            setArtistArtworkOverrides(prev => {
                const next = new Map(prev);
                next.set(artist.id, nextArtwork);
                return next;
            });
        } catch {
            // Keep placeholder if detail artwork fetch fails.
        }
    }, []);

    useEffect(() => {
        if (artists.length === 0) return;
        artists.forEach(artist => {
            void resolveArtistArtwork(artist);
        });
    }, [artists, resolveArtistArtwork]);

    const renderTrackRow = useCallback((track: TidalTrack) => {
        const state = downloads.get(track.id);
        const downloaded = isDownloaded(track.id) || state?.status === 'done';
        const isDownloadingItem = state?.status === 'downloading';
        const isError = state?.status === 'error';
        const progressLabel = `${Math.round((state?.progress ?? 0) * 100)}%`;
        const buttonLabel = downloaded ? 'Saved' : isDownloadingItem ? progressLabel : isError ? 'Retry' : 'Save';

        return (
            <View
                key={track.id}
                style={[
                    styles.trackRow,
                    { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder },
                ]}
            >
                <Image
                    source={track.artworkUrl ? { uri: track.artworkUrl } : undefined}
                    style={styles.artwork}
                    contentFit="cover"
                    transition={120}
                />
                <Pressable style={styles.trackContent} onPress={() => handleTidalPlay(track)}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: theme.colors.onSurface }]}>
                        {track.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                        {track.artist} - {track.album}
                    </Text>
                    <View style={styles.metaRow}>
                        <Text style={{ color: theme.colors.onSurfaceVariant }}>{formatTrackDuration(track.durationMs)}</Text>
                        <Text style={{ color: theme.colors.onSurfaceVariant }}>•</Text>
                        <View style={[styles.qualityPill, { backgroundColor: theme.colors.secondaryContainer }]}>
                            <Text style={{ color: theme.colors.onSecondaryContainer, fontWeight: '800', fontSize: 10 }}>
                                {track.isHiRes ? 'HI-RES' : 'LOSSLESS'}
                            </Text>
                        </View>
                    </View>
                </Pressable>
                <IconButton icon="play" mode="contained-tonal" size={18} onPress={() => handleTidalPlay(track)} style={styles.playButton} />
                <Button
                    compact
                    mode={downloaded ? 'contained' : 'outlined'}
                    onPress={() => handleTidalDownload(track)}
                    style={{ minWidth: 80 }}
                >
                    {downloaded ? 'Guardado' : isDownloadingItem ? progressLabel : isError ? 'Reintentar' : 'Descargar'}
                </Button>
            </View>
        );
    }, [downloads, handleTidalDownload, handleTidalPlay, isDownloaded, theme.colors]);

    const renderArtistRow = useCallback((artist: TidalArtist) => (
        <Pressable
            key={artist.id}
            style={[styles.entityRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder }]}
            onPress={() => openArtist(artist)}
        >
            <Image
                source={artistArtworkOverrides.get(artist.id) ? { uri: artistArtworkOverrides.get(artist.id) as string } : undefined}
                style={styles.artistArtwork}
                contentFit="cover"
                transition={120}
            />
            <View style={styles.entityContent}>
                <Text numberOfLines={1} style={[styles.entityTitle, { color: theme.colors.onSurface }]}>{artist.name}</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Artista</Text>
            </View>
            <IconButton icon="chevron-right" onPress={() => openArtist(artist)} />
        </Pressable>
    ), [artistArtworkOverrides, openArtist, palette.cardBackground, palette.cardBorder, resolveArtistArtwork, theme.colors]);

    const renderAlbumRow = useCallback((album: TidalAlbum) => (
        <Pressable
            key={album.id}
            style={[styles.entityRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder }]}
            onPress={() => openAlbum(album)}
        >
            <Image
                source={album.artworkUrl ? { uri: album.artworkUrl } : undefined}
                style={styles.artwork}
                contentFit="cover"
                transition={120}
            />
            <View style={styles.entityContent}>
                <Text numberOfLines={1} style={[styles.entityTitle, { color: theme.colors.onSurface }]}>{album.title}</Text>
                <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>{album.artistName}</Text>
            </View>
            <IconButton icon="chevron-right" onPress={() => openAlbum(album)} />
        </Pressable>
    ), [openAlbum, palette.cardBackground, palette.cardBorder, theme.colors]);

    const hasResults = tracks.length > 0 || artists.length > 0 || albums.length > 0;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
            <LinearGradient
                colors={[withAlpha(theme.colors.primaryContainer, '7D'), theme.colors.background, theme.colors.background]}
                style={StyleSheet.absoluteFill}
            />

            <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: styles.pageContent.paddingBottom + insets.bottom }]} showsVerticalScrollIndicator={false}>
                <View style={[styles.headerGlow, { backgroundColor: palette.floatingGlow }]} />
                <View style={[styles.header, { backgroundColor: palette.heroBackground, borderColor: palette.heroBorder }]}>
                    <View style={styles.headerTopRow}>
                        <View>
                            <Text style={[styles.badge, { color: theme.colors.primary }]}>NEXT SOUND</Text>
                            <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>Descargar Música</Text>
                        </View>
                        <View style={styles.headerTopActions}>
                            <Pressable
                                style={[styles.qualityToggleButton, { backgroundColor: theme.colors.primaryContainer }]}
                                onPress={() => setShowQualityModal(true)}
                            >
                                <IconButton icon="tune" size={16} iconColor={theme.colors.onPrimaryContainer} style={{ margin: 0 }} />
                                <Text variant="labelSmall" style={{ color: theme.colors.onPrimaryContainer, fontWeight: '800' }}>
                                    {tidalDownloadQuality === 'HI_RES_LOSSLESS' ? 'HI-RES' :
                                        tidalDownloadQuality === 'LOSSLESS' ? 'FLAC' :
                                            tidalDownloadQuality === 'HIGH' ? 'ALTA' : 'LOW'}
                                </Text>
                            </Pressable>
                            <Pressable
                                style={[styles.qualityToggleButton, { backgroundColor: theme.colors.secondaryContainer, marginLeft: 8 }]}
                                onPress={() => setShowMirrorModal(true)}
                            >
                                <IconButton icon="server" size={14} iconColor={theme.colors.onSecondaryContainer} style={{ margin: 0 }} />
                                <Text variant="labelSmall" style={{ color: theme.colors.onSecondaryContainer, fontWeight: '800' }}>
                                    {tidalMirror === 'auto' ? 'AUTO' : (TIDAL_MIRROR_NAMES[tidalMirror]?.split(' ')[1] || 'SERV').toUpperCase()}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                    <Searchbar
                        placeholder="Busca artistas, álbumes, canciones..."
                        value={query}
                        onChangeText={setQuery}
                        style={[styles.searchbar, { backgroundColor: palette.searchBackground }]}
                        iconColor={theme.colors.primary}
                        inputStyle={styles.searchInput}
                    />

                    {debouncedQuery.trim() ? (
                        <View style={styles.statRow}>
                            <View style={[styles.statPill, { backgroundColor: theme.colors.secondaryContainer }]}>
                                <Text style={{ color: theme.colors.onSecondaryContainer, fontWeight: '800' }}>{artists.length}</Text>
                                <Text style={{ color: theme.colors.onSecondaryContainer, opacity: 0.8, fontSize: 11 }}>Artistas</Text>
                            </View>
                            <View style={[styles.statPill, { backgroundColor: theme.colors.secondaryContainer }]}>
                                <Text style={{ color: theme.colors.onSecondaryContainer, fontWeight: '800' }}>{albums.length}</Text>
                                <Text style={{ color: theme.colors.onSecondaryContainer, opacity: 0.8, fontSize: 11 }}>Álbumes</Text>
                            </View>
                            <View style={[styles.statPill, { backgroundColor: theme.colors.secondaryContainer }]}>
                                <Text style={{ color: theme.colors.onSecondaryContainer, fontWeight: '800' }}>{tracks.length}</Text>
                                <Text style={{ color: theme.colors.onSecondaryContainer, opacity: 0.8, fontSize: 11 }}>Canciones</Text>
                            </View>
                        </View>
                    ) : null}
                </View>

                <View style={styles.tabsBar}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
                        {TIDAL_TABS.map(tab => {
                            const selected = activeTab === tab.value;
                            return (
                                <Pressable
                                    key={tab.value}
                                    style={[
                                        styles.tabButton,
                                        {
                                            backgroundColor: selected ? theme.colors.primary : palette.chipBackground,
                                            borderColor: selected ? theme.colors.primary : 'transparent',
                                        },
                                    ]}
                                    onPress={() => setActiveTab(tab.value)}
                                >
                                    <Text style={{ color: selected ? theme.colors.onPrimary : theme.colors.onSurfaceVariant, fontWeight: selected ? '800' : '500' }}>
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {isLoading ? (
                    <View style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {[1, 2, 3].map((i) => (
                                    <View key={`s-art-${i}`} style={[styles.entityRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder, opacity: 0.6 }]}>
                                        <Skeleton height={62} width={62} borderRadius={31} />
                                        <View style={styles.entityContent}>
                                            <Skeleton height={18} width="60%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <Skeleton height={14} width="30%" borderRadius={4} />
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}

                        {(activeTab === 'all' || activeTab === 'albums') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {[1, 2, 3].map((i) => (
                                    <View key={`s-alb-${i}`} style={[styles.entityRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder, opacity: 0.6 }]}>
                                        <Skeleton height={62} width={62} borderRadius={12} />
                                        <View style={styles.entityContent}>
                                            <Skeleton height={18} width="70%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <Skeleton height={14} width="40%" borderRadius={4} />
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}

                        {(activeTab === 'all' || activeTab === 'tracks') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <View key={`s-tra-${i}`} style={[styles.trackRow, { backgroundColor: palette.cardBackground, borderColor: palette.cardBorder, opacity: 0.6 }]}>
                                        <Skeleton height={62} width={62} borderRadius={12} />
                                        <View style={styles.trackContent}>
                                            <Skeleton height={16} width="80%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <Skeleton height={14} width="60%" borderRadius={4} style={{ marginBottom: 8 }} />
                                            <View style={styles.metaRow}>
                                                <Skeleton height={12} width={40} borderRadius={4} />
                                                <Skeleton height={18} width={60} borderRadius={10} />
                                            </View>
                                        </View>
                                        <Skeleton height={36} width={36} borderRadius={18} />
                                        <Skeleton height={32} width={80} borderRadius={20} />
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                ) : error ? (
                    <View style={styles.centered}>
                        <EmptyState icon="⚠️" title="TIDAL unavailable" description={error} />
                    </View>
                ) : !query.trim() ? (
                    <View style={styles.centered}>
                        <EmptyState
                            icon="⬢"
                            title="Explora el catálogo"
                            description="Busca por artista, álbum y canción. Puedes descargar tus favoritos para escucharlos sin conexión."
                        />
                    </View>
                ) : !tracks.length && !albums.length && !artists.length ? (
                    <View style={styles.centered}>
                        <EmptyState icon="🫧" title="No matches" description={`No encontramos resultados para "${query.trim()}"`} />
                    </View>
                ) : (
                    <Animated.View entering={FadeIn.duration(400)} style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && artists.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Artistas</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{artists.length}</Text>
                                </View>
                                {artists.slice(0, activeTab === 'all' ? 6 : artists.length).map(renderArtistRow)}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'albums') && albums.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Álbumes</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{albums.length}</Text>
                                </View>
                                {albums.slice(0, activeTab === 'all' ? 8 : albums.length).map(renderAlbumRow)}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'tracks') && tracks.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Canciones</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{tracks.length}</Text>
                                </View>
                                {tracks.slice(0, activeTab === 'all' ? 12 : tracks.length).map(renderTrackRow)}
                            </Animated.View>
                        ) : null}
                    </Animated.View>
                )}
            </ScrollView>

            {/* Mirror Selection Modal */}
            <Modal
                visible={showMirrorModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowMirrorModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                Servidor de Tidal
                            </Text>
                            <Pressable onPress={() => setShowMirrorModal(false)} hitSlop={12}>
                                <IconButton icon="close" iconColor={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                Elige un servidor específico o deja en automático para rotar si uno falla.
                            </Text>

                            <Pressable
                                onPress={() => handleMirrorChange('auto')}
                                style={[
                                    styles.qualityOption,
                                    {
                                        backgroundColor: tidalMirror === 'auto' ? `${theme.colors.primary}15` : 'transparent',
                                        borderColor: tidalMirror === 'auto' ? theme.colors.primary : `${theme.colors.outline}33`,
                                        borderWidth: 1,
                                        borderRadius: 20,
                                        padding: 16
                                    }
                                ]}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <IconButton icon="auto-fix" iconColor={tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurfaceVariant} style={{ margin: 0 }} />
                                    <View style={{ flex: 1 }}>
                                        <Text variant="titleMedium" style={{ color: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurface }}>
                                            Automático (Recomendado)
                                        </Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                            Prueba todos los servidores disponibles hasta encontrar uno que funcione.
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>

                            {TIDAL_API_BASES.map((mirror) => (
                                <Pressable
                                    key={mirror}
                                    onPress={() => handleMirrorChange(mirror)}
                                    style={[
                                        styles.qualityOption,
                                        {
                                            backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}15` : 'transparent',
                                            borderColor: tidalMirror === mirror ? theme.colors.primary : `${theme.colors.outline}33`,
                                            borderWidth: 1,
                                            borderRadius: 20,
                                            padding: 16
                                        }
                                    ]}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        <IconButton icon="server" iconColor={tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant} style={{ margin: 0 }} />
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={{ color: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurface }}>
                                                {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {mirror.replace('https://', '')}
                                            </Text>
                                        </View>
                                        {tidalMirror === mirror && (
                                            <IconButton icon="check" iconColor={theme.colors.primary} style={{ margin: 0 }} />
                                        )}
                                    </View>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Quality Selection Modal */}
            <Modal
                visible={showQualityModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowQualityModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                Calidad de Audio
                            </Text>
                            <Pressable onPress={() => setShowQualityModal(false)} hitSlop={12}>
                                <IconButton icon="close" iconColor={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                Selecciona el formato preferido para tus descargas de Tidal.
                            </Text>

                            {(['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'] as TidalQuality[]).map((q) => {
                                const details = {
                                    HI_RES_LOSSLESS: {
                                        title: 'Hi-Res Lossless (FLAC)',
                                        desc: 'Calidad de estudio (24-bit). El mejor sonido posible.',
                                        adv: '✓ Máximo detalle / ✗ Archivos gigantes (~100MB)',
                                        icon: 'crown'
                                    },
                                    LOSSLESS: {
                                        title: 'Lossless (FLAC)',
                                        desc: 'Calidad de CD (16-bit). Sonido puro sin pérdida.',
                                        adv: '✓ Alta fidelidad / ✗ Archivos grandes (~30-50MB)',
                                        icon: 'disc'
                                    },
                                    HIGH: {
                                        title: 'Alta (AAC/MP3)',
                                        desc: 'Excelente calidad comprimida (320kbps).',
                                        adv: '✓ Ahorro de espacio / ✓ Muy buena calidad',
                                        icon: 'check-circle'
                                    },
                                    LOW: {
                                        title: 'Básica (AAC)',
                                        desc: 'Calidad estándar eficiente (96kbps).',
                                        adv: '✓ Ahorro máximo / ✓ Ideal para poco espacio',
                                        icon: 'leaf'
                                    }
                                }[q];

                                return (
                                    <Pressable
                                        key={q}
                                        onPress={() => {
                                            setTidalDownloadQuality(q);
                                            setShowQualityModal(false);
                                        }}
                                        style={[
                                            styles.qualityOption,
                                            {
                                                backgroundColor: tidalDownloadQuality === q ? `${theme.colors.primary}15` : 'transparent',
                                                borderColor: tidalDownloadQuality === q ? theme.colors.primary : `${theme.colors.outline}33`,
                                                borderWidth: 1,
                                                borderRadius: 20,
                                                padding: 16
                                            }
                                        ]}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                            <IconButton icon={details.icon} iconColor={tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurfaceVariant} style={{ margin: 0 }} />
                                            <View style={{ flex: 1 }}>
                                                <Text variant="titleMedium" style={{ color: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurface }}>
                                                    {details.title}
                                                </Text>
                                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                    {details.desc}
                                                </Text>
                                                <Text variant="labelSmall" style={{ color: theme.colors.primary, marginTop: 4, fontWeight: 'bold' }}>
                                                    {details.adv}
                                                </Text>
                                            </View>
                                            {tidalDownloadQuality === q && (
                                                <IconButton icon="check" iconColor={theme.colors.primary} style={{ margin: 0 }} />
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    pageContent: {
        paddingBottom: 120,
    },
    headerGlow: {
        position: 'absolute',
        top: 10,
        right: 8,
        width: 180,
        height: 180,
        borderRadius: 120,
    },
    header: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 12,
        borderWidth: 1,
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 16,
        gap: 12,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    headerTopActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    qualityToggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 12,
        paddingLeft: 4,
        paddingVertical: 4,
        borderRadius: 20,
    },
    badge: {
        letterSpacing: 1.6,
        fontSize: 11,
        fontWeight: '800',
    },
    title: {
        fontWeight: '800',
    },
    searchbar: {
        borderRadius: 14,
        elevation: 0,
    },
    searchInput: {
        fontSize: 15,
    },
    statRow: {
        flexDirection: 'row',
        gap: 8,
    },
    statPill: {
        flex: 1,
        borderRadius: 14,
        paddingVertical: 8,
        alignItems: 'center',
    },
    tabsBar: {
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    tabsContent: {
        gap: 8,
    },
    tabButton: {
        minWidth: 80,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 14,
        height: 40,
    },
    centered: {
        minHeight: 320,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        gap: 12,
    },
    resultsContent: {
        paddingBottom: 8,
    },
    section: {
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    sectionTitle: {
        fontWeight: '800',
    },
    trackRow: {
        borderRadius: 18,
        padding: 11,
        borderWidth: 1,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    artwork: {
        width: 62,
        height: 62,
        borderRadius: 12,
        backgroundColor: 'rgba(127,127,127,0.2)',
    },
    artistArtwork: {
        width: 62,
        height: 62,
        borderRadius: 31,
        backgroundColor: 'rgba(127,127,127,0.2)',
    },
    trackContent: {
        flex: 1,
    },
    trackTitle: {
        fontWeight: '700',
        marginBottom: 2,
    },
    metaRow: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    qualityPill: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
    },
    entityRow: {
        borderRadius: 18,
        padding: 11,
        borderWidth: 1,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    entityContent: {
        flex: 1,
    },
    entityTitle: {
        fontWeight: '700',
    },
    playButton: {
        margin: 0,
        marginRight: 2,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 24,
        paddingBottom: 48,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    qualityOption: {
        marginVertical: 4,
    },
});
