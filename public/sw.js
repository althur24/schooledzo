// v3: (1) purge cache v2 — chunk dev tertahan CacheFirst walau halaman di-refresh
//         (nama chunk dev stabil antar recompile, tidak di-hash seperti production);
//     (2) SW jadi no-op penuh di localhost/dev — tidak pernah intercept apa pun.
const CACHE_NAME = 'lms-ypp-v3';
const OFFLINE_URL = '/offline.html';
const IS_DEV_HOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Safe cache.put wrapper — prevents "Entry already exists" and "Unexpected internal error"
async function safeCachePut(request, response) {
  try {
    if (response.type === 'opaque') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (e) {
    // Silently ignore cache errors — the app works fine without caching
  }
}

// Pre-cache on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        OFFLINE_URL,
        '/manifest.json',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ]).catch(() => {})
    )
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  // DEV (localhost): jangan intercept APA PUN. Chunk dev tidak di-hash —
  // caching apa pun di sini menyajikan kode basi setelah recompile.
  if (IS_DEV_HOST) return;

  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Strategy 1: CacheFirst for static assets
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|woff2?|ttf|eot)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) safeCachePut(request, response.clone());
          return response;
        });
      })
    );
    return;
  }

  // Strategy 2: CacheFirst for Google Fonts
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) safeCachePut(request, response.clone());
          return response;
        });
      })
    );
    return;
  }

  // Strategy 3: CacheFirst for Supabase storage files
  if (url.hostname.includes('supabase') && url.pathname.startsWith('/storage/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) safeCachePut(request, response.clone());
          return response;
        });
      })
    );
    return;
  }

  // Strategy 4: NetworkOnly for API — data live (status attempt/submission) tidak boleh
  // dilayani dari cache: fallback cache basi membuat client menganggap attempt belum
  // ada (insert duplikat gagal UNIQUE) atau membaca state submission lama saat
  // jaringan flaky. Draft jawaban siswa aman di localStorage — tidak butuh cache API.
  if (url.pathname.startsWith('/api/')) {
    return; // tanpa interception: fetch jalan normal, gagal = gagal (client yang retry)
  }

  // Strategy 5: NetworkFirst for navigation (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) safeCachePut(request, response.clone());
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }
});
