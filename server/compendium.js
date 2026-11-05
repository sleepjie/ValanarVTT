/* The spell compendium: the SRD spells ship with the table (table/data/spells-srd.json); the GM brings in more
 * (other books, homebrew) and they're kept here, on this server only, in vtt-data/compendium/spells.json.
 *
 *   GET    /api/compendium/spells                 the spells brought in (everyone logged in)
 *   POST   /api/compendium/spells/import          GM: a file's text or { url } → spells added or replaced (same name and book)
 *   PUT    /api/compendium/spells                 GM: one spell, new or changed (homebrew)
 *   DELETE /api/compendium/spells?source=XGE      GM: every spell from that book · ?id=… one spell
 *
 * Import understands three shapes: 5etools spell files ({ "spell": [...] }), the 5e-bits API / 5e-database
 * (an array of spells, or one), and this table's own export ({ spells: [...] }). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function compendium(S) {
  const { DATA, isGM, sendJSON, bodyJSON, readBody, str, num, now, log, readJSON, writeJSON } = S;
  const DIR = path.join(DATA, 'compendium');
  fs.mkdirSync(DIR, { recursive: true });
  const FILE = path.join(DIR, 'spells.json');
  let spells = readJSON(FILE, { spells: [] }).spells || [];
  const save = () => writeJSON(FILE, { spells });

  // ───────── a spell, cleaned ─────────
  const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
  function clean(p) {
    p = p && typeof p === 'object' ? p : {};
    const school = String(p.school || '').toLowerCase();
    const sp = {
      id: /^[a-z0-9:_-]{1,80}$/i.test(p.id || '') ? p.id : 'sp-' + crypto.randomBytes(5).toString('hex'),
      name: str(p.name, 120) || 'Spell', level: Math.round(num(p.level, 0, 0, 9)), school: SCHOOLS.includes(school) ? school : 'evocation',
      time: str(p.time, 200), range: str(p.range, 120), components: str(p.components, 40), duration: str(p.duration, 120),
      source: str(p.source, 40) || 'Homebrew', classes: Array.isArray(p.classes) ? p.classes.slice(0, 20).map(c => str(c, 40)).filter(Boolean) : [],
      text: str(p.text, 40000)
    };
    for (const k of ['material', 'higher', 'attack', 'save', 'damage', 'dice', 'heal', 'area', 'gi', 'page']) if (p[k]) sp[k] = str(p[k], k === 'higher' ? 8000 : 400);
    if (p.concentration) sp.concentration = true;
    if (p.ritual) sp.ritual = true;
    return sp;
  }

  // ───────── 5etools ─────────
  const SCH = { A: 'abjuration', C: 'conjuration', D: 'divination', E: 'enchantment', V: 'evocation', I: 'illusion', N: 'necromancy', T: 'transmutation' };
  // {@tag text|more|display} → the words a reader should see
  function tags(s) {
    let prev;
    s = String(s);
    do {
      prev = s;
      s = s.replace(/\{@(\w+)\s*([^{}]*?)\}/g, (all, tag, body) => {
        const parts = body.split('|');
        switch (tag) {
          case 'b': case 'bold': return `**${parts[0]}**`;
          case 'i': case 'italic': return `*${parts[0]}*`;
          case 'scaledamage': case 'scaledice': return parts[2] || parts[0];
          case 'dc': return 'DC ' + parts[0];
          case 'hit': return (+parts[0] >= 0 ? '+' : '') + parts[0];
          case 'chance': return parts[0] + ' percent';
          case 'atk': return { ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:' }[parts[0]] || 'Attack:';
          case 'h': return 'Hit: ';
          case 'note': return parts[0];
          case 'filter': return parts[0];
          default: return parts.length >= 3 && parts[2] ? parts[2] : parts[0];
        }
      });
    } while (s !== prev);
    return s;
  }
  function entries(list, depth) {
    const out = [];
    for (const e of list || []) {
      if (typeof e === 'string') { out.push(tags(e)); continue; }
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'list') out.push((e.items || []).map(x => '- ' + (typeof x === 'string' ? tags(x) : (x.name ? `**${tags(x.name)}.** ` : '') + entries(x.entries || (x.entry ? [x.entry] : []), depth + 1).replace(/\n\n/g, ' '))).join('\n'));
      else if (e.type === 'table') {
        const cell = c => typeof c === 'string' ? tags(c) : c && c.roll ? (c.roll.exact != null ? c.roll.exact : `${c.roll.min}–${c.roll.max}`) : c && c.entry ? tags(c.entry) : '';
        const rows = [e.colLabels || []].concat(e.rows || []);
        const md = rows.map((r, i) => '| ' + r.map(x => cell(x).replace(/\|/g, '/')).join(' | ') + ' |' + (i === 0 ? '\n|' + r.map(() => ' --- |').join('') : '')).join('\n');
        out.push((e.caption ? `**${tags(e.caption)}**\n\n` : '') + md);
      } else if (e.entries) out.push((e.name ? `**${tags(e.name)}.** ` : '') + entries(e.entries, (depth || 0) + 1));
      else if (e.entry) out.push(tags(e.entry));
    }
    return out.join('\n\n');
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function time5(t) {
    return (t || []).map(x => {
      const u = { action: 'action', bonus: 'bonus action', reaction: 'reaction', minute: 'minute', hour: 'hour', round: 'round' }[x.unit] || x.unit;
      return `${x.number || 1} ${u}${x.number > 1 ? 's' : ''}${x.condition ? ', ' + tags(x.condition) : ''}`;
    }).join(' or ');
  }
  function range5(r) {
    if (!r) return '';
    const d = r.distance || {};
    const dist = d.type === 'self' ? 'Self' : d.type === 'touch' ? 'Touch' : d.type === 'sight' ? 'Sight' : d.type === 'unlimited' ? 'Unlimited'
      : d.type ? `${d.amount} ${d.amount === 1 ? d.type.replace(/s$/, '') : d.type}` : '';
    if (r.type === 'special') return 'Special';
    if (r.type === 'point') return dist;
    // an area from the caster: "Self (30-foot cone)"
    return `Self (${d.amount}-${(d.type || 'feet').replace(/feet/, 'foot').replace(/miles/, 'mile')} ${r.type === 'radius' ? 'radius' : r.type})`;
  }
  function comps5(c) {
    if (!c) return { components: '' };
    const l = []; if (c.v) l.push('V'); if (c.s) l.push('S'); if (c.m) l.push('M'); if (c.r) l.push('R');
    const m = c.m && typeof c.m === 'object' ? c.m.text : typeof c.m === 'string' ? c.m : '';
    return { components: l.join(', '), material: m ? tags(m) : '' };
  }
  function duration5(ds) {
    let conc = false;
    const s = (ds || []).map(d => {
      if (d.type === 'instant') return 'Instantaneous';
      if (d.type === 'permanent') return d.ends && d.ends.length ? 'Until ' + d.ends.map(e => ({ dispel: 'dispelled', trigger: 'triggered' })[e] || e).join(' or ') : 'Permanent';
      if (d.type === 'special') return 'Special';
      if (d.type === 'timed') {
        if (d.concentration) conc = true;
        const t = d.duration || {};
        return (d.concentration ? 'Concentration, up to ' : d.duration && d.duration.upTo ? 'Up to ' : '') + plural(t.amount || 1, t.type || 'minute');
      }
      return '';
    }).filter(Boolean).join(' or ');
    return { duration: s, concentration: conc };
  }
  function from5etools(s, classLookup) {
    const c = comps5(s.components), d = duration5(s.duration);
    const classes = s.classes && s.classes.fromClassList ? s.classes.fromClassList.map(x => x.name)
      : classLookup && classLookup[(s.source || '').toLowerCase()] && classLookup[(s.source || '').toLowerCase()][s.name.toLowerCase()] || [];
    const higher = s.entriesHigherLevel ? entries(s.entriesHigherLevel.map(e => e && e.entries ? Object.assign({}, e, { name: null }) : e), 0) : '';
    return clean({
      id: '5et:' + (s.source || 'x').toLowerCase() + ':' + s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: s.name, level: s.level, school: SCH[s.school] || s.school, time: time5(s.time), range: range5(s.range),
      components: c.components, material: c.material, duration: d.duration, concentration: d.concentration, ritual: !!(s.meta && s.meta.ritual),
      source: s.source || '', page: s.page ? String(s.page) : '', classes: [...new Set(classes)], text: entries(s.entries, 0), higher,
      damage: (s.damageInflict || [])[0] || '', save: (s.savingThrow || [])[0] ? s.savingThrow[0].slice(0, 3).toUpperCase() : '',
      attack: (s.spellAttack || [])[0] === 'M' ? 'melee' : (s.spellAttack || [])[0] === 'R' ? 'ranged' : ''
    });
  }
  // ───────── 5e-bits / 5e-database ─────────
  function from5ebits(s) {
    const dmg = Array.isArray(s.damage) ? s.damage[0] || {} : s.damage || {};
    const lv = dmg.damage_at_slot_level || dmg.damage_at_character_level || {};
    return clean({
      id: 'srd:' + (s.index || s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')), name: s.name, level: s.level, school: s.school && (s.school.name || s.school),
      time: s.casting_time, range: s.range, components: (s.components || []).join(', '), material: s.material, duration: s.duration,
      concentration: s.concentration, ritual: s.ritual, source: 'SRD', classes: (s.classes || []).map(c => c.name || c),
      text: (s.desc || []).join('\n\n'), higher: (s.higher_level || []).join('\n\n'), attack: s.attack_type,
      save: s.dc && s.dc.dc_type ? s.dc.dc_type.name : '', damage: dmg.damage_type ? dmg.damage_type.name.toLowerCase() : '',
      dice: Object.keys(lv).length ? lv[Object.keys(lv).sort((a, b) => a - b)[0]] : ''
    });
  }
  function parse(j) {
    if (!j) return [];
    if (Array.isArray(j.spell)) {
      // 5etools keeps which classes have a spell in a separate file; bring that file in too and it's used
      return j.spell.filter(s => s && s.name && !s._copy).map(s => from5etools(s, classLookup));
    }
    if (Array.isArray(j.spells)) return j.spells.map(clean);
    if (Array.isArray(j)) return j.filter(s => s && s.name).map(s => s.desc || s.casting_time ? from5ebits(s) : clean(s));
    if (j.name && (j.desc || j.casting_time)) return [from5ebits(j)];
    // 5etools' class lists for spells: { "PHB": { "Fireball": { "class": { "PHB": { "Wizard": true } } } } }
    if (Object.values(j).some(v => v && typeof v === 'object' && Object.values(v).some(x => x && (x.class || x.classVariant)))) {
      classLookup = {};
      for (const [src, byName] of Object.entries(j)) for (const [name, info] of Object.entries(byName || {})) {
        const list = [];
        for (const k of ['class', 'classVariant']) for (const book of Object.values((info || {})[k] || {})) list.push(...Object.keys(book || {}));
        (classLookup[src.toLowerCase()] = classLookup[src.toLowerCase()] || {})[name.toLowerCase()] = [...new Set(list)];
      }
      writeJSON(path.join(DIR, 'spell-classes.json'), classLookup);
      // classes for spells already brought in
      for (const sp of spells) { const l = classLookup[(sp.source || '').toLowerCase()]; if (l && l[sp.name.toLowerCase()] && !sp.classes.length) sp.classes = l[sp.name.toLowerCase()]; }
      save();
      return { classesOnly: true };
    }
    throw new Error('That isn’t a spell list this can read (5etools, 5e-database or this table’s own export)');
  }
  let classLookup = readJSON(path.join(DIR, 'spell-classes.json'), null);

  function merge(list) {
    let added = 0, replaced = 0;
    for (const sp of list) {
      const i = spells.findIndex(x => x.id === sp.id || (x.name.toLowerCase() === sp.name.toLowerCase() && (x.source || '') === (sp.source || '')));
      if (i >= 0) { spells[i] = Object.assign(sp, { id: spells[i].id }); replaced++; } else { spells.push(sp); added++; }
    }
    save();
    return { added, replaced };
  }

  async function handle(req, res, user, p) {
    if (!p.startsWith('/api/compendium/')) return false;
    if (!user) return sendJSON(res, 401, { error: 'Log in first' }), true;
    const m = req.method, gm = isGM(user);
    const deny = () => sendJSON(res, 403, { error: 'Only the GM can do that' });
    try {
      if (p === '/api/compendium/spells' && m === 'GET') return sendJSON(res, 200, { spells }), true;
      if (p === '/api/compendium/spells/import' && m === 'POST') {
        if (!gm) return deny(), true;
        const raw = await readBody(req, 40e6);
        let text = raw.toString('utf8').replace(/^﻿/, '');
        let j;
        try { j = JSON.parse(text); } catch (e) { throw new Error('That file isn’t JSON'); }
        if (j && typeof j.url === 'string' && Object.keys(j).length === 1) {   // a link: fetch it from here
          if (!/^https?:\/\//i.test(j.url)) throw new Error('That isn’t a web address');
          const r = await fetch(j.url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (table spell import)' } });
          if (!r.ok) throw new Error(`The link answered ${r.status} ${r.statusText}`);
          try { j = JSON.parse((await r.text()).replace(/^﻿/, '')); } catch (e) { throw new Error('The link didn’t give back JSON'); }
        }
        const got = parse(j);
        if (got.classesOnly) return sendJSON(res, 200, { classes: true, total: spells.length }), true;
        if (!got.length) throw new Error('No spells in that file');
        const r = merge(got);
        log(`Spells: ${r.added} added, ${r.replaced} replaced (by ${user.name})`);
        return sendJSON(res, 200, Object.assign(r, { total: spells.length, sources: [...new Set(got.map(s => s.source))] })), true;
      }
      if (p === '/api/compendium/spells' && m === 'PUT') {
        if (!gm) return deny(), true;
        const sp = clean((await bodyJSON(req, 2e6)).spell);
        const i = spells.findIndex(x => x.id === sp.id);
        if (i >= 0) spells[i] = sp; else spells.push(sp);
        save();
        return sendJSON(res, 200, { spell: sp }), true;
      }
      if (p === '/api/compendium/spells' && m === 'DELETE') {
        if (!gm) return deny(), true;
        const q = new URL(req.url, 'http://x').searchParams;
        const before = spells.length;
        if (q.get('id')) spells = spells.filter(x => x.id !== q.get('id'));
        else if (q.get('source')) spells = spells.filter(x => (x.source || '') !== q.get('source'));
        else throw new Error('Which spells?');
        save();
        return sendJSON(res, 200, { removed: before - spells.length, total: spells.length }), true;
      }
      return sendJSON(res, 404, { error: 'Not found' }), true;
    } catch (e) {
      return sendJSON(res, 400, { error: e.message }), true;
    }
  }
  return { handle, parse, spells: () => spells };
};
