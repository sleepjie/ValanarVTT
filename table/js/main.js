/* Start-up: who am I, which campaign, then the table. */
'use strict';
(function () {
const { $, h, state, on } = V;

const ICONS = {
  select: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 8-6 1.5L16 20l-3 1.3-3.2-7.4L5 18z"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
  template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20L12 4l8 16z" fill="currentColor" fill-opacity="0.25"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 17h11a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 6 17z" fill="currentColor" fill-opacity="0.25"/></svg>',
  walls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V6h6M14 6h6v14"/><path d="M10 6v4M14 6v4" stroke-dasharray="2 2"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="20" r="1.6" fill="currentColor"/></svg>',
  lights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" fill="currentColor" fill-opacity="0.25"/></svg>',
  sounds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity="0.25"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 3.5h17v17h-17z"/><path d="M3.5 12h7v8.5M10.5 3.5V8M14 12h6.5M14 12v3" /><path d="M6 6.5l2 0M16 6l2.5 2.5M16 8.5l2.5-2.5" stroke-width="1.4"/></svg>',
  art: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5" /><circle cx="15.5" cy="9" r="1.6" fill="currentColor"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  journey: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19c2-1 3-4 6-5s5 1 7-2 0-6 0-6" stroke-dasharray="0.1 3.6"/><circle cx="5" cy="19" r="1.8" fill="currentColor"/><path d="M18 6V2.5l3 1.4-3 1.4" fill="currentColor" stroke-width="1.4"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
};

(async function boot() {
  let me;
  try { me = await V.api('/api/me'); } catch (e) { return; }
  const loginHref = () => '/table/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  if (!me.user && !me.guest) { location.href = loginHref(); return; }   // a private site: log in first
  // not logged in: watch (see what the players see, change nothing)
  state.me = me.user || { id: 'guest', name: 'Visitor', role: 'guest', color: '#8a8f98', guest: true };
  document.body.classList.toggle('is-gm', state.me.role === 'gm');
  document.body.classList.toggle('is-guest', !!state.me.guest);
  if (state.me.guest) {
    $('#me').replaceChildren(h('span', { class: 'muted', title: 'You can watch the table. Log in to play.' }, 'Watching'));
    $('#logout').hidden = false; $('#logout').textContent = 'Log in'; $('#logout').classList.add('primary');
    $('#logout').onclick = () => { location.href = loginHref(); };
  } else {
    $('#me').replaceChildren(h('b', null, me.user.name), me.user.role === 'gm' ? ' · GM' : '');
    $('#logout').hidden = me.local && me.localNoLogin && me.user.role === 'gm';
    $('#logout').onclick = async () => { await V.api('/api/logout', { method: 'POST' }); location.href = '/table/'; };
  }
  $('#campBtn').onclick = () => { location.href = '/table/?list'; };

  const params = new URLSearchParams(location.search);
  const cid = params.get('c') || (params.has('list') ? null : V.store.get('vtt-last-campaign', null));
  if (!cid) return showCampaigns();
  start(cid);
})();

async function showCampaigns() {
  $('#app').hidden = true;
  const box = $('#campaigns'); box.hidden = false;
  $('#campBtn').textContent = 'Campaigns';
  let list = [];
  try { list = (await V.api('/api/campaigns')).campaigns; } catch (e) { V.toast(e.message, true); }
  const gm = V.isGM();
  const name = h('input', { placeholder: 'Campaign name', style: 'flex:1' });
  // when the campaign starts: the world's calendar, from the site; the year defaults to the world's present
  let cal = null;
  if (gm) try { cal = await fetch('/api/site/calendar', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null); } catch (e) { /* no calendar */ }
  const Cal = window.WorldCalendar, now = cal && Cal ? Cal.date(cal.cal, cal.t) : null;
  const year = h('input', { type: 'number', value: now ? now.year : 1, style: 'width:96px', required: true, title: 'The year the campaign starts in' });
  const month = h('select', null, ...(cal ? cal.cal.months : [{ name: '—' }]).map((m, i) => h('option', { value: i, selected: now && i === now.month || null }, m.name)));
  const day = h('input', { type: 'number', min: 1, max: 400, value: now ? now.day : 1, style: 'width:64px', title: 'Day of the month' });
  let mode = '5e';
  const seg = h('div', { class: 'seg', style: 'width:160px' });
  const drawSeg = () => seg.replaceChildren(...[['5e', 'D&D 5e'], ['2d6', '2D6']].map(([k, l]) => h('button', { type: 'button', class: mode === k ? 'on' : null, onclick: () => { mode = k; drawSeg(); } }, l)));
  drawSeg();
  box.replaceChildren(h('div', { class: 'wrap' },
    h('h1', null, 'Campaigns'),
    list.length ? list.map(c => h('a', { class: 'crow', href: '/table/?c=' + c.id },
      h('b', null, c.name), h('span', { class: 'mode' }, c.mode === '2d6' ? '2D6' : '5E'),
      h('span', { class: 'muted small' }, `${c.scenes} scene${c.scenes === 1 ? '' : 's'} · ${c.players} player${c.players === 1 ? '' : 's'}`)))
      : h('p', { class: 'muted' }, gm ? 'No campaigns yet. Start one below.' : V.isGuest() ? 'There’s no table to watch at the moment.' : 'You haven’t been added to a campaign yet. Ask your GM for an invite link.'),
    V.isGuest() ? h('p', { class: 'muted small', style: 'margin-top:18px' }, 'You’re watching. ', h('a', { href: '/table/login.html?next=' + encodeURIComponent('/table/') }, 'Log in'), ' to play.') : null,
    gm ? h('form', { style: 'margin-top:24px', onsubmit: async e => {
      e.preventDefault();
      if (year.value === '' || !isFinite(+year.value)) { V.toast('What year is it in this campaign?', true); year.focus(); return; }
      try { const r = await V.api('/api/campaigns', { method: 'POST', body: { name: name.value.trim() || 'New campaign', mode, year: +year.value, month: +month.value, day: +day.value || 1 } }); location.href = '/table/?c=' + r.campaign.id; }
      catch (err) { V.toast(err.message, true); }
    } }, h('div', { class: 'newcamp' },
      h('div', { class: 'row' }, name, seg),
      h('div', { class: 'row whenrow' }, h('span', { class: 'muted', style: 'align-self:end;padding-bottom:7px' }, 'It starts on'),
        h('label', { class: 'mini' }, 'Day', day), h('label', { class: 'mini' }, 'Month', month), h('label', { class: 'mini' }, 'Year', year),
        h('span', { class: 'muted small' }, now ? `The world's calendar is at ${now.day} ${now.monthName} ${now.year} now. Each campaign keeps its own date.` : 'Each campaign keeps its own date.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'New campaign')))) : null));
}

function start(cid) {
  $('#campaigns').hidden = true;
  $('#app').hidden = false;
  V.store.set('vtt-last-campaign', cid);
  // a GM can sit at a table as a player (someone else's game, or to see what the players see): remembered per campaign
  if (state.me.role === 'gm' || state.me.realRole === 'gm') {
    V.asPlayer = !!V.store.get('vtt-play-' + cid, false);
    if (V.asPlayer) { state.me = Object.assign({}, state.me, { role: 'player', realRole: 'gm' }); document.body.classList.remove('is-gm'); document.body.classList.add('as-player'); }
    const swap = h('button', { id: 'roleBtn', class: 'chip sm' + (V.asPlayer ? ' on' : ''), title: V.asPlayer ? 'You’re at this table as a player. Rejoin as the GM.' : 'Rejoin this table as a player: see and do only what a player would (your account stays a GM’s)',
      onclick: () => { V.store.set('vtt-play-' + cid, !V.asPlayer); location.reload(); } }, V.asPlayer ? 'Rejoin as GM' : 'Rejoin as player');
    $('#me').replaceChildren(h('b', null, state.me.name), V.asPlayer ? ' · playing' : ' · GM');
    $('#me').after(swap);
  }
  for (const b of V.$$('#tools [data-tool]')) { b.innerHTML = ICONS[b.dataset.tool]; b.addEventListener('click', () => V.setTool(b.dataset.tool)); }
  $('#addToken').innerHTML = ICONS.add; $('#addToken').onclick = () => V.addToken();
  $('#undoBtn').innerHTML = ICONS.undo; $('#undoBtn').onclick = () => V.undo();
  $('#redoBtn').innerHTML = ICONS.redo; $('#redoBtn').onclick = () => V.redo();
  $('#fitBtn').innerHTML = ICONS.fit; $('#fitBtn').onclick = () => V.fit();
  for (const b of V.$$('#layerDock button')) b.onclick = () => V.setLayer(b.dataset.layer);
  // the side bar's tabs are pictures; their names show when you point at them
  const TAB_ICONS = { chat: 'conversation', init: 'crossed-swords', chars: 'book-cover', items: 'swap-bag', spells: 'spell-book', audio: 'lyre', scenes: 'treasure-map', players: 'meeple-group' };
  const TAB_TIPS = { chat: 'Chat and dice', init: 'Initiative', chars: 'Journal: characters and handouts', items: 'Items', spells: 'Spells and features: class features, racial traits, feats, the actions in combat', audio: 'Jukebox', scenes: 'Scenes', players: 'Players' };
  for (const b of V.$$('#side .tabs button')) {
    const k = b.dataset.tab;
    if (!TAB_ICONS[k] || !V.uiIcon) continue;
    b.title = TAB_TIPS[k] || b.textContent; b.setAttribute('aria-label', b.title);
    b.replaceChildren(V.uiIcon(TAB_ICONS[k]), h('span', { class: 'tabname' }, b.textContent));
  }
  V.initStage();
  V.setTool('select');
  V.showTab(V.store.get('vtt-tab', 'chat') === 'players' && !V.isGM() ? 'chat' : V.store.get('vtt-tab', 'chat'));
  if (V.isGuest()) {   // watching: a note where the chat box would be
    const note = h('div', { class: 'guestnote' }, h('span', null, 'You’re watching this table.'),
      h('a', { class: 'btn primary sm', href: '/table/login.html?next=' + encodeURIComponent(location.pathname + location.search) }, 'Log in to play'));
    $('#tab-chat').append(note);
  }
  V.connect(cid);
}

// the site's name (Admin › Site), in the top bar and the window title
const SITE = (window.VALANAR_SERVER || {}).siteName || 'Valanar';
for (const b of document.querySelectorAll('#topbar .brand')) b.textContent = SITE;
document.title = `${SITE} · Tabletop`;
on('joinFailed', () => { V.store.set('vtt-last-campaign', null); showCampaigns(); });
on('meta', () => {
  $('#campBtn').textContent = state.camp.name;
  document.title = `${state.camp.name} · ${SITE}`;
  if (state.camp.gm !== V.isGM()) document.body.classList.toggle('is-gm', state.camp.gm);
});
on('conn', ok => {
  $('#conn').classList.toggle('bad', !ok);
  $('#conn').title = ok ? 'Connected' : 'Reconnecting…';
  const b = $('#banner');
  b.textContent = 'Lost the connection to the table. Reconnecting…';
  clearTimeout(on.connT);
  if (ok) b.hidden = true; else on.connT = setTimeout(() => { if (!V.connected) b.hidden = false; }, 1500);
});
// nothing to show yet
function renderEmpty() {
  const box = $('#empty');
  if (state.scene) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(h('div', { class: 'box' }, V.isGM()
    ? [h('h2', null, 'No scene yet'), h('p', { class: 'muted' }, 'Drop in a battle map to start. The players will see the first scene you make.'),
       h('button', { class: 'btn primary', onclick: () => V.openWizard(null) }, 'New scene')]
    : [h('h2', null, 'Waiting for the GM'), h('p', { class: 'muted' }, 'The GM hasn’t put up a scene yet. It’ll appear here when they do.')]));
}
on('scene', renderEmpty); on('meta', renderEmpty);
// the side bar can be put away (button at the top right, or the \ key); remembered on this computer
const sideOpen = on => { document.body.classList.toggle('side-closed', !on); V.store.set('vtt-side-open', on); };
if (V.store.get('vtt-side-open', true) === false || matchMedia('(max-width: 700px)').matches) document.body.classList.add('side-closed');   // (on a phone the map comes first)
$('#sideBtn').onclick = () => sideOpen(document.body.classList.contains('side-closed'));
document.addEventListener('keydown', e => { if (e.key === '\\' && !V.isTyping() && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); sideOpen(document.body.classList.contains('side-closed')); } });
// full screen: the whole table (the map, wiki and the rest open inside it, so it stays full screen)
const fsBtn = document.getElementById('fsBtn');
if (fsBtn) fsBtn.onclick = () => { const d = document; if (d.fullscreenElement) d.exitFullscreen().catch(() => {}); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => V.toast('This browser wouldn’t go full screen', true)); };
// who's at the table: everyone in the campaign as a little coloured disc in the top bar, lit while they're
// connected; a note when someone arrives or leaves
let wasOnline = null;
function renderHere() {
  const c = state.camp; if (!c || !Array.isArray(c.online)) return;
  let box = $('#here');
  if (!box) { box = h('div', { id: 'here' }); const at = $('#conn'); if (!at) return; at.after(box); }
  const online = new Set(c.online), people = (c.members || []).slice().sort((a, b) => (b.role === 'gm') - (a.role === 'gm') || a.name.localeCompare(b.name));
  // only who's actually here, side by side
  const here = people.filter(u => online.has(u.id));
  box.replaceChildren(...here.map(u => h('span', { class: 'herep on', style: `--c:${u.color || '#8a8f98'}`,
    title: `${u.name}${u.role === 'gm' ? ' (GM)' : ''}: at the table` }, V.initials(u.name))));
  box.title = `${here.length} of ${people.length} at the table`;
  if (wasOnline) for (const u of people) {
    if (u.id === (state.me && state.me.id)) continue;
    if (online.has(u.id) && !wasOnline.has(u.id)) V.toast(`${u.name} joined the table`);
    else if (!online.has(u.id) && wasOnline.has(u.id)) V.toast(`${u.name} left the table`);
  }
  wasOnline = online;
}
on('meta', renderHere);
// a GM's account that's a player in this campaign (the GM set it so, or they came in by a player's invite): a player here
on('meta', () => {
  if (!state.camp || !state.me || state.me.role !== 'gm' || state.camp.gm || V.asPlayer) return;
  state.me = Object.assign({}, state.me, { role: 'player', realRole: 'gm', here: 'player' });
  document.body.classList.remove('is-gm');
  const rb = document.getElementById('roleBtn'); if (rb) rb.remove();
  $('#me').replaceChildren(h('b', null, state.me.name));
  V.emit('me');
  if (V.renderScene && state.scene) V.renderScene();
});
// hours played, by your name in the top bar: it counts up while the site or the table is open
on('meta', () => {
  const ms = state.camp && state.camp.played; let el = document.getElementById('played');
  if (ms == null) { if (el) el.remove(); return; }
  if (!el) { el = h('span', { id: 'played', class: 'played', title: 'Hours you’ve had the site or the table open' }); $('#me').after(el); }
  el.textContent = V.hoursText ? V.hoursText(ms) + ' played' : '';
});
})();
