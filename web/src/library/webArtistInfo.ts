export interface WebArtistInfo {
  name: string;
  photoUrl?: string;
  biography?: string;
  source?: 'tidal' | 'deezer' | 'wikipedia';
  tidalId?: number;
  deezerId?: number;
}

const CACHE_KEY = 'staysound.web.artist.info.v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8500;

const TIDAL_API_BASES = [
  'https://eu-central.monochrome.tf',
  'https://api.monochrome.tf',
  'https://us-west.monochrome.tf',
  'https://monochrome-api.samidy.com',
  'https://hifi.geeked.wtf',
  'https://arran.monochrome.tf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://tidal.kinoplus.online',
];

type CachedArtistInfo = WebArtistInfo & { timestamp: number };

type TidalArtistSearchResponse = {
  data?: {
    artists?: {
      items?: TidalArtistItem[];
    };
    items?: TidalArtistItem[];
  };
};

type TidalArtistItem = {
  id?: number;
  name?: string;
  picture?: string | null;
  popularity?: number;
};

type DeezerArtistItem = {
  id?: number;
  name?: string;
  picture?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_fan?: number;
};

type DeezerSearchResponse = {
  data?: DeezerArtistItem[];
};

type WikipediaSummary = {
  extract?: string;
  type?: string;
};

const memoryCache = new Map<string, CachedArtistInfo>();
const inflight = new Map<string, Promise<WebArtistInfo | null>>();

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sanitizeArtistName(value: string): string {
  return value
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s*\((remaster(?:ed)?|deluxe|explicit|mono|stereo|live).*?\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCachedMap(): Record<string, CachedArtistInfo> {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}') as Record<string, CachedArtistInfo>;
  } catch {
    return {};
  }
}

function readCache(key: string): CachedArtistInfo | null {
  const memory = memoryCache.get(key);
  if (memory && Date.now() - memory.timestamp < CACHE_TTL_MS) return memory;
  const cached = getCachedMap()[key];
  if (!cached || Date.now() - cached.timestamp >= CACHE_TTL_MS) return null;
  memoryCache.set(key, cached);
  return cached;
}

function writeCache(key: string, value: WebArtistInfo): void {
  const entry = { ...value, timestamp: Date.now() };
  memoryCache.set(key, entry);
  try {
    const cache = getCachedMap();
    cache[key] = entry;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private mode or quota errors should not block the artist page.
  }
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => window.clearTimeout(timeout),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json() as T;
  } finally {
    cleanup();
  }
}

async function fetchFromTidalMirrors<T>(path: string): Promise<T | null> {
  for (const base of TIDAL_API_BASES) {
    try {
      return await fetchJson<T>(`${base}${path}`);
    } catch {
      // Try the next mirror.
    }
  }
  return null;
}

function tidalArtworkUrl(picture?: string | null): string | undefined {
  if (!picture || picture === '00000000-0000-0000-0000-000000000000' || picture === 'null') return undefined;
  if (picture.startsWith('http')) return picture;
  return `https://resources.tidal.com/images/${picture.replace(/-/g, '/')}/750x750.jpg`;
}

function pickBestByName<T extends { name?: string; popularity?: number; nb_fan?: number }>(
  name: string,
  items: T[] = [],
): T | undefined {
  const target = normalizeName(name);
  return [...items].sort((a, b) => {
    const aName = normalizeName(a.name ?? '');
    const bName = normalizeName(b.name ?? '');
    const aExact = aName === target ? 2 : aName.includes(target) || target.includes(aName) ? 1 : 0;
    const bExact = bName === target ? 2 : bName.includes(target) || target.includes(bName) ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (b.popularity ?? b.nb_fan ?? 0) - (a.popularity ?? a.nb_fan ?? 0);
  })[0];
}

async function fetchTidalArtist(name: string): Promise<WebArtistInfo | null> {
  const payload = await fetchFromTidalMirrors<TidalArtistSearchResponse>(`/search/?a=${encodeURIComponent(name)}`);
  const item = pickBestByName(name, payload?.data?.artists?.items ?? payload?.data?.items ?? []);
  if (!item?.name) return null;
  return {
    name: item.name,
    photoUrl: tidalArtworkUrl(item.picture),
    source: 'tidal',
    tidalId: item.id,
  };
}

async function fetchDeezerArtist(name: string): Promise<WebArtistInfo | null> {
  const payload = await fetchJson<DeezerSearchResponse>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}`,
  );
  const item = pickBestByName(name, payload.data ?? []);
  const photoUrl = item?.picture_xl || item?.picture_big || item?.picture_medium || item?.picture;
  if (!item?.name && !photoUrl) return null;
  return {
    name: item?.name ?? name,
    photoUrl,
    source: 'deezer',
    deezerId: item?.id,
  };
}

async function fetchWikipediaBiography(name: string): Promise<string | undefined> {
  async function tryLanguage(lang: 'es' | 'en'): Promise<string | undefined> {
    try {
      const direct = await fetchJson<WikipediaSummary>(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, '_'))}`,
      );
      if (direct.extract && direct.type !== 'disambiguation') return direct.extract;
    } catch {
      // Try search below.
    }

    try {
      const search = await fetchJson<unknown[]>(
        `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&format=json&origin=*`,
      );
      const title = Array.isArray(search?.[1]) ? (search[1] as string[])[0] : undefined;
      if (!title) return undefined;
      const summary = await fetchJson<WikipediaSummary>(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      );
      if (summary.extract && summary.type !== 'disambiguation') return summary.extract;
    } catch {
      return undefined;
    }
    return undefined;
  }

  return (await tryLanguage('es')) ?? (await tryLanguage('en'));
}

export async function getWebArtistInfo(artistName: string): Promise<WebArtistInfo | null> {
  const cleanName = sanitizeArtistName(artistName);
  if (!cleanName || cleanName === 'Unknown Artist') return null;
  const key = normalizeName(cleanName);
  const cached = readCache(key);
  if (cached) return cached;
  const active = inflight.get(key);
  if (active) return active;

  const request = (async () => {
    const [tidal, deezer, biography] = await Promise.allSettled([
      fetchTidalArtist(cleanName),
      fetchDeezerArtist(cleanName),
      fetchWikipediaBiography(cleanName),
    ]);

    const tidalInfo = tidal.status === 'fulfilled' ? tidal.value : null;
    const deezerInfo = deezer.status === 'fulfilled' ? deezer.value : null;
    const bio = biography.status === 'fulfilled' ? biography.value : undefined;
    const info: WebArtistInfo = {
      name: tidalInfo?.name || deezerInfo?.name || cleanName,
      photoUrl: tidalInfo?.photoUrl || deezerInfo?.photoUrl,
      biography: bio,
      source: tidalInfo?.photoUrl ? 'tidal' : deezerInfo?.photoUrl ? 'deezer' : bio ? 'wikipedia' : undefined,
      tidalId: tidalInfo?.tidalId,
      deezerId: deezerInfo?.deezerId,
    };

    if (!info.photoUrl && !info.biography) return null;
    writeCache(key, info);
    return info;
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}
