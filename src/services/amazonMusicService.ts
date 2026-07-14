import Constants from "expo-constants";
import { TidalQuality, TidalTrack } from "../types/audio";

declare const process: {
  env: Record<string, string | undefined>;
};

const AMAZON_API_BASE_URL = "https://amz.geeked.wtf";
const REQUEST_TIMEOUT_MS = 12000;

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

type AmazonTrackApiEnvelope =
  | AmazonTrackResponse
  | {
      data?: AmazonTrackResponse;
      track?: AmazonTrackResponse;
      result?: AmazonTrackResponse;
    };

export type AmazonMusicResolvedStream = {
  url: string;
  extension: "flac" | "m4a" | "mp3";
  codec: string;
  quality: string;
  sampleRate?: number;
  bitDepth?: number;
};

function readAmazonConfig(): Record<string, any> {
  const extra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
  return (extra.amazonMusic ?? {}) as Record<string, any>;
}

function getBypassToken(): string {
  const extraToken = readAmazonConfig().bypassToken;
  const extraJwt = readAmazonConfig().turnstileJwt;
  return (
    process.env.EXPO_PUBLIC_AMAZON_TURNSTILE_JWT?.trim() ||
    process.env.EXPO_PUBLIC_AMAZON_MUSIC_BYPASS_TOKEN?.trim() ||
    (typeof extraJwt === "string" ? extraJwt.trim() : "") ||
    (typeof extraToken === "string" ? extraToken.trim() : "")
  );
}

function getAmazonApiBaseUrl(): string {
  const extraBaseUrl = readAmazonConfig().baseUrl;
  return (
    process.env.EXPO_PUBLIC_AMAZON_MUSIC_BASE_URL?.trim() ||
    (typeof extraBaseUrl === "string" ? extraBaseUrl.trim() : "") ||
    AMAZON_API_BASE_URL
  ).replace(/\/+$/, "");
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

function selectedQualityInfo(payload: AmazonTrackResponse): AmazonQualityInfo | null {
  if (!Array.isArray(payload.available_qualities)) return null;
  return payload.available_qualities.find((item) => item.quality === payload.quality_selected) ?? null;
}

function unwrapAmazonTrackPayload(payload: AmazonTrackApiEnvelope): AmazonTrackResponse {
  if ("stream_url" in payload && payload.stream_url) return payload;
  if ("data" in payload && payload.data?.stream_url) return payload.data;
  if ("track" in payload && payload.track?.stream_url) return payload.track;
  if ("result" in payload && payload.result?.stream_url) return payload.result;
  return payload as AmazonTrackResponse;
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
  const manualJwt = bypassToken.split(".").length === 3 ? bypassToken : "";

  const params = new URLSearchParams({
    track: track.title,
    artist: track.artist,
    album: track.album,
    duration: String(Math.round(track.durationMs / 1000)),
    quality: amazonQualityFromTidal(quality),
  });
  if (bypassToken && !manualJwt) {
    params.set("bypass_token", bypassToken);
  }
  const trackUrl = `${getAmazonApiBaseUrl()}/api/track/?${params.toString()}`;
  const trackPayload = unwrapAmazonTrackPayload(
    await fetchJson<AmazonTrackApiEnvelope>(
      trackUrl,
      manualJwt ? { headers: { "X-Turnstile-JWT": manualJwt } } : {},
      15000,
    ),
  );
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
