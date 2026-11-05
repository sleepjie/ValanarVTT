/* What the wiki knows about itself: every page, its parts and the folder it introduces; the names that link
 * themselves wherever they're mentioned; who mentions whom; the dated events for the timeline; and the long
 * documents for the bookshelf. Worked out from the pages as they are (nothing is written back), and again
 * whenever the pages change.
 *
 * ValanarLore(ctx) → { index(), autoLink(el, page), card(href), sectionHref(page, name), … } */
'use strict';
window.ValanarLore = function (ctx) {
  const { wkey, slug } = ctx;
  let cache = null, cacheFor = null;
  const index = () => { const ps = ctx.pages(); if (cache && cacheFor === ps) return cache; cacheFor = ps; cache = build(ps); return cache; };

  // ───────── reading Markdown loosely ─────────
  const clean = s => String(s || '').replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, (a, c) => '\u0000' + c.charCodeAt(0) + '\u0001').replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]#|]*)#?([^\]|]*)\]\]/g, (a, t, hd) => t || hd)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_`~]/g, '').replace(/\s+#+\s*$/, '').trim().replace(/\u0000(\d+)\u0001/g, (a, n) => String.fromCharCode(+n));
  // the page's text without code, templates' insides kept (they hold prose too)
  const prose = md => promoteHeadings(String(md || '').replace(/```[\s\S]*?```/g, '').replace(/^---\n[\s\S]*?\n---\n/, ''));
  // Documents brought in from Google Docs mark their parts with lines that are all bold or all italic rather than
  // headings: "**PRELUDE**", "**The Crown**", "*Royalists*". Those lines become headings (capitals over plain bold over
  // italic, all below any real # headings the page has). A line that ends like a sentence stays as it is.
  function promoteHeadings(md) {
    // "---" straight under a line of text (as Google Docs writes a rule) would make that line a heading: keep it a rule
    md = String(md || '').replace(/^([^\n|#>\s-][^\n]*)\n((?:-\s*){3,}|(?:=\s*){3,})$/gm, '$1\n\n---');
    // what Google Docs leaves behind: its contents list ("[**Foreword	1**](#foreword)"), heading anchors ("{#foreword}"), empty headings
    md = md.replace(/^\[\*{0,2}[^\]\n]*?\t\d+\*{0,2}\]\(#[^)\s]*\)[ \t]*$/gm, '').replace(/^(#{1,6}\s.*?)\s*\{#[^}\s]*\}\s*$/gm, '$1').replace(/^#{1,6}[ \t]*$/gm, '');
    const lines = md.split('\n');
    let fence = false;
    const pseudo = [], realLevels = new Set();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*```/.test(l)) { fence = !fence; continue; }
      if (fence) continue;
      const hm = /^(#{1,6})\s/.exec(l); if (hm) { realLevels.add(hm[1].length); continue; }
      const m = /^\s{0,3}(\*\*|__|\*|_)([^*_\n]{2,90}?)\1\s*:?\s*$/.exec(l);
      if (!m) continue;
      const text = m[2].trim();
      if (!/[\p{L}]/u.test(text) || /[.!?;,…"”’]$/.test(text) || /^[-–—“"‘'(\[]/.test(text)) continue;   // sentences, quotations and asides aren't headings
      const prev = (lines[i - 1] || '').trim(), next = lines.slice(i + 1).find(x => x.trim()) || '';
      if (prev && !/^(#{1,6}\s|---|\*\*\*|___|\{\{)/.test(prev)) continue;   // in the middle of a paragraph
      if (!next || /^\s*[|>]/.test(next)) continue;
      const kind = m[1].length === 2 ? (text === text.toUpperCase() && /\p{Lu}/u.test(text) ? 'caps' : 'bold') : 'italic';
      pseudo.push({ i, kind, text });
    }
    if (pseudo.length < 2) return md;
    const kinds = ['caps', 'bold', 'italic'].filter(k => pseudo.some(x => x.kind === k));
    const base = realLevels.size ? Math.max(...realLevels) + 1 : 2;
    for (const x of pseudo) lines[x.i] = '#'.repeat(Math.min(6, base + kinds.indexOf(x.kind))) + ' ' + x.text;
    return lines.join('\n');
  }
  const PLACEHOLDER = /^(?:text here\.?|tbd\.?|todo\.?|to be written\.?|coming soon\.?|placeholder\.?|\.\.\.|…|-|—)?$/i;
  // nothing written: empty, "Text here.", or only a template's labels and [prompts] ("Holy symbol: [Description]")
  const isEmptyText = t => {
    const x = String(t).replace(/\[[^\]]*\]/g, ' ').split('\n').map(l => l.replace(/^\s*[-*•]?\s*[^:\n]{1,40}:\s*$/, '').trim()).join(' ').replace(/\s+/g, ' ').trim();
    return PLACEHOLDER.test(x) || /^([^:]{1,40}:\s*)+$/.test(x);
  };

  // a page's headings: [{ level, text, slug, start, end, body }]; the first # line is the page's own title
  function headingsOf(page) {
    const md = prose(page.md), lines = md.split('\n'), out = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
      const m = !fence && /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
      if (m) out.push({ level: m[1].length, text: clean(m[2]), line: i });
    }
    const firstText = lines.findIndex(l => l.trim());
    if (out.length && out[0].level === 1 && out[0].line === firstText) out.shift();
    for (let k = 0; k < out.length; k++) {
      const hd = out[k];
      let stop = lines.length;
      for (let j = k + 1; j < out.length; j++) if (out[j].level <= hd.level) { stop = out[j].line; break; }
      const nextAny = k + 1 < out.length ? out[k + 1].line : lines.length;
      hd.body = lines.slice(hd.line + 1, stop).join('\n');
      hd.own = lines.slice(hd.line + 1, nextAny).join('\n');   // before its first sub-heading
      hd.empty = isEmptyText(clean(hd.body.replace(/^#{1,6}\s.*$/gm, '').replace(/\{\{[^}]*\}\}/g, '')));
    }
    // the parts it splits into: the highest heading level that comes more than once
    let top = 0;
    for (let lv = 1; lv <= 4 && !top; lv++) if (out.filter(x => x.level === lv).length >= 2) top = lv;
    // names told apart when two parts share a heading: "DeLerange", "DeLerange (2)"
    const seen = {};
    for (const hd of out) { const k = slug(hd.text); seen[k] = (seen[k] || 0) + 1; hd.name = seen[k] > 1 ? `${hd.text} (${seen[k]})` : hd.text; hd.slug = slug(hd.name); hd.top = hd.level === top; }
    return { heads: out, top };
  }
  // (always the wiki's own address: a folder's introduction is read part by part there too)
  const sectionHref = (page, name) => '#/wiki/' + page.path.split('/').map(encodeURIComponent).join('/') + '?s=' + encodeURIComponent(name);
  const folderHref = f => '#/files/' + f.split('/').map(encodeURIComponent).join('/');

  // ───────── dates: "1903BR", "~1900BR", "850/800BR", "2083SR/2084AV", "157 BR", "???AV" ─────────
  const ERA_SIGN = { BR: -1, SR: 1, AV: 1 };
  function parseDate(s) {
    s = String(s).replace(/[*_]/g, '').trim();
    const toks = [...s.matchAll(/(\d{1,5})\s*(BR|SR|AV)?/gi)];
    if (!/(BR|SR|AV)/i.test(s)) return null;
    if (!toks.length) return { year: null, end: null, approx: true, label: s };
    // a number takes the era written after it ("850/800BR", "2500+BR"), or else the one before it
    const ys = [];
    for (let i = 0; i < toks.length; i++) {
      const after = /(BR|SR|AV)/i.exec(s.slice(toks[i].index)), before = [...s.slice(0, toks[i].index).matchAll(/(BR|SR|AV)/gi)].pop();
      const era = (toks[i][2] || (after && after[1]) || (before && before[1]) || 'SR').toUpperCase();
      ys[i] = +toks[i][1] * ERA_SIGN[era];
    }
    return { year: Math.min(...ys), end: Math.max(...ys), approx: /[~+?]|c\./i.test(s), label: s };
  }
  const fmtYear = y => y == null ? '?' : y < 0 ? `${-y} BR` : `${y} SR`;

  // ───────── everything at once ─────────
  function build(pages) {
    const info = new Map();   // page → { heads, top, folderOf }
    for (const p of pages) info.set(p, headingsOf(p));
    const folders = new Set();
    for (const p of pages) for (let i = 1; i <= p.folders.length; i++) folders.add(p.folders.slice(0, i).join('/'));
    const owner = f => ctx.ownerOf(f);
    const hrefOf = p => ctx.wikiHref(p.path);   // (an introducing page's address is its folder's)
    const excerpt = p => {
      const t = clean(prose(p.md).replace(/\{\{[\s\S]*?\}\}/g, '').replace(/^#{1,6}\s.*$/gm, '').replace(/^\s*[|>-].*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
        .split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).find(x => x.length > 40 && !isEmptyText(x));
      return t ? (t.length > 260 ? t.slice(0, 257).replace(/\s+\S*$/, '') + '…' : t) : '';
    };

    // the names that link themselves: pages, folders, and the distinctive headings inside pages
    const STOP = new Set([wkey(ctx.siteName || ''), 'history', 'culture', 'geography', 'theology', 'index', 'overview', 'introduction', 'notes', 'references', 'contents', 'summary',
      'economy', 'military', 'society', 'religion', 'population', 'government', 'trade', 'magic and the arcane', 'see also', 'gallery', 'appearance', 'personality']);
    // headings made only of everyday words name nothing in particular
    const GENERIC = new Set(('the of and a an in on at to for by with from into under over before after across civil war wars battle battles siege sieges age ages era early late new old first second third last final ' +
      'great high low lesser greater grand king kings queen queens prince princes princess princesses crown crowns court courts council councils law laws tax taxes peace trial trials right rights royal ' +
      'house houses family families culture cultures religion religions trade economy military navy army armies history origins origin founding introduction conclusion conclusions epilogue prelude prologue ' +
      'aftermath legacy death life birth reign rule rules description appearance personality abilities ability powers power worship rituals ritual temple temples shrine shrines doctrine doctrines belief beliefs ' +
      'hierarchy membership notes note end course factions faction humans human elves elf dwarves dwarf orcs orc gnomes gnome halflings halfling draconic merchant merchants commonfolk nobility noble nobles ' +
      'sovereign gentry knights knight tribes tribe customs custom names name surnames list dialects dialect location locations architecture geography landmarks settlements structures population demographics ' +
      'society government politics relations magic arcane sea seas land lands city cities town towns village villages people peoples war-time years year day days night nights gods god goddess pantheon heroes hero ' +
      'other others general overview summary background physical traits trait heritage deep common half-orc order orders guild guilds school schools church').split(/\s+/));
    const targets = new Map();   // name → { href, kind, page, folder, title, sub }
    const add = (name, t) => {
      name = String(name || '').trim();
      if (name.length < 4 || !/^[\p{Lu}\d]/u.test(name) || STOP.has(wkey(name)) || targets.has(name)) return;
      targets.set(name, t);
    };
    const variants = n => {
      const out = [n], bare = n.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (bare !== n) out.push(bare);
      for (const x of [...out]) if (/^The\s+\S/.test(x) && x.split(/\s+/).length >= 2) out.push(x.replace(/^The\s+/, ''));
      for (const x of [...out]) if (/[’‘]/.test(x)) out.push(x.replace(/[’‘]/g, "'")); else if (/'/.test(x)) out.push(x.replace(/'/g, '’'));
      return out;
    };
    // pages first, then folders, then headings (a page's own name wins)
    for (const p of pages) {
      const own = ctx.isOwner(p);
      const t = own ? { href: folderHref(p.folders.join('/')), kind: 'folder', folder: p.folders.join('/'), page: p, title: p.folders[p.folders.length - 1] }
        : { href: hrefOf(p), kind: 'page', page: p, title: p.title };
      for (const v of variants(own ? t.title : p.title)) add(v, t);
    }
    for (const f of folders) { const name = f.split('/').pop(), o = owner(f); for (const v of variants(name)) add(v, { href: folderHref(f), kind: 'folder', folder: f, page: o, title: name }); }
    // Which words are names: across all the writing, they're capitalised even in the middle of a sentence
    // ("Emberloft", "Fane"), unlike everyday words that only are at the start of one ("Reputation", "Mage").
    const caps = new Map(), lows = new Map();
    for (const p of pages) {
      const text = prose(p.md).replace(/^#{1,6}\s.*$/gm, '.').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/[*_`]/g, '');
      for (const m of text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
        const w = m[0], k = w.toLowerCase();
        if (w[0] === k[0]) { lows.set(k, (lows.get(k) || 0) + 1); continue; }
        const before = text.slice(Math.max(0, m.index - 4), m.index);
        if (/(^|[.!?:;"“”>\n|(\-–—•+]\s*|^\s*)$/.test(before) || /\n\s*\d+[.)]\s*$/.test(before) || m.index === 0) continue;   // a sentence's or a list item's first word says nothing
        caps.set(k, (caps.get(k) || 0) + 1);
      }
    }
    const isName = w => { const k = w.toLowerCase(), c = caps.get(k) || 0, l = lows.get(k) || 0; return c > 0 && c >= l * 4; };
    // a heading that appears on two or more pages is a template heading ("Economy and Currency"), not a name
    const headCount = new Map();
    for (const [, inf] of info) for (const k of new Set(inf.heads.map(x => wkey(x.text)))) headCount.set(k, (headCount.get(k) || 0) + 1);
    // …and so is one used as a label on other pages ("Conflict Resolution: [Involvement in …]")
    for (const p of pages) for (const m of prose(p.md).matchAll(/^\s*[-*•]?\s*[*_]*([^:*_\n\[]{3,40}?)[*_]*\s*:/gm)) { const k = wkey(m[1]); if (headCount.has(k)) headCount.set(k, headCount.get(k) + 1); }
    for (const p of pages) for (const hd of info.get(p).heads) {
      if (headCount.get(wkey(hd.text)) > 1 || hd.empty || hd.name !== hd.text) continue;
      const words = hd.text.replace(/^(?:[IVXLC]+|\d+)[.)]\s+/, '').split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
      if (words.every(w => GENERIC.has(w.toLowerCase())) || !words.some(w => !GENERIC.has(w.toLowerCase()) && isName(w))) continue;   // "Civil War", "Reputation", "Mage"…
      const name = hd.text.replace(/^(?:[IVXLC]+|\d+)[.)]\s+/, '');   // "VI. The Primordial Sacrifice" → "The Primordial Sacrifice"
      for (const v of variants(name)) if (!/&/.test(v) || v.length < 40) add(v, { href: sectionHref(p, hd.name), kind: 'section', page: p, section: hd.name, title: hd.text, sub: p.title });
    }
    const names = [...targets.keys()].sort((a, b) => b.length - a.length);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
    const lookup = m => targets.get(m) || targets.get(m.replace(/\s+/g, ' '));

    // who mentions whom: written links ([[…]]) and names in the text
    const keyOfTarget = t => t.kind === 'folder' ? 'f:' + t.folder : 'p:' + t.page.path;
    const out = new Map(), inn = new Map();
    const link = (from, to, how) => {
      if (!to || to === from) return;
      if (!out.has(from)) out.set(from, new Map()); const o = out.get(from); o.set(to, (o.get(to) || 0) + (how === 'link' ? 3 : 1));
      if (!inn.has(to)) inn.set(to, new Map()); const i = inn.get(to); i.set(from, (i.get(from) || 0) + (how === 'link' ? 3 : 1));
    };
    for (const p of pages) {
      const me = ctx.isOwner(p) ? 'f:' + p.folders.join('/') : 'p:' + p.path;
      const md = prose(p.md);
      for (const m of md.matchAll(/\[\[([^\]|#]*)/g)) { const q = ctx.findPage(m[1].trim()); if (q) link(me, ctx.isOwner(q) ? 'f:' + q.folders.join('/') : 'p:' + q.path, 'link'); }
      if (re) {
        const text = md.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/^#{1,6}\s.*$/gm, ' ');
        for (const m of text.matchAll(re)) { const t = lookup(m[0]); if (t) link(me, keyOfTarget(t), 'name'); }
      }
    }

    // the timeline: dated list items (“- **1903BR** - *The Primordial Sacrifice*”), the ages they fall under,
    // and dates mentioned in passing
    const events = [], eras = [];
    let eraSource = null, most = 0;
    for (const p of pages) {
      const lines = prose(p.md).split('\n');
      let age = '', n = 0;
      const mine = [];
      for (let i = 0; i < lines.length; i++) {
        const hm = /^(#{1,3})\s+(.+)$/.exec(lines[i]);
        if (hm) { age = clean(hm[2]); continue; }
        const m = /^\s*[-*+]\s+(?:\*\*|__)(.+?)(?:\*\*|__)\s*[-–—:]?\s*(.*)$/.exec(lines[i]);
        const d = m && parseDate(m[1]);
        if (!d) continue;
        const desc = [];
        for (let j = i + 1; j < lines.length && /^(\t|\s{2,})\S/.test(lines[j]) && !/^\s*[-*+]\s+(\*\*|__)/.test(lines[j]); j++) desc.push(lines[j].trim());
        const title = m[2].trim().replace(/^[*_]+|[*_]+$/g, '').trim();
        mine.push({ year: d.year, end: d.end, approx: d.approx, label: d.label, title: clean(title), titleMd: title.replace(/^[*_]+|[*_]+$/g, ''), desc: desc.join(' '), page: p, age, line: i });
        n++;
      }
      events.push(...mine);
      if (n > most) { most = n; eraSource = { page: p, list: mine }; }
    }
    // undated ones ("???AV") go at the end of their age
    for (let k = 0; k < events.length; k++) if (events[k].year == null) {
      const before = events.slice(0, k).filter(e => e.page === events[k].page && e.year != null);
      const y = before.length ? Math.max(...before.map(e => e.end)) + 25 : null;
      events[k].year = events[k].end = y; events[k].unknown = true;
    }
    if (eraSource) {
      let last = null;
      for (const e of eraSource.list) if (e.age && (!last || last.name !== e.age)) { last = { name: e.age, start: e.year, end: e.end }; eras.push(last); } else if (last) last.end = Math.max(last.end, e.end);
      for (let k = 0; k < eras.length - 1; k++) eras[k].end = Math.max(eras[k].end, eras[k + 1].start);
    }
    // years mentioned in the middle of a sentence, on any page
    const passing = [];
    for (const p of pages) {
      const text = prose(p.md).split('\n').filter(l => !/^\s*[-*+]\s+(\*\*|__)[^*_]*(BR|SR|AV)/i.test(l) && !/^#/.test(l)).join('\n');
      for (const m of text.matchAll(/(?<![\p{L}\d])(~?\d{1,4})\s?(BR|SR|AV)\b/gu)) {
        const y = +m[1].replace('~', '') * ERA_SIGN[m[2]];
        if (events.some(e => e.page === p && e.year <= y && y <= e.end)) continue;
        const from = Math.max(text.lastIndexOf('.', m.index) + 1, text.lastIndexOf('\n', m.index) + 1);
        let to = text.slice(m.index).search(/[.!?](\s|$)|\n/); to = to < 0 ? text.length : m.index + to + 1;
        const sentence = clean(text.slice(from, to)).replace(/^\s*[-*+>]\s*/, '');
        if (sentence.length < 12) continue;
        passing.push({ year: y, end: y, label: m[0], title: sentence.length > 180 ? sentence.slice(0, 177) + '…' : sentence, page: p, passing: true });
      }
    }

    // the bookshelf: the long documents, and anything filed under [[Category:Books]]
    const books = pages.filter(p => !ctx.isOwner(p) && (p.md.length >= 9000 || /\[\[\s*category\s*:\s*books?\s*\]\]/i.test(p.md)))
      .map(p => ({ page: p, chapters: info.get(p).heads.filter(x => x.top), words: Math.round(clean(prose(p.md)).split(/\s+/).length) }));

    return { pages, info, folders: [...folders], targets, names, re, lookup, out, inn, events: events.sort((a, b) => a.year - b.year || a.line - b.line), passing, eras, eraSource, books, excerpt, keyOfTarget, hrefOf };
  }

  // ───────── links in a rendered page ─────────
  // Each name links the first time it's mentioned in each part of the page; never to the page itself.
  const SKIP = 'a, h1, h2, h3, h4, h5, h6, code, pre, .ibtitle, .infobox th, .hsec, .tbd, .secof, .wquote cite, figcaption';
  function autoLink(el, page, opts = {}) {
    const ix = index();
    if (!ix.re) return 0;
    const selfKeys = new Set();
    if (page) { selfKeys.add('p:' + page.path); if (ctx.isOwner(page)) selfKeys.add('f:' + page.folders.join('/')); }
    if (opts.folder) selfKeys.add('f:' + opts.folder);
    let seen = new Set(), count = 0;
    const level = opts.level || 0;
    const visit = root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      for (const n of nodes) {
        const s = n.nodeValue; if (!s || s.length < 4) continue;
        ix.re.lastIndex = 0;
        let m, last = 0; const parts = [];
        while ((m = ix.re.exec(s))) {
          const t = ix.lookup(m[0]); if (!t) continue;
          const key = ix.keyOfTarget(t) + (t.kind === 'section' ? '#' + t.section : '');
          if (selfKeys.has(ix.keyOfTarget(t)) || seen.has(key)) continue;
          seen.add(key);
          if (m.index > last) parts.push(document.createTextNode(s.slice(last, m.index)));
          const a = document.createElement('a');
          a.className = 'wl auto'; a.href = t.href; a.textContent = m[0];
          parts.push(a); last = m.index + m[0].length; count++;
        }
        if (!parts.length) continue;
        if (last < s.length) parts.push(document.createTextNode(s.slice(last)));
        n.replaceWith(...parts);
      }
    };
    for (const child of [...el.children]) {
      if (/^H[1-6]$/.test(child.tagName) && (!level || +child.tagName[1] <= level)) { seen = new Set(); continue; }
      visit(child);
    }
    return count;
  }

  // ───────── a little card for a link (hovering it) ─────────
  function card(href) {
    const ix = index();
    let t = null;
    for (const v of ix.targets.values()) if (v.href === href) { t = v; break; }
    if (!t) {
      const m = /^#\/wiki\/([^?]*)(?:\?([hs])=(.*))?$/.exec(href);
      if (m) { let path = m[1]; try { path = path.split('/').map(decodeURIComponent).join('/'); } catch (e) { /* as is */ } const p = ctx.findPage(path); if (p) t = { kind: 'page', page: p, title: p.title }; }
      const f = /^#\/files\/(.+)$/.exec(href);
      if (!t && f) { let path = f[1]; try { path = path.split('/').map(decodeURIComponent).join('/'); } catch (e) { /* as is */ } t = { kind: 'folder', folder: path, page: ctx.ownerOf(path), title: path.split('/').pop() }; }
    }
    if (!t) return null;
    let text = '';
    if (t.kind === 'section') {
      const hd = ix.info.get(t.page).heads.find(x => x.name === t.section);
      text = hd ? clean(hd.body.replace(/^#{1,6}\s.*$/gm, '').replace(/\{\{[\s\S]*?\}\}/g, '')).replace(/\s+/g, ' ').slice(0, 260) : '';
    } else if (t.page) text = ix.excerpt(t.page);
    if (!text && t.kind === 'folder') { const n = ix.pages.filter(p => (p.folders.join('/') + '/').startsWith(t.folder + '/')).length; text = `${n} page${n === 1 ? '' : 's'}`; }
    const where = t.kind === 'section' ? 'Part of ' + t.page.title : t.kind === 'folder' ? 'Folder' + (t.folder.includes('/') ? ' in ' + t.folder.split('/').slice(0, -1).join(' › ') : '') : (t.page.folders.join(' › ') || 'Page');
    return { title: t.title, where, text: text.length >= 258 ? text.replace(/\s+\S*$/, '') + '…' : text, kind: t.kind };
  }

  return { index, promoteHeadings, autoLink, card, sectionHref, folderHref, headingsOf, parseDate, fmtYear, clean, isEmptyText };
};
