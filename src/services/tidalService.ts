import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { useSettingsStore } from "../stores/settingsStore";
import {
  TidalAlbum,
  TidalAlbumDetail,
  TidalArtist,
  TidalArtistDetail,
  TidalCatalogSearch,
  TidalPlaylist,
  TidalPlaylistDetail,
  TidalQuality,
  TidalSearchResult,
  TidalTrack,
  Track,
} from "../types/audio";
import { FileSystemStorage } from "./storage";
import { dedupeAlbumVariants, rankCatalogSearch } from "./catalogRanking";
import { isValidAudioFile } from "../features/tidal/data/audioFileValidation";
import { parseDashManifestForQuality } from "../features/tidal/data/dashManifestParser";
import type {
  DownloadOptions,
  ParsedManifest,
  TidalAlbumApiResponse,
  TidalAlbumDetailApiResponse,
  TidalAlbumSearchApiResponse,
  TidalArtistApiResponse,
  TidalArtistDetailApiResponse,
  TidalArtistSearchApiResponse,
  TidalPlaylistApiResponse,
  TidalPlaylistSearchApiResponse,
  TidalSearchApiResponse,
  TidalSimilarAlbumsApiResponse,
  TidalSimilarArtistsApiResponse,
  TidalTrackApiResponse,
  TidalTrackManifestResponse,
} from "../features/tidal/data/tidalApiTypes";

export { isValidAudioFile };
type MirrorProvider = "tidal";

// Monochrome no longer maintains its old HiFi mirror roster. Its current
// client uses this public TIDAL application identity to obtain a short-lived
// catalog token, so use the same catalog route for searches.
const TIDAL_CATALOG_CLIENT_ID = "txNoH4kkV41MfH25";
const TIDAL_CATALOG_CLIENT_SECRET = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=";
let tidalCatalogToken: { value: string; expiresAt: number } | null = null;

export const TIDAL_API_BASES = [
  "https://hifi.geeked.wtf",
  "https://eu-central.monochrome.tf",
  "https://arran.monochrome.tf",
  "https://tidal.kinoplus.online",
  "https://api.monochrome.tf",
  "https://us-west.monochrome.tf",
  "https://monochrome-api.samidy.com",
  "https://wolf.qqdl.site",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://maus.qqdl.site",
  "https://vogel.qqdl.site",
];
const TIDAL_API_LEGACY_BASES: string[] = [];
const STATIC_GENERIC_TIDAL_API_BASES = TIDAL_API_BASES;
const STATIC_GENERIC_STREAMING_BASES = [
  "https://hifi.geeked.wtf",
  "https://arran.monochrome.tf",
  "https://vogel.qqdl.site",
  "https://maus.qqdl.site",
  "https://katze.qqdl.site",
  "https://hund.qqdl.site",
  "https://wolf.qqdl.site",
  "https://hifi.p1nkhamster.xyz",
];
const TIDAL_UPTIME_CATALOG_URLS = [
  // Monochrome's canonical uptime catalog (its INSTANCES_URLS). Listed first so StaySound
  // pulls the exact same live instance roster Monochrome publishes and auto-updates with
  // it. While Monochrome's custom-domain DNS record is unavailable this resolves to
  // NXDOMAIN (a fast, cached miss) and we fall through to the *.workers.dev mirrors below,
  // which are the same uptime workers serving fresh data.
  "https://tidal-uptime.geeked.wtf",
  "https://tidal-uptime.jiffy-puffs-1j.workers.dev/",
  "https://tidal-uptime.props-76styles.workers.dev/",
];

export const TIDAL_MIRROR_NAMES: Record<string, string> = {
  "https://hifi.geeked.wtf": "HiFi Geeked",
  "https://eu-central.monochrome.tf": "Monochrome EU Central",
  "https://arran.monochrome.tf": "Monochrome Arran",
  "https://tidal.kinoplus.online": "Kinoplus",
  "https://api.monochrome.tf": "Monochrome API",
  "https://us-west.monochrome.tf": "Monochrome US West",
  "https://monochrome-api.samidy.com": "Monochrome Samidy",
  "https://wolf.qqdl.site": "QQDL Wolf",
  "https://katze.qqdl.site": "QQDL Katze",
  "https://hund.qqdl.site": "QQDL Hund",
  "https://maus.qqdl.site": "QQDL Maus",
  "https://vogel.qqdl.site": "QQDL Vogel",
  "https://hifi.p1nkhamster.xyz": "HiFi P1nkhamster",
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
let dynamicMirrorCatalogPromise: Promise<DynamicMirrorCatalog> | null = null;
let dynamicMirrorCatalogCache: DynamicMirrorCatalog | null = null;
const SEARCH_CACHE_TTL_MS = 45 * 1000;
const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
const tidalDataCache = new Map<string, { value: unknown; expiresAt: number }>();
const inflightTidalDataRequests = new Map<string, Promise<unknown>>();


type PersistedPublicDownloadsPermission = {
  directoryUri: string;
};

import { sanitizeFilename as utilsSanitizeFilename } from "./audioUtils";
import { resolveAmazonMusicStreamFromTrack } from "./amazonMusicService";
import { resolveDeezerStreamFromTrack } from "./deezerFallbackService";
import { resolveQobuzStreamFromTrack } from "./qobuzKennyService";
import { resolveSaavnStreamFromTrack } from "./saavnFallbackService";

async function getTidalCatalogToken(): Promise<string> {
  if (tidalCatalogToken && tidalCatalogToken.expiresAt > Date.now()) return tidalCatalogToken.value;
  const credentials = btoa(`${TIDAL_CATALOG_CLIENT_ID}:${TIDAL_CATALOG_CLIENT_SECRET}`);
  const response = await fetch("https://auth.tidal.com/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${credentials}` },
    body: `client_id=${encodeURIComponent(TIDAL_CATALOG_CLIENT_ID)}&client_secret=${encodeURIComponent(TIDAL_CATALOG_CLIENT_SECRET)}&grant_type=client_credentials`,
  });
  if (!response.ok) throw new Error(`TIDAL catalog authentication failed (${response.status})`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("TIDAL catalog authentication returned no token");
  tidalCatalogToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000 };
  return tidalCatalogToken.value;
}

async function searchTidalCatalog<T>(kind: "tracks" | "artists" | "albums" | "playlists", query: string): Promise<{ items?: T[] }> {
  const token = await getTidalCatalogToken();
  const url = new URL(`https://api.tidal.com/v1/search/${kind}`);
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "50");
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`TIDAL catalog search failed (${response.status})`);
  return response.json() as Promise<{ items?: T[] }>;
}

/**
 * GET de solo lectura a la API oficial de catálogo de TIDAL con el token de
 * cliente ya cacheado. Es la fuente principal para búsqueda, artista y álbum:
 * los mirrors de Monochrome quedan solo como respaldo.
 */
async function tidalCatalogGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) tidalCatalogToken = null;
    const token = await getTidalCatalogToken();
    const url = new URL(`https://api.tidal.com/v1/${path}`);
    url.searchParams.set("countryCode", "US");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    // Un token revocado responde 401: se pide uno nuevo una sola vez.
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) throw new Error(`TIDAL catalog request failed (${response.status})`);
    return response.json() as Promise<T>;
  }
  throw new Error("TIDAL rejected the catalog token");
}

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
    base.includes("geeked.wtf") ||
    base.includes("kinoplus.online") ||
    base.includes("monochrome.tf") ||
    base.includes("monochrome-api.samidy.com") ||
    base.includes("qqdl.site") ||
    base.includes("hifi.monochrome.tf") ||
    base.includes("arran.monochrome.tf") ||
    base.includes("music.binimum.org")
  );
}

function getTidalCacheScope(): string {
  const { tidalMirror } = useSettingsStore.getState();
  return tidalMirror === "auto" ? "auto-generic" : tidalMirror;
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

function inferMirrorProvider(_baseUrl: string): MirrorProvider {
  return "tidal";
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
  const pinnedMirrors: string[] = [];

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


function withVersion(title: string, version?: string | null): string {
  const trimmed = version?.trim();
  if (!title || !trimmed || title.toLowerCase().includes(trimmed.toLowerCase())) return title;
  return `${title} (${trimmed})`;
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
    // "DtMF" y "DtMF (Live)" son canciones distintas, y Soulseek busca por título.
    title: withVersion(item.title, item.version),
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

function normalizeArtistMatchName(value?: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function getSearchBackedArtistDetail(
  artistId: number,
  artistNameHint?: string,
): Promise<TidalArtistDetail | null> {
  const queryTerm = artistNameHint?.trim();
  if (!queryTerm) return null;

  const [artistsResult, tracksResult, albumsResult] = await Promise.allSettled([
    searchTidalArtists(queryTerm),
    searchTidal(queryTerm),
    searchTidalAlbums(queryTerm),
  ]);

  const artistMatches =
    artistsResult.status === "fulfilled" ? artistsResult.value : [];
  const tracksByName =
    tracksResult.status === "fulfilled" ? tracksResult.value : [];
  const albumsByName =
    albumsResult.status === "fulfilled" ? albumsResult.value : [];

  const normalizedHint = normalizeArtistMatchName(queryTerm);
  const matchedArtist =
    artistMatches.find((artist) => artist.id === artistId) ??
    artistMatches.find(
      (artist) => normalizeArtistMatchName(artist.name) === normalizedHint,
    ) ??
    artistMatches[0];

  const artist: TidalArtist = matchedArtist
    ? { ...matchedArtist, id: matchedArtist.id || artistId }
    : { id: artistId, name: queryTerm };

  const artistNames = new Set(
    [queryTerm, artist.name]
      .map(normalizeArtistMatchName)
      .filter(Boolean),
  );

  const mergedTracksMap = new Map<number, TidalTrack>();
  tracksByName
    .filter(
      (track) =>
        track.artistId === artistId ||
        track.artistId === artist.id ||
        artistNames.has(normalizeArtistMatchName(track.artist)),
    )
    .forEach((track) => mergedTracksMap.set(track.id, track));

  const mergedTracks = Array.from(mergedTracksMap.values()).sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
  );

  const albumsMap = new Map<number, TidalAlbum>();
  albumsByName
    .filter(
      (album) =>
        album.artistId === artistId ||
        album.artistId === artist.id ||
        artistNames.has(normalizeArtistMatchName(album.artistName)),
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

  return {
    artist,
    topTracks: mergedTracks.slice(0, 25),
    albums,
  };
}

function normalizeAlbumItem(item: TidalAlbumApiResponse): TidalAlbum {
  return {
    id: item.id,
    title: withVersion(item.title, item.version),
    type: item.type,
    popularity: item.popularity,
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
    let response: TidalSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalTrackApiResponse>("tracks", trimmed);
      response = { data: { items: catalog.items ?? [] } };
    } catch {
      response = await fetchJson<TidalSearchApiResponse>(`/search/?s=${encodeURIComponent(trimmed)}`);
    }

    return (response.data?.items ?? []).map(normalizeSearchItem);
  });
}

export async function searchTidalArtists(
  query: string,
): Promise<TidalArtist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `artists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalArtistSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalArtistApiResponse>("artists", trimmed);
      response = { data: { artists: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalArtistSearchApiResponse>(`/search/?a=${encodeURIComponent(trimmed)}`);
    }

    const artistItems =
      response.data?.artists?.items ?? response.data?.items ?? [];
    return artistItems.map(normalizeArtistItem);
  });
}

export async function searchTidalPlaylists(
  query: string,
): Promise<TidalPlaylist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `playlists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalPlaylistSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalPlaylistApiResponse>("playlists", trimmed);
      response = { data: { playlists: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalPlaylistSearchApiResponse>(`/search/?p=${encodeURIComponent(trimmed)}`);
    }

    const playlistItems =
      response.data?.playlists?.items ?? response.data?.items ?? [];
    return playlistItems.map(normalizePlaylistItem);
  });
}

export async function searchTidalAlbums(query: string): Promise<TidalAlbum[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `albums:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalAlbumSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalAlbumApiResponse>("albums", trimmed);
      response = { data: { albums: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalAlbumSearchApiResponse>(`/search/?al=${encodeURIComponent(trimmed)}`);
    }

    const albumItems =
      response.data?.albums?.items ?? response.data?.items ?? [];
    return albumItems.map(normalizeAlbumItem);
  });
}

type TidalPagedApiResponse<T> = { items?: T[]; totalNumberOfItems?: number };
type TidalUnifiedSearchApiResponse = {
  artists?: { items?: TidalArtistApiResponse[] };
  albums?: { items?: TidalAlbumApiResponse[] };
  tracks?: { items?: TidalTrackApiResponse[] };
  topHit?: { type?: string; value?: TidalArtistApiResponse & TidalAlbumApiResponse & TidalTrackApiResponse };
};

function normalizeTopHit(hit: TidalUnifiedSearchApiResponse["topHit"]): TidalCatalogSearch["top"] {
  if (!hit?.value?.id) return null;
  if (hit.type === "ARTISTS" && hit.value.name) return { kind: "artist", artist: normalizeArtistItem(hit.value) };
  if (hit.type === "TRACKS" && hit.value.title) return { kind: "track", track: normalizeSearchItem(hit.value) };
  if (hit.type === "ALBUMS" && hit.value.title) return { kind: "album", album: normalizeAlbumItem(hit.value) };
  return null;
}

/**
 * Búsqueda estilo Spotify: canciones, artistas y álbumes en una sola petición,
 * ordenados por relevancia (catalogRanking.ts, el mismo ranking de escritorio)
 * y con un "mejor resultado" que puede ser de cualquiera de los tres tipos.
 * Si la API oficial falla se cae a los mirrors, con el mismo ranking.
 */
export async function searchTidalCatalogAll(query: string): Promise<TidalCatalogSearch> {
  const trimmed = query.trim();
  if (!trimmed) return { tracks: [], albums: [], artists: [], top: null };
  const cacheKey = `all:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let ranked: TidalCatalogSearch;
    try {
      const payload = await tidalCatalogGet<TidalUnifiedSearchApiResponse>("search", {
        query: trimmed, types: "ARTISTS,ALBUMS,TRACKS", limit: 30,
      });
      ranked = rankCatalogSearch(trimmed, {
        tracks: uniqueById((payload.tracks?.items ?? []).map(normalizeSearchItem)),
        albums: (payload.albums?.items ?? []).map(normalizeAlbumItem),
        artists: (payload.artists?.items ?? []).map(normalizeArtistItem),
      }, normalizeTopHit(payload.topHit));
    } catch {
      const [tracks, albums, artists] = await Promise.allSettled([
        searchTidal(trimmed), searchTidalAlbums(trimmed), searchTidalArtists(trimmed),
      ]);
      if (tracks.status === "rejected" && albums.status === "rejected" && artists.status === "rejected") {
        throw tracks.reason instanceof Error ? tracks.reason : new Error("No se pudo consultar el catálogo.");
      }
      const trackList = tracks.status === "fulfilled" ? tracks.value : [];
      ranked = rankCatalogSearch(trimmed, {
        tracks: trackList,
        albums: albums.status === "fulfilled" ? albums.value : extractAlbumsFromTracks(trackList),
        artists: artists.status === "fulfilled" ? artists.value : [],
      });
    }

    // Si lo buscado es un artista, "Canciones" debe ser lo suyo más escuchado
    // y no las colaboraciones donde solo aparece.
    const top = ranked.top;
    if (top?.kind === "artist") {
      const own = ranked.tracks.slice(0, 4).filter(track => track.artistId === top.artist.id).length;
      if (own < 4) {
        const topTracks = await tidalCatalogGet<TidalPagedApiResponse<TidalTrackApiResponse>>(
          `artists/${top.artist.id}/toptracks`, { limit: 6 },
        ).then(result => (result.items ?? []).map(normalizeSearchItem)).catch(() => [] as TidalTrack[]);
        const ids = new Set(topTracks.map(track => track.id));
        ranked = { ...ranked, tracks: [...topTracks, ...ranked.tracks.filter(track => !ids.has(track.id))] };
      }
    }
    return ranked;
  });
}

function uniqueById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

function byReleaseDesc(a: TidalAlbum, b: TidalAlbum): number {
  const aDate = a.releaseDate ? Date.parse(a.releaseDate) : 0;
  const bDate = b.releaseDate ? Date.parse(b.releaseDate) : 0;
  return bDate - aDate || (b.year ?? 0) - (a.year ?? 0);
}

async function getCatalogArtistDetail(artistId: number): Promise<TidalArtistDetail> {
  const [artistResult, topResult, albumResult, singleResult] = await Promise.allSettled([
    tidalCatalogGet<TidalArtistApiResponse>(`artists/${artistId}`),
    tidalCatalogGet<TidalPagedApiResponse<TidalTrackApiResponse>>(`artists/${artistId}/toptracks`, { limit: 25 }),
    tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { limit: 50 }),
    tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { filter: "EPSANDSINGLES", limit: 50 }),
  ]);
  if (artistResult.status === "rejected" || !artistResult.value?.name) {
    throw artistResult.status === "rejected" ? artistResult.reason : new Error("Artista no encontrado");
  }
  const artist = normalizeArtistItem(artistResult.value);
  const items = <T,>(result: PromiseSettledResult<TidalPagedApiResponse<T>>): T[] =>
    result.status === "fulfilled" ? result.value.items ?? [] : [];
  const releases = dedupeAlbumVariants([...items(albumResult), ...items(singleResult)].map(normalizeAlbumItem))
    .sort(byReleaseDesc);
  return {
    artist,
    topTracks: uniqueById(items(topResult).map(item => normalizeArtistTrack(item, artist))),
    albums: releases.filter(album => album.type !== "SINGLE" && album.type !== "EP"),
    singles: releases.filter(album => album.type === "SINGLE" || album.type === "EP"),
  };
}

async function getCatalogAlbumDetail(albumId: number): Promise<TidalAlbumDetail> {
  const [albumPayload, itemsPayload] = await Promise.all([
    tidalCatalogGet<TidalAlbumApiResponse>(`albums/${albumId}`),
    tidalCatalogGet<TidalPagedApiResponse<{ item?: TidalTrackApiResponse; type?: string }>>(`albums/${albumId}/items`, { limit: 100 }),
  ]);
  const album = normalizeAlbumItem(albumPayload);
  const fallbackArtist = album.artistId ? { id: album.artistId, name: album.artistName } : undefined;
  const entries = (itemsPayload.items ?? [])
    // Los álbumes pueden traer videoclips intercalados.
    .filter(entry => !entry.type || entry.type === "track")
    .map(entry => entry.item)
    .filter((item): item is TidalTrackApiResponse => !!item)
    .sort((a, b) => ((a.volumeNumber ?? 1) - (b.volumeNumber ?? 1)) || ((a.trackNumber ?? 9999) - (b.trackNumber ?? 9999)));
  const tracks = entries.map(item => {
    const track = normalizeArtistTrack(item, fallbackArtist);
    // El endpoint de álbum no siempre repite portada ni álbum en cada pista.
    return {
      ...track,
      album: track.album && track.album !== "Unknown Album" ? track.album : album.title,
      albumId: track.albumId ?? album.id,
      artworkUrl: track.artworkUrl ?? album.artworkUrl,
      coverUuid: track.coverUuid ?? albumPayload.cover ?? null,
    };
  });
  return { album: { ...album, numberOfTracks: album.numberOfTracks ?? tracks.length }, tracks };
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
    try {
      return await getCatalogAlbumDetail(albumId);
    } catch (error) {
      console.warn(`[TidalService] Catalog album ${albumId} failed; trying mirrors.`, error);
    }
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
  artistNameHint?: string,
): Promise<TidalArtist> {
  const hintKey = artistNameHint?.trim().toLowerCase() || "none";
  const cacheKey = `artist-info:${getTidalCacheScope()}:${artistId}:${hintKey}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    try {
      const catalogArtist = await tidalCatalogGet<TidalArtistApiResponse>(`artists/${artistId}`);
      if (catalogArtist?.name) return normalizeArtistItem(catalogArtist);
    } catch {
      // Los mirrors siguen como respaldo.
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
      const fallbackDetail = await getSearchBackedArtistDetail(
        artistId,
        artistNameHint,
      );
      if (fallbackDetail) {
        console.warn(
          `[TidalService] Artist info endpoint failed for ${artistId}; using search-backed artist.`,
          error,
        );
        return fallbackDetail.artist;
      }
      throw error;
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
    try {
      // Top tracks y discografía reales (álbumes y sencillos por separado); la
      // reconstrucción por nombre de abajo queda como respaldo.
      return await getCatalogArtistDetail(artistId);
    } catch (error) {
      console.warn(`[TidalService] Catalog artist ${artistId} failed; trying mirrors.`, error);
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
      const fallbackDetail = await getSearchBackedArtistDetail(
        artistId,
        artistNameHint,
      );
      if (fallbackDetail) {
        console.warn(
          `[TidalService] Artist detail endpoint failed for ${artistId}; using search-backed detail.`,
          error,
        );
        return fallbackDetail;
      }
      throw error;
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

export async function getTidalSimilarArtists(
  artistId: number,
): Promise<TidalArtist[]> {
  try {
    const catalog = await tidalCatalogGet<TidalPagedApiResponse<TidalArtistApiResponse>>(
      `artists/${artistId}/similar`, { limit: 12 },
    );
    const similar = (catalog.items ?? []).filter(item => item.id !== artistId).map(normalizeArtistItem);
    if (similar.length) return similar;
  } catch {
    // Los mirrors siguen como respaldo.
  }
  try {
    const response = await fetchJson<TidalSimilarArtistsApiResponse>(
      `/artist/similar/?id=${artistId}`,
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
  // "Más de este artista": el resto de su discografía desde la API de catálogo
  // (el endpoint de álbumes similares solo existe en los mirrors).
  try {
    const album = await tidalCatalogGet<TidalAlbumApiResponse>(`albums/${albumId}`);
    const artistId = album.artist?.id ?? album.artists?.[0]?.id;
    if (artistId) {
      const own = normalizeAlbumItem(album);
      const [albums, singles] = await Promise.allSettled([
        tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { limit: 50 }),
        tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { filter: "EPSANDSINGLES", limit: 20 }),
      ]);
      const releases = [albums, singles]
        .flatMap(result => (result.status === "fulfilled" ? result.value.items ?? [] : []))
        .map(normalizeAlbumItem);
      const others = dedupeAlbumVariants([own, ...releases])
        .filter(candidate => candidate.id !== albumId && candidate.title !== own.title);
      if (others.length) return others;
    }
  } catch {
    // Los mirrors siguen como respaldo.
  }
  try {
    const response = await fetchJson<TidalSimilarAlbumsApiResponse>(
      `/album/similar/?id=${albumId}`,
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
