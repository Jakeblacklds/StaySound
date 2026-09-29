/** Downloads a track (direct file or DASH segments) into the library. */
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { TidalQuality, TidalTrack, Track } from "../../types/audio";
import { isValidAudioFile } from "../../features/tidal/data/audioFileValidation";
import type { DownloadOptions, ParsedManifest } from "../../features/tidal/data/tidalApiTypes";
import { resolveAmazonMusicStreamFromTrack } from "../amazonMusicService";
import { resolveDeezerStreamFromTrack } from "../deezerFallbackService";
import { resolveQobuzStreamFromTrack } from "../qobuzKennyService";
import { resolveSaavnStreamFromTrack } from "../saavnFallbackService";
import { getDirectUrl, getTrackBaseFilename, requiresFlacDownload, resolveDownloadExtension, toLibraryTrack } from "./files";
import { getTidalTrackManifest } from "./manifest";
import { TIDAL_TEMP_DOWNLOADS_DIR, downloadDashSegmentsToFile, downloadSegment, ensureDirectoryExists, findExistingPublicTrackUri, getOutputUri, persistArtworkInPublicDownloads, persistInPrivateDownloads, persistInPublicDownloads, persistMetadataInPublicDownloads } from "./storage";

export async function downloadTidalTrack(
  tidalTrack: TidalTrack,
  targetQuality: TidalQuality = "MP3",
  options: DownloadOptions = {},
): Promise<Track> {
  const flacOnlyDownload = requiresFlacDownload(targetQuality);

  const downloadFromQobuz = async (): Promise<Track> => {
    const baseFilename = getTrackBaseFilename(tidalTrack);
    const streamInfo = await resolveQobuzStreamFromTrack(
      {
        title: tidalTrack.title,
        artist: tidalTrack.artist,
        album: tidalTrack.album,
        isrc: tidalTrack.isrc,
      },
      targetQuality,
    );
    if (!streamInfo?.url) {
      throw new Error("Qobuz no devolvio una URL valida para esta pista.");
    }

    if (flacOnlyDownload && streamInfo.extension !== "flac") {
      throw new Error(
        "Qobuz no entrego FLAC para esta pista en este momento.",
      );
    }

    const filename = `${baseFilename}.${streamInfo.extension}`;
    const existingPublicUri = await findExistingPublicTrackUri(filename);
    if (existingPublicUri) {
      await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
      if (tidalTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          tidalTrack.artworkUrl,
          tidalTrack.artist,
          tidalTrack.album,
        );
      }
      return toLibraryTrack(
        {
          ...tidalTrack,
          quality: streamInfo.quality,
          codec: streamInfo.codec,
          sampleRate: streamInfo.sampleRate ?? tidalTrack.sampleRate,
          bitDepth: streamInfo.bitDepth ?? tidalTrack.bitDepth,
        },
        existingPublicUri,
      );
    }

    await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);
    const outputUri = getOutputUri(baseFilename, streamInfo.extension);
    await downloadSegment(
      streamInfo.url,
      outputUri,
      options.onTask,
      options.onProgress,
    );

    const fileInfo = await FileSystem.getInfoAsync(outputUri);
    if (!fileInfo.exists || !fileInfo.size || fileInfo.size <= 0) {
      throw new Error("Download failed: File is empty or does not exist");
    }

    if (!(await isValidAudioFile(outputUri, streamInfo.extension))) {
      throw new Error(
        `Download failed: The file received is not a valid ${streamInfo.extension.toUpperCase()}`,
      );
    }

    let persistentUri = outputUri;
    try {
      persistentUri = await persistInPublicDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    } catch (persistError) {
      console.error(
        "[TidalService] Failed to persist Qobuz file in public folder:",
        persistError,
      );
      persistentUri = await persistInPrivateDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }

    const enrichedTrack: TidalTrack = {
      ...tidalTrack,
      quality: streamInfo.quality,
      codec: streamInfo.codec,
      sampleRate: streamInfo.sampleRate ?? tidalTrack.sampleRate,
      bitDepth: streamInfo.bitDepth ?? tidalTrack.bitDepth,
    };

    await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);
    if (enrichedTrack.artworkUrl) {
      await persistArtworkInPublicDownloads(
        enrichedTrack.artworkUrl,
        enrichedTrack.artist,
        enrichedTrack.album,
      );
    }

    return toLibraryTrack(enrichedTrack, persistentUri);
  };

  const downloadFromDeezer = async (): Promise<Track | null> => {
    const baseFilename = getTrackBaseFilename(tidalTrack);
    const streamInfo = await resolveDeezerStreamFromTrack(
      { isrc: tidalTrack.isrc },
      targetQuality,
    );
    if (!streamInfo?.url) return null;

    if (flacOnlyDownload && streamInfo.extension !== "flac") {
      return null;
    }

    const filename = `${baseFilename}.${streamInfo.extension}`;
    const existingPublicUri = await findExistingPublicTrackUri(filename);
    if (existingPublicUri) {
      await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
      if (tidalTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          tidalTrack.artworkUrl,
          tidalTrack.artist,
          tidalTrack.album,
        );
      }
      return toLibraryTrack(
        {
          ...tidalTrack,
          quality: streamInfo.quality,
          codec: streamInfo.codec,
        },
        existingPublicUri,
      );
    }

    await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);
    const outputUri = getOutputUri(baseFilename, streamInfo.extension);
    await downloadSegment(
      streamInfo.url,
      outputUri,
      options.onTask,
      options.onProgress,
    );

    const fileInfo = await FileSystem.getInfoAsync(outputUri);
    if (!fileInfo.exists || !fileInfo.size || fileInfo.size <= 0) {
      throw new Error("Download failed: File is empty or does not exist");
    }

    if (!(await isValidAudioFile(outputUri, streamInfo.extension))) {
      throw new Error(
        `Download failed: The file received is not a valid ${streamInfo.extension.toUpperCase()}`,
      );
    }

    let persistentUri = outputUri;
    try {
      persistentUri = await persistInPublicDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    } catch (persistError) {
      console.error(
        "[TidalService] Failed to persist Deezer file in public folder:",
        persistError,
      );
      persistentUri = await persistInPrivateDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }

    const enrichedTrack: TidalTrack = {
      ...tidalTrack,
      quality: streamInfo.quality,
      codec: streamInfo.codec,
    };

    await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);
    if (enrichedTrack.artworkUrl) {
      await persistArtworkInPublicDownloads(
        enrichedTrack.artworkUrl,
        enrichedTrack.artist,
        enrichedTrack.album,
      );
    }

    return toLibraryTrack(enrichedTrack, persistentUri);
  };

  const downloadFromAmazonMusic = async (): Promise<Track | null> => {
    const baseFilename = getTrackBaseFilename(tidalTrack);
    const streamInfo = await resolveAmazonMusicStreamFromTrack(
      {
        title: tidalTrack.title,
        artist: tidalTrack.artist,
        album: tidalTrack.album,
        durationMs: tidalTrack.durationMs,
      },
      targetQuality,
    );
    if (!streamInfo?.url) return null;

    if (flacOnlyDownload && streamInfo.extension !== "flac") {
      return null;
    }

    const filename = `${baseFilename}.${streamInfo.extension}`;
    const existingPublicUri = await findExistingPublicTrackUri(filename);
    if (existingPublicUri) {
      await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
      if (tidalTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          tidalTrack.artworkUrl,
          tidalTrack.artist,
          tidalTrack.album,
        );
      }
      return toLibraryTrack(
        {
          ...tidalTrack,
          quality: streamInfo.quality,
          codec: streamInfo.codec,
          sampleRate: streamInfo.sampleRate ?? tidalTrack.sampleRate,
          bitDepth: streamInfo.bitDepth ?? tidalTrack.bitDepth,
        },
        existingPublicUri,
      );
    }

    await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);
    const outputUri = getOutputUri(baseFilename, streamInfo.extension);
    await downloadSegment(
      streamInfo.url,
      outputUri,
      options.onTask,
      options.onProgress,
    );

    const fileInfo = await FileSystem.getInfoAsync(outputUri);
    if (!fileInfo.exists || !fileInfo.size || fileInfo.size <= 0) {
      throw new Error("Download failed: File is empty or does not exist");
    }

    if (!(await isValidAudioFile(outputUri, streamInfo.extension))) {
      throw new Error(
        `Download failed: The file received is not a valid ${streamInfo.extension.toUpperCase()}`,
      );
    }

    let persistentUri = outputUri;
    try {
      persistentUri = await persistInPublicDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    } catch (persistError) {
      console.error(
        "[TidalService] Failed to persist Amazon Music file in public folder:",
        persistError,
      );
      persistentUri = await persistInPrivateDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }

    const enrichedTrack: TidalTrack = {
      ...tidalTrack,
      quality: streamInfo.quality,
      codec: streamInfo.codec,
      sampleRate: streamInfo.sampleRate ?? tidalTrack.sampleRate,
      bitDepth: streamInfo.bitDepth ?? tidalTrack.bitDepth,
    };

    await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);
    if (enrichedTrack.artworkUrl) {
      await persistArtworkInPublicDownloads(
        enrichedTrack.artworkUrl,
        enrichedTrack.artist,
        enrichedTrack.album,
      );
    }

    return toLibraryTrack(enrichedTrack, persistentUri);
  };

  const downloadFromSaavn = async (): Promise<Track | null> => {
    const baseFilename = getTrackBaseFilename(tidalTrack);
    const streamInfo = await resolveSaavnStreamFromTrack(
      {
        title: tidalTrack.title,
        artist: tidalTrack.artist,
        album: tidalTrack.album,
        durationMs: tidalTrack.durationMs,
      },
      targetQuality,
    );
    if (!streamInfo?.url) return null;

    if (flacOnlyDownload) {
      return null;
    }

    const filename = `${baseFilename}.${streamInfo.extension}`;
    const existingPublicUri = await findExistingPublicTrackUri(filename);
    if (existingPublicUri) {
      await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
      if (tidalTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          tidalTrack.artworkUrl,
          tidalTrack.artist,
          tidalTrack.album,
        );
      }
      return toLibraryTrack(
        {
          ...tidalTrack,
          quality: streamInfo.quality,
          codec: streamInfo.codec,
        },
        existingPublicUri,
      );
    }

    await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);
    const outputUri = getOutputUri(baseFilename, streamInfo.extension);
    await downloadSegment(
      streamInfo.url,
      outputUri,
      options.onTask,
      options.onProgress,
    );

    const fileInfo = await FileSystem.getInfoAsync(outputUri);
    if (!fileInfo.exists || !fileInfo.size || fileInfo.size <= 0) {
      throw new Error("Download failed: File is empty or does not exist");
    }

    if (!(await isValidAudioFile(outputUri, streamInfo.extension))) {
      throw new Error(
        `Download failed: The file received is not a valid ${streamInfo.extension.toUpperCase()}`,
      );
    }

    let persistentUri = outputUri;
    try {
      persistentUri = await persistInPublicDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    } catch (persistError) {
      console.error(
        "[TidalService] Failed to persist Saavn file in public folder:",
        persistError,
      );
      persistentUri = await persistInPrivateDownloads(
        outputUri,
        baseFilename,
        streamInfo.extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }

    const enrichedTrack: TidalTrack = {
      ...tidalTrack,
      quality: streamInfo.quality,
      codec: streamInfo.codec,
    };

    await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);
    if (enrichedTrack.artworkUrl) {
      await persistArtworkInPublicDownloads(
        enrichedTrack.artworkUrl,
        enrichedTrack.artist,
        enrichedTrack.album,
      );
    }

    return toLibraryTrack(enrichedTrack, persistentUri);
  };

  if (options.qobuzOnly) {
    try {
      const saavnTrack = await downloadFromSaavn();
      if (saavnTrack) return saavnTrack;
    } catch (saavnError) {
      console.warn("[TidalService] Saavn download failed:", saavnError);
    }

    try {
      const amazonTrack = await downloadFromAmazonMusic();
      if (amazonTrack) return amazonTrack;
    } catch (amazonError) {
      console.warn("[TidalService] Amazon Music download failed:", amazonError);
    }

    try {
      const deezerTrack = await downloadFromDeezer();
      if (deezerTrack) return deezerTrack;
    } catch (deezerError) {
      console.warn("[TidalService] Deezer download failed:", deezerError);
    }

    return await downloadFromQobuz();
  }

  const baseFilename = getTrackBaseFilename(tidalTrack);

  // 1. Get manifest for target quality
  let manifest: ParsedManifest | null = null;
  try {
    const manifestQualityCandidates: TidalQuality[] = flacOnlyDownload
      ? targetQuality === "HI_RES_LOSSLESS"
        ? ["HI_RES_LOSSLESS", "LOSSLESS"]
        : ["LOSSLESS"]
      : [targetQuality, "LOSSLESS", "HIGH"];

    let manifestLastError: unknown = null;
    for (const candidate of manifestQualityCandidates) {
      try {
        manifest = await getTidalTrackManifest(tidalTrack.id, candidate, {
          capability: "download",
        });
        break;
      } catch (error) {
        manifestLastError = error;
        console.warn(
          `[TidalService] Download manifest ${candidate} failed for track ${tidalTrack.id}.`,
          error,
        );
      }
    }

    if (!manifest) {
      throw (
        manifestLastError ??
        new Error("No se pudo resolver un manifest de descarga.")
      );
    }
  } catch (error) {
    if (options.qobuzFallback) {
      try {
        const saavnTrack = await downloadFromSaavn();
        if (saavnTrack) return saavnTrack;
      } catch (saavnError) {
        console.warn("[TidalService] Saavn download fallback failed:", saavnError);
      }

      try {
        const amazonTrack = await downloadFromAmazonMusic();
        if (amazonTrack) return amazonTrack;
      } catch (amazonError) {
        console.warn("[TidalService] Amazon Music download fallback failed:", amazonError);
      }

      try {
        const deezerTrack = await downloadFromDeezer();
        if (deezerTrack) return deezerTrack;
      } catch (deezerError) {
        console.warn("[TidalService] Deezer download fallback failed:", deezerError);
      }

      try {
        return await downloadFromQobuz();
      } catch (qobuzError) {
        console.warn("[TidalService] Qobuz download fallback failed:", qobuzError);
      }
    }

    throw error;
  }

  if (!manifest) {
    throw new Error("No se pudo resolver el manifest de descarga.");
  }

  let sourceUrl = getDirectUrl(manifest);
  if (!sourceUrl && manifest.quality !== "HIGH" && manifest.quality !== "LOW") {
    try {
      const fallbackManifest = await getTidalTrackManifest(
        tidalTrack.id,
        "HIGH",
        { capability: "download" },
      );
      sourceUrl = getDirectUrl(fallbackManifest);
      if (sourceUrl || fallbackManifest.isSegmented)
        manifest = fallbackManifest;
    } catch {
      // ignore
    }
  }

  if (!sourceUrl) {
    if (options.qobuzFallback) {
      try {
        const saavnTrack = await downloadFromSaavn();
        if (saavnTrack) return saavnTrack;
      } catch (saavnError) {
        console.warn("[TidalService] Saavn direct-url fallback failed:", saavnError);
      }

      try {
        const amazonTrack = await downloadFromAmazonMusic();
        if (amazonTrack) return amazonTrack;
      } catch (amazonError) {
        console.warn("[TidalService] Amazon Music direct-url fallback failed:", amazonError);
      }

      try {
        const deezerTrack = await downloadFromDeezer();
        if (deezerTrack) return deezerTrack;
      } catch (deezerError) {
        console.warn("[TidalService] Deezer direct-url fallback failed:", deezerError);
      }

      try {
        return await downloadFromQobuz();
      } catch (qobuzError) {
        console.warn("[TidalService] Qobuz direct-url fallback failed:", qobuzError);
      }
    }

    if (!manifest.isSegmented) {
      throw new Error(
        "No se encontró una URL de descarga directa para este track.",
      );
    }
  }

  const extension = resolveDownloadExtension(manifest, sourceUrl);
  if (flacOnlyDownload && extension !== "flac") {
    if (options.qobuzFallback) {
      try {
        const saavnTrack = await downloadFromSaavn();
        if (saavnTrack) return saavnTrack;
      } catch (saavnError) {
        console.warn("[TidalService] Saavn FLAC fallback failed:", saavnError);
      }

      try {
        const amazonTrack = await downloadFromAmazonMusic();
        if (amazonTrack) return amazonTrack;
      } catch (amazonError) {
        console.warn("[TidalService] Amazon Music FLAC fallback failed:", amazonError);
      }

      try {
        const deezerTrack = await downloadFromDeezer();
        if (deezerTrack) return deezerTrack;
      } catch (deezerError) {
        console.warn("[TidalService] Deezer FLAC fallback failed:", deezerError);
      }

      try {
        return await downloadFromQobuz();
      } catch (qobuzError) {
        console.warn("[TidalService] Qobuz FLAC fallback failed:", qobuzError);
      }
    }

    throw new Error(
      "La descarga no esta en FLAC. Cambia de mirror o intenta de nuevo.",
    );
  }
  const filename = `${baseFilename}.${extension}`;

  if (Platform.OS === "android") {
    const existingPublicUri = await findExistingPublicTrackUri(filename);
    if (existingPublicUri) {
      await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
      if (tidalTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          tidalTrack.artworkUrl,
          tidalTrack.artist,
          tidalTrack.album,
        );
      }
      options.onProgress?.(1);
      return toLibraryTrack(tidalTrack, existingPublicUri);
    }
  }

  await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);

  const outputUri = getOutputUri(baseFilename, extension);
  const outputExists = await FileSystem.getInfoAsync(outputUri);
  if (outputExists.exists) {
    // Redownloading/repairing if called (or if platform doesn't support easy re-use)
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
  }

  const enrichedTrack: TidalTrack = {
    ...tidalTrack,
    quality: manifest.quality ?? tidalTrack.quality,
    codec: manifest.codecs ?? tidalTrack.codec,
    sampleRate: manifest.sampleRate ?? tidalTrack.sampleRate,
    bitDepth: manifest.bitDepth ?? tidalTrack.bitDepth,
  };

  if (manifest.isSegmented) {
    options.onTask?.(null);
    await downloadDashSegmentsToFile(manifest, outputUri, options.onProgress);
  } else if (sourceUrl) {
    await downloadSegment(
      sourceUrl,
      outputUri,
      options.onTask,
      options.onProgress,
    );
  } else {
    throw new Error("No se pudo resolver la descarga del track.");
  }

  // Validate download result
  const fileInfo = await FileSystem.getInfoAsync(outputUri);
  if (!fileInfo.exists || fileInfo.size === 0) {
    throw new Error("Download failed: File is empty or does not exist");
  }

  if (!(await isValidAudioFile(outputUri, extension))) {
    throw new Error(
      `Download failed: The file received is not a valid ${extension.toUpperCase()}`,
    );
  }

  let persistentUri = outputUri;

  if (Platform.OS === "android") {
    try {
      persistentUri = await persistInPublicDownloads(
        outputUri,
        baseFilename,
        extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });

      await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);

      if (enrichedTrack.artworkUrl) {
        await persistArtworkInPublicDownloads(
          enrichedTrack.artworkUrl,
          enrichedTrack.artist,
          enrichedTrack.album,
        );
      }
    } catch (persistError) {
      console.error(
        "[TidalService] Failed to persist in public folder:",
        persistError,
      );
      persistentUri = await persistInPrivateDownloads(
        outputUri,
        baseFilename,
        extension,
      );
      await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }
  }

  options.onProgress?.(1);
  return toLibraryTrack(enrichedTrack, persistentUri);
}
