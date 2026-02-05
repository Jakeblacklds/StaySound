/**
 * Playlist Detail Screen - Shows playlist info with track list
 */

import { MemoizedTrackListItem } from '@/src/components/ui';
import { formatDuration } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Dimensions, FlatList, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeInDown, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_HEIGHT = 200;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<Track>);

export default function PlaylistDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    const { getPlaylist, getPlaylistTracks } = useLibraryStore();
    const { play, currentTrack } = usePlayerStore();

    const playlist = getPlaylist(id);
    const tracks = useMemo(() => getPlaylistTracks(id), [id, getPlaylistTracks]);

    const totalDuration = useMemo(() => {
        return tracks.reduce((acc, track) => acc + track.duration, 0);
    }, [tracks]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const headerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, HEADER_HEIGHT - 50], [1, 0]),
    }));

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const handlePlayAll = useCallback(() => {
        if (tracks.length > 0) {
            play(tracks[0], tracks);
        }
    }, [tracks, play]);

    const handleShuffle = useCallback(() => {
        if (tracks.length > 0) {
            const randomIndex = Math.floor(Math.random() * tracks.length);
            play(tracks[randomIndex], tracks);
        }
    }, [tracks, play]);

    const keyExtractor = useCallback((item: Track) => item.id, []);

    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <Animated.View entering={FadeInDown.delay(index * 40).springify()}>
            <MemoizedTrackListItem
                track={item}
                index={index}
                showIndex={true}
                isPlaying={currentTrack?.id === item.id}
                onPress={handleTrackPress}
            />
        </Animated.View>
    ), [currentTrack?.id, handleTrackPress]);

    if (!playlist) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Playlist not found</Text>
            </View>
        );
    }

    const ListHeader = () => (
        <View style={styles.headerContent}>
            {/* Playlist Info */}
            <Animated.View entering={FadeIn.delay(200)} style={styles.playlistInfo}>
                <View style={[styles.playlistIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                    <Text style={{ fontSize: 48 }}>🎶</Text>
                </View>
                <Text
                    variant="headlineSmall"
                    style={[styles.playlistTitle, { color: theme.colors.onBackground }]}
                    numberOfLines={2}
                >
                    {playlist.name}
                </Text>
                {playlist.description && (
                    <Text
                        variant="bodyMedium"
                        style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 8 }}
                        numberOfLines={2}
                    >
                        {playlist.description}
                    </Text>
                )}
                <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                >
                    {tracks.length} songs • {formatDuration(totalDuration)}
                </Text>
            </Animated.View>

            {/* Action Buttons */}
            <Animated.View entering={FadeIn.delay(300)} style={styles.actions}>
                <IconButton
                    icon="play-circle"
                    mode="contained"
                    size={56}
                    iconColor={theme.colors.onPrimary}
                    containerColor={theme.colors.primary}
                    onPress={handlePlayAll}
                />
                <IconButton
                    icon="shuffle"
                    mode="contained-tonal"
                    size={32}
                    iconColor={theme.colors.primary}
                    onPress={handleShuffle}
                />
                <IconButton
                    icon="pencil"
                    mode="contained-tonal"
                    size={32}
                    iconColor={theme.colors.onSurfaceVariant}
                    onPress={() => { }}
                />
            </Animated.View>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Gradient Background */}
            <Animated.View style={[styles.gradientContainer, headerStyle]}>
                <LinearGradient
                    colors={[theme.colors.primary + '30', theme.colors.background]}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + 8 }]}>
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
            <AnimatedFlatList
                data={tracks}
                keyExtractor={keyExtractor}
                renderItem={renderTrackItem}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                ListHeaderComponent={ListHeader}
                contentContainerStyle={[
                    styles.listContent,
                    { paddingTop: insets.top + 60 }
                ]}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    gradientContainer: {
        ...StyleSheet.absoluteFillObject,
        height: HEADER_HEIGHT + 100,
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
        alignItems: 'center',
    },
    playlistInfo: {
        alignItems: 'center',
        marginBottom: 24,
    },
    playlistIcon: {
        width: 120,
        height: 120,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    playlistTitle: {
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
});
