/* Side panel (chat and dice, initiative, scenes, players) and the token editor. */
'use strict';
(function () {
const { $, $$, h, state, on } = V;

// ───────────────────────── tabs ─────────────────────────

V.showTab = function (name) {
  for (const b of $$('#side .tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of $$('#side .tab')) s.classList.toggle('on', s.id === 'tab-' + name);
  V.store.set('vtt-tab', name);
  if (name === 'players') renderPlayers();
  if (name === 'chat') scrollChat(true);
  V.emit('tab', name);
};
for (const b of $$('#side .tabs button')) b.addEventListener('click', () => V.showTab(b.dataset.tab));

// ───────────────────────── chat ─────────────────────────

const log = $('#chatlog');
function fmtTime(ts) { const d = new Date(ts); return d.toTimeString().slice(0, 5); }
function rollEl(r) {
  const parts = r.parts.map((p, i) => {
    const sign = p.sign < 0 ? '−' : i ? '+' : '';
    if (!p.dice) return [sign ? ` ${sign} ` : '', String(p.n)];
    return [sign ? ` ${sign} ` : '', h('span', null, ...p.dice.map(d => h('span', { class: 'die' + (d.kept ? '' : ' drop') + (d.v === p.sides && p.sides > 2 ? ' max' : d.v === 1 && p.sides > 2 ? ' min' : ''), title: `d${p.sides}` }, d.v)))];
  });
  return h('div', { class: 'roll' },
    h('div', { class: 'total' }, r.total),
    h('div', { class: 'detail' }, r.label ? h('div', { class: 'lbl' }, r.label) : null, h('div', null, h('span', { class: 'f' }, r.formula), ' · ', ...parts)));
}
// two rolls side by side, the left one counts (as Roll20's "always roll 2d20")
function pairEl(a, b) {
  const box = r => h('div', { class: 'pbox', title: `${r.formula}: ${r.parts.map(p => p.dice ? p.dice.map(d => d.v).join('+') : p.n).join(' + ')}` }, r.total);
  return h('div', { class: 'pair' }, h('div', { class: 'two' + (a.label ? '' : ' nolabel') }, box(a), box(b)), a.label ? h('div', { class: 'plabel' }, a.label) : null);
}
// 2D6: three dice; the left two are the roll, and the third gives advantage/disadvantage without rerolling
function threeEl(r) {
  const d = r.parts[0].dice.map(x => x.v), mod = r.parts.slice(1).reduce((a, p) => a + (p.dice ? 0 : p.sign * p.n), 0);
  const s = [...d].sort((x, y) => y - x);
  const sign = n => (n >= 0 ? '+' : '−') + Math.abs(n);
  return h('div', { class: 'three' },
    h('div', { class: 'roll' },
      h('div', { class: 'total' }, d[0] + d[1] + mod),
      h('div', { class: 'detail' }, r.label ? h('div', { class: 'lbl' }, r.label) : null,
        h('div', null, h('span', { class: 'die' }, d[0]), h('span', { class: 'die' }, d[1]), mod ? ` ${sign(mod)} ` : ' ', h('span', { class: 'die third', title: 'Third die: only for advantage or disadvantage' }, d[2])))),
    h('div', { class: 'advline' }, `Adv ${s[0] + s[1] + mod} · Dis ${s[1] + s[2] + mod} · Major adv ${d[0] + d[1] + d[2] + mod} · Major dis ${d[0] + mod}`));
}
function msgEl(m) {
  if (m.kind === 'system') return h('div', { class: 'msg system' }, m.text);
  if (m.kind === 'divider') return h('div', { class: 'msg divider' + (m.text ? '' : ' bare'), title: `${m.from} · ${fmtTime(m.ts)}` }, m.text ? h('span', null, m.text) : null);
  if (m.kind === 'r20') return V.r20MsgEl(m);
  if (m.kind === 'item' && V.itemMsgEl) return V.itemMsgEl(m);
  if (m.kind === 'spell' && V.spellMsgEl) return V.spellMsgEl(m);
  if (m.kind === 'feature' && V.featureMsgEl) return V.featureMsgEl(m);
  const priv = m.gmOnly || (m.to && m.to.length);
  const tag = m.gmOnly ? 'GM only' : m.to && m.to.length ? (m.uid === state.me.id ? `to ${m.toName}` : 'whispers to you') : '';
  if (m.kind === 'emote') return h('div', { class: 'msg emote', style: `--c:${m.color}` }, `${m.from} ${m.text}`);
  return h('div', { class: 'msg' + (priv ? ' private' : ''), style: `--c:${m.color || '#c9a45c'}`, title: fmtTime(m.ts) },
    h('div', { class: 'who' }, m.from, tag ? h('span', { class: 'tag' }, tag) : null),
    m.kind === 'roll' ? (m.roll2 ? pairEl(m.roll, m.roll2) : m.three ? threeEl(m.roll) : rollEl(m.roll)) : h('div', { class: 'txt' }, m.text));
}
function scrollChat(force) {
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (force || near) log.scrollTop = log.scrollHeight;
}
// a message with a delete button (the GM can delete any message, everyone else their own)
const BIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9l1-13.5"/></svg>';
// the speaker's picture: their character's portrait, or the picture of the token they spoke as
function speakerPic(m) {
  if (m.pic) return m.pic;
  const camp = state.camp || {}, chars = camp.characters || [], face = ch => ch && (ch.token || ch.avatar);
  if (m.char) { const ch = chars.find(c => c.id === m.char); if (face(ch)) return face(ch); }
  if (!m.from) return null;
  const toks = state.scene && state.scene.tokens ? [...state.scene.tokens.values()] : [];
  const t = toks.find(x => x.name === m.from && (x.img || x.sheet));
  if (t) { if (t.img) return t.img; const ch = t.sheet && chars.find(c => c.id === t.sheet); if (face(ch)) return face(ch); }
  return face(chars.find(c => c.name === m.from && face(c))) || null;
}
function msgBox(m) {
  const el = msgEl(m);
  const who = el.querySelector(':scope > .who'), pic = who && speakerPic(m);
  if (pic) { const av = h('span', { class: 'mav' }); av.style.backgroundImage = `url("${String(pic).replace(/"/g, '%22')}")`; who.prepend(av); el.classList.add('haspic'); }
  el.dataset.id = m.id || '';
  if (m.id && (V.isGM() || m.uid === state.me.id)) {
    const b = h('button', { class: 'msgdel', title: 'Delete this message', onclick: e => {
      e.stopPropagation();
      V.send({ t: 'chatDelete', ids: [m.id] }).catch(err => V.toast(err.message, true));
    } });
    b.innerHTML = BIN;
    el.classList.add('deletable');
    el.append(b);
  }
  return el;
}
on('chatGone', ids => { for (const id of ids) { const el = log.querySelector(`[data-id="${CSS.escape(id)}"]`); if (el) el.remove(); } });
V.clearChat = () => {
  if (!confirm('Clear the whole chat log for everyone? This can’t be undone.')) return;
  V.send({ t: 'chatClear' }).catch(err => V.toast(err.message, true));
};
on('chat', m => {
  if (m.reset) log.replaceChildren();
  for (const msg of m.msgs) log.append(msgBox(msg));
  while (log.children.length > 400) log.firstChild.remove();
  scrollChat(m.reset || (m.msgs[0] && m.msgs[0].uid === state.me.id));
  if (!m.reset && !$('#tab-chat').classList.contains('on')) $('#side .tabs [data-tab=chat]').style.color = '#c9a45c';
});
$('#side .tabs [data-tab=chat]').addEventListener('click', e => { e.currentTarget.style.color = ''; });

const history = []; let hi = 0;
$('#chatText').addEventListener('keydown', e => {
  const ta = e.target;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    history.push(text); hi = history.length;
    ta.value = '';
    V.send({ t: 'chat', text, as: $('#speakAs').value || undefined }).catch(err => { V.toast(err.message, true); ta.value = text; });
  } else if (e.key === 'ArrowUp' && !ta.value.includes('\n') && hi > 0) { e.preventDefault(); ta.value = history[--hi]; }
  else if (e.key === 'ArrowDown' && hi < history.length) { e.preventDefault(); hi++; ta.value = history[hi] || ''; }
});

function renderSpeakAs() {
  const sel = $('#speakAs'), cur = sel.value, gm = V.isGM();
  // tokens on this scene you can speak as (one per name), then the journal's characters: the GM any, a player their own
  const seen = new Set();
  const toks = (state.scene ? V.tokensSorted().filter(t => gm ? t.layer === 'tokens' || t.layer === 'gm' : V.canControl(t)) : [])
    .filter(t => t.name && !seen.has(t.name) && seen.add(t.name));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const chars = ((state.camp && state.camp.characters) || []).filter(ch => ch.name && (gm || (ch.owners || []).includes(state.me.id))).sort(byName);
  const kids = [h('option', { value: '' }, `As ${state.me.name}`)];
  if (toks.length) kids.push(h('optgroup', { label: 'Tokens on this scene' }, ...toks.map(t => h('option', { value: t.id }, `As ${t.name}`))));
  if (chars.length) kids.push(h('optgroup', { label: gm ? 'Characters' : 'Your characters' }, ...chars.map(ch => h('option', { value: 'c:' + ch.id }, `As ${ch.name}`))));
  sel.replaceChildren(...kids);
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  sel.hidden = !toks.length && !chars.length;
}
on('tokens', renderSpeakAs); on('scene', renderSpeakAs); on('meta', renderSpeakAs); on('me', renderSpeakAs); on('sel', () => {
  if (V.isGM()) return;   // players speak as the token they pick; the GM chooses by hand
  const t = V.selectedTokens().find(V.canControl);
  if (t && t.name) { renderSpeakAs(); $('#speakAs').value = t.id; }
});

let gmRoll = false;
function renderDice() {
  const bar = $('#dicebar'), mode = (state.camp && state.camp.mode) || '5e';
  bar.replaceChildren(...Dice.PRESETS[mode].map(p => h('button', { title: p.title || p.f, onclick: () => quickRoll(p) }, p.label)));
  if (V.isGM()) bar.append(h('button', { class: 'gmtog' + (gmRoll ? ' on' : ''), title: 'GM only: rolls from these buttons are shown only to you', onclick: e => { gmRoll = !gmRoll; e.currentTarget.classList.toggle('on', gmRoll); } }, 'GM'));
  // a line across the chat (a new block of rolls, the start of a session), with a name if you like
  bar.append(h('button', { class: 'divbtn', title: 'A line across the chat: split rolls into blocks, or mark the start of a session', onclick: e => dividerPop(e.currentTarget) }, '—§—'));
}
function dividerPop(anchor) {
  const old = $('.divpop'); if (old) { old.remove(); return; }
  const inp = h('input', { type: 'text', placeholder: 'A name for it (optional): Session 12…', maxlength: 80 });
  const go = () => { V.send({ t: 'chat', text: '/divider ' + inp.value.trim() }).catch(e => V.toast(e.message, true)); pop.remove(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') pop.remove(); });
  const pop = h('div', { class: 'divpop' }, inp, h('button', { class: 'btn sm primary', onclick: go }, 'Add line'));
  const tab = anchor.closest('#tab-chat'); tab.insertBefore(pop, tab.querySelector('.chatin')); inp.focus();
}
function quickRoll(p) {
  V.send({ t: 'roll', formula: p.f, preset: p.preset, gmOnly: gmRoll, as: $('#speakAs').value || undefined }).catch(e => V.toast(e.message, true));
}
on('meta', renderDice);

// ───────────────────────── initiative ─────────────────────────

function renderInit() {
  const box = $('#tab-init'), init = state.init, gm = V.isGM();
  const entries = init.entries || [];
  const tokenOf = e => state.scene && e.tokenId && state.scene.tokens.get(e.tokenId);
  const setInit = fn => { const next = JSON.parse(JSON.stringify(state.init)); fn(next); return V.op({ t: 'init.set', init: next }); };
  const step = d => setInit(n => {
    if (!n.entries.length) return;
    n.turn += d;
    if (n.turn >= n.entries.length) { n.turn = 0; n.round++; }
    if (n.turn < 0) { n.turn = n.entries.length - 1; n.round = Math.max(1, n.round - 1); }
  });
  const sel = V.selectedTokens().filter(V.canControl);
  const rows = entries.map((e, i) => {
    const t = tokenOf(e);
    return h('div', { class: 'irow' + (i === init.turn ? ' cur' : '') + (e.hidden ? ' hid' : ''), onclick: ev => { if (t && !ev.target.closest('input,button')) { V.setSel([t.id]); V.centreOn(t.x, t.y, true); } } },
      h('span', { class: 'av', style: t && t.img ? `background-image:url("${t.img}")` : `background:${(t && t.color) || '#555'}` }),
      h('span', { class: 'nm', title: e.name }, e.name || '—'),
      gm ? h('input', { type: 'number', value: e.value, title: 'Initiative', onchange: ev => setInit(n => { const x = n.entries.find(y => y.id === e.id); if (x) x.value = +ev.target.value; }) })
         : h('span', { class: 'v' }, e.value),
      gm ? h('button', { class: 'x', title: e.hidden ? 'Hidden from players: click to show' : 'Hide from players', onclick: () => setInit(n => { const x = n.entries.find(y => y.id === e.id); if (x) x.hidden = !x.hidden; }) }, e.hidden ? '◌' : '●') : null,
      gm ? h('button', { class: 'x', title: 'Remove', onclick: () => setInit(n => { const i2 = n.entries.findIndex(y => y.id === e.id); if (i2 >= 0) { n.entries.splice(i2, 1); if (n.turn >= i2 && n.turn > 0) n.turn--; } }) }, '×') : null);
  });
  box.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'round grow' }, entries.length ? `Round ${init.round}` : 'No one in initiative'),
      gm ? h('button', { class: 'btn sm', onclick: () => step(-1), disabled: !entries.length }, '◀') : null,
      gm ? h('button', { class: 'btn sm primary', onclick: () => step(1), disabled: !entries.length }, 'Next turn') : null),
    h('div', { class: 'initlist' }, rows),
    V.isGuest() ? null : h('h3', null, gm ? 'Selected tokens' : 'Your token'),
    V.isGuest() ? null : h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: !sel.length, title: `Roll ${Dice.INIT_DIE[(state.camp && state.camp.mode) || '5e']} for each selected token`, onclick: () => V.send({ t: 'initRoll', scene: state.scene.id, tokens: sel.map(t => t.id), mod: +($('#initMod') || {}).value || 0 }).catch(e => V.toast(e.message, true)) }, sel.length > 1 ? `Roll for ${sel.length} tokens` : 'Roll initiative'),
      h('label', { class: 'inline', title: 'Bonus added to the roll' }, '+', h('input', { id: 'initMod', type: 'number', value: 0, style: 'width:56px' })),
      gm ? h('button', { class: 'btn', disabled: !sel.length, title: 'Add without rolling', onclick: () => setInit(n => {
        for (const t of sel) if (!n.entries.some(x => x.tokenId === t.id)) n.entries.push({ name: t.name, value: 0, tokenId: t.id, scene: state.scene.id, hidden: t.layer === 'gm' });
      }) }, 'Add') : null),
    sel.length || V.isGuest() ? null : h('p', { class: 'muted small' }, gm ? 'Select tokens on the map to roll for them.' : 'Select your token on the map, then roll.'),
    gm && entries.length ? h('div', { class: 'row', style: 'margin-top:14px' },
      h('button', { class: 'btn sm', onclick: () => setInit(n => { const cur = n.entries[n.turn]; n.entries.sort((a, b) => b.value - a.value); n.turn = Math.max(0, n.entries.indexOf(cur)); }) }, 'Sort'),
      h('button', { class: 'btn sm', onclick: () => setInit(n => { n.turn = 0; n.round = 1; }) }, 'Back to round 1'),
      h('button', { class: 'btn sm danger', onclick: () => setInit(n => { n.entries = []; n.turn = 0; n.round = 1; }) }, 'End combat')) : null
  );
}
on('init', renderInit); on('sel', renderInit); on('scene', renderInit); on('meta', renderInit);

// ───────────────────────── scenes (GM) ─────────────────────────

// the scenes in folders: a folder is a name the scenes share (an empty one is kept in this browser until a scene goes in)
const SCN = 'text/vtt-scene';
const EMPTY_KEY = () => 'vtt-scene-folders-' + (state.camp ? state.camp.id : '');
const FOLD_KEY = () => 'vtt-scene-open-' + (state.camp ? state.camp.id : '');
let openFolds = null;
const saveFolds = () => V.store.set(FOLD_KEY(), [...openFolds]);
function sceneFolders(c, viewing) {
  if (!openFolds || openFolds.camp !== c.id) { openFolds = new Set(V.store.get(FOLD_KEY(), [])); openFolds.camp = c.id; }
  const used = [...new Set(c.scenes.map(s => s.folder).filter(Boolean))];
  const extra = V.store.get(EMPTY_KEY(), []).filter(n => !used.includes(n));
  if (extra.length !== V.store.get(EMPTY_KEY(), []).length) V.store.set(EMPTY_KEY(), extra);
  const names = used.concat(extra).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const move = (sid, folder) => { const sc = c.scenes.find(x => x.id === sid); if (sc && (sc.folder || null) !== (folder || null)) V.op({ t: 'scene.update', id: sid, patch: { folder: folder || null } }); };
  const drop = (el, folder) => {
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes(SCN)) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
    el.addEventListener('drop', e => { el.classList.remove('over'); const sid = e.dataTransfer.getData(SCN); if (!sid) return; e.preventDefault(); e.stopPropagation(); move(sid, folder); if (folder) { openFolds.add(folder); saveFolds(); } });
    return el;
  };
  const row = sc => {
    const sel = h('select', { class: 'sfold', title: 'Its folder', onchange: e => {
      let v = e.target.value;
      if (v === '\u0000new') { v = (prompt('Name the new folder') || '').trim(); if (!v) { renderScenes(); return; } openFolds.add(v); saveFolds(); }
      move(sc.id, v || null);
    } }, h('option', { value: '' }, 'No folder'), ...names.map(n => h('option', { value: n, selected: sc.folder === n || null }, n)), h('option', { value: '\u0000new' }, 'New folder…'));
    return h('div', { class: 'srow scn' + (sc.id === viewing ? ' viewing' : ''), draggable: 'true', ondragstart: e => { e.dataTransfer.setData(SCN, sc.id); e.dataTransfer.effectAllowed = 'move'; } },
      sc.kind === 'world' ? h('div', { class: 'th world', title: sc.atlasName ? `The world map: ${sc.atlasName}` : 'The main world map' }, '🗺') : h('div', { class: 'th', style: sc.thumb ? `background-image:url("${sc.thumb}")` : '' }),
      h('div', { class: 'nm' }, h('b', { title: sc.name }, sc.name),
        h('span', { class: 'badge' }, [sc.id === c.playerScene ? 'Players are here' : '', sc.id === viewing ? 'You’re viewing' : ''].filter(Boolean).join(' · ')), sel),
      h('div', { class: 'acts' },
        sc.id !== viewing ? h('button', { class: 'btn sm', onclick: () => V.viewScene(sc.id) }, 'View') : null,
        sc.id !== c.playerScene ? h('button', { class: 'btn sm', title: 'Move the players to this scene', onclick: () => V.op({ t: 'campaign.update', patch: { playerScene: sc.id } }) }, 'Move players') : null,
        h('button', { class: 'btn sm', onclick: () => sc.kind === 'world' ? worldSceneDialog(sc.id) : V.openWizard(sc.id) }, 'Settings'),
        h('button', { class: 'btn sm danger', title: 'Delete (Ctrl+Z undoes it)', onclick: () => { if (confirm(`Delete "${sc.name}"? Undo brings it back.`)) V.op({ t: 'scene.delete', id: sc.id }); } }, 'Delete')));
  };
  const out = names.map(n => {
    const list = c.scenes.filter(sc => sc.folder === n), open = openFolds.has(n);
    const toggle = () => { if (open) openFolds.delete(n); else openFolds.add(n); saveFolds(); renderScenes(); };
    const rename = () => {
      const nn = (prompt('Rename the folder', n) || '').trim(); if (!nn || nn === n) return;
      if (!list.length) { V.store.set(EMPTY_KEY(), V.store.get(EMPTY_KEY(), []).map(x => x === n ? nn : x)); renderScenes(); return; }
      V.op({ t: 'batch', ops: list.map(sc => ({ t: 'scene.update', id: sc.id, patch: { folder: nn } })) }).catch(e => V.toast(e.message, true));
      if (open) { openFolds.add(nn); saveFolds(); }
    };
    const ungroup = () => {
      if (!list.length) { V.store.set(EMPTY_KEY(), V.store.get(EMPTY_KEY(), []).filter(x => x !== n)); renderScenes(); return; }
      if (!confirm(`Take the folder “${n}” away? Its ${list.length} scene${list.length === 1 ? '' : 's'} stay, out of any folder.`)) return;
      V.op({ t: 'batch', ops: list.map(sc => ({ t: 'scene.update', id: sc.id, patch: { folder: null } })) }).catch(e => V.toast(e.message, true));
    };
    return drop(h('div', { class: 'sfolder' + (open ? ' open' : '') },
      h('div', { class: 'sfhead', onclick: toggle },
        h('span', { class: 'tw' }, open ? '▾' : '▸'), h('span', { class: 'fic', html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity="0.85"/></svg>' }),
        h('b', { class: 'fn' }, n), h('span', { class: 'muted small' }, ` ${list.length}`), h('span', { class: 'grow' }),
        h('button', { class: 'ib', title: 'Rename the folder', onclick: e => { e.stopPropagation(); rename(); } }, '✎'),
        h('button', { class: 'ib', title: 'Take the folder away (its scenes stay)', onclick: e => { e.stopPropagation(); ungroup(); } }, '×')),
      open ? h('div', { class: 'sfbody' }, ...list.map(row), list.length ? null : h('p', { class: 'muted small' }, 'Drag scenes here.')) : null), n);
  });
  const loose = c.scenes.filter(sc => !sc.folder);
  out.push(drop(h('div', { class: 'sfloose' }, ...loose.map(row), names.length && !loose.length ? h('p', { class: 'muted small' }, 'Drag a scene here to take it out of its folder.') : null), null));
  return out;
}

function renderScenes() {
  const box = $('#tab-scenes'), c = state.camp;
  if (!c || !V.isGM()) return;
  const viewing = state.scene && state.scene.id;
  box.replaceChildren(
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => V.openWizard(null) }, 'New scene'),
      h('button', { class: 'btn', title: 'Scenes and characters from Foundry VTT', onclick: () => V.openFoundryImport() }, 'Import from Foundry'),
      h('button', { class: 'btn', title: 'The world map as a scene, with its own fog of war: the main map, or a version of it for this campaign’s time', onclick: () => worldSceneDialog(null) }, 'World map scene')),
    h('h3', { class: 'scnhead' }, `Scenes · ${c.scenes.length}`, h('button', { class: 'btn sm', title: 'A folder to sort scenes into (drag scenes onto it)', onclick: () => {
      const n = (prompt('Name the folder') || '').trim(); if (!n) return;
      const extra = V.store.get(EMPTY_KEY(), []); if (!extra.includes(n)) extra.push(n); V.store.set(EMPTY_KEY(), extra); openFolds.add(n); saveFolds(); renderScenes();
    } }, '+ Folder')),
    ...sceneFolders(c, viewing),
    h('h3', null, 'Campaign'),
    h('label', null, 'Name'),
    h('input', { value: c.name, style: 'width:100%', onchange: e => V.op({ t: 'campaign.update', patch: { name: e.target.value } }) }),
    h('label', null, 'Game mode: picks the dice buttons and initiative roll (and later, the character sheet)'),
    h('div', { class: 'seg' }, ...[['5e', 'D&D 5e'], ['2d6', '2D6']].map(([k, l]) => h('button', { class: c.mode === k ? 'on' : null, onclick: () => V.op({ t: 'campaign.update', patch: { mode: k } }) }, l))),
    h('label', { class: 'inline', style: 'margin-top:12px', title: 'People who aren’t logged in can open this table and see what the players see. They can’t move, chat, roll or open private sheets.' },
      h('input', { type: 'checkbox', checked: c.watch !== false, onchange: e => V.op({ t: 'campaign.update', patch: { watch: e.target.checked } }) }), ' Visitors can watch this table')
  );
}
on('meta', renderScenes); on('scene', renderScenes);

// A world map scene: its name, which version of the map it shows (the main one, or one made for this campaign's time,
// which the GM edits from the table without touching the main map), and fog of war.
async function worldSceneDialog(sid) {
  const sc = sid ? (state.camp.scenes || []).find(x => x.id === sid) : null;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const site = (url, body, method) => fetch('/api/site' + url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  let list = { atlases: [], tileSets: [] };
  try { list = await site('/atlases'); } catch (e) { V.toast(e.message, true); }
  let chosen = sc ? sc.atlas || '' : '';
  const name = h('input', { value: sc ? sc.name : 'World map', style: 'width:100%' });
  const fog = h('input', { type: 'checkbox', checked: sc ? null : true });
  const pick = h('div', { class: 'atlaspick' });
  const newBox = h('div', { class: 'atlasnew', hidden: true });
  function drawPick() {
    const opt = (id, title, sub) => h('label', { class: 'atlasopt' + (chosen === id ? ' on' : '') },
      h('input', { type: 'radio', name: 'atlas', checked: chosen === id || null, onchange: () => { chosen = id; drawPick(); } }),
      h('span', null, h('b', null, title), sub ? h('span', { class: 'muted small' }, sub) : null));
    pick.replaceChildren(
      opt('', 'The main world map', 'As it is on the site now; changes to it show here too.'),
      ...list.atlases.map(a => opt(a.id, a.name, `Its own places, borders and names (${a.places}), over ${a.tiles ? 'the picture “' + a.tiles.replace(/[-_]+/g, ' ') + '”' : 'the main picture'}.`)),
      h('button', { class: 'btn sm', style: 'margin-top:6px', onclick: () => { newBox.hidden = !newBox.hidden; } }, '+ A new version of the map…'));
  }
  // a new version: a copy of the main map (or of another version, or empty), over the main picture or another one
  const nName = h('input', { placeholder: 'e.g. Valanar, year 300', style: 'width:100%' });
  const nFrom = h('select', null, h('option', { value: 'main' }, 'A copy of the main map'), ...list.atlases.map(a => h('option', { value: a.id }, 'A copy of “' + a.name + '”')), h('option', { value: 'empty' }, 'No places, borders or names yet'));
  const nTiles = h('select', null, h('option', { value: '' }, 'The main map’s picture'), ...list.tileSets.map(t => h('option', { value: t.id }, t.name)));
  newBox.append(h('label', null, 'Name'), nName,
    h('div', { class: 'two' }, h('div', null, h('label', null, 'Start from'), nFrom), h('div', null, h('label', null, 'Picture'), nTiles)),
    h('p', { class: 'muted small' }, list.tileSets.length ? 'Pictures come from the maps folder: run make_tiles.bat on another version of the world picture and give it a name.' : 'To use a different picture of the world (another era’s coastlines), run make_tiles.bat on it and give it a name; it appears here once it’s on the server.'),
    h('button', { class: 'btn primary sm', onclick: async () => {
      try {
        const r = await site('/atlases', { name: nName.value.trim() || 'Another time', from: nFrom.value, tiles: nTiles.value });
        list.atlases = r.atlases; chosen = r.atlas.id; nName.value = ''; newBox.hidden = true; drawPick();
        V.toast('Made. Open the scene and switch on Edit map to change it: the main map stays as it is.');
      } catch (e) { V.toast(e.message, true); }
    } }, 'Make it'));
  drawPick();
  const cur = chosen && list.atlases.find(a => a.id === chosen);
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(560px, 94vw)' },
    h('div', { class: 'dh' }, h('h2', null, sc ? 'World map scene' : 'New world map scene'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('label', null, 'Name'), name,
      h('label', { style: 'margin-top:12px' }, 'Which map'), pick, newBox,
      sc ? null : h('label', { class: 'inline', style: 'margin-top:12px' }, fog, ' Fog of war: the players see nothing until you reveal it'),
      cur && V.isGM() ? h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm', onclick: async () => { const nm = prompt('Rename this version of the map', cur.name); if (!nm) return; try { list.atlases = (await site('/atlases/' + cur.id, { name: nm }, 'PUT')).atlases; drawPick(); } catch (e) { V.toast(e.message, true); } } }, 'Rename version')) : null),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const nm = name.value.trim() || 'World map';
        if (sc) await V.op({ t: 'scene.update', id: sc.id, patch: { name: nm, atlas: chosen || null } }).catch(() => {});
        else {
          const r = await V.op({ t: 'scene.create', scene: { name: nm, kind: 'world', atlas: chosen || null, fog: !!fog.checked } }).catch(() => null);
          if (r && r.op && r.op.scene) V.viewScene(r.op.scene.id);
        }
        close();
      } }, sc ? 'Save' : 'Make the scene'))));
  modal.hidden = false;
  name.focus();
}
V.worldSceneDialog = worldSceneDialog;

// top bar: which scene the GM is looking at
function renderSceneSel() {
  const box = $('#sceneSel'), c = state.camp;
  box.hidden = !c || !V.isGM() || !c.scenes.length;
  if (box.hidden) return;
  const opt = s => h('option', { value: s.id }, (s.id === c.playerScene ? '● ' : '') + s.name);
  const fnames = [...new Set(c.scenes.map(s => s.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sel = h('select', { title: 'The scene you’re looking at (the players only see theirs)', onchange: e => V.viewScene(e.target.value) },
    ...fnames.map(n => h('optgroup', { label: n }, ...c.scenes.filter(s => s.folder === n).map(opt))), ...c.scenes.filter(s => !s.folder).map(opt));
  sel.value = state.scene ? state.scene.id : '';
  box.replaceChildren(sel, state.scene && state.scene.id !== c.playerScene
    ? h('button', { class: 'chip sm', title: 'Move the players to the scene you’re viewing', onclick: () => V.op({ t: 'campaign.update', patch: { playerScene: state.scene.id } }) }, 'Move players here')
    : h('span', { class: 'pl' }, 'Players are here'));
}
on('meta', renderSceneSel); on('scene', renderSceneSel);
V.viewScene = function (sid) {
  V.store.set('vtt-view-' + state.camp.id, sid);
  V.send({ t: 'view', scene: sid }).catch(e => V.toast(e.message, true));
};

// ───────────────────────── players and invites (GM) ─────────────────────────

// hours played: "1,089 hours played"
const hoursText = ms => { const hrs = Math.floor((ms || 0) / 3600e3); return hrs.toLocaleString('en-GB') + (hrs === 1 ? ' hour' : ' hours'); };
V.hoursText = hoursText;
async function renderPlayers() {
  const box = $('#tab-players');
  if (!V.isGM() || !state.camp) return;
  let inv, mem, srv;
  try {
    [inv, mem, srv] = await Promise.all([V.api(`/api/campaigns/${state.camp.id}/invites`), V.api(`/api/campaigns/${state.camp.id}/members`), V.api('/api/server')]);
  } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
  // on this PC (localhost) links need its network address; anywhere else, the address you're using is the one to share
  const onThisPC = /^(localhost|127\.|\[?::1\]?$)/.test(location.hostname);
  const base = srv.publicUrl || (onThisPC ? (srv.lan[0] || location.origin) : location.origin);
  const linkFor = tok => base.replace(/\/+$/, '') + '/join/' + tok;
  const copy = text => { navigator.clipboard.writeText(text).then(() => V.toast('Link copied'), () => V.toast('Select the link and copy it', true)); };
  const meUser = state.me;
  box.replaceChildren(
    h('h3', null, 'Players'),
    mem.members.length ? h('div', null, ...mem.members.map(u => h('div', { class: 'prow' }, h('span', { class: 'dot', style: `background:${u.color}` }), h('span', { class: 'nm' }, u.name), h('span', { class: 'muted small', title: 'Hours with the site or the table open' }, hoursText((state.camp.playedAll || {})[u.id])),
      u.account === 'gm' && u.id !== state.me.id ? h('select', { class: 'sm', title: 'Their account is a GM’s (they help run the world). In this campaign:', onchange: async e => { try { await V.api(`/api/campaigns/${state.camp.id}/members/${u.id}`, { method: 'PUT', body: { role: e.target.value } }); V.toast(`${u.name} is ${e.target.value === 'gm' ? 'a GM' : 'a player'} here now`); renderPlayers(); } catch (err) { V.toast(err.message, true); } } },
        h('option', { value: 'player', selected: u.here === 'player' || null }, 'Player here'), h('option', { value: 'gm', selected: u.here === 'gm' || null }, 'GM here')) : null,
      h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Remove ${u.name} from this campaign?`)) return; await V.api(`/api/campaigns/${state.camp.id}/members/${u.id}`, { method: 'DELETE' }); renderPlayers(); } }, 'Remove'))))
      : h('p', { class: 'muted' }, 'No players yet. Send one an invite link.'),
    h('h3', null, 'Invite links'),
    h('p', { class: 'muted small' }, 'Each link works once: the player opens it, picks a name and password, and lands in this campaign.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => { await V.api(`/api/campaigns/${state.camp.id}/invites`, { method: 'POST', body: { role: 'player' } }); renderPlayers(); } }, 'New player invite'),
      h('button', { class: 'btn', title: 'A second GM with full control', onclick: async () => { await V.api(`/api/campaigns/${state.camp.id}/invites`, { method: 'POST', body: { role: 'gm' } }); renderPlayers(); } }, 'GM invite')),
    ...inv.invites.map(i => h('div', { class: 'link' },
      h('input', { value: linkFor(i.token), readonly: true, onfocus: e => e.target.select() }),
      h('button', { class: 'btn sm', onclick: () => copy(linkFor(i.token)) }, 'Copy'),
      h('button', { class: 'btn sm danger', title: 'Withdraw this link', onclick: async () => { await V.api(`/api/campaigns/${state.camp.id}/invites/${i.token}`, { method: 'DELETE' }); renderPlayers(); } }, '×'),
      i.role === 'gm' ? h('span', { class: 'small', style: 'color:var(--gold)' }, 'GM') : null)),
    h('h3', null, 'Where players connect'),
    h('p', { class: 'muted small' }, srv.publicUrl ? 'Links use the address below.'
      : !onThisPC ? `Links use this site’s address (${location.origin}).`
      : `Links use this PC’s network address (${srv.lan[0] || 'none found'}), which only works for people on your own network. For players elsewhere, run a tunnel (see the read-me) and paste its address here.`),
    h('div', { class: 'link' }, h('input', { id: 'pubUrl', type: 'url', placeholder: 'https://something.trycloudflare.com', value: srv.publicUrl || '' }),
      h('button', { class: 'btn sm', onclick: async () => { try { await V.api('/api/server', { method: 'POST', body: { publicUrl: $('#pubUrl').value.trim() } }); renderPlayers(); V.toast('Saved'); } catch (e) { V.toast(e.message, true); } } }, 'Save')),
    h('h3', null, 'Your GM account'),
    h('p', { class: 'muted small' }, meUser.hasPassword ? 'You have a password, so you can log in from another computer.' : 'Set a password so you can log in when you’re not at this PC.'),
    h('div', { class: 'two' },
      h('div', null, h('label', null, 'Name'), h('input', { id: 'gmName', value: meUser.name, style: 'width:100%' })),
      h('div', null, h('label', null, 'New password'), h('input', { id: 'gmPass', type: 'password', autocomplete: 'new-password', style: 'width:100%' }))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => {
      try { const r = await V.api('/api/password', { method: 'POST', body: { name: $('#gmName').value, password: $('#gmPass').value } }); state.me = Object.assign(state.me, r.user); V.emit('me'); V.toast('Saved'); renderPlayers(); }
      catch (e) { V.toast(e.message, true); }
    } }, 'Save')),
    srv.local ? h('label', { class: 'inline', style: 'margin-top:12px' }, h('input', { type: 'checkbox', checked: !srv.localNoLogin, onchange: async e => { await V.api('/api/server', { method: 'POST', body: { localNoLogin: !e.target.checked } }); } }), 'Ask for a login on this PC too') : null
  );
}


// ───────────────────────── token editor ─────────────────────────

const openPanels = new Map();   // token id -> element
V.openTokenPanel = function (id) {
  const t = state.scene && state.scene.tokens.get(id); if (!t) return;
  let p = openPanels.get(id);
  if (!p) {
    p = h('div', { class: 'panel' });
    $('#panels').append(p);
    openPanels.set(id, p);
    const [sx, sy] = V.screenOf(t.x, t.y);
    const r = $('#panels').getBoundingClientRect();
    const top = V.clamp(sy - r.top - 120, 10, Math.max(10, r.height - 600));
    p.style.left = V.clamp(sx - r.left + 40, 10, r.width - 340) + 'px';
    p.style.top = top + 'px';
    p.style.maxHeight = (r.height - top - 10) + 'px';
  }
  fillTokenPanel(p, id);
};
function closeTokenPanel(id) { const p = openPanels.get(id); if (p) { p.remove(); openPanels.delete(id); } }
on('tokens', d => {
  for (const id of d.rm) closeTokenPanel(id);
  for (const t of d.up) {
    const p = openPanels.get(t.id);
    // don't redraw under someone who's typing in it
    if (p && !(p.contains(document.activeElement) && V.isTyping())) fillTokenPanel(p, t.id);
  }
});
on('scene', () => { for (const id of [...openPanels.keys()]) closeTokenPanel(id); });

function fillTokenPanel(p, id) {
  const t = state.scene.tokens.get(id); if (!t) return closeTokenPanel(id);
  const gm = V.isGM(), mine = V.canControl(t);
  const set = patch => V.op({ t: 'token.update', scene: state.scene.id, id, patch }).catch(() => fillTokenPanel(p, id));
  const barRow = (label, key) => {
    const b = t[key] || { v: 0, max: 0 };
    return h('div', null, h('label', null, label), h('div', { class: 'bar' },
      h('input', { type: 'text', value: b.v, disabled: !mine, title: 'Current: type a number, or +5 / -3 to adjust', onchange: e => { const v = relative(b.v, e.target.value); e.target.value = v; set({ [key]: { v, max: b.max } }); } }),
      '/', h('input', { type: 'number', value: b.max, disabled: !mine, title: 'Maximum', onchange: e => set({ [key]: { v: b.v || +e.target.value, max: +e.target.value } }) })));
  };
  const head = h('div', { class: 'ph' }, h('b', null, t.name || 'Token'), h('button', { title: 'Close', onclick: () => closeTokenPanel(id) }, '×'));
  dragPanel(p, head);
  const body = h('div', { class: 'pb' },
    V.tokenPanelExtras ? V.tokenPanelExtras(t, set) : null,
    gm ? h('div', null, h('label', null, 'Name'), h('input', { value: t.name, style: 'width:100%', onchange: e => set({ name: e.target.value }) })) : null,
    gm ? h('div', { class: 'tokimg' },
      h('div', { class: 'pv', style: t.img ? `background-image:url("${t.img}")` : `background:${t.color}` }, t.img ? '' : V.initials(t.name)),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => pickImage(url => set({ img: url })) }, t.img ? 'Change image' : 'Add image'),
        t.img ? h('button', { class: 'btn sm', onclick: () => set({ img: null }) }, 'Remove') : null,
        h('input', { type: 'color', value: t.color, title: 'Colour when there’s no image', onchange: e => set({ color: e.target.value }) }))) : null,
    gm && !t.prop ? tokenLook(t, set) : null,
    V.tokenPanelProp ? V.tokenPanelProp(t, set) : null,
    t.prop ? null : h('div', { class: 'two' }, barRow('Hit points', 'hp'), barRow('Second bar', 'bar2')),
    gm ? h('div', { class: 'two' },
      t.prop ? h('div') : h('div', null, h('label', null, 'Size (squares)'), h('input', { type: 'number', min: 0.25, max: 30, step: 0.25, value: t.size || 1, style: 'width:100%', list: 'tokSizes',
        title: 'Squares across: ½ tiny, 1 small or medium, 2 large, 3 huge, 4 gargantuan', onchange: e => set({ size: +e.target.value || 1 }) }),
        h('datalist', { id: 'tokSizes' }, ...[0.5, 1, 2, 3, 4].map(v => h('option', { value: v })))),
      h('div', null, h('label', null, 'Layer'), h('select', { style: 'width:100%', onchange: e => set({ layer: e.target.value }) },
        h('option', { value: 'map', selected: t.layer === 'map' || null }, 'Map layer'), h('option', { value: 'tokens', selected: t.layer === 'tokens' || null }, 'Token layer'), h('option', { value: 'gm', selected: t.layer === 'gm' || null }, 'GM layer (hidden)')))) : null,
    t.prop ? null : h('label', null, 'Conditions'),
    t.prop ? null : h('div', { class: 'conds' }, ...V.CONDITIONS.map(([name, , col]) => h('button', { class: (t.conditions || []).includes(name) ? 'on' : null, style: `--cc:${col}`, disabled: !mine,
      onclick: () => { const c = new Set(t.conditions || []); c.has(name) ? c.delete(name) : c.add(name); set({ conditions: [...c] }); } }, name))),
    mine && V.tokenPanelLight ? V.tokenPanelLight(t, set) : null,
    gm ? h('div', null,
      h('label', null, 'Controlled by'),
      h('div', { class: 'owners' }, ...state.camp.members.filter(m => m.role !== 'gm').map(m => h('label', { class: 'inline' },
        h('input', { type: 'checkbox', checked: (t.owners || []).includes(m.id), onchange: e => { const o = new Set(t.owners || []); e.target.checked ? o.add(m.id) : o.delete(m.id); set({ owners: [...o] }); } }), m.name)),
        state.camp.members.some(m => m.role !== 'gm') ? null : h('span', { class: 'muted small' }, 'No players yet.')),
      t.prop ? null : h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: t.barsPublic, onchange: e => set({ barsPublic: e.target.checked }) }), 'Everyone sees its bars'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: t.nameShown, onchange: e => set({ nameShown: e.target.checked }) }), 'Everyone sees its name'),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn sm', onclick: () => V.op({ t: 'token.order', scene: state.scene.id, id, to: 'front' }) }, 'To front'),
        h('button', { class: 'btn sm', onclick: () => V.op({ t: 'token.order', scene: state.scene.id, id, to: 'back' }) }, 'To back'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => V.op({ t: 'token.delete', scene: state.scene.id, id }) }, 'Delete'))) : null,
  );
  p.replaceChildren(head, body);
}
// how the token looks: a ring or the bare picture, the picture's size within the token, crisp pixel art
function tokenLook(t, set) {
  const zoom = t.scale || 1;
  const preview = v => { const cur = state.scene.tokens.get(t.id); if (cur) { cur.scale = v; V.redrawTokens(); } };
  const out = h('output', null, Math.round(zoom * 100) + '%');
  return h('div', { class: 'toklook' },
    h('div', { class: 'two' },
      h('div', null, h('label', null, 'Frame'), h('select', { style: 'width:100%', onchange: e => set({ ring: e.target.value === '' ? null : e.target.value === '1' }) },
        h('option', { value: '', selected: t.ring == null || null }, `As the scene (${state.scene.meta.rings === false ? 'no ring' : 'ring'})`),
        h('option', { value: '1', selected: t.ring === true || null }, 'Round, with a ring'),
        h('option', { value: '0', selected: t.ring === false || null }, 'Bare picture, no ring'))),
      h('div', null, h('label', null, 'Picture size ', out),
        h('input', { type: 'range', min: 10, max: 400, step: 5, value: Math.round(zoom * 100), style: 'width:100%', title: 'Scale the picture inside the token ([ and ] with the token selected)',
          oninput: e => { out.textContent = e.target.value + '%'; preview(+e.target.value / 100); },
          onchange: e => set({ scale: +e.target.value / 100 }) }))),
    h('label', { class: 'inline', title: 'Sharp edges when scaled: for pixel-art sprites' }, h('input', { type: 'checkbox', checked: !!t.pixel, onchange: e => set({ pixel: e.target.checked }) }), 'Pixel art (keep it crisp)'));
}
function relative(cur, text) {   // "+5" heals, "-3" or "−3" hurts, a plain number sets
  const v = String(text).trim().replace('−', '-').replace(/\s+/g, '');
  if (/^[+-]\d+(\.\d+)?$/.test(v)) return (+cur || 0) + Number(v);
  return Number(v) || 0;
}
function dragPanel(p, handle) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = p.getBoundingClientRect(), box = $('#panels').getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = ev => { p.style.left = V.clamp(ev.clientX - box.left - ox, 0, box.width - 60) + 'px'; p.style.top = V.clamp(ev.clientY - box.top - oy, 0, box.height - 40) + 'px'; };
    document.body.classList.add('dragging');
    const up = () => { document.body.classList.remove('dragging'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });
}
function pickImage(cb) {
  const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { cb(await V.upload(f)); } catch (e) { V.toast(e.message, true); } };
  inp.click();
}
V.pickImage = pickImage;
V.dragPanel = dragPanel;
})();
