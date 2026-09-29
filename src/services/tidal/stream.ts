/** Builds a playable stream track, with the alternate-provider fallbacks. */
import { useSettingsStore } from "../../stores/settingsStore";
import { TidalTrack, Track } from "../../types/audio";
import type { ParsedManifest } from "../../features/tidal/data/tidalApiTypes";
import { resolveAmazonMusicStreamFromTrack } from "../amazonMusicService";
import { resolveDeezerStreamFromTrack } from "../deezerFallbackService";
import { resolveQobuzStreamFromTrack } from "../qobuzKennyService";
import { resolveSaavnStreamFromTrack } from "../saavnFallbackService";
import { getExtensionFromMime, getPlayableUrl } from "./files";
import { getTidalTrackManifest } from "./manifest";

export async function createTidalStreamTrack(
  tidalTrack: TidalTrack,
  options: { qobuzFallback?: boolean; qobuzOnly?: boolean } = {},
): Promise<Track> {
  const stackPreview = new Error()
    .stack
    ?.split("\n")
    .slice(1, 6)
    .map(line => line.trim());
  console.log("[TidalService] createTidalStreamTrack called", {
    trackId: tidalTrack.id,
    title: tidalTrack.title,
    artist: tidalTrack.artist,
    stack: stackPreview,
  });

  const preferredQuality = useSettingsStore.getState().tidalDownloadQuality;
  const buildExternalStreamTrack = (
    streamInfo: {
      url: string;
      extension: "flac" | "m4a" | "mp3";
      codec: string;
      quality: string;
      sampleRate?: number;
      bitDepth?: number;
    },
  ): Track => {
    const formatMap: Record<string, string> = {
      flac: "FLAC",
      m4a: "AAC",
      mp3: "MP3",
    };

    return {
      id: `tidal_stream_${tidalTrack.id}`,
      uri: streamInfo.url,
      title: tidalTrack.title,
      artist: tidalTrack.artist,
      artistId: tidalTrack.artistId ? String(tidalTrack.artistId) : undefined,
      album: tidalTrack.album,
      duration: tidalTrack.durationMs,
      artwork: tidalTrack.artworkUrl,
      trackNumber: tidalTrack.trackNumber,
      year: tidalTrack.year,
      format: formatMap[streamInfo.extension] || "FLAC",
      codec: streamInfo.codec,
      sampleRate: streamInfo.sampleRate ?? tidalTrack.sampleRate,
      bitDepth: streamInfo.bitDepth ?? tidalTrack.bitDepth,
      quality: streamInfo.quality,
      source: "tidal_stream",
      tidalId: tidalTrack.id,
      tidalAlbumId: tidalTrack.albumId,
      dateAdded: Date.now(),
      cloudOnly: false,
    };
  };

  const tryExternalStreamFallbacks = async (): Promise<Track | null> => {
    try {
      const saavnStream = await resolveSaavnStreamFromTrack(
        {
          title: tidalTrack.title,
          artist: tidalTrack.artist,
          album: tidalTrack.album,
          durationMs: tidalTrack.durationMs,
        },
        preferredQuality,
      );
      if (saavnStream?.url) {
        console.log("[TidalService] Saavn stream resolved", {
          trackId: tidalTrack.id,
          quality: saavnStream.quality,
          extension: saavnStream.extension,
        });
        return buildExternalStreamTrack(saavnStream);
      }
    } catch (saavnError) {
      console.warn("[TidalService] Saavn stream failed:", saavnError);
    }

    try {
      const amazonStream = await resolveAmazonMusicStreamFromTrack(
        {
          title: tidalTrack.title,
          artist: tidalTrack.artist,
          album: tidalTrack.album,
          durationMs: tidalTrack.durationMs,
        },
        preferredQuality,
      );
      if (amazonStream?.url) {
        console.log("[TidalService] Amazon Music stream resolved", {
          trackId: tidalTrack.id,
          quality: amazonStream.quality,
          extension: amazonStream.extension,
        });
        return buildExternalStreamTrack(amazonStream);
      }
    } catch (amazonError) {
      console.warn("[TidalService] Amazon Music stream failed:", amazonError);
    }

    try {
      const deezerStream = await resolveDeezerStreamFromTrack(
        { isrc: tidalTrack.isrc },
        preferredQuality,
      );
      if (deezerStream?.url) {
        console.log("[TidalService] Deezer stream resolved", {
          trackId: tidalTrack.id,
          quality: deezerStream.quality,
          extension: deezerStream.extension,
        });
        return buildExternalStreamTrack(deezerStream);
      }
    } catch (deezerError) {
      console.warn("[TidalService] Deezer stream fallback failed:", deezerError);
    }

    try {
      const qobuzStream = await resolveQobuzStreamFromTrack(
        {
          title: tidalTrack.title,
          artist: tidalTrack.artist,
          album: tidalTrack.album,
          isrc: tidalTrack.isrc,
        },
        preferredQuality,
      );
      if (qobuzStream?.url) {
        console.log("[TidalService] Qobuz stream resolved", {
          trackId: tidalTrack.id,
          quality: qobuzStream.quality,
          extension: qobuzStream.extension,
        });
        return buildExternalStreamTrack(qobuzStream);
      }
    } catch (qobuzError) {
      console.warn("[TidalService] Qobuz stream fallback failed:", qobuzError);
    }

    return null;
  };

  if (options.qobuzOnly || options.qobuzFallback) {
    const fallbackStream = await tryExternalStreamFallbacks();
    if (fallbackStream) return fallbackStream;

    if (options.qobuzOnly) {
      throw new Error("No se pudo resolver stream externo para esta pista.");
    }
  }

  let manifest: ParsedManifest;
  try {
    try {
      manifest = await getTidalTrackManifest(tidalTrack.id, "HI_RES_LOSSLESS");
    } catch (error) {
      console.warn(
        "[TidalService] Stream HI_RES_LOSSLESS failed, retrying LOSSLESS",
        error,
      );
      manifest = await getTidalTrackManifest(tidalTrack.id, "LOSSLESS");
    }
  } catch (error) {
    const fallbackStream = await tryExternalStreamFallbacks();
    if (fallbackStream) return fallbackStream;
    throw error;
  }

  let streamUrl = getPlayableUrl(manifest);
  if (!streamUrl) {
    const fallbackManifest = await getTidalTrackManifest(
      tidalTrack.id,
      "LOSSLESS",
    );
    streamUrl = getPlayableUrl(fallbackManifest);
    manifest = fallbackManifest;
  }

  if (!streamUrl) {
    const fallbackStream = await tryExternalStreamFallbacks();
    if (fallbackStream) return fallbackStream;
    throw new Error("No direct stream URL available for this track");
  }

  const enrichedTrack: TidalTrack = {
    ...tidalTrack,
    quality: manifest.quality ?? tidalTrack.quality,
    codec: manifest.codecs ?? tidalTrack.codec,
    sampleRate: manifest.sampleRate ?? tidalTrack.sampleRate,
    bitDepth: manifest.bitDepth ?? tidalTrack.bitDepth,
  };

  const extension = getExtensionFromMime(manifest.mimeType, manifest.codecs);
  const formatMap: Record<string, string> = {
    flac: "FLAC",
    m4a: "AAC",
    mp3: "MP3",
  };

  return {
    id: `tidal_stream_${tidalTrack.id}`,
    uri: streamUrl,
    title: enrichedTrack.title,
    artist: enrichedTrack.artist,
    artistId: enrichedTrack.artistId
      ? String(enrichedTrack.artistId)
      : undefined,
    album: enrichedTrack.album,
    duration: enrichedTrack.durationMs,
    artwork: enrichedTrack.artworkUrl,
    trackNumber: enrichedTrack.trackNumber,
    year: enrichedTrack.year,
    format: formatMap[extension] || "FLAC",
    codec: enrichedTrack.codec ?? extension,
    sampleRate: enrichedTrack.sampleRate,
    bitDepth: enrichedTrack.bitDepth,
    quality: enrichedTrack.quality,
    source: "tidal_stream",
    tidalId: tidalTrack.id,
    tidalAlbumId: tidalTrack.albumId,
    dateAdded: Date.now(),
  };
}
