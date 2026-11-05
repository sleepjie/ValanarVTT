/* The art tool (A, GM): scenery and objects on the map.
 *  - the art library: pictures shared by all your campaigns (server: /api/art, files in vtt-data/library/art).
 *    Upload them here or drop them on the map; drag one onto the map (or click it) to place it.
 *  - a placed picture is a prop: a token with { prop, w, h } (squares, any size), under the creatures,
 *    turned and stretched with the handles on it (select it with the arrow or this tool).
 *    It can block light and sight (blocks), and it can be a container: a chest, a barrel, a crate.
 *  - containers hold item cards: put in by hand, or rolled from a loot table (a preset or one of your own),
 *    now or the first time someone opens it. Players click a container to look inside and take things.
 *  - loot tables: the presets made from the SRD items, and your own (Loot tables… in the panel). */
'use strict';
(function () {
const { $, h, state, on } = V;
const ART = 'text/x-vtt-art';
V.artDragType = ART;
let lib = null, libP = null, query = '', folder = '';
const load = (force) => (!force && libP) || (libP = V.api('/api/art').then(r => { lib = r.art || []; draw(); return lib; }).catch(e => { libP = null; V.toast(e.message, true); return []; }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
// how many of a picture's pixels make a square: the map's own grid by default
const ppsSetting = () => store.get('vtt.artPPS') || 'map';
const pps = () => { const v = ppsSetting(); return v === 'map' ? (V.grid().size || 70) : +v || 70; };

// ───────── placing ─────────
function sizeOf(a) {
  if (a.sw && a.sh) return [a.sw, a.sh];
  if (a.pw && a.ph) { const k = pps(); return [Math.min(40, Math.max(0.25, Math.round(a.pw / k * 4) / 4)), Math.min(40, Math.max(0.25, Math.round(a.ph / k * 4) / 4))]; }
  return [1, 1];
}
V.artLibraryList = () => lib || [];
V.loadArtLibrary = () => load();
V.placeArt = async function (a, x, y) {
  if (!state.scene) return V.toast('Make a scene first', true);
  const [w, hh] = sizeOf(a);
  const tok = { name: a.name, img: a.url, prop: true, w, h: hh, size: Math.max(1, Math.round(Math.min(w, hh))), layer: state.layer, nameShown: false, ring: false, blocks: !!a.blocks };
  if (a.container) tok.container = { items: [] };
  [tok.x, tok.y] = V.propSnap(tok, x, y);
  const r = await V.op({ t: 'token.create', scene: state.scene.id, token: tok }).catch(() => null);
  if (r && r.op && r.op.token) V.setSel([r.op.token.id]);
  return r;
};
async function upload(file, into) {
  const sz = await V.imageSize(file).catch(() => ({ w: 0, h: 0 }));
  if (sz.url) URL.revokeObjectURL(sz.url);
  const q = new URLSearchParams({ name: file.name || 'art', folder: into || '', w: sz.w || 0, h: sz.h || 0 });
  const r = await fetch('/api/art/upload?' + q, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Upload failed');
  (lib = lib || []).push(j.art); draw();
  return j.art;
}
async function uploadAll(files, into) {
  const out = [];
  for (const f of files) { try { out.push(await upload(f, into)); } catch (e) { V.toast(`${f.name}: ${e.message}`, true); } }
  if (out.length) V.toast(out.length === 1 ? `${out[0].name} is in the art library` : `${out.length} pictures are in the art library`);
  return out;
}
// pictures dropped on the map: with the art tool, scenery; otherwise ask
V.dropImages = function (files, p, cx, cy) {
  const asArt = async () => { const got = await uploadAll(files, folder); let i = 0; for (const a of got) { const [w] = sizeOf(a); await V.placeArt(a, p.x + i * (w + 0.5) * (V.grid().size || 70), p.y); i++; } };
  if (state.tool === 'art') return asArt();
  document.querySelectorAll('.dropask').forEach(x => x.remove());
  const n = files.length, close = () => box.remove();
  const box = h('div', { class: 'dropask', style: `left:${Math.min(cx, innerWidth - 250)}px;top:${Math.min(cy, innerHeight - 120)}px` },
    h('div', { class: 'small muted' }, n === 1 ? 'Put this picture on the map as…' : `Put these ${n} pictures on the map as…`),
    h('button', { class: 'btn sm primary', onclick: () => { close(); V.imagesAsTokens(files, p); } }, n === 1 ? 'A token' : 'Tokens', h('span', { class: 'muted' }, ' · a creature, one square')),
    h('button', { class: 'btn sm', onclick: () => { close(); asArt(); } }, 'Scenery', h('span', { class: 'muted' }, ' · its own size, kept in the art library')),
    h('button', { class: 'btn sm', onclick: close }, 'Cancel'));
  document.body.append(box);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!box.contains(e.target)) { close(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
};

// ───────── the library panel (on the left, while the tool is on) ─────────
let panel = null;
function ensurePanel() {
  if (panel) return panel;
  panel = h('div', { id: 'artpanel', hidden: true });
  $('#app').append(panel);
  panel.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); panel.classList.add('over'); } });
  panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('over'); });
  panel.addEventListener('drop', e => {
    panel.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation(); uploadAll(files, folder);
  });
  return panel;
}
function draw() {
  if (!panel || panel.hidden) return;
  const all = lib || [];
  const folders = [...new Set(all.map(a => a.folder).filter(Boolean))].sort();
  if (folder && !folders.includes(folder)) folders.push(folder);
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onchange: () => { uploadAll([...fileIn.files], folder); fileIn.value = ''; } });
  const search = h('input', { type: 'text', placeholder: 'Search the art…', value: query, oninput: e => { query = e.target.value; drawGrid(); } });
  const fsel = h('select', { title: 'Folder', onchange: e => { if (e.target.value === '\u0001') { const n = prompt('A new folder’s name'); folder = n ? n.trim() : folder; } else folder = e.target.value; draw(); } },
    h('option', { value: '' }, 'All folders'), ...folders.map(f => h('option', { value: f, selected: f === folder || null }, f)), h('option', { value: '\u0001' }, 'New folder…'));
  const grid = h('div', { class: 'apgrid' });
  const ppsSel = h('select', { title: 'How many of a picture’s pixels make one square, for its size when placed', onchange: e => { store.set('vtt.artPPS', e.target.value); } },
    ...[['map', `${Math.round(V.grid().size || 70)} px a square (the map’s)`], ...['50', '70', '100', '140', '200', '256', '300'].map(v => [v, v + ' px a square'])].map(([v, l]) => h('option', { value: v, selected: ppsSetting() === v || null }, l)));
  function drawGrid() {
    const q2 = query.trim().toLowerCase();
    const list = all.filter(a => (!folder || a.folder === folder) && (!q2 || a.name.toLowerCase().includes(q2) || (a.folder || '').toLowerCase().includes(q2)));
    grid.replaceChildren(...list.map(tile));
    if (!list.length) grid.append(h('p', { class: 'muted small apempty' }, all.length ? 'Nothing matches.' : 'No art yet. Drop pictures here or on the map, or Upload: furniture, chests, trees, carts, rubble. PNGs with see-through backgrounds work best.'));
  }
  panel.replaceChildren(
    h('div', { class: 'aph' }, h('b', null, 'Art'), h('span', { class: 'muted small' }, `${all.length || ''}`), h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', title: 'Loot tables for chests and other containers', onclick: () => V.openLootTables() }, 'Loot tables…'),
      h('button', { class: 'apx', title: 'Close (V)', onclick: () => V.setTool('select') }, '×')),
    h('div', { class: 'apbar' }, search, fsel),
    grid,
    h('div', { class: 'apfoot' },
      h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => fileIn.click() }, 'Upload…'), fileIn, h('div', { class: 'grow' }),
        ppsSel),
      h('p', { class: 'muted small' }, 'Drag a picture onto the map, or click it to put it in the middle. Select a placed one to stretch it (corner), turn it (knob), or set it to block light or hold loot (double-click). The library is shared by all your campaigns.')));
  drawGrid();
}
function tile(a) {
  const t = h('div', { class: 'aptile', draggable: 'true', title: `${a.name}${a.folder ? ' · ' + a.folder : ''}\nDrag onto the map, or click to put it in the middle` + (a.blocks ? '\nBlocks light and sight' : '') + (a.container ? '\nA container' : '') },
    h('div', { class: 'apimg' }, h('img', { src: a.url, alt: '', loading: 'lazy', draggable: 'false' })),
    h('span', null, a.name),
    h('div', { class: 'apmarks' }, a.blocks ? h('i', { title: 'Blocks light and sight' }, '◼') : null, a.container ? h('i', { title: 'A container' }, '⛁') : null),
    h('div', { class: 'apacts' },
      h('button', { title: 'Name, folder, usual size…', onclick: e => { e.stopPropagation(); editArt(a); } }, '✎'),
      h('button', { title: 'Take it out of the library (pictures already on maps stay)', onclick: async e => {
        e.stopPropagation();
        if (!confirm(`Take “${a.name}” out of the art library? Anything already placed keeps it.`)) return;
        try { await V.api('/api/art/' + a.id, { method: 'DELETE' }); lib = lib.filter(x => x !== a); draw(); } catch (err) { V.toast(err.message, true); }
      } }, '×')));
  t.addEventListener('dragstart', e => { e.dataTransfer.setData(ART, JSON.stringify(a)); e.dataTransfer.setData('text/plain', a.name); e.dataTransfer.effectAllowed = 'copy'; });
  t.addEventListener('click', () => { const c = V.viewCenter(); V.placeArt(a, c.x, c.y); });
  return t;
}
function editArt(a) {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const folders = [...new Set((lib || []).map(x => x.folder).filter(Boolean))];
  const name = h('input', { value: a.name, style: 'width:100%' });
  const fol = h('input', { value: a.folder || '', list: 'artFolders', style: 'width:100%', placeholder: 'e.g. Furniture' });
  const [dw, dh] = sizeOf(Object.assign({}, a, { sw: 0, sh: 0 }));
  const sw = h('input', { type: 'number', min: 0.25, max: 400, step: 0.25, value: a.sw || '', placeholder: String(dw), style: 'width:100%' });
  const sh = h('input', { type: 'number', min: 0.25, max: 400, step: 0.25, value: a.sh || '', placeholder: String(dh), style: 'width:100%' });
  const blocks = h('input', { type: 'checkbox', checked: !!a.blocks });
  const cont = h('input', { type: 'checkbox', checked: !!a.container });
  const save = async () => {
    try {
      const r = await V.api('/api/art/' + a.id, { method: 'PATCH', body: { name: name.value, folder: fol.value, sw: +sw.value && +sh.value ? +sw.value : null, sh: +sw.value && +sh.value ? +sh.value : null, blocks: blocks.checked, container: cont.checked } });
      Object.assign(a, r.art); close(); draw();
    } catch (e) { V.toast(e.message, true); }
  };
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(440px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Art'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('div', { class: 'artedit' }, h('img', { src: a.url, alt: '' }),
        h('div', null, h('label', null, 'Name'), name, h('label', null, 'Folder'), fol, h('datalist', { id: 'artFolders' }, ...folders.map(f => h('option', { value: f }))))),
      h('label', null, 'Usual size in squares (blank: from the picture, ', a.pw ? `${a.pw}×${a.ph} px` : 'its size', ')'),
      h('div', { class: 'two' }, h('div', null, h('span', { class: 'small muted' }, 'Wide'), sw), h('div', null, h('span', { class: 'small muted' }, 'Deep'), sh)),
      h('label', { class: 'inline' }, blocks, 'Blocks light and sight when placed (walls of crates, a wagon, a tree trunk)'),
      h('label', { class: 'inline' }, cont, 'A container when placed (a chest, a barrel, a crate)')),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  modal.hidden = false;
}
on('tool', tool => {
  const on_ = tool === 'art' && V.isGM();
  if (on_) { ensurePanel(); panel.hidden = false; document.body.classList.add('artopen'); load(); draw(); }
  else if (panel) { panel.hidden = true; document.body.classList.remove('artopen'); }
});
on('scene', () => { if (state.tool === 'art' && V.inWorldScene && V.inWorldScene()) V.setTool('select'); else draw(); });
V.toolHandlers.art = {
  down() { if (state.sel.size) V.setSel([]); return false; },
  hud: () => 'Drag art onto the map · select a piece to stretch it (corner) or turn it (knob; Alt: freely) · double-click for its settings'
};

// ───────── a prop in the token panel: its size, whether it blocks light, what it holds ─────────
let presets = null, presetsP = null;
V.lootPresets = () => presetsP || (presetsP = V.send({ t: 'lootPresets' }).then(r => (presets = r.presets || [])).catch(e => { presetsP = null; throw e; }));
const tableName = id => { const t = (state.camp.lootTables || []).find(x => x.id === id) || (presets || []).find(x => x.id === id); return t ? t.name : id; };
const uidv = () => 'v' + Math.random().toString(36).slice(2, 12);
const clone = o => JSON.parse(JSON.stringify(o));
function itemPicker(onPick, placeholder) {
  V.loadItems && V.loadItems().catch(() => {});
  const inp = h('input', { type: 'text', placeholder: placeholder || 'Add an item…', style: 'width:100%' });
  const list = h('div', { class: 'ipick' });
  const drawList = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) return list.replaceChildren();
    const hits = V.allItems().filter(i => i.name.toLowerCase().includes(q)).sort((a, b) => (a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q)) || a.name.localeCompare(b.name)).slice(0, 8);
    list.replaceChildren(...hits.map(it => h('button', { type: 'button', class: 'r-' + String(it.rarity || 'mundane').replace(' ', '-'), onclick: () => { inp.value = ''; list.replaceChildren(); onPick(it); } },
      h('span', null, it.name), h('span', { class: 'muted small' }, it.type || it.kind || ''))));
    if (!hits.length) list.append(h('div', { class: 'muted small', style: 'padding:4px 6px' }, 'No item card by that name.'));
  };
  inp.oninput = drawList;
  inp.onkeydown = e => { if (e.key === 'Enter') { const b = list.querySelector('button'); if (b) b.click(); } };
  return h('div', { class: 'ipickw' }, inp, list);
}
V.itemPicker = itemPicker;

V.tokenPanelProp = function (t, set) {
  if (!V.isGM()) return null;
  if (!t.prop) return h('label', { class: 'inline', title: 'Scenery: any width and height, no ring, under the creatures; it can block light or hold loot' },
    h('input', { type: 'checkbox', onchange: () => set({ prop: true, w: t.size || 1, h: t.size || 1, ring: false }) }), 'Scenery or an object, not a creature');
  const num = (label, key, v, title) => h('div', null, h('label', null, label), h('input', { type: 'number', min: 0.05, max: 400, step: 0.25, value: v, title, style: 'width:100%',
    onchange: e => { const x = +e.target.value; if (!(x > 0)) return; const p = { [key]: x }; if (lock.checked) { const k = x / v; p[key === 'w' ? 'h' : 'w'] = Math.round((key === 'w' ? (t.h || 1) : (t.w || 1)) * k * 1000) / 1000; } set(p); } }));
  const lock = h('input', { type: 'checkbox', checked: true });
  const natural = async () => {   // the picture's own shape (and size, from its pixels)
    if (!t.img) return;
    const img = new Image(); img.src = t.img;
    try { await img.decode(); } catch (e) { return V.toast('Couldn’t read the picture', true); }
    const k = pps(); set({ w: Math.max(0.25, Math.round(img.naturalWidth / k * 4) / 4), h: Math.max(0.25, Math.round(img.naturalHeight / k * 4) / 4) });
  };
  return h('div', { class: 'propbox' },
    h('div', { class: 'three' },
      num('Wide (squares)', 'w', t.w || t.size || 1, 'Its width in squares (or drag the corner handle on the map)'),
      num('Deep (squares)', 'h', t.h || t.size || 1, 'Its depth in squares'),
      h('div', null, h('label', null, 'Turned'), h('input', { type: 'number', min: -180, max: 180, step: 15, value: Math.round(t.rot || 0), style: 'width:100%', title: 'Degrees (or drag the knob above it on the map)', onchange: e => set({ rot: +e.target.value || 0 }) }))),
    h('div', { class: 'row' },
      h('label', { class: 'inline', style: 'margin:0' }, lock, 'Keep its shape'),
      h('div', { class: 'grow' }),
      t.img ? h('button', { class: 'btn sm', title: `Its picture’s own size and shape (${ppsSetting() === 'map' ? 'the map’s' : ppsSetting()} pixels a square)`, onclick: natural }, 'Picture’s size') : null,
      h('button', { class: 'btn sm', title: 'Mirror it', onclick: () => set({ flip: !t.flip }) }, 'Flip')),
    h('label', { class: 'inline', title: 'Light and sight stop at its edges, like walls (movement isn’t stopped)' }, h('input', { type: 'checkbox', checked: !!t.blocks, onchange: e => set({ blocks: e.target.checked }) }), 'Blocks light and sight'),
    h('label', { class: 'inline', title: 'On: it sits on the squares and sizes in quarter squares. Off: it goes exactly where it’s put, any size (hold Alt for a one-off)' }, h('input', { type: 'checkbox', checked: t.snap !== false, onchange: e => set({ snap: e.target.checked ? null : false }) }), 'Snap to grid'),
    h('label', { class: 'inline', title: 'Crisp edges for pixel art' }, h('input', { type: 'checkbox', checked: !!t.pixel, onchange: e => set({ pixel: e.target.checked }) }), 'Pixel art'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!t.container, onchange: e => set({ container: e.target.checked ? { items: [] } : null }) }), 'A container (players can look inside and take things)'),
    t.container ? containerBox(t, set) : null,
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', onchange: () => set({ prop: false, w: null, h: null, blocks: false }) }), 'Make it a creature token again'));
};
function containerBox(t, set) {
  const c = t.container, items = c.items || [];
  const put = patch => set({ container: Object.assign(clone(c), patch) });
  const add = (it, qty) => {
    const list = clone(items), same = list.find(e => e.item.id === it.id && e.item.name === it.name);
    if (same) same.qty += qty || 1; else list.push({ uid: uidv(), item: it, qty: qty || 1 });
    put({ items: list });
  };
  const sel = h('select', { style: 'width:100%', onchange: e => put({ table: e.target.value || null, rolled: false }) }, h('option', { value: '' }, 'By hand only'));
  const fillSel = () => {
    const own = state.camp.lootTables || [];
    sel.replaceChildren(h('option', { value: '' }, 'By hand only'),
      own.length ? h('optgroup', { label: 'Your loot tables' }, ...own.map(x => h('option', { value: x.id, selected: c.table === x.id || null }, x.name))) : null,
      h('optgroup', { label: 'Presets' }, ...(presets || []).map(x => h('option', { value: x.id, selected: c.table === x.id || null }, x.name))));
    if (c.table && ![...sel.options].some(o => o.value === c.table)) sel.append(h('option', { value: c.table, selected: true }, tableName(c.table)));
  };
  fillSel(); if (!presets) V.lootPresets().then(fillSel).catch(() => {});
  const rows = h('div', { class: 'crows' }, ...items.map(e => h('div', { class: 'crow' },
    h('span', { class: 'cname', title: 'Its card', onclick: () => V.showItemCard(e.item) }, e.item.name),
    h('button', { title: 'One fewer', onclick: () => put({ items: e.qty > 1 ? items.map(x => x.uid === e.uid ? Object.assign({}, x, { qty: x.qty - 1 }) : x) : items.filter(x => x.uid !== e.uid) }) }, '−'),
    h('b', null, '×' + e.qty),
    h('button', { title: 'One more', onclick: () => put({ items: items.map(x => x.uid === e.uid ? Object.assign({}, x, { qty: x.qty + 1 }) : x) }) }, '+'),
    h('button', { title: 'Take it out', class: 'cx', onclick: () => put({ items: items.filter(x => x.uid !== e.uid) }) }, '×'))));
  const box = h('div', { class: 'contbox' },
    h('label', null, 'Inside'),
    items.length ? rows : h('p', { class: 'muted small', style: 'margin:2px 0 6px' }, c.table && !c.rolled ? 'Nothing yet: it rolls its loot table when someone first opens it.' : 'Empty.'),
    itemPicker(it => add(it, 1), 'Put an item in… (or drop a card here)'),
    h('label', null, 'Loot table'), sel,
    c.table ? h('div', { class: 'row', style: 'margin-top:6px' },
      h('span', { class: 'muted small grow' }, c.rolled ? 'Rolled.' : 'Rolls when first opened.'),
      h('button', { class: 'btn sm', title: 'Roll the table now and add what it gives', onclick: () => V.op({ t: 'container.roll', scene: state.scene.id, id: t.id }) }, 'Roll now'),
      items.length ? h('button', { class: 'btn sm', title: 'Empty it, then roll again', onclick: () => V.op({ t: 'batch', ops: [{ t: 'token.update', scene: state.scene.id, id: t.id, patch: { container: Object.assign(clone(c), { items: [], rolled: false }) } }, { t: 'container.roll', scene: state.scene.id, id: t.id }] }) }, 'Re-roll') : null) : null,
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!c.locked, onchange: e => put({ locked: e.target.checked }) }), 'Locked (players can’t open it until you unlock it)'),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'btn sm', onclick: () => V.openContainer(t.id) }, 'Look inside'),
      h('button', { class: 'btn sm', onclick: () => V.openLootTables(c.table && !/^preset/.test(c.table) ? c.table : null) }, 'Loot tables…')));
  // item cards dropped on it go in
  box.addEventListener('dragover', e => { if (e.dataTransfer.types.includes(V.itemDragType)) { e.preventDefault(); box.classList.add('itemdrop'); } });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) box.classList.remove('itemdrop'); });
  box.addEventListener('drop', e => {
    box.classList.remove('itemdrop');
    let d = null; try { d = JSON.parse(e.dataTransfer.getData(V.itemDragType)); } catch (err) {}
    if (!d || !d.item) return;
    e.preventDefault(); e.stopPropagation(); add(d.item, 1);
  });
  return box;
}

// ───────── looking inside a container ─────────
const openBoxes = new Map();   // token id → panel
V.openContainer = async function (id) {
  const t = state.scene && state.scene.tokens.get(id); if (!t) return;
  let p = openBoxes.get(id);
  if (!p) {
    p = h('div', { class: 'panel invpanel chestpanel' });
    $('#panels').append(p); openBoxes.set(id, p);
    const [sx, sy] = V.screenOf(t.x, t.y), r = $('#panels').getBoundingClientRect();
    p.style.left = V.clamp(sx - r.left + 40, 10, Math.max(10, r.width - 470)) + 'px'; p.style.top = V.clamp(sy - r.top - 100, 10, Math.max(10, r.height - 300)) + 'px';
  }
  await fillBox(p, id);
};
function closeBox(id) { const p = openBoxes.get(id); if (p) { p.remove(); openBoxes.delete(id); } }
async function fillBox(p, id) {
  const t = state.scene && state.scene.tokens.get(id); if (!t) return closeBox(id);
  let r;
  try { r = await V.send({ t: 'containerOpen', scene: state.scene.id, id }); } catch (e) { closeBox(id); return V.toast(e.message, true); }
  const name = r.name || t.name || 'A container';
  const head = h('div', { class: 'ph' }, h('b', null, name), r.locked ? h('span', { class: 'muted small' }, 'locked') : null, h('button', { title: 'Close', onclick: () => closeBox(id) }, '×'));
  V.dragPanel(p, head);
  const chars = V.myChars();
  const take = (e, c, qty) => V.op({ t: 'inv.add', char: c.id, fromContainer: { scene: state.scene.id, id, uid: e.uid }, qty: qty || e.qty }).then(() => V.toast(`${e.qty > 1 && !qty ? e.qty + ' × ' : ''}${e.item.name} → ${c.name}`)).catch(() => {});
  // one character: a plain button; several: pick whose bag
  const taker = (label, fn) => chars.length === 1 ? h('button', { class: 'btn sm primary', title: `Into ${chars[0].name}’s inventory`, onclick: () => fn(chars[0]) }, label) : V.pickMenu(label + '…', chars, fn);
  const hand = h('div', { class: 'hand' }, ...r.items.map(e => h('div', { class: 'chestcard' },
    V.cardEl(e.item, { mini: true, qty: e.qty, onclick: () => V.showItemCard(e.item) }),
    chars.length ? taker('Take', c => take(e, c)) : null)));
  const all = chars.length && r.items.length > 1 ? taker('Take everything', async c => { for (const e of r.items) await take(e, c); }) : null;
  p.replaceChildren(head, h('div', { class: 'pb' },
    r.items.length ? hand : h('p', { class: 'muted', style: 'padding:10px' }, 'Empty.'),
    all ? h('div', { class: 'row', style: 'padding:0 4px 8px' }, h('div', { class: 'grow' }), all) : null,
    !chars.length && r.items.length ? h('p', { class: 'muted small', style: 'padding:0 6px 8px' }, 'You have no character here to take things.') : null));
}
on('tokens', d => {
  for (const id of d.rm || []) closeBox(id);
  for (const t of d.up || []) { const p = openBoxes.get(t.id); if (p) fillBox(p, t.id); }
});
on('scene', () => { for (const id of [...openBoxes.keys()]) closeBox(id); });

// ───────── loot tables ─────────
V.openLootTables = async function (pick) {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  try { await V.lootPresets(); } catch (e) { return V.toast(e.message, true); }
  await (V.loadItems ? V.loadItems().catch(() => {}) : null);
  let tables = clone(state.camp.lootTables || []), cur = pick || (tables[0] && tables[0].id) || (presets[0] && presets[0].id), dirty = false;
  const find = id => tables.find(x => x.id === id) || presets.find(x => x.id === id);
  const itemOf = e => e.item || V.itemById(e.ref) || { name: e.ref, id: e.ref };
  const side = h('div', { class: 'ltside' }), main = h('div', { class: 'ltmain' });
  const status = h('span', { class: 'muted small' });
  const save = async () => { try { await V.op({ t: 'loot.set', tables }); dirty = false; status.textContent = 'Saved.'; tables = clone(state.camp.lootTables || tables); drawSide(); } catch (e) {} };
  const touch = () => { dirty = true; status.textContent = 'Not saved yet.'; };
  function drawSide() {
    const b = x => h('button', { class: x.id === cur ? 'on' : null, onclick: () => { cur = x.id; drawSide(); drawMain(); } }, x.name);
    side.replaceChildren(
      h('div', { class: 'lthead' }, 'Yours'), ...tables.map(b),
      h('button', { class: 'ltnew', onclick: () => { const t = { id: 'l' + Math.random().toString(36).slice(2, 10), name: 'New loot table', picks: '1d4', entries: [], coins: {} }; tables.push(t); cur = t.id; touch(); drawSide(); drawMain(); } }, '+ New table'),
      h('div', { class: 'lthead' }, 'Presets'), ...presets.map(b));
  }
  function drawMain() {
    const tb = find(cur);
    if (!tb) return main.replaceChildren(h('p', { class: 'muted' }, 'Pick a table, or make one.'));
    const total = (tb.entries || []).reduce((s, e) => s + (+e.w || 0), 0) || 1;
    const pct = e => `${Math.round((+e.w || 0) / total * 1000) / 10}%`;
    const coins = h('div', { class: 'ltcoins' }, ...['cp', 'sp', 'ep', 'gp', 'pp'].map(k => h('label', null, k,
      h('input', { value: (tb.coins || {})[k] || '', placeholder: '—', disabled: tb.preset || null, title: `${k} to add: a number or dice (2d10)`, onchange: e => { tb.coins = tb.coins || {}; if (e.target.value.trim()) tb.coins[k] = e.target.value.trim(); else delete tb.coins[k]; touch(); } }))));
    if (tb.preset) {
      const list = (tb.entries || []).slice().sort((a, b) => itemOf(a).name.localeCompare(itemOf(b).name));
      return main.replaceChildren(
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, tb.name),
          h('button', { class: 'btn sm primary', onclick: () => { const t = clone(tb); delete t.preset; t.id = 'l' + Math.random().toString(36).slice(2, 10); t.name = tb.name + ' (mine)'; tables.push(t); cur = t.id; touch(); drawSide(); drawMain(); } }, 'Copy to edit')),
        h('p', { class: 'muted small' }, `Draws ${tb.picks} time${tb.picks === '1' ? '' : 's'} from ${list.length} item${list.length === 1 ? '' : 's'}, plus coins. A preset can’t be changed: copy it to make your own.`),
        coins,
        h('div', { class: 'ltlist ro' }, ...list.map(e => h('div', { class: 'ltrow' }, h('span', { class: 'cname', onclick: () => V.showItemCard(itemOf(e)) }, itemOf(e).name), h('span', { class: 'muted small' }, pct(e))))));
    }
    const rows = (tb.entries || []).map((e, i) => h('div', { class: 'ltrow' },
      h('span', { class: 'cname', onclick: () => V.showItemCard(itemOf(e)) }, itemOf(e).name),
      h('label', { title: 'How likely, against the others' }, 'weight', h('input', { type: 'number', min: 0, step: 0.5, value: e.w, onchange: ev => { e.w = +ev.target.value || 0; touch(); drawMain(); } })),
      h('span', { class: 'muted small pct' }, pct(e)),
      h('label', { title: 'How many: a number or dice (1d6)' }, 'how many', h('input', { value: e.qty || '1', onchange: ev => { e.qty = ev.target.value.trim() || '1'; touch(); } })),
      h('button', { class: 'cx', title: 'Take it off the table', onclick: () => { tb.entries.splice(i, 1); touch(); drawMain(); } }, '×')));
    main.replaceChildren(
      h('div', { class: 'two' },
        h('div', null, h('label', null, 'Name'), h('input', { value: tb.name, style: 'width:100%', onchange: e => { tb.name = e.target.value || 'Loot table'; touch(); drawSide(); } })),
        h('div', null, h('label', null, 'Draws'), h('input', { value: tb.picks, style: 'width:100%', title: 'How many things it gives: a number or dice (1d4)', onchange: e => { tb.picks = e.target.value.trim() || '1'; touch(); } }))),
      h('label', null, 'Coins as well'), coins,
      h('label', null, 'What it draws from'),
      h('div', { class: 'ltlist' }, ...rows, rows.length ? null : h('p', { class: 'muted small' }, 'Nothing yet: add item cards below (the SRD’s and your own).')),
      itemPicker(it => { tb.entries = tb.entries || []; tb.entries.push({ ref: it.id, w: 1, qty: '1' }); touch(); drawMain(); }, 'Add an item card…'),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => { if (!confirm(`Delete “${tb.name}”?`)) return; tables = tables.filter(x => x !== tb); cur = (tables[0] || presets[0]).id; touch(); drawSide(); drawMain(); } }, 'Delete table')));
  }
  drawSide(); drawMain();
  modal.replaceChildren(h('div', { class: 'dialog lootdlg', style: 'width:min(820px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Loot tables'), h('button', { onclick: () => { if (!dirty || confirm('Close without saving?')) close(); } }, '×')),
    h('div', { class: 'db ltwrap' }, side, main),
    h('div', { class: 'df' }, status, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { if (!dirty || confirm('Close without saving?')) close(); } }, 'Close'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  modal.hidden = false;
};
})();
