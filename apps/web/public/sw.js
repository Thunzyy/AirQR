const CACHE_NAME = 'airqr-v3';
const STATIC_ASSETS = [
  '/',
  '/site.webmanifest',
  '/favicon-32x32.png',
  '/android-chrome-192x192.png',
];

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEV_LIKE_PORTS = new Set(['4173', '5173']);

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

function isIpLiteralHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '');
  if (!normalized) {
    return false;
  }

  if (normalized.includes(':')) {
    return /^[0-9a-f:]+$/i.test(normalized);
  }

  const parts = normalized.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function shouldDisableOnThisOrigin() {
  return (
    isLoopbackHostname(self.location.hostname) ||
    isIpLiteralHostname(self.location.hostname) ||
    DEV_LIKE_PORTS.has(self.location.port)
  );
}

async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

async function reloadOpenClients() {
  const openClients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });

  await Promise.all(
    openClients.map((client) =>
      'navigate' in client && client.navigate instanceof Function
        ? client.navigate(client.url)
        : Promise.resolve(client),
    ),
  );
}

if (shouldDisableOnThisOrigin()) {
  self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        await clearAllCaches();
        await self.registration.unregister();
        await reloadOpenClients();
      })(),
    );
  });
} else {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
    );
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
    );
    self.clients.claim();
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET, API calls, and WebSocket requests
    if (
      request.method !== 'GET' ||
      url.pathname.startsWith('/api') ||
      url.protocol === 'ws:' ||
      url.protocol === 'wss:'
    ) {
      return;
    }

    // Network-first for HTML pages (always get latest)
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).catch(() => caches.match('/')),
      );
      return;
    }

    // Network-first for executable assets to avoid stale app logic on mobile PWA.
    const isExecutableAsset = /\.(js|css|wasm)$/.test(url.pathname);
    if (isExecutableAsset) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(request)),
      );
      return;
    }

    // Cache-first for passive assets (images/fonts) with network fill.
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?)$/))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
  });
}
