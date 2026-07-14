#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const slsk = require('slsk-client');

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
let clientPromise = null;
let activeCredentials = null;

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

function getClient(credentials) {
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

  clientPromise = new Promise((resolve, reject) => {
    slsk.connect({
      user: normalized.username,
      pass: normalized.password,
      host: process.env.SOULSEEK_SERVER_HOST || 'server.slsknet.org',
      port: Number.parseInt(process.env.SOULSEEK_SERVER_PORT ?? '2242', 10),
      incomingPort: Number.parseInt(process.env.SOULSEEK_LISTEN_PORT ?? '2234', 10),
      sharedFolders: process.env.SOULSEEK_SHARED_DIR ? [process.env.SOULSEEK_SHARED_DIR] : [],
    }, (error, client) => {
      if (error) {
        clientPromise = null;
        reject(error);
        return;
      }
      resolve(client);
    });
  });

  return clientPromise;
}

async function searchSoulseek(query, timeoutMs, maxResults, credentials) {
  const client = await getClient(credentials);
  return new Promise((resolve, reject) => {
    client.search({ req: query, timeout: timeoutMs }, (error, results) => {
      if (error) {
        reject(error);
        return;
      }
      const normalized = (results ?? [])
        .map(normalizeResult)
        .filter(item => item.username && item.filename && /\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(item.filename))
        .sort((a, b) => {
          if (a.slots !== b.slots) return a.slots ? -1 : 1;
          if ((a.extension === 'flac') !== (b.extension === 'flac')) return a.extension === 'flac' ? -1 : 1;
          return (b.speed ?? 0) - (a.speed ?? 0);
        })
        .slice(0, maxResults);
      resolve(normalized);
    });
  });
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
      json(response, 200, {
        ok: true,
        connected: Boolean(clientPromise),
        hasCredentials: Boolean(activeCredentials || (DEFAULT_USERNAME && DEFAULT_PASSWORD)),
        downloadDir: DOWNLOAD_DIR,
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

    if (request.method === 'POST' && url.pathname === '/search') {
      const body = await parseBody(request);
      const query = String(body.query ?? '').trim();
      if (!query) {
        json(response, 400, { error: 'query requerido' });
        return;
      }
      const results = await searchSoulseek(
        query,
        Math.min(30_000, Math.max(2_000, Number(body.timeoutMs ?? 9_000))),
        Math.min(80, Math.max(1, Number(body.maxResults ?? 40))),
        body.credentials,
      );
      json(response, 200, { results });
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
      });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
      serveFile(response, decodeURIComponent(url.pathname.replace('/files/', '')));
      return;
    }

    text(response, 404, 'Not found');
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = http.createServer((request, response) => {
  void route(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`[StaySound Soulseek Bridge] http://${HOST}:${PORT}`);
  console.log(`[StaySound Soulseek Bridge] downloads: ${DOWNLOAD_DIR}`);
  console.log('[StaySound Soulseek Bridge] credentials are provided by the web UI.');
});
