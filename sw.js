const VERSION = 'v16-debug';
const CACHE = `pwa-contactos-${VERSION}`;
const SHELL = [
    '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
    '/assets/terra.jpg', '/contacts.json'
];

const DEBUG = false;
function log(event, ...args) {
    if (!DEBUG) return;
    // Consola del SW
    console.log('[SW]', event, ...args);
    // Reenviar a las ventanas para ver en la consola de la página
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(cs => {
        cs.forEach(c => c.postMessage({
            from: 'sw', event, args: args.map(a => {
                try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
            })
        }));
    }).catch(() => { });
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        for (const url of SHELL) {
            try {
                const req = new Request(url, { cache: 'no-store' });
                const res = await fetch(req);
                if (!res.ok) { log('install:not-ok', url, res.status, res.statusText); continue; }
                await cache.put(req, res.clone());
                log('install:cached', url);
            } catch (err) {
                log('install:ERROR', url, String(err));
            }
        }
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
        log('activate:ready', CACHE);
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Navegaciones
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try { const r = await fetch(req); log('fetch:navigate:net', req.url); return r; }
            catch { log('fetch:navigate:OFFLINE->index.html'); return (await caches.match('/index.html')) || Response.error(); }
        })());
        return;
    }

    // Estáticos propios
    if (url.origin === self.location.origin && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
        event.respondWith((async () => {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) { log('fetch:static:cache', url.pathname); return hit; }
            try {
                const res = await fetch(req);
                (await caches.open(CACHE)).put(req, res.clone());
                log('fetch:static:net->cache', url.pathname);
                return res;
            } catch (err) {
                log('fetch:static:ERROR', url.pathname, String(err));
                return (await caches.match('/index.html')) || Response.error();
            }
        })());
        return;
    }

    // JSON propios
    if (url.origin === self.location.origin && url.pathname.endsWith('.json')) {
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                (await caches.open(CACHE)).put(req, res.clone());
                log('fetch:json:net->cache', url.pathname, res.status);
                return res;
            } catch (err) {
                const fb = await caches.match(req, { ignoreSearch: true });
                if (fb) { log('fetch:json:FALLBACK cache', url.pathname); return fb; }
                log('fetch:json:MISS', url.pathname, String(err));
                return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
            }
        })());
        return;
    }

    // Otros
    event.respondWith(fetch(req).catch(async (err) => {
        log('fetch:other:ERROR', req.url, String(err));
        return (await caches.match(req, { ignoreSearch: true })) || Response.error();
    }));
});