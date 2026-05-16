const CACHE = 'cpo-leads-v4';

self.addEventListener('install', e => {
  // Skip waiting — activate immediately so new code takes effect
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Delete ALL old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first: always try fresh, fall back to cache only if offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful GET responses for offline use
        if (res.ok && e.request.method === 'GET' && !e.request.url.includes('/api/')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
