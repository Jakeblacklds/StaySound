import type { Album, Artist, Playlist, TidalTrack, Track } from '@staysound/types/audio';
import { ChangeEvent, Children, type CSSProperties, isValidElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useWebLibraryStore, type AlacMigrationProgress, type ArtworkRecoveryProgress } from './library/webLibraryStore';
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
  monochromeDownloadProvider,
  soulseekDownloadProvider,
  startSoulseekDesktopSharing,
  type DownloadSearchResult,
  warmSoulseekBridge,
} from './downloads/downloadProvider';
import { isTauriDesktop, pickDesktopMusicFolder } from './desktop/tauriMusicLibrary';
import { checkDesktopUpdate, relaunchDesktop, type DesktopUpdate } from './desktop/tauriUpdater';

import { Sidebar } from './components/Sidebar';
import { GetAppPanel } from './components/GetAppPanel';
import { DownloadsPanel } from './components/downloads/DownloadsPanel';
import { TopNav } from './components/circulo/TopNav';
import { PlayerBarCirculo } from './components/circulo/PlayerBarCirculo';
import { CircleArt, hueFromId } from './components/circulo/CircleArt';
import { CircleTile } from './components/circulo/CircleTile';
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
import { OriginKitDotMatrixBackground } from './components/OriginKitDotMatrixBackground';
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
import { flyArtwork, runMotionTransition } from './motion/motionSystem';
import { useFlipRow } from './motion/useFlipRow';

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

const TAB_ORDER: Tab[] = ['home', 'songs', 'artists', 'albums', 'radio', 'playlists', 'downloads', 'get-app'];

// The Círculo desktop nav merges these four into one "Biblioteca" destination — see TopNav's
// navDestinationForTab — surfaced here as an underline sub-nav (SegmentedTabs).
const LIBRARY_TABS: Tab[] = ['songs', 'artists', 'albums', 'radio'];
const LIBRARY_SEGMENTS: { id: 'albums' | 'songs' | 'artists' | 'radio'; label: string }[] = [
  { id: 'songs', label: 'Canciones' },
  { id: 'artists', label: 'Artistas' },
  { id: 'albums', label: 'Álbumes' },
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
  const lastLibraryTabRef = useRef<Tab>('songs');
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
  const [alacProgress, setAlacProgress] = useState<AlacMigrationProgress | null>(null);
  const [isMigratingAlac, setIsMigratingAlac] = useState(false);
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
    migrateLibraryToAlac,
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
    migrateLibraryToAlac: state.migrateLibraryToAlac,
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
    // Desktop shares with Soulseek for as long as the app is open.
    void startSoulseekDesktopSharing().catch(() => undefined);
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

  const getLibraryTrack = useCallback((id: string) => tracks.get(id), [tracks]);

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

  async function handleMigrateAlac() {
    if (isMigratingAlac) return;
    setIsMigratingAlac(true);
    try {
      setAlacProgress(await migrateLibraryToAlac(setAlacProgress));
    } catch (error) {
      setAlacProgress(current => ({
        processed: current?.processed ?? 0,
        total: current?.total ?? 0,
        converted: current?.converted ?? 0,
        removedEmpty: current?.removedEmpty ?? 0,
        failed: [...(current?.failed ?? []), { name: 'Biblioteca', reason: error instanceof Error ? error.message : String(error) }],
      }));
    } finally {
      setIsMigratingAlac(false);
    }
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
    ? `${filteredTracks.length} ${filteredTracks.length === 1 ? 'canción' : 'canciones'}`
    : tab === 'albums'
      ? `${filteredAlbums.length} ${filteredAlbums.length === 1 ? 'disco' : 'discos'}`
      : tab === 'artists'
        ? `${filteredArtists.length} ${filteredArtists.length === 1 ? 'artista' : 'artistas'}`
        : tab === 'playlists'
          ? `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`
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
            getTrack={getLibraryTrack}
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
          {(LIBRARY_TABS.includes(tab) || tab === 'playlists') && !isDetailView && (
            <header className="collection-header">
              <div>
                <h1>{tab === 'playlists' ? 'Playlists' : 'Biblioteca'}</h1>
                <p>{sectionCount}</p>
              </div>
              {LIBRARY_TABS.includes(tab) && (
                <div className="collection-tools">
                  <label className="collection-search">
                    <SearchIcon size={18} />
                    <input value={query} onChange={event => setQuery(event.target.value)}
                      placeholder="Buscar en tu biblioteca" aria-label="Buscar en biblioteca" />
                  </label>
                  <select value={librarySort}
                    onChange={event => setLibrarySort(event.target.value as 'recent' | 'az')}
                    aria-label="Ordenar biblioteca">
                    <option value="recent">Más recientes</option>
                    <option value="az">Nombre A–Z</option>
                  </select>
                </div>
              )}
            </header>
          )}
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
          {(tab === 'songs' || tab === 'artists' || tab === 'albums' || tab === 'radio') && (
            <div className="mobile-tabs" aria-label="Vistas de biblioteca">
              {(['songs', 'artists', 'albums', 'radio'] as Tab[]).map(item => (
                <button
                  key={item}
                  className={tab === item ? 'active' : ''}
                  onClick={() => handleTabChange(item)}
                  aria-label={item === 'songs' ? 'Canciones' : item === 'artists' ? 'Artistas' : item === 'albums' ? 'Álbumes' : 'Radio'}
                >
                  {item === 'songs' ? <MusicNoteIcon size={18} />
                    : item === 'artists' ? <ArtistIcon size={18} />
                    : item === 'albums' ? <DiscIcon size={18} />
                    : <MusicNoteIcon size={18} />}
                  <span>{item === 'songs' ? 'Canciones' : item === 'artists' ? 'Artistas' : item === 'albums' ? 'Álbumes' : 'Radio'}</span>
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
      {ambientPalette ? (
        <div
          className={`global-listening-atmosphere ${showFullPlayer ? 'player-is-open' : ''}`}
          style={paletteToCssVars(ambientPalette) as CSSProperties}
          aria-hidden="true"
        >
          <div className="global-listening-gradient" />
          {/* The desktop build gets the same OriginKit field the full player
              runs, one step quieter — so opening the player is a zoom into the
              background you were already looking at, not a change of scenery. */}
          {isTauriDesktop() ? (
            <OriginKitDotMatrixBackground
              palette={ambientPalette}
              isPlaying={audio.isPlaying}
              motionKey={audio.currentTrack?.id ?? 'staysound-idle'}
              variant="ambient"
              /* The overlay fades this layer to zero opacity, which stops it
                 being seen but not being drawn: two full-screen shader passes
                 per frame kept running underneath the player's own field, and
                 that is the budget the lyrics were losing. */
              paused={showFullPlayer}
            />
          ) : (
            <AtmosphereCanvas
              palette={ambientPalette}
              isPlaying={audio.isPlaying}
              motionKey={audio.currentTrack?.id ?? 'staysound-idle'}
            />
          )}
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
          flacCount={Array.from(tracks.values()).filter(track => /\.flac$/i.test((track as Track & { nativePath?: string }).nativePath ?? '')).length}
          isMigratingAlac={isMigratingAlac}
          alacProgress={alacProgress}
          onMigrateAlac={isTauriDesktop() ? handleMigrateAlac : undefined}
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
          playlists={playlists}
          onAddToPlaylist={onAddToPlaylist}
          fullPlayerOpen={showFullPlayer}
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
  flacCount,
  isMigratingAlac,
  alacProgress,
  onMigrateAlac,
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
  flacCount: number;
  isMigratingAlac: boolean;
  alacProgress: AlacMigrationProgress | null;
  /** Desktop only: move the library from FLAC to ALAC. */
  onMigrateAlac?: () => void;
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
  const [confirmAlac, setConfirmAlac] = useState(false);
  const handleClose = useCallback(() => {
    if (closing || isMigratingAlac) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  }, [closing, isMigratingAlac, onClose]);

  const alacDone = !isMigratingAlac && alacProgress && alacProgress.processed === alacProgress.total;

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
          {onMigrateAlac && (flacCount > 0 || isMigratingAlac || alacProgress) ? (
            <button
              className={`settings-action artwork ${confirmAlac && !isMigratingAlac ? 'primary' : ''}`}
              onClick={() => {
                if (isMigratingAlac || alacDone && flacCount === 0) return;
                if (!confirmAlac) {
                  setConfirmAlac(true);
                  return;
                }
                setConfirmAlac(false);
                onMigrateAlac();
              }}
              disabled={isImporting || isMigratingAlac}
            >
              {isMigratingAlac ? <SpinnerIcon size={18} /> : <SyncIcon size={18} />}
              <span className="settings-action-copy">
                <strong>
                  {isMigratingAlac && alacProgress
                    ? `Convirtiendo ${alacProgress.processed}/${alacProgress.total}`
                    : alacDone
                      ? `Listo: ${alacProgress!.converted} en ALAC`
                      : confirmAlac
                        ? `Convertir ${flacCount} a ALAC`
                        : 'Pasar la biblioteca a ALAC'}
                </strong>
                <small>
                  {isMigratingAlac
                    ? 'Cada copia se verifica antes de mandar el FLAC a la Papelera.'
                    : alacDone
                      ? [
                        alacProgress!.removedEmpty ? `${alacProgress!.removedEmpty} vacías a la Papelera` : '',
                        alacProgress!.failed.length ? `${alacProgress!.failed.length} sin convertir` : 'sin errores',
                      ].filter(Boolean).join(' · ')
                      : confirmAlac
                        ? 'Mismo audio, sin pérdida. Los FLAC irán a la Papelera. Toca otra vez para empezar.'
                        : `${flacCount} canción${flacCount === 1 ? '' : 'es'} en FLAC · saltos exactos en la letra`}
                </small>
                {isMigratingAlac && alacProgress && alacProgress.total > 0 && (
                  <span className="artwork-progress" aria-hidden="true">
                    <span style={{ width: `${(alacProgress.processed / alacProgress.total) * 100}%` }} />
                  </span>
                )}
                {alacDone && alacProgress!.failed.length ? (
                  <small className="settings-action-details">
                    {alacProgress!.failed.slice(0, 4).map(item => `${item.name}: ${item.reason}`).join(' · ')}
                  </small>
                ) : null}
              </span>
            </button>
          ) : null}
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

/** Untagged files land in the library as "Unknown Album", and Home was printing that
    placeholder as the largest type on the screen. Fall back to something that is
    actually about the music — the track we would play, then the artist. */
const PLACEHOLDER_ALBUM_NAMES = new Set([
  'unknown album',
  'unknown',
  'untitled',
  'álbum desconocido',
  'album desconocido',
]);

function heroCopy(album: Album, track?: Track | null): { title: string; subtitle: string } {
  const name = album.name?.trim() ?? '';
  const artist = album.artist?.trim() ?? '';
  if (name && !PLACEHOLDER_ALBUM_NAMES.has(name.toLowerCase())) return { title: name, subtitle: artist };
  const trackTitle = track?.title?.trim();
  if (trackTitle) return { title: trackTitle, subtitle: artist };
  return { title: artist || 'Tu música', subtitle: 'En tu biblioteca' };
}

/** A rail on Círculo's home: section title on the left, its "see everything" action on
    the right, and the scroller underneath. The action used to be a lone grey circle
    parked after the last tile, where it read as a tile with broken artwork. */
function CircHomeRail({ title, actionLabel, onAction, className, flip = false, children }: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
  /** Slide tiles to their new slot when the order changes (the history rail). */
  flip?: boolean;
  children: ReactNode;
}) {
  const orderSignature = Children.toArray(children).map(child => (isValidElement(child) ? String(child.key) : '')).join('|');
  const rowRef = useFlipRow<HTMLDivElement>(orderSignature, flip);
  return (
    <div className={`circ-home-rail ${className ?? ''}`.trim()}>
      <div className="circ-section-head">
        <h2 className="circ-section-title">{title}</h2>
        <button type="button" className="circ-section-more" onClick={onAction}>{actionLabel}</button>
      </div>
      <div className="circ-home-rail-row" ref={rowRef}>{children}</div>
    </div>
  );
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
  getTrack,
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
  getTrack: (id: string) => Track | undefined;
}) {
  const isDesktopViewport = useIsDesktopViewport();
  const recommendationAlbums = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10);
    const listeningSignal = [currentTrack?.id, ...recentlyPlayedTracks.map(track => track.id)].filter(Boolean).join('|');
    // Nine, not six: the desktop rail is wide enough for seven tiles at 1650px, and the
    // extra ones are what give its horizontal scroll somewhere to go.
    return shuffleForHome(albums, `${day}|${listeningSignal}`).slice(0, 9);
  }, [albums, currentTrack?.id, recentlyPlayedTracks]);
  const featuredAlbums = recommendationAlbums;
  const featuredArtists = artists.slice(0, 5);
  const featuredPlaylists = playlists.slice(0, 4);
  const recommendationSeeds = useMemo(() => [
    ...(currentTrack ? [currentTrack] : []),
    ...recentTracks.filter(track => track.id !== currentTrack?.id),
  ].slice(0, 4), [currentTrack, recentTracks]);

  // Hoisted above the early returns below so the hero's palette hook can depend on it.
  /* The hero never repeats what the player already shows. While something plays it
     becomes a suggestion — another album by the same artist, one you played lately,
     or a stable pick from the library — seeded by the playing album so it holds
     still across that album's tracks and only changes when the album does. With
     nothing playing it resumes the last thing you listened to. */
  const heroPick = useMemo(() => {
    const albumOf = (track: Track | null | undefined) =>
      (track && albums.find(item => item.tracks.includes(track.id))) || null;
    const firstTrackOf = (album: Album | null) => album
      ? album.tracks
        .map(getTrack)
        .filter((track): track is Track => Boolean(track))
        .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))[0] ?? null
      : null;

    const playingAlbum = albumOf(currentTrack);
    let album: Album | null;
    let reason: string | null = null;
    if (currentTrack && playingAlbum) {
      const others = albums.filter(item => item.id !== playingAlbum.id);
      const sameArtist = others.filter(item => item.artist && item.artist === playingAlbum.artist);
      const recent: Album[] = [];
      for (const track of recentlyPlayedTracks) {
        const candidate = albumOf(track);
        if (candidate && candidate.id !== playingAlbum.id && !recent.includes(candidate)) recent.push(candidate);
        if (recent.length >= 3) break;
      }
      const pool = [...sameArtist, ...recent.filter(item => !sameArtist.includes(item))];
      const day = new Date().toISOString().slice(0, 10);
      const picked = shuffleForHome(pool.length > 0 ? pool : others, `${day}|hero|${playingAlbum.id}`)[0] ?? null;
      album = picked ?? playingAlbum;
      if (picked) {
        reason = sameArtist.includes(picked)
          ? `Más de ${picked.artist}`
          : recent.includes(picked) ? 'Vuelve a escucharlo' : 'Para descubrir';
      }
    } else {
      const seedTrack = recentlyPlayedTracks[0] ?? recentTracks[0] ?? null;
      album = albumOf(seedTrack) || albums[0] || null;
      if (album && recentlyPlayedTracks.length > 0) reason = 'Sigue donde lo dejaste';
    }
    return { album, track: firstTrackOf(album), reason };
  }, [albums, currentTrack, getTrack, recentlyPlayedTracks, recentTracks]);

  /* The accent used to come from --dyn-accent, which is extracted from whatever is
     *playing* — not from the cover the hero is actually showing. When those differ you
     get a pink play button over a green sleeve. Home now tints itself from its own hero,
     while the nav and player bar keep tracking playback. Keyed on primitives so the seed
     object stays referentially stable across renders. */
  const heroAlbumId = heroPick.album?.id ?? null;
  const heroAlbumArtwork = heroPick.album?.artwork ?? null;
  const heroAlbumName = heroPick.album?.name ?? '';
  const heroAlbumArtist = heroPick.album?.artist ?? '';
  const heroPaletteSeed = useMemo<Track | null>(() => (
    heroAlbumId && heroAlbumArtwork
      ? {
          id: `album:${heroAlbumId}`,
          uri: '',
          title: heroAlbumName,
          artist: heroAlbumArtist,
          album: heroAlbumName,
          duration: 0,
          dateAdded: 0,
          artwork: heroAlbumArtwork,
        }
      : null
  ), [heroAlbumId, heroAlbumArtwork, heroAlbumName, heroAlbumArtist]);
  const [heroAccent, setHeroAccent] = useState<string | null>(null);

  useEffect(() => {
    if (!heroPaletteSeed) {
      setHeroAccent(null);
      return;
    }
    let cancelled = false;
    void getDynamicPalette(heroPaletteSeed).then(palette => {
      if (!cancelled) setHeroAccent(palette.accent);
    });
    return () => { cancelled = true; };
  }, [heroPaletteSeed]);

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
    const { album: pickAlbum, track: pickTrack, reason: heroReason } = heroPick;
    const heroHue = hueFromId(pickAlbum?.id ?? 'staysound');
    const hero = pickAlbum ? heroCopy(pickAlbum, pickTrack) : null;
    // Keep the featured album out of the rail immediately below it.
    const nightAlbums = featuredAlbums.filter(album => album.id !== pickAlbum?.id).slice(0, 8);
    // The playing track leads its own history: pressing a song elsewhere on Home
    // slides it to the front of this rail instead of leaving it out of it.
    const historyTracks = [
      ...(currentTrack ? [currentTrack] : []),
      ...recentlyPlayedTracks.filter(track => track.id !== currentTrack?.id),
    ].slice(0, 8);
    const playWithFlight = (source: HTMLElement | null, isCurrent: boolean, play: () => void) => {
      if (!source || isCurrent) play();
      else flyArtwork(source, '.circ-pb-art', play);
    };
    const downloadedTracks = recentlyDownloadedTracks.slice(0, 8);

    return (
      <section
        className="circ-home"
        style={{ '--hero-accent': heroAccent ?? 'var(--dyn-accent, #f9a8d4)' } as CSSProperties}
      >
        {pickAlbum && (
          <div aria-hidden="true" className="circ-home-hero-art" key={pickAlbum.id}>
            <CircleArt size="100%" src={pickAlbum.artwork} hue={heroHue} ring />
          </div>
        )}

        <div className="circ-home-welcome">
          {pickAlbum && hero ? (
            <>
              <p className="circ-home-greeting">
                <span className="circ-home-greeting-text">{timeOfDayGreeting()}</span>
                {heroReason ? <span className="circ-home-reason" key={heroReason}>{heroReason}</span> : null}
              </p>
              <div className="circ-home-welcome-body" key={pickAlbum.id}>
                <h1>{hero.title}</h1>
                <p className="circ-home-pick-artist">{hero.subtitle}</p>
                <QualityChip quality={formatQualitySpecs(pickTrack)} />
                <div className="circ-home-pick-actions">
                  <button
                    type="button"
                    aria-label={`Reproducir ${hero.title}`}
                    className="circ-home-play"
                    onClick={() => playWithFlight(
                      document.querySelector<HTMLElement>('.circ-home-hero-art'),
                      Boolean(currentTrack && pickAlbum.tracks.includes(currentTrack.id)),
                      () => onPlayAlbum(pickAlbum),
                    )}
                  >
                    <PlayIcon size={20} />
                    <span>Reproducir</span>
                  </button>
                  <button type="button" className="circ-home-pick-link" onClick={() => onSelectAlbum(pickAlbum)}>Ver álbum</button>
                </div>
              </div>
            </>
          ) : (
            <h1 className="circ-home-greeting-solo">{timeOfDayGreeting()}</h1>
          )}
        </div>

        {nightAlbums.length > 0 && (
          <CircHomeRail title="De tu biblioteca" actionLabel="Ver todos" onAction={() => onOpenTab('albums')}>
            {nightAlbums.map(album => (
              <CircleTile
                key={album.id}
                src={album.artwork}
                hue={hueFromId(album.id)}
                title={album.name}
                subtitle={album.artist}
                ring={Boolean(currentTrack && album.tracks.includes(currentTrack.id))}
                onClick={source => playWithFlight(
                  source,
                  Boolean(currentTrack && album.tracks.includes(currentTrack.id)),
                  () => onPlayAlbum(album),
                )}
              />
            ))}
          </CircHomeRail>
        )}

        {historyTracks.length > 0 && (
          <CircHomeRail
            className="circ-home-history-rail"
            flip
            title="Reproducidas recientemente"
            actionLabel="Ver todas"
            onAction={() => onOpenTab('songs')}
          >
            {historyTracks.map(track => (
              <CircleTile
                key={track.id}
                flipKey={track.id}
                src={track.artwork}
                hue={hueFromId(track.id)}
                title={track.title}
                subtitle={track.artist}
                ring={track.id === currentTrack?.id}
                onClick={source => playWithFlight(source, track.id === currentTrack?.id, () => onPlayTrack(track, historyTracks))}
              />
            ))}
          </CircHomeRail>
        )}

        {downloadedTracks.length > 0 && (
          <CircHomeRail
            className="circ-home-history-rail"
            title="Recién descargadas"
            actionLabel="Ver todas"
            onAction={() => onOpenTab('songs')}
          >
            {downloadedTracks.map(track => (
              <CircleTile
                key={track.id}
                src={track.artwork}
                hue={hueFromId(track.id)}
                title={track.title}
                subtitle={track.artist}
                ring={track.id === currentTrack?.id}
                onClick={source => playWithFlight(source, track.id === currentTrack?.id, () => onPlayTrack(track, downloadedTracks))}
              />
            ))}
          </CircHomeRail>
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
            aria-label="Nombre de la playlist"
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            <PlusIcon size={16} />
            Crear
          </button>
        </div>
        <div className="empty-state compact">
          <div className="empty-state-icon"><PlaylistIcon size={48} /></div>
          <h2>Crea tu primera playlist</h2>
          <p>Reúne tus canciones favoritas de la biblioteca en una lista.</p>
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
            aria-label="Nombre de la nueva playlist"
          />
          <button className="icon-btn" onClick={handleCreate} aria-label="Crear playlist" title="Crear playlist">
            <PlusIcon size={18} />
          </button>
        </div>

        <div className="playlist-list">
          {playlists.map(playlist => {
            const tracks = getPlaylistTracks(playlist);
            const count = tracks.length;
            const artwork = tracks.find(track => track.artwork)?.artwork;
            return (
              <button
                key={playlist.id}
                className={selectedPlaylist?.id === playlist.id ? 'active' : ''}
                aria-pressed={selectedPlaylist?.id === playlist.id}
                onClick={() => setSelectedPlaylistId(playlist.id)}
              >
                <span className="playlist-dot">{artwork ? <img src={artwork} alt="" /> : <PlaylistIcon size={18} />}</span>
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
              <div className="playlist-cover" aria-hidden="true">
                {selectedTracks.find(track => track.artwork)?.artwork
                  ? <img src={selectedTracks.find(track => track.artwork)!.artwork} alt="" />
                  : <PlaylistIcon size={48} />}
              </div>
              <div className="playlist-heading">
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
              <select aria-label="Canción para agregar a la playlist" value={selectedTrackId} onChange={event => setSelectedTrackId(event.target.value)}>
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
