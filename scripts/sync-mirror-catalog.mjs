import fs from "node:fs";
import path from "node:path";

const SEARCH_TERM = "deadmau5";
const TIDAL_TRACK_ID = 31097949;
const SLOW_LATENCY_MS = 1800;

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_MIRROR_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL ||
  "";
const SUPABASE_ANON_KEY = (
  process.env.EXPO_PUBLIC_MIRROR_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY ||
  ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.MIRROR_SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const CAN_READ_CATALOG = Boolean(
  SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY),
);
const CAN_WRITE_CATALOG = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!CAN_READ_CATALOG) {
  throw new Error(
    "Missing Supabase mirror catalog credentials. Set EXPO_PUBLIC_MIRROR_SUPABASE_URL (or EXPO_PUBLIC_AUTH_SUPABASE_URL) and either MIRROR_SUPABASE_SERVICE_ROLE_KEY (write) or EXPO_PUBLIC_MIRROR_SUPABASE_ANON_KEY (read).",
  );
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function supabaseHeaders(token) {
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function supabaseReadHeaders() {
  return supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);
}

function supabaseWriteHeaders() {
  return supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY);
}

function jsonHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...extra,
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function request(url, init = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, init);
  const latencyMs = Date.now() - startedAt;
  return { response, latencyMs };
}

async function fetchMirrorRows() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/mirror_catalog?select=id,base_url,provider,enabled,priority,supports_search,supports_stream,supports_download,status,latency_ms,last_checked_at,last_error&order=priority.asc`,
    {
      method: "GET",
      headers: supabaseReadHeaders(),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to read mirror_catalog (${response.status}): ${body || "no body"}`,
    );
  }

  return await readJson(response);
}

async function updateMirrorRow(id, payload) {
  if (!CAN_WRITE_CATALOG) return;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/mirror_catalog?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseWriteHeaders(),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to update mirror ${id} (${response.status}): ${body}`);
  }
}

async function probeTidalSearch(baseUrl) {
  const { response, latencyMs } = await request(
    `${baseUrl}/search/?s=${encodeURIComponent(SEARCH_TERM)}`,
    { headers: jsonHeaders() },
  );
  const payload = await readJson(response).catch(() => null);
  const hasTracks = Array.isArray(payload?.data?.items);

  return {
    ok: response.ok && hasTracks,
    latencyMs,
    error: response.ok ? (hasTracks ? null : "Search JSON missing items") : `HTTP ${response.status}`,
  };
}

async function probeTidalTrackManifest(baseUrl) {
  const manifestParams =
    "adaptive=true&manifestType=MPEG_DASH&uriScheme=HTTPS&usage=PLAYBACK&formats=HEAACV1&formats=AACLC&formats=FLAC";
  const { response, latencyMs } = await request(
    `${baseUrl}/trackManifests/?id=${TIDAL_TRACK_ID}&${manifestParams}`,
    { headers: jsonHeaders() },
  );
  const payload = await readJson(response).catch(() => null);
  const attributes = payload?.data?.data?.attributes;

  if (!response.ok) {
    return {
      ok: false,
      latencyMs,
      error: `HTTP ${response.status}`,
    };
  }

  if (!attributes?.uri) {
    return {
      ok: false,
      latencyMs,
      error: "Missing manifest URI",
    };
  }

  if (attributes.trackPresentation === "PREVIEW") {
    return {
      ok: false,
      latencyMs,
      error: `Preview only (${attributes.previewReason || "UNKNOWN"})`,
    };
  }

  return {
    ok: true,
    latencyMs,
    error: null,
  };
}

function summarizeStatus(probes, latencyMs) {
  const successful = Object.values(probes).filter((probe) => probe.ok).length;
  if (successful === 0) {
    return "unavailable";
  }
  if (latencyMs > SLOW_LATENCY_MS || successful < Object.keys(probes).length) {
    return "slow";
  }
  return "available";
}

function computePriority(status, supports, latencyMs, fallback) {
  const capabilityPenalty =
    (supports.search ? 0 : 200) +
    (supports.stream ? 0 : 250) +
    (supports.download ? 0 : 300);
  const statusPenalty =
    status === "available" ? 0 : status === "slow" ? 1000 : 4000;
  const latencyPenalty = Math.min(Math.round(latencyMs || 2500), 2500);
  return statusPenalty + capabilityPenalty + latencyPenalty + fallback;
}

function collectChanges(previous, next) {
  const changes = [];
  if (previous.status !== next.status) {
    changes.push(`status ${previous.status} -> ${next.status}`);
  }
  if (previous.enabled !== next.enabled) {
    changes.push(`enabled ${previous.enabled} -> ${next.enabled}`);
  }
  if (previous.supports_search !== next.supports_search) {
    changes.push(`search ${previous.supports_search} -> ${next.supports_search}`);
  }
  if (previous.supports_stream !== next.supports_stream) {
    changes.push(`stream ${previous.supports_stream} -> ${next.supports_stream}`);
  }
  if (previous.supports_download !== next.supports_download) {
    changes.push(`download ${previous.supports_download} -> ${next.supports_download}`);
  }
  return changes;
}

async function evaluateMirror(row) {
  const baseUrl = normalizeBaseUrl(row.base_url);
  const fallbackPriority = Number.isFinite(row.priority) ? row.priority : 999;

  const [searchProbe, streamProbe] = await Promise.all([
    probeTidalSearch(baseUrl),
    probeTidalTrackManifest(baseUrl),
  ]);
  const supports = {
    search: searchProbe.ok,
    stream: streamProbe.ok,
    download: streamProbe.ok,
  };
  const latencyMs = Math.max(searchProbe.latencyMs, streamProbe.latencyMs);
  const status = summarizeStatus(
    { search: searchProbe, stream: streamProbe, download: streamProbe },
    latencyMs,
  );

  return {
    baseUrl,
    provider: row.provider,
    probes: { search: searchProbe, stream: streamProbe },
    supports,
    status,
    enabled: supports.search || supports.stream || supports.download,
    latencyMs,
    lastError: [searchProbe.error, streamProbe.error].filter(Boolean).join(" | ") || null,
    priority: computePriority(status, supports, latencyMs, fallbackPriority),
  };
}

function buildSummary(results, changes, writeMode) {
  const activeSearch = results.filter((item) => item.supports.search && item.enabled);
  const activeStream = results.filter((item) => item.supports.stream && item.enabled);
  const activeDownload = results.filter((item) => item.supports.download && item.enabled);
  const degraded = results.filter((item) => item.status === "slow");
  const disabled = results.filter((item) => !item.enabled || item.status === "unavailable");

  const lines = [
    "# Mirror catalog sync",
    "",
    "- Catalog probes are limited to Tidal/Monochrome-compatible mirrors.",
    writeMode
      ? "- Remote updates: enabled (service role key present)."
      : "- Remote updates: skipped (missing `MIRROR_SUPABASE_SERVICE_ROLE_KEY`).",
    `- Search active: ${activeSearch.map((item) => item.baseUrl).join(", ") || "none"}`,
    `- Stream active: ${activeStream.map((item) => item.baseUrl).join(", ") || "none"}`,
    `- Download active: ${activeDownload.map((item) => item.baseUrl).join(", ") || "none"}`,
    `- Degraded: ${degraded.map((item) => item.baseUrl).join(", ") || "none"}`,
    `- Disabled: ${disabled.map((item) => item.baseUrl).join(", ") || "none"}`,
    "",
    writeMode ? "## Changes" : "## Changes (dry run)",
  ];

  if (changes.length === 0) {
    lines.push("- No state changes detected.");
  } else {
    changes.forEach((change) => lines.push(`- ${change}`));
  }

  return lines.join("\n");
}

async function main() {
  const rows = await fetchMirrorRows();
  const results = [];
  const changes = [];

  for (const row of rows.filter((row) => !row.provider || row.provider === "tidal")) {
    const evaluated = await evaluateMirror(row);
    results.push(evaluated);

    const payload = {
      enabled: evaluated.enabled,
      priority: evaluated.priority,
      supports_search: evaluated.supports.search,
      supports_stream: evaluated.supports.stream,
      supports_download: evaluated.supports.download,
      status: evaluated.status,
      latency_ms: evaluated.latencyMs,
      last_checked_at: new Date().toISOString(),
      last_error: evaluated.lastError,
    };

    const rowChanges = collectChanges(row, payload);
    if (rowChanges.length > 0) {
      changes.push(`${evaluated.baseUrl}: ${rowChanges.join(", ")}`);
    }

    await updateMirrorRow(row.id, payload);
  }

  const summary = buildSummary(results, changes, CAN_WRITE_CATALOG);
  console.log(summary);
}

await main();
