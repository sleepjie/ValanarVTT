/* Isometric maps on the table: a scene whose map came from the map forge (table/iso/forge.html).
 *
 * The map is kept in the scene (meta.iso: the forge's packed cells) and drawn here from the tile sheets, like the room
 * planner's plans. Its grid is the forge's diamonds (grid type 'iso', table/shared/geom.js).
 *
 * Standing in front of and behind things: the picture has every tree, cliff and house in it already, so a creature
 * simply stands on top of it. Where a creature is BEHIND something (further back than the thing's own cell, and
 * overlapping its picture), a copy of that thing is laid over the creature, faded: the creature shows through it,
 * the way Diablo and Flare do it. Worked out every frame, so it follows a token while it's dragged.
 *
 * The GM's forge button opens the forge over the table; "Use on this scene" puts the map on the current scene.
 */
'use strict';
(function () {
const { $, h, state, on } = V;
const BASE = '/table/iso/';
const SEE = 0.5;    // how much of a thing still shows over a creature behind it

// ───────── the picture ─────────
let cache = { key: null, tex: null, m: null, standing: [], grid: null }, loading = false;
const upgraded = new Set();   // scenes whose older forge map was brought up to date (its lights and house walls)
function maxSide() { try { const gl = V.stage.app.renderer.gl; return Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE)); } catch (e) { return 4096; } }
V.isoTexture = function (iso) {
  if (!window.IsoCore || !iso) return null;
  const key = JSON.stringify(iso);
  if (cache.key === key && cache.tex) return cache.tex;
  const C = IsoCore;
  if (!C.ready('props') || !C.ready(iso.biome) ) {
    if (!loading) { loading = true; C.load(BASE, [iso.biome]).then(() => { loading = false; V.redrawMap && V.redrawMap(); }); }
    return null;
  }
  let m; try { m = C.unpack(iso); } catch (e) { return null; }
  if (!iso.kind && V.isGM() && state.scene && state.scene.meta.iso === iso && !upgraded.has(state.scene.id)) {
    upgraded.add(state.scene.id); const sid = state.scene.id;
    try { const p = C.pack(m); setTimeout(() => V.op({ t: 'scene.update', id: sid, patch: { iso: p } }).catch(() => {}), 0); } catch (e) { /* (left as it is) */ }
  }
  const b = C.bounds(m), k = Math.min(1, maxSide() / Math.max(b.w, b.h));
  const cv = document.createElement('canvas'); cv.width = Math.round(b.w * k); cv.height = Math.round(b.h * k);
  const g = cv.getContext('2d'); g.scale(k, k); C.paint(g, m, { ox: b.ox, oy: b.oy });
  const tex = PIXI.Texture.from(cv, { mipmap: PIXI.MIPMAP_MODES.ON });
  if (cache.tex && cache.tex !== tex) { const old = cache.tex; setTimeout(() => { if (V.stage.L.map.texture !== old) old.destroy(true); }, 3000); }
  cache = { key, tex, m, standing: C.standing(m, { ox: b.ox, oy: b.oy }), bucket: null };
  indexStanding();
  setTimeout(() => V.lightingRefresh && V.lightingRefresh(), 0);
  return tex;
};
// what stands up, filed by 256px squares of the picture, to find what a token overlaps quickly
function indexStanding() {
  const B = new Map();
  cache.standing.forEach((o, n) => {
    for (let bx = Math.floor(o.dx / 256); bx <= Math.floor((o.dx + o.w) / 256); bx++)
      for (let by = Math.floor(o.dy / 256); by <= Math.floor((o.dy + o.h) / 256); by++) { const k = bx + ',' + by; if (!B.has(k)) B.set(k, []); B.get(k).push(n); }
  });
  cache.bucket = B;
}

// ───────── seeing creatures behind things ─────────
let over = null, sig = '';
const texOf = new Map();   // sprite key -> PIXI texture
function spriteTex(s) {
  const key = s.img.src + '|' + s.x + ',' + s.y + ',' + s.w + ',' + s.h;
  let t = texOf.get(key);
  if (!t) { t = new PIXI.Texture(PIXI.BaseTexture.from(s.img), new PIXI.Rectangle(s.x, s.y, s.w, s.h)); texOf.set(key, t); }
  return t;
}
function ensureLayer() {
  const L = V.stage && V.stage.L; if (!L || !L.tok || !L.tok.parent) return null;
  if (!over) { over = new PIXI.Container(); over.eventMode = 'none'; }
  if (over.parent !== L.tok.parent) L.tok.parent.addChildAt(over, L.tok.parent.getChildIndex(L.tok) + 1);   // just above the creatures
  return over;
}
function clear() { if (over) for (const c of over.removeChildren()) c.destroy({ children: true }); sig = ''; }
function tick() {
  const sc = state.scene, m = sc && sc.meta;
  if (!m || !m.iso || !cache.bucket || cache.key !== JSON.stringify(m.iso) || !V.stage.nodes) { if (sig) clear(); return; }
  const g = V.grid(); if (g.type !== 'iso') { if (sig) clear(); return; }
  // each creature: where it stands (its cell) and the box its picture covers
  const hits = new Map();   // standing index -> [token boxes]
  for (const [id, n] of V.stage.nodes) {
    if (!n.parent || n.parent !== V.stage.L.tok || !n.visible || n.renderable === false) continue;   // (one the viewer can't see: nothing shows through for it)
    const t = sc.tokens.get(id); if (!t || t.prop) continue;
    const lb = n.getLocalBounds(), x0 = n.x + lb.x, y0 = n.y + lb.y, x1 = x0 + lb.width, y1 = y0 + lb.height;
    const [ti, tj] = Geom.isoAt(g, n.x, n.y), seen = new Set();
    for (let bx = Math.floor(x0 / 256); bx <= Math.floor(x1 / 256); bx++) for (let by = Math.floor(y0 / 256); by <= Math.floor(y1 / 256); by++) {
      for (const k of cache.bucket.get(bx + ',' + by) || []) {
        if (seen.has(k)) continue; seen.add(k);
        const o = cache.standing[k];
        if (!(ti <= o.X && tj <= o.Y && (ti !== o.X || tj !== o.Y))) continue;   // in front of it (or on its own cell)
        if (x1 < o.dx || x0 > o.dx + o.w || y1 < o.dy || y0 > o.dy + o.h) continue;
        if (!hits.has(k)) hits.set(k, []);
        hits.get(k).push([n.x, n.y, Math.max(lb.width, lb.height) / 2 + 2]);
      }
    }
  }
  const dark = sc.meta.darkness || 0, s = [...hits].map(([k, b]) => k + ':' + b.map(q => q.map(Math.round).join(',')).join(';')).join('|') + '|' + dark;
  if (s === sig) return;
  clear(); sig = s;
  const layer = ensureLayer(); if (!layer) return;
  const shade = Math.round(255 * (1 - Math.min(0.85, dark * 0.8)));
  let n = 0;
  for (const [k, boxes] of hits) {
    if (n++ > 80) break;
    const o = cache.standing[k], sp = new PIXI.Sprite(spriteTex(o.s));
    const k = o.k || 1; if (o.flip) { sp.scale.set(-k, k); sp.position.set(o.dx + o.w, o.dy); } else { sp.scale.set(k, k); sp.position.set(o.dx, o.dy); }   // (a piece sized in the forge) sp.alpha = SEE; sp.tint = (shade << 16) | (shade << 8) | shade;
    const mask = new PIXI.Graphics(); mask.beginFill(0xffffff);
    for (const [x, y, r] of boxes) mask.drawCircle(x, y, r);
    mask.endFill();
    layer.addChild(mask, sp); sp.mask = mask;
  }
}
function startTicker() { const app = V.stage && V.stage.app; if (!app) return setTimeout(startTicker, 300); app.ticker.add(tick); }
startTicker();
on('scene', () => clear());

// ───────── the forge, over the table ─────────
// o.fresh: the map makes a new scene (o.name its name, o.back: back to the new scene wizard)
// o.mount: an element to put the forge in (the map-making window, planner.js), o.done: called when the forge is finished with
let frame = null, fresh = null, holder = null, opts = null;
function openForge(o) {
  if (!V.isGM()) return;
  o = o || {};
  if (!o.fresh && (!state.scene || state.scene.meta.kind === 'world')) o = Object.assign({}, o, { fresh: true });   // (no scene of its own to go on: a new one)
  if (frame) closeForge(true);
  fresh = o.fresh ? o : null; opts = o;
  frame = h('iframe', { src: BASE + 'forge.html?embed=1' + (fresh ? '&new=1' : ''), title: 'Map forge' });
  if (o.mount) { holder = null; o.mount.replaceChildren(frame); }
  else { holder = h('div', { class: 'isoforge', role: 'dialog', 'aria-label': 'Map forge' }, frame); document.body.append(holder); }
}
// quiet: taken away without telling whoever opened it (they're closing or changing the window themselves)
function closeForge(quiet) {
  if (!frame) return;
  const o = opts;
  if (holder) holder.remove(); else frame.remove();
  frame = null; fresh = null; holder = null; opts = null;
  if (!quiet && o && o.done) o.done();
}
V.closeForge = closeForge;
addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin || !e.data) return;
  const d = e.data;
  if (d.type === 'iso-ready') frame.contentWindow.postMessage({ type: 'iso-load', map: !fresh && state.scene && state.scene.meta.iso || null }, location.origin);
  else if (d.type === 'iso-close') { const o = opts; closeForge(); if (o && o.back) o.back(); }
  else if (d.type === 'iso-use' && d.map && fresh) {
    // a new scene for it: made plain, then the map put on (so its walls go up as for any forge map)
    const b = IsoCore.bounds(d.map), name = fresh.name && fresh.name !== 'New scene' ? fresh.name : 'Forge map';
    const grid = { type: 'iso', size: 64, ox: b.ox, oy: b.oy, alpha: 0.15, feet: 5, units: 'ft', diagonal: 'one' };
    const kind = IsoCore.kindOf(d.map.biome), dark = kind === 'under', out = kind === 'out';
    const climate = /snow|ice/.test(d.map.biome) ? 'cold' : /desert/.test(d.map.biome) ? 'desert' : 'temperate';
    (async () => {
      const r = await V.op({ t: 'scene.create', scene: Object.assign({ name, image: null, bg: '#000000', grid, vision: dark || out, darkness: dark ? 1 : 0 }, out ? { clock: true, weather: true, climate } : {}) });
      const sid = r.op && r.op.scene && r.op.scene.id; if (!sid) throw new Error('No scene');
      await V.op({ t: 'scene.update', id: sid, patch: { iso: d.map, grid } });
      closeForge(); if (V.viewScene) V.viewScene(sid); V.toast('The scene is made');
    })().catch(e => V.toast('Couldn’t make the scene: ' + (e && e.message || e), true));
  }
  else if (d.type === 'iso-use' && d.map && state.scene) {
    const b = IsoCore.bounds(d.map), was = V.grid();
    // the forge's diamonds, a light grid over them (the art is busy), and the void black
    const g = Object.assign({}, was, { type: 'iso', size: 64, ox: b.ox, oy: b.oy, alpha: was.type === 'iso' ? was.alpha : 0.15 });
    if (!(g.feet > 0)) g.feet = 5;
    V.op({ t: 'scene.update', id: state.scene.id, patch: { iso: d.map, grid: g, plan: null, image: null, bg: '#000000' } })
      .then(() => { closeForge(); V.toast('The map is on the scene'); }).catch(() => {});
  }
});
V.openForge = openForge;
// an isometric map has no use for the room planner (its squares are the forge's): its tool goes while one's up
function planTool() {
  const b = document.querySelector('#tools [data-tool=plan]'); if (!b) return;
  const iso = !!(state.scene && state.scene.meta.grid && state.scene.meta.grid.type === 'iso');
  b.style.display = iso ? 'none' : '';
  if (iso && state.tool === 'plan' && V.setTool) V.setTool('select');
}
const isoScene = () => !!(state.scene && state.scene.meta.grid && state.scene.meta.grid.type === 'iso');
setTimeout(() => { const base = V.setTool; if (base) V.setTool = t => { if (t === 'plan' && isoScene()) return; base(t); }; }, 0);   // (nor its key, P)
on('scene', planTool); on('sceneMeta', planTool);
// how tall this scene's walls stand on the screen (lighting.js shows a wall's face as far as the floor before it is seen)
V.isoWallHeight = function () {
  const m = state.scene && state.scene.meta.iso; if (!m || !window.IsoCore) return 0;
  const d = (IsoCore.data().biomes || {})[m.biome]; if (!d) return 0;
  if (IsoCore.kindOf(m.biome) === 'out') { const v = Object.values(IsoCore.data().cliff || {}).find(Boolean), t = v && d.tiles[v]; return t ? t[5] - 10 : 0; }   // (outdoors: the cliffs)
  const t = d.tiles[d.thin ? d.thin.W[0] : 500];
  return t ? t[5] - 10 : 64;   // (its top above the cell's middle, less a little: the foot is a little below the middle)
};

// (no button of its own: it's the Isometric side of the map-making window, planner.js, from the new scene wizard or the plan tool)

// its look
document.head.append(h('style', null, `
.isoforge{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;padding:24px}
.isoforge iframe{flex:1;border:0;border-radius:10px;background:#111310;box-shadow:0 12px 48px rgba(0,0,0,.5)}
.genforge{height:min(78vh,900px);display:flex}.genforge iframe{flex:1;border:0;border-radius:8px;background:#111310}
@media(max-width:760px){.isoforge{padding:0}.isoforge iframe{border-radius:0}}
`));
})();
