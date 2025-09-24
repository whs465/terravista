const SHELL = [
    A('index.html'),
    A('styles.css'),
    A('contacts.json'),
    A('app.js'),
    A('manifest.webmanifest'),
    A('assets/terra.jpg'),
];
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        // Si alguno falla, no abortamos toda la instalación
        for (const url of SHELL) {
            try { await c.add(url); } catch (err) { /* ignora faltantes */ }
        }
        // Precacha datos si existe (opcional)
        for (const p of ['contacts.json', 'contacts.example.json']) {
            try {
                const res = await fetch(A(p), { cache: 'no-store' });
                if (res.ok) await c.put(A(p), res);
            } catch { }
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

    // 1) Navegaciones: si no hay red, devolvé index cacheado
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

    // 2) Estáticos same-origin: cache-first (ignora ?v=)
    if (url.origin === self.location.origin && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
        e.respondWith((async () => {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            try {
                const res = await fetch(req);
                (await caches.open(CACHE)).put(req, res.clone());
                return res;
            } catch {
                // En caída, intenta index para no reventar la vista
                return (await caches.match(A('index.html'), { ignoreSearch: true })) || Response.error();
            }
        })());
        return;
    }

    // 3) JSON same-origin: network-first con fallback
    if (url.origin === self.location.origin && url.pathname.endsWith('.json')) {
        e.respondWith((async () => {
            try {
                const res = await fetch(req);
                (await caches.open(CACHE)).put(req, res.clone());
                return res;
            } catch {
                return (await caches.match(req, { ignoreSearch: true })) || new Response('[]', { headers: { 'Content-Type': 'application/json' } });
            }
        })());
        return;
    }

    // 4) Resto: red; si falla, intenta caché
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
});