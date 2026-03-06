// IPEC Consulting PWA Service Worker v4
// Strategies: Network-first for navigations, Stale-while-revalidate for assets, Cache-first for CDNs

const CACHE_NAME = 'ipec-consulting-cache-v5';
const OFFLINE_URL = './offline.html';

// Core app shell to precache (local files only — no CDN URLs that may fail)
const APP_SHELL = [
    './',
    './index.html',
    './emp.html',
    './admin.html',
    './offline.html',
    './manifest.json',
    './assets/images/ipec.jpg',
    './assets/images/cropped-ipec-logo-32x32.png',
    './js/theme.js',
    './js/admin-helper.js',
    './js/utils.js',
    './css/common.css',
    './js/env.js',
    './js/firebase-config.js'
];

// CDN domains to cache at runtime
const CDN_CACHE_NAME = 'ipec-cdn-cache-v1';
const CDN_DOMAINS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.tailwindcss.com',
    'unpkg.com',
    'ka-f.fontawesome.com'
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()) // Activate immediately
    );
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Clean old caches
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((name) => {
                        if (name !== CACHE_NAME && name !== CDN_CACHE_NAME) {
                            return caches.delete(name);
                        }
                    })
                );
            }),
            // Enable navigation preload if supported (speeds up Android)
            (async () => {
                if (self.registration.navigationPreload) {
                    await self.registration.navigationPreload.enable();
                }
            })(),
            // Take control of all clients immediately
            self.clients.claim()
        ])
    );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip chrome-extension and other non-http(s) schemes
    if (!url.protocol.startsWith('http')) return;

    // ── Strategy 1: Navigation requests → Network-first with preload ──
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(event));
        return;
    }

    // ── Strategy 2: CDN resources → Cache-first (long-lived) ──
    if (CDN_DOMAINS.some(domain => url.hostname.includes(domain))) {
        event.respondWith(handleCDN(request));
        return;
    }

    // ── Strategy 3: Local assets → Stale-while-revalidate ──
    if (url.origin === self.location.origin) {
        event.respondWith(handleLocalAsset(request));
        return;
    }

    // Everything else: just fetch
    event.respondWith(fetch(request));
});

// ── Navigation: Network-first with preload fallback ────────
async function handleNavigation(event) {
    try {
        // Use navigation preload response if available (Android perf boost)
        const preloadResponse = await event.preloadResponse;
        if (preloadResponse) {
            // Cache the fresh response for offline use
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, preloadResponse.clone());
            return preloadResponse;
        }

        // Otherwise, network fetch
        const networkResponse = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        // Offline: try cache, then offline page
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        return caches.match(OFFLINE_URL);
    }
}

// ── CDN: Cache-first (fonts, icons, Tailwind rarely change) ─
async function handleCDN(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CDN_CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        // If CDN is unreachable and not cached, return empty response
        return new Response('', { status: 503, statusText: 'CDN Unavailable' });
    }
}

// ── Local Assets: Stale-while-revalidate ────────────────────
async function handleLocalAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    // Fetch fresh version in background
    const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => cachedResponse); // Silently fail if offline

    // Return cached version immediately, or wait for network
    return cachedResponse || fetchPromise;
}

// ── PUSH NOTIFICATIONS ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('./');
        })
    );
});

// ── PERIODIC BACKGROUND SYNC (if supported) ─────────────────
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-cache') {
        event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.addAll(APP_SHELL);
            })
        );
    }
});
