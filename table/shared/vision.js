/* Walls, light and sight, shared by the server (what each player may see) and the table (drawing it).
 *
 * A wall: { id, a: [x, y], b: [x, y], kind, open, locked, flip }
 *   kind   'wall'      blocks sight, light and movement
 *          'door'      a wall until opened; players can open it unless it's locked
 *          'secret'    a door only the GM knows about; players see (and are blocked by) a plain wall
 *          'window'    lets sight and light through, blocks movement
 *          'invisible' lets sight and light through, blocks movement (a cliff edge, a force wall)
 *          'shade'     a house's walls: blocks light, movement and the sight of tokens behind it, but not the view
 *                      of the map: a lamp inside doesn't light the street, and nobody sees round the corner, yet
 *                      everyone still sees the building itself and the ground around it
 *          'prop'      (made here from a prop that blocks light) blocks sight and light, not movement
 *          'oneway'    blocks sight, light and movement coming from one side only: the left of a→b,
 *                      or the right when flip is set
 *   open   doors only
 * A light: { id, x, y, bright, dim (feet), color '#rrggbb', intensity 0..1, angle (degrees of a cone, 360 = all round),
 *            dir (degrees the cone faces), anim 'none' | 'torch' | 'candle' | 'pulse' | 'fairy' | 'sunbeam' }
 * A token's sight: { on, range (feet, 0 = no limit), dark (darkvision, feet) }; tokens can also carry a light.
 *
 * A point is seen by a player when it's in the line of sight of one of their tokens that has sight, within that
 * token's range, and it is lit: the scene is bright enough (darkness below DAYLIGHT), a light reaches it, or it
 * is within the token's darkvision.
 */
(function (root) {
  'use strict';
  const DAYLIGHT = 0.35;          // scenes darker than this need light to see by
  const CIRCLE_SIDES = 72;
  const EPS = 1e-5;

  // ───────── walls ─────────

  function side(w, x, y) { return (w.b[0] - w.a[0]) * (y - w.a[1]) - (w.b[1] - w.a[1]) * (x - w.a[0]); }
  function blocksSight(w, ox, oy) {
    if (w.kind === 'window' || w.kind === 'invisible' || w.kind === 'shade') return false;
    if ((w.kind === 'door' || w.kind === 'secret') && w.open) return false;
    if (w.kind === 'oneway') { const s = side(w, ox, oy); return w.flip ? s < 0 : s > 0; }
    return true;
  }
  function blocksLight(w, ox, oy) {
    if (w.kind === 'shade') return true;
    return blocksSight(w, ox, oy);
  }
  function blocksMove(w, ox, oy) {
    if ((w.kind === 'door' || w.kind === 'secret') && w.open) return false;
    if (w.kind === 'oneway') { const s = side(w, ox, oy); return w.flip ? s < 0 : s > 0; }
    return true;
  }
  // does segment p→q cross segment a→b (touching counts)?
  function segHit(px, py, qx, qy, ax, ay, bx, by) {
    const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
    const d = rx * sy - ry * sx;
    if (Math.abs(d) < 1e-12) return false;
    const t = ((ax - px) * sy - (ay - py) * sx) / d, u = ((ax - px) * ry - (ay - py) * rx) / d;
    return t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS;
  }
  // The first wall a move from (ax, ay) to (bx, by) would walk through, or null.
  function moveBlocked(walls, ax, ay, bx, by) {
    for (const w of walls || []) if (blocksMove(w, ax, ay) && segHit(ax, ay, bx, by, w.a[0], w.a[1], w.b[0], w.b[1])) return w;
    return null;
  }

  // ───────── line of sight ─────────

  // The polygon (flat [x, y, x, y, …]) seen from (ox, oy) through the walls, out to `radius` (0: to `bounds`).
  function los(walls, ox, oy, radius, bounds, forLight) {
    const segs = [];
    const r2 = radius > 0 ? radius * radius : Infinity;
    for (const w of walls || []) {
      if (!(forLight ? blocksLight(w, ox, oy) : blocksSight(w, ox, oy))) continue;
      if (radius > 0 && segDist2(ox, oy, w.a[0], w.a[1], w.b[0], w.b[1]) > r2) continue;
      segs.push([w.a[0], w.a[1], w.b[0], w.b[1]]);
    }
    // the outer edge: a circle, or the scene's box (with room to spare)
    const edge = [];
    if (radius > 0) {
      for (let i = 0; i < CIRCLE_SIDES; i++) {
        const a0 = i / CIRCLE_SIDES * Math.PI * 2, a1 = (i + 1) / CIRCLE_SIDES * Math.PI * 2;
        edge.push([ox + Math.cos(a0) * radius, oy + Math.sin(a0) * radius, ox + Math.cos(a1) * radius, oy + Math.sin(a1) * radius]);
      }
    } else {
      const b = bounds || { x: ox - 1e5, y: oy - 1e5, w: 2e5, h: 2e5 };
      const x0 = Math.min(b.x, ox - 1), y0 = Math.min(b.y, oy - 1), x1 = Math.max(b.x + b.w, ox + 1), y1 = Math.max(b.y + b.h, oy + 1);
      edge.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
    }
    const all = segs.concat(edge);
    const angles = [];
    for (const s of all) for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
    angles.sort((x, y) => x - y);
    const out = [];
    let last = NaN;
    for (const a of angles) {
      if (Math.abs(a - last) < 1e-9) continue;
      last = a;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = Infinity;
      for (const s of all) {
        const t = rayHit(ox, oy, dx, dy, s);
        if (t < best) best = t;
      }
      if (best === Infinity) continue;
      out.push(ox + dx * best, oy + dy * best);
    }
    return out;
  }
  function rayHit(ox, oy, dx, dy, s) {
    const sx = s[2] - s[0], sy = s[3] - s[1];
    const d = dx * sy - dy * sx;
    if (Math.abs(d) < 1e-12) return Infinity;
    const t = ((s[0] - ox) * sy - (s[1] - oy) * sx) / d;
    const u = ((s[0] - ox) * dy - (s[1] - oy) * dx) / d;
    return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
  }
  function segDist2(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    let t = l2 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * vx - px, y = ay + t * vy - py;
    return x * x + y * y;
  }
  function inPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // inside a light's cone?
  function inCone(l, x, y) {
    if (!(l.angle > 0 && l.angle < 360)) return true;
    const a = Math.atan2(y - l.y, x - l.x) * 180 / Math.PI;
    let d = ((a - (l.dir || 0)) % 360 + 540) % 360 - 180;
    return Math.abs(d) <= l.angle / 2;
  }

  // ───────── what a set of tokens can see ─────────

  const pxPerFoot = g => (g && g.size > 0 ? g.size : 100) / (g && g.feet > 0 ? g.feet : 5);
  function sightOn(t) { return t.sight ? !!t.sight.on : (t.owners || []).length > 0; }
  // Every light in the scene: placed ones and the ones tokens carry.
  function allLights(scene, tokens) {
    const out = (scene.lights || []).slice();
    for (const t of tokens || []) if (t.light && (t.light.dim > 0 || t.light.bright > 0)) out.push(Object.assign({}, t.light, { id: 't:' + t.id, x: t.x, y: t.y, token: t.id }));
    return out;
  }
  // view: { viewers: [{ x, y, poly, range, dark }], lights: [{ ...light, poly, r }], day }
  // Props (scenery placed from the art tool: a big rock, a wagon, a wall of crates) can block light and sight: their
  // outline, turned as they're turned, works as four walls.
  function propWalls(scene) {
    const out = [], size = (scene.grid && scene.grid.size > 0 ? scene.grid.size : 100);
    for (const t of scene.tokens || []) {
      if (!t || !t.prop || !t.blocks) continue;
      const w = (t.w || t.size || 1) * size / 2, h = (t.h || t.size || 1) * size / 2, a = (t.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const P = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [t.x + x * c - y * s, t.y + x * s + y * c]);
      for (let i = 0; i < 4; i++) out.push({ id: 'p:' + t.id + ':' + i, a: P[i], b: P[(i + 1) % 4], kind: 'prop' });
    }
    return out;
  }
  function view(scene, viewers, lights, cache) {
    const pw = propWalls(scene);
    if (cache) { const sig = pw.map(w => w.a.join(',')).join(';'); if (cache.propSig !== sig) { cache.clear(); cache.propSig = sig; } }
    const g = scene.grid, k = pxPerFoot(g), walls = pw.length ? (scene.walls || []).concat(pw) : (scene.walls || []);
    const bounds = sceneBounds(scene);
    const day = (scene.darkness || 0) < DAYLIGHT;
    const shade = walls.some(w => w.kind === 'shade');
    const vs = viewers.map(t => {
      const range = t.sight && t.sight.range > 0 ? t.sight.range * k : 0;
      const poly = cached(cache, 'v', t.x, t.y, range, () => los(walls, t.x, t.y, range, bounds));
      // what's behind house walls ('shade') shows on the map, but tokens there are out of sight
      const tpoly = shade ? cached(cache, 't', t.x, t.y, range, () => los(walls, t.x, t.y, range, bounds, true)) : poly;
      return { id: t.id, x: t.x, y: t.y, range, dark: t.sight && t.sight.dark > 0 ? t.sight.dark * k : 0, poly, tpoly };
    });
    const ls = day ? [] : lights.map(l => {
      const r = Math.max(l.dim || 0, l.bright || 0) * k;
      return Object.assign({}, l, { r, rb: (l.bright || 0) * k, poly: r > 0 ? cached(cache, 'l', l.x, l.y, r, () => los(walls, l.x, l.y, r, bounds, true)) : [] });
    });
    return { viewers: vs, lights: ls, day };
  }
  function cached(cache, kind, x, y, r, make) {
    if (!cache) return make();
    const key = kind + ':' + Math.round(x * 10) + ':' + Math.round(y * 10) + ':' + Math.round(r);
    if (!cache.has(key)) { if (cache.size > 400) cache.clear(); cache.set(key, make()); }
    return cache.get(key);
  }
  function sceneBounds(scene) {
    const w = (scene.image && scene.image.w) || (scene.area && scene.area.cols * (scene.grid && scene.grid.size || 70)) || 2000;
    const h = (scene.image && scene.image.h) || (scene.area && scene.area.rows * (scene.grid && scene.grid.size || 70)) || 2000;
    return { x: -w * 0.5, y: -h * 0.5, w: w * 2, h: h * 2 };
  }
  function lit(v, x, y) {
    if (v.day) return true;
    for (const l of v.lights) {
      const dx = x - l.x, dy = y - l.y;
      if (dx * dx + dy * dy <= l.r * l.r && inCone(l, x, y) && inPoly(l.poly, x, y)) return true;
    }
    return false;
  }
  function seesPoint(v, x, y, token) {
    for (const s of v.viewers) {
      const dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy;
      if (s.range && d2 > s.range * s.range) continue;
      if (!inPoly(token && s.tpoly ? s.tpoly : s.poly, x, y) && d2 > 4) continue;
      if (lit(v, x, y) || (s.dark && d2 <= s.dark * s.dark)) return true;
    }
    return false;
  }
  // a token counts as seen if its centre or a point near its edge is
  function seesToken(v, t, cell) {
    const r = (t.size || 1) * (cell || 70) * 0.38;
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (seesPoint(v, t.x + dx, t.y + dy, true)) return true;
    return false;
  }

  const api = { DAYLIGHT, blocksSight, blocksLight, blocksMove, moveBlocked, los, inPoly, inCone, pxPerFoot, sightOn, allLights, view, lit, seesPoint, seesToken, sceneBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Vision = api;
})(this);
