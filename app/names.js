/* The Name Forge: new names in the manner of the world's own (#/wiki/Special:Names).
 *
 * People: from the wiki's "Common Names of …" pages (a nation's lists of men's and women's names and surnames, people
 * by people), whole new names: a given name and a surname. Places: a nation's style, learnt from the places on the
 * map inside it. Gods: from the pages about the gods and titans.
 * It's a chain of letters (which letters follow which two or three), so what comes out sounds as though it belongs
 * there without being a copy of anything in it. Names you like can be kept (in this browser), and on the map an
 * admin naming a place can ask for one in the local style (✦ beside its name).
 *
 * ValanarNames(ctx) → { page(el, params), suggest(nation), styles(), people() } */
'use strict';
window.ValanarNames = function (ctx) {
  const { h, toast } = ctx;
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));   // (null would show as text)
  const KEEP = 'valanar-kept-names';
  const norm = s => String(s || '').normalize('NFC').replace(/[’`]/g, "'").trim();
  const lower = s => norm(s).toLowerCase();
  const BAD = /^(unnamed|new place|untitled|the)$/i;

  // ───────── places and gods: what each style learns from ─────────
  let cache = null;
  function styles() {
    const sig = ctx.data().markers.length + ':' + ctx.pages().length + ':' + ctx.data().nations.length;
    if (cache && cache.sig === sig) return cache.list;
    const byNation = new Map();
    const all = [];
    const add = (map, key, name) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(name); };
    for (const m of ctx.data().markers) {
      const n = norm(m.name);
      if (!n || m.unnamed || BAD.test(n) || n.length < 3 || /\d/.test(n)) continue;
      const t = ctx.typeOf(m);
      if (t && t.text) continue;   // nations' and regions' names are written on the map, not places
      all.push(n);
      const nat = ctx.nationOfMarker(m);
      if (nat) add(byNation, nat, n);
    }
    for (const nat of ctx.data().nations) if (nat.name && !BAD.test(nat.name)) { all.push(norm(nat.name)); add(byNation, nat.name, norm(nat.name)); }
    // the gods and titans: the pages in Theology's folders (their titles, where they're names)
    const gods = ctx.pages().filter(p => /^theology\//i.test(p.folders.join('/') + '/') && p.title.split(/\s+/).length <= 3 && !/^the\s|overview|story|souls/i.test(p.title))
      .map(p => norm(p.title.replace(/,.*$/, '')));
    const list = [];
    for (const [nat, set] of byNation) if (set.size >= 6) list.push({ key: 'n:' + nat, label: nat, kind: 'nation', names: [...set] });
    list.sort((a, b) => b.names.length - a.names.length);
    if (gods.length >= 6) list.push({ key: 'gods', label: 'The gods and titans', kind: 'gods', names: gods });
    list.push({ key: 'all', label: 'All of the world', kind: 'all', names: [...new Set(all)] });
    cache = { sig, list };
    return list;
  }

  // ───────── people: the "Common Names of …" pages ─────────
  // Under a people's name in bold (**Humans**), a header row (Male · Female · Surname), then rows of names split by
  // tabs (or by a |, as a table): a man's name, a woman's, a surname.
  let peopleCache = null;
  function people() {
    const src = ctx.pages().filter(p => /^common names of /i.test(p.title));
    const sig = src.map(p => p.id + ':' + (p.rev || p.updated || '')).join('|');
    if (peopleCache && peopleCache.sig === sig) return peopleCache.list;
    const list = [];
    const ok = c => /^[\p{L}][\p{L}'’ .-]{1,28}$/u.test(c) && !/^(male|female|surname|surnames)$/i.test(c);
    for (const p of src) {
      const nation = p.title.replace(/^common names of /i, '').trim();
      const races = [];
      let race = null;
      for (const raw of String(p.md || '').split('\n')) {
        const line = raw.replace(/\\/g, '').trim();
        if (!line) continue;
        const bold = /^\*\*([^*]+)\*\*:?$/.exec(line);
        if (bold && !/male|female|surname/i.test(bold[1])) { race = { name: norm(bold[1]), m: [], f: [], s: [] }; races.push(race); continue; }
        if (/male/i.test(line) && /female/i.test(line)) continue;   // the header row
        if (!race) continue;
        const cells = (line.includes('|') ? line.split('|') : line.split(/\t+|\s{3,}/)).map(c => norm(c.replace(/\*+/g, ''))).filter(Boolean);
        if (cells.length !== 3 || !cells.every(ok)) continue;
        race.m.push(cells[0]); race.f.push(cells[1]); race.s.push(cells[2]);
      }
      for (const r of races) if (r.m.length >= 5 && r.s.length >= 5) list.push({ key: `p:${nation}:${r.name}`, nation, race: r.name, m: r.m, f: r.f, s: r.s, page: p });
    }
    peopleCache = { sig, list };
    return list;
  }

  // ───────── the chain ─────────
  const ORDER = 3;
  function train(names) {
    const model = [new Map(), new Map(), new Map(), new Map()];   // by how many letters of context
    const lens = [], onsets = new Set(), codas = new Set();
    for (const raw of names) {
      const w = lower(raw); if (!w) continue;
      lens.push(w.length);
      // how the world's words begin and end (so a made one doesn't start "Ng" or end "dld" unless theirs do)
      for (const part of w.split(/[\s-]+/)) if (part.length >= 2) { onsets.add(part.slice(0, 2)); codas.add(part.slice(-2)); }
      const s = '^'.repeat(ORDER) + w + '$';
      for (let i = ORDER; i < s.length; i++) for (let k = 1; k <= ORDER; k++) {
        const ctxs = s.slice(i - k, i), c = s[i];
        let m = model[k].get(ctxs); if (!m) { m = new Map(); model[k].set(ctxs, m); }
        m.set(c, (m.get(c) || 0) + 1);
      }
    }
    lens.sort((a, b) => a - b);
    const q = f => lens[Math.min(lens.length - 1, Math.floor(f * lens.length))] || 6;
    return { model, onsets, codas, min: Math.max(3, q(0.08)), max: Math.max(6, q(0.95) + 1), known: new Set(names.map(lower)) };
  }
  function draw(M, rnd) {
    let s = '^'.repeat(ORDER);
    for (let guard = 0; guard < 40; guard++) {
      // the longest context it has seen at least twice, else a shorter one
      let pick = null;
      for (let k = ORDER; k >= 1; k--) { const m = M.model[k].get(s.slice(-k)); if (m && ([...m.values()].reduce((a, b) => a + b, 0) >= (k === 1 ? 1 : 2))) { pick = m; break; } }
      if (!pick) break;
      const total = [...pick.values()].reduce((a, b) => a + b, 0);
      let r = rnd() * total, c = '$';
      for (const [ch, n] of pick) { if ((r -= n) <= 0) { c = ch; break; } }
      if (c === '$') break;
      s += c;
    }
    return s.slice(ORDER);
  }
  const VOWELS = 'aeiouyæøåäöüéèêëáàâíìîïóòôõúùûōūāē';
  const VOWEL = new RegExp('[' + VOWELS + ']', 'i'), CLUSTER = new RegExp('[^' + VOWELS + "\\s'-]{4,}", 'i');
  const title = w => w.replace(/(^|[\s-])(\p{L})/gu, (m0, a, b) => a + b.toUpperCase())
    .replace(/\b(Of|The|And|Upon|On|In|Von|Van|Di|De|Da|Du)\b/g, (m0, x, i) => i ? x.toLowerCase() : x)
    .replace(/'(\p{L})(\p{L}{2,})/gu, (m0, a, b) => "'" + a.toUpperCase() + b);   // Sah'Raza, but Baron's
  function plausible(w, M) {
    if (w.length < M.min || w.length > M.max) return false;
    if (M.known.has(w) || /(.)\1\1/.test(w) || /^[\s'-]|[\s'-]$/.test(w) || w.split(' ').length > 3) return false;
    if (/['-]{2}|\s['-]|['-]\s/.test(w)) return false;
    // every word long enough, with a vowel in it, and no great pile-up of consonants
    for (const part of w.split(/[\s-]+/)) {
      if (part.length < 2 || !VOWEL.test(part) || CLUSTER.test(part)) return false;
      const on = part.slice(0, 2), co = part.slice(-2), v = c => VOWEL.test(c);
      if (!v(on[0]) && !v(on[1]) && !M.onsets.has(on)) return false;
      if (!v(co[0]) && !v(co[1]) && !M.codas.has(co)) return false;
    }
    // not just one of the world's names with a letter changed
    for (const k of M.known) if (Math.abs(k.length - w.length) <= 1 && lev(k, w) <= 1) return false;
    return true;
  }
  function forge(style, n, rnd) {
    rnd = rnd || Math.random;
    const M = style._m || (style._m = train(style.names));
    const out = new Set();
    for (let tries = 0; tries < n * 80 && out.size < n; tries++) {
      const w = draw(M, rnd).replace(/\s+/g, ' ').trim();
      if (plausible(w, M)) out.add(title(w));
    }
    return [...out];
  }
  // a whole person: a given name (a man's or a woman's) and a surname, each made in the people's own style
  function forgePeople(p, sex, n) {
    // their own names count four times over; everyone else's of the same kind once (more to learn from, same flavour)
    const others = k => people().filter(q => q !== p).flatMap(q => q[k]);
    const mk = k => ({ names: [].concat(p[k], p[k], p[k], p[k], others(k)) });
    const G = { m: p._gm || (p._gm = mk('m')), f: p._gf || (p._gf = mk('f')), s: p._gs || (p._gs = mk('s')) };
    const out = [];
    const surnames = forge(G.s, n * 2);
    for (let i = 0; out.length < n && i < n * 4; i++) {
      const sx = sex === 'm' || sex === 'f' ? sex : (Math.random() < 0.5 ? 'm' : 'f');
      const g = forge(G[sx], 1)[0], s = surnames[i % Math.max(1, surnames.length)];
      if (g && s) out.push({ name: `${g} ${s}`, sex: sx });
    }
    return out;
  }
  function lev(a, b) {
    if (a === b) return 0;
    const v = new Array(b.length + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = v[0]; v[0] = i;
      for (let j = 1; j <= b.length; j++) { const tmp = v[j]; v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
    }
    return v[b.length];
  }
  // one name for a place in a nation (or anywhere): for the ✦ beside a place's name
  function suggest(nation) {
    const list = styles();
    const st = (nation && list.find(s => s.key === 'n:' + nation)) || list.find(s => s.key === 'all');
    return st ? forge(st, 1)[0] || '' : '';
  }

  // ───────── the page ─────────
  const kept = () => { try { const v = JSON.parse(localStorage.getItem(KEEP) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saveKept = v => { try { localStorage.setItem(KEEP, JSON.stringify(v.slice(0, 300))); } catch (e) { /* private */ } };
  let tab = null, current = null, person = null, sex = 'any', out = [];
  function page(art, params) {
    const list = styles(), folk = people();
    if (!tab) tab = folk.length ? 'people' : 'places';
    const want = params && params.get('style');
    if (want) { const f = folk.find(p => p.key === want), s = list.find(x => x.key === want); if (f) { tab = 'people'; person = f; } else if (s) { tab = s.kind === 'gods' ? 'gods' : 'places'; current = s; } }
    if (!person || !folk.includes(person)) person = folk[0] || null;
    if (!current || current.kind === 'gods' || !list.includes(current)) current = list.find(s => s.kind !== 'gods') || list[0];
    const copy = n => (navigator.clipboard ? navigator.clipboard.writeText(n) : Promise.reject()).then(() => toast(`Copied “${n}”`), () => prompt('The name', n));
    const keep = (n, from) => { const k = kept(); if (!k.some(x => x.name === n)) { k.unshift({ name: n, style: from }); saveKept(k); } render(); };
    const unkeep = n => { saveKept(kept().filter(x => x.name !== n)); render(); };
    const styleNow = () => tab === 'gods' ? list.find(s => s.kind === 'gods') : current;
    const fromLabel = () => tab === 'people' && person ? `${person.race} of ${person.nation}` : (styleNow() || {}).label || '';
    const hammer = () => {
      if (tab === 'people') out = person ? forgePeople(person, sex, 16).map(x => x.name) : [];
      else { const st = styleNow(); out = st ? forge(st, 18) : []; }
      render();
    };
    function render() {
      const k = kept();
      const tabBtn = (id, label, n) => h('button', { class: 'nftab' + (tab === id ? ' on' : ''), disabled: !n || null, onclick: () => { tab = id; hammer(); } }, label);
      let picker = null, learn = '';
      if (tab === 'people' && person) {
        const nations = [...new Set(folk.map(p => p.nation))];
        picker = h('div', { class: 'nfpick' },
          h('div', { class: 'nfstyles' }, ...folk.map(p => h('button', { class: 'nfchip' + (p === person ? ' on' : ''), onclick: () => { person = p; hammer(); } },
            p.race, nations.length > 1 ? h('span', null, p.nation) : null))),
          h('div', { class: 'nfsex' }, ...[['any', 'Anyone'], ['m', 'Men'], ['f', 'Women']].map(([v, l]) => h('button', { class: sex === v ? 'on' : null, onclick: () => { sex = v; hammer(); } }, l))));
        learn = `Learning from the ${person.m.length + person.f.length} given names and ${person.s.length} surnames of the ${person.race} of ${person.nation}, like ${person.m.slice(0, 2).concat(person.f.slice(0, 2)).join(', ')} and ${person.s.slice(0, 2).join(', ')}.`;
      } else if (tab === 'places' && current) {
        picker = h('div', { class: 'nfstyles' }, ...list.filter(s => s.kind !== 'gods').map(s => h('button', { class: 'nfchip' + (s === current ? ' on' : ''), onclick: () => { current = s; hammer(); } },
          s.label, h('span', null, s.names.length))));
        learn = `Learning from ${current.names.length} places${current.kind === 'nation' ? ' in ' + current.label : ''}, like ${current.names.slice().sort(() => Math.random() - 0.5).slice(0, 5).join(', ')}.`;
      } else if (tab === 'gods') {
        const st = styleNow();
        learn = st ? `Learning from the names of ${st.names.length} gods and titans, like ${st.names.slice(0, 5).join(', ')}.` : '';
      }
      fill(art,
        h('h1', { class: 'ptitle' }, 'The Name Forge'),
        h('div', { class: 'fromwiki' }, 'New names in the manner of the world’s own'),
        h('p', null, 'Pick what you need a name for and strike the anvil. Each kind learns which letters follow which from the names already in the world, so what it makes sounds as though it belongs there without being a copy of any of them. Click a name to copy it; ☆ keeps it.'),
        h('div', { class: 'nftabs' }, tabBtn('people', 'People', folk.length), tabBtn('places', 'Places', list.length), tabBtn('gods', 'Gods', list.some(s => s.kind === 'gods'))),
        picker,
        tab === 'people' && !folk.length ? h('p', { class: 'muted' }, 'Write a page called “Common Names of …” (a nation) with lists of men’s and women’s names and surnames, and the forge learns from it.') : null,
        learn ? h('p', { class: 'small muted nflearn' }, learn) : null,
        h('div', { class: 'nfanvil' }, h('button', { class: 'btn primary nfstrike', onclick: hammer }, '⚒ Strike the anvil'),
          tab === 'people' && person ? h('a', { class: 'small', href: ctx.wikiHref(person.page.path), style: 'margin-left:12px' }, `The names of ${person.nation} ›`) : null),
        out.length ? h('div', { class: 'nfout' + (tab === 'people' ? ' folk' : '') }, ...out.map(n => h('div', { class: 'nfname' },
          h('button', { class: 'nm', title: 'Copy', onclick: () => copy(n) }, n),
          h('button', { class: 'kp', title: 'Keep this one', onclick: () => keep(n, fromLabel()) }, k.some(x => x.name === n) ? '★' : '☆')))) : null,
        h('h2', null, `Kept${k.length ? ' · ' + k.length : ''}`),
        k.length ? [h('div', { class: 'nfkept' }, ...k.map(x => h('span', { class: 'nfk' }, h('button', { class: 'nm', title: `${x.style}: copy`, onclick: () => copy(x.name) }, x.name), h('button', { class: 'x', title: 'Let it go', onclick: () => unkeep(x.name) }, '×')))),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', onclick: () => copy(k.map(x => x.name).join('\n')) }, 'Copy them all'))] : h('p', { class: 'muted small' }, 'Names you keep stay here, in this browser.'));
    }
    hammer();
    document.title = `The Name Forge · ${ctx.siteName || 'the wiki'}`;
    return true;
  }
  return { page, suggest, styles, people, forge, forgePeople };
};
