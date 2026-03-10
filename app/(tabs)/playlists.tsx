import { CustomIcon, EmptyState, PlaylistCard, TrackListItem } from '@/src/components/ui';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Playlist, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Searchbar, Snackbar, Text, TextInput } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
type PlaylistsMode = 'library' | 'builder';

export default function PlaylistsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const playlistsMap = useLibraryStore(state => state.playlists);
  const tracksMap = useLibraryStore(state => state.tracks);
  const createPlaylist = useLibraryStore(state => state.createPlaylist);
  const addToPlaylist = useLibraryStore(state => state.addToPlaylist);
  const removeFromPlaylist = useLibraryStore(state => state.removeFromPlaylist);

  const play = usePlayerStore(state => state.play);
  const currentTrackId = usePlayerStore(state => state.currentTrack?.id);

  const playlists = useMemo(
    () => Array.from(playlistsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [playlistsMap]
  );
  const tracks = useMemo(
    () => Array.from(tracksMap.values()).sort((a, b) => b.dateAdded - a.dateAdded),
    [tracksMap]
  );

  const [mode, setMode] = useState<PlaylistsMode>('library');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [dialogVisible, setDialogVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarText, setSnackbarText] = useState('');
  const [recentlyUpdatedTrackId, setRecentlyUpdatedTrackId] = useState<string | null>(null);
  const feedbackAnim = useMemo(() => new Animated.Value(0), []);
  const bottomSafePadding = insets.bottom + 190;

  useEffect(() => {
    if (playlists.length === 0) {
      setSelectedPlaylistId(null);
      return;
    }

    if (selectedPlaylistId == null || !playlistsMap.has(selectedPlaylistId)) {
      setSelectedPlaylistId(playlists[0].id);
    }
  }, [playlists, playlistsMap, selectedPlaylistId]);

  const selectedPlaylist = useMemo(
    () => (selectedPlaylistId ? playlistsMap.get(selectedPlaylistId) : undefined),
    [selectedPlaylistId, playlistsMap]
  );
  const selectedTrackIds = useMemo(
    () => new Set(selectedPlaylist?.trackIds ?? []),
    [selectedPlaylist?.trackIds]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredTracks = useMemo(() => {
    if (!normalizedQuery) return tracks;
    return tracks.filter(track => {
      const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, tracks]);

  const openCreatePlaylist = useCallback(() => {
    setDialogVisible(true);
  }, []);

  const closeCreatePlaylist = useCallback(() => {
    setDialogVisible(false);
    setNewPlaylistName('');
    setNewPlaylistDescription('');
  }, []);

  const handleCreatePlaylist = useCallback(() => {
    const name = newPlaylistName.trim();
    if (!name) return;

    const id = createPlaylist(name, newPlaylistDescription.trim() || undefined);
    setSelectedPlaylistId(id);
    setMode('builder');
    closeCreatePlaylist();
  }, [closeCreatePlaylist, createPlaylist, newPlaylistDescription, newPlaylistName]);

  const handleOpenPlaylist = useCallback((playlist: Playlist) => {
    router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } });
  }, []);

  const handleTrackPress = useCallback((track: Track) => {
    if (filteredTracks.length > 0) {
      play(track, filteredTracks);
      return;
    }

    play(track, [track]);
  }, [filteredTracks, play]);

  const handleToggleTrackInPlaylist = useCallback((track: Track) => {
    if (!selectedPlaylist) return;

    const isInPlaylist = selectedTrackIds.has(track.id);
    if (isInPlaylist) {
      removeFromPlaylist(selectedPlaylist.id, track.id);
      setSnackbarText(`Quitaste "${track.title}" de ${selectedPlaylist.name}`);
      setSnackbarVisible(true);
      setRecentlyUpdatedTrackId(track.id);

      Animated.sequence([
        Animated.timing(feedbackAnim, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(feedbackAnim, { toValue: 0, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setRecentlyUpdatedTrackId(null));
      return;
    }

    addToPlaylist(selectedPlaylist.id, track.id);
    setSnackbarText(`Agregaste "${track.title}" a ${selectedPlaylist.name}`);
    setSnackbarVisible(true);
    setRecentlyUpdatedTrackId(track.id);

    Animated.sequence([
      Animated.timing(feedbackAnim, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(feedbackAnim, { toValue: 0, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => setRecentlyUpdatedTrackId(null));
  }, [addToPlaylist, feedbackAnim, removeFromPlaylist, selectedPlaylist, selectedTrackIds]);

  const renderBuilderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => {
    const isAdded = selectedTrackIds.has(item.id);
    const isRecentlyUpdated = recentlyUpdatedTrackId === item.id;

    return (
      <Animated.View
        style={isRecentlyUpdated ? {
          transform: [{ scale: feedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) }],
          opacity: feedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }),
        } : undefined}
      >
        <TrackListItem
          track={item}
          index={index}
          isPlaying={currentTrackId === item.id}
          onPress={handleTrackPress}
          onOptionsPress={handleToggleTrackInPlaylist}
          optionsIcon={isAdded ? 'Play' : 'Playlist'}
          optionsIconColor={isAdded ? theme.colors.primary : theme.colors.onSurfaceVariant}
        />
      </Animated.View>
    );
  }, [currentTrackId, feedbackAnim, handleToggleTrackInPlaylist, handleTrackPress, recentlyUpdatedTrackId, selectedTrackIds, theme.colors.onSurfaceVariant, theme.colors.primary]);

  const trackKeyExtractor = useCallback((item: Track) => item.id, []);

  const renderLibraryMode = () => {
    if (playlists.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="Playlist"
            title="No playlists yet"
            description="Create your first playlist and start organizing your music."
          />
          <Button mode="contained" contentStyle={{ flexDirection: 'row-reverse' }} icon={() => <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />} onPress={openCreatePlaylist}>
            Create playlist
          </Button>
        </View>
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <FlashList
          data={playlists}
          keyExtractor={(item) => item.id}
          numColumns={2}
          masonry={true}
          optimizeItemArrangement={true}
          renderItem={({ item, index }: any) => {
            const isTall = index % 3 === 0;
            const height = isTall ? 260 : (index % 2 === 0 ? 180 : 220);
            return (
              <View style={{ padding: 4 }}>
                <PlaylistCard
                  playlist={item}
                  size="full"
                  height={height}
                  onPress={handleOpenPlaylist}
                  trackCount={item.trackIds.length}
                  onOptionsPress={() => {
                    setSelectedPlaylistId(item.id);
                    setMode('builder');
                  }}
                />
              </View>
            );
          }}
          contentContainerStyle={[styles.gridContent, { paddingBottom: bottomSafePadding }]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
        />
      </View>
    );
  };

  const renderBuilderMode = () => {
    if (playlists.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="Playlist"
            title="Create a playlist first"
            description="You need at least one playlist to start adding tracks."
          />
          <Button mode="contained" contentStyle={{ flexDirection: 'row-reverse' }} icon={() => <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />} onPress={openCreatePlaylist}>
            Create playlist
          </Button>
        </View>
      );
    }

    return (
      <View style={styles.builderContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.playlistSelectorRow}
          contentContainerStyle={styles.playlistSelectorContent}
        >
          {playlists.map(playlist => {
            const selected = playlist.id === selectedPlaylistId;

            return (
              <Pressable
                key={playlist.id}
                onPress={() => setSelectedPlaylistId(playlist.id)}
                style={[
                  styles.playlistSelectorCard,
                  {
                    backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.outline,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: selected ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                    fontWeight: '700',
                    fontSize: 13,
                    flexShrink: 1,
                  }}
                >
                  {playlist.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: selected ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant,
                    fontSize: 11,
                    opacity: 0.85,
                  }}
                >
                  {playlist.trackIds.length} songs
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Searchbar
          placeholder="Find tracks to add..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
          inputStyle={{ color: theme.colors.onSurface }}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          iconColor={theme.colors.primary}
        />

        {selectedPlaylist ? (
          <View style={{ flex: 1 }}>
            <FlatList
              data={filteredTracks}
              keyExtractor={trackKeyExtractor}
              renderItem={renderBuilderTrackItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.builderListContent, { paddingBottom: bottomSafePadding }]}
              removeClippedSubviews={true}
            />
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>Select a playlist to start adding tracks.</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>Playlists</Text>
        <Button mode="contained-tonal" contentStyle={{ flexDirection: 'row-reverse' }} icon={() => <CustomIcon name="Playlist" size={18} color={theme.colors.onSecondaryContainer} />} onPress={openCreatePlaylist}>
          New
        </Button>
      </View>

      <View style={[styles.modeRow, { borderBottomColor: theme.colors.outline }]}>
        <Pressable style={styles.modeTab} onPress={() => setMode('library')}>
          <Text
            style={[
              styles.modeLabel,
              { color: mode === 'library' ? theme.colors.primary : theme.colors.onSurfaceVariant },
              mode === 'library' ? styles.modeLabelActive : null,
            ]}
          >
            Your Playlists
          </Text>
          {mode === 'library' ? <View style={[styles.modeIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
        </Pressable>
        <Pressable style={styles.modeTab} onPress={() => setMode('builder')}>
          <Text
            style={[
              styles.modeLabel,
              { color: mode === 'builder' ? theme.colors.primary : theme.colors.onSurfaceVariant },
              mode === 'builder' ? styles.modeLabelActive : null,
            ]}
          >
            Add Songs
          </Text>
          {mode === 'builder' ? <View style={[styles.modeIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
        </Pressable>
      </View>

      <View style={styles.content}>{mode === 'library' ? renderLibraryMode() : renderBuilderMode()}</View>

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={closeCreatePlaylist}>
          <Dialog.Title>Create playlist</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Name"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              mode="outlined"
              autoFocus
              style={styles.dialogInput}
            />
            <TextInput
              label="Description (optional)"
              value={newPlaylistDescription}
              onChangeText={setNewPlaylistDescription}
              mode="outlined"
              multiline
              numberOfLines={3}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeCreatePlaylist}>Cancel</Button>
            <Button onPress={handleCreatePlaylist} disabled={!newPlaylistName.trim()}>
              Create
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={1300}
        wrapperStyle={{ bottom: insets.bottom + 96 }}
      >
        {snackbarText}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontWeight: '800',
  },
  modeRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  modeTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    gap: 5,
  },
  modeLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  modeLabelActive: {
    fontWeight: '700',
  },
  modeIndicator: {
    width: '70%',
    height: 3,
    borderRadius: 999,
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 140,
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 140,
  },
  builderContainer: {
    flex: 1,
  },
  playlistSelectorContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
    gap: 10,
    alignItems: 'center',
  },
  playlistSelectorRow: {
    maxHeight: 60,
  },
  playlistSelectorCard: {
    width: 112,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 1,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  searchbar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
    borderRadius: 12,
    elevation: 0,
  },
  builderListContent: {
    paddingBottom: 140,
  },
  dialogInput: {
    marginBottom: 10,
  },
});
