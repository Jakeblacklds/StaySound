import type { Playlist, Track } from '@staysound/types/audio';

const LIBRARY_KEY = 'staysound.web.library.v1';
const SETTINGS_KEY = 'staysound.web.settings.v1';
const PLAYLISTS_KEY = 'staysound.web.playlists.v1';

export interface PersistedWebTrack extends Omit<Track, 'uri'> {
  uri?: string;
  objectUrl?: never;
  fileName: string;
  fileSize: number;
  fileType: string;
  relativePath?: string;
  needsRelink: boolean;
  /** Key into the artwork cache (IndexedDB) so covers survive reloads. */
  artworkKey?: string;
}

export interface PersistedWebLibrary {
  tracks: PersistedWebTrack[];
  savedAt: number;
}

export interface PersistedWebSettings {
  volume: number;
  repeatMode: 'off' | 'one' | 'all';
  shuffleEnabled: boolean;
}

export interface PersistedWebPlaylists {
  playlists: Playlist[];
  savedAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browsers can reject storage in private mode. The app still works for the session.
  }
}

// --- Durable library store (IndexedDB) ------------------------------------
//
// The library is a durable local catalog, not a cache of the current session.
// IndexedDB is its only source of truth. Keeping a second, truncated copy in
// localStorage caused the app to briefly start with a partial library and, in
// some cases, save that partial view back over the complete catalog.

const LIBRARY_DB_NAME = 'staysound_library_v1';
const LIBRARY_STORE = 'library';
const ARTWORK_STORE = 'artwork';
const FILE_HANDLES_STORE = 'file_handles';
const FOLDER_STORE = 'folders';
const META_STORE = 'meta';
const LIBRARY_RECORD_KEY = 'tracks';
const LEGACY_ARTWORK_DB_NAME = 'staysound_artwork_cache_v1';
const LEGACY_FILE_HANDLES_DB_NAME = 'staysound_file_handles_v1';
const LEGACY_FOLDER_DB_NAME = 'staysound_folder_sync_v1';
const LEGACY_DOWNLOAD_DB_NAME = 'staysound_download_folder_v1';
const LEGACY_STORE = 'handles';
const LEGACY_DOWNLOADED_FILES_STORE = 'downloaded_files';
const ACTIVE_FOLDER_KEY = 'active_folder';
const LEGACY_MIGRATION_KEY = 'legacy_artifacts_migrated_v2';

let libraryDbPromise: Promise<IDBDatabase> | null = null;

function openLibraryDb(): Promise<IDBDatabase> {
  if (libraryDbPromise) return libraryDbPromise;
  libraryDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LIBRARY_DB_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LIBRARY_STORE)) {
        request.result.createObjectStore(LIBRARY_STORE);
      }
      if (!request.result.objectStoreNames.contains(ARTWORK_STORE)) {
        request.result.createObjectStore(ARTWORK_STORE);
      }
      if (!request.result.objectStoreNames.contains(FILE_HANDLES_STORE)) {
        request.result.createObjectStore(FILE_HANDLES_STORE);
      }
      if (!request.result.objectStoreNames.contains(FOLDER_STORE)) {
        request.result.createObjectStore(FOLDER_STORE);
      }
      if (!request.result.objectStoreNames.contains(META_STORE)) {
        request.result.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  libraryDbPromise.catch(() => {
    libraryDbPromise = null;
  });
  return libraryDbPromise;
}

/** Legacy read used only to migrate libraries created before the IndexedDB catalog. */
export function loadPersistedLibrary(): PersistedWebLibrary {
  return readJson<PersistedWebLibrary>(LIBRARY_KEY) ?? { tracks: [], savedAt: 0 };
}

/**
 * Authoritative async read from IndexedDB. Falls back to (and migrates from)
 * the legacy localStorage copy when IndexedDB has nothing yet.
 */
export async function loadPersistedLibraryAsync(): Promise<PersistedWebLibrary> {
  try {
    const db = await openLibraryDb();
    const record = await new Promise<PersistedWebLibrary | null>((resolve, reject) => {
      const tx = db.transaction(LIBRARY_STORE, 'readonly');
      const request = tx.objectStore(LIBRARY_STORE).get(LIBRARY_RECORD_KEY);
      request.onsuccess = () => resolve((request.result as PersistedWebLibrary) ?? null);
      request.onerror = () => reject(request.error);
    });
    if (record && Array.isArray(record.tracks)) return record;
  } catch {
    // Fall through to the localStorage copy.
  }

  const legacy = loadPersistedLibrary();
  if (legacy.tracks.length > 0) {
    // One-time migration so future loads come from IndexedDB.
    void writeLibraryToDb(legacy);
  }
  return legacy;
}

function writeLibraryToDb(library: PersistedWebLibrary): Promise<void> {
  return openLibraryDb().then(db =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LIBRARY_STORE, 'readwrite');
      tx.objectStore(LIBRARY_STORE).put(library, LIBRARY_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }),
  );
}

export function savePersistedLibrary(tracks: PersistedWebTrack[]): void {
  const library: PersistedWebLibrary = { tracks, savedAt: Date.now() };
  // Do not mirror the catalog into localStorage. It has a small quota and can
  // hold an incomplete snapshot of a large music library.
  void writeLibraryToDb(library).catch(() => {
    // Session still works; next save retries.
  });
}

/** Commit an imported catalog and its file handles together before reporting success. */
export async function saveImportedLibrary(
  tracks: PersistedWebTrack[],
  handles: Iterable<readonly [trackId: string, handle: FileSystemFileHandle]>,
): Promise<void> {
  const library: PersistedWebLibrary = { tracks, savedAt: Date.now() };
  const validHandles = Array.from(handles).filter(([trackId, handle]) => Boolean(trackId && handle));
  const db = await openLibraryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([LIBRARY_STORE, FILE_HANDLES_STORE], 'readwrite');
    tx.objectStore(LIBRARY_STORE).put(library, LIBRARY_RECORD_KEY);
    const handleStore = tx.objectStore(FILE_HANDLES_STORE);
    for (const [trackId, handle] of validHandles) handleStore.put(handle, trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveLibraryArtworkBlob(key: string, blob: Blob): Promise<void> {
  if (!key) return;
  const db = await openLibraryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ARTWORK_STORE, 'readwrite');
    tx.objectStore(ARTWORK_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadLibraryArtworkUrls(keys: Iterable<string>): Promise<Map<string, string>> {
  const uniqueKeys = Array.from(new Set(Array.from(keys).filter(Boolean)));
  const result = new Map<string, string>();
  if (uniqueKeys.length === 0) return result;
  try {
    const db = await openLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ARTWORK_STORE, 'readonly');
      const store = tx.objectStore(ARTWORK_STORE);
      for (const key of uniqueKeys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const blob = request.result as Blob | undefined;
          if (blob) result.set(key, URL.createObjectURL(blob));
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Missing artwork must never block loading the catalog.
  }
  return result;
}

export async function clearLibraryArtworkCache(): Promise<void> {
  try {
    const db = await openLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ARTWORK_STORE, 'readwrite');
      tx.objectStore(ARTWORK_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* best effort */ }
}

export async function saveLibraryFileHandles(entries: Iterable<readonly [trackId: string, handle: FileSystemFileHandle]>): Promise<void> {
  const validEntries = Array.from(entries).filter(([trackId, handle]) => Boolean(trackId && handle));
  if (validEntries.length === 0) return;
  const db = await openLibraryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_HANDLES_STORE, 'readwrite');
    const store = tx.objectStore(FILE_HANDLES_STORE);
    for (const [trackId, handle] of validEntries) store.put(handle, trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLibraryFileHandle(trackId: string): Promise<FileSystemFileHandle | null> {
  if (!trackId) return null;
  try {
    const db = await openLibraryDb();
    return await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(FILE_HANDLES_STORE, 'readonly');
      const request = tx.objectStore(FILE_HANDLES_STORE).get(trackId);
      request.onsuccess = () => resolve((request.result as FileSystemFileHandle) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}

export async function getLibraryFileHandleKeys(): Promise<string[]> {
  try {
    const db = await openLibraryDb();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(FILE_HANDLES_STORE, 'readonly');
      const request = tx.objectStore(FILE_HANDLES_STORE).getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => reject(request.error);
    });
  } catch { return []; }
}

export async function clearLibraryFileHandles(): Promise<void> {
  try {
    const db = await openLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILE_HANDLES_STORE, 'readwrite');
      tx.objectStore(FILE_HANDLES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* best effort */ }
}

export async function saveLibraryFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openLibraryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    tx.objectStore(FOLDER_STORE).put(handle, ACTIVE_FOLDER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLibraryFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openLibraryDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE, 'readonly');
      const request = tx.objectStore(FOLDER_STORE).get(ACTIVE_FOLDER_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}

export async function deleteLibraryFolderHandle(): Promise<void> {
  try {
    const db = await openLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE, 'readwrite');
      tx.objectStore(FOLDER_STORE).delete(ACTIVE_FOLDER_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* best effort */ }
}

async function readLegacyEntries<T>(name: string, storeName: string): Promise<Array<readonly [IDBValidKey, T]>> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains(storeName)) {
      db.close();
      return [];
    }
    const entries = await new Promise<Array<readonly [IDBValidKey, T]>>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => resolve((keys.result as IDBValidKey[]).map((key, index) => [key, (values.result as T[])[index]] as const));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return entries;
  } catch { return []; }
}

/** One-time migration from the previous separate artwork/handle databases. */
export async function migrateLegacyLibraryArtifacts(): Promise<void> {
  try {
    const db = await openLibraryDb();
    const migrated = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const request = tx.objectStore(META_STORE).get(LEGACY_MIGRATION_KEY);
      request.onsuccess = () => resolve(Boolean(request.result));
      request.onerror = () => reject(request.error);
    });
    if (migrated) return;
    const [artwork, handles, folders, downloadedHandles] = await Promise.all([
      readLegacyEntries<Blob>(LEGACY_ARTWORK_DB_NAME, 'covers'),
      readLegacyEntries<FileSystemFileHandle>(LEGACY_FILE_HANDLES_DB_NAME, LEGACY_STORE),
      readLegacyEntries<FileSystemDirectoryHandle>(LEGACY_FOLDER_DB_NAME, LEGACY_STORE),
      readLegacyEntries<FileSystemFileHandle>(LEGACY_DOWNLOAD_DB_NAME, LEGACY_DOWNLOADED_FILES_STORE),
    ]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([ARTWORK_STORE, FILE_HANDLES_STORE, FOLDER_STORE, META_STORE], 'readwrite');
      const artworkStore = tx.objectStore(ARTWORK_STORE);
      const handleStore = tx.objectStore(FILE_HANDLES_STORE);
      for (const [key, blob] of artwork) artworkStore.put(blob, key);
      for (const [key, handle] of handles) handleStore.put(handle, key);
      for (const [key, handle] of downloadedHandles) handleStore.put(handle, key);
      const activeFolder = folders.find(([key]) => key === ACTIVE_FOLDER_KEY)?.[1];
      if (activeFolder) tx.objectStore(FOLDER_STORE).put(activeFolder, ACTIVE_FOLDER_KEY);
      tx.objectStore(META_STORE).put(true, LEGACY_MIGRATION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // The catalog itself remains usable even if legacy artifact migration fails.
  }
}

export function loadPersistedSettings(): PersistedWebSettings {
  return readJson<PersistedWebSettings>(SETTINGS_KEY) ?? {
    volume: 0.9,
    repeatMode: 'off',
    shuffleEnabled: false,
  };
}

export function savePersistedSettings(settings: PersistedWebSettings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function loadPersistedPlaylists(): PersistedWebPlaylists {
  const persisted = readJson<PersistedWebPlaylists>(PLAYLISTS_KEY);
  if (!persisted || !Array.isArray(persisted.playlists)) return { playlists: [], savedAt: 0 };
  return {
    savedAt: Number.isFinite(persisted.savedAt) ? persisted.savedAt : 0,
    playlists: persisted.playlists
      .filter(playlist => playlist && typeof playlist.id === 'string' && typeof playlist.name === 'string')
      .map(playlist => {
        const now = Date.now();
        return {
          ...playlist,
          trackIds: Array.isArray(playlist.trackIds) ? Array.from(new Set(playlist.trackIds.filter(id => typeof id === 'string'))) : [],
          createdAt: Number.isFinite(playlist.createdAt) ? playlist.createdAt : now,
          updatedAt: Number.isFinite(playlist.updatedAt) ? playlist.updatedAt : now,
        };
      }),
  };
}

export function savePersistedPlaylists(playlists: Playlist[]): void {
  writeJson(PLAYLISTS_KEY, { playlists, savedAt: Date.now() } satisfies PersistedWebPlaylists);
}
