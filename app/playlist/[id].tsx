/**
 * Playlist Detail Screen - Shows playlist info with track list
 */

import { CustomIcon, MemoizedTrackListItem } from '@/src/components/ui';
import { TidalAtmosphere } from '@/src/components/tidal';
import { useTidalDownload } from '@/src/hooks';
import { formatDuration } from '@/src/services';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import {
  playResolvedRemoteTrack,
  resolveRemoteTrackForDownload,
} from '@/src/services/remotePlaybackService';
import { isSpotifyRemoteTrack } from '@/src/services/spotifyChartsService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Animated as RNAnimated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Dialog,
  IconButton,
  Portal,
  Searchbar,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';
import Animated, {
  FadeIn,
  LinearTransition,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DETAIL_HEIGHT } from '@/src/components/player/playerLayout';

const HEADER_HEIGHT = 200;
const PLAYLIST_COVERS_DIR = `${FileSystem.documentDirectory}playlist_covers/`;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<Track>);

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);

  const tracksMap = useLibraryStore(state => state.tracks);
  const getPlaylist = useLibraryStore(state => state.getPlaylist);
  const getPlaylistTracks = useLibraryStore(state => state.getPlaylistTracks);
  const getAllPlaylists = useLibraryStore(state => state.getAllPlaylists);
  const addToPlaylist = useLibraryStore(state => state.addToPlaylist);
  const removeFromPlaylist = useLibraryStore(state => state.removeFromPlaylist);
  const createPlaylist = useLibraryStore(state => state.createPlaylist);
  const updatePlaylist = useLibraryStore(state => state.updatePlaylist);
  const deleteTrack = useLibraryStore(state => state.deleteTrack);

  const play = usePlayerStore(state => state.play);
  const addToQueue = usePlayerStore(state => state.addToQueue);
  const toggleShuffle = usePlayerStore(state => state.toggleShuffle);
  const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
  const currentTrack = usePlayerStore(state => state.currentTrack);
  const currentTrackId = currentTrack?.id;

  const { download, downloads } = useTidalDownload();

  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editArtwork, setEditArtwork] = useState('');
  const [busyRemoteTrackIds, setBusyRemoteTrackIds] = useState<string[]>([]);
  const [addSongsOpen, setAddSongsOpen] = useState(false);
  const [addSongsSearch, setAddSongsSearch] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarText, setSnackbarText] = useState('');
  const [recentlyUpdatedTrackId, setRecentlyUpdatedTrackId] = useState<string | null>(null);
  const feedbackAnim = useMemo(() => new RNAnimated.Value(0), []);

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
  const tracks = useMemo(() => getPlaylistTracks(id), [getPlaylistTracks, id]);
  const playableTracks = useMemo(
    () => tracks.filter(track => !track.cloudOnly || Boolean(track.spotifyId || track.tidalId)),
    [tracks]
  );
  const totalDuration = useMemo(
    () => tracks.reduce((acc, track) => acc + track.duration, 0),
    [tracks]
  );
  const selectedTrackIds = useMemo(
    () => new Set(playlist?.trackIds ?? []),
    [playlist?.trackIds]
  );
  const libraryTracks = useMemo(
    () =>
      Array.from(tracksMap.values())
        .filter(track => !track.cloudOnly)
        .sort((a, b) => b.dateAdded - a.dateAdded),
    [tracksMap]
  );
  const filteredLibraryTracks = useMemo(() => {
    const normalized = addSongsSearch.trim().toLowerCase();
    if (!normalized) return libraryTracks;

    return libraryTracks.filter(track => {
      const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [addSongsSearch, libraryTracks]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: event => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const showSnackbar = useCallback((message: string) => {
    setSnackbarText(message);
    setSnackbarVisible(true);
  }, []);

  const handleCloudTrackPlay = useCallback(async (track: Track, queue?: Track[]) => {
    await playResolvedRemoteTrack(track, queue);
  }, []);

  const handleCloudTrackDownload = useCallback(async (track: Track) => {
    const busyKey = track.spotifyId ?? String(track.tidalId ?? track.id);
    setBusyRemoteTrackIds(current => (current.includes(busyKey) ? current : [...current, busyKey]));

    try {
      const tidalTrack = await resolveRemoteTrackForDownload(track);
      await download(tidalTrack);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo descargar la cancion.');
    } finally {
      setBusyRemoteTrackIds(current => current.filter(currentId => currentId !== busyKey));
    }
  }, [download]);

  const handleTrackPress = useCallback((track: Track) => {
    if (track.cloudOnly) {
      void handleCloudTrackPlay(track);
      return;
    }

    play(track, playableTracks);
  }, [handleCloudTrackPlay, play, playableTracks]);

  const handlePlayAll = useCallback(() => {
    if (playableTracks.length > 0) {
      const firstTrack = playableTracks[0];
      if (firstTrack.cloudOnly) {
        void handleCloudTrackPlay(firstTrack, playableTracks);
        return;
      }

      play(firstTrack, playableTracks);
    }
  }, [handleCloudTrackPlay, play, playableTracks]);

  const handleAddToQueue = useCallback((track: Track) => {
    if (track.cloudOnly) {
      void handleCloudTrackDownload(track);
      return;
    }

    openTrackActionsMenu({
      track,
      playlists: getAllPlaylists(),
      addToQueue,
      addToPlaylist,
      createPlaylist,
      deleteTrack,
    });
  }, [addToPlaylist, addToQueue, createPlaylist, deleteTrack, getAllPlaylists, handleCloudTrackDownload]);

  const handleShuffle = useCallback(() => {
    if (playableTracks.length > 0) {
      if (!shuffleEnabled) toggleShuffle();
      const randomIndex = Math.floor(Math.random() * playableTracks.length);
      const targetTrack = playableTracks[randomIndex];
      if (targetTrack.cloudOnly) {
        void handleCloudTrackPlay(targetTrack, playableTracks);
        return;
      }

      play(targetTrack, playableTracks);
    }
  }, [handleCloudTrackPlay, play, playableTracks, shuffleEnabled, toggleShuffle]);

  const handleLibraryTrackPress = useCallback((track: Track) => {
    const queue = filteredLibraryTracks.length > 0 ? filteredLibraryTracks : libraryTracks;
    play(track, queue);
  }, [filteredLibraryTracks, libraryTracks, play]);

  const handleToggleTrackInPlaylist = useCallback((track: Track) => {
    if (!playlist || playlist.readonly) return;

    const isAdded = selectedTrackIds.has(track.id);
    if (isAdded) {
      removeFromPlaylist(playlist.id, track.id);
      showSnackbar(`Quitaste ${track.title}`);
    } else {
      addToPlaylist(playlist.id, track.id);
      showSnackbar(`Agregaste ${track.title}`);
    }

    setRecentlyUpdatedTrackId(track.id);
    RNAnimated.sequence([
      RNAnimated.timing(feedbackAnim, {
        toValue: 1,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      RNAnimated.timing(feedbackAnim, {
        toValue: 0,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setRecentlyUpdatedTrackId(null));
  }, [addToPlaylist, feedbackAnim, playlist, removeFromPlaylist, selectedTrackIds, showSnackbar]);

  const keyExtractor = useCallback((item: Track) => item.id, []);

  const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => {
    const downloadState = item.tidalId ? downloads.get(item.tidalId) : undefined;
    const isBusy = downloadState?.status === 'downloading'
      || busyRemoteTrackIds.includes(item.spotifyId ?? String(item.tidalId ?? item.id));
    const progressLabel = downloadState?.status === 'downloading'
      ? `${Math.round((downloadState.progress ?? 0) * 100)}%`
      : undefined;
    const isSpotifyTrack = isSpotifyRemoteTrack(item);
    const isResolvedTidalTrack = Boolean(
      item.tidalId
      && currentTrack?.tidalId
      && item.tidalId === currentTrack.tidalId
    );
    const isCurrentResolvedSpotifyTrack = Boolean(
      isSpotifyTrack
      && item.spotifyId
      && currentTrack?.spotifyId
      && item.spotifyId === currentTrack.spotifyId
    );

    return (
      <MemoizedTrackListItem
        track={item}
        index={index}
        showIndex={true}
        isPlaying={currentTrackId === item.id || isCurrentResolvedSpotifyTrack || isResolvedTidalTrack}
        onPress={handleTrackPress}
        onOptionsPress={handleAddToQueue}
        optionsIcon={item.cloudOnly ? 'Descargar' : 'Cola'}
        optionsIconColor={item.cloudOnly ? theme.colors.primary : undefined}
        optionsBusy={item.cloudOnly && isBusy}
        optionsLabel={item.cloudOnly ? progressLabel ?? (isBusy ? '...' : undefined) : undefined}
      />
    );
  }, [busyRemoteTrackIds, currentTrack, currentTrackId, downloads, handleAddToQueue, handleTrackPress, theme.colors.primary]);

  const renderLibraryTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => {
    const isAdded = selectedTrackIds.has(item.id);
    const isRecentlyUpdated = recentlyUpdatedTrackId === item.id;

    return (
      <RNAnimated.View
        style={isRecentlyUpdated ? {
          transform: [{
            scale: feedbackAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.985],
            }),
          }],
          opacity: feedbackAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.85],
          }),
        } : undefined}
      >
        <MemoizedTrackListItem
          track={item}
          index={index}
          isPlaying={currentTrackId === item.id}
          onPress={handleLibraryTrackPress}
          onOptionsPress={handleToggleTrackInPlaylist}
          optionsIcon={isAdded ? 'Play' : 'Playlist'}
          optionsIconColor={isAdded ? theme.colors.primary : theme.colors.onSurfaceVariant}
        />
      </RNAnimated.View>
    );
  }, [currentTrackId, feedbackAnim, handleLibraryTrackPress, handleToggleTrackInPlaylist, recentlyUpdatedTrackId, selectedTrackIds, theme.colors.onSurfaceVariant, theme.colors.primary]);

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
            variant="headlineMedium"
            style={[styles.playlistTitle, { color: theme.colors.onBackground }]}
            numberOfLines={2}
          >
            {playlist.name}
          </Text>

          {playlist.description ? (
            <Text
              variant="bodyMedium"
              style={[styles.playlistDescription, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={2}
            >
              {playlist.description}
            </Text>
          ) : null}

          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {tracks.length} songs • {formatDuration(totalDuration)}
          </Text>
        </View>

        <View style={styles.actions}>
          <IconButton
            icon={() => <CustomIcon name="Play" size={32} color={theme.colors.onPrimary} />}
            mode="contained"
            size={64}
            containerColor={theme.colors.primary}
            onPress={handlePlayAll}
            disabled={playableTracks.length === 0}
          />
          <IconButton
            icon={() => <CustomIcon name="Shuffle" size={24} color={theme.colors.primary} />}
            mode="contained-tonal"
            size={32}
            onPress={handleShuffle}
            disabled={playableTracks.length === 0}
          />
          <IconButton
            icon={() => <CustomIcon name="Ajustes" size={20} color={theme.colors.onSurfaceVariant} />}
            mode="contained-tonal"
            size={32}
            disabled={playlist.readonly}
            onPress={() => {
              setEditName(playlist.name);
              setEditDescription(playlist.description ?? '');
              setEditArtwork(playlist.artwork ?? '');
              setEditDialogVisible(true);
            }}
          />
        </View>

        {!playlist.readonly ? (
          <Animated.View entering={FadeIn.duration(180)} layout={LinearTransition.springify().damping(22).stiffness(180)}>
            {/* Thin separator above the add-songs row */}
            <View style={[styles.addSongsDivider, { backgroundColor: theme.colors.outline + '22' }]} />

            {/* Minimal tap row — no background, no border */}
            <Pressable
              onPress={() => setAddSongsOpen(current => !current)}
              style={styles.addSongsToggle}
            >
              <CustomIcon
                name="Playlist"
                size={16}
                color={addSongsOpen ? theme.colors.onSurfaceVariant : theme.colors.primary}
              />
              <Text
                style={[
                  styles.addSongsToggleText,
                  { color: addSongsOpen ? theme.colors.onSurfaceVariant : theme.colors.primary },
                ]}
              >
                {addSongsOpen ? 'Cerrar' : 'Agregar canciones'}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.addSongsCount, { color: theme.colors.onSurfaceVariant }]}>
                {tracks.length > 0 ? `${tracks.length} canción${tracks.length !== 1 ? 'es' : ''}` : ''}
              </Text>
            </Pressable>

            {addSongsOpen ? (
              <Animated.View
                entering={FadeIn.duration(160)}
                layout={LinearTransition.springify().damping(22).stiffness(180)}
                style={styles.addSongsPanel}
              >
                <Searchbar
                  placeholder="Buscar en tu biblioteca"
                  value={addSongsSearch}
                  onChangeText={setAddSongsSearch}
                  style={[
                    styles.searchbar,
                    { backgroundColor: theme.colors.surface + 'CC' },
                  ]}
                  iconColor={theme.colors.primary}
                  inputStyle={{ color: theme.colors.onSurface }}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                />

                {libraryTracks.length === 0 ? (
                  <Text style={[styles.emptyLibraryText, { color: theme.colors.onSurfaceVariant }]}>
                    No hay canciones en tu biblioteca todavía
                  </Text>
                ) : (
                  <View style={styles.libraryListShell}>
                    <FlatList
                      data={filteredLibraryTracks}
                      keyExtractor={keyExtractor}
                      renderItem={renderLibraryTrackItem}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={false}
                    />
                  </View>
                )}
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    );
  }, [addSongsOpen, addSongsSearch, currentTrackId, feedbackAnim, handlePlayAll, handleShuffle, keyExtractor, libraryTracks.length, playableTracks.length, playlist, recentlyUpdatedTrackId, renderLibraryTrackItem, selectedTrackIds, theme.colors.onBackground, theme.colors.onPrimary, theme.colors.onPrimaryContainer, theme.colors.onSurface, theme.colors.onSurfaceVariant, theme.colors.outline, theme.colors.primary, theme.colors.primaryContainer, theme.colors.surface, theme.colors.surfaceVariant, totalDuration, tracks.length]);

  if (!playlist) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.onBackground }}>Playlist not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <TidalAtmosphere
        sourceUri={playlist.artwork}
        mode={playlist.artwork ? 'artwork' : 'fog'}
      />

      <View style={[styles.backButton, { top: insets.top + 8 }]}>
        <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
          <IconButton
            icon={() => <CustomIcon name="Previous" size={24} color={theme.colors.onBackground} />}
            size={24}
            onPress={() => router.back()}
          />
        </BlurView>
      </View>

      <AnimatedFlatList
        data={tracks}
        keyExtractor={keyExtractor}
        renderItem={renderTrackItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: insets.top + 60,
            paddingBottom: Math.max(insets.bottom + DETAIL_HEIGHT + 28, 120),
          },
        ]}
        showsVerticalScrollIndicator={false}
      />

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={1300}
        wrapperStyle={{ bottom: insets.bottom + 96 }}
      >
        {snackbarText}
      </Snackbar>

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
                  <Text style={{ fontSize: 28 }}>Art</Text>
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
  },
  playlistInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  playlistIcon: {
    width: 210,
    height: 210,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  playlistIconImage: {
    width: '100%',
    height: '100%',
  },
  playlistTitle: {
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 7,
    letterSpacing: -0.9,
  },
  playlistDescription: {
    textAlign: 'center',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 22,
  },
  addSongsDivider: {
    height: 1,
    marginHorizontal: 24,
    marginBottom: 2,
  },
  addSongsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 15,
    gap: 10,
    marginHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  addSongsToggleText: {
    fontSize: 14,
    fontWeight: '700',
  },
  addSongsCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  addSongsPanel: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    marginBottom: 8,
  },
  searchbar: {
    borderRadius: 14,
    marginBottom: 8,
    elevation: 0,
  },
  libraryListShell: {
    maxHeight: 380,
  },
  emptyLibraryText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 40,
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
