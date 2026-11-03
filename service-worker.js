const BASE = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');
const VERSION = 'frahoosh-pwa-v4';
const CORE = [
  BASE,
  BASE + 'manifest.webmanifest',
  BASE + 'icons/frahoosh-192.svg',
  BASE + 'icons/frahoosh-512.svg',
  BASE + 'icons/frahoosh-192.png',
  BASE + 'icons/frahoosh-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('frahoosh-pwa-') && key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request).then(cached => cached || caches.match(BASE)))
    );
    return;
  }
  if (CORE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
