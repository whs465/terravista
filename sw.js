const VERSION = 'v6-2025-09-23';             // ⬅️ cambia al desplegar
const CACHE = `pwa-contactos-${VERSION}`;

const base = self.registration.scope;
const A = (p) => new URL(p, base).toString();

const ASSETS = [
    A('index.html?v=' + VERSION),
    A('styles.css?v=' + VERSION),
    A('app.js?v=' + VERSION),
    A('contacts.json?v=' + VERSION),
    A('manifest.webmanifest?v=' + VERSION),
];

self.addEventListener('install', (e) => {
    self.skipWaiting(); // toma control sin esperar
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// JSON: network-first (para ver cambios), estáticos: cache-first
self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);

    if (url.pathname.endsWith('.json')) {
        e.respondWith(
            fetch(req)
                .then(res => { caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })
                .catch(() => caches.match(req))
        );
    } else {
        e.respondWith(caches.match(req).then(r => r || fetch(req)));
    }
});

self.addEventListener('message', (e) => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});