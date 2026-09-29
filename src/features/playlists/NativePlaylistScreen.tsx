import { useTidalDownload } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { playResolvedRemoteTrack, resolveRemoteTrackForDownload, resolveRemoteTrackForPlayback } from '@/src/services/remotePlaybackService';
import { commitImportedSpotifyPlaylist, previewSpotifyPlaylistFromUrl } from '@/src/services/spotifyChartsService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router, useFocusEffect } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Screen = 'list' | 'detail' | 'create';
type Action = { action: string; screen: Screen; playlistId: string; id: string; memberId: string;
  targetId: string; name: string; description: string; artwork: string; requestId: string; trackIds: string[] };
interface NativeProps extends ViewProps {
  catalog: string; selection: string; appearance: Record<string, string>; labels: Record<string, string>;
  playback: string; downloads: string; response: string; topInset: number; bottomInset: number;
  onAction: (event: NativeSyntheticEvent<Action>) => void;
}
export const hasNativePlaylists = Platform.OS === 'android' && requireOptionalNativeModule('StaySoundPlaylistView') !== null;
const NativeView = hasNativePlaylists ? requireNativeViewManager<NativeProps>('StaySoundPlaylistView') : null;
const covers = `${FileSystem.documentDirectory}playlist_covers/`;
const spotifyUrl = (value: string) => /(spotify\.com\/playlist\/|spotify:playlist:)/i.test(value.trim());

// Use the store's existing local/remote matching; retain the relationship ID for removals.
function entries(state: ReturnType<typeof useLibraryStore.getState>, id: string) {
  const cloud = state.cloudPlaylistTracks.get(id);
  const memberIds = state.playlists.get(id)?.trackIds.filter(key => state.tracks.has(key) || cloud?.has(key)) ?? [];
  return state.getPlaylistTracks(id).map((track, index) => ({ memberId: memberIds[index], track }));
}
function metadata(track: Track) {
  return { id: track.id, title: track.title, artist: track.artist, album: track.album,
    artwork: track.artwork || track.artworkThumb || '', duration: track.duration, dateAdded: track.dateAdded,
    remote: !!track.cloudOnly, playable: !track.cloudOnly || !!(track.spotifyId || track.tidalId),
    tidalId: String(track.tidalId ?? ''), spotifyId: track.spotifyId ?? '' };
}

export default function NativePlaylistScreen({ screen, id = '' }: { screen: Screen; id?: string }) {
  const { theme, config, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const playlists = useLibraryStore(s => s.playlists);
  const tracks = useLibraryStore(s => s.tracks);
  const cloud = useLibraryStore(s => s.cloudPlaylistTracks);
  const current = usePlayerStore(s => s.currentTrack);
  const { download, downloads } = useTidalDownload();
  const [busy, setBusy] = useState<Record<string, number | null>>({});
  const busyRef = useRef(new Set<string>());
  const [response, setResponse] = useState('{}');
  const focused = useRef(false);
  const mounted = useRef(true);
  const importBusy = useRef(false);
  const lastClipboard = useRef('');
  const drafts = useRef(new Map<string, string>());
  const canceledDrafts = useRef(new Set<string>());
  const pickerBusy = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
  const cleanupCover = useCallback(async (uri: string) => {
    if (!uri.startsWith(covers) || Array.from(useLibraryStore.getState().playlists.values()).some(p => p.artwork === uri)) return;
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const uri of drafts.current.values()) void cleanupCover(uri); drafts.current.clear(); };
  }, [cleanupCover]);
  const reply = useCallback((value: Record<string, unknown>) => {
    if (mounted.current) setResponse(JSON.stringify({ ...value, nonce: `${Date.now()}_${Math.random()}` }));
  }, []);
  const catalog = useMemo(() => {
    const state = useLibraryStore.getState();
    return JSON.stringify({
      playlists: Array.from(playlists.values(), p => ({ id: p.id, name: p.name, description: p.description,
        artwork: p.artwork, updatedAt: p.updatedAt, readonly: !!p.readonly, entries: screen === 'detail' && p.id === id
        ? entries(state, p.id).map(e => ({ memberId: e.memberId, song: metadata(e.track) })) : [] })),
      library: screen === 'detail' ? Array.from(tracks.values(), metadata) : [],
    });
  }, [playlists, tracks, cloud, screen, id]);
  const selection = useMemo(() => JSON.stringify({ screen, id }), [screen, id]);
  const appearance = useMemo(() => ({ background: theme.colors.background, surface: theme.colors.surface,
    surfaceVariant: theme.colors.surfaceVariant, primary: theme.colors.primary, onPrimary: theme.colors.onPrimary,
    text: theme.colors.onBackground, subtle: theme.colors.onSurfaceVariant, outline: theme.colors.outline, error: theme.colors.error,
    dark: String(isDark), lightweight: String(config.lightweightMode) }), [theme, config.lightweightMode, isDark]);
  const labels = useMemo(() => ({ title: t('playlists.title'), emptyTitle: t('playlists.empty.title'),
    emptyDescription: t('playlists.empty.description'), create: t('playlists.create') }), [t]);
  const playback = useMemo(() => JSON.stringify({ id: current?.id ?? '', tidalId: String(current?.tidalId ?? ''),
    spotifyId: current?.spotifyId ?? '' }), [current?.id, current?.tidalId, current?.spotifyId]);
  const downloadSnapshot = useMemo(() => JSON.stringify(Object.fromEntries(Object.entries(busy).map(([key, tidalId]) => {
    const state = tidalId ? downloads.get(tidalId) : undefined;
    return [key, { busy: true, progress: state?.status === 'downloading' ? Math.round(state.progress * 100) : -1 }];
  }))), [busy, downloads]);

  const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<Action>) => {
    if (!focused.current || event.screen !== screen || event.playlistId !== id) return;
    const run = async () => {
      const library = useLibraryStore.getState();
      const player = usePlayerStore.getState();
      if (event.action === 'back') { router.back(); return; }
      if (screen === 'list') {
        if (event.action === 'openCreate') router.push('/playlist-create');
        if (event.action === 'open' && library.playlists.has(event.id)) router.push({ pathname: '/playlist/[id]', params: { id: event.id } });
        return;
      }
      if (screen === 'create') {
        if (event.action === 'create' && event.name.trim() && !importBusy.current) {
          importBusy.current = true;
          const createdId = library.createPlaylist(event.name.trim());
          router.replace({ pathname: '/playlist/[id]', params: { id: createdId } });
          return;
        }
        if (!['clipboard', 'import'].includes(event.action) || importBusy.current) return;
        let url = event.name.trim();
        if (event.action === 'clipboard') {
          url = (await Clipboard.getStringAsync()).trim();
          if (!focused.current || !mounted.current || lastClipboard.current === url) return;
          lastClipboard.current = url;
        }
        if (!spotifyUrl(url) || importBusy.current) return;
        importBusy.current = true;
        reply({ kind: 'import', loading: true, url, message: event.action === 'clipboard' ? 'Encontré una URL de Spotify en el portapapeles…' : '' });
        try {
          const imported = await previewSpotifyPlaylistFromUrl(url);
          // Back during import cancels the UI transaction; do not create a hidden playlist.
          if (!focused.current || !mounted.current) return;
          commitImportedSpotifyPlaylist(imported.playlist, imported.tracks);
          router.replace({ pathname: '/playlist/[id]', params: { id: imported.playlist.id } });
        } catch (error) {
          reply({ kind: 'import', loading: false, error: error instanceof Error ? error.message : 'No pude importar esa playlist de Spotify.' });
        } finally { importBusy.current = false; }
        return;
      }
      const playlist = library.playlists.get(id);
      if (!playlist) return;
      if (event.action === 'cancelCover') {
        canceledDrafts.current.add(event.requestId);
        const uri = drafts.current.get(event.requestId);
        drafts.current.delete(event.requestId);
        if (uri) await cleanupCover(uri);
        return;
      }
      if (event.action === 'pickCover' && !playlist.readonly && !pickerBusy.current) {
        pickerBusy.current = true;
        try {
          const picker = await import('expo-image-picker');
          const permission = await picker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) throw new Error('Allow gallery access to pick a playlist cover.');
          const result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
          if (result.canceled || !result.assets[0]?.uri || !mounted.current || canceledDrafts.current.has(event.requestId)) return;
          await FileSystem.makeDirectoryAsync(covers, { intermediates: true });
          const uri = `${covers}playlist_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
          await FileSystem.copyAsync({ from: result.assets[0].uri, to: uri });
          if (!mounted.current || canceledDrafts.current.has(event.requestId)) { await cleanupCover(uri); return; }
          const previous = drafts.current.get(event.requestId);
          drafts.current.set(event.requestId, uri);
          if (previous) await cleanupCover(previous);
          reply({ kind: 'cover', requestId: event.requestId, uri });
        } finally { pickerBusy.current = false; }
        return;
      }
      if (event.action === 'edit' && !playlist.readonly && event.name.trim()) {
        // Only accept the current cover, removal, or a file owned by this edit session.
        const artwork = event.artwork === '' || event.artwork === playlist.artwork || event.artwork === drafts.current.get(event.requestId)
          ? event.artwork : playlist.artwork;
        library.updatePlaylist(id, { name: event.name.trim(), description: event.description, artwork });
        const draft = drafts.current.get(event.requestId);
        drafts.current.delete(event.requestId);
        if (draft && draft !== artwork) await cleanupCover(draft);
        if (playlist.artwork && playlist.artwork !== artwork) await cleanupCover(playlist.artwork);
        return;
      }
      if (event.action === 'deletePlaylist' && !playlist.readonly) {
        library.deletePlaylist(id);
        router.back();
        if (playlist.artwork) await cleanupCover(playlist.artwork);
        return;
      }
      const members = entries(library, id);
      if (event.action === 'toggle') {
        const track = library.tracks.get(event.id);
        if (playlist.readonly || !track || track.cloudOnly) return;
        const member = members.find(e => e.track.id === event.id);
        if (member) library.removeFromPlaylist(id, member.memberId); else library.addToPlaylist(id, track.id);
        reply({ message: `${member ? 'Quitaste' : 'Agregaste'} ${track.title}` });
        return;
      }
      if (event.action === 'libraryPlay') {
        const track = library.tracks.get(event.id);
        const queue = event.trackIds.map(key => library.tracks.get(key)).filter((s): s is Track => !!s && !s.cloudOnly);
        if (track && !track.cloudOnly && queue.some(s => s.id === track.id)) await player.play(track, queue);
        return;
      }
      const entry = members.find(e => e.memberId === event.memberId && e.track.id === event.id);
      if (!entry) return;
      const track = entry.track;
      if (event.action === 'remove' && !playlist.readonly) { library.removeFromPlaylist(id, entry.memberId); reply({ message: `Quitaste ${track.title}` }); }
      if (event.action === 'deleteTrack' || event.action === 'deleteFile') {
        if (!track.cloudOnly && library.tracks.has(track.id)) await library.deleteTrack(track.id, event.action === 'deleteFile');
      }
      const destination = library.playlists.get(event.targetId);
      if (event.action === 'addToPlaylist' && destination && !destination.readonly && library.tracks.has(track.id)) library.addToPlaylist(event.targetId, track.id);
      if (event.action === 'newWithTrack' && library.tracks.has(track.id)) {
        const createdId = library.createPlaylist(`My Playlist ${library.playlists.size + 1}`, 'Created from quick add');
        library.addToPlaylist(createdId, track.id);
      }
      if (event.action === 'queue') player.addToQueue(await resolveRemoteTrackForPlayback(track));
      if (event.action === 'play' || event.action === 'shuffle') {
        const queue = members.map(e => e.track).filter(s => !s.cloudOnly || !!(s.spotifyId || s.tidalId));
        if (!queue.some(s => s.id === track.id)) return;
        if (event.action === 'shuffle' && !player.shuffleEnabled) player.toggleShuffle();
        if (queue.some(s => s.cloudOnly)) await playResolvedRemoteTrack(track, queue); else await player.play(track, queue);
      }
      if (event.action === 'download' && track.cloudOnly && !busyRef.current.has(entry.memberId)) {
        busyRef.current.add(entry.memberId);
        setBusy(value => ({ ...value, [entry.memberId]: null }));
        try {
          const remote = await resolveRemoteTrackForDownload(track);
          if (mounted.current) setBusy(value => ({ ...value, [entry.memberId]: remote.id }));
          await download(remote);
        } finally {
          busyRef.current.delete(entry.memberId);
          if (mounted.current) setBusy(value => { const next = { ...value }; delete next[entry.memberId]; return next; });
        }
      }
    };
    void run().catch(error => reply({ message: error instanceof Error ? error.message : 'No se pudo completar la acción.' }));
  }, [screen, id, cleanupCover, download, reply]);

  if (!NativeView) return null;
  return <NativeView style={styles.screen} catalog={catalog} selection={selection} appearance={appearance}
    labels={labels} playback={playback} downloads={downloadSnapshot} response={response}
    topInset={insets.top} bottomInset={insets.bottom + (screen === 'list' ? 190 : 120)} onAction={onAction} />;
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
