import { CustomIcon, EmptyState, Skeleton } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { createTidalStreamTrack, extractAlbumsFromTracks, getTidalArtistInfo, isValidAudioFile, searchTidal, searchTidalArtists, searchTidalPlaylists, TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalPlaylist, TidalQuality, TidalTrack } from '@/src/types/audio';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Menu, Searchbar, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, FadeOut, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TidalTab = 'all' | 'artists' | 'albums' | 'tracks' | 'playlists';

const EXPLORE_MASONRY_CARDS: ReadonlyArray<{ title: string; subtitle: string; query: string; colors: [string, string]; height: number }> = [
    {
        title: 'Radar de novedades',
        subtitle: 'Lanzamientos',
        query: 'new releases',
        colors: ['#1F6FEB', '#0B1F4A'],
        height: 220,
    },
    {
        title: 'Top Global',
        subtitle: 'Más escuchados',
        query: 'Top global',
        colors: ['#8A2387', '#E94057'],
        height: 140,
    },
    {
        title: 'Rock',
        subtitle: 'Clásicos y nuevos',
        query: 'Rock',
        colors: ['#141E30', '#243B55'],
        height: 140,
    },
    {
        title: 'Reggaeton',
        subtitle: 'Baila sin parar',
        query: 'Reggaeton 2026',
        colors: ['#f12711', '#f5af19'],
        height: 220,
    },
    {
        title: 'Sesion Hi-Res',
        subtitle: 'Calidad de estudio',
        query: 'hi-res lossless',
        colors: ['#F26D3D', '#7A1D1D'],
        height: 220,
    },
    {
        title: 'Lo-Fi Chill',
        subtitle: 'Relájate',
        query: 'Lo-fi chill',
        colors: ['#005C97', '#363795'],
        height: 140,
    },
    {
        title: 'Gym',
        subtitle: 'Motivación',
        query: 'Gym motivation',
        colors: ['#FF416C', '#FF4B2B'],
        height: 140,
    },
    {
        title: 'Jazz',
        subtitle: 'Instrumental',
        query: 'Jazz instrumental',
        colors: ['#42275a', '#734b6d'],
        height: 220,
    },
];

function formatTrackDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const GRID_GAP = 12;
const CARD_HEIGHT_SQUARE = 180;
const CARD_HEIGHT_TALL = 260;

// ─── Standalone card to prevent remounting flicker ─────────────────────────
interface GridCardProps {
    item: any;
    colIndex: number;
    isLeft: boolean;
    type: 'artists' | 'albums' | 'playlists';
    artistArtworkUri?: string;
    onPress: () => void;
}

const MasonryGridCard = React.memo(function MasonryGridCard({ item, colIndex, isLeft, type, artistArtworkUri, onPress }: GridCardProps) {
    const { theme } = useTheme();

    let height = CARD_HEIGHT_TALL;
    if (type === 'albums') {
        // Zig-zag pattern for albums: 
        // Left: [Tall, Square, Tall...]
        // Right: [Square, Tall, Square...]
        const isSquare = isLeft ? (colIndex % 2 !== 0) : (colIndex % 2 === 0);
        height = isSquare ? CARD_HEIGHT_SQUARE : CARD_HEIGHT_TALL;
    } else {
        // Simple unaligned pattern for artists/playlists:
        // Right col starts with a square to shift the whole column
        const isSquare = !isLeft && colIndex === 0;
        height = isSquare ? CARD_HEIGHT_SQUARE : CARD_HEIGHT_TALL;
    }

    const title = type === 'artists' ? item.name : item.title;
    const subtitle = type === 'artists' ? 'Artista' : type === 'playlists' ? 'Playlist' : item.artistName;
    const rawImageUri = type === 'artists' ? (artistArtworkUri || item.artworkUrl) : item.artworkUrl;
    // Perfect middle ground: 500x500 for retina-sharp masonry cards without overtaxing the GPU/RAM
    const imageUri = rawImageUri ? rawImageUri.replace('100x100', '500x500').replace('200x200', '500x500').replace('300x300', '500x500') : undefined;

    const fallbackBg = theme.colors.surfaceVariant || '#1E1E1E';

    return (
        <View style={{ height, borderRadius: 28, overflow: 'hidden', backgroundColor: fallbackBg }}>
            <Pressable
                onPress={onPress}
                style={StyleSheet.absoluteFill}
            >
                {/* Background color placeholder/fallback */}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackBg }]} />

                {imageUri ? (
                    <Image
                        source={{ uri: imageUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={400}
                    />
                ) : (
                    <LinearGradient
                        colors={[fallbackBg, withAlpha(fallbackBg, 'CC')]}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    />
                )}

                {/* Bottom Overlay with Glass Effect */}
                <View style={styles.gridCardFooter}>
                    <BlurView
                        intensity={25}
                        tint="dark"
                        style={StyleSheet.absoluteFill}
                    />
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                    />

                    {/* Content */}
                    <View style={styles.gridCardContent}>
                        <Text numberOfLines={2} style={styles.gridCardTitle}>{title}</Text>
                        <Text numberOfLines={1} style={styles.gridCardSubtitle}>{subtitle}</Text>
                    </View>
                </View>
            </Pressable>
        </View>
    );
});

interface MasonryGridProps {
    items: any[];
    type: 'artists' | 'albums' | 'playlists';
    artistArtworkOverrides: Map<number, string>;
    openArtist: (a: any) => void;
    openAlbum: (a: any) => void;
    openPlaylist: (p: any) => void;
}

const MasonryGrid = React.memo(function MasonryGrid({ items, type, artistArtworkOverrides, openArtist, openAlbum, openPlaylist }: MasonryGridProps) {
    const leftCol: any[] = [];
    const rightCol: any[] = [];
    items.forEach((item, index) => {
        if (index % 2 === 0) leftCol.push(item);
        else rightCol.push(item);
    });

    return (
        <View style={styles.gridContainer}>
            <View style={styles.gridColumn}>
                {leftCol.map((item, idx) => (
                    <MasonryGridCard
                        key={String(item.id || item.uuid)}
                        item={item}
                        colIndex={idx}
                        isLeft={true}
                        type={type}
                        artistArtworkUri={type === 'artists' ? artistArtworkOverrides.get(item.id) : undefined}
                        onPress={() => {
                            if (type === 'artists') openArtist(item);
                            else if (type === 'albums') openAlbum(item);
                            else openPlaylist(item);
                        }}
                    />
                ))}
            </View>
            <View style={styles.gridColumn}>
                {rightCol.map((item, idx) => (
                    <MasonryGridCard
                        key={String(item.id || item.uuid)}
                        item={item}
                        colIndex={idx}
                        isLeft={false}
                        type={type}
                        artistArtworkUri={type === 'artists' ? artistArtworkOverrides.get(item.id) : undefined}
                        onPress={() => {
                            if (type === 'artists') openArtist(item);
                            else if (type === 'albums') openAlbum(item);
                            else openPlaylist(item);
                        }}
                    />
                ))}
            </View>
        </View>
    );
});

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

    const palette = useMemo(() => ({
        heroBackground: withAlpha(theme.colors.surfaceVariant, 'A6'),
        heroBorder: withAlpha(theme.colors.outline, '59'),
        searchBackground: withAlpha(theme.colors.surface, 'F2'),
        searchBorder: withAlpha(theme.colors.outline, '54'),
        chipBackground: withAlpha(theme.colors.surfaceVariant, 'E6'),
        chipSelectedBackground: theme.colors.primary,
        cardBackground: withAlpha(theme.colors.surface, 'F5'),
        cardBorder: withAlpha(theme.colors.outline, '42'),
        qualityBackground: theme.colors.primaryContainer,
        floatingGlow: withAlpha(theme.colors.primary, '1A'),
    }), [theme.colors]);

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [uiDebouncedQuery, setUiDebouncedQuery] = useState('');
    const [activeTab, setActiveTab] = useState<TidalTab>('all');
    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [artists, setArtists] = useState<TidalArtist[]>([]);
    const [artistArtworkOverrides, setArtistArtworkOverrides] = useState<Map<number, string>>(new Map());
    const [playlists, setPlaylists] = useState<TidalPlaylist[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const {
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror
    } = useSettingsStore();

    const showNotification = useNotificationStore(s => s.showNotification);

    const isSearching = useSharedValue(0);

    // Trigger header/search morph only after user pauses typing
    useEffect(() => {
        if (!query.trim()) {
            isSearching.value = withTiming(0, { duration: 1000 });
            return;
        }

        isSearching.value = withSpring(uiDebouncedQuery.trim() ? 1 : 0, {
            damping: 20,
            stiffness: 120,
            mass: 0.8,
        });
    }, [query, uiDebouncedQuery, isSearching]);

    const headStyle = useAnimatedStyle(() => {
        return {
            marginTop: interpolate(isSearching.value, [0, 1], [22, 10]),
            paddingVertical: interpolate(isSearching.value, [0, 1], [18, 0]),
        };
    });

    const titleRowAnimatedStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(isSearching.value, [0, 1], [1, 0]),
            height: interpolate(isSearching.value, [0, 1], [92, 0]),
            marginBottom: interpolate(isSearching.value, [0, 1], [10, 0]),
            overflow: 'hidden',
        };
    });

    const titleAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { translateX: interpolate(isSearching.value, [0, 1], [0, 15]) },
            ],
        };
    });

    const searchAnimatedStyle = useAnimatedStyle(() => {
        return {
            backgroundColor: interpolateColor(
                isSearching.value,
                [0, 1],
                [palette.searchBackground, 'transparent']
            ) as string,
            borderRadius: 999,
            borderColor: interpolateColor(
                isSearching.value,
                [0, 1],
                [palette.searchBorder, 'transparent']
            ) as string,
            borderWidth: interpolate(isSearching.value, [0, 1], [1, 0]),
            transform: [
                { scale: interpolate(isSearching.value, [0, 1], [1, 1.15]) },
                { translateY: interpolate(isSearching.value, [0, 1], [0, 15]) }
            ],
            marginBottom: interpolate(isSearching.value, [0, 1], [0, 10]),
        };
    });

    const bentoAnimatedStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(isSearching.value, [0.5, 1], [0, 1]),
            transform: [
                { translateY: interpolate(isSearching.value, [0, 1], [-20, 0]) },
                { scale: interpolate(isSearching.value, [0, 1], [0.95, 1]) },
            ],
        };
    });

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

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedQuery(query);
        }, 320);

        return () => clearTimeout(timeout);
    }, [query]);

    useEffect(() => {
        if (!query.trim()) {
            setUiDebouncedQuery('');
            return;
        }

        const timeout = setTimeout(() => {
            setUiDebouncedQuery(query);
        }, 1400);

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
            searchTidalPlaylists(currentQuery),
        ])
            .then(([nextTracks, nextArtists, nextPlaylists]) => {
                if (cancelled) return;
                setTracks(nextTracks);
                setArtists(nextArtists);
                setPlaylists(nextPlaylists);
                setArtistArtworkOverrides(new Map());
                artistArtworkAttempted.current.clear();
            })
            .catch((searchError: unknown) => {
                if (cancelled) return;
                setTracks([]);
                setArtists([]);
                setPlaylists([]);
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

    const openPlaylist = useCallback((playlist: TidalPlaylist) => {
        router.push({
            pathname: '/tidal-playlist/[id]',
            params: { id: playlist.uuid },
        });
    }, []);

    const resolveArtistArtwork = useCallback(async (artist: TidalArtist) => {
        if (artistArtworkAttempted.current.has(artist.id)) return;
        artistArtworkAttempted.current.add(artist.id);

        try {
            const artistInfo = await getTidalArtistInfo(artist.id);
            const nextArtwork = artistInfo.artworkUrl;
            if (!nextArtwork) return;

            setArtistArtworkOverrides(prev => {
                const next = new Map(prev);
                next.set(artist.id, nextArtwork);
                return next;
            });
        } catch {
            // Keep placeholder if fetch fails.
        }
    }, []);

    // Fetches artist artwork in background without slowing down search results
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
                <IconButton icon={() => <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />} mode="contained" containerColor={theme.colors.primary} size={18} onPress={() => handleTidalPlay(track)} style={styles.playButton} />
                <Button
                    compact
                    mode={downloaded ? 'contained' : 'outlined'}
                    onPress={() => handleTidalDownload(track)}
                    style={{ minWidth: 80 }}
                    icon={downloaded ? undefined : () => <CustomIcon name="Descargar" size={14} color={theme.colors.primary} />}
                >
                    {downloaded ? 'Guardado' : isDownloadingItem ? progressLabel : isError ? 'Reintentar' : 'Descargar'}
                </Button>
            </View>
        );
    }, [downloads, handleTidalDownload, handleTidalPlay, isDownloaded, theme.colors]);

    // MasonryGrid and MasonryGridCard are defined at module level above

    const hasQuery = query.trim().length > 0;
    const hasSettledQuery = uiDebouncedQuery.trim().length > 0;
    const isSearchPending = hasQuery && query.trim() !== debouncedQuery.trim();

    const applySuggestion = useCallback((nextQuery: string) => {
        setQuery(nextQuery);
    }, []);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
            <LinearGradient
                colors={[withAlpha(theme.colors.primaryContainer, '7D'), theme.colors.background, theme.colors.background]}
                style={StyleSheet.absoluteFill}
            />

            <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: styles.pageContent.paddingBottom + insets.bottom }]} showsVerticalScrollIndicator={false}>
                <Animated.View style={[styles.header, { gap: 0 }, headStyle]}>
                    <Animated.View style={[styles.headerTitleRow, titleRowAnimatedStyle]}>
                        <Animated.View style={[styles.headerTitleBlock, titleAnimatedStyle]}>
                            <Text variant="headlineMedium" style={styles.headerTitle}>Explorar</Text>
                        </Animated.View>
                        <Menu
                            visible={showSettingsMenu}
                            onDismiss={() => setShowSettingsMenu(false)}
                            anchor={
                                <IconButton
                                    icon="cog-outline"
                                    iconColor={theme.colors.onSurface}
                                    size={20}
                                    onPress={() => setShowSettingsMenu(true)}
                                    style={styles.settingsButton}
                                    containerColor={withAlpha(theme.colors.surface, 'F2')}
                                />
                            }
                            contentStyle={{ backgroundColor: palette.cardBackground, borderRadius: 16 }}
                        >
                            <Menu.Item
                                onPress={() => { setShowSettingsMenu(false); setShowQualityModal(true); }}
                                title="Calidad de Audio"
                                leadingIcon="tune-variant"
                            />
                            <Divider style={{ opacity: 0.1 }} />
                            <Menu.Item
                                onPress={() => { setShowSettingsMenu(false); setShowMirrorModal(true); }}
                                title="Cambiar Servidor"
                                leadingIcon="server-network"
                            />
                        </Menu>
                    </Animated.View>

                    <Animated.View style={[styles.searchShell, searchAnimatedStyle]}>
                        <Searchbar
                            placeholder="Busca artistas, álbumes, canciones..."
                            value={query}
                            onChangeText={setQuery}
                            style={[
                                styles.searchbar,
                                {
                                    backgroundColor: 'transparent',
                                    minHeight: hasSettledQuery ? 88 : 52,
                                }
                            ]}
                            iconColor={hasSettledQuery ? 'transparent' : theme.colors.primary}
                            inputStyle={[styles.searchInput, {
                                fontWeight: hasSettledQuery ? '900' : 'normal',
                                textAlign: hasSettledQuery ? 'left' : 'left',
                                fontSize: hasSettledQuery ? 56 : 15,
                                lineHeight: hasSettledQuery ? 58 : 20,
                                letterSpacing: hasSettledQuery ? -1.2 : 0,
                                paddingVertical: hasSettledQuery ? 0 : undefined,
                            }]}
                            placeholderTextColor={withAlpha(theme.colors.onSurfaceVariant, '40')}
                        />
                    </Animated.View>
                </Animated.View>

                {debouncedQuery.trim() ? (
                    <Animated.View style={[styles.bentoContainer, bentoAnimatedStyle]}>
                        {/* Columna Izquierda: Todo (Alta) */}
                        <Pressable
                            onPress={() => setActiveTab('all')}
                            style={[
                                styles.bentoItem,
                                styles.bentoTall,
                                {
                                    backgroundColor: activeTab === 'all' ? withAlpha(theme.colors.primary, '2B') : withAlpha(theme.colors.surfaceVariant, '99'),
                                    borderColor: activeTab === 'all' ? theme.colors.primary : withAlpha(theme.colors.outline, '66'),
                                },
                                activeTab === 'all' && styles.bentoActive
                            ]}
                        >
                            <Text style={[styles.bentoLabel, styles.bentoTallLabel, { color: activeTab === 'all' ? theme.colors.primary : theme.colors.onSurfaceVariant }, activeTab === 'all' && styles.bentoActiveLabel]}>Todo</Text>
                        </Pressable>

                        <View style={styles.bentoRightCol}>
                            {/* Fila Superior: Artistas, Álbumes, Playlists */}
                            <View style={styles.bentoRow}>
                                <Pressable
                                    onPress={() => setActiveTab('artists')}
                                    style={[
                                        styles.bentoItem,
                                        styles.bentoSmall,
                                        {
                                            backgroundColor: activeTab === 'artists' ? withAlpha(theme.colors.primary, '2B') : withAlpha(theme.colors.surfaceVariant, '99'),
                                            borderColor: activeTab === 'artists' ? theme.colors.primary : withAlpha(theme.colors.outline, '66'),
                                        },
                                        activeTab === 'artists' && styles.bentoActive
                                    ]}
                                >
                                    <Text style={[styles.bentoLabel, { color: activeTab === 'artists' ? theme.colors.primary : theme.colors.onSurfaceVariant }, activeTab === 'artists' && styles.bentoActiveLabel]}>Artistas</Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setActiveTab('albums')}
                                    style={[
                                        styles.bentoItem,
                                        styles.bentoSmall,
                                        {
                                            backgroundColor: activeTab === 'albums' ? withAlpha(theme.colors.primary, '2B') : withAlpha(theme.colors.surfaceVariant, '99'),
                                            borderColor: activeTab === 'albums' ? theme.colors.primary : withAlpha(theme.colors.outline, '66'),
                                        },
                                        activeTab === 'albums' && styles.bentoActive
                                    ]}
                                >
                                    <Text style={[styles.bentoLabel, { color: activeTab === 'albums' ? theme.colors.primary : theme.colors.onSurfaceVariant }, activeTab === 'albums' && styles.bentoActiveLabel]}>Álbumes</Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setActiveTab('playlists')}
                                    style={[
                                        styles.bentoItem,
                                        styles.bentoSmall,
                                        {
                                            backgroundColor: activeTab === 'playlists' ? withAlpha(theme.colors.primary, '2B') : withAlpha(theme.colors.surfaceVariant, '99'),
                                            borderColor: activeTab === 'playlists' ? theme.colors.primary : withAlpha(theme.colors.outline, '66'),
                                        },
                                        activeTab === 'playlists' && styles.bentoActive
                                    ]}
                                >
                                    <Text style={[styles.bentoLabel, { color: activeTab === 'playlists' ? theme.colors.primary : theme.colors.onSurfaceVariant }, activeTab === 'playlists' && styles.bentoActiveLabel]}>Playlists</Text>
                                </Pressable>
                            </View>

                            {/* Fila Inferior: Canciones (Ancha) */}
                            <View style={styles.bentoRow}>
                                <Pressable
                                    onPress={() => setActiveTab('tracks')}
                                    style={[
                                        styles.bentoItem,
                                        styles.bentoWide,
                                        {
                                            backgroundColor: activeTab === 'tracks' ? withAlpha(theme.colors.primary, '2B') : withAlpha(theme.colors.surfaceVariant, '99'),
                                            borderColor: activeTab === 'tracks' ? theme.colors.primary : withAlpha(theme.colors.outline, '66'),
                                        },
                                        activeTab === 'tracks' && styles.bentoActive
                                    ]}
                                >
                                    <Text style={[styles.bentoLabel, { color: activeTab === 'tracks' ? theme.colors.primary : theme.colors.onSurfaceVariant }, activeTab === 'tracks' && styles.bentoActiveLabel]}>Canciones</Text>
                                </Pressable>
                            </View>
                        </View>
                    </Animated.View>
                ) : null}

                {isLoading || isSearchPending ? (
                    <View style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                {/* Masonry skeleton: two columns */}
                                <View style={styles.gridContainer}>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_SQUARE} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                </View>
                            </View>
                        )}

                        {(activeTab === 'all' || activeTab === 'albums') && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Skeleton height={24} width={100} borderRadius={6} />
                                </View>
                                <View style={styles.gridContainer}>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                    <View style={styles.gridColumn}>
                                        <Skeleton height={CARD_HEIGHT_SQUARE} width="100%" borderRadius={28} />
                                        <Skeleton height={CARD_HEIGHT_TALL} width="100%" borderRadius={28} />
                                    </View>
                                </View>
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
                ) : !hasQuery ? (
                    <Animated.View entering={FadeInDown.duration(450)} exiting={FadeOut.duration(280)} style={styles.discoveryContainer}>



                        <View style={styles.gridContainer}>
                            <View style={styles.gridColumn}>
                                {EXPLORE_MASONRY_CARDS.filter((_, i) => i % 2 === 0).map((card) => (
                                    <View key={card.title} style={{ height: card.height, borderRadius: 22, overflow: 'hidden' }}>
                                        <Pressable
                                            onPress={() => applySuggestion(card.query)}
                                            style={StyleSheet.absoluteFill}
                                        >
                                            <LinearGradient colors={card.colors} style={[styles.discoveryCard, { flex: 1, height: undefined, minHeight: undefined }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                                <Text style={styles.discoveryCardTitle}>{card.title}</Text>
                                                <Text style={styles.discoveryCardSubtitle}>{card.subtitle}</Text>
                                            </LinearGradient>
                                        </Pressable>
                                    </View>
                                ))}
                            </View>
                            <View style={styles.gridColumn}>
                                {EXPLORE_MASONRY_CARDS.filter((_, i) => i % 2 !== 0).map((card) => (
                                    <View key={card.title} style={{ height: card.height, borderRadius: 22, overflow: 'hidden' }}>
                                        <Pressable
                                            onPress={() => applySuggestion(card.query)}
                                            style={StyleSheet.absoluteFill}
                                        >
                                            <LinearGradient colors={card.colors} style={[styles.discoveryCard, { flex: 1, height: undefined, minHeight: undefined }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                                <Text style={styles.discoveryCardTitle}>{card.title}</Text>
                                                <Text style={styles.discoveryCardSubtitle}>{card.subtitle}</Text>
                                            </LinearGradient>
                                        </Pressable>
                                    </View>
                                ))}
                            </View>
                        </View>
                    </Animated.View>
                ) : !tracks.length && !albums.length && !artists.length && !playlists.length ? (
                    <View style={styles.centered}>
                        <EmptyState icon="🫧" title="No matches" description={`No encontramos resultados para "${debouncedQuery.trim()}"`} />
                    </View>
                ) : (
                    <Animated.View entering={FadeIn.duration(400)} style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && artists.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Artistas</Text>
                                </View>
                                {<MasonryGrid items={artists.slice(0, activeTab === 'all' ? 6 : artists.length)} type="artists" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'albums') && albums.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Álbumes</Text>
                                </View>
                                {<MasonryGrid items={albums.slice(0, activeTab === 'all' ? 8 : albums.length)} type="albums" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'playlists') && playlists.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(250).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Playlists</Text>
                                </View>
                                {<MasonryGrid items={playlists.slice(0, activeTab === 'all' ? 6 : playlists.length)} type="playlists" artistArtworkOverrides={artistArtworkOverrides} openArtist={openArtist} openAlbum={openAlbum} openPlaylist={openPlaylist} />}
                            </Animated.View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'tracks') && tracks.length > 0 ? (
                            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Canciones</Text>
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
                animationType="slide"
                onRequestClose={() => setShowMirrorModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '900' }}>
                                    Servidores
                                </Text>
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                    Selecciona tu fuente de datos
                                </Text>
                            </View>
                            <IconButton icon="close" mode="contained-tonal" onPress={() => setShowMirrorModal(false)} />
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
                            <Pressable
                                onPress={() => handleMirrorChange('auto')}
                                style={({ pressed }) => [
                                    styles.premiumOption,
                                    {
                                        backgroundColor: tidalMirror === 'auto' ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                        borderColor: tidalMirror === 'auto' ? theme.colors.primary : 'transparent',
                                        opacity: pressed ? 0.7 : 1
                                    }
                                ]}
                            >
                                <View style={[styles.optionIconContainer, { backgroundColor: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                    <IconButton icon="auto-fix" size={20} iconColor={tidalMirror === 'auto' ? theme.colors.onPrimary : theme.colors.onSurface} style={{ margin: 0 }} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text variant="titleMedium" style={{
                                        color: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurface,
                                        fontWeight: '800'
                                    }}>
                                        Enrutamiento Automático
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Alterna servidores si falla la conexión.
                                    </Text>
                                </View>
                                {tidalMirror === 'auto' && (
                                    <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                        <CustomIcon name="Play" size={12} color={theme.colors.onPrimary} />
                                    </View>
                                )}
                            </Pressable>

                            {TIDAL_API_BASES.map((mirror) => (
                                <Pressable
                                    key={mirror}
                                    onPress={() => handleMirrorChange(mirror)}
                                    style={({ pressed }) => [
                                        styles.premiumOption,
                                        {
                                            backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                            borderColor: tidalMirror === mirror ? theme.colors.primary : 'transparent',
                                            opacity: pressed ? 0.7 : 1
                                        }
                                    ]}
                                >
                                    <View style={[styles.optionIconContainer, { backgroundColor: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                        <IconButton
                                            icon="server"
                                            size={20}
                                            iconColor={tidalMirror === mirror ? theme.colors.onPrimary : theme.colors.onSurface}
                                            style={{ margin: 0 }}
                                        />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text variant="titleMedium" style={{
                                            color: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurface,
                                            fontWeight: '800'
                                        }}>
                                            {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                        </Text>
                                        <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                                            {mirror.replace('https://', '')}
                                        </Text>
                                    </View>
                                    {tidalMirror === mirror && (
                                        <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                            <IconButton icon="check" size={12} iconColor={theme.colors.onPrimary} style={{ margin: 0 }} />
                                        </View>
                                    )}
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
                animationType="slide"
                onRequestClose={() => setShowQualityModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '900' }}>
                                    Fidelidad
                                </Text>
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                    Calidad de flujo y descarga
                                </Text>
                            </View>
                            <IconButton icon="close" mode="contained-tonal" onPress={() => setShowQualityModal(false)} />
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
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
                                        style={({ pressed }) => [
                                            styles.premiumOption,
                                            {
                                                backgroundColor: tidalDownloadQuality === q ? `${theme.colors.primary}20` : theme.colors.surfaceVariant + '40',
                                                borderColor: tidalDownloadQuality === q ? theme.colors.primary : 'transparent',
                                                opacity: pressed ? 0.7 : 1
                                            }
                                        ]}
                                    >
                                        <View style={[styles.optionIconContainer, { backgroundColor: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurfaceVariant + '20' }]}>
                                            <IconButton
                                                icon={details.icon}
                                                size={22}
                                                iconColor={tidalDownloadQuality === q ? theme.colors.onPrimary : theme.colors.onSurface}
                                                style={{ margin: 0 }}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={{
                                                color: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurface,
                                                fontWeight: '800'
                                            }}>
                                                {details.title}
                                            </Text>
                                            <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: 'bold', marginBottom: 2 }}>
                                                {details.adv.split(' / ')[0]}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {details.desc}
                                            </Text>
                                        </View>
                                        {tidalDownloadQuality === q && (
                                            <View style={[styles.checkCircle, { backgroundColor: theme.colors.primary }]}>
                                                <IconButton icon="check" size={12} iconColor={theme.colors.onPrimary} style={{ margin: 0 }} />
                                            </View>
                                        )}
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
        marginTop: 10,
        marginBottom: 10,
        paddingHorizontal: 0,
        paddingTop: 12,
        paddingBottom: 10,
        gap: 12,
        elevation: 0,
    },
    headerTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitleBlock: {
        flex: 1,
        paddingRight: 10,
        justifyContent: 'center',
    },
    headerTitle: {
        fontWeight: '900',
        letterSpacing: -1.2,
        fontSize: 56,
        lineHeight: 58,
    },
    settingsButton: {
        margin: 0,
        width: 36,
        height: 36,
        borderRadius: 12,
    },
    title: {
        fontWeight: '800',
    },
    searchShell: {
        borderRadius: 999,
        paddingHorizontal: 4,
    },
    searchbar: {
        borderRadius: 999,
        minHeight: 52,
        elevation: 0,
    },
    searchInput: {
        fontSize: 15,
        paddingLeft: 2,
    },
    bentoContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 10,
        height: 140,
    },
    bentoItem: {
        borderRadius: 24,
        borderWidth: 1.5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bentoTall: {
        width: 75,
        height: '100%',
        justifyContent: 'flex-end',
        paddingBottom: 16,
    },
    bentoWide: {
        flex: 2,
        height: '100%',
        alignItems: 'flex-start',
        paddingLeft: 16,
    },
    bentoSmall: {
        flex: 1,
        height: '100%',
    },
    bentoRightCol: {
        flex: 1,
        gap: 10,
    },
    bentoRow: {
        flex: 1,
        flexDirection: 'row',
        gap: 10,
    },
    bentoLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    bentoTallLabel: {
        fontSize: 14,
    },
    bentoActive: {
        transform: [{ scale: 1.02 }],
    },
    bentoActiveLabel: {
        fontWeight: '800',
    },
    bentoIconBox: {
        opacity: 0.8,
    },
    centered: {
        minHeight: 320,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        gap: 12,
    },
    discoveryContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 10,
    },
    discoveryTitle: {
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: -0.4,
    },
    discoverySubtitle: {
        fontSize: 14,
        marginBottom: 4,
    },
    discoveryCardsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    discoveryCardPressable: {
        flex: 1,
    },
    discoveryCard: {
        minHeight: 132,
        borderRadius: 22,
        padding: 14,
        justifyContent: 'flex-end',
    },
    discoveryCardTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: -0.3,
    },
    discoveryCardSubtitle: {
        color: 'rgba(255,255,255,0.88)',
        fontSize: 12,
        marginTop: 5,
    },
    suggestionWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 6,
    },
    suggestionChip: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    suggestionChipLabel: {
        fontSize: 12,
        fontWeight: '700',
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
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 36,
        borderTopRightRadius: 36,
        padding: 24,
        paddingBottom: 40,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 24,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    premiumOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 20,
        borderWidth: 1,
        gap: 16,
    },
    optionIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gridContainer: {
        flexDirection: 'row',
        gap: GRID_GAP,
    },
    gridColumn: {
        flex: 1,
        gap: GRID_GAP,
    },
    gridCard: {
        borderRadius: 28,
        padding: 20,
        overflow: 'hidden',
    },
    gridCardFooter: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        minHeight: 80,
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    gridCardContent: {
        padding: 16,
        paddingBottom: 20,
        zIndex: 2,
    },
    gridCardTitle: {
        color: '#fff',
        fontWeight: '900',
        fontSize: 18,
        letterSpacing: -0.5,
        textShadowColor: 'rgba(0,0,0,0.4)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
        lineHeight: 22,
    },
    gridCardSubtitle: {
        color: 'rgba(255,255,255,0.8)',
        fontWeight: '700',
        fontSize: 13,
        marginTop: 4,
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    gridIconPlaceholder: {
        position: 'absolute',
        bottom: 20,
        right: 20,
        opacity: 0.3,
    },
    gridImageContainer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    gridImage: {
        width: '100%',
        height: '100%',
    },
    gridImageGradientOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
});
