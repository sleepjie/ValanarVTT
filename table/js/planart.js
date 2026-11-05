/* Drawing a plan (the room planner's map): painted (photo textures, shaded walls, furniture with shadows) or in ink
 * (black on parchment, hatched round the walls). Drawn once into a texture, which becomes the scene's map: so the
 * explored-but-not-seen grey, the darkness and the rest treat it as any other map picture.
 * The textures (table/data/plantex) are from ambientCG (CC0), via the OSM2World default style; see THIRD-PARTY-NOTICES. */
'use strict';
(function () {
const { state } = V;
const hex = c => parseInt(String(c || '#000000').slice(1), 16);
const TEX = ['flagstone', 'cobble', 'mossycobble', 'planks', 'oldplanks', 'wood', 'dirt', 'earth', 'grass', 'gravel', 'rock', 'rubble', 'pebbles', 'marble', 'tiles', 'sand',
  'snow', 'ice', 'cloth', 'paper', 'plaster', 'brick', 'slate', 'thatch'];
const T = {};
let texP = null, texReady = false;
function loadTextures() {
  if (texP) return texP;
  texP = Promise.all(TEX.map(k => PIXI.Assets.load('/table/data/plantex/' + k + '.jpg').then(t => {
    t.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; t.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON; t.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; T[k] = t;
  }).catch(() => {}))).then(() => { texReady = true; });
  return texP;
}
V.planTexturesReady = () => loadTextures();
// rows of one kind of square: fn(x, y, n) for each run of n
function runsOf(P, v, fn) {
  for (let y = 0; y < P.rows; y++) { let s = -1; for (let x = 0; x <= P.cols; x++) { const on_ = x < P.cols && P.grid[y * P.cols + x] === v; if (on_ && s < 0) s = x; if (!on_ && s >= 0) { fn(s, y, x - s); s = -1; } } }
}
// room numbers belong to the GM layer (V.drawGMOverlay): they're drawn into the map itself only when the plan says
// everyone may see them, or for a picture that asks for them (the generator's preview, the GM's export)
const labelsShown = (st, o) => st.labels === 'all' || !!(o && o.labels);
const INK_TINT = { lava: 0xf0b890, chasm: 0x3a3632, grass: 0xf0f3e4, dirt: 0xf5eee2, cave: 0xf2ede4, gravel: 0xf2efea, earth: 0xf3ece0, carpet: 0xf6e6e2, sand: 0xfaf3e2, snow: 0xffffff };

// the floor's shape (its outline loops, natural corners rounded), as a fill: floors are drawn under it as a mask
function floorShape(P, c) {
  const g = new PIXI.Graphics(), L = Plan.loops(P), outer = L.filter(l => l.area > 0), holes = L.filter(l => l.area < 0);
  const inPoly = (pt, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
  const flat = pts => pts.flatMap(([x, y]) => [x * c, y * c]);
  for (const ol of outer) {
    g.beginFill(0xffffff); g.drawPolygon(flat(ol.pts));
    for (const hl of holes) if (inPoly([hl.pts[0][0] + 0.01, hl.pts[0][1] + 0.01], ol.pts) || inPoly(hl.pts[0], ol.pts)) { g.beginHole(); g.drawPolygon(flat(hl.pts)); g.endHole(); }
    g.endFill();
  }
  return g;
}
// the walls as joined-up lines (so a curve is one stroke)
function wallChains(P, c) {
  const W = P.cols * c, H = P.rows * c, ground = P.style.outside !== 'rock' && P.style.outside !== 'black';
  const onEdge = (a, b) => (a[0] === 0 && b[0] === 0) || (a[1] === 0 && b[1] === 0) || (a[0] === W && b[0] === W) || (a[1] === H && b[1] === H);
  const segs = Plan.walls(P, c, 0, 0).filter(w => w.kind === 'wall' && !w.door && !(ground && onEdge(w.a, w.b))), out = [];
  let cur = null;
  for (const s of segs) {
    if (cur && cur[cur.length - 1][0] === s.a[0] && cur[cur.length - 1][1] === s.a[1]) cur.push(s.b);
    else { cur = [s.a, s.b]; out.push(cur); }
  }
  return out;
}
const strokeChains = (g, chains) => { for (const ch of chains) { g.moveTo(ch[0][0], ch[0][1]); for (let i = 1; i < ch.length; i++) g.lineTo(ch[i][0], ch[i][1]); } };
// the commonest natural floor (for the slivers a rounded corner adds to the floor)
function naturalBase(P) {
  const n = {}; for (const v of P.grid) if (v !== Plan.ROCK && Plan.natural(P, v)) n[v] = (n[v] || 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; return best ? +best[0] : null;
}

const texCache = { key: '', tex: null };
function maxSide() { try { const gl = V.stage.app.renderer.gl; return Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE)); } catch (e) { return 4096; } }
V.drawPlan = function (root, plan, c, o) {
  const P = plan.grid ? plan : Plan.unpack(plan);
  if (P.style.render === 'painted' && texReady) drawPainted(root, P, c, o); else drawInk(root, P, c, o);
};
V.planTexture = function (plan, g, opts) {
  const app = V.stage && V.stage.app; if (!app || !plan) return null;
  if (!texReady) { loadTextures().then(() => V.redrawMap && V.redrawMap()); if (plan.style && plan.style.render === 'painted') return null; }
  const gm = V.isGM(), key = JSON.stringify([plan, g.size, g.ox, g.oy, gm, !!(opts && opts.fast), texReady]);
  if (texCache.key === key && texCache.tex) return texCache.tex;
  const c = g.size, w = plan.cols * c + (g.ox || 0), hh = plan.rows * c + (g.oy || 0);
  const root = new PIXI.Container();
  V.drawPlan(root, plan, c, { gm, fast: opts && opts.fast, ox: g.ox || 0, oy: g.oy || 0 });
  const res = Math.max(0.15, Math.min(1.6, maxSide() / Math.max(w, hh)));
  const tex = app.renderer.generateTexture(root, { region: new PIXI.Rectangle(0, 0, w, hh), resolution: res, scaleMode: PIXI.SCALE_MODES.LINEAR, multisample: PIXI.MSAA_QUALITY.HIGH });
  root.destroy({ children: true });
  if (texCache.tex && texCache.tex !== tex) { const old = texCache.tex; setTimeout(() => { if (V.stage.L.map.texture !== old && V.stage.L.grey.texture !== old) old.destroy(true); }, 3000); }
  setTimeout(() => V.lightingRefresh && V.lightingRefresh(), 0);
  texCache.key = key; texCache.tex = tex;
  return tex;
};
// a picture of a plan as a canvas (the generator's preview, the PNG export)
V.planCanvas = function (plan, px, opts) {
  const app = V.stage && V.stage.app; if (!app) return null;
  const c = (opts && opts.c) || 40, root = new PIXI.Container();
  V.drawPlan(root, plan, c, { gm: !(opts && opts.players), labels: !!(opts && opts.labels), ox: 0, oy: 0 });
  const w = plan.cols * c, hh = plan.rows * c, res = Math.min(1, px / Math.max(w, hh));
  const tex = app.renderer.generateTexture(root, { region: new PIXI.Rectangle(0, 0, w, hh), resolution: res, multisample: PIXI.MSAA_QUALITY.HIGH });
  const cv = app.renderer.extract.canvas(tex);
  root.destroy({ children: true }); tex.destroy(true);
  return cv;
};

// the GM layer's marks on the map: a plan's room numbers, each with the room's name, on the GM's screen only, and only
// while they're working on the GM layer (not at all when the plan draws the numbers for everyone). Click one for the
// room's notes. The planner passes its plan while it's being drawn.
// notes for a room: its own, or (an older map) its paragraph in the scene's notes, "**3. Kitchen.** …"
function roomNote(l) {
  if (l.note || l.t) return { t: l.t || '', note: l.note || '' };
  const md = (state.scene && state.scene.meta.notes) || '', m = new RegExp('\\*\\*' + l.n.replace(/[^\w]/g, '') + '\\.\\s*([^*]*?)\\.?\\*\\*\\s*([^\\n]*)').exec(md);
  return m ? { t: m[1].trim(), note: m[2].trim() } : { t: '', note: '' };
}
V.drawGMOverlay = function (planNow) {
  const L = V.stage && V.stage.L; if (!L || !L.gmover) return;
  for (const ch of L.gmover.removeChildren()) ch.destroy({ children: true });
  const s = state.scene, plan = planNow || (s && s.meta.plan);
  L.gmover.visible = V.isGM() && state.layer === 'gm';
  if (!V.isGM() || !plan || !plan.labels || !plan.labels.length || (plan.style && plan.style.labels === 'all') || (s && s.meta.kind === 'world')) return;
  const g = V.grid(), c = g.size, ox = g.ox || 0, oy = g.oy || 0;
  const r = Math.max(9, c * 0.26), lw = Math.max(1.5, c * 0.035), fs = r * 0.95;
  plan.labels.forEach((l, i) => {
    const x = ox + l.x * c, y = oy + l.y * c, info = roomNote(l), name = info.t;
    const tag = new PIXI.Container(); tag.position.set(x, y);
    const num = new PIXI.Text(l.n, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontWeight: '700', fontSize: fs, fill: 0xffffff });
    const nm = name ? new PIXI.Text(name, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontWeight: '600', fontSize: fs * 0.72, fill: 0xf3e6ec }) : null;
    for (const t of [num, nm]) if (t) t.resolution = 3;
    const nw = Math.max(r * 2, num.width + r * 0.8), tw = nm ? nm.width + r * 0.9 : 0, W = nw + tw, H = r * 2;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.35).drawRoundedRect(-nw / 2 + lw * 1.5, -r + lw * 2, W, H, r).endFill();   // its shadow
    bg.lineStyle(lw, 0xffffff, 0.92).beginFill(0x6e3049, 0.94).drawRoundedRect(-nw / 2, -r, W, H, r).endFill();
    if (nm) bg.lineStyle(0).beginFill(0x8e4a66, 0.95).drawRoundedRect(-nw / 2 + lw / 2, -r + lw / 2, nw - lw, H - lw, r - lw / 2).endFill();
    num.anchor.set(0.5); num.position.set(0, 0);
    tag.addChild(bg, num);
    if (nm) { nm.anchor.set(0, 0.5); nm.position.set(nw / 2 + r * 0.35, 0); tag.addChild(nm); }
    if (info.note) { const dot = new PIXI.Graphics().beginFill(0xf0c060).drawCircle(-nw / 2 + W - r * 0.35, -r * 0.62, Math.max(2, r * 0.16)).endFill(); tag.addChild(dot); }   // it has notes
    tag.eventMode = 'static'; tag.cursor = 'pointer';
    tag.hitArea = new PIXI.Rectangle(-nw / 2, -r, W, H);
    tag.on('pointerdown', e => { e.stopPropagation(); if (e.button === 0) openRoomNote(i, e.global); });
    L.gmover.addChild(tag);
  });
};
// a room's notes, by its number on the map: its name and what's there, edited in place; "To chat" reads it out
let notePop = null;
function openRoomNote(i, at) {
  if (notePop) notePop.remove();
  const s = state.scene, plan = s && s.meta.plan, l = plan && plan.labels[i]; if (!l) return;
  const info = roomNote(l);
  const title = V.h('input', { value: info.t, placeholder: 'Room name', class: 'rn-t' });
  const ta = V.h('textarea', { rows: 7, placeholder: 'What’s here, who’s here, what happens…' }); ta.value = info.note;
  const save = () => {
    const p = JSON.parse(JSON.stringify(state.scene.meta.plan)), q = p.labels[i]; if (!q) return;
    q.t = title.value.trim(); q.note = ta.value.trim(); if (!q.t) delete q.t; if (!q.note) delete q.note;
    V.op({ t: 'scene.update', id: state.scene.id, patch: { plan: p } }).catch(e => V.toast(e.message, true));
  };
  const close = () => { if (notePop) { notePop.remove(); notePop = null; document.removeEventListener('pointerdown', away, true); } };
  const away = e => { if (notePop && !notePop.contains(e.target)) close(); };
  notePop = V.h('div', { class: 'roomnote' },
    V.h('div', { class: 'rn-h' }, V.h('span', { class: 'rn-n' }, l.n), title, V.h('button', { class: 'x', title: 'Close', onclick: close }, '×')),
    ta,
    V.h('div', { class: 'row' },
      V.h('button', { class: 'btn sm', title: 'Post it in the chat for everyone (read it out)', onclick: () => { const t = (title.value.trim() ? `**${title.value.trim()}.** ` : '') + ta.value.trim(); if (t.trim()) V.send({ t: 'chat', text: t }).catch(e => V.toast(e.message, true)); } }, 'To chat'),
      V.h('div', { class: 'grow' }),
      V.h('button', { class: 'btn sm', onclick: close }, 'Close'),
      V.h('button', { class: 'btn sm primary', onclick: () => { save(); close(); } }, 'Save')));
  document.body.append(notePop);
  const rc = V.stage.app.view.getBoundingClientRect(), W = notePop.offsetWidth, H = notePop.offsetHeight;
  notePop.style.left = Math.max(8, Math.min(innerWidth - W - 8, rc.left + at.x + 14)) + 'px';
  notePop.style.top = Math.max(8, Math.min(innerHeight - H - 8, rc.top + at.y - 20)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  ta.focus();
}
V.on('scene', () => { if (notePop) { notePop.remove(); notePop = null; } });

// ───────── scene thumbnails (the scenes list) ─────────
// Made here, in the GM's browser, from the map as the players see it, and kept on the server (one file a scene).
// A planned map gets a new one a few seconds after it's changed; a scene without one gets one when the GM looks at it.
const thumbBusy = new Set();
V.makeSceneThumb = async function (sceneId, plan) {
  if (!V.isGM() || !sceneId || thumbBusy.has(sceneId)) return;
  thumbBusy.add(sceneId);
  try {
    const W = 480, H = 320;
    let src = null, bg = '#1b1d22';
    if (plan) {
      await loadTextures();
      src = V.planCanvas(plan, 640, { players: true, c: 48 });
      bg = plan.style && plan.style.render === 'ink' ? plan.style.paper : '#0c0b0a';
    } else {
      const m = state.scene && state.scene.id === sceneId ? state.scene.meta : null;
      if (!m || !m.image || !m.image.url) return;
      src = new Image(); src.src = m.image.url; await src.decode();
      bg = m.bg || bg;
    }
    if (!src) return;
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, k = Math.min(W / sw, H / sh);
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
    const ctx = cv.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.84));
    if (blob) await fetch(`/api/campaigns/${state.camp.id}/thumb/${sceneId}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  } catch (e) { /* not this time */ } finally { thumbBusy.delete(sceneId); }
};
let thumbT = 0;
V.planThumbSoon = (sceneId, plan) => { clearTimeout(thumbT); thumbT = setTimeout(() => V.makeSceneThumb(sceneId, plan), 4000); };
V.on('scene', () => {
  const s = state.scene; if (!s || !V.isGM() || s.meta.kind === 'world') return;
  const entry = (state.camp.scenes || []).find(x => x.id === s.id);
  if (entry && !entry.hasThumb && (s.meta.plan || (s.meta.image && s.meta.image.url))) { const id = s.id; setTimeout(() => { if (state.scene && state.scene.id === id) V.makeSceneThumb(id, state.scene.meta.plan || null); }, 2500); }
});

// one piece of painted furniture on nothing (with its shadow), centred on its square: for making prop pictures
V.planFeatCanvas = function (k, c) {
  const app = V.stage && V.stage.app, def = Plan.FEATS.find(f => f[0] === k); if (!app || !def || !texReady) return null;
  const S = Math.max(def[2], def[3]) + 1, root = new PIXI.Container(), gsh = new PIXI.Graphics(); root.addChild(gsh);
  const f = { k, x: Math.floor((S - def[2]) / 2), y: Math.floor((S - def[3]) / 2), w: def[2], h: def[3], r: 0 };
  root.addChild(drawFeatPainted(f, c, Object.assign({}, Plan.STYLE), Plan.rng(k), gsh));
  const tex = app.renderer.generateTexture(root, { region: new PIXI.Rectangle(0, 0, S * c, S * c), resolution: 1, multisample: PIXI.MSAA_QUALITY.HIGH });
  const cv = app.renderer.extract.canvas(tex); root.destroy({ children: true }); tex.destroy(true);
  return { canvas: cv, cx: (f.x + def[2] / 2) * c, cy: (f.y + def[3] / 2) * c };
};
// a little picture of one piece of furniture (the planner's palette), as a data URL
const thumbCache = new Map();
V.planFeatThumb = function (k, render) {
  const key = k + '|' + render + '|' + texReady; if (thumbCache.has(key)) return thumbCache.get(key);
  const app = V.stage && V.stage.app, def = Plan.FEATS.find(f => f[0] === k); if (!app || !def) return '';
  const c = 40, S = Math.max(def[2], def[3]);
  const P = { cols: S, rows: S, grid: new Uint8Array(S * S).fill(Plan.FLOOR), doors: [], feats: [{ k, x: Math.floor((S - def[2]) / 2), y: Math.floor((S - def[3]) / 2), w: def[2], h: def[3], r: 0 }], labels: [],
    style: Object.assign({}, Plan.STYLE, { render, grid: false, outside: 'dirt', hatch: false, shadow: false }), seed: k };
  const root = new PIXI.Container();
  if (render === 'painted' && texReady) drawPainted(root, P, c, { gm: true, ox: 0, oy: 0 }); else drawInk(root, P, c, { gm: true, ox: 0, oy: 0 });
  const tex = app.renderer.generateTexture(root, { region: new PIXI.Rectangle(0, 0, S * c, S * c), resolution: 1, multisample: PIXI.MSAA_QUALITY.HIGH });
  const url = app.renderer.extract.canvas(tex).toDataURL('image/png');
  root.destroy({ children: true }); tex.destroy(true);
  thumbCache.set(key, url);
  return url;
};

// ───────────────────────── ink ─────────────────────────
function drawInk(root, P, c, o) {
  const st = P.style, ink = hex(st.ink), R = Plan.rng(P.seed || 'plan');
  const off = new PIXI.Container(); off.position.set(o.ox, o.oy); root.addChild(off);
  const at = (x, y) => Plan.at(P, x, y), open = (x, y) => at(x, y) !== Plan.ROCK;
  // the paper
  const paper = new PIXI.Graphics();
  if (T.paper) paper.beginTextureFill({ texture: T.paper, color: hex(st.paper), matrix: new PIXI.Matrix().scale(c * 6 / 512, c * 6 / 512) }); else paper.beginFill(hex(st.paper));
  paper.drawRect(-o.ox, -o.oy, P.cols * c + o.ox, P.rows * c + o.oy).endFill();
  off.addChild(paper);
  // hatching on the rock along the walls: little bundles of parallel strokes, every which way
  if (st.hatch && !o.fast) {
    const gh = new PIXI.Graphics(); off.addChild(gh);
    gh.lineStyle({ width: Math.max(1, c * 0.022), color: ink, alpha: 0.85, cap: PIXI.LINE_CAP.ROUND });
    const near = (x, y, d) => { for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (open(x + dx, y + dy)) return true; return false; };
    // each rock square by the floor gets four bundles (one per quarter), the next ring out a sparser scatter
    for (let y = -2; y <= P.rows + 1; y++) for (let x = -2; x <= P.cols + 1; x++) {
      if (open(x, y)) continue;
      const n1 = near(x, y, 1), n2 = !n1 && near(x, y, 2);
      if (!n1 && !n2) continue;
      for (let q = 0; q < 4; q++) {
        if (n2 && R() > 0.45) continue;
        const a = R() * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        const cx = (x + 0.25 + (q % 2) * 0.5 + (R() - 0.5) * 0.25) * c, cy = (y + 0.25 + (q >> 1) * 0.5 + (R() - 0.5) * 0.25) * c;
        const k = n1 ? 3 + Math.floor(R() * 2) : 2 + Math.floor(R() * 2), gap = c * 0.09, len = c * (n1 ? 0.44 : 0.32) * (0.85 + R() * 0.3);
        for (let i = 0; i < k; i++) {
          const t = (i - (k - 1) / 2) * gap, px = cx - sa * t, py = cy + ca * t, l = len * (0.8 + R() * 0.2);
          gh.moveTo(px - ca * l / 2, py - sa * l / 2).lineTo(px + ca * l / 2, py + sa * l / 2);
        }
      }
      // now and then a pebble
      if (n1 && R() < 0.12) { gh.drawCircle((x + 0.2 + R() * 0.6) * c, (y + 0.2 + R() * 0.6) * c, c * (0.04 + R() * 0.04)); }
    }
  }
  // the floor (and water), a row at a time, under the floor's outline
  const fl = new PIXI.Container(); off.addChild(fl);
  const gf = new PIXI.Graphics(); fl.addChild(gf);
  { const nb = naturalBase(P); if (nb != null) { const m = Plan.MATS[nb][0]; gf.beginFill(m === 'water' ? hex(st.water) : INK_TINT[m] != null ? INK_TINT[m] : hex(st.floor)).drawRect(0, 0, P.cols * c, P.rows * c).endFill(); } }
  const present = new Set(P.grid);
  for (const v of present) {
    if (v === Plan.ROCK) continue;
    const m = Plan.MATS[v][0], col = m === 'water' ? hex(st.water) : INK_TINT[m] != null ? INK_TINT[m] : hex(st.floor);
    gf.beginFill(col);
    runsOf(P, v, (x, y, n) => gf.drawRect(x * c, y * c, n * c, c));
    gf.endFill();
  }
  // a chasm: hatched dark; lava: a few cracks
  if (present.has(Plan.MAT.chasm) || present.has(Plan.MAT.lava)) {
    const gx = new PIXI.Graphics(); fl.addChild(gx);
    gx.lineStyle({ width: Math.max(1, c * 0.02), color: ink, alpha: 0.7 });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      const v = at(x, y);
      if (v === Plan.MAT.chasm) for (let t = 0.2; t < 1; t += 0.2) gx.moveTo(x * c, (y + t) * c).lineTo((x + t) * c, y * c);
      if (v === Plan.MAT.lava && R() < 0.5) { const cx = (x + R()) * c, cy = (y + R()) * c; gx.moveTo(cx, cy).lineTo(cx + c * 0.25, cy + c * (R() - 0.5) * 0.3).lineTo(cx + c * 0.4, cy + c * 0.1); }
    }
  }
  // ripples on the water
  if (!o.fast) {
    const gw = new PIXI.Graphics(); fl.addChild(gw);
    gw.lineStyle({ width: Math.max(1, c * 0.02), color: ink, alpha: 0.35, cap: PIXI.LINE_CAP.ROUND });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (at(x, y) !== Plan.WATER || R() > 0.45) continue;
      const cx = (x + 0.2 + R() * 0.4) * c, cy = (y + 0.3 + R() * 0.4) * c, l = c * 0.35;
      gw.moveTo(cx, cy).bezierCurveTo(cx + l * 0.25, cy - c * 0.08, cx + l * 0.5, cy + c * 0.08, cx + l * 0.75, cy).bezierCurveTo(cx + l * 0.85, cy - c * 0.05, cx + l * 0.95, cy - c * 0.02, cx + l, cy);
    }
  }
  // the grid, inside only
  if (st.grid) {
    const gg = new PIXI.Graphics(); fl.addChild(gg);
    gg.lineStyle({ width: Math.max(1, c * 0.012), color: ink, alpha: 0.22 });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (!open(x, y)) continue;
      if (open(x + 1, y)) gg.moveTo((x + 1) * c, y * c).lineTo((x + 1) * c, (y + 1) * c);
      if (open(x, y + 1)) gg.moveTo(x * c, (y + 1) * c).lineTo((x + 1) * c, (y + 1) * c);
    }
  }
  const chains = wallChains(P, c);
  // a soft shadow inside the walls
  if (st.shadow && !o.fast) {
    const gs = new PIXI.Graphics(); fl.addChild(gs);
    gs.lineStyle({ width: c * 0.34, color: ink, alpha: 0.13, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
    strokeChains(gs, chains.map(ch => ch.map(([x, y]) => [x + c * 0.03, y + c * 0.03])));
  }
  { const shape = floorShape(P, c); off.addChild(shape); fl.mask = shape; }
  // furniture and fittings
  for (const f of P.feats) off.addChild(drawFeatInk(f, c, st, R));
  // walls: thick ink along every edge between floor and rock
  const gwall = new PIXI.Graphics(); off.addChild(gwall);
  const lw = Math.max(2, c * 0.13);
  gwall.lineStyle({ width: lw, color: ink, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
  strokeChains(gwall, chains);
  // doors
  for (const d of P.doors) off.addChild(drawDoorInk(d, c, st, o.gm));
  // room numbers
  if (labelsShown(st, o)) for (const l of P.labels) {
    const t = new PIXI.Text(l.n, { fontFamily: 'Palatino Linotype, Book Antiqua, Georgia, serif', fontWeight: '700', fontSize: Math.max(12, c * 0.62), fill: ink, stroke: hex(st.floor), strokeThickness: Math.max(3, c * 0.12) });
    t.anchor.set(0.5); t.position.set(l.x * c, l.y * c); off.addChild(t);
  }
}
function drawDoorInk(d, c, st, gm) {
  const g = new PIXI.Graphics(), ink = hex(st.ink), floor = hex(st.floor), lw = Math.max(1.5, c * 0.04);
  // drawn along x from 0 to c, the edge at y 0; turned for a west edge
  if (d.s === 'n') g.position.set(d.x * c, d.y * c); else { g.position.set(d.x * c, d.y * c); g.angle = 90; }
  const wall = () => g.lineStyle({ width: Math.max(2, c * 0.13), color: ink, cap: PIXI.LINE_CAP.SQUARE });
  switch (d.k) {
    case 'wall': wall(); g.moveTo(0, 0).lineTo(c, 0); break;
    case 'window': wall(); g.moveTo(0, 0).lineTo(c * 0.15, 0).moveTo(c * 0.85, 0).lineTo(c, 0);
      g.lineStyle({ width: lw, color: ink }).beginFill(floor).drawRect(c * 0.15, -c * 0.06, c * 0.7, c * 0.12).endFill(); break;
    case 'door': case 'locked':
      wall(); g.moveTo(0, 0).lineTo(c * 0.12, 0).moveTo(c * 0.88, 0).lineTo(c, 0);
      g.lineStyle({ width: lw, color: ink }).beginFill(floor).drawRect(c * 0.14, -c * 0.11, c * 0.72, c * 0.22).endFill();
      if (d.k === 'locked') g.lineStyle(0).beginFill(ink).drawCircle(c * 0.5, 0, c * 0.07).endFill();
      break;
    case 'secret':
      if (!gm) { wall(); g.moveTo(0, 0).lineTo(c, 0); break; }
      wall(); g.moveTo(0, 0).lineTo(c, 0);
      g.lineStyle({ width: lw, color: 0xffffff }); for (let i = 0; i < 4; i++) g.moveTo(c * (0.15 + i * 0.2), 0).lineTo(c * (0.25 + i * 0.2), 0);
      { const t = new PIXI.Text('S', { fontFamily: 'Georgia, serif', fontWeight: '700', fontSize: c * 0.3, fill: 0x8a2020 }); t.anchor.set(0.5); t.position.set(c * 0.5, -c * 0.24); if (d.s === 'w') t.angle = -90; g.addChild(t); }
      break;
    case 'arch':
      g.lineStyle(0).beginFill(ink).drawRect(-c * 0.02, -c * 0.12, c * 0.16, c * 0.24).drawRect(c * 0.86, -c * 0.12, c * 0.16, c * 0.24).endFill();
      break;
    case 'bars':
      wall(); g.moveTo(0, 0).lineTo(c * 0.1, 0).moveTo(c * 0.9, 0).lineTo(c, 0);
      g.lineStyle({ width: lw * 0.7, color: ink }).moveTo(c * 0.1, 0).lineTo(c * 0.9, 0);
      g.lineStyle(0).beginFill(ink); for (let i = 0; i < 5; i++) g.drawCircle(c * (0.18 + i * 0.16), 0, c * 0.045); g.endFill();
      break;
  }
  return g;
}
// one piece of furniture: drawn about its middle, its back (where it meets a wall) to the north, then turned
function drawFeatInk(f, c, st, R) {
  const g = new PIXI.Graphics(), ink = hex(st.ink), floor = hex(st.floor), shade = 0xe4dccb, water = hex(st.water);
  const fw = (f.r % 2 ? f.h : f.w), fh = (f.r % 2 ? f.w : f.h);
  g.position.set((f.x + fw / 2) * c, (f.y + fh / 2) * c); g.angle = f.r * 90;
  const W = f.w * c, H = f.h * c, lw = Math.max(1.2, c * 0.035);
  const line = (a = 1, wd = lw) => g.lineStyle({ width: wd, color: ink, alpha: a, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
  const box = (x, y, w, hh, fill) => { line(); g.beginFill(fill == null ? floor : fill).drawRect(x, y, w, hh).endFill(); };
  const circ = (x, y, r, fill) => { line(); g.beginFill(fill == null ? floor : fill).drawCircle(x, y, r).endFill(); };
  const hatchRect = (x, y, w, hh, step) => { line(0.6, lw * 0.6); for (let t = -hh; t < w; t += step) { const x0 = Math.max(x, x + t), y0 = y + Math.max(0, -t), x1 = Math.min(x + w, x + t + hh), y1 = y + Math.min(hh, w - t); if (x1 > x0) g.moveTo(x0, y0).lineTo(x1, y1); } };
  switch (f.k) {
    case 'column': circ(0, 0, c * 0.3, shade); circ(0, 0, c * 0.18, shade); break;
    case 'pillar': box(-c * 0.3, -c * 0.3, c * 0.6, c * 0.6, shade); hatchRect(-c * 0.3, -c * 0.3, c * 0.6, c * 0.6, c * 0.12); break;
    case 'stairsdown': case 'stairsup': {
      box(-W * 0.42, -H * 0.47, W * 0.84, H * 0.94);
      const n = Math.round(f.h * 4);
      line(0.9);
      for (let i = 1; i < n; i++) { const y = -H * 0.47 + H * 0.94 * i / n, inset = f.k === 'stairsdown' ? W * 0.3 * i / n : 0; g.moveTo(-W * 0.42 + inset, y).lineTo(W * 0.42 - inset, y); }
      line(); g.beginFill(ink).drawPolygon([0, H * 0.3, -c * 0.1, H * 0.15, c * 0.1, H * 0.15]).endFill();
      if (f.k === 'stairsup') g.angle += 180;
      break;
    }
    case 'statue': circ(0, 0, c * 0.36, shade); line(); g.beginFill(floor).drawStar ? g.drawStar(0, 0, 5, c * 0.24, c * 0.11) : g.drawCircle(0, 0, c * 0.2); g.endFill(); break;
    case 'altar': box(-W * 0.42, -H * 0.3, W * 0.84, H * 0.6, shade); box(-W * 0.32, -H * 0.18, W * 0.64, H * 0.36); break;
    case 'fountain': circ(0, 0, Math.min(W, H) * 0.44, shade); circ(0, 0, Math.min(W, H) * 0.34, water); circ(0, 0, c * 0.14, shade); break;
    case 'well': circ(0, 0, c * 0.38, shade); circ(0, 0, c * 0.24, water); break;
    case 'sarcophagus': box(-W * 0.36, -H * 0.44, W * 0.72, H * 0.88, shade); box(-W * 0.26, -H * 0.34, W * 0.52, H * 0.68); line(0.7); g.moveTo(0, -H * 0.25).lineTo(0, H * 0.25).moveTo(-W * 0.14, -H * 0.12).lineTo(W * 0.14, -H * 0.12); break;
    case 'coffin': line(); g.beginFill(shade).drawPolygon([-W * 0.18, -H * 0.45, W * 0.18, -H * 0.45, W * 0.32, -H * 0.18, W * 0.2, H * 0.45, -W * 0.2, H * 0.45, -W * 0.32, -H * 0.18]).endFill(); break;
    case 'rubble': { line(); for (let i = 0; i < 6; i++) { const x = (R() - 0.5) * c * 0.7, y = (R() - 0.5) * c * 0.7, r = c * (0.06 + R() * 0.1), pts = []; for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + R(); pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.beginFill(shade).drawPolygon(pts).endFill(); } break; }
    case 'trapdoor': box(-c * 0.36, -c * 0.36, c * 0.72, c * 0.72); line(0.8); g.moveTo(-c * 0.36, -c * 0.36).lineTo(c * 0.36, c * 0.36).moveTo(c * 0.36, -c * 0.36).lineTo(-c * 0.36, c * 0.36); break;
    case 'pit': circ(0, 0, c * 0.4, 0x3a3530); line(0.5, lw * 0.6); for (let i = -2; i <= 2; i++) g.moveTo(-c * 0.28, i * c * 0.1).lineTo(c * 0.28, i * c * 0.1); break;
    case 'brazier': circ(0, 0, c * 0.26, shade); g.lineStyle(0).beginFill(0xc8642a).drawCircle(0, 0, c * 0.13).endFill(); break;
    case 'throne': box(-c * 0.32, -c * 0.3, c * 0.64, c * 0.62, shade); box(-c * 0.38, -c * 0.42, c * 0.76, c * 0.16, ink); break;
    case 'stalagmite': { line(); const pts = []; for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, r = c * (0.18 + R() * 0.12); pts.push(Math.cos(a) * r, Math.sin(a) * r); } g.beginFill(shade).drawPolygon(pts).endFill(); circ(0, 0, c * 0.05, ink); break; }
    case 'table': box(-W * 0.44, -H * 0.36, W * 0.88, H * 0.72); break;
    case 'roundtable': circ(0, 0, Math.min(W, H) * 0.4); break;
    case 'chair': box(-c * 0.22, -c * 0.18, c * 0.44, c * 0.42); box(-c * 0.22, -c * 0.3, c * 0.44, c * 0.1, ink); break;
    case 'bench': box(-W * 0.45, -H * 0.17, W * 0.9, H * 0.34); break;
    case 'bed': box(-W * 0.4, -H * 0.46, W * 0.8, H * 0.92); box(-W * 0.3, -H * 0.4, W * 0.6, H * 0.16, shade); line(0.6); g.moveTo(-W * 0.4, -H * 0.12).lineTo(W * 0.4, -H * 0.12); break;
    case 'bunk': box(-W * 0.4, -H * 0.46, W * 0.8, H * 0.92); box(-W * 0.3, -H * 0.4, W * 0.6, H * 0.14, shade); line(0.6); g.moveTo(-W * 0.4, -H * 0.46).lineTo(W * 0.4, H * 0.46).moveTo(W * 0.4, -H * 0.46).lineTo(-W * 0.4, H * 0.46); break;
    case 'bookshelf': box(-W * 0.48, -H * 0.48, W * 0.96, H * 0.4, shade); line(0.7, lw * 0.6); for (let x = -W * 0.48 + c * 0.12; x < W * 0.48; x += c * 0.12) g.moveTo(x, -H * 0.46).lineTo(x, -H * 0.1); break;
    case 'counter': box(-W * 0.48, -H * 0.3, W * 0.96, H * 0.5, shade); break;
    case 'fireplace': box(-W * 0.45, -H * 0.5, W * 0.9, H * 0.55, shade); box(-W * 0.28, -H * 0.38, W * 0.56, H * 0.38, 0x3a3530); g.lineStyle(0).beginFill(0xc8642a).drawEllipse(0, -H * 0.2, W * 0.12, H * 0.1).endFill(); break;
    case 'rug': line(0.8); g.beginFill(0xe9dcc4).drawRect(-W * 0.44, -H * 0.44, W * 0.88, H * 0.88).endFill(); line(0.6, lw * 0.6); g.drawRect(-W * 0.36, -H * 0.36, W * 0.72, H * 0.72); break;
    case 'chest': box(-c * 0.3, -c * 0.2, c * 0.6, c * 0.4, shade); line(0.8); g.moveTo(-c * 0.3, -c * 0.06).lineTo(c * 0.3, -c * 0.06); g.lineStyle(0).beginFill(ink).drawRect(-c * 0.04, -c * 0.1, c * 0.08, c * 0.1).endFill(); break;
    case 'barrel': circ(0, 0, c * 0.3, shade); circ(0, 0, c * 0.2); break;
    case 'crate': box(-c * 0.3, -c * 0.3, c * 0.6, c * 0.6, shade); line(0.7); g.moveTo(-c * 0.3, -c * 0.3).lineTo(c * 0.3, c * 0.3).moveTo(c * 0.3, -c * 0.3).lineTo(-c * 0.3, c * 0.3); break;
    case 'wardrobe': box(-W * 0.46, -H * 0.48, W * 0.92, H * 0.5, shade); line(0.7); g.moveTo(0, -H * 0.48).lineTo(0, H * 0.02); break;
    case 'desk': box(-W * 0.44, -H * 0.4, W * 0.88, H * 0.5); box(-c * 0.18, H * 0.16, c * 0.36, c * 0.26); break;
    case 'anvil': line(); g.beginFill(0x8a8378).drawPolygon([-c * 0.32, -c * 0.12, c * 0.22, -c * 0.12, c * 0.34, 0, c * 0.22, c * 0.12, -c * 0.32, c * 0.12, -c * 0.2, 0]).endFill(); break;
    case 'cauldron': circ(0, 0, c * 0.32, 0x3a3530); circ(0, 0, c * 0.22, 0x6f8f5a); break;
    case 'plant': circ(0, 0, c * 0.16, shade); line(0.8); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.moveTo(Math.cos(a) * c * 0.14, Math.sin(a) * c * 0.14).lineTo(Math.cos(a) * c * 0.34, Math.sin(a) * c * 0.34); } break;
    case 'cage': box(-c * 0.38, -c * 0.38, c * 0.76, c * 0.76); line(0.7, lw * 0.7); for (let x = -c * 0.26; x < c * 0.38; x += c * 0.13) g.moveTo(x, -c * 0.38).lineTo(x, c * 0.38); break;
    case 'weaponrack': box(-W * 0.46, -H * 0.48, W * 0.92, H * 0.2, shade); line(0.9); for (let x = -W * 0.36; x < W * 0.4; x += c * 0.22) g.moveTo(x, -H * 0.28).lineTo(x + c * 0.08, H * 0.1); break;
    case 'torch': box(-c * 0.08, -c * 0.5, c * 0.16, c * 0.18, ink); circ(0, -c * 0.26, c * 0.1, 0xe08a3a); break;
    case 'lamp': box(-c * 0.05, -c * 0.5, c * 0.1, c * 0.1, ink); box(-c * 0.11, -c * 0.4, c * 0.22, c * 0.2, 0xf2c870); line(0.6); g.moveTo(-c * 0.11, -c * 0.3).lineTo(c * 0.11, -c * 0.3); break;
    case 'candles': for (const [x, y] of [[-0.15, -0.1], [0.12, -0.15], [0.02, 0.14]]) { circ(x * c, y * c, c * 0.06, floor); } break;
    case 'bones': line(0.9); for (let i = 0; i < 4; i++) { const x = (R() - 0.5) * c * 0.6, y = (R() - 0.5) * c * 0.6, a = R() * Math.PI, l = c * 0.16; g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l).lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); } circ((R() - 0.5) * c * 0.3, (R() - 0.5) * c * 0.3, c * 0.1); break;
    case 'cobweb': line(0.6, lw * 0.5); for (let a = 0; a <= 4; a++) { const t = a / 4 * Math.PI / 2; g.moveTo(-c * 0.5, -c * 0.5).lineTo(-c * 0.5 + Math.cos(t) * c * 0.8, -c * 0.5 + Math.sin(t) * c * 0.8); } for (const r of [0.25, 0.45, 0.65]) g.arc(-c * 0.5, -c * 0.5, c * r, 0, Math.PI / 2); break;
    case 'sack': circ(-c * 0.12, 0, c * 0.2, shade); circ(c * 0.15, c * 0.08, c * 0.17, shade); break;
    case 'blood': g.lineStyle(0).beginFill(ink, 0.25).drawEllipse(0, 0, c * 0.32, c * 0.22).drawCircle(c * 0.3, c * 0.2, c * 0.06).endFill(); break;
    case 'banner': box(-c * 0.35, -c * 0.5, c * 0.7, c * 0.12, ink); box(-c * 0.28, -c * 0.38, c * 0.56, c * 0.3, shade); break;
    case 'shelf': box(-W * 0.46, -H * 0.48, W * 0.92, H * 0.28, shade); break;
    case 'boulder': { line(); const pts = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = c * (0.32 + R() * 0.1); pts.push(Math.cos(a) * r, Math.sin(a) * r); } g.beginFill(shade).drawPolygon(pts).endFill(); break; }
    case 'tree': { line(0.9); for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, r = W * 0.3; g.beginFill(0xdde5cf).drawCircle(Math.cos(a) * r, Math.sin(a) * r, W * 0.2).endFill(); } g.beginFill(0xdde5cf).drawCircle(0, 0, W * 0.3).endFill(); break; }
    case 'bush': { line(0.9); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.beginFill(0xdde5cf).drawCircle(Math.cos(a) * c * 0.16, Math.sin(a) * c * 0.16, c * 0.17).endFill(); } break; }
    case 'log': box(-W * 0.45, -H * 0.22, W * 0.9, H * 0.44, shade); circ(W * 0.45, 0, H * 0.22, shade); break;
    case 'tent': line(); g.beginFill(shade).drawPolygon([-W * 0.45, H * 0.45, 0, -H * 0.45, W * 0.45, H * 0.45]).endFill(); line(0.7); g.moveTo(0, -H * 0.45).lineTo(0, H * 0.45); break;
    case 'campfire': for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; circ(Math.cos(a) * c * 0.28, Math.sin(a) * c * 0.28, c * 0.07, shade); } g.lineStyle(0).beginFill(0xe08a3a).drawCircle(0, 0, c * 0.15).endFill(); break;
    case 'cart': box(-W * 0.4, -H * 0.38, W * 0.8, H * 0.76, shade); box(-W * 0.48, -H * 0.2, W * 0.08, H * 0.24, ink); box(W * 0.4, -H * 0.2, W * 0.08, H * 0.24, ink); line(); g.moveTo(0, -H * 0.38).lineTo(0, -H * 0.5); break;
    case 'haybale': box(-c * 0.36, -c * 0.3, c * 0.72, c * 0.6, 0xefe2b0); line(0.6); g.moveTo(-c * 0.12, -c * 0.3).lineTo(-c * 0.12, c * 0.3).moveTo(c * 0.12, -c * 0.3).lineTo(c * 0.12, c * 0.3); break;
    default: box(-W * 0.4, -H * 0.4, W * 0.8, H * 0.8, shade);
  }
  return g;
}


// ───────────────────────── painted: photo textures (ambientCG, CC0), shaded walls, props with shadows ─────────────────────────
// [texture, squares one repeat covers, tint]
const MATLOOK = {
  floor: null, flagstone: ['flagstone', 3, 0xd6d0c6], cobble: ['cobble', 2.2, 0xd4d0cc], planks: ['planks', 3, 0xf2e6d8], oldplanks: ['oldplanks', 2.6, 0xe0d4c4],
  dirt: ['dirt', 4, 0xc4b296], grass: ['grass', 4, 0xe6eed8], cave: ['rock', 4.5, 0xa8a49c], gravel: ['gravel', 3, 0xcfc9c0], marble: ['marble', 4, 0xf4f0ea],
  tiles: ['tiles', 4, 0xe8e2d8], sand: ['sand', 4, 0xfff4e0], snow: ['snow', 4, 0xffffff], carpet: ['cloth', 1.2, 0x9a3a32], mossy: ['mossycobble', 2.2, 0xd8d8cc],
  earth: ['earth', 4, 0xd8ccbc]
};
const WALLLOOK = { stone: ['flagstone', 1.4, 0x6e6a62], rock: ['rock', 2.5, 0x6a665f], brick: ['brick', 1.5, 0x7a6a60], wood: ['oldplanks', 1.6, 0x8a7660], plaster: ['plaster', 2, 0xc8c0b2] };
const OUTLOOK = { rock: ['rock', 5, 0x4a4743], black: null, earth: ['earth', 5, 0xb0a494], grass: ['grass', 5, 0xc8d4b8], dirt: ['dirt', 5, 0xa89880], snow: ['snow', 5, 0xe8eef2], sand: ['sand', 5, 0xe8dcc4] };
const RIM = 0x15120f;
function texFill(g, look, c, opts) {
  opts = opts || {};
  const t = look && T[look[0]];
  if (!t) { g.beginFill(opts.fallback != null ? opts.fallback : (look ? look[2] : 0x777777), opts.alpha == null ? 1 : opts.alpha); return; }
  const s = (opts.sq || look[1]) * c / 512, m = new PIXI.Matrix().scale(s, s);
  if (opts.rot) m.rotate(opts.rot);
  if (opts.tx || opts.ty) m.translate(opts.tx || 0, opts.ty || 0);
  g.beginTextureFill({ texture: t, color: opts.tint != null ? opts.tint : look[2], alpha: opts.alpha == null ? 1 : opts.alpha, matrix: m });
}
function drawPainted(root, P, c, o) {
  const st = P.style, R = Plan.rng(P.seed || 'plan');
  const off = new PIXI.Container(); off.position.set(o.ox, o.oy); root.addChild(off);
  const at = (x, y) => Plan.at(P, x, y), open = (x, y) => at(x, y) !== Plan.ROCK;
  const W = P.cols * c, H = P.rows * c;
  const matOf = v => { const m = Plan.MATS[v][0]; return m === 'floor' ? st.floorMat : m; };
  // outside the walls: the rock (or the ground round a building)
  const gout = new PIXI.Graphics(); off.addChild(gout);
  const ol = OUTLOOK[st.outside];
  if (ol) texFill(gout, ol, c); else gout.beginFill(0x0c0b0a);
  gout.drawRect(-o.ox, -o.oy, W + o.ox, H + o.oy).endFill();
  if (st.outside === 'rock') gout.beginFill(0x000000, 0.35).drawRect(-o.ox, -o.oy, W + o.ox, H + o.oy).endFill();
  // the floors, each material its own texture (offset a little per material, so neighbours don't line up)
  const present = new Set(P.grid);
  const fl = new PIXI.Container(); off.addChild(fl);   // everything on the floor, under the floor's outline
  const gf = new PIXI.Graphics(); fl.addChild(gf);
  { const nb = naturalBase(P); if (nb != null) { const m = matOf(nb); if (MATLOOK[m]) { texFill(gf, MATLOOK[m], c, { tx: (nb * 137) % 512, ty: (nb * 89) % 512 }); gf.drawRect(0, 0, W, H); gf.endFill(); } else if (m === 'water') gf.beginFill(0x24525a).drawRect(0, 0, W, H).endFill(); } }
  for (const v of present) {
    if (v === Plan.ROCK) continue;
    const m = matOf(v);
    if (m === 'water' || m === 'lava' || m === 'chasm') continue;
    texFill(gf, MATLOOK[m], c, { tx: (v * 137) % 512, ty: (v * 89) % 512 });
    runsOf(P, v, (x, y, n) => gf.drawRect(x * c, y * c, n * c, c));
    gf.endFill();
  }
  // tone: a gentle unevenness so big rooms don't look like wallpaper
  if (!o.fast) {
    const gt = new PIXI.Graphics(); fl.addChild(gt);
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (!open(x, y)) continue;
      const k = R();
      if (k < 0.18) gt.beginFill(0x000000, 0.05 + R() * 0.05).drawRect(x * c, y * c, c, c).endFill();
      else if (k > 0.9) gt.beginFill(0xffffff, 0.03 + R() * 0.03).drawRect(x * c, y * c, c, c).endFill();
    }
  }
  // water, lava, a chasm
  const liquid = (v, base, look, tint, alpha) => {
    if (!present.has(v)) return;
    const g = new PIXI.Graphics(); fl.addChild(g);
    g.beginFill(base); runsOf(P, v, (x, y, n) => g.drawRect(x * c, y * c, n * c, c)); g.endFill();
    if (look && T[look]) { texFill(g, [look, 3, tint], c, { alpha }); runsOf(P, v, (x, y, n) => g.drawRect(x * c, y * c, n * c, c)); g.endFill(); }
    return g;
  };
  const edgesOf = (inside, test, fn) => {   // each edge of an 'inside' square whose neighbour passes 'test'
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (!inside(x, y)) continue;
      if (test(x, y - 1)) fn(x, y, 0); if (test(x + 1, y)) fn(x, y, 1); if (test(x, y + 1)) fn(x, y, 2); if (test(x - 1, y)) fn(x, y, 3);
    }
  };
  const band = (g, x, y, side, d) => { if (side === 0) g.drawRect(x * c, y * c, c, d); else if (side === 1) g.drawRect((x + 1) * c - d, y * c, d, c); else if (side === 2) g.drawRect(x * c, (y + 1) * c - d, c, d); else g.drawRect(x * c, y * c, d, c); };
  const isV = v => (x, y) => at(x, y) === v, notV = v => (x, y) => open(x, y) && at(x, y) !== v;
  const gw = liquid(Plan.WATER, 0x24525a, 'ice', 0x78aeb2, 0.5);
  if (gw && !o.fast) {
    // shallows by the edge, foam where it meets the floor
    for (const [d, a] of [[0.12, 0.16], [0.26, 0.12], [0.42, 0.08]]) { gw.beginFill(0x9fd6d0, a); edgesOf(isV(Plan.WATER), notV(Plan.WATER), (x, y, s) => band(gw, x, y, s, d * c)); gw.endFill(); }
    gw.beginFill(0x0a1e22, 0.25); edgesOf(isV(Plan.WATER), (x, y) => !open(x, y), (x, y, s) => band(gw, x, y, s, 0.2 * c)); gw.endFill();
    gw.lineStyle({ width: Math.max(1, c * 0.03), color: 0xe6f6f2, alpha: 0.55 });
    edgesOf(isV(Plan.WATER), notV(Plan.WATER), (x, y, s) => { const p = [[x, y, x + 1, y], [x + 1, y, x + 1, y + 1], [x, y + 1, x + 1, y + 1], [x, y, x, y + 1]][s]; gw.moveTo(p[0] * c, p[1] * c).lineTo(p[2] * c, p[3] * c); });
    gw.lineStyle({ width: Math.max(1, c * 0.02), color: 0xd8f0ec, alpha: 0.35, cap: PIXI.LINE_CAP.ROUND });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (at(x, y) !== Plan.WATER || R() > 0.35) continue;
      const cx = (x + 0.2 + R() * 0.4) * c, cy = (y + 0.3 + R() * 0.4) * c, l = c * 0.3;
      gw.moveTo(cx, cy).bezierCurveTo(cx + l * 0.3, cy - c * 0.06, cx + l * 0.6, cy + c * 0.06, cx + l, cy);
    }
  }
  const gl = liquid(Plan.MAT.lava, 0x6a1604, 'rock', 0xff6a20, 0.55);
  if (gl && !o.fast) {
    gl.lineStyle({ width: Math.max(1, c * 0.05), color: 0xffd060, alpha: 0.85, cap: PIXI.LINE_CAP.ROUND });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (at(x, y) !== Plan.MAT.lava || R() > 0.6) continue;
      let px = (x + R()) * c, py = (y + R()) * c; gl.moveTo(px, py);
      for (let k = 0; k < 3; k++) { px += (R() - 0.5) * c * 0.5; py += (R() - 0.5) * c * 0.5; gl.lineTo(px, py); }
    }
    gl.lineStyle(0); gl.beginFill(0x1a0802, 0.5); edgesOf(isV(Plan.MAT.lava), notV(Plan.MAT.lava), (x, y, s) => band(gl, x, y, s, 0.14 * c)); gl.endFill();
  }
  const gc = liquid(Plan.MAT.chasm, 0x030303, null);
  if (gc) {
    // the drop: the floor's edge, then shading away into the dark
    for (const [d, col, a] of [[0.07, 0x4a4540, 0.9], [0.18, 0x2a2724, 0.7], [0.34, 0x161412, 0.6]]) { gc.beginFill(col, a); edgesOf(isV(Plan.MAT.chasm), notV(Plan.MAT.chasm), (x, y, s) => band(gc, x, y, s, d * c)); gc.endFill(); }
  }
  // the grid on the floor
  if (st.grid) {
    const gg = new PIXI.Graphics(); fl.addChild(gg);
    gg.lineStyle({ width: Math.max(1, c * 0.012), color: 0x000000, alpha: 0.2 });
    for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
      if (!open(x, y)) continue;
      if (open(x + 1, y)) gg.moveTo((x + 1) * c, y * c).lineTo((x + 1) * c, (y + 1) * c);
      if (open(x, y + 1)) gg.moveTo(x * c, (y + 1) * c).lineTo((x + 1) * c, (y + 1) * c);
    }
  }
  // shade along the walls (darker in the corners, as light falls off)
  const chains = wallChains(P, c);
  const innerWalls = P.doors.filter(d => d.k === 'wall' || (d.k === 'secret' && !o.gm));
  if (!o.fast) {
    const ga = new PIXI.Graphics(); fl.addChild(ga);
    for (const [d, a] of [[0.12, 0.22], [0.26, 0.15], [0.44, 0.1], [0.7, 0.06]]) {   // strokes along the walls, half of each falling on the floor
      ga.lineStyle({ width: d * c * 2, color: 0x000000, alpha: a, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      strokeChains(ga, chains);
      ga.lineStyle(0); ga.beginFill(0x000000, a);
      for (const dd of innerWalls) {   // inner walls cast it both ways
        if (dd.s === 'n') { ga.drawRect(dd.x * c, dd.y * c, c, d * c * 0.7); ga.drawRect(dd.x * c, dd.y * c - d * c * 0.7, c, d * c * 0.7); }
        else { ga.drawRect(dd.x * c, dd.y * c, d * c * 0.7, c); ga.drawRect(dd.x * c - d * c * 0.7, dd.y * c, d * c * 0.7, c); }
      }
      ga.endFill();
    }
  }
  { const shape = floorShape(P, c); off.addChild(shape); fl.mask = shape; }
  // furniture: shadows first (all of them, under everything), then the pieces
  const gsh = new PIXI.Graphics(); off.addChild(gsh);
  const props = new PIXI.Container(); off.addChild(props);
  for (const f of P.feats) { const p = drawFeatPainted(f, c, st, R, gsh); if (p) props.addChild(p); }
  // walls: a dark rim, then the stone, with a lighter top edge
  const wl = WALLLOOK[st.wallMat] || WALLLOOK.stone;
  const gwall = new PIXI.Graphics(); off.addChild(gwall);
  const seg = (a, b) => gwall.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
  const innerSeg = d => d.s === 'n' ? [[d.x * c, d.y * c], [(d.x + 1) * c, d.y * c]] : [[d.x * c, d.y * c], [d.x * c, (d.y + 1) * c]];
  const wallW = c * 0.36;
  gwall.lineStyle({ width: wallW + c * 0.08, color: RIM, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
  strokeChains(gwall, chains); for (const d of innerWalls) seg(...innerSeg(d));
  const wt = T[wl[0]];
  if (wt) gwall.lineTextureStyle({ width: wallW, texture: wt, color: wl[2], matrix: new PIXI.Matrix().scale(wl[1] * c / 512, wl[1] * c / 512), cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
  else gwall.lineStyle({ width: wallW, color: wl[2], cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
  strokeChains(gwall, chains); for (const d of innerWalls) seg(...innerSeg(d));
  gwall.lineStyle({ width: wallW * 0.35, color: 0xffffff, alpha: 0.07, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });   // the wall's top catches the light
  strokeChains(gwall, chains); for (const d of innerWalls) seg(...innerSeg(d));
  // doors
  for (const d of P.doors) { if (d.k === 'wall' || (d.k === 'secret' && !o.gm)) continue; off.addChild(drawDoorPainted(d, c, st, o.gm, wl)); }
  // room numbers (the GM's: players see the place, not the key)
  if (labelsShown(st, o)) for (const l of P.labels) {
    const t = new PIXI.Text(l.n, { fontFamily: 'Palatino Linotype, Book Antiqua, Georgia, serif', fontWeight: '700', fontSize: Math.max(12, c * 0.55), fill: 0xfff6e0, stroke: 0x1a1410, strokeThickness: Math.max(3, c * 0.1) });
    t.anchor.set(0.5); t.alpha = 0.9; t.position.set(l.x * c, l.y * c); off.addChild(t);
  }
}
function drawDoorPainted(d, c, st, gm, wl) {
  const g = new PIXI.Graphics();
  g.position.set(d.x * c, d.y * c); if (d.s === 'w') g.angle = 90;
  const post = (x) => { g.lineStyle({ width: Math.max(1, c * 0.02), color: RIM }); texFill(g, wl, c, { fallback: wl[2] }); g.drawRect(x - c * 0.1, -c * 0.19, c * 0.2, c * 0.38); g.endFill(); };
  const wood = (x, y, w, h, tint) => { g.lineStyle({ width: Math.max(1, c * 0.025), color: RIM }); texFill(g, ['planks', 1.2, tint || 0xb08a60], c, { rot: Math.PI / 2 }); g.drawRect(x, y, w, h); g.endFill(); };
  switch (d.k) {
    case 'door': case 'locked': case 'secret': {
      wood(c * 0.1, -c * 0.1, c * 0.8, c * 0.2, d.k === 'secret' ? 0x8a8070 : null);
      g.lineStyle({ width: Math.max(1, c * 0.012), color: RIM, alpha: 0.6 });
      for (let x = 0.3; x < 0.9; x += 0.2) g.moveTo(c * x, -c * 0.1).lineTo(c * x, c * 0.1);
      g.lineStyle(0).beginFill(0x2a2622).drawRect(c * 0.22, -c * 0.11, c * 0.06, c * 0.22).drawRect(c * 0.72, -c * 0.11, c * 0.06, c * 0.22).endFill();   // hinges
      if (d.k === 'locked') g.lineStyle({ width: Math.max(1, c * 0.015), color: RIM }).beginFill(0xc9a45c).drawCircle(c * 0.5, 0, c * 0.06).endFill();
      post(0); post(c);
      if (d.k === 'secret' && gm) { const t = new PIXI.Text('S', { fontFamily: 'Georgia, serif', fontWeight: '700', fontSize: c * 0.3, fill: 0xff9a7a, stroke: 0x000000, strokeThickness: 3 }); t.anchor.set(0.5); t.position.set(c * 0.5, -c * 0.3); if (d.s === 'w') t.angle = -90; g.addChild(t); }
      break;
    }
    case 'arch': post(0); post(c); g.lineStyle(0).beginFill(0x000000, 0.25).drawRect(c * 0.1, -c * 0.04, c * 0.8, c * 0.08).endFill(); break;
    case 'window': {
      const wt = T[wl[0]];
      g.lineStyle({ width: c * 0.44, color: RIM, cap: PIXI.LINE_CAP.SQUARE }).moveTo(0, 0).lineTo(c, 0);
      if (wt) g.lineTextureStyle({ width: c * 0.36, texture: wt, color: wl[2], matrix: new PIXI.Matrix().scale(wl[1] * c / 512, wl[1] * c / 512), cap: PIXI.LINE_CAP.SQUARE }); else g.lineStyle({ width: c * 0.36, color: wl[2], cap: PIXI.LINE_CAP.SQUARE });
      g.moveTo(0, 0).lineTo(c, 0);
      g.lineStyle({ width: Math.max(1, c * 0.02), color: RIM }).beginFill(0xbfd8e0, 0.85).drawRect(c * 0.15, -c * 0.06, c * 0.7, c * 0.12).endFill();
      g.lineStyle({ width: Math.max(1, c * 0.015), color: RIM, alpha: 0.7 }).moveTo(c * 0.5, -c * 0.06).lineTo(c * 0.5, c * 0.06);
      break;
    }
    case 'bars':
      g.lineStyle({ width: Math.max(2, c * 0.05), color: 0x2e2c2a });
      g.moveTo(c * 0.08, 0).lineTo(c * 0.92, 0);
      g.lineStyle(0); for (let i = 0; i < 6; i++) { g.beginFill(0x3a3836).drawCircle(c * (0.14 + i * 0.145), 0, c * 0.045).endFill(); g.beginFill(0x8a8884).drawCircle(c * (0.13 + i * 0.145), -c * 0.012, c * 0.015).endFill(); }
      post(0); post(c);
      break;
  }
  return g;
}
// a piece of furniture, painted: wood and cloth and stone, with its shadow cast down and to the right
function drawFeatPainted(f, c, st, R, gsh) {
  const g = new PIXI.Graphics();
  const fw = (f.r % 2 ? f.h : f.w), fh = (f.r % 2 ? f.w : f.h);
  const cx = (f.x + fw / 2) * c, cy = (f.y + fh / 2) * c;
  g.position.set(cx, cy); g.angle = f.r * 90;
  const W = f.w * c, H = f.h * c, lw = Math.max(1, c * 0.025);
  // shadow, in the map's own frame: offset down-right, drawn in the shared shadow layer
  const ang = f.r * Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const toWorld = (x, y) => [cx + x * ca - y * sa, cy + x * sa + y * ca];
  const shadowRect = (x, y, w, h, k) => { k = k || 1; for (const [d, a] of [[0.1, 0.18], [0.06, 0.2]]) { const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => toWorld(px, py)).flatMap(([px, py]) => [px + d * c * k, py + d * c * 1.2 * k]); gsh.beginFill(0x000000, a).drawPolygon(pts).endFill(); } };
  const shadowCirc = (x, y, r, k) => { k = k || 1; const [wx, wy] = toWorld(x, y); for (const [d, a] of [[0.1, 0.18], [0.06, 0.2]]) gsh.beginFill(0x000000, a).drawCircle(wx + d * c * k, wy + d * c * 1.2 * k, r * 1.04).endFill(); };
  const edge = (a) => g.lineStyle({ width: lw, color: RIM, alpha: a == null ? 0.85 : a, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
  const none = () => g.lineStyle(0);
  const rect = (x, y, w, h, look, o) => { edge(o && o.edgeA); texFill(g, look, c, o); g.drawRect(x, y, w, h); g.endFill(); };
  const rrect = (x, y, w, h, r, look, o) => { edge(o && o.edgeA); texFill(g, look, c, o); g.drawRoundedRect(x, y, w, h, r); g.endFill(); };
  const circ = (x, y, r, look, o) => { edge(o && o.edgeA); texFill(g, look, c, o); g.drawCircle(x, y, r); g.endFill(); };
  const flat = (col, a) => [null, 1, col];
  const WOOD = ['wood', 1.6, 0xd8b894], DARKWOOD = ['wood', 1.6, 0x8a6a4a], PLANK = ['planks', 1.2, 0xc8a47c], STONE = ['flagstone', 1.2, 0xb0aaa0], MARB = ['marble', 2, 0xece6dc],
    CLOTH = col => ['cloth', 0.8, col], METAL = flat(0x4a4846), ROCKL = ['rock', 1.5, 0x9a958c];
  const hi = (x, y, w, h, a) => { none(); g.beginFill(0xffffff, a || 0.12).drawRect(x, y, w, h).endFill(); };
  const lines = (pts, col, a, w) => { g.lineStyle({ width: w || lw, color: col, alpha: a == null ? 0.7 : a, cap: PIXI.LINE_CAP.ROUND }); for (let i = 0; i < pts.length; i += 4) g.moveTo(pts[i], pts[i + 1]).lineTo(pts[i + 2], pts[i + 3]); };
  const blanket = [0x8a3030, 0x30508a, 0x4f6b30, 0x6b4f30, 0x7a6a4a, 0x5a3a6a][Math.floor(R() * 6)];
  switch (f.k) {
    case 'column': shadowCirc(0, 0, c * 0.34, 1.6); circ(0, 0, c * 0.34, MARB); circ(0, 0, c * 0.25, MARB, { tint: 0xfaf6f0, edgeA: 0.4 }); none(); g.beginFill(0xffffff, 0.25).drawCircle(-c * 0.08, -c * 0.08, c * 0.1).endFill(); break;
    case 'pillar': shadowRect(-c * 0.32, -c * 0.32, c * 0.64, c * 0.64, 1.6); rect(-c * 0.32, -c * 0.32, c * 0.64, c * 0.64, STONE); rect(-c * 0.24, -c * 0.24, c * 0.48, c * 0.48, STONE, { tint: 0xd0cac0, edgeA: 0.4 }); break;
    case 'stairsdown': case 'stairsup': {
      const n = Math.round(f.h * 4), x0 = -W * 0.45, y0 = -H * 0.48, ww = W * 0.9, hh = H * 0.96;
      for (let i = 0; i < n; i++) {
        const k = f.k === 'stairsdown' ? i / n : 1 - i / n;
        none(); texFill(g, STONE, c, { tint: Math.round(0xd0 - k * 0x90) * 0x10101 }); g.drawRect(x0, y0 + hh * i / n, ww, hh / n); g.endFill();
        g.lineStyle({ width: lw, color: RIM, alpha: 0.6 }).moveTo(x0, y0 + hh * (i + 1) / n).lineTo(x0 + ww, y0 + hh * (i + 1) / n);
      }
      edge(); g.drawRect(x0, y0, ww, hh);
      break;
    }
    case 'statue': shadowCirc(0, 0, c * 0.4, 2); circ(0, 0, c * 0.4, STONE); circ(0, c * 0.04, c * 0.24, MARB, { tint: 0xc8c4bc }); circ(0, -c * 0.12, c * 0.11, MARB, { tint: 0xd8d4cc }); none(); g.beginFill(0xffffff, 0.2).drawCircle(-c * 0.04, -c * 0.16, c * 0.04).endFill(); break;
    case 'altar': shadowRect(-W * 0.44, -H * 0.32, W * 0.88, H * 0.64, 1.3); rect(-W * 0.44, -H * 0.32, W * 0.88, H * 0.64, MARB); rect(-W * 0.12, -H * 0.32, W * 0.24, H * 0.64, CLOTH(0x9a2a24), { edgeA: 0.5 });
      for (const x of [-0.32, 0.32]) { none(); g.beginFill(0xf0e8d0).drawCircle(x * W, 0, c * 0.05).endFill(); g.beginFill(0xffc860, 0.9).drawCircle(x * W, 0, c * 0.025).endFill(); } break;
    case 'fountain': { const r = Math.min(W, H) * 0.46; shadowCirc(0, 0, r, 1.2); circ(0, 0, r, STONE); none(); texFill(g, ['ice', 2, 0x6fa8ac], c); g.drawCircle(0, 0, r * 0.78); g.endFill(); g.beginFill(0x24525a, 0.35).drawCircle(0, 0, r * 0.78).endFill(); circ(0, 0, r * 0.22, STONE); g.lineStyle({ width: lw, color: 0xe6f6f2, alpha: 0.6 }).drawCircle(0, 0, r * 0.4); break; }
    case 'well': shadowCirc(0, 0, c * 0.4, 1.5); circ(0, 0, c * 0.4, STONE); circ(0, 0, c * 0.26, flat(0x0e1a1c)); rect(-c * 0.45, -c * 0.05, c * 0.9, c * 0.1, DARKWOOD); break;
    case 'sarcophagus': shadowRect(-W * 0.38, -H * 0.46, W * 0.76, H * 0.92, 1.4); rect(-W * 0.38, -H * 0.46, W * 0.76, H * 0.92, STONE); rect(-W * 0.28, -H * 0.36, W * 0.56, H * 0.72, MARB, { tint: 0xc8c2b8, edgeA: 0.5 });
      lines([0, -H * 0.26, 0, H * 0.22, -W * 0.14, -H * 0.12, W * 0.14, -H * 0.12], RIM, 0.55); break;
    case 'coffin': { const pts = [-W * 0.2, -H * 0.46, W * 0.2, -H * 0.46, W * 0.34, -H * 0.2, W * 0.22, H * 0.46, -W * 0.22, H * 0.46, -W * 0.34, -H * 0.2];
      shadowRect(-W * 0.32, -H * 0.46, W * 0.64, H * 0.92); edge(); texFill(g, DARKWOOD, c, { rot: Math.PI / 2 }); g.drawPolygon(pts); g.endFill(); lines([0, -H * 0.3, 0, H * 0.25, -W * 0.12, -H * 0.15, W * 0.12, -H * 0.15], 0xc9a45c, 0.7); break; }
    case 'rubble': for (let i = 0; i < 7; i++) { const x = (R() - 0.5) * c * 0.75, y = (R() - 0.5) * c * 0.75, r = c * (0.06 + R() * 0.1), pts = []; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + R(); pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } shadowCirc(x, y, r * 0.9, 0.5); edge(0.7); texFill(g, ROCKL, c, { tint: 0x8a857c + Math.floor(R() * 3) * 0x080808 }); g.drawPolygon(pts); g.endFill(); } break;
    case 'trapdoor': rect(-c * 0.38, -c * 0.38, c * 0.76, c * 0.76, PLANK, { rot: Math.PI / 2 }); lines([-c * 0.38, -c * 0.12, c * 0.38, -c * 0.12, -c * 0.38, c * 0.14, c * 0.38, c * 0.14], RIM, 0.5); g.lineStyle({ width: lw * 1.5, color: 0x3a3836 }).drawCircle(0, c * 0.26, c * 0.06); break;
    case 'pit': circ(0, 0, c * 0.42, flat(0x2a2622)); circ(0, 0, c * 0.32, flat(0x141210), { edgeA: 0 }); circ(0, 0, c * 0.2, flat(0x050505), { edgeA: 0 }); break;
    case 'brazier': shadowCirc(0, 0, c * 0.28); circ(0, 0, c * 0.28, METAL); none(); g.beginFill(0x2a1a10).drawCircle(0, 0, c * 0.2).endFill(); for (let i = 0; i < 6; i++) g.beginFill([0xff7a20, 0xffb040, 0xffe080][i % 3], 0.9).drawCircle((R() - 0.5) * c * 0.22, (R() - 0.5) * c * 0.22, c * (0.04 + R() * 0.04)).endFill(); break;
    case 'throne': shadowRect(-c * 0.36, -c * 0.44, c * 0.72, c * 0.86, 1.4); rect(-c * 0.36, -c * 0.44, c * 0.72, c * 0.2, DARKWOOD); rect(-c * 0.3, -c * 0.26, c * 0.6, c * 0.62, DARKWOOD); rect(-c * 0.22, -c * 0.18, c * 0.44, c * 0.44, CLOTH(0x8a1e24), { edgeA: 0.5 }); none(); g.beginFill(0xd8b050).drawCircle(-c * 0.3, -c * 0.34, c * 0.05).drawCircle(c * 0.3, -c * 0.34, c * 0.05).endFill(); break;
    case 'stalagmite': { const pts = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = c * (0.2 + R() * 0.12); pts.push(Math.cos(a) * r, Math.sin(a) * r); } shadowCirc(0, 0, c * 0.26, 2); edge(); texFill(g, ROCKL, c); g.drawPolygon(pts); g.endFill(); circ(0, 0, c * 0.12, ROCKL, { tint: 0xc0bab0, edgeA: 0.4 }); circ(0, 0, c * 0.04, ROCKL, { tint: 0xe0dad0, edgeA: 0 }); break; }
    case 'table': shadowRect(-W * 0.45, -H * 0.38, W * 0.9, H * 0.76); rect(-W * 0.45, -H * 0.38, W * 0.9, H * 0.76, WOOD); hi(-W * 0.45, -H * 0.38, W * 0.9, H * 0.06);
      if (R() < 0.6) { none(); g.beginFill(0xe8e0d0).drawCircle(-W * 0.2, 0, c * 0.08).drawCircle(W * 0.2, -H * 0.05, c * 0.08).endFill(); g.beginFill(0x8a6a3a).drawCircle(W * 0.02, H * 0.1, c * 0.05).endFill(); } break;
    case 'roundtable': { const r = Math.min(W, H) * 0.42; shadowCirc(0, 0, r); circ(0, 0, r, WOOD); none(); g.beginFill(0xffffff, 0.1).drawCircle(-r * 0.25, -r * 0.25, r * 0.5).endFill();
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; g.beginFill(0xe8e0d0).drawCircle(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, c * 0.07).endFill(); } break; }
    case 'chair': shadowRect(-c * 0.22, -c * 0.28, c * 0.44, c * 0.52, 0.8); rect(-c * 0.22, -c * 0.16, c * 0.44, c * 0.4, WOOD); rect(-c * 0.24, -c * 0.3, c * 0.48, c * 0.12, DARKWOOD); break;
    case 'bench': shadowRect(-W * 0.46, -H * 0.18, W * 0.92, H * 0.36, 0.8); rect(-W * 0.46, -H * 0.18, W * 0.92, H * 0.36, WOOD); break;
    case 'bed': case 'bunk': shadowRect(-W * 0.42, -H * 0.47, W * 0.84, H * 0.94); rect(-W * 0.42, -H * 0.47, W * 0.84, H * 0.94, DARKWOOD); rect(-W * 0.36, -H * 0.12, W * 0.72, H * 0.54, CLOTH(blanket), { edgeA: 0.6 });
      rrect(-W * 0.3, -H * 0.4, W * 0.6, H * 0.18, c * 0.06, flat(0xeee6d6)); hi(-W * 0.36, -H * 0.12, W * 0.72, H * 0.05, 0.15);
      if (f.k === 'bunk') lines([-W * 0.42, -H * 0.47, -W * 0.42, H * 0.47, W * 0.42, -H * 0.47, W * 0.42, H * 0.47], 0x2a1a10, 0.9, lw * 2); break;
    case 'bookshelf': case 'shelf': {
      const hh = f.k === 'shelf' ? 0.3 : 0.42;
      shadowRect(-W * 0.48, -H * 0.5, W * 0.96, H * hh, 0.7); rect(-W * 0.48, -H * 0.5, W * 0.96, H * hh, DARKWOOD);
      const pal = [0x7a2b22, 0x2c4a6b, 0x3d5a2a, 0x6b5a2a, 0x4a2a5a, 0x8a6a3a, 0x5a3020];
      none();
      if (f.k === 'bookshelf') for (let x = -W * 0.45; x < W * 0.44;) { const bw = c * (0.05 + R() * 0.05); g.beginFill(pal[Math.floor(R() * pal.length)]).drawRect(x, -H * 0.47, bw - 1, H * (hh - 0.07) * (0.7 + R() * 0.3)).endFill(); x += bw; }
      else for (let i = 0; i < 4; i++) { const x = -W * 0.4 + R() * W * 0.8; g.beginFill([0xd8d0c0, 0x8a6a3a, 0x5a7a8a][i % 3]).drawCircle(x, -H * 0.36, c * 0.06).endFill(); }
      break;
    }
    case 'counter': shadowRect(-W * 0.48, -H * 0.32, W * 0.96, H * 0.52); rect(-W * 0.48, -H * 0.32, W * 0.96, H * 0.52, DARKWOOD); hi(-W * 0.48, -H * 0.32, W * 0.96, H * 0.08, 0.14);
      none(); for (let i = 0; i < 3; i++) g.beginFill(0x8a6a3a).drawCircle(-W * 0.3 + i * W * 0.3, -H * 0.06, c * 0.07).endFill(); break;
    case 'fireplace': shadowRect(-W * 0.46, -H * 0.5, W * 0.92, H * 0.58, 0.6); rect(-W * 0.46, -H * 0.5, W * 0.92, H * 0.58, STONE); rect(-W * 0.3, -H * 0.42, W * 0.6, H * 0.4, flat(0x1a1210));
      none(); for (const [col, r] of [[0xff6a10, 0.16], [0xffa030, 0.11], [0xffe080, 0.06]]) g.beginFill(col, 0.9).drawEllipse(0, -H * 0.22, W * r, H * r * 1.2).endFill(); break;
    case 'rug': { none(); texFill(g, CLOTH(blanket), c); g.drawRect(-W * 0.44, -H * 0.44, W * 0.88, H * 0.88); g.endFill();
      g.lineStyle({ width: lw * 1.5, color: 0xd8b060, alpha: 0.7 }).drawRect(-W * 0.38, -H * 0.38, W * 0.76, H * 0.76); g.lineStyle({ width: lw, color: 0xd8b060, alpha: 0.5 }).drawRect(-W * 0.3, -H * 0.3, W * 0.6, H * 0.6);
      lines(Array.from({ length: 12 }, (_, i) => { const x = -W * 0.44 + (i + 0.5) * W * 0.88 / 12; return [x, -H * 0.44, x, -H * 0.5]; }).flat().concat(Array.from({ length: 12 }, (_, i) => { const x = -W * 0.44 + (i + 0.5) * W * 0.88 / 12; return [x, H * 0.44, x, H * 0.5]; }).flat()), 0xd8c8a0, 0.7, lw * 0.8); break; }
    case 'chest': shadowRect(-c * 0.32, -c * 0.22, c * 0.64, c * 0.44); rect(-c * 0.32, -c * 0.22, c * 0.64, c * 0.44, DARKWOOD, { rot: Math.PI / 2 });
      none(); g.beginFill(0x3a3634).drawRect(-c * 0.22, -c * 0.22, c * 0.05, c * 0.44).drawRect(c * 0.17, -c * 0.22, c * 0.05, c * 0.44).endFill(); g.beginFill(0xc9a45c).drawRect(-c * 0.04, c * 0.12, c * 0.08, c * 0.08).endFill(); break;
    case 'barrel': shadowCirc(0, 0, c * 0.3); circ(0, 0, c * 0.3, WOOD, { rot: R() * 3 }); g.lineStyle({ width: lw * 1.4, color: 0x2e2a28 }).drawCircle(0, 0, c * 0.3); g.lineStyle({ width: lw, color: 0x2e2a28, alpha: 0.8 }).drawCircle(0, 0, c * 0.2);
      lines([-c * 0.18, -c * 0.06, c * 0.18, -c * 0.06, -c * 0.2, c * 0.06, c * 0.2, c * 0.06], RIM, 0.35); break;
    case 'crate': shadowRect(-c * 0.32, -c * 0.32, c * 0.64, c * 0.64); rect(-c * 0.32, -c * 0.32, c * 0.64, c * 0.64, PLANK);
      lines([-c * 0.32, -c * 0.11, c * 0.32, -c * 0.11, -c * 0.32, c * 0.11, c * 0.32, c * 0.11], RIM, 0.45); lines([-c * 0.28, -c * 0.28, c * 0.28, c * 0.28], 0x5a3a20, 0.8, lw * 2.4); break;
    case 'wardrobe': shadowRect(-W * 0.47, -H * 0.5, W * 0.94, H * 0.54); rect(-W * 0.47, -H * 0.5, W * 0.94, H * 0.54, DARKWOOD); lines([0, -H * 0.5, 0, H * 0.04], RIM, 0.6); none(); g.beginFill(0xc9a45c).drawCircle(-c * 0.06, -H * 0.2, c * 0.03).drawCircle(c * 0.06, -H * 0.2, c * 0.03).endFill(); break;
    case 'desk': shadowRect(-W * 0.45, -H * 0.42, W * 0.9, H * 0.52); rect(-W * 0.45, -H * 0.42, W * 0.9, H * 0.52, WOOD);
      none(); g.beginFill(0xf0e8d6).drawRect(-W * 0.3, -H * 0.32, c * 0.26, c * 0.18).drawRect(-W * 0.18, -H * 0.28, c * 0.22, c * 0.16).endFill(); g.beginFill(0x1a1a24).drawCircle(W * 0.25, -H * 0.24, c * 0.04).endFill();
      rect(-c * 0.18, H * 0.16, c * 0.36, c * 0.28, WOOD); break;
    case 'anvil': { const pts = [-c * 0.34, -c * 0.13, c * 0.22, -c * 0.13, c * 0.36, 0, c * 0.22, c * 0.13, -c * 0.34, c * 0.13, -c * 0.22, 0]; shadowRect(-c * 0.3, -c * 0.13, c * 0.6, c * 0.26); edge(); g.beginFill(0x55524e).drawPolygon(pts).endFill(); hi(-c * 0.3, -c * 0.12, c * 0.5, c * 0.05, 0.2); break; }
    case 'cauldron': shadowCirc(0, 0, c * 0.34); circ(0, 0, c * 0.34, flat(0x1e1c1a)); circ(0, 0, c * 0.25, flat(0x5a8a3a), { edgeA: 0.4 }); none(); g.beginFill(0xa8e070, 0.6).drawCircle(-c * 0.06, -c * 0.05, c * 0.06).drawCircle(c * 0.08, c * 0.06, c * 0.04).endFill(); break;
    case 'plant': shadowCirc(0, 0, c * 0.3); circ(0, 0, c * 0.2, flat(0xa0583a)); none(); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + R() * 0.3; g.beginFill([0x3a6a2a, 0x4a7a32, 0x2e5a22][k % 3]).drawEllipse(Math.cos(a) * c * 0.18, Math.sin(a) * c * 0.18, c * 0.12, c * 0.07).endFill(); } break;
    case 'cage': shadowRect(-c * 0.4, -c * 0.4, c * 0.8, c * 0.8, 0.6); none(); g.beginFill(0x000000, 0.25).drawRect(-c * 0.4, -c * 0.4, c * 0.8, c * 0.8).endFill();
      g.lineStyle({ width: lw * 1.6, color: 0x3a3836 }).drawRect(-c * 0.4, -c * 0.4, c * 0.8, c * 0.8); for (let x = -c * 0.27; x < c * 0.4; x += c * 0.135) g.moveTo(x, -c * 0.4).lineTo(x, c * 0.4); break;
    case 'weaponrack': shadowRect(-W * 0.47, -H * 0.5, W * 0.94, H * 0.22, 0.6); rect(-W * 0.47, -H * 0.5, W * 0.94, H * 0.22, DARKWOOD);
      for (let x = -W * 0.36; x < W * 0.4; x += c * 0.24) { lines([x, -H * 0.3, x + c * 0.06, H * 0.12], 0x9a9894, 1, lw * 2.2); lines([x, -H * 0.3, x + c * 0.015, -H * 0.18], 0x5a3a20, 1, lw * 3); } break;
    case 'torch': rect(-c * 0.07, -c * 0.5, c * 0.14, c * 0.2, METAL); none(); for (const [col, r, a] of [[0xff8a20, 0.3, 0.18], [0xff9a30, 0.14, 0.7], [0xffe080, 0.07, 0.95]]) g.beginFill(col, a).drawCircle(0, -c * 0.28, c * r).endFill(); break;
    case 'lamp': none(); for (const [col, r, a] of [[0xffc060, 0.32, 0.14], [0xffd080, 0.17, 0.35]]) g.beginFill(col, a).drawCircle(0, -c * 0.3, c * r).endFill();
      rect(-c * 0.04, -c * 0.5, c * 0.08, c * 0.1, METAL); rect(-c * 0.11, -c * 0.41, c * 0.22, c * 0.22, flat(0x2e2c2a)); none(); g.beginFill(0xffe6a0).drawRect(-c * 0.07, -c * 0.37, c * 0.14, c * 0.14).endFill();
      g.beginFill(0x2e2c2a).drawRect(-c * 0.012, -c * 0.37, c * 0.024, c * 0.14).drawRect(-c * 0.07, -c * 0.312, c * 0.14, c * 0.024).endFill(); break;
    case 'candles': none(); for (const [x, y] of [[-0.15, -0.1], [0.12, -0.15], [0.02, 0.14], [0.2, 0.1]]) { g.beginFill(0xffb040, 0.2).drawCircle(x * c, y * c, c * 0.1).endFill(); g.beginFill(0xf0e8d0).drawCircle(x * c, y * c, c * 0.045).endFill(); g.beginFill(0xffd060).drawCircle(x * c, y * c, c * 0.02).endFill(); } break;
    case 'bones': for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * c * 0.6, y = (R() - 0.5) * c * 0.6, a = R() * Math.PI, l = c * 0.14; lines([x - Math.cos(a) * l, y - Math.sin(a) * l, x + Math.cos(a) * l, y + Math.sin(a) * l], 0xe8e0cc, 1, lw * 2); }
      none(); g.beginFill(0xe8e0cc).drawCircle((R() - 0.5) * c * 0.3, (R() - 0.5) * c * 0.3, c * 0.09).endFill(); break;
    case 'cobweb': { g.lineStyle({ width: Math.max(1, c * 0.01), color: 0xffffff, alpha: 0.55 }); for (let a = 0; a <= 5; a++) { const t = a / 5 * Math.PI / 2; g.moveTo(-c * 0.5, -c * 0.5).lineTo(-c * 0.5 + Math.cos(t) * c * 0.85, -c * 0.5 + Math.sin(t) * c * 0.85); }
      for (const r of [0.22, 0.4, 0.58, 0.74]) { g.moveTo(-c * 0.5 + r * c, -c * 0.5); g.arc(-c * 0.5, -c * 0.5, c * r, 0, Math.PI / 2); } break; }
    case 'sack': for (const [x, y, r] of [[-0.12, 0, 0.2], [0.15, 0.08, 0.17], [0.02, -0.18, 0.14]]) { shadowCirc(x * c, y * c, r * c, 0.6); circ(x * c, y * c, r * c, CLOTH(0xb09a70)); none(); g.beginFill(0x5a4a30).drawCircle(x * c, (y - r * 0.6) * c, c * 0.025).endFill(); } break;
    case 'blood': none(); g.beginFill(0x5a0a0a, 0.65).drawEllipse(0, 0, c * 0.3, c * 0.2).endFill(); g.beginFill(0x5a0a0a, 0.6).drawCircle(c * 0.3, c * 0.2, c * 0.06).drawCircle(-c * 0.28, -c * 0.16, c * 0.04).drawCircle(c * 0.1, -c * 0.26, c * 0.03).endFill(); break;
    case 'banner': rect(-c * 0.36, -c * 0.5, c * 0.72, c * 0.08, METAL); rect(-c * 0.28, -c * 0.44, c * 0.56, c * 0.34, CLOTH([0x8a1e24, 0x1e3a6a, 0x2a5a2a][Math.floor(R() * 3)])); none(); g.beginFill(0xd8b050).drawCircle(0, -c * 0.28, c * 0.07).endFill(); break;
    case 'boulder': { const pts = []; for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, r = c * (0.32 + R() * 0.1); pts.push(Math.cos(a) * r, Math.sin(a) * r); } shadowCirc(0, 0, c * 0.4, 1.5); edge(); texFill(g, ROCKL, c); g.drawPolygon(pts); g.endFill(); none(); g.beginFill(0xffffff, 0.12).drawCircle(-c * 0.1, -c * 0.1, c * 0.15).endFill(); break; }
    case 'tree': case 'bush': {
      // a canopy seen from above: a ragged mass of leaf, lobes catching the light from the top left, dark beneath
      const big = f.k === 'tree', r = big ? Math.min(W, H) * 0.47 : c * 0.36, conifer = big && R() < 0.3;
      const base = conifer ? [0x24402c, 0x2f5236, 0x4a7350] : [[0x2d4a22, 0x3f6a2c, 0x7aa34e], [0x34501f, 0x4d7429, 0x8fb04a], [0x3a4a1e, 0x5a6a2a, 0x9aa850]][Math.floor(R() * 3)];
      const leaf = (tint, sq) => ['grass', sq || 0.55, tint];
      shadowCirc(r * 0.12, r * 0.12, r * 0.98, big ? 2.6 : 1.2);
      if (conifer) {   // a pine: layered rings of needled branches, darker at the edge
        for (const [rr, col, n] of [[1, base[0], 11], [0.74, base[1], 9], [0.46, base[2], 7]]) {
          const pts = []; const ph = R() * 6;
          for (let k = 0; k < n * 2; k++) { const a = ph + k / (n * 2) * Math.PI * 2, rad = r * rr * (k % 2 ? 0.62 : 1); pts.push(Math.cos(a) * rad, Math.sin(a) * rad); }
          g.lineStyle({ width: lw * 0.8, color: 0x0e1a10, alpha: 0.5 }); texFill(g, leaf(col, 0.4), c); g.drawPolygon(pts); g.endFill();
        }
        none(); g.beginFill(0x5a3a22).drawCircle(0, 0, r * 0.08).endFill();
        break;
      }
      // the mass: a ragged outline
      const pts = [], n = big ? 18 : 10, ph = R() * 6;
      for (let k = 0; k < n; k++) { const a = ph + k / n * Math.PI * 2, rad = r * (0.8 + R() * 0.2); pts.push(Math.cos(a) * rad, Math.sin(a) * rad); }
      g.lineStyle({ width: lw * 1.2, color: 0x0f180a, alpha: 0.55, join: PIXI.LINE_JOIN.ROUND }); texFill(g, leaf(base[0]), c); g.drawPolygon(pts); g.endFill();
      // lobes: each a dark under-side and a lit top
      const lobes = big ? 9 : 5;
      for (let k = 0; k < lobes; k++) {
        const a = ph + k / lobes * Math.PI * 2 + R() * 0.4, d = r * (0.38 + R() * 0.18), lr = r * (0.34 + R() * 0.12), x = Math.cos(a) * d, y = Math.sin(a) * d;
        none(); g.beginFill(0x0c1408, 0.28).drawCircle(x + lr * 0.12, y + lr * 0.16, lr).endFill();
        texFill(g, leaf(base[1]), c, { tx: k * 37, ty: k * 53 }); g.drawCircle(x, y, lr * 0.92); g.endFill();
        g.beginFill(base[2], 0.38).drawCircle(x - lr * 0.28, y - lr * 0.3, lr * 0.45).endFill();
      }
      texFill(g, leaf(base[1]), c, { tx: 91 }); g.drawCircle(-r * 0.05, -r * 0.05, r * 0.42); g.endFill();
      g.beginFill(base[2], 0.42).drawCircle(-r * 0.16, -r * 0.18, r * 0.2).endFill();
      for (let k = 0; k < (big ? 10 : 4); k++) g.beginFill(base[2], 0.35).drawCircle((R() - 0.62) * r * 1.1, (R() - 0.62) * r * 1.1, r * (0.04 + R() * 0.05)).endFill();   // leaves in the sun
      break;
    }
    case 'log': shadowRect(-W * 0.46, -H * 0.22, W * 0.92, H * 0.44); rect(-W * 0.46, -H * 0.22, W * 0.92, H * 0.44, ['wood', 1.2, 0x8a6a4a]); circ(W * 0.46, 0, H * 0.22, flat(0xc8a070)); g.lineStyle({ width: lw * 0.6, color: 0x6a4a2a, alpha: 0.7 }).drawCircle(W * 0.46, 0, H * 0.12); break;
    case 'tent': { const pts = [-W * 0.46, H * 0.46, -W * 0.46, -H * 0.2, 0, -H * 0.46, W * 0.46, -H * 0.2, W * 0.46, H * 0.46]; shadowRect(-W * 0.46, -H * 0.46, W * 0.92, H * 0.92, 1.4); edge(); texFill(g, CLOTH(0xc8b890), c); g.drawPolygon(pts); g.endFill(); lines([0, -H * 0.46, 0, H * 0.46], RIM, 0.6); none(); g.beginFill(0x000000, 0.12).drawPolygon([0, -H * 0.46, W * 0.46, -H * 0.2, W * 0.46, H * 0.46, 0, H * 0.46]).endFill(); break; }
    case 'campfire': for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; circ(Math.cos(a) * c * 0.28, Math.sin(a) * c * 0.28, c * 0.075, ROCKL); } lines([-c * 0.18, -c * 0.1, c * 0.18, c * 0.1, -c * 0.18, c * 0.1, c * 0.18, -c * 0.1], 0x4a2a18, 1, lw * 3);
      none(); for (const [col, r, a] of [[0xff6a10, 0.2, 0.8], [0xffa030, 0.13, 0.9], [0xffe080, 0.06, 1]]) g.beginFill(col, a).drawCircle(0, 0, c * r).endFill(); break;
    case 'cart': shadowRect(-W * 0.42, -H * 0.4, W * 0.84, H * 0.78, 1.4); rect(-W * 0.4, -H * 0.38, W * 0.8, H * 0.76, PLANK); rect(-W * 0.48, -H * 0.18, W * 0.08, H * 0.28, flat(0x2e2a26)); rect(W * 0.4, -H * 0.18, W * 0.08, H * 0.28, flat(0x2e2a26));
      lines([-W * 0.1, -H * 0.38, -W * 0.1, -H * 0.5, W * 0.1, -H * 0.38, W * 0.1, -H * 0.5], 0x5a3a20, 1, lw * 2.5); none(); g.beginFill(0xd8c070, 0.9).drawEllipse(0, H * 0.05, W * 0.25, H * 0.2).endFill(); break;
    case 'haybale': shadowRect(-c * 0.36, -c * 0.3, c * 0.72, c * 0.6); rect(-c * 0.36, -c * 0.3, c * 0.72, c * 0.6, ['thatch', 1, 0xf0d890]); lines([-c * 0.12, -c * 0.3, -c * 0.12, c * 0.3, c * 0.12, -c * 0.3, c * 0.12, c * 0.3], 0x6a5020, 0.8, lw * 1.5); break;
    default: rect(-W * 0.4, -H * 0.4, W * 0.8, H * 0.8, STONE);
  }
  return g;
}

})();
