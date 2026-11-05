/* Table core: helpers, state, the connection to the server. Everything hangs off window.V. */
'use strict';
(function () {
const V = window.V = {};

// ───────────────────────── helpers ─────────────────────────

// replaceChildren/append here skip null and false, so "cond ? el : null" can be passed straight in
for (const name of ['replaceChildren', 'append']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false)); };
}
V.$ = s => document.querySelector(s);
V.$$ = s => [...document.querySelectorAll(s)];
V.h = function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};
V.toast = function (msg, bad) {
  const t = V.h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  V.$('#toasts').append(t);
  while (V.$('#toasts').children.length > 4) V.$('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), bad ? 6000 : 3000);
};
V.store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } }
};
V.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
V.isTyping = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|range|color|button)$/.test(a.type)); };
V.initials = name => (String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
V.api = async function (path, opts = {}) {
  const r = await fetch(path, Object.assign({ headers: opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {} }, opts,
    opts.body && !(opts.body instanceof Blob) && typeof opts.body !== 'string' ? { body: JSON.stringify(opts.body) } : {}));
  if (r.status === 401) { location.href = '/table/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Log in first'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Something went wrong');
  return j;
};
V.upload = async function (file) {
  const r = await fetch(`/api/campaigns/${V.state.camp.id}/upload?name=${encodeURIComponent(file.name || 'image')}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Upload failed');
  return j.url;
};
// image size without decoding twice
V.imageSize = file => new Promise((res, rej) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight, img, url }); };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That image could not be read')); };
  img.src = url;
});

// ───────────────────────── events ─────────────────────────

const handlers = {};
V.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
V.once = (ev, fn) => { const w = d => { const l = handlers[ev]; l.splice(l.indexOf(w), 1); fn(d); }; V.on(ev, w); };
V.emit = (ev, data) => { for (const fn of handlers[ev] || []) { try { fn(data); } catch (e) { console.error(ev, e); } } };

// ───────────────────────── state ─────────────────────────

V.state = {
  me: null,          // { id, name, role, color }
  camp: null,        // campaign meta from the server: { id, name, mode, playerScene, members, scenes, gm }
  scene: null,       // { id, meta, tokens: Map, templates: Map, fog: [] }
  init: { entries: [], turn: 0, round: 1 },
  chat: [],
  sel: new Set(),    // selected token ids
  tool: 'select',
  layer: 'tokens',   // which layer the GM is working on
};
V.isGM = () => !!(V.state.me && V.state.me.role === 'gm');
V.isGuest = () => !!(V.state.me && (V.state.me.guest || V.state.me.role === 'guest'));   // not logged in: watching only
V.canControl = t => !!t && (V.isGM() || (t.owners || []).includes(V.state.me.id));
V.member = uid => (V.state.camp && V.state.camp.members.find(m => m.id === uid)) || null;
V.grid = () => (V.state.scene && V.state.scene.meta.grid) || { type: 'square', size: 100, ox: 0, oy: 0, feet: 5, units: 'ft' };
V.sceneSize = () => {
  const s = V.state.scene; if (!s) return { w: 1000, h: 1000 };
  const m = s.meta, g = V.grid();
  if (m.plan && m.plan.cols) return { w: m.plan.cols * g.size + (g.ox || 0), h: m.plan.rows * g.size + (g.oy || 0) };   // a planned map: its squares
  if (m.image && m.image.w) return { w: m.image.w, h: m.image.h };
  const a = m.area || { cols: 30, rows: 20 };
  return { w: a.cols * g.size, h: a.rows * g.size };
};
V.tokensSorted = () => [...V.state.scene.tokens.values()].sort((a, b) => a._i - b._i);

function applySync(m) {
  const st = V.state;
  if (m.meta) { st.camp = m.meta; V.emit('meta'); }
  if (m.init) { st.init = m.init; V.emit('init'); }
  if ('scene' in m) {
    if (m.scene === null) { st.scene = null; st.sel.clear(); V.emit('scene'); }
    else {
      const s = m.scene;
      const reset = s.reset || !st.scene || st.scene.id !== s.id;
      if (reset) { st.scene = { id: s.id, meta: {}, tokens: new Map(), templates: new Map(), walls: new Map(), lights: new Map(), sounds: new Map(), fog: [] }; st.sel.clear(); }
      const sc = st.scene;
      if (s.meta) sc.meta = s.meta;
      if (s.fog) sc.fog = s.fog;
      for (const key of ['tokens', 'templates', 'walls', 'lights', 'sounds']) if (s[key]) {
        for (const item of s[key].up) sc[key].set(item.id, item);
        for (const rid of s[key].rm) { sc[key].delete(rid); if (key === 'tokens') st.sel.delete(rid); }
      }
      if (reset) V.emit('scene');
      else {
        if (s.meta) V.emit('sceneMeta');
        if (s.fog) V.emit('fog');
        if (s.tokens) V.emit('tokens', s.tokens);
        if (s.templates) V.emit('templates', s.templates);
        if (s.walls) V.emit('walls', s.walls);
        if (s.lights) V.emit('lights', s.lights);
        if (s.sounds) V.emit('sounds', s.sounds);
      }
    }
  }
}

// ───────────────────────── connection ─────────────────────────

let ws = null, rid = 0, waiting = new Map(), campaignId = null, retry = 0, wantScene = null;
V.connected = false;
let lite = false;
V.connect = function (cid, scene, opts) {
  campaignId = cid; wantScene = scene || null; lite = !!(opts && opts.lite);
  open();
};
function open() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { retry = 0; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') {
      if (m.now) V.clockSkew = m.now - Date.now();   // the server keeps time for the jukebox
      // a GM sitting at this table as a player (main.js): seen as one
      V.state.me = V.asPlayer && m.user && m.user.role === 'gm' ? Object.assign({}, m.user, { role: 'player', realRole: 'gm' }) : m.user; V.emit('me');
      V.send({ t: 'join', campaign: campaignId, lite, asPlayer: !!V.asPlayer, scene: wantScene || V.store.get('vtt-view-' + campaignId, null) }).then(() => {
        V.connected = true; V.emit('conn', true);
      }).catch(err => { V.toast(err.message, true); V.emit('joinFailed', err); });
    } else if (m.t === 'ack') {
      const w = waiting.get(m.rid); if (!w) return; waiting.delete(m.rid);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m);
    } else if (m.t === 'sync') applySync(m);
    else if (m.t === 'chat') {
      if (m.reset) V.state.chat = [];
      V.state.chat.push(...m.msgs);
      V.emit('chat', m);
    } else if (m.t === 'time') {   // the world's clock and weather
      V.state.calendar = m.cal;
      V.emit('time', m.cal);
    } else if (m.t === 'chatGone') {
      const g = new Set(m.ids);
      V.state.chat = V.state.chat.filter(x => !g.has(x.id));
      V.emit('chatGone', m.ids);
    } else if (m.t === 'fx') V.emit('fx', m);
    else if (m.t === 'char') V.emit('charState', m.char);
    else if (m.t === 'charAttrs') V.emit('charAttrs', m);
    else if (m.t === 'charGone') V.emit('charGone', m.char);
    else if (m.t === 'charSheet') V.emit('charSheet', m);
    else if (m.t === 'handoutShow') V.emit('handoutShow', m.id);
    else if (m.t === 'sfx') V.emit('sfx', m);
    else if (m.t === 'error') V.toast(m.error, true);
  };
  ws.onclose = e => {
    V.connected = false; V.emit('conn', false);
    for (const w of waiting.values()) w.reject(new Error('Disconnected'));
    waiting.clear();
    if (e.code === 4001) { V.toast('You were removed from this campaign.', true); return; }
    const wait = Math.min(10000, 500 * Math.pow(2, retry++));
    setTimeout(open, wait);
  };
}
const GUEST_OK = new Set(['join', 'charOpen']);   // all a visitor (not logged in) may ask of the table
V.send = function (msg) {
  return new Promise((resolve, reject) => {
    if (V.isGuest() && !GUEST_OK.has(msg.t)) return reject(new Error('Log in to play'));
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected: reconnecting…'));
    msg.rid = ++rid; waiting.set(msg.rid, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });
};
V.fire = function (msg) { if (ws && ws.readyState === 1 && !(V.isGuest() && !GUEST_OK.has(msg.t))) ws.send(JSON.stringify(msg)); };   // no reply wanted
V.op = function (op) { return V.send({ t: 'op', op }).catch(e => { V.toast(e.message, true); throw e; }); };
V.undo = () => V.send({ t: 'undo' }).then(r => { if (!r.done) V.toast('Nothing to undo'); }).catch(e => V.toast(e.message, true));
V.redo = () => V.send({ t: 'redo' }).then(r => { if (!r.done) V.toast('Nothing to redo'); }).catch(e => V.toast(e.message, true));

// Conditions shown on tokens: label, two-letter badge, colour.
V.CONDITIONS = [
  ['Blinded', 'Bl', '#8a8a8a'], ['Charmed', 'Ch', '#d06fae'], ['Deafened', 'De', '#8a8a8a'], ['Frightened', 'Fr', '#9b6fc4'],
  ['Grappled', 'Gr', '#b48a4a'], ['Incapacitated', 'In', '#c0584a'], ['Invisible', 'Iv', '#9fd6e8'], ['Paralyzed', 'Pa', '#e0b050'],
  ['Petrified', 'Pe', '#9a9a8a'], ['Poisoned', 'Po', '#6fbf73'], ['Prone', 'Pr', '#c9a45c'], ['Restrained', 'Re', '#b48a4a'],
  ['Stunned', 'St', '#e0b050'], ['Unconscious', 'Un', '#c0584a'], ['Exhausted', 'Ex', '#7a6a5a'], ['Concentrating', 'Co', '#5b8fd1'],
  ['Bloodied', 'Bd', '#a3473a'], ['Dead', '✝', '#444444']
];
})();
