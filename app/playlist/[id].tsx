/**
 * Playlist Detail Screen - Shows playlist info with track list
 */

import { CustomIcon, MemoizedTrackListItem } from '@/src/components/ui';
import { formatDuration } from '@/src/services';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Button, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HEADER_HEIGHT = 200;
const PLAYLIST_COVERS_DIR = `${FileSystem.documentDirectory}playlist_covers/`;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<Track>);

export default function PlaylistDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    const { getPlaylist, getPlaylistTracks, getAllPlaylists, addToPlaylist, createPlaylist, updatePlaylist, deleteTrack } = useLibraryStore();
    const play = usePlayerStore(state => state.play);
    const addToQueue = usePlayerStore(state => state.addToQueue);
    const toggleShuffle = usePlayerStore(state => state.toggleShuffle);
    const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
    const currentTrackId = usePlayerStore(state => state.currentTrack?.id);
    const [editDialogVisible, setEditDialogVisible] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editArtwork, setEditArtwork] = useState('');

    const isLocalPlaylistCover = useCallback((uri?: string) => {
        return !!uri && uri.startsWith(PLAYLIST_COVERS_DIR);
    }, []);

    const deleteLocalPlaylistCover = useCallback(async (uri?: string) => {
        if (!uri || !isLocalPlaylistCover(uri)) return;
        await FileSystem.deleteAsync(uri, { idempotent: true });
    }, [isLocalPlaylistCover]);

    const savePlaylistCoverLocally = useCallback(async (sourceUri: string) => {
        const dirInfo = await FileSystem.getInfoAsync(PLAYLIST_COVERS_DIR);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(PLAYLIST_COVERS_DIR, { intermediates: true });
        }

        const uriWithoutQuery = sourceUri.split('?')[0] ?? sourceUri;
        const extMatch = uriWithoutQuery.match(/\.([a-zA-Z0-9]+)$/);
        const extension = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const safeExt = extension.length <= 5 ? extension : 'jpg';
        const fileName = `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
        const destinationUri = `${PLAYLIST_COVERS_DIR}${fileName}`;

        await FileSystem.copyAsync({
            from: sourceUri,
            to: destinationUri,
        });

        return destinationUri;
    }, []);

    const handlePickPlaylistImage = useCallback(async () => {
        let ImagePicker: typeof import('expo-image-picker');

        try {
            ImagePicker = await import('expo-image-picker');
        } catch (error) {
            console.error('[Playlist] expo-image-picker module unavailable:', error);
            Alert.alert(
                'Gallery unavailable',
                'This build does not include image picker yet. Rebuild the app/dev client and try again.'
            );
            return;
        }

        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert('Permission needed', 'Allow gallery access to pick a playlist cover.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85,
            });

            if (!result.canceled && result.assets[0]?.uri) {
                try {
                    await deleteLocalPlaylistCover(editArtwork);
                    const localUri = await savePlaylistCoverLocally(result.assets[0].uri);
                    setEditArtwork(localUri);
                } catch (error) {
                    console.error('[Playlist] Failed to save selected cover locally:', error);
                    Alert.alert('Error', 'Could not save the selected image locally.');
                }
            }
        } catch (error) {
            console.error('[Playlist] Native image picker unavailable:', error);
            Alert.alert(
                'Gallery unavailable',
                'Native module not found. Rebuild the app/dev client to enable gallery picker.'
            );
        }
    }, [deleteLocalPlaylistCover, editArtwork, savePlaylistCoverLocally]);

    const handleRemovePlaylistImage = useCallback(async () => {
        try {
            await deleteLocalPlaylistCover(editArtwork);
            setEditArtwork('');
        } catch (error) {
            console.error('[Playlist] Failed to remove local cover:', error);
            Alert.alert('Error', 'Could not remove the playlist image.');
        }
    }, [deleteLocalPlaylistCover, editArtwork]);

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

    const handleAddToQueue = useCallback((track: Track) => {
        openTrackActionsMenu({
            track,
            playlists: getAllPlaylists(),
            addToQueue,
            addToPlaylist,
            createPlaylist,
            deleteTrack,
        });
    }, [addToPlaylist, addToQueue, createPlaylist, deleteTrack, getAllPlaylists]);

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
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
            onOptionsPress={handleAddToQueue}
        />
    ), [currentTrackId, handleTrackPress, handleAddToQueue]);

    const ListHeader = useMemo(() => {
        if (!playlist) return null;

        return (
            <View style={styles.headerContent}>
                <View style={styles.playlistInfo}>
                    <View style={[styles.playlistIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                        {playlist.artwork ? (
                            <Image
                                source={{ uri: playlist.artwork }}
                                style={styles.playlistIconImage}
                                contentFit="cover"
                                transition={120}
                            />
                        ) : (
                            <CustomIcon
                                name={playlist.id === 'playlist_liked' ? 'Play' : 'Playlist'}
                                size={64}
                                color={theme.colors.onPrimaryContainer}
                            />
                        )}
                    </View>
                    <Text
                        variant="headlineSmall"
                        style={[styles.playlistTitle, { color: theme.colors.onBackground }]}
                        numberOfLines={2}
                    >
                        {playlist.name}
                    </Text>
                    {playlist.description ? (
                        <Text
                            variant="bodyMedium"
                            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 8 }}
                            numberOfLines={2}
                        >
                            {playlist.description}
                        </Text>
                    ) : null}
                    <Text
                        variant="bodySmall"
                        style={{ color: theme.colors.onSurfaceVariant }}
                    >
                        {tracks.length} songs • {formatDuration(totalDuration)}
                    </Text>
                </View>

                <View style={styles.actions}>
                    <IconButton
                        icon={() => <CustomIcon name="Play" size={32} color={theme.colors.onPrimary} />}
                        mode="contained"
                        size={56}
                        containerColor={theme.colors.primary}
                        onPress={handlePlayAll}
                    />
                    <IconButton
                        icon={() => <CustomIcon name="Shuffle" size={24} color={theme.colors.primary} />}
                        mode="contained-tonal"
                        size={32}
                        onPress={handleShuffle}
                    />
                    <IconButton
                        icon={() => <CustomIcon name="Ajustes" size={20} color={theme.colors.onSurfaceVariant} />}
                        mode="contained-tonal"
                        size={32}
                        onPress={() => {
                            setEditName(playlist.name);
                            setEditDescription(playlist.description ?? '');
                            setEditArtwork(playlist.artwork ?? '');
                            setEditDialogVisible(true);
                        }}
                    />
                </View>
            </View>
        );
    }, [
        handlePlayAll,
        handleShuffle,
        playlist?.description,
        playlist?.artwork,
        playlist?.name,
        theme.colors.onBackground,
        theme.colors.onPrimary,
        theme.colors.onSurfaceVariant,
        theme.colors.primary,
        theme.colors.primaryContainer,
        totalDuration,
        tracks.length,
    ]);

    if (!playlist) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Playlist not found</Text>
            </View>
        );
    }

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
                        icon={() => <CustomIcon name="Previous" size={24} color={theme.colors.onBackground} />}
                        size={24}
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

            <Portal>
                <Dialog visible={editDialogVisible} onDismiss={() => setEditDialogVisible(false)}>
                    <Dialog.Title>Edit playlist</Dialog.Title>
                    <Dialog.Content>
                        <TextInput
                            label="Name"
                            mode="outlined"
                            value={editName}
                            onChangeText={setEditName}
                            style={styles.dialogInput}
                        />
                        <TextInput
                            label="Description"
                            mode="outlined"
                            value={editDescription}
                            onChangeText={setEditDescription}
                            multiline
                            numberOfLines={3}
                            style={styles.dialogInput}
                        />
                        <View style={styles.coverEditor}>
                            <View style={[styles.coverPreview, { backgroundColor: theme.colors.surfaceVariant }]}>
                                {editArtwork ? (
                                    <Image source={{ uri: editArtwork }} style={styles.coverPreviewImage} contentFit="cover" />
                                ) : (
                                    <Text style={{ fontSize: 28 }}>🎶</Text>
                                )}
                            </View>
                            <View style={styles.coverActions}>
                                <Button mode="contained-tonal" icon="image" onPress={handlePickPlaylistImage}>
                                    Select from gallery
                                </Button>
                                {editArtwork ? (
                                    <Button mode="text" icon="trash-can-outline" onPress={handleRemovePlaylistImage}>
                                        Remove image
                                    </Button>
                                ) : null}
                            </View>
                        </View>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setEditDialogVisible(false)}>Cancel</Button>
                        <Button
                            onPress={() => {
                                if (!playlist) return;
                                const trimmedName = editName.trim();
                                if (!trimmedName) return;
                                updatePlaylist(playlist.id, {
                                    name: trimmedName,
                                    description: editDescription,
                                    artwork: editArtwork,
                                });
                                setEditDialogVisible(false);
                            }}
                            disabled={!editName.trim()}
                        >
                            Save
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
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
        overflow: 'hidden',
    },
    playlistIconImage: {
        width: '100%',
        height: '100%',
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
    dialogInput: {
        marginBottom: 10,
    },
    coverEditor: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    coverPreview: {
        width: 72,
        height: 72,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    coverPreviewImage: {
        width: '100%',
        height: '100%',
    },
    coverActions: {
        flex: 1,
        gap: 4,
    },
});
