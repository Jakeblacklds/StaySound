import Constants from "expo-constants";
import { TidalQuality, TidalTrack } from "../types/audio";

const DEFAULT_DEEZER_BASE_URL = "https://dzr.tabs-vs-spaces.wtf";
const REQUEST_TIMEOUT_MS = 12000;

type DeezerConfig = {
  baseUrl?: string;
  enabled?: boolean;
};

export type DeezerResolvedStream = {
  url: string;
  extension: "flac" | "mp3";
  codec: string;
  quality: string;
};

function readDeezerConfig(): DeezerConfig {
  const extra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
  return (extra.deezerFallback ?? {}) as DeezerConfig;
}

function getDeezerFormat(quality: TidalQuality): string {
  if (quality === "HI_RES_LOSSLESS" || quality === "LOSSLESS") return "FLAC";
  if (quality === "HIGH" || quality === "MP3") return "MP3_320";
  return "MP3_128";
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

export async function resolveDeezerStreamFromTrack(
  track: Pick<TidalTrack, "isrc">,
  quality: TidalQuality,
): Promise<DeezerResolvedStream | null> {
  const isrc = track.isrc?.trim();
  if (!isrc) return null;

  const config = readDeezerConfig();
  if (config.enabled === false) return null;

  const baseUrl = (config.baseUrl?.trim() || DEFAULT_DEEZER_BASE_URL).replace(/\/+$/, "");
  const format = getDeezerFormat(quality);
  const url = `${baseUrl}/stream/?isrc=${encodeURIComponent(isrc)}&format=${encodeURIComponent(format)}`;
  const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: "HEAD", signal });
    if (!response.ok && response.status !== 405 && response.status !== 501) {
      return null;
    }
  } catch (error) {
    console.warn("[DeezerFallback] Stream probe failed:", error);
    return null;
  } finally {
    cleanup();
  }

  return {
    url,
    extension: format === "FLAC" ? "flac" : "mp3",
    codec: format === "FLAC" ? "flac" : "mp3",
    quality: format === "FLAC" ? "LOSSLESS" : "HIGH",
  };
}
