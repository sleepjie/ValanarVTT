/* The battle map: drawing the scene with Pixi, and the pointer tools (select, ruler, templates, fog, pings). */
'use strict';
(function () {
const { $, h, state, on } = V;
const stageEl = $('#stage');
let app, world;
const L = {};
const nodes = new Map();        // token id -> Pixi container
const texCache = new Map();     // url -> texture | 'loading' | 'error'
const others = new Map();       // uid -> { g, label } for other people's rulers
const hexNum = c => parseInt(String(c || '#888888').slice(1), 16);
const S = () => world.scale.x;
const gs = () => V.grid().size || 100;

// ───────────────────────── set up ─────────────────────────

V.initStage = function () {
  app = new PIXI.Application({ resizeTo: stageEl, background: 0x0b0d10, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  stageEl.append(app.view);
  world = new PIXI.Container();
  app.stage.addChild(world);
  L.bg = new PIXI.Container();
  L.bgRect = new PIXI.Graphics();
  L.map = new PIXI.Sprite(PIXI.Texture.EMPTY);
  L.bg.addChild(L.bgRect, L.map);
  L.cells = new PIXI.Graphics();      // template squares
  L.grid = new PIXI.Graphics();
  L.tpl = new PIXI.Container();
  L.tok = new PIXI.Container(); L.tok.sortableChildren = true;
  L.scen = new PIXI.Container(); L.scen.sortableChildren = true;   // scenery (the map layer, props): under the darkness, so it's lit like the floor
  L.tint = new PIXI.Graphics(); L.tint.blendMode = PIXI.BLEND_MODES.MULTIPLY; L.tint.visible = false;   // the colour of the light: the time of day and the weather (clock.js)
  L.gmover = new PIXI.Container();   // the GM's notes on the map (room numbers): only on the GM's screen
  L.dark = new PIXI.Graphics();
  L.fog = new PIXI.Sprite(PIXI.Texture.EMPTY);
  L.over = new PIXI.Container();
  L.draw = new PIXI.Graphics();       // my ruler, marquee, previews
  L.label = mkLabel();
  L.fx = new PIXI.Container();        // pings
  L.over.addChild(L.draw, L.fx, L.label);
  // light and sight (lighting.js): a grey copy of the map for darkvision, coloured light, and the darkness/vision mask
  L.grey = new PIXI.Sprite(PIXI.Texture.EMPTY);
  L.greyMask = new PIXI.Sprite(PIXI.Texture.EMPTY);
  L.lightCol = new PIXI.Sprite(PIXI.Texture.EMPTY); L.lightCol.blendMode = PIXI.BLEND_MODES.ADD;
  L.vis = new PIXI.Sprite(PIXI.Texture.EMPTY);
  L.walls = new PIXI.Graphics();
  L.doors = new PIXI.Container();
  L.lightIcons = new PIXI.Container();
  L.soundIcons = new PIXI.Container();
  // tokens sit above fog and darkness: the server only sends players tokens they're allowed to see
  world.addChild(L.bg, L.grey, L.greyMask, L.lightCol, L.cells, L.tpl, L.grid, L.scen, L.tint, L.dark, L.fog, L.vis, L.gmover, L.tok, L.walls, L.doors, L.lightIcons, L.soundIcons, L.over);
  for (const l of [L.bg, L.grey, L.greyMask, L.lightCol, L.cells, L.grid, L.dark, L.fog, L.vis, L.walls, L.tpl, L.over, L.tint]) l.eventMode = 'none';
  L.gmover.eventMode = 'passive';   // (its room numbers can be clicked)

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', onDown);
  app.stage.on('globalpointermove', onMove);
  app.stage.on('pointerup', onUp);
  app.stage.on('pointerupoutside', onUp);
  app.view.addEventListener('contextmenu', e => e.preventDefault());
  app.view.addEventListener('wheel', onWheel, { passive: false });
  // two fingers: pinch to zoom, and move together to pan
  let pinch = null;
  const two = ev => { const r = app.view.getBoundingClientRect(), [a, b] = ev.touches; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top }; };
  app.view.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 2) return;
    ev.preventDefault();
    if (press) { clearTimeout(press.timer); press = null; }
    if (drag && drag.kind === 'tokens') for (const id of drag.ids) { const tok = state.scene && state.scene.tokens.get(id); if (tok) drawToken(tok); }
    drag = null; L.draw.clear(); L.label.visible = false;
    const g = two(ev); pinch = Object.assign(g, { s: S(), wx: world.x, wy: world.y });
  }, { passive: false });
  app.view.addEventListener('touchmove', ev => {
    if (!pinch || ev.touches.length < 2) return;
    ev.preventDefault();
    const g = two(ev), s1 = V.clamp(pinch.s * g.d / pinch.d, 0.03, 10);
    const wx = (pinch.cx - pinch.wx) / pinch.s, wy = (pinch.cy - pinch.wy) / pinch.s;   // the point that was under the fingers stays under them
    world.scale.set(s1); world.position.set(g.cx - wx * s1, g.cy - wy * s1);
    onZoom();
  }, { passive: false });
  app.view.addEventListener('touchend', ev => { if (pinch && ev.touches.length < 2) { pinch = null; drag = null; saveCam(); } });
  app.view.addEventListener('dblclick', onDbl);
  stageEl.addEventListener('dragover', e => {
    const item = (V.itemDragType && e.dataTransfer.types.includes(V.itemDragType)) || (V.spellDragType && e.dataTransfer.types.includes(V.spellDragType));   // item and spell cards: anyone (onto their tokens)
    if (V.isGM() || item) { e.preventDefault(); e.dataTransfer.dropEffect = item ? 'move' : 'copy'; }
  });
  document.addEventListener('dragstart', e => { if (e.dataTransfer && e.target.closest && e.target.closest('.crow2')) document.body.classList.add('chardrag'); });
  document.addEventListener('dragend', () => document.body.classList.remove('chardrag'));
  stageEl.addEventListener('drop', onDropFiles);
  app.ticker.add(tick);
  new ResizeObserver(() => { app.resize(); app.stage.hitArea = app.screen; }).observe(stageEl);
};

function mkLabel() {
  const t = new PIXI.Text('', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: 14, fontWeight: '600', fill: 0xffffff, stroke: 0x000000, strokeThickness: 4 });
  t.resolution = 2; t.anchor.set(0, 1.2); t.visible = false;
  return t;
}

// ───────────────────────── view: pan and zoom ─────────────────────────

const camKey = () => state.scene && 'vtt-cam-' + state.scene.id;
let camSaveT = 0;
function saveCam() { clearTimeout(camSaveT); camSaveT = setTimeout(() => { if (camKey()) V.store.set(camKey(), { x: world.x, y: world.y, s: S() }); }, 300); }
V.fit = function () {
  const { w, h } = V.sceneSize();
  const s = Math.min(app.screen.width / w, app.screen.height / h) * 0.94;
  world.scale.set(s);
  world.position.set((app.screen.width - w * s) / 2, (app.screen.height - h * s) / 2);
  saveCam(); onZoom();
};
function zoomAt(sx, sy, f) {
  const s0 = S(), s1 = V.clamp(s0 * f, 0.03, 10);
  const wx = (sx - world.x) / s0, wy = (sy - world.y) / s0;
  world.scale.set(s1);
  world.position.set(sx - wx * s1, sy - wy * s1);
  saveCam(); onZoom();
}
V.centreOn = function (x, y, animate) {
  const tx = app.screen.width / 2 - x * S(), ty = app.screen.height / 2 - y * S();
  if (!animate) { world.position.set(tx, ty); saveCam(); return; }
  const fx = world.x, fy = world.y, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 450), e = 1 - Math.pow(1 - k, 3);
    world.position.set(fx + (tx - fx) * e, fy + (ty - fy) * e);
    if (k < 1) requestAnimationFrame(step); else saveCam();
  };
  requestAnimationFrame(step);
};
function onWheel(e) {
  e.preventDefault();
  const r = app.view.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)));
}
// labels and bars keep a readable size on screen
function onZoom() {
  L.label.scale.set(1 / S());
  for (const o of others.values()) o.label.scale.set(1 / S());
  if (drag && drag.kind === 'ruler') drawRuler();
}
const toWorld = p => world.toLocal(p);

// ───────────────────────── drawing the scene ─────────────────────────

V.renderScene = function () {
  for (const n of nodes.values()) n.destroy({ children: true });
  nodes.clear();
  for (const o of others.values()) { o.g.destroy(); o.label.destroy(); }
  others.clear();
  cancelAll();
  const s = state.scene;
  world.visible = !!s;
  if (!s) return;
  renderBg(); renderGrid(); renderTemplates(); renderTokens(); renderFog(); renderDark();
  const cam = V.store.get(camKey(), null);
  if (cam && cam.s) { world.scale.set(cam.s); world.position.set(cam.x, cam.y); onZoom(); } else V.fit();
};
on('scene', () => V.renderScene());
on('sceneMeta', () => { renderBg(); renderGrid(); renderTemplates(); renderTokens(); renderFog(); renderDark(); });
on('fog', () => renderFog());
on('tokens', d => { for (const id of d.rm) { const n = nodes.get(id); if (n) { n.destroy({ children: true }); nodes.delete(id); } } for (const t of d.up) drawToken(t); });
on('templates', () => renderTemplates());
on('me', () => { if (state.scene) V.renderScene(); });

function renderBg() {
  const m = state.scene.meta, { w, h } = V.sceneSize();
  L.bgRect.clear().beginFill(hexNum(m.bg || '#1b1d22')).drawRect(0, 0, w, h).endFill();
  if (m.plan && V.planTexture) {   // a planned map (table/js/planner.js): drawn here, in ink
    const tex = V.planTexture(m.plan, V.grid());
    if (tex) { L.map.texture = tex; L.map.width = w; L.map.height = h; L.map.position.set(0, 0); } else L.map.texture = PIXI.Texture.EMPTY;   // (its textures still on their way: drawn when they come)
    if (V.drawGMOverlay) V.drawGMOverlay();
    return;
  }
  if (V.drawGMOverlay) V.drawGMOverlay();
  if (m.image && m.image.url) {
    loadTex(m.image.url).then(tex => {
      if (!state.scene || state.scene.meta.image !== m.image) return;
      L.map.texture = tex; L.map.width = m.image.w; L.map.height = m.image.h;
    }).catch(() => V.toast('The map image could not be loaded', true));
  } else L.map.texture = PIXI.Texture.EMPTY;
}
function loadTex(url) {
  const c = texCache.get(url);
  if (c && c.then) return c;
  if (c) return Promise.resolve(c);
  const p = PIXI.Assets.load(url).then(t => { texCache.set(url, t); return t; }, e => { texCache.set(url, 'error'); throw e; });
  texCache.set(url, p);
  return p;
}

V.drawGrid = function (gfx, g, w, h, native) {
  gfx.clear();
  if (!g || g.type === 'none' || !(g.size > 2)) return;
  gfx.lineStyle({ width: native ? 1 : Math.max(1, g.size * 0.015), color: hexNum(g.color || '#000000'), alpha: g.alpha ?? 0.35, native: !!native });
  if (g.type === 'square') {
    for (let x = g.ox - Math.floor(g.ox / g.size) * g.size; x <= w; x += g.size) gfx.moveTo(x, 0).lineTo(x, h);
    for (let y = g.oy - Math.floor(g.oy / g.size) * g.size; y <= h; y += g.size) gfx.moveTo(0, y).lineTo(w, y);
    return;
  }
  const S3 = Geom.S3;
  // walk the axial coordinates that cover the rectangle
  if (g.type === 'hexr') {
    const rowH = g.size * S3 / 2;
    for (let r = Math.floor((-g.size - g.oy) / rowH); g.oy + r * rowH <= h + g.size; r++) {
      for (let q = Math.floor((-g.size - g.ox) / g.size - r / 2); g.ox + g.size * (q + r / 2) <= w + g.size; q++) {
        const [cx, cy] = Geom.hexCentre(g, q, r); gfx.drawPolygon(Geom.hexCorners(g, cx, cy));
      }
    }
  } else {
    const colW = g.size * S3 / 2;
    for (let q = Math.floor((-g.size - g.ox) / colW); g.ox + q * colW <= w + g.size; q++) {
      for (let r = Math.floor((-g.size - g.oy) / g.size - q / 2); g.oy + g.size * (r + q / 2) <= h + g.size; r++) {
        const [cx, cy] = Geom.hexCentre(g, q, r); gfx.drawPolygon(Geom.hexCorners(g, cx, cy));
      }
    }
  }
};
function renderGrid() { const { w, h } = V.sceneSize(); V.drawGrid(L.grid, V.grid(), w, h, true); }
function renderDark() {
  const d = state.scene.meta.darkness || 0, { w, h } = V.sceneSize();
  L.dark.clear();
  if (V.lightingOwnsDark && V.lightingOwnsDark()) return;   // lights or vision: lighting.js draws the darkness
  if (d > 0) L.dark.beginFill(0x000814, V.isGM() ? d * 0.45 : d).drawRect(-w, -h, w * 3, h * 3).endFill();
}
V.renderDark = () => state.scene && renderDark();
V.redrawMap = () => state.scene && renderBg();

// --- fog: drawn into a small canvas, shown as one sprite ---
const fogCanvas = document.createElement('canvas');
let fogTex = null;
function renderFog() {
  const s = state.scene;
  if (!s || !s.meta.fog) { L.fog.visible = false; return; }
  const { w, h } = V.sceneSize(), k = Math.min(1, 2048 / Math.max(w, h));
  const cw = Math.ceil(w * k), ch = Math.ceil(h * k);
  if (fogCanvas.width !== cw || fogCanvas.height !== ch || !fogTex) {
    fogCanvas.width = cw; fogCanvas.height = ch;
    if (fogTex) fogTex.destroy(true);
    fogTex = PIXI.Texture.from(fogCanvas);
    L.fog.texture = fogTex;
  }
  const ctx = fogCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.filter = `blur(${Math.max(1, Math.round(gs() * 0.06 * k))}px)`;
  for (const f of s.fog) {
    ctx.globalCompositeOperation = f.mode === 'reveal' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    if (f.k === 'rect') ctx.rect(f.x, f.y, f.w, f.h);
    else if (f.k === 'circle') ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    else { ctx.moveTo(f.pts[0], f.pts[1]); for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i], f.pts[i + 1]); ctx.closePath(); }
    ctx.fill();
  }
  fogTex.baseTexture.update();
  L.fog.scale.set(1 / k);
  L.fog.visible = true;
  L.fog.alpha = V.isGM() ? 0.5 : 1;
  L.fog.tint = V.isGM() ? 0x203048 : 0xffffff;
}

// --- tokens ---
function renderTokens() {
  const seen = new Set();
  for (const t of state.scene.tokens.values()) { drawToken(t); seen.add(t.id); }
  for (const [id, n] of nodes) if (!seen.has(id)) { n.destroy({ children: true }); nodes.delete(id); }
}
V.redrawTokens = renderTokens;
// tokens show a ring unless the token says not to, or its scene turns rings off
V.tokenRing = t => (t.ring === true || t.ring === false ? t.ring : t.item ? false : !(state.scene && state.scene.meta && state.scene.meta.rings === false));
function textStyle(size, extra) {
  return Object.assign({ fontFamily: 'Palatino Linotype, Book Antiqua, Palatino, Georgia, serif', fontSize: size, fontWeight: '700', fill: 0xffffff, stroke: 0x000000, strokeThickness: Math.max(2, size / 5), lineJoin: 'round' }, extra || {});
}
function drawToken(t) {
  let n = nodes.get(t.id);
  if (!n) {
    n = new PIXI.Container();
    n.tid = t.id;
    n.on('pointerdown', e => onTokenDown(e, n.tid));
    nodes.set(t.id, n);
  }
  // scenery (the map layer, and props the players can see) sits under the darkness; creatures and the GM layer above it
  const home = t.layer === 'map' || (t.prop && t.layer !== 'gm') ? L.scen : L.tok;
  if (n.parent !== home) home.addChild(n);
  if (drag && drag.kind === 'tokens' && drag.ids.includes(t.id) && drag.moved) { /* keep the dragged position */ }
  else n.position.set(t.x, t.y);
  n.zIndex = (t._i || 0) + (t.layer === 'map' ? -2e6 : 0);
  for (const c of n.removeChildren()) c.destroy({ children: true });
  if (t.prop) return drawProp(t, n);
  n.angle = 0;
  const g = V.grid(), d = (t.size || 1) * gs(), r = d / 2, sel = state.sel.has(t.id);
  const gmLayer = t.layer === 'gm';
  // body: a round token with a ring, or (ring off) the bare picture, its whole shape showing
  const img = t.img || (t.item && V.itemArtURL ? V.itemArtURL(t.item) : null);
  const tex = img ? texCache.get(img) : null;
  const ready = tex && !tex.then && tex !== 'error';
  const ringOn = V.tokenRing(t), zoom = t.scale || 1;
  let body = new PIXI.Graphics(), top = r, bottom = r, half = r;   // how far the picture reaches above, below and sideways
  if (ready) tex.baseTexture.scaleMode = t.pixel ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR;
  if (ready && !ringOn) {
    body = new PIXI.Sprite(tex);
    body.anchor.set(0.5);
    const k = d / Math.max(tex.width, tex.height) * zoom;
    body.scale.set(k * (t.flip ? -1 : 1), k);
    half = tex.width * k / 2; top = bottom = tex.height * k / 2;
  } else if (ready) {
    const sc = d / Math.min(tex.width, tex.height) * zoom, m = new PIXI.Matrix();
    m.scale(sc * (t.flip ? -1 : 1), sc); m.translate((t.flip ? 1 : -1) * tex.width * sc / 2, -tex.height * sc / 2);
    body.beginTextureFill({ texture: tex, matrix: m }).drawCircle(0, 0, r).endFill();
  } else {
    body.beginFill(hexNum(t.color)).drawCircle(0, 0, r).endFill();
    if (img && !tex) loadTex(img).then(() => { const cur = state.scene && state.scene.tokens.get(t.id); if (cur) drawToken(cur); }).catch(() => {});
  }
  body.angle = t.rot || 0;
  if (t.item) {   // loot glints on the floor
    const glow = new PIXI.Graphics();
    for (const [k, al] of [[0.62, 0.1], [0.48, 0.14], [0.34, 0.18]]) glow.beginFill(0xffd27a, al).drawEllipse(0, r * 0.35, d * k, d * k * 0.45).endFill();
    n.addChild(glow);
  }
  n.addChild(body);
  if (!ready) {
    const ini = new PIXI.Text(V.initials(t.name), textStyle(Math.max(8, d * 0.34), { strokeThickness: 0, fill: 0xffffff }));
    ini.anchor.set(0.5); ini.resolution = 2; n.addChild(ini);
  }
  // ring: owner's colour, gold when selected
  const owner = (t.owners || []).map(V.member).find(Boolean);
  const ring = new PIXI.Graphics();
  if (ringOn || !ready) {
    ring.lineStyle(Math.max(1.5, d * 0.035), owner ? hexNum(owner.color) : 0x1a1a1a, 0.95).drawCircle(0, 0, r);
    if (sel) ring.lineStyle(Math.max(2.5, d * 0.05), 0xc9a45c, 1).drawCircle(0, 0, r + Math.max(3, d * 0.05));
  } else if (sel) {   // a bare sprite: corner brackets round it when selected
    const p = Math.max(3, d * 0.04), x0 = -half - p, y0 = -top - p, x1 = half + p, y1 = bottom + p, c = Math.min(x1 - x0, y1 - y0) * 0.22;
    ring.lineStyle(Math.max(2, d * 0.035), 0xc9a45c, 1);
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) ring.moveTo(x + sx * c, y).lineTo(x, y).lineTo(x, y + sy * c);
  }
  n.addChild(ring);
  // bars
  const bars = [t.hp, t.bar2].filter(b => b && b.max > 0);
  bars.forEach((b, i) => {
    const bw = d * 0.86, bh = Math.max(3, d * 0.07), y = -top - bh * 1.4 * (bars.length - i) - 2;
    const k = V.clamp(b.v / b.max, 0, 1);
    const col = i === 0 ? (k > 0.5 ? 0x5fa86a : k > 0.25 ? 0xd6a23e : 0xc0584a) : 0x5b8fd1;
    const bar = new PIXI.Graphics();
    bar.beginFill(0x000000, 0.65).drawRoundedRect(-bw / 2 - 1, y - 1, bw + 2, bh + 2, bh / 2).endFill();
    bar.beginFill(col).drawRoundedRect(-bw / 2, y, bw * k, bh, bh / 2).endFill();
    n.addChild(bar);
  });
  // name
  if (t.name && (t.nameShown || V.canControl(t))) {
    const nm = new PIXI.Text(t.name, textStyle(V.clamp(gs() * 0.25 * Math.max(1, Math.sqrt(t.size || 1)), 11, 64)));
    nm.anchor.set(0.5, 0); nm.position.set(0, bottom + 2); nm.resolution = 2;
    if (!t.nameShown) nm.alpha = 0.6;
    n.addChild(nm);
  }
  // conditions: small badges around the top-right
  (t.conditions || []).slice(0, 8).forEach((cname, i) => {
    const c = V.CONDITIONS.find(x => x[0] === cname) || [cname, cname.slice(0, 2), '#888888'];
    const br = Math.max(5, d * 0.13), a = -Math.PI / 2 + 0.55 + i * 0.5;
    const bx = Math.cos(a) * r, by = Math.sin(a) * r;
    const b = new PIXI.Graphics().lineStyle(Math.max(1, br * 0.15), 0x000000, 0.8).beginFill(hexNum(c[2])).drawCircle(bx, by, br).endFill();
    const tx = new PIXI.Text(c[1], textStyle(br * 1.05, { strokeThickness: 0, fill: 0x111111, fontFamily: 'Segoe UI, system-ui, sans-serif' }));
    tx.anchor.set(0.5); tx.position.set(bx, by); tx.resolution = 3;
    n.addChild(b, tx);
  });
  if ((t.conditions || []).includes('Dead')) body.alpha = 0.45;
  // the GM layer shows faintly; only the active layer can be clicked
  const active = V.isGM() ? t.layer === state.layer : (t.layer || 'tokens') === 'tokens';   // players work on the token layer only
  n.alpha = layerAlpha(t);
  n.eventMode = active ? 'static' : 'none';
  n.cursor = V.canControl(t) ? 'grab' : 'pointer';
  n.hitArea = ringOn || !ready ? new PIXI.Circle(0, 0, r) : new PIXI.Rectangle(-Math.max(half, r * 0.5), -Math.max(top, r * 0.5), Math.max(half, r * 0.5) * 2, Math.max(top, r * 0.5) + Math.max(bottom, r * 0.5));
  if (state.init.entries.length) {
    const cur = state.init.entries[state.init.turn];
    if (cur && cur.tokenId === t.id) {
      const turn = new PIXI.Graphics().lineStyle(Math.max(2, d * 0.04), 0xffffff, 0.9).drawCircle(0, 0, r + Math.max(6, d * 0.1));
      turn.alpha = 0.8; n.addChildAt(turn, 0);
    }
  }
}
// how strongly a token shows for the GM, given the layer they're working on: the GM layer faint unless it's the one
// in hand; working on the GM layer dims the rest; the map layer stays solid (it's the floor)
function layerAlpha(t) {
  if (!V.isGM()) return 1;
  if (t.layer === 'gm') return state.layer === 'gm' ? 0.85 : 0.4;
  if (state.layer === 'gm') return 0.55;
  if (state.layer === 'map' && t.layer !== 'map') return 0.6;
  return 1;
}
// ───────── props: scenery from the art tool (a chest, a cart, a tree), any width and height, under the creatures ─────────
const propDims = t => { const G = gs(); return [(t.w || t.size || 1) * G, (t.h || t.size || 1) * G]; };
const HANDLE = () => 9 / S();   // a handle's half-width, in map units (it stays the same size on screen)
const propHandles = t => V.isGM() && state.sel.size === 1 && state.sel.has(t.id) && (state.tool === 'select' || state.tool === 'art') && t.layer === state.layer;
function propKnob(t) { const [, H] = propDims(t); return [0, -H / 2 - 26 / S()]; }
function drawProp(t, n) {
  const [W, H] = propDims(t), sel = state.sel.has(t.id), gm = V.isGM();
  n.zIndex = (t._i || 0) - 1e6 + (t.layer === 'map' ? -2e6 : 0);   // under every creature (and the map layer under the rest)
  n.angle = t.rot || 0;
  const tex = t.img ? texCache.get(t.img) : null, ready = tex && !tex.then && tex !== 'error';
  if (ready) {
    tex.baseTexture.scaleMode = t.pixel ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR;
    const sp = new PIXI.Sprite(tex); sp.anchor.set(0.5); sp.width = W; sp.height = H; if (t.flip) sp.scale.x *= -1;
    n.addChild(sp);
  } else {
    const g = new PIXI.Graphics().lineStyle(Math.max(1, 2 / S()), 0xc9a45c, 0.7).beginFill(hexNum(t.color), 0.35).drawRect(-W / 2, -H / 2, W, H).endFill();
    n.addChild(g);
    if (t.img && !tex) loadTex(t.img).then(() => { const cur = state.scene && state.scene.tokens.get(t.id); if (cur) drawToken(cur); }).catch(() => {});
  }
  const fx = new PIXI.Graphics(), lw = Math.max(1.5, 2 / S());
  if (gm && t.container) {   // the GM sees which things hold something: a small chest mark in the corner
    const r = Math.max(6, 9 / S()), cx = W / 2 - r * 0.2, cy = -H / 2 + r * 0.2, cnt = (t.container.items || []).length;
    fx.lineStyle(lw * 0.8, 0x000000, 0.8).beginFill(t.container.locked ? 0x9b4a3a : 0xc9a45c).drawCircle(cx, cy, r).endFill();
    const lab = new PIXI.Text(cnt ? String(cnt) : t.container.table && !t.container.rolled ? '?' : '0', textStyle(r * 1.2, { strokeThickness: 0, fill: 0x111111, fontFamily: 'Segoe UI, system-ui, sans-serif' }));
    lab.anchor.set(0.5); lab.position.set(cx, cy); lab.resolution = 3; lab.angle = -(t.rot || 0); n.addChild(lab);
    n.addChildAt(fx, n.children.length - 1);
  } else n.addChild(fx);
  if (sel) {
    fx.lineStyle(lw, t.blocks ? 0xe0874a : 0xc9a45c, 1).drawRect(-W / 2, -H / 2, W, H);
    if (propHandles(t)) {
      const k = HANDLE(), [kx, ky] = propKnob(t);
      fx.lineStyle(lw, 0x1a1a1a, 1).beginFill(0xc9a45c).drawRect(W / 2 - k, H / 2 - k, k * 2, k * 2).endFill();   // resize
      fx.lineStyle(lw, 0xc9a45c, 1).moveTo(0, -H / 2).lineTo(kx, ky + k);
      fx.lineStyle(lw, 0x1a1a1a, 1).beginFill(0xc9a45c).drawCircle(kx, ky, k).endFill();                          // rotate
    }
  } else if (gm && t.blocks && state.tool === 'art') fx.lineStyle(lw, 0xe0874a, 0.6).drawRect(-W / 2, -H / 2, W, H);
  if (t.name && t.nameShown) {
    const nm = new PIXI.Text(t.name, textStyle(V.clamp(gs() * 0.22, 11, 48)));
    nm.anchor.set(0.5, 0); nm.position.set(0, H / 2 + 2); nm.resolution = 2; n.addChild(nm);
  }
  n.alpha = layerAlpha(t);
  // the GM picks it up on the layer they're working on; a player can only open a container (anything else lets clicks through to the floor)
  const active = gm ? t.layer === state.layer && (state.tool === 'select' || state.tool === 'art') : !!t.container && (t.layer || 'tokens') === 'tokens';
  n.eventMode = active ? 'static' : 'none';
  n.cursor = gm ? 'grab' : 'pointer';
  const ha = new PIXI.Rectangle(-W / 2, -H / 2, W, H);
  if (propHandles(t)) { const base = ha.contains.bind(ha), k = HANDLE() * 1.6, [kx, ky] = propKnob(t); ha.contains = (x, y) => base(x, y) || Math.hypot(x - kx, y - ky) < k || (Math.abs(x - W / 2) < k && Math.abs(y - H / 2) < k); }
  n.hitArea = ha;
}
// where a prop's grabbed handle is, if any: 'size' (bottom-right corner) or 'rot' (the knob above it)
function propHandleAt(t, global) {
  if (!t || !t.prop || !propHandles(t)) return null;
  const n = nodes.get(t.id); if (!n) return null;
  const lp = n.toLocal(global), [W, H] = propDims(t), k = HANDLE() * 1.6, [kx, ky] = propKnob(t);
  if (Math.hypot(lp.x - kx, lp.y - ky) < k) return 'rot';
  if (Math.abs(lp.x - W / 2) < k && Math.abs(lp.y - H / 2) < k) return 'size';
  return null;
}
// a prop snaps by its edges (whole squares when its size is whole, half squares otherwise); Alt places it freely
function propSnap(t, x, y) {
  const g = V.grid();
  if (!g || g.type !== 'square' || !(g.size > 0)) return [x, y];
  let w = t.w || t.size || 1, hh = t.h || t.size || 1;
  const a = ((Math.round(t.rot || 0) % 180) + 180) % 180;
  if (a === 90) [w, hh] = [hh, w]; else if (a !== 0) return [g.ox + Math.round((x - g.ox) / (g.size / 2)) * g.size / 2, g.oy + Math.round((y - g.oy) / (g.size / 2)) * g.size / 2];
  const ax = (c, o, len) => { const step = Math.abs(len - Math.round(len)) < 0.01 ? g.size : g.size / 2, half = len * g.size / 2; return o + Math.round((c - half - o) / step) * step + half; };
  return [ax(x, g.ox, w), ax(y, g.oy, hh)];
}
V.propSnap = propSnap;
V.snapToken = (t, x, y) => t.snap === false ? [x, y] : t.prop ? propSnap(t, x, y) : Geom.snap(V.grid(), x, y, t.size);   // (snap off: it goes where it's put)
on('tool', () => { if (state.scene) for (const t of state.scene.tokens.values()) if (t.prop) drawToken(t); });
on('init', () => { if (state.scene) renderTokens(); });
on('meta', () => { if (state.scene) renderTokens(); });
on('sceneMeta', () => { if (state.scene) renderTokens(); });

// --- templates ---
function renderTemplates() {
  for (const c of L.tpl.removeChildren()) c.destroy();
  L.cells.clear();
  if (!state.scene) return;
  for (const a of state.scene.templates.values()) drawTemplate(a, false);
}
function drawTemplate(a, preview, into) {
  const g = V.grid(), poly = Geom.templatePoly(g, a), col = hexNum(a.color || '#c9a45c');
  const gfx = into || new PIXI.Graphics();
  // squares a template touches (centre inside)
  const cells = into ? into : L.cells;
  if (g.type === 'square' && g.size > 4) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]); }
    const shape = { k: 'poly', pts: poly };
    cells.beginFill(col, 0.22);
    let n = 0;
    for (let i = Math.floor((x0 - g.ox) / g.size); i <= Math.floor((x1 - g.ox) / g.size) && n < 4000; i++)
      for (let j = Math.floor((y0 - g.oy) / g.size); j <= Math.floor((y1 - g.oy) / g.size) && n < 4000; j++, n++) {
        const cx = g.ox + (i + 0.5) * g.size, cy = g.oy + (j + 0.5) * g.size;
        if (Geom.inShape(shape, cx, cy)) cells.drawRect(g.ox + i * g.size, g.oy + j * g.size, g.size, g.size);
      }
    cells.endFill();
  }
  gfx.lineStyle(Math.max(1.5, gs() * 0.025), col, 0.95).beginFill(col, selTpl === a.id ? 0.28 : 0.12).drawPolygon(poly).endFill();
  if (!into) { gfx.tplId = a.id; L.tpl.addChild(gfx); }
  return gfx;
}
function templateAt(x, y) {
  if (!state.scene) return null;
  const list = [...state.scene.templates.values()].reverse();
  return list.find(a => Geom.inShape({ k: 'poly', pts: Geom.templatePoly(V.grid(), a) }, x, y)) || null;
}

// ───────────────────────── pointer tools ─────────────────────────

let drag = null;            // what the current press is doing
let press = null;           // { x, y, sx, sy, t, timer } for long-press pings
let spaceDown = false;
let selTpl = null;          // selected template id
let polyPts = [];           // fog polygon in progress
let lastTokClick = { id: null, t: 0 };
let fxThrottle = 0;

V.setTool = function (tool) {
  state.tool = tool;
  cancelAll();
  for (const b of V.$$('#tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
  renderSubtools(); hud();
  app.view.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  V.emit('tool', tool);
};
V.toolHandlers = {};   // tools defined elsewhere (walls, lights): { down(p, e) -> capture?, move(p, e, dragging), up(p, e), dbl(), key(e), subtools(box), hud() }
state.tplKind = 'cone'; state.fogMode = 'reveal'; state.fogShape = 'rect';
function renderSubtools() {
  const box = $('#subtools'), b = (label, on, fn, title) => h('button', { class: on ? 'on' : null, onclick: fn, title }, label);
  box.replaceChildren();
  if (V.toolHandlers[state.tool] && V.toolHandlers[state.tool].subtools) V.toolHandlers[state.tool].subtools(box);
  else if (state.tool === 'template') {
    for (const [k, l] of [['cone', 'Cone'], ['circle', 'Sphere'], ['line', 'Line'], ['square', 'Cube']]) box.append(b(l, state.tplKind === k, () => { state.tplKind = k; renderSubtools(); hud(); }));
  } else if (state.tool === 'fog' && V.isGM()) {
    box.append(b('Reveal', state.fogMode === 'reveal', () => { state.fogMode = 'reveal'; renderSubtools(); hud(); }),
      b('Hide', state.fogMode === 'hide', () => { state.fogMode = 'hide'; renderSubtools(); hud(); }), h('div', { class: 'sep' }),
      b('Box', state.fogShape === 'rect', () => { state.fogShape = 'rect'; polyPts = []; drawDraft(); renderSubtools(); hud(); }),
      b('Shape', state.fogShape === 'poly', () => { state.fogShape = 'poly'; renderSubtools(); hud(); }, 'Click points, double-click or Enter to finish'),
      h('div', { class: 'sep' }),
      b('Reveal all', false, () => fogAll(true)), b('Hide all', false, () => fogAll(false)),
      h('div', { class: 'sep' }),
      b(state.scene && state.scene.meta.fog ? 'Fog on' : 'Fog off', state.scene && state.scene.meta.fog, () => state.scene && V.op({ t: 'scene.update', id: state.scene.id, patch: { fog: !state.scene.meta.fog } }).then(renderSubtools), 'Switch fog of war on or off for this scene'));
  }
  box.hidden = !box.children.length;
}
on('sceneMeta', renderSubtools); on('scene', renderSubtools);
function fogAll(reveal) {
  if (!state.scene) return;
  const { w, h } = V.sceneSize();
  V.op({ t: 'fog.set', scene: state.scene.id, shapes: reveal ? [{ mode: 'reveal', k: 'rect', x: -w, y: -h, w: w * 3, h: h * 3 }] : [] });
}
function hud(extra) {
  const tips = {
    select: V.isGM() ? `${state.layer === 'gm' ? 'GM layer · ' : state.layer === 'map' ? 'Map layer · ' : ''}Drag tokens · double-click for sheet · right-click for tools · hold to ping (Shift: pull everyone here)` : V.isGuest() ? 'Watching: you see what the players see · scroll to zoom, drag to look around' : 'Drag your tokens · double-click for sheet · right-click for tools · hold to ping',
    ruler: 'Drag to measure',
    template: `Drag out a ${{ cone: 'cone', circle: 'sphere', line: 'line', square: 'cube' }[state.tplKind]} · Delete removes a selected one`,
    fog: state.fogShape === 'rect' ? `Drag a box to ${state.fogMode}` : `Click points to ${state.fogMode}; double-click or Enter to finish`
  };
  const ext = V.toolHandlers[state.tool];
  $('#hud').textContent = extra || (ext && ext.hud ? ext.hud() : tips[state.tool]) || '';
}
V.renderSubtools = () => renderSubtools();
V.hud = hud;

function cancelAll() {
  if (press) { clearTimeout(press.timer); press = null; }
  if (drag && drag.kind === 'tokens') for (const id of drag.ids) { const n = nodes.get(id), t = state.scene && state.scene.tokens.get(id); if (n && t) n.position.set(t.x, t.y); }
  if (drag && (drag.kind === 'propsize' || drag.kind === 'proprot')) { const t = state.scene && state.scene.tokens.get(drag.id); if (t) { t.w = drag.w0; t.h = drag.h0; t.rot = drag.rot0; const dd = drag; drag = null; drawToken(t); drag = dd; } }
  if (drag && drag.kind === 'ruler') V.fire({ t: 'fx', kind: 'ruler', scene: state.scene && state.scene.id, pts: [] });
  drag = null; polyPts = []; selTpl = null;
  if (L.draw) { L.draw.clear(); L.label.visible = false; renderTemplates(); }
}

function onDown(e) {
  if (!state.scene) return;
  const p = toWorld(e.global);
  if (e.button === 1 || e.button === 2 || spaceDown) { drag = { kind: 'pan', sx: e.global.x, sy: e.global.y, wx: world.x, wy: world.y }; app.view.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  const ext = V.toolHandlers[state.tool];
  if (ext) { if (ext.down(p, e)) drag = { kind: 'ext', ext }; return; }
  if (state.tool === 'select' && V.mapEdit && V.mapEdit.on() && !e.shiftKey && V.mapEdit.down(p, e)) { drag = { kind: 'ext', ext: V.mapEdit }; return; }   // the map layer: its furniture
  startPress(e, p);
  const tool = state.tool;
  if (tool === 'select') {
    const a = templateAt(p.x, p.y);
    if (a && (V.isGM() || a.owner === state.me.id) && !e.shiftKey) { selTpl = a.id; renderTemplates(); drag = { kind: 'tplmove', id: a.id, origin: [p.x, p.y], start: [a.x, a.y] }; return; }
    if (selTpl) { selTpl = null; renderTemplates(); }
    if (!e.shiftKey) setSel([]);
    // a finger on empty floor moves the map (there's no mouse wheel or right button on a phone); a mouse draws a box
    if (e.pointerType === 'touch') { drag = { kind: 'pan', sx: e.global.x, sy: e.global.y, wx: world.x, wy: world.y }; return; }
    drag = { kind: 'marquee', a: [p.x, p.y], b: [p.x, p.y] };
  } else if (tool === 'ruler') {
    drag = { kind: 'ruler', pts: [[p.x, p.y], [p.x, p.y]] };
  } else if (tool === 'template') {
    const [sx, sy] = state.tplKind === 'circle' || state.tplKind === 'cone' || state.tplKind === 'line' || state.tplKind === 'square' ? Geom.snap(V.grid(), p.x, p.y, 2) : [p.x, p.y];
    drag = { kind: 'tpl', a: [sx, sy], b: [p.x, p.y] };
  } else if (tool === 'fog' && V.isGM()) {
    if (state.fogShape === 'rect') drag = { kind: 'fogrect', a: [p.x, p.y], b: [p.x, p.y] };
    else { polyPts.push([p.x, p.y]); drawDraft(); }
  }
}

let tokRight = null;   // a right-click on a token opens its menu (if the mouse didn't move to pan)
function onTokenDown(e, id) {
  if (e.button === 2) { tokRight = { id, sx: e.global.x, sy: e.global.y, cx: e.clientX, cy: e.clientY }; return; }
  const t0 = state.scene && state.scene.tokens.get(id);
  if (!(state.tool === 'select' || (state.tool === 'art' && t0 && t0.prop)) || e.button !== 0 || spaceDown) return;
  e.stopPropagation();
  const t = t0; if (!t) return;
  const p = toWorld(e.global);
  if (t.container && !V.isGM()) { V.openContainer && V.openContainer(id); return; }   // a player opens a chest
  const handle = propHandleAt(t, e.global);
  if (handle) { drag = { kind: handle === 'rot' ? 'proprot' : 'propsize', id, w0: t.w || t.size || 1, h0: t.h || t.size || 1, rot0: t.rot || 0 }; return; }
  startPress(e, p, e.pointerType === 'touch' ? id : null);
  const now = performance.now();
  if (lastTokClick.id === id && now - lastTokClick.t < 380) { lastTokClick = { id: null, t: 0 }; V.tokenOpen(id); return; }
  lastTokClick = { id, t: now };
  if (e.shiftKey) { const s = new Set(state.sel); s.has(id) ? s.delete(id) : s.add(id); setSel([...s]); }
  else if (!state.sel.has(id)) setSel([id]);
  const ids = [...state.sel].filter(x => { const tt = state.scene.tokens.get(x); return V.canControl(tt) && (!V.isGM() || tt.layer === state.layer); });
  if (t.item && !V.canControl(t) && V.showItemCard) { V.showItemCard(t.item, { token: id }); return; }   // loot: its card
  if (!ids.includes(id) || !V.canControl(t)) return;
  drag = { kind: 'tokens', ids, lead: id, origin: [p.x, p.y], start: new Map(ids.map(x => { const tt = state.scene.tokens.get(x); return [x, [tt.x, tt.y]]; })), moved: false };
}

function startPress(e, p, tokenId) {
  if (press) clearTimeout(press.timer);
  press = { x: p.x, y: p.y, sx: e.global.x, sy: e.global.y, shift: e.shiftKey };
  press.timer = setTimeout(() => {
    if (!press) return;
    if (tokenId) {   // a finger held on a token: its ring of tools (what right-click does with a mouse)
      press = null; if (drag) { drag = null; L.draw.clear(); L.label.visible = false; }
      const tok = state.scene.tokens.get(tokenId); if (tok) drawToken(tok);
      V.tokenMenu(tokenId, V.tokenRect(tokenId) || { left: e.clientX, top: e.clientY, width: 0, height: 0 });
      return;
    }
    const look = press.shift && V.isGM();
    ping(press.x, press.y, state.me.color, look ? 'look' : 'ping');
    V.fire({ t: 'fx', kind: look ? 'look' : 'ping', scene: state.scene.id, x: press.x, y: press.y });
    if (drag && drag.kind !== 'pan') { cancelAll(); }
    press = null;
  }, 550);
}

function onMove(e) {
  if (press && Math.hypot(e.global.x - press.sx, e.global.y - press.sy) > 6) { clearTimeout(press.timer); press = null; }
  const ext = V.toolHandlers[state.tool];
  if (ext && ext.move && (!drag || drag.kind === 'ext')) { ext.move(toWorld(e.global), e, !!drag); return; }
  if (drag && drag.kind === 'ext' && drag.ext === V.mapEdit) { V.mapEdit.move(toWorld(e.global), e, true); return; }
  if (!drag) { if (V.mapEdit && V.mapEdit.on() && !spaceDown) V.mapEdit.hover(toWorld(e.global)); return; }
  const p = toWorld(e.global);
  switch (drag.kind) {
    case 'pan':
      world.position.set(drag.wx + e.global.x - drag.sx, drag.wy + e.global.y - drag.sy); saveCam(); return;
    case 'propsize': case 'proprot': {
      const t = state.scene.tokens.get(drag.id), n = nodes.get(drag.id); if (!t || !n) { drag = null; return; }
      if (drag.kind === 'propsize') {   // from the middle out: the corner follows the pointer (Shift keeps the shape; Alt: no snapping)
        const lp = n.toLocal(e.global), G = gs();
        let w = Math.max(0.05, Math.abs(lp.x) * 2 / G), hh = Math.max(0.05, Math.abs(lp.y) * 2 / G);
        if (e.shiftKey) { const k = Math.max(w / drag.w0, hh / drag.h0); w = drag.w0 * k; hh = drag.h0 * k; }
        if (!e.altKey && t.snap !== false) { const q = v => Math.max(0.25, Math.round(v * 4) / 4); if (e.shiftKey) { const k = q(w) / w; w = q(w); hh = hh * k; } else { w = q(w); hh = q(hh); } }
        t.w = Math.round(w * 1000) / 1000; t.h = Math.round(hh * 1000) / 1000;
        showLabel(`${+t.w.toFixed(2)} × ${+t.h.toFixed(2)} squares`, t.x, t.y);
      } else {   // turn it (15° steps; Alt: freely)
        let a = Math.atan2(p.y - t.y, p.x - t.x) * 180 / Math.PI + 90;
        if (!e.altKey) a = Math.round(a / 15) * 15;
        a = ((a + 180) % 360 + 360) % 360 - 180;
        t.rot = Math.round(a * 10) / 10;
        showLabel(`${Math.round(t.rot)}°`, t.x, t.y);
      }
      drag.changed = true; drawToken(t);
      return;
    }
    case 'tokens': {
      const dx = p.x - drag.origin[0], dy = p.y - drag.origin[1];
      if (!drag.moved && Math.hypot(dx, dy) * S() < 4) return;
      drag.moved = true;
      for (const id of drag.ids) { const n = nodes.get(id), s0 = drag.start.get(id); if (n) n.position.set(s0[0] + dx, s0[1] + dy); }
      V.emit('tokenDrag');   // sight follows your token as you drag it
      const s0 = drag.start.get(drag.lead), cur = [s0[0] + dx, s0[1] + dy];
      L.draw.clear().lineStyle(Math.max(2, gs() * 0.03), 0xffffff, 0.7).moveTo(s0[0], s0[1]).lineTo(cur[0], cur[1]);
      const t = state.scene.tokens.get(drag.lead);
      const snapped = e.altKey || !t ? cur : V.snapToken(t, cur[0], cur[1]);
      showLabel(distText([s0, snapped]), cur[0], cur[1] - (t ? t.size * gs() / 2 : 0));
      const now = performance.now();
      if (now - fxThrottle > 60) { fxThrottle = now; for (const id of drag.ids) { const n = nodes.get(id); V.fire({ t: 'fx', kind: 'drag', scene: state.scene.id, tokenId: id, x: n.x, y: n.y }); } }
      return;
    }
    case 'marquee': {
      drag.b = [p.x, p.y];
      const [ax, ay] = drag.a;
      L.draw.clear().lineStyle(1 / S(), 0xc9a45c, 1).beginFill(0xc9a45c, 0.08).drawRect(Math.min(ax, p.x), Math.min(ay, p.y), Math.abs(p.x - ax), Math.abs(p.y - ay)).endFill();
      return;
    }
    case 'ruler':
      drag.pts[drag.pts.length - 1] = [p.x, p.y]; drawRuler();
      if (performance.now() - fxThrottle > 60) { fxThrottle = performance.now(); V.fire({ t: 'fx', kind: 'ruler', scene: state.scene.id, pts: drag.pts }); }
      return;
    case 'tpl': {
      drag.b = [p.x, p.y];
      L.draw.clear(); drawTemplate(tplFromDrag(), true, L.draw);
      const a = tplFromDrag();
      showLabel(`${Math.round(a.len)} ${V.grid().units || 'ft'}`, p.x, p.y);
      return;
    }
    case 'tplmove': {
      const a = state.scene.templates.get(drag.id); if (!a) return;
      drag.to = Geom.snap(V.grid(), drag.start[0] + p.x - drag.origin[0], drag.start[1] + p.y - drag.origin[1], 2);
      L.draw.clear(); drawTemplate(Object.assign({}, a, { x: drag.to[0], y: drag.to[1] }), true, L.draw);
      return;
    }
    case 'fogrect': {
      drag.b = [p.x, p.y];
      const [ax, ay] = drag.a, col = state.fogMode === 'reveal' ? 0x9fd6e8 : 0x000000;
      L.draw.clear().lineStyle(2 / S(), 0x9fd6e8, 1).beginFill(col, 0.25).drawRect(Math.min(ax, p.x), Math.min(ay, p.y), Math.abs(p.x - ax), Math.abs(p.y - ay)).endFill();
      return;
    }
  }
}

function onUp(e) {
  if (press) { clearTimeout(press.timer); press = null; }
  if (tokRight) {
    const r = tokRight; tokRight = null;
    if (e.button === 2 && Math.hypot(e.global.x - r.sx, e.global.y - r.sy) < 5) { if (drag && drag.kind === 'pan') { drag = null; app.view.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; } V.tokenMenu(r.id, V.tokenRect(r.id) || { left: r.cx, top: r.cy, width: 0, height: 0 }); return; }
  }
  const d = drag; drag = null;
  if (!d) return;
  const p = toWorld(e.global);
  switch (d.kind) {
    case 'ext': if (d.ext.up) d.ext.up(p, e); return;
    case 'pan': app.view.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; return;
    case 'propsize': case 'proprot': {
      L.label.visible = false;
      const t = state.scene.tokens.get(d.id); if (!t || !d.changed) return;
      const patch = d.kind === 'propsize' ? { w: t.w, h: t.h } : { rot: t.rot };
      t.w = d.w0; t.h = d.h0; t.rot = d.rot0;   // until the table agrees
      V.op({ t: 'token.update', scene: state.scene.id, id: d.id, patch }).catch(() => drawToken(t));
      return;
    }
    case 'tokens': {
      L.draw.clear(); L.label.visible = false;
      if (!d.moved) { const t = d.ids.length === 1 && state.scene.tokens.get(d.lead); if (t && t.item && V.showItemCard && !e.shiftKey) V.showItemCard(t.item, { token: t.id }); return; }
      const dx = p.x - d.origin[0], dy = p.y - d.origin[1], ops = [];
      for (const id of d.ids) {
        const t = state.scene.tokens.get(id); if (!t) continue;
        const s0 = d.start.get(id);
        const [x, y] = e.altKey ? [s0[0] + dx, s0[1] + dy] : V.snapToken(t, s0[0] + dx, s0[1] + dy);
        const n = nodes.get(id); if (n) n.position.set(x, y);
        ops.push({ t: 'token.update', scene: state.scene.id, id, patch: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } });
      }
      V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops }).catch(() => { for (const id of d.ids) { const t = state.scene.tokens.get(id); if (t) drawToken(t); } V.emit('tokenDrag'); });
      return;
    }
    case 'marquee': {
      L.draw.clear();
      const [ax, ay] = d.a, [bx, by] = [p.x, p.y];
      if (Math.abs(bx - ax) * S() < 4 && Math.abs(by - ay) * S() < 4) return;
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      const ids = [...state.scene.tokens.values()].filter(t => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 && (!V.isGM() || t.layer === state.layer) && (V.isGM() || V.canControl(t))).map(t => t.id);
      setSel(e.shiftKey ? [...new Set([...state.sel, ...ids])] : ids);
      return;
    }
    case 'ruler':
      setTimeout(() => { if (!drag || drag.kind !== 'ruler') { L.draw.clear(); L.label.visible = false; } }, 1600);
      V.fire({ t: 'fx', kind: 'ruler', scene: state.scene.id, pts: [] });
      return;
    case 'tpl': {
      L.draw.clear(); L.label.visible = false;
      const a = tplFromDrag(d);
      if (a.len < 1) return;
      V.op({ t: 'template.create', scene: state.scene.id, tpl: a }).then(r => { if (r.op && r.op.tpl) { selTpl = r.op.tpl.id; renderTemplates(); } });
      return;
    }
    case 'tplmove': {
      L.draw.clear();
      if (d.to) V.op({ t: 'template.update', scene: state.scene.id, id: d.id, patch: { x: d.to[0], y: d.to[1] } });
      return;
    }
    case 'fogrect': {
      L.draw.clear();
      const [ax, ay] = d.a;
      if (Math.abs(p.x - ax) * S() < 4 || Math.abs(p.y - ay) * S() < 4) return;
      V.op({ t: 'fog.add', scene: state.scene.id, shape: { mode: state.fogMode, k: 'rect', x: Math.min(ax, p.x), y: Math.min(ay, p.y), w: Math.abs(p.x - ax), h: Math.abs(p.y - ay) } });
      return;
    }
  }
}
function onDbl() {
  const ext = V.toolHandlers[state.tool]; if (ext && ext.dbl) { ext.dbl(); return; }
  if (state.tool === 'fog' && state.fogShape === 'poly') finishPoly();
}
function finishPoly() {
  // the double-click adds two extra points at the same spot; drop them
  const pts = polyPts.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) * S() > 3);
  polyPts = []; L.draw.clear();
  if (pts.length < 3) return;
  V.op({ t: 'fog.add', scene: state.scene.id, shape: { mode: state.fogMode, k: 'poly', pts: pts.flat() } });
}
function drawDraft() {
  L.draw.clear();
  if (!polyPts.length) return;
  L.draw.lineStyle(2 / S(), 0x9fd6e8, 1).beginFill(state.fogMode === 'reveal' ? 0x9fd6e8 : 0x000000, 0.2);
  L.draw.moveTo(polyPts[0][0], polyPts[0][1]);
  for (const q of polyPts.slice(1)) L.draw.lineTo(q[0], q[1]);
  L.draw.endFill();
  for (const q of polyPts) L.draw.beginFill(0x9fd6e8).drawCircle(q[0], q[1], 4 / S()).endFill();
}

function tplFromDrag(d) {
  d = d || drag;
  const [ax, ay] = d.a, [bx, by] = d.b, g = V.grid();
  const px = Math.hypot(bx - ax, by - ay);
  let len = px / gs() * (g.feet || 5);
  const step = g.feet || 5;
  len = Math.max(step, Math.round(len / step) * step);
  if (state.tplKind === 'circle') len = Math.max(step, len);
  return { kind: state.tplKind, x: ax, y: ay, angle: Math.atan2(by - ay, bx - ax), len, width: g.feet || 5, color: state.me.color || '#c9a45c' };
}

function distText(pts) {
  const g = V.grid(), r = Geom.pathLength(g, pts);
  const unit = g.units || 'ft', cellWord = g.type === 'hexr' || g.type === 'hexc' ? 'hex' : 'sq';
  const n = Math.round(r.units * 10) / 10;
  return g.type === 'none' || g.diagonal === 'euclid' ? `${n} ${unit}` : `${n} ${unit} · ${Math.round(r.cells * 10) / 10} ${cellWord}`;
}
function showLabel(text, x, y) { L.label.text = text; L.label.position.set(x, y); L.label.scale.set(1 / S()); L.label.visible = true; }
function drawRuler() {
  const pts = drag.pts;
  L.draw.clear();
  drawRulerInto(L.draw, pts, hexNum(state.me.color || '#c9a45c'));
  const end = pts[pts.length - 1];
  showLabel(distText(pts), end[0], end[1]);
}
function drawRulerInto(gfx, pts, col) {
  const w = 3 / S();
  gfx.lineStyle(w + 2 / S(), 0x000000, 0.6).moveTo(pts[0][0], pts[0][1]);
  for (const q of pts.slice(1)) gfx.lineTo(q[0], q[1]);
  gfx.lineStyle(w, col, 1).moveTo(pts[0][0], pts[0][1]);
  for (const q of pts.slice(1)) gfx.lineTo(q[0], q[1]);
  for (const q of [pts[0], pts[pts.length - 1]]) gfx.lineStyle(0).beginFill(col).drawCircle(q[0], q[1], 5 / S()).endFill();
}

// ───────────────────────── selection ─────────────────────────

function setSel(ids) {
  const before = new Set(state.sel);
  state.sel = new Set(ids);
  for (const id of new Set([...before, ...state.sel])) { const t = state.scene && state.scene.tokens.get(id); if (t) drawToken(t); }
  V.emit('sel');
}
V.setSel = setSel;
V.selectedTokens = () => [...state.sel].map(id => state.scene && state.scene.tokens.get(id)).filter(Boolean);

// ───────────────────────── pings and other people's actions ─────────────────────────

const pings = [];
function ping(x, y, color, kind) {
  const g = new PIXI.Graphics();
  L.fx.addChild(g);
  pings.push({ g, x, y, col: hexNum(color || '#c9a45c'), t0: performance.now(), look: kind === 'look' });
}
function tick() {
  const now = performance.now();
  if (V.lightingTick) V.lightingTick(now);
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i], k = (now - p.t0) / 1600;
    if (k >= 1) { p.g.destroy(); pings.splice(i, 1); continue; }
    const base = 60 / S();
    p.g.clear();
    for (let j = 0; j < 3; j++) {
      const kk = (k * 1.6 + j * 0.25) % 1;
      p.g.lineStyle(3 / S(), p.col, (1 - kk) * (1 - k * 0.5)).drawCircle(p.x, p.y, base * (0.2 + kk));
    }
    if (p.look) p.g.lineStyle(2 / S(), 0xffffff, 1 - k).drawCircle(p.x, p.y, base * 1.4);
  }
}
on('fx', m => {
  if (!state.scene || m.scene !== state.scene.id) return;
  if (m.kind === 'ping') ping(m.x, m.y, m.color, 'ping');
  else if (m.kind === 'look') { ping(m.x, m.y, m.color, 'look'); V.centreOn(m.x, m.y, true); }
  else if (m.kind === 'drag') { const n = nodes.get(m.tokenId); if (n && !(drag && drag.kind === 'tokens' && drag.ids.includes(m.tokenId))) n.position.set(m.x, m.y); }
  else if (m.kind === 'ruler') {
    let o = others.get(m.from);
    if (!o) { o = { g: new PIXI.Graphics(), label: mkLabel() }; L.over.addChild(o.g, o.label); others.set(m.from, o); }
    clearTimeout(o.timer);
    o.g.clear(); o.label.visible = false;
    if (m.pts && m.pts.length > 1) {
      drawRulerInto(o.g, m.pts, hexNum(m.color));
      const end = m.pts[m.pts.length - 1];
      o.label.text = `${m.name}: ${distText(m.pts)}`; o.label.position.set(end[0], end[1]); o.label.scale.set(1 / S()); o.label.visible = true;
      o.timer = setTimeout(() => { o.g.clear(); o.label.visible = false; }, 5000);
    }
  }
});

// ───────────────────────── files dropped on the map (GM): new tokens ─────────────────────────

// the middle of what's on screen, on the map
V.viewCenter = function () { const r = app.view.getBoundingClientRect(); return V.worldAt(r.left + r.width / 2, r.top + r.height / 2); };
// a point on the page → the map; the topmost token there
V.worldAt = function (cx, cy) { const r = app.view.getBoundingClientRect(); const p = toWorld(new PIXI.Point(cx - r.left, cy - r.top)); return { x: p.x, y: p.y }; };
V.tokenAt = function (x, y) {
  const list = V.tokensSorted().slice().reverse();
  return list.find(t => { const n = nodes.get(t.id); if (!n || !n.hitArea || n.eventMode === 'none') return false; const lp = n.toLocal(world.toGlobal(new PIXI.Point(x, y))); return n.hitArea.contains(lp.x, lp.y); }) || null;
};
async function onDropFiles(e) {
  if (V.itemDragType && e.dataTransfer.types.includes(V.itemDragType)) { e.preventDefault(); return V.dropItemOnMap && V.dropItemOnMap(e); }
  if (V.spellDragType && e.dataTransfer.types.includes(V.spellDragType)) {   // a spell onto a token with a sheet: learnt
    e.preventDefault();
    const sp = V.readSpellDrag(e), p = V.worldAt(e.clientX, e.clientY), t = V.tokenAt(p.x, p.y);
    if (sp && t && t.sheet) return V.learnSpell(t.sheet, sp);
    return V.toast('Drop a spell on a character’s token, their sheet or their name in the Journal', true);
  }
  if (!V.isGM()) return;
  e.preventDefault();
  if (!state.scene) return V.toast('Make a scene first', true);
  if (V.artDragType && e.dataTransfer.types.includes(V.artDragType)) {   // a picture from the art library
    let a = null; try { a = JSON.parse(e.dataTransfer.getData(V.artDragType)); } catch (err) {}
    const p = V.worldAt(e.clientX, e.clientY);
    if (a) V.placeArt(a, p.x, p.y);
    return;
  }
  const cid = V.charDragType && e.dataTransfer.getData(V.charDragType);
  if (cid) {   // a character from the Characters tab: a token linked to its sheet
    const ch = (state.camp.characters || []).find(x => x.id === cid); if (!ch) return;
    const r = app.view.getBoundingClientRect();
    const p = toWorld(new PIXI.Point(e.clientX - r.left, e.clientY - r.top));
    const [x, y] = Geom.snap(V.grid(), p.x, p.y, 1);
    const res = await V.op({ t: 'token.create', scene: state.scene.id, token: { name: ch.name, sheet: ch.id, img: (await V.charTokenImg(ch)) || null, x, y, size: 1, layer: state.layer === 'gm' ? 'gm' : 'tokens' } }).catch(() => null);
    if (res && res.op && res.op.token) setSel([res.op.token.id]);
    return;
  }
  const files = [...e.dataTransfer.files].filter(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
  if (!files.length) return V.toast('Drop PNG, JPG or WebP images to make tokens or scenery', true);
  const p = V.worldAt(e.clientX, e.clientY);
  if (V.dropImages) return V.dropImages(files, p, e.clientX, e.clientY);
  return V.imagesAsTokens(files, p);
}
// pictures as creature tokens, a square each, side by side
V.imagesAsTokens = async function (files, p) {
  let i = 0;
  for (const f of files) {
    try {
      const url = await V.upload(f);
      const [x, y] = Geom.snap(V.grid(), p.x + i * gs(), p.y, 1);
      await V.op({ t: 'token.create', scene: state.scene.id, token: { name: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), img: url, x, y, size: 1, layer: state.layer } });
      i++;
    } catch (err) { V.toast(err.message, true); }
  }
};

V.addToken = async function () {
  if (!state.scene) return;
  const c = world.toLocal(new PIXI.Point(app.screen.width / 2, app.screen.height / 2));
  const [x, y] = Geom.snap(V.grid(), c.x, c.y, 1);
  const cols = ['#8a6d3b', '#5b6e8a', '#7e3f56', '#4f7f5a', '#8a5a3b', '#5a5a8a'];
  const r = await V.op({ t: 'token.create', scene: state.scene.id, token: { name: 'New token', x, y, size: 1, layer: state.layer, color: cols[Math.floor(Math.random() * cols.length)] } });
  if (r.op && r.op.token) { setSel([r.op.token.id]); V.openTokenPanel(r.op.token.id); }
};
// a token's picture on screen: { left, top, width, height } in page pixels
V.tokenRect = function (id) {
  const n = nodes.get(id); if (!n || !n.hitArea) return null;
  const a = n.hitArea, r = app.view.getBoundingClientRect();
  const [x0, y0, x1, y1] = a.radius != null ? [a.x - a.radius, a.y - a.radius, a.x + a.radius, a.y + a.radius] : [a.x, a.y, a.x + a.width, a.y + a.height];
  const p0 = n.toGlobal(new PIXI.Point(x0, y0)), p1 = n.toGlobal(new PIXI.Point(x1, y1));
  return { left: Math.min(p0.x, p1.x) + r.left, top: Math.min(p0.y, p1.y) + r.top, width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y) };
};
V.screenOf = function (x, y) { const p = world.toGlobal(new PIXI.Point(x, y)); const r = app.view.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; };

// ───────────────────────── keyboard ─────────────────────────

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !V.isTyping()) { spaceDown = true; if (!drag) app.view.style.cursor = 'grab'; e.preventDefault(); return; }
  if (V.isTyping() || !V.$('#app') || V.$('#app').hidden || !V.$('#modal').hidden) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); V.undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); V.redo(); return; }
  if (ctrl || e.altKey) return;
  const ext = V.toolHandlers[state.tool];
  if (ext && ext.key && ext.key(e)) { e.preventDefault(); return; }
  if (V.mapEdit && V.mapEdit.on() && !state.sel.size && V.mapEdit.key(e)) { e.preventDefault(); return; }
  if (e.key === 'Escape') { if (polyPts.length) { polyPts = []; L.draw.clear(); } else if (drag) cancelAll(); else { setSel([]); if (selTpl) { selTpl = null; renderTemplates(); } } return; }
  if (e.key === 'Enter' && polyPts.length) { finishPoly(); return; }
  if (!state.scene) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selTpl) { const id = selTpl; selTpl = null; V.op({ t: 'template.delete', scene: state.scene.id, id }); e.preventDefault(); return; }
    if (V.isGM() && state.sel.size) {
      e.preventDefault();
      const ops = [...state.sel].map(id => ({ t: 'token.delete', scene: state.scene.id, id }));
      V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops });
    }
    return;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir && state.sel.size) {
    e.preventDefault();
    const g = V.grid(), step = g.type === 'none' ? gs() / 4 : gs() * (e.shiftKey ? 0.2 : 1);
    const ops = V.selectedTokens().filter(V.canControl).map(t => ({ t: 'token.update', scene: state.scene.id, id: t.id, patch: { x: t.x + dir[0] * step, y: t.y + dir[1] * step } }));
    if (ops.length) V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops });
    return;
  }
  const tool = { v: 'select', r: 'ruler', t: 'template', f: 'fog', w: 'walls', b: 'lights', n: 'sounds', a: 'art', p: 'plan' }[k];
  if (tool && (!['fog', 'walls', 'lights', 'sounds', 'art', 'plan'].includes(tool) || V.isGM()) && !((tool === 'art' || tool === 'plan') && V.inWorldScene && V.inWorldScene())) { V.setTool(tool); return; }
  if (k === 'j' && V.inWorldScene && V.inWorldScene()) { V.setTool('journey'); return; }
  if (k === 'l' && V.isGM()) { V.toggleLayer(); return; }
  if (k === '0') { V.fit(); return; }
  if (k === 'e' && state.sel.size === 1) { V.openTokenPanel([...state.sel][0]); }
  if ((e.key === '[' || e.key === ']') && V.isGM() && state.sel.size) V.scaleTokens(e.key === ']' ? 1 : -1, e.shiftKey);
});
// [ and ] shrink and grow the selected tokens' pictures (Shift: finer steps)
V.scaleTokens = function (dir, fine) {
  const ops = V.selectedTokens().map(t => {
    const cur = t.scale || 1, k = fine ? 1.02 : 1.1;
    return { t: 'token.update', scene: state.scene.id, id: t.id, patch: { scale: V.clamp(Math.round(cur * (dir > 0 ? k : 1 / k) * 100) / 100, 0.1, 6) } };
  });
  if (ops.length) V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops });
};
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; if (!drag) app.view.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'; } });
window.addEventListener('blur', () => { spaceDown = false; });

// three layers, like paper on a table: the map (scenery the GM lays down: it sits in the light and the dark like the
// floor), the tokens (what's in play), and the GM's (only the GM sees it). The GM works on one at a time.
const LAYERS = ['map', 'tokens', 'gm'];
V.LAYERS = LAYERS;
V.setLayer = function (k) {
  if (!LAYERS.includes(k)) k = 'tokens';
  state.layer = k;
  setSel([]);
  for (const b of document.querySelectorAll('#layerDock button')) b.classList.toggle('on', b.dataset.layer === k);
  document.body.dataset.layer = k;
  V.emit('layer', k);
  if (state.scene) renderTokens();
  if (V.drawGMOverlay) V.drawGMOverlay();
  hud();
};
V.toggleLayer = function () { V.setLayer(LAYERS[(LAYERS.indexOf(state.layer) + 1) % LAYERS.length]); };   // L: the next layer
V.stageApp = () => app;
V.stage = { L, get world() { return world; }, get app() { return app; }, nodes, toWorld: p => toWorld(p), scale: () => S(), gs: () => gs(), setSel: ids => setSel(ids), hud: x => hud(x), loadTex: u => loadTex(u) };
})();
