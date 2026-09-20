import type { Track } from '@staysound/types/audio';

type ArtworkSource = Pick<Track, 'title' | 'artist' | 'album' | 'artwork' | 'tidalId'> & {
  artworkUrl?: string;
  coverUuid?: string | null;
};

type TidalSearchTrack = {
  id?: number;
  title?: string;
  duration?: number;
  album?: { title?: string; cover?: string | null };
  artist?: { name?: string };
  artists?: Array<{ name?: string }>;
};

type TidalSearchResponse = {
  data?: {
    items?: TidalSearchTrack[];
    tracks?: { items?: TidalSearchTrack[] };
  };
};

const TIDAL_ARTWORK_API_BASES = [
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

function coverUuidToUrl(coverUuid?: string | null): string | undefined {
  if (!coverUuid || coverUuid === '00000000-0000-0000-0000-000000000000' || coverUuid === 'null') return undefined;
  if (coverUuid.startsWith('http')) return coverUuid;
  return `https://resources.tidal.com/images/${coverUuid.replace(/-/g, '/')}/750x750.jpg`;
}

function comparable(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreCandidate(source: ArtworkSource, candidate: TidalSearchTrack): number {
  const sourceTitle = comparable(source.title);
  const sourceArtist = comparable(source.artist);
  const sourceAlbum = comparable(source.album);
  const candidateTitle = comparable(candidate.title);
  const candidateArtist = comparable(candidate.artist?.name ?? candidate.artists?.[0]?.name);
  const candidateAlbum = comparable(candidate.album?.title);

  let score = 0;
  if (source.tidalId && candidate.id === source.tidalId) score += 500;
  if (sourceTitle && sourceTitle === candidateTitle) score += 140;
  if (sourceTitle && (candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle))) score += 55;
  if (sourceArtist && sourceArtist === candidateArtist) score += 120;
  if (sourceArtist && (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist))) score += 45;
  if (sourceAlbum && sourceAlbum === candidateAlbum) score += 45;
  if (candidate.album?.cover) score += 25;
  return score;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function resolveTidalArtworkForTrack(track: ArtworkSource): Promise<string | undefined> {
  if (track.artworkUrl?.trim()) return track.artworkUrl.trim();
  if (track.artwork?.startsWith('http') || track.artwork?.startsWith('data:')) return track.artwork;

  const directCover = coverUuidToUrl(track.coverUuid);
  if (directCover) return directCover;

  const query = `${track.artist ?? ''} ${track.title ?? ''}`.trim();
  if (!query) return undefined;

  for (const base of TIDAL_ARTWORK_API_BASES) {
    try {
      const payload = await fetchJson<TidalSearchResponse>(`${base}/search/?s=${encodeURIComponent(query)}`);
      const items = payload.data?.items ?? payload.data?.tracks?.items ?? [];
      const best = items
        .filter(item => item.album?.cover)
        .map(item => ({ item, score: scoreCandidate(track, item) }))
        .filter(item => item.score >= 120)
        .sort((left, right) => right.score - left.score)[0]?.item;
      const artwork = coverUuidToUrl(best?.album?.cover);
      if (artwork) return artwork;
    } catch {
      // Try the next public Monochrome/Tidal mirror.
    }
  }

  return undefined;
}
