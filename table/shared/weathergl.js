/* Weather drawn in the world rather than on the screen (WebGL): the same job as WeatherFX (weatherfx.js), and the
 * same calls, but everything belongs to the map. The view is a camera looking straight down from a height that
 * goes with the zoom, so:
 *  · clouds, their shadows, fog and the weather's banks are painted per pixel at world positions, lit from the
 *    side the sun is on, and drift with the wind;
 *  · rain and snow are drops in a volume of air over the ground: each drop has a place on the map and a height,
 *    and is seen in perspective, so they stream towards the middle of the view as they fall, slide with the map
 *    as you pan (the high ones faster than the low), and spread apart as you zoom in. The drops live in a block of
 *    air whose size steps with the zoom (two sizes faded together), so there are always about as many on screen;
 *  · from far off, rain is grey veils sweeping across the land and snow a white haze; close in, the drops take
 *    over and rain rings the ground with splashes;
 *  · lightning strikes a place in a storm: the bolt (close in) and a flash lighting the clouds round it.
 *
 *   const fx = new WeatherGL(canvas)          throws if WebGL isn't there (use WeatherFX instead)
 *   fx.set({ …WeatherFX's options…, world: { w, h } (the map's size), sun: { x, y } (towards the sun, on the map),
 *            particles: 0..1 (how much of the drops to draw), veils: 0..1, ripple: 0..1, rippleSize: world units })
 *   fx.draw(seconds, { ox, oy, k })   (as WeatherFX) */
(function (root) {
  'use strict';
  const FX = root.WeatherFX;
  const KINDS = (FX && FX.KINDS) || {
    clear: { cover: 0.08, dark: 0, fog: 0, rain: 0, snow: 0 }, cloudy: { cover: 0.42, dark: 0.05, fog: 0, rain: 0, snow: 0 },
    overcast: { cover: 0.78, dark: 0.25, fog: 0, rain: 0, snow: 0 }, fog: { cover: 0.18, dark: 0.06, fog: 0.85, rain: 0, snow: 0 },
    rain: { cover: 0.72, dark: 0.35, fog: 0.1, rain: 0.55, snow: 0 }, storm: { cover: 0.9, dark: 0.6, fog: 0.15, rain: 1, snow: 0, lightning: true },
    snow: { cover: 0.7, dark: 0.15, fog: 0.15, rain: 0, snow: 0.55 }, blizzard: { cover: 0.92, dark: 0.3, fog: 0.45, rain: 0, snow: 1 }
  };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const GW = 480;   // cells across the world in the weather picture

  const VS_QUAD = 'attribute vec2 a_p; void main() { gl_Position = vec4(a_p, 0.0, 1.0); }';
  const FS_SKY = `
precision highp float;
uniform vec2 u_origin; uniform float u_k; uniform vec2 u_res; uniform float u_dpr; uniform float u_t;
uniform sampler2D u_noise; uniform sampler2D u_w1; uniform sampler2D u_w2; uniform vec2 u_world;
uniform float u_cs; uniform vec2 u_drift; uniform vec2 u_sun; uniform float u_light; uniform float u_cloudVis; uniform float u_regional;
uniform float u_veil; uniform float u_ripple; uniform float u_rippleSize; uniform vec3 u_flash; uniform float u_flashR;
uniform vec2 u_windDir; uniform float u_wind; uniform float u_precip;
uniform float u_aurora; uniform float u_auroraDir;
float nz(vec2 p) { return texture2D(u_noise, p).r; }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * nz(p); p = p * 2.03 + vec2(0.173, 0.311); a *= 0.5; } return s / 0.9375; }
float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
// cloud masses: broad shapes, billows on them, and a little fine detail
float cloud(vec2 p) { return fbm(p * 0.38) * 0.55 + fbm(p * 1.3 + 5.0) * 0.3 + fbm(p * 3.9 + 2.0) * 0.15; }
vec4 over(vec4 src, vec4 dst) { return src + dst * (1.0 - src.a); }
void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 w = u_origin + css * u_k;
  float px = 1.0 / u_k;   // screen px per world unit
  // ── the weather here: the GM's (or the day's) weather in coarse cells, their edges ragged
  vec2 q = w / u_cs;
  vec2 wq = w / (u_cs * 0.12);   // the painted edges roughened a little, not moved
  vec2 warp = (vec2(fbm(wq + 3.1), fbm(wq + 7.7)) - 0.5) * u_cs * 0.05 * u_regional;
  vec2 tw = (w + warp) / u_world;
  vec4 A = texture2D(u_w1, tw), B = texture2D(u_w2, tw);
  float cover0 = A.r, P0 = A.g * u_precip, snow = step(0.5, A.b), F = A.a, dark = B.r;
  // ── the northern lights (on dark nights, over the cold end of the world): curtains of green and violet, rippling
  vec4 aur = vec4(0.0);
  if (u_aurora > 0.001) {
    float yy = u_auroraDir > 0.0 ? w.y / u_world.y : 1.0 - w.y / u_world.y;   // 0 at the cold edge
    float x = w.x / u_world.x;
    // two thin ribbons near the cold edge of the world, gently waving; faint light rather than a wall of colour
    float yc = 0.055 + 0.02 * sin(x * 9.0 + u_t * 0.05) + 0.015 * (fbm(vec2(x * 3.0, u_t * 0.01)) - 0.5) * 2.0;
    float yc2 = yc + 0.022 + 0.008 * sin(x * 17.0 - u_t * 0.07);
    float band = exp(-pow((yy - yc) / 0.012, 2.0)) + 0.55 * exp(-pow((yy - yc2) / 0.009, 2.0));
    float glow = exp(-pow((yy - yc) / 0.035, 2.0)) * 0.12;
    float rays = 0.72 + 0.28 * smoothstep(0.3, 0.8, nz(vec2(w.x / (u_world.x * 0.02) + u_t * 0.01, u_t * 0.002)));
    float flick = 0.8 + 0.2 * sin(u_t * 0.6 + x * 30.0);
    vec3 ac = mix(vec3(0.3, 1.0, 0.6), vec3(0.7, 0.4, 1.0), smoothstep(0.004, 0.02, yc - yy));
    float a = (band * rays * flick + glow) * u_aurora;
    aur = vec4(ac * a * 0.4, a * 0.03);
  }
  if (cover0 < 0.01 && P0 < 0.005 && F < 0.005 && u_flash.z < 0.001) { gl_FragColor = aur; return; }
  // ── clouds, drifting: fractal shapes over a broad patchiness, so the cover comes in banks
  vec2 cq = (w - u_drift) / u_cs;
  float n = cloud(cq);
  float cov = clamp(cover0 + (fbm(cq * 0.33 + 9.0) - 0.5) * 0.35 * u_regional, 0.0, 1.0);
  float thr = 1.0 - cov;
  float dens = smoothstep(thr - 0.06, thr + 0.24, n);
  // lit from the sun's side: brighter where the cloud thins towards the sun
  vec2 lq = cq + u_sun * 0.06;
  float n2 = cloud(lq);
  float lit = clamp((n - n2) * 7.0 + 0.55, 0.0, 1.0);
  // the shadow on the ground: what's overhead a little towards the sun
  vec2 sq = cq + u_sun * 0.14;
  float ns = cloud(sq);
  float sh = smoothstep(thr - 0.02, thr + 0.3, ns);
  float P = P0 * (0.8 + 0.4 * smoothstep(thr - 0.1, thr + 0.3, n));
  vec4 col = vec4(0.0);
  // ── the ground: cloud shadow and the gloom under storm cloud
  float ga = clamp(sh * (0.16 + dark * 0.22) * (0.35 + 0.65 * u_light) + dark * cov * 0.18 + P * 0.06, 0.0, 0.6);
  col = vec4(0.03, 0.05, 0.09, 1.0) * ga;
  // ── splashes: rings on the ground where it's raining, close in
  if (u_ripple > 0.01 && P > 0.03 && snow < 0.5) {
    vec2 rp = w / u_rippleSize, cell = floor(rp);
    float h0 = hash(cell), cyc = u_t * 1.4 + h0 * 7.0, ph = fract(cyc);
    float on = step(hash(cell + floor(cyc) * 1.37), P * 0.45);
    vec2 c = cell + 0.2 + 0.6 * vec2(hash(cell + 1.3 + floor(cyc)), hash(cell + 7.1 + floor(cyc)));
    float d = length(rp - c), r = ph * 0.42, lw = max(0.03, 0.7 / (u_rippleSize * px));
    float ring = (1.0 - smoothstep(0.0, lw, abs(d - r))) * (1.0 - ph) * on;
    col = over(vec4(vec3(0.85, 0.9, 0.95), 1.0) * ring * 0.16 * u_ripple, col);
  }
  // ── from far off: rain as grey veils in bands across the wind, sweeping along it; snow as a drifting white haze
  if (P > 0.005 && u_veil > 0.01) {
    vec2 wd = u_windDir, pr = vec2(dot(w, wd), dot(w, vec2(-wd.y, wd.x)));
    if (snow < 0.5) {
      // squall lines: long bands across the wind, sweeping along it; within them, fine streaks of falling rain
      float st = fbm(vec2(pr.x / (u_cs * 0.16) - u_t * 0.02 * (0.4 + u_wind), pr.y / (u_cs * 0.7)) + 0.3);
      float fine = nz(vec2(pr.x / (u_cs * 0.004) - u_t * 1.6, pr.y / (u_cs * 0.06)));
      float va = P * u_veil * (0.05 + 0.3 * smoothstep(0.45, 0.85, st)) * (0.55 + 0.9 * smoothstep(0.35, 0.8, fine));
      vec3 vc = mix(vec3(0.42, 0.47, 0.56), vec3(0.62, 0.67, 0.75), u_light);
      col = over(vec4(vc, 1.0) * clamp(va, 0.0, 0.7), col);
    } else {
      float st = fbm((w - u_drift * 1.6) / (u_cs * 0.14) + vec2(0.0, u_t * 0.01));
      // (faint, and only in drifts: an even wash read as a tint laid over the land, edged where the snow stops)
      float va = P * u_veil * 0.16 * smoothstep(0.5, 0.85, st);
      col = over(vec4(mix(vec3(0.7, 0.72, 0.76), vec3(0.97, 0.98, 1.0), u_light), 1.0) * clamp(va, 0.0, 0.3), col);
    }
  }
  // ── fog: a thin, even haze, and long soft banks lying across it, creeping with the wind — the map always shows through
  if (F > 0.005) {
    vec2 fq = (w - u_drift * 0.2) / (u_cs * 0.5); fq.y *= 2.6;                    // banks: long and low
    float bank = smoothstep(0.42, 0.78, fbm(fq + vec2(u_t * 0.004, 0.0)));
    float wisp = fbm((w + u_drift * 0.15) / (u_cs * 0.12) + 3.3);                  // a little texture within them
    float fa = F * (0.13 + 0.3 * bank * (0.65 + 0.35 * wisp));
    col = over(vec4(mix(vec3(0.45, 0.49, 0.57), vec3(0.93, 0.94, 0.95), u_light), 1.0) * clamp(fa, 0.0, 0.42), col);
  }
  // ── the clouds themselves, over everything (fading as you come down under them)
  if (dens > 0.001 && u_cloudVis > 0.001) {
    vec3 top = mix(vec3(1.0, 0.99, 0.97), vec3(0.6, 0.63, 0.69), dark);
    vec3 under = mix(vec3(0.66, 0.71, 0.8), vec3(0.3, 0.33, 0.39), dark);
    vec3 cc = mix(under, top, lit * 0.85 + dens * 0.15);
    cc *= mix(vec3(0.18, 0.22, 0.34), vec3(1.0), u_light);
    float ca = dens * u_cloudVis * (0.42 + 0.28 * cov);
    col = over(vec4(cc, 1.0) * ca, col);
  }
  // ── lightning: the clouds round the strike lit up from inside
  if (u_flash.z > 0.001) {
    float d = length(w - u_flash.xy) / u_flashR, g = exp(-d * d * 2.2) * u_flash.z;
    col.rgb += vec3(0.82, 0.86, 1.0) * g * (0.25 + dens * 0.8);
    col.a = min(1.0, col.a + g * 0.18);
  }
  col.rgb += aur.rgb * (1.0 - col.a * 0.7); col.a = min(1.0, col.a + aur.a);
  gl_FragColor = col;
}`;
  const VS_DROP = `
attribute vec4 a_seed; attribute float a_end;
uniform vec2 u_center; uniform float u_k; uniform float u_Hc; uniform float u_zTop; uniform float u_S; uniform float u_t;
uniform float u_fall; uniform vec2 u_slant; uniform float u_len; uniform vec2 u_half; uniform float u_snow; uniform float u_size; uniform float u_dpr;
varying vec2 v_ground; varying float v_a; varying float v_r;
void main() {
  vec4 s = a_seed;
  if (u_snow > 0.5 && a_end > 0.5) s = fract(s.yxwz * 1.618 + 0.31);
  float ph = fract(s.z - u_t / (u_fall * (0.8 + 0.4 * s.w)));   // 1 high up, 0 at the ground
  float z = ph * u_zTop;
  if (u_snow < 0.5) z += a_end * u_len * u_zTop;                 // a streak: its tail is higher
  vec2 rel = mod(s.xy * u_S - u_center + 0.5 * u_S, u_S) - 0.5 * u_S;   // its spot, in the block of air round the camera
  vec2 sway = u_snow > 0.5 ? vec2(sin(u_t * 1.3 + s.w * 40.0), cos(u_t * 0.9 + s.z * 30.0)) * u_S * 0.006 * ph : vec2(0.0);
  vec2 p = rel + u_slant * (z / u_zTop) + sway;                  // higher up, further upwind
  float persp = u_Hc / (u_Hc - z);
  vec2 css = p / u_k * persp;
  gl_Position = vec4(css / u_half * vec2(1.0, -1.0), 0.0, 1.0);
  gl_PointSize = u_size * persp * u_dpr * (0.6 + 0.8 * s.w);
  v_ground = u_center + rel;
  v_a = smoothstep(0.0, 0.07, ph) * smoothstep(1.0, 0.8, ph) * (u_snow > 0.5 ? 1.0 : 1.0 - a_end);
  v_r = s.w;
}`;
  const FS_DROP = `
precision highp float;
uniform sampler2D u_w1; uniform vec2 u_world; uniform vec4 u_col; uniform float u_snow; uniform float u_alpha; uniform float u_precip;
varying vec2 v_ground; varying float v_a; varying float v_r;
void main() {
  vec4 W = texture2D(u_w1, v_ground / u_world);
  float p = W.g * u_precip, isSnow = step(0.5, W.b);
  if (abs(isSnow - u_snow) > 0.5 || v_r * 1.15 > p) discard;
  float a = v_a * u_alpha * u_col.a;
  if (u_snow > 0.5) { vec2 q = gl_PointCoord - 0.5; a *= 1.0 - smoothstep(0.15, 0.5, length(q)); }
  gl_FragColor = vec4(u_col.rgb * a, a);
}`;
  const VS_BOLT = 'attribute vec2 a_p; attribute float a_a; varying float v_a; void main() { gl_Position = vec4(a_p, 0.0, 1.0); v_a = a_a; }';
  // the last pass: indoors taken out (a picture, opaque where it's inside, laid over the world at u_rect)
  const FS_MASK = `
precision mediump float;
uniform vec2 u_origin; uniform float u_k; uniform vec2 u_res; uniform float u_dpr; uniform vec4 u_rect; uniform sampler2D u_mask;
void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 uv = (u_origin + css * u_k - u_rect.xy) / u_rect.zw;
  float a = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(u_mask, uv).a;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;
  const FS_BOLT = 'precision mediump float; uniform vec3 u_c; varying float v_a; void main() { gl_FragColor = vec4(u_c * v_a, v_a); }';

  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  // a smooth noise picture that tiles, for the shaders to sample
  function noiseTexture(gl) {
    const N = 256, out = new Uint8Array(N * N * 4), acc = new Float32Array(N * N);
    let seed = 0x9e3779b9;   // mulberry32: no rows or patterns in it
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let total = 0;
    for (const [g, amp] of [[8, 0.5], [16, 0.28], [32, 0.15], [64, 0.07]]) {
      const grid = new Float32Array(g * g); for (let i = 0; i < grid.length; i++) grid[i] = rnd();
      const cell = N / g;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), at = (i, j) => grid[(j % g) * g + (i % g)];
        acc[y * N + x] += amp * ((at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v);
      }
      total += amp;
    }
    let lo = 1, hi = 0; for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < N * N; i++) { const v = Math.round((acc[i] - lo) / (hi - lo) * 255); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  function dataTexture(gl) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return t;
  }

  const NDROPS = 7000;
  function WeatherGL(canvas) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: true });   // (kept: the map's postcards copy it)
    if (!gl) throw new Error('No WebGL');
    this.c = canvas; this.gl = gl;
    this.o = { weather: { kind: 'clear', wind: 0.3, dir: 60 }, light: 1, cloudScale: 6000, clouds: 1, precip: 1, particles: 1, veils: 1, ripple: 1, rippleSize: 40 };
    this.sky = compile(gl, VS_QUAD, FS_SKY); this.maskP = compile(gl, VS_QUAD, FS_MASK); this.maskTex = null; this.maskRect = null; this.drop = compile(gl, VS_DROP, FS_DROP); this.bolt = compile(gl, VS_BOLT, FS_BOLT);
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const seeds = new Float32Array(NDROPS * 2 * 5);
    for (let i = 0; i < NDROPS; i++) { const s = [Math.random(), Math.random(), Math.random(), Math.random()]; for (let e = 0; e < 2; e++) seeds.set([...s, e], (i * 2 + e) * 5); }
    this.drops = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.drops); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    this.boltBuf = gl.createBuffer();
    this.noise = noiseTexture(gl); this.w1 = dataTexture(gl); this.w2 = dataTexture(gl);
    this.field = null; this.fieldSig = ''; this.fieldAt = 0;
    this.strike = null; this.nextStrike = 0;
  }
  WeatherGL.KINDS = KINDS;
  if (FX) WeatherGL.CLIMATES = FX.CLIMATES;
  WeatherGL.prototype.set = function (o) { Object.assign(this.o, o || {}); };
  WeatherGL.prototype.active = function () {
    if (this.o.kindAt || this.o.aurora > 0.001) return true;
    const K = KINDS[this.o.weather.kind] || KINDS.clear;
    return K.cover > 0.05 || K.fog || K.rain || K.snow;
  };
  // ── the weather over the whole world (or the whole scene), in cells: cover, how hard it falls, snow, fog;
  // how dark, lightning, how wet. Remade when the weather, the painting or the climates change (and now and then).
  WeatherGL.prototype._field = function (now) {
    const o = this.o, world = o.world || { w: 1, h: 1 };
    const sig = [o.weather.kind, world.w, world.h, !!o.regional, JSON.stringify(o.climate || null)].join('|');
    if (sig === this.fieldSig && o.kindAt === this.fieldKind && o.climateAt === this.fieldClim) return;
    this.fieldSig = sig; this.fieldKind = o.kindAt; this.fieldClim = o.climateAt; this.fieldAt = now;
    const gw = o.regional ? GW : 4, gh = o.regional ? Math.max(4, Math.round(GW * world.h / world.w)) : 4;
    const a = new Uint8Array(gw * gh * 4), b = new Uint8Array(gw * gh * 4), base = KINDS[o.weather.kind] || KINDS.clear;
    const F = { gw, gh, P: new Float32Array(gw * gh), L: new Uint8Array(gw * gh), S: new Uint8Array(gw * gh) };
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const wx = (x + 0.5) / gw * world.w, wy = (y + 0.5) / gh * world.h;
      let K = base, painted = false;
      if (o.kindAt) { const kk = o.kindAt(wx, wy); if (kk && KINDS[kk]) { K = KINDS[kk]; painted = true; } }
      const cl = (o.climateAt && o.climateAt(wx, wy)) || o.climate || null, wet = cl ? cl.wet : 1, cold = cl ? cl.cold : 0;
      let cover = K.cover; if (wet < 0.5 && !painted) cover *= 0.4 + wet;
      let p = Math.max(K.rain, K.snow) * (painted ? 1 : Math.min(1.3, o.regional ? Math.max(0.35, wet) : wet));
      if (cold >= 2 && p < 0.3 && cover > 0.55) p = Math.max(p, 0.3 * smooth(0.55, 0.85, cover));
      const i = y * gw + x, snow = K.snow > 0 || cold >= 1;
      a[i * 4] = Math.round(cover * 255); a[i * 4 + 1] = Math.round(Math.min(1, p) * 255); a[i * 4 + 2] = snow ? 255 : 0; a[i * 4 + 3] = Math.round(K.fog * 255);
      b[i * 4] = Math.round(K.dark * 255); b[i * 4 + 1] = K.lightning ? 255 : 0; b[i * 4 + 2] = Math.round(Math.min(1, wet / 1.7) * 255); b[i * 4 + 3] = 255;
      F.P[i] = Math.min(1, p); F.L[i] = K.lightning ? 1 : 0; F.S[i] = snow ? 1 : 0;
    }
    const gl = this.gl;
    for (const [t, d] of [[this.w1, a], [this.w2, b]]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, d); }
    F.maxP = F.P.reduce((m, v) => Math.max(m, v), 0); F.anyL = F.L.some(Boolean);
    this.field = F;
  };
  WeatherGL.prototype._at = function (x, y) {
    const F = this.field, w = this.o.world; if (!F || !w) return -1;
    const cx = Math.floor(x / w.w * F.gw), cy = Math.floor(y / w.h * F.gh);
    if (cx < 0 || cy < 0 || cx >= F.gw || cy >= F.gh) return -1;
    return cy * F.gw + cx;
  };
  WeatherGL.prototype.sample = function (x, y) {
    const i = this._at(x, y), F = this.field; if (i < 0 || !F) return null;
    return { precip: F.P[i], lightning: !!F.L[i], snow: !!(F.S && F.S[i]) };
  };
  // where it doesn't rain: a canvas, opaque where it's indoors, covering rect { ox, oy, w, h } of the world (null: nowhere)
  WeatherGL.prototype.setMask = function (cv, rect) {
    const gl = this.gl;
    if (!cv) { this.maskRect = null; return; }
    if (!this.maskTex) this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    this.maskRect = rect;
  };
  WeatherGL.prototype.clear = function () { const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
  WeatherGL.prototype.draw = function (t, view) {
    const gl = this.gl, c = this.c, o = this.o;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * (o.scale || 1);   // (scale: drawn smaller and stretched, where detail matters less)
    const cw = Math.max(1, c.clientWidth), ch = Math.max(1, c.clientHeight);
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    if (!o.world) o.world = { w: cw * view.k, h: ch * view.k };
    this._field(t);
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const K = KINDS[o.weather.kind] || KINDS.clear, wind = o.weather.wind == null ? 0.3 : o.weather.wind, dir = (o.weather.dir || 0) * Math.PI / 180;
    const wd = [Math.cos(dir), Math.sin(dir)], cs = o.cloudScale || 6000;
    const drift = (40 + wind * 260) * (cs / 6000) * t;
    const light = o.light == null ? 1 : o.light;
    const sun = o.sun || { x: 0.45, y: 0.75 }, sl = Math.hypot(sun.x, sun.y) || 1;
    // the camera: looking down at the middle of the view, from a height that goes with how much of the world is in view
    const Ww = cw * view.k, cx = view.ox + cw / 2 * view.k, cy = view.oy + ch / 2 * view.k;
    const Hc = Ww * 1.05, zTop = Hc * 0.55;
    // lightning: now and then, a strike somewhere in a storm in view
    const F = this.field;
    if (F && F.anyL && !this.nextStrike) this.nextStrike = t + 4 + Math.random() * 10;   // (not the moment a storm comes into view)
    if (F && F.anyL && t > this.nextStrike) {
      // now and then, not all the time: half a minute or so apart, sometimes a pair close together
      this.nextStrike = t + (Math.random() < 0.15 ? 2 + Math.random() * 4 : (o.regional ? 16 : 20) + Math.random() * (o.regional ? 30 : 35));
      for (let tries = 0; tries < 30; tries++) {
        const x = view.ox + Math.random() * Ww, y = view.oy + Math.random() * ch * view.k, i = this._at(x, y);
        if (i >= 0 && F.L[i] && F.P[i] > 0.3) { this.strike = { x, y, t0: t, seed: Math.random() * 1000, flick: 0.1 + Math.random() * 0.12 }; if (o.onStrike) try { o.onStrike({ x, y, dist: Math.hypot(x - cx, y - cy) / Ww }); } catch (e) { /* the listener's own trouble */ } break; }
      }
    }
    let flash = 0;
    if (this.strike) {
      const age = t - this.strike.t0;
      flash = Math.exp(-age * 9) + (age > this.strike.flick ? 0.7 * Math.exp(-(age - this.strike.flick) * 8) : 0);
      if (age > 1.2) { this.strike = null; flash = 0; }
    }
    // ── the sky pass
    const S = this.sky; gl.useProgram(S.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const ap = gl.getAttribLocation(S.p, 'a_p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.w1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.w2);
    const U = S.u;
    gl.uniform1i(U.u_noise, 0); gl.uniform1i(U.u_w1, 1); gl.uniform1i(U.u_w2, 2);
    gl.uniform2f(U.u_origin, view.ox, view.oy); gl.uniform1f(U.u_k, view.k); gl.uniform2f(U.u_res, W, H); gl.uniform1f(U.u_dpr, dpr);
    gl.uniform1f(U.u_t, t % 10000); gl.uniform2f(U.u_world, o.world.w, o.world.h); gl.uniform1f(U.u_cs, cs);
    gl.uniform2f(U.u_drift, wd[0] * drift, wd[1] * drift); gl.uniform2f(U.u_sun, sun.x / sl, sun.y / sl);
    gl.uniform1f(U.u_light, light); gl.uniform1f(U.u_cloudVis, o.clouds == null ? 1 : o.clouds); gl.uniform1f(U.u_regional, o.regional ? 1 : 0.35);
    gl.uniform1f(U.u_veil, o.veils == null ? 1 : o.veils); gl.uniform1f(U.u_ripple, o.ripple || 0); gl.uniform1f(U.u_rippleSize, o.rippleSize || 40);
    gl.uniform3f(U.u_flash, this.strike ? this.strike.x : 0, this.strike ? this.strike.y : 0, flash); gl.uniform1f(U.u_flashR, o.regional ? Math.max(1500, Ww * 0.18) : Ww * 2);
    gl.uniform1f(U.u_aurora, (o.aurora || 0) * smooth(o.world.w * 0.1, o.world.w * 0.35, Ww)); gl.uniform1f(U.u_auroraDir, o.auroraDir || 1);   // high in the sky: seen from far off, gone as you come down
    gl.uniform2f(U.u_windDir, wd[0], wd[1]); gl.uniform1f(U.u_wind, wind); gl.uniform1f(U.u_precip, o.precip == null ? 1 : o.precip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(ap);
    // ── the drops: rain as streaks, snow as flakes, in two sizes of block faded together
    const pv = o.particles == null ? 1 : o.particles;
    const anyP = F && F.maxP > 0.01;
    if (pv > 0.01 && anyP) {
      const D = this.drop; gl.useProgram(D.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.drops);
      const as = gl.getAttribLocation(D.p, 'a_seed'), ae = gl.getAttribLocation(D.p, 'a_end');
      gl.enableVertexAttribArray(as); gl.vertexAttribPointer(as, 4, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(ae); gl.vertexAttribPointer(ae, 1, gl.FLOAT, false, 20, 16);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.w1);
      const V = D.u;
      gl.uniform1i(V.u_w1, 1); gl.uniform2f(V.u_world, o.world.w, o.world.h);
      gl.uniform2f(V.u_center, cx, cy); gl.uniform1f(V.u_k, view.k); gl.uniform1f(V.u_Hc, Hc); gl.uniform1f(V.u_zTop, zTop);
      gl.uniform1f(V.u_t, t % 10000); gl.uniform2f(V.u_half, cw / 2, ch / 2); gl.uniform1f(V.u_dpr, dpr); gl.uniform1f(V.u_precip, o.precip == null ? 1 : o.precip);
      const L2 = Math.log2(Ww * 2), lv = Math.floor(L2), f = L2 - lv;
      const levels = [[Math.pow(2, lv), 1 - f], [Math.pow(2, lv + 1), f]];
      const night = 1 - light;
      for (const snowPass of [0, 1]) {
        gl.uniform1f(V.u_snow, snowPass);
        if (snowPass) {
          gl.uniform1f(V.u_fall, 9); gl.uniform2f(V.u_slant, wd[0] * zTop * (0.2 + wind * 0.9), wd[1] * zTop * (0.2 + wind * 0.9));
          gl.uniform1f(V.u_size, 3.2); gl.uniform1f(V.u_len, 0);
          gl.uniform4f(V.u_col, 1 - 0.25 * night, 1 - 0.22 * night, 1 - 0.1 * night, 0.9);
        } else {
          gl.uniform1f(V.u_fall, 0.75); gl.uniform2f(V.u_slant, wd[0] * zTop * (0.08 + wind * 0.45), wd[1] * zTop * (0.08 + wind * 0.45));
          gl.uniform1f(V.u_size, 1); gl.uniform1f(V.u_len, 0.09);
          gl.uniform4f(V.u_col, 0.8 - 0.25 * night, 0.86 - 0.25 * night, 0.94 - 0.2 * night, 0.75);
        }
        for (const [Sz, wgt] of levels) {
          if (wgt < 0.02) continue;
          gl.uniform1f(V.u_S, Sz); gl.uniform1f(V.u_alpha, wgt * pv);
          gl.drawArrays(snowPass ? gl.POINTS : gl.LINES, 0, NDROPS * 2);
        }
      }
      gl.disableVertexAttribArray(as); gl.disableVertexAttribArray(ae);
    }
    // ── the bolt itself, close in: a jagged line down from the cloud to the ground, seen from above
    if (this.strike && flash > 0.05 && pv > 0.2) {
      const s = this.strike, rnd = (() => { let q = Math.floor(s.seed * 1e6) % 2147483647 || 1; return () => (q = (q * 16807) % 2147483647) / 2147483647; })();
      const proj = (x, y, z) => { const pp = Hc / (Hc - z); return [((x - cx) / view.k * pp) / (cw / 2), -((y - cy) / view.k * pp) / (ch / 2)]; };
      const tri = [];
      const seg = (a, b, wpx, al) => {
        const dx = (b[0] - a[0]) * cw / 2, dy = (b[1] - a[1]) * ch / 2, l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * wpx / (cw / 2), ny = dx / l * wpx / (ch / 2);
        tri.push(a[0] + nx, a[1] + ny, al, a[0] - nx, a[1] - ny, al, b[0] + nx, b[1] + ny, al, b[0] + nx, b[1] + ny, al, a[0] - nx, a[1] - ny, al, b[0] - nx, b[1] - ny, al);
      };
      const branch = (x, y, z, steps, jit, main) => {
        let p = [x, y, z];
        for (let i = 0; i < steps; i++) {
          const nz = Math.max(0, p[2] - z / steps), np = [p[0] + (rnd() - 0.5) * jit, p[1] + (rnd() - 0.5) * jit, nz];
          if (i === steps - 1 && main) { np[0] = s.x; np[1] = s.y; np[2] = 0; }
          const A = proj(...p), B = proj(...np);
          seg(A, B, main ? 5 : 3, 0.18 * flash); seg(A, B, main ? 1.4 : 0.8, 0.95 * flash);
          if (main && rnd() < 0.3 && i < steps - 2) branch(np[0], np[1], np[2], 3, jit * 0.8, false);
          p = np;
        }
      };
      branch(s.x + (rnd() - 0.5) * Ww * 0.02, s.y + (rnd() - 0.5) * Ww * 0.02, zTop * 0.95, 11, Ww * 0.012, true);
      const B = this.bolt; gl.useProgram(B.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.boltBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.STREAM_DRAW);
      const bp = gl.getAttribLocation(B.p, 'a_p'), ba = gl.getAttribLocation(B.p, 'a_a');
      gl.enableVertexAttribArray(bp); gl.vertexAttribPointer(bp, 2, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(ba); gl.vertexAttribPointer(ba, 1, gl.FLOAT, false, 12, 8);
      gl.uniform3f(B.u.u_c, 0.92, 0.95, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, tri.length / 3);
      gl.disableVertexAttribArray(bp); gl.disableVertexAttribArray(ba);
    }
    if (this.maskRect && this.maskTex) {   // indoors: rubbed out
      const M = this.maskP, r = this.maskRect; gl.useProgram(M.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      const mp = gl.getAttribLocation(M.p, 'a_p'); gl.enableVertexAttribArray(mp); gl.vertexAttribPointer(mp, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.uniform1i(M.u.u_mask, 0); gl.uniform2f(M.u.u_origin, view.ox, view.oy); gl.uniform1f(M.u.u_k, view.k); gl.uniform2f(M.u.u_res, W, H); gl.uniform1f(M.u.u_dpr, dpr);
      gl.uniform4f(M.u.u_rect, r.ox, r.oy, r.w, r.h);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(mp);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    this.lastMaxP = F ? F.maxP : 0;
  };
  root.WeatherGL = WeatherGL;
})(this);
