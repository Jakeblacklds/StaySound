import { EmptyState, Skeleton, CustomIcon } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { 
    getArtworkUrl,
    getPlaylistArtworkUrl,
    searchTidal, 
    searchTidalPlaylists, 
    extractAlbumsFromTracks
} from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme, typeScale } from '@/src/theme';
import { TidalTrack, TidalPlaylist, TidalAlbum } from '@/src/types/audio';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const CARD_HEIGHT_SQUARE = 180;
const CARD_HEIGHT_TALL = 260;
const GENRE_GRID_INITIAL_ITEMS = 16;
const GENRE_GRID_PAGE_SIZE = 16;
const GENRE_GRID_MAX_ITEMS = 96;

function withAlpha(color: string, alpha: string): string {
    return color.length === 7 ? color + alpha : color;
}

function normalizeCardImageUri(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    let trimmed = value.trim();
    if (!trimmed) return undefined;

    // Handle Tidal UUIDs/IDs from Monochrome backend
    if (!trimmed.startsWith('http')) {
        // If it's a UUID (has dashes or is long), it's likely a playlist image or resource
        if (trimmed.includes('-') || trimmed.length > 20) {
            const path = trimmed.replace(/-/g, '/');
            trimmed = `https://resources.tidal.com/images/${path}/640x640.jpg`;
        } else if (/^\d+$/.test(trimmed)) {
            // If it's numeric, it's an album artwork ID
            const path = trimmed.replace(/-/g, '/'); // and maybe grouping? but usually just the ID works for resources.tidal
            trimmed = `https://resources.tidal.com/images/${path}/640x640.jpg`;
        }
    }

    return trimmed
        .replace('100x100', '640x640')
        .replace('200x200', '640x640')
        .replace('300x300', '640x640')
        .replace('500x500', '640x640');
}

type CuratedGridItem = {
    id: string;
    type: 'albums' | 'playlists';
    data: {
        id?: string | number;
        uuid?: string;
        title: string;
        artworkUrl?: string;
        artistName?: string;
    } & Record<string, unknown>;
};

function looksLikePlaylistItem(item: Record<string, unknown>): boolean {
    const url = typeof item.url === 'string' ? item.url : '';
    return (
        typeof item.numberOfTracks === 'number'
        || typeof item.squareImage === 'string'
        || url.includes('/playlist/')
    );
}

function resolveCuratedArtworkUrl(item: Record<string, unknown>, type: 'albums' | 'playlists'): string | undefined {
    const rawCandidates = type === 'playlists'
        ? [item.squareImage, item.image, item.cover, item.picture]
        : [item.cover, item.image, item.squareImage, item.picture];

    for (const candidate of rawCandidates) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('http')) return trimmed;
        return type === 'playlists' ? getPlaylistArtworkUrl(trimmed) : getArtworkUrl(trimmed);
    }

    return undefined;
}

function buildCuratedItems(data: any): CuratedGridItem[] {
    const allItems: CuratedGridItem[] = [];

    (data.sections || []).forEach((section: any) => {
        const type = section.type === 'ALBUM_LIST' ? 'albums'
            : section.type === 'PLAYLIST_LIST' ? 'playlists'
            : null;

        if (!type || !Array.isArray(section.items)) return;

        allItems.push(...section.items.map((item: any) => ({
            id: String(item.id || item.uuid),
            type,
            data: {
                ...item,
                id: item.id || item.uuid,
                title: item.title || item.name,
                artworkUrl: resolveCuratedArtworkUrl(item, type),
                artistName: item.artist?.name || item.artists?.[0]?.name || item.artistName || 'Curated',
            },
        })));
    });

    const fallbackCollections = Object.values(data)
        .filter((value): value is any[] => Array.isArray(value) && value.length > 0);

    fallbackCollections.forEach(collection => {
        collection.forEach((item: any) => {
            if (!item || typeof item !== 'object') return;

            const type: 'albums' | 'playlists' | null = looksLikePlaylistItem(item)
                ? 'playlists'
                : typeof item.id === 'number'
                    ? 'albums'
                    : null;

            if (!type) return;

            allItems.push({
                id: String(item.id || item.uuid),
                type,
                data: {
                    ...item,
                    id: item.id || item.uuid,
                    title: item.title || item.name,
                    artworkUrl: resolveCuratedArtworkUrl(item, type),
                    artistName: item.artist?.name || item.artists?.[0]?.name || item.artistName || 'Curated',
                },
            });
        });
    });

    const seen = new Set<string>();
    return allItems.filter(item => {
        const key = `${item.type}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

const MasonryGridCard = React.memo(function MasonryGridCard({ item, colIndex, isLeft, type, onPress }: { item: any, colIndex: number, isLeft: boolean, type: 'albums' | 'playlists', onPress: () => void }) {
    const { theme } = useTheme();

    // Simple zig-zag pattern
    const isSquare = isLeft ? (colIndex % 2 !== 0) : (colIndex % 2 === 0);
    const height = isSquare ? CARD_HEIGHT_SQUARE : CARD_HEIGHT_TALL;

    const title = item.title;
    const subtitle = type === 'playlists' ? 'Playlist' : item.artistName;
    const imageUri = normalizeCardImageUri(item.artworkUrl);
    const fallbackBg = theme.colors.surfaceVariant || '#1E1E1E';

    return (
        <View style={{ height, borderRadius: 28, overflow: 'hidden', backgroundColor: fallbackBg, marginBottom: 12 }}>
            <Pressable onPress={onPress} style={StyleSheet.absoluteFill}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackBg }]} />
                {imageUri && (
                    <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
                )}
                <View style={styles.gridCardFooter}>
                    <LinearGradient
                        colors={['transparent', 'rgba(12,12,14,0.3)', 'rgba(12,12,14,0.85)']}
                        style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.gridCardContent}>
                        <Text numberOfLines={2} style={styles.gridCardTitle}>{title}</Text>
                        <Text numberOfLines={1} style={styles.gridCardSubtitle}>{subtitle}</Text>
                    </View>
                </View>
            </Pressable>
        </View>
    );
});

export default function TidalGenreScreen() {
    const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [tracks, setTracks] = useState<TidalTrack[]>([]);
    const [playlists, setPlaylists] = useState<TidalPlaylist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [visibleCount, setVisibleCount] = useState(GENRE_GRID_INITIAL_ITEMS);

    const albums = useMemo(() => extractAlbumsFromTracks(tracks), [tracks]);

    const [curatedItems, setCuratedItems] = useState<CuratedGridItem[]>([]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        setIsLoading(true);
        setError(null);
        setVisibleCount(GENRE_GRID_INITIAL_ITEMS);

        const fetchCurated = async () => {
            try {
                // Fetch from Monochrome's curated backend
                const response = await fetch(`https://hot.monochrome.tf/explore/genre/?id=${id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (cancelled) return;

                    const allItems = buildCuratedItems(data);

                    if (allItems.length > 0) {
                        setCuratedItems(allItems);
                        setIsLoading(false);
                        return;
                    }
                }
            } catch (err) {
                console.warn('[GenreScreen] Curated fetch failed:', err);
            }

            // Fallback to standard search if curated fails or is empty
            try {
                const [nextTracks, nextPlaylists] = await Promise.all([
                    searchTidal(name || ''),
                    searchTidalPlaylists(name || '')
                ]);
                if (cancelled) return;
                setTracks(nextTracks);
                setPlaylists(nextPlaylists);
                setCuratedItems([]);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Error al cargar genero');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void fetchCurated();
        return () => { cancelled = true; };
    }, [id, name]);

    // Merge everything into a mixed list for the masonry grid
    const mergedResults = useMemo(() => {
        if (curatedItems.length > 0) return curatedItems.slice(0, GENRE_GRID_MAX_ITEMS);

        const results: Array<{ id: string | number; type: 'albums' | 'playlists'; data: any }> = [];
        const pCount = playlists.length;
        const aCount = albums.length;
        const max = Math.max(pCount, aCount);

        for (let i = 0; i < max; i++) {
            if (i < pCount) results.push({ id: `p-${playlists[i].uuid}`, type: 'playlists', data: playlists[i] });
            if (i < aCount) results.push({ id: `a-${albums[i].id}`, type: 'albums', data: albums[i] });
        }
        return results.slice(0, GENRE_GRID_MAX_ITEMS);
    }, [curatedItems, playlists, albums]);

    const visibleResults = useMemo(
        () => mergedResults.slice(0, visibleCount),
        [mergedResults, visibleCount]
    );
    const hasMoreResults = visibleResults.length < mergedResults.length;
    const loadMoreResults = useCallback(() => {
        setVisibleCount(prev => Math.min(prev + GENRE_GRID_PAGE_SIZE, mergedResults.length));
    }, [mergedResults.length]);

    const renderGrid = () => {
        const leftCol = visibleResults.filter((_, i) => i % 2 === 0);
        const rightCol = visibleResults.filter((_, i) => i % 2 !== 0);

        return (
            <View style={styles.gridWrapper}>
                <View style={styles.gridColumn}>
                    {leftCol.map((item, idx) => (
                        <MasonryGridCard 
                            key={`${item.type}-${item.id}`} 
                            item={item.data} 
                            colIndex={idx} 
                            isLeft={true} 
                            type={item.type} 
                            onPress={() => {
                                if (item.type === 'playlists') {
                                    router.push({ pathname: '/tidal-playlist/[id]', params: { id: String(item.data.id || item.data.uuid) } });
                                } else {
                                    router.push({ pathname: '/tidal-album/[id]', params: { id: String(item.data.id) } });
                                }
                            }}
                        />
                    ))}
                </View>
                <View style={styles.gridColumn}>
                    {rightCol.map((item, idx) => (
                        <MasonryGridCard 
                            key={`${item.type}-${item.id}`} 
                            item={item.data} 
                            colIndex={idx} 
                            isLeft={false} 
                            type={item.type} 
                            onPress={() => {
                                if (item.type === 'playlists') {
                                    router.push({ pathname: '/tidal-playlist/[id]', params: { id: String(item.data.id || item.data.uuid) } });
                                } else {
                                    router.push({ pathname: '/tidal-album/[id]', params: { id: String(item.data.id) } });
                                }
                            }}
                        />
                    ))}
                </View>
            </View>
        );
    };

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.header, { marginTop: insets.top }]}>
                    <Skeleton height={40} width={40} borderRadius={20} />
                    <Skeleton height={28} width={150} borderRadius={6} />
                </View>
                <View style={{ flex: 1, padding: 16, flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1, gap: 12 }}>
                        <Skeleton height={260} width="100%" borderRadius={28} />
                        <Skeleton height={180} width="100%" borderRadius={28} />
                    </View>
                    <View style={{ flex: 1, gap: 12 }}>
                        <Skeleton height={180} width="100%" borderRadius={28} />
                        <Skeleton height={260} width="100%" borderRadius={28} />
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle="light-content" />

            <View style={[styles.backButton, { top: insets.top + 8 }]}>
                <BlurView intensity={20} tint="dark" style={styles.backButtonBlur}>
                    <IconButton icon="arrow-left" iconColor="#FFFFFF" onPress={() => router.back()} />
                </BlurView>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 60 }]}>
                <View style={styles.headerTitleContainer}>
                    <Text variant="headlineMedium" style={[styles.genreTitle, { color: theme.colors.onBackground }]}>
                        {name}
                    </Text>
                    <View style={[styles.titleAccent, { backgroundColor: theme.colors.primary }]} />
                </View>

                {error ? (
                    <EmptyState title="Error" description={error} />
                ) : (
                    <Animated.View entering={FadeInDown.delay(100)} style={styles.section}>
                        {renderGrid()}
                        {hasMoreResults ? (
                            <Pressable
                                onPress={loadMoreResults}
                                style={({ pressed }) => [
                                    styles.loadMoreButton,
                                    {
                                        backgroundColor: withAlpha(theme.colors.surfaceVariant || theme.colors.surface, 'E8'),
                                        borderColor: withAlpha(theme.colors.outline, '2E'),
                                    },
                                    pressed && { opacity: 0.86 },
                                ]}
                            >
                                <Text style={[styles.loadMoreLabel, { color: theme.colors.onSurface }]}>
                                    Cargar mas
                                </Text>
                                <Text style={[styles.loadMoreMeta, { color: theme.colors.onSurfaceVariant }]}>
                                    Mostrando {visibleResults.length} de {mergedResults.length}
                                </Text>
                            </Pressable>
                        ) : null}
                    </Animated.View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
    backButton: { position: 'absolute', left: 16, zIndex: 10 },
    backButtonBlur: { borderRadius: 20, overflow: 'hidden' },
    content: { paddingBottom: 100 },
    headerTitleContainer: { paddingHorizontal: 16, marginBottom: 24 },
    genreTitle: { fontWeight: '900', letterSpacing: -1 },
    titleAccent: { height: 4, width: 40, marginTop: 4, borderRadius: 2 },
    section: { paddingHorizontal: 16 },
    gridWrapper: { flexDirection: 'row', gap: 12 },
    gridColumn: { flex: 1 },
    gridCardFooter: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60%',
        justifyContent: 'flex-end',
        padding: 16,
    },
    gridCardContent: {
        zIndex: 1,
    },
    gridCardTitle: {
        color: '#FFFFFF',
        ...typeScale.bodyLarge,
        fontWeight: '800',
        fontSize: 15,
        lineHeight: 18,
    },
    gridCardSubtitle: {
        color: 'rgba(255,255,255,0.7)',
        ...typeScale.bodyMedium,
        fontSize: 12,
        marginTop: 4,
    },
    loadMoreButton: {
        marginTop: 16,
        marginBottom: 12,
        borderRadius: 20,
        borderWidth: 1,
        paddingVertical: 14,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    loadMoreLabel: {
        ...typeScale.body,
        fontWeight: '700',
    },
    loadMoreMeta: {
        ...typeScale.caption,
        marginTop: 4,
    },
});
