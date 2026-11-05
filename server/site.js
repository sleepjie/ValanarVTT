/* The world site: the map's data, the wiki and the drive, kept by the server so every change is saved for good.
 *
 * Everything lives in vtt-data/site/:
 *   world.json            the map: places, icon types, nations, borders, settings (was data/markers.js)
 *   atlases/<id>.json     other versions of the world map, for campaigns set at other times: { id, name, tiles, savedAt,
 *                         data } where data is shaped like world.json and tiles names a folder of maps/ ('' = the main picture)
 *   world-backups/        the last 30 versions of world.json
 *   map-history/<key>/    the world map's (key world) and each other version's (key: its id) changes: index.json lists
 *                         them, newest last ({ file, savedAt, by, from, summary, count, changes }); the files are the
 *                         map as each change left it, kept as bases for merging two people's edits
 *   wiki/pages/<folder>/<title>.md  one wiki page, as a Markdown file (Obsidian opens the folder as a vault): the
 *                         page's own text, after a short front matter block with what the site keeps about it
 *                         (id, gmOnly, created, updated, by, rev, source…). A .md file put in there by hand becomes
 *                         a page at the next start. Pages in the bin are in wiki/bin/<id>.md.
 *                         (Older sites kept wiki/pages/<id>.json: those are turned into .md files once, and the
 *                         .json files moved to wiki/pages-json-old.)
 *   wiki/revs/<id>.jsonl  its earlier versions, one per line (the last 100)
 *   drive.json            folders and uploaded files: { folders: [{ path, gmOnly }], files: [{ id, name, folder, type, size, gmOnly, … }] }
 *   files/<id>            the uploaded files themselves
 * Admins (the GM role) edit; everyone reads (logged in or not), except what is marked GM only. With "private" on in
 * the settings, only people who are logged in can see anything.
 *
 * The first run copies data/markers.js and data/wiki.js (from the old map viewer) in once; those files are only
 * ever read. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Cal = require('../table/shared/calendar.js');
const Merge = require('../table/shared/merge.js');

module.exports = function site(S) {
  const { ROOT, DATA, config, saveConfig, isGM, sendJSON, readBody, bodyJSON, serveFile, str, num, now, log, readJSON, writeJSON, db, saveUsers, publicUser, hashPassword } = S;
  const DIR = path.join(DATA, 'site');
  const WIKI_DIR = path.join(DIR, 'wiki', 'pages'), REVS_DIR = path.join(DIR, 'wiki', 'revs'), FILES_DIR = path.join(DIR, 'files');
  for (const d of [DIR, WIKI_DIR, REVS_DIR, FILES_DIR, path.join(DIR, 'world-backups')]) fs.mkdirSync(d, { recursive: true });
  const uid = p => p + crypto.randomBytes(6).toString('hex');
  // the site's name starts as the map page's <title> (rename it in Admin › Site)
  let firstName = 'My World';
  try { const m = /<title>([^<]{1,60})<\/title>/i.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); if (m) firstName = m[1].trim(); } catch (e) { /* no page */ }
  // Open by default: anyone can read the map and wiki and watch the table; logging in is for playing and editing.
  // "private" (Admin › The site) shuts everything behind the login instead. (The older publicView key is ignored.)
  const settings = () => { const s = Object.assign({ siteName: firstName, tagline: 'A world wiki and atlas', mainPage: '', private: false }, config.site || {});
    s.private = !!s.private; s.publicView = !s.private; return s; };

  // ───────── the calendar, the clock and the weather (calendar.json) ─────────
  const CAL_FILE = path.join(DIR, 'calendar.json');
  let calendar = readJSON(CAL_FILE, null) || { t: 9 * 60, events: [] };
  calendar.cal = Cal.clean(calendar.cal); calendar.weather = Cal.cleanWeather(calendar.weather); calendar.events = calendar.events || [];
  calendar.t = Math.round(+calendar.t || 0);
  // weather painted onto the world map by the GM: [{ id, kind, pts: [x, y, …] }] in map pixels, later ones on top
  const KINDS = new Set(Cal.WEATHER.map(w => w[0]));
  const cleanRegions = list => (Array.isArray(list) ? list : []).slice(0, 300).map(r => {
    const pts = (Array.isArray(r && r.pts) ? r.pts : []).slice(0, 4000).map(v => Math.round(num(v, 0, -1e6, 1e6)));
    return { id: /^[a-z0-9_-]{1,24}$/i.test((r && r.id) || '') ? r.id : uid('r'), kind: KINDS.has(r && r.kind) ? r.kind : 'rain', pts: pts.length % 2 ? pts.slice(0, -1) : pts };
  }).filter(r => r.pts.length >= 6);
  calendar.regions = cleanRegions(calendar.regions);
  const calFor = adm => ({ cal: calendar.cal, t: calendar.t, weather: calendar.weather, regions: calendar.regions, rev: calendar.rev || 0,
    events: calendar.events.filter(e => adm || !e.gmOnly) });
  function saveCalendar() {
    calendar.rev = (calendar.rev || 0) + 1;
    writeJSON(CAL_FILE, calendar);
    if (S.onCalendar) try { S.onCalendar(calFor(false), calFor(true)); } catch (e) { log('Calendar: ' + e.message); }
  }
  // ───────── the night sky: the world's constellations, drawn star by star (constellations.json) ─────────
  // Until one is saved here, the drawings that come with the site (data/constellations.json), if there are any.
  // { groups: [name], constellations: [{ id, name, group, page, about, hidden, w, h, stars: [{ x, y, m }], lines: [[i, j]] }], rev }
  const SKY_FILE = path.join(DIR, 'constellations.json'), SKY_BAK = path.join(DIR, 'constellation-backups');
  const skyRead = () => readJSON(SKY_FILE, null) || readJSON(path.join(ROOT, 'data', 'constellations.json'), null) || { groups: [], constellations: [] };
  function cleanSky(b) {
    const groups = (Array.isArray(b.groups) ? b.groups : []).map(g => str(g, 60)).filter(Boolean).slice(0, 30);
    const seen = new Set();
    const cons = (Array.isArray(b.constellations) ? b.constellations : []).slice(0, 400).map(c => {
      c = c || {};
      let id = /^[a-z0-9_-]{1,40}$/i.test(c.id || '') && !seen.has(c.id) ? c.id : uid('c'); seen.add(id);
      const stars = (Array.isArray(c.stars) ? c.stars : []).slice(0, 300).map(s => ({ x: Math.round(num(s && s.x, 0, -500, 3000) * 10) / 10, y: Math.round(num(s && s.y, 0, -500, 3000) * 10) / 10,
        m: Math.round(num(s && s.m, 2, 1, 5)), ...(s && s.name ? { name: str(s.name, 60) } : {}) }));
      const keys = new Set(), lines = [];
      for (const l of Array.isArray(c.lines) ? c.lines.slice(0, 900) : []) {
        if (!Array.isArray(l)) continue;
        const i = Math.round(+l[0]), j = Math.round(+l[1]);
        if (!(i >= 0 && j >= 0 && i < stars.length && j < stars.length) || i === j) continue;
        const k = Math.min(i, j) + ',' + Math.max(i, j); if (keys.has(k)) continue; keys.add(k); lines.push([i, j]);
      }
      return { id, name: str(c.name, 80) || 'Unnamed', group: str(c.group, 60), page: str(c.page, 200), about: str(c.about, 4000), hidden: !!c.hidden,
        w: Math.round(num(c.w, 1000, 50, 3000)), h: Math.round(num(c.h, 1000, 50, 3000)), stars, lines };
    });
    return { groups, constellations: cons };
  }
  const skyFor = adm => { const s = skyRead(); return { groups: s.groups || [], rev: s.rev || 0, constellations: (s.constellations || []).filter(c => adm || !c.hidden) }; };
  function saveSky(b, user) {
    const old = skyRead(), next = cleanSky(b);
    next.rev = (old.rev || 0) + 1; next.savedAt = now(); next.by = user ? user.id : null;
    try {   // the last 30 versions kept
      fs.mkdirSync(SKY_BAK, { recursive: true });
      if (fs.existsSync(SKY_FILE)) fs.copyFileSync(SKY_FILE, path.join(SKY_BAK, `constellations-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const olds = fs.readdirSync(SKY_BAK).filter(f => f.startsWith('constellations-')).sort();
      for (const f of olds.slice(0, Math.max(0, olds.length - 30))) fs.unlinkSync(path.join(SKY_BAK, f));
    } catch (e) { log('Constellations backup: ' + e.message); }
    writeJSON(SKY_FILE, next);
    return next;
  }
  // ───────── tales: narrated journeys across the map (tours.json) ─────────
  // A tale is a string of stops; at each the map flies to a place, the time of day and the weather can change, and a
  // caption tells what's there. { tours: [{ id, title, about, gmOnly, stops: [{ x, y, z, title, text, hour, weather,
  // borders, pin, hold }] }], rev }. Everyone sees the tales (bar GM-only ones); admins make them.
  const TOURS_FILE = path.join(DIR, 'tours.json'), TOURS_BAK = path.join(DIR, 'tour-backups');
  const toursRead = () => readJSON(TOURS_FILE, null) || { tours: [] };
  function cleanTours(b) {
    const seen = new Set();
    const tours = (Array.isArray(b.tours) ? b.tours : []).slice(0, 200).map(t => {
      t = t || {};
      const id = /^[a-z0-9_-]{1,40}$/i.test(t.id || '') && !seen.has(t.id) ? t.id : uid('t'); seen.add(id);
      const stops = (Array.isArray(t.stops) ? t.stops : []).slice(0, 120).map(q => {
        q = q || {};
        const o = { x: Math.round(num(q.x, 0, -1e6, 1e6)), y: Math.round(num(q.y, 0, -1e6, 1e6)), z: Math.round(num(q.z, 3, -4, 12) * 100) / 100,
          title: str(q.title, 120), text: str(q.text, 6000) };
        if (q.hour !== null && q.hour !== undefined && q.hour !== '' && Number.isFinite(+q.hour)) o.hour = Math.round(num(q.hour, 12, 0, 24) * 4) / 4;
        if (KINDS.has(q.weather)) o.weather = q.weather;
        if (q.borders) o.borders = true;
        if (q.pin) o.pin = true;
        if (Number.isFinite(+q.hold) && +q.hold > 0) o.hold = Math.round(num(q.hold, 10, 1, 600));
        return o;
      });
      return { id, title: str(t.title, 120) || 'A tale', about: str(t.about, 2000), gmOnly: !!t.gmOnly, stops };
    });
    return { tours };
  }
  const toursFor = adm => { const s = toursRead(); return { rev: s.rev || 0, tours: (s.tours || []).filter(t => adm || !t.gmOnly) }; };
  function saveTours(b, user) {
    const old = toursRead(), next = cleanTours(b);
    next.rev = (old.rev || 0) + 1; next.savedAt = now(); next.by = user ? user.id : null;
    try {   // the last 30 versions kept
      fs.mkdirSync(TOURS_BAK, { recursive: true });
      if (fs.existsSync(TOURS_FILE)) fs.copyFileSync(TOURS_FILE, path.join(TOURS_BAK, `tours-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const olds = fs.readdirSync(TOURS_BAK).filter(f => f.startsWith('tours-')).sort();
      for (const f of olds.slice(0, Math.max(0, olds.length - 30))) fs.unlinkSync(path.join(TOURS_BAK, f));
    } catch (e) { log('Tales backup: ' + e.message); }
    writeJSON(TOURS_FILE, next);
    return next;
  }

  // ───────── Wayfinder: the map game's scores (wayfinder.json) ─────────
  // Five places a game; the daily one is the same five for everyone (one go each, the first counts), free play keeps
  // the best scores ever. { days: { 'YYYY-MM-DD': [{ user, name, color, score, at }] }, best: [{ user, name, color, score, at }] }
  const WF_FILE = path.join(DIR, 'wayfinder.json');
  const wfRead = () => { const w = readJSON(WF_FILE, null) || {}; w.days = w.days && typeof w.days === 'object' ? w.days : {}; w.best = Array.isArray(w.best) ? w.best : []; return w; };
  const today = () => new Date().toISOString().slice(0, 10);
  function wfFor(user) {
    const w = wfRead(), d = today(), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const top = list => (list || []).slice().sort((a, b) => b.score - a.score).slice(0, 20).map(e => ({ name: e.name, color: e.color, score: e.score, at: e.at, me: !!user && e.user === user.id }));
    const mine = user ? (w.days[d] || []).find(e => e.user === user.id) : null;
    return { today: d, daily: top(w.days[d]), yesterday: top(w.days[y]).slice(0, 3), best: top(w.best).slice(0, 10), playedToday: mine ? mine.score : null };
  }
  const cleanEvent = (b, old) => ({ id: old ? old.id : uid('e'), t: Math.round(num(b.t, old ? old.t : calendar.t, -1e12, 1e12)), title: str(b.title, 120) || 'Event',
    text: str(b.text, 4000), gmOnly: !!b.gmOnly, yearly: !!b.yearly, by: old ? old.by : undefined });

  // ───────── reading the old map viewer's data files once ─────────
  function readJsData(file) {
    try {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const m = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(text);
      return m ? JSON.parse(m[1]) : null;
    } catch (e) { return null; }
  }

  // ───────── the world map ─────────
  const WORLD = path.join(DIR, 'world.json');
  let world = readJSON(WORLD, null);
  if (!world) {
    world = readJsData('data/markers.js') || { version: 1, savedAt: null, types: [], markers: [], unplaced: [], nations: [], borders: [], settings: {}, imports: [] };
    world.savedAt = world.savedAt || new Date().toISOString();
    writeJSON(WORLD, world);
    log('World map: copied in from data/markers.js (that file is left as it is)');
  }
  function saveWorld(data) {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    try { fs.copyFileSync(WORLD, path.join(DIR, 'world-backups', `world-${stamp}.json`)); } catch (e) { /* first save */ }
    const old = fs.readdirSync(path.join(DIR, 'world-backups')).filter(f => f.startsWith('world-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(DIR, 'world-backups', f));
    data.savedAt = new Date().toISOString();
    world = data;
    writeJSON(WORLD, world);
    return world.savedAt;
  }

  // ───────── the map's history, and putting two people's edits together ─────────
  // Each save is kept (a person's saves a few minutes apart count as one change in the list), with what it did in words.
  // An edit made from an older version than the one on the server is merged into it: only a thing both people changed
  // differently is a conflict, and the editor is asked about just those.
  const HIST = path.join(DIR, 'map-history');
  const hdir = key => path.join(HIST, String(key).replace(/[^a-z0-9]/gi, ''));
  const hfile = at => String(at || '').replace(/[^0-9]/g, '') + '.json';
  const histIndex = key => readJSON(path.join(hdir(key), 'index.json'), []);
  function histRaw(key, at, file) {
    const f = file || hfile(at), r = readJSON(path.join(hdir(key), f), null);
    if (r) return r.data;
    if (key === 'world' && at) {   // an older save, from before there was a history: the backups
      try { for (const b of fs.readdirSync(path.join(DIR, 'world-backups')).sort().reverse()) { const d = readJSON(path.join(DIR, 'world-backups', b), null); if (d && d.savedAt === at) return d; } } catch (e) { /* none */ }
    }
    return null;
  }
  function histRecord(key, before, beforeAt, after, afterAt, user, note) {
    const dir = hdir(key); fs.mkdirSync(dir, { recursive: true });
    if (before && beforeAt && !fs.existsSync(path.join(dir, hfile(beforeAt)))) writeJSON(path.join(dir, hfile(beforeAt)), { savedAt: beforeAt, data: before });
    writeJSON(path.join(dir, hfile(afterAt)), { savedAt: afterAt, data: after });
    const idx = histIndex(key), last = idx[idx.length - 1], by = user ? user.id : null;
    const same = !note && last && !last.note && last.by === by && Date.parse(afterAt) - Date.parse(last.savedAt) < 4 * 60e3 && last.file === hfile(beforeAt);
    const from = same ? last.from : beforeAt;
    const d = Merge.describe(from ? histRaw(key, from) : null, after);
    const entry = { file: hfile(afterAt), savedAt: afterAt, by, from, started: same ? last.started : afterAt, summary: note ? note + (d.changes.length ? ' (' + d.summary.toLowerCase() + ')' : '') : d.summary, count: d.changes.length, changes: d.changes.slice(0, 80) };
    if (note) entry.note = true;
    if (same) idx[idx.length - 1] = entry; else idx.push(entry);
    const keep = idx.slice(-80);
    // the files still wanted: each change's, the one before it, and the last 40 saves (the bases open pages may have)
    const want = new Set(); for (const e of keep) { want.add(e.file); if (e.from) want.add(hfile(e.from)); }
    try { const raws = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort(); for (const f of raws.slice(-40)) want.add(f); for (const f of raws) if (!want.has(f)) fs.unlinkSync(path.join(dir, f)); } catch (e) { /* tidy later */ }
    writeJSON(path.join(dir, 'index.json'), keep);
    return entry;
  }
  // an edit arriving from some version (base): saved as it is if it's from the latest, merged if not
  const plain = d => { const o = Object.assign({}, d); delete o.savedAt; return JSON.stringify(o); };
  function arrive(key, current, currentAt, b) {
    if (!b.base || !currentAt || b.base === currentAt || b.force) return { data: b.data };
    const base = histRaw(key, b.base);
    if (!base) return { stale: true };
    const r = Merge.map(base, current, b.data, b.resolve && typeof b.resolve === 'object' ? b.resolve : {});
    if (r.conflicts.length) return { conflicts: r.conflicts };
    return { data: Object.assign({ version: 1 }, r.data), merged: true };
  }

  // ───────── other versions of the world map (atlases) ─────────
  // A campaign's world map scene shows the main map, or one of these: a copy of the places, borders and names that the
  // GM changes for that time without touching the main map, over the main map's picture or another one (maps/<folder>,
  // made by make_tiles.bat). Anyone who can read the site can look at them; admins change them.
  const ATLAS_DIR = path.join(DIR, 'atlases');
  fs.mkdirSync(ATLAS_DIR, { recursive: true });
  const atlasFile = id => path.join(ATLAS_DIR, id.replace(/[^a-z0-9]/gi, '') + '.json');
  const atlasCache = new Map();
  function getAtlas(id) {
    if (!/^a[a-f0-9]{12}$/.test(String(id || ''))) return null;
    if (!atlasCache.has(id)) { const a = readJSON(atlasFile(id), null); if (!a) return null; atlasCache.set(id, a); }
    return atlasCache.get(id);
  }
  const listAtlases = () => fs.readdirSync(ATLAS_DIR).filter(f => /^a[a-f0-9]{12}\.json$/.test(f)).map(f => getAtlas(f.slice(0, -5))).filter(Boolean)
    .map(a => ({ id: a.id, name: a.name, tiles: a.tiles || '', savedAt: a.savedAt, created: a.created, places: (a.data.markers || []).length, year: Number.isFinite(a.year) ? a.year : null }))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  function saveAtlas(a) { a.savedAt = new Date().toISOString(); writeJSON(atlasFile(a.id), a); atlasCache.set(a.id, a); return a.savedAt; }
  // pictures made by make_tiles.bat as versions: maps/<folder>/mapinfo.js beside its tiles
  const MAPS_DIR = path.join(ROOT, 'maps');
  const cleanTiles = t => /^[a-z0-9_-]{1,60}$/i.test(String(t || '')) ? String(t) : '';
  function tileSets() {
    let dirs = [];
    try { dirs = fs.readdirSync(MAPS_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && cleanTiles(d.name) && fs.existsSync(path.join(MAPS_DIR, d.name, 'mapinfo.js'))).map(d => d.name); } catch (e) { /* no maps folder */ }
    return dirs.map(d => ({ id: d, name: d.replace(/[-_]+/g, ' ') }));
  }

  // ───────── the wiki ─────────
  const pages = new Map();   // id → page
  const BIN_DIR = path.join(DIR, 'wiki', 'bin');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const fileOf = new Map();  // id → the .md file it's in now
  // front matter: "key: <JSON>" per line (valid YAML too), between --- lines
  const FM_SKIP = new Set(['md']);
  function toMarkdownFile(p) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(p)) if (!FM_SKIP.has(k) && v !== undefined && v !== null && v !== '') lines.push(`${k}: ${JSON.stringify(v)}`);
    lines.push('---', '');
    return lines.join('\n') + (p.md || '');
  }
  function fromMarkdownFile(text, rel) {
    text = String(text).replace(/^\uFEFF/, '');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const meta = {};
    if (m) for (const line of m[1].split(/\r?\n/)) {
      const k = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line); if (!k) continue;
      try { meta[k[1]] = JSON.parse(k[2]); } catch (e) { meta[k[1]] = k[2].trim(); }
    }
    if (m && meta.id) return Object.assign(meta, { md: text.slice(m[0].length) });
    // a file someone put in by hand (from Obsidian, say): its own front matter stays part of its text
    const parts = rel.replace(/\.md$/i, '').split('/');
    const t = now();
    return { id: 'p' + crypto.randomBytes(6).toString('hex'), title: parts.pop(), folder: parts.join('/'), md: text, created: t, updated: t, by: 'file', rev: 1, source: 'file' };
  }
  const safeName = s => String(s || '').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 150) || 'Untitled';
  function walkMd(dir, rel, out) {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const d of list) {
      if (d.name.startsWith('.')) continue;
      const full = path.join(dir, d.name), r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) walkMd(full, r, out); else if (/\.md$/i.test(d.name)) out.push([full, r]);
    }
    return out;
  }
  const loadedNew = [];
  for (const [full, rel] of walkMd(WIKI_DIR, '', [])) {
    let p; try { p = fromMarkdownFile(fs.readFileSync(full, 'utf8'), rel); } catch (e) { log('Wiki: could not read', rel, e.message); continue; }
    if (pages.has(p.id)) { log('Wiki: two files have the page id', p.id, '(skipped', rel + ')'); continue; }
    pages.set(p.id, p); fileOf.set(p.id, full);
    if (p.source === 'file' && !/^id:/m.test(fs.readFileSync(full, 'utf8').slice(0, 400))) loadedNew.push(p);
  }
  for (const f of fs.readdirSync(BIN_DIR)) if (/\.md$/i.test(f)) {
    try { const p = fromMarkdownFile(fs.readFileSync(path.join(BIN_DIR, f), 'utf8'), f); if (p.id && !pages.has(p.id)) { pages.set(p.id, p); fileOf.set(p.id, path.join(BIN_DIR, f)); } } catch (e) { /* skip */ }
  }
  // older sites: wiki/pages/<id>.json → Markdown files, once
  const oldJson = fs.readdirSync(WIKI_DIR).filter(f => /^p[0-9a-f]+\.json$/i.test(f));
  if (oldJson.length) {
    const OLD = path.join(DIR, 'wiki', 'pages-json-old'); fs.mkdirSync(OLD, { recursive: true });
    let n = 0;
    for (const f of oldJson) {
      const p = readJSON(path.join(WIKI_DIR, f), null);
      if (p && p.id && !pages.has(p.id)) { pages.set(p.id, p); n++; }
      try { fs.renameSync(path.join(WIKI_DIR, f), path.join(OLD, f)); } catch (e) { /* leave it */ }
    }
    setImmediate(() => { for (const p of pages.values()) if (!fileOf.has(p.id)) savePage(p); });
    log(`Wiki: ${n} pages are now Markdown files in ${WIKI_DIR} (the old .json files are in wiki/pages-json-old)`);
  }
  if (loadedNew.length) setImmediate(() => { for (const p of loadedNew) savePage(p); log(`Wiki: ${loadedNew.length} new page(s) from .md files put in by hand`); });
  const cleanFolder = f => String(f || '').split('/').map(s => s.trim().replace(/[\\<>:"|?*\u0000-\u001f]/g, '').slice(0, 80)).filter(s => s && s !== '.' && s !== '..').join('/');
  const cleanTitle = t => String(t || '').replace(/[\/\\<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  const pathOf = p => (p.folder ? p.folder + '/' : '') + p.title;
  // a page's file: wiki/pages/<folder>/<title>.md (a second page of the same name in the same folder gets its id
  // on the end), or wiki/bin/<id>.md while it's in the bin; a renamed or moved page's old file goes
  function wantedFile(p) {
    if (p.deleted) return path.join(BIN_DIR, p.id + '.md');
    const dir = path.join(WIKI_DIR, ...String(p.folder || '').split('/').filter(Boolean).map(safeName));
    let f = path.join(dir, safeName(p.title) + '.md');
    const other = [...fileOf.entries()].find(([id, file]) => id !== p.id && file.toLowerCase() === f.toLowerCase());
    if (other) f = path.join(dir, safeName(p.title) + ' (' + p.id + ').md');
    return f;
  }
  function savePage(p) {
    const f = wantedFile(p), was = fileOf.get(p.id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, toMarkdownFile(p)); fs.renameSync(tmp, f);
    if (was && was !== f) { try { fs.unlinkSync(was); } catch (e) { /* gone */ } pruneEmpty(path.dirname(was)); }
    fileOf.set(p.id, f);
  }
  function pruneEmpty(dir) {   // an emptied folder goes too (not the pages folder itself)
    while (dir.startsWith(WIKI_DIR) && dir !== WIKI_DIR) { try { if (fs.readdirSync(dir).length) return; fs.rmdirSync(dir); } catch (e) { return; } dir = path.dirname(dir); }
  }
  function removePageFile(id) { const f = fileOf.get(id); if (f) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } pruneEmpty(path.dirname(f)); fileOf.delete(id); } }
  function addRevision(p) {   // the version being replaced
    const file = path.join(REVS_DIR, p.id + '.jsonl');
    fs.appendFileSync(file, JSON.stringify({ rev: p.rev, title: p.title, folder: p.folder, md: p.md, updated: p.updated, by: p.by, summary: p.summary || '' }) + '\n');
    try {   // keep the last 100
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 110) fs.writeFileSync(file, lines.slice(-100).join('\n') + '\n');
    } catch (e) { /* fine */ }
  }
  const revisions = id => { try { return fs.readFileSync(path.join(REVS_DIR, id + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
  const titleTaken = (title, folder, except) => [...pages.values()].some(p => !p.deleted && p.id !== except && p.title.toLowerCase() === title.toLowerCase() && (p.folder || '') === (folder || ''));
  if (!pages.size) {
    const old = readJsData('data/wiki.js');
    for (const op of (old && old.pages) || []) {
      const parts = String(op.path || '').split('/');
      const p = { id: uid('p'), title: cleanTitle(parts.pop()) || 'Page', folder: cleanFolder(parts.join('/')), md: String(op.md || ''), gmOnly: false, created: now(), updated: now(), by: null, rev: 1 };
      pages.set(p.id, p); savePage(p);
    }
    if (pages.size) log(`Wiki: copied in ${pages.size} pages from data/wiki.js (that file is left as it is)`);
  }
  // GM-only parts of a page: {{gm}} … {{/gm}}
  const stripGM = md => String(md).replace(/\{\{\s*gm\s*\}\}[\s\S]*?\{\{\s*\/\s*gm\s*\}\}/gi, '');
  // the start of a page as plain text (for the drive's page tiles)
  const excerpt = md => String(md).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>`|\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  // the page's first picture (a Markdown image, or an infobox's image field), for its preview card
  const pictureOf = md => { const m = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/.exec(md) || /\|\s*image\s*=\s*([^|}\n]+)/i.exec(md); if (!m) return undefined; const u = m[1].trim(); return u.slice(0, 600) || undefined; };   // a link, or a file's name (the browser looks it up)
  const userName = id => { const u = id && db.users.find(x => x.id === id); return u ? u.name : null; };
  const canSeeFolder = (folder, admin) => admin || !drive.folders.some(f => f.gmOnly && (folder === f.path || folder.startsWith(f.path + '/')));
  const pageFor = (p, admin) => ({ id: p.id, path: pathOf(p), title: p.title, folder: p.folder || '', md: admin ? p.md : stripGM(p.md), gmOnly: !!p.gmOnly,
    updated: p.updated, by: userName(p.by), rev: p.rev, deleted: p.deleted || undefined, source: admin ? p.source : undefined });
  // folders a player sees: those with something they can see somewhere inside (empty or all-secret folders stay hidden)
  const visibleFolders = admin => {
    if (admin) return drive.folders;
    const used = new Set();
    const mark = f => { const parts = (f || '').split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) used.add(parts.slice(0, i).join('/')); };
    for (const p of visiblePages(false)) mark(p.folder);
    for (const f of drive.files) if (!f.deleted && !f.gmOnly && canSeeFolder(f.folder || '', false)) mark(f.folder);
    return drive.folders.filter(f => used.has(f.path) && canSeeFolder(f.path, false));
  };
  const visiblePages = admin => [...pages.values()].filter(p => (admin || (!p.deleted && !p.gmOnly && canSeeFolder(p.folder || '', false))) && (admin || !p.deleted));

  // ───────── the drive ─────────
  const DRIVE = path.join(DIR, 'drive.json');
  const drive = Object.assign({ folders: [], files: [] }, readJSON(DRIVE, {}));
  const saveDrive = () => writeJSON(DRIVE, drive);
  const FILE_TYPES = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
    'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/flac': 'flac', 'audio/webm': 'weba',
    'video/mp4': 'mp4', 'video/webm': 'webm',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip', 'application/x-zip-compressed': 'zip'
  };
  const MAX_FILE = 200 * 1024 * 1024;
  const fileFor = (f, admin) => ({ id: f.id, name: f.name, folder: f.folder || '', type: f.type, size: f.size, gmOnly: !!f.gmOnly, created: f.created, by: userName(f.by),
    url: `/files/${f.id}/${encodeURIComponent(f.name)}`, deleted: admin ? f.deleted || undefined : undefined });
  const ensureFolders = folder => {   // a folder and its parents exist in the list
    const parts = cleanFolder(folder).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); if (!drive.folders.some(f => f.path === p)) drive.folders.push({ path: p, gmOnly: false }); }
  };
  for (const p of pages.values()) if (p.folder) ensureFolders(p.folder);
  saveDrive();

  // ───────── converting documents into wiki pages ─────────
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);
  const titleCase = s => s.toLowerCase().replace(/\S+/g, (w, i) => (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  const gdocId = url => (/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(url || '') || [])[1] || null;
  /* Markdown from Google Docs (File > Download > Markdown, or fetched by link) or anything similar, made into a wiki
   * page: the first bold line becomes the title; blocks of "**Field** - value" lines (continued on indented lines)
   * become an infobox, named by a "**Name** - X" heading above them; links to other Google Docs that are already
   * pages become wiki links. */
  function docToWiki(md, fallbackTitle) {
    let lines = String(md).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
    let title = '';
    // a bold-only first line is the document's title
    const first = lines.findIndex(l => l.trim());
    if (first >= 0) {
      const m = /^\s*(?:#\s*)?\*\*(.+?)\*\*\s*$/.exec(lines[first]);
      if (m) { title = m[1].trim(); lines.splice(first, 1); }
      else if (/^#\s+/.test(lines[first]) && !/\\-/.test(lines[first])) { title = lines[first].replace(/^#\s+/, '').replace(/\*\*/g, '').trim(); lines.splice(first, 1); }
    }
    if (title && title === title.toUpperCase()) title = titleCase(title);
    // headings: no bold inside; one level down when the document uses top-level headings (the page title is the top)
    const demote = lines.some(l => /^#\s/.test(l));
    const FIELD = /^\s*\*\*([^*\n]{1,40}?)\*\*\s*(?:\\?[-–—:])\s*(.*?)\s*$/;
    const out = [];
    // a heading right at the top (before any text) is the page's short description, as on Wikipedia
    const top = lines.findIndex(l => l.trim());
    if (top >= 0 && /^#{1,6}\s/.test(lines[top]) && !/name\s*\\?[-–—:]/i.test(lines[top])) {
      out.push(`{{Short description|${lines[top].replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()}}}`, '');
      lines.splice(top, 1);
      const rule = lines.findIndex(l => l.trim());
      if (rule >= 0 && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[rule])) lines.splice(rule, 1);
    }
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      const hm = /^(#{1,6})\s+(.*)$/.exec(l);
      if (hm) {
        let text = hm[2].replace(/\*\*/g, '').replace(/\\-/g, '-').trim();
        let name = null;
        const nm = /^name\s*[-–—:]\s*(.*)$/i.exec(text);
        if (nm) { name = nm[1].trim(); text = name || 'Unnamed'; }
        out.push('#'.repeat(Math.min(6, hm[1].length + (demote ? 1 : 0))) + ' ' + text);
        // an infobox right under it?
        let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        const rows = [];
        while (j < lines.length) {
          const fm = FIELD.exec(lines[j]);
          if (fm) { rows.push([fm[1].trim(), fm[2].replace(/\\-/g, '-').trim()]); j++; continue; }
          if (rows.length && /^(\t| {2,})\S/.test(lines[j])) { rows[rows.length - 1][1] += '<br>' + lines[j].trim().replace(/\\-/g, '-'); j++; continue; }
          break;
        }
        if (rows.length >= 2) {
          const filled = rows.filter(([, v]) => v.replace(/<br>/g, '').trim());
          out.push('', '{{Infobox', `| name = ${name || text}`, ...filled.map(([k, v]) => `| ${k} = ${v.replace(/\s{2,}$/, '')}`), '}}');
          i = j - 1;
        }
        continue;
      }
      out.push(l.replace(/\s{2,}$/, ''));   // Google's two-space line breaks
    }
    let body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    // links to Google Docs that are already pages here
    body = body.replace(/\[([^\]]+)\]\((https?:\/\/docs\.google\.com\/document\/[^)\s]+)\)/g, (all, text, url) => {
      const id = gdocId(url), p = id && [...pages.values()].find(x => !x.deleted && x.source && x.source.google === id);
      const t = text.replace(/^\*+|\*+$/g, '').replace(/\.$/, '').trim();
      return p ? `[[${pathOf(p)}|${t}]]` : all;
    });
    return { title: cleanTitle(title || fallbackTitle || 'Imported page'), md: body };
  }
  // when a doc becomes a page, links to it elsewhere become wiki links
  function relinkGoogle(p) {
    const id = p.source && p.source.google; if (!id) return;
    for (const q of pages.values()) {
      if (q === p || q.deleted || !q.md.includes(id)) continue;
      const md = q.md.replace(/\[([^\]]+)\]\((https?:\/\/docs\.google\.com\/document\/[^)\s]+)\)/g, (all, text, url) => gdocId(url) === id ? `[[${pathOf(p)}|${text.replace(/^\*+|\*+$/g, '').trim()}]]` : all);
      if (md !== q.md) { addRevision(q); q.md = md; q.rev++; q.updated = now(); q.summary = `Linked to ${p.title}`; savePage(q); }
    }
  }
  // .docx (Word, or Google Docs' Download > Word): headings, bold and italic, lists, links, tables
  function unzip(buf, want) {
    want = want || (name => /^word\/(document\.xml|_rels\/document\.xml\.rels)$/.test(name));
    const files = {};
    let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a .docx file');
    const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
    for (let i = 0; i < count; i++) {
      const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nlen);
      const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28), start = off + 30 + lnlen + lxlen;
      const data = buf.subarray(start, start + csize);
      if (want(name)) files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
      p += 46 + nlen + xlen + clen;
    }
    return files;
  }
  function docxToMarkdown(buf) {
    const f = unzip(buf), xml = (f['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
    const rels = {}; for (const m of (f['word/_rels/document.xml.rels'] || '').toString('utf8').matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2];
    const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const runs = px => {
      let out = '';
      for (const part of px.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
        if (part[2] != null) { const id = (/r:id="([^"]+)"/.exec(part[1]) || [])[1]; const t = runs(part[2]); out += rels[id] ? `[${t}](${rels[id]})` : t; continue; }
        const r = part[3];
        const blip = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(r) || /<v:imagedata\b[^>]*r:id="([^"]+)"/.exec(r);
        if (blip && rels[blip[1]]) { out += `\n\n![](docx-media:${rels[blip[1]].replace(/^\/?(word\/)?/, '')})\n\n`; continue; }
        const t = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map(x => x[1] != null ? ent(x[1]) : x[0] === '<w:tab/>' ? '\t' : '  \n').join('');
        if (!t) continue;
        const b = /<w:b(?:\s+w:val="(?:1|true)")?\/>/.test(r), i = /<w:i(?:\s+w:val="(?:1|true)")?\/>/.test(r);
        const lead = /^\s*/.exec(t)[0], trail = /\s*$/.exec(t)[0], core = t.trim();
        out += core ? lead + (b && i ? `***${core}***` : b ? `**${core}**` : i ? `*${core}*` : core) + trail : t;
      }
      return out.replace(/\*\*\*\*/g, '');
    };
    const out = [];
    for (const blk of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:tbl>([\s\S]*?)<\/w:tbl>/g)) {
      if (blk[2] != null) {
        const rows = [...blk[2].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(r => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(c => [...c[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(p => runs(p[1]).trim()).filter(Boolean).join('<br>').replace(/\|/g, '\\|').trim()));
        if (rows.length) { out.push('', '| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => '---|').join(''), ...rows.slice(1).map(r => '| ' + r.join(' | ') + ' |'), ''); }
        continue;
      }
      const px = blk[1], style = (/<w:pStyle w:val="([^"]+)"/.exec(px) || [])[1] || '';
      const text = runs(px);
      const hl = /^(?:Heading|heading)\s?(\d)$/.exec(style) || (style === 'Title' ? [0, '1'] : null);
      if (hl) out.push('', '#'.repeat(+hl[1]) + ' ' + text.replace(/\*\*/g, '').trim(), '');
      else if (/<w:numPr>/.test(px)) out.push('- ' + text.trim());
      else out.push(text, '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // ───────── pictures inside an imported document → Files › Wiki pictures › <document> ─────────
  const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };
  function keepImage(buf, type, name, folder, user) {
    const f = { id: uid('f'), name, folder: cleanFolder(folder), type, size: buf.length, gmOnly: false, created: now(), by: user.id };
    fs.writeFileSync(path.join(FILES_DIR, f.id), buf);
    drive.files.push(f); ensureFolders(f.folder);
    return fileFor(f, true).url;
  }
  // data: pictures (Google Docs' Markdown keeps them in the file), Word's own pictures (docx-media: placeholders from
  // docxToMarkdown) and Google's temporary picture links all become files on this site, linked from the page
  async function pullImages(md, user, title, media) {
    const folder = 'Wiki pictures/' + (cleanTitle(title || 'Imported') || 'Imported');
    let n = 0, skipped = 0;
    const base = (cleanTitle(title || 'picture') || 'picture').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'picture';
    const fromData = uri => {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(uri.trim()); if (!m) return null;
      const type = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
      if (!FILE_TYPES[type]) { skipped++; return null; }
      return keepImage(Buffer.from(m[2].replace(/\s+/g, ''), 'base64'), type, `${base}-${++n}.${FILE_TYPES[type]}`, folder, user);
    };
    // reference-style pictures: ![alt][image1] … [image1]: <data:image/png;base64,…>
    const refs = {};
    md = md.replace(/^\s*\[([^\]\n]+)\]:\s*<?(data:image\/[^>\s]+(?:\s[^>\n]*)?)>?\s*$/gim, (all, k, uri) => { refs[k.toLowerCase()] = uri; return ''; });
    const urlFor = new Map();
    const resolve = uri => { if (!urlFor.has(uri)) urlFor.set(uri, fromData(uri)); return urlFor.get(uri); };
    md = md.replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (all, alt, k) => { const uri = refs[k.toLowerCase()]; const u = uri && resolve(uri); return u ? `![${alt}](${u})` : alt ? `*${alt}*` : ''; });
    md = md.replace(/!\[([^\]]*)\]\(<?(data:image\/[^)>]+)>?\)/g, (all, alt, uri) => { const u = resolve(uri); return u ? `![${alt}](${u})` : ''; });
    // Word's pictures
    if (media) md = md.replace(/!\[([^\]]*)\]\(docx-media:([^)]+)\)/g, (all, alt, p) => {
      const buf = media['word/' + p] || media[p]; const ext = p.split('.').pop().toLowerCase(), type = IMG_TYPES[ext];
      if (!buf || !type) { skipped++; return ''; }
      return `![${alt}](${keepImage(buf, type, `${base}-${++n}.${FILE_TYPES[type]}`, folder, user)})`;
    });
    // Google's picture links stop working after a while: fetch them now
    const remote = [...new Set([...md.matchAll(/!\[[^\]]*\]\((https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^)\s]+)\)/gi)].map(m => m[1]))];
    for (const u of remote) {
      try {
        const r = await fetch(u, { redirect: 'follow' }); if (!r.ok) throw new Error(r.status);
        const type = String(r.headers.get('content-type') || '').split(';')[0].toLowerCase();
        if (!FILE_TYPES[type] || !type.startsWith('image/')) throw new Error(type);
        const url = keepImage(Buffer.from(await r.arrayBuffer()), type, `${base}-${++n}.${FILE_TYPES[type]}`, folder, user);
        md = md.split(u).join(url);
      } catch (e) { skipped++; }
    }
    if (n) saveDrive();
    return { md, pictures: n, skipped };
  }

  // ───────── a .zip (stored, no compression needed): backups and Markdown export ─────────
  const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function zipStream(res, name, entries) {   // entries: [{ name, data: Buffer } | { name, file }]
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    const central = []; let off = 0;
    const dosTime = (() => { const d = new Date(); return [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())]; })();
    for (const e of entries) {
      const data = e.data || fs.readFileSync(e.file), nm = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8'), crc = crc32(data);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(dosTime[0], 10); h.writeUInt16LE(dosTime[1], 12);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
      res.write(h); res.write(nm); res.write(data);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(dosTime[0], 12); c.writeUInt16LE(dosTime[1], 14);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      central.push(Buffer.concat([c, nm]));
      off += 30 + nm.length + data.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    res.end(Buffer.concat([cd, end]));
  }
  const walk = (dir, base = '') => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name), base + d.name + '/') : [{ name: base + d.name, file: path.join(dir, d.name) }]) : [];

  // ───────── icons for the map ─────────
  let iconCache = null;
  function scanIcons() {
    const out = [];
    const go = (dir, prefix) => { if (!fs.existsSync(dir)) return; for (const d of fs.readdirSync(dir, { withFileTypes: true })) { if (d.isDirectory()) go(path.join(dir, d.name), prefix + d.name + '/'); else if (/\.(png|webp|svg|jpe?g)$/i.test(d.name)) out.push(prefix + d.name); } };
    go(path.join(ROOT, 'icons'), 'icons/');
    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const f of drive.files) if (!f.deleted && /^image\//.test(f.type) && (f.folder || '').split('/')[0].toLowerCase() === 'map icons') out.push(`files/${f.id}/${encodeURIComponent(f.name)}`);
    iconCache = out;
    return out;
  }

  // ───────── requests ─────────
  // generated scripts: the browser keeps them and asks each time whether they've changed (a 304 when they haven't)
  const js = (res, text) => S.sendBody(res.req, res, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, no-cache' }, text, { etag: true });
  const deny = (res, admin) => sendJSON(res, admin ? 404 : 403, { error: admin ? 'Not found' : 'Only an admin can do that' });
  // Requests for the site. Returns true when it answered.
  // when the map was last cut into tiles: added to the tiles' addresses, so browsers fetch new ones after make_tiles
  // instead of mixing in the old ones they kept (tiles are cached for a day)
  function tilesVersion() {
    let t = 0;
    for (const f of ['mapinfo.js', 'tiles/blank.png', 'tiles/0/0/0.webp', 'tiles/0/0/0.png', 'tiles/0/0/0.jpg', 'tiles/0']) {
      try { t = Math.max(t, fs.statSync(path.join(ROOT, f)).mtimeMs); } catch (e) { /* not there */ }
    }
    return t ? Math.round(t / 1000).toString(36) : '';
  }
  async function handle(req, res, user, p) {
    const m = req.method, admin = !!user && isGM(user);
    const st = settings();
    const canRead = !!user || st.publicView;
    let mm;
    // the page asks who's looking (and the site's name)
    if (p === '/api/session.js') {
      return js(res, 'window.VALANAR_SERVER = ' + JSON.stringify({ admin, user: user ? publicUser(user) : null, siteName: st.siteName, tagline: st.tagline, tilesV: tilesVersion(),
        mainPage: st.mainPage, publicView: !!st.publicView, private: st.private }) + ';\n'), true;
    }
    // the map as a visitor sees it: no armies the GM hasn't shown (app/armies.js)
    const forViewer = d => admin || !d || !Array.isArray(d.armies) ? d : Object.assign({}, d, { armies: d.armies.filter(a => a && a.shown !== false) });
    // the map viewer's data files, now from here
    if (p === '/data/markers.js') {
      if (!canRead) return sendJSON(res, 401, { error: 'Log in first' }), true;
      const aid = new URL(req.url, 'http://x').searchParams.get('atlas');
      if (aid) {
        const a = getAtlas(aid);
        if (!a) return js(res, 'window.VALANAR_DATA = null; window.VALANAR_ATLAS = null;\n'), true;
        return js(res, `// "${a.name}": a version of the world map (vtt-data/site/atlases/${a.id}.json).\nwindow.VALANAR_ATLAS = ` + JSON.stringify({ id: a.id, name: a.name, tiles: a.tiles || '' })
          + ';\nwindow.VALANAR_DATA = ' + JSON.stringify(forViewer(Object.assign({}, a.data, { savedAt: a.savedAt }))) + ';\n'), true;
      }
      return js(res, '// The world map, from the server (vtt-data/site/world.json).\nwindow.VALANAR_DATA = ' + JSON.stringify(forViewer(world)) + ';\n'), true;
    }
    if (p === '/data/wiki.js') {
      if (!canRead) return sendJSON(res, 401, { error: 'Log in first' }), true;
      return js(res, 'window.VALANAR_WIKI = ' + JSON.stringify({ server: true, pages: visiblePages(admin).filter(x => !x.deleted).map(x => pageFor(x, admin)),
        folders: visibleFolders(admin) }) + ';\n'), true;
    }
    if (p === '/data/icons.js') {
      if (!canRead) return sendJSON(res, 401, { error: 'Log in first' }), true;
      return js(res, 'window.VALANAR_ICONS = ' + JSON.stringify(iconCache || scanIcons()) + ';\n'), true;
    }
    // uploaded files
    if ((mm = /^\/files\/([a-z0-9]+)(?:\/.*)?$/i.exec(p))) {
      const f = drive.files.find(x => x.id === mm[1]);
      if (!f || !canRead || ((f.deleted || f.gmOnly || !canSeeFolder(f.folder || '', false)) && !admin)) { res.writeHead(404); res.end('Not found'); return true; }
      res.setHeader('Content-Disposition', `${/^(image|audio|video)\/|^application\/pdf$|^text\//.test(f.type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      if (f.type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      serveFile(req, res, path.join(FILES_DIR, f.id), f.type);
      return true;
    }
    if (!p.startsWith('/api/site/')) return false;
    const q = p.slice('/api/site'.length);
    if (m !== 'GET' && !S.sameOrigin(req)) return sendJSON(res, 403, { error: 'Bad origin' }), true;
    if (!canRead) return sendJSON(res, 401, { error: 'Log in first' }), true;

    // ── the map
    if (q === '/world' && m === 'PUT') {
      if (!admin) return deny(res), true;
      const b = JSON.parse((await readBody(req, 64 * 1024 * 1024)).toString('utf8') || '{}');
      if (!b.data || !Array.isArray(b.data.markers)) return sendJSON(res, 400, { error: 'No map data' }), true;
      const key = b.atlas ? b.atlas : 'world';
      const a = b.atlas ? getAtlas(b.atlas) : null; if (b.atlas && !a) return sendJSON(res, 404, { error: 'That version of the map is gone' }), true;
      const cur = a ? a.data : world, curAt = a ? a.savedAt : world.savedAt;
      if (plain(b.data) === plain(cur)) return sendJSON(res, 200, { savedAt: curAt }), true;   // nothing new
      const r = arrive(key, cur, curAt, b);
      if (r.stale) return sendJSON(res, 409, { error: 'The map was saved from somewhere else since this page loaded', savedAt: curAt }), true;
      if (r.conflicts) return sendJSON(res, 409, { error: 'You and someone else changed the same things', conflicts: r.conflicts, savedAt: curAt }), true;
      const before = JSON.parse(JSON.stringify(cur)); delete before.savedAt;
      let at;
      if (a) { delete r.data.savedAt; a.data = r.data; at = saveAtlas(a); } else at = saveWorld(r.data);
      const after = JSON.parse(JSON.stringify(r.data)); delete after.savedAt;
      const entry = histRecord(key, before, curAt, after, at, user, b.note ? str(b.note, 120) : null);
      if (S.worldSaved) S.worldSaved({ key, savedAt: at, by: user.name, uid: user.id, summary: entry.summary });
      return sendJSON(res, 200, Object.assign({ savedAt: at, summary: entry.summary }, r.merged ? { merged: true, data: r.data } : {})), true;
    }
    // ── the map as it is now (an open page catching up with someone else's save)
    if (q === '/world/current' && m === 'GET') {
      const aid = new URL(req.url, 'http://x').searchParams.get('atlas');
      if (aid) { const a = getAtlas(aid); if (!a) return sendJSON(res, 404, { error: 'No such map' }), true; return sendJSON(res, 200, { savedAt: a.savedAt, data: forViewer(Object.assign({}, a.data, { savedAt: a.savedAt })) }), true; }
      return sendJSON(res, 200, { savedAt: world.savedAt, data: forViewer(world) }), true;
    }
    // ── the map's history: what changed, when, by whom; any of them can be put back
    if (q === '/world/history' && m === 'GET') {
      const key = new URL(req.url, 'http://x').searchParams.get('atlas') || 'world';
      if (key !== 'world' && !getAtlas(key)) return sendJSON(res, 404, { error: 'No such map' }), true;
      return sendJSON(res, 200, { entries: histIndex(key).slice().reverse().map(e => Object.assign({}, e, { byName: userName(e.by) || (e.by ? 'someone' : null) })) }), true;
    }
    if ((mm = /^\/world\/history\/(\d+\.json)$/.exec(q)) && m === 'GET') {
      const d = histRaw(new URL(req.url, 'http://x').searchParams.get('atlas') || 'world', null, mm[1]);
      return d ? sendJSON(res, 200, { data: forViewer(d) }) : sendJSON(res, 404, { error: 'That version is gone' }), true;
    }
    if (q === '/world/restore' && m === 'POST') {
      if (!admin) return deny(res), true;
      const b = await bodyJSON(req), key = b.atlas || 'world';
      const a = b.atlas ? getAtlas(b.atlas) : null; if (b.atlas && !a) return sendJSON(res, 404, { error: 'No such map' }), true;
      const ent = histIndex(key).find(e => e.file === b.file), d = ent && histRaw(key, null, ent.file);
      if (!d) return sendJSON(res, 404, { error: 'That version is gone' }), true;
      const cur = a ? a.data : world, curAt = a ? a.savedAt : world.savedAt;
      const before = JSON.parse(JSON.stringify(cur)); delete before.savedAt;
      const data = JSON.parse(JSON.stringify(d)); delete data.savedAt;
      let at; if (a) { a.data = data; at = saveAtlas(a); } else at = saveWorld(Object.assign({ version: 1 }, data));
      const when = new Date(ent.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const e2 = histRecord(key, before, curAt, data, at, user, `Put back the map as it was on ${when}`);
      if (S.worldSaved) S.worldSaved({ key, savedAt: at, by: user.name, uid: user.id, summary: e2.summary });
      return sendJSON(res, 200, { savedAt: at, data: a ? a.data : world }), true;
    }
    // ── versions of the map
    if (q === '/atlases' && m === 'GET') return sendJSON(res, 200, { atlases: listAtlases(), tileSets: tileSets() }), true;
    if (q === '/atlases' && m === 'POST') {
      if (!admin) return deny(res), true;
      const b = await bodyJSON(req);
      const src = b.from && b.from !== 'main' ? getAtlas(b.from) : null;
      const base = src ? src.data : world;
      let data = JSON.parse(JSON.stringify(base)); delete data.savedAt;
      if (b.from === 'empty') data = Object.assign({}, data, { markers: [], unplaced: [], nations: [], borders: [], routes: [], labels: [], armies: [], imports: [] });
      const a = { id: uid('a'), name: str(b.name, 80).trim() || 'Another time', tiles: cleanTiles('tiles' in b ? b.tiles : src ? src.tiles : ''), created: now(), by: user.id, data };
      saveAtlas(a);
      return sendJSON(res, 200, { atlas: { id: a.id, name: a.name, tiles: a.tiles }, atlases: listAtlases() }), true;
    }
    if ((mm = /^\/atlases\/(a[a-f0-9]{12})\/world$/.exec(q)) && m === 'GET') {   // its places, borders and names, for Through the ages
      const a = getAtlas(mm[1]); if (!a) return sendJSON(res, 404, { error: 'No such map' }), true;
      return sendJSON(res, 200, { atlas: { id: a.id, name: a.name, tiles: a.tiles || '', year: Number.isFinite(a.year) ? a.year : null }, data: a.data }), true;
    }
    if ((mm = /^\/atlases\/(a[a-f0-9]{12})$/.exec(q))) {
      const a = getAtlas(mm[1]); if (!a) return sendJSON(res, 404, { error: 'No such map' }), true;
      if (m === 'GET') return sendJSON(res, 200, { atlas: { id: a.id, name: a.name, tiles: a.tiles || '', savedAt: a.savedAt, year: Number.isFinite(a.year) ? a.year : null } }), true;
      if (!admin) return deny(res), true;
      if (m === 'PUT') {
        const b = await bodyJSON(req);
        if ('name' in b) a.name = str(b.name, 80).trim() || a.name;
        if ('tiles' in b) a.tiles = cleanTiles(b.tiles);
        // the year it shows, for Through the ages on the main map (null: not on the timeline)
        if ('year' in b) a.year = b.year === null || b.year === '' || !Number.isFinite(+b.year) ? null : Math.round(Math.max(-1e6, Math.min(1e6, +b.year)));
        saveAtlas(a);
      } else if (m === 'DELETE') {
        try { fs.renameSync(atlasFile(a.id), atlasFile(a.id).replace(/\.json$/, `.deleted-${Date.now()}.json`)); } catch (e) { /* gone already */ }
        atlasCache.delete(a.id);
      }
      return sendJSON(res, 200, { atlases: listAtlases() }), true;
    }
    if (q === '/icons' && m === 'POST') { if (!admin) return deny(res), true; return sendJSON(res, 200, { icons: scanIcons() }), true; }

    // ── the wiki
    if (q === '/wiki' && m === 'GET') return sendJSON(res, 200, { pages: visiblePages(admin).map(x => pageFor(x, admin)), folders: visibleFolders(admin) }), true;
    if (q === '/wiki' && m === 'POST') {
      if (!admin) return deny(res), true;
      const b = await bodyJSON(req, 4e6);
      const title = cleanTitle(b.title), folder = cleanFolder(b.folder);
      if (!title) return sendJSON(res, 400, { error: 'Give the page a title' }), true;
      if (titleTaken(title, folder)) return sendJSON(res, 400, { error: `There's already a page called “${title}” in that folder` }), true;
      const pg = { id: uid('p'), title, folder, md: str(b.md, 2e6), gmOnly: !!b.gmOnly, created: now(), updated: now(), by: user.id, rev: 1, summary: str(b.summary, 200) || 'Created' };
      if (b.source && b.source.google) pg.source = { google: str(b.source.google, 80) };
      pages.set(pg.id, pg); ensureFolders(folder); saveDrive(); savePage(pg); relinkGoogle(pg);
      return sendJSON(res, 200, { page: pageFor(pg, true) }), true;
    }
    if ((mm = /^\/wiki\/(p[a-f0-9]{12})(\/history(?:\/(\d+))?|\/restore)?$/.exec(q))) {
      const pg = pages.get(mm[1]);
      if (!pg || (!admin && (pg.deleted || pg.gmOnly))) return sendJSON(res, 404, { error: 'No such page' }), true;
      if (mm[2] && mm[2].startsWith('/history')) {
        if (!admin) return deny(res), true;
        const revs = revisions(pg.id).map(r => Object.assign(r, { by: userName(r.by) }));
        if (mm[3]) { const r = revs.find(x => x.rev === +mm[3]); return r ? sendJSON(res, 200, { rev: r }) : sendJSON(res, 404, { error: 'No such version' }), true; }
        return sendJSON(res, 200, { current: { rev: pg.rev, updated: pg.updated, by: userName(pg.by), summary: pg.summary || '' }, revs: revs.reverse().map(r => ({ rev: r.rev, updated: r.updated, by: r.by, summary: r.summary, size: (r.md || '').length })) }), true;
      }
      if (mm[2] === '/restore' && m === 'POST') { if (!admin) return deny(res), true; delete pg.deleted; if (pg.folder) { ensureFolders(pg.folder); saveDrive(); } savePage(pg); return sendJSON(res, 200, { page: pageFor(pg, true) }), true; }
      if (m === 'GET') return sendJSON(res, 200, { page: pageFor(pg, admin) }), true;
      if (!admin) return deny(res), true;
      if (m === 'PUT') {
        const b = await bodyJSON(req, 4e6);
        if (b.baseRev && b.baseRev !== pg.rev && !b.force) return sendJSON(res, 409, { error: 'Someone saved this page since you started editing', rev: pg.rev }), true;
        const title = 'title' in b ? cleanTitle(b.title) : pg.title, folder = 'folder' in b ? cleanFolder(b.folder) : pg.folder;
        if (!title) return sendJSON(res, 400, { error: 'Give the page a title' }), true;
        if (titleTaken(title, folder, pg.id)) return sendJSON(res, 400, { error: `There's already a page called “${title}” in that folder` }), true;
        const contentChange = ('md' in b && b.md !== pg.md) || title !== pg.title || folder !== (pg.folder || '');
        if (contentChange) addRevision(pg);
        const oldPath = pathOf(pg);
        pg.title = title; pg.folder = folder;
        if ('md' in b) pg.md = str(b.md, 2e6);
        if ('gmOnly' in b) pg.gmOnly = !!b.gmOnly;
        if (contentChange) { pg.rev++; pg.updated = now(); pg.by = user.id; pg.summary = str(b.summary, 200); }
        ensureFolders(folder); saveDrive(); savePage(pg);
        // a moved or renamed page: links to its old full path follow it
        if (oldPath !== pathOf(pg)) for (const o of pages.values()) {
          if (o === pg || !o.md.includes('[[' + oldPath)) continue;
          o.md = o.md.split('[[' + oldPath).join('[[' + pathOf(pg)); savePage(o);
        }
        return sendJSON(res, 200, { page: pageFor(pg, true) }), true;
      }
      if (m === 'DELETE') {
        const purge = new URL(req.url, 'http://x').searchParams.has('purge');
        if (purge) { pages.delete(pg.id); removePageFile(pg.id); }
        else { pg.deleted = now(); savePage(pg); }
        return sendJSON(res, 200, {}), true;
      }
    }
    if (q === '/wiki/import' && m === 'POST') {   // a document → a draft page (saved when the admin presses Save)
      if (!admin) return deny(res), true;
      const type = String(req.headers['content-type'] || '').split(';')[0];
      // the document's pictures go in first (under its title), then it becomes a page
      const convert = async (text, base, extra, media) => {
        const title = docToWiki(text.replace(/data:image\/[^)>\s]+/gi, ''), base).title || base;
        const pics = await pullImages(text, user, title, media);
        return Object.assign(docToWiki(pics.md, base), { pictures: pics.pictures, picturesSkipped: pics.skipped }, extra || {});
      };
      if (type === 'application/json') {
        const b = await bodyJSON(req, 60e6);
        if (b.url) {
          const id = gdocId(b.url);
          if (!id) return sendJSON(res, 400, { error: 'That doesn’t look like a Google Docs link' }), true;
          let text;
          try {
            const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=md`, { redirect: 'follow' });
            text = await r.text();
            if (!r.ok || /^\s*<!doctype html|<html/i.test(text)) throw new Error('private');
          } catch (e) {
            return sendJSON(res, 400, { error: 'Couldn’t read that document. In Google Docs, Share it as “Anyone with the link”, or use File › Download › Markdown (.md) and upload that.' }), true;
          }
          return sendJSON(res, 200, await convert(text, undefined, { source: { google: id } })), true;
        }
        return sendJSON(res, 200, await convert(str(b.text, 60e6), b.name)), true;
      }
      const buf = await readBody(req, 60 * 1024 * 1024), name = str(new URL(req.url, 'http://x').searchParams.get('name'), 200);
      const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
      try {
        const docx = /\.docx$/i.test(name) || buf.readUInt32LE(0) === 0x04034b50;
        return sendJSON(res, 200, await convert(docx ? docxToMarkdown(buf) : buf.toString('utf8'), base, null, docx ? unzip(buf, n => n.startsWith('word/media/')) : null)), true;
      } catch (e) { return sendJSON(res, 400, { error: 'Couldn’t read that file: ' + e.message }), true; }
    }
    if (q === '/wiki/import-zip' && m === 'POST') {   // a folder of Markdown files (an Obsidian vault, a wiki export) as a .zip
      if (!admin) return deny(res), true;
      const buf = await readBody(req, 200 * 1024 * 1024);
      let files;
      try { files = unzip(buf, name => /\.md$/i.test(name) && !name.split('/').some(part => part.startsWith('.') || part === '__MACOSX')); }
      catch (e) { return sendJSON(res, 400, { error: 'That isn’t a .zip file' }), true; }
      const names = Object.keys(files);
      // a zip of one folder: that folder is the top
      const tops = new Set(names.map(n => n.split('/')[0]));
      const strip = tops.size === 1 && names.every(n => n.includes('/')) ? [...tops][0].length + 1 : 0;
      let made = 0, skipped = 0;
      for (const name of names.sort()) {
        const parts = name.slice(strip).replace(/\.md$/i, '').split('/');
        const title = cleanTitle(parts.pop()), folder = cleanFolder(parts.join('/'));
        if (!title || titleTaken(title, folder)) { skipped++; continue; }
        const pg = { id: uid('p'), title, folder, md: files[name].toString('utf8'), gmOnly: false, created: now(), updated: now(), by: user.id, rev: 1, summary: 'Imported' };
        pages.set(pg.id, pg); savePage(pg); ensureFolders(folder); made++;
      }
      saveDrive();
      return sendJSON(res, 200, { made, skipped }), true;
    }
    if (q === '/wiki/export' && m === 'GET') {   // every page as Markdown files in their folders
      if (!admin) return deny(res), true;
      zipStream(res, `${st.siteName.replace(/[^\w-]+/g, '-')}-wiki.zip`, [...pages.values()].filter(x => !x.deleted).map(x => ({ name: pathOf(x) + '.md', data: Buffer.from(x.md, 'utf8') })));
      return true;
    }

    // ── the drive
    // ── the calendar: everyone who can read the site sees the date, the weather and the events that aren't GM only
    // ── the night sky: everyone sees the constellations (but hidden ones); admins draw them
    if (q === '/constellations' && m === 'GET') return sendJSON(res, 200, skyFor(admin)), true;
    if (q === '/constellations' && m === 'PUT') {
      if (!admin) return deny(res), true;
      const b = await bodyJSON(req, 4e6);
      if (!b || !Array.isArray(b.constellations)) return sendJSON(res, 400, { error: 'Nothing to save' }), true;
      saveSky(b, user);
      return sendJSON(res, 200, skyFor(true)), true;
    }
    // ── tales: everyone can watch them (but GM-only ones); admins make them
    if (q === '/tours' && m === 'GET') return sendJSON(res, 200, toursFor(admin)), true;
    if (q === '/tours' && m === 'PUT') {
      if (!admin) return deny(res), true;
      const b = await bodyJSON(req, 4e6);
      if (!b || !Array.isArray(b.tours)) return sendJSON(res, 400, { error: 'Nothing to save' }), true;
      saveTours(b, user);
      return sendJSON(res, 200, toursFor(true)), true;
    }
    // ── Wayfinder's scores: anyone can see them; anyone logged in can post one
    if (q === '/wayfinder' && m === 'GET') return sendJSON(res, 200, wfFor(user)), true;
    if (q === '/wayfinder' && m === 'POST') {
      if (!user || user.guest) return sendJSON(res, 401, { error: 'Log in to keep your score' }), true;
      const b = await bodyJSON(req, 1e4) || {};
      const score = Math.round(num(b.score, 0, 0, 25000)), w = wfRead(), d = today();
      const entry = { user: user.id, name: user.name, color: user.color || '', score, at: now() };
      if (b.mode === 'daily') {
        if (b.day !== d) return sendJSON(res, 409, { error: 'That was yesterday’s game: today’s is a new one', ...wfFor(user) }), true;
        const list = w.days[d] = w.days[d] || [];
        if (list.some(e => e.user === user.id)) return sendJSON(res, 409, { error: 'You’ve had your go at today’s', ...wfFor(user) }), true;
        list.push(entry);
        for (const k of Object.keys(w.days).sort().slice(0, -45)) delete w.days[k];   // a month and a half kept
      } else {
        w.best.push(entry);
        w.best = w.best.sort((a, b2) => b2.score - a.score).slice(0, 60);
      }
      writeJSON(WF_FILE, w);
      return sendJSON(res, 200, wfFor(user)), true;
    }
    if (q === '/calendar' && m === 'GET') return sendJSON(res, 200, calFor(admin)), true;
    if (q.startsWith('/calendar')) {
      if (!admin) return deny(res), true;
      const b = m === 'DELETE' ? {} : await bodyJSON(req, 4e6);
      if (q === '/calendar' && m === 'PUT') {   // { cal?, t?, weather?, regions? }
        if (b.cal) {
          calendar.cal = Cal.clean(b.cal);
        }
        if ('t' in b) calendar.t = Math.round(num(b.t, calendar.t, -1e12, 1e12));
        if (b.weather) calendar.weather = Cal.cleanWeather(Object.assign({}, calendar.weather, b.weather));
        if (Array.isArray(b.regions)) calendar.regions = cleanRegions(b.regions);
        saveCalendar(); return sendJSON(res, 200, calFor(true)), true;
      }
      if (q === '/calendar/advance' && m === 'POST') {   // { minutes } or { to: 'dawn' }
        calendar.t = b.to === 'dawn' ? Cal.nextDawn(calendar.cal, calendar.t) : calendar.t + Math.round(num(b.minutes, 0, -1e7, 1e7));
        saveCalendar(); return sendJSON(res, 200, calFor(true)), true;
      }
      if (q === '/calendar/events' && m === 'POST') {
        const e = cleanEvent(b); e.by = user.id; calendar.events.push(e);
        saveCalendar(); return sendJSON(res, 200, { event: e, calendar: calFor(true) }), true;
      }
      if ((mm = /^\/calendar\/events\/(e[a-f0-9]{12})$/.exec(q))) {
        const i = calendar.events.findIndex(e => e.id === mm[1]); if (i < 0) return sendJSON(res, 404, { error: 'No such event' }), true;
        if (m === 'PUT') calendar.events[i] = cleanEvent(Object.assign({}, calendar.events[i], b), calendar.events[i]);
        else if (m === 'DELETE') calendar.events.splice(i, 1);
        else return sendJSON(res, 405, { error: 'No' }), true;
        saveCalendar(); return sendJSON(res, 200, { calendar: calFor(true) }), true;
      }
      return sendJSON(res, 404, { error: 'Not found' }), true;
    }
    if (q === '/drive' && m === 'GET') {
      return sendJSON(res, 200, { folders: visibleFolders(admin),
        files: drive.files.filter(f => admin || (!f.deleted && !f.gmOnly && canSeeFolder(f.folder || '', false))).map(f => fileFor(f, admin)),
        pages: visiblePages(admin).map(x => { const o = pageFor(x, admin); delete o.md; o.size = x.md.length; const md = admin ? x.md : stripGM(x.md); o.excerpt = excerpt(md); o.pic = pictureOf(md); return o; }) }), true;
    }
    if (!admin && (m !== 'GET' || q.startsWith('/admin'))) return deny(res), true;   // everything below is for admins (reading too)
    if (q === '/drive/folders' && m === 'POST') {
      const b = await bodyJSON(req), fp = cleanFolder(b.path);
      if (!fp) return sendJSON(res, 400, { error: 'Name the folder' }), true;
      ensureFolders(fp); if ('gmOnly' in b) drive.folders.find(f => f.path === fp).gmOnly = !!b.gmOnly;
      saveDrive(); return sendJSON(res, 200, { ok: true }), true;
    }
    if (q === '/drive/folders' && m === 'PUT') {   // { path, to?, gmOnly? }: rename or move a folder and everything in it
      const b = await bodyJSON(req), from = cleanFolder(b.path), to = 'to' in b ? cleanFolder(b.to) : from;
      const f = drive.folders.find(x => x.path === from); if (!f) return sendJSON(res, 404, { error: 'No such folder' }), true;
      if (to !== from) {
        if (!to || to === from || to.startsWith(from + '/')) return sendJSON(res, 400, { error: 'Can’t move a folder into itself' }), true;
        if (drive.folders.some(x => x.path === to)) return sendJSON(res, 400, { error: 'There’s already a folder there' }), true;
        const move = s => s === from ? to : s.startsWith(from + '/') ? to + s.slice(from.length) : s;
        for (const x of drive.folders) x.path = move(x.path);
        for (const x of drive.files) x.folder = move(x.folder || '');
        for (const x of pages.values()) { const nf = move(x.folder || ''); if (nf !== (x.folder || '')) { const old = pathOf(x); x.folder = nf; savePage(x);
          for (const o of pages.values()) if (o.md.includes('[[' + old)) { o.md = o.md.split('[[' + old).join('[[' + pathOf(x)); savePage(o); } } }
        ensureFolders(to);
      }
      if ('gmOnly' in b) drive.folders.find(x => x.path === to).gmOnly = !!b.gmOnly;
      saveDrive(); return sendJSON(res, 200, { ok: true }), true;
    }
    if (q === '/drive/folders' && m === 'DELETE') {   // only empty folders (move or delete what's inside first)
      const fp = cleanFolder(new URL(req.url, 'http://x').searchParams.get('path'));
      const inside = s => s === fp || (s || '').startsWith(fp + '/');
      if ([...pages.values()].some(x => !x.deleted && inside(x.folder)) || drive.files.some(x => !x.deleted && inside(x.folder))) return sendJSON(res, 400, { error: 'The folder isn’t empty' }), true;
      drive.folders = drive.folders.filter(x => !inside(x.path)); saveDrive();
      return sendJSON(res, 200, { ok: true }), true;
    }
    if (q === '/drive/files' && m === 'POST') {
      const sp = new URL(req.url, 'http://x').searchParams;
      let type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
      const name = str(sp.get('name') || 'file', 180).replace(/[\/\\<>:"|?*\u0000-\u001f]/g, '-').trim() || 'file';
      if (type === 'application/octet-stream' || !type) type = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', docx: FILE_TYPES.docx, pdf: 'application/pdf' }[name.split('.').pop().toLowerCase()] || type;
      if (type === 'text/x-markdown') type = 'text/markdown';
      if (!FILE_TYPES[type]) return sendJSON(res, 400, { error: `Can’t keep that kind of file (${type || 'unknown'}). Pictures, PDFs, documents, sound and video are fine.` }), true;
      const buf = await readBody(req, MAX_FILE);
      const f = { id: uid('f'), name, folder: cleanFolder(sp.get('folder')), type, size: buf.length, gmOnly: sp.get('gmOnly') === '1', created: now(), by: user.id };
      fs.writeFileSync(path.join(FILES_DIR, f.id), buf);
      drive.files.push(f); ensureFolders(f.folder); saveDrive();
      if ((f.folder || '').split('/')[0].toLowerCase() === 'map icons') iconCache = null;
      return sendJSON(res, 200, { file: fileFor(f, true) }), true;
    }
    if ((mm = /^\/drive\/files\/(f[a-f0-9]{12})(\/restore)?$/.exec(q))) {
      const f = drive.files.find(x => x.id === mm[1]); if (!f) return sendJSON(res, 404, { error: 'No such file' }), true;
      if (mm[2] && m === 'POST') { delete f.deleted; if (f.folder) ensureFolders(f.folder); saveDrive(); return sendJSON(res, 200, { file: fileFor(f, true) }), true; }
      if (m === 'PUT') {
        const b = await bodyJSON(req);
        if ('name' in b) f.name = str(b.name, 180).replace(/[\/\\<>:"|?*\u0000-\u001f]/g, '-').trim() || f.name;
        if ('folder' in b) { f.folder = cleanFolder(b.folder); ensureFolders(f.folder); }
        if ('gmOnly' in b) f.gmOnly = !!b.gmOnly;
        saveDrive(); iconCache = null; return sendJSON(res, 200, { file: fileFor(f, true) }), true;
      }
      if (m === 'DELETE') {
        if (new URL(req.url, 'http://x').searchParams.has('purge')) { drive.files = drive.files.filter(x => x !== f); try { fs.unlinkSync(path.join(FILES_DIR, f.id)); } catch (e) { /* gone */ } }
        else f.deleted = now();
        saveDrive(); iconCache = null; return sendJSON(res, 200, {}), true;
      }
    }

    // ── admin
    if (q === '/admin/settings') {
      if (m === 'POST') {
        const b = await bodyJSON(req), cur = settings();
        config.site = { siteName: str(b.siteName ?? cur.siteName, 60).trim() || 'My world', tagline: str(b.tagline ?? cur.tagline, 120), mainPage: str(b.mainPage ?? cur.mainPage, 300),
          private: 'private' in b ? !!b.private : cur.private };
        saveConfig();
      }
      return sendJSON(res, 200, { settings: settings() }), true;
    }
    if (q === '/admin/users' && m === 'GET') return sendJSON(res, 200, { users: db.users.map(u => Object.assign(publicUser(u), { created: u.created })), campaigns: S.people ? S.people.campaigns() : [] }), true;
    if (q === '/admin/users' && m === 'POST') {   // a new account: { name, role, password?, campaigns: [ids] } → its password
      const b = await bodyJSON(req);
      const password = String(b.password || '').length >= 6 ? String(b.password) : crypto.randomBytes(5).toString('hex');
      let u;
      try { u = S.people.create(b.name, b.role, password); } catch (e) { return sendJSON(res, 400, { error: e.message }), true; }
      for (const cid of Array.isArray(b.campaigns) ? b.campaigns : []) S.people.setMember(String(cid), u.id, true);
      return sendJSON(res, 200, { user: Object.assign(publicUser(u), { created: u.created }), password, campaigns: S.people.campaigns() }), true;
    }
    if ((mm = /^\/admin\/users\/(u[a-f0-9]{12})$/.exec(q))) {
      const u = db.users.find(x => x.id === mm[1]); if (!u) return sendJSON(res, 404, { error: 'No such person' }), true;
      if (m === 'POST') {
        const b = await bodyJSON(req);
        if ('role' in b) {
          const role = b.role === 'gm' ? 'gm' : 'player';
          if (role === 'player' && u.role === 'gm' && db.users.filter(x => x.role === 'gm').length < 2) return sendJSON(res, 400, { error: 'Keep at least one admin' }), true;
          u.role = role;
        }
        if (b.campaign) S.people.setMember(String(b.campaign), u.id, !!b.member);   // in or out of a campaign
        let password = null;
        if (b.resetPassword) { password = crypto.randomBytes(5).toString('hex'); u.pass = hashPassword(password); for (const [k, v] of Object.entries(S.sessions)) if (v.uid === u.id) delete S.sessions[k]; S.saveSessions(); }
        saveUsers();
        return sendJSON(res, 200, { user: publicUser(u), password, campaigns: S.people.campaigns() }), true;
      }
      if (m === 'DELETE') {
        if (u.id === user.id) return sendJSON(res, 400, { error: 'You can’t remove yourself' }), true;
        if (u.role === 'gm' && db.users.filter(x => x.role === 'gm').length < 2) return sendJSON(res, 400, { error: 'Keep at least one admin' }), true;
        db.users.splice(db.users.indexOf(u), 1);
        for (const [k, v] of Object.entries(S.sessions)) if (v.uid === u.id) delete S.sessions[k];
        S.saveSessions(); saveUsers();
        return sendJSON(res, 200, {}), true;
      }
    }
    if (q === '/admin/backup' && m === 'GET') {   // everything in vtt-data (accounts, campaigns, the site), as a .zip
      const stamp = new Date().toISOString().slice(0, 10);
      zipStream(res, `${st.siteName.replace(/[^\w-]+/g, '-')}-backup-${stamp}.zip`, walk(DATA).filter(e => !/^sessions\.json$|\.tmp$|^campaigns\/[^/]+\/backups\//.test(e.name)));
      return true;
    }
    return sendJSON(res, 404, { error: 'Not found' }), true;
  }
  // Pages that still carry their pictures inside the text (imported before pictures went into Files, or linked to
  // Google's short-lived picture links): the pictures move into Files › Wiki pictures and the page links to them.
  // Done once per page version; keeps the wiki light to load.
  (function movePictures() {
    const DONE = path.join(DIR, 'pictures-moved.json'), done = readJSON(DONE, {});
    const todo = [...pages.values()].filter(p => !p.deleted && done[p.id] !== p.rev && /data:image\/|googleusercontent\.com\//.test(p.md || ''));
    if (!todo.length) return;
    setTimeout(async () => {
      let moved = 0;
      for (const p of todo) {
        try {
          const r = await pullImages(p.md, { id: p.by || null }, p.title);
          if (r.pictures) {
            addRevision(p);
            Object.assign(p, { md: r.md, rev: (p.rev || 1) + 1, updated: now(), summary: `Moved ${r.pictures} picture${r.pictures === 1 ? '' : 's'} into Files` });
            savePage(p); moved += r.pictures;
          }
          done[p.id] = p.rev;
        } catch (e) { log('Couldn’t move the pictures out of ' + p.title + ': ' + e.message); }
      }
      writeJSON(DONE, done);
      if (moved) log(`Wiki: moved ${moved} picture${moved === 1 ? '' : 's'} out of page text into Files › Wiki pictures`);
    }, 500);
  })();

  return { handle, settings, docToWiki, docxToMarkdown, calendar: () => calFor(true), calendarFor: calFor, getAtlas };
};
