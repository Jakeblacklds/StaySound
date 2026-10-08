/** Word-timed TTML from lrc.red, matched to the recording before display. */

const API = 'https://lrc.red';
const TIMEOUT_MS = 8_000;

interface LookupMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

interface SearchHit {
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

interface ParsedTtml<Line> {
  lines: Line[];
  songwriters?: string;
}

interface TtmlParser<Line> {
  parseTTML?: (ttml: string) => ParsedTtml<Line> | null;
}

export interface LrcRedSource<Line> {
  lines: Line[];
  source: 'lrc.red';
  songwriters?: string;
}

function normalize(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function baseTitle(value: string): string {
  return normalize(value.replace(/\s*[[(](?:feat\.?|ft\.?|featuring)\s+[^\])]*[\])]/gi, ''));
}

function hasVersionMarker(value: string): boolean {
  return /\b(?:live|acoustic|remix|instrumental|karaoke|sped up|slowed|cover)\b/i.test(value);
}

function matches(hit: SearchHit, metadata: LookupMetadata): boolean {
  if (!hit.isrc || !hit.title || !hit.artist) return false;
  if (baseTitle(hit.title) !== baseTitle(metadata.title)) return false;
  if (hasVersionMarker(hit.title) !== hasVersionMarker(metadata.title)) return false;

  const durationDifference = metadata.durationMs && Number.isFinite(hit.duration)
    ? Math.abs(metadata.durationMs / 1000 - (hit.duration as number))
    : null;
  if (durationDifference !== null && durationDifference > 12) return false;

  const artist = normalize(metadata.artist);
  const resultArtist = normalize(hit.artist);
  const artistMatches = resultArtist === artist
    || (artist.length >= 6 && resultArtist.includes(artist));
  if (artistMatches) return true;

  // Some catalog entries use a localized artist name (for example Julieta
  // Venegas in Chinese). Require a close duration, plus the album when known.
  const localizedArtist = !/[a-z]/i.test(hit.artist);
  const albumMatches = !metadata.album || normalize(hit.album ?? '') === normalize(metadata.album);
  return localizedArtist
    && albumMatches
    && durationDifference !== null
    && durationDifference <= (metadata.album ? 8 : 3);
}

async function get(url: URL): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTtml(isrc: string): Promise<string | null> {
  if (!/^[A-Z0-9]{12}$/i.test(isrc)) return null;
  const response = await get(new URL(`/s/${isrc.toUpperCase()}.ttml`, API));
  if (!response) return null;
  try {
    const ttml = await response.text();
    return /\btiming="Word"/.test(ttml) && /<span\s+begin=/.test(ttml) ? ttml : null;
  } catch {
    return null;
  }
}

export async function fetchLrcRedTtml(
  metadata: LookupMetadata,
  isrc: string | undefined,
): Promise<string | null> {
  if (isrc) {
    const direct = await fetchTtml(isrc);
    if (direct) return direct;
  }
  if (!metadata.title.trim() || !metadata.artist.trim()) return null;

  const url = new URL('/search.json', API);
  url.searchParams.set('q', `${metadata.title} ${metadata.artist}`);
  const response = await get(url);
  if (!response) return null;
  try {
    const data = await response.json() as { hits?: SearchHit[] };
    const hits = Array.isArray(data.hits) ? data.hits : [];
    for (const hit of hits.filter(candidate => matches(candidate, metadata)).slice(0, 3)) {
      const ttml = await fetchTtml(hit.isrc!);
      if (ttml) return ttml;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchLyricsFromLrcRed<Line>(
  metadata: LookupMetadata,
  isrc: string | undefined,
  parser: TtmlParser<Line>,
): Promise<LrcRedSource<Line> | null> {
  if (!parser.parseTTML) return null;
  const ttml = await fetchLrcRedTtml(metadata, isrc);
  if (!ttml) return null;
  try {
    const parsed = parser.parseTTML(ttml);
    const lines = parsed?.lines;
    if (!lines?.some(line => {
      const entry = line as { isWordSynced?: boolean; text?: unknown[] };
      return entry.isWordSynced && Array.isArray(entry.text) && entry.text.length > 1;
    })) return null;
    return { lines, source: 'lrc.red', songwriters: parsed?.songwriters };
  } catch {
    return null;
  }
}
