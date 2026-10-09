import NativePlaylistScreen, { hasNativePlaylists } from '@/src/features/playlists/NativePlaylistScreen';
import ReactPlaylistCreateScreen from '@/src/features/playlists/ReactPlaylistCreateScreen';

export default function PlaylistCreateScreen() {
  return hasNativePlaylists ? <NativePlaylistScreen screen="create" /> : <ReactPlaylistCreateScreen />;
}
