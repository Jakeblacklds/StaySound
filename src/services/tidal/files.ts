/** Pure download and playback helpers: file names, extensions and library tracks. */
import { TidalQuality, TidalTrack, Track } from "../../types/audio";
import type { ParsedManifest } from "../../features/tidal/data/tidalApiTypes";
import { sanitizeFilename as utilsSanitizeFilename } from "../audioUtils";

export function sanitizeFilename(input: string): string {
  return utilsSanitizeFilename(input);
}

export function getTrackBaseFilename(
  track: Pick<TidalTrack, "id" | "title" | "artist" | "album">,
): string {
  const sanitized = sanitizeFilename(
    `${track.artist} - ${track.album} - ${track.title}`,
  );
  if (sanitized.length > 0) return sanitized;
  return `tidal_${track.id}`;
}

export function getExtensionFromMime(mimeType?: string, codecs?: string): string {
  const m = (mimeType ?? "").toLowerCase();
  const c = (codecs ?? "").toLowerCase();
  if (m.includes("flac") || c.includes("flac")) return "flac";
  if (
    m.includes("mp4") ||
    m.includes("aac") ||
    m.includes("m4a") ||
    c.includes("mp4") ||
    c.includes("aac")
  )
    return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "flac"; // fallback
}

function getExtensionFromUrl(url?: string | null): string | null {
  if (!url) return null;

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".flac")) return "flac";
    if (pathname.endsWith(".m4a") || pathname.endsWith(".mp4")) return "m4a";
    if (pathname.endsWith(".mp3")) return "mp3";
  } catch {
    const normalized = String(url).toLowerCase();
    if (normalized.includes(".flac")) return "flac";
    if (normalized.includes(".m4a") || normalized.includes(".mp4")) return "m4a";
    if (normalized.includes(".mp3")) return "mp3";
  }

  return null;
}

export function resolveDownloadExtension(
  manifest: ParsedManifest,
  sourceUrl?: string | null,
): "flac" | "m4a" | "mp3" {
  if (manifest.isSegmented && (manifest.mimeType ?? "").toLowerCase().includes("mp4")) {
    return "m4a";
  }

  if (sourceUrl && isFlacSource(sourceUrl, manifest)) {
    return "flac";
  }

  const urlBasedExtension = getExtensionFromUrl(sourceUrl ?? manifest.manifestUrl);
  if (urlBasedExtension === "flac" || urlBasedExtension === "m4a" || urlBasedExtension === "mp3") {
    return urlBasedExtension;
  }

  const mimeBasedExtension = getExtensionFromMime(manifest.mimeType, manifest.codecs);
  if (mimeBasedExtension === "flac" || mimeBasedExtension === "m4a" || mimeBasedExtension === "mp3") {
    return mimeBasedExtension;
  }

  return "m4a";
}

export function requiresFlacDownload(targetQuality: TidalQuality): boolean {
  return targetQuality === "LOSSLESS" || targetQuality === "HI_RES_LOSSLESS";
}

export function getSafEntityName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const lastSlash = decoded.lastIndexOf("/");
  const lastSegment = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  const colonIndex = lastSegment.lastIndexOf(":");
  const withoutProvider =
    colonIndex >= 0 ? lastSegment.slice(colonIndex + 1) : lastSegment;
  const pathParts = withoutProvider.split("/").filter(Boolean);
  return pathParts[pathParts.length - 1] ?? withoutProvider;
}

function isFlacSource(url: string, manifest: ParsedManifest): boolean {
  if (/\.flac(\?|$)/i.test(url)) return true;
  if ((manifest.mimeType ?? "").toLowerCase().includes("flac")) return true;
  if ((manifest.codecs ?? "").toLowerCase().includes("flac")) return true;
  return false;
}

export function getDirectUrl(manifest: ParsedManifest): string | null {
  const directUrls = manifest.urls.filter((url) => /^https?:\/\//i.test(url));
  if (manifest.isSegmented || directUrls.length !== 1) {
    return null;
  }
  return directUrls[0];
}

export function getPlayableUrl(manifest: ParsedManifest): string | null {
  const directUrl = getDirectUrl(manifest);
  if (directUrl) {
    return directUrl;
  }

  if (manifest.manifestUrl && /^https?:\/\//i.test(manifest.manifestUrl)) {
    return manifest.manifestUrl;
  }

  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length),
    );
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

export function toLibraryTrack(tidalTrack: TidalTrack, uri: string): Track {
  const extension = uri.split(".").pop()?.toLowerCase() || "flac";
  const formatMap: Record<string, string> = {
    flac: "FLAC",
    m4a: "AAC",
    mp3: "MP3",
  };

  return {
    id: `tidal_${tidalTrack.id}`,
    uri,
    title: tidalTrack.title,
    artist: tidalTrack.artist,
    album: tidalTrack.album,
    duration: tidalTrack.durationMs,
    artwork: tidalTrack.artworkUrl,
    trackNumber: tidalTrack.trackNumber,
    year: tidalTrack.year,
    format: formatMap[extension] || "FLAC",
    codec: tidalTrack.codec ?? extension,
    sampleRate: tidalTrack.sampleRate,
    bitDepth: tidalTrack.bitDepth,
    quality: tidalTrack.quality,
    source: "tidal",
    tidalId: tidalTrack.id,
    tidalAlbumId: tidalTrack.albumId,
    dateAdded: Date.now(),
  };
}
