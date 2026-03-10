import { ActionItem, useUIStore } from '../stores/uiStore';
import { Playlist, Track } from '../types';

const MAX_PLAYLIST_CHOICES = 6;

type TrackActionOptions = {
  track: Track;
  playlists: Playlist[];
  addToQueue: (track: Track) => void;
  addToPlaylist: (playlistId: string, trackId: string) => void;
  createPlaylist: (name: string, description?: string) => string;
  deleteTrack?: (id: string, deleteFile?: boolean) => Promise<void>;
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
  deleteTrack,
}: TrackActionOptions): void {
  const sortedPlaylists = [...playlists].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleDelete = () => {
    if (!deleteTrack) return;

    useUIStore.getState().openConfirmModal({
      title: '¿Eliminar de la biblioteca?',
      message: `Esta acción quitará "${track.title}" de tu colección. El archivo permanecerá en tu dispositivo.`,
      confirmLabel: 'Eliminar',
      isDestructive: true,
      onConfirm: () => deleteTrack(track.id, false),
    });
  };

  const handleDeleteFromStorage = () => {
    if (!deleteTrack) return;

    useUIStore.getState().openConfirmModal({
      title: '¿Borrar del dispositivo?',
      message: `¡Cuidado! Se borrará el archivo "${track.title}" permanentemente de tu almacenamiento. No se puede deshacer.`,
      confirmLabel: 'Borrar archivo',
      isDestructive: true,
      onConfirm: () => deleteTrack(track.id, true),
    });
  };


  const showPlaylistPicker = () => {
    const actions: ActionItem[] = [
      {
        label: 'New playlist',
        icon: 'Playlist',
        onPress: () => {
          const playlistName = getNextPlaylistName(sortedPlaylists);
          const playlistId = createPlaylist(playlistName, 'Created from quick add');
          addToPlaylist(playlistId, track.id);
        },
      },
      ...sortedPlaylists.slice(0, MAX_PLAYLIST_CHOICES).map(playlist => ({
        label: playlist.name,
        icon: 'Playlist',
        onPress: () => {
          addToPlaylist(playlist.id, track.id);
        },
      })),
    ];

    useUIStore.getState().openActionSheet({
      title: 'Agregar a playlist',
      subtitle: 'Elige una playlist de destino',
      actions,
      track,
    });
  };

  const actions: ActionItem[] = [
    {
      label: 'Agregar a cola',
      icon: 'Play',
      onPress: () => {
        addToQueue(track);
      },
    },
    {
      label: 'Agregar a playlist',
      icon: 'Playlist',
      onPress: showPlaylistPicker,
    },
  ];

  if (deleteTrack) {
    actions.push({
      label: 'Quitar de la biblioteca',
      icon: 'Cola',
      destructive: true,
      onPress: handleDelete,
    });
    actions.push({
      label: 'Borrar del dispositivo',
      icon: 'Cola',
      destructive: true,
      onPress: handleDeleteFromStorage,
    });
  }


  useUIStore.getState().openActionSheet({
    title: track.title,
    subtitle: track.artist,
    actions,
    track,
  });
}
