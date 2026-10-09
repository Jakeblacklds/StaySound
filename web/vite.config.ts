import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

const BLOCKED_ARTWORK_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isBlockedArtworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_ARTWORK_HOSTNAMES.has(host)) return true;
  if (!host.includes('.') || host.endsWith('.local')) return true;
  if (host.includes(':')) return /^(::1|fe80:|fc|fd)/i.test(host) || host === '::';
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

/** Match the production API routes while running Vite locally. */
function localApiProxy(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    if (requestUrl.pathname === '/api/saavn') {
      const action = requestUrl.searchParams.get('action') ?? '';
      const query = (requestUrl.searchParams.get('q') ?? '').trim();
      const albumId = (requestUrl.searchParams.get('id') ?? '').trim();
      const source = new URL('https://www.jiosaavn.com/api.php');
      source.searchParams.set('_format', 'json');
      source.searchParams.set('_marker', '0');
      source.searchParams.set('ctx', 'web6dot0');
      source.searchParams.set('api_version', '4');

      if (action === 'album-search' && query && query.length <= 180) {
        source.searchParams.set('__call', 'search.getAlbumResults');
        source.searchParams.set('q', query);
        source.searchParams.set('n', '20');
        source.searchParams.set('p', '1');
      } else if (action === 'album-details' && /^\d{1,20}$/.test(albumId)) {
        source.searchParams.set('__call', 'content.getAlbumDetails');
        source.searchParams.set('albumid', albumId);
      } else {
        res.statusCode = 400;
        res.end();
        return;
      }

      try {
        const upstream = await fetch(source, {
          headers: {
            accept: 'application/json,text/plain,*/*',
            referer: 'https://www.jiosaavn.com/',
            'user-agent': 'Mozilla/5.0 (compatible; StaySound/1.0)',
          },
        });
        const payload = await upstream.text();
        if (!upstream.ok || payload.length > 2_000_000) {
          res.statusCode = 502;
          res.end();
          return;
        }
        JSON.parse(payload);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.end(payload);
      } catch {
        res.statusCode = 502;
        res.end();
      }
      return;
    }

    if (requestUrl.pathname !== '/api/artwork') {
      next();
      return;
    }

    const rawUrl = requestUrl.searchParams.get('url');
    let source: URL;
    try {
      source = new URL(rawUrl ?? '');
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    if (source.protocol !== 'https:' || isBlockedArtworkHostname(source.hostname)) {
      res.statusCode = 400;
      res.end();
      return;
    }

    try {
      const upstream = await fetch(source, { headers: { accept: 'image/*' } });
      const contentType = upstream.headers.get('content-type') ?? '';
      const contentLength = Number(upstream.headers.get('content-length') ?? 0);
      if (!upstream.ok || !contentType.startsWith('image/') || contentLength > 2_500_000) {
        res.statusCode = 502;
        res.end();
        return;
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (bytes.byteLength > 2_500_000) {
        res.statusCode = 502;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(bytes);
    } catch {
      res.statusCode = 502;
      res.end();
    }
  };

  return {
    name: 'staysound-local-api-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), localApiProxy()],
  // Stamped into the bundle so the perf probe can say which build is running —
  // without it, "the fix did not work" and "you are on the old build" look
  // identical in a log.
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')),
  },
  resolve: {
    alias: {
      '@staysound': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
