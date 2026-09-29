/** Where downloads are written: cache and app storage, plus the public Download/StaySound folder via SAF. */
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { TidalTrack } from "../../types/audio";
import { FileSystemStorage } from "../storage";
import type { ParsedManifest } from "../../features/tidal/data/tidalApiTypes";
import { bytesToBase64, getSafEntityName, sanitizeFilename } from "./files";
import { PersistedPublicDownloadsPermission } from "./types";

export const TIDAL_TEMP_DOWNLOADS_DIR = `${FileSystem.cacheDirectory}StaySound/Downloads/`;

const TIDAL_PRIVATE_DOWNLOADS_DIR = `${FileSystem.documentDirectory}StaySound/Downloads/`;

const TIDAL_PUBLIC_FOLDER = "StaySound";

const TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY =
  "tidal-public-downloads-permission";

async function getPersistedPublicDownloadsDirectoryUri(): Promise<
  string | null
> {
  try {
    const raw = await FileSystemStorage.getItem(
      TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY,
    );
    if (!raw) return null;

    const parsed = JSON.parse(
      raw,
    ) as Partial<PersistedPublicDownloadsPermission>;
    return typeof parsed.directoryUri === "string" ? parsed.directoryUri : null;
  } catch {
    return null;
  }
}

async function setPersistedPublicDownloadsDirectoryUri(
  directoryUri: string,
): Promise<void> {
  await FileSystemStorage.setItem(
    TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY,
    JSON.stringify({
      directoryUri,
    } satisfies PersistedPublicDownloadsPermission),
  );
}

async function findSafChildByName(
  parentUri: string,
  targetName: string,
): Promise<string | null> {
  const entries =
    await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri);
  const normalizedTarget = targetName.toLowerCase();

  for (const entry of entries) {
    if (getSafEntityName(entry).toLowerCase() === normalizedTarget) {
      return entry;
    }
  }

  return null;
}

async function ensureStaySoundPublicDirectory(
  baseDirectoryUri: string,
): Promise<string> {
  const baseName = getSafEntityName(baseDirectoryUri).toLowerCase();
  if (baseName === TIDAL_PUBLIC_FOLDER.toLowerCase()) {
    return baseDirectoryUri;
  }

  const existing = await findSafChildByName(
    baseDirectoryUri,
    TIDAL_PUBLIC_FOLDER,
  );
  if (existing) return existing;

  return await FileSystem.StorageAccessFramework.makeDirectoryAsync(
    baseDirectoryUri,
    TIDAL_PUBLIC_FOLDER,
  );
}

async function requestPublicDownloadsDirectoryUri(): Promise<string> {
  const initialDirectory =
    FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("Download");
  const permissions =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
      initialDirectory,
    );

  if (!permissions.granted) {
    throw new Error(
      "Necesitamos permiso a Download para guardar en Download/StaySound",
    );
  }

  return await ensureStaySoundPublicDirectory(permissions.directoryUri);
}

async function getPublicDownloadsDirectoryUri(): Promise<string> {
  if (Platform.OS !== "android") {
    throw new Error("Public download directory is only available on Android");
  }

  const persisted = await getPersistedPublicDownloadsDirectoryUri();
  if (persisted) {
    try {
      await FileSystem.StorageAccessFramework.readDirectoryAsync(persisted);
      return persisted;
    } catch {
      // Persisted permission is no longer valid.
    }
  }

  const selectedDirectory = await requestPublicDownloadsDirectoryUri();
  await setPersistedPublicDownloadsDirectoryUri(selectedDirectory);
  return selectedDirectory;
}

export async function findExistingPublicTrackUri(
  filename: string,
): Promise<string | null> {
  const directoryUri = await getPublicDownloadsDirectoryUri();
  return await findSafChildByName(directoryUri, filename);
}

export async function persistInPublicDownloads(
  tempUri: string,
  baseFilename: string,
  extension: string,
): Promise<string> {
  const filename = `${baseFilename}.${extension}`;
  const existing = await findExistingPublicTrackUri(filename);
  if (existing) return existing;

  const directoryUri = await getPublicDownloadsDirectoryUri();
  const mimeMap: Record<string, string> = {
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
  };

  const destinationUri =
    await FileSystem.StorageAccessFramework.createFileAsync(
      directoryUri,
      baseFilename,
      mimeMap[extension] || "audio/flac",
    );

  const payload = await FileSystem.readAsStringAsync(tempUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await FileSystem.StorageAccessFramework.writeAsStringAsync(
    destinationUri,
    payload,
    {
      encoding: FileSystem.EncodingType.Base64,
    },
  );

  return destinationUri;
}

export async function persistInPrivateDownloads(
  tempUri: string,
  baseFilename: string,
  extension: string,
): Promise<string> {
  await ensureDirectoryExists(TIDAL_PRIVATE_DOWNLOADS_DIR);
  const destinationUri = `${TIDAL_PRIVATE_DOWNLOADS_DIR}${baseFilename}.${extension}`;

  const existing = await FileSystem.getInfoAsync(destinationUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(destinationUri, { idempotent: true });
  }

  await FileSystem.copyAsync({
    from: tempUri,
    to: destinationUri,
  });

  return destinationUri;
}

export async function persistArtworkInPublicDownloads(
  artworkUrl: string,
  artist: string,
  album: string,
): Promise<void> {
  try {
    if (!artworkUrl) return;

    const directoryUri = await getPublicDownloadsDirectoryUri();
    const baseFilename = sanitizeFilename(`${artist} - ${album}`);
    const filename = `${baseFilename}.jpg`;

    const existing = await findSafChildByName(directoryUri, filename);
    if (existing) return;

    const tempArtworkUri = `${FileSystem.cacheDirectory}temp_artwork.jpg`;
    await FileSystem.downloadAsync(artworkUrl, tempArtworkUri);

    const destinationUri =
      await FileSystem.StorageAccessFramework.createFileAsync(
        directoryUri,
        baseFilename,
        "image/jpeg",
      );

    const payload = await FileSystem.readAsStringAsync(tempArtworkUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await FileSystem.StorageAccessFramework.writeAsStringAsync(
      destinationUri,
      payload,
      {
        encoding: FileSystem.EncodingType.Base64,
      },
    );

    await FileSystem.deleteAsync(tempArtworkUri, { idempotent: true });
  } catch (error) {
    console.warn("[TidalService] Failed to persist artwork:", error);
  }
}

export async function persistMetadataInPublicDownloads(
  track: TidalTrack,
  baseFilename: string,
): Promise<void> {
  try {
    const directoryUri = await getPublicDownloadsDirectoryUri();
    const filename = `${baseFilename}.json`;
    const payload = JSON.stringify({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artworkUrl,
      trackNumber: track.trackNumber,
      year: track.year,
      quality: track.quality,
      codec: track.codec,
      sampleRate: track.sampleRate,
      bitDepth: track.bitDepth,
      source: "tidal",
      tidalId: track.id,
      tidalAlbumId: track.albumId,
      isrc: track.isrc,
    });

    const existing = await findSafChildByName(directoryUri, filename);
    if (existing) {
      await FileSystem.StorageAccessFramework.writeAsStringAsync(
        existing,
        payload,
      );
      return;
    }

    const destinationUri =
      await FileSystem.StorageAccessFramework.createFileAsync(
        directoryUri,
        baseFilename,
        "application/json",
      );

    await FileSystem.StorageAccessFramework.writeAsStringAsync(
      destinationUri,
      payload,
    );
  } catch (error) {
    console.warn("[TidalService] Failed to persist metadata:", error);
  }
}

export async function ensureDirectoryExists(dirUri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dirUri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }
}

export function getOutputUri(baseFilename: string, extension: string): string {
  return `${TIDAL_TEMP_DOWNLOADS_DIR}${baseFilename}.${extension}`;
}

export async function downloadSegment(
  url: string,
  outputUri: string,
  onTask?: (task: FileSystem.DownloadResumable | null) => void,
  onProgress?: (progress: number) => void,
): Promise<FileSystem.FileSystemDownloadResult> {
  const task = FileSystem.createDownloadResumable(
    url,
    outputUri,
    {},
    (progress) => {
      const expected = progress.totalBytesExpectedToWrite;
      if (!onProgress) return;
      if (expected > 0) {
        onProgress(progress.totalBytesWritten / expected);
        return;
      }
      // If server doesn't provide content-length, we can't show real progress
      onProgress(0.01);
    },
  );

  onTask?.(task);
  const result = await task.downloadAsync();
  onTask?.(null);
  if (!result) throw new Error("Download failed: No result from task");
  return result;
}

export async function downloadDashSegmentsToFile(
  manifest: ParsedManifest,
  outputUri: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (manifest.urls.length === 0) {
    throw new Error("No DASH segments available for download");
  }

  const chunks: Uint8Array[] = [];

  for (let index = 0; index < manifest.urls.length; index++) {
    const response = await fetch(manifest.urls[index]);
    if (!response.ok) {
      throw new Error(`DASH segment download failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    onProgress?.((index + 1) / manifest.urls.length);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  await FileSystem.writeAsStringAsync(outputUri, bytesToBase64(merged), {
    encoding: FileSystem.EncodingType.Base64,
  });
}
