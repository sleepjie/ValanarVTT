/* Armies on the world map: a token for a band, a company or a whole host, and how fast it marches.
 *
 *  - data.armies: { id, name, x, y, men, wagons, color, shown }. A banner (arms made up from its name) on a pole, with
 *    its name and strength. Editors add them (Edit › Armies) and drag them about; visitors see only those marked shown.
 *  - The Ruler's "March as": miles a day by the army's size, times the ground and the pace, slower with wagons off
 *    a road. The numbers are the army rules (data.settings.armyRules), editable in Edit › Armies.
 *
 * ValanarArmies(ctx) → { sync(), rulerBlock(miles) } */
'use strict';
window.ValanarArmies = function (ctx) {
  const { map, L, h, toast, toLatLng, store } = ctx;
  const H = window.ValanarHeraldry;
  const D = () => ctx.data();
  const armies = () => D().armies || (D().armies = []);
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
  const int = (v, d) => Math.max(0, Math.round(num(v, d)));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = n => Math.round(n).toLocaleString('en-GB');
  const clone = o => JSON.parse(JSON.stringify(o));

  // ── the rules: miles a day on a good road at the standard pace, by size; the ground and the pace multiply it
  const DEFAULTS = {
    sizes: [{ upTo: 50, perDay: 18 }, { upTo: 250, perDay: 15 }, { upTo: 1000, perDay: 13 }, { upTo: 5000, perDay: 11 }, { upTo: 20000, perDay: 9 }, { upTo: null, perDay: 7 }],
    terrain: { road: 1, open: 0.8, rough: 0.55, mountain: 0.35 },
    pace: { standard: 1, forced: 1.67 },
    wagonsOffRoad: 0.67
  };
  const TERRAIN = [['road', 'Good road'], ['open', 'Open country'], ['rough', 'Forest or hills'], ['mountain', 'Mountains or marsh']];
  const PACE = [['standard', 'Standard pace'], ['forced', 'Forced march']];
  function rules() {
    const s = (D().settings && D().settings.armyRules) || {}, out = clone(DEFAULTS);
    if (Array.isArray(s.sizes) && s.sizes.length) out.sizes = clone(s.sizes);
    for (const k of ['terrain', 'pace']) Object.assign(out[k], s[k] || {});
    out.wagonsOffRoad = num(s.wagonsOffRoad, out.wagonsOffRoad);
    return out;
  }
  function perDay(a, o) {
    const R = rules(), men = Math.max(1, int(a.men, 1));
    const br = R.sizes.find(s => s.upTo == null || men <= s.upTo) || R.sizes[R.sizes.length - 1];
    let v = num(br.perDay, 12) * num(R.terrain[o.terrain], 1) * num(R.pace[o.pace], 1);
    if (a.wagons !== false && o.terrain !== 'road') v *= R.wagonsOffRoad;
    return Math.max(0.5, v);
  }

  // ── on the map
  map.createPane('armies'); map.getPane('armies').style.zIndex = 640;
  const layer = L.layerGroup().addTo(map);
  const shown = new Map();
  let sel = null;
  const canSee = a => ctx.editMode() || a.shown !== false;
  const banner = (a, w) => H ? H.svg(H.make(a.name || 'army', a.color), { size: w, shape: 'banner', label: a.name }) : '';
  const show = () => { if (ctx.panelMode() === 'armies') ctx.renderPanel(); else ctx.openPanel('armies'); };
  function tokenHTML(a) {
    const w = Math.round(Math.max(22, Math.min(46, 16 + 6 * Math.log10(Math.max(10, int(a.men, 0))))));
    return `<div class="army${a.shown === false ? ' hid' : ''}" style="--w:${w}px"><div class="aflag">${banner(a, w)}</div><div class="apole"></div>`
      + `<div class="aplate"><span class="anm">${esc(a.name || 'Army')}</span><b>${fmtN(int(a.men, 0))}</b></div></div>`;
  }
  function sync() {
    const edit = ctx.editMode(), want = new Set();
    for (const a of armies()) {
      if (!a || !isFinite(a.x) || !isFinite(a.y) || !canSee(a)) continue;
      want.add(a.id);
      const sig = JSON.stringify([a.name, a.men, a.color, a.shown, edit, sel === a.id]);
      const have = shown.get(a.id);
      if (have && have.sig === sig) { have.m.setLatLng(toLatLng(a.x, a.y)); continue; }
      if (have) layer.removeLayer(have.m);
      const m = L.marker(toLatLng(a.x, a.y), { pane: 'armies', draggable: edit, keyboard: false, title: a.name,
        icon: L.divIcon({ className: 'army-wrap' + (sel === a.id ? ' sel' : ''), html: tokenHTML(a), iconSize: [0, 0], iconAnchor: [0, 0] }) });
      m.on('click', e => { L.DomEvent.stopPropagation(e); if (ctx.rulerOn()) { ctx.rulerAdd([a.x, a.y]); return; } sel = a.id; show(); sync(); });
      m.on('dragend', () => { const p = ctx.toPixel(m.getLatLng()); ctx.change(() => { const t = armies().find(x => x.id === a.id); if (t) { t.x = Math.round(p.x); t.y = Math.round(p.y); } }, { panel: false }); });
      layer.addLayer(m); shown.set(a.id, { m, sig });
    }
    for (const [id, v] of shown) if (!want.has(id)) { layer.removeLayer(v.m); shown.delete(id); }
    if (sel && !armies().some(a => a.id === sel)) sel = null;
  }

  // ── in the Ruler
  const OPTS = 'valanar-march';
  const opt = Object.assign({ army: '', terrain: 'road', pace: 'standard' }, (() => { try { return JSON.parse(store.get(OPTS) || '{}'); } catch (e) { return {}; } })());
  const setOpt = (k, v) => { opt[k] = v; store.set(OPTS, JSON.stringify(opt)); ctx.redrawRuler(); };
  const pick = (list, val, on) => h('select', { onchange: e => on(e.target.value) }, ...list.map(([k, l]) => h('option', { value: k, selected: val === k || null }, l)));
  function rulerBlock(miles) {
    const list = armies().filter(canSee);
    if (!list.length) return null;
    const a = list.find(x => x.id === opt.army);
    const kids = [h('div', { class: 'amarch-h' }, h('b', null, 'March as'),
      pick([['', '—'], ...list.map(x => [x.id, `${x.name} (${fmtN(int(x.men, 0))})`])], a ? a.id : '', v => setOpt('army', v)))];
    if (a) {
      const d = perDay(a, opt), days = miles / d;
      kids.push(h('div', { class: 'amarch-o' }, pick(TERRAIN, opt.terrain, v => setOpt('terrain', v)), pick(PACE, opt.pace, v => setOpt('pace', v))),
        h('div', { class: 'amarch-r' }, `${d >= 10 ? Math.round(d) : d.toFixed(1)} mi a day · `, h('b', null, days < 1 ? `${Math.max(1, Math.round(days * 8))} h` : `${Math.ceil(days * 2) / 2} days`)));
    }
    return h('div', { class: 'amarch' }, ...kids);
  }

  // ── the panel (Edit › Armies, or a click on an army)
  const setA = (id, fn, redraw) => ctx.change(() => { const t = armies().find(x => x.id === id); if (t) fn(t); }, redraw ? {} : { panel: false });
  const marchFrom = a => { opt.army = a.id; store.set(OPTS, JSON.stringify(opt)); ctx.rulerStart([a.x, a.y]); };
  function add() {
    const p = ctx.toPixel(map.getCenter());
    const a = { id: 'a' + Math.random().toString(36).slice(2, 10), name: 'New company', men: 200, wagons: true, shown: false, x: Math.round(p.x), y: Math.round(p.y) };
    sel = a.id;
    ctx.change(() => { armies().push(a); });
    toast('Added in the middle of the view: drag it where it belongs.');
  }
  function rulesBox() {
    const R = rules();
    const save = fn => ctx.change(() => { const c = rules(); fn(c); D().settings.armyRules = c; });
    const n = (v, set, step) => h('input', { type: 'number', min: 0, step: step || 0.05, value: v, onchange: e => save(c => set(c, num(e.target.value, v))) });
    return h('details', { class: 'arulesbox' }, h('summary', null, 'March rules'),
      h('p', { class: 'small muted' }, 'Miles a day on a good road at the standard pace, by the number of men. The rest multiply it.'),
      h('table', { class: 'asizes' }, h('tr', null, h('th', null, 'Up to (men)'), h('th', null, 'Miles a day')),
        ...R.sizes.map((s, i) => h('tr', null,
          h('td', null, s.upTo == null ? h('span', { class: 'muted' }, 'any more') : n(s.upTo, (c, v) => { c.sizes[i].upTo = Math.max(1, Math.round(v)); }, 1)),
          h('td', null, n(s.perDay, (c, v) => { c.sizes[i].perDay = Math.max(0.5, v); }, 0.5))))),
      h('div', { class: 'arules' },
        ...TERRAIN.map(([k, l]) => h('label', null, h('span', null, l + ' ×'), n(R.terrain[k], (c, v) => { c.terrain[k] = v; }))),
        h('label', null, h('span', null, 'Forced march ×'), n(R.pace.forced, (c, v) => { c.pace.forced = v; })),
        h('label', null, h('span', null, 'Wagons off-road ×'), n(R.wagonsOffRoad, (c, v) => { c.wagonsOffRoad = v; }))),
      h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => ctx.change(() => { delete D().settings.armyRules; }) }, 'Back to the defaults'));
  }
  function render() {
    const edit = ctx.editMode(), a = sel && armies().find(x => x.id === sel), body = [];
    if (edit) body.push(h('button', { class: 'btn primary', onclick: add }, 'Add an army'));
    if (a && edit) body.push(h('h2', null, 'This army'),
      h('label', null, 'Name'), h('input', { type: 'text', value: a.name, onchange: e => setA(a.id, t => { t.name = e.target.value.trim() || t.name; }, true) }),
      h('div', { class: 'row' },
        h('div', null, h('label', null, 'Men'), h('input', { type: 'number', min: 1, step: 1, value: int(a.men, 1), onchange: e => setA(a.id, t => { t.men = Math.max(1, int(e.target.value, 1)); }, true) })),
        h('div', null, h('label', null, 'Banner colour'), h('input', { type: 'color', value: a.color || '#8a2d22', onchange: e => setA(a.id, t => { t.color = e.target.value; }) }))),
      h('div', null,
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: a.wagons !== false || null, onchange: e => setA(a.id, t => { t.wagons = e.target.checked; }) }), 'Wagons'),
        h('label', { class: 'inline', style: 'margin-left:12px' }, h('input', { type: 'checkbox', checked: a.shown !== false || null, onchange: e => setA(a.id, t => { t.shown = e.target.checked; }, true) }), 'Visitors see it')),
      h('div', { class: 'btnrow', style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: () => marchFrom(a) }, 'March from here'),
        h('button', { class: 'btn danger', onclick: () => { ctx.change(() => { D().armies = armies().filter(x => x.id !== a.id); }); sel = null; sync(); } }, 'Remove')));
    else if (a) body.push(h('h2', null, a.name), h('p', null, `${fmtN(int(a.men, 0))} men`), h('button', { class: 'btn', onclick: () => marchFrom(a) }, 'March from here'));
    const list = armies().filter(canSee);
    if (list.length) body.push(h('h2', null, 'Armies'), h('div', { class: 'alist' }, ...list.map(x => h('div', { class: 'arow' + (x.id === sel ? ' on' : '') + (x.shown === false ? ' hid' : ''),
      onclick: () => { sel = x.id; map.panTo(toLatLng(x.x, x.y)); sync(); ctx.renderPanel(); } }, h('span', { class: 'anm' }, x.name), h('span', { class: 'muted small' }, fmtN(int(x.men, 0)))))));
    if (edit) body.push(rulesBox());
    return ctx.panelShell('Armies', h('div', { class: 'form' }, ...body));
  }
  ctx.registerPanel('armies', { render, closed: () => { sel = null; sync(); } });
  return { sync, rulerBlock };
};
