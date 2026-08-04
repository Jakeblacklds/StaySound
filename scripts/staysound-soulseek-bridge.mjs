#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import slsk from 'slsk-client';

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
const SESSION_CONNECT_RETRY_LIMIT = 2;
let clientPromise = null;
let activeCredentials = null;
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

function waitForRetry(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  if (clientPromise && sameCredentials(activeCredentials, normalized)) return clientPromise;

  if (clientPromise && !sameCredentials(activeCredentials, normalized)) {
    clientPromise.then(client => {
      try {
        client.destroy?.();
      } catch {
        // best-effort cleanup
      }
    }).catch(() => {});
    clientPromise = null;
  }

  if (clientPromise) return clientPromise;
  activeCredentials = normalized;

  const pendingClient = (async () => {
    let lastError;
    for (let attempt = 0; attempt <= SESSION_CONNECT_RETRY_LIMIT; attempt += 1) {
      try {
        return await connectClient(normalized);
      } catch (error) {
        lastError = error;
        if (!isRetryablePeerTransferError(error) || attempt === SESSION_CONNECT_RETRY_LIMIT) {
          throw error;
        }
        await waitForRetry(350 * (attempt + 1));
      }
    }
    throw lastError;
  })();
  clientPromise = pendingClient;

  try {
    return await pendingClient;
  } catch (error) {
    if (clientPromise === pendingClient) clientPromise = null;
    throw error;
  }
}

async function searchSoulseek(query, timeoutMs, maxResults, credentials, allowReconnect = true) {
  const client = await getClient(credentials);

  const rankResults = results => {
    const unique = new Map();
    for (const result of results ?? []) {
      const normalized = normalizeResult(result);
      if (!normalized.username || !normalized.filename || !/\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(normalized.filename)) continue;
      unique.set(`${normalized.username}|${normalized.filename}|${normalized.size ?? 0}`, normalized);
    }
    return [...unique.values()]
      .sort((a, b) => {
        if (a.slots !== b.slots) return a.slots ? -1 : 1;
        const aEta = a.size && a.speed ? a.size / a.speed : Number.POSITIVE_INFINITY;
        const bEta = b.size && b.speed ? b.size / b.speed : Number.POSITIVE_INFINITY;
        if (aEta !== bEta) return aEta - bEta;
        if ((a.extension === 'flac') !== (b.extension === 'flac')) return a.extension === 'flac' ? -1 : 1;
        return (b.speed ?? 0) - (a.speed ?? 0);
      })
      .slice(0, maxResults);
  };

  const results = await new Promise((resolve, reject) => {
    const eventName = `found:${query}`;
    const collected = [];
    let quietTimer = null;
    let settled = false;

    const finish = results => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      client.removeListener(eventName, onFound);
      resolve(rankResults(results));
    };

    const onFound = result => {
      collected.push(result);
      const readyPeers = rankResults(collected).filter(item => item.slots && (item.speed ?? 0) > 0);
      if (readyPeers.length < 3) return;
      if (readyPeers.length >= 12) {
        finish(collected);
        return;
      }
      if (quietTimer) clearTimeout(quietTimer);
      // Once several immediately available peers have answered, a short quiet
      // window is enough. There is no benefit in always waiting the full search.
      quietTimer = setTimeout(() => finish(collected), 350);
    };

    client.on(eventName, onFound);
    client.search({ req: query, timeout: timeoutMs }, (error, results) => {
      if (settled) return;
      if (error) {
        client.removeListener(eventName, onFound);
        reject(error);
        return;
      }
      finish(results);
    });
  });

  // A server connection can stay authenticated while its distributed-search
  // route has gone stale. In that state slsk-client completes every query
  // with an empty array, even for ubiquitous tracks. Reconnect once and retry
  // the exact query; never do this while a file transfer is active because
  // destroying that session would interrupt it.
  const hasActiveDownload = [...jobs.values()].some(job => job.status === 'downloading');
  if (results.length || !allowReconnect || hasActiveDownload) return results;

  const staleClient = clientPromise;
  clientPromise = null;
  activeCredentials = null;
  await staleClient?.then(stale => stale.destroy?.()).catch(() => {});
  return searchSoulseek(query, timeoutMs, maxResults, credentials, false);
}

async function uniqueOutputPath(directory, base, extension) {
  let candidate = path.join(directory, `${base}.${extension}`);
  let sequence = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base} (${sequence}).${extension}`);
    sequence += 1;
  }
  return candidate;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_RETENTION_MS) jobs.delete(id);
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
  const client = await getClient(credentials);
  const downloadDir = targetDir ? path.resolve(String(targetDir)) : DOWNLOAD_DIR;
  await fs.promises.mkdir(downloadDir, { recursive: true });

  const leaf = path.basename(String(match.filename || 'track').replaceAll('\\', '/'));
  const extension = extensionFromFilename(leaf);
  const base = sanitizeFileSegment(requestedFilename || leaf).replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const outputPath = await uniqueOutputPath(downloadDir, base, extension);

  pruneJobs();
  const job = {
    id: crypto.randomUUID(),
    status: 'downloading',
    path: outputPath,
    filename: path.basename(outputPath),
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

  const runTransfer = () => client.download({ file, path: outputPath }, (error) => {
    if (job.abandoned) {
      fs.promises.unlink(outputPath).catch(() => {});
      return;
    }
    if (error) {
      if (job.attempts < PEER_TRANSFER_RETRY_LIMIT && isRetryablePeerTransferError(error)) {
        job.attempts += 1;
        // A reset can occur during a peer's handoff even though it advertised
        // an available slot. Retry the same transfer once with a clean output
        // file before the UI promotes another verified peer.
        fs.promises.unlink(outputPath)
          .catch(() => {})
          .finally(() => setTimeout(runTransfer, 750));
        return;
      }
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      return;
    }
    fs.promises.stat(outputPath)
      .then(stat => {
        if (!stat.size) throw new Error('Soulseek devolvio un archivo vacio.');
        job.size = stat.size;
        job.fileId = registerFile(outputPath, job.filename, job.mimeType, stat.size);
        client.rescanShares?.();
        job.status = 'done';
      })
      .catch(statError => {
        job.status = 'error';
        job.error = statError instanceof Error ? statError.message : String(statError);
      });
  });

  runTransfer();

  return job;
}

async function downloadSoulseek(match, requestedFilename, credentials) {
  const client = await getClient(credentials);
  await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });

  const leaf = path.basename(String(match.filename || 'track').replaceAll('\\', '/'));
  const extension = extensionFromFilename(leaf);
  const filename = sanitizeFileSegment(requestedFilename || leaf).replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const outputPath = path.join(DOWNLOAD_DIR, `${filename}-${Date.now()}.${extension}`);
  const file = {
    user: match.username,
    file: match.filename,
    size: match.size,
    slots: match.slots,
    bitrate: match.bitRate,
    speed: match.speed,
  };

  await new Promise((resolve, reject) => {
    client.download({ file, path: outputPath }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const stat = await fs.promises.stat(outputPath);
  if (!stat.size) throw new Error('Soulseek devolvio un archivo vacio.');
  client.rescanShares?.();

  const id = crypto.randomUUID();
  files.set(id, {
    path: outputPath,
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
      const client = clientPromise ? await clientPromise.catch(() => null) : null;
      json(response, 200, {
        ok: true,
        connected: Boolean(clientPromise),
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
      await getClient(body.credentials);
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
      const results = await searchSoulseek(
        query,
        Math.min(30_000, Math.max(2_000, Number(body.timeoutMs ?? 18_000))),
        Math.min(80, Math.max(1, Number(body.maxResults ?? 60))),
        body.credentials,
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
    const retryable = isRetryablePeerTransferError(error);
    json(response, 500, {
      error: retryable
        ? 'La conexión con Soulseek se reinició. Vuelve a intentar; la app reconectará automáticamente.'
        : message,
      retryable,
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
