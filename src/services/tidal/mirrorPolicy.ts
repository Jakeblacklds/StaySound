/** Pure mirror rules: which responses trigger a fallback, and how the mirror catalog is built and merged. */
import { STATIC_GENERIC_STREAMING_BASES, STATIC_GENERIC_TIDAL_API_BASES } from "./constants";
import { DynamicMirrorCatalog, MirrorProvider, TidalMirrorCapability, TidalMirrorCatalogEntry, TidalMirrorCategory } from "./types";

export function isReachableStatus(status: number): boolean {
  return (
    status < 500 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 405
  );
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

export function shouldFallbackFromResponse(
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

export function isHtmlResponse(contentType: string | null, body: string): boolean {
  const normalizedType = (contentType ?? "").toLowerCase();
  const trimmed = body.trimStart();
  return (
    normalizedType.includes("text/html") ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html")
  );
}

export function inferMirrorProvider(_baseUrl: string): MirrorProvider {
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

export function normalizeCatalogUrl(value: unknown): string | null {
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

export function buildCatalogFromRemotePayload(payload: unknown): DynamicMirrorCatalog | null {
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

export function buildStaticMirrorCatalog(): DynamicMirrorCatalog {
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

export function isCapabilitySupported(
  entry: TidalMirrorCatalogEntry | null,
  capability: TidalMirrorCapability,
): boolean {
  if (!entry) return true;
  if (capability === "stream") return entry.supportsStream;
  if (capability === "download") return entry.supportsDownload;
  return entry.supportsSearch;
}

export function capabilityErrorMessage(capability: TidalMirrorCapability): string {
  if (capability === "download") {
    return "El mirror seleccionado no soporta descargas en este momento.";
  }

  if (capability === "stream") {
    return "El mirror seleccionado no soporta reproduccion en este momento.";
  }

  return "El mirror seleccionado no soporta busqueda y metadata en este momento.";
}
