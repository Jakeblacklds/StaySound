import { Alert } from 'react-native';

import { Playlist, Track } from '../types';

const MAX_PLAYLIST_CHOICES = 6;

type TrackActionOptions = {
  track: Track;
  playlists: Playlist[];
  addToQueue: (track: Track) => void;
  addToPlaylist: (playlistId: string, trackId: string) => void;
  createPlaylist: (name: string, description?: string) => string;
};

function getNextPlaylistName(playlists: Playlist[]): string {
  const count = playlists.length + 1;
  return `My Playlist ${count}`;
}

export function openTrackActionsMenu({
  track,
  playlists,
  addToQueue,
  addToPlaylist,
  createPlaylist,
}: TrackActionOptions): void {
  const sortedPlaylists = [...playlists].sort((a, b) => b.updatedAt - a.updatedAt);

  const showPlaylistPicker = () => {
    if (sortedPlaylists.length === 0) {
      const playlistName = getNextPlaylistName(sortedPlaylists);
      const playlistId = createPlaylist(playlistName, 'Created from quick add');
      addToPlaylist(playlistId, track.id);
      Alert.alert('Playlist creada', `Se agrego "${track.title}" a "${playlistName}".`);
      return;
    }

    const buttons = [
      {
        text: 'New playlist',
        onPress: () => {
          const playlistName = getNextPlaylistName(sortedPlaylists);
          const playlistId = createPlaylist(playlistName, 'Created from quick add');
          addToPlaylist(playlistId, track.id);
          Alert.alert('Track guardado', `Se agrego "${track.title}" a "${playlistName}".`);
        },
      },
      ...sortedPlaylists.slice(0, MAX_PLAYLIST_CHOICES).map(playlist => ({
        text: playlist.name,
        onPress: () => {
          addToPlaylist(playlist.id, track.id);
          Alert.alert('Track guardado', `Se agrego "${track.title}" a "${playlist.name}".`);
        },
      })),
      {
        text: 'Cancel',
        style: 'cancel' as const,
      },
    ];

    Alert.alert('Agregar a playlist', 'Elige una playlist de destino', buttons);
  };

  Alert.alert(track.title, 'Elige una accion rapida', [
    {
      text: 'Agregar a cola',
      onPress: () => {
        addToQueue(track);
        Alert.alert('Cola actualizada', `Se agrego "${track.title}" a la cola.`);
      },
    },
    {
      text: 'Agregar a playlist',
      onPress: showPlaylistPicker,
    },
    {
      text: 'Cancel',
      style: 'cancel',
    },
  ]);
}
