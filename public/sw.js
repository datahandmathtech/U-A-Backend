// Service Worker for Unnati Arts PWA
const CACHE_NAME = 'unnati-arts-v8';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.png',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png'
];

// Install Event: pre-cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Some assets could not be cached on install:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Do not intercept on localhost dev server, non-GET requests, or API calls
  if (
    url.hostname === 'localhost' ||
    url.port === '5173' ||
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.port === '5000' ||
    url.pathname.includes('@vite') ||
    url.pathname.startsWith('/src/')
  ) {
    return;
  }

  // Navigation requests (HTML pages) -> Network first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          if (cached) return cached;
          return new Response(
            '<!doctype html><html><head><meta charset="utf-8"><title>Unnati Arts</title><meta http-equiv="refresh" content="2"></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>Reconnecting to Unnati Arts ERP...</h2><p>Please wait a moment while the application reconnects.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // Static assets (images, scripts, styles) -> Stale-while-revalidate
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            if (cachedResponse) return cachedResponse;
            return new Response('', { status: 404, statusText: 'Not Found' });
          });

        return cachedResponse || fetchPromise;
      }).catch(() => {
        return new Response('', { status: 404, statusText: 'Not Found' });
      })
    );
    return;
  }

  // Default network fetch with fallback
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response('', { status: 408, statusText: 'Request Timed Out' });
    })
  );
});
