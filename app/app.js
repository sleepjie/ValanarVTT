/* Valanar map viewer and editor.
 *
 * Positions are stored in map pixels of the full-size source image (x right, y down from the top-left
 * corner), so they stay put when the map is re-exported at the same size and re-tiled.
 *
 * Data lives in data/markers.js. In Edit mode the page writes that file directly once you connect the
 * map-viewer folder (Chrome or Edge). Until then every change is kept in this browser as a draft.
 */
'use strict';
(function () {

// ───────────────────────── settings ─────────────────────────

const INFO = Object.assign({ width: 28064, height: 16384, ext: '.webp' }, window.MAP_INFO || {});
const TILE = 256;
const NATIVE = Math.ceil(Math.log2(Math.max(INFO.width, INFO.height) / TILE)); // zoom where 1 screen px = 1 map px
const ICON_GROWTH = 0.5;      // icons grow at half the rate the map does when zooming
const PARAMS = new URLSearchParams(location.search);
// ?embed: shown inside the table (as the world map scene, or its Wiki button), which has its own top bar links
const EMBED = PARAMS.has('embed');
if (EMBED) document.documentElement.classList.add('embed');
// &scene: a world map scene in the table, which brings its own tools: none of the site's (search, tool column, readout)
const SCENE = EMBED && PARAMS.has('scene');
if (SCENE) document.documentElement.classList.add('scenemode');
// Served by the table's server, the server says who's looking: admins edit, and edits save there. Opened on its own
// (as a file), anyone on this PC may edit and changes save to data/markers.js in the folder.
const SERVER = window.VALANAR_SERVER || null;
// Another version of the world map (a campaign's, for another time): index.html?atlas=<id> loads its places, borders
// and names (and its picture, from maps/<folder>/); changes save to it, never to the main map.
const ATLAS = window.VALANAR_ATLAS || null;
const TILES = window.VALANAR_TILES || '';
const CAN_EDIT = SERVER ? !!SERVER.admin : location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname) || PARAMS.has('edit');
const DRAFT_KEY = 'valanar-map-draft';
const UNDO_LIMIT = 300;
const BACKUPS_KEPT = 30;
const NO_ICON = 'none';       // icon value meaning "show just the name"
// Travel paces for the ruler: miles per hour, and hours on the move per day. Editable on the map
// (Ruler, in Edit mode). D&D-style travel paces; the ship is a placeholder.
const DEFAULT_TRAVEL = [
  { label: 'On foot', mph: 3, hours: 10, note: 'Walking about 3 mph, up to 10 hours a day with a short rest.' },
  { label: 'On foot, encumbered', mph: 1.5, hours: 10, note: 'Encumbered: walking speed is halved.' },
  { label: 'On horseback', mph: 8, hours: 8, note: 'Two 4-hour rides with an hour’s break for food, water and rest. Skipping a break: one level of exhaustion for the horse (Con save DC 15 negates).' },
  { label: 'Horse and cart', mph: 4, hours: 8, note: 'A horse drawing a cart or carriage manages about 4 mph; the same breaks apply.' },
  { label: 'By ship', mph: 4, hours: 24, note: 'Placeholder: a ship under sail, day and night.' }
];

const DEFAULT_TYPES = [
  // size: icon width in map pixels at full zoom (for text types: the text height). minZoom/maxZoom: zoom range
  // where visitors see it. labelZoom: zoom where the name appears under the icon.
  // fields: 'settlement' uses the Settlement Sheet fields; 'place' uses the short list in details (plus any you add).
  { id: 'capital',   label: 'Capital City', icon: 'icons/default/capital.svg', size: 100, minZoom: 0,   labelZoom: 3,    fields: 'settlement' },
  { id: 'city',      label: 'City',         icon: 'icons/default/city.svg', size: 76,  minZoom: 3,   labelZoom: 4,    fields: 'settlement' },
  { id: 'free-city', label: 'Free City',    icon: 'icons/default/free-city.svg', size: 76,  minZoom: 3,   labelZoom: 4,    fields: 'settlement' },
  { id: 'town',      label: 'Town',         icon: 'icons/default/town.svg', size: 57,  minZoom: 4,   labelZoom: 5,    fields: 'settlement' },
  { id: 'village',   label: 'Village',      icon: 'icons/default/village.svg',      size: 38,  minZoom: 5,   labelZoom: 5.75, fields: 'settlement' },
  { id: 'hamlet',    label: 'Hamlet',       icon: 'icons/default/hamlet.svg',      size: 25,  minZoom: 5.5, labelZoom: 6.25, fields: 'settlement' },
  { id: 'fortress',  label: 'Fortress',     icon: 'icons/default/fortress.svg',     size: 57,  minZoom: 4.5, labelZoom: 5.5,  fields: 'place', details: ['Held by', 'Garrison'] },
  { id: 'temple',    label: 'Temple',       icon: 'icons/default/temple.svg',     size: 45,  minZoom: 5,   labelZoom: 6,    fields: 'place', details: ['Dedicated to', 'Order'] },
  { id: 'ruin',      label: 'Ruin',         icon: 'icons/default/ruin.svg',     size: 50,  minZoom: 5,   labelZoom: 6,    fields: 'place', details: ['Once', 'Fell'] },
  { id: 'mine',      label: 'Mine',         icon: 'icons/default/mine.svg', size: 38,  minZoom: 5.5, labelZoom: 6,    fields: 'place', details: ['Yields', 'Worked by'] },
  { id: 'camp',      label: 'Camp',         icon: 'icons/default/camp.svg',     size: 30,  minZoom: 5.5, labelZoom: 6,    fields: 'place', details: ['Occupied by'] },
  { id: 'landmark',  label: 'Landmark',     icon: 'icons/default/landmark.svg',     size: 45,  minZoom: 5,   labelZoom: 6,    fields: 'place', details: ['Also known as', 'Significance'] },
  { id: 'feature',   label: 'Place name',   text: true, size: 22,  minZoom: 5,   labelZoom: 0, fields: 'place', details: [] },
  { id: 'country',   label: 'Country name', text: true, size: 90,  minZoom: 0,   maxZoom: 5.5, labelZoom: 0, fields: 'place', details: [] }
];

// Columns of the Settlement Sheet, in its order. Name, type, region and nation have their own fields.
const INFO_FIELDS = ['Demonym', 'Population Approx', 'Dominant Races', 'Founding Date', 'Founder or Origin',
  'Military Presence', 'Primary Exports', 'Geographic Features', 'Notable Landmarks', 'Nearest Settlements'];
const FACILITIES = ['Library / Archive', 'Healing / Hospitals', 'Magic Shop', 'Temple / Shrine', 'Marketplace',
  'Forge / Blacksmith', 'Inn / Lodging', 'Walls / Fortifications', 'Academy / School', 'Port / Dock'];
const NOTES = 'Notes/Annotations';
const NATION_COLOURS = ['#a3473a', '#56569c', '#5b8a3c', '#b8862f', '#76569a', '#2f8079', '#8e5b3a', '#b45f7a',
  '#4f7f5a', '#8a7a2e', '#5a6aa8', '#a86a2a', '#6f8a3a', '#7e3f56', '#3f7f8f', '#9a5040', '#61598f', '#8f8a4a'];

// ───────────────────────── helpers ─────────────────────────

const $ = s => document.querySelector(s);
const canon = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const uid = (p = 'm') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const fmt = n => Math.round(n).toLocaleString('en-GB');
const clone = o => JSON.parse(JSON.stringify(o));
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTyping = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|range|color|button)$/.test(a.type)); };
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

// An icon image, or a placeholder for "no icon".
function iconEl(path, cls) {
  if (path && path !== NO_ICON) return h('img', { src: path, alt: '', class: cls || null });
  return h('span', { class: 'noicon' + (cls ? ' ' + cls : ''), title: 'No icon: just the name' }, 'no icon');
}

function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  $('#toasts').append(t);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

const hexRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16, (n >> 8) & 255, n & 255]; };

// Smooth curve through a border's points (uniform Catmull-Rom, ends held). Returns [[x, y], ...].
function smooth(pts, per = 10) {
  if (pts.length < 3) return pts.slice();
  const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ───────────────────────── data ─────────────────────────

function normalise(d) {
  d = d && typeof d === 'object' ? clone(d) : {};
  const out = {
    version: 1,
    savedAt: d.savedAt || null,
    types: Array.isArray(d.types) && d.types.length ? d.types : DEFAULT_TYPES.map(t => clone(t)),
    markers: Array.isArray(d.markers) ? d.markers : [],
    unplaced: Array.isArray(d.unplaced) ? d.unplaced : [],
    nations: Array.isArray(d.nations) ? d.nations : [],
    borders: Array.isArray(d.borders) ? d.borders : [],
    settings: Object.assign({ politicalFill: 0.35, milesPerPx: 0.2, travel: DEFAULT_TRAVEL.map(t => ({ ...t })) }, d.settings && typeof d.settings === 'object' ? d.settings : {}),
    imports: Array.isArray(d.imports) ? d.imports : [],
    routes: Array.isArray(d.routes) ? d.routes.filter(r => r && Array.isArray(r.pts)) : [],     // sea lanes, roads… (app/maptools.js)
    labels: Array.isArray(d.labels) ? d.labels.filter(l => l && Array.isArray(l.pts)) : [],     // names of oceans, seas, lakes…
    armies: Array.isArray(d.armies) ? d.armies.filter(a => a && a.id && isFinite(a.x) && isFinite(a.y)) : []   // bands, companies, hosts (app/armies.js)
  };
  out.settings.travel = (Array.isArray(out.settings.travel) ? out.settings.travel : DEFAULT_TRAVEL.map(t => ({ ...t })))
    .map(t => (t.mph ? t : { label: t.label, mph: (+t.perDay || 24) / 8, hours: 8 }));
  for (const t of out.types) {        // types saved before "fields" existed
    const def = DEFAULT_TYPES.find(x => x.id === t.id);
    if (!t.fields) t.fields = def ? def.fields : 'settlement';
    if (t.fields === 'place' && !Array.isArray(t.details)) t.details = def && def.details ? def.details.slice() : [];
  }
  for (const list of [out.markers, out.unplaced]) for (const m of list) {
    m.id = m.id || uid();
    m.name = m.name || 'Unnamed';
    m.info = m.info && typeof m.info === 'object' ? m.info : {};
  }
  for (const n of out.nations) { n.id = n.id || uid('n'); n.name = n.name || 'Unnamed nation'; n.color = n.color || '#888888'; n.seeds = Array.isArray(n.seeds) ? n.seeds : []; }
  out.borders = out.borders.filter(b => b && Array.isArray(b.pts) && b.pts.length >= 2);
  for (const b of out.borders) b.id = b.id || uid('b');
  return out;
}

// data/import.js: one-off batches (borders and nations from Wonderdraft, extra icons, the places on a closer map).
// Each is merged once, then remembered in data.imports so it never applies twice. Nothing already on the map is
// overwritten, except by an update that says so (and one with ifName only while the place still has that name).
function applyImport() {
  const list = Array.isArray(window.VALANAR_IMPORTS) ? window.VALANAR_IMPORTS : [window.VALANAR_IMPORT];
  let res = null;
  for (const imp of list) {
    const r = applyOne(imp);
    if (r) { res = res || { nations: 0, borders: 0, markers: 0, updates: 0, notes: [] }; for (const k of ['nations', 'borders', 'markers', 'updates']) res[k] += r[k]; if (imp.note) res.notes.push(imp.note); }
  }
  return res;
}
function applyOne(imp) {
  if (!imp || !imp.id || data.imports.includes(imp.id)) return null;
  const res = { nations: 0, borders: 0, markers: 0, updates: 0 };
  for (const n of imp.nations || []) {
    if (data.nations.some(x => x.id === n.id || canon(x.name) === canon(n.name))) continue;
    data.nations.push(clone(n)); res.nations++;
  }
  for (const b of imp.borders || []) if (!data.borders.some(x => x.id === b.id)) { data.borders.push(clone(b)); res.borders++; }
  for (const m of imp.markers || []) if (!findAny(m.id)) { data.markers.push(clone(m)); res.markers++; }
  for (const u of imp.updates || []) {
    const m = findMarker(u.id);
    if (m && (!u.ifType || m.type === u.ifType) && (!u.ifName || m.name === u.ifName)) { Object.assign(m, clone(u.set)); if (m.unnamed === false) delete m.unnamed; res.updates++; }
  }
  data.imports.push(imp.id);
  return res;
}

let data = normalise(window.VALANAR_DATA);
let ARMY = null;                             // armies on the map and how fast they march (app/armies.js)
let MT = null;                               // routes, water names and map settings (app/maptools.js), made once the map is up
let fileSavedAt = data.savedAt;              // savedAt of the markers.js this page last loaded or wrote
let icons = (window.VALANAR_ICONS || []).slice();

const typeById = id => data.types.find(t => t.id === id);
const typeOf = m => typeById(m.type) || data.types[0] || DEFAULT_TYPES[0];
const findMarker = id => data.markers.find(m => m.id === id);
const findAny = id => findMarker(id) || data.unplaced.find(m => m.id === id);
const iconOf = m => m.icon || typeOf(m).icon || NO_ICON;
const hasIcon = m => !typeOf(m).text && iconOf(m) !== NO_ICON;
const sizeOf = m => +m.size || +typeOf(m).size || 120;
const isPlace = m => typeOf(m).fields === 'place';
const findNation = id => data.nations.find(n => n.id === id);

const imported = applyImport();

// ───────────────────────── map ─────────────────────────

const map = L.map('map', {
  crs: L.CRS.Simple, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
  maxZoom: NATIVE + 1, attributionControl: false, zoomControl: false, maxBoundsViscosity: 0.8,
  doubleClickZoom: true
});
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Layers, bottom to top: sea (150), map tiles (200), political fill (350), borders (380), icons (600),
// border handles and claim pins (650).
for (const [name, z, pe] of [['ocean', 150, 'none'], ['political', 350, 'none'], ['borders', 380, null], ['poltools', 650, null]]) {
  const p = map.createPane(name); p.style.zIndex = z; if (pe) p.style.pointerEvents = pe;
}

const toLatLng = (x, y) => map.unproject([x, y], NATIVE);
const toPixel = ll => map.project(ll, NATIVE);
const bounds = L.latLngBounds(toLatLng(0, INFO.height), toLatLng(INFO.width, 0));

let tilesLoaded = 0;
const TILE_URL = TILES + 'tiles/{z}/{y}/{x}' + INFO.ext + (SERVER && SERVER.tilesV ? '?v=' + SERVER.tilesV : '');
// Smoother zooming: a new level's tiles fade in over the old ones (eased, about half a second, rather than Leaflet's
// 0.2 s pop), and once the map stops, the next level in and out is fetched quietly so a zoom finds it ready.
const TILE_FADE = 480;
const SmoothTiles = L.TileLayer.extend({
  _updateOpacity() {
    if (!this._map) return;
    L.DomUtil.setOpacity(this._container, this.options.opacity);
    const now = +new Date; let more = false, prune = false;
    for (const key in this._tiles) {
      const tile = this._tiles[key]; if (!tile.current || !tile.loaded) continue;
      const f = Math.min(1, (now - tile.loaded) / TILE_FADE);
      L.DomUtil.setOpacity(tile.el, f * f * (3 - 2 * f));
      if (f < 1) more = true; else { if (tile.active) prune = true; else this._onOpaqueTile(tile); tile.active = true; }
    }
    if (prune && !this._noPrune) this._pruneTiles();
    if (more) { L.Util.cancelAnimFrame(this._fadeFrame); this._fadeFrame = L.Util.requestAnimFrame(this._updateOpacity, this); }
  }
});
const tileLayer = new SmoothTiles(TILE_URL, {
  tileSize: TILE, bounds, noWrap: true, minZoom: 0, maxNativeZoom: NATIVE, maxZoom: NATIVE + 1, keepBuffer: 4
}).on('tileload', () => { tilesLoaded++; $('#notice').hidden = true; })
  .on('tileerror', () => { if (!tilesLoaded) $('#notice').hidden = false; })
  .addTo(map);
{
  const warm = new Set(); let timer = 0;
  const prefetch = () => {
    if (!tilesLoaded || document.hidden) return;
    const z0 = Math.round(map.getZoom()), c = map.getCenter(), s = map.getSize();
    for (const z of [z0 + 1, z0 - 1]) {
      if (z < 0 || z > NATIVE) continue;
      const cp = map.project(c, z), n = Math.ceil(INFO.width / Math.pow(2, NATIVE - z) / TILE), m = Math.ceil(INFO.height / Math.pow(2, NATIVE - z) / TILE);
      const x0 = Math.max(0, Math.floor((cp.x - s.x / 2) / TILE)), x1 = Math.min(n - 1, Math.floor((cp.x + s.x / 2) / TILE));
      const y0 = Math.max(0, Math.floor((cp.y - s.y / 2) / TILE)), y1 = Math.min(m - 1, Math.floor((cp.y + s.y / 2) / TILE));
      const list = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list.push([x, y, Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2)]);
      list.sort((a, b) => a[2] - b[2]);
      for (const [x, y] of list.slice(0, 48)) {
        const u = TILE_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
        if (warm.has(u)) continue; warm.add(u);
        const im = new Image(); im.decoding = 'async'; im.src = u;
      }
    }
    if (warm.size > 3000) warm.clear();
  };
  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(prefetch, 700); });
}

map.fitBounds(bounds);
// Map settings › The view: how far past the whole map you can zoom out, and drag past its edges
let viewOpts = { zoomOut: 0, pan: 0.15 };
let restrictBox = null;   // the table: a player may only look at what the GM has revealed
const fitMin = () => restrictBox ? map.setMinZoom(Math.min(NATIVE, map.getBoundsZoom(restrictBox, false) - 0.25)) : map.setMinZoom(map.getBoundsZoom(bounds, false) - (+viewOpts.zoomOut || 0));
fitMin();
map.setMaxBounds(bounds.pad(0.15));
map.on('resize', fitMin);
function applyView(v) {
  viewOpts = Object.assign({ zoomOut: 0, pan: 0.15 }, v || {});
  fitMin();
  if (restrictBox) return;
  map.setMaxBounds(bounds.pad(Math.max(0, Math.min(1, +viewOpts.pan || 0)) + (+viewOpts.zoomOut ? 0.5 * viewOpts.zoomOut : 0)));
}

function setIconScale(z) {
  const k = Math.pow(2, (z - NATIVE) * ICON_GROWTH);
  document.documentElement.style.setProperty('--k', k.toFixed(4));
}
map.on('zoomanim', e => setIconScale(e.zoom));
map.on('zoomend', () => { setIconScale(map.getZoom()); applyVisibility(); drawReadout(); });
setIconScale(map.getZoom());

// Readout of the map pixel under the cursor (and the nation there, when borders are showing).
const Readout = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd() { this.el = L.DomUtil.create('div', 'hud'); return this.el; }
});
const readout = new Readout().addTo(map);
let cursor = null;
function drawReadout() {
  const z = map.getZoom();
  const pos = cursor ? `x <b>${fmt(cursor.x)}</b> &nbsp;y <b>${fmt(cursor.y)}</b>` : '<span class="dim">outside map</span>';
  const n = cursor && polVisible() ? nationAt(cursor.x, cursor.y) : null;
  readout.el.innerHTML = `${pos}${n ? ` &nbsp;<span class="nat" style="--c:${escHTML(n.color)}">${escHTML(n.name)}</span>` : ''} <span class="dim">&nbsp;|&nbsp; zoom ${+z.toFixed(2)} of ${NATIVE}${z > NATIVE + 0.01 ? ' (enlarged past the picture’s own detail)' : ''} &nbsp;|&nbsp; ${data.markers.length} placed</span>`;
}
map.on('mousemove', e => {
  const p = toPixel(e.latlng);
  cursor = (p.x >= 0 && p.y >= 0 && p.x < INFO.width && p.y < INFO.height) ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null;
  drawReadout();
  if (drawing()) drawDraft(e.latlng);
});
map.on('mouseout', () => { cursor = null; drawReadout(); });

// ───────────────────────── markers on the map ─────────────────────────

const layer = L.layerGroup().addTo(map);
const live = new Map();   // id -> { marker, sig }
let dragBefore = null;

// Lettering: italic, bold, small caps, letter spacing, ink, halo (light, dark, none) and, for names, a curve along an
// arc (m.curve degrees: + arches up, − sags down). Each comes from the entry, else its type (the type's preset), else
// the usual look. STYLE_KEYS are the ones a type can preset.
const STYLE_KEYS = ['ital', 'bold', 'caps', 'spacing', 'halo', 'ink'];
const sv = (m, k) => (m[k] !== undefined ? m[k] : typeOf(m)[k]);
const styleSig = m => STYLE_KEYS.map(k => sv(m, k)).join(',');
function letteringCss(m, isText) {
  const ital = sv(m, 'ital'), bold = sv(m, 'bold'), caps = sv(m, 'caps'), sp = sv(m, 'spacing'), ink = sv(m, 'ink'), halo = sv(m, 'halo');
  const hc = halo === 'dark' ? 'rgba(20,16,10,.85)' : halo === 'none' ? null : 'var(--parch)';
  const css = [];
  if (isText ? ital === false : ital === true) css.push(isText ? 'font-style:normal' : 'font-style:italic');
  if (bold) css.push('font-weight:800');
  if (caps) css.push('font-variant:small-caps');
  if (sp != null && sp !== '') css.push(`letter-spacing:${+sp}em`);
  if (ink) css.push(`color:${ink}`);
  if (halo === 'none') css.push('text-shadow:none'); else if (halo === 'dark') css.push(`text-shadow:0 0 2px ${hc},0 0 4px ${hc},0 0 7px ${hc}`);
  return { css: css.join(';'), halo: hc, sp: sp != null && sp !== '' ? +sp : (isText ? 0.04 : 0) };
}
function textLabel(m) {
  const { css, halo, sp } = letteringCss(m, true);
  const curve = Math.max(-300, Math.min(300, +m.curve || 0));
  if (!curve) return h('span', { class: 'tl', style: css }, m.name);
  // along an arc, in an SVG measured in ems so it scales with the text: the text's middle sits on the anchor
  const name = String(m.name || ''), A = Math.abs(curve) * Math.PI / 180;
  const W = name.length * (0.52 + sp) + 0.2, R = W / A, half = Math.min(A * 0.5 + 0.35, Math.PI * 0.98);
  const up = curve > 0, b = 0.32, f = n => +n.toFixed(4);
  const pt = a => up ? [R * Math.sin(a), b + R - R * Math.cos(a)] : [R * Math.sin(a), -b - R + R * Math.cos(a) + 0.7];
  const [x0, y0] = pt(-half), [x1, y1] = pt(half), id = 'arc-' + m.id;
  const svg = `<svg class="tl arc" viewBox="-0.5 -0.5 1 1" style="${css};letter-spacing:0"><defs><path id="${id}" d="M${f(x0)} ${f(y0)} A${f(R)} ${f(R)} 0 ${half > Math.PI / 2 ? 1 : 0} ${up ? 1 : 0} ${f(x1)} ${f(y1)}"/></defs>`
    + `<text font-size="1" text-anchor="middle" style="letter-spacing:${sp}px;fill:currentColor${halo ? `;stroke:${halo};stroke-width:0.14px;stroke-linejoin:round;paint-order:stroke` : ''}"><textPath href="#${id}" startOffset="50%">${escHTML(name)}</textPath></text></svg>`;
  const wrap = h('span', { class: 'tlwrap' }); wrap.innerHTML = svg; return wrap.firstChild;
}

// The lettering fields, for one entry, several at once, or a type's preset (Unity-style: where the chosen ones differ,
// a field shows [...] until it is set, which sets it on all of them).
//  objs: what's being edited; apply(fn): run fn on each of them (one undo step); opts.curve: show Curve;
//  opts.text: name-only types (italic is their usual); opts.base(o, k): the value an entry gets when it has none (its type's)
function textStyleFields(objs, apply, opts = {}) {
  const MIX = '[...]';
  const base = opts.base || (() => undefined);
  const raw = (o, k) => o[k];
  const eff = (o, k, def) => { const v = raw(o, k) !== undefined ? raw(o, k) : base(o, k); return v !== undefined && v !== '' ? v : def; };
  const one = (k, def) => { const vs = objs.map(o => eff(o, k, def)); return vs.every(v => v === vs[0]) ? { v: vs[0] } : { mixed: true }; };
  const own = k => { const vs = objs.map(o => raw(o, k)); return vs.every(v => v === vs[0]) ? { v: vs[0] } : { mixed: true }; };
  const italDef = !!opts.text;
  const flag = (k, label, def) => {
    const st = one(k, def);
    const cb = h('input', { type: 'checkbox', checked: st.v ? true : null,
      onchange: e => apply(x => { const on = e.target.checked; if (on === (base(x, k) !== undefined ? !!base(x, k) : def)) delete x[k]; else x[k] = on; }) });
    if (st.mixed) cb.indeterminate = true;
    return h('label', { class: 'tsflag', title: st.mixed ? 'These differ: tick or untick to set them all' : '' }, cb, label);
  };
  const numField = (k, label, attrs, def) => {
    const st = own(k), b = objs.length === 1 ? base(objs[0], k) : undefined;
    return h('div', null, h('label', null, label), h('input', Object.assign({ type: 'number', value: st.mixed ? '' : (st.v ?? ''),
      placeholder: st.mixed ? MIX : String(b ?? def),
      onchange: e => apply(x => { if (e.target.value === '') delete x[k]; else x[k] = Math.max(attrs.min, Math.min(attrs.max, +e.target.value)); }) }, attrs)));
  };
  const haloSt = one('halo', 'light'), inkSt = one('ink', '');
  const halo = h('select', { onchange: e => { if (e.target.value === MIX) return; apply(x => { const v = e.target.value; if (v === (base(x, 'halo') || 'light')) delete x.halo; else x.halo = v; }); } },
    haloSt.mixed ? h('option', { value: MIX, selected: true }, MIX) : null,
    ...[['light', 'Light (parchment)'], ['dark', 'Dark'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: !haloSt.mixed && haloSt.v === v || null }, l)));
  const ink = h('input', { type: 'color', value: inkSt.v || '#1d1a16', title: inkSt.mixed ? 'These differ: pick a colour to set them all' : 'The colour of the lettering',
    onchange: e => apply(x => { x.ink = e.target.value; }) });
  return h('div', { class: 'tstyle' },
    h('div', { class: 'row' },
      opts.curve ? numField('curve', 'Curve (degrees)', { step: 5, min: -300, max: 300, title: 'Bend the name along an arc: positive arches up, negative sags down' }, 0) : null,
      numField('spacing', 'Letter spacing', { step: 0.02, min: -0.1, max: 1.5, title: 'Space between letters, in ems: wide spacing suits mountain ranges and regions' }, opts.text ? 0.04 : 0)),
    h('div', { class: 'tsflags' }, flag('ital', 'Italic', italDef), flag('bold', 'Bold', false), flag('caps', 'Small caps', false)),
    h('div', { class: 'row' },
      h('div', null, h('label', null, 'Halo'), halo),
      h('div', null, h('label', null, 'Ink' + (inkSt.mixed ? ' ' + MIX : '')),
        h('div', { class: 'tsink' }, ink, objs.some(o => raw(o, 'ink')) ? h('button', { class: 'tool', title: 'Back to the usual ink', onclick: () => apply(x => { delete x.ink; }) }, 'Reset') : null))));
}

function iconHTML(m) {
  if (typeOf(m).text) {
    return h('div', { class: 'mk txt', style: `--s:${sizeOf(m)};--rot:${+m.rot || 0}deg` }, textLabel(m)).outerHTML;
  }
  if (!hasIcon(m)) return h('div', { class: 'mk noic' }, h('span', { class: 'pin' }), h('span', { class: 'lbl' }, m.name)).outerHTML;
  const img = h('img', { src: iconOf(m), alt: '', draggable: 'false', class: m.flip ? 'flip' : null });
  const lbl = h('span', { class: 'lbl', style: letteringCss(m, false).css || null }, m.name);
  return h('div', { class: 'mk', style: `--s:${sizeOf(m)}` }, img, lbl).outerHTML;
}
const sigOf = m => [m.x, m.y, m.name, iconOf(m), sizeOf(m), m.flip, m.rot, !!typeOf(m).text, m.curve, styleSig(m)].join('|');
const divIcon = m => L.divIcon({ className: 'mk-wrap', html: iconHTML(m), iconSize: [0, 0], iconAnchor: [0, 0] });

function syncMarkers() {
  const ids = new Set(data.markers.map(m => m.id));
  for (const [id, rec] of live) if (!ids.has(id)) { layer.removeLayer(rec.marker); live.delete(id); }
  for (const m of data.markers) {
    const sig = sigOf(m);
    const rec = live.get(m.id);
    if (!rec) {
      const marker = L.marker(toLatLng(m.x, m.y), { icon: divIcon(m), draggable: editMode, keyboard: false, autoPan: true });
      const id = m.id;
      marker.on('click', e => {
        if (rulerOn) { const mm = findMarker(id); if (mm) rulerAdd([mm.x, mm.y]); return; }   // measure from/to a place
        if (MT && MT.busy()) { const mm = findMarker(id); MT.clickAt(map.mouseEventToLatLng(e.originalEvent), mm ? [mm.x, mm.y] : null); return; }   // drawing a route: snap to the place
        if (placing) placeAt(map.mouseEventToLatLng(e.originalEvent));
        else if (editMode && (e.originalEvent.ctrlKey || e.originalEvent.metaKey)) toggleMulti(id);   // Ctrl+click: several at once
        else select(id);
      });
      marker.on('dblclick', () => { if (rulerOn) rulerFinish(); });
      marker.on('dragstart', () => { dragBefore = JSON.stringify(data); });
      marker.on('dragend', () => {
        const mm = findMarker(id); if (!mm) return;
        const p = toPixel(marker.getLatLng());
        mm.x = Math.round(clamp(p.x, 0, INFO.width - 1));
        mm.y = Math.round(clamp(p.y, 0, INFO.height - 1));
        commit(dragBefore);
        select(id);
      });
      layer.addLayer(marker);
      live.set(m.id, { marker, sig });
    } else if (rec.sig !== sig) {
      rec.marker.setLatLng(toLatLng(m.x, m.y));
      rec.marker.setIcon(divIcon(m));
      rec.sig = sig;
    }
  }
  for (const { marker } of live.values()) {
    if (marker.dragging) editMode ? marker.dragging.enable() : marker.dragging.disable();
  }
  applyVisibility();
  drawReadout();
}

let fogTest = null;   // set by the table: (x, y) → true where the fog of war hides a place from this player
function applyVisibility() {
  const z = map.getZoom();
  for (const [id, { marker }] of live) {
    const el = marker.getElement(); if (!el) continue;
    const m = findMarker(id); if (!m) continue;
    const t = typeOf(m);
    const sel = id === selectedId || multiSel.has(id);
    const noIcon = !t.text && !hasIcon(m);
    const inRange = z >= (+t.minZoom || 0) && (t.maxZoom == null || t.maxZoom === '' || z <= +t.maxZoom);
    // A name-only place is nothing but its name, so an unnamed one stays hidden from visitors.
    el.classList.toggle('hid', !(editMode || sel || (inRange && !(noIcon && m.unnamed))) || (!!fogTest && !editMode && fogTest(m.x, m.y)));
    const labelAt = noIcon ? (+t.minZoom || 0) : (+t.labelZoom || 0);
    el.classList.toggle('nolbl', !(sel || (z >= labelAt && (editMode || !m.unnamed))));
    el.classList.toggle('sel', sel);
  }
}

// ───────────────────────── undo / redo ─────────────────────────

const undoStack = [], redoStack = [];
let eraId = null, mainData = null;   // Through the ages: another age's map on show (nothing is saved meanwhile)

// Run fn, record the state before it for undo, then refresh. opts.panel=false keeps the panel as it is
// (used by form fields, so clicking from one field to the next doesn't rebuild the form under the cursor).
function change(fn, opts = {}) {
  if (eraId) { toast('This is how the map looked in another age: go back to now to change it.', true); return; }
  const before = JSON.stringify(data);
  fn();
  commit(before, opts);
}
function commit(before, opts = {}) {
  if (before == null || JSON.stringify(data) === before) return;
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  refresh(opts);
}
function undo() {
  if (!undoStack.length || eraId) return;
  redoStack.push(JSON.stringify(data));
  data = JSON.parse(undoStack.pop());
  refresh(); toast('Undone');
}
function redo() {
  if (!redoStack.length || eraId) return;
  undoStack.push(JSON.stringify(data));
  data = JSON.parse(redoStack.pop());
  refresh(); toast('Redone');
}
function refresh(opts = {}) {
  if (selectedId && !findAny(selectedId)) { selectedId = null; if (panelMode === 'marker') panelMode = null; }
  if (selBorder && !data.borders.some(b => b.id === selBorder)) selBorder = null;
  if (activeNation && !findNation(activeNation)) activeNation = null;
  if (placing && placing.kind === 'unplaced' && !data.unplaced.some(u => u.id === placing.id)) advancePlacing();
  syncMarkers();
  syncPolitical();
  if (MT) MT.sync(); if (ARMY) ARMY.sync();
  if (AMB) AMB.refresh();
  if (opts.panel !== false) renderPanel();
  renderEditBar();
  renderBanner();
  saveDraft();
  scheduleSave();
}

// ───────────────────────── selection and panel ─────────────────────────

let selectedId = null;
const multiSel = new Set();   // Ctrl+clicked entries, edited together (panel 'multi')
let panelMode = null;       // 'marker' | 'unplaced' | 'types' | 'political' | null
let unplacedFilter = '';

// ── what you looked at lately (kept in this browser): pages and places, the newest first
const RECENT_KEY = 'valanar-recent';
function recentList() { try { const l = JSON.parse(store.get(RECENT_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function remember(kind, key, title) {
  if (!key || !title) return;
  const l = recentList().filter(r => !(r.kind === kind && r.key === key));
  l.unshift({ kind, key, title, ts: Date.now() });
  store.set(RECENT_KEY, JSON.stringify(l.slice(0, 30)));
}
function recentHits(n) {
  return recentList().map(r => {
    if (r.kind === 'page') { const p = pageByPath.get(r.key); return p ? { kind: 'page', p, recent: true } : null; }
    const m = findMarker(r.key); return m ? { kind: 'place', m, un: false, recent: true } : null;
  }).filter(Boolean).slice(0, n || 8);
}
function select(id, opts = {}) {
  selectedId = id; multiSel.clear();
  if (!editMode) { const m = findMarker(id); if (m && !m.unnamed) remember('place', id, m.name); }
  panelMode = 'marker';
  renderPanel();
  applyVisibility();
  syncPolitical();
  if (opts.fly) {
    const m = findMarker(id);
    if (m) map.flyTo(toLatLng(m.x, m.y), Math.max(map.getZoom(), Math.min(NATIVE, (+typeOf(m).labelZoom || 5) + 0.5)), { duration: 0.8 });
  }
}
// panels the other modules add (Tales, How far in a day…): { render() → nodes, closed() }
const PANELS = {};
function openPanel(mode) {
  const prevMode = panelMode;
  panelMode = panelMode === mode ? null : mode;
  if (prevMode !== panelMode && PANELS[prevMode] && PANELS[prevMode].closed) PANELS[prevMode].closed();
  if (mode !== 'marker') selectedId = null;
  if (mode !== 'multi') multiSel.clear();
  if (panelMode !== 'political') cancelDraw();
  renderPanel(); applyVisibility(); renderEditBar(); syncPolitical();
}
function closePanel() {
  if (MT && ['routes', 'names'].includes(panelMode)) MT.panelClosed();
  const prevMode = panelMode;
  panelMode = null; selectedId = null; multiSel.clear(); cancelDraw(); selBorder = null;
  if (PANELS[prevMode] && PANELS[prevMode].closed) PANELS[prevMode].closed();
  renderPanel(); applyVisibility(); renderEditBar(); syncPolitical();
}

function panelShell(title, ...body) {
  return [h('div', { class: 'head' }, h('span', { class: 'ttl' }, title), h('button', { class: 'x', title: 'Close (Esc)', onclick: closePanel }, '×')),
    h('div', { class: 'body' }, ...body)];
}

function renderPanel() {
  const p = $('#panel');
  const open = (panelMode === 'multi' && multiSel.size) || (panelMode === 'marker' && selectedId && findAny(selectedId)) || ['unplaced', 'types', 'political'].includes(panelMode) || (MT && ['routes', 'names', 'settings'].includes(panelMode)) || !!PANELS[panelMode];
  for (const [k, id] of [['reach', 'reachToggle'], ['tales', 'talesToggle']]) { const b = $('#' + id); if (b) b.classList.toggle('on', panelMode === k); }
  p.hidden = !open;
  document.body.classList.toggle('panel-open', !!open);
  if (!open) { p.replaceChildren(); return; }
  const scroll = p.scrollTop;
  if (panelMode === 'multi') p.replaceChildren(...multiForm());
  else if (panelMode === 'marker') p.replaceChildren(...(editMode ? markerForm(findAny(selectedId)) : markerView(findAny(selectedId))));
  else if (panelMode === 'unplaced') p.replaceChildren(...unplacedPanel());
  else if (panelMode === 'types') p.replaceChildren(...typesPanel());
  else if (panelMode === 'political') p.replaceChildren(...politicalPanel());
  else if (MT && ['routes', 'names', 'settings'].includes(panelMode)) p.replaceChildren(...MT.panel(panelMode));
  else if (PANELS[panelMode]) p.replaceChildren(...PANELS[panelMode].render().filter(Boolean));
  p.scrollTop = scroll;
}

// Keys of m.info shown as text rows: for settlements the sheet columns, for places the type's details;
// then anything else the entry has.
function detailKeys(m) {
  const t = typeOf(m);
  const base = isPlace(m) ? (t.details || []) : INFO_FIELDS;
  const extra = Object.keys(m.info).filter(k => !base.includes(k) && !FACILITIES.includes(k) && k !== NOTES && typeof m.info[k] !== 'boolean');
  return { base, extra };
}

function markerView(m) {
  const t = typeOf(m);
  const place = [m.region, nationOfMarker(m)].filter(Boolean).join(', ');
  const { base, extra } = detailKeys(m);
  const rows = [];
  for (const k of base.concat(extra)) {
    const v = m.info[k];
    if (v === '' || v == null || typeof v === 'boolean') continue;
    rows.push(h('tr', null, h('th', null, k.replace(' Approx', '')), h('td', null, String(v))));
  }
  const fac = isPlace(m) ? [] : Object.entries(m.info).filter(([, v]) => v === true).map(([k]) => h('span', null, k));
  const links = [];
  const page = pageForMarker(m), nation = nationOfMarker(m), npage = pageForNation(nation);
  if (m.wiki && /^https?:\/\//i.test(m.wiki)) links.push(h('a', { class: 'btn', href: m.wiki, target: '_blank', rel: 'noopener' }, 'Read the full entry →'));
  if (m.map) links.push(h('button', { class: 'btn primary', title: m.map.kind === 'atlas' ? 'Open its own map' : 'Its map, to zoom about', onclick: () => viewPlaceMap(m) }, '🗺 View map'));
  if (page) links.push(h('a', { class: 'btn', href: wikiHref(page.path) }, `Read about ${page.title} →`));
  if (npage && npage !== page) links.push(h('a', { class: 'btn', href: wikiHref(npage.path) }, `${npage.title} in the wiki →`));
  const wiki = [links.length ? h('div', { class: 'btnrow wikilinks' }, links) : null,
    m.wiki && !page && !/^https?:/i.test(m.wiki) ? h('p', { class: 'muted small' }, 'Wiki page: ' + m.wiki + ' (not in the wiki yet)') : null];
  return panelShell(t.label,
    hasIcon(m) ? h('img', { class: m.flip ? 'hero flip' : 'hero', src: iconOf(m), alt: '' }) : null,
    h('h1', null, m.name),
    h('p', { class: 'sub' }, [t.label, place].filter(Boolean).join(' · ')),
    rows.length ? h('table', { class: 'infobox' }, rows) : null,
    fac.length ? [h('h2', null, 'Facilities'), h('div', { class: 'chips' }, fac)] : null,
    m.info[NOTES] ? [h('h2', null, 'Notes'), h('p', { class: 'notes' }, m.info[NOTES])] : null,
    wiki,
    !rows.length && !fac.length && !m.info[NOTES] ? h('p', { class: 'muted' }, 'No details recorded yet.') : null,
    // the way from here, or to here (app/reach.js)
    REACH && REACH.wayFrom && !SCENE ? h('div', { class: 'btnrow travelrow' },
      h('button', { class: 'btn sm', title: 'Plan a journey from here: the way, day by day', onclick: () => REACH.wayFrom(m) }, '⚑ Set out from here'),
      h('button', { class: 'btn sm', title: 'Plan a journey to here', onclick: () => REACH.wayTo(m) }, 'The way here')) : null
  );
}

// ── a place's own map: a picture from Files (a city plan, a dungeon), or a version of the world map with its own tiles;
// its card then has View map
let atlasList = null;
function loadAtlases() {
  if (atlasList || !SERVER) return;
  atlasList = [];
  fetch('/api/site/atlases', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { atlases: [] }).then(j => { atlasList = j.atlases || []; if (panelMode === 'marker') renderPanel(); }).catch(() => {});
}
function mapField(m) {
  loadAtlases();
  const mp = m.map, setMap = v => change(() => { const x = findAny(m.id); if (v) x.map = v; else delete x.map; });
  const desc = !mp ? 'None yet' : mp.kind === 'atlas' ? `The map “${((atlasList || []).find(a => a.id === mp.id) || {}).name || 'a version of the map'}”` : (mp.name || 'A picture');
  return [h('label', null, 'Its own map'),
    h('div', { class: 'mapfield' },
      mp && mp.kind === 'file' ? h('img', { src: mp.url, alt: '' }) : null,
      h('span', { class: 'small grow' }, desc),
      DRIVE ? h('button', { class: 'btn sm', title: 'A picture from Files, or upload one: a city plan, a dungeon, a battle map', onclick: () => DRIVE.pickFile({ images: true, folder: 'Maps' }).then(f => { if (f) setMap({ kind: 'file', url: f.url, name: f.name.replace(/\.[^.]+$/, '') }); }) }, 'A picture…') : null,
      atlasList && atlasList.length ? h('select', { title: 'Or a version of the world map with its own picture (made with make_tiles.bat)', onchange: e => { if (e.target.value) setMap({ kind: 'atlas', id: e.target.value }); } },
        h('option', { value: '' }, 'A map version…'), ...atlasList.map(a => h('option', { value: a.id, selected: mp && mp.kind === 'atlas' && mp.id === a.id || null }, a.name))) : null,
      mp ? h('button', { class: 'btn sm', title: 'No map for this place', onclick: () => setMap(null) }, '×') : null),
    h('p', { class: 'small muted' }, 'Its card then has “View map”.')];
}
function viewPlaceMap(m) {
  const mp = m && m.map; if (!mp) return;
  if (mp.kind === 'atlas') { location.href = location.pathname + '?atlas=' + encodeURIComponent(mp.id) + '#/map'; return; }
  const box = h('div', { class: 'placemap' });
  const bar = h('div', { class: 'pmbar' }, h('b', null, m.name), h('span', { class: 'muted' }, mp.name && mp.name !== m.name ? ' · ' + mp.name : ''), h('span', { class: 'grow' }),
    h('a', { class: 'pmbtn', href: mp.url, target: '_blank', rel: 'noopener', title: 'The picture on its own' }, 'Open the picture'),
    h('button', { class: 'pmbtn x', title: 'Close (Esc)', onclick: () => shut() }, '×'));
  const holder = h('div', { class: 'pmmap' });
  const ov = h('div', { class: 'pmroot' }, bar, holder, box);
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('on'));
  let pm = null;
  const keys = e => { if (e.key === 'Escape') { e.stopPropagation(); shut(); } };
  document.addEventListener('keydown', keys, true);
  function shut() { document.removeEventListener('keydown', keys, true); ov.classList.remove('on'); setTimeout(() => { if (pm) pm.remove(); ov.remove(); }, 250); }
  const img = new Image();
  img.onload = () => {
    pm = L.map(holder, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, zoomControl: true });
    const b = L.latLngBounds([[-img.naturalHeight, 0], [0, img.naturalWidth]]);
    L.imageOverlay(mp.url, b).addTo(pm);
    pm.fitBounds(b, { padding: [20, 20] });
    pm.setMinZoom(pm.getZoom() - 1);
    pm.setMaxBounds(b.pad(0.4));
  };
  img.onerror = () => { holder.replaceChildren(h('p', { class: 'pmerr' }, 'That picture couldn’t be loaded.')); };
  img.src = mp.url;
}

function datalist(id, values) {
  return h('datalist', { id }, [...new Set(values.filter(Boolean))].sort(natural).map(v => h('option', { value: v })));
}

function markerForm(m) {
  const placed = !!findMarker(m.id);
  const all = data.markers.concat(data.unplaced);
  const t = typeOf(m);
  // A field edit: change the data without rebuilding the form, then refresh the map.
  const set = (fn) => change(() => fn(findAny(m.id)), { panel: false });
  const field = (label, key, attrs = {}) => h('div', null,
    h('label', null, label),
    h('input', Object.assign({ type: 'text', value: m[key] || '', onchange: e => set(x => { x[key] = e.target.value.trim(); }) }, attrs)));
  const infoField = (k, removable) => h('div', { class: removable ? 'detail rm' : 'detail' },
    h('label', null, k),
    h('input', { type: 'text', value: typeof m.info[k] === 'boolean' ? '' : (m.info[k] || ''),
      onchange: e => set(x => { const v = e.target.value.trim(); if (v) x.info[k] = v; else delete x.info[k]; }) }),
    removable ? h('button', { class: 'del', title: `Remove "${k}"`, onclick: () => change(() => { delete findAny(m.id).info[k]; }) }, '×') : null);
  const { base, extra } = detailKeys(m);
  const isText = !!t.text;

  const nameInput = h('input', { type: 'text', class: 'name', id: 'fName', value: m.name,
    onchange: e => set(x => { x.name = e.target.value.trim() || 'Unnamed'; delete x.unnamed; }) });

  // "Add a detail": label + value, for places (and any entry that needs a one-off fact).
  const newKey = h('input', { type: 'text', placeholder: 'Detail, e.g. Age' });
  const newVal = h('input', { type: 'text', placeholder: 'Value' });
  const addDetail = () => {
    const k = newKey.value.trim(), v = newVal.value.trim();
    if (!k) { newKey.focus(); return; }
    if (k === NOTES || FACILITIES.includes(k)) { toast('That name is taken by another field.', true); return; }
    change(() => { findAny(m.id).info[k] = v || '—'; });
  };
  newVal.addEventListener('keydown', e => { if (e.key === 'Enter') addDetail(); });
  newKey.addEventListener('keydown', e => { if (e.key === 'Enter') newVal.focus(); });

  const nationNames = all.map(x => x.nation).concat(data.nations.map(n => n.name));

  // ✦ a name in the style of the places round it (app/names.js)
  const forge = NAMES && placed ? h('button', { class: 'btn sm forgebtn', title: 'Suggest a name in the style of the places round it (click again for another)', onclick: () => {
    const n = NAMES.suggest(nationOfMarker(m)); if (!n) { toast('Not enough names nearby to learn from yet.', true); return; }
    nameInput.value = n; set(x => { x.name = n; delete x.unnamed; });
  } }, '✦ Suggest') : null;
  return panelShell(placed ? (isPlace(m) ? 'Edit place' : 'Edit settlement') : 'Unplaced entry', h('div', { class: 'form' },
    h('label', null, 'Name'), forge ? h('div', { class: 'namerow' }, nameInput, forge) : nameInput,
    h('div', { class: 'row' },
      h('div', null, h('label', null, 'Type'),
        h('select', { onchange: e => change(() => { findAny(m.id).type = e.target.value; }) },
          data.types.map(x => h('option', { value: x.id, selected: x.id === m.type ? 'selected' : null }, x.label)))),
      h('div', null, h('label', null, isText ? 'Text size' : 'Size'),
        h('input', { type: 'number', min: 20, max: 600, step: 5, value: m.size || '', placeholder: String(t.size),
          onchange: e => set(x => { const v = +e.target.value; if (v > 0) x.size = v; else delete x.size; }) }))),
    isText ? h('div', null, h('label', null, 'Rotation (degrees)'),
      h('input', { type: 'number', step: 1, value: m.rot || '', placeholder: '0',
        onchange: e => set(x => { const v = +e.target.value; if (v) x.rot = v; else delete x.rot; }) })) : null,
    isText ? textStyleFields([m], fn => set(fn), { curve: true, text: true, base: (o, k) => typeOf(o)[k] }) : [
    h('label', null, 'Icon'),
    h('div', { class: 'iconpick' },
      h('button', { class: 'prev', title: 'Choose an icon, or none', onclick: () => pickIcon(iconOf(m), path => {
        change(() => { const x = findAny(m.id); if (path) x.icon = path; else delete x.icon; });
      }) }, iconEl(iconOf(m), m.flip ? 'flip' : null)),
      h('div', { class: 'small muted' },
        iconOf(m) === NO_ICON ? 'No icon: the name sits on the spot. ' : (m.icon ? 'Custom icon. ' : 'Using the type’s icon. '), h('br'), 'Click it to choose another.', h('br'),
        hasIcon(m) ? h('label', { class: 'inline' },
          h('input', { type: 'checkbox', checked: !!m.flip, onchange: e => set(x => { if (e.target.checked) x.flip = true; else delete x.flip; }) }), 'Mirror') : null))],
    isText ? null : h('details', { class: 'tsdet' }, h('summary', null, 'Lettering of the name'), textStyleFields([m], fn => set(fn), { base: (o, k) => typeOf(o)[k] })),
    h('div', { class: 'row' }, field('Nation', 'nation', { list: 'dlNation' }), field('Region / Province', 'region', { list: 'dlRegion' })),
    datalist('dlNation', nationNames), datalist('dlRegion', all.map(x => x.region)),
    field('Wiki page', 'wiki', { placeholder: 'Page name or link' }),
    mapField(m),
    placed ? h('p', { class: 'small muted coords' }, `Position: x ${fmt(m.x)}, y ${fmt(m.y)}. Drag it to move it, or nudge with the arrow keys.`) : null,

    h('h2', null, 'Details'),
    base.map(k => infoField(k, false)),
    extra.map(k => infoField(k, true)),
    h('div', { class: 'adddetail' }, newKey, newVal, h('button', { class: 'btn', onclick: addDetail }, 'Add')),
    isPlace(m) ? null : [h('label', null, 'Facilities'),
      h('div', { class: 'checks' }, FACILITIES.map(k => h('label', null,
        h('input', { type: 'checkbox', checked: m.info[k] === true, onchange: e => set(x => { x.info[k] = e.target.checked; }) }), k)))],
    h('label', null, 'Notes'),
    h('textarea', { onchange: e => set(x => { const v = e.target.value.trim(); if (v) x.info[NOTES] = v; else delete x.info[NOTES]; }) }, m.info[NOTES] || ''),

    h('div', { class: 'btnrow' },
      placed
        ? h('button', { class: 'btn', title: 'Take it off the map and put it back in the Unplaced list', onclick: () => unplace(m.id) }, 'Back to Unplaced')
        : h('button', { class: 'btn primary', onclick: () => startPlacing({ kind: 'unplaced', id: m.id }, [m.id]) }, 'Place on map'),
      h('button', { class: 'btn danger', onclick: () => removeMarker(m.id) }, 'Delete'))
  ));
}

function unplace(id) {
  change(() => {
    const i = data.markers.findIndex(m => m.id === id); if (i < 0) return;
    const [m] = data.markers.splice(i, 1);
    delete m.x; delete m.y;
    data.unplaced.unshift(m);
  });
  toast('Moved back to Unplaced');
}
// Copy and paste places (edit mode): Ctrl+C copies the selected place or places (Ctrl+click picks several),
// Ctrl+X cuts them, Ctrl+V puts copies where the mouse is (keeping how they sit together), Ctrl+D duplicates beside
// them. The copies are new places with the same type, icon, lettering and details. Kept in this browser too, so a
// copy carries to another tab of the map.
const CLIP_KEY = 'valanar-map-clip';
let clip = null;
const hasTextSelection = () => { const s = window.getSelection && window.getSelection(); return !!(s && String(s).trim()); };
function copyPlaces(cut, quiet) {
  const ids = multiSel.size ? [...multiSel] : selectedId ? [selectedId] : [];
  const list = ids.map(findMarker).filter(Boolean);
  if (!list.length) return false;
  clip = { at: Date.now(), places: list.map(m => clone(m)) };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (err) { /* this tab only */ }
  if (cut) {
    const gone = new Set(list.map(m => m.id));
    change(() => { data.markers = data.markers.filter(x => !gone.has(x.id)); });
    closePanel();
    toast(`Cut ${list.length === 1 ? (list[0].name || 'a place') : list.length + ' places'}: Ctrl+V puts ${list.length === 1 ? 'it' : 'them'} back where the mouse is.`);
  } else if (!quiet) toast(`Copied ${list.length === 1 ? (list[0].name || 'a place') : list.length + ' places'}: Ctrl+V pastes at the mouse.`);
  return true;
}
function pastePlaces(beside) {
  let c = clip;
  try { const s = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); if (s && (!c || s.at > c.at)) c = s; } catch (err) { /* keep ours */ }
  if (!c || !c.places || !c.places.length) return false;
  const xs = c.places.map(m => m.x), ys = c.places.map(m => m.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // where they go: beside the originals (Ctrl+D), else at the mouse, else the middle of the view
  const off = 40 * Math.pow(2, NATIVE - map.getZoom());
  const to = beside ? { x: cx + off, y: cy + off } : cursor ? cursor : (() => { const p = toPixel(map.getCenter()); return { x: p.x, y: p.y }; })();
  const fresh = c.places.map(m => Object.assign(clone(m), { id: uid(),
    x: Math.round(clamp(m.x - cx + to.x, 0, INFO.width - 1)), y: Math.round(clamp(m.y - cy + to.y, 0, INFO.height - 1)) }));
  change(() => { data.markers.push(...fresh); });
  if (fresh.length === 1) select(fresh[0].id);
  else { multiSel.clear(); selectedId = null; for (const m of fresh) multiSel.add(m.id); panelMode = 'multi'; renderPanel(); applyVisibility(); }
  toast(`Pasted ${fresh.length === 1 ? (fresh[0].name || 'a place') : fresh.length + ' places'}.`);
  return true;
}

// Ctrl+click: add a place to (or take it out of) the ones being edited together
function toggleMulti(id) {
  if (!multiSel.size && selectedId && selectedId !== id && findMarker(selectedId)) multiSel.add(selectedId);
  if (multiSel.has(id)) multiSel.delete(id); else multiSel.add(id);
  selectedId = null;
  if (multiSel.size === 1) { const [only] = multiSel; select(only); return; }
  panelMode = multiSel.size ? 'multi' : null;
  renderPanel(); applyVisibility(); syncPolitical();
}
// The panel for several places at once: a field the chosen ones share shows its value; where they differ it shows
// [...], and setting it sets it on all of them (one undo step)
function multiForm() {
  const MIX = '[...]';
  const list = [...multiSel].map(findMarker).filter(Boolean);
  if (list.length < 2) { multiSel.clear(); return []; }
  const apply = fn => change(() => { for (const m of list) { const x = findMarker(m.id); if (x) fn(x); } }, { panel: false });
  const applyRe = fn => change(() => { for (const m of list) { const x = findMarker(m.id); if (x) fn(x); } });
  const same = get => { const vs = list.map(get); return vs.every(v => v === vs[0]) ? { v: vs[0] } : { mixed: true }; };
  const allText = list.every(m => typeOf(m).text), anyText = list.some(m => typeOf(m).text);
  const typeSt = same(m => m.type);
  const textField = (label, key, attrs = {}) => { const st = same(m => m[key] || ''); return h('div', null, h('label', null, label),
    h('input', Object.assign({ type: 'text', value: st.mixed ? '' : st.v, placeholder: st.mixed ? MIX : '', onchange: e => apply(x => { const v = e.target.value.trim(); if (v) x[key] = v; else delete x[key]; }) }, attrs))); };
  const numField = (label, key, attrs, def) => { const st = same(m => m[key] ?? ''); return h('div', null, h('label', null, label),
    h('input', Object.assign({ type: 'number', value: st.mixed ? '' : st.v, placeholder: st.mixed ? MIX : def, onchange: e => apply(x => { const v = +e.target.value; if (e.target.value !== '' && v) x[key] = v; else delete x[key]; }) }, attrs))); };
  const counts = {};
  for (const m of list) { const l = typeOf(m).label; counts[l] = (counts[l] || 0) + 1; }
  return panelShell(`${list.length} selected`, h('div', { class: 'form' },
    h('p', { class: 'small muted' }, 'Ctrl+click more on the map to add them, or one of these to take it out. Where they differ a field shows [...]; set it to set it on all of them.'),
    h('div', { class: 'multichips' }, ...list.map(m => h('button', { class: 'chip', title: 'Take this one out', onclick: () => toggleMulti(m.id) }, m.name || 'Unnamed', ' ×'))),
    h('p', { class: 'small muted' }, Object.entries(counts).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(' · ')),
    h('div', { class: 'row' },
      h('div', null, h('label', null, 'Type'),
        h('select', { onchange: e => { if (e.target.value !== MIX) applyRe(x => { x.type = e.target.value; }); } },
          typeSt.mixed ? h('option', { value: MIX, selected: true }, MIX) : null,
          data.types.map(x => h('option', { value: x.id, selected: !typeSt.mixed && x.id === typeSt.v || null }, x.label)))),
      numField(allText ? 'Text size' : 'Size', 'size', { min: 5, max: 600, step: 5 }, '(type)')),
    allText ? numField('Rotation (degrees)', 'rot', { step: 1 }, '0') : null,
    h('h2', null, 'Lettering'),
    textStyleFields(list, apply, { curve: allText, text: allText, base: (o, k) => typeOf(o)[k] }),
    anyText && !allText ? h('p', { class: 'small muted' }, 'Curve and rotation are for name-only places: pick only those to change them.') : null,
    h('div', { class: 'row' }, textField('Nation', 'nation', { list: 'dlNation' }), textField('Region / Province', 'region', { list: 'dlRegion' })),
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => closePanel() }, 'Done'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Delete these ${list.length} places? Ctrl+Z brings them back.`)) return;
        const ids = new Set(list.map(m => m.id));
        change(() => { data.markers = data.markers.filter(x => !ids.has(x.id)); });
        closePanel();
      } }, `Delete all ${list.length}`))));
}

function removeMarker(id) {
  const m = findAny(id); if (!m) return;
  change(() => {
    data.markers = data.markers.filter(x => x.id !== id);
    data.unplaced = data.unplaced.filter(x => x.id !== id);
  });
  toast(`Deleted ${m.name}. Ctrl+Z brings it back.`);
}

function filteredUnplaced() {
  const q = canon(unplacedFilter);
  return data.unplaced.filter(u => !q || canon(u.name).includes(q) || canon(u.nation).includes(q) || canon(u.region).includes(q) || canon(typeOf(u).label).includes(q));
}

function unplacedPanel() {
  const list = filteredUnplaced();
  const groups = new Map();
  for (const u of list) { const g = u.nation || 'No nation'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(u); }
  const filter = h('input', { type: 'search', placeholder: 'Filter by name, nation, region or type', value: unplacedFilter,
    oninput: e => { unplacedFilter = e.target.value; const pos = e.target.selectionStart; renderPanel(); const f = $('#uFilter'); f.focus(); f.setSelectionRange(pos, pos); }, id: 'uFilter' });
  return panelShell(`Unplaced · ${data.unplaced.length}`, h('div', { class: 'form' },
    data.unplaced.length
      ? h('p', { class: 'small muted' }, 'Click a settlement, then click the map where it goes. With "Place in order", the next one is ready straight away. S skips, Esc stops.')
      : h('p', { class: 'muted' }, 'Nothing waiting. Import a CSV from the Settlement Sheet (File › Download › Comma-separated values, one tab at a time) to fill this list.'),
    data.unplaced.length ? filter : null,
    list.length ? h('div', { class: 'btnrow', style: 'margin-top:10px' },
      h('button', { class: 'btn primary', onclick: () => startPlacing({ kind: 'unplaced', id: list[0].id }, list.map(u => u.id)) }, `Place in order (${list.length})`)) : null,
    h('div', { class: 'ulist' }, [...groups].map(([g, items]) => [
      h('h3', null, `${g} · ${items.length}`),
      items.map(u => h('div', { class: 'urow' + (placing && placing.id === u.id ? ' on' : ''), title: 'Click, then click the map',
        onclick: () => startPlacing({ kind: 'unplaced', id: u.id }, list.map(x => x.id)) },
        hasIcon(u) ? h('img', { src: iconOf(u), alt: '' }) : h('span', { class: 'noicon sm' }, '—'),
        h('div', null, h('div', null, u.name), h('div', { class: 't' }, [typeOf(u).label, u.region].filter(Boolean).join(' · '))),
        h('button', { class: 'del', title: 'Edit details', onclick: e => { e.stopPropagation(); select(u.id); } }, '✎'),
        h('button', { class: 'del', title: 'Delete from the list', onclick: e => { e.stopPropagation(); removeMarker(u.id); } }, '×')))
    ]))
  ));
}

const letterOpen = new Set();   // types whose lettering preset is open in the Types panel
function typesPanel() {
  const used = id => data.markers.concat(data.unplaced).filter(m => m.type === id).length;
  const set = (t, fn, opts = { panel: false }) => change(() => fn(typeById(t.id)), opts);
  const num = (t, key, step) => h('input', { class: 'num', type: 'number', step, value: t[key],
    onchange: e => set(t, x => { x[key] = +e.target.value || 0; }) });
  return panelShell('Icon types', h('div', { class: 'form' },
    h('p', { class: 'small muted' }, `Size is the icon width in map pixels at full zoom (text height for name-only types). "Shows" and "Label" are the zoom levels where the icon and its name appear for visitors; "Hides" is where it disappears again (blank = never). "Fields" picks the Settlement Sheet fields or a short list of place details, which you can name here. Edit mode always shows every icon. You are at zoom ${+map.getZoom().toFixed(2)} of ${NATIVE}.`),
    h('table', { class: 'ttable' },
      h('tr', null, h('th', null, 'Icon'), h('th', null, 'Name'), h('th', null, 'Size'), h('th', null, 'Shows'), h('th', null, 'Label'), h('th', null, 'Hides'), h('th', null, '')),
      data.types.map(t => {
        const n = used(t.id);
        return [h('tr', { class: 'main' },
          h('td', { rowspan: 2 }, t.text ? h('span', { class: 'aa' }, 'Aa') : h('button', { class: 'ic', title: 'Change default icon',
            onclick: () => pickIcon(t.icon, path => { if (path) set(t, x => { x.icon = path; }, {}); }, false) }, iconEl(t.icon))),
          h('td', null, h('input', { type: 'text', value: t.label, onchange: e => set(t, x => { x.label = e.target.value.trim() || x.label; }) })),
          h('td', null, num(t, 'size', 1)), h('td', null, num(t, 'minZoom', 0.25)), h('td', null, num(t, 'labelZoom', 0.25)),
          h('td', null, h('input', { class: 'num', type: 'number', step: 0.25, value: t.maxZoom ?? '', placeholder: '–',
            onchange: e => set(t, x => { if (e.target.value === '') delete x.maxZoom; else x.maxZoom = +e.target.value; }) })),
          h('td', { rowspan: 2 }, h('button', { class: 'del', disabled: n ? true : null, title: n ? `${n} entries use this type` : 'Delete type',
            onclick: () => change(() => { data.types = data.types.filter(x => x.id !== t.id); }) }, '×'))),
        h('tr', { class: 'sub' }, h('td', { colspan: 5 },
          h('div', { class: 'fieldsrow' },
            h('select', { title: 'Which fields entries of this type have', onchange: e => set(t, x => {
              x.fields = e.target.value; if (x.fields === 'place' && !Array.isArray(x.details)) x.details = [];
            }, {}) },
              h('option', { value: 'settlement', selected: t.fields !== 'place' ? 'selected' : null }, 'Settlement fields'),
              h('option', { value: 'place', selected: t.fields === 'place' ? 'selected' : null }, 'Place details')),
            t.fields === 'place' ? h('input', { type: 'text', value: (t.details || []).join(', '), placeholder: 'Details, comma separated',
              title: 'The detail fields every entry of this type gets. Entries can add their own as well.',
              onchange: e => set(t, x => { x.details = e.target.value.split(',').map(s => s.trim()).filter(Boolean); }) }) : null),
          h('details', { class: 'tsdet', open: letterOpen.has(t.id) || null, ontoggle: e => { if (e.target.open) letterOpen.add(t.id); else letterOpen.delete(t.id); } },
            h('summary', { title: 'How the names of this type are lettered, unless an entry sets its own' }, 'Lettering preset'),
            textStyleFields([t], fn => set(t, fn), { text: !!t.text }))))];
      })),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => {
      const label = prompt('Name of the new type'); if (!label) return;
      change(() => { data.types.push(newType(label, 'place')); });
    } }, 'Add type'))
  ));
}

function newType(label, fields = 'settlement') {
  let id = canon(label) || 'type', n = 2;
  while (typeById(id)) id = canon(label) + '-' + n++;
  const t = { id, label: label.trim(), icon: 'icons/1/1.png', size: 45, minZoom: 5, labelZoom: 6, fields };
  if (fields === 'place') t.details = [];
  return t;
}

// ───────────────────────── icon picker ─────────────────────────

// done(path): path is an icon, NO_ICON, or null for "use the type's icon".
function pickIcon(current, done, allowDefault = true) {
  const groups = new Map();
  for (const p of icons) { const g = p.split('/').slice(0, -1).join('/'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
  const names = [...groups.keys()];
  let tab = names.find(g => current && current.startsWith(g + '/')) || names[0];
  const close = () => { $('#modal').hidden = true; $('#modal').replaceChildren(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esc, true);
  const grid = h('div', { class: 'grid' });
  const tabs = h('div', { class: 'tabs' });
  const draw = () => {
    tabs.replaceChildren(...names.map(g => h('button', { class: g === tab ? 'on' : '', onclick: () => { tab = g; draw(); } },
      'Set ' + g.split('/').pop())));
    grid.replaceChildren(...(groups.get(tab) || []).map(p => h('button', { class: p === current ? 'on' : '', title: p, onclick: () => { close(); done(p); } },
      h('img', { src: p, alt: '', loading: 'lazy' }))));
  };
  draw();
  $('#modal').replaceChildren(h('div', { class: 'dialog', onclick: e => e.stopPropagation() },
    h('div', { class: 'dh' }, h('h3', null, 'Choose an icon'), tabs, h('span', { class: 'sp' }),
      h('button', { class: 'btn' + (current === NO_ICON ? ' primary' : ''), title: 'Show only the name, centred on the spot', onclick: () => { close(); done(NO_ICON); } }, 'No icon'),
      allowDefault ? h('button', { class: 'btn', onclick: () => { close(); done(null); } }, 'Use the type’s icon') : null,
      h('button', { class: 'btn', onclick: close }, 'Cancel')),
    icons.length ? grid : h('p', { style: 'padding:16px' }, 'No icons listed. Put PNGs in the icons folder and use "Rescan icons".')));
  $('#modal').onclick = close;
  $('#modal').hidden = false;
}

// ───────────────────────── placing ─────────────────────────

let placing = null;       // { kind: 'type', type } or { kind: 'unplaced', id }
let placeQueue = [];      // unplaced ids in the order they'll come up

function startPlacing(p, queue) {
  if (!editMode) setEditMode(true);
  if (panelMode === 'political') { panelMode = null; cancelDraw(); syncPolitical(); }
  placing = p;
  placeQueue = queue || [];
  document.body.classList.add('placing');
  if (p.kind === 'unplaced' && panelMode !== 'unplaced') { panelMode = 'unplaced'; selectedId = null; }
  renderPanel(); renderEditBar(); renderBanner(); applyVisibility();
}
function stopPlacing() {
  placing = null; placeQueue = [];
  document.body.classList.remove('placing');
  renderEditBar(); renderBanner(); renderPanel();
}
function advancePlacing(fromId) {
  const left = placeQueue.filter(id => data.unplaced.some(u => u.id === id));
  if (!left.length) { stopPlacing(); toast('All done in that list.'); return; }
  const i = fromId ? Math.max(0, placeQueue.indexOf(fromId)) : 0;
  const next = placeQueue.slice(i + 1).concat(placeQueue.slice(0, i + 1)).find(id => left.includes(id) && id !== fromId) || left[0];
  placing = { kind: 'unplaced', id: next };
}

map.on('click', e => {
  if (dragRuling === 'done') { setRuler(false); return; }   // the measure left by a token drag: a click puts it away
  if (rulerOn) { rulerClick(e); return; }
  if (panelMode === 'political' && editMode) { polClick(e); return; }
  if (!editMode || !placing) { if (panelMode === 'marker') closePanel(); return; }
  placeAt(e.latlng);
});

// Put the icon being placed at a map position (from a click on the map, or on top of another icon).
function placeAt(latlng) {
  const p = toPixel(latlng);
  if (p.x < 0 || p.y < 0 || p.x >= INFO.width || p.y >= INFO.height) return;
  const x = Math.round(p.x), y = Math.round(p.y);
  if (placing.kind === 'type') {
    const t = typeById(placing.type) || data.types[0];
    const m = { id: uid(), name: 'New ' + t.label, type: t.id, x, y, info: {} };
    change(() => { data.markers.push(m); });
    select(m.id);
    const f = $('#fName'); if (f) { f.focus(); f.select(); }
  } else {
    const id = placing.id;
    const u = data.unplaced.find(v => v.id === id); if (!u) return;
    change(() => {
      data.unplaced = data.unplaced.filter(v => v.id !== id);
      u.x = x; u.y = y; data.markers.push(u);
    }, { panel: false });
    advancePlacing(id);
    toast(`Placed ${u.name}`);
    renderPanel(); renderBanner(); renderEditBar();
  }
}

// ───────────────────────── political layer: nations, borders, fill ─────────────────────────
//
// Borders are smooth lines through a few points. Each nation has one or more claim pins ("seeds"); its
// colour spreads from them across land until it meets a border, the sea, or another nation's spread.
// The fill is worked out on the land mask (data/land.js, 1 cell = 8 map pixels).

let polOn = store.get('valanar-political') === '1';     // visitor toggle
let polTool = 'edit';                                     // 'edit' | 'draw' | 'claim'
let activeNation = null;
let selBorder = null;
let drawPts = [];
let pol = null;               // last computed fill: { lab, blk, w, h, scale, areas, sig }
let polTimer = null, polCanvas = null, polOverlay = null, unclaimedIndex = 0;
const Land = { ready: false, w: 0, h: 0, scale: 8, v: null };

const polEditing = () => editMode && panelMode === 'political';
const polVisible = () => polOn || polEditing();
const drawing = () => polEditing() && polTool === 'draw';

// An image overlay whose element is a canvas we draw into.
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const el = this._image = this._url;
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    if (this.options.className) L.DomUtil.addClass(el, this.options.className);
    el.onselectstart = L.Util.falseFn; el.onmousemove = L.Util.falseFn;
  }
});

function loadLand(done) {
  const src = window.VALANAR_LAND && window.VALANAR_LAND.src;
  if (!src) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    let px;
    try { px = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { console.warn('Land mask unreadable:', e); return; }
    const v = new Uint8Array(c.width * c.height);
    for (let i = 0; i < v.length; i++) v[i] = px[i * 4];
    Object.assign(Land, { ready: true, w: c.width, h: c.height, scale: +window.VALANAR_LAND.scale || INFO.width / c.width, v });
    done && done();
  };
  img.src = src;
}

// Nearest open land cell (not sea, not on a border line) to cell (cx, cy), within r cells; -1 if none.
function nearestOpen(cx, cy, blk, r = 8) {
  const { w, h, v } = Land;
  cx = clamp(Math.floor(cx), 0, w - 1); cy = clamp(Math.floor(cy), 0, h - 1);
  let best = -1, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x, d = dx * dx + dy * dy;
    if (d < bd && v[i] >= 128 && !(blk && blk[i])) { bd = d; best = i; }
  }
  return best;
}

function polSignature() {
  return JSON.stringify([data.borders, data.nations, data.settings.politicalFill, polEditing(), Land.ready]);
}
function schedulePolitical(now) {
  clearTimeout(polTimer);
  if (!Land.ready || !polVisible()) return;
  if (pol && pol.sig === polSignature()) return;
  if (now) computePolitical(); else polTimer = setTimeout(computePolitical, 90);
}

function computePolitical() {
  if (!Land.ready) return;
  const { w, h, scale, v } = Land, N = w * h;
  const sig = polSignature();
  // 1. border lines, drawn at mask resolution, block the spread
  const bc = computePolitical.c || (computePolitical.c = document.createElement('canvas'));
  bc.width = w; bc.height = h;
  const g = bc.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#000';
  for (const b of data.borders) {
    const s = smooth(b.pts); g.beginPath();
    s.forEach(([x, y], i) => i ? g.lineTo(x / scale, y / scale) : g.moveTo(x / scale, y / scale));
    g.stroke();
  }
  const bd = g.getImageData(0, 0, w, h).data;
  const blk = new Uint8Array(N);
  for (let i = 0; i < N; i++) blk[i] = bd[i * 4 + 3] >= 90 ? 1 : 0;
  // 2. spread each nation from its pins (breadth first, so neighbours split shared ground evenly)
  const lab = new Uint16Array(N), q = new Int32Array(N);
  let qh = 0, qt = 0;
  data.nations.forEach((n, k) => n.seeds.forEach(([sx, sy]) => {
    const c = nearestOpen(sx / scale, sy / scale, blk);
    if (c >= 0 && !lab[c]) { lab[c] = k + 1; q[qt++] = c; }
  }));
  while (qh < qt) {
    const i = q[qh++], l = lab[i], x = i % w;
    let j;
    if (x > 0 && !lab[j = i - 1] && v[j] >= 128 && !blk[j]) { lab[j] = l; q[qt++] = j; }
    if (x < w - 1 && !lab[j = i + 1] && v[j] >= 128 && !blk[j]) { lab[j] = l; q[qt++] = j; }
    if (i >= w && !lab[j = i - w] && v[j] >= 128 && !blk[j]) { lab[j] = l; q[qt++] = j; }
    if (i < N - w && !lab[j = i + w] && v[j] >= 128 && !blk[j]) { lab[j] = l; q[qt++] = j; }
  }
  // 3. let the colour run under the border lines and out to the soft edge of the coast
  for (let pass = 0; pass < 3; pass++) {
    const src = lab.slice();
    for (let i = 0; i < N; i++) {
      if (src[i] || !v[i] || (v[i] >= 128 && !blk[i])) continue;
      const x = i % w;
      const l = (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (i >= w && src[i - w]) || (i < N - w && src[i + w]);
      if (l) lab[i] = l;
    }
  }
  // 4. bordered land nobody has claimed yet
  const seen = new Uint8Array(N), areas = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] || seen[s] || v[s] < 128 || blk[s]) continue;
    let head = 0, tail = 0, sx = 0, sy = 0;
    q[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const i = q[head++], x = i % w; sx += x; sy += (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= N || seen[j] || lab[j] || v[j] < 128 || blk[j]) continue;
        seen[j] = 1; q[tail++] = j;
      }
    }
    if (tail < 120) continue;      // ignore slivers and islets
    const mx = sx / tail, my = sy / tail;
    let best = q[0], bdd = Infinity;
    for (let k = 0; k < tail; k += 7) { const i = q[k], x = i % w, y = (i - x) / w, d = (x - mx) ** 2 + (y - my) ** 2; if (d < bdd) { bdd = d; best = i; } }
    areas.push({ x: (best % w + 0.5) * scale, y: (Math.floor(best / w) + 0.5) * scale, size: tail });
  }
  areas.sort((a, b) => b.size - a.size);
  pol = { lab, blk, w, h, scale, areas, loose: looseEnds(blk), sig };
  renderPolitical();
  renderPolWarn();
}

// Border ends where colour can leak round: the two sides of the line, just behind its end, are still
// connected through open land nearby (the line stops short of the coast or of another border).
function looseEnds(blk) {
  const { w, h, scale, v } = Land, out = [];
  const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && v[y * w + x] >= 128 && !blk[y * w + x];
  const R = 14;                                   // search window around the end, in cells
  data.borders.forEach(b => {
    const s = smooth(b.pts).map(([x, y]) => [x / scale, y / scale]);
    for (const seq of [s, s.slice().reverse()]) {
      const tip = seq[0];
      let back = seq[seq.length - 1], run = 0;     // the point 5 cells back along the line
      for (let k = 1; k < seq.length; k++) {
        const seg = Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1]);
        if (run + seg >= 5) { const t = (5 - run) / (seg || 1); back = [seq[k - 1][0] + t * (seq[k][0] - seq[k - 1][0]), seq[k - 1][1] + t * (seq[k][1] - seq[k - 1][1])]; break; }
        run += seg;
      }
      let dx = tip[0] - back[0], dy = tip[1] - back[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const side = sgn => {                         // an open cell beside the line, 3-5 cells out
        for (const r of [3, 4, 5]) { const x = Math.round(back[0] - dy * r * sgn), y = Math.round(back[1] + dx * r * sgn); if (open(x, y)) return [x, y]; }
        return null;
      };
      const a = side(1), c = side(-1);
      if (!a || !c) continue;                       // sea (or another line) on one side: sealed
      const cx = Math.round(tip[0]), cy = Math.round(tip[1]);
      const seen = new Set([a[0] + ',' + a[1]]), q = [a];
      let leak = false;
      while (q.length && !leak) {
        const [x, y] = q.pop();
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (Math.abs(nx - cx) > R || Math.abs(ny - cy) > R || !open(nx, ny)) continue;
          const k = nx + ',' + ny; if (seen.has(k)) continue;
          if (nx === c[0] && ny === c[1]) { leak = true; break; }
          seen.add(k); q.push([nx, ny]);
        }
      }
      if (leak) out.push({ x: Math.round(tip[0] * scale), y: Math.round(tip[1] * scale), border: b.id });
    }
  });
  return out;
}

// The notes in the panel (unclaimed areas, loose ends), updated in place so typing in the panel isn't interrupted.
let looseIndex = 0;
function renderPolWarn() {
  const el = document.getElementById('polWarn'); if (!el) return;
  const areas = pol ? pol.areas.length : 0, loose = pol ? pol.loose.length : 0;
  el.hidden = !areas && !loose;
  el.replaceChildren(
    areas ? h('div', null, h('span', null, `${areas} bordered area${areas === 1 ? ' has' : 's have'} no nation yet (hatched).`),
      h('button', { class: 'btn', onclick: nextUnclaimed }, 'Show next')) : '',
    loose ? h('div', null, h('span', null, `${loose} border end${loose === 1 ? ' stops' : 's stop'} short of the coast or another border, so colour can leak past.`),
      h('button', { class: 'btn', onclick: nextLoose }, 'Show next')) : '');
}
function nextLoose() {
  if (!pol || !pol.loose.length) return;
  const e = pol.loose[looseIndex++ % pol.loose.length];
  if (polTool !== 'edit') setPolTool('edit');
  selBorder = e.border; syncPolitical(); renderPanel();
  map.flyTo(toLatLng(e.x, e.y), Math.max(map.getZoom(), 4.5), { duration: 0.8 });
}

function renderPolitical() {
  if (!pol) return;
  const { w, h, lab, blk } = pol, v = Land.v, N = w * h;
  if (!polCanvas || polCanvas.width !== w || polCanvas.height !== h) {
    polCanvas = document.createElement('canvas'); polCanvas.width = w; polCanvas.height = h;
    if (polOverlay) map.removeLayer(polOverlay);
    polOverlay = new CanvasOverlay(polCanvas, L.latLngBounds(toLatLng(0, h * pol.scale), toLatLng(w * pol.scale, 0)),
      { pane: 'political', interactive: false, className: 'polfill' });
  }
  const g = polCanvas.getContext('2d');
  const img = g.createImageData(w, h), px = img.data;
  const cols = data.nations.map(n => hexRgb(n.color));
  const A = clamp(+data.settings.politicalFill || 0, 0, 1);
  const hatch = polEditing();
  for (let i = 0; i < N; i++) {
    const l = lab[i];
    if (l) {
      const c = cols[l - 1], o = i * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = A * v[i];
    } else if (hatch && v[i] >= 128 && !blk[i]) {
      const x = i % w, y = (i - x) / w;
      if ((x + y) % 12 < 3) { const o = i * 4; px[o] = 40; px[o + 1] = 30; px[o + 2] = 22; px[o + 3] = 120; }
    }
  }
  g.putImageData(img, 0, 0);
  if (polVisible() && !map.hasLayer(polOverlay)) polOverlay.addTo(map);
}

// ── climate: each nation's (Borders › Climate) on a coarse grid of the map, carried out over the sea to its coasts,
// for the weather: snow where it's cold, more rain where it's wet. Worked out when the nations or borders change.
const CLIMATE_CELL = 128;   // map px
let climate = null;
function climateLookup() {
  const C = window.WeatherFX && window.WeatherFX.CLIMATES;
  if (!C || !data.nations.some(n => n.climate && C[n.climate] && n.climate !== 'temperate') || !Land.ready) return null;
  const sig = JSON.stringify([data.nations.map(n => [n.id, n.climate || '']), polSignature()]);
  if (!climate || climate.sig !== sig) {
    if (climate && climate.pending) return climate.fn;
    // the territories need the political fill, even with the borders layer off
    if (!pol || pol.sig !== polSignature()) { climate = { sig: null, pending: true, fn: climate && climate.fn }; setTimeout(() => { try { computePolitical(); } catch (e) { /* no land */ } climate = null; }, 50); return climate.fn || null; }
    const gw = Math.ceil(INFO.width / CLIMATE_CELL), gh = Math.ceil(INFO.height / CLIMATE_CELL), g = new Int16Array(gw * gh).fill(-1);
    const keys = Object.keys(C), q = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const n = nationAt((x + 0.5) * CLIMATE_CELL, (y + 0.5) * CLIMATE_CELL);
      if (n) { g[y * gw + x] = Math.max(0, keys.indexOf(n.climate && C[n.climate] ? n.climate : 'temperate')); q.push(y * gw + x); }
    }
    // out over the sea (and unclaimed land) from the nearest nation, up to 40 cells
    const dist = new Int16Array(gw * gh); for (const i of q) dist[i] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % gw, y = (i / gw) | 0; if (dist[i] > 40) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx; if (g[j] >= 0) continue;
        g[j] = g[i]; dist[j] = dist[i] + 1; q.push(j);
      }
    }
    const fn = (x, y) => { const cx = Math.floor(x / CLIMATE_CELL), cy = Math.floor(y / CLIMATE_CELL); if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return null; const v = g[cy * gw + cx]; return v >= 0 ? C[keys[v]] : null; };
    climate = { sig, fn };
  }
  return climate.fn;
}
function nationAt(x, y) {
  if (!pol) return null;
  const cx = Math.floor(x / pol.scale), cy = Math.floor(y / pol.scale);
  if (cx < 0 || cy < 0 || cx >= pol.w || cy >= pol.h) return null;
  const l = pol.lab[cy * pol.w + cx];
  return l ? data.nations[l - 1] || null : null;
}

// --- drawing borders, pins and handles ---

const borderLayer = L.layerGroup().addTo(map);
const toolLayer = L.layerGroup().addTo(map);
const borderLines = new Map();     // id -> [casing, line, hit]

function borderLatLngs(b) { return smooth(b.pts).map(([x, y]) => toLatLng(x, y)); }

function syncPolitical() {
  const vis = polVisible(), editing = polEditing();
  document.body.classList.toggle('pol-edit', editing);
  document.body.dataset.poltool = editing ? polTool : '';
  $('#polToggle').classList.toggle('on', polOn);
  if (editing || rulerOn) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();

  if (vis) schedulePolitical(); else if (polOverlay && map.hasLayer(polOverlay)) map.removeLayer(polOverlay);
  if (vis && pol && polOverlay && !map.hasLayer(polOverlay)) polOverlay.addTo(map);

  // border lines (rebuilt each time: there are only a few dozen)
  borderLayer.clearLayers(); borderLines.clear();
  if (vis) for (const b of data.borders) {
    const ll = borderLatLngs(b), sel = editing && b.id === selBorder;
    const casing = L.polyline(ll, { pane: 'borders', interactive: false, color: '#f3ecdc', opacity: 0.45, weight: sel ? 8 : 5, lineCap: 'round', lineJoin: 'round' });
    const line = L.polyline(ll, { pane: 'borders', interactive: false, color: sel ? '#c9a45c' : '#2a1f17', opacity: sel ? 1 : 0.8, weight: sel ? 3 : 2, dashArray: sel ? null : '9 6', lineCap: 'butt' });
    const parts = [casing, line];
    if (editing && polTool === 'edit') {
      const hit = L.polyline(ll, { pane: 'borders', interactive: true, color: '#000', opacity: 0, weight: 16, className: 'border-hit' });
      hit.on('click', ev => { L.DomEvent.stopPropagation(ev); borderClicked(b.id, ev.latlng); });
      parts.push(hit);
    }
    parts.forEach(p => borderLayer.addLayer(p));
    borderLines.set(b.id, parts);
  }

  // claim pins and point handles (political editing only)
  toolLayer.clearLayers();
  if (!editing) return;
  data.nations.forEach(n => n.seeds.forEach((s, i) => {
    const pin = L.marker(toLatLng(s[0], s[1]), { pane: 'poltools', draggable: true, keyboard: false,
      title: `${n.name}: drag to move, right-click to remove`,
      icon: L.divIcon({ className: 'seed' + (n.id === activeNation ? ' on' : ''), html: `<i style="background:${escHTML(n.color)}"></i><b>${escHTML(n.name)}</b>`, iconSize: [0, 0] }) });
    let before;
    pin.on('click', ev => { L.DomEvent.stopPropagation(ev); setActiveNation(n.id); });
    pin.on('dragstart', () => { before = JSON.stringify(data); });
    pin.on('dragend', () => { const p = toPixel(pin.getLatLng()); const nn = findNation(n.id); if (nn && nn.seeds[i]) nn.seeds[i] = [Math.round(p.x), Math.round(p.y)]; commit(before); });
    pin.on('contextmenu', ev => { L.DomEvent.preventDefault(ev.originalEvent); change(() => { findNation(n.id).seeds.splice(i, 1); }); toast(`Removed a ${n.name} claim. Ctrl+Z brings it back.`); });
    toolLayer.addLayer(pin);
  }));
  const b = polTool === 'edit' && data.borders.find(x => x.id === selBorder);
  if (b) b.pts.forEach((q, i) => {
    const hd = L.marker(toLatLng(q[0], q[1]), { pane: 'poltools', draggable: true, keyboard: false,
      title: 'Drag to move. Right-click or Alt+click to remove.', icon: L.divIcon({ className: 'vh', iconSize: [12, 12] }) });
    let before;
    const removePoint = () => {
      if (b.pts.length <= 2) { toast('A border needs two points. Press Delete to remove the whole border.'); return; }
      change(() => { data.borders.find(x => x.id === b.id).pts.splice(i, 1); });
    };
    hd.on('dragstart', () => { before = JSON.stringify(data); });
    hd.on('drag', () => {
      const p = toPixel(hd.getLatLng()); b.pts[i] = [Math.round(p.x), Math.round(p.y)];
      const parts = borderLines.get(b.id); if (parts) { const ll = borderLatLngs(b); parts.forEach(pp => pp.setLatLngs(ll)); }
    });
    hd.on('dragend', () => { const s = snapPoint(hd.getLatLng(), { b: b.id, i }); const bb = data.borders.find(x => x.id === b.id); if (bb) bb.pts[i] = s; commit(before); });
    hd.on('contextmenu', ev => { L.DomEvent.preventDefault(ev.originalEvent); removePoint(); });
    hd.on('click', ev => { L.DomEvent.stopPropagation(ev); if (ev.originalEvent.altKey) removePoint(); });
    toolLayer.addLayer(hd);
  });
  drawDraft();
}

// Snap to an existing border point within 12 screen pixels, so lines meet cleanly.
function snapPoint(latlng, skip) {
  const cp = map.latLngToContainerPoint(latlng);
  let best = null, bd = 12;
  for (const b of data.borders) b.pts.forEach((q, i) => {
    if (skip && skip.b === b.id && skip.i === i) return;
    const d = map.latLngToContainerPoint(toLatLng(q[0], q[1])).distanceTo(cp);
    if (d < bd) { bd = d; best = q; }
  });
  if (!best && drawPts.length > 2) {
    const d = map.latLngToContainerPoint(toLatLng(drawPts[0][0], drawPts[0][1])).distanceTo(cp);
    if (d < bd) best = drawPts[0];
  }
  if (!best) {     // onto the nearest stretch of another border, for T-junctions
    for (const b of data.borders) {
      if (skip && skip.b === b.id) continue;
      const s = smooth(b.pts).map(([x, y]) => map.latLngToContainerPoint(toLatLng(x, y)));
      for (let k = 0; k < s.length - 1; k++) {
        const a = s[k], c = s[k + 1];
        const t = clamp(((cp.x - a.x) * (c.x - a.x) + (cp.y - a.y) * (c.y - a.y)) / ((c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1), 0, 1);
        const q = L.point(a.x + t * (c.x - a.x), a.y + t * (c.y - a.y)), d = q.distanceTo(cp);
        if (d < bd) { bd = d; const pp = toPixel(map.containerPointToLatLng(q)); best = [Math.round(pp.x), Math.round(pp.y)]; }
      }
    }
  }
  if (best) return [best[0], best[1]];
  const p = toPixel(latlng);
  return [Math.round(clamp(p.x, 0, INFO.width)), Math.round(clamp(p.y, 0, INFO.height))];
}

let draftLine = null;
function drawDraft(cursorLatLng) {
  if (draftLine) { toolLayer.removeLayer(draftLine); draftLine = null; }
  if (!drawing() || !drawPts.length) return;
  const ll = smooth(drawPts).map(([x, y]) => toLatLng(x, y));
  if (cursorLatLng) ll.push(cursorLatLng);
  draftLine = L.polyline(ll, { pane: 'poltools', interactive: false, color: '#c9a45c', weight: 3, dashArray: '6 5' });
  toolLayer.addLayer(draftLine);
}

function polClick(e) {
  if (polTool === 'draw') {
    const p = snapPoint(e.latlng);
    const last = drawPts[drawPts.length - 1];
    // the two clicks of a finishing double-click land on the same spot: keep one point
    if (!last || map.latLngToContainerPoint(toLatLng(last[0], last[1])).distanceTo(e.containerPoint) > 4) drawPts.push(p);
    drawDraft(e.latlng);
    renderBanner();
  } else if (polTool === 'claim') {
    claimAt(toPixel(e.latlng));
  } else if (selBorder) {
    selBorder = null; syncPolitical(); renderPanel();
  }
}
map.on('dblclick', () => { if (rulerOn) rulerFinish(); else if (drawing()) finishDraw(); });

function finishDraw() {
  const pts = drawPts; drawPts = [];
  if (pts.length >= 2) {
    const id = uid('b');
    change(() => { data.borders.push({ id, pts }); });
    toast('Border added. Use Edit lines to reshape it.');
  } else syncPolitical();
  renderBanner();
}
function cancelDraw() { if (drawPts.length) { drawPts = []; drawDraft(); renderBanner(); } }

function borderClicked(id, latlng) {
  if (selBorder !== id) { selBorder = id; syncPolitical(); renderPanel(); return; }
  // Clicking the selected border adds a point where you clicked, on the nearest stretch.
  const b = data.borders.find(x => x.id === id); if (!b) return;
  const p = toPixel(latlng);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < b.pts.length - 1; i++) {
    const [ax, ay] = b.pts[i], [bx, by] = b.pts[i + 1];
    const t = clamp(((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1), 0, 1);
    const d = Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay)));
    if (d < bd) { bd = d; bi = i; }
  }
  change(() => { data.borders.find(x => x.id === id).pts.splice(bi + 1, 0, [Math.round(p.x), Math.round(p.y)]); });
}

// Claim the bordered area under a point for the chosen nation (replacing other nations' claims there).
function claimAt(p) {
  const n = findNation(activeNation);
  if (!n) { toast('Pick a nation in the list first.'); return; }
  if (!Land.ready) { toast('The land mask (data/land.js) is missing, so claims can’t be worked out.', true); return; }
  if (!pol || pol.sig !== polSignature()) computePolitical();
  const { w, h, scale, v } = Land, blk = pol.blk, N = w * h;
  const start = nearestOpen(p.x / scale, p.y / scale, blk, 3);
  if (start < 0) { toast('That’s not open land. Click inside a country.'); return; }
  const area = new Uint8Array(N), q = new Int32Array(N);
  let head = 0, tail = 0; q[tail++] = start; area[start] = 1;
  while (head < tail) {
    const i = q[head++], x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= N || area[j] || v[j] < 128 || blk[j]) continue;
      area[j] = 1; q[tail++] = j;
    }
  }
  const inside = ([sx, sy]) => { const c = nearestOpen(sx / scale, sy / scale, blk); return c >= 0 && area[c]; };
  const taken = [];
  change(() => {
    for (const o of data.nations) {
      const keep = o.seeds.filter(s => !inside(s));
      if (o.id !== n.id && keep.length !== o.seeds.length) taken.push(o.name);
      o.seeds = keep;
    }
    findNation(n.id).seeds.push([Math.round(p.x), Math.round(p.y)]);
  });
  toast(taken.length ? `Claimed for ${n.name} (was ${taken.join(', ')}).` : `Claimed for ${n.name}.`);
}

function setActiveNation(id) { activeNation = id; syncPolitical(); if (panelMode === 'political') renderPanel(); renderBanner(); }
function setPolTool(t) { if (t !== 'draw') cancelDraw(); polTool = t; if (t !== 'edit') selBorder = null; syncPolitical(); renderPanel(); renderBanner(); }

function addNation() {
  const used = new Set(data.nations.map(n => n.color.toLowerCase()));
  const color = NATION_COLOURS.find(c => !used.has(c)) || NATION_COLOURS[data.nations.length % NATION_COLOURS.length];
  const n = { id: uid('n'), name: 'New nation', color, seeds: [] };
  change(() => { data.nations.push(n); });
  activeNation = n.id; polTool = 'claim'; selBorder = null; cancelDraw();
  syncPolitical(); renderPanel(); renderBanner();
  const f = document.querySelector(`[data-nation="${n.id}"] input[type=text]`); if (f) { f.focus(); f.select(); }
}
function deleteNation(n) {
  change(() => { data.nations = data.nations.filter(x => x.id !== n.id); });
  toast(`Deleted ${n.name}. Ctrl+Z brings it back.`);
}
function deleteSelectedBorder() {
  if (!selBorder) return;
  const id = selBorder; selBorder = null;
  change(() => { data.borders = data.borders.filter(b => b.id !== id); });
  toast('Border deleted. Ctrl+Z brings it back.');
}
function nextUnclaimed() {
  if (!pol || !pol.areas.length) return;
  const a = pol.areas[unclaimedIndex++ % pol.areas.length];
  map.flyTo(toLatLng(a.x, a.y), Math.max(map.getZoom(), 3), { duration: 0.8 });
  if (activeNation) setPolTool('claim');
}

const TOOL_HINT = {
  edit: 'Click a border to select it. Drag its points to reshape it; click the line to add a point; right-click a point to remove it. Delete removes the selected border. Drag a claim pin to move it, right-click to remove it.',
  draw: 'Click to add points, double-click (or Enter) to finish. Points snap to nearby border points so lines join up. Backspace takes the last point back; Esc cancels. Lines only need to reach the coast, or another border.',
  claim: 'Click inside an area to give it to the highlighted nation. Its colour fills out to the borders and the coast. An area can be shared by two nations’ pins; they split it down the middle.'
};

function politicalPanel() {
  const set = (n, fn, opts = { panel: false }) => change(() => fn(findNation(n.id)), opts);
  const tool = (id, label) => h('button', { class: polTool === id ? 'on' : '', onclick: () => setPolTool(id) }, label);
  setTimeout(renderPolWarn);
  return panelShell('Nations and borders', h('div', { class: 'form' },
    h('div', { class: 'segs' }, tool('edit', 'Edit lines'), tool('draw', 'Draw border'), tool('claim', 'Claim land')),
    h('p', { class: 'small muted' }, TOOL_HINT[polTool]),
    !Land.ready ? h('p', { class: 'pwarn' }, 'No land mask (data/land.js), so the colours can’t be filled in. Borders still draw.') : null,
    h('div', { class: 'pwarn', id: 'polWarn', hidden: true }),
    h('h2', null, `Nations · ${data.nations.length}`),
    h('div', { class: 'nlist' }, data.nations.map(n => h('div', { class: 'nrow' + (n.id === activeNation ? ' on' : ''), 'data-nation': n.id,
      onclick: e => { if (!e.target.closest('input,button')) setActiveNation(n.id); } },
      h('input', { type: 'color', value: n.color, title: 'Colour', onchange: e => set(n, x => { x.color = e.target.value; }) }),
      h('input', { type: 'text', value: n.name, onfocus: () => { if (activeNation !== n.id) { activeNation = n.id; syncPolitical(); } },
        onchange: e => set(n, x => { x.name = e.target.value.trim() || x.name; }) }),
      h('span', { class: 'cnt', title: 'Claim pins' }, n.seeds.length ? `${n.seeds.length} pin${n.seeds.length > 1 ? 's' : ''}` : 'no land'),
      h('button', { class: 'btn sm' + (n.id === activeNation && polTool === 'claim' ? ' primary' : ''), title: `Claim land for ${n.name}`,
        onclick: () => { activeNation = n.id; setPolTool('claim'); } }, 'Claim'),
      h('button', { class: 'del', title: `Delete ${n.name}`, onclick: () => deleteNation(n) }, '×')))),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: addNation }, 'Add nation')),
    window.WeatherFX ? h('h2', null, 'Climate') : null,
    window.WeatherFX ? h('p', { class: 'small muted' }, 'How the weather falls in each land: in a cold one rain comes down as snow, a rainy one gets more of it, a dry one less. It carries out over the nearby sea.') : null,
    window.WeatherFX ? h('div', { class: 'nlist' }, data.nations.map(n => h('div', { class: 'nrow' },
      h('span', { class: 'sw', style: `background:${n.color};width:12px;height:12px;border-radius:3px;flex:none` }),
      h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, n.name),
      h('select', { onchange: e => set(n, x => { if (e.target.value === 'temperate') delete x.climate; else x.climate = e.target.value; }) },
        ...Object.entries(window.WeatherFX.CLIMATES).map(([k, c]) => h('option', { value: k, selected: (n.climate || 'temperate') === k || null }, c.label)))))) : null,
    HERALD ? h('h2', null, 'Coats of arms') : null,
    HERALD ? h('p', { class: 'small muted' }, 'Every nation has arms, made up from its name and colour until you change them. Click a nation’s arms to change them in the Heraldry Workshop.') : null,
    HERALD ? h('div', { class: 'armsrow' }, data.nations.map(n => h('button', { class: 'armsbtn' + (n.id === activeNation ? ' on' : ''), title: `${n.name}: ${HERALD.blazon(armsOf(n))} (click to change)`,
      html: armsSvg(n, 30), onclick: () => ARMSHOP ? ARMSHOP.open(n.id) : setActiveNation(n.id) }))) : null,
    ARMSHOP ? h('div', { class: 'btnrow', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => ARMSHOP.open(activeNation) }, '⚜ The Heraldry Workshop')) : null,
    h('h2', null, `Borders · ${data.borders.length}`),
    selBorder
      ? h('div', { class: 'btnrow', style: 'margin-top:0' }, h('span', { class: 'small muted', style: 'align-self:center' },
          `Selected border: ${data.borders.find(b => b.id === selBorder).pts.length} points.`),
          h('button', { class: 'btn danger', onclick: deleteSelectedBorder }, 'Delete border'))
      : h('p', { class: 'small muted' }, 'With Edit lines, click a border to select it.'),
    h('h2', null, 'Look'),
    h('label', null, 'Colour strength'),
    h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: data.settings.politicalFill,
      onchange: e => change(() => { data.settings.politicalFill = +e.target.value; }, { panel: false }) }),
    h('p', { class: 'small muted' }, 'Visitors switch this layer on with the Borders button.')
  ));
}

$('#polToggle').addEventListener('click', () => {
  polOn = !polOn; store.set('valanar-political', polOn ? '1' : '0');
  syncPolitical(); drawReadout(); polPop(polOn);
});
// how strongly the nations' colours lie over the land: a slider beside the button (hover it while the borders are
// shown, or right-click it), remembered on this computer
const polAlpha = (() => { const v = parseFloat(store.get('valanar-political-alpha')); return isFinite(v) ? Math.max(0.05, Math.min(1, v)) : 1; })();
let polA = polAlpha, polPopT = null;
const applyPolAlpha = () => { const pn = map.getPane('political'); if (pn) pn.style.opacity = String(polA); };
applyPolAlpha();
const polPopEl = (() => {
  const pop = document.createElement('div'); pop.className = 'ambvol polvol'; pop.hidden = true;
  const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = 'Borders';
  const rng = document.createElement('input'); rng.type = 'range'; rng.min = 5; rng.max = 100; rng.step = 1; rng.value = Math.round(polA * 100); rng.setAttribute('aria-label', 'How strongly the nations are coloured');
  const out = document.createElement('span'); out.textContent = Math.round(polA * 100) + '%';
  rng.addEventListener('input', () => { polA = rng.value / 100; out.textContent = rng.value + '%'; applyPolAlpha(); });
  rng.addEventListener('change', () => store.set('valanar-political-alpha', String(polA)));
  pop.append(lab, rng, out);
  pop.addEventListener('pointerenter', () => clearTimeout(polPopT));
  pop.addEventListener('pointerleave', () => polPop(false, 400));
  document.body.append(pop);
  return pop;
})();
function polPop(on, delay) {
  clearTimeout(polPopT);
  if (!on) { polPopT = setTimeout(() => { polPopEl.hidden = true; }, delay || 0); return; }
  if (!polOn) return;
  const r = $('#polToggle').getBoundingClientRect();
  polPopEl.style.left = (r.right + 8) + 'px'; polPopEl.style.top = (r.top + r.height / 2) + 'px';
  polPopEl.hidden = false;
}
$('#polToggle').addEventListener('pointerenter', () => polPop(true));
$('#polToggle').addEventListener('pointerleave', () => polPop(false, 500));
$('#polToggle').addEventListener('contextmenu', e => { e.preventDefault(); if (polOn) polPop(true); });

// ───────────────────────── ruler ─────────────────────────
//
// Click point by point (or on places) to measure a route. Smooth paths follow a curve through the points.
// Distance uses settings.milesPerPx; "Set the scale" in Edit mode works it out from a route of known length.

let rulerOn = false, rulerPts = [], rulerDone = false, rulerSmooth = store.get('valanar-ruler-smooth') !== '0', rulerCursor = null;
const rulerLayer = L.layerGroup().addTo(map);

// The table measures token drags with the ruler: from where the token was picked up to where it is now.
// It opens the ruler if it wasn't open; after the drop the result stays until the next click on the map.
let dragRuling = null;   // null, 'live' (mid-drag) or 'done' (dropped, still showing)
function dragRuler(from, to, done) {
  if (!from) { if (dragRuling) setRuler(false); return; }
  if (!rulerOn) setRuler(true);
  dragRuling = done ? 'done' : 'live';
  rulerPts = done ? [from.map(Math.round), to.map(Math.round)] : [from.map(Math.round)];
  rulerCursor = done ? null : to; rulerDone = !!done;
  drawRuler();
}
function setRuler(on) {
  rulerOn = on;
  dragRuling = null;
  if (on && placing) stopPlacing();
  if (on && drawing()) cancelDraw();
  if (!on) { rulerPts = []; rulerDone = false; rulerCursor = null; }
  document.body.classList.toggle('ruling', on);
  $('#rulerToggle').classList.toggle('on', on);
  syncPolitical();
  drawRuler();
}
const rulerPath = (pts = rulerPts) => (rulerSmooth && pts.length > 2 ? smooth(pts, 16) : pts);
function pathLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function rulerAdd(p) {
  if (rulerDone) { rulerPts = []; rulerDone = false; }
  const last = rulerPts[rulerPts.length - 1];
  if (last && map.latLngToContainerPoint(toLatLng(...last)).distanceTo(map.latLngToContainerPoint(toLatLng(...p))) < 4) return;
  rulerPts.push([Math.round(p[0]), Math.round(p[1])]);
  drawRuler();
}
function rulerStart(p) { if (!rulerOn) setRuler(true); rulerPts = [[Math.round(p[0]), Math.round(p[1])]]; rulerDone = false; rulerCursor = null; drawRuler(); }
const redrawRuler = () => { const b = $('#ruler'); if (b) b._sig = null; if (rulerOn) drawRuler(); };
function rulerClick(e) { const p = toPixel(e.latlng); rulerAdd([p.x, p.y]); }
function rulerFinish() { if (rulerPts.length >= 2) { rulerDone = true; rulerCursor = null; drawRuler(); } }
map.on('mousemove', e => { if (rulerOn && rulerPts.length && !rulerDone) { const p = toPixel(e.latlng); rulerCursor = [p.x, p.y]; drawRuler(true); } });

function fmtMiles(mi) { return mi >= 100 ? fmt(mi) : mi >= 10 ? mi.toFixed(0) : mi.toFixed(1); }
// a distance in the map's units (Map settings › Distances): miles, kilometres or leagues
const distText = (mi, short) => (MT ? MT.distText(mi, short) : `${fmtMiles(mi)} ${short ? 'mi' : 'miles'}`);
// Time on the road, as travelling days of t.hours each plus the hours left over.
function fmtTravel(miles, t) {
  const total = miles / t.mph, perDay = clamp(+t.hours || 8, 1, 24);
  if (total < 1) { const m = Math.max(5, Math.round(total * 60 / 5) * 5); return `${m} min`; }
  let days = Math.floor(total / perDay), hrs = Math.round(total - days * perDay);
  if (hrs >= perDay) { days++; hrs = 0; }
  return [days ? `${days} day${days > 1 ? 's' : ''}` : '', hrs ? `${hrs} h` : ''].filter(Boolean).join(' ');
}

function drawRuler(cursorOnly) {
  rulerLayer.clearLayers();
  const box = $('#ruler');
  if (!rulerOn) { box.hidden = true; return; }
  const pts = rulerCursor && !rulerDone ? rulerPts.concat([rulerCursor]) : rulerPts;
  const path = rulerPath(pts), ll = path.map(p => toLatLng(...p));
  if (ll.length > 1) {
    rulerLayer.addLayer(L.polyline(ll, { pane: 'poltools', interactive: false, color: '#1d1a16', opacity: 0.55, weight: 6, lineCap: 'round', lineJoin: 'round' }));
    rulerLayer.addLayer(L.polyline(ll, { pane: 'poltools', interactive: false, color: '#f3d48a', weight: 2.5, dashArray: '8 6', lineCap: 'round' }));
  }
  rulerPts.forEach((p, i) => rulerLayer.addLayer(L.circleMarker(toLatLng(...p), { pane: 'poltools', interactive: false, radius: i === 0 || i === rulerPts.length - 1 ? 5 : 3.5, color: '#1d1a16', weight: 1.5, fillColor: '#f3d48a', fillOpacity: 1 })));
  const px = pathLength(path), miles = px * (+data.settings.milesPerPx || 0);
  if (ll.length > 1) rulerLayer.addLayer(L.marker(ll[ll.length - 1], { pane: 'poltools', interactive: false,
    icon: L.divIcon({ className: 'rtag', html: `<span>${distText(miles, true)}</span>`, iconSize: [0, 0] }) }));
  if (cursorOnly && !box.hidden) { renderRulerBox(miles, px); return; }
  box.hidden = false;
  renderRulerBox(miles, px);
}

function renderRulerBox(miles, px) {
  const box = $('#ruler'), s = data.settings;
  if (box._sig === [miles, editMode, rulerSmooth, rulerPts.length, rulerDone].join('|') && document.activeElement && box.contains(document.activeElement)) return;
  box._sig = [miles, editMode, rulerSmooth, rulerPts.length, rulerDone].join('|');
  const has = rulerPts.length > 1 || (rulerPts.length && rulerCursor);
  box.replaceChildren(...[
    h('div', { class: 'rh' }, h('b', null, 'Ruler'),
      h('label', { title: 'Follow a smooth curve through the points, like a road or river would' },
        h('input', { type: 'checkbox', checked: rulerSmooth, onchange: e => { rulerSmooth = e.target.checked; store.set('valanar-ruler-smooth', rulerSmooth ? '1' : '0'); drawRuler(); } }), 'Smooth path'),
      h('button', { class: 'x', title: 'Close the ruler (Esc)', onclick: () => setRuler(false) }, '×')),
    has ? h('div', { class: 'rdist' }, distText(miles)) : h('p', { class: 'rhint' }, 'Click the map or a place to start. Keep clicking to add stops; double-click or Enter to finish. Backspace takes the last stop back.'),
    has ? h('table', { class: 'rtimes' }, s.travel.map((t, i) => h('tr', { title: [t.note, `${t.mph} mph, ${t.hours} h a day = ${fmtMiles(t.mph * t.hours)} miles a day`].filter(Boolean).join('\n') },
      h('th', null, t.label),
      h('td', null, +t.mph > 0 ? fmtTravel(miles, t) : '–'),
      editMode ? h('td', { class: 'pace' },
        h('input', { type: 'number', min: 0.5, step: 0.5, value: t.mph, title: 'Miles per hour',
          onchange: e => change(() => { data.settings.travel[i].mph = Math.max(0.1, +e.target.value || 1); }, { panel: false }) }), ' mph ',
        h('input', { type: 'number', min: 1, max: 24, step: 1, value: t.hours, title: 'Hours on the move per day',
          onchange: e => change(() => { data.settings.travel[i].hours = clamp(+e.target.value || 8, 1, 24); }, { panel: false }) }), ' h') : null))) : null,
    has && s.travel.some(t => /horse/i.test(t.label)) ? h('p', { class: 'rnote' }, 'Riding: an hour’s break after every 4 hours. Skipping one costs the horse a level of exhaustion (Con save DC 15 negates).') : null,
    has && ARMY ? ARMY.rulerBlock(miles) : null,
    editMode ? h('div', { class: 'rscale' },
      h('span', null, `Scale: 1 map pixel = ${(+s.milesPerPx || 0).toPrecision(3)} mi`),
      h('button', { disabled: rulerPts.length < 2 ? true : null, title: 'Measure a route you know the length of, then type its length in miles',
        onclick: () => {
          const len = pathLength(rulerPath(rulerPts)); if (!len) return;
          const v = parseFloat(prompt(`How many miles is this route? (currently ${fmtMiles(miles)})`, fmtMiles(miles)) || '');
          if (v > 0) { change(() => { data.settings.milesPerPx = v / len; }, { panel: false }); drawRuler(); toast(`Scale set: the map is about ${fmt(INFO.width * data.settings.milesPerPx)} miles across.`); }
        } }, 'Set the scale from this route')) : null
  ].filter(Boolean));
}

$('#rulerToggle').addEventListener('click', () => setRuler(!rulerOn));

// ───────────────────────── animated sea ─────────────────────────
//
// Drawn underneath the tiles, so it only shows where the exported map is transparent. Turned on by
// make_tiles.bat (mapinfo.js "transparent") when the map was exported without its sea, or with ?ocean.

const OCEAN_ON = !PARAMS.has('noocean') && (!!INFO.transparent || PARAMS.has('ocean'));

const OCEAN_FRAG = `
precision highp float;
uniform vec2 u_origin; uniform float u_wpp; uniform float u_dpr; uniform vec2 u_res; uniform float u_time;
uniform sampler2D u_dist; uniform vec2 u_cells; uniform float u_cell; uniform float u_hasDist;
uniform sampler2D u_fresh; uniform float u_hasFresh;
// the look (Map settings): sea colours, swell, speed, which effects; rivers' colour and flow
uniform vec3 u_shallow; uniform vec3 u_mid; uniform vec3 u_deep; uniform float u_wave; uniform float u_speed; uniform vec3 u_fx;
uniform vec3 u_river; uniform float u_flow;
float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Fractal noise; octaves smaller than a few screen pixels fade to their average instead of shimmering.
// the same with three octaves, for the broad shapes
float fbm3(vec2 p, float pxPerUnit) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) {
    float vis = smoothstep(1.5, 5.0, pxPerUnit);
    s += a * mix(0.5, vnoise(p), vis);
    p = p * 2.03 + vec2(13.7, 7.1); pxPerUnit *= 0.493; a *= 0.5;
  }
  return s / 0.875;
}
float fbm(vec2 p, float pxPerUnit) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 6; k++) {
    float vis = smoothstep(1.5, 5.0, pxPerUnit);
    s += a * mix(0.5, vnoise(p), vis);
    p = p * 2.03 + vec2(13.7, 7.1); pxPerUnit *= 0.493; a *= 0.5;
  }
  return s;
}
void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 w = u_origin + css * u_wpp;              // map pixel under this fragment
  float px = 1.0 / u_wpp;                       // screen px per map px
  float T = u_time * u_speed, Tf = u_time * u_flow;
  float d = 3000.0;                             // distance to the coast in map px (open sea off the mask)
  if (u_hasDist > 0.5) {
    // beyond the map's edge, carry on from the nearest point on the edge so the sea doesn't change colour there
    vec2 size = u_cell * u_cells, wc = clamp(w, vec2(0.0), size);
    vec4 t = texture2D(u_dist, wc / size);
    float fine = t.r * 255.0 / 4.0 * u_cell, coarse = t.a * 255.0 * 2.0 * u_cell;
    d = mix(fine, coarse, smoothstep(380.0, 500.0, fine)) + length(w - wc);
  }
  // ── depth: the shallows hug the coast, a shelf whose edge wanders, then the deep
  float shelfN = fbm3(w / 2600.0 + vec2(3.1, 7.4), 2600.0 * px);
  float sh = smoothstep(0.0, 1.0, smoothstep(0.0, 200.0, d) * 0.55 + smoothstep(110.0, 950.0, d) * 0.45 + (shelfN - 0.5) * 0.3);
  vec3 col = mix(u_shallow, u_mid, sh);
  float deepK = smoothstep(500.0, 4200.0, d + (shelfN - 0.5) * 900.0);
  col = mix(col, u_deep, deepK);
  // ── long, soft streaks of swell drifting with the wind (domain-warped, stretched along the wind)
  vec2 q = w / 560.0;
  vec2 wq = vec2(fbm3(q + vec2(0.0, T * 0.018), 560.0 * px), fbm3(q + vec2(5.2, 1.3) - vec2(T * 0.014, 0.0), 560.0 * px));
  float streak = fbm(vec2(w.x / 300.0, w.y / 105.0) + wq * 2.4 + vec2(T * 0.028, -T * 0.01), 105.0 * px);
  col *= 0.90 + 0.21 * streak;
  // painterly mottling at a larger scale, so the open sea isn't flat
  float mott = fbm3(w / 1400.0 + vec2(-T * 0.004, T * 0.003), 1400.0 * px);
  col *= 0.94 + 0.12 * mott;
  col = mix(col, col * vec3(0.92, 1.0, 1.04), smoothstep(0.35, 0.75, mott) * deepK);   // a cooler blue far out
  // ── small waves catching the light, once they're big enough on screen to see
  float wv = smoothstep(4.0, 12.0, 48.0 * px) * u_wave;
  if (wv > 0.001) {
    vec2 wp = vec2(w.x / 120.0 + T * 0.07, w.y / 48.0) + wq * 1.2;
    float e = 0.35;
    float h0 = vnoise(wp) * 0.65 + vnoise(wp * 2.1 + vec2(T * 0.07, 3.3)) * 0.35;
    float hx = vnoise(wp + vec2(e, 0.0)) * 0.65 + vnoise((wp + vec2(e, 0.0)) * 2.1 + vec2(T * 0.07, 3.3)) * 0.35;
    float hy = vnoise(wp + vec2(0.0, e)) * 0.65 + vnoise((wp + vec2(0.0, e)) * 2.1 + vec2(T * 0.07, 3.3)) * 0.35;
    vec3 n = normalize(vec3((h0 - hx) * 2.6, (h0 - hy) * 2.6, 1.0));
    float lit = dot(n, normalize(vec3(-0.45, -0.6, 0.66)));
    col *= mix(1.0, 0.93 + 0.12 * lit, wv);
    float sp = pow(max(0.0, dot(reflect(normalize(vec3(0.45, 0.6, -0.66)), n), vec3(0.0, 0.0, 1.0))), 48.0);
    col += vec3(0.20, 0.22, 0.19) * sp * wv * smoothstep(60.0, 260.0, d) * 0.35;
  }
  // ── the coast's echo: a few broken lines following the shore, as on a drawn map (Ripples)
  float dd = d + (vnoise(w / 70.0) - 0.5) * 12.0;
  float lw = max(1.4 * u_wpp, 1.6), aa = 1.2 * u_wpp;
  float echo = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float c = 15.0 + 24.0 * fk + 2.5 * sin(T * 0.35 + fk * 1.7);
    float ln = 1.0 - smoothstep(lw, lw + aa, abs(dd - c));
    float broken = smoothstep(0.32, 0.5, vnoise(w / (38.0 + fk * 14.0) + vec2(fk * 7.0, T * 0.02)));
    echo += ln * broken * (0.34 - fk * 0.1);
  }
  float echoVis = smoothstep(2.5, 6.5, 24.0 * px) * u_hasDist * u_fx.x;
  col = mix(col, vec3(0.80, 0.88, 0.84), clamp(echo, 0.0, 1.0) * echoVis);
  // from further out, a soft pale band along the shore instead
  col = mix(col, mix(u_shallow, vec3(0.82, 0.88, 0.82), 0.35), smoothstep(150.0, 0.0, d) * 0.28 * u_hasDist * (1.0 - echoVis * 0.6));
  // ── surf at the waterline: soft, broken, breathing in and out
  float fn = fbm(w / 20.0 + vec2(T * 0.28, -T * 0.16), 20.0 * px);
  float foam = smoothstep(17.0, 2.0, d + (fn - 0.5) * 18.0 - 3.5 * sin(T * 0.9 + d * 0.12));
  col = mix(col, vec3(0.90, 0.93, 0.88), foam * 0.55 * u_hasDist * u_fx.y);
  // under solid land (the tiles cover it) a muted earth colour, so a hairline gap between tiles doesn't flash white
  col = mix(col, vec3(0.40, 0.38, 0.31), (1.0 - smoothstep(0.0, 2.0, d)) * u_hasDist);
  // ── the odd glint on open water: rare, small and soft
  vec2 gp = w / 34.0, gc = floor(gp);
  float gh = hash(gc);
  float cyc = T * 0.18 + gh * 11.0;
  float on = step(0.9975, hash(gc + floor(cyc)));
  float life = sin(fract(cyc) * 3.14159);
  vec2 off = fract(gp) - 0.5 - (vec2(hash(gc + 3.1), hash(gc + 7.7)) - 0.5) * 0.5;
  float dot2 = smoothstep(0.16, 0.0, length(off * vec2(1.0, 1.8)));
  float glint = on * life * dot2 * smoothstep(3.0, 6.0, 34.0 * px) * smoothstep(150.0, 450.0, d);
  col += vec3(0.45, 0.5, 0.45) * glint * u_fx.z;
  // rivers and lakes: clearer, greener water; rivers run towards the sea, lakes lie still under the wind
  if (u_hasFresh > 0.5) {
    vec2 ftc = w / (u_cell * u_cells);
    if (ftc.x >= 0.0 && ftc.y >= 0.0 && ftc.x <= 1.0 && ftc.y <= 1.0) {
      vec4 fr = texture2D(u_fresh, ftc);
      if (fr.r > 0.004) {
        vec2 dir = fr.gb * 2.0 - 1.0;
        float lake = fr.a;
        float dl = length(dir); dir = dl > 0.05 ? dir / dl : vec2(0.0);
        float speed = mix(34.0, 2.5, lake) * smoothstep(0.05, 0.4, dl);
        // a flow map: two copies of the ripples slide downstream half a cycle apart and fade in and out
        float cyc = 3.0;
        float p0 = fract(Tf / cyc), p1 = fract(Tf / cyc + 0.5);
        float wt = abs(p0 - 0.5) * 2.0;
        vec2 o0 = dir * speed * cyc * p0, o1 = dir * speed * cyc * p1;
        float vis1 = smoothstep(2.0, 6.0, 14.0 * px), vis2 = smoothstep(2.0, 6.0, 5.0 * px), vis3 = smoothstep(1.5, 5.0, 48.0 * px);
        // each sample smeared along the current (two taps a little apart downstream), so the ripples read as streaks
        vec2 sm = dir * 0.55;
        vec2 a0 = (w - o0) / 14.0, a1 = (w - o1) / 14.0 + 17.3;
        float n0 = mix(0.5, (vnoise(a0) + vnoise(a0 + sm) + vnoise(a0 - sm)) / 3.0, vis1) * 0.6 + mix(0.5, vnoise((w - o0) / 5.0 + 3.7), vis2) * 0.4;
        float n1 = mix(0.5, (vnoise(a1) + vnoise(a1 + sm) + vnoise(a1 - sm)) / 3.0, vis1) * 0.6 + mix(0.5, vnoise((w - o1) / 5.0 + 9.1), vis2) * 0.4;
        float n = mix(n0, n1, wt);
        // broad bands of lighter and darker water drifting down, big enough to see the river move from further out
        vec2 b0 = (w - o0 * 1.6) / 48.0, b1 = (w - o1 * 1.6) / 48.0 + 5.1;
        float nb = mix(0.5, mix((vnoise(b0) + vnoise(b0 + sm)) * 0.5, (vnoise(b1) + vnoise(b1 + sm)) * 0.5, wt), vis3);
        vec3 river = mix(u_river * 0.78, u_river * 1.16 + 0.03, n * 0.7 + nb * 0.3);
        river *= 0.9 + 0.2 * nb * (1.0 - lake);
        river += vec3(0.13, 0.14, 0.12) * smoothstep(0.64, 0.8, n) * vis1 * (1.0 - lake);
        float ln = fbm(w / 150.0 + vec2(Tf * 0.012, Tf * 0.008), 150.0 * px);
        vec3 still = mix(u_river * vec3(0.72, 0.78, 0.86), u_river * 1.04, ln);
        float rip = sin(dot(w, vec2(0.6, 0.8)) / 22.0 * 6.2831 - Tf * 1.2 + vnoise(w / 90.0) * 6.0) * 0.5 + 0.5;
        still += vec3(0.05, 0.06, 0.06) * pow(rip, 6.0) * smoothstep(2.0, 6.0, 22.0 * px);
        // sun on a lake: small glints winking on and off
        vec2 lp = w / 18.0, lc = floor(lp);
        float lcyc = Tf * 0.35 + hash(lc) * 9.0;
        float lon = step(0.985, hash(lc + floor(lcyc)));
        float ldot = smoothstep(0.2, 0.0, length((fract(lp) - 0.5) * vec2(1.0, 1.7)));
        still += vec3(0.5, 0.52, 0.45) * lon * sin(fract(lcyc) * 3.14159) * ldot * smoothstep(2.0, 5.0, 18.0 * px) * u_fx.z;
        vec3 fcol = mix(river, still, lake);
        col = mix(col, fcol, fr.r);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const OceanLayer = L.Layer.extend({
  options: { padding: 0.2, fps: 30 },
  onAdd(m) {
    const c = this._canvas = L.DomUtil.create('canvas', 'ocean leaflet-zoom-animated');
    m.getPane('ocean').appendChild(c);
    const gl = this._gl = c.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });   // (kept: a postcard copies it)
    if (!gl || !this._init(gl)) { L.DomUtil.remove(c); this._failed = true; document.body.classList.add('ocean-fallback'); return; }
    m.on('moveend resize viewreset', this._reset, this);
    m.on('zoomanim', this._anim, this);
    m.on('zoom', this._onZoom, this);
    this._reset();
    const loop = t => { this._raf = requestAnimationFrame(loop); if (view === 'map') this._frame(t); };
    this._raf = requestAnimationFrame(loop);
  },
  onRemove(m) {
    cancelAnimationFrame(this._raf);
    m.off('moveend resize viewreset', this._reset, this); m.off('zoomanim', this._anim, this); m.off('zoom', this._onZoom, this);
    L.DomUtil.remove(this._canvas);
  },
  _init(gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }');
    const fs = sh(gl.FRAGMENT_SHADER, OCEAN_FRAG);
    if (!vs || !fs) return false;
    const pr = this._prog = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return false; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this._u = {}; for (const n of ['u_origin', 'u_wpp', 'u_dpr', 'u_res', 'u_time', 'u_dist', 'u_cells', 'u_cell', 'u_hasDist', 'u_fresh', 'u_hasFresh', 'u_shallow', 'u_mid', 'u_deep', 'u_wave', 'u_speed', 'u_fx', 'u_river', 'u_flow']) this._u[n] = gl.getUniformLocation(pr, n);
    this.setLook({});
    gl.uniform1f(this._u.u_hasDist, 0); gl.uniform1i(this._u.u_dist, 0); gl.uniform1f(this._u.u_hasFresh, 0); gl.uniform1i(this._u.u_fresh, 1);
    return true;
  },
  // Map settings › Sea and Rivers: colours ('#rrggbb'), swell (0-2), speed (0 = still), ripples/foam/glints, river colour and flow
  setLook(o) {
    if (this._failed || !this._gl) return;
    const gl = this._gl, u = this._u, s = o.sea || {}, f = o.fresh || {};
    const c = (hex, d) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || /^#?([0-9a-f]{6})$/i.exec(d); const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
    gl.uniform3fv(u.u_shallow, c(s.shallow, '#67a198')); gl.uniform3fv(u.u_mid, c(s.mid, '#3d7272')); gl.uniform3fv(u.u_deep, c(s.deep, '#234b57'));
    gl.uniform1f(u.u_wave, num(s.waves, 1)); gl.uniform1f(u.u_speed, num(s.speed, 1));
    gl.uniform3f(u.u_fx, s.ripples === false ? 0 : 1, s.foam === false ? 0 : 1, s.glints === false ? 0 : 1);
    gl.uniform3fv(u.u_river, c(f.color, '#54919a')); gl.uniform1f(u.u_flow, num(f.flow, 1));
    if (this._origin) this._draw(performance.now() / 1000);
  },
  // Distance from each sea cell to the nearest land, packed into two channels: fine (to 512 map px) and coarse.
  setLand(land, tex) {
    if (this._failed || !this._gl) return;
    const { w, h, scale } = land;
    tex = tex || landDistTex(land);
    const gl = this._gl;
    if (w > gl.getParameter(gl.MAX_TEXTURE_SIZE) || h > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, w, h, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, tex);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    gl.uniform2f(this._u.u_cells, w, h); gl.uniform1f(this._u.u_cell, scale); gl.uniform1f(this._u.u_hasDist, 1);
    this._draw(performance.now() / 1000);
  },
  // Rivers and lakes (see findFreshwater): RGBA per land-mask cell, r = how fresh, gb = flow direction, a = still water
  setFresh(land, rgba) {
    if (this._failed || !this._gl || !rgba) return;
    const gl = this._gl;
    if (land.w > gl.getParameter(gl.MAX_TEXTURE_SIZE) || land.h > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, land.w, land.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this._u.u_hasFresh, 1);
    this._draw(performance.now() / 1000);
  },
  _reset() {
    const m = this._map, p = this.options.padding, size = m.getSize();
    const min = m.containerPointToLayerPoint(size.multiplyBy(-p)).round();
    const full = size.multiplyBy(1 + 2 * p).round();
    this._center = m.getCenter(); this._zoom = m.getZoom();
    L.DomUtil.setPosition(this._canvas, min);
    const dpr = this._dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const c = this._canvas;
    c.width = Math.max(1, Math.round(full.x * dpr)); c.height = Math.max(1, Math.round(full.y * dpr));
    c.style.width = full.x + 'px'; c.style.height = full.y + 'px';
    const tl = toPixel(m.layerPointToLatLng(min));
    this._origin = [tl.x, tl.y]; this._wpp = Math.pow(2, NATIVE - this._zoom);
    this._draw(performance.now() / 1000);
  },
  _anim(e) {           // keep the frozen canvas lined up while Leaflet animates a zoom (same maths as L.Renderer)
    const m = this._map, p = this.options.padding;
    const scale = m.getZoomScale(e.zoom, this._zoom);
    const viewHalf = m.getSize().multiplyBy(0.5 + p);
    const centre = m.project(this._center, e.zoom);
    const offset = viewHalf.multiplyBy(-scale).add(centre).subtract(m._getNewPixelOrigin(e.center, e.zoom));
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },
  _onZoom() { this._anim({ center: this._map.getCenter(), zoom: this._map.getZoom() }); },
  _frame(t) {
    if (document.hidden || t - (this._last || 0) < 1000 / this.options.fps) return;
    this._last = t; this._draw(t / 1000);
  },
  _draw(time) {
    const gl = this._gl, c = this._canvas, u = this._u;
    if (!gl || !this._origin) return;
    gl.viewport(0, 0, c.width, c.height);
    gl.uniform2f(u.u_origin, this._origin[0], this._origin[1]);
    gl.uniform1f(u.u_wpp, this._wpp); gl.uniform1f(u.u_dpr, this._dpr);
    gl.uniform2f(u.u_res, c.width, c.height); gl.uniform1f(u.u_time, time % 10000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
});

// The sea's distance-to-coast texture: per land-mask cell, the distance to land (fine in r, coarse in a).
function landDistTex(land) {
  const { w, h, v } = land, N = w * h;
  const g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = v[i] >= 128 ? 0 : 1e12;
  edt2d(g, w, h);
  const tex = new Uint8Array(N * 2);
  for (let i = 0; i < N; i++) { const d = Math.sqrt(g[i]); tex[i * 2] = Math.min(255, Math.round(d * 4)); tex[i * 2 + 1] = Math.min(255, Math.round(d / 2)); }
  return tex;
}
// Working out the rivers and the sea's distances takes a second or so: done in a background worker so the map stays
// smooth while it loads (on the page itself if workers aren't available). Resolves { fresh, rgba, tex } and updates land.v.
function analyseLand(land, opts) {
  const job = (L, o) => {
    const fr = o.fresh ? findFreshwater(L, o.width) : null;
    return { v: L.v, fresh: L.fresh || null, rgba: fr ? fr.rgba : null, tex: o.tex ? landDistTex(L) : null };
  };
  const onPage = () => new Promise(res => setTimeout(() => res(job(land, opts)), 0));
  if (!window.Worker || location.protocol === 'file:') return onPage();
  return new Promise(resolve => {
    let wk;
    try {
      const src = [edt2d, findFreshwater, landDistTex].map(f => f.toString()).join('\n') +
        `\nconst job = ${job.toString()};\nonmessage = e => { const r = job(e.data.land, e.data.opts); postMessage(r, [r.v.buffer].concat(r.fresh ? [r.fresh.buffer] : [], r.rgba ? [r.rgba.buffer] : [], r.tex ? [r.tex.buffer] : [])); };`;
      wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    } catch (e) { return onPage().then(resolve); }
    wk.onmessage = e => { wk.terminate(); const r = e.data; land.v = r.v; if (r.fresh) land.fresh = r.fresh; resolve(r); };
    wk.onerror = e => { e.preventDefault(); wk.terminate(); onPage().then(resolve); };
    const copy = { w: land.w, h: land.h, scale: land.scale, v: new Uint8Array(land.v) };
    wk.postMessage({ land: copy, opts }, [copy.v.buffer]);
  });
}
// Squared Euclidean distance transform in place (Felzenszwalb & Huttenlocher), rows then columns.
function edt2d(g, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = len => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; pass(w); for (let x = 0; x < w; x++) g[o + x] = d[x]; }
}

let ocean = null;
if (OCEAN_ON) { document.body.classList.add('has-ocean'); ocean = new OceanLayer().addTo(map); }

// ───────────────────────── edit mode, toolbar, banner ─────────────────────────

let editMode = false;

function setEditMode(on) {
  if (on && eraId) { toast('Go back to now to edit the map.', true); return; }
  editMode = on;
  document.body.classList.toggle('editing', on);
  $('#editbar').hidden = !on;
  $('#editToggle').classList.toggle('on', on);
  if (EMBED) try { parent.postMessage({ t: 'mapEdit', on }, location.origin); } catch (e) { /* not in the table */ }
  if (!on) { stopPlacing(); if (['political', 'types', 'unplaced', 'routes', 'names'].includes(panelMode)) { if (MT && ['routes', 'names'].includes(panelMode)) MT.panelClosed(); panelMode = null; } cancelDraw(); }
  syncMarkers(); syncPolitical(); if (MT) MT.sync(); if (ARMY) ARMY.sync(); renderPanel(); renderEditBar(); renderBanner();
  if (rulerOn) drawRuler();
}

function renderEditBar() {
  { const b = $('#lookToggle'); if (b) b.classList.toggle('on', panelMode === 'settings'); }
  if (!editMode) return;
  $('#palette').replaceChildren(...data.types.map(t => h('button', {
    class: placing && placing.kind === 'type' && placing.type === t.id ? 'on' : '',
    title: `Place a ${t.label}`,
    onclick: () => (placing && placing.kind === 'type' && placing.type === t.id) ? stopPlacing() : startPlacing({ kind: 'type', type: t.id })
  }, t.text ? h('span', { class: 'aa' }, 'Aa') : iconEl(t.icon, 'pal'))));
  $('#unplacedCount').textContent = data.unplaced.length;
  $('#btnUnplaced').classList.toggle('on', panelMode === 'unplaced');
  $('#btnTypes').classList.toggle('on', panelMode === 'types');
  $('#btnBorders').classList.toggle('on', panelMode === 'political');
  for (const [id, m] of [['btnRoutes', 'routes'], ['btnNames', 'names'], ['btnArmies', 'armies'], ['btnSettings', 'settings']]) { const b = $('#' + id); if (b) b.classList.toggle('on', panelMode === m); }
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
  renderStatus();
}

let bannerMsg = null;      // { text, actions: [[label, fn]] } for one-off messages like the draft restore
function renderBanner() {
  const b = $('#banner');
  let content = null;
  if (bannerMsg) content = [h('span', null, bannerMsg.text), ...bannerMsg.actions.map(([l, f]) => h('button', { onclick: f }, l))];
  else if (placing && placing.kind === 'type') {
    const t = typeById(placing.type);
    content = [h('span', null, 'Placing ', h('b', null, t ? t.label : ''), ' icons. Click the map.'), h('span', { class: 'k' }, 'Esc to stop'), h('button', { onclick: stopPlacing }, 'Stop')];
  } else if (placing && placing.kind === 'unplaced') {
    const u = data.unplaced.find(v => v.id === placing.id);
    const left = placeQueue.filter(id => data.unplaced.some(v => v.id === id)).length;
    if (u) content = [h('span', null, 'Click the map to place ', h('b', null, u.name), ` (${[typeOf(u).label, u.nation].filter(Boolean).join(', ')})`),
      h('span', { class: 'k' }, `${left} left · S to skip · Esc to stop`),
      h('button', { onclick: () => { advancePlacing(placing.id); renderBanner(); renderPanel(); } }, 'Skip'),
      h('button', { onclick: stopPlacing }, 'Stop')];
  } else if (drawing()) {
    content = [h('span', null, drawPts.length ? `Drawing a border: ${drawPts.length} point${drawPts.length > 1 ? 's' : ''}. ` : 'Click the map to start a border. ',
      h('span', { class: 'k' }, 'Double-click or Enter to finish · Esc to cancel')),
      drawPts.length >= 2 ? h('button', { onclick: finishDraw }, 'Finish') : null];
  } else if (polEditing() && polTool === 'claim') {
    const n = findNation(activeNation);
    content = n ? [h('span', null, 'Click land to claim it for ', h('b', null, n.name), '.'), h('span', { class: 'k' }, 'Esc to stop'), h('button', { onclick: () => setPolTool('edit') }, 'Stop')]
      : [h('span', null, 'Pick a nation in the list, then click land to claim it.')];
  }
  b.hidden = !content;
  b.replaceChildren(...(content || []));
}

// ───────────────────────── saving ─────────────────────────

let dirHandle = null;       // the connected map-viewer folder
let pendingHandle = null;   // remembered folder that needs a click to re-allow
let saveTimer = null, saveState = 'idle', lastSaved = null, unsaved = false, backedUp = false;
const canPickFolder = typeof window.showDirectoryPicker === 'function';

function serialise(d) {
  const line = o => '  ' + JSON.stringify(o);
  const arr = a => a.length ? '[\n' + a.map(line).join(',\n') + '\n]' : '[]';
  return '// Valanar map data, written by the map editor (open index.html, click Edit).\n'
    + '// One entry per line so changes are easy to compare. Positions are pixels on the full-size map image.\n'
    + 'window.VALANAR_DATA = {\n'
    + '"version": 1,\n'
    + '"savedAt": ' + JSON.stringify(d.savedAt) + ',\n'
    + '"types": ' + arr(d.types) + ',\n'
    + '"markers": ' + arr(d.markers) + ',\n'
    + '"unplaced": ' + arr(d.unplaced) + ',\n'
    + '"nations": ' + arr(d.nations) + ',\n'
    + '"borders": ' + arr(d.borders) + ',\n'
    + '"settings": ' + JSON.stringify(d.settings) + ',\n'
    + '"routes": ' + arr(d.routes || []) + ',\n'
    + '"labels": ' + arr(d.labels || []) + ',\n'
    + '"imports": ' + JSON.stringify(d.imports) + '\n'
    + '};\n';
}

async function dirFor(root, parts, create) {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function readText(root, path) {
  const parts = path.split('/');
  try { const d = await dirFor(root, parts.slice(0, -1), false); return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text(); }
  catch (e) { return null; }
}
async function writeText(root, path, text) {
  const parts = path.split('/');
  const d = await dirFor(root, parts.slice(0, -1), true);
  const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
  await w.write(text); await w.close();
}

async function backup() {
  const old = await readText(dirHandle, 'data/markers.js');
  backedUp = true;
  if (!old || !/"markers": \[\n/.test(old)) return;     // nothing worth keeping yet
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  await writeText(dirHandle, `data/backups/markers-${stamp}.js`, old);
  const dir = await dirFor(dirHandle, ['data', 'backups'], true);
  const names = [];
  for await (const [name, e] of dir.entries()) if (e.kind === 'file' && /^markers-.*\.js$/.test(name)) names.push(name);
  names.sort();
  for (const n of names.slice(0, Math.max(0, names.length - BACKUPS_KEPT))) await dir.removeEntry(n);
}

function scheduleSave() {
  if (eraId) return;
  unsaved = true;
  clearTimeout(saveTimer);
  if (dirHandle || SERVER) saveTimer = setTimeout(saveNow, SERVER ? 900 : 600);
  renderStatus();
}

// on the server: the whole map goes up, with the version it was made from. If someone else saved since, the server puts
// the two together (what only one of you changed is kept from that one); only things you both changed differently come
// back as a question
async function saveToServer(force, resolve) {
  saveState = 'saving'; renderStatus();
  const sent = JSON.stringify(data);
  try {
    const r = await fetch('/api/site/world', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, base: fileSavedAt, force: !!force, resolve: resolve || undefined, atlas: ATLAS ? ATLAS.id : undefined }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      if (j.conflicts && j.conflicts.length) { saveState = 'error'; renderStatus(); return askConflicts(j.conflicts); }
      if (confirm('The map was saved from another browser since this page loaded, from a version too old to merge with. Overwrite it with what is on screen? (The other version is kept in the map’s history.)')) return saveToServer(true);
      saveState = 'error'; renderStatus(); return;
    }
    if (!r.ok) throw new Error(j.error || r.statusText);
    if (j.merged && j.data) takeIn(j.data, j.savedAt, sent, 'Someone else’s changes were saved alongside yours');
    data.savedAt = fileSavedAt = j.savedAt;
    unsaved = false; saveState = 'saved'; lastSaved = new Date();
    clearDraft();
  } catch (e) {
    saveState = 'error';
    toast('Saving failed: ' + (e.message || e), true);
  }
  renderStatus();
}

// someone else's version of the map coming in: on top of mine if I've changed things since `sent` (what I last sent, or
// what I had when theirs was saved)
function takeIn(theirs, savedAt, sent, msg) {
  const now = JSON.stringify(data);
  let next = normalise(theirs);
  if (sent && now !== sent && window.Merge) {
    const mine = JSON.parse(now), base = JSON.parse(sent);
    let r = Merge.map(base, next, mine, {});
    if (r.conflicts.length) { const res = {}; for (const c of r.conflicts) res[c.key] = 'mine'; r = Merge.map(base, next, mine, res); }   // (what I'm doing now wins)
    next = normalise(r.data);
  }
  data = next; data.savedAt = fileSavedAt = savedAt;
  undoStack.length = 0; redoStack.length = 0;   // (an undo from before would take their changes back out)
  if (selectedId && !findAny(selectedId)) { selectedId = null; if (panelMode === 'marker') panelMode = null; }
  if (selBorder && !data.borders.some(b => b.id === selBorder)) selBorder = null;
  if (activeNation && !findNation(activeNation)) activeNation = null;
  syncMarkers(); syncPolitical(); if (MT) MT.sync(); if (ARMY) ARMY.sync(); if (AMB) AMB.refresh(); renderPanel(); renderEditBar();
  if (msg) toast(msg);
  if (sent && now !== sent) scheduleSave();
}
// things we both changed: which to keep, one by one
function askConflicts(list) {
  const NOUN = { markers: 'place', unplaced: 'unplaced place', nations: 'nation', borders: 'border', routes: 'route', labels: 'name on the water', types: 'icon type', settings: 'setting' };
  const choice = {}; for (const c of list) choice[c.key] = 'mine';
  const close = () => { $('#modal').hidden = true; $('#modal').replaceChildren(); };
  const rows = list.map(c => h('div', { class: 'mconf' },
    h('span', { class: 'mc-n' }, c.name || (c.coll === 'settings' ? 'The setting “' + c.id + '”' : 'A ' + (NOUN[c.coll] || 'thing'))),
    ...['mine', 'theirs'].map(v => h('label', null, h('input', { type: 'radio', name: 'mc-' + c.key, checked: v === 'mine', onchange: () => { choice[c.key] = v; } }), v === 'mine' ? ' Keep mine' : ' Keep theirs'))));
  $('#modal').replaceChildren(h('div', { class: 'dialog mdlg', onclick: e => e.stopPropagation() },
    h('div', { class: 'dh' }, h('h3', null, 'You and someone else changed the same things')),
    h('div', { class: 'mbody' }, h('p', null, `Everything else you each did has been put together. ${list.length === 1 ? 'This one was' : 'These were'} changed by both of you, differently:`), ...rows),
    h('div', { class: 'mfoot' }, h('button', { class: 'tool', onclick: () => { close(); toast('Not saved yet: your changes are still here', true); } }, 'Not now'),
      h('button', { class: 'tool primary', onclick: () => { close(); saveToServer(false, choice); } }, 'Save'))));
  $('#modal').onclick = null; $('#modal').hidden = false;
}
// someone else saved the map: if I've nothing of my own waiting, their version comes straight in
window.addEventListener('valanar-world-saved', async e => {
  const m = e.detail || {};
  if (!SERVER || eraId || m.key !== (ATLAS ? ATLAS.id : 'world') || m.savedAt === fileSavedAt || (SERVER.user && m.uid === SERVER.user.id)) return;
  if (unsaved || saveState === 'saving') return;   // my save will merge with it
  try {
    const r = await fetch('/api/site/world/current' + (ATLAS ? '?atlas=' + ATLAS.id : ''), { credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) return;
    if (unsaved || saveState === 'saving') return;
    takeIn(j.data, j.savedAt, null, editMode ? `${m.by} changed the map: ${m.summary || ''}` : null);
  } catch (err) { /* next time */ }
});
// the map's history: every change, when and by whom, in words; any version can be put back
async function openHistory() {
  const close = () => { $('#modal').hidden = true; $('#modal').replaceChildren(); };
  const q = ATLAS ? '?atlas=' + ATLAS.id : '';
  let entries;
  try { const r = await fetch('/api/site/world/history' + q, { credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); entries = j.entries; }
  catch (e) { return toast('Couldn’t read the history: ' + (e.message || e), true); }
  const when = at => new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const VERB = { added: 'added', moved: 'moved', changed: 'changed', removed: 'removed' };
  const body = h('div', { class: 'mbody mhist' }, entries.length ? null : h('p', null, 'No changes kept yet: they’re listed here from now on.'),
    ...entries.map((e, i) => {
      const more = h('div', { class: 'mh-more', hidden: true }, ...(e.changes || []).map(c => h('div', null, `${c.name || 'a ' + c.coll.replace(/s$/, '')} ${VERB[c.what] || c.what}`)), e.count > (e.changes || []).length ? h('div', { class: 'dim' }, `…and ${e.count - e.changes.length} more`) : null);
      return h('div', { class: 'mh-row' + (i === 0 ? ' cur' : '') },
        h('div', { class: 'mh-when' }, when(e.savedAt), e.started && e.started !== e.savedAt ? h('span', { class: 'dim' }, ' (from ' + new Date(e.started).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ')') : null),
        h('div', { class: 'mh-who' }, e.byName || 'Unknown'),
        h('div', { class: 'mh-what' }, e.summary, (e.changes || []).length ? h('button', { class: 'tool sm', onclick: ev => { more.hidden = !more.hidden; ev.target.textContent = more.hidden ? 'Details' : 'Hide'; } }, 'Details') : null, more),
        i === 0 ? h('span', { class: 'mh-now' }, 'Now') : SERVER.admin ? h('button', { class: 'tool sm', title: 'Make the map as it was just after this change (the change list keeps everything: this can be undone by putting back a later one)', onclick: () => restore(e) }, 'Put back') : null);
    }));
  async function restore(e) {
    if (!confirm(`Put the map back as it was on ${when(e.savedAt)}? Everything since will still be in this list.`)) return;
    try {
      const r = await fetch('/api/site/world/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: e.file, atlas: ATLAS ? ATLAS.id : undefined }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      unsaved = false; clearTimeout(saveTimer); takeIn(j.data, j.savedAt, null, 'The map is back as it was on ' + when(e.savedAt)); close();
    } catch (err) { toast('Couldn’t put it back: ' + (err.message || err), true); }
  }
  $('#modal').replaceChildren(h('div', { class: 'dialog mdlg', onclick: ev => ev.stopPropagation() },
    h('div', { class: 'dh' }, h('h3', null, 'The map’s history' + (ATLAS ? ': ' + ATLAS.name : '')), h('span', { class: 'sp' }), h('button', { class: 'tool', onclick: close }, 'Close')), body));
  $('#modal').onclick = close; $('#modal').hidden = false;
}

async function saveNow() {
  if (eraId) return;
  if (SERVER) { if (saveState === 'saving') scheduleSave(); else await saveToServer(); return; }
  if (!dirHandle || saveState === 'saving') { if (saveState === 'saving') scheduleSave(); return; }
  saveState = 'saving'; renderStatus();
  try {
    const onDisk = await readText(dirHandle, 'data/markers.js');
    const diskAt = onDisk && (onDisk.match(/^"savedAt": (".*?"|null)/m) || [])[1];
    if (diskAt && diskAt !== 'null' && JSON.parse(diskAt) !== fileSavedAt
        && !confirm('data/markers.js has been changed since this page loaded (perhaps in another tab). Overwrite it with what is on screen? A backup of it is kept either way.')) {
      saveState = 'error'; renderStatus(); return;
    }
    if (!backedUp) await backup();
    data.savedAt = new Date().toISOString();
    await writeText(dirHandle, 'data/markers.js', serialise(data));
    fileSavedAt = data.savedAt;
    unsaved = false; saveState = 'saved'; lastSaved = new Date();
    clearDraft();
  } catch (e) {
    console.error(e);
    saveState = 'error';
    toast('Saving failed: ' + (e.message || e), true);
  }
  renderStatus();
}

async function connectFolder() {
  try {
    const hnd = await window.showDirectoryPicker({ id: 'valanar-map', mode: 'readwrite' });
    let ok = true;
    try { await hnd.getFileHandle('index.html'); } catch (e) { ok = false; }
    if (!ok && !confirm(`"${hnd.name}" doesn't have index.html in it. Pick the map-viewer folder this page is in. Use "${hnd.name}" anyway?`)) return;
    dirHandle = hnd; pendingHandle = null; backedUp = false;
    try { await idbSet('dir', hnd); } catch (e) { /* remembering is optional */ }
    toast(`Saving to ${hnd.name}/data/markers.js`);
    await saveNow();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not connect the folder: ' + (e.message || e), true);
  }
}
async function reconnect() {
  try {
    if (await pendingHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
      dirHandle = pendingHandle; pendingHandle = null; backedUp = false;
      if (unsaved) await saveNow();
    }
  } catch (e) { toast('Could not reconnect: ' + (e.message || e), true); }
  renderStatus();
}

function download() {
  const blob = new Blob([serialise(data)], { type: 'text/javascript' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'markers.js' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Downloaded markers.js. Put it in the data folder to replace the old one.');
}

async function rescanIcons() {
  if (SERVER) {
    try { const r = await fetch('/api/site/icons', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); icons = j.icons; toast(`Found ${icons.length} icons.`); }
    catch (e) { toast('Rescan failed: ' + (e.message || e), true); }
    return;
  }
  try {
    const root = await dirHandle.getDirectoryHandle('icons');
    const out = [];
    const walk = async (d, prefix) => {
      for await (const [name, e] of d.entries()) {
        if (e.kind === 'directory') await walk(e, prefix + name + '/');
        else if (/\.(png|webp|svg|jpe?g)$/i.test(name)) out.push(prefix + name);
      }
    };
    await walk(root, 'icons/');
    out.sort(natural);
    icons = out;
    await writeText(dirHandle, 'data/icons.js', '// List of icon images, written by the map editor (Rescan icons).\nwindow.VALANAR_ICONS = [\n'
      + out.map(p => '  ' + JSON.stringify(p)).join(',\n') + '\n];\n');
    toast(`Found ${out.length} icons.`);
  } catch (e) { toast('Rescan failed: ' + (e.message || e), true); }
}

function renderStatus() {
  if (!editMode) return;
  const s = $('#status');
  const dot = cls => h('span', { class: 'dot ' + cls });
  if (SERVER) {
    const main = saveState === 'saving' || unsaved ? [dot('warn'), 'Saving…'] : saveState === 'error' ? [dot('bad'), 'Not saved', h('button', { class: 'tool', onclick: () => saveNow() }, 'Retry')]
      : [dot('ok'), lastSaved ? 'Saved ' + lastSaved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Saved on the server'];
    s.replaceChildren(...main, h('button', { class: 'tool', title: 'Every change to the map, who made it and when; put any version back', onclick: openHistory }, 'History'),
      h('button', { class: 'tool', title: 'Look again for icons (the icons folder and Files › Map icons)', onclick: rescanIcons }, 'Rescan icons'),
      h('button', { class: 'tool', title: 'Download the map data as markers.js', onclick: download }, 'Download'));
    return;
  }
  const extra = [h('button', { class: 'tool', title: 'Download markers.js', onclick: download }, 'Download')];
  if (dirHandle) extra.unshift(h('button', { class: 'tool', title: 'Re-read the icons folder after adding images', onclick: rescanIcons }, 'Rescan icons'));
  let main;
  if (dirHandle) {
    if (saveState === 'saving') main = [dot('warn'), 'Saving…'];
    else if (saveState === 'error') main = [dot('bad'), 'Not saved', h('button', { class: 'tool', onclick: saveNow }, 'Retry')];
    else if (unsaved) main = [dot('warn'), 'Saving…'];
    else main = [dot('ok'), lastSaved ? 'Saved ' + lastSaved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Connected'];
  } else if (pendingHandle) main = [dot('warn'), h('button', { class: 'tool', onclick: reconnect, title: 'The browser needs a click to let this page save again' }, 'Reconnect folder')];
  else if (canPickFolder) main = [dot(unsaved ? 'bad' : ''), unsaved ? 'Not saved to file' : 'Not connected', h('button', { class: 'tool', onclick: connectFolder, title: 'Choose the map-viewer folder so changes save to data/markers.js' }, 'Connect folder')];
  else main = [dot(unsaved ? 'bad' : ''), 'This browser can’t save directly'];
  s.replaceChildren(...main, ...extra);
}

// drafts: every change is also kept in this browser until it reaches the file
function saveDraft() { if (eraId) return; store.set(DRAFT_KEY, JSON.stringify({ at: Date.now(), data })); }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }
function offerDraft() {
  let draft = null;
  try { draft = JSON.parse(store.get(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
  if (!draft || !draft.data) return;
  const strip = d => JSON.stringify(Object.assign({}, d, { savedAt: null }));
  if (strip(normalise(draft.data)) === strip(data)) { clearDraft(); return; }
  const when = new Date(draft.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  bannerMsg = {
    text: `There are edits from ${when} in this browser that were never saved${SERVER ? '' : ' to markers.js'}.`,
    actions: [
      ['Restore them', () => {
        bannerMsg = null; if (!editMode) setEditMode(true);
        const before = JSON.stringify(data); data = normalise(draft.data); applyImport(); commit(before);
        toast(SERVER ? 'Edits restored and saving.' : 'Edits restored. Connect the folder to save them.');
      }],
      ['Discard', () => { bannerMsg = null; clearDraft(); renderBanner(); }]
    ]
  };
  renderBanner();
}

// remembered folder handle (IndexedDB)
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('valanar-map', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function restoreHandle() {
  if (!CAN_EDIT || !canPickFolder || SERVER) return;
  try {
    const hnd = await idbGet('dir'); if (!hnd) return;
    if (await hnd.queryPermission({ mode: 'readwrite' }) === 'granted') { dirHandle = hnd; if (unsaved) scheduleSave(); } else pendingHandle = hnd;
  } catch (e) { /* not remembered */ }
  renderStatus();
}

// ───────────────────────── CSV import ─────────────────────────

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const CORE = { mapid: ['mapid'], name: ['settlementname', 'name'], type: ['settlementtype', 'type'], nation: ['countrynation', 'nation', 'country'], region: ['regionprovince', 'region', 'province'] };
const FIELD_BY_CANON = Object.fromEntries(INFO_FIELDS.concat(FACILITIES, [NOTES]).map(k => [canon(k), k]));
FIELD_BY_CANON.population = 'Population Approx';
FIELD_BY_CANON.notes = NOTES;

function importCSV(text, fileName) {
  const rows = parseCSV(text);
  const hi = rows.findIndex(r => r.some(c => CORE.name.includes(canon(c))));
  if (hi < 0) return { file: fileName, skipped: true };
  const header = rows[hi].map(c => c.trim());
  const col = {};
  header.forEach((c, i) => {
    const k = canon(c); if (!k) return;
    for (const [core, names] of Object.entries(CORE)) if (names.includes(k) && col[core] == null) { col[core] = i; return; }
    col['info:' + (FIELD_BY_CANON[k] || c)] = i;
  });
  const tab = (fileName.match(/ - ([^-]+?)\.csv$/i) || [])[1];
  const tabNation = tab && !/template|homepage|unclaimed|read me/i.test(tab) ? tab.trim() : '';
  const res = { file: fileName, updated: 0, onMap: 0, added: 0, newTypes: [] };
  for (const r of rows.slice(hi + 1)) {
    const name = (r[col.name] || '').trim();
    if (!name) continue;
    const nation = (col.nation != null ? (r[col.nation] || '').trim() : '') || tabNation;
    const region = col.region != null ? (r[col.region] || '').trim() : '';
    const typeLabel = col.type != null ? (r[col.type] || '').trim() : '';
    let type = '';
    if (typeLabel) {
      let t = data.types.find(x => canon(x.label) === canon(typeLabel) || x.id === canon(typeLabel));
      if (!t) { t = newType(typeLabel, 'settlement'); data.types.push(t); res.newTypes.push(typeLabel); }
      type = t.id;
    }
    const info = {};
    for (const [k, i] of Object.entries(col)) {
      if (!k.startsWith('info:')) continue;
      const v = (r[i] || '').trim(); const key = k.slice(5);
      if (/^true$/i.test(v)) info[key] = true;
      else if (/^false$/i.test(v)) info[key] = false;
      else if (v) info[key] = v;
    }
    const key = canon(name) + '|' + canon(nation);
    const all = data.markers.concat(data.unplaced);
    const placeholder = /^unnamed\b/i.test(name);          // "Unnamed Village": no real name yet
    const mapId = col.mapid != null ? (r[col.mapid] || '').trim() : '';
    let match = mapId ? findAny(mapId) : null;              // the sheet's Map ID column ties a row to its icon
    if (match && !placeholder && match.name !== name) { match.name = name; res.renamed = (res.renamed || 0) + 1; }
    if (!match && placeholder) { res.missing = (res.missing || 0) + 1; continue; }
    if (!match) match = all.find(m => canon(m.name) + '|' + canon(m.nation) === key);
    if (!match) {   // icons brought in from Wonderdraft have names but no nation yet
      const loose = all.filter(m => canon(m.name) === canon(name) && (!m.nation || !nation));
      if (loose.length === 1) match = loose[0];
    }
    if (match) {
      if (type) match.type = type;
      if (region) match.region = region;
      if (nation) match.nation = nation;
      Object.assign(match.info, info);
      if (!placeholder) delete match.unnamed;
      res.updated++; if (findMarker(match.id)) res.onMap++;
    } else {
      data.unplaced.push({ id: uid(), name, type: type || 'town', nation, region, info });
      res.added++;
    }
  }
  return res;
}

$('#fileCsv').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const texts = await Promise.all(files.map(f => f.text()));
  const results = [];
  change(() => { files.forEach((f, i) => results.push(importCSV(texts[i], f.name))); });
  for (const r of results) {
    if (r.skipped) toast(`${r.file}: no "Settlement Name" column, skipped.`, true);
    else toast(`${r.file}: ${r.updated} updated${r.onMap ? ` (${r.onMap} on the map)` : ''}${r.renamed ? `, ${r.renamed} renamed` : ''}, ${r.added} new in Unplaced${r.missing ? `, ${r.missing} unnamed rows whose Map ID wasn't found` : ''}${r.newTypes.length ? `, new types: ${r.newTypes.join(', ')}` : ''}.`);
  }
  if (results.some(r => r.added)) { panelMode = 'unplaced'; selectedId = null; renderPanel(); renderEditBar(); }
});

// ───────────────────────── views: map and wiki ─────────────────────────
//
// The top bar switches between the map and the wiki. The wiki shows every page of the Obsidian vault,
// read from data/wiki.js (rebuilt by make_wiki.bat). Addresses: #/map, #/wiki/<folder>/<page>?h=<heading>.

let WIKI = window.VALANAR_WIKI && Array.isArray(window.VALANAR_WIKI.pages) ? window.VALANAR_WIKI : null;
// Obsidian matches links ignoring case; accents and curly apostrophes are matched loosely too.
const wkey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’`´]/g, "'").replace(/\s+/g, ' ').trim();
const looseKey = s => wkey(s).replace(/^(the|lesser|greater) /, '').replace(/[^a-z0-9]/g, '');
const slug = s => wkey(s).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
let pages = [], pageByPath = new Map(), pageByTitle = new Map(), pageByLoose = new Map();
function setPages(list) {
  pages = list.filter(p => !p.deleted).map(p => {
    const parts = p.path.split('/');
    return Object.assign({}, p, { path: p.path, title: parts[parts.length - 1], folders: parts.slice(0, -1), md: p.md });
  }).sort((a, b) => natural(a.path, b.path));
  pageByPath = new Map(pages.map(p => [p.path, p]));
  pageByTitle = new Map(); pageByLoose = new Map();
  for (const p of pages) {
    if (!pageByTitle.has(wkey(p.title))) pageByTitle.set(wkey(p.title), p);
    if (!pageByLoose.has(looseKey(p.title))) pageByLoose.set(looseKey(p.title), p);
  }
  INDEX_PAGE = (SERVER && SERVER.mainPage && findPage(SERVER.mainPage)) || findPage('Valanar Index') || findPage('Index') || findPage('Main page') || pages[0] || null;
  // A page named after its folder ("Thanem/Thanem"), or its "(overview)", is that folder's own page: it's shown as
  // the folder's introduction, and links to it go to the folder.
  ownerByFolder = new Map();
  for (const p of pages) {
    if (!p.folders.length) continue;
    const f = p.folders.join('/'), base = wkey(p.folders[p.folders.length - 1]), t = wkey(p.title);
    const ov = /^(.*?)\s*\(overview\)$/i.exec(p.title);
    if (t === base) ownerByFolder.set(f, p);
    else if (ov && wkey(ov[1]) === base && !ownerByFolder.has(f)) ownerByFolder.set(f, p);
  }
  ownerPaths = new Set([...ownerByFolder.values()].map(p => p.path));
}
let ownerByFolder = new Map(), ownerPaths = new Set();
const isOwnerPage = p => !!p && ownerPaths.has(p.path);
const folderHref = f => '#/files/' + f.split('/').map(encodeURIComponent).join('/');
let INDEX_PAGE = null;
setPages(WIKI ? WIKI.pages : []);
// A page from a link target ("Highwater", "Places/Highwater", "Highwater.md").
function findPage(ref, loose) {
  if (!ref) return null;
  ref = String(ref).trim().replace(/\.md$/i, '');
  return pageByPath.get(ref) || pageByTitle.get(wkey(ref.split('/').pop())) || (loose && pageByLoose.get(looseKey(ref))) || null;
}
const wikiHref = (path, h) => !h && ownerPaths.has(path) ? folderHref(path.split('/').slice(0, -1).join('/'))
  : '#/wiki/' + path.split('/').map(encodeURIComponent).join('/') + (h ? '?h=' + encodeURIComponent(h) : '');
// The wiki page for a place: its "wiki" field if it names a page, otherwise a page with the same name.
const pageForMarker = m => (m.wiki && !/^https?:/i.test(m.wiki) && findPage(m.wiki)) || (!m.unnamed && findPage(m.name)) || null;
const nationOfMarker = m => m.nation || (pol && (nationAt(m.x, m.y) || {}).name) || '';
const pageForNation = name => (name && findPage(name, true)) || null;

let view = 'map', wikiPage = null, lastWikiPath = null, special = '';

function route() {
  if (WIKIUI && WIKIUI.dirty && !/^#\/wiki\/Special:(Edit|New)/.test(location.hash) && !confirm('Leave the page you are editing without saving?')) { history.pushState(null, '', lastHash); return; }
  if (WIKIUI) WIKIUI.dirty = false;
  lastHash = location.hash;
  // the wiki's front page is the folder view (#/wiki); #/files/<folder> is a folder in it
  if ((/^#\/files(\/|$)/.test(location.hash) || /^#\/wiki\/?$/.test(location.hash)) && DRIVE) {
    let path = location.hash.replace(/^#\/(files|wiki)\/?/, '');
    try { path = path.split('/').map(decodeURIComponent).join('/'); } catch (e) { /* as is */ }
    setView('files'); document.title = `${path && !path.startsWith(':') ? path.split('/').pop() + ' · ' : ''}${siteName} wiki`;
    DRIVE.show(path);
    return;
  }
  if (location.hash === '#/admin' && ADMIN) { setView('admin'); document.title = `Admin · ${siteName}`; ADMIN.show(); return; }
  // the calendar opens over the map
  if (location.hash === '#/calendar' && CALVIEW) { showMap(); calSheet(true); document.title = `Calendar · ${siteName}`; CALVIEW.show(); return; }
  calSheet(false);
  // the Library (the bookshelf) and the Observatory (the night sky) have tabs of their own:
  // #/library[/<book>] and #/observatory[/build[/<constellation>]]
  const tab = /^#\/(library|observatory)(?:\/([^?]*))?(?:\?(.*))?$/.exec(location.hash);
  const sp = tab ? [null, null, tab[1] === 'library' ? 'Bookshelf' : 'Constellation', tab[2] || '', tab[3] || '']
    : /^#\/wiki\/(Special:([A-Za-z]+)(?:\/([^?]*))?|Category:[^?]*)(?:\?(.*))?$/.exec(location.hash);
  special = sp && WIKIUI ? sp[2] || '' : '';
  if (sp && WIKIUI) {
    setView('wiki'); wikiPage = null;
    let name = sp[2] || sp[1]; try { name = decodeURIComponent(name); } catch (e) { /* as is */ }
    if (WIKIUI.special(name, sp[3] || '', new URLSearchParams(sp[4] || ''))) { $('#wikiMain').scrollTop = 0; if (!/^(Bookshelf|Book|Constellation)$/.test(name)) document.title = `${name.replace(/^Category:/, 'Category: ')} · ${siteName}`; return; }
  }
  // #/wiki/<page>, ?h=<heading> to scroll to it, ?s=<section> to read just that section
  const m = /^#\/wiki(?:\/([^?]*))?(?:\?([hs])=(.*))?$/.exec(location.hash);
  if (m) {
    let path = null;
    try { path = m[1] ? m[1].split('/').map(decodeURIComponent).join('/') : null; } catch (e) { path = m[1]; }
    let arg = ''; try { arg = m[3] ? decodeURIComponent(m[3]) : ''; } catch (e) { arg = m[3]; }
    showWiki(path, m[2] === 'h' ? arg : '', m[2] === 's' ? arg : '');
  } else {
    showMap();
    if (TALES && TALES.route(location.hash)) return;
    if (WAYF && WAYF.route(location.hash)) return;
  }
}
window.addEventListener('hashchange', route);

function calSheet(on) {
  if ($('#calendar')) $('#calendar').hidden = !on;
  document.body.classList.toggle('cal-open', !!on);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('cal-open') && !isTyping()) location.hash = '#/map'; });
function setView(v) {
  view = v;
  if (v !== 'map') { try { if (TALES) TALES.leave(); if (WAYF && WAYF.playing()) WAYF.stop(); } catch (e) { /* not made yet */ } }
  if (v !== 'map') calSheet(false);
  document.body.classList.toggle('view-wiki', v === 'wiki' || v === 'files' || v === 'admin');
  document.body.classList.toggle('view-files', v === 'files');
  document.body.classList.toggle('view-admin', v === 'admin');
  if (v !== 'wiki') document.body.classList.remove('wiki-editing');
  $('#wiki').hidden = v !== 'wiki';
  if ($('#drive')) $('#drive').hidden = v !== 'files';
  if ($('#admin')) $('#admin').hidden = v !== 'admin';
  if (v !== 'wiki') try { if (WIKIUI && WIKIUI.leave) WIKIUI.leave(); } catch (e) { /* not made yet */ }   // the Library's and Observatory's layout and animation stop
  $('#results').hidden = true;
  const cur = v === 'wiki' && wikiPage ? wikiPage.title : '';
  const own = v === 'wiki' ? (/^(Bookshelf|Book)$/.test(special) ? 'library' : special === 'Constellation' ? 'observatory' : '') : '';
  for (const b of document.querySelectorAll('#views button')) {
    const on = b.dataset.view === 'map' ? v === 'map'
      : b.dataset.view === 'admin' ? v === 'admin'
      : b.dataset.view === 'library' || b.dataset.view === 'observatory' ? own === b.dataset.view
      : own ? false
      : b.dataset.page ? wkey(b.dataset.page) === wkey(cur)
      : (v === 'wiki' || v === 'files') && !document.querySelector(`#views button[data-page="${cur}"]`);
    b.classList.toggle('on', on);
  }
}

function showMap() {
  if (view === 'map') return;
  document.title = siteName;
  setView('map');
  map.invalidateSize();
}
// Open the map (from the wiki) and fly to a place.
function goToMarker(id) {
  if (location.hash.startsWith('#/wiki')) history.pushState(null, '', '#/map');
  showMap();
  select(id, { fly: true });
}

let wikiSection = '';
// ── page colours for the wiki and files: light, parchment or night, each reader's own (kept in this browser)
const THEMES = [['light', 'Light pages'], ['parchment', 'Parchment'], ['night', 'Night']];
function applyTheme(t) { for (const [k] of THEMES) document.documentElement.classList.toggle('wt-' + k, k === t && k !== 'light'); }
applyTheme((store.get('valanar-wiki-theme') || 'light'));
function themePicker() {
  const box = h('div', { class: 'wtheme', title: 'Page colours' });
  const draw = () => { const cur = (store.get('valanar-wiki-theme') || 'light'); box.replaceChildren(...THEMES.map(([k, l]) => h('button', { class: 't-' + k + (k === cur ? ' on' : ''), title: l, 'aria-label': l,
    onclick: () => { store.set('valanar-wiki-theme', k); applyTheme(k); for (const b of document.querySelectorAll('.wtheme')) b._draw && b._draw(); } }))); };
  box._draw = draw; draw();
  return box;
}
function showWiki(path, heading, section) {
  // a folder's address in the wiki ("#/wiki/Geography/Dol-Calandria") is the folder's page
  if (path && !pageByPath.has(path) && DRIVE && pages.some(p => (p.folders.join('/') + '/').startsWith(path + '/'))) { location.replace(folderHref(path)); return; }
  const page = !WIKI ? null : path ? pageByPath.get(path) || findPage(path) : (INDEX_PAGE);
  // a folder's own page is read as the folder (unless just one part of it is asked for)
  if (page && isOwnerPage(page) && !section && !heading && DRIVE) { location.replace(folderHref(page.folders.join('/'))); return; }
  const changed = page !== wikiPage || !$('#wikiArticle').firstChild || (section || '') !== wikiSection;
  wikiPage = page; wikiSection = section || '';
  if (page) { lastWikiPath = page.path; store.set('valanar-wiki-page', page.path); remember('page', page.path, page.title); }
  setView('wiki');
  document.body.classList.remove('wiki-nav-open');
  if (changed || WIKIUI) {
    if (WIKIUI) WIKIUI.render(page, path, section || ''); else { renderWikiArticle(page, path); renderWikiTree(); }
    if (changed) $('#wikiMain').scrollTop = 0;
    document.title = page ? `${page.title} · ${siteName}` : `${siteName} wiki`;
  }
  if (heading) {
    const el = document.getElementById('h-' + slug(heading));
    if (el) el.scrollIntoView({ block: 'start' });
  }
}

// --- rendering a page ---

function wikiMarkdown(page) {
  let md = page.md.replace(/^﻿/, '');
  // Obsidian properties block at the very top
  md = md.replace(/^---\n((?:[\w .-]+:.*\n|[ \t]+.*\n|-.*\n)*)---\n/, '');
  // [[Page]], [[Page|text]], [[Page#Heading]], [[#Heading]]; ![[embeds]] become links. Code is left alone.
  return md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((chunk, i) => i % 2 ? chunk : chunk.replace(
    /!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (all, target, head, alias) => {
      const t = target.trim(), hd = (head || '').trim();
      const p = t ? findPage(t) : page;
      const text = alias ? alias.trim() : t ? (hd ? `${t} › ${hd}` : t) : hd;
      if (!p) return `<a class="wl missing" title="No page called “${escHTML(t)}” yet">${escHTML(text)}</a>`;
      return `<a class="wl" href="${escHTML(wikiHref(p.path, hd))}">${escHTML(text)}</a>`;
    })).join('');
}

function renderWikiArticle(page, asked) {
  const art = $('#wikiArticle'), toc = $('#wikiToc');
  toc.replaceChildren();
  if (!WIKI) {
    art.replaceChildren(h('h1', null, 'No wiki yet'),
      h('p', null, 'Run ', h('code', null, 'make_wiki.bat'), ' in the map-viewer folder. It copies the pages of the Obsidian vault into ', h('code', null, 'data/wiki.js'), ', then reload this page.'));
    return;
  }
  if (!page) {
    art.replaceChildren(h('h1', null, asked ? asked.split('/').pop() : 'Not found'),
      h('p', { class: 'muted' }, 'There is no page with this name in the vault yet.'),
      h('p', null, h('a', { href: wikiHref(INDEX_PAGE.path) }, '← Back to the index')));
    return;
  }
  const body = h('div', { class: 'md' });
  body.innerHTML = window.marked
    ? window.marked.parse(wikiMarkdown(page), { gfm: true, breaks: true })
    : '<pre>' + escHTML(page.md) + '</pre>';
  // headings get ids for [[Page#Heading]] links and the contents list
  const seen = new Set();
  for (const el of body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    let id = 'h-' + slug(el.textContent), n = 2;
    while (seen.has(id)) id = 'h-' + slug(el.textContent) + '-' + n++;
    seen.add(id); el.id = id;
  }
  for (const a of body.querySelectorAll('a[href]')) if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
  for (const img of body.querySelectorAll('img')) img.loading = 'lazy';
  for (const t of body.querySelectorAll('table')) t.replaceWith(h('div', { class: 'tablewrap' }, t.cloneNode(true)));
  // the page title, unless the page starts with its own top heading
  const first = body.firstElementChild;
  const ownTitle = first && first.tagName === 'H1';
  const crumbs = h('div', { class: 'crumbs' },
    h('button', { class: 'navbtn', title: 'Pages', onclick: () => document.body.classList.toggle('wiki-nav-open') }, '☰'),
    h('a', { href: wikiHref(INDEX_PAGE.path) }, 'Index'),
    page.folders.map(f => [h('span', { class: 'sep' }, '/'), h('span', null, f)]));
  art.replaceChildren(...[crumbs, ownTitle ? null : h('h1', { class: 'ptitle' }, page.title), body, wikiOnMap(page),
    h('p', { class: 'foot' }, `${page.path}.md`, WIKI.built ? ` · wiki built ${WIKI.built}` : '')].filter(Boolean));
  // contents list for longer pages
  const heads = [...body.querySelectorAll('h2, h3')];
  if (heads.length >= 4) {
    toc.append(h('div', { class: 'tt' }, 'On this page'),
      ...heads.map(el => h('a', { href: wikiHref(page.path, el.textContent), class: el.tagName === 'H3' ? 'sub' : null,
        onclick: e => { e.preventDefault(); history.replaceState(null, '', wikiHref(page.path, el.textContent)); el.scrollIntoView({ block: 'start' }); } }, el.textContent)));
  }
}

// "On the map": the place this page describes, or a nation's settlements.
const SIZE_RANK = { capital: 0, city: 1, 'free-city': 1, town: 2, village: 3, hamlet: 4 };
function wikiOnMap(page) {
  const out = [];
  const nation = data.nations.find(n => pageForNation(n.name) === page);
  const places = data.markers.filter(m => pageForMarker(m) === page && !(nation && typeOf(m).text));
  if (places.length) out.push(h('div', { class: 'btnrow' }, places.slice(0, 6).map(m =>
    h('button', { class: 'btn', onclick: () => goToMarker(m.id) }, places.length > 1 ? `Show ${m.name} on the map` : 'Show on the map'))));
  if (nation) {
    if (!pol && Land.ready) computePolitical();
    const mine = data.markers.filter(m => !isPlace(m) && nationOfMarker(m) === nation.name);
    const named = mine.filter(m => !m.unnamed).sort((a, b) => ((SIZE_RANK[a.type] ?? 9) - (SIZE_RANK[b.type] ?? 9)) || natural(a.name, b.name));
    const showNation = () => {
      if (location.hash.startsWith('#/wiki')) history.pushState(null, '', '#/map');
      showMap();
      if (!polOn) $('#polToggle').click();
      const pts = mine.map(m => toLatLng(m.x, m.y));
      if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: 0.8 });
    };
    if (HERALD) out.push(h('div', { class: 'pagearms' }, h('div', { class: 'pa', html: armsSvg(nation, 96) }), h('div', null, h('div', { class: 'pak' }, 'The arms of ' + nation.name), h('p', null, HERALD.blazon(armsOf(nation))),
      ARMSHOP ? h('button', { class: 'btn sm', onclick: () => ARMSHOP.open(nation.id) }, '⚜ Change them in the Heraldry Workshop') : null)));
    out.push(h('h2', null, 'On the map'),
      h('p', { class: 'muted' }, mine.length
        ? `${mine.length} settlement${mine.length === 1 ? '' : 's'} on the map in ${nation.name}${mine.length > named.length ? `, ${mine.length - named.length} of them not yet named` : ''}.`
        : `${nation.name} is on the map, but no settlements are marked in it yet.`),
      named.length ? h('div', { class: 'placechips' }, named.map(m => h('button', { onclick: () => goToMarker(m.id), title: typeOf(m).label },
        hasIcon(m) ? h('img', { src: iconOf(m), alt: '' }) : null, m.name))) : null,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: showNation }, `Show ${nation.name} on the map`)));
  }
  return out.length ? h('section', { class: 'onmap' }, out) : null;
}

// --- the page list ---

let wikiFilter = '';
function renderWikiTree() {
  const tree = $('#wikiTree');
  if (!WIKI) { tree.replaceChildren(); return; }
  const cur = wikiPage && wikiPage.path;
  const link = (p, hint) => h('a', { href: wikiHref(p.path), class: p.path === cur ? 'on' : null }, p.title, hint ? h('span', { class: 'hint' }, hint) : null);
  if (wikiFilter) {
    const q = wkey(wikiFilter);
    const hits = pages.filter(p => wkey(p.title).includes(q) || wkey(p.folders.join(' ')).includes(q));
    tree.replaceChildren(...(hits.length ? hits.map(p => link(p, p.folders.join(' / '))) : [h('p', { class: 'empty' }, 'No pages match.')]));
    return;
  }
  // folders first, then pages, as in Obsidian; the open page's folders start expanded
  const root = { dirs: new Map(), pages: [] };
  for (const p of pages) {
    let node = root;
    for (const f of p.folders) { if (!node.dirs.has(f)) node.dirs.set(f, { dirs: new Map(), pages: [] }); node = node.dirs.get(f); }
    node.pages.push(p);
  }
  const openDirs = new Set(wikiPage ? wikiPage.folders.map((f, i) => wikiPage.folders.slice(0, i + 1).join('/')) : []);
  const build = (node, prefix) => [
    ...[...node.dirs.keys()].sort(natural).map(name => {
      const key = prefix ? prefix + '/' + name : name;
      const d = h('details', { open: openDirs.has(key) || null }, h('summary', null, name), h('div', { class: 'kids' }, build(node.dirs.get(name), key)));
      return d;
    }),
    ...node.pages.filter(p => p !== INDEX_PAGE).sort((a, b) => natural(a.title, b.title)).map(p => link(p))
  ];
  tree.replaceChildren(INDEX_PAGE ? h('a', { href: wikiHref(INDEX_PAGE.path), class: 'index' + (INDEX_PAGE.path === cur ? ' on' : '') }, 'Index') : '',
    ...build(root, ''));
  const on = tree.querySelector('a.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
if ($('#wikiFilter')) $('#wikiFilter').addEventListener('input', e => { wikiFilter = e.target.value.trim(); renderWikiTree(); });

// Links to the page already open don't change the address, so scroll to their heading by hand.
$('#wiki').addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/wiki"]');
  if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});

for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => {
  if (b.dataset.view === 'map') location.hash = '#/map';
  else if (b.dataset.view === 'files') location.hash = '#/files/';
  else if (b.dataset.view === 'admin') { if (location.hash === '#/admin') route(); else location.hash = '#/admin'; }
  else if (b.dataset.view === 'calendar') location.hash = '#/calendar';
  else if (b.dataset.view === 'library') location.hash = '#/library';
  else if (b.dataset.view === 'observatory') location.hash = '#/observatory';
  else if (b.dataset.page) { const p = findPage(b.dataset.page); location.hash = p ? wikiHref(p.path) : '#/wiki'; }
  else {
    location.hash = '#/wiki';
  }
});
for (const b of document.querySelectorAll('#views button[data-page]')) if (WIKI && !findPage(b.dataset.page)) b.hidden = true;
// The table needs its little server (start_vtt.bat). Opened as a file, point at where that server listens.
if (location.protocol === 'file:') $('#tableLink').href = 'http://localhost:8642/table/';

// ───────────────────────── search ─────────────────────────
//
// One box for places on the map and pages of the wiki (titles first, then words inside pages), the nations and the
// tales; and for things to do (the tools, the shows, the views), by name. Ctrl+K opens it with the whole list of those
// (or start with > for them alone).

const ACTIONS = [];        // { label, hint, keys (more words to find it by), icon, tag, run(), when() }
let palette = false;
function addAction(a) { ACTIONS.push(a); }
function actionHits(raw, all) {
  const q = raw.trim().toLowerCase().replace(/^>\s*/, '');
  const list = ACTIONS.filter(a => { try { return !a.when || a.when(); } catch (e) { return false; } });
  if (!q) return all ? list.map(a => ({ kind: 'act', a })) : [];
  const words = q.split(/\s+/);
  return list.filter(a => { const hay = (a.label + ' ' + (a.keys || '') + ' ' + (a.hint || '')).toLowerCase(); return words.every(w => hay.includes(w)); })
    .sort((x, y) => (y.label.toLowerCase().startsWith(q) - x.label.toLowerCase().startsWith(q)) || (y.label.toLowerCase().includes(q) - x.label.toLowerCase().includes(q)))
    .map(a => ({ kind: 'act', a }));
}
// a nation on the map: its borders showing, and all its towns in view
function showNationOnMap(n) {
  if (location.hash.startsWith('#/wiki')) history.pushState(null, '', '#/map');
  showMap();
  if (!polOn) $('#polToggle').click();
  let pts = data.markers.filter(m => !isPlace(m) && isFinite(m.x) && nationOfMarker(m) === n.name).map(m => toLatLng(m.x, m.y));
  if (!pts.length) pts = data.markers.filter(m => m.type === 'country' && canon(m.name) === canon(n.name)).map(m => toLatLng(m.x, m.y));
  if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: 0.9 });
  else if (pts.length) map.flyTo(pts[0], Math.max(map.getZoom(), 3.5), { duration: 0.9 });
  else toast(`${n.name} has no towns on the map to show.`);
}

const pageText = p => p.text || (p.text = p.md.replace(/\(data:[^)]*\)/g, '()').toLowerCase());
let resultIndex = 0;
function searchHits(raw) {
  if (/^\s*>/.test(raw)) return actionHits(raw, true);
  const q = canon(raw), wq = wkey(raw);
  if (!q && !wq) return [];
  // (a nation's name on the map is found as the nation)
  const isNationName = m => m.type === 'country' && data.nations.some(n => canon(n.name) === canon(m.name));
  const pool = data.markers.filter(m => !m.unnamed && !isNationName(m)).map(m => [m, false]).concat(editMode ? data.unplaced.map(m => [m, true]) : []);
  const places = pool.filter(([m]) => q && canon(m.name).includes(q))
    .sort(([a], [b]) => (canon(b.name).startsWith(q) - canon(a.name).startsWith(q)) || natural(a.name, b.name))
    .slice(0, 10).map(([m, un]) => ({ kind: 'place', m, un }));
  const titled = pages.filter(p => wkey(p.title).includes(wq))
    .sort((a, b) => (wkey(b.title).startsWith(wq) - wkey(a.title).startsWith(wq)) || natural(a.title, b.title))
    .slice(0, 8).map(p => ({ kind: 'page', p }));
  const text = [];
  if (wq.length >= 3) {
    const lq = raw.trim().toLowerCase();
    for (const p of pages) {
      if (text.length >= 6) break;
      if (titled.some(t => t.p === p)) continue;
      const i = pageText(p).indexOf(lq);
      if (i < 0) continue;
      const before = p.md.slice(0, i), heads = before.match(/^#{1,6} .*$/gm);
      const raw0 = p.md.slice(Math.max(0, i - 40), i + lq.length + 60).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[#*_>\n]+/g, ' ');
      text.push({ kind: 'text', p, heading: heads ? heads[heads.length - 1].replace(/^#+ /, '').trim() : '', snippet: '…' + raw0.trim() + '…' });
    }
  }
  const nats = q ? data.nations.filter(n => canon(n.name).includes(q)).sort((a, b) => canon(b.name).startsWith(q) - canon(a.name).startsWith(q)).slice(0, 3).map(n => ({ kind: 'nation', n })) : [];
  const tales = TALES && wq.length >= 2 ? TALES.tours().filter(t => t.stops && t.stops.length && wkey(t.title).includes(wq)).slice(0, 3).map(t => ({ kind: 'tale', t })) : [];
  const acts = raw.trim().length >= 2 ? actionHits(raw).slice(0, 4) : [];
  return view === 'wiki' ? [...titled, ...places, ...nats, ...tales, ...acts, ...text] : [...places, ...nats, ...acts, ...tales, ...titled, ...text];
}
function runSearch() {
  const box = $('#results'), raw = $('#search').value;
  const hits = raw.trim() ? searchHits(raw) : [...recentHits(palette ? 5 : 8), ...(palette ? actionHits('', true) : [])];
  if (!raw.trim() && !hits.length) { box.hidden = true; box._hits = []; return; }
  resultIndex = clamp(resultIndex, 0, Math.max(0, hits.length - 1));
  box.classList.toggle('palette', !raw.trim() && palette);
  // with nothing typed: what you looked at lately, then (Ctrl+K) the things to do, each under a heading
  const heads = new Map();
  if (!raw.trim()) {
    const fr = hits.findIndex(r => r.recent), fa = hits.findIndex(r => r.kind === 'act');
    if (fr >= 0) heads.set(fr, 'Recently viewed');
    if (fa >= 0) heads.set(fa, 'Things to do · type to find one');
  }
  box.replaceChildren(...(hits.length ? hits.flatMap((r, i) => [heads.has(i) ? h('div', { class: 'rhead' }, heads.get(i)) : null, ((r, i) => {
    const cls = i === resultIndex ? 'on' : '';
    if (r.kind === 'act') return h('button', { class: cls + ' act', onclick: () => choose(r) },
      h('span', { class: 'ri act', html: r.a.icon || '›' }),
      h('span', null, r.a.label, r.a.hint ? [h('br'), h('span', { class: 'meta' }, r.a.hint)] : null),
      r.a.tag || r.a.key ? h('span', { class: 'tag' }, r.a.tag || h('kbd', null, r.a.key)) : null);
    if (r.kind === 'nation') {
      const n = r.n, count = data.markers.filter(m => !isPlace(m) && nationOfMarker(m) === n.name).length;
      return h('button', { class: cls, onclick: () => choose(r) }, h('span', { class: 'ri arms', html: armsSvg(n, 26) || '⚑' }),
        h('span', null, n.name, h('br'), h('span', { class: 'meta' }, `A nation${count ? ` · ${count} settlement${count === 1 ? '' : 's'}` : ''}`)), h('span', { class: 'tag' }, 'nation'));
    }
    if (r.kind === 'tale') return h('button', { class: cls, onclick: () => choose(r) }, h('span', { class: 'ri' }, '❧'),
      h('span', null, r.t.title, h('br'), h('span', { class: 'meta' }, `A tale · ${r.t.stops.length} stop${r.t.stops.length === 1 ? '' : 's'}${r.t.about ? ' · ' + r.t.about : ''}`)), h('span', { class: 'tag' }, 'play'));
    if (r.kind === 'place') {
      const m = r.m;
      return h('button', { class: cls, onclick: () => choose(r) },
        hasIcon(m) ? h('img', { src: iconOf(m), alt: '' }) : h('span', { class: 'ri' }, typeOf(m).text ? 'Aa' : '◇'),
        h('span', null, m.name, h('br'), h('span', { class: 'meta' }, [typeOf(m).label, m.nation || (pol && (nationAt(m.x, m.y) || {}).name)].filter(Boolean).join(' · '))),
        h('span', { class: 'tag' }, r.un ? 'unplaced' : 'map'));
    }
    return h('button', { class: cls, onclick: () => choose(r) },
      h('span', { class: 'ri' }, '¶'),
      h('span', null, r.p.title, h('br'), h('span', { class: 'meta' }, r.kind === 'text' ? r.snippet : r.p.folders.join(' / ') || 'Wiki')),
      h('span', { class: 'tag' }, 'wiki'));
  })(r, i)].filter(Boolean)) : [h('div', { class: 'empty' }, 'No matches')]));
  box.hidden = false;
  box._hits = hits;
}
function choose(r) {
  $('#results').hidden = true; $('#search').blur(); palette = false;
  if (r.kind === 'act' || r.kind === 'nation' || r.kind === 'tale') {
    $('#search').value = '';
    try {
      if (r.kind === 'act') r.a.run();
      else if (r.kind === 'nation') showNationOnMap(r.n);
      else if (TALES) { if (location.hash.startsWith('#/wiki')) history.pushState(null, '', '#/map'); showMap(); TALES.play(r.t.id, 0); }
    } catch (e) { toast('That didn’t work: ' + (e.message || e), true); }
    return;
  }
  if (r.kind === 'place') {
    if (r.un) { showMap(); select(r.m.id); return; }
    goToMarker(r.m.id);
  } else location.hash = wikiHref(r.p.path, r.kind === 'text' ? r.heading : '');
}
$('#search').addEventListener('input', () => { resultIndex = 0; runSearch(); });
$('#search').addEventListener('focus', runSearch);
$('#search').addEventListener('keydown', e => {
  const hits = $('#results')._hits || [];
  if (e.key === 'ArrowDown') { resultIndex++; runSearch(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { resultIndex--; runSearch(); e.preventDefault(); }
  else if (e.key === 'Enter' && hits[resultIndex]) choose(hits[resultIndex]);
  else if (e.key === 'Escape') { $('#search').value = ''; $('#results').hidden = true; $('#search').blur(); palette = false; }
});
$('#search').addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== $('#search')) palette = false; }, 200); });
document.addEventListener('mousedown', e => { if (!e.target.closest('.search')) $('#results').hidden = true; });
// Ctrl+K (⌘K): the search box, with the things to do listed
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'k' || SCENE) return;
  e.preventDefault();
  const s = $('#search'); palette = true; s.value = ''; resultIndex = 0; s.focus(); runSearch();
}, true);

// ───────────────────────── keyboard and buttons ─────────────────────────

document.addEventListener('keydown', e => {
  if (view === 'wiki') {   // map shortcuts are off while reading
    if (e.key === '/' && !isTyping()) { e.preventDefault(); $('#search').focus(); }
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !isTyping() && editMode) {
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    const k = e.key.toLowerCase();
    if (k === 'c' && !e.shiftKey && !hasTextSelection()) { if (copyPlaces(false)) e.preventDefault(); return; }
    if (k === 'x' && !e.shiftKey) { if (copyPlaces(true)) e.preventDefault(); return; }
    if (k === 'v' && !e.shiftKey) { if (pastePlaces()) e.preventDefault(); return; }
    if (k === 'd' && !e.shiftKey) { if (copyPlaces(false, true)) { e.preventDefault(); pastePlaces(true); } return; }
  }
  if (isTyping() || ctrl || e.altKey) return;
  if (rulerOn) {
    if (e.key === 'Escape') { if (rulerPts.length && !rulerDone) { rulerPts = []; drawRuler(); } else setRuler(false); return; }
    if (e.key === 'Enter') { rulerFinish(); return; }
    if (e.key === 'Backspace' && rulerPts.length) { e.preventDefault(); rulerPts.pop(); rulerDone = false; drawRuler(); return; }
  }
  if (polEditing()) {
    if (e.key === 'Escape') {
      if (drawPts.length) cancelDraw();
      else if (polTool !== 'edit') setPolTool('edit');
      else if (selBorder) { selBorder = null; syncPolitical(); renderPanel(); }
      else closePanel();
      return;
    }
    if (e.key === 'Enter' && drawing()) { e.preventDefault(); finishDraw(); return; }
    if (e.key === 'Backspace' && drawing() && drawPts.length) { e.preventDefault(); drawPts.pop(); drawDraft(); renderBanner(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selBorder) { e.preventDefault(); deleteSelectedBorder(); return; }
    if (e.key === 'e') { setEditMode(false); return; }
    return;
  }
  if (e.key === 'Escape') { if (placing) stopPlacing(); else if (panelMode) closePanel(); return; }
  if (e.key === 'e' && CAN_EDIT) { setEditMode(!editMode); return; }
  if (!editMode && e.key === 'r' && view === 'map') { setRuler(!rulerOn); return; }
  if (!editMode && e.key === 'b' && view === 'map') { $('#polToggle').click(); return; }
  if (!editMode) return;
  if (e.key === 's' && placing && placing.kind === 'unplaced') { advancePlacing(placing.id); renderBanner(); renderPanel(); return; }
  const m = selectedId && findMarker(selectedId);
  if (!m) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeMarker(m.id); return; }
  const step = e.shiftKey ? 25 : 2;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) {
    e.preventDefault();
    change(() => { m.x = clamp(m.x + dir[0] * step, 0, INFO.width - 1); m.y = clamp(m.y + dir[1] * step, 0, INFO.height - 1); }, { panel: false });
  }
});

$('#editToggle').addEventListener('click', () => setEditMode(!editMode));
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnImport').addEventListener('click', () => $('#fileCsv').click());
$('#btnUnplaced').addEventListener('click', () => openPanel('unplaced'));
$('#btnTypes').addEventListener('click', () => openPanel('types'));
$('#btnBorders').addEventListener('click', () => { if (placing) stopPlacing(); openPanel('political'); });
for (const [id, m] of [['btnRoutes', 'routes'], ['btnNames', 'names'], ['btnArmies', 'armies'], ['btnSettings', 'settings'], ['lookToggle', 'settings']]) { const b = $('#' + id); if (b) b.addEventListener('click', () => { if (placing) stopPlacing(); if (panelMode === 'political') cancelDraw(); openPanel(m); }); }
window.addEventListener('beforeunload', e => { if (editMode && unsaved && (dirHandle || SERVER)) { saveNow(); e.preventDefault(); e.returnValue = ''; } });

// ───────────────────────── start ─────────────────────────

if (CAN_EDIT) $('#editToggle').hidden = false;
// routes, water names and the map's settings (app/maptools.js)
MT = window.ValanarMapTools ? window.ValanarMapTools({
  map, L, h, toast, NATIVE, INFO, toLatLng, toPixel, Land, smooth, pathLength, uid, isTyping, canEdit: CAN_EDIT,
  get data() { return data; }, change, panelShell, renderPanel,
  openPanel: (m, stay) => { if (stay && panelMode === m) renderPanel(); else { if (placing) stopPlacing(); openPanel(m); } },
  editMode: () => editMode, rulerOn: () => rulerOn, ocean: () => ocean, fmtTravel,
  pages: () => pages, findPage, wikiHref, applyView,
  hint: msg => { let el = $('#mthint'); if (!msg) { if (el) el.remove(); return; } if (!el) { el = h('div', { id: 'mthint' }); document.body.append(el); } el.textContent = msg; },
  unitsChanged: () => { if (rulerOn) drawRuler(); },
  onLook: () => { try { if (SKY && SKY.calendar) SKY.setCalendar(SKY.calendar); } catch (e) { /* the sky isn't made yet */ } if (AMB) AMB.refresh(); }
}) : null;
{ const st = MT && MT.look().view.start; if (st && isFinite(st.x) && isFinite(st.y)) map.setView(toLatLng(st.x, st.y), +st.z || map.getZoom(), { animate: false }); }
syncMarkers();
syncPolitical();
drawReadout();
loadLand(() => {
  // rivers and lakes: found in the map's own transparency, they count as land for borders and get their own water
  analyseLand(Land, { fresh: data.settings.freshwater !== false, width: +data.settings.freshwaterWidth || 48, tex: !!ocean })
    .then(r => {
      schedulePolitical();
      if (MT) MT.landChanged();
      if (AMB) AMB.landReady();
      if (ocean) { ocean.setLand(Land, r.tex); if (r.rgba) ocean.setFresh(Land, r.rgba); if (MT) MT.applyLook(); }
    })
    .catch(e => { console.warn('Couldn’t find the rivers:', e); schedulePolitical(); if (ocean) ocean.setLand(Land); });
});

// Water that isn't the open sea: rivers and lakes. The open sea is the water left after rubbing out everything
// narrower than `width` map px (rivers), that touches the edge of the map or is very large; anything else that's
// transparent is fresh water. Each river cell gets the direction downstream (towards where it meets the sea) and
// lakes are marked as still water. Changes Land so fresh water counts as land (borders run across rivers, and the
// sea's surf stays at the coast). Returns { rgba } for the water shader.
function findFreshwater(land, width) {
  const { w, h, v } = land;
  const W = w >> 1, H = h >> 1, R = Math.max(1.5, width / land.scale / 2);
  // the open sea, at half the land mask's resolution
  const half = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = 2 * y * w + 2 * x;
    half[y * W + x] = (v[i] + v[i + 1] + v[i + w] + v[i + w + 1]) < 512 ? 1 : 0;   // 1 = water
  }
  const g = new Float64Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = half[i] ? 1e12 : 0;
  edt2d(g, W, H);                                         // squared distance to land
  for (let i = 0; i < g.length; i++) g[i] = g[i] > R * R ? 0 : 1e12;
  edt2d(g, W, H);                                         // squared distance to what's left: wide water
  const open = new Uint8Array(W * H);
  for (let i = 0; i < g.length; i++) open[i] = half[i] && g[i] <= R * R ? 1 : 0;
  // pieces of open water touching the edge (or bigger than 2% of the map) are the sea
  const lab = new Int32Array(W * H), seed = new Uint8Array(W * H), stack = [];
  let n = 0;
  for (let s = 0; s < open.length; s++) {
    if (!open[s] || lab[s]) continue;
    n++; const cells = []; let edge = false;
    stack.push(s); lab[s] = n;
    while (stack.length) {
      const i = stack.pop(); cells.push(i);
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x > 0 && open[i - 1] && !lab[i - 1]) { lab[i - 1] = n; stack.push(i - 1); }
      if (x < W - 1 && open[i + 1] && !lab[i + 1]) { lab[i + 1] = n; stack.push(i + 1); }
      if (y > 0 && open[i - W] && !lab[i - W]) { lab[i - W] = n; stack.push(i - W); }
      if (y < H - 1 && open[i + W] && !lab[i + W]) { lab[i + W] = n; stack.push(i + W); }
    }
    if (edge || cells.length > 0.02 * W * H) for (const i of cells) seed[i] = 1;
  }
  for (let i = 0; i < g.length; i++) g[i] = seed[i] ? 0 : 1e12;
  edt2d(g, W, H);
  const SEA = (R + 1.5) * (R + 1.5);
  const isSea = (x, y) => g[Math.min(H - 1, y >> 1) * W + Math.min(W - 1, x >> 1)] <= SEA;
  // fresh water at full resolution: anything see-through that isn't the sea (and the land cells along it, for thin rivers)
  const fresh = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (v[i] < 250 && !isSea(x, y)) fresh[i] = 1; }
  if (!fresh.some(Boolean)) return null;
  // only the fresh cells are worked on from here: cells[k] is a cell's index, pos[index] = k + 1
  const cells = []; for (let i = 0; i < w * h; i++) if (fresh[i]) cells.push(i);
  if (!cells.length) return null;
  const N = cells.length, pos = new Int32Array(w * h);
  for (let k = 0; k < N; k++) pos[cells[k]] = k + 1;
  const at = (i) => (i >= 0 && i < w * h ? pos[i] - 1 : -1);
  // downstream: distance along the water from the sea, then each cell points to its lower neighbours
  const dist = new Int32Array(N).fill(-1), q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let k = 0; k < N; k++) {
    const i = cells[k];
    for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && !fresh[j] && v[j] < 250) { dist[k] = 0; q[qt++] = k; break; }
  }
  const NB = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1], NX = [-1, 1, 0, 0, -1, 1, -1, 1], NY = [0, 0, -1, 1, -1, -1, 1, 1];
  while (qh < qt) {
    const k = q[qh++], i = cells[k], d = dist[k] + 1;
    for (const o of NB) { const m = at(i + o); if (m >= 0 && dist[m] < 0) { dist[m] = d; q[qt++] = m; } }
  }
  const dx = new Float32Array(N), dy = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (dist[k] < 0) continue;
    const i = cells[k]; let sx = 0, sy = 0;
    for (let t = 0; t < 8; t++) { const m = at(i + NB[t]); if (m < 0 || dist[m] < 0) continue; const dd = dist[k] - dist[m]; if (dd > 0) { const l = Math.hypot(NX[t], NY[t]); sx += NX[t] / l * dd; sy += NY[t] / l * dd; } }
    dx[k] = sx; dy[k] = sy;
  }
  // smoothed directions (5×5 along the water) and how open the water is around each cell (7×7: lakes)
  const rgba = new Uint8Array(w * h * 4);
  for (let k = 0; k < N; k++) {
    const i = cells[k], x = i % w, y = (i / w) | 0;
    let sx = 0, sy = 0, wide = 0;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx, m = pos[j] - 1;
      if (m < 0) continue;
      if (v[j] < 96) wide++;
      if (Math.abs(ox) <= 2 && Math.abs(oy) <= 2) { sx += dx[m]; sy += dy[m]; }
    }
    const l = Math.hypot(sx, sy) || 1;
    rgba[i * 4 + 1] = Math.round((sx / l * 0.5 + 0.5) * 255);
    rgba[i * 4 + 2] = Math.round((sy / l * 0.5 + 0.5) * 255);
    const c = Math.min(1, Math.max(0, (wide / 49 - 0.6) / 0.3));
    rgba[i * 4 + 3] = Math.round(c * c * (3 - 2 * c) * 255);
  }
  // how fresh: 1 on the river, fading over one cell into the land and sea around it
  for (let k = 0; k < N; k++) {
    const i = cells[k], x = i % w, y = (i / w) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 4;
      rgba[j] = Math.min(255, rgba[j] + 45);
      if (!fresh[yy * w + xx] && !rgba[j + 1] && !rgba[j + 2]) { rgba[j + 1] = rgba[i * 4 + 1]; rgba[j + 2] = rgba[i * 4 + 2]; rgba[j + 3] = rgba[i * 4 + 3]; }
    }
  }
  for (let i = 0; i < w * h; i++) if (fresh[i]) v[i] = 255;   // borders and the coast ignore rivers and lakes
  land.fresh = fresh;
  return { rgba };
}
if (CAN_EDIT) {
  restoreHandle(); offerDraft();
  if (imported && (imported.nations || imported.borders || imported.markers || imported.updates)) {
    unsaved = true;
    toast(`Added from the Wonderdraft map${imported.notes.length === 1 && /^Einartoft/.test(imported.notes[0]) ? ' of Einartoft' : 's'}: ${imported.markers} new places${imported.borders ? `, ${imported.borders} borders` : ''}${imported.nations ? `, ${imported.nations} nations` : ''}${imported.updates ? `, ${imported.updates} named or renamed` : ''}.${SERVER ? '' : ' They save to markers.js with your next save.'}`);
    if (SERVER) scheduleSave();   // on the server: saved straight away (once, by whichever admin opens the map first)
  }
}

// the wiki, the files and admin (when served by the server)
const siteName = (SERVER && SERVER.siteName) || 'Valanar';
let lastHash = location.hash;
const modCtx = {
  h, $, escHTML, natural, toast, wkey, slug, store, isTyping,
  pages: () => pages, findPage, wikiHref, wikiOnMap, indexPage: () => INDEX_PAGE, route,
  reload: () => fetch('/api/site/wiki', { credentials: 'same-origin' }).then(r => r.json()).then(j => { setPages(j.pages || []); }),
  allFolders: () => [...new Set([...(DRIVE ? DRIVE.folders() : []), ...pages.map(p => p.folders.join('/')).filter(Boolean)])],
  pickFile: o => DRIVE.pickFile(o), uploadFile: (f, folder) => DRIVE.upload(f, folder), fileByName: n => DRIVE && DRIVE.fileByName(n),
  renderMarkdown: md => WIKIUI.body(md, null).el,
  themePicker: () => themePicker(),
  ownerOf: f => ownerByFolder.get(f) || null, isOwner: isOwnerPage, folderHref, siteName,
  recent: () => recentList(), goToPlace: id => goToMarker(id)
};
modCtx.lore = window.ValanarLore ? window.ValanarLore(modCtx) : null;
const WIKIUI = SERVER && window.ValanarWiki ? window.ValanarWiki(modCtx) : null;
modCtx.folderIntro = p => WIKIUI ? WIKIUI.intro(p) : null;
const DRIVE = SERVER && window.ValanarDrive ? window.ValanarDrive(modCtx) : null;
const ADMIN = SERVER && SERVER.admin && window.ValanarAdmin ? window.ValanarAdmin(modCtx) : null;
// day and night, the weather, and the clock button (app/sky.js); the Calendar view (app/calendar.js)
var AMB = null, AGES = null, lastSky = null;
var TALES = null, WAYF = null, REACH = null, NAMES = null, PRESENCE = null, POSTCARD = null, ARMSHOP = null, HERALD = window.ValanarHeraldry || null;
const SKY = SERVER && window.ValanarSky && window.WorldCalendar ? window.ValanarSky(Object.assign({}, modCtx, { map, L, NATIVE, toPixel, toLatLng, size: { w: INFO.width, h: INFO.height }, embedded: EMBED, scene: SCENE, isMapView: () => view === 'map', nightStrength: () => (MT ? +MT.look().sky.night : 1),
  climateAt: () => climateLookup(),
  onSky: s => { lastSky = s; if (AMB) AMB.sky(s); if (AGES) AGES.year(); },
  onStrike: s => { if (AMB) AMB.thunder(s); },
  aurora: () => { const lf = MT ? MT.look().life : null; if (!lf || lf.aurora === false || lf.cold === 'none') return 0; return lf.cold === 'south' ? -1 : 1; },
  onCalendar: c => { if (!CALVIEW) return; const jump = (c.campaign || '') !== (onCalendarLast || ''); onCalendarLast = c.campaign || ''; CALVIEW.refresh(jump); } })) : null;
var onCalendarLast = '';
// life on the map (app/ambience.js): town lights, ships and birds, the seasons, the framing, the party's journeys
AMB = window.ValanarAmbience ? window.ValanarAmbience({ map, L, NATIVE, toLatLng, toPixel, Land, size: { w: INFO.width, h: INFO.height },
  data: () => data, typeOf, look: () => (MT ? MT.look() : {}), climateAt: () => climateLookup(), climateSig: () => data.nations.map(n => n.climate || '').join(','),
  seaPath: MT && MT.seaPath, isMapView: () => view === 'map', milesPerPx: () => +data.settings.milesPerPx || 0,
  unit: () => (MT ? MT.unit() : [1, 'miles', 'mi']), showAll: () => map.fitBounds(restrictBox || bounds),
  weatherAt: (x, y) => (SKY ? SKY.weatherAt(x, y) : null), embedded: EMBED, hasPage: n => !!findPage(n), arms: n => armsSvg(n, 60),
  // the nation at a point (the borders are worked out once if they aren't showing)
  nationAt: (x, y) => { if ((!pol || pol.sig !== polSignature()) && Land.ready) { try { computePolitical(); } catch (e) { return null; } } return nationAt(x, y); } }) : null;
if (AMB && lastSky) AMB.sky(lastSky);

// ── Through the ages (the main map): a slider through the versions of the map that have a year (Admin: set the years
// here), stepping the places, borders and names back in time; "Now" is the main map. Nothing is saved while looking.
AGES = SERVER && !ATLAS && !SCENE ? (() => {
  let list = [], cache = new Map(), at = -1, open = false, shown = false;
  // a card beside the tool column, opened from its hourglass; while another age is on show, a pill over the map says so
  const el = h('div', { id: 'ages', class: 'ages', hidden: true });
  const pill = h('div', { id: 'agepill', class: 'agepill', hidden: true });
  map.getContainer().append(el, pill);
  for (const x of [el, pill]) { L.DomEvent.disableClickPropagation(x); L.DomEvent.disableScrollPropagation(x); }
  const btn = $('#agesToggle');
  const toggle = on => { shown = on == null ? !shown : on; draw(); };
  if (btn) btn.addEventListener('click', () => toggle());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && shown && !isTyping()) toggle(false); });
  const nowYear = () => { try { const c = SKY && SKY.calendar; return c ? window.WorldCalendar.date(c.cal, c.t).year : null; } catch (e) { return null; } };
  const yearText = y => { try { const c = SKY && SKY.calendar; return c && window.WorldCalendar.yearLabel ? window.WorldCalendar.yearLabel(c.cal, y) : String(y); } catch (e) { return String(y); } };
  const steps = () => list.filter(a => a.year != null).sort((a, b) => a.year - b.year).map(a => ({ id: a.id, year: a.year, name: a.name }))
    .concat([{ id: null, year: nowYear(), name: 'Now' }]);
  async function go(i) {
    const st = steps(), s = st[i]; if (!s) return;
    at = i;
    const panes = ['political', 'borders', 'markerPane', 'labels'].map(n => map.getPane(n)).filter(Boolean);
    for (const p of panes) { p.style.transition = 'opacity .22s'; p.style.opacity = 0.15; }
    try {
      if (s.id) {
        let d = cache.get(s.id);
        if (!d) { const r = await fetch('/api/site/atlases/' + s.id + '/world', { credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); d = j.data; cache.set(s.id, d); }
        if (at !== i) return;
        if (editMode) setEditMode(false);
        if (!eraId) mainData = data;
        eraId = s.id; data = normalise(JSON.parse(JSON.stringify(d)));
      } else if (eraId) { data = mainData; mainData = null; eraId = null; }
      if (selectedId && !findAny(selectedId)) { selectedId = null; if (panelMode === 'marker') panelMode = null; }
      if (activeNation && !findNation(activeNation)) activeNation = null;
      document.body.classList.toggle('era-view', !!eraId);
      syncMarkers(); syncPolitical(); if (MT) MT.sync(); if (ARMY) ARMY.sync(); if (AMB) AMB.refresh(); renderPanel(); renderEditBar(); renderBanner(); drawReadout();
    } catch (e) { toast('Couldn’t load that age: ' + (e.message || e), true); }
    setTimeout(() => { for (const p of panes) p.style.opacity = ''; applyPolAlpha(); }, 30);
    draw();
  }
  function draw() {
    const st = steps(), canEdit = SERVER.admin;
    const avail = st.length > 1 || (canEdit && list.length);
    if (btn) { btn.hidden = !avail; btn.classList.toggle('on', shown || !!eraId); }
    pill.hidden = !eraId;
    if (eraId) { const c0 = st[at] || {}; pill.replaceChildren(h('span', null, 'The map in ', h('b', null, `${c0.year != null ? yearText(c0.year) : ''} · ${c0.name || ''}`)), h('button', { onclick: () => go(st.length - 1) }, 'Back to now')); }
    el.hidden = !(avail && shown);
    if (el.hidden) return;
    if (btn) { const r = btn.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect(); el.style.top = Math.max(8, r.top - mr.top) + 'px'; }
    if (at < 0 || at >= st.length) at = st.length - 1;
    const cur = st[at];
    const yl = y => y == null ? '' : yearText(y);
    const rng = h('input', { type: 'range', min: 0, max: st.length - 1, step: 1, value: at, 'aria-label': 'Through the ages',
      oninput: e => { const s2 = st[+e.target.value]; lbl.textContent = s2.id ? `${yl(s2.year)} · ${s2.name}` : `Now${s2.year != null ? ' · ' + yl(s2.year) : ''}`; },
      onchange: e => go(+e.target.value) });
    const lbl = h('b', null, cur.id ? `${yl(cur.year)} · ${cur.name}` : `Now${cur.year != null ? ' · ' + yl(cur.year) : ''}`);
    const ticks = h('div', { class: 'ageticks' }, ...st.map((s2, i) => h('button', { class: 'agetick' + (i === at ? ' on' : ''), style: `left:${st.length > 1 ? i / (st.length - 1) * 100 : 50}%`,
      title: s2.id ? `${yl(s2.year)}: ${s2.name}` : 'Now: the map as it is', onclick: () => go(i) }, h('span', null, s2.id ? String(s2.year) : 'Now'))));
    el.replaceChildren(...[
      h('div', { class: 'agehead' }, h('span', { class: 'agettl' }, 'Through the ages'), h('button', { class: 'ageclose', title: 'Close (Esc)', onclick: () => toggle(false) }, '×')),
      h('div', { class: 'agehead' }, lbl,
        eraId ? h('button', { class: 'agebtn', onclick: () => go(st.length - 1) }, 'Back to now') : null,
        canEdit ? h('button', { class: 'agebtn' + (open ? ' on' : ''), title: 'Which versions of the map are on the timeline, and their years', onclick: () => { open = !open; draw(); } }, open ? 'Done' : 'Years…') : null),
      st.length > 1 ? h('div', { class: 'agetrack' }, rng, ticks) : h('p', { class: 'agehint' }, 'Give a version of the map a year to put it on the timeline.'),
      open ? h('div', { class: 'ageedit' }, h('p', null, 'The versions of the map (made in the table, for a campaign’s time). Give one a year to put it on the timeline; clear it to take it off.'),
        ...list.map(a => h('label', { class: 'agerow' }, h('span', null, a.name), h('input', { type: 'number', placeholder: 'Year', value: a.year == null ? '' : a.year,
          onchange: async e => {
            try {
              const r = await fetch('/api/site/atlases/' + a.id, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: e.target.value === '' ? null : +e.target.value }) });
              const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
              const cid = (steps()[at] || {}).id; list = j.atlases || list; const ni = steps().findIndex(x => x.id === cid); at = ni >= 0 ? ni : steps().length - 1; draw();
            } catch (er) { toast('Couldn’t save the year: ' + (er.message || er), true); }
          } })))) : null].filter(Boolean));
  }
  fetch('/api/site/atlases', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { atlases: [] }).then(j => { list = j.atlases || []; at = -1; draw(); }).catch(() => {});
  let lastYear;
  return { draw, year: () => { const y = nowYear(); if (y !== lastYear) { lastYear = y; draw(); } } };
})() : null;
const CALVIEW = SKY && window.ValanarCalendar ? window.ValanarCalendar(Object.assign({}, modCtx, { sky: () => SKY, embedded: EMBED,
  // inside the table the calendar shows the campaign's date; closing it, or moving the clock, is the table's
  close: () => { if (EMBED) try { parent.postMessage({ t: 'calendarClose' }, location.origin); return; } catch (e) { /* not in the table */ } location.hash = '#/map'; },
  openClock: EMBED ? () => { try { parent.postMessage({ t: 'openClock' }, location.origin); } catch (e) { /* not in the table */ } } : null })) : null;
if (!CALVIEW) for (const b of document.querySelectorAll('#views [data-view="calendar"]')) b.remove();

// ── the map's games and shows: Tales and Drift (app/tales.js), How far in a day
// (app/reach.js), who else is here (app/presence.js); coats of arms (app/heraldry.js), the Name Forge (app/names.js)
// a nation's arms, saved (or, with none, back to the ones made up from its name)
function setArms(id, arms) { change(() => { const n = findNation(id); if (!n) return; if (arms && arms.field) n.arms = arms; else delete n.arms; }, { panel: panelMode === 'political' }); }
function armsOf(n) { return !n ? null : n.arms && n.arms.field ? n.arms : HERALD ? HERALD.make(n.name, n.color) : null; }
function armsSvg(n, size) { return HERALD && n ? HERALD.svg(armsOf(n), { size, label: `The arms of ${n.name}` }) : ''; }
const excerptOf = page => { try { return page && modCtx.lore ? modCtx.lore.index().excerpt(page) : ''; } catch (e) { return ''; } };
const nationAtLazy = (x, y) => { if ((!pol || pol.sig !== polSignature()) && Land.ready) { try { computePolitical(); } catch (e) { return null; } } return nationAt(x, y); };
// for Drift: the nations (the middle of their towns, framed to fit) and the places worth a look
function driftPlaces() {
  if ((!pol || pol.sig !== polSignature()) && Land.ready) { try { computePolitical(); } catch (e) { /* no land */ } }
  const out = [];
  const WORTH = { capital: 1, city: 1, 'free-city': 1, fortress: 1, temple: 1, landmark: 1, feature: 1, ruin: 1 };
  for (const m of data.markers) {
    if (m.unnamed || !m.name || /^unnamed$/i.test(m.name) || typeOf(m).text || !isFinite(m.x)) continue;
    const page = pageForMarker(m);
    if (!WORTH[m.type] && !page) continue;
    const nat = nationOfMarker(m);
    out.push({ key: 'm:' + m.id, x: m.x, y: m.y, z: 5 + Math.random() * 0.7, title: m.name, sub: [typeOf(m).label, nat].filter(Boolean).join(' · '), text: page ? excerptOf(page) : '' });
  }
  for (const n of data.nations) {
    const mine = data.markers.filter(m => !isPlace(m) && isFinite(m.x) && nationOfMarker(m) === n.name);
    if (mine.length < 3) continue;
    const xs = mine.map(m => m.x).sort((a, b) => a - b), ys = mine.map(m => m.y).sort((a, b) => a - b);
    const q = (a, f) => a[Math.floor(f * (a.length - 1))];
    const span = Math.max(q(xs, 0.9) - q(xs, 0.1), q(ys, 0.9) - q(ys, 0.1), 600);
    const page = pageForNation(n.name);
    out.push({ key: 'n:' + n.id, x: q(xs, 0.5), y: q(ys, 0.5), z: Math.max(2.4, Math.min(4.8, NATIVE - Math.log2(span / 700))), title: n.name, sub: 'The land of', text: page ? excerptOf(page) : '', arms: armsSvg(n, 64) });
  }
  return out;
}
const PLAY = Object.assign({}, modCtx, { map, L, NATIVE, INFO, toLatLng, toPixel, Land, bounds, tileURL: TILE_URL,
  data: () => data, typeOf, isPlace, nationOfMarker, pageForMarker, pageForNation, findPage, wikiHref,
  renderMarkdown: md => WIKIUI ? WIKIUI.body(md, null).el : h('p', null, md),
  panelShell, renderPanel, closePanel, openPanel: m => openPanel(m), panelMode: () => panelMode, registerPanel: (k, def) => { PANELS[k] = def; },
  showMap: () => { if (view !== 'map') { if (!/^#\/(map|tale|drift)/.test(location.hash)) history.pushState(null, '', '#/map'); showMap(); } },
  view: () => view, editMode: () => editMode, bordersOn: () => polOn,
  setBorders: on => { on = !!on; if (on !== polOn) { polOn = on; syncPolitical(); drawReadout(); } },
  sky: () => SKY, skyPreview: p => { if (SKY && SKY.preview) SKY.preview(p); },
  milesPerPx: () => +data.settings.milesPerPx || 0, distText: (mi, short) => (MT ? MT.distText(mi, short) : `${Math.round(mi)} mi`),
  seaColour: () => (MT ? MT.look().sea.mid : '#3d7272'), nationAt: nationAtLazy, arms: armsOf, armsSvg, driftPlaces,
  where: () => view === 'map' ? (() => { const c = toPixel(map.getCenter()), n = pol ? nationAt(c.x, c.y) : null; return n ? n.name : ''; })() : view === 'wiki' ? (wikiPage ? wikiPage.title : special || '') : view,
  taleState: () => (TALES ? TALES.state() : null), followTale: st => { if (TALES) TALES.follow(st); },
  playTale: (t, i, o) => { if (TALES) TALES.play(t, i, o); },
  // the weather as this screen shows it at a point; how wet and cold a place is (Borders › Climate; Map settings)
  weatherKind: (x, y) => (SKY && SKY.weatherKind ? SKY.weatherKind(x, y) : null),
  climateAt: (x, y) => { const fn = climateLookup(); return fn ? fn(x, y) : null; },
  coldPole: () => { const lf = MT ? MT.look().life : null; return (lf && lf.cold) || 'none'; },
  onTale: () => { if (PRESENCE) PRESENCE.look(); } });
if (window.ValanarNames) { NAMES = window.ValanarNames(PLAY); modCtx.names = NAMES; }
// a nation's coat of arms by its name (the wiki's folders and pages)
const nationNamed = name => data.nations.find(n => wkey(n.name) === wkey(name || ''));
modCtx.armsFor = name => { const n = nationNamed(name); return n ? armsSvg(n, 76) : ''; };
modCtx.blazonFor = name => { const n = nationNamed(name); return n && HERALD ? HERALD.blazon(armsOf(n)) : ''; };
if (window.ValanarTales && !SCENE) TALES = window.ValanarTales(PLAY);
if (window.ValanarReach && !SCENE) REACH = window.ValanarReach(PLAY);
if (window.ValanarPresence && SERVER && !EMBED && !SCENE) PRESENCE = window.ValanarPresence(PLAY);
if (window.ValanarPostcard && !SCENE) POSTCARD = window.ValanarPostcard(PLAY);
if (window.ValanarArmies && !SCENE) { ARMY = window.ValanarArmies(Object.assign({}, PLAY, { change, toPixel, rulerOn: () => rulerOn, rulerAdd, rulerStart, redrawRuler })); ARMY.sync(); }
if (window.ValanarArmsShop && HERALD && CAN_EDIT && !SCENE) ARMSHOP = window.ValanarArmsShop(Object.assign({}, PLAY, { armsOf, setArms }));
{ const b = $('#postcardToggle'); if (b) { if (!POSTCARD) b.remove(); else { b.hidden = false; b.addEventListener('click', () => { if (POSTCARD.active()) POSTCARD.close(); else { if (placing) stopPlacing(); POSTCARD.open(); } }); } } }
for (const [id, panel] of [['reachToggle', 'reach'], ['talesToggle', 'tales']]) { const b = $('#' + id); if (b) { if ((panel === 'reach' && !REACH) || (panel === 'tales' && !TALES)) { b.remove(); continue; } b.hidden = false; b.addEventListener('click', () => { if (placing) stopPlacing(); if (panelMode === 'political') cancelDraw(); openPanel(panel); }); } }
// ── things to do, by name: the search box finds them, and Ctrl+K lists them all
if (!SCENE) {
  const onMap = fn => () => { const was = view === 'map'; if (!was) { history.pushState(null, '', '#/map'); showMap(); } setTimeout(fn, was ? 0 : 80); };
  const icon = id => { const b = $('#' + id); const svg = b && b.querySelector('svg'); return svg ? svg.outerHTML : '›'; };
  const go = hash => () => { location.hash = hash; };
  const SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  const I = d => SV + d + '</svg>';
  if (REACH) {
    addAction({ label: 'Plan a journey', hint: 'The way from one place to another, day by day', keys: 'travel route road itinerary trip way to from', icon: icon('reachToggle'), run: onMap(() => REACH.openWay()) });
    addAction({ label: 'How far in a day', hint: 'Rings for each day’s travel from a place', keys: 'travel reach rings distance range', icon: icon('reachToggle'), run: onMap(() => REACH.openRings()) });
  }
  if (TALES) {
    addAction({ label: 'Tales', hint: 'Journeys across the map, told stop by stop', keys: 'stories story tour tours', icon: icon('talesToggle'), run: onMap(() => { if (panelMode !== 'tales') openPanel('tales'); }) });
    addAction({ label: 'Drift', hint: 'Let the map wander from place to place on its own', keys: 'screensaver ambient wander show wall', icon: I('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill="currentColor"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor"/>'), run: onMap(() => TALES.drift()) });
  }
  if (NAMES && WIKIUI) addAction({ label: 'The Name Forge', hint: 'Names for people, places and gods, in the world’s own style', keys: 'names generator npc', icon: I('<path d="M4 20l7-7M13.5 4.5l6 6-3 3-6-6z"/><path d="M9 9l-2-2M15 15l2 2"/>'), run: go('#/wiki/Special:Names') });
  addAction({ get label() { return polOn ? 'Hide the borders' : 'Show the borders'; }, hint: 'The nations and their borders', keys: 'borders nations political countries', icon: icon('polToggle'), key: 'B', run: onMap(() => $('#polToggle').click()) });
  if (ARMSHOP) addAction({ label: 'The Heraldry Workshop', hint: 'Every nation’s coat of arms, to change', keys: 'heraldry arms coat shield blazon crest sigil', icon: '⚜', run: () => ARMSHOP.open(activeNation) });
  if (POSTCARD) addAction({ label: 'A postcard', hint: 'The map as you see it, framed, to save or send', keys: 'postcard picture screenshot photo image save share print', icon: icon('postcardToggle'), run: onMap(() => POSTCARD.open()) });
  addAction({ label: 'Ruler', hint: 'Measure distances and travel time', keys: 'measure distance miles', icon: icon('rulerToggle'), key: 'R', run: onMap(() => setRuler(!rulerOn)) });
  addAction({ label: 'Through the ages', hint: 'The map at other times', keys: 'history timeline years era past', icon: icon('agesToggle'), when: () => { const b = $('#agesToggle'); return b && !b.hidden; }, run: onMap(() => $('#agesToggle').click()) });
  addAction({ label: 'Map settings', hint: 'The sea, the names, the icons, the night, life on the map, units', keys: 'look settings options sea labels night sound ships weather', icon: icon('lookToggle'), run: onMap(() => $('#lookToggle').click()) });
  addAction({ label: 'The whole world', hint: 'Zoom out to see all of the map', keys: 'zoom out fit everything', icon: I('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>'), run: onMap(() => map.flyToBounds(restrictBox || bounds, { duration: 0.9 })) });
  addAction({ label: 'Somewhere at random', hint: 'Fly to a place picked at random', keys: 'surprise random place explore', icon: I('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>'),
    run: () => { const pool = data.markers.filter(m => !m.unnamed && m.name && !typeOf(m).text && isFinite(m.x)); const m = pool[Math.floor(Math.random() * pool.length)]; if (m) goToMarker(m.id); } });
  addAction({ label: 'Full screen', hint: 'The page fills the screen (Esc to leave)', keys: 'fullscreen screen', icon: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), run: () => { const d = document; if (d.fullscreenElement) d.exitFullscreen().catch(() => {}); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {}); } });
  // (and the top bar's button: the whole page, map, wiki and all)
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) fsBtn.onclick = () => { const d = document; if (d.fullscreenElement) d.exitFullscreen().catch(() => {}); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {}); };
  if (CALVIEW) addAction({ label: 'The calendar', hint: 'The world’s date, months and events', keys: 'calendar date month festival events time', icon: I('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'), run: go('#/calendar') });
  if (WIKIUI) {
    addAction({ label: 'The wiki', hint: 'Every page of the world', keys: 'pages lore', icon: '¶', run: go('#/wiki') });
    addAction({ label: 'A page at random', hint: 'Read something you haven’t', keys: 'random page wiki read', icon: '¶', run: go('#/wiki/Special:Random') });
    addAction({ label: 'Recent changes', hint: 'What’s new in the wiki', keys: 'new changes recent edits', icon: '¶', run: go('#/wiki/Special:Recent') });
    addAction({ label: 'The Library', hint: 'The world’s own books and documents', keys: 'books library manuscripts', icon: '¶', run: go('#/library'), when: () => !!$('#views [data-view="library"]') });
    addAction({ label: 'The Observatory', hint: 'The constellations of the night sky', keys: 'stars constellations sky', icon: '✶', run: go('#/observatory'), when: () => !!$('#views [data-view="observatory"]') });
  }
  if (SERVER && SERVER.user) addAction({ label: 'The Table', hint: 'The battle-map table', keys: 'table vtt battle map play', icon: '⚔', run: () => { location.href = $('#tableLink').href; } });
  if (CAN_EDIT) addAction({ get label() { return editMode ? 'Stop editing the map' : 'Edit the map'; }, hint: 'Place, move and change icons and borders', keys: 'edit editor', key: 'E', icon: I('<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'), run: onMap(() => setEditMode(!editMode)) });
  if (PRESENCE && SERVER && SERVER.admin) {
  }
}
if (SERVER) {
  document.title = siteName;
  for (const b of document.querySelectorAll('.brand')) { b.textContent = siteName; b.title = siteName; }
  const wb = $('#views button[data-view="wiki"]'); if (wb) wb.title = `Every page of ${siteName}`;
  if (!ADMIN) for (const b of document.querySelectorAll('#views [data-view="admin"]')) b.remove();
  if (!DRIVE) for (const b of document.querySelectorAll('#views [data-view="files"]')) b.remove();
  if (!SERVER.user && SERVER.private) { const t = $('#tableLink'); if (t) t.hidden = true; }
  if (!SERVER.user) { const t = $('#tableLink'); if (t) t.title = 'The battle-map table: watch the game (log in to play)'; }
  // who's here, and logging in or out
  const me = $('#me');
  if (me) {
    if (SERVER.user) me.replaceChildren(h('span', { class: 'who', title: SERVER.admin ? 'Admin' : 'Player' }, SERVER.user.name, SERVER.admin ? h('span', { class: 'role' }, 'admin') : null),
      h('button', { class: 'tool', onclick: () => fetch('/api/logout', { method: 'POST' }).then(() => location.reload()) }, 'Log out'));
    else me.replaceChildren(h('a', { class: 'tool', href: '/table/login.html?next=' + encodeURIComponent('/' + location.hash) }, 'Log in'));
  }
  // the drive's list (for picture names and the folder view): straight away on the wiki, otherwise once the map is up
  if (DRIVE) {
    const later = window.requestIdleCallback || (f => setTimeout(f, 1200));
    if (/^#\/(wiki|files)/.test(location.hash)) DRIVE.load().catch(() => {});
    else later(() => DRIVE.load().catch(() => {}), { timeout: 2500 });
  }
} else for (const b of document.querySelectorAll('#views [data-view="files"], #views [data-view="admin"]')) b.remove();

// for testing and the console
route();

window.valanarMap = { syncMarkers, amb: AMB, play: { TALES, WAYF, REACH, NAMES, PRESENCE, POSTCARD }, map, wiki: { get pages() { return pages; }, findPage, showWiki, get page() { return wikiPage; } }, get data() { return data; }, get pol() { return pol; }, Land, toLatLng, toPixel, setEditMode, connectFolder, saveNow, serialise, computePolitical, openPanel };
// The table (this page inside it) works the map from outside: edit mode and the party's tokens.
window.VALANAR = { get ambience() { return AMB; }, canEdit: CAN_EDIT, setEditMode: on => { if (CAN_EDIT) setEditMode(!!on); }, get editMode() { return editMode; }, map, toLatLng, toPixel, dragRuler,
  atlas: ATLAS, size: { w: INFO.width, h: INFO.height }, native: NATIVE, setFogTest: fn => { fogTest = fn || null; applyVisibility(); },
  setRuler: on => { if (!!on !== rulerOn) setRuler(!!on); },
  // keep the view to a box of the map ({ x0, y0, x1, y1 } in map pixels), or let it go again (null)
  restrict: box => {
    restrictBox = box ? L.latLngBounds(toLatLng(box.x0, box.y1), toLatLng(box.x1, box.y0)) : null;
    if (restrictBox) { fitMin(); map.setMaxBounds(restrictBox.pad(0.12)); if (!restrictBox.pad(0.12).contains(map.getCenter())) map.fitBounds(restrictBox, { animate: false }); }
    else applyView(viewOpts);
  },
  // look at a point (closely), or at a box, or the whole map
  focus: (x, y, box, anim) => {
    const o = { animate: !!anim };
    if (x != null) map.setView(toLatLng(x, y), Math.max(map.getMinZoom(), Math.min(NATIVE - 1.5, map.getMaxZoom())), o);
    else if (box) map.fitBounds(L.latLngBounds(toLatLng(box.x0, box.y1), toLatLng(box.x1, box.y0)), Object.assign({ padding: [30, 30] }, o));
    else map.fitBounds(restrictBox || bounds, o);
  },
  setCalendar: c => SKY && SKY.push(c), siteClock: () => SKY && SKY.siteClock(),
  // the party's journeys on a world map scene: [{ id, name, color, pts: [{ x, y, label }] }]
  setJourneys: list => AMB && AMB.setJourneys(list), focusJourney: id => AMB && AMB.focusJourney(id) };
if (EMBED) try { parent.postMessage({ t: 'mapReady', canEdit: CAN_EDIT, atlas: ATLAS ? ATLAS.id : null }, location.origin); } catch (e) { /* not in the table */ }
window.VALANAR_STARTED = true;   // (index.html says so if the page never gets here)
})();
