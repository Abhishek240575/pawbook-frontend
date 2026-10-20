/**
 * PawBook Service Worker
 * Strategy: Network-first for API, Cache-first for static assets
 */

const CACHE_NAME = 'pawbook-v1';
const API_ORIGIN = 'https://pawbook-api-cquc.onrender.com';

const STATIC_ASSETS = [
  '/style.css',
  '/mobile.css',
  '/api.js',
  '/pb-global.js',
  '/manifest.json',
  '/07_home.html',
  '/12_notifications.html',
  '/09_marketplace.html',
  '/14_settings.html',
  '/01_login.html',
  '/02_register.html',
];

/* ── Install: pre-cache static assets ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] Some assets failed to pre-cache:', err);
      });
    })
  );
  self.skipWaiting();
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

/* ── Fetch: network-first for API, cache-first for static ── */
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Skip non-GET and chrome-extension requests
  if (e.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension')) return;

  // API calls: network-first, no cache
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

  // Static assets: cache-first, fallback to network
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache successful responses for HTML/CSS/JS
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback for HTML pages
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
          return caches.match('/07_home.html');
        }
      });
    })
  );
});
