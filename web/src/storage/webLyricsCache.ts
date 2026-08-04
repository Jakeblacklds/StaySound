/**
 * Durable cache for the lyrics candidates found for a track.
 *
 * A single word-synced source is tens of kilobytes of syllable objects and a
 * sweep returns several of them, so this data does not belong in
 * localStorage. It also must not widen the library database schema: the
 * library DB is opened during startup and every version bump there is a
 * migration risk for the user's actual catalog. Lyrics are a cache — they get
 * their own small database that is only opened when the player asks for it.
 */

// Bump this whenever the cache-selection policy changes. Version 1 could retain a
// plain Genius result indefinitely, masking a word-synchronised result once its
// provider recovered.
const DB_NAME = 'staysound_lyrics_cache_v3';
const STORE = 'candidates';

/** Keeps the cache bounded; the oldest entries are dropped past this count. */
const MAX_ENTRIES = 80;

export interface CachedLyricsCandidate {
  id: string;
  source: string;
  syncKind: 'word' | 'line' | 'plain';
  lineCount: number;
  preview: string;
  songwriters?: string;
  /** Engine `LyricsLine[]`; opaque here, structured-cloned as-is. */
  lines: unknown[];
}

export interface CachedLyricsEntry {
  trackKey: string;
  fetchedAt: number;
  selectedId: string | null;
  candidates: CachedLyricsCandidate[];
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      // Private browsing modes can reject indexedDB.open outright.
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'trackKey' });
        store.createIndex('fetchedAt', 'fetchedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise(resolve => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function readCachedLyrics(trackKey: string): Promise<CachedLyricsEntry | null> {
  if (!trackKey) return null;
  const db = await openDb();
  if (!db) return null;

  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const entry = await promisifyRequest(store.get(trackKey) as IDBRequest<CachedLyricsEntry>);
    return entry ?? null;
  } catch {
    return null;
  }
}

/**
 * Drops the oldest entries once the cache grows past {@link MAX_ENTRIES}.
 * Runs inside the caller's write transaction so a prune can never race a put.
 */
function pruneOldest(store: IDBObjectStore): void {
  const countRequest = store.count();
  countRequest.onsuccess = () => {
    const excess = countRequest.result - MAX_ENTRIES;
    if (excess <= 0) return;

    let removed = 0;
    const cursorRequest = store.index('fetchedAt').openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || removed >= excess) return;
      cursor.delete();
      removed += 1;
      cursor.continue();
    };
  };
}

export async function writeCachedLyrics(entry: CachedLyricsEntry): Promise<void> {
  if (!entry.trackKey) return;
  const db = await openDb();
  if (!db) return;

  try {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.put(entry);
    pruneOldest(store);
    await new Promise<void>(resolve => {
      transaction.oncomplete = () => resolve();
      // A failed write just means the next play re-searches over the network.
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } catch {
    // Storage unavailable — the sweep still works for this session.
  }
}

export async function clearCachedLyrics(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
  } catch {
    // Nothing to do; the cache is best-effort.
  }
}
