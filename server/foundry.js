/* Foundry VTT documents into the table's own: scenes (picture, grid, walls and doors, lights, tokens) and
 * D&D 5e actors (into the description shared/sheet5e.js writes onto either 5e sheet).
 * Works with the JSON from Foundry's "Export Data" (v9 to v12) and with the lines of an older world's .db files.
 * Pictures are only named here (Foundry paths); the server finds and copies them. */
'use strict';

const num = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };
const s = v => v == null ? '' : String(v);

function kindOf(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.walls) || (d.grid != null && ('background' in d || 'img' in d) && Array.isArray(d.tokens))) return 'scene';
  const sys = d.system || d.data;
  if (sys && sys.abilities && (d.type === 'character' || d.type === 'npc' || d.type === 'vehicle')) return 'actor';
  return null;
}

// ───────── scenes ─────────

function sceneOf(d) {
  const g = d.grid && typeof d.grid === 'object' ? d.grid : { size: d.grid, type: d.gridType, distance: d.gridDistance, units: d.gridUnits, color: d.gridColor, alpha: d.gridAlpha };
  const size = num(g.size, 100) || 100;
  const type = num(g.type, 1);
  const w = num(d.width, 0), h = num(d.height, 0);
  const pad = num(d.padding, 0.25);
  const padX = Math.ceil(w * pad / size) * size, padY = Math.ceil(h * pad / size) * size;
  const bg = d.background && typeof d.background === 'object' ? d.background : {};
  const offX = num(bg.offsetX, num(d.shiftX, 0)), offY = num(bg.offsetY, num(d.shiftY, 0));
  const X = x => Math.round((num(x, 0) - padX - offX) * 10) / 10, Y = y => Math.round((num(y, 0) - padY - offY) * 10) / 10;
  const mod = (v, m) => ((v % m) + m) % m;
  const gridType = type === 0 ? 'none' : type === 1 ? 'square' : type <= 3 ? 'hexr' : 'hexc';
  const units = s(g.units || 'ft') || 'ft', distance = num(g.distance, 5) || 5;
  const color = /^#[0-9a-f]{6}$/i.test(s(g.color)) ? s(g.color) : '#000000';
  const img = (bg.src || d.img || null);
  const scene = {
    name: s(d.name) || 'Foundry scene', kind: 'battle',
    image: img ? { url: img, w, h } : null,
    grid: { type: gridType, size, ox: Math.round(mod(-offX, size) * 10) / 10, oy: Math.round(mod(-offY, size) * 10) / 10, feet: distance, units, diagonal: 'one', color, alpha: num(g.alpha, 0.2) },
    darkness: num(d.environment && d.environment.darknessLevel, num(d.darkness, 0)),
    vision: d.tokenVision !== false,
    fog: false, bg: '#1b1d22', area: { cols: Math.round(w / size) || 30, rows: Math.round(h / size) || 20 },
    walls: [], lights: [], tokens: [], templates: [], fogShapes: [], notes: s(d.navName || '')
  };
  if (!img) scene.bg = s(d.backgroundColor || '#1b1d22');
  for (const wl of d.walls || []) {
    const c = wl.c || [];
    if (c.length < 4) continue;
    const door = num(wl.door, 0), ds = num(wl.ds, 0);
    const sight = wl.sight != null ? num(wl.sight, 20) : num(wl.sense, 1) ? 20 : 0;   // v10+: 0 none, 10 limited, 20 normal, 30 proximity; v9: sense
    const move = wl.move != null ? num(wl.move, 20) : 20;
    const light = wl.light != null ? num(wl.light, 20) : sight;
    let kind = 'wall';
    if (door === 1) kind = 'door'; else if (door === 2) kind = 'secret';
    else if (sight === 0 && light > 0 && move > 0) kind = 'shade';
    else if (sight === 0 && move > 0) kind = 'invisible';
    else if (sight === 10) kind = 'window';                         // "limited" (terrain) walls: the nearest thing we have
    else if (move === 0 && sight === 0) continue;                    // blocks nothing
    if (kind === 'wall' && num(wl.dir, 0)) kind = 'oneway';
    scene.walls.push({ a: [X(c[0]), Y(c[1])], b: [X(c[2]), Y(c[3])], kind, open: ds === 1, locked: ds === 2, flip: num(wl.dir, 0) === 2 });
  }
  const anim = t => ({ torch: 'torch', flame: 'torch', fog: 'pulse', pulse: 'pulse', chroma: 'fairy', wave: 'pulse', fairy: 'fairy', sunburst: 'sunbeam', sunburn: 'sunbeam', light: 'sunbeam', ghost: 'pulse', energy: 'pulse', hexa: 'fairy', bewitching: 'fairy', revolving: 'pulse', siren: 'pulse', candle: 'candle', torchlight: 'torch' })[s(t).toLowerCase()] || 'none';
  const lightOf = (cfg, extra) => {
    const dim = num(cfg.dim, 0), bright = num(cfg.bright, 0);
    if (!(dim > 0 || bright > 0)) return null;
    // (both count in the scene's own units, as ours do)
    return Object.assign({ bright: Math.round(bright * 10) / 10, dim: Math.round(dim * 10) / 10,
      color: /^#[0-9a-f]{6}$/i.test(s(cfg.color)) ? s(cfg.color) : '#ffc477', intensity: Math.min(1, num(cfg.alpha, 0.5) * 1.4),
      angle: num(cfg.angle, 360) || 360, anim: anim(cfg.animation && cfg.animation.type) }, extra || {});
  };
  for (const l of d.lights || []) {
    if (l.hidden) continue;
    const cfg = l.config || { dim: l.dim, bright: l.bright, color: l.tintColor, alpha: l.tintAlpha, angle: l.angle, animation: l.lightAnimation };
    // Foundry's 0° points down; ours points right
    const x = lightOf(cfg, { x: X(l.x), y: Y(l.y), dir: Math.round((num(l.rotation, 0) + 90) % 360) });
    if (x) scene.lights.push(x);
  }
  for (const t of d.tokens || []) {
    const tw = num(t.width, 1), th = num(t.height, 1);
    const sight = t.sight && typeof t.sight === 'object' ? t.sight : null;
    const range = sight ? num(sight.range, 0) : Math.max(num(t.dimSight, 0), num(t.brightSight, 0));
    const lcfg = t.light && typeof t.light === 'object' ? t.light : { dim: t.dimLight, bright: t.brightLight, color: t.lightColor, alpha: t.lightAlpha, angle: t.lightAngle, animation: t.lightAnimation };
    const visionOn = sight ? !!sight.enabled : !!t.vision;
    scene.tokens.push({
      name: s(t.name) || 'Token', x: Math.round(X(num(t.x, 0) + tw * size / 2)), y: Math.round(Y(num(t.y, 0) + th * size / 2)),
      size: Math.max(0.25, Math.min(30, (tw + th) / 2)), img: (t.texture && t.texture.src) || t.img || null,
      layer: t.hidden ? 'gm' : 'tokens', rot: num(t.rotation, 0), nameShown: num(t.displayName, 0) >= 30 || num(t.displayName, 0) === 50,
      sight: visionOn ? { on: true, range: range > 0 && range < 1000 ? Math.round(range) : 0, dark: 0 } : null,
      light: lightOf(lcfg || {}),
      _actor: t.actorId || null, _disposition: num(t.disposition, 0)
    });
  }
  return scene;
}

// ───────── actors (dnd5e) ─────────

const SKILL = { acr: 'acrobatics', ani: 'animal_handling', arc: 'arcana', ath: 'athletics', dec: 'deception', his: 'history', ins: 'insight',
  itm: 'intimidation', inv: 'investigation', med: 'medicine', nat: 'nature', prc: 'perception', prf: 'performance', per: 'persuasion',
  rel: 'religion', slt: 'sleight_of_hand', ste: 'stealth', sur: 'survival' };
const SCHOOL = { abj: 'Abjuration', con: 'Conjuration', div: 'Divination', enc: 'Enchantment', evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy', trs: 'Transmutation' };
const UNITS = { ft: 'ft', mi: 'mile', self: 'Self', touch: 'Touch', spec: 'Special', any: 'Any', inst: 'Instantaneous', minute: 'minute', hour: 'hour', day: 'day', round: 'round', perm: 'Permanent', turn: 'turn', action: 'action', bonus: 'bonus action', reaction: 'reaction' };
// Foundry text is HTML with its own links: keep the words
function plain(html) {
  return s(html)
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1').replace(/@\w+\[([^\]]*)\]/g, (m, x) => x.split('.').pop())
    .replace(/\[\[\/(?:r|roll|gmr)\s+([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
function actorModel(d) {
  const sys = d.system || d.data || {};
  const m = { abilities: {}, saves: [], skills: {}, classLevels: {}, weapons: [], spells: [], items: [], features: [] };
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const a = (sys.abilities || {})[k] || {};
    m.abilities[k] = num(a.value, 10);
    if (num(a.proficient, 0) >= 1) m.saves.push(k);
  }
  for (const [k, name] of Object.entries(SKILL)) {
    const v = num(((sys.skills || {})[k] || {}).value, 0);
    if (v >= 2) m.skills[name] = 'e'; else if (v >= 1) m.skills[name] = 'p'; else if (v === 0.5) m.skills[name] = 'j';
  }
  const at = sys.attributes || {}, det = sys.details || {};
  m.hp = at.hp && at.hp.value; m.hpMax = at.hp && (at.hp.max || at.hp.value); m.hpTemp = at.hp && at.hp.temp || '';
  const walk = at.movement && at.movement.walk;
  if (walk) m.speed = walk + ' ' + ((at.movement.units) || 'ft');
  m.ac = at.ac && (at.ac.flat || at.ac.value);
  m.alignment = s(det.alignment);
  m.xp = det.xp && det.xp.value;
  m.personality = plain(det.trait); m.ideals = plain(det.ideal); m.bonds = plain(det.bond); m.flaws = plain(det.flaw);
  m.appearance = plain(det.appearance);
  m.backstory = plain(det.biography && (det.biography.value || det.biography.public));
  m.race = typeof det.race === 'string' ? det.race : '';
  m.background = typeof det.background === 'string' ? det.background : '';
  for (const it of d.items || []) {
    const is = it.system || it.data || {};
    const desc = plain(is.description && (is.description.value || is.description));
    const weight = typeof is.weight === 'object' && is.weight ? num(is.weight.value, 0) : num(is.weight, 0);
    switch (it.type) {
      case 'class': m.classLevels[s(it.name).toLowerCase()] = num(is.levels, 1); break;
      case 'race': m.race = m.race || s(it.name); m.features.push({ name: s(it.name), desc, source: 'race' }); break;
      case 'background': m.background = m.background || s(it.name); break;
      case 'weapon': {
        const parts = (is.damage && is.damage.parts) || [];
        const base = is.damage && is.damage.base;   // dnd5e 4
        const dmg = parts.length ? s(parts[0][0]).replace(/\s*\+\s*@mod\b/, '') : base ? `${base.number || 1}d${base.denomination || 6}` : '';
        const props = Array.isArray(is.properties) ? is.properties : Object.keys(is.properties || {}).filter(k => is.properties[k]);
        const ranged = /^r/.test(s(is.actionType)) || /ranged/i.test(s(is.type && is.type.value));
        const r = is.range || {};
        m.weapons.push({ name: s(it.name), ability: is.ability || (props.includes('fin') ? 'dex' : ranged ? 'dex' : 'str'), magic: num(is.attackBonus, 0) || num(is.magicalBonus, 0),
          damage: dmg, dtype: parts.length ? s(parts[0][1]) : base ? (base.types || [])[0] || '' : '', range: r.value ? `${r.value}${r.long ? '/' + r.long : ''} ${r.units || 'ft'}` : '', ranged });
        m.items.push({ name: s(it.name), qty: num(is.quantity, 1), weight, desc });
        break;
      }
      case 'spell': {
        const comp = is.components || {}, props = Array.isArray(is.properties) ? is.properties : [];
        const has = (k, long) => props.includes(k) || !!comp[long];
        const act = is.activation || {}, r = is.range || {}, du = is.duration || {};
        m.spells.push({ level: num(is.level, 0), name: s(it.name), school: SCHOOL[is.school] || s(is.school),
          time: act.type ? `${act.cost || 1} ${UNITS[act.type] || act.type}` : '',
          range: r.units ? (r.value ? `${r.value} ${UNITS[r.units] || r.units}` : UNITS[r.units] || r.units) : '',
          duration: du.units ? (du.value ? `${du.value} ${UNITS[du.units] || du.units}${du.value > 1 ? 's' : ''}` : UNITS[du.units] || du.units) : '',
          components: [has('vocal', 'vocal') ? 'V' : '', has('somatic', 'somatic') ? 'S' : '', has('material', 'material') ? 'M' + (is.materials && is.materials.value ? ` (${is.materials.value})` : '') : ''].filter(Boolean).join(', '),
          desc, higher: '', prepared: !!(is.preparation && (is.preparation.prepared || is.preparation.mode === 'always')),
          ritual: props.includes('ritual') || !!comp.ritual, concentration: props.includes('concentration') || !!comp.concentration });
        break;
      }
      case 'feat': m.features.push({ name: s(it.name), desc, source: is.type && is.type.value === 'race' ? 'race' : 'class' }); break;
      case 'equipment': case 'consumable': case 'tool': case 'loot': case 'backpack': case 'container':
        m.items.push({ name: s(it.name), qty: num(is.quantity, 1), weight, desc }); break;
    }
  }
  const top = Object.entries(m.classLevels).sort((a, b) => b[1] - a[1])[0];
  if (top) { m.cls = top[0][0].toUpperCase() + top[0].slice(1); m.level = Object.values(m.classLevels).reduce((x, y) => x + y, 0); }
  else if (det.cr != null) { m.cls = 'NPC'; m.level = Math.max(1, Math.round(num(det.cr, 1))); }
  return m;
}

module.exports = { kindOf, sceneOf, actorModel, plain };
