import { MemoizedTrackListItem } from '@/src/components/ui';
import { useDynamicColors } from '@/src/hooks';
import { formatDuration } from '@/src/services';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Dimensions, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_HEIGHT = 300;
const ARTWORK_SIZE = 200;
const HERO_TOP_OFFSET = 56;
const BACK_BUTTON_TOP_OFFSET = 10;
const CONTENT_TOP_GAP = 24;

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<Track>);

export default function AlbumDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    const getAlbumById = useLibraryStore(state => state.getAlbumById);
    const getTracksByAlbum = useLibraryStore(state => state.getTracksByAlbum);
    const getAllPlaylists = useLibraryStore(state => state.getAllPlaylists);
    const createPlaylist = useLibraryStore(state => state.createPlaylist);
    const addToPlaylist = useLibraryStore(state => state.addToPlaylist);
    const play = usePlayerStore(state => state.play);
    const addToQueue = usePlayerStore(state => state.addToQueue);
    const toggleShuffle = usePlayerStore(state => state.toggleShuffle);
    const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
    const currentTrackId = usePlayerStore(state => state.currentTrack?.id);

    const album = getAlbumById(id);
    const tracks = useMemo(() => getTracksByAlbum(id), [id, getTracksByAlbum]);

    // Extract dynamic colors from metadata artwork
    const { colors: albumColors } = useDynamicColors(album?.artwork);

    const totalDuration = useMemo(() => {
        return tracks.reduce((acc, track) => acc + track.duration, 0);
    }, [tracks]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const headerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT - 100], [1, 0]),
        transform: [
            { translateY: interpolate(scrollY.value, [0, HEADER_HEIGHT], [0, -HEADER_HEIGHT / 2]) },
            { scale: interpolate(scrollY.value, [-100, 0], [1.2, 1], 'clamp') },
        ],
    }));

    const artworkStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(scrollY.value, [-100, 0, 100], [1.3, 1, 0.9], 'clamp') },
        ],
        opacity: interpolate(scrollY.value, [0, 150], [1, 0.5]),
    }));

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const handleAddToQueue = useCallback((track: Track) => {
        openTrackActionsMenu({
            track,
            playlists: getAllPlaylists(),
            addToQueue,
            addToPlaylist,
            createPlaylist,
        });
    }, [addToPlaylist, addToQueue, createPlaylist, getAllPlaylists]);

    const handlePlayAll = useCallback(() => {
        if (tracks.length > 0) {
            play(tracks[0], tracks);
        }
    }, [tracks, play]);

    const handleShuffle = useCallback(() => {
        if (tracks.length > 0) {
            if (!shuffleEnabled) toggleShuffle();
            const randomIndex = Math.floor(Math.random() * tracks.length);
            play(tracks[randomIndex], tracks);
        }
    }, [tracks, play, toggleShuffle, shuffleEnabled]);

    const keyExtractor = useCallback((item: Track) => item.id, []);

    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <MemoizedTrackListItem
            track={item}
            index={index}
            showIndex={true}
            showArtwork={false}
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
            onOptionsPress={handleAddToQueue}
        />
    ), [currentTrackId, handleTrackPress, handleAddToQueue]);

    // Early return MUST happen after all hooks but before any callbacks defined with useCallback
    // The issue is that FlatList's ListHeaderComponent needs a stable reference

    // Memoized ListHeader to avoid recreation on each render
    const ListHeader = useMemo(() => {
        if (!album) return null;

        return (
            <View style={styles.headerContent}>
                {/* Album Info */}
                <View style={styles.albumInfo}>
                    <Text
                        variant="headlineMedium"
                        style={[styles.albumTitle, { color: albumColors.text }]}
                        numberOfLines={2}
                    >
                        {album.name}
                    </Text>
                    <Text
                        variant="titleMedium"
                        style={{ color: albumColors.primary, marginBottom: 4 }}
                    >
                        {album.artist}
                    </Text>
                    <Text
                        variant="bodySmall"
                        style={{ color: albumColors.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }}
                    >
                        {tracks.length} songs • {formatDuration(totalDuration)}
                    </Text>
                </View>

                {/* Action Buttons */}
                <View style={styles.actions}>
                    <IconButton
                        icon="play"
                        mode="contained"
                        size={56}
                        iconColor={albumColors.isDark ? '#000000' : '#FFFFFF'}
                        containerColor={albumColors.primary}
                        onPress={handlePlayAll}
                        style={{ margin: 0 }}
                    />
                    <IconButton
                        icon="shuffle"
                        mode="contained-tonal"
                        size={32}
                        iconColor={albumColors.primary}
                        containerColor={albumColors.primary + '20'}
                        onPress={handleShuffle}
                    />
                    <IconButton
                        icon="heart-outline"
                        mode="contained-tonal"
                        size={32}
                        iconColor={albumColors.text}
                        containerColor={albumColors.text + '20'}
                        onPress={() => { }}
                    />
                    <IconButton
                        icon="dots-vertical"
                        mode="contained-tonal"
                        size={32}
                        iconColor={albumColors.text}
                        containerColor={albumColors.text + '20'}
                        onPress={() => { }}
                    />
                </View>

                {/* Track list header */}
                <Text
                    variant="titleSmall"
                    style={[styles.trackListTitle, { color: albumColors.text, opacity: 0.6 }]}
                >
                    TRACKS
                </Text>
            </View>
        );
    }, [album, albumColors, tracks.length, totalDuration, handlePlayAll, handleShuffle]);

    if (!album) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Album not found</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: albumColors.background }]}>
            <StatusBar barStyle={albumColors.isDark ? 'light-content' : 'dark-content'} />
            {/* Blurred Background */}
            <Animated.View style={[StyleSheet.absoluteFill, headerStyle]}>
                {album.artwork ? (
                    <>
                        <Image source={{ uri: album.artwork }} style={styles.backgroundImage} blurRadius={30} />
                        <LinearGradient
                            colors={[albumColors.background + '80', albumColors.background]}
                            style={styles.gradient}
                        />
                    </>
                ) : (
                    <LinearGradient
                        colors={[theme.colors.primaryContainer, theme.colors.background]}
                        style={StyleSheet.absoluteFill}
                    />
                )}
            </Animated.View>

            {/* Artwork */}
            <Animated.View style={[styles.artworkContainer, { paddingTop: insets.top + HERO_TOP_OFFSET }, artworkStyle]}>
                <View style={[styles.artwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                    {album.artwork ? (
                        <Image source={{ uri: album.artwork }} style={styles.artworkImage} />
                    ) : (
                        <Text style={{ fontSize: 80 }}>💿</Text>
                    )}
                </View>
            </Animated.View>

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + BACK_BUTTON_TOP_OFFSET }]}>
                <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
                    <IconButton
                        icon="arrow-left"
                        size={24}
                        iconColor={theme.colors.onBackground}
                        onPress={() => router.back()}
                    />
                </BlurView>
            </View>

            {/* Track List */}
            <AnimatedFlashList
                data={tracks}
                keyExtractor={keyExtractor}
                renderItem={renderTrackItem}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                ListHeaderComponent={ListHeader}
                contentContainerStyle={[
                    styles.listContent,
                    { paddingTop: HEADER_HEIGHT + CONTENT_TOP_GAP }
                ]}
                showsVerticalScrollIndicator={false}
                drawDistance={300}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    backgroundImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: HEADER_HEIGHT + 100,
    },
    gradient: {
        ...StyleSheet.absoluteFillObject,
        height: HEADER_HEIGHT + 100,
    },
    artworkContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    artwork: {
        width: ARTWORK_SIZE,
        height: ARTWORK_SIZE,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        elevation: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
    },
    blurButton: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    listContent: {
        paddingBottom: 120,
    },
    headerContent: {
        paddingHorizontal: 24,
        paddingTop: 16,
    },
    albumInfo: {
        alignItems: 'center',
        marginBottom: 24,
    },
    albumTitle: {
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 4,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        marginBottom: 32,
    },
    trackListTitle: {
        letterSpacing: 1,
        marginBottom: 8,
        marginLeft: 8,
    },
});
