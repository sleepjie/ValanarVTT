/* Tales: journeys across the world map, told stop by stop. And Drift: the map wandering on its own.
 *
 * A tale is a string of stops. At each, the map flies to a place, the hour and the weather can change (for this
 * screen only), the borders can show, a pin can mark the spot, and a caption tells what's there. Admins make them
 * (the Tales panel, from the hotbar's book); everyone can watch them, and an address plays one straight away:
 * #/tale/<id> (or #/tale/<id>/<stop>). While a tale plays the screen goes cinematic: bars top and bottom, the
 * caption below, ← → or the buttons to move through it, and Auto to let it tell itself.
 *
 * Drift (#/drift) needs no making: the camera drifts from place to place on its own (the nations, the great cities,
 * the places with pages), the day turning as it goes and the weather changing now and then, with each place's name
 * and the start of its page. Everything else is hidden: made for a screen on the wall on a game night.
 * F goes full screen; Esc stops it.
 *
 * Tales live on the server (/api/site/tours); see server/site.js.
 * ValanarTales(ctx) → { route(hash), play(id, i), stop(), drift(), state(), follow(state), playing() } */
'use strict';
window.ValanarTales = function (ctx) {
  const { map, h, toast, toLatLng, toPixel } = ctx;
  const SV = window.VALANAR_SERVER || {};
  const admin = !!SV.admin;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const Cal = window.WorldCalendar;
  const WEATHER = Cal ? Cal.WEATHER : [['clear', 'Clear'], ['cloudy', 'Some cloud'], ['overcast', 'Overcast'], ['fog', 'Fog'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow'], ['blizzard', 'Blizzard']];
  const HOURS = [['', 'As it is'], ['6', 'Dawn'], ['9', 'Morning'], ['12', 'Noon'], ['16', 'Afternoon'], ['19.5', 'Dusk'], ['22', 'Night'], ['2', 'Small hours']];
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));   // (null would show as text)
  let tours = [], loaded = false, loading = null;
  let draft = null, dirty = false, openStop = 0;

  const api = (url, body, method) => fetch('/api/site' + url, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  function load(force) {
    if (loading && !force) return loading;
    loading = fetch('/api/site/tours', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { tours: [] })
      .then(j => { tours = Array.isArray(j.tours) ? j.tours : []; loaded = true; if (ctx.panelMode() === 'tales') ctx.renderPanel(); return tours; })
      .catch(() => { loaded = true; return tours; });
    return loading;
  }
  const uid = () => 't' + Math.random().toString(36).slice(2, 10);
  const here = () => { const c = toPixel(map.getCenter()); return { x: Math.round(c.x), y: Math.round(c.y), z: +map.getZoom().toFixed(2) }; };

  // ───────── the panel: the tales, and (admins) making them ─────────
  function render() {
    if (!loaded) { load(); return ctx.panelShell('Tales', h('p', { class: 'muted' }, 'Opening the book of tales…')); }
    if (draft) return editor();
    const list = tours.filter(t => t.stops && t.stops.length || admin);
    return ctx.panelShell('Tales',
      h('p', { class: 'small muted' }, 'Journeys across the map, told stop by stop: the map flies from place to place, the hour and the weather change, and a caption tells you what’s there.'),
      h('div', { class: 'talebig' },
        h('button', { class: 'btn primary', onclick: () => drift(), title: 'The map wanders from place to place on its own, the day turning as it goes (Esc to stop, F for full screen)' }, '✦ Drift'),
        h('span', { class: 'small muted' }, 'Let the map wander on its own: for a screen on the wall.')),
      h('h2', null, `The tales${list.length ? ' · ' + list.length : ''}`),
      list.length ? h('div', { class: 'talelist' }, ...list.map(t => h('div', { class: 'talerow' },
        h('div', { class: 'tt' }, h('b', null, t.title), t.gmOnly ? h('span', { class: 'gmbadge' }, 'GM only') : null,
          h('div', { class: 'small muted' }, `${t.stops.length} stop${t.stops.length === 1 ? '' : 's'}${t.about ? ' · ' + t.about : ''}`)),
        h('div', { class: 'btnrow' },
          t.stops.length ? h('button', { class: 'btn sm primary', onclick: () => play(t.id, 0) }, '▶ Play') : null,
          admin ? h('button', { class: 'btn sm', onclick: () => { draft = JSON.parse(JSON.stringify(t)); dirty = false; openStop = 0; ctx.renderPanel(); } }, 'Edit') : null,
          h('button', { class: 'btn sm', title: 'Copy a link that plays this tale', onclick: () => copyLink(t) }, 'Link'))))) :
        h('p', { class: 'muted' }, admin ? 'No tales yet. Start one: go to the first place, then “New tale”.' : 'No tales have been told yet.'),
      admin ? h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { draft = { id: uid(), title: '', about: '', gmOnly: false, stops: [Object.assign(here(), { title: '', text: '' })] }; dirty = true; openStop = 0; ctx.renderPanel(); } }, '+ New tale (starting here)')) : null);
  }
  function copyLink(t) {
    const url = location.origin + location.pathname + '#/tale/' + t.id;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied: it plays “' + t.title + '”'), () => prompt('The link to this tale', url));
  }
  function editor() {
    const d = draft;
    const mark = () => { dirty = true; };
    const field = (label, el) => h('div', null, h('label', null, label), el);
    const stops = d.stops.map((s, i) => {
      const open = i === openStop;
      const head = h('div', { class: 'stophead', onclick: () => { openStop = open ? -1 : i; ctx.renderPanel(); } },
        h('span', { class: 'n' }, i + 1), h('b', null, s.title || h('i', { class: 'muted' }, 'A stop')),
        h('span', { class: 'sp' }), h('button', { class: 'linkbtn', title: 'Fly there', onclick: e => { e.stopPropagation(); map.flyTo(toLatLng(s.x, s.y), s.z, { duration: 1.2 }); } }, 'Go'));
      if (!open) return h('div', { class: 'stopcard' }, head);
      const hourSel = h('select', { onchange: e => { if (e.target.value === '') delete s.hour; else s.hour = +e.target.value; mark(); } },
        ...HOURS.map(([v, l]) => h('option', { value: v, selected: (s.hour == null ? '' : String(s.hour)) === v || null }, l)),
        s.hour != null && !HOURS.some(x => x[0] === String(s.hour)) ? h('option', { value: s.hour, selected: true }, `${s.hour}:00`) : null);
      const wSel = h('select', { onchange: e => { if (!e.target.value) delete s.weather; else s.weather = e.target.value; mark(); } },
        h('option', { value: '' }, 'As it is'), ...WEATHER.map(([k, l]) => h('option', { value: k, selected: s.weather === k || null }, l)));
      const move = dir => { const j = i + dir; if (j < 0 || j >= d.stops.length) return; [d.stops[i], d.stops[j]] = [d.stops[j], d.stops[i]]; openStop = j; mark(); ctx.renderPanel(); };
      return h('div', { class: 'stopcard open' }, head,
        h('div', { class: 'form' },
          field('Title', h('input', { value: s.title || '', placeholder: 'Where we are, or what happened here', oninput: e => { s.title = e.target.value; mark(); } })),
          field('What to say (the wiki’s formatting works: [[links]], **bold**…)', h('textarea', { rows: 5, value: s.text || '', oninput: e => { s.text = e.target.value; mark(); } })),
          h('div', { class: 'row' }, field('The hour', hourSel), field('The weather', wSel)),
          h('div', null,
            h('label', { class: 'inline', style: 'margin-right:12px' }, h('input', { type: 'checkbox', checked: s.borders || null, onchange: e => { s.borders = e.target.checked; mark(); } }), 'Show the borders'),
            h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.pin || null, onchange: e => { s.pin = e.target.checked; mark(); } }), 'Mark the spot')),
          field('Move on by itself after (seconds; empty: wait for Next)', h('input', { type: 'number', min: 1, max: 600, value: s.hold || '', onchange: e => { const v = +e.target.value; if (v > 0) s.hold = v; else delete s.hold; mark(); } })),
          h('div', { class: 'btnrow' },
            h('button', { class: 'btn sm', title: 'This stop looks where the map is looking now', onclick: () => { Object.assign(s, here()); mark(); toast('This stop now looks here.'); ctx.renderPanel(); } }, '◎ Use this view'),
            h('button', { class: 'btn sm', onclick: () => play(d, i, { preview: true }) }, '▶ From here'),
            h('button', { class: 'btn sm', disabled: i === 0 || null, onclick: () => move(-1) }, '↑'),
            h('button', { class: 'btn sm', disabled: i === d.stops.length - 1 || null, onclick: () => move(1) }, '↓'),
            h('button', { class: 'btn sm danger', onclick: () => { d.stops.splice(i, 1); openStop = Math.min(i, d.stops.length - 1); mark(); ctx.renderPanel(); } }, 'Delete'))));
    });
    const save = async () => {
      if (!d.stops.length) { toast('A tale needs a stop at least.', true); return; }
      const next = tours.some(t => t.id === d.id) ? tours.map(t => t.id === d.id ? d : t) : tours.concat([d]);
      try { const j = await api('/tours', { tours: next }, 'PUT'); tours = j.tours || next; dirty = false; toast('Saved: “' + (d.title || 'A tale') + '”'); draft = JSON.parse(JSON.stringify(tours.find(t => t.id === d.id) || d)); ctx.renderPanel(); }
      catch (e) { toast('Couldn’t save the tale: ' + e.message, true); }
    };
    const del = async () => {
      if (!confirm(`Delete the tale “${d.title || 'A tale'}”? (The server keeps a backup.)`)) return;
      try { const j = await api('/tours', { tours: tours.filter(t => t.id !== d.id) }, 'PUT'); tours = j.tours || []; draft = null; dirty = false; ctx.renderPanel(); }
      catch (e) { toast('Couldn’t delete it: ' + e.message, true); }
    };
    return ctx.panelShell(tours.some(t => t.id === d.id) ? 'Edit the tale' : 'A new tale',
      h('div', { class: 'form' },
        field('Its title', h('input', { value: d.title, placeholder: 'The Long Road to Vitgaard', oninput: e => { d.title = e.target.value; mark(); } })),
        field('A line about it (optional)', h('input', { value: d.about || '', oninput: e => { d.about = e.target.value; mark(); } })),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: d.gmOnly || null, onchange: e => { d.gmOnly = e.target.checked; mark(); } }), 'GM only (players don’t see it)')),
      h('h2', null, `The stops · ${d.stops.length}`),
      h('p', { class: 'small muted' }, 'Each stop looks where the map was looking when you made it: move the map, then “Use this view”. The hour and the weather carry on to the next stops until one changes them.'),
      h('div', { class: 'stoplist' }, ...stops),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { d.stops.push(Object.assign(here(), { title: '', text: '' })); openStop = d.stops.length - 1; mark(); ctx.renderPanel(); } }, '+ A stop here')),
      h('div', { class: 'btnrow taleact' },
        h('button', { class: 'btn primary', onclick: save }, dirty ? 'Save' : 'Saved'),
        h('button', { class: 'btn', onclick: () => play(d, 0, { preview: true }) }, '▶ Play it'),
        h('button', { class: 'btn', onclick: () => { if (dirty && !confirm('Leave without saving?')) return; draft = null; dirty = false; ctx.renderPanel(); } }, 'Close'),
        tours.some(t => t.id === d.id) ? h('button', { class: 'btn danger', onclick: del }, 'Delete') : null));
  }
  ctx.registerPanel('tales', { render, closed: () => { /* a draft stays until closed in the panel */ } });

  // ───────── the cinema: playing a tale ─────────
  let P = null;   // { tour, i, auto, ui, pin, prevBorders, timers }
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.clear(); };
  let prevSnap = null, interrupting = null;
  function cinemaOn() {
    if (prevSnap == null) prevSnap = map.options.zoomSnap;
    map.options.zoomSnap = 0;   // the camera eases between zoom levels
    if (!interrupting) {
      interrupting = () => { if (P || D) { map.stop(); clearKen(); } };
      const el = map.getContainer();
      el.addEventListener('mousedown', interrupting, true); el.addEventListener('wheel', interrupting, { capture: true, passive: true }); el.addEventListener('touchstart', interrupting, { capture: true, passive: true });
    }
  }
  function cinemaOff() {
    if (prevSnap != null) { map.options.zoomSnap = prevSnap; prevSnap = null; }
    if (interrupting) { const el = map.getContainer(); el.removeEventListener('mousedown', interrupting, true); el.removeEventListener('wheel', interrupting, { capture: true }); el.removeEventListener('touchstart', interrupting, { capture: true }); interrupting = null; }
    ctx.skyPreview(null);
  }
  // a slow push in while a stop is held (stopped by any touch of the map)
  let ken = null;
  function kenBurns(secs, z0) {
    clearKen();
    const c = map.getCenter(), s = map.getSize(), ang = Math.random() * Math.PI * 2;
    const to = map.containerPointToLatLng([s.x / 2 + Math.cos(ang) * s.x * 0.04, s.y / 2 + Math.sin(ang) * s.y * 0.04]);
    ken = later(() => { ken = null; map.flyTo(to, clamp((z0 != null ? z0 : map.getZoom()) + 0.35, map.getMinZoom(), map.getMaxZoom()), { duration: secs }); }, 60);
    void c;
  }
  function clearKen() { if (ken) { clearTimeout(ken); timers.delete(ken); ken = null; } }
  // fly there: longer the further it is, never so short it jumps
  function flyTo(x, y, z, minS, maxS) {
    const ll = toLatLng(x, y), a = map.latLngToContainerPoint(ll), s = map.getSize();
    const far = Math.hypot(a.x - s.x / 2, a.y - s.y / 2) / Math.max(s.x, s.y) + Math.abs(z - map.getZoom()) * 0.35;
    const secs = clamp(1.2 + far * 1.6, minS, maxS);
    map.stop();
    map.flyTo(ll, z, { duration: secs });
    return secs;
  }

  function play(t, i, opts) {
    if (typeof t === 'string') { const id = t; t = tours.find(x => x.id === id); if (!t) { load().then(() => { const t2 = tours.find(x => x.id === id); if (t2) play(t2, i, opts); else toast('That tale isn’t here (or it’s for the GM).', true); }); return; } }
    if (!t || !t.stops || !t.stops.length) { toast('That tale has no stops yet.', true); return; }
    if (D) stopDrift(true);
    opts = opts || {};
    if (P && P.hooks && P.hooks !== opts.hooks && P.hooks.stop) { const old = P.hooks; P.hooks = null; try { old.stop(); } catch (e) { console.warn(e); } }
    if (!P) {
      P = { tour: t, i: 0, auto: false, prevBorders: ctx.bordersOn(), preview: !!opts.preview };
      ctx.closePanel(); ctx.showMap();
      cinemaOn(); buildUI();
      document.body.classList.add('tale-on');
      map.invalidateSize({ pan: false });   // the whole screen is the map's while the tale is told
    }
    // a tale made on the spot (the way from one place to another, app/reach.js) is the page's own: no address, nobody
    // follows it, and it can hang things on the stops (hooks: go(i), arrive(i), stop()) and say how long each stays
    P.tour = t; P.preview = !!opts.preview; P.local = !!opts.local; P.hooks = opts.hooks || null; P.holdFor = opts.holdFor || null;
    P.badge = opts.badge != null ? opts.badge : null;
    if (opts.auto) P.auto = true;
    if (!P.preview && !P.local && /^#\/tale\//.test(location.hash) === false) history.replaceState(null, '', '#/tale/' + t.id);
    go(i || 0);
  }
  // the hour and the weather in force at a stop: the last ones set at or before it
  function skyAt(t, i) {
    let hour = null, weather = null;
    for (let j = 0; j <= i; j++) { const s = t.stops[j]; if (s.hour != null) hour = s.hour; if (s.weather) weather = s.weather; }
    return hour == null && weather == null ? null : Object.assign({}, hour != null ? { hour } : {}, weather ? { weather } : {});
  }
  let pin = null;
  function setPin(s) {
    if (pin) { pin.remove(); pin = null; }
    if (!s || !s.pin) return;
    pin = window.L.marker(toLatLng(s.x, s.y), { interactive: false, keyboard: false, zIndexOffset: 2000,
      icon: window.L.divIcon({ className: 'talepin', html: '<i></i><i></i><b></b>', iconSize: [0, 0] }) }).addTo(map);
  }
  function go(i) {
    if (!P) return;
    const t = P.tour; i = clamp(i, 0, t.stops.length - 1); P.i = i; P.arrived = false;
    const s = t.stops[i];
    clearTimers(); clearKen();
    ctx.skyPreview(skyAt(t, i));
    ctx.setBorders(!!s.borders);
    setPin(null);
    showCaption(null);
    const secs = flyTo(s.x, s.y, s.z, 1.2, 4.5);
    if (P.hooks && P.hooks.go) try { P.hooks.go(i, secs); } catch (e) { console.warn(e); }
    later(() => arrive(i), secs * 1000 + 150);
    drawUI();
    if (ctx.onTale && !P.local) ctx.onTale(state());
  }
  function arrive(i) {
    if (!P || P.i !== i) return;
    const s = P.tour.stops[i];
    P.arrived = true;
    setPin(s);
    showCaption(s);
    if (P.hooks && P.hooks.arrive) try { P.hooks.arrive(i); } catch (e) { console.warn(e); }
    const words = String(s.text || '').split(/\s+/).length;
    const hold = s.hold || (P.auto ? (P.holdFor ? P.holdFor(s, i) : clamp(6 + words / 3.2, 7, 40)) : 0);
    kenBurns(hold || 24, s.z);
    if (hold && (P.auto || s.hold)) {
      P.until = Date.now() + hold * 1000; P.holdMs = hold * 1000;
      later(() => { if (P && P.i === i) { if (i < P.tour.stops.length - 1) go(i + 1); else theEnd(); } }, hold * 1000);
    } else P.until = 0;
    drawUI();
  }
  function theEnd() {
    if (!P) return;
    clearTimers(); P.until = 0; P.ended = true;
    showCaption({ title: 'The end', text: '', end: true });
    drawUI();
  }
  let ui = null;
  function buildUI() {
    ui = {};
    ui.root = h('div', { id: 'tale', class: 'tale' },
      h('div', { class: 'letter top' }), h('div', { class: 'letter bot' }),
      ui.title = h('div', { class: 'taletitle' }),
      ui.cap = h('div', { class: 'talecap' }),
      ui.bar = h('div', { class: 'talebar' },
        ui.prev = h('button', { title: 'Back (←)', onclick: () => go(P.i - 1) }, '‹'),
        ui.count = h('span', { class: 'cnt' }),
        ui.next = h('button', { title: 'On (→ or Space)', onclick: () => next() }, '›'),
        ui.auto = h('button', { class: 'auto', title: 'Let it tell itself (A)', onclick: () => { P.auto = !P.auto; if (P.auto && P.arrived) arrive(P.i); drawUI(); } }, 'Auto'),
        ui.prog = h('i', { class: 'prog' }),
        h('button', { class: 'x', title: 'Stop (Esc)', onclick: () => stop() }, '×')));
    document.body.append(ui.root);
    requestAnimationFrame(() => ui.root.classList.add('on'));
    document.addEventListener('keydown', keys, true);
    ui.tick = setInterval(() => { if (P && P.until) { const f = 1 - clamp((P.until - Date.now()) / P.holdMs, 0, 1); ui.prog.style.transform = `scaleX(${f})`; } else if (ui) ui.prog.style.transform = 'scaleX(0)'; }, 100);
  }
  function next() { if (!P) return; if (P.ended) { stop(); return; } if (P.i < P.tour.stops.length - 1) go(P.i + 1); else theEnd(); }
  function drawUI() {
    if (!ui || !P) return;
    const n = P.tour.stops.length;
    fill(ui.title, h('span', null, P.tour.title || 'A tale'), P.badge ? h('em', null, ' · ' + P.badge) : P.badge == null && P.preview ? h('em', null, ' · preview') : null);
    ui.count.textContent = P.ended ? 'The end' : `${P.i + 1} of ${n}`;
    ui.prev.disabled = P.i === 0 && !P.ended;
    ui.auto.classList.toggle('on', !!P.auto);
  }
  function showCaption(s) {
    if (!ui) return;
    ui.cap.classList.remove('on');
    if (!s) return;
    later(() => {
      if (!ui) return;
      const body = s.text ? (() => { try { return ctx.renderMarkdown(s.text); } catch (e) { return h('p', null, s.text); } })() : null;
      ui.cap.replaceChildren(...[s.title ? h('h2', null, s.title) : null, body ? h('div', { class: 'tbody' }, body) : null,
        s.end ? h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { P.ended = false; go(0); } }, 'From the start'), h('button', { class: 'btn primary', onclick: () => stop() }, 'Close')) : null].filter(Boolean));
      ui.cap.classList.toggle('empty', !s.title && !s.text && !s.end);
      ui.cap.classList.add('on');
    }, 120);
  }
  function keys(e) {
    if (!P || ctx.isTyping()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); }
    else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(P.i - 1); }
    else if (e.key === 'a' || e.key === 'A') { P.auto = !P.auto; if (P.auto && P.arrived) arrive(P.i); drawUI(); }
  }
  function stop(quiet) {
    if (!P) return;
    clearTimers(); clearKen(); map.stop();
    setPin(null);
    ctx.setBorders(P.prevBorders);
    document.body.classList.remove('tale-on');
    map.invalidateSize({ pan: false });
    document.removeEventListener('keydown', keys, true);
    if (ui) { clearInterval(ui.tick); const r = ui.root; r.classList.remove('on'); setTimeout(() => r.remove(), 500); ui = null; }
    const wasPreview = P.preview, hooks = P.hooks, local = P.local;
    P = null;
    cinemaOff();
    if (/^#\/tale\//.test(location.hash)) history.replaceState(null, '', '#/map');
    if (wasPreview && draft) ctx.openPanel('tales');
    if (ctx.onTale && !quiet && !local) ctx.onTale(null);
    if (hooks && hooks.stop) try { hooks.stop(); } catch (e) { console.warn(e); }
  }

  // ───────── Drift ─────────
  let D = null;
  function drift() {
    if (P) stop(true);
    if (D) return;
    const places = ctx.driftPlaces();
    if (!places.length) { toast('There’s nowhere on the map to drift to yet.', true); return; }
    ctx.closePanel(); ctx.showMap();
    const sky = ctx.sky && ctx.sky();
    const cur = sky && sky.calendar && Cal ? Cal.date(sky.calendar.cal, sky.calendar.t) : null;
    D = { places, recent: [], hour: cur ? cur.hour + cur.minute / 60 : 10, weather: 'clear', n: 0, paused: false };
    cinemaOn();
    document.body.classList.add('drift-on');
    map.invalidateSize({ pan: false });   // the whole screen is the map's now
    D.ui = h('div', { id: 'drift', class: 'drift' },
      D.cap = h('div', { class: 'driftcap' }),
      D.hint = h('div', { class: 'drifthint' }, 'Drifting · Esc to stop · F for full screen · Space to pause'));
    document.body.append(D.ui);
    requestAnimationFrame(() => D && D.ui.classList.add('on'));
    let hintT = setTimeout(() => D && D.hint.classList.add('gone'), 4000);
    D.onMove = () => { if (!D) return; D.hint.classList.remove('gone'); document.body.classList.add('drift-cursor'); clearTimeout(hintT); hintT = setTimeout(() => { if (D) { D.hint.classList.add('gone'); document.body.classList.remove('drift-cursor'); } }, 2500); };
    document.addEventListener('mousemove', D.onMove);
    document.addEventListener('keydown', driftKeys, true);
    if (!/^#\/drift/.test(location.hash)) history.replaceState(null, '', '#/drift');
    driftNext(true);
  }
  function driftKeys(e) {
    if (!D) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopDrift(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fullscreen(); }
    else if (e.key === ' ') { e.preventDefault(); D.paused = !D.paused; D.hint.textContent = D.paused ? 'Paused · Space to carry on' : 'Drifting · Esc to stop · F for full screen · Space to pause'; D.hint.classList.remove('gone'); if (!D.paused) driftNext(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); driftNext(); }
  }
  function fullscreen() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => toast('This browser wouldn’t go full screen.', true));
  }
  // the weather drifts too: mostly fair, now and then something else
  const WEIGHTS = [['clear', 5], ['cloudy', 4], ['overcast', 2], ['rain', 2], ['fog', 1.2], ['storm', 0.7], ['snow', 0.8]];
  const pickWeather = () => { let r = Math.random() * WEIGHTS.reduce((s, w) => s + w[1], 0); for (const [k, w] of WEIGHTS) { if ((r -= w) <= 0) return k; } return 'clear'; };
  function driftNext(first) {
    if (!D || D.paused) return;
    clearTimers(); clearKen();
    const c = toPixel(map.getCenter());
    // mostly on to somewhere near; now and then right across the world
    const fresh = D.places.filter(p => !D.recent.includes(p.key));
    const pool = fresh.length ? fresh : D.places;
    let pick;
    if (first || D.n % 6 === 5) pick = pool[Math.floor(Math.random() * pool.length)];
    else {
      const near = pool.map(p => [p, Math.hypot(p.x - c.x, p.y - c.y)]).filter(([, d]) => d > 300).sort((a, b) => a[1] - b[1]).slice(0, 5);
      pick = (near.length ? near[Math.floor(Math.random() * near.length)][0] : pool[0]);
    }
    D.recent.push(pick.key); if (D.recent.length > Math.min(40, Math.floor(D.places.length * 0.7))) D.recent.shift();
    D.n++;
    D.hour = (D.hour + 0.9 + Math.random() * 0.8) % 24;
    if (first || D.n % 5 === 0) D.weather = pickWeather();
    ctx.skyPreview({ hour: Math.round(D.hour * 4) / 4, weather: D.weather });
    driftCaption(null);
    const secs = flyTo(pick.x, pick.y, pick.z, 3.5, 8.5);
    later(() => {
      if (!D) return;
      driftCaption(pick);
      kenBurns(11, pick.z);
      later(() => driftNext(), 11500);
    }, secs * 1000 + 200);
  }
  function driftCaption(p) {
    if (!D) return;
    D.cap.classList.remove('on');
    if (!p) return;
    later(() => {
      if (!D) return;
      D.cap.replaceChildren(...[p.arms ? h('div', { class: 'darms', html: p.arms }) : null,
        h('div', { class: 'dtx' }, p.sub ? h('div', { class: 'dsub' }, p.sub) : null, h('div', { class: 'dname' }, p.title), p.text ? h('p', null, p.text) : null)].filter(Boolean));
      D.cap.classList.add('on');
    }, 300);
  }
  function stopDrift(quiet) {
    if (!D) return;
    clearTimers(); clearKen(); map.stop();
    document.removeEventListener('keydown', driftKeys, true);
    document.removeEventListener('mousemove', D.onMove);
    document.body.classList.remove('drift-on', 'drift-cursor');
    map.invalidateSize({ pan: false });
    const r = D.ui; r.classList.remove('on'); setTimeout(() => r.remove(), 600);
    D = null;
    cinemaOff();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (/^#\/drift/.test(location.hash)) history.replaceState(null, '', '#/map');
    void quiet;
  }

  // ───────── for the address bar, the presence (following the GM), the rest of the page ─────────
  function state() { return P && !P.local ? { id: P.tour.id, i: P.i, playing: true } : null; }
  function follow(s) {
    if (!s) { if (P) stop(true); return; }
    if (P && P.tour.id === s.id) { if (P.i !== s.i) go(s.i); return; }
    load().then(() => play(s.id, s.i));
  }
  function route(hash) {
    let m = /^#\/tale\/([a-z0-9_-]+)(?:\/(\d+))?/i.exec(hash);
    if (m) { load().then(() => play(m[1], m[2] ? +m[2] - 1 : 0)); return true; }
    if (/^#\/drift/.test(hash)) { drift(); return true; }
    return false;
  }
  function leave() { if (P) stop(true); if (D) stopDrift(true); }
  if (SV.user || SV.publicView || SV.admin) load();
  return { route, play, stop, drift, stopDrift, state, follow, leave, playing: () => !!(P || D), tours: () => tours };
};
