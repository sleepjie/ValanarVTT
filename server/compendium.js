/* The spell compendium: the SRD spells ship with the table (table/data/spells-srd.json); the GM brings in more
 * (other books, homebrew) and they're kept here, on this server only, in vtt-data/compendium/spells.json.
 *
 *   GET    /api/compendium/spells                 the spells brought in (everyone logged in)
 *   POST   /api/compendium/spells/import          GM: a file's text or { url } → spells added or replaced (same name and book)
 *   PUT    /api/compendium/spells                 GM: one spell, new or changed (homebrew)
 *   DELETE /api/compendium/spells?source=XGE      GM: every spell from that book · ?id=… one spell
 *
 * Import understands three shapes: 5etools spell files ({ "spell": [...] }), the 5e-bits API / 5e-database
 * (an array of spells, or one), and this table's own export ({ spells: [...] }).
 *
 * Item cards and features (class and subclass features, racial traits, feats, invocations and other options) from
 * other books are kept the same way, in vtt-data/compendium/items.json and features.json, for every campaign:
 *   GET    /api/compendium/items · /api/compendium/features      what's been brought in (everyone logged in)
 *   POST   /api/compendium/import                 GM: any 5etools file (spells, items, a class, races, feats,
 *                                                 optional features) or { url }; says what it brought in
 *   DELETE /api/compendium/items?source=XGE · /api/compendium/features?source=TCE   GM: a book's worth
 * The files themselves are the GM's own: none of it ships with the table. */
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
  const IFILE = path.join(DIR, 'items.json'), FFILE = path.join(DIR, 'features.json');
  let items = readJSON(IFILE, { items: [] }).items || [];
  let features = readJSON(FFILE, { features: [] }).features || [];
  const saveItems = () => writeJSON(IFILE, { items });
  const saveFeatures = () => writeJSON(FFILE, { features });
  // monsters: stat blocks, in this table's own format (made from the GM's own books); the Bestiary tab shows them
  const MFILE = path.join(DIR, 'monsters.json');
  let monsters = readJSON(MFILE, { monsters: [] }).monsters || [];
  const saveMonsters = () => writeJSON(MFILE, { monsters });

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
  // ───────── 5etools items → cards ─────────
  const code = v => String(v == null ? '' : typeof v === 'object' ? v.uid || v.name || '' : v).split('|')[0].toUpperCase();
  const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const DMG = { S: 'slashing', P: 'piercing', B: 'bludgeoning', A: 'acid', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', I: 'poison', Y: 'psychic', R: 'radiant', T: 'thunder' };
  const TYPE = { M: 'Melee Weapon', R: 'Ranged Weapon', A: 'Ammunition', AF: 'Ammunition', LA: 'Light Armor', MA: 'Medium Armor', HA: 'Heavy Armor', S: 'Shield',
    G: 'Adventuring Gear', AT: "Artisan's Tools", GS: 'Gaming Set', INS: 'Musical Instrument', T: 'Tools', MNT: 'Mount', VEH: 'Vehicle (land)', SHP: 'Vehicle (water)', AIR: 'Vehicle (air)', SPC: 'Vehicle (space)',
    TAH: 'Tack and Harness', P: 'Potion', SC: 'Scroll', RD: 'Rod', RG: 'Ring', WD: 'Wand', ST: 'Staff', FD: 'Food and Drink', TG: 'Trade Good', $: 'Treasure', $A: 'Art Object', $G: 'Gemstone', $C: 'Coins', EXP: 'Explosive', OTH: 'Other' };
  const KIND = t => /^(M|R)$/.test(t) ? 'weapon' : /^(LA|MA|HA|S)$/.test(t) ? 'armor' : /^(AT|GS|INS|T)$/.test(t) ? 'tool' : /^(MNT|VEH|SHP|AIR|SPC|TAH)$/.test(t) ? 'mount'
    : /^(\$|\$A|\$G|\$C|TG)$/.test(t) ? 'treasure' : /^(G|A|AF|FD|EXP|SC|P)$/.test(t) ? 'gear' : 'other';
  const PROP = { A: 'Ammunition', AF: 'Ammunition', F: 'Finesse', H: 'Heavy', L: 'Light', LD: 'Loading', R: 'Reach', S: 'Special', T: 'Thrown', '2H': 'Two-handed', V: 'Versatile', RLD: 'Reload', BF: 'Burst fire' };
  function money(cp) {
    cp = Math.round(+cp || 0); if (!cp) return '';
    return cp % 100 === 0 ? `${(cp / 100).toLocaleString('en-GB')} gp` : cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`;
  }
  function rarity5(r) {
    r = String(r || 'none').toLowerCase();
    if (r === 'none' || r === 'mundane') return 'mundane';
    if (r.startsWith('unknown') || r === 'varies') return 'varies';
    return ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'].includes(r) ? r : 'varies';
  }
  // one of the table's drawn pictures (itemart.js), by what the thing is called, then by its type
  const ICON_WORDS = [[/ring mail|chain mail|chain shirt|scale mail|splint|half plate|plate armor|breastplate|studded|padded|leather armor|hide armor/, 'armor'], [/crossbow/, 'crossbow'], [/\bbow\b|longbow|shortbow/, 'bow'], [/dagger|knife|sickle/, 'dagger'], [/axe\b|axe,|halberd|glaive/, 'axe'], [/hammer|maul/, 'hammer'],
    [/mace|morningstar|flail|club/, 'mace'], [/spear|pike|trident|lance|javelin/, 'spear'], [/whip/, 'whip'], [/sling\b/, 'sling'], [/arrow|bolt|needle|bullet/, 'arrow'],
    [/sword|scimitar|rapier|blade|saber|sabre/, 'sword'], [/shield/, 'shield'], [/helm|hat\b|circlet|crown|headband|diadem/, 'helm'], [/potion|elixir|philter|oil of|flask|vial/, 'potion'],
    [/scroll/, 'scroll'], [/\bring\b|ring of/, 'ring'], [/amulet|necklace|periapt|medallion|pendant|brooch|talisman|scarab/, 'amulet'], [/cloak|cape|mantle|robe|coat/, 'cloak'],
    [/boots|slippers|shoes/, 'boots'], [/gloves|gauntlets|bracers/, 'gloves'], [/belt|girdle/, 'belt'], [/\bbag\b|pouch|sack|haversack/, 'bag'], [/backpack|pack\b/, 'pack'],
    [/chest|coffer|\bbox\b|casket/, 'chest'], [/book|tome|manual|grimoire|libram|spellbook/, 'book'], [/orb|crystal ball|sphere/, 'orb'], [/lantern|lamp|candle/, 'lantern'], [/torch/, 'torch'],
    [/rope/, 'rope'], [/chain\b/, 'chain'], [/horn|drum|flute|lute|lyre|harp|pipes|fiddle|instrument|bagpipes|viol/, 'instrument'], [/carpet|rug/, 'carpet'], [/mirror/, 'mirror'],
    [/tent/, 'tent'], [/figurine|statuette/, 'figurine'], [/goggles|lenses|eyes of|spectacles/, 'goggles'], [/deck|cards/, 'cards'], [/ship|boat|galley|keelboat|longship/, 'ship'],
    [/wagon|cart|carriage|chariot|sled/, 'cart'], [/saddle|barding|bit and bridle/, 'saddle'], [/horse|pony|mule|camel|mastiff|elephant/, 'horse'], [/ration|bread|wine|ale|meal|food/, 'food'],
    [/staff/, 'staff'], [/wand/, 'wand'], [/\brod\b|rod of|sceptre|scepter/, 'rod'], [/gem|diamond|ruby|sapphire|emerald|pearl|stone/, 'gem'], [/armor|armour|mail|plate|breastplate/, 'armor']];
  function iconFor(name, t) {
    const n = String(name).toLowerCase();
    for (const [re, k] of ICON_WORDS) if (re.test(n)) return k;
    return { M: 'sword', R: 'bow', A: 'arrow', AF: 'arrow', LA: 'armor', MA: 'armor', HA: 'armor', S: 'shield', P: 'potion', SC: 'scroll', RG: 'ring', WD: 'wand', ST: 'staff', RD: 'rod',
      AT: 'tool', T: 'tool', GS: 'cards', INS: 'instrument', MNT: 'horse', VEH: 'cart', SHP: 'ship', TAH: 'saddle', FD: 'food', $: 'coin', $C: 'coin', $G: 'gem', $A: 'gem', TG: 'coin' }[t] || 'bag';
  }
  function item5(it) {
    const t = code(it.type), r = rarity5(it.rarity), cat = it.weaponCategory ? it.weaponCategory[0].toUpperCase() + it.weaponCategory.slice(1) : '';
    let typeLine = it.wondrous ? 'Wondrous item' : t === 'M' || t === 'R' ? `${cat} ${TYPE[t]}`.trim() : TYPE[t] || (it.staff ? 'Staff' : it.poison ? 'Poison' : it.tattoo ? 'Tattoo' : 'Item');
    const base = it.baseItem ? String(it.baseItem).split('|')[0].toLowerCase() : '';
    if (r !== 'mundane' && (t === 'M' || t === 'R' || t === 'A' || t === 'AF')) typeLine = `Weapon (${base || it.anyOf || (t === 'A' || t === 'AF' ? 'any ammunition' : 'any')})`;
    else if (r !== 'mundane' && /^(LA|MA|HA|S)$/.test(t)) typeLine = `Armor (${t === 'S' ? 'shield' : base || it.anyOf || 'any'})`;
    else if (base && (t === 'M' || t === 'R' || /^(LA|MA|HA|S)$/.test(t))) typeLine += ` (${base.replace(/\b\w/g, c => c.toUpperCase())})`;
    const props = (it.property || []).map(p => {
      const c = code(p), n = PROP[c]; if (!n) return '';
      if ((c === 'A' || c === 'T') && it.range) return `${n} (${String(it.range).replace('/', '/')} ft)`;
      if (c === 'V' && it.dmg2) return `Versatile (${it.dmg2})`;
      return n;
    }).filter(Boolean);
    const text = [entries(it.entries || [], 0), entries(it.additionalEntries || [], 0)].filter(Boolean).join('\n\n');
    const card = {
      id: '5et:' + slugOf(it.source || 'x') + ':' + slugOf(it.name), name: it.name, kind: r !== 'mundane' ? 'magic' : KIND(t), type: typeLine, rarity: r,
      cost: money(it.value), source: it.source || '', text
    };
    if (it.weight) card.weight = +it.weight;
    if (it.reqAttune) card.attune = it.reqAttune === true ? true : 'requires attunement ' + tags(String(it.reqAttune));
    if (props.length) card.props = props;
    if (it.ac != null) card.ac = /^(LA)$/.test(t) ? `${it.ac} + Dex` : t === 'MA' ? `${it.ac} + Dex (max 2)` : t === 'S' ? `+${it.ac}` : String(it.ac);
    if (it.dmg1 || (r === 'mundane' && (t === 'M' || t === 'R'))) {
      const bonus = parseInt(it.bonusWeapon || '0', 10) || 0;
      card.weapon = { damage: it.dmg1 || '', dtype: DMG[code(it.dmgType)] || '', range: it.range ? `${it.range} ft` : '', ranged: t === 'R', finesse: (it.property || []).some(p => code(p) === 'F'), magic: bonus };
    }
    card.icon = iconFor(it.name + ' ' + (it.baseItem || ''), t);
    return card;
  }
  // a generic magic variant ("+1 Weapon", "Armor of Resistance"): one card for the lot
  function variant5(v) {
    const inh = v.inherits || {};
    const req = v.requires || [], has = k => req.some(x => x && x[k]), types = req.map(x => x && x.type).filter(Boolean);
    const armour = has('armor') || types.some(x => /^(LA|MA|HA|S)$/.test(code(x)));
    const anyOf = req.map(x => x && (x.name || x.sword && 'sword' || x.axe && 'axe' || x.bow && 'bow' || x.crossbow && 'crossbow')).filter(Boolean).join(' or ').toLowerCase();
    const t = types.length === 1 ? code(types[0]) : armour ? 'MA' : has('weapon') || has('sword') || has('axe') ? 'M' : code(v.type || inh.type);
    return item5(Object.assign({}, inh, { name: v.name, type: t, anyOf: anyOf ? 'any ' + anyOf : '', entries: inh.entries || v.entries, source: inh.source || v.source, rarity: inh.rarity, reqAttune: inh.reqAttune, wondrous: false }));
  }

  // ───────── 5etools features → cards ─────────
  const ABIL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  function prereq5(pr) {
    const out = [];
    for (const p of pr || []) {
      if (p.level) out.push(typeof p.level === 'object' ? `${p.level.class ? p.level.class.name + ' ' : 'Level '}${p.level.level}` : `Level ${p.level}`);
      for (const a of p.ability || []) out.push(Object.entries(a).map(([k, v]) => `${ABIL[k] || k.toUpperCase()} ${v}`).join(' or '));
      if (p.race) out.push(p.race.map(r => ((r.subrace ? r.subrace + ' ' : '') + r.name).replace(/\b\w/g, c => c.toUpperCase())).join(' or '));
      if (p.spellcasting || p.spellcasting2020) out.push('The ability to cast at least one spell');
      if (p.proficiency) out.push(p.proficiency.map(x => Object.entries(x).map(([k, v]) => `${v === true ? '' : v + ' '}${k} proficiency`).join(', ')).join(' or '));
      if (p.pact) out.push('Pact of the ' + p.pact);
      if (p.patron) out.push(p.patron + ' patron');
      if (p.spell) out.push(p.spell.map(x => tags(String(x).replace(/#c$/, ''))).join(' or '));
      if (p.feature) out.push(p.feature.join(' or '));
      if (p.other) out.push(p.other);
    }
    return out.filter(Boolean).join('; ');
  }
  // what a kind of optional feature is, and whose: invocations are the warlock's, and so on
  // [class, group, the level the class first gets them]
  const OPT = { EI: ['Warlock', 'Eldritch Invocations', 2], PB: ['Warlock', 'Pact Boon', 3], MM: ['Sorcerer', 'Metamagic', 3], 'MV:B': ['Fighter', 'Maneuvers', 3], AS: ['Fighter', 'Arcane Shot Options', 3],
    'FS:F': ['Fighter', 'Fighting Style', 1], 'FS:R': ['Ranger', 'Fighting Style', 2], 'FS:P': ['Paladin', 'Fighting Style', 2], 'FS:B': ['Bard', 'Fighting Style', 3], AI: ['Artificer', 'Artificer Infusions', 2],
    ED: ['Monk', 'Elemental Disciplines', 3], RN: ['Fighter', 'Runes', 3], OR: ['', 'Onomancy Resonants'], AF: ['', 'Alchemical Formulae'] };
  const SKIP_TRAITS = /^(age|alignment|size|languages?|creature type)$/i;
  function features5(j) {
    const out = [];
    const subName = {};
    for (const sc of j.subclass || []) if (sc && sc.shortName) subName[`${sc.className}|${sc.shortName}|${sc.source}`] = sc.name;
    const use = text => /\bas a bonus action\b|\buse a bonus action\b|\bbonus action to\b/i.test(text) ? 'bonus' : /\byour reaction\b|\bas a reaction\b|\buse your reaction\b/i.test(text) ? 'reaction' : /\bas an action\b|\buse your action\b|\byou can use an action\b/i.test(text) ? 'action' : undefined;
    const add = f => { if (f.text && f.text.trim()) { if (!f.use) { const u = use(f.text); if (u) f.use = u; } out.push(f); } };
    for (const f of j.classFeature || []) {
      if (!f || !f.name || f._copy) continue;
      add({ id: `5etf:${slugOf(f.source)}:${slugOf(f.className)}:${slugOf(f.name)}:${f.level}`, name: f.name, kind: 'class', cls: f.className, level: +f.level || 1,
        text: entries(f.entries, 0), source: f.source || '', parent: f.isClassFeatureVariant ? 'Optional class features' : undefined });
    }
    for (const f of j.subclassFeature || []) {
      if (!f || !f.name || f._copy) continue;
      const sub = subName[`${f.className}|${f.subclassShortName}|${f.subclassSource}`] || f.subclassShortName;
      add({ id: `5etf:${slugOf(f.source)}:${slugOf(f.className)}:${slugOf(f.subclassShortName)}:${slugOf(f.name)}:${f.level}`, name: f.name, kind: 'class', cls: f.className, level: +f.level || 1,
        sub, text: entries(f.entries, 0), source: f.source || '' });
    }
    const traits = (raceName, list, src, prefix) => {
      for (const e of list || []) {
        if (!e || typeof e !== 'object' || !e.name || SKIP_TRAITS.test(e.name)) continue;
        add({ id: `5etr:${slugOf(src)}:${slugOf(prefix)}:${slugOf(e.name)}`, name: e.name, kind: 'race', races: [raceName], text: entries(e.entries || [], 0), source: src || '' });
      }
    };
    for (const r of j.race || []) if (r && r.name && !r._copy) traits(r.name, r.entries, r.source, r.name);
    for (const r of j.subrace || []) if (r && r.name && r.raceName && !r._copy) traits(`${r.name} ${r.raceName}`, r.entries, r.source, r.name + '-' + r.raceName);
    for (const f of j.feat || []) {
      if (!f || !f.name || f._copy) continue;
      add({ id: `5etx:${slugOf(f.source)}:${slugOf(f.name)}`, name: f.name, kind: 'feat', prereq: prereq5(f.prerequisite) || undefined, text: entries(f.entries, 0), source: f.source || '' });
    }
    for (const f of j.optionalfeature || []) {
      if (!f || !f.name || f._copy) continue;
      // one card for each class that gets it (Archery is a fighter's, a ranger's and a paladin's fighting style)
      const kinds = [...new Set((f.featureType || []).filter(k => OPT[k]))];
      const plv = (f.prerequisite || []).map(p => p.level && (typeof p.level === 'object' ? p.level.level : p.level)).find(Boolean);
      const base = () => ({ name: f.name, prereq: prereq5(f.prerequisite) || undefined, text: entries(f.entries, 0), source: f.source || '' });
      if (!kinds.length || kinds.every(k => !OPT[k][0])) { add(Object.assign(base(), { id: `5eto:${slugOf(f.source)}:${slugOf(f.name)}`, kind: 'feat' })); continue; }
      for (const k of kinds) {
        const [cls, group, first] = OPT[k]; if (!cls) continue;
        add(Object.assign(base(), { id: `5eto:${slugOf(f.source)}:${slugOf(cls)}:${slugOf(f.name)}`, kind: 'class', cls, level: +(plv || first) || 1, parent: group }));
      }
    }
    return out;
  }
  // a card in the table's own format, kept to the fields the table uses
  const ID = v => /^[a-z0-9:_-]{1,120}$/i.test(String(v || '')) ? String(v) : null;
  const ITEM_KINDS = ['weapon', 'armor', 'gear', 'tool', 'mount', 'magic', 'treasure', 'other'];
  const RARITIES = ['mundane', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  function ownItem(x) {
    if (!x || typeof x !== 'object' || !x.name || !ID(x.id)) return null;
    const c = { id: ID(x.id), name: str(x.name, 120), kind: ITEM_KINDS.includes(x.kind) ? x.kind : 'other', type: str(x.type, 120), rarity: RARITIES.includes(x.rarity) ? x.rarity : 'mundane',
      cost: str(x.cost, 40), source: str(x.source, 40) || 'Homebrew', text: str(x.text, 40000) };
    for (const k of ['icon', 'gi', 'ac', 'notes']) if (x[k]) c[k] = str(x[k], 200);
    if (x.attune) c.attune = x.attune === true ? true : str(x.attune, 200);
    if (x.weight != null && isFinite(+x.weight)) c.weight = +x.weight;
    if (Array.isArray(x.props)) c.props = x.props.slice(0, 20).map(p => str(p, 80)).filter(Boolean);
    if (x.weapon && typeof x.weapon === 'object') {
      const w = x.weapon;
      c.weapon = { damage: str(w.damage, 40), dtype: str(w.dtype, 20), range: str(w.range, 40), ranged: !!w.ranged, finesse: !!w.finesse };
      if (w.magic) c.weapon.magic = Math.round(num(w.magic, 0, -5, 5));
    }
    if (!c.icon) c.icon = iconFor(c.name, { weapon: /ranged/i.test(c.type) ? 'R' : 'M', armor: /shield/i.test(c.name) ? 'S' : 'MA', tool: 'T', mount: 'MNT', treasure: '$' }[c.kind] || '');
    return c;
  }
  // one monster: only the fields a stat block has, each a sensible size
  function ownMonster(x) {
    if (!x || typeof x !== 'object' || !x.name || !ID(x.id)) return null;
    const m = { id: ID(x.id), name: str(x.name, 120), source: str(x.source, 40) || 'Homebrew' };
    for (const k of ['group', 'family', 'size', 'type', 'kind', 'tags', 'alignment', 'typeLine', 'acNote', 'hpFormula', 'speed', 'skills', 'senses', 'languages',
      'cr', 'crText', 'resist', 'vuln', 'immune', 'condImmune', 'gear', 'lore', 'legendaryIntro', 'mythicIntro', 'lairIntro', 'regionalIntro']) if (x[k] != null && x[k] !== '') m[k] = str(x[k], k === 'lore' || k.endsWith('Intro') ? 4000 : 600);
    for (const k of ['ac', 'hp', 'init', 'xp', 'pb', 'str', 'dex', 'con', 'int', 'wis', 'cha']) if (x[k] != null) m[k] = Math.round(num(x[k], 0, -50, 100000));
    if (x.saves && typeof x.saves === 'object') { m.saves = {}; for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) if (x.saves[a] != null) m.saves[a] = Math.round(num(x.saves[a], 0, -20, 40)); }
    for (const k of ['habitat', 'treasure']) if (Array.isArray(x[k])) m[k] = x[k].slice(0, 20).map(v => str(v, 80));
    for (const k of ['traits', 'actions', 'bonus', 'reactions', 'legendary', 'mythic', 'lair', 'regional']) if (Array.isArray(x[k]))
      m[k] = x[k].slice(0, 40).filter(a => a && a.name).map(a => ({ name: str(a.name, 160), text: str(a.text, 8000) }));
    if (x.swarm) m.swarm = true;
    // its picture: a web address (public-domain art from Wikimedia Commons) or a picture the GM uploaded here
    if (typeof x.img === 'string' && /^(https:\/\/|\/vtt-data\/)/.test(x.img)) {
      m.img = str(x.img, 600);
      if (typeof x.imgPage === 'string' && /^https:\/\//.test(x.imgPage)) m.imgPage = str(x.imgPage, 600);
      for (const k of ['imgCredit', 'imgLicense']) if (x[k]) m[k] = str(x[k], 120);
    }
    return m;
  }
  function ownFeature(x) {
    if (!x || typeof x !== 'object' || !x.name || !ID(x.id) || !['class', 'race', 'feat', 'background'].includes(x.kind)) return null;
    const f = { id: ID(x.id), name: str(x.name, 120), kind: x.kind, source: str(x.source, 40) || 'Homebrew', text: str(x.text, 40000) };
    if (!f.text.trim()) return null;
    for (const k of ['cls', 'sub', 'parent', 'prereq', 'gi']) if (x[k]) f[k] = str(x[k], 300);
    if (x.level != null) f.level = Math.round(num(x.level, 1, 1, 20));
    if (['action', 'bonus', 'reaction', 'free'].includes(x.use)) f.use = x.use;
    if (['short', 'long'].includes(x.rest)) f.rest = x.rest;
    if (Array.isArray(x.races)) f.races = x.races.slice(0, 20).map(r => str(r, 60)).filter(Boolean);
    if (f.kind === 'background') {   // what it gives: ability scores to raise, a feat, skills, a tool, equipment
      if (Array.isArray(x.abilities)) f.abilities = x.abilities.slice(0, 6).map(a => str(a, 3).toLowerCase()).filter(a => /^(str|dex|con|int|wis|cha)$/.test(a));
      if (Array.isArray(x.skills)) f.skills = x.skills.slice(0, 6).map(k => str(k, 30)).filter(Boolean);
      for (const k of ['feat', 'tool', 'equipment']) if (x[k]) f[k] = str(x[k], 600);
    }
    return f;
  }
  function mergeInto(list, got, saver) {
    let added = 0, replaced = 0;
    for (const x of got) {
      const i = list.findIndex(y => y.id === x.id);
      if (i >= 0) { list[i] = x; replaced++; } else { list.push(x); added++; }
    }
    saver();
    return { added, replaced };
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
      if (p === '/api/compendium/items' && m === 'GET') return sendJSON(res, 200, { items }), true;
      if (p === '/api/compendium/features' && m === 'GET') return sendJSON(res, 200, { features }), true;
      if (p === '/api/compendium/monsters' && m === 'GET') { if (!gm) return deny(), true; return sendJSON(res, 200, { monsters }), true; }   // stat blocks are the GM's
      if (p === '/api/compendium/monsters' && m === 'DELETE') {
        if (!gm) return deny(), true;
        const q = new URL(req.url, 'http://x').searchParams, src = q.get('source'), oneId = q.get('id');
        const b = monsters.length; monsters = monsters.filter(x => oneId ? x.id !== oneId : x.source !== src); saveMonsters();
        return sendJSON(res, 200, { removed: b - monsters.length }), true;
      }
      // GM: a creature's picture, set or cleared (the Bestiary's art slot)
      if (p === '/api/compendium/monsters/art' && m === 'POST') {
        if (!gm) return deny(), true;
        const j = await bodyJSON(req), mon = monsters.find(x => x.id === j.id);
        if (!mon) throw new Error('No such creature');
        for (const k of ['img', 'imgPage', 'imgCredit', 'imgLicense']) delete mon[k];
        if (j.img) {
          if (typeof j.img !== 'string' || !/^(https:\/\/|\/vtt-data\/)/.test(j.img)) throw new Error('That isn’t a picture this can use');
          Object.assign(mon, ownMonster(Object.assign({}, mon, { img: j.img, imgPage: j.imgPage, imgCredit: j.imgCredit, imgLicense: j.imgLicense })));
        }
        saveMonsters();
        return sendJSON(res, 200, { monster: mon }), true;
      }
      // GM: one feature card, new or changed (the Edit Card button), in the table's own format
      if (p === '/api/compendium/features' && m === 'PUT') {
        if (!gm) return deny(), true;
        const f = ownFeature((await bodyJSON(req)).feature);
        if (!f) throw new Error('A feature needs a name, a kind and some text');
        mergeInto(features, [f], saveFeatures);
        return sendJSON(res, 200, { feature: f }), true;
      }
      if ((p === '/api/compendium/items' || p === '/api/compendium/features') && m === 'DELETE') {
        if (!gm) return deny(), true;
        const q = new URL(req.url, 'http://x').searchParams, src = q.get('source'), oneId = q.get('id');
        if (oneId && p.endsWith('features')) { const b = features.length; features = features.filter(x => x.id !== oneId); saveFeatures(); return sendJSON(res, 200, { removed: b - features.length }), true; }
        if (!src) throw new Error('Which book?');
        if (p.endsWith('items')) { const b = items.length; items = items.filter(x => x.source !== src); saveItems(); return sendJSON(res, 200, { removed: b - items.length }), true; }
        const b = features.length; features = features.filter(x => x.source !== src); saveFeatures(); return sendJSON(res, 200, { removed: b - features.length }), true;
      }
      // any 5etools file: whatever's in it (spells, items, class and subclass features, races, feats, options)
      if (p === '/api/compendium/import' && m === 'POST') {
        if (!gm) return deny(), true;
        let j;
        try { j = JSON.parse((await readBody(req, 60e6)).toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new Error('That file isn’t JSON'); }
        if (j && typeof j.url === 'string' && Object.keys(j).length === 1) {
          if (!/^https?:\/\//i.test(j.url)) throw new Error('That isn’t a web address');
          const r = await fetch(j.url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (table compendium import)' } });
          if (!r.ok) throw new Error(`The link answered ${r.status} ${r.statusText}`);
          try { j = JSON.parse((await r.text()).replace(/^\uFEFF/, '')); } catch (e) { throw new Error('The link didn’t give back JSON'); }
        }
        const out = {};
        if (j && (Array.isArray(j.spell) || Array.isArray(j.spells) || (!['monsters', 'item', 'baseitem', 'magicvariant', 'feat', 'race', 'subrace', 'class', 'subclass', 'classFeature', 'subclassFeature', 'optionalfeature'].some(k => k in j) && !Array.isArray(j)))) {
          try {
            const got = parse(j);
            if (got.classesOnly) out.spellClasses = true;
            else if (got.length) out.spells = merge(got);
          } catch (e) { if (Array.isArray(j.spell)) throw e; }
        }
        const its = [].concat((j.item || []).filter(x => x && x.name && !x._copy).map(item5), (j.baseitem || []).filter(x => x && x.name).map(item5),
          (j.magicvariant || j.variant || []).filter(x => x && x.name).map(variant5));
        if (its.length) out.items = mergeInto(items, its, saveItems);
        const fs5 = features5(j || {});
        if (fs5.length) out.features = mergeInto(features, fs5, saveFeatures);
        // this table's own format: { items: [card…], features: [card…] } (from another table, or made from your own books)
        if (Array.isArray(j.items)) { const got = j.items.map(ownItem).filter(Boolean); if (got.length) out.items = mergeInto(items, got, saveItems); }
        if (Array.isArray(j.features)) { const got = j.features.map(ownFeature).filter(Boolean); if (got.length) out.features = mergeInto(features, got, saveFeatures); }
        if (Array.isArray(j.monsters)) { const got = j.monsters.map(ownMonster).filter(Boolean); if (got.length) out.monsters = mergeInto(monsters, got, saveMonsters); }
        if (!Object.keys(out).length) throw new Error('Nothing in that file this can read: it takes 5etools spell, item, class, race, feat and optional-feature files');
        log(`Compendium import by ${user.name}: ${JSON.stringify(out)}`);
        return sendJSON(res, 200, out), true;
      }
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
