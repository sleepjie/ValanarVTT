/* Map Forge: the isometric map engine, shared by the forge (table/iso/forge.html) and the tabletop (table/js/iso.js).
 *
 * A map: { v: 2, biome, w, h, terr, over, obj }
 *   terr  ground type per cell: 0 void (the dark beyond the cliffs), 1 grass (snow, sand), 2 stone path, 3 water
 *   over  a piece laid in place of the ground (a bridge deck, a jetty, the stair down), or 0
 *   obj   what stands on the cell: a tile of the biome's sheet (< 1000) or a prop from the props atlas (>= 1000).
 *         Props bigger than a cell (a cart, a house) sit on their FRONT cell and reach back (to lower x and y).
 * Cells are 64x32 diamonds (Flare's): cell (x, y) is centred at ((x - y) * 32, (x + y) * 16 + 16) from the map's origin.
 * Banks round water and cliffs where land meets the void are worked out from the cells, by rules learned from Flare's
 * own maps (and its cliff table, ISO_DATA.cliff).
 */
(function (root) {
'use strict';
const VOID = 0, GRASS = 1, PATH = 2, WATER = 3;
const NB = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];   // N NE E SE S SW W NW (map axes)
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const cellXY = (x, y) => [(x - y) * 32, (x + y) * 16 + 16];
const cellAt = (px, py) => [Math.floor((px / 32 + py / 16) / 2), Math.floor((py / 16 - px / 32) / 2)];   // (with cell (0, 0) centred at (0, 16))

let D = null;          // ISO_DATA
const sheets = {};     // name -> Image
function data() { return D || (D = root.ISO_DATA); }
// load the sheets a map needs (base: where the iso folder is served from)
function load(base, biomes) {
  const d = data(), want = ['props', ...(biomes || Object.keys(d.biomes))];
  return Promise.all(want.map(k => new Promise(res => {
    if (sheets[k] && sheets[k].complete && sheets[k].naturalWidth) return res();
    const img = sheets[k] || new Image(); sheets[k] = img;
    img.onload = () => res(); img.onerror = () => res();
    if (!img.src) img.src = (base || '') + (k === 'props' ? d.props.sheet : d.biomes[k].sheet);
  })));
}
const ready = k => !!(sheets[k] && sheets[k].complete && sheets[k].naturalWidth);

// ───── a sprite: where it is in which sheet, its anchor, its footprint
const PW = {};   // winter versions of props (summer id -> winter id)
function sprite(biome, id) {
  const d = data();
  if (id >= 1000) {
    const p = d.props.items[id]; if (!p) return null;
    return { img: sheets.props, x: p[0], y: p[1], w: p[2], h: p[3], ox: p[4], oy: p[5], fw: p[6], fh: p[7], name: p[8], cat: p[9], prop: true };
  }
  const t = (d.biomes[biome] || d.biomes.grass).tiles[id]; if (!t) return null;
  return { img: sheets[biome] || sheets.grass, x: t[0], y: t[1], w: t[2], h: t[3], ox: t[4], oy: t[5], fw: t[6] || 1, fh: t[7] || 1, name: t[8] };
}
const has = (biome, id) => !!sprite(biome, id);
// the version of a prop for this biome: snowy in the snow
function forBiome(biome, id) {
  const d = data();
  if (id >= 1000 && id < 1200 && d.biomes[biome] && d.biomes[biome].winter && d.props.items[id + 500]) return id + 500;
  if (id >= 1500 && id < 1700 && !(d.biomes[biome] && d.biomes[biome].winter) && d.props.items[id - 500]) return id - 500;   // (1700 on: loose props, one version)
  const win = !!(d.biomes[biome] && d.biomes[biome].winter);
  if (id >= 2216 && id < 2224 && win) return id - 16;   // pines: snowy in the snow, bare of it elsewhere
  if (id >= 2200 && id < 2208 && !win) return id + 16;
  if (id >= 1300 && id < 1312 && win && d.props.items[id + 50]) return id + 50;   // Flare's houses: snow on their roofs in the snow
  if (id >= 1350 && id < 1362 && !win) return id - 50;
  if (id >= 2300 && id < 2316) { const k = (id - 2300) % 8; return id - k + (k & 3) + (win ? 4 : 0); }   // the timber houses: four turns, and a winter version of each
  return id;
}

// ───── turning a piece round to face the other way (mirrored left to right, so +x and +y swap):
// the piece of its set that faces that way, where the set has one; otherwise none (it's drawn mirrored)
const SETS4 = [[2100, 2184], [2400, 2400 + 4 * 32]];   // sets of four turns in Kenney's order (facing -y, +x, +y, -x)
function mirrorOf(id) {
  const d = data();
  for (const [a, b] of SETS4) if (id >= a && id < b) { const k = (id - a) & 3, t = id - k + [3, 2, 1, 0][k]; return d.props.items[t] ? t : 0; }
  const PAIRS = { 1400: 1401, 1401: 1400, 1402: 1403, 1403: 1402, 1414: 1415, 1415: 1414 };   // m7600's chairs (facing +x, +y, -x, -y); the long tables
  return PAIRS[id] || 0;
}
// a sprite as drawn mirrored: its footprint reaches back the other way
const mirrored = s => s && Object.assign({}, s, { fw: s.fh, fh: s.fw, flip: 1 });
const spriteAt = (m, i, id) => { const s = sprite(m.biome, id); return m.flip && m.flip[i] ? mirrored(s) : s; };
// flip the piece at cell i: swap it for its turned twin, or mirror it
function flipAt(m, i) { const id = m.obj[i]; if (!id) return false; const t = mirrorOf(id); if (t) m.obj[i] = t; else { if (!m.flip) m.flip = new Uint8Array(m.w * m.h); m.flip[i] ^= 1; } return true; }

// ───── the map
// edge: indoors, the walls between rooms and the doors: per cell, bit 1 a wall on its W edge (towards x - 1), bit 2 on its
// N edge (towards y - 1), bit 4 a door in the W edge, bit 8 a door in the N edge. Underground, bit 16 on a rock cell: a wall
// built in the forge, drawn as a stub where floor lies behind it (where a dug-out wall would be left out). Walls round the outside are worked out.
function blank(w, h, biome) { return { v: 2, biome: biome || 'grass', w, h, terr: new Uint8Array(w * h).fill(GRASS), over: new Uint16Array(w * h), obj: new Uint16Array(w * h), edge: new Uint8Array(w * h), flip: new Uint8Array(w * h) }; }
const inb = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h;
// off the map: indoors and underground, nothing (rock, or outside the walls); out of doors the land goes on as it is at
// the edge, so no cliff rings the map and a river runs on off it (cliffs only where the map itself has void)
const tAt = (m, x, y) => inb(m, x, y) ? m.terr[y * m.w + x] : kindOf(m.biome) === 'out' ? m.terr[Math.max(0, Math.min(m.h - 1, y)) * m.w + Math.max(0, Math.min(m.w - 1, x))] : VOID;

// riverbanks: on the land round the water, by which sides the water lies
function bankKind(m, x, y) {
  const t = tAt(m, x, y); if (t === VOID || t === WATER) return 0;
  const w = (dx, dy) => tAt(m, x + dx, y + dy) === WATER;
  const n = w(0, -1), e = w(1, 0), s = w(0, 1), wv = w(-1, 0), c = n + e + s + wv;
  if (c === 0) {
    const dd = [w(1, 1) && 152, w(-1, 1) && 153, w(-1, -1) && 154, w(1, -1) && 155].filter(Boolean);
    return dd.length === 0 ? 0 : dd.length === 1 ? dd[0] : -1;
  }
  if (c === 1) return e ? 144 : s ? 145 : wv ? 146 : 147;
  if (c === 2) { if (e && s) return 160; if (s && wv) return 161; if (wv && n) return 162; if (n && e) return 163; }
  return -1;
}
// a strip of land too thin to carry its banks becomes water
function fixWater(m) {
  for (let it = 0; it < 30; it++) {
    let ch = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (bankKind(m, x, y) === -1) { const i = y * m.w + x; m.terr[i] = WATER; m.over[i] = 0; ch++; }
    if (!ch) break;
  }
}
const cliffMemo = {};
// the land's height (m.lv: 0 the ground, 1, 2, 3 rises above it; off the map, as at its edge)
const lvAt = (m, x, y) => m.lv ? m.lv[Math.max(0, Math.min(m.h - 1, y)) * m.w + Math.max(0, Math.min(m.w - 1, x))] : 0;
// Flare's cliffs stand between the land and what rises behind it (the void, at the map's edge). A rise in the land is
// the same: to a cell, higher land beside it is as the void; and a cell with lower land beside it is the rise's own
// top edge (as a void cell beside land is)
function cliffFor(m, x, y) {
  const t0 = tAt(m, x, y), L = lvAt(m, x, y);
  let own = t0 === VOID ? 1 : 0, k = 0;
  NB.forEach(([dx, dy], i) => { const t = tAt(m, x + dx, y + dy); if (t === VOID || (!own && m.lv && lvAt(m, x + dx, y + dy) > L)) k |= 1 << i; });
  // (a rise in the land, behind a cell (N, W or NW of it), shows as the void does: its rock face going up from this cell.
  // Higher land only in front of a cell faces away from us: nothing drawn for it there)
  if (!own && m.lv && k) { let v = 0; NB.forEach(([dx, dy], i) => { if (tAt(m, x + dx, y + dy) === VOID) v |= 1 << i; }); if (!(k & 65) && !v) return 0; if (!(k & 65)) k = v; }   // (a rise only across a corner (NW): its face is drawn by the cells beside, so nothing here)
  if (!own && !k && m.lv) {
    // (the top of a rise: its edge piece only where the land falls away in front of it (E, SE, S); at its back, the void's
    // side of the cliff would show as a black drop)
    let low = 0; NB.forEach(([dx, dy], i) => { if (tAt(m, x + dx, y + dy) !== VOID && lvAt(m, x + dx, y + dy) < L) low |= 1 << i; });
    if ((low & 28) && !(low & 193)) { own = 1; NB.forEach(([dx, dy], i) => { const t = tAt(m, x + dx, y + dy); if (t === VOID || lvAt(m, x + dx, y + dy) >= L) k |= 1 << i; }); }
  }
  if (own ? k === 255 : k === 0) return 0;
  const key = own * 256 + k, C = data().cliff;
  if (!(key in cliffMemo)) {
    let v = C[key];
    if (v === undefined) {
      let best = 99; v = 0;
      for (const kk in C) { if ((kk >> 8) !== own) continue; let d = (kk & 255) ^ k, b = 0; while (d) { b += d & 1; d >>= 1; } if (b < best) { best = b; v = C[kk]; } }
    }
    cliffMemo[key] = v;
  }
  const v = cliffMemo[key];
  return v ? v + ((hash(x, y) & 1) ? 4 : 0) : 0;
}
// ───── inside (a dungeon): the void is rock, and walls stand wherever rock meets floor. Each wall is a block; its two
// faces we can see (towards +y on the left, +x on the right) are stone where they face a floor and black where they face
// rock. A wall with floor behind it would hide that floor, so it's cut down to a stub (as Diablo does).
// The dungeon sheet's blocks, by which of their four sides are dressed stone (the rest is raw rock, black): E and S are
// the faces we see (right and left), W and N are behind, shown only by the lip of the block's top. A wall shows stone on
// every side that has floor beside it. Sorted plain first, then mossy, then with niches (used now and then).
const WALLS = {
  E: [0, 4, 82, 86, 100, 102, 55, 57, 61, 63, 65], S: [1, 5, 83, 87, 101, 103, 56, 58, 62, 64, 66],
  W: [2, 6, 84, 104, 59, 67], N: [3, 7, 85, 105, 60, 68],
  ES: [8, 88, 92, 96, 69, 106], SW: [9, 89, 93, 97, 70, 107], NW: [10, 90, 94, 98, 108], NE: [11, 91, 95, 99, 71, 109],
  NESW: [16]
};
const NICHE = { E: [122, 125, 127], S: [123, 124, 126] };
const INNER = { SE: 12, SW: 13, NW: 14, NE: 15 };       // inner corners: floor only across a corner
const SOLID = [25, 26, 27, 28, 29, 30, 31, 32];
const DOORS = { x: [646, 638, 639, 640, 641], y: [647, 643, 644, 645, 642] };   // archways (open first, then gated): in a wall running along x (open along y), and along y
const DOOR_IDS = new Set([...DOORS.x, ...DOORS.y]);
const isInterior = m => { const b = data().biomes[m.biome]; return !!(b && b.interior); };
// what sort of map a land makes: outdoors, underground (rock and block walls), indoors (rooms with thin walls)
const kindOf = biome => { const b = data().biomes[biome]; return !b ? 'out' : b.indoor ? 'in' : b.interior ? 'under' : 'out'; };
const floorAt = (m, x, y) => tAt(m, x, y) !== VOID;
const WALL_KEYS = Object.keys(WALLS);
// a land of dressed blocks (the castle keep, pfunked's walls): a wall shows only the face a room sees: its E face (to
// x + 1) or its S face (to y + 1), a pillar where it sees both, a corner piece at a room's back corner. Walls with the room
// behind them (the front) aren't drawn, so the rooms lie open; now and then a face is dressed (chains, a statue in a
// niche, books, a torch, a banner, a hanging)
function blockWall(m, x, y) {
  const N = floorAt(m, x, y - 1), E = floorAt(m, x + 1, y), S = floorAt(m, x, y + 1), W = floorAt(m, x - 1, y), h = hash(x, y);
  if (E && S) return 504;
  if (!E && !S) return !N && !W && floorAt(m, x + 1, y + 1) ? 505 : 0;
  const dressed = h % 100 < 16, k = (h >>> 7) % 6;
  return E ? (dressed ? 510 + k : 500 + ((h >>> 4) & 1) * 2) : (dressed ? 520 + k : 501 + ((h >>> 4) & 1) * 2);
}
function wallFor(m, x, y) {
  if (tAt(m, x, y) !== VOID || !inb(m, x, y)) return 0;
  if (data().biomes[m.biome] && data().biomes[m.biome].blocks) return blockWall(m, x, y);
  return wallPiece(m, x, y, (a, b) => floorAt(m, a, b));
}
// a ledge in a cave: the top edge of a rise (m.lv), where the floor in front of it (E or S) is lower: the rock of a wall
// piece, as though the lower floor were the room and this cell the rock, cut down to a stub
function ledgeFor(m, x, y) {
  if (!m.lv || tAt(m, x, y) === VOID) return 0;
  const L = lvAt(m, x, y); if (!L) return 0;
  const lo = (a, b) => floorAt(m, a, b) && lvAt(m, a, b) < L;
  if (!lo(x + 1, y) && !lo(x, y + 1)) return 0;
  return wallPiece(m, x, y, lo);
}
function wallPiece(m, x, y, floorAt) {
  const N = floorAt(x, y - 1), E = floorAt(x + 1, y), S = floorAt(x, y + 1), W = floorAt(x - 1, y), h = hash(x, y);
  const pickOf = list => list[(h >>> 4) % 4 ? (h >>> 9) % Math.min(2, list.length) : (h >>> 9) % list.length];
  if (!N && !E && !S && !W) return floorAt(x + 1, y + 1) ? 500 + INNER.SE : 0;   // (a room's back corner; the rest is deep rock)
  // a wall with no floor before it on our side (the front of a room, at its south and east) isn't drawn: it would only
  // hide the room, so the rooms lie open to the eye
  if (!E && !S) return 0;
  // the sides we can see must match; of the rest, as many as the sheet has
  const want = (N ? 'N' : '') + (E ? 'E' : '') + (S ? 'S' : '') + (W ? 'W' : '');
  let key = WALLS[want] ? want : null;
  if (!key) {
    let best = -1;
    for (const k of WALL_KEYS) {
      if (k.includes('E') !== E || k.includes('S') !== S) continue;
      const sc = (k.includes('N') === N) + (k.includes('W') === W);
      if (sc > best) { best = sc; key = k; }
    }
  }
  if (!key) key = E && S ? 'ES' : E ? 'E' : S ? 'S' : W ? 'W' : 'N';
  if (NICHE[key] && h % 100 < 4) return 500 + NICHE[key][(h >>> 7) % 3];
  return 500 + pickOf(WALLS[key]);
}
const cutAt = (m, x, y) => floorAt(m, x - 1, y) || floorAt(m, x, y - 1) || floorAt(m, x - 1, y - 1);   // floor behind it
// the floor under a wall (underground): as the room's floor would be there
function floorUnder(m, x, y) {
  const h = hash(x, y), t4 = data().biomes[m.biome].tile4;
  return t4 ? t4 + (x & 3) + 4 * (y & 3) : 300 + ((h >>> 3) % 8);
}
function groundFor(m, x, y) {
  const i = y * m.w + x; if (m.over[i] && has(m.biome, m.over[i])) return m.over[i];
  const t = m.terr[i];
  if (t === VOID) return 0;
  if (kindOf(m.biome) === 'in') { const h = hash(x, y); return t === PATH ? 380 + (h % 4) : 301 + ((h >>> 3) % 11); }
  if (isInterior(m)) {
    const h = hash(x, y);
    if (t === PATH) return 380 + (h % 4);   // boards
    if (h % 100 < 5) return [314, 315, 316, 317, 318, 319, 348, 349, 350, 351, 352, 353, 354, 355][(h >>> 7) % 14];
    const t4 = data().biomes[m.biome].tile4; return t4 ? t4 + (x & 3) + 4 * (y & 3) : 300 + ((h >>> 3) % 8);   // tile4: a floor drawn to tile in fours
  }
  if (t === WATER) return 176 + (x & 3) + 4 * (y & 3);
  const b = bankKind(m, x, y); if (b > 0) return b + ((hash(x, y) >> 3) & 1 ? 4 : 0);
  if (t === PATH) return 32 + (hash(x, y) % 16);
  return 16 + (x & 3) + 4 * (y & 3);
}
// ───── indoors: thin walls on the edges of cells. A wall with the floor in front of it (a room's back wall, or a wall
// between rooms) stands full height on the cell in front; a wall with the room behind it (the front of the building) is
// cut down low, drawn on the cell outside. Each cell gets a list of [piece, how]: how 0 full, 1 cut (its own low piece),
// 2 cut by clipping (a land with no low pieces), and which edge ('W' or 'N').
function thinWalls(m) {
  const T = data().biomes[m.biome].thin, out = new Array(m.w * m.h), fl = (x, y) => tAt(m, x, y) !== VOID;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x, e = m.edge[i], h = hash(x, y), list = [];
    for (const [k, ax, ay, wb, db] of [['W', x - 1, y, 1, 4], ['N', x, y - 1, 2, 8]]) {
      const inA = fl(ax, ay), inB = fl(x, y), door = !!(e & db), wall = inA !== inB || (inA && inB && (e & (wb | db)));
      if (!wall) continue;
      if (inB) {   // the floor is in front of it: full height
        if (door) { const d = T[k + 'door']; list.push([d[(h >>> 5) % d.length], 0, k, 1]); }
        else {
          // the outside walls get windows, spaced along them (isWindow); pictures, shelves and sconces now and then inside
          const inner = (T.inner ? T[k + 'd'].filter(id => T.inner.includes(id)) : T[k + 'd']), plain = T[k];
          if (T.win && isWindow(m, x, y, k)) list.push([T.win[k === 'W' ? 0 : 1], 0, k, 0]);
          else list.push([(h % 100) < (inA ? 11 : 6) && inner.length ? inner[(h >>> 7) % inner.length] : plain[0], 0, k, 0]);
        }
      } else if (inA && !inB) {
        // the outside wall at the front of the building (the room behind it): not drawn at all, so the rooms lie open to
        // the eye. (It still bounds the floor: the walls the table makes go round it, with a gap at a door.)
      } else {     // a wall between rooms with this side outside: low
        if (door) { if (T[k + 'gap']) list.push([T[k + 'gap'], 1, k, 1]); }
        else list.push(T[k + 'cut'] ? [T[k + 'cut'], 1, k, 0] : [T[k][0], 2, k, 0]);
      }
    }
    // a corner: both walls plain and full, or both low
    if (list.length === 2 && !list[0][3] && !list[1][3]) {
      if (!list[0][1] && !list[1][1] && list[0][0] === T.W[0] && list[1][0] === T.N[0] && T.corner) list.splice(0, 2, [T.corner, 0, 'C', 0]);
      else if (list[0][1] === 1 && list[1][1] === 1 && T.cornerCut) list.splice(0, 2, [T.cornerCut, 1, 'C', 0]);
    }
    if (list.length) out[i] = list;
  }
  return out;
}
// a window in the outside wall on cell (x, y)'s W or N edge: every third cell along a straight run of it, not at a corner,
// not where a wall inside meets it, not beside a door
function isWindow(m, x, y, k) {
  const T = (data().biomes[m.biome] || {}).thin; if (!T || !T.win) return false;
  const fl = (a, b) => tAt(m, a, b) !== VOID, E = (a, b) => inb(m, a, b) ? m.edge[b * m.w + a] : 0;
  if (!fl(x, y)) return false;
  if (k === 'W') {
    if (fl(x - 1, y) || y % 3 !== 1) return false;
    for (const yy of [y - 1, y + 1]) if (!fl(x, yy) || fl(x - 1, yy) || (E(x, yy) & 4)) return false;
    return !(E(x, y) & (2 | 4 | 8)) && !(E(x, y + 1) & 2) && !(E(x + 1, y) & 4);
  }
  if (fl(x, y - 1) || x % 3 !== 1) return false;
  for (const xx of [x - 1, x + 1]) if (!fl(xx, y) || fl(xx, y - 1) || (E(xx, y) & 8)) return false;
  return !(E(x, y) & (1 | 4 | 8)) && !(E(x + 1, y) & 1) && !(E(x, y + 1) & 8);
}
// a thin wall cut down by clipping: only its foot, a band just above the edge it stands on
function drawThinCut(c, s, cx, cy, edge) {
  if (!s || !s.img || !s.img.naturalWidth) return;
  const L = Math.round(cx), B = Math.round(cy), H = 22;
  c.save(); c.beginPath();
  if (edge === 'W') { c.moveTo(L - 34, B + 4); c.lineTo(L + 2, B - 14); c.lineTo(L + 2, B - 16 - H); c.lineTo(L - 34, B - H); }
  else { c.moveTo(L - 2, B - 14); c.lineTo(L + 34, B + 4); c.lineTo(L + 34, B - H); c.lineTo(L - 2, B - 16 - H); }
  c.closePath(); c.clip();
  c.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(cx - s.ox), Math.round(cy - s.oy), s.w, s.h);
  c.restore();
}
// what the cells show: ground (m.g), cliffs (m.c), and which prop covers each cell (m.occ: its front cell's index + 1)
function compute(m) {
  if (!m.edge) m.edge = new Uint8Array(m.w * m.h);
  const n = m.w * m.h, inside = isInterior(m), natural = !!(data().biomes[m.biome] || {}).natural; m.g = new Uint16Array(n); m.c = new Uint16Array(n); m.occ = new Int32Array(n); m.cut = new Uint8Array(n);
  // what's drawn: the map's own pieces, in this land's versions
  m.vobj = new Uint16Array(n); for (let i = 0; i < n; i++) if (m.obj[i]) m.vobj[i] = standIn(m.biome, m.obj[i], i);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x; m.g[i] = groundFor(m, x, y);
    if (inside) { m.c[i] = wallFor(m, x, y); if (m.c[i] && cutAt(m, x, y)) { if (m.edge[i] & 16) m.cut[i] = 1; else m.c[i] = 0; } if (DOOR_IDS.has(m.vobj[i]) && cutAt(m, x, y)) m.cut[i] = 1; if (m.c[i] && !m.g[i]) m.g[i] = floorUnder(m, x, y); if (!m.c[i] && m.lv && natural && (m.c[i] = ledgeFor(m, x, y))) m.cut[i] = 2; }   // (a wall with floor behind it, which would only hide that floor, isn't drawn)
    else if (kindOf(m.biome) !== 'in') m.c[i] = cliffFor(m, x, y);
  }
  m.thin = kindOf(m.biome) === 'in' ? thinWalls(m) : null;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const id = m.vobj[y * m.w + x]; if (!id) continue;
    const s = spriteAt(m, y * m.w + x, id), fw = s ? s.fw : 1, fh = s ? s.fh : 1;
    for (let j = 0; j < fh; j++) for (let k = 0; k < fw; k++) if (inb(m, x - k, y - j)) m.occ[(y - j) * m.w + x - k] = y * m.w + x + 1;
  }
  return m;
}
// the prop or object covering a cell: [x, y] of its front cell, or null
function ownerOf(m, x, y) { if (!m.occ) compute(m); const o = inb(m, x, y) ? m.occ[y * m.w + x] : 0; return o ? [(o - 1) % m.w, ((o - 1) / m.w) | 0] : null; }

// ───── drawing (2D canvas). ox, oy: where cell (0, 0)'s centre falls in the canvas
function drawSprite(c, s, cx, cy, alpha) {
  if (!s || !s.img || !s.img.naturalWidth) return;
  if (alpha != null) c.globalAlpha = alpha;
  if (s.flip) { c.save(); c.translate(Math.round(cx), 0); c.scale(-1, 1); c.drawImage(s.img, s.x, s.y, s.w, s.h, -Math.round(s.ox), Math.round(cy - s.oy), s.w, s.h); c.restore(); }   // mirrored about the anchor
  else c.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(cx - s.ox), Math.round(cy - s.oy), s.w, s.h);
  if (alpha != null) c.globalAlpha = 1;
}
// a wall cut down to a stub: the foot of its faces (between its bottom edges and those edges raised STUB), with its top
// laid on at that height. The block's foot is a diamond centred on (ox, oy) of the sprite, its top one 64 above.
const STUB = 18;
function drawCut(c, s, cx, cy, alpha) {
  if (!s || !s.img || !s.img.naturalWidth) return;
  const L = Math.round(cx) - 32, B = Math.round(cy);   // the foot diamond's left corner and centre line
  c.save(); if (alpha != null) c.globalAlpha = alpha;
  c.beginPath(); c.moveTo(L, B - STUB); c.lineTo(L + 32, B + 16 - STUB); c.lineTo(L + 64, B - STUB); c.lineTo(L + 64, B + 1); c.lineTo(L + 32, B + 17); c.lineTo(L, B + 1); c.closePath(); c.clip();
  c.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(cx - s.ox), Math.round(cy - s.oy), s.w, s.h);
  c.restore(); c.save(); if (alpha != null) c.globalAlpha = alpha;
  const T = B - STUB;   // the top, laid on at the stub's height: centre (cx, T)
  c.beginPath(); c.moveTo(L, T); c.lineTo(L + 32, T - 16); c.lineTo(L + 64, T); c.lineTo(L + 32, T + 16); c.closePath(); c.clip();
  c.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(cx - s.ox), Math.round(cy - s.oy) + 64 - STUB, s.w, s.h);
  c.restore();
}
// a ledge (a cave's rise): the foot of the rock's faces as a stub, LEDGE high, and on top the cell's own floor, raised
const LEDGE = 22;
function drawLedge(c, s, top, cx, cy) {
  if (!s || !s.img || !s.img.naturalWidth) return;
  const L = Math.round(cx) - 32, B = Math.round(cy);
  c.save(); c.beginPath(); c.moveTo(L, B - LEDGE); c.lineTo(L + 32, B + 16 - LEDGE); c.lineTo(L + 64, B - LEDGE); c.lineTo(L + 64, B + 1); c.lineTo(L + 32, B + 17); c.lineTo(L, B + 1); c.closePath(); c.clip();
  c.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(cx - s.ox), Math.round(cy - s.oy) + 64 - LEDGE - 18, s.w, s.h);
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(L, B - LEDGE, 64, LEDGE + 18);
  c.restore();
  if (top) drawSprite(c, top, cx, cy - LEDGE);
}
function paint(c, m, o) {
  o = o || {}; if (!m.g) compute(m);
  const ox = o.ox || 0, oy = o.oy || 0, view = o.view, W = m.w, H = m.h, b = m.biome;
  const vis = (x, y) => { if (!view) return true; const cx = (x - y) * 32 + ox, cy = (x + y) * 16 + oy; return cx > view[0] - 400 && cx < view[2] + 400 && cy > view[1] - 60 && cy < view[3] + 420; };
  for (let d = 0; d < W + H - 1; d++) for (let x = Math.max(0, d - H + 1); x <= Math.min(W - 1, d); x++) {
    const y = d - x; if (!vis(x, y)) continue; const g = m.g[y * W + x]; if (g) drawSprite(c, sprite(b, g), (x - y) * 32 + ox, (x + y) * 16 + oy);
  }
  if (o.groundOnly) return;
  for (let d = 0; d < W + H - 1; d++) for (let x = Math.max(0, d - H + 1); x <= Math.min(W - 1, d); x++) {
    const y = d - x; if (!vis(x, y)) continue; const i = y * W + x, cx = (x - y) * 32 + ox, cy = (x + y) * 16 + oy;
    if (m.thin && m.thin[i]) for (const [id, how, edge] of m.thin[i]) {
      if (how === 0 || (o.uncut && how === 2)) drawSprite(c, sprite(b, id), cx, cy);
      else if (how === 1) drawSprite(c, sprite(b, o.uncut && edge !== 'C' ? (edge === 'W' ? data().biomes[b].thin.W[0] : data().biomes[b].thin.N[0]) : id), cx, cy);
      else drawThinCut(c, sprite(b, id), cx, cy, edge);
    }
    if (m.c[i] && m.cut[i] === 2) { const sub = data().biomes[b].cutAs; drawLedge(c, sprite(b, (sub && sub[m.c[i]]) || m.c[i]), sprite(b, m.g[i]), cx, cy); }
    else if (m.c[i]) { if (m.cut[i] && !o.uncut) { const sub = data().biomes[b].cutAs; drawCut(c, sprite(b, (sub && sub[m.c[i]]) || m.c[i]), cx, cy); } else drawSprite(c, sprite(b, m.c[i]), cx, cy); }   // cutAs: a land whose backs are dark shows its rock face in the stub
    if (m.vobj[i]) (m.cut[i] && DOOR_IDS.has(m.vobj[i]) && !o.uncut ? drawCut : drawSprite)(c, spriteAt(m, i, m.vobj[i]), cx, cy);
  }
}
// the canvas size a whole map needs, and where its origin goes: room above for the tallest things
function bounds(m) {
  const pad = 48, top = 300;
  return { w: (m.w + m.h) * 32 + pad * 2, h: (m.w + m.h) * 16 + top + pad, ox: m.h * 32 + pad, oy: top };
}
// everything that stands up off the ground (cliffs, trees, props): a creature behind one should show through it.
// Each: the sprite, where it's drawn (dx, dy in the canvas), and its front cell (X, Y)
function standing(m, o) {
  o = o || {}; if (!m.g) compute(m);
  const ox = o.ox || 0, oy = o.oy || 0, out = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x;
    if (m.thin && m.thin[i]) for (const [id, how] of m.thin[i]) {
      if (how) continue; const s = sprite(m.biome, id); if (!s) continue;
      const cx = (x - y) * 32 + ox, cy = (x + y) * 16 + oy;
      out.push({ id, s, X: x, Y: y, dx: Math.round(cx - s.ox), dy: Math.round(cy - s.oy), w: s.w, h: s.h });
    }
    for (const id of [m.c[i], m.vobj[i]]) {
      if (!id) continue; const s = id === m.vobj[i] ? spriteAt(m, i, id) : sprite(m.biome, id); if (!s) continue;
      if (m.cut && m.cut[i] && (id === m.c[i] || DOOR_IDS.has(id))) continue;   // a stub: nothing to hide behind
      if (s.oy < 30 && !s.prop) continue;    // flat: rubble, grass tufts
      const cx = (x - y) * 32 + ox, cy = (x + y) * 16 + oy;
      out.push({ id, s, X: x, Y: y, dx: Math.round(s.flip ? cx + s.ox - s.w : cx - s.ox), dy: Math.round(cy - s.oy), w: s.w, h: s.h, flip: !!s.flip });
    }
  }
  return out;
}

// ───── pieces made of several tiles of the sheet (Flare's own)
const PREFABS = {
  tent1: { name: 'Tent', cells: [[0, 0, 73], [0, 1, 72]] }, tent2: { name: 'Tent (turned)', cells: [[0, 0, 74], [1, 0, 75]] },
  cabin1: { name: 'Cabin', cells: [[0, 2, 208], [1, 0, 211], [1, 1, 210], [1, 2, 209]] }, cabin2: { name: 'Cabin (turned)', cells: [[0, 1, 212], [1, 1, 213], [2, 0, 215], [2, 1, 214]] },
  tower: { name: 'Ruined tower', cells: [[0, 3, 216], [1, 3, 217], [2, 3, 218], [3, 0, 222], [3, 1, 221], [3, 2, 220], [3, 3, 219]] },
  temple: { name: 'Stair down', ground: true, cells: [[0, 3, 232], [1, 3, 233], [2, 3, 234], [3, 0, 238], [3, 1, 237], [3, 2, 236], [3, 3, 235]] },
  cave1: { name: 'Cave mouth', cells: [[0, 0, 225], [0, 1, 224]] }, cave2: { name: 'Cave mouth', cells: [[0, 0, 226], [1, 0, 227]] },
  cave3: { name: 'Mine mouth', cells: [[0, 0, 229], [0, 1, 228]] }, cave4: { name: 'Mine mouth', cells: [[0, 0, 230], [1, 0, 231]] }
};
const prefabOK = (biome, k) => PREFABS[k].cells.every(c => has(biome, c[2]));
// the nearest thing a land has to a piece it lacks (a bare tree for a leafy one, another shrub), or nothing
function standIn(biome, id, i) {
  const v = forBiome(biome, id); if (has(biome, v)) return v;
  const kin = id >= 240 && id <= 255 ? [244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 240, 241, 242, 243] : id >= 112 && id <= 127 ? [112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123] : id >= 128 && id <= 135 ? [128, 129, 130, 131, 132, 133, 134, 135] : [];
  const ok = kin.filter(k => has(biome, k)); return ok.length ? ok[(hash(i, id) >>> 3) % ok.length] : 0;
}
const GROUND_IDS = new Set([192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 232, 233, 234, 235, 236, 237, 238]);

function bridgeAt(m, x, y) {
  if (tAt(m, x, y) !== WATER) return false;
  const run = (dx, dy) => {
    let a = 0, b = 0; while (tAt(m, x - dx * (a + 1), y - dy * (a + 1)) === WATER) a++; while (tAt(m, x + dx * (b + 1), y + dy * (b + 1)) === WATER) b++;
    const s = [x - dx * (a + 1), y - dy * (a + 1)], e = [x + dx * (b + 1), y + dy * (b + 1)];
    const land = p => { const t = tAt(m, p[0], p[1]); return t === GRASS || t === PATH; };
    return land(s) && land(e) ? { s, e, n: a + b + 1, dx } : null;
  };
  const opts = [run(1, 0), run(0, 1)].filter(Boolean).sort((p, q) => p.n - q.n); if (!opts.length) return false;
  const { s, e, n, dx } = opts[0], ax = dx ? 0 : 1, W = m.w;
  m.over[s[1] * W + s[0]] = 192 + ax; m.over[e[1] * W + e[0]] = 194 + ax; m.obj[s[1] * W + s[0]] = 0; m.obj[e[1] * W + e[0]] = 0;
  for (let k = 1; k <= n; k++) {
    const cx = s[0] + (dx ? k : 0), cy = s[1] + (dx ? 0 : k);
    const piece = n === 1 ? 196 : k === 1 ? 204 : k === n ? 196 : [198, 200, 202][hash(cx, cy) % 3];
    m.over[cy * W + cx] = piece + ax; m.obj[cy * W + cx] = 0;
  }
  return true;
}

// ───── the generator
function rngOf(seed) {
  let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function noiseOf(R) {
  const G = 64, v = Float32Array.from({ length: G * G }, R); const at = (a, b) => v[((b % G + G) % G) * G + ((a % G + G) % G)];
  const one = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, s = t => t * t * (3 - 2 * t); const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * s(tx), b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * s(tx); return a + (b - a) * s(ty); };
  return (x, y, sc) => (one(x / sc, y / sc) * .65 + one(x / sc * 2.1 + 17, y / sc * 2.1 + 5) * .35);
}
const THEMES = [['meadow', 'Meadow'], ['river', 'River ford'], ['forest', 'Deep wood'], ['village', 'Village'], ['market', 'Market square'], ['camp', 'Camp'], ['graveyard', 'Graveyard'], ['ruins', 'Ruins']];
function morph(m, grow) {
  const n = m.terr.slice();
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    let c = 0; for (const [dx, dy] of NB) c += tAt(m, x + dx, y + dy) !== VOID; const i = y * m.w + x;
    if (grow && m.terr[i] === VOID && c >= 5 && x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1) n[i] = GRASS;
    if (!grow && m.terr[i] !== VOID && c <= 4) n[i] = VOID;
  }
  m.terr = n;
}
function keepLargest(m) {
  const W = m.w, H = m.h, lab = new Int32Array(W * H).fill(-1); let best = -1, bestN = 0, id = 0;
  for (let i = 0; i < W * H; i++) {
    if (m.terr[i] === VOID || lab[i] >= 0) continue; let n = 0; const st = [i]; lab[i] = id;
    while (st.length) { const j = st.pop(); n++; const x = j % W, y = (j / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (inb(m, xx, yy) && m.terr[yy * W + xx] !== VOID && lab[yy * W + xx] < 0) { lab[yy * W + xx] = id; st.push(yy * W + xx); } } }
    if (n > bestN) { bestN = n; best = id; } id++;
  }
  for (let i = 0; i < W * H; i++) if (m.terr[i] !== VOID && lab[i] !== best) m.terr[i] = VOID;
}
function distToVoid(m) {
  const W = m.w, H = m.h, d = new Int32Array(W * H).fill(1e6), q = [];
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) if (!inb(m, x, y) || m.terr[y * W + x] === VOID) {
    if (inb(m, x, y)) { d[y * W + x] = 0; q.push([x, y]); } else for (const [dx, dy] of NB) if (inb(m, x + dx, y + dy) && d[(y + dy) * W + x + dx] > 1) { d[(y + dy) * W + x + dx] = 1; q.push([x + dx, y + dy]); }
  }
  for (let h = 0; h < q.length; h++) { const [x, y] = q[h]; for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (inb(m, xx, yy) && d[yy * W + xx] > d[y * W + x] + 1) { d[yy * W + xx] = d[y * W + x] + 1; q.push([xx, yy]); } } }
  return d;
}

const THEMES_IN = [['dungeon', 'Dungeon'], ['crypt', 'Crypt'], ['hall', 'Pillared hall'], ['cellar', 'Cellars'], ['ruin', 'Fallen ruin'], ['cavern', 'Caverns'], ['lair', 'Bandit caves']];
const THEMES_INDOOR = [['tavern', 'Tavern'], ['house', 'House'], ['manor', 'Manor'], ['chapel', 'Chapel'], ['barracks', 'Barracks']];
const THEMES_KEEP = [['keep', 'Castle keep'], ['hall', 'Pillared hall'], ['dungeon', 'Dungeon'], ['cellar', 'Cellars']];
const themesFor = biome => { const k = kindOf(biome), b = data().biomes[biome]; return b && b.blocks ? THEMES_KEEP : k === 'in' ? THEMES_INDOOR : k === 'under' ? (b && b.natural ? THEMES_IN.slice(5).concat(THEMES_IN.slice(0, 5)) : THEMES_IN) : THEMES; };

// ───── a dungeon: rooms laid out by splitting the map (BSP), each in its own part, joined by corridors that find their
// way through the rock (A*: they keep straight, and clear of rooms they aren't going to), with archways where they come in
// o.rooms: 'few' | 'some' | 'many'; o.wide: two-wide corridors; o.loops: a few extra corridors so not every way is a dead end
function generateInside(o) {
  const R = rngOf(o.seed + '|' + o.theme + '|' + o.size + '|' + (o.rooms || '') + (o.wide ? 'w' : '')), S = o.size, dens = o.dens, B = o.biome, t = o.theme;
  const m = blank(S, S, B), I = (x, y) => y * S + x; m.terr.fill(VOID);
  const pick = a => a[Math.floor(R() * a.length)], ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const FLOOR = t === 'cellar' ? PATH : GRASS;
  const room = new Int16Array(S * S).fill(-1), rooms = [], door = new Uint8Array(S * S);
  const minLeaf = { few: 15, some: 11, many: 8 }[o.rooms || 'some'] || 11;
  // the hall: one great room in the middle first
  let hall = null;
  if (t === 'hall') { const w = Math.round(S * .5), h = Math.round(S * .34); hall = { x: Math.round((S - w) / 2), y: Math.round((S - h) / 2), w, h }; }
  // split the map
  const leaves = [], tree = [];
  (function split(x, y, w, h, depth) {
    const node = { x, y, w, h, kids: null, rooms: [] }; tree.push(node);
    const canH = w >= minLeaf * 2, canV = h >= minLeaf * 2;
    if ((!canH && !canV) || (depth > 2 && R() < .15)) { leaves.push(node); node.leaf = true; return node; }
    const horiz = canH && (!canV || (w > h ? R() < .75 : R() < .25));
    if (horiz) { const c = ri(minLeaf, w - minLeaf); node.kids = [split(x, y, c, h, depth + 1), split(x + c, y, w - c, h, depth + 1)]; }
    else { const c = ri(minLeaf, h - minLeaf); node.kids = [split(x, y, w, c, depth + 1), split(x, y + c, w, h - c, depth + 1)]; }
    return node;
  })(1, 1, S - 2, S - 2, 0);
  const carveRoom = (r, k) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      // round rooms and cut corners now and then
      if (r.shape === 'round') { const dx = (x + .5 - r.x - r.w / 2) / (r.w / 2), dy = (y + .5 - r.y - r.h / 2) / (r.h / 2); if (dx * dx + dy * dy > 1.05) continue; }
      if (r.shape === 'cut') { const ex = Math.min(x - r.x, r.x + r.w - 1 - x), ey = Math.min(y - r.y, r.y + r.h - 1 - y); if (ex + ey < 1) continue; }
      if (r.shape === 'cross') { const cx = Math.abs(x + .5 - r.x - r.w / 2) < r.w / 4 + .5, cy = Math.abs(y + .5 - r.y - r.h / 2) < r.h / 4 + .5; if (!cx && !cy) continue; }
      m.terr[I(x, y)] = FLOOR; room[I(x, y)] = k;
    }
  };
  if (hall) { hall.shape = 'rect'; hall.n = 0; hall.kind = 'hall'; rooms.push(hall); carveRoom(hall, 0); }
  for (const lf of leaves) {
    const mw = lf.w - 2, mh = lf.h - 2; if (mw < 4 || mh < 4) continue;
    const w = ri(Math.max(4, Math.round(mw * .5)), mw), h = ri(Math.max(4, Math.round(mh * .5)), mh);
    const r = { x: lf.x + 1 + ri(0, mw - w), y: lf.y + 1 + ri(0, mh - h), w, h };
    if (hall && r.x < hall.x + hall.w + 2 && r.x + r.w + 2 > hall.x && r.y < hall.y + hall.h + 2 && r.y + r.h + 2 > hall.y) continue;
    r.shape = w >= 6 && h >= 6 && t !== 'keep' ? pick(['rect', 'rect', 'rect', 'cut', 'round', 'cross']) : 'rect';
    if (t === 'cellar' || t === 'crypt') r.shape = r.shape === 'round' ? 'rect' : r.shape;
    r.n = rooms.length; lf.rooms.push(r); rooms.push(r); carveRoom(r, r.n);
  }
  // which rooms each part of the tree holds
  (function gather(nd) { if (nd.kids) { nd.rooms = gather(nd.kids[0]).concat(gather(nd.kids[1])); } return nd.rooms; })(tree[0]);
  if (hall) tree[0].rooms.push(hall);
  // ── corridors
  const mid = r => [r.x + (r.w >> 1), r.y + (r.h >> 1)];
  function heapPush(h, v) { h.push(v); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
  function heapPop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let s = i; if (l < h.length && h[l][0] < h[s][0]) s = l; if (r < h.length && h[r][0] < h[s][0]) s = r; if (s === i) break; [h[s], h[i]] = [h[i], h[s]]; i = s; } } return top; }
  const nearRoom = (x, y, a, b) => { for (const [dx, dy] of NB) { const k = room[I(x + dx, y + dy)]; if (k >= 0 && k !== a && k !== b) return true; } return false; };
  function corridor(A, Bm) {
    // from the middle of A to the middle of B; inside A and B it costs nothing, through other rooms it's barred
    const [sx, sy] = mid(A), [tx, ty] = mid(Bm), cost = new Float32Array(S * S * 4).fill(Infinity), prev = new Int32Array(S * S * 4).fill(-1);
    const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]], h = [], done = new Uint8Array(S * S * 4);
    const st = I(sx, sy) * 4; cost[st] = 0; heapPush(h, [0, st]);
    let end = -1;
    while (h.length) {
      const [, s] = heapPop(h); if (done[s]) continue; done[s] = 1; const c = cost[s];
      const cell = s >> 2, dir = s & 3, x = cell % S, y = (cell / S) | 0;
      if (x === tx && y === ty) { end = s; break; }
      for (let d = 0; d < 4; d++) {
        const nx = x + D4[d][0], ny = y + D4[d][1]; if (nx < 1 || ny < 1 || nx > S - 2 || ny > S - 2) continue;
        const k = room[I(nx, ny)]; if (k >= 0 && k !== A.n && k !== Bm.n) continue;
        let step = k >= 0 ? 0.2 : m.terr[I(nx, ny)] !== VOID ? 0.5 : 1;
        if (k < 0 && nearRoom(nx, ny, A.n, Bm.n)) step += 12;   // not along the side of another room
        if (d !== dir && c > 0) step += 3;                       // keep straight
        const ns = I(nx, ny) * 4 + d, nc = c + step;
        if (nc < cost[ns]) { cost[ns] = nc; prev[ns] = s; heapPush(h, [nc + (Math.abs(nx - tx) + Math.abs(ny - ty)) * .2, ns]); }
      }
    }
    if (end < 0) return;
    const path = []; for (let s = end; s >= 0; s = prev[s]) path.push(s >> 2);
    for (let i = 0; i < path.length; i++) {
      const c = path[i], x = c % S, y = (c / S) | 0; if (room[c] >= 0) continue;
      m.terr[c] = FLOOR;
      // a doorway where the corridor steps into a room
      const nb = [path[i - 1], path[i + 1]].filter(v => v !== undefined && room[v] >= 0);
      if (nb.length) door[c] = 1;
      if (o.wide && !door[c]) { const nx = path[i + 1] !== undefined ? path[i + 1] : path[i - 1], ddx = Math.abs((nx % S) - x); const ox = ddx ? 0 : 1, oy = ddx ? 1 : 0; if (x + ox < S - 1 && y + oy < S - 1 && room[I(x + ox, y + oy)] < 0 && !nearRoom(x + ox, y + oy, -2, -2)) m.terr[I(x + ox, y + oy)] = FLOOR; }
    }
  }
  (function link(nd) {
    if (!nd.kids) return; link(nd.kids[0]); link(nd.kids[1]);
    const a = nd.kids[0].rooms, b = nd.kids[1].rooms; if (!a.length || !b.length) return;
    let best = null, bd = 1e9;
    for (const p of a) for (const q of b) { const [ax, ay] = mid(p), [bx, by] = mid(q), d = Math.abs(ax - bx) + Math.abs(ay - by); if (d < bd) { bd = d; best = [p, q]; } }
    corridor(best[0], best[1]);
  })(tree[0]);
  if (hall) for (const r of rooms) if (r !== hall && R() < .5) corridor(r, hall);
  // a few loops, so not every way is a dead end
  const loops = o.loops === false ? 0 : Math.round(rooms.length / 4);
  for (let k = 0; k < loops; k++) { const a = pick(rooms), b = rooms.filter(r => r !== a).sort((p, q) => { const [ax, ay] = mid(a); return Math.hypot(mid(p)[0] - ax, mid(p)[1] - ay) - Math.hypot(mid(q)[0] - ax, mid(q)[1] - ay); })[1]; if (b) corridor(a, b); }
  // a fallen ruin: the rock has broken in, here and there
  if (t === 'ruin') {
    const N = noiseOf(R);
    for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) if (m.terr[I(x, y)] === VOID && N(x, y, 3.5) > .63) { let f = 0; for (const [dx, dy] of NB) f += m.terr[I(x + dx, y + dy)] !== VOID; if (f >= 3) m.terr[I(x, y)] = FLOOR; }
  }
  // tidy: two floors touching only at a corner get a step between them; a lone rock cell in a floor stays (it's a pillar)
  for (let it = 0; it < 3; it++) for (let y = 1; y < S - 2; y++) for (let x = 1; x < S - 2; x++) {
    const a = m.terr[I(x, y)] !== VOID, b = m.terr[I(x + 1, y)] !== VOID, c = m.terr[I(x, y + 1)] !== VOID, d = m.terr[I(x + 1, y + 1)] !== VOID;
    if (a && d && !b && !c) m.terr[I(x + 1, y)] = FLOOR;
    if (b && c && !a && !d) m.terr[I(x, y)] = FLOOR;
  }
  // rises in a cave's floor (o.hills), kept down by the doorways and corridors
  if ((data().biomes[B] || {}).natural) caveRises(m, R, o.hills, (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (inb(m, xx, yy) && (door[I(xx, yy)] || (m.terr[I(xx, yy)] !== VOID && room[I(xx, yy)] !== room[I(x, y)]))) return true; } return false; });
  compute(m);
  if (t === 'keep') return keepRooms(m, rooms, room, door, R, dens, o);
  // ── what's in the rooms
  const occ = new Uint8Array(S * S);
  const isFloor = (x, y) => tAt(m, x, y) !== VOID;
  const free = (x, y) => inb(m, x, y) && !occ[I(x, y)] && isFloor(x, y) && !m.obj[I(x, y)] && !door[I(x, y)] && !(m.cut[I(x, y)] === 2);   // (nothing on a ledge)
  // keep a doorway's way in clear
  for (let i = 0; i < S * S; i++) if (door[i]) { const x = i % S, y = (i / S) | 0; for (const [dx, dy] of NB) if (inb(m, x + dx, y + dy)) occ[I(x + dx, y + dy)] = 1; }
  // corridors too: nothing stands in them
  for (let i = 0; i < S * S; i++) if (isFloor(i % S, (i / S) | 0) && room[i] < 0) occ[i] = 1;
  const backWall = (x, y) => !isFloor(x, y - 1) || !isFloor(x - 1, y);       // against a wall we can see
  const anyWall = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isFloor(x + dx, y + dy));
  const open4 = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => isFloor(x + dx, y + dy));
  const put = (x, y, id) => { id = forBiome(B, id); if (!has(B, id) || !free(x, y)) return false; m.obj[I(x, y)] = id; occ[I(x, y)] = 1; return true; };
  const putBig = (x, y, id) => { id = forBiome(B, id); const s = sprite(B, id); if (!s) return false; for (let j = 0; j < s.fh; j++) for (let k = 0; k < s.fw; k++) if (!free(x - k, y - j) || !open4(x - k, y - j)) return false; m.obj[I(x, y)] = id; for (let j = -1; j <= s.fh; j++) for (let k = -1; k <= s.fw; k++) if (inb(m, x - k, y - j)) occ[I(x - k, y - j)] = 1; return true; };
  const cellsOf = (r, f) => { const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (room[I(x, y)] === r.n && (!f || f(x, y))) out.push([x, y]); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const some = (r, ids, n, f) => { let k = n; for (const [x, y] of cellsOf(r, f)) { if (k <= 0) break; if (put(x, y, pick(ids))) k--; } return n - k; };
  const PILLAR = [610, 611, 612, 613, 614, 615], CRUMBLE = [572, 573, 574, 620, 621], RUBBLE = [575, 576, 577, 578, 579, 580, 581], FLOORBITS = [533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547];
  const STATUE = [628, 629, 630, 631, 632, 633], TORCH = [634, 635, 636, 637], TOMB = [1226, 1227, 1228, 1229], STONE_STATUE = [1222, 1223, 1224, 1225];
  const GOODS = [1000, 1001, 1003, 1018, 1019, 1020, 1021, 1022, 1023, 1026, 1027, 1036, 1037, 1038, 1039, 1040], CHAIRS = [1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407], TABLES = [1410, 1411, 1412, 1413];
  const CHESTS = [1022, 1023, 1024, 1025], BOXES = [1244, 1245, 1246, 1247], JARS = [1214, 1215, 1216, 1230, 1231, 1232, 1233, 1234, 1235], TRAPS = [1217, 1218, 1219, 1220, 1221], DUMMIES = [1206, 1207, 1208, 1209];
  const sizeOf = r => cellsOf(r).length;
  // each room's purpose: the first is the way in, the furthest the way down
  const far = rooms.slice().sort((p, q) => { const [ax, ay] = mid(rooms[0]); return Math.hypot(mid(q)[0] - ax, mid(q)[1] - ay) - Math.hypot(mid(p)[0] - ax, mid(p)[1] - ay); })[0];
  for (const r of rooms) {
    const area = sizeOf(r);
    // torches on the walls we see, one to every few paces
    some(r, TORCH, Math.max(1, Math.round(area / 16)), (x, y) => backWall(x, y));
    if (r === rooms[0] && !hall) { for (const [x, y] of cellsOf(r, (x, y) => open4(x, y))) if (putBig(x, y, 1420 + (R() < .5 ? 0 : 1))) break; }
    if (r === far && r !== rooms[0]) { for (const [x, y] of cellsOf(r, (x, y) => open4(x, y))) if (putBig(x, y, 1422 + (R() < .5 ? 0 : 1))) break; }
    let kind = r.kind;
    if (!kind) {
      if (t === 'crypt') kind = area > 20 ? 'tombs' : pick(['tombs', 'shrine', 'ossuary']);
      else if (t === 'cellar') kind = pick(['store', 'store', 'common', 'wine']);
      else kind = area > 45 && R() < .5 ? 'pillars' : pick(['store', 'guard', 'empty', 'treasure', 'shrine', 'barracks', 'prison']);
    }
    r.kind = kind;
    if (kind === 'hall') {
      for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) { put(x, r.y + 1, pick(PILLAR)); put(x, r.y + r.h - 2, pick(PILLAR)); }
      const cy = r.y + (r.h >> 1); for (let x = r.x + 2; x < r.x + r.w - 2; x++) for (const y of [cy - 1, cy]) m.over[I(x, y)] = 405;   // (the plain red carpet, as a runner)
      put(r.x + r.w - 1, cy - 1, pick(STATUE)); put(r.x + r.w - 1, cy, pick(STATUE));
      some(r, STONE_STATUE, 2, (x, y) => backWall(x, y));
    } else if (kind === 'pillars') {
      for (let y = r.y + 1; y < r.y + r.h - 1; y += 3) for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) put(x, y, pick(t === 'ruin' ? CRUMBLE : PILLAR));
    } else if (kind === 'tombs') {
      for (let y = r.y + 1; y < r.y + r.h - 1; y += 2) for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) if (R() < .75) put(x, y, R() < .85 ? pick(TOMB) : pick(STONE_STATUE));
    } else if (kind === 'ossuary') { some(r, JARS, Math.round(area / 3), (x, y) => anyWall(x, y)); some(r, STATUE, 1, (x, y) => backWall(x, y)); }
    else if (kind === 'shrine') { some(r, STATUE, 1, (x, y) => backWall(x, y)) || some(r, STONE_STATUE, 1); some(r, JARS, 3, (x, y) => anyWall(x, y)); if (area > 20 && r.w >= 5 && r.h >= 5) for (let y = r.y + 2; y < r.y + r.h - 2; y++) for (let x = r.x + 2; x < r.x + r.w - 2; x++) if (m.terr[I(x, y)] !== VOID) m.over[I(x, y)] = 405; }
    else if (kind === 'store' || kind === 'wine') some(r, kind === 'wine' ? [1018, 1019, 1020, 1021, 1026, 1027] : GOODS.concat(BOXES), Math.round(area / 3.5 * (0.6 + dens)), (x, y) => anyWall(x, y) || R() < .2);
    else if (kind === 'common' || kind === 'guard' || kind === 'barracks') {
      const nT = kind === 'common' ? Math.max(1, Math.round(area / 14)) : 1;
      for (const [x, y] of cellsOf(r, (x, y) => open4(x, y))) { if (!nT) break; if (put(x, y, pick(TABLES))) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (R() < .6) put(x + dx, y + dy, pick(CHAIRS)); if (cellsOf(r, (a, b) => (m.obj[I(a, b)] || 0) >= 1410 && m.obj[I(a, b)] < 1420).length >= nT) break; } }
      if (kind === 'guard') some(r, DUMMIES.concat([1200, 1201]), 2, (x, y) => anyWall(x, y));
      if (kind === 'barracks') some(r, BOXES.concat(CHESTS), Math.round(area / 8), (x, y) => anyWall(x, y));
      if (kind === 'common') some(r, [1018, 1019, 1020, 1021, 1026, 1027], 3, (x, y) => anyWall(x, y));
    } else if (kind === 'treasure') { some(r, CHESTS, 2, (x, y) => backWall(x, y)); some(r, TRAPS, 2, (x, y) => !anyWall(x, y)); some(r, JARS, 2, (x, y) => anyWall(x, y)); }
    else if (kind === 'prison') some(r, [1200, 1201, 1202, 1203, 1204, 1205, ...BOXES], 3, (x, y) => anyWall(x, y));
    if (kind === 'hall' || kind === 'shrine') some(r, [1726, 1727], 2, (x, y) => !anyWall(x, y));
    if (kind === 'pillars' || kind === 'guard' || kind === 'barracks') some(r, [1709, 1710, 1711, 1712, 1713, 1714], 1, (x, y) => anyWall(x, y));
    if (kind === 'common') some(r, [1700, 1701, 1702, 1703, 1704, 1705, 1706, 1707, 1708], 3);
    // the floor: rubble and broken tiles, more in a ruin
    some(r, RUBBLE, Math.round(area / (t === 'ruin' ? 6 : 16) * (0.5 + dens)), (x, y) => anyWall(x, y) || R() < .3);
    some(r, FLOORBITS, Math.round(area / (t === 'ruin' ? 5 : 14) * (0.5 + dens)));
  }
  // archways where corridors come into rooms: in the line of the wall
  for (let i = 0; i < S * S; i++) {
    if (!door[i] || m.obj[i] || o.doors === false) continue;
    const x = i % S, y = (i / S) | 0, wx = !isFloor(x - 1, y) && !isFloor(x + 1, y), wy = !isFloor(x, y - 1) && !isFloor(x, y + 1);
    if (wx && !wy) m.obj[i] = R() < .7 ? DOORS.x[0] : pick(DOORS.x);
    else if (wy && !wx) m.obj[i] = R() < .7 ? DOORS.y[0] : pick(DOORS.y);
  }
  m.rooms = rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind }));
  return compute(m);
}

// a keep's rooms: the biggest the great hall, then the rest by size: barracks, a kitchen, an armoury, stores, the lord's
// chamber, a chapel, a library, a dining room, more bunks. Gates (portcullises) in some doorways, the rest left open
function keepRooms(m, rooms, room, door, R, dens, o) {
  const S = m.w, I = (x, y) => y * S + x, pick = a => a[Math.floor(R() * a.length)];
  const order = rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  const KINDS = ['bunks', 'kitchen', 'armoury', 'store', 'bed', 'nave', 'library', 'dining', 'bunks', 'store', 'study', 'private', 'armoury', 'bunks'];
  order.forEach((r, k) => { r.kind = k === 0 ? 'greathall' : KINDS[(k - 1) % KINDS.length]; });
  furnish(m, rooms, room, R, 'keep', dens, door);
  for (let i = 0; i < S * S; i++) {
    if (!door[i] || m.obj[i] || o.doors === false || R() < .6) continue;
    const x = i % S, y = (i / S) | 0, fl = (a, b) => tAt(m, a, b) !== VOID, wx = !fl(x - 1, y) && !fl(x + 1, y), wy = !fl(x, y - 1) && !fl(x, y + 1);
    if (wx && !wy) m.obj[i] = DOORS.x[1]; else if (wy && !wx) m.obj[i] = DOORS.y[1];
  }
  m.rooms = rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind }));
  return compute(m);
}

// rises in a cave's floor (m.lv), as outdoors: ragged blobs raised a level (two, now and then) in the open parts of the
// caves (three or more from the rock); hills: 'none' | 'some' (the default) | 'lots'; stay(x, y): a cell kept down
function caveRises(m, R, hills, stay) {
  hills = hills || 'some'; if (hills === 'none') return;
  const S = m.w, H = m.h, I = (x, y) => y * S + x, N = noiseOf(R), d = new Int16Array(S * H).fill(999), q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) if (m.terr[I(x, y)] === VOID) { d[I(x, y)] = 0; q.push(I(x, y)); }
  for (let h = 0; h < q.length; h++) { const x = q[h] % S, y = (q[h] / S) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (inb(m, xx, yy) && d[I(xx, yy)] > d[q[h]] + 1) { d[I(xx, yy)] = d[q[h]] + 1; q.push(I(xx, yy)); } } }
  const open = []; for (let i = 0; i < S * H; i++) if (d[i] >= 3 && d[i] < 999) open.push(i);
  if (!open.length) return;
  const lv = new Uint8Array(S * H), n = Math.max(1, Math.round(open.length / (hills === 'lots' ? 60 : 160)));
  for (let b = 0; b < n; b++) {
    const c = open[Math.floor(R() * open.length)], bx = c % S + .5, by = ((c / S) | 0) + .5, rad = (hills === 'lots' ? 3 : 2.5) + R() * 3.5, tiers = R() < (hills === 'lots' ? .45 : .15) ? 2 : 1;
    for (let y = Math.max(0, Math.floor(by - rad * 2)); y < Math.min(H, by + rad * 2); y++) for (let x = Math.max(0, Math.floor(bx - rad * 2)); x < Math.min(S, bx + rad * 2); x++) {
      if (m.terr[I(x, y)] === VOID) continue;
      const ax = Math.abs(x + .5 - bx), ay = Math.abs(y + .5 - by), dd = Math.max(ax, ay) * .5 + Math.hypot(ax, ay) * .5 + (N(x, y, 4) - .5) * rad * .6;
      for (let k = 1; k <= tiers; k++) if (dd < rad * (k === 1 ? 1 : .5)) lv[I(x, y)] = Math.max(lv[I(x, y)], k);
    }
  }
  if (stay) for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) if (lv[I(x, y)] && stay(x, y)) lv[I(x, y)] = 0;
  // (no ledge a cell wide: a cell higher than most of its neighbours comes down to them)
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
    const v = lv[I(x, y)]; if (!v) continue; let same = 0; for (const [dx, dy] of NB) if (lvAt({ lv, w: S, h: H }, x + dx, y + dy) >= v || tAt(m, x + dx, y + dy) === VOID) same++;
    if (same < 5) lv[I(x, y)] = v - 1;
  }
  if (lv.some(v => v)) m.lv = lv;
}
// ───── caverns: grown, not built. Rock and floor at random, smoothed (a cell turns to rock when most round it are rock,
// to floor when most are floor) till it settles into caves; the small pockets go, the rest are joined by winding
// tunnels. Then what grows and lies in caves: stalagmites by the walls, columns in the open, mushrooms and crystals
// in clumps, rocks and bones. A lair has a camp in its biggest cave.
// o.rooms: 'few' (big open caves) | 'some' | 'many' (tighter, more of them); o.wide: tunnels two wide
function generateCavern(o) {
  const S = o.size, B = o.biome, t = o.theme, dens = o.dens;
  const fill = { few: .55, some: .5, many: .46 }[o.rooms] || .5;
  let m, I = (x, y) => y * S + x, best = null, R;
  for (let attempt = 0; attempt < 6; attempt++) {
    R = rngOf(o.seed + '|cave|' + t + '|' + S + '|' + (o.rooms || '') + (o.wide ? 'w' : '') + attempt);
    m = blank(S, S, B); m.terr.fill(VOID);
    let f = new Uint8Array(S * S);
    for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) f[I(x, y)] = R() < fill ? 1 : 0;
    const rock = (g, x, y) => x < 2 || y < 2 || x >= S - 2 || y >= S - 2 || !g[I(x, y)];
    for (let it = 0; it < 6; it++) {
      const g = new Uint8Array(S * S);
      for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
        let n = 0; for (const [dx, dy] of NB) n += rock(f, x + dx, y + dy);
        g[I(x, y)] = n >= 5 ? 0 : n <= 3 ? 1 : f[I(x, y)];
      }
      f = g;
    }
    // the caves: each part joined up on its own
    const reg = new Int32Array(S * S).fill(-1), parts = [];
    for (let i = 0; i < S * S; i++) if (f[i] && reg[i] < 0) {
      const cells = [i]; reg[i] = parts.length;
      for (let k = 0; k < cells.length; k++) { const x = cells[k] % S, y = (cells[k] / S) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = I(x + dx, y + dy); if (f[j] && reg[j] < 0) { reg[j] = parts.length; cells.push(j); } } }
      parts.push(cells);
    }
    const keep = parts.filter(c => c.length >= 14).sort((a, b) => b.length - a.length);
    const area = keep.reduce((a, c) => a + c.length, 0);
    if (!best || area > best.area) best = { m, f, keep, area, R };
    if (area > S * S * .28) break;
  }
  ({ m, R } = best); const keep = best.keep;
  const pick = a => a[Math.floor(R() * a.length)];
  for (const c of keep) for (const i of c) m.terr[i] = GRASS;
  // tunnels: from each cave to the nearest of those already joined, wandering a little on the way
  const joined = new Set(keep.length ? keep[0] : []);
  const dig = (x, y) => { for (const [dx, dy] of o.wide ? [[0, 0], [1, 0], [0, 1]] : [[0, 0]]) { const a = x + dx, b = y + dy; if (a >= 2 && b >= 2 && a < S - 2 && b < S - 2) m.terr[I(a, b)] = GRASS; } };
  for (const c of keep.slice(1)) {
    let bd = 1e9, from = 0, to = 0;
    for (let k = 0; k < c.length; k += 3) { const ax = c[k] % S, ay = (c[k] / S) | 0; for (const j of joined) { const d = Math.abs(j % S - ax) + Math.abs(((j / S) | 0) - ay); if (d < bd) { bd = d; from = c[k]; to = j; } } }
    let x = from % S, y = (from / S) | 0; const tx = to % S, ty = (to / S) | 0;
    for (let steps = 0; (x !== tx || y !== ty) && steps < S * 4; steps++) {
      if (R() < .25) { if (R() < .5) x += R() < .5 ? -1 : 1; else y += R() < .5 ? -1 : 1; }
      else if (Math.abs(tx - x) > Math.abs(ty - y) || (Math.abs(tx - x) === Math.abs(ty - y) && R() < .5)) x += Math.sign(tx - x); else y += Math.sign(ty - y);
      x = Math.max(2, Math.min(S - 3, x)); y = Math.max(2, Math.min(S - 3, y)); dig(x, y);
    }
    for (const i of c) joined.add(i);
  }
  // tidy: no floors touching only at a corner
  for (let it = 0; it < 3; it++) for (let y = 1; y < S - 2; y++) for (let x = 1; x < S - 2; x++) {
    const a = m.terr[I(x, y)] !== VOID, b = m.terr[I(x + 1, y)] !== VOID, c = m.terr[I(x, y + 1)] !== VOID, d = m.terr[I(x + 1, y + 1)] !== VOID;
    if (a && d && !b && !c) m.terr[I(x + 1, y)] = GRASS;
    if (b && c && !a && !d) m.terr[I(x, y)] = GRASS;
  }
  caveRises(m, R, o.hills);
  compute(m);
  // ── what's in the caves
  const isFloor = (x, y) => tAt(m, x, y) !== VOID, occ = new Uint8Array(S * S);
  const walls4 = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isFloor(x + dx, y + dy)).length;
  const open8 = (x, y) => NB.every(([dx, dy]) => isFloor(x + dx, y + dy));
  const free = (x, y) => inb(m, x, y) && isFloor(x, y) && !occ[I(x, y)] && !m.obj[I(x, y)] && m.cut[I(x, y)] !== 2;   // (nothing on a ledge)
  const ok = ids => ids.map(id => forBiome(B, id)).filter(id => has(B, id));
  const put = (x, y, ids) => { if (!ids.length || !free(x, y)) return false; m.obj[I(x, y)] = pick(ids); occ[I(x, y)] = 1; return true; };
  const putBig = (x, y, id) => { id = forBiome(B, id); const s = sprite(B, id); if (!s) return false; for (let j = 0; j < s.fh; j++) for (let k = 0; k < s.fw; k++) if (!free(x - k, y - j) || !open8(x - k, y - j)) return false; m.obj[I(x, y)] = id; for (let j = -1; j <= s.fh; j++) for (let k = -1; k <= s.fw; k++) if (inb(m, x - k, y - j)) occ[I(x - k, y - j)] = 1; return true; };
  const floor = []; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (isFloor(x, y)) floor.push([x, y]);
  for (let i = floor.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [floor[i], floor[j]] = [floor[j], floor[i]]; }
  const A = floor.length;
  const STALAG = ok([668, 669, 670, 671, 578, 579]), COLUMN = ok([672, 673, 610, 611, 572]), MUSH = ok([664, 665]), CRYSTAL = ok([666, 667]);
  const ROCKS = ok([674, 675, 676, 575, 576, 577]), STONES = ok(Array.from({ length: 118 }, (_, k) => 1900 + k)).filter(id => /^(Dark|Slate|Brown) /.test(sprite(B, id).name || '')), BONES = [352, 353, 354, 355, 348, 349, 350, 351].filter(id => has(B, id));
  // the way in and the way down: as far apart as the caves allow
  const stairs = [];
  for (const [x, y] of floor) if (putBig(x, y, 1420 + (R() < .5 ? 0 : 1))) { stairs.push([x, y]); break; }
  if (stairs.length) { const [sx, sy] = stairs[0]; const far = floor.slice().sort((p, q) => Math.hypot(q[0] - sx, q[1] - sy) - Math.hypot(p[0] - sx, p[1] - sy)); for (const [x, y] of far.slice(0, 80)) if (putBig(x, y, 1422 + (R() < .5 ? 0 : 1))) break; }
  // a lair: a camp in the open, a fire and the gang's goods round it
  if (t === 'lair') {
    const spots = floor.filter(([x, y]) => open8(x, y) && NB.every(([dx, dy]) => open8(x + dx, y + dy)));
    const camps = Math.max(1, Math.round(A / 260));
    for (let k = 0, s = 0; k < camps && s < spots.length; s++) {
      const [x, y] = spots[s]; if (!free(x, y)) continue;
      put(x, y, ok([1754])); k++;
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) if (R() < .7) put(x + dx, y + dy, ok([1744, 1745, 1746, 1747, 1748, 1749, 1750, 1751, 1752, 1753, 1022, 1023, 1244, 1245, 1018, 1019]));
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1]]) if (R() < .5) put(x + dx, y + dy, ok([1400, 1401, 1402, 1403]));
    }
    let n = Math.round(A / 120); for (const [x, y] of floor) { if (n <= 0) break; if (walls4(x, y) && put(x, y, ok([1709, 1710, 1711, 1712, 1713]))) n--; }
    n = Math.round(A / 80); for (const [x, y] of floor) { if (n <= 0) break; if (walls4(x, y) && put(x, y, ok([1000, 1001, 1003, 1026, 1027, 1244, 1245, 1246, 1247, 1220, 1221]))) n--; }
  }
  const k = .5 + dens;
  // stalagmites and rocks against the walls; columns where it's open; mushrooms and crystals in clumps
  let n = Math.round(A / 22 * k); for (const [x, y] of floor) { if (n <= 0) break; if (walls4(x, y) >= 1 && R() < .6 && put(x, y, R() < .6 ? STALAG : ROCKS.concat(STONES.length ? [pick(STONES)] : []))) n--; }
  n = Math.round(A / 90 * k); for (const [x, y] of floor) { if (n <= 0) break; if (open8(x, y) && put(x, y, COLUMN)) n--; }
  const clumps = (ids, count, size) => { if (!ids.length) return; let c = count; for (const [x, y] of floor) { if (c <= 0) break; if (!free(x, y) || !walls4(x, y)) continue; put(x, y, ids); c--; for (let s = 0; s < size; s++) { const [dx, dy] = pick(NB); put(x + dx, y + dy, ids); } } };
  clumps(MUSH, Math.round(A / 140 * k), 3); clumps(CRYSTAL, Math.round(A / 220 * k), 2);
  n = Math.round(A / 30 * k); for (const [x, y] of floor) { if (n <= 0) break; if (put(x, y, STONES)) n--; }
  n = Math.round(A / 45 * k); for (const [x, y] of floor) { if (n <= 0) break; if (!m.obj[I(x, y)] && BONES.length) { m.over[I(x, y)] = pick(BONES); n--; } }
  m.rooms = [];
  return compute(m);
}

// ───── indoors: a building laid out as such places are, then furnished room by room.
//  - a tavern or a house: a big room at the front (the way in), the working rooms behind it (kitchen, then the store off
//    the kitchen), private rooms off the big room; a manor or barracks: a hallway down the middle with rooms either side,
//    the way in at its front end; a chapel: the nave, the vestry behind the altar
//  - each room has one door, to the room it's reached from (and a store a second, to the kitchen)
//  - against the walls: what stands against walls (bookcases, barrels, chests), turned to face into the room, and never
//    in front of a door or a window; in the open: tables in rows with an aisle round each, their chairs facing them
//  - the windows go in the outside walls, spaced along them (thinWalls)
function generateIndoor(o) {
  const R = rngOf(o.seed + '|in2|' + o.theme + '|' + o.size), S = o.size, dens = o.dens, B = o.biome, t = o.theme;
  const m = blank(S, S, B), I = (x, y) => y * S + x; m.terr.fill(VOID);
  const pick = a => a[Math.floor(R() * a.length)], ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const big = ({ tavern: .66, house: .44, manor: .8, chapel: .64, barracks: .7 }[t] || .6) * (.86 + R() * .2);
  let bw = Math.max(7, Math.round((S - 4) * big)), bh = Math.max(6, Math.round((S - 4) * big * (t === 'chapel' ? .5 : t === 'house' ? .8 : .7)));
  if (R() < .5 && t !== 'chapel') [bw, bh] = [bh, bw];   // (long either way)
  const bx = Math.round((S - bw) / 2), by = Math.round((S - bh) / 2);
  const FL = t === 'chapel' || t === 'manor' ? GRASS : PATH;   // stone floors in a chapel or a manor, boards elsewhere
  const room = new Int16Array(S * S).fill(-1), rooms = [], doors = [];
  const addRoom = (x, y, w, h, kind) => { if (w < 2 || h < 2) return null; const r = { x, y, w, h, kind, n: rooms.length }; rooms.push(r); for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { m.terr[I(xx, yy)] = FL; room[I(xx, yy)] = r.n; } return r; };
  // a door between two rooms (or a room and outside): on their shared edge, away from its ends where it can be
  const doorBetween = (a, b) => {
    const opts = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = room[I(x, y)]; if (k !== a.n) continue;
      for (const [dx, dy, edge] of [[1, 0, 'W'], [0, 1, 'N'], [-1, 0, 'W0'], [0, -1, 'N0']]) {
        const xx = x + dx, yy = y + dy; if (!inb(m, xx, yy)) continue;
        const other = room[I(xx, yy)]; if (b ? other !== b.n : other !== -1) continue;
        // the edge, as the cell whose W or N edge it is
        const cell = edge === 'W' ? [xx, yy, 'W'] : edge === 'N' ? [xx, yy, 'N'] : edge === 'W0' ? [x, y, 'W'] : [x, y, 'N'];
        // how far from a corner along the shared run: the middle is best
        const along = edge[0] === 'W' ? (b ? Math.min(y - Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h) - 1 - y) : Math.min(y - a.y, a.y + a.h - 1 - y))
          : (b ? Math.min(x - Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w) - 1 - x) : Math.min(x - a.x, a.x + a.w - 1 - x));
        opts.push([cell, along]);
      }
    }
    if (!opts.length) return false;
    const best = Math.max(...opts.map(o => o[1])), good = opts.filter(o => o[1] >= Math.min(best, 1) && o[1] >= best - 1);
    const [[x, y, k]] = pick(good);
    m.edge[I(x, y)] |= k === 'W' ? 4 : 8; doors.push([x, y, k]); return true;
  };
  // ── the layout
  const front = (r, f, keep) => {   // split a block: the part at its front (toward +x or +y, the open side) and the part behind it
    const alongX = r.w >= r.h, d = Math.max(3, Math.round((alongX ? r.h : r.w) * f));
    return alongX ? [{ x: r.x, y: r.y + r.h - d, w: r.w, h: d }, { x: r.x, y: r.y, w: r.w, h: r.h - d }, 'x'] : [{ x: r.x + r.w - d, y: r.y, w: d, h: r.h }, { x: r.x, y: r.y, w: r.w - d, h: r.h }, 'y'];
  };
  const cut = (r, axis, sizes) => {   // a strip cut into pieces along its length
    const out = []; let p = axis === 'x' ? r.x : r.y; const end = axis === 'x' ? r.x + r.w : r.y + r.h;
    sizes.forEach((sz, i) => { const len = i === sizes.length - 1 ? end - p : Math.min(sz, end - p); if (len >= 2) out.push(axis === 'x' ? { x: p, y: r.y, w: len, h: r.h } : { x: r.x, y: p, w: r.w, h: len }); p += len; });
    return out;
  };
  const block = { x: bx, y: by, w: bw, h: bh };
  let entrance = null;
  if (t === 'tavern' || t === 'house') {
    const [fr, bk, ax] = front(block, (t === 'tavern' ? .58 : .55) + (R() - .5) * .16);
    const hall = addRoom(fr.x, fr.y, fr.w, fr.h, t === 'tavern' ? 'common' : 'living'); entrance = hall;
    // behind: the kitchen, a store off it, and a private room or two
    const len = ax === 'x' ? bk.w : bk.h, kw = Math.max(3, Math.round(len * (t === 'tavern' ? .38 : .45) * (.85 + R() * .3)));
    const parts = cut(bk, ax, t === 'tavern' ? [kw, Math.max(3, Math.round(len * .24)), 99] : [kw, 99]);
    const kinds = t === 'tavern' ? ['kitchen', 'store', 'private'] : ['kitchen', 'bed'];
    const back = parts.map((p, i) => addRoom(p.x, p.y, p.w, p.h, kinds[i] || 'private')).filter(Boolean);
    const kitchen = back.find(r => r.kind === 'kitchen');
    for (const r of back) { if (r.kind === 'store' && kitchen) doorBetween(r, kitchen); else doorBetween(r, hall); }
    // a wing: more private rooms, reached from the big room
    if (R() < .6) {
      const right = R() < .5, ww = Math.round(bw * .45), wh = Math.round(bh * .6);
      const wg = right ? { x: bx + bw, y: by, w: Math.min(ww, S - 2 - bx - bw), h: wh } : { x: bx, y: by + bh, w: wh > 0 ? Math.round(bw * .5) : 0, h: Math.min(Math.round(bh * .45), S - 2 - by - bh) };
      if (wg.w >= 3 && wg.h >= 3) { const r = addRoom(wg.x, wg.y, wg.w, wg.h, t === 'tavern' ? 'private' : 'bed'); if (r && !doorBetween(r, hall)) doorBetween(r, back[back.length - 1] || hall); }
    }
  } else if (t === 'manor' || t === 'barracks') {
    // a hallway down the middle, the length of the building; rooms either side
    const alongX = bw >= bh, short = alongX ? bh : bw, hw = short >= 11 ? 2 : 1;
    const side1 = Math.max(3, Math.floor((short - hw) / 2) + (R() < .5 ? 0 : -1)), side2 = short - hw - side1;
    const hall = alongX ? addRoom(bx, by + side1, bw, hw, 'hallway') : addRoom(bx + side1, by, hw, bh, 'hallway');
    entrance = hall;
    const strips = alongX ? [{ x: bx, y: by, w: bw, h: side1 }, { x: bx, y: by + side1 + hw, w: bw, h: side2 }] : [{ x: bx, y: by, w: side1, h: bh }, { x: bx + side1 + hw, y: by, w: side2, h: bh }];
    const lenAll = alongX ? bw : bh, list = [];
    for (const st of strips) {
      if ((alongX ? st.h : st.w) < 3) continue;
      const sizes = []; let left = lenAll; while (left > 0) { const sz = Math.min(left, ri(4, t === 'manor' ? 7 : 6)); sizes.push(left - sz < 3 ? left : sz); left -= sizes[sizes.length - 1]; }
      for (const p of cut(st, alongX ? 'x' : 'y', sizes)) { const r = addRoom(p.x, p.y, p.w, p.h, 'room'); if (r) list.push(r); }
    }
    // what each is: the biggest the great hall (manor) or the mess (barracks); the kitchen and its store at the back end
    list.sort((p, q) => q.w * q.h - p.w * p.h);
    const atBack = r => alongX ? r.x : r.y;
    const backmost = list.slice().sort((p, q) => atBack(p) - atBack(q));
    if (list[0]) list[0].kind = t === 'manor' ? 'greathall' : 'mess';
    const kitchen = backmost.find(r => r.kind === 'room'); if (kitchen) kitchen.kind = 'kitchen';
    const store = backmost.find(r => r.kind === 'room'); if (store) store.kind = 'store';
    const rest = t === 'manor' ? ['library', 'bed', 'bed', 'dining', 'study', 'bed', 'bed'] : ['bunks', 'armoury', 'bunks', 'office', 'bunks', 'bunks'];
    let k = 0; for (const r of list) if (r.kind === 'room') r.kind = rest[k++ % rest.length];
    for (const r of list) doorBetween(r, hall);
    if (kitchen && store && !doorBetween(store, kitchen)) { /* (they may not touch) */ }
  } else {   // chapel: the nave, and the vestry behind its altar end
    const alongX = bw >= bh, vd = Math.max(3, Math.round((alongX ? bw : bh) * (.18 + R() * .08)));
    const nave = alongX ? addRoom(bx + vd, by, bw - vd, bh, 'nave') : addRoom(bx, by + vd, bw, bh - vd, 'nave');
    const vestry = alongX ? addRoom(bx, by, vd, bh, 'vestry') : addRoom(bx, by, bw, vd, 'vestry');
    doorBetween(vestry, nave); entrance = nave; nave.altarAt = alongX ? 'x' : 'y';
  }
  // the walls between rooms: wherever two rooms meet (a door in one only where it was put)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = room[I(x, y)]; if (k < 0) continue;
    if (x > 0 && room[I(x - 1, y)] >= 0 && room[I(x - 1, y)] !== k) m.edge[I(x, y)] |= 1;
    if (y > 0 && room[I(x, y - 1)] >= 0 && room[I(x, y - 1)] !== k) m.edge[I(x, y)] |= 2;
  }
  // the way in: the front wall (+x or +y side, where the building faces the viewer) of the entrance room, near its middle
  if (entrance) {
    const e = entrance, onX = e.kind === 'hallway' ? e.w < e.h : R() < .5;   // (a hallway: in at its end)
    if (onX && e.x + e.w < S) { const y = e.kind === 'hallway' ? e.y + (e.h >> 1) : e.y + Math.max(1, Math.min(e.h - 2, (e.h >> 1) + ri(-1, 1))); m.edge[I(e.x + e.w, y)] |= 1 | 4; doors.push([e.x + e.w, y, 'W']); }
    else if (e.y + e.h < S) { const x = e.kind === 'hallway' ? e.x + (e.w >> 1) : e.x + Math.max(1, Math.min(e.w - 2, (e.w >> 1) + ri(-1, 1))); m.edge[I(x, e.y + e.h)] |= 2 | 8; doors.push([x, e.y + e.h, 'N']); }
  }
  compute(m);
  furnish(m, rooms, room, R, t, dens);
  m.rooms = rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind }));
  return compute(m);
}

// ── furnishing: what stands against the walls faces into the room; tables stand in the open with an aisle round them
// facing: the way a thing faces (its front: a bookcase's shelves, a chair's seat) as [dx, dy] on the map
const FACE_DIR = (fx, fy) => fx > 0 ? 1 : fy > 0 ? 2 : fx < 0 ? 3 : 0;   // Kenney's turns, N E S W: facing -y, +x, +y, -x
const CHAIR_FACING = (fx, fy) => fx > 0 ? 1400 : fy > 0 ? 1401 : fx < 0 ? 1402 : 1403;
function furnish(m, rooms, room, R, t, dens, doorCells) {
  const S = m.w, I = (x, y) => y * S + x, pick = a => a[Math.floor(R() * a.length)];
  const B = m.biome, occ = new Uint8Array(S * S);
  const isF = (x, y) => tAt(m, x, y) !== VOID;
  const doorNear = (x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { const xx = x + dx, yy = y + dy; if (inb(m, xx, yy) && ((m.edge[I(xx, yy)] & 12) || (doorCells && doorCells[I(xx, yy)]))) return true; } return false; };
  // the room's walls round a cell: W and N are its back walls (seen whole); E and S its front
  const wallW = (x, y) => !isF(x - 1, y) || !!(m.edge[I(x, y)] & 1), wallN = (x, y) => !isF(x, y - 1) || !!(m.edge[I(x, y)] & 2);
  const wallE = (x, y) => !isF(x + 1, y) || (inb(m, x + 1, y) && !!(m.edge[I(x + 1, y)] & 1)), wallS = (x, y) => !isF(x, y + 1) || (inb(m, x, y + 1) && !!(m.edge[I(x, y + 1)] & 2));
  const win = (x, y, k) => isWindow(m, x, y, k);
  const free = (x, y) => inb(m, x, y) && isF(x, y) && !occ[I(x, y)] && !m.obj[I(x, y)] && !doorNear(x, y);
  const put = (x, y, id) => { if (!free(x, y) || !has(B, forBiome(B, id))) return false; m.obj[I(x, y)] = id; occ[I(x, y)] = 1; return true; };
  const putBig = (x, y, id) => {   // a prop over more than one cell, on its front cell
    const s = sprite(B, id); if (!s) return false;
    for (let j = 0; j < s.fh; j++) for (let k = 0; k < s.fw; k++) if (!free(x - k, y - j)) return false;
    m.obj[I(x, y)] = id; for (let j = 0; j < s.fh; j++) for (let k = 0; k < s.fw; k++) occ[I(x - k, y - j)] = 1; return true;
  };
  const keep = (x, y) => { if (inb(m, x, y)) occ[I(x, y)] |= 2; };   // (kept clear: an aisle)
  const cellsOf = r => { const a = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (room[I(x, y)] === r.n) a.push([x, y]); return a; };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // places along the back walls (whole, so what's against them shows): [x, y, fx, fy] facing into the room; no windows, no doors
  const alongBack = r => shuffle(cellsOf(r).filter(([x, y]) => (wallW(x, y) && !win(x, y, 'W')) || (wallN(x, y) && !win(x, y, 'N')))
    .map(([x, y]) => wallW(x, y) && !win(x, y, 'W') ? [x, y, 1, 0] : [x, y, 0, 1]));
  const alongFront = r => shuffle(cellsOf(r).filter(([x, y]) => wallE(x, y) || wallS(x, y)).map(([x, y]) => wallE(x, y) ? [x, y, -1, 0] : [x, y, 0, -1]));
  const corners = r => shuffle(cellsOf(r).filter(([x, y]) => (wallW(x, y) || wallE(x, y)) && (wallN(x, y) || wallS(x, y))));
  // a set of four (Kenney's turns) facing (fx, fy)
  const turned = (base, fx, fy) => base + FACE_DIR(fx, fy);
  const againstBack = (r, n, idOf) => { let k = n; for (const [x, y, fx, fy] of alongBack(r)) { if (k <= 0) break; const id = idOf(fx, fy); const s = sprite(B, id); if (s && (s.fw > 1 || s.fh > 1) ? putBig(x, y, id) : put(x, y, id)) k--; } };
  const againstAny = (r, n, ids) => { let k = n; for (const [x, y] of alongBack(r).concat(alongFront(r))) { if (k <= 0) break; if (put(x, y, pick(ids))) k--; } };
  const inCorners = (r, n, ids, spread) => { let k = n; for (const [x, y] of corners(r)) { if (k <= 0) break; if (put(x, y, pick(ids))) { k--; for (const [dx, dy] of shuffle([[1, 0], [0, 1], [-1, 0], [0, -1]]).slice(0, spread || 0)) put(x + dx, y + dy, pick(ids)); } } };
  // beds (Bleed's: 2400 double, 2404 single), the head against a back wall, all of the bed in the room, a gap left
  // along the wall beside it. (Against a W wall the set's +y turn lies along x, head to -x; against an N wall its +x turn
  // lies along y, head to -y.) Each bed made gets a chest at its foot, now and then
  const beds = (r, base, n, chest) => {
    let k = n;
    for (const [x, y, fx] of alongBack(r)) {
      if (k <= 0) break;
      const lx = fx > 0, id = base + (lx ? 1 : 2), s = sprite(B, id);   // (turn 1 lies along x, its head to -x; turn 2 along y, head to -y) if (!s) return;
      const L = lx ? s.fw : s.fh, bx = lx ? x + L - 1 : x, by = lx ? y : y + L - 1;
      let ok = true; for (let j = 0; j < s.fh && ok; j++) for (let q = 0; q < s.fw; q++) { const a = bx - q, b = by - j; if (!inb(m, a, b) || room[I(a, b)] !== r.n || !free(a, b)) { ok = false; break; } }
      if (!ok || !putBig(bx, by, id)) continue;
      k--;
      // (the cells on either side of it along the wall kept clear, so beds don't stand shoulder to shoulder)
      if (chest && R() < chest) put(lx ? bx + 1 : bx, lx ? by : by + 1, pick(CHESTS));
      for (let t = 0; t < L; t++) { if (lx) { keep(x + t, by - s.fh); keep(x + t, by + 1); } else { keep(bx - s.fw, y + t); keep(bx + 1, y + t); } }
    }
    return n - k;
  };
  // tables in rows across the open floor: a table every 4 cells each way, chairs round it facing it, an aisle between
  const tableGrid = (r, tables, chairs, max) => {
    const x0 = r.x + 2, y0 = r.y + 2, x1 = r.x + r.w - 2, y1 = r.y + r.h - 2; if (x1 < x0 || y1 < y0) return 0;
    const ox = x0 + ((x1 - x0) % 4 >> 1), oy = y0 + ((y1 - y0) % 4 >> 1);
    let n = 0;
    for (let y = oy; y <= y1; y += 4) for (let x = ox; x <= x1; x += 4) {
      if (n >= max || room[I(x, y)] !== r.n || !free(x, y)) continue;
      if (!put(x, y, pick(tables))) continue; n++;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (R() < chairs) put(x + dx, y + dy, CHAIR_FACING(-dx, -dy)); else keep(x + dx, y + dy);
    }
    return n;
  };
  // long tables in rows (each two cells along x), chairs down both sides facing in
  const longRows = (r, max, laid) => {
    let n = 0; const LT = 1415;
    for (let y = r.y + 2; y < r.y + r.h - 2 && n < max; y += 3) for (let x = r.x + 3; x < r.x + r.w - 1 && n < max; x += 3) {
      if (!putBig(x, y, LT)) continue; n++;
      for (const xx of [x - 1, x]) { put(xx, y - 1, CHAIR_FACING(0, 1)); put(xx, y + 1, CHAIR_FACING(0, -1)); }
      if (laid && R() < .6) { const cx = x - 1 - 1; put(cx, y, CHAIR_FACING(1, 0)); }
    }
    return n;
  };
  const CUPS = [1700, 1701, 1702, 1703, 1704, 1705, 1706, 1707, 1708], ROUND = [1410, 1411], SQUARE = [1412, 1413];
  const BARRELS = [1018, 1019, 1020, 1021, 1026, 1027], SACKS = [1000, 1001, 1002, 1003], CRATES = [1022, 1023, 1024, 1025, 1036, 1037, 1038, 1039, 1744, 1745, 1746, 1747];
  const POTS = [1004, 1005, 1006, 1007, 1008, 1009, 1010, 1016, 1017, 1032, 1033], CHESTS = [1022, 1023, 1024, 1025], BOXES = [1244, 1245, 1246, 1247];
  const STANDS = [1709, 1710, 1711, 1712, 1713], LAMPS = [1722, 1723, 1724, 1725], STATUES = [1222, 1223, 1224, 1225];
  const BOOKS = [2100, 2104, 2108, 2112], CANDLE = [2176, 2180];   // (each the first of four turns)
  // carpet: the plain red, laid as whole rectangles (what stands on it stands on it)
  const CARPET = 405;
  const carpet = (r, x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inb(m, x, y) && room[I(x, y)] === r.n) m.over[I(x, y)] = CARPET; };
  // a runner down the room's middle (two wide in a wide room), kept clear
  const rugRun = (r, along) => { const lx = along ? along === 'x' : r.w >= r.h, wide = (lx ? r.h : r.w) >= 7 ? 2 : 1, c = (lx ? r.y + (r.h >> 1) : r.x + (r.w >> 1)) - (wide - 1);
    for (let k = (lx ? r.x : r.y) + 1; k < (lx ? r.x + r.w : r.y + r.h) - 1; k++) for (let t = 0; t < wide; t++) { const x = lx ? k : c + t, y = lx ? c + t : k; if (room[I(x, y)] === r.n) { m.over[I(x, y)] = CARPET; if (!m.obj[I(x, y)]) keep(x, y); } } };
  // a rug in the middle of the floor, clear of the walls
  const rugMid = r => { const w = Math.max(2, Math.min(r.w - 4, 4)), h = Math.max(2, Math.min(r.h - 4, 3)); if (r.w < 4 || r.h < 4) return; carpet(r, r.x + ((r.w - w) >> 1), r.y + ((r.h - h) >> 1), w, h); };
  // Bleed's household pieces (sets of four turns): tables over two cells, chairs, cupboards, bookshelf, fireplace
  const DINE = 2408, KTAB = 2412, BCHAIR = 2416, BSHELF = 2420, CUPB = [2424, 2428], KCUPB = [2432, 2436], FIRE = 2440, STOOL = 2444;
  // a two-cell table, along x (lx) or y, front cell (x, y); chairs down both long sides facing it, now and then
  const table2 = (x, y, base, lx, chairs, chair) => {
    if (!putBig(x, y, base + (lx ? 1 : 3))) return false;   // (turns 1 and 3 lie along x, 0 and 2 along y)
    const ch = (a, b, fx, fy) => { if (R() < chairs) put(a, b, chair === STOOL ? STOOL : turned(chair || BCHAIR, fx, fy)); else keep(a, b); };
    for (const t of [0, 1]) { if (lx) { ch(x - t, y - 1, 0, 1); ch(x - t, y + 1, 0, -1); } else { ch(x - 1, y - t, 1, 0); ch(x + 1, y - t, -1, 0); } }
    return true;
  };
  const middle = r => [r.x + (r.w >> 1), r.y + (r.h >> 1)];
  const fireplace = r => againstBack(r, 1, (fx, fy) => turned(FIRE, fx, fy));
  for (const r of rooms) {
    const area = r.w * r.h, k = r.kind;
    if (k === 'common') {
      // the bar: along the back wall it shares with the kitchen (barrels behind it, the counter, stools before it)
      const alongX = r.w >= r.h, wy = r.y, wx = r.x;
      if (alongX && r.w >= 6) {
        const x0 = r.x + 1, x1 = Math.min(r.x + r.w - 2, r.x + 1 + Math.max(4, Math.round(r.w * .45)));
        for (let x = x0; x <= x1; x++) put(x, wy, pick(BARRELS.concat(POTS)));
        for (let x = x0 + 1; x <= x1; x += 2) putBig(x, wy + 1, 1415);
        for (let x = x0; x <= x1; x++) if (R() < .55) put(x, wy + 2, CHAIR_FACING(0, -1)); else keep(x, wy + 2);
      } else if (r.h >= 6) {
        const y0 = r.y + 1, y1 = Math.min(r.y + r.h - 2, r.y + 1 + Math.max(4, Math.round(r.h * .45)));
        for (let y = y0; y <= y1; y++) put(wx, y, pick(BARRELS.concat(POTS)));
        for (let y = y0 + 1; y <= y1; y += 2) putBig(wx + 1, y, 1414);
        for (let y = y0; y <= y1; y++) if (R() < .55) put(wx + 2, y, CHAIR_FACING(-1, 0)); else keep(wx + 2, y);
      }
      fireplace(r);
      tableGrid(r, ROUND.concat(SQUARE), .8, 99);
      // the stairs up to the rooms, in a back corner; light in the corners
      for (const [x, y] of corners(r)) if (wallE(x, y) || wallS(x, y) ? false : putBig(x + 1, y + 1, pick([1420, 1421]))) break;
      inCorners(r, 2, STANDS);
      for (let i = 0; i < 4; i++) { const [x, y] = pick(cellsOf(r)); if (free(x, y) && !occ[I(x, y)]) put(x, y, pick(CUPS)); }
    } else if (k === 'living') {
      // the hearth, a table with a cloth on a rug and chairs round it, cupboards and a bookshelf
      rugMid(r); fireplace(r);
      { const [x, y] = middle(r); table2(x, y, DINE, r.w >= r.h, .85) || put(x, y, pick(SQUARE)); }
      againstBack(r, 2, (fx, fy) => turned(pick(CUPB.concat(BSHELF)), fx, fy)); againstAny(r, 1 + Math.round(area / 18), BARRELS.concat(CHESTS)); inCorners(r, 1, LAMPS);
    } else if (k === 'kitchen') {
      // the hearth, a work table with bread on it and stools, cupboards of pots and bottles, stores round the walls, firewood
      fireplace(r);
      { const [x, y] = middle(r); if (!table2(x, y, KTAB, r.w >= r.h, .5, STOOL)) { put(x, y, pick(SQUARE)); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) keep(x + dx, y + dy); } }
      againstBack(r, 2, (fx, fy) => turned(pick(KCUPB), fx, fy));
      inCorners(r, 1, [1752, 1753]); againstAny(r, Math.round(area / 3.5 * (.6 + dens * .6)), BARRELS.concat(SACKS, POTS));
    } else if (k === 'store') {
      againstBack(r, 1, (fx, fy) => turned(pick(CUPB), fx, fy)); inCorners(r, 4, BARRELS.concat(CRATES, SACKS), 2); againstAny(r, Math.round(area / 2.5 * (.5 + dens)), BARRELS.concat(CRATES, SACKS, BOXES));
    } else if (k === 'private' || k === 'bed') {
      // a bed (a double, where there's room), a chest at its foot, a cupboard, a small table and chair, a rug
      if (!beds(r, area >= 12 && R() < .7 ? 2400 : 2404, 1, .8)) beds(r, 2404, 1, .8);
      if (area >= 16 && R() < .45) fireplace(r);
      againstBack(r, 1, (fx, fy) => turned(pick(CUPB.concat(BSHELF)), fx, fy)); rugMid(r);
      const c = cellsOf(r).filter(([x, y]) => !wallW(x, y) && !wallN(x, y) && !wallE(x, y) && !wallS(x, y) && free(x, y) && free(x - 1, y)); if (c.length) { const [x, y] = pick(c); if (put(x, y, pick(SQUARE))) put(x - 1, y, turned(BCHAIR, 1, 0)); }
      inCorners(r, 1, LAMPS);
    } else if (k === 'greathall' || k === 'mess' || k === 'dining') {
      if (k === 'greathall') { rugRun(r); fireplace(r); }
      if (k === 'dining') { rugMid(r); fireplace(r); const [x, y] = middle(r); if (!table2(x, y, DINE, r.w >= r.h, .9)) longRows(r, 1, true); else if (r.w >= 8 || r.h >= 8) table2(r.w >= r.h ? x + 3 : x, r.w >= r.h ? y : y + 3, DINE, r.w >= r.h, .9); }
      else longRows(r, 99, k !== 'mess');
      if (k === 'greathall') { againstBack(r, 3, () => pick(STATUES)); againstBack(r, 2, (fx, fy) => turned(pick(CANDLE), fx, fy)); }
      else { againstAny(r, Math.round(area / 12), BARRELS); inCorners(r, 2, STANDS); }
    } else if (k === 'library' || k === 'study' || k === 'office') {
      rugMid(r); if (k === 'study' && R() < .6) fireplace(r);
      againstBack(r, k === 'library' ? 99 : 3, (fx, fy) => turned(pick(BOOKS.concat(BSHELF, BSHELF, k === 'library' ? [2116, 2120] : CUPB)), fx, fy));
      const [x, y] = middle(r); if (k === 'office' ? table2(x, y, KTAB, r.w >= r.h, .6) : put(x, y, pick(SQUARE))) { if (k !== 'office') { put(x - 1, y, turned(BCHAIR, 1, 0)); put(x + 1, y, turned(BCHAIR, -1, 0)); } }
      inCorners(r, 1, LAMPS);
    } else if (k === 'armoury') {
      againstBack(r, 2, (fx, fy) => turned(2140, fx, fy)); againstAny(r, 3, CHESTS.concat(BOXES)); inCorners(r, 2, [1206, 1207, 1208, 1209]);
    } else if (k === 'bunks') {
      // beds along the walls, a chest at the foot of most, a table in the middle
      beds(r, 2404, 99, .7); { const [x, y] = middle(r); if (!table2(x, y, KTAB, r.w >= r.h, .6, STOOL)) tableGrid(r, SQUARE, .6, 1); } inCorners(r, 1, STANDS);
    } else if (k === 'hallway') {
      rugRun(r); inCorners(r, 2, STANDS); againstBack(r, Math.round(area / 10), () => pick(STATUES.concat(STANDS)));
    } else if (k === 'nave') {
      // pews in rows across the nave, an aisle up the middle to the altar (a statue) at the far end, candles beside it
      const lx = r.altarAt === 'x', mid = lx ? r.y + (r.h >> 1) : r.x + (r.w >> 1);
      rugRun(r, r.altarAt);
      // the altar end is the back (toward the vestry): its statue, as near the middle as the vestry's door allows, candles either side
      for (const d of [0, 1, -1, 2, -2]) { const ax = lx ? r.x : mid + d, ay = lx ? mid + d : r.y; if (put(ax, ay, STATUES[0])) { put(lx ? ax : ax - 1, lx ? ay - 1 : ay, turned(2176, lx ? 1 : 0, lx ? 0 : 1)); put(lx ? ax : ax + 1, lx ? ay + 1 : ay, turned(2176, lx ? 1 : 0, lx ? 0 : 1)); break; } }
      const sides = lx ? [[r.y + 1, mid - 1], [mid + 1, r.y + r.h - 2]] : [[r.x + 1, mid - 1], [mid + 1, r.x + r.w - 2]];
      for (let p = (lx ? r.x : r.y) + 3; p < (lx ? r.x + r.w : r.y + r.h) - 1; p += 2) for (const [a0, b0] of sides) for (let q = a0 + 1; q <= b0; q += 2) lx ? putBig(p, q, 1414) : putBig(q, p, 1415);
      inCorners(r, 2, STANDS);
    } else if (k === 'vestry') {
      againstBack(r, 2, (fx, fy) => turned(2100, fx, fy)); againstAny(r, 2, CHESTS); inCorners(r, 1, LAMPS);
    }
  }
}

// o: { theme, size, dens (0..1), edges: 'cliffs'|'open', water: 'auto'|'river'|'pond'|'none', seed, biome }
function generate(o) {
  if (kindOf(o.biome) === 'in') return generateIndoor(Object.assign({}, o, { theme: THEMES_INDOOR.some(t => t[0] === o.theme) ? o.theme : 'tavern' }));
  if (kindOf(o.biome) === 'under' && (o.theme === 'cavern' || o.theme === 'lair')) return generateCavern(o);
  if (data().biomes[o.biome] && data().biomes[o.biome].interior) return generateInside(Object.assign({}, o, { theme: THEMES_IN.concat(THEMES_KEEP).some(t => t[0] === o.theme) ? o.theme : 'dungeon' }));
  const R = rngOf(o.seed + '|' + o.theme + '|' + o.size), N = noiseOf(R), S = o.size, dens = o.dens, B = o.biome || 'grass';
  const m = blank(S, S, B), W = S, I = (x, y) => y * W + x;
  const pick = a => a[Math.floor(R() * a.length)];
  const avail = ids => ids.filter(id => has(B, forBiome(B, id)));
  if (o.edges === 'cliffs') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (x + .5) / S * 2 - 1, dy = (y + .5) / S * 2 - 1, d = Math.max(Math.abs(dx), Math.abs(dy)) * .7 + Math.hypot(dx, dy) * .3; m.terr[I(x, y)] = d + (N(x, y, 6) - .5) * .5 < .97 && x > 0 && y > 0 && x < S - 1 && y < S - 1 ? GRASS : VOID; }
    for (let k = 0; k < 2; k++) morph(m, false), morph(m, true);
    for (let k = 0; k < 2; k++) morph(m, true), morph(m, false);
    keepLargest(m);
  }
  const dv = distToVoid(m);
  const ok = (x, y, mn) => inb(m, x, y) && dv[I(x, y)] >= mn;
  const water = o.water === 'auto' ? ({ river: 'river', meadow: R() < .5 ? 'pond' : 'none', forest: R() < .35 ? 'river' : 'none', village: R() < .45 ? 'river' : 'none', market: 'none', camp: R() < .4 ? 'pond' : 'none', graveyard: 'none', ruins: R() < .3 ? 'pond' : 'none' })[o.theme] : o.water;
  let riverX = null;
  if (water === 'river') {
    const w = 2.2 + R() * 1.6, base = S * (.38 + R() * .24), amp = S * (.08 + R() * .07), ph = R() * 6;
    riverX = y => base + Math.sin(y / S * 5 + ph) * amp + (N(3, y, 5) - .5) * 3;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.abs(x + .5 - riverX(y)) < w && ok(x, y, 3)) m.terr[I(x, y)] = WATER;
  } else if (water === 'pond') {
    const px = S * (.3 + R() * .4), py = S * (.3 + R() * .4), pr = 2.5 + R() * S * .07;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + .5 - px, y + .5 - py) + (N(x * 2, y * 2, 4) - .5) * 3 < pr && ok(x, y, 3)) m.terr[I(x, y)] = WATER;
  }
  fixWater(m); for (let i = 0; i < S * S; i++) if (m.terr[i] === WATER && dv[i] < 2) m.terr[i] = GRASS; fixWater(m);
  // the road: across the map, straight where it meets the river so a bridge can carry it
  let roadY = null;
  if (o.theme !== 'forest' || R() < .7) {
    const y0 = S * (.4 + R() * .2), amp = S * .06 * R(), ph = R() * 6;
    roadY = x => Math.round(y0 + Math.sin(x / S * 4 + ph) * amp);
    const cross = riverX ? riverX(roadY(Math.round(riverX(y0)))) : null;
    for (let x = 0; x < S; x++) {
      let yy = roadY(x); if (cross !== null && Math.abs(x - cross) < 6) yy = roadY(Math.round(cross - 6));
      for (const y of [yy, yy + 1]) if (inb(m, x, y) && m.terr[I(x, y)] === GRASS && ok(x, y, 2)) m.terr[I(x, y)] = PATH;
    }
    fixWater(m);
    if (cross !== null) { const yy = roadY(Math.round(cross - 6)); for (const y of [yy, yy + 1]) { const x = Math.round(cross); if (inb(m, x, y) && m.terr[I(x, y)] === WATER) bridgeAt(m, x, y); } }
  }
  const cx = S / 2, cy = S / 2;
  // a square: paved, in the middle
  let plaza = null;
  if (o.theme === 'market') {
    const r = Math.max(4, Math.round(S * .16)); plaza = [Math.round(cx), Math.round(cy - (roadY ? 3 : 0)), r];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.abs(x - plaza[0]) + Math.abs(y - plaza[1]) * .9 + (N(x * 3, y * 3, 3) - .5) * 2 < r * 1.25 && ok(x, y, 2) && m.terr[I(x, y)] === GRASS) m.terr[I(x, y)] = PATH;
  }
  // rises in the land: blobs of higher ground (a tier on top, now and then), clear of the water, the banks, the roads (which
  // cut passes through them) and the square; o.hills: 'none', 'some' (the default) or 'lots'
  const hills = o.hills || 'some';
  if (hills !== 'none' && o.theme !== 'market') {
    const lv = new Uint8Array(S * S), n = hills === 'lots' ? 3 + Math.floor(R() * 3) : 1 + Math.floor(R() * 2);
    for (let b = 0; b < n; b++) {
      const bx = S * (.12 + R() * .76), by = S * (.12 + R() * .76), r = S * (hills === 'lots' ? .1 + R() * .14 : .08 + R() * .1), tiers = R() < (hills === 'lots' ? .6 : .35) ? 2 : 1;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const ax = Math.abs(x + .5 - bx), ay = Math.abs(y + .5 - by) * (.8 + (b % 3) * .2), d = Math.max(ax, ay) * .75 + Math.hypot(ax, ay) * .25 + (N(x + b * 31, y, 6) - .5) * r * .5;   // (squarish, ragged: long straight cliffs, few steps)
        for (let t = 1; t <= tiers; t++) if (d < r * (t === 1 ? 1 : .5)) lv[I(x, y)] = Math.max(lv[I(x, y)], t);
      }
    }
    const flat = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const t = tAt(m, x + dx, y + dy); if (t === WATER || (t === PATH && Math.abs(dx) <= 1 && Math.abs(dy) <= 1)) return true; } return dv[I(x, y)] < 3; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (lv[I(x, y)] && flat(x, y)) lv[I(x, y)] = 0;
    // (no ledge a cell wide: a cell higher than most of its neighbours comes down to them)
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = lv[I(x, y)]; if (!v) continue; let same = 0; for (const [dx, dy] of NB) if (lvAt({ lv, w: S, h: S }, x + dx, y + dy) >= v) same++;
      if (same < 4) lv[I(x, y)] = v - 1;
    }
    if (lv.some(v => v)) m.lv = lv;
  }
  compute(m);
  const occ = new Uint8Array(S * S);
  // (nothing stands on the edge of a rise, where its cliff is)
  const riseEdge = (x, y) => { if (!m.lv) return false; const v = lvAt(m, x, y); for (const [dx, dy] of NB) if (lvAt(m, x + dx, y + dy) !== v) return true; return false; };
  const free = (x, y) => inb(m, x, y) && !occ[I(x, y)] && m.terr[I(x, y)] === GRASS && !m.over[I(x, y)] && bankKind(m, x, y) === 0 && dv[I(x, y)] >= 2 && !riseEdge(x, y);
  const freePaved = (x, y) => inb(m, x, y) && !occ[I(x, y)] && (m.terr[I(x, y)] === GRASS || m.terr[I(x, y)] === PATH) && !m.over[I(x, y)] && bankKind(m, x, y) === 0 && dv[I(x, y)] >= 2 && !riseEdge(x, y);
  const nearRoad = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (tAt(m, x + dx, y + dy) === PATH) return true; return false; };
  const put = (x, y, id, paved) => { id = forBiome(B, id); if (!has(B, id) || !(paved ? freePaved : free)(x, y)) return false; m.obj[I(x, y)] = id; occ[I(x, y)] = 1; return true; };
  // a prop with a footprint, on its front cell (x, y); pad: cells kept clear round it
  const putBig = (x, y, id, pad = 1, paved) => {
    id = forBiome(B, id); const s = sprite(B, id); if (!s) return false;
    const f = paved ? freePaved : free;
    for (let yy = y - s.fh + 1 - pad; yy <= y + pad; yy++) for (let xx = x - s.fw + 1 - pad; xx <= x + pad; xx++) if (!f(xx, yy)) return false;
    m.obj[I(x, y)] = id;
    for (let yy = y - s.fh + 1 - pad; yy <= y + pad; yy++) for (let xx = x - s.fw + 1 - pad; xx <= x + pad; xx++) if (inb(m, xx, yy)) occ[I(xx, yy)] = 1;
    return true;
  };
  const putPre = (x, y, key, pad = 1) => {
    if (!prefabOK(B, key)) return false;
    const P = PREFABS[key]; let x1 = 0, y1 = 0; for (const [dx, dy] of P.cells) { x1 = Math.max(x1, dx); y1 = Math.max(y1, dy); }
    for (let yy = y - pad; yy <= y + y1 + pad; yy++) for (let xx = x - pad; xx <= x + x1 + pad; xx++) if (!free(xx, yy)) return false;
    for (const [dx, dy, id] of P.cells) (P.ground ? m.over : m.obj)[I(x + dx, y + dy)] = id;
    for (let yy = y - pad + 1; yy <= y + y1 + pad - 1; yy++) for (let xx = x - pad + 1; xx <= x + x1 + pad - 1; xx++) if (inb(m, xx, yy)) occ[I(xx, yy)] = 1; return true;
  };
  const cells = () => { const a = []; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) a.push([x, y]); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const TREES = { leafy: avail([252, 253, 254, 255]), tall: avail([248, 249, 250, 251]), blue: avail([240, 241, 242, 243]), dead: avail([244, 245, 246, 247]) };
  const dry = B === 'desert', win = !!(data().biomes[B] && data().biomes[B].winter);
  // (and the plants-pack's: pines, snowy in the snow and frosted at its edges; broadleaf trees where it's green)
  const MORE = dry ? [] : avail([2216, 2217, 2218, 2219, 2220, 2221, 2222, 2223].concat(win ? [2208, 2209, 2210, 2211, 2212, 2213, 2214, 2215] : [2240, 2241, 2242, 2243, 2244]));
  const anyTree = Object.values(TREES).some(a => a.length);
  const treeOf = mix => { if (MORE.length && R() < .3) return pick(MORE); const ks = mix.filter(k => TREES[k].length); if (!ks.length) return 0; return pick(TREES[pick(ks)]); };
  const woods = (p, mix, keepClear) => {
    if (!anyTree) { // no trees here (the desert): tall rocks and scrub instead
      const DRY = avail([132, 133, 134, 135, 128, 129, 130, 131, 2230, 2231, 2232, 2233, 2234, 2235, 2238]), PALMS = avail([2224, 2225, 2226, 2227, 2228, 2229]);
      const wet = (x, y) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (tAt(m, x + dx, y + dy) === WATER) return true; return false; };
      for (const [x, y] of cells()) { if (keepClear && keepClear(x, y)) continue; const n = N(x * 1.7 + 40, y * 1.7 + 40, 5);
        if (PALMS.length && wet(x, y) && R() < p * .5) put(x, y, pick(PALMS));   // palms round the water: an oasis
        else if (R() < p * .35 * Math.max(0, n - .4) * 2.4 && !nearRoad(x, y, 1)) put(x, y, pick(DRY)); }
      return;
    }
    for (const [x, y] of cells()) { if (keepClear && keepClear(x, y)) continue; const n = N(x * 1.7 + 40, y * 1.7 + 40, 5); if (R() < p * Math.max(0, n - .38) * 2.4 && !nearRoad(x, y, 1)) { const t = treeOf(mix); if (t) put(x, y, t); } }
  };
  const scatter = (ids, n, where, paved) => { ids = avail(ids); if (!ids.length) return; let k = n; for (const [x, y] of cells()) { if (k <= 0) break; if ((!where || where(x, y)) && put(x, y, pick(ids), paved)) k--; } };
  const area = S * S / 100, t = o.theme;
  const HOUSES = [1300, 1301, 1302, 1303, 1304, 1305, 1306, 1307, 1308, 1309, 1310, 1311, 2300, 2301, 2302, 2303, 2308, 2309, 2310, 2311];
  const GOODS = [1000, 1001, 1003, 1018, 1019, 1020, 1021, 1022, 1023, 1026, 1027, 1036, 1037, 1038, 1039, 1040];
  if (t === 'village') {
    let n = Math.round(3 + area / 4), tries = 0;
    while (n > 0 && tries++ < 500) {
      const x = Math.floor(R() * S), y = roadY ? roadY(x) + (R() < .5 ? -2 - Math.floor(R() * 3) : 5 + Math.floor(R() * 3)) : Math.floor(R() * S);
      const placed = R() < .7 ? putBig(x, y, pick(HOUSES)) : putPre(x - 1, y - 2, R() < .5 ? 'cabin1' : 'cabin2');
      if (placed) { n--; scatter(GOODS, 2 + Math.floor(R() * 3), (a, b) => Math.abs(a - x) < 4 && Math.abs(b - y) < 4 && a > x - 1 && b > y - 1, false); if (R() < .5) scatter([100, 101], 1, (a, b) => Math.abs(a - x) < 4 && Math.abs(b - y) < 4); }
    }
    putBig(Math.round(cx), Math.round(cy + (roadY ? -4 : 0)), 1104, 1) || putBig(Math.round(cx) + 3, Math.round(cy) - 5, 1105, 1);
    [1100, 1101, 1102, 1103].forEach(id => { for (const [x, y] of cells()) if (nearRoad(x, y, 2) && putBig(x, y, id, 0)) break; });
    scatter([102], 1, (x, y) => Math.abs(x - cx) < 4 && nearRoad(x, y, 2)); scatter([103], 1, (x, y) => nearRoad(x, y, 2));
    scatter([138, 139], 2, (x, y) => nearRoad(x, y, 1) && (x < 4 || x > S - 5 || R() < .05));
    woods(dens * .5, ['leafy', 'leafy', 'tall', 'dead'], (x, y) => Math.hypot(x - cx, y - cy) < S * .3);
  } else if (t === 'market') {
    const [px, py, r] = plaza;
    putBig(px, py, 1104, 0, true);
    for (let k = 0, placed = 0; k < 160 && placed < 6 + Math.floor(area / 3); k++) { const a = R() * 6.28, d = r * (.45 + R() * .5), x = Math.round(px + Math.cos(a) * d), y = Math.round(py + Math.sin(a) * d * .8); if (putBig(x, y, 1106 + Math.floor(R() * 12), 0, true)) placed++; }
    scatter(GOODS, 10 + Math.floor(area * 1.2), (x, y) => Math.abs(x - px) + Math.abs(y - py) < r * 1.4, true);
    for (let k = 0; k < 3; k++) for (const [x, y] of cells()) if (Math.abs(x - px) + Math.abs(y - py) < r * 1.5 && putBig(x, y, 1100 + Math.floor(R() * 4), 0, true)) break;
    let n = Math.round(3 + area / 5), tries = 0;
    while (n > 0 && tries++ < 500) { const a = R() * 6.28, d = r * 1.4 + 3 + R() * 4, x = Math.round(px + Math.cos(a) * d), y = Math.round(py + Math.sin(a) * d); if (putBig(x, y, pick(HOUSES))) n--; }
    scatter([138, 139], 1, (x, y) => nearRoad(x, y, 1));
    woods(dens * .4, ['leafy', 'tall'], (x, y) => Math.hypot(x - px, y - py) < r * 2.4);
  } else if (t === 'camp') {
    const fx = Math.round(cx + (R() - .5) * 4), fy = Math.round(cy + (roadY ? -5 : 0));
    put(fx, fy, 102); occ[I(fx, fy)] = 1;
    for (let k = 0, placed = 0; k < 40 && placed < 4 + Math.floor(area / 6); k++) { const a = R() * 6.28, r = 3.5 + R() * 2.5, x = Math.round(fx + Math.cos(a) * r), y = Math.round(fy + Math.sin(a) * r); if (putPre(x, y, R() < .5 ? 'tent1' : 'tent2', 0)) placed++; }
    scatter([96, 97, 98, 99, 100, 101, ...GOODS], 6 + Math.floor(area / 4), (x, y) => Math.hypot(x - fx, y - fy) < 8);
    scatter([1200, 1201, 1202, 1203, 1204, 1205], 2, (x, y) => Math.hypot(x - fx, y - fy) > 6 && Math.hypot(x - fx, y - fy) < 10);
    scatter([136, 137], 3, (x, y) => Math.hypot(x - fx, y - fy) < 10);
    woods(dens * 1.3, ['tall', 'leafy', 'tall', 'dead'], (x, y) => Math.hypot(x - fx, y - fy) < 8);
  } else if (t === 'graveyard') {
    const x0 = Math.round(cx - S * .22), y0 = Math.round(cy - S * .2 - (roadY ? 4 : 0)), x1 = Math.round(cx + S * .22), y1 = Math.round(cy + S * .12 - (roadY ? 4 : 0));
    for (let x = x0; x <= x1; x++) { if (Math.abs(x - cx) > 1) put(x, y1, R() < .15 ? 111 : 107); put(x, y0, R() < .15 ? 111 : 107); }
    for (let y = y0 + 1; y < y1; y++) { put(x0, y, R() < .15 ? 108 : 104); put(x1, y, R() < .15 ? 108 : 104); }
    for (let y = y0 + 2; y < y1 - 1; y += 2) for (let x = x0 + 2; x < x1 - 1; x += 2) if (R() < .78) { if (R() < .08) put(x, y, pick([1226, 1227, 1228, 1229])); else put(x, y, pick([140, 141, 142, 143])); }
    scatter([1222, 1223, 1224, 1225], 1, (x, y) => x > x0 && x < x1 && y > y0 && y < y1);
    if (!putPre(x1 + 2, y0, 'tower')) putPre(x0 - 6, y0, 'tower');
    scatter(TREES.dead, 4 + Math.floor(area / 5), (x, y) => !(x >= x0 && x <= x1 && y >= y0 && y <= y1));
    woods(dens * .6, ['dead', 'tall', 'blue'], (x, y) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2);
  } else if (t === 'ruins') {
    putPre(Math.round(cx - 2 + (R() - .5) * 6), Math.round(cy - 6), 'tower'); scatter([132, 133, 134, 135], 5 + Math.floor(area / 6)); scatter([128, 129, 130, 131], 8 + Math.floor(area / 3));
    scatter([1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229], 2 + Math.floor(area / 10));
    if (o.edges === 'cliffs') { const spots = cells().filter(([x, y]) => dv[I(x, y)] === 2 && free(x, y)); for (const [x, y] of spots) if (putPre(x, y, 'temple', 0)) break; }
    woods(dens * .7, ['dead', 'blue', 'tall']);
  } else if (t === 'forest') {
    woods(dens * 2.2, ['tall', 'tall', 'leafy', 'blue', 'dead'], (x, y) => Math.hypot(x - cx, y - cy) < S * .12);
    scatter([136, 137], 3); scatter([100, 101], 1, (x, y) => Math.hypot(x - cx, y - cy) < S * .14);
  } else {
    woods(dens * (t === 'river' ? 1 : .9), ['leafy', 'leafy', 'tall', 'blue', 'dead']);
  }
  // in the snow: stumps, snowmen near houses, rocks, winter grass
  if (data().biomes[B] && data().biomes[B].winter) {
    scatter([1780, 1781, 1782, 1783, 1784, 1785], Math.round(area * .8));
    scatter([1786, 1787, 1788, 1789, 1790, 1791, 1792, 1793, 1794, 1795, 1796, 1797, 1798, 1799, 1800, 1801], Math.round(area * 1.2));
    scatter([1806, 1807, 1808, 1809, 1810, 1811, 1812, 1813, 1814, 1815], Math.round(area * (1 + dens * 3)));
    if (t === 'village' || t === 'market' || t === 'camp') scatter([1777, 1778, 1779], 1 + Math.floor(area / 12), (x, y) => nearRoad(x, y, 3));
  }
  if (t === 'village' || t === 'camp') scatter([1743, 1744, 1745, 1746, 1747, 1748, 1749, 1750, 1751, 1752], Math.round(area / 3), (x, y) => nearRoad(x, y, 3));
  // the undergrowth everywhere: shrubs, tufts, flowers, stones; reeds by the water; a boat on the river
  scatter([112, 113, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127], Math.round(area * (2 + dens * 6)));
  scatter([118, 119], Math.round(area * dens * 1.2)); scatter([128, 129, 130, 131], Math.round(area * .8));
  scatter([114, 115], Math.round(area * 1.5), (x, y) => { for (const [dx, dy] of NB) if (tAt(m, x + 2 * dx, y + 2 * dy) === WATER) return true; return false; });
  if (o.edges === 'cliffs') scatter([132, 133, 134, 135], Math.round(area * .4), (x, y) => dv[I(x, y)] === 2);
  if (water === 'river') for (const [x, y] of cells()) { if (m.terr[I(x, y)] === WATER && !m.over[I(x, y)] && !m.obj[I(x, y)] && Math.abs(x - riverX(y)) < .8 && (!roadY || Math.abs(y - roadY(x)) > 4)) { const b = pick(avail([170, 171])); if (b) m.obj[I(x, y)] = b; break; } }
  return compute(m);
}

// ───── keeping a map: JSON with the cells packed (base64 of the arrays)
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
function lightKind(name) { name = (name || '').toLowerCase(); return /candle/.test(name) ? 'candle' : /fireplace|hearth/.test(name) ? 'hearth' : /campfire|brazier/.test(name) ? 'fire' : /lamp|lantern/.test(name) ? 'lamp' : /torch/.test(name) ? 'torch' : null; }
function extras(m) {
  compute(m);
  const lights = [], houses = [], r2 = v => Math.round(v * 100) / 100;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x, id = m.vobj[i];
    if (id) {
      const s = spriteAt(m, i, id), fw = s ? s.fw : 1, fh = s ? s.fh : 1, cx = x - (fw - 1) / 2, cy = y - (fh - 1) / 2;
      if (s && s.cat === 'Houses') houses.push([x - fw + 1, y - fh + 1, x, y]);
      if (s && s.cat === 'Houses' && !/tower/i.test(s.name || '') && lights.length < 300) lights.push([r2(x + .7), r2(cy), 'window']);   // (a house's lit windows: a glow at its front)
      const k = s && s.cat === 'Lights' ? lightKind(s.name) : id >= 634 && id <= 637 ? 'torch' : null;
      if (k && lights.length < 300) lights.push([r2(cx), r2(cy), k]);
    }
    // a torch on a keep's wall: the light just in front of the face it hangs on
    const c = m.c && m.c[i];
    if ((c === 513 || c === 523) && data().biomes[m.biome].blocks && lights.length < 300) lights.push(c === 513 ? [r2(x + .6), y, 'torch'] : [x, r2(y + .6), 'torch']);
  }
  return { kind: kindOf(m.biome), lights, houses: houses.slice(0, 400) };
}
function pack(m) { const p = { v: 2, biome: m.biome, w: m.w, h: m.h, terr: b64(m.terr), over: b64(new Uint8Array(m.over.buffer.slice(0))), obj: b64(new Uint8Array(m.obj.buffer.slice(0))) }; if (m.edge && m.edge.some(v => v)) p.edge = b64(m.edge); if (m.flip && m.flip.some((v, i) => v && m.obj[i])) p.flip = b64(m.flip); if (m.lv && m.lv.some(v => v)) p.lv = b64(m.lv); try { Object.assign(p, extras(m)); } catch (e) { /* (the sheets' data not loaded: the table works it out later) */ } return p; }
function unpack(p) {
  if (!p || !(p.w > 0 && p.h > 0 && p.w <= 128 && p.h <= 128)) throw new Error('Not a map from the forge');
  const n = p.w * p.h, d = data();
  const m = blank(p.w, p.h, d.biomes[p.biome] ? p.biome : 'grass');
  if (Array.isArray(p.terr)) {   // the first version kept plain arrays
    for (let i = 0; i < n; i++) { m.terr[i] = Math.min(3, +p.terr[i] || 0); m.over[i] = +p.over[i] || 0; m.obj[i] = +p.obj[i] || 0; }
  } else {
    const t = unb64(p.terr), ov = new Uint16Array(unb64(p.over).buffer), ob = new Uint16Array(unb64(p.obj).buffer), ed = p.edge ? unb64(p.edge) : null, fl = p.flip ? unb64(p.flip) : null, lv = p.lv ? unb64(p.lv) : null;
    if (lv && lv.some(v => v)) m.lv = new Uint8Array(n);
    for (let i = 0; i < n; i++) { m.terr[i] = Math.min(3, t[i] || 0); m.over[i] = ov[i] || 0; m.obj[i] = ob[i] || 0; if (ed) m.edge[i] = ed[i] & 31; if (fl) m.flip[i] = fl[i] & 1; if (m.lv) m.lv[i] = Math.min(3, lv[i] || 0); }
  }
  // pieces no land of this sort has (a damaged file) go; pieces only another land of the sort has stay
  const lands = Object.keys(d.biomes).filter(k => kindOf(k) === kindOf(m.biome)), known = id => id >= 1000 ? !!d.props.items[id] : lands.some(k => !!d.biomes[k].tiles[id]);
  for (let i = 0; i < n; i++) { if (m.over[i] && !known(m.over[i])) m.over[i] = 0; if (m.obj[i] && !known(m.obj[i])) m.obj[i] = 0; }
  return compute(m);
}
// a map moved to another biome: snowy props in the snow, and anything the new sheet lacks dropped
// a map moved to another land of the same sort: it's drawn with that land's pieces (snowy props in the snow, a bare tree
// where the new land has no leafy ones) but keeps its own, so moving it back gives back everything
function rebiome(m, biome) {
  if (kindOf(biome) !== kindOf(m.biome)) throw new Error('A map can only move to a land of its own sort');
  m.biome = biome; return compute(m);
}
root.IsoCore = { VOID, GRASS, PATH, WATER, NB, PREFABS, GROUND_IDS, THEMES, THEMES_IN, THEMES_INDOOR, themesFor, isInterior, kindOf, standIn, DOORS, DOOR_IDS, data, load, ready, sheets, sprite, has, forBiome, prefabOK,
  blank, inb, tAt, bankKind, fixWater, compute, ownerOf, bridgeAt, paint, drawSprite, bounds, standing, cellXY, cellAt, hash,
  generate, pack, unpack, rebiome, mirrorOf, mirrored, flipAt, lvAt };
})(typeof window !== 'undefined' ? window : this);
