import type { TidalTrack, Track } from '@staysound/types/audio';
import type { DownloadSearchResult } from '../downloads/downloadProvider';

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

const REQUEST_TIMEOUT_MS = 12000;

type TidalTrackApiResponse = {
  id?: number;
  title?: string;
  duration?: number;
  trackNumber?: number;
  isrc?: string;
  explicit?: boolean;
  audioQuality?: string;
  mediaMetadata?: { tags?: string[] };
  album?: {
    id?: number;
    title?: string;
    cover?: string | null;
    releaseDate?: string;
  };
  artist?: { id?: number; name?: string };
  artists?: Array<{ id?: number; name?: string }>;
  popularity?: number;
};

type TidalSearchResponse = {
  data?: {
    items?: TidalTrackApiResponse[];
    tracks?: { items?: TidalTrackApiResponse[] };
  };
  items?: TidalTrackApiResponse[];
};

type TidalRecommendationsResponse = {
  items?: Array<TidalTrackApiResponse | { track?: TidalTrackApiResponse }>;
  data?: { items?: Array<TidalTrackApiResponse | { track?: TidalTrackApiResponse }> };
};

export type TidalDiscoveryMood = {
  id: string;
  label: string;
  query: string;
  description: string;
};

export const TIDAL_DISCOVERY_MOODS: TidalDiscoveryMood[] = [
  { id: 'late-night', label: 'Noche', query: 'late night alternative r&b electronic', description: 'suave, profundo, con pulso' },
  { id: 'focus', label: 'Focus', query: 'ambient electronic focus instrumental', description: 'texturas limpias para concentrarte' },
  { id: 'drive', label: 'Drive', query: 'indie rock synth pop driving', description: 'ritmo para moverte' },
  { id: 'latin', label: 'Latino', query: 'latin pop reggaeton alternative urbano', description: 'calor, hooks y energía' },
  { id: 'discover', label: 'Nuevo', query: 'new music discovery indie pop electronic', description: 'hallazgos frescos y melódicos' },
];

function getArtworkUrl(coverUuid?: string | null): string | undefined {
  if (!coverUuid || coverUuid === '00000000-0000-0000-0000-000000000000' || coverUuid === 'null') return undefined;
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
    popularity: item.popularity,
  };
}

function unwrapTidalTrackItem(item: TidalTrackApiResponse | { track?: TidalTrackApiResponse }): TidalTrackApiResponse {
  return 'track' in item && item.track ? item.track : item;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchFromTidalMirrors<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (const base of TIDAL_API_BASES) {
    try {
      return await fetchJson<T>(`${base.replace(/\/+$/, '')}${path}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Todos los mirrors TIDAL fallaron.');
}

function uniqueTracks(tracks: TidalTrack[]): TidalTrack[] {
  const seen = new Set<number>();
  const unique: TidalTrack[] = [];
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    unique.push(track);
  }
  return unique;
}

export function tidalTrackToDownloadResult(track: TidalTrack): DownloadSearchResult {
  return {
    id: `tidal_discovery_${track.id}`,
    source: 'monochrome',
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artworkUrl,
    quality: track.quality,
    durationMs: track.durationMs,
    raw: track,
  };
}

export async function searchTidalTracks(query: string, limit = 24): Promise<TidalTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const payload = await fetchFromTidalMirrors<TidalSearchResponse>(`/search/?s=${encodeURIComponent(trimmed)}`);
  const items = payload.data?.items ?? payload.data?.tracks?.items ?? payload.items ?? [];
  return uniqueTracks(items.map(normalizeTidalTrack).filter(Boolean) as TidalTrack[]).slice(0, limit);
}

export async function getTidalRecommendations(trackId: number, limit = 24): Promise<TidalTrack[]> {
  const payload = await fetchFromTidalMirrors<TidalRecommendationsResponse>(`/recommendations/?id=${trackId}`);
  const items = payload.items ?? payload.data?.items ?? [];
  return uniqueTracks(items.map(unwrapTidalTrackItem).map(normalizeTidalTrack).filter(Boolean) as TidalTrack[]).slice(0, limit);
}

export async function findTidalSeedForTrack(track: Track): Promise<TidalTrack | null> {
  if (track.tidalId) {
    return {
      id: track.tidalId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumId: track.tidalAlbumId,
      durationMs: track.duration,
      quality: track.quality ?? 'LOSSLESS',
      isHiRes: track.quality === 'HI_RES_LOSSLESS',
      artworkUrl: track.artwork,
      isrc: track.isrc,
    };
  }
  const query = `${track.artist} ${track.title}`.trim();
  const matches = await searchTidalTracks(query, 5);
  return matches[0] ?? null;
}

export async function buildTidalRadio(seed: TidalTrack, limit = 36): Promise<TidalTrack[]> {
  const firstWave = await getTidalRecommendations(seed.id, Math.min(limit, 24));
  const secondarySeeds = firstWave.slice(0, 4);
  const secondaryWaves = await Promise.allSettled(
    secondarySeeds.map(track => getTidalRecommendations(track.id, 10)),
  );
  const secondary = secondaryWaves.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  return uniqueTracks([seed, ...firstWave, ...secondary]).slice(0, limit);
}
