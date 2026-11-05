/* The sky over the world map: day and night from the world's clock, and the weather (clouds, fog, rain, snow,
 * storms). Plus the clock on the map (top right): everyone sees the date and time; admins move the clock
 * on and set the weather there (or in the Calendar).
 *
 * The calendar lives on the server (/api/site/calendar); the table pushes changes in (VALANAR.setCalendar) when the
 * map is shown inside it, and on its own the page checks every half a minute.
 * ValanarSky(ctx) → { setCalendar, get calendar, openClock } */
'use strict';
window.ValanarSky = function (ctx) {
  const { map, L, h, store, toast, NATIVE } = ctx;
  const SV = window.VALANAR_SERVER || {};
  const Cal = window.WorldCalendar;
  const admin = !!SV.admin;
  let cal = null, shown = store.get('valanar-sky', true) !== false;
  let pushed = !!ctx.scene;   // the table has pushed a campaign's clock in: don't fetch the world's over it
  // Your own sky. On the world map (the site, and the table's Map tab) everyone has their own hour and weather, kept
  // in this browser: the first time, they start as the GM set them; after that they're yours to change. Only on a
  // campaign's world map in the table does the GM's clock rule (everyone has to see the same thing to play).
  // weather: a kind, or 'painted': the weather the GM painted on the map (and theirs everywhere else).
  const LOCAL_KEY = 'valanar-sky-view';
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (e) { local = null; }
  const canLocal = () => !ctx.scene && !pushed;
  const hasRegions = () => !!(cal && cal.regions && cal.regions.length);
  const gmHour = () => { const d = Cal.date(cal.cal, cal.t); return d.hour + Math.round(d.minute / 15) / 4; };
  const gmStart = () => ({ hour: gmHour(), weather: hasRegions() ? 'painted' : cal.weather.kind });
  const saveLocal = () => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) { /* private window: just for now */ } };
  function setLocal(patch, quiet) {
    local = Object.assign({}, local || gmStart(), patch); saveLocal();
    look(); if (!quiet) fillPanel();
  }
  // the sky as this screen shows it
  // a tale or Drift (app/tales.js) sets the hour and the weather for a while without touching anyone's own: preview
  let preview = null;
  function view() {
    if (!cal || !canLocal()) return cal;
    const lv = Object.assign({}, local || gmStart(), preview || {}), d = Cal.date(cal.cal, cal.t);
    const t = Cal.toT(cal.cal, d.year, d.month, d.day, Math.floor(lv.hour), Math.round((lv.hour % 1) * 60));
    const kind = painter ? painter.base : lv.weather === 'painted' ? cal.weather.kind : lv.weather;
    return Object.assign({}, cal, { t, weather: Object.assign({}, cal.weather, { kind: Cal.WEATHER.some(w => w[0] === kind) ? kind : cal.weather.kind }) });
  }
  // painted weather: the regions as a coarse picture of the map, looked up as the weather is drawn
  let rast = null, paintDraft = null;
  function kindAt() {
    if (!cal || !ctx.size) return null;
    const regs = paintDraft || (canLocal() && ((preview && preview.weather) || (local || gmStart()).weather) === 'painted' ? cal.regions || [] : []);
    if (!regs.length) return null;
    const sig = regs.map(r => r.kind + r.pts.length + ':' + r.pts.slice(0, 4).join(',')).join('|');
    if (rast && rast.sig === sig) return rast.fn;
    const W = ctx.size.w, H = ctx.size.h, gw = 1000, gh = Math.max(1, Math.round(gw * H / W)), s = gw / W;
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const g = c.getContext('2d');
    regs.forEach((r, i) => {
      g.fillStyle = `rgb(${(i + 1) % 256},${(i + 1) >> 8},0)`; g.beginPath();
      for (let j = 0; j < r.pts.length; j += 2) g[j ? 'lineTo' : 'moveTo'](r.pts[j] * s, r.pts[j + 1] * s);
      g.closePath(); g.fill();
    });
    const px = g.getImageData(0, 0, gw, gh).data;
    const fn = (x, y) => {
      const cx = Math.floor(x * s), cy = Math.floor(y * s); if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return null;
      const i = (cy * gw + cx) * 4; if (px[i + 3] < 128) return null;
      const r = regs[px[i] + px[i + 1] * 256 - 1]; return r ? r.kind : null;
    };
    rast = { sig, fn };
    return fn;
  }

  // ───────── the layer: night tint, twilight glow and the weather, between the map and the place icons ─────────
  // each in its own pane: a pane is a stacking context, so the blend has to be set on the pane itself to reach the tiles
  const mkPane = (name, z, blend) => { const p = map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = 'none'; if (blend) p.style.mixBlendMode = blend; return L.DomUtil.create('div', 'skybox', p); };
  const night = mkPane('skyNight', 448, 'multiply'), glow = mkPane('skyGlow', 449, 'soft-light'), box = mkPane('sky', 450);
  night.classList.add('skynight'); glow.classList.add('skyglow');
  let canvas = L.DomUtil.create('canvas', 'skyfx', box);
  // the weather in the world (WebGL: table/shared/weathergl.js), or drawn over the screen where WebGL isn't to be had
  let fx = null, GL = false;
  try { if (window.WeatherGL) { fx = new window.WeatherGL(canvas); GL = true; } }
  catch (e) { console.warn('Weather falls back to the simple kind:', e.message); canvas.remove(); canvas = L.DomUtil.create('canvas', 'skyfx', box); }
  if (!fx && window.WeatherFX) fx = new window.WeatherFX(canvas);
  let sunVec = { x: 0.45, y: 0.75 }, moved = false, darkNow = 0;
  let zooming = false;
  // the simple kind can't follow a zoom; the world's weather is scaled along with the map while it zooms. (Only an
  // animated zoom: flying (a tale, Drift) moves the map frame by frame, and the weather is drawn as it goes.)
  map.on('zoomanim', () => { zooming = true; if (!GL) canvas.style.opacity = 0; });
  map.on('zoomend', () => { zooming = false; canvas.style.opacity = 1; moved = true; });
  function place() {
    const s = map.getSize();
    const tl = map.containerPointToLayerPoint([0, 0]);
    for (const b of [box, night, glow]) { L.DomUtil.setPosition(b, tl); b.style.width = s.x + 'px'; b.style.height = s.y + 'px'; }
    return { tl, s };
  }
  function look() {
    if (!cal) return;
    place();
    const sk = view();
    const sun = Cal.sun(sk.cal, sk.t), on = shown;
    const dark = Math.min(1, (1 - sun.light) * (ctx.nightStrength ? Math.max(0, ctx.nightStrength()) : 1));   // Map settings › how dark the night gets
    // the map multiplied by the sky's colour: white by day, warm in the golden hour, rose and violet through twilight,
    // deep blue at night (darkest at midnight); dawn and dusk also get a warm glow from the side the sun is on
    const STOPS = [[0, [255, 255, 255]], [0.12, [255, 238, 214]], [0.3, [236, 196, 186]], [0.5, [164, 140, 178]], [0.7, [100, 106, 156]], [0.88, [66, 80, 134]], [1, [46, 58, 108]]];
    let i = 1; while (i < STOPS.length - 1 && dark > STOPS[i][0]) i++;
    const [d0, c0] = STOPS[i - 1], [d1, c1] = STOPS[i], k = Math.min(1, Math.max(0, (dark - d0) / (d1 - d0)));
    night.style.background = `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    const e = sun.elev != null ? sun.elev : 0;
    const tw = Math.exp(-Math.pow((e + 0.04) / 0.16, 2));   // strongest just after sunset and just before sunrise
    const east = (sun.rise + sun.set) / 2 > (Cal.date(sk.cal, sk.t).hour + Cal.date(sk.cal, sk.t).minute / 60);
    glow.style.background = `radial-gradient(ellipse at ${east ? '100%' : '0%'} 60%, rgba(255,150,70,${(0.45 * tw).toFixed(3)}), rgba(255,120,80,${(0.18 * tw).toFixed(3)}) 60%, transparent 100%)`;
    night.style.display = glow.style.display = on ? '' : 'none';
    document.body.classList.toggle('sky-night', on && dark > 0.6);
    // where the sun is in the sky, for the clouds' light and shadows: east at sunrise, south at noon, west at sunset
    { const hr = Cal.date(sk.cal, sk.t).hour + Cal.date(sk.cal, sk.t).minute / 60, f = Math.max(0, Math.min(1, (hr - sun.rise) / Math.max(0.1, sun.set - sun.rise)));
      sunVec = { x: Math.cos(Math.PI * f), y: 0.35 + Math.sin(Math.PI * f) }; }
    darkNow = on ? dark : 0;
    // the northern lights on a dark night (Map settings › Life on the map: which end of the world is cold)
    if (fx && GL) { const ad = ctx.aurora ? ctx.aurora() : 0; fx.set({ aurora: ad ? 0.9 * Math.max(0, Math.min(1, (darkNow - 0.55) / 0.3)) : 0, auroraDir: ad || 1 }); }
    if (fx) fx.set({ weather: sk.weather, light: sun.light, sun: sunVec });
    // the town lights, the seasons (app/ambience.js)
    if (ctx.onSky) try { ctx.onSky({ dark: on ? dark : 0, cal: sk.cal, t: sk.t, kind: sk.weather.kind, wind: sk.weather.wind, dir: sk.weather.dir }); } catch (e) { console.warn(e); }
    drawButton();
  }
  // weather, every frame while the map is shown
  let raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!cal || !fx || !shown || document.hidden || !ctx.isMapView() || zooming) { if (canvas.style.display !== 'none' && (!shown || !fx || !fx.active())) canvas.style.display = 'none'; return; }
    if (!fx.active()) { canvas.style.display = 'none'; place(); return; }
    canvas.style.display = '';
    if (t - (frame.last || 0) < 33 && !moved) return;   // 30 frames a second is plenty (but at once when the map moves)
    frame.last = t; moved = false;
    const { tl } = place();
    const z = map.getZoom(), k = Math.pow(2, NATIVE - z);   // map px per screen px
    const o = ctx.toPixel(map.layerPointToLatLng(tl));
    // the clouds themselves at the world's scale, thinning out as you zoom in under them (their shadows stay)
    // the weather comes in banks and cells drifting with the wind; rain or snow by each nation's climate (Borders › Climate)
    if (GL) {
      // far off: the clouds and the weather's veils; coming down, the clouds thin, the drops and then the splashes show
      fx.set({ cloudScale: 9000, clouds: Math.max(0, Math.min(1, (5.2 - z) / 3)) * 0.8 + 0.12, precip: 1, regional: true, world: ctx.size,
        particles: Math.max(0, Math.min(1, (z - 2.2) / 1.4)), veils: 1 - 0.65 * Math.max(0, Math.min(1, (z - 2.5) / 2)),
        ripple: 0,
        // the northern lights on a dark night (Map settings › Life on the map: which end of the world is cold)
        onStrike: ctx.onStrike || null,
        climateAt: ctx.climateAt ? ctx.climateAt() : null, kindAt: kindAt() });
    } else fx.set({ cloudScale: 9000, clouds: Math.max(0, Math.min(1, (5 - z) / 3)) * 0.85 + 0.08, precip: Math.min(1, 0.35 + z / 6), regional: true,
      climateAt: ctx.climateAt ? ctx.climateAt() : null, kindAt: kindAt() });
    fx.draw(t / 1000, { ox: o.x, oy: o.y, k });
  }
  raf = requestAnimationFrame(frame);
  map.on('move', () => { if (shown) { place(); moved = true; } });

  // ───────── the clock button ─────────
  // on the map, top right: the time, the date and the weather
  const btn = h('button', { id: 'skyBtn', class: 'skypill skycard', title: 'Date, time and weather', onclick: () => openClock() });
  document.body.append(btn);
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
    blizzard: '<path d="M7 12h10.5a3.6 3.6 0 0 0 .3-7.2A5.4 5.4 0 0 0 7 5.4a3.3 3.3 0 0 0 0 6.6z"/><path d="M3.5 15.5h10M6.5 18.5h11M9 21.3h6"/>',
    brush: '<path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M6 13l-2.2 2.2a2.6 2.6 0 0 0 0 3.7l1.3 1.3a2.6 2.6 0 0 0 3.7 0L11 18"/><path d="M16.8 2.2l5 5"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const weatherIcon = k => ({ clear: null, cloudy: 'cloudsun', overcast: 'overcast', fog: 'fog', rain: 'rain', storm: 'storm', snow: 'snow', blizzard: 'blizzard' })[k];
  function drawButton() {
    if (!cal) { btn.hidden = true; return; }
    btn.hidden = false;
    const sk = view();
    const sun = Cal.sun(sk.cal, sk.t), d = Cal.date(sk.cal, sk.t);
    const wi = weatherIcon(sk.weather.kind);
    const mon = (sk.cal.months[d.month] || {}).name || '';
    btn.innerHTML = `<span class="ci${wi ? ' w' : ''}">${wi ? svg(wi) : svg(sun.phase === 'night' ? 'moon' : sun.phase === 'day' ? 'sun' : 'dawn')}</span>`
      + `<span class="cl"><b>${Cal.clock(d)}</b><span>${d.day} ${mon.replace(/[<&>]/g, '')} ${String(d.yearText || d.year).replace(/[<&>]/g, '')}</span>`
      + `<em>${canLocal() && (local || gmStart()).weather === 'painted' && hasRegions() ? 'Weather as painted' : (Cal.WEATHER.find(w => w[0] === sk.weather.kind) || [])[1] || ''}</em></span>`;
    btn.title = `${Cal.label(sk.cal, sk.t)}${d.yearName ? ' · ' + d.yearName : ''}\n${Cal.clock(d)} · ${(Cal.WEATHER.find(w => w[0] === sk.weather.kind) || [])[1] || ''}`;
  }

  // ───────── the clock panel: your hour and weather; for admins the starting point for everyone, and the painter ─────────
  let panel = null;
  const api = (url, body, method) => fetch('/api/site' + url, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const send = p => p.then(c => setCalendar(c)).catch(e => toast(e.message, true));
  const PAINTED = ['painted', 'As the GM painted it'];
  const kindIcon = k => k === 'painted' ? 'brush' : k === 'clear' ? 'sun' : weatherIcon(k);
  const kindName = k => k === 'painted' ? PAINTED[1] : (Cal.WEATHER.find(w => w[0] === k) || [])[1] || '';
  const fmtH = hrs => { const m = Math.round(hrs * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  function openClock() {
    if (panel) { panel.remove(); panel = null; return; }
    panel = h('div', { class: 'skypanel' });
    document.body.append(panel);
    fillPanel();
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { panel.remove(); panel = null; document.removeEventListener('mousedown', off); } }), 0);
  }
  function fillPanel() {
    if (!panel || !cal) return;
    const own = canLocal(), sk = view(), d = Cal.date(sk.cal, sk.t), sun = Cal.sun(sk.cal, sk.t);
    const kids = [
      h('div', { class: 'skyhead' }, h('div', { class: 'skytime' }, Cal.clock(d)),
        h('div', null, h('b', null, Cal.label(sk.cal, sk.t)), h('div', { class: 'muted' }, [d.yearName, `sunrise ${fmtH(sun.rise)}`, `sunset ${fmtH(sun.set)}`].filter(Boolean).join(' · '))))
    ];
    if (own) {
      const lv = local || gmStart();
      const out = h('b', { class: 'skyhourval' }, fmtH(lv.hour));
      // dragging moves the sun as you go
      const slider = h('input', { type: 'range', min: 0, max: 23.75, step: 0.25, value: lv.hour, title: 'Time of day',
        oninput: e => { out.textContent = fmtH(+e.target.value); setLocal({ hour: +e.target.value }, true); }, onchange: () => fillPanel() });
      const kinds = (hasRegions() ? [PAINTED] : []).concat(Cal.WEATHER);
      const start = gmStart(), moved = !!local && (Math.abs(local.hour - start.hour) > 0.01 || local.weather !== start.weather);
      kids.push(
        h('div', { class: 'skyrowh' }, h('span', { class: 'ico', html: svg(Cal.sun(sk.cal, sk.t).phase === 'night' ? 'moon' : 'sun') }), slider, out),
        h('div', { class: 'wrow' }, ...kinds.map(([k, l]) => h('button', { class: 'wb' + (lv.weather === k ? ' on' : ''), title: l, 'aria-label': l, onclick: () => setLocal({ weather: k }), html: svg(kindIcon(k)) }))),
        h('div', { class: 'skysub' }, h('span', null, kindName(lv.weather)), h('span', { class: 'muted' }, ' · just on this screen'),
          moved ? h('button', { class: 'linkish', title: 'Back to the hour and weather the GM set', onclick: () => { local = null; try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* */ } look(); fillPanel(); } }, 'Reset') : null));
    } else kids.push(h('div', { class: 'skysub' }, h('span', null, kindName(cal.weather.kind)), h('span', { class: 'muted' }, ' · the campaign’s clock')));
    if (admin && own) {
      // what everyone sees the first time they open the map, and the weather painted on it
      const lv = local || gmStart();
      const yr = h('input', { type: 'number', value: d.year, title: 'Year' });
      const mo = h('select', { title: 'Month' }, ...cal.cal.months.map((m, i) => h('option', { value: i, selected: i === d.month || null }, m.name)));
      const dy = h('input', { type: 'number', min: 1, max: 400, value: d.day, title: 'Day' });
      const wind = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: cal.weather.wind, title: 'How windy', onchange: e => send(api('/calendar', { weather: { wind: +e.target.value } }, 'PUT')) });
      const dir = h('input', { type: 'range', min: 0, max: 359, step: 15, value: cal.weather.dir, title: 'Which way it blows', onchange: e => send(api('/calendar', { weather: { dir: +e.target.value } }, 'PUT')) });
      kids.push(h('div', { class: 'skygm' },
        h('div', { class: 'skygmh' }, 'GM'),
        h('div', { class: 'skygmrow' },
          h('button', { class: 'btn sm', onclick: () => paintWeather() }, h('span', { class: 'ico', html: svg('brush') }), hasRegions() ? `Paint weather (${cal.regions.length})` : 'Paint weather'),
          h('button', { class: 'btn sm', title: 'Everyone who opens the map for the first time starts at this hour and weather (and today\'s date below)',
            onclick: () => send(api('/calendar', Object.assign({ t: Cal.toT(cal.cal, +yr.value, +mo.value, Math.min(+dy.value || 1, cal.cal.months[+mo.value].days), Math.floor(lv.hour), Math.round((lv.hour % 1) * 60)) },
              lv.weather !== 'painted' ? { weather: { kind: lv.weather } } : {}), 'PUT')).then(() => toast('That’s where everyone starts now')) }, 'Everyone starts here')),
        h('div', { class: 'skygmrow' }, dy, mo, yr),
        h('div', { class: 'skygmrow wind' }, h('label', null, 'Wind', wind), h('label', null, 'Towards', dir))));
    }
    kids.push(h('div', { class: 'skyfoot' },
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: shown || null, onchange: e => { shown = e.target.checked; store.set('valanar-sky', shown); look(); } }), 'Night and weather'),
      h('a', { href: '#/calendar', onclick: () => { panel.remove(); panel = null; } }, 'Calendar ›')));
    panel.replaceChildren(...kids.filter(Boolean));
    const r = btn.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8)) + 'px'; panel.style.top = (r.bottom + 8) + 'px';
  }

  // ───────── the weather painter (admins): draw where it's raining, snowing, foggy… ─────────
  // Drag on the map to outline an area in the chosen weather (later ones on top); click an area to pick it, then a
  // weather to change it, or Delete. Everywhere else has the weather chosen at the end of the bar. Saving puts it on
  // the map for everyone whose weather is "as the GM painted it" (everyone, the first time they come).
  const PCOL = { clear: '#ffd76a', cloudy: '#c3d0e0', overcast: '#7f8ba0', fog: '#e9ecf1', rain: '#4c8fe6', storm: '#8b5cf6', snow: '#f5f9ff', blizzard: '#7fdcff' };
  let painter = null;
  function paintWeather() {
    if (painter || !admin || !cal || !ctx.toLatLng) return;
    if (panel) { panel.remove(); panel = null; }
    const P = painter = { regions: JSON.parse(JSON.stringify(cal.regions || [])), kind: 'rain', base: cal.weather.kind, sel: null, undo: [], mode: 'draw' };
    paintDraft = P.regions;
    const pane = map.getPane('skyPaint') || map.createPane('skyPaint'); pane.style.zIndex = 460;
    const group = L.layerGroup().addTo(map);
    const bar = h('div', { class: 'wpaint' });
    document.body.append(bar); document.body.classList.add('painting-weather');
    const snap = () => { P.undo.push(JSON.stringify(P.regions)); if (P.undo.length > 100) P.undo.shift(); };
    const changed = () => { paintDraft = P.regions; rast = null; redraw(); drawBar(); };
    let justDrew = false;
    function redraw() {
      group.clearLayers();
      for (const r of P.regions) {
        const ll = []; for (let j = 0; j < r.pts.length; j += 2) ll.push(ctx.toLatLng(r.pts[j], r.pts[j + 1]));
        const on = r === P.sel;
        const pg = L.polygon(ll, { pane: 'skyPaint', color: on ? '#ffd36b' : PCOL[r.kind], weight: on ? 3 : 1.6, dashArray: on ? null : '6 5', fillColor: PCOL[r.kind], fillOpacity: on ? 0.28 : 0.14, bubblingMouseEvents: false });
        pg.on('click', e => { L.DomEvent.stop(e); if (justDrew) return; P.sel = on ? null : r; redraw(); drawBar(); });
        pg.bindTooltip(kindName(r.kind), { sticky: true, direction: 'top' });
        group.addLayer(pg);
      }
    }
    const kindBtn = (k, l) => h('button', { class: 'wb' + ((P.sel ? P.sel.kind : P.kind) === k ? ' on' : ''), title: l, style: `--pc:${PCOL[k]}`, html: svg(kindIcon(k)),
      onclick: () => { if (P.sel) { snap(); P.sel.kind = k; changed(); } else { P.kind = k; drawBar(); } } });
    function drawBar() {
      const base = h('select', { title: 'The weather everywhere you haven’t painted', onchange: e => { P.base = e.target.value; drawBar(); look(); } },
        ...Cal.WEATHER.map(([k, l]) => h('option', { value: k, selected: P.base === k || null }, l)));
      bar.replaceChildren(...[
        h('b', null, 'Weather painter'),
        h('div', { class: 'wrow' }, ...Cal.WEATHER.map(([k, l]) => kindBtn(k, l))),
        h('span', { class: 'wpsep' }),
        h('button', { class: 'btn sm' + (P.mode === 'draw' ? ' on' : ''), title: 'Drag on the map to outline an area (hold Space to move the map)', onclick: () => { P.mode = 'draw'; mode(); drawBar(); } }, 'Draw'),
        h('button', { class: 'btn sm' + (P.mode === 'move' ? ' on' : ''), title: 'Move the map', onclick: () => { P.mode = 'move'; mode(); drawBar(); } }, 'Move'),
        P.sel ? h('button', { class: 'btn sm', title: 'Remove the picked area (Delete)', onclick: () => del() }, 'Remove area') : null,
        h('button', { class: 'btn sm', title: 'Undo (Ctrl+Z)', disabled: !P.undo.length || null, onclick: () => undo() }, 'Undo'),
        P.regions.length ? h('button', { class: 'btn sm', title: 'Remove every area', onclick: () => { if (!confirm('Remove all the painted weather?')) return; snap(); P.regions.length = 0; P.sel = null; changed(); } }, 'Clear') : null,
        h('span', { class: 'wpsep' }),
        h('label', { class: 'wpbase' }, 'Elsewhere', base),
        h('span', { class: 'wpsep' }),
        h('button', { class: 'btn sm primary', onclick: () => save() }, 'Save'),
        h('button', { class: 'btn sm', onclick: () => close() }, 'Cancel'),
        h('div', { class: 'wphint' }, P.sel ? 'Area picked: choose a weather to change it, or Remove.' : `Drag on the map to paint ${kindName(P.kind).toLowerCase()}. Click an area to pick it. Hold Space to move the map.`)].filter(Boolean));
    }
    function del() { if (!P.sel) return; snap(); P.regions.splice(P.regions.indexOf(P.sel), 1); P.sel = null; changed(); }
    function undo() { if (!P.undo.length) return; P.regions = JSON.parse(P.undo.pop()); P.sel = null; changed(); }
    // drawing: a drag outlines an area, simplified to a few points
    const el = map.getContainer();
    let line = null, pts = null, start = null, space = false;
    const mode = () => { const draw = P.mode === 'draw' && !space; if (draw) map.dragging.disable(); else map.dragging.enable(); el.classList.toggle('wpdraw', draw); };
    const mpx = e => { const p = ctx.toPixel(map.mouseEventToLatLng(e)); return [p.x, p.y]; };
    const down = e => {
      if (P.mode !== 'draw' || space || e.button !== 0 || e.target.closest('.leaflet-control, .wpaint')) return;
      start = [e.clientX, e.clientY]; pts = [mpx(e)]; line = null;
    };
    const move = e => {
      if (!pts) return;
      const last = pts.__lastScreen || start;
      if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 5) return;
      pts.__lastScreen = [e.clientX, e.clientY]; pts.push(mpx(e));
      const ll = pts.map(p => ctx.toLatLng(p[0], p[1]));
      if (!line) line = L.polyline(ll, { pane: 'skyPaint', color: PCOL[P.kind], weight: 2.5, interactive: false }).addTo(map); else line.setLatLngs(ll);
    };
    const up = () => {
      if (!pts) return;
      const got = pts; pts = null; if (line) { line.remove(); line = null; }
      if (got.length < 6) return;
      justDrew = true; setTimeout(() => { justDrew = false; }, 50);
      const k = Math.pow(2, NATIVE - map.getZoom());   // map px per screen px
      const simple = simplify(got, 3 * k);
      if (simple.length < 3) return;
      snap(); P.regions.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: P.kind, pts: simple.flat().map(Math.round) }); P.sel = null; changed();
    };
    const key = e => {
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      if (e.code === 'Space' && !space && e.type === 'keydown') { space = true; mode(); e.preventDefault(); }
      else if (e.code === 'Space' && e.type === 'keyup') { space = false; mode(); }
      else if (e.type === 'keydown' && (e.key === 'Delete' || e.key === 'Backspace') && P.sel) { e.preventDefault(); del(); }
      else if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      else if (e.type === 'keydown' && e.key === 'Escape') { if (P.sel) { P.sel = null; redraw(); drawBar(); } }
    };
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key); window.addEventListener('keyup', key);
    map.on('click', () => { if (P.sel && !justDrew) { P.sel = null; redraw(); drawBar(); } });
    function close() {
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key);
      map.dragging.enable(); el.classList.remove('wpdraw');
      group.remove(); bar.remove(); document.body.classList.remove('painting-weather');
      painter = null; paintDraft = null; rast = null; look();
    }
    function save() {
      api('/calendar', { regions: P.regions, weather: { kind: P.base } }, 'PUT').then(c => {
        close(); setCalendar(c);
        setLocal({ weather: 'painted' });   // and you see it as everyone will
        toast(c.regions.length ? `Weather painted: ${c.regions.length} area${c.regions.length === 1 ? '' : 's'}` : 'The painted weather is gone');
      }).catch(e => toast(e.message, true));
    }
    mode(); redraw(); drawBar(); look();
  }
  // Ramer–Douglas–Peucker: the outline with only the points that matter
  function simplify(pts, eps) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let best = -1, bd = eps;
      const [ax, ay] = pts[a], [bx, by] = pts[b], L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i], t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
        const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  function setCalendar(c) {
    if (!c || !c.cal) return;
    cal = c;
    if (canLocal() && !local) { local = gmStart(); saveLocal(); }   // the first time: where the GM set it
    look(); fillPanel();
    if (ctx.onCalendar) ctx.onCalendar(cal);
  }
  async function load() {
    try { const r = await fetch('/api/site/calendar', { credentials: 'same-origin' }); if (r.ok) { const c = await r.json(); if (!pushed) setCalendar(c); } } catch (e) { /* offline: no sky */ }
  }
  if (SV && Cal) {
    if (!ctx.scene) load();   // a world map scene in the table: the campaign's clock is pushed in
    // on its own (not inside the table, which pushes changes), check now and then
    setInterval(() => { if (!document.hidden && !pushed) load(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !pushed) load(); });
  }
  // the table pushes a campaign's clock in (pushed); siteClock() goes back to the world's own
  // the kind of weather at a point of the map, as this screen shows it (painted regions, or the one sky)
  function weatherKind(x, y) {
    const sk = view(); if (!sk) return null;
    const fn = kindAt(), k = fn ? fn(x, y) : null;
    return k || (sk.weather && sk.weather.kind) || null;
  }
  return { preview: p => { preview = p && (p.hour != null || p.weather) ? p : null; if (cal) look(); }, weatherAt: (x, y) => (fx && fx.sample ? fx.sample(x, y) : null), weatherKind, get dark() { return darkNow; }, setCalendar, get calendar() { return cal; }, get pushed() { return pushed; }, openClock, reload: load,
    push: c => { pushed = true; setCalendar(c); }, siteClock: () => { pushed = false; return load(); } };
};
