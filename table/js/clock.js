/* The campaign's clock at the table: the date and time in the top bar (the GM moves it on, sets the date and year,
 * and the weather from there), the weather over battle maps that show it (scene setting), and the world map kept up
 * to date. Each campaign keeps its own date (set when it's made), so campaigns can be years apart; the calendar itself
 * (months, years, events) is the world's, kept with the site. The server sends 'time' when either changes, and
 * scenes set to follow the clock get dark at night by themselves. */
'use strict';
(function () {
const { $, h, state, on } = V;
const Cal = window.WorldCalendar;
if (!Cal) return;
const btn = $('#clockBtn');

const ICON = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  dawn: '<path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 6.5v2.4M5.6 9.6l1.6 1.6M18.4 9.6l-1.6 1.6M4 20.5h16"/>',
  cloud: '<path d="M7 18h10.5a3.8 3.8 0 0 0 .3-7.6A5.6 5.6 0 0 0 7 11a3.5 3.5 0 0 0 0 7z"/>',
  rain: '<path d="M7 14h10.5a3.6 3.6 0 0 0 .3-7.2A5.4 5.4 0 0 0 7 7.4a3.3 3.3 0 0 0 0 6.6z"/><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>',
  storm: '<path d="M7 13h10.5a3.6 3.6 0 0 0 .3-7.2A5.4 5.4 0 0 0 7 6.4a3.3 3.3 0 0 0 0 6.6z"/><path d="M12.5 13l-2.5 4h3l-2 4"/>',
  snow: '<path d="M7 13h10.5a3.6 3.6 0 0 0 .3-7.2A5.4 5.4 0 0 0 7 6.4a3.3 3.3 0 0 0 0 6.6z"/><path d="M8 17v.1M12 16v.1M16 17v.1M10 20v.1M14 20v.1"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  cloudsun: '<path d="M8.5 3.5v1.6M3.6 8.4h1.6M5 4.9l1.1 1.1M12 4.9l-1.1 1.1"/><path d="M5.3 11.2a3.4 3.4 0 0 1 6.1-2.6"/><path d="M8 19.5h9.5a3.4 3.4 0 0 0 .3-6.8A5 5 0 0 0 8.2 13 3.3 3.3 0 0 0 8 19.5z"/>',
  overcast: '<path d="M6 18.5h11a3.6 3.6 0 0 0 .3-7.2A5.3 5.3 0 0 0 7 11.8a3.4 3.4 0 0 0-1 6.7z"/><path d="M9.6 8.2A4.6 4.6 0 0 1 17.8 7a3.3 3.3 0 0 1 3 4.4"/>',
  blizzard: '<path d="M7 12h10.5a3.6 3.6 0 0 0 .3-7.2A5.4 5.4 0 0 0 7 5.4a3.3 3.3 0 0 0 0 6.6z"/><path d="M3.5 15.5h10M6.5 18.5h11M9 21.3h6"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const weatherIcon = k => ({ clear: null, cloudy: 'cloudsun', overcast: 'overcast', fog: 'fog', rain: 'rain', storm: 'storm', snow: 'snow', blizzard: 'blizzard' })[k];
const weatherName = k => (Cal.WEATHER.find(w => w[0] === k) || [])[1] || '';

// ───────── the top bar ─────────
function drawButton() {
  const c = state.calendar;
  if (!c || !c.cal) { btn.hidden = true; return; }
  btn.hidden = false;
  const d = Cal.date(c.cal, c.t), sun = Cal.sun(c.cal, c.t), wi = weatherIcon(c.weather.kind);
  btn.innerHTML = `<span class="ci">${svg(sun.phase === 'night' ? 'moon' : sun.phase === 'day' ? 'sun' : 'dawn')}</span>` +
    `<span class="cl"><b>${Cal.clock(d)}</b><span>${d.day} ${d.monthName} ${String(d.yearText || d.year).replace(/[<&>]/g, '')}</span></span>` + (wi ? `<span class="ci w">${svg(wi)}</span>` : '');
  btn.title = `${Cal.label(c.cal, c.t)}${d.yearName ? ' · ' + d.yearName : ''} · ${weatherName(c.weather.kind)}`;
}

// ───────── the panel ─────────
let panel = null;
// the campaign's clock: the server moves it and tells every table (this one too)
const clock = msg => V.send(Object.assign({ t: 'clock' }, msg)).catch(e => V.toast(e.message, true));
btn.onclick = () => {
  if (panel) { panel.remove(); panel = null; return; }
  panel = h('div', { class: 'clockpanel' }); document.body.append(panel); fill();
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) { panel.remove(); panel = null; document.removeEventListener('mousedown', off); } }), 0);
};
function fill() {
  const c = state.calendar; if (!panel || !c) return;
  const d = Cal.date(c.cal, c.t), sun = Cal.sun(c.cal, c.t);
  const fmtH = hrs => { const m = Math.round(hrs * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const kids = [
    h('div', { class: 'cphead' }, h('div', { class: 'cptime' }, Cal.clock(d)), h('div', null, h('b', null, Cal.label(c.cal, c.t)), d.yearName ? h('div', { class: 'muted' }, d.yearName) : null)),
    h('div', { class: 'muted small', style: 'margin:6px 0' }, `Sunrise ${fmtH(sun.rise)} · sunset ${fmtH(sun.set)} · ${weatherName(c.weather.kind)}`)
  ];
  if (V.isGM()) {
    const adv = (label, mins, title) => h('button', { class: 'btn sm', title, onclick: () => clock({ minutes: mins }) }, label);
    kids.push(h('div', { class: 'cpadv' }, adv('−1 h', -60), adv('+10 min', 10), adv('+1 h', 60), adv('+8 h', 480, 'A long rest'),
      h('button', { class: 'btn sm', title: 'On to the next sunrise', onclick: () => clock({ to: 'dawn' }) }, 'Dawn'), adv('+1 day', 1440)));
    const yr = h('input', { type: 'number', value: d.year, style: 'width:72px', title: 'The year' });
    const mo = h('select', null, ...c.cal.months.map((m, i) => h('option', { value: i, selected: i === d.month || null }, m.name)));
    const dy = h('input', { type: 'number', min: 1, max: 400, value: d.day, style: 'width:54px' });
    const tm = h('input', { type: 'time', value: Cal.clock(d) });
    kids.push(h('div', { class: 'cpset' }, dy, mo, yr, tm, h('button', { class: 'btn sm primary', onclick: () => {
      const [hh, mm] = tm.value.split(':').map(Number);
      clock({ set: Cal.toT(c.cal, +yr.value, +mo.value, Math.min(+dy.value || 1, c.cal.months[+mo.value].days), hh || 0, mm || 0) });
    } }, 'Set')));
    kids.push(h('div', { class: 'cplabel' }, 'Weather · ', h('b', null, weatherName(c.weather.kind))), h('div', { class: 'cpweather' }, ...Cal.WEATHER.map(([k, l]) => h('button', { class: 'wbtn' + (c.weather.kind === k ? ' on' : ''), title: l, 'aria-label': l,
      onclick: () => clock({ weather: { kind: k } }) }, h('span', { class: 'wi', html: svg(weatherIcon(k) || 'sun') })))));
    kids.push(h('div', { class: 'cpwind' },
      h('label', null, 'Wind', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: c.weather.wind, onchange: e => clock({ weather: { wind: +e.target.value } }) })),
      h('label', null, 'Towards', h('input', { type: 'range', min: 0, max: 359, step: 15, value: c.weather.dir, onchange: e => clock({ weather: { dir: +e.target.value } }) }))));
    if (state.scene && state.scene.meta.kind !== 'world') {
      const m = state.scene.meta;
      kids.push(h('div', { class: 'cplabel' }, 'This scene'),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!m.clock, onchange: e => V.op({ t: 'scene.update', id: state.scene.id, patch: { clock: e.target.checked } }) }), 'Light follows the time of day (outdoors)'),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!m.weather, onchange: e => V.op({ t: 'scene.update', id: state.scene.id, patch: { weather: e.target.checked } }) }), 'Show the weather here'),
        window.WeatherFX ? h('label', { class: 'inline', title: 'In a cold place rain falls as snow; a rainy one gets more of it, a dry one less' }, 'Climate ',
          h('select', { onchange: e => V.op({ t: 'scene.update', id: state.scene.id, patch: { climate: e.target.value } }) },
            ...Object.entries(window.WeatherFX.CLIMATES).map(([k, c]) => h('option', { value: k, selected: (m.climate || 'temperate') === k || null }, c.label)))) : null);
    }
  }
  kids.push(h('div', { class: 'cpfoot' }, h('span', { class: 'muted small' }, 'This campaign’s own date'), h('button', { class: 'btn sm', onclick: () => { panel.remove(); panel = null; V.showWorld('calendar'); } }, 'Open the calendar')));
  panel.replaceChildren(...kids);
  const r = btn.getBoundingClientRect();
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.left + r.width / 2 - panel.offsetWidth / 2)) + 'px';
}

// ───────── weather over a battle map ─────────
let canvas = null, fx = null, fxGL = false, raf = 0, lastFx = 0;
function weatherOn() {
  const c = state.calendar, s = state.scene;
  return !!(c && s && s.meta.weather && s.meta.kind !== 'world' && window.WeatherFX && !document.body.classList.contains('worldview'));
}
// ───────── the colour of the light ─────────
// A scene that follows the clock takes the colour of the hour: gold at sunrise and sunset, rose then blue at dusk, a
// cool moonlit blue at night, plain by day; and one showing the weather greys under cloud and rain. Laid over the map
// (and its scenery) as a multiplied wash; the darkness itself comes on top, as it always has.
const mixC = (a, b, k) => { k = Math.max(0, Math.min(1, k)); return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k)); };
const NOON = [255, 250, 242], GOLD = [255, 205, 150], ROSE = [236, 160, 128], DUSK = [150, 150, 200], NIGHT = [150, 165, 215];
const WEATHER_TINT = { cloudy: [[214, 220, 226], 0.15], overcast: [[190, 198, 206], 0.35], fog: [[210, 216, 222], 0.35], rain: [[170, 180, 192], 0.45], storm: [[140, 150, 168], 0.6], snow: [[220, 230, 242], 0.3], blizzard: [[200, 212, 228], 0.5] };
function lightColour() {
  const s = state.scene, c = state.calendar;
  if (!s || !c || s.meta.kind === 'world' || !(s.meta.clock || s.meta.weather)) return null;
  let col = [255, 255, 255];
  if (s.meta.clock) {
    const e = Cal.sun(c.cal, c.t).elev;
    col = e >= 0.35 ? NOON : e >= 0.06 ? mixC(GOLD, NOON, (e - 0.06) / 0.29) : e >= -0.08 ? mixC(ROSE, GOLD, (e + 0.08) / 0.14) : e >= -0.3 ? mixC(DUSK, ROSE, (e + 0.3) / 0.22) : NIGHT;
  }
  if (s.meta.weather && c.weather) { const w = WEATHER_TINT[c.weather.kind]; if (w) col = mixC(col, w[0].map((v, i) => v * col[i] / 255), w[1]); }
  return col;
}
function tint() {
  const L = V.stage && V.stage.L; if (!L || !L.tint) return;
  const col = lightColour();
  if (!col || (col[0] > 252 && col[1] > 252 && col[2] > 252)) { L.tint.visible = false; return; }
  const { w, h: H } = V.sceneSize();
  L.tint.clear().beginFill((col[0] << 16) | (col[1] << 8) | col[2]).drawRect(-w, -H, w * 3, H * 3).endFill();
  L.tint.visible = true;
}
V.lightColour = lightColour;

// ───────── indoors: it doesn't rain inside ─────────
// Whatever walls close in (doors and windows count as shut) is indoors, and the weather stops at its walls: found by
// flooding the open ground in from round the scene's edges, a quarter square at a time; what the flood can't reach is
// inside. On a planned map an archway closes a room as a door does, and rock is roof (a dungeon is all indoors).
// The result is a picture (opaque indoors) laid over the weather as a CSS mask that follows the map as it moves.
let mask = null, maskDirty = true, maskOn = null, maskPos = '';
function indoorMask() {
  if (!maskDirty) return mask;
  maskDirty = false; mask = null;
  const s = state.scene; if (!s || !V.sceneSize) return null;
  const { w, h: H } = V.sceneSize(), g = V.grid() || {}, plan = s.meta.plan;
  const walls = [...s.walls.values()].filter(x => x.kind !== 'shade');
  if (!walls.length && !plan) return null;
  const cs = Math.max(2, g.size > 0 ? g.size / 4 : 0, Math.sqrt(w * H / 300000));   // a quarter square (coarser on a huge map)
  const ox = -cs, oy = -cs, nx = Math.ceil(w / cs) + 2, ny = Math.ceil(H / cs) + 2;   // a ring of open ground round it
  const block = new Uint8Array(nx * ny);
  const mark = (x, y) => { const i = Math.floor((x - ox) / cs), j = Math.floor((y - oy) / cs); if (i >= 0 && j >= 0 && i < nx && j < ny) block[j * nx + i] = 1; };
  const seg = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cs * 0.5))); for (let k = 0; k <= n; k++) mark(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); };
  // (a wall along the scene's own edge closes nothing in: a planned building's yard has one all round)
  const onEdge = (a, b) => (Math.abs(a[0] - b[0]) < 1 && (Math.abs(a[0]) < 1 || Math.abs(a[0] - w) < 1)) || (Math.abs(a[1] - b[1]) < 1 && (Math.abs(a[1]) < 1 || Math.abs(a[1] - H) < 1));
  for (const wl of walls) if (!onEdge(wl.a, wl.b)) seg(wl.a, wl.b);
  if (plan && window.Plan) {
    const gs = g.size || 70, gx = g.ox || 0, gy = g.oy || 0;
    for (const d of plan.doors) if (d.k === 'arch') seg([gx + d.x * gs, gy + d.y * gs], d.s === 'n' ? [gx + (d.x + 1) * gs, gy + d.y * gs] : [gx + d.x * gs, gy + (d.y + 1) * gs]);
    if (!plan.style || plan.style.outside === 'rock' || plan.style.outside === 'black') {   // rock overhead: under it is indoors
      const cells = Plan.decode(plan.cells, plan.cols * plan.rows);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = Math.floor((ox + (i + 0.5) * cs - gx) / gs), cy = Math.floor((oy + (j + 0.5) * cs - gy) / gs);
        if (cx >= 0 && cy >= 0 && cx < plan.cols && cy < plan.rows && cells[cy * plan.cols + cx] === Plan.ROCK) block[j * nx + i] = 2;
      }
    }
  }
  // flood the open ground from the ring
  const out = new Uint8Array(nx * ny), q = [];
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) if (!block[j * nx + i] && !out[j * nx + i]) { out[j * nx + i] = 1; q.push(j * nx + i); }
  for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) if (!block[j * nx + i] && !out[j * nx + i]) { out[j * nx + i] = 1; q.push(j * nx + i); }
  while (q.length) {
    const c = q.pop(), i = c % nx, j = (c / nx) | 0;
    if (i > 0 && !block[c - 1] && !out[c - 1]) { out[c - 1] = 1; q.push(c - 1); }
    if (i < nx - 1 && !block[c + 1] && !out[c + 1]) { out[c + 1] = 1; q.push(c + 1); }
    if (j > 0 && !block[c - nx] && !out[c - nx]) { out[c - nx] = 1; q.push(c - nx); }
    if (j < ny - 1 && !block[c + nx] && !out[c + nx]) { out[c + nx] = 1; q.push(c + nx); }
  }
  // indoors: open squares the flood missed, rock, and the walls round them (a wall between two outdoors stays out)
  const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(nx, ny);
  let any = 0;
  for (let c = 0; c < nx * ny; c++) {
    let inside = !out[c] && block[c] !== 1;
    if (block[c] === 1) { const i = c % nx; inside = (i > 0 && !out[c - 1] && block[c - 1] !== 1) || (i < nx - 1 && !out[c + 1] && block[c + 1] !== 1) || (c >= nx && !out[c - nx] && block[c - nx] !== 1) || (c < nx * (ny - 1) && !out[c + nx] && block[c + nx] !== 1); }
    if (inside) { img.data[c * 4 + 3] = 255; any++; }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  mask = { cv, url: null, ox, oy, w: nx * cs, h: ny * cs };
  return mask;
}
V.indoorMask = () => { maskDirty = true; const m = indoorMask(); if (m && !m.url) m.url = m.cv.toDataURL('image/png'); return m; };   // (for testing)
function applyMask(o, k) {
  const m = weatherOn() ? indoorMask() : null, st = canvas.style;
  if (fxGL) { if (m !== maskOn) { maskOn = m; fx.setMask(m && m.cv, m); } return; }   // WebGL: rubbed out in its own last pass
  if (m && !m.url) m.url = m.cv.toDataURL('image/png');
  if (m !== maskOn) {
    maskOn = m; maskPos = '';
    const v = m ? `url(${m.url}), linear-gradient(#000, #000)` : '';
    st.maskImage = st.webkitMaskImage = v;
    st.maskRepeat = st.webkitMaskRepeat = m ? 'no-repeat' : '';
    st.maskComposite = m ? 'exclude' : ''; st.webkitMaskComposite = m ? 'xor' : '';
  }
  if (!m) return;
  const pos = `${(m.ox - o.x) / k}px ${(m.oy - o.y) / k}px, 0 0`, size = `${m.w / k}px ${m.h / k}px, 100% 100%`;
  if (pos + size !== maskPos) { maskPos = pos + size; st.maskPosition = st.webkitMaskPosition = pos; st.maskSize = st.webkitMaskSize = size; }
}
function frame(t) {
  raf = 0;
  if (!weatherOn()) { if (canvas) canvas.hidden = true; return; }
  if (!canvas) {
    // the weather in the scene's own space (WebGL), so it zooms and pans with the map; the simple kind otherwise
    canvas = h('canvas', { class: 'weatherfx' }); $('#stage').append(canvas);
    try { if (window.WeatherGL) { fx = new window.WeatherGL(canvas); fxGL = true; } } catch (e) { canvas.remove(); canvas = h('canvas', { class: 'weatherfx' }); $('#stage').append(canvas); }
    if (!fx) fx = new window.WeatherFX(canvas);
  }
  canvas.hidden = false;
  const c = state.calendar, sun = Cal.sun(c.cal, c.t);
  // on a battle map you're under the clouds: only their shadows, the fog and what falls
  fx.set({ weather: c.weather, light: Math.max(sun.light, 1 - (state.scene.meta.darkness || 0)), cloudScale: 2600, clouds: 0, precip: 1,
    climate: window.WeatherFX.CLIMATES[state.scene.meta.climate] || null, particles: 1, veils: 0.35, ripple: 0, scale: 0.7 });
  if (fx.active() && !document.hidden) {
    if (t - lastFx < 30) { raf = requestAnimationFrame(frame); return; }   // thirty frames a second is plenty for rain
    lastFx = t;
    const r = $('#stage').getBoundingClientRect();
    const o = V.worldAt(r.left, r.top), o2 = V.worldAt(r.left + 100, r.top);
    applyMask(o, (o2.x - o.x) / 100);
    fx.draw(t / 1000, { ox: o.x, oy: o.y, k: (o2.x - o.x) / 100 });
  } else if (fxGL) fx.clear(); else canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  raf = requestAnimationFrame(frame);
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

on('time', () => {
  drawButton(); fill(); kick(); tint();
  // the world map in its frame shows the same sky
  const f = document.getElementById('worldFrame');
  try { if (f && f.contentWindow && f.contentWindow.VALANAR && f.contentWindow.VALANAR.setCalendar) f.contentWindow.VALANAR.setCalendar(state.calendar); } catch (e) { /* not loaded yet */ }
});
on('scene', () => { maskDirty = true; kick(); tint(); }); on('sceneMeta', () => { maskDirty = true; kick(); fill(); tint(); }); on('worldview', kick);
on('walls', () => { maskDirty = true; });
setInterval(() => { if (state.calendar) drawButton(); }, 60000);
})();
