/* Life on the world map: the things that make it feel lived in, none of them saved or shared.
 *  · lights at night: towns glow warm as the sun goes down, by size (a capital blazes, a hamlet is a candle)
 *  · ships on the sea lanes (Routes › Sea lane, or a few found between coastal towns), birds over the coasts
 *  · the seasons, by the calendar's day: snow where it's cold in winter, the plains browning in late summer
 *  · a drawn map's framing: a parchment vignette, a compass rose (click: the whole world), an inked scale bar
 *  · the party's journeys, sent in by the table: dotted trails with their dates
 * Each can be switched off in Map settings › Life on the map.
 *
 * ValanarAmbience(ctx) → { sky(state), refresh(), setJourneys(list), focusJourney(id) }. ctx comes from app.js. */
'use strict';
window.ValanarAmbience = function (ctx) {
  const { map, L, NATIVE, toLatLng, toPixel, Land } = ctx;
  const W = ctx.size.w, H = ctx.size.h;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const life = () => Object.assign({ lights: true, ships: true, birds: true, seasons: true, frame: true, cold: 'north' }, (ctx.look() || {}).life || {});
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  let sky = { dark: 0, cal: null, t: 0, kind: 'clear' };

  // ───────── two canvases over the map, kept to the screen ─────────
  // life (ships, birds) sits under the night's tint so the dark falls on them too; the lights sit over it, screened
  const mkPane = (name, z, blend) => { const p = map.getPane(name) || map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = 'none'; if (blend) p.style.mixBlendMode = blend; return p; };
  const lifeCv = L.DomUtil.create('canvas', 'ambfx', mkPane('ambLife', 420));
  const lightCv = L.DomUtil.create('canvas', 'ambfx', mkPane('ambLights', 449, 'screen'));
  let zooming = false;
  // (an animated zoom only: when the map flies, for a tale or Drift, everything is drawn frame by frame as it goes)
  map.on('zoomanim', () => { zooming = true; lifeCv.style.opacity = lightCv.style.opacity = 0; });
  map.on('zoomend', () => { zooming = false; lifeCv.style.opacity = lightCv.style.opacity = 1; draw(performance.now(), true); });
  function fit(cv) {
    const s = map.getSize(), d = DPR();
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    if (cv.width !== Math.round(s.x * d) || cv.height !== Math.round(s.y * d)) { cv.width = Math.round(s.x * d); cv.height = Math.round(s.y * d); cv.style.width = s.x + 'px'; cv.style.height = s.y + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, s.x, s.y);
    return g;
  }
  // map pixels → screen pixels for this frame
  function frameView() {
    const z = map.getZoom(), k = Math.pow(2, NATIVE - z), o = toPixel(map.containerPointToLatLng([0, 0])), s = map.getSize();
    return { z, k, ox: o.x, oy: o.y, sw: s.x, sh: s.y, sx: x => (x - o.x) / k, sy: y => (y - o.y) / k };
  }

  // ───────── land and sea ─────────
  const isLand = (x, y) => {
    if (!Land.ready) return true;
    const cx = Math.floor(x / Land.scale), cy = Math.floor(y / Land.scale);
    if (cx < 0 || cy < 0 || cx >= Land.w || cy >= Land.h) return false;
    return Land.v[cy * Land.w + cx] >= 128;
  };
  const nearSea = (x, y, r) => { for (let a = 0; a < 8; a++) { const t = a / 8 * Math.PI * 2; if (!isLand(x + Math.cos(t) * r, y + Math.sin(t) * r)) return true; } return false; };

  // ───────── lights at night ─────────
  const GLOW = { capital: 1, 'free-city': 0.8, city: 0.78, town: 0.55, fortress: 0.45, temple: 0.36, village: 0.3, camp: 0.22, mine: 0.18, hamlet: 0.18 };
  let lights = [], lightsSig = '';
  function collectLights() {
    const ms = ctx.data().markers || [];
    const sig = ms.length + ':' + (ms[0] && ms[0].id) + ':' + (ms[ms.length - 1] && ms[ms.length - 1].id);
    if (sig === lightsSig) return; lightsSig = sig;
    lights = [];
    for (const m of ms) {
      let w = GLOW[m.type];
      if (w == null) { const t = ctx.typeOf(m); w = t && t.fields === 'place' && !/ruin|feature|landmark|country/.test(m.type) ? 0.3 : 0; }
      if (!w || !isFinite(m.x) || !isFinite(m.y)) continue;
      lights.push({ x: m.x, y: m.y, w, seed: hash(m.x * 0.013 + m.y * 0.007) * 100 });
    }
  }
  // a warm glow drawn once and stamped (much cheaper than a gradient per town)
  const glowSprite = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,226,160,1)'); gr.addColorStop(0.12, 'rgba(255,190,100,0.85)'); gr.addColorStop(0.35, 'rgba(255,150,60,0.35)');
    gr.addColorStop(0.7, 'rgba(230,110,40,0.08)'); gr.addColorStop(1, 'rgba(200,90,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c;
  })();
  const lightLevel = () => life().lights === false ? 0 : smooth(0.28, 0.78, sky.dark);
  function drawLights(t, v) {
    const g = fit(lightCv), lv = lightLevel();
    if (lv <= 0.01) return false;
    collectLights();
    const zk = Math.pow(2, v.z - 4);   // 1 at zoom 4
    for (const L0 of lights) {
      const x = v.sx(L0.x), y = v.sy(L0.y);
      const r = clamp(46 * L0.w * Math.pow(zk, 0.7), 2 + 6 * L0.w, 150 * L0.w);
      if (x < -r || y < -r || x > v.sw + r || y > v.sh + r) continue;
      if (r < 3) continue;
      const fl = 0.86 + 0.08 * Math.sin(t * 0.0021 + L0.seed) + 0.06 * Math.sin(t * 0.0057 + L0.seed * 1.7);
      g.globalAlpha = clamp(lv * fl * (0.55 + 0.45 * L0.w));
      g.drawImage(glowSprite, x - r, y - r, r * 2, r * 2);
      // close up, the town is a cluster of lit windows rather than one glow
      if (v.z >= 4.5 && L0.w >= 0.3) {
        const n = Math.round(3 + L0.w * 9), spread = r * 0.28;
        g.fillStyle = 'rgba(255,214,140,1)';
        for (let i = 0; i < n; i++) {
          const a = hash(L0.seed + i) * Math.PI * 2, d = Math.sqrt(hash(L0.seed * 3 + i)) * spread;
          const on = 0.6 + 0.4 * Math.sin(t * 0.0013 * (1 + hash(i + L0.seed)) + i);
          g.globalAlpha = clamp(lv * on); g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.4, 1.4);
        }
      }
    }
    // ships carry a lantern
    if (v.z >= 2.5) for (const s of ships) {
      if (!s.at) continue;
      const x = v.sx(s.at[0]), y = v.sy(s.at[1]); if (x < -10 || y < -10 || x > v.sw + 10 || y > v.sh + 10) continue;
      g.globalAlpha = lv * 0.8; g.drawImage(glowSprite, x - 7, y - 7, 14, 14);
    }
    g.globalAlpha = 1;
    return true;
  }

  // ───────── ships on the sea lanes ─────────
  let lanes = [], ships = [], lanesFor = '';
  const LANES_KEY = 'valanar-found-lanes';
  function laneFrom(pts) {
    const seg = []; let len = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); len += d; }
    return len > 400 ? { pts, seg, len } : null;
  }
  function pointOn(l, d) {
    d = clamp(d, 0, l.len);
    for (let i = 0; i < l.seg.length; i++) {
      if (d <= l.seg[i] || i === l.seg.length - 1) { const f = l.seg[i] ? d / l.seg[i] : 0, a = l.pts[i], b = l.pts[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])]; }
      d -= l.seg[i];
    }
    return l.pts[0];
  }
  function makeShips() {
    ships = [];
    lanes.forEach((l, i) => {
      const n = l.len > 6000 ? 3 : l.len > 2500 ? 2 : 1;
      for (let j = 0; j < n; j++) ships.push({ lane: l, d: hash(i * 7.3 + j) * l.len, dir: hash(i + j * 3.1) > 0.5 ? 1 : -1, v: 26 + hash(i * 3 + j) * 18, seed: hash(i * 11 + j * 5), kind: l.len > 6000 ? 2 : hash(i * 5 + j) > 0.5 ? 1 : 0, at: null });
    });
  }
  // the GM's sea lanes; with fewer than three, a handful found between coastal towns (once, kept in this browser)
  function setupLanes() {
    if (life().ships === false || !Land.ready) return;
    const sea = (ctx.data().routes || []).filter(r => r.kind === 'sea' && r.pts && r.pts.length > 1);
    const sig = sea.map(r => r.id + r.pts.length).join(',') + '|' + (ctx.data().markers || []).length + '|' + W;
    if (sig === lanesFor) return; lanesFor = sig;
    lanes = sea.map(r => laneFrom(r.pts.map(p => [+p[0], +p[1]]))).filter(Boolean);
    makeShips();
    if (lanes.length >= 3 || !ctx.seaPath) return;
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(LANES_KEY) || 'null'); } catch (e) { /* private window */ }
    if (kept && kept.sig === sig && Array.isArray(kept.lanes)) { lanes = lanes.concat(kept.lanes.map(laneFrom).filter(Boolean)); makeShips(); return; }
    const big = { capital: 3, 'free-city': 2, city: 2, town: 1 };
    const ports = (ctx.data().markers || []).filter(m => big[m.type] && isFinite(m.x) && isLand(m.x, m.y) && nearSea(m.x, m.y, 140));
    const pairs = [], seen = new Set();
    for (const a of ports) {
      const near = ports.filter(b => b !== a).map(b => [b, Math.hypot(b.x - a.x, b.y - a.y)]).filter(([, d]) => d > 1400 && d < 5200).sort((p, q) => p[1] - q[1]).slice(0, 2);
      for (const [b] of near) { const key = [a.id, b.id].sort().join('|'); if (!seen.has(key)) { seen.add(key); pairs.push([a, b, (big[a.type] + big[b.type]) + hash(a.x + b.y)]); } }
    }
    pairs.sort((p, q) => q[2] - p[2]);
    const todo = pairs.slice(0, 9), found = [];
    const later = window.requestIdleCallback || (f => setTimeout(f, 400));
    const next = () => {
      if (sig !== lanesFor) return;
      const p = todo.shift();
      if (!p) { try { localStorage.setItem(LANES_KEY, JSON.stringify({ sig, lanes: found })); } catch (e) { /* full */ } return; }
      let pts = null;
      try { pts = ctx.seaPath([p[0].x, p[0].y], [p[1].x, p[1].y]); } catch (e) { pts = null; }
      if (pts && pts.length > 1) {
        const l = laneFrom(pts), straight = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
        if (l && l.len < straight * 2.2) { found.push(pts); lanes.push(l); makeShips(); }
      }
      later(next, { timeout: 3000 });
    };
    later(next, { timeout: 3000 });
  }
  // Ships in the map's own hand: drawn side on in ink, as on an old chart (a cog, a caravel, a galleon), made once
  // as pictures and stamped; each faces the way it's sailing, rides the swell, and leaves a wake on the water.
  const SHIP_W = 240, SHIP_H = 220, WATERLINE = 172, INK = '#22160c';
  const SHIPS = [0, 1, 2].map(kind => {
    const c = document.createElement('canvas'); c.width = SHIP_W * 2; c.height = SHIP_H * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.lineJoin = 'round'; g.lineCap = 'round';
    const big = kind === 2;
    const sx = big ? 26 : 40, bx = big ? 214 : 204;                   // stern, bow
    const topY = big ? 140 : 148, endY = big ? 104 : 118;             // the gunwale midships, and at the ends
    const line = (pts, w, col) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); g.lineWidth = w; g.strokeStyle = col || INK; g.stroke(); };
    // rigging behind the sails
    const masts = kind === 0 ? [[122, 20]] : kind === 1 ? [[96, 30], [150, 18]] : [[70, 30], [122, 8], [172, 36]];
    g.globalAlpha = 0.7;
    for (const [mx, my] of masts) { line([[mx, my + 4], [sx + 6, endY + 2]], 1); line([[mx, my + 4], [bx - 2, endY + 4]], 1); }
    if (kind !== 1) line([[masts[masts.length - 1][0], masts[masts.length - 1][1] + 6], [bx + 26, endY - 6], [bx - 2, endY + 6]], 1);   // the bowsprit's stay
    g.globalAlpha = 1;
    // the hull: dark wood, planked, its ends rising
    const hull = () => {
      g.beginPath(); g.moveTo(sx, endY);
      g.quadraticCurveTo((sx + bx) / 2, topY + 8, bx, endY);
      g.quadraticCurveTo(bx - 6, WATERLINE - 6, bx - 30, WATERLINE);
      g.lineTo(sx + 22, WATERLINE);
      g.quadraticCurveTo(sx + 2, WATERLINE - 8, sx, endY); g.closePath();
    };
    hull(); g.fillStyle = '#5c3b22'; g.fill();
    g.save(); hull(); g.clip();
    for (let i = 1; i <= 3; i++) { const yy = i * 10; g.beginPath(); g.moveTo(sx - 4, endY + yy); g.quadraticCurveTo((sx + bx) / 2, topY + 8 + yy, bx + 4, endY + yy); g.lineWidth = 1.2; g.strokeStyle = 'rgba(30,18,8,.65)'; g.stroke(); }
    g.fillStyle = 'rgba(255,230,190,.12)'; g.fillRect(sx - 10, endY - 10, bx - sx + 20, 14);   // the light along the rail
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(sx - 10, WATERLINE - 14, bx - sx + 20, 30); // and the shade below
    if (big) for (let i = 0; i < 5; i++) { g.fillStyle = INK; g.fillRect(70 + i * 24, topY + 2, 7, 5); }   // gun ports
    g.restore();
    hull(); g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
    // the water along her side, in ink
    g.beginPath();
    for (let x = sx - 14; x < bx + 14; x += 12) { g.moveTo(x, WATERLINE + 1); g.quadraticCurveTo(x + 3, WATERLINE - 3, x + 6, WATERLINE + 1); g.quadraticCurveTo(x + 9, WATERLINE + 4, x + 12, WATERLINE + 1); }
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(34,22,12,.75)'; g.stroke();
    // castles fore and aft
    const castle = (x0, x1, y0, h) => { g.beginPath(); g.rect(x0, y0 - h, x1 - x0, h); g.fillStyle = '#7d5634'; g.fill(); g.lineWidth = 2; g.strokeStyle = INK; g.stroke();
      for (let x = x0 + 4; x < x1 - 2; x += 7) { g.fillStyle = INK; g.fillRect(x, y0 - h - 4, 3, 4); } };
    castle(sx - 2, sx + (big ? 50 : 36), endY + 6, big ? 26 : 16);
    if (kind !== 1) castle(bx - (big ? 34 : 30), bx + 2, endY + 6, big ? 14 : 12);
    // the bowsprit
    if (kind !== 1) line([[bx - 6, endY + 4], [bx + 28, endY - 8]], 3);
    // masts
    for (const [mx, my] of masts) line([[mx, topY + 4], [mx, my]], 3.2);
    // sails: cream canvas, billowing, shaded with ink on the lee side
    const sailFill = (path, shadeX0, shadeX1) => {
      path(); g.fillStyle = '#f3ead2'; g.fill();
      g.save(); path(); g.clip();
      const gr = g.createLinearGradient(shadeX0, 0, shadeX1, 0); gr.addColorStop(0, 'rgba(120,90,50,0)'); gr.addColorStop(1, 'rgba(120,90,50,.35)');
      g.fillStyle = gr; g.fillRect(shadeX0 - 60, 0, 200, SHIP_H);
      g.strokeStyle = 'rgba(90,60,30,.4)'; g.lineWidth = 0.9;
      for (let x = shadeX0 - 40; x < shadeX1 + 40; x += 5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, SHIP_H); g.stroke(); }
      g.restore();
      path(); g.lineWidth = 2.2; g.strokeStyle = INK; g.stroke();
    };
    const square = (mx, y0, y1, half, bulge) => {
      const path = () => { g.beginPath(); g.moveTo(mx - half, y0); g.lineTo(mx + half, y0);
        g.quadraticCurveTo(mx + half + bulge, (y0 + y1) / 2, mx + half - 2, y1); g.quadraticCurveTo(mx, y1 + bulge * 0.5, mx - half + 2, y1);
        g.quadraticCurveTo(mx - half + bulge * 0.6, (y0 + y1) / 2, mx - half, y0); g.closePath(); };
      sailFill(path, mx + half * 0.2, mx + half + bulge);
      line([[mx - half - 6, y0], [mx + half + 6, y0]], 2.6);   // the yard
    };
    const lateen = (mx, my) => {
      const A = [mx - 52, 112], B = [mx + 30, my], C = [mx + 22, 128];
      const path = () => { g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.quadraticCurveTo(B[0] + 22, (B[1] + C[1]) / 2, C[0], C[1]); g.quadraticCurveTo((A[0] + C[0]) / 2 + 4, 126, A[0], A[1]); g.closePath(); };
      sailFill(path, mx, mx + 40);
      line([[A[0] - 6, A[1] + 4], [B[0] + 4, B[1] - 3]], 2.4);
    };
    if (kind === 0) {
      square(122, 34, 120, 40, 14);
      g.beginPath(); g.arc(126, 76, 13, 0, Math.PI * 2); g.fillStyle = '#9e2b25'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();   // a device on the sail
    } else if (kind === 1) { lateen(96, 30); lateen(150, 18); }
    else {
      square(70, 40, 80, 24, 8); square(70, 86, 122, 30, 10);
      square(122, 18, 62, 28, 9); square(122, 68, 120, 36, 12);
      square(172, 46, 80, 20, 7); square(172, 86, 116, 25, 8);
      g.beginPath(); g.moveTo(122, 72); g.lineTo(122, 112); g.moveTo(104, 92); g.lineTo(140, 92); g.lineWidth = 4; g.strokeStyle = '#9e2b25'; g.stroke();   // a cross on the main course
    }
    // pennants at the mastheads
    for (const [mx, my] of masts) { g.beginPath(); g.moveTo(mx, my); g.quadraticCurveTo(mx - 14, my - 6, mx - 28, my - 2); g.lineTo(mx, my + 7); g.closePath(); g.fillStyle = '#9e2b25'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke(); }
    return c;
  });
  function drawShip(g, x, y, a, w, t, seed, kind) {
    const dx = Math.cos(a), dy = Math.sin(a), right = dx >= 0;
    // a short, soft wake: a small curved V just behind the stern, fading out
    const L = w * 0.75, st = [x - dx * w * 0.4, y - dy * w * 0.4 + w * 0.04];
    g.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ex = st[0] - dx * L - dy * side * L * 0.32, ey = st[1] - dy * L + dx * side * L * 0.32;
      const cx = st[0] - dx * L * 0.5 - dy * side * L * 0.08, cy = st[1] - dy * L * 0.5 + dx * side * L * 0.08;
      const gr = g.createLinearGradient(st[0], st[1], ex, ey); gr.addColorStop(0, 'rgba(244,250,247,.5)'); gr.addColorStop(1, 'rgba(244,250,247,0)');
      g.strokeStyle = gr; g.lineWidth = Math.max(0.6, w * 0.05);
      g.beginPath(); g.moveTo(st[0], st[1]); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    }
    // its shadow on the water
    g.fillStyle = 'rgba(10,30,36,.28)'; g.beginPath(); g.ellipse(x, y + w * 0.06, w * 0.42, w * 0.09, 0, 0, Math.PI * 2); g.fill();
    // the ship, side on, rolling on the swell
    const img = SHIPS[kind], h = w * SHIP_H / SHIP_W, bob = Math.sin(t * 0.0021 + seed * 31) * w * 0.012;
    g.save(); g.translate(x, y + bob); g.rotate(Math.sin(t * 0.0017 + seed * 17) * 0.05); if (!right) g.scale(-1, 1);
    // the sprite's waterline sits on the ship's point; the bow foam where it cuts the water
    g.drawImage(img, -w / 2, -h * WATERLINE / SHIP_H, w, h);
    g.fillStyle = 'rgba(248,252,250,.75)'; g.beginPath(); g.ellipse(w * 0.33, w * 0.0, w * 0.07, w * 0.02, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ───────── birds over the coasts, close up ─────────
  let flocks = [];
  function spawnFlock(v) {
    for (let tries = 0; tries < 30; tries++) {
      const x = v.ox + Math.random() * v.sw * v.k, y = v.oy + Math.random() * v.sh * v.k;
      if (!isLand(x, y) || !nearSea(x, y, 22 * Land.scale)) continue;
      const a = Math.random() * Math.PI * 2, n = 3 + Math.floor(Math.random() * 6);
      const birds = []; for (let i = 0; i < n; i++) birds.push({ dx: (Math.random() - 0.5) * 70, dy: (Math.random() - 0.5) * 70, ph: Math.random() * 6.28, sp: 0.9 + Math.random() * 0.3 });
      return { x, y, a, turn: (Math.random() - 0.5) * 0.25, born: performance.now(), life: 16000 + Math.random() * 18000, birds };
    }
    return null;
  }
  function drawBirds(g, t, v, dt) {
    if (life().birds === false || v.z < 4 || sky.dark > 0.6 || /storm|blizzard/.test(sky.kind)) { flocks = []; return false; }
    const want = v.z >= 5 ? 4 : 2;
    if (flocks.length < want && Math.random() < 0.02) { const f = spawnFlock(v); if (f) flocks.push(f); }
    const sz = clamp(5 * Math.pow(2, (v.z - 5) * 0.5), 3.5, 9);
    g.strokeStyle = 'rgba(32,30,28,0.85)'; g.lineCap = 'round'; g.lineJoin = 'round';
    flocks = flocks.filter(f => t - f.born < f.life);
    for (const f of flocks) {
      f.a += f.turn * dt * (0.5 + 0.5 * Math.sin(t * 0.0004 + f.born));
      const sp = 26 * v.k * dt;   // about 26 screen px a second, whatever the zoom
      f.x += Math.cos(f.a) * sp; f.y += Math.sin(f.a) * sp;
      const age = (t - f.born) / f.life, alpha = smooth(0, 0.08, age) * (1 - smooth(0.88, 1, age));
      g.globalAlpha = alpha; g.lineWidth = Math.max(1, sz * 0.18);
      for (const b of f.birds) {
        const x = v.sx(f.x) + b.dx * (sz / 6), y = v.sy(f.y) + b.dy * (sz / 6);
        if (x < -20 || y < -20 || x > v.sw + 20 || y > v.sh + 20) continue;
        const flap = Math.sin(t * 0.012 * b.sp + b.ph), wy = flap * sz * 0.45;
        g.beginPath(); g.moveTo(x - sz, y - wy); g.quadraticCurveTo(x - sz * 0.45, y - sz * 0.15 - wy * 0.6, x, y); g.quadraticCurveTo(x + sz * 0.45, y - sz * 0.15 - wy * 0.6, x + sz, y - wy); g.stroke();
      }
    }
    g.globalAlpha = 1;
    return flocks.length > 0;
  }

  // ───────── each frame (about 24 a second, only while something moves) ─────────
  let raf = 0, last = 0;
  function draw(t, force) {
    if (!ctx.isMapView() || document.hidden) return;
    const v = frameView(), dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    const g = fit(lifeCv);
    let busy = false;
    if (life().ships !== false && v.z >= 1.5) {
      const s = clamp(13 * Math.pow(2, (v.z - 4) * 0.5), 6, 28);   // the ship's width on screen: small, like a chart's
      for (const sh of ships) {
        sh.d += sh.dir * sh.v * dt;
        if (sh.d > sh.lane.len) { sh.d = sh.lane.len; sh.dir = -1; } else if (sh.d < 0) { sh.d = 0; sh.dir = 1; }
        const p = pointOn(sh.lane, sh.d); sh.at = p;
        const x = v.sx(p[0]), y = v.sy(p[1]);
        if (x < -120 || y < -120 || x > v.sw + 120 || y > v.sh + 120) continue;
        if (s < 7 && sh.kind !== 2) continue;   // far out, only the big ships are worth a mark
        drawShip(g, x, y, p[2] + (sh.dir < 0 ? Math.PI : 0), sh.kind === 2 ? s * 1.2 : s, t, sh.seed, sh.kind || 0);
      }
      busy = ships.length > 0;
    } else for (const sh of ships) sh.at = null;
    if (drawSmoke(g, t, v)) busy = true;
    if (drawBirds(g, t, v, dt)) busy = true;
    if (drawLights(t, v)) busy = true;
    return busy || force;
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (zooming || t - (loop.last || 0) < 41) return;
    loop.last = t;
    draw(t);
  }
  raf = requestAnimationFrame(loop);
  map.on('move', () => { if (!zooming) draw(performance.now()); });

  // ───────── the seasons ─────────
  // A coarse picture of the land laid over the map: snow (white, on top) and the season's cast (multiplied).
  const tintPane = mkPane('seasonTint', 330, 'multiply'), snowPane = mkPane('seasonSnow', 340);
  let tintLayer = null, snowLayer = null, seasonSig = '';
  function seasonNow() {
    const c = sky.cal; if (!c || !window.WorldCalendar) return null;
    const Cal = window.WorldCalendar, d = Cal.date(c, sky.t), YD = Cal.yearDays(c);
    const ph = (((d.doy - c.sun.summer) / YD) % 1 + 1) % 1;   // 0 midsummer, 0.25 autumn, 0.5 midwinter, 0.75 spring
    const g = (c0, w) => { let x = Math.abs(ph - c0); x = Math.min(x, 1 - x); return Math.exp(-(x * x) / (2 * w * w)); };
    return { ph, winter: Math.pow(Math.max(0, -Math.cos(ph * Math.PI * 2)), 0.8), late: g(0.1, 0.07), autumn: g(0.22, 0.06), spring: g(0.72, 0.07) };
  }
  // value noise over the map, for ragged snowlines
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const r = (a, b) => hash(a * 57.31 + b * 113.7);
    return (r(xi, yi) * (1 - u) + r(xi + 1, yi) * u) * (1 - w) + (r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u) * w;
  };
  function drawSeason() {
    const L0 = life(), S = L0.seasons === false ? null : seasonNow();
    const clim = ctx.climateAt ? ctx.climateAt() : null;
    const sig = S && Land.ready ? [Math.round(S.ph * 72), L0.cold, !!clim, ctx.climateSig ? ctx.climateSig() : ''].join('|') : '';
    if (sig === seasonSig) return; seasonSig = sig;
    if (tintLayer) { tintLayer.remove(); tintLayer = null; } if (snowLayer) { snowLayer.remove(); snowLayer = null; }
    if (!S) return;
    // one cell per 4 cells of the land mask (about 32 map px)
    const f = Math.max(1, Math.round(Land.w / 900)), cw = Math.ceil(Land.w / f), ch = Math.ceil(Land.h / f), cell = f * Land.scale;
    const tc = document.createElement('canvas'), sc = document.createElement('canvas'); tc.width = sc.width = cw; tc.height = sc.height = ch;
    const ti = tc.getContext('2d').createImageData(cw, ch), si = sc.getContext('2d').createImageData(cw, ch);
    let anySnow = false, anyTint = false;
    const lat = L0.cold;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const lx = Math.min(Land.w - 1, x * f + (f >> 1)), ly = Math.min(Land.h - 1, y * f + (f >> 1));
      if (Land.v[ly * Land.w + lx] < 128) continue;
      const mx = (x + 0.5) * cell, my = (y + 0.5) * cell, i = (y * cw + x) * 4;
      // how cold it is here: the nation's climate (Borders › Climate), and the far north or south of the world
      const c = clim ? clim(mx, my) : null;
      const yy = my / H, polar = lat === 'north' ? smooth(0.4, 0.03, yy) : lat === 'south' ? smooth(0.6, 0.97, yy) : lat === 'both' ? Math.max(smooth(0.32, 0.03, yy), smooth(0.68, 0.97, yy)) : 0;
      const cold = Math.max(c ? c.cold * 0.85 : 0, polar * 1.25), dry = c ? clamp(1 - c.wet) : 0;
      const n = vnoise(mx / 1400, my / 1400) * 0.65 + vnoise(mx / 380 + 9, my / 380) * 0.35;
      const s = clamp((cold * 0.9 + S.winter * 1.15 - 1.15 + (n - 0.5) * 0.55) * 2.6) * (0.72 + 0.28 * vnoise(mx / 520, my / 520));
      if (s > 0.01) { si.data[i] = 248; si.data[i + 1] = 250; si.data[i + 2] = 255; si.data[i + 3] = Math.round(s * 200); anySnow = true; }
      // the cast, multiplied: browning plains late in the summer (more where it's dry), russet autumn, cold grey winter, fresh spring
      const warm = 1 - smooth(0.4, 1.2, cold);
      let r = 255, gg = 255, b = 255;
      const mixc = (cr, cg, cb, a) => { r -= (255 - cr) * a; gg -= (255 - cg) * a; b -= (255 - cb) * a; };
      mixc(214, 186, 128, S.late * warm * (0.38 + 0.4 * dry) * (0.7 + 0.6 * n));
      mixc(226, 170, 128, S.autumn * warm * 0.36 * (0.6 + 0.8 * n));
      mixc(210, 218, 232, S.winter * (1 - s) * 0.32);
      mixc(222, 240, 206, S.spring * warm * 0.22);
      if (r < 252 || gg < 252 || b < 252) { ti.data[i] = r; ti.data[i + 1] = gg; ti.data[i + 2] = b; ti.data[i + 3] = 255; anyTint = true; }
      else { ti.data[i] = ti.data[i + 1] = ti.data[i + 2] = ti.data[i + 3] = 255; }
    }
    const bounds = L.latLngBounds(toLatLng(0, ch * cell), toLatLng(cw * cell, 0));
    if (anyTint) {
      // where there's no cast, white (multiplying by white changes nothing)
      for (let i = 0; i < ti.data.length; i += 4) if (!ti.data[i + 3]) { ti.data[i] = ti.data[i + 1] = ti.data[i + 2] = ti.data[i + 3] = 255; }
      tc.getContext('2d').putImageData(ti, 0, 0);
      tintLayer = L.imageOverlay(tc.toDataURL(), bounds, { pane: 'seasonTint', interactive: false, className: 'seasonimg' }).addTo(map);
    }
    if (anySnow) { sc.getContext('2d').putImageData(si, 0, 0); snowLayer = L.imageOverlay(sc.toDataURL(), bounds, { pane: 'seasonSnow', interactive: false, className: 'seasonimg snow' }).addTo(map); }
  }

  // ───────── the framing: vignette, compass rose, scale bar ─────────
  const cont = map.getContainer();
  const vign = L.DomUtil.create('div', 'ambvignette', cont);
  const Compass = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const el = L.DomUtil.create('button', 'ambcompass');
      el.title = 'North. Click to see the whole world';
      el.innerHTML = `<svg viewBox="-50 -50 100 100" aria-hidden="true">
        <circle r="34" class="r1"/><circle r="29" class="r2"/>
        <g class="ticks">${Array.from({ length: 32 }, (_, i) => { const a = i / 32 * Math.PI * 2, r0 = i % 4 ? 31 : 27; return `<line x1="${(Math.sin(a) * r0).toFixed(1)}" y1="${(-Math.cos(a) * r0).toFixed(1)}" x2="${(Math.sin(a) * 34).toFixed(1)}" y2="${(-Math.cos(a) * 34).toFixed(1)}"/>`; }).join('')}</g>
        <g class="minor" transform="rotate(45)"><path d="M0-24L4 0 0 24-4 0z"/><path d="M-24 0L0-4 24 0 0 4z"/></g>
        <g class="major"><path class="lt" d="M0-44L6 0H-6z"/><path class="dk" d="M0-44L0 0H-6z"/><path class="lt" d="M0 44L-6 0H6z"/><path class="dk" d="M0 44L0 0H6z"/>
        <path class="lt" d="M44 0L0 6V-6z"/><path class="dk" d="M44 0L0 0V-6z"/><path class="lt" d="M-44 0L0-6V6z"/><path class="dk" d="M-44 0L0 0V6z"/></g>
        <circle r="3.2" class="hub"/><text y="-36.5" class="n">N</text></svg>`;
      L.DomEvent.disableClickPropagation(el);
      el.addEventListener('click', () => ctx.showAll());
      return el;
    }
  });
  const Scale = L.Control.extend({ options: { position: 'bottomleft' }, onAdd() { this.el = L.DomUtil.create('div', 'ambscale'); return this.el; } });
  const compass = new Compass(), scale = new Scale();
  let framed = false;
  function drawScale() {
    if (!framed) return;
    const mpp = ctx.milesPerPx(), el = scale.el;
    if (!mpp || !el) { if (el) el.hidden = true; return; }
    const u = ctx.unit(), k = Math.pow(2, NATIVE - map.getZoom());
    const perScreenPx = mpp * k * u[0];                 // units per screen pixel
    const target = perScreenPx * 130;
    const p = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 2.5, 5, 10].map(m => m * p).filter(m => m <= target).pop() || p;
    const px = nice / perScreenPx, parts = 4;
    const fmt = n => n >= 10 ? Math.round(n).toLocaleString('en-GB') : +n.toFixed(2);
    el.hidden = false;
    el.innerHTML = `<div class="bar" style="width:${px.toFixed(1)}px">${Array.from({ length: parts }, (_, i) => `<i class="${i % 2 ? 'w' : 'b'}"></i>`).join('')}</div>`
      + `<div class="nums" style="width:${px.toFixed(1)}px"><span>0</span><span>${fmt(nice / 2)}</span><span>${fmt(nice)} ${u[2]}</span></div>`;
  }
  function applyFrame() {
    const on = life().frame !== false;
    vign.hidden = !on;
    if (on && !framed) { scale.addTo(map); compass.addTo(map); framed = true; }   // (stacked upwards: the compass over the scale)
    if (!on && framed) { compass.remove(); scale.remove(); framed = false; }
    drawScale();
  }
  map.on('zoomend', drawScale);

  // ───────── the party's journeys (from the table) ─────────
  const jPane = mkPane('journeys', 590);
  const jLayer = L.layerGroup().addTo(map);
  let journeys = [];
  function drawJourneys() {
    jLayer.clearLayers();
    const close = map.getZoom() >= 4;
    for (const j of journeys) {
      const pts = (j.pts || []).filter(p => isFinite(p.x) && isFinite(p.y));
      if (pts.length < 1) continue;
      const lls = pts.map(p => toLatLng(p.x, p.y)), col = j.color || '#9e2b25';
      if (lls.length > 1) {
        L.polyline(lls, { pane: 'journeys', color: '#f4ecd8', weight: 7, opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(jLayer);
        L.polyline(lls, { pane: 'journeys', color: col, weight: 4, opacity: 0.95, dashArray: '0.1 11', lineCap: 'round', lineJoin: 'round', className: 'jtrail' + (j.live ? ' live' : '') })
          .bindTooltip(j.name || 'The journey', { sticky: true, className: 'jtip' }).addTo(jLayer);
      }
      pts.forEach((p, i) => {
        const end = i === pts.length - 1, start = i === 0;
        if (!p.label && !start && !end) return;
        const m = L.circleMarker(lls[i], { pane: 'journeys', radius: start || end ? 6 : 4.5, color: '#2a1a12', weight: 1.5, fillColor: end ? col : '#f4ecd8', fillOpacity: 1 }).addTo(jLayer);
        const txt = [start ? (j.name || 'The journey') : '', p.label || '', p.note || ''].filter(Boolean).join(' · ');
        if (txt) m.bindTooltip(txt, { permanent: close && (start || end || !!p.label), direction: 'right', offset: [8, 0], className: 'jdate' + (end ? ' end' : '') });
      });
    }
  }
  map.on('zoomend', () => { if (journeys.length) drawJourneys(); });

  // ───────── chimney smoke, close in ─────────
  // Wisps rising from the towns and drifting downwind; thicker in winter and on still days, none in a storm.
  function drawSmoke(g, t, v) {
    if (life().smoke === false || v.z < 4.8 || /storm|blizzard/.test(sky.kind)) return false;
    collectLights();
    const wind = sky.wind == null ? 0.3 : sky.wind, dir = (sky.dir || 60) * Math.PI / 180, wdx = Math.cos(dir), wdy = Math.sin(dir);
    const S = seasonNow(), winter = S ? S.winter : 0, sc = clamp(Math.pow(2, v.z - 6), 0.4, 2.5), vis = smooth(4.8, 5.4, v.z);
    const night = sky.dark;
    let any = false;
    for (const L0 of lights) {
      if (L0.w < 0.5 || hash(L0.seed * 1.7) > (L0.w >= 0.75 ? 0.7 : 0.3 + 0.25 * winter)) continue;   // towns and up, and not all of them
      const x0 = v.sx(L0.x), y0 = v.sy(L0.y);
      if (x0 < -80 || y0 < -120 || x0 > v.sw + 80 || y0 > v.sh + 40) continue;
      const n = L0.w >= 0.75 ? 2 : 1;
      for (let c = 0; c < n; c++) {
        const cx = x0 + (hash(L0.seed + c * 3.3) - 0.5) * 22 * sc, cy = y0 - 6 * sc + (hash(L0.seed + c * 7.1) - 0.5) * 10 * sc;
        for (let k = 0; k < 7; k++) {
          const life0 = ((t / 1000) * 0.22 + k / 7 + hash(L0.seed + c)) % 1;   // 0 just out of the chimney, 1 gone
          const rise = life0 * 40 * sc, drift = life0 * life0 * (12 + wind * 60) * sc;
          const px = cx + wdx * drift + Math.sin(t * 0.0013 + k + c) * 2 * sc, py = cy - rise * (1 - wind * 0.5) + wdy * drift * 0.5;
          const r = (2 + life0 * 9) * sc, a = vis * (0.22 + 0.25 * winter) * Math.sin(Math.PI * Math.min(1, life0 * 1.2)) * (1 - life0);
          if (a < 0.01) continue;
          g.globalAlpha = a; g.fillStyle = night > 0.5 ? '#6d7280' : '#b9b6ae';
          g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); any = true;
        }
      }
    }
    g.globalAlpha = 1;
    return any;
  }

  // ───────── a nation's name as you arrive ─────────
  // Come down into a nation (close enough to see its towns) and its name rises over the map for a few seconds.
  const card = L.DomUtil.create('div', 'ambtitle', cont); card.hidden = true;
  let lastNation = null, cardTimer = 0, seenAt = new Map(), titleTimer = 0;
  function showTitle(n) {
    clearTimeout(cardTimer);
    card.replaceChildren();
    const small = document.createElement('span'); small.className = 'pre'; small.textContent = 'Entering';
    const big = document.createElement('b'); big.textContent = n.name;
    const rule = document.createElement('i');
    const arms = ctx.arms ? ctx.arms(n) : '';
    if (arms) { const a = document.createElement('div'); a.className = 'tarms'; a.innerHTML = arms; card.append(a); }
    card.append(small, big, rule);
    if (n.motto) { const m = document.createElement('em'); m.textContent = n.motto; card.append(m); }
    card.style.setProperty('--nc', n.color || '#9e2b25');
    card.hidden = false; card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
    cardTimer = setTimeout(() => { card.classList.remove('on'); cardTimer = setTimeout(() => { card.hidden = true; }, 900); }, 3600);
  }
  function checkTitle() {
    if (life().titles === false || !ctx.nationAt || !ctx.isMapView() || map.getZoom() < 3.6 || /\b(tale-on|drift-on|wayfind)\b/.test(document.body.className)) { if (map.getZoom() < 3) lastNation = null; return; }
    const c = toPixel(map.getCenter()), n = ctx.nationAt(c.x, c.y);
    if (!n || !n.name || n === lastNation) { if (!n) lastNation = null; return; }
    lastNation = n;
    const now = Date.now(); if (now - (seenAt.get(n.name) || 0) < 90000) return;   // not again for a minute and a half
    seenAt.set(n.name, now);
    showTitle(n);
  }
  map.on('moveend', () => { clearTimeout(titleTimer); titleTimer = setTimeout(checkTitle, 450); });

  // ───────── sound (off until switched on: the hotbar's speaker) ─────────
  // All made on the spot, nothing to download: rain (hiss and patter), wind (gusting), surf (breaking on a slow
  // swell, louder near a coast and close in), birds on a fine day by the shore, and thunder after the flash,
  // later and lower the further off the strike.
  const SOUND_KEY = 'valanar-sound-vol';
  let au = null, vol = (() => { try { const v = parseFloat(localStorage.getItem(SOUND_KEY)); return isFinite(v) ? clamp(v) : 0; } catch (e) { return 0; } })();
  let soundOn = vol > 0;
  function noiseBuffer(ac, secs) {
    const b = ac.createBuffer(1, ac.sampleRate * secs, ac.sampleRate), d = b.getChannelData(0);
    let br = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; d[i] = w * 0.6 + br * 3; }
    return b;
  }
  function startSound() {
    if (au) { au.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = new AC(), master = ac.createGain(); master.gain.value = 0.0; master.connect(ac.destination);
    const nb = noiseBuffer(ac, 4);
    const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
    const src = () => { const s0 = ac.createBufferSource(); s0.buffer = nb; s0.loop = true; s0.loopStart = Math.random(); s0.start(0, Math.random() * 3); return s0; };
    const filt = (type, f, q) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; };
    const gain = v => { const x = ac.createGain(); x.gain.value = v; return x; };
    const rain = gain(0), wind = gain(0), surf = gain(0), wfil = filt('bandpass', 500, 0.7);
    chain(src(), filt('highpass', 700), filt('lowpass', 7500), rain, master);
    chain(src(), filt('bandpass', 3200, 1.4), gain(0.5), rain);   // patter
    chain(src(), wfil, wind, master);
    chain(src(), filt('lowpass', 420), surf, master);
    chain(src(), filt('bandpass', 1100, 0.6), gain(0.25), surf);   // the hiss of the breaking wave
    au = { ac, master, rain, wind, surf, wfil, nb };
    master.gain.setTargetAtTime(0.9 * vol * vol, ac.currentTime, 1.5);
  }
  function stopSound() { if (au) au.master.gain.setTargetAtTime(0, au.ac.currentTime, 0.4); setTimeout(() => { if (!soundOn && au) au.ac.suspend(); }, 1500); }
  // how much sea is in view, and how close in
  function seaShare(v) {
    let sea = 0, n = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { n++; if (!isLand(v.ox + (i + 0.5) / 6 * v.sw * v.k, v.oy + (j + 0.5) / 4 * v.sh * v.k)) sea++; }
    return sea / n;
  }
  // not to be heard: the tab hidden, another page of the site, or (in the table) the world map's frame put away
  // while the table shows another scene
  function offStage() {
    if (document.hidden || !ctx.isMapView()) return true;
    try { if (window.frameElement && (window.frameElement.hidden || !window.frameElement.offsetParent)) return true; } catch (e) { /* not ours */ }
    return !innerWidth || !innerHeight;
  }
  function soundTick() {
    if (!au || !soundOn) return;
    const v = frameView(), T = au.ac.currentTime, hidden = offStage();
    const c = toPixel(map.getCenter()), w = ctx.weatherAt ? ctx.weatherAt(c.x, c.y) : null;
    const close = smooth(2, 5.5, v.z), p = w ? w.precip : 0, snowy = w && w.snow;
    const sea = seaShare(v), coast = sea > 0.05 && sea < 0.95 ? 1 : sea >= 0.95 ? 0.6 : 0;
    const windy = (sky.wind == null ? 0.3 : sky.wind);
    const k = hidden ? 0 : 1;
    au.rain.gain.setTargetAtTime(k * (snowy ? 0 : p) * (0.25 + 0.6 * close), T, 0.8);
    au.wind.gain.setTargetAtTime(k * (0.05 + windy * 0.35 + (snowy ? p * 0.35 : 0) + (1 - close) * 0.12) * (0.8 + 0.4 * Math.sin(T * 0.21) * Math.sin(T * 0.53)), T, 0.6);
    au.wfil.frequency.setTargetAtTime(380 + 420 * (0.5 + 0.5 * Math.sin(T * 0.17)) + windy * 300, T, 0.8);
    const swell = Math.pow(0.5 + 0.5 * Math.sin(T * (2 * Math.PI / 7.5)), 2.2);
    au.surf.gain.setTargetAtTime(k * coast * (0.12 + 0.55 * close) * (0.35 + 0.65 * swell), T, 0.35);
    // a gull or a songbird now and then, on a fine day, close in
    if (k && close > 0.6 && p < 0.05 && sky.dark < 0.5 && Math.random() < 0.06) chirp(coast > 0 ? 'gull' : 'song');
  }
  setInterval(soundTick, 250);
  function chirp(kind) {
    const ac = au.ac, T = ac.currentTime, o = ac.createOscillator(), gn = ac.createGain();
    o.connect(gn); gn.connect(au.master);
    if (kind === 'gull') {
      o.type = 'sawtooth'; const f = 900 + Math.random() * 300;
      const lp = ac.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1400; lp.Q.value = 2; o.disconnect(); o.connect(lp); lp.connect(gn);
      o.frequency.setValueAtTime(f, T); o.frequency.linearRampToValueAtTime(f * 1.5, T + 0.12); o.frequency.linearRampToValueAtTime(f * 0.8, T + 0.45);
      gn.gain.setValueAtTime(0, T); gn.gain.linearRampToValueAtTime(0.05, T + 0.05); gn.gain.exponentialRampToValueAtTime(0.001, T + 0.5);
      o.start(T); o.stop(T + 0.55);
    } else {
      o.type = 'sine'; let t0 = T; const n = 2 + Math.floor(Math.random() * 4), f = 2600 + Math.random() * 1600;
      gn.gain.setValueAtTime(0, T);
      for (let i = 0; i < n; i++) { o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.4), t0 + 0.07); gn.gain.setValueAtTime(0.03, t0); gn.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.09); t0 += 0.12 + Math.random() * 0.06; }
      o.start(T); o.stop(t0 + 0.1);
    }
  }
  // Thunder: a deep roll rather than a hiss. Brown noise (all low end), lowpassed hard, in a few overlapping swells
  // spread over seconds, through a long dark reverb — with a sub-bass boom under a near strike and, very close, a
  // short broad clap at the front (lowpassed too, so it cracks rather than zaps). Further off: later, softer, lower.
  function thunderKit() {
    if (au.tk) return au.tk;
    const ac = au.ac, sr = ac.sampleRate;
    const brown = ac.createBuffer(1, sr * 8, sr), d = brown.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const ir = ac.createBuffer(2, sr * 3.5, sr);   // a big, soft room: the sky
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); let b = 0; for (let i = 0; i < x.length; i++) { b = b * 0.7 + (Math.random() * 2 - 1) * 0.3; x[i] = b * Math.pow(1 - i / x.length, 2.6); } }
    const verb = ac.createConvolver(); verb.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = 0.55; verb.connect(wet); wet.connect(au.master);
    return (au.tk = { brown, verb });
  }
  function thunder(s) {
    if (!au || !soundOn || offStage()) return;
    const ac = au.ac, tk = thunderKit(), near = clamp(1 - s.dist * 1.6);
    const T = ac.currentTime + 0.35 + (1 - near) * 3.2, loud = 0.5 + near * 0.4;
    const out = ac.createGain(); out.gain.value = loud; out.connect(au.master); out.connect(tk.verb);
    const lp2 = ac.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 170 + near * 330; lp2.Q.value = 0.5; lp2.connect(out);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + near * 420; lp.connect(lp2);
    // the roll: three to five swells, each fading into the next
    const n = 3 + Math.floor(Math.random() * 3); let t0 = T, end = T;
    for (let i = 0; i < n; i++) {
      const b = ac.createBufferSource(); b.buffer = tk.brown;
      const g = ac.createGain(), peak = (i === 0 ? 1 : 0.35 + Math.random() * 0.55) * (i === 0 ? 1 : 0.85);
      const rise = i === 0 ? 0.04 + (1 - near) * 0.5 : 0.15 + Math.random() * 0.3, fall = 0.6 + Math.random() * 1.1 + (1 - near) * 0.6;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + rise); g.gain.setTargetAtTime(0.0001, t0 + rise, fall / 3);
      b.connect(g); g.connect(lp); b.start(t0, Math.random() * 6); b.stop(t0 + rise + fall * 2.5);
      end = Math.max(end, t0 + rise + fall * 2.5);
      t0 += 0.35 + Math.random() * 0.9;
    }
    // a near strike: the ground shakes — a falling sub boom — and the clap in front
    if (near > 0.35) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(70, T); o.frequency.exponentialRampToValueAtTime(32, T + 1.2);
      g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.5 * near, T + 0.03); g.gain.setTargetAtTime(0.0001, T + 0.05, 0.45);
      o.connect(g); g.connect(out); o.start(T); o.stop(T + 2.5);
    }
    if (near > 0.65) {
      const b = ac.createBufferSource(); b.buffer = au.nb;
      const bp = ac.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 1400;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, T - 0.02); g.gain.exponentialRampToValueAtTime(0.45 * near, T); g.gain.setTargetAtTime(0.0001, T, 0.09);
      b.connect(bp); bp.connect(g); g.connect(au.master); g.connect(tk.verb); b.start(T - 0.02, Math.random() * 2); b.stop(T + 0.6);
    }
    setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } }, (end - ac.currentTime + 4) * 1000);
  }
  const sbtn = document.getElementById('soundToggle');
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  // the hotbar's speaker opens a little volume slider beside it (all the way down is off)
  const pop = L.DomUtil.create('div', 'ambvol', document.body); pop.hidden = true;
  const rng = document.createElement('input'); rng.type = 'range'; rng.min = 0; rng.max = 100; rng.step = 1; rng.value = Math.round(vol * 100);
  rng.setAttribute('aria-label', 'Sound volume');
  const out = document.createElement('span');
  const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = 'Ambience';
  pop.append(lab, rng, out);
  function drawSoundBtn() {
    out.textContent = vol > 0 ? Math.round(vol * 100) + '%' : 'Off';
    if (!sbtn) return; sbtn.innerHTML = vol > 0 ? ICON_ON : ICON_OFF; sbtn.classList.toggle('on', !pop.hidden);
    sbtn.title = `Sound: rain, wind, the sea and thunder (${vol > 0 ? Math.round(vol * 100) + '%' : 'off'})`;
  }
  function setVol(v, save) {
    vol = clamp(v); soundOn = vol > 0;
    if (save) try { localStorage.setItem(SOUND_KEY, String(vol)); } catch (e) { /* private */ }
    if (soundOn) { startSound(); au && au.master.gain.setTargetAtTime(0.9 * vol * vol, au.ac.currentTime, 0.15); } else stopSound();
    drawSoundBtn();
  }
  rng.addEventListener('input', () => setVol(rng.value / 100, false));
  rng.addEventListener('change', () => setVol(rng.value / 100, true));
  const openPop = on => {
    pop.hidden = !on;
    if (on && sbtn) { const r = sbtn.getBoundingClientRect(); pop.style.left = (r.right + 8) + 'px'; pop.style.top = (r.top + r.height / 2) + 'px'; }
    drawSoundBtn();
  };
  if (sbtn) {
    sbtn.hidden = false;
    sbtn.addEventListener('click', e => { e.stopPropagation(); openPop(pop.hidden); });
    document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== sbtn && !sbtn.contains(e.target)) openPop(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) openPop(false); });
    drawSoundBtn();
  }
  // a browser lets sound start only after a click: if it was on last time, the first click on the page starts it
  if (soundOn) { const go = () => { startSound(); document.removeEventListener('pointerdown', go, true); }; document.addEventListener('pointerdown', go, true); }

  // ───────── changes ─────────
  function refresh() { applyFrame(); setupLanes(); drawSeason(); draw(performance.now(), true); }
  refresh();
  return {
    sky(s) { sky = Object.assign({}, sky, s); drawSeason(); draw(performance.now(), true); },
    refresh,
    thunder,
    debug: () => ({ sprites: SHIPS, shipAt: ships.map(x => x.lane.pts[Math.floor(x.lane.pts.length / 2)]), lanes: lanes.length, ships: ships.length, flocks: flocks.length, lights: lights.length, sky }),
    landReady() { lanesFor = ''; seasonSig = ''; refresh(); },
    // the sound's volume (0 to 1; 0 is off), for the table's own slider when the world map is a scene
    get volume() { return vol; },
    setVolume(v, save) { rng.value = Math.round(clamp(v) * 100); setVol(v, save !== false); },
    setJourneys(list) { journeys = Array.isArray(list) ? list : []; drawJourneys(); },
    focusJourney(id) {
      const j = journeys.find(x => x.id === id); if (!j || !j.pts || !j.pts.length) return;
      map.fitBounds(L.latLngBounds(j.pts.map(p => toLatLng(p.x, p.y))).pad(0.2), { maxZoom: NATIVE - 1.5 });
    }
  };
};
