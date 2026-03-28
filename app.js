window.safeShow = window.safeShow || function () {
    const pop = document.getElementById('infoPopup');
    if (!pop) return;
    pop.classList.remove('is-hidden');
    setTimeout(() => pop.classList.add('is-hidden'), 15000);
};

const DATA_URL = new URL('./contacts.json', window.location.href).toString();
const TIPS_URL = new URL('./tips.json', window.location.href).toString();
const APP_SHARE_URL = 'https://terravista166.vercel.app/';
const LAST_TIP_STORAGE_KEY = 'terravista:lastTipIndex';
const APP_INSTALLED_STORAGE_KEY = 'terravista:appInstalled';

const el = {
    search: document.getElementById('search'),
    sortBy: document.getElementById('sortBy'),
    list: document.getElementById('list'),
    azIndex: document.getElementById('azIndex'),
    installBtn: document.getElementById('installBtn'),
    quickFilters: document.getElementById('quickFilters'),
    tipTicker: document.getElementById('tipTicker'),
    tipTickerText: document.getElementById('tipTickerText'),
};

let raw = [];
let deferredPrompt = null;
let activeFilter = 'all';
let favorites = loadFavorites();
let activeLetters = [];
let listAnimationTimer = null;
let tips = ['Cuidemos entre todos los espacios que compartimos.'];
let tipIndex = pickNextTipIndex();

syncInstallButtonVisibility();
window.addEventListener('pageshow', syncInstallButtonVisibility);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncInstallButtonVisibility();
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isInstallButtonSuppressed()) {
        deferredPrompt = null;
        syncInstallButtonVisibility();
        return;
    }
    deferredPrompt = e;
    syncInstallButtonVisibility();
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    persistInstalledState(true);
    syncInstallButtonVisibility();
});

el.installBtn?.addEventListener('click', async () => {
    if (isInstallButtonSuppressed()) {
        deferredPrompt = null;
        syncInstallButtonVisibility();
        return;
    }
    if (!deferredPrompt) {
        syncInstallButtonVisibility();
        return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
        persistInstalledState(true);
    }
    deferredPrompt = null;
    syncInstallButtonVisibility();
});

renderTip();

fetch(TIPS_URL)
    .then(r => r.json())
    .then(json => {
        if (Array.isArray(json) && json.length) {
            tips = json.map(item => (item || '').toString().trim()).filter(Boolean);
            tipIndex = pickNextTipIndex();
            renderTip();
        }
    })
    .catch(() => { });

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
    .then(json => { raw = mergeContacts(json); renderQuickFilters(); render(); buildAZ(); })
    .catch(err => {
        console.error('No se pudo cargar contacts.json', err);
        raw = [];
        renderQuickFilters();
        render();
    });

el.search?.addEventListener('input', onSearchInput);
el.sortBy?.addEventListener('input', render);
el.quickFilters?.addEventListener('click', onQuickFilterClick);
document.addEventListener('click', onDocumentClick);

function normalize(s) { return (s || '').toString().toLowerCase(); }

function normalizeServices(service) {
    if (Array.isArray(service)) return service.map(item => (item || '').toString().trim()).filter(Boolean);
    return (service || '')
        .toString()
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function primaryService(contact) {
    return normalize(contact.services?.[0] || contact.service || '');
}

function matchesQuery(c, q) {
    if (!q) return true;
    const blob = [c.services?.join(' '), c.name, c.description, c.address, c.phone1, c.phone2, c.whatsapp, c.website, c.email]
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
        .sort((a, b) => getSortValue(a, sortBy).localeCompare(getSortValue(b, sortBy)) ||
            normalize(a.name).localeCompare(normalize(b.name)));

    const groups = {};
    for (const c of data) {
        const key = (getSortValue(c, sortBy)[0] || '#').toUpperCase();
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

function iconAsset(name, alt = '') {
    const files = {
        phone: './assets/phone.svg',
        whatsapp: './assets/whatsapp.svg',
        map: './assets/map-pin.svg',
        email: './assets/email.svg',
        share: './assets/share.svg',
        favorite: './assets/favorite.svg',
    };
    if (name === 'web') {
        return '<svg class="action-icon-svg action-icon-svg--web" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"></circle><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"></path></svg>';
    }
    if (!files[name]) return '';
    return `<img class="action-icon-image" src="${files[name]}" alt="${escapeHTML(alt)}" width="32" height="32" loading="lazy" decoding="async">`;
}

function actionLink({ href, icon, label, className = '', target = '', rel = '', dataAttrs = '' }) {
    const classes = ['btn', 'action-btn', className].filter(Boolean).join(' ');
    return `<a class="${classes}" href="${escapeHTML(href)}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"${target ? ` target="${target}"` : ''}${rel ? ` rel="${rel}"` : ''}${dataAttrs}>${iconAsset(icon, '')}</a>`;
}

function telLink(num) {
    if (!num) return '';
    return actionLink({
        href: `tel:${num}`,
        icon: 'phone',
        label: `Llamar ${num}`,
        className: 'action-btn--phone',
    });
}

function waLink(num) {
    if (!num) return '';
    const digits = String(num).replace(/\D+/g, '');
    return actionLink({
        href: `https://wa.me/${digits}`,
        icon: 'whatsapp',
        label: 'Abrir WhatsApp',
        className: 'action-btn--whatsapp',
        target: '_blank',
        rel: 'noopener',
    });
}

function mapButtonHTML(contact) {
    const coords = getCoordinates(contact);
    if (!coords) return '';
    const webHref = mapWebLink(contact, coords);
    const geoHref = mapGeoLink(contact, coords);
    return actionLink({
        href: webHref,
        icon: 'map',
        label: `Abrir mapa de ${contact.name || contact.address || 'ubicacion'}`,
        className: 'action-btn--map',
        target: '_blank',
        rel: 'noopener',
        dataAttrs: ` data-map-web="${escapeHTML(webHref)}" data-map-geo="${escapeHTML(geoHref)}"`,
    });
}

function mapWebLink(contact, coords = getCoordinates(contact)) {
    if (!coords) return '';
    const { lat, lng } = coords;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

function mapGeoLink(contact, coords = getCoordinates(contact)) {
    if (!coords) return '';
    const { lat, lng } = coords;
    const label = encodeURIComponent((contact.name || contact.address || 'Ubicacion').trim());
    return `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
}

function getCoordinates(contact) {
    const lat = normalizeCoordinate(contact.lat);
    const lng = normalizeCoordinate(contact.lng);
    if (lat == null || lng == null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

function normalizeCoordinate(value) {
    if (value === '' || value == null) return null;
    const normalized = Number(String(value).replace(',', '.').trim());
    return Number.isFinite(normalized) ? normalized : null;
}

function isMobileDevice() {
    return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
}

function cardHTML(c, q) {
    const id = contactId(c);
    const isFavorite = favorites.includes(id);
    return `
<article class="card">
  <div class="card-tools">
    <button class="share-toggle" type="button" data-share-contact="${id}" aria-label="Compartir contacto">
      ${iconAsset('share', '')}
    </button>
    <button class="favorite-toggle ${isFavorite ? 'is-active' : ''}" type="button" data-favorite-toggle="${id}" aria-label="${isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-pressed="${isFavorite}">
      ${iconAsset('favorite', '')}
    </button>
  </div>
  <h3>${highlight(c.name || '', q)}</h3>
  <div class="meta">
    ${serviceChipsHTML(c.services || [])}
  </div>
  ${c.description ? `<p class="desc">${highlight(c.description, q)}</p>` : ''}
  ${c.address ? `<p class="addr">📍 ${highlight(c.address, q)}</p>` : ''}
  <p class="share-feedback" data-share-feedback="${id}" aria-live="polite"></p>
  <div class="actions">
    ${telLink(c.phone1)}
    ${telLink(c.phone2)}
    ${waLink(c.whatsapp)}
    ${mapButtonHTML(c)}
    ${c.email ? actionLink({ href: `mailto:${c.email}`, icon: 'email', label: `Enviar email a ${c.email}`, className: 'action-btn--email action-btn--outline' }) : ''}
    ${c.website ? actionLink({ href: c.website, icon: 'web', label: `Abrir sitio web de ${c.name || 'contacto'}`, className: 'action-btn--web action-btn--outline', target: '_blank', rel: 'noopener' }) : ''}
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
    const services = Array.from(new Set(raw.flatMap(c => c.services || [])))
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
    if (activeFilter.startsWith('service:')) return (contact.services || []).includes(activeFilter.slice(8));
    return true;
}

function onQuickFilterClick(event) {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter || 'all';
    renderQuickFilters();
    render();
}

function onSearchInput() {
    if (activeFilter !== 'all') {
        activeFilter = 'all';
        renderQuickFilters();
    }
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
        return;
    }

    const mapLink = event.target.closest('[data-map-web]');
    if (mapLink) {
        handleMapClick(event, mapLink);
    }
}

function handleMapClick(event, link) {
    const webHref = link.dataset.mapWeb || link.href;
    const geoHref = link.dataset.mapGeo || '';
    if (!geoHref || !isMobileDevice()) return;

    event.preventDefault();
    event.stopPropagation();

    let navigated = false;
    const fallbackTimer = window.setTimeout(() => {
        if (navigated) return;
        window.open(webHref, '_blank', 'noopener');
    }, 700);

    const cancelFallback = () => {
        navigated = true;
        window.clearTimeout(fallbackTimer);
        window.removeEventListener('pagehide', cancelFallback);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') cancelFallback();
    };

    window.addEventListener('pagehide', cancelFallback, { once: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.location.href = geoHref;
}

function toggleFavorite(id) {
    if (!id) return;
    const isAdding = !favorites.includes(id);
    favorites = favorites.includes(id)
        ? favorites.filter(favoriteId => favoriteId !== id)
        : [id, ...favorites];
    if (activeFilter === 'favorites' && favorites.length === 0) {
        activeFilter = 'all';
    }
    saveFavorites();
    renderQuickFilters();
    render();
    return isAdding;
}

function contactId(contact) {
    return [contact.name, contact.phone1 || contact.whatsapp || contact.email || contact.website || '']
        .map(normalize)
        .filter(Boolean)
        .join('::');
}

function getSortValue(contact, sortBy) {
    if (sortBy === 'service') return primaryService(contact);
    return normalize(contact[sortBy]);
}

function serviceChipsHTML(services) {
    return services.map(service => `<span class="chip">${escapeHTML(service)}</span>`).join('');
}

function mergeContacts(items) {
    const map = new Map();

    for (const item of Array.isArray(items) ? items : []) {
        const services = normalizeServices(item.services || item.service);
        const key = contactId({ ...item, service: '', services: [] });
        const existing = map.get(key);

        if (!existing) {
            map.set(key, {
                ...item,
                service: services[0] || normalizeServices(item.service)[0] || '',
                services,
            });
            continue;
        }

        existing.services = Array.from(new Set([...(existing.services || []), ...services]));
        existing.service = existing.services[0] || existing.service || '';
        existing.description = longestText(existing.description, item.description);
        existing.address = existing.address || item.address;
        existing.phone1 = existing.phone1 || item.phone1;
        existing.phone2 = existing.phone2 || item.phone2;
        existing.whatsapp = existing.whatsapp || item.whatsapp;
        existing.website = existing.website || item.website;
        existing.email = existing.email || item.email;
        existing.lat = existing.lat ?? item.lat;
        existing.lng = existing.lng ?? item.lng;
    }

    return Array.from(map.values());
}

function longestText(a, b) {
    return (b || '').length > (a || '').length ? b : a;
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
    const servicesLabel = (contact.services && contact.services.length ? contact.services.join(', ') : contact.service) || 'Servicio';
    const lines = [
        'Les comparto este contacto del Directorio Terravista:',
        '',
        `${servicesLabel} - ${contact.name || 'Contacto'}`,
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

function renderTip() {
    if (!el.tipTicker || !el.tipTickerText || !tips.length) return;
    el.tipTickerText.classList.remove('is-visible');
    window.setTimeout(() => {
        el.tipTickerText.textContent = tips[tipIndex];
        el.tipTickerText.classList.add('is-visible');
    }, 90);
}

function pickNextTipIndex() {
    if (!tips.length) return 0;
    if (tips.length === 1) {
        persistLastTipIndex(0);
        return 0;
    }

    const lastTipIndex = loadLastTipIndex();
    let nextIndex = Math.floor(Math.random() * tips.length);
    if (Number.isInteger(lastTipIndex) && tips.length > 1) {
        while (nextIndex === lastTipIndex) {
            nextIndex = Math.floor(Math.random() * tips.length);
        }
    }

    persistLastTipIndex(nextIndex);
    return nextIndex;
}

function loadLastTipIndex() {
    try {
        const stored = Number(localStorage.getItem(LAST_TIP_STORAGE_KEY));
        return Number.isInteger(stored) ? stored : null;
    } catch {
        return null;
    }
}

function persistLastTipIndex(index) {
    try {
        localStorage.setItem(LAST_TIP_STORAGE_KEY, String(index));
    } catch { }
}

function syncInstallButtonVisibility() {
    if (!el.installBtn) return;
    el.installBtn.hidden = isInstallButtonSuppressed() || !deferredPrompt;
}

function isInstallButtonSuppressed() {
    return isRunningAsInstalledApp() || loadInstalledState();
}

function isRunningAsInstalledApp() {
    return window.matchMedia?.('(display-mode: standalone)').matches ||
        window.matchMedia?.('(display-mode: fullscreen)').matches ||
        window.matchMedia?.('(display-mode: minimal-ui)').matches ||
        window.navigator.standalone === true ||
        document.referrer.startsWith('android-app://');
}

function loadInstalledState() {
    try {
        return localStorage.getItem(APP_INSTALLED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function persistInstalledState(installed) {
    try {
        if (installed) localStorage.setItem(APP_INSTALLED_STORAGE_KEY, 'true');
        else localStorage.removeItem(APP_INSTALLED_STORAGE_KEY);
    } catch { }
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
