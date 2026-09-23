// Ultra-reliable PWA Service Worker for Unnati Arts ERP
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// Pass all requests directly through to network with zero interference
self.addEventListener('fetch', () => {
  return;
});
