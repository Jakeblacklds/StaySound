import { EmptyState, Skeleton, CustomIcon } from '@/src/components/ui';
import { useTidalDownload } from '@/src/hooks';
import { 
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

    const albums = useMemo(() => extractAlbumsFromTracks(tracks), [tracks]);

    const [curatedItems, setCuratedItems] = useState<any[]>([]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        setIsLoading(true);
        setError(null);

        const fetchCurated = async () => {
            try {
                // Fetch from Monochrome's curated backend
                const response = await fetch(`https://hot.monochrome.tf/explore/genre/?id=${id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (cancelled) return;

                    const allItems: any[] = [];
                    (data.sections || []).forEach((section: any) => {
                        const type = section.type === 'ALBUM_LIST' ? 'albums' : 
                                     section.type === 'PLAYLIST_LIST' ? 'playlists' : 
                                     section.type === 'TRACK_LIST' ? 'tracks' : null;
                        
                        if (type && type !== 'tracks' && section.items) {
                            allItems.push(...section.items.map((item: any) => ({
                                id: String(item.id || item.uuid),
                                type,
                                data: {
                                    ...item,
                                    id: item.id || item.uuid,
                                    title: item.title || item.name,
                                    artworkUrl: item.cover || item.image || item.uuid || item.picture,
                                    artistName: item.artist?.name || item.artists?.[0]?.name || item.artistName || 'Curated'
                                }
                            })));
                        }
                    });

                    if (allItems.length > 0) {
                        // Deduplicate items to avoid React key errors
                        const seen = new Set();
                        const uniqueItems = allItems.filter(item => {
                            const duplicate = seen.has(item.id);
                            seen.add(item.id);
                            return !duplicate;
                        });
                        setCuratedItems(uniqueItems);
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
        if (curatedItems.length > 0) return curatedItems;

        const results: Array<{ id: string | number; type: 'albums' | 'playlists'; data: any }> = [];
        const pCount = playlists.length;
        const aCount = albums.length;
        const max = Math.max(pCount, aCount);

        for (let i = 0; i < max; i++) {
            if (i < pCount) results.push({ id: `p-${playlists[i].uuid}`, type: 'playlists', data: playlists[i] });
            if (i < aCount) results.push({ id: `a-${albums[i].id}`, type: 'albums', data: albums[i] });
        }
        return results;
    }, [curatedItems, playlists, albums]);

    const renderGrid = () => {
        const leftCol = mergedResults.filter((_, i) => i % 2 === 0);
        const rightCol = mergedResults.filter((_, i) => i % 2 !== 0);

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
});
