/* The room planner (P, GM) and the dungeon generator: a scene's map drawn as squares, in ink on parchment.
 * The plan itself (table/shared/plan.js) lives in the scene; the server makes the walls and doors from it, so sight,
 * light and doors work at once. Here: drawing it (V.planTexture, used as the scene's map), the tool, and the generator. */
'use strict';
(function () {
const { $, h, state, on } = V;
const hex = c => parseInt(String(c || '#000000').slice(1), 16);

// ───────────────────────── the tool ─────────────────────────
const MODES = [['room', 'Room', 'Drag out a room in the floor picked (Shift: knock one out)'], ['floor', 'Paint', 'Paint floor square by square: flagstones, planks, grass, water, lava…'],
  ['fill', 'Bucket', 'Click a floor to change all of it that joins up (a whole room) to the floor picked'], ['erase', 'Rock', 'Paint rock: take floor away'],
  ['door', 'Door', 'Click an edge for a door; click it again to take it away'], ['furnish', 'Furnish', 'Click to place; drag to move; R turns; Delete removes']];
const DOOR_KINDS = [['door', 'Door'], ['locked', 'Locked door'], ['secret', 'Secret door'], ['arch', 'Archway'], ['bars', 'Portcullis'], ['wall', 'Inner wall']];
let mode = 'room', doorKind = 'door', featKind = 'table', featRot = 0, brush = 1, paintMat = Plan.FLOOR;
let work = null, workKey = '', drag = null, selFeat = -1, renderT = 0, pending = 0;
const scenePlan = () => state.scene && state.scene.meta.plan;
let workBase = null;   // the scene's plan our edits are made from: sent with each, so the server can merge someone else's changes in
function ensureWork() {
  const p = scenePlan(); if (!p) { work = null; workKey = ''; return null; }
  const k = JSON.stringify(p);
  // the scene's plan wins only when it's changed by something else (an undo, another GM), not while ours is on its way
  if (!work || (k !== workKey && !drag && !mDrag && !pending)) { work = Plan.unpack(p); workKey = k; workBase = p; }
  return work;
}
on('sceneMeta', () => { if (!drag) ensureWork(); if (state.tool === 'plan') V.renderSubtools(); });
on('scene', () => { work = null; selFeat = -1; if (state.tool === 'plan') V.renderSubtools(); else drawPalette(); });
// redraw now (fast while dragging), save a moment after the last change
function changed(final) {
  const packed = Plan.pack(work);
  // draw it straight away here (the server's echo then finds it drawn)
  const L = V.stage.L, g = V.grid();
  cancelAnimationFrame(renderT);
  renderT = requestAnimationFrame(() => {
    const tex = V.planTexture(packed, g, { fast: !final });
    if (tex) { L.map.texture = tex; const s = V.sceneSize(); L.map.width = s.w; L.map.height = s.h; }
    if (V.drawGMOverlay) V.drawGMOverlay(packed);
  });
  if (final) {
    workKey = JSON.stringify(packed); pending++;
    const sid = state.scene.id, base = workBase;
    workBase = packed;
    V.op({ t: 'scene.update', id: sid, patch: { plan: packed }, base: base || undefined }).then(() => { pending--; if (V.planThumbSoon) V.planThumbSoon(sid, packed); }, () => { pending--; work = null; ensureWork(); });
  }
}
const cellAt = p => { const g = V.grid(); return [Math.floor((p.x - (g.ox || 0)) / g.size), Math.floor((p.y - (g.oy || 0)) / g.size)]; };
const inside = (x, y) => work && x >= 0 && y >= 0 && x < work.cols && y < work.rows;
function paint(x, y, v) {
  let any = false;
  for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) {
    const xx = x + dx - Math.floor(brush / 2), yy = y + dy - Math.floor(brush / 2);
    if (!inside(xx, yy)) continue;
    const i = yy * work.cols + xx; if (work.grid[i] !== v) { work.grid[i] = v; any = true; }
  }
  return any;
}
// the edge nearest a point: { x, y, s } (a north or west edge)
function edgeAt(p) {
  const g = V.grid(), fx = (p.x - (g.ox || 0)) / g.size, fy = (p.y - (g.oy || 0)) / g.size;
  const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
  const opts = [[v, { x, y, s: 'n' }], [1 - v, { x, y: y + 1, s: 'n' }], [u, { x, y, s: 'w' }], [1 - u, { x: x + 1, y, s: 'w' }]];
  opts.sort((a, b) => a[0] - b[0]);
  return opts[0][1];
}
function featAt(x, y) {
  for (let i = work.feats.length - 1; i >= 0; i--) { const f = work.feats[i], fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h; if (x >= f.x && y >= f.y && x < f.x + fw && y < f.y + fh) return i; }
  return -1;
}
function preview() {
  const L = V.stage.L, g = V.grid(), c = g.size, ox = g.ox || 0, oy = g.oy || 0;
  L.draw.clear();
  if (!work) return;
  L.draw.lineStyle({ width: Math.max(2, 2 / V.stage.scale()), color: 0xc9a45c, alpha: 0.9 });
  L.draw.drawRect(ox, oy, work.cols * c, work.rows * c);   // the plan's edge
  if (drag && drag.kind === 'room') {
    const [x0, y0, x1, y1] = [Math.min(drag.a[0], drag.b[0]), Math.min(drag.a[1], drag.b[1]), Math.max(drag.a[0], drag.b[0]), Math.max(drag.a[1], drag.b[1])];
    L.draw.beginFill(drag.erase ? 0x9b4a3a : 0xc9a45c, 0.18).drawRect(ox + x0 * c, oy + y0 * c, (x1 - x0 + 1) * c, (y1 - y0 + 1) * c).endFill();
    V.stage.hud && V.hud(`${x1 - x0 + 1} × ${y1 - y0 + 1} squares`);
  }
  if (mode === 'furnish' && selFeat >= 0 && work.feats[selFeat]) {
    const f = work.feats[selFeat], fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h;
    L.draw.lineStyle({ width: Math.max(2, 2 / V.stage.scale()), color: 0xc9a45c }).drawRect(ox + f.x * c, oy + f.y * c, fw * c, fh * c);
  }
}
V.toolHandlers.plan = {
  down(p, e) {
    if (!ensureWork()) return false;
    const [x, y] = cellAt(p);
    if (mode === 'room') { drag = { kind: 'room', a: [x, y], b: [x, y], erase: e.shiftKey }; preview(); return true; }
    if (mode === 'fill') { if (inside(x, y) && bucket(x, y, e.shiftKey ? Plan.ROCK : paintMat)) changed(true); return false; }
    if (mode === 'floor' || mode === 'erase') {
      drag = { kind: 'paint', v: mode === 'floor' ? paintMat : Plan.ROCK };
      if (e.shiftKey) drag.v = Plan.ROCK;
      if (paint(x, y, drag.v)) changed(false);
      return true;
    }
    if (mode === 'door') {
      const d = edgeAt(p); if (d.x < 0 || d.y < 0 || d.x > work.cols || d.y > work.rows) return false;
      const i = work.doors.findIndex(q => q.x === d.x && q.y === d.y && q.s === d.s);
      if (i >= 0 && work.doors[i].k === doorKind) work.doors.splice(i, 1);
      else if (i >= 0) work.doors[i].k = doorKind;
      else work.doors.push(Object.assign(d, { k: doorKind }));
      changed(true); return false;
    }
    if (mode === 'furnish') {
      if (!inside(x, y)) return false;
      const i = featAt(x, y);
      if (i >= 0) { selFeat = i; const f = work.feats[i]; drag = { kind: 'feat', i, dx: x - f.x, dy: y - f.y, moved: false }; preview(); return true; }
      if (featKind.startsWith('art:')) {   // a picture from the art library: placed as a prop on the map (a token), not drawn into the plan
        const a = (V.artLibraryList ? V.artLibraryList() : []).find(q => q.id === featKind.slice(4));
        if (a) { const g = V.grid(); V.placeArt(a, (g.ox || 0) + (x + 0.5) * g.size, (g.oy || 0) + (y + 0.5) * g.size); }
        return false;
      }
      const def = Plan.FEATS.find(f => f[0] === featKind);
      work.feats.push({ k: featKind, x, y, w: def[2], h: def[3], r: featRot });
      selFeat = work.feats.length - 1; changed(true); preview(); return false;
    }
    return false;
  },
  move(p, e, dragging) {
    if (!dragging || !drag || !work) return;
    const [x, y] = cellAt(p);
    if (drag.kind === 'room') { drag.b = [x, y]; preview(); }
    else if (drag.kind === 'paint') { if (paint(x, y, drag.v)) changed(false); }
    else if (drag.kind === 'feat') { const f = work.feats[drag.i]; const nx = Math.max(0, x - drag.dx), ny = Math.max(0, y - drag.dy); if (nx !== f.x || ny !== f.y) { f.x = nx; f.y = ny; drag.moved = true; changed(false); preview(); } }
  },
  up() {
    const d = drag; drag = null; if (!d || !work) return;
    if (d.kind === 'room') {
      const [x0, y0, x1, y1] = [Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])];
      for (let yy = Math.max(0, y0); yy <= Math.min(work.rows - 1, y1); yy++) for (let xx = Math.max(0, x0); xx <= Math.min(work.cols - 1, x1); xx++) work.grid[yy * work.cols + xx] = d.erase ? Plan.ROCK : paintMat;
      V.hud(); changed(true); preview(); return;
    }
    if (d.kind === 'paint' || (d.kind === 'feat' && d.moved)) changed(true);
    preview();
  },
  key(e) {
    if (!work || mode !== 'furnish') return false;
    if (e.key === 'r' || e.key === 'R') {
      if (selFeat >= 0 && work.feats[selFeat]) { work.feats[selFeat].r = (work.feats[selFeat].r + 1) % 4; changed(true); preview(); }
      else featRot = (featRot + 1) % 4;
      V.renderSubtools(); return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selFeat >= 0) { work.feats.splice(selFeat, 1); selFeat = -1; changed(true); preview(); return true; }
    if (e.key === 'Escape') { selFeat = -1; preview(); return true; }
    return false;
  },
  subtools(box) {
    const b = (label, on_, fn, title) => h('button', { class: on_ ? 'on' : null, onclick: fn, title }, label);
    if (!scenePlan()) {
      box.append(b('Start a plan here', false, startBlank, 'Draw this scene’s map yourself, square by square (any picture it has is put aside)'),
        b('Generate a map…', false, () => openGenerator(), 'A dungeon, a cave or a building (a tavern, a house, a shop…), made for you, to tweak'));
      return;
    }
    ensureWork();
    for (const [k, l, t] of MODES) box.append(b(l, mode === k, () => { mode = k; selFeat = -1; V.renderSubtools(); V.hud(); preview(); }, t));
    if (mode === 'floor' || mode === 'erase') {
      box.append(h('div', { class: 'sep' }), ...[1, 2, 3].map(n => b(n + '×' + n, brush === n, () => { brush = n; V.renderSubtools(); }, 'Brush size')));
    }
    if (mode === 'door') box.append(h('div', { class: 'sep' }), h('select', { onchange: e => { doorKind = e.target.value; }, title: 'What clicking an edge puts there' },
      ...DOOR_KINDS.map(([k, l]) => h('option', { value: k, selected: k === doorKind || null }, l))));
    if (mode === 'furnish') box.append(h('div', { class: 'sep' }), b('↻ ' + ['N', 'E', 'S', 'W'][selFeat >= 0 && work.feats[selFeat] ? work.feats[selFeat].r : featRot], false, () => V.toolHandlers.plan.key({ key: 'r' }), 'Turn it (R): which wall its back is against'));
    setTimeout(drawPalette, 0);
    box.append(h('div', { class: 'sep' }),
      b('Number rooms', false, numberRooms, 'Put a number in each room (rooms are split by doors and inner walls)'),
      b('Generate…', false, () => openGenerator(), 'Make a dungeon here, or in a new scene'),
      b('Plan…', false, planSettings, 'Size, look, export'),
      b('History…', false, planHistory, 'Every change to this map, who made it and when; put any version back'));
  },
  hud: () => !scenePlan() ? 'This scene has no plan yet: start one, or generate a dungeon' : (MODES.find(m => m[0] === mode) || [])[2] || ''
};
// the plan's history: each change in words, newest first; any can be put back (and that's a change in the list too)
async function planHistory() {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  let r; try { r = await V.send({ t: 'planHistory', scene: state.scene.id }); } catch (e) { return V.toast(e.message, true); }
  const when = at => new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const put = async e => {
    if (!confirm(`Put this map back as it was on ${when(e.at)}?`)) return;
    try { const v = await V.send({ t: 'planHistory', scene: state.scene.id, v: e.v }); await V.op({ t: 'scene.update', id: state.scene.id, patch: { plan: v.plan }, note: 'Put back the version of ' + when(e.at) }); work = null; ensureWork(); close(); V.toast('Put back'); }
    catch (err) { V.toast(err.message, true); }
  };
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(640px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'This map’s history'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db planhist' }, r.entries.length ? null : h('p', { class: 'muted' }, 'No changes kept yet: they’re listed here from now on.'),
      ...r.entries.map((e, i) => h('div', { class: 'ph-row' },
        h('span', { class: 'ph-when' }, when(e.at)), h('span', { class: 'ph-who' }, e.by || '—'), h('span', { class: 'ph-what' }, e.summary),
        i === 0 ? h('span', { class: 'ph-now' }, 'Now') : h('button', { class: 'btn sm', onclick: () => put(e) }, 'Put back')))),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Close'))));
  modal.hidden = false;
}
// rooms numbered: each stretch of floor between doors that's bigger than a corridor
function numberRooms() {
  if (!ensureWork()) return;
  const { list } = Plan.regions(work);
  const rooms = list.filter(cells => cells.length >= 6 && !isCorridor(cells)).sort((a, b) => (Math.min(...a.map(i => (i / work.cols) | 0)) - Math.min(...b.map(i => (i / work.cols) | 0))) || (Math.min(...a.map(i => i % work.cols)) - Math.min(...b.map(i => i % work.cols))));
  const covered = new Set(); for (const f of work.feats) { const fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h; for (let y = f.y; y < f.y + fh; y++) for (let x = f.x; x < f.x + fw; x++) covered.add(y * work.cols + x); }
  work.labels = rooms.map((cells, n) => {
    // the clear square nearest the room's middle
    const xs = cells.map(i => i % work.cols), ys = cells.map(i => (i / work.cols) | 0);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    const best = cells.slice().sort((a, b) => (covered.has(a) - covered.has(b)) || (Math.hypot(a % work.cols - mx, ((a / work.cols) | 0) - my) - Math.hypot(b % work.cols - mx, ((b / work.cols) | 0) - my)))[0];
    const was = (work.labels || []).find(l => l.x >= Math.min(...xs) && l.x <= Math.max(...xs) + 1 && l.y >= Math.min(...ys) && l.y <= Math.max(...ys) + 1 && cells.includes(Math.floor(l.y) * work.cols + Math.floor(l.x)));
    return Object.assign({ n: String(n + 1), x: best % work.cols + 0.5, y: ((best / work.cols) | 0) + 0.5 }, was && was.t ? { t: was.t } : null, was && was.note ? { note: was.note } : null);   // (a room keeps its name and notes)
  });
  changed(true);
  if (state.layer !== 'gm') V.toast(`${work.labels.length} rooms numbered: the numbers are on the GM layer (switch to it, bottom left, to see them and click one for its notes)`);
}
// ───── the palette on the left: floors as swatches, furniture as pictures ─────
let pal = null;
const SWATCH = { water: 'linear-gradient(135deg,#2c6670,#1d4a52)', lava: 'linear-gradient(135deg,#ff8a2a,#7a1c06)', chasm: 'radial-gradient(#000 40%,#3a3632)' };
const MAT_TEX = { flagstone: 'flagstone', cobble: 'cobble', planks: 'planks', oldplanks: 'oldplanks', dirt: 'dirt', grass: 'grass', cave: 'rock', gravel: 'gravel', marble: 'marble', tiles: 'tiles', sand: 'sand', snow: 'snow', carpet: 'cloth', mossy: 'mossycobble', earth: 'earth' };
function drawPalette() {
  const show = state.tool === 'plan' && !!work && ['room', 'floor', 'fill', 'furnish'].includes(mode);
  if (!pal && !show) return;
  if (!pal) { pal = h('div', { id: 'planpal' }); $('#app').append(pal); }
  pal.hidden = !show; document.body.classList.toggle('palopen', show);
  if (!show) return;
  const tile = (on_, title, pic, label, fn) => h('button', { class: 'pptile' + (on_ ? ' on' : ''), title, onclick: fn }, pic, h('span', null, label));
  if (mode === 'furnish') {
    const render = work.style.render, groups = {};
    for (const f of Plan.FEATS) (groups[f[4]] = groups[f[4]] || []).push(f);
    const art = V.artLibraryList ? V.artLibraryList() : [];
    if (!art.length && V.loadArtLibrary && !pal._artAsked) { pal._artAsked = true; V.loadArtLibrary().then(l => { if (l && l.length) drawPalette(); }); }
    pal.replaceChildren(h('div', { class: 'pph' }, h('b', null, 'Furnish'), h('span', { class: 'muted small' }, 'click a piece, then the map')),
      h('div', { class: 'ppbody' }, ...Object.entries(groups).map(([gname, list]) => h('div', null, h('div', { class: 'ppg' }, gname), h('div', { class: 'ppgrid' },
        ...list.map(f => tile(featKind === f[0], `${f[1]} (${f[2]}×${f[3]})`, h('img', { src: V.planFeatThumb ? V.planFeatThumb(f[0], render) : '', alt: '', draggable: 'false' }), f[1], () => { featKind = f[0]; selFeat = -1; preview(); drawPalette(); }))))),
        art.length ? h('div', null, h('div', { class: 'ppg' }, 'Your art (placed as props)'), h('div', { class: 'ppgrid' },
          ...art.map(a => tile(featKind === 'art:' + a.id, a.name, h('img', { src: a.url, alt: '', loading: 'lazy', draggable: 'false' }), a.name, () => { featKind = 'art:' + a.id; selFeat = -1; drawPalette(); })))) : null));
    return;
  }
  const st = work.style, def = (Plan.MATS.find(m => m[0] === st.floorMat) || [, 'Floor'])[1];
  const sw = m => { const t = MAT_TEX[m === 'floor' ? st.floorMat : m]; return h('i', { class: 'ppsw', style: SWATCH[m] ? `background:${SWATCH[m]}` : t ? `background-image:url(/table/data/plantex/${t}.jpg)` : '' }); };
  const mats = Plan.MATS.map((m, i) => [m, i]).filter(([m]) => m[3] !== 'solid');
  pal.replaceChildren(h('div', { class: 'pph' }, h('b', null, 'Floors'), h('span', { class: 'muted small' }, mode === 'fill' ? 'click a room to change it' : 'then paint or drag out a room')),
    h('div', { class: 'ppbody' },
      h('div', { class: 'ppg' }, 'Floors'), h('div', { class: 'ppgrid' }, ...mats.filter(([m]) => m[3] === 'floor').map(([m, i]) => tile(paintMat === i, m[1], sw(m[0]), i === Plan.FLOOR ? `The plan’s (${def})` : m[1], () => { paintMat = i; drawPalette(); }))),
      h('div', { class: 'ppg' }, 'Liquids and drops'), h('div', { class: 'ppgrid' }, ...mats.filter(([m]) => m[3] !== 'floor').map(([m, i]) => tile(paintMat === i, m[1], sw(m[0]), m[1], () => { paintMat = i; drawPalette(); }))),
      h('p', { class: 'muted small' }, 'Caves, earth, grass, sand and water get rounded edges; built floors keep square corners.')));
}
on('tool', () => drawPalette());
// the floor joined to (x, y) and like it, all to v (stops at doors and inner walls)
function bucket(x, y, v) {
  const from = work.grid[y * work.cols + x]; if (from === v) return false;
  const shut = new Set(work.doors.filter(d => d.k !== 'arch').map(d => d.x + ',' + d.y + d.s));
  const st = [[x, y]], seen = new Set([y * work.cols + x]);
  while (st.length) {
    const [cx, cy] = st.pop(); work.grid[cy * work.cols + cx] = v;
    for (const [dx, dy, key] of [[1, 0, (cx + 1) + ',' + cy + 'w'], [-1, 0, cx + ',' + cy + 'w'], [0, 1, cx + ',' + (cy + 1) + 'n'], [0, -1, cx + ',' + cy + 'n']]) {
      const nx = cx + dx, ny = cy + dy, k = ny * work.cols + nx;
      if (!inside(nx, ny) || seen.has(k) || work.grid[k] !== from || shut.has(key)) continue;
      seen.add(k); st.push([nx, ny]);
    }
  }
  return true;
}
function isCorridor(cells) {   // one square wide everywhere
  const set = new Set(cells);
  return cells.every(i => { const x = i % work.cols; const wide = (set.has(i + 1) && x + 1 < work.cols) && (set.has(i + work.cols) && set.has(i + work.cols + 1)); return !wide; });
}
function startBlank() {
  const s = state.scene, g = V.grid(), a = s.meta.area || { cols: 30, rows: 20 };
  const cols = s.meta.image && s.meta.image.w ? Math.round(s.meta.image.w / g.size) : a.cols, rows = s.meta.image && s.meta.image.h ? Math.round(s.meta.image.h / g.size) : a.rows;
  const plan = Plan.normalize({ cols, rows, cells: (cols * rows) + '.', seed: Math.random().toString(36).slice(2, 8), style: Object.assign({}, Plan.STYLE) });
  V.op({ t: 'scene.update', id: s.id, patch: { plan, area: { cols: plan.cols, rows: plan.rows }, bg: '#0c0b0a', grid: Object.assign({}, g, { ox: 0, oy: 0, alpha: 0 }) } })
    .then(() => { mode = 'room'; V.renderSubtools(); V.hud(); });
}
function planSettings() {
  if (!ensureWork()) return;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const st = Object.assign({}, work.style);
  const cols = h('input', { type: 'number', min: 4, max: 200, value: work.cols, style: 'width:100%' }), rows = h('input', { type: 'number', min: 4, max: 200, value: work.rows, style: 'width:100%' });
  const col = (k, label) => h('label', { class: 'inline' }, h('input', { type: 'color', value: st[k], oninput: e => { st[k] = e.target.value; } }), label);
  const chk = (k, label) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st[k], onchange: e => { st[k] = e.target.checked; } }), label);
  const pick = (k, list, label) => h('div', null, h('label', null, label), h('select', { style: 'width:100%', onchange: e => { st[k] = e.target.value || null; } }, ...list.map(([v, l]) => h('option', { value: v, selected: (st[k] || '') === v || null }, l))));
  const save = () => {
    const nc = Math.max(4, Math.min(200, +cols.value || work.cols)), nr = Math.max(4, Math.min(200, +rows.value || work.rows));
    if (nc !== work.cols || nr !== work.rows) {   // grow or shrink from the bottom right
      const g2 = new Uint8Array(nc * nr);
      for (let y = 0; y < Math.min(nr, work.rows); y++) for (let x = 0; x < Math.min(nc, work.cols); x++) g2[y * nc + x] = work.grid[y * work.cols + x];
      work.grid = g2; work.cols = nc; work.rows = nr;
    }
    work.style = st;
    const packed = Plan.pack(work);
    V.op({ t: 'scene.update', id: state.scene.id, patch: { plan: packed, area: { cols: nc, rows: nr }, bg: st.render === 'ink' ? st.paper : '#0c0b0a' } }).then(close);
  };
  const exportPng = gmCopy => {
    const cv = V.planCanvas(Plan.pack(work), 6000, gmCopy ? { c: 140, labels: true } : { c: 140, players: true }); if (!cv) return;
    cv.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: (state.scene.meta.name || 'map').replace(/[^\w -]+/g, '') + (gmCopy ? ' (GM)' : '') + '.png' }); document.body.append(a); a.click(); a.remove(); });
  };
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(460px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Plan'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('div', { class: 'two' }, h('div', null, h('label', null, 'Squares across'), cols), h('div', null, h('label', null, 'Squares down'), rows)),
      h('label', null, 'Look'),
      h('div', { class: 'two' },
        pick('render', [['painted', 'Painted (textures, shadows)'], ['ink', 'Ink on parchment']], 'Style'),
        pick('labels', [['gm', 'Room numbers: GM layer'], ['all', 'Room numbers: on the map, for everyone']], 'Numbers')),
      h('div', { class: 'two' },
        pick('floorMat', Plan.FLOOR_MATS.map(m => [m, (Plan.MATS.find(q => q[0] === m) || [, m])[1]]), 'The plan’s floor'),
        pick('wallMat', [['stone', 'Stone walls'], ['rock', 'Rough rock'], ['brick', 'Brick'], ['wood', 'Timber'], ['plaster', 'Plaster']], 'Walls')),
      pick('outside', [['rock', 'Solid rock'], ['black', 'Black'], ['grass', 'Grass (a building outdoors)'], ['earth', 'Forest floor'], ['dirt', 'Dirt'], ['snow', 'Snow'], ['sand', 'Sand']], 'Outside the walls'),
      h('p', { class: 'muted small' }, 'Ink only:'),
      h('div', { class: 'planlook' }, col('paper', 'Paper'), col('floor', 'Floor'), col('ink', 'Ink'), col('water', 'Water')),
      h('div', { class: 'planlook' }, chk('hatch', 'Hatching'), chk('shadow', 'Shadows')),
      h('div', { class: 'planlook' }, chk('grid', 'Grid on the floor')),
      h('p', { class: 'muted small' }, 'The walls and doors come from the plan; walls you draw by hand stay as they are when it changes.')),
    h('div', { class: 'df' },
      h('button', { class: 'btn', onclick: () => exportPng(false), title: 'Save the map as a picture (as the players see it: no secret doors or numbers)' }, 'Export PNG'),
      h('button', { class: 'btn', onclick: () => exportPng(true), title: 'The GM’s copy: room numbers and secret doors drawn in' }, 'GM copy'),
      h('button', { class: 'btn danger', onclick: () => { if (confirm('Take the plan off this scene? Its walls go too (Ctrl+Z brings it back).')) V.op({ t: 'scene.update', id: state.scene.id, patch: { plan: null } }).then(close); } }, 'Remove plan'),
      h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  modal.hidden = false;
}

// ───────────────────────── the generator ─────────────────────────
let genOpts = { kind: 'rooms', size: 'medium', theme: 'tomb', density: 0.5, loops: 0.3, water: 0.3, dark: true, seed: '', style: 'painted', containers: true, weather: false };
// o.back: opened from the new scene wizard (a button goes back to it); o.name: the name typed there
function openGenerator(o) {
  o = o || {};
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  let result = null;
  const pv = h('div', { class: 'genpv' }), info = h('div', { class: 'genfo small' });
  const seedIn = h('input', { value: genOpts.seed, placeholder: 'random', style: 'width:100%', onchange: e => { genOpts.seed = e.target.value.trim(); run(); } });
  const sel = (k, list, label) => h('div', null, h('label', null, label), h('select', { style: 'width:100%', onchange: e => { genOpts[k] = e.target.value; run(); } }, ...list.map(([v, l]) => h('option', { value: v, selected: genOpts[k] === v || null }, l))));
  const rng = (k, label, title) => h('div', null, h('label', { title }, label), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: genOpts[k], style: 'width:100%', onchange: e => { genOpts[k] = +e.target.value; run(); } }));
  function run(newSeed) {
    if (newSeed || !seedIn.value) seedIn.value = Math.random().toString(36).slice(2, 8);   // (changing an option keeps the map's seed: ↻ for another)
    const seed = seedIn.value;
    result = Plan.generate(Object.assign({}, genOpts, { seed }));
    const cv = V.planCanvas(result.plan, 900, { labels: true });
    pv.replaceChildren(cv || h('p', null, 'No preview'));
    const nl = Plan.lights(result.plan).length, nc = (result.containers || []).length;
    info.replaceChildren(h('b', null, result.name), ` · ${result.rooms.length} rooms · ${result.plan.cols}×${result.plan.rows} squares · ${nl} light${nl === 1 ? '' : 's'}${nc ? ` · ${nc} container${nc === 1 ? '' : 's'}` : ''}`);
  }
  const make = async (into) => {
    if (!result) return;
    const g = V.grid(), size = into ? g.size : 100;
    const building = genOpts.kind === 'building';
    const meta = { name: result.name, plan: result.plan, area: { cols: result.plan.cols, rows: result.plan.rows }, bg: result.plan.style.render === 'ink' ? result.plan.style.paper : '#0c0b0a', notes: Plan.notes(result),
      grid: { type: 'square', size, ox: 0, oy: 0, alpha: 0, feet: g.feet || 5, units: g.units || 'ft', diagonal: g.diagonal || 'one' }, vision: !!genOpts.dark, darkness: genOpts.dark ? 1 : 0, image: null,
      weather: building && !!genOpts.weather, clock: building && !!genOpts.weather };   // (outdoors: the weather, and the light of the hour)
    let sid = into ? state.scene.id : null;
    try {
      if (into) await V.op({ t: 'scene.update', id: sid, patch: meta });
      else { const r = await V.op({ t: 'scene.create', scene: meta }); sid = r.op && r.op.scene && r.op.scene.id; }
      // (the lights come with the plan: the server lights every torch, lantern and fire on it)
      // the chests, barrels and crates: props on the token layer, off the grid, filled from their loot table when first opened
      const boxes = (genOpts.containers ? result.containers || [] : []).map(b => ({ t: 'token.create', scene: sid, token: {
        name: b.name, img: b.img, prop: true, w: b.w, h: b.h, size: 1, x: Math.round(b.x * size * 10) / 10, y: Math.round(b.y * size * 10) / 10, rot: b.rot || 0,
        layer: 'tokens', nameShown: false, ring: false, snap: false, container: { items: [], table: b.table, rolled: false, locked: !!b.locked } } }));
      if (sid && boxes.length) await V.op({ t: 'batch', ops: boxes });
    } catch (e) { return; }
    close();
    if (sid && V.makeSceneThumb) V.makeSceneThumb(sid, result.plan);
    if (!into && sid && V.viewScene) V.viewScene(sid);
    V.toast(`${result.name}: the room descriptions are in the scene’s notes${genOpts.containers && (result.containers || []).length ? '; the chests and barrels fill from their loot tables when first opened' : ''}`);
  };
  const themes = (genOpts.kind === 'building' ? Plan.BUILDINGS : Plan.THEMES).map(t => [t, t[0].toUpperCase() + t.slice(1)]);
  modal.replaceChildren(h('div', { class: 'dialog gendlg', style: 'width:min(980px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, (o.back ? 'New scene: ' : '') + (genOpts.kind === 'building' ? 'generate a building' : 'generate a dungeon').replace(/^g/, o.back ? 'g' : 'G')), h('button', { onclick: close }, '×')),
    h('div', { class: 'db genwrap' },
      h('div', { class: 'genctl' },
        h('div', null, h('label', null, 'Kind'), h('select', { style: 'width:100%', onchange: e => {
          genOpts.kind = e.target.value;
          if (genOpts.kind === 'building' && !Plan.BUILDINGS.includes(genOpts.theme)) { genOpts.theme = 'tavern'; genOpts.dark = false; }
          if (genOpts.kind !== 'building' && !Plan.THEMES.includes(genOpts.theme)) { genOpts.theme = 'tomb'; genOpts.dark = true; }
          openGenerator(o);
        } }, ...[['rooms', 'Dungeon: rooms and corridors'], ['caves', 'Caves'], ['mixed', 'Both: halls into caves'], ['building', 'A building: tavern, house, shop…']].map(([v, l]) => h('option', { value: v, selected: genOpts.kind === v || null }, l)))),
        sel('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'Size'),
        sel('theme', themes, genOpts.kind === 'building' ? 'What it is' : 'What it was'),
        sel('style', [['painted', 'Painted (textures, shadows)'], ['ink', 'Ink on parchment']], 'Look'),
        genOpts.kind === 'building' ? null : [rng('density', 'Crowded', 'More rooms, packed tighter'), rng('loops', 'Loops', 'More than one way round'), rng('water', 'Water', 'Pools and flooding')],
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: genOpts.dark, onchange: e => { genOpts.dark = e.target.checked; } }), genOpts.kind === 'building' ? 'Night: sight on, lit by its fires and lanterns' : 'Dark: sight on, lit by its torches and fires'),
        h('label', { class: 'inline', title: 'Chests, barrels, crates and sacks to suit each room (a storeroom’s crates, a bedroom’s chest, a treasury’s locked coffers), as objects on the token layer: move them, open them, take from them. Each fills from a loot table the first time it’s opened.' },
          h('input', { type: 'checkbox', checked: genOpts.containers, onchange: e => { genOpts.containers = e.target.checked; run(); } }), 'Containers with loot'),
        genOpts.kind === 'building' ? h('label', { class: 'inline', title: 'From the clock in the top bar: rain, snow and fog outside (not indoors), the light and its colour following the time of day (gold at sunset, blue at night, grey under cloud), and dark at night but for its fires and lanterns' }, h('input', { type: 'checkbox', checked: genOpts.weather, onchange: e => { genOpts.weather = e.target.checked; } }), 'Weather and time of day') : null,
        h('label', null, 'Seed'), h('div', { class: 'row' }, seedIn, h('button', { class: 'btn sm', title: 'Another one', onclick: () => run(true) }, '↻')),
        info,
        h('p', { class: 'muted small' }, 'Walls, doors and secret doors come with it, and a description of each room goes in the scene’s notes. Tweak anything afterwards with the plan tool.')),
      pv),
    h('div', { class: 'df' }, o.back ? h('button', { class: 'btn', onclick: () => o.back() }, '← Back') : null, h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      !o.back && state.scene && state.scene.meta.kind !== 'world' ? h('button', { class: 'btn', title: 'Put it in this scene instead of its map (its tokens stay)', onclick: () => { if (!scenePlan() && !(state.scene.meta.image) || confirm('Replace this scene’s map with the dungeon?')) make(true); } }, 'Use this scene') : null,
      h('button', { class: 'btn primary', onclick: () => make(false) }, 'Make a new scene'))));
  modal.hidden = false;
  pv.replaceChildren(h('p', { class: 'muted' }, 'Drawing…'));
  (V.planTexturesReady ? V.planTexturesReady() : Promise.resolve()).then(() => run(!genOpts.seed));
}
V.openDungeonGenerator = openGenerator;

// ───────────────────────── editing the map on the map layer ─────────────────────────
// With the map layer in hand (and the select tool), the planned map's furniture can be picked up where it lies: drag it
// to another square, R turns it, D copies it, Delete takes it away. The bar by the layer switch says what's picked up.
let mSel = -1, mDrag = null, mSelG = null, mBar = null;
const featName = k => (Plan.FEATS.find(f => f[0] === k) || [, k])[1];
function mDraw() {
  const L = V.stage && V.stage.L; if (!L) return;
  if (!mSelG) { mSelG = new PIXI.Graphics(); L.over.addChildAt(mSelG, 0); }
  mSelG.clear();
  const f = work && mSel >= 0 ? work.feats[mSel] : null;
  if (f && V.mapEdit.on()) {
    const g = V.grid(), c = g.size, fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h, lw = Math.max(2, 2 / V.stage.scale());
    mSelG.lineStyle({ width: lw * 2.5, color: 0x000000, alpha: 0.35 }).drawRoundedRect((g.ox || 0) + f.x * c, (g.oy || 0) + f.y * c, fw * c, fh * c, c * 0.08);
    mSelG.lineStyle({ width: lw, color: 0x9fc27a, alpha: 1 }).beginFill(0x9fc27a, 0.12).drawRoundedRect((g.ox || 0) + f.x * c, (g.oy || 0) + f.y * c, fw * c, fh * c, c * 0.08).endFill();
  }
  mBarDraw(f);
}
function mBarDraw(f) {
  if (!mBar) { mBar = h('div', { id: 'mapSelBar', class: 'gm' }); $('#app').append(mBar); }
  const on_ = V.mapEdit.on();
  mBar.hidden = !on_;
  if (!on_) return;
  const btn = (label, title, fn, cls) => h('button', { class: cls || null, title, onclick: fn }, label);
  mBar.replaceChildren(...(f ? [
    h('b', null, featName(f.k)),
    btn('↻ Turn', 'Turn it (R)', () => V.mapEdit.key({ key: 'r' })),
    btn('⧉ Copy', 'A copy beside it (D)', () => V.mapEdit.key({ key: 'd' })),
    btn('✕ Remove', 'Take it away (Delete)', () => V.mapEdit.key({ key: 'Delete' }), 'danger')
  ] : [
    h('span', { class: 'muted' }, 'Drag the map’s furniture to move it'),
    btn('+ Furniture', 'Put new pieces down (the room planner’s Furnish)', () => { mode = 'furnish'; V.setTool('plan'); })
  ]));
}
V.mapEdit = {
  on: () => V.isGM() && state.layer === 'map' && state.tool === 'select' && !!scenePlan() && !(state.scene && state.scene.meta.kind === 'world'),
  down(p) {
    if (!ensureWork()) return false;
    const [x, y] = cellAt(p), i = inside(x, y) ? featAt(x, y) : -1;
    if (i < 0) { if (mSel >= 0) { mSel = -1; mDraw(); } return false; }
    mSel = i; const f = work.feats[i];
    mDrag = { i, dx: x - f.x, dy: y - f.y, moved: false };
    mDraw(); return true;
  },
  move(p) {
    if (!mDrag || !work) return;
    const [x, y] = cellAt(p), f = work.feats[mDrag.i]; if (!f) return;
    const fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h;
    const nx = Math.max(0, Math.min(work.cols - fw, x - mDrag.dx)), ny = Math.max(0, Math.min(work.rows - fh, y - mDrag.dy));
    if (nx !== f.x || ny !== f.y) { f.x = nx; f.y = ny; mDrag.moved = true; changed(false); mDraw(); }
  },
  up() { const d = mDrag; mDrag = null; if (d && d.moved) changed(true); mDraw(); },
  hover(p) {
    if (!work && !ensureWork()) return;
    const [x, y] = cellAt(p); V.stage.app.view.style.cursor = inside(x, y) && featAt(x, y) >= 0 ? 'grab' : 'default';
  },
  key(e) {
    if (!work || mSel < 0 || !work.feats[mSel]) { if (e.key === 'Escape' && mSel >= 0) { mSel = -1; mDraw(); return true; } return false; }
    const f = work.feats[mSel], k = e.key;
    if (k === 'r' || k === 'R') { f.r = (f.r + 1) % 4; const fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h; f.x = Math.min(f.x, work.cols - fw); f.y = Math.min(f.y, work.rows - fh); changed(true); mDraw(); return true; }
    if (k === 'd' || k === 'D') { const c = Object.assign({}, f, { x: Math.min(work.cols - 1, f.x + 1) }); work.feats.push(c); mSel = work.feats.length - 1; changed(true); mDraw(); return true; }
    if (k === 'Delete' || k === 'Backspace') { work.feats.splice(mSel, 1); mSel = -1; changed(true); mDraw(); return true; }
    if (k === 'Escape') { mSel = -1; mDraw(); return true; }
    return false;
  }
};
V.on('scene', () => { mSel = -1; mDrag = null; if (mSelG) mSelG.clear(); if (mBar) mBarDraw(null); });
V.on('layer', () => { mSel = -1; mDraw(); });
V.on('tool', () => { if (!V.mapEdit.on()) mSel = -1; if (mBar || V.mapEdit.on()) mDraw(); });
on('tool', t => { if (t === 'plan') { ensureWork(); preview(); } else if (V.stage && V.stage.L) V.stage.L.draw.clear(); });
})();
