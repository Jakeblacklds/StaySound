import { TidalQuality, TidalTrack } from "../types/audio";

declare const process: {
  env: Record<string, string | undefined>;
};

const AMAZON_API_BASE_URL = "https://amz.geeked.wtf";
const AMAZON_CONVERTER_BASE_URL = "https://t2a.geeked.wtf";
const REQUEST_TIMEOUT_MS = 12000;

type AmazonSearchItem = {
  id?: string;
  title?: string;
  duration?: number;
  album?: {
    name?: string;
  };
  artist?: {
    name?: string;
  };
};

type AmazonSearchResponse = {
  success?: boolean;
  data?: AmazonSearchItem[];
};

type AmazonQualityInfo = {
  quality?: string;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
};

type AmazonTrackResponse = {
  stream_url?: string;
  quality_selected?: string;
  quality_requested?: string;
  available_qualities?: AmazonQualityInfo[];
  decryption_key?: string;
  decryptionKey?: string;
  decryption?: {
    key?: string;
  };
  drm?: {
    decryption_key?: string;
    decryptionKey?: string;
  };
};

export type AmazonMusicResolvedStream = {
  url: string;
  extension: "flac" | "m4a" | "mp3";
  codec: string;
  quality: string;
  sampleRate?: number;
  bitDepth?: number;
};

function getBypassToken(): string {
  return process.env.EXPO_PUBLIC_AMAZON_MUSIC_BYPASS_TOKEN?.trim() ?? "";
}

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

async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const { signal, cleanup } = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    const body = await response.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Amazon Music endpoint returned invalid JSON (${response.status})`);
    }

    if (!response.ok) {
      const detail = (parsed as { detail?: { error?: string; message?: string } }).detail;
      const message = detail?.message || detail?.error || `Amazon Music endpoint failed (${response.status})`;
      throw new Error(message);
    }

    return parsed as T;
  } finally {
    cleanup();
  }
}

function amazonQualityFromTidal(quality: TidalQuality): string {
  if (quality === "HI_RES_LOSSLESS") return "UHD";
  if (quality === "LOSSLESS") return "HD";
  if (quality === "HIGH" || quality === "MP3") return "SD_HIGH";
  return "SD_LOW";
}

function normalizeSearchText(value: string | undefined): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(explicit|clean|remaster(?:ed)?|deluxe|bonus track|radio edit)\b/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scoreText(expected: string | undefined, actual: string | undefined, weight: number): number {
  const left = normalizeSearchText(expected);
  const right = normalizeSearchText(actual);
  if (!left || !right) return 0;
  if (left === right) return weight;
  if (right.includes(left) || left.includes(right)) return weight * 0.78;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return weight * (overlap / Math.max(leftTokens.size, rightTokens.size));
}

function scoreDuration(expectedMs: number, actualSeconds: number | undefined): number {
  if (!Number.isFinite(expectedMs) || expectedMs <= 0 || !Number.isFinite(actualSeconds) || !actualSeconds) {
    return 0;
  }
  const diff = Math.abs(expectedMs / 1000 - actualSeconds);
  if (diff <= 2) return 15;
  if (diff <= 5) return 12;
  if (diff <= 10) return 8;
  if (diff <= 20) return 4;
  return 0;
}

function scoreCandidate(track: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">, candidate: AmazonSearchItem): number {
  return (
    scoreText(track.title, candidate.title, 45) +
    scoreText(track.artist, candidate.artist?.name, 25) +
    scoreText(track.album, candidate.album?.name, 15) +
    scoreDuration(track.durationMs, candidate.duration)
  );
}

function selectBestCandidate(
  track: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">,
  candidates: AmazonSearchItem[],
): AmazonSearchItem | null {
  const ranked = candidates
    .filter((candidate) => candidate.id)
    .map((candidate) => ({ candidate, score: scoreCandidate(track, candidate) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  return best && best.score >= 62 ? best.candidate : null;
}

function selectedQualityInfo(payload: AmazonTrackResponse): AmazonQualityInfo | null {
  if (!Array.isArray(payload.available_qualities)) return null;
  return payload.available_qualities.find((item) => item.quality === payload.quality_selected) ?? null;
}

function extensionFromAmazonQuality(info: AmazonQualityInfo | null): "flac" | "m4a" | "mp3" {
  const codec = String(info?.codec || "").toLowerCase();
  if (codec === "flac") return "flac";
  if (codec.includes("mp3")) return "mp3";
  return "m4a";
}

function codecFromAmazonQuality(info: AmazonQualityInfo | null): string {
  const codec = String(info?.codec || "").toLowerCase();
  if (codec === "flac") return "flac";
  if (codec === "opus") return "opus";
  if (codec.includes("mp3")) return "mp3";
  return "aac";
}

function qualityLabel(payload: AmazonTrackResponse): string {
  const quality = String(payload.quality_selected || payload.quality_requested || "").trim();
  if (!quality) return "AMAZON";
  return quality.startsWith("UHD") ? "HI_RES_LOSSLESS" : quality.startsWith("HD") ? "LOSSLESS" : "HIGH";
}

function hasCencDecryptionKey(payload: AmazonTrackResponse): boolean {
  return Boolean(
    payload.decryption_key ||
      payload.decryptionKey ||
      payload.decryption?.key ||
      payload.drm?.decryption_key ||
      payload.drm?.decryptionKey,
  );
}

export async function resolveAmazonMusicStreamFromTrack(
  track: Pick<TidalTrack, "title" | "artist" | "album" | "durationMs">,
  quality: TidalQuality,
): Promise<AmazonMusicResolvedStream | null> {
  const bypassToken = getBypassToken();
  if (!bypassToken) return null;

  const query = `${track.title} ${track.artist}`.trim();
  if (!query) return null;

  const searchUrl = `${AMAZON_CONVERTER_BASE_URL}/api/search/songs?query=${encodeURIComponent(query)}`;
  const searchPayload = await fetchJson<AmazonSearchResponse>(searchUrl, {}, 8000);
  const best = selectBestCandidate(track, searchPayload.data ?? []);
  if (!searchPayload.success || !best?.id) return null;

  const params = new URLSearchParams({
    quality: amazonQualityFromTidal(quality),
    bypass_token: bypassToken,
  });
  const trackUrl = `${AMAZON_API_BASE_URL}/api/track/${encodeURIComponent(best.id)}?${params.toString()}`;
  const trackPayload = await fetchJson<AmazonTrackResponse>(trackUrl, {}, 15000);
  const finalUrl = trackPayload.stream_url?.trim();
  if (!finalUrl) return null;
  if (hasCencDecryptionKey(trackPayload)) return null;

  const qualityInfo = selectedQualityInfo(trackPayload);
  const extension = extensionFromAmazonQuality(qualityInfo);
  return {
    url: finalUrl,
    extension,
    codec: codecFromAmazonQuality(qualityInfo),
    quality: qualityLabel(trackPayload),
    sampleRate: qualityInfo?.sampleRate,
    bitDepth: qualityInfo?.bitDepth,
  };
}
