import { organizeIntoAlbums, organizeIntoArtists } from '@staysound/services/metadataService';
import type { Album, Artist, Playlist, RepeatMode, Track } from '@staysound/types/audio';
import { create } from 'zustand';
import type { ImportedWebTrack } from './importLocalFiles';
import { extractEmbeddedArtwork, fileToTrack, readArtworkMetadataSidecar } from './importLocalFiles';
import { resolveTidalArtworkForTrack } from './tidalArtworkResolver';
import { getWebArtistInfo } from './webArtistInfo';
import {
  loadPersistedLibraryAsync,
  loadPersistedPlaylists,
  loadPersistedSettings,
  loadRecentlyPlayed,
  savePersistedLibrary,
  saveImportedLibrary,
  migrateLegacyLibraryArtifacts,
  savePersistedPlaylists,
  savePersistedSettings,
  saveRecentlyPlayed,
  type PersistedWebTrack,
} from '../storage/webPersistence';
import { cacheRemoteArtwork, clearArtworkCache, loadArtworkUrls, saveArtworkBlob } from '../storage/webArtworkCache';
import {
  desktopMusicFileUrl,
  desktopPrecisePlaybackUrl,
  isTauriDesktop,
  migrateDesktopFlacToAlac,
  readDesktopMusicFile,
  scanDesktopMusicFolder,
} from '../desktop/tauriMusicLibrary';
import {
  clearTrackFileHandles,
  getAllTrackHandleKeys,
  getTrackFileHandle,
  saveTrackFileHandle,
  verifyFileHandlePermission,
} from '../storage/webFileHandles';
import { getFileHandleByRelativePath, getFolderHandle, verifyPermission } from './webFolderSync';
import { webAudioEngine, type WebAudioState } from '../audio/webAudioEngine';

export interface AlacMigrationProgress {
  processed: number;
  total: number;
  converted: number;
  /** Failed downloads with no audio, sent to the Trash. */
  removedEmpty: number;
  failed: Array<{ name: string; reason: string }>;
}

export interface ArtworkRecoveryProgress {
  processed: number;
  total: number;
  recovered: number;
}

interface WebLibraryState {
  tracks: Map<string, Track>;
  albums: Map<string, Album>;
  artists: Map<string, Artist>;
  playlists: Playlist[];
  query: string;
  isImporting: boolean;
  importMessage: string | null;
  skippedFiles: number;
  recentlyPlayedIds: string[];
  audio: WebAudioState;
  addImportedTracks: (tracks: ImportedWebTrack[], skipped: number, options?: { silent?: boolean }) => Promise<void>;
  addTrack: (track: Track, message?: string) => Promise<void>;
  createPlaylist: (name: string, trackIds?: string[], description?: string) => Playlist | null;
  deletePlaylist: (playlistId: string) => void;
  renamePlaylist: (playlistId: string, name: string) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  clearLibrary: () => void;
  setQuery: (query: string) => void;
  setImporting: (isImporting: boolean, message?: string | null) => void;
  recordRecentlyPlayed: (trackId: string) => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  togglePlayback: () => void;
  next: () => void;
  previous: () => void;
  seek: (position: number) => void;
  playAtIndex: (index: number) => void;
  setVolume: (volume: number) => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  hydrateAudio: (audio: WebAudioState) => void;
  recoverMissingArtwork: (onProgress?: (progress: ArtworkRecoveryProgress) => void) => Promise<number>;
  /** Moves every FLAC of the desktop library to ALAC; see src-tauri/src/alac.rs. */
  migrateLibraryToAlac: (onProgress?: (progress: AlacMigrationProgress) => void) => Promise<AlacMigrationProgress>;
  hydrateArtistPhotos: () => Promise<number>;
  hydrateLibrary: () => Promise<void>;
}

function toPersistedTrack(track: Track): PersistedWebTrack {
  const webTrack = track as ImportedWebTrack & { fileHandle?: FileSystemFileHandle; needsRelink?: boolean };
  const canRestoreFromDisk = Boolean(webTrack.fileHandle || (isTauriDesktop() && webTrack.nativePath));
  const { uri: _uri, objectUrl: _objectUrl, fileHandle: _fileHandle, relinkable: _relinkable, ...persistableTrack } = webTrack;
  return {
    ...persistableTrack,
    uri: undefined,
    artwork: track.artwork?.startsWith('blob:') ? undefined : track.artwork,
    artworkThumb: track.artworkThumb?.startsWith('blob:') ? undefined : track.artworkThumb,
    fileName: webTrack.fileName ?? track._filename ?? track.title,
    fileSize: webTrack.fileSize ?? 0,
    fileType: webTrack.fileType ?? '',
    relativePath: track.relativePath,
    needsRelink: webTrack.needsRelink ?? !canRestoreFromDisk,
  };
}

function comparableTrackText(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function exactMetadataKey(track: Track): string {
  return [
    comparableTrackText(track.title),
    comparableTrackText(track.artist),
    comparableTrackText(track.album),
  ].join('|');
}

function titleArtistKey(track: Track): string {
  return [comparableTrackText(track.title), comparableTrackText(track.artist)].join('|');
}

/**
 * The same song, now backed by its ALAC file. The id is kept on purpose:
 * playlists and recents point at it, and the next folder sync folds the
 * rescanned file into this entry by path.
 */
function withAlacFile(track: Track, newPath: string): Track {
  const url = desktopMusicFileUrl(newPath);
  const imported = track as ImportedWebTrack;
  return {
    ...track,
    uri: url,
    objectUrl: url,
    nativePath: newPath,
    fileName: newPath.split('/').pop() ?? imported.fileName,
    fileType: 'audio/mp4',
    format: 'M4A',
    codec: track.codec && /flac/i.test(track.codec) ? 'ALAC' : track.codec,
    relativePath: imported.relativePath?.replace(/\.flac$/i, '.m4a'),
  } as Track;
}

function isFlacPath(path: string | undefined): path is string {
  return !!path && /\.flac$/i.test(path);
}

function pathKey(track: Track): string | undefined {
  const path = (track as Track & { relativePath?: string }).relativePath?.trim();
  return path ? path.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : undefined;
}

function hasGenericAlbum(track: Track): boolean {
  const album = comparableTrackText(track.album);
  return !album || album === 'unknown album' || album === 'unknown' || album === 'album desconocido';
}

function isTrackRelinkNeeded(track: Track): boolean {
  return !track.uri || (track as Track & { needsRelink?: boolean }).needsRelink === true;
}

function trackKeepScore(track: Track): number {
  const webTrack = track as ImportedWebTrack & { fileHandle?: FileSystemFileHandle; needsRelink?: boolean };
  let score = 0;
  if (!isTrackRelinkNeeded(track)) score += 1000;
  if (webTrack.fileHandle) score += 400;
  if (webTrack.nativePath) score += 400;
  if (track.artwork) score += 120;
  if (track.artworkThumb) score += 40;
  if (track.tidalId) score += 30;
  if (webTrack.fileSize) score += Math.min(80, Math.round(webTrack.fileSize / (1024 * 1024)));
  score += Math.min(50, Math.round((track.duration || 0) / 60_000));
  score += Math.min(25, Math.round((track.dateAdded || 0) / 1_000_000_000_000));
  return score;
}

function mergeDuplicateTracks(preferred: Track, fallback: Track): Track {
  const preferredWeb = preferred as ImportedWebTrack & { fileHandle?: FileSystemFileHandle; needsRelink?: boolean };
  const fallbackWeb = fallback as ImportedWebTrack & { fileHandle?: FileSystemFileHandle; needsRelink?: boolean };
  return {
    ...fallback,
    ...preferred,
    artwork: preferred.artwork || fallback.artwork,
    artworkThumb: preferred.artworkThumb || fallback.artworkThumb,
    duration: preferred.duration || fallback.duration,
    genre: preferred.genre || fallback.genre,
    trackNumber: preferred.trackNumber ?? fallback.trackNumber,
    year: preferred.year ?? fallback.year,
    sampleRate: preferred.sampleRate ?? fallback.sampleRate,
    bitDepth: preferred.bitDepth ?? fallback.bitDepth,
    quality: preferred.quality || fallback.quality,
    codec: preferred.codec || fallback.codec,
    tidalId: preferred.tidalId ?? fallback.tidalId,
    tidalAlbumId: preferred.tidalAlbumId ?? fallback.tidalAlbumId,
    relativePath: preferred.relativePath || fallback.relativePath,
    fileName: preferredWeb.fileName || fallbackWeb.fileName,
    fileSize: preferredWeb.fileSize || fallbackWeb.fileSize,
    fileType: preferredWeb.fileType || fallbackWeb.fileType,
    fileHandle: preferredWeb.fileHandle || fallbackWeb.fileHandle,
    nativePath: preferredWeb.nativePath || fallbackWeb.nativePath,
    // Re-downloading or re-importing an existing song makes it recent again.
    // Without this, duplicate consolidation kept the survivor's old timestamp
    // and the completed download did not appear in Inicio.
    dateAdded: Math.max(preferred.dateAdded || 0, fallback.dateAdded || 0),
    downloadedAt: Math.max(preferred.downloadedAt || 0, fallback.downloadedAt || 0) || undefined,
    needsRelink: isTrackRelinkNeeded(preferred) && isTrackRelinkNeeded(fallback),
  } as Track;
}

function consolidateDuplicateTracks(tracks: Map<string, Track>): {
  tracks: Map<string, Track>;
  idRemap: Map<string, string>;
  removed: number;
} {
  const survivors = new Map<string, Track>();
  const byPath = new Map<string, string>();
  const byTidalId = new Map<number, string>();
  const byExactMetadata = new Map<string, string>();
  const byTitleArtist = new Map<string, string[]>();
  const idRemap = new Map<string, string>();
  let removed = 0;

  for (const track of tracks.values()) {
    const path = pathKey(track);
    const exact = exactMetadataKey(track);
    const titleArtist = titleArtistKey(track);
    const candidateIds = [
      path ? byPath.get(path) : undefined,
      track.tidalId ? byTidalId.get(track.tidalId) : undefined,
      exact.replace(/\|/g, '') ? byExactMetadata.get(exact) : undefined,
      ...(byTitleArtist.get(titleArtist) ?? []).filter(id => {
        const candidate = survivors.get(id);
        return candidate && (hasGenericAlbum(track) || hasGenericAlbum(candidate));
      }),
    ].filter((id): id is string => Boolean(id));
    const existing = candidateIds.map(id => survivors.get(id)).find(Boolean);

    if (!existing) {
      survivors.set(track.id, track);
      if (path) byPath.set(path, track.id);
      if (track.tidalId) byTidalId.set(track.tidalId, track.id);
      if (exact.replace(/\|/g, '')) byExactMetadata.set(exact, track.id);
      if (titleArtist.replace(/\|/g, '')) {
        byTitleArtist.set(titleArtist, [...(byTitleArtist.get(titleArtist) ?? []), track.id]);
      }
      continue;
    }

    const keep = trackKeepScore(track) > trackKeepScore(existing) ? track : existing;
    const drop = keep.id === track.id ? existing : track;
    const merged = mergeDuplicateTracks(keep, drop);
    survivors.delete(drop.id);
    survivors.set(keep.id, merged);
    idRemap.set(drop.id, keep.id);
    removed += 1;

    // Point every previously indexed signature at the survivor. This makes a
    // legacy "Unknown Album" entry collapse into the richer metadata entry
    // without merging distinct studio/live releases that have real albums.
    for (const [key, id] of byPath) if (id === drop.id) byPath.set(key, keep.id);
    for (const [key, id] of byTidalId) if (id === drop.id) byTidalId.set(key, keep.id);
    for (const [key, id] of byExactMetadata) if (id === drop.id) byExactMetadata.set(key, keep.id);
    for (const [key, ids] of byTitleArtist) {
      byTitleArtist.set(key, Array.from(new Set(ids.map(id => id === drop.id ? keep.id : id))));
    }
    const mergedPath = pathKey(merged);
    if (mergedPath) byPath.set(mergedPath, keep.id);
    if (path) byPath.set(path, keep.id);
    if (merged.tidalId) byTidalId.set(merged.tidalId, keep.id);
    const mergedExact = exactMetadataKey(merged);
    if (mergedExact.replace(/\|/g, '')) byExactMetadata.set(mergedExact, keep.id);
  }

  return {
    tracks: survivors,
    idRemap,
    removed,
  };
}

function remapPlaylistTrackIds(playlists: Playlist[], idRemap: Map<string, string>): Playlist[] {
  if (idRemap.size === 0) return playlists;
  return playlists.map(playlist => {
    const trackIds = Array.from(new Set(playlist.trackIds.map(id => idRemap.get(id) ?? id)));
    return trackIds.length === playlist.trackIds.length && trackIds.every((id, index) => id === playlist.trackIds[index])
      ? playlist
      : { ...playlist, trackIds, updatedAt: Date.now() };
  });
}

function rebuildCollections(tracks: Map<string, Track>, existingArtists?: Map<string, Artist>) {
  const values = Array.from(tracks.values());
  const albums = organizeIntoAlbums(values);
  const artists = organizeIntoArtists(values, albums, existingArtists);
  return { albums, artists };
}

function createInitialTracks(): Map<string, Track> {
  // Never paint a localStorage preview here. A large catalog may have been
  // truncated there, which makes the library appear to shrink at startup.
  // hydrateLibrary reads the complete IndexedDB catalog immediately after mount.
  return new Map();
}

function persistTracks(tracks: Map<string, Track>): void {
  savePersistedLibrary(Array.from(tracks.values()).map(toPersistedTrack));
}

/** Read one source file only for the user-triggered artwork repair action. */
async function recoverLocalArtwork(
  track: Track,
  artworkKey: string,
): Promise<{ artwork: string; artworkKey: string } | undefined> {
  const nativeTrack = track as ImportedWebTrack;
  if (isTauriDesktop() && nativeTrack.nativePath) {
    try {
      const bytes = await readDesktopMusicFile(nativeTrack.nativePath);
      const fileBytes = new Uint8Array(bytes.byteLength);
      fileBytes.set(bytes);
      const file = new File([fileBytes.buffer], nativeTrack.fileName || track._filename || track.title, {
        type: nativeTrack.fileType || 'application/octet-stream',
      });
      const extracted = await extractEmbeddedArtwork(file, {
        album: track.album,
        albumId: track.albumId || artworkKey,
        trackId: track.id,
      });
      if (extracted) return { artwork: extracted.url, artworkKey: extracted.artworkKey };
    } catch (error) {
      console.warn(`[WebLibrary] No se pudo leer artwork nativo de "${track.title}"`, error);
    }
  }

  let handle = await getTrackFileHandle(track.id);
  const relativePath = (track as Track & { relativePath?: string }).relativePath;
  let folder: FileSystemDirectoryHandle | null = null;

  if (!handle && relativePath) {
    folder = await getFolderHandle();
    if (folder && await verifyPermission(folder, false).catch(() => false)) {
      handle = await getFileHandleByRelativePath(folder, relativePath).catch(() => null);
      if (handle) void saveTrackFileHandle(track.id, handle);
    }
  }

  if (handle && await verifyFileHandlePermission(handle, false).catch(() => false)) {
    const file = await handle.getFile().catch(() => null);
    if (file) {
      const extracted = await extractEmbeddedArtwork(file, {
        album: track.album,
        albumId: track.albumId || artworkKey,
        trackId: track.id,
      });
      if (extracted) return { artwork: extracted.url, artworkKey: extracted.artworkKey };
    }
  }

  // Downloads from StaySound include sibling files such as
  // "Billie Eilish - ... - ocean eyes.json" and sometimes a matching JPG.
  // They are local source data, not a network lookup.
  if (!relativePath) return undefined;
  folder = folder ?? await getFolderHandle();
  if (!folder || !(await verifyPermission(folder, false).catch(() => false))) return undefined;
  const basePath = relativePath.replace(/\.[^/.]+$/, '');

  const metadataHandle = await getFileHandleByRelativePath(folder, `${basePath}.json`).catch(() => null);
  if (metadataHandle) {
    const metadataFile = await metadataHandle.getFile().catch(() => null);
    const sidecarArtwork = metadataFile ? await readArtworkMetadataSidecar(metadataFile) : undefined;
    if (sidecarArtwork) {
      const cached = await cacheRemoteArtwork(artworkKey, sidecarArtwork);
      return { artwork: cached || sidecarArtwork, artworkKey };
    }
  }

  for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
    const imageHandle = await getFileHandleByRelativePath(folder, `${basePath}.${extension}`).catch(() => null);
    if (!imageHandle) continue;
    const image = await imageHandle.getFile().catch(() => null);
    if (!image) continue;
    await saveArtworkBlob(artworkKey, image);
    return { artwork: URL.createObjectURL(image), artworkKey };
  }
  return undefined;
}

const initialTracks = createInitialTracks();
const initialCollections = rebuildCollections(initialTracks);
const initialSettings = loadPersistedSettings();
const initialPlaylists = loadPersistedPlaylists().playlists;

webAudioEngine.setVolume(initialSettings.volume);
webAudioEngine.setRepeatMode(initialSettings.repeatMode);
webAudioEngine.setShuffleEnabled(initialSettings.shuffleEnabled);

export const useWebLibraryStore = create<WebLibraryState>((set, get) => ({
  tracks: initialTracks,
  albums: initialCollections.albums,
  artists: initialCollections.artists,
  playlists: initialPlaylists,
  query: '',
  isImporting: false,
  importMessage: null,
  skippedFiles: 0,
  recentlyPlayedIds: loadRecentlyPlayed(),
  audio: webAudioEngine.getState(),

  addImportedTracks: async (tracks, skipped, options = {}) => {
    const previousTracks = get().tracks;
    const nextTracks = new Map(previousTracks);

    for (const track of tracks) {
      const previous = nextTracks.get(track.id) as (Track & { objectUrl?: string }) | undefined;
      if (previous?.objectUrl && previous.objectUrl !== track.objectUrl) {
        URL.revokeObjectURL(previous.objectUrl);
      }
      nextTracks.set(track.id, {
        ...track,
        relinkable: track.relinkable ?? Boolean(track.fileHandle),
      } as Track);
    }

    const consolidated = consolidateDuplicateTracks(nextTracks);
    const nextPlaylists = remapPlaylistTrackIds(get().playlists, consolidated.idRemap);
    const collections = rebuildCollections(consolidated.tracks, get().artists);

    // Do not report the import as finished until every File System Access
    // handle has committed. Otherwise a quick app close can persist only a
    // fraction of a large folder, leaving the rest marked "Reimportar" after
    // restart even though their metadata is still visible.
    const handlesToPersist = tracks.flatMap(track =>
      track.fileHandle ? [[track.id, track.fileHandle] as const] : [],
    );
    await saveImportedLibrary(
      Array.from(consolidated.tracks.values()).map(toPersistedTrack),
      handlesToPersist,
    );
    if (nextPlaylists !== get().playlists) savePersistedPlaylists(nextPlaylists);
    set({
      tracks: consolidated.tracks,
      albums: collections.albums,
      artists: collections.artists,
      playlists: nextPlaylists,
      skippedFiles: skipped,
      // Background restore syncs stay silent so reopening the app doesn't look
      // like a fresh scan ("importadas exitosamente" toast on every launch).
      importMessage: options.silent
        ? get().importMessage
        : tracks.length > 0
          ? `Listo: ${tracks.length} canción${tracks.length === 1 ? '' : 'es'} importada${tracks.length === 1 ? '' : 's'}${consolidated.removed ? `; ${consolidated.removed} duplicada${consolidated.removed === 1 ? '' : 's'} fusionada${consolidated.removed === 1 ? '' : 's'}.` : '.'}`
          : skipped > 0
            ? 'No encontré audio reproducible en esa selección.'
            : null,
    });
  },

  addTrack: async (incoming, message) => {
    let track = incoming;
    // New downloads arrive as whatever the source shares; FLAC is moved to
    // ALAC right away so the whole library seeks exactly. If that fails the
    // FLAC stays, and the precise-playback copy covers it.
    const downloadedPath = (incoming as ImportedWebTrack).nativePath;
    if (isTauriDesktop() && isFlacPath(downloadedPath)) {
      const migration = await migrateDesktopFlacToAlac(downloadedPath).catch(() => null);
      if (migration?.newPath) track = withAlacFile(incoming, migration.newPath);
    }
    const nextTracks = new Map(get().tracks);
    // addTrack is only used by completed downloads in the desktop/web shell.
    // Keep a separate timestamp so imported files are not mislabeled as downloads.
    nextTracks.set(track.id, { ...track, downloadedAt: Date.now() } as Track);
    const consolidated = consolidateDuplicateTracks(nextTracks);
    const nextPlaylists = remapPlaylistTrackIds(get().playlists, consolidated.idRemap);
    const collections = rebuildCollections(consolidated.tracks, get().artists);
    const importedTrack = track as ImportedWebTrack;
    const handles = importedTrack.fileHandle ? [[track.id, importedTrack.fileHandle] as const] : [];
    await saveImportedLibrary(
      Array.from(consolidated.tracks.values()).map(toPersistedTrack),
      handles,
    );
    if (nextPlaylists !== get().playlists) savePersistedPlaylists(nextPlaylists);
    set({
      tracks: consolidated.tracks,
      albums: collections.albums,
      artists: collections.artists,
      playlists: nextPlaylists,
      importMessage: message ?? `Listo: ${track.title} agregado a tu biblioteca.`,
    });
  },

  migrateLibraryToAlac: async (onProgress) => {
    const files = (await scanDesktopMusicFolder()).filter(file => isFlacPath(file.path));
    const progress: AlacMigrationProgress = {
      processed: 0,
      total: files.length,
      converted: 0,
      removedEmpty: 0,
      failed: [],
    };
    onProgress?.({ ...progress });

    let pending: Track[] = [];
    let removedIds = new Set<string>();
    // Written every few songs, so a closed app never leaves the library
    // pointing at files that are already in the Trash.
    const flush = () => {
      if (!pending.length && !removedIds.size) return;
      const tracks = new Map(get().tracks);
      for (const track of pending) tracks.set(track.id, track);
      for (const id of removedIds) tracks.delete(id);
      const playlists = removedIds.size
        ? get().playlists.map(playlist => (
          playlist.trackIds.some(id => removedIds.has(id))
            ? { ...playlist, trackIds: playlist.trackIds.filter(id => !removedIds.has(id)), updatedAt: Date.now() }
            : playlist
        ))
        : get().playlists;
      const recentlyPlayedIds = get().recentlyPlayedIds.filter(id => !removedIds.has(id));
      void saveImportedLibrary(Array.from(tracks.values()).map(toPersistedTrack), []);
      if (playlists !== get().playlists) savePersistedPlaylists(playlists);
      if (recentlyPlayedIds.length !== get().recentlyPlayedIds.length) saveRecentlyPlayed(recentlyPlayedIds);
      webAudioEngine.replaceTrackSources(pending);
      const collections = rebuildCollections(tracks, get().artists);
      set({ tracks, playlists, recentlyPlayedIds, albums: collections.albums, artists: collections.artists });
      pending = [];
      removedIds = new Set();
    };

    const playingPath = (webAudioEngine.getState().currentTrack as ImportedWebTrack | null)?.nativePath;
    // The song playing is done last and swapped in at once, so it is never
    // left reading a file that has just gone to the Trash.
    files.sort((a, b) => Number(a.path === playingPath) - Number(b.path === playingPath));

    for (const file of files) {
      const owners = Array.from(get().tracks.values())
        .filter(track => (track as ImportedWebTrack).nativePath === file.path);
      try {
        const result = await migrateDesktopFlacToAlac(file.path);
        if (result.newPath) {
          progress.converted += 1;
          pending.push(...owners.map(track => withAlacFile(track, result.newPath!)));
        } else if (result.outcome === 'trashed-empty') {
          progress.removedEmpty += 1;
          for (const track of owners) removedIds.add(track.id);
        } else {
          progress.failed.push({ name: file.name, reason: result.reason ?? 'Omitido.' });
        }
      } catch (error) {
        progress.failed.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) });
      }
      progress.processed += 1;
      if (file.path === playingPath || progress.processed % 12 === 0) flush();
      onProgress?.({ ...progress, failed: [...progress.failed] });
    }
    flush();
    return progress;
  },

  recoverMissingArtwork: async (onProgress) => {
    const currentTracks = get().tracks;
    const nextTracks = new Map(currentTracks);
    const candidates = Array.from(currentTracks.values()).filter(track => !track.artwork);
    let recovered = 0;
    let localRecovered = 0;
    let remoteRecovered = 0;
    let unavailable = 0;
    const recoveredByKey = new Map<string, { artwork: string; artworkKey: string } | null>();

    onProgress?.({ processed: 0, total: candidates.length, recovered: 0 });

    for (let index = 0; index < candidates.length; index += 1) {
      const track = candidates[index];
      const artworkKey = (track as ImportedWebTrack).artworkKey || track.albumId || track.id;
      let artwork = recoveredByKey.get(artworkKey);

      if (artwork === undefined) {
        // This is an explicit user action, so it may read just the missing
        // tracks. Opening the app never performs this work or scans folders.
        const localArtwork = await recoverLocalArtwork(track, artworkKey);
        if (localArtwork) {
          artwork = localArtwork;
          localRecovered += 1;
        } else {
          const remoteUrl = await resolveTidalArtworkForTrack(track).catch(() => undefined);
          const cachedArtwork = await cacheRemoteArtwork(artworkKey, remoteUrl);
          artwork = cachedArtwork ? { artwork: cachedArtwork, artworkKey } : null;
          if (cachedArtwork) remoteRecovered += 1;
        }
        recoveredByKey.set(artworkKey, artwork);
      }

      if (!artwork) {
        unavailable += 1;
        onProgress?.({ processed: index + 1, total: candidates.length, recovered });
        continue;
      }
      nextTracks.set(track.id, { ...track, ...artwork } as Track);
      recovered += 1;
      onProgress?.({ processed: index + 1, total: candidates.length, recovered });
    }

    if (!recovered) {
      set({
        importMessage: unavailable
          ? `No pude recuperar ${unavailable} portada${unavailable === 1 ? '' : 's'}: no encontré artwork embebido ni una coincidencia online.`
          : 'Todas las canciones ya tienen portada.',
      });
      return 0;
    }

    const consolidated = consolidateDuplicateTracks(nextTracks);
    const nextPlaylists = remapPlaylistTrackIds(get().playlists, consolidated.idRemap);
    const collections = rebuildCollections(consolidated.tracks, get().artists);
    persistTracks(consolidated.tracks);
    if (nextPlaylists !== get().playlists) savePersistedPlaylists(nextPlaylists);
    set({
      tracks: consolidated.tracks,
      albums: collections.albums,
      artists: collections.artists,
      playlists: nextPlaylists,
      importMessage: `Listo: recuperé ${recovered} portada${recovered === 1 ? '' : 's'} (${localRecovered} local${localRecovered === 1 ? '' : 'es'}, ${remoteRecovered} online)${unavailable ? `; ${unavailable} sin coincidencia.` : ''}.`,
    });
    return recovered;
  },

  hydrateArtistPhotos: async () => {
    const currentArtists = get().artists;
    const missing = Array.from(currentArtists.values())
      .filter(artist => !artist.artwork && artist.name && artist.name !== 'Unknown Artist')
      .slice(0, 36);
    if (missing.length === 0) return 0;

    let hydrated = 0;
    const nextArtists = new Map(currentArtists);

    for (const artist of missing) {
      const info = await getWebArtistInfo(artist.name).catch(() => null);
      const photoUrl = info?.photoUrl?.trim();
      if (!photoUrl) continue;
      const current = nextArtists.get(artist.id);
      if (!current || current.artwork) continue;
      nextArtists.set(artist.id, { ...current, artwork: photoUrl });
      hydrated += 1;
    }

    if (hydrated > 0) {
      set({ artists: nextArtists });
    }
    return hydrated;
  },

  hydrateLibrary: async () => {
    // Read the authoritative copy from IndexedDB (may include tracks that
    // overflowed the localStorage fast-path) and restore cover art from the
    // durable artwork cache so nothing needs re-reading from disk.
    await migrateLegacyLibraryArtifacts();
    const [persisted, handleKeys, folderHandle] = await Promise.all([
      loadPersistedLibraryAsync(),
      getAllTrackHandleKeys(),
      getFolderHandle(),
    ]);
    const relinkableIds = new Set(handleKeys);
    // A connected folder means any track with a relative path can be relinked
    // on play (via folder traversal), so it should not show as "Reimportar".
    const hasFolder = Boolean(folderHandle);
    const current = get().tracks;
    const merged = new Map(current);
    let changed = false;

    for (const track of persisted.tracks) {
      if (!merged.has(track.id)) {
        const nativePath = track.nativePath;
        const nativeUri = nativePath && isTauriDesktop() ? desktopMusicFileUrl(nativePath) : '';
        merged.set(track.id, {
          ...track,
          uri: nativeUri,
          needsRelink: !nativeUri,
          relinkable: Boolean(nativeUri),
        } as Track);
        changed = true;
      }
    }

    const keysNeeded = new Set<string>();
    for (const track of merged.values()) {
      const key = (track as Track & { artworkKey?: string }).artworkKey;
      if (key && (!track.artwork || /^https?:/i.test(track.artwork))) keysNeeded.add(key);
    }

    const artworkUrls = await loadArtworkUrls(keysNeeded);
    const next = new Map<string, Track>();
    for (const [id, track] of merged) {
      const key = (track as Track & { artworkKey?: string }).artworkKey;
      const cachedUrl = key ? artworkUrls.get(key) : undefined;
      // Mark tracks as re-linkable so the UI shows them playable immediately
      // (no "Reimportar") — either from a saved per-track handle, or from the
      // connected folder via the track's relative path. They relink on play.
      const relativePath = (track as Track & { relativePath?: string }).relativePath;
      const nativePath = (track as ImportedWebTrack).nativePath;
      const relinkable = Boolean(nativePath && isTauriDesktop())
        || relinkableIds.has(id)
        || (hasFolder && Boolean(relativePath));
      const patch: Partial<Track> & { relinkable?: boolean } = {};
      // A durable local Blob is more reliable than a previously persisted
      // remote URL and also repairs legacy entries whose CDN image now fails.
      if (cachedUrl && cachedUrl !== track.artwork) patch.artwork = cachedUrl;
      if (relinkable && !(track as Track & { relinkable?: boolean }).relinkable) patch.relinkable = true;
      if (Object.keys(patch).length > 0) {
        next.set(id, { ...track, ...patch });
        changed = true;
      } else {
        next.set(id, track);
      }
    }

    const consolidated = consolidateDuplicateTracks(next);
    if (consolidated.removed > 0) changed = true;
    if (!changed) return;
    const nextPlaylists = remapPlaylistTrackIds(get().playlists, consolidated.idRemap);
    const collections = rebuildCollections(consolidated.tracks, get().artists);
    if (consolidated.removed > 0) {
      // Cleanup is durable: once the richer entry wins, the duplicate cannot
      // return on the following restart.
      persistTracks(consolidated.tracks);
      if (nextPlaylists !== get().playlists) savePersistedPlaylists(nextPlaylists);
    }
    set({
      tracks: consolidated.tracks,
      albums: collections.albums,
      artists: collections.artists,
      playlists: nextPlaylists,
    });
  },

  createPlaylist: (name, trackIds = [], description) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = get().playlists.find(
      playlist => playlist.name.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0,
    );
    if (existing) return existing;
    const now = Date.now();
    const playlist: Playlist = {
      id: `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      description: description?.trim() || undefined,
      trackIds: Array.from(new Set(trackIds)),
      createdAt: now,
      updatedAt: now,
      source: 'local',
    };
    const playlists = [playlist, ...get().playlists];
    savePersistedPlaylists(playlists);
    set({ playlists });
    return playlist;
  },

  deletePlaylist: playlistId => {
    const playlists = get().playlists.filter(playlist => playlist.id !== playlistId);
    savePersistedPlaylists(playlists);
    set({ playlists });
  },

  renamePlaylist: (playlistId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const duplicate = get().playlists.some(
      playlist => playlist.id !== playlistId
        && playlist.name.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0,
    );
    if (duplicate) return;
    const playlists = get().playlists.map(playlist =>
      playlist.id === playlistId
        ? { ...playlist, name: trimmed, updatedAt: Date.now() }
        : playlist,
    );
    savePersistedPlaylists(playlists);
    set({ playlists });
  },

  addTrackToPlaylist: (playlistId, trackId) => {
    const playlists = get().playlists.map(playlist => {
      if (playlist.id !== playlistId || playlist.trackIds.includes(trackId)) return playlist;
      return { ...playlist, trackIds: [...playlist.trackIds, trackId], updatedAt: Date.now() };
    });
    savePersistedPlaylists(playlists);
    set({ playlists });
  },

  removeTrackFromPlaylist: (playlistId, trackId) => {
    const playlists = get().playlists.map(playlist => {
      if (playlist.id !== playlistId) return playlist;
      return {
        ...playlist,
        trackIds: playlist.trackIds.filter(id => id !== trackId),
        updatedAt: Date.now(),
      };
    });
    savePersistedPlaylists(playlists);
    set({ playlists });
  },

  clearLibrary: () => {
    for (const track of get().tracks.values()) {
      const objectUrl = (track as ImportedWebTrack).objectUrl;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (track.artwork?.startsWith('blob:')) URL.revokeObjectURL(track.artwork);
    }
    savePersistedLibrary([]);
    savePersistedPlaylists([]);
    void clearArtworkCache();
    void clearTrackFileHandles();
    webAudioEngine.pause();
    set({
      tracks: new Map(),
      albums: new Map(),
      artists: new Map(),
      playlists: [],
      importMessage: null,
      skippedFiles: 0,
    });
  },

  setQuery: query => set({ query }),
  setImporting: (isImporting, message = null) => set({ isImporting, importMessage: message }),
  recordRecentlyPlayed: trackId => {
    if (!trackId) return;
    const recentlyPlayedIds = [trackId, ...get().recentlyPlayedIds.filter(id => id !== trackId)].slice(0, 24);
    saveRecentlyPlayed(recentlyPlayedIds);
    set({ recentlyPlayedIds });
  },
  playTrack: (track, queue) => void webAudioEngine.play(track, queue),
  togglePlayback: () => webAudioEngine.toggle(),
  next: () => webAudioEngine.next(),
  previous: () => webAudioEngine.previous(),
  seek: position => webAudioEngine.seek(position),
  playAtIndex: index => webAudioEngine.playAtIndex(index),
  setVolume: volume => {
    webAudioEngine.setVolume(volume);
    const audio = webAudioEngine.getState();
    savePersistedSettings({
      volume: audio.volume,
      repeatMode: audio.repeatMode,
      shuffleEnabled: audio.shuffleEnabled,
    });
  },
  cycleRepeatMode: () => {
    const current = webAudioEngine.getState();
    const next: RepeatMode = current.repeatMode === 'off' ? 'all' : current.repeatMode === 'all' ? 'one' : 'off';
    webAudioEngine.setRepeatMode(next);
    const audio = webAudioEngine.getState();
    savePersistedSettings({
      volume: audio.volume,
      repeatMode: audio.repeatMode,
      shuffleEnabled: audio.shuffleEnabled,
    });
  },
  toggleShuffle: () => {
    webAudioEngine.setShuffleEnabled(!webAudioEngine.getState().shuffleEnabled);
    const audio = webAudioEngine.getState();
    savePersistedSettings({
      volume: audio.volume,
      repeatMode: audio.repeatMode,
      shuffleEnabled: audio.shuffleEnabled,
    });
  },
  hydrateAudio: audio => set({ audio }),
}));

webAudioEngine.subscribe(audio => {
  useWebLibraryStore.getState().hydrateAudio(audio);
});

// FLAC seeks by estimate in WKWebView — seconds off, while currentTime claims
// the exact time — so desktop keeps an exactly-seekable copy ready for the
// first seek. Only FLAC is sent: the native side answers null for the rest.
if (isTauriDesktop()) {
  webAudioEngine.setPreciseSourceResolver(async track => {
    const nativePath = (track as ImportedWebTrack).nativePath;
    if (!nativePath || !/\.flac$/i.test(nativePath)) return null;
    return desktopPrecisePlaybackUrl(nativePath);
  });
}

// Lazy re-link: when a track's blob: URL didn't survive the session, resolve a
// fresh one from its persisted file handle the moment it's played — no rescan.
const relinkedUrlCache = new Map<string, string>();
webAudioEngine.setTrackUriResolver(async track => {
  const cached = relinkedUrlCache.get(track.id);
  if (cached) return cached;

  const nativePath = (track as ImportedWebTrack).nativePath;
  if (nativePath && isTauriDesktop()) {
    const url = desktopMusicFileUrl(nativePath);
    relinkedUrlCache.set(track.id, url);
    return url;
  }

  // 1) Fast path: a per-track handle saved at import/scan time.
  let handle = await getTrackFileHandle(track.id);

  // 2) Fallback: reach the file through the connected folder by its relative
  //    path. This relinks tracks that were imported before we stored handles,
  //    so a connected folder means everything is playable — no re-import.
  const relativePath = (track as Track & { relativePath?: string }).relativePath;
  if (!handle && relativePath) {
    const folder = await getFolderHandle();
    if (folder && (await verifyPermission(folder, true).catch(() => false))) {
      handle = await getFileHandleByRelativePath(folder, relativePath).catch(() => null);
      if (handle) void saveTrackFileHandle(track.id, handle);
    }
  }

  if (!handle) return null;
  // Play is a user gesture, so prompting for permission here is allowed.
  const granted = await verifyFileHandlePermission(handle, true).catch(() => false);
  if (!granted) return null;

  try {
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    relinkedUrlCache.set(track.id, url);

    // Reflect the relink in the store so the row stays unlocked and future
    // plays reuse the same URL.
    const store = useWebLibraryStore.getState();
    const current = store.tracks.get(track.id);
    if (current) {
      const nextTracks = new Map(store.tracks);
      nextTracks.set(track.id, { ...current, uri: url, needsRelink: false, relinkable: true } as Track);
      useWebLibraryStore.setState({ tracks: nextTracks });
    }
    return url;
  } catch {
    return null;
  }
});
