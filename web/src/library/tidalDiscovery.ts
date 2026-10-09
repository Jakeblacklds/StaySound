import type { TidalTrack, Track } from '@staysound/types/audio';
import type { DownloadSearchResult } from '../downloads/downloadProvider';
import { isTauriDesktop, searchDesktopTidalCatalog } from '../desktop/tauriMusicLibrary';

const TIDAL_API_BASES = [
  'https://lol.samidy.workers.dev',
];

const REQUEST_TIMEOUT_MS = 12000;

export type TidalTrackApiResponse = {
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

export function getTidalArtworkUrl(coverUuid?: string | null): string | undefined {
  if (!coverUuid || coverUuid === '00000000-0000-0000-0000-000000000000' || coverUuid === 'null') return undefined;
  if (coverUuid.startsWith('http')) return coverUuid;
  // TIDAL currently serves several legacy sizes inconsistently: artist image
  // UUIDs return 403 at 640px in the desktop webview, while 750px is served
  // for both artist portraits and album covers.
  return `https://resources.tidal.com/images/${coverUuid.replace(/-/g, '/')}/750x750.jpg`;
}

export function normalizeTidalTrack(item: TidalTrackApiResponse): TidalTrack | null {
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
    artworkUrl: getTidalArtworkUrl(coverUuid),
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

export async function fetchFromTidalMirrors<T>(path: string): Promise<T> {
  // The public Monochrome worker is currently unavailable. Desktop sends
  // catalog searches through Tauri so the native HTTP client can call TIDAL
  // directly without the webview's CORS restriction.
  if (isTauriDesktop()) {
    const url = new URL(path, 'https://staysound.invalid');
    const mappings = [
      ['s', 'tracks'],
      ['a', 'artists'],
      ['al', 'albums'],
      ['p', 'playlists'],
    ] as const;
    const match = mappings.find(([parameter]) => url.searchParams.has(parameter));
    if (url.pathname === '/search/' && match) {
      const [parameter, kind] = match;
      const catalog = await searchDesktopTidalCatalog(kind, url.searchParams.get(parameter) ?? '');
      const items = catalog.items ?? [];
      if (kind === 'artists') return { data: { artists: { items } } } as T;
      if (kind === 'albums') return { data: { albums: { items } } } as T;
      if (kind === 'playlists') return { data: { playlists: { items } } } as T;
      return { data: { items } } as T;
    }
  }
  let lastError: unknown;
  // The currently maintained Monochrome worker can occasionally return a
  // transient Cloudflare 523. Retry the catalog once before surfacing a
  // failure or caching a partial search result.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const base of TIDAL_API_BASES) {
      try {
        return await fetchJson<T>(`${base.replace(/\/+$/, '')}${path}`);
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 180));
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

function normalizeCatalogText(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenCoverage(target: string, candidate: string): number {
  const targetTokens = new Set(normalizeCatalogText(target).split(' ').filter(Boolean));
  const candidateTokens = new Set(normalizeCatalogText(candidate).split(' ').filter(Boolean));
  if (targetTokens.size === 0 || candidateTokens.size === 0) return 0;
  let matches = 0;
  targetTokens.forEach(token => {
    if (candidateTokens.has(token)) matches += 1;
  });
  return matches / targetTokens.size;
}

function scoreSeedMatch(local: Track, candidate: TidalTrack): number {
  if (local.isrc && candidate.isrc && local.isrc === candidate.isrc) return 1000;
  const wantedTitle = normalizeCatalogText(local.title);
  const foundTitle = normalizeCatalogText(candidate.title);
  const titleCoverage = tokenCoverage(local.title, candidate.title);
  const artistCoverage = tokenCoverage(local.artist, candidate.artist);
  const albumCoverage = tokenCoverage(local.album, candidate.album);
  let score = titleCoverage * 70 + artistCoverage * 24 + albumCoverage * 12;
  if (wantedTitle && wantedTitle === foundTitle) score += 100;
  else if (wantedTitle && foundTitle && (wantedTitle.includes(foundTitle) || foundTitle.includes(wantedTitle))) score += 42;
  return score;
}

export type PersonalizedTidalMix = {
  seeds: TidalTrack[];
  tracks: TidalTrack[];
};

const personalizedMixCache = new Map<string, Promise<PersonalizedTidalMix>>();

function interleaveRecommendationWaves(waves: TidalTrack[][], limit: number): TidalTrack[] {
  const mixed: TidalTrack[] = [];
  const seen = new Set<number>();
  const artistCounts = new Map<string, number>();
  const maxLength = Math.max(0, ...waves.map(wave => wave.length));

  // Round-robin keeps the first seed from swallowing the whole feed. Cap each
  // artist during the first pass for the same reason Spotify-style mixes feel
  // varied even when several seeds belong to a similar scene.
  for (let rank = 0; rank < maxLength && mixed.length < limit; rank += 1) {
    for (let waveIndex = 0; waveIndex < waves.length && mixed.length < limit; waveIndex += 1) {
      const wave = waves[(waveIndex + rank) % waves.length];
      const track = wave[rank];
      if (!track || seen.has(track.id)) continue;
      const artistKey = track.artist.trim().toLowerCase();
      if ((artistCounts.get(artistKey) ?? 0) >= 3) continue;
      seen.add(track.id);
      artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
      mixed.push(track);
    }
  }

  // If the catalog is small, fill the remaining slots without the artist cap.
  for (const track of waves.flat()) {
    if (mixed.length >= limit) break;
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    mixed.push(track);
  }
  return mixed;
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
  // Local tags are not always clean (a track number sometimes lands in the
  // artist field), so title and album are part of the query and results are
  // ranked instead of trusting the API's first item blindly.
  const primaryQuery = `${track.title} ${track.artist} ${track.album}`.trim();
  let matches = await searchTidalTracks(primaryQuery, 12);
  let ranked = matches
    .map(candidate => ({ candidate, score: scoreSeedMatch(track, candidate) }))
    .sort((left, right) => right.score - left.score);

  if (!ranked[0] || ranked[0].score < 80) {
    const fallbackQuery = `${track.title} ${track.album}`.trim();
    const fallbackMatches = fallbackQuery === primaryQuery
      ? []
      : await searchTidalTracks(fallbackQuery, 12).catch(() => []);
    matches = uniqueTracks([...matches, ...fallbackMatches]);
    ranked = matches
      .map(candidate => ({ candidate, score: scoreSeedMatch(track, candidate) }))
      .sort((left, right) => right.score - left.score);
  }

  return ranked[0]?.score >= 60 ? ranked[0].candidate : null;
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

/**
 * Builds a diverse home mix from several local listening signals.
 *
 * Search identifies each local song in TIDAL, the recommendations endpoint
 * expands every successful match, and a round-robin pass blends the waves.
 * Artist-search fallbacks keep the home useful when a recommendations mirror
 * is temporarily incomplete.
 */
export async function buildPersonalizedTidalMix(
  localSeeds: Track[],
  limit = 24,
): Promise<PersonalizedTidalMix> {
  const distinctLocalSeeds = localSeeds.filter((track, index, source) => {
    const identity = `${track.artist}::${track.title}`.toLowerCase();
    return track.artist !== 'Unknown Artist' && source.findIndex(candidate => (
      `${candidate.artist}::${candidate.title}`.toLowerCase() === identity
    )) === index;
  }).slice(0, 4);

  const cacheKey = distinctLocalSeeds
    .map(track => `${track.tidalId ?? ''}:${track.artist}:${track.title}`.toLowerCase())
    .join('|');
  if (!cacheKey) return { seeds: [], tracks: [] };

  const cached = personalizedMixCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<PersonalizedTidalMix> => {
    const seedResults = await Promise.allSettled(distinctLocalSeeds.map(findTidalSeedForTrack));
    const seeds = uniqueTracks(seedResults.flatMap(result => (
      result.status === 'fulfilled' && result.value ? [result.value] : []
    )));
    if (seeds.length === 0) return { seeds: [], tracks: [] };

    const waveResults = await Promise.allSettled(seeds.map(async seed => {
      const recommendations = await getTidalRecommendations(seed.id, 18).catch(() => []);
      if (recommendations.length >= 6) return recommendations;
      const searchFallback = await searchTidalTracks(seed.artist, 12).catch(() => []);
      return uniqueTracks([...recommendations, ...searchFallback]);
    }));
    const waves = waveResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const seedIds = new Set(seeds.map(seed => seed.id));
    const tracks = interleaveRecommendationWaves(waves, limit)
      .filter(track => !seedIds.has(track.id));
    return { seeds, tracks };
  })();

  personalizedMixCache.set(cacheKey, request);
  if (personalizedMixCache.size > 16) {
    const oldestKey = personalizedMixCache.keys().next().value;
    if (oldestKey) personalizedMixCache.delete(oldestKey);
  }
  try {
    const result = await request;
    // Do not pin a temporary mirror failure in memory. The Home retry action
    // should always get a fresh chance when no useful recommendations arrived.
    if (result.tracks.length === 0) personalizedMixCache.delete(cacheKey);
    return result;
  } catch (error) {
    personalizedMixCache.delete(cacheKey);
    throw error;
  }
}
