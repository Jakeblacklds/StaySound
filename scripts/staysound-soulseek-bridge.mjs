#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import slsk from 'slsk-client';
import { isLosslessResult, rankSoulseekResults } from './lib/soulseek-result-ranking.mjs';
import { createSearchRecovery } from './lib/soulseek-search-recovery.mjs';

const PORT = Number.parseInt(process.env.STAYSOUND_SOULSEEK_BRIDGE_PORT ?? '4317', 10);
const HOST = process.env.STAYSOUND_SOULSEEK_BRIDGE_HOST ?? '127.0.0.1';
const DEFAULT_USERNAME = process.env.SOULSEEK_USERNAME ?? process.env.SOULSEEK_USER ?? process.env.SLSK_USER ?? '';
const DEFAULT_PASSWORD = process.env.SOULSEEK_PASSWORD ?? process.env.SOULSEEK_PASS ?? process.env.SLSK_PASS ?? '';
const DOWNLOAD_DIR = process.env.SOULSEEK_DOWNLOAD_DIR
  ?? path.join(os.homedir(), 'Music', 'StaySound', 'SoulseekBridge');
const PROXY_ALLOWED_HOSTS = [
  /\.monochrome\.tf$/i,
  /\.geeked\.wtf$/i,
  /\.qqdl\.site$/i,
  /\.kennyy\.com\.br$/i,
  /\.scavengerfurs\.net$/i,
  /\.tabs-vs-spaces\.wtf$/i,
  /\.binimum\.org$/i,
  /\.tidal\.com$/i,
  /\.kinoplus\.online$/i,
  /\.jiosaavn\.com$/i,
  /\.saavncdn\.com$/i,
  /\.rhythmax\.workers\.dev$/i,
  /\.vercel\.app$/i,
  /^qdl-api\.monochrome\.tf$/i,
  /^mono\.scavengerfurs\.net$/i,
  /^qobuz\.kennyy\.com\.br$/i,
  /^dzr\.tabs-vs-spaces\.wtf$/i,
  /^amz\.geeked\.wtf$/i,
  /^js-odskyler\.vercel\.app$/i,
  /^sda\.rhythmax\.workers\.dev$/i,
];

const files = new Map();
/** In-flight download jobs (jobId → job) for the progress API. */
const jobs = new Map();
const JOB_RETENTION_MS = 30 * 60 * 1000;
const PEER_TRANSFER_RETRY_LIMIT = 1;
const SESSION_CONNECT_COOLDOWN_MS = Math.max(
  5_000,
  Number.parseInt(process.env.SOULSEEK_CONNECT_COOLDOWN_MS ?? '30000', 10),
);
const SESSION_LOGIN_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.SOULSEEK_LOGIN_TIMEOUT_MS ?? '8000', 10),
);
// The Soulseek server bans accounts and IPs that log in or search in bursts.
// Every login and search from the desktop app goes through this process, so
// the limits below are the single place where StaySound stays polite.
const SESSION_CONNECT_MAX_COOLDOWN_MS = 30 * 60 * 1000;
const MIN_LOGIN_GAP_MS = 15_000;
const SEARCH_MIN_GAP_MS = Math.max(
  1_000,
  Number.parseInt(process.env.SOULSEEK_SEARCH_MIN_GAP_MS ?? '4000', 10),
);
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 200;
let clientPromise = null;
let connectedClient = null;
let activeCredentials = null;
let reconnectNotBefore = 0;
let consecutiveConnectFailures = 0;
let lastLoginAttemptAt = 0;
let lastConnectError = null;
let searchQueue = Promise.resolve();
let lastSearchAt = 0;
/** normalized query → { expiresAt, promise } */
const searchCache = new Map();
// Liveness: a login whose route died silently (Mac asleep, router/NAT
// timeout) still looks connected, and searches sent into it just come back
// empty. These track the server's silence and our heartbeat.
const QUIET_PROBE_MS = 45_000;
const HEARTBEAT_QUIET_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const RELOGGED_COOLDOWN_MS = 2 * 60 * 1000;
let lastCredentials = null;
let heartbeatSentAt = 0;
/** Diagnostics of the last network search, exposed on /health. */
let lastSearch = null;
const searchWithRecovery = createSearchRecovery();
let lastSearchRecoveryAt = null;
let runtimeShareDirs = (process.env.SOULSEEK_SHARED_DIRS ?? process.env.SOULSEEK_SHARED_DIR ?? '')
  .split(path.delimiter)
  .map(folder => folder.trim())
  .filter(Boolean);

function json(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function text(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(payload);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sanitizeFileSegment(value) {
  return String(value || 'track')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'track';
}

function extensionFromFilename(filename) {
  return path.extname(filename.replaceAll('\\', '/')).replace(/^\./, '').toLowerCase() || 'mp3';
}

function mimeFromExtension(extension) {
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
  return 'audio/mpeg';
}

function isProxyAllowed(targetUrl) {
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') return false;
  return PROXY_ALLOWED_HOSTS.some(pattern => pattern.test(targetUrl.hostname));
}

async function proxyRequest(request, response, target) {
  const targetUrl = new URL(target);
  if (!isProxyAllowed(targetUrl)) {
    json(response, 403, { error: 'proxy target no permitido' });
    return;
  }

  const headers = { 'Accept-Encoding': 'identity' };
  const range = request.headers.range;
  if (range) headers.Range = range;
  const upstream = await fetch(targetUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  });

  const outputHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
  };
  const encoded = Boolean(upstream.headers.get('content-encoding'));
  for (const key of ['content-type', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(key);
    if (value) outputHeaders[key] = value;
  }
  const contentLength = upstream.headers.get('content-length');
  if (contentLength && !encoded) outputHeaders['content-length'] = contentLength;

  response.writeHead(upstream.status, outputHeaders);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
  } finally {
    response.end();
  }
}

function normalizeResult(result) {
  const filename = result.file ?? result.filename ?? '';
  const username = result.user ?? result.username ?? '';
  const extension = extensionFromFilename(filename);
  const idSeed = `${username}|${filename}|${result.size ?? 0}`;
  let hash = 0;
  for (const char of idSeed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;

  return {
    id: `slsk_${Math.abs(hash) || Date.now()}`,
    username,
    filename,
    size: Number.isFinite(result.size) ? result.size : undefined,
    extension,
    bitRate: Number.isFinite(result.bitrate) ? result.bitrate : undefined,
    speed: Number.isFinite(result.speed) ? result.speed : undefined,
    slots: Boolean(result.slots),
  };
}

function normalizeCredentials(credentials = {}) {
  return {
    username: String(credentials.username ?? DEFAULT_USERNAME).trim(),
    password: String(credentials.password ?? DEFAULT_PASSWORD).trim(),
  };
}

function ensureCredentials(credentials) {
  const normalized = normalizeCredentials(credentials);
  if (!normalized.username || !normalized.password) {
    throw new Error('Inicia sesion en Soulseek con usuario y password.');
  }
  return normalized;
}

function sameCredentials(left, right) {
  return Boolean(left && right && left.username === right.username && left.password === right.password);
}

async function resetClient(expectedClient = null) {
  const pendingClient = clientPromise;
  if (!pendingClient) return false;

  const client = await pendingClient.catch(() => null);
  // Do not let an older failed request tear down a replacement session that
  // another request already established in the meantime.
  if (clientPromise !== pendingClient || (expectedClient && client !== expectedClient)) {
    return false;
  }

  clientPromise = null;
  connectedClient = null;
  activeCredentials = null;
  try {
    client?.destroy?.();
  } catch {
    // The session is already unusable; cleanup is best effort.
  }
  return true;
}

function requestedShareFolders() {
  const requested = process.env.SOULSEEK_SHARE_DOWNLOADS === '0'
    ? [...runtimeShareDirs]
    : [DOWNLOAD_DIR, ...runtimeShareDirs];
  const unique = [...new Set(requested.map(folder => path.resolve(folder)))];
  return unique.filter((folder, index, all) => !all.some((parent, parentIndex) => (
    parentIndex !== index && folder.startsWith(`${parent}${path.sep}`)
  )));
}

function validateShareDirectories(directories) {
  const home = path.resolve(os.homedir());
  const root = path.parse(home).root;
  return [...new Set((directories ?? []).map(folder => path.resolve(String(folder))))].map(folder => {
    if (folder === root || folder === home) {
      throw new Error('Por seguridad, selecciona una carpeta de música específica; no se puede compartir todo el disco o tu carpeta personal.');
    }
    const stat = fs.statSync(folder);
    if (!stat.isDirectory()) throw new Error(`La ruta compartida no es una carpeta: ${folder}`);
    return folder;
  });
}

function connectClient(credentials) {
  const sharedFolders = requestedShareFolders();

  return new Promise((resolve, reject) => {
    slsk.connect({
      user: credentials.username,
      pass: credentials.password,
      host: process.env.SOULSEEK_SERVER_HOST || 'server.slsknet.org',
      port: Number.parseInt(process.env.SOULSEEK_SERVER_PORT ?? '2242', 10),
      incomingPort: Number.parseInt(process.env.SOULSEEK_LISTEN_PORT ?? '2234', 10),
      uploadSlots: Number.parseInt(process.env.SOULSEEK_UPLOAD_SLOTS ?? '2', 10),
      timeout: SESSION_LOGIN_TIMEOUT_MS,
      // StaySound only re-shares its own completed Soulseek downloads by
      // default. It never exposes the user's broader music library.
      sharedFolders,
    }, (error, client) => {
      if (error) reject(error);
      else resolve(client);
    });
  });
}

async function getClient(credentials) {
  const normalized = ensureCredentials(credentials);
  if (clientPromise && sameCredentials(activeCredentials, normalized)) {
    // A login whose server socket dropped would otherwise be reused forever,
    // returning empty searches that make callers retry.
    if (!connectedClient || connectedClient.isConnected?.() !== false) return clientPromise;
    await resetClient(connectedClient);
  }

  if (clientPromise && !sameCredentials(activeCredentials, normalized)) {
    clientPromise.then(client => {
      try {
        client.destroy?.();
      } catch {
        // best-effort cleanup
      }
    }).catch(() => {});
    clientPromise = null;
    connectedClient = null;
  }

  if (clientPromise) return clientPromise;
  if (Date.now() < reconnectNotBefore) {
    const remainingSeconds = Math.max(1, Math.ceil((reconnectNotBefore - Date.now()) / 1000));
    const reason = lastConnectError?.startsWith('Otra sesión') ? `${lastConnectError} ` : 'Soulseek rechazo la conexión recientemente. ';
    const error = new Error(`${reason}Espera ${remainingSeconds} s antes de reintentar.`);
    error.code = 'SOULSEEK_COOLDOWN';
    error.retryAfterMs = reconnectNotBefore - Date.now();
    throw error;
  }
  // Even successful logins must not come in bursts (credential switches,
  // dropped sessions); wait out the minimum gap instead of failing.
  const loginGapMs = lastLoginAttemptAt + MIN_LOGIN_GAP_MS - Date.now();
  if (loginGapMs > 0) await new Promise(resolve => setTimeout(resolve, loginGapMs));
  if (clientPromise) return clientPromise;
  lastLoginAttemptAt = Date.now();
  activeCredentials = normalized;

  const pendingClient = connectClient(normalized);
  clientPromise = pendingClient;

  try {
    const client = await pendingClient;
    connectedClient = client;
    reconnectNotBefore = 0;
    consecutiveConnectFailures = 0;
    lastConnectError = null;
    return client;
  } catch (error) {
    if (clientPromise === pendingClient) {
      clientPromise = null;
      connectedClient = null;
      activeCredentials = null;
      noteConnectFailure(error);
    }
    throw error;
  }
}

/** Exponential login backoff: 30 s, 1 min, 2 min… capped at 30 min. */
function noteConnectFailure(error) {
  consecutiveConnectFailures += 1;
  const cooldown = Math.min(
    SESSION_CONNECT_MAX_COOLDOWN_MS,
    SESSION_CONNECT_COOLDOWN_MS * 2 ** Math.min(consecutiveConnectFailures - 1, 6),
  );
  reconnectNotBefore = Date.now() + cooldown;
  lastConnectError = error instanceof Error ? error.message : String(error);
}

function normalizeSearchKey(query) {
  return query.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Cached, serialized search. Identical queries within the TTL share one
 * network search, and distinct ones are spaced SEARCH_MIN_GAP_MS apart.
 */
function searchSoulseekPolitely(query, timeoutMs, maxResults, credentials, identity) {
  const key = JSON.stringify([normalizeSearchKey(query), identity ?? null]);
  const now = Date.now();
  for (const [cacheKey, entry] of searchCache) {
    if (entry.expiresAt <= now) searchCache.delete(cacheKey);
  }
  const cached = searchCache.get(key);
  if (cached) return cached.promise.then(results => results.slice(0, maxResults));

  const run = async () => {
    const waitMs = lastSearchAt + SEARCH_MIN_GAP_MS - Date.now();
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastSearchAt = Date.now();
    return searchSoulseek(query, timeoutMs, Math.max(maxResults, 60), credentials, identity);
  };
  const promise = searchQueue.then(run, run);
  searchQueue = promise.catch(() => undefined);

  const entry = { expiresAt: Number.POSITIVE_INFINITY, promise };
  searchCache.set(key, entry);
  promise.then(
    results => {
      entry.expiresAt = Date.now() + (results.length ? SEARCH_CACHE_TTL_MS : EMPTY_SEARCH_CACHE_TTL_MS);
    },
    () => {
      if (searchCache.get(key) === entry) searchCache.delete(key);
    },
  );
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value);
  }
  return promise.then(results => results.slice(0, maxResults));
}

/**
 * Another client logging in with the same account makes the server drop us.
 * Reconnecting straight away would kick that other device in turn, so wait.
 */
function handleRelogged() {
  reconnectNotBefore = Date.now() + RELOGGED_COOLDOWN_MS;
  lastConnectError = 'Otra sesión (otro dispositivo o programa) entró con esta misma cuenta de Soulseek y el servidor cerró esta. Usa una cuenta distinta en cada dispositivo.';
}

/** Returns a client whose server route answered recently, re-logging if it is dead. */
async function getLiveClient(credentials) {
  const client = await getClient(credentials);
  lastCredentials = ensureCredentials(credentials);
  const health = client.serverHealth?.();
  if (!health) return client;
  if (health.relogged) {
    await resetClient(client);
    handleRelogged();
    const error = new Error(lastConnectError);
    error.code = 'SOULSEEK_COOLDOWN';
    error.retryAfterMs = RELOGGED_COOLDOWN_MS;
    throw error;
  }
  if (Date.now() - health.lastDataAt < QUIET_PROBE_MS) return client;

  const sentAt = Date.now();
  client.probe?.();
  while (Date.now() - sentAt < PROBE_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if ((client.serverHealth?.().lastDataAt ?? 0) >= sentAt) return client;
  }
  // Dead route: not a login failure, so no backoff; the login gap still applies.
  lastConnectError = 'La conexión con el servidor de Soulseek se había caído en silencio; se volvió a conectar.';
  await resetClient(client);
  return getClient(credentials);
}

/** Every 30 s: heartbeat a quiet session, recover a dead one, notice kicks. */
setInterval(() => {
  const client = connectedClient;
  const health = client?.serverHealth?.();
  if (!client || !health) return;
  const now = Date.now();
  const reconnect = () => {
    if (!lastCredentials) return;
    // Desktop shares while open, so come back online (login gap/backoff apply).
    getClient(lastCredentials).catch(() => {});
  };
  if (health.relogged) {
    void resetClient(client).then(handleRelogged);
    return;
  }
  if (!client.isConnected?.()) {
    void resetClient(client).then(reconnect);
    return;
  }
  if (heartbeatSentAt > health.lastDataAt && now - heartbeatSentAt > 20_000) {
    heartbeatSentAt = 0;
    lastConnectError = 'La conexión con el servidor de Soulseek se había caído en silencio; se volvió a conectar.';
    void resetClient(client).then(reconnect);
    return;
  }
  if (now - health.lastDataAt > HEARTBEAT_QUIET_MS && now - heartbeatSentAt > HEARTBEAT_QUIET_MS) {
    heartbeatSentAt = now;
    client.probe?.();
  }
}, 30_000).unref();

async function searchSoulseek(query, timeoutMs, maxResults, credentials, identity) {
  const client = await getLiveClient(credentials);
  return searchWithRecovery({
    client,
    query,
    search: liveClient => searchSoulseekOnClient(liveClient, query, timeoutMs, maxResults, identity),
    canReconnect: liveClient => connectedClient === liveClient
      && ![...jobs.values()].some(job => job.status === 'downloading')
      && !liveClient.hasActiveTransfers?.(),
    reconnect: async staleClient => {
      await resetClient(staleClient);
      searchCache.clear();
      lastSearchRecoveryAt = new Date().toISOString();
      console.log('[soulseek] recovering session after distinct searches returned no peers');
      return getLiveClient(credentials);
    },
  });
}

async function searchSoulseekOnClient(client, query, timeoutMs, maxResults, identity) {
  const startedAt = Date.now();

  const rankResults = results => {
    const unique = new Map();
    for (const result of results ?? []) {
      const normalized = normalizeResult(result);
      if (!normalized.username || !normalized.filename || !/\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(normalized.filename)) continue;
      unique.set(`${normalized.username}|${normalized.filename}|${normalized.size ?? 0}`, normalized);
    }
    return rankSoulseekResults([...unique.values()], maxResults, identity);
  };

  try {
    return await new Promise((resolve, reject) => {
      const eventName = `found:${query}`;
      const collected = [];
      let quietTimer = null;
      let settled = false;

      const finish = results => {
        if (settled) return;
        settled = true;
        if (quietTimer) clearTimeout(quietTimer);
        client.removeListener(eventName, onFound);
        const ranked = rankResults(results);
        const all = results ?? [];
        ranked.rawResultCount = all.length;
        lastSearch = {
          query,
          at: new Date().toISOString(),
          ms: Date.now() - startedAt,
          rawResults: all.length,
          peers: new Set(all.map(item => normalizeResult(item).username)).size,
          returned: ranked.length,
          serverQuietMs: Date.now() - (client.serverHealth?.().lastDataAt ?? Date.now()),
        };
        console.log('[soulseek] search', JSON.stringify(lastSearch));
        resolve(ranked);
      };

      const onFound = result => {
        collected.push(result);
        // Count distinct users, not files: an album query returns a dozen
        // files per peer, and one peer's album is not three sources.
        const ready = rankResults(collected).filter(item => item.slots && (item.speed ?? 0) > 0);
        const readyPeers = new Set(ready.map(item => item.username)).size;
        // Only lossless sources may end the search quickly: three free MP3
        // peers must not cut off the FLAC replies still on their way.
        const readyLosslessPeers = new Set(ready.filter(isLosslessResult).map(item => item.username)).size;
        if (readyLosslessPeers >= 8) {
          finish(collected);
          return;
        }
        // Like Seeker's inactivity timeout: once someone can serve the file, a
        // quiet stream means the useful replies are in. MP3-only tracks wait a
        // little longer for a FLAC, but never the whole search timeout.
        const quietMs = readyLosslessPeers >= 3 ? 350
          : readyLosslessPeers >= 1 ? 1_500
            : readyPeers >= 3 ? 3_000
              : 0;
        if (!quietMs) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(collected), quietMs);
      };

      client.on(eventName, onFound);
      try {
        client.search({ req: query, timeout: timeoutMs }, (error, searchResults) => {
          if (settled) return;
          if (error) {
            settled = true;
            if (quietTimer) clearTimeout(quietTimer);
            client.removeListener(eventName, onFound);
            reject(error);
            return;
          }
          finish(searchResults);
        });
      } catch (error) {
        settled = true;
        if (quietTimer) clearTimeout(quietTimer);
        client.removeListener(eventName, onFound);
        reject(error);
      }
    });
  } catch (error) {
    // Only a dropped server connection invalidates the login. A slow search
    // (timeout) is not a reason to log in again; that is how bursts start.
    if (isServerConnectionError(error) || client.isConnected?.() === false) {
      noteConnectFailure(error);
      await resetClient(client);
    }
    throw error;
  }
}

async function reserveDownloadPaths(directory, base, extension) {
  let sequence = 1;
  while (true) {
    const suffix = sequence === 1 ? '' : ` (${sequence})`;
    const finalPath = path.join(directory, `${base}${suffix}.${extension}`);
    const partialPath = `${finalPath}.part`;
    if (!fs.existsSync(finalPath)) {
      try {
        // Reserving the .part file atomically also prevents simultaneous peer
        // candidates from writing into the same destination.
        const reservation = await fs.promises.open(partialPath, 'wx');
        await reservation.close();
        return { finalPath, partialPath };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    sequence += 1;
  }
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_RETENTION_MS) {
      job.release?.();
      jobs.delete(id);
    }
  }
}

function registerFile(outputPath, filename, mimeType, size) {
  const id = crypto.randomUUID();
  files.set(id, {
    path: outputPath,
    filename,
    mimeType,
    size,
    createdAt: Date.now(),
  });
  return id;
}

function isServerConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /econnreset|connection reset|socket (?:is )?closed|eof|epipe|not connected/i.test(message);
}

function isRetryablePeerTransferError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /econnreset|connection reset|socket (?:is )?closed|eof|timed?\s*out/i.test(message);
}

/**
 * Job-based download used by the desktop app: returns immediately and lets
 * the UI poll /download/status for real progress (measured off the growing
 * file on disk, since slsk-client only reports completion). `targetDir`
 * lets the desktop write straight into the user's music folder so the file
 * survives app restarts.
 */
async function startDownloadJob(match, requestedFilename, credentials, targetDir) {
  const client = await getLiveClient(credentials);
  const downloadDir = targetDir ? path.resolve(String(targetDir)) : DOWNLOAD_DIR;
  await fs.promises.mkdir(downloadDir, { recursive: true });

  const leaf = path.basename(String(match.filename || 'track').replaceAll('\\', '/'));
  const extension = extensionFromFilename(leaf);
  const base = sanitizeFileSegment(requestedFilename || leaf).replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const { finalPath, partialPath } = await reserveDownloadPaths(downloadDir, base, extension);

  pruneJobs();
  const job = {
    id: crypto.randomUUID(),
    status: 'downloading',
    path: partialPath,
    finalPath,
    filename: path.basename(finalPath),
    mimeType: mimeFromExtension(extension),
    total: Number.isFinite(match.size) ? match.size : 0,
    size: 0,
    fileId: null,
    error: null,
    attempts: 0,
    peer: match.username,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  const file = {
    user: match.username,
    file: match.filename,
    size: match.size,
    slots: match.slots,
    bitrate: match.bitRate,
    speed: match.speed,
  };

  // Once this job stops waiting on the peer, later offers for the file are
  // answered "Cancelled" so its queue entry does not linger at the uploader.
  job.release = () => client.cancelDownload?.(file.user, file.file);

  const onTransferComplete = error => {
    if (!error || job.abandoned || !(job.attempts < PEER_TRANSFER_RETRY_LIMIT && isRetryablePeerTransferError(error))) {
      job.release();
    }
    if (job.abandoned) {
      fs.promises.unlink(partialPath).catch(() => {});
      return;
    }
    if (error) {
      if (job.attempts < PEER_TRANSFER_RETRY_LIMIT && isRetryablePeerTransferError(error)) {
        job.attempts += 1;
        // A reset can occur during a peer's handoff even though it advertised
        // an available slot. Retry the same transfer once with a clean output
        // file before the UI promotes another verified peer.
        fs.promises.unlink(partialPath)
          .catch(() => {})
          .finally(() => setTimeout(runTransfer, 750));
        return;
      }
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      fs.promises.unlink(partialPath).catch(() => {});
      return;
    }
    fs.promises.stat(partialPath)
      .then(async stat => {
        if (!stat.size) throw new Error('Soulseek devolvio un archivo vacio.');
        if (job.total > 0 && stat.size !== job.total) {
          throw new Error(`Soulseek devolvio un archivo incompleto (${stat.size}/${job.total} bytes).`);
        }
        await fs.promises.rename(partialPath, finalPath);
        job.path = finalPath;
        job.size = stat.size;
        job.fileId = registerFile(finalPath, job.filename, job.mimeType, stat.size);
        client.rescanShares?.();
        job.status = 'done';
      })
      .catch(statError => {
        job.status = 'error';
        job.error = statError instanceof Error ? statError.message : String(statError);
        fs.promises.unlink(partialPath).catch(() => {});
      });
  };

  const runTransfer = () => {
    try {
      client.download({ file, path: partialPath }, onTransferComplete);
    } catch (error) {
      // A dead cached server socket can make slsk-client throw synchronously.
      // Treat it like the callback form so the job API can advance to another
      // peer instead of leaking a route-level HTTP 500 (or an uncaught error
      // from the delayed retry).
      onTransferComplete(error);
    }
  };

  runTransfer();

  return job;
}

async function downloadSoulseek(match, requestedFilename, credentials) {
  const client = await getLiveClient(credentials);
  await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });

  const leaf = path.basename(String(match.filename || 'track').replaceAll('\\', '/'));
  const extension = extensionFromFilename(leaf);
  const filename = sanitizeFileSegment(requestedFilename || leaf).replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const { finalPath, partialPath } = await reserveDownloadPaths(DOWNLOAD_DIR, `${filename}-${Date.now()}`, extension);
  const file = {
    user: match.username,
    file: match.filename,
    size: match.size,
    slots: match.slots,
    bitrate: match.bitRate,
    speed: match.speed,
  };

  try {
    await new Promise((resolve, reject) => {
      client.download({ file, path: partialPath }, (error) => {
        client.cancelDownload?.(file.user, file.file);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    await fs.promises.unlink(partialPath).catch(() => {});
    throw error;
  }

  const stat = await fs.promises.stat(partialPath);
  if (!stat.size) {
    await fs.promises.unlink(partialPath).catch(() => {});
    throw new Error('Soulseek devolvio un archivo vacio.');
  }
  if (Number.isFinite(match.size) && match.size > 0 && stat.size !== match.size) {
    await fs.promises.unlink(partialPath).catch(() => {});
    throw new Error(`Soulseek devolvio un archivo incompleto (${stat.size}/${match.size} bytes).`);
  }
  await fs.promises.rename(partialPath, finalPath);
  client.rescanShares?.();

  const id = crypto.randomUUID();
  files.set(id, {
    path: finalPath,
    filename: `${filename}.${extension}`,
    mimeType: mimeFromExtension(extension),
    size: stat.size,
    createdAt: Date.now(),
  });

  return files.get(id);
}

function serveFile(response, id) {
  const entry = files.get(id);
  if (!entry) {
    text(response, 404, 'File not found');
    return;
  }

  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Content-Type': entry.mimeType,
    'Content-Length': entry.size,
    'Content-Disposition': `attachment; filename="${entry.filename.replace(/"/g, '')}"`,
  });
  fs.createReadStream(entry.path).pipe(response);
}

async function route(request, response) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      const client = connectedClient;
      json(response, 200, {
        ok: true,
        connected: Boolean(client),
        connecting: Boolean(clientPromise && !client),
        retryAfterMs: Math.max(0, reconnectNotBefore - Date.now()),
        lastError: lastConnectError ?? undefined,
        serverQuietMs: client?.serverHealth ? Date.now() - client.serverHealth().lastDataAt : undefined,
        lastSearch: lastSearch ?? undefined,
        lastSearchRecoveryAt: lastSearchRecoveryAt ?? undefined,
        hasCredentials: Boolean(activeCredentials || (DEFAULT_USERNAME && DEFAULT_PASSWORD)),
        downloadDir: DOWNLOAD_DIR,
        shares: client?.getShareStats?.() ?? { files: 0, folders: 0, roots: requestedShareFolders() },
      });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/proxy') {
      const target = url.searchParams.get('url');
      if (!target) {
        json(response, 400, { error: 'url requerido' });
        return;
      }
      await proxyRequest(request, response, target);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/session/start') {
      const body = await parseBody(request);
      await getLiveClient(body.credentials);
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/shares/configure') {
      const body = await parseBody(request);
      runtimeShareDirs = validateShareDirectories(body.directories);
      const client = await getClient(body.credentials);
      const shares = client.setSharedFolders?.(requestedShareFolders())
        ?? { files: 0, folders: 0, roots: requestedShareFolders() };
      json(response, 200, { ok: true, shares });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/shares/rescan') {
      const body = await parseBody(request);
      const client = await getClient(body.credentials);
      client.rescanShares?.();
      json(response, 200, {
        ok: true,
        shares: client.getShareStats?.() ?? { files: 0, folders: 0, roots: requestedShareFolders() },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/search') {
      const body = await parseBody(request);
      const query = String(body.query ?? '').trim();
      if (!query) {
        json(response, 400, { error: 'query requerido' });
        return;
      }
      const results = await searchSoulseekPolitely(
        query,
        Math.min(30_000, Math.max(2_000, Number(body.timeoutMs ?? 18_000))),
        // Album queries return whole folders; leave room for several peers' albums.
        Math.min(250, Math.max(1, Number(body.maxResults ?? 60))),
        body.credentials,
        body.identity && Array.isArray(body.identity.titleWords) && body.identity.titleWords.length
          && Array.isArray(body.identity.artistWords) && body.identity.artistWords.length
          && [...body.identity.titleWords, ...body.identity.artistWords].every(word => typeof word === 'string')
          ? body.identity : undefined,
      );
      json(response, 200, { results });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/download/start') {
      const body = await parseBody(request);
      const match = body.match;
      if (!match?.username || !match?.filename) {
        json(response, 400, { error: 'match.username y match.filename son requeridos' });
        return;
      }
      const job = await startDownloadJob(match, body.filename, body.credentials, body.dir);
      json(response, 200, { jobId: job.id, total: job.total, filename: job.filename });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/download/status') {
      const id = url.searchParams.get('id') ?? '';
      const job = jobs.get(id);
      if (!job) {
        json(response, 404, { error: 'job no encontrado' });
        return;
      }
      let received = job.size;
      if (job.status === 'downloading') {
        try {
          received = (await fs.promises.stat(job.path)).size;
        } catch {
          received = 0;
        }
      }
      json(response, 200, {
        status: job.status,
        received,
        total: job.total,
        size: job.size || undefined,
        filename: job.filename,
        mimeType: job.mimeType,
        url: job.fileId ? `http://${HOST}:${PORT}/files/${job.fileId}` : undefined,
        path: job.status === 'done' ? job.path : undefined,
        error: job.error ?? undefined,
        peer: job.peer,
        attempts: job.attempts,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/download/abandon') {
      const body = await parseBody(request);
      const job = jobs.get(String(body.jobId ?? ''));
      if (!job) {
        json(response, 404, { error: 'job no encontrado' });
        return;
      }
      if (job.status === 'downloading') {
        job.abandoned = true;
        job.release?.();
        job.status = 'error';
        job.error = 'Transferencia reemplazada por un peer más rápido.';
      }
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/download') {
      const body = await parseBody(request);
      const match = body.match;
      if (!match?.username || !match?.filename) {
        json(response, 400, { error: 'match.username y match.filename son requeridos' });
        return;
      }
      const entry = await downloadSoulseek(match, body.filename, body.credentials);
      const id = Array.from(files.entries()).find(([, value]) => value === entry)?.[0];
      json(response, 200, {
        url: `http://${HOST}:${PORT}/files/${id}`,
        filename: entry.filename,
        mimeType: entry.mimeType,
        size: entry.size,
        path: entry.path,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
      serveFile(response, decodeURIComponent(url.pathname.replace('/files/', '')));
      return;
    }

    text(response, 404, 'Not found');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const coolingDown = error?.code === 'SOULSEEK_COOLDOWN';
    const retryable = !coolingDown && isRetryablePeerTransferError(error);
    json(response, coolingDown ? 503 : 500, {
      error: retryable
        ? 'Soulseek cerró la conexión. Espera 30 segundos antes de volver a intentar.'
        : message,
      retryable,
      retryAfterMs: coolingDown ? error.retryAfterMs : undefined,
    });
  }
}

const server = http.createServer((request, response) => {
  void route(request, response);
});

function shutdown() {
  clientPromise?.then(client => {
    try {
      client.destroy?.();
    } catch {
      // best-effort Soulseek cleanup
    }
  }).catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

// slsk-client no siempre registra 'error' en los sockets de los peers: un peer
// que acepta la transferencia y luego resetea la conexión puede emitir un
// ECONNRESET sin handler. Si eso mata el proceso, se pierden todos los jobs en
// curso y la UI recibe "404 job no encontrado" del bridge respawneado.
process.on('uncaughtException', error => {
  console.error('[StaySound Soulseek Bridge] uncaughtException:', error);
});
process.on('unhandledRejection', reason => {
  console.error('[StaySound Soulseek Bridge] unhandledRejection:', reason);
});

// Un fallo al abrir el puerto (p. ej. EADDRINUSE porque otro bridge ya corre)
// sí es fatal: sin servidor este proceso no sirve de nada y ensure_soulseek_bridge
// debe poder detectarlo. Se registra antes de listen() para que el error no
// caiga en el handler de uncaughtException, que lo dejaría vivo como zombi.
server.on('error', error => {
  console.error('[StaySound Soulseek Bridge] no se pudo iniciar el servidor:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[StaySound Soulseek Bridge] http://${HOST}:${PORT}`);
  console.log(`[StaySound Soulseek Bridge] downloads: ${DOWNLOAD_DIR}`);
  console.log('[StaySound Soulseek Bridge] credentials are provided by the web UI.');
});
