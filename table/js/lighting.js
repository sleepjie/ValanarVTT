/* Light and sight on the map: darkness with lit holes, coloured light, what players' tokens can see (and what they've
 * explored), doors anyone can click, and the GM's wall and light tools. The maths is in shared/vision.js. */
'use strict';
(function () {
const { $, h, state, on } = V;
const ST = () => V.stage;
const losCache = new Map();
const hexNum = c => parseInt(String(c || '#ffffff').slice(1), 16);
const rgb = c => { const n = hexNum(c); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
state.wallKind = 'wall'; state.wallSnap = true; state.viewAs = null;
// the GM normally sees through darkness (dimly); off, they see it exactly as the table does
try { state.gmSeeDark = localStorage.getItem('vtt-gm-see-dark') !== '0'; } catch (e) { state.gmSeeDark = true; }
let selWall = null, selLight = null, chain = null, hover = null, dirty = true, animOn = false, lastAnim = 0;

const WALL_KINDS = [['wall', 'Wall', 0xe8e2d0], ['door', 'Door', 0xd9a441], ['secret', 'Secret door', 0xb466e0],
  ['window', 'Window', 0x6cc6e8], ['invisible', 'Invisible', 0x8fd18f], ['oneway', 'One-way', 0xe07b39], ['shade', 'House wall', 0x9a8cff]];
const kindCol = k => (WALL_KINDS.find(x => x[0] === k) || WALL_KINDS[0])[2];
const ANIMS = [['none', 'Steady'], ['torch', 'Torch'], ['candle', 'Candle'], ['pulse', 'Pulse'], ['fairy', 'Fairy'], ['sunbeam', 'Sunbeam']];

// ───────────────────────── what to draw ─────────────────────────

const walls = () => state.scene ? [...state.scene.walls.values()] : [];
// a token's light goes where the token is right now (it may be mid-drag)
const lights = () => state.scene ? [...state.scene.lights.values()].map(l => { const n = l.token && ST().nodes.get(l.token); return n ? Object.assign({}, l, { x: n.x, y: n.y }) : l; }) : [];
function sceneObj() { return Object.assign({}, state.scene.meta, { walls: walls(), lights: lights(), tokens: [...state.scene.tokens.values()] }); }   // (tokens: props can block light)
// whose eyes the map is drawn through: mine (player), a player's (GM previewing), or nobody's (GM: all)
function eyes() {
  if (!state.scene || !state.scene.meta.vision) return null;
  const nodes = ST().nodes;
  const here = t => { const n = nodes.get(t.id); return n ? Object.assign({}, t, { x: n.x, y: n.y }) : t; };   // where it is right now, even mid-drag
  // the GM sees through the eyes of the tokens they've selected (any token: no need to set up sight on every NPC)
  const selSeers = () => [...state.sel].map(id => state.scene.tokens.get(id)).filter(t => t && !t.prop);   // (scenery has no eyes)
  if (V.isGM() && !state.viewAs && selSeers().length) {
    const sel = selSeers();
    return sel.length ? sel.map(t => Object.assign(here(t), { sight: { on: true, range: (t.sight && t.sight.range) || 0, dark: (t.sight && t.sight.dark) || 0 } })) : null;
  }
  if (V.isGuest()) return [...state.scene.tokens.values()].filter(t => (t.owners || []).length && Vision.sightOn(t)).map(here);
  const uid = V.isGM() ? state.viewAs : state.me && state.me.id;
  if (!uid) return null;
  return [...state.scene.tokens.values()].filter(t => (t.owners || []).includes(uid) && Vision.sightOn(t)).map(here);
}
V.lightingEyes = () => eyes();
V.lightingOwnsDark = () => !!state.scene && (!!state.scene.meta.vision || state.scene.lights.size > 0);
V.visionActive = () => !!(state.scene && state.scene.meta.vision && (!V.isGM() || state.viewAs));

// light animations: a radius and brightness wobble per light
function seed(id) { let s = 0; for (const c of String(id)) s = (s * 31 + c.charCodeAt(0)) % 9973; return s / 9973 * 100; }
function anim(l, t) {
  const p = seed(l.id), n = (f, a) => Math.sin(t * f + p) * a;
  switch (l.anim) {
    case 'torch': return { r: 1 + n(9.1, 0.025) + n(13.7, 0.02), a: 0.92 + n(11.3, 0.05) + n(23.1, 0.03) };
    case 'candle': return { r: 1 + n(5.3, 0.015) + n(8.9, 0.01), a: 0.95 + n(7.7, 0.04) };
    case 'pulse': return { r: 1 + n(2.1, 0.06), a: 0.9 + n(2.1, 0.1) };
    case 'fairy': return { r: 1 + n(3.3, 0.03), a: 0.85 + n(4.1, 0.15), hue: true };
    case 'sunbeam': return { r: 1, a: 0.88 + n(0.8, 0.12) };
    default: return { r: 1, a: 1 };
  }
}

// --- canvases behind the three sprites ---
function cv() { const c = document.createElement('canvas'); c.width = c.height = 2; return { c, ctx: c.getContext('2d'), tex: null }; }
const VIS = cv(), COL = cv(), GREY = cv(), EXP = cv();
function fit(o, w, h, k, sprite) {
  const cw = Math.max(2, Math.ceil(w * k)), ch = Math.max(2, Math.ceil(h * k));
  if (o.c.width !== cw || o.c.height !== ch || !o.tex) {
    o.c.width = cw; o.c.height = ch;
    if (o.tex) o.tex.destroy(true);
    o.tex = PIXI.Texture.from(o.c);
    if (sprite) sprite.texture = o.tex;
  }
  if (sprite) sprite.scale.set(1 / k);
  o.k = k;
}
const pad = () => { const { w, h } = V.sceneSize(); return { x: -w, y: -h, w: w * 3, h: h * 3 }; };

function polyPath(ctx, poly) { ctx.beginPath(); ctx.moveTo(poly[0], poly[1]); for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]); ctx.closePath(); }
function conePath(ctx, l, r) {
  if (!(l.angle > 0 && l.angle < 360)) return false;
  const a = (l.dir || 0) * Math.PI / 180, half = l.angle / 2 * Math.PI / 180;
  ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.arc(l.x, l.y, r * 1.05, a - half, a + half); ctx.closePath();
  return true;
}
// One light's glow: full inside bright, fading through dim to nothing. `paint(alpha)` gives the fill colour.
// (t null: steady, as it is on average: the darkness is drawn that way, so flickering only redraws the colour)
function lightShape(ctx, l, t, paint, strength) {
  if (!l.poly || l.poly.length < 6 || !(l.r > 0)) return;
  const an = t == null ? { r: 1, a: 1 } : anim(l, t), r = l.r * an.r, rb = Math.min(r, (l.rb || 0) * an.r), s = (strength == null ? 1 : strength) * Math.min(1, an.a);
  ctx.save();
  polyPath(ctx, l.poly); ctx.clip();
  if (conePath(ctx, l, r)) ctx.clip();
  const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
  const fb = r > 0 ? rb / r : 0;
  g.addColorStop(0, paint(s));
  if (fb > 0.02) g.addColorStop(Math.min(0.98, fb), paint(s));
  g.addColorStop(Math.min(0.99, fb + (1 - fb) * 0.15), paint(s * 0.62));
  g.addColorStop(0.9, paint(s * 0.45));
  g.addColorStop(1, paint(0));
  ctx.fillStyle = g;
  ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  ctx.restore();
}

// ───────────────────────── drawing ─────────────────────────

// the coloured light: the only part redrawn as lights flicker (the darkness, blurred and much bigger, stays steady)
let lastCol = null;
function drawColour(t) {
  const L = ST().L;
  if (!lastCol) { L.lightCol.visible = false; return; }
  const { litLights, colStrength, w, h } = lastCol;
  fit(COL, w, h, Math.min(0.35, 768 / Math.max(w, h)), L.lightCol);
  const c = COL.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, COL.c.width, COL.c.height);
  c.setTransform(COL.k, 0, 0, COL.k, 0, 0); c.globalCompositeOperation = 'lighter';
  for (const l of litLights) {
    let [r, g, b] = rgb(l.color);
    if (l.anim === 'fairy') { const k = (Math.sin(t * 1.3 + seed(l.id)) + 1) / 2; [r, g, b] = [r * (1 - k) + 140 * k, g * (1 - k) + 200 * k, b * (1 - k) + 255 * k]; }
    lightShape(c, l, t, a => `rgba(${r | 0},${g | 0},${b | 0},${a * (l.intensity ?? 0.5) * colStrength})`);
  }
  COL.tex.baseTexture.update(); L.lightCol.visible = true;
}

let expKey = null, expSaveT = 0;
function render(now) {
  dirty = false;
  const L = ST().L, s = state.scene;
  if (!s) { lastCol = null; L.vis.visible = L.lightCol.visible = L.grey.visible = false; L.doors.removeChildren(); L.walls.clear(); L.lightIcons.removeChildren(); return; }
  const t = (now || performance.now()) / 1000;
  const { w, h } = V.sceneSize();
  const d = s.meta.darkness || 0;
  const ws = walls(), ls = lights();
  const viewers = eyes();
  const sc = sceneObj();
  const v = Vision.view(sc, viewers || [], ls, losCache);   // viewers' sight and each light's reach
  const owns = V.lightingOwnsDark();
  animOn = ls.some(l => l.anim && l.anim !== 'none');

  // coloured light
  const colStrength = v.day ? 0.2 + d * 0.5 : 0.35 + d * 0.35;
  const litLights = v.day ? Vision.view(Object.assign({}, sc, { darkness: 1 }), [], ls, losCache).lights : v.lights;
  lastCol = ls.length ? { litLights, colStrength, w, h } : null;
  drawColour(t);

  // darkness, lit holes and (for players) sight
  const sightOn = !!viewers;
  if (!owns) { L.vis.visible = false; L.grey.visible = false; }
  else {
    fit(VIS, w, h, Math.min(1, 1600 / Math.max(w, h)), L.vis);
    const c = VIS.ctx, P = pad();
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.filter = 'none'; c.globalAlpha = 1;
    c.clearRect(0, 0, VIS.c.width, VIS.c.height);
    const soft = `blur(${Math.max(1, Math.round(ST().gs() * 0.05 * VIS.k))}px)`;
    if (sightOn) {
      c.fillStyle = '#000'; c.fillRect(0, 0, VIS.c.width, VIS.c.height);
      // what's been explored stays dimly visible, less so the darker it is: in total darkness there's nothing to see by
      const remember = !V.isGM();   // players remember what they've seen; the GM's peeks don't count
      const memory = 0.45 * (1 - d);
      if (remember && memory > 0.01 && (EXP.tex || EXP.c.width > 2)) { c.globalCompositeOperation = 'destination-out'; c.globalAlpha = memory; c.drawImage(EXP.c, 0, 0, VIS.c.width, VIS.c.height); c.globalAlpha = 1; }
      c.setTransform(VIS.k, 0, 0, VIS.k, 0, 0);
      c.globalCompositeOperation = 'destination-out'; c.filter = soft;
      fit(EXP, w, h, Math.min(0.35, 600 / Math.max(w, h)));
      const e = EXP.ctx; e.setTransform(EXP.k, 0, 0, EXP.k, 0, 0); e.globalCompositeOperation = 'source-over';
      for (const sv of v.viewers) {
        if (sv.poly.length < 6) continue;
        for (const [ctx, paint] of remember ? [[c, a => `rgba(0,0,0,${a})`], [e, a => `rgba(255,255,255,${a})`]] : [[c, a => `rgba(0,0,0,${a})`]]) {
          ctx.save();
          polyPath(ctx, sv.poly); ctx.clip();
          if (sv.range) { ctx.beginPath(); ctx.arc(sv.x, sv.y, sv.range, 0, Math.PI * 2); ctx.clip(); }
          if (v.day) { ctx.fillStyle = paint(1 - d * 0.7); ctx.fillRect(P.x, P.y, P.w, P.h); }
          else {
            for (const l of v.lights) lightShape(ctx, l, null, paint);
            if (sv.dark) {
              const g = ctx.createRadialGradient(sv.x, sv.y, 0, sv.x, sv.y, sv.dark);
              g.addColorStop(0, paint(0.72)); g.addColorStop(0.85, paint(0.6)); g.addColorStop(1, paint(0));
              ctx.fillStyle = g; ctx.fillRect(sv.x - sv.dark, sv.y - sv.dark, sv.dark * 2, sv.dark * 2);
            }
          }
          ctx.restore();
        }
      }
      if (remember) { EXP.dirty = true; saveExploredSoon(); }
    } else if (d > 0) {
      // no sight rules here: darkness everywhere, lights cut through it (the GM's darkness is see-through)
      // a night-blue tint that deepens to pure black at full darkness
      c.fillStyle = `rgba(0,${Math.round(8 * (1 - d))},${Math.round(20 * (1 - d))},${V.isGM() && state.gmSeeDark ? d * 0.5 : d})`; c.fillRect(0, 0, VIS.c.width, VIS.c.height);
      c.setTransform(VIS.k, 0, 0, VIS.k, 0, 0);
      c.globalCompositeOperation = 'destination-out'; c.filter = soft;
      for (const l of litLights) lightShape(c, l, null, a => `rgba(0,0,0,${a})`);
    }
    c.filter = 'none';
    VIS.tex.baseTexture.update();
    L.vis.visible = sightOn || d > 0;
    L.vis.alpha = 1;   // through a token's eyes, the dark is as black for the GM as for the player
    // darkvision shows the map dimly, in its own colours (no grey filter)
    const dv = false;
    if (dv) {
      fit(GREY, w, h, Math.min(0.5, 1024 / Math.max(w, h)), L.greyMask);
      const g = GREY.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, GREY.c.width, GREY.c.height);
      g.setTransform(GREY.k, 0, 0, GREY.k, 0, 0); g.globalCompositeOperation = 'source-over';
      for (const sv of v.viewers) if (sv.dark && sv.poly.length >= 6) {
        g.save(); polyPath(g, sv.poly); g.clip();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(sv.x, sv.y, sv.dark, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.globalCompositeOperation = 'destination-out';
      for (const l of v.lights) lightShape(g, l, t, a => `rgba(0,0,0,${a})`);
      GREY.tex.baseTexture.update();
      if (L.grey.texture !== L.map.texture) { L.grey.texture = L.map.texture; L.grey.width = L.map.width; L.grey.height = L.map.height; }
      if (!L.grey.filters) { const f = new PIXI.ColorMatrixFilter(); f.desaturate(); const f2 = new PIXI.ColorMatrixFilter(); f2.brightness(0.75, false); L.grey.filters = [f, f2]; }
      L.grey.mask = L.greyMask; L.grey.visible = true; L.greyMask.visible = true;
    } else { L.grey.visible = false; L.greyMask.visible = false; }
  }

  hideUnseen(v, viewers);
  drawWalls(ws);
  drawDoors(ws, v, viewers);
  drawLightIcons(ls);
}
// The GM looking through a token's eyes (or a player's) sees exactly what they would: tokens they can't see vanish.
// (Players never get those tokens at all: the server leaves them out.)
function hideUnseen(v, viewers) {
  const nodes = ST().nodes, s = state.scene;
  const preview = V.isGM() && viewers && (state.viewAs || [...state.sel].some(id => { const t = s.tokens.get(id); return t && !t.prop; }));
  const cell = s.meta.grid && s.meta.grid.size;
  for (const [id, n] of nodes) {
    let show = true;
    const t = preview && s.tokens.get(id);
    if (t) {
      const mine = state.viewAs ? (t.owners || []).includes(state.viewAs) : state.sel.has(id);
      const at = Object.assign({}, t, { x: n.x, y: n.y });
      show = mine || ((t.prop || t.layer === 'map') && t.layer !== 'gm') || (t.layer !== 'gm' && (!state.viewAs || !window.Geom || Geom.fogVisible(s.meta, t.x, t.y)) && Vision.seesToken(v, at, cell));
    }
    n.renderable = show;
  }
}
function schedule() { dirty = true; }
V.lightingTick = function (now) {
  if (!state.scene || !ST()) return;
  if (dirty) return render(now);
  if (animOn && lastCol && now - lastAnim > 90 && !document.hidden) { lastAnim = now; drawColour(now / 1000); }   // flicker: the colour only
};
V.lightingRefresh = schedule;
on('scene', () => { losCache.clear(); loadExplored(); selWall = selLight = null; chain = null; schedule(); V.renderDark(); });
on('sceneMeta', () => { losCache.clear(); loadExplored(); schedule(); V.renderDark(); });
on('tokens', schedule); on('tokenDrag', schedule); on('me', schedule);
on('sel', () => { if (V.isGM() && state.scene && state.scene.meta.vision) { schedule(); V.hud(V.isGM() && [...state.sel].some(id => { const t = state.scene.tokens.get(id); return t && !t.prop; }) && !state.viewAs ? 'Seeing what the selected token sees · click empty floor to see everything again' : undefined); } });
on('walls', () => { losCache.clear(); if (selWall && !state.scene.walls.has(selWall)) selWall = null; schedule(); if (state.tool === 'walls') V.renderSubtools(); });
on('lights', () => { if (selLight && !state.scene.lights.has(selLight)) selLight = null; schedule(); V.renderDark(); if (state.tool === 'lights') V.renderSubtools(); });

// --- explored areas: kept in this browser, per scene, until the GM wipes them ---
function loadExplored() {
  const s = state.scene; if (!s) return;
  const key = `vtt-explored-${s.id}-${s.meta.explored || 0}`;
  if (key === expKey) return;
  expKey = key;
  EXP.c.width = EXP.c.height = 2; EXP.tex = null;
  const { w, h } = V.sceneSize(); fit(EXP, w, h, Math.min(0.35, 600 / Math.max(w, h)));
  EXP.ctx.clearRect(0, 0, EXP.c.width, EXP.c.height);
  const url = V.store.get(key, null);
  if (url) { const img = new Image(); img.onload = () => { if (expKey === key) { EXP.ctx.setTransform(1, 0, 0, 1, 0, 0); EXP.ctx.drawImage(img, 0, 0, EXP.c.width, EXP.c.height); schedule(); } }; img.src = url; }
}
function saveExploredSoon() {
  clearTimeout(expSaveT);
  expSaveT = setTimeout(() => { if (expKey && EXP.c.width > 2) { try { V.store.set(expKey, EXP.c.toDataURL('image/webp', 0.6)); } catch (e) { /* storage full or blocked: explored areas just won't be remembered */ } } }, 2500);
}

// --- walls (GM) ---
function drawWalls(ws) {
  const g = ST().L.walls; g.clear();
  const show = V.isGM() && (state.tool === 'walls' || state.tool === 'lights');
  if (!show) return;
  const S = ST().scale(), lw = 3 / S;
  for (const w of ws) {
    const col = kindCol(w.kind), sel = w.id === selWall;
    if (sel) g.lineStyle(lw * 3.2, 0xffffff, 0.35).moveTo(w.a[0], w.a[1]).lineTo(w.b[0], w.b[1]);
    g.lineStyle({ width: lw, color: col, alpha: w.kind === 'invisible' ? 0.6 : 1 });
    if (w.kind === 'invisible' || ((w.kind === 'door' || w.kind === 'secret') && w.open)) dashed(g, w.a, w.b, 10 / S);
    else g.moveTo(w.a[0], w.a[1]).lineTo(w.b[0], w.b[1]);
    if (w.kind === 'oneway') {   // a tick on the side it blocks from
      const mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2, dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy) || 1;
      const sgn = w.flip ? -1 : 1, nx = dy / len * sgn, ny = -dx / len * sgn;
      g.lineStyle(lw, col, 1).moveTo(mx, my).lineTo(mx - nx * 14 / S, my - ny * 14 / S);
    }
    g.lineStyle(0).beginFill(col, 1).drawCircle(w.a[0], w.a[1], 3.5 / S).drawCircle(w.b[0], w.b[1], 3.5 / S).endFill();
  }
  if (chain && hover) g.lineStyle({ width: lw, color: kindCol(state.wallKind), alpha: 0.75 }).moveTo(chain.last[0], chain.last[1]).lineTo(hover[0], hover[1]);
  if (hover && state.tool === 'walls') g.lineStyle(0).beginFill(0xffffff, 0.9).drawCircle(hover[0], hover[1], 4 / S).endFill();
}
function dashed(g, a, b, step) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(len / step));
  for (let i = 0; i < n; i += 2) {
    const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
    g.moveTo(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0).lineTo(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
  }
}

// --- doors: a small button in the middle of each door ---
function drawDoors(ws, v, viewers) {
  const box = ST().L.doors; box.removeChildren().forEach(c => c.destroy({ children: true }));
  const gm = V.isGM(), S = ST().scale(), size = 18 / S;
  for (const w of ws) {
    if (!(w.kind === 'door' || (gm && w.kind === 'secret'))) continue;
    const mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
    if (!gm && viewers) {   // players get a door's button once they can see the door (from either side)
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy) || 1, o = Math.max(2, ST().gs() * 0.06);
      const pts = [[mx + dy / len * o, my - dx / len * o], [mx - dy / len * o, my + dx / len * o]];
      if (!v.viewers.some(s => pts.some(q => Vision.inPoly(s.poly, q[0], q[1])))) continue;
    }
    const b = new PIXI.Graphics();
    const col = w.kind === 'secret' ? 0xb466e0 : w.locked ? 0xc0584a : 0xd9a441;
    b.lineStyle(1.5 / S, 0x000000, 0.6).beginFill(w.open ? 0x1b2028 : col, 0.95).drawRoundedRect(-size / 2, -size / 2, size, size, 3 / S).endFill();
    b.lineStyle(1.5 / S, w.open ? col : 0x1b2028, 1);
    if (w.open) b.moveTo(-size * 0.25, -size * 0.3).lineTo(-size * 0.25, size * 0.3).lineTo(size * 0.2, size * 0.18).lineTo(size * 0.2, -size * 0.42).lineTo(-size * 0.25, -size * 0.3);
    else b.drawRect(-size * 0.22, -size * 0.32, size * 0.44, size * 0.64);
    if (w.locked && gm) b.lineStyle(0).beginFill(0xffffff).drawCircle(size * 0.3, size * 0.3, size * 0.12).endFill();
    b.position.set(mx, my);
    b.eventMode = 'static'; b.cursor = 'pointer';
    b.on('pointerdown', e => { e.stopPropagation(); if (e.button === 0) toggleDoor(w); });
    box.addChild(b);
  }
}
function toggleDoor(w) {
  V.send({ t: 'op', op: { t: 'door.toggle', scene: state.scene.id, id: w.id } }).catch(err => {
    if (err.message === 'locked') { lockedSound(); V.toast('It’s locked.', true); } else V.toast(err.message, true);
  });
}
let actx = null;
function lockedSound() {   // a short rattle, made here rather than shipped as a file
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 180 + i * 35;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.07); g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.07 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.07 + 0.06);
      o.connect(g).connect(actx.destination); o.start(t0 + i * 0.07); o.stop(t0 + i * 0.07 + 0.07);
    }
  } catch (e) { /* no sound available */ }
}

// --- light icons (GM, lights tool) ---
function drawLightIcons(ls) {
  const box = ST().L.lightIcons; box.removeChildren().forEach(c => c.destroy({ children: true }));
  if (!(V.isGM() && state.tool === 'lights')) return;
  const S = ST().scale(), k = ST().gs() / (state.scene.meta.grid && state.scene.meta.grid.feet || 5);
  for (const l of ls) {
    if (l.token) continue;
    const g = new PIXI.Graphics(), sel = l.id === selLight;
    if (sel) g.lineStyle(1 / S, 0xffffff, 0.5).drawCircle(0, 0, (l.bright || 0) * k).lineStyle(1 / S, 0xffffff, 0.3).drawCircle(0, 0, (l.dim || 0) * k);
    g.lineStyle(2 / S, sel ? 0xffffff : 0x1b2028, 1).beginFill(hexNum(l.color), 1).drawCircle(0, 0, 9 / S).endFill();
    g.position.set(l.x, l.y);
    box.addChild(g);
  }
}

// ───────────────────────── tools (GM) ─────────────────────────

const near = (p, q, px) => Math.hypot(p[0] - q[0], p[1] - q[1]) * ST().scale() <= px;
function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  let t = l2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]);
}
// grid corners and the middles of grid edges; existing wall ends win
function snapPt(p, free) {
  for (const w of walls()) for (const q of [w.a, w.b]) if (near(p, q, 10)) return [q[0], q[1]];
  const g = V.grid();
  if (free || !state.wallSnap || !g || g.type !== 'square' || !(g.size > 0)) return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  const half = g.size / 2;
  return [g.ox + Math.round((p[0] - g.ox) / half) * half, g.oy + Math.round((p[1] - g.oy) / half) * half];
}
function wallAt(p) {
  let best = null, bd = 8 / ST().scale();
  for (const w of walls()) { const d = segDist(p, w.a, w.b); if (d < bd) { bd = d; best = w; } }
  return best;
}
const addWall = (a, b) => V.op({ t: 'wall.add', scene: state.scene.id, walls: [{ a, b, kind: state.wallKind }] });

let endDrag = null;
V.toolHandlers.walls = {
  down(p, e) {
    if (!state.scene) return false;
    const sp = snapPt([p.x, p.y], e.altKey);
    if (chain) {
      if (Math.hypot(sp[0] - chain.last[0], sp[1] - chain.last[1]) > 1) addWall(chain.last, sp);
      chain.last = sp; schedule(); return false;
    }
    // a wall end: drag it to move it (every wall meeting there follows), or click it to start a new wall from it
    for (const w of walls()) for (const end of ['a', 'b']) if (near([p.x, p.y], w[end], 9)) {
      const at = w[end];
      endDrag = { from: [at[0], at[1]], to: null, moved: false, sx: e.global.x, sy: e.global.y,
        ends: walls().flatMap(x => ['a', 'b'].filter(k => x[k][0] === at[0] && x[k][1] === at[1]).map(k => [x.id, k])) };
      return true;
    }
    const w = wallAt([p.x, p.y]);
    if (w) { selWall = w.id; schedule(); V.renderSubtools(); return false; }
    selWall = null; chain = { last: sp }; schedule(); V.renderSubtools(); V.hud();
    return false;
  },
  move(p, e, dragging) {
    hover = snapPt([p.x, p.y], e.altKey);
    if (dragging && endDrag) {
      if (!endDrag.moved && Math.hypot(e.global.x - endDrag.sx, e.global.y - endDrag.sy) < 5) return;
      endDrag.moved = true;
      endDrag.to = hover;
      for (const [id, k] of endDrag.ends) { const w = state.scene.walls.get(id); if (w) w[k] = hover; }   // preview; the server confirms on release
      losCache.clear();
    }
    schedule();
  },
  up() {
    if (!endDrag) return;
    const d = endDrag; endDrag = null;
    if (!d.moved) { selWall = null; chain = { last: d.from }; schedule(); V.renderSubtools(); V.hud(); return; }
    if (d.to[0] === d.from[0] && d.to[1] === d.from[1]) return;
    const ops = d.ends.map(([id, k]) => ({ t: 'wall.update', scene: state.scene.id, id, patch: { [k]: d.to } }));
    V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops });
  },
  dbl() { chain = null; schedule(); V.hud(); },
  key(e) {
    if (e.key === 'Escape' && (chain || selWall)) { chain = null; selWall = null; schedule(); V.renderSubtools(); V.hud(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selWall) { V.op({ t: 'wall.delete', scene: state.scene.id, ids: [selWall] }); selWall = null; return true; }
    return false;
  },
  hud() {
    if (chain) return 'Click to add the next corner · double-click or Esc to stop · Alt: no snapping';
    if (selWall) return 'Drag a wall end to move it (joined walls follow) · Delete removes the wall';
    return 'Click to start a wall, click again for each corner · click a wall to select it · Alt: no snapping';
  },
  subtools(box) {
    const b = (label, on, fn, title) => h('button', { class: on ? 'on' : null, onclick: fn, title }, label);
    const sw = selWall && state.scene.walls.get(selWall);
    const setKind = k => { if (sw) V.op({ t: 'wall.update', scene: state.scene.id, id: sw.id, patch: { kind: k } }); else { state.wallKind = k; V.renderSubtools(); schedule(); } };
    const tips = { wall: 'Blocks sight, light and movement', door: 'A wall anyone can open or close', secret: 'Players see a plain wall until you open it', window: 'See and light through, can’t walk through', invisible: 'Like a window, but not drawn', oneway: 'Blocks from one side only', shade: 'House walls: block light, movement and seeing tokens round the corner, but the building and the street stay in view' };
    for (const [k, l] of WALL_KINDS) box.append(b(l, (sw ? sw.kind : state.wallKind) === k, () => setKind(k), tips[k]));
    box.append(h('div', { class: 'sep' }), b('Snap', state.wallSnap, () => { state.wallSnap = !state.wallSnap; V.renderSubtools(); }, 'Snap to grid corners and edge middles (hold Alt to switch off for one click)'));
    if (sw) {
      box.append(h('div', { class: 'sep' }));
      if (sw.kind === 'door' || sw.kind === 'secret') box.append(
        b(sw.open ? 'Open' : 'Closed', sw.open, () => V.op({ t: 'door.toggle', scene: state.scene.id, id: sw.id })),
        b('Locked', sw.locked, () => V.op({ t: 'wall.update', scene: state.scene.id, id: sw.id, patch: { locked: !sw.locked } }), 'Players can’t open a locked door'));
      if (sw.kind === 'oneway') box.append(b('Flip side', false, () => V.op({ t: 'wall.update', scene: state.scene.id, id: sw.id, patch: { flip: !sw.flip } }), 'Which side it blocks from (the tick shows)'));
      box.append(b('Delete', false, () => { V.op({ t: 'wall.delete', scene: state.scene.id, ids: [sw.id] }); selWall = null; }));
    }
    darkToggle(box);
    sightControls(box);
  }
};
// the GM's own view: see dimly into the dark (to run the game), or exactly as dark as the table
function darkToggle(box) {
  box.append(h('label', { class: 'subfield', title: 'Off: you see the darkness exactly as the table does (pitch black at full darkness)' },
    h('input', { type: 'checkbox', checked: state.gmSeeDark || null, onchange: e => { state.gmSeeDark = e.target.checked; try { localStorage.setItem('vtt-gm-see-dark', state.gmSeeDark ? '1' : '0'); } catch (err) { /* private window */ } schedule(); } }), 'See in the dark'));
}

let lightDrag = null;
V.toolHandlers.lights = {
  down(p) {
    if (!state.scene) return false;
    const hit = lights().filter(l => !l.token).find(l => near([p.x, p.y], [l.x, l.y], 12));
    if (hit) { selLight = hit.id; lightDrag = { id: hit.id, from: [hit.x, hit.y], to: null }; schedule(); V.renderSubtools(); return true; }
    V.op({ t: 'light.add', scene: state.scene.id, light: { x: Math.round(p.x), y: Math.round(p.y) } }).then(r => { if (r.op && r.op.light) { selLight = r.op.light.id; V.renderSubtools(); schedule(); } });
    return false;
  },
  move(p, e, dragging) {
    if (!dragging || !lightDrag) return;
    const l = state.scene.lights.get(lightDrag.id); if (!l) return;
    lightDrag.to = [Math.round(p.x), Math.round(p.y)];
    l.x = lightDrag.to[0]; l.y = lightDrag.to[1];
    schedule();
  },
  up() {
    const d = lightDrag; lightDrag = null;
    if (d && d.to) V.op({ t: 'light.update', scene: state.scene.id, id: d.id, patch: { x: d.to[0], y: d.to[1] } });
  },
  key(e) {
    if (e.key === 'Escape' && selLight) { selLight = null; schedule(); V.renderSubtools(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selLight) { V.op({ t: 'light.delete', scene: state.scene.id, id: selLight }); selLight = null; return true; }
    return false;
  },
  hud() { return selLight ? 'Drag the light to move it · Delete removes it · click empty floor for another' : 'Click to place a light · tokens can carry light too (in their settings)'; },
  subtools(box) {
    const l = selLight && state.scene.lights.get(selLight);
    if (l) {
      const set = patch => V.op({ t: 'light.update', scene: state.scene.id, id: l.id, patch });
      const num = (label, key, title) => h('label', { class: 'subfield', title }, label, h('input', { type: 'number', min: 0, step: 5, value: l[key], style: 'width:56px', onchange: e => set({ [key]: +e.target.value || 0 }) }));
      box.append(num('Bright', 'bright', 'Bright light, in feet'), num('Dim', 'dim', 'Dim light reaches this far, in feet'),
        h('label', { class: 'subfield', title: 'Colour' }, h('input', { type: 'color', value: l.color, onchange: e => set({ color: e.target.value }) })),
        h('label', { class: 'subfield', title: 'How strongly it tints what it lights' }, 'Tint', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: l.intensity, style: 'width:70px', onchange: e => set({ intensity: +e.target.value }) })),
        h('label', { class: 'subfield', title: 'A cone of light: its width in degrees (360 for all round)' }, 'Cone', h('input', { type: 'number', min: 1, max: 360, step: 15, value: l.angle, style: 'width:56px', onchange: e => set({ angle: +e.target.value || 360 }) })),
        l.angle < 360 ? h('label', { class: 'subfield', title: 'Which way the cone points, in degrees (0 is right, 90 is down)' }, 'Facing', h('input', { type: 'number', step: 15, value: l.dir || 0, style: 'width:56px', onchange: e => set({ dir: +e.target.value || 0 }) })) : null,
        h('select', { title: 'Animation', onchange: e => set({ anim: e.target.value }) }, ...ANIMS.map(([k, n]) => h('option', { value: k, selected: l.anim === k || null }, n))),
        h('button', { onclick: () => { V.op({ t: 'light.delete', scene: state.scene.id, id: l.id }); selLight = null; } }, 'Delete'),
        h('div', { class: 'sep' }));
    }
    const d = state.scene ? state.scene.meta.darkness || 0 : 0;
    box.append(h('label', { class: 'subfield', title: 'How dark the scene is. Below a third, everyone sees without light.' }, 'Darkness',
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: d, style: 'width:90px', onchange: e => V.op({ t: 'scene.update', id: state.scene.id, patch: { darkness: +e.target.value } }) })));
    darkToggle(box);
    sightControls(box);
  }
};
// shared by both tools: sight rules on/off, preview as a player, wipe explored
function sightControls(box) {
  const s = state.scene; if (!s) return;
  const b = (label, on, fn, title) => h('button', { class: on ? 'on' : null, onclick: fn, title }, label);
  const players = (state.camp.members || []).filter(m => m.role !== 'gm');
  box.append(h('div', { class: 'sep' }),
    b(s.meta.vision ? 'Sight on' : 'Sight off', s.meta.vision, () => V.op({ t: 'scene.update', id: s.id, patch: { vision: !s.meta.vision } }), 'Players see only what their tokens can see'),
    s.meta.vision ? h('select', { title: 'See the map as a player sees it', onchange: e => { state.viewAs = e.target.value || null; schedule(); V.renderDark(); V.hud(); } },
      h('option', { value: '' }, 'View as GM'), ...players.map(u => h('option', { value: u.id, selected: state.viewAs === u.id || null }, 'View as ' + u.name))) : null,
    s.meta.vision ? b('Forget explored', false, () => { if (confirm('Wipe what every player has explored on this scene?')) V.op({ t: 'scene.update', id: s.id, patch: { explored: (s.meta.explored || 0) + 1 } }); }, 'Players forget the parts of the map they have seen') : null);
}
on('tool', t => { chain = null; if (t !== 'walls' && t !== 'lights') { selWall = selLight = null; } hover = null; schedule(); });

// ───────────────────────── token settings: sight and light ─────────────────────────

V.tokenPanelLight = function (t, set) {
  const gm = V.isGM();
  const sight = t.sight || { on: Vision.sightOn(t), range: 0, dark: 0 };
  const light = t.light || { bright: 0, dim: 0, color: '#ffc477', intensity: 0.5, angle: 360, dir: 0, anim: 'torch' };
  const setLight = patch => set({ light: Object.assign({}, light, patch) });
  const presets = [['None', 0, 0], ['Candle', 5, 10], ['Torch', 20, 40], ['Lamp', 15, 45], ['Lantern', 30, 60]];
  const numIn = (val, fn, w) => h('input', { type: 'number', min: 0, step: 5, value: val, style: `width:${w || 60}px`, onchange: e => fn(+e.target.value || 0) });
  return h('div', { class: 'tokvision' },
    gm ? [h('label', null, 'Sight'),
      h('div', { class: 'row' }, h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: sight.on, onchange: e => set({ sight: Object.assign({}, sight, { on: e.target.checked }) }) }), 'Has sight'),
        h('span', { class: 'muted small' }, 'Range'), numIn(sight.range || '', v => set({ sight: Object.assign({}, sight, { range: v }) }), 54), h('span', { class: 'muted small' }, 'ft'),
        h('span', { class: 'muted small' }, 'Darkvision'), numIn(sight.dark || '', v => set({ sight: Object.assign({}, sight, { dark: v }) }), 54), h('span', { class: 'muted small' }, 'ft'))] : null,
    h('label', null, 'Carries light'),
    h('div', { class: 'row' }, ...presets.map(([n, b, d]) => h('button', { class: 'btn sm' + ((light.bright || 0) === b && (light.dim || 0) === d ? ' on' : ''), onclick: () => setLight({ bright: b, dim: d, anim: n === 'Candle' ? 'candle' : n === 'Torch' ? 'torch' : light.anim }) }, n))),
    (light.dim || light.bright) ? h('div', { class: 'row', style: 'margin-top:6px' },
      h('span', { class: 'muted small' }, 'Bright'), numIn(light.bright, v => setLight({ bright: v }), 50),
      h('span', { class: 'muted small' }, 'Dim'), numIn(light.dim, v => setLight({ dim: v }), 50),
      h('input', { type: 'color', value: light.color, title: 'Colour', onchange: e => setLight({ color: e.target.value }) }),
      h('select', { title: 'Animation', onchange: e => setLight({ anim: e.target.value }) }, ...ANIMS.map(([k, n]) => h('option', { value: k, selected: light.anim === k || null }, n)))) : null);
};
})();
