import NativePlaylistScreen, { hasNativePlaylists } from '@/src/features/playlists/NativePlaylistScreen';
import ReactPlaylistDetailScreen from '@/src/features/playlists/ReactPlaylistDetailScreen';
import { useLocalSearchParams } from 'expo-router';

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return hasNativePlaylists ? <NativePlaylistScreen screen="detail" id={id} /> : <ReactPlaylistDetailScreen />;
}
