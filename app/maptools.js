/* More for the world map: its look (Map settings), sea routes and other journeys, and names for the water.
 *
 *  - Map settings: the sea's colours, swell, speed and effects; rivers' colour and flow; the font and size of names;
 *    icon size and their glow at night; how dark the night gets; where the map opens, how far it zooms out and pans;
 *    miles, kilometres or leagues. Each person's own choices live in their browser (localStorage "valanar-mylook");
 *    the admin can make theirs everyone's default (data.settings.look and .units, saved with the map).
 *  - Routes (data.routes): lines drawn point by point, or plotted across the sea between two places (it steers round
 *    land); a name, a kind (sea lane, river, road, trade route), a style; click one for its length and journey times.
 *  - Water names (data.labels): ocean, sea, bay, strait, lake and river names set in the map's own lettering, along a
 *    curve you bend by dragging its points; they size themselves with the zoom and show only where they're legible.
 *
 * ValanarMapTools(ctx) → { sync, applyLook, panel(mode), busy(), look() }. ctx comes from app.js. */
'use strict';
window.ValanarMapTools = function (ctx) {
  const { map, L, h, toast, NATIVE, INFO, toLatLng, toPixel, Land, smooth, pathLength, uid } = ctx;
  const D = () => ctx.data;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);

  // ───────────────────────── the look ─────────────────────────
  const LOOK = {
    sea: { shallow: '#67a198', mid: '#3d7272', deep: '#234b57', waves: 1, speed: 1, ripples: true, foam: true, glints: true },
    fresh: { color: '#54919a', flow: 1 },
    labels: { font: '', size: 1, color: '', halo: true },
    icons: { size: 1, nightGlow: true },
    sky: { night: 1 },
    life: { lights: true, ships: true, birds: true, seasons: true, frame: true, cold: 'north', aurora: true, smoke: true, titles: true, sound: false },
    view: { start: null, zoomOut: 0, pan: 0.15 }
  };
  const FONTS = [['', 'The map’s serif (default)'], ['Georgia, serif', 'Georgia'], ['"Palatino Linotype", Palatino, "Book Antiqua", serif', 'Palatino'],
    ['Garamond, "EB Garamond", serif', 'Garamond'], ['"Cinzel", serif', 'Cinzel (engraved capitals)', 'Cinzel:wght@400;600'],
    ['"IM Fell English", serif', 'IM Fell (old print)', 'IM+Fell+English:ital@0;1'], ['"Uncial Antiqua", serif', 'Uncial (insular)', 'Uncial+Antiqua'],
    ['"MedievalSharp", serif', 'MedievalSharp', 'MedievalSharp']];
  // this viewer's own settings, over the site's defaults
  const MINE = 'valanar-mylook';
  let mine = (() => { try { const v = JSON.parse(localStorage.getItem(MINE) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } })();
  mine.look = mine.look && typeof mine.look === 'object' ? mine.look : {};
  const saveMine = () => { try { if (Object.keys(mine.look).length || mine.units) localStorage.setItem(MINE, JSON.stringify(mine)); else localStorage.removeItem(MINE); } catch (e) { /* private window */ } };
  const hasMine = () => Object.keys(mine.look).some(k => Object.keys(mine.look[k] || {}).length) || !!mine.units;
  function siteLook() {
    const s = (D().settings && D().settings.look) || {};
    const out = {};
    for (const k of Object.keys(LOOK)) out[k] = Object.assign({}, LOOK[k], s[k] || {});
    return out;
  }
  function look() {
    const out = siteLook();
    for (const k of Object.keys(LOOK)) Object.assign(out[k], mine.look[k] || {});
    return out;
  }
  const loadedFonts = new Set();
  function loadFont(stack) {
    const f = FONTS.find(x => x[0] === stack);
    if (!f || !f[2] || loadedFonts.has(f[2])) return;
    loadedFonts.add(f[2]);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${f[2]}&display=swap`;
    l.onload = () => drawNames(); document.head.append(l);
  }
  function applyLook() {
    const lk = look(), root = document.documentElement.style;
    const oc = ctx.ocean(); if (oc && oc.setLook) oc.setLook(lk);
    if (lk.labels.font) { loadFont(lk.labels.font); root.setProperty('--label-font', lk.labels.font); } else root.removeProperty('--label-font');
    root.setProperty('--label-scale', String(clamp(num(lk.labels.size, 1), 0.5, 2.5)));
    if (lk.labels.color) root.setProperty('--label-ink', lk.labels.color); else root.removeProperty('--label-ink');
    root.setProperty('--icon-scale', String(clamp(num(lk.icons.size, 1), 0.3, 3)));
    document.body.classList.toggle('no-nightglow', lk.icons.nightGlow === false);
    document.body.classList.toggle('no-labelhalo', lk.labels.halo === false);
    if (ctx.applyView) ctx.applyView(lk.view);
    if (ctx.onLook) ctx.onLook(lk);
    drawNames();
  }

  // ───────────────────────── units ─────────────────────────
  const UNITS = { miles: [1, 'miles', 'mi'], km: [1.609344, 'kilometres', 'km'], leagues: [1 / 3, 'leagues', 'lg'] };
  const unitKey = () => mine.units || D().settings.units || 'miles';
  const unit = () => UNITS[unitKey()] || UNITS.miles;
  const fmtN = n => n >= 100 ? Math.round(n).toLocaleString('en-GB') : n >= 10 ? n.toFixed(0) : n.toFixed(1);
  const distText = (miles, short) => `${fmtN(miles * unit()[0])} ${short ? unit()[2] : unit()[1]}`;

  // ───────────────────────── routes ─────────────────────────
  const KINDS = {
    sea: { label: 'Sea lane', color: '#eef6f4', dash: 'dashed', width: 2.2, pace: /ship|boat|sail|galley|sea/i },
    river: { label: 'River passage', color: '#d6eef0', dash: 'dashed', width: 2, pace: /boat|barge|river|ship/i },
    road: { label: 'Road', color: '#7a5a3a', dash: 'solid', width: 2.4, pace: /foot|horse|cart|wagon|road/i },
    trade: { label: 'Trade route', color: '#e2bd62', dash: 'dashdot', width: 2.4, pace: null },
    other: { label: 'Other', color: '#ffffff', dash: 'dotted', width: 2, pace: null }
  };
  const DASH = { solid: null, dashed: '12 9', dotted: '1.5 7', dashdot: '14 6 2 6' };
  const routes = () => D().routes || (D().routes = []);
  const kindOf = r => KINDS[r.kind] || KINDS.other;
  const routePath = r => (r.smooth !== false && r.pts.length > 2 ? smooth(r.pts, 10) : r.pts);
  const routeMiles = r => pathLength(routePath(r)) * (+D().settings.milesPerPx || 0);
  map.createPane('routes').style.zIndex = 390;
  const routeLayer = L.layerGroup().addTo(map);
  const handleLayer = L.layerGroup().addTo(map);
  let selRoute = null, selLabel = null, mode = null, draft = null;
  const selSet = new Set();   // names picked together with Ctrl+click (selLabel is the one whose points show)   // mode: 'route' (drawing), 'plot' (two clicks), 'label' (placing)

  function drawRoutes() {
    routeLayer.clearLayers();
    const z = map.getZoom();
    for (const r of routes()) {
      if (!r.pts || r.pts.length < 2) continue;
      if (!ctx.editMode() && r.minZoom != null && z < r.minZoom) continue;
      const k = kindOf(r), ll = routePath(r).map(p => toLatLng(p[0], p[1]));
      const w = num(r.width, k.width), col = r.color || k.color, dash = DASH[r.dash || k.dash];
      const sel = selRoute === r.id && ctx.editMode();
      const op = routeOpacity(r, sel);   // a route can be see-through, or invisible (then only its name and its clicks show)
      if (op > 0) {
        routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: '#10181a', opacity: (sel ? 0.6 : 0.32) * op, weight: w + 3, lineCap: 'round', lineJoin: 'round' }));
        routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: sel ? '#ffd27a' : col, opacity: 0.95 * op, weight: w, dashArray: dash, lineCap: 'round', lineJoin: 'round' }));
      }
      // a wide, invisible line to click
      const hit = L.polyline(ll, { pane: 'routes', color: '#000', opacity: 0, weight: Math.max(14, w + 10), interactive: true, bubblingMouseEvents: false });
      hit.on('click', e => { L.DomEvent.stop(e); if (mode) mapClick(e.latlng); else routeClick(r, e.latlng); });
      hit.bindTooltip(r.name || k.label, { sticky: true, direction: 'top', className: 'rtip' });
      routeLayer.addLayer(hit);
    }
    drawHandles();
    drawNames();
  }
  function routeClick(r, latlng) {
    if (mode) return;
    if (ctx.editMode()) { selRoute = r.id; selLabel = null; ctx.openPanel('routes', true); drawRoutes(); return; }
    const k = kindOf(r), miles = routeMiles(r), pace = (D().settings.travel || []).filter(t => +t.mph > 0 && (!k.pace || k.pace.test(t.label)));
    const page = r.wiki && ctx.findPage(r.wiki);
    const el = h('div', { class: 'routepop' },
      h('div', { class: 'rk' }, k.label), h('b', null, r.name || 'Unnamed route'),
      miles ? h('div', { class: 'rd' }, distText(miles)) : null,
      miles && (pace.length ? pace : D().settings.travel || []).length ? h('table', null, ...(pace.length ? pace : D().settings.travel).filter(t => +t.mph > 0).map(t => h('tr', null, h('td', null, t.label), h('td', null, ctx.fmtTravel(miles, t))))) : null,
      r.notes ? h('p', null, r.notes) : null,
      page ? h('a', { href: ctx.wikiHref(page.path) }, 'Read about it ›') : null);
    L.popup({ className: 'routepopup', maxWidth: 300 }).setLatLng(latlng).setContent(el).openOn(map);
  }

  // drag handles for the selected route's points, or the selected name's
  function drawHandles() {
    handleLayer.clearLayers();
    if (!ctx.editMode()) return;
    const r = selRoute && routes().find(x => x.id === selRoute), lb = selLabel && labels().find(x => x.id === selLabel);
    const obj = r || lb; if (!obj) return;
    obj.pts.forEach((p, i) => {
      const m = L.marker(toLatLng(p[0], p[1]), { pane: 'poltools', draggable: true, keyboard: false,
        icon: L.divIcon({ className: 'vhandle' + (lb ? ' lbl' : ''), iconSize: [14, 14], iconAnchor: [7, 7] }), title: 'Drag to move · Alt-click to remove' });
      m.on('drag', e => { const q = toPixel(e.target.getLatLng()); obj.pts[i] = [Math.round(q.x), Math.round(q.y)]; lb ? drawNames() : drawRouteLive(r); });
      m.on('dragend', () => { const pts = obj.pts.map(p => p.slice()); ctx.change(() => { const t = (r ? routes() : labels()).find(x => x.id === obj.id); if (t) t.pts = pts; }, { panel: false }); });
      m.on('click', e => {
        if (!e.originalEvent.altKey) return;
        if (obj.pts.length <= 2) return toast('A line needs at least two points.');
        ctx.change(() => { const t = (r ? routes() : labels()).find(x => x.id === obj.id); if (t) t.pts.splice(i, 1); }, { panel: false });
      });
      handleLayer.addLayer(m);
    });
    // "+" between points: click to add one there
    for (let i = 0; i < obj.pts.length - 1; i++) {
      const a = obj.pts[i], b = obj.pts[i + 1], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m = L.marker(toLatLng(mid[0], mid[1]), { pane: 'poltools', keyboard: false, icon: L.divIcon({ className: 'vhandle add', html: '+', iconSize: [14, 14], iconAnchor: [7, 7] }), title: 'Add a point here' });
      m.on('click', e => { L.DomEvent.stop(e); ctx.change(() => { const t = (r ? routes() : labels()).find(x => x.id === obj.id); if (t) t.pts.splice(i + 1, 0, mid.map(Math.round)); }, { panel: false }); });
      handleLayer.addLayer(m);
    }
  }
  // mid-drag: redraw the lines without rebuilding the handles being dragged
  let liveT = 0;
  // how solid a route's line is (r.opacity, 0 = invisible); the one being edited never fades below half, so it can be found
  function routeOpacity(r, sel) { const o = r.opacity == null ? 1 : clamp(+r.opacity, 0, 1); return sel ? Math.max(o, 0.5) : o; }
  function drawRouteLive() { if (!liveT) liveT = requestAnimationFrame(() => { liveT = 0; drawRouteLines(); drawNames(); }); }
  function drawRouteLines() {
    routeLayer.clearLayers();
    for (const r of routes()) {
      if (!r.pts || r.pts.length < 2) continue;
      const k = kindOf(r), ll = routePath(r).map(p => toLatLng(p[0], p[1])), w = num(r.width, k.width), sel = selRoute === r.id;
      const op = routeOpacity(r, sel);
      if (op <= 0) continue;
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: '#10181a', opacity: 0.5 * op, weight: w + 3 }));
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: sel ? '#ffd27a' : (r.color || k.color), opacity: op, weight: w, dashArray: DASH[r.dash || k.dash] }));
    }
  }

  // ───────────────────────── plotting a course across the sea ─────────────────────────
  // A* over the land mask at a coarser grid, keeping a little off the coast; then the course is pulled straight
  // wherever open water allows, so it reads like a sailing line rather than a staircase.
  let seaGrid = null;
  function grid() {
    if (seaGrid) return seaGrid;
    if (!Land.ready || !Land.v) return null;
    const f = Math.max(1, Math.ceil(Math.max(Land.w, Land.h) / 1100)), W = Math.ceil(Land.w / f), H = Math.ceil(Land.h / f);
    const water = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let wet = 0, n = 0;
      for (let yy = y * f; yy < Math.min(Land.h, y * f + f); yy++) for (let xx = x * f; xx < Math.min(Land.w, x * f + f); xx++) { n++; if (Land.v[yy * Land.w + xx] < 128) wet++; }
      water[y * W + x] = n && wet / n >= 0.5 ? 1 : 0;
    }
    // distance to land in cells (breadth first), to keep courses a little off the shore
    const dist = new Uint8Array(W * H).fill(255), q = [];
    for (let i = 0; i < W * H; i++) if (!water[i]) { dist[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % W, d = dist[i] + 1; if (d > 6) continue;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && dist[j] > d) { dist[j] = d; q.push(j); }
    }
    seaGrid = { W, H, f, water, dist, cell: f * Land.scale };
    return seaGrid;
  }
  function nearestWater(g, x, y) {
    const cx = clamp(Math.round(x / g.cell - 0.5), 0, g.W - 1), cy = clamp(Math.round(y / g.cell - 0.5), 0, g.H - 1);
    for (let r = 0; r < 60; r++) {
      let best = -1, bd = 1e9;
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H || (Math.abs(xx - cx) !== r && Math.abs(yy - cy) !== r)) continue;
        const i = yy * g.W + xx; if (!g.water[i]) continue;
        const d = (xx - cx) ** 2 + (yy - cy) ** 2; if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // quiet: for the ships (app/ambience.js), which look for lanes themselves; no messages, and give up sooner
  function plotSea(a, b, quiet) {
    const say = (m, bad) => { if (!quiet) toast(m, bad); };
    const g = grid(); if (!g) { say('The land mask isn’t loaded, so routes can’t be plotted round the land.', true); return null; }
    const s = nearestWater(g, a[0], a[1]), t = nearestWater(g, b[0], b[1]);
    if (s < 0 || t < 0) { say('No sea near one of those points.', true); return null; }
    const { W, H, water, dist } = g, N = W * H;
    const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const tx = t % W, ty = (t / W) | 0, hh = i => Math.hypot(i % W - tx, ((i / W) | 0) - ty);
    // binary heap of [f, i]
    const hf = [], hi = [];
    const push = (f, i) => { hf.push(f); hi.push(i); let k = hf.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [hf[p], hf[k]] = [hf[k], hf[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } };
    const pop = () => { const i = hi[0], lf = hf.pop(), li = hi.pop(); if (hf.length) { hf[0] = lf; hi[0] = li; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === k) break; [hf[m], hf[k]] = [hf[k], hf[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } } return i; };
    gs[s] = 0; push(hh(s), s);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, steps = 0;
    while (hf.length) {
      const i = pop(); if (closed[i]) continue; closed[i] = 1;
      if (i === t) { found = true; break; }
      if (++steps > (quiet ? 4e5 : 4e6)) break;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (!water[j] || closed[j]) continue;
        if (dx && dy && (!water[y * W + nx] || !water[ny * W + x])) continue;   // no cutting corners of land
        const coast = dist[j] < 4 ? (4 - dist[j]) * 0.45 : 0;
        const ng = gs[i] + c * (1 + coast);
        if (ng < gs[j]) { gs[j] = ng; came[j] = i; push(ng + hh(j), j); }
      }
    }
    if (!found) { say('Couldn’t find a way by sea between those points.', true); return null; }
    const cells = []; for (let i = t; i >= 0; i = came[i]) { cells.push(i); if (i === s) break; }
    cells.reverse();
    // pull the course straight: from each point, jump to the furthest one still in sight over open water
    const clear = (i, j) => {
      const x0 = i % W, y0 = (i / W) | 0, x1 = j % W, y1 = (j / W) | 0, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let k = 1; k < n; k++) { const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n), c = y * W + x; if (!water[c] || dist[c] < 2) return false; }
      return true;
    };
    const keep = [cells[0]];
    for (let i = 0; i < cells.length - 1;) {
      let j = cells.length - 1;
      while (j > i + 1 && !clear(cells[i], cells[j])) j--;
      keep.push(cells[j]); i = j;
    }
    const px = i => [Math.round((i % W + 0.5) * g.cell), Math.round((((i / W) | 0) + 0.5) * g.cell)];
    const pts = keep.map(px);
    pts[0] = a.map(Math.round); pts[pts.length - 1] = b.map(Math.round);
    return pts;
  }

  // ───────────────────────── water names ─────────────────────────
  const LKINDS = {
    country: { label: 'Country or realm', size: 420, spacing: 0.3, caps: true, italic: false, color: '#2a1d12', opacity: 0.85, zoom: [-9, NATIVE - 1.5] },
    ocean: { label: 'Ocean', size: 640, spacing: 0.38, caps: true, italic: false, color: '#1d3c42', opacity: 0.6, zoom: [-9, NATIVE - 3] },
    sea: { label: 'Sea', size: 400, spacing: 0.3, caps: true, italic: false, color: '#1d3c42', opacity: 0.64, zoom: [-9, NATIVE - 2.5] },
    bay: { label: 'Bay or gulf', size: 280, spacing: 0.18, caps: false, italic: true, color: '#1d3c42', opacity: 0.75, zoom: [NATIVE - 5, NATIVE + 1] },
    strait: { label: 'Strait or channel', size: 200, spacing: 0.25, caps: false, italic: true, color: '#1d3c42', opacity: 0.75, zoom: [NATIVE - 4.5, NATIVE + 1] },
    lake: { label: 'Lake', size: 150, spacing: 0.12, caps: false, italic: true, color: '#173a44', opacity: 0.85, zoom: [NATIVE - 4, NATIVE + 1] },
    river: { label: 'River', size: 90, spacing: 0.12, caps: false, italic: true, color: '#173a44', opacity: 0.85, zoom: [NATIVE - 3, NATIVE + 1] },
    range: { label: 'Mountain range', size: 240, spacing: 0.42, caps: true, italic: false, color: '#2e2416', opacity: 0.78, zoom: [NATIVE - 5, NATIVE + 1] },
    hills: { label: 'Hills or peaks', size: 150, spacing: 0.25, caps: false, italic: true, color: '#3a2c1a', opacity: 0.8, zoom: [NATIVE - 4, NATIVE + 1] },
    forest: { label: 'Forest or wood', size: 170, spacing: 0.25, caps: false, italic: true, color: '#22301a', opacity: 0.8, zoom: [NATIVE - 4.5, NATIVE + 1] },
    region: { label: 'Region, plain or desert', size: 260, spacing: 0.4, caps: true, italic: false, color: '#3a2c1a', opacity: 0.7, zoom: [NATIVE - 5.5, NATIVE] },
    other: { label: 'Other', size: 200, spacing: 0.2, caps: false, italic: true, color: '#2a2418', opacity: 0.8, zoom: [-9, NATIVE + 1] }
  };
  const labels = () => D().labels || (D().labels = []);
  // each kind's defaults: the built-in ones, under the map's own (Names › Defaults for each kind, data.settings.nameKinds)
  const kindKey = lb => (LKINDS[lb.kind] ? lb.kind : 'other');
  const kindOver = () => (D().settings && D().settings.nameKinds) || {};
  let kindPreview = null;   // { kind, key, val } while a defaults slider is moving
  const nameKind = k => { const o = Object.assign({}, LKINDS[k] || LKINDS.other, kindOver()[k] || {}); if (kindPreview && kindPreview.kind === k) o[kindPreview.key] = kindPreview.val; return o; };
  const lkind = lb => nameKind(kindKey(lb));
  const lval = (lb, k) => {
    if (kindPreview && kindPreview.kind === kindKey(lb) && kindPreview.key === k) return kindPreview.val;
    return lb[k] === undefined || lb[k] === null || lb[k] === '' ? lkind(lb)[k] : lb[k];
  };
  const picked = id => selLabel === id || selSet.has(id);
  map.createPane('names').style.zIndex = 395;
  const namesPane = map.getPane('names');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'namesvg');
  namesPane.append(svg);
  // The names are drawn for the view as it stood; while the map glides (a smooth zoom or pan, frame by frame, or
  // Leaflet's own animated zoom) the drawing is moved and scaled to match, and drawn afresh once it comes to rest.
  let drawnAt = null, animZoom = false;   // drawnAt: { z, o: the view's top left, in pixels at zoom z }
  svg.classList.add('leaflet-zoom-animated');
  function fitSvg(z1, po1) {
    if (!drawnAt) return;
    const s = map.getZoomScale(z1, drawnAt.z), x = s * drawnAt.o.x - po1.x, y = s * drawnAt.o.y - po1.y;
    svg.style.transform = `translate3d(${x}px,${y}px,0) scale(${s})`;
  }
  map.on('zoom move', () => fitSvg(map.getZoom(), map.getPixelOrigin()));
  map.on('zoomanim', e => { animZoom = true; fitSvg(e.zoom, map._getNewPixelOrigin(e.center, e.zoom)); });
  map.on('zoomend', () => { animZoom = false; drawNames(); drawRoutes(); });
  map.on('moveend resize viewreset', () => drawNames());
  const curveD = (pts, close) => {
    if (pts.length < 3) return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    const sp = smooth(pts, 14);
    return 'M' + sp.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + (close ? 'Z' : '');
  };
  // a curve's length worked out here (the same line the path draws), not asked of the page, which lays it out first
  const polyLen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
  let drawT = 0;
  function drawNames() { if (!drawT) drawT = requestAnimationFrame(() => { drawT = 0; renderNames(); }); }
  const textW = new Map();   // a name's width per pixel of font size, by lettering and text
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { textW.clear(); drawNames(); });   // (a web font arriving changes them)
  function renderNames() {
    if (animZoom) return;
    const tl = map.containerPointToLayerPoint([0, 0]), sz = map.getSize();
    drawnAt = { z: map.getZoom(), o: tl.add(map.getPixelOrigin()) };
    svg.style.transform = `translate3d(${tl.x}px,${tl.y}px,0)`;
    svg.setAttribute('width', sz.x); svg.setAttribute('height', sz.y); svg.setAttribute('viewBox', `0 0 ${sz.x} ${sz.y}`);
    while (svg.firstChild) svg.firstChild.remove();
    const z = map.getZoom(), k = Math.pow(2, z - NATIVE), editing = ctx.editMode();
    const lk = look(), fontStack = lk.labels.font || getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'Georgia, serif';
    const toScr = p => { const c = map.latLngToContainerPoint(toLatLng(p[0], p[1])); return [c.x, c.y]; };
    const defs = document.createElementNS(SVGNS, 'defs'); svg.append(defs);
    let n = 0; const fit = [];
    const put = (pts, text, o) => {
      if (!text || pts.length < 2) return null;
      let sp = pts.map(toScr);
      if (sp[sp.length - 1][0] < sp[0][0]) sp = sp.reverse();   // never upside down
      const id = 'nm' + (++n);
      const path = document.createElementNS(SVGNS, 'path'); path.setAttribute('id', id); path.setAttribute('d', curveD(sp)); defs.append(path);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'wname' + (o.cls ? ' ' + o.cls : ''));
      t.setAttribute('style', `font-family:${o.font || fontStack};font-size:${o.size.toFixed(1)}px;letter-spacing:${o.spacing}em;font-style:${o.italic ? 'italic' : 'normal'};font-weight:${o.weight || 600};fill:${o.color};fill-opacity:${o.opacity};` +
        (o.halo ? `stroke:${o.halo};stroke-width:${clamp(o.size * 0.07, 1.5, 3.5).toFixed(1)}px;stroke-opacity:${o.haloOpacity ?? 0.5};paint-order:stroke;stroke-linejoin:round;` : ''));
      if (o.dy) t.setAttribute('dy', o.dy);
      const tp = document.createElementNS(SVGNS, 'textPath');
      tp.setAttribute('href', '#' + id); tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
      tp.setAttribute('startOffset', '50%'); tp.setAttribute('text-anchor', 'middle');
      tp.textContent = o.caps ? text.toUpperCase() : text;
      t.append(tp); svg.append(t);
      // a name longer than its curve would be cut off: carried on past both ends until it fits (worked out below, for
      // all the names at once: reading a length lays the page out, and doing it between names did that for every one)
      fit.push({ path, sp, t, o, wk: (o.font || fontStack) + '|' + (o.weight || 600) + '|' + (o.italic ? 1 : 0) + '|' + o.spacing + '|' + tp.textContent });
      return t;
    };
    for (const lb of labels()) {
      const size = num(lval(lb, 'size'), 200) * k * clamp(num(lk.labels.size, 1), 0.5, 2.5);
      const zr = [num(lb.minZoom, lkind(lb).zoom[0]), num(lb.maxZoom, lkind(lb).zoom[1])];
      const visible = size >= 7 && size <= 130 && z >= zr[0] && z <= zr[1];   // too small or too big to read: not shown
      if (!visible && !(editing && picked(lb.id))) continue;
      const t = put(lb.pts, lb.text, { size: clamp(size, 7, 130), spacing: num(lval(lb, 'spacing'), 0.2), italic: !!lval(lb, 'italic'), caps: !!lval(lb, 'caps'),
        color: lval(lb, 'color'), opacity: num(lval(lb, 'opacity'), 0.8) * (visible ? 1 : 0.4), halo: lval(lb, 'halo') === false || look().labels.halo === false ? null : lval(lb, 'halo') === 'dark' ? '#14100a' : '#f2ecd9', haloOpacity: lval(lb, 'halo') === 'dark' ? 0.7 : 0.35, weight: lb.kind === 'ocean' || lb.kind === 'sea' ? 500 : 600,
        cls: (editing ? 'edit' : '') + (picked(lb.id) && editing ? ' sel' : '') });
      if (t && editing) {
        t.addEventListener('click', e => { e.stopPropagation(); if (mode) return mapClick(map.mouseEventToLatLng(e)); pickName(lb.id, e.ctrlKey || e.metaKey); selRoute = null; if (lb.kind === 'river') { riverSel = riverOfLabel(lb.id); showHi(); } ctx.openPanel('names', true); ctx.renderPanel(); drawRoutes(); });
        if (lb.kind === 'river' && net) { t.addEventListener('mouseenter', () => { riverHi = riverOfLabel(lb.id); showHi(); }); t.addEventListener('mouseleave', () => { riverHi = -1; showHi(); }); }
      }
    }
    // routes' names along their lines
    for (const r of routes()) {
      if (!r.name || r.showName === false || !r.pts || r.pts.length < 2) continue;
      if (!editing && r.minZoom != null && z < r.minZoom) continue;
      const fs = clamp(13 * Math.pow(2, (z - (NATIVE - 3)) * 0.35), 9, 17);
      put(routePath(r).length > 2 ? routePath(r).filter((_, i, a) => i % 4 === 0 || i === a.length - 1) : r.pts, r.name,
        { size: fs, spacing: 0.08, italic: true, caps: false, color: '#f6f1e2', opacity: 0.95, halo: '#14202a', haloOpacity: 0.65, dy: -Math.round(fs * 0.55), weight: 600 });
    }
    // every name's width (remembered per lettering) and its curve's length, all read in one go; then the short curves lengthened
    try {
      const got = fit.map(f => {
        let per = textW.get(f.wk);
        if (per == null) { per = f.t.getComputedTextLength() / f.o.size; if (per > 0) textW.set(f.wk, per); }
        return [per * f.o.size, polyLen(f.sp.length < 3 ? f.sp : smooth(f.sp, 14))];
      });
      fit.forEach((f, i) => {
        const [need, have] = got[i]; if (!(need > have * 0.96)) return;
        const sp = f.sp, ext = (need - have * 0.96) / 2 + f.o.size * 0.6;
        const a = sp[0], a2 = sp[1], b = sp[sp.length - 1], b2 = sp[sp.length - 2];
        const da = Math.hypot(a[0] - a2[0], a[1] - a2[1]) || 1, db = Math.hypot(b[0] - b2[0], b[1] - b2[1]) || 1;
        f.path.setAttribute('d', curveD([[a[0] + (a[0] - a2[0]) / da * ext, a[1] + (a[1] - a2[1]) / da * ext], ...sp, [b[0] + (b[0] - b2[0]) / db * ext, b[1] + (b[1] - b2[1]) / db * ext]]));
      });
    } catch (e) { /* not laid out */ }
    // the line being drawn
    if (draft && draft.pts.length) {
      const pts = draft.pts.concat(draft.cursor ? [draft.cursor] : []).map(toScr);
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', curveD(pts)); p.setAttribute('class', 'draftline'); svg.append(p);
    }
  }

  // ───────────────────────── drawing on the map ─────────────────────────
  const busy = () => !!mode;
  function setMode(m, extra) {
    mode = m; draft = m ? Object.assign({ pts: [], cursor: null }, extra || {}) : null;
    document.body.classList.toggle('mt-drawing', !!m); document.body.dataset.mtmode = m || '';
    map.doubleClickZoom[m ? 'disable' : 'enable']();
    hint();
    drawNames(); ctx.renderPanel();
  }
  function hint() {
    const msg = mode === 'route' ? 'Click along the route; double-click or Enter to finish, Backspace takes the last point back, Esc stops.'
      : mode === 'plot' ? (draft.pts.length ? 'Now click where the voyage ends.' : 'Click where the voyage starts (a port, or the sea by it).')
      : mode === 'label' ? 'Click the middle of the water to name it.' : '';
    ctx.hint(msg || null);
  }
  map.on('click', e => mapClick(e.latlng));
  // place: a place's exact spot (clicking its icon) — routes start and end right on it; names go where you clicked
  function mapClick(latlng, place) {
    if (!mode || ctx.rulerOn()) return;
    const p = toPixel(latlng), pt = place && mode !== 'label' ? place.map(Math.round) : [Math.round(p.x), Math.round(p.y)];
    if (mode === 'route') { draft.pts.push(pt); drawNames(); return; }
    if (mode === 'plot') {
      draft.pts.push(pt);
      if (draft.pts.length === 1) { hint(); drawNames(); return; }
      const [a, b] = draft.pts, kind = draft.kind || 'sea';
      setMode(null);
      toast('Plotting a course…');
      setTimeout(() => {
        const pts = plotSea(a, b); if (!pts) return;
        const r = { id: uid('r'), name: '', kind, pts };
        ctx.change(() => { routes().push(r); });
        selRoute = r.id; selLabel = null; ctx.openPanel('routes', true); drawRoutes();
        toast(`Course plotted: ${distText(routeMiles(r))}. Name it in the panel; drag the points to adjust.`);
      }, 30);
      return;
    }
    if (mode === 'label') {
      const kind = draft.kind || 'sea', K = nameKind(kind);
      const half = K.size * Math.max(2.2, 10 * (0.62 + K.spacing) * 0.6);   // about as wide as a ten-letter name
      const lb = { id: uid('w'), text: draft.text || 'New name', kind, pts: [[pt[0] - half, pt[1] + half * 0.08], [pt[0], pt[1] - half * 0.06], [pt[0] + half, pt[1] + half * 0.08]].map(q => q.map(Math.round)) };
      setMode(null);
      ctx.change(() => { labels().push(lb); });
      selLabel = lb.id; selRoute = null; ctx.openPanel('names', true); drawRoutes();
      setTimeout(() => { const f = document.getElementById('lbText'); if (f) { f.focus(); f.select(); } }, 50);
    }
  }
  map.on('mousemove', e => { if (mode === 'route' && draft.pts.length) { const p = toPixel(e.latlng); draft.cursor = [p.x, p.y]; drawNames(); } });
  map.on('dblclick', e => { if (mode === 'route') { L.DomEvent.stop(e); finishRoute(); } });
  document.addEventListener('keydown', e => {
    if (!mode || ctx.isTyping()) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setMode(null); }
    else if (mode === 'route' && e.key === 'Enter') { e.preventDefault(); finishRoute(); }
    else if (mode === 'route' && e.key === 'Backspace') { e.preventDefault(); draft.pts.pop(); drawNames(); }
  }, true);
  function finishRoute() {
    const pts = dedupe(draft.pts), kind = draft.kind || 'sea';
    setMode(null);
    if (pts.length < 2) return;
    const r = { id: uid('r'), name: '', kind, pts };
    ctx.change(() => { routes().push(r); });
    selRoute = r.id; selLabel = null; ctx.openPanel('routes', true); drawRoutes();
  }
  const dedupe = pts => pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 2);

  // ───────────────────────── rivers ─────────────────────────
  // The river network, traced from the map's own water as it loads (app.js traceRivers): every river from its source to
  // its mouth, what it ends in (the sea, a lake, another river) and the streams that feed it. Editors can show it as
  // coloured lines; pointing at a river (on the map, in the list, or at its name) lights up the whole of it: where it
  // rises, where it ends and in what, and its tributaries. "Name the rivers" names every river long enough, in the
  // style of the land it runs through (the Name Forge), and sets the name along it; a name is a river name like any
  // other (Names), linked to its river so it can be set along it again.
  let net = null, riverOn = false, riverHi = -1, riverSel = -1, rivLL = [];
  try { riverOn = localStorage.getItem('valanar-rivers-on') === '1'; } catch (e) { /* private window */ }
  { const rp = map.createPane('rivers'); rp.style.zIndex = 392; rp.style.pointerEvents = 'none'; }   // (it only catches the mouse while the network is shown: else borders below couldn't be picked)
  const rivRender = L.canvas({ pane: 'rivers', tolerance: 7, padding: 0.4 });
  const rivLayer = L.layerGroup().addTo(map), hiLayer = L.layerGroup().addTo(map);
  const RIV_MIN = 500;   // map px: the default shortest river that gets a name
  const rivMin = () => num(D().settings && D().settings.riverMin, RIV_MIN);
  const hue = i => (i * 137.508) % 360;
  const rivColor = i => `hsl(${hue(i).toFixed(0)},70%,42%)`;
  const ptsOf = flat => { const o = []; for (let k = 0; k < flat.length; k += 2) o.push([flat[k], flat[k + 1]]); return o; };
  // where a point is nearest a river: distance, and which river
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function nearestRiver(x, y, maxD, skip) {
    let best = -1, bd = maxD;
    for (const r of net ? net.rivers : []) {
      if (skip && skip.has(r.i)) continue;
      for (const f of r.pieces) for (let k = 0; k + 3 < f.length; k += 2) {
        if (Math.abs(f[k] - x) > bd + 400 && Math.abs(f[k + 2] - x) > bd + 400) continue;
        const d = segDist(x, y, f[k], f[k + 1], f[k + 2], f[k + 3]); if (d < bd) { bd = d; best = r.i; }
      }
    }
    return best;
  }
  // which name goes with which river: a name made for it (it carries the river's key), else a river name lying along it
  let assoc = new Map(), assocSig = '';
  function riverNames() {
    const rl = labels().filter(l => l.kind === 'river');
    const sig = (net ? net.rivers.length : 0) + '|' + rl.map(l => l.id + ':' + (l.river || '') + ':' + l.pts.map(p => p.join(',')).join(';')).join('|');
    if (sig === assocSig) return assoc;
    assoc = new Map(); assocSig = sig;
    if (!net) return assoc;
    const byKey = new Map(net.rivers.map(r => [r.key, r.i])), loose = [];
    for (const lb of rl) { const i = lb.river != null ? byKey.get(lb.river) : undefined; if (i != null && !assoc.has(i)) assoc.set(i, lb); else loose.push(lb); }
    for (const lb of loose) {
      const m = lb.pts[Math.floor(lb.pts.length / 2)], taken = new Set(assoc.keys());
      const i = nearestRiver(m[0], m[1], 260, taken); if (i >= 0) assoc.set(i, lb);
    }
    return assoc;
  }
  const riverOfLabel = id => { for (const [i, lb] of riverNames()) if (lb.id === id) return i; return -1; };
  const riverName = i => { const lb = riverNames().get(i); return lb ? lb.text : ''; };
  function lakeName(id) {
    const lk = net && net.lakes.find(l => l.id === id); if (!lk) return 'a lake';
    let best = null, bd = Math.max(900, Math.sqrt(lk.area) * 8 * 2.5);
    for (const lb of labels()) { if (lb.kind !== 'lake' && lb.kind !== 'bay') continue; const m = lb.pts[Math.floor(lb.pts.length / 2)]; const d = Math.hypot(m[0] - lk.x, m[1] - lk.y); if (d < bd) { bd = d; best = lb; } }
    return best ? best.text : 'a lake';
  }
  function intoText(r) {
    if (r.into.river != null) return 'into ' + (riverName(r.into.river) || 'another river');
    if (r.into.lake != null) return 'into ' + lakeName(r.into.lake) + (r.into.sea ? ' (and so the sea)' : '');
    if (r.into.sea) return 'into the sea';
    return 'into the ground (it ends here)';
  }
  const lenText = r => (+D().settings.milesPerPx ? distText(r.len * D().settings.milesPerPx) : `${Math.round(r.len).toLocaleString()} map px`);
  const allTribs = i => { const out = []; const st = [...net.rivers[i].trib]; while (st.length) { const t = st.pop(); out.push(t); st.push(...net.rivers[t].trib); } return out; };
  const riverBounds = i => L.latLngBounds([].concat(...[i, ...allTribs(i)].map(k => rivLL[k] ? rivLL[k].flat() : [])));

  // every stretch of every river, filed by where it lies (cells of 256 map px), for finding the river under the cursor
  const CELL = 256; let segGrid = null;
  function indexRivers() {
    segGrid = new Map();
    for (const r of net.rivers) {
      if (r.len < 120) continue;   // (the smallest streams aren't picked out)
      for (const f of r.pieces) for (let k = 0; k + 3 < f.length; k += 2) {
        const x0 = Math.floor(Math.min(f[k], f[k + 2]) / CELL), x1 = Math.floor(Math.max(f[k], f[k + 2]) / CELL);
        const y0 = Math.floor(Math.min(f[k + 1], f[k + 3]) / CELL), y1 = Math.floor(Math.max(f[k + 1], f[k + 3]) / CELL);
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const key = gx + ',' + gy; let c = segGrid.get(key); if (!c) segGrid.set(key, c = []); c.push(r.i, f[k], f[k + 1], f[k + 2], f[k + 3]); }
      }
    }
  }
  function riverAt(x, y, tol) {
    if (!segGrid) return -1;
    let best = -1, bd = tol;
    const gx0 = Math.floor((x - tol) / CELL), gx1 = Math.floor((x + tol) / CELL), gy0 = Math.floor((y - tol) / CELL), gy1 = Math.floor((y + tol) / CELL);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const c = segGrid.get(gx + ',' + gy); if (!c) continue;
      for (let k = 0; k < c.length; k += 5) { const d = segDist(x, y, c[k + 1], c[k + 2], c[k + 3], c[k + 4]); if (d < bd) { bd = d; best = c[k]; } }
    }
    return best;
  }
  // pointing at a river (anyone, any time the map isn't busy): the whole of it glows, with its name
  const hoverLayer = L.layerGroup().addTo(map);
  let hovRiver = -1, hovTip = null, hovRaf = 0, hovEvt = null;
  function setHover(i, latlng) {
    if (i === hovRiver) { if (hovTip && latlng) hovTip.setLatLng(latlng); return; }
    hovRiver = i; hoverLayer.clearLayers(); if (hovTip) { map.closeTooltip(hovTip); hovTip = null; }
    map.getContainer().classList.toggle('over-river', i >= 0);
    if (i < 0) return;
    const r = net.rivers[i], o = { renderer: rivRender, interactive: false, lineCap: 'round', lineJoin: 'round' };
    for (const t of allTribs(i)) if (net.rivers[t].len >= 120) hoverLayer.addLayer(L.polyline(rivLL[t], Object.assign({ color: '#d9f2ff', weight: 3, opacity: 0.35 }, o)));
    hoverLayer.addLayer(L.polyline(rivLL[i], Object.assign({ color: '#bfe8ff', weight: 11, opacity: 0.32 }, o)));
    hoverLayer.addLayer(L.polyline(rivLL[i], Object.assign({ color: '#f2fbff', weight: 2.6, opacity: 0.9 }, o)));
    const nm = riverName(i);
    hovTip = L.tooltip({ className: 'rivtip', direction: 'top', offset: [0, -14], opacity: 1 })
      .setLatLng(latlng).setContent(nm ? `<b>${esc(nm)}</b><br>${esc(lenText(r))}, flowing ${esc(intoText(r))}` : `A river, ${esc(lenText(r))}, flowing ${esc(intoText(r))}`);
    map.openTooltip(hovTip);
  }
  map.on('mousemove', e => {
    hovEvt = e; if (hovRaf) return;
    hovRaf = requestAnimationFrame(() => {
      hovRaf = 0; const ev = hovEvt;
      if (!net || !ev || mode || map._gliding || map._animatingZoom || (map.dragging && map.dragging.moving()) || (riverOn && ctx.editMode()) || document.body.classList.contains('placing') || document.body.classList.contains('ruling')) return setHover(-1);
      const p = toPixel(ev.latlng), wpp = Math.pow(2, NATIVE - map.getZoom());
      setHover(riverAt(p.x, p.y, 9 * wpp), ev.latlng);
    });
  });
  map.on('mouseout movestart zoomstart', () => setHover(-1));
  map.on('click', () => { if (hovRiver >= 0 && ctx.editMode() && !mode && ctx.panelMode && ctx.panelMode() === 'names') { const i = hovRiver; setHover(-1); selectRiver(i, false); } });   // (with Names open, a click picks the river)

  function setRivers(n) {
    net = n && Array.isArray(n.rivers) ? n : null;
    rivLL = net ? net.rivers.map(r => r.pieces.map(f => ptsOf(f).map(p => toLatLng(p[0], p[1])))) : [];
    segGrid = null; if (net) indexRivers(); setHover(-1);
    assocSig = ''; riverSel = -1; riverHi = -1;
    drawRivers();
    if (ctx.editMode()) ctx.renderPanel();
  }
  function drawRivers() {
    rivLayer.clearLayers();
    map.getPane('rivers').style.pointerEvents = net && riverOn && ctx.editMode() ? '' : 'none';
    if (net && riverOn && ctx.editMode()) {
      const min = rivMin(), names = riverNames();
      // the smallest first, so the big rivers lie on top
      const order = net.rivers.map(r => r.i).sort((a, b) => net.rivers[a].len - net.rivers[b].len);
      for (const i of order) {
        const r = net.rivers[i], big = r.len >= min;
        const line = L.polyline(rivLL[i], { renderer: rivRender, color: rivColor(i), weight: big ? 3.2 : 1.8, opacity: big || names.has(i) ? 0.95 : 0.6, lineCap: 'round', lineJoin: 'round', interactive: true, bubblingMouseEvents: false });
        line.on('mouseover', e => { riverHi = i; showHi(); line.bindTooltip(tipText(i), { sticky: true, className: 'rivtip', direction: 'top', offset: [0, -8] }).openTooltip(e.latlng); });
        line.on('mouseout', () => { line.unbindTooltip(); riverHi = -1; showHi(); });
        line.on('click', e => { L.DomEvent.stop(e); selectRiver(i, false); });
        rivLayer.addLayer(line);
      }
    }
    showHi();
  }
  const tipText = i => { const r = net.rivers[i]; return `<b>${esc(riverName(i) || 'An unnamed river')}</b><br>${esc(lenText(r))}, ${esc(intoText(r))}${r.trib.length ? ` · ${r.trib.length} tributar${r.trib.length === 1 ? 'y' : 'ies'}` : ''}`; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // the lit-up river: its course in gold, its tributaries in blue, the river it joins faint, its source and its mouth marked
  function showHi() {
    hiLayer.clearLayers();
    const i = riverHi >= 0 ? riverHi : riverSel;
    if (!net || i < 0 || !net.rivers[i] || !ctx.editMode()) return;
    const r = net.rivers[i], o = { renderer: rivRender, interactive: false, lineCap: 'round', lineJoin: 'round' };
    if (r.into.river != null && rivLL[r.into.river]) hiLayer.addLayer(L.polyline(rivLL[r.into.river], Object.assign({ color: '#5a3a12', weight: 2, opacity: 0.55, dashArray: '5 7' }, o)));
    for (const t of allTribs(i)) hiLayer.addLayer(L.polyline(rivLL[t], Object.assign({ color: '#2f86d6', weight: 2.6, opacity: 0.95 }, o)));
    hiLayer.addLayer(L.polyline(rivLL[i], Object.assign({ color: '#ffd36b', weight: 12, opacity: 0.5 }, o)));
    hiLayer.addLayer(L.polyline(rivLL[i], Object.assign({ color: '#b34d00', weight: 4, opacity: 1 }, o)));
    for (const t of r.trib) { const m = net.rivers[t].mouth; hiLayer.addLayer(L.circleMarker(toLatLng(m[0], m[1]), Object.assign({ radius: 4, color: '#14466f', weight: 1.5, fillColor: '#8cc8ff', fillOpacity: 1 }, o))); }
    const src = L.circleMarker(toLatLng(r.src[0], r.src[1]), Object.assign({ radius: 6, color: '#1f5b22', weight: 2, fillColor: '#8fe08f', fillOpacity: 1 }, o));
    const mouth = L.circleMarker(toLatLng(r.mouth[0], r.mouth[1]), Object.assign({ radius: 7, color: '#6b1a00', weight: 2, fillColor: '#ff8a4a', fillOpacity: 1 }, o));
    src.bindTooltip(r.from && r.from.lake != null ? 'Flows out of ' + esc(lakeName(r.from.lake)) : r.from && r.from.river != null ? 'Leaves ' + esc(riverName(r.from.river) || 'another river') : 'Source', { permanent: true, direction: 'top', className: 'rivtip end', offset: [0, -6] });
    mouth.bindTooltip('Flows ' + esc(intoText(r)), { permanent: true, direction: 'top', className: 'rivtip end', offset: [0, -7] });
    hiLayer.addLayer(src); hiLayer.addLayer(mouth);
  }
  function selectRiver(i, fly) {
    riverSel = i; riverHi = -1; showHi();
    const lb = riverNames().get(i);
    if (lb) { selSet.clear(); selLabel = lb.id; } else selLabel = null;
    selRoute = null;
    ctx.openPanel('names', true); drawRoutes(); drawNames();
    if (fly) map.flyToBounds(riverBounds(i).pad(0.25), { duration: 0.8, maxZoom: NATIVE - 0.5 });
  }

  // ── naming
  const BASE_SYL = ['al', 'an', 'ber', 'dor', 'el', 'en', 'fal', 'gar', 'hal', 'is', 'kar', 'lin', 'mar', 'nor', 'or', 'ra', 'sel', 'tor', 'ul', 'van', 'wen', 'yr'];
  function forgeRiverName(i, avoid) {
    const r = net.rivers[i], f = r.pieces[Math.floor(r.pieces.length / 2)], k = Math.floor(f.length / 4) * 2;
    const nation = ctx.nationNear ? ctx.nationNear(f[k], f[k + 1]) : '';
    const N = ctx.names && ctx.names();
    const taken = new Set([...labels().map(l => String(l.text || '').toLowerCase()), ...D().markers.map(m => String(m.name || '').toLowerCase()), ...(avoid || [])]);
    // a dozen from the forge; the easiest to say wins (not too long, no knots of consonants or runs of vowels)
    const say = w => {
      const x = w.toLowerCase(); let sc = Math.abs(x.length - 6.5) * 0.45;
      sc += (x.match(/[^aeiouy'\- ]{3,}/g) || []).filter(c => !/^(str|sch|tch|ght|nds|nth|rth|lds|rst|ndr|ntr)/.test(c)).length * 1.6;
      sc += (x.match(/[aeiouy]{3,}/g) || []).length * 1.2 + (/['\-]/.test(x) ? 1.5 : 0) + (/(.)\1\1/.test(x) ? 2 : 0);
      return sc;
    };
    const pool = [];
    for (let t = 0; t < 24 && pool.length < 12; t++) {
      let base = (N && N.suggest(nation)) || '';
      base = base.replace(/\s+(river|lake|sea|bay|mere|water)$/i, '').trim();
      if (!base || /\s/.test(base) || base.length < 3 || base.length > 11 || taken.has(base.toLowerCase())) continue;
      pool.push(base);
    }
    while (pool.length < 3) { let b = ''; for (let k = 0; k < 2 + (Math.random() < 0.4); k++) b += BASE_SYL[Math.floor(Math.random() * BASE_SYL.length)]; pool.push(b[0].toUpperCase() + b.slice(1)); }
    pool.sort((a, b) => say(a) - say(b));
    for (const base of pool) {
      const u = Math.random(), name = u < 0.42 ? `River ${base}` : u < 0.8 ? `${base} River` : `The ${base}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    return 'New River';
  }
  // the river names already on the map set the size for new ones (the middle of theirs), else the kind's size
  function riverSize() {
    const s = labels().filter(l => l.kind === 'river' && isFinite(+l.size) && +l.size > 0).map(l => +l.size).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  }
  // a name along a river: the smoothest stretch of it long enough for the name, near its middle and clear of other
  // names and of places, set just beside the water so the river still shows; null if the river's too short for it
  function placeRiverName(i, text, size) {
    const r = net.rivers[i], K = nameKind('river'), sz = size || num(K.size, 90), spacing = num(K.spacing, 0.12);
    const want = sz * text.length * (0.5 + spacing) * 1.15;
    const piece = r.pieces.map(ptsOf).sort((a, b) => pathLength(b) - pathLength(a))[0];
    if (!piece || pathLength(piece) < want * 1.05) return null;
    // the course, smoothed and evenly spaced
    const sm = smooth(piece, 6), step = Math.max(4, sz * 0.35), P = [sm[0]];
    let acc = 0;
    for (let k = 1; k < sm.length; k++) {
      let a = P[P.length - 1]; const b = sm[k]; let d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = d;
      while (acc >= step) { const t = step / acc; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; P.push(a); acc = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    }
    const n = Math.round(want / step); if (P.length < n + 2) return null;
    const ang = []; for (let k = 0; k + 1 < P.length; k++) ang.push(Math.atan2(P[k + 1][1] - P[k][1], P[k + 1][0] - P[k][0]));
    const others = labels().filter(l => riverOfLabel(l.id) !== i).map(l => l.pts[Math.floor(l.pts.length / 2)]);
    const bx = [Math.min(...P.map(p => p[0])) - want, Math.max(...P.map(p => p[0])) + want, Math.min(...P.map(p => p[1])) - want, Math.max(...P.map(p => p[1])) + want];
    const places = D().markers.filter(m => isFinite(m.x) && m.x > bx[0] && m.x < bx[1] && m.y > bx[2] && m.y < bx[3]);
    let best = -1, bs = Infinity;
    for (let s0 = 1; s0 + n < P.length - 1; s0++) {
      let turn = 0; for (let k = s0; k < s0 + n - 1; k++) { let d = ang[k + 1] - ang[k]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += Math.abs(d); }
      const a = P[s0], b = P[s0 + n], mid = P[s0 + (n >> 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; if (dx < 0) { dx = -dx; dy = -dy; }
      const steep = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
      let sc = turn + 1.4 * Math.abs((s0 + n / 2) / P.length - 0.5) + (steep > 55 ? (steep - 55) / 35 : 0);
      for (const o of others) if (Math.hypot(o[0] - mid[0], o[1] - mid[1]) < want) sc += 3;
      let hits = 0; for (let k = s0; k <= s0 + n; k += 2) for (const m of places) if (Math.hypot(m.x - P[k][0], m.y - P[k][1]) < sz * 1.6) hits++;
      sc += Math.min(3, hits * 0.35);
      if (sc < bs) { bs = sc; best = s0; }
    }
    if (best < 0) return null;
    // five points along it, a little to one side: above the water as it reads left to right
    const W = P.slice(best, best + n + 1);
    if (W[W.length - 1][0] < W[0][0]) W.reverse();
    const ch = [W[W.length - 1][0] - W[0][0], W[W.length - 1][1] - W[0][1]], up = [ch[1], -ch[0]];
    const off = sz * 0.7 + 8, out = [];   // (the river's own width is about 20 map px)
    for (let q = 0; q < 5; q++) {
      const k = Math.round(q / 4 * (W.length - 1)), p = W[k], a = W[Math.max(0, k - 1)], b = W[Math.min(W.length - 1, k + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (nx * up[0] + ny * up[1] < 0) { nx = -nx; ny = -ny; }
      out.push([Math.round(p[0] + nx * off), Math.round(p[1] + ny * off)]);
    }
    return out;
  }
  function nameRiver(i, text) {   // a name for one river (or a new one for it), set along it
    const r = net.rivers[i], lb = riverNames().get(i), size = (lb && +lb.size) || riverSize();
    text = text || forgeRiverName(i);
    if (lb) { setL(lb, t => { t.text = text; }); return true; }
    const pts = placeRiverName(i, text, size);
    if (!pts) { toast(`${text}: this river is too short for its name to lie along it. Add it by hand (Add a name).`, true); return false; }
    const nl = { id: uid('w'), text, kind: 'river', pts, river: r.key }; if (size) nl.size = size;
    ctx.change(() => { labels().push(nl); }, { panel: false });
    selLabel = nl.id; ctx.renderPanel(); drawNames(); drawRivers();
    return true;
  }
  function renameAlong(i) {   // its name set along it again
    const lb = riverNames().get(i); if (!lb) return;
    const pts = placeRiverName(i, lb.text, +lb.size || riverSize());
    if (!pts) return toast('There isn’t a long enough stretch of this river for its name.', true);
    setL(lb, t => { t.pts = pts; t.river = net.rivers[i].key; });
    drawNames();
  }
  function nameAll() {
    if (!net) return;
    const names = riverNames(), size = riverSize(), min = rivMin(), made = [], avoid = new Set();
    let short = 0;
    // the longest first, so the main rivers have first pick of the clear stretches
    for (const r of net.rivers.slice().sort((a, b) => b.len - a.len)) {
      if (r.len < min || names.has(r.i)) continue;
      const text = forgeRiverName(r.i, avoid); avoid.add(text.toLowerCase());
      const pts = placeRiverName(r.i, text, size);
      if (!pts) { short++; continue; }
      const nl = { id: uid('w'), text, kind: 'river', pts, river: r.key }; if (size) nl.size = size;
      labels().push(nl); made.push(nl);   // (pushed now so the next ones keep clear of it; taken back out for the undoable change)
    }
    D().labels = labels().filter(l => !made.includes(l));
    if (!made.length) return toast(short ? 'The rivers left without names are too short for one to lie along them.' : 'Every river long enough already has a name.');
    ctx.change(() => { labels().push(...made); });
    drawNames(); drawRivers();
    toast(`Named ${made.length} river${made.length === 1 ? '' : 's'}${short ? ` (${short} too short for a name along them)` : ''}. Undo (Ctrl+Z) takes them all back.`);
  }

  // ── the Rivers part of the Names panel
  function riverPanel() {
    if (!net) return [h('h2', null, 'Rivers'), h('p', { class: 'small muted' }, Land.ready ? 'No rivers found in the map’s water (Map settings › Rivers and lakes).' : 'Finding the rivers…')];
    const names = riverNames(), min = rivMin(), mpp = +D().settings.milesPerPx || 0;
    const long = net.rivers.filter(r => r.len >= min || names.has(r.i)).sort((a, b) => b.len - a.len);
    const unnamed = long.filter(r => !names.has(r.i)).length;
    const out = [h('h2', null, `Rivers · ${net.rivers.length}`)];
    if (riverSel >= 0 && net.rivers[riverSel]) {
      const i = riverSel, r = net.rivers[i], lb = names.get(i);
      const chip = (k, label) => h('button', { class: 'rchip', onmouseenter: () => { riverHi = k; showHi(); }, onmouseleave: () => { riverHi = -1; showHi(); }, onclick: () => selectRiver(k, true) }, label);
      out.push(h('div', { class: 'rivsel' },
        h('label', null, 'This river'),
        h('div', { class: 'row', style: 'align-items:end' },
          h('input', { type: 'text', value: lb ? lb.text : '', placeholder: 'An unnamed river: type a name', onchange: e => { const v = e.target.value.trim(); if (!v) return; nameRiver(i, v); } }),
          h('button', { class: 'btn sm', title: 'A name in the style of the land it runs through', onclick: () => nameRiver(i) }, '✦ Forge one')),
        h('p', { class: 'small' }, `${lenText(r)}, flowing ${intoText(r)}.`,
          r.into.river != null ? [' ', chip(r.into.river, 'Show ' + (riverName(r.into.river) || 'that river'))] : null,
          r.from && r.from.river != null ? [' Leaves ', chip(r.from.river, riverName(r.from.river) || 'another river'), '.'] : r.from && r.from.lake != null ? ` Flows out of ${lakeName(r.from.lake)}.` : ''),
        r.trib.length ? h('div', { class: 'rtribs' }, h('span', { class: 'small muted' }, 'Tributaries: '), ...r.trib.slice().sort((a, b) => net.rivers[b].len - net.rivers[a].len).map(t => chip(t, riverName(t) || `unnamed (${lenText(net.rivers[t])})`))) : null,
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn sm', onclick: () => map.flyToBounds(riverBounds(i).pad(0.25), { duration: 0.8, maxZoom: NATIVE - 0.5 }) }, 'Show all of it'),
          lb ? h('button', { class: 'btn sm', title: 'Set its name along the smoothest stretch again', onclick: () => renameAlong(i) }, 'Set its name along it again') : null,
          h('button', { class: 'btn sm', onclick: () => { riverSel = -1; showHi(); ctx.renderPanel(); } }, 'Done'))));
    }
    out.push(
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: riverOn || null, onchange: e => { riverOn = e.target.checked; try { localStorage.setItem('valanar-rivers-on', riverOn ? '1' : '0'); } catch (x) { /* private */ } drawRivers(); } }),
        'Show the rivers on the map (point at one to see all of it)'),
      h('div', { class: 'row', style: 'align-items:end;margin-top:6px' },
        h('div', null, h('label', null, mpp ? `Name rivers longer than (${unit()[1]})` : 'Name rivers longer than (map px)'),
          h('input', { type: 'number', min: 0, step: mpp ? 5 : 50, value: mpp ? Math.round(min * mpp * unit()[0]) : min, style: 'width:90px',
            onchange: e => { const v = Math.max(0, +e.target.value || 0), px = mpp ? Math.round(v / unit()[0] / mpp) : v; ctx.change(() => { D().settings.riverMin = px; }, { panel: true }); drawRivers(); } })),
        h('button', { class: 'btn primary', disabled: !unnamed || null, onclick: nameAll }, unnamed ? `Name the rivers (${unnamed})` : 'All named')),
      h('p', { class: 'small muted' }, 'Names come from the Name Forge, in the style of the land each river runs through, and lie along the smoothest clear stretch. Each is a river name like the others above: rename it, drag its points, or delete it. Ctrl+Z undoes a whole batch.'),
      h('div', { class: 'nlist rlist' }, ...long.map(r => h('div', { class: 'nrow' + (r.i === riverSel ? ' on' : ''), style: 'cursor:pointer',
        onmouseenter: () => { riverHi = r.i; showHi(); }, onmouseleave: () => { riverHi = -1; showHi(); }, onclick: () => selectRiver(r.i, true) },
        h('span', { class: 'rsw', style: `background:${rivColor(r.i)}` }),
        h('span', { class: 'rnm', style: 'flex:1;font-style:italic' + (names.has(r.i) ? '' : ';opacity:.6') }, riverName(r.i) || 'Unnamed'),
        h('span', { class: 'cnt' }, lenText(r))))));
    return out;
  }

  // ───────────────────────── panels ─────────────────────────
  const setR = (r, fn, opts) => ctx.change(() => { const t = routes().find(x => x.id === r.id); if (t) fn(t); }, opts || { panel: false });
  const setL = (lb, fn, opts) => ctx.change(() => { const t = labels().find(x => x.id === lb.id); if (t) fn(t); }, opts || { panel: false });
  // Ctrl+click adds a name to the picked ones, or takes it out; a plain click picks just that one
  function pickName(id, add) {
    if (!add) { selSet.clear(); selLabel = id; return; }
    if (selLabel && !selSet.size) selSet.add(selLabel);
    if (selSet.has(id)) { selSet.delete(id); selLabel = selSet.size ? [...selSet][selSet.size - 1] : null; if (selSet.size === 1) selSet.clear(); }
    else { selSet.add(id); selLabel = id; }
  }
  const group = () => (selSet.size > 1 ? labels().filter(x => selSet.has(x.id)) : null);
  const setG = (fn, opts) => ctx.change(() => { for (const t of labels()) if (selSet.has(t.id)) fn(t); }, opts || { panel: false });
  // a new kind keeps the name's size; its other looks follow the new kind
  const changeKind = (t, v) => { const size = num(lval(t, 'size'), 200); t.kind = v; for (const key of ['spacing', 'color', 'opacity', 'caps', 'italic', 'halo', 'minZoom', 'maxZoom']) delete t[key]; t.size = size; };
  // a name's size: a slider even across the range (5 to 2400 map pixels) beside a box for an exact number
  const SIZE_MIN = 5, SIZE_MAX = 2400;
  const sizeToPos = v => Math.round(1000 * Math.log(clamp(v, SIZE_MIN, SIZE_MAX) / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
  const posToSize = p => { const v = SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, p / 1000); return v < 20 ? Math.round(v * 2) / 2 : v < 200 ? Math.round(v) : Math.round(v / 5) * 5; };
  const sizeControls = lb => {
    const cur = num(lval(lb, 'size'), 200);
    const box = h('input', { type: 'number', min: 1, max: 5000, step: 0.5, value: cur, style: 'width:80px',
      onchange: e => { const v = clamp(+e.target.value || cur, 1, 5000); setL(lb, t => { t.size = v; }); } });
    const slide = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: sizeToPos(cur),
      oninput: e => { lb.size = posToSize(+e.target.value); box.value = lb.size; drawNames(); },
      onchange: e => { const v = posToSize(+e.target.value); setL(lb, t => { t.size = v; }); } });
    return [h('label', null, 'Size (map pixels)'), h('div', { class: 'row', style: 'align-items:center;gap:8px' }, h('div', { style: 'flex:1' }, slide), box)];
  };
  const pageList = () => { const dl = h('datalist', { id: 'mtPages' }, ...ctx.pages().map(p => h('option', { value: p.title }))); return dl; };

  function routesPanel() {
    const r = selRoute && routes().find(x => x.id === selRoute);
    const kindSel = (val, on) => h('select', { onchange: e => on(e.target.value) }, ...Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: k === val || null }, v.label)));
    let newKind = 'sea';
    const body = [
      h('p', { class: 'small muted' }, 'Sea lanes, river passages, roads and trade routes. Everyone sees them; clicking one shows its length and journey times.'),
      h('div', { class: 'btnrow', style: 'margin-top:4px' },
        h('button', { class: 'btn primary' + (mode === 'plot' ? ' on' : ''), title: 'Click a start and an end: the course goes round the land', onclick: () => setMode(mode === 'plot' ? null : 'plot', { kind: 'sea' }) }, mode === 'plot' ? 'Plotting… (Esc)' : 'Plot a voyage by sea'),
        h('button', { class: 'btn' + (mode === 'route' ? ' on' : ''), onclick: () => setMode(mode === 'route' ? null : 'route', { kind: newKind }) }, mode === 'route' ? 'Drawing… (Enter)' : 'Draw a route'),
        kindSel(newKind, v => { newKind = v; if (mode === 'route') draft.kind = v; }))
    ];
    if (r) {
      const k = kindOf(r), miles = routeMiles(r);
      body.push(h('h2', null, 'This route'),
        h('label', null, 'Name'), h('input', { id: 'rtName', type: 'text', value: r.name || '', placeholder: 'e.g. The Salt Road', onchange: e => { setR(r, t => { t.name = e.target.value.trim(); }); const row = document.querySelector(`[data-rid="${r.id}"] .rnm`); if (row) row.textContent = e.target.value.trim() || 'Unnamed ' + k.label.toLowerCase(); } }),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Kind'), kindSel(r.kind, v => setR(r, t => { t.kind = v; }, {}))),
          h('div', null, h('label', null, 'Line'), h('select', { onchange: e => setR(r, t => { t.dash = e.target.value || undefined; }) },
            h('option', { value: '' }, 'As the kind'), ...Object.keys(DASH).map(d => h('option', { value: d, selected: r.dash === d || null }, d[0].toUpperCase() + d.slice(1).replace('dashdot', 'dash-dot')))))),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Colour'), h('input', { type: 'color', value: r.color || k.color, onchange: e => setR(r, t => { t.color = e.target.value; }) })),
          h('div', null, h('label', null, 'Width'), h('input', { type: 'number', min: 1, max: 8, step: 0.5, value: num(r.width, k.width), onchange: e => setR(r, t => { t.width = +e.target.value; }) })),
          h('div', null, h('label', null, 'Shows from zoom'), h('input', { type: 'number', step: 0.25, value: r.minZoom ?? '', placeholder: 'always', onchange: e => setR(r, t => { if (e.target.value === '') delete t.minZoom; else t.minZoom = +e.target.value; }) }))),
        h('label', null, 'Line opacity ', h('span', { class: 'small muted', id: 'rtOpv' }, Math.round((r.opacity ?? 1) * 100) + '%' + ((r.opacity ?? 1) === 0 ? ' (hidden: only its name and clicks show)' : ''))),
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: r.opacity ?? 1, title: 'Fade the line to see the road drawn on the map underneath; at 0 the line is hidden but the route still measures, names and clicks',
          oninput: e => { r.opacity = +e.target.value; const v = document.getElementById('rtOpv'); if (v) v.textContent = Math.round(r.opacity * 100) + '%'; drawRoutes(); },
          onchange: e => setR(r, t => { const v = +e.target.value; if (v >= 1) delete t.opacity; else t.opacity = v; }) }),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: r.showName !== false || null, onchange: e => setR(r, t => { t.showName = e.target.checked; }) }), 'Name along the line'),
        h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: r.smooth !== false || null, onchange: e => setR(r, t => { t.smooth = e.target.checked; }) }), 'Smooth curve'),
        h('label', null, 'Notes (shown when it’s clicked)'), h('textarea', { rows: 3, value: r.notes || '', onchange: e => setR(r, t => { t.notes = e.target.value; }) }, r.notes || ''),
        h('label', null, 'Wiki page'), h('input', { type: 'text', list: 'mtPages', value: r.wiki || '', placeholder: 'A page about it', onchange: e => setR(r, t => { t.wiki = e.target.value.trim(); }) }), pageList(),
        h('p', { class: 'small muted' }, `${r.pts.length} points · ${miles ? distText(miles) : 'set the map scale with the ruler to see distances'}. Drag a point to move it, click + to add one, Alt-click to remove one.`),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn', title: 'Plot a fresh course by sea between its two ends', onclick: () => { const pts = plotSea(r.pts[0], r.pts[r.pts.length - 1]); if (pts) setR(r, t => { t.pts = pts; }); } }, 'Re-plot by sea'),
          h('button', { class: 'btn', onclick: () => setR(r, t => { t.pts.reverse(); }) }, 'Reverse'),
          h('button', { class: 'btn', onclick: () => { const b = r.pts[r.pts.length - 1]; map.fitBounds(L.latLngBounds(r.pts.map(p => toLatLng(p[0], p[1]))).pad(0.2)); void b; } }, 'Show it'),
          h('button', { class: 'btn danger', onclick: () => { ctx.change(() => { D().routes = routes().filter(x => x.id !== r.id); }); selRoute = null; drawRoutes(); } }, 'Delete')));
    }
    body.push(h('h2', null, `Routes · ${routes().length}`),
      routes().length ? h('div', { class: 'nlist' }, ...routes().map(x => h('div', { class: 'nrow' + (x.id === selRoute ? ' on' : ''), style: 'cursor:pointer', 'data-rid': x.id,
        onclick: () => { selRoute = x.id; selLabel = null; ctx.renderPanel(); drawRoutes(); map.fitBounds(L.latLngBounds(x.pts.map(p => toLatLng(p[0], p[1]))).pad(0.25)); } },
        h('span', { class: 'swatch', style: `background:${x.color || kindOf(x).color}` }), h('span', { class: 'rnm', style: 'flex:1' }, x.name || 'Unnamed ' + kindOf(x).label.toLowerCase()),
        h('span', { class: 'cnt' }, routeMiles(x) ? distText(routeMiles(x), true) : '')))) : h('p', { class: 'small muted' }, 'No routes yet.'));
    return ctx.panelShell('Routes', h('div', { class: 'form' }, ...body));
  }

  // Defaults for each kind: a change here is the kind's new default and applies to every name of that kind,
  // clearing what those names had set for it themselves, so they all match
  let editKind = 'sea';
  function kindDefaults() {
    const k = editKind, K = nameKind(k), mine = kindOver()[k] || {}, n = labels().filter(t => kindKey(t) === k).length;
    const setK = (key, val) => ctx.change(() => {
      const st = D().settings || (D().settings = {}); const all = st.nameKinds || (st.nameKinds = {}); const o = all[k] || (all[k] = {});
      if (key === 'minZoom' || key === 'maxZoom') { const z = (o.zoom || LKINDS[k].zoom).slice(); z[key === 'minZoom' ? 0 : 1] = val; o.zoom = z; }
      else o[key] = val;
      for (const t of labels()) if (kindKey(t) === k) delete t[key];
    }, {});
    const live = (key, val) => { kindPreview = { kind: k, key, val }; drawNames(); };
    const done = (key, val) => { kindPreview = null; setK(key, val); };
    const size = num(K.size, 200);
    const box = h('input', { type: 'number', min: 1, max: 5000, step: 0.5, value: size, style: 'width:80px', onchange: e => setK('size', clamp(+e.target.value || size, 1, 5000)) });
    const tick = (key, label) => h('label', { class: 'inline', style: 'margin-right:12px' }, h('input', { type: 'checkbox', checked: (key === 'halo' ? K.halo !== false : !!K[key]) || null, onchange: e => setK(key, e.target.checked) }), label);
    const changed = Object.keys(mine).length > 0;
    const det = h('details', { class: 'nkinds', open: kindsOpen || null, ontoggle: e => { kindsOpen = e.target.open; } },
      h('summary', null, 'Defaults for each kind'),
      h('div', { class: 'row' },
        h('div', null, h('label', null, 'Kind'), h('select', { onchange: e => { editKind = e.target.value; ctx.renderPanel(); } }, ...Object.entries(LKINDS).map(([kk, v]) => h('option', { value: kk, selected: kk === k || null }, v.label + (kindOver()[kk] ? ' •' : ''))))),
        h('div', null, h('label', null, 'Colour'), h('input', { type: 'color', value: K.color, onchange: e => setK('color', e.target.value) }))),
      h('p', { class: 'small muted' }, n ? `Changes here apply to all ${n} name${n === 1 ? '' : 's'} of this kind, replacing what they had set for that themselves.` : 'No names of this kind yet; new ones will start like this.'),
      h('label', null, 'Size (map pixels)'),
      h('div', { class: 'row', style: 'align-items:center;gap:8px' }, h('div', { style: 'flex:1' }, h('input', { type: 'range', min: 0, max: 1000, step: 1, value: sizeToPos(size),
        oninput: e => { const v = posToSize(+e.target.value); box.value = v; live('size', v); }, onchange: e => done('size', posToSize(+e.target.value)) })), box),
      h('label', null, 'Letter spacing'),
      h('input', { type: 'range', min: 0, max: 1.5, step: 0.02, value: num(K.spacing, 0.2), oninput: e => live('spacing', +e.target.value), onchange: e => done('spacing', +e.target.value) }),
      h('label', null, 'Strength'),
      h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: num(K.opacity, 0.8), oninput: e => live('opacity', +e.target.value), onchange: e => done('opacity', +e.target.value) }),
      h('div', { class: 'row', style: 'align-items:center' }, h('div', null, tick('caps', 'Capitals'), tick('italic', 'Italic')),
        h('div', null, h('label', null, 'Halo'), h('select', { onchange: e => setK('halo', e.target.value === 'dark' ? 'dark' : e.target.value === 'none' ? false : true) },
          h('option', { value: 'soft', selected: K.halo !== false && K.halo !== 'dark' || null }, 'Soft, pale'), h('option', { value: 'dark', selected: K.halo === 'dark' || null }, 'Dark (for pale letters)'), h('option', { value: 'none', selected: K.halo === false || null }, 'None')))),
      h('div', { class: 'row' },
        h('div', null, h('label', null, 'Shows from zoom'), h('input', { type: 'number', step: 0.25, value: Math.max(0, K.zoom[0]), onchange: e => setK('minZoom', e.target.value === '' ? LKINDS[k].zoom[0] : +e.target.value) })),
        h('div', null, h('label', null, 'Hides after zoom'), h('input', { type: 'number', step: 0.25, value: K.zoom[1], onchange: e => setK('maxZoom', e.target.value === '' ? LKINDS[k].zoom[1] : +e.target.value) }))),
      changed ? h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', title: 'The kind goes back to how it started; names keep their current look until you change the defaults again', onclick: () => ctx.change(() => {
        // the names keep looking as they do now: what they took from the kind becomes their own
        for (const t of labels()) if (kindKey(t) === k) for (const key of Object.keys(mine)) {
          if (key === 'zoom') { if (t.minZoom == null) t.minZoom = mine.zoom[0]; if (t.maxZoom == null) t.maxZoom = mine.zoom[1]; }
          else if (t[key] === undefined) t[key] = mine[key];
        }
        delete D().settings.nameKinds[k];
      }) }, 'Back to the built-in defaults')) : null);
    return det;
  }
  let kindsOpen = false;

  // several names picked with Ctrl+click: set any of their looks at once
  function groupControls(G) {
    const same = f => { const v = G.map(f); return v.every(x => x === v[0]) ? v[0] : undefined; };
    const kind = same(kindKey), color = same(t => lval(t, 'color')), size = same(t => num(lval(t, 'size'), 200));
    const spacing = same(t => num(lval(t, 'spacing'), 0.2)), opacity = same(t => num(lval(t, 'opacity'), 0.8));
    const tri = (key, label, get) => {
      const v = same(get);
      const cb = h('input', { type: 'checkbox', checked: v === true || null, onchange: e => setG(t => { t[key] = e.target.checked; }) });
      if (v === undefined) cb.indeterminate = true;
      return h('label', { class: 'inline', style: 'margin-right:12px' }, cb, label);
    };
    const box = h('input', { type: 'number', min: 1, max: 5000, step: 0.5, value: size ?? '', placeholder: 'mixed', style: 'width:80px', onchange: e => { if (e.target.value !== '') setG(t => { t.size = clamp(+e.target.value, 1, 5000); }); } });
    const zmin = same(t => t.minZoom ?? null), zmax = same(t => t.maxZoom ?? null);
    return [h('h2', null, `${G.length} names picked`),
      h('p', { class: 'small muted' }, G.map(t => t.text).join(', ')),
      h('div', { class: 'row' },
        h('div', null, h('label', null, 'Kind'), h('select', { onchange: e => { if (e.target.value) setG(t => changeKind(t, e.target.value), {}); } },
          kind === undefined ? h('option', { value: '', selected: true }, '— mixed —') : null,
          ...Object.entries(LKINDS).map(([k, v]) => h('option', { value: k, selected: k === kind || null }, v.label)))),
        h('div', null, h('label', null, 'Colour'), h('input', { type: 'color', value: color || '#2a2418', onchange: e => setG(t => { t.color = e.target.value; }) }))),
      h('label', null, 'Size (map pixels)' + (size === undefined ? ' · mixed' : '')),
      h('div', { class: 'row', style: 'align-items:center;gap:8px' }, h('div', { style: 'flex:1' }, h('input', { type: 'range', min: 0, max: 1000, step: 1, value: sizeToPos(size ?? 200),
        oninput: e => { const v = posToSize(+e.target.value); box.value = v; for (const t of G) t.size = v; drawNames(); }, onchange: e => { const v = posToSize(+e.target.value); setG(t => { t.size = v; }); } })), box),
      h('label', null, 'Letter spacing' + (spacing === undefined ? ' · mixed' : '')),
      h('input', { type: 'range', min: 0, max: 1.5, step: 0.02, value: spacing ?? 0.2, oninput: e => { for (const t of G) t.spacing = +e.target.value; drawNames(); }, onchange: e => setG(t => { t.spacing = +e.target.value; }) }),
      h('label', null, 'Strength' + (opacity === undefined ? ' · mixed' : '')),
      h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: opacity ?? 0.8, oninput: e => { for (const t of G) t.opacity = +e.target.value; drawNames(); }, onchange: e => setG(t => { t.opacity = +e.target.value; }) }),
      h('div', null, tri('caps', 'Capitals', t => !!lval(t, 'caps')), tri('italic', 'Italic', t => !!lval(t, 'italic')), tri('halo', 'Soft halo', t => lval(t, 'halo') !== false)),
      h('div', { class: 'row' },
        h('div', null, h('label', null, 'Shows from zoom'), h('input', { type: 'number', step: 0.25, value: zmin ?? '', placeholder: zmin === undefined ? 'mixed' : 'kind’s', onchange: e => setG(t => { if (e.target.value === '') delete t.minZoom; else t.minZoom = +e.target.value; }) })),
        h('div', null, h('label', null, 'Hides after zoom'), h('input', { type: 'number', step: 0.25, value: zmax ?? '', placeholder: zmax === undefined ? 'mixed' : 'kind’s', onchange: e => setG(t => { if (e.target.value === '') delete t.maxZoom; else t.maxZoom = +e.target.value; }) }))),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', title: 'Clear what these names set themselves, so they follow their kind’s defaults', onclick: () => setG(t => { for (const key of ['size', 'spacing', 'color', 'opacity', 'caps', 'italic', 'halo', 'minZoom', 'maxZoom']) delete t[key]; }, {}) }, 'Use their kinds’ defaults'),
        h('button', { class: 'btn', onclick: () => { selSet.clear(); ctx.renderPanel(); drawRoutes(); drawNames(); } }, 'Pick just one'),
        h('button', { class: 'btn danger', onclick: () => { const ids = new Set(selSet); ctx.change(() => { D().labels = labels().filter(x => !ids.has(x.id)); }); selSet.clear(); selLabel = null; drawRoutes(); } }, `Delete ${G.length}`)),
      h('p', { class: 'small muted' }, 'Ctrl+click a name to add it or take it out.')];
  }

  function namesPanel() {
    const lb = selLabel && labels().find(x => x.id === selLabel);
    let newKind = 'sea';
    const kinds = (val, on) => h('select', { onchange: e => on(e.target.value) }, ...Object.entries(LKINDS).map(([k, v]) => h('option', { value: k, selected: k === val || null }, v.label)));
    const body = [
      h('p', { class: 'small muted' }, 'Names for the water (oceans, seas, bays, lakes, rivers) and the land (mountain ranges, hills, forests, regions), in the map’s lettering along a curve. They grow and shrink with the zoom and appear only where they can be read. Drag the points to bend a name along a range or a river.'),
      h('div', { class: 'btnrow', style: 'margin-top:4px' },
        h('button', { class: 'btn primary' + (mode === 'label' ? ' on' : ''), onclick: () => setMode(mode === 'label' ? null : 'label', { kind: newKind }) }, mode === 'label' ? 'Click where it goes… (Esc)' : 'Add a name'),
        kinds(newKind, v => { newKind = v; if (mode === 'label') draft.kind = v; }))
    ];
    body.push(kindDefaults());
    const G = group();
    if (G) body.push(...groupControls(G));
    else if (lb) {
      const K = lkind(lb);
      body.push(h('h2', null, 'This name'),
        h('label', null, 'Name'), h('input', { id: 'lbText', type: 'text', value: lb.text, onchange: e => { setL(lb, t => { t.text = e.target.value.trim() || t.text; }); const row = document.querySelector(`[data-lid="${lb.id}"] .rnm`); if (row) row.textContent = e.target.value.trim(); } }),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Kind'), kinds(lb.kind, v => setL(lb, t => changeKind(t, v), {}))),
          h('div', null, h('label', null, 'Colour'), h('input', { type: 'color', value: lval(lb, 'color'), onchange: e => setL(lb, t => { t.color = e.target.value; }) }))),
        ...sizeControls(lb),
        h('label', null, 'Letter spacing'),
        h('input', { type: 'range', min: 0, max: 1.5, step: 0.02, value: num(lval(lb, 'spacing'), 0.2), oninput: e => { lb.spacing = +e.target.value; drawNames(); }, onchange: e => setL(lb, t => { t.spacing = +e.target.value; }) }),
        h('label', null, 'Strength'),
        h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: num(lval(lb, 'opacity'), 0.8), oninput: e => { lb.opacity = +e.target.value; drawNames(); }, onchange: e => setL(lb, t => { t.opacity = +e.target.value; }) }),
        h('div', null,
          h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!lval(lb, 'caps') || null, onchange: e => setL(lb, t => { t.caps = e.target.checked; }) }), 'Capitals'),
          h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: !!lval(lb, 'italic') || null, onchange: e => setL(lb, t => { t.italic = e.target.checked; }) }), 'Italic'),
          h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: lval(lb, 'halo') !== false || null, onchange: e => setL(lb, t => { t.halo = e.target.checked; }) }), 'Soft halo')),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Shows from zoom'), h('input', { type: 'number', step: 0.25, value: lb.minZoom ?? '', placeholder: String(Math.max(0, K.zoom[0])), onchange: e => setL(lb, t => { if (e.target.value === '') delete t.minZoom; else t.minZoom = +e.target.value; }) })),
          h('div', null, h('label', null, 'Hides after zoom'), h('input', { type: 'number', step: 0.25, value: lb.maxZoom ?? '', placeholder: String(K.zoom[1]), onchange: e => setL(lb, t => { if (e.target.value === '') delete t.maxZoom; else t.maxZoom = +e.target.value; }) }))),
        h('p', { class: 'small muted' }, `You are at zoom ${+map.getZoom().toFixed(2)}. Bend the name by dragging its points; click + to add one (a river name can follow the river), Alt-click to remove one.`),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn', onclick: () => setL(lb, t => { t.pts.reverse(); }) }, 'Flip the curve'),
          h('button', { class: 'btn', onclick: () => setL(lb, t => { const a = t.pts[0], b = t.pts[t.pts.length - 1]; t.pts = t.pts.map((p, i, arr) => { const f = i / (arr.length - 1); return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)]; }); }) }, 'Straighten'),
          h('button', { class: 'btn danger', onclick: () => { ctx.change(() => { D().labels = labels().filter(x => x.id !== lb.id); }); selLabel = null; drawRoutes(); } }, 'Delete')),
        h('p', { class: 'small muted' }, 'Ctrl+click other names, on the map or in the list, to change several at once.'));
    }
    body.push(h('h2', null, `Names · ${labels().length}`),
      labels().length ? h('div', { class: 'nlist' }, ...labels().slice().sort((a, b) => num(lval(b, 'size'), 0) - num(lval(a, 'size'), 0)).map(x => h('div', { class: 'nrow' + (picked(x.id) ? ' on' : ''), style: 'cursor:pointer', 'data-lid': x.id,
        onclick: e => { if (e.ctrlKey || e.metaKey) { pickName(x.id, true); selRoute = null; ctx.renderPanel(); drawRoutes(); return; } pickName(x.id, false); selRoute = null; ctx.renderPanel(); drawRoutes(); const c = x.pts[Math.floor(x.pts.length / 2)]; map.setView(toLatLng(c[0], c[1]), clamp(Math.max(lkind(x).zoom[0], map.getZoom()), map.getMinZoom(), lkind(x).zoom[1])); } },
        h('span', { class: 'rnm', style: 'flex:1;font-style:italic' }, x.text), h('span', { class: 'cnt' }, lkind(x).label)))) : h('p', { class: 'small muted' }, 'No names yet.'));
    // country names (and other name-only places) still kept as places: one click makes them map names like these
    if (ctx.textPlaces) {
      const tp = ctx.textPlaces(), byType = new Map();
      for (const m of tp) { const t = ctx.typeOf(m); if (!byType.has(t.id)) byType.set(t.id, { t, list: [] }); byType.get(t.id).list.push(m); }
      if (byType.size) body.unshift(h('div', { class: 'rivsel' },
        h('p', { class: 'small', style: 'margin-top:0' }, 'These are still kept as places, so they don’t bend along points or follow the defaults here. Make them map names (each keeps its spot, curve and size; Ctrl+Z puts them back):'),
        h('div', { class: 'btnrow' }, ...[...byType.values()].sort((a, b) => (b.t.id === 'country') - (a.t.id === 'country')).map(({ t, list }) =>
          h('button', { class: 'btn sm' + (t.id === 'country' ? ' primary' : ''), onclick: () => ctx.textToNames(list) }, `${t.label}s (${list.length})`)))));
    }
    body.push(...riverPanel());
    return ctx.panelShell('Names on the map', h('div', { class: 'form' }, ...body));
  }

  function settingsPanel() {
    const lk = look();
    // set one of this viewer's own values; live: as a slider moves (saved when it's let go)
    const setLook = (sec, key, val, live) => {
      mine.look[sec] = Object.assign({}, mine.look[sec] || {}, { [key]: val });
      if (!live) { saveMine(); ctx.renderPanel(); }
      applyLook();
    };
    const resetSec = sec => { delete mine.look[sec]; saveMine(); applyLook(); ctx.renderPanel(); };
    // the admin: what they see becomes everyone's default
    const publish = () => {
      const lk = look(), units = unitKey();
      ctx.change(() => { const st = D().settings; st.look = {}; for (const k of Object.keys(LOOK)) { const d = {}; for (const [kk, v] of Object.entries(lk[k])) if (JSON.stringify(v) !== JSON.stringify(LOOK[k][kk])) d[kk] = v; if (Object.keys(d).length) st.look[k] = d; } st.units = units; }, { panel: false });
      mine = { look: {} }; saveMine(); applyLook(); ctx.renderPanel(); toast('Saved: everyone now starts with these settings.');
    };
    const colour = (sec, key, label) => h('div', null, h('label', null, label), h('input', { type: 'color', value: lk[sec][key], oninput: e => setLook(sec, key, e.target.value, true), onchange: e => setLook(sec, key, e.target.value) }));
    const slider = (sec, key, label, min, max, step, fmt) => {
      const out = h('span', { class: 'val' }, fmt ? fmt(lk[sec][key]) : String(lk[sec][key]));
      return h('div', { class: 'sl' }, h('label', null, label, ' ', out), h('input', { type: 'range', min, max, step, value: lk[sec][key],
        oninput: e => { out.textContent = fmt ? fmt(+e.target.value) : e.target.value; setLook(sec, key, +e.target.value, true); }, onchange: e => setLook(sec, key, +e.target.value) }));
    };
    const tick = (sec, key, label) => h('label', { class: 'inline', style: 'margin-right:12px' }, h('input', { type: 'checkbox', checked: lk[sec][key] !== false || null, onchange: e => setLook(sec, key, e.target.checked) }), label);
    const pct = v => Math.round(v * 100) + '%', times = v => (+v).toFixed(2).replace(/\.?0+$/, '') + '×';
    const s = D().settings;
    return ctx.panelShell('Map settings', h('div', { class: 'form mtset' },
      h('p', { class: 'small muted' }, 'How the world map looks and behaves for you. Your choices are kept in this browser; everyone else keeps theirs.'),
      hasMine() ? h('div', { class: 'btnrow', style: 'margin-top:0' }, h('button', { class: 'btn sm', onclick: () => { mine = { look: {} }; saveMine(); applyLook(); ctx.renderPanel(); ctx.unitsChanged(); } }, 'Back to the default')) : null,
      ctx.canEdit ? h('div', { class: 'mtpub' }, h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Admin: what people see before they change anything.'),
        h('button', { class: 'btn primary sm', onclick: publish }, 'Make these everyone’s default')) : null,
      h('h2', null, 'The sea'),
      h('div', { class: 'row' }, colour('sea', 'shallow', 'Shallows'), colour('sea', 'mid', 'Open water'), colour('sea', 'deep', 'Deep water')),
      slider('sea', 'waves', 'Swell', 0, 2, 0.05, times), slider('sea', 'speed', 'Movement', 0, 2.5, 0.05, v => v ? times(v) : 'still'),
      h('div', null, tick('sea', 'ripples', 'Ripples along the shore'), tick('sea', 'foam', 'Surf'), tick('sea', 'glints', 'Glints')),
      ctx.canEdit && ctx.editMode() && ctx.setShelfBrush ? (() => {
        const br = ctx.shelfBrush(), on = m => br && br.mode === m;
        const pick = m => ctx.setShelfBrush(on(m) ? null : { mode: m });
        const sl = (key, label, min, max, step, val) => h('div', { class: 'sl' }, h('label', null, label), h('input', { type: 'range', min, max, step, value: val,
          oninput: e => { if (br) ctx.setShelfBrush({ [key]: +e.target.value }, true); } }));
        return h('div', { class: 'shelfbox' },
          h('label', null, 'How far out the shallows reach'),
          h('p', { class: 'small muted', style: 'margin:2px 0 6px' }, 'Pick a brush and drag over the sea along a coast: further out for a broad shelf or sandbanks, shorter for cliffs straight into the deep. Everyone sees it. Esc stops; Ctrl+Z undoes a stroke.'),
          h('div', { class: 'btnrow', style: 'margin-top:0' },
            h('button', { class: 'btn sm' + (on('wider') ? ' primary' : ''), onclick: () => pick('wider') }, 'Further out'),
            h('button', { class: 'btn sm' + (on('shorter') ? ' primary' : ''), onclick: () => pick('shorter') }, 'Shorter'),
            h('button', { class: 'btn sm' + (on('normal') ? ' primary' : ''), onclick: () => pick('normal') }, 'Back to usual'),
            ctx.shelfPainted() ? h('button', { class: 'btn sm', onclick: () => { if (confirm('Clear all the painted shallows?')) ctx.clearShelf(); } }, 'Clear all') : null),
          br ? h('div', { class: 'row' }, sl('size', 'Brush size', 150, 3000, 50, br.size), sl('strength', 'Strength', 0.1, 1.5, 0.05, br.strength)) : null);
      })() : null,
      h('div', { class: 'btnrow', style: 'margin-top:6px' }, h('button', { class: 'btn sm', onclick: () => resetSec('sea') }, 'Default sea')),
      h('h2', null, 'Rivers and lakes'),
      ctx.canEdit ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.freshwater !== false || null, onchange: e => { ctx.change(() => { D().settings.freshwater = e.target.checked; }, { panel: false }); toast('Reload the page to see the change.'); } }), 'Find rivers and lakes in the map’s transparency (for everyone)') : null,
      h('div', { class: 'row' }, colour('fresh', 'color', 'Colour'),
        !ctx.canEdit ? null : h('div', null, h('label', null, 'Widest river (map px)'), h('input', { type: 'number', min: 8, max: 400, step: 4, value: +s.freshwaterWidth || 48, title: 'Water narrower than this counts as river; wider is sea', onchange: e => { ctx.change(() => { D().settings.freshwaterWidth = +e.target.value; }, { panel: false }); toast('Reload the page to see the change.'); } }))),
      slider('fresh', 'flow', 'Flow', 0, 3, 0.05, v => v ? times(v) : 'still'),
      h('h2', null, 'Names and icons'),
      h('label', null, 'Lettering'),
      h('select', { onchange: e => setLook('labels', 'font', e.target.value) }, ...FONTS.map(([v, l]) => h('option', { value: v, selected: v === lk.labels.font || null }, l))),
      h('div', { class: 'row' }, slider('labels', 'size', 'Name size', 0.6, 2, 0.05, times), slider('icons', 'size', 'Icon size', 0.4, 2.5, 0.05, times)),
      h('div', { class: 'row' }, h('div', null, h('label', null, 'Name colour'), h('input', { type: 'color', value: lk.labels.color || '#1d1a16', onchange: e => setLook('labels', 'color', e.target.value) })),
        h('div', { style: 'align-self:end' }, h('button', { class: 'btn sm', onclick: () => setLook('labels', 'color', '') }, 'Default colour'))),
      h('div', null, tick('labels', 'halo', 'Pale halo behind names'), tick('icons', 'nightGlow', 'Settlements glow at night')),
      h('h2', null, 'Day and night'),
      slider('sky', 'night', 'How dark the night gets', 0, 1.2, 0.05, pct),
      h('h2', null, 'Life on the map'),
      h('div', null, tick('life', 'lights', 'Town lights at night'), tick('life', 'ships', 'Ships on the sea lanes'), tick('life', 'birds', 'Birds over the coasts')),
      h('div', null, tick('life', 'seasons', 'The seasons (snow in winter, brown late summer)'), tick('life', 'frame', 'Vignette, compass and scale bar')),
      h('div', null, tick('life', 'aurora', 'Northern lights on dark nights'), tick('life', 'smoke', 'Chimney smoke close in'), tick('life', 'titles', 'A nation’s name as you arrive')),
      lk.life.seasons !== false ? h('div', null, h('label', null, 'Where it’s coldest (besides each nation’s climate, Borders › Climate)'),
        h('select', { onchange: e => setLook('life', 'cold', e.target.value) }, ...[['north', 'The far north'], ['south', 'The far south'], ['both', 'Both ends of the world'], ['none', 'Only by climate']]
          .map(([v, l]) => h('option', { value: v, selected: (lk.life.cold || 'north') === v || null }, l)))) : null,
      h('h2', null, 'The view'),
      h('p', { class: 'small muted' }, lk.view.start ? `The map opens at zoom ${(+lk.view.start.z).toFixed(2)} over the point you chose.` : 'The map opens showing the whole world.'),
      h('div', { class: 'btnrow', style: 'margin-top:0' },
        h('button', { class: 'btn', onclick: () => { const c = toPixel(map.getCenter()); setLook('view', 'start', { x: Math.round(c.x), y: Math.round(c.y), z: +map.getZoom().toFixed(2) }); ctx.renderPanel(); toast('The map will open here.'); } }, 'Open the map here'),
        lk.view.start ? h('button', { class: 'btn', onclick: () => { setLook('view', 'start', null); ctx.renderPanel(); } }, 'Show the whole world') : null),
      slider('view', 'zoomOut', 'Zoom out past the whole map', 0, 2, 0.25, v => v ? `${v} level${v === 1 ? '' : 's'}` : 'no'),
      slider('view', 'pan', 'Drag past the edges', 0, 0.6, 0.05, pct),
      h('h2', null, 'Distances'),
      h('select', { onchange: e => { mine.units = e.target.value; saveMine(); ctx.unitsChanged(); ctx.renderPanel(); } },
        ...Object.entries(UNITS).map(([k, v]) => h('option', { value: k, selected: unitKey() === k || null }, v[1][0].toUpperCase() + v[1].slice(1)))),
      ctx.canEdit ? h('p', { class: 'small muted' }, 'The scale and travel paces are set in the ruler (R) while editing.') : null));
  }

  function panel(m) { return m === 'routes' ? routesPanel() : m === 'names' ? namesPanel() : m === 'settings' ? settingsPanel() : null; }
  function sync() {
    if (selRoute && !routes().some(r => r.id === selRoute)) selRoute = null;
    if (selLabel && !labels().some(l => l.id === selLabel)) selLabel = null;
    for (const id of [...selSet]) if (!labels().some(l => l.id === id)) selSet.delete(id);
    if (selSet.size === 1) selSet.clear();
    seaGrid = Land.ready ? seaGrid : null;
    drawRoutes();
    if (net && (!!rivLayer.getLayers().length) !== (riverOn && ctx.editMode())) drawRivers(); else showHi();
  }
  function panelClosed() { selRoute = selLabel = null; selSet.clear(); kindPreview = null; riverSel = riverHi = -1; showHi(); if (mode) setMode(null); drawRoutes(); }

  applyLook();
  drawRoutes();
  return { seaPath: (a, b) => plotSea(a, b, true), selectName: id => { selSet.clear(); selLabel = id; selRoute = null; ctx.openPanel('names', true); drawRoutes(); drawNames(); }, sync, applyLook, panel, busy, look, clickAt: (ll, place) => mapClick(ll, place), distText, unit, panelClosed, landChanged: () => { seaGrid = null; }, setRivers, rivers: () => net, nameKind };
};
