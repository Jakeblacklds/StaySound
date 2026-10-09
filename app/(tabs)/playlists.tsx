import NativePlaylistScreen, { hasNativePlaylists } from '@/src/features/playlists/NativePlaylistScreen';
import ReactPlaylistsScreen from '@/src/features/playlists/ReactPlaylistsScreen';

export default function PlaylistsScreen() {
  return hasNativePlaylists ? <NativePlaylistScreen screen="list" /> : <ReactPlaylistsScreen />;
}
