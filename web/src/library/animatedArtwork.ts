import type { Track } from '@staysound/types/audio';
import { isTauriDesktop } from '../desktop/tauriMusicLibrary';

type ArtworkApiResponse = {
  videoUrl?: unknown;
  videoUrlVertical?: unknown;
};

type CachedArtwork = {
  videoUrl: string | null;
  expiresAt: number;
};

const CACHE_KEY = 'staysound.desktop.animated-artwork.v1';
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;
const memoryCache = new Map<string, CachedArtwork>();

function artworkKey(track: Track): string {
  return `${track.artist.trim().toLocaleLowerCase()}::${track.album.trim().toLocaleLowerCase()}`;
}

function readCache(): Record<string, CachedArtwork> {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}') as Record<string, CachedArtwork>;
  } catch {
    return {};
  }
}

function writeCache(key: string, entry: CachedArtwork): void {
  memoryCache.set(key, entry);
  try {
    const cache = readCache();
    cache[key] = entry;
    const entries = Object.entries(cache)
      .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
      .slice(0, 250);
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // The in-memory cache still avoids repeated requests for this session.
  }
}

function validVideoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.apple.com') ? url.href : null;
  } catch {
    return null;
  }
}

export async function getAnimatedArtwork(
  track: Track,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isTauriDesktop() || !track.title.trim() || !track.artist.trim()) return null;

  const key = artworkKey(track);
  const now = Date.now();
  const cached = memoryCache.get(key) ?? readCache()[key];
  if (cached && cached.expiresAt > now) {
    memoryCache.set(key, cached);
    return cached.videoUrl;
  }

  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), 6_000);
  const abort = () => timeoutController.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const params = new URLSearchParams({ s: track.title, a: track.artist });
    const response = await fetch(`https://artwork.boidu.dev/?${params}`, {
      signal: timeoutController.signal,
    });
    if (!response.ok) throw new Error(`Animated artwork HTTP ${response.status}`);
    const result = await response.json() as ArtworkApiResponse;
    const videoUrl = validVideoUrl(result.videoUrl);
    writeCache(key, {
      videoUrl,
      expiresAt: now + (videoUrl ? HIT_TTL : MISS_TTL),
    });
    return videoUrl;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
