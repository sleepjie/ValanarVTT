/* Files: one place for everything on the site, laid out like Google Drive. Folders hold wiki pages and uploaded
 * files side by side (a page's folder in the wiki is its folder here). Admins upload, make folders, rename, move
 * (drag onto a folder), hide things from players (GM only) and delete (to the bin, restorable). Everyone else browses
 * what they're allowed to see.
 * Address: #/files/<folder>/<folder>…  ·  #/files/:bin  ·  #/files/:recent  ·  #/files/:search/<words>
 * ValanarDrive(ctx) returns the drive, plus helpers the wiki uses: a file picker and uploads. */
'use strict';
window.ValanarDrive = function (ctx) {
  const { h, $, natural, toast, escHTML } = ctx;
  const SV = window.VALANAR_SERVER || {};
  const admin = !!SV.admin;
  let data = { folders: [], files: [], pages: [] }, loaded = null;
  let cur = '', mode = 'folder', sel = new Set(), q = '';
  let layout = ctx.store.get('valanar-drive-layout') || 'grid';
  const api = (url, opts) => fetch('/api/site' + url, Object.assign({ credentials: 'same-origin' }, opts)).then(async r => {
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  });
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const load = () => (loaded = api('/drive').then(d => { data = d; return d; }));
  const size = n => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const when = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const parentOf = f => f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
  const baseName = f => f.split('/').pop();
  const live = x => !x.deleted;
  const hiddenFolder = f => data.folders.some(x => x.gmOnly && (f === x.path || f.startsWith(x.path + '/')));
  const allFolders = () => [...new Set([...data.folders.map(f => f.path), ...data.files.filter(live).map(f => f.folder), ...data.pages.filter(live).map(p => p.folder)]
    .filter(Boolean).flatMap(f => f.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort(natural);
  const childFolders = f => allFolders().filter(x => parentOf(x) === f);
  const href = f => f ? '#/files/' + f.split('/').map(encodeURIComponent).join('/') : '#/wiki';
  const siteWiki = (SV.siteName || 'The') + ' wiki';

  // ───────── icons ─────────
  const ICON = {
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    page: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 12h7M9 15.5h7M9 9h3"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17.5l5-5 4 4 2.5-2.5 5 5"/>',
    pdf: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5"/><text x="12.5" y="17" font-size="5.2" text-anchor="middle" font-family="sans-serif" stroke="none" fill="currentColor" font-weight="700">PDF</text>',
    audio: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="7" cy="17.5" r="2.2"/><circle cx="17" cy="15.5" r="2.2"/>',
    video: '<rect x="3.5" y="6" width="12" height="12" rx="1.5"/><path d="M15.5 10.5L20.5 7.5v9l-5-3z"/>',
    text: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 11.5h7M9 14.5h7M9 17.5h5"/>',
    zip: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M11 3v2h2v2h-2v2h2v2h-2v2.5h2V16h-2"/>',
    sheet: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M8.5 11h8v7h-8zM8.5 14.5h8M12.5 11v7"/>',
    up: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>', grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    bin: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9l1-13.5"/>', recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    web: '<circle cx="6" cy="7" r="1.8"/><circle cx="17" cy="5.5" r="1.8"/><circle cx="12" cy="13" r="2.2"/><circle cx="5.5" cy="18.5" r="1.6"/><circle cx="18.5" cy="17" r="1.8"/><path d="M7.5 8.2l3.2 3.4M15.6 6.6l-2.6 4.6M10.4 14.3l-3.6 3.2M13.9 14l3.2 2"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>', plus: '<path d="M12 5v14M5 12h14"/>'
  };
  const ic = (k, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'dic ' + (cls || '')); s.innerHTML = ICON[k] || ICON.text; return s; };
  const kindOf = it => it.kind === 'folder' ? 'folder' : it.kind === 'page' ? 'page' : /^image\//.test(it.type) ? 'image' : it.type === 'application/pdf' ? 'pdf'
    : /^audio\//.test(it.type) ? 'audio' : /^video\//.test(it.type) ? 'video' : /zip/.test(it.type) ? 'zip' : /sheet|csv/.test(it.type) ? 'sheet' : 'text';

  // ───────── what's shown ─────────
  function items() {
    let list;
    if (mode === 'bin') list = [...data.pages.filter(x => x.deleted).map(asPage), ...data.files.filter(x => x.deleted).map(asFile)];
    else if (mode === 'recent') list = [...data.pages.filter(live).map(asPage), ...data.files.filter(live).map(asFile)].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 60);
    else if (q) { const k = q.toLowerCase(); list = [...allFolders().filter(f => baseName(f).toLowerCase().includes(k)).map(asFolder), ...data.pages.filter(live).map(asPage), ...data.files.filter(live).map(asFile)].filter(x => x.kind === 'folder' || x.name.toLowerCase().includes(k)); }
    else list = [...childFolders(cur).map(asFolder), ...data.pages.filter(x => live(x) && (x.folder || '') === cur && !ownPage(x)).map(asPage), ...data.files.filter(x => live(x) && (x.folder || '') === cur).map(asFile)];
    return mode === 'recent' ? list : list.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || natural(a.name, b.name));
  }
  const asFolder = f => ({ kind: 'folder', key: 'd:' + f, path: f, name: baseName(f), gmOnly: (data.folders.find(x => x.path === f) || {}).gmOnly, where: parentOf(f) });
  // the start of a page as it reads: headings, bold, lists and all (made once per version of the page)
  const previews = new Map();
  function pagePreview(it) {
    const p = ctx.pages().find(x => x.id === it.id);
    if (!p || !p.md || !window.marked) return null;
    const key = p.id + ':' + (p.rev || p.updated || '');
    if (!previews.has(key)) {
      let md = p.md.replace(/```[\s\S]*?```/g, '').replace(/^---\n[\s\S]*?\n---\n/, '');
      try { if (ctx.lore && ctx.lore.promoteHeadings) md = ctx.lore.promoteHeadings(md); } catch (e) { /* as is */ }
      md = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\{#[^}]*\}/g, '')
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (m, t) => t.split('/').pop())
        .replace(/^\s*\[\[\s*category\s*:[^\]]*\]\]\s*$/gim, '').slice(0, 1800);
      const el = document.createElement('div'); el.className = 'dmd';
      try { el.innerHTML = window.marked.parse(md); } catch (e) { return null; }
      for (const x of el.querySelectorAll('script, iframe, img, video, audio, object')) x.remove();
      for (const a of el.querySelectorAll('a')) a.replaceWith(...a.childNodes);
      const first = el.firstElementChild;   // the page's own title is already on the card
      if (first && /^H[12]$/.test(first.tagName) && ctx.wkey(first.textContent) === ctx.wkey(p.title)) first.remove();
      if (previews.size > 400) previews.clear();
      previews.set(key, el);
    }
    return previews.get(key).cloneNode(true);
  }
  const asPage = p => ({ kind: 'page', key: 'p:' + p.id, id: p.id, name: p.title, path: p.path, gmOnly: p.gmOnly, time: p.updated, by: p.by, size: p.size, where: p.folder || '', deleted: p.deleted, excerpt: p.excerpt, pic: p.pic });
  const asFile = f => ({ kind: 'file', key: 'f:' + f.id, id: f.id, name: f.name, type: f.type, url: f.url, gmOnly: f.gmOnly, time: f.created, by: f.by, size: f.size, where: f.folder || '', deleted: f.deleted });

  // ───────── drawing ─────────
  function render() {
    const root = $('#drive');
    const list = items();
    const nav = h('aside', { class: 'dnav' },
      admin ? h('button', { class: 'dnew', onclick: e => newMenu(e.currentTarget) }, ic('plus'), 'New') : null,
      h('a', { href: href(''), class: mode === 'folder' && !cur && !q ? 'on' : null }, ic('folder'), siteWiki),
      h('div', { class: 'dtree' }, treeNode('')),
      h('a', { href: '#/files/:recent', class: mode === 'recent' ? 'on' : null }, ic('recent'), 'Recent'),
      admin ? h('a', { href: '#/files/:bin', class: mode === 'bin' ? 'on' : null }, ic('bin'), 'Bin') : null,
      h('div', { class: 'dstat' }, `${data.pages.filter(live).length} pages · ${data.files.filter(live).length} files`));
    const crumbs = mode === 'bin' ? [h('b', null, 'Bin'), h('span', { class: 'muted' }, ' · deleted pages and files; restore them or delete them for good')]
      : mode === 'recent' ? [h('b', null, 'Recent')]
      : q ? [h('b', null, `Search: “${q}”`)]
      : [h('a', { href: href(''), class: 'dropzone', 'data-folder': '' }, siteWiki), ...cur.split('/').filter(Boolean).map((f, i, a) => [h('span', { class: 'sep' }, '›'), h('a', { href: href(a.slice(0, i + 1).join('/')), class: 'dropzone', 'data-folder': a.slice(0, i + 1).join('/') }, f)])];
    const search = h('input', { type: 'search', class: 'dsearch', placeholder: 'Search files and pages', value: q, oninput: e => { q = e.target.value.trim(); sel.clear(); renderBody(); } });
    root.classList.remove('navopen');   // (on a phone the folders slide in over the page: a choice puts them away)
    const navBtn = h('button', { class: 'dnavbtn', title: 'Folders', onclick: () => root.classList.toggle('navopen') }, ic('folder'));
    const top = h('div', { class: 'dtop' }, navBtn, h('div', { class: 'dcrumbs' }, crumbs), search,
      ctx.themePicker ? ctx.themePicker() : null,
      // grid, list, or the web of how the pages here mention each other
      h('div', { class: 'dviews' }, ...[['grid', 'Grid'], ['list', 'List'], ['web', 'Web: the pages as stars, joined where they mention each other']].map(([k, t]) =>
        h('button', { class: 'dview' + (layout === k ? ' on' : ''), title: t, onclick: e => { layout = k; ctx.store.set('valanar-drive-layout', layout); for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); renderBody(); } }, ic(k)))));
    const bodyEl = h('div', { class: 'dbody', tabindex: '0' });
    function renderBody() {
      stopWeb();
      bodyEl.classList.remove('isportal', 'isfolder', 'isweb');
      const dmEl = bodyEl.parentNode;   // searching while a file is open: back to the list
      if (dmEl && dmEl.classList.contains('previewing')) { const pv = dmEl.querySelector('.dpreview'); if (pv) pv.remove(); dmEl.classList.remove('previewing'); }
      const L = items();
      const folders = L.filter(x => x.kind === 'folder'), rest = L.filter(x => x.kind !== 'folder');
      const empty = !L.length ? h('div', { class: 'dempty' }, ic(mode === 'bin' ? 'bin' : 'folder', 'big'),
        h('p', null, mode === 'bin' ? 'The bin is empty.' : q ? 'Nothing matches.' : admin ? 'This folder is empty. Drop files here, or use New.' : 'This folder is empty.')) : null;
      // the front page of the wiki: its name, the main page and the wiki's own links above the folders
      const front = mode === 'folder' && !cur && !q ? hero() : null;
      if (layout === 'web' && mode === 'folder' && !q && WEBLIB) {
        const w = WEBLIB.web(cur); webStop = w.stop;
        bodyEl.replaceChildren(h('div', { class: 'dweb' }, w.el)); bodyEl.classList.add('isweb');
      } else if (layout === 'list') {
        bodyEl.replaceChildren(...[front, empty || h('table', { class: 'dlist' },
          h('tr', null, h('th', null, 'Name'), h('th', null, q || mode !== 'folder' ? 'Folder' : 'By'), h('th', null, 'Modified'), h('th', null, 'Size')),
          L.map(it => itemEl(it, 'tr')))].filter(Boolean));
      } else if (front && !empty) {
        bodyEl.replaceChildren(...portal(L)); bodyEl.classList.add('isportal'); return;
      } else if (mode === 'folder' && cur && !q && !empty) {
        bodyEl.replaceChildren(...folderPage(L)); bodyEl.classList.add('isfolder'); return;
      } else {
        bodyEl.replaceChildren(...(empty ? [front, empty].filter(Boolean) : [front,
          folders.length ? h('div', { class: 'dsec' }, 'Folders') : null,
          folders.length ? h('div', { class: 'dfolders' }, folders.map(it => itemEl(it, 'grid'))) : null,
          rest.length ? h('div', { class: 'dsec' }, 'Files and pages') : null,
          rest.length ? h('div', { class: 'dgrid' }, rest.map(it => itemEl(it, 'grid'))) : null].filter(Boolean)));
      }
    }
    renderBody();
    root.replaceChildren(nav, h('main', { class: 'dmain' }, top, bodyEl));
    // drop files from the computer to upload them here
    if (admin && mode === 'folder' && !q) {
      root.ondragover = e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } };
      root.ondragleave = e => { if (!root.contains(e.relatedTarget)) root.classList.remove('dropping'); };
      root.ondrop = e => { root.classList.remove('dropping'); if (e.dataTransfer.files.length && !e.target.closest('[data-folder]')) { e.preventDefault(); uploadMany([...e.dataTransfer.files], cur); } };
    } else root.ondragover = root.ondrop = null;
    bodyEl.addEventListener('click', e => { if (e.target === bodyEl || e.target.classList.contains('dgrid') || e.target.classList.contains('dfolders')) { sel.clear(); markSel(); } });
    bodyEl.addEventListener('keydown', keys);
  }
  // the web view (app/library.js), stopped whenever the folder or the view changes
  const WEBLIB = window.ValanarLibrary ? window.ValanarLibrary(Object.assign({}, ctx, { site: ctx.siteName || SV.siteName || 'the wiki' })) : null;
  let webStop = null;
  function stopWeb() { if (webStop) { webStop(); webStop = null; } }
  window.addEventListener('hashchange', () => { if (!/^#\/(files|wiki\/?$)/.test(location.hash)) stopWeb(); });
  // a page's picture: a link as it is, or the name of an uploaded file
  function picURL(p) {
    if (!p) return null;
    if (/^(https?:\/\/|\/files\/)/.test(p)) return p;
    const n = p.replace(/^(file|image):/i, '').trim().toLowerCase();
    const f = data.files.find(x => live(x) && x.name.toLowerCase() === n);
    return f ? f.url : null;
  }
  const ownPage = x => !!(ctx.isOwner && x.path && ctx.isOwner(x));   // a folder's own page (its introduction)
  const pagesUnder = f => data.pages.filter(x => live(x) && !ownPage(x) && (f === '' ? true : ((x.folder || '') === f || (x.folder || '').startsWith(f + '/'))));
  const ago = t => { if (!t) return ''; const m = (Date.now() - t) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : m < 1440 * 30 ? Math.round(m / 1440) + ' d ago' : when(t); };

  // ───────── the wiki's front page: a portal rather than a bare folder ─────────
  // the world map, small, drawn from the map's own tiles: the front page's backdrop
  let mapPic = null;
  function worldPicture() {
    const I = window.MAP_INFO;
    if (mapPic || !I || !I.width) return mapPic;
    const N = Math.ceil(Math.log2(Math.max(I.width, I.height) / 256));
    let z = N; while (z > 0 && I.width / Math.pow(2, N - z) > 2200) z--;
    const f = Math.pow(2, N - z), W = Math.ceil(I.width / f), H = Math.ceil(I.height / f);
    mapPic = h('canvas', { width: W, height: H, class: 'pmap' });
    const g = mapPic.getContext('2d');
    for (let y = 0; y < Math.ceil(H / 256); y++) for (let x = 0; x < Math.ceil(W / 256); x++) {
      const img = new Image(); img.onload = () => g.drawImage(img, x * 256, y * 256); img.src = `tiles/${z}/${y}/${x}${I.ext || '.png'}`;
    }
    return mapPic;
  }
  function portal(listHere) {
    const mp = (SV.mainPage && ctx.findPage(SV.mainPage)) || ctx.indexPage();
    const mpd = mp && data.pages.find(x => x.id === mp.id);
    const all = data.pages.filter(live);
    const tops = childFolders('');
    const search = h('input', { type: 'search', class: 'pq', placeholder: `Search ${all.length} pages…`, oninput: e => { q = e.target.value.trim(); sel.clear(); render(); setTimeout(() => { const i = document.querySelector('#drive .dsearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); } });
    const link = (href, label, icon) => h('a', { class: 'pbtn', href }, icon ? ic(icon, 'sm') : null, label);
    const hero = h('section', { class: 'phero' },
      h('div', { class: 'pbg' }, worldPicture()),
      h('div', { class: 'pin' },
        h('h1', null, siteWiki), h('p', { class: 'ptag' }, SV.tagline || 'Everything about the world, in one place'),
        search,
        h('div', { class: 'plinks' },
          mp ? link(ctx.wikiHref(mp.path), 'Main page', 'page') : null,
          link('#/wiki/Special:Timeline', 'Timeline'), link('#/library', 'Library'), link('#/observatory', 'Observatory'),
          link('#/wiki/Special:Random', 'Random page'), link('#/wiki/Special:Recent', 'Recent changes', 'recent'), link('#/wiki/Special:Categories', 'Categories'),
          admin ? link('#/wiki/Special:New', 'New page', 'plus') : null, admin ? link('#/wiki/Special:Import', 'Import a document') : null),
        // a random part that hasn't been written yet, to fill in
        (() => { let n = 0; try { n = ctx.unfinishedCount ? ctx.unfinishedCount() : 0; } catch (e) { /* */ } return n ? h('a', { class: 'pgap', href: '#/wiki/Special:Unfinished', title: 'Go to a random part of the wiki that has nothing written in it yet' },
          h('b', null, 'Fill a gap'), h('span', null, `${n} unfinished part${n === 1 ? '' : 's'} · take me to one at random ›`)) : null; })(),
        h('div', { class: 'pstats' }, `${all.length} pages · ${tops.length} sections · ${data.files.filter(live).length} files`)));
    // the main page, large, and what's changed lately
    const feature = mpd ? h('a', { class: 'pfeature', href: ctx.wikiHref(mpd.path) },
      picURL(mpd.pic) ? h('img', { src: picURL(mpd.pic), alt: '', onerror: e => e.target.remove() }) : null,
      h('div', { class: 'pfk' }, 'Main page'), h('h2', null, mpd.title), (() => { const pv = pagePreview(mpd); if (pv) pv.classList.add('pfmd'); return pv || h('p', null, mpd.excerpt || ''); })(), h('span', { class: 'pmore' }, 'Read ›')) : null;
    const recent = all.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 6);
    const recentEl = h('div', { class: 'precent' }, h('h3', null, 'Recently changed'),
      ...recent.map(p => h('a', { href: ctx.wikiHref(p.path) }, h('b', null, p.title), h('span', null, [p.folder ? p.folder.split('/').pop() : '', ago(p.updated)].filter(Boolean).join(' · ')))),
      h('a', { class: 'pmore', href: '#/wiki/Special:Recent' }, 'All recent changes ›'));
    const here = listHere.filter(x => x.kind !== 'folder');
    // the folders first, just under the search, then the main page and what's changed lately
    return [hero,
      tops.length ? h('h3', { class: 'psec' }, 'Browse') : null,
      tops.length ? h('div', { class: 'pfolders' }, ...tops.map(folderCard)) : null,
      h('div', { class: 'ptwo' }, feature || h('div'), recentEl),
      here.length ? h('h3', { class: 'psec' }, 'Pages and files') : null,
      here.length ? h('div', { class: 'dgrid big' }, here.map(it => itemEl(it, 'grid'))) : null].filter(Boolean);
  }
  // a folder inside the wiki: its name large, its folders as cards, then its pages and files
  // A folder reads as a page of its own: its introduction (the page named after it, or its "(overview)"),
  // then everything in it, each page with the parts it's made of
  function folderPage(L) {
    const subs = L.filter(x => x.kind === 'folder'), rest = L.filter(x => x.kind !== 'folder');
    const n = pagesUnder(cur).length;
    const own = ctx.ownerOf ? ctx.ownerOf(cur) : null;
    const intro = own && ctx.folderIntro ? ctx.folderIntro(own) : null;
    const arms = ctx.armsFor ? ctx.armsFor(baseName(cur)) : '';   // a nation's folder: its coat of arms
    const head = h('div', { class: 'pfhead' + (arms ? ' witharms' : '') }, arms ? h('div', { class: 'pfarms', html: arms, title: ctx.blazonFor ? ctx.blazonFor(baseName(cur)) : '' }) : null, h('h1', null, baseName(cur)),
      intro && intro.short ? h('div', { class: 'pfshort' }, intro.short) : null,
      h('div', { class: 'muted' }, `${n} page${n === 1 ? '' : 's'}${subs.length ? ` · ${subs.length} folder${subs.length === 1 ? '' : 's'}` : ''}${hiddenFolder(cur) && admin ? ' · GM only' : ''}`,
        admin ? (own ? [' · ', h('a', { href: '#/wiki/Special:Edit/' + own.id }, 'Edit the introduction')]
          : [' · ', h('a', { href: '#/wiki/Special:New?title=' + encodeURIComponent(baseName(cur)) + '&folder=' + encodeURIComponent(cur) }, 'Write an introduction')]) : null));
    const pagesHere = rest.filter(x => x.kind === 'page'), filesHere = rest.filter(x => x.kind !== 'page');
    // each page: its name, a line about it, and the parts it splits into
    const pageRow = it => {
      const p = ctx.findPage(it.path), parts = p && ctx.lore ? ctx.lore.headingsOf(p).heads.filter(x => x.top && !x.empty) : [];
      return h('div', { class: 'fpage' + (it.gmOnly ? ' gm' : ''), 'data-key': it.key },
        h('a', { class: 'fpt', href: ctx.wikiHref(it.path) }, it.name, it.gmOnly ? h('span', { class: 'gmtag' }, 'GM') : null),
        it.excerpt ? h('p', null, it.excerpt) : null,
        parts.length > 1 ? h('div', { class: 'fparts' }, ...parts.slice(0, 14).map(x => h('a', { href: ctx.lore.sectionHref(p, x.name) }, x.name)), parts.length > 14 ? h('span', { class: 'muted' }, `+${parts.length - 14} more`) : null) : null);
    };
    const contents = [
      subs.length ? h('div', { class: 'pfolders' }, ...subs.map(it => folderCard(it.path, it))) : null,
      pagesHere.length ? h('h3', { class: 'psec' }, intro ? `In ${baseName(cur)}` : subs.length ? 'Pages' : '') : null,
      pagesHere.length ? h('div', { class: 'fpages' }, pagesHere.map(pageRow)) : null,
      filesHere.length ? h('h3', { class: 'psec' }, 'Files') : null,
      filesHere.length ? h('div', { class: 'dgrid big' }, filesHere.map(it => itemEl(it, 'grid'))) : null];
    if (!intro) return [head, ...contents].filter(Boolean);
    return [head, h('div', { class: 'fsplit' }, h('div', { class: 'fintro warticle' }, intro.el), h('aside', { class: 'fside' }, ...contents.filter(Boolean)))];
  }
  // a card for a folder: what's in it at a glance (right-click and drag work as on any item)
  function folderCard(f, it) {
    it = it || asFolder(f);
    {
      const ps = pagesUnder(f).sort((a, b) => natural(a.title, b.title)), subs = childFolders(f);
      const ownP = ctx.ownerOf && ctx.ownerOf(f), ownD = ownP && data.pages.find(x => x.id === ownP.id);
      const pic = [ownD, ...ps].filter(Boolean).map(p => picURL(p.pic)).find(Boolean);
      const el = h('div', { class: 'pfolder dropzone' + (hiddenFolder(f) ? ' gm' : ''), 'data-folder': f },
        h('a', { class: 'pfh', href: href(f) }, pic ? h('img', { src: pic, alt: '', loading: 'lazy', onerror: e => e.target.remove() }) : null,
          h('span', { class: 'pficon' }, ic('folder')), h('span', { class: 'pfn' }, h('b', null, baseName(f)), h('small', null, `${ps.length} page${ps.length === 1 ? '' : 's'}${subs.length ? ` · ${subs.length} folder${subs.length === 1 ? '' : 's'}` : ''}`)),
          hiddenFolder(f) && admin ? ic('lock', 'sm lk') : null),
        ownD && ownD.excerpt ? h('p', { class: 'pfx' }, ownD.excerpt) : null,
        subs.length ? h('div', { class: 'pfsubs' }, ...subs.slice(0, 8).map(sf => h('a', { href: href(sf) }, ic('folder', 'sm'), baseName(sf)))) : null,
        h('ul', null, ...ps.slice(0, 7).map(p => h('li', null, h('a', { href: ctx.wikiHref(p.path) }, p.title)))),
        ps.length > 7 ? h('a', { class: 'pmore', href: href(f) }, `All ${ps.length} pages ›`) : null);
      el.dataset.key = it.key;
      if (admin) {
        el.draggable = true;
        el.addEventListener('dragstart', e => { sel.clear(); sel.add(it.key); e.dataTransfer.setData('text/x-drive', JSON.stringify([it.key])); e.dataTransfer.effectAllowed = 'move'; });
      }
      el.addEventListener('contextmenu', e => { e.preventDefault(); sel.clear(); sel.add(it.key); menu(e.clientX, e.clientY, it); });
      return el;
    }
  }
  function hero() {
    const mp = (SV.mainPage && ctx.findPage(SV.mainPage)) || ctx.indexPage();
    return h('div', { class: 'dhero' },
      h('div', { class: 'dht' }, h('h1', null, siteWiki), SV.tagline ? h('p', null, SV.tagline) : null),
      h('div', { class: 'dhl' },
        mp ? h('a', { class: 'dmain-page', href: ctx.wikiHref(mp.path) }, ic('page', 'sm'), h('span', null, h('b', null, mp.title), h('small', null, 'Main page'))) : null,
        h('a', { href: '#/wiki/Special:Random' }, 'Random page'), h('a', { href: '#/wiki/Special:Recent' }, 'Recent changes'), h('a', { href: '#/wiki/Special:Categories' }, 'Categories')));
  }
  function treeNode(f) {
    const kids = childFolders(f);
    return kids.map(k => {
      const open = cur === k || cur.startsWith(k + '/');
      const sub = childFolders(k).length;
      return h('div', { class: 'dtn' },
        h('a', { href: href(k), class: 'dropzone' + (mode === 'folder' && cur === k && !q ? ' on' : ''), 'data-folder': k, style: `padding-left:${8 + k.split('/').length * 12}px` },
          sub ? h('span', { class: 'tw' }, open ? '▾' : '▸') : h('span', { class: 'tw' }), ic('folder', 'sm'), baseName(k), hiddenFolder(k) && admin ? ic('lock', 'sm lk') : null),
        open && sub ? treeNode(k) : null);
    });
  }
  function itemEl(it, how) {
    const k = kindOf(it);
    const thumb = k === 'image' ? h('img', { src: it.url, alt: '', loading: 'lazy', draggable: 'false' })
      : k === 'page' && (it.excerpt || it.pic) ? h('div', { class: 'dpage' + (picURL(it.pic) ? ' haspic' : '') }, picURL(it.pic) ? h('img', { src: picURL(it.pic), alt: '', loading: 'lazy', draggable: 'false', onerror: e => e.target.remove() }) : null, h('b', null, it.name), pagePreview(it) || it.excerpt) : ic(k, 'big k-' + k);
    const attrs = { class: 'ditem k-' + k + (sel.has(it.key) ? ' sel' : '') + (it.gmOnly ? ' gm' : ''), 'data-key': it.key, draggable: admin && mode === 'folder' ? 'true' : null, title: it.name };
    if (it.kind === 'folder') { attrs['data-folder'] = it.path; attrs.class += ' dropzone'; }
    const el = how === 'tr'
      ? h('tr', attrs, h('td', null, h('span', { class: 'dname' }, ic(k, 'sm k-' + k), it.name, it.gmOnly ? h('span', { class: 'gmtag' }, 'GM') : null)),
          h('td', null, q || mode !== 'folder' ? (it.where || '—') : it.by || ''), h('td', null, when(it.deleted || it.time)), h('td', null, it.kind === 'folder' ? '—' : size(it.size)))
      : it.kind === 'folder'
        ? h('div', attrs, ic('folder', 'k-folder'), h('span', { class: 'dn' }, it.name), it.gmOnly ? ic('lock', 'sm lk') : null)
        : h('div', attrs, h('div', { class: 'dthumb' }, thumb), h('div', { class: 'dcap' }, ic(k, 'sm k-' + k), h('span', { class: 'dn' }, it.name), it.gmOnly ? h('span', { class: 'gmtag' }, 'GM') : null));
    el.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) { sel.has(it.key) ? sel.delete(it.key) : sel.add(it.key); }
      else if (e.shiftKey && sel.size) { const L = items().map(x => x.key), a = L.indexOf([...sel].pop()), b = L.indexOf(it.key); for (const x of L.slice(Math.min(a, b), Math.max(a, b) + 1)) sel.add(x); }
      else { sel.clear(); sel.add(it.key); }
      markSel();
    });
    el.addEventListener('dblclick', () => open(it));
    el.addEventListener('contextmenu', e => { e.preventDefault(); if (!sel.has(it.key)) { sel.clear(); sel.add(it.key); markSel(); } menu(e.clientX, e.clientY, it); });
    el.addEventListener('dragstart', e => { if (!sel.has(it.key)) { sel.clear(); sel.add(it.key); markSel(); } e.dataTransfer.setData('text/x-drive', JSON.stringify([...sel])); e.dataTransfer.effectAllowed = 'move'; });
    return el;
  }
  function markSel() { for (const el of document.querySelectorAll('#drive [data-key]')) el.classList.toggle('sel', sel.has(el.dataset.key)); }
  const selected = () => items().filter(x => sel.has(x.key));
  // dragging things onto a folder (in the list, the tree or the path at the top) moves them there
  document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#drive .dropzone'); if (z && admin && (e.dataTransfer.types.includes('text/x-drive') || e.dataTransfer.types.includes('Files'))) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#drive .dropzone'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', e => {
    const z = e.target.closest && e.target.closest('#drive .dropzone'); if (!z || !admin) return;
    z.classList.remove('over'); e.preventDefault(); e.stopPropagation();
    const to = z.dataset.folder || '';
    if (e.dataTransfer.files.length) return uploadMany([...e.dataTransfer.files], to);
    let keys = []; try { keys = JSON.parse(e.dataTransfer.getData('text/x-drive')); } catch (err) { return; }
    moveKeys(keys, to);
  });

  // ───────── doing things ─────────
  function open(it) {
    if (it.deleted) return;
    if (it.kind === 'folder') { location.hash = href(it.path); return; }
    if (it.kind === 'page') { location.hash = ctx.wikiHref(it.path); return; }
    preview(it);
  }
  // A file opened here shows under the bar (search and home stay); a Markdown or text file reads as a page.
  function preview(it) {
    const k = kindOf(it);
    const dm = document.querySelector('#drive .dmain');
    const close = () => { box.remove(); if (dm) dm.classList.remove('previewing'); document.removeEventListener('keydown', esc); };
    const isMd = it.type === 'text/markdown' || /\.(md|markdown)$/i.test(it.name || '');
    const content = k === 'image' ? h('img', { src: it.url, alt: it.name })
      : k === 'pdf' ? h('iframe', { src: it.url, title: it.name })
      : k === 'audio' ? h('audio', { src: it.url, controls: true, autoplay: true })
      : k === 'video' ? h('video', { src: it.url, controls: true, autoplay: true })
      : /^text\//.test(it.type) || isMd ? h('div', { class: 'dtext' + (isMd ? ' warticle' : ' plain') }, 'Loading…') : h('div', { class: 'dnoprev' }, ic(k, 'big'), h('p', null, 'No preview for this kind of file.'));
    if (/\bdtext\b/.test(content.className)) fetch(it.url).then(r => r.text()).then(t => {
      if (isMd && ctx.renderMarkdown) {
        content.innerHTML = '';
        const title = (it.name || '').replace(/\.(md|markdown)$/i, '');
        const el = ctx.renderMarkdown(t.replace(/^\uFEFF/, '').replace(/^---\n[\s\S]*?\n---\n/, ''));   // without an Obsidian properties block
        const own = el.firstElementChild && el.firstElementChild.tagName === 'H1';
        content.append(own ? h('div') : h('h1', { class: 'ptitle' }, title), el);
      } else content.textContent = t;
    });
    const box = h('div', { class: 'dpreview' + (dm ? ' inline' : ''), onclick: e => { if (e.target === box) close(); } },
      h('div', { class: 'dpbar' }, ic(k, 'sm'), h('b', null, it.name), h('span', { class: 'muted' }, size(it.size)), h('span', { class: 'grow' }),
        h('a', { class: 'btn sm', href: it.url, download: it.name }, 'Download'), h('button', { class: 'btn sm', onclick: () => copyLink(it) }, 'Copy link'), h('button', { class: 'btn sm', onclick: close }, 'Close')),
      h('div', { class: 'dpbody' }, content));
    if (dm) { dm.classList.add('previewing'); dm.append(box); } else document.body.append(box);
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
  }
  function copyLink(it) {
    const url = it.kind === 'page' ? location.origin + '/' + ctx.wikiHref(it.path) : location.origin + it.url;
    navigator.clipboard.writeText(it.kind === 'file' && /^image\//.test(it.type) ? it.url : url).then(() => toast(it.kind === 'file' && /^image\//.test(it.type) ? 'Picture link copied: paste it into a page as ![caption](link)' : 'Link copied'));
  }
  async function moveKeys(keys, to) {
    let n = 0;
    try {
      for (const key of keys) {
        const [t, id] = [key.slice(0, 1), key.slice(2)];
        if (t === 'f') { await api('/drive/files/' + id, json('PUT', { folder: to })); n++; }
        else if (t === 'p') { await api('/wiki/' + id, json('PUT', { folder: to })); n++; }
        else if (t === 'd') { if (to === id || to.startsWith(id + '/')) continue; await api('/drive/folders', json('PUT', { path: id, to: (to ? to + '/' : '') + baseName(id) })); n++; }
      }
    } catch (e) { toast(e.message, true); }
    if (n) toast(`Moved ${n} ${n === 1 ? 'item' : 'items'}${to ? ' to ' + baseName(to) : ''}`);
    sel.clear(); await refresh();
  }
  async function uploadMany(files, folder) {
    const t = h('div', { class: 'toast' }, `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`); $('#toasts').append(t);
    let ok = 0;
    for (const f of files) { try { await upload(f, folder); ok++; } catch (e) { toast(`${f.name}: ${e.message}`, true); } }
    t.remove(); if (ok) toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`);
    await refresh();
  }
  const upload = (file, folder) => fetch(`/api/site/drive/files?folder=${encodeURIComponent(folder || '')}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); data.files.push(j.file); return j.file; });
  async function refresh() { await load(); await ctx.reload(); if ($('#drive') && !$('#drive').hidden) render(); }
  function rename(it) {
    const n = prompt(it.kind === 'folder' ? 'Folder name' : it.kind === 'page' ? 'Page title' : 'File name', it.name);
    if (!n || n.trim() === it.name) return;
    const p = it.kind === 'folder' ? api('/drive/folders', json('PUT', { path: it.path, to: (it.where ? it.where + '/' : '') + n.trim() }))
      : it.kind === 'page' ? api('/wiki/' + it.id, json('PUT', { title: n.trim() })) : api('/drive/files/' + it.id, json('PUT', { name: n.trim() }));
    p.then(refresh).catch(e => toast(e.message, true));
  }
  function setGM(list, on) {
    Promise.all(list.map(it => it.kind === 'folder' ? api('/drive/folders', json('PUT', { path: it.path, gmOnly: on }))
      : it.kind === 'page' ? api('/wiki/' + it.id, json('PUT', { gmOnly: on })) : api('/drive/files/' + it.id, json('PUT', { gmOnly: on }))))
      .then(() => { toast(on ? 'Only admins see ' + (list.length > 1 ? 'these' : 'this') + ' now' : 'Players can see ' + (list.length > 1 ? 'these' : 'this') + ' now'); return refresh(); }).catch(e => toast(e.message, true));
  }
  async function remove(list) {
    const purge = mode === 'bin';
    if (!confirm(purge ? `Delete ${list.length === 1 ? '“' + list[0].name + '”' : list.length + ' items'} for good? This can’t be undone.`
      : `Put ${list.length === 1 ? '“' + list[0].name + '”' : list.length + ' items'} in the bin?`)) return;
    try {
      for (const it of list) {
        if (it.kind === 'folder') await api('/drive/folders?path=' + encodeURIComponent(it.path), { method: 'DELETE' });
        else await api((it.kind === 'page' ? '/wiki/' : '/drive/files/') + it.id + (purge ? '?purge=1' : ''), { method: 'DELETE' });
      }
    } catch (e) { toast(e.message, true); }
    sel.clear(); refresh();
  }
  function restore(list) {
    Promise.all(list.map(it => api((it.kind === 'page' ? '/wiki/' : '/drive/files/') + it.id + '/restore', { method: 'POST' }))).then(() => { toast('Restored'); sel.clear(); return refresh(); }).catch(e => toast(e.message, true));
  }
  function moveDialog(list) {
    const opts = [''].concat(allFolders()).filter(f => !list.some(it => it.kind === 'folder' && (f === it.path || f.startsWith(it.path + '/'))));
    const pick = h('select', { size: 12, class: 'dmovesel' }, ...opts.map(f => h('option', { value: f }, f ? '  '.repeat(f.split('/').length - 1) + '📁 ' + baseName(f) : '📁 All files (top)')));
    const nf = h('input', { placeholder: 'or a new folder inside it', class: 'dmovenew' });
    const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
    modal.replaceChildren(h('div', { class: 'dialog' }, h('div', { class: 'dh' }, h('h2', null, `Move ${list.length === 1 ? '“' + list[0].name + '”' : list.length + ' items'}`), h('button', { onclick: close }, '×')),
      h('div', { class: 'db' }, pick, nf),
      h('div', { class: 'df' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const base = pick.value || '', extra = nf.value.trim();
        close(); moveKeys(list.map(it => it.key), extra ? (base ? base + '/' : '') + extra : base);
      } }, 'Move here'))));
    modal.hidden = false;
  }
  function newFolder() {
    const n = prompt('New folder name'); if (!n || !n.trim()) return;
    api('/drive/folders', json('POST', { path: (cur ? cur + '/' : '') + n.trim() })).then(refresh).catch(e => toast(e.message, true));
  }
  function pickUpload(folder) {
    const inp = h('input', { type: 'file', multiple: true });
    inp.onchange = () => uploadMany([...inp.files], folder);
    inp.click();
  }
  function newMenu(btn) {
    const r = btn.getBoundingClientRect();
    popMenu(r.left, r.bottom + 4, [
      ['New folder', newFolder], ['New wiki page', () => { location.hash = '#/wiki/Special:New?folder=' + encodeURIComponent(cur); }],
      null, ['Upload files', () => pickUpload(cur)], ['Import a document as a page', () => { location.hash = '#/wiki/Special:Import'; }]]);
  }
  function menu(x, y, it) {
    const list = selected(), one = list.length === 1;
    if (mode === 'bin') return popMenu(x, y, [['Restore', () => restore(list)], admin ? ['Delete for good', () => remove(list), 'danger'] : null]);
    popMenu(x, y, [
      one ? ['Open', () => open(it)] : null,
      one && it.kind !== 'folder' ? ['Copy link', () => copyLink(it)] : null,
      one && it.kind === 'file' ? ['Download', () => { const a = h('a', { href: it.url, download: it.name }); document.body.append(a); a.click(); a.remove(); }] : null,
      one && it.kind === 'page' && admin ? ['Edit page', () => { location.hash = '#/wiki/Special:Edit/' + it.id; }] : null,
      admin ? null : undefined,
      admin && one ? ['Rename', () => rename(it)] : null,
      admin ? ['Move to…', () => moveDialog(list)] : null,
      admin ? (list.every(x => x.gmOnly) ? ['Show to players', () => setGM(list, false)] : ['Hide from players (GM only)', () => setGM(list, true)]) : null,
      admin ? null : undefined,
      admin ? ['Delete', () => remove(list), 'danger'] : null].filter(x => x !== undefined));
  }
  function popMenu(x, y, entries) {
    document.querySelectorAll('.dmenu').forEach(m => m.remove());
    const m = h('div', { class: 'dmenu' }, entries.map(e => e === null ? h('div', { class: 'dsepx' }) : e ? h('button', { class: e[2] || null, onclick: () => { m.remove(); e[1](); } }, e[0]) : null));
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }
  function keys(e) {
    if (ctx.isTyping()) return;
    const list = selected();
    if ((e.key === 'Delete' || e.key === 'Backspace') && admin && list.length) { e.preventDefault(); remove(list); }
    else if (e.key === 'F2' && admin && list.length === 1) { e.preventDefault(); rename(list[0]); }
    else if (e.key === 'Enter' && list.length === 1) open(list[0]);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); for (const it of items()) sel.add(it.key); markSel(); }
  }

  // ───────── for the wiki: choose or upload a picture ─────────
  function pickFile(o) {
    o = o || {};
    return new Promise(async resolve => {
      await (loaded || load());
      const modal = $('#modal'), done = f => { modal.hidden = true; modal.replaceChildren(); resolve(f || null); };
      const files = () => data.files.filter(f => live(f) && (!o.images || /^image\//.test(f.type))).sort((a, b) => (b.created || 0) - (a.created || 0));
      const grid = h('div', { class: 'dpick' });
      const draw = (filt) => grid.replaceChildren(...files().filter(f => !filt || f.name.toLowerCase().includes(filt) || (f.folder || '').toLowerCase().includes(filt)).map(f =>
        h('button', { class: 'dpitem', title: (f.folder ? f.folder + '/' : '') + f.name, onclick: () => done(f) }, /^image\//.test(f.type) ? h('img', { src: f.url, alt: '', loading: 'lazy' }) : ic(kindOf(asFile(f)), 'big'), h('span', null, f.name))));
      const up = h('input', { type: 'file', accept: o.images ? 'image/*' : '', hidden: true, onchange: async () => { const f = up.files[0]; if (!f) return; try { done(await upload(f, o.folder || 'Wiki pictures')); } catch (e) { toast(e.message, true); } } });
      modal.replaceChildren(h('div', { class: 'dialog wide' }, h('div', { class: 'dh' }, h('h2', null, o.images ? 'Choose a picture' : 'Choose a file'), h('button', { onclick: () => done() }, '×')),
        h('div', { class: 'db' }, h('div', { class: 'row' }, h('input', { type: 'search', placeholder: 'Search', oninput: e => draw(e.target.value.trim().toLowerCase()), style: 'flex:1' }),
          h('button', { class: 'btn primary', onclick: () => up.click() }, 'Upload from this computer'), up), grid),
        h('div', { class: 'df' }, h('span', { class: 'muted' }, 'Uploads go to Files › ' + (o.folder || 'Wiki pictures')), h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => done() }, 'Cancel'))));
      modal.hidden = false;
      draw('');
    });
  }

  return {
    async show(path) {
      const sq = /^:search\/(.*)$/.exec(path || '');
      mode = path === ':bin' ? 'bin' : path === ':recent' ? 'recent' : 'folder';
      cur = sq ? '' : mode === 'folder' ? (path || '') : cur;
      q = sq ? sq[1] : ''; sel.clear();
      if (!loaded) $('#drive').replaceChildren(h('p', { class: 'dempty' }, 'Loading…'));
      await load();   // fresh each time: pages made in the wiki show up
      render();
    },
    load, refresh, pickFile, upload: (file, folder) => upload(file, folder),
    fileByName: name => { const n = String(name).toLowerCase(); return data.files.find(f => live(f) && (f.name.toLowerCase() === n || ((f.folder ? f.folder + '/' : '') + f.name).toLowerCase() === n)) || null; },
    folders: () => allFolders()
  };
};
