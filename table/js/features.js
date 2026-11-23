/* Features: every class feature, racial trait and feat in the SRD 5.1 as a card (data/features-srd.json), the ones
 * the GM has brought in from other books (kept by the server for every campaign, /api/compendium/features: one
 * takes the place of the SRD card it matches), and the things anyone can do on their turn (Dash, Dodge, Disengage…).
 *  - V.featureCardEl(f, o), V.showFeatureCard(f): a card, and a card up close (click it: show it in the chat)
 *  - V.featuresFor(attrs): a character's own features, from the class, level, subclass and race on their sheet
 *  - V.STANDARD_ACTIONS: the actions in combat, as cards
 *  - the Spells tab's "Features" side: every feature by class, subclass and level, races and feats, with search */
'use strict';
(function () {
const { $, h, state, on } = V;

let data = null, srd = null, extra = [], loadP = null;
// the SRD's subclasses are "Champion (Martial Archetype)", 5etools' just "Champion"; "Life" is "Life Domain"
const subBase = s => String(s || '').replace(/\s*\(.*\)$/, '').toLowerCase();
const sameSub = (a, b) => { a = subBase(a); b = subBase(b); return a === b || (!!a && !!b && (a.includes(b) || b.includes(a))); };
const short = f => (f.name.includes(': ') ? f.name.slice(f.name.indexOf(': ') + 2) : f.name).toLowerCase();
function mergeFeatures() {
  // the same option from two books (Blind Fighting is in Tasha's and the 2024 Player's Handbook): one, the newer book's
  const seen = new Map();
  for (const f of extra) {
    const k = [f.kind, f.cls || '', f.sub || '', f.parent || '', (f.races || []).join(','), f.name.toLowerCase(), f.parent || f.kind !== 'class' ? '' : f.level].join('|');
    const o = seen.get(k); if (!o || (f.source === 'XPHB' && o.source !== 'XPHB')) seen.set(k, f);
  }
  const extraU = [...seen.values()];
  const idx = new Map(); for (const f of extraU) { const k = f.kind + '|' + (f.cls || '') + '|' + short(f); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(f); }
  const subs = new Map(); for (const f of extraU) if (f.sub) { if (!subs.has(f.cls)) subs.set(f.cls, new Set()); subs.get(f.cls).add(f.sub); }
  const kept = [];
  for (const s of srd.features) {
    const twins = idx.get(s.kind + '|' + (s.cls || '') + '|' + short(s)) || [];
    if (s.kind === 'race') {
      // a trait several races share (Darkvision): only the races the book has replaced lose the SRD's copy
      const covered = new Set(twins.flatMap(f => f.races || []));
      for (const f of twins) if (!f.gi && s.gi) f.gi = s.gi;
      const left = (s.races || []).filter(r => !covered.has(r));
      if (left.length < (s.races || []).length) { if (left.length) kept.push(Object.assign({}, s, { races: left })); continue; }
    }
    const twin = s.kind === 'race' ? null : twins.find(f => s.kind === 'class' ? sameSub(f.sub, s.sub) && (!!f.sub === !!s.sub) : true);
    if (twin) { if (!twin.gi && s.gi) twin.gi = s.gi; continue; }
    // an SRD subclass feature the book's copy didn't match: under the book's name for that subclass all the same
    const sub = s.sub && [...(subs.get(s.cls) || [])].find(x => sameSub(x, s.sub));
    kept.push(sub ? Object.assign({}, s, { sub }) : s);
  }
  data = { credit: srd.credit, features: extraU.concat(kept) };
  for (const f of extraU) if (f.cls && !CLASSES.includes(f.cls)) CLASSES.push(f.cls);
}
V.loadFeatures = (force) => (!force && loadP) || (loadP = Promise.all([
  srd ? Promise.resolve(srd) : fetch('/table/data/features-srd.json').then(r => r.json()),
  fetch('/api/compendium/features', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }))
]).then(([d, x]) => { srd = d; extra = x.features || []; mergeFeatures(); V.emit('featuresLoaded'); return data; }).catch(e => { loadP = null; throw e; }));
V.importedFeatures = () => extra;
V.allFeatures = () => (data ? data.features : []);

const ORD = n => { n = +n; const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'; return n + s; };
const USE = { action: 'Action', bonus: 'Bonus action', reaction: 'Reaction', free: 'No action' };
V.featureUse = f => USE[f.use] || '';
// where a card comes from, in words: the book's name for the usual abbreviations
const BOOKS = { XPHB: 'Player’s Handbook (2024)', PHB: 'Player’s Handbook (2014)', XDMG: 'Dungeon Master’s Guide (2024)', DMG: 'Dungeon Master’s Guide (2014)',
  XMM: 'Monster Manual (2025)', MM: 'Monster Manual (2014)', XGE: 'Xanathar’s Guide to Everything', TCE: 'Tasha’s Cauldron of Everything',
  EGW: 'Explorer’s Guide to Wildemount', SCAG: 'Sword Coast Adventurer’s Guide', VGM: 'Volo’s Guide to Monsters', MTF: 'Mordenkainen’s Tome of Foes',
  MPMM: 'Mordenkainen Presents: Monsters of the Multiverse', FTD: 'Fizban’s Treasury of Dragons', BGG: 'Bigby Presents: Glory of the Giants', GGR: 'Guildmasters’ Guide to Ravnica',
  SCC: 'Strixhaven: A Curriculum of Chaos', AAG: 'Astral Adventurer’s Guide', BMT: 'The Book of Many Things', FRHOF: 'Forgotten Realms: Heroes of Faerûn', ERLW: 'Eberron: Rising from the Last War' };
V.sourceName = function (x) {
  const src = String((x && x.source) || '').trim(), id = String((x && x.id) || '');
  if (!src && /^srd/.test(id) || /^srd$/i.test(src)) return 'SRD 5.1 · CC-BY-4.0 · Wizards of the Coast';
  if (!src) return 'Homebrew';
  const book = BOOKS[src.toUpperCase()];
  return book ? `${book} (${src})` : src;
};
V.sourceCode = x => { const s = String((x && x.source) || '').trim(); return s ? s : /^srd/.test(String((x && x.id) || '')) ? 'SRD' : ''; };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z]+/g, '');
// "Eldritch Invocation: Agonizing Blast" under Eldritch Invocations → "Agonizing Blast"
const shortName = f => (f.parent && f.name.includes(': ') ? f.name.slice(f.name.indexOf(': ') + 2) : f.name);
V.featureShortName = shortName;
// the step a character of this level has (Bardic Inspiration d8 at 5th)
V.featureStep = (f, lv) => { if (!f.steps || !lv) return null; let s = null; for (const st of f.steps) if (st[0] <= lv) s = st; return s; };

function typeLine(f, lv) {
  if (f.kind === 'basic') return 'Anyone, on their turn';
  if (f.kind === 'race') return 'Racial trait' + (f.races && f.races.length ? ' · ' + f.races.slice(0, 3).join(', ') + (f.races.length > 3 ? '…' : '') : '');
  if (f.kind === 'feat') return 'Feat' + (f.prereq ? ' · needs ' + f.prereq : '');
  if (f.kind === 'background') return 'Background' + (f.feat ? ' · ' + f.feat : '');
  if (f.kind === 'custom') return f.cls || 'Feature';
  const st = V.featureStep(f, lv), where = f.sub ? f.sub.replace(/\s*\(.*\)$/, '') : f.cls;
  return `${where} · ${ORD(st ? st[0] : f.level)} level` + (f.parent ? ` · ${f.parent.replace(/s$/, '')}` : '');
}
V.featureTypeLine = typeLine;

// ───────── a card ─────────
V.featureCardEl = function (f, o) {
  o = o || {};
  const lv = o.level, st = V.featureStep(f, lv);
  const text = h('div', { class: 'cx' });
  if (!o.mini) {
    if (f.steps && f.steps.length > 1) {
      const lab = s => s[1] || (f.steps.every(x => !x[1]) ? '✓' : '—');
      text.append(h('div', { class: 'fsteps' }, ...f.steps.map(s => h('span', { class: 'fst' + (st && s === st && lv ? ' on' : '') },
        h('b', null, ORD(s[0])), f.steps.some(x => x[1]) ? ' ' + lab(s) : ''))));
    }
    const body = h('div', { class: 'ctext' }); body.innerHTML = V.itemTextHTML(f.text || ''); text.append(body);
  }
  const k = f.kind === 'class' ? 'k-' + slug(f.cls) : 'k-' + f.kind;
  const badge = f.kind === 'class' ? String(st ? st[0] : f.level) : f.kind === 'race' ? '◆' : f.kind === 'basic' ? '★' : f.kind === 'background' ? '❖' : '✦';
  const cs = [st && st[1] && st[1].length < 18 ? st[1] : null, f.rest ? (f.rest === 'short' ? 'Short rest' : 'Long rest') : null].filter(Boolean).join(' · ');
  return h('div', { class: `icard feature ${k}` + (o.mini ? ' mini' : ''), title: o.mini ? f.name : null, onclick: o.onclick || null },
    h('div', { class: 'cframe' },
      h('div', { class: 'ct' }, h('span', { class: 'cn' }, shortName(f)), h('span', { class: 'slv', title: f.kind === 'class' ? 'Level' : '' }, badge)),
      h('div', { class: 'ca' }, V.itemPic(f)),
      h('div', { class: 'cty' }, h('span', { class: 'cyt' }, typeLine(f, lv)), f.use ? h('span', { class: 'stag fuse u-' + f.use, title: USE[f.use] }, USE[f.use]) : null),
      o.mini ? null : text,
      h('div', { class: 'cb' }, h('span', { class: 'cw' }, f.kind === 'class' && f.sub ? f.sub : f.kind === 'basic' ? 'Actions in combat' : ''), cs ? h('span', { class: 'cs' }, cs) : null)));
};

// ───────── a card up close ─────────
let view = null;
const closeView = () => { if (view) { view.remove(); view = null; } };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) closeView(); });
V.featureToChat = function (f, o) {
  o = o || {};
  const st = V.featureStep(f, o.level);
  return V.send({ t: 'showFeature', feature: Object.assign({}, f, st && st[1] ? { step: st[1] } : {}, o.level ? { lv: o.level } : {}), as: o.as })
    .then(() => V.toast('Shown in the chat')).catch(e => V.toast(e.message, true));
};
// dragging a feature onto a character (their token, their row in the Journal, their open sheet) puts it on their sheet
const FDRAG = 'text/x-vtt-feature';
V.featureDragType = FDRAG;
const learnable = f => f && ['class', 'race', 'feat', 'background'].includes(f.kind);
// a background's feat card ("Magic Initiate (Cleric)" is the Magic Initiate card)
V.backgroundFeat = bg => {
  const n = String(bg && bg.feat || '').trim(); if (!n) return null;
  const all = V.allFeatures().filter(f => f.kind === 'feat');
  const card = all.find(f => f.name.toLowerCase() === n.toLowerCase()) || all.find(f => f.name.toLowerCase() === n.replace(/\s*\(.*\)\s*$/, '').toLowerCase());
  return card ? { name: n, text: card.text } : { name: n, text: `From the ${bg.name} background.` };
};
V.featureDragData = f => f.kind === 'background'
  ? { name: f.name, text: f.text, kind: 'background', skills: f.skills || [], tool: f.tool || '', feat: V.backgroundFeat(f) }
  : { name: shortName(f), text: f.text, kind: f.kind, cls: f.cls };
function setFDrag(e, f) {
  e.dataTransfer.setData(FDRAG, JSON.stringify(V.featureDragData(f)));
  e.dataTransfer.setData('text/plain', f.name);
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('itemdrag');
}
V.readFeatureDrag = e => { try { return JSON.parse(e.dataTransfer.getData(FDRAG)); } catch (err) { return null; } };
V.learnFeature = function (cid, f) {
  const ch = (state.camp.characters || []).find(c => c.id === cid); if (!ch || !f) return;
  return V.op({ t: 'feat.learn', char: cid, feature: f }).then(() => V.toast(`${f.name} → ${ch.name}’s sheet`)).catch(() => {});
};
V.showFeatureCard = function (f, o) {
  closeView(); o = o || {};
  if (!f) return;
  const card = V.featureCardEl(f, { level: o.level });
  card.classList.add('big');
  card.title = learnable(f) ? 'Click: show it in the chat · drag: onto a character to add it to their sheet' : 'Click: show it in the chat';
  card.addEventListener('click', () => V.featureToChat(f, o));
  if (learnable(f)) { card.draggable = true; card.addEventListener('dragstart', e => { setFDrag(e, f); requestAnimationFrame(() => view && view.classList.add('away')); }); card.addEventListener('dragend', closeView); }
  const credit = f.kind === 'basic' ? 'The actions in combat (SRD 5.1, in short)' : f.kind === 'custom' ? 'From the character’s sheet' : V.sourceName(f);
  const editable = V.isGM() && ['class', 'race', 'feat', 'background'].includes(f.kind);
  const acts = (o.acts || []).slice();
  if (editable) acts.push(h('button', { class: 'btn sm', title: 'Change this card for every campaign (an SRD card: your version takes its place)', onclick: () => { closeView(); editFeature(f); } }, 'Edit card'));
  view = h('div', { class: 'cardview', onclick: e => { if (e.target === view) closeView(); } },
    h('div', { class: 'cvwrap' }, card, h('div', { class: 'cvacts' }, h('button', { class: 'btn sm primary', onclick: () => V.featureToChat(f, o) }, 'Show in chat'), ...acts),
      h('div', { class: 'cvcredit' }, credit)),
    h('button', { class: 'cvx', title: 'Close (Esc)', onclick: closeView }, '×'));
  document.body.append(view);
};

// ───────── changing a card (the GM) ─────────
// Kept with the books brought in, so every campaign sees it. An SRD card can't be changed: the changed copy is saved
// as your own and takes the SRD card's place (the same name, kind and class).
function editFeature(f) {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const own = extra.some(x => x.id === f.id);
  const e = Object.assign({ kind: 'feat', level: 1 }, f, { name: own ? f.name : shortName(f) });
  const inp = (k, attrs) => h('input', Object.assign({ value: e[k] == null ? '' : e[k], style: 'width:100%', oninput: ev => { e[k] = ev.target.value; } }, attrs || {}));
  const kind = h('select', { style: 'width:100%', onchange: ev => { e.kind = ev.target.value; fields(); } },
    ...[['class', 'Class or subclass feature'], ['race', 'Racial trait'], ['feat', 'Feat'], ['background', 'Background']].map(([k, n]) => h('option', { value: k, selected: e.kind === k || null }, n)));
  const use = h('select', { style: 'width:100%', onchange: ev => { e.use = ev.target.value || undefined; } }, h('option', { value: '' }, '—'),
    ...Object.entries(USE).map(([k, n]) => h('option', { value: k, selected: e.use === k || null }, n)));
  const rest = h('select', { style: 'width:100%', onchange: ev => { e.rest = ev.target.value || undefined; } }, h('option', { value: '' }, '—'),
    h('option', { value: 'short', selected: e.rest === 'short' || null }, 'Short rest'), h('option', { value: 'long', selected: e.rest === 'long' || null }, 'Long rest'));
  const text = h('textarea', { rows: 12, style: 'width:100%;font-family:inherit', oninput: ev => { e.text = ev.target.value; } }); text.value = e.text || '';
  const extraBox = h('div');
  const grid = (...xs) => h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px' }, ...xs);
  const field = (label, el) => h('div', null, h('label', null, label), el);
  const fields = () => extraBox.replaceChildren(...(e.kind === 'class' ? [grid(
      field('Class', h('select', { style: 'width:100%', onchange: ev => { e.cls = ev.target.value; } }, ...CLASSES.map(c => h('option', { value: c, selected: e.cls === c || null }, c)))),
      field('Level', inp('level', { type: 'number', min: 1, max: 20 })), field('Subclass (blank: the class’s own)', inp('sub')), field('Under (a choice, e.g. Fighting Style)', inp('parent')))]
    : e.kind === 'race' ? [field('Species (comma between)', h('input', { value: (e.races || []).join(', '), style: 'width:100%', oninput: ev => { e.races = ev.target.value.split(',').map(x => x.trim()).filter(Boolean); } }))]
    : e.kind === 'background' ? [grid(field('Feat', inp('feat')), field('Tool', inp('tool')),
        field('Skills (comma between)', h('input', { value: (e.skills || []).map(k => k.replace(/_/g, ' ')).join(', '), style: 'width:100%', oninput: ev => { e.skills = ev.target.value.split(',').map(x => x.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean); } })),
        field('Ability scores (e.g. int, wis, cha)', h('input', { value: (e.abilities || []).join(', '), style: 'width:100%', oninput: ev => { e.abilities = ev.target.value.split(',').map(x => x.trim().toLowerCase().slice(0, 3)).filter(Boolean); } })))]
    : [field('Prerequisite', inp('prereq'))]));
  if (e.kind === 'class' && !e.cls) e.cls = CLASSES[0];
  fields();
  const save = async () => {
    if (!String(e.name || '').trim() || !String(e.text || '').trim()) return V.toast('It needs a name and some text', true);
    const out = { id: own ? f.id : 'hb:' + slug(e.kind + (e.cls || '') + e.name) + ':' + Date.now().toString(36), name: e.name.trim(), kind: e.kind, text: e.text,
      source: String(e.source || '').trim() || 'Homebrew', use: e.use, rest: e.rest, gi: e.gi };
    if (e.kind === 'class') Object.assign(out, { cls: e.cls, level: Math.max(1, Math.min(20, +e.level || 1)), sub: String(e.sub || '').trim() || undefined, parent: String(e.parent || '').trim() || undefined });
    if (e.kind === 'race') out.races = e.races && e.races.length ? e.races : undefined;
    if (e.kind === 'feat') out.prereq = String(e.prereq || '').trim() || undefined;
    if (e.kind === 'background') Object.assign(out, { feat: String(e.feat || '').trim() || undefined, tool: String(e.tool || '').trim() || undefined,
      skills: e.skills && e.skills.length ? e.skills : undefined, abilities: e.abilities && e.abilities.length ? e.abilities : undefined, equipment: e.equipment });
    try {
      const r = await fetch('/api/compendium/features', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: out }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText);
      close(); await V.loadFeatures(true); V.toast('Saved'); V.showFeatureCard(V.allFeatures().find(x => x.id === j.feature.id) || j.feature);
    } catch (err) { V.toast(err.message, true); }
  };
  const del = own ? h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm(`Delete “${f.name}” for every campaign?` + (/^srd/.test(f.id) ? '' : ' (The SRD card it replaced, if any, comes back.)'))) return;
    try { const r = await fetch('/api/compendium/features?id=' + encodeURIComponent(f.id), { method: 'DELETE', credentials: 'same-origin' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); close(); await V.loadFeatures(true); V.toast('Deleted'); }
    catch (err) { V.toast(err.message, true); }
  } }, 'Delete') : null;
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(640px,96vw)' },
    h('div', { class: 'dh' }, h('h2', null, own ? 'Edit card' : 'Edit card (your own copy)'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      own ? null : h('p', { class: 'muted small' }, /^srd/.test(f.id) ? 'This is an SRD card: your changed copy is saved as your own and shown in its place.' : 'Saved as your own copy, shown in this one’s place.'),
      grid(field('Name', inp('name')), field('Kind', kind)),
      extraBox,
      grid(field('Takes', use), field('Recharges on', rest), field('Source (a book: XPHB, TCE, XGE… or anything)', inp('source', { placeholder: 'Homebrew' }))),
      h('label', null, 'Text (Markdown: **bold**, *italic*, tables)'), text),
    h('div', { class: 'df' }, del, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  modal.hidden = false;
}
V.editFeature = editFeature;

// ───────── in the chat ─────────
V.featureMsgEl = function (m) {
  const f = m.feature || {};
  const k = f.kind === 'class' ? 'k-' + slug(f.cls) : 'k-' + (f.kind || 'basic');
  const mini = h('div', { class: `chatcard featcc ${k}`, title: 'Click to see the whole card', onclick: () => V.showFeatureCard(f, { level: f.lv }) },
    h('div', { class: 'ccart' }, V.itemPic(f)),
    h('div', { class: 'ccbody' },
      h('div', { class: 'ccname' }, shortName(f), f.step && f.step.length < 18 ? h('span', { class: 'ccstep' }, f.step) : null),
      h('div', { class: 'cctype' }, [typeLine(f, f.lv), USE[f.use]].filter(Boolean).join(' · ')),
      (() => { const d = h('div', { class: 'cctext' }); d.innerHTML = V.itemTextHTML(f.text || ''); return d; })()));
  return h('div', { class: 'msg itemmsg' + (m.gmOnly ? ' private' : ''), style: `--c:${m.color || '#c9a45c'}` },
    h('div', { class: 'who' }, m.from, m.gmOnly ? h('span', { class: 'tag' }, 'GM only') : null), mini);
};

// ───────── the actions anyone can take (the SRD's "Actions in Combat", in short) ─────────
const std = (name, gi, use, text) => ({ id: 'std:' + slug(name), name, kind: 'basic', gi, use, text });
V.STANDARD_ACTIONS = [
  std('Attack', 'crossed-swords', 'action', 'Make one melee or ranged attack (more with Extra Attack). You can grapple or shove in place of one of the attacks.'),
  std('Dash', 'running-ninja', 'action', 'Gain extra movement equal to your speed (after any modifiers) for this turn.'),
  std('Disengage', 'exit-door', 'action', 'Your movement doesn’t provoke opportunity attacks for the rest of the turn.'),
  std('Dodge', 'dodge', 'action', 'Until the start of your next turn, attack rolls against you have disadvantage if you can see the attacker, and you make Dexterity saving throws with advantage. You lose this if you’re incapacitated or your speed drops to 0.'),
  std('Help', 'shaking-hands', 'action', 'Give a friend advantage on their next ability check for a task you’re helping with — or on their next attack roll against a creature within 5 feet of you — before the start of your next turn.'),
  std('Hide', 'hood', 'action', 'Make a Dexterity (Stealth) check to hide, if you can’t be clearly seen. While hidden, attack rolls you make have advantage until you’re found or reveal yourself.'),
  std('Ready', 'hourglass', 'action', 'Pick a trigger and a reaction: an action, or moving up to your speed. When the trigger happens before your next turn, you can use your reaction to do it (or ignore it). A readied spell needs concentration until it’s released.'),
  std('Search', 'magnifying-glass', 'action', 'Look for something: a Wisdom (Perception) or Intelligence (Investigation) check, as the GM decides.'),
  std('Use an Object', 'hand', 'action', 'Use an object that needs your action — drink a potion, pull a lever, light a lantern. (Your first object each turn, like drawing a sword, is free.)'),
  std('Grapple', 'grab', 'action', 'In place of one attack: a Strength (Athletics) check against the target’s Athletics or Acrobatics. If you win, its speed is 0 until it breaks free. The target can be at most one size larger than you.'),
  std('Shove', 'shield-bash', 'action', 'In place of one attack: a Strength (Athletics) check against the target’s Athletics or Acrobatics. If you win, knock it prone or push it 5 feet away.'),
  std('Opportunity Attack', 'sword-brandish', 'reaction', 'When a creature you can see leaves your reach, you can use your reaction to make one melee attack against it.'),
];

// ───────── a character's own ─────────
const CLASSES = ['Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
// the classes and levels on a 5e sheet (the community and legacy sheets both keep these)
V.classesOf = function (a) {
  a = a || {};
  const out = [], seen = new Set();
  const add = (name, lv) => {
    const c = CLASSES.find(x => String(name || '').toLowerCase().includes(x.toLowerCase())); if (!c || seen.has(c)) return;
    seen.add(c); out.push({ cls: c, level: Math.max(1, Math.min(20, parseInt(lv, 10) || 1)) });
  };
  const main = a.class || a.class_display;
  if (main) add(main, a[String(main).toLowerCase().split(/\s/)[0] + '_level'] || a.base_level || (/\d+/.exec(a.class_display || '') || [])[0] || a.level);
  for (let i = 1; i <= 3; i++) if (a['multiclass' + i] && a['multiclass' + i + '_flag'] !== '0') add(a['multiclass' + i], a['multiclass' + i + '_lvl']);
  return out;
};
// "Hill Dwarf" is a dwarf; a "Half-Orc" isn't an orc (the 2024 book's Orc), nor a "Half-Elf" an elf
const raceHas = (race, r) => new RegExp('(^|[^a-z-])' + r.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z-])').test(race);
V.featuresFor = function (a) {
  if (!data) return [];
  a = a || {};
  const classes = V.classesOf(a), sub = String(a.subclass || a.subclass_display || '').toLowerCase();
  const race = [a.race, a.subrace, a.race_display].filter(Boolean).join(' ').toLowerCase();
  const out = [];
  for (const f of data.features) {
    if (f.kind === 'class') {
      const c = classes.find(x => x.cls === f.cls); if (!c || f.level > c.level) continue;
      if (f.sub && !(sub && sub.split(/[\s(),]+/).some(w => w.length > 3 && f.sub.toLowerCase().includes(w)))) continue;
      if (f.parent) continue;   // a choice (a fighting style, an invocation): the sheet says which, not us
      out.push(Object.assign({ lv: c.level }, f));
    } else if (f.kind === 'race' && race && !f.parent && (f.races || []).some(r => raceHas(race, r))) out.push(f);
  }
  // one Darkvision, even when the race and the subrace both give it
  const names = new Set();
  return out.filter(f => f.kind !== 'race' || (names.has(f.name.toLowerCase()) ? false : names.add(f.name.toLowerCase())));
};

// ───────── the Features side of the Spells tab ─────────
let filt = { q: '', kind: 'class', cls: '', open: {} };
try { Object.assign(filt, JSON.parse(localStorage.getItem('vtt-features-filter') || '{}')); } catch (e) { /* not kept */ }
const keep = () => { try { localStorage.setItem('vtt-features-filter', JSON.stringify(filt)); } catch (e) { /* not kept */ } };
function row(f) {
  const k = f.kind === 'class' ? 'k-' + slug(f.cls) : 'k-' + f.kind;
  return h('div', { class: `irow frow ${k}`, title: learnable(f) ? 'Click for the card · drag onto a character to add it to their sheet' : 'Click for the card',
      draggable: learnable(f) ? 'true' : null, ondragstart: learnable(f) ? e => setFDrag(e, f) : null, onclick: () => V.showFeatureCard(f) },
    h('span', { class: 'iic' }, V.itemPic(f)),
    h('span', { class: 'inm' }, h('b', null, shortName(f)), h('span', null, typeLine(f) + (V.sourceCode(f) && V.sourceCode(f) !== 'SRD' ? ' · ' + V.sourceCode(f) : ''))),
    f.use ? h('span', { class: 'stags' }, h('i', { title: USE[f.use] }, f.use === 'bonus' ? 'B' : f.use === 'reaction' ? 'R' : f.use === 'free' ? '·' : 'A')) : null);
}
let redraw = null;
function fold(key, label, kids, q, nested) {
  const open = q ? true : !!filt.open[key];
  return h('div', { class: 'fold' + (open ? ' open' : '') },
    h('button', { class: 'fhead', onclick: () => { if (q) return; filt.open[key] = !filt.open[key]; keep(); if (redraw) redraw(); } },
      h('span', { class: 'tw' }, open ? '▾' : '▸'), V.folderIcon(), h('b', null, label), h('span', { class: 'fn' }, String(nested ? nested : kids.length))),
    open ? h('div', { class: 'fkids' }, ...kids) : null);
}
// a feature with its choices under it (Fighting Style → Archery, Defense…)
function withKids(list, all) {
  const out = [], groups = new Map();
  for (const f of list) {
    if (f.parent && list.some(p => p.name === f.parent && p.cls === f.cls && (p.sub || '') === (f.sub || ''))) continue;
    if (f.parent) { if (!groups.has(f.parent)) groups.set(f.parent, []); groups.get(f.parent).push(f); continue; }
    const kids = all.filter(k => k.parent === f.name && k.cls === f.cls && (k.sub || '') === (f.sub || ''));
    out.push(kids.length ? fold('o:' + f.id, f.name, [row(f), ...kids.map(row)], false) : row(f));
  }
  // choices whose feature isn't in this list (Maneuvers, Eldritch Invocations from another book…): a folder of their own
  for (const [p, kids] of groups) out.push(kids.length === 1 ? row(kids[0]) : fold('g:' + (kids[0].cls || '') + p, p, kids.sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name)).map(row), false));
  return out;
}
V.renderFeatures = function (box, head) {
  if (!data) { box.replaceChildren(head, h('p', { class: 'muted' }, 'Opening the features…')); V.loadFeatures().catch(() => box.replaceChildren(head, h('p', { class: 'muted' }, 'Couldn’t load the features.'))); return; }
  const all = data.features, list = h('div', { class: 'ftree' });
  const draw = () => {
    const q = filt.q.trim().toLowerCase();
    const hit = f => !q || f.name.toLowerCase().includes(q) || (f.sub || '').toLowerCase().includes(q) || (f.races || []).some(r => r.toLowerCase().includes(q));
    const kids = [];
    if (filt.kind === 'class') {
      for (const c of CLASSES) {
        if (filt.cls && filt.cls !== c) continue;
        const mine = all.filter(f => f.kind === 'class' && f.cls === c && (hit(f) || (q && f.parent && hit({ name: f.parent }))));
        if (!mine.length) continue;
        const core = mine.filter(f => !f.sub), subs = [...new Set(mine.filter(f => f.sub).map(f => f.sub))];
        const inner = [...withKids(core, mine), ...subs.map(s => fold('s:' + c + s, s, withKids(mine.filter(f => f.sub === s), mine), q))];
        kids.push(fold('c:' + c, c, inner, q, mine.length));
      }
    } else if (filt.kind === 'race') {
      const mine = all.filter(f => f.kind === 'race' && hit(f));
      const races = [...new Set(mine.flatMap(f => f.races || []))].sort();
      for (const r of races) { const of = mine.filter(f => (f.races || []).includes(r)); kids.push(fold('r:' + r, r, withKids(of, of), q)); }
    } else if (filt.kind === 'background') {
      kids.push(...all.filter(f => f.kind === 'background' && hit(f)).sort((a, b) => a.name.localeCompare(b.name)).map(row));
    } else {
      kids.push(...all.filter(f => f.kind === 'feat' && hit(f)).map(row));
      kids.push(fold('std', 'Actions in combat', V.STANDARD_ACTIONS.filter(hit).map(row), q));
    }
    list.replaceChildren(...kids, kids.length ? '' : h('p', { class: 'muted small', style: 'padding:8px' }, 'Nothing matches.'));
  };
  redraw = draw; draw();
  const search = h('input', { type: 'search', placeholder: `Search ${all.length} features…`, value: filt.q, class: 'isearch', oninput: e => { filt.q = e.target.value; keep(); draw(); } });
  const kind = h('div', { class: 'seg' }, ...[['class', 'Classes'], ['race', 'Races'], ['background', 'Backgrounds'], ['feat', 'Feats & actions']].map(([k, l]) =>
    h('button', { class: 'btn sm' + (filt.kind === k ? ' on' : ''), onclick: () => { filt.kind = k; keep(); V.renderSpellsTab(); } }, l)));
  const cls = filt.kind === 'class' ? h('select', { class: 'irar', onchange: e => { filt.cls = e.target.value; keep(); V.renderSpellsTab(); } },
    h('option', { value: '' }, 'Every class'), ...CLASSES.map(c => h('option', { value: c, selected: filt.cls === c || null }, c))) : null;
  box.replaceChildren(head, h('div', { class: 'ihead' }, search,
      V.isGM() && V.compendiumImport ? h('button', { class: 'btn sm', title: 'Bring in class features, subclasses, races, feats and invocations from other books (5etools files)', onclick: () => V.compendiumImport('features') }, 'Import') : null),
    h('div', { class: 'row', style: 'margin:6px 0;gap:6px;flex-wrap:wrap' }, kind, cls), list,
    h('p', { class: 'muted small icredit', title: data.credit }, 'SRD 5.1 features by Wizards of the Coast, CC-BY-4.0' + (extra.length ? `, plus ${extra.length} brought in` : '') + '. Pictures from game-icons.net, CC BY 3.0.'));
};
on('featuresLoaded', () => { if ($('#tab-spells') && $('#tab-spells').classList.contains('on')) V.renderSpellsTab(); });
})();
