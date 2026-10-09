/** Short-lived in-memory cache with request de-duplication for catalog reads. */
import { useSettingsStore } from "../../stores/settingsStore";

const tidalDataCache = new Map<string, { value: unknown; expiresAt: number }>();

const inflightTidalDataRequests = new Map<string, Promise<unknown>>();

export function getTidalCacheScope(): string {
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

export async function withTidalCache<T>(
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
