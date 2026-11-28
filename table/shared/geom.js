/* Grid and shape maths, shared by the server (fog checks) and the table (drawing, snapping, measuring).
 *
 * A scene's grid: { type: 'square' | 'hexr' | 'hexc' | 'iso' | 'none', size, ox, oy, feet, units, diagonal }
 *   iso     isometric diamonds (the map forge's maps): size is a diamond's width (its height is half that), and (ox, oy)
 *           the centre of cell (0, 0); cell (i, j) is centred at (ox + (i - j) * size / 2, oy + (i + j) * size / 4).
 *   size    square: side in image pixels. hexr (pointy tops, in rows): distance between neighbouring
 *           centres along a row. hexc (flat tops, in columns): distance between neighbouring centres down a column.
 *   ox, oy  where a square's corner (square) or a hex's centre (hex) falls in the image.
 *   diagonal  square grids only: 'one' (5e: a diagonal step costs one square), 'alt' (5-10-5) or 'euclid'.
 *
 * Fog: an ordered list of shapes, each { mode: 'reveal' | 'hide', k: 'rect' | 'poly' | 'circle', ... }.
 * A point is visible if the last shape containing it was a reveal.
 */
(function (root) {
  'use strict';
  const S3 = Math.sqrt(3);

  // --- hex helpers (axial q, r) ---
  function cubeRound(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return [rx, rz];
  }
  function hexAt(g, x, y) {
    if (g.type === 'hexr') { const r = (y - g.oy) / (g.size * S3 / 2); return cubeRound((x - g.ox) / g.size - r / 2, r); }
    const q = (x - g.ox) / (g.size * S3 / 2); return cubeRound(q, (y - g.oy) / g.size - q / 2);
  }
  function hexCentre(g, q, r) {
    if (g.type === 'hexr') return [g.ox + g.size * (q + r / 2), g.oy + g.size * S3 / 2 * r];
    return [g.ox + g.size * S3 / 2 * q, g.oy + g.size * (r + q / 2)];
  }
  // corners of the hex around a centre, for drawing
  function hexCorners(g, cx, cy) {
    const rad = g.size / S3, out = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (g.type === 'hexr' ? 60 * i - 30 : 60 * i);
      out.push(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
    return out;
  }

  // --- isometric helpers: the cell (i, j) a point is in, and a cell's centre ---
  function isoAt(g, x, y) {
    const u = (x - g.ox) / (g.size / 2), v = (y - g.oy) / (g.size / 4);
    return [Math.round((u + v) / 2), Math.round((v - u) / 2)];
  }
  function isoCentre(g, i, j) { return [g.ox + (i - j) * g.size / 2, g.oy + (i + j) * g.size / 4]; }

  // Where a token of `cells` grid cells across should sit if dropped with its centre at (x, y).
  function snap(g, x, y, cells) {
    if (!g || g.type === 'none' || !(g.size > 0)) return [x, y];
    if (g.type === 'square') {
      const n = Math.max(1, Math.round(cells || 1));
      const odd = n % 2 === 1 || (cells || 1) < 1;
      if (odd) return [g.ox + (Math.floor((x - g.ox) / g.size) + 0.5) * g.size, g.oy + (Math.floor((y - g.oy) / g.size) + 0.5) * g.size];
      return [g.ox + Math.round((x - g.ox) / g.size) * g.size, g.oy + Math.round((y - g.oy) / g.size) * g.size];
    }
    if (g.type === 'iso') { const [i, j] = isoAt(g, x, y); return isoCentre(g, i, j); }
    const [q, r] = hexAt(g, x, y);
    return hexCentre(g, q, r);
  }

  // Distance between two points in grid cells (fractional for 'none' and 'euclid').
  function cells(g, ax, ay, bx, by) {
    if (!g || !(g.size > 0)) return Math.hypot(bx - ax, by - ay) / 100;
    if (g.type === 'square') {
      const c = p => [Math.floor((p[0] - g.ox) / g.size), Math.floor((p[1] - g.oy) / g.size)];
      const [ai, aj] = c([ax, ay]), [bi, bj] = c([bx, by]);
      const dx = Math.abs(bi - ai), dy = Math.abs(bj - aj);
      if (g.diagonal === 'euclid') return Math.hypot(bx - ax, by - ay) / g.size;
      if (g.diagonal === 'alt') { const d = Math.min(dx, dy); return Math.max(dx, dy) + Math.floor(d / 2); }
      return Math.max(dx, dy);
    }
    if (g.type === 'iso') {   // counted like squares: a diagonal step costs one (or 5-10-5)
      const [ai, aj] = isoAt(g, ax, ay), [bi, bj] = isoAt(g, bx, by), dx = Math.abs(bi - ai), dy = Math.abs(bj - aj);
      if (g.diagonal === 'euclid') return Math.hypot(bi - ai, bj - aj);
      if (g.diagonal === 'alt') { const d = Math.min(dx, dy); return Math.max(dx, dy) + Math.floor(d / 2); }
      return Math.max(dx, dy);
    }
    if (g.type === 'hexr' || g.type === 'hexc') {
      const [aq, ar] = hexAt(g, ax, ay), [bq, br] = hexAt(g, bx, by);
      return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
    }
    return Math.hypot(bx - ax, by - ay) / g.size;
  }
  // Distance along a list of points [[x, y], ...], in the scene's units.
  function pathLength(g, pts) {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += cells(g, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    return { cells: n, units: n * ((g && g.feet) || 5) };
  }

  // --- shapes ---
  function inShape(s, x, y) {
    if (s.k === 'rect') return x >= Math.min(s.x, s.x + s.w) && x <= Math.max(s.x, s.x + s.w) && y >= Math.min(s.y, s.y + s.h) && y <= Math.max(s.y, s.y + s.h);
    if (s.k === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.r;
    if (s.k === 'poly') {
      const p = s.pts; let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    return false;
  }
  function fogVisible(scene, x, y) {
    if (!scene.fog) return true;
    let vis = false;
    for (const s of scene.fogShapes || []) if (inShape(s, x, y)) vis = s.mode === 'reveal';
    return vis;
  }

  // Area templates. A template: { kind: 'cone' | 'circle' | 'line' | 'square', x, y, angle (radians), len (units), width (units) }.
  // Returns a polygon in image pixels.
  // On an isometric grid the shape is worked out on the ground (the picture with its height doubled, where a cell is a
  // square size/√2 across) and then flattened: a circle lies on the ground as an ellipse.
  function templatePoly(g, t) {
    if (g && g.type === 'iso') {
      const flat = templatePoly({ size: g.size / Math.SQRT2, feet: g.feet }, Object.assign({}, t, { x: 0, y: 0 }));
      for (let i = 0; i < flat.length; i += 2) { flat[i] += t.x; flat[i + 1] = t.y + flat[i + 1] / 2; }
      return flat;
    }
    const ppu = ((g && g.size) || 100) / ((g && g.feet) || 5);   // pixels per foot
    const L = t.len * ppu, a = t.angle || 0, out = [];
    if (t.kind === 'circle') { for (let i = 0; i < 48; i++) { const b = i / 48 * Math.PI * 2; out.push(t.x + L * Math.cos(b), t.y + L * Math.sin(b)); } return out; }
    if (t.kind === 'cone') {    // 5e cone: a triangle as wide at its far end as it is long
      const c = Math.cos(a), s = Math.sin(a);
      for (const [u, v] of [[0, 0], [L, -L / 2], [L, L / 2]]) out.push(t.x + u * c - v * s, t.y + u * s + v * c);
      return out;
    }
    if (t.kind === 'square') {
      const h = L / 2, c = Math.cos(a), s = Math.sin(a);
      const cx = t.x + c * h, cy = t.y + s * h;
      for (const [u, v] of [[-h, -h], [h, -h], [h, h], [-h, h]]) out.push(cx + u * c - v * s, cy + u * s + v * c);
      return out;
    }
    const W = (t.width || 5) * ppu / 2, c = Math.cos(a), s = Math.sin(a);
    for (const [u, v] of [[0, -W], [L, -W], [L, W], [0, W]]) out.push(t.x + u * c - v * s, t.y + u * s + v * c);
    return out;
  }

  const api = { S3, hexAt, hexCentre, hexCorners, isoAt, isoCentre, snap, cells, pathLength, inShape, fogVisible, templatePoly };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geom = api;
})(this);
