/* Roll20 exports into the table's own: characters (their sheet attributes, which carry straight over: the table runs
 * the same Roll20 sheets), handouts, and pages (the map, grid, walls, doors and windows, and tokens).
 *
 * Roll20 itself has no export button, so this reads what the two usual tools write:
 *  - VTT Enhancement Suite (VTTES, a browser extension): a character's journal menu > Export, one .json per character
 *    ({ schema_version, name, avatar, bio, gmnotes, attribs: [{ name, current, max }], abilities, defaulttoken })
 *  - R20Exporter (kakaroto's campaign exporter): campaign.json from its .zip, with characters, handouts and pages,
 *    and the pictures alongside in the .zip (pick them with the file too, or they're fetched from Roll20's servers).
 * Unknown fields are ignored; anything missing just doesn't come over. Pictures are only named here (URLs or file
 * names); the server fetches or matches them. */
'use strict';

const num = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };
const s = v => v == null ? '' : String(v);
const parse = v => { if (v && typeof v === 'string' && /^[[{]/.test(v.trim())) try { return JSON.parse(v); } catch (e) { /* as is */ } return v; };

function kindOf(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.attribs) || Array.isArray(d.attributes)) return 'character';
  if (Array.isArray(d.graphics) || Array.isArray(d.paths) || (d.width != null && d.height != null && d.scale_number != null)) return 'page';
  if (('notes' in d || 'blobNotes' in d) && d.name != null) return 'handout';
  return null;
}
// every document in a file: a campaign (lists of each), a list, or one
function docsOf(j) {
  const out = [];
  const add = x => {
    if (Array.isArray(x)) return x.forEach(add);
    if (!x || typeof x !== 'object') return;
    if (kindOf(x)) out.push(x);
    for (const k of ['characters', 'handouts', 'pages', 'journal']) if (Array.isArray(x[k])) x[k].forEach(add);
    if (x.campaign && typeof x.campaign === 'object') add(x.campaign);
  };
  add(j);
  return out;
}

// Roll20's HTML (bios, handouts) to Markdown, near enough
function md(html) {
  let t = s(html);
  if (!t) return '';
  if (!/<[a-z]/i.test(t)) { try { t = decodeURIComponent(t); } catch (e) { /* as is */ } }   // (older exports escape it)
  t = t.replace(/\r/g, '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, '\n\n![]($1)\n\n')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<h1[^>]*>/gi, '\n\n# ').replace(/<h2[^>]*>/gi, '\n\n## ').replace(/<h[3-6][^>]*>/gi, '\n\n### ').replace(/<\/h\d>/gi, '\n\n')
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|ul|ol|blockquote|tr|table)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\*\*\s*\*\*/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// ───────── characters ─────────
function characterOf(d) {
  const attrs = {};
  for (const a of d.attribs || d.attributes || []) {
    const n = s(a && a.name).trim().toLowerCase(); if (!n || n.length > 120) continue;
    if (a.current != null && a.current !== '') attrs[n] = s(a.current);
    if (a.max != null && a.max !== '') attrs[n + '_max'] = s(a.max);
  }
  const tok = parse(d.defaulttoken) || {};
  return { name: s(d.name) || 'Character', avatar: s(d.avatar) || s(tok.imgsrc) || null, bio: md(d.bio || d.blobBio), gmnotes: md(d.gmnotes || d.blobGmNotes), attrs,
    id: s(d.id || d.oldId || d._id) };
}
// which of the table's sheets the attributes were written by
function guessSheet(attrs) {
  const k = Object.keys(attrs);
  if (k.some(x => /^meleeweaponname\d|^classactionname\d|^spellbook/.test(x)) || k.some(x => /^repeating_spellbook/.test(x))) return 'dnd5e';
  if ('npc_name' in attrs || 'charactersheet_type' in attrs || k.some(x => /^repeating_(attack|spell-|inventory|npcaction)/.test(x))) return 'dnd5e_legacy';
  if ('strength' in attrs || 'dexterity' in attrs) return 'dnd5e_legacy';
  return null;
}

// ───────── handouts ─────────
function handoutOf(d) {
  const ijs = s(d.inplayerjournals);
  return { name: s(d.name) || 'Handout', img: s(d.avatar) || null, text: md(d.notes || d.blobNotes), gmNotes: md(d.gmnotes || d.blobGmNotes), shared: ijs === 'all' };
}

// ───────── pages ─────────
const PX = 70;   // Roll20's grid square, in pixels
function pageOf(d) {
  const snap = num(d.snapping_increment, 1) || 1, size = PX * snap;
  const W = num(d.width, 25) * PX, H = num(d.height, 25) * PX;
  const graphics = (d.graphics || []).map(parse).filter(g => g && typeof g === 'object');
  // the map: the biggest picture on the map layer becomes the scene's picture, and everything is moved to suit
  const maps = graphics.filter(g => g.layer === 'map' && g.imgsrc).sort((a, b) => num(b.width, 0) * num(b.height, 0) - num(a.width, 0) * num(a.height, 0));
  const bgPic = maps[0] || null;
  const ox = bgPic ? num(bgPic.left, 0) - num(bgPic.width, 0) / 2 : 0, oy = bgPic ? num(bgPic.top, 0) - num(bgPic.height, 0) / 2 : 0;
  const X = x => Math.round((num(x, 0) - ox) * 10) / 10, Y = y => Math.round((num(y, 0) - oy) * 10) / 10;
  const mod = (v, m) => ((v % m) + m) % m;
  const col = c => /^#[0-9a-f]{6}$/i.test(s(c)) ? s(c) : '#1b1d22';
  const scene = {
    name: s(d.name) || 'Roll20 page', kind: 'battle',
    image: bgPic ? { url: s(bgPic.imgsrc), w: num(bgPic.width, W), h: num(bgPic.height, H) } : null,
    grid: { type: d.showgrid === false ? 'none' : (d.grid_type === 'hex' ? 'hexc' : d.grid_type === 'hexr' ? 'hexr' : 'square'), size, ox: Math.round(mod(-ox, size) * 10) / 10, oy: Math.round(mod(-oy, size) * 10) / 10,
      feet: num(d.scale_number, 5) || 5, units: s(d.scale_units || 'ft') || 'ft', diagonal: 'one', color: /^#[0-9a-f]{6}$/i.test(s(d.gridcolor)) ? s(d.gridcolor) : '#000000', alpha: num(d.grid_opacity, 0.35) },
    darkness: d.dynamic_lighting_enabled || d.showlighting ? (d.daylight_mode_enabled || d.daylightModeEnabled ? 0 : 0.8) : 0,
    vision: !!(d.dynamic_lighting_enabled || d.showlighting),
    bg: col(d.background_color),
    area: { cols: Math.max(1, Math.round(W / size)), rows: Math.max(1, Math.round(H / size)) },
    walls: [], tokens: [],
    notes: ''
  };
  // walls: lines on the walls layer (and the newer doors and windows)
  const addLine = (pts, kind, extra) => { for (let i = 1; i < pts.length; i++) scene.walls.push(Object.assign({ a: [X(pts[i - 1][0]), Y(pts[i - 1][1])], b: [X(pts[i][0]), Y(pts[i][1])], kind }, extra || {})); };
  for (const p0 of d.paths || []) {
    const p = parse(p0); if (!p || typeof p !== 'object' || (p.layer && p.layer !== 'walls')) continue;
    const sx = num(p.scaleX, 1), sy = num(p.scaleY, 1), w = num(p.width, 0), hh = num(p.height, 0);
    const left = num(p.left, 0) - w * sx / 2, top = num(p.top, 0) - hh * sy / 2;
    const segs = parse(p.path);
    let pts = [];
    if (Array.isArray(segs)) {
      for (const sg of segs) {
        if (!Array.isArray(sg)) continue;
        const c = sg[0];
        if (c === 'M' && pts.length > 1) { addLine(pts, 'wall'); pts = []; }
        if (c === 'M' || c === 'L') pts.push([left + num(sg[1], 0) * sx, top + num(sg[2], 0) * sy]);
        else if (c === 'Q' || c === 'C') pts.push([left + num(sg[sg.length - 2], 0) * sx, top + num(sg[sg.length - 1], 0) * sy]);
      }
    } else if (Array.isArray(p.points)) for (const q of p.points) pts.push([num(p.x, 0) + num(q[0], 0), num(p.y, 0) + num(q[1], 0)]);
    addLine(pts, 'wall');
  }
  const handles = o => {
    const pth = parse(o.path) || {};
    const h0 = pth.handle0 || {}, h1 = pth.handle1 || {}, bx = num(o.x, 0), by = Math.abs(num(o.y, 0));
    return [[bx + num(h0.x, 0), by - num(h0.y, 0)], [bx + num(h1.x, 0), by - num(h1.y, 0)]];
  };
  for (const o0 of d.doors || []) { const o = parse(o0); if (!o) continue; addLine(handles(o), o.isSecret ? 'secret' : 'door', { open: !!o.isOpen, locked: !!o.isLocked }); }
  for (const o0 of d.windows || []) { const o = parse(o0); if (!o) continue; addLine(handles(o), 'window'); }
  // tokens: everything on the token and GM layers (Roll20's left and top are a picture's middle, as ours are)
  for (const g of graphics) {
    if (g === bgPic || !g.imgsrc || g.layer === 'walls') continue;
    // (other pictures on the map layer, scenery, come over as tokens nobody owns)
    if (g.layer === 'map') { scene.tokens.push({ name: s(g.name), x: X(g.left), y: Y(g.top), size: Math.max(0.25, num(g.width, size) / size), img: s(g.imgsrc), layer: 'tokens', nameShown: false, rot: num(g.rotation, 0) }); continue; }
    const sz = Math.max(0.25, Math.round(num(g.width, size) / size * 4) / 4);
    scene.tokens.push({
      name: s(g.name), x: X(g.left), y: Y(g.top), size: sz, img: s(g.imgsrc),
      layer: g.layer === 'gmlayer' ? 'gm' : 'tokens', rot: num(g.rotation, 0), nameShown: !!g.showname, flip: !!g.fliph,
      hp: g.bar1_max !== '' && g.bar1_max != null ? { v: num(g.bar1_value, 0), max: num(g.bar1_max, 0) } : null,
      _char: s(g.represents) || null
    });
  }
  return scene;
}

module.exports = { kindOf, docsOf, characterOf, guessSheet, handoutOf, pageOf, md };
