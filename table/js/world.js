/* The world map inside the table, and the site (map, wiki, admin, calendar) without leaving it.
 *
 * A world map scene is a scene of the table like any other (the GM can move the players onto it; a campaign can have
 * several): the main world map, or a version of it made for the campaign's time (scene.atlas: its own places, borders
 * and names, perhaps its own picture). It's drawn by the map-viewer page in a frame (?embed&scene: none of the site's
 * own tools), with the table's tools down the left: select and move tokens, the ruler, and for the GM the fog of war,
 * which looks like cloud. Players see only what the GM has revealed, and the view keeps to it.
 *
 * The Map, Wiki and Admin buttons show the site itself, in a second frame over the table (the side bar is put away
 * while you look, and comes back when you return). */
'use strict';
(function () {
const { $, h, state, on } = V;
let local = null, sideWasOpen = null;   // local: 'map' | 'wiki' | 'library' | 'observatory' | 'calendar' | 'admin' | null (the table)
const sceneIsWorld = () => !!(state.scene && state.scene.meta.kind === 'world');
const worldScene = () => !local && sceneIsWorld();

// ───────── the two frames ─────────
// scene: the world map scene's version of the map, in scene mode. site: the site as it is (main map, wiki, admin).
const F = { scene: null, site: null };
const sceneSrc = atlas => '/index.html?embed=1&scene=1' + (atlas ? '&atlas=' + encodeURIComponent(atlas) : '') + '#/map';
const siteSrc = want => '/index.html?embed=1' + (want || '#/map');
const tabOf = hash => /^#\/(library|wiki\/Special:(Bookshelf|Book)\b)/.test(hash) ? 'library' : /^#\/(observatory|wiki\/Special:Constellation\b)/.test(hash) ? 'observatory'
  : /^#\/(wiki|files)/.test(hash) ? 'wiki' : /^#\/admin/.test(hash) ? 'admin' : /^#\/calendar/.test(hash) ? 'calendar' : /^#\/map|^$|^#$/.test(hash) ? 'map' : null;
function makeFrame(kind, src) {
  const f = h('iframe', { id: kind === 'scene' ? 'worldFrame' : 'siteFrame', class: 'vttframe', title: kind === 'scene' ? 'World map' : 'The site', src });
  f._fresh = true; f._ready = false;
  f.addEventListener('load', () => {
    f._fresh = false; setTimeout(() => pushClock(f), 300);
    // following a link inside the site (from the wiki to the Library, say) lights up that tab here too
    if (kind === 'site') try { f.contentWindow.addEventListener('hashchange', () => { const t = tabOf(f.contentWindow.location.hash); if (local && t && t !== local && local !== 'calendar') { local = t; update(); } }); } catch (e) { /* not ours */ }
  });
  $('#stage').append(f);
  return f;
}
// the map's sky follows the campaign's clock (pushed in; the page doesn't fetch the site's)
// The site frame: the calendar opened from the table shows the campaign's date; the site's Map shows the world's own.
function pushClock(f) {
  try {
    const a = f && f.contentWindow.VALANAR; if (!a || !a.setCalendar || !state.calendar) return;
    if (f === F.scene || (f === F.site && local === 'calendar')) a.setCalendar(state.calendar);
    else if (f === F.site && a.siteClock) a.siteClock();
  } catch (e) { /* not loaded */ }
}
on('time', () => { pushClock(F.scene); if (local === 'calendar') pushClock(F.site); });
const apiOf = f => { try { return f && f._ready && f.contentWindow && f.contentWindow.VALANAR; } catch (e) { return null; } };
const LOf = f => { try { return f.contentWindow.L; } catch (e) { return null; } };
const sceneA = () => apiOf(F.scene);
const sceneL = () => LOf(F.scene);

function update() {
  const ws = worldScene();
  // the world map scene's frame, on the version of the map the scene shows
  if (ws) {
    const atlas = state.scene.meta.atlas || '';
    if (!F.scene) { F.scene = makeFrame('scene', sceneSrc(atlas)); F.scene._atlas = atlas; }
    else if (F.scene._atlas !== atlas) { resetScene(); F.scene._atlas = atlas; F.scene._fresh = true; F.scene.src = sceneSrc(atlas); }
  }
  if (F.scene) F.scene.hidden = !ws;
  // the site
  if (local) {
    const want = local === 'map' ? '#/map' : '#/' + local;   // #/wiki, #/library, #/observatory, #/admin, #/calendar
    if (!F.site) F.site = makeFrame('site', siteSrc(want));
    else if (F.site._fresh) { /* still loading: it goes there when it's ready (reloading would only start it over) */ }
    else try {
      const cur = F.site.contentWindow.location.hash || '';
      const ok = local === 'wiki' ? /^#\/(wiki|files)/.test(cur) && !/^#\/wiki\/Special:(Bookshelf|Book|Constellation)\b/.test(cur)
        : local === 'library' ? /^#\/(library|wiki\/Special:(Bookshelf|Book)\b)/.test(cur)
        : local === 'observatory' ? /^#\/(observatory|wiki\/Special:Constellation\b)/.test(cur)
        : local === 'map' ? /^#\/map/.test(cur) || cur === '' : cur === want;
      if (!ok) F.site.contentWindow.location.hash = want;
    } catch (e) { F.site.src = siteSrc(want); }
  }
  if (F.site) {
    if (local) F.site.classList.remove('warming');
    F.site.hidden = !local && !F.site.classList.contains('warming');
  }
  if (local && F.site && F.site._ready) { pushClock(F.site); healSite(); }
  document.body.classList.toggle('worldview', !!local || ws);   // a frame covers the battle map
  document.body.classList.toggle('siteview', !!local);
  document.body.classList.toggle('worldscene', ws);
  // the side bar goes away while you look at the site, and comes back when you return to the table
  if (local && sideWasOpen === null) { sideWasOpen = !document.body.classList.contains('side-closed'); document.body.classList.add('side-closed'); }
  if (!local && sideWasOpen !== null) { if (sideWasOpen) document.body.classList.remove('side-closed'); sideWasOpen = null; }
  V.emit('worldview', !!local || ws);
  for (const b of V.$$('#views [data-view]')) b.classList.toggle('on', local ? b.dataset.view === local : b.dataset.view === 'table');
  setupTools(ws);
  renderEditSwitch();
  drawTokens(); drawFog(); restrictView();
}
// the site's map, shown again: make sure it knows its size (a map started out of sight can think it has none)
function healSite() {
  const f = F.site;
  requestAnimationFrame(() => {
    try {
      const w = f.contentWindow, m = w.VALANAR && w.VALANAR.map; if (!m || f.hidden) return;
      m.invalidateSize({ pan: false });
      const z = m.getZoom(), c = m.getCenter();
      if (!isFinite(z) || !c || !isFinite(c.lat) || !isFinite(c.lng) || m.getSize().x === 0) { f._fresh = true; f._ready = false; f.src = siteSrc(local === 'map' ? '#/map' : '#/' + local); }
    } catch (e) { /* not loaded yet */ }
  });
}
function resetScene() { if (F.scene) F.scene._ready = false; layer = null; markers = new Map(); fogLayer = null; viewKey = ''; }

// ───────── the table's tools on a world map scene ─────────
// select (pan, move tokens), the ruler (the map's own, with travel times), and the GM's fog of war; undo, redo, fit.
const WORLD_TOOLS = ['select', 'ruler', 'fog', 'journey'];
const baseSetTool = V.setTool, baseFit = V.fit;
V.setTool = tool => { if (worldScene() && !WORLD_TOOLS.includes(tool)) return; baseSetTool(tool); };
V.fit = () => { if (worldScene()) fitView(true); else baseFit(); };
function setupTools(ws) {
  if (ws) {
    V.toolHandlers.fog = fogHandler; V.toolHandlers.journey = journeyHandler;
    if (!WORLD_TOOLS.includes(state.tool)) baseSetTool('select'); else applyTool();
  } else if (V.toolHandlers.fog === fogHandler) { delete V.toolHandlers.fog; delete V.toolHandlers.journey; setFogTool(null); jAdding = false; if (state.tool === 'journey') baseSetTool('select'); }
  if (V.renderSubtools) V.renderSubtools();
  if (V.hud) V.hud();
}
on('tool', () => applyTool());
function applyTool() {
  const A = sceneA(); if (!A || !worldScene()) return;
  if (A.setRuler) A.setRuler(state.tool === 'ruler');
  setFogTool(state.tool === 'fog' && V.isGM() ? (fogShape || 'rect') : null);
  if (state.tool !== 'journey') jAdding = false;
  A.map.getContainer().style.cursor = state.tool === 'fog' && V.isGM() ? 'crosshair' : jAdding ? 'copy' : '';
}

// ───────── the party on the world map ─────────
// Tokens of the world map scene sit on the Leaflet map (in the frame); their x, y are pixels of the full-size map.
let layer = null, markers = new Map();
function styleFrame(doc) {
  if (!doc || doc.getElementById('vttTokStyle')) return;
  const st = doc.createElement('style'); st.id = 'vttTokStyle';
  st.textContent = `
    .vtt-tok { width: 44px !important; height: 44px !important; margin: -22px 0 0 -22px !important; }
    .vtt-tok .pic { width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--c, #c9a45c); background: #1b2028 center / cover no-repeat;
      box-shadow: 0 2px 8px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; color: #e8e2d0; font: 700 14px Georgia, serif; }
    .vtt-tok.gm .pic { opacity: 0.55; border-style: dashed; }
    .vtt-tok .nm { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); white-space: nowrap; font: 700 12px Georgia, serif; color: #fff;
      text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 6px #000; pointer-events: none; }
    .vtt-tok.leaflet-drag-target .pic { box-shadow: 0 0 0 3px rgba(201,164,92,0.6), 0 4px 14px rgba(0,0,0,0.7); }
    body.vtt-dropping #map { outline: 3px dashed #c9a45c; outline-offset: -3px; }`;
  doc.head.append(st);
}
function drawTokens() {
  const A = sceneA(), L = sceneL();
  if (!A || !L) return;
  styleFrame(F.scene.contentDocument);
  ensurePanes(A.map);
  if (!layer) layer = L.layerGroup().addTo(A.map);
  const toks = worldScene() ? [...state.scene.tokens.values()] : [];
  const seen = new Set();
  for (const t of toks) {
    seen.add(t.id);
    const owner = (t.owners || []).map(V.member).filter(Boolean)[0];
    const html = `<div class="pic" style="--c:${owner ? owner.color : t.color || '#c9a45c'};${t.img ? `background-image:url('${String(t.img).replace(/['"()\\]/g, encodeURIComponent)}')` : `background-color:${t.color || '#555'}`}">${t.img ? '' : V.initials(t.name)}</div>${t.nameShown !== false || V.canControl(t) ? `<div class="nm">${String(t.name).replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c])}</div>` : ''}`;
    const sig = html + (t.layer || '') + V.canControl(t);
    let mk = markers.get(t.id);
    if (mk && mk._sig !== sig) { layer.removeLayer(mk); mk = null; }
    if (!mk) {
      mk = L.marker(A.toLatLng(t.x, t.y), { pane: 'vtttok', icon: L.divIcon({ className: 'vtt-tok' + (t.layer === 'gm' ? ' gm' : ''), html, iconSize: [44, 44] }), draggable: V.canControl(t), keyboard: false, zIndexOffset: 5000, title: t.name });
      mk._sig = sig; mk._tid = t.id;
      // dragging by hand measures the trip with the map's ruler (distance and travel times)
      const at = ll => { const p = A.toPixel(ll); return [p.x, p.y]; };
      mk.on('dragstart', () => { mk._from = at(mk.getLatLng()); });
      mk.on('drag', () => { if (mk._from && A.dragRuler) A.dragRuler(mk._from, at(mk.getLatLng())); });
      mk.on('dragend', () => { if (mk._from && A.dragRuler) A.dragRuler(mk._from, at(mk.getLatLng()), true); mk._from = null; });
      mk.on('dragend', () => { const p = A.toPixel(mk.getLatLng()); V.op({ t: 'token.update', scene: state.scene.id, id: mk._tid, patch: { x: Math.round(p.x), y: Math.round(p.y) } }).catch(() => drawTokens()); });
      mk.on('dblclick', e => { L.DomEvent.stop(e); V.tokenOpen(mk._tid); });
      mk.on('contextmenu', e => { L.DomEvent.stop(e); const fr = F.scene.getBoundingClientRect(), ir = (mk._icon.querySelector('.pic') || mk._icon).getBoundingClientRect(); V.tokenMenu(mk._tid, { left: fr.left + ir.left, top: fr.top + ir.top, width: ir.width, height: ir.height }, { world: true }); });
      mk.on('mousedown', () => V.closeTokenMenu && V.closeTokenMenu());
      markers.set(t.id, mk); layer.addLayer(mk);
    } else if (!mk.dragging || !mk.dragging._draggable || !mk.dragging._draggable._moving) mk.setLatLng(A.toLatLng(t.x, t.y));
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { layer.removeLayer(mk); markers.delete(id); }
}
// a character dragged from the Journal onto the world map: a token for it there (GM)
function hookDrops() {
  const doc = F.scene.contentDocument; if (!doc || doc._vttDrops) return;
  doc._vttDrops = true;
  const ok = e => V.isGM() && worldScene() && e.dataTransfer && [...e.dataTransfer.types].includes(V.charDragType);
  doc.addEventListener('dragover', e => { if (ok(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; doc.body.classList.add('vtt-dropping'); } });
  doc.addEventListener('dragleave', e => { if (!e.relatedTarget) doc.body.classList.remove('vtt-dropping'); });
  doc.addEventListener('drop', e => {
    doc.body.classList.remove('vtt-dropping');
    if (!ok(e)) return;
    e.preventDefault();
    const cid = e.dataTransfer.getData(V.charDragType), ch = (state.camp.characters || []).find(x => x.id === cid); if (!ch) return;
    const A = sceneA(), p = A.toPixel(A.map.mouseEventToLatLng(e));
    V.charTokenImg(ch).then(img => V.op({ t: 'token.create', scene: state.scene.id, token: { name: ch.name, sheet: ch.id, img: img || null, x: Math.round(p.x), y: Math.round(p.y), size: 1, layer: 'tokens' } }));
  });
}
on('tokens', drawTokens); on('meta', drawTokens);

// ───────── fog of war on a world map scene: cloud ─────────
// The scene's fog shapes (in pixels of the map picture, as on a battle map) drawn on the map in the frame as a bank of
// cloud: thick and opaque for players where nothing's revealed, with billowing edges that drift slowly; thinner for
// the GM, who sees through it. Places under it are hidden from players too.
let fogLayer = null;
function ensurePanes(m) {
  if (!m.getPane('vttfog')) { const p = m.createPane('vttfog'); p.style.zIndex = 640; p.style.pointerEvents = 'none'; }
  if (!m.getPane('vtttok')) { const p = m.createPane('vtttok'); p.style.zIndex = 660; }
  if (!m.getPane('vttdraft')) { const p = m.createPane('vttdraft'); p.style.zIndex = 670; p.style.pointerEvents = 'none'; }
}
// smooth value noise that tiles (period P cells), for the clouds' texture and their billowing edges
function tileNoise(P, seed) {
  const g = new Float32Array(P * P); let s = seed;
  for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; }
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    const a = (i, j) => g[(((j % P) + P) % P) * P + (((i % P) + P) % P)];
    return (a(x0, y0) * (1 - u) + a(x0 + 1, y0) * u) * (1 - w) + (a(x0, y0 + 1) * (1 - u) + a(x0 + 1, y0 + 1) * u) * w;
  };
}
// fractal noise with period 1 (x, y in 0..1 repeat)
function fbmTile(seed) {
  const o = [tileNoise(4, seed), tileNoise(8, seed + 11), tileNoise(16, seed + 23), tileNoise(32, seed + 37)];
  return (x, y) => o[0](x * 4, y * 4) * 0.48 + o[1](x * 8, y * 8) * 0.28 + o[2](x * 16, y * 16) * 0.16 + o[3](x * 32, y * 32) * 0.08;
}
// the cloud itself: a tile of soft grey-blue puffs, lighter on top and darker in the hollows (made once)
let CLOUD = null;
function cloudTexture() {
  if (CLOUD) return CLOUD;
  const N = 256, n1 = fbmTile(7), n2 = fbmTile(91);
  const raw = document.createElement('canvas'); raw.width = raw.height = N;
  const g = raw.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = n1(x / N, y / N), b = n2(x / N, y / N), up = n1(x / N, (y - 6) / N);
    const lit = 0.82 + (a - 0.5) * 0.7 + (b - 0.5) * 0.2 + (a - up) * 1.6;   // puffs lit from above, shadowed beneath
    const i = (y * N + x) * 4;
    d[i] = Math.min(255, 196 * lit + 20); d[i + 1] = Math.min(255, 201 * lit + 20); d[i + 2] = Math.min(255, 210 * lit + 24); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // softened a touch (drawn 3 x 3 so the blur wraps round the edges and the tile still repeats)
  const big = document.createElement('canvas'); big.width = big.height = N * 3;
  const bg = big.getContext('2d'); for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) bg.drawImage(raw, i * N, j * N);
  const c = document.createElement('canvas'); c.width = c.height = N;
  const cg = c.getContext('2d'); cg.filter = 'blur(2px)'; cg.drawImage(big, -N, -N);
  CLOUD = { c, edge: fbmTile(301) };
  return CLOUD;
}
function makeFogLayer(L, A) {
  const RES = 6;   // where the fog's edge falls is worked out at 1/6 of the screen's resolution and drawn smoothly
  const FogLayer = L.Layer.extend({
    onAdd(m) {
      ensurePanes(m);
      this._c = L.DomUtil.create('canvas', 'vtt-fog leaflet-zoom-animated', m.getPane('vttfog'));
      this._mask = document.createElement('canvas'); this._alpha = document.createElement('canvas');
      m.on('moveend resize viewreset', this._reset, this); m.on('zoomanim', this._anim, this);
      this._reset();
      this._iv = setInterval(() => { if (F.scene && !F.scene.hidden && !document.hidden) this.draw(true); }, 120);   // the cloud drifts
    },
    onRemove(m) { clearInterval(this._iv); m.off('moveend resize viewreset', this._reset, this); m.off('zoomanim', this._anim, this); L.DomUtil.remove(this._c); },
    _reset() {
      const m = this._map, pad = 0.15, size = m.getSize();
      const min = this._min = m.containerPointToLayerPoint(size.multiplyBy(-pad)).round(), full = size.multiplyBy(1 + 2 * pad).round();
      this._center = m.getCenter(); this._zoom = m.getZoom();
      L.DomUtil.setTransform(this._c, min, 1);
      this._c.width = Math.max(1, full.x); this._c.height = Math.max(1, full.y);
      this._c.style.width = full.x + 'px'; this._c.style.height = full.y + 'px';
      this._key = null;
      this.draw();
    },
    _anim(e) {   // keep it lined up while Leaflet animates a zoom (as L.Renderer does)
      const m = this._map, pad = 0.15, scale = m.getZoomScale(e.zoom, this._zoom);
      const offset = m.getSize().multiplyBy(0.5 + pad).multiplyBy(-scale).add(m.project(this._center, e.zoom)).subtract(m._getNewPixelOrigin(e.center, e.zoom));
      L.DomUtil.setTransform(this._c, offset, scale);
    },
    draw(tick) {
      const c = this._c, ctx = c.getContext('2d'), m = this._map, sc = state.scene;
      if (!sc || !worldScene() || !sc.meta.fog) { ctx.clearRect(0, 0, c.width, c.height); this._key = null; return; }
      const gm = V.isGM(), CL = cloudTexture();
      const W = Math.ceil(c.width / RES), H = Math.ceil(c.height / RES);
      // map picture pixels → this canvas (k: screen px per map px)
      const o = m.latLngToLayerPoint(A.toLatLng(0, 0)), k = (m.latLngToLayerPoint(A.toLatLng(1024, 0)).x - o.x) / 1024;
      const ox = o.x - this._min.x, oy = o.y - this._min.y;
      const t = performance.now() / 1000;
      // Everything below is pinned to the map, not the screen, so zooming in or out never moves or reshapes the fog.
      // The cloud is the same picture at three sizes (one tile = 1200, 4200 and 14000 map px), each showing most when
      // its puffs are a good size on the screen: zooming out, the small puffs fade under the big banks (nothing jumps).
      // The edge billows at the small size.
      const tileMap = 1200;
      const driftX = t * tileMap * 0.004, driftY = t * tileMap * 0.0018;
      // 1. where the fog is, its edge roughened into billows by noise (worked out again now and then as it drifts)
      const key = JSON.stringify(sc.fog) + '|' + W + 'x' + H + '|' + ox.toFixed(0) + ',' + oy.toFixed(0) + ',' + k.toFixed(7);
      if (key !== this._key || !tick || t - (this._at || 0) > 0.9) {
        if (key !== this._key) {
          this._key = key;
          const mk = this._mask; mk.width = W; mk.height = H;
          const g = mk.getContext('2d'), f = k / RES;
          g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
          g.setTransform(f, 0, 0, f, ox / RES, oy / RES);
          g.filter = `blur(${Math.max(1, Math.min(60, 160 * f)).toFixed(2)}px)`;   // a soft edge 160 map px wide, whatever the zoom
          for (const sh of sc.fog) {
            g.globalCompositeOperation = sh.mode === 'reveal' ? 'destination-out' : 'source-over';
            g.fillStyle = '#fff'; g.beginPath();
            if (sh.k === 'rect') g.rect(sh.x, sh.y, sh.w, sh.h);
            else if (sh.k === 'circle') g.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
            else if (sh.pts && sh.pts.length > 4) { g.moveTo(sh.pts[0], sh.pts[1]); for (let i = 2; i < sh.pts.length; i += 2) g.lineTo(sh.pts[i], sh.pts[i + 1]); g.closePath(); }
            g.fill();
          }
          this._md = g.getImageData(0, 0, W, H).data;
        }
        this._at = t;
        const al = this._alpha; if (al.width !== W || al.height !== H) { al.width = W; al.height = H; }
        const ag = al.getContext('2d'), img = ag.createImageData(W, H), d = img.data, md = this._md;
        const per = RES / (k * tileMap);   // tile units per alpha pixel
        const bx = (-ox / k + driftX) / tileMap, by = (-oy / k + driftY) / tileMap;
        for (let y = 0; y < H; y++) {
          const ty = by + y * per;
          for (let x = 0; x < W; x++) {
            const i = y * W + x, a = md[i * 4 + 3] / 255;
            if (a <= 0.003) { d[i * 4 + 3] = 0; continue; }
            if (a >= 0.995) { d[i * 4 + 3] = 255; continue; }   // deep in the fog: solid
            const n = CL.edge(((bx + x * per) % 1 + 1) % 1, ((ty % 1) + 1) % 1);
            let v = Math.min(1, Math.max(0, (a - 0.5) * 2.6 + 0.5 + (n - 0.5) * 1.7));
            d[i * 4 + 3] = Math.round(v * v * (3 - 2 * v) * 255);
          }
        }
        ag.putImageData(img, 0, 0);
      }
      // 2. the cloud picture, drifting, cut to that shape
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, c.width, c.height);
      const layers = [[1200, 0, 0], [4200, 0.37, 0.21], [14000, 0.71, 0.53]].map(([L, fx, fy]) => {
        const px = L * k;   // one tile across, on the screen
        const w = Math.max(0, Math.min(1, (px - 90) / 220)) * Math.max(0.05, Math.min(1, (3400 - px) / 1800));
        return { L, fx, fy, w };
      }).sort((a, b) => b.w - a.w);
      const top = layers[0].w || 1;
      layers.forEach((ly, i) => {
        if (i && ly.w < 0.02) return;
        const pat = ctx.createPattern(CL.c, 'repeat'), sz = ly.L * k / CL.c.width, dr = ly.L === tileMap ? 1 : ly.L / tileMap * 0.5;
        pat.setTransform(new DOMMatrix([sz, 0, 0, sz, ox - (driftX * dr - ly.fx * ly.L) * k, oy - (driftY * dr - ly.fy * ly.L) * k]));
        ctx.globalAlpha = i ? Math.min(0.55, 0.55 * ly.w / top) : 1;
        ctx.fillStyle = pat; ctx.fillRect(0, 0, c.width, c.height);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this._alpha, 0, 0, W * RES, H * RES);
      if (gm) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, c.width, c.height); }   // the GM sees through it
      ctx.globalCompositeOperation = 'source-over';
    }
  });
  return new FogLayer();
}
// is (x, y) under the fog for this player?
const fogged = (x, y) => { const sc = state.scene; return !!(sc && sc.meta.fog && !V.isGM() && window.Geom && !Geom.fogVisible({ fog: true, fogShapes: sc.fog }, x, y)); };
function drawFog() {
  const A = sceneA(), L = sceneL();
  if (!A || !L) return;
  const fogOn = worldScene() && !!state.scene.meta.fog;
  if (fogOn && !fogLayer) fogLayer = makeFogLayer(L, A).addTo(A.map);
  if (fogLayer) fogLayer.draw();
  if (A.setFogTest) A.setFogTest(fogOn && !V.isGM() ? fogged : null);
}
on('fog', () => { drawFog(); restrictView(); }); on('sceneMeta', drawFog);

// ───────── what the players may look at ─────────
// With fog on, a player's view keeps to what's been revealed (and starts zoomed in on it, or on their own token).
let viewKey = '';
function revealedBox() {
  const sc = state.scene, A = sceneA(); if (!sc || !A) return null;
  const W = A.size.w, H = A.size.h;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of sc.fog || []) {
    if (sh.mode !== 'reveal') continue;
    let bx0, by0, bx1, by1;
    if (sh.k === 'rect') { bx0 = sh.x; by0 = sh.y; bx1 = sh.x + sh.w; by1 = sh.y + sh.h; }
    else if (sh.k === 'circle') { bx0 = sh.x - sh.r; by0 = sh.y - sh.r; bx1 = sh.x + sh.r; by1 = sh.y + sh.r; }
    else { const xs = sh.pts.filter((_, i) => i % 2 === 0), ys = sh.pts.filter((_, i) => i % 2 === 1); bx0 = Math.min(...xs); bx1 = Math.max(...xs); by0 = Math.min(...ys); by1 = Math.max(...ys); }
    x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
  }
  if (!isFinite(x0)) return null;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}
function restrictView() {
  const A = sceneA(); if (!A || !A.restrict) return;
  const limit = worldScene() && state.scene.meta.fog && !V.isGM();
  const box = limit ? revealedBox() : null;
  const key = (state.scene ? state.scene.id : '') + '|' + JSON.stringify(box);
  if (key === viewKey) return;
  const first = !viewKey.startsWith((state.scene ? state.scene.id : '') + '|');
  viewKey = key;
  A.restrict(box);
  if (first && !V.isGM()) fitView(false);
}
// the view to start from: a player's own token if it's on the map, else what's revealed (players) or the whole map
function fitView(anim) {
  const A = sceneA(); if (!A || !worldScene()) return;
  const mine = [...state.scene.tokens.values()].find(t => (t.owners || []).includes(state.me.id));
  const box = state.scene.meta.fog && !V.isGM() ? revealedBox() : null;
  if (mine && !V.isGM()) A.focus(mine.x, mine.y, box, anim);
  else if (box) A.focus(null, null, box, anim);
  else A.focus(null, null, null, anim);
}

// ───────── the party's journeys (the J tool) ─────────
// The GM draws where the party went: pick or start a journey, then click the map stop by stop; each stop is dated by the
// campaign's clock as it is then. Everyone sees the trails (bar ones the GM hides) and can look back along them.
let jSel = null, jAdding = false;
const Cal = () => window.WorldCalendar;
const journeys = () => (state.scene && Array.isArray(state.scene.meta.journeys) ? state.scene.meta.journeys : []);
const jDay = t => { const c = state.calendar; if (t == null || !c || !Cal()) return null; return Math.floor(t / 1440); };
const jDate = t => { const c = state.calendar; if (t == null || !c || !Cal()) return ''; try { return Cal().label(c.cal, t, { short: true }); } catch (e) { return ''; } };
function jRange(j) {
  const ts = (j.pts || []).map(p => p.t).filter(t => t != null);
  if (!ts.length) return '';
  const a = jDate(Math.min(...ts)), b = jDate(Math.max(...ts));
  return a === b ? a : `${a} – ${b}`;
}
function saveJourneys(list) { const sc = state.scene; if (!sc) return Promise.resolve(); return V.op({ t: 'scene.update', id: sc.id, patch: { journeys: list } }).catch(e => V.toast(e.message || String(e), true)); }
const setJ = (id, fn) => saveJourneys(journeys().map(j => j.id === id ? (x => (fn(x), x))(JSON.parse(JSON.stringify(j))) : j));
function drawJourneys() {
  const A = sceneA(); if (!A || !A.setJourneys || !worldScene()) return;
  A.setJourneys(journeys().filter(j => V.isGM() || !j.hidden).map(j => {
    let lastDay = null;
    const pts = (j.pts || []).map((p, i, arr) => {
      const d = jDay(p.t), lab = d != null && (d !== lastDay || i === arr.length - 1) ? jDate(p.t) : '';
      if (d != null) lastDay = d;
      return { x: p.x, y: p.y, label: lab, note: p.note || '' };
    });
    return { id: j.id, name: (j.name || 'The journey') + (j.hidden ? ' (hidden)' : ''), color: j.color, live: j.id === jSel && jAdding, pts };
  }));
}
on('sceneMeta', drawJourneys); on('time', drawJourneys);
const JCOLS = ['#9e2b25', '#24527a', '#2f6b3a', '#7a4a9e', '#a8661c', '#1f1f1f'];
const journeyHandler = {
  down: () => false, move: () => {}, up: () => {},
  key: e => { if (e.key === 'Escape' && jAdding) { jAdding = false; V.renderSubtools(); V.hud(); drawJourneys(); applyTool(); return true; } return false; },
  hud: () => jAdding ? 'Click the map to add the party’s next stop (dated by the clock: move the clock on as they travel) · Esc to stop'
    : V.isGM() ? 'The party’s journeys: start one, then add stops as they travel' : 'Where the party has been: pick a journey to look back along it',
  subtools(box) {
    const list = journeys().filter(j => V.isGM() || !j.hidden);
    if (jSel && !list.some(j => j.id === jSel)) { jSel = null; jAdding = false; }
    if (!jSel && list.length) jSel = list[list.length - 1].id;
    const cur = list.find(j => j.id === jSel);
    const b = (label, active, fn, title) => h('button', { class: active ? 'on' : null, onclick: fn, title }, label);
    const re = () => { V.renderSubtools(); V.hud(); drawJourneys(); applyTool(); };
    const sel = list.length ? h('select', { title: 'Journey', onchange: e => { jSel = e.target.value; jAdding = false; re(); const A = sceneA(); if (A && A.focusJourney) A.focusJourney(jSel); } },
      ...list.map(j => h('option', { value: j.id, selected: j.id === jSel || null }, `${j.name || 'The journey'}${j.hidden ? ' (hidden)' : ''}${jRange(j) ? ' · ' + jRange(j) : ''}`))) : h('span', { class: 'subfield' }, V.isGM() ? 'No journeys yet' : 'The party hasn’t set out yet');
    box.append(sel);
    if (cur) box.append(b('Fit', false, () => { const A = sceneA(); if (A && A.focusJourney) A.focusJourney(cur.id); }, 'Fit the map to this journey'));
    if (!V.isGM()) return;
    box.append(h('div', { class: 'sep' }),
      b('New journey', false, () => {
        const name = prompt('Name the journey', `Journey ${journeys().length + 1}`); if (name == null) return;
        const j = { id: 'j' + Date.now().toString(36), name: name.trim() || 'The journey', color: JCOLS[journeys().length % JCOLS.length], pts: [] };
        jSel = j.id; jAdding = true; saveJourneys(journeys().concat([j])).then(re);
      }));
    if (!cur) return;
    box.append(
      b(jAdding ? 'Adding… (Esc)' : 'Add stops', jAdding, () => { jAdding = !jAdding; re(); }, 'Click the map for each stop; each is dated by the campaign clock'),
      b('Undo stop', false, () => setJ(cur.id, x => { x.pts.pop(); }), 'Take back the last stop'),
      b('Note…', false, () => { const p = cur.pts[cur.pts.length - 1]; if (!p) return; const n = prompt('A note on the last stop (shown beside its date)', p.note || ''); if (n == null) return; setJ(cur.id, x => { x.pts[x.pts.length - 1].note = n.trim(); }); }, 'Note on the last stop'),
      h('div', { class: 'sep' }),
      b('Rename', false, () => { const n = prompt('Rename the journey', cur.name || ''); if (n) setJ(cur.id, x => { x.name = n.trim(); }); }),
      h('input', { type: 'color', value: cur.color || '#9e2b25', title: 'Colour of the trail', onchange: e => setJ(cur.id, x => { x.color = e.target.value; }) }),
      b(cur.hidden ? 'Hidden' : 'Shown', !cur.hidden, () => setJ(cur.id, x => { x.hidden = !x.hidden; }), 'Show or hide this journey from the players'),
      b('Delete', false, () => { if (confirm(`Delete “${cur.name || 'the journey'}”? (Undo brings it back.)`)) { jAdding = false; saveJourneys(journeys().filter(j => j.id !== cur.id)).then(re); } }));
  }
};
function addStop(e) {
  const A = sceneA(); if (!A || !jAdding || !jSel || state.tool !== 'journey' || !V.isGM()) return;
  const p = A.toPixel(e.latlng), c = state.calendar;
  setJ(jSel, x => { x.pts.push(Object.assign({ x: Math.round(p.x), y: Math.round(p.y) }, c ? { t: c.t } : {})); }).then(() => V.renderSubtools());
}

// ───────── the GM's fog tool (left side bar): reveal or hide, a box or a shape, all of it, fog on or off ─────────
let fogTool = null, fogMode = 'reveal', fogShape = 'rect', draft = null, polyPts = [];
const fogHandler = {
  down: () => false, move: () => {}, up: () => {},
  hud: () => !state.scene || !state.scene.meta.fog ? 'Fog of war is off for this map: switch it on to hide the map from the players'
    : fogShape === 'rect' ? `Drag a box on the map to ${fogMode} it` : `Click points round an area to ${fogMode} it; double-click to finish`,
  subtools(box) {
    const sc = state.scene; if (!sc) return;
    const b = (label, active, fn, title) => h('button', { class: active ? 'on' : null, onclick: fn, title }, label);
    const fogOn = !!sc.meta.fog, re = () => { V.renderSubtools(); V.hud(); };
    box.append(
      b(fogOn ? 'Fog on' : 'Fog off', fogOn, () => V.op({ t: 'scene.update', id: sc.id, patch: { fog: !fogOn } }).then(re), 'Hide the map from the players until you reveal it'),
      h('div', { class: 'sep' }),
      b('Reveal', fogMode === 'reveal', () => { fogMode = 'reveal'; re(); }), b('Hide', fogMode === 'hide', () => { fogMode = 'hide'; re(); }),
      h('div', { class: 'sep' }),
      b('Box', fogShape === 'rect', () => { fogShape = 'rect'; setFogTool('rect'); re(); }),
      b('Shape', fogShape === 'poly', () => { fogShape = 'poly'; setFogTool('poly'); re(); }, 'Click points, double-click to finish'),
      h('div', { class: 'sep' }),
      b('Reveal all', false, () => { const A = sceneA(); if (!A) return; const w = A.size.w, hh = A.size.h; V.op({ t: 'fog.set', scene: sc.id, shapes: [{ mode: 'reveal', k: 'rect', x: -w, y: -hh, w: w * 3, h: hh * 3 }] }); }),
      b('Hide all', false, () => V.op({ t: 'fog.set', scene: sc.id, shapes: [] })));
  }
};
function setFogTool(t) {
  fogTool = t; polyPts = []; clearDraft();
  const A = sceneA(); if (!A || !A.map) return;
  const m = A.map;
  if (t) { m.dragging.disable(); m.doubleClickZoom.disable(); m.getContainer().style.cursor = 'crosshair'; }
  else { m.dragging.enable(); m.doubleClickZoom.enable(); m.getContainer().style.cursor = ''; }
}
function clearDraft() { if (draft) { try { draft.remove(); } catch (e) { /* gone with the old frame */ } draft = null; } }
function hookFogTools() {
  const A = sceneA(), L = sceneL(); if (!A || !L || A.map._vttFog) return;
  const m = A.map; m._vttFog = true; ensurePanes(m);
  const at = e => { const p = A.toPixel(e.latlng); return [Math.round(p.x), Math.round(p.y)]; };
  const col = () => fogMode === 'reveal' ? '#9fd6e8' : '#000000';
  let start = null;
  m.on('mousedown', e => { if (fogTool !== 'rect') return; start = e.latlng; clearDraft(); draft = L.rectangle([start, start], { pane: 'vttdraft', color: '#9fd6e8', weight: 2, fillColor: col(), fillOpacity: 0.25, interactive: false }).addTo(m); });
  m.on('mousemove', e => {
    if (fogTool === 'rect' && start && draft) draft.setBounds(L.latLngBounds(start, e.latlng));
    if (fogTool === 'poly' && polyPts.length) { clearDraft(); draft = L.polygon(polyPts.map(p => A.toLatLng(p[0], p[1])).concat([e.latlng]), { pane: 'vttdraft', color: '#9fd6e8', weight: 2, fillColor: col(), fillOpacity: 0.2, interactive: false }).addTo(m); }
  });
  m.on('mouseup', e => {
    if (fogTool !== 'rect' || !start) return;
    const a = A.toPixel(start), b = A.toPixel(e.latlng); start = null; clearDraft();
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
    if (w > 2 && hh > 2) V.op({ t: 'fog.add', scene: state.scene.id, shape: { mode: fogMode, k: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) } });
  });
  m.on('click', e => { if (fogTool === 'poly') polyPts.push(at(e)); });
  // stops: caught before the map's places see the click, so a town can be a stop (a drag to pan isn't a click)
  { let downAt = null; const el = m.getContainer();
    el.addEventListener('mousedown', ev => { downAt = [ev.clientX, ev.clientY]; }, true);
    el.addEventListener('click', ev => {
      if (!jAdding || state.tool !== 'journey' || !V.isGM()) return;
      if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
      if (ev.target.closest && ev.target.closest('.leaflet-control')) return;
      ev.stopPropagation(); ev.preventDefault();
      addStop({ latlng: m.mouseEventToLatLng(ev) });
    }, true); }
  m.on('dblclick', () => {
    if (fogTool !== 'poly') return;
    const pts = polyPts.slice(0, -1);   // the double-click's second click added a point twice
    polyPts = []; clearDraft();
    if (pts.length >= 3) V.op({ t: 'fog.add', scene: state.scene.id, shape: { mode: fogMode, k: 'poly', pts: pts.flat() } });
  });
  // the table's keys work while the map has the focus: V select, R ruler, F fog, 0 fit, Ctrl+Z undo
  m.getContainer().ownerDocument.addEventListener('keydown', e => {
    if (e.key === 'Escape' && fogTool) { polyPts = []; clearDraft(); return; }
    if (e.key === 'Escape' && jAdding) { jAdding = false; V.renderSubtools(); V.hud(); drawJourneys(); applyTool(); return; }
    const tgt = e.target; if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); V.undo(); return; }
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); V.redo(); return; }
    if (ctrl || e.altKey) return;
    const tool = { v: 'select', f: 'fog', j: 'journey' }[k];
    if (tool && (tool !== 'fog' || V.isGM())) { V.setTool(tool); e.preventDefault(); }
    if (k === '0') V.fit();
  });
}

// ───────── the map's edit switch (GM) lives in the table's top bar ─────────
// On a world map scene it edits that scene's version of the map; on the site's Map, the main map.
const editSw = h('button', { id: 'mapEditSw', class: 'switch', hidden: true, title: 'Edit this map: place, move and change icons, borders and names',
  onclick: () => { const A = editTarget(); if (A) A.setEditMode(!A.editMode); } }, h('span', { class: 'lbl' }, 'Edit map'), h('span', { class: 'track' }, h('span', { class: 'knob' })));
$('#me').before(editSw);
const editTarget = () => local === 'map' ? apiOf(F.site) : worldScene() ? sceneA() : null;
function renderEditSwitch() {
  const A = editTarget();
  editSw.hidden = !(V.isGM() && A && A.canEdit);
  editSw.classList.toggle('on', !!(A && A.editMode));
  editSw.querySelector('.lbl').textContent = worldScene() && state.scene.meta.atlas ? 'Edit this map' : 'Edit map';
  for (const f of [F.scene, F.site]) { const a = apiOf(f); if (a && a.editMode && a !== A) a.setEditMode(false); }
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data) return;
  const f = [F.scene, F.site].find(x => x && e.source === x.contentWindow); if (!f) return;
  if (e.data.t === 'mapReady') {
    f._ready = true; f._fresh = false;
    if (f === F.site) { f.classList.remove('warming'); f.hidden = !local; }   // loaded at full size out of sight: put away now
    if (f === F.site && local) update();   // a tab picked while it loaded
    if (f === F.scene) { resetScene(); f._ready = true; hookDrops(); hookFogTools(); pushClock(f); drawTokens(); drawFog(); restrictView(); applyTool(); drawJourneys(); drawAmb(); }
    renderEditSwitch();
  }
  if (e.data.t === 'mapEdit') renderEditSwitch();
  if (e.data.t === 'calendarClose' && local === 'calendar') V.showWorld('table');
  if (e.data.t === 'openClock') { const b = document.getElementById('clockBtn'); if (b && !b.hidden) b.click(); }
});
// ───────── the map's own sound (rain, wind, the sea, thunder) while the world map is the scene: its volume here ─────────
const ambBtn = $('#ambBtn');
const AMB_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const AMB_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
let ambPop = null;
const ambOf = () => { const A = sceneA(); return A && A.ambience; };
function drawAmb() {
  if (!ambBtn) return;
  const a = ambOf(); ambBtn.hidden = !worldScene() || !a;
  const v = a ? a.volume : 0;
  ambBtn.innerHTML = v > 0 ? AMB_ON : AMB_OFF;
  ambBtn.title = `The map's sound: rain, wind, the sea and thunder (${v > 0 ? Math.round(v * 100) + '%' : 'off'})`;
  ambBtn.classList.toggle('on', !!ambPop);
}
function closeAmb() { if (ambPop) { ambPop.remove(); ambPop = null; drawAmb(); } }
if (ambBtn) ambBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (ambPop) return closeAmb();
  const a = ambOf(); if (!a) return;
  const out = h('span', null, a.volume > 0 ? Math.round(a.volume * 100) + '%' : 'Off');
  const rng = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(a.volume * 100), 'aria-label': 'Map sound volume' });
  rng.addEventListener('input', () => { a.setVolume(rng.value / 100, false); out.textContent = +rng.value ? rng.value + '%' : 'Off'; drawAmb(); });
  rng.addEventListener('change', () => { a.setVolume(rng.value / 100, true); drawAmb(); });
  ambPop = h('div', { class: 'ambpop' }, h('div', { class: 'lab' }, 'Ambience'), rng, out);
  const r = ambBtn.getBoundingClientRect();
  ambPop.style.left = (r.right + 8) + 'px'; ambPop.style.top = (r.top + r.height / 2) + 'px';
  document.body.append(ambPop); drawAmb();
});
document.addEventListener('pointerdown', e => { if (ambPop && !ambPop.contains(e.target) && !ambBtn.contains(e.target)) closeAmb(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAmb(); });
on('worldview', () => { if (!worldScene()) closeAmb(); drawAmb(); });
V.showWorld = function (what) { local = what === 'table' ? null : what; update(); };
V.inWorldScene = worldScene;
// The site is loaded quietly in the background a little after the table opens, so the Map, Wiki and other tabs
// open at once instead of starting the whole site up on the first click.
setTimeout(function preload() {
  if (F.site) return;
  if (document.hidden) { setTimeout(preload, 3000); return; }
  F.site = makeFrame('site', siteSrc('#/map'));
  if (!local) F.site.classList.add('warming');   // not display:none: a map that starts with no size can come up black
}, 2500);
on('scene', () => { if (state.scene && sceneIsWorld()) local = null; update(); });
on('sceneMeta', () => { update(); });
// a plain click shows it here, over the table; Ctrl/middle-click opens the full site page in a new tab
// (with no campaign open, the campaign list covers the table: the site opens as its own page instead)
for (const b of V.$$('#views [data-view]')) b.addEventListener('click', e => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  if (b.dataset.view === 'table') { if (!state.camp) return; }
  else if (!state.camp || $('#app').hidden) { location.href = b.getAttribute('href') || '/#/map'; return; }
  V.showWorld(b.dataset.view);
});
// the side bar button works as ever; looking at the site, it shows or hides the bar just for now
})();
