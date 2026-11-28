/* Quick NPC (the Journal's button, GM): a named, statted character in a few clicks — the innkeeper, the guard at the
 * gate, a bandit chief — rather than a blank sheet to fill in. Pick what they are (a 5e stat line, or a 2D6 tier), give
 * them a name (or let the Name Forge make one from the world's own lists of names) and a line about who they are; they
 * go in the Journal's NPCs folder, and a token can go straight onto the scene you're looking at.
 * V.quickNPC() */
'use strict';
(function () {
const { $, h, state } = V;

// 5e: the SRD 5.1 stat lines (AC, hit dice, CR, STR DEX CON INT WIS CHA, what they are)
const FIVE = [
  ['Commoner', 10, '1d8', '0', [10, 10, 10, 10, 10, 10], 'Medium humanoid (any race), any alignment'],
  ['Guard', 16, '2d8+2', '1/8', [13, 12, 12, 10, 11, 10], 'Medium humanoid (any race), any alignment'],
  ['Bandit', 12, '2d8+2', '1/8', [11, 12, 12, 10, 10, 10], 'Medium humanoid (any race), any non-lawful alignment'],
  ['Cultist', 12, '2d8', '1/8', [11, 12, 10, 10, 11, 10], 'Medium humanoid (any race), any non-good alignment'],
  ['Noble', 15, '2d8', '1/8', [11, 12, 11, 12, 14, 16], 'Medium humanoid (any race), any alignment'],
  ['Acolyte', 10, '2d8', '1/4', [10, 10, 10, 10, 14, 11], 'Medium humanoid (any race), any alignment'],
  ['Scout', 13, '3d8+3', '1/2', [11, 14, 12, 11, 13, 11], 'Medium humanoid (any race), any alignment'],
  ['Thug', 11, '5d8+10', '1/2', [15, 11, 14, 10, 10, 11], 'Medium humanoid (any race), any non-good alignment'],
  ['Priest', 13, '5d8+5', '2', [10, 10, 12, 13, 16, 13], 'Medium humanoid (any race), any alignment'],
  ['Bandit captain', 15, '10d8+20', '2', [15, 16, 14, 14, 11, 14], 'Medium humanoid (any race), any non-lawful alignment'],
  ['Knight', 18, '8d8+16', '3', [16, 11, 14, 11, 11, 15], 'Medium humanoid (any race), any alignment'],
  ['Veteran', 17, '9d8+18', '3', [16, 13, 14, 10, 11, 10], 'Medium humanoid (any race), any alignment'],
  ['Mage', 12, '9d8', '6', [9, 14, 11, 17, 12, 11], 'Medium humanoid (any race), any alignment'],
  // spellcasters (the SRD's cult fanatic and druid; the rest in the same spirit)
  ['Apprentice mage', 10, '3d8', '1/4', [10, 10, 10, 14, 10, 11], 'Medium humanoid (any race), any alignment'],
  ['Hedge witch', 11, '4d8+4', '1/2', [10, 12, 13, 12, 15, 11], 'Medium humanoid (any race), any alignment'],
  ['Minstrel', 12, '4d8+4', '1/2', [11, 14, 12, 10, 13, 16], 'Medium humanoid (any race), any alignment'],
  ['Wild sorcerer', 12, '5d8', '1', [9, 14, 11, 10, 12, 17], 'Medium humanoid (any race), any alignment'],
  ['Pact-bound', 12, '5d8+5', '1', [9, 14, 13, 11, 12, 16], 'Medium humanoid (any race), any alignment'],
  ['Cult fanatic', 13, '6d8+6', '2', [11, 14, 12, 10, 13, 14], 'Medium humanoid (any race), any non-good alignment'],
  ['Druid', 11, '5d8+5', '2', [10, 12, 13, 12, 15, 11], 'Medium humanoid (any race), any alignment']
];
// each stat line's class (the sheet's class; '' for none) and its level, from the challenge
const ROLE_CLASS = { Commoner: '', Guard: 'Fighter', Bandit: 'Rogue', Cultist: 'Warlock', Noble: '', Acolyte: 'Cleric', Scout: 'Ranger', Thug: 'Barbarian',
  Priest: 'Cleric', 'Bandit captain': 'Fighter', Knight: 'Paladin', Veteran: 'Fighter', Mage: 'Wizard', 'Apprentice mage': 'Wizard', 'Hedge witch': 'Druid',
  Minstrel: 'Bard', 'Wild sorcerer': 'Sorcerer', 'Pact-bound': 'Warlock', 'Cult fanatic': 'Cleric', Druid: 'Druid' };
const CR_LEVEL = { '0': 1, '1/8': 1, '1/4': 2, '1/2': 3, '1': 4, '2': 5, '3': 6, '4': 7, '5': 8, '6': 9 };
const SAVES = { Artificer: ['con', 'int'], Barbarian: ['str', 'con'], Bard: ['dex', 'cha'], Cleric: ['wis', 'cha'], Druid: ['int', 'wis'], Fighter: ['str', 'con'],
  Monk: ['str', 'dex'], Paladin: ['wis', 'cha'], Ranger: ['str', 'dex'], Rogue: ['dex', 'int'], Sorcerer: ['con', 'cha'], Warlock: ['wis', 'cha'], Wizard: ['int', 'wis'] };
// rolled scores go best first in this order
const PRIORITY = { Artificer: 'int con dex wis cha str', Barbarian: 'str con dex wis cha int', Bard: 'cha dex con wis int str', Cleric: 'wis con str dex cha int',
  Druid: 'wis con dex int cha str', Fighter: 'str con dex wis cha int', Monk: 'dex wis con str int cha', Paladin: 'str cha con wis dex int',
  Ranger: 'dex wis con str int cha', Rogue: 'dex con int wis cha str', Sorcerer: 'cha con dex wis int str', Warlock: 'cha con dex wis int str', Wizard: 'int con dex wis cha str', '': 'con str dex wis cha int' };
const SKILLS = { Barbarian: 'athletics intimidation', Bard: 'performance persuasion deception', Cleric: 'insight religion', Druid: 'nature survival', Fighter: 'athletics perception',
  Monk: 'acrobatics stealth', Paladin: 'athletics persuasion', Ranger: 'perception stealth survival', Rogue: 'stealth sleight_of_hand perception deception',
  Sorcerer: 'arcana deception', Warlock: 'arcana intimidation', Wizard: 'arcana history', Artificer: 'arcana investigation', '': 'perception' };
// what each carries (the SRD's cards, by name; ×n: how many)
const KIT = {
  '': ['Club', 'Clothes, common', 'Pouch'],
  Barbarian: ['Greataxe', 'Handaxe×2', 'Javelin×4', "Explorer's Pack"],
  Bard: ['Leather Armor', 'Rapier', 'Dagger', 'Lute', "Entertainer's Pack"],
  Cleric: ['Scale Mail', 'Mace', 'Shield', 'Amulet', "Priest's Pack"],
  Druid: ['Leather Armor', 'Shield', 'Scimitar', 'Sprig of mistletoe', "Explorer's Pack"],
  Fighter: ['Chain Mail', 'Longsword', 'Shield', 'Crossbow, light', 'Crossbow bolt×20', "Dungeoneer's Pack"],
  Monk: ['Shortsword', 'Dart×10', "Explorer's Pack"],
  Paladin: ['Chain Mail', 'Longsword', 'Shield', 'Javelin×5', 'Emblem', "Priest's Pack"],
  Ranger: ['Scale Mail', 'Shortsword×2', 'Longbow', 'Arrow×20', "Explorer's Pack"],
  Rogue: ['Leather Armor', 'Shortsword', 'Dagger×2', 'Shortbow', 'Arrow×20', "Thieves' Tools", "Burglar's Pack"],
  Sorcerer: ['Crossbow, light', 'Crossbow bolt×20', 'Dagger×2', 'Crystal', "Explorer's Pack"],
  Warlock: ['Leather Armor', 'Crossbow, light', 'Crossbow bolt×20', 'Dagger×2', 'Orb', "Scholar's Pack"],
  Wizard: ['Quarterstaff', 'Component pouch', 'Spellbook', 'Dagger', "Scholar's Pack"],
  Artificer: ['Studded Leather Armor', 'Crossbow, light', 'Crossbow bolt×20', "Thieves' Tools", "Dungeoneer's Pack"]
};
const ROLE_KIT = { Noble: ['Clothes, fine', 'Signet ring', 'Rapier'], Guard: ['Spear', 'Chain Shirt', 'Shield'], Knight: ['Plate Armor', 'Greatsword'], Thug: ['Club', 'Leather Armor'], Scout: ['Leather Armor', 'Longbow', 'Arrow×20', 'Shortsword×2'] };
// how each class casts: full, half, pact; and the spells it reaches for first (the SRD's names), the rest from its own list
const CASTER = { Bard: 'full', Cleric: 'full', Druid: 'full', Sorcerer: 'full', Wizard: 'full', Paladin: 'half', Ranger: 'half', Artificer: 'half', Warlock: 'pact' };
const LIKES = {
  Bard: ['Vicious Mockery', 'Minor Illusion', 'Healing Word', 'Charm Person', 'Thunderwave', 'Suggestion', 'Hold Person', 'Hypnotic Pattern', 'Dimension Door', 'Greater Invisibility'],
  Cleric: ['Sacred Flame', 'Guidance', 'Spare the Dying', 'Bless', 'Cure Wounds', 'Guiding Bolt', 'Shield of Faith', 'Hold Person', 'Spiritual Weapon', 'Spirit Guardians', 'Revivify', 'Banishment', 'Guardian of Faith', 'Flame Strike'],
  Druid: ['Produce Flame', 'Shillelagh', 'Druidcraft', 'Entangle', 'Healing Word', 'Thunderwave', 'Moonbeam', 'Barkskin', 'Call Lightning', 'Plant Growth', 'Ice Storm', 'Insect Plague'],
  Sorcerer: ['Fire Bolt', 'Ray of Frost', 'Light', 'Mage Hand', 'Magic Missile', 'Shield', 'Burning Hands', 'Scorching Ray', 'Misty Step', 'Fireball', 'Haste', 'Greater Invisibility', 'Cone of Cold'],
  Wizard: ['Fire Bolt', 'Mage Hand', 'Light', 'Prestidigitation', 'Magic Missile', 'Shield', 'Mage Armor', 'Detect Magic', 'Misty Step', 'Hold Person', 'Fireball', 'Counterspell', 'Fly', 'Greater Invisibility', 'Ice Storm', 'Cone of Cold'],
  Warlock: ['Eldritch Blast', 'Minor Illusion', 'Hex', 'Armor of Agathys', 'Hellish Rebuke', 'Darkness', 'Misty Step', 'Hold Person', 'Counterspell', 'Fear', 'Dimension Door', 'Banishment'],
  Paladin: ['Bless', 'Cure Wounds', 'Shield of Faith', 'Command', 'Find Steed', 'Lesser Restoration', 'Aid', 'Revivify', 'Crusader\u2019s Mantle'],
  Ranger: ['Hunter\u2019s Mark', 'Cure Wounds', 'Fog Cloud', 'Pass without Trace', 'Lesser Restoration', 'Spike Growth', 'Lightning Arrow'],
  Artificer: ['Mending', 'Fire Bolt', 'Cure Wounds', 'Faerie Fire', 'Heat Metal', 'Web', 'Haste']
};
// the highest spell level a caster has at a level, and how many cantrips and spells of each level go on the sheet
function spellPlan(cls, lv) {
  const how = CASTER[cls]; if (!how) return null;
  const top = how === 'full' ? Math.min(9, Math.ceil(lv / 2)) : how === 'pact' ? Math.min(5, Math.ceil(lv / 2)) : lv < 2 ? 0 : Math.min(5, Math.ceil((lv - 1) / 4));
  const cantrips = how === 'half' ? (cls === 'Artificer' ? 2 : 0) : lv >= 10 ? 4 : lv >= 4 ? 3 : 2;
  const per = l => l === top ? 1 : l === 1 ? 3 : 2;
  return { top, cantrips, per };
}
// 2D6: tiers (hit points, armour, the attributes on the 0–6 dots)
const TWO = [
  ['Bystander', 4, 0, 1, 'Someone in the way: a farmer, a clerk, a child.'],
  ['Minion', 6, 0, 1, 'Goes down in a hit or two.'],
  ['Soldier', 12, 1, 2, 'Trained and armed: a guard, a bandit, a sailor.'],
  ['Veteran', 18, 2, 3, 'Has seen fighting and lived.'],
  ['Elite', 24, 3, 4, 'A captain, a duellist, a mage of some power.'],
  ['Boss', 36, 4, 5, 'The one the party came for.']
];
const ABIL = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SHORT2 = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const mod = v => Math.floor((v - 10) / 2);
function rollDice(expr) {   // "5d8+10" → a roll; avg when asked
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr); if (!m) return 1;
  let t = +(m[3] || 0); for (let i = 0; i < +m[1]; i++) t += 1 + Math.floor(Math.random() * +m[2]);
  return Math.max(1, t);
}
const average = expr => { const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr); return m ? Math.max(1, Math.floor(+m[1] * (+m[2] + 1) / 2) + +(m[3] || 0)) : 1; };

// ───────── names: the Name Forge (the site's, from the wiki's "Common Names of …" pages), or a plain fallback ─────────
let forge = null;
function loadForge() {
  if (forge) return forge;
  forge = (async () => {
    if (!window.ValanarNames) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/app/names.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
    const j = await fetch('/api/site/wiki', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { pages: [] });
    const pages = (j.pages || []).map(p => Object.assign({ folders: String(p.folder || '').split('/').filter(Boolean) }, p));
    const N = window.ValanarNames({ h, toast: V.toast, pages: () => pages, data: () => ({ markers: [], nations: [] }), typeOf: () => null, nationOfMarker: () => '', wikiHref: () => '#' });
    return N;
  })().catch(() => null);
  return forge;
}
const SYL = { a: ['Al', 'Bran', 'Cor', 'Da', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lu', 'Mar', 'Ned', 'Os', 'Per', 'Ro', 'Sev', 'Tor', 'Ul', 'Var', 'Wil', 'Bo', 'Dre', 'Mi', 'Ta'],
  b: ['ric', 'win', 'a', 'en', 'ar', 'mund', 'is', 'o', 'eth', 'yn', 'ard', 'old', 'ia', 'ek', 'an', 'rad', 'mir', 'na', 'ka', 'helm'] };
const pick = a => a[Math.floor(Math.random() * a.length)];
const plainName = () => pick(SYL.a) + pick(SYL.b) + ' ' + pick(SYL.a) + pick(['wood', 'son', 'ley', 'mere', 'ford', 'ov', 'ek', 'ard', 'holt', 'brook']);

V.quickNPC = async function () {
  if (!V.isGM()) return;
  const c = state.camp, mode = c.mode === '2d6' ? '2d6' : '5e';
  const sheets = Object.entries(c.sheets || {}).filter(([, v]) => v.mode === mode);
  const sheet = (($('#newSheet') && $('#newSheet').value && (c.sheets[$('#newSheet').value] || {}).mode === mode) ? $('#newSheet').value : (sheets[0] || [])[0]) || (mode === '2d6' ? '2d6' : 'dnd5e');
  const kinds = mode === '2d6' ? TWO : FIVE;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const remembered = V.store.get('vtt-npc-last', {});
  const was = kinds.findIndex(k => k[0] === remembered.kind);
  let kind = was >= 0 ? was : mode === '2d6' ? 2 : 1;
  const name = h('input', { type: 'text', placeholder: 'Their name', style: 'flex:1', value: '' });
  const who = h('textarea', { rows: 3, placeholder: '“Keeps the Drowned Rat, owes the guild money”', style: 'width:100%;resize:vertical' });
  const people = h('select', { title: 'Whose names to forge from (the wiki’s “Common Names of …” pages)', style: 'max-width:46%' }, h('option', { value: '' }, 'Names: anyone'));
  const sex = h('select', { title: 'A man’s or a woman’s name' }, h('option', { value: '' }, 'Either'), h('option', { value: 'm' }, 'Man'), h('option', { value: 'f' }, 'Woman'));
  let PEOPLE = [];
  const roll = async () => {
    const N = await loadForge();
    const p = PEOPLE[+people.value];
    let nm = '';
    try {
      if (N && p) nm = (N.forgePeople(p, sex.value || 'any', 1)[0] || {}).name || '';
      else if (N && PEOPLE.length) { const q = pick(PEOPLE); nm = (N.forgePeople(q, sex.value || 'any', 1)[0] || {}).name || ''; }
    } catch (e) { nm = ''; }
    name.value = nm || plainName();
  };
  loadForge().then(N => {
    if (!N) return;
    try { PEOPLE = N.people(); } catch (e) { PEOPLE = []; }
    PEOPLE.forEach((p, i) => people.append(h('option', { value: i, selected: remembered.people === p.key || null }, `${p.race} · ${p.nation}`)));
    if (!name.value) roll();
  });
  const hpOut = h('b'), statLine = h('div', { class: 'npcstats' });
  let rolled = null, scores = null;   // scores: rolled 3d6+2 (in ABIL order), or null for the stat line's own
  // 5e: the race and class (from the Features: the SRD and the GM's books), the level, their kit and spells
  if (mode === '5e') await V.loadFeatures().catch(() => null);
  const feats = mode === '5e' && V.allFeatures ? V.allFeatures() : [];
  const RACES = [...new Set(feats.filter(f => f.kind === 'race').flatMap(f => f.races || []))].sort();
  const CLASSES = [...new Set(feats.filter(f => f.kind === 'class' && f.cls).map(f => f.cls))].sort();
  const raceSel = h('select', { title: 'Their people: the racial traits go on the sheet', style: 'flex:1' }, h('option', { value: '' }, 'Race: none'),
    ...RACES.map(r => h('option', { value: r, selected: remembered.race === r || null }, r)));
  const clsSel = h('select', { title: 'The class on their sheet (its features at their level go on too)', style: 'flex:1', onchange: () => { if (scores) scores = arrange(scores.slice().sort((a, b) => b - a)); draw(); } },
    h('option', { value: '' }, 'Class: none'), ...CLASSES.map(c => h('option', { value: c }, c)));
  const lvIn = h('input', { type: 'number', min: 1, max: 20, value: 1, style: 'width:64px', title: 'Their level', oninput: () => draw() });
  const kitBox = h('input', { type: 'checkbox', checked: remembered.kit !== false || null });
  const spellBox = h('input', { type: 'checkbox', checked: remembered.spells !== false || null });
  const fitRole = () => { const k = kinds[kind], c = ROLE_CLASS[k[0]] || ''; clsSel.value = CLASSES.includes(c) ? c : ''; lvIn.value = CR_LEVEL[k[3]] || 1; };
  // rolled scores, best to the class's own: [str, dex, con, int, wis, cha]
  const arrange = sorted => { const order = (PRIORITY[clsSel.value] || PRIORITY['']).split(' '), out = []; order.forEach((a, i) => { out[SHORT2.indexOf(a)] = sorted[i]; }); return out; };
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const rollScores = () => { let set; do { set = Array.from({ length: 6 }, () => d6() + d6() + d6() + 2); } while (set.reduce((a, b) => a + b, 0) / 6 < 12); scores = arrange(set.sort((a, b) => b - a)); draw(); };
  const abil = () => scores || kinds[kind][4];
  const draw = () => {
    const k = kinds[kind];
    if (mode === '2d6') { statLine.textContent = `${k[1]} HP · armour ${k[2]} · attributes about ${k[3]} · ${k[4]}`; return; }
    const hp = rolled == null ? average(k[2]) : rolled, a = abil(), sp = spellPlan(clsSel.value, +lvIn.value || 1);
    const chip = (lab, v, sub) => h('div', { class: 'npcchip' }, h('span', null, lab), h('b', null, v), sub ? h('small', null, sub) : null);
    statLine.replaceChildren(
      h('div', { class: 'npcchips' }, chip('AC', k[1]), chip('HP', hp, rolled == null ? `avg ${k[2]}` : `rolled ${k[2]}`), chip('CR', k[3]), chip('Level', +lvIn.value || 1, clsSel.value || 'no class')),
      h('div', { class: 'npcabs' + (scores ? ' rolled' : '') }, ...ABIL.map((ab, i) => h('div', { class: 'npcab' }, h('span', null, ab.slice(0, 3).toUpperCase()), h('b', null, a[i]), h('small', null, (mod(a[i]) >= 0 ? '+' : '') + mod(a[i]))))),
      h('div', { class: 'npccast muted small' }, scores ? 'Rolled 3d6+2, the best to their class’s abilities. ' : 'The stat line’s own scores. ',
        sp && (sp.top || sp.cantrips) ? `Casts ${sp.cantrips ? sp.cantrips + ' cantrips and ' : ''}spells up to level ${sp.top}.` : clsSel.value ? 'No spells at this level.' : ''));
  };
  const kindSel = h('select', { style: 'width:100%', title: 'Their stat line: its AC, hit dice and scores (and a class and level to go with it)', onchange: e => { kind = +e.target.value; rolled = null; scores = null; fitRole(); draw(); } },
    ...kinds.map((k, i) => h('option', { value: i, selected: i === kind || null }, mode === '2d6' ? `${k[0]} (${k[1]} HP, armour ${k[2]})` : `${k[0]} (CR ${k[3]}, AC ${k[1]})`)));
  const rollHP = mode === '5e' ? h('button', { class: 'btn sm', title: 'Roll their hit points rather than taking the average', onclick: () => { rolled = rollDice(kinds[kind][2]); draw(); } }, '🎲 Roll HP') : null;
  const rollAb = mode === '5e' ? h('button', { class: 'btn sm', title: 'Roll their ability scores, 3d6+2 each (a set averaging under 12 is rolled again), the best to their class’s own', onclick: rollScores }, '🎲 Roll stats') : null;
  const resetAb = mode === '5e' ? h('button', { class: 'btn sm', title: 'Back to the stat line’s own scores', onclick: () => { scores = null; draw(); } }, 'Stat line') : null;
  if (mode === '5e') fitRole();
  const canPlace = !!state.scene;
  const place = h('input', { type: 'checkbox', checked: canPlace && remembered.place !== false || null, disabled: !canPlace || null });
  const hidden = h('input', { type: 'checkbox', checked: remembered.hidden || null, disabled: !canPlace || null });
  const openIt = h('input', { type: 'checkbox', checked: remembered.open || null });
  const make = async () => {
    const k = kinds[kind], nm = name.value.trim() || plainName();
    V.store.set('vtt-npc-last', { kind: k[0], people: PEOPLE[+people.value] ? PEOPLE[+people.value].key : '', place: place.checked, hidden: hidden.checked, open: openIt.checked,
      race: raceSel.value, kit: kitBox.checked, spells: spellBox.checked });
    go.disabled = true; go.textContent = 'Making them…';
    try {
      let cid, set = { character_name: nm };
      if (mode === '5e') {
        cid = await make5e(nm, k);
        set = { hp: rolled == null ? average(k[2]) : rolled };
      } else {
      const r = await V.op({ t: 'char.create', char: { name: nm, sheet } });
      cid = r && r.op && r.op.char && r.op.char.id; if (!cid) throw new Error('No character made');
      // the stats on the sheet
      if (mode === '2d6') {
        Object.assign(set, { hp: k[1], hp_max: k[1], armour: k[2], level: Math.max(1, kind), notes: who.value.trim() || k[4] });
        SHORT2.forEach(a => { set[a] = k[3]; });
      } else {
        const hp = rolled == null ? average(k[2]) : rolled;
        Object.assign(set, { is_npc: 1, npc_type: who.value.trim() ? who.value.trim() : k[5], npc_ac: k[1], npc_actype: '', npc_hp: hp, npc_hp_max: hp, npc_hp_hit_dice: k[2], npc_challenge: k[3],
          hp, hp_max: hp, ac: k[1], npc_speed: '30 ft.', npc_languages: 'Common' });
        ABIL.forEach((a, i) => { set[a] = k[4][i]; set['npc_' + a] = k[4][i]; });
        if (who.value.trim()) set.npc_traits = who.value.trim();
      }
      await V.send({ t: 'charAttrs', char: cid, set });
      }
      // in the Journal's NPCs folder
      let f = (c.charFolders || []).find(x => /^npcs?$/i.test(x.name));
      if (!f) { await V.op({ t: 'folders.set', folders: (c.charFolders || []).concat([{ id: 'npcs', name: 'NPCs' }]) }).catch(() => null); f = { id: 'npcs' }; }
      await V.op({ t: 'char.update', id: cid, patch: { folder: f.id } }).catch(() => null);
      // a token on the scene, in the middle of the view
      if (place.checked && state.scene) {
        const p = V.viewCenter(), g = V.grid ? V.grid() : null;
        const [x, y] = window.Geom && g ? Geom.snap(g, p.x, p.y, 1) : [p.x, p.y];
        const hpv = +set.hp || 1;
        const tr = await V.op({ t: 'token.create', scene: state.scene.id, token: { name: nm, sheet: cid, x, y, size: 1, layer: hidden.checked ? 'gm' : (state.layer === 'gm' ? 'gm' : 'tokens'), hp: { v: hpv, max: hpv } } }).catch(() => null);
        if (tr && tr.op && tr.op.token && V.setSel) V.setSel([tr.op.token.id]);
      }
      close();
      V.toast(`${nm} is in the Journal (NPCs).`);
      if (openIt.checked) V.openSheet(cid);
    } catch (e) { V.toast('Couldn’t make them: ' + (e.message || e), true); go.disabled = false; go.textContent = 'Make them'; }
  };
  // a 5e character: race, class and level, the scores, hit points and the role's AC; the class's and race's features;
  // then their kit (the SRD's cards, into their inventory) and, for a caster, their spells
  async function make5e(nm, k) {
    const cls = clsSel.value, level = Math.max(1, Math.min(20, +lvIn.value || 1)), race = raceSel.value, a = abil();
    const hp = rolled == null ? average(k[2]) : rolled, abilities = {}; SHORT2.forEach((x, i) => { abilities[x] = a[i]; });
    const features = V.featuresFor ? V.featuresFor({ class: cls, base_level: level, race })
      .filter(f => !/^(ability score improvement|epic boon)$/i.test(f.name) && !/ Subclass$/.test(f.name))
      .map(f => ({ name: V.featureShortName ? V.featureShortName(f) : f.name, text: f.text, kind: f.kind })) : [];
    const r = await V.send({ t: 'createChar5e', char: { name: nm, sheet, level, cls, race, abilities, saves: SAVES[cls] || [], skills: (SKILLS[cls] || SKILLS['']).split(' '), hp, features } });
    const cid = r && r.id; if (!cid) throw new Error('No character made');
    for (let i = 0; i < 40 && !(state.camp.characters || []).some(x => x.id === cid); i++) await new Promise(res => setTimeout(res, 100));
    const extra = { ac: k[1], npc_ac: k[1] }; if (who.value.trim()) extra.personality_traits = who.value.trim();
    await V.send({ t: 'charAttrs', char: cid, set: extra }).catch(() => null);
    const norm = x => String(x || '').toLowerCase().replace(/[’']/g, "'").trim();
    if (kitBox.checked) {
      await V.loadItems().catch(() => null);
      const all = V.allItems ? V.allItems() : [], byName = new Map(all.map(i => [norm(i.name), i]));
      const list = (ROLE_KIT[k[0]] && !cls ? ROLE_KIT[k[0]] : []).concat(KIT[cls] || KIT['']);
      const seen = new Set(), ops = [];
      for (const e of list) {
        const [nmI, q] = e.split('×'), it = byName.get(norm(nmI)); if (!it || seen.has(it.name)) continue; seen.add(it.name);
        ops.push(V.op({ t: 'inv.add', char: cid, item: it, qty: +q || 1 }).catch(() => null));   // (all sent at once: the server takes them in turn)
      }
      await Promise.all(ops);
    }
    const plan = spellBox.checked ? spellPlan(cls, level) : null;
    if (plan) {
      await V.loadSpells().catch(() => null);
      const all = V.allSpells ? V.allSpells() : [], mine = all.filter(x => (x.classes || []).some(cc => norm(cc) === norm(cls)));
      const likes = (LIKES[cls] || []).map(norm), picked = [];
      for (let l = 0; l <= plan.top; l++) {
        const want = l === 0 ? plan.cantrips : plan.per(l); if (!want) continue;
        const pool = mine.filter(x => (x.level || 0) === l);
        const first = pool.filter(x => likes.includes(norm(x.name))).sort((p, q) => likes.indexOf(norm(p.name)) - likes.indexOf(norm(q.name)));
        const rest = pool.filter(x => !first.includes(x)).sort(() => Math.random() - .5);
        picked.push(...first.concat(rest).slice(0, want));
      }
      await Promise.all(picked.map(sp => V.op({ t: 'spell.learn', char: cid, spell: sp }).catch(() => null)));
    }
    return cid;
  }
  const go = h('button', { class: 'btn primary', onclick: make }, 'Make them');
  // two columns: who they are (left), what they are (right); the 2D6 dialog keeps one
  const sect = (title, ...kids) => h('section', { class: 'npcsec' }, h('h3', null, title), ...kids);
  const toggle = (box, text, title) => h('label', { class: 'npctog', title: title || '' }, box, h('span', null, text));
  const whoCol = h('div', { class: 'npccol' },
    sect('Who',
      h('div', { class: 'row' }, name, h('button', { class: 'btn', title: 'A name from the Name Forge, in the style of the world’s own names', onclick: roll }, '✦ Forge')),
      h('div', { class: 'row', style: 'margin-top:6px' }, people, sex),
      h('label', null, 'Who they are'), who),
    sect('On the table',
      toggle(place, 'Put a token in the middle of the scene', canPlace ? '' : 'Open a scene first'),
      toggle(hidden, 'Hidden from the players (the GM layer)'),
      toggle(openIt, 'Open their sheet afterwards')));
  const whatCol = h('div', { class: 'npccol' },
    sect(mode === '2d6' ? 'What they are (2D6)' : 'What they are',
      kindSel,
      mode === '5e' ? h('div', { class: 'npcbuild' }, raceSel, clsSel, h('label', { class: 'inline', title: 'Their level' }, 'Lv', lvIn)) : null,
      statLine,
      h('div', { class: 'npcrolls' }, rollAb, resetAb, rollHP)),
    mode === '5e' ? sect('Gear and magic',
      toggle(kitBox, 'Their class’s kit, in their inventory', 'Their class’s starting kit (or the stat line’s gear, with no class)'),
      toggle(spellBox, 'Spells, if they cast', 'A caster’s cantrips and spells, by class and level')) : null);
  modal.replaceChildren(h('div', { class: 'dialog npcdlg' + (mode === '5e' ? ' two' : '') },
    h('div', { class: 'dh' }, h('h2', null, 'Quick NPC'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db npcgrid' }, whoCol, whatCol),
    h('div', { class: 'df' }, h('span', { class: 'muted small' }, 'They go in the Journal’s NPCs folder.'), h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), go)));
  modal.hidden = false;
  draw();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
  setTimeout(() => name.focus(), 30);
};
})();
