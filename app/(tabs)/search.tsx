import { AlbumCard, ArtistCard, EmptyState, TrackListItem } from '@/src/components/ui';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Searchbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

type SearchFilter = 'all' | 'songs' | 'albums' | 'artists';

export default function SearchScreen() {
    const { theme } = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<SearchFilter>('all');

    const { search } = useLibraryStore();
    const { play, currentTrack } = usePlayerStore();

    const results = useMemo(() => {
        if (!searchQuery.trim()) return null;
        return search(searchQuery);
    }, [searchQuery, search]);

    const handleTrackPress = useCallback((track: Track) => {
        if (results?.tracks) {
            play(track, results.tracks);
        } else {
            play(track);
        }
    }, [results, play]);

    const handleAlbumPress = useCallback((album: Album) => {
        router.push({ pathname: '/album/[id]', params: { id: album.id } });
    }, []);

    const handleArtistPress = useCallback((artist: Artist) => {
        router.push({ pathname: '/artist/[id]', params: { id: artist.id } });
    }, []);

    const renderEmptyState = () => (
        <View style={styles.centered}>
            <EmptyState
                icon={searchQuery ? "🏜️" : "🔍"}
                title={searchQuery ? "No results found" : "Search your music"}
                description={searchQuery
                    ? `We couldn't find anything matching "${searchQuery}"`
                    : "Find songs, albums, and artists in your library"
                }
            />
        </View>
    );

    const renderResults = () => {
        if (!results) return renderEmptyState();

        const hasTracks = results.tracks.length > 0;
        const hasAlbums = results.albums.length > 0;
        const hasArtists = results.artists.length > 0;

        if (!hasTracks && !hasAlbums && !hasArtists) return renderEmptyState();

        return (
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Tracks Results */}
                {(filter === 'all' || filter === 'songs') && hasTracks && (
                    <View style={styles.section}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            Songs
                        </Text>
                        {results.tracks.map(track => (
                            <TrackListItem
                                key={track.id}
                                track={track}
                                isPlaying={currentTrack?.id === track.id}
                                onPress={handleTrackPress}
                            />
                        ))}
                    </View>
                )}

                {/* Albums Results */}
                {(filter === 'all' || filter === 'albums') && hasAlbums && (
                    <View style={styles.section}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            Albums
                        </Text>
                        <View style={styles.grid}>
                            {results.albums.map(album => (
                                <View key={album.id} style={styles.albumWrapper}>
                                    <AlbumCard
                                        album={album}
                                        size="small"
                                        onPress={handleAlbumPress}
                                    />
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Artists Results */}
                {(filter === 'all' || filter === 'artists') && hasArtists && (
                    <View style={styles.section}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            Artists
                        </Text>
                        <View style={styles.grid}>
                            {results.artists.map(artist => (
                                <View key={artist.id} style={styles.artistWrapper}>
                                    <ArtistCard
                                        artist={artist}
                                        size="small"
                                        onPress={handleArtistPress}
                                    />
                                </View>
                            ))}
                        </View>
                    </View>
                )}
            </ScrollView>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <Searchbar
                    placeholder="Search songs, artists, albums..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
                    inputStyle={{ color: theme.colors.onSurface }}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    iconColor={theme.colors.primary}
                />
            </View>

            {/* Quick Filters */}
            <View style={styles.chipContainer}>
                <Chip
                    mode="flat"
                    selected={filter === 'all'}
                    onPress={() => setFilter('all')}
                    style={[styles.chip, filter === 'all' && { backgroundColor: theme.colors.primaryContainer }]}
                    textStyle={{ color: filter === 'all' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                    showSelectedOverlay
                >
                    All
                </Chip>
                <Chip
                    mode="flat"
                    selected={filter === 'songs'}
                    onPress={() => setFilter('songs')}
                    style={[styles.chip, filter === 'songs' && { backgroundColor: theme.colors.primaryContainer }]}
                    textStyle={{ color: filter === 'songs' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                >
                    Songs
                </Chip>
                <Chip
                    mode="flat"
                    selected={filter === 'albums'}
                    onPress={() => setFilter('albums')}
                    style={[styles.chip, filter === 'albums' && { backgroundColor: theme.colors.primaryContainer }]}
                    textStyle={{ color: filter === 'albums' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                >
                    Albums
                </Chip>
                <Chip
                    mode="flat"
                    selected={filter === 'artists'}
                    onPress={() => setFilter('artists')}
                    style={[styles.chip, filter === 'artists' && { backgroundColor: theme.colors.primaryContainer }]}
                    textStyle={{ color: filter === 'artists' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                >
                    Artists
                </Chip>
            </View>

            {/* Results */}
            <View style={styles.content}>
                {renderResults()}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    searchContainer: {
        padding: 16,
        paddingBottom: 8,
    },
    searchbar: {
        borderRadius: 12,
        elevation: 0,
    },
    chipContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 8,
    },
    chip: {
        borderRadius: 20,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 120,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    section: {
        marginBottom: 24,
        paddingHorizontal: 8,
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginLeft: 8,
        marginBottom: 12,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    albumWrapper: {
        width: '50%',
        padding: 4,
    },
    artistWrapper: {
        width: '33.33%',
        padding: 4,
    },
});
