import { parseFilename } from '@staysound/services/audioUtils';
import { generateAlbumId, generateArtistId } from '@staysound/services/metadataService';
import type { Track } from '@staysound/types/audio';
import { parseBlob, type IAudioMetadata } from 'music-metadata-browser';
import {
  desktopMusicFileUrl,
  getDesktopMusicFolder,
  isTauriDesktop,
  pickDesktopMusicFolder,
  readDesktopMusicFile,
  scanDesktopMusicFolder,
} from '../desktop/tauriMusicLibrary';
import { cacheRemoteArtwork, saveArtworkBlob } from '../storage/webArtworkCache';

export interface ImportedWebTrack extends Track {
  objectUrl: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileHandle?: FileSystemFileHandle;
  needsRelink?: false;
  /** Stable key under which the cover Blob is stored in the artwork cache. */
  artworkKey?: string;
  /** True when a persisted file handle exists, so the track can relink lazily on play. */
  relinkable?: boolean;
  /** Absolute native path used by the Tauri asset protocol. */
  nativePath?: string;
}

export interface ImportResult {
  tracks: ImportedWebTrack[];
  skipped: number;
  handle?: FileSystemDirectoryHandle;
  nativeFolderPath?: string;
}

export interface CollectedAudioFile {
  file: File;
  path: string;
  handle?: FileSystemFileHandle;
}

type MinimalFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};

type MinimalDirectoryHandle = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<MinimalFileHandle | MinimalDirectoryHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

const AUDIO_EXTENSIONS = new Set(['aac', 'aiff', 'alac', 'flac', 'm4a', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'wav', 'webm']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const METADATA_EXTENSIONS = new Set(['json']);

function getExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(getExtension(file.name));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(getExtension(file.name));
}

function isMetadataFile(file: File): boolean {
  return file.type === 'application/json' || METADATA_EXTENSIONS.has(getExtension(file.name));
}

function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '').toLowerCase();
}

function getDirectoryPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index + 1) : '';
}

function findArtworkSidecar(
  audioPath: string,
  images: Array<{ file: File; path?: string }>,
): File | undefined {
  const normalizedAudioBase = stripExtension(audioPath);
  const directory = getDirectoryPath(audioPath);
  const sameBasename = images.find(item => stripExtension(item.path || item.file.name) === normalizedAudioBase);
  if (sameBasename) return sameBasename.file;

  const preferredNames = new Set(['cover', 'folder', 'front', 'album']);
  return images.find(item => {
    const path = item.path || item.file.name;
    if (getDirectoryPath(path) !== directory) return false;
    const basename = stripExtension(path.slice(directory.length));
    return preferredNames.has(basename);
  })?.file;
}

function findMetadataSidecar(
  audioPath: string,
  metadataFiles: Array<{ file: File; path?: string }>,
): File | undefined {
  const normalizedAudioBase = stripExtension(audioPath);
  return metadataFiles.find(item => stripExtension(item.path || item.file.name) === normalizedAudioBase)?.file;
}

/** Read the artwork URL from StaySound's per-track download sidecar. */
export async function readArtworkMetadataSidecar(file: File): Promise<string | undefined> {
  try {
    const data = JSON.parse(await file.text()) as { artwork?: unknown };
    const artwork = typeof data.artwork === 'string' ? data.artwork.trim() : '';
    return artwork && /^(https?:|data:)/i.test(artwork) ? artwork : undefined;
  } catch {
    return undefined;
  }
}

export function hashFileIdentity(file: File, relativePath?: string): string {
  const identity = `${relativePath || file.name}:${file.size}:${file.lastModified}`;
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = ((hash << 5) - hash) + identity.charCodeAt(index);
    hash |= 0;
  }
  return `web_${Math.abs(hash).toString(16)}`;
}

/**
 * Re-read the cover embedded in a file and persist it to the artwork cache.
 * Used when a track is restored/relinked but its artwork was never cached
 * (e.g. scanned by an older build), so covers heal without a full re-import.
 */
export async function extractEmbeddedArtwork(
  file: File,
  keyHint: { album?: string; albumId?: string; trackId: string },
): Promise<{ url: string; artworkKey: string } | undefined> {
  try {
    const metadata = await parseBlob(file, { skipCovers: false });
    const art = extractArtwork(metadata);
    if (!art) return undefined;
    const artworkKey = keyHint.album ? (keyHint.albumId ?? keyHint.trackId) : keyHint.trackId;
    await saveArtworkBlob(artworkKey, art.blob);
    return { url: art.url, artworkKey };
  } catch {
    return undefined;
  }
}

/** Extract embedded artwork from metadata as a Blob plus a session blob: URL. */
function extractArtwork(metadata: IAudioMetadata): { url: string; blob: Blob } | undefined {
  const pictures = metadata.common.picture;
  if (!pictures || pictures.length === 0) return undefined;

  const pic = pictures[0];
  const bytes = new Uint8Array(pic.data.byteLength);
  bytes.set(pic.data);
  const blob = new Blob([bytes], { type: pic.format });
  return { url: URL.createObjectURL(blob), blob };
}

export async function fileToTrack(file: File, relativePath?: string): Promise<ImportedWebTrack> {
  const objectUrl = URL.createObjectURL(file);

  // Try to read real metadata (ID3v2, Vorbis, FLAC, MP4, etc.)
  let title: string | undefined;
  let artist: string | undefined;
  let album: string | undefined;
  let trackNumber: number | undefined;
  let year: number | undefined;
  let genre: string | undefined;
  let duration = 0;
  let artwork: { url: string; blob: Blob } | undefined;

  try {
    const metadata = await parseBlob(file, { skipCovers: false, duration: true });
    const { common, format } = metadata;

    title = common.title || undefined;
    artist = common.artist || undefined;
    album = common.album || undefined;
    trackNumber = common.track?.no ?? undefined;
    year = common.year ?? undefined;
    genre = common.genre?.[0] || undefined;
    duration = format.duration ? Math.round(format.duration * 1000) : 0;
    artwork = extractArtwork(metadata);
  } catch {
    // If metadata parsing fails, fall through to filename parsing
  }

  // Fall back to filename parsing for missing fields
  const parsed = parseFilename(file.name);
  title = title || parsed.title;
  artist = artist || parsed.artist;
  album = album || parsed.album;

  // If duration wasn't read from metadata, try the Audio element
  if (!duration) {
    duration = await readAudioDuration(objectUrl);
  }

  const albumId = generateAlbumId(album, artist);
  const artistId = generateArtistId(artist);
  const trackId = hashFileIdentity(file, relativePath);

  // Cache the cover under a stable key so it survives reloads. Dedupe by album
  // when we have one; otherwise key by the track so singles keep their own art.
  let artworkKey: string | undefined;
  if (artwork) {
    artworkKey = album ? albumId : trackId;
    await saveArtworkBlob(artworkKey, artwork.blob);
  }

  return {
    id: trackId,
    uri: objectUrl,
    objectUrl,
    title,
    artist,
    album,
    albumId,
    artistId,
    duration,
    artwork: artwork?.url,
    artworkKey,
    trackNumber,
    year,
    genre,
    format: getExtension(file.name).toUpperCase(),
    source: 'local',
    dateAdded: Date.now(),
    _filename: file.name,
    relativePath,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  };
}

export async function fileToRestoredTrack(
  file: File,
  relativePath: string | undefined,
  previous: Track,
  fileHandle?: FileSystemFileHandle,
): Promise<ImportedWebTrack> {
  const objectUrl = URL.createObjectURL(file);
  const trackId = hashFileIdentity(file, relativePath);

  // Heal covers that were never cached (older scans): re-read the embedded
  // artwork straight from the file when the restored track has none.
  let artwork = previous.artwork;
  let artworkKey = (previous as ImportedWebTrack).artworkKey;
  if (!artwork) {
    const extracted = await extractEmbeddedArtwork(file, {
      album: previous.album,
      albumId: previous.albumId,
      trackId,
    });
    if (extracted) {
      artwork = extracted.url;
      artworkKey = extracted.artworkKey;
    }
  }

  return {
    ...previous,
    id: trackId,
    uri: objectUrl,
    objectUrl,
    artwork,
    artworkKey,
    relativePath,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    fileHandle,
    needsRelink: false,
  } as ImportedWebTrack;
}

function readAudioDuration(fileUrl: string): Promise<number> {
  return new Promise(resolve => {
    const audio = new Audio();
    const cleanup = () => {
      audio.removeAttribute('src');
      audio.load();
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
    audio.src = fileUrl;
  });
}

export async function collectDirectoryFiles(handle: FileSystemDirectoryHandle, basePath = ''): Promise<CollectedAudioFile[]> {
  const entries: CollectedAudioFile[] = [];
  const iterableHandle = handle as unknown as MinimalDirectoryHandle;

  for await (const entry of iterableHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      entries.push({
        file,
        path: `${basePath}${file.name}`,
        handle: entry as unknown as FileSystemFileHandle,
      });
    } else {
      const childEntries = await collectDirectoryFiles(entry as unknown as FileSystemDirectoryHandle, `${basePath}${entry.name}/`);
      entries.push(...childEntries);
    }
  }

  return entries;
}

export async function collectDirectoryAudioFiles(handle: FileSystemDirectoryHandle): Promise<CollectedAudioFile[]> {
  const files = await collectDirectoryFiles(handle);
  return files.filter(item => isAudioFile(item.file));
}

async function importFileList(
  files: Array<{ file: File; path?: string; handle?: FileSystemFileHandle }>,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<ImportResult> {
  const tracks: ImportedWebTrack[] = [];
  let skipped = 0;
  const audioFiles = files.filter(item => isAudioFile(item.file));
  const imageFiles = files.filter(item => isImageFile(item.file));
  const metadataFiles = files.filter(item => isMetadataFile(item.file));
  const total = audioFiles.length;

  for (let i = 0; i < audioFiles.length; i++) {
    const item = audioFiles[i];
    onProgress?.(i + 1, total, item.file.name);
    const track = await fileToTrack(item.file, item.path);
    // Keep the file handle so the track can relink itself next session without
    // re-walking the whole folder.
    if (item.handle) {
      track.fileHandle = item.handle;
      track.relinkable = true;
    }
    if (!track.artwork) {
      const sidecar = findArtworkSidecar(item.path || item.file.name, imageFiles);
      if (sidecar) {
        track.artwork = URL.createObjectURL(sidecar);
        // Persist the sidecar cover under the same album/track key so it, too,
        // survives reloads without re-reading the folder.
        track.artworkKey = track.album ? track.albumId : track.id;
        if (track.artworkKey) await saveArtworkBlob(track.artworkKey, sidecar);
      } else {
        const metadata = findMetadataSidecar(item.path || item.file.name, metadataFiles);
        const sidecarArtwork = metadata ? await readArtworkMetadataSidecar(metadata) : undefined;
        if (sidecarArtwork) {
          track.artworkKey = track.album ? track.albumId : track.id;
          // Persist an image Blob when CORS permits it; retain the sidecar URL
          // as a useful online fallback for artwork hosts that disallow fetch.
          track.artwork = await cacheRemoteArtwork(track.artworkKey || track.id, sidecarArtwork) || sidecarArtwork;
        }
      }
    }
    tracks.push(track);
  }

  skipped = files.length - audioFiles.length;
  return { tracks, skipped };
}

export function canImportFolder(): boolean {
  return isTauriDesktop() || typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export { getDesktopMusicFolder };

export async function importRememberedDesktopFolder(
  folderPath: string,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<ImportResult> {
  const descriptors = await scanDesktopMusicFolder();
  const tracks: ImportedWebTrack[] = [];

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    onProgress?.(index + 1, descriptors.length, descriptor.name);
    const bytes = await readDesktopMusicFile(descriptor.path);
    const file = new File([bytes], descriptor.name, {
      type: descriptor.mimeType,
      lastModified: descriptor.lastModified || Date.now(),
    });
    const track = await fileToTrack(file, descriptor.relativePath);
    const temporaryUrl = track.objectUrl;
    const nativeUrl = desktopMusicFileUrl(descriptor.path);
    track.uri = nativeUrl;
    track.objectUrl = nativeUrl;
    track.nativePath = descriptor.path;
    track.needsRelink = false;
    track.relinkable = true;
    URL.revokeObjectURL(temporaryUrl);
    tracks.push(track);
  }

  return { tracks, skipped: 0, nativeFolderPath: folderPath };
}

export async function importFolder(
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<ImportResult> {
  if (isTauriDesktop()) {
    const folderPath = await pickDesktopMusicFolder();
    if (!folderPath) throw new DOMException('Importación cancelada', 'AbortError');
    return importRememberedDesktopFolder(folderPath, onProgress);
  }

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error('Folder import is not supported by this browser.');
  }

  const directory = await picker();
  const files = await collectDirectoryFiles(directory);
  const result = await importFileList(files, onProgress);
  return {
    ...result,
    handle: directory,
  };
}

export async function scanFolder(
  handle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<ImportResult> {
  const files = await collectDirectoryFiles(handle);
  const result = await importFileList(files, onProgress);
  return {
    ...result,
    handle,
  };
}

export async function importFiles(
  fileList: FileList | File[],
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<ImportResult> {
  const files = Array.from(fileList).map(file => ({
    file,
    path: 'webkitRelativePath' in file && typeof file.webkitRelativePath === 'string'
      ? file.webkitRelativePath
      : file.name,
  }));
  return importFileList(files, onProgress);
}
