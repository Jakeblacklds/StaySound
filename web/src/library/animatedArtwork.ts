import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { perfProbe } from '../debug/perfProbe';
import { isTauriDesktop } from '../desktop/tauriMusicLibrary';

/**
 * Everything the lookup needs. A `Track` satisfies it structurally, so the full
 * player keeps passing one straight through, while the album grid can ask for a
 * cover it has no track object for.
 */
export type ArtworkSubject = {
  title: string;
  artist: string;
  album: string;
};

type ArtworkApiResponse = {
  videoUrl?: unknown;
  videoUrlVertical?: unknown;
};

type MotionArtworkApiResponse = {
  mp4?: unknown;
  width?: unknown;
  /** The endpoint could not reach a verdict; do not hold this miss for long. */
  tentative?: unknown;
};

type Resolution = {
  videoUrl: string | null;
  tentative: boolean;
};

type CachedArtwork = {
  videoUrl: string | null;
  expiresAt: number;
};

const CACHE_KEY = 'staysound.desktop.animated-artwork.v1';
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;
// An unresolved lookup is not the same as "this album has no motion cover", so
// it expires in an hour instead of a day.
const TENTATIVE_TTL = 60 * 60 * 1000;
const memoryCache = new Map<string, CachedArtwork>();
// One flight per key. Without this a grid that scrolls a tile in and out fires
// the same lookup repeatedly before the first one has anything to cache.
const inFlight = new Map<string, Promise<string | null>>();

function artworkKey(track: ArtworkSubject, size: number): string {
  return `${size}::${track.artist.trim().toLocaleLowerCase()}::${track.album.trim().toLocaleLowerCase()}`;
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

/**
 * Turns Apple's remote URL into a local file the <video> can loop without ever
 * touching the network. Streaming it is what made the full player freeze for
 * half a second at a time: the CDN goes quiet mid-playback (`stalled`) and
 * every loop wrap re-seeks a partially buffered source, and both stall the
 * media pipeline while the audio keeps going.
 */
async function localCopy(remoteUrl: string): Promise<string> {
  try {
    const path = await invoke<string>('cache_animated_artwork', { url: remoteUrl });
    return convertFileSrc(path);
  } catch (reason) {
    // Streaming still shows the motion cover — with the stalls it came with —
    // which beats dropping the feature because a download failed. But a silent
    // fallback is what made this look fixed when it was not, so say why.
    const message = reason instanceof Error ? reason.message : String(reason);
    console.warn('Animated artwork stayed remote:', message);
    perfProbe.note(`artwork remoto: ${message.slice(0, 120)}`);
    return remoteUrl;
  }
}

/**
 * Desktop path: the provider's full-resolution MP4, downloaded once and played
 * from disk. It is ~16 MB, which is why only the full player uses it.
 */
async function resolveDesktop(track: ArtworkSubject, signal: AbortSignal): Promise<Resolution> {
  const params = new URLSearchParams({ s: track.title, a: track.artist });
  const response = await fetch(`https://artwork.boidu.dev/?${params}`, { signal });
  if (!response.ok) throw new Error(`Animated artwork HTTP ${response.status}`);
  const result = await response.json() as ArtworkApiResponse;
  return { videoUrl: validVideoUrl(result.videoUrl), tentative: false };
}

/**
 * Web path: our own endpoint, which resolves Apple's HLS ladder down to a small
 * progressive MP4 (360x360 is ~490 KB against 16 MB for the source rendition).
 * That is what makes running these in a grid affordable at all.
 */
async function resolveWeb(track: ArtworkSubject, size: number, signal: AbortSignal): Promise<Resolution> {
  const params = new URLSearchParams({ title: track.title, artist: track.artist, size: String(size) });
  const response = await fetch(`/api/motion-artwork?${params}`, { signal });
  if (!response.ok) throw new Error(`Motion artwork HTTP ${response.status}`);
  const result = await response.json() as MotionArtworkApiResponse;
  return { videoUrl: validVideoUrl(result.mp4), tentative: result.tentative === true };
}

export type AnimatedArtworkOptions = {
  /**
   * Pixel width the cover will be painted at, used to pick a rendition. Ignored
   * on desktop, which always caches the full-resolution file locally.
   */
  size?: number;
};

export async function getAnimatedArtwork(
  track: ArtworkSubject,
  signal?: AbortSignal,
  options: AnimatedArtworkOptions = {},
): Promise<string | null> {
  if (!track.title.trim() || !track.artist.trim()) return null;

  const desktop = isTauriDesktop();
  const size = Math.min(1080, Math.max(120, Math.round(options.size ?? 640)));
  const key = artworkKey(track, desktop ? 0 : size);
  const now = Date.now();

  const cached = memoryCache.get(key) ?? readCache()[key];
  if (cached && cached.expiresAt > now) {
    memoryCache.set(key, cached);
    if (!cached.videoUrl) return null;
    return desktop ? localCopy(cached.videoUrl) : cached.videoUrl;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const timeoutController = new AbortController();
    const timeout = window.setTimeout(() => timeoutController.abort(), 8_000);
    const abort = () => timeoutController.abort();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const { videoUrl, tentative } = desktop
        ? await resolveDesktop(track, timeoutController.signal)
        : await resolveWeb(track, size, timeoutController.signal);
      const ttl = videoUrl ? HIT_TTL : tentative ? TENTATIVE_TTL : MISS_TTL;
      writeCache(key, { videoUrl, expiresAt: now + ttl });
      if (!videoUrl) return null;
      return desktop ? await localCopy(videoUrl) : videoUrl;
    } catch {
      // A thrown lookup stays uncached so the next hover can retry it.
      return null;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}
