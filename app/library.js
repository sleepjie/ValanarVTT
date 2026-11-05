/* The wiki's other ways in: the Timeline (every dated event, on a slider), the Constellation (every page as a star,
 * each folder a constellation, the lines between them who mentions whom) and the Bookshelf (the long documents as
 * books, read a chapter at a time).
 * Addresses: #/wiki/Special:Timeline?y=<year>  ·  #/observatory (#/wiki/Special:Constellation), #/observatory/build[/<id>]
 *            #/library (#/wiki/Special:Bookshelf), #/library/<book>
 *            #/wiki/Special:Book/<page id>?c=<chapter>
 * ValanarLibrary(ctx) → { show(name, arg, params, article), leave() } */
'use strict';
window.ValanarLibrary = function (ctx) {
  const { h, $, natural, wkey, store } = ctx;
  const lore = ctx.lore;
  let stop = [];   // what to undo when leaving (animation, listeners)
  const leave = () => { for (const f of stop.splice(0)) try { f(); } catch (e) { /* gone */ } document.body.classList.remove('lib-sky', 'lib-book', 'lib-build'); };
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); stop.push(() => el.removeEventListener(ev, fn, o)); };
  // replaceChildren, leaving out the nulls (which it would otherwise write out as "null")
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

  function show(name, arg, params, art) {
    leave();
    if (!lore) { fill(art, h('p', null, 'Not available.')); return true; }
    if (name === 'Timeline') timeline(art, params);
    else if (name === 'Constellation') constellation(art, arg);
    else if (name === 'Bookshelf') bookshelf(art, arg);
    else if (name === 'Book') book(art, arg, params);
    return true;
  }

  // text with the wiki's names linked in it
  const linked = (text, cls) => { const el = h('p', { class: cls || null }, text); try { lore.autoLink(el.parentNode ? el : h('div', null, el), null); } catch (e) { /* plain */ } return el; };
  const yearText = y => y == null ? '?' : y < 0 ? `${-y} BR` : y >= 2084 ? `${y} AV` : `${y} SR`;
  const yearParts = y => y == null ? ['?', ''] : y < 0 ? [String(-y), 'BR'] : y >= 2084 ? [String(y), 'AV'] : [String(y), 'SR'];

  // ───────────────────────── the timeline ─────────────────────────
  function timeline(art, params) {
    const ix = lore.index();
    let withPassing = params.get('all') === '1';
    const all = () => (withPassing ? ix.events.concat(ix.passing) : ix.events).filter(e => e.year != null).slice().sort((a, b) => a.year - b.year || (a.passing ? 1 : 0) - (b.passing ? 1 : 0));
    ctx.renderTop(null, { label: 'Timeline' });
    if (!ix.events.length && !ix.passing.length) {
      fill(art, h('h1', { class: 'ptitle' }, 'Timeline'), h('p', { class: 'muted' }, 'No dated events yet. Write them as list items on any page, like “- **1903BR** - *The Primordial Sacrifice*”, with what happened on the next line.'));
      return;
    }
    let evs = all(), cur = 0;
    // a scale that gives crowded centuries room: part by how many events come before, part by the years themselves
    let ys, lo, hi;
    const setScale = () => { ys = [...new Set(evs.map(e => e.year))].sort((a, b) => a - b); lo = ys[0]; hi = Math.max(ys[ys.length - 1], lo + 1); };
    setScale();
    const pos = y => {
      const lin = (y - lo) / (hi - lo);
      if (ys.length < 2) return lin;
      let i = 0; while (i < ys.length - 2 && ys[i + 1] < y) i++;
      const a = ys[i], b = ys[i + 1], f = b > a ? Math.max(0, Math.min(1, (y - a) / (b - a))) : 0;
      return 0.7 * ((i + f) / (ys.length - 1)) + 0.3 * lin;
    };
    const yearAt = t => { let a = lo, b = hi; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (pos(m) < t) a = m; else b = m; } return Math.round((a + b) / 2); };
    const eraOf = y => { let e = null; for (const x of ix.eras) if (y >= x.start) e = x; return e; };

    const yearEl = h('div', { class: 'tlyear' }), ageEl = h('div', { class: 'tlage' });
    const track = h('div', { class: 'tltrack' }), needle = h('div', { class: 'tlneedle' }, h('span'));
    const list = h('div', { class: 'tllist' });
    const playBtn = h('button', { class: 'btn', title: 'Play through history (space)' }, '▶ Play');
    const passingBox = h('label', { class: 'tlpass', title: 'Dates written in the middle of a sentence on any page' },
      h('input', { type: 'checkbox', checked: withPassing || null, onchange: e => { withPassing = e.target.checked; const y = evs[cur] && evs[cur].year; evs = all(); setScale(); draw(); go(nearest(y), false); } }),
      ` Dates mentioned on other pages (${ix.passing.length})`);
    const nearest = y => { let best = 0; evs.forEach((e, i) => { if (Math.abs(e.year - y) < Math.abs(evs[best].year - y)) best = i; }); return best; };

    function draw() {
      // the ages as bands, the events as marks, a few years along the bottom
      const bands = ix.eras.map((e, i) => {
        const a = pos(Math.max(lo, e.start)), b = i + 1 < ix.eras.length ? pos(ix.eras[i + 1].start) : 1;
        return h('div', { class: 'tlband b' + (i % 6), style: `left:${a * 100}%;width:${Math.max(0.5, (b - a) * 100)}%`, title: e.name }, h('span', null, e.name.replace(/^The /, '')));
      });
      const marks = evs.map((e, i) => {
        const a = pos(e.year), b = pos(e.end);
        return h('button', { class: 'tlmark' + (e.passing ? ' passing' : '') + (e.end > e.year ? ' span' : '') + (e.approx ? ' approx' : ''), style: `left:${a * 100}%` + (e.end > e.year ? `;width:${Math.max(0.4, (b - a) * 100)}%` : ''),
          title: `${e.label.replace(/\*/g, '')}: ${e.title}`, onclick: ev => { ev.stopPropagation(); go(i); } });
      });
      let lastT = -1;
      const ticks = ix.eras.map(e => { const t = pos(Math.max(lo, e.start)); if (t - lastT < 0.06) return null; lastT = t; return h('div', { class: 'tltick', style: `left:${t * 100}%` }, yearText(e.start)); }).filter(Boolean);
      fill(track, h('div', { class: 'tlbands' }, ...bands), h('div', { class: 'tlmarks' }, ...marks), h('div', { class: 'tlticks' }, ...ticks), needle);
      // every event, under the age it belongs to
      let lastAge = null;
      const rows = [];
      evs.forEach((e, i) => {
        const age = eraOf(e.year);
        if (age && age !== lastAge && !e.passing) { rows.push(h('h2', { class: 'tlagehead' }, age.name)); lastAge = age; }
        const desc = e.desc ? linked(lore.clean(e.desc)) : null;
        const ttl = h('div', { class: 'tlt' }, e.title);
        try { lore.autoLink(h('div', null, ttl), e.page); } catch (er) { /* plain */ }
        rows.push(h('div', { class: 'tlev' + (e.passing ? ' passing' : ''), 'data-i': i, onclick: ev => { if (!ev.target.closest('a')) go(i); } },
          h('div', { class: 'tld' }, e.label.replace(/\*/g, '').replace(/\s+/g, ' ')),
          h('div', { class: 'tlb' }, ttl, desc, h('a', { class: 'tlsrc', href: e.passing ? ctx.wikiHref(e.page.path) : ctx.wikiHref(e.page.path, e.age || '') }, e.passing ? 'From ' + (ctx.isOwner(e.page) ? e.page.folders[e.page.folders.length - 1] : e.page.title) + ' ›' : (e.page.title === 'World Timeline' ? 'In the World Timeline ›' : 'From ' + e.page.title + ' ›')))));
      });
      fill(list, ...rows);
    }
    function go(i, scroll = true) {
      cur = Math.max(0, Math.min(evs.length - 1, i));
      const e = evs[cur];
      setNeedle(pos(e.year));
      const [n, era] = yearParts(e.year);
      fill(yearEl, ...[e.approx ? h('small', null, 'c. ') : null, n, h('small', null, ' ' + era)].filter(Boolean));
      const age = eraOf(e.year); ageEl.textContent = age ? age.name : '';
      for (const el of list.querySelectorAll('.tlev.on')) el.classList.remove('on');
      const row = list.querySelector(`.tlev[data-i="${cur}"]`);
      if (row) { row.classList.add('on'); if (scroll) row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      for (const [k, m] of [...track.querySelectorAll('.tlmark')].entries()) m.classList.toggle('on', k === cur);
      history.replaceState(null, '', '#/wiki/Special:Timeline?y=' + e.year + (withPassing ? '&all=1' : ''));
    }
    const setNeedle = t => { needle.style.left = (t * 100) + '%'; };
    // dragging along the track: the year under the pointer, landing on the nearest event
    let dragging = false;
    const at = ev => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    on(track, 'pointerdown', ev => { if (ev.target.closest('.tlmark')) return; dragging = true; track.setPointerCapture(ev.pointerId); const t = at(ev); setNeedle(t); go(nearest(yearAt(t)), false); });
    on(track, 'pointermove', ev => {
      if (!dragging) return;
      const t = at(ev), y = yearAt(t); setNeedle(t);
      const [n, era] = yearParts(y); fill(yearEl, n, h('small', null, ' ' + era));
      const i = nearest(y); if (i !== cur) go(i, true);
      setNeedle(t);
    });
    on(track, 'pointerup', () => { if (dragging) { dragging = false; go(cur, true); } });
    // playing through history
    let timer = null;
    const play = () => { if (timer) { clearInterval(timer); timer = null; playBtn.textContent = '▶ Play'; return; } playBtn.textContent = '❚❚ Pause'; if (cur >= evs.length - 1) go(0); timer = setInterval(() => { if (cur >= evs.length - 1) play(); else go(cur + 1); }, 1800); };
    playBtn.onclick = play;
    stop.push(() => clearInterval(timer));
    on(document, 'keydown', e => {
      if (ctx.isTyping && ctx.isTyping()) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
      if (e.key === ' ') { e.preventDefault(); play(); }
    });
    fill(art, h('div', { class: 'tl' },
      h('div', { class: 'tlhead' },
        h('div', null, h('h1', { class: 'ptitle' }, 'Timeline'), h('div', { class: 'fromwiki' }, `${ix.events.length} events, from ${ix.eraSource ? ix.eraSource.page.title + ' and ' : ''}every page’s dated lists`)),
        h('div', { class: 'tlnow' }, yearEl, ageEl),
        h('div', { class: 'tlctl' }, h('button', { class: 'btn', title: 'Previous event (←)', onclick: () => go(cur - 1) }, '‹'), playBtn, h('button', { class: 'btn', title: 'Next event (→)', onclick: () => go(cur + 1) }, '›'), passingBox)),
      track, list));
    draw();
    const want = params.get('y');
    go(want != null && want !== '' && isFinite(+want) ? nearest(+want) : 0, !!want);
    document.title = `Timeline · ${ctx.site}`;
  }

  // ───────────────────────── the constellation ─────────────────────────
  const MAPCOL = ['#c0392b', '#2e7dc4', '#2e9d5b', '#8e44ad', '#d4880f', '#16a39a', '#c2185b', '#5b6b8a', '#9a6a2e', '#4a63d0'];
  const PALETTE = ['#ffd27a', '#8fd3ff', '#ff9bb3', '#b6f09c', '#c9a8ff', '#ffb27a', '#7ff0e0', '#f5f0a0', '#a8b8ff', '#ff8a8a'];
  // The web: a folder's pages (or the whole wiki's) as stars, each sub-folder a constellation, faint threads between
  // pages that mention each other. web(folder) → { el, stop }
  function web(scope) {
    scope = scope || '';
    const local = [], on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); local.push(() => el.removeEventListener(ev, fn, o)); };
    const ix0 = lore.index(), inside = f => !scope || f === scope || f.startsWith(scope + '/');
    const ix = { pages: ix0.pages.filter(p => inside(p.folders.join('/'))), folders: ix0.folders.filter(f => inside(f) && f !== scope), inn: ix0.inn, out: ix0.out };
    const base = scope ? scope.split('/').length : 0;
    // dots: pages, and folders (a folder's own page is its hub)
    const nodes = [], byKey = new Map();
    const groupOf = folders => folders[base] || (scope ? scope.split('/').pop() : ctx.site);
    const groups = [...new Set(ix.pages.map(p => groupOf(p.folders)))].sort(natural);
    const colour = g => MAPCOL[groups.indexOf(g) % MAPCOL.length];
    for (const f of ix.folders) {
      const n = { key: 'f:' + f, kind: 'folder', folder: f, title: f.split('/').pop(), group: groupOf(f.split('/')), depth: f.split('/').length - base, page: ctx.ownerOf(f) };
      nodes.push(n); byKey.set(n.key, n);
    }
    for (const p of ix.pages) if (!ctx.isOwner(p)) { const n = { key: 'p:' + p.path, kind: 'page', page: p, title: p.title, group: groupOf(p.folders), folder: p.folders.join('/') }; nodes.push(n); byKey.set(n.key, n); }
    // how bright: how much is written, and how often it's mentioned
    const inCount = k => { const m = ix.inn.get(k); return m ? [...m.values()].reduce((a, b) => a + b, 0) : 0; };
    for (const n of nodes) {
      const len = n.kind === 'folder' ? ix.pages.filter(p => (p.folders.join('/') + '/').startsWith(n.folder + '/')).reduce((a, p) => a + p.md.length, 0) * 0.25 : n.page.md.length;
      n.r = Math.max(1.6, Math.min(n.kind === 'folder' ? 9 : 7, 1.2 + Math.sqrt(len) / 28 + Math.sqrt(inCount(n.key)) * 0.5));
      n.mentions = inCount(n.key);
    }
    // lines: each page to its folder, each folder to its parent (the branches); mentions between them (the links)
    const tree = [], threads = [];
    for (const n of nodes) {
      const parent = n.kind === 'page' ? (n.folder ? 'f:' + n.folder : null) : n.folder.includes('/') ? 'f:' + n.folder.split('/').slice(0, -1).join('/') : null;
      if (parent && byKey.has(parent)) tree.push([n, byKey.get(parent)]);
    }
    const treeSet = new Set(tree.map(([a, b]) => a.key + '|' + b.key));
    for (const [from, tos] of ix.out) for (const [to, w] of tos) {
      const a = byKey.get(from), b = byKey.get(to);
      if (!a || !b || a === b || treeSet.has(a.key + '|' + b.key) || treeSet.has(b.key + '|' + a.key)) continue;
      threads.push([a, b, w]);
    }
    // where they sit: each constellation round its own point, pulled by its lines, kept apart from the others
    const size = gname => nodes.filter(n => n.group === gname).length;
    const R = 380 + Math.sqrt(nodes.length) * 28, anchors = new Map(groups.map((g, i) => { const t = (i / groups.length) * Math.PI * 2 - Math.PI / 2, rr = R * (0.75 + Math.min(0.5, size(g) / nodes.length)); return [g, { x: Math.cos(t) * rr, y: Math.sin(t) * rr * 0.72 }]; }));
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of nodes) { const a = anchors.get(n.group); n.x = a.x + (rnd() - 0.5) * 160; n.y = a.y + (rnd() - 0.5) * 160; n.vx = n.vy = 0; }
    for (let it = 0; it < 420; it++) {
      const cool = 1 - it / 420;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const same = a.group === b.group, f = (same ? 1500 : 2600) / d2;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const [a, b] of tree) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, L = a.kind === 'folder' ? 95 : 48, f = (d - L) * 0.035; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const [a, b, w] of threads) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 160) * 0.0009 * Math.min(4, w); a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const n of nodes) { const a = anchors.get(n.group); n.vx += (a.x - n.x) * 0.006; n.vy += (a.y - n.y) * 0.006; n.vx *= 0.55; n.vy *= 0.55; n.x += n.vx * cool * 3; n.y += n.vy * cool * 3; }
    }
    // the map, in the wiki's own colours (light, parchment or night)
    const wrap = h('div', { class: 'webmap' }), cv = h('canvas'), g = cv.getContext('2d');
    const tip = h('div', { class: 'webtip', hidden: true });
    const find = h('input', { type: 'search', placeholder: `Find a page (${nodes.length})…`, class: 'webfind' });
    const showAll = h('input', { type: 'checkbox' });
    const legend = h('div', { class: 'weblegend' }, ...groups.map(gname => h('button', { onclick: () => focusGroup(gname) }, h('i', { style: `background:${colour(gname)}` }), gname)));
    const panel = h('div', { class: 'webpanel' }, h('h1', null, scope ? scope.split('/').pop() : 'Every page'), h('p', null, `How the wiki hangs together: each page a dot on its folder's branch, and a line between pages that mention each other. ${nodes.length} pages, ${threads.length} links.`),
      find, h('label', { class: 'weball' }, showAll, ' Show every link'), groups.length > 1 ? legend : null);
    wrap.append(cv, panel, tip);
    if (!nodes.length) { fill(wrap, h('p', { class: 'webempty' }, 'No pages here yet.')); return { el: wrap, stop: () => {} }; }
    let C = null;   // the theme's colours, read from the page
    const theme = () => { const cs = getComputedStyle(wrap), v = (k, d) => (cs.getPropertyValue(k) || '').trim() || d;
      C = { bg: v('--w-bg', '#ffffff'), ink: v('--w-ink', '#202122'), soft: v('--w-soft', '#54595d'), line: v('--w-line2', '#dadce0') }; };
    let W = 0, H = 0, dpr = 1, view = { x: 0, y: 0, k: 0.75 }, hover = null, pinned = null, anim = null, target = null;
    const fit = () => {
      const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const side = W > 900 ? 300 : 0;   // the panel on the left takes that much
      view.k = Math.min((W - side - 80) / (maxx - minx + 1), (H - 80) / (maxy - miny + 1)) * 0.94; view.x = (minx + maxx) / 2 - side / 2 / view.k; view.y = (miny + maxy) / 2;
    };
    const resize = () => { const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; };
    const toScreen = (x, y) => [(x - view.x) * view.k + W / 2, (y - view.y) * view.k + H / 2];
    const toWorld = (sx, sy) => [(sx - W / 2) / view.k + view.x, (sy - H / 2) / view.k + view.y];
    const neighbours = n => { const s = new Set([n]); for (const [a, b] of tree) { if (a === n) s.add(b); if (b === n) s.add(a); } for (const [a, b] of threads) { if (a === n) s.add(b); if (b === n) s.add(a); } return s; };
    function frame(t) {
      t = t || performance.now();
      if (target) { const f = 0.12; view.x += (target.x - view.x) * f; view.y += (target.y - view.y) * f; view.k += (target.k - view.k) * f; if (Math.abs(target.k - view.k) < 0.002 && Math.abs(target.x - view.x) < 0.5) target = null; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!C || t - C.at > 600) { theme(); C.at = t; }   // follows the wiki's light, parchment or night
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      // a faint dot grid that moves with the map
      const step = 40 * view.k; if (step > 9) {
        g.fillStyle = C.line; const [ox, oy] = toScreen(0, 0);
        for (let x = ((ox % step) + step) % step; x < W; x += step) for (let y = ((oy % step) + step) % step; y < H; y += step) g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
      const focus = pinned || hover, near = focus ? neighbours(focus) : null;
      // the threads
      for (const [a, b, w] of threads) {
        const lit = focus && (a === focus || b === focus);
        if (!lit && !showAll.checked) continue;
        const [x1, y1] = toScreen(a.x, a.y), [x2, y2] = toScreen(b.x, b.y);
        g.strokeStyle = lit ? colour(focus.group) : C.soft; g.globalAlpha = lit ? 0.85 : 0.12; g.lineWidth = lit ? Math.min(2.4, 0.8 + w * 0.15) : 0.7;
        g.setLineDash(lit ? [] : [3, 4]);
        g.beginPath(); g.moveTo(x1, y1); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.12; g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
      // the constellations' own lines
      for (const [a, b] of tree) {
        const [x1, y1] = toScreen(a.x, a.y), [x2, y2] = toScreen(b.x, b.y);
        const dim = near && !(near.has(a) && near.has(b));
        g.strokeStyle = colour(a.group); g.globalAlpha = dim ? 0.08 : 0.42; g.lineWidth = b.kind === 'folder' && a.kind === 'folder' ? 2 : 1.2;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.globalAlpha = 1;
      }
      // the stars (names placed so none sits on another; the lit ones and the constellations first)
      const placed = [];
      const free = (x, y, w, hh) => { for (const r of placed) if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + hh > r[1]) return false; placed.push([x, y, w, hh]); return true; };
      const order = nodes.slice().sort((a, b) => ((b === focus) - (a === focus)) || ((near && near.has(b)) - (near && near.has(a))) || ((b.kind === 'folder') - (a.kind === 'folder')) || b.r - a.r);
      const labels = [];
      for (const n of nodes) {
        const [x, y] = toScreen(n.x, n.y); if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
        const c = colour(n.group), r = n.r * Math.max(0.7, Math.min(1.8, view.k * 1.2)), dim = near && !near.has(n);
        g.globalAlpha = dim ? 0.2 : 1;
        if (n.kind === 'folder') {   // a hub: a ring in the folder's colour round a filled centre
          const rr = r * 1.7;
          g.fillStyle = C.bg; g.beginPath(); g.arc(x, y, rr, 0, 6.29); g.fill();
          g.strokeStyle = c; g.lineWidth = n.depth === 1 ? 3 : 2; g.stroke();
          g.fillStyle = c; g.beginPath(); g.arc(x, y, rr * 0.55, 0, 6.29); g.fill();
        } else {
          g.fillStyle = c; g.beginPath(); g.arc(x, y, r * 1.1, 0, 6.29); g.fill();
          g.strokeStyle = C.bg; g.lineWidth = 1.5; g.stroke();
        }
        if (n === focus) { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r * 2.4 + 4, 0, 6.29); g.stroke(); }
        // names: the constellations always, the bright stars when near enough, and whatever is lit
        const big = n.kind === 'folder' && n.depth === 1;
        if (big || n === focus || (near && near.has(n)) || view.k * n.r > 5 || (n.kind === 'folder' && view.k > 0.9)) labels.push([n, x, y, r, big, c]);
      }
      g.globalAlpha = 1; g.textAlign = 'center';
      const rank = new Map(order.map((n, i) => [n, i]));
      labels.sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
      for (const [n, x, y, r, big, c] of labels) {
        g.font = big ? '700 14px system-ui, sans-serif' : n.kind === 'folder' ? '600 12.5px system-ui, sans-serif' : '12px system-ui, sans-serif';
        const label = n.title, w = g.measureText(label).width, ly = y - r * (n.kind === 'folder' ? 2.4 : 1.6) - 6;
        if (!free(x - w / 2 - 4, ly - 13, w + 8, 17) && n !== focus) continue;
        g.globalAlpha = near && !near.has(n) ? 0.25 : 1;
        if (big) {   // the top folders on a pill in their colour
          g.fillStyle = c; g.beginPath(); g.roundRect(x - w / 2 - 8, ly - 14, w + 16, 20, 10); g.fill();
          g.fillStyle = '#fff'; g.fillText(label, x, ly);
        } else {
          g.lineWidth = 3.5; g.strokeStyle = C.bg; g.lineJoin = 'round'; g.strokeText(label, x, ly);   // a halo of the paper behind
          g.fillStyle = n === focus ? c : n.kind === 'folder' ? C.ink : C.soft; g.fillText(label, x, ly);
        }
      }
      g.globalAlpha = 1;
      anim = requestAnimationFrame(frame);
    }
    const nodeAt = (sx, sy) => { let best = null, bd = 18; for (const n of nodes) { const [x, y] = toScreen(n.x, n.y), d = Math.hypot(x - sx, y - sy) - n.r * view.k; if (d < bd) { bd = d; best = n; } } return best; };
    const hrefOf = n => n.kind === 'folder' ? ctx.folderHref(n.folder) : ctx.wikiHref(n.page.path);
    const showTip = (n, sx, sy) => {
      if (!n) { tip.hidden = true; return; }
      const c = lore.card(hrefOf(n));
      fill(tip, h('div', { class: 'k', style: `color:${colour(n.group)}` }, n.kind === 'folder' ? 'Folder · ' + (n.folder.split('/').slice(0, -1).join(' › ') || ctx.site) : n.folder.split('/').join(' › ') || ctx.site),
        h('b', null, n.title), c && c.text ? h('p', null, c.text) : null, h('div', { class: 'm' }, n.mentions ? `Mentioned ${n.mentions} time${n.mentions === 1 ? '' : 's'} · ` : '', 'click to open'));
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(W - tw - 10, sx + 16) + 'px'; tip.style.top = Math.min(H - th - 10, Math.max(10, sy - th / 2)) + 'px';
    };
    let drag = null, moved = false;
    on(cv, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; cv.setPointerCapture(e.pointerId); });
    on(cv, 'pointermove', e => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; view.x = drag.vx - dx / view.k; view.y = drag.vy - dy / view.k; target = null; tip.hidden = true; return; }
      hover = nodeAt(sx, sy); cv.style.cursor = hover ? 'pointer' : 'grab'; showTip(hover, sx, sy);
    });
    on(cv, 'pointerup', e => { const was = drag; drag = null; if (was && !moved) { const r = cv.getBoundingClientRect(), n = nodeAt(e.clientX - r.left, e.clientY - r.top); if (n) location.hash = hrefOf(n); else pinned = null; } });
    on(cv, 'pointerleave', () => { hover = null; tip.hidden = true; });
    on(cv, 'wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, [wx, wy] = toWorld(sx, sy);
      const k = Math.max(0.15, Math.min(6, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.k = k; view.x = wx - (sx - W / 2) / k; view.y = wy - (sy - H / 2) / k; target = null;
    }, { passive: false });
    const flyTo = (n, k) => { target = { x: n.x, y: n.y, k: k || Math.max(view.k, 1.6) }; pinned = n; };
    function focusGroup(gname) {
      const ns = nodes.filter(n => n.group === gname); if (!ns.length) return;
      const xs = ns.map(n => n.x), ys = ns.map(n => n.y), w = Math.max(...xs) - Math.min(...xs) + 120, hh = Math.max(...ys) - Math.min(...ys) + 120;
      target = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, k: Math.min(3, Math.min(W / w, H / hh) * 0.85) };
      pinned = byKey.get('f:' + (scope ? scope + '/' : '') + gname) || null;
    }
    find.onkeydown = e => {
      if (e.key !== 'Enter') return;
      const q = wkey(find.value.trim()); if (!q) return;
      const n = nodes.find(x => wkey(x.title) === q) || nodes.find(x => wkey(x.title).startsWith(q)) || nodes.find(x => wkey(x.title).includes(q));
      if (n) flyTo(n, 2.2);
    };
    // sized once it's on the page
    let stopped = false;
    const start = () => { if (stopped) return; if (!wrap.isConnected) { anim = requestAnimationFrame(start); return; } resize(); fit(); anim = requestAnimationFrame(frame); };
    anim = requestAnimationFrame(start);
    on(window, 'resize', () => { resize(); });
    return { el: wrap, stop: () => { stopped = true; cancelAnimationFrame(anim); for (const f of local.splice(0)) f(); } };
  }


  // ───────────────────────── the night sky: the world's constellations ─────────────────────────
  // From the page that draws them: tables whose first cell names the group ("The Gods") and whose cells hold a
  // constellation's name and picture ("**Bælthatrax ![](…)**"), as the Constellations Compendium does.
  function skyPages() {
    return ctx.pages().filter(p => /!\[[^\]]*\]\([^)]+\)/.test(p.md) && /^\s*\|/m.test(p.md)
      && (/\[\[\s*category\s*:\s*constellations?\s*\]\]/i.test(p.md) || /constellation|celestial|night sky|stargaz/i.test(p.title + ' ' + p.md.slice(0, 400))));
  }
  function readConstellations(page) {
    const out = [], lines = page.md.split('\n');
    let group = '', lastHeading = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const hm = /^#{1,6}\s+(.+)$/.exec(l); if (hm) { lastHeading = lore.clean(hm[1]); continue; }
      if (!/^\s*\|/.test(l)) { group = ''; continue; }
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{3,}:?$/.test(c) || !c)) continue;
      const pics = cells.map(c => /!\[[^\]]*\]\(<?([^)\s>]+)>?\)/.exec(c));
      if (!pics.some(Boolean)) { group = lore.clean(cells.find(Boolean) || '') || lastHeading; continue; }   // a table's first row: the group
      cells.forEach((c, k) => { if (!pics[k]) return; const name = lore.clean(c.replace(/!\[[^\]]*\]\([^)]*\)/g, '')).trim(); if (name) out.push({ name, img: pics[k][1], group: group || lastHeading || 'Constellations' }); });
    }
    return out;
  }
  // a picture with its night-blue background taken away, so only the stars and their lines are left
  function keyed(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        let d; try { d = g.getImageData(0, 0, c.width, c.height); } catch (e) { return res(c); }
        const px = d.data, W = c.width, H = c.height, edge = [];
        for (let x = 0; x < W; x += 3) { edge.push(x * 4, ((H - 1) * W + x) * 4); }
        for (let y = 0; y < H; y += 3) { edge.push(y * W * 4, (y * W + W - 1) * 4); }
        const med = k => { const v = edge.map(i => px[i + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
        const bg = [med(0), med(1), med(2)], room = 255 - Math.max(...bg);
        for (let i = 0; i < px.length; i += 4) {
          const diff = Math.max(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
          const a = Math.max(0, Math.min(1, diff / room * 1.15)) * (px[i + 3] / 255);
          px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255);
        }
        g.putImageData(d, 0, 0); res(c);
      };
      img.onerror = () => res(null);
      img.src = src;
    });
  }
  const SKYCOL = ['#ffe3a3', '#bfe0ff', '#ffc4d6', '#c9ffc0', '#e2ccff'];
  const NAVY = '#101d47';

  // ── the constellations as drawn in the Observatory's builder (the server keeps them: /api/site/constellations)
  // { groups: [name], constellations: [{ id, name, group, page, about, hidden, w, h, stars: [{ x, y, m, name? }], lines: [[i, j]] }] }
  // Each is drawn in its own frame, w × h units (the longer side 1000); m is a star's brightness, 1 (faint) to 4.
  let skyData = null;
  const loadSky = () => fetch('/api/site/constellations', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null)
    .then(d => { if (d && Array.isArray(d.constellations)) skyData = d; return skyData; });
  // a constellation as the Compendium draws them: white lines with a soft glow, and each star a point of light in its halo
  function drawCon(g, c, k, o) {
    o = o || {};
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    const st = c.stars;
    // the lines, glowing a little
    const lw = o.lw || 1, sw = o.sw || 1;   // thicker lines and bigger stars for a small picture
    g.strokeStyle = o.lineColor || 'rgba(255,255,255,0.95)'; g.lineWidth = Math.max(1, 6.5 * k * lw);
    g.shadowColor = 'rgba(190,210,255,0.85)'; g.shadowBlur = Math.max(2, 14 * k * lw);
    g.beginPath();
    for (const [i, j] of c.lines) { const a = st[i], b = st[j]; if (!a || !b) continue; g.moveTo(a.x * k, a.y * k); g.lineTo(b.x * k, b.y * k); }
    g.stroke();
    g.shadowBlur = 0;
    // the halos, then the points
    for (const s of st) {
      const m = s.m || 2, R = (10 + m * 13) * k * sw;
      const gr = g.createRadialGradient(s.x * k, s.y * k, 0, s.x * k, s.y * k, R);
      gr.addColorStop(0, `rgba(255,255,255,${0.32 + m * 0.1})`); gr.addColorStop(0.35, `rgba(220,230,255,${0.08 + m * 0.05})`); gr.addColorStop(1, 'rgba(200,215,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(s.x * k, s.y * k, R, 0, 6.2832); g.fill();
    }
    g.fillStyle = '#fff';
    for (const s of st) { g.beginPath(); g.arc(s.x * k, s.y * k, Math.max(1, (3.5 + (s.m || 2) * 2.4) * k * sw), 0, 6.2832); g.fill(); }
    g.restore();
  }
  // a picture of one (transparent, or on the night-blue of the Compendium), the longer side `px` across
  function conPicture(c, px, bg, o) {
    const pad = 70, k = px / (Math.max(c.w, c.h) + pad * 2);
    const cv = document.createElement('canvas'); cv.width = Math.round((c.w + pad * 2) * k); cv.height = Math.round((c.h + pad * 2) * k);
    const g = cv.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height); }
    g.translate(pad * k, pad * k); drawCon(g, c, k, o);
    return cv;
  }
  const conPage = c => (c.page && ctx.findPage(c.page)) || ctx.findPage(c.name) || ctx.findPage(c.name.replace(/^The\s+/, '')) || null;

  function constellation(art, arg) {
    if (/^build\b/.test(arg || '')) return builder(art, decodeURIComponent((arg.split('/')[1] || '')));
    document.body.classList.add('lib-sky');
    ctx.renderTop(null, { label: 'The Observatory' });
    fill(art, h('div', { class: 'sky' }, h('div', { class: 'skyloading' }, 'Looking up…')));
    let gone = false; stop.push(() => { gone = true; });
    loadSky().then(d => { if (!gone) observatory(art, d); });
  }
  function observatory(art, data) {
    const src = skyPages()[0];
    let items = [], vector = false;
    if (data && data.constellations.length) {
      vector = true;
      items = data.constellations.map(c => ({ name: c.name, group: c.group || 'Constellations', about: c.about, con: c, hidden: c.hidden }));
    } else if (src) items = readConstellations(src);
    if (!items.length) {
      fill(art, h('div', { class: 'skyempty' }, h('h1', { class: 'ptitle' }, 'The Observatory'),
        h('p', null, 'No constellations yet. Draw them in the constellation builder, or import the constellations document into the wiki (Import a document, then paste its Google Docs link): any page with tables of constellation names and their pictures shows here, one table per group.'),
        ctx.admin ? h('p', null, h('a', { class: 'btn primary', href: '#/observatory/build' }, 'Open the constellation builder'), ' ', h('a', { class: 'btn', href: '#/wiki/Special:Import' }, 'Import a document')) : null));
      return;
    }
    // the groups as rings round the pole: in the order they're listed (else the largest outermost, like a zodiac)
    const listed = vector && data.groups && data.groups.length ? data.groups : [];
    const groups = [...new Set(items.map(x => x.group))].sort((a, b) => {
      const ia = listed.indexOf(a), ib = listed.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return items.filter(x => x.group === b).length - items.filter(x => x.group === a).length;
    });
    const RING = [1000, 640, 300, 140], SIZE = [250, 220, 175, 150];
    for (const it of items) {
      const gi = groups.indexOf(it.group), mates = items.filter(x => x.group === it.group), k = mates.indexOf(it);
      it.ring = gi; it.r = RING[Math.min(gi, RING.length - 1)] * (gi >= RING.length ? 0.6 : 1); it.a = (k / mates.length) * Math.PI * 2 - Math.PI / 2 + gi * 0.35;
      it.size = SIZE[Math.min(gi, SIZE.length - 1)] * (vector ? 1.25 : 1); it.col = SKYCOL[gi % SKYCOL.length];
      it.page = it.con ? conPage(it.con) : ctx.findPage(it.name) || ctx.findPage(it.name.replace(/^The\s+/, '')) || null;
    }
    const wrap = h('div', { class: 'sky' }), cv = h('canvas'), g = cv.getContext('2d');
    const card = h('div', { class: 'starcard', hidden: true });
    const names = h('input', { type: 'checkbox', checked: true }), turn = h('input', { type: 'checkbox', checked: true });
    const panel = h('div', { class: 'obspanel' }, h('h1', null, 'The night sky'),
      h('p', null, `${items.length} constellations: `, groups.map((x, i) => [i ? ', ' : '', h('b', { style: `color:${SKYCOL[i % SKYCOL.length]}` }, x)]), '.'),
      h('p', { class: 'src' }, vector ? '' : ['From ', h('a', { href: ctx.wikiHref(src.path) }, src.title), '. '], 'Drag to turn the sky, scroll to come closer, click a constellation to read about it.'),
      h('label', { class: 'skyall' }, names, ' Names'), h('label', { class: 'skyall' }, turn, ' Let the sky turn'),
      ctx.admin ? h('a', { class: 'btn sm obsbuild', href: '#/observatory/build' }, '✦ Constellation builder') : null);
    wrap.append(cv, panel, card);
    fill(art, wrap);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const field = Array.from({ length: 1400 }, () => { const r = Math.sqrt(rnd()) * 1320, a = rnd() * 6.283; return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: rnd() * 1.3 + 0.2, p: rnd() * 6.28, w: 0.5 + rnd() * 2 }; });
    // a band of fainter stars across the chart, like a galaxy's arm
    const band = Array.from({ length: 900 }, () => { const t = rnd() * 2 - 1, off = (rnd() + rnd() + rnd() - 1.5) * 120; return { x: t * 1300 + off * 0.4, y: t * 420 + off, s: rnd() * 0.8 + 0.15, p: rnd() * 6.28, w: 1 + rnd() }; });
    let W = 0, H = 0, dpr = 1, view = { k: 0.35, rot: 0 }, hover = null, picked = null, anim = null, lastT = performance.now(), idle = 0;
    const resize = () => { const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; view.k = view.k0 || (view.k0 = Math.min(W, H) / 2 / 1330); };
    const centre = () => [W > 900 ? W / 2 + 140 : W / 2, H / 2];
    const place = it => { const a = it.a + view.rot; return { x: Math.cos(a) * it.r, y: Math.sin(a) * it.r, ang: a + Math.PI / 2 }; };
    for (const it of items) {
      if (it.con) it.pic = conPicture(it.con, 420, null, { lw: 2.4, sw: 1.5 });
      else keyed(it.img).then(c => { it.pic = c; });
    }
    function frame(t) {
      const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
      if (turn.checked && !drag && (t - idle) > 2500) view.rot += dt * 0.012;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#03050c'; g.fillRect(0, 0, W, H);
      const [cx, cy] = centre();
      g.save(); g.translate(cx, cy); g.scale(view.k, view.k);
      // the chart's disc, its rings and the sky behind
      const disc = g.createRadialGradient(0, 0, 0, 0, 0, 1330);
      disc.addColorStop(0, '#16224a'); disc.addColorStop(0.65, '#0d1534'); disc.addColorStop(1, '#070b1d');
      g.fillStyle = disc; g.beginPath(); g.arc(0, 0, 1330, 0, 6.29); g.fill();
      g.save(); g.rotate(view.rot);
      for (const s of band) { g.globalAlpha = 0.25 + 0.2 * Math.sin(t / 1300 * s.w + s.p); g.fillStyle = '#cdd8ff'; g.beginPath(); g.arc(s.x, s.y, s.s / Math.max(0.6, view.k), 0, 6.29); g.fill(); }
      for (const s of field) { g.globalAlpha = 0.35 + 0.4 * Math.sin(t / 1000 * s.w + s.p); g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.s / Math.max(0.6, view.k), 0, 6.29); g.fill(); }
      g.globalAlpha = 1;
      // the rings between the groups, and the rim's marks
      g.strokeStyle = 'rgba(180,200,255,0.10)'; g.lineWidth = 1.2 / view.k;
      const bounds = [1330, (RING[0] + RING[1]) / 2, (RING[1] + RING[2]) / 2, (RING[2] + RING[3]) / 2].slice(0, groups.length);
      for (const r of bounds) { g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.stroke(); }
      g.strokeStyle = 'rgba(200,215,255,0.22)';
      for (let k = 0; k < 72; k++) { const a = k / 72 * 6.283, l = k % 6 ? 18 : 40; g.beginPath(); g.moveTo(Math.cos(a) * 1330, Math.sin(a) * 1330); g.lineTo(Math.cos(a) * (1330 - l), Math.sin(a) * (1330 - l)); g.stroke(); }
      g.restore();
      // the constellations: each set upright from the pole, so the whole chart turns together
      for (const it of items) {
        if (!it.pic) continue;
        const p = place(it), on = it === hover || it === picked, w = it.size * it.pic.width / Math.max(it.pic.width, it.pic.height), hh = it.size * it.pic.height / Math.max(it.pic.width, it.pic.height);
        it.box = { x: p.x, y: p.y, w, h: hh, ang: p.ang };
        g.save(); g.translate(p.x, p.y); g.rotate(p.ang);
        g.globalAlpha = ((hover || picked) && !on ? 0.45 : 0.92 + 0.08 * Math.sin(t / 900 + it.a * 3)) * (it.hidden ? 0.5 : 1);
        if (on) { g.shadowColor = it.col; g.shadowBlur = 28; }
        g.drawImage(it.pic, -w / 2, -hh / 2, w, hh);
        if (on) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5; g.drawImage(it.pic, -w / 2, -hh / 2, w, hh); g.globalCompositeOperation = 'source-over'; }
        g.restore();
      }
      g.restore();
      // names, upright on the screen
      g.globalAlpha = 1; g.textAlign = 'center';
      for (const it of items) {
        if (!it.box || !(names.checked || it === hover || it === picked)) continue;
        const sx = cx + it.box.x * view.k, sy = cy + it.box.y * view.k, off = (Math.max(it.box.w, it.box.h) / 2 + 26) * view.k;
        const dx = Math.cos(it.a + view.rot), dy = Math.sin(it.a + view.rot);
        g.font = (it === hover || it === picked ? '600 15px' : '13px') + ' Georgia, serif';
        g.fillStyle = it === hover || it === picked ? '#fff' : it.col; g.globalAlpha = it === hover || it === picked ? 1 : 0.8;
        g.fillText(it.name + (it.hidden ? ' (hidden)' : ''), sx + dx * off, sy + dy * off + 4);
      }
      g.globalAlpha = 1;
      anim = requestAnimationFrame(frame);
    }
    // which constellation is under the pointer (inside its picture's turned box)
    const hit = (mx, my) => {
      const [cx, cy] = centre(), wx = (mx - cx) / view.k, wy = (my - cy) / view.k;
      let best = null;
      for (const it of items) { if (!it.box) continue; const dx = wx - it.box.x, dy = wy - it.box.y, c = Math.cos(-it.box.ang), s = Math.sin(-it.box.ang), lx = dx * c - dy * s, ly = dx * s + dy * c; if (Math.abs(lx) < it.box.w / 2 && Math.abs(ly) < it.box.h / 2) best = it; }
      return best;
    };
    function show(it) {
      picked = it;
      if (!it) { card.hidden = true; return; }
      const c = it.page ? lore.card(ctx.wikiHref(it.page.path)) : null;
      const about = it.about ? h('div', null, ...it.about.split(/\n\s*\n/).map(p => linked(p.trim()))) : null;
      fill(card, h('button', { class: 'x', title: 'Close', onclick: () => show(null) }, '×'),
        h('div', { class: 'k', style: `color:${it.col}` }, it.group), h('h2', null, it.name),
        it.con ? conPicture(it.con, 520, null, { lw: 1.4, sw: 1.2 })
          : it.pic ? (() => { const cc = h('canvas', { width: it.pic.width, height: it.pic.height }); cc.getContext('2d').drawImage(it.pic, 0, 0); return cc; })() : null,
        about || (c && c.text ? h('p', null, c.text) : h('p', { class: 'muted' }, 'Nothing written about it yet.')),
        it.page ? h('a', { class: 'btn', href: ctx.wikiHref(it.page.path) }, `Read about ${it.page.title} ›`) : null,
        ctx.admin && it.con ? h('a', { class: 'btn', href: '#/observatory/build/' + encodeURIComponent(it.con.id) }, 'Edit') : null);
      card.hidden = false;
    }
    let drag = null, moved = false;
    on(cv, 'pointerdown', e => { const [cx, cy] = centre(); drag = { a: Math.atan2(e.offsetY - cy, e.offsetX - cx), rot: view.rot }; moved = false; cv.setPointerCapture(e.pointerId); idle = performance.now(); });
    on(cv, 'pointermove', e => {
      if (drag) { const [cx, cy] = centre(), a = Math.atan2(e.offsetY - cy, e.offsetX - cx); if (Math.abs(a - drag.a) > 0.01) moved = true; view.rot = drag.rot + (a - drag.a); idle = performance.now(); return; }
      hover = hit(e.offsetX, e.offsetY); cv.style.cursor = hover ? 'pointer' : 'grab';
    });
    on(cv, 'pointerup', e => { const was = drag; drag = null; idle = performance.now(); if (was && !moved) show(hit(e.offsetX, e.offsetY)); });
    on(cv, 'pointerleave', () => { hover = null; });
    on(cv, 'wheel', e => { e.preventDefault(); view.k = Math.max(view.k0 * 0.6, Math.min(view.k0 * 4, view.k * Math.exp(-e.deltaY * 0.0012))); idle = performance.now(); }, { passive: false });
    on(cv, 'dblclick', () => { view.k = view.k0; });
    resize();
    on(window, 'resize', () => { view.k0 = 0; resize(); });
    anim = requestAnimationFrame(frame);
    stop.push(() => cancelAnimationFrame(anim));
    document.title = `The Observatory · ${ctx.site}`;
  }

  // ───────────────────────── the constellation builder (admins) ─────────────────────────
  // Draw a constellation star by star on the night-blue of the Compendium: click to place a star (joined to the one
  // picked, so a figure can be drawn in one go), click two stars to join them or part them, drag to move, 1–4 for how
  // bright. Each has a name, a group (a ring of the sky), the wiki page about it and a few words; save keeps them all
  // on the server (the last 30 versions too). A picture can be laid underneath to trace, and any can be saved as a PNG.
  const DRAFT = 'valanar-constellations-draft';
  function builder(art, startId) {
    document.body.classList.add('lib-sky', 'lib-build');
    stop.push(() => document.body.classList.remove('lib-build'));
    ctx.renderTop(null, { label: 'Constellation builder' });
    document.title = `Constellation builder · ${ctx.site}`;
    if (!ctx.admin) {
      fill(art, h('div', { class: 'skyempty' }, h('h1', { class: 'ptitle' }, 'Constellation builder'), h('p', null, 'Only the GM draws the constellations. ', h('a', { href: '#/observatory' }, 'See them in the Observatory ›'))));
      return;
    }
    fill(art, h('div', { class: 'cb' }, h('div', { class: 'skyloading' }, 'Fetching the constellations…')));
    let gone = false; stop.push(() => { gone = true; });
    loadSky().then(d => { if (!gone) build(art, d || { groups: [], constellations: [] }, startId); });
  }
  function build(art, saved, startId) {
    const clone = o => JSON.parse(JSON.stringify(o));
    let data = clone(saved), dirty = false, savedRev = saved.rev || 0;
    // unsaved work from last time (kept in this browser if the builder was left without saving)
    let draft = null; try { draft = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch (e) { draft = null; }
    let cur = data.constellations.find(c => c.id === startId) || data.constellations[0] || null;
    let sel = null, selLine = null, hoverStar = -1, hoverLine = -1;
    const undo = [], redo = [];
    const snap = () => { undo.push(JSON.stringify({ data, cur: cur && cur.id })); if (undo.length > 200) undo.shift(); redo.length = 0; };
    const restore = (s) => { const o = JSON.parse(s); data = o.data; cur = data.constellations.find(c => c.id === o.cur) || data.constellations[0] || null; sel = selLine = null; touch(); drawAll(); };
    const touch = () => { dirty = true; try { sessionStorage.setItem(DRAFT, JSON.stringify({ data, rev: savedRev, at: Date.now() })); } catch (e) { /* full */ } saveBtn.classList.add('primary'); saveBtn.textContent = 'Save'; };
    const newId = name => { let b = (name || 'constellation').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'constellation', id = b, n = 2; while (data.constellations.some(c => c.id === id)) id = b + '-' + n++; return id; };

    // ── the parts of the page
    const list = h('div', { class: 'cblist' });
    const cv = h('canvas', { class: 'cbcanvas', tabindex: 0 }), g = cv.getContext('2d');
    const stage = h('div', { class: 'cbstage' }, cv);
    const props = h('div', { class: 'cbprops' });
    const saveBtn = h('button', { class: 'btn', onclick: () => save() }, 'Saved');
    const traceSel = h('select', { title: 'A picture underneath to trace', onchange: () => { traceKey = traceSel.value; loadTrace(); } });
    const traceOp = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 0.45, title: 'How strongly the picture shows', oninput: () => drawAll() });
    const traceFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = traceFile.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { traceKey = 'file'; ownTrace = r.result; fillTrace(); loadTrace(); }; r.readAsDataURL(f); } });
    const tools = h('div', { class: 'cbtools' },
      h('a', { class: 'btn sm', href: '#/observatory' }, '‹ Observatory'),
      h('button', { class: 'btn sm', title: 'Undo (Ctrl+Z)', onclick: () => doUndo() }, '↶'), h('button', { class: 'btn sm', title: 'Redo (Ctrl+Y)', onclick: () => doRedo() }, '↷'),
      h('span', { class: 'cbsep' }),
      h('label', { class: 'cbtrace' }, 'Trace ', traceSel, traceOp, h('button', { class: 'btn sm', title: 'Trace a picture from this computer (it stays here, nothing is uploaded)', onclick: () => traceFile.click() }, 'Picture…'), traceFile),
      h('span', { class: 'cbsep' }),
      h('button', { class: 'btn sm', title: 'Fit the frame snugly round the stars', onclick: () => fitFrame() }, 'Fit frame'),
      h('button', { class: 'btn sm', title: 'Save this one as a picture', onclick: () => exportPNG() }, 'PNG'),
      h('span', { style: 'flex:1' }),
      h('span', { class: 'cbhelp', title: 'Click: a new star (joined to the picked one; Shift: on its own) · Click two stars: join or part them · Drag: move · 1–4: brightness · Delete: remove · Esc: let go' }, '?'),
      saveBtn);
    fill(art, h('div', { class: 'cb' }, list, h('div', { class: 'cbmain' }, tools, stage, h('div', { class: 'cbhint' }, 'Click to place a star · click two stars to join them (again to part them) · drag to move · Shift+click for a star on its own · 1–4 brightness · Delete removes · Ctrl+Z undoes')), props));

    const same = (a, b) => JSON.stringify({ g: a.groups || [], c: a.constellations || [] }) === JSON.stringify({ g: b.groups || [], c: b.constellations || [] });
    if (draft && draft.data && !same(draft.data, saved)) {
      const bar = h('div', { class: 'cbdraft' }, `Unsaved changes from ${new Date(draft.at).toLocaleString()} are still here. `,
        h('button', { class: 'btn sm primary', onclick: () => { snap(); data = draft.data; cur = data.constellations.find(c => cur && c.id === cur.id) || data.constellations[0] || null; bar.remove(); touch(); drawAll(); } }, 'Bring them back'),
        h('button', { class: 'btn sm', onclick: () => { try { sessionStorage.removeItem(DRAFT); } catch (e) { /* */ } bar.remove(); } }, 'Throw them away'));
      art.querySelector('.cbmain').prepend(bar);
    }

    // ── tracing: the Compendium's pictures (matched by name), or one of your own
    const compendium = (() => { const p = skyPages()[0]; return p ? readConstellations(p) : []; })();
    let traceKey = 'auto', trace = null, ownTrace = null, traceFor = null;
    function fillTrace() {
      const match = cur && compendium.find(x => wkey(x.name) === wkey(cur.name));
      fill(traceSel, h('option', { value: 'auto' }, match ? 'Its Compendium picture' : 'Nothing'), match ? h('option', { value: 'none' }, 'Nothing') : null,
        ...compendium.map((x, i) => h('option', { value: 'c' + i }, x.name)), ownTrace ? h('option', { value: 'file' }, 'Your picture') : null);
      traceSel.value = traceKey;
    }
    function loadTrace() {
      const key = traceKey, c = cur;
      let src = null;
      if (key === 'file') src = ownTrace;
      else if (key === 'auto') { const m = c && compendium.find(x => wkey(x.name) === wkey(c.name)); src = m ? m.img : null; }
      else if (/^c\d+$/.test(key)) src = (compendium[+key.slice(1)] || {}).img;
      traceFor = src; trace = null;
      if (!src) { drawAll(); return; }
      const img = new Image(); img.onload = () => { if (traceFor === src) { trace = img; drawAll(); } }; img.src = src;
    }

    // ── the list
    function drawList() {
      const groups = [...new Set([...(data.groups || []), ...data.constellations.map(c => c.group || '')])];
      fill(list, h('div', { class: 'cbhead' }, h('b', null, 'Constellations'), h('span', { class: 'muted' }, ` ${data.constellations.length}`)),
        ...groups.map(gname => {
          const mine = data.constellations.filter(c => (c.group || '') === gname);
          if (!mine.length) return null;
          return h('div', { class: 'cbgroup' }, h('div', { class: 'cbgname' }, gname || 'No group'),
            ...mine.map(c => {
              const thumb = conPicture(c, 80, NAVY, { lw: 1.8, sw: 1.3 }); thumb.className = 'cbthumb';
              return h('button', { class: 'cbitem' + (c === cur ? ' on' : '') + (c.hidden ? ' hid' : ''), onclick: () => pick(c) }, thumb, h('span', null, c.name, c.hidden ? h('em', null, ' hidden') : null));
            }));
        }),
        h('button', { class: 'btn sm cbnew', onclick: () => addNew() }, '+ New constellation'));
    }
    function pick(c) { cur = c; sel = selLine = null; traceKey = 'auto'; fillTrace(); loadTrace(); drawAll(); try { history.replaceState(null, '', '#/observatory/build/' + encodeURIComponent(c.id)); } catch (e) { /* */ } }
    function addNew() {
      snap();
      const c = { id: newId('new'), name: 'New constellation', group: (cur && cur.group) || (data.groups || [])[0] || '', page: '', about: '', hidden: false, w: 1000, h: 750, stars: [], lines: [] };
      data.constellations.push(c); touch(); pick(c);
      setTimeout(() => { const n = props.querySelector('input[name=name]'); if (n) { n.focus(); n.select(); } }, 0);
    }

    // ── the properties
    function drawProps() {
      if (!cur) { fill(props, h('p', { class: 'muted' }, 'Pick a constellation, or start a new one.')); return; }
      const c = cur;
      const field = (label, el) => h('label', { class: 'cbfield' }, h('span', null, label), el);
      const change = (k, v, redrawList) => { if (c[k] === v) return; snap(); c[k] = v; touch(); if (redrawList) drawList(); if (k === 'name') { fillTrace(); } };
      const groupList = h('datalist', { id: 'cbgroups' }, ...[...new Set([...(data.groups || []), ...data.constellations.map(x => x.group).filter(Boolean)])].map(x => h('option', { value: x })));
      const pageList = h('datalist', { id: 'cbpages' }, ...ctx.pages().filter(p => !p.deleted).slice(0, 3000).map(p => h('option', { value: p.title })));
      const pg = conPage(c);
      const s = sel != null ? c.stars[sel] : null;
      fill(props, 
        field('Name', h('input', { name: 'name', value: c.name, onchange: e => change('name', e.target.value.trim() || 'Unnamed', true) })),
        field('Group (its ring in the sky)', h('input', { value: c.group || '', list: 'cbgroups', onchange: e => { change('group', e.target.value.trim(), true); } })), groupList,
        field('Wiki page about it', h('input', { value: c.page || '', list: 'cbpages', placeholder: pg ? pg.title : 'found by its name', onchange: e => { change('page', e.target.value.trim()); drawProps(); } })), pageList,
        pg ? h('a', { class: 'cblink', href: ctx.wikiHref(pg.path), target: '_blank' }, `${pg.title} ↗`) : h('div', { class: 'muted small' }, 'No page found by that name.'),
        field('About it (shown when it’s clicked)', h('textarea', { rows: 5, value: c.about || '', placeholder: 'Its story, when it rises, what sailors call it…', onchange: e => change('about', e.target.value) })),
        h('label', { class: 'cbcheck' }, h('input', { type: 'checkbox', checked: c.hidden || null, onchange: e => change('hidden', e.target.checked, true) }), 'Hidden from players'),
        h('div', { class: 'cbstats muted' }, `${c.stars.length} stars · ${c.lines.length} lines`),
        s ? h('div', { class: 'cbstar' }, h('div', { class: 'cbgname' }, `Star ${sel + 1}`),
          h('div', { class: 'cbmag' }, 'Brightness ', ...[1, 2, 3, 4].map(m => h('button', { class: 'btn sm' + (s.m === m ? ' on' : ''), onclick: () => { snap(); s.m = m; touch(); drawAll(); } }, String(m)))),
          field('Its own name (if it has one)', h('input', { value: s.name || '', onchange: e => { snap(); if (e.target.value.trim()) s.name = e.target.value.trim(); else delete s.name; touch(); drawAll(); } })),
          h('button', { class: 'btn sm', onclick: () => removeStar(sel) }, 'Remove this star')) : null,
        selLine != null ? h('div', { class: 'cbstar' }, h('div', { class: 'cbgname' }, 'Line'), h('button', { class: 'btn sm', onclick: () => removeLine(selLine) }, 'Remove this line')) : null,
        h('div', { class: 'cbdanger' }, h('button', { class: 'btn sm', onclick: () => {
          if (!confirm(`Remove ${c.name} from the sky? (Save to make it final; the last 30 saves are kept.)`)) return;
          snap(); data.constellations.splice(data.constellations.indexOf(c), 1); cur = data.constellations[0] || null; sel = selLine = null; touch(); fillTrace(); loadTrace(); drawAll();
        } }, 'Remove this constellation')));
    }

    // ── the drawing board: the constellation's frame (night blue) fitted into the stage
    let W = 0, H = 0, dpr = 1, k = 1, ox = 0, oy = 0;
    function layout() {
      const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = Math.max(50, r.width); H = Math.max(50, r.height);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      if (!cur) return;
      k = Math.min((W - 60) / cur.w, (H - 60) / cur.h); ox = (W - cur.w * k) / 2; oy = (H - cur.h * k) / 2;
    }
    const toU = (x, y) => [(x - ox) / k, (y - oy) / k];
    function draw() {
      layout();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0a0f22'; g.fillRect(0, 0, W, H);
      if (!cur) { g.fillStyle = '#8f9ac0'; g.font = '15px Georgia, serif'; g.textAlign = 'center'; g.fillText('No constellation picked', W / 2, H / 2); return; }
      g.fillStyle = NAVY; g.fillRect(ox, oy, cur.w * k, cur.h * k);
      if (trace) {   // the picture, fitted to the frame
        const s = Math.min(cur.w * k / trace.width, cur.h * k / trace.height), tw = trace.width * s, th = trace.height * s;
        g.globalAlpha = +traceOp.value; g.drawImage(trace, ox + (cur.w * k - tw) / 2, oy + (cur.h * k - th) / 2, tw, th); g.globalAlpha = 1;
      }
      g.strokeStyle = 'rgba(160,180,255,0.18)'; g.lineWidth = 1; g.strokeRect(ox + 0.5, oy + 0.5, cur.w * k - 1, cur.h * k - 1);
      g.save(); g.translate(ox, oy);
      drawCon(g, cur, k);
      // what's picked, and what the pointer is over
      const st = cur.stars;
      if (selLine != null && cur.lines[selLine]) { const [i, j] = cur.lines[selLine]; g.strokeStyle = '#ffd36b'; g.lineWidth = 3; g.beginPath(); g.moveTo(st[i].x * k, st[i].y * k); g.lineTo(st[j].x * k, st[j].y * k); g.stroke(); }
      else if (hoverLine >= 0 && cur.lines[hoverLine] && hoverStar < 0) { const [i, j] = cur.lines[hoverLine]; g.strokeStyle = 'rgba(255,211,107,0.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(st[i].x * k, st[i].y * k); g.lineTo(st[j].x * k, st[j].y * k); g.stroke(); }
      if (sel != null && st[sel] && ptr && !dragging && hoverStar !== sel) {   // where the next line would go
        g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,211,107,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(st[sel].x * k, st[sel].y * k); g.lineTo(ptr[0] - ox, ptr[1] - oy); g.stroke(); g.setLineDash([]);
      }
      st.forEach((s, i) => {
        if (i !== sel && i !== hoverStar) return;
        g.strokeStyle = i === sel ? '#ffd36b' : 'rgba(255,211,107,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(s.x * k, s.y * k, Math.max(9, (8 + s.m * 3) * k), 0, 6.2832); g.stroke();
      });
      g.font = '12px Georgia, serif'; g.fillStyle = 'rgba(230,236,255,0.85)'; g.textAlign = 'left';
      for (const s of st) if (s.name) g.fillText(s.name, s.x * k + 10, s.y * k - 10);
      g.restore();
    }
    function drawAll() { drawList(); drawProps(); draw(); }

    // ── editing
    const starAt = (x, y) => { if (!cur) return -1; let best = -1, bd = 14; cur.stars.forEach((s, i) => { const d = Math.hypot(s.x * k + ox - x, s.y * k + oy - y); if (d < bd) { bd = d; best = i; } }); return best; };
    const lineAt = (x, y) => {
      if (!cur) return -1; let best = -1, bd = 7;
      cur.lines.forEach(([i, j], n) => {
        const a = cur.stars[i], b = cur.stars[j]; const ax = a.x * k + ox, ay = a.y * k + oy, bx = b.x * k + ox, by = b.y * k + oy;
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2; if (!L2) return; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
        const d = Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y); if (d < bd) { bd = d; best = n; }
      });
      return best;
    };
    function toggleLine(i, j) {
      if (i === j) return;
      const n = cur.lines.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
      if (n >= 0) cur.lines.splice(n, 1); else cur.lines.push([i, j]);
    }
    function removeStar(i) {
      snap();
      cur.lines = cur.lines.filter(([a, b]) => a !== i && b !== i).map(([a, b]) => [a > i ? a - 1 : a, b > i ? b - 1 : b]);
      cur.stars.splice(i, 1); sel = null; selLine = null; touch(); drawAll();
    }
    function removeLine(n) { snap(); cur.lines.splice(n, 1); selLine = null; touch(); drawAll(); }
    function fitFrame() {
      if (!cur || !cur.stars.length) return;
      snap();
      const xs = cur.stars.map(s => s.x), ys = cur.stars.map(s => s.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 30, w = x1 - x0 + pad * 2, hh = y1 - y0 + pad * 2, s = 1000 / Math.max(w, hh);
      for (const st of cur.stars) { st.x = Math.round((st.x - x0 + pad) * s * 10) / 10; st.y = Math.round((st.y - y0 + pad) * s * 10) / 10; }
      cur.w = Math.round(w * s); cur.h = Math.round(hh * s); touch(); drawAll();
    }
    let ptr = null, down = null, dragging = false;
    on(cv, 'pointerdown', e => {
      if (!cur) return;
      cv.focus(); cv.setPointerCapture(e.pointerId);
      const x = e.offsetX, y = e.offsetY, i = starAt(x, y);
      down = { x, y, star: i, line: i < 0 ? lineAt(x, y) : -1, shift: e.shiftKey, snapped: false };
      dragging = false;
    });
    on(cv, 'pointermove', e => {
      ptr = [e.offsetX, e.offsetY];
      if (down && down.star >= 0 && (dragging || Math.hypot(e.offsetX - down.x, e.offsetY - down.y) > 4)) {
        if (!down.snapped) { snap(); down.snapped = true; }
        dragging = true;
        const [ux, uy] = toU(e.offsetX, e.offsetY), s = cur.stars[down.star];
        s.x = Math.round(Math.max(0, Math.min(cur.w, ux)) * 10) / 10; s.y = Math.round(Math.max(0, Math.min(cur.h, uy)) * 10) / 10;
        dirty = true; draw(); return;
      }
      const hs = starAt(e.offsetX, e.offsetY), hl = hs < 0 ? lineAt(e.offsetX, e.offsetY) : -1;
      cv.style.cursor = hs >= 0 ? 'grab' : hl >= 0 ? 'pointer' : 'crosshair';
      hoverStar = hs; hoverLine = hl; draw();
    });
    on(cv, 'pointerleave', () => { ptr = null; hoverStar = hoverLine = -1; draw(); });
    on(cv, 'pointerup', e => {
      const d = down; down = null; if (!d || !cur) return;
      if (dragging) { dragging = false; sel = d.star; touch(); drawAll(); return; }
      if (d.star >= 0) {   // a star: pick it, or join it to the picked one (or part them)
        if (sel != null && sel !== d.star && !d.shift) { snap(); toggleLine(sel, d.star); touch(); sel = d.star; }
        else sel = sel === d.star ? null : d.star;
        selLine = null; drawAll(); return;
      }
      if (d.line >= 0) { selLine = d.line; sel = null; drawAll(); return; }
      const [ux, uy] = toU(d.x, d.y);
      if (ux < 0 || uy < 0 || ux > cur.w || uy > cur.h) { sel = selLine = null; drawAll(); return; }
      snap();
      cur.stars.push({ x: Math.round(ux * 10) / 10, y: Math.round(uy * 10) / 10, m: 2 });
      const n = cur.stars.length - 1;
      if (sel != null && !d.shift) cur.lines.push([sel, n]);
      sel = n; selLine = null; touch(); drawAll();
    });
    on(cv, 'keydown', e => {
      if (!cur) return;
      if (e.key === 'Escape') { sel = selLine = null; drawAll(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) { e.preventDefault(); removeStar(sel); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selLine != null) { e.preventDefault(); removeLine(selLine); }
      else if (/^[1-4]$/.test(e.key) && sel != null) { snap(); cur.stars[sel].m = +e.key; touch(); drawAll(); }
      else if (/^Arrow/.test(e.key) && sel != null) {
        e.preventDefault(); snap(); const s = cur.stars[sel], d = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft') s.x -= d; if (e.key === 'ArrowRight') s.x += d; if (e.key === 'ArrowUp') s.y -= d; if (e.key === 'ArrowDown') s.y += d;
        touch(); draw();
      }
    });
    function doUndo() { if (!undo.length) return; redo.push(JSON.stringify({ data, cur: cur && cur.id })); restore(undo.pop()); }
    function doRedo() { if (!redo.length) return; undo.push(JSON.stringify({ data, cur: cur && cur.id })); restore(redo.pop()); }
    on(document, 'keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || ctx.isTyping && ctx.isTyping()) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') { e.preventDefault(); doRedo(); }
      else if (e.key === 's') { e.preventDefault(); save(); }
    });

    // ── saving, and a picture
    function save() {
      // the groups in the order they first appear in the list (the listed order first)
      data.groups = [...new Set([...(data.groups || []).filter(x => data.constellations.some(c => c.group === x)), ...data.constellations.map(c => c.group).filter(Boolean)])];
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      fetch('/api/site/constellations', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; })
        .then(j => {
          skyData = j; savedRev = j.rev || 0; dirty = false;
          const id = cur && cur.id; data = clone(j); cur = data.constellations.find(c => c.id === id) || data.constellations[0] || null;
          try { sessionStorage.removeItem(DRAFT); } catch (e) { /* */ }
          saveBtn.classList.remove('primary'); saveBtn.textContent = 'Saved'; if (ctx.toast) ctx.toast('The sky is saved');
          drawAll();
        })
        .catch(e => { saveBtn.textContent = 'Save'; if (ctx.toast) ctx.toast('Not saved: ' + e.message, true); else alert(e.message); })
        .finally(() => { saveBtn.disabled = false; });
    }
    function exportPNG() {
      if (!cur) return;
      const c = conPicture(cur, 1200, NAVY);
      c.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: (cur.name || 'constellation').replace(/[^\w\- ]+/g, '') + '.png' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, 'image/png');
    }
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    on(window, 'beforeunload', warn);
    on(window, 'resize', () => draw());
    stop.push(() => { if (dirty && ctx.toast) ctx.toast('The constellations aren’t saved yet: they’re kept in this tab for when you come back'); });
    fillTrace(); loadTrace(); drawAll();
    if (cur) history.replaceState(null, '', '#/observatory/build/' + encodeURIComponent(cur.id));
  }

  // ───────────────────────── the bookshelf: the world's own books ─────────────────────────
  // From the catalogue page ("Catalogued Tomes of …", "The Library", or any page filed under [[Category:Bookshelf]]):
  // each ## heading is a shelf; each book is a list item — "**Title** (*Author, **Date***)", what it's about
  // under it, and a passage from it under that — or, on a shelf of plain lines, "Title", "Who - Title" or
  // "Title *(Author)*". A title linked to a page in the wiki (or to a document) can be read.
  const catalogues = () => ctx.pages().filter(p => /\[\[\s*category\s*:\s*bookshelf\s*\]\]/i.test(p.md) || /catalogu(e|ed)\b.*\b(tomes|books)|^the library$|^bookshelf$/i.test(p.title));
  // The catalogue as a table, one row per book: Shelf | Title | Author | Written | About | Passage (the columns found by
  // their headings, in any order; a title linked to a wiki page or a document can be read; <br> between passages).
  // A catalogue without such a table is read the older way, as lists under shelf headings (below).
  function readCatalogue(page) {
    const md = page.md.replace(/\{\{[^}]*\}\}/g, '');
    // the cells of a table row (a | inside a [[wiki link|its text]] or escaped as \| isn't a new cell)
    const cellsOf = l => {
      const t = l.trim().replace(/^\|/, '').replace(/\|$/, ''), out = []; let cur = '', depth = 0;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (c === '[' && t[i + 1] === '[') { depth++; cur += '[['; i++; continue; }
        if (c === ']' && t[i + 1] === ']' && depth) { depth--; cur += ']]'; i++; continue; }
        if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
        if (c === '|' && !depth) { out.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    const lines = md.split('\n'), shelves = new Map();
    const COLS = { shelf: /shelf|section|category|genre|kind/i, title: /title|book|name/i, author: /author|writer|\bby\b|whose/i, date: /written|date|year|published/i,
      about: /about|summary|description|blurb/i, passage: /passage|excerpt|quote|extract/i };
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) continue;
      const head = cellsOf(lines[i]).map(c => lore.clean(c)), col = {};
      for (const [k, re] of Object.entries(COLS)) { const j = head.findIndex((c, n) => re.test(c) && !Object.values(col).includes(n)); if (j >= 0) col[k] = j; }
      if (col.title == null) continue;
      found = true;
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        const c = cellsOf(lines[i]), get = k => col[k] == null ? '' : (c[col[k]] || '');
        const tcell = get('title').replace(/<br\s*\/?>/gi, ' ');
        const wl = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(tcell), ul = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(tcell);
        const title = lore.clean(wl ? (wl[2] || wl[1].split('/').pop()) : ul ? ul[1] : tcell);
        if (!title) continue;
        const name = lore.clean(get('shelf')) || 'Books';
        if (!shelves.has(name)) shelves.set(name, { name, books: [] });
        const split = v => v.split(/<br\s*\/?>/i).map(x => x.trim()).filter(x => lore.clean(x));
        shelves.get(name).books.push({ title, page: wl ? ctx.findPage(wl[1].trim()) || null : ctx.findPage(title) || null, url: ul ? ul[2] : null,
          author: lore.clean(get('author')), date: lore.clean(get('date')).replace(/\s+/g, ''), about: split(get('about')), passages: split(get('passage')) });
      }
    }
    return found ? [...shelves.values()].filter(s => s.books.length) : readListCatalogue(page);
  }
  function readListCatalogue(page) {
    const shelves = [];
    let shelf = null, book = null;
    const md = page.md.replace(/\{\{[^}]*\}\}/g, '');
    const linkOf = s => {
      let m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(s);
      if (m) { const p = ctx.findPage(m[1].trim()); return { title: lore.clean(m[2] || m[1].split('/').pop()), page: p || null, rest: s.replace(m[0], '') }; }
      m = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(s);
      if (m) return { title: lore.clean(m[1]), url: m[2], rest: s.replace(m[0], '') };
      m = /\*\*(.+?)\*\*/.exec(s);
      if (m) return { title: lore.clean(m[1]), rest: s.replace(m[0], '') };
      return null;
    };
    const byline = rest => {   // "(*Author, **Date***)"
      const m = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(rest); if (!m) return {};
      const parts = lore.clean(m[1]).split(',').map(x => x.trim()).filter(Boolean);
      const last = parts[parts.length - 1] || '';
      return /\d|\?\?\?/.test(last) && /(BR|SR|AV)/i.test(last) ? { author: parts.slice(0, -1).join(', '), date: last.replace(/\s+/g, '') } : { author: parts.join(', ') };
    };
    for (const raw of md.split('\n')) {
      const hm = /^#{1,6}\s+(.+)$/.exec(raw);
      if (hm) { shelf = { name: lore.clean(hm[1]), books: [] }; shelves.push(shelf); book = null; continue; }
      if (!raw.trim() || !shelf) continue;
      const lm = /^(\s*)[*+-]\s+(.*)$/.exec(raw);
      if (lm) {
        const depth = Math.floor(lm[1].replace(/\t/g, '    ').length / 2), text = lm[2].trim();
        if (depth === 0) {
          const L = linkOf(text) || { title: lore.clean(text.replace(/\(.*\)\s*$/, '')), rest: text };
          if (!L.title) { book = null; continue; }
          book = Object.assign({ title: L.title, page: L.page || null, url: L.url || null, about: [], passages: [] }, byline(L.rest));
          shelf.books.push(book);
        } else if (book && lore.clean(text)) (depth === 1 ? book.about : book.passages).push(text);
        continue;
      }
      if (/^\s*\|/.test(raw)) continue;
      // a plain line: "Title", "Who - Title" (holy books: whose it is, then its name), "Title *(Author)*"
      const t = raw.replace(/\\-/g, '-').trim(), L = linkOf(t);
      const dash = !L && /^(.+?)\s*\t+\s*-\s*\t*\s*(.+)$/.exec(raw.replace(/\\-/g, '-'));
      if (dash) shelf.books.push({ title: lore.clean(dash[2]), author: lore.clean(dash[1]), about: [], passages: [] });
      else if (L) shelf.books.push(Object.assign({ title: L.title, page: L.page || null, url: L.url || null, about: [], passages: [] }, byline(L.rest)));
      else { const bm = /^(.*?)\s*\*?\(([^)]*)\)\*?\s*$/.exec(t); shelf.books.push(bm ? { title: lore.clean(bm[1]), author: lore.clean(bm[2]), about: [], passages: [] } : { title: lore.clean(t), about: [], passages: [] }); }
    }
    return shelves.filter(s => s.books.length);
  }
  const hash = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
  const bookSlug = b => ctx.slug(b.title);
  // each shelf (genre) its own leathers and its own emblem, in gold on the spines and the title page
  const GENRES = [
    { re: /^(?!.*non).*fiction|novel|tale|stor/i, icon: 'quill', leathers: ['#7a2a22', '#5e2a1c', '#8a4a24', '#6b3a2a', '#4f2a20'] },
    { re: /non.?fiction|histor|chronicle|account|geograph|natural|science/i, icon: 'scroll', leathers: ['#2f4a3a', '#2b3e52', '#4a4a2c', '#3a5248', '#5a4630'] },
    { re: /magic|arcane|spell|sorcer|grimoire|ritual/i, icon: 'star', leathers: ['#2a2f5a', '#3a2552', '#1f3b52', '#46306a', '#273a4a'] },
    { re: /holy|relig|faith|sacred|gods?\b|scripture|divine/i, icon: 'sun', leathers: ['#c8b07a', '#a8874a', '#e0cfa0', '#8e6a32', '#b99a5a'] },
    { re: /smut|romance|love|erotic|bodice/i, icon: 'heart', leathers: ['#8a1f3a', '#a03050', '#6a1a32', '#b04a5a', '#7a2a4a'] }
  ];
  const DEFAULT_GENRE = { icon: 'diamond', leathers: ['#5a3a24', '#3e4a3a', '#4a3a5a', '#6a4a2a', '#3a3e52'] };
  const genreOf = shelf => GENRES.find(g => g.re.test(shelf || '')) || DEFAULT_GENRE;
  const EMBLEM = {
    quill: '<path d="M19.5 3.5C13 4.5 8.5 9 6.5 16.5l1.6.4C9.6 12 13 8.2 18 6.4c-3.6 3-6 6.4-7.4 10.6 4.8-1.7 8-6 8.9-13.5z"/><path d="M5 20.5l2.2-4"/>',
    scroll: '<path d="M7 4.5h10.5a2 2 0 0 1 2 2v.5H17M7 4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9.5a2 2 0 0 0 2-2V7"/><path d="M9 9h6M9 12h6M9 15h4"/>',
    star: '<circle cx="12" cy="12" r="8.5"/><path d="M12 4.2l2.3 6.8h-4.6zM12 19.8l-2.3-6.8h4.6zM4.2 12l6.8-2.3v4.6zM19.8 12L13 14.3V9.7z"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    diamond: '<path d="M12 3.5l6 8.5-6 8.5-6-8.5z"/>'
  };
  const emblem = (icon, cls) => h('span', { class: cls || 'emb', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${EMBLEM[icon] || EMBLEM.diamond}</svg>` });
  const leatherOf = b => { const L = genreOf(b.shelf).leathers; return L[hash(b.title) % L.length]; };
  // the wiki page a book is (linked in the catalogue, or the page imported from its Google document, or one by its title)
  function pageOfBook(b) {
    if (b.page) return b.page;
    const gid = b.url && (/\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(b.url) || [])[1];
    const p = (gid && ctx.pages().find(x => x.source && x.source.google === gid)) || ctx.findPage(b.title) || null;
    return p;
  }

  // ───────── the bookcase: one long shelf of every book to scroll along, between two more for the look of it ─────────
  function bookshelf(art, arg) {
    document.body.classList.add('lib-book', 'lib-case');
    stop.push(() => document.body.classList.remove('lib-case'));
    ctx.renderTop(null, { label: 'The Library' });
    const cats = catalogues(), shelves = cats.flatMap(readCatalogue);
    if (!shelves.length) {
      fill(art, h('div', { class: 'shelfwrap' }, h('h1', { class: 'ptitle' }, 'The Library'),
        h('p', null, 'The books of the world go here. Import the catalogue of books into the wiki (Import a document): a table with the columns Shelf, Title, Author, Written, About and Passage, one row per book. Link a title to a wiki page to make it readable.'),
        ctx.admin ? h('p', null, h('a', { class: 'btn primary', href: '#/wiki/Special:Import' }, 'Import a document')) : null));
      return;
    }
    const all = shelves.flatMap(s => s.books.map(b => Object.assign(b, { shelf: s.name })));
    for (const b of all) b.page = pageOfBook(b);
    if (arg) { let a = arg; try { a = decodeURIComponent(arg); } catch (e) { /* as is */ } const b = all.find(x => bookSlug(x) === a); if (b) return tome(art, b, all); }
    let q = '', order = 'shelf';
    const yearOf = b => { const d = b.date && lore.parseDate(b.date); return d && d.year != null ? d.year : 1e9; };
    const sorted = () => order === 'shelf' ? all.slice() : all.slice().sort((a, b) => order === 'date' ? yearOf(a) - yearOf(b) || natural(a.title, b.title) : natural(a.author || '~', b.author || '~') || natural(a.title, b.title));
    // a spine: leather by its shelf, raised bands and gilt lines, the title up the middle, the shelf's emblem at the foot
    const spine = (b, deco) => {
      const g = genreOf(b.shelf), size = b.about.join(' ').length + b.passages.join(' ').length;
      const w = deco ? 30 + hash(b.title + 'w') % 34 : Math.round(Math.max(38, Math.min(76, 36 + size / 26 + hash(b.title) % 9)));
      const ht = 74 + hash(b.title + 'h') % 22;   // % of the row
      const el = h(deco ? 'span' : 'a', { class: 'cbk' + (deco ? ' deco' : '') + (b.page ? ' readable' : '') + (hash(b.title + 't') % 9 === 0 ? ' tilt' : ''),
        style: `--w:${w}px;--h:${ht}%;--lea:${deco ? genreOf(all[hash(b.title + 'd') % all.length].shelf).leathers[hash(b.title + 'x') % 5] : leatherOf(b)};--band:${2 + hash(b.title + 'b') % 3}` },
        h('span', { class: 'bands' }),
        deco ? null : h('span', { class: 'ct' }, b.title),
        deco ? null : emblem(g.icon, 'emb'),
        !deco && b.page ? h('span', { class: 'ribbon', title: 'You can read this one' }) : null);
      if (!deco) { el.href = '#/library/' + encodeURIComponent(bookSlug(b)); el.dataset.k = wkey([b.title, b.author, b.shelf, b.about.join(' ')].join(' ')); el._b = b; }
      return el;
    };
    const row = h('div', { class: 'casescroll', tabindex: 0 }), track = h('div', { class: 'casetrack' });
    row.append(track);
    const decoTop = h('div', { class: 'casedeco top' }), decoBot = h('div', { class: 'casedeco bot' });
    const tip = h('div', { class: 'casetip', hidden: true });
    const count = h('span', { class: 'casecount' });
    function draw() {
      const list = sorted(), out = [];
      let last = null;
      for (const b of list) {
        if (order === 'shelf' && b.shelf !== last) {   // a brass plate between the shelves
          out.push(h('span', { class: 'plate', 'data-shelf': b.shelf }, emblem(genreOf(b.shelf).icon, 'pemb'), h('span', null, b.shelf)));
          last = b.shelf;
        }
        out.push(spine(b));
      }
      track.replaceChildren(...out);
      // the rows above and below: more books, dimmer, for the look of a bookcase (they drift as you scroll)
      const deco = n => { const s = []; for (let i = 0; i < n; i++) s.push(spine(all[(i * 7 + n) % all.length] && { title: all[(i * 7 + n) % all.length].title + i, about: [], passages: [], shelf: '' }, true)); return s; };
      decoTop.replaceChildren(h('div', { class: 'decotrack' }, ...deco(Math.max(60, list.length + 20))));
      decoBot.replaceChildren(h('div', { class: 'decotrack' }, ...deco(Math.max(64, list.length + 24))));
      filter();
    }
    function filter() {
      const k = wkey(q); let n = 0, first = null;
      for (const el of track.querySelectorAll('.cbk')) { const on = !k || el.dataset.k.includes(k); el.classList.toggle('dim', !on); if (on) { n++; if (!first) first = el; } }
      count.textContent = k ? `${n} of ${all.length} books` : `${all.length} books`;
      if (k && first) first.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    // scrolling along: the wheel, dragging, the arrows, the keys
    const parallax = () => { const x = row.scrollLeft; for (const [d, f] of [[decoTop, 0.55], [decoBot, 0.7]]) { const t = d.firstChild; if (t) t.style.transform = `translateX(${-x * f}px)`; } };
    on(row, 'scroll', parallax, { passive: true });
    on(row, 'wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); row.scrollLeft += e.deltaY * 1.2; } }, { passive: false });
    let drag = null;
    on(row, 'pointerdown', e => { if (e.button) return; drag = { x: e.clientX, s: row.scrollLeft, moved: false }; });
    on(window, 'pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) { drag.moved = true; row.classList.add('dragging'); } if (drag.moved) row.scrollLeft = drag.s - dx; });
    on(window, 'pointerup', () => { if (drag && drag.moved) setTimeout(() => row.classList.remove('dragging'), 0); drag = null; });
    on(row, 'click', e => { if (row.classList.contains('dragging')) { e.preventDefault(); e.stopPropagation(); } }, true);
    const step = d => row.scrollBy({ left: d * row.clientWidth * 0.7, behavior: 'smooth' });
    on(row, 'keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
    // a card for the book under the pointer
    on(track, 'pointerover', e => {
      const el = e.target.closest('.cbk'); if (!el || !el._b) { tip.hidden = true; return; }
      const b = el._b, r = el.getBoundingClientRect(), R = row.getBoundingClientRect();
      tip.replaceChildren(h('div', { class: 'ctk' }, emblem(genreOf(b.shelf).icon, 'temb'), b.shelf), h('b', null, b.title),
        b.author || b.date ? h('div', { class: 'cta' }, [b.author ? 'by ' + b.author : '', b.date && !/\?\?\?/.test(b.date) ? yearText(yearOf(b)) : ''].filter(Boolean).join(' · ')) : null,
        b.about.length ? h('p', null, lore.clean(b.about[0]).slice(0, 180) + (lore.clean(b.about[0]).length > 180 ? '…' : '')) : null,
        h('div', { class: 'ctr' }, b.page ? 'Can be read · click to open' : 'Click to open'));
      tip.hidden = false;
      tip.style.left = Math.max(R.left + 8, Math.min(R.right - 300, r.left + r.width / 2 - 150)) + 'px';
      tip.style.top = (R.bottom + 10) + 'px';
    });
    on(track, 'pointerleave', () => { tip.hidden = true; });
    on(row, 'scroll', () => { tip.hidden = true; }, { passive: true });
    const search = h('input', { type: 'search', class: 'caseq', placeholder: `Find a book…`, oninput: e => { q = e.target.value.trim(); filter(); } });
    const sorter = h('select', { class: 'casesort', onchange: e => { order = e.target.value; draw(); row.scrollLeft = 0; } }, h('option', { value: 'shelf' }, 'By shelf'), h('option', { value: 'date' }, 'By date written'), h('option', { value: 'author' }, 'By author'));
    const jump = shelf => { const p = track.querySelector(`.plate[data-shelf="${CSS.escape(shelf)}"]`); if (p) row.scrollTo({ left: p.offsetLeft - 20, behavior: 'smooth' }); };
    const chips = h('div', { class: 'casechips' }, ...shelves.map(s => h('button', { class: 'chip', title: `Go to ${s.name}`, onclick: () => { if (order !== 'shelf') { order = 'shelf'; sorter.value = 'shelf'; draw(); } jump(s.name); } }, emblem(genreOf(s.name).icon, 'cemb'), s.name)));
    const bar = h('div', { class: 'casebar' },
      h('div', { class: 'casetitle' }, h('b', null, 'The Library'), count),
      chips, h('div', { class: 'casetools' }, search, sorter));
    const arrows = [h('button', { class: 'casearrow l', title: 'Back along the shelf', onclick: () => step(-1) }, '‹'), h('button', { class: 'casearrow r', title: 'On along the shelf', onclick: () => step(1) }, '›')];
    fill(art, h('div', { class: 'bookcase' }, bar,
      h('div', { class: 'casebody' }, decoTop, h('div', { class: 'caseboard' }), h('div', { class: 'casemid' }, row, ...arrows), h('div', { class: 'caseboard' }), decoBot),
      h('div', { class: 'casefoot' }, `From `, ...cats.map((c, i) => [i ? ', ' : '', h('a', { href: ctx.wikiHref(c.path) }, c.title)]), ' · scroll, drag or use the arrows · a ribbon marks the books you can read'),
      tip));
    draw();
    // come back to where you were along the shelf
    try { const x = +sessionStorage.getItem('valanar-shelf-x'); if (x) requestAnimationFrame(() => { row.scrollLeft = x; parallax(); }); } catch (e) { /* */ }
    stop.push(() => { try { sessionStorage.setItem('valanar-shelf-x', String(row.scrollLeft)); } catch (e) { /* */ } });
    row.focus({ preventScroll: true });
    document.title = `The Library · ${ctx.site}`;
  }
  // one book, open across the screen: its title page on the left, what it's about and a passage from it on the right
  function tome(art, b, all) {
    document.body.classList.add('lib-case');
    stop.push(() => document.body.classList.remove('lib-case'));
    const mates = all.filter(x => x.shelf === b.shelf), i = mates.indexOf(b), prev = mates[i - 1], next = mates[i + 1];
    const d = b.date && lore.parseDate(b.date), era = d && d.year != null ? (lore.index().eras.filter(e => d.year >= e.start).pop() || null) : null;
    const g = genreOf(b.shelf);
    // a line from the catalogue: its emphasis kept, its names linked
    const para = s => {
      const el = h('p', null), txt = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, (a, t) => t.split('/').pop()).replace(/\\([!-])/g, '$1');
      if (window.marked) el.innerHTML = window.marked.parseInline(ctx.escHTML(txt).replace(/&quot;/g, '"').replace(/&#39;/g, "'")); else el.textContent = lore.clean(txt);
      try { lore.autoLink(h('div', null, el), b.page); } catch (e) { /* plain */ }
      return el;
    };
    const p = b.page;
    fill(art, h('div', { class: 'tomewrap big' },
      h('div', { class: 'tomenav' }, h('a', { class: 'bkback', href: '#/library' }, '‹ The Library'),
        h('span', { class: 'tnavmid' }, emblem(g.icon, 'nemb'), b.shelf),
        h('span', null, prev ? h('a', { href: '#/library/' + encodeURIComponent(bookSlug(prev)), title: prev.title }, '‹ Previous') : null, prev && next ? ' · ' : '', next ? h('a', { href: '#/library/' + encodeURIComponent(bookSlug(next)), title: next.title }, 'Next ›') : null)),
      h('div', { class: 'tome', style: `--c1:${leatherOf(b)}` },
        h('div', { class: 'tpage left' },
          h('div', { class: 'tshelf' }, b.shelf),
          h('h1', null, b.title),
          b.author ? h('div', { class: 'tby' }, 'by ', h('span', null, b.author)) : null,
          emblem(g.icon, 'bkorn'),
          b.date ? h('div', { class: 'tdate' }, /\?\?\?/.test(b.date) ? 'Date unknown' : 'Written ' + yearText(d && d.year), era ? h('a', { href: '#/wiki/Special:Timeline?y=' + d.year }, era.name) : null) : null,
          h('div', { class: 'tgo' },
            p ? h('a', { class: 'btn primary', href: '#/wiki/Special:Book/' + p.id }, 'Read it') : null,
            p ? h('a', { class: 'btn', href: ctx.wikiHref(p.path) }, 'Its page in the wiki') : null,
            !p && b.url ? h('a', { class: 'btn', href: b.url, target: '_blank', rel: 'noopener', title: 'Not in the wiki yet: import it to read it here' }, 'The original document ↗') : null,
            !p && !b.url ? h('span', { class: 'muted' }, 'Not transcribed yet') : null)),
        h('div', { class: 'tpage right' },
          b.about.length ? h('div', { class: 'tabout' }, ...b.about.map(para)) : h('p', { class: 'muted' }, 'Nothing is written about this book yet.'),
          ...b.passages.map(s => { const el = para(s); el.className = 'tpass'; return el; })))));
    document.title = `${b.title} · The Library · ${ctx.site}`;
  }

  // the emblem of the shelf a page's book stands on (if it's in the catalogue)
  function bookIcon(page) {
    for (const c of catalogues()) for (const s of readCatalogue(c)) for (const b of s.books) if (pageOfBook(b) === page) return genreOf(s.name).icon;
    return 'diamond';
  }
  const progressOf = id => { try { return JSON.parse(store.get('valanar-book-' + id) || 'null'); } catch (e) { return null; } };
  // a book: its cover and contents, then one chapter at a time
  function book(art, id, params) {
    document.body.classList.add('lib-book');
    const page = ctx.pages().find(p => p.id === id);
    ctx.renderTop(null, { label: 'The Library' });
    if (!page) { fill(art, h('h1', { class: 'ptitle' }, 'No such book'), h('p', null, h('a', { href: '#/library' }, '‹ The Library'))); return; }
    const b = ctx.body(page.md, page);
    if (b.el.firstElementChild && b.el.firstElementChild.tagName === 'H1') b.el.firstElementChild.remove();
    ctx.markEmpty(b.el);
    const sec = ctx.sectionsOf(b.el);
    // the chapters: the page's parts; what comes before the first is the opening
    const chapters = [];
    const kids = [...b.el.childNodes];
    const firstHead = sec ? sec.heads[0] : null;
    const front = [];
    for (const n of kids) { if (n === firstHead) break; front.push(n); }
    const frontText = front.map(n => n.textContent || '').join(' ').trim();
    if (frontText.length > 1400) chapters.push({ title: 'Opening', nodes: front });
    if (sec) for (const hd of sec.heads) chapters.push({ title: ctx.headText(hd), nodes: ctx.sectionNodes(sec, hd) });
    else chapters.push({ title: page.title, nodes: kids });
    const words = lore.clean(page.md).split(/\s+/).length, mins = Math.max(1, Math.round(words / 230));
    const c = Math.max(0, Math.min(chapters.length, parseInt(params.get('c') || '0', 10) || 0));
    const pr = progressOf(page.id);
    const shelfLink = h('a', { class: 'bkback', href: '#/library' }, '‹ The Library');
    if (!c) {
      const frontEl = frontText && frontText.length <= 1400 ? h('div', { class: 'bkfront md wikitext' }, ...front) : null;
      fill(art, h('div', { class: 'bk cover' }, shelfLink,
        h('div', { class: 'bkcover' },
          h('div', { class: 'bkfolder' }, page.folders.join(' · ') || ctx.site),
          h('h1', null, page.title), b.short ? h('div', { class: 'bkshort' }, b.short) : null,
          emblem(bookIcon(page), 'bkorn'),
          h('div', { class: 'bkmeta' }, `${words.toLocaleString('en-GB')} words · about ${mins >= 60 ? Math.round(mins / 6) / 10 + ' hours' : mins + ' minutes'} to read`),
          h('div', { class: 'bkgo' }, h('a', { class: 'btn primary', href: `#/wiki/Special:Book/${page.id}?c=${pr && pr.c ? pr.c : 1}` }, pr && pr.c ? `Carry on (chapter ${pr.c})` : 'Begin reading'),
            h('a', { class: 'btn', href: ctx.wikiHref(page.path) }, 'Read as a page'))),
        frontEl,
        chapters.length > 1 ? h('ol', { class: 'bktoc' }, ...chapters.map((ch, i) => h('li', { class: pr && pr.c === i + 1 ? 'here' : null }, h('a', { href: `#/wiki/Special:Book/${page.id}?c=${i + 1}` }, h('span', { class: 'n' }, String(i + 1)), h('span', null, ch.title))))) : null));
      document.title = `${page.title} · The Library · ${ctx.site}`;
      return;
    }
    const ch = chapters[c - 1];
    try { store.set('valanar-book-' + page.id, JSON.stringify({ c, t: Date.now() })); } catch (e) { /* not kept */ }
    const text = h('div', { class: 'md wikitext bktext' }, ...ch.nodes);
    const fp = text.firstElementChild;
    if (fp && fp.tagName === 'P' && fp.textContent.trim().length > 160) fp.classList.add('dropcap');   // a large first letter, for a real opening paragraph
    const prev = c > 1 ? `#/wiki/Special:Book/${page.id}?c=${c - 1}` : `#/wiki/Special:Book/${page.id}`, next = c < chapters.length ? `#/wiki/Special:Book/${page.id}?c=${c + 1}` : null;
    const sel = h('select', { class: 'bksel', onchange: e => { location.hash = `#/wiki/Special:Book/${page.id}?c=${e.target.value}`; } },
      ...chapters.map((x, i) => h('option', { value: String(i + 1), selected: i + 1 === c || null }, `${i + 1}. ${x.title}`)));
    fill(art, h('div', { class: 'bk' },
      h('div', { class: 'bkbar' }, shelfLink, h('a', { class: 'bkt', href: `#/wiki/Special:Book/${page.id}` }, page.title), sel),
      h('div', { class: 'bkprog' }, h('span', { style: `width:${(c / chapters.length) * 100}%` })),
      h('div', { class: 'bkchno' }, chapters.length > 1 ? `Chapter ${c} of ${chapters.length}` : ''),
      h('h1', { class: 'bkch' }, ch.title),
      text,
      h('div', { class: 'bknav' }, h('a', { href: prev }, c > 1 ? '‹ ' + chapters[c - 2].title : '‹ Contents'), emblem(bookIcon(page), 'bkorn sm'),
        next ? h('a', { href: next }, chapters[c].title + ' ›') : h('a', { href: '#/library' }, 'Back to the shelf ›'))));
    on(document, 'keydown', e => {
      if (ctx.isTyping && ctx.isTyping()) return;
      if (e.key === 'ArrowLeft') location.hash = prev;
      if (e.key === 'ArrowRight' && next) location.hash = next;
    });
    document.title = `${ch.title} · ${page.title} · ${ctx.site}`;
  }

  return { show, leave, web };
};
