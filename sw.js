const CACHE = 'pwa-contactos-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/contacts.json',
    '/manifest.webmanifest'
];


self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});


self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    );
});


self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    // Estrategia: cache-first para estáticos, network-first para JSON (para poder actualizar datos)
    if (url.pathname.endsWith('.json')) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    }
});