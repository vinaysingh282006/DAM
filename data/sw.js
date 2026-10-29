/**
 * AquaGuard SCADA — Service Worker Cache Purger
 * Immediately cleans out all stale caches and self-unregisters
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return self.registration.unregister();
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Always passthrough directly to network
  event.respondWith(fetch(event.request));
});
