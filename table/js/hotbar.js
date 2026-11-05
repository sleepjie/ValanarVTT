/* The action bar: click one of your tokens and what it can do comes up along the bottom of the map.
 *  - Attacks: the weapons on its sheet, one click to roll (through the sheet's own button where it has one)
 *  - Spells: cantrips and prepared spells as cards; click to cast from the sheet, right-click to read the card
 *  - Features: its class features and racial traits (SRD 5.1, by class, subclass, level and race on the sheet)
 *    plus the actions and traits written on the sheet itself; click to show one in the chat
 *  - Actions: what anyone can do on their turn (Dash, Disengage, Dodge, Help, Hide…), to show in the chat
 *  - the bag: hover for its item cards, click for the inventory
 * GMs get it for any token linked to a character; players for their own. */
'use strict';
(function () {
const { $, h, state, on } = V;

// ───────── the sheet behind the token: attributes, fetched once and kept up to date ─────────
const attrs = new Map();          // char id → { attrs }
const asked = new Set();
function want(cid) {
  if (attrs.has(cid) || asked.has(cid)) return;
  asked.add(cid);
  V.send({ t: 'charOpen', char: cid }).catch(() => asked.delete(cid));
}
on('charState', c => { if (!c || !c.id) return; attrs.set(c.id, Object.assign({}, c.attrs || {})); if (cur && cur.char === c.id) draw(); });
on('charAttrs', m => {
  const a = attrs.get(m.char); if (!a) return;
  Object.assign(a, m.set || {}); for (const k of m.remove || []) delete a[k];
  if (cur && cur.char === m.char) { clearTimeout(on._hb); on._hb = setTimeout(draw, 250); }
});

// ───────── what's on the sheet ─────────
const charOf = id => (state.camp.characters || []).find(c => c.id === id);
// (text brought in from 5etools keeps its tags' bones: "Short Rest|XPHB|Short or Long Rest|XPHB" → "Short or Long Rest")
const clean = s => String(s == null ? '' : s).replace(/(?:[\w'][\w']*\s?){1,2}\|[A-Z]{2,6}\|/g, '').replace(/\|[A-Z]{2,6}\b/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// repeating rows: { section: { rowid: { field: value } } }
function rows(a, re) {
  const out = new Map();
  for (const k in a) {
    const m = /^repeating_([^_]+)_(-[^_]+)_(.+)$/.exec(k); if (!m || !re.test(m[1])) continue;
    const key = m[1] + '|' + m[2]; if (!out.has(key)) out.set(key, { sec: m[1], id: m[2] });
    out.get(key)[m[3]] = a[k];
  }
  return [...out.values()];
}
const dmgDice = s => (/^\s*([0-9d+\-\s]+)/i.exec(String(s || '')) || [])[1];
function attacksOf(ch, a) {
  const out = [];
  if (ch.sheet === 'dnd5e') {      // the community sheet: six melee and six ranged slots
    for (const kind of ['melee', 'ranged']) for (let i = 1; i <= 6; i++) {
      const n = clean(a[kind + 'weaponname' + i]); if (!n) continue;
      out.push({ name: n, kind, hit: a[kind + 'tohit' + i], dmg: [a[kind + 'dmg' + i], a[kind + 'dmgtype' + i]].filter(Boolean).join(' '),
        ref: (kind === 'melee' ? 'MeleeAttack' : 'RangedAttack') + i });
    }
  }
  if (!out.length) for (const r of rows(a, /^attack$/i)) {   // the legacy sheet's attacks (and imported ones)
    const n = clean(r.atkname); if (!n) continue;
    out.push({ name: n, kind: /range|bow|sling|dart|javelin|crossbow|blowgun/i.test(n + ' ' + (r.atkrange || '')) ? 'ranged' : 'melee', hit: r.atkbonus, dmg: clean(r.atkdmgtype),
      ref: ch.sheet === 'dnd5e_legacy' ? `repeating_attack_${r.id}_attack` : null, row: r });
  }
  return out;
}
function spellsOf(ch, a) {
  const list = [];
  const legacy = ch.sheet === 'dnd5e_legacy';
  for (const r of rows(a, legacy ? /^spell-(cantrip|\d)$/i : /^spellbook(cantrip|level\d)$/i)) {
    const n = clean(r.spellname); if (!n) continue;
    const lvm = /(\d)$/.exec(r.sec), lv = lvm ? +lvm[1] : 0;
    const prep = legacy ? r.spellprepared : r.spellisprepared;
    list.push({ name: n, level: lv, prepared: lv === 0 || prep === 'on' || prep === '1' || prep === 1, prepKnown: prep != null,
      ref: `repeating_${r.sec}_${r.id}_${legacy ? 'spell' : 'SpellCast'}`, row: r });
  }
  // if the sheet keeps track of what's prepared, only those (and cantrips); otherwise all of them
  const tracks = list.some(s => s.level && s.prepKnown);
  return list.filter(s => !tracks || s.prepared).sort((x, y) => x.level - y.level || x.name.localeCompare(y.name));
}
// the features the sheet itself lists (its class actions, traits, or a "Name: what it does" block)
function blocks(text) {   // "Savage Attacker: …\n\nSecond Wind: …" → [{ name, text }]
  const out = [];
  for (const b of String(text || '').split(/\n\s*\n/)) {
    const m = /^\s*([A-Z][^:\n]{1,40}):\s*([\s\S]*)$/.exec(b);
    if (!m) { if (out.length) out[out.length - 1].text += '\n\n' + b.trim(); continue; }
    let name = m[1].trim(), rest = m[2];
    const m2 = /^([A-Z][^:\n]{1,30}):\s*([\s\S]*)$/.exec(rest);   // "Fighting Style: Defense: …"
    if (m2 && out.some(x => x.name === name)) { name += ': ' + m2[1].trim(); rest = m2[2]; }
    out.push({ name, text: rest.trim() });
  }
  return out;
}
function sheetFeatures(ch, a) {
  const out = [];
  const add = f => { f.name = clean(f.name); f.text = clean(f.text); if (f.name && !out.some(x => x.name.toLowerCase() === f.name.toLowerCase())) out.push(f); };
  for (const k in a) {
    const m = /^classactionname(\d+)$/.exec(k); if (!m || !clean(a[k])) continue;
    add({ id: 'sheet:ca' + m[1], kind: 'custom', name: a[k], text: a['classactiondescription' + m[1]] || '', ref: 'classaction' + m[1], cls: 'From the sheet' });
  }
  for (const r of rows(a, /^(traits|classactions|npcaction|npctrait)$/i)) {
    const n = clean(r.name || r.classactionname); if (!n) continue;
    const desc = r.description || r.classactiondescription || r.desc || '', bs = blocks(desc);
    if (bs.length >= 2 || bs.length && /^(class|racial|race) (features|traits)$/i.test(n)) { for (const b of bs) add({ id: 'sheet:' + r.id + ':' + b.name, kind: 'custom', name: b.name, text: b.text, cls: r.source ? r.source + ' feature' : 'From the sheet' }); continue; }
    add({ id: 'sheet:' + r.id, kind: 'custom', name: n, text: desc, cls: [r.source, r.source_type].filter(Boolean).join(' · ') || 'From the sheet' });
  }
  for (const b of blocks(a.class_features)) add({ id: 'sheet:cf:' + b.name, kind: 'custom', name: b.name, text: b.text, cls: 'Class feature' });
  for (const f of out) {
    const t = f.text.toLowerCase();
    f.use = /bonus action/.test(t) ? 'bonus' : /\breaction\b/.test(t) ? 'reaction' : /\b(use|take) (an|your|the|one) (magic |additional )?action|as an action|\baction\b to\b/.test(t) ? 'action' : undefined;
    if (/^action surge/i.test(f.name)) f.use = 'free';
    if (/short rest/.test(t)) f.rest = 'short'; else if (/long rest/.test(t) && /(regain|until you finish|once you use)/.test(t)) f.rest = 'long';
  }
  return out;
}
function featuresOf(ch, a) {
  const own = sheetFeatures(ch, a), srd = V.featuresFor ? V.featuresFor(a) : [];
  const names = new Set(own.map(f => f.name.toLowerCase()));
  // the sheet's own write-up wins over the SRD card of the same name (it may be a newer edition, or homebrew)
  const all = srd.filter(f => !names.has(f.name.toLowerCase())).concat(own.map(f => Object.assign(f, { gi: iconFor(f) })));
  const rank = f => f.use === 'action' ? 0 : f.use === 'bonus' ? 1 : f.use === 'reaction' ? 2 : f.use === 'free' ? 3 : f.rest ? 4 : 5;
  return all.sort((x, y) => rank(x) - rank(y) || (x.level || 0) - (y.level || 0) || x.name.localeCompare(y.name));
}
// a picture for a feature written on the sheet: the SRD card of a similar name, else a guess from its words
function iconFor(f) {
  const all = V.allFeatures ? V.allFeatures() : [];
  const n = f.name.toLowerCase().replace(/\s*\(.*\)$/, '');
  const same = all.find(x => x.name.toLowerCase() === n || V.featureShortName(x).toLowerCase() === n);
  if (same) return same.gi;
  const t = (f.name + ' ' + f.text).toLowerCase();
  for (const [re, gi] of [[/rage/, 'wolf-howl'], [/heal|hit points/, 'healing'], [/spell|magic/, 'magic-swirl'], [/attack|weapon|strike/, 'sword-brandish'], [/move|speed|dash/, 'running-ninja'], [/hide|stealth/, 'hood'], [/resist|save/, 'healing-shield']]) if (re.test(t)) return gi;
  return 'star-swirl';
}

// ───────── doing things ─────────
const speakAs = () => ($('#speakAs') && $('#speakAs').value) || undefined;
function rollAttack(ch, at) {
  if (at.ref) return V.runSheetButton(ch.id, at.ref);
  // no button for it on this sheet: roll it straight (to hit, then damage)
  const hit = String(at.hit || '+0').replace(/\s/g, ''), as = ch.name;
  V.send({ t: 'roll', formula: '1d20' + (/^[+-]/.test(hit) ? hit : '+' + hit), label: `${at.name} (to hit)`, as })
    .then(() => { const d = dmgDice(at.dmg); if (d) return V.send({ t: 'roll', formula: d.trim(), label: `${at.name} (${(String(at.dmg).replace(d, '').trim() || 'damage')})`, as }); })
    .catch(e => V.toast(e.message, true));
}
function srdSpell(name) {
  const all = V.allSpells ? V.allSpells() : [];
  const n = name.toLowerCase();
  return all.find(s => s.name.toLowerCase() === n) || null;
}
function spellCard(sp) { return srdSpell(sp.name) || { name: sp.name, level: sp.level, school: String(sp.row.spellschool || '').toLowerCase().replace(/[^a-z]/g, '') || 'evocation', time: sp.row.spellcasttime, range: sp.row.spellrange, duration: sp.row.spellduration, components: sp.row.spellcomponents, text: clean(sp.row.spelldescription || sp.row.spellcontent || '') }; }
function castSpell(ch, sp) { V.runSheetButton(ch.id, sp.ref); }
function useFeature(ch, f, lv) {
  if (f.ref) return V.runSheetButton(ch.id, f.ref);
  V.featureToChat(f, { level: f.lv || lv, as: ch.name });
}

// ───────── the bar ─────────
let cur = null, bar = null, tray = null, bagPop = null;
function mount() {
  if (bar) return bar;
  bar = h('div', { id: 'hotbar', hidden: true });
  ($('#app') || document.body).append(bar);
  return bar;
}
function target() {
  if (!state.scene || !state.camp) return null;
  const sel = V.selectedTokens(); if (sel.length !== 1) return null;
  const t = sel[0]; if (!t.sheet || !V.canControl(t)) return null;
  const ch = charOf(t.sheet); if (!ch || !ch.canEdit && !V.isGM()) return null;
  return { token: t.id, char: ch.id };
}
function update() {
  const t = target();
  if (!t) { if (cur) { cur = null; closeTray(); if (bar) bar.hidden = true; document.body.classList.remove('hbon'); } return; }
  const changed = !cur || cur.char !== t.char;
  cur = t;
  if (changed) {   // (and a hidden copy of the sheet, warmed up for the first click)
    const ch = charOf(t.char); if (ch && ch.canEdit && /^dnd5e/.test(ch.sheet || '') && V.warmSheet) setTimeout(() => cur && cur.char === t.char && V.warmSheet(t.char), 400);
  }
  if (changed) { closeTray(); want(t.char); if (V.loadFeatures) V.loadFeatures().then(() => cur && draw()).catch(() => {}); if (V.loadSpells) V.loadSpells().catch(() => {}); }
  draw();
}
on('sel', update);
on('conn', () => { attrs.clear(); asked.clear(); if (cur) { cur = null; update(); } });
on('meta', () => { if (cur) update(); });
on('scene', () => update());

const levelOf = a => (V.classesOf ? V.classesOf(a) : []).reduce((s, c) => s + c.level, 0) || +a.level || 1;
function btn(cls, icon, label, title, onclick, extra) {
  return h('button', Object.assign({ class: 'hb ' + cls, title, onclick }, extra || {}), icon ? V.uiIcon(icon, 'hbi') : null, label ? h('span', { class: 'hbl' }, label) : null);
}
function draw() {
  mount();
  if (!cur) { bar.hidden = true; return; }
  const ch = charOf(cur.char); if (!ch) { bar.hidden = true; return; }
  const a = attrs.get(ch.id);
  bar.hidden = false; document.body.classList.add('hbon');
  const tok = state.scene && state.scene.tokens.get(cur.token), hp = tok && tok.hp && tok.hp.max ? tok.hp : null;
  const who = h('div', { class: 'hbwho', title: 'Open the sheet', onclick: () => V.openSheet(ch.id) },
    h('span', { class: 'av', style: ch.avatar ? `background-image:url("${ch.avatar}")` : '' }, ch.avatar ? '' : V.initials(ch.name),
      hp ? h('span', { class: 'hbhp', title: `${hp.v} / ${hp.max} hit points` }, h('i', { style: `width:${Math.max(0, Math.min(100, hp.v / hp.max * 100))}%` }), h('em', null, `${hp.v}/${hp.max}`)) : null),
    h('span', { class: 'hbn' }, h('b', null, ch.name), a ? h('span', null, (V.classesOf(a).map(c => `${c.cls} ${c.level}`).join(' / ')) || '') : null));
  if (!a) { bar.replaceChildren(who, h('span', { class: 'hbwait' }, 'Opening the sheet…')); return; }
  const is5e = /^dnd5e/.test(ch.sheet || '');
  const parts = [who];
  if (is5e) {
    const atks = attacksOf(ch, a);
    if (atks.length) parts.push(h('div', { class: 'hbgrp' }, ...atks.slice(0, 6).map(at =>
      btn('atk', at.kind === 'ranged' ? 'bow-arrow' : 'sword-brandish', at.name, `${at.name}${at.hit ? ' · ' + (/^[+-]/.test(at.hit) ? at.hit : '+' + at.hit) + ' to hit' : ''}${at.dmg ? ' · ' + at.dmg : ''}\nClick to roll`, () => rollAttack(ch, at),
        { oncontextmenu: e => { e.preventDefault(); V.openSheet(ch.id); } }))));
    const sps = spellsOf(ch, a), feats = featuresOf(ch, a);
    const grp = [];
    if (sps.length) grp.push(btn('tray' + (tray && tray.kind === 'spells' ? ' on' : ''), 'spell-book', `Spells`, 'Cantrips and prepared spells', () => openTray('spells'), { 'data-n': sps.length }));
    if (feats.length) grp.push(btn('tray' + (tray && tray.kind === 'features' ? ' on' : ''), 'star-swirl', 'Features', 'Class features and traits', () => openTray('features'), { 'data-n': feats.length }));
    grp.push(btn('tray' + (tray && tray.kind === 'actions' ? ' on' : ''), 'running-ninja', 'Actions', 'Dash, Disengage, Dodge, Help, Hide…', () => openTray('actions')));
    parts.push(h('div', { class: 'hbgrp' }, ...grp));
  }
  const items = ch.items || [], n = items.reduce((s, e) => s + (e.qty || 1), 0);
  const bag = btn('bag', 'backpack', 'Bag', 'Inventory: hover for the cards, click for the bag', () => V.openInventory(ch.id), { 'data-n': n || null });
  bag.addEventListener('mouseenter', () => showBag(bag, ch));
  bag.addEventListener('mouseleave', () => hideBag(false));
  parts.push(h('div', { class: 'hbgrp' }, bag));
  bar.replaceChildren(...parts);
  // the keys, as in an MMO: 1 to 9 for the slots from the left (0 still fits the map to the screen)
  [...bar.querySelectorAll('.hb')].slice(0, 9).forEach((b, i) => { const k = String(i + 1); b.dataset.key = k; b.prepend(h('span', { class: 'hbk' }, k)); });
  if (tray) fillTray();
}
document.addEventListener('keydown', e => {
  if (!bar || bar.hidden || !cur || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key) || V.isTyping()) return;
  if (document.querySelector('.hpq:not([hidden])')) return;   // (typing hit points: -7, =20…)
  const b = bar.querySelector(`.hb[data-key="${e.key}"]`); if (!b) return;
  e.preventDefault(); b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 160); b.click();
});
on('tokens', () => { if (cur && bar && !bar.hidden) { clearTimeout(on._hp); on._hp = setTimeout(draw, 200); } });

// ───────── the tray of cards above the bar ─────────
function closeTray() { if (tray) { tray.el.remove(); tray = null; if (bar) bar.querySelectorAll('.hb.tray.on').forEach(b => b.classList.remove('on')); } }
function openTray(kind) {
  if (tray && tray.kind === kind) return closeTray();
  closeTray();
  tray = { kind, el: h('div', { class: 'hbtray' }) };
  ($('#app') || document.body).append(tray.el);
  fillTray(); draw();
}
function fillTray() {
  const ch = charOf(cur && cur.char), a = ch && attrs.get(ch.id);
  if (!tray || !ch || !a) return;
  const lv = levelOf(a);
  const head = (t, hint) => h('div', { class: 'hbth' }, h('b', null, t), h('span', null, hint), h('button', { class: 'hbx', title: 'Close', onclick: closeTray }, '×'));
  const cards = [];
  if (tray.kind === 'spells') {
    const sps = spellsOf(ch, a);
    let last = -1;
    for (const sp of sps) {
      if (sp.level !== last) { last = sp.level; cards.push(h('div', { class: 'hbsep' }, sp.level ? `Level ${sp.level}` : 'Cantrips')); }
      const c = V.spellCardEl(spellCard(sp), { mini: true, onclick: () => castSpell(ch, sp) });
      c.title = `${sp.name}\nClick to cast · right-click to read it`;
      c.addEventListener('contextmenu', e => { e.preventDefault(); V.showSpellCard(spellCard(sp)); });
      cards.push(c);
    }
    tray.el.replaceChildren(head('Spells', 'Click to cast from the sheet · right-click to read'), h('div', { class: 'hbcards' }, ...cards));
  } else if (tray.kind === 'features') {
    const feats = featuresOf(ch, a);
    const LAB = { action: 'Actions', bonus: 'Bonus actions', reaction: 'Reactions', free: 'On your turn' };
    let last = null;
    for (const f of feats) {
      const g = LAB[f.use] || (f.rest ? 'Once per rest' : 'Always on');
      if (g !== last) { last = g; cards.push(h('div', { class: 'hbsep' }, g)); }
      const c = V.featureCardEl(f, { mini: true, level: f.lv || lv, onclick: () => useFeature(ch, f, lv) });
      c.title = `${f.name}\nClick to show it in the chat · right-click to read it`;
      c.addEventListener('contextmenu', e => { e.preventDefault(); V.showFeatureCard(f, { level: f.lv || lv, as: ch.name }); });
      cards.push(c);
    }
    tray.el.replaceChildren(head('Features', 'Click to show in the chat · right-click to read'), h('div', { class: 'hbcards' }, ...cards));
  } else {
    for (const f of V.STANDARD_ACTIONS || []) {
      const c = V.featureCardEl(f, { mini: true, onclick: () => V.featureToChat(f, { as: ch.name }) });
      c.addEventListener('contextmenu', e => { e.preventDefault(); V.showFeatureCard(f, { as: ch.name }); });
      cards.push(c);
    }
    tray.el.replaceChildren(head('Actions', 'Anyone can, on their turn · click to show in the chat'), h('div', { class: 'hbcards' }, ...cards));
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tray && !document.querySelector('.cardview')) closeTray(); });

// ───────── the bag: hover to see the cards ─────────
let bagT = null;
function showBag(anchor, ch) {
  clearTimeout(bagT);
  const items = ch.items || [];
  if (!bagPop) {
    bagPop = h('div', { class: 'hbbag', onmouseenter: () => clearTimeout(bagT), onmouseleave: () => hideBag(false) });
    document.body.append(bagPop);
  }
  bagPop.replaceChildren(
    h('div', { class: 'hbth' }, h('b', null, `${ch.name}’s bag`), h('span', null, items.length ? 'Click a card to see it · the bag for everything' : 'Nothing in it yet — drag item cards onto the token')),
    items.length ? h('div', { class: 'hbcards' }, ...items.slice(0, 40).map(e => V.cardEl(e.item, { mini: true, qty: e.qty, onclick: () => { hideBag(true); V.showItemCard(e.item, { char: ch.id, uid: e.uid }); } }))) : '');
  bagPop.hidden = false;
  const r = anchor.getBoundingClientRect();
  bagPop.style.left = Math.max(8, Math.min(innerWidth - 8 - Math.min(640, innerWidth - 16), r.left + r.width / 2 - 320)) + 'px';
  bagPop.style.bottom = (innerHeight - r.top + 8) + 'px';
}
function hideBag(now) { clearTimeout(bagT); bagT = setTimeout(() => { if (bagPop) bagPop.hidden = true; }, now ? 0 : 220); }

V.hotbar = { update, attacksOf, spellsOf, featuresOf, attrs };
})();
