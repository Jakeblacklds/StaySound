import { generateAlbumId, generateArtistId } from '@staysound/services/metadataService';
import type { TidalQuality, TidalTrack, Track } from '@staysound/types/audio';
import CryptoJS from 'crypto-js';
import { fileToTrack } from '../library/importLocalFiles';
import { resolveTidalArtworkForTrack } from '../library/tidalArtworkResolver';
import { cacheRemoteArtwork, saveArtworkBlob } from '../storage/webArtworkCache';
import { writeBlobToDownloadFolder } from './webDownloadFolder';

export type DownloadSource = 'monochrome' | 'soulseek';

export interface DownloadSearchResult {
  id: string;
  source: DownloadSource;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  quality?: string;
  durationMs?: number;
  size?: number;
  raw?: unknown;
}

export interface ResolvedDownload {
  url: string;
  filename: string;
  mimeType?: string;
  source: DownloadSource;
  track: TidalTrack;
  segmentUrls?: string[];
}

export interface DownloadProvider {
  search(query: string): Promise<DownloadSearchResult[]>;
  resolveStream(result: DownloadSearchResult): Promise<Track>;
  resolveDownload(result: DownloadSearchResult): Promise<ResolvedDownload>;
  download(
    resolved: ResolvedDownload,
    options?: {
      folderHandle?: FileSystemDirectoryHandle | null;
      signal?: AbortSignal;
      onProgress?: (progress: number) => void;
    },
  ): Promise<Track>;
}

const TIDAL_API_BASES = [
  'https://hifi.geeked.wtf',
  'https://eu-central.monochrome.tf',
  'https://us-west.monochrome.tf',
  'https://arran.monochrome.tf',
  'https://api.monochrome.tf',
  'https://monochrome-api.samidy.com',
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://tidal.kinoplus.online',
];

const TIDAL_STREAMING_BASES = [
  'https://arran.monochrome.tf',
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://hifi.p1nkhamster.xyz',
  'https://hifi.geeked.wtf',
];

const QOBUZ_API_BASES = [
  'https://qobuz.kennyy.com.br',
  'https://qdl-api.monochrome.tf',
  'https://mono.scavengerfurs.net',
];

const AUDIO_PROXY_BASE_URL = 'https://audio-proxy.binimum.org/proxy-audio/';
const AMAZON_API_BASE_URL = 'https://amz.geeked.wtf';
const AMAZON_TURNSTILE_SITE_KEY = '0x4AAAAAADgxqF6QVMm0GLHH';
const AMAZON_CONFIG_KEY = 'staysound.web.amazon.config.v1';
const AMAZON_TURNSTILE_JWT_KEY = 'staysound.web.amazon.turnstile.jwt.v1';
const AMAZON_TURNSTILE_EXPIRY_KEY = 'staysound.web.amazon.turnstile.expiry.v1';
const DEEZER_API_BASE_URL = 'https://dzr.tabs-vs-spaces.wtf';
const SAAVN_SEARCH_API_BASE_URL = 'https://js-odskyler.vercel.app';
const SAAVN_RESOLVE_API_BASE_URL = 'https://sda.rhythmax.workers.dev';
const SAAVN_DES_KEY = '38346591';
const REQUEST_TIMEOUT_MS = 12_000;
const INSTANCE_CACHE_KEY = 'staysound.web.monochrome.instances.v1';
const INSTANCE_CACHE_TTL_MS = 15 * 60 * 1000;
const INSTANCE_URLS = ['https://tidal-uptime.geeked.wtf'];
const DEFAULT_QUALITY: TidalQuality = 'LOSSLESS';
const SOULSEEK_BRIDGE_CONFIG_KEY = 'staysound.web.soulseek.bridge.v2';
const SOULSEEK_CREDENTIALS_KEY = 'staysound.web.soulseek.credentials.v1';

type TidalTrackApiResponse = {
  id?: number;
  title?: string;
  duration?: number;
  trackNumber?: number;
  isrc?: string;
  explicit?: boolean;
  audioQuality?: string;
  mediaMetadata?: { tags?: string[] };
  album?: { id?: number; title?: string; cover?: string | null; releaseDate?: string };
  artist?: { id?: number; name?: string };
  artists?: Array<{ id?: number; name?: string }>;
};

type TidalSearchApiResponse = {
  data?: { items?: TidalTrackApiResponse[] };
};

type TrackManifestResponse = {
  data?: {
    data?: {
      attributes?: {
        uri?: string;
        trackPresentation?: string;
        previewReason?: string;
      };
    };
  };
};

type ParsedManifest = {
  urls: string[];
  quality: string;
  mimeType?: string;
  codecs?: string;
  sampleRate?: number;
  bitDepth?: number;
  isSegmented: boolean;
  manifestUrl?: string;
};

type QobuzTrackItem = {
  id?: number;
  title?: string;
  version?: string | null;
  isrc?: string;
  duration?: number;
  track_number?: number;
  maximum_sampling_rate?: number;
  maximum_bit_depth?: number;
  hires?: boolean;
  performer?: { id?: number; name?: string };
  album?: {
    title?: string;
    id?: string | number;
    image?: { large?: string; small?: string; thumbnail?: string };
    release_date_original?: string;
  };
};

type QobuzSearchResponse = {
  success?: boolean;
  data?: { tracks?: { items?: QobuzTrackItem[] } };
};

type QobuzDownloadResponse = {
  success?: boolean;
  data?: { url?: string };
};

type AmazonQualityInfo = {
  quality?: string;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number;
  bandwidth?: number;
};

type AmazonTrackPayload = {
  stream_url?: string;
  url?: string;
  source_url?: string;
  sourceUrl?: string;
  quality_selected?: string;
  quality_requested?: string;
  available_qualities?: AmazonQualityInfo[];
  playback_type?: string[] | string;
  playbackType?: string[] | string;
  mime_type?: string;
  media_mime_type?: string;
  decryption_key?: string;
  decryptionKey?: string;
  decryption?: { key?: string };
  drm?: { decryption_key?: string; decryptionKey?: string };
};

type AmazonTrackEnvelope = AmazonTrackPayload & {
  data?: AmazonTrackPayload;
  track?: AmazonTrackPayload;
  result?: AmazonTrackPayload;
};

type SaavnArtist = {
  name?: string;
};

type SaavnSong = {
  id?: string;
  title?: string;
  subtitle?: string;
  perma_url?: string;
  image?: string;
  year?: string;
  more_info?: {
    album?: string;
    duration?: string;
    encrypted_media_url?: string;
    artists?: { primary?: SaavnArtist[] };
  };
};

type SaavnSearchResponse = {
  results?: SaavnSong[];
  data?: { results?: SaavnSong[] };
};

type ExternalAudioProvider = 'qobuz' | 'amazon' | 'saavn' | 'deezer';

type ExternalAudio = {
  url: string;
  extension: string;
  mimeType?: string;
  provider: ExternalAudioProvider;
  quality: string;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
};

type MonochromeInstance = string | { url?: string; version?: string; isUser?: boolean };

type MonochromeInstanceCatalog = {
  api: MonochromeInstance[];
  streaming: MonochromeInstance[];
  qobuz: MonochromeInstance[];
};

type SlskdConfig = {
  baseUrl: string;
};

export type SoulseekCredentials = {
  username: string;
  password: string;
};

export type AmazonMusicConfig = {
  apiBaseUrl: string;
  turnstileSiteKey: string;
  bypassToken: string;
};

type SoulseekMatch = {
  username: string;
  filename: string;
  size?: number;
  extension?: string;
  durationMs?: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  raw?: unknown;
};

function withTimeoutSignal(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchJson<T>(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const { signal, cleanup } = withTimeoutSignal(timeoutMs, options.signal ?? undefined);
  try {
    const response = await fetch(url, { ...options, signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return text ? JSON.parse(text) as T : ({} as T);
  } finally {
    cleanup();
  }
}

function getLocalBridgeProxyUrl(url: string): string | null {
  const config = getSoulseekBridgeConfig() ?? { baseUrl: 'http://localhost:4317' };
  if (!config.baseUrl) return null;
  return `${config.baseUrl}/proxy?url=${encodeURIComponent(url)}`;
}

async function fetchWithLocalProxyFallback(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  preferProxy = false,
): Promise<Response> {
  const fetchOnce = async (targetUrl: string) => {
    const { signal, cleanup } = withTimeoutSignal(timeoutMs, options.signal ?? undefined);
    try {
      return await fetch(targetUrl, { ...options, signal });
    } finally {
      cleanup();
    }
  };

  const proxied = getLocalBridgeProxyUrl(url);
  if (preferProxy && proxied) {
    try {
      return await fetchOnce(proxied);
    } catch {
      return await fetchOnce(url);
    }
  }

  try {
    return await fetchOnce(url);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (!proxied) throw error;
    return await fetchOnce(proxied);
  }
}

async function fetchJsonWithLocalProxyFallback<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  preferProxy = false,
): Promise<T> {
  const response = await fetchWithLocalProxyFallback(url, options, timeoutMs, preferProxy);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) as T : ({} as T);
}

function instanceUrl(instance: MonochromeInstance): string {
  return (typeof instance === 'string' ? instance : instance.url ?? '').replace(/\/+$/, '');
}

function isBlockedInstance(instance: MonochromeInstance): boolean {
  const url = instanceUrl(instance);
  // Mirrors can be temporarily incompatible even when advertised upstream.
  return !url || /\.squid\.wtf/i.test(url);
}

function asInstance(url: string, version = 'static'): MonochromeInstance {
  return { url: url.replace(/\/+$/, ''), version };
}

function fallbackInstanceCatalog(): MonochromeInstanceCatalog {
  return {
    api: TIDAL_API_BASES.map(url => asInstance(url)),
    streaming: TIDAL_STREAMING_BASES.map(url => asInstance(url)),
    qobuz: QOBUZ_API_BASES.map(url => asInstance(url)),
  };
}

function prioritySortInstances(instances: MonochromeInstance[]): MonochromeInstance[] {
  const shuffled = [...instances];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }

  const top: MonochromeInstance[] = [];
  const middle: MonochromeInstance[] = [];
  const bottom: MonochromeInstance[] = [];

  for (const instance of shuffled) {
    const url = instanceUrl(instance);
    if (url.includes('hifi.geeked.wtf')) top.push(instance);
    else if (url.includes('.qqdl.site')) bottom.push(instance);
    else middle.push(instance);
  }

  return [...top, ...middle, ...bottom];
}

function mergeInstances(primary: MonochromeInstance[] | undefined, fallback: MonochromeInstance[]): MonochromeInstance[] {
  const seen = new Set<string>();
  const merged: MonochromeInstance[] = [];
  for (const instance of [...(primary ?? []), ...fallback]) {
    const url = instanceUrl(instance);
    if (!url || seen.has(url) || isBlockedInstance(instance)) continue;
    seen.add(url);
    merged.push(instance);
  }
  return merged;
}

let monochromeCatalogPromise: Promise<MonochromeInstanceCatalog> | null = null;

async function loadMonochromeInstances(forceRefresh = false): Promise<MonochromeInstanceCatalog> {
  if (!forceRefresh) {
    try {
      const cached = JSON.parse(window.localStorage.getItem(INSTANCE_CACHE_KEY) || 'null') as
        | { timestamp?: number; data?: MonochromeInstanceCatalog }
        | null;
      if (cached?.timestamp && cached.data && Date.now() - cached.timestamp < INSTANCE_CACHE_TTL_MS) {
        return cached.data;
      }
    } catch {
      // Ignore corrupt cache.
    }
  }

  if (monochromeCatalogPromise && !forceRefresh) return monochromeCatalogPromise;

  monochromeCatalogPromise = (async () => {
    let data: Partial<MonochromeInstanceCatalog> | null = null;

    for (const url of INSTANCE_URLS) {
      try {
        data = await fetchJson<Partial<MonochromeInstanceCatalog>>(url, {}, 8000);
        break;
      } catch {
        // Try the next uptime endpoint.
      }
    }

    const fallback = fallbackInstanceCatalog();
    const catalog: MonochromeInstanceCatalog = {
      api: mergeInstances(data?.api, fallback.api),
      streaming: mergeInstances(data?.streaming?.length ? data.streaming : data?.api, fallback.streaming),
      qobuz: mergeInstances(data?.qobuz, fallback.qobuz),
    };

    if (catalog.qobuz.length === 0) catalog.qobuz = fallback.qobuz;
    catalog.api = prioritySortInstances(catalog.api);
    catalog.streaming = prioritySortInstances(catalog.streaming);
    catalog.qobuz = prioritySortInstances(catalog.qobuz);

    try {
      window.localStorage.setItem(INSTANCE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: catalog }));
    } catch {
      // Storage may fail in private mode.
    }

    monochromeCatalogPromise = null;
    return catalog;
  })();

  return monochromeCatalogPromise;
}

async function getMonochromeInstances(type: keyof MonochromeInstanceCatalog, forceRefresh = false): Promise<MonochromeInstance[]> {
  const catalog = await loadMonochromeInstances(forceRefresh);
  return catalog[type].length ? catalog[type] : fallbackInstanceCatalog()[type];
}

async function fetchWithMonochromeRetry(
  type: keyof MonochromeInstanceCatalog,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const tryInstances = async (instances: MonochromeInstance[]) => {
    if (instances.length === 0) throw new Error(`No hay instancias Monochrome para ${type}.`);
    const maxAttempts = Math.max(instances.length * 2, instances.length);
    let index = Math.floor(Math.random() * instances.length);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const base = instanceUrl(instances[index % instances.length]);
      index += 1;
      if (!base) continue;

      try {
        const response = await fetchWithLocalProxyFallback(
          `${base}${path.startsWith('/') ? path : `/${path}`}`,
          options,
          REQUEST_TIMEOUT_MS,
          type !== 'streaming',
        );
        if (response.ok) return response;

        if (response.status === 429 || response.status === 401 || response.status >= 500) {
          lastError = new Error(`Monochrome ${base} respondió ${response.status}`);
          await new Promise(resolve => window.setTimeout(resolve, response.status === 429 ? 500 : 160));
          continue;
        }

        lastError = new Error(`Monochrome ${base} respondió ${response.status}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastError = error;
        await new Promise(resolve => window.setTimeout(resolve, 180));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Fallaron las instancias Monochrome para ${path}`);
  };

  try {
    return await tryInstances(await getMonochromeInstances(type, false));
  } catch (error) {
    if (type === 'streaming') throw error;
    return tryInstances(await getMonochromeInstances(type, true));
  }
}

async function fetchMonochromeJson<T>(
  type: keyof MonochromeInstanceCatalog,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchWithMonochromeRetry(type, path, options);
  return await response.json() as T;
}

async function loadAmazonTurnstile(): Promise<{ render: (container: HTMLElement, options: Record<string, unknown>) => string; execute: (id: string) => void; remove?: (id: string) => void }> {
  const existing = (window as unknown as { turnstile?: unknown }).turnstile;
  if (existing) {
    return existing as { render: (container: HTMLElement, options: Record<string, unknown>) => string; execute: (id: string) => void; remove?: (id: string) => void };
  }

  await new Promise<void>((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>('script[data-staysound-amazon-turnstile]');
    if (found) {
      found.addEventListener('load', () => resolve(), { once: true });
      found.addEventListener('error', () => reject(new Error('No se pudo cargar Turnstile.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.staysoundAmazonTurnstile = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('No se pudo cargar Turnstile.')), { once: true });
    document.head.appendChild(script);
  });

  const loaded = (window as unknown as { turnstile?: unknown }).turnstile;
  if (!loaded) throw new Error('Turnstile no quedo disponible.');
  return loaded as { render: (container: HTMLElement, options: Record<string, unknown>) => string; execute: (id: string) => void; remove?: (id: string) => void };
}

async function getAmazonTurnstileResponse(siteKey: string): Promise<string | null> {
  if (!siteKey.trim()) return null;
  const turnstile = await loadAmazonTurnstile();
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.right = '16px';
  container.style.bottom = '84px';
  container.style.zIndex = '9999';
  container.style.width = '320px';
  container.style.minHeight = '72px';
  container.style.padding = '10px';
  container.style.border = '1px solid rgba(255,255,255,0.18)';
  container.style.borderRadius = '10px';
  container.style.background = 'rgba(20,20,24,0.92)';
  container.style.color = '#fff';
  container.style.boxShadow = '0 16px 40px rgba(0,0,0,0.35)';
  container.style.display = 'none';
  document.body.appendChild(container);

  return await new Promise<string | null>((resolve, reject) => {
    let timeoutId = 0;
    let widgetId = '';
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      if (widgetId && turnstile.remove) {
        try {
          turnstile.remove(widgetId);
        } catch {
          // Ignore widget cleanup failures.
        }
      }
      container.remove();
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Turnstile tardo demasiado.'));
    }, 30_000);

    widgetId = turnstile.render(container, {
      sitekey: siteKey,
      size: 'invisible',
      execution: 'execute',
      theme: 'auto',
      'before-interactive-callback': () => {
        container.style.display = 'block';
      },
      callback: (token: unknown) => {
        cleanup();
        resolve(typeof token === 'string' ? token : null);
      },
      'error-callback': () => {
        cleanup();
        reject(new Error('Turnstile fallo.'));
      },
      'expired-callback': () => {
        cleanup();
        reject(new Error('Turnstile expiro.'));
      },
    });

    turnstile.execute(widgetId);
  });
}

async function getAmazonTurnstileJwt(forceRefresh = false): Promise<string | null> {
  const config = loadAmazonMusicConfig();
  if (!config.turnstileSiteKey.trim()) return null;

  if (!forceRefresh) {
    try {
      const jwt = window.localStorage.getItem(AMAZON_TURNSTILE_JWT_KEY);
      const expiry = Number(window.localStorage.getItem(AMAZON_TURNSTILE_EXPIRY_KEY) ?? 0);
      if (jwt && Date.now() < expiry) return jwt;
    } catch {
      // Ignore blocked storage.
    }
  }

  const cfTurnstileResponse = await getAmazonTurnstileResponse(config.turnstileSiteKey);
  if (!cfTurnstileResponse) return null;

  const response = await fetchJson<{ access_token?: string }>(`${config.apiBaseUrl}/api/auth/turnstile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cf_turnstile_response: cfTurnstileResponse }),
  }, 20_000);
  const jwt = response.access_token?.trim();
  if (!jwt) return null;

  try {
    window.localStorage.setItem(AMAZON_TURNSTILE_JWT_KEY, jwt);
    window.localStorage.setItem(AMAZON_TURNSTILE_EXPIRY_KEY, String(Date.now() + 60 * 60 * 1000));
  } catch {
    // Storage may fail in private mode.
  }

  return jwt;
}

async function fetchJsonFromAnyBase<T>(bases: string[], path: string): Promise<T> {
  let lastError: unknown;
  for (const base of bases) {
    try {
      return await fetchJsonWithLocalProxyFallback<T>(`${base.replace(/\/+$/, '')}${path}`, {}, REQUEST_TIMEOUT_MS, true);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Todos los mirrors fallaron.');
}

function getArtworkUrl(coverUuid?: string | null): string | undefined {
  if (!coverUuid || coverUuid === '00000000-0000-0000-0000-000000000000' || coverUuid === 'null') {
    return undefined;
  }
  if (coverUuid.startsWith('http')) return coverUuid;
  return `https://resources.tidal.com/images/${coverUuid.replace(/-/g, '/')}/640x640.jpg`;
}

function normalizeTidalTrack(item: TidalTrackApiResponse): TidalTrack | null {
  if (!item.id || !item.title) return null;
  const coverUuid = item.album?.cover ?? null;
  const quality = item.audioQuality ?? 'LOSSLESS';
  const tags = item.mediaMetadata?.tags ?? [];
  return {
    id: item.id,
    title: item.title,
    artist: item.artist?.name ?? item.artists?.[0]?.name ?? 'Unknown Artist',
    artistId: item.artist?.id ?? item.artists?.[0]?.id,
    album: item.album?.title ?? 'Unknown Album',
    albumId: item.album?.id,
    durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
    quality,
    isHiRes: tags.includes('HIRES_LOSSLESS') || quality === 'HI_RES_LOSSLESS',
    coverUuid,
    artworkUrl: getArtworkUrl(coverUuid),
    trackNumber: item.trackNumber,
    isrc: item.isrc,
    explicit: item.explicit,
  };
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'track';
}

function getTrackBaseFilename(track: Pick<TidalTrack, 'id' | 'title' | 'artist' | 'album'>): string {
  return sanitizeFilename(`${track.artist} - ${track.album} - ${track.title}`) || `tidal_${track.id}`;
}

function extensionFromUrl(url: string, fallback = 'flac'): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.mp3')) return 'mp3';
    if (pathname.endsWith('.m4a') || pathname.endsWith('.mp4')) return 'm4a';
    if (pathname.endsWith('.flac')) return 'flac';
  } catch {
    // Keep fallback.
  }
  return fallback;
}

function mimeFromExtension(extension: string): string {
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'wav') return 'audio/wav';
  return 'audio/flac';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function persistableArtworkUrl(url?: string): Promise<string | undefined> {
  if (!url || url.startsWith('data:')) return url;
  if (url.startsWith('blob:')) return undefined;
  return (await fetchPersistableArtwork(url))?.dataUrl ?? url;
}

async function fetchPersistableArtwork(url?: string): Promise<{ dataUrl: string; blob: Blob; extension: string } | null> {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
  try {
    const response = await fetchWithLocalProxyFallback(url, { cache: 'force-cache' }, 8_000, true);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 2_500_000) return null;
    const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    return { blob, extension, dataUrl: await blobToDataUrl(blob) };
  } catch {
    return null;
  }
}

function extensionFromMime(mimeType?: string, codecs?: string): string {
  const mime = (mimeType ?? '').toLowerCase();
  const codec = (codecs ?? '').toLowerCase();
  if (mime.includes('flac') || codec.includes('flac')) return 'flac';
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a') || codec.includes('mp4') || codec.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'm4a';
}

function extensionFromAmazon(url: string, qualityInfo?: AmazonQualityInfo | null, mimeType?: string): string {
  const codec = String(qualityInfo?.codec ?? '').toLowerCase();
  if (codec.includes('flac')) return 'flac';
  if (codec.includes('mp3')) return 'mp3';
  if (codec.includes('aac') || codec.includes('mp4') || codec.includes('opus')) return 'm4a';
  return extensionFromMime(mimeType, codec) || extensionFromUrl(url, 'm4a');
}

function amazonQualityFromTidal(quality: TidalQuality): string {
  if (quality === 'HI_RES_LOSSLESS') return 'UHD';
  if (quality === 'LOSSLESS') return 'HD';
  if (quality === 'HIGH' || quality === 'MP3') return 'SD_HIGH';
  return 'SD_LOW';
}

function unwrapAmazonPayload(payload: AmazonTrackEnvelope): AmazonTrackPayload {
  if (payload.stream_url || payload.url) return payload;
  return payload.data ?? payload.track ?? payload.result ?? payload;
}

function getAmazonSelectedQualityInfo(payload: AmazonTrackPayload): AmazonQualityInfo | null {
  if (!Array.isArray(payload.available_qualities)) return null;
  return payload.available_qualities.find(item => item.quality === payload.quality_selected) ?? payload.available_qualities[0] ?? null;
}

function getAmazonDecryptionKey(payload: AmazonTrackPayload): string {
  return payload.decryption_key
    ?? payload.decryptionKey
    ?? payload.decryption?.key
    ?? payload.drm?.decryption_key
    ?? payload.drm?.decryptionKey
    ?? '';
}

function getAmazonPlaybackType(payload: AmazonTrackPayload): string[] {
  const value = payload.playback_type ?? payload.playbackType ?? [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function decodeSaavnText(value?: string): string {
  if (!value) return '';
  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = withoutTags;
  return textarea.value.replace(/\s+/g, ' ').trim();
}

function getSaavnArtist(song: SaavnSong): string {
  const subtitleArtist = song.subtitle?.split(' - ')[0]?.trim();
  if (subtitleArtist) return decodeSaavnText(subtitleArtist);
  const primary = song.more_info?.artists?.primary?.map(artist => artist.name).filter(Boolean).join(', ');
  return decodeSaavnText(primary) || 'Unknown Artist';
}

function getSaavnAudioQuality(quality: TidalQuality): string {
  if (quality === 'LOW') return '128';
  if (quality === 'HIGH' || quality === 'MP3' || quality === 'LOSSLESS' || quality === 'HI_RES_LOSSLESS') return '320';
  return '320';
}

function decryptSaavnMediaUrl(encryptedMediaUrl: string): string {
  const paddingLength = (4 - encryptedMediaUrl.length % 4) % 4;
  const padded = `${encryptedMediaUrl}${'='.repeat(paddingLength)}`;
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(padded),
  });
  return CryptoJS.DES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(SAAVN_DES_KEY), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);
}

function getSaavnStreamUrl(song: SaavnSong, quality: TidalQuality): string {
  const encrypted = song.more_info?.encrypted_media_url?.trim();
  if (!encrypted) return '';
  const decrypted = decryptSaavnMediaUrl(encrypted);
  if (!decrypted) return '';
  return decrypted.replace(/_\d+\.mp4(\?.*)?$/i, `_${getSaavnAudioQuality(quality)}.mp4$1`);
}

function scoreSaavnCandidate(source: TidalTrack, song: SaavnSong): number {
  const title = decodeSaavnText(song.title);
  const artist = getSaavnArtist(song);
  const album = decodeSaavnText(song.more_info?.album);
  let score = 0;

  const sourceTitle = comparable(source.title);
  const candidateTitle = comparable(title);
  const sourceArtist = comparable(source.artist);
  const candidateArtist = comparable(artist);
  const sourceAlbum = comparable(source.album);
  const candidateAlbum = comparable(album);

  if (sourceTitle === candidateTitle) score += 140;
  if (candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle)) score += 60;
  if (sourceArtist === candidateArtist) score += 120;
  if (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist)) score += 50;
  if (sourceAlbum && sourceAlbum === candidateAlbum) score += 40;

  const durationSeconds = Number.parseInt(song.more_info?.duration ?? '', 10);
  if (Number.isFinite(durationSeconds) && source.durationMs) {
    const delta = Math.abs(durationSeconds * 1000 - source.durationMs);
    if (delta <= 2500) score += 35;
    else if (delta <= 8000) score += 12;
  }

  if (song.more_info?.encrypted_media_url) score += 20;
  return score;
}

function normalizeAmazonQuality(payload: AmazonTrackPayload, qualityInfo: AmazonQualityInfo | null): string {
  const selected = String(payload.quality_selected ?? payload.quality_requested ?? qualityInfo?.quality ?? '').toUpperCase();
  if (selected.startsWith('UHD')) return 'HI_RES_LOSSLESS';
  if (selected.startsWith('HD')) return 'LOSSLESS';
  return 'HIGH';
}

function normalizeDeezerFormat(quality: TidalQuality): 'FLAC' | 'MP3_320' | 'MP3_128' {
  if (quality === 'HIGH' || quality === 'MP3') return 'MP3_320';
  if (quality === 'LOW') return 'MP3_128';
  return 'FLAC';
}

function trackFromTidal(track: TidalTrack, uri: string, source: 'tidal' | 'tidal_stream', extension?: string): Track {
  const ext = extension ?? extensionFromUrl(uri);
  const formatMap: Record<string, string> = { flac: 'FLAC', m4a: 'AAC', mp3: 'MP3', wav: 'WAV' };
  return {
    id: source === 'tidal_stream' ? `tidal_stream_${track.id}` : `tidal_${track.id}`,
    uri,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId ? String(track.artistId) : undefined,
    album: track.album,
    albumId: generateAlbumId(track.album, track.artist),
    duration: track.durationMs,
    artwork: track.artworkUrl,
    trackNumber: track.trackNumber,
    year: track.year,
    format: formatMap[ext] || ext.toUpperCase(),
    codec: track.codec ?? ext,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    quality: track.quality,
    source,
    tidalId: track.id,
    tidalAlbumId: track.albumId,
    dateAdded: Date.now(),
  };
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${maybeRelative.replace(/^\/+/, '')}`;
}

function isTidalAudioUrl(url: string): boolean {
  if (!url || url.startsWith(AUDIO_PROXY_BASE_URL) || url.startsWith('blob:') || url.startsWith('data:')) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'tidal.com' && !hostname.endsWith('.tidal.com')) return false;
    if (hostname === 'api.tidal.com' || hostname === 'openapi.tidal.com' || hostname === 'resources.tidal.com') return false;
    return hostname.includes('audio') || /\.(aac|flac|m4a|m4s|mp4|mpd|m3u8)(?:$|[?#])/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getProxyUrl(url: string): string {
  if (!url || url.includes('/api/decrypt-stream')) return url;
  return isTidalAudioUrl(url) ? `${AUDIO_PROXY_BASE_URL}${url}` : url;
}

function buildSegmentTemplateMedia(mediaTemplate: string, number: number): string {
  return mediaTemplate.replace(/\$Number(%0(\d+)d)?\$/g, (_full, _format, width) => (
    width ? String(number).padStart(Number.parseInt(width, 10), '0') : String(number)
  ));
}

function resolveDashTemplate(template: string, representationId: string, number: number, time: number): string {
  return template
    .replace(/\$RepresentationID\$/g, representationId)
    .replace(/\$Number(?:%0([0-9]+)d)?\$/g, (_full, width) => (
      width ? String(number).padStart(Number.parseInt(width, 10), '0') : String(number)
    ))
    .replace(/\$Time(?:%0([0-9]+)d)?\$/g, (_full, width) => (
      width ? String(time).padStart(Number.parseInt(width, 10), '0') : String(time)
    ));
}

function parseDashManifest(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const adaptationSets = Array.from(doc.getElementsByTagName('AdaptationSet'))
    .filter(node => (node.getAttribute('mimeType') ?? '').toLowerCase().includes('audio'));
  const adaptationSet = adaptationSets.sort((left, right) => {
    const maxBandwidth = (set: Element) => Math.max(
      0,
      ...Array.from(set.getElementsByTagName('Representation')).map(rep => Number.parseInt(rep.getAttribute('bandwidth') ?? '0', 10)),
    );
    return maxBandwidth(right) - maxBandwidth(left);
  })[0] ?? doc.getElementsByTagName('AdaptationSet')[0];
  const representation = Array.from(adaptationSet?.getElementsByTagName('Representation') ?? [])
    .sort((left, right) => Number.parseInt(right.getAttribute('bandwidth') ?? '0', 10) - Number.parseInt(left.getAttribute('bandwidth') ?? '0', 10))[0];
  const segmentTemplate = representation?.getElementsByTagName('SegmentTemplate')[0]
    ?? adaptationSet?.getElementsByTagName('SegmentTemplate')[0];
  const baseUrl = representation?.getElementsByTagName('BaseURL')[0]?.textContent?.trim()
    ?? adaptationSet?.getElementsByTagName('BaseURL')[0]?.textContent?.trim()
    ?? doc.getElementsByTagName('Period')[0]?.getElementsByTagName('BaseURL')[0]?.textContent?.trim()
    ?? doc.getElementsByTagName('MPD')[0]?.getElementsByTagName('BaseURL')[0]?.textContent?.trim()
    ?? '';

  if (!segmentTemplate) {
    return Array.from(xml.matchAll(/https?:\/\/[^"'\s<]+/gi)).map(match => match[0]);
  }

  const urls: string[] = [];
  const initialization = segmentTemplate.getAttribute('initialization') ?? '';
  const media = segmentTemplate.getAttribute('media') ?? '';
  const startNumber = Number.parseInt(segmentTemplate.getAttribute('startNumber') ?? '1', 10);
  const timelineNodes = Array.from(segmentTemplate.getElementsByTagName('S'));
  const representationId = representation?.getAttribute('id') ?? '';
  const segments: Array<{ number: number; time: number }> = [];
  let currentTime = 0;
  let currentNumber = startNumber;
  for (const node of timelineNodes) {
    const explicitTime = Number.parseInt(node.getAttribute('t') ?? '', 10);
    if (Number.isFinite(explicitTime)) currentTime = explicitTime;
    const duration = Number.parseInt(node.getAttribute('d') ?? '0', 10);
    const repeat = Number.parseInt(node.getAttribute('r') ?? '0', 10);
    const count = repeat >= 0 ? repeat + 1 : 1;
    for (let index = 0; index < count; index += 1) {
      segments.push({ number: currentNumber, time: currentTime });
      currentNumber += 1;
      currentTime += duration;
    }
  }

  if (initialization) urls.push(resolveUrl(baseUrl, resolveDashTemplate(initialization, representationId, startNumber, 0)));
  for (const segment of segments) {
    if (media) urls.push(resolveUrl(baseUrl, resolveDashTemplate(media, representationId, segment.number, segment.time)));
  }
  return urls;
}

async function getTidalManifest(trackId: number, quality: TidalQuality): Promise<ParsedManifest> {
  const formats = quality === 'HI_RES_LOSSLESS'
    ? ['FLAC_HIRES']
    : quality === 'LOSSLESS'
      ? ['FLAC']
      : quality === 'LOW'
        ? ['HEAACV1']
        : ['AACLC'];
  const params = new URLSearchParams({
    id: String(trackId),
    quality,
    adaptive: 'false',
    manifestType: 'MPEG_DASH',
    uriScheme: 'HTTPS',
    usage: 'PLAYBACK',
  });
  formats.forEach(format => params.append('formats', format));

  const response = await fetchMonochromeJson<TrackManifestResponse>('streaming', `/trackManifests/?${params}`);
  const attributes = response.data?.data?.attributes;
  if (!attributes?.uri || attributes.trackPresentation === 'PREVIEW') {
    throw new Error(attributes?.previewReason || 'El mirror devolvió solo preview.');
  }

  const manifestResponse = await fetchWithLocalProxyFallback(getProxyUrl(attributes.uri));
  if (!manifestResponse.ok) throw new Error(`No se pudo abrir el manifest (${manifestResponse.status}).`);
  const manifestMimeType = manifestResponse.headers.get('content-type') || undefined;
  const text = (await manifestResponse.text()).trim();
  if (text.startsWith('<')) {
    const urls = parseDashManifest(text);
    return {
      urls,
      quality,
      mimeType: manifestMimeType || 'audio/mp4',
      isSegmented: urls.length > 1,
      manifestUrl: attributes.uri,
    };
  }
  return { urls: [attributes.uri], quality, mimeType: manifestMimeType, isSegmented: false, manifestUrl: attributes.uri };
}

function normalizeQobuzTrack(item: QobuzTrackItem): TidalTrack | null {
  if (!item.id || !item.title) return null;
  const artist = item.performer?.name?.trim() || 'Unknown Artist';
  const album = item.album?.title?.trim() || 'Unknown Album';
  const bitDepth = item.maximum_bit_depth;
  const sampleRate = typeof item.maximum_sampling_rate === 'number'
    ? Math.round(item.maximum_sampling_rate * 1000)
    : undefined;
  return {
    id: item.id,
    title: `${item.title}${item.version ? ` (${item.version})` : ''}`,
    artist,
    artistId: item.performer?.id,
    album,
    albumId: item.album?.id ? Number.parseInt(String(item.album.id), 10) : undefined,
    durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
    quality: item.hires || (bitDepth ?? 0) > 16 ? 'HI_RES_LOSSLESS' : 'LOSSLESS',
    isHiRes: Boolean(item.hires) || (bitDepth ?? 0) > 16,
    coverUuid: String(item.album?.id ?? ''),
    artworkUrl: item.album?.image?.large || item.album?.image?.small || item.album?.image?.thumbnail,
    trackNumber: item.track_number,
    sampleRate,
    bitDepth,
    codec: 'flac',
    isrc: item.isrc,
  };
}

function comparable(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreCandidate(source: Pick<TidalTrack, 'title' | 'artist' | 'album' | 'isrc'>, candidate: TidalTrack): number {
  if (source.isrc && candidate.isrc && source.isrc.toLowerCase() === candidate.isrc.toLowerCase()) return 1000;
  let score = 0;
  const sourceTitle = comparable(source.title);
  const candidateTitle = comparable(candidate.title);
  const sourceArtist = comparable(source.artist);
  const candidateArtist = comparable(candidate.artist);
  if (sourceTitle === candidateTitle) score += 140;
  if (candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle)) score += 60;
  if (sourceArtist === candidateArtist) score += 120;
  if (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist)) score += 50;
  if (comparable(source.album) === comparable(candidate.album)) score += 35;
  if (candidate.isHiRes) score += 8;
  return score;
}

async function resolveQobuzUrl(track: TidalTrack, quality: TidalQuality): Promise<ResolvedDownload | null> {
  const query = track.isrc?.trim() || `${track.artist} ${track.title}`.trim();
  const qobuzInstances = await getMonochromeInstances('qobuz');
  const qobuzBases = qobuzInstances.map(instanceUrl).filter(Boolean);
  const search = await fetchJsonFromAnyBase<QobuzSearchResponse>(
    qobuzBases.length ? qobuzBases : QOBUZ_API_BASES,
    `/api/get-music?q=${encodeURIComponent(query)}&offset=0`,
  );
  const candidates = (search.data?.tracks?.items ?? []).map(normalizeQobuzTrack).filter(Boolean) as TidalTrack[];
  const best = candidates.map(candidate => ({ candidate, score: scoreCandidate(track, candidate) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  if (!best) return null;

  const q = quality === 'HI_RES_LOSSLESS' ? '27' : quality === 'MP3' || quality === 'HIGH' || quality === 'LOW' ? '5' : '6';
  const download = await fetchJsonFromAnyBase<QobuzDownloadResponse>(
    qobuzBases.length ? qobuzBases : QOBUZ_API_BASES,
    `/api/download-music?track_id=${best.id}&quality=${q}`,
  );
  const url = download.data?.url?.trim();
  if (!download.success || !url) return null;
  const extension = extensionFromUrl(url, q === '5' ? 'mp3' : 'flac');
  return {
    url,
    filename: `${getTrackBaseFilename(track)}.${extension}`,
    mimeType: mimeFromExtension(extension),
    source: 'monochrome',
    track: { ...track, quality: best.quality, sampleRate: best.sampleRate, bitDepth: best.bitDepth, codec: best.codec },
  };
}

async function resolveAmazonUrl(track: TidalTrack, quality: TidalQuality): Promise<ExternalAudio | null> {
  const config = loadAmazonMusicConfig();
  const bypassToken = config.bypassToken.trim();
  const manualJwt = bypassToken.split('.').length === 3 ? bypassToken : '';

  const params = new URLSearchParams({
    track: track.title,
    duration: track.durationMs ? String(Math.round(track.durationMs / 1000)) : '',
    album: track.album,
    artist: track.artist,
    quality: amazonQualityFromTidal(quality),
  });
  if (bypassToken && !manualJwt) {
    params.set('bypass_token', bypassToken);
  }

  const request = async (jwt?: string | null) => {
    const { signal, cleanup } = withTimeoutSignal(15_000);
    try {
      return await fetch(`${config.apiBaseUrl}/api/track/?${params}`, {
        signal,
        headers: jwt ? { 'X-Turnstile-JWT': jwt } : undefined,
      });
    } finally {
      cleanup();
    }
  };

  let response = await request(manualJwt || undefined);
  if (response.status === 401 || response.status === 428) {
    const jwt = await getAmazonTurnstileJwt(true).catch(() => null);
    if (!jwt) return null;
    response = await request(jwt);
  }

  if (response.status === 403 || response.status === 429) return null;
  if (!response.ok) return null;

  const payload = unwrapAmazonPayload(await response.json() as AmazonTrackEnvelope);
  const url = (payload.stream_url ?? payload.url ?? payload.source_url ?? payload.sourceUrl ?? '').trim();
  if (!url) return null;

  const playbackTypes = getAmazonPlaybackType(payload).map(value => value.toLowerCase());
  const decryptionKey = getAmazonDecryptionKey(payload);
  const qualityInfo = getAmazonSelectedQualityInfo(payload);
  const normalizedQuality = normalizeAmazonQuality(payload, qualityInfo);
  const mimeType = payload.mime_type ?? payload.media_mime_type ?? (qualityInfo?.codec ? `audio/mp4; codecs="${qualityInfo.codec}"` : 'audio/mp4');
  const extension = extensionFromAmazon(url, qualityInfo, mimeType);

  let finalUrl = url;
  let finalMimeType = mimeType;
  if (decryptionKey) {
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isAac = normalizedQuality === 'HIGH' || normalizedQuality === 'MP3';
    const codec = isAac ? 'mp4a' : isSafari ? 'flac-hls' : 'flac';

    const decryptParams = new URLSearchParams();
    decryptParams.set('url', url);
    decryptParams.set('key', decryptionKey);
    decryptParams.set('codec', codec);

    finalUrl = `/api/decrypt-stream?${decryptParams.toString()}`;
    finalMimeType = codec === 'flac-hls' ? 'application/x-mpegURL' : (isAac ? 'audio/mp4' : 'audio/mp4; codecs="fLaC"');
  } else if (playbackTypes.some(value => value.includes('cenc'))) {
    return null;
  }

  return {
    url: finalUrl,
    extension,
    mimeType: finalMimeType,
    provider: 'amazon',
    quality: normalizedQuality,
    codec: qualityInfo?.codec ?? extension,
    sampleRate: qualityInfo?.sampleRate,
    bitDepth: qualityInfo?.bitDepth,
  };
}

async function resolveSaavnUrl(track: TidalTrack, quality: TidalQuality): Promise<ExternalAudio | null> {
  const query = `${track.artist} ${track.title}`.trim();
  if (!query) return null;

  const search = await fetchJsonWithLocalProxyFallback<SaavnSearchResponse>(
    `${SAAVN_SEARCH_API_BASE_URL}/api/songs?q=${encodeURIComponent(query)}`,
    {},
    15_000,
    true,
  );
  const results = Array.isArray(search.results) ? search.results : search.data?.results ?? [];
  const best = results
    .map(song => ({ song, score: scoreSaavnCandidate(track, song) }))
    .filter(item => item.score >= 150)
    .sort((a, b) => b.score - a.score)[0]?.song;

  if (!best) return null;

  let resolvedSong = best;
  if (!best.more_info?.encrypted_media_url && best.perma_url) {
    resolvedSong = await fetchJsonWithLocalProxyFallback<SaavnSong>(
      `${SAAVN_RESOLVE_API_BASE_URL}/song?url=${encodeURIComponent(best.perma_url)}`,
      {},
      15_000,
      true,
    ).catch(() => best);
  }

  const url = getSaavnStreamUrl(resolvedSong, quality);
  if (!url) return null;

  return {
    url,
    extension: 'm4a',
    mimeType: 'audio/mp4',
    provider: 'saavn',
    quality: getSaavnAudioQuality(quality) === '320' ? 'HIGH' : 'LOW',
    codec: 'aac',
  };
}

async function resolveDeezerUrl(track: TidalTrack, quality: TidalQuality): Promise<ExternalAudio | null> {
  const isrc = track.isrc?.trim();
  if (!isrc) return null;

  const format = normalizeDeezerFormat(quality);
  const url = `${DEEZER_API_BASE_URL}/stream/?isrc=${encodeURIComponent(isrc)}&format=${encodeURIComponent(format)}`;
  const { signal, cleanup } = withTimeoutSignal(12_000);
  try {
    const response = await fetchWithLocalProxyFallback(getProxyUrl(url), { method: 'HEAD', signal });
    if (!response.ok && response.status !== 405 && response.status !== 501) return null;
  } catch {
    return null;
  } finally {
    cleanup();
  }

  const extension = format === 'FLAC' ? 'flac' : 'mp3';
  return {
    url,
    extension,
    mimeType: mimeFromExtension(extension),
    provider: 'deezer',
    quality: format === 'FLAC' ? 'LOSSLESS' : 'HIGH',
    codec: extension,
  };
}

async function resolveExternalAudio(track: TidalTrack, quality: TidalQuality): Promise<ResolvedDownload | null> {
  console.debug('[StaySound downloads] intentando Amazon UHD', { title: track.title, artist: track.artist, album: track.album });
  const amazon = await resolveAmazonUrl(track, 'HI_RES_LOSSLESS').catch(() => null);
  if (amazon) {
    return {
      url: amazon.url,
      filename: `${getTrackBaseFilename(track)}.${amazon.extension}`,
      mimeType: amazon.mimeType || mimeFromExtension(amazon.extension),
      source: 'monochrome',
      track: {
        ...track,
        quality: amazon.quality,
        isHiRes: amazon.quality === 'HI_RES_LOSSLESS',
        codec: amazon.codec ?? track.codec,
        sampleRate: amazon.sampleRate ?? track.sampleRate,
        bitDepth: amazon.bitDepth ?? track.bitDepth,
      },
    };
  }

  console.debug('[StaySound downloads] intentando Saavn', { title: track.title, artist: track.artist, album: track.album });
  const saavn = await resolveSaavnUrl(track, quality).catch(() => null);
  if (saavn) {
    return {
      url: saavn.url,
      filename: `${getTrackBaseFilename(track)}.${saavn.extension}`,
      mimeType: saavn.mimeType || mimeFromExtension(saavn.extension),
      source: 'monochrome',
      track: {
        ...track,
        quality: saavn.quality,
        isHiRes: false,
        codec: saavn.codec ?? track.codec,
      },
    };
  }

  console.debug('[StaySound downloads] intentando Qobuz', { title: track.title, artist: track.artist, isrc: track.isrc });
  const qobuz = await resolveQobuzUrl(track, quality).catch(() => null);
  if (qobuz) return qobuz;

  console.debug('[StaySound downloads] intentando Deezer', { title: track.title, artist: track.artist, isrc: track.isrc });
  const deezer = await resolveDeezerUrl(track, quality).catch(() => null);
  if (deezer) {
    return {
      url: deezer.url,
      filename: `${getTrackBaseFilename(track)}.${deezer.extension}`,
      mimeType: deezer.mimeType || mimeFromExtension(deezer.extension),
      source: 'monochrome',
      track: {
        ...track,
        quality: deezer.quality,
        isHiRes: false,
        codec: deezer.codec ?? track.codec,
      },
    };
  }

  return null;
}

async function resolveMonochromeDownload(result: DownloadSearchResult): Promise<ResolvedDownload> {
  const track = result.raw as TidalTrack;
  const external = await resolveExternalAudio(track, DEFAULT_QUALITY);
  if (external) return external;

  const manifest = await getTidalManifest(track.id, DEFAULT_QUALITY);
  const extension = manifest.isSegmented ? 'm4a' : extensionFromUrl(manifest.urls[0], 'flac');
  return {
    url: manifest.urls[0] ?? manifest.manifestUrl ?? '',
    segmentUrls: manifest.isSegmented ? manifest.urls : undefined,
    filename: `${getTrackBaseFilename(track)}.${extension}`,
    mimeType: mimeFromExtension(extension),
    source: 'monochrome',
    track: { ...track, quality: manifest.quality, codec: manifest.codecs ?? track.codec },
  };
}

async function fetchBlobWithProgress(
  resolved: ResolvedDownload,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (resolved.segmentUrls?.length) {
    const chunks: ArrayBuffer[] = [];
    for (let index = 0; index < resolved.segmentUrls.length; index += 1) {
      if (signal?.aborted) throw new Error('Descarga cancelada');
      const response = await fetchWithLocalProxyFallback(getProxyUrl(resolved.segmentUrls[index]), { signal });
      if (!response.ok) throw new Error(`Falló un segmento (${response.status}).`);
      chunks.push(await response.arrayBuffer());
      onProgress?.((index + 1) / resolved.segmentUrls.length);
    }
    return new Blob(chunks, { type: resolved.mimeType || 'audio/mp4' });
  }

  if (resolved.url.includes('.m3u8') || resolved.mimeType?.includes('mpegurl')) {
    return fetchHlsBlobWithProgress(resolved.url, signal, onProgress);
  }

  const response = await fetchWithLocalProxyFallback(getProxyUrl(resolved.url), { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Descarga falló (${response.status}).`);
  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body || !total) {
    const blob = await response.blob();
    onProgress?.(1);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      received += value.byteLength;
      onProgress?.(Math.min(0.98, received / total));
    }
  }
  onProgress?.(1);
  return new Blob(chunks, { type: resolved.mimeType });
}

function blobToStreamTrack(track: TidalTrack, blob: Blob, extension: string): Track {
  const uri = URL.createObjectURL(blob);
  return trackFromTidal(track, uri, 'tidal_stream', extension);
}

function resolvePlaylistUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).href;
  } catch {
    return maybeRelative;
  }
}

function getBestHlsVariant(masterUrl: string, masterText: string): string {
  if (!masterText.includes('#EXT-X-STREAM-INF')) return masterUrl;
  const lines = masterText.split('\n');
  const variants: Array<{ bandwidth: number; url: string }> = [];
  let currentBandwidth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      currentBandwidth = Number.parseInt(trimmed.match(/BANDWIDTH=(\d+)/)?.[1] ?? '0', 10);
      continue;
    }
    if (trimmed && !trimmed.startsWith('#') && currentBandwidth >= 0) {
      variants.push({ bandwidth: currentBandwidth, url: resolvePlaylistUrl(masterUrl, trimmed) });
      currentBandwidth = 0;
    }
  }

  return variants.sort((left, right) => right.bandwidth - left.bandwidth)[0]?.url ?? masterUrl;
}

async function fetchHlsBlobWithProgress(
  playlistUrl: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const masterResponse = await fetchWithLocalProxyFallback(getProxyUrl(playlistUrl), { signal });
  if (!masterResponse.ok) throw new Error(`HLS playlist fallo (${masterResponse.status}).`);
  const masterText = await masterResponse.text();
  const variantUrl = getBestHlsVariant(playlistUrl, masterText);
  const mediaResponse = variantUrl === playlistUrl
    ? { text: async () => masterText }
    : await fetchWithLocalProxyFallback(getProxyUrl(variantUrl), { signal });

  if ('ok' in mediaResponse && !mediaResponse.ok) throw new Error(`HLS media playlist fallo (${mediaResponse.status}).`);
  const mediaText = await mediaResponse.text();
  const segments = mediaText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => resolvePlaylistUrl(variantUrl, line));

  if (segments.length === 0) throw new Error('HLS no devolvio segmentos.');

  const chunks: ArrayBuffer[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (signal?.aborted) throw new Error('Descarga cancelada');
    const response = await fetchWithLocalProxyFallback(getProxyUrl(segments[index]), { signal });
    if (!response.ok) throw new Error(`HLS segmento fallo (${response.status}).`);
    chunks.push(await response.arrayBuffer());
    onProgress?.((index + 1) / segments.length);
  }

  const first = segments[0] ?? '';
  return new Blob(chunks, { type: first.endsWith('.m4s') || first.includes('mp4') ? 'video/mp4' : 'video/mp2t' });
}

function getSoulseekBridgeConfig(): SlskdConfig | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SOULSEEK_BRIDGE_CONFIG_KEY) || 'null') as Partial<SlskdConfig> | null;
    if (!parsed?.baseUrl) return null;
    return {
      baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

export function saveSoulseekBridgeConfig(config: SlskdConfig): void {
  window.localStorage.setItem(SOULSEEK_BRIDGE_CONFIG_KEY, JSON.stringify({
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
  }));
}

export function loadSoulseekBridgeConfig(): SlskdConfig {
  return getSoulseekBridgeConfig() ?? { baseUrl: 'http://localhost:4317' };
}

export function loadSoulseekCredentials(): SoulseekCredentials | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SOULSEEK_CREDENTIALS_KEY) || 'null') as Partial<SoulseekCredentials> | null;
    const username = parsed?.username?.trim() ?? '';
    const password = parsed?.password?.trim() ?? '';
    return username && password ? { username, password } : null;
  } catch {
    return null;
  }
}

export function saveSoulseekCredentials(username: string, password: string): void {
  const normalizedUsername = username.trim();
  const normalizedPassword = password.trim();
  if (!normalizedUsername || !normalizedPassword) {
    throw new Error('Usuario y password son obligatorios.');
  }
  window.localStorage.setItem(SOULSEEK_CREDENTIALS_KEY, JSON.stringify({
    username: normalizedUsername,
    password: normalizedPassword,
  }));
}

export function loadAmazonMusicConfig(): AmazonMusicConfig {
  const envApiBaseUrl = (import.meta.env.VITE_AMAZON_MUSIC_API_BASE_URL as string | undefined)?.trim()
    || (import.meta.env.EXPO_PUBLIC_AMAZON_MUSIC_API_BASE_URL as string | undefined)?.trim()
    || AMAZON_API_BASE_URL;
  const envSiteKey = (import.meta.env.VITE_AMAZON_TURNSTILE_SITE_KEY as string | undefined)?.trim()
    || (import.meta.env.EXPO_PUBLIC_AMAZON_TURNSTILE_SITE_KEY as string | undefined)?.trim()
    || AMAZON_TURNSTILE_SITE_KEY;
  const envBypassToken = (import.meta.env.VITE_AMAZON_MUSIC_BYPASS_TOKEN as string | undefined)?.trim()
    || (import.meta.env.EXPO_PUBLIC_AMAZON_MUSIC_BYPASS_TOKEN as string | undefined)?.trim()
    || '';

  try {
    const parsed = JSON.parse(window.localStorage.getItem(AMAZON_CONFIG_KEY) || 'null') as Partial<AmazonMusicConfig> | null;
    return {
      apiBaseUrl: (parsed?.apiBaseUrl?.trim() || envApiBaseUrl).replace(/\/+$/, ''),
      turnstileSiteKey: parsed?.turnstileSiteKey?.trim() || envSiteKey,
      bypassToken: parsed?.bypassToken?.trim() || envBypassToken,
    };
  } catch {
    return {
      apiBaseUrl: envApiBaseUrl.replace(/\/+$/, ''),
      turnstileSiteKey: envSiteKey,
      bypassToken: envBypassToken,
    };
  }
}

export function saveAmazonMusicConfig(config: AmazonMusicConfig): void {
  const normalized = {
    apiBaseUrl: (config.apiBaseUrl.trim() || AMAZON_API_BASE_URL).replace(/\/+$/, ''),
    turnstileSiteKey: config.turnstileSiteKey.trim(),
    bypassToken: config.bypassToken.trim(),
  };
  window.localStorage.setItem(AMAZON_CONFIG_KEY, JSON.stringify(normalized));
  window.localStorage.removeItem(AMAZON_TURNSTILE_JWT_KEY);
  window.localStorage.removeItem(AMAZON_TURNSTILE_EXPIRY_KEY);
}

function getRequiredSoulseekCredentials(): SoulseekCredentials {
  const credentials = loadSoulseekCredentials();
  if (!credentials) {
    throw new Error('Inicia sesion en Soulseek con usuario y password.');
  }
  return credentials;
}

function extractSoulseekMatches(payload: unknown): SoulseekMatch[] {
  const matches: SoulseekMatch[] = [];
  const visit = (value: unknown, usernameHint?: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, usernameHint));
      return;
    }
    const record = value as Record<string, unknown>;
    const username = String(record.username ?? record.userName ?? record.user ?? usernameHint ?? '');
    const files = record.files ?? record.fileList ?? record.results;
    if (Array.isArray(files)) {
      files.forEach(file => visit(file, username));
    }
    const filename = String(record.filename ?? record.fileName ?? record.path ?? '');
    if (username && filename) {
      matches.push({
        username,
        filename,
        size: typeof record.size === 'number' ? record.size : undefined,
        extension: filename.split('.').pop()?.toLowerCase(),
        durationMs: typeof record.duration === 'number' ? Math.round(record.duration * 1000) : undefined,
        bitRate: typeof record.bitRate === 'number' ? record.bitRate : undefined,
        sampleRate: typeof record.sampleRate === 'number' ? record.sampleRate : undefined,
        bitDepth: typeof record.bitDepth === 'number' ? record.bitDepth : undefined,
        raw: record,
      });
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'files' && key !== 'fileList' && key !== 'results') visit(child, usernameHint);
    }
  };
  visit(payload);
  return matches.filter(match => /\.(flac|mp3|m4a)$/i.test(match.filename));
}

function virtualTrackFromSoulseek(match: SoulseekMatch): TidalTrack {
  const leaf = match.filename.replace(/\//g, '\\').split('\\').pop() ?? match.filename;
  const cleaned = leaf.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+\s*[-._)]\s*/, '').replace(/[_]+/g, ' ').trim();
  const parts = cleaned.split(/\s+-\s+/);
  const artist = parts.length >= 2 ? parts.shift() || match.username : match.username;
  const title = parts.length >= 1 ? parts.join(' - ') : cleaned || 'Soulseek track';
  let hash = 0;
  for (const char of `${match.username}|${match.filename}|${match.size ?? 0}`) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const ext = match.extension ?? extensionFromUrl(match.filename, 'mp3');
  return {
    id: -Math.abs(hash || Date.now()),
    title,
    artist,
    album: '',
    durationMs: match.durationMs ?? 0,
    quality: ext === 'flac' ? 'LOSSLESS' : 'HIGH',
    isHiRes: (match.sampleRate ?? 0) >= 88_200 || (match.bitDepth ?? 0) >= 24,
    codec: ext,
    sampleRate: match.sampleRate,
    bitDepth: match.bitDepth,
  };
}

async function searchSoulseekBridge(query: string): Promise<DownloadSearchResult[]> {
  const config = getSoulseekBridgeConfig();
  if (!config) throw new Error('Configura el bridge de Soulseek antes de buscar.');
  const credentials = getRequiredSoulseekCredentials();
  const payload = await fetchJson<{ results?: SoulseekMatch[] }>(`${config.baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, timeoutMs: 9000, maxResults: 40, credentials }),
  }, 20_000);
  return (payload.results ?? []).slice(0, 40).map(match => {
    const track = virtualTrackFromSoulseek(match);
    return {
      id: `soulseek_${Math.abs(track.id)}`,
      source: 'soulseek',
      title: track.title,
      artist: track.artist,
      album: track.album,
      quality: track.quality,
      durationMs: track.durationMs,
      size: match.size,
      raw: match,
    };
  });
}

async function resolveSoulseekDownload(result: DownloadSearchResult): Promise<ResolvedDownload> {
  const match = result.raw as SoulseekMatch;
  const track = virtualTrackFromSoulseek(match);
  const ext = match.extension ?? extensionFromUrl(match.filename, 'mp3');
  return {
    url: '',
    filename: `${sanitizeFilename(track.artist)} - ${sanitizeFilename(track.title)}.${ext}`,
    mimeType: mimeFromExtension(ext),
    source: 'soulseek',
    track,
  };
}

async function resolveSoulseekBridgeFile(resolved: ResolvedDownload): Promise<ResolvedDownload> {
  const config = getSoulseekBridgeConfig();
  if (!config) throw new Error('Configura el bridge de Soulseek antes de descargar.');
  const credentials = getRequiredSoulseekCredentials();
  const match = (resolved.track as TidalTrack & { match?: SoulseekMatch }).match
    ?? null;
  if (!match) {
    throw new Error('La descarga Soulseek necesita el match original del bridge.');
  }
  const payload = await fetchJson<{ url: string; filename: string; mimeType?: string }>(`${config.baseUrl}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ match, filename: resolved.filename, credentials }),
  }, 900_000);
  return {
    ...resolved,
    url: payload.url,
    filename: payload.filename || resolved.filename,
    mimeType: payload.mimeType || resolved.mimeType,
  };
}

export const monochromeDownloadProvider: DownloadProvider = {
  async search(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const payload = await fetchMonochromeJson<TidalSearchApiResponse>('api', `/search/?s=${encodeURIComponent(trimmed)}`);
    return (payload.data?.items ?? [])
      .map(normalizeTidalTrack)
      .filter(Boolean)
      .map(track => ({
        id: `monochrome_${track!.id}`,
        source: 'monochrome' as const,
        title: track!.title,
        artist: track!.artist,
        album: track!.album,
        artwork: track!.artworkUrl,
        quality: track!.quality,
        durationMs: track!.durationMs,
        raw: track,
      }));
  },

  async resolveStream(result) {
    const track = result.raw as TidalTrack;
    const external = await resolveExternalAudio(track, DEFAULT_QUALITY);
    if (external) return trackFromTidal(external.track, external.url, 'tidal_stream', extensionFromUrl(external.filename));

    const manifest = await getTidalManifest(track.id, DEFAULT_QUALITY);
    if (manifest.isSegmented) {
      const blob = await fetchBlobWithProgress({
        url: manifest.urls[0] ?? manifest.manifestUrl ?? '',
        segmentUrls: manifest.urls,
        filename: `${getTrackBaseFilename(track)}.${extensionFromMime(manifest.mimeType, manifest.codecs)}`,
        mimeType: manifest.mimeType || 'audio/mp4',
        source: 'monochrome',
        track: { ...track, quality: manifest.quality, codec: manifest.codecs ?? track.codec },
      });
      return blobToStreamTrack(
        { ...track, quality: manifest.quality, codec: manifest.codecs ?? track.codec },
        blob,
        extensionFromMime(manifest.mimeType, manifest.codecs),
      );
    }

    const streamUrl = manifest.urls[0] ?? manifest.manifestUrl;
    if (!streamUrl) throw new Error('No encontré una URL reproducible.');
    return trackFromTidal(
      { ...track, quality: manifest.quality, codec: manifest.codecs ?? track.codec },
      streamUrl,
      'tidal_stream',
      extensionFromMime(manifest.mimeType, manifest.codecs),
    );
  },

  resolveDownload: resolveMonochromeDownload,

  async download(resolved, options) {
    const blob = await fetchBlobWithProgress(resolved, options?.signal, options?.onProgress);
    const written = options?.folderHandle
      ? await writeBlobToDownloadFolder(options.folderHandle, resolved.filename, blob)
      : null;
    const file = written?.file ?? new File([blob], resolved.filename, { type: resolved.mimeType || blob.type });
    const imported = await fileToTrack(file, resolved.filename);
    const trackId = `tidal_${resolved.track.id}`;
    const remoteArtwork = await resolveTidalArtworkForTrack(resolved.track).catch(() => undefined);
    const artworkSource = remoteArtwork || resolved.track.artworkUrl || imported.artwork;
    const artworkAsset = await fetchPersistableArtwork(artworkSource);
    if (options?.folderHandle && artworkAsset) {
      const baseFilename = resolved.filename.replace(/\.[^/.]+$/, '');
      await writeBlobToDownloadFolder(options.folderHandle, `${baseFilename}.${artworkAsset.extension}`, artworkAsset.blob)
        .catch(() => undefined);
    }
    const albumId = generateAlbumId(resolved.track.album, resolved.track.artist);
    const artworkKey = albumId || imported.artworkKey;
    if (artworkAsset && artworkKey) await saveArtworkBlob(artworkKey, artworkAsset.blob);
    const proxiedArtwork = artworkAsset ? undefined : await cacheRemoteArtwork(artworkKey, artworkSource);
    const artwork = artworkAsset && artworkKey
      ? URL.createObjectURL(artworkAsset.blob)
      : proxiedArtwork
        ?? await persistableArtworkUrl(artworkSource)
        ?? await persistableArtworkUrl(imported.artwork);
    return {
      ...imported,
      id: trackId,
      title: resolved.track.title,
      artist: resolved.track.artist,
      artistId: resolved.track.artistId ? String(resolved.track.artistId) : generateArtistId(resolved.track.artist),
      album: resolved.track.album,
      albumId,
      duration: imported.duration || resolved.track.durationMs,
      artwork,
      trackNumber: resolved.track.trackNumber,
      quality: resolved.track.quality,
      codec: resolved.track.codec || imported.codec,
      sampleRate: resolved.track.sampleRate ?? imported.sampleRate,
      bitDepth: resolved.track.bitDepth ?? imported.bitDepth,
      source: 'tidal',
      tidalId: resolved.track.id > 0 ? resolved.track.id : undefined,
      tidalAlbumId: resolved.track.albumId,
      fileHandle: written?.fileHandle,
      artworkKey,
      needsRelink: false,
    };
  },
};

export const soulseekDownloadProvider: DownloadProvider = {
  search: searchSoulseekBridge,
  async resolveStream(result) {
    throw new Error(`Soulseek web necesita descargar o usar el reproductor del bridge para "${result.title}".`);
  },
  async resolveDownload(result) {
    const resolved = await resolveSoulseekDownload(result);
    resolved.track = {
      ...resolved.track,
      match: result.raw as SoulseekMatch,
    } as TidalTrack & { match: SoulseekMatch };
    return resolved;
  },
  async download(resolved, options) {
    const bridgeFile = await resolveSoulseekBridgeFile(resolved);
    return monochromeDownloadProvider.download(bridgeFile, options);
  },
};
