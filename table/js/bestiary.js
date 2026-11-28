/* The Bestiary (GM): every monster brought in (Compendium → import, made from the GM's own books), searchable and
 * filtered by type, challenge, habitat, size and family. Open one for its stat block; add it to the Journal as an NPC on
 * the Community Contributed 5e sheet (stats, saves, skills, traits and every action, each action rollable from the
 * sheet), or drag it onto the map: an NPC and its token at once.
 * V.loadMonsters(force) · V.importedMonsters() · V.monsterDragType · V.monsterToMap(id, x, y) */
'use strict';
(function () {
const { $, h, state } = V;
const DRAG = 'application/x-vtt-monster';
V.monsterDragType = DRAG;

let monsters = [], loaded = null, open = null;   // (and editing, below: the creature in the editor)
const filt = V.store.get('vtt-bestiary', { q: '', kind: '', cr: '', habitat: '', size: '', family: '' });
const keep = () => V.store.set('vtt-bestiary', filt);

V.loadMonsters = function (force) {
  if (!V.isGM()) return Promise.resolve([]);
  if (loaded && !force) return loaded;
  loaded = fetch('/api/compendium/monsters', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { monsters: [] })
    .then(j => { monsters = (j.monsters || []).slice().sort((a, b) => a.name.localeCompare(b.name)); const t = $('#tab-bestiary'); if (t && t.classList.contains('on')) render(); return monsters; }).catch(() => (monsters = []));
  return loaded;
};
V.importedMonsters = () => monsters;

// ───── numbers ─────
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'], ABIL_LONG = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const mod = v => Math.floor((v - 10) / 2), sg = n => (n >= 0 ? '+' : '') + n;
const crSafe = cr => { const [a, b] = String(cr).split('/'); return b ? (+a || 0) / (+b || 1) : +a || 0; };   // "1/4" → 0.25
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const TOKEN_SIZE = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const KIND_ICON = { Aberration: 'eyeball', Beast: 'wolf-head', Celestial: 'angel-wings', Construct: 'golem-head', Dragon: 'dragon-head', Elemental: 'flame-spin',
  Fey: 'fairy-wings', Fiend: 'crowned-skull', Giant: 'giant', Humanoid: 'hood', Monstrosity: 'fangs', Ooze: 'spider-web', Plant: 'oak-leaf', Undead: 'skull' };
const iconFor = m => {
  const k = (m.kind || '').split(' ')[0], name = KIND_ICON[k];
  return name && V.hasGameIcon && V.hasGameIcon(name) ? name : (V.hasGameIcon && V.hasGameIcon('claw') ? 'claw' : null);
};
// a creature's picture at a given width (Commons serves standard sizes; anything else is used as it is)
const pic = (m, w) => !m.img ? null : /commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(m.img) ? m.img.replace(/([?&])width=\d+/, '$1width=' + w) : m.img;
const habitatsOf = m => (m.habitat || []).map(x => x.replace(/\s*\(.*\)$/, ''));   // "Planar (Abyss)" → Planar

// ───── the tab ─────
function render() {
  const box = $('#tab-bestiary'); if (!box || !state.camp) return;
  if (!V.isGM()) return box.replaceChildren(h('p', { class: 'muted', style: 'margin:12px' }, 'The Bestiary is the GM’s.'));
  if (editing) return box.replaceChildren(editor());
  if (open) return box.replaceChildren(detail(open));
  const all = monsters;
  if (!all.length) return box.replaceChildren(h('div', { class: 'bsempty' },
    h('p', null, 'No monsters yet.'),
    h('p', { class: 'muted small' }, 'Bring a book’s monsters in with Import (the file made from your Monster Manual), and every creature is here to search, open and drop onto a map.'),
    h('button', { class: 'btn primary', onclick: () => V.compendiumImport && V.compendiumImport('monsters') }, 'Import…'), ' ',
    h('button', { class: 'btn', title: 'A creature of your own: fill in its stat block (or paste one)', onclick: newCreature }, '+ New creature')));
  const uniq = (f, sort) => { const s = new Set(); for (const m of all) for (const v of [].concat(f(m) || [])) if (v) s.add(v); return [...s].sort(sort); };
  const sel = (key, label, values, fmt) => h('select', { class: 'bsf' + (filt[key] ? ' on' : ''), title: label, onchange: e => { filt[key] = e.target.value; keep(); render(); } },
    h('option', { value: '' }, label), ...values.map(v => h('option', { value: v, selected: filt[key] === String(v) || null }, fmt ? fmt(v) : v)));
  const q = filt.q.trim().toLowerCase();
  const list = all.filter(m => (!q || m.name.toLowerCase().includes(q) || (m.group || '').toLowerCase().includes(q) || (m.typeLine || '').toLowerCase().includes(q))
    && (!filt.kind || m.kind === filt.kind) && (!filt.cr || m.cr === filt.cr) && (!filt.size || m.size === filt.size)
    && (!filt.habitat || habitatsOf(m).includes(filt.habitat)) && (!filt.family || (m.family || m.group) === filt.family));
  const search = h('input', { type: 'search', placeholder: `Search ${all.length} creatures…`, value: filt.q, class: 'bsq',
    oninput: e => { filt.q = e.target.value; keep(); clearTimeout(search._t); search._t = setTimeout(() => { const pos = e.target.selectionStart; render(); const s2 = $('#tab-bestiary .bsq'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 140); } });
  const anyF = ['kind', 'cr', 'habitat', 'size', 'family'].some(k => filt[k]);
  const rows = list.slice(0, 400).map(row);
  box.replaceChildren(
    h('div', { class: 'bshead' },
      search,
      h('div', { class: 'bsfilters' },
        sel('kind', 'Any type', uniq(m => m.kind)),
        sel('cr', 'Any CR', uniq(m => m.cr, (a, b) => crSafe(a) - crSafe(b)), v => 'CR ' + v),
        sel('habitat', 'Any habitat', uniq(habitatsOf)),
        sel('size', 'Any size', uniq(m => m.size, (a, b) => SIZES.indexOf(a) - SIZES.indexOf(b))),
        sel('family', 'Any family', uniq(m => m.family || m.group))),
      h('div', { class: 'bscount muted small' }, `${list.length} of ${all.length}`,
        anyF || q ? h('button', { class: 'linkbtn', onclick: () => { Object.assign(filt, { q: '', kind: '', cr: '', habitat: '', size: '', family: '' }); keep(); render(); } }, 'Clear filters') : null,
        h('span', { class: 'grow' }), h('span', null, 'Drag one onto the map'),
        h('button', { class: 'btn sm', style: 'margin-left:8px', title: 'Bring in more creatures from a file', onclick: () => V.compendiumImport && V.compendiumImport('monsters') }, 'Import'),
        h('button', { class: 'btn sm primary', style: 'margin-left:4px', title: 'A creature of your own: fill in its stat block (or paste one)', onclick: newCreature }, '+ New'))),
    h('div', { class: 'bslist' }, rows.length ? rows : h('p', { class: 'muted small', style: 'margin:10px' }, 'Nothing matches.'),
      list.length > 400 ? h('p', { class: 'muted small', style: 'margin:8px 10px' }, `…and ${list.length - 400} more: narrow it down.`) : null));
}
function row(m) {
  const ic = iconFor(m), th = pic(m, 120);
  return h('div', { class: 'bsrow', draggable: 'true', title: m.typeLine,
    ondragstart: e => { e.dataTransfer.setData(DRAG, m.id); e.dataTransfer.setData('text/plain', m.name); e.dataTransfer.effectAllowed = 'copy'; },
    onclick: () => { open = m; render(); $('#tab-bestiary').scrollTop = 0; } },
    th ? h('img', { class: 'bsthumb', src: th, alt: '', loading: 'lazy', draggable: 'false' }) :
    ic ? V.gameIcon(ic, crSafe(m.cr) >= 17 ? 'r-legendary' : crSafe(m.cr) >= 11 ? 'r-very-rare' : crSafe(m.cr) >= 5 ? 'r-rare' : crSafe(m.cr) >= 1 ? 'r-uncommon' : 'r-common', 'bsic') : h('span', { class: 'bsic' }),
    h('div', { class: 'bsnm' }, h('b', null, m.name), h('span', null, `${m.size} ${m.kind}${m.swarm ? ' (swarm)' : ''}`)),
    h('span', { class: 'bscr', title: `Challenge ${m.cr}${m.xp ? ` (${m.xp.toLocaleString()} XP)` : ''}` }, 'CR ' + m.cr));
}

// ───── a stat block ─────
const DICE = /(\d+)\s*\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)/g;
function richText(m, label, txt) {
  // dice in brackets ("12 (2d6 + 5)") and attack bonuses ("Attack Roll: +9") roll when clicked: a GM-only roll in chat
  const out = []; let last = 0;
  const re = /(\d+)\s*\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)|(Attack Roll:\s*)([+-]\d+)|(\bDC \d+)/g; let mt;
  while ((mt = re.exec(txt))) {
    out.push(txt.slice(last, mt.index));
    if (mt[2]) { const f = mt[2].replace(/\s+/g, '').replace('−', '-'); out.push(h('button', { class: 'bsdice', title: `Roll ${f}`, onclick: e => roll(m, f, label, e) }, `${mt[1]} (${mt[2]})`)); }
    else if (mt[4]) out.push(mt[3], h('button', { class: 'bsdice', title: `Roll 1d20${mt[4]}`, onclick: e => roll(m, '1d20' + mt[4], label + ' (to hit)', e) }, mt[4]));
    else out.push(h('b', null, mt[5]));
    last = re.lastIndex;
  }
  out.push(txt.slice(last));
  return out;
}
function roll(m, formula, label, e) {
  e.stopPropagation();
  V.send({ t: 'roll', formula, label: `${m.name}: ${label}`, gmOnly: !e.shiftKey }).catch(err => V.toast(err.message, true));
}
const section = (m, title, list, intro) => list && list.length ? [h('h4', null, title), intro ? h('p', { class: 'bsintro' }, intro) : null,
  ...list.map(a => h('p', null, h('b', { class: 'bsan' }, a.name + '. '), ...richText(m, a.name, a.text).map(x => typeof x === 'string' ? x.split('\n').flatMap((s, i) => i ? [h('br'), s] : [s]) : x).flat()))] : [];
function statBlock(m) {
  const line = (k, v) => v ? h('div', { class: 'bsline' }, h('b', null, k + ' '), v) : null;
  const saves = m.saves && Object.keys(m.saves).length ? ABIL.filter(a => a in m.saves).map(a => `${a[0].toUpperCase() + a.slice(1)} ${sg(m.saves[a])}`).join(', ') : '';
  return h('div', { class: 'statblock' },
    h('h3', null, m.name),
    h('div', { class: 'bstype' }, m.typeLine),
    h('hr'),
    h('div', { class: 'bscombat' },
      h('div', null, h('b', null, 'AC '), String(m.ac), m.acNote ? ` (${m.acNote})` : ''),
      h('div', null, h('b', null, 'Initiative '), h('button', { class: 'bsdice', onclick: e => roll(m, '1d20' + sg(m.init || 0), 'Initiative', e) }, `${sg(m.init || 0)} (${10 + (m.init || 0)})`)),
      h('div', null, h('b', null, 'HP '), String(m.hp), m.hpFormula ? [' (', h('button', { class: 'bsdice', onclick: e => roll(m, m.hpFormula, 'Hit Points', e) }, m.hpFormula), ')'] : ''),
      h('div', { class: 'bsspeed' }, h('b', null, 'Speed '), m.speed || '')),
    h('table', { class: 'bsab' }, h('tr', null, ...ABIL.map(a => h('th', null, a.toUpperCase()))),
      h('tr', null, ...ABIL.map(a => h('td', null, h('button', { class: 'bsdice', title: `Roll a ${a.toUpperCase()} check`, onclick: e => roll(m, '1d20' + sg(mod(m[a] || 10)), a.toUpperCase() + ' check', e) }, `${m[a]} (${sg(mod(m[a] || 10))})`)))),
      saves ? h('tr', null, ...ABIL.map(a => h('td', { class: 'bssave' }, a in (m.saves || {}) ? h('button', { class: 'bsdice', title: `Roll a ${a.toUpperCase()} save`, onclick: e => roll(m, '1d20' + sg(m.saves[a]), a.toUpperCase() + ' save', e) }, 'save ' + sg(m.saves[a])) : ''))) : null),
    h('hr'),
    line('Skills', m.skills), line('Vulnerabilities', m.vuln), line('Resistances', m.resist), line('Immunities', [m.immune, m.condImmune].filter(Boolean).join('; ')),
    line('Gear', m.gear), line('Senses', m.senses), line('Languages', m.languages), line('CR', m.crText || m.cr),
    h('hr'),
    ...section(m, 'Traits', m.traits), ...section(m, 'Actions', m.actions), ...section(m, 'Bonus Actions', m.bonus), ...section(m, 'Reactions', m.reactions),
    ...section(m, 'Legendary Actions', m.legendary, m.legendaryIntro), ...section(m, 'Mythic Actions', m.mythic, m.mythicIntro),
    ...section(m, 'Lair Actions', m.lair, m.lairIntro), ...section(m, 'Regional Effects', m.regional, m.regionalIntro));
}
function detail(m) {
  return h('div', { class: 'bsdetail' },
    h('div', { class: 'bsbar' },
      h('button', { class: 'btn sm', onclick: () => { open = null; render(); } }, '‹ All creatures'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', title: 'Change its stat block', onclick: () => { editing = JSON.parse(JSON.stringify(m)); render(); $('#tab-bestiary').scrollTop = 0; } }, 'Edit'),
      m.source === 'Homebrew' ? h('button', { class: 'btn sm', title: 'Take it out of the Bestiary', onclick: () => deleteCreature(m) }, 'Delete') : null,
      h('button', { class: 'btn sm', title: 'An NPC on the Community Contributed sheet, in the Journal’s Monsters folder', onclick: () => make(m, { open: true }) }, 'Add to Journal'),
      h('button', { class: 'btn sm primary', title: 'Its token in the middle of your view (or drag the creature onto the map): its sheet opens from the token, and stays out of the Journal', onclick: () => { const p = V.viewCenter(); make(m, { at: p }); } }, 'Place on map')),
    h('div', { class: 'bsmeta muted small' }, [m.family || m.group, (m.habitat || []).join(', '), m.treasure && m.treasure.length ? 'Treasure: ' + m.treasure.join(', ') : '', m.source].filter(Boolean).join(' · ')),
    artBox(m),
    statBlock(m),
    m.lore ? h('p', { class: 'bslore' }, m.lore) : null,
    h('p', { class: 'muted small', style: 'margin:6px 2px 14px' }, 'Click any dice to roll them (a GM-only roll; Shift+click for everyone).'));
}

// ───── its picture: the art (with who made it and its licence), or a slot to drop the GM's own ─────
async function setArt(m, art) {
  const r = await fetch('/api/compendium/monsters/art', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: m.id }, art)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  for (const k of ['img', 'imgPage', 'imgCredit', 'imgLicense']) delete m[k];
  Object.assign(m, j.monster || {});
  render();
}
async function useFile(m, f) {
  if (!f || !/^image\//.test(f.type)) return V.toast('That isn’t a picture', true);
  try { await setArt(m, { img: await V.upload(f), imgCredit: 'Your own picture' }); } catch (e) { V.toast(e.message, true); }
}
function artBox(m) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => useFile(m, e.target.files[0]) });
  const drop = el => {
    el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); useFile(m, e.dataTransfer.files[0]); });
    return el;
  };
  if (!m.img) return drop(h('div', { class: 'bsart empty', title: 'Click to choose a picture, or drop one here', onclick: () => inp.click() },
    inp, V.hasGameIcon && iconFor(m) ? V.gameIcon(iconFor(m), 'r-common', 'bsartic') : null, h('span', null, 'No picture yet: drop one here or click to choose')));
  const credit = [m.imgCredit, m.imgLicense].filter(Boolean).join(' · ');
  return drop(h('figure', { class: 'bsart' },
    inp,
    h('a', { href: m.imgPage || m.img, target: '_blank', rel: 'noopener', title: 'Open the full picture' }, h('img', { src: pic(m, 960), alt: m.name, draggable: 'false' })),
    h('figcaption', null,
      h('span', { class: 'grow' }, credit, m.imgPage ? [' · ', h('a', { href: m.imgPage, target: '_blank', rel: 'noopener' }, 'Wikimedia Commons')] : null),
      h('button', { class: 'linkbtn', title: 'Use a picture of your own (or drop one on the art)', onclick: () => inp.click() }, 'Change'),
      h('button', { class: 'linkbtn', title: 'Take the picture off this creature', onclick: () => setArt(m, {}).catch(e => V.toast(e.message, true)) }, 'Remove'))));
}

// ───── a monster as an NPC on the Community Contributed sheet ─────
const SKILL = { acrobatics: 'dex', 'animal handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int',
  medicine: 'wis', nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight of hand': 'dex', stealth: 'dex', survival: 'wis' };
const ACT_TYPE = { actions: '(Normal Action) ', bonus: '(Bonus Action) ', reactions: '(Reaction) ', legendary: '(Legendary Action) ', mythic: '(Special Action) ', lair: '(Lair Action) ' };
// what the sheet's Use button rolls: the attack, then each lot of damage ("[[2d6+5]] Bludgeoning")
function effectOf(text) {
  const parts = [];
  const at = /Attack Roll:\s*([+-]\d+)/.exec(text); if (at) parts.push(`To hit [[1d20${at[1]}]]`);
  const sv = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC (\d+)/.exec(text); if (sv) parts.push(`DC ${sv[2]} ${sv[1]} save`);
  const dm = []; let x; const re = /\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)\s*([A-Z][a-z]+)?(\s+damage)?/g;
  while ((x = re.exec(text))) dm.push(`[[${x[1].replace(/\s+/g, '').replace('−', '-')}]]${x[3] && x[2] ? ' ' + x[2] : ''}`);
  if (dm.length) parts.push((at ? 'Hit: ' : sv ? 'Failure: ' : '') + dm.join(' + '));
  return parts.join(' · ');
}
function sheetAttrs(m) {
  const set = { character_name: m.name, is_npc: 1, npc_size: m.size || '', npc_type: (m.typeLine || '').replace(/^\w+\s+/, '').replace(/,\s*[^,]+$/, '') || m.type, npc_alignment: m.alignment || '',
    npc_ac: m.ac, npc_ac_note: m.acNote || '', ac: m.ac, npc_hp: m.hp, npc_hp_max: m.hp, hp: m.hp, hp_max: m.hp, npc_hp_hit_dice: m.hpFormula || '',
    npc_speed: m.speed || '', npc_challenge: m.cr, npc_xp: m.xp || 0, npc_senses: m.senses || '', npc_languages: m.languages || '',
    npc_damage_resistance: m.resist || '', npc_damage_vulnerability: m.vuln || '', npc_damage_immunity: m.immune || '', npc_condition_immunity: m.condImmune || '',
    npc_initiative: (m.init || 0) - mod(m.dex || 10), pb: m.pb || 2 };
  ABIL.forEach((a, i) => { const v = m[a] || 10; set[ABIL_LONG[i]] = v; set['npc_' + ABIL_LONG[i]] = v; set['npc_' + ABIL_LONG[i] + '_mod'] = mod(v);
    if (m.saves && a in m.saves) set['npc_' + ABIL_LONG[i] + '_save_bonus'] = m.saves[a] - mod(v); });
  for (const [, nm, b] of String(m.skills || '').matchAll(/([A-Za-z ]+?)\s*([+-]\d+)/g)) {
    const k = nm.trim().toLowerCase(), ab = SKILL[k]; if (!ab) continue;
    set['npc_' + k.replace(/\s+/g, '') + '_bonus'] = +b - mod(m[ab] || 10);
  }
  // traits (and anything that won't fit the sheet's twenty actions) as text
  const tx = [];
  for (const t of m.traits || []) tx.push(`${t.name}. ${t.text}`);
  if (m.gear) tx.push(`Gear. ${m.gear}`);
  const acts = [];
  for (const k of ['actions', 'bonus', 'reactions', 'legendary', 'mythic', 'lair']) for (const a of m[k] || []) acts.push([k, a]);
  const multi = acts.find(([k, a]) => k === 'actions' && /^Multiattack/i.test(a.name));
  if (multi) set.npc_multiattack = multi[1].text;
  let n = 0;
  for (const [k, a] of acts) {
    if (a === (multi && multi[1])) continue;
    if (n >= 20) { tx.push(`${a.name} (${ACT_TYPE[k].trim().replace(/[()]/g, '')}). ${a.text}`); continue; }
    n++;
    set['npc_action_name' + n] = a.name; set['npc_action_type' + n] = ACT_TYPE[k];
    set['npc_action_description' + n] = a.text; set['npc_action_effect' + n] = effectOf(a.text);
  }
  for (const [k, lab] of [['legendaryIntro', 'Legendary Actions'], ['mythicIntro', 'Mythic Actions'], ['lairIntro', 'Lair Actions']]) if (m[k]) tx.push(`${lab}. ${m[k]}`);
  if (m.regional && m.regional.length) tx.push('Regional Effects. ' + (m.regionalIntro ? m.regionalIntro + '\n' : '') + m.regional.map(r => `• ${r.name}. ${r.text}`).join('\n'));
  set.npc_traits = tx.join('\n\n') || 'None';
  return set;
}
async function folderId() {
  const c = state.camp; let f = (c.charFolders || []).find(x => /^monsters$/i.test(x.name));
  if (!f) { f = { id: 'monsters', name: 'Monsters' }; await V.op({ t: 'folders.set', folders: (c.charFolders || []).concat([f]) }).catch(() => null); }
  return f.id;
}
// creatures dragged onto the map: their sheets go in a folder the Journal doesn't show (chars.js)
const MAPFOLDER = 'onmap';
V.MAP_CREATURES = MAPFOLDER;
async function mapFolderId() {
  const c = state.camp;
  if (!(c.charFolders || []).some(x => x.id === MAPFOLDER)) await V.op({ t: 'folders.set', folders: (c.charFolders || []).concat([{ id: MAPFOLDER, name: 'Creatures on the map' }]) }).catch(() => null);
  return MAPFOLDER;
}
async function make(m, how) {
  try {
    const sheet = (state.camp.sheets || {}).dnd5e ? 'dnd5e' : Object.keys(state.camp.sheets || {}).find(k => (state.camp.sheets[k] || {}).mode === '5e') || 'dnd5e';
    // dragged onto the map: its sheet is kept out of the Journal (one each, so each keeps its own hit points)
    const onMap = !!how.at && !how.open;
    let cid = null, name;
    if (onMap) {   // a second goblin on the scene is "Goblin 2"
      const n = state.scene ? [...state.scene.tokens.values()].filter(t => t.name === m.name || (t.name || '').startsWith(m.name + ' ')).length : 0;
      name = n ? `${m.name} ${n + 1}` : m.name;
    } else {       // and a second one in the Journal, too
      const same = (state.camp.characters || []).filter(c => c.folder !== MAPFOLDER && (c.name === m.name || c.name.startsWith(m.name + ' '))).length;
      name = same ? `${m.name} ${same + 1}` : m.name;
    }
    if (!cid) {
      const r = await V.op({ t: 'char.create', char: { name, sheet } });
      cid = r && r.op && r.op.char && r.op.char.id; if (!cid) throw new Error('No character made');
      const set = sheetAttrs(m); set.character_name = name;
      await V.send({ t: 'charAttrs', char: cid, set });
      const patch = { folder: onMap ? await mapFolderId() : await folderId() }; if (m.img) patch.avatar = pic(m, 640);   // its art is the NPC's picture (and its token's)
      await V.op({ t: 'char.update', id: cid, patch }).catch(() => null);
    }
    if (how.at && state.scene) {
      const g = V.grid ? V.grid() : null, sz = TOKEN_SIZE[m.size] || 1;
      const [x, y] = window.Geom && g ? Geom.snap(g, how.at.x, how.at.y, sz) : [how.at.x, how.at.y];
      const tr = await V.op({ t: 'token.create', scene: state.scene.id, token: { name, sheet: cid, x, y, size: sz, layer: state.layer === 'gm' ? 'gm' : 'tokens', hp: { v: m.hp, max: m.hp } } }).catch(() => null);
      if (tr && tr.op && tr.op.token && V.setSel) V.setSel([tr.op.token.id]);
    } else if (how.at) V.toast('Make a scene first', true);
    if (!onMap) V.toast(`${name} is in the Journal (Monsters).`);
    if (how.open) V.openSheet(cid);
  } catch (e) { V.toast('Couldn’t add them: ' + (e.message || e), true); }
}
// ───── a creature of your own (or one changed): the editor, saved to the Bestiary like any book's creature ─────
const CR_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000,
  '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };
const pbOf = cr => crSafe(cr) < 5 ? 2 : Math.min(9, 2 + Math.ceil((crSafe(cr) - 4) / 4));
const KINDS = Object.keys(KIND_ICON).concat(['Swarm']);
const CONDITIONS = /^(blinded|charmed|deafened|exhaustion|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)$/i;
const tcase = s => String(s || '').trim().replace(/\b[a-z]/g, c => c.toUpperCase());
const LISTS = [['traits', 'Traits'], ['actions', 'Actions'], ['bonus', 'Bonus actions'], ['reactions', 'Reactions'], ['legendary', 'Legendary actions']];
let editing = null;   // the creature being made or changed (a copy), or null
document.head.append(h('style', null, `
.bsedit .bsegrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px 8px; margin: 8px 2px 16px; }
.bsedit .bsef { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bsedit .bsef > span { font-size: 11px; opacity: .7; }
.bsedit .bsef input, .bsedit .bsef select, .bsedit .bsef textarea, .bsedit .bspaste textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; }
.bsedit .bsef textarea, .bsedit .bspaste textarea { resize: vertical; line-height: 1.35; }
.bsedit .bspaste { margin: 8px 2px; } .bsedit .bspaste summary { cursor: pointer; margin-bottom: 4px; }`));
const entriesToText = list => (list || []).map(a => `${a.name}. ${String(a.text).replace(/\s*\n\s*/g, ' ')}`).join('\n');
// one per line: "Name. What it does." (a bullet in front is fine)
const textToEntries = t => String(t || '').split('\n').map(l => l.replace(/^\s*[*•·-]\s*/, '').trim()).filter(Boolean).map(l => {
  const mt = /^(.{1,90}?(?:\([^)]*\))?)\.\s+([\s\S]+)$/.exec(l);
  return mt ? { name: mt[1].trim(), text: mt[2].trim() } : { name: l.replace(/\.$/, ''), text: '' };
});
// dice written plainly ("2d6+5 slashing") become the book's way ("12 (2d6 + 5) Slashing damage"), so they roll
const avg = f => { const mt = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(f.replace(/\s+/g, '').replace('−', '-')); if (!mt) return 0; return Math.floor(+mt[1] * (+mt[2] + 1) / 2 + (mt[3] === '-' ? -1 : 1) * (+mt[4] || 0)); };
const tidyDice = f => f.replace(/\s+/g, '').replace('−', '-').replace(/([+-])/, ' $1 ');
function bookDice(text) {
  return String(text).replace(/(\d+\s*\()?\b(\d+d\d+(?:\s*[+−-]\s*\d+)?)(\))?(\s+(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b(\s+damage)?)?/gi,
    (all, pre, f, post, ty, type) => pre && post ? all : `${avg(f)} (${tidyDice(f)})${type ? ' ' + tcase(type) + ' damage' : ''}`);
}
function bookAction(text) {
  // "+8, reach 10ft, 2d6+5 slashing. More." → "Melee Attack Roll: +8, reach 10 ft. Hit: 12 (2d6 + 5) Slashing damage. More."
  const mt = /^([+-]\d+),\s*(reach|range)\s*([\d/]+)\s*ft\.?,?\s*([^.]*)\.?\s*([\s\S]*)$/i.exec(text.trim());
  if (!mt) return bookDice(text);
  const hit = bookDice(mt[4]).replace(/ and (\d+ \()/g, ' plus $1');
  return `${/reach/i.test(mt[2]) ? 'Melee' : 'Ranged'} Attack Roll: ${mt[1]}, ${mt[2].toLowerCase()} ${mt[3]} ft. Hit: ${hit}.${mt[5] ? ' ' + bookDice(mt[5]) : ''}`;
}
const ftOf = s => String(s || '').trim().replace(/\.$/, '').replace(/(\d+)\s*ft\.?/gi, '$1 ft.').replace(/\b(climb|fly|swim|burrow)\b/gi, c => tcase(c));
// a stat block pasted as text (the way it's written in a book or a note) → the editor's fields
function parseBlock(t) {
  const m = {}, one = re => { const mt = re.exec(t); return mt ? mt[1].trim().replace(/\.$/, '') : ''; };
  const head = /\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([a-z ]+?)(?:\s*\(([^)]*)\))?,\s*([a-z -]+)/i.exec(t);
  if (head) { m.size = tcase(head[1]); m.kind = tcase(head[2]); m.alignment = tcase(head[4]); if (head[3]) m.tags = head[3]; }
  const ac = /\bA(?:C|rmou?r Class)\s*(\d+)(?:\s*\(([^)]*)\))?/i.exec(t); if (ac) { m.ac = +ac[1]; if (ac[2]) m.acNote = ac[2]; }
  const hp = /\b(?:HP|Hit Points)\s*(\d+)(?:\s*\(([^)]*)\))?/i.exec(t); if (hp) { m.hp = +hp[1]; if (hp[2]) m.hpFormula = hp[2].replace(/\s+/g, ''); }
  const sp = one(/\bSpeed\s*([^.\n]*(?:\.\s*(?=climb|fly|swim|burrow)[^.\n]*)?)/i); if (sp) m.speed = ftOf(sp);
  for (const a of ABIL) { const v = new RegExp('\\b' + a + '\\s*(\\d+)', 'i').exec(t); if (v) m[a] = +v[1]; }
  const sv = one(/\bSav(?:es|ing Throws)\s*([^.\n]*)/i);
  if (sv) { m.saves = {}; for (const [, k, b] of sv.matchAll(/(Str|Dex|Con|Int|Wis|Cha)\w*\s*([+-]\d+)/gi)) m.saves[k.toLowerCase()] = +b; }
  const sk = one(/\bSkills\s*([^.\n]*)/i); if (sk) m.skills = tcase(sk).replace(/\b(Of|And)\b/g, w => w.toLowerCase());
  const se = one(/\bSenses\s*([^\n]*?)(?:\.\s|\.$|\n|$)/i); if (se) m.senses = ftOf(tcase(se));
  const imm = one(/\bImmun(?:e|ities)\s*([^.\n]*)/i);
  if (imm) { const parts = imm.split(/[,;]\s*/).map(tcase).filter(Boolean); m.immune = parts.filter(p => !CONDITIONS.test(p)).join(', '); m.condImmune = parts.filter(p => CONDITIONS.test(p)).join(', '); }
  const vu = one(/\bVulnerab(?:le|ilities)\s*([^.\n]*)/i); if (vu) m.vuln = tcase(vu);
  const re = one(/\bResist(?:ant|ances)?\s*([^.\n]*)/i); if (re) m.resist = tcase(re);
  const la = one(/\bLanguages\s*([^.\n]*)/i); if (la) m.languages = la;
  const cr = one(/\b(?:CR|Challenge)\s*([\d/]+)/i); if (cr) m.cr = cr;
  // the bullet lines: actions when they attack, recharge or are counted out; otherwise traits
  const lines = t.split('\n').filter(l => /^\s*[*•·-]\s+/.test(l));
  for (const k of ['traits', 'actions', 'bonus', 'reactions']) m[k] = [];
  for (const e of textToEntries(lines.join('\n'))) {
    const k = /^bonus/i.test(e.name) ? 'bonus' : /^reaction/i.test(e.name) ? 'reactions' :
      /multiattack|recharge|\/day|\/rest/i.test(e.name) || /^[+-]\d+,\s*(reach|range)/i.test(e.text) ? 'actions' : 'traits';
    e.name = e.name.replace(/\((recharge|\d+\/day)/i, (x, w) => '(' + tcase(w)); e.text = k === 'actions' ? bookAction(e.text) : bookDice(e.text);
    m[k].push(e);
  }
  return m;
}
function editor() {
  const e = editing, f = {}, val = k => f[k].value.trim();
  const inp = (k, label, o = {}) => { f[k] = h('input', Object.assign({ value: e[k] != null ? String(e[k]) : '', placeholder: o.ph || '' }, o.num ? { type: 'number' } : {})); return h('label', { class: 'bsef', style: o.wide ? 'grid-column:1/-1' : '' }, h('span', null, label), f[k]); };
  const sel = (k, label, opts) => { f[k] = h('select', null, ...opts.map(v => h('option', { value: v, selected: e[k] === v || null }, v))); return h('label', { class: 'bsef' }, h('span', null, label), f[k]); };
  const area = (k, label, rows, txt, ph) => { f[k] = h('textarea', { rows, placeholder: ph || '' }); f[k].value = txt; return h('label', { class: 'bsef', style: 'grid-column:1/-1' }, h('span', null, label), f[k]); };
  const savesTxt = e.saves ? ABIL.filter(a => a in e.saves).map(a => `${tcase(a)} ${sg(e.saves[a])}`).join(', ') : '';
  const paste = h('textarea', { rows: 6, placeholder: 'Paste a stat block here (as it’s written in a book or your notes) and press Fill in: the size, type, AC, HP, speed, scores, saves, skills, senses, immunities and every • bullet go into the fields below. Check them, then Save.' });
  const fill = () => {
    const got = parseBlock(paste.value); if (!Object.keys(got).length) return V.toast('Nothing in that to fill in', true);
    const name = val('name'); editing = Object.assign({}, editing, got, { name: name || editing.name }); render();
  };
  const save = async () => {
    const m = Object.assign({}, e, { name: val('name'), size: f.size.value, kind: tcase(val('kind')) || 'Monstrosity', alignment: tcase(val('alignment')) || 'Unaligned' });
    if (!m.name) return V.toast('Give it a name', true);
    m.type = m.kind; m.typeLine = `${m.size} ${m.kind}${val('tags') ? ` (${val('tags')})` : ''}, ${m.alignment}`; m.tags = val('tags');
    for (const k of ['acNote', 'hpFormula', 'speed', 'skills', 'senses', 'languages', 'immune', 'condImmune', 'resist', 'vuln', 'gear', 'lore']) m[k] = val(k);
    for (const k of ['ac', 'hp', ...ABIL]) m[k] = Math.round(+val(k) || (ABIL.includes(k) ? 10 : 0));
    m.cr = val('cr') || '0'; m.xp = CR_XP[m.cr] || 0; m.pb = pbOf(m.cr); m.crText = `${m.cr} (XP ${m.xp.toLocaleString()}; PB +${m.pb})`;
    m.init = val('init') === '' ? mod(m.dex) : Math.round(+val('init'));
    m.saves = {}; for (const [, k, b] of val('saves').matchAll(/(Str|Dex|Con|Int|Wis|Cha)\w*\s*([+-]\d+)/gi)) m.saves[k.toLowerCase()] = +b;
    m.habitat = val('habitat') ? val('habitat').split(/,\s*/).map(tcase) : [];
    for (const [k] of LISTS) m[k] = textToEntries(f[k].value).map(a => ({ name: a.name, text: /actions|bonus|reactions|legendary/.test(k) ? bookAction(a.text) : bookDice(a.text) }));
    if (!m.languages) m.languages = '—';
    try {
      const r = await fetch('/api/compendium/monsters', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monster: m }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText);
      await V.loadMonsters(true); editing = null; open = monsters.find(x => x.id === j.monster.id) || j.monster; render();
      V.toast(`${m.name} is in the Bestiary`);
    } catch (err) { V.toast('Couldn’t save it: ' + err.message, true); }
  };
  return h('div', { class: 'bsdetail bsedit' },
    h('div', { class: 'bsbar' },
      h('button', { class: 'btn sm', onclick: () => { editing = null; render(); } }, '‹ Cancel'),
      h('span', { class: 'grow' }, h('b', null, e.id ? 'Change ' + e.name : 'A new creature')),
      h('button', { class: 'btn sm primary', onclick: save }, 'Save')),
    h('details', { class: 'bspaste', open: !e.id || null }, h('summary', null, 'Paste a stat block'), paste,
      h('div', { style: 'text-align:right;margin-top:4px' }, h('button', { class: 'btn sm', onclick: fill }, 'Fill in'))),
    h('div', { class: 'bsegrid' },
      inp('name', 'Name', { wide: true, ph: 'Wendigo' }),
      sel('size', 'Size', SIZES), (() => { const l = inp('kind', 'Type', { ph: 'Monstrosity' }); f.kind.setAttribute('list', 'bskinds'); l.append(h('datalist', { id: 'bskinds' }, ...KINDS.map(k => h('option', { value: k })))); return l; })(),
      inp('tags', 'Tags', { ph: 'e.g. Shapechanger' }), inp('alignment', 'Alignment', { ph: 'Chaotic Evil' }),
      inp('ac', 'AC', { num: 1 }), inp('acNote', 'AC from', { ph: 'Natural Armor' }), inp('hp', 'HP', { num: 1 }), inp('hpFormula', 'HP dice', { ph: '15d10+60' }),
      inp('speed', 'Speed', { wide: true, ph: '40 ft., Climb 30 ft.' }),
      ...ABIL.map(a => inp(a, a.toUpperCase(), { num: 1 })),
      inp('init', 'Initiative', { ph: 'its Dex' }), inp('cr', 'CR', { ph: '8' }),
      (() => { const l = inp('saves', 'Saves', { wide: true, ph: 'Str +8, Con +7' }); f.saves.value = savesTxt; return l; })(),
      inp('skills', 'Skills', { wide: true, ph: 'Perception +5, Stealth +9' }), inp('senses', 'Senses', { wide: true, ph: 'Darkvision 60 ft., Passive Perception 15' }),
      inp('immune', 'Immune (damage)', { ph: 'Cold' }), inp('condImmune', 'Immune (conditions)', { ph: 'Exhaustion' }),
      inp('resist', 'Resistant', {}), inp('vuln', 'Vulnerable', { ph: 'Fire' }),
      inp('languages', 'Languages', { wide: true, ph: '—' }), inp('gear', 'Gear', { wide: true }),
      (() => { const l = inp('habitat', 'Habitat', { wide: true, ph: 'Arctic, Forest' }); f.habitat.value = (e.habitat || []).join(', '); return l; })(),
      ...LISTS.map(([k, label]) => area(k, label + ' (one a line: Name. What it does.)', Math.max(2, (e[k] || []).length + 1), entriesToText(e[k]),
        k === 'actions' ? 'Claw. Melee Attack Roll: +8, reach 10 ft. Hit: 12 (2d6 + 5) Slashing damage.   (or just: Claw. +8, reach 10ft, 2d6+5 slashing)' : '')),
      area('lore', 'Lore', 3, e.lore || '')));
}
function newCreature() { editing = { size: 'Medium', kind: 'Monstrosity', alignment: 'Unaligned', ac: 10, hp: 4, hpFormula: '1d8', speed: '30 ft.', cr: '0', str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, source: 'Homebrew' }; open = null; render(); const t = $('#tab-bestiary'); if (t) t.scrollTop = 0; }
async function deleteCreature(m) {
  if (!confirm(`Take ${m.name} out of the Bestiary? (NPCs already made from it stay in the Journal.)`)) return;
  const r = await fetch('/api/compendium/monsters?id=' + encodeURIComponent(m.id), { method: 'DELETE', credentials: 'same-origin' });
  if (!r.ok) return V.toast('Couldn’t take it out', true);
  open = null; await V.loadMonsters(true); render();
}
V.newCreature = newCreature;
V.monsterToMap = async function (id, x, y) {
  await V.loadMonsters();
  const m = monsters.find(z => z.id === id); if (m) make(m, { at: { x, y } });
};
V.monsterSheetAttrs = sheetAttrs;   // (for tests)

V.on('tab', name => { if (name === 'bestiary') V.loadMonsters().then(render); });
})();
