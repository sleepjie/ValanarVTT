/* Travel, from the hotbar's rings. Two things:
 *
 * How far in a day: click the map and see how far you could get from there in one day, two, three…, on foot, on
 * horseback, by cart or by ship (the paces from the ruler's travel settings), going round the sea (or, by ship, round
 * the land), quicker along the roads. Rings on the map, one a day; the pointer tells the days to anywhere inside.
 *
 * The way to…: from one place to another, the way a party would go: along the roads where there are roads, over the
 * sea from a town on the coast to another if that's quicker (or the only way), stopping the night in a town when
 * there's one about where the day ends and camping in the open when there isn't. Drawn on the map day by day, and
 * written out as an itinerary (the towns passed, the borders crossed, where each night is spent, the weather as it
 * might be), which can be watched as a tale: the camera following the line as it draws itself across the map.
 *
 * Both are worked out on a coarse grid of the land mask (about 700 cells across): fine for planning, not to the mile.
 * ValanarReach(ctx) → { from(x, y), clear(), wayFrom(marker), wayTo(marker), state() } */
'use strict';
window.ValanarReach = function (ctx) {
  const { map, L, h, toast, toLatLng, toPixel, Land } = ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const BYSEA = /ship|boat|sail|galley|sea|barge/i;
  const Cal = window.WorldCalendar;
  let tab = 'rings';   // 'rings' | 'way'
  let mode = 0, days = 7, armed = false, origin = null, res = null, layer = null, lines = null, labels = null, pin = null;
  const paces = () => (ctx.data().settings.travel || []).filter(t => +t.mph > 0);
  const pace = () => paces()[clamp(mode, 0, paces().length - 1)] || { label: 'On foot', mph: 3, hours: 10 };
  const mpp = () => ctx.milesPerPx() || 0.2;

  // ───────── the grid ─────────
  let grid = null;
  function makeGrid() {
    if (!Land.ready || !Land.v) return null;
    const f = Math.max(1, Math.ceil(Land.w / 700)), W = Math.ceil(Land.w / f), H = Math.ceil(Land.h / f);
    const rts = (ctx.data().routes || []).filter(r => ['road', 'trade', 'sea'].includes(r.kind) && Array.isArray(r.pts) && r.pts.length > 1);
    const sig = W + 'x' + H + ':' + JSON.stringify(rts.map(r => r.kind + (r.name || '') + r.pts.length + ':' + r.pts[0]));
    if (grid && grid.sig === sig) return grid;
    const land = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0, l = 0;
      for (let yy = y * f; yy < Math.min(Land.h, y * f + f); yy++) for (let xx = x * f; xx < Math.min(Land.w, x * f + f); xx++) { n++; if (Land.v[yy * Land.w + xx] >= 128) l++; }
      land[y * W + x] = n && l * 2 >= n ? 1 : 0;
    }
    // the roads (Routes › Road or Trade route): quicker going along them; the sea lanes, a little quicker by ship.
    // road: which named road a cell is on (1 + its index in roadNames; 0 none)
    const road = new Uint16Array(W * H), lane = new Uint8Array(W * H), cell = f * Land.scale, roadNames = [];
    for (const r of rts) {
      const sea = r.kind === 'sea';
      let id = 0;
      if (!sea) { const nm = (r.name || '').trim(); id = nm ? (roadNames.indexOf(nm) + 1 || roadNames.push(nm)) : 0xffff; }
      for (let i = 1; i < r.pts.length; i++) {
        const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / cell * 2) + 1;
        for (let k = 0; k <= n; k++) {
          const cx = Math.floor((x0 + (x1 - x0) * k / n) / cell), cy = Math.floor((y0 + (y1 - y0) * k / n) / cell);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          const j = cy * W + cx;
          if (sea) lane[j] = 1; else if (!road[j] || road[j] === 0xffff) road[j] = id;
        }
      }
    }
    grid = { sig, W, H, f, cell, land, road, lane, roadNames };
    return grid;
  }
  // a little binary heap of (cost, cell)
  function heap() {
    const hf = [], hi = [];
    return {
      get size() { return hf.length; },
      push(f, i) { hf.push(f); hi.push(i); let k = hf.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [hf[p], hf[k]] = [hf[k], hf[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } },
      pop() { const i = hi[0], lf = hf.pop(), li = hi.pop(); if (hf.length) { hf[0] = lf; hi[0] = li; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === k) break; [hf[m], hf[k]] = [hf[k], hf[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } } return i; }
    };
  }
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  // the nearest cell to (sx, sy) that ok() allows, looking out in squares
  function nearestCell(g, sx, sy, ok) {
    const { W, H } = g;
    for (let r = 0; r < 40; r++) {
      let s = -1, bd = 1e9;
      for (let y = sy - r; y <= sy + r; y++) for (let x = sx - r; x <= sx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || (Math.abs(x - sx) !== r && Math.abs(y - sy) !== r)) continue;
        const i = y * W + x; if (!ok(i)) continue;
        const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; s = i; }
      }
      if (s >= 0) return s;
    }
    return -1;
  }
  // Dijkstra over the grid from one cell, in days, out to the furthest ring
  function spread(g, sx, sy, bySea, perDay, maxDays) {
    const { W, H, land, road } = g, N = W * H;
    const ok = i => bySea ? !land[i] : !!land[i];
    const s = nearestCell(g, sx, sy, ok);   // the nearest cell you can travel from (a port for a ship)
    if (s < 0) return null;
    const dist = new Float32Array(N).fill(Infinity), done = new Uint8Array(N), q = heap();
    const step = g.cell * mpp() / perDay;   // days to cross a cell
    dist[s] = 0; q.push(0, s);
    while (q.size) {
      const i = q.pop(); if (done[i]) continue; done[i] = 1;
      const di = dist[i]; if (di > maxDays) break;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (done[j] || !ok(j)) continue;
        if (dx && dy && (!ok(y * W + nx) || !ok(ny * W + x))) continue;   // no cutting the corner of a coast
        const k = !bySea && road[i] && road[j] ? 0.66 : 1;
        const nd = di + c * step * k;
        if (nd < dist[j]) { dist[j] = nd; q.push(nd, j); }
      }
    }
    return { dist, s };
  }

  // ───────── drawing the rings ─────────
  const BAND = ['#e9c46a', '#d9a441', '#c98431', '#b5652a', '#9b4a26', '#7d3624', '#5e2a22'];
  function draw() {
    clearLayers();
    if (!res) return;
    const g = res.g, { W, H } = g, d = res.dist, max = res.days;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'), img = cx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = d[i]; if (!(v <= max)) continue;
      const band = Math.min(BAND.length - 1, Math.floor(v)), col = BAND[band];
      const r = parseInt(col.slice(1, 3), 16), gg = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(255 * (0.36 - band * 0.025));
    }
    cx.putImageData(img, 0, 0);
    const cell = g.cell, bounds = L.latLngBounds(toLatLng(0, H * cell), toLatLng(W * cell, 0));
    layer = L.imageOverlay(c.toDataURL(), bounds, { pane: 'reachPane', interactive: false, className: 'reachimg' }).addTo(map);
    // the day lines: where a cell's day differs from its neighbour's (marching along the grid's edges)
    const segs = [], at = (x, y) => toLatLng(x * cell, y * cell);
    const day = i => { const v = d[i]; return v <= max ? Math.floor(v) : 99; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = day(i);
      if (x + 1 < W) { const b = day(i + 1); if (a !== b && Math.min(a, b) < max) segs.push([at(x + 1, y), at(x + 1, y + 1)]); }
      if (y + 1 < H) { const b = day(i + W); if (a !== b && Math.min(a, b) < max) segs.push([at(x, y + 1), at(x + 1, y + 1)]); }
    }
    lines = L.polyline(joinSegs(segs).map(l => chaikin(chaikin(l))), { pane: 'reachPane', color: '#3a2412', weight: 1.4, opacity: 0.75, interactive: false, smoothFactor: 1 }).addTo(map);
    // labels: walking out from the start towards the north-east, where each day ends
    labels = L.layerGroup().addTo(map);
    const sx = res.s % W, sy = (res.s / W) | 0;
    for (const ang of [-Math.PI / 4]) {
      let lastDay = 0;
      for (let r = 1; r < Math.max(W, H); r++) {
        const x = Math.round(sx + Math.cos(ang) * r), y = Math.round(sy + Math.sin(ang) * r);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const v = d[y * W + x]; if (!(v <= max)) continue;
        const dd = Math.floor(v);
        if (dd > lastDay) { lastDay = dd; if (max > 4 && ![1, 2, 3, 5, 7, 10, 14].includes(dd)) continue; labels.addLayer(L.marker(at(x + 0.5, y + 0.5), { pane: 'reachPane', interactive: false, icon: L.divIcon({ className: 'reachlbl', html: `<span>${dd} day${dd === 1 ? '' : 's'}</span>`, iconSize: [0, 0] }) })); }
      }
    }
    pin = L.marker(toLatLng(origin.x, origin.y), { pane: 'reachPane', interactive: false, icon: L.divIcon({ className: 'reachpin', html: '<i></i>', iconSize: [0, 0] }) }).addTo(map);
  }
  // round off the corners (twice over: the lines come out as curves); the ends of an open line stay where they are
  function chaikin(pts) {
    if (pts.length < 3) return pts;
    const closed = pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng;
    const out = closed ? [] : [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(L.latLng(a.lat * 0.75 + b.lat * 0.25, a.lng * 0.75 + b.lng * 0.25), L.latLng(a.lat * 0.25 + b.lat * 0.75, a.lng * 0.25 + b.lng * 0.75));
    }
    if (closed) out.push(out[0]); else out.push(pts[pts.length - 1]);
    return out;
  }
  // join touching segments into longer lines (fewer for the map to draw)
  function joinSegs(segs) {
    const key = ll => ll.lat.toFixed(3) + ',' + ll.lng.toFixed(3);
    const ends = new Map(); const used = new Uint8Array(segs.length); const out = [];
    segs.forEach((s, i) => { for (const e of [0, 1]) { const k = key(s[e]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const line = [segs[i][0], segs[i][1]];
      for (const dir of [1, 0]) {
        for (let guard = 0; guard < 100000; guard++) {
          const tip = dir ? line[line.length - 1] : line[0], list = ends.get(key(tip)) || [];
          const j = list.find(n => !used[n]); if (j == null) break; used[j] = 1;
          const s = segs[j], other = key(s[0]) === key(tip) ? s[1] : s[0];
          if (dir) line.push(other); else line.unshift(other);
        }
      }
      out.push(line);
    }
    return out;
  }
  function clearLayers() { for (const l of [layer, lines, labels, pin]) if (l) l.remove(); layer = lines = labels = pin = null; }

  // ───────── the rings, doing it ─────────
  function from(x, y) {
    const g = makeGrid(); if (!g) { toast('The land mask isn’t loaded, so the distances can’t be worked out.', true); return; }
    const p = pace(), bySea = BYSEA.test(p.label || ''), perDay = (+p.mph || 3) * (+p.hours || 8);
    const sx = clamp(Math.floor(x / g.cell), 0, g.W - 1), sy = clamp(Math.floor(y / g.cell), 0, g.H - 1);
    const r = spread(g, sx, sy, bySea, perDay, days);
    if (!r) { toast(bySea ? 'No sea near there to sail from.' : 'No land near there to set out from.', true); return; }
    origin = { x, y }; res = { g, dist: r.dist, s: r.s, days, perDay, bySea, label: p.label };
    draw(); ctx.renderPanel();
    // frame the rings
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.W * g.H; i++) if (r.dist[i] <= days) { const cx = i % g.W, cy = (i / g.W) | 0; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; }
    if (x1 >= x0) map.flyToBounds(L.latLngBounds(toLatLng(x0 * g.cell, (y1 + 1) * g.cell), toLatLng((x1 + 1) * g.cell, y0 * g.cell)).pad(0.15), { duration: 0.8, paddingBottomRight: [ctx.panelMode() === 'reach' ? 400 : 0, 0] });
  }
  function clear() { origin = null; res = null; clearLayers(); hideTip(); if (ctx.panelMode() === 'reach') ctx.renderPanel(); }
  function daysAt(ll) {
    if (!res) return null;
    const p = toPixel(ll), g = res.g, x = Math.floor(p.x / g.cell), y = Math.floor(p.y / g.cell);
    if (x < 0 || y < 0 || x >= g.W || y >= g.H) return null;
    const v = res.dist[y * g.W + x]; return v <= res.days ? v : null;
  }
  const tip = L.DomUtil.create('div', 'reachtip', map.getContainer()); tip.hidden = true;
  function hideTip() { tip.hidden = true; }
  map.on('mousemove', e => {
    if (!res || ctx.panelMode() !== 'reach' || tab !== 'rings') { hideTip(); return; }
    const v = daysAt(e.latlng);
    if (v == null) { hideTip(); return; }
    const miles = v * res.perDay;
    tip.textContent = v < 1 ? `${Math.max(1, Math.round(v * (+pace().hours || 8)))} hours’ ${res.bySea ? 'sailing' : 'travel'} · ${ctx.distText(miles, true)}`
      : `${v.toFixed(1)} days · ${ctx.distText(miles, true)}`;
    tip.hidden = false; tip.style.left = (e.containerPoint.x + 16) + 'px'; tip.style.top = (e.containerPoint.y + 14) + 'px';
  });
  map.on('mouseout', hideTip);
  map.on('click', e => {
    if (!armed || ctx.panelMode() !== 'reach' || ctx.editMode()) return;
    const p = toPixel(e.latlng);
    if (tab === 'rings') from(p.x, p.y); else wayClick(p.x, p.y);
  });
  const pane = map.createPane('reachPane'); pane.style.zIndex = 590; pane.style.pointerEvents = 'none';

  // ───────── the way from one place to another ─────────
  // how much of a place it is: towns put travellers up for the night, and the bigger ones on the coast have boats
  const RANK = { capital: 6, city: 5, 'free-city': 5, town: 4, village: 3, fortress: 2, hamlet: 1 };
  const J = { from: null, to: null, pace: -1, ships: true, salt: 0, res: null, picking: null, playing: false };
  const named = m => m && m.name && !m.unnamed && !/^unnamed$/i.test(m.name) && isFinite(m.x) && isFinite(m.y);
  // the places worth naming in an itinerary, and the towns by the cells of the grid (within a cell of one)
  function townsOf(g) {
    const ms = ctx.data().markers;
    const sig = ms.length + ':' + ms.reduce((s, m) => s + (m.x | 0) + (m.y | 0), 0);
    if (g.towns && g.townSig === sig) return g.towns;
    const { W, H, land } = g;
    const list = ms.filter(m => named(m) && (RANK[m.type] || (m.info && m.info['Port / Dock'])));
    const at = new Int32Array(W * H).fill(-1), atD = new Float32Array(W * H).fill(1e9);
    const port = new Int32Array(W * H).fill(-1);
    list.forEach((m, ti) => {
      const cx = Math.floor(m.x / g.cell), cy = Math.floor(m.y / g.cell), rank = RANK[m.type] || 2;
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x, d = Math.hypot((x + 0.5) * g.cell - m.x, (y + 0.5) * g.cell - m.y) - rank * g.cell * 0.2;
        if (d < atD[i]) { atD[i] = d; at[i] = ti; }
      }
      // its harbour: the coast within a couple of cells (three for a place with a Port / Dock); not the hamlets
      const isPort = m.info && m.info['Port / Dock'], R = isPort ? 3 : 2;
      if (!isPort && rank < 3) return;
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x; if (!land[i]) continue;
        if (land[i - 1] && land[i + 1] && land[i - W] && land[i + W]) continue;   // not on the coast
        if (port[i] < 0 || (RANK[list[port[i]].type] || 2) < rank) port[i] = ti;
      }
    });
    g.towns = { list, at, port }; g.townSig = sig;
    return g.towns;
  }
  // Dijkstra from a to b: over land at the land pace (quicker on the roads), over the sea at the ship's (a little
  // quicker along the sea lanes), between the two only at a harbour, and that costs some hours. → the cells, in order
  function findWay(g, a, b, o) {
    const { W, H, land, road, lane } = g, N = W * H;
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N), q = heap();
    dist[a] = 0; q.push(0, a);
    while (q.size) {
      const i = q.pop(); if (done[i]) continue; done[i] = 1;
      if (i === b) break;
      const di = dist[i], x = i % W, y = (i / W) | 0, li = land[i];
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (done[j]) continue;
        const lj = land[j];
        let cost;
        if (li && lj) {
          if (!(o.stepL < Infinity)) continue;
          if (dx && dy && (!land[y * W + nx] || !land[ny * W + x])) continue;   // no cutting across a bay
          cost = c * o.stepL * (road[i] && road[j] ? 0.66 : 1);
        } else if (!li && !lj) {
          if (!(o.stepS < Infinity)) continue;
          if (dx && dy && (land[y * W + nx] || land[ny * W + x])) continue;    // nor across a headland
          cost = c * o.stepS * (lane[i] && lane[j] ? 0.85 : 1);
        } else {
          if (dx && dy) continue;
          const lc = li ? i : j;
          if (!o.port || o.port[lc] < 0) continue;
          cost = c * (li ? o.stepS : o.stepL) + o.embark;
        }
        const nd = di + cost;
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; q.push(nd, j); }
      }
    }
    if (!(dist[b] < Infinity)) return null;
    const path = [];
    for (let i = b, guard = 0; i >= 0 && guard < N; i = prev[i], guard++) { path.push(i); if (i === a) break; }
    path.reverse();
    return { path, cum: path.map(i => dist[i]) };
  }

  // ── the places, by name (for the From and To boxes) ──
  let placeIdx = null;
  function places() {
    const ms = ctx.data().markers;
    if (placeIdx && placeIdx.n === ms.length) return placeIdx.list;
    const rows = ms.filter(m => named(m) && !(ctx.typeOf(m).text && m.type === 'country'));
    const count = new Map(); for (const m of rows) count.set(m.name.toLowerCase(), (count.get(m.name.toLowerCase()) || 0) + 1);
    const list = rows.map(m => {
      const dup = count.get(m.name.toLowerCase()) > 1, nat = dup ? ctx.nationOfMarker(m) : '';
      return { m, label: dup ? `${m.name} (${nat || ctx.typeOf(m).label})` : m.name, rank: RANK[m.type] || 0 };
    }).sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
    placeIdx = { n: ms.length, list };
    return list;
  }
  function placeByLabel(s) {
    const q = String(s || '').trim().toLowerCase(); if (!q) return null;
    const l = places();
    return (l.find(p => p.label.toLowerCase() === q) || l.find(p => p.m.name.toLowerCase() === q) || l.find(p => p.m.name.toLowerCase().startsWith(q)) || {}).m || null;
  }
  const endOf = m => ({ x: m.x, y: m.y, name: m.name, mid: m.id, label: (places().find(p => p.m === m) || {}).label || m.name });
  // a spot that isn't a place: named by the nearest place
  function spotAt(x, y) {
    const near = nearestNamed(x, y, null);
    if (near && near.miles < 1.5) return endOf(near.m);
    const name = near ? (near.miles < 3 ? `outside ${near.m.name}` : `a spot ${ctx.distText(near.miles)} ${compass(x - near.m.x, y - near.m.y)} of ${near.m.name}`) : 'a spot in the wilds';
    return { x, y, name, label: name, spot: true };
  }
  function nearestNamed(x, y, filter) {
    let best = null, bd = Infinity;
    for (const m of ctx.data().markers) {
      if (!named(m) || m.type === 'country' || (filter && !filter(m))) continue;
      const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; }
    }
    return best ? { m: best, miles: bd * mpp() } : null;
  }
  function compass(dx, dy) {
    const a = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
    return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][Math.round(a / 45) % 8];
  }

  // ── the weather as it might be, day by day (seeded, so the same journey has the same weather until re-rolled) ──
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const WET = ['rain', 'storm', 'snow', 'blizzard'];
  function winterAt(t) {   // 0 at midsummer … 1 at midwinter, by the length of the day
    const sk = ctx.sky && ctx.sky(), c = sk && sk.calendar;
    if (!c || !Cal) return 0.4;
    const d = Cal.date(c.cal, t), YD = Cal.yearDays(c.cal);
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * (d.doy - c.cal.sun.summer) / YD);
  }
  function weatherFor(x, y, t, prev, rnd) {
    const cl = ctx.climateAt ? ctx.climateAt(x, y) : null;
    const wet = cl ? cl.wet : 1, coldC = cl ? cl.cold : 0;
    const pole = ctx.coldPole ? ctx.coldPole() : 'none', yy = y / (ctx.INFO ? ctx.INFO.height : 16384);
    const polar = pole === 'north' ? smooth01(0.4, 0.03, yy) : pole === 'south' ? smooth01(0.6, 0.97, yy) : pole === 'both' ? Math.max(smooth01(0.32, 0.03, yy), smooth01(0.68, 0.97, yy)) : 0;
    const winter = winterAt(t), cold = Math.max(coldC * 0.85, polar * 1.25) + winter * 0.6;
    const pWet = clamp(0.24 * wet * (0.75 + 0.5 * winter), 0.02, 0.75);
    const isWet = rnd() < (prev ? (WET.includes(prev) ? 0.5 : pWet * 0.75) : pWet);
    if (isWet) { const heavy = rnd() < 0.2; return cold > 1.05 ? (heavy ? 'blizzard' : 'snow') : (heavy && winter < 0.7 ? 'storm' : 'rain'); }
    const r = rnd();
    if (r < 0.06 + winter * 0.1) return 'fog';
    return r < 0.48 ? 'clear' : r < 0.8 ? 'cloudy' : 'overcast';
  }
  const WLABEL = Object.fromEntries((Cal ? Cal.WEATHER : [['clear', 'Clear'], ['cloudy', 'Some cloud'], ['overcast', 'Overcast'], ['fog', 'Fog'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow'], ['blizzard', 'Blizzard']]));
  WLABEL.clear = 'Fair';
  const WICON = {
    clear: '<circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    cloudy: '<circle cx="8.5" cy="8.5" r="3.2" fill="currentColor" opacity=".55"/><path d="M7 19h10a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8 12.4 3.3 3.3 0 0 0 7 19z"/>',
    overcast: '<path d="M6.5 18h11a3.8 3.8 0 0 0 .5-7.6 5.4 5.4 0 0 0-10.2 1.2A3.4 3.4 0 0 0 6.5 18z" fill="currentColor" fill-opacity=".35"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    rain: '<path d="M6.5 14h11a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8 7.4 3.3 3.3 0 0 0 6.5 14z"/><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>',
    storm: '<path d="M6.5 13h11a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8 6.4 3.3 3.3 0 0 0 6.5 13z"/><path d="M12.5 14.5l-2.5 4h3l-2 4" stroke-linejoin="round"/>',
    snow: '<path d="M6.5 13h11a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8 6.4 3.3 3.3 0 0 0 6.5 13z"/><circle cx="8.5" cy="17" r="1" fill="currentColor"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/><circle cx="15.5" cy="17" r="1" fill="currentColor"/>',
    blizzard: '<path d="M6.5 12h11a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8 5.4 3.3 3.3 0 0 0 6.5 12z"/><path d="M5 16h9M7 19.5h11"/><circle cx="17.5" cy="16" r="1" fill="currentColor"/>'
  };
  const wIcon = k => h('span', { class: 'wxi', title: WLABEL[k] || k, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${WICON[k] || WICON.clear}</svg>` });

  // ── working the way out ──
  function shipPace() { return paces().find(t => BYSEA.test(t.label || '')) || null; }
  function wayGo(opts) {
    opts = opts || {};
    wayClearLayers(); J.res = null;
    if (!J.from || !J.to) { ctx.renderPanel(); return; }
    const g = makeGrid(); if (!g) { toast('The land mask isn’t loaded, so the way can’t be worked out.', true); return; }
    const ps = paces(); if (J.pace < 0 || J.pace >= ps.length) J.pace = Math.max(0, ps.findIndex(t => /horse/i.test(t.label || '')));
    const p = ps[J.pace] || { label: 'On foot', mph: 3, hours: 10 };
    const sailing = BYSEA.test(p.label || ''), ship = sailing ? p : shipPace() || { label: 'By ship', mph: 4, hours: 24 };
    const cellMiles = g.cell * mpp();
    const perDayL = sailing ? 0 : (+p.mph || 3) * (+p.hours || 8), perDayS = (sailing || J.ships) ? (+ship.mph || 4) * (+ship.hours || 24) : 0;
    const T = townsOf(g);
    const cellOf = e => [clamp(Math.floor(e.x / g.cell), 0, g.W - 1), clamp(Math.floor(e.y / g.cell), 0, g.H - 1)];
    const ok = sailing ? i => !g.land[i] : i => !!g.land[i];
    const a = nearestCell(g, ...cellOf(J.from), ok), b = nearestCell(g, ...cellOf(J.to), ok);
    if (a < 0 || b < 0) { toast(sailing ? 'No sea near there to sail from.' : 'No land near there to set out from.', true); ctx.renderPanel(); return; }
    const o = { stepL: perDayL ? cellMiles / perDayL : Infinity, stepS: perDayS ? cellMiles / perDayS : Infinity, port: sailing ? null : (perDayS ? T.port : null), embark: 0.25 };
    const r = a === b ? { path: [a], cum: [0] } : findWay(g, a, b, o);
    if (!r) {
      toast(!sailing && !J.ships ? 'There’s no way there by land. Tick “Take ship over water” to sail.' : sailing ? 'There’s no way there by sea.' : 'There’s no way there from here (not by land, nor by sea from a town on the coast).', true);
      ctx.renderPanel(); return;
    }
    J.res = itinerary(g, T, r, { p, ship, sailing, perDayL, perDayS, cellMiles });
    wayDraw();
    ctx.renderPanel();
    if (opts.fit !== false) fitTo(J.res.bounds);
  }
  function fitTo(b, dur) {
    if (!b) return;
    const right = ctx.panelMode() === 'reach' ? Math.min(420, map.getSize().x * 0.45) : 40;
    map.flyToBounds(b, { duration: dur || 0.9, paddingTopLeft: [60, 70], paddingBottomRight: [right, 60], maxZoom: ctx.NATIVE - 1.5 });
  }

  // the itinerary: the path cut into days (stopping the night in a town where one's about), written out
  function itinerary(g, T, r, o) {
    const { path, cum } = r, { W, land, road, roadNames } = g, last = path.length - 1;
    const X = i => (i % W + 0.5) * g.cell, Y = i => (((i / W) | 0) + 0.5) * g.cell;
    const sea = k => !land[path[k]];
    const townOf = k => { const t = T.at[path[k]]; return t >= 0 && land[path[k]] ? T.list[t] : null; };
    const portOf = k => { const t = T.port[path[k]]; return t >= 0 ? T.list[t] : townOf(k); };
    const markerOf = e => (e && e.mid ? ctx.data().markers.find(m => m.id === e.mid) || null : null);
    const P = m => ({ place: m.name, page: ctx.pageForMarker ? ctx.pageForMarker(m) : null, m });
    const N = name => ({ place: name, page: ctx.pageForNation ? ctx.pageForNation(name) : null, nation: true });
    const nationAt = k => (ctx.nationAt ? (ctx.nationAt(X(path[k]), Y(path[k])) || {}).name || '' : '');
    // the sights along the way: named country (the map's place names), ruins, landmarks, temples
    const sights = ctx.data().markers.filter(m => named(m) && !RANK[m.type] && m.type !== 'country');
    const sightR = Math.max(g.cell * 1.5, 10 / mpp());
    const sightAt = k => { const x = X(path[k]), y = Y(path[k]); let best = null, bd = sightR; for (const m of sights) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } } return best; };
    // the days: as far as a day's travel goes, or back a little to a town to sleep in
    const cuts = []; let k0 = 0, d0 = 0;
    while (k0 < last) {
      let k1 = k0; while (k1 < last && cum[k1 + 1] - d0 <= 1.0001) k1++;
      if (k1 === k0) k1 = k0 + 1;
      if (k1 < last && cum[last] - d0 <= 1.12) k1 = last;   // an hour or so more: press on and arrive
      let end = k1, inn = null;
      if (k1 < last) for (let k = k1; k > k0 && cum[k] - d0 >= 0.68; k--) { const t = townOf(k); if (t && (RANK[t.type] || 0) >= 2) { end = k; inn = t; break; } }
      cuts.push({ k0, k1: end, inn });
      k0 = end; d0 = cum[end];
    }
    if (!cuts.length) cuts.push({ k0: 0, k1: 0, inn: null });
    // the dates, and the weather as it might be (the first day's: the sky's now, until rolled again)
    const sk = ctx.sky && ctx.sky(), c = sk && sk.calendar, t0 = c ? c.t : 0;
    const rnd = mulberry((path[0] * 73856093) ^ (path[last] * 19349663) ^ (J.salt * 83492791));
    const dayW = []; let prevW = null;
    cuts.forEach((cu, i) => {
      let w = i === 0 && !J.salt && ctx.weatherKind ? ctx.weatherKind(X(path[0]), Y(path[0])) : null;
      dayW.push(prevW = w || weatherFor(X(path[cu.k1]), Y(path[cu.k1]), t0 + i * 1440, prevW, rnd));
    });
    // one day's words: strings, and { place } for a name
    function words(cu, i) {
      const first = i === 0, lastDay = cu.k1 === last, bits = [];
      let landN = 0, roadN = 0, allSea = cu.k1 > cu.k0; const roadsUsed = new Map();
      for (let k = cu.k0; k <= cu.k1; k++) if (!sea(k)) allSea = false;
      for (let k = cu.k0 + 1; k <= cu.k1; k++) if (!sea(k)) { landN++; const rd = road[path[k]]; if (rd) { roadN++; if (rd !== 0xffff) roadsUsed.set(rd, (roadsUsed.get(rd) || 0) + 1); } }
      const top = [...roadsUsed].sort((a, b) => b[1] - a[1])[0];
      const via = !landN ? [] : roadN / landN > 0.5 ? (top ? ['along ', { place: roadNames[top[0] - 1] }] : ['along the road']) : roadN / landN > 0.15 ? ['partly by road'] : ['across country'];
      // what happens on the way, in order: the towns passed, the borders crossed, taking ship and landing
      const ev = [], seen = new Set([J.from.mid, J.to.mid, cu.inn && cu.inn.id].filter(Boolean));
      const t0w = townOf(cu.k0); if (t0w) seen.add(t0w.id);
      let nat = nationAt(cu.k0);
      for (let k = cu.k0 + 1; k <= cu.k1; k++) {
        const wasSea = sea(k - 1), isSea = sea(k);
        if (!wasSea && isSea) { const pt = portOf(k - 1); ev.push({ kind: 'ship', m: pt, k }); if (pt) seen.add(pt.id); continue; }
        if (wasSea && !isSea) { const pt = portOf(k); ev.push({ kind: 'land', m: pt, k }); if (pt) seen.add(pt.id); continue; }
        if (isSea) continue;
        const t = townOf(k);
        if (t && !seen.has(t.id) && k < cu.k1) { seen.add(t.id); ev.push({ kind: 'pass', m: t, k }); }
        const sg = sightAt(k);
        if (sg && !seen.has(sg.id)) { seen.add(sg.id); ev.push({ kind: 'by', m: sg, k }); }
        if ((k - cu.k0) % 2 === 0 || k === cu.k1) { const n = nationAt(k); if (n && n !== nat) ev.push({ kind: 'into', name: n, k }); if (n) nat = n; }
      }
      // how the day starts
      const fromM = first ? markerOf(J.from) : null, fromName = fromM ? P(fromM) : first ? J.from.name : null;
      // taking ship before anything else happens (in the harbour of the town you set out from): that's how the day starts
      const homeId = (first && fromM ? fromM.id : (townOf(cu.k0) || {}).id) || null;
      const shipFirst = ev.length && ev[0].kind === 'ship' && (ev[0].k <= cu.k0 + 2 || (ev[0].m && ev[0].m.id === homeId));
      // and landing in the harbour of the place you're going to is arriving there
      const toM0 = lastDay ? markerOf(J.to) : null, li = ev.map(e => e.kind).lastIndexOf('land');
      const landsThere = !!(toM0 && li >= 0 && (!ev[li].m || ev[li].m.id === toM0.id) && ev.slice(li + 1).every(e => e.kind !== 'pass' && e.kind !== 'ship'));
      if (landsThere) ev.splice(li);
      if (first && (o.sailing || shipFirst)) { bits.push('Set sail from ', fromName); if (shipFirst) ev.shift(); }
      else if (first) bits.push('Set out from ', fromName, ...(via.length ? [' ', ...via] : []));
      else if (sea(cu.k0)) bits.push(allSea ? 'On at sea' : 'At sea');
      else if (shipFirst) { const e0 = ev.shift(); bits.push('Take ship', ...(e0.m ? [' at ', P(e0.m)] : [])); }
      else if (via.length && via[0] === 'across country') bits.push(['Across country', 'Overland', 'On across country'][i % 3]);
      else if (via.length) bits.push(via[0].charAt(0).toUpperCase() + via[0].slice(1), ...via.slice(1));
      else bits.push('On');
      // the towns passed run together, the biggest few of them
      let passed = [], word = '';
      const flush = () => {
        if (!passed.length) return;
        const show = passed.slice().sort((a, b) => (RANK[b.type] || 0) - (RANK[a.type] || 0)).slice(0, word === 'past' ? 3 : 2);
        const ordered = passed.filter(m => show.includes(m)), more = passed.length - ordered.length;
        bits.push(`, ${word} `);
        ordered.forEach((m, j) => { if (j) bits.push(j === ordered.length - 1 && !more ? ' and ' : ', '); bits.push(P(m)); });
        if (more && word === 'past') bits.push(` and ${more === 1 ? 'one more' : more + ' more'}`);
        passed = [];
      };
      for (const e of ev) {
        if (e.kind === 'pass' || e.kind === 'by') { const w2 = e.kind === 'pass' ? 'past' : 'by'; if (w2 !== word) flush(); word = w2; passed.push(e.m); continue; }
        flush();
        if (e.kind === 'into') bits.push(', into ', N(e.name));
        else if (e.kind === 'ship') bits.push('; take ship', ...(e.m ? [' at ', P(e.m)] : []));
        else if (e.kind === 'land') bits.push('; land', ...(e.m ? [' at ', P(e.m)] : []));
      }
      flush();
      // and how it ends
      const ex = X(path[cu.k1]), ey = Y(path[cu.k1]);
      if (lastDay) {
        const frac = cum[last] - cum[cu.k0], hrs = o.sailing ? 24 : (+o.p.hours || 8);
        const hr = (((o.sailing ? 6 : 8) + frac * hrs) % 24 + 24) % 24;
        const when = hr < 11 ? 'in the morning' : hr < 14 ? 'about midday' : hr < 17.5 ? 'in the afternoon' : hr < 20.5 ? 'in the evening' : 'after dark';
        const toM = markerOf(J.to);
        bits.push(landsThere ? '. Come into harbour at ' : '. Arrive at ', toM ? P(toM) : J.to.name, ` ${when}.`);
        return { bits, end: 'arrive', allSea, hour: hr };
      }
      if (cu.inn) { bits.push('. The night at ', P(cu.inn), '.'); return { bits, end: 'inn', allSea }; }
      if (sea(cu.k1)) {
        const cx = path[cu.k1] % W, cy = (path[cu.k1] / W) | 0, nl = nearestCell(g, cx, cy, i => !!land[i]);
        const close = nl >= 0 && Math.hypot(nl % W - cx, ((nl / W) | 0) - cy) * o.cellMiles < 40;
        const n = close && ctx.nationAt ? (ctx.nationAt(X(nl), Y(nl)) || {}).name : '';
        if (n) bits.push('. A night aboard, off the coast of ', N(n), '.');
        else bits.push(close ? '. A night aboard, within sight of land.' : '. A night aboard, out of sight of land.');
        return { bits, end: 'ship', allSea };
      }
      const feat = nearestNamed(ex, ey, m => !RANK[m.type]), town = nearestNamed(ex, ey, m => !!RANK[m.type]);
      const wild = ctx.nationAt ? (ctx.nationAt(ex, ey) || {}).name : '';
      const camp = ['Camp', 'Make camp', 'Camp for the night'][i % 3];
      if (feat && feat.miles < 6) bits.push(`. ${camp} near `, P(feat.m), '.');
      else if (town && town.miles < 40) bits.push(`. ${camp} in the open, `, `${ctx.distText(Math.max(1, town.miles))} ${compass(ex - town.m.x, ey - town.m.y)} of `, P(town.m), '.');
      else if (wild) bits.push(['. Camp in the wilds of ', '. A night under the stars in ', '. Camp out in the wilds of '][i % 3], N(wild), '.');
      else bits.push(['. Camp in the wilds.', '. A night under the stars.', '. Camp where you can.'][i % 3]);
      return { bits, end: 'camp', allSea };
    }
    const stepMiles = (k0_, k1_) => { let s = 0; for (let k = k0_ + 1; k <= k1_; k++) { const a = path[k - 1], b = path[k]; s += Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0)); } return s * o.cellMiles; };
    // the rows of the itinerary: a day each, except that whole days at sea run together
    const rows = [];
    cuts.forEach((cu, i) => {
      const w = words(cu, i), miles = stepMiles(cu.k0, cu.k1), prev = rows[rows.length - 1];
      if (w.allSea && w.end === 'ship' && prev && prev.allSea && prev.end === 'ship') {
        prev.d1 = i + 1; prev.k1 = cu.k1; prev.miles += miles; prev.tail = w.bits.slice(w.bits.findIndex(b => typeof b === 'string' && /^\. A night/.test(b))); prev.days.push(i);
        if (['storm', 'blizzard', 'snow'].includes(dayW[i])) prev.rough = dayW[i];
        return;
      }
      rows.push({ d0: i + 1, d1: i + 1, k0: cu.k0, k1: cu.k1, bits: w.bits, end: w.end, allSea: w.allSea, miles, weather: dayW[i], days: [i], inn: cu.inn, hour: w.hour });
    });
    for (const rw of rows) if (rw.d1 > rw.d0) {
      const tail = (rw.tail || []).slice(); if (typeof tail[0] === 'string') tail[0] = tail[0].replace(/^\. A night/, '. The last night');
      rw.bits = [`${rw.d1 - rw.d0 + 1} days at sea`, rw.rough ? `, with ${rw.rough === 'storm' ? 'a storm' : rw.rough === 'blizzard' ? 'a blizzard' : 'snow'} on the way` : '', ...tail];
    }
    // the lines on the map: each row's stretch of the path, land and sea apart (the sea dotted), smoothed
    const pt = k => (k === 0 ? [J.from.x, J.from.y] : k === last ? [J.to.x, J.to.y] : [X(path[k]), Y(path[k])]);
    const stepSea = k => sea(k) || sea(k - 1);
    for (const rw of rows) {
      rw.runs = [];
      let start = rw.k0 + 1;
      for (let k = rw.k0 + 1; k <= rw.k1; k++) {
        if (k < rw.k1 && stepSea(k + 1) === stepSea(k)) continue;
        const pts = []; for (let j = start - 1; j <= k; j++) pts.push(pt(j));
        rw.runs.push({ sea: stepSea(k), ll: curve(pts) });
        start = k + 1;
      }
      if (!rw.runs.length) rw.runs.push({ sea: false, ll: [toLatLng(...pt(rw.k0)), toLatLng(...pt(rw.k1))] });
      const all = rw.runs.flatMap(r2 => r2.ll);
      rw.bounds = L.latLngBounds(all);
      rw.endLL = all[all.length - 1];
      rw.date = c && Cal ? (() => { const d = Cal.date(c.cal, t0 + rw.days[0] * 1440); return `${d.day} ${d.monthName}`; })() : '';
    }
    let seaDays = 0; for (let k = 1; k <= last; k++) if (sea(k) && sea(k - 1)) seaDays += cum[k] - cum[k - 1];
    const lr = rows[rows.length - 1], total = rows.length && lr ? (lr.d1 - 1) + Math.min(1, cum[last] - cum[lr.k0]) : cum[last];
    return { rows, total, seaDays, miles: rows.reduce((s, rw) => s + rw.miles, 0), pace: o.p.label, sailing: o.sailing,
      bounds: L.latLngBounds(rows.flatMap(rw => rw.runs.flatMap(r2 => r2.ll))).pad(0.06), startLL: toLatLng(J.from.x, J.from.y), endLL: toLatLng(J.to.x, J.to.y) };
  }
  // a path through cell centres → a smooth line: the grid's staircase straightened (Douglas-Peucker), then rounded
  function curve(pts) {
    const eps = (grid ? grid.cell : 40) * 0.7;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); if (b <= a + 1) continue;
      const [ax, ay] = pts[a], [bx, by] = pts[b], L2 = Math.hypot(bx - ax, by - ay) || 1;
      let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L2; if (d > md) { md = d; mi = i; } }
      if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const ll = pts.filter((_, i) => keep[i]).map(p => toLatLng(p[0], p[1]));
    return chaikin(chaikin(ll));
  }

  // ── drawing the way ──
  let wayLayer = null;
  const LINE = { color: '#a3241c', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false, pane: 'reachPane' };
  const CASE = { color: '#f6ecd6', weight: 7, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false, pane: 'reachPane' };
  function wayDraw() {
    wayClearLayers();
    const R = J.res; if (!R) return;
    wayLayer = L.layerGroup().addTo(map);
    R.rows.forEach((rw, i) => {
      rw.lines = rw.runs.map(run => {
        const cs = L.polyline(run.ll, CASE).addTo(wayLayer);
        const ln = L.polyline(run.ll, Object.assign({}, LINE, { dashArray: run.sea ? '1.5 7' : '9 6' })).addTo(wayLayer);
        return { cs, ln, ll: run.ll };
      });
      const lastRow = i === R.rows.length - 1;
      const n = rw.d1 > rw.d0 ? `${rw.d0}–${rw.d1}` : String(rw.d0);
      rw.badge = L.marker(rw.endLL, { pane: 'reachPane', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'waybadge ' + (lastRow ? 'end' : rw.end), iconSize: [0, 0],
          html: lastRow ? '<i></i><svg viewBox="0 0 24 24"><path d="M6 21V4" stroke="#2a1a0c" stroke-width="2" stroke-linecap="round"/><path d="M6.5 4.5h11l-2.6 3.6 2.6 3.6h-11z" fill="#a3241c" stroke="#2a1a0c" stroke-width="1.2" stroke-linejoin="round"/></svg>'
            : `<b>${n}</b>` }) }).addTo(wayLayer);
    });
    R.startMk = L.marker(R.startLL, { pane: 'reachPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'waystart', html: '<i></i>', iconSize: [0, 0] }) }).addTo(wayLayer);
  }
  function wayClearLayers() { stopAnim(); if (wayLayer) { wayLayer.remove(); wayLayer = null; } }
  function wayClear() { J.res = null; J.from = J.to = null; J.picking = null; wayClearLayers(); if (ctx.panelMode() === 'reach') ctx.renderPanel(); }
  function highlight(rw, on) { if (rw && rw.lines) for (const l of rw.lines) l.ln.setStyle({ weight: on ? 5 : 3 }); }
  function wayClick(x, y) {
    const e = spotAt(x, y);
    if (J.picking === 'from' || (!J.picking && !J.from)) J.from = e;
    else J.to = e;
    J.picking = null;
    if (J.from && J.to) wayGo(); else { ctx.renderPanel(); toast('Now click where you’re going (or pick it by name).'); }
  }
  function textOf(bits, md) {
    return bits.map(b => typeof b === 'string' ? b : md && b.page ? `**[[${b.page.title}|${b.place}]]**` : md ? `**${b.place}**` : b.place).join('');
  }
  function richOf(bits) {
    return bits.map(b => typeof b === 'string' ? b : b.m ? h('b', { class: 'wplace', title: `Show ${b.place} on the map`, onclick: e => { e.stopPropagation(); map.flyTo(toLatLng(b.m.x, b.m.y), Math.max(map.getZoom(), ctx.NATIVE - 2.5), { duration: 0.8 }); } }, b.place) : h('b', null, b.place));
  }
  function summaryLine(R) {
    const d = R.total, dt = d < 1 ? `${Math.max(1, Math.round(d * (R.sailing ? 24 : 9)))} hours` : `about ${fmtDays(d)}`;
    return `${R.pace} · ${dt} · ${ctx.distText(R.miles)}${R.seaDays >= 0.5 && !R.sailing ? ` (${fmtDays(R.seaDays)} of it at sea)` : ''}`;
  }
  function fmtDays(d) { const n = Math.max(0.5, Math.round(d * 2) / 2); return n === 0.5 ? 'half a day' : n === 1 ? 'a day' : `${n % 1 ? Math.floor(n) + '½' : n} days`; }
  function asText() {
    const R = J.res; if (!R) return '';
    const head = `The way from ${J.from.name} to ${J.to.name}: ${summaryLine(R)}`;
    return [head, ...R.rows.map(rw => `${rw.d1 > rw.d0 ? `Days ${rw.d0}–${rw.d1}` : `Day ${rw.d0}`}${rw.date ? ` (${rw.date})` : ''} · ${WLABEL[rw.weather] || rw.weather}: ${textOf(rw.bits)}`)].join('\n');
  }

  // ── watching it: a tale made on the spot, the line drawing itself day by day ──
  let anim = 0;
  function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
  function setRow(rw, f) {   // show f (0…1) of a row's line, and its badge once it's all there
    let total = 0; for (const l of rw.lines) l.len = l.len || pathLen(l.ll), total += l.len;
    let left = f * total, head = null;
    for (const l of rw.lines) {
      if (left >= l.len) { l.cs.setLatLngs(l.ll); l.ln.setLatLngs(l.ll); left -= l.len; head = l.ll[l.ll.length - 1]; continue; }
      if (left <= 0) { l.cs.setLatLngs([]); l.ln.setLatLngs([]); continue; }
      const part = cut(l.ll, left); l.cs.setLatLngs(part); l.ln.setLatLngs(part); head = part[part.length - 1]; left = 0;
    }
    const el = rw.badge && rw.badge.getElement(); if (el) el.style.opacity = f >= 1 ? 1 : 0;
    return head;
  }
  function pathLen(ll) { let s = 0; for (let i = 1; i < ll.length; i++) s += map.project(ll[i - 1], ctx.NATIVE).distanceTo(map.project(ll[i], ctx.NATIVE)); return s; }
  function cut(ll, len) {
    const out = [ll[0]];
    for (let i = 1; i < ll.length; i++) {
      const a = map.project(ll[i - 1], ctx.NATIVE), b = map.project(ll[i], ctx.NATIVE), d = a.distanceTo(b);
      if (len >= d) { out.push(ll[i]); len -= d; continue; }
      out.push(map.unproject(a.add(b.subtract(a).multiplyBy(len / (d || 1))), ctx.NATIVE)); break;
    }
    return out;
  }
  let token = null;
  function watch() {
    const R = J.res; if (!R || !ctx.playTale) return;
    const rows = R.rows;
    // a long way: a stage for every few days, so the telling doesn't drag
    const per = rows.length > 12 ? Math.ceil(rows.length / 10) : 1, stages = [];
    for (let i = 0; i < rows.length; i += per) stages.push(rows.slice(i, i + per));
    const size = map.getSize(), lift = z => size.y * 0.1 * Math.pow(2, ctx.NATIVE - z);   // the caption's below: look a little lower
    const view = b => {
      const z = clamp(map.getBoundsZoom(b, false, L.point(Math.min(320, size.x * 0.3), Math.min(380, size.y * 0.48))), map.getMinZoom(), ctx.NATIVE - 1.6);
      const p = toPixel(b.getCenter());
      return { x: Math.round(p.x), y: Math.round(p.y + lift(z)), z: +z.toFixed(2) };
    };
    const link = (e, m) => (m && ctx.pageForMarker && ctx.pageForMarker(m) ? `**[[${ctx.pageForMarker(m).title}|${e.name}]]**` : `**${e.name}**`);
    const fromM = J.from.mid ? ctx.data().markers.find(m => m.id === J.from.mid) : null, toM = J.to.mid ? ctx.data().markers.find(m => m.id === J.to.mid) : null;
    const nDays = rows[rows.length - 1].d1, howLong = R.total < 1 ? 'less than a day' : `about ${fmtDays(R.total)}`;
    const z0 = clamp(ctx.NATIVE - 2.6, map.getMinZoom(), ctx.NATIVE - 1.6), sp = toPixel(R.startLL);
    const stops = [{ x: Math.round(sp.x), y: Math.round(sp.y + lift(z0)), z: z0, pin: true, hour: 7.5, weather: rows[0].weather, title: `The road to ${J.to.name}`,
      text: `From ${link(J.from, fromM)} to ${link(J.to, toM)}: ${howLong} ${R.pace.toLowerCase()}, ${ctx.distText(R.miles)}${R.seaDays >= 0.5 && !R.sailing ? `, ${fmtDays(R.seaDays)} of it at sea` : ''}.` }];
    stages.forEach(st => {
      const b = L.latLngBounds(st.flatMap(rw => rw.runs.flatMap(r2 => r2.ll)));
      const a = st[0], z = st[st.length - 1];
      const title = st.length > 1 || a.d1 > a.d0 ? `Days ${a.d0}–${z.d1}` : `Day ${a.d0}`;
      const text = st.map(rw => (st.length > 1 ? `**Day ${rw.d0}${rw.d1 > rw.d0 ? '–' + rw.d1 : ''}.** ` : '') + textOf(rw.bits, true)).join(' ');
      stops.push(Object.assign(view(b), { title: title + (a.date ? ` · ${a.date}` : ''), text: `*${WLABEL[a.weather] || a.weather}.* ${text}`, weather: a.weather, hour: z.end === 'arrive' ? clamp(z.hour || 16, 9, 18.5) : 13, rows: st }));
    });
    stops.push(Object.assign(view(R.bounds), { title: J.to.name, text: `The whole way, ${nDays > 1 ? nDays + ' days' : 'a day'} on the road: ${ctx.distText(R.miles)} ${R.pace.toLowerCase()}.`, hour: 18.5 }));
    const t = { id: 'way', title: `From ${J.from.name} to ${J.to.name}`, stops: stops.map(s => { const c = Object.assign({}, s); delete c.rows; return c; }) };
    const showUpTo = i => {   // the days before stop i drawn, the rest not yet
      stopAnim();
      const done = new Set(stops.slice(1, i).flatMap(s => s.rows || []));
      for (const rw of rows) setRow(rw, done.has(rw) || i >= stops.length - 1 ? 1 : 0);
      if (token) token.setLatLng(i >= stops.length - 1 ? R.endLL : stops[i].rows ? stops[i].rows[0].runs[0].ll[0] : R.startLL);
    };
    J.playing = true;
    if (!token) token = L.marker(R.startLL, { pane: 'reachPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'waytoken', html: '<i></i>', iconSize: [0, 0] }) });
    token.setLatLng(R.startLL).addTo(map);
    const drawMs = s => {   // how long a stage's line takes to draw itself: its length on the screen, within reason
      const len = s.rows.reduce((a, rw) => a + rw.lines.reduce((b, l) => b + (l.len = l.len || pathLen(l.ll)), 0), 0);
      return clamp(len / Math.pow(2, ctx.NATIVE - s.z) * 6, 1600, 4200);
    };
    ctx.playTale(t, 0, { auto: true, local: true, badge: `${nDays > 1 ? nDays + ' days' : 'a day'} on the road`,
      // a stop stays as long as its line takes to draw and its words take to read
      holdFor: (s, i) => { const st = stops[i], w = String(s.text || '').split(/\s+/).length; return clamp((st && st.rows ? drawMs(st) / 1000 : 0) + 3 + w / 4.2, 6, 22); },
      hooks: {
        go: i => showUpTo(i),
        arrive: i => {
          const s = stops[i]; if (!s.rows) return;
          const dur = drawMs(s), start = performance.now();
          stopAnim();
          const step = now => {
            const f = clamp((now - start) / dur, 0, 1), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
            const tot = s.rows.length; let head = null;   // the stage's days one after another
            s.rows.forEach((rw, j) => { const fj = clamp(e * tot - j, 0, 1), hd = setRow(rw, fj); if (fj > 0 && hd) head = hd; });
            if (head && token) token.setLatLng(head);
            anim = f < 1 ? requestAnimationFrame(step) : 0;
          };
          anim = requestAnimationFrame(step);
        },
        stop: () => {
          stopAnim(); J.playing = false;
          if (token) token.remove();
          if (J.res) for (const rw of J.res.rows) setRow(rw, 1);
          if (ctx.panelMode() !== 'reach') ctx.openPanel('reach');
          if (J.res) setTimeout(() => fitTo(J.res.bounds, 1.2), 60);
        } } });
  }
  function copy() {
    const s = asText(); if (!s) return;
    (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('Copied: the itinerary, as text.'), () => prompt('The itinerary', s));
  }

  // ───────── the panel ─────────
  function render() {
    armed = true; map.getContainer().classList.add('reach-armed');
    const segs = h('div', { class: 'segs travtabs' },
      h('button', { class: tab === 'rings' ? 'on' : null, onclick: () => { if (tab === 'rings') return; tab = 'rings'; wayClearLayers(); ctx.renderPanel(); } }, 'How far in a day'),
      h('button', { class: tab === 'way' ? 'on' : null, onclick: () => { if (tab === 'way') return; tab = 'way'; clear(); if (J.res) wayDraw(); ctx.renderPanel(); } }, 'The way to…'));
    return ctx.panelShell('Travel', segs, tab === 'rings' ? ringsBody() : wayBody());
  }
  function ringsBody() {
    const ps = paces();
    const sum = res ? (() => {
      const k = Math.min(res.days, 3), rows = [];
      for (let i = 1; i <= k; i++) rows.push(`${i} day${i === 1 ? '' : 's'}: up to about ${ctx.distText(res.perDay * i)}`);
      return h('div', { class: 'reachsum' }, h('b', null, `${res.label}${res.bySea ? ' (round the land)' : ''}`), h('ul', null, ...rows.map(r => h('li', null, r))),
        h('p', { class: 'small muted' }, 'Point anywhere inside the rings for the days to it.'));
    })() : h('p', { class: 'muted' }, 'Click the map where you set out from.');
    return [
      h('p', { class: 'small muted' }, 'Rings for each day’s travel from a place: going round the sea (or, by ship, round the land), quicker along roads. The paces are the ruler’s (Edit mode › the ruler).'),
      h('div', { class: 'form' },
        h('label', null, 'Travelling'),
        h('select', { onchange: e => { mode = +e.target.value; if (origin) from(origin.x, origin.y); else ctx.renderPanel(); } },
          ...ps.map((t, i) => h('option', { value: i, selected: i === mode || null }, `${t.label} (${+t.mph} mph, ${+t.hours} hours a day)`))),
        h('div', { class: 'sl' }, h('label', null, 'Out to ', h('span', { class: 'val' }, `${days} day${days === 1 ? '' : 's'}`)),
          h('input', { type: 'range', min: 1, max: 14, step: 1, value: days, onchange: e => { days = +e.target.value; if (origin) from(origin.x, origin.y); else ctx.renderPanel(); } }))),
      sum,
      res ? h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: clear }, 'Clear')) : null];
  }
  let busy = false;
  function wayBody() {
    const ps = paces();
    if (J.pace < 0 || J.pace >= ps.length) J.pace = Math.max(0, ps.findIndex(t => /horse/i.test(t.label || '')));
    const sailing = BYSEA.test((ps[J.pace] || {}).label || '');
    const list = h('datalist', { id: 'wayPlaces' }, ...places().map(p => h('option', { value: p.label })));
    const end = which => {
      const e = J[which];
      const inp = h('input', { type: 'text', list: 'wayPlaces', value: e ? e.label : '', placeholder: 'A place, or click the map', spellcheck: 'false',
        onchange: ev => {
          const v = ev.target.value.trim();
          if (busy || v === (J[which] ? J[which].label : '')) return;
          busy = true; setTimeout(() => { busy = false; }, 0);
          if (!v) { J[which] = null; J.res = null; wayClearLayers(); ctx.renderPanel(); return; }
          const m = placeByLabel(v);
          if (!m) { toast(`There’s no place called “${v}” on the map.`, true); return; }
          J[which] = endOf(m);
          if (J.from && J.to) wayGo(); else { ctx.renderPanel(); map.flyTo(toLatLng(m.x, m.y), Math.max(map.getZoom(), ctx.NATIVE - 3), { duration: 0.8 }); }
        } });
      return h('div', { class: 'wayend' }, h('label', null, which === 'from' ? 'From' : 'To'), inp,
        h('button', { class: 'btn sm' + (J.picking === which ? ' on' : ''), title: 'Pick it on the map', onclick: () => { J.picking = J.picking === which ? null : which; ctx.renderPanel(); if (J.picking) toast(which === 'from' ? 'Click the map where you set out from.' : 'Click the map where you’re going.'); } }, '◎'));
    };
    const R = J.res;
    return [
      list,
      h('p', { class: 'small muted' }, 'The way a party would go: along the roads where there are any, by ship from a town on the coast when the sea is quicker, the night in a town when there’s one about. Pick two places, or click the map twice.'),
      h('div', { class: 'form wayform' },
        end('from'),
        h('div', { class: 'wayswap' }, h('button', { class: 'linkbtn', title: 'Swap them round', onclick: () => { [J.from, J.to] = [J.to, J.from]; if (J.from && J.to) wayGo(); else ctx.renderPanel(); } }, '⇅ swap')),
        end('to'),
        h('label', null, 'Travelling'),
        h('select', { onchange: e => { J.pace = +e.target.value; if (J.from && J.to) wayGo({ fit: false }); else ctx.renderPanel(); } },
          ...ps.map((t, i) => h('option', { value: i, selected: i === J.pace || null }, `${t.label} (${+t.mph} mph, ${+t.hours} hours a day)`))),
        sailing ? null : h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: J.ships || null, onchange: e => { J.ships = e.target.checked; if (J.from && J.to) wayGo({ fit: false }); } }), 'Take ship over water, from towns on the coast')),
      R ? h('div', { class: 'wayres' },
        h('div', { class: 'waysum' }, h('b', null, `${J.from.name} → ${J.to.name}`), h('div', null, summaryLine(R))),
        h('div', { class: 'btnrow' },
          ctx.playTale ? h('button', { class: 'btn primary', onclick: watch, title: 'Watch the journey as a tale: the line drawing itself across the map, day by day' }, '▶ Watch the journey') : null,
          h('button', { class: 'btn', onclick: copy, title: 'Copy the itinerary as text' }, 'Copy'),
          h('button', { class: 'btn', title: 'The weather as it might be: roll it again', onclick: () => { J.salt++; wayGo({ fit: false }); } }, '↻ Weather'),
          h('button', { class: 'btn', onclick: wayClear }, 'Clear')),
        h('ol', { class: 'wayrows' }, ...R.rows.map(rw => h('li', { class: 'wayrow ' + rw.end, onmouseenter: () => highlight(rw, true), onmouseleave: () => highlight(rw, false), onclick: () => fitTo(rw.bounds.pad(0.25), 0.8) },
          h('div', { class: 'wayhd' }, h('b', null, rw.d1 > rw.d0 ? `Days ${rw.d0}–${rw.d1}` : `Day ${rw.d0}`), rw.date ? h('span', { class: 'muted' }, rw.date) : null, h('span', { class: 'sp' }),
            h('span', { class: 'wx' }, wIcon(rw.weather), WLABEL[rw.weather] || rw.weather)),
          h('div', { class: 'waytx' }, ...richOf(rw.bits))))),
        h('p', { class: 'small muted' }, 'The weather is as it might be (the first day’s is the sky’s now); the nights in towns are where there’s one near the end of the day.')) :
        h('p', { class: 'muted' }, !J.from ? 'Where from? Pick a place, or click the map.' : 'And where to? Pick a place, or click the map.')
    ];
  }
  ctx.registerPanel('reach', { render, closed: () => {
    armed = false; map.getContainer().classList.remove('reach-armed');
    origin = null; res = null; clearLayers(); hideTip();
    if (!J.playing) { J.picking = null; wayClearLayers(); }
  } });
  // from a place's card: the way from it, or to it
  function openWay() { tab = 'way'; clear(); if (ctx.panelMode() !== 'reach') ctx.openPanel('reach'); else ctx.renderPanel(); }
  function wayFrom(m) { J.from = endOf(m); if (J.to && J.to.mid === m.id) J.to = null; openWay(); if (J.from && J.to) wayGo(); else toast('Now pick where you’re going, or click the map.'); }
  function wayTo(m) { J.to = endOf(m); if (J.from && J.from.mid === m.id) J.from = null; openWay(); if (J.from && J.to) wayGo(); else toast('Now pick where you set out from, or click the map.'); }
  function openRings() { tab = 'rings'; wayClearLayers(); if (ctx.panelMode() !== 'reach') ctx.openPanel('reach'); else ctx.renderPanel(); }
  return { from, clear, wayFrom, wayTo, openWay, openRings, state: () => ({ armed, origin, mode, days, res: !!res, tab, way: J.res ? { rows: J.res.rows.length, total: J.res.total, miles: J.res.miles, text: asText() } : null }) };
};
