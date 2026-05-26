import { TidalQuality, TidalTrack } from "../types/audio";

const QOBUZ_API_BASES = [
  "https://qdl-api.monochrome.tf",
  "https://trypt-hifi-dl-456461932686.us-west1.run.app",
  "https://qobuz.kennyy.com.br",
  "https://mono.scavengerfurs.net",
];
const REQUEST_TIMEOUT_MS = 8000;

type QobuzTrackItem = {
  id?: number;
  title?: string;
  version?: string | null;
  isrc?: string;
  duration?: number;
  track_number?: number;
  parental_warning?: boolean;
  maximum_sampling_rate?: number;
  maximum_bit_depth?: number;
  hires?: boolean;
  performer?: {
    id?: number;
    name?: string;
  };
  album?: {
    title?: string;
    id?: string | number;
    image?: {
      large?: string;
      small?: string;
      thumbnail?: string;
    };
    release_date_original?: string;
    tracks_count?: number;
  };
};

type QobuzSearchResponse = {
  success?: boolean;
  data?: {
    tracks?: {
      items?: QobuzTrackItem[];
    };
  };
};

type QobuzDownloadResponse = {
  success?: boolean;
  data?: {
    url?: string;
  };
};

export type QobuzResolvedStream = {
  url: string;
  extension: "flac" | "m4a" | "mp3";
  codec: string;
  quality: string;
  sampleRate?: number;
  bitDepth?: number;
  isHiRes: boolean;
};

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

async function fetchQobuzJson<T>(baseUrl: string, path: string): Promise<T> {
  const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, { signal });
    const body = await response.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Qobuz endpoint returned invalid JSON (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(`Qobuz endpoint failed (${response.status})`);
    }
    return parsed as T;
  } finally {
    cleanup();
  }
}

async function fetchQobuzJsonFromAnyBase<T>(path: string): Promise<T> {
  let lastError: unknown = null;

  for (const baseUrl of QOBUZ_API_BASES) {
    try {
      return await fetchQobuzJson<T>(baseUrl, path);
    } catch (error) {
      lastError = error;
      console.warn(`[QobuzKennyService] ${baseUrl} failed for ${path}:`, error);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Qobuz endpoints failed");
}

function parseYear(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeQobuzTrack(item: QobuzTrackItem): TidalTrack {
  const artistName = item.performer?.name?.trim() || "Unknown Artist";
  const albumTitle = item.album?.title?.trim() || "Unknown Album";
  const versionSuffix = item.version?.trim() ? ` (${item.version.trim()})` : "";
  const maximumSamplingRateKhz = item.maximum_sampling_rate;
  const sampleRate =
    typeof maximumSamplingRateKhz === "number"
      ? Math.round(maximumSamplingRateKhz * 1000)
      : undefined;
  const bitDepth =
    typeof item.maximum_bit_depth === "number"
      ? item.maximum_bit_depth
      : undefined;
  const isHiRes = Boolean(item.hires) || (bitDepth ?? 0) > 16;

  return {
    id: Number(item.id ?? 0),
    title: `${item.title ?? "Unknown Track"}${versionSuffix}`,
    artist: artistName,
    artistId: item.performer?.id,
    album: albumTitle,
    albumId:
      item.album?.id !== undefined
        ? Number.parseInt(String(item.album.id), 10) || undefined
        : undefined,
    durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
    quality: isHiRes ? "HI_RES_LOSSLESS" : "LOSSLESS",
    isHiRes,
    coverUuid: String(item.album?.id ?? ""),
    artworkUrl:
      item.album?.image?.large ||
      item.album?.image?.small ||
      item.album?.image?.thumbnail,
    trackNumber:
      typeof item.track_number === "number" ? item.track_number : undefined,
    year: parseYear(item.album?.release_date_original),
    explicit: Boolean(item.parental_warning),
    sampleRate,
    bitDepth,
    codec: bitDepth && bitDepth > 16 ? "flac" : "flac",
    isrc: item.isrc,
  };
}

function scoreCandidate(baseTrack: Pick<TidalTrack, "title" | "artist" | "album" | "isrc">, candidate: TidalTrack): number {
  if (baseTrack.isrc && candidate.isrc && baseTrack.isrc.toLowerCase() === candidate.isrc.toLowerCase()) {
    return 1000;
  }

  const titleA = baseTrack.title.toLowerCase().trim();
  const titleB = candidate.title.toLowerCase().trim();
  const artistA = baseTrack.artist.toLowerCase().trim();
  const artistB = candidate.artist.toLowerCase().trim();
  const albumA = baseTrack.album.toLowerCase().trim();
  const albumB = candidate.album.toLowerCase().trim();

  let score = 0;
  if (titleA === titleB) score += 140;
  if (titleB.includes(titleA) || titleA.includes(titleB)) score += 70;
  if (artistA === artistB) score += 120;
  if (artistB.includes(artistA) || artistA.includes(artistB)) score += 60;
  if (albumA === albumB) score += 45;
  if (albumB.includes(albumA) || albumA.includes(albumB)) score += 20;
  if (candidate.isHiRes) score += 8;
  return score;
}

function qualityToQobuzCode(quality: TidalQuality): "5" | "6" | "7" | "27" {
  if (quality === "LOW" || quality === "MP3" || quality === "HIGH") return "5";
  if (quality === "HI_RES_LOSSLESS") return "27";
  return "6";
}

function extensionFromQobuzFormat(formatCode: string): "flac" | "m4a" | "mp3" {
  if (formatCode === "5") return "mp3";
  return "flac";
}

function isQobuzFormatCode(value: string): value is "5" | "6" | "7" | "27" {
  return value === "5" || value === "6" || value === "7" || value === "27";
}

export async function searchQobuzTracks(query: string): Promise<TidalTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const path = `/api/get-music?q=${encodeURIComponent(trimmed)}&offset=0`;
  const payload = await fetchQobuzJsonFromAnyBase<QobuzSearchResponse>(path);
  if (!payload.success) return [];
  const items = payload.data?.tracks?.items ?? [];
  return items
    .map(normalizeQobuzTrack)
    .filter((item) => Number.isFinite(item.id) && item.id > 0);
}

export async function resolveQobuzStreamFromTrack(
  track: Pick<TidalTrack, "title" | "artist" | "album" | "isrc">,
  quality: TidalQuality,
): Promise<QobuzResolvedStream | null> {
  const query = track.isrc?.trim() || `${track.artist} ${track.title}`.trim();
  const candidates = await searchQobuzTracks(query);
  if (!candidates.length) return null;

  const best = [...candidates]
    .map((candidate) => ({ candidate, score: scoreCandidate(track, candidate) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
  if (!best) return null;

  const requestedCode = qualityToQobuzCode(quality);
  const path = `/api/download-music?track_id=${best.id}&quality=${requestedCode}`;
  const payload = await fetchQobuzJsonFromAnyBase<QobuzDownloadResponse>(path);
  const finalUrl = payload.data?.url?.trim();
  if (!payload.success || !finalUrl) return null;

  let finalFormatCode = requestedCode;
  try {
    const parsed = new URL(finalUrl);
    const fmt = parsed.searchParams.get("fmt");
    if (fmt && isQobuzFormatCode(fmt)) {
      finalFormatCode = fmt;
    }
  } catch {
    // Keep requested code when URL parsing fails.
  }

  const extension = extensionFromQobuzFormat(finalFormatCode);
  const codec =
    extension === "mp3" ? "mp3" : extension === "m4a" ? "aac" : "flac";
  const deliveredQuality =
    finalFormatCode === "27"
      ? "HI_RES_LOSSLESS"
      : finalFormatCode === "7"
        ? "LOSSLESS"
        : finalFormatCode === "6"
          ? "HIGH"
          : "LOW";

  return {
    url: finalUrl,
    extension,
    codec,
    quality: deliveredQuality,
    sampleRate: best.sampleRate,
    bitDepth: best.bitDepth,
    isHiRes: deliveredQuality === "HI_RES_LOSSLESS",
  };
}
