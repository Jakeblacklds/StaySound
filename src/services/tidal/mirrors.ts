/** Mirror roster, health checks and request rotation (stateful). */
import { MIRROR_HEALTH_CACHE_TTL_MS, MIRROR_HEALTH_TIMEOUT_MS, STATIC_GENERIC_STREAMING_BASES, STATIC_GENERIC_TIDAL_API_BASES, TIDAL_API_BASES, TIDAL_API_LEGACY_BASES, TIDAL_UPTIME_CATALOG_URLS } from "./constants";
import { buildCatalogFromRemotePayload, buildStaticMirrorCatalog, inferMirrorProvider, isReachableStatus } from "./mirrorPolicy";
import { withTimeoutSignal } from "./net";
import { DynamicMirrorCatalog, TidalMirrorAvailability, TidalMirrorCapability, TidalMirrorCatalogEntry, TidalMirrorCategory } from "./types";

/** Round-robin position shared by every request that walks the mirror list. */
export const mirrorRotation = { index: 0 };

const mirrorAvailabilityCache = new Map<string, TidalMirrorAvailability>();

const inflightMirrorChecks = new Map<
  string,
  Promise<TidalMirrorAvailability>
>();

let dynamicMirrorCatalogPromise: Promise<DynamicMirrorCatalog> | null = null;

let dynamicMirrorCatalogCache: DynamicMirrorCatalog | null = null;

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

export async function getFallbackBases(
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

export async function getCatalogEntryByBaseUrl(
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
