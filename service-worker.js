/**
 * PawBook Service Worker v3
 * Strategy: Network-first for everything; no pre-caching of HTML or JS
 * This avoids stale api.js or HTML being served after updates.
 */

const CACHE_NAME = 'pawbook-v3';
const API_ORIGIN = 'https://pawbook-api-cquc.onrender.com';

/* ── Install: skip waiting, activate immediately ── */
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

/* ── Activate: clear ALL old caches ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

/* ── Fetch: network-first for everything ── */
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Skip non-GET and chrome-extension requests
  if (e.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension')) return;

  // API calls: pass through, no caching
  if (url.startsWith(API_ORIGIN)) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response(JSON.stringify({ success: false, message: 'You are offline. Please check your connection.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // JS and HTML files: ALWAYS fetch from network (never serve stale JS/HTML)
  if (url.includes('.js') || url.includes('.html')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // CSS and images: network-first, cache fallback
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
