/* D&D Beyond characters into the plain description shared/sheet5e.js writes onto either 5e sheet.
 * Reads the JSON D&D Beyond's own character pages load (character-service.dndbeyond.com/character/v5/character/<id>,
 * for a character whose privacy is set to Public): ability scores with racial and other bonuses, saves and skills
 * (proficiency, expertise), hit points, speed, armour class (worked out from what's worn), class levels, weapons,
 * spells, inventory, and the class features, racial traits and feats up to the character's level, with their text.
 * D&D Beyond's numbers depend on rules it doesn't send in full, so a few things (some bonuses, odd AC sources) may
 * need setting by hand. */
'use strict';
const { plain } = require('./foundry.js');
const num = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };
const s = v => v == null ? '' : String(v);
const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABN = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };
const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const ALIGN = { 1: 'Lawful Good', 2: 'Neutral Good', 3: 'Chaotic Good', 4: 'Lawful Neutral', 5: 'Neutral', 6: 'Chaotic Neutral', 7: 'Lawful Evil', 8: 'Neutral Evil', 9: 'Chaotic Evil' };
const ACT = { 1: 'action', 2: 'no action', 3: 'bonus action', 4: 'reaction', 6: 'minute', 7: 'hour', 8: 'special' };

// a character's id from a link (dndbeyond.com/characters/12345678, its /builder or share links) or the number itself
function idOf(x) { const m = /(?:characters\/|^)(\d{4,12})(?:\/|$|\?)/.exec(s(x).trim()); return m ? m[1] : null; }
const apiUrl = id => `https://character-service.dndbeyond.com/character/v5/character/${id}`;
function isDDB(j) { const d = j && (j.data || j); return !!(d && typeof d === 'object' && Array.isArray(d.stats) && Array.isArray(d.classes) && d.modifiers); }

function modelOf(j) {
  const d = j.data || j;
  const mods = Object.values(d.modifiers || {}).flat().filter(x => x && typeof x === 'object');
  const m = { abilities: {}, saves: [], skills: {}, classLevels: {}, weapons: [], spells: [], items: [], features: [] };
  // ability scores: base, plus bonuses (race, feats, items), unless set outright
  for (const [i, k] of AB.entries()) {
    const id = i + 1, base = num((d.stats.find(x => x.id === id) || {}).value, 10);
    const bonus = num((d.bonusStats || []).find(x => x.id === id) && d.bonusStats.find(x => x.id === id).value, 0);
    const over = (d.overrideStats || []).find(x => x.id === id);
    let v = base + bonus + mods.filter(x => x.type === 'bonus' && x.subType === ABN[k] + '-score').reduce((t, x) => t + num(x.value, 0), 0);
    for (const x of mods) if (x.type === 'set' && x.subType === ABN[k] + '-score') v = Math.max(v, num(x.value, v));
    if (over && over.value != null) v = num(over.value, v);
    m.abilities[k] = v;
  }
  const mod = k => Math.floor((m.abilities[k] - 10) / 2);
  for (const k of AB) if (mods.some(x => x.type === 'proficiency' && x.subType === ABN[k] + '-saving-throws')) m.saves.push(k);
  const SK = ['acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival'];
  const jack = mods.some(x => x.type === 'half-proficiency' && x.subType === 'ability-checks');
  for (const sk of SK) {
    const key = sk.replace(/-/g, '_');
    if (mods.some(x => x.type === 'expertise' && x.subType === sk)) m.skills[key] = 'e';
    else if (mods.some(x => x.type === 'proficiency' && x.subType === sk)) m.skills[key] = 'p';
    else if (jack || mods.some(x => x.type === 'half-proficiency' && x.subType === sk)) m.skills[key] = 'j';
  }
  // classes and levels
  for (const c of d.classes || []) {
    const n = s(c.definition && c.definition.name).toLowerCase(); if (n) m.classLevels[n] = num(c.level, 1);
  }
  const level = Object.values(m.classLevels).reduce((a, b) => a + b, 0) || 1;
  const top = (d.classes || []).slice().sort((a, b) => (b.isStartingClass ? 1 : 0) - (a.isStartingClass ? 1 : 0) || num(b.level, 0) - num(a.level, 0))[0];
  if (top) { m.cls = s(top.definition && top.definition.name); m.subclass = s(top.subclassDefinition && top.subclassDefinition.name); }
  m.level = level;
  // hit points
  const hpPer = mods.filter(x => x.type === 'bonus' && x.subType === 'hit-points-per-level').reduce((t, x) => t + num(x.value, 0), 0);
  const max = d.overrideHitPoints != null ? num(d.overrideHitPoints, 0) : num(d.baseHitPoints, 0) + num(d.bonusHitPoints, 0) + (mod('con') + hpPer) * level;
  m.hpMax = max; m.hp = Math.max(0, max - num(d.removedHitPoints, 0)); m.hpTemp = num(d.temporaryHitPoints, 0) || '';
  // who they are
  const race = d.race || {};
  m.race = s(race.fullName || race.baseName);
  const walk = race.weightSpeeds && race.weightSpeeds.normal && race.weightSpeeds.normal.walk;
  if (walk) m.speed = walk + ' ft';
  m.background = s(d.background && d.background.definition && d.background.definition.name);
  m.alignment = ALIGN[d.alignmentId] || '';
  m.xp = num(d.currentXp, 0);
  m.inspiration = !!d.inspiration;
  const tr = d.traits || {}, nt = d.notes || {};
  m.personality = plain(tr.personalityTraits); m.ideals = plain(tr.ideals); m.bonds = plain(tr.bonds); m.flaws = plain(tr.flaws); m.appearance = plain(tr.appearance);
  m.backstory = plain(nt.backstory);
  m.notes = [nt.allies && 'Allies: ' + plain(nt.allies), nt.organizations && 'Organisations: ' + plain(nt.organizations), nt.otherNotes && plain(nt.otherNotes)].filter(Boolean).join('\n\n');
  // inventory: weapons, armour (for the AC) and everything else
  let armour = null, shield = 0;
  for (const it of d.inventory || []) {
    const df = it.definition || {}, name = s(df.name); if (!name) continue;
    const desc = plain(df.description);
    m.items.push({ name, qty: num(it.quantity, 1), weight: num(df.weight, 0), desc });
    if (df.filterType === 'Weapon' || df.damage) {
      const props = (df.properties || []).map(p => s(p.name).toLowerCase());
      const ranged = num(df.attackType, 1) === 2;
      m.weapons.push({ name, ability: props.includes('finesse') ? (mod('dex') >= mod('str') ? 'dex' : 'str') : ranged ? 'dex' : 'str', magic: num((df.grantedModifiers || []).filter(x => x.type === 'bonus' && x.subType === 'magic').reduce((t, x) => t + num(x.value, 0), 0), 0),
        damage: s(df.damage && df.damage.diceString), dtype: s(df.damageType).toLowerCase(), range: df.range && df.longRange ? `${df.range}/${df.longRange} ft` : '', ranged });
    }
    if (it.equipped && df.armorClass) {
      if (num(df.armorTypeId, 0) === 4) shield = Math.max(shield, num(df.armorClass, 2));
      else if (!armour || num(df.armorClass, 0) > num(armour.armorClass, 0)) armour = df;
    }
  }
  const dex = mod('dex');
  let ac = armour ? num(armour.armorClass, 10) + (num(armour.armorTypeId, 1) === 1 ? dex : num(armour.armorTypeId, 1) === 2 ? Math.min(2, dex) : 0) : 10 + dex;
  if (!armour) {   // unarmoured defence (barbarian, monk) and the like
    const ud = mods.filter(x => x.type === 'set' && x.subType === 'unarmored-armor-class');
    for (const x of ud) { const k = AB[num(x.statId, 0) - 1]; if (k) ac = Math.max(ac, 10 + dex + mod(k)); }
  }
  ac += shield + mods.filter(x => x.type === 'bonus' && x.subType === 'armor-class').reduce((t, x) => t + num(x.value, 0), 0);
  m.ac = ac;
  // spells: the classes' and those from race, items and feats
  const lists = [].concat(...(d.classSpells || []).map(c => c.spells || []), ...Object.values(d.spells || {}).filter(Array.isArray));
  const seen = new Set();
  for (const sp of lists) {
    const df = sp && sp.definition; if (!df || !df.name || seen.has(df.name)) continue;
    seen.add(df.name);
    const a = sp.activation || df.activation || {}, r = df.range || {}, du = df.duration || {};
    const comps = (df.components || []).map(c => ({ 1: 'V', 2: 'S', 3: 'M' })[c]).filter(Boolean);
    m.spells.push({ level: num(df.level, 0), name: s(df.name), school: SCHOOLS.find(x => x.toLowerCase() === s(df.school).toLowerCase()) || s(df.school),
      time: a.activationType ? `${a.activationTime || 1} ${ACT[a.activationType] || ''}`.trim() : '',
      range: r.origin === 'Ranged' ? `${r.rangeValue || ''} ft` : s(r.origin) + (r.rangeValue && r.origin !== 'Ranged' ? ` (${r.rangeValue} ft)` : ''),
      duration: du.durationType === 'Instantaneous' ? 'Instantaneous' : du.durationInterval ? `${du.durationType === 'Concentration' ? 'Concentration, up to ' : ''}${du.durationInterval} ${s(du.durationUnit).toLowerCase()}${du.durationInterval > 1 ? 's' : ''}` : s(du.durationType),
      components: comps.map(c => c === 'M' && df.componentsDescription ? `M (${s(df.componentsDescription)})` : c).join(', '),
      desc: plain(df.description), higher: '', prepared: !!(sp.prepared || sp.alwaysPrepared || num(df.level, 0) === 0),
      ritual: !!df.ritual, concentration: !!df.concentration });
  }
  // features: class features up to each class's level, subclass ones too, racial traits, feats
  for (const c of d.classes || []) {
    const lv = num(c.level, 1);
    const fs = [].concat(c.classFeatures || [], ...(c.subclassDefinition && c.subclassDefinition.classFeatures ? [c.subclassDefinition.classFeatures.map(f => ({ definition: f }))] : []));
    const named = new Set();
    for (const f of fs) {
      const df = f.definition || f; if (!df || !df.name || num(df.requiredLevel, 1) > lv || named.has(df.name) || /^(Hit Points|Proficiencies|Ability Score Improvement)$/i.test(df.name)) continue;
      named.add(df.name);
      m.features.push({ name: s(df.name), desc: plain(df.description || df.snippet), source: 'class' });
    }
  }
  for (const t of (race.racialTraits || [])) { const df = t.definition || {}; if (df.name && !/^(Ability Score Increase|Age|Size|Speed|Languages|Alignment)$/i.test(df.name)) m.features.push({ name: s(df.name), desc: plain(df.description || df.snippet), source: 'race' }); }
  for (const f of d.feats || []) { const df = f.definition || {}; if (df.name) m.features.push({ name: s(df.name), desc: plain(df.description || df.snippet), source: 'feat' }); }
  return { name: s(d.name) || 'Character', avatar: s(d.decorations && d.decorations.avatarUrl) || s(d.avatarUrl) || null, model: m };
}

module.exports = { idOf, apiUrl, isDDB, modelOf };
