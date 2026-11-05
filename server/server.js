/* The world site and table server: the map, the wiki and files, and the virtual tabletop.
 *
 * Serves the map-viewer folder (world map, wiki, the table) and runs the shared table: accounts, invite links,
 * live sync over WebSocket, saving. Start it with start_vtt.bat; it needs Node.js 18 or newer and nothing else.
 *
 * Everything it keeps lives in vtt-data/ next to this folder:
 *   config.json      port, the address players use, whether this PC needs a login
 *   users.json       accounts (passwords are hashed) and invite links
 *   sessions.json    who is logged in
 *   campaigns/<id>/campaign.json, assets/ (uploaded images), backups/
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('./node_modules/ws');
const Dice = require('../table/shared/dice.js');
const Geom = require('../table/shared/geom.js');
const R20 = require('../table/shared/r20roll.js');
const Vision = require('../table/shared/vision.js');
const Plan = require('../table/shared/plan.js');
const Sheet5e = require('../table/shared/sheet5e.js');
const Cal = require('../table/shared/calendar.js');
const Foundry = require('./foundry.js');
const Roll20 = require('./roll20.js');
const DDB = require('./ddb.js');
const Loot = require('./loot.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.VTT_DATA ? path.resolve(process.env.VTT_DATA) : path.join(ROOT, 'vtt-data');
const CAMPAIGNS = path.join(DATA, 'campaigns');
const MAX_UPLOAD = 80 * 1024 * 1024;
// Character sheets on offer (table/sheets/registry.json): which attribute holds hit points, which game mode they suit.
let SHEETS = {};
try { SHEETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'table', 'sheets', 'registry.json'), 'utf8')); } catch (e) { console.log('No sheet registry:', e.message); }
const UNDO_LIMIT = 200;
const CHAT_KEPT = 1000;

fs.mkdirSync(CAMPAIGNS, { recursive: true });

// ───────────────────────── small helpers ─────────────────────────

const id = (p = '') => p + crypto.randomBytes(6).toString('hex');
const now = () => Date.now();
const clone = o => JSON.parse(JSON.stringify(o));
const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);
const num = (v, d = 0, lo = -1e9, hi = 1e9) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}
const saveTimers = new Map();
function saveSoon(file, getObj, delay = 800) {
  clearTimeout(saveTimers.get(file));
  saveTimers.set(file, setTimeout(() => { saveTimers.delete(file); try { writeJSON(file, getObj()); } catch (e) { log('Could not save', file, e.message); } }, delay));
}
function flushSaves() { for (const [file, t] of saveTimers) { clearTimeout(t); } }

// ───────────────────────── config, users, sessions ─────────────────────────

const CONFIG_FILE = path.join(DATA, 'config.json'), USERS_FILE = path.join(DATA, 'users.json'), SESSIONS_FILE = path.join(DATA, 'sessions.json');
const config = Object.assign({ port: 8642, localNoLogin: true, publicUrl: '' }, readJSON(CONFIG_FILE, {}));
if (process.env.VTT_PORT) config.port = +process.env.VTT_PORT;
writeJSON(CONFIG_FILE, config);
const db = Object.assign({ users: [], invites: [] }, readJSON(USERS_FILE, {}));
const sessions = readJSON(SESSIONS_FILE, {});
const saveUsers = () => saveSoon(USERS_FILE, () => db);
const saveSessions = () => saveSoon(SESSIONS_FILE, () => sessions);
const saveConfig = () => writeJSON(CONFIG_FILE, config);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(user, pw) {
  if (!user.pass) return false;
  const h = crypto.scryptSync(String(pw), user.pass.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(user.pass.hash, 'hex'));
}
const userById = uid => db.users.find(u => u.id === uid);
const userByName = name => db.users.find(u => u.name.toLowerCase() === String(name).trim().toLowerCase());
const publicUser = u => u && { id: u.id, name: u.name, role: u.role, color: u.color, hasPassword: !!u.pass };
const USER_COLOURS = ['#c9a45c', '#5b8fd1', '#c0584a', '#5fa86a', '#9b6fc4', '#d08a3e', '#4aa3a3', '#c46f9b'];

function ensureGM() {
  let gm = db.users.find(u => u.role === 'gm');
  if (!gm) {
    gm = { id: id('u'), name: 'GM', role: 'gm', color: USER_COLOURS[0], pass: null, created: now() };
    db.users.push(gm); saveUsers();
  }
  return gm;
}
ensureGM();
// On a server nobody is "this PC", so the first admin password can come from the environment: VTT_ADMIN_PASSWORD
// (and VTT_ADMIN_NAME) set the first admin's login at start-up. Set it once, log in, then remove it if you like.
if (process.env.VTT_ADMIN_PASSWORD) {
  const gm = ensureGM();
  if (String(process.env.VTT_ADMIN_PASSWORD).length < 6) console.log('VTT_ADMIN_PASSWORD is shorter than six characters: ignored.');
  else {
    gm.pass = hashPassword(process.env.VTT_ADMIN_PASSWORD);
    const nm = str(process.env.VTT_ADMIN_NAME || '', 40).trim();
    if (nm && (!userByName(nm) || userByName(nm) === gm)) gm.name = nm;
    writeJSON(USERS_FILE, db);
    console.log(`Admin login set from VTT_ADMIN_PASSWORD: name "${gm.name}".`);
  }
}
if (process.env.VTT_NO_LOCAL_LOGIN) config.localNoLogin = false;   // a public server: nobody is logged in automatically

// "This PC": a direct connection to localhost, not something relayed through a tunnel or proxy.
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const relayed = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers.forwarded || req.headers['x-real-ip'];
  return loop && !relayed && ['localhost', '127.0.0.1', '::1'].includes(host);
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function userFor(req) {
  const tok = cookies(req).vtt_session;
  const s = tok && sessions[tok];
  if (s && userById(s.uid)) return userById(s.uid);
  if (isLocal(req) && config.localNoLogin) return ensureGM();
  return null;
}
function startSession(res, user) {
  const tok = crypto.randomBytes(24).toString('hex');
  sessions[tok] = { uid: user.id, created: now() };
  // forget sessions older than 90 days
  for (const [k, v] of Object.entries(sessions)) if (now() - v.created > 90 * 864e5) delete sessions[k];
  saveSessions();
  res.setHeader('Set-Cookie', `vtt_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 86400}`);
}

// ───────────────────────── campaigns ─────────────────────────

const rooms = new Map();   // campaign id -> Room

function campaignDir(cid) { return path.join(CAMPAIGNS, cid.replace(/[^a-z0-9_-]/gi, '')); }
function listCampaigns() {
  return fs.readdirSync(CAMPAIGNS, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => getRoom(d.name)).filter(Boolean).map(r => r.c);
}
function getRoom(cid) {
  if (rooms.has(cid)) return rooms.get(cid);
  const file = path.join(campaignDir(cid), 'campaign.json');
  const c = readJSON(file, null);
  if (!c) return null;
  const room = new Room(normaliseCampaign(c));
  rooms.set(cid, room);
  backup(cid);
  return room;
}
function normaliseCampaign(c) {
  c.members = c.members || [];
  c.scenes = c.scenes || [];
  c.chat = c.chat || [];
  c.init = c.init || { entries: [], turn: 0, round: 1 };
  c.characters = c.characters || [];
  c.charFolders = Array.isArray(c.charFolders) ? c.charFolders : [];
  c.handouts = Array.isArray(c.handouts) ? c.handouts : [];
  c.items = Array.isArray(c.items) ? c.items : [];   // the GM's own item cards (homebrew), beside the SRD ones
  c.audio = normaliseAudio(c.audio, c.id);
  c.mode = c.mode === '2d6' ? '2d6' : '5e';
  delete c.log; delete c.logNotes; delete c.macros;                            // (the old session log and roll buttons, retired)
  // the campaign's own date, time and weather (the calendar itself, its months and years, is the world's)
  if (!c.clock || typeof c.clock !== 'object') { const k = site.calendar(); c.clock = { t: k.t, weather: k.weather }; }
  c.clock.t = Math.round(+c.clock.t || 0); c.clock.weather = Cal.cleanWeather(c.clock.weather);
  // every campaign has the world map as a scene (added once; the GM may delete it)
  if (!c.worldAdded) { c.worldAdded = true; if (!c.scenes.some(s => s.kind === 'world')) c.scenes.push(newScene({ name: 'World map', kind: 'world' })); }
  for (const s of c.scenes) for (const t of s.tokens || []) if (t.layer === 'map' && playerTokenish(t, c)) t.layer = 'tokens';   // (the players' tokens: on the token layer)
  for (const s of c.scenes) { s.tokens = s.tokens || []; s.templates = s.templates || []; s.fogShapes = s.fogShapes || []; s.walls = s.walls || []; s.lights = s.lights || []; s.sounds = s.sounds || []; }
  // weapons put on a sheet before crits were written: a critical hit rolls the same dice again
  for (const ch of c.characters || []) {
    const a = ch.attrs; if (!a || ch.sheet !== 'dnd5e') continue;
    for (const k of ['melee', 'ranged']) for (let i = 1; i <= 6; i++) if (a[k + 'weaponname' + i] && a[k + 'dmg' + i] && !a[k + 'critdmg' + i]) a[k + 'critdmg' + i] = a[k + 'dmg' + i];
  }
  return c;
}
function createCampaign(name, mode, t) {
  const k = site.calendar();
  const c = normaliseCampaign({ id: id('c'), name: str(name, 80) || 'New campaign', mode, created: now(), playerScene: null,
    clock: { t: Number.isFinite(t) ? Math.round(t) : k.t, weather: k.weather } });
  fs.mkdirSync(path.join(campaignDir(c.id), 'assets'), { recursive: true });
  writeJSON(path.join(campaignDir(c.id), 'campaign.json'), c);
  return getRoom(c.id);
}
function backup(cid) {
  const dir = path.join(campaignDir(cid), 'backups'), file = path.join(campaignDir(cid), 'campaign.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    fs.copyFileSync(file, path.join(dir, `campaign-${stamp}.json`));
    const old = fs.readdirSync(dir).filter(f => f.startsWith('campaign-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(dir, f));
  } catch (e) { log('Backup failed', e.message); }
}
// Visitors who aren't logged in watch: they see what the players see (through the party's eyes) and can't change anything.
// A campaign is open to them unless the GM has turned "Visitors can watch" off, or the whole site is private.
const GUEST = Object.freeze({ id: 'guest', name: 'Visitor', role: 'guest', color: '#8a8f98', guest: true });
const isPrivate = () => !!site.settings().private;
const canSee = (user, c) => !!user && (user.role === 'gm' || user.playing || (user.guest ? c.watch !== false && !isPrivate() : c.members.includes(user.id)));
const isGM = user => user && user.role === 'gm';
// a GM's account can be a player in one campaign (their friend's game): c.roles[uid] === 'player'. There they see and do
// only what a player would; everywhere else they're a GM.
const playerIn = (c, uid) => !!(c && c.roles && c.roles[uid] === 'player');
function asIn(c, user) { return user && user.role === 'gm' && playerIn(c, user.id) ? Object.assign({}, user, { role: 'player', here: 'player' }) : user; }
const roleIn = (c, u) => u ? (u.role === 'gm' && !playerIn(c, u.id) ? 'gm' : 'player') : null;

// ───────────────────────── sanitising what clients send ─────────────────────────

const CONDITIONS_MAX = 20;
function cleanGrid(g = {}) {
  return {
    type: ['square', 'hexr', 'hexc', 'none'].includes(g.type) ? g.type : 'square',
    size: num(g.size, 100, 4, 4000), ox: num(g.ox, 0, -1e5, 1e5), oy: num(g.oy, 0, -1e5, 1e5),
    feet: num(g.feet, 5, 0.01, 10000), units: str(g.units, 12) || 'ft',
    diagonal: ['one', 'alt', 'euclid'].includes(g.diagonal) ? g.diagonal : 'one',
    color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#000000', alpha: num(g.alpha, 0.35, 0, 1)
  };
}
const SCENE_KEYS = ['name', 'folder', 'kind', 'image', 'grid', 'darkness', 'fog', 'vision', 'notes', 'bg', 'area', 'explored', 'rings', 'clock', 'weather', 'atlas', 'climate', 'journeys', 'plan'];
function cleanSceneMeta(p) {
  const out = {};
  if ('name' in p) out.name = str(p.name, 80) || 'Scene';
  if ('folder' in p) out.folder = str(p.folder, 60).trim() || null;   // the GM's folder for it in the scenes tab (a name; none: loose)
  if ('image' in p) out.image = p.image ? { url: str(p.image.url, 300), w: num(p.image.w, 0, 0, 1e5), h: num(p.image.h, 0, 0, 1e5) } : null;
  if ('grid' in p) out.grid = cleanGrid(p.grid);
  if ('darkness' in p) out.darkness = num(p.darkness, 0, 0, 1);
  if ('fog' in p) out.fog = !!p.fog;
  if ('vision' in p) out.vision = !!p.vision;
  if ('notes' in p) out.notes = str(p.notes, 20000);
  if ('bg' in p) out.bg = /^#[0-9a-f]{6}$/i.test(p.bg) ? p.bg : '#1b1d22';
  if ('plan' in p) out.plan = p.plan ? Plan.normalize(p.plan) : null;   // the room planner's squares (table/shared/plan.js): it makes the walls
  if ('kind' in p) out.kind = p.kind === 'world' ? 'world' : 'battle';   // world: the tiled world map with its wiki
  if ('atlas' in p) out.atlas = /^a[a-f0-9]{12}$/.test(String(p.atlas || '')) ? String(p.atlas) : null;   // world: which version of the map (null: the main one)
  if ('rings' in p) out.rings = p.rings !== false;   // false: tokens on this scene default to bare sprites, no ring
  if ('clock' in p) out.clock = !!p.clock;           // darkness follows the world's time of day (outdoors)
  if ('weather' in p) out.weather = !!p.weather;     // the world's weather (rain, snow, fog) shows on this scene
  if ('climate' in p) out.climate = ['temperate', 'wet', 'dry', 'desert', 'cold', 'frozen'].includes(p.climate) ? p.climate : 'temperate';   // how it falls here: snow where it's cold
  if ('explored' in p) out.explored = Math.round(num(p.explored, 0, 0, 1e9));   // bump to wipe what players have explored
  // world: the party's journeys, drawn by the GM: trails of stops, each dated by the campaign's clock (t, minutes)
  if ('journeys' in p) out.journeys = (Array.isArray(p.journeys) ? p.journeys : []).slice(0, 60).filter(j => j && typeof j === 'object').map((j, i) => ({
    id: /^[a-z0-9]{1,20}$/i.test(String(j.id || '')) ? String(j.id) : 'j' + Date.now().toString(36) + i,
    name: str(j.name, 80), color: /^#[0-9a-f]{6}$/i.test(j.color) ? j.color : '#9e2b25', hidden: !!j.hidden,
    pts: (Array.isArray(j.pts) ? j.pts : []).slice(0, 3000).filter(q => q && Number.isFinite(+q.x) && Number.isFinite(+q.y))
      .map(q => Object.assign({ x: Math.round(num(q.x, 0, -1e6, 1e6)), y: Math.round(num(q.y, 0, -1e6, 1e6)) },
        q.t != null && Number.isFinite(+q.t) ? { t: Math.round(num(q.t, 0, -1e12, 1e12)) } : {}, q.note ? { note: str(q.note, 200) } : {}))
  }));
  if ('area' in p) out.area = { cols: Math.round(num(p.area && p.area.cols, 30, 1, 200)), rows: Math.round(num(p.area && p.area.rows, 20, 1, 200)) };
  return out;
}
// ───────── the jukebox ─────────
// tracks: uploaded sounds. Each channel plays one track at a time (from a playlist or alone); `started` is the
// server time the track would have begun if never paused, so everyone hears the same moment.
const CHANNELS = ['music', 'ambience', 'effects'];
// The sounds and their folders are one library shared by every campaign (vtt-data/library: audio.json and the files
// in sounds/); each campaign keeps only what's playing on its channels, its saved scenes and its crossfade. A
// campaign's sounds from before are moved into the library the first time it's opened.
const LIB_DIR = path.join(DATA, 'library'), LIB_SOUNDS = path.join(LIB_DIR, 'sounds'), LIB_FILE = path.join(LIB_DIR, 'audio.json');
let soundLib = null;
function library() {
  if (!soundLib) {
    try { soundLib = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch (e) { soundLib = {}; }
    soundLib.tracks = Array.isArray(soundLib.tracks) ? soundLib.tracks : [];
    soundLib.playlists = Array.isArray(soundLib.playlists) ? soundLib.playlists : [];
    adoptAll();
  }
  return soundLib;
}
// every campaign's own sounds from before into the library, once (those not open yet too)
function adoptAll() {
  let dirs = []; try { dirs = fs.readdirSync(CAMPAIGNS); } catch (e) { return; }
  let moved = false;
  for (const d of dirs) {
    const f = path.join(CAMPAIGNS, d, 'campaign.json');
    let c; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    const a = c && c.audio; if (!a || !((a.tracks || []).length || (a.playlists || []).length)) continue;
    for (const t0 of a.tracks || []) if (t0 && !soundLib.tracks.some(x => x.id === t0.id)) { soundLib.tracks.push(Object.assign({}, t0, { url: intoLibrary(t0.url, c.id || d, false) })); moved = true; }
    for (const p0 of a.playlists || []) if (p0 && !soundLib.playlists.some(x => x.id === p0.id)) { soundLib.playlists.push(p0); moved = true; }
    delete a.tracks; delete a.playlists;
    try { writeJSON(f, c); } catch (e) { /* left as it was: adopted when it opens */ }
  }
  if (moved) saveLibrary();
}
function saveLibrary() { fs.mkdirSync(LIB_DIR, { recursive: true }); writeJSON(LIB_FILE, library()); }
// the art library: { art: [{ id, name, url, folder, pw, ph (its size in pixels), sw, sh (its usual size, squares), blocks, container }] }
const LIB_ART = path.join(LIB_DIR, 'art'), ART_FILE = path.join(LIB_DIR, 'art.json');
let artLibrary = null;
function artLib() { if (!artLibrary) { try { artLibrary = JSON.parse(fs.readFileSync(ART_FILE, 'utf8')); } catch (e) { artLibrary = {}; } artLibrary.art = Array.isArray(artLibrary.art) ? artLibrary.art : []; } return artLibrary; }
function saveArt() { fs.mkdirSync(LIB_DIR, { recursive: true }); writeJSON(ART_FILE, artLib()); }
// a sound file from a campaign's own files into the library's (so every campaign can play it)
function intoLibrary(url, cid, move) {
  const m = /^\/vtt-data\/campaigns\/([a-z0-9]+)\/assets\/([^/]+)$/i.exec(url || '');
  if (!m) return url;
  const src = path.join(campaignDir(m[1]), 'assets', path.basename(m[2])), name = path.basename(m[2]);
  try {
    fs.mkdirSync(LIB_SOUNDS, { recursive: true });
    const dst = path.join(LIB_SOUNDS, name);
    if (!fs.existsSync(dst)) { if (move) fs.renameSync(src, dst); else fs.copyFileSync(src, dst); }
    return `/vtt-data/library/sounds/${name}`;
  } catch (e) { return url; }
}
function normaliseAudio(a, cid) {
  a = a && typeof a === 'object' ? a : {};
  const L = library();
  let moved = false;
  if (Array.isArray(a.tracks) && a.tracks.length) for (const t0 of a.tracks) {
    if (!t0 || L.tracks.some(x => x.id === t0.id)) continue;
    L.tracks.push(Object.assign({}, t0, { url: intoLibrary(t0.url, cid, false) })); moved = true;
  }
  if (Array.isArray(a.playlists) && a.playlists.length) for (const p0 of a.playlists) {
    if (!p0 || L.playlists.some(x => x.id === p0.id)) continue;
    L.playlists.push(p0); moved = true;
  }
  if (moved) saveLibrary();
  delete a.tracks; delete a.playlists;
  // (still a.tracks and a.playlists to the code below, but the library's, and not saved with the campaign)
  Object.defineProperty(a, 'tracks', { get: () => library().tracks, set: v => { library().tracks = v; }, enumerable: false, configurable: true });
  Object.defineProperty(a, 'playlists', { get: () => library().playlists, set: v => { library().playlists = v; }, enumerable: false, configurable: true });
  a.presets = Array.isArray(a.presets) ? a.presets : [];
  a.fade = num(a.fade, 3, 0, 20);
  a.ch = a.ch || {};
  for (const k of CHANNELS) a.ch[k] = Object.assign({ vol: k === 'effects' ? 0.8 : 0.6, loop: k !== 'effects', list: null, track: null, started: 0, paused: null }, a.ch[k] || {});
  return a;
}
function audioCommand(room, msg) {
  const a = room.c.audio, now = Date.now();
  const chan = CHANNELS.includes(msg.ch) ? a.ch[msg.ch] : null;
  const track = tid => a.tracks.find(t => t.id === tid);
  const pos = c => c.paused != null ? c.paused : (now - c.started) / 1000;
  switch (msg.op) {
    case 'add': {   // a newly uploaded sound: into the library every campaign shares
      const t = { id: id('a'), name: str(msg.name, 80) || 'Sound', url: str(msg.url, 300), dur: num(msg.dur, 0, 0, 36000), kind: CHANNELS.includes(msg.kind) ? msg.kind : 'music' };
      if (!/^\/vtt-data\//.test(t.url)) throw new Error('Upload the sound first');
      t.url = intoLibrary(t.url, room.c.id, true);
      a.tracks.push(t);
      const into = msg.list && a.playlists.find(x => x.id === msg.list);   // uploaded straight into a folder
      if (into) { into.tracks.push(t.id); t.kind = into.kind; }
      break;
    }
    case 'move': {   // a sound into a folder (or out of all of them): it takes the folder's channel
      const t = track(msg.id); if (!t) throw new Error('No such sound');
      for (const l of a.playlists) l.tracks = l.tracks.filter(x => x !== t.id);
      const to = msg.to && a.playlists.find(x => x.id === msg.to);
      if (to) { const i = Number.isInteger(msg.index) ? Math.max(0, Math.min(msg.index, to.tracks.length)) : to.tracks.length; to.tracks.splice(i, 0, t.id); t.kind = to.kind; }
      break;
    }
    case 'edit': { const t = track(msg.id); if (!t) throw new Error('No such sound'); if ('name' in msg) t.name = str(msg.name, 80) || t.name; if (CHANNELS.includes(msg.kind)) t.kind = msg.kind; break; }
    case 'remove': {
      a.tracks = a.tracks.filter(t => t.id !== msg.id);
      for (const l of a.playlists) l.tracks = l.tracks.filter(x => x !== msg.id);
      for (const k of CHANNELS) if (a.ch[k].track === msg.id) Object.assign(a.ch[k], { track: null, paused: null });
      break;
    }
    case 'play': {   // { ch, track?, list? }: a track, or a playlist from its first (or a random) track
      if (!chan) throw new Error('No such channel');
      const l = msg.list ? a.playlists.find(x => x.id === msg.list) : null;
      let tid = msg.track || null;
      if (l && !tid) tid = l.shuffle ? l.tracks[Math.floor(Math.random() * l.tracks.length)] : l.tracks[0];
      if (!tid || !track(tid)) throw new Error('Nothing to play');
      Object.assign(chan, { track: tid, list: l ? l.id : (msg.track && chan.list && a.playlists.some(x => x.id === chan.list && x.tracks.includes(tid)) ? chan.list : null), started: now, paused: null });
      break;
    }
    case 'pause': if (chan && chan.track && chan.paused == null) chan.paused = pos(chan); break;
    case 'resume': if (chan && chan.track && chan.paused != null) { chan.started = now - chan.paused * 1000; chan.paused = null; } break;
    case 'stop': if (chan) Object.assign(chan, { track: null, paused: null }); break;
    case 'next': if (chan) nextTrack(a, chan, now, true); break;
    case 'vol': if (chan) chan.vol = num(msg.vol, chan.vol, 0, 1); break;
    case 'loop': if (chan) chan.loop = msg.loop === 'one' ? 'one' : !!msg.loop; break;   // 'one': this song over and over (even in a folder)
    case 'fade': a.fade = num(msg.fade, 3, 0, 20); break;
    case 'list': {   // create or replace a playlist
      const l = { id: msg.list && msg.list.id && /^[a-z0-9]{1,30}$/i.test(msg.list.id) ? msg.list.id : id('p'), name: str(msg.list && msg.list.name, 80) || 'Playlist',
        kind: CHANNELS.includes(msg.list && msg.list.kind) ? msg.list.kind : 'music', shuffle: !!(msg.list && msg.list.shuffle),
        tracks: (Array.isArray(msg.list && msg.list.tracks) ? msg.list.tracks : []).filter(x => track(x)).slice(0, 500) };
      const i = a.playlists.findIndex(x => x.id === l.id);
      if (i >= 0) a.playlists[i] = l; else a.playlists.push(l);
      for (const tid of l.tracks) { const t = track(tid); if (t) t.kind = l.kind; }   // a folder's sounds play on its channel
      break;
    }
    case 'unlist': a.playlists = a.playlists.filter(x => x.id !== msg.id); for (const k of CHANNELS) if (a.ch[k].list === msg.id) a.ch[k].list = null; break;
    case 'preset': {   // remember what's playing on music and ambience, at what volume
      a.presets.push({ id: id('r'), name: str(msg.name, 80) || 'Preset', ch: Object.fromEntries(['music', 'ambience'].map(k => [k, { track: a.ch[k].paused == null ? a.ch[k].track : null, list: a.ch[k].list, vol: a.ch[k].vol, loop: a.ch[k].loop }])) });
      break;
    }
    case 'unpreset': a.presets = a.presets.filter(x => x.id !== msg.id); break;
    case 'apply': {
      const pr = a.presets.find(x => x.id === msg.id); if (!pr) throw new Error('No such preset');
      for (const [k, v] of Object.entries(pr.ch)) {
        const c = a.ch[k]; c.vol = v.vol; c.loop = v.loop;
        if (v.track && track(v.track)) Object.assign(c, { track: v.track, list: v.list, started: now, paused: null });
        else if (v.list && a.playlists.some(x => x.id === v.list)) { const l = a.playlists.find(x => x.id === v.list); Object.assign(c, { track: l.tracks[0] || null, list: l.id, started: now, paused: null }); }
        else Object.assign(c, { track: null, paused: null });
      }
      break;
    }
    case 'sfx': {   // a one-off sound for everyone (the soundboard)
      const t = track(msg.id); if (!t) throw new Error('No such sound');
      for (const conn of room.conns) send(conn, { t: 'sfx', url: t.url, vol: a.ch.effects.vol });
      return;
    }
    default: throw new Error('Unknown jukebox action');
  }
  if (['add', 'move', 'edit', 'remove', 'list', 'unlist'].includes(msg.op)) {   // the library changed: every table hears of it
    saveLibrary();
    for (const r of rooms.values()) if (r !== room) {
      if (msg.op === 'remove') for (const k of CHANNELS) if (r.c.audio.ch[k].track === msg.id) Object.assign(r.c.audio.ch[k], { track: null, paused: null });
      r.publish();
    }
  }
  room.audioTimers();
  room.changed();
}
// what comes after the current track: the playlist's next (or a random one), the same track again, or silence
function nextTrack(a, c, now, forced) {
  if (c.loop === 'one' && c.track && !forced) { Object.assign(c, { started: now, paused: null }); return; }
  const l = c.list && a.playlists.find(x => x.id === c.list);
  if (l && l.tracks.length) {
    let i = l.tracks.indexOf(c.track);
    if (l.shuffle && l.tracks.length > 1) { let j; do j = Math.floor(Math.random() * l.tracks.length); while (j === i); i = j; }
    else { i = i + 1; if (i >= l.tracks.length) { if (!c.loop && !forced) { Object.assign(c, { track: null, paused: null }); return; } i = 0; } }
    Object.assign(c, { track: l.tracks[i], started: now, paused: null });
  } else if (c.loop && c.track) Object.assign(c, { started: now, paused: null });
  else Object.assign(c, { track: null, paused: null });
}
// ───────── import from Roll20 ─────────
// Pictures named in a Roll20 export are on Roll20's servers: fetched here (from the PC the table runs on) into the
// campaign's assets, unless the GM picked them alongside the files (matched by file name).
function fetchPicture(url, dir, hops = 0) {
  return new Promise(resolve => {
    let u; try { u = new URL(url); } catch (e) { return resolve(null); }
    if (!/^https?:$/.test(u.protocol) || hops > 3) return resolve(null);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.get(u, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (table import)' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(fetchPicture(new URL(res.headers.location, u).href, dir, hops + 1)); }
      const type = String(res.headers['content-type'] || '');
      const ext = /png/.test(type) ? '.png' : /jpe?g/.test(type) ? '.jpg' : /webp/.test(type) ? '.webp' : /gif/.test(type) ? '.gif' : /svg/.test(type) ? '.svg' : null;
      if (res.statusCode !== 200 || !ext) { res.resume(); return resolve(null); }
      const parts = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 40 * 1024 * 1024) { req.destroy(); resolve(null); } else parts.push(c); });
      res.on('end', () => {
        const base = (u.pathname.split('/').filter(Boolean).slice(-2).join('-') || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 50);
        const fname = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        try { fs.writeFileSync(path.join(dir, fname), Buffer.concat(parts)); resolve(fname); } catch (e) { resolve(null); }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
async function importRoll20(room, user, b) {
  const docs = (Array.isArray(b.docs) ? b.docs : []).slice(0, 3000);
  const given = b.images && typeof b.images === 'object' ? b.images : {};
  const dir = path.join(campaignDir(room.c.id), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const done = new Map(), missing = new Set();
  let fetched = 0;
  const pic = async p => {
    if (!p || typeof p !== 'string') return null;
    if (p.startsWith('/')) return p;
    if (done.has(p)) return done.get(p);
    const clean = p.replace(/\?\d*$/, '');
    const base = clean.split(/[\\/]/).pop();
    let url = given[p] || given[clean] || null;
    if (!url && /^https?:\/\//i.test(clean) && fetched < 400) {
      fetched++;
      // Roll20 keeps each picture at several sizes; the original is the one worth having
      const best = clean.replace(/\/(thumb|med|max)\.(png|jpe?g|webp|gif)$/i, '/original.$2');
      const f = (best !== clean && await fetchPicture(best, dir)) || await fetchPicture(clean, dir);
      if (f) url = `/vtt-data/campaigns/${room.c.id}/assets/${f}`;
    }
    if (!url && base && !/^https?:/i.test(p)) url = given[base] || given[base.toLowerCase()] || null;
    if (!url) { missing.add(p); url = /^https?:\/\//i.test(p) ? p : null; }   // (a link to Roll20 still shows, while it lasts)
    done.set(p, url);
    return url;
  };
  const ops = [], out = { scenes: 0, characters: 0, handouts: 0, skipped: 0 }, byId = new Map(), byName = new Map();
  const pickSheet = attrs => (SHEETS[b.sheet] && b.sheet !== 'auto' ? b.sheet : null) || (SHEETS[Roll20.guessSheet(attrs)] ? Roll20.guessSheet(attrs) : null) || Object.keys(SHEETS).find(k => /^dnd5e/.test(k)) || 'dnd5e';
  for (const d of docs) {
    const k = Roll20.kindOf(d);
    if (k === 'character') {
      const r = Roll20.characterOf(d), sheet = pickSheet(r.attrs);
      const attrs = {}; for (const [n, v] of Object.entries(r.attrs).slice(0, 5000)) attrs[str(n, 120)] = str(v, 50000);
      const ch = { id: id('h'), name: str(r.name, 80) || 'Character', sheet, owners: [], shared: false, folder: null, created: now(), avatar: await pic(r.avatar), attrs, recalc: Object.keys(attrs) };
      if (r.id) byId.set(r.id, ch);
      byName.set(ch.name.toLowerCase(), ch);
      ops.push({ t: 'char.create', char: ch, restore: true });
      out.characters++;
      // a character's bio and GM notes: a handout beside it
      if (r.bio || r.gmnotes) {
        const ho = Object.assign({ id: id('o'), name: ch.name + ' (bio)', folder: null, img: null, text: '', gmNotes: '', shared: false, viewers: [], created: now() },
          cleanHandout({ text: await mdPictures(r.bio, pic), gmNotes: r.gmnotes }, room.c));
        ops.push({ t: 'handout.create', handout: ho, restore: true });
      }
    } else if (k === 'handout') {
      const r = Roll20.handoutOf(d);
      const ho = Object.assign({ id: id('o'), name: 'Handout', folder: null, img: null, text: '', gmNotes: '', shared: false, viewers: [], created: now() },
        cleanHandout({ name: r.name, img: await pic(r.img), text: await mdPictures(r.text, pic), gmNotes: r.gmNotes, shared: r.shared }, room.c));
      ops.push({ t: 'handout.create', handout: ho, restore: true });
      out.handouts++;
    }
  }
  for (const d of docs) {
    if (Roll20.kindOf(d) !== 'page') { if (!Roll20.kindOf(d)) out.skipped++; continue; }
    const f = Roll20.pageOf(d);
    const img = f.image ? await pic(f.image.url) : null;
    const sc = newScene({ name: f.name, kind: 'battle', grid: f.grid, darkness: f.darkness, vision: f.vision, fog: false, bg: f.bg, area: f.area, notes: '',
      image: img ? { url: img, w: f.image.w, h: f.image.h } : null });
    sc.walls = f.walls.slice(0, 20000).map(w => cleanWall(w));
    for (const t of f.tokens.slice(0, 2000)) {
      const ch = t._char ? byId.get(t._char) || null : null;
      const tok = newToken({ name: t.name || (ch && ch.name) || 'Token', x: t.x, y: t.y, size: t.size, img: await pic(t.img), layer: t.layer, rot: t.rot, nameShown: t.nameShown, flip: t.flip });
      if (t.hp && t.hp.max) tok.hp = t.hp;
      if (ch) {
        tok.sheet = ch.id;
        if (!tok.img && ch.avatar) tok.img = ch.avatar;
        if (!tok.hp) { const reg = SHEETS[ch.sheet] || {}, v = ch.attrs[reg.hp || 'hp'], max = ch.attrs[reg.hpMax || 'hp_max']; if (v != null && v !== '') tok.hp = { v: num(v, 0), max: num(max, 0) || num(v, 0) }; }
      }
      sc.tokens.push(tok);
    }
    ops.push({ t: 'scene.create', scene: sc, restore: true });
    out.scenes++;
  }
  if (ops.length) room.edit(user, { t: 'batch', ops });
  out.missing = [...missing].slice(0, 100);
  out.fetched = fetched;
  return out;
}
// ───────── import from D&D Beyond ─────────
function fetchJSON(url, hops = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('Not a link')); }
    const req = require('https').get(u, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (table import)', Accept: 'application/json' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) { res.resume(); return resolve(fetchJSON(new URL(res.headers.location, u).href, hops + 1)); }
      const parts = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) req.destroy(); else parts.push(c); });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { /* not JSON */ }
        if (res.statusCode === 200 && j) resolve(j);
        else reject(new Error(res.statusCode === 403 || res.statusCode === 404 || (j && j.success === false) ? 'D&D Beyond wouldn’t share it: set the character’s privacy to Public (on D&D Beyond: the character > Manage > Character Settings)' : `D&D Beyond answered ${res.statusCode}`));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('D&D Beyond took too long to answer')); });
    req.on('error', e => reject(new Error('Couldn’t reach D&D Beyond: ' + e.message)));
  });
}
async function importDDB(room, user, b) {
  const sheet = SHEETS[b.sheet] && /^dnd5e/.test(b.sheet) ? b.sheet : (Object.keys(SHEETS).find(k => /^dnd5e/.test(k)) || 'dnd5e');
  const dir = path.join(campaignDir(room.c.id), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const found = [], errors = [];
  for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, 20)) {
    const cid = DDB.idOf(l); if (!cid) { errors.push(`${str(l, 80)}: not a D&D Beyond character link`); continue; }
    try { found.push(await fetchJSON(DDB.apiUrl(cid))); } catch (e) { errors.push(`${cid}: ${e.message}`); }
  }
  for (const j of (Array.isArray(b.json) ? b.json : []).slice(0, 20)) found.push(j);
  const ops = [], names = [];
  for (const j of found) {
    if (!DDB.isDDB(j)) { errors.push('A file that isn’t a D&D Beyond character'); continue; }
    let r; try { r = DDB.modelOf(j); } catch (e) { errors.push('A character that couldn’t be read: ' + e.message); continue; }
    const attrs = Sheet5e.fromModel(sheet, r.model, {});
    let avatar = null;
    if (r.avatar && /^https?:\/\//.test(r.avatar)) { const f = await fetchPicture(r.avatar, dir); if (f) avatar = `/vtt-data/campaigns/${room.c.id}/assets/${f}`; }
    const ch = { id: id('h'), name: str(r.name, 80) || 'Character', sheet, owners: isGM(user) ? [] : [user.id], shared: false, folder: null, created: now(), avatar, attrs, recalc: Object.keys(attrs) };
    ops.push({ t: 'char.create', char: ch, restore: true });
    names.push(ch.name);
  }
  if (ops.length) room.edit(user, { t: 'batch', ops });
  return { characters: names, errors };
}
// the pictures in a handout's text, fetched too
async function mdPictures(text, pic) {
  let t = String(text || '');
  const urls = [...new Set([...t.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]))].slice(0, 30);
  for (const u of urls) { const v = await pic(u); if (v && v !== u) t = t.split(u).join(v); }
  return t;
}

// ───────── import from Foundry ─────────
function foundryDirs() {
  const home = os.homedir(), out = [];
  if (config.foundryData) out.push(config.foundryData, path.join(config.foundryData, 'Data'));
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'FoundryVTT', 'Data'));
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'FoundryVTT', 'Data'));
  out.push(path.join(home, 'AppData', 'Local', 'FoundryVTT', 'Data'), path.join(home, '.local', 'share', 'FoundryVTT', 'Data'), path.join(home, 'Library', 'Application Support', 'FoundryVTT', 'Data'));
  return [...new Set(out)];
}
const IMG_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
function importFoundry(room, user, b) {
  const docs = (Array.isArray(b.docs) ? b.docs : []).slice(0, 2000);
  const given = b.images && typeof b.images === 'object' ? b.images : {};   // pictures the GM picked by hand: Foundry path or file name -> our url
  const dir = path.join(campaignDir(room.c.id), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const done = new Map(), missing = new Set();
  // a Foundry picture path to one of ours: picked by hand, or copied from Foundry's data folder
  const pic = p => {
    if (!p || typeof p !== 'string') return null;
    if (/^https?:\/\//i.test(p)) return p;
    if (done.has(p)) return done.get(p);
    let dec = p; try { dec = decodeURIComponent(p); } catch (e) { /* as is */ }
    const base = dec.split(/[\\/]/).pop();
    let url = given[p] || given[dec] || given[base] || given[base.toLowerCase()] || null;
    if (!url && IMG_EXT.test(dec)) for (const d of foundryDirs()) {
      const full = path.resolve(d, dec.replace(/^[\\/]+/, ''));
      if (!full.startsWith(path.resolve(d) + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      const name = base.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 50) || 'image';
      const fname = `${name}-${crypto.randomBytes(4).toString('hex')}${path.extname(full).toLowerCase()}`;
      fs.copyFileSync(full, path.join(dir, fname));
      url = `/vtt-data/campaigns/${room.c.id}/assets/${fname}`;
      break;
    }
    if (!url && !/^icons\/(svg|svg\/)|mystery-man/.test(dec)) missing.add(dec);   // Foundry's own stock icons aren't worth asking about
    done.set(p, url);
    return url;
  };
  const sheet = SHEETS[b.sheet] && /^dnd5e/.test(b.sheet) ? b.sheet : 'dnd5e';
  const ops = [], actorIds = new Map(), out = { scenes: 0, characters: 0, skipped: 0 };
  for (const d of docs) {
    if (Foundry.kindOf(d) !== 'actor') continue;
    const model = Foundry.actorModel(d);
    const attrs = Sheet5e.fromModel(sheet, model, {});
    const sys = d.system || d.data || {};
    const dark = num(sys.attributes && sys.attributes.senses && sys.attributes.senses.darkvision, 0);
    const ch = { id: id('h'), name: str(d.name, 80) || 'Character', sheet, owners: [], shared: false, folder: null, created: now(),
      avatar: pic(d.img && !/mystery-man/.test(d.img) ? d.img : (d.prototypeToken && d.prototypeToken.texture && d.prototypeToken.texture.src) || (d.token && d.token.img) || null),
      attrs, recalc: Object.keys(attrs) };
    actorIds.set(d._id, { ch, dark });
    ops.push({ t: 'char.create', char: ch, restore: true });
    out.characters++;
  }
  for (const d of docs) {
    const k = Foundry.kindOf(d);
    if (k === 'actor') continue;
    if (k !== 'scene') { out.skipped++; continue; }
    const f = Foundry.sceneOf(d);
    const sc = newScene({ name: f.name, kind: 'battle', grid: f.grid, darkness: f.darkness, vision: f.vision, fog: false, bg: f.bg, area: f.area, notes: f.notes,
      image: f.image ? { url: pic(f.image.url) || '', w: f.image.w, h: f.image.h } : null });
    if (sc.image && !sc.image.url) sc.image = null;
    sc.walls = f.walls.map(w => cleanWall(w));
    sc.lights = f.lights.map(l => cleanLight(l));
    for (const t of f.tokens) {
      const a = t._actor && actorIds.get(t._actor);
      const tok = newToken({ name: t.name, x: t.x, y: t.y, size: t.size, img: pic(t.img), layer: t.layer, rot: t.rot, nameShown: t.nameShown, sight: t.sight, light: t.light });
      if (a) {
        tok.sheet = a.ch.id;
        if (!tok.img && a.ch.avatar) tok.img = a.ch.avatar;
        const reg = SHEETS[a.ch.sheet] || {}, v = a.ch.attrs[reg.hp || 'hp'], max = a.ch.attrs[reg.hpMax || 'hp_max'];
        if (v != null && v !== '') tok.hp = { v: num(v, 0), max: num(max, 0) || num(v, 0) };
        if (tok.sight && a.dark && !tok.sight.dark) tok.sight.dark = a.dark;
      }
      sc.tokens.push(tok);
    }
    ops.push({ t: 'scene.create', scene: sc, restore: true });
    out.scenes++;
  }
  if (ops.length) room.edit(user, { t: 'batch', ops });
  out.missing = [...missing].slice(0, 100);
  return out;
}
function newScene(p) {
  return Object.assign({ id: id('s'), name: 'Scene', image: null, grid: cleanGrid({}), darkness: 0, fog: false, vision: false, notes: '', bg: '#1b1d22', area: { cols: 30, rows: 20 },
    explored: 0, tokens: [], templates: [], fogShapes: [], walls: [], lights: [], sounds: [] }, cleanSceneMeta(p || {}), { id: id('s') });
}
const TOKEN_KEYS = ['name', 'x', 'y', 'size', 'img', 'color', 'owners', 'layer', 'hp', 'bar2', 'conditions', 'barsPublic', 'nameShown', 'sheet', 'rot', 'flip'];
const PLAYER_TOKEN_KEYS = ['x', 'y', 'hp', 'bar2', 'conditions', 'rot', 'flip', 'light'];
const WALL_KINDS = ['wall', 'door', 'secret', 'window', 'invisible', 'oneway', 'shade'];
const LIGHT_ANIMS = ['none', 'torch', 'candle', 'pulse', 'fairy', 'sunbeam'];
const pt = p => [num(p && p[0], 0, -1e5, 1e5), num(p && p[1], 0, -1e5, 1e5)];
function cleanWall(p, base) {
  const w = Object.assign({ id: id('w'), a: [0, 0], b: [0, 0], kind: 'wall', open: false, locked: false, flip: false }, base || {});
  if ('a' in p) w.a = pt(p.a);
  if ('b' in p) w.b = pt(p.b);
  if ('kind' in p) w.kind = WALL_KINDS.includes(p.kind) ? p.kind : 'wall';
  if ('open' in p) w.open = !!p.open;
  if ('locked' in p) w.locked = !!p.locked;
  if ('flip' in p) w.flip = !!p.flip;
  return w;
}
function cleanLightProps(p, out) {
  if ('bright' in p) out.bright = num(p.bright, 0, 0, 1000);
  if ('dim' in p) out.dim = num(p.dim, 0, 0, 1000);
  if ('color' in p) out.color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#ffd9a0';
  if ('intensity' in p) out.intensity = num(p.intensity, 0.5, 0, 1);
  if ('angle' in p) out.angle = num(p.angle, 360, 1, 360);
  if ('dir' in p) out.dir = num(p.dir, 0, -360, 360);
  if ('anim' in p) out.anim = LIGHT_ANIMS.includes(p.anim) ? p.anim : 'none';
  return out;
}
function cleanLight(p, base) {
  const l = Object.assign({ id: id('l'), x: 0, y: 0, bright: 20, dim: 40, color: '#ffc477', intensity: 0.5, angle: 360, dir: 0, anim: 'none' }, base || {});
  if ('x' in p) l.x = num(p.x, 0, -1e5, 1e5);
  if ('y' in p) l.y = num(p.y, 0, -1e5, 1e5);
  return cleanLightProps(p, l);
}
// an ambient sound on a battle map: a looped sound heard within its range, louder nearer; walls can stop it, muffle it,
// or let it through
const SOUND_WALLS = ['through', 'muffle', 'block'];
function cleanSound(p, base) {
  const o = Object.assign({ id: id('n'), x: 0, y: 0, url: '', name: 'Sound', range: 30, vol: 0.7, walls: 'muffle', on: true }, base || {});
  if ('x' in p) o.x = num(p.x, 0, -1e5, 1e5);
  if ('y' in p) o.y = num(p.y, 0, -1e5, 1e5);
  if ('url' in p) o.url = str(p.url, 300);
  if ('name' in p) o.name = str(p.name, 80) || 'Sound';
  if ('range' in p) o.range = num(p.range, 30, 1, 2000);
  if ('vol' in p) o.vol = num(p.vol, 0.7, 0, 1);
  if ('walls' in p) o.walls = SOUND_WALLS.includes(p.walls) ? p.walls : 'muffle';
  if ('on' in p) o.on = !!p.on;
  return o;
}
function cleanBar(b) { return b ? { v: num(b.v, 0, -1e6, 1e6), max: num(b.max, 0, 0, 1e6) } : null; }
function cleanTokenPatch(p) {
  const out = {};
  if ('name' in p) out.name = str(p.name, 60);
  if ('x' in p) out.x = num(p.x, 0, -1e5, 1e5);
  if ('y' in p) out.y = num(p.y, 0, -1e5, 1e5);
  if ('size' in p) out.size = num(p.size, 1, 0.25, 30);
  if ('img' in p) out.img = p.img ? str(p.img, 300) : null;
  if ('color' in p) out.color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#888888';
  if ('owners' in p) out.owners = (Array.isArray(p.owners) ? p.owners : []).map(x => str(x, 40)).filter(userById).slice(0, 20);
  if ('layer' in p) out.layer = p.layer === 'gm' || p.layer === 'map' ? p.layer : 'tokens';   // map: part of the scenery, under the tokens
  if ('hp' in p) out.hp = cleanBar(p.hp);
  if ('bar2' in p) out.bar2 = cleanBar(p.bar2);
  if ('conditions' in p) out.conditions = (Array.isArray(p.conditions) ? p.conditions : []).map(x => str(x, 30)).slice(0, CONDITIONS_MAX);
  if ('barsPublic' in p) out.barsPublic = !!p.barsPublic;
  if ('nameShown' in p) out.nameShown = !!p.nameShown;
  if ('sheet' in p) out.sheet = p.sheet ? str(p.sheet, 80) : null;
  if ('rot' in p) out.rot = num(p.rot, 0, -360, 360);
  if ('flip' in p) out.flip = !!p.flip;
  if ('item' in p) out.item = p.item ? cleanItem(p.item) : null;   // an item lying on the map: click it for its card
  if ('ring' in p) out.ring = p.ring === true || p.ring === false ? p.ring : null;   // null: as the scene says
  if ('scale' in p) out.scale = Math.round(num(p.scale, 1, 0.1, 6) * 100) / 100;      // the picture's size within the token
  if ('pixel' in p) out.pixel = !!p.pixel;                                          // pixel art: keep it crisp
  if ('sight' in p) out.sight = p.sight ? { on: !!p.sight.on, range: num(p.sight.range, 0, 0, 5000), dark: num(p.sight.dark, 0, 0, 5000) } : null;
  if ('light' in p) out.light = p.light ? cleanLightProps(p.light, { bright: 0, dim: 0, color: '#ffc477', intensity: 0.5, angle: 360, dir: 0, anim: 'torch' }) : null;
  // a prop: scenery from the art tool, any width and height (in squares), which may block light and sight
  if ('prop' in p) out.prop = !!p.prop;
  if ('w' in p) out.w = p.w == null ? null : Math.round(num(p.w, 1, 0.05, 400) * 1000) / 1000;
  if ('h' in p) out.h = p.h == null ? null : Math.round(num(p.h, 1, 0.05, 400) * 1000) / 1000;
  if ('blocks' in p) out.blocks = !!p.blocks;
  if ('container' in p) out.container = p.container ? cleanContainer(p.container) : null;
  if ('snap' in p) out.snap = p.snap === false ? false : null;   // false: moves and sizes freely, off the grid
  return out;
}
// a chest, a barrel, a crate: what's in it, or the loot table it's filled from (now, or when it's first opened)
function cleanContainer(p) {
  const o = { items: [], table: p.table ? str(p.table, 60) : null, rolled: !!p.rolled, locked: !!p.locked };
  for (const e of (Array.isArray(p.items) ? p.items : []).slice(0, 200)) if (e && e.item) o.items.push({ uid: str(e.uid, 40) || id('v'), item: cleanItem(e.item), qty: Math.round(num(e.qty, 1, 1, 99999)) });
  return o;
}
function cleanLootTable(p) {
  p = p && typeof p === 'object' ? p : {};
  const dice = v => { const s = str(v, 30).trim(); if (!s) return ''; try { if (!/^\d+$/.test(s)) Dice.roll(s); return s; } catch (e) { return ''; } };
  const coins = {}; for (const k of ['cp', 'sp', 'ep', 'gp', 'pp']) { const d = dice(p.coins && p.coins[k]); if (d) coins[k] = d; }
  return { id: p.id && /^[a-z0-9_-]{1,30}$/i.test(p.id) && !/^preset/.test(p.id) ? p.id : id('l'), name: str(p.name, 80) || 'Loot table', picks: dice(p.picks) || '1',
    entries: (Array.isArray(p.entries) ? p.entries : []).slice(0, 300).filter(e => e && (e.ref || e.item)).map(e => Object.assign(
      e.item ? { item: cleanItem(e.item) } : { ref: str(e.ref, 80) }, { w: num(e.w, 1, 0, 1000), qty: dice(e.qty) || '1' })),
    coins };
}
// a token a player controls: it belongs on the token layer, where players work
function playerTokenish(t, c) { return (t.owners || []).some(id => { const u = userById(id); return u && roleIn(c, u) !== 'gm'; }); }
// a character's players: its owners who aren't GMs (a GM owning it just means they made it)
function playerOwners(ch, c) { return (ch.owners || []).filter(id => { const u = userById(id); return u && roleIn(c, u) !== 'gm'; }); }
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
function linkToken(t, ch, c) {
  const reg = SHEETS[ch.sheet] || {}, v = ch.attrs[(reg.hp || 'hp').toLowerCase()], max = ch.attrs[(reg.hpMax || 'hp_max').toLowerCase()];
  if (v != null && v !== '') t.hp = { v: num(v, 0), max: num(max, 0) || num(v, 0) };
  if (!t.owners.length && playerOwners(ch, c).length) t.owners = playerOwners(ch, c);
}
function cleanHandout(p, c) {
  const out = {};
  if ('name' in p) out.name = str(p.name, 120) || 'Handout';
  if ('img' in p) out.img = p.img ? str(p.img, 300) : null;
  if ('text' in p) out.text = str(p.text, 60000);
  if ('gmNotes' in p) out.gmNotes = str(p.gmNotes, 30000);
  if ('shared' in p) out.shared = !!p.shared;
  if ('viewers' in p) out.viewers = (Array.isArray(p.viewers) ? p.viewers : []).map(x => str(x, 40)).filter(userById).slice(0, 50);
  if ('folder' in p) out.folder = c.charFolders.some(f => f.id === p.folder) ? p.folder : null;
  return out;
}
// ───────── item cards ─────────
// An item: { id, name, kind, type, rarity, attune, cost, weight, text (markdown), icon, img, ac, props, weapon }.
// Cards travel whole (into inventories, onto the map, into chat), so an edit to the GM's card doesn't change copies.
const ITEM_KINDS = ['weapon', 'armor', 'gear', 'tool', 'mount', 'magic', 'treasure', 'other'];
const RARITIES = ['mundane', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
function cleanItem(p) {
  p = p && typeof p === 'object' ? p : {};
  const it = { id: str(p.id, 80) || id('i'), name: str(p.name, 120) || 'Item', kind: ITEM_KINDS.includes(p.kind) ? p.kind : 'other',
    type: str(p.type, 120), rarity: RARITIES.includes(p.rarity) ? p.rarity : 'mundane' };
  if (p.attune) it.attune = p.attune === true ? true : str(p.attune, 80) || true;
  for (const [k, n] of [['cost', 40], ['icon', 30], ['gi', 60], ['img', 300], ['ac', 40], ['notes', 4000]]) if (p[k]) it[k] = str(p[k], n);
  if (p.text) it.text = str(p.text, 30000);
  if (p.weight != null && p.weight !== '') it.weight = num(p.weight, 0, 0, 1e6);
  if (Array.isArray(p.props) && p.props.length) it.props = p.props.slice(0, 16).map(x => str(x, 60));
  if (p.weapon && typeof p.weapon === 'object') it.weapon = { damage: str(p.weapon.damage, 40), dtype: str(p.weapon.dtype, 30), range: str(p.weapon.range, 40),
    ranged: !!p.weapon.ranged, finesse: !!p.weapon.finesse, magic: num(p.weapon.magic, 0, -10, 10) };
  return it;
}
const plainText = md => String(md || '').replace(/\*\*|__|\*|`/g, '').replace(/^#+\s*/gm, '').trim();

function newToken(p) {
  return Object.assign({ id: id('t'), name: 'Token', x: 0, y: 0, size: 1, img: null, color: '#8a6d3b', owners: [], layer: 'tokens',
    hp: null, bar2: null, conditions: [], barsPublic: false, nameShown: true, sheet: null, rot: 0, flip: false }, cleanTokenPatch(p || {}));
}
function cleanTemplate(p, uid) {
  return { id: p.id && /^[a-z0-9]{1,30}$/i.test(p.id) ? p.id : id('a'), kind: ['cone', 'circle', 'line', 'square'].includes(p.kind) ? p.kind : 'circle',
    x: num(p.x), y: num(p.y), angle: num(p.angle, 0, -10, 10), len: num(p.len, 20, 0, 5000), width: num(p.width, 5, 0, 500),
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#c9a45c', owner: uid };
}
function cleanFogShape(s) {
  const base = { id: id('f'), mode: s.mode === 'hide' ? 'hide' : 'reveal' };
  if (s.k === 'rect') return Object.assign(base, { k: 'rect', x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h) });
  if (s.k === 'circle') return Object.assign(base, { k: 'circle', x: num(s.x), y: num(s.y), r: num(s.r, 0, 0, 1e5) });
  if (s.k === 'poly' && Array.isArray(s.pts) && s.pts.length >= 6) return Object.assign(base, { k: 'poly', pts: s.pts.slice(0, 4000).map(v => num(v)) });
  throw new Error('Bad fog shape');
}
function cleanInit(init, c) {
  const entries = (Array.isArray(init.entries) ? init.entries : []).slice(0, 100).map(e => ({
    id: e.id && /^[a-z0-9]{1,30}$/i.test(e.id) ? e.id : id('i'), name: str(e.name, 60), value: num(e.value, 0, -1000, 1000),
    tokenId: e.tokenId ? str(e.tokenId, 40) : null, scene: e.scene ? str(e.scene, 40) : null, hidden: !!e.hidden }));
  return { entries, turn: Math.max(0, Math.min(entries.length - 1, Math.floor(num(init.turn, 0)))), round: Math.max(1, Math.floor(num(init.round, 1, 1, 1e6))) };
}

// ───────────────────────── a campaign in play ─────────────────────────

class Room {
  constructor(c) {
    this.c = c;
    this.conns = new Set();
    this.stacks = new Map();   // uid -> { undo: [], redo: [] }
    this.pending = new Map();  // startRoll results waiting for finishRoll
    setImmediate(() => { if (this.c.audio) this.audioTimers(); });
  }
  file() { return path.join(campaignDir(this.c.id), 'campaign.json'); }
  save() { saveSoon(this.file(), () => this.c); }
  scene(sid) { const s = this.c.scenes.find(x => x.id === sid); if (!s) throw new Error('No such scene'); return s; }
  token(s, tid) { const t = s.tokens.find(x => x.id === tid); if (!t) throw new Error('No such token'); return t; }

  // Check, apply and return the op that undoes it. Throws if not allowed.
  apply(user, op) {
    const c = this.c, gm = isGM(user);
    const needGM = () => { if (!gm) throw new Error('Only the GM can do that'); };
    switch (op.t) {
      case 'batch': {
        const inv = [];
        try { for (const o of (op.ops || []).slice(0, 500)) inv.unshift(this.apply(user, o)); }
        catch (e) { for (const o of inv) this.apply(user, o); throw e; }   // all or nothing
        return { t: 'batch', ops: inv };
      }
      case 'campaign.update': {
        needGM();
        const prev = {}, p = op.patch || {};
        for (const k of ['name', 'mode', 'playerScene', 'watch']) if (k in p) {
          prev[k] = k === 'watch' ? c.watch !== false : c[k] ?? null;
          if (k === 'watch') c.watch = p.watch !== false;
          if (k === 'name') c.name = str(p.name, 80) || c.name;
          if (k === 'mode') c.mode = p.mode === '2d6' ? '2d6' : '5e';
          if (k === 'playerScene') c.playerScene = p.playerScene && c.scenes.some(s => s.id === p.playerScene) ? p.playerScene : null;
        }
        return { t: 'campaign.update', patch: prev };
      }
      case 'scene.create': {
        needGM();
        const s = op.scene && op.scene.id && op.restore ? op.scene : newScene(op.scene);
        if (c.scenes.some(x => x.id === s.id)) throw new Error('Scene exists');
        if (s.clock && !op.restore) { const k = roomTime(this, true); s.darkness = Cal.darkness(k.cal, k.t); }
        if (s.plan && !op.restore) { this.syncPlanWalls(s); this.syncPlanLights(s); }
        const at = Number.isInteger(op.index) ? Math.min(op.index, c.scenes.length) : c.scenes.length;
        c.scenes.splice(at, 0, s);
        if (!c.playerScene) c.playerScene = s.id;
        op.scene = s;   // so the sender learns the id
        return { t: 'scene.delete', id: s.id };
      }
      case 'scene.update': {
        needGM();
        const s = this.scene(op.id), p = cleanSceneMeta(op.patch || {}), prev = {};
        // a plan edited from an older version than the scene's (someone else changed it meanwhile): the two put together
        if (p.plan && op.base && s.plan && !op.restore) { const base = Plan.normalize(op.base); if (JSON.stringify(base) !== JSON.stringify(s.plan)) p.plan = Plan.merge(base, s.plan, p.plan); }
        if (p.clock && !op.restore) { const k = roomTime(this, true); p.darkness = Cal.darkness(k.cal, k.t); }   // following the clock: dark as it is outside now
        for (const k of Object.keys(p)) { prev[k] = clone(s[k] ?? null); s[k] = p[k]; }
        if (('image' in p && !s.plan) || ('plan' in p && !p.plan)) delete s.thumb;   // a new map: its old picture goes (the GM's browser makes another)
        if ('plan' in p || ('grid' in p && s.plan)) { this.syncPlanWalls(s); this.syncPlanLights(s); }   // the plan's walls and lights follow it
        if ('plan' in p && JSON.stringify(prev.plan) !== JSON.stringify(s.plan)) this.planChanged(s, prev.plan, s.plan, user, op.note);
        this.wallsChanged(s);
        return { t: 'scene.update', id: s.id, patch: prev };
      }
      case 'scene.delete': {
        needGM();
        const i = c.scenes.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such scene');
        const [s] = c.scenes.splice(i, 1);
        if (c.playerScene === s.id) c.playerScene = c.scenes[0] ? c.scenes[0].id : null;
        return { t: 'scene.create', scene: s, index: i, restore: true };
      }
      case 'token.create': {
        if (!op.restore) needGM();
        const s = this.scene(op.scene);
        const t = op.restore ? op.token : newToken(op.token);
        if (!op.restore && t.sheet) {   // a token made from a character: its picture, name, HP and players
          const ch = c.characters.find(x => x.id === t.sheet);
          if (!ch) t.sheet = null; else { if (!t.img && ch.avatar) t.img = ch.avatar; linkToken(t, ch, c); }
        }
        if (!op.restore && t.layer === 'map' && playerTokenish(t, c)) t.layer = 'tokens';   // the players' tokens live on the token layer
        if (s.tokens.some(x => x.id === t.id)) throw new Error('Token exists');
        const at = Number.isInteger(op.index) ? Math.min(op.index, s.tokens.length) : s.tokens.length;
        s.tokens.splice(at, 0, t);
        op.token = t;
        return { t: 'token.delete', scene: s.id, id: t.id };
      }
      case 'token.update': {
        const s = this.scene(op.scene), t = this.token(s, op.id);
        let p = cleanTokenPatch(op.patch || {});
        if (!gm) {
          if (!t.owners.includes(user.id)) throw new Error('That isn’t your token');
          p = Object.fromEntries(Object.entries(p).filter(([k]) => PLAYER_TOKEN_KEYS.includes(k)));
          if (('x' in p || 'y' in p) && Vision.moveBlocked(s.walls, t.x, t.y, 'x' in p ? p.x : t.x, 'y' in p ? p.y : t.y)) throw new Error('A wall is in the way');
        }
        const prev = {};
        for (const k of Object.keys(p)) { prev[k] = clone(t[k] ?? null); t[k] = p[k]; }
        if (t.sheet && 'hp' in p && p.hp) {   // a linked token's hit points are the character's
          const ch = c.characters.find(x => x.id === t.sheet), reg = ch && (SHEETS[ch.sheet] || {});
          if (ch) setImmediate(() => this.setCharAttrs(ch, { [(reg.hp || 'hp')]: String(p.hp.v), [(reg.hpMax || 'hp_max')]: String(p.hp.max) }, []));
        }
        if ('sheet' in p && p.sheet) {
          if (!('hp' in prev)) prev.hp = clone(t.hp ?? null);
          if (!('owners' in prev)) prev.owners = clone(t.owners);
          const ch = c.characters.find(x => x.id === p.sheet);
          if (!ch) t.sheet = null; else linkToken(t, ch, c);
        }
        if (t.layer === 'map' && playerTokenish(t, c)) { if (!('layer' in prev)) prev.layer = 'map'; t.layer = 'tokens'; }
        return { t: 'token.update', scene: s.id, id: t.id, patch: prev };
      }
      case 'token.delete': {
        if (!op.restore) needGM();
        const s = this.scene(op.scene), i = s.tokens.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such token');
        const [t] = s.tokens.splice(i, 1);
        return { t: 'token.create', scene: s.id, token: t, index: i, restore: true };
      }
      case 'token.order': {   // to front / to back
        needGM();
        const s = this.scene(op.scene), i = s.tokens.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such token');
        const [t] = s.tokens.splice(i, 1);
        const to = op.to === 'back' ? 0 : op.to === 'front' ? s.tokens.length : Math.max(0, Math.min(s.tokens.length, op.index | 0));
        s.tokens.splice(to, 0, t);
        return { t: 'token.order', scene: s.id, id: t.id, index: i };
      }
      case 'template.create': {
        const s = this.scene(op.scene);
        const a = op.restore ? op.tpl : cleanTemplate(op.tpl || {}, user.id);
        if (s.templates.some(x => x.id === a.id)) throw new Error('Template exists');
        s.templates.push(a);
        if (s.templates.length > 200) s.templates.shift();
        op.tpl = a;
        return { t: 'template.delete', scene: s.id, id: a.id };
      }
      case 'template.update': {
        const s = this.scene(op.scene), a = s.templates.find(x => x.id === op.id);
        if (!a) throw new Error('No such template');
        if (!gm && a.owner !== user.id) throw new Error('That isn’t your template');
        const p = cleanTemplate(Object.assign({}, a, op.patch || {}), a.owner), prev = {};
        for (const k of ['x', 'y', 'angle', 'len', 'width', 'kind', 'color']) if (op.patch && k in op.patch) { prev[k] = a[k]; a[k] = p[k]; }
        return { t: 'template.update', scene: s.id, id: a.id, patch: prev };
      }
      case 'template.delete': {
        const s = this.scene(op.scene), i = s.templates.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such template');
        if (!gm && s.templates[i].owner !== user.id) throw new Error('That isn’t your template');
        const [a] = s.templates.splice(i, 1);
        return { t: 'template.create', scene: s.id, tpl: a, restore: true };
      }
      // ── walls and doors ──
      case 'wall.add': {      // { scene, walls: [{ a, b, kind, … }] }; restore puts back exactly what was removed
        needGM();
        const s = this.scene(op.scene); this.wallsChanged(s);
        const ws = (Array.isArray(op.walls) ? op.walls : []).slice(0, 500).map(w => op.restore ? w : cleanWall(w || {}));
        if (s.walls.length + ws.length > 5000) throw new Error('That’s a lot of walls: 5000 per scene at most');
        for (const w of ws) if (s.walls.some(x => x.id === w.id)) throw new Error('Wall exists');
        s.walls.push(...ws);
        op.walls = ws.map(w => ({ id: w.id }));
        return { t: 'wall.delete', scene: s.id, ids: ws.map(w => w.id) };
      }
      case 'wall.update': {   // { scene, id, patch }
        needGM();
        const s = this.scene(op.scene), w = s.walls.find(x => x.id === op.id); this.wallsChanged(s);
        if (!w) throw new Error('No such wall');
        const prev = {}, nw = cleanWall(op.patch || {}, w);
        for (const k of ['a', 'b', 'kind', 'open', 'locked', 'flip']) if (op.patch && k in op.patch) { prev[k] = clone(w[k]); w[k] = nw[k]; }
        return { t: 'wall.update', scene: s.id, id: w.id, patch: prev };
      }
      case 'wall.delete': {
        needGM();
        const s = this.scene(op.scene), ids = new Set(Array.isArray(op.ids) ? op.ids : [op.id]); this.wallsChanged(s);
        const gone = s.walls.filter(w => ids.has(w.id));
        s.walls = s.walls.filter(w => !ids.has(w.id));
        return { t: 'wall.add', scene: s.id, walls: gone, restore: true };
      }
      case 'door.toggle': {   // players may open and close doors they can see, unless locked
        const s = this.scene(op.scene), w = s.walls.find(x => x.id === op.id); this.wallsChanged(s);
        if (!w || !(w.kind === 'door' || (w.kind === 'secret' && gm))) throw new Error('No such door');
        if (!gm && w.locked) throw new Error('locked');
        const prev = w.open;
        w.open = 'open' in op ? !!op.open : !w.open;
        return { t: 'door.toggle', scene: s.id, id: w.id, open: prev };
      }
      // ── lights ──
      case 'light.add': {
        needGM();
        const s = this.scene(op.scene);
        const l = op.restore ? op.light : cleanLight(op.light || {});
        if (s.lights.length >= 500) throw new Error('500 lights per scene at most');
        if (op.restore && l.src === 'plan' && s.planDark) s.planDark = s.planDark.filter(k => k !== l.key);
        if (s.lights.some(x => x.id === l.id)) throw new Error('Light exists');
        s.lights.push(l);
        op.light = { id: l.id };
        return { t: 'light.delete', scene: s.id, id: l.id };
      }
      case 'light.update': {
        needGM();
        const s = this.scene(op.scene), l = s.lights.find(x => x.id === op.id);
        if (!l) throw new Error('No such light');
        const prev = {}, nl = cleanLight(op.patch || {}, l);
        for (const k of ['x', 'y', 'bright', 'dim', 'color', 'intensity', 'angle', 'dir', 'anim']) if (op.patch && k in op.patch) { prev[k] = l[k]; l[k] = nl[k]; }
        return { t: 'light.update', scene: s.id, id: l.id, patch: prev };
      }
      case 'light.delete': {
        needGM();
        const s = this.scene(op.scene), i = s.lights.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such light');
        const [l] = s.lights.splice(i, 1);
        if (l.src === 'plan' && l.key) s.planDark = [...new Set([...(s.planDark || []), l.key])].slice(-500);   // the plan won't light it again
        return { t: 'light.add', scene: s.id, light: l, restore: true };
      }
      // ── ambient sounds ──
      case 'sound.add': {
        needGM();
        const s = this.scene(op.scene);
        const o = op.restore ? op.sound : cleanSound(op.sound || {});
        if (s.sounds.length >= 200) throw new Error('200 sounds per scene at most');
        if (s.sounds.some(x => x.id === o.id)) throw new Error('Sound exists');
        s.sounds.push(o);
        op.sound = { id: o.id };
        return { t: 'sound.delete', scene: s.id, id: o.id };
      }
      case 'sound.update': {
        needGM();
        const s = this.scene(op.scene), o = s.sounds.find(x => x.id === op.id);
        if (!o) throw new Error('No such sound');
        const prev = {}, n = cleanSound(op.patch || {}, o);
        for (const k of ['x', 'y', 'url', 'name', 'range', 'vol', 'walls', 'on']) if (op.patch && k in op.patch) { prev[k] = o[k]; o[k] = n[k]; }
        return { t: 'sound.update', scene: s.id, id: o.id, patch: prev };
      }
      case 'sound.delete': {
        needGM();
        const s = this.scene(op.scene), i = s.sounds.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such sound');
        const [o] = s.sounds.splice(i, 1);
        return { t: 'sound.add', scene: s.id, sound: o, restore: true };
      }
      case 'fog.add': {
        needGM();
        const s = this.scene(op.scene), f = op.restore ? op.shape : cleanFogShape(op.shape || {});
        const at = Number.isInteger(op.index) ? Math.min(op.index, s.fogShapes.length) : s.fogShapes.length;
        s.fogShapes.splice(at, 0, f);
        if (s.fogShapes.length > 2000) throw new Error('Too much fog drawing: reset the fog');
        return { t: 'fog.remove', scene: s.id, id: f.id };
      }
      case 'fog.remove': {
        needGM();
        const s = this.scene(op.scene), i = s.fogShapes.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such fog shape');
        const [f] = s.fogShapes.splice(i, 1);
        return { t: 'fog.add', scene: s.id, shape: f, index: i, restore: true };
      }
      case 'fog.set': {
        needGM();
        const s = this.scene(op.scene), prev = s.fogShapes;
        s.fogShapes = op.restore ? op.shapes : (op.shapes || []).map(cleanFogShape);
        return { t: 'fog.set', scene: s.id, shapes: prev, restore: true };
      }
      case 'char.create': {
        const ch = op.restore ? op.char : {
          id: id('h'), name: str(op.char && op.char.name, 80) || 'New character',
          sheet: SHEETS[op.char && op.char.sheet] ? op.char.sheet : (Object.keys(SHEETS).find(k => SHEETS[k].mode === c.mode) || Object.keys(SHEETS)[0] || 'dnd5e'),
          owners: [user.id], avatar: null, shared: false, attrs: {}, created: now() };   // whoever makes it owns it (the GM too: give it to a player after)
        if (c.characters.some(x => x.id === ch.id)) throw new Error('Character exists');
        c.characters.push(ch);
        op.char = { id: ch.id };
        return { t: 'char.delete', id: ch.id };
      }
      case 'char.update': {
        const ch = this.character(op.id);
        const mine = ch.owners.includes(user.id);
        if (!gm && !mine) throw new Error('That isn’t your character');
        const p = op.patch || {}, prev = {};
        for (const k of ['name', 'avatar', 'token', 'owners', 'shared', 'sheet', 'folder']) if (k in p) {
          if (!gm && (k === 'owners' || k === 'shared' || k === 'folder')) continue;
          // owners may switch between sheets of the same game (the two 5e sheets)
          if (!gm && k === 'sheet' && !(SHEETS[p.sheet] && SHEETS[ch.sheet] && SHEETS[p.sheet].mode === SHEETS[ch.sheet].mode)) continue;
          prev[k] = clone(ch[k] ?? null);
          if (k === 'name') ch.name = str(p.name, 80) || ch.name;
          if (k === 'avatar') ch.avatar = p.avatar ? str(p.avatar, 300) : null;
          if (k === 'token') ch.token = p.token ? str(p.token, 300) : null;
          if (k === 'owners') {
            const before = playerOwners(ch, c);
            ch.owners = (Array.isArray(p.owners) ? p.owners : []).map(x => str(x, 40)).filter(userById);
            // its tokens follow: whoever plays it now moves them (tokens someone else was given by hand are left alone)
            const now_ = playerOwners(ch, c);
            for (const sc of c.scenes) for (const t of sc.tokens) if (t.sheet === ch.id && (!t.owners.length || sameSet(t.owners, before))) t.owners = now_.slice();
          }
          if (k === 'shared') ch.shared = !!p.shared;
          if (k === 'sheet' && SHEETS[p.sheet] && p.sheet !== ch.sheet) {
            // carry the character across: the new sheet gets the old one's numbers, names and lists
            if (!op.restore && /^dnd5e/.test(ch.sheet) && /^dnd5e/.test(p.sheet)) {
              // what was changed on this sheet since the last switch goes across (the snapshot: how this sheet was left then)
              const snap = ch.sync5e && ch.sync5e.sheet === ch.sheet ? ch.sync5e.model : null;
              const { set, model } = Sheet5e.sync(ch.sheet, p.sheet, ch.attrs, snap);
              for (const [k, v] of Object.entries(set)) { if (v === null) delete ch.attrs[k]; else ch.attrs[k] = v; }
              ch.sync5e = { sheet: p.sheet, model };
              delete ch.attrs.tab;   // both sheets keep their page in "tab", with different values: start on the new sheet's first page
              ch.recalc = [...new Set((ch.recalc || []).concat(Object.keys(set).filter(k => set[k] !== null)))].slice(0, 3000);
            }
            ch.sheet = p.sheet;
            for (const conn of this.conns) if (conn.chars && conn.chars.has(ch.id)) send(conn, { t: 'charSheet', char: ch.id, sheet: ch.sheet });
          }
          if (k === 'folder') ch.folder = c.charFolders.some(f => f.id === p.folder) ? p.folder : null;
        }
        if ('name' in p) this.charBroadcast(ch, { name: ch.name });
        return { t: 'char.update', id: ch.id, patch: prev };
      }
      case 'char.delete': {
        const i = c.characters.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such character');
        if (!gm && !c.characters[i].owners.includes(user.id)) throw new Error('That isn’t your character');
        const [ch] = c.characters.splice(i, 1);
        for (const conn of this.conns) if (conn.chars && conn.chars.has(ch.id)) send(conn, { t: 'charGone', char: ch.id });
        return { t: 'char.create', char: ch, restore: true };
      }
      case 'char.copy': {   // one of your characters from another campaign, copied into this one (its picture too)
        if (op.restore) { c.characters.push(op.char); return { t: 'char.delete', id: op.char.id }; }
        const src = getRoom(str(op.from, 40));
        if (!src || src.c.id === c.id || !canSee(user, src.c)) throw new Error('No such campaign');
        const sc = src.c.characters.find(x => x.id === op.id);
        if (!sc || !(isGM(user) || sc.owners.includes(user.id))) throw new Error('That isn’t your character');
        const ch = clone(sc);
        ch.id = id('h'); ch.owners = [user.id]; ch.folder = null; ch.shared = false; ch.created = now(); ch.copiedFrom = { camp: src.c.id, id: sc.id };
        const m = /^\/vtt-data\/campaigns\/([a-z0-9]+)\/assets\/([^/?#]+)$/i.exec(ch.avatar || '');
        if (m) try {   // the picture into this campaign's own files, so everyone here can see it
          const name = path.basename(m[2]), to = path.join(campaignDir(c.id), 'assets');
          fs.mkdirSync(to, { recursive: true });
          if (!fs.existsSync(path.join(to, name))) fs.copyFileSync(path.join(campaignDir(m[1]), 'assets', name), path.join(to, name));
          ch.avatar = `/vtt-data/campaigns/${c.id}/assets/${name}`;
        } catch (e) { /* keep the old link */ }
        c.characters.push(ch);
        op.char = { id: ch.id, name: ch.name };
        return { t: 'char.delete', id: ch.id };
      }
      case 'folders.set': {   // the GM's character folders: [{id, name}], in order
        needGM();
        const prev = clone(c.charFolders);
        const seen = new Set();
        c.charFolders = (Array.isArray(op.folders) ? op.folders : []).slice(0, 200).map(f => ({
          id: f && /^[a-z0-9]{1,30}$/i.test(f.id) ? f.id : id('d'), name: str(f && f.name, 60) || 'Folder' })).filter(f => !seen.has(f.id) && seen.add(f.id));
        const moved = [];
        for (const ch of c.characters) if (ch.folder && !c.charFolders.some(f => f.id === ch.folder)) { moved.push(['char.update', ch.id, ch.folder]); ch.folder = null; }
        for (const ho of c.handouts) if (ho.folder && !c.charFolders.some(f => f.id === ho.folder)) { moved.push(['handout.update', ho.id, ho.folder]); ho.folder = null; }
        return { t: 'batch', ops: [{ t: 'folders.set', folders: prev }, ...moved.map(([t, cid, f]) => ({ t, id: cid, patch: { folder: f } }))] };
      }
      case 'handout.create': {
        needGM();
        const ho = op.restore ? op.handout : Object.assign({ id: id('o'), name: 'New handout', folder: null, img: null, text: '', gmNotes: '', shared: false, viewers: [], created: now() },
          cleanHandout(op.handout || {}, c));
        if (c.handouts.some(x => x.id === ho.id)) throw new Error('Handout exists');
        const at = Number.isInteger(op.index) ? Math.min(op.index, c.handouts.length) : c.handouts.length;
        c.handouts.splice(at, 0, ho);
        op.handout = { id: ho.id };
        return { t: 'handout.delete', id: ho.id };
      }
      case 'handout.update': {
        needGM();
        const ho = this.handout(op.id), p = cleanHandout(op.patch || {}, c), prev = {};
        for (const k of Object.keys(p)) { prev[k] = clone(ho[k] ?? null); ho[k] = p[k]; }
        return { t: 'handout.update', id: ho.id, patch: prev };
      }
      case 'handout.delete': {
        needGM();
        const i = c.handouts.findIndex(x => x.id === op.id);
        if (i < 0) throw new Error('No such handout');
        const [ho] = c.handouts.splice(i, 1);
        return { t: 'handout.create', handout: ho, index: i, restore: true };
      }
      // ── the GM's item cards
      case 'item.create': {
        needGM();
        const it = op.restore ? op.item : cleanItem(Object.assign({}, op.item, { id: id('i') }));
        if (c.items.some(x => x.id === it.id)) throw new Error('Item exists');
        c.items.splice(Number.isInteger(op.index) ? Math.min(op.index, c.items.length) : c.items.length, 0, it);
        op.item = { id: it.id };
        return { t: 'item.delete', id: it.id };
      }
      case 'item.update': {
        needGM();
        const i = c.items.findIndex(x => x.id === op.id); if (i < 0) throw new Error('No such item');
        const prev = c.items[i];
        c.items[i] = cleanItem(Object.assign({}, op.restore ? op.item : Object.assign({}, prev, op.patch || {}), { id: prev.id }));
        return { t: 'item.update', id: prev.id, item: prev, restore: true };
      }
      case 'item.delete': {
        needGM();
        const i = c.items.findIndex(x => x.id === op.id); if (i < 0) throw new Error('No such item');
        const [it] = c.items.splice(i, 1);
        return { t: 'item.create', item: it, index: i, restore: true };
      }
      // ── a character's cards. inv.add: a card into the bag (and a row on the sheet), maybe picked up off the map
      case 'inv.add': {
        const ch = this.character(op.char);
        let item, tokenInv = null;
        if (op.fromToken) {   // picking up an item lying on the map
          const s = this.scene(op.fromToken.scene), t = this.token(s, op.fromToken.id);
          if (!t.item) throw new Error('That isn’t an item');
          if (!gm && (t.layer === 'gm' || s.id !== c.playerScene)) throw new Error('You can’t reach that');
          item = t.item;
          const i = s.tokens.indexOf(t); s.tokens.splice(i, 1);
          tokenInv = { t: 'token.create', scene: s.id, token: t, index: i, restore: true };
        } else if (op.fromContainer) {   // taking something out of a chest
          const s = this.scene(op.fromContainer.scene), t = this.token(s, op.fromContainer.id);
          if (!t.container) throw new Error('That isn’t a container');
          if (!gm && (t.layer === 'gm' || s.id !== c.playerScene)) throw new Error('You can’t reach that');
          if (!gm && t.container.locked) throw new Error('It’s locked');
          if (!gm && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
          const e = t.container.items.find(x => x.uid === op.fromContainer.uid); if (!e) throw new Error('It’s gone: someone took it');
          const prevC = clone(t.container), take = Math.round(num(op.qty, e.qty, 1, e.qty));
          item = e.item; op.qty = take;
          if (take >= e.qty) t.container.items = t.container.items.filter(x => x !== e); else e.qty -= take;
          tokenInv = { t: 'token.update', scene: s.id, id: t.id, patch: { container: prevC }, restore: true };
        } else item = cleanItem(op.item);
        if (!gm && !this.canEditChar(user, ch) && !op.fromToken) throw new Error('That isn’t your character');
        if (!gm && op.fromToken && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        ch.items = ch.items || [];
        const qty = Math.round(num(op.qty, 1, 1, 9999));
        const same = ch.items.find(e => e.item.id === item.id && e.item.name === item.name);
        let inv;
        if (same) { same.qty += qty; inv = { t: 'inv.update', char: ch.id, uid: same.uid, patch: { qty: same.qty - qty }, restore: true }; }
        else { const e = { uid: id('v'), item, qty }; ch.items.push(e); inv = { t: 'inv.remove', char: ch.id, uid: e.uid, restore: true }; }
        // the sheet's own inventory (and an attack for a weapon), so weights and rolls work there too
        if (/^dnd5e/.test(ch.sheet) && !op.restore) {
          const set = Sheet5e.addItem(ch.sheet, ch.attrs, { name: item.name, qty, weight: item.weight, text: plainText(item.text), weapon: item.weapon && item.weapon.damage ? item.weapon : null });
          const prevAttrs = {};
          for (const k of Object.keys(set)) prevAttrs[k.toLowerCase()] = k.toLowerCase() in ch.attrs ? ch.attrs[k.toLowerCase()] : null;
          const lower = Object.fromEntries(Object.entries(set).map(([k, v]) => [k.toLowerCase(), v]));
          Object.assign(ch.attrs, lower);
          ch.recalc = [...new Set((ch.recalc || []).concat(Object.keys(lower)))].slice(0, 3000);
          this.charBroadcast(ch, { set: lower, remove: [] });
          inv.attrs = prevAttrs;
        }
        return tokenInv ? { t: 'batch', ops: [inv, tokenInv] } : inv;
      }
      // ── a spell from the compendium onto a character's sheet (its spell list); undo puts the sheet back
      case 'spell.learn': {
        const ch = this.character(op.char);
        if (!gm && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        if (!/^dnd5e/.test(ch.sheet)) throw new Error('Only D&D 5e sheets have a spell list');
        const sp = op.spell && typeof op.spell === 'object' ? op.spell : {};
        const clean = { name: str(sp.name, 120), level: num(sp.level, 0, 0, 9), school: str(sp.school, 20).toLowerCase(), time: str(sp.time, 200), range: str(sp.range, 120),
          components: str(sp.components, 40), material: str(sp.material, 400), duration: str(sp.duration, 120), concentration: !!sp.concentration, ritual: !!sp.ritual,
          text: str(sp.text, 40000), higher: str(sp.higher, 8000), attack: str(sp.attack, 10), save: str(sp.save, 3), damage: str(sp.damage, 20), dice: str(sp.dice, 40) };
        if (!clean.name) throw new Error('Which spell?');
        const set = Sheet5e.addSpell(ch.sheet, ch.attrs, clean);
        if (!Object.keys(set).length) throw new Error(`${ch.name} already has ${clean.name}`);
        const prevAttrs = {};
        const lower = Object.fromEntries(Object.entries(set).map(([k, v]) => [k.toLowerCase(), v]));
        for (const k of Object.keys(lower)) prevAttrs[k] = k in ch.attrs ? ch.attrs[k] : null;
        Object.assign(ch.attrs, lower);
        ch.recalc = [...new Set((ch.recalc || []).concat(Object.keys(lower)))].slice(0, 3000);
        this.charBroadcast(ch, { set: lower, remove: [] });
        return { t: 'char.attrs.restore', char: ch.id, attrs: prevAttrs, restore: true };
      }
      case 'char.attrs.restore': {   // only as an undo: put attributes back as they were
        if (!op.restore) throw new Error('Not allowed');
        const ch = this.character(op.char);
        return { t: 'char.attrs.restore', char: ch.id, attrs: this.restoreAttrs(ch, op.attrs), restore: true };
      }
      case 'inv.update': {   // { char, uid, patch: { qty, notes } }
        const ch = this.character(op.char);
        if (!gm && !op.restore && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        const e = (ch.items || []).find(x => x.uid === op.uid); if (!e) throw new Error('No such item');
        const prev = {}, p = op.patch || {};
        if ('qty' in p) { prev.qty = e.qty; e.qty = Math.round(num(p.qty, 1, 1, 9999)); }
        if ('notes' in p) { prev.notes = e.notes || ''; e.notes = str(p.notes, 4000); }
        const inv = { t: 'inv.update', char: ch.id, uid: e.uid, patch: prev, restore: op.restore || undefined };
        if (op.attrs) inv.attrs = this.restoreAttrs(ch, op.attrs);
        return inv;
      }
      case 'inv.remove': {   // { char, uid }: out of the bag. attrs (from an undo) puts the sheet back too
        const ch = this.character(op.char);
        if (!gm && !op.restore && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        const i = (ch.items || []).findIndex(x => x.uid === op.uid); if (i < 0) throw new Error('No such item');
        const [e] = ch.items.splice(i, 1);
        const inv = { t: 'inv.restore', char: ch.id, entry: e, index: i, restore: true };
        if (op.attrs) inv.attrs = this.restoreAttrs(ch, op.attrs);
        return inv;
      }
      case 'inv.restore': {
        const ch = this.character(op.char);
        if (!gm && !op.restore && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        ch.items = ch.items || [];
        const e = op.entry && op.entry.item ? { uid: str(op.entry.uid, 40) || id('v'), item: cleanItem(op.entry.item), qty: Math.round(num(op.entry.qty, 1, 1, 9999)), notes: str(op.entry.notes, 4000) } : null;
        if (!e || ch.items.some(x => x.uid === e.uid)) throw new Error('Item exists');
        ch.items.splice(Number.isInteger(op.index) ? Math.min(op.index, ch.items.length) : ch.items.length, 0, e);
        const inv = { t: 'inv.remove', char: ch.id, uid: e.uid, restore: true };
        if (op.attrs) inv.attrs = this.restoreAttrs(ch, op.attrs);
        return inv;
      }
      case 'inv.drop': {   // { char, uid, scene, x, y }: one of them out of the bag onto the map
        const ch = this.character(op.char);
        if (!gm && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        const s = this.scene(op.scene);
        if (!gm && s.id !== c.playerScene) throw new Error('You can’t reach that scene');
        const i = (ch.items || []).findIndex(x => x.uid === op.uid); if (i < 0) throw new Error('No such item');
        const e = ch.items[i];
        const ops = [];
        if (e.qty > 1) { e.qty--; ops.push({ t: 'inv.update', char: ch.id, uid: e.uid, patch: { qty: e.qty + 1 }, restore: true }); }
        else { ch.items.splice(i, 1); ops.push({ t: 'inv.restore', char: ch.id, entry: e, index: i, restore: true }); }
        const t = newToken({ name: e.item.name, x: op.x, y: op.y, size: num(op.size, 0.8, 0.25, 4), item: e.item, nameShown: true });
        s.tokens.push(t);
        ops.unshift({ t: 'token.delete', scene: s.id, id: t.id, restore: true });
        return { t: 'batch', ops };
      }
      case 'inv.give': {   // { char, uid, to, qty }: hand cards to another character
        const ch = this.character(op.char), to = this.character(op.to);
        if (!gm && !this.canEditChar(user, ch)) throw new Error('That isn’t your character');
        const i = (ch.items || []).findIndex(x => x.uid === op.uid); if (i < 0) throw new Error('No such item');
        const e = ch.items[i], qty = Math.round(num(op.qty, e.qty, 1, e.qty));
        const ops = [];
        if (qty < e.qty) { e.qty -= qty; ops.push({ t: 'inv.update', char: ch.id, uid: e.uid, patch: { qty: e.qty + qty }, restore: true }); }
        else { ch.items.splice(i, 1); ops.push({ t: 'inv.restore', char: ch.id, entry: e, index: i, restore: true }); }
        to.items = to.items || [];
        const same = to.items.find(x => x.item.id === e.item.id && x.item.name === e.item.name);
        if (same) { same.qty += qty; ops.push({ t: 'inv.update', char: to.id, uid: same.uid, patch: { qty: same.qty - qty }, restore: true }); }
        else { const ne = { uid: id('v'), item: e.item, qty }; to.items.push(ne); ops.push({ t: 'inv.remove', char: to.id, uid: ne.uid, restore: true }); }
        return { t: 'batch', ops };
      }
      case 'loot.set': {   // the GM's own loot tables
        needGM();
        const prev = clone(c.lootTables || []);
        c.lootTables = op.restore ? op.tables : (Array.isArray(op.tables) ? op.tables : []).slice(0, 100).map(cleanLootTable);
        return { t: 'loot.set', tables: prev, restore: true };
      }
      case 'container.roll': {   // fill a container from its loot table (or the one given), adding to what's there
        needGM();
        const s = this.scene(op.scene), t = this.token(s, op.id);
        if (!t.container) throw new Error('That isn’t a container');
        const prev = clone(t.container), tb = op.table || t.container.table;
        const got = this.rollLoot(tb);
        if (!got) throw new Error('Pick a loot table first');
        t.container.items.push(...got.map(e => ({ uid: id('v'), item: cleanItem(e.item), qty: e.qty })));
        t.container.rolled = true;
        return { t: 'token.update', scene: s.id, id: t.id, patch: { container: prev }, restore: true };
      }
      case 'init.set': {
        needGM();
        const prev = clone(c.init);
        c.init = op.restore ? op.init : cleanInit(op.init || {}, c);
        return { t: 'init.set', init: prev, restore: true };
      }
      default: throw new Error('Unknown action');
    }
  }

  // An edit from a user: apply, remember for undo, tell everyone.
  edit(user, op) {
    const inv = trusted(this.apply(user, op));
    const st = this.stack(user.id);
    st.undo.push({ op, inv }); if (st.undo.length > UNDO_LIMIT) st.undo.shift();
    st.redo = [];
    this.changed();
    return op;
  }
  stack(uid) { if (!this.stacks.has(uid)) this.stacks.set(uid, { undo: [], redo: [] }); return this.stacks.get(uid); }
  undo(user, redo) {
    const st = this.stack(user.id), from = redo ? st.redo : st.undo, to = redo ? st.undo : st.redo;
    while (from.length) {
      const e = from.pop();
      try {
        const op = redo ? e.op : e.inv;
        const inv = trusted(this.apply(user, clone(op)));   // made here, not sent by anyone: allowed to put things back
        to.push(redo ? { op: e.op, inv } : { op: inv, inv: e.inv });
        this.changed();
        return true;
      } catch (err) { /* the thing it touched is gone; skip it */ }
    }
    return false;
  }
  changed() { this.save(); this.publish(); }

  // --- what each person may see ---
  sceneFor(conn) {
    const c = this.c;
    const sid = isGM(conn.user) ? (conn.sceneId && c.scenes.some(s => s.id === conn.sceneId) ? conn.sceneId : c.playerScene || (c.scenes[0] && c.scenes[0].id)) : c.playerScene;
    return c.scenes.find(s => s.id === sid) || null;
  }
  tokenVisible(user, s, t, view) {
    if (isGM(user)) return true;
    if (t.owners.includes(user.id)) return true;
    if (t.layer === 'gm') return false;
    if (!Geom.fogVisible(s, t.x, t.y)) return false;
    if (t.prop || t.layer === 'map') return true;   // scenery is part of the map: the darkness drawn over it hides what's out of sight (a blocking prop would hide itself)
    return !view || Vision.seesToken(view(), t, s.grid && s.grid.size);
  }
  // What a player's tokens can see in a scene with vision on (worked out once per update).
  viewFor(user, s) {
    if (!this.visCache) this.visCache = new Map();
    let cache = this.visCache.get(s.id);
    if (!cache) { cache = new Map(); this.visCache.set(s.id, cache); }
    const viewers = s.tokens.filter(t => (user.guest ? t.owners.length > 0 : t.owners.includes(user.id)) && Vision.sightOn(t));
    return Vision.view(s, viewers, this.lightsOf(s, false), cache);
  }
  // when each channel's track ends, move on (the server keeps time so everyone stays together)
  audioTimers() {
    const a = this.c.audio;
    this.audioT = this.audioT || {};
    for (const k of CHANNELS) {
      clearTimeout(this.audioT[k]);
      const c = a.ch[k], t = c.track && a.tracks.find(x => x.id === c.track);
      if (!t || c.paused != null || !(t.dur > 0)) continue;
      const left = c.started + t.dur * 1000 - Date.now();
      this.audioT[k] = setTimeout(() => { nextTrack(a, c, Date.now(), false); this.audioTimers(); this.changed(); }, Math.max(200, left));
    }
  }
  wallsChanged(s) { if (this.visCache) this.visCache.delete(s.id); }
  // a plan's walls (src: 'plan'), made again from it; doors keep whether they were open. Walls drawn by hand stay.
  syncPlanWalls(s) {
    const was = new Map(s.walls.filter(w => w.src === 'plan' && w.door).map(w => [w.door, w]));
    s.walls = s.walls.filter(w => w.src !== 'plan');
    if (s.plan) {
      const g = s.grid || cleanGrid({});
      for (const pw of Plan.walls(s.plan, g.size, g.ox, g.oy).slice(0, 4500)) {
        const w = cleanWall(pw); w.src = 'plan';
        if (pw.door) { w.door = pw.door; const old = was.get(pw.door); if (old && old.kind === w.kind) { w.id = old.id; w.open = old.open; } }
        s.walls.push(w);
      }
    }
    this.wallsChanged(s);
  }
  // ── a plan's history: each change kept (a person's strokes a few minutes apart count as one), in words, to put back.
  // campaigns/<id>/plans/<scene>.json: [{ v, at, by, summary, plan, first? }], the last 60
  planFile(sid) { return path.join(campaignDir(this.c.id), 'plans', String(sid).replace(/[^a-z0-9]/gi, '') + '.json'); }
  planHist(sid) {
    this.planCache = this.planCache || new Map();
    if (!this.planCache.has(sid)) this.planCache.set(sid, readJSON(this.planFile(sid), []));
    return this.planCache.get(sid);
  }
  planChanged(s, before, after, user, note) {
    const list = this.planHist(s.id), last = list[list.length - 1], at = now(), by = user ? user.id : null;
    const same = !note && last && !last.note && last.by === by && at - last.at < 3 * 60e3;
    if (!list.length && before) list.push({ v: 0, at, by: null, summary: 'As it was', plan: before });
    const from = same ? (list[list.length - 2] || {}).plan || last.first : before;
    const summary = (note ? str(note, 120) + ': ' : '') + Plan.describe(from, after);
    const e = { v: same ? last.v : (last ? last.v + 1 : 1), at, by, summary, plan: after };
    if (note) e.note = true;
    if (same) list[list.length - 1] = e; else list.push(e);
    while (list.length > 60) list.shift();
    clearTimeout(this.planSaveT); this.planSaveT = setTimeout(() => { for (const [sid, l] of this.planCache) { try { fs.mkdirSync(path.dirname(this.planFile(sid)), { recursive: true }); writeJSON(this.planFile(sid), l); } catch (err) { /* next time */ } } }, 2000);
  }
  // a plan's lights (src: 'plan'): a torch, a lantern, a fire on the plan gives light. Made again when the plan changes;
  // a light the GM has changed keeps its changes, and one they deleted stays deleted (s.planDark).
  syncPlanLights(s) {
    const was = new Map(s.lights.filter(l => l.src === 'plan' && l.key).map(l => [l.key, l]));
    const dark = new Set(s.planDark || []);
    const kept = s.lights.filter(l => l.src !== 'plan');
    if (s.plan) {
      const g = s.grid || cleanGrid({}), k = (g.size || 70), room = Math.max(0, 500 - kept.length), pls = Plan.lights(s.plan);
      const placed = kept.filter(l => !l.src);   // lights put there by hand (an older generator's torches among them): not doubled
      for (const pl of pls.slice(0, Math.min(300, room))) {
        if (dark.has(pl.key)) continue;
        const x = (g.ox || 0) + pl.x * k, y = (g.oy || 0) + pl.y * k;
        if (placed.some(l => Math.abs(l.x - x) < k * 0.4 && Math.abs(l.y - y) < k * 0.4)) continue;
        const old = was.get(pl.key);
        const l = old ? Object.assign({}, old, { x, y }) : cleanLight({ x, y, bright: pl.bright, dim: pl.dim, color: pl.color, anim: pl.anim, intensity: 0.6 });
        l.src = 'plan'; l.key = pl.key; kept.push(l);
      }
      if (s.planDark) { const keys = new Set(pls.map(pl => pl.key)); s.planDark = s.planDark.filter(key => keys.has(key)); }   // forget ones whose torch has gone
    }
    s.lights = kept;
  }
  // every light: placed ones plus those tokens carry (not the GM layer's, for players)
  lightsOf(s, gm) { return Vision.allLights(s, s.tokens.filter(t => gm || t.layer !== 'gm')); }
  wallsFor(user, s) {
    if (isGM(user)) return s.walls;
    const out = [];
    for (const w of s.walls) {
      if (w.kind === 'secret') { if (!w.open) out.push({ id: w.id, a: w.a, b: w.b, kind: 'wall' }); continue; }
      out.push(w.locked ? Object.assign({}, w, { locked: false }) : w);
    }
    return out;
  }
  // a loot table's draws (a preset, or one of the GM's), with the campaign's own item cards to draw on too
  rollLoot(tid) {
    const tb = (this.c.lootTables || []).find(x => x.id === tid) || Loot.presets().find(x => x.id === tid);
    if (!tb) return null;
    const find = ref => Loot.findSrd(ref) || (this.c.items || []).find(x => x.id === ref || 'camp:' + x.id === ref) || null;
    return Loot.rollTable(tb, find);
  }
  tokenFor(user, t) {
    if (isGM(user)) return t;
    if (t.container) {   // what's inside is told only to whoever opens it
      const out = Object.assign({}, t, { container: { n: t.container.items.length || (t.container.table && !t.container.rolled ? 1 : 0), locked: t.container.locked } });
      if (!t.owners.includes(user.id) && !t.barsPublic) { out.hp = null; out.bar2 = null; out.sheet = null; if (!t.nameShown) out.name = ''; }
      return out;
    }
    if (t.owners.includes(user.id) || t.barsPublic) return t;
    const out = Object.assign({}, t, { hp: null, bar2: null, sheet: null });
    if (!t.nameShown) out.name = '';
    return out;
  }
  initFor(user) {
    const init = this.c.init;
    if (isGM(user)) return init;
    const entries = init.entries.filter(e => !e.hidden);
    const cur = init.entries[init.turn];
    return { entries, round: init.round, turn: cur && !cur.hidden ? entries.indexOf(cur) : -1 };
  }
  metaFor(user) {
    const c = this.c, gm = isGM(user);
    const members = db.users.filter(u => (u.role === 'gm' && !playerIn(c, u.id)) || c.members.includes(u.id)).map(u => ({ id: u.id, name: u.name, role: roleIn(c, u), color: u.color }));
    return { id: c.id, name: c.name, mode: c.mode, playerScene: c.playerScene, members, gm, guest: !!user.guest, watch: c.watch !== false, online: [...new Set([...this.conns].filter(x => x.user && !x.user.guest).map(x => x.user.id))], lootTables: gm ? (c.lootTables || []) : undefined, played: user.guest ? undefined : playedMs(user.id), playedAll: gm ? Object.fromEntries(members.map(m => [m.id, playedMs(m.id)])) : undefined,
      scenes: gm ? c.scenes.map(s => ({ id: s.id, name: s.name, folder: s.folder || null, kind: s.kind || 'battle', thumb: s.thumb || (s.image && s.image.url) || null, hasThumb: !!s.thumb, atlas: s.atlas || null,
        atlasName: s.atlas ? ((site.getAtlas(s.atlas) || {}).name || 'A missing version') : undefined })) : [],
      characters: c.characters.filter(ch => this.canViewChar(user, ch)).map(ch => ({ id: ch.id, name: ch.name, sheet: ch.sheet, avatar: ch.avatar, token: ch.token || null,
        owners: ch.owners, shared: ch.shared, folder: ch.folder || null, canEdit: this.canEditChar(user, ch), items: ch.items || [] })),
      items: gm ? c.items : [],
      handouts: c.handouts.filter(ho => this.canViewHandout(user, ho)).map(ho => gm ? ho
        : { id: ho.id, name: ho.name, folder: ho.folder, img: ho.img, text: ho.text }),
      charFolders: c.charFolders.filter(f => gm || c.characters.some(ch => ch.folder === f.id && this.canViewChar(user, ch))
        || c.handouts.some(ho => ho.folder === f.id && this.canViewHandout(user, ho))),
      sheets: Object.fromEntries(Object.entries(SHEETS).map(([k, v]) => [k, { name: v.name, mode: v.mode }])),
      audio: gm ? Object.assign({ tracks: c.audio.tracks, playlists: c.audio.playlists }, c.audio) : { fade: c.audio.fade, ch: c.audio.ch, tracks: c.audio.tracks.filter(t => CHANNELS.some(k => c.audio.ch[k].track === t.id)).map(t => ({ id: t.id, url: t.url, dur: t.dur })) } };
  }
  character(cid) { const ch = this.c.characters.find(x => x.id === cid); if (!ch) throw new Error('No such character'); return ch; }
  handout(hid) { const ho = this.c.handouts.find(x => x.id === hid); if (!ho) throw new Error('No such handout'); return ho; }
  canViewHandout(user, ho) { return isGM(user) || ho.shared || ho.viewers.includes(user.id); }
  canViewChar(user, ch) { return isGM(user) || ch.owners.includes(user.id) || ch.shared; }
  canEditChar(user, ch) { return isGM(user) || ch.owners.includes(user.id); }
  // put sheet attributes back as they were ({ key: value | null }); returns what they were just now
  restoreAttrs(ch, prev) {
    const now = {}, set = {}, gone = [];
    for (const [k0, v] of Object.entries(prev || {}).slice(0, 500)) {
      const k = str(k0, 120).toLowerCase(); if (!k) continue;
      now[k] = k in ch.attrs ? ch.attrs[k] : null;
      if (v == null) { if (k in ch.attrs) { delete ch.attrs[k]; gone.push(k); } } else { ch.attrs[k] = set[k] = str(v, 50000); }
    }
    this.charBroadcast(ch, { set, remove: gone });
    return now;
  }
  charBroadcast(ch, msg, except) {
    for (const conn of this.conns) if (conn !== except && conn.chars && conn.chars.has(ch.id) && this.canViewChar(conn.user, ch)) send(conn, Object.assign({ t: 'charAttrs', char: ch.id }, msg));
  }
  // Attribute changes from a sheet. Hit points also move the bars of tokens linked to the character.
  setCharAttrs(ch, set, remove, except) {
    const out = {}, gone = [];
    for (let [k, v] of Object.entries(set || {}).slice(0, 2000)) {
      k = str(k, 120).toLowerCase(); if (!k) continue;
      out[k] = str(v, 50000); ch.attrs[k] = out[k];
    }
    for (let k of (remove || []).slice(0, 2000)) { k = str(k, 120).toLowerCase(); if (k in ch.attrs) { delete ch.attrs[k]; gone.push(k); } }
    this.charBroadcast(ch, { set: out, remove: gone }, except);
    const reg = SHEETS[ch.sheet] || {};
    const hp = (reg.hp || 'hp').toLowerCase(), hpMax = (reg.hpMax || 'hp_max').toLowerCase();
    if (hp in out || hpMax in out) {
      const v = num(ch.attrs[hp], 0), max = num(ch.attrs[hpMax], 0);
      for (const sc of this.c.scenes) for (const t of sc.tokens) if (t.sheet === ch.id) t.hp = { v, max: max || (t.hp && t.hp.max) || v };
    }
    this.save();
    this.publish();
  }

  // Send each connection whatever changed in its view.
  publish(only) {
    for (const conn of only ? [only] : this.conns) {
      const out = { t: 'sync' }, sent = conn.sent;
      const meta = this.metaFor(conn.user), mj = JSON.stringify(meta);
      if (mj !== sent.meta) { out.meta = meta; sent.meta = mj; }
      const init = this.initFor(conn.user), ij = JSON.stringify(init);
      if (ij !== sent.init) { out.init = init; sent.init = ij; }
      const s = conn.lite ? null : this.sceneFor(conn);
      if (!s) { if (sent.scene) { out.scene = null; sent.scene = null; } }
      else {
        const sc = {};
        let reset = false;
        if (!sent.scene || sent.scene.id !== s.id) { sent.scene = { id: s.id, meta: '', fog: '', tokens: new Map(), templates: new Map(), walls: new Map(), lights: new Map(), sounds: new Map() }; reset = true; sc.reset = true; }
        const ss = sent.scene;
        const m = {}; for (const k of SCENE_KEYS) m[k] = s[k];
        if (!isGM(conn.user)) {
          delete m.notes; if (Array.isArray(m.journeys)) m.journeys = m.journeys.filter(j => !j.hidden);
          if (m.plan && m.plan.doors.some(d => d.k === 'secret')) m.plan = Object.assign({}, m.plan, { doors: m.plan.doors.map(d => d.k === 'secret' ? Object.assign({}, d, { k: 'wall' }) : d) });   // a secret door looks like wall
          if (m.plan && m.plan.labels.length && m.plan.style.labels !== 'all') m.plan = Object.assign({}, m.plan, { labels: [] });   // room numbers are the GM's
        }
        const msj = JSON.stringify(m);
        if (msj !== ss.meta) { sc.meta = m; ss.meta = msj; }
        const fj = JSON.stringify(s.fogShapes);
        if (fj !== ss.fog) { sc.fog = s.fogShapes; ss.fog = fj; }
        let view = null;
        const getView = s.vision && !isGM(conn.user) ? () => view || (view = this.viewFor(conn.user, s)) : null;
        for (const [key, list, vis] of [['tokens', s.tokens, t => this.tokenVisible(conn.user, s, t, getView) && this.tokenFor(conn.user, t)],
                                         ['templates', s.templates, a => a],
                                         ['walls', this.wallsFor(conn.user, s), w => w],
                                         ['lights', this.lightsOf(s, isGM(conn.user)), l => l],
                                         ['sounds', s.sounds || [], o => isGM(conn.user) || o.on ? o : null]]) {
          const seen = new Set(), up = [], rm = [];
          list.forEach((item, i) => {
            const v = vis(item); if (!v) return;
            seen.add(item.id);
            const j = JSON.stringify(v) + '#' + i;
            if (ss[key].get(item.id) !== j) { ss[key].set(item.id, j); up.push(Object.assign({ _i: i }, v)); }
          });
          for (const k of [...ss[key].keys()]) if (!seen.has(k)) { ss[key].delete(k); rm.push(k); }
          if (up.length || rm.length || reset) sc[key] = { up, rm };
        }
        if (Object.keys(sc).length) out.scene = Object.assign({ id: s.id }, sc);
      }
      if (Object.keys(out).length > 1) send(conn, out);
    }
  }
  canSeeToken(conn, tid) { return conn.sent.scene && conn.sent.scene.tokens.has(tid); }

  // --- chat ---
  chatFor(user, m) {
    if (isGM(user) || m.uid === user.id) return true;
    if (m.gmOnly) return false;
    if (m.to && m.to.length) return m.to.includes(user.id);
    return true;
  }
  post(m) {
    m.id = id('m'); m.ts = now();
    this.c.chat.push(m);
    if (this.c.chat.length > CHAT_KEPT) this.c.chat.splice(0, this.c.chat.length - CHAT_KEPT);
    this.save();
    for (const conn of this.conns) if (this.chatFor(conn.user, m)) send(conn, { t: 'chat', msgs: [m] });
    return m;
  }
}

// ───────────────────────── chat commands and rolls ─────────────────────────

// who a message comes from: you, a token you control ("as" its id), or (as "c:<id>") a character in the journal
// (the GM any of them, a player their own). Gives the name, and the picture the chat shows beside it.
function speaker(room, user, as) {
  as = as ? String(as) : '';
  const chars = room.c.characters || [];
  if (as.startsWith('c:')) {
    const ch = chars.find(x => x.id === as.slice(2));
    if (ch && (isGM(user) || (ch.owners || []).includes(user.id))) return { from: ch.name || user.name, char: ch.id, pic: ch.token || ch.avatar || null };
  } else if (as) {
    for (const s of room.c.scenes) {
      const t = s.tokens.find(x => x.id === as);
      if (t && (isGM(user) || t.owners.includes(user.id))) {
        const ch = t.sheet && chars.find(x => x.id === t.sheet);
        return { from: t.name || user.name, char: ch ? ch.id : undefined, pic: t.img || (ch && (ch.token || ch.avatar)) || null };
      }
    }
  }
  return { from: user.name };
}
function speakerName(room, user, as) { return speaker(room, user, as).from; }
function chatCommand(room, user, text, as) {
  text = str(text, 4000).trim();
  if (!text) return;
  const base = Object.assign({ uid: user.id, color: user.color }, speaker(room, user, as));
  let m;
  if ((m = /^\/(r|roll|gr|gmroll)\s+(.+)$/i.exec(text))) {
    const r = Dice.roll(m[2]);
    return room.post(Object.assign(base, { kind: 'roll', roll: r, gmOnly: /^g/i.test(m[1]) }));
  }
  // a line across the chat: to split rolls into blocks, or one session from the next ("/divider Session 12", or /hr)
  if ((m = /^\/(divider|hr|break)\b\s*(.*)$/i.exec(text))) return room.post(Object.assign(base, { kind: 'divider', text: str(m[2], 80).trim() }));
  if ((m = /^\/me\s+(.+)$/i.exec(text))) return room.post(Object.assign(base, { kind: 'emote', text: m[1] }));
  if ((m = /^\/(w|whisper)\s+(.+)$/i.exec(text))) {
    const rest = m[2];
    const members = db.users.filter(u => u.role === 'gm' || room.c.members.includes(u.id)).sort((a, b) => b.name.length - a.name.length);
    const quoted = /^"([^"]+)"\s+(.+)$/.exec(rest);
    let target, body;
    if (quoted) { target = members.find(u => u.name.toLowerCase() === quoted[1].toLowerCase()); body = quoted[2]; }
    else { target = members.find(u => rest.toLowerCase().startsWith(u.name.toLowerCase() + ' ')); body = target && rest.slice(target.name.length + 1); }
    if (!target) throw new Error('Whisper to whom? Use /w Name message');
    return room.post(Object.assign(base, { kind: 'msg', text: body, to: [target.id], toName: target.name }));
  }
  if (text.startsWith('/')) throw new Error('Commands: /r 1d20+3, /gr (GM-only roll), /w Name message, /me action');
  return room.post(Object.assign(base, { kind: 'msg', text }));
}

// &{tracker}: a roll that names the initiative tracker puts the character's token into initiative.
function trackerRolls(room, ch, rolls, user) {
  const r = (rolls || []).find(x => x.tracker && !x.nested) || (rolls || []).find(x => x.tracker);
  if (!r) return;
  const c = room.c, init = clone(c.init);
  const sc = c.scenes.find(s => s.id === c.playerScene) || c.scenes[0];
  const t = sc && sc.tokens.find(x => x.sheet === ch.id);
  let e = init.entries.find(x => (t && x.tokenId === t.id) || (!t && x.name === ch.name && !x.tokenId));
  if (!e) { e = { id: id('i'), name: t ? t.name : ch.name, value: 0, tokenId: t ? t.id : null, scene: sc ? sc.id : null, hidden: !!(t && t.layer === 'gm') }; init.entries.push(e); }
  e.value = +(r.computed != null ? r.computed : r.total) || 0;
  const cur = init.entries[init.turn];
  init.entries.sort((a, b) => b.value - a.value);
  if (cur) init.turn = Math.max(0, init.entries.indexOf(cur));
  room.apply({ role: 'gm' }, { t: 'init.set', init, restore: true });
  room.changed();
}

// Roll initiative for tokens (GM: any; players: their own).
function rollInitiative(room, user, sceneId, tokenIds, mod) {
  const s = room.scene(sceneId), c = room.c;
  const init = clone(c.init);
  const die = Dice.INIT_DIE[c.mode] || '1d20';
  const results = [];
  for (const tid of (tokenIds || []).slice(0, 50)) {
    const t = s.tokens.find(x => x.id === tid);
    if (!t || (!isGM(user) && !t.owners.includes(user.id))) continue;
    const m = num(mod, 0, -100, 100);
    const r = Dice.roll(die + (m ? (m > 0 ? '+' : '') + m : '') + ' Initiative');
    let e = init.entries.find(x => x.tokenId === t.id);
    if (!e) { e = { id: id('i'), name: t.name, value: 0, tokenId: t.id, scene: s.id, hidden: t.layer === 'gm' }; init.entries.push(e); }
    e.value = r.total; e.name = t.name;
    results.push([t, r]);
  }
  if (!results.length) throw new Error('Select a token you control first');
  const cur = init.entries[init.turn];
  init.entries.sort((a, b) => b.value - a.value);
  if (cur) init.turn = Math.max(0, init.entries.indexOf(cur));
  room.apply({ role: 'gm' }, { t: 'init.set', init, restore: true });
  room.changed();
  for (const [t, r] of results) room.post({ uid: user.id, from: t.name || user.name, pic: t.img || null, color: user.color, kind: 'roll', roll: r, gmOnly: t.layer === 'gm' });
}

// ───────────────────────── WebSocket ─────────────────────────

function send(conn, msg) { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg)); }

// "restore" marks ops the server made itself (undo); a client never gets to send one.
function trusted(op) {
  if (op && typeof op === 'object') { op.restore = true; if (op.t === 'batch') (op.ops || []).forEach(trusted); }
  return op;
}
function stripRestore(op) {
  if (!op || typeof op !== 'object') return {};
  const out = Object.assign({}, op); delete out.restore;
  if (out.t === 'batch') out.ops = (Array.isArray(out.ops) ? out.ops : []).map(stripRestore);
  return out;
}

// ───────── who's looking at the world map (the site, not a campaign) ─────────
// Each page with the map open says where it's looking (a box of the map, and the pointer); everyone else's page shows
// them. An admin can bring everyone to where they are ("beckon"), or have everyone follow along ("lead"), which carries
// a tale being played too. Anyone can point something out ("ping": Alt+click the map). Guests aren't shown.
const siteConns = new Set();
let peersTimer = null, connSeq = 0;
function sitePeers() {
  peersTimer = null;
  const list = [...siteConns].filter(c => c.site && c.site.look && !c.site.hidden && !c.user.guest)
    .map(c => ({ id: c.cid, user: c.user.id, name: c.user.name, color: c.user.color || '#c9a45c', gm: isGM(c.user), look: c.site.look, leading: !!c.site.leading }));
  for (const c of siteConns) if (!c.user.guest) send(c, { t: 'peers', list: list.filter(x => x.id !== c.cid) });
}
const schedulePeers = () => { if (!peersTimer) peersTimer = setTimeout(sitePeers, 220); };
// the world map was saved: everyone with it open hears, and takes the change in if they've nothing of their own waiting
// hours played: everyone's time with the site or the table open, counted a minute at a time (vtt-data/played.json)
const PLAYED_FILE = path.join(DATA, 'played.json');
const played = readJSON(PLAYED_FILE, {});
function playedMs(uid) { return played[uid] || 0; }
setInterval(() => {
  const ids = new Set();
  for (const room of rooms.values()) for (const x of room.conns) if (x.user && !x.user.guest) ids.add(x.user.id);
  for (const x of siteConns) if (x.user && !x.user.guest) ids.add(x.user.id);
  if (!ids.size) return;
  for (const id of ids) played[id] = (played[id] || 0) + 60e3;
  try { writeJSON(PLAYED_FILE, played); } catch (e) { /* next minute */ }
  for (const room of rooms.values()) if (room.conns.size) room.publish();
}, 60e3);
function worldSaved(info) { for (const c of siteConns) send(c, Object.assign({ t: 'worldSaved' }, info)); }
const cleanLook = l => {
  l = l && typeof l === 'object' ? l : {};
  const n = (v, d) => Math.round(num(v, d, -1e6, 1e6));
  const out = { v: Array.isArray(l.v) && l.v.length === 4 ? l.v.map(x => n(x, 0)) : null, c: Array.isArray(l.c) && l.c.length === 2 ? l.c.map(x => n(x, 0)) : null,
    z: Math.round(num(l.z, 3, -4, 12) * 100) / 100, view: str(l.view, 20), where: str(l.where, 80) };
  if (l.tale && typeof l.tale === 'object') out.tale = { id: str(l.tale.id, 40), i: Math.round(num(l.tale.i, 0, 0, 500)), playing: !!l.tale.playing };
  return out;
};
function siteMessage(conn, msg, reply) {
  const user = conn.user;
  if (msg.t === 'site') {
    if (!conn.site) { siteConns.add(conn); conn.site = { look: null, hidden: false, leading: false }; }
    conn.site.hidden = !!msg.hidden;
    schedulePeers();
    return reply({ id: conn.cid });
  }
  if (!conn.site) return reply({ error: 'Say hello first' });
  if (msg.t === 'look') { conn.site.look = cleanLook(msg.look); if (msg.hidden != null) conn.site.hidden = !!msg.hidden; schedulePeers(); return; }
  // pointing something out (Alt+click): a ring at that spot on everyone else's map, now and then at most
  if (msg.t === 'ping') {
    if (user.guest) return;
    const now = Date.now(); if (conn.site.lastPing && now - conn.site.lastPing < 450) return; conn.site.lastPing = now;
    if (!Array.isArray(msg.at) || msg.at.length !== 2) return;
    const out = { t: 'ping', id: conn.cid, by: user.name, color: user.color || '#c9a45c', at: msg.at.map(x => Math.round(num(x, 0, -1e6, 1e6))) };
    for (const c of siteConns) if (c !== conn && !c.user.guest) send(c, out);
    return;
  }
  if (msg.t === 'beckon' || msg.t === 'lead') return reply && reply({});   // (Gather and Lead are gone)
}

function onMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  // a GM can sit at a table as a player (their own game, run by someone else): this connection sees and does only what
  // a player would. Their account stays a GM's everywhere else.
  const real = userById(conn.user.id) || conn.user;
  if (msg && msg.t === 'join') conn.asPlayer = !!msg.asPlayer && real.role === 'gm';
  const here = msg && msg.t === 'join' ? getRoom(str(msg.campaign, 40)) : conn.room;
  const user = here && real.role === 'gm' && playerIn(here.c, real.id) ? asIn(here.c, real)   // a player in this campaign
    : conn.asPlayer && real.role === 'gm' ? Object.assign({}, real, { role: 'player', playing: true }) : real;
  conn.user = user;
  const reply = (extra) => msg.rid != null && send(conn, Object.assign({ t: 'ack', rid: msg.rid }, extra));
  try {
    if (msg.t === 'join') {
      const room = getRoom(str(msg.campaign, 40));
      if (!room || !canSee(user, room.c)) throw new Error('No such campaign');
      if (conn.room) conn.room.conns.delete(conn);
      conn.room = room; room.conns.add(conn);
      conn.sent = { meta: '', init: '', scene: null };
      conn.lite = !!msg.lite;
      conn.chars = new Set();
      conn.sceneId = isGM(user) ? str(msg.scene, 40) || null : null;
      room.publish();   // (everyone: who's here changed)
      send(conn, { t: 'chat', reset: true, msgs: room.c.chat.filter(m => room.chatFor(user, m)).slice(-300) });
      send(conn, { t: 'time', cal: roomTime(room, isGM(user)) });
      return reply({});
    }
    if (['site', 'look', 'beckon', 'lead', 'ping'].includes(msg.t)) return siteMessage(conn, msg, reply);
    const room = conn.room;
    if (!room) throw new Error('Join a campaign first');
    if (user.guest && msg.t !== 'charOpen') throw new Error('Log in to play');
    switch (msg.t) {
      case 'view':      // GM looks at another scene without moving the players
        if (!isGM(user)) throw new Error('Only the GM can do that');
        conn.sceneId = str(msg.scene, 40); room.publish(conn); return reply({});
      case 'op': {
        const op = room.edit(user, stripRestore(msg.op));
        return reply({ op: { t: op.t, scene: op.scene && op.scene.id ? { id: op.scene.id } : undefined, token: op.token && op.token.id ? { id: op.token.id } : undefined, tpl: op.tpl && op.tpl.id ? { id: op.tpl.id } : undefined, char: op.char && op.char.id ? { id: op.char.id } : undefined, handout: op.handout && op.handout.id ? { id: op.handout.id } : undefined, light: op.light && op.light.id ? { id: op.light.id } : undefined, sound: op.sound && op.sound.id ? { id: op.sound.id } : undefined, item: op.item && op.item.id ? { id: op.item.id } : undefined, walls: Array.isArray(op.walls) ? op.walls.map(w => ({ id: w.id })) : undefined } });
      }
      case 'undo': case 'redo':
        return reply({ done: room.undo(user, msg.t === 'redo') });
      case 'chat':
        chatCommand(room, user, msg.text, msg.as); return reply({});
      case 'chatDelete': {   // delete messages: the GM any, everyone else their own
        const ids = new Set((Array.isArray(msg.ids) ? msg.ids : []).map(x => str(x, 40)));
        const gone = room.c.chat.filter(m => ids.has(m.id) && (isGM(user) || m.uid === user.id)).map(m => m.id);
        if (!gone.length) throw new Error('You can only delete your own messages');
        const g = new Set(gone);
        room.c.chat = room.c.chat.filter(m => !g.has(m.id));
        room.save();
        for (const other of room.conns) send(other, { t: 'chatGone', ids: gone });
        return reply({});
      }
      case 'chatClear': {    // the GM empties the chat log for everyone
        if (!isGM(user)) throw new Error('Only the GM can clear the chat');
        room.c.chat = [];
        room.save();
        for (const other of room.conns) send(other, { t: 'chat', reset: true, msgs: [] });
        return reply({});
      }
      case 'roll': {    // a button roll: formula plus optional label
        const label = msg.label ? ' ' + str(msg.label, 80) : '';
        const base = { uid: user.id, ...speaker(room, user, msg.as), color: user.color, kind: 'roll', gmOnly: !!msg.gmOnly };
        if (msg.preset === 'pair') {        // two rolls side by side; the left one is the roll
          room.post(Object.assign(base, { roll: Dice.roll(str(msg.formula, 200) + label), roll2: Dice.roll(str(msg.formula, 200)) }));
        } else if (msg.preset === 'three') { // 2D6: three dice, the left two are the roll; the third shows advantage at a glance
          room.post(Object.assign(base, { roll: Dice.roll('3d6' + label), three: true }));
        } else room.post(Object.assign(base, { roll: Dice.roll(str(msg.formula, 200) + label) }));
        return reply({});
      }
      case 'clock': {   // the GM moves this campaign's clock on, sets the date, or the weather
        if (!isGM(user)) throw new Error('Only the GM can do that');
        const k = room.c.clock, C = site.calendar().cal;
        if (msg.to === 'dawn') k.t = Cal.nextDawn(C, k.t);
        else if ('minutes' in msg) k.t += Math.round(num(msg.minutes, 0, -1e7, 1e7));
        if ('set' in msg) k.t = Math.round(num(msg.set, k.t, -1e12, 1e12));
        if (msg.weather && typeof msg.weather === 'object') k.weather = Cal.cleanWeather(Object.assign({}, k.weather, msg.weather));
        clockChanged(room);
        return reply({});
      }
      case 'audio': {   // the GM's jukebox
        if (!isGM(user)) throw new Error('Only the GM can do that');
        audioCommand(room, msg);
        return reply({});
      }
      case 'showItem': {   // an item's card into the chat for everyone (or just the GM)
        room.post({ uid: user.id, ...speaker(room, user, msg.as), color: user.color, kind: 'item', item: cleanItem(msg.item), gmOnly: !!msg.gmOnly, note: str(msg.note, 500) });
        return reply({});
      }
      case 'showSpell': {   // a spell's card into the chat
        const sp = msg.spell && typeof msg.spell === 'object' ? msg.spell : {};
        const spell = { name: str(sp.name, 120) || 'Spell', level: num(sp.level, 0, 0, 9), school: str(sp.school, 20).toLowerCase() };
        for (const [k, n] of [['time', 200], ['range', 120], ['components', 40], ['material', 400], ['duration', 120], ['text', 40000], ['higher', 8000], ['source', 40], ['page', 10],
          ['damage', 20], ['dice', 40], ['heal', 40], ['save', 3], ['attack', 10], ['gi', 60], ['id', 80]]) if (sp[k]) spell[k] = str(sp[k], n);
        if (Array.isArray(sp.classes)) spell.classes = sp.classes.slice(0, 20).map(c => str(c, 40));
        if (sp.concentration) spell.concentration = true;
        if (sp.ritual) spell.ritual = true;
        room.post({ uid: user.id, ...speaker(room, user, msg.as), color: user.color, kind: 'spell', spell, gmOnly: !!msg.gmOnly });
        return reply({});
      }
      case 'containerOpen': {   // look inside a chest: filled from its loot table the first time, if it has one
        const s = room.scene(str(msg.scene, 40)), t = room.token(s, str(msg.id, 40));
        if (!t.container) throw new Error('That isn’t a container');
        if (!isGM(user) && (t.layer === 'gm' || s.id !== room.c.playerScene)) throw new Error('You can’t reach that');
        if (!isGM(user) && t.container.locked) throw new Error('It’s locked');
        if (t.container.table && !t.container.rolled) {
          const got = room.rollLoot(t.container.table) || [];
          t.container.items.push(...got.map(e => ({ uid: id('v'), item: cleanItem(e.item), qty: e.qty })));
          t.container.rolled = true;
          room.changed();
        }
        return reply({ items: t.container.items, locked: t.container.locked, name: t.name });
      }
      case 'lootPresets': return reply({ presets: Loot.presets() });
      case 'planHistory': {   // a planned map's changes, newest first (the GM's)
        if (!isGM(user)) throw new Error('Only the GM can do that');
        const sid = str(msg.scene, 40); room.scene(sid);
        const list = room.planHist(sid);
        if (msg.v != null) { const e = list.find(x => x.v === +msg.v); if (!e) throw new Error('That version is gone'); return reply({ plan: e.plan, at: e.at }); }
        return reply({ entries: list.slice().reverse().map(e => ({ v: e.v, at: e.at, by: e.by ? ((userById(e.by) || {}).name || 'someone') : null, summary: e.summary })) });
      }
      case 'elsewhere': {   // your characters in the other campaigns you're in (for the Journal's Other Campaigns folder)
        const out = [];
        if (!user.guest) for (const oc of listCampaigns()) {
          if (oc.id === room.c.id || !canSee(user, oc)) continue;
          const chars = oc.characters.filter(ch => ch.owners.includes(user.id)).map(ch => ({ id: ch.id, name: ch.name, avatar: ch.avatar, sheet: ch.sheet }));
          if (chars.length) out.push({ id: oc.id, name: oc.name, chars });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return reply({ campaigns: out });
      }
      case 'showFeature': {   // a class feature, racial trait, feat or action's card into the chat
        const f = msg.feature && typeof msg.feature === 'object' ? msg.feature : {};
        const feature = { name: str(f.name, 120) || 'Feature', kind: ['class', 'race', 'feat', 'basic', 'custom'].includes(f.kind) ? f.kind : 'custom' };
        for (const [k, n] of [['text', 40000], ['cls', 40], ['sub', 80], ['parent', 80], ['use', 10], ['rest', 10], ['gi', 60], ['id', 80], ['step', 60], ['prereq', 80]]) if (f[k]) feature[k] = str(f[k], n);
        for (const k of ['level', 'lv']) if (f[k] != null) feature[k] = num(f[k], 1, 1, 30);
        if (Array.isArray(f.races)) feature.races = f.races.slice(0, 20).map(c => str(c, 40));
        if (Array.isArray(f.steps)) feature.steps = f.steps.slice(0, 20).filter(Array.isArray).map(s => [num(s[0], 1, 1, 30), str(s[1], 60)]);
        room.post({ uid: user.id, ...speaker(room, user, msg.as), color: user.color, kind: 'feature', feature, gmOnly: !!msg.gmOnly });
        return reply({});
      }
      case 'showHandout': {   // GM: let everyone see a handout and open it on their screens
        if (!isGM(user)) throw new Error('Only the GM can do that');
        const ho = room.handout(str(msg.id, 40));
        if (!ho.shared) room.edit(user, { t: 'handout.update', id: ho.id, patch: { shared: true } });
        for (const other of room.conns) if (other !== conn) send(other, { t: 'handoutShow', id: ho.id });
        return reply({});
      }
      case 'charOpen': {
        const ch = room.character(str(msg.char, 40));
        if (!room.canViewChar(user, ch)) throw new Error('You can’t see that character');
        conn.chars.add(ch.id);
        send(conn, { t: 'char', char: { id: ch.id, name: ch.name, sheet: ch.sheet, avatar: ch.avatar, owners: ch.owners, attrs: ch.attrs, canEdit: room.canEditChar(user, ch), recalc: room.canEditChar(user, ch) ? ch.recalc || [] : [] } });
        return reply({});
      }
      case 'charRecalced': {   // a sheet has run its workers over attributes written from outside it (switch, import)
        const ch = room.character(str(msg.char, 40));
        if (room.canEditChar(user, ch)) { delete ch.recalc; room.save(); }
        return reply({});
      }
      case 'charAttrs': {
        const ch = room.character(str(msg.char, 40));
        if (!room.canEditChar(user, ch)) throw new Error('That isn’t your character');
        room.setCharAttrs(ch, msg.set, msg.remove, conn);
        return reply({});
      }
      case 'sheetRoll': case 'startRoll': {
        const ch = room.character(str(msg.char, 40));
        if (!room.canEditChar(user, ch)) throw new Error('That isn’t your character');
        const r = R20.rollMessage(str(msg.text, 20000));
        const m = { uid: user.id, from: ch.name, pic: ch.token || ch.avatar || null, color: user.color, kind: 'r20', sheet: ch.sheet, char: ch.id,
          template: r.template, props: r.props, text: r.text, rolls: r.rolls, gmOnly: r.whisperGM, emote: r.emote };
        if (msg.t === 'sheetRoll') { room.post(m); trackerRolls(room, ch, r.rolls, user); return reply({}); }
        // startRoll: hold the message until the sheet's worker finishes it (or 20 seconds pass)
        const rollId = id('r');
        const results = {};
        for (const [k, v] of r.props || []) {
          const mm = /\u0001(\d+)\u0002/.exec(v);
          if (mm) { const ro = r.rolls[+mm[1]]; results[k] = { result: ro.total, dice: ro.dice.flatMap(d => d.d.filter(x => x[1]).map(x => x[0])), allDice: ro.dice.flatMap(d => d.d.map(x => x[0])), expression: ro.expr, rollIndex: +mm[1] }; }
        }
        const timer = setTimeout(() => { if (room.pending.delete(rollId)) { room.post(m); trackerRolls(room, ch, r.rolls, user); } }, 20000);
        room.pending.set(rollId, { m, ch, uid: user.id, timer, rolls: r.rolls, results });
        return reply({ rollId, results });
      }
      case 'finishRoll': {
        const p = room.pending.get(str(msg.rollId, 40));
        if (!p || p.uid !== user.id) throw new Error('That roll has expired');
        room.pending.delete(str(msg.rollId, 40)); clearTimeout(p.timer);
        for (const [k, v] of Object.entries(msg.computed || {})) {
          const res = p.results[k];
          if (res && res.rollIndex != null) p.m.rolls[res.rollIndex].computed = typeof v === 'number' ? v : str(v, 200);
        }
        room.post(p.m); trackerRolls(room, p.ch, p.m.rolls, user);
        return reply({});
      }
      case 'initRoll':
        rollInitiative(room, user, str(msg.scene, 40), msg.tokens, msg.mod); return reply({});
      case 'fx': {     // passing things: pings, rulers, dragging, "look here"
        const fx = { t: 'fx', kind: str(msg.kind, 20), from: user.id, name: user.name, color: user.color, scene: str(msg.scene, 40) };
        if (fx.kind === 'look' && !isGM(user)) throw new Error('Only the GM can move everyone’s view');
        for (const k of ['x', 'y', 'tokenId', 'zoom']) if (k in msg) fx[k] = k === 'tokenId' ? str(msg[k], 40) : num(msg[k]);
        if (Array.isArray(msg.pts)) fx.pts = msg.pts.slice(0, 50).map(p => [num(p[0]), num(p[1])]);
        for (const other of room.conns) {
          if (other === conn) continue;
          const sc = room.sceneFor(other);
          if (!sc || sc.id !== fx.scene) continue;
          if (fx.kind === 'drag' && !room.canSeeToken(other, fx.tokenId)) continue;
          send(other, fx);
        }
        return;
      }
      default: throw new Error('Unknown message');
    }
  } catch (e) {
    if (process.env.VTT_DEBUG) console.error(e.stack);
    reply({ error: e.message || String(e) });
    if (msg.rid == null) send(conn, { t: 'error', error: e.message });
  }
}

// ───────────────────────── HTTP ─────────────────────────

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };
const OPEN_PATHS = [/^\/table\/login\.html$/, /^\/table\/(login\.js|style\.css)$/, /^\/table\/shared\//, /^\/api\/(login|logout|invite\/|join|me)/, /^\/join\//, /^\/favicon\.ico$/];

// ───────── sending: text goes out gzipped when the browser takes it; generated files carry an ETag so a browser that
// already has them gets a 304 instead of the whole thing again ─────────
const zlib = require('zlib');
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;
const takesGzip = req => !!req && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
// body: a string or Buffer. opts.etag: work out an ETag from the content (and answer If-None-Match with a 304)
function sendBody(req, res, code, headers, body, opts) {
  body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  headers = Object.assign({}, headers);
  if (opts && opts.etag) {
    const tag = '"c-' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
    headers.ETag = tag;
    if (req && req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag, 'Cache-Control': headers['Cache-Control'] || 'no-cache' }); return res.end(); }
  }
  const finish = (buf, enc) => {
    if (enc) { headers['Content-Encoding'] = enc; headers.Vary = 'Accept-Encoding'; }
    headers['Content-Length'] = buf.length;
    res.writeHead(code, headers);
    res.end(req && req.method === 'HEAD' ? undefined : buf);
  };
  if (body.length > 1400 && COMPRESSIBLE.test(headers['Content-Type'] || '') && takesGzip(req))
    zlib.gzip(body, { level: 6 }, (err, z) => err ? finish(body) : finish(z, 'gzip'));
  else finish(body);
}
function sendJSON(res, code, obj) { sendBody(res.req, res, code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify(obj)); }
// static files compressed once and kept (keyed by path and ETag), up to about 64 MB
const gzCache = new Map(); let gzBytes = 0;
function gzFile(file, etag, done) {
  const key = file + etag, hit = gzCache.get(key);
  if (hit) { gzCache.delete(key); gzCache.set(key, hit); return done(null, hit); }
  fs.readFile(file, (err, buf) => {
    if (err) return done(err);
    zlib.gzip(buf, { level: 9 }, (e, z) => {
      if (e) return done(e);
      gzCache.set(key, z); gzBytes += z.length;
      for (const [k, v] of gzCache) { if (gzBytes <= 64 * 1024 * 1024) break; gzCache.delete(k); gzBytes -= v.length; }
      done(null, z);
    });
  });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function bodyJSON(req, limit) { const b = await readBody(req, limit || 1e6); try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { return {}; } }
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function lanUrls() {
  const out = [];
  if (/^(127\.|localhost$|::1$)/.test(process.env.VTT_HOST || '')) return out;   // behind a proxy (a server): the address people use is the site's own
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${config.port}`);
  return out;
}
const loginAttempts = new Map();

async function api(req, res, user, p) {
  const m = req.method;
  if (m !== 'GET' && !sameOrigin(req)) return sendJSON(res, 403, { error: 'Bad origin' });
  if (p === '/api/me') return sendJSON(res, 200, { user: publicUser(user), guest: !user && !isPrivate(), local: isLocal(req), localNoLogin: config.localNoLogin });
  if (!user && p === '/api/campaigns' && m === 'GET' && !isPrivate())   // what a visitor may watch
    return sendJSON(res, 200, { campaigns: listCampaigns().filter(c => canSee(GUEST, c)).map(c => ({ id: c.id, name: c.name, mode: c.mode, scenes: c.scenes.length, players: c.members.length })) });
  if (p === '/api/login' && m === 'POST') {
    const ip = req.socket.remoteAddress, a = loginAttempts.get(ip) || { n: 0, t: now() };
    if (now() - a.t > 10 * 60e3) { a.n = 0; a.t = now(); }
    if (a.n >= 10) return sendJSON(res, 429, { error: 'Too many tries. Wait ten minutes.' });
    const b = await bodyJSON(req), u = userByName(b.name);
    if (!u || !checkPassword(u, b.password || '')) { a.n++; loginAttempts.set(ip, a); return sendJSON(res, 401, { error: 'Wrong name or password' }); }
    startSession(res, u); return sendJSON(res, 200, { user: publicUser(u) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const tok = cookies(req).vtt_session; if (tok) { delete sessions[tok]; saveSessions(); }
    res.setHeader('Set-Cookie', 'vtt_session=; Path=/; Max-Age=0'); return sendJSON(res, 200, {});
  }
  let mm;
  if ((mm = /^\/api\/invite\/([a-f0-9]{8,64})$/.exec(p))) {
    const inv = db.invites.find(i => i.token === mm[1] && !i.used);
    if (!inv) return sendJSON(res, 404, { error: 'This invite link has been used or withdrawn.' });
    const room = inv.campaign && getRoom(inv.campaign);
    return sendJSON(res, 200, { role: inv.role, campaign: room ? room.c.name : null });
  }
  if (p === '/api/join' && m === 'POST') {
    const b = await bodyJSON(req);
    const inv = db.invites.find(i => i.token === b.token && !i.used);
    if (!inv) return sendJSON(res, 404, { error: 'This invite link has been used or withdrawn.' });
    const name = str(b.name, 40).trim();
    if (!name) return sendJSON(res, 400, { error: 'Choose a name' });
    let u = userByName(name);
    if (u) {   // an existing player joining another campaign: they prove who they are
      if (!checkPassword(u, b.password || '')) return sendJSON(res, 400, { error: 'That name is taken. If it’s yours, enter your password.' });
    } else {
      if (String(b.password || '').length < 6) return sendJSON(res, 400, { error: 'Use a password of at least six characters' });
      u = { id: id('u'), name, role: inv.role === 'gm' ? 'gm' : 'player', color: USER_COLOURS[db.users.length % USER_COLOURS.length], pass: hashPassword(b.password), created: now() };
      db.users.push(u);
    }
    inv.used = now(); inv.usedBy = u.id;
    const room = inv.campaign && getRoom(inv.campaign);
    if (room && !room.c.members.includes(u.id)) room.c.members.push(u.id);
    if (room && u.role === 'gm') { room.c.roles = room.c.roles || {}; if (inv.role === 'gm') delete room.c.roles[u.id]; else room.c.roles[u.id] = 'player'; }   // a GM's account asked in as a player plays here
    if (room) room.changed();
    saveUsers(); startSession(res, u);
    return sendJSON(res, 200, { user: publicUser(u), campaign: room ? room.c.id : null });
  }

  // everything below needs someone logged in
  if (!user) return sendJSON(res, 401, { error: 'Log in first' });
  if (p === '/api/password' && m === 'POST') {
    const b = await bodyJSON(req);
    if (user.pass && !(isLocal(req) && isGM(user)) && !checkPassword(user, b.old || '')) return sendJSON(res, 400, { error: 'Your current password is wrong' });
    if (String(b.password || '').length < 6) return sendJSON(res, 400, { error: 'Use at least six characters' });
    user.pass = hashPassword(b.password);
    if (b.name && isGM(user)) { const nm = str(b.name, 40).trim(); if (nm && (!userByName(nm) || userByName(nm) === user)) user.name = nm; }
    saveUsers(); return sendJSON(res, 200, { user: publicUser(user) });
  }
  if (p === '/api/campaigns' && m === 'GET') {
    return sendJSON(res, 200, { campaigns: listCampaigns().filter(c => canSee(user, c)).map(c => ({ id: c.id, name: c.name, mode: c.mode, scenes: c.scenes.length, players: c.members.length })) });
  }
  if (p === '/api/campaigns' && m === 'POST') {
    if (!isGM(user)) return sendJSON(res, 403, { error: 'Only the GM can do that' });
    const b = await bodyJSON(req);
    // the date it starts on: the year the GM picked (and month and day), at nine in the morning
    let t;
    if (b.year !== undefined && b.year !== '' && isFinite(+b.year)) {
      const C = site.calendar().cal, mo = Math.round(num(b.month, 0, 0, C.months.length - 1));
      t = Cal.toT(C, Math.round(num(b.year, 1, -1e6, 1e6)), mo, Math.round(num(b.day, 1, 1, C.months[mo].days)), 9, 0);
    }
    const room = createCampaign(b.name, b.mode === '2d6' ? '2d6' : '5e', t);
    return sendJSON(res, 200, { campaign: { id: room.c.id, name: room.c.name } });
  }
  if ((mm = /^\/api\/campaigns\/([a-z0-9]+)\/foundry$/i.exec(p)) && m === 'POST') {
    const room = getRoom(mm[1]);
    if (!room || !canSee(user, room.c)) return sendJSON(res, 404, { error: 'No such campaign' });
    if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can import' });
    const b = JSON.parse((await readBody(req, MAX_UPLOAD)).toString('utf8') || '{}');
    if (typeof b.foundryData === 'string') { config.foundryData = b.foundryData.trim(); saveConfig(); }
    return sendJSON(res, 200, importFoundry(room, user, b));
  }
  // ── the art library: pictures for props (scenery, furniture, chests…), shared by every campaign ──
  if (p === '/api/art' && m === 'GET') {
    if (!user) return sendJSON(res, 403, { error: 'Log in first' });
    return sendJSON(res, 200, { art: artLib().art });
  }
  if (p === '/api/art/upload' && m === 'POST') {
    if (!user || !isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can add art' });
    const type = String(req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[type];
    if (!ext) return sendJSON(res, 400, { error: 'Pictures only: PNG, JPG, WebP or GIF' });
    const buf = await readBody(req, MAX_UPLOAD), q = new URL(req.url, 'http://x').searchParams;
    const name = str(q.get('name') || 'art', 80).replace(/\.[a-z0-9]+$/i, '');
    const fname = `${name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50) || 'art'}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.mkdirSync(LIB_ART, { recursive: true });
    fs.writeFileSync(path.join(LIB_ART, fname), buf);
    const e = { id: id('r'), name: name.replace(/[-_]+/g, ' ').trim() || 'Art', url: `/vtt-data/library/art/${fname}`, folder: str(q.get('folder') || '', 60).trim(),
      pw: Math.round(num(q.get('w'), 0, 0, 20000)), ph: Math.round(num(q.get('h'), 0, 0, 20000)), added: now() };
    artLib().art.push(e); saveArt();
    return sendJSON(res, 200, { art: e });
  }
  if ((mm = /^\/api\/art\/([a-z0-9]+)$/i.exec(p)) && (m === 'PATCH' || m === 'DELETE')) {
    if (!user || !isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can change the art' });
    const L = artLib(), e = L.art.find(x => x.id === mm[1]); if (!e) return sendJSON(res, 404, { error: 'No such picture' });
    if (m === 'DELETE') { L.art = L.art.filter(x => x !== e); saveArt(); return sendJSON(res, 200, {}); }   // (the file stays: props already placed still show it)
    const b = JSON.parse((await readBody(req, 100000)).toString('utf8') || '{}');
    if ('name' in b) e.name = str(b.name, 80) || e.name;
    if ('folder' in b) e.folder = str(b.folder, 60).trim();
    for (const k of ['sw', 'sh']) if (k in b) e[k] = b[k] == null ? undefined : num(b[k], 1, 0.05, 400);   // its usual size, in squares
    if ('blocks' in b) e.blocks = !!b.blocks;
    if ('container' in b) e.container = !!b.container;
    saveArt(); return sendJSON(res, 200, { art: e });
  }
  if ((mm = /^\/api\/campaigns\/([a-z0-9]+)\/roll20$/i.exec(p)) && m === 'POST') {
    const room = getRoom(mm[1]);
    if (!room || !canSee(user, room.c)) return sendJSON(res, 404, { error: 'No such campaign' });
    if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can import' });
    const b = JSON.parse((await readBody(req, MAX_UPLOAD)).toString('utf8') || '{}');
    return sendJSON(res, 200, await importRoll20(room, user, b));
  }
  if ((mm = /^\/api\/campaigns\/([a-z0-9]+)\/ddb$/i.exec(p)) && m === 'POST') {
    const room = getRoom(mm[1]);
    if (!room || !canSee(user, room.c)) return sendJSON(res, 404, { error: 'No such campaign' });
    if (user.guest) return sendJSON(res, 403, { error: 'Log in to bring in a character' });   // (players bring in their own)
    const b = JSON.parse((await readBody(req, MAX_UPLOAD)).toString('utf8') || '{}');
    return sendJSON(res, 200, await importDDB(room, user, b));
  }
  if (p === '/api/foundry' && m === 'GET') {   // where we'd look for Foundry's pictures
    if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can do that' });
    return sendJSON(res, 200, { foundryData: config.foundryData || '', found: foundryDirs().filter(d => fs.existsSync(d)) });
  }
  // a scene's thumbnail (the scenes list), made by the GM's browser from its map: one file a scene, replaced each time
  if ((mm = /^\/api\/campaigns\/([a-z0-9]+)\/thumb\/([a-z0-9]+)$/i.exec(p)) && m === 'POST') {
    const room = getRoom(mm[1]);
    if (!room || !canSee(user, room.c)) return sendJSON(res, 404, { error: 'No such campaign' });
    if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can do that' });
    const sc = room.c.scenes.find(x => x.id === mm[2]);
    if (!sc) return sendJSON(res, 404, { error: 'No such scene' });
    const ext = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' }[String(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) return sendJSON(res, 400, { error: 'JPG, WebP or PNG only' });
    const buf = await readBody(req, 800 * 1024);
    const dir = path.join(campaignDir(room.c.id), 'assets');
    fs.mkdirSync(dir, { recursive: true });
    for (const e of ['.jpg', '.webp', '.png']) if (e !== ext) { try { fs.unlinkSync(path.join(dir, `thumb-${sc.id}${e}`)); } catch (err) { /* none */ } }
    fs.writeFileSync(path.join(dir, `thumb-${sc.id}${ext}`), buf);
    sc.thumb = `/vtt-data/campaigns/${room.c.id}/assets/thumb-${sc.id}${ext}?v=${Date.now().toString(36)}`;
    room.changed();
    return sendJSON(res, 200, { url: sc.thumb });
  }
  if ((mm = /^\/api\/campaigns\/([a-z0-9]+)\/(invites|members|upload)(?:\/([a-z0-9]+))?$/i.exec(p))) {
    const room = getRoom(mm[1]);
    if (!room || !canSee(user, room.c)) return sendJSON(res, 404, { error: 'No such campaign' });
    const what = mm[2];
    if (what === 'upload' && m === 'POST') {
      if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can upload files' });
      const type = String(req.headers['content-type'] || '').split(';')[0];
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
        'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
        'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.m4a', 'audio/webm': '.webm', 'audio/flac': '.flac', 'audio/x-flac': '.flac' }[type];
      if (!ext) return sendJSON(res, 400, { error: 'Pictures (PNG, JPG, WebP, GIF) or sound (MP3, OGG, WAV, M4A, FLAC) only' });
      const buf = await readBody(req, MAX_UPLOAD);
      const base = str(new URL(req.url, 'http://x').searchParams.get('name') || 'image', 60).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'image';
      const fname = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const dir = path.join(campaignDir(room.c.id), 'assets');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fname), buf);
      return sendJSON(res, 200, { url: `/vtt-data/campaigns/${room.c.id}/assets/${fname}` });
    }
    if (!isGM(asIn(room.c, user))) return sendJSON(res, 403, { error: 'Only the GM can do that' });
    if (what === 'invites') {
      if (m === 'POST') {
        const b = await bodyJSON(req);
        const inv = { token: crypto.randomBytes(12).toString('hex'), role: b.role === 'gm' ? 'gm' : 'player', campaign: room.c.id, created: now() };
        db.invites.push(inv); saveUsers();
      }
      if (m === 'DELETE' && mm[3]) { db.invites = db.invites.filter(i => i.token !== mm[3]); saveUsers(); }
      const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : null;
      return sendJSON(res, 200, { publicUrl: base, lan: lanUrls(), invites: db.invites.filter(i => i.campaign === room.c.id && !i.used).map(i => ({ token: i.token, role: i.role, created: i.created })) });
    }
    if (what === 'members') {
      if (m === 'PUT' && mm[3] && mm[3] !== user.id) {   // a GM's account: a player in this campaign, or a GM here too
        const b = await bodyJSON(req), u = userById(mm[3]);
        if (u && u.role === 'gm') { room.c.roles = room.c.roles || {}; if (b.role === 'player') { room.c.roles[u.id] = 'player'; if (!room.c.members.includes(u.id)) room.c.members.push(u.id); } else delete room.c.roles[u.id];
          room.changed(); for (const conn of room.conns) if (conn.user.id === u.id) conn.ws.close(4002, 'Your role here changed'); }
      }
      if (m === 'DELETE' && mm[3]) { room.c.members = room.c.members.filter(x => x !== mm[3]); room.changed(); for (const conn of room.conns) if (conn.user.id === mm[3]) conn.ws.close(4001, 'Removed'); }
      return sendJSON(res, 200, { members: room.c.members.map(userById).filter(Boolean).map(u => Object.assign(publicUser(u), { account: u.role, here: roleIn(room.c, u) })) });
    }
  }
  if (p === '/api/server') {
    if (!isGM(user)) return sendJSON(res, 403, { error: 'Only the GM can do that' });
    if (m === 'POST') {
      const b = await bodyJSON(req);
      if ('publicUrl' in b) config.publicUrl = /^https?:\/\/[^\s]+$/i.test(b.publicUrl || '') ? b.publicUrl.trim() : '';
      if ('localNoLogin' in b) config.localNoLogin = !!b.localNoLogin;
      saveConfig();
    }
    return sendJSON(res, 200, { port: config.port, publicUrl: config.publicUrl, localNoLogin: config.localNoLogin, lan: lanUrls(), local: isLocal(req) });
  }
  return sendJSON(res, 404, { error: 'Not found' });
}

function serveFile(req, res, file, forcedType) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const type = forcedType || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    const longCache = /\/(tiles|icons|leaflet|vendor)\//.test(file.replace(/\\/g, '/')) || /\/assets\//.test(file.replace(/\\/g, '/'));
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && st.size > 0) {   // part of a file: audio needs this to jump about in a track
      let a = rg[1] === '' ? Math.max(0, st.size - Number(rg[2])) : Number(rg[1]), b = rg[1] !== '' && rg[2] !== '' ? Number(rg[2]) : st.size - 1;
      b = Math.min(b, st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': longCache ? 'max-age=86400' : 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    const cache = longCache ? 'max-age=86400' : 'no-cache';
    if (COMPRESSIBLE.test(type) && st.size > 1400 && st.size < 32 * 1024 * 1024 && takesGzip(req)) {
      return gzFile(file, etag, (e, z) => {
        if (e) { res.writeHead(500); return res.end(); }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': z.length, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ETag: etag, 'Cache-Control': cache });
        res.end(req.method === 'HEAD' ? undefined : z);
      });
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// the world site: map data, wiki, drive and admin (server/site.js)
// people, for Admin › People: make an account, see the campaigns, put someone in or take them out of one
const people = {
  create(name, role, password) {
    name = str(name, 40).trim();
    if (!name) throw new Error('Give them a name');
    if (userByName(name)) throw new Error(`There's already someone called ${name}`);
    const u = { id: id('u'), name, role: role === 'gm' ? 'gm' : 'player', color: USER_COLOURS[db.users.length % USER_COLOURS.length], pass: hashPassword(password), created: now() };
    db.users.push(u); saveUsers();
    return u;
  },
  campaigns: () => listCampaigns().map(c => ({ id: c.id, name: c.name, members: c.members.slice() })),
  setMember(cid, uid, on) {
    const room = getRoom(cid); if (!room) return;
    const has = room.c.members.includes(uid);
    if (on && !has) { room.c.members.push(uid); room.changed(); }
    if (!on && has) { room.c.members = room.c.members.filter(x => x !== uid); room.changed(); for (const conn of room.conns) if (conn.user.id === uid) conn.ws.close(4001, 'Removed'); }
  }
};
const site = require('./site.js')({ worldSaved: info => worldSaved(info), ROOT, DATA, config, saveConfig, isGM, sendJSON, sendBody, readBody, bodyJSON, serveFile, str, num, now, log, readJSON, writeJSON,
  db, saveUsers, publicUser, hashPassword, sessions, saveSessions, sameOrigin, MIME, people, onCalendar: (pub, gm) => calendarChanged(pub, gm) });
// The world's clock moved (or the weather changed): every open table hears, and scenes that follow the clock get
// as dark as it is outside.
// The world's calendar (its months, years and events) with this campaign's own date and weather.
function roomTime(room, gm) {
  return Object.assign({}, site.calendarFor(gm), { t: room.c.clock.t, weather: room.c.clock.weather, campaign: room.c.id });
}
// A campaign's clock moved, or the calendar changed: its scenes that follow the clock get as dark as it is, and its tables hear.
function clockChanged(room) {
  const k = roomTime(room, true), dark = Cal.darkness(k.cal, k.t);
  let changed = false;
  for (const s of room.c.scenes) if (s.clock && s.darkness !== dark) { s.darkness = dark; changed = true; if (room.wallsChanged) room.wallsChanged(s); }
  if (changed) room.changed(); else room.save();
  for (const conn of room.conns) send(conn, { t: 'time', cal: roomTime(room, isGM(conn.user)) });
}
function calendarChanged() { for (const room of rooms.values()) clockChanged(room); }
const compendium = require('./compendium.js')({ ROOT, DATA, config, saveConfig, isGM, sendJSON, readBody, bodyJSON, serveFile, str, num, now, log, readJSON, writeJSON,
  db, saveUsers, publicUser, hashPassword, sessions, saveSessions, sameOrigin, MIME });
// Unless the site is private (Admin › The site), visitors who aren't logged in may look at everything: the map, the wiki and
// (watching) the table. What they may see inside a campaign is decided per request below and in the Room.

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p;
    try { p = decodeURIComponent(u.pathname); } catch (e) { res.writeHead(400); return res.end(); }
    const user = userFor(req);
    if (await site.handle(req, res, user, p)) return;
    if (await compendium.handle(req, res, user, p)) return;
    if (p.startsWith('/api/')) return await api(req, res, user, p);
    const open = OPEN_PATHS.some(r => r.test(p)) || !isPrivate();
    if (!user && !open) {
      if (/\.(js|css|png|jpe?g|webp|json|md)$/i.test(p)) { res.writeHead(401); return res.end(); }
      res.writeHead(302, { Location: '/table/login.html?next=' + encodeURIComponent(req.url) }); return res.end();
    }
    if (p === '/') { res.writeHead(302, { Location: '/index.html' }); return res.end(); }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.startsWith('/join/')) return serveFile(req, res, path.join(ROOT, 'table', 'login.html'));
    if (p === '/table' || p === '/table/') return serveFile(req, res, path.join(ROOT, 'table', 'index.html'));
    // private folders
    let mm;
    if ((mm = /^\/vtt-data\/library\/(sounds|art)\/([^/]+)$/i.exec(p))) {   // the shared sounds and art: anyone who may be at a table
      if (!user && ![...rooms.values()].some(r => canSee(GUEST, r.c))) { res.writeHead(404); return res.end(); }
      return serveFile(req, res, path.join(mm[1].toLowerCase() === 'art' ? LIB_ART : LIB_SOUNDS, path.basename(mm[2])));
    }
    if ((mm = /^\/vtt-data\/campaigns\/([a-z0-9]+)\/assets\/([^/]+)$/i.exec(p))) {
      const room = getRoom(mm[1]);
      if (!room || !canSee(user || GUEST, room.c)) { res.writeHead(404); return res.end(); }
      return serveFile(req, res, path.join(campaignDir(mm[1]), 'assets', path.basename(mm[2])));
    }
    if (/^\/(vtt-data|server)(\/|$)/i.test(p) || /(^|\/)\./.test(p)) { res.writeHead(404); return res.end('Not found'); }
    if (p.includes('\\') || p.includes('\0')) { res.writeHead(400); return res.end(); }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(400); return res.end(); }
    // check again on the real path, so no spelling of the URL reaches the private folders
    const parts = path.relative(ROOT, file).split(/[\\/]/);
    if (/^(vtt-data|server)$/i.test(parts[0]) || parts.some(x => x.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
    serveFile(req, res, file);
  } catch (e) {
    log('Request failed', req.url, e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
  }
});

// big updates (a scene's walls, a whole campaign) go compressed; small ones as they are
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 4 }, concurrencyLimit: 4 } });
server.on('upgrade', (req, socket, head) => {
  const user = userFor(req) || (isPrivate() ? null : GUEST);
  if (!new URL(req.url, 'http://x').pathname.startsWith('/ws') || !user || !sameOrigin(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    const conn = { ws, user, room: null, sent: null, sceneId: null, alive: true, cid: ++connSeq };
    send(conn, { t: 'hello', user: publicUser(user), now: Date.now() });
    ws.on('message', raw => onMessage(conn, raw));
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => { if (conn.room) { conn.room.conns.delete(conn); conn.room.publish(); } if (conn.site) { siteConns.delete(conn); schedulePeers(); } });
    const iv = setInterval(() => { if (!conn.alive) { ws.terminate(); return clearInterval(iv); } conn.alive = false; try { ws.ping(); } catch (e) { /* closed */ } }, 30000);
    ws.on('close', () => clearInterval(iv));
  });
});

function shutdown() {
  log('Saving and stopping…');
  for (const room of rooms.values()) try { writeJSON(room.file(), room.c); } catch (e) { log(e.message); }
  try { writeJSON(USERS_FILE, db); writeJSON(SESSIONS_FILE, sessions); } catch (e) { log(e.message); }
  flushSaves();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') { process.on('SIGBREAK', shutdown); process.on('SIGHUP', shutdown); }

// VTT_HOST=127.0.0.1 when a web server in front (Caddy, nginx) passes requests on: then nothing else can reach the port
try { library(); } catch (e) { console.log('The sound library: ' + e.message); }   // (and every campaign's sounds into it)
server.listen(config.port, process.env.VTT_HOST || '0.0.0.0', () => {
  console.log('');
  console.log(`  ${site.settings().siteName} is running.`);
  console.log(`  On this PC:        http://localhost:${config.port}/`);
  for (const u of lanUrls()) console.log(`  On your network:   ${u}/`);
  if (config.publicUrl) console.log(`  Players' address:  ${config.publicUrl}`);
  console.log('  Close this window (or press Ctrl+C) to stop it. Everything is saved as you go.');
  console.log('');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log(`\n  Port ${config.port} is already in use: is the table already running in another window?\n  (Or change "port" in vtt-data\\config.json.)\n`);
  else console.log(e);
  process.exit(1);
});
