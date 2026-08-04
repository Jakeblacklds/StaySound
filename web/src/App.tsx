import type { Album, Artist, Playlist, TidalTrack, Track } from '@staysound/types/audio';
import { ChangeEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatDuration } from '@staysound/services/metadataService';
import {
  getDynamicPalette,
  paletteToCssVars,
  type WebDynamicPalette,
} from './library/dynamicColors';
import {
  canImportFolder,
  collectDirectoryAudioFiles,
  fileToRestoredTrack,
  fileToTrack,
  getDesktopMusicFolder,
  hashFileIdentity,
  importFiles,
  importFolder,
  importRememberedDesktopFolder,
} from './library/importLocalFiles';
import { getFolderHandle, saveFolderHandle, verifyPermission } from './library/webFolderSync';
import { useWebLibraryStore, type ArtworkRecoveryProgress } from './library/webLibraryStore';
import {
  buildTidalRadio,
  buildPersonalizedTidalMix,
  findTidalSeedForTrack,
  getTidalRecommendations,
  searchTidalTracks,
  tidalTrackToDownloadResult,
  TIDAL_DISCOVERY_MOODS,
  type TidalDiscoveryMood,
} from './library/tidalDiscovery';
import { KEYBOARD_SHORTCUTS, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  configureSoulseekShares,
  isSoulseekBridgeAvailable,
  invalidateSoulseekMatches,
  loadSoulseekCredentials,
  monochromeDownloadProvider,
  rescanSoulseekShares,
  saveSoulseekCredentials,
  soulseekDownloadProvider,
  type DownloadActivity,
  type DownloadSearchResult,
  type DownloadSource,
  type SoulseekShareStatus,
  warmSoulseekBridge,
} from './downloads/downloadProvider';
import {
  canPickDownloadFolder,
  getDownloadFolderHandle,
  pickDownloadFolder,
  verifyDownloadFolderPermission,
} from './downloads/webDownloadFolder';
import { isTauriDesktop, pickDesktopMusicFolder } from './desktop/tauriMusicLibrary';
import { checkDesktopUpdate, relaunchDesktop, type DesktopUpdate } from './desktop/tauriUpdater';

import { Sidebar } from './components/Sidebar';
import { GetAppPanel } from './components/GetAppPanel';
import { DesktopRequiredNotice } from './components/DesktopRequiredNotice';
import { TopNav } from './components/circulo/TopNav';
import { PlayerBarCirculo } from './components/circulo/PlayerBarCirculo';
import { CircleArt, hueFromId } from './components/circulo/CircleArt';
import { CircleTile } from './components/circulo/CircleTile';
import { CarouselChevron } from './components/circulo/CarouselChevron';
import { SegmentedTabs } from './components/circulo/SegmentedTabs';
import { SearchPanel } from './components/circulo/SearchPanel';
import { QualityChip } from './components/circulo/QualityChip';
import { formatQualitySpecs } from './library/formatQuality';
import { useIsDesktopViewport } from './hooks/useIsDesktopViewport';
import { TrackList } from './components/TrackList';
import { AlbumGrid } from './components/AlbumGrid';
import { AlbumDetail } from './components/AlbumDetail';
import { ArtistGrid } from './components/ArtistGrid';
import { ArtistDetail } from './components/ArtistDetail';
import { PlayerBar } from './components/PlayerBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { FullPlayer } from './components/FullPlayer';
import { AtmosphereCanvas } from './components/AtmosphereCanvas';
import { QueueDrawer } from './components/QueueDrawer';
import { KaraokeExperience } from './components/KaraokeExperience';
import { webAudioEngine } from './audio/webAudioEngine';
import {
  ArtworkIcon,
  ArtistIcon,
  CloseIcon,
  DiscIcon,
  DownloadIcon,
  FolderIcon,
  GearIcon,
  HomeIcon,
  MusicNoteIcon,
  PlaylistIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SpinnerIcon,
  SyncIcon,
  KeyboardIcon,
  TrashIcon,
} from './components/icons';
import type { Tab } from './components/types';
import { runMotionTransition } from './motion/motionSystem';

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isRelinkNeeded(track: Track): boolean {
  // A track is only truly "locked" when we can neither play it now (no URL) nor
  // relink it lazily from a saved file handle. Tracks with a handle stay
  // playable across sessions and relink on demand when played.
  if (track.uri) return false;
  if ((track as Track & { relinkable?: boolean }).relinkable) return false;
  return true;
}

function startDesktopWindowDrag(): void {
  if (!('__TAURI_INTERNALS__' in window)) return;
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
    .catch(() => undefined);
}

function motionKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function shuffleForHome<T>(items: T[], seedText: string): T[] {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  const next = () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

const TAB_ORDER: Tab[] = ['home', 'songs', 'albums', 'artists', 'playlists', 'downloads', 'radio', 'get-app'];

// The Círculo desktop nav merges these four into one "Biblioteca" destination — see TopNav's
// navDestinationForTab — surfaced here as an underline sub-nav (SegmentedTabs).
const LIBRARY_TABS: Tab[] = ['albums', 'songs', 'artists', 'radio'];
const LIBRARY_SEGMENTS: { id: 'albums' | 'songs' | 'artists' | 'radio'; label: string }[] = [
  { id: 'albums', label: 'Álbumes' },
  { id: 'songs', label: 'Canciones' },
  { id: 'artists', label: 'Artistas' },
  { id: 'radio', label: 'Radio' },
];

const DYNAMIC_VARS = ['--dyn-primary', '--dyn-secondary', '--dyn-accent', '--dyn-bg', '--dyn-bg-alt'] as const;
const ONBOARDING_KEY = 'staysound.web.onboarding.v1';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const TAB_COPY: Record<Tab, { title: string; subtitle: string }> = {
  home: {
    title: 'Inicio',
    subtitle: 'Un resumen limpio de tu biblioteca, con accesos rápidos para volver a escuchar y organizar lo que ya importaste.',
  },
  songs: {
    title: 'Canciones',
    subtitle: 'Toda tu música local en un solo lugar. Haz clic en una canción para reproducirla; la cola se arma con lo que estés viendo.',
  },
  albums: {
    title: 'Álbumes',
    subtitle: 'Tu colección organizada por disco. Abre un álbum para verlo completo y reproducirlo en orden.',
  },
  artists: {
    title: 'Artistas',
    subtitle: 'Explora tu biblioteca por quien la hace: cada artista agrupa sus álbumes y canciones.',
  },
  downloads: {
    title: 'Descargas',
    subtitle: 'Busca música en Monochrome o en tu bridge de Soulseek y guárdala en una carpeta local que tú eliges.',
  },
  playlists: {
    title: 'Playlists',
    subtitle: 'Crea listas locales, agrega canciones de tu biblioteca y reprodúcelas como una cola propia.',
  },
  radio: {
    title: 'Radio',
    subtitle: 'Busca en TIDAL, crea radios por canción y descubre recomendaciones para seguir el hilo de lo que te gusta.',
  },
  search: {
    title: 'Buscar',
    subtitle: 'Encuentra canciones, álbumes y artistas en tu biblioteca.',
  },
  'get-app': {
    title: 'Apps',
    subtitle: 'Descarga StaySound para Android, Windows y macOS, y desbloquea las descargas por Soulseek.',
  },
};

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const isDesktopViewport = useIsDesktopViewport();
  const [tab, setTab] = useState<Tab>('home');
  // The Círculo desktop nav merges songs/albums/artists/radio into one "Biblioteca" entry;
  // clicking it should return to whichever of those the user was last looking at.
  const lastLibraryTabRef = useRef<Tab>('albums');
  const [librarySort, setLibrarySort] = useState<'recent' | 'az'>('recent');
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [ambientPalette, setAmbientPalette] = useState<WebDynamicPalette | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [showLibrarySettings, setShowLibrarySettings] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return window.localStorage.getItem(ONBOARDING_KEY) !== 'done';
    } catch {
      return true;
    }
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalledApp, setIsInstalledApp] = useState(() => (
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  ));
  const [dismissedToastKey, setDismissedToastKey] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [isRecoveringArtwork, setIsRecoveringArtwork] = useState(false);
  const [artworkRecoveryProgress, setArtworkRecoveryProgress] = useState<ArtworkRecoveryProgress | null>(null);
  const [radioBusy, setRadioBusy] = useState(false);
  const [radioMessage, setRadioMessage] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdate | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);

  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [nativeFolderPath, setNativeFolderPath] = useState<string | null>(null);
  const [needsSyncPrompt, setNeedsSyncPrompt] = useState(false);
  const folderSyncInFlightRef = useRef(false);

  const {
    tracks,
    albums,
    artists,
    playlists,
    query,
    isImporting,
    importMessage,
    skippedFiles,
    recentlyPlayedIds,
    audioCurrentTrack,
    audioIsPlaying,
    audioVolume,
    audioError,
    addImportedTracks,
    clearLibrary,
    setQuery,
    setImporting,
    addTrack,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    playTrack,
    togglePlayback,
    next,
    previous,
    seek,
    setVolume,
    recoverMissingArtwork,
    hydrateArtistPhotos,
    hydrateLibrary,
    recordRecentlyPlayed,
  } = useWebLibraryStore(useShallow(state => ({
    tracks: state.tracks,
    albums: state.albums,
    artists: state.artists,
    playlists: state.playlists,
    query: state.query,
    isImporting: state.isImporting,
    importMessage: state.importMessage,
    skippedFiles: state.skippedFiles,
    recentlyPlayedIds: state.recentlyPlayedIds,
    audioCurrentTrack: state.audio.currentTrack,
    audioIsPlaying: state.audio.isPlaying,
    audioVolume: state.audio.volume,
    audioError: state.audio.error,
    addImportedTracks: state.addImportedTracks,
    clearLibrary: state.clearLibrary,
    setQuery: state.setQuery,
    setImporting: state.setImporting,
    addTrack: state.addTrack,
    createPlaylist: state.createPlaylist,
    deletePlaylist: state.deletePlaylist,
    renamePlaylist: state.renamePlaylist,
    addTrackToPlaylist: state.addTrackToPlaylist,
    removeTrackFromPlaylist: state.removeTrackFromPlaylist,
    playTrack: state.playTrack,
    togglePlayback: state.togglePlayback,
    next: state.next,
    previous: state.previous,
    seek: state.seek,
    setVolume: state.setVolume,
    recoverMissingArtwork: state.recoverMissingArtwork,
    hydrateArtistPhotos: state.hydrateArtistPhotos,
    hydrateLibrary: state.hydrateLibrary,
    recordRecentlyPlayed: state.recordRecentlyPlayed,
  })));

  // Deliberately excludes `position`: the library shell must not re-render on
  // every audio timeupdate. PlaybackSurface subscribes to the live clock in a
  // small isolated subtree below.
  const audio = useMemo(() => ({
    currentTrack: audioCurrentTrack,
    isPlaying: audioIsPlaying,
    volume: audioVolume,
    error: audioError,
  }), [
    audioCurrentTrack,
    audioIsPlaying,
    audioVolume,
    audioError,
  ]);

  useEffect(() => {
    async function restoreLibrary() {
      // The IndexedDB library is authoritative. Opening the PWA hydrates this
      // catalog only; it never walks files or rebuilds a second "downloads"
      // library in the background.
      await hydrateLibrary();
    }

    async function checkSavedFolder() {
      const rememberedNativeFolder = await getDesktopMusicFolder();
      if (rememberedNativeFolder) setNativeFolderPath(rememberedNativeFolder);
      const handle = await getFolderHandle();
      if (handle) {
        setFolderHandle(handle);
        // We no longer auto-walk the folder on open. The library is served
        // instantly from the local index (IndexedDB) and each track relinks
        // lazily from its saved file handle the moment it's played — just like
        // Android reads its pre-built MediaStore index. We only note whether the
        // browser still remembers permission, so the UI can offer a one-tap
        // reconnect; scanning for new files is now an explicit, on-demand action.
        const granted = await verifyPermission(handle, false);
        if (!granted) setNeedsSyncPrompt(true);
      }
    }
    // Restore cover art and any overflow tracks from IndexedDB first so the
    // library shows instantly with artwork, without waiting for a folder rescan.
    void restoreLibrary();
    void checkSavedFolder();
  }, [hydrateLibrary]);

  useEffect(() => {
    if (artists.size === 0) return;
    void hydrateArtistPhotos();
  }, [artists, hydrateArtistPhotos]);

  // Propagate the current track's palette to the whole app (sidebar, buttons,
  // cards, player bar, ambient background) via :root vars. The CSS tokens fall
  // back to the brand trio when nothing is playing.
  const currentTrackId = audio.currentTrack?.id;
  const currentTrackArtwork = audio.currentTrack?.artwork;
  useEffect(() => {
    const root = document.documentElement;
    let active = true;
    void getDynamicPalette(audio.currentTrack).then(palette => {
      if (!active) return;
      setAmbientPalette(palette);
      if (!audio.currentTrack) {
        DYNAMIC_VARS.forEach(name => root.style.removeProperty(name));
        return;
      }
      root.style.setProperty('--dyn-primary', palette.primary);
      root.style.setProperty('--dyn-secondary', palette.secondary);
      root.style.setProperty('--dyn-accent', palette.accent);
      root.style.setProperty('--dyn-bg', palette.background);
      root.style.setProperty('--dyn-bg-alt', palette.backgroundAlt);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId, currentTrackArtwork]);

  useEffect(() => {
    if (tab === 'songs' || tab === 'albums' || tab === 'artists' || tab === 'radio') {
      lastLibraryTabRef.current = tab;
    }
  }, [tab]);

  // --- Derived data ---
  const trackList = useMemo(
    () => Array.from(tracks.values()).sort((a, b) => a.title.localeCompare(b.title)),
    [tracks],
  );
  const albumList = useMemo(
    () => Array.from(albums.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [albums],
  );
  const artistList = useMemo(
    () => Array.from(artists.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [artists],
  );
  const normalizedQuery = normalize(query);

  const filteredTracks = useMemo(() => {
    const matches = !normalizedQuery ? trackList : trackList.filter(track =>
      normalize(`${track.title} ${track.artist} ${track.album}`).includes(normalizedQuery),
    );
    return [...matches].sort((a, b) => librarySort === 'recent'
      ? b.dateAdded - a.dateAdded
      : a.title.localeCompare(b.title));
  }, [librarySort, normalizedQuery, trackList]);

  const filteredAlbums = useMemo(() => {
    const matches = !normalizedQuery ? albumList : albumList.filter(album =>
      normalize(`${album.name} ${album.artist}`).includes(normalizedQuery),
    );
    return [...matches].sort((a, b) => {
      if (librarySort === 'az') return a.name.localeCompare(b.name);
      const newest = (album: Album) => album.tracks.reduce(
        (value, id) => Math.max(value, tracks.get(id)?.dateAdded ?? 0),
        0,
      );
      return newest(b) - newest(a);
    });
  }, [albumList, librarySort, normalizedQuery, tracks]);

  const filteredArtists = useMemo(() => {
    const matches = !normalizedQuery
      ? artistList
      : artistList.filter(artist => normalize(artist.name).includes(normalizedQuery));
    return [...matches].sort((a, b) => a.name.localeCompare(b.name));
  }, [artistList, normalizedQuery]);

  const recentTracks = useMemo(
    () => [...trackList].sort((a, b) => b.dateAdded - a.dateAdded).slice(0, 8),
    [trackList],
  );

  const recentlyPlayedTracks = useMemo(
    () => recentlyPlayedIds.map(id => tracks.get(id)).filter((track): track is Track => Boolean(track)),
    [recentlyPlayedIds, tracks],
  );
  const recentlyDownloadedTracks = useMemo(
    () => trackList
      .filter(track => Boolean(track.downloadedAt))
      .sort((a, b) => (b.downloadedAt ?? 0) - (a.downloadedAt ?? 0))
      .slice(0, 8),
    [trackList],
  );

  useEffect(() => {
    if (audio.isPlaying && audio.currentTrack?.id) recordRecentlyPlayed(audio.currentTrack.id);
  }, [audio.currentTrack?.id, audio.isPlaying, recordRecentlyPlayed]);

  const playableTracks = useMemo(
    // A persisted file handle is resolved when the user presses play. Keep
    // every library row in the queue so a closed/reopened PWA never turns a
    // song into a dead, non-clickable UI item just because its blob URL died.
    () => trackList,
    [trackList],
  );

  const playlistTracks = useCallback(
    (playlist: Playlist) => playlist.trackIds
      .map(id => tracks.get(id))
      .filter((track): track is Track => Boolean(track)),
    [tracks],
  );

  const toastMessage = useMemo(() => {
    const message = audio.error || radioMessage || importMessage || '';
    const skipped = skippedFiles > 0
      ? `${skippedFiles} archivo${skippedFiles === 1 ? '' : 's'} omitido${skippedFiles === 1 ? '' : 's'}.`
      : '';
    return [message, skipped].filter(Boolean).join(' ');
  }, [audio.error, importMessage, radioMessage, skippedFiles]);

  const toastKey = `${audio.error ? 'error' : 'info'}:${toastMessage}`;
  const showStatusToast = Boolean(toastMessage) && dismissedToastKey !== toastKey;

  useEffect(() => {
    if (toastMessage) {
      setDismissedToastKey('');
    }
  }, [toastMessage]);

  useEffect(() => {
    if (!showStatusToast) return;
    const timeout = window.setTimeout(() => {
      setDismissedToastKey(toastKey);
    }, audio.error ? 7000 : 4200);
    return () => window.clearTimeout(timeout);
  }, [audio.error, showStatusToast, toastKey]);

  useEffect(() => {
    let active = true;
    void checkDesktopUpdate()
      .then(update => {
        if (active) setAvailableUpdate(update);
      })
      // No connection, an unpublished release, or a browser build should not
      // interrupt listening to music. The next launch will check again.
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function handleInstallUpdate() {
    if (!availableUpdate || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    try {
      await availableUpdate.downloadAndInstall();
      await relaunchDesktop();
    } catch {
      setIsInstallingUpdate(false);
    }
  }

  async function handleFolderSync(
    handleToSync: FileSystemDirectoryHandle,
    requestPrompt = true,
    options: { silent?: boolean } = {},
  ) {
    if (folderSyncInFlightRef.current) return;
    if (requestPrompt) {
      const granted = await verifyPermission(handleToSync, true);
      if (!granted) return;
    } else {
      const granted = await verifyPermission(handleToSync, false);
      if (!granted) {
        setNeedsSyncPrompt(true);
        return;
      }
    }
    folderSyncInFlightRef.current = true;
    setNeedsSyncPrompt(false);
    if (!options.silent) {
      setImporting(true, 'Sincronizando carpeta...');
    }
    try {
      const files = await collectDirectoryAudioFiles(handleToSync);
      const currentTracks = useWebLibraryStore.getState().tracks;
      const existingByPath = new Map<string, Track>();
      for (const track of currentTracks.values()) {
        if (track.relativePath) existingByPath.set(track.relativePath, track);
      }

      const tracksToAdd: Awaited<ReturnType<typeof fileToTrack>>[] = [];
      let processed = 0;
      for (const item of files) {
        const fileId = hashFileIdentity(item.file, item.path);
        const existing = currentTracks.get(fileId);
        const existingAtPath = existingByPath.get(item.path);
        const needsRelink = existing && isRelinkNeeded(existing);
        const isChangedFile = !existing && existingAtPath;

        if (!existing && !isChangedFile) {
          if (!options.silent) {
            setImporting(true, `Sincronizando ${processed + 1}/${files.length}: ${item.file.name}`);
          }
          tracksToAdd.push({
            ...(await fileToTrack(item.file, item.path)),
            fileHandle: item.handle,
          });
          processed += 1;
          continue;
        }

        if (needsRelink) {
          tracksToAdd.push(await fileToRestoredTrack(item.file, item.path, existing, item.handle));
          processed += 1;
          continue;
        }

        if (isChangedFile) {
          if (!options.silent) {
            setImporting(true, `Actualizando ${processed + 1}/${files.length}: ${item.file.name}`);
          }
          tracksToAdd.push({
            ...(await fileToTrack(item.file, item.path)),
            fileHandle: item.handle,
          });
          processed += 1;
        }
      }

      if (tracksToAdd.length > 0) {
        await addImportedTracks(tracksToAdd, 0, { silent: options.silent });
      } else if (!options.silent) {
        setImporting(false, 'Biblioteca lista; no hay canciones nuevas.');
        return;
      }
    } catch (error) {
      console.error('Failed to sync folder:', error);
      if (!options.silent) {
        setImporting(false, 'Error al sincronizar la carpeta local.');
      }
      return;
    } finally {
      folderSyncInFlightRef.current = false;
    }
    if (!options.silent) {
      setImporting(false);
    }
  }

  // --- Import handlers ---
  async function handleDesktopFolderSync(path: string) {
    if (folderSyncInFlightRef.current) return;
    folderSyncInFlightRef.current = true;
    setImporting(true, 'Sincronizando carpeta...');
    try {
      const result = await importRememberedDesktopFolder(path, (current, total, name) => {
        setImporting(true, `Procesando ${current}/${total}: ${name}`);
      });
      await addImportedTracks(result.tracks, result.skipped);
    } catch (error) {
      setImporting(false, error instanceof Error ? error.message : 'Error al sincronizar la carpeta local.');
      return;
    } finally {
      folderSyncInFlightRef.current = false;
    }
    setImporting(false);
  }

  async function handleFolderImport() {
    setImporting(true, 'Leyendo carpeta...');
    try {
      const result = await importFolder((current, total, name) => {
        setImporting(true, `Procesando ${current}/${total}: ${name}`);
      });
      await addImportedTracks(result.tracks, result.skipped);
      if (result.handle) {
        setFolderHandle(result.handle);
        await saveFolderHandle(result.handle);
        setNeedsSyncPrompt(false);
      }
      if (result.nativeFolderPath) setNativeFolderPath(result.nativeFolderPath);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setImporting(false, null);
        return;
      }
      setImporting(false, error instanceof Error ? error.message : 'No se pudo abrir la carpeta.');
      return;
    }
    setImporting(false);
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setImporting(true, 'Preparando canciones...');
    const result = await importFiles(files, (current, total, name) => {
      setImporting(true, `Procesando ${current}/${total}: ${name}`);
    });
    await addImportedTracks(result.tracks, result.skipped);
    setImporting(false);
    event.target.value = '';
  }

  const playFromList = useCallback((track: Track, contextQueue?: Track[], origin?: HTMLElement) => {
    const queue = contextQueue ?? filteredTracks;
    if (!origin) {
      playTrack(track, queue);
      return;
    }
    runMotionTransition(() => playTrack(track, queue), {
      direction: 'vertical',
      shared: [{
        source: origin.querySelector('.track-thumb'),
        destination: '.np-artwork',
      }],
    });
  }, [filteredTracks, playTrack]);

  // Inicio muestra selecciones pequeñas (recientes, descargas y álbumes), pero
  // no debe convertir esas selecciones en una cola aislada. En la app de
  // escritorio cada reproducción que empieza aquí continúa por toda la
  // biblioteca local, conservando la canción sobre la que se hizo clic.
  const playFromHome = useCallback((track: Track) => {
    const libraryTrack = tracks.get(track.id) ?? track;
    playFromList(libraryTrack, trackList);
  }, [playFromList, trackList, tracks]);

  const playHomeAlbum = useCallback((album: Album) => {
    const firstAlbumTrack = album.tracks
      .map(id => tracks.get(id))
      .filter((track): track is Track => Boolean(track))
      .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))[0];
    if (firstAlbumTrack) playFromHome(firstAlbumTrack);
  }, [playFromHome, tracks]);

  const playAlbum = useCallback((album: Album) => {
    // Album.tracks is the authoritative list of track ids (see organizeIntoAlbums) —
    // track.albumId is a separate, source-specific field (TIDAL/downloads) that isn't
    // guaranteed to match Album.id for local files, so resolve through tracks instead.
    const albumQueue = album.tracks
      .map(id => tracks.get(id))
      .filter((track): track is Track => Boolean(track))
      .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
    if (albumQueue[0]) playFromList(albumQueue[0], albumQueue);
  }, [tracks, playFromList]);

  async function resolveAndPlayTidalQueue(source: TidalTrack[]): Promise<void> {
    const settled = await Promise.allSettled(
      source.slice(0, 12).map(track => (
        monochromeDownloadProvider.resolveStream(tidalTrackToDownloadResult(track))
      )),
    );
    const queue = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!queue[0]) throw new Error('No encontré streams reproducibles para esta selección.');
    playTrack(queue[0], queue);
  }

  async function downloadTidalRecommendationWithSoulseek(track: TidalTrack): Promise<void> {
    if (!isTauriDesktop()) {
      throw new Error('Las recomendaciones P2P de Inicio están disponibles en la app de escritorio.');
    }

    let musicFolder = await getDesktopMusicFolder().catch(() => null);
    if (!musicFolder) {
      musicFolder = await pickDesktopMusicFolder();
    }
    if (!musicFolder) {
      throw new Error('Selecciona una carpeta de música para guardar la descarga.');
    }

    await warmSoulseekBridge();
    const catalogResult = tidalTrackToDownloadResult(track);
    const soulseekResult: DownloadSearchResult = {
      ...catalogResult,
      id: `soulseek_home_${track.id}`,
      source: 'soulseek',
    };
    const resolved = await soulseekDownloadProvider.resolveDownload(soulseekResult);
    const downloaded = await soulseekDownloadProvider.download(resolved);
    await addTrack(downloaded);
  }

  async function handleStartRadioFromTrack(track: Track | null): Promise<void> {
    if (!track || radioBusy) return;
    setRadioBusy(true);
    setRadioMessage(`Armando una radio desde ${track.title}...`);
    try {
      const seed = await findTidalSeedForTrack(track);
      if (!seed) throw new Error('No encontré esa canción en TIDAL para iniciar la radio.');
      const radio = await buildTidalRadio(seed, 28);
      await resolveAndPlayTidalQueue(radio);
      setRadioMessage(`Radio de ${track.title} lista y sonando.`);
    } catch (error) {
      setRadioMessage(error instanceof Error ? error.message : 'No pude iniciar la radio.');
    } finally {
      setRadioBusy(false);
    }
  }

  async function handlePlayTidalRecommendations(tracks: TidalTrack[]): Promise<void> {
    if (tracks.length === 0 || radioBusy) return;
    setRadioBusy(true);
    setRadioMessage('Preparando tu mezcla recomendada...');
    try {
      await resolveAndPlayTidalQueue(tracks);
      setRadioMessage('Tu mezcla de TIDAL ya está sonando.');
    } catch (error) {
      setRadioMessage(error instanceof Error ? error.message : 'No pude reproducir las recomendaciones.');
    } finally {
      setRadioBusy(false);
    }
  }

  // --- Album / Artist navigation ---
  function handleSelectAlbum(album: Album, origin?: HTMLElement) {
    const key = motionKey(album.id);
    runMotionTransition(() => {
      setSelectedAlbum(album);
      setSelectedArtist(null);
    }, {
      direction: 'forward',
      shared: [
        {
          source: origin?.querySelector('[data-motion-role="artwork"]') ?? null,
          destination: `[data-motion-id="album-detail-art-${key}"]`,
        },
        {
          source: origin?.querySelector('[data-motion-role="title"]') ?? null,
          destination: `[data-motion-id="album-detail-title-${key}"]`,
          kind: 'text',
        },
      ],
    });
  }
  function handleSelectArtist(artist: Artist, origin?: HTMLElement) {
    const key = motionKey(artist.id);
    runMotionTransition(() => {
      setSelectedArtist(artist);
      setSelectedAlbum(null);
    }, {
      direction: 'forward',
      shared: [
        {
          source: origin?.querySelector('[data-motion-role="artwork"]') ?? null,
          destination: `[data-motion-id="artist-detail-art-${key}"]`,
        },
        {
          source: origin?.querySelector('[data-motion-role="title"]') ?? null,
          destination: `[data-motion-id="artist-detail-title-${key}"]`,
          kind: 'text',
        },
      ],
    });
  }
  function handleOpenArtist(artist: Artist) {
    const libraryArtist = artists.get(artist.id)
      ?? artistList.find(candidate => candidate.name.localeCompare(artist.name, undefined, { sensitivity: 'accent' }) === 0);
    if (!libraryArtist) return;
    setTab('artists');
    handleSelectArtist(libraryArtist);
  }
  function handleBackFromAlbum() {
    if (!selectedAlbum) return;
    const key = motionKey(selectedAlbum.id);
    runMotionTransition(() => setSelectedAlbum(null), {
      direction: 'backward',
      shared: [
        {
          source: document.querySelector(`[data-motion-id="album-detail-art-${key}"]`),
          destination: `[data-motion-id="album-card-art-${key}"]`,
        },
        {
          source: document.querySelector(`[data-motion-id="album-detail-title-${key}"]`),
          destination: `[data-motion-id="album-card-title-${key}"]`,
          kind: 'text',
        },
      ],
    });
  }
  function handleBackFromArtist() {
    if (!selectedArtist) return;
    const key = motionKey(selectedArtist.id);
    runMotionTransition(() => setSelectedArtist(null), {
      direction: 'backward',
      shared: [
        {
          source: document.querySelector(`[data-motion-id="artist-detail-art-${key}"]`),
          destination: `[data-motion-id="artist-card-art-${key}"]`,
        },
        {
          source: document.querySelector(`[data-motion-id="artist-detail-title-${key}"]`),
          destination: `[data-motion-id="artist-card-title-${key}"]`,
          kind: 'text',
        },
      ],
    });
  }

  // --- Tab change resets detail views ---
  function handleTabChange(newTab: Tab) {
    const fromIndex = TAB_ORDER.indexOf(tab);
    const toIndex = TAB_ORDER.indexOf(newTab);
    runMotionTransition(() => {
      setTab(newTab);
      setSelectedAlbum(null);
      setSelectedArtist(null);
    }, {
      direction: toIndex < fromIndex ? 'backward' : 'forward',
    });
  }

  // --- Keyboard shortcuts ---
  const keyHandlers = useMemo(() => ({
    onTogglePlayback: togglePlayback,
    onNext: next,
    onPrevious: previous,
    onSeekForward: () => seek(useWebLibraryStore.getState().audio.position + 5000),
    onSeekBackward: () => seek(Math.max(0, useWebLibraryStore.getState().audio.position - 5000)),
    onVolumeUp: () => setVolume(Math.min(1, audio.volume + 0.05)),
    onVolumeDown: () => setVolume(Math.max(0, audio.volume - 0.05)),
    onToggleMute: () => setVolume(audio.volume > 0 ? 0 : 0.9),
    onToggleFullPlayer: () => setShowFullPlayer(v => !v),
    onToggleQueue: () => setShowQueue(v => !v),
    onToggleShortcutHelp: () => setShowShortcutHelp(v => !v),
    getVolume: () => audio.volume,
  }), [togglePlayback, next, previous, seek, setVolume, audio.volume]);

  useKeyboardShortcuts(keyHandlers);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalledApp(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function handleInstallApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') setIsInstalledApp(true);
    setInstallPrompt(null);
  }

  async function handleRecoverArtwork() {
    const total = Array.from(useWebLibraryStore.getState().tracks.values())
      .filter(track => !track.artwork).length;
    setArtworkRecoveryProgress({ processed: 0, total, recovered: 0 });
    setIsRecoveringArtwork(true);
    try {
      // This is an explicit user action. Ask once for the saved root folder so
      // artwork recovery can read embedded covers from local files; normal app
      // startup deliberately never requests this permission or scans files.
      const savedFolder = await getFolderHandle();
      if (savedFolder) {
        const granted = await verifyPermission(savedFolder, true).catch(() => false);
        if (!granted) setNeedsSyncPrompt(true);
      }
      await recoverMissingArtwork(setArtworkRecoveryProgress);
    } finally {
      setIsRecoveringArtwork(false);
    }
  }

  function closeOnboarding() {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, 'done');
    } catch {
      // If storage is blocked, keep the app usable for the session.
    }
    setShowOnboarding(false);
  }

  const tabCopy = TAB_COPY[tab];
  const isDetailView = Boolean(
    (selectedAlbum && tab === 'albums') || (selectedArtist && tab === 'artists'),
  );
  const sectionCount = tab === 'songs'
    ? `${filteredTracks.length} canciones`
    : tab === 'albums'
      ? `${filteredAlbums.length} discos`
      : tab === 'artists'
        ? `${filteredArtists.length} artistas`
        : tab === 'playlists'
          ? `${playlists.length} playlists`
          : tabCopy.subtitle;

  // --- Determine content ---
  function renderContent() {
    // Album detail view
    if (selectedAlbum && tab === 'albums') {
      return (
        <AlbumDetail
          album={selectedAlbum}
          tracks={trackList}
          activeTrackId={audio.currentTrack?.id}
          isPlaying={audio.isPlaying}
          onPlay={playFromList}
          onSelectArtist={handleOpenArtist}
          onBack={handleBackFromAlbum}
        />
      );
    }

    // Artist detail view
    if (selectedArtist && tab === 'artists') {
      return (
        <ArtistDetail
          artist={selectedArtist}
          albums={albums}
          tracks={trackList}
          activeTrackId={audio.currentTrack?.id}
          isPlaying={audio.isPlaying}
          onPlay={playFromList}
          onSelectAlbum={album => { setSelectedAlbum(album); setSelectedArtist(null); setTab('albums'); }}
          onBack={handleBackFromArtist}
        />
      );
    }

    // Tab views
    switch (tab) {
      case 'home':
        return (
          <HomePanel
            recentTracks={recentTracks}
            recentlyPlayedTracks={recentlyPlayedTracks}
            recentlyDownloadedTracks={recentlyDownloadedTracks}
            currentTrack={audio.currentTrack}
            albums={albumList}
            artists={artistList}
            playlists={playlists}
            activeTrackId={audio.currentTrack?.id}
            isPlaying={audio.isPlaying}
            onPlayTrack={playFromHome}
            onAddToPlaylist={addTrackToPlaylist}
            onOpenTab={handleTabChange}
            onSelectAlbum={album => { setTab('albums'); handleSelectAlbum(album); }}
            onSelectArtist={handleOpenArtist}
            getPlaylistTracks={playlistTracks}
            onDownloadRecommendation={downloadTidalRecommendationWithSoulseek}
            onImport={() => setShowLibrarySettings(true)}
            onPlayAlbum={playHomeAlbum}
          />
        );
      case 'songs':
        return (
          <TrackList
            tracks={filteredTracks}
            activeTrackId={audio.currentTrack?.id}
            isPlaying={audio.isPlaying}
            onPlay={(track, origin) => playFromList(track, filteredTracks, origin)}
            isImporting={isImporting}
            playlists={playlists}
            onAddToPlaylist={addTrackToPlaylist}
            onImport={() => setShowLibrarySettings(true)}
            onSelectArtist={handleOpenArtist}
          />
        );
      case 'albums':
        return (
          <AlbumGrid
            albums={filteredAlbums}
            tracks={trackList}
            onSelectAlbum={handleSelectAlbum}
          />
        );
      case 'artists':
        return (
          <ArtistGrid
            artists={filteredArtists}
            tracks={trackList}
            onSelectArtist={handleSelectArtist}
          />
        );
      case 'playlists':
        return (
          <PlaylistsPanel
            playlists={playlists}
            tracks={trackList}
            playableTracks={playableTracks}
            activeTrackId={audio.currentTrack?.id}
            isPlaying={audio.isPlaying}
            onPlayTrack={(track, queue) => playFromList(track, queue)}
            onCreate={createPlaylist}
            onRename={renamePlaylist}
            onDelete={deletePlaylist}
            onAddTrack={addTrackToPlaylist}
            onRemoveTrack={removeTrackFromPlaylist}
            getPlaylistTracks={playlistTracks}
          />
        );
      case 'radio':
        return (
          <TidalDiscoveryPanel
            tracks={trackList}
            currentTrack={audio.currentTrack}
            onPlay={track => playTrack(track, [track])}
            onPlayQueue={(first, queue) => playTrack(first, queue)}
            onAddToLibrary={track => addTrack(track)}
          />
        );
      case 'downloads':
        return (
          <DownloadsPanel
            onDownloaded={track => addTrack(track)}
            onGetApp={() => handleTabChange('get-app')}
          />
        );
      case 'get-app':
        return <GetAppPanel />;
      case 'search':
        return (
          <SearchPanel
            albums={albumList}
            artists={artistList}
            tracks={trackList}
            activeTrackId={audio.currentTrack?.id}
            onPlayTrack={(track, queue) => playFromList(track, queue)}
            onSelectAlbum={album => { setTab('albums'); handleSelectAlbum(album); }}
            onSelectArtist={artist => { setTab('artists'); handleSelectArtist(artist); }}
          />
        );
    }
  }

  const titlebarDragRegion = (
    <div
      className="titlebar-drag-region"
      aria-hidden="true"
      onMouseDown={event => {
        if (event.button === 0) startDesktopWindowDrag();
      }}
    />
  );

  const shell = isDesktopViewport ? (
    <>
      {titlebarDragRegion}
      <div className={`circ-app-shell ${audio.currentTrack ? 'has-active-track' : ''}`}>
        <TopNav
          tab={tab}
          onSelectHome={() => handleTabChange('home')}
          onSelectLibrary={() => handleTabChange(lastLibraryTabRef.current)}
          onSelectSearch={() => handleTabChange('search')}
          onSelectPlaylists={() => handleTabChange('playlists')}
          onSelectDownloads={() => handleTabChange('downloads')}
          onSelectGetApp={() => handleTabChange('get-app')}
          trailing={
            <>
              {availableUpdate && (
                <button
                  className="btn btn-ghost install-app-button"
                  onClick={() => { void handleInstallUpdate(); }}
                  disabled={isInstallingUpdate}
                  aria-label={`Instalar actualización ${availableUpdate.version}`}
                  title={`Instalar actualización ${availableUpdate.version}`}
                >
                  <DownloadIcon size={16} />
                  {isInstallingUpdate ? 'Actualizando…' : `Actualizar (${availableUpdate.version})`}
                </button>
              )}
              {installPrompt && !isInstalledApp && (
                <button
                  className="btn btn-ghost install-app-button"
                  onClick={handleInstallApp}
                  aria-label="Instalar StaySound"
                  title="Instalar StaySound"
                >
                  <DownloadIcon size={16} />
                  Instalar app
                </button>
              )}
              <button
                onClick={() => setShowLibrarySettings(true)}
                aria-label="Ajustes de biblioteca"
                title="Ajustes de biblioteca"
              >
                <GearIcon size={18} />
              </button>
            </>
          }
        />
        <section className="circ-content">
          {LIBRARY_TABS.includes(tab) && !isDetailView && (
            <SegmentedTabs
              items={LIBRARY_SEGMENTS}
              active={tab as typeof LIBRARY_SEGMENTS[number]['id']}
              onSelect={handleTabChange}
              ariaLabel="Vistas de biblioteca"
            />
          )}
          <div
            key={`${tab}:${selectedAlbum?.id ?? ''}:${selectedArtist?.id ?? ''}`}
            className="view"
          >
            {renderContent()}
          </div>
        </section>
      </div>
    </>
  ) : (
    <>
      {titlebarDragRegion}
      <main className="app-shell">
        <Sidebar tab={tab} onTabChange={handleTabChange} />

        <section className={`content ${isDetailView ? 'detail-mode' : ''}`}>
          {!isDetailView && <header className="toolbar">
            <div className="toolbar-left">
              <h1 key={tab}>{tabCopy.title}</h1>
              <p key={`sub-${tab}`} className="toolbar-subtitle">{sectionCount}</p>
            </div>
            <div className="actions">
              {tab !== 'downloads' && (
                <div className={`header-search ${isSearchOpen ? 'open' : ''}`}>
                  <input
                    ref={searchInputRef}
                    className="header-search-input"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        setIsSearchOpen(false);
                      }
                    }}
                    placeholder="Buscar en tu biblioteca"
                    aria-label="Buscar en biblioteca"
                  />
                  <button
                    className={`icon-btn search-toggle ${isSearchOpen ? 'active' : ''}`}
                    onClick={() => setIsSearchOpen(open => !open)}
                    aria-label="Buscar en biblioteca"
                    title="Buscar en biblioteca"
                  >
                    <SearchIcon size={18} />
                  </button>
                </div>
              )}
              {(tab === 'songs' || tab === 'albums' || tab === 'artists') && (
                <label className="library-sort">
                  <span className="sr-only">Ordenar biblioteca</span>
                  <select
                    value={librarySort}
                    onChange={event => setLibrarySort(event.target.value as 'recent' | 'az')}
                    aria-label="Ordenar biblioteca"
                  >
                    <option value="recent">Añadidos recientemente</option>
                    <option value="az">Nombre A–Z</option>
                  </select>
                </label>
              )}
              <button
                className="icon-btn"
                onClick={() => setShowLibrarySettings(true)}
                aria-label="Ajustes de biblioteca"
                title="Ajustes de biblioteca"
              >
                <GearIcon size={18} />
              </button>
              {availableUpdate && (
                <button
                  className="btn btn-ghost install-app-button"
                  onClick={() => { void handleInstallUpdate(); }}
                  disabled={isInstallingUpdate}
                  aria-label={`Instalar actualización ${availableUpdate.version}`}
                  title={`Instalar actualización ${availableUpdate.version}`}
                >
                  <DownloadIcon size={16} />
                  {isInstallingUpdate ? 'Actualizando…' : `Actualizar (${availableUpdate.version})`}
                </button>
              )}
              {installPrompt && !isInstalledApp && (
                <button
                  className="btn btn-ghost install-app-button"
                  onClick={handleInstallApp}
                  aria-label="Instalar StaySound"
                  title="Instalar StaySound"
                >
                  <DownloadIcon size={16} />
                  Instalar app
                </button>
              )}
            </div>
          </header>}

          {/* Library sub-navigation on mobile. Primary destinations live in the bottom navbar. */}
          {(tab === 'songs' || tab === 'albums' || tab === 'artists') && (
            <div className="mobile-tabs" aria-label="Vistas de biblioteca">
              {(['songs', 'albums', 'artists'] as Tab[]).map(item => (
                <button
                  key={item}
                  className={tab === item ? 'active' : ''}
                  onClick={() => handleTabChange(item)}
                  aria-label={item === 'songs' ? 'Canciones' : item === 'albums' ? 'Álbumes' : 'Artistas'}
                >
                  {item === 'songs' ? <MusicNoteIcon size={18} />
                    : item === 'albums' ? <DiscIcon size={18} />
                    : <ArtistIcon size={18} />}
                  <span>{item === 'songs' ? 'Canciones' : item === 'albums' ? 'Álbumes' : 'Artistas'}</span>
                </button>
              ))}
            </div>
          )}

          <div
            key={`${tab}:${selectedAlbum?.id ?? ''}:${selectedArtist?.id ?? ''}`}
            className="view"
          >
            {renderContent()}
          </div>
        </section>
      </main>

      <MobileBottomNav tab={tab} onTabChange={handleTabChange} />
    </>
  );

  return (
    <>
      {!showFullPlayer && ambientPalette ? (
        <div
          className="global-listening-atmosphere"
          style={paletteToCssVars(ambientPalette) as CSSProperties}
          aria-hidden="true"
        >
          <div className="global-listening-gradient" />
          <AtmosphereCanvas
            palette={ambientPalette}
            isPlaying={audio.isPlaying}
            motionKey={audio.currentTrack?.id ?? 'staysound-idle'}
          />
          <div className="global-listening-scrim" />
        </div>
      ) : null}

      {shell}

      <PlaybackSurface
        showFullPlayer={showFullPlayer}
        showQueue={showQueue}
        radioBusy={radioBusy}
        playlists={playlists}
        onOpenFullPlayer={() => setShowFullPlayer(true)}
        onCloseFullPlayer={() => setShowFullPlayer(false)}
        onOpenQueue={() => setShowQueue(true)}
        onCloseQueue={() => setShowQueue(false)}
        onStartRadio={handleStartRadioFromTrack}
        onAddToPlaylist={addTrackToPlaylist}
      />

      {showStatusToast && (
        <section className={`status-toast ${audio.error ? 'error' : ''}`} role="status">
          {toastMessage}
        </section>
      )}

      {showShortcutHelp && (
        <ShortcutHelpModal onClose={() => setShowShortcutHelp(false)} />
      )}

      {showLibrarySettings && (
          <LibrarySettingsModal
            fileInputRef={fileInputRef}
            hasFolderSource={Boolean(folderHandle || nativeFolderPath)}
          needsSyncPrompt={needsSyncPrompt}
          isImporting={isImporting}
          isRecoveringArtwork={isRecoveringArtwork}
          artworkRecoveryProgress={artworkRecoveryProgress}
          missingArtworkCount={Array.from(tracks.values()).filter(track => !track.artwork).length}
          hasTracks={trackList.length > 0}
          onClose={() => setShowLibrarySettings(false)}
          onShowShortcuts={() => { setShowLibrarySettings(false); setShowShortcutHelp(true); }}
          onFileInput={handleFileInput}
          onSync={() => {
            if (nativeFolderPath) void handleDesktopFolderSync(nativeFolderPath);
            else if (folderHandle) void handleFolderSync(folderHandle, true);
          }}
          onImportFolder={canImportFolder() ? handleFolderImport : () => fileInputRef.current?.click()}
          onRecoverArtwork={handleRecoverArtwork}
          onClear={clearLibrary}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          onClose={closeOnboarding}
          onImport={() => {
            closeOnboarding();
            setShowLibrarySettings(true);
          }}
        />
      )}
    </>
  );
}

function PlaybackSurface({
  showFullPlayer,
  showQueue,
  radioBusy,
  playlists,
  onOpenFullPlayer,
  onCloseFullPlayer,
  onOpenQueue,
  onCloseQueue,
  onStartRadio,
  onAddToPlaylist,
}: {
  showFullPlayer: boolean;
  showQueue: boolean;
  radioBusy: boolean;
  playlists: Playlist[];
  onOpenFullPlayer: () => void;
  onCloseFullPlayer: () => void;
  onOpenQueue: () => void;
  onCloseQueue: () => void;
  onStartRadio: (track: Track | null) => Promise<void>;
  onAddToPlaylist: (playlistId: string, trackId: string) => void;
}) {
  const [showKaraoke, setShowKaraoke] = useState(false);
  const karaokeWasPlayingRef = useRef(false);
  const isDesktopViewport = useIsDesktopViewport();
  const {
    audio,
    togglePlayback,
    next,
    previous,
    seek,
    playAtIndex,
    setVolume,
    cycleRepeatMode,
    toggleShuffle,
  } = useWebLibraryStore(useShallow(state => ({
    audio: state.audio,
    togglePlayback: state.togglePlayback,
    next: state.next,
    previous: state.previous,
    seek: state.seek,
    playAtIndex: state.playAtIndex,
    setVolume: state.setVolume,
    cycleRepeatMode: state.cycleRepeatMode,
    toggleShuffle: state.toggleShuffle,
  })));

  const handleOpenKaraoke = useCallback(() => {
    if (!audio.currentTrack || !isTauriDesktop()) return;
    karaokeWasPlayingRef.current = audio.isPlaying;
    setShowKaraoke(true);
  }, [audio.currentTrack, audio.isPlaying]);

  const handleCloseKaraoke = useCallback((position: number, resumePlayback: boolean) => {
    setShowKaraoke(false);
    seek(position);
    if (resumePlayback) void webAudioEngine.play();
  }, [seek]);

  return (
    <>
      {audio.currentTrack && (isDesktopViewport ? (
        <PlayerBarCirculo
          currentTrack={audio.currentTrack}
          isPlaying={audio.isPlaying}
          position={audio.position}
          duration={audio.duration}
          repeatMode={audio.repeatMode}
          shuffleEnabled={audio.shuffleEnabled}
          volume={audio.volume}
          onVolume={setVolume}
          onToggle={togglePlayback}
          onNext={next}
          onPrevious={previous}
          onSeek={seek}
          onRepeat={cycleRepeatMode}
          onShuffle={toggleShuffle}
          onOpenFullPlayer={onOpenFullPlayer}
          onOpenQueue={onOpenQueue}
          onStartRadio={() => void onStartRadio(audio.currentTrack)}
          isRadioLoading={radioBusy}
          queueOpen={showQueue}
        />
      ) : (
        <PlayerBar
          currentTrack={audio.currentTrack}
          isPlaying={audio.isPlaying}
          isLoading={audio.isLoading}
          position={audio.position}
          duration={audio.duration}
          volume={audio.volume}
          repeatMode={audio.repeatMode}
          shuffleEnabled={audio.shuffleEnabled}
          onToggle={togglePlayback}
          onNext={next}
          onPrevious={previous}
          onSeek={seek}
          onVolume={setVolume}
          onRepeat={cycleRepeatMode}
          onShuffle={toggleShuffle}
          onOpenFullPlayer={onOpenFullPlayer}
          onOpenQueue={onOpenQueue}
          onStartRadio={() => void onStartRadio(audio.currentTrack)}
          isRadioLoading={radioBusy}
        />
      ))}

      {showFullPlayer && (
        <FullPlayer
          currentTrack={audio.currentTrack}
          isPlaying={audio.isPlaying}
          isLoading={audio.isLoading}
          position={audio.position}
          duration={audio.duration}
          volume={audio.volume}
          repeatMode={audio.repeatMode}
          shuffleEnabled={audio.shuffleEnabled}
          onToggle={togglePlayback}
          onNext={next}
          onPrevious={previous}
          onSeek={seek}
          onVolume={setVolume}
          onRepeat={cycleRepeatMode}
          onShuffle={toggleShuffle}
          onClose={onCloseFullPlayer}
          onOpenQueue={onOpenQueue}
          onOpenKaraoke={isTauriDesktop() ? handleOpenKaraoke : undefined}
          playlists={playlists}
          onAddToPlaylist={onAddToPlaylist}
        />
      )}

      {showKaraoke && audio.currentTrack ? (
        <KaraokeExperience
          track={audio.currentTrack}
          initialPosition={audio.position}
          duration={audio.duration}
          volume={audio.volume}
          wasPlaying={karaokeWasPlayingRef.current}
          onPauseMain={() => webAudioEngine.pause()}
          onExit={handleCloseKaraoke}
        />
      ) : null}

      {showQueue && (
        <QueueDrawer
          queue={audio.queue}
          currentIndex={audio.queueIndex}
          isPlaying={audio.isPlaying}
          onPlayIndex={playAtIndex}
          onClose={onCloseQueue}
        />
      )}
    </>
  );
}

function OnboardingModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const exit = useCallback((complete: () => void) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(complete, 220);
  }, [closing]);

  return (
    <div className={`onboarding-overlay ${closing ? 'closing' : ''}`} role="presentation" onClick={() => exit(onClose)}>
      <section
        className={`onboarding-modal ${closing ? 'closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="onboarding-head">
          <span className="brand-mark" aria-hidden="true" />
          <button className="icon-btn" onClick={() => exit(onClose)} aria-label="Cerrar guía" title="Cerrar">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="onboarding-copy">
          <span className="eyebrow">Guía rápida</span>
          <h2 id="onboarding-title">StaySound</h2>
        </div>

        <div className="onboarding-steps">
          <article>
            <FolderIcon size={20} />
            <strong>Importa</strong>
            <p>Elige una carpeta o archivos de música.</p>
          </article>
          <article>
            <SearchIcon size={20} />
            <strong>Encuentra</strong>
            <p>La lupa busca solo dentro de tu biblioteca.</p>
          </article>
          <article>
            <DownloadIcon size={20} />
            <strong>Descarga</strong>
            <p>Descargas es opcional y queda separado.</p>
          </article>
        </div>

        <footer className="onboarding-actions">
          <button className="btn btn-primary" onClick={() => exit(onImport)}>
            <FolderIcon size={16} />
            Importar música
          </button>
          <button className="btn btn-ghost" onClick={() => exit(onClose)}>Entrar</button>
        </footer>
      </section>
    </div>
  );
}

/** Shortcut reference, reachable with "?" and from the settings sheet. The
    shortcuts existed since the first version but were documented nowhere, so
    the only way to discover them was to read the source. */
function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  }, [closing, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [handleClose]);

  return (
    <div className={`settings-modal-overlay ${closing ? 'closing' : ''}`} role="presentation" onClick={handleClose}>
      <section
        className={`settings-modal shortcut-help ${closing ? 'closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="settings-modal-head">
          <h2 id="shortcut-help-title">Atajos de teclado</h2>
          <button ref={closeRef} className="icon-btn" onClick={handleClose} aria-label="Cerrar atajos" title="Cerrar">
            <CloseIcon size={18} />
          </button>
        </header>

        <dl className="shortcut-list">
          {KEYBOARD_SHORTCUTS.map(shortcut => (
            <div className="shortcut-row" key={shortcut.keys}>
              <dt><kbd>{shortcut.keys}</kbd></dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function LibrarySettingsModal({
  fileInputRef,
  hasFolderSource,
  needsSyncPrompt,
  isImporting,
  isRecoveringArtwork,
  artworkRecoveryProgress,
  missingArtworkCount,
  hasTracks,
  onClose,
  onShowShortcuts,
  onFileInput,
  onSync,
  onImportFolder,
  onRecoverArtwork,
  onClear,
}: {
  fileInputRef: { current: HTMLInputElement | null };
  hasFolderSource: boolean;
  needsSyncPrompt: boolean;
  isImporting: boolean;
  isRecoveringArtwork: boolean;
  artworkRecoveryProgress: ArtworkRecoveryProgress | null;
  missingArtworkCount: number;
  hasTracks: boolean;
  onClose: () => void;
  onShowShortcuts: () => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onSync: () => void;
  onImportFolder: () => void;
  onRecoverArtwork: () => void;
  onClear: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  }, [closing, onClose]);

  return (
    <div className={`settings-modal-overlay ${closing ? 'closing' : ''}`} role="presentation" onClick={handleClose}>
      <section
        className={`settings-modal ${closing ? 'closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-settings-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="settings-modal-head">
          <h2 id="library-settings-title">Ajustes</h2>
          <button className="icon-btn" onClick={handleClose} aria-label="Cerrar ajustes" title="Cerrar">
            <CloseIcon size={18} />
          </button>
        </header>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="audio/*,.flac,.m4a,.ogg,.opus,.wav"
          multiple
          onChange={onFileInput}
        />

        <div className="settings-actions">
          {hasFolderSource && (
            <button
              className={`settings-action ${needsSyncPrompt ? 'danger' : ''}`}
              onClick={onSync}
              disabled={isImporting}
            >
              <SyncIcon size={18} />
              <span>{needsSyncPrompt ? 'Reconectar' : 'Buscar canciones nuevas'}</span>
            </button>
          )}
          <button
            className="settings-action"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <MusicNoteIcon size={18} />
            <span>Archivos</span>
          </button>
          <button
            className="settings-action primary"
            onClick={onImportFolder}
            disabled={isImporting}
          >
            <FolderIcon size={18} />
            <span>{canImportFolder() ? 'Importar carpeta' : 'Importar música'}</span>
          </button>
          <button
            className="settings-action artwork"
            onClick={onRecoverArtwork}
            disabled={!hasTracks || missingArtworkCount === 0 || isImporting || isRecoveringArtwork}
          >
            {isRecoveringArtwork ? <SpinnerIcon size={18} /> : <ArtworkIcon size={18} />}
            <span className="settings-action-copy">
              <strong>
                {isRecoveringArtwork && artworkRecoveryProgress
                  ? `Revisando ${artworkRecoveryProgress.processed}/${artworkRecoveryProgress.total}`
                  : 'Recuperar artwork'}
              </strong>
              <small>
                {isRecoveringArtwork && artworkRecoveryProgress
                  ? `${artworkRecoveryProgress.recovered} recuperada${artworkRecoveryProgress.recovered === 1 ? '' : 's'}`
                  : `${missingArtworkCount} canción${missingArtworkCount === 1 ? '' : 'es'} sin artwork`}
              </small>
              {isRecoveringArtwork && artworkRecoveryProgress && artworkRecoveryProgress.total > 0 && (
                <span className="artwork-progress" aria-hidden="true">
                  <span style={{ width: `${(artworkRecoveryProgress.processed / artworkRecoveryProgress.total) * 100}%` }} />
                </span>
              )}
            </span>
          </button>
          <button className="settings-action" onClick={onShowShortcuts}>
            <KeyboardIcon size={18} />
            <span>Atajos de teclado</span>
          </button>

          <button
            className="settings-action danger"
            onClick={onClear}
            disabled={!hasTracks || isImporting}
          >
            <TrashIcon size={18} />
            <span>Limpiar biblioteca</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function HomeRecommendations({
  seedTracks,
  onDownload,
}: {
  seedTracks: Track[];
  onDownload: (track: TidalTrack) => Promise<void>;
}) {
  const [mix, setMix] = useState<Awaited<ReturnType<typeof buildPersonalizedTidalMix>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const seedKey = seedTracks
    .slice(0, 4)
    .map(track => `${track.id}:${track.tidalId ?? ''}`)
    .join('|');

  useEffect(() => {
    if (!seedKey) {
      setMix(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void buildPersonalizedTidalMix(seedTracks, 24)
      .then(nextMix => {
        if (!active) return;
        if (nextMix.tracks.length === 0) {
          setMix(null);
          setError('TIDAL no devolvió recomendaciones esta vez. Puedes intentarlo de nuevo.');
          return;
        }
        setMix(nextMix);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'No pude cargar recomendaciones.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, seedKey]);

  async function downloadRecommendation(track: TidalTrack) {
    setBusyKey(`download:${track.id}`);
    setDownloadMessage(`Buscando el peer más rápido para ${track.title}…`);
    try {
      await onDownload(track);
      setDownloadMessage(`${track.title} ya está en tu biblioteca.`);
    } catch (cause) {
      setDownloadMessage(cause instanceof Error ? cause.message : 'No se pudo descargar la recomendación.');
    } finally {
      setBusyKey('');
    }
  }

  if (!seedKey) return null;

  return (
    <section className="home-section home-recommendations">
      <div className="recommendation-heading">
        <div>
          <span className="eyebrow">Monochrome para ti</span>
          <h2>Hecho para lo que escuchas</h2>
          <p>
            {mix?.seeds.length
              ? `Afinado con ${mix.seeds.slice(0, 3).map(seed => seed.title).join(', ')}. Descarga directa por Soulseek P2P.`
              : 'Buscando conexiones entre tu biblioteca y el catálogo Monochrome.'}
          </p>
        </div>
        <span className="recommendation-download-note"><DownloadIcon size={15} /> Solo descarga</span>
      </div>

      {loading && !mix && (
        <div className="recommendation-state">
          <SpinnerIcon size={20} />
          <span>Conectando tus gustos con TIDAL…</span>
        </div>
      )}

      {error && !mix && (
        <div className="recommendation-state error">
          <span>{error}</span>
          <button onClick={() => setAttempt(value => value + 1)}>Reintentar</button>
        </div>
      )}

      {downloadMessage && mix && (
        <div className="recommendation-download-status">{downloadMessage}</div>
      )}

      {mix && mix.tracks.length > 0 && (
        <div className="recommendation-rail" aria-label="Recomendaciones para ti">
          {mix.tracks.slice(0, 14).map(track => (
            <button key={track.id} className="recommendation-card" onClick={() => void downloadRecommendation(track)} disabled={Boolean(busyKey)}>
              <span className="recommendation-artwork">
                {track.artworkUrl ? (
                  <img src={track.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span>{track.title.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="recommendation-play recommendation-download">
                  {busyKey === `download:${track.id}` ? <SpinnerIcon size={16} /> : <DownloadIcon size={15} />}
                </span>
              </span>
              <strong>{track.title}</strong>
              <small>{track.artist}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Buenas noches';
  if (hour < 12) return 'Buenos días';
  if (hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function HomePanel({
  recentTracks,
  recentlyPlayedTracks,
  recentlyDownloadedTracks,
  currentTrack,
  albums,
  artists,
  playlists,
  activeTrackId,
  isPlaying,
  onPlayTrack,
  onAddToPlaylist,
  onOpenTab,
  onSelectAlbum,
  onSelectArtist,
  getPlaylistTracks,
  onDownloadRecommendation,
  onImport,
  onPlayAlbum,
}: {
  recentTracks: Track[];
  recentlyPlayedTracks: Track[];
  recentlyDownloadedTracks: Track[];
  currentTrack: Track | null;
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onAddToPlaylist: (playlistId: string, trackId: string) => void;
  onOpenTab: (tab: Tab) => void;
  onSelectAlbum: (album: Album) => void;
  onSelectArtist: (artist: Artist) => void;
  getPlaylistTracks: (playlist: Playlist) => Track[];
  onDownloadRecommendation: (track: TidalTrack) => Promise<void>;
  onImport: () => void;
  onPlayAlbum: (album: Album) => void;
}) {
  const isDesktopViewport = useIsDesktopViewport();
  const recommendationAlbums = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10);
    const listeningSignal = [currentTrack?.id, ...recentlyPlayedTracks.map(track => track.id)].filter(Boolean).join('|');
    return shuffleForHome(albums, `${day}|${listeningSignal}`).slice(0, 6);
  }, [albums, currentTrack?.id, recentlyPlayedTracks]);
  const featuredAlbums = recommendationAlbums;
  const featuredArtists = artists.slice(0, 5);
  const featuredPlaylists = playlists.slice(0, 4);
  const recommendationSeeds = useMemo(() => [
    ...(currentTrack ? [currentTrack] : []),
    ...recentTracks.filter(track => track.id !== currentTrack?.id),
  ].slice(0, 4), [currentTrack, recentTracks]);

  if (recentTracks.length === 0) {
    return (
      <section className={isDesktopViewport ? 'circ-home-empty' : 'home-empty'}>
        <div className="home-empty-icon"><HomeIcon size={56} /></div>
        <h2>Tu biblioteca está vacía</h2>
        <p>
          Importa una carpeta de música y aquí aparecerán tus canciones recientes,
          tus álbumes y recomendaciones basadas en lo que escuchas.
        </p>
        <button className="btn btn-primary" onClick={onImport}>Importar música</button>
      </section>
    );
  }

  if (isDesktopViewport) {
    const latestTrack = currentTrack ?? recentlyPlayedTracks[0] ?? recentTracks[0];
    const pickAlbum = (latestTrack && albums.find(album => album.tracks.includes(latestTrack.id))) || albums[0] || null;
    const pickTrack = pickAlbum ? recentTracks.find(track => pickAlbum.tracks.includes(track.id)) : undefined;
    const heroHue = hueFromId(pickAlbum?.id ?? 'staysound');

    return (
      <section className="circ-home">
        {pickAlbum && (
          <div aria-hidden="true" className="circ-home-hero-art">
            <CircleArt size="100%" src={pickAlbum.artwork} hue={heroHue} ring />
          </div>
        )}

        <div className="circ-home-welcome">
          <p className="ss-eyebrow">Bienvenido de vuelta</p>
          <h1>{timeOfDayGreeting()}</h1>

          {pickAlbum && (
            <>
              <p className="ss-eyebrow circ-home-pick-eyebrow">StaySound te sugiere</p>
              <h2>{pickAlbum.name}</h2>
              <p className="circ-home-pick-artist">{pickAlbum.artist}</p>
              <QualityChip quality={formatQualitySpecs(pickTrack)} />
              <div className="circ-home-pick-actions">
                <button type="button" aria-label={`Reproducir ${pickAlbum.name}`} className="circ-home-play" onClick={() => onPlayAlbum(pickAlbum)}>
                  <PlayIcon size={26} />
                </button>
                <button type="button" className="circ-home-pick-link" onClick={() => onSelectAlbum(pickAlbum)}>Ver álbum</button>
              </div>
            </>
          )}
        </div>

        {featuredAlbums.length > 0 && (
          <div className="circ-home-rail">
            <p className="ss-eyebrow">Para esta noche</p>
            <div className="circ-home-rail-row">
              {featuredAlbums.map(album => (
                <CircleTile
                  key={album.id}
                  src={album.artwork}
                  hue={hueFromId(album.id)}
                  title={album.name}
                  subtitle={album.artist}
                  ring={Boolean(currentTrack && album.tracks.includes(currentTrack.id))}
                  onClick={() => onPlayAlbum(album)}
                />
              ))}
              <CarouselChevron onClick={() => onOpenTab('albums')} />
            </div>
          </div>
        )}

        {recentlyPlayedTracks.length > 0 && (
          <div className="circ-home-rail circ-home-history-rail">
            <p className="ss-eyebrow">Reproducidas recientemente</p>
            <div className="circ-home-rail-row">
              {recentlyPlayedTracks.slice(0, 6).map(track => (
                <CircleTile
                  key={track.id}
                  src={track.artwork}
                  hue={hueFromId(track.id)}
                  title={track.title}
                  subtitle={track.artist}
                  ring={track.id === currentTrack?.id}
                  onClick={() => onPlayTrack(track, recentlyPlayedTracks)}
                />
              ))}
              <CarouselChevron onClick={() => onOpenTab('songs')} label="Ver canciones" />
            </div>
          </div>
        )}

        {recentlyDownloadedTracks.length > 0 && (
          <div className="circ-home-rail circ-home-history-rail">
            <p className="ss-eyebrow">Recién descargadas</p>
            <div className="circ-home-rail-row">
              {recentlyDownloadedTracks.slice(0, 6).map(track => (
                <CircleTile
                  key={track.id}
                  src={track.artwork}
                  hue={hueFromId(track.id)}
                  title={track.title}
                  subtitle={track.artist}
                  ring={track.id === currentTrack?.id}
                  onClick={() => onPlayTrack(track, recentlyDownloadedTracks)}
                />
              ))}
              <CarouselChevron onClick={() => onOpenTab('songs')} label="Ver canciones descargadas" />
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="home-view">
      <HomeRecommendations
        seedTracks={recommendationSeeds}
        onDownload={onDownloadRecommendation}
      />

      <section className="home-section">
        <div className="section-heading">
          <h2>Recientes</h2>
          <button onClick={() => onOpenTab('songs')}>Ver todo</button>
        </div>
        <TrackList
          tracks={recentTracks}
          activeTrackId={activeTrackId}
          isPlaying={isPlaying}
          isImporting={false}
          onPlay={track => onPlayTrack(track, recentTracks)}
          playlists={playlists}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>

      {featuredPlaylists.length > 0 && (
        <section className="home-section">
          <div className="section-heading">
            <h2>Playlists</h2>
            <button onClick={() => onOpenTab('playlists')}>Gestionar</button>
          </div>
          <div className="playlist-strip">
            {featuredPlaylists.map(playlist => {
              const playlistQueue = getPlaylistTracks(playlist);
              const firstTrack = playlistQueue[0];
              return (
                <button className="playlist-card" key={playlist.id} onClick={() => onOpenTab('playlists')}>
                  <span className="playlist-art">
                    {firstTrack?.artwork ? <img src={firstTrack.artwork} alt="" loading="lazy" /> : <PlaylistIcon size={26} />}
                  </span>
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>{playlistQueue.length} canción{playlistQueue.length === 1 ? '' : 'es'}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-shelves">
        <div className="home-section">
          <div className="section-heading">
            <h2>Álbumes</h2>
            <button onClick={() => onOpenTab('albums')}>Abrir</button>
          </div>
          <div className="mini-grid">
            {featuredAlbums.map(album => (
              <button key={album.id} className="mini-card" onClick={() => onSelectAlbum(album)}>
                <span className="mini-art">
                  {album.artwork ? <img src={album.artwork} alt="" loading="lazy" /> : album.name.slice(0, 1).toUpperCase()}
                </span>
                <strong>{album.name}</strong>
                <small>{album.artist}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="home-section">
          <div className="section-heading">
            <h2>Artistas</h2>
            <button onClick={() => onOpenTab('artists')}>Abrir</button>
          </div>
          <div className="artist-list-compact">
            {featuredArtists.map(artist => (
              <button key={artist.id} onClick={() => onSelectArtist(artist)}>
                <span>{artist.artwork ? <img src={artist.artwork} alt="" loading="lazy" /> : artist.name.slice(0, 1).toUpperCase()}</span>
                <strong>{artist.name}</strong>
                <small>{artist.trackCount}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

function PlaylistsPanel({
  playlists,
  tracks,
  playableTracks,
  activeTrackId,
  isPlaying,
  onPlayTrack,
  onCreate,
  onRename,
  onDelete,
  onAddTrack,
  onRemoveTrack,
  getPlaylistTracks,
}: {
  playlists: Playlist[];
  tracks: Track[];
  playableTracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onCreate: (name: string, trackIds?: string[], description?: string) => Playlist | null;
  onRename: (playlistId: string, name: string) => void;
  onDelete: (playlistId: string) => void;
  onAddTrack: (playlistId: string, trackId: string) => void;
  onRemoveTrack: (playlistId: string, trackId: string) => void;
  getPlaylistTracks: (playlist: Playlist) => Track[];
}) {
  const [name, setName] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(playlists[0]?.id ?? null);
  const [selectedTrackId, setSelectedTrackId] = useState('');

  const selectedPlaylist = playlists.find(playlist => playlist.id === selectedPlaylistId) ?? playlists[0] ?? null;
  const selectedTracks = selectedPlaylist ? getPlaylistTracks(selectedPlaylist) : [];
  const availableTracks = selectedPlaylist
    ? tracks.filter(track => !selectedPlaylist.trackIds.includes(track.id))
    : tracks;

  useEffect(() => {
    if (!selectedPlaylistId && playlists[0]) {
      setSelectedPlaylistId(playlists[0].id);
      return;
    }
    if (selectedPlaylistId && !playlists.some(playlist => playlist.id === selectedPlaylistId)) {
      setSelectedPlaylistId(playlists[0]?.id ?? null);
    }
  }, [playlists, selectedPlaylistId]);

  function handleCreate() {
    const playlist = onCreate(name);
    if (!playlist) return;
    setName('');
    setSelectedPlaylistId(playlist.id);
  }

  function handleRename() {
    if (!selectedPlaylist) return;
    const nextName = window.prompt('Nuevo nombre de la playlist', selectedPlaylist.name);
    if (nextName) onRename(selectedPlaylist.id, nextName);
  }

  function handleDelete() {
    if (!selectedPlaylist) return;
    const confirmed = window.confirm(`Eliminar "${selectedPlaylist.name}"?`);
    if (confirmed) onDelete(selectedPlaylist.id);
  }

  function handleAddTrack() {
    if (!selectedPlaylist || !selectedTrackId) return;
    onAddTrack(selectedPlaylist.id, selectedTrackId);
    setSelectedTrackId('');
  }

  if (playlists.length === 0) {
    return (
      <section className="playlist-empty">
        <div className="playlist-create-row">
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') handleCreate(); }}
            placeholder="Nombre de la playlist"
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            <PlusIcon size={16} />
            Crear
          </button>
        </div>
        <div className="empty-state compact">
          <div className="empty-state-icon"><PlaylistIcon size={48} /></div>
          <h2>Crea tu primera playlist</h2>
          <p>Las playlists viven en este navegador y usan las canciones de tu biblioteca local.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="playlists-view">
      <aside className="playlist-panel">
        <div className="playlist-create-row">
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') handleCreate(); }}
            placeholder="Nueva playlist"
          />
          <button className="icon-btn" onClick={handleCreate} aria-label="Crear playlist" title="Crear playlist">
            <PlusIcon size={18} />
          </button>
        </div>

        <div className="playlist-list">
          {playlists.map(playlist => {
            const count = getPlaylistTracks(playlist).length;
            return (
              <button
                key={playlist.id}
                className={selectedPlaylist?.id === playlist.id ? 'active' : ''}
                onClick={() => setSelectedPlaylistId(playlist.id)}
              >
                <span className="playlist-dot"><PlaylistIcon size={18} /></span>
                <span>
                  <strong>{playlist.name}</strong>
                <small>{count} {count === 1 ? 'canción' : 'canciones'}</small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="playlist-detail">
        {selectedPlaylist && (
          <>
            <div className="playlist-detail-head">
              <div>
                <span className="eyebrow">Playlist local</span>
                <h2>{selectedPlaylist.name}</h2>
                <p>{selectedTracks.length} {selectedTracks.length === 1 ? 'canción' : 'canciones'} · {formatDuration(selectedTracks.reduce((sum, track) => sum + track.duration, 0))}</p>
              </div>
              <div className="playlist-actions">
                <button
                  className="btn btn-primary"
                  disabled={selectedTracks.length === 0 || playableTracks.length === 0}
                  onClick={() => selectedTracks[0] && onPlayTrack(selectedTracks[0], selectedTracks)}
                >
                  <PlayIcon size={14} />
                  Reproducir
                </button>
                <button className="btn btn-ghost" onClick={handleRename}>Renombrar</button>
                <button className="icon-btn danger" onClick={handleDelete} aria-label="Eliminar playlist" title="Eliminar playlist">
                  <TrashIcon size={17} />
                </button>
              </div>
            </div>

            <div className="playlist-add-row">
              <select value={selectedTrackId} onChange={event => setSelectedTrackId(event.target.value)}>
                <option value="">Agregar canción...</option>
                {availableTracks.map(track => (
                  <option key={track.id} value={track.id}>{track.title} - {track.artist}</option>
                ))}
              </select>
              <button className="btn btn-ghost" onClick={handleAddTrack} disabled={!selectedTrackId}>
                <PlusIcon size={16} />
                Agregar
              </button>
            </div>

            {selectedTracks.length > 0 ? (
              <div className="playlist-track-list">
                {selectedTracks.map((track, index) => {
                  const active = activeTrackId === track.id;
                  return (
                    <div key={track.id} className={`playlist-track ${active ? 'active' : ''}`}>
                      <button onClick={() => onPlayTrack(track, selectedTracks)}>
                        <span className="track-index">{index + 1}</span>
                        <span className="track-thumb">
                          {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : (
                            <span className="track-thumb-letter">{track.title.slice(0, 1).toUpperCase()}</span>
                          )}
                        </span>
                        <span className="track-main">
                          <strong>{track.title}</strong>
                          <small>{track.artist} · {track.album}</small>
                        </span>
                        <span className="track-meta">{active && isPlaying ? 'Sonando' : formatDuration(track.duration)}</span>
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => onRemoveTrack(selectedPlaylist.id, track.id)}
                        aria-label="Quitar de playlist"
                        title="Quitar de playlist"
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <section className="empty-state compact">
                <div className="empty-state-icon"><MusicNoteIcon size={44} /></div>
                <h2>Playlist vacía</h2>
                <p>Agrega canciones de tu biblioteca para armar esta lista.</p>
              </section>
            )}
          </>
        )}
      </section>
    </section>
  );
}

function TidalDiscoveryPanel({
  tracks,
  currentTrack,
  onPlay,
  onPlayQueue,
  onAddToLibrary,
}: {
  tracks: Track[];
  currentTrack: Track | null;
  onPlay: (track: Track) => void;
  onPlayQueue: (first: Track, queue: Track[]) => void;
  onAddToLibrary: (track: Track) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TidalTrack[]>([]);
  const [radioTracks, setRadioTracks] = useState<TidalTrack[]>([]);
  const [seedTrack, setSeedTrack] = useState<TidalTrack | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>('Elige una vibra o busca una canción para arrancar una radio.');

  const seedCandidates = useMemo(() => {
    const richTracks = tracks.filter(track => track.tidalId || track.artist !== 'Unknown Artist');
    return [
      ...(currentTrack ? [currentTrack] : []),
      ...richTracks.filter(track => track.id !== currentTrack?.id),
    ].slice(0, 8);
  }, [currentTrack, tracks]);

  async function resolveDiscoveryTrack(track: TidalTrack): Promise<Track> {
    return await monochromeDownloadProvider.resolveStream(tidalTrackToDownloadResult(track));
  }

  async function handleSearch(searchQuery = query) {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setBusyKey('search');
    setMessage(`Buscando "${trimmed}" en TIDAL...`);
    try {
      const found = await searchTidalTracks(trimmed, 30);
      setResults(found);
      setRadioTracks([]);
      setSeedTrack(null);
      setMessage(found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'} para explorar.` : 'No encontré resultados con esa búsqueda.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falló la búsqueda TIDAL.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleMood(mood: TidalDiscoveryMood) {
    setQuery(mood.query);
    await handleSearch(mood.query);
  }

  async function handleRadioFromTidal(track: TidalTrack) {
    setBusyKey(`radio:${track.id}`);
    setMessage(`Armando radio desde ${track.title}...`);
    try {
      const radio = await buildTidalRadio(track, 36);
      setSeedTrack(track);
      setRadioTracks(radio);
      setResults([]);
      setMessage(`Radio lista: ${radio.length} canciones conectadas por TIDAL.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pude armar la radio.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRadioFromLocal(track: Track) {
    setBusyKey(`local-radio:${track.id}`);
    setMessage(`Buscando una semilla TIDAL para ${track.title}...`);
    try {
      const seed = await findTidalSeedForTrack(track);
      if (!seed) {
        setMessage('No encontré una coincidencia TIDAL para esa canción.');
        return;
      }
      await handleRadioFromTidal(seed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pude iniciar la radio.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRecommendations(track: TidalTrack) {
    setBusyKey(`rec:${track.id}`);
    setMessage(`Buscando recomendaciones para ${track.title}...`);
    try {
      const recs = await getTidalRecommendations(track.id, 30);
      setSeedTrack(track);
      setRadioTracks(recs);
      setResults([]);
      setMessage(recs.length ? `${recs.length} recomendaciones listas.` : 'No encontré recomendaciones para esa canción.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pude cargar recomendaciones.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePlayTidal(track: TidalTrack) {
    setBusyKey(`play:${track.id}`);
    setMessage('Resolviendo stream...');
    try {
      const resolved = await resolveDiscoveryTrack(track);
      onPlay(resolved);
      setMessage(`Reproduciendo ${resolved.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reproducir.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePlayRadio() {
    const queueSource = radioTracks.length > 0 ? radioTracks : results;
    if (queueSource.length === 0) return;
    setBusyKey('play-radio');
    setMessage('Resolviendo radio...');
    try {
      const settled = await Promise.allSettled(queueSource.slice(0, 12).map(resolveDiscoveryTrack));
      const queue = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (!queue[0]) throw new Error('No encontré streams reproducibles para esta radio.');
      onPlayQueue(queue[0], queue);
      setMessage(`Radio sonando con ${queue.length} canciones en cola.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reproducir la radio.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddTidalToLibrary(track: TidalTrack) {
    setBusyKey(`save:${track.id}`);
    setMessage('Agregando a biblioteca...');
    try {
      const resolved = await resolveDiscoveryTrack(track);
      onAddToLibrary(resolved);
      setMessage(`${resolved.title} quedó en tu biblioteca web.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo agregar a biblioteca.');
    } finally {
      setBusyKey(null);
    }
  }

  const activeTracks = radioTracks.length > 0 ? radioTracks : results;

  return (
    <section className="discovery-panel">
      <section className="discovery-hero">
        <div>
          <span className="eyebrow">TIDAL discovery</span>
          <h2>Radio viva para seguir el hilo</h2>
          <p>Busca una canción, usa una de tu biblioteca como semilla o elige una vibra. StaySound arma recomendaciones y las convierte en una cola reproducible.</p>
        </div>
        <button className="btn btn-primary" onClick={handlePlayRadio} disabled={activeTracks.length === 0 || Boolean(busyKey)}>
          {busyKey === 'play-radio' ? <SpinnerIcon size={16} /> : <PlayIcon size={15} />}
          Tocar radio
        </button>
      </section>

      <div className="discovery-search-row">
        <div className="download-search">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void handleSearch(); }}
            placeholder="Busca canción, artista o mood"
          />
          <button className="btn btn-primary" onClick={() => handleSearch()} disabled={busyKey === 'search'}>
            {busyKey === 'search' ? <SpinnerIcon size={16} /> : <SearchIcon size={16} />}
            Buscar
          </button>
        </div>
        <div className="mood-chips" aria-label="Vibras rápidas">
          {TIDAL_DISCOVERY_MOODS.map(mood => (
            <button key={mood.id} onClick={() => void handleMood(mood)} disabled={Boolean(busyKey)} title={mood.description}>
              {mood.label}
            </button>
          ))}
        </div>
      </div>

      {message && <section className="status">{message}</section>}

      {seedCandidates.length > 0 && (
        <section className="discovery-section">
          <div className="section-heading">
            <h2>Semillas de tu biblioteca</h2>
            <small>Radio desde lo que ya escuchas</small>
          </div>
          <div className="seed-strip">
            {seedCandidates.map(track => (
              <button key={track.id} onClick={() => void handleRadioFromLocal(track)} disabled={Boolean(busyKey)}>
                <span className="track-thumb">
                  {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : <span className="track-thumb-letter">{track.title.slice(0, 1).toUpperCase()}</span>}
                </span>
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {seedTrack && (
        <section className="radio-seed">
          <span className="track-thumb">
            {seedTrack.artworkUrl ? <img src={seedTrack.artworkUrl} alt="" loading="lazy" /> : <span className="track-thumb-letter">{seedTrack.title.slice(0, 1).toUpperCase()}</span>}
          </span>
          <div>
            <span className="eyebrow">Radio basada en</span>
            <strong>{seedTrack.title}</strong>
            <small>{seedTrack.artist} · {seedTrack.album}</small>
          </div>
        </section>
      )}

      <section className="discovery-results">
        {activeTracks.map(track => {
          const playBusy = busyKey === `play:${track.id}`;
          return (
            <article className="download-result discovery-result" key={track.id}>
              <span className="track-thumb">
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" loading="lazy" /> : (
                  <span className="track-thumb-letter">{track.title.slice(0, 1).toUpperCase()}</span>
                )}
              </span>
              <span className="download-result-main">
                <strong>{track.title}</strong>
                <small>
                  {track.artist}{track.album ? ` · ${track.album}` : ''}
                  {track.quality ? ` · ${track.quality}` : ''}
                </small>
              </span>
              <span className="download-result-actions">
                <button className="btn btn-ghost" onClick={() => void handlePlayTidal(track)} disabled={Boolean(busyKey)}>
                  {playBusy ? '...' : 'Play'}
                </button>
                <button className="btn btn-ghost" onClick={() => void handleRecommendations(track)} disabled={Boolean(busyKey)}>
                  Recs
                </button>
                <button className="btn btn-primary" onClick={() => void handleRadioFromTidal(track)} disabled={Boolean(busyKey)}>
                  Radio
                </button>
                <button className="icon-btn" onClick={() => void handleAddTidalToLibrary(track)} disabled={Boolean(busyKey)} aria-label="Agregar a biblioteca" title="Agregar a biblioteca">
                  <PlusIcon size={16} />
                </button>
              </span>
            </article>
          );
        })}
      </section>

      {activeTracks.length === 0 && !busyKey && (
        <section className="empty-state compact">
          <div className="empty-state-icon"><SyncIcon size={48} /></div>
          <h2>Arranca una radio</h2>
          <p>Busca algo en TIDAL o usa una semilla de tu biblioteca para generar recomendaciones.</p>
        </section>
      )}
    </section>
  );
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '';
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

/** Circular download-progress indicator (0..1). */
function ProgressRing({ value }: { value: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0.02, Math.min(1, value));
  return (
    <svg className="progress-ring" viewBox="0 0 18 18" width={16} height={16} aria-hidden="true">
      <circle className="progress-ring-track" cx="9" cy="9" r={radius} />
      <circle
        className="progress-ring-fill"
        cx="9"
        cy="9"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  );
}

type DownloadQueueStatus = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';
type DownloadCatalogFilter = 'all' | 'songs' | 'artists' | 'albums';
const SOULSEEK_SHARE_MUSIC_KEY = 'staysound.web.soulseek.share-music-folder.v1';

type DownloadQueueItem = {
  queueId: string;
  source: DownloadSource;
  result: DownloadSearchResult;
  status: DownloadQueueStatus;
  progress: number;
  message?: string;
  activity?: DownloadActivity;
  history: Array<{ at: number; message: string; detail?: string }>;
  startedAt?: number;
  updatedAt: number;
  rawError?: string;
};

const DOWNLOAD_STAGE_LABELS: Record<DownloadActivity['stage'], string> = {
  connecting: 'Conectando',
  peer: 'Buscando fuente',
  transfer: 'Transfiriendo',
  reading: 'Leyendo archivo',
  importing: 'Validando audio',
  metadata: 'Guardando metadatos',
  saving: 'Guardando',
};

function downloadFailureExplanation(item: DownloadQueueItem): string {
  const raw = item.rawError || item.message || '';
  const stage = item.activity?.stage;
  if (/load failed|failed to fetch|fetch is aborted/i.test(raw)) {
    if (stage === 'reading' || stage === 'importing') {
      return 'Soulseek sí entregó el archivo, pero StaySound falló al abrirlo o importarlo en la biblioteca local.';
    }
    return 'StaySound perdió comunicación con el bridge local antes de recibir una respuesta completa.';
  }
  if (/econnreset|connection reset|socket.*closed/i.test(raw)) {
    return 'El peer remoto cerró su conexión. No es un bloqueo global de Soulseek; conviene intentar otra fuente.';
  }
  if (/peer unavailable after address refresh|user not exist/i.test(raw)) {
    return 'Soulseek actualizó la dirección del usuario, pero ese peer ya no estaba conectado. El reintento hará una búsqueda nueva.';
  }
  if (/banned/i.test(raw)) return 'Ese usuario de Soulseek rechazó esta cuenta. Otro peer todavía puede tener el archivo.';
  if (/timeout|tardó demasiado|timed out/i.test(raw)) return 'La fuente no respondió dentro del límite; puede estar offline, en cola o ser muy lenta.';
  if (stage === 'peer' || stage === 'transfer') return 'La fuente P2P seleccionada no pudo completar la transferencia.';
  return `La operación falló durante “${stage ? DOWNLOAD_STAGE_LABELS[stage] : 'resolución'}”.`;
}

function formatDownloadElapsed(item: DownloadQueueItem): string {
  if (!item.startedAt) return 'sin iniciar';
  const seconds = Math.max(1, Math.round((item.updatedAt - item.startedAt) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function getDownloadProvider(source: DownloadSource) {
  return source === 'soulseek' ? soulseekDownloadProvider : monochromeDownloadProvider;
}

function DownloadsPanel({
  onDownloaded,
  onGetApp,
}: {
  onDownloaded: (track: Track) => Promise<void>;
  onGetApp: () => void;
}) {
  const [source] = useState<DownloadSource>('soulseek');
  const [remoteQuery, setRemoteQuery] = useState('');
  const [results, setResults] = useState<DownloadSearchResult[]>([]);
  const [catalogFilter, setCatalogFilter] = useState<DownloadCatalogFilter>('all');
  const [downloadFolder, setDownloadFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [needsFolderPermission, setNeedsFolderPermission] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [showDownloadSettings, setShowDownloadSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [soulseekBridgeReady, setSoulseekBridgeReady] = useState<boolean | null>(null);
  const [soulseekUsername, setSoulseekUsername] = useState(() => loadSoulseekCredentials()?.username ?? '');
  const [soulseekPassword, setSoulseekPassword] = useState(() => loadSoulseekCredentials()?.password ?? '');
  const [hasSoulseekCredentials, setHasSoulseekCredentials] = useState(() => Boolean(loadSoulseekCredentials()));
  const [desktopMusicFolder, setDesktopMusicFolder] = useState<string | null>(null);
  const [shareMusicFolder, setShareMusicFolder] = useState(() => (
    window.localStorage.getItem(SOULSEEK_SHARE_MUSIC_KEY) === '1'
  ));
  const [shareStatus, setShareStatus] = useState<SoulseekShareStatus | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const queueRef = useRef<DownloadQueueItem[]>([]);
  const folderRef = useRef<FileSystemDirectoryHandle | null>(null);
  const processingQueueRef = useRef(false);
  const onDownloadedRef = useRef(onDownloaded);

  const provider = getDownloadProvider(source);
  // Soulseek needs a raw TCP peer connection, which only the bridge bundled with the
  // desktop builds can open. Once the health check has come back negative outside
  // Tauri, retrying is pointless — surface the app download instead of a search UI
  // that can only ever fail. (Local `npm run web:soulseek` still reaches the bridge
  // over http, so that development flow keeps the full panel.)
  const needsDesktopApp = !isTauriDesktop() && soulseekBridgeReady === false;
  const activeDownload = downloadQueue.find(item => item.status === 'resolving' || item.status === 'downloading');
  const queuedCount = downloadQueue.filter(item => item.status === 'queued').length;
  const finishedCount = downloadQueue.filter(item => item.status === 'done').length;
  const failedCount = downloadQueue.filter(item => item.status === 'error').length;
  const queuedPreview = downloadQueue.filter(item => item.status === 'queued').slice(0, 2);
  const latestProblem = [...downloadQueue].reverse().find(item => item.status === 'error');
  const bannerItem = activeDownload ?? queuedPreview[0] ?? latestProblem ?? [...downloadQueue].reverse().find(item => item.status === 'done');
  const bannerProgress = activeDownload
    ? Math.max(3, Math.round(activeDownload.progress * 100))
    : queuedCount > 0
      ? 0
      : downloadQueue.length > 0 && failedCount === 0
        ? 100
        : 0;
  const bannerStatus = activeDownload
    ? activeDownload.status === 'resolving'
      ? 'Resolviendo'
      : `${Math.round(activeDownload.progress * 100)}%`
    : queuedCount > 0
      ? `${queuedCount} en espera`
      : failedCount > 0
        ? `${failedCount} fallida${failedCount === 1 ? '' : 's'}`
        : 'Completado';
  const catalogArtists = useMemo(() => {
    const unique = new Map<string, { name: string; artwork?: string; songCount: number }>();
    for (const result of results) {
      const key = result.artist.trim().toLocaleLowerCase();
      if (!key) continue;
      const current = unique.get(key);
      if (current) {
        current.songCount += 1;
        current.artwork ||= result.artwork;
      } else {
        unique.set(key, { name: result.artist, artwork: result.artwork, songCount: 1 });
      }
    }
    return [...unique.values()];
  }, [results]);
  const catalogAlbums = useMemo(() => {
    const unique = new Map<string, { title: string; artist: string; artwork?: string; songCount: number }>();
    for (const result of results) {
      const album = result.album?.trim();
      if (!album) continue;
      const key = `${result.artist.trim().toLocaleLowerCase()}::${album.toLocaleLowerCase()}`;
      const current = unique.get(key);
      if (current) {
        current.songCount += 1;
        current.artwork ||= result.artwork;
      } else {
        unique.set(key, {
          title: album,
          artist: result.artist,
          artwork: result.artwork,
          songCount: 1,
        });
      }
    }
    return [...unique.values()];
  }, [results]);

  useEffect(() => {
    void getDownloadFolderHandle().then(async handle => {
      if (!handle) return;
      setDownloadFolder(handle);
      setNeedsFolderPermission(!(await verifyDownloadFolderPermission(handle, false)));
    });
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    void getDesktopMusicFolder().then(setDesktopMusicFolder);
  }, []);

  useEffect(() => {
    queueRef.current = downloadQueue;
  }, [downloadQueue]);

  useEffect(() => {
    folderRef.current = downloadFolder;
  }, [downloadFolder]);

  useEffect(() => {
    onDownloadedRef.current = onDownloaded;
  }, [onDownloaded]);

  useEffect(() => {
    if (source !== 'soulseek') return;
    let cancelled = false;
    setSoulseekBridgeReady(null);
    void warmSoulseekBridge()
      .then(() => isSoulseekBridgeAvailable())
      .then(async ready => {
        if (!cancelled) setSoulseekBridgeReady(ready);
        if (ready && shareMusicFolder && desktopMusicFolder) {
          const shares = await configureSoulseekShares([desktopMusicFolder]);
          if (!cancelled) setShareStatus(shares);
        }
      })
      .catch(error => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudo configurar la carpeta compartida.');
      });
    return () => {
      cancelled = true;
    };
  }, [source, shareMusicFolder, desktopMusicFolder]);

  function updateQueueItem(queueId: string, patch: Partial<DownloadQueueItem>) {
    queueRef.current = queueRef.current.map(item => (
      item.queueId === queueId ? { ...item, ...patch } : item
    ));
    setDownloadQueue(items => items.map(item => (
      item.queueId === queueId ? { ...item, ...patch } : item
    )));
  }

  async function ensureDownloadFolder(): Promise<FileSystemDirectoryHandle | null | undefined> {
    let targetFolder = folderRef.current;
    if (canPickDownloadFolder() && !targetFolder) {
      try {
        targetFolder = await pickDownloadFolder();
        setDownloadFolder(targetFolder);
        folderRef.current = targetFolder;
        setNeedsFolderPermission(false);
        setMessage(`Descargas guardadas en "${targetFolder.name}".`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return undefined;
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
        return undefined;
      }
    }
    return targetFolder;
  }

  function enqueueDownloads(items: DownloadSearchResult[]) {
    if (items.length === 0) return;
    const queuedItems = items.map((result, index): DownloadQueueItem => ({
      queueId: `${source}:${result.id}:${Date.now()}:${index}`,
      source,
      result,
      status: 'queued',
      progress: 0,
      message: 'En cola',
      history: [{ at: Date.now(), message: 'Añadida a la cola' }],
      updatedAt: Date.now(),
    }));
    queueRef.current = [...queueRef.current, ...queuedItems];
    setDownloadQueue(queue => [...queue, ...queuedItems]);
    setMessage(`${items.length} descarga${items.length === 1 ? '' : 's'} en cola.`);
  }

  async function processDownloadQueue() {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    try {
      const worker = async () => {
        while (true) {
          const next = queueRef.current.find(item => item.status === 'queued');
          if (!next) return;
          const itemProvider = getDownloadProvider(next.source);
          // updateQueueItem mutates queueRef synchronously, so another worker
          // cannot claim the same item.
          updateQueueItem(next.queueId, { status: 'resolving', progress: 0.03, message: 'Buscando peer rápido...' });
          setMessage(`Descargando cola: ${next.result.title}`);
          try {
            const startedAt = Date.now();
            updateQueueItem(next.queueId, {
              startedAt,
              updatedAt: startedAt,
              history: [...next.history, { at: startedAt, message: 'Buscando coincidencias y fuentes disponibles' }],
            });
            const resolved = await itemProvider.resolveDownload(next.result);
            updateQueueItem(next.queueId, {
              status: 'downloading',
              progress: 0.08,
              message: next.source === 'soulseek' ? 'Contactando fuentes Soulseek...' : 'Preparando servidor de audio...',
              updatedAt: Date.now(),
            });
            const track = await itemProvider.download(resolved, {
              folderHandle: folderRef.current,
              onActivity: activity => {
                const current = queueRef.current.find(item => item.queueId === next.queueId);
                if (!current) return;
                const last = current.history[current.history.length - 1];
                const history = last?.message === activity.message && last?.detail === activity.detail
                  ? current.history
                  : [...current.history, { at: Date.now(), message: activity.message, detail: activity.detail }].slice(-8);
                updateQueueItem(next.queueId, {
                  activity,
                  message: activity.message,
                  history,
                  updatedAt: Date.now(),
                });
              },
              onProgress: value => updateQueueItem(next.queueId, {
                status: 'downloading',
                progress: value,
                updatedAt: Date.now(),
              }),
            });
            // Do not mark a download ready until its catalog entry, artwork,
            // and file handle / native path have been committed to the library.
            await onDownloadedRef.current(track);
            updateQueueItem(next.queueId, { status: 'done', progress: 1, message: 'Guardada en tu biblioteca', updatedAt: Date.now() });
            setMessage(`Descargado: ${track.title}.`);
          } catch (error) {
            updateQueueItem(next.queueId, {
              status: 'error',
              progress: 0,
              message: error instanceof Error ? error.message : 'No se pudo descargar.',
              rawError: error instanceof Error ? error.message : String(error),
              updatedAt: Date.now(),
            });
            setMessage(error instanceof Error ? error.message : 'No se pudo descargar.');
          }
        }
      };
      const concurrency = isTauriDesktop() ? 3 : 1;
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      processingQueueRef.current = false;
      const pending = queueRef.current.some(item => item.status === 'queued');
      if (pending) void processDownloadQueue();
    }
  }

  useEffect(() => {
    if (downloadQueue.some(item => item.status === 'queued')) {
      void processDownloadQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadQueue]);

  async function handlePickDownloadFolder() {
    if (isTauriDesktop()) {
      try {
        const picked = await pickDesktopMusicFolder();
        if (picked) {
          setDesktopMusicFolder(picked);
          setMessage(`Las descargas se guardarán en "${picked}".`);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
      }
      return;
    }
    try {
      const handle = await pickDownloadFolder();
      setDownloadFolder(handle);
      setNeedsFolderPermission(false);
      setMessage(`Descargas guardadas en "${handle.name}".`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta.');
    }
  }

  async function handleSearch() {
    const trimmed = remoteQuery.trim();
    if (!trimmed) return;
    setBusyId('search');
    setMessage('Buscando en Monochrome...');
    try {
      const found = await provider.search(trimmed);
      setResults(found);
      setCatalogFilter('all');
      setMessage(found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'}.` : 'No encontré resultados.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falló la búsqueda.');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Desktop (Tauri) has no showDirectoryPicker: downloads land in the native
   * music folder instead, so all we need is that a folder is remembered —
   * prompting the native picker once if it isn't.
   */
  async function ensureDownloadTarget(): Promise<boolean> {
    if (isTauriDesktop()) {
      const nativeFolder = await getDesktopMusicFolder().catch(() => null);
      if (nativeFolder) return true;
      try {
        const picked = await pickDesktopMusicFolder();
        if (picked) {
          setMessage(`Las descargas se guardarán en "${picked}".`);
          return true;
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo elegir la carpeta de música.');
        return false;
      }
      setMessage('Selecciona tu carpeta de música para guardar las descargas.');
      return false;
    }

    const targetFolder = await ensureDownloadFolder();
    if (!targetFolder) {
      setMessage('Elige una carpeta de descargas para que la música siga disponible al cerrar StaySound.');
      return false;
    }
    return true;
  }

  async function handleDownload(result: DownloadSearchResult) {
    if (!(await ensureDownloadTarget())) return;
    enqueueDownloads([result]);
  }

  async function handleDownloadAll() {
    if (!(await ensureDownloadTarget())) return;
    enqueueDownloads(results);
  }

  function handleClearFinishedDownloads() {
    const nextQueue = downloadQueue.filter(item => item.status !== 'done' && item.status !== 'error');
    queueRef.current = nextQueue;
    setDownloadQueue(nextQueue);
  }

  function handleRetryDownload(queueId: string) {
    const item = queueRef.current.find(entry => entry.queueId === queueId);
    if (!item) return;
    if (item.source === 'soulseek') invalidateSoulseekMatches(item.result);
    const at = Date.now();
    updateQueueItem(queueId, {
      status: 'queued',
      progress: 0,
      message: 'Nuevo intento en cola',
      activity: undefined,
      rawError: undefined,
      startedAt: undefined,
      updatedAt: at,
      history: [{ at, message: 'Reintento solicitado; se volverán a evaluar las fuentes' }],
    });
  }

  function renderDownloadResult(result: DownloadSearchResult, featured = false) {
    const queueItem = downloadQueue.find(item => (
      item.result.id === result.id && item.source === source && item.status !== 'done' && item.status !== 'error'
    ));
    const queuedForResult = Boolean(queueItem);
    const isDownloadingResult = queueItem?.status === 'downloading' || queueItem?.status === 'resolving';

    return (
      <article className={`download-result${featured ? ' featured' : ''}`} key={`${featured ? 'featured-' : ''}${result.id}`}>
        <span className="track-thumb">
          {result.artwork ? <img src={result.artwork} alt="" loading="lazy" /> : (
            <span className="track-thumb-letter">{result.title.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className="download-result-main">
          <strong>{result.title}</strong>
          <small>
            {result.artist}{result.album ? ` · ${result.album}` : ''}
            {result.quality ? ` · ${result.quality}` : ''}
            {result.size ? ` · ${formatBytes(result.size)}` : ''}
          </small>
        </span>
        <span className="download-result-actions">
          <button
            className="btn btn-primary download-action-btn"
            onClick={() => handleDownload(result)}
            disabled={queuedForResult}
          >
            {isDownloadingResult ? (
              <>
                <ProgressRing value={queueItem?.progress ?? 0} />
                {Math.round((queueItem?.progress ?? 0) * 100)}%
              </>
            ) : queuedForResult ? (
              'En cola'
            ) : (
              <>
                <DownloadIcon size={15} />
                Descargar
              </>
            )}
          </button>
        </span>
      </article>
    );
  }

  function handleSaveSoulseekCredentials() {
    try {
      saveSoulseekCredentials(soulseekUsername, soulseekPassword);
      setHasSoulseekCredentials(true);
      setMessage('Sesion de Soulseek guardada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la sesion de Soulseek.');
    }
  }

  async function handleToggleMusicSharing() {
    if (!desktopMusicFolder) {
      setMessage('Selecciona primero tu carpeta de música.');
      return;
    }
    const enabled = !shareMusicFolder;
    setShareBusy(true);
    try {
      const shares = await configureSoulseekShares(enabled ? [desktopMusicFolder] : []);
      setShareMusicFolder(enabled);
      window.localStorage.setItem(SOULSEEK_SHARE_MUSIC_KEY, enabled ? '1' : '0');
      setShareStatus(shares);
      setMessage(enabled
        ? `Soulseek anuncia ${shares.files} archivos de audio en ${shares.folders} carpetas.`
        : 'Tu carpeta de música dejó de compartirse; solo queda la carpeta administrada por StaySound.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cambiar la carpeta compartida.');
    } finally {
      setShareBusy(false);
    }
  }

  async function handleRescanMusicSharing() {
    setShareBusy(true);
    try {
      const shares = await rescanSoulseekShares();
      setShareStatus(shares);
      setMessage(`Reescaneo listo: ${shares.files} archivos de audio en ${shares.folders} carpetas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reescanear la carpeta compartida.');
    } finally {
      setShareBusy(false);
    }
  }

  if (needsDesktopApp) {
    return (
      <section className="downloads-panel">
        <DesktopRequiredNotice onGetApp={onGetApp} />
      </section>
    );
  }

  return (
    <section className="downloads-panel">
      <header className="download-toolbar">
        <div className="download-toolbar-copy">
          <strong>Monochrome + Soulseek P2P</strong>
          <small>Monochrome encuentra la canción; Soulseek descarga el archivo a tu biblioteca local.</small>
        </div>
        <div className="download-controls">
          <div className="download-search">
            <input
              value={remoteQuery}
              onChange={event => setRemoteQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void handleSearch(); }}
              placeholder="Canción, artista o álbum"
            />
            <button className="btn btn-primary" onClick={handleSearch} disabled={busyId === 'search'}>
              <SearchIcon size={16} />
              Buscar
            </button>
          </div>

          <button
            className="icon-btn"
            onClick={() => setShowDownloadSettings(open => !open)}
            aria-label="Opciones de descargas"
            title="Opciones de descargas"
          >
            <GearIcon size={18} />
          </button>

          <button className="btn btn-ghost" onClick={handleDownloadAll} disabled={results.length === 0}>
            <DownloadIcon size={16} />
            Encolar
          </button>
        </div>
      </header>

      {showDownloadSettings && (
        <section className="download-settings">
          <div className="download-settings-head">
            <strong>Opciones</strong>
            {downloadFolder && <small>{downloadFolder.name}</small>}
          </div>
          <button
            className={`settings-action ${needsFolderPermission ? 'danger' : ''}`}
            onClick={handlePickDownloadFolder}
            disabled={!canPickDownloadFolder() && !isTauriDesktop()}
          >
            <FolderIcon size={18} />
            <span>{downloadFolder ? 'Cambiar carpeta' : 'Carpeta destino'}</span>
          </button>

          {source === 'soulseek' && (
            <div className="bridge-config">
              <small>
                {soulseekBridgeReady === null
                  ? 'Conectando con Soulseek...'
                  : soulseekBridgeReady
                    ? 'Soulseek listo'
                    : 'Companion Soulseek no disponible'}
              </small>
              <input value={soulseekUsername} onChange={event => setSoulseekUsername(event.target.value)} placeholder="Usuario Soulseek" />
              <input value={soulseekPassword} onChange={event => setSoulseekPassword(event.target.value)} placeholder="Password Soulseek" type="password" />
              <button className="btn btn-primary" onClick={handleSaveSoulseekCredentials}>
                {hasSoulseekCredentials ? 'Sesion guardada' : 'Guardar sesion'}
              </button>
              {isTauriDesktop() && (
                <section className={`soulseek-share-card ${shareMusicFolder ? 'is-sharing' : ''}`}>
                  <div className="soulseek-share-copy">
                    <strong>{shareMusicFolder ? 'Compartiendo tu música' : 'Comparte tu carpeta de música'}</strong>
                    <small title={desktopMusicFolder ?? undefined}>
                      {desktopMusicFolder ?? 'Todavía no seleccionaste una carpeta'}
                    </small>
                    <span>
                      {shareStatus
                        ? `${shareStatus.files} archivos de audio · ${shareStatus.folders} carpetas anunciadas`
                        : 'Soulseek podrá comprobar que también contribuyes a la red.'}
                    </span>
                  </div>
                  <div className="soulseek-share-actions">
                    <button className="btn btn-primary" onClick={handleToggleMusicSharing} disabled={shareBusy || !hasSoulseekCredentials}>
                      {shareBusy ? 'Escaneando…' : shareMusicFolder ? 'Dejar de compartir' : 'Compartir mi música'}
                    </button>
                    {shareMusicFolder && (
                      <button className="btn btn-ghost" onClick={handleRescanMusicSharing} disabled={shareBusy}>
                        Reescanear
                      </button>
                    )}
                  </div>
                  <small className="soulseek-share-notice">
                    Se anuncian únicamente archivos de audio; comparte solo material que tengas permiso de distribuir.
                  </small>
                </section>
              )}
            </div>
          )}

        </section>
      )}

      {message && (
        <section className="status">
          {message}
        </section>
      )}

      {results.length > 0 && (
        <nav className="download-catalog-tabs" aria-label="Filtrar resultados de búsqueda">
          {([
            ['all', 'Todo'],
            ['songs', 'Canciones'],
            ['artists', 'Artistas'],
            ['albums', 'Álbumes'],
          ] as Array<[DownloadCatalogFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              className={catalogFilter === filter ? 'active' : ''}
              onClick={() => setCatalogFilter(filter)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {downloadQueue.length > 0 && (
        <><section className={`download-queue-banner ${failedCount > 0 ? 'has-error' : ''}`}>
          <div className="download-queue-icon">
            {activeDownload ? <SpinnerIcon size={18} /> : <DownloadIcon size={18} />}
          </div>
          <div className="download-queue-copy">
            <div className="download-queue-line">
              <strong>{bannerItem?.result.title ?? 'Cola de descargas'}</strong>
              <span>{bannerStatus}</span>
            </div>
            <small>
              {bannerItem
                ? `${bannerItem.result.artist}${bannerItem.result.album ? ` · ${bannerItem.result.album}` : ''}`
                : 'Sin descarga activa'}
              {queuedPreview.length > 1 ? ` · Sigue: ${queuedPreview[1].result.title}` : ''}
              {!activeDownload && latestProblem?.message ? ` · ${latestProblem.message}` : ''}
            </small>
            <span className="download-queue-bar" aria-hidden="true">
              <span style={{ width: `${bannerProgress}%` }} />
            </span>
          </div>
          <div className="download-queue-meta" aria-label="Estado de la cola">
            {queuedCount > 0 && <span>{queuedCount} espera</span>}
            {finishedCount > 0 && <span>{finishedCount} listas</span>}
            {failedCount > 0 && <span className="error">{failedCount} error</span>}
          </div>
          <button className="btn btn-ghost" onClick={handleClearFinishedDownloads} disabled={!finishedCount && !failedCount}>
            Limpiar
          </button>
        </section>
        <section className="download-diagnostics" aria-label="Detalles de las descargas">
          {downloadQueue.slice(-5).reverse().map(item => {
            const isFailed = item.status === 'error';
            const activity = item.activity;
            return (
              <article className={`download-diagnostic ${isFailed ? 'is-error' : ''}`} key={`diagnostic-${item.queueId}`}>
                <div className="download-diagnostic-head">
                  <div>
                    <strong>{item.result.title}</strong>
                    <small>{item.result.artist} · {item.source === 'soulseek' ? 'Soulseek P2P' : 'Monochrome'}</small>
                  </div>
                  <span className={`download-diagnostic-state ${item.status}`}>
                    {isFailed
                      ? 'Falló'
                      : item.status === 'done'
                        ? 'Lista'
                        : activity
                          ? DOWNLOAD_STAGE_LABELS[activity.stage]
                          : item.message}
                  </span>
                </div>
                <div className="download-diagnostic-summary">
                  <strong>{isFailed ? downloadFailureExplanation(item) : (activity?.message || item.message)}</strong>
                  {activity?.detail && <span>{activity.detail}</span>}
                  <span>
                    {activity?.peer ? `Peer: ${activity.peer} · ` : ''}
                    {activity?.attempt ? `intento ${activity.attempt} · ` : ''}
                    tiempo: {formatDownloadElapsed(item)}
                  </span>
                  {isFailed && item.rawError && <code>Error técnico: {item.rawError}</code>}
                </div>
                <details className="download-diagnostic-log">
                  <summary>Ver actividad ({item.history.length})</summary>
                  <ol>
                    {item.history.map((entry, index) => (
                      <li key={`${entry.at}-${index}`}>
                        <time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                        <span>{entry.message}{entry.detail ? ` — ${entry.detail}` : ''}</span>
                      </li>
                    ))}
                  </ol>
                </details>
                {isFailed && (
                  <div className="download-diagnostic-actions">
                    <span>Se volverán a evaluar las fuentes disponibles y sus conexiones.</span>
                    <button className="btn btn-primary" onClick={() => handleRetryDownload(item.queueId)}>Reintentar buscando fuentes</button>
                  </div>
                )}
              </article>
            );
          })}
        </section></>
      )}

      {catalogFilter === 'all' && results.length > 0 && (
        <div className="download-catalog">
          <section className="download-catalog-section">
            <h2>Resultado principal</h2>
            {renderDownloadResult(results[0], true)}
          </section>
          <section className="download-catalog-section">
            <h2>Canciones</h2>
            <div className="download-results">
              {results.slice(0, 6).map(result => renderDownloadResult(result))}
            </div>
          </section>
          {catalogArtists.length > 0 && (
            <section className="download-catalog-section">
              <h2>Artistas</h2>
              <div className="download-entity-grid">
                {catalogArtists.slice(0, 8).map(artist => (
                  <article className="download-entity-card artist" key={artist.name}>
                    <span className="download-entity-artwork">
                      {artist.artwork ? <img src={artist.artwork} alt="" loading="lazy" /> : artist.name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{artist.name}</strong>
                    <small>Artista · {artist.songCount} resultado{artist.songCount === 1 ? '' : 's'}</small>
                  </article>
                ))}
              </div>
            </section>
          )}
          {catalogAlbums.length > 0 && (
            <section className="download-catalog-section">
              <h2>Álbumes</h2>
              <div className="download-entity-grid">
                {catalogAlbums.slice(0, 10).map(album => (
                  <article className="download-entity-card" key={`${album.artist}-${album.title}`}>
                    <span className="download-entity-artwork">
                      {album.artwork ? <img src={album.artwork} alt="" loading="lazy" /> : album.title.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{album.title}</strong>
                    <small>{album.artist} · Álbum</small>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {catalogFilter === 'songs' && (
        <div className="download-results">{results.map(result => renderDownloadResult(result))}</div>
      )}

      {catalogFilter === 'artists' && (
        <div className="download-entity-grid">
          {catalogArtists.map(artist => (
            <article className="download-entity-card artist" key={artist.name}>
              <span className="download-entity-artwork">
                {artist.artwork ? <img src={artist.artwork} alt="" loading="lazy" /> : artist.name.slice(0, 1).toUpperCase()}
              </span>
              <strong>{artist.name}</strong>
              <small>Artista · {artist.songCount} resultado{artist.songCount === 1 ? '' : 's'}</small>
            </article>
          ))}
        </div>
      )}

      {catalogFilter === 'albums' && (
        <div className="download-entity-grid">
          {catalogAlbums.map(album => (
            <article className="download-entity-card" key={`${album.artist}-${album.title}`}>
              <span className="download-entity-artwork">
                {album.artwork ? <img src={album.artwork} alt="" loading="lazy" /> : album.title.slice(0, 1).toUpperCase()}
              </span>
              <strong>{album.title}</strong>
              <small>{album.artist} · Álbum</small>
            </article>
          ))}
        </div>
      )}

      {results.length === 0 && !busyId && (
        <section className="empty-state compact download-empty-state">
          <div className="empty-state-icon"><DownloadIcon size={44} /></div>
          <h2>Busca música para descargar</h2>
          <p>Los resultados de Soulseek aparecerán aquí.</p>
        </section>
      )}
    </section>
  );
}
