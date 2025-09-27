// ===================== CONFIG & ELEMENTOS =====================
// ---- HOTFIX legacy: evita ReferenceError si alguna versión vieja llama safeShow() ----
window.safeShow = window.safeShow || function () {
    const pop = document.getElementById('infoPopup');
    if (!pop) return;
    pop.classList.remove('is-hidden');
    // autocierre a los 10s (igual que el popup real)
    setTimeout(() => pop.classList.add('is-hidden'), 15000);
};
console.log('app.js hotfix loaded');  // para verificar que esta versión cargó

const DATA_URL = '/contacts.json';

const el = {
    search: document.getElementById('search'),
    sortBy: document.getElementById('sortBy'),
    minStars: document.getElementById('minStars'),
    minStarsOut: document.getElementById('minStarsOut'),
    list: document.getElementById('list'),
    azIndex: document.getElementById('azIndex'),
    installBtn: document.getElementById('installBtn'),
};

let raw = [];
let deferredPrompt = null;

// ===================== A2HS =====================
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el.installBtn.hidden = false;
});

el.installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    el.installBtn.hidden = true;
});

// ===================== SERVICE WORKER (único) =====================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
        const { from, event, args } = e.data || {};
        if (from === 'sw') console.log('[SW msg]', event, ...(args || []));
    });

    (async () => {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) location.reload();
                });
            });
        } catch (err) {
            console.error('SW registration failed:', err);
        }
    })();
}

// ===================== CARGA DE DATOS =====================
fetch(DATA_URL)
    .then(r => r.json())
    .then(json => { raw = json; render(); buildAZ(); })
    .catch(err => {
        console.error('No se pudo cargar contacts.json', err);
        raw = [];
        render();
    });

// ===================== FILTROS =====================
[el.search, el.sortBy, el.minStars].forEach(i => i.addEventListener('input', render));
el.minStars.addEventListener('input', () => el.minStarsOut.textContent = el.minStars.value);

// ===================== HELPERS DE RENDER =====================
function normalize(s) { return (s || '').toString().toLowerCase(); }

function matchesQuery(c, q) {
    if (!q) return true;
    const blob = [c.service, c.name, c.description, c.address, c.phone1, c.phone2, c.whatsapp, c.website, c.email]
        .map(normalize).join(' ');
    return blob.includes(q);
}

function render() {
    const q = normalize(el.search.value);
    const sortBy = el.sortBy.value;       // 'name' | 'service'
    const minStars = parseInt(el.minStars.value, 10) || 0;

    const data = raw
        .filter(c => (c.stars ?? 0) >= minStars)
        .filter(c => matchesQuery(c, q))
        .slice()
        .sort((a, b) => normalize(a[sortBy]).localeCompare(normalize(b[sortBy])) ||
            normalize(a.name).localeCompare(normalize(b.name)));

    // Agrupar por letra inicial
    const groups = {};
    for (const c of data) {
        const key = (normalize(c[sortBy])[0] || '#').toUpperCase();
        (groups[key] ||= []).push(c);
    }

    const letters = Object.keys(groups).sort();
    el.list.innerHTML = letters.map(letter => sectionHTML(letter, groups[letter], q)).join('');
}

function sectionHTML(letter, items, q) {
    return `
<section class="section" id="${letter}">
  <div class="section-header"><strong>${letter}</strong> · ${items.length} contacto(s)</div>
  <div class="grid">
    ${items.map(c => cardHTML(c, q)).join('')}
  </div>
</section>`;
}

function highlight(text, q) {
    if (!q) return escapeHTML(text);
    const idx = normalize(text).indexOf(q);
    if (idx === -1) return escapeHTML(text);
    const end = idx + q.length;
    return `${escapeHTML(text.slice(0, idx))}<span class="highlight">${escapeHTML(text.slice(idx, end))}</span>${escapeHTML(text.slice(end))}`;
}

function escapeHTML(s) {
    return (s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function starHTML(n) {
    const v = Math.max(0, Math.min(5, n | 0));
    return `<span class="stars">${Array.from({ length: 5 }, (_, i) => `<span class="star" aria-hidden="true">${i < v ? '★' : '☆'}</span>`).join('')}</span>`;
}

function telLink(num) { return num ? `<a href="tel:${num}">Tel: ${escapeHTML(num)}</a>` : '' }
function waLink(num) {
    if (!num) return '';
    const digits = String(num).replace(/\D+/g, '');
    return `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>`;
}

function cardHTML(c, q) {
    return `
<article class="card">
  <h3>${highlight(c.name || '', q)}</h3>
  <div class="meta">
    <span class="chip">${escapeHTML(c.service || 'Servicio')}</span>
    <span title="Calificación">${starHTML(c.stars || 0)}</span>
  </div>
  ${c.description ? `<p class="desc">${highlight(c.description, q)}</p>` : ''}
  ${c.address ? `<p class="addr">📍 ${highlight(c.address, q)}</p>` : ''}
  <div class="actions">
    ${telLink(c.phone1)}
    ${telLink(c.phone2)}
    ${waLink(c.whatsapp)}
    ${c.email ? `<a href="mailto:${escapeHTML(c.email)}">Email</a>` : ''}
    ${c.website ? `<a href="${escapeHTML(c.website)}" target="_blank" rel="noopener">Website</a>` : ''}
  </div>
</article>`;
}

function buildAZ() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    el.azIndex.innerHTML = letters.map(L => `<a href="#${L}">${L}</a>`).join('');
}

// ===================== SPLASH (2s) + EVENTO =====================
(() => {
    const SPLASH_MIN_MS = 2000;
    const start = performance.now();

    const finish = () => {
        window.dispatchEvent(new Event('splash:done'));
    };

    const hideSplash = () => {
        const node = document.getElementById('splash');
        if (!node) return finish();
        node.classList.add('is-hidden');
        const done = () => { node.removeEventListener('transitionend', done); finish(); };
        node.addEventListener('transitionend', done);
        setTimeout(done, 600); // por si no hay transición
    };

    const go = () => {
        const elapsed = performance.now() - start;
        setTimeout(hideSplash, Math.max(0, SPLASH_MIN_MS - elapsed));
    };

    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
})();


// ===================== POPUP (10s, 1 vez por día, tras el splash) =====================
(() => {
    const INFO_SHOW_MS = 10_000;                 // visible por 10s
    const STORAGE_KEY = 'infoPopupLastShownDay';
    const pop = document.getElementById('infoPopup');
    if (!pop) return;

    const ok = document.getElementById('popDismiss');
    const link = document.getElementById('whatsGroup');
    const WHATSAPP_GROUP_URL = '';               // ← poné el link del grupo (o dejá vacío para ocultar el botón)

    if (!WHATSAPP_GROUP_URL && link) link.remove();
    if (WHATSAPP_GROUP_URL && link) link.href = WHATSAPP_GROUP_URL;

    const todayKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const shouldShow = () => {
        try { return (localStorage.getItem(STORAGE_KEY) || '') !== todayKey(); }
        catch { return true; }
    };

    let timer;
    const hide = () => {
        pop.classList.add('is-hidden');
        clearTimeout(timer);
        document.removeEventListener('keydown', onEsc);
        pop.removeEventListener('click', onBackdrop);
    };
    const show = () => {
        pop.classList.remove('is-hidden');
        clearTimeout(timer);
        timer = setTimeout(hide, INFO_SHOW_MS);
        document.addEventListener('keydown', onEsc);
        pop.addEventListener('click', onBackdrop);
        try { localStorage.setItem(STORAGE_KEY, todayKey()); } catch { }
    };
    const onEsc = (e) => { if (e.key === 'Escape') hide(); };
    const onBackdrop = (e) => { if (e.target === pop) hide(); };
    ok?.addEventListener('click', hide);


    // Exponer para legacy/debug:
    window.__showInfoPopup = show;
    window.__hideInfoPopup = hide;
    window.safeShow = () => show();   // shim: si algo llama safeShow(), usa show()

    // --- Arranque: NO mostrar al toque del splash ---
    const DEFER_MS = 5000; // ⬅️ espera mínima tras el splash (ajustá a gusto)

    const armPopup = () => {
        if (!shouldShow()) return;

        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            cleanup();
            show();
        };

        // 1) Fallback por tiempo (si no hay interacción en DEFER_MS)
        const t = setTimeout(fire, DEFER_MS);

        // 2) O mostrar al primer gesto del usuario (scroll/click/tecla)
        const onInteract = () => fire();
        const cleanup = () => {
            clearTimeout(t);
            window.removeEventListener('scroll', onInteract, true);
            window.removeEventListener('pointerdown', onInteract, true);
            window.removeEventListener('keydown', onInteract, true);
            window.removeEventListener('touchstart', onInteract, true);
        };

        window.addEventListener('scroll', onInteract, { once: true, capture: true });
        window.addEventListener('pointerdown', onInteract, { once: true, capture: true });
        window.addEventListener('keydown', onInteract, { once: true, capture: true });
        window.addEventListener('touchstart', onInteract, { once: true, capture: true });
    };

    // Esperá a que termine el splash y recién ahí armá el popup
    if (document.getElementById('splash')) {
        window.addEventListener('splash:done', () => armPopup(), { once: true });
        // Por si el evento no llega, armá igual a los ~3s
        setTimeout(() => armPopup(), 3000);
    } else {
        // Si no hay splash, arrancá normal con el mismo diferido/gesto
        armPopup();
    }
})();

