/* Weather drawn over a map: clouds and their shadows, fog, rain, snow, and lightning in a storm.
 * Used by the world map (app/sky.js) and the table's battle maps (table/js/clock.js).
 *
 *   const fx = new WeatherFX(canvas);
 *   fx.set({ weather: { kind, wind, dir }, light: 0..1 (daylight), cloudScale: world units per cloud pattern,
 *            clouds: 0..1 (how much of the clouds themselves to draw; their shadows always show),
 *            regional: true (the world map: the weather comes in banks and cells that drift with the wind, so it's
 *                      raining hard in one place and dry a little way off),
 *            climateAt: (x, y) → { wet, cold } (the world map: each nation's climate, Map › Borders › Climate),
 *            kindAt: (x, y) → kind or null (the world map: weather the GM painted there; elsewhere weather.kind),
 *            climate: { wet, cold } (a battle map: the scene's climate) });
 *   fx.draw(seconds, view)   view: { ox, oy, k }  the world point at the canvas's top left and world units per CSS px
 * Clouds and fog belong to the world (they stay put as you pan, drifting with the wind); rain and snow fall in
 * front of the viewer, but only where it's raining or snowing. wet scales the rain (0 desert … 1.7 rainy); cold 1
 * turns rain to snow, cold 2 (frozen) snows from any thick cloud. */
(function (root) {
  'use strict';
  // how each kind of weather looks: cloud cover, how dark the clouds are, fog, rain, snow (0..1)
  const KINDS = {
    clear: { cover: 0.08, dark: 0, fog: 0, rain: 0, snow: 0 },
    cloudy: { cover: 0.42, dark: 0.05, fog: 0, rain: 0, snow: 0 },
    overcast: { cover: 0.78, dark: 0.25, fog: 0, rain: 0, snow: 0 },
    fog: { cover: 0.3, dark: 0.1, fog: 0.75, rain: 0, snow: 0 },
    rain: { cover: 0.72, dark: 0.35, fog: 0.1, rain: 0.55, snow: 0 },
    storm: { cover: 0.9, dark: 0.6, fog: 0.15, rain: 1, snow: 0, lightning: true },
    snow: { cover: 0.7, dark: 0.15, fog: 0.15, rain: 0, snow: 0.55 },
    blizzard: { cover: 0.92, dark: 0.3, fog: 0.45, rain: 0, snow: 1 }
  };

  // a tileable fractal-noise picture (wraps at the edges), made once
  let NOISE = null;
  function noise() {
    if (NOISE) return NOISE;
    const N = 256, out = new Float32Array(N * N);
    const hashGrid = (g, seed) => { const a = new Float32Array(g * g); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; } return a; };
    let amp = 0.5, total = 0;
    for (let oct = 0, g = 4; oct < 5; oct++, g *= 2, amp *= 0.5) {
      const grid = hashGrid(g, 1234 + oct * 97), cell = N / g;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const at = (i, j) => grid[((j % g + g) % g) * g + ((i % g + g) % g)];
        const n = (at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v;
        out[y * N + x] += n * amp;
      }
      total += amp;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    NOISE = { N, v: out };
    return NOISE;
  }
  // the cloud picture for a given cover, in one colour; alpha from the noise
  function cloudTile(cover, soft, rgb, phase) {
    const { N, v } = noise();
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    const thr = 1 - cover;   // noise above this is cloud
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      // a second look at the noise, shifted, so the shapes change slowly over time
      const i = y * N + x, j = ((y + 97) % N) * N + ((x + 41) % N);
      const n = v[i] * (1 - phase) + v[j] * phase;
      const a = Math.max(0, Math.min(1, (n - thr + soft * 0.5) / soft));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function WeatherFX(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.o = { weather: { kind: 'clear', wind: 0.3, dir: 60 }, light: 1, cloudScale: 6000, clouds: 1 };
    this.drops = []; this.flash = 0; this.nextBolt = 0; this.tiles = {}; this.last = 0;
  }
  WeatherFX.KINDS = KINDS;
  // climates a nation (or a scene) can have
  WeatherFX.CLIMATES = {
    temperate: { label: 'Temperate', wet: 1, cold: 0 },
    wet: { label: 'Rainy', wet: 1.7, cold: 0 },
    dry: { label: 'Dry', wet: 0.4, cold: 0 },
    desert: { label: 'Desert', wet: 0.08, cold: 0 },
    cold: { label: 'Cold (rain falls as snow)', wet: 1, cold: 1 },
    frozen: { label: 'Frozen (snow from any thick cloud)', wet: 0.9, cold: 2 }
  };
  // the noise at a point (x, y in tiles; it repeats every tile), smoothly
  function sample(x, y) {
    const { N, v } = noise();
    x = (x % 1 + 1) % 1 * N; y = (y % 1 + 1) % 1 * N;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
    return (v[y0 * N + x0] * (1 - fx) + v[y0 * N + x1] * fx) * (1 - fy) + (v[y1 * N + x0] * (1 - fx) + v[y1 * N + x1] * fx) * fy;
  }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  WeatherFX.prototype.set = function (o) { Object.assign(this.o, o || {}); };
  WeatherFX.prototype.active = function () {
    if (this.o.kindAt) return true;   // painted weather: somewhere there may be some
    const K = KINDS[this.o.weather.kind] || KINDS.clear;
    return K.cover > 0.05 || K.fog || K.rain || K.snow;
  };
  WeatherFX.prototype._tile = function (key, cover, soft, rgb, phase) {
    const q = Math.round(phase * 8) / 8;   // the shapes change in eight steps, blended
    const k = key + cover.toFixed(2) + q + rgb.join(',');
    if (!this.tiles[k]) { if (Object.keys(this.tiles).length > 24) this.tiles = {}; this.tiles[k] = cloudTile(cover, soft, rgb, q); }
    return this.tiles[k];
  };
  WeatherFX.prototype.resize = function () {
    const c = this.c, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.dpr = dpr;
  };
  WeatherFX.prototype.draw = function (t, view) {
    this.resize();
    const g = this.g, c = this.c, W = c.width, H = c.height, dpr = this.dpr;
    const o = this.o, K = KINDS[o.weather.kind] || KINDS.clear, wind = o.weather.wind, dir = (o.weather.dir || 0) * Math.PI / 180;
    const dt = Math.min(0.1, this.last ? t - this.last : 0.016); this.last = t;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    const light = o.light == null ? 1 : o.light;
    const k = view.k;   // world units per CSS px
    // the clouds drift with the wind: world units per second
    const drift = (40 + wind * 260) * (o.cloudScale / 6000);
    const wx = Math.cos(dir) * drift * t, wy = Math.sin(dir) * drift * t;
    const phase = (t / 240) % 1;
    // ── the weather where you're looking: a coarse grid over the view of how cloudy it is, how hard it's raining or
    // snowing, and whether it's snow. On the world map it comes in cells and banks drifting with the wind, and each
    // place has its climate; on a battle map it's the same all over.
    // Each spot of the grid: cloud cover, how hard it's falling, snow or rain, fog, how dark the clouds are, lightning.
    // With kindAt (weather painted on the world map) each spot has its own kind, the edges ragged by the noise.
    const GX = 40, GY = Math.max(8, Math.round(GX * H / W)), Wc = W / dpr, Hc = H / dpr, NC = 6;
    const pre = o.precip == null ? 1 : o.precip;
    const cell = o.cloudScale * 1.7, regional = !!o.regional;
    const G = this.grid && this.grid.length === GX * GY * NC ? this.grid : (this.grid = new Float32Array(GX * GY * NC));
    let maxP = 0, anyCloud = 0, maxFog = 0, darkSum = 0, darkW = 0, bolt = false;
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const x = view.ox + (gx + 0.5) / GX * Wc * k, y = view.oy + (gy + 0.5) / GY * Hc * k;
      const cl = (o.climateAt && o.climateAt(x, y)) || o.climate || null;
      const wet = cl ? cl.wet : 1, cold = cl ? cl.cold : 0;
      // n: the drifting noise; it roughens the clouds and the edges of the weather
      const n = regional ? sample((x - wx) / cell, (y - wy) / cell) * 0.7 + sample((x - wx) / (cell * 3.1) + 0.37, (y - wy) / (cell * 3.1) + 0.71) * 0.3 : 0.55;
      let Kc = K, painted = false;
      if (o.kindAt) {
        const j = cell * 0.5, kk = o.kindAt(x + (sample(x / cell + 0.13, y / cell) - 0.5) * j, y + (sample(x / cell, y / cell + 0.57) - 0.5) * j);
        if (kk && KINDS[kk]) { Kc = KINDS[kk]; painted = true; }
      }
      const P = Math.max(Kc.rain, Kc.snow) * pre;
      // the cloud gently patchy (not on and off), the rain or snow steady wherever that weather is
      let cover = regional ? Math.max(0, Math.min(1, Kc.cover + (n - 0.5) * (painted ? 0.5 : 0.7))) : Kc.cover;
      if (wet < 0.5 && !painted) cover *= 0.4 + wet;   // dry lands have fewer clouds
      let p = P > 0 ? P * (painted ? 1 : Math.min(1.3, regional ? Math.max(0.35, wet) : wet)) * (regional ? 0.75 + (n - 0.5) * 0.6 : 1) : 0;
      if (cold >= 2 && p < 0.3 && cover > 0.55) p = Math.max(p, 0.3 * smooth(0.55, 0.85, cover));   // frozen lands snow from thick cloud
      const snow = Kc.snow > 0 || cold >= 1 ? 1 : 0;
      const i = (gy * GX + gx) * NC;
      G[i] = cover; G[i + 1] = Math.min(1.2, p); G[i + 2] = snow; G[i + 3] = Kc.fog; G[i + 4] = Kc.dark; G[i + 5] = Kc.lightning ? 1 : 0;
      if (G[i + 1] > maxP) maxP = G[i + 1];
      if (cover > anyCloud) anyCloud = cover;
      if (Kc.fog > maxFog) maxFog = Kc.fog;
      darkSum += Kc.dark * cover; darkW += cover;
      if (Kc.lightning && p > 0.3) bolt = true;
    }
    const dark = darkW > 0 ? darkSum / darkW : K.dark;
    // the grid as a picture of where the clouds are (alpha), drawn smoothly over the view to cut the clouds out
    const dens = this.dens || (this.dens = document.createElement('canvas'));
    if (dens.width !== GX || dens.height !== GY) { dens.width = GX; dens.height = GY; }
    const dg = dens.getContext('2d'), di = dg.createImageData(GX, GY);
    for (let j = 0; j < GX * GY; j++) { di.data[j * 4] = di.data[j * 4 + 1] = di.data[j * 4 + 2] = 255; di.data[j * 4 + 3] = regional ? Math.round(smooth(0.05, 0.6, G[j * NC]) * 255) : 255; }
    dg.putImageData(di, 0, 0);
    // and of where the fog is
    const fogm = this.fogm || (this.fogm = document.createElement('canvas'));
    if (fogm.width !== GX || fogm.height !== GY) { fogm.width = GX; fogm.height = GY; }
    if (maxFog > 0) {
      const fg = fogm.getContext('2d'), fi = fg.createImageData(GX, GY);
      for (let j = 0; j < GX * GY; j++) { fi.data[j * 4] = fi.data[j * 4 + 1] = fi.data[j * 4 + 2] = 255; fi.data[j * 4 + 3] = Math.round(G[j * NC + 3] / maxFog * 255); }
      fg.putImageData(fi, 0, 0);
    }
    const buf = this.buf || (this.buf = document.createElement('canvas'));
    if (buf.width !== W || buf.height !== H) { buf.width = W; buf.height = H; }
    const bg = buf.getContext('2d');
    const masked = (fn, alpha, mask) => {   // draw into the buffer, keep only where there's cloud (or fog), lay it on
      bg.setTransform(1, 0, 0, 1, 0, 0); bg.globalCompositeOperation = 'source-over'; bg.globalAlpha = 1; bg.clearRect(0, 0, W, H);
      fn(bg);
      bg.globalCompositeOperation = 'destination-in'; bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high';
      bg.drawImage(mask || dens, 0, 0, W, H);
      bg.globalCompositeOperation = 'source-over';
      g.globalAlpha = alpha; g.drawImage(buf, 0, 0); g.globalAlpha = 1;
    };
    const patternOn = (gg, tile, scale, offX, offY) => {
      const p = gg.createPattern(tile, 'repeat');
      const s = scale / tile.width;
      p.setTransform(new DOMMatrix([s / k * dpr, 0, 0, s / k * dpr, (-view.ox + offX) / k * dpr, (-view.oy + offY) / k * dpr]));
      gg.fillStyle = p; gg.fillRect(0, 0, W, H);
    };
    if (anyCloud > 0.05) {
      const cv = regional ? 0.82 : K.cover;   // on the world map the tile is thick cloud; the grid makes the gaps
      // shadows on the ground, a little offset from the clouds
      const shadow = this._tile('s', cv, 0.35, [8, 12, 22], phase);
      masked(gg => patternOn(gg, shadow, o.cloudScale, wx + o.cloudScale * 0.03, wy + o.cloudScale * 0.05), (0.22 + dark * 0.25) * (0.35 + 0.65 * light));
      if (o.clouds > 0.01) {
        const day = [255, 255, 255], storm = [120, 126, 138];
        const mix = (a, b, f) => a.map((x, i) => Math.round(x * (1 - f) + b[i] * f));
        let rgb = mix(day, storm, dark);
        rgb = mix(rgb, [40, 48, 70], 1 - light);   // at night the clouds are dim
        const cl = this._tile('c', cv * 0.95, 0.5, rgb, phase), cl2 = this._tile('c2', cv * 0.8, 0.45, rgb, (phase + 0.5) % 1);
        masked(gg => {
          gg.globalAlpha = 1; patternOn(gg, cl, o.cloudScale, wx, wy);
          // a second, finer layer moving a little faster
          gg.globalAlpha = 0.5; patternOn(gg, cl2, o.cloudScale * 0.37, wx * 1.4 + 1234, wy * 1.4 + 777); gg.globalAlpha = 1;
        }, o.clouds * (0.55 + K.cover * 0.35));
      }
    }
    if (maxFog > 0) {
      const fogRGB = light > 0.5 ? [228, 232, 236] : [110, 118, 134];
      const fs = o.cloudScale * 0.25;
      const fogDraw = gg => {
        gg.globalAlpha = 0.6; patternOn(gg, this._tile('f', 0.85, 0.9, fogRGB, phase), fs, wx * 0.25, wy * 0.25);
        gg.globalAlpha = 0.45; patternOn(gg, this._tile('f2', 0.7, 0.9, fogRGB, (phase + 0.3) % 1), fs * 0.6, -wx * 0.18 + 500, wy * 0.3 + 300); gg.globalAlpha = 1;
      };
      if (o.kindAt) masked(fogDraw, maxFog, fogm);
      else if (regional) masked(fogDraw, K.fog); else { g.globalAlpha = K.fog; fogDraw(g); g.globalAlpha = 1; }
    }
    // rain and snow: drops in front of the viewer, only where it's falling (heavier where it's heavier)
    const want = Math.round(Math.min(1.2, maxP) * (W * H) / (dpr * dpr) / 1700);
    const drops = this.drops;
    while (drops.length < want) drops.push({ x: Math.random() * W, y: Math.random() * H, z: 0.4 + Math.random() * 0.6, s: Math.random(), r: Math.random() });
    if (drops.length > want) drops.length = want;
    if (drops.length) {
      const at = d => { const gx = Math.min(GX - 1, Math.max(0, Math.floor(d.x / W * GX))), gy = Math.min(GY - 1, Math.max(0, Math.floor(d.y / H * GY))); return (gy * GX + gx) * NC; };
      const rvx = Math.cos(dir) * (60 + wind * 380) * dpr, rvy = 900 * dpr, svx = Math.cos(dir) * (40 + wind * 260) * dpr, svy = 55 * dpr;
      g.lineCap = 'round';
      g.strokeStyle = light > 0.4 ? 'rgba(210,222,240,0.5)' : 'rgba(150,165,190,0.45)';
      g.beginPath();
      const flakes = [];
      for (const d of drops) {
        const i = at(d), here = G[i + 1], snow = G[i + 2] > 0.5;
        const vx = snow ? svx : rvx, vy = snow ? svy : rvy;
        d.x += (vx * d.z + (snow ? Math.sin(t * 1.3 + d.s * 20) * 18 * dpr : 0)) * dt; d.y += vy * d.z * dt * (snow && here > 0.8 ? 2.2 : 1);
        if (d.y > H) { d.y -= H + 20; d.x = Math.random() * W; } if (d.x > W) d.x -= W; if (d.x < 0) d.x += W;
        if (d.r * Math.min(1.2, maxP) > here) continue;   // it isn't falling here (or not this hard)
        if (snow) { flakes.push(d); continue; }
        const len = 0.022 * d.z;
        g.moveTo(d.x, d.y); g.lineTo(d.x - vx * len, d.y - vy * len);
      }
      g.lineWidth = 1.1 * dpr; g.stroke();
      if (flakes.length) {
        g.fillStyle = light > 0.4 ? 'rgba(255,255,255,0.85)' : 'rgba(200,208,225,0.7)';
        g.beginPath();
        for (const d of flakes) { const r = (0.8 + d.z * 1.8) * dpr; g.moveTo(d.x + r, d.y); g.arc(d.x, d.y, r, 0, Math.PI * 2); }
        g.fill();
      }
    }
    this.lastMaxP = maxP;
    // lightning: a flash now and then
    if (bolt && maxP > 0.3) {
      if (t > this.nextBolt) { this.flash = 1; this.nextBolt = t + 5 + Math.random() * 11; this.flicker = t + 0.12 + Math.random() * 0.1; }
      if (this.flicker && t > this.flicker) { this.flash = Math.max(this.flash, 0.7); this.flicker = 0; }
      if (this.flash > 0.01) { g.fillStyle = `rgba(235,240,255,${this.flash * 0.5})`; g.fillRect(0, 0, W, H); this.flash *= Math.pow(0.02, dt); }
    }
  };
  root.WeatherFX = WeatherFX;
})(this);
