import { decode as decodeBase64 } from "base-64";
import { DOMParser } from "@xmldom/xmldom";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { useNotificationStore } from "../stores/notificationStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  TidalAlbum,
  TidalAlbumDetail,
  TidalArtist,
  TidalArtistDetail,
  TidalPlaylist,
  TidalPlaylistDetail,
  TidalQuality,
  TidalSearchResult,
  TidalTrack,
  Track,
} from "../types/audio";
import { FileSystemStorage } from "./storage";
import {
  getDabBetaAlbumDetail,
  getDabBetaArtistDetail,
  getDabBetaArtistInfo,
  getDabBetaStreamInfo,
  isDabConfigured,
  searchDabBetaArtists,
  searchDabBetaPlaylists,
  searchDabBetaTracks,
} from "./dabService";
import { getDabBaseUrl, isDabBaseUrl } from "./dabAuthService";
type MirrorProvider = "tidal" | "dab";

export const TIDAL_API_BASES = [
  "https://hifi-api-bffw.onrender.com",
  "https://ohio-1.monochrome.tf",
  "https://frankfurt-1.monochrome.tf",
  "https://monochrome-api.samidy.com",
  "https://eu-central.monochrome.tf",
  "https://us-west.monochrome.tf",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://dabmusic.xyz/api",
  "https://beta.dabmusic.xyz",
];
const TIDAL_API_LEGACY_BASES = [
  "https://hifi.geeked.wtf",
  "https://triton.squid.wtf",
  "https://maus.qqdl.site",
  "https://vogel.qqdl.site",
  "https://wolf.qqdl.site",
  "https://tidal.kinoplus.online",
  "https://arran.monochrome.tf",
  "https://api.monochrome.tf",
  "https://hifi-one.spotisaver.net",
  "https://hifi-two.spotisaver.net",
];
const STATIC_GENERIC_TIDAL_API_BASES = TIDAL_API_BASES.filter(
  (base) => !base.includes("dabmusic.xyz"),
);
const STATIC_GENERIC_STREAMING_BASES = [
  "https://hifi-api-bffw.onrender.com",
  "https://ohio-1.monochrome.tf",
  "https://frankfurt-1.monochrome.tf",
  "https://monochrome-api.samidy.com",
  "https://eu-central.monochrome.tf",
  "https://us-west.monochrome.tf",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
];
const TIDAL_UPTIME_CATALOG_URLS = [
  "https://tidal-uptime.geeked.wtf",
  "https://monochrome-khaki.vercel.app/instances",
];

export const TIDAL_MIRROR_NAMES: Record<string, string> = {
  "https://hifi-api-bffw.onrender.com": "HiFi API BFFW (Activo)",
  "https://ohio-1.monochrome.tf": "Monochrome Ohio (Activo)",
  "https://frankfurt-1.monochrome.tf": "Monochrome Frankfurt (Activo)",
  "https://eu-central.monochrome.tf": "Monochrome EU Central (Activo)",
  "https://us-west.monochrome.tf": "Monochrome US West (Activo)",
  "https://katze.qqdl.site": "QQDL Katze (Activo)",
  "https://hund.qqdl.site": "QQDL Hund (Activo)",
  "https://dabmusic.xyz/api": "DAB Oficial",
  "https://beta.dabmusic.xyz": "DAB Beta (Respaldo)",
  "https://hifi.geeked.wtf": "HiFi Geeked (Legacy)",
  "https://triton.squid.wtf": "Triton (Legacy)",
  "https://maus.qqdl.site": "QQDL Maus (Legacy)",
  "https://vogel.qqdl.site": "QQDL Vogel (Legacy)",
  "https://wolf.qqdl.site": "QQDL Wolf (Legacy)",
  "https://tidal.kinoplus.online": "Kinoplus (Legacy)",
  "https://arran.monochrome.tf": "Monochrome Arran (Legacy)",
  "https://api.monochrome.tf": "Monochrome API (Legacy)",
  "https://monochrome-api.samidy.com": "Monochrome Samidy (Legacy)",
  "https://hifi-one.spotisaver.net": "Spotisaver One (Legacy)",
  "https://hifi-two.spotisaver.net": "Spotisaver Two (Legacy)",
  auto: "Seleccion Automatica (Recomendado)",
};
let currentBaseIndex = 0;
export type TidalMirrorCapability = "search" | "stream" | "download";
export type TidalMirrorAvailability = {
  status: "available" | "slow" | "unavailable";
  latencyMs?: number;
  checkedAt: number;
  statusCode?: number;
  provider: MirrorProvider;
  supportsSearch: boolean;
  supportsStream: boolean;
  supportsDownload: boolean;
  priority?: number;
  lastError?: string | null;
  source: "probe" | "static" | "remote";
};

const TIDAL_ARTWORK_BASE = "https://resources.tidal.com/images";
const TIDAL_TEMP_DOWNLOADS_DIR = `${FileSystem.cacheDirectory}StaySound/Downloads/`;
const TIDAL_PRIVATE_DOWNLOADS_DIR = `${FileSystem.documentDirectory}StaySound/Downloads/`;
const TIDAL_PUBLIC_FOLDER = "StaySound";
const TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY =
  "tidal-public-downloads-permission";
const REQUEST_TIMEOUT_MS = 12000;
const MIRROR_HEALTH_TIMEOUT_MS = 3500;
const MIRROR_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
const DAB_OFFICIAL_BASE_URL = "https://dabmusic.xyz";
const mirrorAvailabilityCache = new Map<string, TidalMirrorAvailability>();
const inflightMirrorChecks = new Map<
  string,
  Promise<TidalMirrorAvailability>
>();
type TidalMirrorCategory = "api" | "streaming";
type TidalMirrorCatalogEntry = {
  baseUrl: string;
  provider: MirrorProvider;
  enabled: boolean;
  priority: number;
  supportsSearch: boolean;
  supportsStream: boolean;
  supportsDownload: boolean;
  status: "available" | "slow" | "unavailable";
  latencyMs?: number;
  lastCheckedAt?: number;
  lastError?: string | null;
  source: "static" | "remote";
};
type DynamicMirrorCatalog = {
  api: TidalMirrorCatalogEntry[];
  streaming: TidalMirrorCatalogEntry[];
  all: TidalMirrorCatalogEntry[];
  fetchedAt: number;
  source: "static" | "remote";
};
type MirrorJsonResult<T> = {
  data: T;
  base: string;
};
type DashRepresentation = {
  id: string;
  codecs?: string;
  mimeType?: string;
  sampleRate?: number;
  bitDepth?: number;
  urls: string[];
};
let dynamicMirrorCatalogPromise: Promise<DynamicMirrorCatalog> | null = null;
let dynamicMirrorCatalogCache: DynamicMirrorCatalog | null = null;
const SEARCH_CACHE_TTL_MS = 45 * 1000;
const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
const tidalDataCache = new Map<string, { value: unknown; expiresAt: number }>();
const inflightTidalDataRequests = new Map<string, Promise<unknown>>();

interface TidalTrackApiResponse {
  id: number;
  title: string;
  duration: number;
  trackNumber?: number;
  isrc?: string;
  explicit?: boolean;
  audioQuality?: string;
  mediaMetadata?: { tags?: string[] };
  album?: {
    id?: number;
    title?: string;
    cover?: string | null;
    releaseDate?: string;
    numberOfTracks?: number;
  };
  artist?: { id?: number; name?: string; picture?: string | null };
  artists?: Array<{ id?: number; name?: string; picture?: string | null }>;
  popularity?: number;
}

interface TidalSearchApiResponse {
  data?: {
    items?: TidalTrackApiResponse[];
  };
}

interface TidalAlbumSearchApiResponse {
  data?: {
    albums?: {
      items?: TidalAlbumApiResponse[];
    };
    items?: TidalAlbumApiResponse[];
  };
}

interface TidalArtistApiResponse {
  id: number;
  name: string;
  picture?: string | null;
  popularity?: number;
}

interface TidalArtistSearchApiResponse {
  data?: {
    artists?: {
      items?: TidalArtistApiResponse[];
    };
    items?: TidalArtistApiResponse[];
  };
}

interface TidalRecommendationsApiResponse {
  items?: TidalTrackApiResponse[];
  data?: {
    items?: TidalTrackApiResponse[];
  };
}

interface TidalSimilarArtistsApiResponse {
  artists?: TidalArtistApiResponse[];
  items?: TidalArtistApiResponse[];
  data?: {
    artists?: TidalArtistApiResponse[];
    items?: TidalArtistApiResponse[];
  };
}

interface TidalSimilarAlbumsApiResponse {
  albums?: TidalAlbumApiResponse[];
  items?: TidalAlbumApiResponse[];
  data?: {
    albums?: TidalAlbumApiResponse[];
    items?: TidalAlbumApiResponse[];
  };
}

interface TidalArtistDetailApiResponse {
  artist?: TidalArtistApiResponse;
  cover?: {
    ["750"]?: string;
  };
}

interface TidalAlbumApiResponse {
  id: number;
  title: string;
  releaseDate?: string;
  explicit?: boolean;
  numberOfTracks?: number;
  cover?: string | null;
  artist?: {
    id?: number;
    name?: string;
  };
  artists?: Array<{
    id?: number;
    name?: string;
  }>;
}

interface TidalAlbumDetailApiResponse {
  data?: TidalAlbumApiResponse & {
    items?: Array<{
      item?: TidalTrackApiResponse;
    }>;
  };
}

interface TidalPlaylistApiResponse {
  uuid: string;
  title: string;
  description?: string;
  numberOfTracks?: number;
  image?: string;
  cover?: string;
  picture?: string;
  squareImage?: string;
}

interface TidalPlaylistSearchApiResponse {
  data?: {
    playlists?: {
      items?: TidalPlaylistApiResponse[];
    };
    items?: TidalPlaylistApiResponse[];
  };
}

interface TidalPlaylistDetailApiResponse {
  data?: TidalPlaylistApiResponse & {
    items?: Array<{
      item?: TidalTrackApiResponse;
    }>;
  };
  playlist?: TidalPlaylistApiResponse;
  items?: Array<{
    item?: TidalTrackApiResponse;
  }>;
}

interface ParsedManifest {
  urls: string[];
  quality: string;
  mimeType?: string;
  codecs?: string;
  isSegmented: boolean;
  sampleRate?: number;
  bitDepth?: number;
  manifestUrl?: string;
}

interface TidalTrackManifestResponse {
  data?: {
    data?: {
      id?: string;
      type?: string;
      attributes?: {
        trackPresentation?: string;
        previewReason?: string;
        uri?: string;
        formats?: string[];
        trackAudioNormalizationData?: {
          replayGain?: number;
          peakAmplitude?: number;
        };
        albumAudioNormalizationData?: {
          replayGain?: number;
          peakAmplitude?: number;
        };
      };
    };
  };
}

interface DownloadOptions {
  onProgress?: (progress: number) => void;
  onTask?: (task: FileSystem.DownloadResumable | null) => void;
  qobuzFallback?: boolean;
  qobuzOnly?: boolean;
}

type PersistedPublicDownloadsPermission = {
  directoryUri: string;
};

import { sanitizeFilename as utilsSanitizeFilename } from "./audioUtils";
import { resolveQobuzStreamFromTrack } from "./qobuzKennyService";

function sanitizeFilename(input: string): string {
  return utilsSanitizeFilename(input);
}

function getTrackBaseFilename(
  track: Pick<TidalTrack, "id" | "title" | "artist" | "album">,
): string {
  const sanitized = sanitizeFilename(
    `${track.artist} - ${track.album} - ${track.title}`,
  );
  if (sanitized.length > 0) return sanitized;
  return `tidal_${track.id}`;
}

function getExtensionFromMime(mimeType?: string, codecs?: string): string {
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

function resolveDownloadExtension(
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

function requiresFlacDownload(targetQuality: TidalQuality): boolean {
  return targetQuality === "LOSSLESS" || targetQuality === "HI_RES_LOSSLESS";
}

function getSafEntityName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const lastSlash = decoded.lastIndexOf("/");
  const lastSegment = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  const colonIndex = lastSegment.lastIndexOf(":");
  const withoutProvider =
    colonIndex >= 0 ? lastSegment.slice(colonIndex + 1) : lastSegment;
  const pathParts = withoutProvider.split("/").filter(Boolean);
  return pathParts[pathParts.length - 1] ?? withoutProvider;
}

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

async function findExistingPublicTrackUri(
  filename: string,
): Promise<string | null> {
  const directoryUri = await getPublicDownloadsDirectoryUri();
  return await findSafChildByName(directoryUri, filename);
}

async function persistInPublicDownloads(
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

async function persistInPrivateDownloads(
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

async function persistArtworkInPublicDownloads(
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

async function persistMetadataInPublicDownloads(
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

function isReachableStatus(status: number): boolean {
  return (
    status < 500 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 405
  );
}

async function probeMirrorAvailability(
  baseUrl: string,
): Promise<TidalMirrorAvailability> {
  const startedAt = Date.now();
  const { signal, cleanup } = withTimeoutSignal(MIRROR_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      signal,
    });
    const latencyMs = Date.now() - startedAt;

    return {
      status: isReachableStatus(response.status)
        ? latencyMs > 1800
          ? "slow"
          : "available"
        : "unavailable",
      latencyMs,
      checkedAt: Date.now(),
      statusCode: response.status,
      provider: inferMirrorProvider(baseUrl),
      supportsSearch: true,
      supportsStream: true,
      supportsDownload: true,
      source: "probe",
    };
  } catch {
    return {
      status: "unavailable",
      latencyMs: Date.now() - startedAt,
      checkedAt: Date.now(),
      provider: inferMirrorProvider(baseUrl),
      supportsSearch: true,
      supportsStream: true,
      supportsDownload: true,
      source: "probe",
    };
  } finally {
    cleanup();
  }
}

export async function getTidalMirrorAvailability(
  mirrors: string[],
  options: { force?: boolean } = {},
): Promise<Record<string, TidalMirrorAvailability>> {
  let catalog: DynamicMirrorCatalog | null = null;
  try {
    catalog = await loadDynamicMirrorCatalog();
  } catch {
    catalog = null;
  }

  const catalogByBaseUrl = new Map(
    (catalog?.all ?? []).map((entry) => [entry.baseUrl, entry] as const),
  );
  const now = Date.now();
  const uniqueMirrors = mirrors.filter(
    (mirror, index, all) => all.indexOf(mirror) === index,
  );
  const results = await Promise.all(
    uniqueMirrors.map(async (mirror) => {
      const remoteEntry = catalogByBaseUrl.get(mirror);

      const cached = mirrorAvailabilityCache.get(mirror);
      if (
        !options.force &&
        cached &&
        now - cached.checkedAt < MIRROR_HEALTH_CACHE_TTL_MS
      ) {
        return [mirror, cached] as const;
      }

      const inflight = inflightMirrorChecks.get(mirror);
      if (inflight) {
        return [mirror, await inflight] as const;
      }

      const request = probeMirrorAvailability(mirror)
        .then((result) => {
          const merged: TidalMirrorAvailability = {
            ...result,
            provider: remoteEntry?.provider ?? result.provider,
            supportsSearch: remoteEntry?.supportsSearch ?? result.supportsSearch,
            supportsStream: remoteEntry?.supportsStream ?? result.supportsStream,
            supportsDownload:
              remoteEntry?.supportsDownload ?? result.supportsDownload,
            priority: remoteEntry?.priority,
            lastError: remoteEntry?.lastError ?? null,
            source: remoteEntry ? remoteEntry.source : result.source,
          };
          mirrorAvailabilityCache.set(mirror, merged);
          return merged;
        })
        .finally(() => {
          inflightMirrorChecks.delete(mirror);
        });

      inflightMirrorChecks.set(mirror, request);
      return [mirror, await request] as const;
    }),
  );

  return Object.fromEntries(results);
}

export function markTidalMirrorUnavailable(
  baseUrl: string,
  statusCode?: number,
): void {
  const cached = mirrorAvailabilityCache.get(baseUrl);
  mirrorAvailabilityCache.set(baseUrl, {
    provider: cached?.provider ?? inferMirrorProvider(baseUrl),
    status: "unavailable",
    checkedAt: Date.now(),
    statusCode,
    latencyMs: cached?.latencyMs,
    supportsSearch: cached?.supportsSearch ?? true,
    supportsStream: cached?.supportsStream ?? true,
    supportsDownload: cached?.supportsDownload ?? true,
    priority: cached?.priority,
    lastError: cached?.lastError ?? null,
    source: cached?.source ?? "probe",
  });
}

function isProxyTidalMirror(base: string): boolean {
  return (
    base.includes("dabmusic.xyz") ||
    base.includes("dab.yeet.su") ||
    base.includes("dab.monochrome.tf") ||
    base.includes("hifi.monochrome.tf") ||
    base.includes("arran.monochrome.tf") ||
    base.includes("music.binimum.org")
  );
}

function isSelectedDabSource() {
  const { tidalMirror } = useSettingsStore.getState();
  return tidalMirror !== "auto" && isDabBaseUrl(tidalMirror);
}

function getTidalCacheScope(): string {
  const { tidalMirror } = useSettingsStore.getState();
  if (tidalMirror === "auto") {
    return isDabConfigured() ? "auto-dab-capable" : "auto-generic";
  }

  return tidalMirror;
}

function readTidalCache<T>(key: string): T | null {
  const cached = tidalDataCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    tidalDataCache.delete(key);
    return null;
  }

  return cached.value as T;
}

function writeTidalCache<T>(key: string, value: T, ttlMs: number): T {
  tidalDataCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

async function withTidalCache<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = readTidalCache<T>(key);
  if (cached !== null) {
    return cached;
  }

  const inflight = inflightTidalDataRequests.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const request = load()
    .then((result) => writeTidalCache(key, result, ttlMs))
    .finally(() => {
      inflightTidalDataRequests.delete(key);
    });

  inflightTidalDataRequests.set(key, request as Promise<unknown>);
  return request;
}

function shouldRescueWithDabBeta() {
  const { tidalMirror } = useSettingsStore.getState();
  return tidalMirror === "auto" && isDabConfigured();
}

function activateDabBetaRescue(message: string) {
  if (!shouldRescueWithDabBeta()) {
    return false;
  }

  const { tidalMirror, setTidalMirror } = useSettingsStore.getState();
  const rescueBaseUrl = getDabBaseUrl();
  const rescueMirror =
    rescueBaseUrl === DAB_OFFICIAL_BASE_URL
      ? `${rescueBaseUrl}/api`
      : rescueBaseUrl;
  if (tidalMirror !== rescueMirror) {
    setTidalMirror(rescueMirror);
    useNotificationStore.getState().showNotification(message, "warning");
  }

  return true;
}

function shouldFallbackFromResponse(
  base: string,
  status: number,
  responseBody: string,
): boolean {
  if (status === 429) {
    return true;
  }

  if (status >= 500 || (status === 404 && base.includes("music.binimum.org"))) {
    return true;
  }

  if (!isProxyTidalMirror(base)) {
    return false;
  }

  if (status === 401 || status === 403) {
    return true;
  }

  const normalizedBody = responseBody.toLowerCase();
  return (
    normalizedBody.includes("requiresauth") ||
    normalizedBody.includes("logged-in users only") ||
    normalizedBody.includes("query parameter is required") ||
    normalizedBody.includes("internal server error") ||
    normalizedBody.includes("upstream api error") ||
    normalizedBody.includes("upstream error")
  );
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const normalizedType = (contentType ?? "").toLowerCase();
  const trimmed = body.trimStart();
  return (
    normalizedType.includes("text/html") ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html")
  );
}

function inferMirrorProvider(baseUrl: string): MirrorProvider {
  return isDabBaseUrl(baseUrl) ? "dab" : "tidal";
}

function createCatalogEntry(
  baseUrl: string,
  partial: Partial<Omit<TidalMirrorCatalogEntry, "baseUrl">> = {},
): TidalMirrorCatalogEntry {
  return {
    baseUrl,
    provider: partial.provider ?? inferMirrorProvider(baseUrl),
    enabled: partial.enabled ?? true,
    priority: partial.priority ?? 999,
    supportsSearch: partial.supportsSearch ?? true,
    supportsStream: partial.supportsStream ?? true,
    supportsDownload: partial.supportsDownload ?? true,
    status: partial.status ?? "available",
    latencyMs: partial.latencyMs,
    lastCheckedAt: partial.lastCheckedAt,
    lastError: partial.lastError ?? null,
    source: partial.source ?? "static",
  };
}

function mergeCatalogEntry(
  existing: TidalMirrorCatalogEntry | undefined,
  next: TidalMirrorCatalogEntry,
): TidalMirrorCatalogEntry {
  if (!existing) return next;

  return {
    ...existing,
    ...next,
    supportsSearch: existing.supportsSearch || next.supportsSearch,
    supportsStream: existing.supportsStream || next.supportsStream,
    supportsDownload: existing.supportsDownload || next.supportsDownload,
    priority: Math.min(existing.priority, next.priority),
    enabled: existing.enabled || next.enabled,
  };
}

function entriesToCatalog(
  entries: TidalMirrorCatalogEntry[],
  source: DynamicMirrorCatalog["source"] = "static",
): DynamicMirrorCatalog {
  const sorted = [...entries].sort((left, right) => left.priority - right.priority);
  return {
    api: sorted.filter((entry) => entry.supportsSearch),
    streaming: sorted.filter(
      (entry) => entry.supportsStream || entry.supportsDownload,
    ),
    all: sorted,
    fetchedAt: Date.now(),
    source,
  };
}

function normalizeCatalogUrl(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "url" in value
        ? String((value as { url?: unknown }).url ?? "")
        : "";
  const normalized = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) return null;
  if (/\.squid\.wtf/i.test(normalized)) return null;
  return normalized;
}

function catalogEntryFromRemoteItem(
  item: unknown,
  category: TidalMirrorCategory,
  index: number,
): TidalMirrorCatalogEntry | null {
  const baseUrl = normalizeCatalogUrl(item);
  if (!baseUrl) return null;

  const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const enabled =
    source.enabled === false ||
    source.ok === false ||
    source.online === false ||
    source.status === "offline" ||
    source.status === "down"
      ? false
      : true;

  const isStreaming = category === "streaming";
  const isApi = category === "api";
  return createCatalogEntry(baseUrl, {
    enabled,
    priority: (isApi ? 100 : isStreaming ? 200 : 300) + index * 10,
    supportsSearch: isApi || Boolean(source.supportsSearch),
    supportsStream: isStreaming || Boolean(source.supportsStream),
    supportsDownload: isStreaming || Boolean(source.supportsDownload),
    status: enabled ? "available" : "unavailable",
    latencyMs: typeof source.ms === "number" ? source.ms : undefined,
    lastError: enabled ? null : "Disabled by uptime catalog",
    source: "remote",
    provider: inferMirrorProvider(baseUrl),
  });
}

function buildCatalogFromRemotePayload(payload: unknown): DynamicMirrorCatalog | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  const combined = new Map<string, TidalMirrorCatalogEntry>();

  const addEntry = (entry: TidalMirrorCatalogEntry | null) => {
    if (!entry) return;
    combined.set(entry.baseUrl, mergeCatalogEntry(combined.get(entry.baseUrl), entry));
  };

  const categories: TidalMirrorCategory[] = ["api", "streaming"];
  categories.forEach((category) => {
    const items = source[category];
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => addEntry(catalogEntryFromRemoteItem(item, category, index)));
  });

  const allItems = source.instances ?? source.mirrors ?? source.data;
  if (Array.isArray(allItems)) {
    allItems.forEach((item, index) => addEntry(catalogEntryFromRemoteItem(item, "api", index)));
  }

  const remoteEntries = Array.from(combined.values()).filter((entry) => entry.enabled);
  if (remoteEntries.length === 0) return null;
  return entriesToCatalog(remoteEntries, "remote");
}

function buildStaticMirrorCatalog(): DynamicMirrorCatalog {
  const combined = new Map<string, TidalMirrorCatalogEntry>();

  STATIC_GENERIC_TIDAL_API_BASES.forEach((baseUrl, index) => {
    combined.set(
      baseUrl,
      mergeCatalogEntry(
        combined.get(baseUrl),
        createCatalogEntry(baseUrl, {
          priority: 100 + index * 10,
          supportsSearch: true,
          supportsStream: false,
          supportsDownload: false,
        }),
      ),
    );
  });

  STATIC_GENERIC_STREAMING_BASES.forEach((baseUrl, index) => {
    combined.set(
      baseUrl,
      mergeCatalogEntry(
        combined.get(baseUrl),
        createCatalogEntry(baseUrl, {
          priority: 200 + index * 10,
          supportsSearch: false,
          supportsStream: true,
          supportsDownload: true,
        }),
      ),
    );
  });

  [
    "https://dabmusic.xyz/api",
    "https://beta.dabmusic.xyz",
  ].forEach((baseUrl, index) => {
    combined.set(
      baseUrl,
      mergeCatalogEntry(
        combined.get(baseUrl),
        createCatalogEntry(baseUrl, {
          provider: "dab",
          priority: 500 + index * 10,
          supportsSearch: true,
          supportsStream: true,
          supportsDownload: true,
        }),
      ),
    );
  });

  return entriesToCatalog(Array.from(combined.values()));
}

async function loadDynamicMirrorCatalog(): Promise<DynamicMirrorCatalog> {
  if (dynamicMirrorCatalogCache) return dynamicMirrorCatalogCache;

  if (dynamicMirrorCatalogPromise) {
    return dynamicMirrorCatalogPromise;
  }

  dynamicMirrorCatalogPromise = (async () => {
    const fallbackCatalog = buildStaticMirrorCatalog();
    for (const catalogUrl of TIDAL_UPTIME_CATALOG_URLS) {
      const { signal, cleanup } = withTimeoutSignal(MIRROR_HEALTH_TIMEOUT_MS);
      try {
        const response = await fetch(catalogUrl, { signal });
        if (!response.ok) throw new Error(`Uptime catalog failed (${response.status})`);
        const payload = await response.json();
        const remoteCatalog = buildCatalogFromRemotePayload(payload);
        if (remoteCatalog) {
          dynamicMirrorCatalogCache = remoteCatalog;
          return remoteCatalog;
        }
      } catch (error) {
        console.warn("[TidalService] Monochrome uptime catalog unavailable:", error);
      } finally {
        cleanup();
      }
    }

    dynamicMirrorCatalogCache = fallbackCatalog;
    return fallbackCatalog;
  })().finally(() => {
    dynamicMirrorCatalogPromise = null;
  });

  return dynamicMirrorCatalogPromise;
}

async function getFallbackBases(
  category: TidalMirrorCategory,
  capability: TidalMirrorCapability =
    category === "streaming" ? "stream" : "search",
): Promise<string[]> {
  const catalog = await loadDynamicMirrorCatalog();
  const preferred =
    category === "streaming"
      ? catalog.streaming.filter((entry) =>
          capability === "download"
            ? entry.supportsDownload
            : entry.supportsStream,
        )
      : catalog.api.filter((entry) => entry.supportsSearch);
  if (preferred.length > 0) {
    return preferred.map((entry) => entry.baseUrl);
  }

  return category === "streaming"
    ? STATIC_GENERIC_STREAMING_BASES
    : STATIC_GENERIC_TIDAL_API_BASES;
}

async function getCatalogEntryByBaseUrl(
  baseUrl: string,
): Promise<TidalMirrorCatalogEntry | null> {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) return null;

  try {
    const catalog = await loadDynamicMirrorCatalog();
    return (
      catalog.all.find((entry) => entry.baseUrl === normalized) ?? null
    );
  } catch {
    return null;
  }
}

function isCapabilitySupported(
  entry: TidalMirrorCatalogEntry | null,
  capability: TidalMirrorCapability,
): boolean {
  if (!entry) return true;
  if (capability === "stream") return entry.supportsStream;
  if (capability === "download") return entry.supportsDownload;
  return entry.supportsSearch;
}

function capabilityErrorMessage(capability: TidalMirrorCapability): string {
  if (capability === "download") {
    return "El mirror seleccionado no soporta descargas en este momento.";
  }

  if (capability === "stream") {
    return "El mirror seleccionado no soporta reproduccion en este momento.";
  }

  return "El mirror seleccionado no soporta busqueda y metadata en este momento.";
}

export async function getTidalMirrorOptions(
  options: { force?: boolean } = {},
): Promise<string[]> {
  const pinnedMirrors = [
    "https://dabmusic.xyz/api",
    "https://beta.dabmusic.xyz",
  ];

  if (options.force) {
    dynamicMirrorCatalogCache = null;
    dynamicMirrorCatalogPromise = null;
    mirrorAvailabilityCache.clear();
    inflightMirrorChecks.clear();
  }

  try {
    const catalog = await loadDynamicMirrorCatalog();
    if (catalog.all.length > 0) {
      return Array.from(
        new Set([
          ...pinnedMirrors,
          ...catalog.all.map((entry) => entry.baseUrl),
          ...TIDAL_API_LEGACY_BASES,
        ]),
      );
    }
  } catch {
    // Ignore and fall back to static values below.
  }

  return Array.from(
    new Set([
      ...pinnedMirrors,
      ...TIDAL_API_BASES,
      ...TIDAL_API_LEGACY_BASES,
    ]),
  );
}

async function parseJsonResponse<T>(
  response: Response,
  base: string,
): Promise<T> {
  const rawBody = await response.text();
  if (isHtmlResponse(response.headers.get("content-type"), rawBody)) {
    throw new Error(`Mirror returned HTML instead of JSON: ${base}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${base}`);
  }
}

async function fetchJson<T>(
  path: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  options: {
    ignoreManualMirror?: boolean;
    category?: TidalMirrorCategory;
    capability?: TidalMirrorCapability;
  } = {},
): Promise<T> {
  const { tidalMirror } = useSettingsStore.getState();
  const category = options.category ?? "api";
  const capability =
    options.capability ?? (category === "streaming" ? "stream" : "search");
  let fallbackBases = await getFallbackBases(category, capability);
  let lastError: Error | null = null;

  // If user selected a specific mirror, try it first
  if (!options.ignoreManualMirror && tidalMirror && tidalMirror !== "auto") {
    const manualEntry = await getCatalogEntryByBaseUrl(tidalMirror);
    if (!isCapabilitySupported(manualEntry, capability)) {
      throw new Error(capabilityErrorMessage(capability));
    }

    const url = `${tidalMirror}${path}`;
    const { signal, cleanup } = withTimeoutSignal(timeoutMs);
    try {
      console.log(`[TidalService] Requesting (Manual Mirror): ${url}`);
      const response = await fetch(url, { signal });
      if (response.ok) {
        cleanup();
        return await parseJsonResponse<T>(response, tidalMirror);
      }
      const errorBody = await response.text().catch(() => "No body");
      if (shouldFallbackFromResponse(tidalMirror, response.status, errorBody)) {
        throw new Error(`Manual mirror issue: ${response.status}`);
      }
      throw new Error(
        `Tidal request failed (${response.status}): ${errorBody}`,
      );
    } catch (error: any) {
      cleanup();
      lastError = error;
      markTidalMirrorUnavailable(tidalMirror);
      console.warn(
        `[TidalService] Manual mirror ${tidalMirror} failed: ${error.message}. Trying fallback mirrors...`,
      );
      fallbackBases = fallbackBases.filter((base) => base !== tidalMirror);
    }
  }

  if (fallbackBases.length === 0) {
    throw lastError || new Error("All Tidal mirrors failed");
  }

  const startBaseIndex = currentBaseIndex % fallbackBases.length;
  for (let i = 0; i < fallbackBases.length; i++) {
    const base = fallbackBases[currentBaseIndex % fallbackBases.length];
    const url = `${base}${path}`;
    const { signal, cleanup } = withTimeoutSignal(timeoutMs);

    try {
      console.log(`[TidalService] Requesting: ${url}`);
      const response = await fetch(url, { signal });

      if (response.ok) {
        cleanup();
        return await parseJsonResponse<T>(response, base);
      }
      const errorBody = await response.text().catch(() => "No body");
      if (shouldFallbackFromResponse(base, response.status, errorBody)) {
        throw new Error(`Mirror issue: ${response.status}`);
      }
      throw new Error(
        `Tidal request failed (${response.status}): ${errorBody}`,
      );
    } catch (error: any) {
      cleanup();
      lastError = error;
      markTidalMirrorUnavailable(base);
      console.warn(
        `[TidalService] Base ${base} failed: ${error.message}. Trying next...`,
      );

      // Cycle to next base
      currentBaseIndex = (currentBaseIndex + 1) % fallbackBases.length;

      // If we've circled back to the start, stop and throw
      if (currentBaseIndex === startBaseIndex) break;
    }
  }

  throw lastError || new Error("All Tidal mirrors failed");
}

async function fetchJsonWithMirror<T>(
  path: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  options: {
    ignoreManualMirror?: boolean;
    category?: TidalMirrorCategory;
    capability?: TidalMirrorCapability;
  } = {},
): Promise<MirrorJsonResult<T>> {
  const { tidalMirror } = useSettingsStore.getState();
  const category = options.category ?? "api";
  const capability =
    options.capability ?? (category === "streaming" ? "stream" : "search");
  let fallbackBases = await getFallbackBases(category, capability);
  let lastError: Error | null = null;

  if (!options.ignoreManualMirror && tidalMirror && tidalMirror !== "auto") {
    const manualEntry = await getCatalogEntryByBaseUrl(tidalMirror);
    if (!isCapabilitySupported(manualEntry, capability)) {
      throw new Error(capabilityErrorMessage(capability));
    }

    const url = `${tidalMirror}${path}`;
    const { signal, cleanup } = withTimeoutSignal(timeoutMs);

    try {
      console.log(`[TidalService] Requesting (Manual Mirror): ${url}`);
      const response = await fetch(url, { signal });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "No body");
        if (shouldFallbackFromResponse(tidalMirror, response.status, errorBody)) {
          throw new Error(`Manual mirror issue: ${response.status}`);
        }
        throw new Error(
          `Tidal request failed (${response.status}): ${errorBody}`,
        );
      }

      return {
        data: await parseJsonResponse<T>(response, tidalMirror),
        base: tidalMirror,
      };
    } catch (error: any) {
      lastError = error;
      markTidalMirrorUnavailable(tidalMirror);
      console.warn(
        `[TidalService] Manual mirror ${tidalMirror} failed: ${error.message}. Trying fallback mirrors...`,
      );
      fallbackBases = fallbackBases.filter((base) => base !== tidalMirror);
    } finally {
      cleanup();
    }
  }

  if (fallbackBases.length === 0) {
    throw lastError || new Error("All Tidal mirrors failed");
  }

  const startBaseIndex = currentBaseIndex % fallbackBases.length;

  for (let i = 0; i < fallbackBases.length; i++) {
    const base = fallbackBases[currentBaseIndex % fallbackBases.length];
    const url = `${base}${path}`;
    const { signal, cleanup } = withTimeoutSignal(timeoutMs);

    try {
      console.log(`[TidalService] Requesting: ${url}`);
      const response = await fetch(url, { signal });

      if (response.ok) {
        return {
          data: await parseJsonResponse<T>(response, base),
          base,
        };
      }

      const errorBody = await response.text().catch(() => "No body");
      if (shouldFallbackFromResponse(base, response.status, errorBody)) {
        throw new Error(`Mirror issue: ${response.status}`);
      }

      throw new Error(
        `Tidal request failed (${response.status}): ${errorBody}`,
      );
    } catch (error: any) {
      lastError = error;
      markTidalMirrorUnavailable(base);
      console.warn(
        `[TidalService] Base ${base} failed: ${error.message}. Trying next...`,
      );
      currentBaseIndex = (currentBaseIndex + 1) % fallbackBases.length;
      if (currentBaseIndex === startBaseIndex) break;
    } finally {
      cleanup();
    }
  }

  throw lastError || new Error("All Tidal mirrors failed");
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  if (!maybeRelative) return baseUrl;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (!baseUrl) return maybeRelative;

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${maybeRelative.replace(/^\/+/, "")}`;
}

function extractSegmentCountFromTimeline(xml: string): number {
  const segmentNodes = Array.from(xml.matchAll(/<S\b([^>]*)\/?\s*>/gi));
  if (segmentNodes.length === 0) return 0;

  let count = 0;
  for (const node of segmentNodes) {
    const attrs = node[1] ?? "";
    const repeatMatch = attrs.match(/\br="(-?\d+)"/i);
    const repeat = repeatMatch ? Number.parseInt(repeatMatch[1], 10) : 0;
    count += repeat >= 0 ? repeat + 1 : 1;
  }

  return count;
}

function buildSegmentTemplateMedia(
  mediaTemplate: string,
  number: number,
): string {
  return mediaTemplate.replace(
    /\$Number(%0(\d+)d)?\$/g,
    (_full, _format, width) => {
      if (!width) return String(number);
      return String(number).padStart(Number.parseInt(width, 10), "0");
    },
  );
}

function parseDashRepresentationUrls(
  representation: Element,
  adaptationSet: Element,
): DashRepresentation | null {
  const segmentTemplate =
    representation.getElementsByTagName("SegmentTemplate")[0] ??
    adaptationSet.getElementsByTagName("SegmentTemplate")[0];
  if (!segmentTemplate) return null;

  const initialization = segmentTemplate.getAttribute("initialization") ?? "";
  const media = segmentTemplate.getAttribute("media") ?? "";
  const startNumber = Number.parseInt(
    segmentTemplate.getAttribute("startNumber") ?? "1",
    10,
  );
  const timelineNodes = segmentTemplate.getElementsByTagName("S");
  let segmentCount = 0;
  for (let i = 0; i < timelineNodes.length; i++) {
    const repeat = Number.parseInt(
      timelineNodes[i].getAttribute("r") ?? "0",
      10,
    );
    segmentCount += repeat >= 0 ? repeat + 1 : 1;
  }

  const baseUrlNode =
    representation.getElementsByTagName("BaseURL")[0] ??
    adaptationSet.getElementsByTagName("BaseURL")[0];
  const baseUrl = baseUrlNode?.textContent?.trim() ?? "";

  const urls: string[] = [];
  if (initialization) {
    urls.push(resolveUrl(baseUrl, initialization));
  }

  if (media && segmentCount > 0) {
    for (
      let segmentNumber = startNumber;
      segmentNumber < startNumber + segmentCount;
      segmentNumber++
    ) {
      urls.push(
        resolveUrl(baseUrl, buildSegmentTemplateMedia(media, segmentNumber)),
      );
    }
  }

  if (urls.length === 0) {
    return null;
  }

  const representationId = representation.getAttribute("id") ?? "";
  const codecs =
    representation.getAttribute("codecs") ??
    adaptationSet.getAttribute("codecs") ??
    undefined;
  const mimeType =
    representation.getAttribute("mimeType") ??
    adaptationSet.getAttribute("mimeType") ??
    undefined;
  const sampleRate = Number.parseInt(
    representation.getAttribute("audioSamplingRate") ??
      adaptationSet.getAttribute("audioSamplingRate") ??
      "0",
    10,
  );
  const bitDepthMatch = representationId.match(/FLAC,(\d+),(\d+)/i);

  return {
    id: representationId,
    codecs,
    mimeType,
    sampleRate:
      Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
    bitDepth: bitDepthMatch ? Number.parseInt(bitDepthMatch[2], 10) : undefined,
    urls,
  };
}

function scoreDashRepresentation(
  representation: DashRepresentation,
  quality: string,
): number {
  const id = representation.id.toUpperCase();
  const codecs = (representation.codecs ?? "").toLowerCase();
  const sampleRate = representation.sampleRate ?? 0;
  const bitDepth = representation.bitDepth ?? 0;

  if (quality === "LOW") {
    if (id.includes("HEAACV1")) return 100;
    if (id.includes("AACLC")) return 50;
    return 0;
  }

  if (quality === "HIGH") {
    if (id.includes("AACLC")) return 100;
    if (id.includes("HEAACV1")) return 50;
    return 0;
  }

  if (quality === "LOSSLESS") {
    if (codecs.includes("flac")) {
      return 1000 + sampleRate + bitDepth;
    }
    if (id.includes("AACLC")) return 50;
    return 0;
  }

  if (quality === "HI_RES_LOSSLESS") {
    if (codecs.includes("flac")) {
      return 1000 + sampleRate + bitDepth * 10;
    }
    return 0;
  }

  return 0;
}

function parseDashManifestForQuality(
  manifestXml: string,
  quality: string,
): {
  urls: string[];
  mimeType?: string;
  codecs?: string;
  sampleRate?: number;
  bitDepth?: number;
} {
  const document = new DOMParser().parseFromString(
    manifestXml,
    "application/xml",
  );
  const adaptationSets = Array.from(
    document.getElementsByTagName("AdaptationSet"),
  );
  const representations: DashRepresentation[] = [];

  for (const adaptationSet of adaptationSets) {
    const mimeType = adaptationSet.getAttribute("mimeType") ?? "";
    if (!mimeType.toLowerCase().includes("audio")) continue;

    const repNodes = Array.from(
      adaptationSet.getElementsByTagName("Representation"),
    );
    for (const representation of repNodes) {
      const parsed = parseDashRepresentationUrls(representation, adaptationSet);
      if (parsed) {
        representations.push(parsed);
      }
    }
  }

  const ranked = representations
    .map((representation) => ({
      representation,
      score: scoreDashRepresentation(representation, quality),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0]?.representation;
  if (!selected) {
    throw new Error("Tidal DASH manifest did not produce segment URLs");
  }

  return {
    urls: selected.urls,
    mimeType: selected.mimeType,
    codecs: selected.codecs,
    sampleRate: selected.sampleRate,
    bitDepth: selected.bitDepth,
  };
}

function parseDashManifest(manifestXml: string): string[] {
  const baseUrlMatch = manifestXml.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
  const baseUrl = baseUrlMatch?.[1]?.trim() ?? "";

  const segmentListInit = manifestXml.match(
    /<SegmentList[^>]*\binitialization="([^"]+)"/i,
  )?.[1];
  const segmentListUrls = Array.from(
    manifestXml.matchAll(/<SegmentURL[^>]*\bmedia="([^"]+)"/gi),
  );
  if (segmentListUrls.length > 0) {
    const urls = segmentListUrls.map((match) => resolveUrl(baseUrl, match[1]));
    if (segmentListInit) {
      return [resolveUrl(baseUrl, segmentListInit), ...urls];
    }
    return urls;
  }

  const segmentTemplateMatch =
    manifestXml.match(/<SegmentTemplate[^>]*>/i)?.[0] ?? "";
  const initialization = segmentTemplateMatch.match(
    /\binitialization="([^"]+)"/i,
  )?.[1];
  const media = segmentTemplateMatch.match(/\bmedia="([^"]+)"/i)?.[1];
  const startNumber = Number.parseInt(
    segmentTemplateMatch.match(/\bstartNumber="(\d+)"/i)?.[1] ?? "1",
    10,
  );
  const segmentCount = extractSegmentCountFromTimeline(manifestXml);

  if (media && segmentCount > 0) {
    const urls: string[] = [];
    if (initialization) {
      urls.push(resolveUrl(baseUrl, initialization));
    }

    for (
      let segmentNumber = startNumber;
      segmentNumber < startNumber + segmentCount;
      segmentNumber++
    ) {
      urls.push(
        resolveUrl(baseUrl, buildSegmentTemplateMedia(media, segmentNumber)),
      );
    }

    return urls;
  }

  const absoluteUrls = Array.from(
    manifestXml.matchAll(/https?:\/\/[^"'\s<]+/gi),
  ).map((match) => match[0]);
  return absoluteUrls;
}

function normalizeSearchItem(item: TidalTrackApiResponse): TidalSearchResult {
  const quality = item.audioQuality ?? "LOSSLESS";
  const tags = item.mediaMetadata?.tags ?? [];
  const isHiRes =
    tags.includes("HIRES_LOSSLESS") || quality === "HI_RES_LOSSLESS";
  const primaryArtist =
    item.artist?.name ?? item.artists?.[0]?.name ?? "Unknown Artist";
  const albumTitle = item.album?.title ?? "Unknown Album";
  const coverUuid = item.album?.cover ?? null;

  return {
    id: item.id,
    title: item.title,
    artist: primaryArtist,
    album: albumTitle,
    durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
    quality,
    isHiRes,
    coverUuid,
    artworkUrl: getArtworkUrl(coverUuid),
    trackNumber: item.trackNumber,
    isrc: item.isrc,
    explicit: item.explicit,
    popularity: item.popularity,
    artistId: item.artist?.id,
    albumId: item.album?.id,
  };
}

function parseYearFromReleaseDate(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

function normalizeArtistItem(item: TidalArtistApiResponse): TidalArtist {
  const picture = item.picture || undefined;
  const artworkUrl = getArtworkUrl(picture);

  return {
    id: item.id,
    name: item.name,
    picture: typeof picture === "string" ? picture : undefined,
    artworkUrl,
    popularity: item.popularity,
  };
}

function normalizeAlbumItem(item: TidalAlbumApiResponse): TidalAlbum {
  return {
    id: item.id,
    title: item.title,
    artistId: item.artist?.id ?? item.artists?.[0]?.id,
    artistName:
      item.artist?.name ?? item.artists?.[0]?.name ?? "Artista Desconocido",
    releaseDate: item.releaseDate,
    year: item.releaseDate
      ? new Date(item.releaseDate).getFullYear()
      : undefined,
    numberOfTracks: item.numberOfTracks,
    explicit: item.explicit,
    artworkUrl: getArtworkUrl(item.cover ?? undefined),
  };
}

function normalizePlaylistItem(item: TidalPlaylistApiResponse): TidalPlaylist {
  const rawImage = item.image || item.cover || item.picture || item.squareImage;
  let artworkUrl = undefined;

  if (rawImage) {
    if (rawImage.startsWith("http")) {
      artworkUrl = rawImage;
    } else {
      artworkUrl = getPlaylistArtworkUrl(rawImage);
    }
  }

  return {
    uuid: item.uuid,
    title: item.title,
    description: item.description,
    numberOfTracks: item.numberOfTracks,
    artworkUrl,
  };
}

function normalizeArtistTrack(
  track: TidalTrackApiResponse,
  fallbackArtist?: TidalArtist,
): TidalTrack {
  const normalized = normalizeSearchItem(track);
  return {
    ...normalized,
    artistId: normalized.artistId ?? fallbackArtist?.id,
    artist: normalized.artist || fallbackArtist?.name || "Unknown Artist",
  };
}

async function ensureDirectoryExists(dirUri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dirUri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }
}

function getOutputUri(baseFilename: string, extension: string): string {
  return `${TIDAL_TEMP_DOWNLOADS_DIR}${baseFilename}.${extension}`;
}

function isFlacSource(url: string, manifest: ParsedManifest): boolean {
  if (/\.flac(\?|$)/i.test(url)) return true;
  if ((manifest.mimeType ?? "").toLowerCase().includes("flac")) return true;
  if ((manifest.codecs ?? "").toLowerCase().includes("flac")) return true;
  return false;
}

function getDirectUrl(manifest: ParsedManifest): string | null {
  const directUrls = manifest.urls.filter((url) => /^https?:\/\//i.test(url));
  if (manifest.isSegmented || directUrls.length !== 1) {
    return null;
  }
  return directUrls[0];
}

function getPlayableUrl(manifest: ParsedManifest): string | null {
  const directUrl = getDirectUrl(manifest);
  if (directUrl) {
    return directUrl;
  }

  if (manifest.manifestUrl && /^https?:\/\//i.test(manifest.manifestUrl)) {
    return manifest.manifestUrl;
  }

  return null;
}

async function downloadSegment(
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

function bytesToBase64(bytes: Uint8Array): string {
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

async function downloadDashSegmentsToFile(
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

function toLibraryTrack(tidalTrack: TidalTrack, uri: string): Track {
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

export function getArtworkUrl(coverUuid?: string | null): string | undefined {
  if (
    !coverUuid ||
    coverUuid === "00000000-0000-0000-0000-000000000000" ||
    coverUuid === "null"
  )
    return undefined;
  if (coverUuid.startsWith("http")) return coverUuid;

  const normalized = coverUuid.replace(/-/g, "/");
  return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export function getPlaylistArtworkUrl(
  playlistImageId?: string | null,
): string | undefined {
  if (!playlistImageId) return undefined;

  // Some playlist images are direct square hashes, while others follow the UUID pattern
  // If it's a UUID style (with dashes), we normalize it
  const normalized = playlistImageId.includes("-")
    ? playlistImageId.replace(/-/g, "/")
    : playlistImageId;

  return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export async function searchTidal(query: string): Promise<TidalSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `tracks:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      try {
        return await searchDabBetaTracks(trimmed);
      } catch (error) {
        console.warn(
          "[TidalService] DAB search failed, retrying via generic mirrors:",
          error,
        );
        const response = await fetchJson<TidalSearchApiResponse>(
          `/search/?s=${encodeURIComponent(trimmed)}`,
          REQUEST_TIMEOUT_MS,
          { ignoreManualMirror: true },
        );

        return (response.data?.items ?? []).map(normalizeSearchItem);
      }
    }

    try {
      const response = await fetchJson<TidalSearchApiResponse>(
        `/search/?s=${encodeURIComponent(trimmed)}`,
      );

      return (response.data?.items ?? []).map(normalizeSearchItem);
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "Los mirrors de Tidal fallaron. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return await searchDabBetaTracks(trimmed);
    }
  });
}

export async function searchTidalArtists(
  query: string,
): Promise<TidalArtist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `artists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      try {
        return await searchDabBetaArtists(trimmed);
      } catch (error) {
        console.warn(
          "[TidalService] DAB artist search failed, retrying via generic mirrors:",
          error,
        );
        const response = await fetchJson<TidalArtistSearchApiResponse>(
          `/search/?a=${encodeURIComponent(trimmed)}`,
          REQUEST_TIMEOUT_MS,
          { ignoreManualMirror: true },
        );

        const artistItems =
          response.data?.artists?.items ?? response.data?.items ?? [];
        return artistItems.map(normalizeArtistItem);
      }
    }

    try {
      const response = await fetchJson<TidalArtistSearchApiResponse>(
        `/search/?a=${encodeURIComponent(trimmed)}`,
      );

      const artistItems =
        response.data?.artists?.items ?? response.data?.items ?? [];
      return artistItems.map(normalizeArtistItem);
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "Los mirrors de Tidal fallaron. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return await searchDabBetaArtists(trimmed);
    }
  });
}

export async function searchTidalPlaylists(
  query: string,
): Promise<TidalPlaylist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `playlists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      try {
        return await searchDabBetaPlaylists();
      } catch (error) {
        console.warn(
          "[TidalService] DAB playlist search failed, retrying via generic mirrors:",
          error,
        );
        const response = await fetchJson<TidalPlaylistSearchApiResponse>(
          `/search/?p=${encodeURIComponent(trimmed)}`,
          REQUEST_TIMEOUT_MS,
          { ignoreManualMirror: true },
        );

        const playlistItems =
          response.data?.playlists?.items ?? response.data?.items ?? [];
        return playlistItems.map(normalizePlaylistItem);
      }
    }

    try {
      const response = await fetchJson<TidalPlaylistSearchApiResponse>(
        `/search/?p=${encodeURIComponent(trimmed)}`,
      );

      const playlistItems =
        response.data?.playlists?.items ?? response.data?.items ?? [];
      return playlistItems.map(normalizePlaylistItem);
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "Los mirrors de Tidal fallaron. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return [];
    }
  });
}

export async function searchTidalAlbums(query: string): Promise<TidalAlbum[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `albums:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    try {
      const response = await fetchJson<TidalAlbumSearchApiResponse>(
        `/search/?al=${encodeURIComponent(trimmed)}`,
        REQUEST_TIMEOUT_MS,
        isSelectedDabSource() ? { ignoreManualMirror: true } : undefined,
      );

      const albumItems =
        response.data?.albums?.items ?? response.data?.items ?? [];
      return albumItems.map(normalizeAlbumItem);
    } catch (error) {
      if (isSelectedDabSource()) {
        console.warn(
          "[TidalService] Album search failed while DAB source selected:",
          error,
        );
        return [];
      }

      if (
        !activateDabBetaRescue(
          "Los mirrors de Tidal fallaron. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      try {
        const response = await fetchJson<TidalAlbumSearchApiResponse>(
          `/search/?al=${encodeURIComponent(trimmed)}`,
          REQUEST_TIMEOUT_MS,
          { ignoreManualMirror: true },
        );

        const albumItems =
          response.data?.albums?.items ?? response.data?.items ?? [];
        return albumItems.map(normalizeAlbumItem);
      } catch {
        return [];
      }
    }
  });
}

export function extractAlbumsFromTracks(tracks: TidalTrack[]): TidalAlbum[] {
  const albumsMap = new Map<number, TidalAlbum>();

  tracks.forEach((track) => {
    if (!track.albumId) return;
    if (albumsMap.has(track.albumId)) return;

    albumsMap.set(track.albumId, {
      id: track.albumId,
      title: track.album,
      artistId: track.artistId,
      artistName: track.artist,
      coverUuid: track.coverUuid,
      artworkUrl: track.artworkUrl,
    });
  });

  return Array.from(albumsMap.values());
}
export async function getTidalAlbumDetail(
  albumId: number,
): Promise<TidalAlbumDetail> {
  const cacheKey = `album-detail:${getTidalCacheScope()}:${albumId}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      return await getDabBetaAlbumDetail(albumId);
    }
    try {
      const response = await fetchJson<TidalAlbumDetailApiResponse>(
        `/album/?id=${albumId}`,
      );

      const albumData = response.data;
      if (!albumData) {
        throw new Error("No se pudo cargar el album de Tidal");
      }

      const album = normalizeAlbumItem(albumData);
      const tracks = (albumData.items ?? [])
        .map((entry) => entry.item)
        .filter((item): item is TidalTrackApiResponse => !!item)
        .map((item) =>
          normalizeArtistTrack(
            item,
            album.artistId
              ? { id: album.artistId, name: album.artistName }
              : undefined,
          ),
        );

      return { album, tracks };
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "No se pudo abrir el album desde Tidal. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return await getDabBetaAlbumDetail(albumId);
    }
  });
}

export async function getTidalPlaylistDetail(
  playlistUuid: string,
): Promise<TidalPlaylistDetail> {
  const response = await fetchJson<any>(`/playlist/?id=${playlistUuid}`);

  // Try multiple possible paths for the playlist metadata
  const playlistData =
    response.data || response.playlist || (response.uuid ? response : null);

  if (!playlistData) {
    console.error(
      "Tidal Playlist Error: No playlist data in response",
      response,
    );
    throw new Error("No se pudo cargar la playlist de Tidal");
  }

  // Ensure the playlistData has the best image possible
  if (
    !playlistData.image &&
    !playlistData.cover &&
    !playlistData.picture &&
    !playlistData.squareImage
  ) {
    playlistData.image =
      response.image ||
      response.cover ||
      response.picture ||
      response.squareImage;
  }

  // Convert tracks first so we can use their artwork as fallback
  const items =
    response.data?.items ?? response.items ?? playlistData.items ?? [];
  const tracks = items
    .map((entry: any) => entry.item || entry)
    .filter((item: any): item is TidalTrackApiResponse => !!item && !!item.id)
    .map((item: any) => normalizeArtistTrack(item));

  const playlist = normalizePlaylistItem(playlistData);

  // CRITICAL: If playlist still has no artwork, use the artwork from the first track
  if (!playlist.artworkUrl && tracks.length > 0 && tracks[0].artworkUrl) {
    playlist.artworkUrl = tracks[0].artworkUrl;
  }

  return { playlist, tracks };
}

export async function getTidalArtistInfo(
  artistId: number,
): Promise<TidalArtist> {
  const cacheKey = `artist-info:${getTidalCacheScope()}:${artistId}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      return await getDabBetaArtistInfo(artistId);
    }
    try {
      const response = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
      );

      const apiArtist = response.artist;
      if (!apiArtist) {
        throw new Error("Artista no encontrado");
      }

      const coverVariants = response.cover as
        | Record<string, string | undefined>
        | undefined;
      const artworkCandidate =
        coverVariants?.["750"] ||
        coverVariants?.["640"] ||
        coverVariants?.["480"];
      return {
        ...normalizeArtistItem(apiArtist),
        artworkUrl:
          (typeof artworkCandidate === "string" && artworkCandidate.startsWith("http")) 
            ? artworkCandidate 
            : getArtworkUrl(artworkCandidate || apiArtist.picture),
      };
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "No se pudo cargar el artista desde Tidal. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return await getDabBetaArtistInfo(artistId);
    }
  });
}

export async function getTidalArtistDetail(
  artistId: number,
  artistNameHint?: string,
): Promise<TidalArtistDetail> {
  const hintKey = artistNameHint?.trim().toLowerCase() || "none";
  const cacheKey = `artist-detail:${getTidalCacheScope()}:${artistId}:${hintKey}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    if (isSelectedDabSource()) {
      return await getDabBetaArtistDetail(artistId, artistNameHint);
    }
    try {
      const artistResponse = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
      );

      const apiArtist = artistResponse.artist;
      if (!apiArtist) {
        throw new Error("No se pudo cargar el artista de Tidal");
      }

      const artist: TidalArtist = {
        ...normalizeArtistItem(apiArtist),
        artworkUrl:
          artistResponse.cover?.["750"] ??
          getArtworkUrl(apiArtist.picture ?? undefined),
      };

      const queryTerm = artistNameHint?.trim() || artist.name;
      const [tracksByName, albumsByName] = await Promise.all([
        searchTidal(queryTerm),
        searchTidalAlbums(queryTerm),
      ]);

      const mergedTracksMap = new Map<number, TidalTrack>();
      tracksByName
        .filter(
          (track) =>
            track.artistId === artistId ||
            track.artist.toLowerCase() === artist.name.toLowerCase(),
        )
        .forEach((track) => mergedTracksMap.set(track.id, track));

      const mergedTracks = Array.from(mergedTracksMap.values());
      mergedTracks.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

      const albumsMap = new Map<number, TidalAlbum>();
      albumsByName
        .filter(
          (album) =>
            album.artistId === artistId ||
            album.artistName.toLowerCase() === artist.name.toLowerCase(),
        )
        .forEach((album) => albumsMap.set(album.id, album));

      extractAlbumsFromTracks(mergedTracks).forEach((album) => {
        if (!albumsMap.has(album.id)) albumsMap.set(album.id, album);
      });

      const albums = Array.from(albumsMap.values()).sort((a, b) => {
        const aDate = a.releaseDate ? Date.parse(a.releaseDate) : 0;
        const bDate = b.releaseDate ? Date.parse(b.releaseDate) : 0;
        return bDate - aDate || (b.year ?? 0) - (a.year ?? 0);
      });
      const topTracks = mergedTracks.slice(0, 25);

      return { artist, topTracks, albums };
    } catch (error) {
      if (
        !activateDabBetaRescue(
          "No se pudo cargar el artista desde Tidal. Cambiando a DAB de respaldo.",
        )
      ) {
        throw error;
      }

      return await getDabBetaArtistDetail(artistId, artistNameHint);
    }
  });
}

export async function getTidalTrackManifest(
  tidalId: number,
  quality: TidalQuality = "MP3",
  options: {
    ignoreManualMirror?: boolean;
    capability?: "stream" | "download";
  } = {},
): Promise<ParsedManifest> {
  const manifestQuality = quality === "MP3" ? "HIGH" : quality;
  const capability = options.capability ?? "stream";
  const formatParams = new URLSearchParams();
  if (manifestQuality === "HIGH") {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
  } else if (manifestQuality === "LOSSLESS") {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
    formatParams.append("formats", "FLAC");
  } else {
    formatParams.append("formats", "HEAACV1");
    formatParams.append("formats", "AACLC");
    formatParams.append("formats", "FLAC_HIRES");
    formatParams.append("formats", "FLAC");
  }

  const path = `/trackManifests/?id=${tidalId}&adaptive=true&manifestType=MPEG_DASH&uriScheme=HTTPS&usage=PLAYBACK&${formatParams.toString()}`;
  const { tidalMirror } = useSettingsStore.getState();
  const manualMirror =
    !options.ignoreManualMirror && tidalMirror && tidalMirror !== "auto"
      ? tidalMirror
      : null;
  const fallbackBases = manualMirror
    ? [manualMirror]
    : await getFallbackBases("streaming", capability);
  const startBaseIndex =
    fallbackBases.length > 0 ? currentBaseIndex % fallbackBases.length : 0;
  let lastError: Error | null = null;

  for (let i = 0; i < fallbackBases.length; i++) {
    const base = manualMirror ? manualMirror : fallbackBases[currentBaseIndex];

    try {
      const response = await fetchJsonWithMirror<TidalTrackManifestResponse>(
        path,
        REQUEST_TIMEOUT_MS,
        {
          ignoreManualMirror: true,
          category: "streaming",
          capability,
        },
      );

      const actualBase = manualMirror ? base : response.base;
      const attributes = response.data.data?.data?.attributes;
      if (!attributes) {
        throw new Error("Missing Tidal trackManifests payload");
      }

      if (attributes.trackPresentation === "PREVIEW") {
        const reason = attributes.previewReason ?? "UNKNOWN_PREVIEW_REASON";
        markTidalMirrorUnavailable(actualBase, 200);
        if (manualMirror) {
          throw new Error(
            `Track manifest only returned preview on ${actualBase} (${reason})`,
          );
        }

        console.warn(
          `[TidalService] Streaming mirror ${actualBase} returned preview (${reason}). Trying next...`,
        );
        currentBaseIndex = (currentBaseIndex + 1) % fallbackBases.length;
        if (currentBaseIndex === startBaseIndex) {
          lastError = new Error(
            `Track manifest only returned preview (${reason})`,
          );
          break;
        }
        continue;
      }

      if (!attributes.uri) {
        throw new Error("Missing trackManifests URI");
      }

      const { signal, cleanup } = withTimeoutSignal(REQUEST_TIMEOUT_MS);
      try {
        const manifestResponse = await fetch(attributes.uri, { signal });
        if (!manifestResponse.ok) {
          throw new Error(`Manifest fetch failed (${manifestResponse.status})`);
        }

        const manifestText = await manifestResponse.text();
        const trimmed = manifestText.trim();
        if (!trimmed) {
          throw new Error("Fetched manifest is empty");
        }

        if (trimmed.startsWith("<")) {
          const parsedDash = parseDashManifestForQuality(
            trimmed,
            manifestQuality,
          );

          return {
            urls: parsedDash.urls,
            quality: manifestQuality,
            mimeType: parsedDash.mimeType ?? "application/dash+xml",
            codecs: parsedDash.codecs,
            sampleRate: parsedDash.sampleRate,
            bitDepth: parsedDash.bitDepth,
            isSegmented: parsedDash.urls.length > 1,
            manifestUrl: attributes.uri,
          };
        }

        return {
          urls: [attributes.uri],
          quality: manifestQuality,
          mimeType: attributes.uri.includes(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : undefined,
          isSegmented: false,
          manifestUrl: attributes.uri,
        };
      } finally {
        cleanup();
      }
    } catch (error: any) {
      lastError = error;
      if (manualMirror) {
        throw error;
      }

      currentBaseIndex = (currentBaseIndex + 1) % fallbackBases.length;
      if (currentBaseIndex === startBaseIndex) {
        break;
      }
    }
  }

  throw (
    lastError || new Error("All streaming mirrors returned preview or failed")
  );
}

export async function downloadTidalTrack(
  tidalTrack: TidalTrack,
  targetQuality: TidalQuality = "MP3",
  options: DownloadOptions = {},
): Promise<Track> {
  const canUseDabRescue = shouldRescueWithDabBeta();
  const flacOnlyDownload = requiresFlacDownload(targetQuality);
  const downloadFromDabBeta = async (): Promise<Track> => {
    const baseFilename = getTrackBaseFilename(tidalTrack);
    const streamInfo = await getDabBetaStreamInfo(tidalTrack, targetQuality);
    if (flacOnlyDownload && streamInfo.extension !== "flac") {
      throw new Error(
        "La fuente actual no entrego FLAC. Cambia de mirror o intenta nuevamente.",
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
        "[TidalService] Failed to persist in public folder:",
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

  if (options.qobuzOnly) {
    return await downloadFromQobuz();
  }

  if (isSelectedDabSource()) {
    return await downloadFromDabBeta();
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
        return await downloadFromQobuz();
      } catch (qobuzError) {
        console.warn("[TidalService] Qobuz download fallback failed:", qobuzError);
      }
    }

    if (
      !activateDabBetaRescue(
        "Tidal no pudo entregar el audio. Cambiando a DAB de respaldo.",
      )
    ) {
      throw error;
    }

    return await downloadFromDabBeta();
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
        return await downloadFromQobuz();
      } catch (qobuzError) {
        console.warn("[TidalService] Qobuz direct-url fallback failed:", qobuzError);
      }
    }

    if (targetQuality === "HI_RES_LOSSLESS" && canUseDabRescue) {
      try {
        console.log(
          "[TidalService] Hi-Res direct download unavailable, retrying through DAB fallback.",
        );
        return await downloadFromDabBeta();
      } catch (dabError) {
        console.warn(
          "[TidalService] DAB fallback for Hi-Res failed:",
          dabError,
        );
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
    if (targetQuality === "HI_RES_LOSSLESS" && canUseDabRescue) {
      try {
        await FileSystem.deleteAsync(outputUri, { idempotent: true });
        console.log(
          "[TidalService] Invalid Hi-Res payload received, retrying through DAB fallback.",
        );
        return await downloadFromDabBeta();
      } catch (dabError) {
        console.warn(
          "[TidalService] DAB fallback after invalid Hi-Res payload failed:",
          dabError,
        );
      }
    }

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

function buildCloudStreamTrackFromStreamInfo(
  tidalTrack: TidalTrack,
  streamInfo: {
    url: string;
    extension: "flac" | "mp3";
    codec: string;
    quality: string;
    sampleRate?: number;
    bitDepth?: number;
  },
): Track {
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
    format: streamInfo.extension,
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
}

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
  const shouldPreferDabStream =
    isSelectedDabSource() || shouldRescueWithDabBeta();

  if (options.qobuzOnly || options.qobuzFallback) {
    try {
      const qobuzStream = await resolveQobuzStreamFromTrack(
        {
          title: tidalTrack.title,
          artist: tidalTrack.artist,
          album: tidalTrack.album,
        },
        preferredQuality,
      );
      if (qobuzStream?.url) {
        console.log("[TidalService] Qobuz stream resolved", {
          trackId: tidalTrack.id,
          quality: qobuzStream.quality,
          extension: qobuzStream.extension,
        });
        const formatMap: Record<string, string> = {
          flac: "FLAC",
          m4a: "AAC",
          mp3: "MP3",
        };
        return {
          id: `tidal_stream_${tidalTrack.id}`,
          uri: qobuzStream.url,
          title: tidalTrack.title,
          artist: tidalTrack.artist,
          artistId: tidalTrack.artistId ? String(tidalTrack.artistId) : undefined,
          album: tidalTrack.album,
          duration: tidalTrack.durationMs,
          artwork: tidalTrack.artworkUrl,
          trackNumber: tidalTrack.trackNumber,
          year: tidalTrack.year,
          format: formatMap[qobuzStream.extension] || "FLAC",
          codec: qobuzStream.codec,
          sampleRate: qobuzStream.sampleRate ?? tidalTrack.sampleRate,
          bitDepth: qobuzStream.bitDepth ?? tidalTrack.bitDepth,
          quality: qobuzStream.quality,
          source: "tidal_stream",
          tidalId: tidalTrack.id,
          tidalAlbumId: tidalTrack.albumId,
          dateAdded: Date.now(),
          cloudOnly: false,
        };
      }
    } catch (qobuzError) {
      console.warn("[TidalService] Qobuz stream fallback failed:", qobuzError);
    }

    if (options.qobuzOnly) {
      throw new Error("Qobuz no pudo resolver stream para esta pista.");
    }
  }

  if (shouldPreferDabStream) {
    try {
      const streamInfo = await getDabBetaStreamInfo(
        tidalTrack,
        preferredQuality,
      );
      return buildCloudStreamTrackFromStreamInfo(tidalTrack, streamInfo);
    } catch (dabError) {
      console.warn(
        "[TidalService] Preferred DAB stream failed, retrying via generic mirrors:",
        dabError,
      );

      let manifest: ParsedManifest;
      try {
        try {
          manifest = await getTidalTrackManifest(tidalTrack.id, preferredQuality, {
            ignoreManualMirror: true,
            capability: "stream",
          });
        } catch {
          manifest = await getTidalTrackManifest(tidalTrack.id, "LOSSLESS", {
            ignoreManualMirror: true,
            capability: "stream",
          });
        }
      } catch {
        manifest = await getTidalTrackManifest(tidalTrack.id, "HIGH", {
          ignoreManualMirror: true,
          capability: "stream",
        });
      }

      let streamUrl = getPlayableUrl(manifest);
      if (!streamUrl) {
        const fallbackManifest = await getTidalTrackManifest(
          tidalTrack.id,
          "HIGH",
          { ignoreManualMirror: true, capability: "stream" },
        );
        streamUrl = getPlayableUrl(fallbackManifest);
        manifest = fallbackManifest;
      }

      if (!streamUrl) {
        throw dabError instanceof Error
          ? dabError
          : new Error("No direct stream URL available for this track");
      }

      const enrichedTrack: TidalTrack = {
        ...tidalTrack,
        quality: manifest.quality ?? tidalTrack.quality,
        codec: manifest.codecs ?? tidalTrack.codec,
        sampleRate: manifest.sampleRate ?? tidalTrack.sampleRate,
        bitDepth: manifest.bitDepth ?? tidalTrack.bitDepth,
      };

      const extension = getExtensionFromMime(
        manifest.mimeType,
        manifest.codecs,
      );
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
        tidalId: enrichedTrack.id,
        tidalAlbumId: enrichedTrack.albumId,
        dateAdded: Date.now(),
        cloudOnly: false,
      };
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
    if (
      !activateDabBetaRescue(
        "Tidal no pudo abrir el stream. Cambiando a DAB de respaldo.",
      )
    ) {
      throw error;
    }

    const streamInfo = await getDabBetaStreamInfo(tidalTrack, "LOSSLESS");
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
      format: streamInfo.extension,
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

function decodeBase64ToBytes(base64Value: string): Uint8Array {
  const decoded = decodeBase64(base64Value);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function bytesIncludeAscii(bytes: Uint8Array, value: string): boolean {
  if (!value || bytes.length < value.length) return false;

  for (let offset = 0; offset <= bytes.length - value.length; offset++) {
    let matched = true;
    for (let index = 0; index < value.length; index++) {
      if (bytes[offset + index] !== value.charCodeAt(index)) {
        matched = false;
        break;
      }
    }

    if (matched) return true;
  }

  return false;
}

function hasIsoBmffHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;

  const knownBoxes = new Set([
    "ftyp",
    "styp",
    "moov",
    "moof",
    "mdat",
  ]);

  for (let offset = 0; offset <= bytes.length - 8; offset++) {
    const boxType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (knownBoxes.has(boxType)) {
      return true;
    }
  }

  return false;
}

function hasMp3FrameSync(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length - 1; index++) {
    if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) {
      return true;
    }
  }

  return false;
}

export async function isValidAudioFile(
  uri: string,
  extension: string,
): Promise<boolean> {
  try {
    const base64Prefix = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 96,
    } as never);

    const prefixBytes = decodeBase64ToBytes(base64Prefix);

    if (extension === "flac") {
      return bytesIncludeAscii(prefixBytes, "fLaC");
    }

    if (extension === "m4a") {
      return hasIsoBmffHeader(prefixBytes);
    }

    if (extension === "mp3") {
      return bytesIncludeAscii(prefixBytes, "ID3") || hasMp3FrameSync(prefixBytes);
    }

    return true; // fallback
  } catch {
    return false;
  }
}

export async function getTidalTrackRecommendations(
  trackId: number,
): Promise<TidalTrack[]> {
  try {
    const response = await fetchJson<TidalRecommendationsApiResponse>(
      `/recommendations/?id=${trackId}`,
      REQUEST_TIMEOUT_MS,
      isSelectedDabSource() ? { ignoreManualMirror: true } : undefined,
    );
    const items = response.items || response.data?.items || [];
    return items.map(normalizeSearchItem);
  } catch (error) {
    console.warn(
      `[TidalService] Failed to fetch track recommendations for ${trackId}:`,
      error,
    );
    return [];
  }
}

export async function getTidalSimilarArtists(
  artistId: number,
): Promise<TidalArtist[]> {
  try {
    const response = await fetchJson<TidalSimilarArtistsApiResponse>(
      `/artist/similar/?id=${artistId}`,
      REQUEST_TIMEOUT_MS,
      isSelectedDabSource() ? { ignoreManualMirror: true } : undefined,
    );
    const items =
      response.artists || response.data?.artists || response.items || [];
    // Use normalizeArtistItem to ensure consistent artwork URL generation
    return items.map(normalizeArtistItem);
  } catch (error) {
    console.warn(
      `[TidalService] Failed to fetch similar artists for ${artistId}:`,
      error,
    );
    return [];
  }
}

export async function getTidalSimilarAlbums(
  albumId: number,
): Promise<TidalAlbum[]> {
  try {
    const response = await fetchJson<TidalSimilarAlbumsApiResponse>(
      `/album/similar/?id=${albumId}`,
      REQUEST_TIMEOUT_MS,
      isSelectedDabSource() ? { ignoreManualMirror: true } : undefined,
    );
    const items =
      response.albums || response.data?.albums || response.items || [];
    // Use normalizeAlbumItem to ensure consistent artwork URL generation
    return items.map(normalizeAlbumItem);
  } catch (error) {
    console.warn(
      `[TidalService] Failed to fetch similar albums for ${albumId}:`,
      error,
    );
    return [];
  }
}

