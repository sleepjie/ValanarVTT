/* Plans: a scene's map drawn as squares (the room planner and the dungeon generator), shared by the server (the walls
 * a plan makes, checking what a client sends) and the table (drawing it, editing it, generating one).
 *
 * plan: { cols, rows, cells, doors, feats, labels, style, seed }
 *   cells   the squares, run-length coded: "12.5#3~" = 12 rock, 5 floor, 3 water (row by row, top-left first); other letters
 *           are other floors (MATS: flagstones, planks, grass, a chasm, lava…)
 *   doors   [{ x, y, s: 'n' | 'w', k }] on the north or west edge of square (x, y); k: door | locked | secret | arch | bars
 *   feats   [{ k, x, y, w, h, r }] furniture and fittings: k from FEATS, a w×h block of squares from (x, y), turned r×90°
 *   labels  [{ n, x, y, t, note }] room numbers, at a square's middle, with the room's name and the GM's notes
 *   style   { render: 'painted' | 'ink', floorMat, wallMat, outside; for ink: paper, floor, ink, water, hatch, grid, shadow; labels }
 * A plan makes the scene's walls: wherever floor meets rock, and a door on each door. They're kept with src: 'plan', so
 * walls drawn by hand stay as they are when the plan changes. */
(function (root) {
'use strict';
const ROCK = 0, FLOOR = 1, WATER = 2;
// what a square is: rock (solid: walls go round it), or a floor of some kind. FLOOR is the plan's own floor (style.floorMat).
// [key, label, code letter, kind] kind: floor | liquid (water, lava) | void (a chasm: open, but a drop)
const MATS = [['rock', 'Rock', '.', 'solid'], ['floor', 'Floor', '#', 'floor'], ['water', 'Water', '~', 'liquid'],
  ['flagstone', 'Flagstones', 'f', 'floor'], ['cobble', 'Cobbles', 'c', 'floor'], ['planks', 'Planks', 'p', 'floor'], ['dirt', 'Dirt', 'd', 'floor'],
  ['grass', 'Grass', 'g', 'floor'], ['cave', 'Cave floor', 'r', 'floor'], ['gravel', 'Gravel', 'v', 'floor'], ['marble', 'Marble', 'm', 'floor'],
  ['tiles', 'Tiles', 't', 'floor'], ['sand', 'Sand', 's', 'floor'], ['snow', 'Snow', 'n', 'floor'], ['carpet', 'Carpet', 'k', 'floor'],
  ['chasm', 'Chasm', 'x', 'void'], ['lava', 'Lava', 'l', 'liquid'], ['mossy', 'Mossy cobbles', 'o', 'floor'], ['earth', 'Forest floor', 'e', 'floor'],
  ['oldplanks', 'Old boards', 'b', 'floor']];
const MAT = Object.fromEntries(MATS.map((m, i) => [m[0], i]));
const CH = MATS.map(m => m[2]), OF = Object.fromEntries(MATS.map((m, i) => [m[2], i]));
const FLOOR_MATS = MATS.filter(m => m[3] === 'floor' && m[0] !== 'floor').map(m => m[0]);
const WALL_MATS = ['stone', 'rock', 'brick', 'wood', 'plaster'];
const OUTSIDE = ['rock', 'black', 'earth', 'grass', 'dirt', 'snow', 'sand'];
const DOORS = ['door', 'locked', 'secret', 'arch', 'bars', 'wall', 'window'];   // wall: a wall between two floor squares (inside a building)
// furniture and fittings: [key, label, w, h, group]
const FEATS = [
  ['column', 'Column', 1, 1, 'Fittings'], ['pillar', 'Square pillar', 1, 1, 'Fittings'], ['stairsdown', 'Stairs down', 1, 2, 'Fittings'], ['stairsup', 'Stairs up', 1, 2, 'Fittings'],
  ['statue', 'Statue', 1, 1, 'Fittings'], ['altar', 'Altar', 2, 1, 'Fittings'], ['fountain', 'Fountain', 2, 2, 'Fittings'], ['well', 'Well', 1, 1, 'Fittings'],
  ['sarcophagus', 'Sarcophagus', 1, 2, 'Fittings'], ['coffin', 'Coffin', 1, 2, 'Fittings'], ['rubble', 'Rubble', 1, 1, 'Fittings'], ['trapdoor', 'Trapdoor', 1, 1, 'Fittings'],
  ['pit', 'Pit', 1, 1, 'Fittings'], ['brazier', 'Brazier', 1, 1, 'Fittings'], ['throne', 'Throne', 1, 1, 'Fittings'], ['stalagmite', 'Stalagmite', 1, 1, 'Fittings'],
  ['table', 'Table', 2, 1, 'Furniture'], ['roundtable', 'Round table', 2, 2, 'Furniture'], ['chair', 'Chair', 1, 1, 'Furniture'], ['bench', 'Bench', 2, 1, 'Furniture'],
  ['bed', 'Bed', 1, 2, 'Furniture'], ['bunk', 'Bunk beds', 1, 2, 'Furniture'], ['bookshelf', 'Bookshelf', 2, 1, 'Furniture'], ['counter', 'Counter', 3, 1, 'Furniture'],
  ['fireplace', 'Fireplace', 2, 1, 'Furniture'], ['rug', 'Rug', 2, 3, 'Furniture'], ['chest', 'Chest', 1, 1, 'Furniture'], ['barrel', 'Barrel', 1, 1, 'Furniture'],
  ['crate', 'Crate', 1, 1, 'Furniture'], ['wardrobe', 'Wardrobe', 2, 1, 'Furniture'], ['desk', 'Desk', 2, 1, 'Furniture'], ['anvil', 'Anvil', 1, 1, 'Furniture'],
  ['cauldron', 'Cauldron', 1, 1, 'Furniture'], ['plant', 'Plant', 1, 1, 'Furniture'], ['cage', 'Cage', 1, 1, 'Furniture'], ['weaponrack', 'Weapon rack', 2, 1, 'Furniture'],
  ['torch', 'Wall torch', 1, 1, 'Dressing'], ['candles', 'Candles', 1, 1, 'Dressing'], ['bones', 'Bones', 1, 1, 'Dressing'], ['cobweb', 'Cobweb', 1, 1, 'Dressing'],
  ['sack', 'Sacks', 1, 1, 'Dressing'], ['blood', 'Bloodstain', 1, 1, 'Dressing'], ['banner', 'Banner', 1, 1, 'Dressing'], ['shelf', 'Shelf', 2, 1, 'Dressing'],
  ['lamp', 'Lantern', 1, 1, 'Dressing'],
  ['boulder', 'Boulder', 1, 1, 'Outdoors'], ['tree', 'Tree', 2, 2, 'Outdoors'], ['bush', 'Bush', 1, 1, 'Outdoors'], ['log', 'Fallen log', 2, 1, 'Outdoors'],
  ['tent', 'Tent', 2, 2, 'Outdoors'], ['campfire', 'Campfire', 1, 1, 'Outdoors'], ['cart', 'Cart', 2, 3, 'Outdoors'], ['haybale', 'Hay bale', 1, 1, 'Outdoors']
];
const FEAT_KEYS = FEATS.map(f => f[0]);
// what gives off light: [bright, dim (feet), colour, flicker, where the flame is in its square before it's turned (dx, dy)]
const GLOW = {
  torch: [15, 30, '#ffb46a', 'torch', 0, -0.28], lamp: [15, 30, '#ffd59a', 'candle', 0, -0.3], brazier: [15, 30, '#ff9a4a', 'torch'],
  campfire: [20, 40, '#ff9a4a', 'torch'], fireplace: [20, 40, '#ff9a4a', 'torch', 0, -0.22], candles: [5, 15, '#ffd08a', 'candle'], cauldron: [5, 10, '#ff8a3a', 'torch']
};
// the lights a plan gives (in squares): one for each torch, lantern, fire and candle, and a dull glow over lava.
// The server keeps the scene's lights in step with them (src: 'plan'), as it does the walls.
function lightsOf(p) {
  const P = p.grid ? p : unpack(p), out = [], r2 = v => Math.round(v * 100) / 100;
  for (const f of P.feats) {
    const g = GLOW[f.k]; if (!g) continue;
    const fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h, a = (f.r || 0) * Math.PI / 2, dx = g[4] || 0, dy = g[5] || 0;
    out.push({ key: f.k + '@' + f.x + ',' + f.y, x: r2(f.x + fw / 2 + dx * Math.cos(a) - dy * Math.sin(a)), y: r2(f.y + fh / 2 + dx * Math.sin(a) + dy * Math.cos(a)),
      bright: g[0], dim: g[1], color: g[2], anim: g[3] });
  }
  let n = 0;
  for (let y = 1; y < P.rows && n < 40; y += 4) for (let x = 1; x < P.cols && n < 40; x += 4) if (P.grid[y * P.cols + x] === MAT.lava) { n++; out.push({ key: 'lava@' + x + ',' + y, x: x + 0.5, y: y + 0.5, bright: 5, dim: 20, color: '#ff5a1a', anim: 'pulse' }); }
  return out.slice(0, 300);
}
// things that can be opened: [name, width, depth (squares, its real size: a chest is about three feet by two), picture]
const CONTAINERS = { chest: ['Chest', 0.73, 0.59, '/table/data/props/chest.png'], barrel: ['Barrel', 0.72, 0.75, '/table/data/props/barrel.png'],
  crate: ['Crate', 0.73, 0.76, '/table/data/props/crate.png'], sack: ['Sacks', 0.67, 0.58, '/table/data/props/sack.png'] };
// what a kind of room keeps, and in what: [containers, loot table, how many (fewest, most), chance a chest is locked]
const ROOM_LOOT = {
  storeroom: ['crate barrel sack', 'preset:clutter', 2, 4], larder: ['barrel sack', 'preset:pantry', 1, 3], kitchen: ['barrel sack', 'preset:pantry', 1, 2],
  cellar: ['barrel crate', 'preset:cellar', 2, 4], mess: ['barrel', 'preset:cellar', 1, 2], refectory: ['barrel', 'preset:pantry', 1, 2], common: ['barrel', 'preset:cellar', 1, 2],
  treasury: ['chest', 'preset:hoard', 1, 3, 0.6], vault: ['chest', 'preset:hoard', 1, 2, 0.7], hoard: ['chest sack', 'preset:hoard', 1, 2, 0.3],
  armoury: ['chest crate', 'preset:armoury', 1, 2, 0.3], barracks: ['chest', 'preset:adventurer', 1, 3, 0.2], guardroom: ['chest', 'preset:bandit', 1, 1, 0.3],
  library: ['chest', 'preset:study', 1, 1, 0.3], scriptorium: ['chest', 'preset:study', 1, 1], study: ['chest', 'preset:study', 1, 1, 0.4], office: ['chest', 'preset:study', 1, 1, 0.5],
  laboratory: ['crate chest', 'preset:alchemist', 1, 2, 0.3], summoning: ['chest', 'preset:minor', 0, 1, 0.5],
  shrine: ['chest', 'preset:shrine', 0, 1, 0.3], chapel: ['chest', 'preset:shrine', 1, 1, 0.3], nave: ['chest', 'preset:shrine', 0, 1, 0.3], vestry: ['chest', 'preset:shrine', 1, 1, 0.3],
  crypt: ['chest', 'preset:tomb', 0, 1, 0.4], ossuary: ['chest', 'preset:tomb', 0, 1, 0.3], embalming: ['crate', 'preset:alchemist', 0, 1],
  bedchamber: ['chest', 'preset:wardrobe', 1, 1, 0.5], bedroom: ['chest', 'preset:wardrobe', 1, 1, 0.3], priest: ['chest', 'preset:wardrobe', 1, 1, 0.3], warden: ['chest', 'preset:bandit', 1, 1, 0.5],
  smugglers: ['crate barrel sack', 'preset:bandit', 2, 3, 0.3], den: ['sack', 'preset:bandit', 0, 1], forge: ['crate barrel', 'preset:workshop', 1, 2], workshop: ['crate', 'preset:workshop', 1, 2],
  workings: ['crate', 'preset:workshop', 0, 1], shopfront: ['crate chest', 'preset:clutter', 1, 2, 0.3], throne: ['chest', 'preset:hoard', 0, 1, 0.8],
  cells: ['sack', 'preset:adventurer', 0, 1], torture: ['sack', 'preset:adventurer', 0, 1], collapsed: ['sack', 'preset:adventurer', 0, 1], midden: ['sack', 'preset:clutter', 0, 1],
  menagerie: ['crate', 'preset:clutter', 0, 1], hall: ['chest', 'preset:wardrobe', 0, 1, 0.3], greathall: ['barrel', 'preset:cellar', 0, 1],
  camp: ['sack crate', 'preset:adventurer', 1, 2]
};
// a room's chests, barrels, crates and sacks become ones you can open (as many as the room should have; more put by its
// walls if it's short). rooms: [{ type, cells: Set, wall: [[x, y, r]] }]; place(k, x, y, r, room) puts a feature down.
function lootUp(w, rooms, R, place) {
  const out = [];
  for (const rm of rooms) {
    const L = ROOM_LOOT[rm.type]; if (!L) continue;
    const kinds = L[0].split(' '); let n = R.int(L[2], L[3]);
    const take = f => { const C = CONTAINERS[f.k], jx = (R() - 0.5) * 0.16, jy = (R() - 0.5) * 0.16, fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h;
      out.push({ k: f.k, name: C[0], img: C[3], x: f.x + fw / 2 + jx, y: f.y + fh / 2 + jy, w: C[1], h: C[2], rot: (f.r || 0) * 90 + (f.k === 'chest' ? 0 : Math.round((R() - 0.5) * 30)), table: L[1], locked: f.k === 'chest' && R.chance(L[4] || 0) }); };
    for (let i = w.feats.length - 1; i >= 0 && n > 0; i--) { const f = w.feats[i]; if (!CONTAINERS[f.k] || !kinds.includes(f.k) || !rm.cells.has(f.y * w.cols + f.x)) continue; w.feats.splice(i, 1); take(f); n--; }
    for (const [x, y, r] of R.shuffle(rm.wall.slice())) { if (n <= 0) break; if (place(R.pick(kinds), x, y, r, rm.room)) { take(w.feats.pop()); n--; } }
  }
  return out;
}
const STYLE = { render: 'painted', paper: '#f6f0e1', floor: '#fffdf8', ink: '#221e1a', water: '#c9d9de', hatch: true, grid: true, shadow: true,
  floorMat: 'flagstone', wallMat: 'stone', outside: 'rock' };

// ───────── cells ─────────
function encode(cells) {
  let out = '', run = 0, prev = -1;
  for (let i = 0; i <= cells.length; i++) {
    const v = i < cells.length ? cells[i] : -2;
    if (v === prev) { run++; continue; }
    if (prev >= 0) out += (run > 1 ? run : '') + CH[prev];
    prev = v; run = 1;
  }
  return out;
}
function decode(str, n) {
  const cells = new Uint8Array(n); let i = 0, num = '';
  for (const c of String(str || '')) {
    if (c >= '0' && c <= '9') { num += c; continue; }
    const v = OF[c]; const k = num ? Math.min(+num, n - i) : 1; num = '';
    if (v == null) continue;
    cells.fill(v, i, i + k); i += k; if (i >= n) break;
  }
  return cells;
}
const clampN = (v, a, b, d) => { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const colour = (c, d) => /^#[0-9a-f]{6}$/i.test(c) ? c : d;
// whatever a client sends, made safe (and a fresh plan when given nothing)
function normalize(p) {
  p = p && typeof p === 'object' ? p : {};
  const cols = clampN(p.cols, 4, 200, 30), rows = clampN(p.rows, 4, 200, 20);
  const cells = decode(p.cells, cols * rows);
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const seen = new Set();
  const doors = (Array.isArray(p.doors) ? p.doors : []).slice(0, 3000).map(d => ({ x: clampN(d && d.x, 0, cols, 0), y: clampN(d && d.y, 0, rows, 0), s: d && d.s === 'w' ? 'w' : 'n', k: DOORS.includes(d && d.k) ? d.k : 'door' }))
    .filter(d => { const key = d.x + ',' + d.y + d.s; if (seen.has(key)) return false; seen.add(key); return inside(d.x, d.y) || (d.s === 'n' ? d.y === rows && d.x < cols : d.x === cols && d.y < rows); });
  const feats = (Array.isArray(p.feats) ? p.feats : []).slice(0, 3000).filter(f => f && FEAT_KEYS.includes(f.k)).map(f => ({ k: f.k, x: clampN(f.x, 0, cols - 1, 0), y: clampN(f.y, 0, rows - 1, 0),
    w: clampN(f.w, 1, 12, 1), h: clampN(f.h, 1, 12, 1), r: clampN(f.r, 0, 3, 0) }));
  const labels = (Array.isArray(p.labels) ? p.labels : []).slice(0, 400).map(l => {
    const o = { n: String(l && l.n || '').slice(0, 6), x: Math.max(0, Math.min(cols, +l.x || 0)), y: Math.max(0, Math.min(rows, +l.y || 0)) };
    if (l && l.t) o.t = String(l.t).slice(0, 80);          // the room's name
    if (l && l.note) o.note = String(l.note).slice(0, 4000);   // the GM's notes on it
    return o;
  }).filter(l => l.n);
  const s = p.style && typeof p.style === 'object' ? p.style : {};
  const style = { render: s.render === 'ink' ? 'ink' : s.render === 'painted' ? 'painted' : (p.style ? 'ink' : STYLE.render),   // (plans made before there was a choice were ink)
    paper: colour(s.paper, STYLE.paper), floor: colour(s.floor, STYLE.floor), ink: colour(s.ink, STYLE.ink), water: colour(s.water, STYLE.water),
    hatch: s.hatch !== false, grid: s.grid !== false, shadow: s.shadow !== false,
    floorMat: FLOOR_MATS.includes(s.floorMat) ? s.floorMat : STYLE.floorMat, wallMat: WALL_MATS.includes(s.wallMat) ? s.wallMat : STYLE.wallMat,
    outside: OUTSIDE.includes(s.outside) ? s.outside : STYLE.outside, labels: s.labels === 'all' ? 'all' : s.labels === 'gm' ? 'gm' : null };
  return { cols, rows, cells: encode(cells), doors, feats, labels, style, seed: String(p.seed || '').slice(0, 40) };
}
// a working copy: the cells as an array (edit it, then pack() it back)
function unpack(p) { const q = normalize(p); return Object.assign({}, q, { grid: decode(q.cells, q.cols * q.rows) }); }
function pack(w) { const q = Object.assign({}, w, { cells: encode(w.grid) }); delete q.grid; return normalize(q); }
const at = (w, x, y) => (x < 0 || y < 0 || x >= w.cols || y >= w.rows) ? ROCK : w.grid[y * w.cols + x];
const open = (w, x, y) => at(w, x, y) !== ROCK;

// ───────── walls ─────────
// [{ a, b, kind, open, locked, door }] in map pixels (a square is gs across, from ox, oy)
const DOOR_WALL = { door: 'door', locked: 'door', secret: 'secret', bars: 'window', wall: 'wall', window: 'window' };
// ───────── outlines: the edge of the floor as closed loops; natural floors (caves, earth, water…) smoothed ─────────
// Each loop is a list of points in squares, walked with the floor on the right. Built floors keep square corners;
// where every square round a corner is natural (and no door touches it), the corner is rounded off (Chaikin, twice).
const NATURAL = new Set(['cave', 'gravel', 'dirt', 'earth', 'grass', 'sand', 'snow', 'water', 'lava', 'chasm']);
function natural(w, v) { if (v === ROCK) return true; const m = MATS[v][0] === 'floor' ? w.style.floorMat : MATS[v][0]; return NATURAL.has(m); }
function loops(p, iters) {
  const w = p.grid ? p : unpack(p), cols = w.cols, rows = w.rows;
  const doorEdge = new Set(w.doors.map(d => d.x + ',' + d.y + d.s));
  // the directed edges of the floor's outline, floor on the right: from vertex key to [x1, y1, x0, y0]
  const out = new Map(), add = (x0, y0, x1, y1) => { const k = x0 + ',' + y0; if (!out.has(k)) out.set(k, []); out.get(k).push([x1, y1]); };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!open(w, x, y)) continue;
    if (!open(w, x, y - 1)) add(x, y, x + 1, y);
    if (!open(w, x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!open(w, x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!open(w, x - 1, y)) add(x, y + 1, x, y);
  }
  const liqNat = new Uint8Array(cols * rows);
  {
    const seen = new Uint8Array(cols * rows);
    for (let i = 0; i < seen.length; i++) {
      const v0 = w.grid[i]; if (seen[i] || v0 === ROCK || MATS[v0][3] === 'floor') continue;
      const body = [], st = [i]; seen[i] = 1; let nat = false;
      while (st.length) {
        const j = st.pop(), x = j % cols, y = (j / cols) | 0; body.push(j);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = ny * cols + nx, v = w.grid[k]; if (v === ROCK) continue;
          if (MATS[v][3] === 'floor') { if (natural(w, v)) nat = true; continue; }
          if (!seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      if (nat) for (const j of body) liqNat[j] = 1;
    }
  }
  const hardAt = (x, y) => {
    if (x <= 0 || y <= 0 || x >= cols || y >= rows) return true;   // the map's own edge stays straight
    // a pool counts as natural if it touches natural floor (a cave's), built if it only touches built floor (a cistern's)
    for (const [cx, cy] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) {
      const v = at(w, cx, cy); if (v === ROCK) continue;
      if (MATS[v][3] === 'floor' ? !natural(w, v) : !liqNat[cy * cols + cx]) return true;
    }
    return doorEdge.has(x + ',' + y + 'n') || doorEdge.has((x - 1) + ',' + y + 'n') || doorEdge.has(x + ',' + y + 'w') || doorEdge.has(x + ',' + (y - 1) + 'w');
  };
  const res = [];
  for (const [k0, list0] of out) {
    while (list0.length) {
      const [sx, sy] = k0.split(',').map(Number), pts = [[sx, sy]];
      let px = sx, py = sy, dx = 0, dy = 0, guard = 0;
      for (;;) {
        const list = out.get(px + ',' + py); if (!list || !list.length) break;
        // at a pinch (two floor squares touching corner to corner), turn right: each square keeps its own loop
        let pick = 0;
        if (list.length > 1) { const turn = q => { const ex = q[0] - px, ey = q[1] - py; return (dx * ey - dy * ex); }; pick = list.map((q, i) => [turn(q), i]).sort((a, b) => b[0] - a[0])[0][1]; }
        const [nx, ny] = list.splice(pick, 1)[0];
        dx = nx - px; dy = ny - py; px = nx; py = ny;
        if (px === sx && py === sy) break;
        pts.push([px, py]);
        if (++guard > 200000) break;
      }
      // drop the points in the middle of straight runs
      const pl = pts.filter((q, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]) !== 0; });
      let L = pl.map(q => ({ x: q[0], y: q[1], hard: hardAt(q[0], q[1]) }));
      for (let it = 0; it < (iters == null ? 2 : iters); it++) {
        const nl = [];
        L.forEach((v, i) => {
          if (v.hard) { nl.push(v); return; }
          const a = L[(i - 1 + L.length) % L.length], b = L[(i + 1) % L.length];
          nl.push({ x: v.x + (a.x - v.x) * 0.25, y: v.y + (a.y - v.y) * 0.25, hard: false }, { x: v.x + (b.x - v.x) * 0.25, y: v.y + (b.y - v.y) * 0.25, hard: false });
        });
        L = nl;
      }
      let area = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; area += a.x * b.y - b.x * a.y; }
      res.push({ pts: L.map(v => [v.x, v.y]), area: area / 2 });
    }
  }
  return res;
}
// [{ a, b, kind, open, locked, door }] in map pixels (a square is gs across, from ox, oy)
function walls(p, gs, ox, oy) {
  const w = p.grid ? p : unpack(p), out = [];
  ox = ox || 0; oy = oy || 0;
  const P = (x, y) => [Math.round((ox + x * gs) * 10) / 10, Math.round((oy + y * gs) * 10) / 10];
  const doorAt = new Set(w.doors.map(d => d.x + ',' + d.y + d.s));
  const isDoorEdge = (a, b) => {   // a segment lying exactly on a door's edge (a door into rock: it gets a door, not a wall)
    if (a[0] === b[0] && Math.abs(a[1] - b[1]) === 1 && Number.isInteger(a[0]) && Number.isInteger(a[1])) return doorAt.has(a[0] + ',' + Math.min(a[1], b[1]) + 'w');
    if (a[1] === b[1] && Math.abs(a[0] - b[0]) === 1 && Number.isInteger(a[0]) && Number.isInteger(a[1])) return doorAt.has(Math.min(a[0], b[0]) + ',' + a[1] + 'n');
    return false;
  };
  for (const L of loops(w)) {
    const pts = L.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      // a door on this stretch: split it a square at a time so the door's own square is left out
      if ((a[0] === b[0] || a[1] === b[1]) && Number.isInteger(a[0]) && Number.isInteger(a[1]) && Number.isInteger(b[0]) && Number.isInteger(b[1])) {
        const n = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), sx = Math.sign(b[0] - a[0]), sy = Math.sign(b[1] - a[1]);
        let st = 0;
        for (let k = 0; k < n; k++) {
          const q0 = [a[0] + sx * k, a[1] + sy * k], q1 = [a[0] + sx * (k + 1), a[1] + sy * (k + 1)];
          if (isDoorEdge(q0, q1)) { if (k > st) out.push({ a: P(a[0] + sx * st, a[1] + sy * st), b: P(q0[0], q0[1]), kind: 'wall' }); st = k + 1; }
        }
        if (n > st) out.push({ a: P(a[0] + sx * st, a[1] + sy * st), b: P(b[0], b[1]), kind: 'wall' });
      } else out.push({ a: P(a[0], a[1]), b: P(b[0], b[1]), kind: 'wall' });
    }
  }
  for (const d of w.doors) {
    const kind = DOOR_WALL[d.k]; if (!kind) continue;   // an arch is just a way through
    const [a, b] = d.s === 'n' ? [P(d.x, d.y), P(d.x + 1, d.y)] : [P(d.x, d.y), P(d.x, d.y + 1)];
    out.push(d.k === 'wall' ? { a, b, kind } : { a, b, kind, locked: d.k === 'locked', door: d.x + ',' + d.y + d.s });
  }
  return out;
}

// ───────── rooms: floor split up by its doors (for numbering a hand-drawn plan) ─────────
function regions(p) {
  const w = p.grid ? p : unpack(p), id = new Int32Array(w.cols * w.rows).fill(-1), out = [];
  const doorAt = new Set(w.doors.filter(d => d.k !== 'arch').map(d => d.x + ',' + d.y + d.s));
  for (let i = 0; i < id.length; i++) {
    if (id[i] >= 0 || w.grid[i] === ROCK) continue;
    const r = out.length, cells = [], st = [i]; id[i] = r;
    while (st.length) {
      const j = st.pop(), x = j % w.cols, y = (j / w.cols) | 0; cells.push(j);
      for (const [dx, dy, key] of [[1, 0, (x + 1) + ',' + y + 'w'], [-1, 0, x + ',' + y + 'w'], [0, 1, x + ',' + (y + 1) + 'n'], [0, -1, x + ',' + y + 'n']]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w.cols || ny >= w.rows) continue;
        const k = ny * w.cols + nx; if (id[k] >= 0 || w.grid[k] === ROCK || doorAt.has(key)) continue;
        id[k] = r; st.push(k);
      }
    }
    out.push(cells);
  }
  return { id, list: out };
}

// ───────── a seeded random ─────────
function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = list => list[Math.floor(r() * list.length)];
  r.chance = p => r() < p;
  r.shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  return r;
}

// ───────── the dungeon generator ─────────
// opts: { seed, kind: 'rooms' | 'caves' | 'mixed', size: 'small' | 'medium' | 'large', theme, density (0..1), loops (0..1), water (0..1), dark }
// what suits each kind of room: [size: 0 small, 1 middling, 2 big (-1 any); depth: 0 by the way in, 1 middling, 2 deep (-1 any)]
const TYPE_FIT = {
  crypt: [1, 2], ossuary: [1, 1], shrine: [1, 1], embalming: [0, 1], guardroom: [1, 0], treasury: [0, 2], collapsed: [-1, -1], flooded: [-1, -1],
  antechamber: [0, 0], nave: [2, 1], cells: [1, 1], library: [2, 1], refectory: [2, 1], vestry: [0, 1], well: [0, -1], scriptorium: [1, 1],
  barracks: [2, 0], armoury: [0, 0], mess: [2, 1], storeroom: [0, -1], kitchen: [1, 1], throne: [2, 2], forge: [1, 1], den: [1, -1], larder: [0, 1],
  midden: [0, -1], hoard: [1, 2], workings: [1, -1], office: [0, 1], cistern: [1, -1], junction: [0, -1], smugglers: [1, 1], laboratory: [1, 1],
  study: [0, 2], summoning: [1, 2], menagerie: [1, 1], vault: [0, 2], bedchamber: [1, 2], torture: [1, 2], warden: [0, 0], oubliette: [0, 2]
};
// returns { plan, rooms: [{ n, x, y, w, h, type, text }], lights: [{ x, y }] (in squares), name, intro, theme }
const SIZES = { small: [32, 24, 6], medium: [48, 34, 11], large: [66, 46, 18] };
const THEMES = {
  tomb: { name: ['Tomb', 'Crypt', 'Barrow', 'Sepulchre', 'Catacombs', 'Ossuary'], who: 'the dead',
    rooms: ['crypt', 'crypt', 'ossuary', 'shrine', 'embalming', 'guardroom', 'treasury', 'collapsed', 'flooded', 'antechamber'] },
  temple: { name: ['Temple', 'Sanctum', 'Shrine', 'Chapel', 'Undercroft', 'Monastery'], who: 'a forgotten order',
    rooms: ['shrine', 'nave', 'cells', 'library', 'refectory', 'vestry', 'well', 'crypt', 'scriptorium', 'treasury'] },
  stronghold: { name: ['Keep', 'Hold', 'Bastion', 'Redoubt', 'Fortress', 'Garrison'], who: 'soldiers long gone',
    rooms: ['barracks', 'guardroom', 'armoury', 'mess', 'storeroom', 'kitchen', 'cells', 'throne', 'well', 'forge'] },
  lair: { name: ['Lair', 'Den', 'Warren', 'Hollow', 'Nest', 'Roost'], who: 'something hungry',
    rooms: ['den', 'larder', 'midden', 'den', 'hoard', 'collapsed', 'flooded', 'shrine', 'cells', 'storeroom'] },
  mine: { name: ['Mine', 'Delve', 'Diggings', 'Workings', 'Quarry', 'Shaft'], who: 'miners who dug too deep',
    rooms: ['workings', 'workings', 'storeroom', 'forge', 'barracks', 'collapsed', 'flooded', 'shrine', 'office', 'hoard'] },
  sewer: { name: ['Sewers', 'Cisterns', 'Drains', 'Undercity', 'Culverts', 'Waterworks'], who: 'the city above',
    rooms: ['cistern', 'flooded', 'junction', 'den', 'storeroom', 'smugglers', 'midden', 'collapsed', 'shrine', 'office'] },
  wizard: { name: ['Tower Vaults', 'Laboratory', 'Sanctum', 'Observatory Cellars', 'Archive', 'Conservatory'], who: 'a wizard who never came back',
    rooms: ['laboratory', 'library', 'study', 'summoning', 'storeroom', 'menagerie', 'vault', 'bedchamber', 'scriptorium', 'well'] },
  prison: { name: ['Gaol', 'Oubliette', 'Dungeons', 'Prison', 'Pits', 'Stockade'], who: 'wardens and the forgotten',
    rooms: ['cells', 'cells', 'guardroom', 'torture', 'warden', 'kitchen', 'storeroom', 'oubliette', 'armoury', 'barracks'] }
};
const ADJ = ['Sunken', 'Drowned', 'Hollow', 'Black', 'Silent', 'Forgotten', 'Weeping', 'Ashen', 'Broken', 'Hidden', 'Shattered', 'Lantern', 'Iron', 'Salt', 'Bone', 'Ember', 'Gloaming', 'Rimed', 'Thorned', 'Pale'];
const NAMES = ['Aldric', 'Morwen', 'the Grey Abbot', 'Vashka', 'Ilsabet', 'the Nine', 'Korrin', 'Saint Hedda', 'Ottokar', 'the Ash King', 'Bryn', 'Ysolde', 'Malachar', 'the Weaver', 'Thane Roskild', 'Daro', 'Old Mother Gruel', 'Kestrel'];
const ROOM_TEXT = {
  entrance: ['A stair climbs to the surface. Old boot-prints in the dust point both ways.', 'The way in: a rubble-choked arch, its carvings chiselled away.'],
  exit: ['A stair winds further down into the dark. Cold air breathes up it.', 'A shaft drops away; a rotten rope ladder still hangs from an iron ring.'],
  crypt: ['Niches line the walls, most of them still occupied.', 'Stone coffins in rows. One lid has been pushed aside from within.'],
  ossuary: ['Skulls stacked to the ceiling in careful patterns; one gap where a skull is missing.', 'Bones sorted by kind: femurs here, ribs there, and something that is neither.'],
  shrine: ['A defaced idol and a bowl of old offerings, some of them recent.', 'Candles have burned down to stubs before a faceless statue.'],
  embalming: ['Stone slabs with drainage channels; jars of something that was once fragrant.', 'Hooks in the ceiling and a smell that never left.'],
  guardroom: ['An overturned table, a dice game left mid-throw.', 'Arrow slits look out over the corridor beyond.'],
  treasury: ['Strongboxes, most smashed open; one still locked.', 'Coin-dust on the floor and the outline of what used to stand here.'],
  collapsed: ['Half the ceiling has come down. Something glints under the rubble.', 'A cave-in has turned this room into a slope of broken stone.'],
  flooded: ['Black water, knee deep and still. Things move beneath it.', 'The floor has sunk into a cold pool; the ceiling drips.'],
  antechamber: ['Faded murals tell of a funeral procession.', 'Two statues face each other across the room, swords crossed.'],
  nave: ['Columns march toward an altar under a cracked dome.', 'Pews of rotten wood face a raised altar.'],
  cells: ['A row of narrow cells with iron doors, some bent outward.', 'Straw pallets, chains, and scratched tallies on the walls.'],
  library: ['Shelves of swollen, mouldering books. A few are worth a fortune.', 'A reading desk with a book still open, its page marked in blood.'],
  refectory: ['Long tables and benches; bowls set out for a meal never eaten.', 'A lectern for readings during meals; the book is missing.'],
  vestry: ['Robes hang on pegs, moth-eaten and stiff.', 'A chest of ceremonial vestments and a silver censer.'],
  well: ['A deep well with a winch; the rope has been cut.', 'Water can be heard far below a stone well-head.'],
  scriptorium: ['Writing desks, dried inkwells, and a half-copied scroll.', 'Scraps of vellum cover the floor, every one bearing the same word.'],
  barracks: ['Rows of bunks, footlockers, and a cold stove.', 'Bedrolls and kit, abandoned in a hurry.'],
  armoury: ['Racks of rusted weapons; a few blades still keen.', 'Empty weapon racks and an iron-bound chest.'],
  mess: ['Trestle tables and a cold hearth.', 'Tankards and plates, as if the garrison just stepped out.'],
  storeroom: ['Crates and barrels, most rotten, some sealed.', 'Sacks of grain gone to dust; something has nested in them.'],
  kitchen: ['A great hearth, hanging pots and a butcher\'s block.', 'Spoiled stores and a pantry door, barred from inside.'],
  throne: ['A high seat on a dais, flanked by pillars.', 'A throne of black stone. Whoever sat here was not human.'],
  forge: ['An anvil, a cold forge and tools hung in their places.', 'Slag heaps and a quenching trough of oily water.'],
  den: ['Bones and filth; the smell of a large animal.', 'A nest of rags, hides and stolen trinkets.'],
  larder: ['Carcasses hang from hooks, some of them not animals.', 'Gnawed bones piled in a corner.'],
  midden: ['A reeking pile of refuse, crawling with vermin.', 'Waste and broken things heaped against one wall.'],
  hoard: ['Coins and plunder heaped in a hollow, guarded.', 'A mound of treasure, half buried in bones.'],
  workings: ['Pick-marks on the walls and a seam of ore, half worked.', 'Mine carts on a rusted track and a pile of spoil.'],
  office: ['A clerk\'s desk, ledgers and a strongbox.', 'Maps of the tunnels pinned to the walls, one marked in red.'],
  cistern: ['A great tank of still water, a walkway around its edge.', 'Water pours from a culvert into a deep basin.'],
  junction: ['Channels meet here in a churning pool.', 'Four tunnels cross; the walls bear smugglers\' chalk marks.'],
  smugglers: ['Hidden stores of contraband behind a false wall.', 'Bunks, a card table and crates stamped with a merchant\'s seal.'],
  laboratory: ['Glassware, burners and a smell of sulphur.', 'A worktable crowded with alembics; something bubbles still.'],
  study: ['A desk buried in notes, all in a private cipher.', 'A comfortable chair, a cold pipe, and a portrait whose eyes follow you.'],
  summoning: ['A circle inlaid in silver on the floor, one segment broken.', 'Scorch marks radiate from a chalk diagram.'],
  menagerie: ['Cages, most empty, one rattling.', 'Pens and troughs, and claw marks on the bars.'],
  vault: ['A sealed door of runed iron.', 'A vault, its door ajar, its treasure guarded by a riddle.'],
  bedchamber: ['A four-poster bed and a wardrobe full of fine clothes.', 'A bedroom left as if its owner might return tonight.'],
  torture: ['A rack, irons, and a brazier long cold.', 'Instruments laid out neatly on a stained table.'],
  warden: ['The warden\'s quarters: a ledger of prisoners, some names crossed out.', 'A desk, a cot and a ring of keys on a hook.'],
  oubliette: ['A grate in the floor over a dark pit.', 'A trapdoor, and something breathing below it.'],
  camp: ['A campfire still warm; bedrolls round it and packs against the rock.', 'Someone has made a camp here: a fire ring, a lean-to, and a lookout\'s perch.']
};
const SIGNS = ['', '', '', ' A tripwire crosses the doorway.', ' The floor here is trapped.', ' A monster waits here.', ' Something valuable is hidden here.', ' Faint whispers can be heard.', ' Fresh tracks lead through.', ' It is very cold here.'];
// ───────── furnishing: rooms you can read at a glance ─────────
// Each kind of room is laid out by a recipe made of set pieces placed against its walls or in its middle: a bed with
// its head to the wall, a chest at its foot and candles beside it; a desk with its chair; a bar with the barrels behind
// it; an altar on the far wall with pews facing it. Before anything goes down, a walkway is kept clear between the
// room's doorways (and to its middle), and nothing goes in a doorway or outside the room: corridors stay empty.
const FEAT_DEF = Object.fromEntries(FEATS.map(f => [f[0], f]));
const HUNG = new Set(['torch', 'lamp', 'banner', 'cobweb']);            // on the wall: in nobody's way
const DECAL = new Set(['bones', 'blood', 'rug', 'trapdoor']);          // on the floor: walked over
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];                          // north, east, south, west (a piece turned r has its back to DIRS[r])
function furnisher(w, R) {
  const cols = w.cols, rows = w.rows;
  const doorAt = new Map(w.doors.map(d => [d.x + ',' + d.y + d.s, d.k]));
  const edge = (x, y, d) => d === 1 ? doorAt.get((x + 1) + ',' + y + 'w') : d === 3 ? doorAt.get(x + ',' + y + 'w') : d === 2 ? doorAt.get(x + ',' + (y + 1) + 'n') : doorAt.get(x + ',' + y + 'n');
  const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const walk = i => { const v = w.grid[i]; return v !== ROCK && MATS[v] && MATS[v][3] === 'floor'; };
  const pass = (x, y, d) => { const k = edge(x, y, d); if (k === 'wall' || k === 'window' || k === 'bars') return false; const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; return inb(nx, ny) && w.grid[ny * cols + nx] !== ROCK; };
  const taken = new Set(), reserved = new Set(), hung = new Set(), rugs = new Set();
  const kindOf = k => HUNG.has(k) ? 'hung' : DECAL.has(k) ? 'decal' : 'solid';
  const foot = (k, x, y, r) => { const f = FEAT_DEF[k]; let fw = f[2], fh = f[3]; if (r % 2) [fw, fh] = [fh, fw]; const out = []; for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) out.push([xx, yy]); return out; };
  function fits(k, x, y, r, rm) {
    const kind = kindOf(k);
    for (const [xx, yy] of foot(k, x, y, r)) {
      if (!inb(xx, yy)) return false;
      const i = yy * cols + xx;
      if (rm && rm.cells && !rm.cells.has(i)) return false;
      if (!walk(i) || taken.has(i)) return false;
      if (kind === 'solid' && reserved.has(i)) return false;
      if (kind === 'hung' && (hung.has(i) || (rm && rm.entr && rm.entr.has(i)))) return false;
      if (kind === 'decal' && rugs.has(i)) return false;
    }
    return true;
  }
  function put(k, x, y, r, rm) {
    if (!FEAT_DEF[k] || !fits(k, x, y, r, rm)) return false;
    const kind = kindOf(k), f = FEAT_DEF[k];
    for (const [xx, yy] of foot(k, x, y, r)) (kind === 'solid' ? taken : kind === 'hung' ? hung : rugs).add(yy * cols + xx);
    const o = { k, x, y, w: f[2], h: f[3], r };
    if (k === 'rug') w.feats.unshift(o); else w.feats.push(o);   // (rugs under the rest)
    return true;
  }
  // a room: its squares, doorways, walls, the way through it kept clear, and which wall is the far one
  function room(o) {
    const cells = o.cells instanceof Set ? o.cells : new Set(o.cells), list = [...cells];
    const rm = { type: o.type, cave: !!o.cave, cells, list, entr: new Set(), spots: [] };
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    for (const i of list) { const x = i % cols, y = (i / cols) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    Object.assign(rm, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    for (const i of list) {
      const x = i % cols, y = (i / cols) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (pass(x, y, d)) { if (!cells.has(ny * cols + nx)) rm.entr.add(i); }
        else rm.spots.push({ x, y, d });
      }
    }
    const cx = x0 + (x1 - x0) / 2, cy = y0 + (y1 - y0) / 2;
    rm.mid = list.slice().sort((a, b) => Math.hypot(a % cols - cx, ((a / cols) | 0) - cy) - Math.hypot(b % cols - cx, ((b / cols) | 0) - cy))[0];
    const entr = [...rm.entr];
    rm.main = entr.length ? entr.sort((a, b) => Math.hypot(a % cols - cx, ((a / cols) | 0) - cy) - Math.hypot(b % cols - cx, ((b / cols) | 0) - cy)).pop() : rm.mid;
    // the far wall: the one you face coming in by the main doorway
    const dx = cx - rm.main % cols, dy = cy - ((rm.main / cols) | 0);
    rm.back = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    if (!entr.length) rm.back = rm.w >= rm.h ? 0 : 3;
    // the walkway: doorway to doorway (and to the middle), cleared
    const bfs = from => { const prev = new Map([[from, -1]]), q = [from]; while (q.length) { const c = q.shift(), x = c % cols, y = (c / cols) | 0; for (let d = 0; d < 4; d++) { if (!pass(x, y, d)) continue; const n = (y + DIRS[d][1]) * cols + x + DIRS[d][0]; if (cells.has(n) && !prev.has(n)) { prev.set(n, c); q.push(n); } } } return prev; };
    const keep = (prev, to) => { for (let c = to; c != null && c >= 0; c = prev.get(c)) reserved.add(c); };
    if (entr.length) {
      const prev = bfs(rm.main);
      for (const e of entr) keep(prev, e);
      for (const e of entr) {   // each doorway, and a step in from it
        reserved.add(e); const x = e % cols, y = (e / cols) | 0;
        for (let d = 0; d < 4; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1], n = ny * cols + nx; if (cells.has(n) && !pass(x, y, (d + 2) % 4) && pass(x, y, d)) reserved.add(n); }
        for (let d = 0; d < 4; d++) { const bx = x - DIRS[d][0], by = y - DIRS[d][1]; if (pass(x, y, d) && !cells.has((y + DIRS[d][1]) * cols + x + DIRS[d][0])) { const n = by * cols + bx; if (cells.has(n)) reserved.add(n); } }
      }
    }
    rm.wall = rm.spots.filter(s => !rm.entr.has(s.y * cols + s.x)).map(s => [s.x, s.y, s.d]);
    rm.room = rm;
    return rm;
  }
  // local frames: from a spot on a wall (u along the wall to the right as you face it, v out into the room)
  const toW = (s, u, v) => s.d === 0 ? [s.x + u, s.y + v] : s.d === 2 ? [s.x - u, s.y - v] : s.d === 1 ? [s.x - v, s.y + u] : [s.x + v, s.y - u];
  function plan1(s, it) {   // [k, u, v, turn] → { k, x, y, r }
    const [k, u, v, rr = 0] = it, f = FEAT_DEF[k]; if (!f) return null;
    const lu = rr % 2 ? f[3] : f[2], lv = rr % 2 ? f[2] : f[3];
    const a = toW(s, u, v), b = toW(s, u + lu - 1, v + lv - 1);
    return { k, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), r: (s.d + rr) % 4, opt: !!it[4] };
  }
  // a set piece at a spot: all its required pieces fit, or none goes down
  function set(s, items, rm) {
    const ps = items.map(it => plan1(s, it)).filter(Boolean);
    // dry run, required pieces only (they mustn't overlap each other either)
    const tmp = new Set();
    for (const p of ps) { if (p.opt) continue; if (!fits(p.k, p.x, p.y, p.r, rm)) return false; if (kindOf(p.k) === 'solid') for (const [xx, yy] of foot(p.k, p.x, p.y, p.r)) { const i = yy * cols + xx; if (tmp.has(i)) return false; tmp.add(i); } }
    for (const p of ps) put(p.k, p.x, p.y, p.r, rm);
    return true;
  }
  // the room seen from its doorway: (u, v) with the far wall at v 0
  function frame(rm) {
    const D = rm.back, bx = rm.x, by = rm.y, bw = rm.w, bh = rm.h;
    const ref = D === 0 ? { x: bx, y: by } : D === 2 ? { x: bx + bw - 1, y: by + bh - 1 } : D === 1 ? { x: bx + bw - 1, y: by } : { x: bx, y: by + bh - 1 };
    return { x: ref.x, y: ref.y, d: D, U: D % 2 ? bh : bw, V: D % 2 ? bw : bh };
  }
  const shift = (F, u, v) => { const [x, y] = toW(F, u, v); return { x, y, d: F.d }; };
  const near = (a, b, n) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < n;
  // helpers recipes use
  const api = {
    R, rm: null,
    // a set against the far wall, as near its middle as it will go
    back(items, width) {
      const rm = api.rm, F = frame(rm), wd = width || 1;
      const spots = rm.spots.filter(s => s.d === F.d).map(s => s).sort((a, b) => Math.abs(lu(F, a) + wd / 2 - F.U / 2) - Math.abs(lu(F, b) + wd / 2 - F.U / 2));
      for (const s of spots) { const o = Math.floor(wd / 2); const s2 = shift(s, -o, 0); if (set({ x: s2.x, y: s2.y, d: s.d }, items, rm)) return s; }
      return api.wall(items, 1, { prefer: 'far' }) ? true : null;
    },
    // a set against walls, n times, apart from each other
    wall(items, n, o) {
      const rm = api.rm; o = o || {};
      let spots = R.shuffle(rm.spots.filter(s => !rm.entr.has(s.y * cols + s.x)));
      if (o.prefer === 'far') { const m = rm.main; spots.sort((a, b) => (Math.abs(b.x - m % cols) + Math.abs(b.y - ((m / cols) | 0))) - (Math.abs(a.x - m % cols) + Math.abs(a.y - ((m / cols) | 0)))); }
      if (o.prefer === 'corner') spots.sort((a, b) => corner(b) - corner(a));
      if (o.side != null) spots = spots.filter(s => s.d === o.side);
      const done = [];
      for (const s of spots) { if (done.length >= n) break; if (o.gap && done.some(q => near(q, s, o.gap))) continue; if (set(s, items, rm)) done.push(s); }
      return done.length;
    },
    // a set in the middle, facing the far wall
    centre(items) {
      const rm = api.rm, F = frame(rm), x = rm.mid % cols, y = (rm.mid / cols) | 0;
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1]]) if (set({ x: x + dx, y: y + dy, d: F.d }, items, rm)) return true;
      return false;
    },
    // a unit tiled across the room in rows facing the far wall (aisles come from the walkway); a cramped room tries
    // again right up to its walls
    rows(unit, uw, vd, o) {
      o = o || {};
      const n = api.rows1(unit, uw, vd, o);
      return n || o.tight === false ? n : api.rows1(unit, uw, vd, Object.assign({}, o, { u0: 0, uEnd: 0, v0: Math.min(o.v0 == null ? 1 : o.v0, 1), vEnd: 0 }));
    },
    rows1(unit, uw, vd, o) {
      const rm = api.rm, F = frame(rm);
      let n = 0;
      for (let v = o.v0 == null ? 1 : o.v0; v + vd <= F.V - (o.vEnd == null ? 1 : o.vEnd); v += vd + (o.vGap == null ? 1 : o.vGap))
        for (let u = o.u0 == null ? 1 : o.u0; u + uw <= F.U - (o.uEnd == null ? 1 : o.uEnd); u += uw + (o.uGap == null ? 1 : o.uGap)) { if (o.max && n >= o.max) return n; if (set(shift(F, u, v), unit, rm)) n++; }
      return n;
    },
    // along every wall, a piece after another (shelves round a library)
    line(k, o) {
      const rm = api.rm; o = o || {}; const f = FEAT_DEF[k]; let n = 0;
      for (const s of R.shuffle(rm.spots.slice())) { if (o.max && n >= o.max) break; if (set(s, [[k, 0, 0, 0]], rm)) n++; }
      return n;
    },
    // things heaped in corners and along walls (crates, barrels, sacks)
    heap(kinds, n) {
      const rm = api.rm; let k = 0;
      const spots = rm.spots.filter(s => !rm.entr.has(s.y * cols + s.x)).sort((a, b) => corner(b) - corner(a) || R() - 0.5);
      for (const s of spots) { if (k >= n) break; if (put(R.pick(kinds), s.x, s.y, R.int(0, 3), rm)) { k++; for (const [dx, dy] of R.shuffle(DIRS.slice()).slice(0, R.int(0, 2))) if (k < n && put(R.pick(kinds), s.x + dx, s.y + dy, R.int(0, 3), rm)) k++; } }
      return k;
    },
    // a few things anywhere clear
    scatter(k, n, where) {
      const rm = api.rm; let m = 0;
      const pool = where === 'wall' ? R.shuffle(rm.spots.slice()) : R.shuffle(rm.list.slice()).map(i => ({ x: i % cols, y: (i / cols) | 0, d: R.int(0, 3) }));
      for (const s of pool) { if (m >= n) break; if (put(k, s.x, s.y, where === 'wall' ? s.d : (FEAT_DEF[k][2] === FEAT_DEF[k][3] ? 0 : s.d), rm)) m++; }
      return m;
    },
    // pairs down the length of a hall (columns, statues)
    pairs(k, n) {
      const rm = api.rm, F = frame(rm); let m = 0;
      if (F.U < 5) return 0;
      for (let v = 1; v < F.V - 1 && m < n; v += 2) { const a = shift(F, 1, v), b = shift(F, F.U - 2, v); if (fits(k, a.x, a.y, F.d, rm) && fits(k, b.x, b.y, F.d, rm)) { put(k, a.x, a.y, F.d, rm); put(k, b.x, b.y, F.d, rm); m += 2; } }
      return m;
    },
    // a circle of something round the middle (candles round a summoning circle)
    ring(k, r, n) {
      const rm = api.rm, x = rm.mid % cols, y = (rm.mid / cols) | 0; let m = 0;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; if (put(k, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 0, rm)) m++; }
      return m;
    },
    put: (k, x, y, r) => put(k, x, y, r, api.rm),
    has: k => w.feats.some(f => f.k === k && api.rm.cells.has(f.y * cols + f.x)),
    size: () => api.rm.list.length, frame: () => frame(api.rm)
  };
  const lu = (F, s) => F.d === 0 ? s.x - F.x : F.d === 2 ? F.x - s.x : F.d === 1 ? s.y - F.y : F.y - s.y;
  const corner = s => { const rm = api.rm; let n = 0; for (let d = 0; d < 4; d++) if (!pass(s.x, s.y, d)) n++; return n; };
  return {
    room, put, fits, api, taken, reserved, pass,
    furnish(rm, recipe) { api.rm = rm; if (recipe) recipe(api, rm); api.rm = null; },
    // light for a room: torches (lanterns in a house) on its walls, two far apart in a big room; a brazier or candles if
    // no wall will take one. Only the drowned and fallen-in stay dark.
    light(rm, kind) {
      api.rm = rm;
      const lit = () => w.feats.filter(f => GLOW[f.k] && rm.cells.has(f.y * cols + f.x)), want = rm.list.length > 64 ? 2 : 1;
      if (rm.cave && !lit().length) api.scatter('campfire', 1);
      for (const s of R.shuffle(rm.wall.map(([x, y, d]) => ({ x, y, d })))) {
        const have = lit(); if (have.length >= want) break;
        if (have.some(f => Math.abs(f.x - s.x) + Math.abs(f.y - s.y) < Math.max(4, (rm.w + rm.h) / 2))) continue;
        put(kind, s.x, s.y, s.d, rm);
      }
      if (!lit().length) { const m = rm.mid; put('brazier', m % cols, (m / cols) | 0, 0, rm) || api.scatter(R.chance(0.5) ? 'brazier' : 'candles', 1); }
      if (!lit().length) for (const s of rm.spots) if (put(kind, s.x, s.y, s.d, rm)) break;   // any bit of wall at all
      api.rm = null;
    }
  };
}
// the set pieces
const P_BED = [['bed', 0, 0, 0], ['candles', 1, 0, 0, 1], ['chest', 0, 2, 0, 1]];
const P_BUNK = [['bunk', 0, 0, 0], ['chest', 0, 2, 0, 1]];
const P_DESK = [['desk', 0, 0, 0], ['chair', 0, 1, 2, 1], ['candles', 2, 0, 0, 1]];
const P_HEARTH = [['fireplace', 0, 0, 0], ['rug', 0, 1, 0, 1]];
const P_DINE = [['bench', 0, 0, 0], ['table', 0, 1, 0], ['bench', 0, 2, 2]];          // 2 wide, 3 deep
const P_ROUND = [['roundtable', 0, 0, 0], ['chair', -1, 0, 1, 1], ['chair', 2, 0, 3, 1], ['chair', 0, 2, 2, 1]];
const P_PEW = [['bench', 0, 0, 2]];
const P_BOOTH = [['table', 0, 0, 1], ['bench', -1, 0, 1], ['bench', 1, 0, 1]];   // a table end-on to the wall, a bench each side
// what each kind of room is made of
const RECIPES = {
  entrance: f => { f.back([['stairsup', 0, 0, 0]]) || f.wall([['stairsup', 0, 0, 0]], 1); f.pairs('statue', 2); f.scatter('rubble', f.R.int(0, 1)); },
  exit: f => { f.back([['stairsdown', 0, 0, 0]]) || f.wall([['stairsdown', 0, 0, 0]], 1); f.scatter('bones', f.R.int(0, 1)); },
  antechamber: f => { f.pairs('statue', 4); f.back([['banner', 0, 0, 0]]); },
  guardroom: f => { f.centre([['table', 0, 0, 0], ['chair', 0, -1, 0, 1], ['chair', 1, 1, 2, 1], ['chair', -1, 0, 1, 1]]); f.wall([['weaponrack', 0, 0, 0]], 1); f.wall([['bunk', 0, 0, 0]], f.size() > 30 ? 2 : 0, { gap: 3 }); },
  barracks: f => { f.wall(P_BUNK, Math.max(2, Math.floor(f.size() / 7)), { gap: 2 }); f.wall([['weaponrack', 0, 0, 0]], 1); f.centre([['table', 0, 0, 0]]); },
  armoury: f => { f.wall([['weaponrack', 0, 0, 0]], f.R.int(2, 4), { gap: 2 }); f.wall([['chest', 0, 0, 0]], 1, { prefer: 'corner' }); f.centre([['table', 0, 0, 0]]); },
  mess: f => { f.back(P_HEARTH, 2); f.rows(P_DINE, 2, 3, { uGap: 1 }) || f.centre(P_DINE) || f.wall(P_BOOTH, 2, { gap: 4 }); f.wall([['barrel', 0, 0, 0]], 2, { prefer: 'corner' }); },
  refectory: f => { f.rows(P_DINE, 2, 3, { uGap: 1 }) || f.centre(P_DINE); f.back([['counter', 0, 0, 0]], 3); },
  kitchen: f => { f.back([['fireplace', 0, 0, 0], ['cauldron', 0, 1, 0, 1]], 2); f.centre([['table', 0, 0, 0]]); f.wall([['shelf', 0, 0, 0]], 1); f.heap(['barrel', 'sack'], f.R.int(2, 4)); },
  storeroom: f => { f.heap(['crate', 'barrel', 'sack', 'crate'], Math.max(4, Math.floor(f.size() / 3))); f.wall([['shelf', 0, 0, 0]], 1); },
  larder: f => { f.heap(['barrel', 'sack', 'crate'], Math.max(3, Math.floor(f.size() / 4))); f.wall([['shelf', 0, 0, 0]], 1); },
  cellar: f => { f.wall([['stairsdown', 0, 0, 0]], 1, { prefer: 'corner' }); f.heap(['barrel', 'barrel', 'crate'], Math.max(4, Math.floor(f.size() / 3))); },
  smugglers: f => { f.heap(['crate', 'crate', 'barrel', 'sack'], f.R.int(4, 8)); f.centre([['table', 0, 0, 0], ['chair', 0, -1, 0, 1], ['chair', 1, 1, 2, 1]]); f.wall(P_BUNK, 1); },
  throne: f => { f.back([['throne', 0, 0, 0], ['banner', -1, 0, 0, 1], ['banner', 1, 0, 0, 1], ['rug', 0, 1, 0, 1]], 1); f.pairs('column', 8); f.pairs('brazier', 2); },
  treasury: f => { f.back([['statue', 0, 0, 0]]); f.wall([['chest', 0, 0, 0]], f.R.int(2, 4), { prefer: 'far' }); },
  vault: f => { f.pairs('statue', 2); f.back([['chest', 0, 0, 0], ['chest', 1, 0, 0, 1], ['chest', -1, 0, 0, 1]], 1); },
  hoard: f => { f.scatter('chest', f.R.int(1, 3)); f.scatter('bones', f.R.int(1, 3)); f.scatter('rubble', f.R.int(0, 2)); },
  library: f => { f.line('bookshelf', { max: Math.max(3, Math.floor(f.size() / 5)) }); f.centre(P_DESK.slice(0, 2)) || f.centre([['table', 0, 0, 0]]); f.scatter('rug', 1); },
  scriptorium: f => { f.rows([['desk', 0, 0, 0], ['chair', 0, 1, 2]], 2, 2, { uGap: 1 }); f.line('bookshelf', { max: 3 }); },
  study: f => { f.back(P_DESK, 2); f.wall([['bookshelf', 0, 0, 0]], 2, { gap: 3 }); f.scatter('rug', 1); f.scatter('plant', 1, 'wall'); },
  office: f => { f.back(P_DESK, 2); f.wall([['bookshelf', 0, 0, 0]], 1); f.wall([['chest', 0, 0, 0]], 1, { prefer: 'corner' }); },
  laboratory: f => { f.centre([['table', 0, 0, 0]]); f.wall([['cauldron', 0, 1, 0]], 1); f.wall([['bookshelf', 0, 0, 0]], 1); f.wall([['shelf', 0, 0, 0]], 2, { gap: 3 }); f.scatter('candles', 1); },
  summoning: f => { f.centre([['altar', 0, 0, 0]]) || f.centre([['pit', 0, 0, 0]]); f.ring('candles', 2, 6); f.wall([['brazier', 0, 0, 0]], 2, { prefer: 'corner' }); },
  shrine: f => { f.back([['altar', 0, 0, 0], ['candles', -1, 0, 0, 1], ['candles', 2, 0, 0, 1]], 2); f.pairs('brazier', 2); f.rows(P_PEW, 2, 1, { v0: 3, max: 4 }); },
  chapel: f => { f.back([['altar', 0, 0, 0], ['candles', -1, 0, 0, 1], ['candles', 2, 0, 0, 1]], 2); f.rows(P_PEW, 2, 1, { v0: 2, uGap: 1 }); },
  nave: f => { f.back([['altar', 0, 0, 0], ['candles', -1, 0, 0, 1], ['candles', 2, 0, 0, 1]], 2); f.pairs('column', 8); f.rows(P_PEW, 2, 1, { v0: 3, u0: 2, uEnd: 2, uGap: 1 }); },
  vestry: f => { f.wall([['wardrobe', 0, 0, 0]], 2, { gap: 3 }); f.wall([['chest', 0, 0, 0]], 1); f.centre([['table', 0, 0, 0]]); },
  crypt: f => { f.rows([['sarcophagus', 0, 0, 0]], 1, 2, { uGap: 1, vGap: 1 }); f.back([['candles', 0, 0, 0]]); },
  ossuary: f => { f.wall([['coffin', 0, 0, 0]], f.R.int(2, 4), { gap: 2 }); f.scatter('bones', f.R.int(2, 4)); },
  embalming: f => { f.rows([['table', 0, 0, 1]], 1, 2, { uGap: 2, max: 3 }); f.wall([['shelf', 0, 0, 0]], 2, { gap: 3 }); f.scatter('cauldron', 1); },
  cells: f => { f.wall([['cage', 0, 0, 0]], Math.max(2, Math.floor(f.size() / 6)), { gap: 2 }); f.scatter('bones', 1); },
  torture: f => { f.centre([['table', 0, 0, 0]]); f.wall([['cage', 0, 0, 0]], 2, { gap: 2 }); f.scatter('brazier', 1); f.scatter('blood', 2); },
  warden: f => { f.back(P_DESK, 2); f.wall(P_BED, 1); },
  oubliette: f => { f.centre([['pit', 0, 0, 0]]); f.scatter('bones', 1); },
  forge: f => { f.back([['fireplace', 0, 0, 0], ['anvil', 0, 2, 0], ['barrel', 2, 2, 0, 1]], 2); f.wall([['weaponrack', 0, 0, 0]], 1); f.wall([['table', 0, 0, 0]], 1); },
  workshop: f => { f.wall([['desk', 0, 0, 0], ['chair', 0, 1, 2, 1]], 1); f.centre([['table', 0, 0, 0]]); f.wall([['shelf', 0, 0, 0]], 2, { gap: 3 }); },
  workings: f => { f.scatter('rubble', f.R.int(1, 3)); f.heap(['crate'], f.R.int(1, 2)); f.scatter('cart', f.R.chance(0.4) ? 1 : 0); },
  well: f => { f.centre([['well', 0, 0, 0]]); f.scatter('barrel', 1, 'wall'); },
  cistern: () => {}, flooded: () => {}, junction: f => { f.scatter('rubble', f.R.int(0, 1)); },
  collapsed: f => { f.scatter('rubble', Math.max(2, Math.floor(f.size() / 6))); f.scatter('boulder', f.R.int(0, 2)); },
  den: f => { f.scatter('bones', f.R.int(2, 4)); f.scatter('rug', 1); f.scatter('sack', 1, 'wall'); },
  camp: f => { f.centre([['campfire', 0, 0, 0]]); f.ring('rug', 2, 3); f.scatter('tent', f.size() > 40 ? 1 : 0); f.heap(['sack', 'crate'], f.R.int(1, 3)); f.scatter('log', 1); },
  midden: f => { f.scatter('rubble', f.R.int(2, 4)); f.scatter('bones', f.R.int(1, 3)); },
  menagerie: f => { f.wall([['cage', 0, 0, 0]], f.R.int(3, 5), { gap: 2 }); f.scatter('haybale', 1); },
  bedchamber: f => { f.back([['bed', 0, 0, 0], ['candles', 1, 0, 0, 1], ['candles', -1, 0, 0, 1], ['chest', 0, 2, 0, 1]], 1); f.wall([['wardrobe', 0, 0, 0]], 1); f.scatter('rug', 1); f.wall([['desk', 0, 0, 0], ['chair', 0, 1, 2, 1]], f.size() > 24 ? 1 : 0); },
  // buildings
  common: f => { f.back([['shelf', 0, 0, 0], ['barrel', 2, 0, 0, 1], ['counter', 0, 2, 2]], 3) || f.wall([['counter', 0, 0, 0]], 1); f.wall(P_HEARTH, 1, { prefer: 'far' });
    f.wall(P_BOOTH, Math.max(1, Math.floor(f.size() / 18)), { gap: 4 }); f.rows(P_ROUND, 2, 2, { v0: 3, uGap: 2, u0: 2, tight: false }) || f.rows(P_DINE, 2, 3, { v0: 3, uGap: 1 }); f.scatter('chair', f.R.int(1, 2)); },
  hall: f => { f.wall(P_HEARTH, 1, { prefer: 'far' }); f.centre([['table', 0, 0, 0], ['chair', 0, -1, 0, 1], ['chair', 1, 1, 2, 1]]); f.wall([['shelf', 0, 0, 0]], 1); },
  greathall: f => { f.back([['throne', 0, 0, 0], ['banner', -1, 0, 0, 1], ['banner', 1, 0, 0, 1]], 1); f.wall(P_HEARTH, 1, { gap: 4 }); f.rows(P_DINE, 2, 3, { v0: 3, uGap: 2 }); },
  bedroom: f => { f.wall(P_BED, f.size() > 20 ? 2 : 1, { gap: 2 }); f.wall([['wardrobe', 0, 0, 0]], 1); f.scatter('rug', f.R.chance(0.5) ? 1 : 0); },
  priest: f => { f.wall(P_BED, 1); f.back(P_DESK, 2); f.wall([['bookshelf', 0, 0, 0]], 1); },
  shopfront: f => { f.back([['shelf', 0, 0, 0], ['shelf', 2, 0, 0, 1], ['counter', 0, 2, 2]], 3) || f.wall([['counter', 0, 0, 0]], 1); f.wall([['shelf', 0, 0, 0]], 2, { gap: 3 }); f.heap(['crate', 'barrel'], 2); }
};
// dressing: the small things that say what happened here
function dress(f, rm, themeKey) {
  const R = f.R, t = rm.type;
  const grim = ['tomb', 'lair', 'prison'].includes(themeKey) || ['crypt', 'ossuary', 'den', 'larder', 'torture', 'oubliette', 'cells', 'midden'].includes(t);
  if (grim) f.scatter('bones', R.int(0, 2));
  if (R.chance(themeKey === 'tomb' || themeKey === 'lair' ? 0.6 : 0.3)) f.wall([['cobweb', 0, 0, 0]], R.int(1, 2), { prefer: 'corner' });
  if (['torture', 'den', 'larder'].includes(t) || (grim && R.chance(0.2))) f.scatter('blood', 1);
  if (['throne', 'guardroom', 'barracks', 'nave', 'antechamber'].includes(t)) f.wall([['banner', 0, 0, 0]], R.int(1, 2), { gap: 4 });
}

function generate(opts) {
  opts = opts || {};
  if (opts.kind === 'building') return genBuilding(opts);
  const seed = String(opts.seed || Math.random().toString(36).slice(2, 10));
  const R = rng(seed);
  const kind = ['rooms', 'caves', 'mixed'].includes(opts.kind) ? opts.kind : 'rooms';
  const [cols, rows, nRooms] = SIZES[opts.size] || SIZES.medium;
  const themeKey = THEMES[opts.theme] ? opts.theme : R.pick(Object.keys(THEMES));
  const theme = THEMES[themeKey];
  const density = opts.density == null ? 0.5 : +opts.density, loops = opts.loops == null ? 0.25 : +opts.loops, waterAmt = opts.water == null ? 0.3 : +opts.water;
  const w = { cols, rows, grid: new Uint8Array(cols * rows), doors: [], feats: [], labels: [], style: Object.assign({}, STYLE), seed };
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < cols && y < rows) w.grid[y * cols + x] = v; };
  const roomAt = new Int16Array(cols * rows).fill(-1);
  const rooms = [];
  // ── rooms and corridors ──
  if (kind !== 'caves') {
    const want = Math.round(nRooms * (0.6 + density * 0.8)) - (kind === 'mixed' ? 3 : 0);
    for (let tries = 0; tries < want * 60 && rooms.length < want; tries++) {
      const big = R.chance(0.18);
      const rw = big ? R.int(6, 11) : R.int(3, 7), rh = big ? R.int(5, 9) : R.int(3, 6);
      const x = R.int(2, cols - rw - 2), y = R.int(2, rows - rh - 2);
      if (x < 1 || y < 1) continue;
      if (rooms.some(r => x < r.x + r.w + 2 && x + rw + 2 > r.x && y < r.y + r.h + 2 && y + rh + 2 > r.y)) continue;
      const shape = big && R.chance(0.3) ? 'round' : big && R.chance(0.25) ? 'cross' : 'rect';
      rooms.push({ x, y, w: rw, h: rh, shape });
    }
    rooms.forEach((r, i) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (r.shape === 'round') { const dx = (x + 0.5 - r.x - r.w / 2) / (r.w / 2), dy = (y + 0.5 - r.y - r.h / 2) / (r.h / 2); if (dx * dx + dy * dy > 1.05) continue; }
        if (r.shape === 'cross') { const inX = x >= r.x + Math.floor(r.w / 3) && x < r.x + r.w - Math.floor(r.w / 3), inY = y >= r.y + Math.floor(r.h / 3) && y < r.y + r.h - Math.floor(r.h / 3); if (!inX && !inY) continue; }
        set(x, y, FLOOR); roomAt[y * cols + x] = i;
      }
    });
    // connect: a spanning tree over the rooms, plus a few loops
    const cx = r => Math.floor(r.x + r.w / 2), cy = r => Math.floor(r.y + r.h / 2);
    const dist = (a, b) => Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b));
    const edges = [], inTree = new Set([0]);
    while (inTree.size < rooms.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < rooms.length; j++) if (!inTree.has(j)) { const d = dist(rooms[i], rooms[j]); if (!best || d < best[2]) best = [i, j, d]; }
      if (!best) break;
      edges.push(best); inTree.add(best[1]);
    }
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      if (edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i))) continue;
      if (dist(rooms[i], rooms[j]) < 22 && R.chance(loops * 0.35)) edges.push([i, j, 0]);
    }
    const doorWanted = new Map();   // edge key → { x, y, s }
    for (const [i, j] of edges) {
      const a = rooms[i], b = rooms[j];
      let x = cx(a), y = cy(a); const tx = cx(b), ty = cy(b);
      const path = [[x, y]];
      const horizFirst = R.chance(0.5);
      const stepTo = (axis) => { if (axis === 'x') while (x !== tx) { x += Math.sign(tx - x); path.push([x, y]); } else while (y !== ty) { y += Math.sign(ty - y); path.push([x, y]); } };
      if (horizFirst) { stepTo('x'); stepTo('y'); } else { stepTo('y'); stepTo('x'); }
      for (let k = 0; k < path.length; k++) {
        const [px, py] = path[k]; set(px, py, FLOOR);
        if (k) {   // where the corridor crosses a room's edge: a door, maybe
          const [qx, qy] = path[k - 1], ra = roomAt[qy * cols + qx], rb = roomAt[py * cols + px];
          if ((ra >= 0) !== (rb >= 0)) {
            const d = px !== qx ? { x: Math.max(px, qx), y: py, s: 'w' } : { x: px, y: Math.max(py, qy), s: 'n' };
            doorWanted.set(d.x + ',' + d.y + d.s, d);
          }
        }
      }
    }
    // a door only where the corridor is one square wide (walls both sides of it)
    for (const d of doorWanted.values()) {
      const corr = d.s === 'w' ? (roomAt[d.y * cols + d.x - 1] >= 0 ? [d.x, d.y] : [d.x - 1, d.y]) : (roomAt[(d.y - 1) * cols + d.x] >= 0 ? [d.x, d.y] : [d.x, d.y - 1]);
      const narrow = d.s === 'w' ? !open(w, corr[0], corr[1] - 1) && !open(w, corr[0], corr[1] + 1) : !open(w, corr[0] - 1, corr[1]) && !open(w, corr[0] + 1, corr[1]);
      if (!narrow || R.chance(0.15)) continue;
      const roll = R();
      d.k = roll < 0.09 ? 'secret' : roll < 0.2 ? 'locked' : roll < 0.34 ? 'arch' : roll < 0.38 ? 'bars' : 'door';
      w.doors.push(d);
    }
  }
  // ── caves ──
  if (kind !== 'rooms') {
    let cave = new Uint8Array(cols * rows);
    const x0 = kind === 'mixed' ? Math.floor(cols * (R.chance(0.5) ? 0 : 0.5)) : 0, x1 = kind === 'mixed' ? x0 + Math.floor(cols * 0.5) : cols;
    for (let y = 1; y < rows - 1; y++) for (let x = Math.max(1, x0); x < Math.min(cols - 1, x1); x++) cave[y * cols + x] = R.chance(0.47 + density * 0.06) ? 1 : 0;
    for (let it = 0; it < 5; it++) {
      const nx = new Uint8Array(cols * rows);
      for (let y = 1; y < rows - 1; y++) for (let x = Math.max(1, x0); x < Math.min(cols - 1, x1); x++) {
        let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && cave[(y + dy) * cols + x + dx]) n++;
        nx[y * cols + x] = n >= 5 || (n >= 4 && cave[y * cols + x]) ? 1 : 0;
      }
      cave = nx;
    }
    for (let i = 0; i < cave.length; i++) if (cave[i]) w.grid[i] = FLOOR;
    // a mixed dungeon: a tunnel from the caves to the nearest room
    if (kind === 'mixed' && rooms.length) {
      let best = null;
      for (let i = 0; i < cave.length; i++) if (cave[i]) { const x = i % cols, y = (i / cols) | 0; for (const r of rooms) { const d = Math.abs(x - (r.x + r.w / 2)) + Math.abs(y - (r.y + r.h / 2)); if (!best || d < best.d) best = { d, x, y, r }; } }
      if (best) { let x = best.x, y = best.y; const tx = Math.floor(best.r.x + best.r.w / 2), ty = Math.floor(best.r.y + best.r.h / 2); while (x !== tx) { x += Math.sign(tx - x); set(x, y, FLOOR); } while (y !== ty) { y += Math.sign(ty - y); set(x, y, FLOOR); } }
    }
  }
  // keep the biggest connected stretch of floor; anything cut off goes
  {
    const lab = new Int32Array(cols * rows).fill(-1); let bestId = -1, bestN = 0;
    for (let i = 0, c = 0; i < lab.length; i++) {
      if (lab[i] >= 0 || w.grid[i] === ROCK) continue;
      let n = 0; const st = [i]; lab[i] = c;
      while (st.length) { const j = st.pop(); n++; const x = j % cols, y = (j / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue; const k = ny * cols + nx; if (lab[k] < 0 && w.grid[k] !== ROCK) { lab[k] = c; st.push(k); } } }
      if (n > bestN) { bestN = n; bestId = c; } c++;
    }
    for (let i = 0; i < lab.length; i++) if (w.grid[i] !== ROCK && lab[i] !== bestId) { w.grid[i] = ROCK; roomAt[i] = -1; }
  }
  // cave areas count as rooms too: spread-out points over the cave floor, each square to its nearest
  const areas = rooms.map((r, i) => ({ i, x: r.x, y: r.y, w: r.w, h: r.h, cells: [] }));
  for (let i = 0; i < roomAt.length; i++) if (roomAt[i] >= 0 && w.grid[i] !== ROCK) areas[roomAt[i]].cells.push(i);
  if (kind !== 'rooms') {
    const caveCells = []; for (let i = 0; i < w.grid.length; i++) if (w.grid[i] !== ROCK && roomAt[i] < 0) caveCells.push(i);
    const k = Math.max(2, Math.round(caveCells.length / 70)), seeds = [];
    for (let t = 0; t < k && caveCells.length; t++) {
      let best = null, bestD = -1;
      for (let s = 0; s < 40; s++) { const c = R.pick(caveCells), x = c % cols, y = (c / cols) | 0; const d = seeds.length ? Math.min(...seeds.map(q => Math.hypot(q[0] - x, q[1] - y))) : 1; if (d > bestD) { bestD = d; best = [x, y]; } }
      seeds.push(best);
    }
    const base = areas.length;
    seeds.forEach((s, t) => areas.push({ i: base + t, cave: true, cells: [] }));
    for (const c of caveCells) { const x = c % cols, y = (c / cols) | 0; let bi = 0, bd = 1e9; seeds.forEach((s, t) => { const d = (s[0] - x) ** 2 + (s[1] - y) ** 2; if (d < bd) { bd = d; bi = t; } }); areas[base + bi].cells.push(c); }
    for (const a of areas.slice(base)) {
      if (!a.cells.length) continue;
      let mx = 1e9, my = 1e9, Mx = -1, My = -1; for (const c of a.cells) { const x = c % cols, y = (c / cols) | 0; mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x); My = Math.max(My, y); }
      Object.assign(a, { x: mx, y: my, w: Mx - mx + 1, h: My - my + 1 });
    }
  }
  const live = areas.filter(a => a.cells.length >= 4);
  // ── what each room is ──
  // the entrance near an edge; the way on the furthest walk from it; the biggest room the theme's grandest; then each
  // room the kind that suits its size and how deep it lies (guards by the door, treasure at the back), caves their own
  const edgeD = a => Math.min(a.x, a.y, cols - a.x - a.w, rows - a.y - a.h);
  live.sort((a, b) => edgeD(a) - edgeD(b) || b.cells.length - a.cells.length);
  const entrance = live.find(a => !a.cave) || live[0];
  const walkD = new Int32Array(cols * rows).fill(-1);
  { const q = [entrance.cells[0]]; walkD[q[0]] = 0; while (q.length) { const c = q.shift(), x = c % cols, y = (c / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!open(w, nx, ny)) continue; const k = ny * cols + nx; if (walkD[k] < 0) { walkD[k] = walkD[c] + 1; q.push(k); } } } }
  for (const a of live) a.depth = Math.min(...a.cells.map(c => walkD[c] < 0 ? 1e6 : walkD[c]));
  const maxD = Math.max(1, ...live.map(a => a.depth < 1e6 ? a.depth : 0));
  const far = live.filter(a => a !== entrance).sort((a, b) => b.depth - a.depth)[0];
  for (const a of live) a.type = null;
  entrance.type = 'entrance'; if (far) far.type = 'exit';
  const grand = { tomb: 'crypt', temple: 'nave', stronghold: 'throne', lair: 'hoard', mine: 'workings', sewer: 'cistern', wizard: 'summoning', prison: 'guardroom' }[themeKey];
  const biggest = live.filter(a => !a.cave && !a.type).sort((a, b) => b.cells.length - a.cells.length)[0];
  if (biggest && grand) biggest.type = grand;
  const sizeOf = a => a.cells.length < 16 ? 0 : a.cells.length < 36 ? 1 : 2;
  const CAVE_TYPES = { lair: ['den', 'larder', 'hoard', 'camp', 'den'], mine: ['workings', 'camp', 'collapsed', 'workings'], tomb: ['ossuary', 'den', 'camp'], sewer: ['cistern', 'den', 'camp', 'midden'] }[themeKey] || ['den', 'camp', 'collapsed', 'den', 'camp'];
  let pool = [];
  for (const a of live.filter(q => !q.type).sort((p, q) => q.cells.length - p.cells.length)) {
    if (a.cave) { a.type = R.pick(CAVE_TYPES); continue; }
    if (!pool.length) pool = theme.rooms.filter(t => t !== grand && TYPE_FIT[t] && !TYPE_FIT[t][2]).concat(theme.rooms.filter(t => TYPE_FIT[t] && TYPE_FIT[t][2] === 0 && t !== grand));
    if (!pool.length) pool = theme.rooms.slice();
    const dn = a.depth >= 1e6 ? 0.5 : a.depth / maxD, sz = sizeOf(a);
    const score = t => { const f = TYPE_FIT[t] || [-1, -1]; const sm = f[0] < 0 ? 1 : 2 - Math.abs(f[0] - sz); const dm = f[1] < 0 ? 0.5 : f[1] === 0 ? 1 - dn * 1.6 : f[1] === 2 ? dn * 1.6 - 0.6 : 1 - Math.abs(dn - 0.5) * 2; return sm * 1.2 + dm + R() * 0.7; };
    const best = pool.slice().sort((p, q) => score(q) - score(p))[0];
    a.type = best; pool.splice(pool.indexOf(best), 1);
  }
  // ── water: pools in flooded rooms and caves, and some for the sewers ──
  const pond = (a, frac) => {
    if (!a.cells.length) return;
    const c0 = R.pick(a.cells), target = Math.round(a.cells.length * frac), wet = new Set([c0]), q = [c0];
    while (q.length && wet.size < target) { const j = q.splice(R.int(0, q.length - 1), 1)[0]; const x = j % cols, y = (j / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (y + dy) * cols + x + dx; if (a.cells.includes(k) && !wet.has(k)) { wet.add(k); q.push(k); } } }
    for (const k of wet) w.grid[k] = WATER;
  };
  for (const a of live) {
    if (a.type === 'flooded' || a.type === 'cistern') pond(a, 0.55 + R() * 0.3);
    else if (a.cave && R.chance(waterAmt * 0.5)) pond(a, 0.2 + R() * 0.3);
    else if (themeKey === 'sewer' && R.chance(waterAmt * 0.6)) pond(a, 0.25);
  }
  // ── furnishing: each room by its recipe, a clear way through it, nothing in the corridors ──
  const FN = furnisher(w, R);
  const rmList = live.map(a => FN.room({ type: a.type, cells: a.cells, cave: a.cave }));
  for (const rm of rmList) { FN.furnish(rm, RECIPES[rm.type]); FN.furnish(rm, f => dress(f, rm, themeKey)); }
  for (const rm of rmList) if (!['collapsed', 'flooded', 'cistern', 'oubliette', 'midden', 'junction'].includes(rm.type)) FN.light(rm, 'torch');
  // torches along the corridors, every so often
  if (kind !== 'caves') {
    const inArea = new Set(); for (const a of areas) for (const c of a.cells) inArea.add(c);
    const lit = [];
    for (let i = 0; i < w.grid.length && lit.length < 16; i++) {
      if (w.grid[i] !== FLOOR || inArea.has(i)) continue;
      const x = i % cols, y = (i / cols) | 0;
      if (lit.some(([lx, ly]) => Math.abs(lx - x) + Math.abs(ly - y) < 10)) continue;
      const r = !open(w, x, y - 1) ? 0 : !open(w, x + 1, y) ? 1 : !open(w, x, y + 1) ? 2 : !open(w, x - 1, y) ? 3 : -1;
      if (r >= 0 && R.chance(0.6) && FN.put('torch', x, y, r, null)) lit.push([x, y]);
    }
  }
  // chests, barrels and crates that can be opened, with what the room would keep in them
  const containers = opts.containers === false ? [] : lootUp(w, rmList, R, (k, x, y, r, rm) => FN.put(k, x, y, r, rm));
  // ── floors: each kind of room its own; caves in patches ──
  const TH = { tomb: ['flagstone', 'stone', 'rock'], temple: ['marble', 'stone', 'rock'], stronghold: ['flagstone', 'stone', 'rock'], lair: ['cave', 'rock', 'rock'],
    mine: ['gravel', 'rock', 'rock'], sewer: ['cobble', 'brick', 'rock'], wizard: ['tiles', 'stone', 'rock'], prison: ['flagstone', 'stone', 'rock'] }[themeKey] || ['flagstone', 'stone', 'rock'];
  w.style.floorMat = TH[0]; w.style.wallMat = kind === 'caves' ? 'rock' : TH[1]; w.style.outside = TH[2];
  w.style.render = opts.style === 'ink' ? 'ink' : 'painted';
  const ROOM_MAT = { library: 'planks', study: 'carpet', bedchamber: 'carpet', barracks: 'planks', mess: 'planks', refectory: 'planks', kitchen: 'tiles', shrine: 'marble', nave: 'marble',
    vault: 'marble', throne: 'marble', den: 'dirt', larder: 'dirt', midden: 'dirt', hoard: 'cave', workings: 'cave', collapsed: 'gravel', cistern: 'cobble', junction: 'mossy',
    smugglers: 'oldplanks', warden: 'oldplanks', office: 'planks', laboratory: 'tiles', scriptorium: 'planks', storeroom: 'oldplanks', menagerie: 'dirt', summoning: 'marble',
    oubliette: 'gravel', forge: 'cobble', embalming: 'tiles', antechamber: 'marble', vestry: 'planks', well: 'cobble', crypt: R.chance(0.4) ? 'marble' : null };
  for (const a of live) {
    let m = a.cave ? 'cave' : ROOM_MAT[a.type];
    if (!m || m === TH[0]) continue;
    for (const c of a.cells) if (w.grid[c] === FLOOR) w.grid[c] = MAT[m];
    if (a.cave) for (let t = 0; t < Math.max(1, a.cells.length / 40); t++) {   // patches of gravel and earth on a cave floor
      const pm = MAT[R.pick(['gravel', 'dirt', 'gravel', 'earth'])], q = [R.pick(a.cells)], seen = new Set(q), want = R.int(4, 14);
      while (q.length && seen.size < want) { const j = q.shift(); if (w.grid[j] === MAT.cave) w.grid[j] = pm; const x = j % cols, y = (j / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (y + dy) * cols + x + dx; if (a.cells.includes(k) && !seen.has(k) && R.chance(0.7)) { seen.add(k); q.push(k); } } }
    }
  }
  // the caves outside any room: cave floor too
  for (let i = 0; i < w.grid.length; i++) if (w.grid[i] === FLOOR && roomAt[i] < 0 && kind !== 'rooms' && !areas.some(a => !a.cave && a.cells.includes(i))) { const inCave = areas.some(a => a.cave && a.cells.includes(i)); if (inCave) w.grid[i] = MAT.cave; }
  // ── numbers, lights, words ──
  const out = [];
  live.sort((a, b) => (a === entrance ? -1 : b === entrance ? 1 : (a.y + a.h / 2) - (b.y + b.h / 2) || (a.x - b.x)));
  const featCells = new Set(); for (const f of w.feats) { const fw = f.r % 2 ? f.h : f.w, fh = f.r % 2 ? f.w : f.h; for (let y = f.y; y < f.y + fh; y++) for (let x = f.x; x < f.x + fw; x++) featCells.add(y * cols + x); }
  const covered = c => (featCells.has(c) ? 2 : 0) + (w.grid[c] === WATER ? 1 : 0);
  live.forEach((a, i) => {
    const n = i + 1;
    // the label on a free square near the middle
    const mx = a.x + a.w / 2 - 0.5, my = a.y + a.h / 2 - 0.5;
    const best = a.cells.filter(c => w.grid[c] !== ROCK).sort((p, q) => (covered(p) - covered(q)) || (Math.hypot(p % cols - mx, ((p / cols) | 0) - my) - Math.hypot(q % cols - mx, ((q / cols) | 0) - my)))[0];
    const lx = best % cols + 0.5, ly = ((best / cols) | 0) + 0.5;
    const texts = ROOM_TEXT[a.type] || ['An empty chamber.'];
    const text = R.pick(texts) + R.pick(SIGNS);
    w.labels.push({ n: String(n), x: lx, y: ly, t: TYPE_NAMES[a.type] || a.type, note: text });
    out.push({ n, x: a.x, y: a.y, w: a.w, h: a.h, type: a.type, text });
  });
  // trim the empty rock round the edge (two squares of margin), and move everything with it
  {
    let mx = cols, my = rows, Mx = -1, My = -1;
    for (let i = 0; i < w.grid.length; i++) if (w.grid[i] !== ROCK) { const x = i % cols, y = (i / cols) | 0; mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x); My = Math.max(My, y); }
    if (Mx >= 0) {
      const ox = Math.max(0, mx - 2), oy = Math.max(0, my - 2), nc = Math.min(cols, Mx + 3) - ox, nr = Math.min(rows, My + 3) - oy;
      const g2 = new Uint8Array(nc * nr);
      for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) g2[y * nc + x] = w.grid[(y + oy) * cols + x + ox];
      w.grid = g2; w.cols = nc; w.rows = nr;
      for (const list of [w.doors, w.feats, w.labels, out, containers]) for (const o of list) { o.x -= ox; o.y -= oy; }
    }
  }
  const name = `The ${R.pick(ADJ)} ${R.pick(theme.name)}${R.chance(0.6) ? ' of ' + R.pick(NAMES) : ''}`;
  const intro = `Built for ${theme.who}, now abandoned to the dark.`;
  return { plan: pack(w), rooms: out, lights: lightsOf(w), containers, name, intro, theme: themeKey, seed };
}
// ───────── buildings: a tavern, a house, a shop… rooms inside a rectangle, a yard round it ─────────
const BUILDINGS = {
  tavern: { walls: 'wood', floor: 'planks', rooms: ['common', 'kitchen', 'storeroom', 'bedroom', 'bedroom', 'bedroom', 'cellar'], big: 'common', name: () => null },
  house: { walls: 'plaster', floor: 'planks', rooms: ['hall', 'kitchen', 'bedroom', 'bedroom', 'storeroom'], big: 'hall' },
  shop: { walls: 'plaster', floor: 'planks', rooms: ['shopfront', 'workshop', 'storeroom', 'bedroom', 'kitchen'], big: 'shopfront' },
  manor: { walls: 'stone', floor: 'planks', rooms: ['greathall', 'library', 'study', 'bedchamber', 'bedchamber', 'kitchen', 'chapel', 'storeroom'], big: 'greathall' },
  chapel: { walls: 'stone', floor: 'flagstone', rooms: ['nave', 'vestry', 'priest', 'storeroom'], big: 'nave' },
  smithy: { walls: 'stone', floor: 'cobble', rooms: ['forge', 'storeroom', 'bedroom', 'kitchen'], big: 'forge' },
  guardhouse: { walls: 'stone', floor: 'flagstone', rooms: ['guardroom', 'barracks', 'armoury', 'cells', 'warden'], big: 'guardroom' }
};
const B_FURNISH = {
  common: [['fireplace', 1, 1, 'wall'], ['counter', 1, 1, 'wall'], ['roundtable', 2, 4, 'middle'], ['table', 1, 2, 'middle'], ['bench', 1, 3, 'middle'], ['barrel', 1, 3, 'wall'], ['candles', 0, 2, 'middle']],
  kitchen: [['fireplace', 1, 1, 'wall'], ['table', 1, 1, 'centre'], ['cauldron', 0, 1, 'middle'], ['barrel', 1, 3, 'wall'], ['shelf', 1, 2, 'wall'], ['sack', 0, 2, 'wall']],
  storeroom: [['crate', 2, 5, 'wall'], ['barrel', 2, 5, 'wall'], ['sack', 1, 3, 'wall']], cellar: [['stairsdown', 1, 1, 'wall'], ['barrel', 2, 5, 'wall'], ['crate', 1, 3, 'wall']],
  bedroom: [['bed', 1, 2, 'wall'], ['chest', 1, 1, 'wall'], ['wardrobe', 0, 1, 'wall'], ['rug', 0, 1, 'centre']],
  hall: [['fireplace', 1, 1, 'wall'], ['table', 1, 1, 'centre'], ['chair', 2, 4, 'middle'], ['rug', 0, 1, 'centre'], ['shelf', 0, 1, 'wall']],
  shopfront: [['counter', 1, 2, 'wall'], ['shelf', 2, 4, 'wall'], ['crate', 1, 2, 'wall'], ['barrel', 0, 2, 'wall']], workshop: [['desk', 1, 2, 'wall'], ['table', 1, 1, 'middle'], ['shelf', 1, 2, 'wall'], ['crate', 0, 2, 'wall']],
  greathall: [['table', 2, 3, 'rows'], ['fireplace', 1, 2, 'wall'], ['rug', 1, 1, 'centre'], ['banner', 1, 3, 'wall'], ['throne', 0, 1, 'wall']],
  library: [['bookshelf', 3, 6, 'wall'], ['desk', 1, 1, 'middle'], ['chair', 1, 2, 'middle'], ['rug', 0, 1, 'centre']], study: [['desk', 1, 1, 'middle'], ['bookshelf', 1, 3, 'wall'], ['chair', 1, 1, 'middle'], ['plant', 0, 1, 'wall']],
  bedchamber: [['bed', 1, 1, 'wall'], ['wardrobe', 1, 1, 'wall'], ['chest', 1, 1, 'wall'], ['rug', 1, 1, 'centre'], ['plant', 0, 1, 'wall']],
  chapel: [['altar', 1, 1, 'wall'], ['bench', 2, 4, 'rows'], ['candles', 1, 2, 'middle']], nave: [['altar', 1, 1, 'wall'], ['bench', 4, 10, 'rows'], ['column', 0, 4, 'pairs'], ['candles', 1, 3, 'middle']],
  vestry: [['wardrobe', 1, 2, 'wall'], ['chest', 1, 1, 'wall']], priest: [['bed', 1, 1, 'wall'], ['desk', 1, 1, 'middle'], ['bookshelf', 0, 1, 'wall']],
  forge: [['fireplace', 1, 1, 'wall'], ['anvil', 1, 2, 'middle'], ['barrel', 1, 2, 'wall'], ['weaponrack', 1, 2, 'wall'], ['table', 0, 1, 'middle']],
  guardroom: [['table', 1, 1, 'centre'], ['chair', 2, 4, 'middle'], ['weaponrack', 1, 2, 'wall'], ['banner', 0, 1, 'wall']], barracks: [['bunk', 2, 6, 'wall'], ['chest', 1, 3, 'wall']],
  armoury: [['weaponrack', 2, 4, 'wall'], ['chest', 1, 2, 'wall']], cells: [['bed', 1, 3, 'wall'], ['bones', 0, 1, 'middle']], warden: [['desk', 1, 1, 'middle'], ['bed', 1, 1, 'wall'], ['chest', 1, 1, 'wall']]
};
const B_MAT = { kitchen: 'tiles', storeroom: 'oldplanks', cellar: 'flagstone', chapel: 'marble', nave: 'flagstone', forge: 'cobble', cells: 'flagstone', greathall: null, library: 'carpet', bedchamber: 'carpet' };
const B_NAMES = { common: 'Common room', kitchen: 'Kitchen', storeroom: 'Storeroom', bedroom: 'Bedroom', cellar: 'Cellar stair', hall: 'Hall', shopfront: 'Shop', workshop: 'Workshop',
  greathall: 'Great hall', library: 'Library', study: 'Study', bedchamber: 'Bedchamber', chapel: 'Chapel', nave: 'Nave', vestry: 'Vestry', priest: 'Priest\'s room', forge: 'Forge',
  guardroom: 'Guardroom', barracks: 'Barracks', armoury: 'Armoury', cells: 'Cells', warden: 'Warden\'s room' };
const B_TEXT = {
  common: ['Smoke, noise and the smell of stew. A bard tunes up by the fire.', 'Long tables scarred by knives and dice; regulars watch newcomers over their mugs.'],
  kitchen: ['A cook works the spit and swears at the boy turning it.', 'Hams hang from the beams; a pot bubbles on the fire.'],
  storeroom: ['Casks, crates and sacks; one crate is not what its label says.', 'Supplies stacked to the rafters, and a trapdoor beneath a rug.'],
  cellar: ['A stair down to a cool cellar of ale casks.', 'Steps to the cellar; a cold draught comes up from below.'],
  bedroom: ['A narrow bed, a chest and a window that sticks.', 'A room for the night. The last guest left something under the bed.'],
  hall: ['The family\'s hall: a table, a hearth, a dog asleep beside it.', 'A modest hall with a fine old sword over the mantel.'],
  shopfront: ['Goods crowd the shelves; the shopkeeper watches every hand.', 'A bell over the door, a counter, prices chalked on a board.'],
  workshop: ['Tools hang in neat rows; a half-finished commission sits on the bench.', 'Shavings, sawdust and a project the owner won\'t talk about.'],
  greathall: ['Banners over a long table set for twenty; a fire you could stand in.', 'The lord\'s hall, its high seat on a dais under the family arms.'],
  library: ['Shelves to the ceiling and a ladder on rails.', 'A quiet room of books; one shelf is a door.'],
  study: ['Letters, ledgers and a locked drawer.', 'A desk, a map of the region and a decanter.'],
  bedchamber: ['A curtained bed and a wardrobe of fine clothes.', 'The master bedroom; the strongbox is under the floorboards.'],
  chapel: ['A small chapel, candles lit for the dead.', 'A family shrine to the household\'s god.'], nave: ['Pews before an altar; light falls through coloured glass.', 'A plain chapel, its altar cloth faded.'],
  vestry: ['Robes, censers and the collection box.', 'Vestments and the parish register.'], priest: ['The priest\'s cell: a cot, a desk, a hidden bottle.', 'Sparse and clean, a holy symbol over the bed.'],
  forge: ['The forge roars; the smith quenches a blade in a hiss of steam.', 'An anvil, a bellows and racks of finished work.'],
  guardroom: ['Off-duty guards at cards; a duty roster on the wall.', 'A table, a brazier and keys on a hook.'], barracks: ['Bunks and footlockers in a neat row.', 'Bedrolls, kit and a smell of boots.'],
  armoury: ['Spears, shields and crossbows on racks.', 'An armourer\'s bench and a locked case.'], cells: ['Barred cells, one occupied.', 'Straw, a bucket and chains.'], warden: ['The warden\'s cot and the prisoner ledger.', 'A desk with the keys to the cells.']
};
const PUB_A = ['Prancing', 'Drowsy', 'Laughing', 'Golden', 'Rusty', 'Crooked', 'Wandering', 'Silver', 'Salty', 'Merry', 'Black', 'Jolly', 'Sleeping', 'Howling', 'Green'];
const PUB_B = ['Stag', 'Goose', 'Dragon', 'Mermaid', 'Lantern', 'Anchor', 'Boar', 'Griffin', 'Kettle', 'Fiddler', 'Pony', 'Crown', 'Wyvern', 'Barrel', 'Owl'];
const KEEPERS = ['Old Tam', 'Widow Hesk', 'Bram Ostler', 'Marta Dunn', 'Gilles', 'Yeva', 'Fat Rolf', 'Silent Corin', 'Ada Brewer', 'Henrik'];
const TRAITS = ['who never forgets a face', 'who waters the ale', 'with a past in the army', 'who sells secrets on the side', 'who is deep in debt to someone dangerous', 'who knows every road for fifty miles', 'who keeps a crossbow under the counter', 'who is not what they seem'];
function genBuilding(opts) {
  const seed = String(opts.seed || Math.random().toString(36).slice(2, 10)), R = rng(seed);
  const key = BUILDINGS[opts.theme] ? opts.theme : R.pick(Object.keys(BUILDINGS)), B = BUILDINGS[key];
  const [bw, bh] = { small: [12, 9], medium: [18, 12], large: [26, 16] }[opts.size] || [18, 12];
  const margin = 4, cols = bw + margin * 2, rows = bh + margin * 2;
  const w = { cols, rows, grid: new Uint8Array(cols * rows).fill(MAT.grass), doors: [], feats: [], labels: [], style: Object.assign({}, STYLE, { render: opts.style === 'ink' ? 'ink' : 'painted', floorMat: B.floor, wallMat: B.walls, outside: 'grass' }), seed };
  const X0 = margin, Y0 = margin;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) w.grid[(Y0 + y) * cols + X0 + x] = FLOOR;
  // a path to the door and some cobbles in the yard
  // split the inside into rooms (each cut runs right across the part it splits)
  // split the inside into rooms: the biggest room is cut in two, again and again, until there are enough
  const minS = 3, want = { small: 4, medium: 6, large: 9 }[opts.size] || 6, rooms = [{ x: 0, y: 0, w: bw, h: bh }];
  for (let guard = 0; rooms.length < want && guard < 50; guard++) {
    let cand = rooms.map((r, i) => [r, i]).filter(([r]) => r.w >= minS * 2 || r.h >= minS * 2).sort((a, b) => b[0].w * b[0].h - a[0].w * a[0].h);
    if (cand.some(([r]) => !r.main)) cand = cand.filter(([r]) => !r.main || r.w * r.h > bw * bh * 0.4);   // the main room stays whole (a common room, a hall) while anything else can be cut
    if (!cand.length) break;
    const [r, i] = rooms.length === 1 ? cand[0] : cand[Math.min(cand.length - 1, R.chance(0.7) ? 0 : 1)];
    const vert = r.w >= minS * 2 && (r.h < minS * 2 || r.w > r.h * 1.15 || (r.w >= r.h * 0.85 && R.chance(0.5)));
    // the first cut leaves the main room big (about 3/5)
    const frac = rooms.length === 1 ? 0.55 + R() * 0.1 : 0.35 + R() * 0.3;
    const first = rooms.length === 1, flip = first && R.chance(0.5);   // (the main room on either side)
    let a, b;
    if (vert) { const k = Math.max(minS, Math.min(r.w - minS, Math.round(r.w * (flip ? 1 - frac : frac)))); a = { x: r.x, y: r.y, w: k, h: r.h }; b = { x: r.x + k, y: r.y, w: r.w - k, h: r.h }; }
    else { const k = Math.max(minS, Math.min(r.h - minS, Math.round(r.h * (flip ? 1 - frac : frac)))); a = { x: r.x, y: r.y, w: r.w, h: k }; b = { x: r.x, y: r.y + k, w: r.w, h: r.h - k }; }
    if (first || r.main) (a.w * a.h >= b.w * b.h ? a : b).main = true;
    rooms.splice(i, 1, a, b);
  }

  // the walls between rooms, and round the outside
  const wallE = new Set(), addWall = (x, y, s) => wallE.add(x + ',' + y + s);
  const roomOf = (x, y) => rooms.findIndex(r => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const r = roomOf(x, y);
    if (x === 0 || roomOf(x - 1, y) !== r) addWall(X0 + x, Y0 + y, 'w');
    if (y === 0 || roomOf(x, y - 1) !== r) addWall(X0 + x, Y0 + y, 'n');
    if (x === bw - 1) addWall(X0 + x + 1, Y0 + y, 'w');
    if (y === bh - 1) addWall(X0 + x, Y0 + y + 1, 'n');
  }
  // doors between neighbouring rooms: a tree, and a loop or two
  const shared = new Map();   // "a,b" → edge keys
  for (const e of wallE) {
    const [ex, ey, sd] = [parseInt(e), parseInt(e.split(',')[1]), e.slice(-1)];
    const lx = ex - X0, ly = ey - Y0, a = sd === 'w' ? roomOf(lx - 1, ly) : roomOf(lx, ly - 1), b = roomOf(lx, ly);
    if (a < 0 || b < 0 || a === b) continue;
    const k = Math.min(a, b) + ',' + Math.max(a, b); if (!shared.has(k)) shared.set(k, []); shared.get(k).push(e);
  }
  const linked = new Set([0]), pairs = [...shared.keys()];
  const joined = new Set();   // rooms joined by a door ("a,b")
  const doorOn = k => { joined.add(k); const es = shared.get(k).filter(e => { const [ex, ey] = [parseInt(e), parseInt(e.split(',')[1])], sd = e.slice(-1); return sd === 'w' ? !wallE.has(ex + ',' + ey + 'n') || true : true; }); const e = es[Math.floor(es.length / 2) + (es.length > 2 ? R.int(-1, 1) : 0)] || es[0]; wallE.delete(e); w.doors.push({ x: parseInt(e), y: parseInt(e.split(',')[1]), s: e.slice(-1), k: R.chance(0.15) ? 'arch' : 'door' }); };
  while (linked.size < rooms.length) {
    const k = R.shuffle(pairs.filter(k => { const [a, b] = k.split(',').map(Number); return linked.has(a) !== linked.has(b); }))[0];
    if (!k) break; const [a, b] = k.split(',').map(Number); linked.add(a); linked.add(b); doorOn(k); pairs.splice(pairs.indexOf(k), 1);
  }
  for (const k of pairs) if (R.chance(0.2)) doorOn(k);
  // the biggest room: the main one, with the front door; the rest by the building's list
  const order = rooms.map((r, i) => i).sort((a, b) => rooms[b].w * rooms[b].h - rooms[a].w * rooms[a].h);
  const types = new Array(rooms.length);
  types[order[0]] = B.big;
  // the rest where they belong: the kitchen off the main room, stores off the kitchen, bedrooms furthest in
  const nb = i => rooms.map((r, j) => j).filter(j => j !== i && joined.has(Math.min(i, j) + ',' + Math.max(i, j)));
  const hops = new Array(rooms.length).fill(99); { hops[order[0]] = 0; const q = [order[0]]; while (q.length) { const i = q.shift(); for (const j of nb(i)) if (hops[j] > hops[i] + 1) { hops[j] = hops[i] + 1; q.push(j); } } }
  const area = i => rooms[i].w * rooms[i].h, typeAt = t => types.findIndex(x => x === t);
  const NEAR = { kitchen: ['common', 'hall', 'greathall', 'mess'], storeroom: ['kitchen', 'shopfront', 'forge', 'common'], cellar: ['kitchen', 'storeroom', 'common'], workshop: ['shopfront', 'forge'],
    vestry: ['nave', 'chapel'], armoury: ['guardroom', 'barracks'], cells: ['guardroom', 'warden'], warden: ['cells', 'guardroom'], chapel: ['greathall'], library: ['study', 'greathall'], study: ['library'] };
  const DEEP = new Set(['bedroom', 'bedchamber', 'priest', 'warden', 'barracks', 'study']), SMALL = new Set(['storeroom', 'cellar', 'vestry', 'priest', 'warden', 'study', 'bedroom']);
  let restT = B.rooms.filter(t => t !== B.big);
  const EXTRA = { guardhouse: ['barracks', 'storeroom'], chapel: ['storeroom', 'priest'], smithy: ['storeroom', 'bedroom'], manor: ['bedchamber', 'storeroom', 'study'] }[key] || ['bedroom', 'storeroom'];
  for (let k = 0; restT.length < rooms.length - 1; k++) restT.push(EXTRA[k % EXTRA.length]);
  for (const t of restT.slice(0, rooms.length - 1)) {
    const free = rooms.map((r, i) => i).filter(i => types[i] == null); if (!free.length) break;
    const score = i => { let sc = R() * 0.6; for (const n of NEAR[t] || []) { const j = typeAt(n); if (j >= 0 && nb(i).includes(j)) sc += 3; }
      if (DEEP.has(t)) sc += Math.min(hops[i], 4) * 0.8; if (SMALL.has(t)) sc -= area(i) / 40; else sc += area(i) / 60; return sc; };
    types[free.sort((a, b) => score(b) - score(a))[0]] = t;
  }
  for (let i = 0; i < types.length; i++) if (types[i] == null) types[i] = 'storeroom';
  // front door: on the main room's outside wall, facing the longest stretch of yard (south first)
  const main = rooms[order[0]];
  const outer = [...wallE].filter(e => { const [ex, ey] = [parseInt(e), parseInt(e.split(',')[1])], sd = e.slice(-1), lx = ex - X0, ly = ey - Y0;
    const inMain = (x, y) => x >= main.x && y >= main.y && x < main.x + main.w && y < main.y + main.h;
    return sd === 'n' ? ((ly === 0 && inMain(lx, 0)) || (ly === bh && inMain(lx, bh - 1))) : ((lx === 0 && inMain(0, ly)) || (lx === bw && inMain(bw - 1, ly))); });
  const front = outer.sort((a, b) => (b.endsWith('n') && parseInt(b.split(',')[1]) === Y0 + bh ? 1 : 0) - (a.endsWith('n') && parseInt(a.split(',')[1]) === Y0 + bh ? 1 : 0))[Math.floor(R() * Math.min(3, outer.length))];
  let frontDoor = null;
  if (front) { wallE.delete(front); frontDoor = { x: parseInt(front), y: parseInt(front.split(',')[1]), s: front.slice(-1), k: 'door' }; w.doors.push(frontDoor); }
  // windows in the outside walls, now and then
  for (const e of [...wallE]) { const [ex, ey] = [parseInt(e), parseInt(e.split(',')[1])], sd = e.slice(-1), lx = ex - X0, ly = ey - Y0;
    const outside = sd === 'n' ? (ly === 0 || ly === bh) : (lx === 0 || lx === bw);
    if (outside && R.chance(0.12)) { wallE.delete(e); w.doors.push({ x: ex, y: ey, s: sd, k: 'window' }); } }
  for (const e of wallE) w.doors.push({ x: parseInt(e), y: parseInt(e.split(',')[1]), s: e.slice(-1), k: 'wall' });
  // furniture: each room by its recipe, a clear way between its doors
  const FN = furnisher(w, R), rmList = [], out = [];
  const place = (k, x, y, r, rm) => FN.put(k, x, y, r, rm && rm.cells ? rm : null);
  rooms.forEach((room, i) => {
    const t = types[i], cells = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) cells.push((Y0 + y) * cols + X0 + x);
    const rm = FN.room({ type: t, cells });
    FN.furnish(rm, RECIPES[t] || RECIPES.storeroom);
    FN.light(rm, 'lamp');
    const m = B_MAT[t]; if (m) for (const c of cells) w.grid[c] = MAT[m];
    const lx = X0 + room.x + room.w / 2, ly = Y0 + room.y + room.h / 2;
    const btext = R.pick(B_TEXT[t] || ['A room.']);
    w.labels.push({ n: String(i + 1), x: Math.floor(lx) + 0.5, y: Math.floor(ly) + 0.5, t: B_NAMES[t] || t, note: btext });
    out.push({ n: i + 1, x: X0 + room.x, y: Y0 + room.y, w: room.w, h: room.h, type: t, text: btext });
    rmList.push(rm);
  });
  // chests, barrels and crates that can be opened, with what the room would keep in them
  const containers = opts.containers === false ? [] : lootUp(w, rmList, R, place);
  // the yard: a path from the front door, trees and bushes, a cart, barrels by the walls
  if (frontDoor) { let x = frontDoor.x, y = frontDoor.y; const dir = frontDoor.s === 'n' ? (y === Y0 ? [0, -1] : [0, 1]) : (x === X0 ? [-1, 0] : [1, 0]); if (dir[1] === 1 || dir[0] === 1) { if (dir[1] === 1) y = frontDoor.y; else x = frontDoor.x; } else { x += dir[0]; y += dir[1]; }
    for (let k = 0; k < margin + 1; k++) { if (x >= 0 && y >= 0 && x < cols && y < rows && w.grid[y * cols + x] === MAT.grass) { w.grid[y * cols + x] = MAT.cobble; if (dir[0] === 0 && x + 1 < cols && w.grid[y * cols + x + 1] === MAT.grass) w.grid[y * cols + x + 1] = MAT.dirt; } x += dir[0]; y += dir[1]; } }
  const yard = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (w.grid[y * cols + x] === MAT.grass) yard.push([x, y]);
  const yRoom = { cells: new Set(yard.map(([x, y]) => y * cols + x)) };
  for (const [k, n] of [['tree', R.int(1, 4)], ['bush', R.int(2, 6)], ['boulder', R.int(0, 2)], ['haybale', key === 'tavern' || key === 'smithy' ? R.int(0, 2) : 0], ['cart', R.chance(0.4) ? 1 : 0], ['well', R.chance(0.3) ? 1 : 0]]) {
    let m = n; for (const [x, y] of R.shuffle(yard.slice())) { if (m <= 0) break; const near = x >= X0 - 1 && x <= X0 + bw && y >= Y0 - 1 && y <= Y0 + bh; if (k === 'tree' && near) continue; if (place(k, x, y, R.int(0, 3), yRoom)) m--; }
  }
  const name = key === 'tavern' ? `The ${R.pick(PUB_A)} ${R.pick(PUB_B)}` : `The ${R.pick(ADJ)} ${({ house: 'House', shop: 'Shop', manor: 'Manor', chapel: 'Chapel', smithy: 'Smithy', guardhouse: 'Guardhouse' })[key]}`;
  const intro = key === 'tavern' || key === 'shop' || key === 'smithy' ? `Kept by ${R.pick(KEEPERS)}, ${R.pick(TRAITS)}.` : key === 'chapel' ? `Tended by ${R.pick(KEEPERS)}, ${R.pick(TRAITS)}.`
    : key === 'guardhouse' ? `Under the command of ${R.pick(KEEPERS)}, ${R.pick(TRAITS)}.` : `Home of ${R.pick(NAMES)}, ${R.pick(TRAITS)}.`;
  // a lantern by the front door
  if (frontDoor) {
    const fd = frontDoor, south = fd.s === 'n' && fd.y === Y0 + bh, north = fd.s === 'n' && fd.y === Y0, west = fd.s === 'w' && fd.x === X0;
    const spot = fd.s === 'n' ? [fd.x + 1, south ? fd.y : fd.y - 1, south ? 0 : 2] : [west ? fd.x - 1 : fd.x, fd.y + 1, west ? 1 : 3];
    if (north || south || fd.s === 'w') place('lamp', spot[0], spot[1], spot[2], yRoom) || place('lamp', fd.s === 'n' ? fd.x - 1 : spot[0], fd.s === 'n' ? spot[1] : fd.y - 1, spot[2], yRoom);
  }
  for (const r of out) r.label = B_NAMES[r.type];
  return { plan: pack(w), rooms: out, lights: lightsOf(w), containers, name, intro, theme: key, seed };
}
const TYPE_NAMES = { entrance: 'Entrance', exit: 'The way down', crypt: 'Crypt', ossuary: 'Ossuary', shrine: 'Shrine', embalming: 'Embalming room', guardroom: 'Guardroom', treasury: 'Treasury',
  collapsed: 'Collapsed chamber', flooded: 'Flooded chamber', antechamber: 'Antechamber', nave: 'Nave', cells: 'Cells', library: 'Library', refectory: 'Refectory', vestry: 'Vestry', well: 'Well room',
  scriptorium: 'Scriptorium', barracks: 'Barracks', armoury: 'Armoury', mess: 'Mess hall', storeroom: 'Storeroom', kitchen: 'Kitchen', throne: 'Throne room', forge: 'Forge', den: 'Den', larder: 'Larder',
  midden: 'Midden', hoard: 'Hoard', workings: 'Workings', office: 'Overseer\'s office', cistern: 'Cistern', junction: 'Junction', smugglers: 'Smugglers\' den', laboratory: 'Laboratory', study: 'Study',
  summoning: 'Summoning chamber', menagerie: 'Menagerie', vault: 'Vault', bedchamber: 'Bedchamber', torture: 'Torture chamber', warden: 'Warden\'s quarters', oubliette: 'Oubliette', camp: 'Camp' };
// the scene's GM notes for a generated dungeon
function notes(g) {
  return `# ${g.name}\n\n${g.intro}\n\n` + g.rooms.map(r => `**${r.n}. ${r.label || TYPE_NAMES[r.type] || r.type}.** ${r.text}`).join('\n\n') + `\n\n_Seed: ${g.seed}_`;
}

// ───────── two people's edits to one plan, put together ─────────
// Square by square, door by door (by its edge), furniture by what and where it is, room numbers by number: whatever only
// one of them changed is kept from that one; where both changed the same thing, the later edit (mine) wins.
function merge(base, theirs, mine) {
  const B = unpack(base), T = unpack(theirs), M = unpack(mine);
  if (B.cols !== T.cols || B.rows !== T.rows || B.cols !== M.cols || B.rows !== M.rows) return pack(M);   // resized: no squares to match
  const S = v => v === undefined ? undefined : JSON.stringify(v);
  const pick = (b, t, m) => { const sb = S(b), st = S(t), sm = S(m); return sm === st || sm === sb ? t : st === sb ? m : m; };
  const out = Object.assign({}, M, { grid: new Uint8Array(M.grid.length) });
  for (let i = 0; i < out.grid.length; i++) out.grid[i] = M.grid[i] === T.grid[i] || M.grid[i] === B.grid[i] ? T.grid[i] : M.grid[i];
  const keyed = (arr, kf) => { const o = new Map(); for (const x of arr || []) { let k = kf(x); while (o.has(k)) k += '+'; o.set(k, x); } return o; };
  const lst = (b, t, m, kf) => {
    const Bm = keyed(b, kf), Tm = keyed(t, kf), Mm = keyed(m, kf), res = [];
    for (const k of new Set([...Tm.keys(), ...Mm.keys(), ...Bm.keys()])) { const v = pick(Bm.get(k), Tm.get(k), Mm.get(k)); if (v !== undefined) res.push(v); }
    return res;
  };
  out.doors = lst(B.doors, T.doors, M.doors, d => d.x + ',' + d.y + d.s);
  out.feats = lst(B.feats, T.feats, M.feats, f => f.k + '@' + f.x + ',' + f.y + ',' + f.r);
  out.labels = lst(B.labels, T.labels, M.labels, l => l.n);
  const st = {}; for (const k of new Set([...Object.keys(T.style || {}), ...Object.keys(M.style || {})])) { const v = pick((B.style || {})[k], (T.style || {})[k], (M.style || {})[k]); if (v !== undefined) st[k] = v; }
  out.style = st;
  out.seed = pick(B.seed, T.seed, M.seed);
  return pack(out);
}
// what an edit did to a plan, in words
function describe(before, after) {
  if (!before) return 'Started the plan';
  if (!after) return 'Removed the plan';
  const A = unpack(after), B = unpack(before), bits = [];
  if (A.cols !== B.cols || A.rows !== B.rows) bits.push(`resized it to ${A.cols}×${A.rows}`);
  else { let n = 0; for (let i = 0; i < A.grid.length; i++) if (A.grid[i] !== B.grid[i]) n++; if (n) bits.push(`${n} square${n === 1 ? '' : 's'} of floor`); }
  const diff = (a, b, kf) => { const ka = new Set(a.map(kf)), kb = new Set(b.map(kf)); return [a.filter(x => !kb.has(kf(x))), b.filter(x => !ka.has(kf(x)))]; };
  const name = k => (FEATS.find(f => f[0] === k) || [, k])[1].toLowerCase();
  const [fa, fr] = diff(A.feats, B.feats, f => f.k + '@' + f.x + ',' + f.y + ',' + f.r);
  const moved = fa.filter(f => fr.some(g => g.k === f.k)).length;
  const added = fa.length - moved, removed = fr.length - moved;
  if (moved) bits.push(moved === 1 ? 'moved ' + (fa.find(f => fr.some(g => g.k === f.k)) ? 'a ' + name(fa.find(f => fr.some(g => g.k === f.k)).k) : 'a piece') : `moved ${moved} pieces`);
  if (added) bits.push(added === 1 ? 'added a ' + name(fa.find(f => !fr.some(g => g.k === f.k)).k) : `added ${added} pieces`);
  if (removed) bits.push(removed === 1 ? 'removed a ' + name(fr.find(f => !fa.some(g => g.k === f.k)).k) : `removed ${removed} pieces`);
  const [da, dr] = diff(A.doors, B.doors, d => d.x + ',' + d.y + d.s + d.k);
  if (da.length || dr.length) bits.push(`${Math.max(da.length, dr.length)} door${Math.max(da.length, dr.length) === 1 ? '' : 's'}`);
  if (JSON.stringify(A.labels) !== JSON.stringify(B.labels)) bits.push('room numbers or notes');
  if (JSON.stringify(A.style) !== JSON.stringify(B.style)) bits.push('its look');
  if (!bits.length) return 'No change';
  const s = bits.join(', ');
  return s[0].toUpperCase() + s.slice(1);
}

const api = { merge, describe, loops, natural, NATURAL, ROCK, FLOOR, WATER, MATS, MAT, FLOOR_MATS, WALL_MATS, OUTSIDE, DOORS, FEATS, FEAT_KEYS, GLOW, CONTAINERS, ROOM_LOOT, lights: lightsOf, STYLE, THEMES: Object.keys(THEMES), BUILDINGS: Object.keys(BUILDINGS), encode, decode, normalize, unpack, pack, at, open, walls, regions, rng, generate, notes };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plan = api;
})(this);
