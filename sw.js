const VERSION = 'v9-2025-09-23b';
const CACHE = `pwa-contactos-${VERSION}`;

const base = self.registration.scope;
const A = (p) => new URL(p, base).toString();

const APP_SHELL = [
    A('index.html?v=' + VERSION),
    A('styles.css?v=' + VERSION),
    A('app.js?v=' + VERSION),
    A('contacts.example.json?v=' + VERSION),
    A('manifest.webmanifest?v=' + VERSION),
    A('assets/logo.jpg?v=' + VERSION),
];


self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);

    // 1) Navegaciones (abrir/recargar/ruta directa): network -> fallback al index cacheado
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req).catch(() => caches.match(A('index.html?v=' + VERSION)))
        );
        return;
    }

    // 2) Estáticos same-origin: cache-first (CSS/JS/IMG/FONT)
    if (url.origin === self.location.origin && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
        e.respondWith(
            caches.match(req).then(r => r || fetch(req).then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(req, copy));
                return res;
            }))
        );
        return;
    }

    // 3) JSON same-origin: network-first con fallback a caché (para ver actualizaciones)
    if (url.origin === self.location.origin && url.pathname.endsWith('.json')) {
        e.respondWith(
            fetch(req).then(res => {
                caches.open(CACHE).then(c => c.put(req, res.clone()));
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // 4) Por defecto: intentá red y si no, caché
    e.respondWith(fetch(req).catch(() => caches.match(req)));
});

// soporte para actualizar en caliente si querés llamarlo desde tu app
self.addEventListener('message', (e) => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});