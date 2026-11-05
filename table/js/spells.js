/* Spells: every spell as a card, in the Spells tab.
 *  - the compendium: the SRD 5.1 spells (data/spells-srd.json) plus whatever the GM has brought in (other books,
 *    homebrew), kept by the server (/api/compendium/spells). A spell brought in replaces the SRD one of the same name.
 *  - V.spellCardEl(spell), V.showSpellCard(spell): a card, and a card up close with what you can do with it
 *  - the tab: folders by level, search, a class filter; drag a spell onto a character (Journal, sheet, token)
 *    to put it on their sheet's spell list
 *  - in chat: click a card to show it to everyone
 *  - a switch at the top turns the tab to the feature cards (features.js) */
'use strict';
(function () {
const { $, h, state, on } = V;
const DRAG = 'text/x-vtt-spell';
V.spellDragType = DRAG;

// ───────── the compendium ─────────
let srd = null, extra = [], loadP = null;
V.loadSpells = (force) => (!force && loadP) || (loadP = Promise.all([
  srd ? Promise.resolve(srd) : fetch('/table/data/spells-srd.json').then(r => r.json()),
  fetch('/api/compendium/spells', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { spells: [] }).catch(() => ({ spells: [] }))
]).then(([s, x]) => { srd = s; extra = x.spells || []; V.emit('spellsLoaded'); }).catch(e => { loadP = null; throw e; }));
function allSpells() {
  const brought = new Set(extra.map(s => s.name.toLowerCase()));
  return extra.concat(srd ? srd.spells.filter(s => !brought.has(s.name.toLowerCase())) : [])
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
V.allSpells = allSpells;

const ORD = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
const SCHOOL = s => s ? s[0].toUpperCase() + s.slice(1) : '';
V.spellTypeLine = sp => sp.level ? `${ORD(sp.level)}-level ${sp.school || ''}${sp.ritual ? ' (ritual)' : ''}` : `${SCHOOL(sp.school)} cantrip`;
const levelName = n => n ? `${ORD(n)} level` : 'Cantrips';

// ───────── a card ─────────
V.spellCardEl = function (sp, o) {
  o = o || {};
  const art = h('div', { class: 'ca' }, V.itemPic(sp));
  const stat = (k, v) => v ? h('div', { class: 'sst' }, h('b', null, k), h('span', null, v)) : null;
  const text = h('div', { class: 'cx' });
  if (!o.mini) {
    text.append(h('div', { class: 'sstats' },
      stat('Casting time', sp.time), stat('Range', sp.range),
      stat('Components', [sp.components, sp.material ? `(${sp.material})` : ''].filter(Boolean).join(' ')),
      stat('Duration', sp.duration)));
    const body = h('div', { class: 'ctext' }); body.innerHTML = V.itemTextHTML(sp.text || '');
    text.append(body);
    if (sp.higher) { const hl = h('div', { class: 'ctext shigher' }); hl.innerHTML = V.itemTextHTML('**At higher levels.** ' + sp.higher); text.append(hl); }
  }
  const tags = [sp.concentration ? h('span', { class: 'stag', title: 'Concentration' }, 'C') : null, sp.ritual ? h('span', { class: 'stag', title: 'Ritual' }, 'R') : null];
  return h('div', { class: `icard spell s-${sp.school || 'evocation'}` + (o.mini ? ' mini' : ''), title: o.mini ? sp.name : null, onclick: o.onclick || null },
    h('div', { class: 'cframe' },
      h('div', { class: 'ct' }, h('span', { class: 'cn' }, sp.name), h('span', { class: 'slv', title: levelName(sp.level) }, sp.level ? String(sp.level) : '✦')),
      art,
      h('div', { class: 'cty' }, h('span', { class: 'cyt' }, V.spellTypeLine(sp)), ...tags, h('span', { class: 'crr', title: SCHOOL(sp.school) })),
      o.mini ? null : text,
      h('div', { class: 'cb' },
        h('span', { class: 'cw' }, [(sp.classes || []).join(', '), sp.source && sp.source !== 'SRD' ? sp.source + (sp.page ? ' p' + sp.page : '') : ''].filter(Boolean).join(' · ')),
        sp.dice ? h('span', { class: 'cs' }, `${sp.dice}${sp.damage ? ' ' + sp.damage : ''}`) : sp.heal ? h('span', { class: 'cs' }, sp.heal.replace(/MOD/, 'mod') + ' healing') : null)));
};

// ───────── a card up close ─────────
let view = null;
const closeView = () => { if (view) { view.remove(); view = null; } };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) closeView(); });
const charOf = id => (state.camp.characters || []).find(c => c.id === id);
const casters = () => (state.camp.characters || []).filter(c => c.canEdit && /^dnd5e/.test(c.sheet || 'dnd5e'));
V.learnSpell = function (cid, sp) {
  const ch = charOf(cid); if (!ch || !sp) return;
  return V.op({ t: 'spell.learn', char: cid, spell: sp }).then(() => V.toast(`${sp.name} → ${ch.name}’s spells`)).catch(() => {});
};
function toChat(sp) { V.send({ t: 'showSpell', spell: sp }).then(() => V.toast('Shown in the chat')).catch(e => V.toast(e.message, true)); }
function setDrag(e, sp) {
  e.dataTransfer.setData(DRAG, JSON.stringify(sp));
  e.dataTransfer.setData('text/plain', sp.name);
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('itemdrag');
}
V.readSpellDrag = e => { try { return JSON.parse(e.dataTransfer.getData(DRAG)); } catch (err) { return null; } };
V.showSpellCard = function (sp) {
  closeView();
  if (!sp) return;
  const card = V.spellCardEl(sp);
  card.classList.add('big');
  card.draggable = true;
  card.title = 'Click: show it in the chat · drag: onto a character to learn it';
  card.addEventListener('dragstart', e => { setDrag(e, sp); requestAnimationFrame(() => view && view.classList.add('away')); });
  card.addEventListener('dragend', closeView);
  card.addEventListener('click', () => toChat(sp));
  const acts = [h('button', { class: 'btn sm', onclick: () => toChat(sp) }, 'Show in chat')];
  const mine = casters();
  if (mine.length === 1) acts.push(h('button', { class: 'btn sm primary', onclick: () => V.learnSpell(mine[0].id, sp) }, `Learn (${mine[0].name})`));
  else if (mine.length) acts.push(h('select', { class: 'btn sm primary', onchange: e => { const id = e.target.value; e.target.value = ''; if (id) V.learnSpell(id, sp); } },
    h('option', { value: '' }, 'Learn…'), ...mine.map(c => h('option', { value: c.id }, c.name))));
  if (V.isGM()) {
    const own = extra.some(x => x.id === sp.id);
    acts.push(h('button', { class: 'btn sm', onclick: () => { closeView(); editSpell(own ? sp : Object.assign({}, sp, { id: null, source: 'Homebrew' })); } }, own ? 'Edit' : 'Copy to edit'));
    if (own) acts.push(h('button', { class: 'btn sm danger', onclick: async () => {
      if (!confirm(`Remove “${sp.name}” from the spells you’ve brought in?`)) return;
      try { await api('/api/compendium/spells?id=' + encodeURIComponent(sp.id), { method: 'DELETE' }); closeView(); await V.loadSpells(true); } catch (e) { V.toast(e.message, true); }
    } }, 'Remove'));
  }
  const credit = String(sp.id || '').startsWith('srd:') ? 'SRD 5.1 · CC-BY-4.0 · Wizards of the Coast' : sp.source && sp.source !== 'Homebrew' ? `Brought in by the GM · ${sp.source}` : 'Homebrew';
  view = h('div', { class: 'cardview', onclick: e => { if (e.target === view) closeView(); } },
    h('div', { class: 'cvwrap' }, card, h('div', { class: 'cvacts' }, ...acts), h('div', { class: 'cvcredit' }, credit)),
    h('button', { class: 'cvx', title: 'Close (Esc)', onclick: closeView }, '×'));
  document.body.append(view);
};

// ───────── chat ─────────
V.spellMsgEl = function (m) {
  const sp = m.spell || {};
  const mini = h('div', { class: `chatcard spellcc s-${sp.school || 'evocation'}`, title: 'Click to see the whole card', draggable: 'true',
      onclick: () => V.showSpellCard(sp), ondragstart: e => setDrag(e, sp) },
    h('div', { class: 'ccart' }, V.itemPic(sp)),
    h('div', { class: 'ccbody' },
      h('div', { class: 'ccname' }, sp.name),
      h('div', { class: 'cctype' }, V.spellTypeLine(sp)),
      h('div', { class: 'ccstats' }, [sp.time, sp.range, sp.duration].filter(Boolean).join(' · ')),
      (() => { const d = h('div', { class: 'cctext' }); d.innerHTML = V.itemTextHTML(sp.text || ''); return d; })()));
  return h('div', { class: 'msg itemmsg' + (m.gmOnly ? ' private' : ''), style: `--c:${m.color || '#c9a45c'}` },
    h('div', { class: 'who' }, m.from, m.gmOnly ? h('span', { class: 'tag' }, 'GM only') : null), mini);
};

// ───────── the Spells tab ─────────
let filt = { q: '', cls: '', open: { 0: true } };
try { Object.assign(filt, JSON.parse(localStorage.getItem('vtt-spells-filter') || '{}')); } catch (e) { /* not kept */ }
const keep = () => { try { localStorage.setItem('vtt-spells-filter', JSON.stringify(filt)); } catch (e) { /* not kept */ } };
const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="currentColor"/></svg>';
V.folderIcon = () => { const s = h('span', { class: 'fic' }); s.innerHTML = FOLDER; return s; };
function spellRow(sp) {
  return h('div', { class: `irow srow s-${sp.school}`, draggable: 'true', title: 'Click for the card · drag onto a character to learn it',
      onclick: () => V.showSpellCard(sp), ondragstart: e => setDrag(e, sp) },
    h('span', { class: 'iic' }, V.itemPic(sp)),
    h('span', { class: 'inm' }, h('b', null, sp.name), h('span', null, [V.spellTypeLine(sp), sp.source && sp.source !== 'SRD' ? sp.source : ''].filter(Boolean).join(' · '))),
    h('span', { class: 'stags' }, sp.concentration ? h('i', { title: 'Concentration' }, 'C') : null, sp.ritual ? h('i', { title: 'Ritual' }, 'R') : null));
}
function renderSpells() {
  const box = $('#tab-spells'); if (!box || !state.camp) return;
  // the tab holds two decks: spells, and features (classes, races, feats, the actions in combat)
  const side = h('div', { class: 'deckswitch' }, ...[['spells', 'Spells'], ['features', 'Features']].map(([k, l]) =>
    h('button', { class: (filt.view || 'spells') === k ? 'on' : '', onclick: () => { filt.view = k; keep(); renderSpells(); } }, l)));
  if (filt.view === 'features' && V.renderFeatures) return V.renderFeatures(box, side);
  if (!srd) { box.replaceChildren(h('p', { class: 'muted' }, 'Opening the spells…')); V.loadSpells().catch(() => box.replaceChildren(h('p', { class: 'muted' }, 'Couldn’t load the spells.'))); return; }
  const all = allSpells(), gm = V.isGM();
  const classes = [...new Set(all.flatMap(s => s.classes || []))].sort();
  const list = h('div', { class: 'ftree' });
  const draw = () => {
    const q = filt.q.trim().toLowerCase();
    const match = all.filter(s => (!filt.cls || (s.classes || []).includes(filt.cls)) &&
      (!q || s.name.toLowerCase().includes(q) || (s.school || '').includes(q) || (s.source || '').toLowerCase() === q));
    const by = new Map(); for (const s of match) { if (!by.has(s.level)) by.set(s.level, []); by.get(s.level).push(s); }
    list.replaceChildren(...[...by.keys()].sort((a, b) => a - b).map(lv => {
      const open = q ? true : !!filt.open[lv];
      const kids = by.get(lv);
      return h('div', { class: 'fold' + (open ? ' open' : '') },
        h('button', { class: 'fhead', onclick: () => { if (q) return; filt.open[lv] = !filt.open[lv]; keep(); draw(); } },
          h('span', { class: 'tw' }, open ? '▾' : '▸'), V.folderIcon(), h('b', null, levelName(lv)), h('span', { class: 'fn' }, kids.length)),
        open ? h('div', { class: 'fkids' }, ...kids.slice(0, q ? 80 : 400).map(spellRow)) : null);
    }), match.length ? null : h('p', { class: 'muted small', style: 'padding:8px' }, 'No spells match.'));
  };
  const search = h('input', { type: 'search', placeholder: `Search ${all.length} spells…`, value: filt.q, class: 'isearch', oninput: e => { filt.q = e.target.value; keep(); draw(); } });
  const cls = h('select', { class: 'irar', onchange: e => { filt.cls = e.target.value; keep(); draw(); } },
    h('option', { value: '' }, 'Every class'), ...classes.map(c => h('option', { value: c, selected: filt.cls === c || null }, c)));
  const sources = [...new Set(extra.map(s => s.source || 'Homebrew'))];
  draw();
  box.replaceChildren(side,
    h('div', { class: 'ihead' }, search, gm ? h('button', { class: 'btn sm', title: 'Bring in spells from other books (5etools files) or make your own', onclick: importDialog }, 'Import') : null,
      gm ? h('button', { class: 'btn sm primary', onclick: () => editSpell({}) }, 'New') : null),
    h('div', { class: 'row', style: 'margin:6px 0' }, cls, h('span', { class: 'muted small' }, sources.length ? 'SRD + ' + sources.join(', ') : 'SRD 5.1')),
    list,
    h('p', { class: 'muted small icredit', title: srd.credit }, 'SRD spells by Wizards of the Coast, CC-BY-4.0. Pictures from game-icons.net, CC BY 3.0.'));
}
on('spellsLoaded', () => { if ($('#tab-spells') && $('#tab-spells').classList.contains('on')) renderSpells(); });
on('tab', name => { if (name === 'spells') renderSpells(); });
V.renderSpellsTab = renderSpells;

// ───────── bringing spells in (GM) ─────────
const api = (url, opts) => fetch(url, Object.assign({ credentials: 'same-origin' }, opts)).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
function importDialog() {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const status = h('div', { class: 'muted small', style: 'min-height:1.4em' });
  const counts = () => { const m = new Map(); for (const s of extra) m.set(s.source || 'Homebrew', (m.get(s.source || 'Homebrew') || 0) + 1); return [...m]; };
  const have = h('div', { class: 'spsrc' });
  const drawHave = () => have.replaceChildren(...(counts().length ? counts().map(([src, n]) => h('div', { class: 'row' }, h('b', null, src), h('span', { class: 'muted' }, `${n} spell${n === 1 ? '' : 's'}`), h('div', { class: 'grow' }),
    h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Remove all ${n} spells from ${src}?`)) return; await api('/api/compendium/spells?source=' + encodeURIComponent(src), { method: 'DELETE' }); await V.loadSpells(true); drawHave(); } }, 'Remove')))
    : [h('p', { class: 'muted small' }, 'Nothing brought in yet: the tab has the 319 SRD spells.')]));
  drawHave();
  const send = async (body, label) => {
    status.textContent = `Bringing in ${label}…`;
    try {
      const r = await api('/api/compendium/spells/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      status.textContent = r.classes ? 'Class lists brought in: spells now know which classes have them.' : `${label}: ${r.added} new, ${r.replaced} updated (${(r.sources || []).join(', ')}).`;
      await V.loadSpells(true); drawHave();
    } catch (e) { status.textContent = `${label}: ${e.message}`; }
  };
  const file = h('input', { type: 'file', accept: '.json,application/json', multiple: true, onchange: async () => { for (const f of file.files) await send(await f.text(), f.name); file.value = ''; } });
  const link = h('input', { type: 'url', placeholder: 'https://…/spells-xge.json', style: 'flex:1' });
  modal.replaceChildren(h('div', { class: 'dialog' },
    h('div', { class: 'dh' }, h('h2', null, 'Bring in spells'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('p', null, 'The table comes with the 319 spells of the SRD 5.1, which are free to share. Spells from other books (the rest of the Player’s Handbook, Xanathar’s Guide…) aren’t, so bring in your own copies: they’re kept on this server, for your campaigns only.'),
      h('p', { class: 'muted small' }, 'It reads 5etools spell files (spells-phb.json, spells-xge.json…; add gendata-spell-source-lookup.json too so spells know their classes), the 5e-database JSON, and spell lists exported from another table like this one. A spell brought in replaces the SRD spell of the same name.'),
      h('label', null, 'From files on this computer'), file,
      h('label', { style: 'margin-top:10px' }, 'Or from a link'),
      h('div', { class: 'row' }, link, h('button', { class: 'btn primary', onclick: () => link.value.trim() && send(JSON.stringify({ url: link.value.trim() }), link.value.trim().split('/').pop()) }, 'Bring in')),
      status,
      h('h3', { style: 'margin:14px 0 6px' }, 'Brought in'), have,
      h('p', { class: 'muted small' }, h('a', { href: '#', onclick: e => { e.preventDefault(); exportSpells(); } }, 'Download the spells you’ve brought in'), ' (to move them to another table).')),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Done'))));
  modal.hidden = false;
}
function exportSpells() {
  const blob = new Blob([JSON.stringify({ spells: extra }, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'spells.json' }); document.body.append(a); a.click(); a.remove();
}

// ───────── the GM's own spells ─────────
const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
function editSpell(src) {
  const own = src && src.id && extra.some(x => x.id === src.id);
  const sp = Object.assign({ name: 'New spell', level: 1, school: 'evocation', time: '1 action', range: '60 feet', components: 'V, S', duration: 'Instantaneous', classes: [], text: '', source: 'Homebrew' }, JSON.parse(JSON.stringify(src || {})));
  delete sp.gi;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const preview = h('div', { class: 'iepv' });
  const draw = () => { const c = V.spellCardEl(sp); c.classList.add('big'); preview.replaceChildren(c); };
  const field = (label, inp, wide) => h('div', { class: wide ? 'wide' : null }, h('label', null, label), inp);
  const txt = (k, ph) => h('input', { value: sp[k] || '', placeholder: ph || '', oninput: e => { sp[k] = e.target.value; draw(); } });
  const save = async () => {
    try {
      const r = await api('/api/compendium/spells', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spell: Object.assign({}, sp, { id: own ? sp.id : undefined }) }) });
      close(); await V.loadSpells(true); V.showTab('spells'); V.showSpellCard(r.spell);
    } catch (e) { V.toast(e.message, true); }
  };
  modal.replaceChildren(h('div', { class: 'dialog itemedit' },
    h('div', { class: 'dh' }, h('h2', null, own ? 'Edit spell' : 'New spell'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('div', { class: 'ieform' },
        field('Name', txt('name'), true),
        field('Level', h('select', { onchange: e => { sp.level = +e.target.value; draw(); } }, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => h('option', { value: n, selected: sp.level === n || null }, n ? ORD(n) : 'Cantrip')))),
        field('School', h('select', { onchange: e => { sp.school = e.target.value; draw(); } }, ...SCHOOLS.map(s => h('option', { value: s, selected: sp.school === s || null }, SCHOOL(s))))),
        field('Casting time', txt('time', '1 action')), field('Range', txt('range', '60 feet')),
        field('Components', txt('components', 'V, S, M')), field('Material', txt('material', 'a pinch of sulphur')),
        field('Duration', txt('duration', 'Concentration, up to 1 minute')),
        field('Classes', h('input', { value: (sp.classes || []).join(', '), placeholder: 'Wizard, Sorcerer', oninput: e => { sp.classes = e.target.value.split(',').map(x => x.trim()).filter(Boolean); draw(); } })),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!sp.concentration, onchange: e => { sp.concentration = e.target.checked; draw(); } }), 'Concentration'),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!sp.ritual, onchange: e => { sp.ritual = e.target.checked; draw(); } }), 'Ritual'),
        field('Damage dice', txt('dice', '8d6')), field('Damage type', txt('damage', 'fire')),
        field('Saving throw', h('select', { onchange: e => { sp.save = e.target.value; } }, ...['', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(s => h('option', { value: s, selected: (sp.save || '') === s || null }, s || 'None')))),
        field('Spell attack', h('select', { onchange: e => { sp.attack = e.target.value; } }, ...[['', 'None'], ['melee', 'Melee'], ['ranged', 'Ranged']].map(([v, l]) => h('option', { value: v, selected: (sp.attack || '') === v || null }, l)))),
        field('Text (markdown: **bold**, *italic*, blank line between paragraphs)', h('textarea', { rows: 8, oninput: e => { sp.text = e.target.value; draw(); } }, sp.text || ''), true),
        field('At higher levels', h('textarea', { rows: 2, oninput: e => { sp.higher = e.target.value; draw(); } }, sp.higher || ''), true),
        field('Book', txt('source', 'Homebrew'))),
      preview),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, own ? 'Save' : 'Make spell'))));
  modal.hidden = false;
  draw();
}
V.editSpell = editSpell;
})();
