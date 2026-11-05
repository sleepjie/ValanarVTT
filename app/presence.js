/* Who's here: the others with the world map or the wiki open, as a little coin each in the top bar (on the map, or
 * reading which page). Nobody's pointer or view is shown or sent: only which page they're on, now and then.
 * Your coin hides you from the others (click it). Guests don't show and don't see.
 * Anyone can point something out: Alt+click the map and a ring shows there on everyone's map, with your name (an arrow
 * at the edge of the screen for those looking elsewhere, and a little chime if they have the sound on).
 *
 * Over the table's own connection (/ws; see server/server.js, "who's looking at the world map").
 * ValanarPresence(ctx) → { send(look) } or null when not logged in */
'use strict';
window.ValanarPresence = function (ctx) {
  const { map, L, h, toast, toLatLng, toPixel } = ctx;
  const SV = window.VALANAR_SERVER || {};
  if (!SV.user || !window.WebSocket) return null;
  const KEY = 'valanar-presence';
  let prefs = (() => { try { return Object.assign({ hidden: false }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { hidden: false }; } })();
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private */ } };
  let ws = null, open = false, peers = [], retry = 0;

  // ───────── the connection ─────────
  function connect() {
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch (e) { return; }
    ws.onopen = () => { open = true; retry = 0; send({ t: 'site', hidden: prefs.hidden }); lastSent = ''; look(); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } onMsg(m); };
    ws.onclose = () => { open = false; peers = []; drawCoins(); setTimeout(connect, Math.min(60000, 4000 * Math.pow(1.6, retry++)) + Math.random() * 2000); };
    ws.onerror = () => { /* closes after */ };
  }
  const send = m => { if (open && ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function onMsg(m) {
    if (m.t === 'peers') { peers = Array.isArray(m.list) ? m.list : []; drawCoins(); }
    else if (m.t === 'ping' && Array.isArray(m.at)) showPing({ by: m.by, color: m.color, at: m.at });
    else if (m.t === 'worldSaved') window.dispatchEvent(new CustomEvent('valanar-world-saved', { detail: m }));   // (app.js takes it in)
  }

  // ───────── which page I'm on (not where on the map, nor the pointer) ─────────
  let lastSent = '', timer = 0;
  function look() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const lk = { view: ctx.view(), where: ctx.view() === 'wiki' ? ctx.where() : null };
      const j = JSON.stringify(lk);
      if (j === lastSent) return;
      lastSent = j;
      send({ t: 'look', look: lk, hidden: prefs.hidden });
    }, 400);
  }
  window.addEventListener('hashchange', () => setTimeout(look, 50));
  setInterval(() => { lastSent = ''; look(); }, 60000);   // now and then, so nobody goes stale
  const pane = map.createPane('peersPane'); pane.style.zIndex = 700; pane.style.pointerEvents = 'none';
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ───────── pointing something out ─────────
  let lastPing = 0;
  // (caught on the way in, so Alt+click on a place's icon points at it rather than opening it)
  map.getContainer().addEventListener('click', e => {
    if (!e.altKey || ctx.editMode() || e.target.closest('.leaflet-control-container, #panel, .followbar, .pingedge')) return;
    e.stopPropagation(); e.preventDefault();
    const now = Date.now(); if (now - lastPing < 500) return; lastPing = now;
    const p = toPixel(map.mouseEventToLatLng(e)), at = [Math.round(p.x), Math.round(p.y)];
    send({ t: 'ping', at });
    showPing({ by: SV.user.name, color: SV.user.color || '#c9a45c', at, mine: true });
    if (!peers.length && !showPing.told) { showPing.told = true; toast('That ring shows on everyone’s map (nobody else is looking just now).'); }
  }, true);
  function showPing(pg) {
    const ll = toLatLng(pg.at[0], pg.at[1]), c = esc(pg.color || '#c9a45c');
    const mk = L.marker(ll, { pane: 'peersPane', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'peerping', iconSize: [0, 0], html: `<i style="--c:${c}"></i><i style="--c:${c}"></i><b style="--c:${c}"></b><span style="--c:${c}">${esc(pg.by)}</span>` }) }).addTo(map);
    setTimeout(() => mk.remove(), 3400);
    if (pg.mine) return;
    chime();
    if (ctx.view() !== 'map') { toast(`${pg.by} is pointing something out on the map.`); return; }
    if (map.getBounds().pad(-0.03).contains(ll)) return;
    // off the screen: an arrow at the edge, towards it
    const s = map.getSize(), cp = map.latLngToContainerPoint(ll), cx = s.x / 2, cy = s.y / 2, dx = cp.x - cx, dy = cp.y - cy;
    const k = Math.min((cx - 70) / Math.max(1e-6, Math.abs(dx)), (cy - 40) / Math.max(1e-6, Math.abs(dy)));
    const el = h('button', { class: 'pingedge', style: `left:${Math.round(cx + dx * k)}px;top:${Math.round(cy + dy * k)}px;--c:${pg.color || '#c9a45c'}`, title: `${pg.by} is pointing at something over there (click to look)`,
      onclick: () => { map.flyTo(ll, Math.max(map.getZoom(), 4), { duration: 1 }); el.remove(); } },
      h('i', { style: `transform:rotate(${Math.round(Math.atan2(dy, dx) * 180 / Math.PI)}deg)` }), h('span', null, pg.by));
    L.DomEvent.disableClickPropagation(el);
    map.getContainer().append(el);
    setTimeout(() => el.classList.add('gone'), 5500); setTimeout(() => el.remove(), 6200);
  }
  // a little chime, if this browser has the map's sound on (the hotbar's speaker)
  let ac = null;
  function chime() {
    let vol = 0; try { vol = parseFloat(localStorage.getItem('valanar-sound-vol')) || 0; } catch (e) { vol = 0; }
    if (vol <= 0) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const T = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.16 * vol, T + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, T + 1.5);
      for (const [f, d] of [[1318.5, 0], [1975.5, 0.11]]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(T + d); o.stop(T + 1.6); }
    } catch (e) { /* no sound to be had */ }
  }

  // ───────── the coins in the top bar ─────────
  const bar = h('div', { id: 'peers', class: 'peers' });
  const me = document.getElementById('me');
  if (me && me.parentNode) me.parentNode.insertBefore(bar, me);
  function drawCoins() {
    const coin = (p, isMe) => {
      const lk = p.look || {}, where = lk.view === 'map' ? 'on the map' : lk.view === 'wiki' ? (lk.where ? `reading “${lk.where}”` : 'reading the wiki') : (lk.view || 'here');
      return h('button', { class: 'coin' + (isMe ? ' me' : '') + (isMe && prefs.hidden ? ' hidden' : ''), style: `--c:${p.color || '#c9a45c'}`,
        title: isMe ? (prefs.hidden ? 'You: hidden from the others (click to show yourself)' : 'You: the others can see you’re here (click to hide).\nAlt+click the map to point something out to everyone.') : `${p.name}${p.gm ? ' (GM)' : ''}: ${where}`,
        onclick: () => { if (isMe) toggleHidden(); } }, (p.name || '?').trim().charAt(0).toUpperCase());
    };
    const kids = [];
    if (peers.length) kids.push(...peers.map(p => coin(p, false)));
    if (peers.length) kids.push(coin({ name: SV.user.name, color: SV.user.color, look: {} }, true));
    bar.replaceChildren(...kids);
    bar.hidden = !kids.length;
  }
  function toggleHidden() { prefs.hidden = !prefs.hidden; savePrefs(); send({ t: 'site', hidden: prefs.hidden }); lastSent = ''; look(); drawCoins(); toast(prefs.hidden ? 'Hidden: the others can’t see you.' : 'The others can see you’re here.'); }
  connect();
  return { look, peers: () => peers.length };
};
