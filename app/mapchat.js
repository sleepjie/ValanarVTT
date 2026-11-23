/* The map's chat and the GMs' sketch layer.
 *  - Chat: a little window in the bottom right for everyone logged in with the map open. A message can carry where
 *    you're looking (the pin button): click it and you go there. The server keeps the last 300.
 *  - Sketches (GMs only): pen, lines, arrows, boxes, circles and words drawn straight onto the map. The players see
 *    none of it until a GM shows a drawing to them (Select it, or turn on "Players see new drawings" first).
 *    Ctrl+Z takes back your last drawing. Drawings are kept in map pixels, so they stay put through any zoom.
 * Both go over presence.js's connection (server/server.js, "the map's chat, and the GMs' sketches on it").
 * ValanarMapChat(ctx, presence) → { } or null when not logged in */
'use strict';
window.ValanarMapChat = function (ctx, presence) {
  const { map, L, h, toast, toLatLng, toPixel } = ctx;
  const SV = window.VALANAR_SERVER || {};
  if (!presence || !SV.user || SV.user.guest) return null;
  const GM = !!SV.admin, NATIVE = ctx.NATIVE;
  const KEY = 'valanar-mapchat';
  const prefs = (() => { try { return Object.assign({ open: false, read: 0, layer: true, pub: false, color: '#c0392b', w: 4 }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { open: false, read: 0, layer: true, pub: false, color: '#c0392b', w: 4 }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private */ } };
  const stop = el => { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); return el; };
  const I = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };

  // ═══════════ chat ═══════════
  let msgs = [];
  const list = h('div', { class: 'mc-list' });
  const input = h('textarea', { class: 'mc-in', rows: 1, maxlength: 600, placeholder: 'Say something…' });
  let pin = false;
  const pinBtn = h('button', { class: 'mc-pin', title: 'Send where you’re looking with the message (click it to go there)', onclick: () => { pin = !pin; pinBtn.classList.toggle('on', pin); } },
    I('<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/>'));
  const badge = h('b', { class: 'mc-badge', hidden: true });
  const fab = h('button', { class: 'mc-fab', title: 'Map chat', onclick: () => setOpen(true) },
    I('<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'), badge);
  const drawBtn = GM ? h('button', { class: 'mc-hbtn', title: 'Sketch on the map (only GMs see it until you show it)', onclick: () => sketchBar(!barOn) },
    I('<path d="M4 20h4L19.5 8.5l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')) : null;
  const panel = h('div', { class: 'mc-panel', hidden: true },
    h('div', { class: 'mc-head' }, h('span', null, 'Map chat'), h('div', { class: 'grow' }), drawBtn,
      h('button', { class: 'mc-hbtn', title: 'Close', onclick: () => setOpen(false) }, '×')),
    list,
    h('div', { class: 'mc-foot' }, pinBtn, input, h('button', { class: 'mc-send', title: 'Send (Enter)', onclick: () => sendChat() }, 'Send')));
  const box = stop(h('div', { class: 'mapchat' }, panel, fab));
  const Ctl = L.Control.extend({ options: { position: 'bottomright' }, onAdd: () => box });
  new Ctl().addTo(map);

  function setOpen(on) {
    prefs.open = !!on; panel.hidden = !on; fab.hidden = !!on;
    if (on) { markRead(); requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; input.focus(); }); }
    save();
  }
  function markRead() { if (msgs.length) prefs.read = Math.max(prefs.read, msgs[msgs.length - 1].time || 0); save(); drawBadge(); }
  function drawBadge() {
    const n = msgs.filter(m => (m.time || 0) > prefs.read && m.uid !== SV.user.id).length;
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
  }
  const hm = t => { const d = new Date(t); const today = new Date().toDateString() === d.toDateString(); return (today ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  function msgEl(m, prev) {
    const same = prev && prev.uid === m.uid && m.time - prev.time < 5 * 60e3;
    return h('div', { class: 'mc-msg' + (same ? ' cont' : '') + (m.uid === SV.user.id ? ' me' : '') },
      same ? null : h('div', { class: 'mc-who' }, h('b', { style: `color:${m.color || '#c9a45c'}` }, m.by), m.gm ? h('span', { class: 'mc-gm' }, 'GM') : null, h('time', null, hm(m.time))),
      h('div', { class: 'mc-text' }, m.text,
        m.at ? h('button', { class: 'mc-go', title: 'Go to where this was said', onclick: () => map.flyTo(toLatLng(m.at[0], m.at[1]), m.at[2], { duration: 1 }) }, ' ⌖ look') : null));
  }
  function drawList() { list.replaceChildren(...msgs.map((m, i) => msgEl(m, msgs[i - 1]))); list.scrollTop = list.scrollHeight; }
  presence.on('mchat', m => {
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    if (m.reset) { msgs = m.msgs || []; drawList(); }
    else for (const x of m.msgs || []) { const prev = msgs[msgs.length - 1]; msgs.push(x); list.append(msgEl(x, prev)); if (near || x.uid === SV.user.id) list.scrollTop = list.scrollHeight; }
    if (msgs.length > 300) msgs.splice(0, msgs.length - 300);
    if (prefs.open && document.visibilityState === 'visible') markRead(); else drawBadge();
  });
  async function sendChat() {
    const text = input.value.trim(); if (!text) return;
    const m = { t: 'mchat', text };
    if (pin) { const c = toPixel(map.getCenter()); m.at = [Math.round(c.x), Math.round(c.y), Math.round(map.getZoom() * 10) / 10]; }
    try { await presence.ask(m); input.value = ''; input.style.height = ''; pin = false; pinBtn.classList.remove('on'); }
    catch (e) { toast(e.message); }
  }
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(90, input.scrollHeight) + 'px'; });
  document.addEventListener('visibilitychange', () => { if (prefs.open && document.visibilityState === 'visible') markRead(); });
  setOpen(prefs.open);

  // ═══════════ the sketch layer ═══════════
  const pane = map.createPane('sketch'); pane.style.zIndex = 640;
  const renderer = L.svg({ pane: 'sketch', padding: 0.5 });
  const shapes = new Map();       // id → { s, layer }
  const group = L.layerGroup().addTo(map);
  let tool = null, barOn = false;
  const mine = [];                // what I drew this time, newest last (for Ctrl+Z)
  const ll = p => toLatLng(p[0], p[1]);
  const escA = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function ellipse(a, b) {
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2, out = [];
    for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return out;
  }
  // one drawing as Leaflet layers (live: true while it's being drawn)
  function build(s, live) {
    const pick = !live && (tool === 'select' || tool === 'erase');
    const o = { pane: 'sketch', renderer, color: s.color, weight: s.w, opacity: s.pub || !GM ? 0.95 : 0.85, lineCap: 'round', lineJoin: 'round', interactive: pick,
      fill: s.fill && (s.kind === 'rect' || s.kind === 'ellipse'), fillColor: s.color, fillOpacity: 0.18, className: 'sk' + (GM && !s.pub ? ' sk-gm' : '') };
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    let lay;
    if (s.kind === 'text') {
      lay = L.marker(ll(a), { pane: 'sketch', interactive: pick, keyboard: false,
        icon: L.divIcon({ className: 'sk-text' + (GM && !s.pub ? ' sk-gm' : ''), iconSize: [0, 0], html: `<span style="color:${s.color};font-size:${s.size || 18}px">${escA(s.text)}</span>` }) });
    } else if (s.kind === 'rect') lay = L.polygon([a, [b[0], a[1]], b, [a[0], b[1]]].map(ll), o);
    else if (s.kind === 'ellipse') lay = L.polygon(ellipse(a, b).map(ll), o);
    else if (s.kind === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, sz = 12 + s.w * 3.5;
      lay = L.layerGroup([L.polyline([a, b].map(ll), o),
        L.marker(ll(b), { pane: 'sketch', interactive: false, keyboard: false, icon: L.divIcon({ className: 'sk-head', iconSize: [0, 0],
          html: `<svg width="${sz}" height="${sz}" viewBox="0 0 10 10" style="transform:translate(-50%,-50%) rotate(${ang}deg)"><path d="M10 5 L0 0 L3 5 L0 10z" fill="${s.color}"/></svg>` }) })]);
    } else lay = L.polyline(s.pts.map(ll), o);
    if (pick) {
      const each = fn => lay.eachLayer ? (lay.eachLayer(fn), fn(lay)) : fn(lay);
      each(x => x.on && x.on('click', e => { L.DomEvent.stop(e); if (tool === 'erase') erase([s.id]); else selectSketch(s, e.latlng); }));
      each(x => x.on && x.on('mouseover', () => { if (tool === 'erase' && erasing) erase([s.id]); }));
    }
    return lay;
  }
  function put(s) {
    const old = shapes.get(s.id); if (old) group.removeLayer(old.layer);
    const layer = build(s, false); shapes.set(s.id, { s, layer }); group.addLayer(layer);
  }
  function drop(id) { const x = shapes.get(id); if (x) { group.removeLayer(x.layer); shapes.delete(id); } }
  const redrawAll = () => { for (const { s } of [...shapes.values()]) put(s); };
  function showLayer(on) { if (on) { if (!map.hasLayer(group)) group.addTo(map); } else group.remove(); }
  presence.on('msketches', m => { group.clearLayers(); shapes.clear(); for (const s of m.list || []) put(s); });
  presence.on('msketch', m => { if (m.s) put(m.s); });
  presence.on('msketchDel', m => { for (const id of m.ids || []) drop(id); });
  showLayer(!GM || prefs.layer);
  if (!GM) return {};

  async function addSketch(s) {
    s.id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    put(Object.assign({ by: SV.user.name }, s));          // straight away; the server's copy replaces it
    try { await presence.ask({ t: 'msketch', s }); mine.push(s.id); }
    catch (e) { drop(s.id); toast(e.message); }
  }
  async function erase(ids) {
    ids = ids.filter(id => shapes.has(id)); if (!ids.length) return;
    for (const id of ids) drop(id);
    try { await presence.ask({ t: 'msketchDel', ids }); } catch (e) { toast(e.message); }
  }
  async function setPub(ids, pub) { try { await presence.ask({ t: 'msketchVis', ids, pub }); } catch (e) { toast(e.message); } }
  function selectSketch(s, at) {
    const cb = h('input', { type: 'checkbox', checked: !!s.pub, onchange: () => { setPub([s.id], cb.checked); map.closePopup(); } });
    const el = h('div', { class: 'sk-pop' },
      h('div', { class: 'muted' }, `${s.by || 'Someone'} · ${s.kind === 'text' ? 'words' : s.kind}`),
      h('label', null, cb, ' Players can see this'),
      h('button', { class: 'btn sm danger', onclick: () => { map.closePopup(); erase([s.id]); } }, 'Delete'));
    L.popup({ className: 'sk-popup', closeButton: false, offset: [0, -4] }).setLatLng(at).setContent(el).openOn(map);
  }

  // ── the toolbar ──
  const TOOLS = [
    ['pen', 'Pen: draw freehand', '<path d="M3 17c3-6 6 2 9-4s5-6 9-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
    ['line', 'Line', '<path d="M5 19L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
    ['arrow', 'Arrow', '<path d="M5 19L18 6M10 6h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['rect', 'Box', '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>'],
    ['ellipse', 'Circle (drag out its box)', '<ellipse cx="12" cy="12" rx="8" ry="6" fill="none" stroke="currentColor" stroke-width="2"/>'],
    ['text', 'Words: click where they go', '<path d="M6 6h12M12 6v13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'],
    ['select', 'Select a drawing: show it to the players, or delete it', '<path d="M6 3l12 9-6 1 3 7-2.5 1-3-7-3.5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
    ['erase', 'Eraser: click or drag over drawings', '<path d="M4 16l9-9 6 6-6 6H8z M9 11l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>']];
  const SW = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#1d1a16', '#f3ecdc'];
  const toolBtns = {}, swBtns = [];
  const colorIn = h('input', { type: 'color', value: prefs.color, title: 'Any colour', oninput: () => setColor(colorIn.value) });
  const widthSel = h('select', { title: 'Line width', onchange: () => { prefs.w = +widthSel.value; save(); } },
    ...[[2, 'Fine'], [4, 'Medium'], [8, 'Thick'], [14, 'Heavy']].map(([v, n]) => h('option', { value: v }, n)));
  widthSel.value = String(prefs.w);
  let fill = false;
  const fillBtn = h('button', { class: 'sk-btn', title: 'Fill boxes and circles', onclick: () => { fill = !fill; fillBtn.classList.toggle('on', fill); } },
    I('<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" opacity=".45" stroke="currentColor" stroke-width="2"/>'));
  const pubIn = h('input', { type: 'checkbox', checked: prefs.pub, onchange: () => { prefs.pub = pubIn.checked; save(); } });
  const eyeIn = h('input', { type: 'checkbox', checked: prefs.layer, onchange: () => { prefs.layer = eyeIn.checked; save(); showLayer(prefs.layer); } });
  function setColor(c) { prefs.color = c; colorIn.value = c; save(); swBtns.forEach(b => b.classList.toggle('on', b.dataset.c === c)); }
  const bar = stop(h('div', { class: 'sk-bar', hidden: true },
    h('div', { class: 'sk-group' }, ...TOOLS.map(([k, t, d]) => (toolBtns[k] = h('button', { class: 'sk-btn', title: t, onclick: () => setTool(tool === k ? null : k) }, I(d))))),
    h('div', { class: 'sk-group' }, ...SW.map(c => { const b = h('button', { class: 'sk-sw', 'data-c': c, style: `--c:${c}`, title: c, onclick: () => setColor(c) }); swBtns.push(b); return b; }), colorIn),
    h('div', { class: 'sk-group' }, widthSel, fillBtn),
    h('div', { class: 'sk-group sk-opts' },
      h('label', { title: 'New drawings show on the players’ maps too' }, pubIn, ' Players see new drawings'),
      h('label', { title: 'Show the sketch layer on your map' }, eyeIn, ' Show layer')),
    h('div', { class: 'sk-group' },
      h('button', { class: 'sk-txt', title: 'Show every drawing to the players', onclick: () => setPub([...shapes.keys()], true) }, 'Show all'),
      h('button', { class: 'sk-txt', title: 'Hide every drawing from the players', onclick: () => setPub([...shapes.keys()], false) }, 'Hide all'),
      h('button', { class: 'sk-txt danger', title: 'Delete every drawing, for everyone', onclick: async () => {
        if (!shapes.size || !confirm(`Delete all ${shapes.size} drawings, for everyone? This can’t be undone.`)) return;
        try { await presence.ask({ t: 'msketchDel', all: true }); } catch (e) { toast(e.message); }
      } }, 'Clear'),
      h('button', { class: 'sk-txt done', onclick: () => sketchBar(false) }, 'Done'))));
  map.getContainer().append(bar);
  setColor(prefs.color);

  function sketchBar(on) {
    barOn = !!on; bar.hidden = !on; if (drawBtn) drawBtn.classList.toggle('on', barOn);
    if (on) { if (!prefs.layer) { prefs.layer = true; eyeIn.checked = true; save(); showLayer(true); } setTool(tool || 'pen'); }
    else setTool(null);
  }
  function setTool(t) {
    const was = tool; tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t);
    const drawing = !!t && t !== 'select' && t !== 'erase';
    map.getContainer().classList.toggle('sketching', drawing);
    map.getContainer().classList.toggle('sk-erasing', t === 'erase');
    if (t) { map.dragging.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); }
    else { map.dragging.enable(); map.doubleClickZoom.enable(); map.boxZoom.enable(); }
    const pickWas = was === 'select' || was === 'erase', pickNow = t === 'select' || t === 'erase';
    map.getContainer().classList.toggle('sk-picking', pickNow);
    if (pickWas !== pickNow) redrawAll();
    if (!t) map.closePopup();
  }

  // ── drawing with the pointer ──
  const C = map.getContainer();
  const at = e => { const p = toPixel(map.mouseEventToLatLng(e)); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; };
  const onUI = e => e.target.closest('.leaflet-control-container, .sk-bar, .sk-popup, .sk-word, #panel');
  let cur = null, curLayer = null, erasing = false;
  C.addEventListener('pointerdown', e => {
    if (!tool || e.button !== 0 || onUI(e)) return;
    if (tool === 'erase') { erasing = true; return; }
    if (tool === 'select') return;
    e.preventDefault(); e.stopPropagation();
    if (tool === 'text') { wordAt(e); return; }
    cur = { kind: tool, pts: [at(e)], color: prefs.color, w: prefs.w, fill, pub: prefs.pub };
    try { C.setPointerCapture(e.pointerId); } catch (er) { /* fine */ }
  }, true);
  C.addEventListener('pointermove', e => {
    if (!cur) return;
    const p = at(e);
    if (cur.kind === 'pen') {
      // thin the stroke: only a point at least a couple of screen pixels on from the last
      const q = cur.pts[cur.pts.length - 1], k = Math.pow(2, NATIVE - map.getZoom()) * 2.5;
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < k) return;
      cur.pts.push(p);
    } else cur.pts[1] = p;
    if (curLayer) group.removeLayer(curLayer);
    if (cur.pts.length > 1) { curLayer = build(cur, true); group.addLayer(curLayer); }
  }, true);
  const finish = () => {
    erasing = false;
    if (!cur) return;
    const s = cur; cur = null;
    if (curLayer) { group.removeLayer(curLayer); curLayer = null; }
    if (s.pts.length < 2) return;
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]], px = Math.pow(2, NATIVE - map.getZoom());
    if (s.kind !== 'pen' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4 * px) return;   // a click, not a drag
    addSketch(s);
  };
  C.addEventListener('pointerup', finish, true);
  C.addEventListener('pointercancel', finish, true);
  // while drawing, a click on the map is the drawing's, not a place's
  C.addEventListener('click', e => { if (tool && tool !== 'select' && tool !== 'erase' && !onUI(e)) { e.stopPropagation(); e.preventDefault(); } }, true);

  function wordAt(e) {
    const p = at(e), r = C.getBoundingClientRect();
    const inp = h('input', { class: 'sk-word', placeholder: 'Type, then Enter', maxlength: 300,
      style: `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;color:${prefs.color}` });
    stop(inp);
    const done = ok => {
      if (!inp.isConnected) return;
      const text = inp.value.trim(); inp.remove();
      if (ok && text) addSketch({ kind: 'text', pts: [p], text, color: prefs.color, w: prefs.w, size: 12 + prefs.w * 2, pub: prefs.pub });
    };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    C.append(inp); setTimeout(() => inp.focus(), 0);
  }
  document.addEventListener('keydown', e => {
    if (!barOn || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      while (mine.length && !shapes.has(mine[mine.length - 1])) mine.pop();
      const id = mine.pop(); if (id) { e.preventDefault(); e.stopPropagation(); erase([id]); }
    } else if (e.key === 'Escape') { e.stopPropagation(); if (cur) { cur = null; if (curLayer) group.removeLayer(curLayer); curLayer = null; } else sketchBar(false); }
  }, true);
  if (ctx.onView) ctx.onView(v => { if (v !== 'map' && barOn) sketchBar(false); });
  return { sketchBar };
};
