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
  let selRoute = null, selLabel = null, mode = null, draft = null;   // mode: 'route' (drawing), 'plot' (two clicks), 'label' (placing)

  function drawRoutes() {
    routeLayer.clearLayers();
    const z = map.getZoom();
    for (const r of routes()) {
      if (!r.pts || r.pts.length < 2) continue;
      if (!ctx.editMode() && r.minZoom != null && z < r.minZoom) continue;
      const k = kindOf(r), ll = routePath(r).map(p => toLatLng(p[0], p[1]));
      const w = num(r.width, k.width), col = r.color || k.color, dash = DASH[r.dash || k.dash];
      const sel = selRoute === r.id && ctx.editMode();
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: '#10181a', opacity: sel ? 0.6 : 0.32, weight: w + 3, lineCap: 'round', lineJoin: 'round' }));
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: sel ? '#ffd27a' : col, opacity: 0.95, weight: w, dashArray: dash, lineCap: 'round', lineJoin: 'round' }));
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
  function drawRouteLive() { if (!liveT) liveT = requestAnimationFrame(() => { liveT = 0; drawRouteLines(); drawNames(); }); }
  function drawRouteLines() {
    routeLayer.clearLayers();
    for (const r of routes()) {
      if (!r.pts || r.pts.length < 2) continue;
      const k = kindOf(r), ll = routePath(r).map(p => toLatLng(p[0], p[1])), w = num(r.width, k.width), sel = selRoute === r.id;
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: '#10181a', opacity: 0.5, weight: w + 3 }));
      routeLayer.addLayer(L.polyline(ll, { pane: 'routes', interactive: false, color: sel ? '#ffd27a' : (r.color || k.color), weight: w, dashArray: DASH[r.dash || k.dash] }));
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
  const lkind = lb => LKINDS[lb.kind] || LKINDS.other;
  const lval = (lb, k) => (lb[k] === undefined || lb[k] === null || lb[k] === '' ? lkind(lb)[k] : lb[k]);
  map.createPane('names').style.zIndex = 395;
  const namesPane = map.getPane('names');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'namesvg');
  namesPane.append(svg);
  let zooming = false;
  map.on('zoomstart', () => { zooming = true; svg.style.visibility = 'hidden'; });
  map.on('zoomend', () => { zooming = false; svg.style.visibility = ''; drawNames(); drawRoutes(); });
  map.on('moveend resize', () => drawNames());
  map.on('move', () => { if (!zooming) placeSvg(); });
  let svgOrigin = null;
  function placeSvg() {
    const s = map.getSize(), tl = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(svg, tl);
    svg.setAttribute('width', s.x); svg.setAttribute('height', s.y);
    // drawn in layer coordinates relative to the top left when last drawn; panning just moves the svg
    if (svgOrigin) svg.setAttribute('viewBox', `${tl.x - svgOrigin.x} ${tl.y - svgOrigin.y} ${s.x} ${s.y}`);
    return tl;
  }
  const curveD = (pts, close) => {
    if (pts.length < 3) return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    const sp = smooth(pts, 14);
    return 'M' + sp.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + (close ? 'Z' : '');
  };
  let drawT = 0;
  function drawNames() { if (!drawT) drawT = requestAnimationFrame(() => { drawT = 0; renderNames(); }); }
  function renderNames() {
    if (zooming) return;
    const tl = placeSvg(); svgOrigin = tl; svg.setAttribute('viewBox', `0 0 ${map.getSize().x} ${map.getSize().y}`);
    while (svg.firstChild) svg.firstChild.remove();
    const z = map.getZoom(), k = Math.pow(2, z - NATIVE), editing = ctx.editMode();
    const lk = look(), fontStack = lk.labels.font || getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'Georgia, serif';
    const toScr = p => { const c = map.latLngToContainerPoint(toLatLng(p[0], p[1])); return [c.x, c.y]; };
    const defs = document.createElementNS(SVGNS, 'defs'); svg.append(defs);
    let n = 0;
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
      // a name longer than its curve would be cut off: carry the curve on past both ends until it fits
      try {
        const need = t.getComputedTextLength(), have = path.getTotalLength();
        if (need > have * 0.96) {
          const ext = (need - have * 0.96) / 2 + o.size * 0.6;
          const a = sp[0], a2 = sp[1], b = sp[sp.length - 1], b2 = sp[sp.length - 2];
          const da = Math.hypot(a[0] - a2[0], a[1] - a2[1]) || 1, db = Math.hypot(b[0] - b2[0], b[1] - b2[1]) || 1;
          const sp2 = [[a[0] + (a[0] - a2[0]) / da * ext, a[1] + (a[1] - a2[1]) / da * ext], ...sp, [b[0] + (b[0] - b2[0]) / db * ext, b[1] + (b[1] - b2[1]) / db * ext]];
          path.setAttribute('d', curveD(sp2));
        }
      } catch (e) { /* not laid out */ }
      return t;
    };
    for (const lb of labels()) {
      const size = num(lval(lb, 'size'), 200) * k * clamp(num(lk.labels.size, 1), 0.5, 2.5);
      const zr = [num(lb.minZoom, lkind(lb).zoom[0]), num(lb.maxZoom, lkind(lb).zoom[1])];
      const visible = size >= 7 && size <= 130 && z >= zr[0] && z <= zr[1];   // too small or too big to read: not shown
      if (!visible && !(editing && selLabel === lb.id)) continue;
      const t = put(lb.pts, lb.text, { size: clamp(size, 7, 130), spacing: num(lval(lb, 'spacing'), 0.2), italic: !!lval(lb, 'italic'), caps: !!lval(lb, 'caps'),
        color: lval(lb, 'color'), opacity: num(lval(lb, 'opacity'), 0.8) * (visible ? 1 : 0.4), halo: lb.halo === false || look().labels.halo === false ? null : '#f2ecd9', haloOpacity: 0.35, weight: lb.kind === 'ocean' || lb.kind === 'sea' ? 500 : 600,
        cls: (editing ? 'edit' : '') + (selLabel === lb.id && editing ? ' sel' : '') });
      if (t && editing) t.addEventListener('click', e => { e.stopPropagation(); if (mode) return mapClick(map.mouseEventToLatLng(e)); selLabel = lb.id; selRoute = null; ctx.openPanel('names', true); drawRoutes(); });
    }
    // routes' names along their lines
    for (const r of routes()) {
      if (!r.name || r.showName === false || !r.pts || r.pts.length < 2) continue;
      if (!editing && r.minZoom != null && z < r.minZoom) continue;
      const fs = clamp(13 * Math.pow(2, (z - (NATIVE - 3)) * 0.35), 9, 17);
      put(routePath(r).length > 2 ? routePath(r).filter((_, i, a) => i % 4 === 0 || i === a.length - 1) : r.pts, r.name,
        { size: fs, spacing: 0.08, italic: true, caps: false, color: '#f6f1e2', opacity: 0.95, halo: '#14202a', haloOpacity: 0.65, dy: -Math.round(fs * 0.55), weight: 600 });
    }
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
    document.body.classList.toggle('mt-drawing', !!m);
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
      const kind = draft.kind || 'sea', K = LKINDS[kind] || LKINDS.other;
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

  // ───────────────────────── panels ─────────────────────────
  const setR = (r, fn, opts) => ctx.change(() => { const t = routes().find(x => x.id === r.id); if (t) fn(t); }, opts || { panel: false });
  const setL = (lb, fn, opts) => ctx.change(() => { const t = labels().find(x => x.id === lb.id); if (t) fn(t); }, opts || { panel: false });
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
    if (lb) {
      const K = lkind(lb);
      body.push(h('h2', null, 'This name'),
        h('label', null, 'Name'), h('input', { id: 'lbText', type: 'text', value: lb.text, onchange: e => { setL(lb, t => { t.text = e.target.value.trim() || t.text; }); const row = document.querySelector(`[data-lid="${lb.id}"] .rnm`); if (row) row.textContent = e.target.value.trim(); } }),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Kind'), kinds(lb.kind, v => setL(lb, t => { t.kind = v; for (const key of ['size', 'spacing', 'color', 'opacity', 'caps', 'italic', 'minZoom', 'maxZoom']) delete t[key]; }, {}))),
          h('div', null, h('label', null, 'Colour'), h('input', { type: 'color', value: lval(lb, 'color'), onchange: e => setL(lb, t => { t.color = e.target.value; }) }))),
        ...sizeControls(lb),
        h('label', null, 'Letter spacing'),
        h('input', { type: 'range', min: 0, max: 1.5, step: 0.02, value: num(lval(lb, 'spacing'), 0.2), oninput: e => { lb.spacing = +e.target.value; drawNames(); }, onchange: e => setL(lb, t => { t.spacing = +e.target.value; }) }),
        h('label', null, 'Strength'),
        h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: num(lval(lb, 'opacity'), 0.8), oninput: e => { lb.opacity = +e.target.value; drawNames(); }, onchange: e => setL(lb, t => { t.opacity = +e.target.value; }) }),
        h('div', null,
          h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!lval(lb, 'caps') || null, onchange: e => setL(lb, t => { t.caps = e.target.checked; }) }), 'Capitals'),
          h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: !!lval(lb, 'italic') || null, onchange: e => setL(lb, t => { t.italic = e.target.checked; }) }), 'Italic'),
          h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: lb.halo !== false || null, onchange: e => setL(lb, t => { t.halo = e.target.checked; }) }), 'Soft halo')),
        h('div', { class: 'row' },
          h('div', null, h('label', null, 'Shows from zoom'), h('input', { type: 'number', step: 0.25, value: lb.minZoom ?? '', placeholder: String(Math.max(0, K.zoom[0])), onchange: e => setL(lb, t => { if (e.target.value === '') delete t.minZoom; else t.minZoom = +e.target.value; }) })),
          h('div', null, h('label', null, 'Hides after zoom'), h('input', { type: 'number', step: 0.25, value: lb.maxZoom ?? '', placeholder: String(K.zoom[1]), onchange: e => setL(lb, t => { if (e.target.value === '') delete t.maxZoom; else t.maxZoom = +e.target.value; }) }))),
        h('p', { class: 'small muted' }, `You are at zoom ${+map.getZoom().toFixed(2)}. Bend the name by dragging its points; click + to add one (a river name can follow the river), Alt-click to remove one.`),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn', onclick: () => setL(lb, t => { t.pts.reverse(); }) }, 'Flip the curve'),
          h('button', { class: 'btn', onclick: () => setL(lb, t => { const a = t.pts[0], b = t.pts[t.pts.length - 1]; t.pts = t.pts.map((p, i, arr) => { const f = i / (arr.length - 1); return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)]; }); }) }, 'Straighten'),
          h('button', { class: 'btn danger', onclick: () => { ctx.change(() => { D().labels = labels().filter(x => x.id !== lb.id); }); selLabel = null; drawRoutes(); } }, 'Delete')));
    }
    body.push(h('h2', null, `Names · ${labels().length}`),
      labels().length ? h('div', { class: 'nlist' }, ...labels().slice().sort((a, b) => num(lval(b, 'size'), 0) - num(lval(a, 'size'), 0)).map(x => h('div', { class: 'nrow' + (x.id === selLabel ? ' on' : ''), style: 'cursor:pointer', 'data-lid': x.id,
        onclick: () => { selLabel = x.id; selRoute = null; ctx.renderPanel(); drawRoutes(); const c = x.pts[Math.floor(x.pts.length / 2)]; map.setView(toLatLng(c[0], c[1]), clamp(Math.max(lkind(x).zoom[0], map.getZoom()), map.getMinZoom(), lkind(x).zoom[1])); } },
        h('span', { class: 'rnm', style: 'flex:1;font-style:italic' }, x.text), h('span', { class: 'cnt' }, lkind(x).label)))) : h('p', { class: 'small muted' }, 'No names yet.'));
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
    seaGrid = Land.ready ? seaGrid : null;
    drawRoutes();
  }
  function panelClosed() { selRoute = selLabel = null; if (mode) setMode(null); drawRoutes(); }

  applyLook();
  drawRoutes();
  return { seaPath: (a, b) => plotSea(a, b, true), sync, applyLook, panel, busy, look, clickAt: (ll, place) => mapClick(ll, place), distText, unit, panelClosed, landChanged: () => { seaGrid = null; } };
};
