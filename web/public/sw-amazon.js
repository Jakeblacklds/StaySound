importScripts('/sw-decrypter.js?v=2026-06-23-flac-hls-v8');

const STAYSOUND_APP_CACHE = 'staysound-web-shell-v2';
const STAYSOUND_APP_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.png',
  '/appicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STAYSOUND_APP_CACHE)
      .then((cache) => cache.addAll(STAYSOUND_APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'CLEAR_STAYSOUND_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith('staysound-web-shell-'))
        .map((key) => caches.delete(key)));
    })());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('staysound-web-shell-') && key !== STAYSOUND_APP_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/decrypt-stream') return;
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(event.request, { cache: 'reload' }))
        .then((response) => {
          const copy = response.clone();
          caches.open(STAYSOUND_APP_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/') || Response.error())
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || STAYSOUND_APP_ASSETS.includes(url.pathname)) {
    event.respondWith(
      fetch(new Request(event.request, { cache: 'reload' }))
        .then((response) => {
          const copy = response.clone();
          caches.open(STAYSOUND_APP_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request) || Response.error())
    );
  }
});
