/* Item cards: every weapon, armour, piece of gear and magic item as a collectible-style card.
 *  - the compendium: the SRD 5.1 items (data/items-srd.json) plus the GM's own cards (state.camp.items)
 *  - V.cardEl(item): a card; V.showItemCard(item, from): a card up close with what you can do with it
 *  - the Items tab: search and filter, drag a card anywhere
 *  - inventories: each character's cards (V.openInventory), filled by dropping cards on the character in the
 *    Journal, on their sheet, on their token or in their inventory; the sheet's own inventory gets a row too
 *  - on the map: the GM drops cards as loot; anyone clicks loot to see it and picks it up
 *  - in chat: click a card to show it to everyone */
'use strict';
(function () {
const { $, h, state, on } = V;
const DRAG = 'text/x-vtt-item';
V.itemDragType = DRAG;

// ───────── the compendium ─────────
let srd = null, srdP = null;
V.loadItems = () => srdP || (srdP = fetch('/table/data/items-srd.json').then(r => r.json()).then(d => { srd = d; V.emit('itemsLoaded'); return d; }).catch(e => { srdP = null; throw e; }));
const allItems = () => (state.camp && state.camp.items || []).concat(srd ? srd.items : []);
V.itemById = id => allItems().find(i => i.id === id) || null;

const RARITY = { mundane: '', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', 'very rare': 'Very rare', legendary: 'Legendary', artifact: 'Artifact', varies: 'Rarity varies' };
const rclass = r => 'r-' + String(r || 'mundane').replace(' ', '-');

// a little markdown: paragraphs, **bold**, *italic*, tables; everything else is plain text (never HTML)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>').replace(/_(.+?)_/g, '<i>$1</i>');
function mdHTML(text) {
  const out = [];
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(l => l.startsWith('|'))) {
      const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const rows = lines.filter(l => !/^\|\s*:?-{2,}/.test(l));
      out.push('<table>' + rows.map((r, i) => '<tr>' + cells(r).map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('') + '</tr>').join('') + '</table>');
    } else if (lines.every(l => /^[-*•]\s/.test(l))) out.push('<ul>' + lines.map(l => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('') + '</ul>');
    else out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}
V.itemTextHTML = mdHTML;

// ───────── a card ─────────
// o: { mini, qty, notes, onclick }
V.cardEl = function (it, o) {
  o = o || {};
  const art = h('div', { class: 'ca' });
  art.append(V.itemPic(it));
  const stat = it.weapon && it.weapon.damage ? `${it.weapon.damage}${it.weapon.magic ? ' +' + it.weapon.magic : ''} ${it.weapon.dtype || ''}`.trim()
    : it.ac ? 'AC ' + it.ac : null;
  const attune = it.attune ? 'Requires attunement' + (typeof it.attune === 'string' ? ' ' + it.attune.replace(/^by\s+/i, 'by ') : '') : null;
  const text = h('div', { class: 'cx' });
  if (!o.mini) {
    const props = (it.props || []).filter(p => !(it.text || '').includes('**' + p));   // the mundane weapons explain theirs below
    if (props.length) text.append(h('div', { class: 'cprops' }, props.join(' · ')));
    if (attune) text.append(h('div', { class: 'catt' }, attune));
    const body = h('div', { class: 'ctext' }); body.innerHTML = mdHTML(it.text);
    if (body.innerHTML) text.append(body);
    if (o.notes) text.append(h('div', { class: 'cnotes' }, o.notes));
    if (!text.childNodes.length) text.append(h('div', { class: 'cflav' }, flavour(it)));
  }
  const rar = RARITY[it.rarity] || '';
  const el = h('div', { class: `icard ${rclass(it.rarity)} k-${it.kind || 'other'}` + (o.mini ? ' mini' : ''), title: o.mini ? it.name : null, onclick: o.onclick || null },
    h('div', { class: 'cframe' },
      h('div', { class: 'ct' }, h('span', { class: 'cn' }, it.name), it.cost && !o.mini ? h('span', { class: 'cc' }, it.cost) : null),
      art,
      h('div', { class: 'cty' }, h('span', { class: 'cyt' }, it.type || 'Item'), h('span', { class: 'crr', title: rar || 'Mundane' })),
      o.mini ? null : text,
      h('div', { class: 'cb' },
        h('span', { class: 'cw' }, [it.weight ? `${it.weight} lb` : '', rar].filter(Boolean).join(' · ')),
        stat ? h('span', { class: 'cs' }, stat) : null)),
    o.qty > 1 ? h('span', { class: 'cq' }, '×' + o.qty) : null);
  return el;
};
function flavour(it) {
  return { weapon: 'A weapon, ready for use.', armor: 'Protection, of a sort.', gear: 'Useful on the road.', tool: 'The right tool for the job.',
    mount: 'Saves the feet.', magic: 'It hums faintly.', treasure: 'Worth something to someone.' }[it.kind] || '';
}

// ───────── a card up close ─────────
let view = null;
const closeView = () => { if (view) { view.remove(); view = null; } };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) closeView(); });
const myChars = () => (state.camp.characters || []).filter(c => c.canEdit);
const charsHere = () => (state.camp.characters || []);
V.allItems = () => allItems(); V.myChars = () => myChars(); V.pickMenu = (l, c, f) => pickMenu(l, c, f);
// from: { token } an item lying on the map · { char, uid } in someone's inventory · {} the compendium or chat
V.showItemCard = function (it, from) {
  from = from || {};
  closeView();
  if (typeof it === 'string') it = V.itemById(it);
  if (!it) return;
  const entry = from.char && charOf(from.char) && (charOf(from.char).items || []).find(e => e.uid === from.uid);
  const card = V.cardEl(it, { qty: entry && entry.qty, notes: entry && entry.notes });
  card.classList.add('big');
  card.draggable = true;
  card.title = 'Click: show it in the chat · drag: into an inventory or onto the map';
  // while it's dragged the view steps aside (removing the card itself would cancel the drag)
  card.addEventListener('dragstart', e => { setDrag(e, it, from); requestAnimationFrame(() => view && view.classList.add('away')); });
  card.addEventListener('dragend', closeView);
  card.addEventListener('click', () => toChat(it));
  const act = (label, fn, cls, title) => h('button', { class: 'btn sm' + (cls ? ' ' + cls : ''), title, onclick: fn }, label);
  const acts = [act('Show in chat', () => toChat(it), null, 'Everyone sees the card in the chat')];
  const gm = V.isGM();
  if (from.token) {
    const mine = myChars();
    if (mine.length) acts.push(pickMenu('Pick up', mine, c => V.op({ t: 'inv.add', char: c.id, fromToken: { scene: state.scene.id, id: from.token } }).then(() => { V.toast(`${it.name} → ${c.name}`); closeView(); })));
  } else if (entry) {
    const src = charOf(from.char);
    acts.push(h('span', { class: 'qty' },
      h('button', { title: 'One fewer', onclick: () => entry.qty > 1 ? V.op({ t: 'inv.update', char: src.id, uid: entry.uid, patch: { qty: entry.qty - 1 } }).then(reopen) : null }, '−'),
      h('b', null, '×' + entry.qty),
      h('button', { title: 'One more', onclick: () => V.op({ t: 'inv.update', char: src.id, uid: entry.uid, patch: { qty: entry.qty + 1 } }).then(reopen) }, '+')));
    const others = charsHere().filter(c => c.id !== src.id);
    if (others.length) acts.push(pickMenu('Give to…', others, c => V.op({ t: 'inv.give', char: src.id, uid: entry.uid, to: c.id, qty: 1 }).then(() => { V.toast(`${it.name} → ${c.name}`); closeView(); })));
    if (state.scene && state.scene.meta.kind !== 'world') acts.push(act('Drop on the map', () => dropFromInv(src, entry), null, 'Put one down by their token'));
    acts.push(act('Notes', () => { const n = prompt('Notes on this one (charges left, where it came from…)', entry.notes || ''); if (n != null) V.op({ t: 'inv.update', char: src.id, uid: entry.uid, patch: { notes: n } }).then(reopen); }));
    acts.push(act('Remove', () => { if (confirm(`Take ${it.name} out of ${src.name}’s inventory? (Their sheet keeps its row.)`)) V.op({ t: 'inv.remove', char: src.id, uid: entry.uid }).then(closeView); }, 'danger'));
  } else {
    const mine = myChars();
    if (mine.length) acts.push(pickMenu('Add to…', mine, c => V.op({ t: 'inv.add', char: c.id, item: it }).then(() => V.toast(`${it.name} → ${c.name}`))));
    if (gm && state.scene && state.scene.meta.kind !== 'world') acts.push(act('Put on the map', () => { const c = V.viewCenter ? V.viewCenter() : { x: 0, y: 0 }; placeLoot(it, c.x, c.y); closeView(); }, null, 'Loot for the players to find'));
  }
  if (gm && !from.token && !entry) {
    const own = (state.camp.items || []).some(x => x.id === it.id);
    acts.push(act(own ? 'Edit' : 'Copy to edit', () => { closeView(); V.editItem(own ? it : Object.assign({}, it, { id: null, name: it.name })); }, null, own ? 'Change this card' : 'Make your own version of this card'));
  }
  const reopen = () => setTimeout(() => V.showItemCard(it, from), 30);
  view = h('div', { class: 'cardview', onclick: e => { if (e.target === view) closeView(); } },
    h('div', { class: 'cvwrap' }, card, h('div', { class: 'cvacts' }, ...acts),
      srd && String(it.id).startsWith('srd:') ? h('div', { class: 'cvcredit', title: srd.credit }, 'SRD 5.1 · CC-BY-4.0 · Wizards of the Coast') : null),
    h('button', { class: 'cvx', title: 'Close (Esc)', onclick: closeView }, '×'));
  document.body.append(view);
};
const charOf = id => (state.camp.characters || []).find(c => c.id === id);
function pickMenu(label, chars, fn) {
  if (chars.length === 1) return h('button', { class: 'btn sm primary', onclick: () => fn(chars[0]) }, `${label.replace('…', '')} ${label.endsWith('…') ? chars[0].name : '(' + chars[0].name + ')'}`);
  const sel = h('select', { class: 'btn sm primary', onchange: e => { const c = charOf(e.target.value); e.target.value = ''; if (c) fn(c); } },
    h('option', { value: '' }, label), ...chars.map(c => h('option', { value: c.id }, c.name)));
  return sel;
}
function toChat(it) { V.send({ t: 'showItem', item: it }).then(() => V.toast('Shown in the chat')).catch(e => V.toast(e.message, true)); }
function placeLoot(it, x, y) {
  const [sx, sy] = Geom.snap(V.grid(), x, y, 1);
  return V.op({ t: 'token.create', scene: state.scene.id, token: { name: it.name, item: it, x: sx, y: sy, size: 0.8, layer: state.layer || 'tokens', nameShown: true } });
}
function dropFromInv(ch, entry, x, y) {
  if (x == null) {   // beside their token, or the middle of the view
    const t = [...state.scene.tokens.values()].find(t => t.sheet === ch.id);
    const c = t ? { x: t.x + (V.grid().size || 70), y: t.y } : V.viewCenter ? V.viewCenter() : { x: 0, y: 0 };
    x = c.x; y = c.y;
  }
  const [sx, sy] = Geom.snap(V.grid(), x, y, 1);
  return V.op({ t: 'inv.drop', char: ch.id, uid: entry.uid, scene: state.scene.id, x: sx, y: sy }).then(closeView);
}

// ───────── dragging cards ─────────
function setDrag(e, it, from) {
  e.dataTransfer.setData(DRAG, JSON.stringify({ item: it, from: from || {} }));
  e.dataTransfer.setData('text/plain', it.name);
  e.dataTransfer.effectAllowed = 'copyMove';
  document.body.classList.add('itemdrag');
}
document.addEventListener('dragend', () => document.body.classList.remove('itemdrag'));
document.addEventListener('drop', () => setTimeout(() => document.body.classList.remove('itemdrag'), 0));
const readDrag = e => { try { return JSON.parse(e.dataTransfer.getData(DRAG)); } catch (err) { return null; } };
// a card dropped on a character: into their bag (from the map: picked up; from another bag: handed over)
V.giveItemTo = function (cid, d) {
  const ch = charOf(cid); if (!ch || !d || !d.item) return;
  const f = d.from || {};
  if (f.char === cid) return;
  const op = f.token ? { t: 'inv.add', char: cid, fromToken: { scene: state.scene.id, id: f.token } }
    : f.char && f.uid ? { t: 'inv.give', char: f.char, uid: f.uid, to: cid, qty: 1 }
    : { t: 'inv.add', char: cid, item: d.item };
  return V.op(op).then(() => V.toast(`${d.item.name} → ${ch.name}`)).catch(() => {});
};
// any element that stands for a character takes cards
V.itemDropTarget = function (el, cid) {
  const SP = V.spellDragType || 'text/x-vtt-spell';
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes(DRAG) || e.dataTransfer.types.includes(SP)) { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(SP) ? 'copy' : 'move'; el.classList.add('itemdrop'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('itemdrop'); });
  el.addEventListener('drop', e => {
    el.classList.remove('itemdrop');
    if (e.dataTransfer.types.includes(SP)) {   // a spell: onto their sheet's spell list
      const sp = V.readSpellDrag(e); if (!sp) return;
      e.preventDefault(); e.stopPropagation();
      return V.learnSpell(typeof cid === 'function' ? cid() : cid, sp);
    }
    const d = readDrag(e); if (!d) return;
    e.preventDefault(); e.stopPropagation();
    V.giveItemTo(typeof cid === 'function' ? cid() : cid, d);
  });
  return el;
};
// onto the map: onto a token with a sheet → that character; onto the floor → loot (GM) or put down (from a bag)
V.dropItemOnMap = function (e) {
  const d = readDrag(e); if (!d || !state.scene) return;
  const p = V.worldAt(e.clientX, e.clientY), t = V.tokenAt(p.x, p.y), f = d.from || {};
  if (t && t.sheet && charOf(t.sheet) && t.id !== f.token) return V.giveItemTo(t.sheet, d);
  if (f.char && f.uid) { const ch = charOf(f.char), entry = ch && (ch.items || []).find(x => x.uid === f.uid); if (entry) return dropFromInv(ch, entry, p.x, p.y); }
  if (f.token) { const [x, y] = Geom.snap(V.grid(), p.x, p.y, 1); return V.op({ t: 'token.update', scene: state.scene.id, id: f.token, patch: { x, y } }).catch(() => {}); }
  if (V.isGM()) return placeLoot(d.item, p.x, p.y);
  V.toast('Drop it on one of your tokens to keep it', true);
};

// ───────── chat ─────────
V.itemMsgEl = function (m) {
  const it = m.item || {};
  const mini = h('div', { class: `chatcard ${rclass(it.rarity)}`, title: 'Click to see the whole card; drag it to keep it', draggable: 'true',
      onclick: () => V.showItemCard(it),
      ondragstart: e => setDrag(e, it, {}) },
    h('div', { class: 'ccart' }, V.itemPic(it)),
    h('div', { class: 'ccbody' },
      h('div', { class: 'ccname' }, it.name),
      h('div', { class: 'cctype' }, [it.type, RARITY[it.rarity]].filter(Boolean).join(' · ')),
      (() => { const d = h('div', { class: 'cctext' }); d.innerHTML = mdHTML(it.text || ''); return d; })()));
  return h('div', { class: 'msg itemmsg' + (m.gmOnly ? ' private' : ''), style: `--c:${m.color || '#c9a45c'}` },
    h('div', { class: 'who' }, m.from, m.gmOnly ? h('span', { class: 'tag' }, 'GM only') : null), mini);
};

// ───────── the Items tab: folders by kind (Weapons › Martial Melee…), search, a rarity filter ─────────
let filt = { q: '', rarity: '', open: {} };
try { Object.assign(filt, JSON.parse(localStorage.getItem('vtt-items-filter') || '{}')); } catch (e) { /* not kept */ }
if (!filt.open || typeof filt.open !== 'object') filt.open = {};
const TOP = { weapon: 'Weapons', armor: 'Armour', gear: 'Adventuring gear', tool: 'Tools', mount: 'Mounts and vehicles', magic: 'Magic items', treasure: 'Treasure', other: 'Other' };
const TOP_ORDER = ['Homebrew', 'Weapons', 'Armour', 'Adventuring gear', 'Tools', 'Mounts and vehicles', 'Magic items', 'Treasure', 'Other'];
const MAGIC = { 'wondrous item': 'Wondrous items', 'wondrous items': 'Wondrous items', 'wondous item': 'Wondrous items', potion: 'Potions', ring: 'Rings', weapon: 'Weapons',
  armor: 'Armour', wand: 'Wands', staff: 'Staffs', scroll: 'Scrolls', rod: 'Rods' };
function folderOf(it, own) {
  const t = String(it.type || '').split(/ \(|,| ·/)[0].trim();
  if (own) return ['Homebrew', TOP[it.kind] || 'Other'];
  switch (it.kind) {
    case 'weapon': return ['Weapons', t.replace(/ Weapon$/, '') || 'Other'];
    case 'armor': return ['Armour', t === 'Shield' ? 'Shields' : t.replace(/ Armor$/, '') || 'Other'];
    case 'gear': return ['Adventuring gear', /foci|holy symbol/i.test(t) ? 'Spellcasting foci' : /ammunition/i.test(t) ? 'Ammunition' : /pack/i.test(t) ? 'Equipment packs' : /kit/i.test(t) ? 'Kits' : 'General'];
    case 'tool': return ['Tools', t.replace(/Musical Instrument$/, 'Musical instruments').replace(/Artisan's Tools/, 'Artisan’s tools').replace(/Gaming Sets/, 'Gaming sets').replace(/Other Tools/, 'Other tools') || 'Other'];
    case 'mount': return ['Mounts and vehicles', t === 'Tack' ? 'Tack, harness and drawn vehicles' : t.replace(/Mounts and Other Animals/, 'Mounts and other animals').replace(/Waterborne Vehicles/, 'Waterborne vehicles') || 'Other'];
    case 'magic': return ['Magic items', MAGIC[t.toLowerCase()] || 'Wondrous items'];
    default: return [TOP[it.kind] || 'Other', ''];
  }
}
function renderItems() {
  const box = $('#tab-items'); if (!box || !state.camp) return;
  if (!srd) { box.replaceChildren(h('p', { class: 'muted' }, 'Opening the compendium…')); V.loadItems().catch(() => box.replaceChildren(h('p', { class: 'muted' }, 'Couldn’t load the item compendium.'))); return; }
  const gm = V.isGM(), own = state.camp.items || [], ownIds = new Set(own.map(i => i.id));
  const save = () => { try { localStorage.setItem('vtt-items-filter', JSON.stringify(filt)); } catch (e) { /* not kept */ } };
  const row = it => h('div', { class: `irow ${rclass(it.rarity)}`, draggable: 'true', title: 'Click for the card · drag onto a character, a token or the map',
      onclick: () => V.showItemCard(it), ondragstart: e => setDrag(e, it, {}) },
    h('span', { class: 'iic' }, V.itemPic(it)),
    h('span', { class: 'inm' }, h('b', null, it.name), h('span', null, [it.type, RARITY[it.rarity]].filter(Boolean).join(' · '))),
    h('span', { class: 'icost' }, it.cost || ''));
  const tree = h('div', { class: 'ftree' });
  const count = h('span', { class: 'muted small' });
  const draw = () => {
    const q = filt.q.trim().toLowerCase();
    const list = allItems().filter(it => (!filt.rarity || it.rarity === filt.rarity) && (!q || it.name.toLowerCase().includes(q) || (it.type || '').toLowerCase().includes(q)));
    count.textContent = `${list.length} card${list.length === 1 ? '' : 's'}`;
    const tops = new Map();
    for (const it of list) {
      const [a, b] = folderOf(it, ownIds.has(it.id));
      if (!tops.has(a)) tops.set(a, new Map());
      const subs = tops.get(a); if (!subs.has(b)) subs.set(b, []); subs.get(b).push(it);
    }
    const fold = (key, label, n, kids, depth) => {
      const open = q ? true : !!filt.open[key];
      return h('div', { class: 'fold' + (open ? ' open' : '') },
        h('button', { class: 'fhead', onclick: () => { if (q) return; filt.open[key] = !filt.open[key]; save(); draw(); } },
          h('span', { class: 'tw' }, open ? '▾' : '▸'), V.folderIcon ? V.folderIcon() : null, h('b', null, label), h('span', { class: 'fn' }, n)),
        open ? h('div', { class: 'fkids' }, ...kids()) : null);
    };
    tree.replaceChildren(...TOP_ORDER.filter(t => tops.has(t)).map(t => {
      const subs = tops.get(t), n = [...subs.values()].reduce((s, l) => s + l.length, 0);
      return fold(t, t, n, () => {
        const keys = [...subs.keys()].sort((a, b) => a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b));
        if (keys.length === 1 && !keys[0]) return subs.get(keys[0]).slice(0, 300).map(row);
        return keys.map(k => fold(t + '/' + k, k || 'Other', subs.get(k).length, () => subs.get(k).slice(0, 300).map(row)));
      });
    }), list.length ? null : h('p', { class: 'muted small', style: 'padding:8px' }, 'Nothing matches.'));
  };
  const search = h('input', { type: 'search', placeholder: `Search ${allItems().length} items…`, value: filt.q, class: 'isearch', oninput: e => { filt.q = e.target.value; save(); draw(); } });
  const rar = h('select', { class: 'irar', onchange: e => { filt.rarity = e.target.value; save(); draw(); } },
    h('option', { value: '' }, 'Any rarity'), ...Object.entries(RARITY).map(([k, l]) => h('option', { value: k, selected: filt.rarity === k || null }, l || 'Mundane')));
  draw();
  box.replaceChildren(
    h('div', { class: 'ihead' }, search, gm ? h('button', { class: 'btn sm primary', onclick: () => V.editItem({}) }, 'New card') : null,
      gm ? h('button', { class: 'btn sm', title: 'Bring in item cards from a .json file (an array of cards, or { items: [...] })', onclick: importCards }, 'Import') : null),
    h('div', { class: 'row', style: 'margin:6px 0' }, rar, count),
    tree,
    h('p', { class: 'muted small icredit', title: srd.credit }, 'Items from the SRD 5.1 by Wizards of the Coast, CC-BY-4.0. Pictures from game-icons.net, CC BY 3.0.'));
}
// a file of cards into this campaign's homebrew; a card already here by the same name is left alone
function importCards() {
  const pick = h('input', { type: 'file', accept: '.json,application/json' });
  pick.onchange = async () => {
    const f = pick.files && pick.files[0]; if (!f) return;
    let list;
    try { const j = JSON.parse(await f.text()); list = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : null; } catch (e) { list = null; }
    if (!list) return V.toast('That file isn’t a list of item cards.', true);
    const have = new Set((state.camp.items || []).map(i => String(i.name).toLowerCase()));
    const fresh = list.filter(it => it && typeof it === 'object' && it.name && !have.has(String(it.name).toLowerCase()));
    // sent together (one socket keeps them in order), so a big file doesn't wait a round trip a card
    const done = await Promise.allSettled(fresh.map(it => { const item = Object.assign({}, it); delete item.id; return V.op({ t: 'item.create', item }); }));
    const made = done.filter(r => r.status === 'fulfilled').length;
    const skipped = list.length - fresh.length;
    V.toast(`Imported ${made} card${made === 1 ? '' : 's'}` + (skipped ? ` · ${skipped} already here or not a card` : '') + '.');
  };
  pick.click();
}
on('meta', () => { if ($('#tab-items') && $('#tab-items').classList.contains('on')) renderItems(); });
on('itemsLoaded', renderItems);
V.renderItemsTab = renderItems;
on('tab', name => { if (name === 'items') renderItems(); });

// ───────── inventories ─────────
const openInv = new Map();   // char id → panel
V.openInventory = function (cid) {
  const ch = charOf(cid); if (!ch) return;
  let p = openInv.get(cid);
  if (!p) {
    p = h('div', { class: 'panel invpanel' });
    $('#panels').append(p);
    openInv.set(cid, p);
    const r = $('#panels').getBoundingClientRect();
    p.style.left = Math.max(10, r.width - 470) + 'px'; p.style.top = '60px';
    V.itemDropTarget(p, cid);
  }
  fillInv(p, cid);
};
function fillInv(p, cid) {
  const ch = charOf(cid); if (!ch) { p.remove(); openInv.delete(cid); return; }
  const items = ch.items || [];
  const weight = items.reduce((s, e) => s + (+e.item.weight || 0) * e.qty, 0);
  const head = h('div', { class: 'ph' }, h('b', null, `${ch.name} · inventory`), h('span', { class: 'muted small' }, weight ? `${Math.round(weight * 10) / 10} lb` : ''),
    h('button', { title: 'Close', onclick: () => { p.remove(); openInv.delete(cid); } }, '×'));
  V.dragPanel && V.dragPanel(p, head);
  const hand = h('div', { class: 'hand' }, ...items.map(e => {
    const c = V.cardEl(e.item, { mini: true, qty: e.qty, onclick: () => V.showItemCard(e.item, { char: cid, uid: e.uid }) });
    c.draggable = true;
    c.addEventListener('dragstart', ev => setDrag(ev, e.item, { char: cid, uid: e.uid }));
    return c;
  }));
  p.replaceChildren(head, h('div', { class: 'pb' }, items.length ? hand : h('p', { class: 'muted', style: 'padding:10px' },
    ch.canEdit ? 'Empty. Drag cards here from the Items tab, the chat or the map.' : 'Empty.')));
}
on('meta', () => { for (const [cid, p] of openInv) fillInv(p, cid); });

// ───────── the GM's own cards ─────────
const DTYPES = ['slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning', 'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic'];
const KIND_NAMES = { weapon: 'Weapon', armor: 'Armour', gear: 'Gear', tool: 'Tool', mount: 'Mount or vehicle', magic: 'Magic item', treasure: 'Treasure', other: 'Other' };
V.editItem = function (src) {
  const own = src && src.id && (state.camp.items || []).some(x => x.id === src.id);
  const it = Object.assign({ name: 'New item', kind: 'magic', type: 'Wondrous item', rarity: 'uncommon', gi: 'sparkles', text: '' }, JSON.parse(JSON.stringify(src || {})));
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const preview = h('div', { class: 'iepv' });
  const draw = () => { const c = V.cardEl(it); c.classList.add('big'); preview.replaceChildren(c); };
  const field = (label, inp, wide) => h('div', { class: wide ? 'wide' : null }, h('label', null, label), inp);
  const txt = (k, ph, o) => h('input', Object.assign({ value: it[k] || '', placeholder: ph || '', oninput: e => { it[k] = e.target.value; draw(); } }, o || {}));
  const sel = (k, opts, cb) => h('select', { onchange: e => { it[k] = e.target.value; if (cb) cb(); draw(); } }, ...opts.map(([v, l]) => h('option', { value: v, selected: it[k] === v || null }, l)));
  const weapon = () => it.weapon || (it.weapon = { damage: '', dtype: 'slashing', range: '', ranged: false, finesse: false, magic: 0 });
  const wbox = h('div', { class: 'iew' });
  const drawWeapon = () => {
    const w = it.weapon;
    wbox.replaceChildren(...(it.kind === 'weapon' || w ? [
      field('Damage', h('input', { value: w ? w.damage : '', placeholder: '1d8', oninput: e => { weapon().damage = e.target.value.trim(); draw(); } })),
      field('Type', h('select', { onchange: e => { weapon().dtype = e.target.value; draw(); } }, ...DTYPES.map(d => h('option', { value: d, selected: w && w.dtype === d || null }, d)))),
      field('Range', h('input', { value: w ? w.range : '', placeholder: '80/320 ft', oninput: e => { weapon().range = e.target.value; } })),
      field('Magic bonus', h('input', { type: 'number', min: 0, max: 5, value: w ? w.magic || 0 : 0, oninput: e => { weapon().magic = +e.target.value || 0; draw(); } })),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!(w && w.ranged), onchange: e => { weapon().ranged = e.target.checked; } }), 'Ranged'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!(w && w.finesse), onchange: e => { weapon().finesse = e.target.checked; } }), 'Finesse')] : []));
  };
  // the picture: one of the game-icons.net set (searchable), or an uploaded picture
  const icons = h('div', { class: 'ieicons' });
  const drawIcons = (q) => {
    const names = V.gameIconNames().filter(k => !q || k.includes(q.toLowerCase().replace(/\s+/g, '-')));
    icons.replaceChildren(...names.slice(0, 240).map(k => h('button', { class: it.gi === k && !it.img ? 'on' : null, title: k.replace(/-/g, ' '), 'data-k': k,
      onclick: e => { it.gi = k; delete it.icon; delete it.img; for (const x of icons.children) x.classList.toggle('on', x === e.currentTarget); draw(); } }, V.gameIcon(k, it))));
  };
  const iconSearch = h('input', { type: 'search', placeholder: 'Search pictures: sword, potion, skull…', oninput: e => drawIcons(e.target.value.trim()), style: 'flex:1' });
  drawIcons('');
  const pic = h('button', { class: 'btn sm', onclick: () => {
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { it.img = await V.upload(f); draw(); } catch (e) { V.toast(e.message, true); } };
    inp.click();
  } }, 'Use a picture…');
  const save = async () => {
    const item = Object.assign({}, it);
    if (item.weapon && !item.weapon.damage) delete item.weapon;
    item.props = typeof item.propsText === 'string' ? item.propsText.split(',').map(x => x.trim()).filter(Boolean) : item.props;
    delete item.propsText;
    try {
      if (own) await V.op({ t: 'item.update', id: item.id, patch: item });
      else { delete item.id; await V.op({ t: 'item.create', item }); }
      close(); filt.open.Homebrew = true; V.showTab('items');
    } catch (e) { /* toast shown */ }
  };
  modal.replaceChildren(h('div', { class: 'dialog itemedit' },
    h('div', { class: 'dh' }, h('h2', null, own ? 'Edit card' : 'New item card'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('div', { class: 'ieform' },
        field('Name', txt('name'), true),
        field('Kind', sel('kind', Object.entries(KIND_NAMES), drawWeapon)),
        field('Rarity', sel('rarity', Object.entries(RARITY).map(([k, l]) => [k, l || 'Mundane']), () => drawIcons(iconSearch.value.trim()))),
        field('Type line', txt('type', 'Wondrous item · Ring · Martial Melee Weapon'), true),
        field('Cost', txt('cost', '50 gp')),
        field('Weight (lb)', h('input', { type: 'number', min: 0, step: 0.25, value: it.weight || '', oninput: e => { it.weight = e.target.value === '' ? null : +e.target.value; draw(); } })),
        field('Attunement', h('input', { value: it.attune === true ? 'yes' : it.attune || '', placeholder: 'blank: none · yes · by a wizard', oninput: e => { const v = e.target.value.trim(); it.attune = !v ? null : /^yes$/i.test(v) ? true : v; draw(); } })),
        field('Armour class', txt('ac', '16 · +2')),
        field('Properties', h('input', { value: (it.props || []).join(', '), placeholder: 'Finesse, Light', oninput: e => { it.propsText = e.target.value; it.props = e.target.value.split(',').map(x => x.trim()).filter(Boolean); draw(); } }), true),
        wbox,
        field('Text (markdown: **bold**, *italic*, blank line between paragraphs)', h('textarea', { rows: 8, oninput: e => { it.text = e.target.value; draw(); } }, it.text || ''), true),
        field('GM notes on the card (shown in small print)', h('input', { value: it.notes || '', oninput: e => { it.notes = e.target.value; } }), true),
        h('div', { class: 'wide' }, h('label', null, 'Picture'), h('div', { class: 'row' }, pic, iconSearch), icons,
          h('p', { class: 'muted small' }, 'Pictures by the game-icons.net artists, CC BY 3.0.'))),
      preview),
    h('div', { class: 'df' },
      own ? h('button', { class: 'btn danger', onclick: () => { if (confirm(`Delete the card “${it.name}”? Copies already in inventories stay.`)) V.op({ t: 'item.delete', id: it.id }).then(close); } }, 'Delete card') : null,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, own ? 'Save' : 'Make card'))));
  modal.hidden = false;
  drawWeapon(); draw();
};
})();
