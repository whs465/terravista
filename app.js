window.safeShow = window.safeShow || function () {
    const pop = document.getElementById('infoPopup');
    if (!pop) return;
    pop.classList.remove('is-hidden');
    setTimeout(() => pop.classList.add('is-hidden'), 15000);
};

const DATA_URL = new URL('./contacts.json', window.location.href).toString();
const APP_SHARE_URL = 'https://terravista166.vercel.app/';

const el = {
    search: document.getElementById('search'),
    sortBy: document.getElementById('sortBy'),
    list: document.getElementById('list'),
    azIndex: document.getElementById('azIndex'),
    installBtn: document.getElementById('installBtn'),
    quickFilters: document.getElementById('quickFilters'),
};

let raw = [];
let deferredPrompt = null;
let activeFilter = 'all';
let favorites = loadFavorites();
let activeLetters = [];
let listAnimationTimer = null;

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

fetch(DATA_URL)
    .then(r => r.json())
    .then(json => { raw = json; renderQuickFilters(); render(); buildAZ(); })
    .catch(err => {
        console.error('No se pudo cargar contacts.json', err);
        raw = [];
        renderQuickFilters();
        render();
    });

['search', 'sortBy'].forEach(key => el[key].addEventListener('input', render));
el.quickFilters?.addEventListener('click', onQuickFilterClick);
document.addEventListener('click', onDocumentClick);

function normalize(s) { return (s || '').toString().toLowerCase(); }

function matchesQuery(c, q) {
    if (!q) return true;
    const blob = [c.service, c.name, c.description, c.address, c.phone1, c.phone2, c.whatsapp, c.website, c.email]
        .map(normalize).join(' ');
    return blob.includes(q);
}

function render() {
    animateListRefresh();

    const q = normalize(el.search.value);
    const sortBy = el.sortBy.value;

    const data = raw
        .filter(c => matchesQuery(c, q))
        .filter(c => matchesActiveFilter(c))
        .slice()
        .sort((a, b) => normalize(a[sortBy]).localeCompare(normalize(b[sortBy])) ||
            normalize(a.name).localeCompare(normalize(b.name)));

    const groups = {};
    for (const c of data) {
        const key = (normalize(c[sortBy])[0] || '#').toUpperCase();
        (groups[key] ||= []).push(c);
    }

    const letters = Object.keys(groups).sort();
    activeLetters = letters;
    if (!letters.length) {
        el.list.innerHTML = emptyStateHTML();
        buildAZ();
        return;
    }
    el.list.innerHTML = letters.map(letter => sectionHTML(letter, groups[letter], q)).join('');
    buildAZ();
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

function telLink(num) { return num ? `<a class="btn" href="tel:${num}">Tel: ${escapeHTML(num)}</a>` : '' }

function waLink(num) {
    if (!num) return '';
    const digits = String(num).replace(/\D+/g, '');
    return `<a class="btn btn-primary" href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>`;
}


function cardHTML(c, q) {
    const id = contactId(c);
    const isFavorite = favorites.includes(id);
    return `
<article class="card">
  <div class="card-tools">
    <button class="share-toggle" type="button" data-share-contact="${id}" aria-label="Compartir contacto">
      <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M15 5l-1.41 1.41 2.58 2.59H8a4 4 0 000 8h1v-2H8a2 2 0 010-4h8.17l-2.58 2.59L15 15l5-5-5-5z"></path>
      </svg>
    </button>
    <button class="favorite-toggle ${isFavorite ? 'is-active' : ''}" type="button" data-favorite-toggle="${id}" aria-label="${isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-pressed="${isFavorite}">
      <span aria-hidden="true">${isFavorite ? '★' : '☆'}</span>
    </button>
  </div>
  <h3>${highlight(c.name || '', q)}</h3>
  <div class="meta">
    <span class="chip">${escapeHTML(c.service || 'Servicio')}</span>
  </div>
  ${c.description ? `<p class="desc">${highlight(c.description, q)}</p>` : ''}
  ${c.address ? `<p class="addr">📍 ${highlight(c.address, q)}</p>` : ''}
  <p class="share-feedback" data-share-feedback="${id}" aria-live="polite"></p>
  <div class="actions">
    ${telLink(c.phone1)}
    ${telLink(c.phone2)}
    ${waLink(c.whatsapp)}
    ${c.email ? `<a class="btn outline" href="mailto:${escapeHTML(c.email)}">Email</a>` : ''}
    ${c.website ? `<a class="btn outline" href="${escapeHTML(c.website)}" target="_blank" rel="noopener">Web</a>` : ''}
  </div>
</article>`;
}

function buildAZ() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const enabled = new Set(activeLetters);
    el.azIndex.innerHTML = letters.map(L => `
<a href="#${L}" class="${enabled.has(L) ? '' : 'is-disabled'}" aria-disabled="${enabled.has(L) ? 'false' : 'true'}">${L}</a>`).join('');
}

function emptyStateHTML() {
    if (activeFilter === 'favorites' && favorites.length === 0) {
        return `
<section class="empty-state">
  <h2>Aún no tienes favoritos</h2>
  <p>Marca contactos con la estrella de cada tarjeta y aparecerán aquí.</p>
</section>`;
    }

    return `
<section class="empty-state">
  <h2>No encontramos resultados</h2>
  <p>Prueba con otro término de búsqueda o baja el filtro de estrellas.</p>
</section>`;
}

function renderQuickFilters() {
    if (!el.quickFilters) return;
    const services = Array.from(new Set(raw.map(c => (c.service || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'es'));
    const favoriteCount = favorites.length;
    const buttons = [
        { key: 'favorites', label: favoriteCount ? `★ ${favoriteCount}` : '★', ariaLabel: 'Favoritos' },
        { key: 'all', label: 'Todo' },
        ...services.map(service => ({ key: `service:${service}`, label: service })),
    ];

    el.quickFilters.innerHTML = buttons.map(({ key, label, ariaLabel }) => `
<button type="button" class="quick-filter ${key === 'favorites' ? 'quick-filter-icon' : ''} ${key === 'favorites' && favoriteCount ? 'has-saved' : ''} ${activeFilter === key ? 'is-active' : ''}" data-filter="${escapeHTML(key)}" aria-label="${escapeHTML(ariaLabel || label)}" title="${escapeHTML(ariaLabel || label)}">
  ${escapeHTML(label)}
</button>`).join('');
}

function matchesActiveFilter(contact) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'favorites') return favorites.includes(contactId(contact));
    if (activeFilter.startsWith('service:')) return (contact.service || '') === activeFilter.slice(8);
    return true;
}

function onQuickFilterClick(event) {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter || 'all';
    renderQuickFilters();
    render();
}

function onDocumentClick(event) {
    const favoriteButton = event.target.closest('[data-favorite-toggle]');
    if (favoriteButton) {
        event.preventDefault();
        event.stopPropagation();
        const activated = toggleFavorite(favoriteButton.dataset.favoriteToggle || '');
        if (activated) pulseFavoriteButtons(favoriteButton.dataset.favoriteToggle || '');
        return;
    }

    const shareButton = event.target.closest('[data-share-contact]');
    if (shareButton) {
        event.preventDefault();
        event.stopPropagation();
        shareContact(shareButton.dataset.shareContact || '');
    }
}

function toggleFavorite(id) {
    if (!id) return;
    const isAdding = !favorites.includes(id);
    favorites = favorites.includes(id)
        ? favorites.filter(favoriteId => favoriteId !== id)
        : [id, ...favorites];
    saveFavorites();
    renderQuickFilters();
    render();
    return isAdding;
}

function contactId(contact) {
    return [contact.service, contact.name, contact.phone1 || contact.whatsapp || contact.email || '']
        .map(normalize)
        .filter(Boolean)
        .join('::');
}

function loadFavorites() {
    try {
        const saved = JSON.parse(localStorage.getItem('terravista:favorites') || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch {
        return [];
    }
}

function saveFavorites() {
    try {
        localStorage.setItem('terravista:favorites', JSON.stringify(favorites));
    } catch { }
}

async function shareContact(id) {
    const contact = raw.find(item => contactId(item) === id);
    if (!contact) return;

    const shareText = buildShareText(contact);
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

    try {
        window.open(whatsappUrl, '_blank', 'noopener');
        showShareFeedback(id, 'Abriendo WhatsApp');
        return;
    } catch { }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareText);
            showShareFeedback(id, 'Copiado');
            return;
        }
    } catch { }

    showShareFeedback(id, 'No se pudo compartir');
}

function buildShareText(contact) {
    const lines = [
        'Les comparto este contacto del Directorio Terravista:',
        '',
        `${contact.service || 'Servicio'} - ${contact.name || 'Contacto'}`,
    ];

    if (contact.whatsapp) lines.push(`WhatsApp: ${contact.whatsapp}`);
    if (contact.phone1) lines.push(`Tel: ${contact.phone1}`);
    if (contact.phone2) lines.push(`Tel alterno: ${contact.phone2}`);
    if (contact.email) lines.push(`Email: ${contact.email}`);
    if (contact.website) lines.push(`Web: ${contact.website}`);
    if (contact.description) lines.push(`Detalle: ${contact.description}`);
    lines.push('');
    lines.push(`Directorio: ${APP_SHARE_URL}`);

    return lines.join('\n');
}

function showShareFeedback(id, message) {
    const node = document.querySelector(`[data-share-feedback="${CSS.escape(id)}"]`);
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    window.clearTimeout(node._shareTimer);
    node._shareTimer = window.setTimeout(() => {
        node.textContent = '';
        node.classList.remove('is-visible');
    }, 1800);
}

function animateListRefresh() {
    if (!el.list) return;
    el.list.classList.remove('is-refreshing');
    void el.list.offsetWidth;
    el.list.classList.add('is-refreshing');
    window.clearTimeout(listAnimationTimer);
    listAnimationTimer = window.setTimeout(() => {
        el.list.classList.remove('is-refreshing');
    }, 240);
}

function pulseFavoriteButtons(id) {
    requestAnimationFrame(() => {
        document.querySelectorAll(`[data-favorite-toggle="${CSS.escape(id)}"]`).forEach(button => {
            button.classList.remove('is-popping');
            void button.offsetWidth;
            button.classList.add('is-popping');
            window.setTimeout(() => button.classList.remove('is-popping'), 380);
        });
    });
}

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
        setTimeout(done, 600);
    };

    const go = () => {
        const elapsed = performance.now() - start;
        setTimeout(hideSplash, Math.max(0, SPLASH_MIN_MS - elapsed));
    };

    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
})();

(() => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const INFO_SHOW_MS = 16000;
    const STORAGE_KEY = 'infoPopupLastShownDay';
    const pop = document.getElementById('infoPopup');
    if (!pop) return;

    const ok = document.getElementById('popDismiss');
    const link = document.getElementById('whatsGroup');
    const WHATSAPP_GROUP_URL = '';

    if (!WHATSAPP_GROUP_URL && link) link.remove();
    if (WHATSAPP_GROUP_URL && link) link.href = WHATSAPP_GROUP_URL;

    const shouldShow = () => {
        try {
            const last = Number(localStorage.getItem(STORAGE_KEY) || 0);
            return (Date.now() - last) >= WEEK_MS;
        } catch {
            return true;
        }
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
        try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { }
    };
    const onEsc = (e) => { if (e.key === 'Escape') hide(); };
    const onBackdrop = (e) => { if (e.target === pop) hide(); };
    ok?.addEventListener('click', hide);


    window.__showInfoPopup = show;
    window.__hideInfoPopup = hide;
    window.safeShow = () => show();

    const DEFER_MS = 5000;

    const armPopup = () => {
        if (!shouldShow()) return;

        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            cleanup();
            show();
        };

        const t = setTimeout(fire, DEFER_MS);

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

    if (document.getElementById('splash')) {
        window.addEventListener('splash:done', () => armPopup(), { once: true });
        setTimeout(() => armPopup(), 3000);
    } else {
        armPopup();
    }
})();
