import { AlbumCard, ArtistCard, EmptyState, MemoizedTrackListItem, ScanButton } from '@/src/components/ui';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LibraryScreen() {
    const { theme } = useTheme();
    const [tab, setTab] = React.useState('songs');

    // Get track item height from theme for optimized layout
    const trackItemHeight = theme.components.trackItem.height;

    const {
        isScanning,
        scanProgress,
        getAllTracks,
        getAllAlbums,
        getAllArtists,
        scanLibrary,
    } = useLibraryStore();

    const { play, currentTrack } = usePlayerStore();

    const tracks = getAllTracks();
    const albums = getAllAlbums();
    const artists = getAllArtists();

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const handleAlbumPress = useCallback((album: Album) => {
        router.push({ pathname: '/album/[id]', params: { id: album.id } });
    }, []);

    const handleArtistPress = useCallback((artist: Artist) => {
        router.push({ pathname: '/artist/[id]', params: { id: artist.id } });
    }, []);

    // Optimized item layout using theme's track height
    const getItemLayout = useCallback((_: any, index: number) => ({
        length: trackItemHeight,
        offset: trackItemHeight * index,
        index,
    }), [trackItemHeight]);

    // Memoized render item function
    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <MemoizedTrackListItem
            track={item}
            index={index}
            isPlaying={currentTrack?.id === item.id}
            onPress={handleTrackPress}
        />
    ), [currentTrack?.id, handleTrackPress]);

    // Key extractor
    const keyExtractor = useCallback((item: Track) => item.id, []);

    const renderSongsTab = () => {
        if (tracks.length === 0) {
            return (
                <View style={styles.emptyContainer}>
                    <EmptyState
                        icon="🎵"
                        title="No songs yet"
                        description="Scan your device to find music files"
                    />
                    <ScanButton
                        isScanning={isScanning}
                        progress={scanProgress}
                        onScan={scanLibrary}
                    />
                </View>
            );
        }

        return (
            <FlatList
                data={tracks}
                keyExtractor={keyExtractor}
                renderItem={renderTrackItem}
                getItemLayout={getItemLayout}
                contentContainerStyle={styles.listContent}
                // Performance optimizations
                removeClippedSubviews={true}
                maxToRenderPerBatch={15}
                updateCellsBatchingPeriod={50}
                windowSize={10}
                initialNumToRender={15}
            />
        );
    };

    const renderAlbumsTab = () => {
        if (albums.length === 0) {
            return (
                <EmptyState
                    icon="💿"
                    title="No albums yet"
                    description="Albums will appear after scanning your music"
                    actionLabel="Scan Library"
                    onAction={scanLibrary}
                />
            );
        }

        return (
            <FlatList
                data={albums}
                keyExtractor={(item) => item.id}
                numColumns={2}
                renderItem={({ item }) => (
                    <View style={styles.albumWrapper}>
                        <AlbumCard
                            album={item}
                            size="medium"
                            onPress={handleAlbumPress}
                        />
                    </View>
                )}
                contentContainerStyle={styles.gridContent}
            />
        );
    };

    const renderArtistsTab = () => {
        if (artists.length === 0) {
            return (
                <EmptyState
                    icon="🎤"
                    title="No artists yet"
                    description="Artists will appear after scanning your music"
                    actionLabel="Scan Library"
                    onAction={scanLibrary}
                />
            );
        }

        return (
            <FlatList
                data={artists}
                keyExtractor={(item) => item.id}
                numColumns={3}
                renderItem={({ item }) => (
                    <View style={styles.artistWrapper}>
                        <ArtistCard
                            artist={item}
                            size="small"
                            onPress={handleArtistPress}
                        />
                    </View>
                )}
                contentContainerStyle={styles.gridContent}
            />
        );
    };

    const renderPlaylistsTab = () => {
        return (
            <EmptyState
                icon="📋"
                title="No playlists yet"
                description="Create your first playlist to get started"
                actionLabel="Create Playlist"
                onAction={() => {
                    // TODO: Create playlist modal
                    console.log('Create playlist');
                }}
            />
        );
    };

    const renderContent = () => {
        switch (tab) {
            case 'songs':
                return renderSongsTab();
            case 'albums':
                return renderAlbumsTab();
            case 'artists':
                return renderArtistsTab();
            case 'playlists':
                return renderPlaylistsTab();
            default:
                return null;
        }
    };

    return (
        <SafeAreaView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            edges={['top']}
        >
            {/* Header */}
            <View style={styles.header}>
                <Text
                    variant="headlineMedium"
                    style={[styles.title, { color: theme.colors.onBackground }]}
                >
                    Library
                </Text>
            </View>

            {/* Segment Control */}
            <View style={styles.segmentContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <SegmentedButtons
                        value={tab}
                        onValueChange={setTab}
                        buttons={[
                            { value: 'songs', label: 'Songs' },
                            { value: 'albums', label: 'Albums' },
                            { value: 'artists', label: 'Artists' },
                            { value: 'playlists', label: 'Playlists' },
                        ]}
                        style={styles.segmentedButtons}
                    />
                </ScrollView>
            </View>

            {/* Content */}
            <View style={styles.content}>
                {renderContent()}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
    },
    title: {
        fontWeight: 'bold',
    },
    segmentContainer: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    segmentedButtons: {
        // Styled by Paper theme
    },
    content: {
        flex: 1,
    },
    emptyContainer: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 8,
        paddingBottom: 120,
    },
    gridContent: {
        padding: 16,
        paddingBottom: 120,
    },
    albumWrapper: {
        flex: 1,
        padding: 8,
        maxWidth: '50%',
    },
    artistWrapper: {
        flex: 1,
        padding: 8,
        alignItems: 'center',
    },
});
