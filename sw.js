const SHELL = [
    A('index.html'),
    A('styles.css'),
    A('app.js'),
    A('manifest.webmanifest'),
    A('assets/terra.jpg'),
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        // Cache del app shell (no usamos ?v=... para que los matches funcionen offline)
        await c.addAll(SHELL.filter(Boolean));

        // Intentá precachear datos si existen (no falla si falta alguno)
        for (const p of ['contacts.json', 'contacts.example.json']) {
            try {
                const res = await fetch(A(p), { cache: 'no-store' });
                if (res.ok) await c.put(A(p), res);
            } catch { /* ignore */ }
        }
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);

    // 1) Navegaciones: si no hay red, devolvé el index cacheado
    if (req.mode === 'navigate') {
        e.respondWith((async () => {
            try {
                return await fetch(req);
            } catch {
                return (await caches.match(A('index.html'), { ignoreSearch: true })) || Response.error();
            }
        })());
        return;
    }

    // 2) Estáticos same-origin: cache-first (ignora query ?v=)
    if (url.origin === self.location.origin && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
        e.respondWith((async () => {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            try {
                const res = await fetch(req);
                const c = await caches.open(CACHE);
                c.put(req, res.clone());
                return res;
            } catch {
                return await caches.match(A('index.html'), { ignoreSearch: true });
            }
        })());
        return;
    }

    // 3) JSON same-origin: network-first con fallback cache (ignora ?)
    if (url.origin === self.location.origin && url.pathname.endsWith('.json')) {
        e.respondWith((async () => {
            try {
                const res = await fetch(req);
                const c = await caches.open(CACHE);
                c.put(req, res.clone());
                return res;
            } catch {
                return (await caches.match(req, { ignoreSearch: true })) || new Response('[]', { headers: { 'Content-Type': 'application/json' } });
            }
        })());
        return;
    }

    // 4) Por defecto: red, y si falla, intentá caché directo
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
});

// opcional: permitir que la app fuerce el update
self.addEventListener('message', (e) => {
    if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});