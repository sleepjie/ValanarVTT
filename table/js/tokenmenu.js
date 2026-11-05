/* A token's right-click HUD: icon buttons in two columns either side of the token and its hit points above it,
 * with pop-outs for conditions, light, looks and order. Also what a double-click on a token does: open its
 * character sheet (or its settings if it has none). */
'use strict';
(function () {
const { h, state } = V;

// ───────── icons (24×24, drawn with strokes) ─────────
const PATHS = {
  sheet: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
  gear: '<circle cx="12" cy="12" r="2.6"/><path d="M10.3 3h3.4l.5 2.4 1.7.9 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 8.4l1.7-2.9 2.3.8 1.7-.9z"/>',
  d20: '<path d="M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z"/><path d="M12 7.5l4.3 7.5H7.7z"/><path d="M12 2.5v5M3.5 7.4l4.2 7.6M20.5 7.4l-4.2 7.6M7.7 15L12 21.5l4.3-6.5"/>',
  flame: '<path d="M12 21.5c3.6 0 6-2.5 6-5.8 0-3.9-2.9-5.8-4-10.2-1.6 1.9-2.1 3.4-2.1 5-1-.9-1.9-2-2.4-3.7C7.6 9.1 6 11.7 6 15.7c0 3.3 2.4 5.8 6 5.8z"/><path d="M12 21.5c-1.7 0-2.8-1.1-2.8-2.7 0-1.8 1.4-2.8 2.8-4.6 1.4 1.8 2.8 2.8 2.8 4.6 0 1.6-1.1 2.7-2.8 2.7z"/>',
  status: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  frame: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="4"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3.5 3.5l17 17"/>',
  layers: '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.5l9 4.8 9-4.8M3 16.5l9 4.8 9-4.8"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 15H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v1"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9l1-13.5M10 11v6M14 11v6"/>',
  card: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6h8M8 17h8"/><path d="M12 9l2.2 2.5L12 14l-2.2-2.5z"/>',
  bag: '<path d="M8 8.5c-2.6 2.6-3.5 6.8-1.8 9.8 1.4 2 9.2 2 10.6 0 1.7-3 .8-7.2-1.8-9.8z"/><path d="M9 8.5c-1.4-1.4-.4-3.2 1-2.6L12 7.6l2-1.7c1.4-.6 2.4 1.2 1 2.6"/><path d="M8.6 8.6c2 1 4.8 1 6.8 0"/>',
  minus: '<path d="M6 12h12"/>', plus: '<path d="M6 12h12M12 6v12"/>',
  none: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  candle: '<path d="M9 21.5h6V11H9z"/><path d="M12 11V9"/><path d="M12 8.5c1.2 0 2-.8 2-2 0-1.4-1-2-2-4-1 2-2 2.6-2 4 0 1.2.8 2 2 2z"/>',
  torch: '<path d="M10.5 21.5l1-10h1l1 10z"/><path d="M9 11.5h6"/><path d="M12 10.5c2 0 3.2-1.3 3.2-3.1 0-2.2-1.6-3.2-3.2-6-1.6 2.8-3.2 3.8-3.2 6 0 1.8 1.2 3.1 3.2 3.1z"/>',
  lantern: '<path d="M9 4h6M12 2v2M8 7h8l-1 12H9z"/><path d="M8 7l1-3h6l1 3M7 21.5h10"/><path d="M12 15.5c1 0 1.6-.7 1.6-1.6 0-1.1-.8-1.6-1.6-3-.8 1.4-1.6 1.9-1.6 3 0 .9.6 1.6 1.6 1.6z"/>',
  front: '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z" fill="currentColor" fill-opacity=".25"/><path d="M3 15l9 4.8 9-4.8"/>',
  back: '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z"/><path d="M3 15l9 4.8 9-4.8" stroke-dasharray="2 2"/>',
  ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5" stroke-opacity=".5"/>',
  bare: '<path d="M8 20.5l1.5-6-2-4 2-5.5h5l2 5.5-2 4 1.5 6"/><circle cx="12" cy="3.6" r="1.6"/>',
  pixel: '<path d="M4 4h5v5H4zM9 9h6v6H9zM15 15h5v5h-5zM15 4h5v5h-5zM4 15h5v5H4z" />',
};
const icon = (k, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.innerHTML = PATHS[k] || ''; return s; };
V.icon = icon;

let hud = null;                  // { el, id, pop, rect, opts }
const close = () => { if (hud) { hud.el.remove(); hud = null; } };
document.addEventListener('pointerdown', e => { if (hud && !hud.el.contains(e.target)) close(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && hud) { if (hud.pop) { hud.pop = null; render(); } else close(); } });
document.addEventListener('wheel', e => { if (hud && !hud.el.contains(e.target)) close(); }, { capture: true, passive: true });
window.addEventListener('blur', close);
window.addEventListener('resize', close);
V.on('scene', close);
V.on('tokens', d => {
  if (!hud) return;
  if (d.rm.includes(hud.id)) return close();
  if (d.up.some(t => t.id === hud.id) && !(hud.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) render();
});

const charOf = t => t && t.sheet && (state.camp.characters || []).find(c => c.id === t.sheet);
V.tokenOpen = function (id) {
  const t = state.scene && state.scene.tokens.get(id); if (!t) return;
  if (t.item && V.showItemCard) return V.showItemCard(t.item, { token: t.id });
  const ch = charOf(t);
  if (ch) V.openSheet(ch.id); else V.openTokenPanel(id);
};
const zoomBy = (t, dir) => V.clamp(Math.round((t.scale || 1) * (dir > 0 ? 1.1 : 1 / 1.1) * 100) / 100, 0.1, 6);
const LIGHTS = [['none', 'No light', 0, 0, 'none'], ['candle', 'Candle · 5/10 ft', 5, 10, 'candle'], ['torch', 'Torch · 20/40 ft', 20, 40, 'torch'], ['lantern', 'Lantern · 30/60 ft', 30, 60, 'torch']];

// rect: the token on screen ({ left, top, width, height }, page pixels)
V.tokenMenu = function (id, rect, opts) {
  close();
  const t = state.scene && state.scene.tokens.get(id); if (!t) return;
  if (typeof rect === 'number') rect = { left: rect, top: arguments[2], width: 0, height: 0 };   // old callers: a point
  hud = { el: h('div', { class: 'tokhud', oncontextmenu: e => e.preventDefault() }), id, pop: null, rect, opts: opts || {} };
  document.body.append(hud.el);
  render();
};
V.closeTokenMenu = close;

function render() {
  const t = state.scene && state.scene.tokens.get(hud.id); if (!t) return close();
  const id = t.id, gm = V.isGM(), mine = V.canControl(t), ch = charOf(t), rc = hud.rect;
  const set = patch => V.op({ t: 'token.update', scene: state.scene.id, id, patch });
  const setAll = fn => {   // the same change on every selected token (when this one is among them)
    const ids = state.sel.has(id) ? [...state.sel] : [id];
    const ops = ids.map(x => state.scene.tokens.get(x)).filter(Boolean).filter(V.canControl).map(tt => ({ t: 'token.update', scene: state.scene.id, id: tt.id, patch: fn(tt) }));
    if (ops.length) V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops });
  };
  const togglePop = k => { hud.pop = hud.pop === k ? null : k; render(); };
  const btn = (ic, tip, fn, o) => h('button', Object.assign({ class: 'hb' + (o && o.on ? ' on' : '') + (o && o.danger ? ' danger' : '') + (o && o.pop && hud.pop === o.pop ? ' open' : ''), 'data-tip': tip, 'aria-label': tip,
    onclick: e => { e.stopPropagation(); fn(e); } }), icon(ic));

  // ── left column
  const left = [
    t.item && V.showItemCard ? btn('card', 'Show its card', () => { close(); V.showItemCard(t.item, { token: id }); }) : null,
    ch ? btn('sheet', `Open ${ch.name}’s sheet`, () => { close(); V.openSheet(ch.id); }) : null,
    ch && V.openInventory ? btn('bag', `${ch.name}’s inventory`, () => { close(); V.openInventory(ch.id); }) : null,
    mine ? btn('gear', 'Token settings', () => { close(); V.openTokenPanel(id); }) : null,
    mine && !t.item ? btn('d20', 'Roll initiative', () => {
      const ids = state.sel.has(id) ? [...state.sel] : [id];
      for (const tid of ids) {
        const tt = state.scene.tokens.get(tid), c = charOf(tt);
        if (c && c.canEdit) V.runSheetButton(c.id, 'initiative');   // the sheet's own roll, with its bonuses
        else V.send({ t: 'initRoll', scene: state.scene.id, tokens: [tid], mod: 0 }).catch(e => V.toast(e.message, true));
      }
      close();
    }) : null,
    mine ? btn('flame', 'Light', () => togglePop('light'), { pop: 'light', on: t.light && (t.light.dim > 0 || t.light.bright > 0) }) : null,
  ].filter(Boolean);
  // ── right column
  const right = [
    mine && !t.item ? btn('status', 'Conditions', () => togglePop('cond'), { pop: 'cond', on: (t.conditions || []).length > 0 }) : null,
    gm ? btn('frame', 'Look: ring, picture size, pixel art', () => togglePop('look'), { pop: 'look' }) : null,
    gm ? btn(t.layer === 'gm' ? 'eyeoff' : 'eye', t.layer === 'gm' ? 'Hidden from players: show it' : 'Hide from players (GM layer)', () => setAll(tt => ({ layer: t.layer === 'gm' ? 'tokens' : 'gm' })), { on: t.layer === 'gm' }) : null,
    gm && !hud.opts.world ? btn('layers', 'Order and layer: to front / to back, map, token or GM layer', () => togglePop('order'), { pop: 'order' }) : null,
    gm ? btn('copy', 'Copy it beside', () => { close(); const c = Object.assign({}, t); delete c.id; delete c._i; c.x += V.grid().size || 70; V.op({ t: 'token.create', scene: state.scene.id, token: c }); }) : null,
    gm ? btn('trash', 'Delete', () => { close(); const ids = state.sel.has(id) ? [...state.sel] : [id]; const ops = ids.map(x => ({ t: 'token.delete', scene: state.scene.id, id: x })); V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops }); }, { danger: true }) : null,
  ].filter(Boolean);

  // ── hit points above: type -7 to hurt, +3 to heal, or a number to set it
  let top = null;
  if (t.hp && mine) {
    const inp = h('input', { class: 'hpv', value: t.hp.v, title: 'Type -7 to hurt, +3 to heal, or a number to set it; Enter',
      onfocus: e => e.target.select(),
      onkeydown: e => { if (e.key === 'Enter') { apply(e.target.value); e.target.blur(); } } });
    const apply = text => {
      const v = String(text).trim().replace('−', '-'), cur = t.hp.v || 0;
      const nv = /^[+-]\d+$/.test(v) ? cur + Number(v) : /^\d+$/.test(v) ? Number(v) : cur;
      set({ hp: { v: Math.max(-999, t.hp.max ? Math.min(t.hp.max, nv) : nv), max: t.hp.max } });
    };
    const k = t.hp.max ? V.clamp(t.hp.v / t.hp.max, 0, 1) : 1;
    top = h('div', { class: 'hptop', style: `--k:${k};--hc:${k > 0.5 ? '#5fa86a' : k > 0.25 ? '#d6a23e' : '#c0584a'}` },
      btn('minus', 'Hurt 1', () => set({ hp: { v: (t.hp.v || 0) - 1, max: t.hp.max } })),
      h('div', { class: 'hpbox' }, inp, h('span', { class: 'hpm' }, '/ ' + t.hp.max), h('div', { class: 'hpbar' })),
      btn('plus', 'Heal 1', () => set({ hp: { v: Math.min(t.hp.max || 1e6, (t.hp.v || 0) + 1), max: t.hp.max } })));
  }

  // ── pop-outs
  let pop = null;
  if (hud.pop === 'cond') {
    const conds = new Set(t.conditions || []);
    pop = h('div', { class: 'hpop condpop' }, h('div', { class: 'pt' }, 'Conditions'),
      h('div', { class: 'cgrid' }, ...V.CONDITIONS.map(([n, badge, col]) => h('button', { class: 'ct' + (conds.has(n) ? ' on' : ''), style: `--cc:${col}`, title: n,
        onclick: () => { const on = !conds.has(n); setAll(tt => { const c = new Set(tt.conditions || []); on ? c.add(n) : c.delete(n); return { conditions: [...c] }; }); } },
        h('span', { class: 'cb' }, badge), h('span', { class: 'cn' }, n)))),
      conds.size ? h('button', { class: 'pclear', onclick: () => setAll(() => ({ conditions: [] })) }, 'Clear all') : null);
  } else if (hud.pop === 'light') {
    const l = t.light || {};
    pop = h('div', { class: 'hpop lights' }, h('div', { class: 'pt' }, 'Carry a light'),
      h('div', { class: 'lrow' }, ...LIGHTS.map(([ic, label, b, d, anim]) => h('button', { class: 'lt' + ((l.bright || 0) === b && (l.dim || 0) === d ? ' on' : ''), title: label,
        onclick: () => setAll(tt => ({ light: d ? Object.assign({ color: '#ffc477', intensity: 0.5, angle: 360, dir: 0 }, tt.light || {}, { bright: b, dim: d, anim }) : null })) },
        icon(ic), h('span', null, label.split(' · ')[0])))),
      h('button', { class: 'pclear', onclick: () => { close(); V.openTokenPanel(id); } }, 'Colour, reach and flicker…'));
  } else if (hud.pop === 'look') {
    const ring = V.tokenRing(t), zoom = t.scale || 1;
    const stepper = (label, val, dec, inc, tip) => h('div', { class: 'step', title: tip }, h('span', { class: 'sl' }, label),
      h('button', { onclick: dec }, icon('minus')), h('b', null, val), h('button', { onclick: inc }, icon('plus')));
    pop = h('div', { class: 'hpop look' }, h('div', { class: 'pt' }, 'Look'),
      h('div', { class: 'seg' },
        h('button', { class: ring ? 'on' : null, onclick: () => setAll(() => ({ ring: true })) }, icon('ring'), 'Ring'),
        h('button', { class: !ring ? 'on' : null, onclick: () => setAll(() => ({ ring: false })) }, icon('bare'), 'Bare sprite')),
      stepper('Picture', Math.round(zoom * 100) + '%', () => setAll(tt => ({ scale: zoomBy(tt, -1) })), () => setAll(tt => ({ scale: zoomBy(tt, 1) })), 'Scale the picture: [ and ] keys, Shift for fine steps'),
      stepper('Squares', String(t.size || 1), () => setAll(tt => ({ size: Math.max(0.25, (tt.size || 1) - ((tt.size || 1) <= 1 ? 0.25 : 1)) })), () => setAll(tt => ({ size: Math.min(30, (tt.size || 1) + ((tt.size || 1) < 1 ? 0.25 : 1)) })), 'How many squares it covers'),
      h('div', { class: 'seg' },
        h('button', { class: t.pixel ? 'on' : null, title: 'Sharp edges when scaled: for pixel-art sprites', onclick: () => setAll(() => ({ pixel: !t.pixel })) }, icon('pixel'), 'Pixel art'),
        h('button', { class: zoom !== 1 ? null : 'on', title: 'Picture back to 100%', onclick: () => setAll(() => ({ scale: 1 })) }, '100%')));
  } else if (hud.pop === 'order') {
    pop = h('div', { class: 'hpop order' }, h('div', { class: 'pt' }, 'Order'),
      h('div', { class: 'lrow' },
        h('button', { class: 'lt', onclick: () => { V.op({ t: 'token.order', scene: state.scene.id, id, to: 'front' }); hud.pop = null; render(); } }, icon('front'), h('span', null, 'To front')),
        h('button', { class: 'lt', onclick: () => { V.op({ t: 'token.order', scene: state.scene.id, id, to: 'back' }); hud.pop = null; render(); } }, icon('back'), h('span', null, 'To back'))),
      h('div', { class: 'pt' }, 'Layer'),
      h('div', { class: 'lrow' }, ...[['map', 'Map'], ['tokens', 'Token'], ['gm', 'GM']].map(([k, label]) =>
        h('button', { class: 'lt' + ((t.layer || 'tokens') === k ? ' on' : ''), onclick: () => { setAll(() => ({ layer: k })); hud.pop = null; close(); } }, h('span', null, label)))));
  }

  const L = h('div', { class: 'hcol l' }, ...left), R = h('div', { class: 'hcol r' }, ...right);
  hud.el.replaceChildren(L, R, top || h('span'), pop || h('span'));
  // place it: the columns hug the token, everything stays on screen
  const W = innerWidth, H = innerHeight, gap = 8, bw = 40;
  const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  const colH = n => n * bw + (n - 1) * 6;
  const place = (el, x, y) => { el.style.left = V.clamp(x, 4, W - el.offsetWidth - 4) + 'px'; el.style.top = V.clamp(y, 4, H - el.offsetHeight - 4) + 'px'; };
  place(L, rc.left - gap - bw, cy - colH(left.length) / 2);
  place(R, rc.left + rc.width + gap, cy - colH(right.length) / 2);
  // hit points above the token and clear of the columns
  if (top) place(top, cx - top.offsetWidth / 2, Math.min(rc.top, L.offsetTop || rc.top, R.offsetTop || rc.top) - top.offsetHeight - 8);
  if (pop) {
    const fromRight = hud.pop === 'cond' || hud.pop === 'look' || hud.pop === 'order';
    const x = fromRight ? rc.left + rc.width + gap + bw + 10 : rc.left - gap - bw - 10 - pop.offsetWidth;
    const flip = fromRight ? x + pop.offsetWidth > W - 4 : x < 4;   // no room on that side: the other side
    place(pop, flip ? (fromRight ? rc.left - gap - bw - 10 - pop.offsetWidth : rc.left + rc.width + gap + bw + 10) : x, cy - pop.offsetHeight / 2);
  }
}
})();
