/* The Heraldry Workshop (admins): every nation's coat of arms, big, to change by picking — the shape of the shield,
 * how the field is divided, the ordinary across it, the charges on it, and the tincture of each, from swatches —
 * with the blazon written out as you go and a word when the rule of tincture is broken (colour on colour, metal on
 * metal: hard to read from afar). Roll new arms, undo and redo, go back to the arms the nation was first given, save,
 * or take the arms away as a picture (SVG or PNG).
 * Opened from Borders (Edit mode), a nation's wiki page, or the search box (Ctrl+K: "heraldry").
 * ValanarArmsShop(ctx) → { open(nationId) } */
'use strict';
window.ValanarArmsShop = function (ctx) {
  const { h, toast } = ctx;
  const H = window.ValanarHeraldry;
  if (!H) return null;
  const clone = o => JSON.parse(JSON.stringify(o));
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
  let ui = null, cur = null, work = null, hist = [], fut = [], dirty = false, generated = false;
  const nations = () => ctx.data().nations || [];
  const nation = () => nations().find(n => n.id === cur) || null;
  const blank = { field: { div: 'plain', t1: 'azure', t2: 'or' }, ord: { kind: 'none', t: 'or' }, charge: { kind: 'none', t: 'or', n: 1 } };

  function open(nid) {
    if (!nations().length) { toast('There are no nations yet: draw some borders first.', true); return; }
    if (!ui) build();
    select(nid && nations().some(n => n.id === nid) ? nid : cur || nations()[0].id, true);
  }
  function build() {
    ui = {};
    ui.list = h('div', { class: 'aslist' });
    ui.stage = h('div', { class: 'asstage' });
    ui.side = h('div', { class: 'asside' });
    ui.title = h('span', { class: 'asttl' });
    ui.save = h('button', { class: 'asbtn primary', onclick: save }, 'Save the arms');
    ui.undo = h('button', { class: 'asbtn', title: 'Undo (Ctrl+Z)', onclick: undo }, '↶');
    ui.redo = h('button', { class: 'asbtn', title: 'Redo (Ctrl+Y)', onclick: redo }, '↷');
    ui.root = h('div', { class: 'ashop' },
      h('div', { class: 'asbar' }, h('b', { class: 'asname' }, 'The Heraldry Workshop'), ui.title, h('span', { class: 'grow' }),
        ui.undo, ui.redo,
        h('button', { class: 'asbtn', title: 'Roll new arms for this nation (you can undo it)', onclick: roll }, '⚄ Roll new arms'),
        h('button', { class: 'asbtn', title: 'The arms the nation was first given, made up from its name and colour', onclick: original }, 'As first made'),
        h('button', { class: 'asbtn', title: 'Save the arms as a picture', onclick: download }, '⤓ Picture'),
        ui.save,
        h('button', { class: 'asbtn x', title: 'Close (Esc)', onclick: close }, '×')),
      h('div', { class: 'asbody' }, ui.list, ui.stage, ui.side));
    document.body.append(ui.root);
    requestAnimationFrame(() => ui && ui.root.classList.add('on'));
    document.addEventListener('keydown', keys, true);
  }
  function keys(e) {
    if (!ui) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); }
  }
  function close() {
    if (!ui) return;
    if (dirty && !confirm(`Leave the workshop without saving ${nation() ? nation().name + '’s' : 'the'} arms?`)) return;
    document.removeEventListener('keydown', keys, true);
    const r = ui.root; r.classList.remove('on'); setTimeout(() => r.remove(), 250);
    ui = null; dirty = false;
  }
  function select(nid, force) {
    if (!force && nid === cur) return;
    if (dirty && nid !== cur) {
      const n = nation();
      if (confirm(`Save ${n ? n.name + '’s' : 'these'} arms first?`)) save(); else dirty = false;
    }
    cur = nid;
    const n = nation();
    generated = !(n && n.arms && n.arms.field);
    work = clone(ctx.armsOf(n) || blank);
    if (!work.ord) work.ord = { kind: 'none', t: 'or' };
    if (!work.charge) work.charge = { kind: 'none', t: 'or', n: 1 };
    hist = []; fut = []; dirty = false;
    draw();
  }
  function edit(fn) { hist.push(clone(work)); if (hist.length > 200) hist.shift(); fut = []; fn(work); dirty = true; generated = false; draw(); }
  function undo() { if (!hist.length) return; fut.push(clone(work)); work = hist.pop(); dirty = true; draw(); }
  function redo() { if (!fut.length) return; hist.push(clone(work)); work = fut.pop(); dirty = true; draw(); }
  function roll() { const n = nation(); edit(w => { const shape = w.shape; Object.assign(w, H.make(Math.random().toString(36), n && n.color)); if (shape) w.shape = shape; }); }
  function original() { const n = nation(); if (!n) return; edit(w => { const g = H.make(n.name, n.color); delete w.shape; Object.assign(w, g); }); generated = true; }
  function save() {
    const n = nation(); if (!n) return;
    ctx.setArms(n.id, generated ? null : clone(work));
    dirty = false; draw();
    toast(`Saved: the arms of ${n.name}.`);
  }

  // ───────── drawing the workshop ─────────
  const mini = (a, size, title, on, click) => h('button', { class: 'astile' + (on ? ' on' : ''), title, onclick: click, html: H.svg(a, { size: size || 46, label: title }) });
  const TINCT_ORDER = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure', 'tenne', 'sanguine', 'celeste', 'ermine', 'vair'];
  function swatches(get, set, label) {
    const n = nation(), own = n && n.color;
    const sw = (t, name) => {
      const T = H.TINCTURES[t];
      const kind = T ? (T.fur ? 'fur' : T.metal ? 'metal' : 'colour') : (H.isMetal(t) ? 'metal' : 'colour');
      return h('button', { class: 'asswatch ' + kind + (get() === t ? ' on' : ''), title: `${name} (${kind === 'fur' ? 'a fur' : kind === 'metal' ? 'a metal' : 'a colour'})`, onclick: () => edit(() => set(t)),
        style: T && T.fur ? '' : `background:${H.colourOf(t)}` }, T && T.fur ? h('span', { html: H.svg({ field: { div: 'plain', t1: t }, ord: { kind: 'none' }, charge: { kind: 'none' }, shape: 'banner' }, { size: 26 }) }) : null);
    };
    return h('div', { class: 'asswatches', 'aria-label': label },
      ...TINCT_ORDER.map(t => sw(t, H.TINCTURES[t].name)),
      own && !H.TINCTURES[own] ? sw(own, `${n.name}’s own colour`) : null,
      get() && !H.TINCTURES[get()] && get() !== own ? sw(get(), 'Its old colour') : null);
  }
  function tinctName(t) { const T = H.TINCTURES[t]; return T ? T.name : 'its own colour'; }
  // the rule of tincture: metal on colour or colour on metal (furs go with anything)
  function warnings(a) {
    const out = [], kind = t => H.isFur(t) ? 'fur' : H.isMetal(t) ? 'metal' : 'colour';
    const clash = (top, under) => kind(top) !== 'fur' && kind(under) !== 'fur' && kind(top) === kind(under) && H.colourOf(top) !== H.colourOf(under);
    const same = (top, under) => H.colourOf(top) === H.colourOf(under);
    const O = a.ord || {}, C = a.charge || {}, F = a.field;
    if (O.kind && O.kind !== 'none') {
      const unders = F.div && F.div !== 'plain' ? [] : [F.t1];   // on a divided field, anything goes
      for (const u of unders) {
        if (same(O.t, u)) out.push(`The ${H.ORDS[O.kind].name.replace(/^an? /, '')} is ${tinctName(O.t)} on ${tinctName(u)}: it can’t be seen.`);
        else if (clash(O.t, u)) out.push(`${tinctName(O.t)} on ${tinctName(u)}: ${kind(u)} on ${kind(u)}. Heralds frown on it: it’s hard to read from afar.`);
      }
    }
    if (C.kind && C.kind !== 'none') {
      const ordUnder = O.kind && O.kind !== 'none' && H.onOrdinary(O.kind, C.n || 1);
      const under = ordUnder ? O.t : (F.div && F.div !== 'plain' ? null : F.t1);
      if (under) {
        if (same(C.t, under)) out.push(`The charges are ${tinctName(C.t)} on ${tinctName(under)}: they can’t be seen.`);
        else if (clash(C.t, under)) out.push(`The charges are ${tinctName(C.t)} on ${tinctName(under)}: ${kind(under)} on ${kind(under)}, which heralds frown on.`);
      }
    }
    return out;
  }
  // the arms as they'd be seen: on a banner, pressed into a seal, struck on a coin, on the map; and beside the other
  // nations' (so two don't come out too alike)
  function showcase(a, n) {
    const svgOf = (shape, size) => H.svg(Object.assign({}, a, { shape }), { size, label: '' });
    const item = (cls, label, inner) => h('figure', { class: 'asuse ' + cls }, h('div', { class: 'asusepic' }, inner), h('figcaption', null, label));
    const others = nations().filter(x => x.id !== cur).map(x => ({ x, arms: ctx.armsOf(x) })).filter(o => o.arms && o.arms.field);
    const alike = others.filter(o => H.blazon(o.arms) === H.blazon(a) ||
      (o.arms.charge && a.charge && o.arms.charge.kind === a.charge.kind && a.charge.kind !== 'none' && o.arms.field.t1 === a.field.t1 && (o.arms.field.div || 'plain') === (a.field.div || 'plain')));
    return h('section', { class: 'asshow' },
      h('h3', null, 'The arms in use'),
      h('div', { class: 'asuses' },
        item('banner', 'A banner', h('div', { class: 'aspole' }, h('span', { html: svgOf('banner', 110) }))),
        item('seal', 'A seal', h('div', { class: 'aswax' }, h('span', { html: svgOf('round', 70) }))),
        item('coin', 'A coin', h('div', { class: 'ascoin' }, h('span', { html: svgOf('round', 74) }))),
        item('pin', 'On the map', h('div', { class: 'asmappin' }, h('span', { html: svgOf(a.shape || 'heater', 34) }), h('b', null, n ? n.name : ''))),
        item('kite', 'On a knight’s shield', h('span', { html: svgOf('kite', 70) }))),
      h('h3', null, 'Beside the others', alike.length ? h('span', { class: 'aswarn2' }, `⚠ Too like ${alike.slice(0, 3).map(o => o.x.name).join(', ')}`) : null),
      h('div', { class: 'asothers' }, h('button', { class: 'asother me', title: n ? n.name : '', html: H.svg(a, { size: 46 }) }),
        ...others.slice(0, 40).map(o => h('button', { class: 'asother' + (alike.includes(o) ? ' alike' : ''), title: `${o.x.name}: ${H.blazon(o.arms)}`, onclick: () => select(o.x.id), html: H.svg(o.arms, { size: 34 }) }))));
  }
  function draw() {
    if (!ui) return;
    const n = nation(), a = work;
    ui.title.textContent = n ? ` · ${n.name}` : '';
    ui.undo.disabled = !hist.length; ui.redo.disabled = !fut.length;
    ui.save.disabled = !dirty; ui.save.textContent = dirty ? 'Save the arms' : 'Saved';
    // the nations
    fill(ui.list, h('div', { class: 'ashd' }, 'Nations'), nations().map(x => h('button', { class: 'asnat' + (x.id === cur ? ' on' : ''), onclick: () => select(x.id) },
      h('span', { class: 'asnarms', html: H.svg(x.id === cur ? a : ctx.armsOf(x), { size: 30 }) }), h('span', { class: 'asnn' }, x.name, x.id === cur && dirty ? h('i', { class: 'dot', title: 'Not saved yet' }) : null))));
    // the shield itself
    const w = warnings(a);
    fill(ui.stage,
      h('div', { class: 'asshield', html: H.svg(a, { size: 300, label: n ? `The arms of ${n.name}` : 'Arms' }) }),
      h('div', { class: 'asblazon' }, H.blazon(a)),
      w.length ? h('div', { class: 'aswarn' }, w.map(x => h('div', null, '⚠ ' + x))) : h('div', { class: 'asok' }, 'Metal on colour, colour on metal: as a herald would have it.'),
      h('div', { class: 'asshapes' }, Object.entries(H.SHAPES).map(([k, sh]) => mini(Object.assign({}, a, { shape: k }), 40, `${sh.name} shield`, (a.shape || 'heater') === k, () => edit(x => { if (k === 'heater') delete x.shape; else x.shape = k; })))),
      generated ? h('p', { class: 'asnote' }, 'These are the arms made up from the nation’s name and colour: change anything and they’re its own.') : null,
      showcase(a, n));
    // the parts
    const F = a.field, O = a.ord, C = a.charge;
    const plainField = { div: 'plain', t1: F.t1, t2: F.t2 };
    fill(ui.side,
      h('section', null, h('h3', null, 'The field', h('span', null, F.div && F.div !== 'plain' ? H.DIVS[F.div].name : 'Plain')),
        h('div', { class: 'astiles' }, Object.entries(H.DIVS).map(([k, d]) => mini({ shape: a.shape, field: { div: k, t1: F.t1, t2: F.t2 }, ord: { kind: 'none' }, charge: { kind: 'none' } }, 44, d.name || 'Plain', (F.div || 'plain') === k, () => edit(x => { x.field.div = k; })))),
        h('div', { class: 'aslbl' }, F.div && F.div !== 'plain' ? 'First tincture' : 'Tincture', h('b', null, tinctName(F.t1))), swatches(() => F.t1, t => { work.field.t1 = t; }, 'The field'),
        F.div && F.div !== 'plain' ? [h('div', { class: 'aslbl' }, 'Second tincture', h('b', null, tinctName(F.t2))), swatches(() => F.t2, t => { work.field.t2 = t; }, 'The field’s second tincture')] : null),
      h('section', null, h('h3', null, 'The ordinary', h('span', null, O.kind !== 'none' ? H.ORDS[O.kind].name.replace(/^an? /, '') : 'None')),
        h('div', { class: 'astiles' }, Object.entries(H.ORDS).map(([k, d]) => mini({ shape: a.shape, field: plainField, ord: { kind: k, t: H.colourOf(O.t) === H.colourOf(F.t1) ? (H.isMetal(F.t1) ? 'sable' : 'argent') : O.t }, charge: { kind: 'none' } }, 44, k === 'none' ? 'None' : d.name.replace(/^an? /, ''), O.kind === k, () => edit(x => { x.ord.kind = k; })))),
        O.kind !== 'none' ? [h('div', { class: 'aslbl' }, 'Tincture', h('b', null, tinctName(O.t))), swatches(() => O.t, t => { work.ord.t = t; }, 'The ordinary')] : null),
      h('section', null, h('h3', null, 'The charges', h('span', null, C.kind !== 'none' ? H.CHARGES[C.kind].name : 'None')),
        chargePicker(F, C),
        C.kind !== 'none' ? [
          h('div', { class: 'aslbl' }, 'How many'),
          h('div', { class: 'ascount' }, [1, 2, 3].map(k => h('button', { class: (C.n || 1) === k ? 'on' : null, onclick: () => edit(x => { x.charge.n = k; }) }, ['One', 'Two', 'Three'][k - 1]))),
          h('div', { class: 'aslbl' }, 'Size'),
          h('div', { class: 'ascount' }, [[0.75, 'Smaller'], [1, 'As drawn'], [1.25, 'Larger']].map(([v, l]) => h('button', { class: (+C.sz || 1) === v ? 'on' : null, onclick: () => edit(x => { if (v === 1) delete x.charge.sz; else x.charge.sz = v; }) }, l))),
          h('div', { class: 'aslbl' }, 'Facing'),
          h('div', { class: 'ascount' }, [[false, 'As drawn'], [true, 'The other way']].map(([v, l]) => h('button', { class: !!C.flip === v ? 'on' : null, title: v ? 'Contourné: turned to face the other way' : null, onclick: () => edit(x => { if (v) x.charge.flip = true; else delete x.charge.flip; }) }, l))),
          h('div', { class: 'aslbl' }, 'Tincture', h('b', null, tinctName(C.t))), swatches(() => C.t, t => { work.charge.t = t; }, 'The charges')] : null));
  }
  // the charges, a kind at a time (beasts, birds, monsters…), or found by name
  let chCat = null, chQ = '';
  function chargePicker(F, C) {
    const cats = (H.CATS || []).filter(c => Object.values(H.CHARGES).some(d => d.cat === c));
    if (!chCat || !cats.includes(chCat)) chCat = (H.CHARGES[C.kind] && H.CHARGES[C.kind].cat) || cats[0];
    const tiles = h('div', { class: 'astiles charges' });
    const chips = h('div', { class: 'aschips' });
    const fillTiles = () => {
      const q = chQ.trim().toLowerCase();
      const list = Object.entries(H.CHARGES).filter(([k, d]) => k !== 'none' && (q ? (d.name + ' ' + (d.pl || '') + ' ' + k).toLowerCase().includes(q) : d.cat === chCat));
      tiles.replaceChildren(mini({ shape: 'heater', field: { div: 'plain', t1: F.t1 }, ord: { kind: 'none' }, charge: { kind: 'none' } }, 40, 'None', C.kind === 'none', () => edit(x => { x.charge.kind = 'none'; })),
        ...list.map(([k, d]) => mini({ shape: 'heater', field: { div: 'plain', t1: F.t1 }, ord: { kind: 'none' }, charge: { kind: k, t: C.t, n: 1 } }, 40, d.name, C.kind === k, () => edit(x => { x.charge.kind = k; if (!x.charge.n) x.charge.n = 1; }))),
        list.length ? '' : h('div', { class: 'asnone' }, 'Nothing by that name.'));
      chips.replaceChildren(...cats.map(c => h('button', { class: !q && c === chCat ? 'on' : null, onclick: () => { chCat = c; chQ = ''; find.value = ''; fillTiles(); } }, c)));
    };
    const find = h('input', { type: 'search', class: 'asfind', placeholder: `Find one of ${Object.keys(H.CHARGES).length - 1} charges…`, value: chQ, oninput: e => { chQ = e.target.value; fillTiles(); } });
    fillTiles();
    return h('div', { class: 'aspicker' }, find, chips, tiles);
  }

  // ───────── the arms as a picture ─────────
  function download() {
    const n = nation(), name = `Arms of ${n ? n.name : 'a nation'}`.replace(/[\\/:*?"<>|]+/g, '');
    const svg = H.svg(work, { size: 600, label: name });
    const pick = h('div', { class: 'asdl' },
      h('button', { class: 'asbtn', onclick: () => { save1(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg'); pick.remove(); } }, 'SVG (sharp at any size)'),
      h('button', { class: 'asbtn', onclick: () => { png(svg, 1200).then(b => { if (b) save1(b, name + '.png'); }); pick.remove(); } }, 'PNG (1200 px tall)'),
      h('button', { class: 'asbtn x', onclick: () => pick.remove() }, '×'));
    ui.root.append(pick);
  }
  function save1(blob, file) { const u = URL.createObjectURL(blob), a = h('a', { href: u, download: file }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
  function png(svg, tall) {
    return new Promise(ok => {
      const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), im = new Image();
      im.onload = () => { const c = document.createElement('canvas'); c.height = tall; c.width = Math.round(tall / 1.2); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(ok, 'image/png'); };
      im.onerror = () => { URL.revokeObjectURL(u); ok(null); };
      im.src = u;
    });
  }

  return { open, active: () => !!ui };
};
