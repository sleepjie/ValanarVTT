/* Putting two people's changes together. Each edit is made from some version (the base); when two edits from the same
 * base meet, whatever only one of them changed is kept from that one, whatever they changed alike is kept once, and
 * only a thing both changed differently is a conflict. Things in lists are matched by their ids, so one person moving
 * a town while another redraws a border are two separate changes.
 *   Merge.map(base, theirs, mine, resolve) → { data, conflicts: [{ coll, id, name }] }   (the world map's data)
 *   Merge.describe(before, after) → { summary, changes: [{ coll, id, name, what }] }       (what an edit did)
 * resolve: { 'markers:<id>': 'mine' | 'theirs' } settles conflicts; unsettled ones keep theirs and are reported. */
'use strict';
(function (root) {
  const S = v => v === undefined ? undefined : JSON.stringify(v);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  // one value three ways
  function pick(b, t, m, conflict) {
    const sb = S(b), st = S(t), sm = S(m);
    if (sm === st || sm === sb) return t;
    if (st === sb) return m;
    return conflict(b, t, m);
  }
  // a list of things with keys: each thing three ways; theirs' order, with my new things where they sat among mine
  function list(b, t, m, keyOf, conflict) {
    const map = arr => { const o = new Map(); (arr || []).forEach((x, i) => { let k = keyOf(x, i); while (o.has(k)) k += '+'; o.set(k, x); }); return o; };
    const B = map(b), T = map(t), M = map(m);
    const out = new Map();
    for (const k of new Set([...T.keys(), ...M.keys(), ...B.keys()])) {
      const v = pick(B.get(k), T.get(k), M.get(k), (bv, tv, mv) => conflict(k, bv, tv, mv));
      if (v !== undefined) out.set(k, v);
    }
    // order: theirs, then each of mine that's new, after the one before it in my list
    const order = [...T.keys()].filter(k => out.has(k));
    let prev = null;
    for (const k of M.keys()) {
      if (out.has(k) && !order.includes(k)) { const at = prev == null ? 0 : order.indexOf(prev) + 1; order.splice(at, 0, k); }
      if (order.includes(k)) prev = k;
    }
    for (const k of out.keys()) if (!order.includes(k)) order.push(k);
    return order.map(k => out.get(k));
  }
  // an object key by key (lists inside it by their keys, where given)
  function object(b, t, m, lists, conflict, path) {
    b = isObj(b) ? b : {}; t = isObj(t) ? t : {}; m = isObj(m) ? m : {};
    const out = {};
    for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
      const p = path ? path + '.' + k : k;
      if (lists && lists[k] && (Array.isArray(t[k]) || Array.isArray(m[k]))) out[k] = list(b[k], t[k], m[k], lists[k], (id, bv, tv, mv) => conflict(k, id, bv, tv, mv));
      else { const v = pick(b[k], t[k], m[k], (bv, tv, mv) => conflict(p, '', bv, tv, mv)); if (v !== undefined) out[k] = v; }
    }
    return out;
  }

  // ── the world map ──
  const byId = (x, i) => x && typeof x === 'object' && x.id != null ? 'id:' + x.id : 'at:' + S(x);
  const MAP_LISTS = { types: byId, markers: byId, unplaced: byId, nations: byId, borders: byId, routes: byId, labels: byId, armies: byId, imports: x => 'v:' + S(x) };
  const NOUN = { types: ['icon type', 'icon types'], markers: ['place', 'places'], unplaced: ['unplaced place', 'unplaced places'], nations: ['nation', 'nations'],
    borders: ['border', 'borders'], routes: ['route', 'routes'], labels: ['name on the water', 'names on the water'], armies: ['army', 'armies'], imports: ['import', 'imports'], settings: ['setting', 'settings'] };
  function nameIn(coll, o, data) {
    if (!o || typeof o !== 'object') return '';
    if (o.name) return String(o.name);
    if (o.text) return String(o.text);
    if (o.label) return String(o.label);
    if (coll === 'borders' && data && o.nation) { const n = (data.nations || []).find(x => x.id === o.nation); if (n) return 'the border of ' + n.name; }
    return '';
  }
  function map(base, theirs, mine, resolve) {
    resolve = resolve || {};
    const conflicts = [];
    const conflict = (coll, id, bv, tv, mv) => {
      const key = coll + ':' + String(id).replace(/^id:/, '');
      if (resolve[key] === 'mine') return mv;
      if (resolve[key] === 'theirs') return tv;
      conflicts.push({ coll, id: String(id).replace(/^id:/, ''), name: nameIn(coll, mv || tv || bv, mine) || nameIn(coll, tv || bv, theirs), key });
      return tv;
    };
    const strip = d => { const o = Object.assign({}, d || {}); delete o.savedAt; delete o.settings; return o; };
    const data = object(strip(base), strip(theirs), strip(mine), MAP_LISTS, conflict);
    // settings: a key at a time
    data.settings = object(base && base.settings, theirs && theirs.settings, mine && mine.settings, null, (p, id, bv, tv, mv) => conflict('settings', p, bv, tv, mv), '');
    delete data.savedAt;
    return { data, conflicts };
  }
  // what an edit changed, in words: "Added Brutayne Keep; changed 3 places and the border of Florence"
  function describe(before, after) {
    before = before || {}; after = after || {};
    const changes = [], counts = {};
    for (const coll of Object.keys(MAP_LISTS)) {
      if (coll === 'imports') continue;
      const B = new Map((before[coll] || []).map((x, i) => [byId(x, i), x])), A = new Map((after[coll] || []).map((x, i) => [byId(x, i), x]));
      for (const [k, x] of A) {
        const was = B.get(k);
        const what = !was ? 'added' : S(was) !== S(x) ? (coll === 'markers' && (was.x !== x.x || was.y !== x.y) ? 'moved' : 'changed') : null;
        if (what) changes.push({ coll, id: x.id, name: nameIn(coll, x, after), what });
      }
      for (const [k, x] of B) if (!A.has(k)) changes.push({ coll, id: x.id, name: nameIn(coll, x, before), what: 'removed' });
    }
    if (S(before.settings) !== S(after.settings)) changes.push({ coll: 'settings', id: '', name: 'the map settings', what: 'changed' });
    for (const c of changes) { const k = c.what + '|' + c.coll; (counts[k] = counts[k] || []).push(c); }
    const VERB = { added: 'Added', moved: 'Moved', changed: 'Changed', removed: 'Removed' };
    const parts = [];
    for (const what of ['added', 'moved', 'changed', 'removed']) {
      const bits = [];
      for (const coll of [...Object.keys(MAP_LISTS), 'settings']) {
        const l = counts[what + '|' + coll]; if (!l) continue;
        const named = l.filter(c => c.name);
        bits.push(l.length <= 2 && named.length === l.length ? named.map(c => c.name).join(' and ') : `${l.length} ${NOUN[coll][l.length === 1 ? 0 : 1]}`);
      }
      if (bits.length) parts.push(VERB[what] + ' ' + bits.join(', '));
    }
    return { summary: parts.join('; ') || 'No change', changes: changes.slice(0, 300) };
  }

  const api = { pick, list, object, map, describe, MAP_LISTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Merge = api;
})(this);
