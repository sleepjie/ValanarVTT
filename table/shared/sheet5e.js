/* The two D&D 5e sheets store the same character under different names. This reads either into one plain
 * description of the character and writes that description back out for either sheet. Used to switch a character
 * between the Community and Legacy sheets, and by the Foundry import.
 *
 * model: { abilities: { str, dex, con, int, wis, cha }, saves: Set-like [ 'str', … ], skills: { athletics: 'p' | 'e' | 'j' },
 *          hp, hpMax, hpTemp, race, cls, level, classLevels: { fighter: 3 }, xp, alignment, background, speed, ac,
 *          inspiration, personality, ideals, bonds, flaws, appearance, backstory, notes,
 *          weapons: [{ name, ability: 'str' | 'dex' | 'finesse' | …, magic, damage, dtype, range, ranged }],
 *          spells: [{ level, name, school, time, range, duration, components: 'V, S, M (…)', desc, higher, prepared, ritual, concentration }],
 *          items: [{ name, qty, weight, desc }], features: [{ name, desc, source }] }
 */
(function (root) {
  'use strict';
  const AB = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  const AB3 = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  const ABF = Object.fromEntries(Object.entries(AB3).map(([k, v]) => [v, k]));
  // skill: [community name, legacy name]
  const SKILLS = { acrobatics: ['acrobatics', 'acrobatics'], animal_handling: ['animalhandling', 'animal_handling'], arcana: ['arcana', 'arcana'],
    athletics: ['athletics', 'athletics'], deception: ['deception', 'deception'], history: ['history', 'history'], insight: ['insight', 'insight'],
    intimidation: ['intimidation', 'intimidation'], investigation: ['investigation', 'investigation'], medicine: ['medicine', 'medicine'],
    nature: ['nature', 'nature'], perception: ['perception', 'perception'], performance: ['performance', 'performance'],
    persuasion: ['persuasion', 'persuasion'], religion: ['religion', 'religion'], sleight_of_hand: ['sleightofhand', 'sleight_of_hand'],
    stealth: ['stealth', 'stealth'], survival: ['survival', 'survival'] };
  const CLASSES = ['artificer', 'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const n = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : (d == null ? 0 : d); };
  const REP = /^repeating_([^_]+)_(-[^_]+)_(.+)$/;

  function rows(attrs, sec) {
    const out = new Map();
    const order = (attrs['_reporder_repeating_' + sec] || '').toLowerCase().split(',').filter(Boolean);
    for (const id of order) out.set(id, {});
    for (const [k, v] of Object.entries(attrs)) {
      const m = REP.exec(k); if (!m || m[1] !== sec) continue;
      if (!out.has(m[2])) out.set(m[2], {});
      out.get(m[2])[m[3]] = v;
    }
    return [...out.values()].filter(r => Object.keys(r).length);
  }
  // [[row id, { field: value }], …] in the sheet's order
  function rowsById(attrs, sec) {
    const out = new Map();
    for (const id of (attrs['_reporder_repeating_' + sec] || '').toLowerCase().split(',').filter(Boolean)) out.set(id, {});
    for (const [k, v] of Object.entries(attrs)) {
      const m = REP.exec(k); if (!m || m[1] !== sec) continue;
      if (!out.has(m[2])) out.set(m[2], {});
      out.get(m[2])[m[3]] = v;
    }
    return [...out].filter(([, r]) => Object.keys(r).length);
  }
  function rowId() {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '-' + Date.now().toString(36).slice(-6);
    while (s.length < 20) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function addRows(set, attrs, sec, list) {
    if (!list.length) return;
    const ids = [];
    for (const r of list) { const id = rowId(); ids.push(id); for (const [k, v] of Object.entries(r)) if (v != null && v !== '') set[`repeating_${sec}_${id}_${k}`] = String(v); }
    const prev = (attrs['_reporder_repeating_' + sec] || '').split(',').filter(Boolean);
    set['_reporder_repeating_' + sec] = prev.concat(ids).join(',');
  }
  const abilityOf = v => { const m = /@\{(\w+?)_mod\}/.exec(String(v || '')); return m ? (AB3[m[1]] || m[1]) : null; };

  // ───────── reading ─────────

  const on = v => v != null && v !== '' && v !== '0';
  const has = (a, k) => a[k] != null;
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const LEVELS = ['cantrip', 1, 2, 3, 4, 5, 6, 7, 8, 9];
  // Community armour types are formulas (the option values of its select)
  const ATYPE = { light: '@{dexterity_mod} + 0.002', medium: '(ceil((@{dexterity_mod}-1)/1e10)*2 - floor((@{dexterity_mod}-2)/1e10)*@{dexterity_mod}) + 0.003', heavy: '0.004' };
  const LTYPE = { light: 'Light Armor', medium: 'Medium Armor', heavy: 'Heavy Armor', shield: 'Shield' };
  // Community keeps features as three blocks of text; Legacy as a list
  const FEAT_TEXT = { class: 'class_features', race: 'racial_traits', feat: 'class_abilities_and_feats' };
  const FEAT_LABEL = { class: 'Class features', race: 'Racial traits', feat: 'Feats and notes' };
  const HIT_DIE = { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, sorcerer: 6, wizard: 6 };
  // Community has four proficiency boxes; Legacy one ("Languages: …" lines)
  const PROFS = [['armour', /^armou?r( proficienc(y|ies))?$/i, 'Armour'], ['weapons', /^weapons?( proficienc(y|ies))?$/i, 'Weapons'],
    ['tools', /^tools?( proficienc(y|ies))?$/i, 'Tools'], ['languages', /^languages?$/i, 'Languages']];

  function parseProfs(text) {
    const out = {}, other = [];
    for (const line of String(text).split('\n')) {
      const m = /^\s*([^:]{1,30}):\s*(.*)$/.exec(line), p = m && PROFS.find(([, re]) => re.test(m[1].trim()));
      if (p) out[p[0]] = m[2].trim(); else if (line.trim()) other.push(line.trim());
    }
    if (other.length) out.other = other.join('\n');
    return out;
  }
  function composeProfs(p) {
    const lines = PROFS.filter(([k]) => p[k]).map(([k, , label]) => `${label}: ${p[k]}`);
    if (p.other) lines.push(p.other);
    return lines.join('\n');
  }
  // "Item Type: Heavy Armor, AC: 18, AC +1" on a Legacy inventory row
  function parseArmor(mods) {
    if (!mods || !/\bac\b/i.test(mods)) return null;
    let type = null, base, magic = 0;
    for (const raw of String(mods).split(',')) {
      const p = raw.trim();
      let m;
      if ((m = /^item type:\s*(.*)$/i.exec(p))) { const t = m[1].toLowerCase(); type = /light/.test(t) ? 'light' : /medium/.test(t) ? 'medium' : /heavy/.test(t) ? 'heavy' : /shield/.test(t) ? 'shield' : 'other'; }
      else if ((m = /^ac\s*:\s*(-?\d+)/i.exec(p))) base = +m[1];
      else if ((m = /^ac\s*([+-])\s*(\d+)/i.exec(p))) magic += (m[1] === '-' ? -1 : 1) * m[2];
    }
    if (base == null && !type) return null;
    return { base: base || 0, type: type || 'other', magic };
  }
  function armorMods(e, existing) {
    const rest = String(existing || '').split(',').map(x => x.trim()).filter(p => p && !/^item type:/i.test(p) && !/^ac\s*[:+-]/i.test(p));
    return [LTYPE[e.type] ? 'Item Type: ' + LTYPE[e.type] : null, 'AC: ' + (e.base || 0), e.magic ? `AC ${e.magic < 0 ? '-' : '+'}${Math.abs(e.magic)}` : null].filter(Boolean).concat(rest).join(', ');
  }
  // Community feature text: "Name: what it does" paragraphs; anything else stays as written
  function parseFeatures(text, source) {
    const out = [];
    for (const p of String(text || '').split(/\n[ \t]*\n/)) {
      if (!p.trim()) continue;
      const m = /^([^\n:]{1,60}):[ \t]*([\s\S]*)$/.exec(p.trim());
      if (m && m[1].trim().split(/\s+/).length <= 8) out.push({ name: m[1].trim(), desc: m[2].trim(), source });
      else if (out.length) out[out.length - 1].desc += (out[out.length - 1].desc ? '\n\n' : '') + p.trim();
      else out.push({ name: FEAT_LABEL[source], desc: p.trim(), source });
    }
    return out;
  }
  const featureText = list => list.map(f => f.name === FEAT_LABEL[f.source] ? f.desc : f.desc ? `${f.name}: ${f.desc}` : f.name).join('\n\n');
  const legacySource = s => /racial/i.test(s || 'Racial') ? 'race' : /class/i.test(s) ? 'class' : 'feat';

  // The character's lists, each entry with where it lives on the sheet (ref)
  function listRows(sheet, a) {
    const L = { weapons: [], spells: [], items: [], armor: [], features: [] };
    if (sheet === 'dnd5e_legacy') {
      for (const [id, r] of rowsById(a, 'attack')) if (r.atkname)
        L.weapons.push({ ref: { sec: 'attack', id }, e: { name: r.atkname, ability: abilityOf(r.atkattr_base) || 'str', magic: n(r.atkmagic), damage: r.dmgbase || '', dtype: r.dmgtype || '', range: r.atkrange || '' } });
      for (const lv of LEVELS) for (const [id, r] of rowsById(a, 'spell-' + lv)) {
        if (!r.spellname) continue;
        const comp = [on(r.spellcomp_v) ? 'V' : '', on(r.spellcomp_s) ? 'S' : '', on(r.spellcomp_m) ? 'M' + (r.spellcomp_materials ? ` (${r.spellcomp_materials})` : '') : ''].filter(Boolean).join(', ');
        L.spells.push({ ref: { sec: 'spell-' + lv, id }, e: { level: lv === 'cantrip' ? 0 : lv, name: r.spellname, school: r.spellschool, time: r.spellcastingtime, range: r.spellrange, duration: r.spellduration,
          components: comp, desc: r.spelldescription, higher: r.spellathigherlevels, prepared: r.spellprepared === '1', ritual: on(r.spellritual), concentration: on(r.spellconcentration) } });
      }
      for (const [id, r] of rowsById(a, 'inventory')) {
        if (!r.itemname) continue;
        L.items.push({ ref: { sec: 'inventory', id }, e: { name: r.itemname, qty: n(r.itemcount, 1), weight: n(r.itemweight), desc: r.itemcontent || '' } });
        const ar = parseArmor(r.itemmodifiers);
        if (ar) L.armor.push({ ref: { sec: 'inventory', id }, e: Object.assign({ name: r.itemname }, ar, { worn: r.equipped == null ? true : on(r.equipped) }) });
      }
      for (const [id, r] of rowsById(a, 'traits')) if (r.name) L.features.push({ ref: { sec: 'traits', id }, e: { name: r.name, desc: r.description || '', source: legacySource(r.source) } });
    } else {
      for (const kind of ['melee', 'ranged']) for (let i = 1; i <= 6; i++) {
        const name = a[`${kind}weaponname${i}`]; if (!name) continue;
        L.weapons.push({ ref: { kind, i }, e: { name, ability: abilityOf(a[`${kind}attackstat${i}`]) || (kind === 'melee' ? 'str' : 'dex'), magic: n(a[`${kind}magic${i}`]),
          damage: a[`${kind}dmg${i}`] || '', dtype: a[`${kind}dmgtype${i}`] || '', ranged: kind === 'ranged' } });
      }
      for (const lv of LEVELS) {
        const sec = lv === 'cantrip' ? 'spellbookcantrip' : 'spellbooklevel' + lv;
        for (const [id, r] of rowsById(a, sec)) if (r.spellname)
          L.spells.push({ ref: { sec, id }, e: { level: lv === 'cantrip' ? 0 : lv, name: r.spellname, school: r.spellschool, time: r.spellcasttime, range: r.spellrange, duration: r.spellduration,
            components: r.spellcomponents, desc: r.spelldescription, higher: r.spellhighersloteffect, prepared: on(r.spellisprepared), ritual: on(r.spellritual), concentration: on(r.spellconcentration) } });
      }
      for (let i = 1; i <= 40; i++) if (a['inventoryname' + i])
        L.items.push({ ref: { kind: 'inventory', i }, e: { name: a['inventoryname' + i], qty: n(a['inventoryqty' + i], 1), weight: n(a['inventoryweight' + i]), desc: a['inventorydescription' + i] || '' } });
      for (let i = 1; i <= 10; i++) {
        const name = a['amourname' + i]; if (!name) continue;
        const t = String(a['armourtype' + i] || '');
        L.armor.push({ ref: { kind: 'armour', i }, e: { name, base: n(a['armouracbase' + i]),
          type: t.includes('0.002') ? 'light' : t.includes('0.003') ? 'medium' : t.includes('0.004') ? 'heavy' : /shield/i.test(name) ? 'shield' : 'other',
          magic: n(a['armourmagicbonus' + i]), worn: a['armouractive' + i] == null ? true : on(a['armouractive' + i]) } });
      }
      for (const src of ['class', 'race', 'feat']) for (const f of parseFeatures(a[FEAT_TEXT[src]], src)) L.features.push({ ref: { text: src }, e: f });
    }
    return L;
  }

  function toModel(sheet, a) {
    const m = { abilities: {}, saves: [], skills: {}, classLevels: {} };
    const legacy = sheet === 'dnd5e_legacy';
    for (const ab of AB) {
      m.abilities[AB3[ab]] = n(legacy ? (a[ab + '_base'] ?? a[ab]) : a[ab], 10);
      if (on(a[ab + '_save_prof'])) m.saves.push(AB3[ab]);
    }
    for (const [key, [cn, ln]] of Object.entries(SKILLS)) {
      if (legacy) {
        if (on(a[ln + '_prof'])) m.skills[key] = n(a[ln + '_type'], 1) >= 2 ? 'e' : 'p';
      } else {
        const p = String(a[cn + '_prof_exp'] || '0');
        if (p.includes('2*')) m.skills[key] = 'e'; else if (p.includes('floor')) m.skills[key] = 'j'; else if (p !== '0') m.skills[key] = 'p';
      }
    }
    m.hp = a.hp; m.hpMax = a.hp_max; m.hpTemp = legacy ? a.hp_temp : a.temp_hp;
    m.race = a.race; m.alignment = a.alignment; m.background = a.background; m.speed = a.speed;
    m.inspiration = on(a.inspiration);
    m.personality = a.personality_traits; m.ideals = a.ideals; m.bonds = a.bonds; m.flaws = a.flaws;
    m.death = { s: [1, 2, 3].map(i => on(a[legacy ? 'deathsave_succ' + i : 'death_save_success_' + i])), f: [1, 2, 3].map(i => on(a[legacy ? 'deathsave_fail' + i : 'death_save_fail_' + i])) };
    const slots = {};
    for (let l = 1; l <= 9; l++) {
      const cur = legacy ? `lvl${l}_slots_expended` : `spell_slots_l${l}`, max = legacy ? `lvl${l}_slots_total` : `spell_slots_l${l}_max`;
      const s = {};
      if (has(a, cur)) s.cur = n(a[cur]);
      if (has(a, max) && n(a[max]) > 0) s.max = n(a[max]);
      if (Object.keys(s).length) slots[l] = s;
    }
    if (Object.keys(slots).length) m.slots = slots;
    if (legacy) {
      m.cls = a.class === '' && a.cust_classname ? a.cust_classname : a.class;
      m.level = n(a.base_level, 1);
      if (m.cls) m.classLevels[String(m.cls).toLowerCase()] = m.level;
      m.xp = a.experience; m.appearance = a.character_appearance; m.backstory = a.character_backstory;
      m.notes = a.additional_feature_and_traits;
      if (has(a, 'other_proficiencies_and_languages')) m.profs = parseProfs(a.other_proficiencies_and_languages);
      if (has(a, 'hit_dice')) m.hitDice = n(a.hit_dice);
    } else {
      for (const c of CLASSES) { const l = n(a[c + '_level']); if (l > 0) m.classLevels[c] = l; }
      const top = Object.entries(m.classLevels).sort((x, y) => y[1] - x[1])[0];
      m.cls = a.class || (top ? cap(top[0]) : '');
      m.level = Object.values(m.classLevels).reduce((s, x) => s + x, 0) || n(a.level, 1);
      m.xp = a.xp; m.backstory = a.notes; m.notes = a.misc_notes;
      const p = {};
      for (const [k, key] of [['armour', 'pro_armour'], ['weapons', 'pro_weapons'], ['tools', 'pro_tools'], ['languages', 'prolanguages']]) if (has(a, key)) p[k] = a[key];
      if (Object.keys(p).length) m.profs = p;
      if ([6, 8, 10, 12].some(d => has(a, 'hd_d' + d))) m.hitDice = [6, 8, 10, 12].reduce((s, d) => s + n(a['hd_d' + d]), 0);
    }
    const L = listRows(sheet, a);
    for (const k of Object.keys(L)) m[k] = L[k].map(x => x.e);
    return m;
  }

  // ───────── writing ─────────

  // The plain values (not the lists). `empty`: a cleared value is written as cleared, not skipped.
  function writeScalars(sheet, m, attrs, empty) {
    const s = {}, legacy = sheet === 'dnd5e_legacy', a = attrs || {};
    const put = (k, v) => { if (v != null && (empty || v !== '')) s[k] = String(v); };
    for (const ab of AB) {
      put(legacy ? ab + '_base' : ab, m.abilities && m.abilities[AB3[ab]]);
      if (m.saves) put(ab + '_save_prof', m.saves.includes(AB3[ab]) ? (legacy ? '(@{pb})' : '@{PB}') : '0');
    }
    if (m.skills) for (const [key, [cn, ln]] of Object.entries(SKILLS)) {
      const p = m.skills[key];
      if (legacy) { put(ln + '_prof', p === 'p' || p === 'e' ? `(@{pb}*@{${ln}_type})` : '0'); put(ln + '_type', p === 'e' ? 2 : 1); }
      else put(cn + '_prof_exp', p === 'e' ? '(2*@{PB})' : p === 'p' ? '@{PB}' : p === 'j' ? 'floor(@{PB} / 2)' : '0');
    }
    put('hp', m.hp); put('hp_max', m.hpMax); put(legacy ? 'hp_temp' : 'temp_hp', m.hpTemp);
    put('race', m.race); put('alignment', m.alignment); put('background', m.background); put('speed', m.speed);
    if (m.inspiration != null) put('inspiration', m.inspiration ? (legacy ? 'on' : '1') : '0');
    put('personality_traits', m.personality); put('ideals', m.ideals); put('bonds', m.bonds); put('flaws', m.flaws);
    if (m.death) for (let i = 0; i < 3; i++) {
      put(legacy ? 'deathsave_succ' + (i + 1) : 'death_save_success_' + (i + 1), m.death.s[i] ? (legacy ? 'on' : '1') : '0');
      put(legacy ? 'deathsave_fail' + (i + 1) : 'death_save_fail_' + (i + 1), m.death.f[i] ? (legacy ? 'on' : '1') : '0');
    }
    if (m.slots) for (const [l, sl] of Object.entries(m.slots)) {
      if (legacy) {
        put(`lvl${l}_slots_expended`, sl.cur);
        // Legacy works its total out from the class; the difference goes in its adjustment
        if (sl.max != null && has(a, `lvl${l}_slots_total`)) put(`lvl${l}_slots_mod`, sl.max - (n(a[`lvl${l}_slots_total`]) - n(a[`lvl${l}_slots_mod`])));
      } else { put(`spell_slots_l${l}`, sl.cur); put(`spell_slots_l${l}_max`, sl.max); }
    }
    if (legacy) {
      if (m.cls != null) {
        const cls = m.cls && CLASSES.includes(String(m.cls).toLowerCase()) ? cap(String(m.cls).toLowerCase()) : '';
        put('class', cls); if (!cls) put('cust_classname', m.cls);
      }
      put('base_level', m.level); put('experience', m.xp);
      put('character_appearance', m.appearance); put('character_backstory', m.backstory); put('additional_feature_and_traits', m.notes);
      if (m.profs) put('other_proficiencies_and_languages', composeProfs(m.profs));
      put('hit_dice', m.hitDice);
    } else {
      put('class', m.cls); put('xp', m.xp); put('notes', m.backstory); put('misc_notes', m.notes);
      if (m.classLevels) for (const c of CLASSES) put(c + '_level', m.classLevels[c] || (has(a, c + '_level') ? 0 : null));
      if (m.profs) {
        const p = m.profs, langs = [p.languages, p.other && p.other.split('\n').join(', ')].filter(x => x != null && x !== '');
        put('pro_armour', p.armour); put('pro_weapons', p.weapons); put('pro_tools', p.tools);
        if (p.languages != null || p.other != null) put('prolanguages', langs.join(', '));
      }
      if (m.hitDice != null) {
        // Community counts each size of hit die: the change goes to the main class's die
        const cur = {}; for (const d of [6, 8, 10, 12]) cur[d] = n(a['hd_d' + d]);
        let delta = m.hitDice - Object.values(cur).reduce((x, y) => x + y, 0);
        const top = CLASSES.map(c => [c, n(a[c + '_level'])]).sort((x, y) => y[1] - x[1])[0];
        const main = HIT_DIE[top && top[1] > 0 ? top[0] : ''] || 8;
        cur[main] += delta;
        for (const d of [12, 10, 8, 6]) if (cur[main] < 0 && d !== main) { const t = Math.min(cur[d], -cur[main]); cur[d] -= t; cur[main] += t; }
        cur[main] = Math.max(0, cur[main]);
        for (const d of [6, 8, 10, 12]) if (has(a, 'hd_d' + d) || cur[d]) put('hd_d' + d, cur[d]);
      }
    }
    return s;
  }

  // One list entry as the fields of one row (Legacy) or slot (Community)
  const closed = r => Object.assign({ 'options-flag': '0' }, r);   // Legacy rows arrive folded, not open for editing
  function rowFields(sheet, list, e, i) {
    const legacy = sheet === 'dnd5e_legacy';
    if (list === 'weapons') return legacy
      ? { atkname: e.name, atkflag: '{{attack=1}}', atkattr_base: `@{${ABF[e.ability] || 'strength'}_mod}`, atkmagic: e.magic || '', dmgflag: '{{damage=1}} {{dmg1flag=1}}',
          dmgbase: e.damage, dmgcustcrit: e.damage, dmgattr: `@{${ABF[e.ability] || 'strength'}_mod}`, dmgtype: e.dtype, atkrange: e.range, atkprofflag: '(@{pb})' }
      : { weaponname: e.name, attackstat: `@{${ABF[e.ability] || (e.ranged ? 'dexterity' : 'strength')}_mod}`, magic: e.magic || 0, dmg: e.damage || '0', critdmg: e.damage || '', weaponcritrange: 20, dmgtype: e.dtype };   // (a critical hit rolls the damage dice again: the same dice)
    if (list === 'spells') {
      if (legacy) {
        const c = String(e.components || '');
        return { spellname: e.name, spellschool: (e.school || '').toLowerCase(), spellcastingtime: e.time, spellrange: e.range, spellduration: e.duration,
          spellcomp_v: /\bV\b/.test(c) ? '{{v=1}}' : '0', spellcomp_s: /\bS\b/.test(c) ? '{{s=1}}' : '0', spellcomp_m: /\bM\b/.test(c) ? '{{m=1}}' : '0',
          spellcomp_materials: (/M\s*\(([^)]*)\)/.exec(c) || [])[1] || '', spelldescription: e.desc, spellathigherlevels: e.higher,
          spellprepared: e.prepared ? '1' : '0', spellritual: e.ritual ? '{{ritual=1}}' : '0', spellconcentration: e.concentration ? '{{concentration=1}}' : '0', spelllevel: e.level ? String(e.level) : 'cantrip' };
      }
      return { spellname: e.name, spellschool: e.school, spellcasttime: e.time, spellrange: e.range, spellduration: e.duration, spellcomponents: e.components,
        spelldescription: e.desc, spellhighersloteffect: e.higher, spellisprepared: e.prepared ? '1' : '0', spellritual: e.ritual ? '1' : '0', spellconcentration: e.concentration ? '1' : '0',
        spellbaselevel: String(e.level || 0), spellfriendlylevel: e.level ? 'Level ' + e.level : 'Cantrip', spellshowinfoblock: '{{spellshowinfoblock=1}}',
        spellshowdesc: '{{spellshowdesc=1}} {{spelldescription=@{spelldescription}}}', spellshowhigherlvl: e.higher ? '{{spellshowhigherlvl=1}} {{spellhigherlevel=@{spellhighersloteffect}}}' : null };
    }
    if (list === 'items') return legacy ? { itemname: e.name, itemcount: e.qty, itemweight: e.weight, itemcontent: e.desc }
      : { inventoryname: e.name, inventoryqty: e.qty, inventoryweight: e.weight, inventorydescription: e.desc };
    if (list === 'features') return { name: e.name, description: e.desc, source: e.source === 'race' ? 'Racial' : e.source === 'class' ? 'Class' : 'Feat' };
    if (list === 'armor') return { amourname: e.name, armouracbase: e.base, armourtype: ATYPE[e.type] || '0.001', armourmagicbonus: e.magic || 0, armouractive: e.worn ? `@{armourtotalAC${i}}` : '0' };
  }
  // Community slot keys: "meleeweaponname3", "inventoryqty12", "armouracbase2"
  const slotKey = (ref, f) => ref.kind === 'inventory' || ref.kind === 'armour' ? f + ref.i : ref.kind + f + ref.i;

  // What changed in a list since the last switch: entries are matched by name (spells by level and name)
  function keyed(list, keyOf) {
    const seen = {}, out = new Map();
    for (const x of list) {
      let k = keyOf(x.e || x); if (!k) continue;
      seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += '#' + seen[k];
      out.set(k, x);
    }
    return out;
  }
  function plan(src, snap, tgt, keyOf) {
    const S = keyed(src, keyOf), P = snap ? keyed(snap, keyOf) : null, T = keyed(tgt, keyOf);
    const update = [], add = [], remove = [];
    for (const [k, e] of S) {
      if (P && P.has(k) && same(P.get(k), e)) continue;   // not touched since the last switch
      if (T.has(k)) update.push([T.get(k), e]); else add.push(e);
    }
    for (const [k, r] of T) if (!S.has(k) && (!P || P.has(k))) remove.push(r);   // gone from the sheet that was in use
    return { update, add, remove };
  }
  const nameKey = e => norm(e.name);
  const spellKey = e => e.level + ':' + norm(e.name);

  // Carry a character from one 5e sheet to the other: only what was changed on `from` since the last switch (`snap`:
  // the model `from` was left with then), so details only one sheet has are kept. Returns { set, model }: the attributes
  // to change (null: remove) and the model to remember for the next switch.
  function sync(from, to, attrs, snap) {
    const a = attrs || {}, legacy = to === 'dnd5e_legacy';
    const src = toModel(from, a), tgt = toModel(to, a), set = {};
    const T = listRows(to, a);
    // plain values
    for (const f of ['abilities', 'saves', 'skills', 'hp', 'hpMax', 'hpTemp', 'race', 'alignment', 'background', 'speed', 'inspiration', 'personality', 'ideals',
      'bonds', 'flaws', 'cls', 'level', 'classLevels', 'xp', 'appearance', 'backstory', 'notes', 'profs', 'slots', 'death', 'hitDice']) {
      if (src[f] === undefined || (snap && same(snap[f], src[f]))) continue;
      const w = writeScalars(to, { [f]: src[f] }, a, true), wt = writeScalars(to, { [f]: tgt[f] }, a, true);
      for (const k of Object.keys(w)) if (w[k] !== wt[k] || !has(a, k)) set[k] = w[k];   // (absent: the other sheet's same-named field may have stood in for it)
    }
    if (from === to) return { set, model: tgt };
    const snapL = k => snap && snap[k] ? snap[k] : null;
    const putRow = (prefix, fields, empty) => { for (const [k, v] of Object.entries(fields)) if (v != null && (empty || v !== '')) set[prefix(k)] = String(v); };
    const diffRow = (prefix, w, wt) => { for (const k of Object.keys(w)) if (w[k] != null && String(w[k]) !== String(wt[k] ?? '')) set[prefix(k)] = String(w[k]); };
    const order = {};   // Legacy repeating sections whose rows come or go: their new order
    const orderOf = sec => order[sec] || (order[sec] = rowsById(a, sec).map(([id]) => id));
    const rowPrefix = ref => k => `repeating_${ref.sec}_${ref.id}_${k}`;
    const dropRow = ref => {
      const p = `repeating_${ref.sec}_${ref.id}_`;
      for (const k of Object.keys(a)) if (k.startsWith(p)) set[k] = null;
      order[ref.sec] = orderOf(ref.sec).filter(id => id !== ref.id);
    };
    const newRow = (sec, fields) => {
      const id = rowId().toLowerCase(), ref = { sec, id };
      putRow(rowPrefix(ref), closed(fields));
      orderOf(sec).push(id);
      return ref;
    };
    const usedSlots = {};
    const freeSlot = (kind, max) => {
      const u = usedSlots[kind] || (usedSlots[kind] = new Set(T[kind === 'armour' ? 'armor' : kind === 'inventory' ? 'items' : 'weapons'].filter(x => x.ref.kind === kind).map(x => x.ref.i)));
      for (let i = 1; i <= max; i++) if (!u.has(i) && !a[slotKey({ kind, i }, kind === 'armour' ? 'amourname' : kind === 'inventory' ? 'inventoryname' : 'weaponname')]) { u.add(i); return i; }
      return 0;
    };
    const dropSlot = ref => {
      const re = ref.kind === 'armour' ? new RegExp(`^(armour[a-z]+|amourname)${ref.i}$`) : ref.kind === 'inventory' ? new RegExp(`^inventory[a-z]+${ref.i}$`) : new RegExp(`^${ref.kind}[a-z]+${ref.i}$`);
      for (const k of Object.keys(a)) if (re.test(k)) set[k] = null;
    };

    // weapons, spells, inventory
    for (const [list, keyOf] of [['weapons', nameKey], ['spells', spellKey], ['items', nameKey]]) {
      const p = plan(src[list], snapL(list), T[list], keyOf);
      for (const [row, e] of p.update) {
        const w = rowFields(to, list, e, row.ref.i), wt = rowFields(to, list, row.e, row.ref.i);
        diffRow(legacy ? rowPrefix(row.ref) : k => slotKey(row.ref, k), w, wt);
      }
      for (const e of p.add) {
        if (legacy) newRow(list === 'weapons' ? 'attack' : list === 'items' ? 'inventory' : 'spell-' + (e.level || 'cantrip'), rowFields(to, list, e));
        else if (list === 'spells') {
          const sec = e.level ? 'spellbooklevel' + e.level : 'spellbookcantrip', id = rowId().toLowerCase();
          putRow(k => `repeating_${sec}_${id}_${k}`, rowFields(to, list, e)); orderOf(sec).push(id);
        } else {
          const kind = list === 'items' ? 'inventory' : e.ranged || /\d+\s*\/\s*\d+/.test(e.range || '') ? 'ranged' : 'melee';
          // a piece of armour Community keeps only in its armour slots doesn't also go in the bag
          if (list === 'items' && T.armor.some(x => nameKey(x.e) === nameKey(e)) && (src.armor || []).some(x => nameKey(x) === nameKey(e))) continue;
          const i = freeSlot(kind, kind === 'inventory' ? 40 : 6);
          if (i) putRow(k => slotKey({ kind, i }, k), rowFields(to, list, e, i));
        }
      }
      for (const row of p.remove) {
        if (list === 'items' && legacy && (src.armor || []).some(x => nameKey(x) === nameKey(row.e))) continue;   // still worn on Community
        if (row.ref.sec) dropRow(row.ref); else dropSlot(row.ref);
      }
    }

    // armour: Community's armour slots, Legacy's armour rows in the inventory
    {
      const p = plan(src.armor || [], snapL('armor'), T.armor, nameKey);
      if (legacy) {
        const invRow = name => {
          for (const [k, v] of Object.entries(set)) { const m = /^repeating_inventory_(-[^_]+)_itemname$/.exec(k); if (m && norm(v) === norm(name)) return { sec: 'inventory', id: m[1] }; }
          const r = T.items.find(x => nameKey(x.e) === norm(name) && set[`repeating_inventory_${x.ref.id}_itemname`] !== null);
          return r ? r.ref : null;
        };
        const armorRow = (ref, e) => {
          const mods = a[`repeating_inventory_${ref.id}_itemmodifiers`];
          set[`repeating_inventory_${ref.id}_itemmodifiers`] = armorMods(e, mods);
          set[`repeating_inventory_${ref.id}_equipped`] = e.worn ? '1' : '0';
        };
        for (const [row, e] of p.update) if (!same(row.e, e)) armorRow(row.ref, e);
        for (const e of p.add) {
          const ref = invRow(e.name);
          if (ref) armorRow(ref, e);
          else newRow('inventory', { itemname: e.name, itemcount: 1, itemweight: 0, itemmodifiers: armorMods(e), equipped: e.worn ? '1' : '0' });
        }
        // no longer in Community's armour slots: taken off (Legacy only works its AC out again for an item that still has an AC)
        for (const row of p.remove) { const k = `repeating_inventory_${row.ref.id}_equipped`; if (set[`repeating_inventory_${row.ref.id}_itemname`] !== null) set[k] = '0'; }
      } else {
        for (const [row, e] of p.update) diffRow(k => slotKey(row.ref, k), rowFields(to, 'armor', e, row.ref.i), rowFields(to, 'armor', row.e, row.ref.i));
        for (const e of p.add) { const i = freeSlot('armour', 10); if (i) putRow(k => slotKey({ kind: 'armour', i }, k), rowFields(to, 'armor', e, i)); }
        for (const row of p.remove) dropSlot(row.ref);
      }
    }

    // features: Legacy's list, Community's three blocks of text
    {
      const p = plan(src.features || [], snapL('features'), T.features, nameKey);
      if (legacy) {
        for (const [row, e] of p.update) diffRow(rowPrefix(row.ref), rowFields(to, 'features', e), rowFields(to, 'features', row.e));
        for (const e of p.add) newRow('traits', Object.assign(rowFields(to, 'features', e), { source_type: '' }));
        for (const row of p.remove) dropRow(row.ref);
      } else if (p.update.length || p.add.length || p.remove.length) {
        let list = T.features.map(x => x.e);
        for (const [row, e] of p.update) list = list.map(x => x === row.e ? e : x);
        list = list.filter(x => !p.remove.some(r => r.e === x)).concat(p.add);
        for (const s of ['class', 'race', 'feat']) {
          const before = featureText(T.features.map(x => x.e).filter(x => x.source === s)), after = featureText(list.filter(x => x.source === s));
          if (before !== after) set[FEAT_TEXT[s]] = after;
        }
      }
    }
    for (const [sec, ids] of Object.entries(order)) set['_reporder_repeating_' + sec] = ids.join(',');

    const after = Object.assign({}, a);
    for (const [k, v] of Object.entries(set)) { if (v === null) delete after[k]; else after[k] = v; }
    return { set, model: toModel(to, after) };
  }

  // A whole character onto a sheet (an import). `attrs` are the character's current ones: lists are only added where
  // the sheet has none yet.
  function fromModel(sheet, m, attrs) {
    attrs = attrs || {};
    const s = writeScalars(sheet, m, attrs, false), legacy = sheet === 'dnd5e_legacy';
    const put = (k, v) => { if (v != null && v !== '') s[k] = String(v); };
    if (legacy) {
      put('l1mancer_status', 'completed');
      if (m.weapons && m.weapons.length && !rows(attrs, 'attack').length) addRows(s, attrs, 'attack', m.weapons.map(w => closed(rowFields(sheet, 'weapons', w))));
      for (const lv of LEVELS) {
        const sec = 'spell-' + lv, list = (m.spells || []).filter(x => (lv === 'cantrip' ? 0 : lv) === x.level);
        if (!list.length || rows(attrs, sec).length) continue;
        addRows(s, attrs, sec, list.map(x => closed(rowFields(sheet, 'spells', x))));
      }
      if (m.items && m.items.length && !rows(attrs, 'inventory').length) addRows(s, attrs, 'inventory', m.items.map(i => closed(rowFields(sheet, 'items', i))));
      if (m.features && m.features.length && !rows(attrs, 'traits').length) addRows(s, attrs, 'traits', m.features.map(f => closed(Object.assign(rowFields(sheet, 'features', f), { source_type: '' }))));
    } else {
      const used = { melee: 0, ranged: 0 };
      for (const kind of ['melee', 'ranged']) for (let i = 1; i <= 6; i++) if (attrs[`${kind}weaponname${i}`]) used[kind] = i;
      for (const w of m.weapons || []) {
        const kind = w.ranged || /\d+\s*\/\s*\d+/.test(w.range || '') ? 'ranged' : 'melee';
        if ((w.name && Object.keys(attrs).some(k => k.startsWith(kind + 'weaponname') && attrs[k] === w.name)) || used[kind] >= 6) continue;
        const i = ++used[kind];
        for (const [k, v] of Object.entries(rowFields(sheet, 'weapons', Object.assign({}, w, { ranged: kind === 'ranged' })))) put(kind + k + i, v);
      }
      for (const lv of LEVELS) {
        const sec = lv === 'cantrip' ? 'spellbookcantrip' : 'spellbooklevel' + lv, list = (m.spells || []).filter(x => (lv === 'cantrip' ? 0 : lv) === x.level);
        if (!list.length || rows(attrs, sec).length) continue;
        addRows(s, attrs, sec, list.map(x => rowFields(sheet, 'spells', x)));
      }
      let slot = 0;
      for (let i = 1; i <= 40; i++) if (attrs['inventoryname' + i]) slot = i;
      if (!slot) for (const it of (m.items || []).slice(0, 40)) { slot++; for (const [k, v] of Object.entries(rowFields(sheet, 'items', it))) put(k + slot, v); }
      const feats = (m.features || []).map(f => Object.assign({}, f, { source: f.source === 'race' ? 'race' : f.source === 'class' ? 'class' : 'feat' }));
      for (const src of ['class', 'race', 'feat']) if (!attrs[FEAT_TEXT[src]] && feats.some(f => f.source === src)) put(FEAT_TEXT[src], featureText(feats.filter(f => f.source === src)));
    }
    return s;
  }

  // One item card going into a character's inventory: a patch of attributes. A row of the same name gets one more;
  // a weapon also gets an attack (Legacy) or a weapon slot (Community) so it can be rolled.
  // it: { name, qty, weight, text, weapon: { damage, dtype, range, ranged, finesse, magic } }
  function addItem(sheet, attrs, it) {
    attrs = attrs || {};
    const s = {}, legacy = sheet === 'dnd5e_legacy', qty = Math.max(1, +it.qty || 1);
    const put = (k, v) => { if (v != null && v !== '') s[k] = String(v); };
    const w = it.weapon, ability = w ? (w.ranged ? 'dex' : w.finesse ? 'dex' : 'str') : null;
    if (legacy) {
      const same = rowsById(attrs, 'inventory').find(([, r]) => (r.itemname || '').toLowerCase() === it.name.toLowerCase());
      if (same) put(`repeating_inventory_${same[0]}_itemcount`, (+same[1].itemcount || 1) + qty);
      else addRows(s, attrs, 'inventory', [{ 'options-flag': '0', itemname: it.name, itemcount: qty, itemweight: it.weight || 0, itemcontent: it.text || '', equipped: '1' }]);
      if (w && !rows(attrs, 'attack').some(r => (r.atkname || '').toLowerCase() === it.name.toLowerCase()))
        addRows(s, attrs, 'attack', [{ 'options-flag': '0', atkname: it.name, atkflag: '{{attack=1}}', atkattr_base: `@{${ABF[ability]}_mod}`, atkmagic: w.magic || '',
          dmgflag: '{{damage=1}} {{dmg1flag=1}}', dmgbase: w.damage, dmgcustcrit: w.damage, dmgattr: `@{${ABF[ability]}_mod}`, dmgtype: w.dtype, atkrange: w.range || '', atkprofflag: '(@{pb})' }]);
    } else {
      let slot = 0, free = 0;
      for (let i = 1; i <= 40; i++) {
        const n = attrs['inventoryname' + i];
        if (n && n.toLowerCase() === it.name.toLowerCase()) { slot = i; break; }
        if (!n && !free) free = i;
      }
      if (slot) put('inventoryqty' + slot, (+attrs['inventoryqty' + slot] || 1) + qty);
      else if (free) { put('inventoryname' + free, it.name); put('inventoryqty' + free, qty); put('inventoryweight' + free, it.weight || 0); put('inventorydescription' + free, it.text || ''); }
      if (w) {
        const kind = w.ranged ? 'ranged' : 'melee';
        let i = 0, have = false;
        for (let k = 1; k <= 6; k++) { const n = attrs[`${kind}weaponname${k}`]; if (n && n.toLowerCase() === it.name.toLowerCase()) have = true; if (!n && !i) i = k; }
        if (!have && i) {
          put(`${kind}weaponname${i}`, it.name); put(`${kind}attackstat${i}`, `@{${ABF[ability]}_mod}`);
          put(`${kind}magic${i}`, w.magic || 0); put(`${kind}dmg${i}`, w.damage || '0'); put(`${kind}dmgtype${i}`, w.dtype);
          put(`${kind}critdmg${i}`, w.damage || ''); put(`${kind}weaponcritrange${i}`, 20);   // (a crit rolls the same dice again)
        }
      }
    }
    return s;
  }

  // A spell from the compendium onto the sheet's spell list (at its level). Nothing happens if it's there already.
  // sp: { name, level, school, time, range, components, material, duration, concentration, ritual, text, higher, attack, save, damage, dice, heal }
  const SAVE_NAMES = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
  function addSpell(sheet, attrs, sp) {
    attrs = attrs || {};
    const s = {}, lvl = Math.max(0, Math.min(9, +sp.level || 0)), legacy = sheet === 'dnd5e_legacy';
    const comps = String(sp.components || '').toUpperCase().split(/[,\s]+/);
    const save = SAVE_NAMES[String(sp.save || '').slice(0, 3).toUpperCase()] || '';
    const text = String(sp.text || '').replace(/\*\*|__/g, '');
    if (legacy) {
      const sec = 'spell-' + (lvl ? lvl : 'cantrip');
      if (rows(attrs, sec).some(r => (r.spellname || '').toLowerCase() === sp.name.toLowerCase())) return s;
      const dice = /^\s*\d+d\d+/.exec(sp.dice || '');
      const attack = sp.attack === 'melee' ? 'Melee' : sp.attack === 'ranged' ? 'Ranged' : 'None';
      const out = attack !== 'None' || (save && dice);
      addRows(s, attrs, sec, [{ spellname: sp.name, spellschool: sp.school, spelllevel: lvl ? String(lvl) : 'cantrip', spellcastingtime: sp.time, spellrange: sp.range,
        spellcomp_v: comps.includes('V') ? '{{v=1}}' : '0', spellcomp_s: comps.includes('S') ? '{{s=1}}' : '0', spellcomp_m: comps.includes('M') ? '{{m=1}}' : '0',
        spellcomp_materials: sp.material || '', spellconcentration: sp.concentration ? '{{concentration=1}}' : '0', spellritual: sp.ritual ? '{{ritual=1}}' : '0',
        spellduration: sp.duration, spelldescription: text, spellathigherlevels: String(sp.higher || '').replace(/\*\*|__/g, ''),
        spelloutput: out ? 'ATTACK' : 'SPELLCARD', spellattack: out ? attack : null, spelldamage: out && dice ? dice[0] : null, spelldamagetype: out && sp.damage ? sp.damage : null,
        spellsave: out && save ? save : null, spellsavesuccess: out && save && dice ? 'Half damage' : null, 'options-flag': '0' }]);
    } else {
      const sec = 'spellbook' + (lvl ? 'level' + lvl : 'cantrip');
      if (rows(attrs, sec).some(r => (r.spellname || '').toLowerCase() === sp.name.toLowerCase())) return s;
      const SCH = sp.school ? sp.school[0].toUpperCase() + sp.school.slice(1) : '';
      const dice = /^\s*\d+d\d+/.exec(sp.dice || '');
      addRows(s, attrs, sec, [{ spellname: sp.name, spellschool: SCH, spellbaselevel: String(lvl), spellfriendlylevel: lvl ? 'Level ' + lvl : 'Cantrip',
        spellcasttime: sp.time, spellrange: sp.range, spellduration: sp.duration, spellcomponents: [sp.components, sp.material ? `(${sp.material})` : ''].filter(Boolean).join(' '),
        spellconcentration: sp.concentration ? '(Concentration)' : '', spellritual: sp.ritual ? '(Ritual)' : '', spelldescription: text,
        spellhighersloteffect: String(sp.higher || '').replace(/\*\*|__/g, ''),
        spellshowinfoblock: '{{spellshowinfoblock=1}}', spellshowdesc: '{{spellshowdesc=1}} {{spelldescription=@{spelldescription}}}',
        spellshowhigherlvl: sp.higher ? '{{spellshowhigherlvl=1}} {{spellhigherlevel=@{spellhighersloteffect}}}' : null,
        damage: dice ? dice[0] : null, damagetype: dice && sp.damage ? sp.damage : null,
        spellshowdamage: dice && sp.damage ? '{{spellshowdamage=1}} {{spelldamage=[[@{damage} + @{damagestatbonus} + @{damagemiscbonus} + (@{global_spell_damage_bonus}) + 0d0]] @{damagetype}}} @{spellcancrit}' : null,
        savestat: save ? save.slice(0, 3).toUpperCase() : null, savesuccess: save && dice ? 'Half damage' : null,
        spellshowsavethrow: save ? '{{spellshowsavethrow=1}} {{spellsavedc=[[@{spellsavedc} + @{customsavedc}]]}} {{spellsavestat=@{savestat}}} {{spellsavesuccess=@{savesuccess}}}' : null }]);
    }
    return s;
  }

  const api = { toModel, fromModel, sync, addItem, addSpell, SKILLS, CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sheet5e = api;
})(this);
