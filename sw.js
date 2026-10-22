/* ==========================================================================
   PAWBOOK  sw.js  — Service Worker  (PWA)
   Handles: offline caching, background sync, push notifications
   ========================================================================== */

const CACHE_VERSION  = 'pb-v1';
const STATIC_CACHE   = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE  = `${CACHE_VERSION}-dynamic`;
const API_CACHE      = `${CACHE_VERSION}-api`;

// ── Assets to pre-cache on install ────────────────────────────────────────────
const PRECACHE_URLS = [
  '/',
  '/07_home.html',
  '/01_login.html',
  '/02_onboarding.html',
  '/style.css',
  '/mobile.css',
  '/api.js',
  '/upload.js',
  '/socket.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {}) // non-fatal if some assets missing
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  const KEEP = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // API calls — network-first, fall to cache for GET requests
  if (url.hostname.includes('onrender.com') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstAPI(request));
    return;
  }

  // Static assets (fonts, icons CDN) — cache-first
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cloudinary.com')
  ) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // HTML pages and local assets — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategies ─────────────────────────────────────────────────────────────────

async function networkFirstAPI(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ success: false, message: 'You are offline', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(request, cacheName = DYNAMIC_CACHE) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache    = await caches.open(DYNAMIC_CACHE);
  const cached   = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response('Offline', { status: 503 });
}

// ── Background Sync (queued POST/PATCH when offline) ──────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncOfflinePosts());
  }
});

async function syncOfflinePosts() {
  // Posts are queued in IndexedDB by the page; we flush them here
  // Simple implementation — pages handle the IDB details
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_POSTS' }));
}

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'PawBook', body: 'You have a new notification 🐾', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' };

  if (event.data) {
    try { Object.assign(data, event.data.json()); } catch (_) {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon  || '/icons/icon-192.png',
      badge:   data.badge || '/icons/badge-72.png',
      tag:     data.tag   || 'pawbook-notif',
      data:    { url: data.url || '/07_home.html' },
      actions: [
        { action: 'open',    title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const target = event.notification.data?.url || '/07_home.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const existing = clients.find(c => c.url.includes(target) && 'focus' in c);
        if (existing) return existing.focus();
        return self.clients.openWindow(target);
      })
  );
});

// ── Message from page ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION')  event.ports[0]?.postMessage({ version: CACHE_VERSION });
});
