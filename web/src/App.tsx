import type { Album, Artist, Playlist, TidalTrack, Track } from '@staysound/types/audio';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@staysound/services/metadataService';
import { getDynamicPalette } from './library/dynamicColors';
import {
  canImportFolder,
  collectDirectoryAudioFiles,
  fileToRestoredTrack,
  fileToTrack,
  hashFileIdentity,
  importFiles,
  importFolder,
} from './library/importLocalFiles';
import { getFolderHandle, saveFolderHandle, verifyPermission } from './library/webFolderSync';
import { useWebLibraryStore } from './library/webLibraryStore';
import {
  buildTidalRadio,
  findTidalSeedForTrack,
  getTidalRecommendations,
  searchTidalTracks,
  tidalTrackToDownloadResult,
  TIDAL_DISCOVERY_MOODS,
  type TidalDiscoveryMood,
} from './library/tidalDiscovery';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  loadAmazonMusicConfig,
  loadSoulseekBridgeConfig,
  loadSoulseekCredentials,
  monochromeDownloadProvider,
  saveAmazonMusicConfig,
  saveSoulseekCredentials,
  saveSoulseekBridgeConfig,
  soulseekDownloadProvider,
  type DownloadSearchResult,
  type DownloadSource,
} from './downloads/downloadProvider';
import {
  canPickDownloadFolder,
  getDownloadFolderHandle,
  pickDownloadFolder,
  verifyDownloadFolderPermission,
} from './downloads/webDownloadFolder';

import { Sidebar } from './components/Sidebar';
import { TrackList } from './components/TrackList';
import { AlbumGrid } from './components/AlbumGrid';
import { AlbumDetail } from './components/AlbumDetail';
import { ArtistGrid } from './components/ArtistGrid';
import { ArtistDetail } from './components/ArtistDetail';
import { PlayerBar } from './components/PlayerBar';
import { FullPlayer } from './components/FullPlayer';
import { QueueDrawer } from './components/QueueDrawer';
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
  TrashIcon,
} from './components/icons';
import type { Tab } from './components/types';

function normalize(value: string): string {
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
};

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLibrarySettings, setShowLibrarySettings] = useState(false);
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

  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
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
    audio,
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
    playAtIndex,
    setVolume,
    cycleRepeatMode,
    toggleShuffle,
    recoverMissingArtwork,
    hydrateArtistPhotos,
    hydrateLibrary,
  } = useWebLibraryStore();

  useEffect(() => {
    async function restoreLibrary() {
      // The IndexedDB library is authoritative. Opening the PWA hydrates this
      // catalog only; it never walks files or rebuilds a second "downloads"
      // library in the background.
      await hydrateLibrary();
    }

    async function checkSavedFolder() {
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
    if (!audio.currentTrack) {
      DYNAMIC_VARS.forEach(name => root.style.removeProperty(name));
      return;
    }
    let active = true;
    void getDynamicPalette(audio.currentTrack).then(palette => {
      if (!active) return;
      root.style.setProperty('--dyn-primary', palette.primary);
      root.style.setProperty('--dyn-secondary', palette.secondary);
      root.style.setProperty('--dyn-accent', palette.accent);
      root.style.setProperty('--dyn-bg', palette.background);
      root.style.setProperty('--dyn-bg-alt', palette.backgroundAlt);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId, currentTrackArtwork]);

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
    if (!normalizedQuery) return trackList;
    return trackList.filter(track =>
      normalize(`${track.title} ${track.artist} ${track.album}`).includes(normalizedQuery),
    );
  }, [normalizedQuery, trackList]);

  const filteredAlbums = useMemo(() => {
    if (!normalizedQuery) return albumList;
    return albumList.filter(album =>
      normalize(`${album.name} ${album.artist}`).includes(normalizedQuery),
    );
  }, [albumList, normalizedQuery]);

  const filteredArtists = useMemo(() => {
    if (!normalizedQuery) return artistList;
    return artistList.filter(artist => normalize(artist.name).includes(normalizedQuery));
  }, [artistList, normalizedQuery]);

  const recentTracks = useMemo(
    () => [...trackList].sort((a, b) => b.dateAdded - a.dateAdded).slice(0, 8),
    [trackList],
  );

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
    const message = audio.error || importMessage || '';
    const skipped = skippedFiles > 0
      ? `${skippedFiles} archivo${skippedFiles === 1 ? '' : 's'} omitido${skippedFiles === 1 ? '' : 's'}.`
      : '';
    return [message, skipped].filter(Boolean).join(' ');
  }, [audio.error, importMessage, skippedFiles]);

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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setImporting(false, null);
        return;
      }
      setImporting(false, 'Este navegador no dejó abrir carpetas. Prueba seleccionar archivos.');
      fileInputRef.current?.click();
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

  function playFromList(track: Track, contextQueue?: Track[]) {
    const queue = contextQueue ?? filteredTracks;
    playTrack(track, queue);
  }

  // --- Album / Artist navigation ---
  function handleSelectAlbum(album: Album) {
    setSelectedAlbum(album);
    setSelectedArtist(null);
  }
  function handleSelectArtist(artist: Artist) {
    setSelectedArtist(artist);
    setSelectedAlbum(null);
  }
  function handleBackFromAlbum() {
    setSelectedAlbum(null);
  }
  function handleBackFromArtist() {
    setSelectedArtist(null);
  }

  // --- Tab change resets detail views ---
  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setSelectedAlbum(null);
    setSelectedArtist(null);
  }

  // --- Keyboard shortcuts ---
  const keyHandlers = useMemo(() => ({
    onTogglePlayback: togglePlayback,
    onNext: next,
    onPrevious: previous,
    onSeekForward: () => seek(audio.position + 5000),
    onSeekBackward: () => seek(Math.max(0, audio.position - 5000)),
    onVolumeUp: () => setVolume(Math.min(1, audio.volume + 0.05)),
    onVolumeDown: () => setVolume(Math.max(0, audio.volume - 0.05)),
    onToggleMute: () => setVolume(audio.volume > 0 ? 0 : 0.9),
    onToggleFullPlayer: () => setShowFullPlayer(v => !v),
    onToggleQueue: () => setShowQueue(v => !v),
    getVolume: () => audio.volume,
  }), [togglePlayback, next, previous, seek, setVolume, audio.position, audio.volume]);

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
      await recoverMissingArtwork();
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
            albums={albumList}
            artists={artistList}
            playlists={playlists}
            activeTrackId={audio.currentTrack?.id}
            isPlaying={audio.isPlaying}
            onPlayTrack={(track, queue) => playFromList(track, queue)}
            onAddToPlaylist={addTrackToPlaylist}
            onOpenTab={handleTabChange}
            onSelectAlbum={album => { setTab('albums'); handleSelectAlbum(album); }}
            onSelectArtist={artist => { setTab('artists'); handleSelectArtist(artist); }}
            getPlaylistTracks={playlistTracks}
          />
        );
      case 'songs':
        return (
          <TrackList
            tracks={filteredTracks}
            activeTrackId={audio.currentTrack?.id}
            isPlaying={audio.isPlaying}
            onPlay={playFromList}
            isImporting={isImporting}
            playlists={playlists}
            onAddToPlaylist={addTrackToPlaylist}
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
            onPlay={track => playTrack(track, [track])}
            onDownloaded={track => addTrack(track)}
          />
        );
    }
  }

  return (
    <>
      <main className="app-shell">
        <Sidebar tab={tab} onTabChange={handleTabChange} />

        <section className="content">
          <header className="toolbar">
            <div className="toolbar-left">
              <span className="eyebrow">Tu música local</span>
              <h1 key={tab}>{tabCopy.title}</h1>
              {tab !== 'home' && <p key={`sub-${tab}`} className="toolbar-subtitle">{tabCopy.subtitle}</p>}
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
                    placeholder="Buscar en biblioteca"
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
              <button
                className="icon-btn"
                onClick={() => setShowLibrarySettings(true)}
                aria-label="Ajustes de biblioteca"
                title="Ajustes de biblioteca"
              >
                <GearIcon size={18} />
              </button>
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
          </header>

          {/* Mobile tabs */}
          <div className="mobile-tabs">
            {(['home', 'songs', 'albums', 'artists', 'playlists', 'radio', 'downloads'] as Tab[]).map(item => (
              <button
                key={item}
                className={tab === item ? 'active' : ''}
                onClick={() => handleTabChange(item)}
                aria-label={item}
              >
                {item === 'home' ? <HomeIcon size={18} />
                  : item === 'songs' ? <MusicNoteIcon size={18} />
                  : item === 'albums' ? <DiscIcon size={18} />
                  : item === 'artists' ? <ArtistIcon size={18} />
                  : item === 'playlists' ? <PlaylistIcon size={18} />
                  : item === 'radio' ? <SyncIcon size={18} />
                  : <DownloadIcon size={18} />}
              </button>
            ))}
          </div>

          <div
            key={`${tab}:${selectedAlbum?.id ?? ''}:${selectedArtist?.id ?? ''}`}
            className="view"
          >
            {renderContent()}
          </div>
        </section>
      </main>

      {/* Player Bar */}
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
        onOpenFullPlayer={() => setShowFullPlayer(true)}
        onOpenQueue={() => setShowQueue(true)}
      />

      {/* Full Player */}
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
          onClose={() => setShowFullPlayer(false)}
          onOpenQueue={() => setShowQueue(true)}
          playlists={playlists}
          onAddToPlaylist={addTrackToPlaylist}
        />
      )}

      {/* Queue Drawer */}
      {showQueue && (
        <QueueDrawer
          queue={audio.queue}
          currentIndex={audio.queueIndex}
          isPlaying={audio.isPlaying}
          onPlayIndex={playAtIndex}
          onClose={() => setShowQueue(false)}
        />
      )}

      {showStatusToast && (
        <section className={`status-toast ${audio.error ? 'error' : ''}`} role="status">
          {toastMessage}
        </section>
      )}

      {showLibrarySettings && (
        <LibrarySettingsModal
          fileInputRef={fileInputRef}
          folderHandle={folderHandle}
          needsSyncPrompt={needsSyncPrompt}
          isImporting={isImporting}
          isRecoveringArtwork={isRecoveringArtwork}
          hasTracks={trackList.length > 0}
          onClose={() => setShowLibrarySettings(false)}
          onFileInput={handleFileInput}
          onSync={() => folderHandle && handleFolderSync(folderHandle, true)}
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

function OnboardingModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: () => void;
}) {
  return (
    <div className="onboarding-overlay" role="presentation" onClick={onClose}>
      <section
        className="onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="onboarding-head">
          <span className="brand-mark">S</span>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar guía" title="Cerrar">
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
          <button className="btn btn-primary" onClick={onImport}>
            <FolderIcon size={16} />
            Importar música
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Entrar</button>
        </footer>
      </section>
    </div>
  );
}

function LibrarySettingsModal({
  fileInputRef,
  folderHandle,
  needsSyncPrompt,
  isImporting,
  isRecoveringArtwork,
  hasTracks,
  onClose,
  onFileInput,
  onSync,
  onImportFolder,
  onRecoverArtwork,
  onClear,
}: {
  fileInputRef: { current: HTMLInputElement | null };
  folderHandle: FileSystemDirectoryHandle | null;
  needsSyncPrompt: boolean;
  isImporting: boolean;
  isRecoveringArtwork: boolean;
  hasTracks: boolean;
  onClose: () => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onSync: () => void;
  onImportFolder: () => void;
  onRecoverArtwork: () => void;
  onClear: () => void;
}) {
  return (
    <div className="settings-modal-overlay" role="presentation" onClick={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-settings-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="settings-modal-head">
          <h2 id="library-settings-title">Ajustes</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar ajustes" title="Cerrar">
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
          {folderHandle && (
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
            disabled={!hasTracks || isImporting || isRecoveringArtwork}
          >
            {isRecoveringArtwork ? <SpinnerIcon size={18} /> : <ArtworkIcon size={18} />}
            <span>{isRecoveringArtwork ? 'Recuperando...' : 'Recuperar artwork'}</span>
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

function HomePanel({
  recentTracks,
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
}: {
  recentTracks: Track[];
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
}) {
  const featuredAlbums = albums.slice(0, 6);
  const featuredArtists = artists.slice(0, 5);
  const featuredPlaylists = playlists.slice(0, 4);

  if (recentTracks.length === 0) {
    return (
      <section className="home-empty">
        <div className="home-empty-icon"><HomeIcon size={56} /></div>
      </section>
    );
  }

  return (
    <section className="home-view">
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
                  <small>{count} canción{count === 1 ? '' : 'es'}</small>
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
                <p>{selectedTracks.length} canción{selectedTracks.length === 1 ? '' : 'es'} · {formatDuration(selectedTracks.reduce((sum, track) => sum + track.duration, 0))}</p>
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

type DownloadQueueStatus = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';

type DownloadQueueItem = {
  queueId: string;
  source: DownloadSource;
  result: DownloadSearchResult;
  status: DownloadQueueStatus;
  progress: number;
  message?: string;
};

function getDownloadProvider(source: DownloadSource) {
  return source === 'monochrome' ? monochromeDownloadProvider : soulseekDownloadProvider;
}

function DownloadsPanel({
  onPlay,
  onDownloaded,
}: {
  onPlay: (track: Track) => void;
  onDownloaded: (track: Track) => Promise<void>;
}) {
  const [source, setSource] = useState<DownloadSource>('monochrome');
  const [remoteQuery, setRemoteQuery] = useState('');
  const [results, setResults] = useState<DownloadSearchResult[]>([]);
  const [downloadFolder, setDownloadFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [needsFolderPermission, setNeedsFolderPermission] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([]);
  const [showDownloadSettings, setShowDownloadSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bridgeBaseUrl, setBridgeBaseUrl] = useState(() => loadSoulseekBridgeConfig().baseUrl);
  const [soulseekUsername, setSoulseekUsername] = useState(() => loadSoulseekCredentials()?.username ?? '');
  const [soulseekPassword, setSoulseekPassword] = useState(() => loadSoulseekCredentials()?.password ?? '');
  const [hasSoulseekCredentials, setHasSoulseekCredentials] = useState(() => Boolean(loadSoulseekCredentials()));
  const [amazonApiBaseUrl, setAmazonApiBaseUrl] = useState(() => loadAmazonMusicConfig().apiBaseUrl);
  const [amazonTurnstileSiteKey, setAmazonTurnstileSiteKey] = useState(() => loadAmazonMusicConfig().turnstileSiteKey);
  const [amazonBypassToken, setAmazonBypassToken] = useState(() => loadAmazonMusicConfig().bypassToken);
  const queueRef = useRef<DownloadQueueItem[]>([]);
  const folderRef = useRef<FileSystemDirectoryHandle | null>(null);
  const processingQueueRef = useRef(false);
  const onDownloadedRef = useRef(onDownloaded);

  const provider = getDownloadProvider(source);
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

  useEffect(() => {
    void getDownloadFolderHandle().then(async handle => {
      if (!handle) return;
      setDownloadFolder(handle);
      setNeedsFolderPermission(!(await verifyDownloadFolderPermission(handle, false)));
    });
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
    }));
    queueRef.current = [...queueRef.current, ...queuedItems];
    setDownloadQueue(queue => [...queue, ...queuedItems]);
    setMessage(`${items.length} descarga${items.length === 1 ? '' : 's'} en cola.`);
  }

  async function processDownloadQueue() {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    try {
      while (true) {
        const next = queueRef.current.find(item => item.status === 'queued');
        if (!next) break;
        const itemProvider = getDownloadProvider(next.source);
        updateQueueItem(next.queueId, { status: 'resolving', progress: 0.03, message: 'Resolviendo...' });
        setMessage(`Descargando cola: ${next.result.title}`);
        try {
          const resolved = await itemProvider.resolveDownload(next.result);
          updateQueueItem(next.queueId, { status: 'downloading', progress: 0.08, message: 'Descargando...' });
          const track = await itemProvider.download(resolved, {
            folderHandle: folderRef.current,
            onProgress: value => updateQueueItem(next.queueId, {
              status: 'downloading',
              progress: value,
              message: `${Math.round(value * 100)}%`,
            }),
          });
          if (next.source === 'monochrome' || track.uri.startsWith('blob:')) {
            // Do not mark a download ready until its catalog entry, artwork,
            // and file handle have been committed to the local library.
            await onDownloadedRef.current(track);
          }
          updateQueueItem(next.queueId, { status: 'done', progress: 1, message: 'Lista' });
          setMessage(`Descargado: ${track.title}.`);
        } catch (error) {
          updateQueueItem(next.queueId, {
            status: 'error',
            progress: 0,
            message: error instanceof Error ? error.message : 'No se pudo descargar.',
          });
          setMessage(error instanceof Error ? error.message : 'No se pudo descargar.');
        }
      }
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
    setMessage(source === 'monochrome' ? 'Buscando en Monochrome...' : 'Buscando en Soulseek...');
    try {
      const found = await provider.search(trimmed);
      setResults(found);
      setMessage(found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'}.` : 'No encontré resultados.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falló la búsqueda.');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePlay(result: DownloadSearchResult) {
    setBusyId(`play:${result.id}`);
    setMessage('Resolviendo stream...');
    try {
      const track = await provider.resolveStream(result);
      onPlay(track);
      setMessage(`Reproduciendo ${track.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reproducir.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(result: DownloadSearchResult) {
    const targetFolder = await ensureDownloadFolder();
    if (!targetFolder) {
      setMessage('Elige una carpeta de descargas para que la canción siga disponible al cerrar StaySound.');
      return;
    }
    enqueueDownloads([result]);
  }

  async function handleDownloadAll() {
    const targetFolder = await ensureDownloadFolder();
    if (!targetFolder) {
      setMessage('Elige una carpeta de descargas para que las canciones sigan disponibles al cerrar StaySound.');
      return;
    }
    enqueueDownloads(results);
  }

  function handleClearFinishedDownloads() {
    const nextQueue = downloadQueue.filter(item => item.status !== 'done' && item.status !== 'error');
    queueRef.current = nextQueue;
    setDownloadQueue(nextQueue);
  }

  function handleSaveBridgeConfig() {
    saveSoulseekBridgeConfig({ baseUrl: bridgeBaseUrl });
    setMessage('Bridge Soulseek guardado.');
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

  function handleSaveAmazonConfig() {
    saveAmazonMusicConfig({
      apiBaseUrl: amazonApiBaseUrl,
      turnstileSiteKey: amazonTurnstileSiteKey,
      bypassToken: amazonBypassToken,
    });
    const token = amazonBypassToken.trim();
    const isJwt = token.split('.').length === 3;
    setMessage(amazonTurnstileSiteKey.trim() || token
      ? `Amazon Music guardado. El proximo intento usara ${isJwt ? 'el JWT Turnstile' : 'esa verificacion'}.`
      : 'Amazon Music guardado sin Turnstile; se saltara si el API pide verificacion.');
  }

  return (
    <section className="downloads-panel">
      <div className="download-controls">
        <select
          className="download-source-select"
          value={source}
          onChange={event => setSource(event.target.value as DownloadSource)}
          aria-label="Fuente de descarga"
        >
          <option value="monochrome">Monochrome</option>
          <option value="soulseek">Soulseek</option>
        </select>
        <div className="download-search">
          <input
            value={remoteQuery}
            onChange={event => setRemoteQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void handleSearch(); }}
            placeholder="Buscar música"
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

      {showDownloadSettings && (
        <section className="download-settings">
          <div className="download-settings-head">
            <strong>Opciones</strong>
            {downloadFolder && <small>{downloadFolder.name}</small>}
          </div>
          <button
            className={`settings-action ${needsFolderPermission ? 'danger' : ''}`}
            onClick={handlePickDownloadFolder}
            disabled={!canPickDownloadFolder()}
          >
            <FolderIcon size={18} />
            <span>{downloadFolder ? 'Cambiar carpeta' : 'Carpeta destino'}</span>
          </button>

          {source === 'soulseek' && (
            <div className="bridge-config">
              <input value={soulseekUsername} onChange={event => setSoulseekUsername(event.target.value)} placeholder="Usuario Soulseek" />
              <input value={soulseekPassword} onChange={event => setSoulseekPassword(event.target.value)} placeholder="Password Soulseek" type="password" />
              <button className="btn btn-primary" onClick={handleSaveSoulseekCredentials}>
                {hasSoulseekCredentials ? 'Sesion guardada' : 'Guardar sesion'}
              </button>
              <input value={bridgeBaseUrl} onChange={event => setBridgeBaseUrl(event.target.value)} placeholder="http://localhost:4317" />
              <button className="btn btn-ghost" onClick={handleSaveBridgeConfig}>Guardar bridge</button>
            </div>
          )}

          {source === 'monochrome' && (
            <div className="amazon-config">
              <input value={amazonApiBaseUrl} onChange={event => setAmazonApiBaseUrl(event.target.value)} placeholder="https://amz.geeked.wtf" />
              <input value={amazonTurnstileSiteKey} onChange={event => setAmazonTurnstileSiteKey(event.target.value)} placeholder="Turnstile site key" />
              <input value={amazonBypassToken} onChange={event => setAmazonBypassToken(event.target.value)} placeholder="JWT Turnstile o bypass token" type="password" />
              <button className="btn btn-ghost" onClick={handleSaveAmazonConfig}>Guardar Amazon</button>
            </div>
          )}
        </section>
      )}

      {message && (
        <section className="status">
          {message}
        </section>
      )}

      {downloadQueue.length > 0 && (
        <section className={`download-queue-banner ${failedCount > 0 ? 'has-error' : ''}`}>
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
      )}

      <div className="download-results">
        {results.map(result => {
          const isPlaying = busyId === `play:${result.id}`;
          const queuedForResult = downloadQueue.some(item => (
            item.result.id === result.id && item.source === source && item.status !== 'done' && item.status !== 'error'
          ));
          return (
            <article className="download-result" key={result.id}>
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
                {source === 'monochrome' && (
                  <button className="btn btn-ghost" onClick={() => handlePlay(result)} disabled={Boolean(busyId)}>
                    {isPlaying ? '...' : 'Play'}
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => handleDownload(result)} disabled={queuedForResult}>
                  {queuedForResult ? 'En cola' : source === 'monochrome' ? 'Descargar' : 'Enviar'}
                </button>
              </span>
            </article>
          );
        })}
      </div>

      {results.length === 0 && !busyId && (
        <section className="empty-state compact">
          <div className="empty-state-icon"><DownloadIcon size={48} /></div>
          <h2>{source === 'monochrome' ? 'Busca en Monochrome' : 'Conecta Soulseek'}</h2>
          <p>
            {source === 'monochrome'
              ? 'Puedes reproducir un stream y guardar canciones en una carpeta local elegida por ti.'
              : 'Soulseek en web usa el companion local de StaySound para buscar y descargar desde la red P2P.'}
          </p>
        </section>
      )}
    </section>
  );
}
