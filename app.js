const DATA_URL = './contacts.json';
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


window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el.installBtn.hidden = false;
});


el.installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice; // resultado no necesario
    deferredPrompt = null;
    el.installBtn.hidden = true;
});
// Service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
}


fetch(DATA_URL)
    .then(r => r.json())
    .then(json => { raw = json; render(); buildAZ(); })
    .catch(err => {
        console.error('No se pudo cargar contacts.json', err);
        raw = [];
        render();
    });


[el.search, el.sortBy, el.minStars].forEach(i => i.addEventListener('input', render));
el.minStars.addEventListener('input', () => el.minStarsOut.textContent = el.minStars.value);


function normalize(s) { return (s || '').toString().toLowerCase(); }


function matchesQuery(c, q) {
    if (!q) return true;
    const blob = [c.service, c.name, c.description, c.address, c.phone1, c.phone2, c.whatsapp, c.website, c.email]
        .map(normalize).join(' ');
    return blob.includes(q);
}

function render() {
    const q = normalize(el.search.value);
    const sortBy = el.sortBy.value; // 'name' | 'service'
    const minStars = parseInt(el.minStars.value, 10) || 0;


    const data = raw
        .filter(c => (c.stars ?? 0) >= minStars)
        .filter(c => matchesQuery(c, q))
        .slice()
        .sort((a, b) => normalize(a[sortBy]).localeCompare(normalize(b[sortBy])) || normalize(a.name).localeCompare(normalize(b.name)));


    // Agrupar por letra inicial del campo de orden
    const groups = {};
    for (const c of data) {
        const key = (normalize(c[sortBy])[0] || '#').toUpperCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
${waLink(c.whatsapp || c.phone1)}
${c.email ? `<a href="mailto:${escapeHTML(c.email)}">Email</a>` : ''}
${c.website ? `<a href="${escapeHTML(c.website)}" target="_blank" rel="noopener">Website</a>` : ''}
</div>
</article>
`;
}


function buildAZ() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    el.azIndex.innerHTML = letters.map(L => `<a href="#${L}">${L}</a>`).join('');
}