import { assertMirrorCatalogConfig } from './mirrorCatalogConfig';

export type MirrorProvider = 'tidal' | 'dab';
export type MirrorStatus = 'available' | 'slow' | 'unavailable';

export type RemoteMirrorCatalogEntry = {
    baseUrl: string;
    provider: MirrorProvider;
    enabled: boolean;
    priority: number;
    supportsSearch: boolean;
    supportsStream: boolean;
    supportsDownload: boolean;
    status: MirrorStatus;
    latencyMs?: number;
    lastCheckedAt?: number;
    lastError?: string | null;
};

type MirrorCatalogRow = {
    base_url?: string;
    provider?: string;
    enabled?: boolean;
    priority?: number;
    supports_search?: boolean;
    supports_stream?: boolean;
    supports_download?: boolean;
    status?: string;
    latency_ms?: number | null;
    last_checked_at?: string | null;
    last_error?: string | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let remoteCatalogCache: { fetchedAt: number; entries: RemoteMirrorCatalogEntry[] } | null = null;
let inflightCatalogRequest: Promise<RemoteMirrorCatalogEntry[]> | null = null;

function createHeaders() {
    const { anonKey } = assertMirrorCatalogConfig();
    return {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
    };
}

function normalizeStatus(status: string | undefined): MirrorStatus {
    if (status === 'slow' || status === 'unavailable') {
        return status;
    }

    return 'available';
}

function toMillis(value?: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRow(row: MirrorCatalogRow): RemoteMirrorCatalogEntry | null {
    const baseUrl = typeof row.base_url === 'string' ? row.base_url.trim().replace(/\/+$/, '') : '';
    if (!baseUrl) return null;

    return {
        baseUrl,
        provider: row.provider === 'dab' ? 'dab' : 'tidal',
        enabled: row.enabled !== false,
        priority: Number.isFinite(row.priority) ? Number(row.priority) : 999,
        supportsSearch: row.supports_search !== false,
        supportsStream: row.supports_stream !== false,
        supportsDownload: row.supports_download !== false,
        status: normalizeStatus(typeof row.status === 'string' ? row.status : undefined),
        latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : undefined,
        lastCheckedAt: toMillis(row.last_checked_at),
        lastError: typeof row.last_error === 'string' ? row.last_error : null,
    };
}

async function requestRemoteCatalog(): Promise<RemoteMirrorCatalogEntry[]> {
    const { url } = assertMirrorCatalogConfig();
    const columns = 'base_url,provider,enabled,priority,supports_search,supports_stream,supports_download,status,latency_ms,last_checked_at,last_error';
    const endpoints = [
        `${url}/rest/v1/mirror_catalog_public?select=${columns}`,
        `${url}/rest/v1/mirror_catalog?select=${columns}&enabled=eq.true`,
    ];

    let lastError: Error | null = null;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: createHeaders(),
            });

            if (response.ok) {
                const payload = await response.json() as MirrorCatalogRow[];
                return payload
                    .map(normalizeRow)
                    .filter((entry): entry is RemoteMirrorCatalogEntry => Boolean(entry))
                    .sort((left, right) => left.priority - right.priority);
            }

            if (response.status !== 404) {
                throw new Error(`Mirror catalog request failed (${response.status}) at ${endpoint}`);
            }
        } catch (error: any) {
            lastError = error;
            console.warn(`[MirrorCatalogService] Attempt failed at ${endpoint}: ${error.message}`);
        }
    }

    throw lastError || new Error('Mirror catalog request failed');
}

export async function getRemoteMirrorCatalog(options: { force?: boolean } = {}): Promise<RemoteMirrorCatalogEntry[]> {
    const cached = remoteCatalogCache;
    if (!options.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.entries;
    }

    if (inflightCatalogRequest) {
        return inflightCatalogRequest;
    }

    inflightCatalogRequest = requestRemoteCatalog()
        .then((entries) => {
            remoteCatalogCache = {
                fetchedAt: Date.now(),
                entries,
            };
            return entries;
        })
        .finally(() => {
            inflightCatalogRequest = null;
        });

    return inflightCatalogRequest;
}

export function clearRemoteMirrorCatalogCache() {
    remoteCatalogCache = null;
}
