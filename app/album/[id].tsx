import { CustomIcon, MemoizedTrackListItem } from '@/src/components/ui';
import { useDynamicColors } from '@/src/hooks';
import { formatDuration } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HEADER_HEIGHT = 300;
const ARTWORK_SIZE = 224;
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
    const play = usePlayerStore(state => state.play);
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

    const keyExtractor = useCallback((item: Track) => item.id, []);

    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <MemoizedTrackListItem
            track={item}
            index={index}
            showIndex={true}
            showArtwork={false}
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
        />
    ), [currentTrackId, handleTrackPress]);

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
                        variant="labelMedium"
                        style={[styles.albumKicker, { color: albumColors.isDark ? 'rgba(255,255,255,0.56)' : 'rgba(0,0,0,0.44)' }]}
                    >
                        ALBUM
                    </Text>
                    <Text
                        variant="headlineMedium"
                        style={[styles.albumTitle, { color: albumColors.text }]}
                        numberOfLines={2}
                    >
                        {album.name}
                    </Text>
                    <Text
                        variant="titleMedium"
                        style={[styles.albumArtist, { color: albumColors.primary }]}
                    >
                        {album.artist}
                    </Text>
                    <Text
                        variant="bodySmall"
                        style={[styles.albumMeta, { color: albumColors.isDark ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.56)' }]}
                    >
                        {tracks.length} songs • {formatDuration(totalDuration)}
                    </Text>
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
    }, [album, albumColors, tracks.length, totalDuration]);

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
            <Animated.View style={[styles.artworkContainer, { paddingTop: insets.top + HERO_TOP_OFFSET, paddingHorizontal: 24 }, artworkStyle]}>
                <View style={[styles.artwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                    {album.artwork ? (
                        <Image source={{ uri: album.artwork }} style={styles.artworkImage} />
                    ) : (
                        <CustomIcon name="Album" size={100} color={theme.colors.onSurfaceVariant} />
                    )}
                </View>
            </Animated.View>

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + BACK_BUTTON_TOP_OFFSET }]}>
                <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
                    <IconButton
                        icon={() => <CustomIcon name="Previous" size={24} color={theme.colors.onBackground} />}
                        size={24}
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
        alignItems: 'flex-start',
        zIndex: 10,
    },
    artwork: {
        width: ARTWORK_SIZE,
        height: ARTWORK_SIZE,
        borderRadius: 26,
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
        paddingTop: 18,
    },
    albumInfo: {
        alignItems: 'flex-start',
        marginBottom: 26,
    },
    albumKicker: {
        letterSpacing: 1.4,
        marginBottom: 8,
    },
    albumTitle: {
        fontWeight: 'bold',
        textAlign: 'left',
        marginBottom: 6,
        letterSpacing: -0.9,
    },
    albumArtist: {
        marginBottom: 6,
    },
    albumMeta: {
        marginTop: 2,
    },
    trackListTitle: {
        letterSpacing: 1.2,
        marginBottom: 10,
        marginLeft: 0,
    },
});
