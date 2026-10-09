/** Requests to the official TIDAL catalog API and to the mirrors, with fallback. */
import { useSettingsStore } from "../../stores/settingsStore";
import { REQUEST_TIMEOUT_MS, TIDAL_CATALOG_CLIENT_ID, TIDAL_CATALOG_CLIENT_SECRET } from "./constants";
import { capabilityErrorMessage, isCapabilitySupported, shouldFallbackFromResponse } from "./mirrorPolicy";
import { getCatalogEntryByBaseUrl, getFallbackBases, markTidalMirrorUnavailable, mirrorRotation } from "./mirrors";
import { parseJsonResponse, withTimeoutSignal } from "./net";
import { MirrorJsonResult, TidalMirrorCapability, TidalMirrorCategory } from "./types";

let tidalCatalogToken: { value: string; expiresAt: number } | null = null;

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

export async function searchTidalCatalog<T>(kind: "tracks" | "artists" | "albums" | "playlists", query: string): Promise<{ items?: T[] }> {
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
export async function tidalCatalogGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
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

/** Same mirror walk as [fetchJsonWithMirror], for callers that do not care which mirror answered. */
export async function fetchJson<T>(
  path: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  options: MirrorRequestOptions = {},
): Promise<T> {
  return (await fetchJsonWithMirror<T>(path, timeoutMs, options)).data;
}

export type MirrorRequestOptions = {
  ignoreManualMirror?: boolean;
  category?: TidalMirrorCategory;
  capability?: TidalMirrorCapability;
};

export async function fetchJsonWithMirror<T>(
  path: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  options: MirrorRequestOptions = {},
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

  const startBaseIndex = mirrorRotation.index % fallbackBases.length;

  for (let i = 0; i < fallbackBases.length; i++) {
    const base = fallbackBases[mirrorRotation.index % fallbackBases.length];
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
      mirrorRotation.index = (mirrorRotation.index + 1) % fallbackBases.length;
      if (mirrorRotation.index === startBaseIndex) break;
    } finally {
      cleanup();
    }
  }

  throw lastError || new Error("All Tidal mirrors failed");
}
