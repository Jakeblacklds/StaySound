import { EmptyState } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { createTidalStreamTrack, extractAlbumsFromTracks, getTidalArtistDetail, isValidFlacFile, searchTidal, searchTidalArtists } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { TidalAlbum, TidalArtist, TidalTrack } from '@/src/types';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Searchbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

type TidalTab = 'all' | 'artists' | 'albums' | 'tracks';

const TIDAL_TABS: ReadonlyArray<{ value: TidalTab; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'artists', label: 'Artists' },
    { value: 'albums', label: 'Albums' },
    { value: 'tracks', label: 'Tracks' },
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
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [activeTab, setActiveTab] = useState<TidalTab>('all');
    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [artists, setArtists] = useState<TidalArtist[]>([]);
    const [artistArtworkOverrides, setArtistArtworkOverrides] = useState<Map<number, string>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
        heroBackground: withAlpha(theme.colors.primaryContainer, 'AA'),
        heroBorder: withAlpha(theme.colors.primary, '4D'),
        searchBackground: withAlpha(theme.colors.surface, 'F0'),
        chipBackground: withAlpha(theme.colors.surfaceVariant, 'C7'),
        chipSelectedBackground: withAlpha(theme.colors.primaryContainer, 'E8'),
        cardBackground: withAlpha(theme.colors.surface, 'F5'),
        cardBorder: withAlpha(theme.colors.outline, '42'),
        qualityBackground: withAlpha(theme.colors.primaryContainer, 'BF'),
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
                const validLocal = await isValidFlacFile(downloadedTrack.uri);
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
                        <View style={[styles.qualityPill, { backgroundColor: palette.qualityBackground }]}> 
                            <Text style={{ color: track.isHiRes ? theme.colors.primary : theme.colors.onSurfaceVariant, fontWeight: '700' }}>
                                {track.isHiRes ? 'HI-RES' : 'LOSSLESS'}
                            </Text>
                        </View>
                    </View>
                </Pressable>
                <IconButton icon="play" mode="contained-tonal" size={18} onPress={() => handleTidalPlay(track)} style={styles.playButton} />
                <Button compact mode={downloaded ? 'contained' : 'outlined'} loading={isDownloadingItem} onPress={() => handleTidalDownload(track)}>
                    {buttonLabel}
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
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Artist</Text>
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

            <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.headerGlow, { backgroundColor: palette.floatingGlow }]} />
                <View style={[styles.header, { backgroundColor: palette.heroBackground, borderColor: palette.heroBorder }]}> 
                    <Text style={[styles.badge, { color: theme.colors.primary }]}>NEXT SOUND</Text>
                    <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>TIDAL Search Hub</Text>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        Busca, reproduce y guarda lo mejor de TIDAL en una vista moderna.
                    </Text>
                    <Searchbar
                        placeholder="Search artists, albums, tracks"
                        value={query}
                        onChangeText={setQuery}
                        style={[styles.searchbar, { backgroundColor: palette.searchBackground }]}
                        iconColor={theme.colors.primary}
                        inputStyle={styles.searchInput}
                    />

                    {debouncedQuery.trim() ? (
                        <View style={styles.statRow}>
                            <View style={[styles.statPill, { backgroundColor: palette.chipBackground }]}>
                                <Text style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{artists.length}</Text>
                                <Text style={{ color: theme.colors.onSurfaceVariant }}>Artists</Text>
                            </View>
                            <View style={[styles.statPill, { backgroundColor: palette.chipBackground }]}>
                                <Text style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{albums.length}</Text>
                                <Text style={{ color: theme.colors.onSurfaceVariant }}>Albums</Text>
                            </View>
                            <View style={[styles.statPill, { backgroundColor: palette.chipBackground }]}>
                                <Text style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{tracks.length}</Text>
                                <Text style={{ color: theme.colors.onSurfaceVariant }}>Tracks</Text>
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
                                            backgroundColor: selected ? palette.chipSelectedBackground : palette.chipBackground,
                                            borderColor: selected ? withAlpha(theme.colors.primary, '66') : 'transparent',
                                        },
                                    ]}
                                    onPress={() => setActiveTab(tab.value)}
                                >
                                    <Text style={{ color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant, fontWeight: selected ? '700' : '500' }}>
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {isLoading ? (
                    <View style={styles.centered}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.onSurfaceVariant }}>Searching TIDAL...</Text>
                    </View>
                ) : error ? (
                    <View style={styles.centered}>
                        <EmptyState icon="⚠️" title="TIDAL unavailable" description={error} />
                    </View>
                ) : !debouncedQuery.trim() ? (
                    <View style={styles.centered}>
                        <EmptyState
                            icon="⬢"
                            title="Search the TIDAL catalog"
                            description="Busca por artista, album y pista. Luego entra a artista o album para explorar mas."
                        />
                    </View>
                ) : !hasResults ? (
                    <View style={styles.centered}>
                        <EmptyState icon="🫧" title="No matches" description={`No encontramos resultados para "${debouncedQuery.trim()}"`} />
                    </View>
                ) : (
                    <View style={styles.resultsContent}>
                        {(activeTab === 'all' || activeTab === 'artists') && artists.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Artists</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{artists.length}</Text>
                                </View>
                                {artists.slice(0, activeTab === 'all' ? 6 : artists.length).map(renderArtistRow)}
                            </View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'albums') && albums.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Albums</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{albums.length}</Text>
                                </View>
                                {albums.slice(0, activeTab === 'all' ? 8 : albums.length).map(renderAlbumRow)}
                            </View>
                        ) : null}

                        {(activeTab === 'all' || activeTab === 'tracks') && tracks.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>Tracks</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{tracks.length}</Text>
                                </View>
                                {tracks.slice(0, activeTab === 'all' ? 12 : tracks.length).map(renderTrackRow)}
                            </View>
                        ) : null}
                    </View>
                )}
            </ScrollView>
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
        gap: 10,
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
});
