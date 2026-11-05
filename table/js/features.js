/* Features: every class feature, racial trait and feat in the SRD 5.1 as a card (data/features-srd.json), and the
 * things anyone can do on their turn (Dash, Dodge, Disengage…).
 *  - V.featureCardEl(f, o), V.showFeatureCard(f): a card, and a card up close (click it: show it in the chat)
 *  - V.featuresFor(attrs): a character's own features, from the class, level, subclass and race on their sheet
 *  - V.STANDARD_ACTIONS: the actions in combat, as cards
 *  - the Spells tab's "Features" side: every feature by class, subclass and level, races and feats, with search */
'use strict';
(function () {
const { $, h, state, on } = V;

let data = null, loadP = null;
V.loadFeatures = () => loadP || (loadP = fetch('/table/data/features-srd.json').then(r => r.json())
  .then(d => { data = d; V.emit('featuresLoaded'); return d; }).catch(e => { loadP = null; throw e; }));
V.allFeatures = () => (data ? data.features : []);

const ORD = n => { n = +n; const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'; return n + s; };
const USE = { action: 'Action', bonus: 'Bonus action', reaction: 'Reaction', free: 'No action' };
V.featureUse = f => USE[f.use] || '';
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
  const badge = f.kind === 'class' ? String(st ? st[0] : f.level) : f.kind === 'race' ? '◆' : f.kind === 'basic' ? '★' : '✦';
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
V.showFeatureCard = function (f, o) {
  closeView(); o = o || {};
  if (!f) return;
  const card = V.featureCardEl(f, { level: o.level });
  card.classList.add('big');
  card.title = 'Click: show it in the chat';
  card.addEventListener('click', () => V.featureToChat(f, o));
  const credit = f.kind === 'basic' ? 'The actions in combat (SRD 5.1, in short)' : f.kind === 'custom' ? 'From the character’s sheet' : 'SRD 5.1 · CC-BY-4.0 · Wizards of the Coast';
  view = h('div', { class: 'cardview', onclick: e => { if (e.target === view) closeView(); } },
    h('div', { class: 'cvwrap' }, card, h('div', { class: 'cvacts' }, h('button', { class: 'btn sm primary', onclick: () => V.featureToChat(f, o) }, 'Show in chat'), ...(o.acts || [])),
      h('div', { class: 'cvcredit' }, credit)),
    h('button', { class: 'cvx', title: 'Close (Esc)', onclick: closeView }, '×'));
  document.body.append(view);
};

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
const CLASSES = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
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
    } else if (f.kind === 'race' && race && !f.parent && (f.races || []).some(r => race.includes(r.toLowerCase()))) out.push(f);
  }
  return out;
};

// ───────── the Features side of the Spells tab ─────────
let filt = { q: '', kind: 'class', cls: '', open: {} };
try { Object.assign(filt, JSON.parse(localStorage.getItem('vtt-features-filter') || '{}')); } catch (e) { /* not kept */ }
const keep = () => { try { localStorage.setItem('vtt-features-filter', JSON.stringify(filt)); } catch (e) { /* not kept */ } };
function row(f) {
  const k = f.kind === 'class' ? 'k-' + slug(f.cls) : 'k-' + f.kind;
  return h('div', { class: `irow frow ${k}`, title: 'Click for the card', onclick: () => V.showFeatureCard(f) },
    h('span', { class: 'iic' }, V.itemPic(f)),
    h('span', { class: 'inm' }, h('b', null, shortName(f)), h('span', null, typeLine(f))),
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
  const out = [];
  for (const f of list) {
    if (f.parent && list.some(p => p.name === f.parent && p.cls === f.cls && (p.sub || '') === (f.sub || ''))) continue;
    const kids = all.filter(k => k.parent === f.name && k.cls === f.cls && (k.sub || '') === (f.sub || ''));
    out.push(kids.length ? fold('o:' + f.id, f.name, [row(f), ...kids.map(row)], false) : row(f));
  }
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
    } else {
      kids.push(...all.filter(f => f.kind === 'feat' && hit(f)).map(row));
      kids.push(fold('std', 'Actions in combat', V.STANDARD_ACTIONS.filter(hit).map(row), q));
    }
    list.replaceChildren(...kids, kids.length ? '' : h('p', { class: 'muted small', style: 'padding:8px' }, 'Nothing matches.'));
  };
  redraw = draw; draw();
  const search = h('input', { type: 'search', placeholder: `Search ${all.length} features…`, value: filt.q, class: 'isearch', oninput: e => { filt.q = e.target.value; keep(); draw(); } });
  const kind = h('div', { class: 'seg' }, ...[['class', 'Classes'], ['race', 'Races'], ['feat', 'Feats & actions']].map(([k, l]) =>
    h('button', { class: 'btn sm' + (filt.kind === k ? ' on' : ''), onclick: () => { filt.kind = k; keep(); V.renderSpellsTab(); } }, l)));
  const cls = filt.kind === 'class' ? h('select', { class: 'irar', onchange: e => { filt.cls = e.target.value; keep(); V.renderSpellsTab(); } },
    h('option', { value: '' }, 'Every class'), ...CLASSES.map(c => h('option', { value: c, selected: filt.cls === c || null }, c))) : null;
  box.replaceChildren(head, h('div', { class: 'ihead' }, search), h('div', { class: 'row', style: 'margin:6px 0;gap:6px;flex-wrap:wrap' }, kind, cls), list,
    h('p', { class: 'muted small icredit', title: data.credit }, 'SRD 5.1 features by Wizards of the Coast, CC-BY-4.0. Pictures from game-icons.net, CC BY 3.0.'));
};
on('featuresLoaded', () => { if ($('#tab-spells') && $('#tab-spells').classList.contains('on')) V.renderSpellsTab(); });
})();
