/* The wiki: pages laid out like Wikipedia, kept on the server, edited here by admins.
 *
 * Page text is Markdown with a few wiki extras:
 *   [[Page]], [[Page|text]], [[Page#Heading]]   links to other pages ([[Category:Name]] files the page in a category)
 *   {{Infobox | name = … | image = … | caption = … | Field = value … }}   the box at the side (one per section is fine)
 *   {{Short description|…}}   the line under the title        {{Main|Page}} {{See also|A|B}} {{Further|Page}}   notes at the top of a section
 *   {{Quote|text|who}}         a set-off quotation            {{gm}} … {{/gm}}   only admins see this (removed for everyone else by the server)
 *   [^1] … [^1]: text          references, listed at the end (or where {{Reflist}} is)
 *   a picture on its own line becomes a framed thumbnail with its alt text as the caption
 *
 * app.js calls ValanarWiki(ctx) once; ctx carries the page list and the map's helpers. */
'use strict';
window.ValanarWiki = function (ctx) {
  const { h, $, escHTML, natural, toast, wkey, slug } = ctx;
  const SV = window.VALANAR_SERVER || {};
  const admin = !!SV.admin;
  const site = SV.siteName || 'the wiki';
  const api = (url, opts) => fetch('/api/site' + url, Object.assign({ credentials: 'same-origin' }, opts)).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.body = j; throw e; }
    return j;
  });
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fmtDate = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  // ───────── reading the extras ─────────

  // {{…}} templates (they can hold [[links]] and line breaks); returns [{ start, end, name, args: [..], named: {..} }]
  function findTemplates(md) {
    const out = [];
    let i = 0;
    while ((i = md.indexOf('{{', i)) >= 0) {
      let depth = 0, j = i;
      for (; j < md.length - 1; j++) {
        if (md[j] === '{' && md[j + 1] === '{') { depth++; j++; }
        else if (md[j] === '}' && md[j + 1] === '}') { depth--; j++; if (!depth) break; }
      }
      if (depth) break;
      const inner = md.slice(i + 2, j - 1);
      const parts = []; let cur = '', d = 0;
      for (let k = 0; k < inner.length; k++) {
        const c = inner[k], two = inner.slice(k, k + 2);
        if (two === '[[' || two === '{{') { d++; cur += two; k++; continue; }
        if (two === ']]' || two === '}}') { d--; cur += two; k++; continue; }
        if (c === '|' && !d) { parts.push(cur); cur = ''; continue; }
        cur += c;
      }
      parts.push(cur);
      const name = parts.shift().trim(), args = [], named = {}, order = [];
      for (const p of parts) {
        const m = /^\s*([^=\n[\]{}]{1,60}?)\s*=([\s\S]*)$/.exec(p);
        if (m) { const k = m[1].trim(); named[k] = m[2].trim(); order.push(k); } else args.push(p.trim());
      }
      out.push({ start: i, end: j + 1, name, lname: name.toLowerCase(), args, named, order });
      i = j + 1;
    }
    return out;
  }
  // [[links]] → <a>; categories are collected
  function links(md, page, cats) {
    return md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((chunk, i) => i % 2 ? chunk : chunk.replace(
      /!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (all, target, head, alias) => {
        const t = target.trim(), hd = (head || '').trim();
        const cm = /^category\s*:\s*(.+)$/i.exec(t);
        if (cm) { if (all.startsWith('[[') && cats) { cats.add(cm[1].trim()); return ''; } }
        if (cm) return `<a class="wl" href="${escHTML(catHref(cm[1].trim()))}">${escHTML(alias ? alias.trim() : cm[1].trim())}</a>`;
        const file = ctx.fileByName && ctx.fileByName(t);
        if (all.startsWith('!') && file && /^image\//.test(file.type)) return `![${alias || ''}](${file.url})`;
        const p = t ? ctx.findPage(t) : page;
        const text = alias ? alias.trim() : t ? (hd ? `${t} › ${hd}` : t) : hd;
        if (!p) return admin ? `<a class="wl missing" href="${escHTML(newHref(t))}" title="No page called “${escHTML(t)}” yet: click to write it">${escHTML(text)}</a>`
          : `<span class="wl missing" title="No page called “${escHTML(t)}” yet">${escHTML(text)}</span>`;
        return `<a class="wl" href="${escHTML(ctx.wikiHref(p.path, hd))}">${escHTML(text)}</a>`;
      })).join('');
  }
  const inlineMD = (s, page) => window.marked ? window.marked.parseInline(links(String(s), page, null)) : escHTML(s);
  const catHref = c => '#/wiki/Category:' + encodeURIComponent(c);
  const newHref = t => '#/wiki/Special:New?title=' + encodeURIComponent(t);

  // Markdown → { html, cats, short } for a page
  function render(md, page) {
    md = String(md || '').replace(/^﻿/, '').replace(/^---\n((?:[\w .-]+:.*\n|[ \t]+.*\n|-.*\n)*)---\n/, '');
    if (ctx.lore) md = ctx.lore.promoteHeadings(md);   // bold or italic lines standing for headings (Google Docs) become headings
    const cats = new Set();
    let short = '';
    // references
    const notes = new Map(), order = [];
    md = md.replace(/^\[\^([^\]\s]+)\]:\s*(.+(?:\n(?: {2,}|\t).+)*)/gm, (all, id, text) => { notes.set(id, text.replace(/\n\s+/g, ' ')); return ''; });
    md = md.replace(/\[\^([^\]\s]+)\]/g, (all, id) => {
      if (!notes.has(id)) return all;
      let n = order.indexOf(id); if (n < 0) { order.push(id); n = order.length - 1; }
      return `<sup class="ref" id="ref-${escHTML(id)}"><a href="#fn-${escHTML(id)}">[${n + 1}]</a></sup>`;
    });
    const refList = () => order.length ? `<ol class="references">${order.map(id => `<li id="fn-${escHTML(id)}"><a class="up" href="#ref-${escHTML(id)}" title="Back">^</a> ${inlineMD(notes.get(id), page)}</li>`).join('')}</ol>` : '';
    let usedReflist = false;
    // templates, from the end so the positions stay right
    const tpls = findTemplates(md);
    for (const t of tpls.reverse()) {
      let rep = null;
      if (t.lname === 'infobox' || t.lname.startsWith('infobox ')) {
        const named = t.named, title = named.name || named.title || (page ? page.title : '');
        const img = named.image ? `<tr><td colspan="2" class="ibimg"><img src="${escHTML(named.image.replace(/^\[\[|\]\]$/g, ''))}" alt="">${named.caption ? `<div class="ibcap">${inlineMD(named.caption, page)}</div>` : ''}</td></tr>` : '';
        const rows = t.order.filter(k => !['name', 'title', 'image', 'caption'].includes(k) && named[k]).map(k =>
          /^(section|header)\d*$/i.test(k) ? `<tr><th colspan="2" class="ibsec">${inlineMD(named[k], page)}</th></tr>`
            : `<tr><th scope="row">${escHTML(k)}</th><td>${inlineMD(named[k].replace(/\n/g, '<br>'), page)}</td></tr>`).join('');
        rep = `\n\n<table class="infobox"><tr><th colspan="2" class="ibtitle">${inlineMD(title, page)}</th></tr>${img}${rows}</table>\n\n`;
      } else if (t.lname === 'short description') { short = t.args[0] || ''; rep = ''; }
      else if (t.lname === 'main' || t.lname === 'see also' || t.lname === 'further') {
        const lead = { main: t.args.length > 1 ? 'Main articles: ' : 'Main article: ', 'see also': 'See also: ', further: 'Further information: ' }[t.lname];
        rep = `\n\n<div class="hatnote">${lead}${t.args.map(a => links(`[[${a}]]`, page)).join(', ')}</div>\n\n`;
      } else if (t.lname === 'quote' || t.lname === 'quotation') {
        rep = `\n\n<blockquote class="wquote"><p>${inlineMD(t.args[0] || t.named.text || '', page)}</p>${t.args[1] || t.named.author ? `<cite>— ${inlineMD(t.args[1] || t.named.author, page)}</cite>` : ''}</blockquote>\n\n`;
      } else if (t.lname === 'gm') rep = '\n\n<div class="gmonly" title="Only admins see this">\n\n';
      else if (t.lname === '/gm') rep = '\n\n</div>\n\n';
      else if (t.lname === 'reflist' || t.lname === 'references') { rep = '\n\n<!--REFLIST-->\n\n'; usedReflist = true; }
      else if (t.lname === 'clear') rep = '\n\n<div style="clear:both"></div>\n\n';
      else if (t.lname === 'tbd' || t.lname === 'todo') rep = `<span class="tbd" title="Still to be written">${escHTML(t.args[0] || 'to be written')}</span>`;
      if (rep != null) md = md.slice(0, t.start) + rep + md.slice(t.end);
    }
    md = links(md, page, cats);
    let html = window.marked ? window.marked.parse(md, { gfm: true, breaks: true }) : '<pre>' + escHTML(md) + '</pre>';
    if (order.length) html = usedReflist ? html.replace('<!--REFLIST-->', refList()) : html + `<h2>References</h2>${refList()}`;
    return { html, cats: [...cats], short };
  }

  // A page's body, ready in the article: headings with ids, thumbnails, tables, outside links
  function body(md, page) {
    const r = render(md, page);
    const el = h('div', { class: 'md wikitext' });
    el.innerHTML = sanitize(r.html);
    const seen = new Set();
    for (const hd of el.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      let id = 'h-' + slug(hd.textContent), n = 2;
      while (seen.has(id)) id = 'h-' + slug(hd.textContent) + '-' + n++;
      seen.add(id); hd.id = id;
    }
    for (const a of el.querySelectorAll('a[href]')) if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; a.classList.add('ext'); }
    for (const img of el.querySelectorAll('img')) img.loading = 'lazy';
    // a picture alone in its paragraph: a thumbnail with a caption
    for (const p of el.querySelectorAll('p')) {
      const kids = [...p.childNodes].filter(n => !(n.nodeType === 3 && !n.textContent.trim()) && n.nodeName !== 'BR');
      if (kids.length === 1 && kids[0].nodeName === 'IMG') {
        const img = kids[0], cap = img.getAttribute('alt') || '';
        const pos = /\b(left|center|centre)\b/i.exec(img.getAttribute('title') || '');
        const fig = h('figure', { class: 'thumb' + (pos ? ' ' + pos[1].toLowerCase().replace('centre', 'center') : '') }, img.cloneNode(), cap ? h('figcaption', null, cap) : null);
        fig.querySelector('img').addEventListener('click', () => lightbox(img.src, cap));
        p.replaceWith(fig);
      }
    }
    for (const t of el.querySelectorAll('table:not(.infobox)')) { t.classList.add('wikitable'); t.replaceWith(h('div', { class: 'tablewrap' }, t.cloneNode(true))); }
    // names of other pages, folders and parts link themselves (the first mention in each part)
    if (ctx.lore) { const sec = sectionsOf(el); try { ctx.lore.autoLink(el, page, { level: sec ? sec.level : 2 }); } catch (e) { console.warn('links', e); } }
    return { el, cats: r.cats, short: r.short };
  }
  // what Markdown lets through that shouldn't be (pages are written by admins, but imports come from outside)
  function sanitize(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    for (const bad of t.content.querySelectorAll('script, iframe, object, embed, style, link, meta, form, base')) bad.remove();
    for (const el of t.content.querySelectorAll('*')) for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp)))/i.test(a.value))) el.removeAttribute(a.name);
    }
    return t.innerHTML;
  }
  function lightbox(src, cap) {
    const box = h('div', { class: 'wlightbox', onclick: () => box.remove() }, h('img', { src, alt: '' }), cap ? h('div', { class: 'cap' }, cap) : null);
    document.body.append(box);
  }

  // ───────── links between pages ─────────
  const linkTargets = p => [...new Set([...String(p.md).matchAll(/\[\[([^\]|#]*)/g)].map(m => m[1].trim()).filter(Boolean))];
  const linksHere = page => {
    if (!ctx.lore) return ctx.pages().filter(p => p !== page && linkTargets(p).some(t => ctx.findPage(t) === page));
    const ix = ctx.lore.index(), key = ctx.isOwner(page) ? 'f:' + page.folders.join('/') : 'p:' + page.path, from = ix.inn.get(key);
    if (!from) return [];
    return [...from.keys()].map(k => k.startsWith('p:') ? ctx.findPage(k.slice(2)) : ctx.ownerOf(k.slice(2))).filter(p => p && p !== page);
  };
  const categoriesOf = p => [...String(p.md).matchAll(/\[\[\s*category\s*:\s*([^\]|]+)/gi)].map(m => m[1].trim());

  // ───────── the left column: contents of this page, or every page ─────────
  let navTab = 'contents', filter = '';
  function renderNav(page, art) {
    const nav = $('#wikiNav');
    const heads = art ? [...art.querySelectorAll('.wikitext > h2, .wikitext > h3, .wikitext > h4')] : [];
    const tab = heads.length ? navTab : 'pages';   // pages without headings have no contents to show
    const tabs = h('div', { class: 'wtabs' },
      h('button', { class: tab === 'contents' ? 'on' : null, disabled: !heads.length || null, onclick: () => { navTab = 'contents'; renderNav(page, art); } }, 'Contents'),
      h('button', { class: tab === 'pages' ? 'on' : null, onclick: () => { navTab = 'pages'; renderNav(page, art); } }, 'Pages'));
    const links = h('div', { class: 'wsitelinks' },
      h('a', { href: '#/wiki' }, 'All pages and files'),
      mainPage() ? h('a', { href: ctx.wikiHref(mainPage().path) }, 'Main page') : null,
      h('a', { href: '#/wiki/Special:Timeline' }, 'Timeline'),
      h('a', { href: '#/library' }, 'Library'),
      h('a', { href: '#/observatory' }, 'Observatory'),
      h('a', { href: '#/wiki/Special:Random' }, 'Random page'),
      ctx.names ? h('a', { href: '#/wiki/Special:Names' }, 'The Name Forge') : null,
      h('a', { href: '#/wiki/Special:Recent' }, 'Recent changes'),
      h('a', { href: '#/wiki/Special:Categories' }, 'Categories'),
      admin ? h('a', { href: '#/wiki/Special:New' }, '+ New page') : null,
      admin ? h('a', { href: '#/wiki/Special:Import' }, 'Import a document') : null,
      // what you looked at lately (pages and places on the map)
      (() => { const rec = ctx.recent ? ctx.recent().filter(r => !(r.kind === 'page' && page && r.key === page.path)).slice(0, 6) : [];
        return rec.length ? h('div', { class: 'wrecent' }, h('div', { class: 'wrh' }, 'Recently viewed'),
          ...rec.map(r => r.kind === 'page' ? h('a', { href: ctx.wikiHref(r.key), title: r.title }, h('span', { class: 'k' }, '¶'), r.title)
            : h('a', { href: '#/map', title: `${r.title}, on the map`, onclick: e => { e.preventDefault(); ctx.goToPlace(r.key); } }, h('span', { class: 'k' }, '◆'), r.title))) : null; })());
    let content;
    if (tab === 'contents') {
      const top = h('a', { href: '#', class: 'top', onclick: e => { e.preventDefault(); $('#wikiMain').scrollTop = 0; } }, '(Top)');
      content = h('div', { class: 'wtoc' }, top, ...heads.map(el => h('a', { href: ctx.wikiHref(page.path, headText(el)), class: 'l' + el.tagName[1], 'data-id': el.id,
        onclick: e => { e.preventDefault(); history.replaceState(null, '', ctx.wikiHref(page.path, headText(el))); el.scrollIntoView({ block: 'start' }); } }, headText(el))));
      spyOn(content);
    } else {
      const inp = h('input', { id: 'wikiFilter', type: 'search', placeholder: 'Filter pages', value: filter, autocomplete: 'off', spellcheck: 'false',
        oninput: e => { filter = e.target.value.trim(); tree.replaceChildren(...treeKids(page)); } });
      const tree = h('div', { id: 'wikiTree' }, ...treeKids(page));
      content = h('div', { class: 'wpages' }, inp, tree);
      setTimeout(() => { const on = tree.querySelector('a.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }, 0);
    }
    nav.replaceChildren(tabs, content, links);
  }
  function treeKids(page) {
    const cur = page && page.path, pages = ctx.pages();
    const link = (p, hint) => {
      const a = h('a', { href: ctx.wikiHref(p.path), class: (p.path === cur ? 'on' : '') + (p.gmOnly ? ' gm' : '') || null, title: p.gmOnly ? 'GM only' : null }, p.title, hint ? h('span', { class: 'hint' }, hint) : null);
      // the page being read: its parts under it
      if (p.path !== cur || !ctx.lore || filter) return a;
      const parts = ctx.lore.headingsOf(p).heads.filter(x => x.top && (admin || !x.empty));
      return parts.length ? h('div', { class: 'tparts' }, a, ...parts.map(x => h('a', { class: 'tpart' + (x.empty ? ' empty' : ''), href: ctx.lore.sectionHref(p, x.name) }, x.name))) : a;
    };
    if (filter) {
      const q = wkey(filter);
      const hits = pages.filter(p => !ctx.isOwner(p) && (wkey(p.title).includes(q) || wkey(p.folders.join(' ')).includes(q)));
      return hits.length ? hits.map(p => link(p, p.folders.join(' / '))) : [h('p', { class: 'empty' }, 'No pages match.')];
    }
    const root = { dirs: new Map(), pages: [] };
    for (const p of pages) {
      let node = root;
      for (const f of p.folders) { if (!node.dirs.has(f)) node.dirs.set(f, { dirs: new Map(), pages: [] }); node = node.dirs.get(f); }
      if (!ctx.isOwner(p)) node.pages.push(p);
    }
    const openDirs = new Set(page ? page.folders.map((f, i) => page.folders.slice(0, i + 1).join('/')) : []);
    const build = (node, prefix) => [
      ...[...node.dirs.keys()].sort(natural).map(name => {
        const key = prefix ? prefix + '/' + name : name;
        const own = ctx.ownerOf(key), here = page && own === page;
        return h('details', { open: openDirs.has(key) || null }, h('summary', null, h('a', { class: 'tfolder' + (here ? ' on' : ''), href: ctx.folderHref(key), title: `${name}: the folder’s page` }, name)),
          h('div', { class: 'kids' }, build(node.dirs.get(name), key)));
      }),
      ...node.pages.slice().sort((a, b) => natural(a.title, b.title)).map(p => link(p))
    ];
    return build(root, '');
  }
  // the contents list follows the reading position
  let spy = null;
  function spyOn(list) {
    const main = $('#wikiMain');
    if (spy) main.removeEventListener('scroll', spy);
    spy = () => {
      const items = [...list.querySelectorAll('a[data-id]')]; let cur = null;
      for (const a of items) { const el = document.getElementById(a.dataset.id); if (el && el.getBoundingClientRect().top < 140) cur = a; }
      for (const a of items) a.classList.toggle('on', a === cur);
    };
    main.addEventListener('scroll', spy, { passive: true });
    spy();
  }
  const mainPage = () => (SV.mainPage && ctx.findPage(SV.mainPage)) || ctx.indexPage();

  // ───────── a page ─────────
  function tabsFor(page, active) {
    if (!admin || !page) return null;
    return h('div', { class: 'wptabs' },
      h('a', { href: ctx.wikiHref(page.path), class: active === 'read' ? 'on' : null }, 'Read'),
      h('a', { href: '#/wiki/Special:Edit/' + page.id, class: active === 'edit' ? 'on' : null }, 'Edit'),
      h('a', { href: '#/wiki/Special:History/' + page.id, class: active === 'history' ? 'on' : null }, 'History'),
      h('span', { class: 'grow' }),
      h('button', { title: page.gmOnly ? 'Only admins see this page' : 'Everyone who can see the wiki sees this page', class: 'gmtoggle' + (page.gmOnly ? ' on' : ''),
        onclick: () => api('/wiki/' + page.id, json('PUT', { gmOnly: !page.gmOnly })).then(reloadTo(page.id)).catch(e => toast(e.message, true)) }, page.gmOnly ? 'GM only' : 'Visible to players'),
      h('button', { title: 'Put this page in the bin (it can be restored from Files › Bin)', onclick: () => {
        if (!confirm(`Put “${page.title}” in the bin?`)) return;
        api('/wiki/' + page.id, { method: 'DELETE' }).then(() => ctx.reload()).then(() => { toast('In the bin'); location.hash = ctx.wikiHref(mainPage() ? mainPage().path : ''); }).catch(e => toast(e.message, true));
      } }, 'Delete'));
  }
  const reloadTo = id => () => ctx.reload().then(() => { const p = ctx.pages().find(x => x.id === id); if (p) { location.hash = ctx.wikiHref(p.path); ctx.route(); } });

  // ───────── the bar at the top: home, where you are, the page's sections, search, page colours ─────────
  const HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>';
  const sectionHref = (page, text) => '#/wiki/' + page.path.split('/').map(encodeURIComponent).join('/') + '?s=' + encodeURIComponent(text);
  function renderTop(page, opts = {}) {
    const main = $('#wikiMain');
    let top = $('#wikiTop');
    if (!top) { top = h('div', { id: 'wikiTop' }); main.prepend(top); }
    const crumbs = h('div', { class: 'wcrumbs' },
      h('a', { class: 'whome', href: '#/wiki', title: 'The wiki’s front page', html: HOME + `<span>${escHTML(site)} wiki</span>` }),
      ...(page ? page.folders.map((f, i) => [h('span', { class: 'sep' }, '›'), h('a', { href: ctx.folderHref(page.folders.slice(0, i + 1).join('/')) }, f)]).flat() : []),
      page && !ctx.isOwner(page) ? [h('span', { class: 'sep' }, '›'), opts.section ? h('a', { href: ctx.wikiHref(page.path) }, page.title) : h('b', null, page.title)] : null,
      opts.parent ? [h('span', { class: 'sep' }, '›'), h('a', { href: sectionHref(page, opts.parent) }, opts.parent)] : null,
      opts.section ? [h('span', { class: 'sep' }, '›'), h('b', null, opts.section)] : null,
      !page && opts.label ? [h('span', { class: 'sep' }, '›'), h('b', null, opts.label)] : null);
    // the page's parts, each to read on its own
    const list = (opts.sections || []).map(x => typeof x === 'string' ? { name: x, depth: 0 } : x);
    const tops = list.filter(x => !x.depth).length;
    const sects = list.length ? h('select', { class: 'wsects', title: 'Read one part of this page on its own',
      onchange: e => { location.hash = e.target.value ? sectionHref(page, e.target.value) : ctx.wikiHref(page.path); } },
      h('option', { value: '' }, opts.section ? '↩ The whole page' : `Sections (${tops})`),
      ...list.map(x => h('option', { value: x.name, selected: x.name === opts.section || null }, '\u2003'.repeat(x.depth) + (x.depth ? '· ' : '') + x.name + (x.empty ? ' (not written yet)' : '')))) : null;
    top.replaceChildren(...[h('button', { class: 'navbtn', title: 'Pages', onclick: () => document.body.classList.toggle('wiki-nav-open') }, '☰'),
      crumbs, sects, searchBox(), ctx.themePicker ? ctx.themePicker() : null].filter(Boolean));
  }
  // search: page titles and the headings inside pages; Enter goes to the first, or to every file and page
  function searchBox() {
    const res = h('div', { class: 'wres', hidden: true });
    let hits = [], on = 0;
    const inp = h('input', { type: 'search', placeholder: `Search ${ctx.pages().length} pages…`, autocomplete: 'off', spellcheck: 'false',
      oninput: () => find(), onfocus: () => { if (inp.value.trim()) find(); },
      onkeydown: e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); on = Math.max(0, Math.min(hits.length - 1, on + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
        if (e.key === 'Enter') { e.preventDefault(); const q = inp.value.trim(); if (!q) return; res.hidden = true; location.hash = hits[on] ? hits[on].href : '#/files/:search/' + encodeURIComponent(q); }
        if (e.key === 'Escape') { res.hidden = true; inp.blur(); }
      } });
    const draw = () => res.replaceChildren(...hits.map((x, i) => h('a', { href: x.href, class: i === on ? 'on' : null, onmousedown: e => e.preventDefault() }, h('b', null, x.title), h('span', null, x.sub))),
      h('a', { class: 'all', href: '#/files/:search/' + encodeURIComponent(inp.value.trim()), onmousedown: e => e.preventDefault() }, `Search every page and file for “${inp.value.trim()}” ›`));
    function find() {
      const q = wkey(inp.value.trim());
      if (q.length < 2) { res.hidden = true; return; }
      const pages = ctx.pages(), out = [];
      for (const p of pages) if (wkey(p.title).includes(q)) out.push({ title: ctx.isOwner(p) ? p.folders[p.folders.length - 1] : p.title, sub: ctx.isOwner(p) ? 'Folder' : p.folders.join(' › ') || 'Page', href: ctx.wikiHref(p.path), rank: wkey(p.title).startsWith(q) ? 0 : 1 });
      for (const p of pages) for (const m of String(p.md).matchAll(/^#{1,4}\s+(.+?)\s*#*\s*$/gm)) {
        const t = m[1].replace(/[*_`[\]]/g, '').trim();
        if (t && wkey(t).includes(q) && wkey(t) !== wkey(p.title)) out.push({ title: t, sub: 'In ' + p.title, href: sectionHref(p, t), rank: 2 });
      }
      hits = out.sort((a, b) => a.rank - b.rank || natural(a.title, b.title)).slice(0, 12); on = 0;
      res.hidden = false; draw();
    }
    inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 150));
    return h('div', { class: 'wsearch' }, inp, res);
  }
  // The parts of a page that can be read on their own: its highest headings that come more than once
  // (## for most pages, # where a page uses them for its parts), with what follows each up to the next.
  function sectionsOf(el) {
    const hs = [...el.children].filter(c => /^H[1-4]$/.test(c.tagName));
    for (let lv = 1; lv <= 4; lv++) { const at = hs.filter(c => +c.tagName[1] === lv); if (at.length >= 2) return { level: lv, heads: at }; }
    return null;
  }
  function sectionNodes(sec, head) {
    const out = [];
    for (let n = head.nextElementSibling; n; n = n.nextElementSibling) {
      if (/^H[1-6]$/.test(n.tagName) && +n.tagName[1] <= sec.level) break;
      out.push(n);
    }
    return out;
  }
  const headText = el => [...el.childNodes].filter(n => !(n.classList && (n.classList.contains('hsec') || n.classList.contains('tbdsec')))).map(n => n.textContent).join('').trim();

  // Parts with nothing written in them yet ("Text here."): players don't see them; admins see them greyed, to fill in.
  function markEmpty(el) {
    // single lines that are only a template's prompt ("Cultural Norms: [Influence on societal values…]")
    const PROMPT = /^\s*[-*•]?\s*[^:\n]{1,40}:\s*(\[[^\]]{6,}\]\s*)+$/;
    for (const blk of el.querySelectorAll('p, li')) {
      const lines = [[]];
      for (const n of [...blk.childNodes]) { if (n.nodeName === 'BR') lines.push([]); lines[lines.length - 1].push(n); }
      for (const line of lines) {
        const text = line.filter(n => n.nodeName !== 'BR').map(n => n.textContent).join('');
        if (!PROMPT.test(text)) continue;
        if (!admin) for (const n of line) n.remove();
        else for (const n of line) if (n.nodeType === 1) n.classList.add('placeholder'); else if (n.nodeType === 3 && n.textContent.trim()) { const sp = h('span', { class: 'placeholder' }, n.textContent); n.replaceWith(sp); }
      }
      if (!admin && !blk.textContent.trim()) blk.remove();
      else if (!admin) while (blk.firstChild && blk.firstChild.nodeName === 'BR') blk.firstChild.remove();
    }
    const kids = [...el.children], gone = new Set();
    kids.forEach((hd, i) => {
      if (!/^H[1-6]$/.test(hd.tagName) || gone.has(hd)) return;
      const lv = +hd.tagName[1], range = [];
      for (let j = i + 1; j < kids.length; j++) { if (/^H[1-6]$/.test(kids[j].tagName) && +kids[j].tagName[1] <= lv) break; range.push(kids[j]); }
      const text = range.filter(n => !/^H[1-6]$/.test(n.tagName)).map(n => n.textContent).join(' ');
      if (!ctx.lore || !ctx.lore.isEmptyText(text)) return;
      if (!admin) { hd.remove(); gone.add(hd); for (const n of range) { n.remove(); gone.add(n); } return; }
      hd.classList.add('emptysec'); hd.append(h('span', { class: 'tbdsec', title: 'Players don’t see this heading until something is written under it' }, 'not written yet'));
      for (const n of range) if (!/^H[1-6]$/.test(n.tagName)) n.classList.add('placeholder');
    });
  }

  // Hovering a link to another page shows what's there
  let hoverT = null, hoverCard = null;
  function hideCard() { clearTimeout(hoverT); if (hoverCard) { hoverCard.remove(); hoverCard = null; } }
  document.addEventListener('mouseover', e => {
    const a = e.target.closest && e.target.closest('a.wl:not(.missing), .warticle a[href^="#/"], #wikiArticle a[href^="#/wiki/"], #wikiArticle a[href^="#/files/"]');
    if (!a || !ctx.lore || a.closest('#wikiTop, #wikiNav, .wres, .secnav')) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => {
      const c = ctx.lore.card(a.getAttribute('href')); if (!c) return;
      hideCard();
      hoverCard = h('div', { class: 'wcard' }, h('div', { class: 'wck' }, c.where), h('b', null, c.title), c.text ? h('p', null, c.text) : null);
      document.body.append(hoverCard);
      const r = a.getBoundingClientRect(), w = hoverCard.offsetWidth, ht = hoverCard.offsetHeight;
      hoverCard.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
      hoverCard.style.top = (r.bottom + ht + 12 < innerHeight ? r.bottom + 6 : r.top - ht - 6) + 'px';
    }, 350);
  });
  document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('a')) hideCard(); });
  window.addEventListener('hashchange', hideCard);

  // came here by "Fill a gap": say so, and offer the editor (at this heading) or another one
  function gapBanner(page, name) {
    let g = null; try { g = sessionStorage.getItem('valanar-gap'); } catch (e) { /* */ }
    if (!g || g !== page.path + '\n' + (name || '')) return null;
    return h('div', { class: 'gapbar' }, h('b', null, 'Not written yet'), h('span', null, ' · picked at random from the unfinished parts'),
      admin ? h('a', { class: 'btn primary sm', href: '#/wiki/Special:Edit/' + page.id + (name ? '?at=' + encodeURIComponent(name) : '') }, 'Write it') : null,
      h('a', { class: 'btn sm', href: '#/wiki/Special:Unfinished' }, 'Another one ›'));
  }
  function renderPage(page, asked, section) {
    const art = $('#wikiArticle');
    renderTop(page, { label: page ? null : 'Not found' });
    if (!page) {
      const want = asked ? asked.split('/').pop() : 'Not found';
      art.replaceChildren(h('h1', { class: 'ptitle' }, want),
        h('p', { class: 'muted' }, `There is no page called “${want}” in ${site} yet.`),
        admin ? h('p', null, h('a', { class: 'btn primary', href: newHref(want) }, `Write “${want}”`)) : null,
        mainPage() ? h('p', null, h('a', { href: ctx.wikiHref(mainPage().path) }, '← Main page')) : null);
      renderNav(null, null);
      return;
    }
    const b = body(page.md, page);
    const ownTitle = b.el.firstElementChild && b.el.firstElementChild.tagName === 'H1';
    if (ownTitle) b.el.firstElementChild.remove();   // the page's own top heading is its title
    markEmpty(b.el);
    // the page's parts: each heading gets a link to read it on its own, and the bar lists them
    const sec = sectionsOf(b.el);
    // two parts with the same heading get told apart: "DeLerange", "DeLerange (2)"
    const seen = {}, names = sec ? sec.heads.map(hd => { const t = headText(hd), k = slug(t); seen[k] = (seen[k] || 0) + 1; return seen[k] > 1 ? `${t} (${seen[k]})` : t; }) : [];
    if (sec) sec.heads.forEach((hd, i) => { if (!hd.classList.contains('emptysec')) hd.append(h('a', { class: 'hsec', href: sectionHref(page, names[i]), title: 'Read this part on its own' }, '⤢ on its own')); });
    // every heading (not only the parts) can be read on its own too: the dropdown lists them under their part
    const all = [...b.el.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')];
    const seenAll = {}, allNames = all.map(hd => { const t = headText(hd), k = slug(t); seenAll[k] = (seenAll[k] || 0) + 1; return seenAll[k] > 1 ? `${t} (${seenAll[k]})` : t; });
    const outline = sec ? all.map((hd, i) => ({ name: allNames[i], depth: +hd.tagName[1] - sec.level, empty: hd.classList.contains('emptysec') })).filter(x => x.depth >= 0 && x.depth <= 2 && (admin || !x.empty)) : [];
    // one part only (?s=): its heading as the title, then what follows it
    let want = section ? names.findIndex(n => slug(n) === slug(section)) : -1;
    const any = section && want < 0 ? allNames.findIndex(n => slug(n) === slug(section)) : -1;
    if (section && (want >= 0 || any >= 0)) {
      const hd = want >= 0 ? sec.heads[want] : all[any], lvl = +hd.tagName[1];
      const nodes = sectionNodes({ level: lvl }, hd), part = h('div', { class: 'md wikitext' });
      for (const n of nodes) part.append(n);
      // the part it sits in (for a heading below the page's parts)
      const parentIdx = want >= 0 ? -1 : (() => { for (let i = any - 1; i >= 0; i--) if (+all[i].tagName[1] < lvl) return i; return -1; })();
      const sib = want >= 0 ? names : allNames.filter((n, i) => +all[i].tagName[1] === lvl && (() => { let pi = -1; for (let j = i - 1; j >= 0; j--) if (+all[j].tagName[1] < lvl) { pi = j; break; } return pi === parentIdx; })());
      const name = want >= 0 ? names[want] : allNames[any], si = sib.indexOf(name), prev = sib[si - 1], next = sib[si + 1];
      renderTop(page, { sections: outline, section: name, parent: parentIdx >= 0 ? allNames[parentIdx] : null });
      art.replaceChildren(...[tabsFor(page, 'read'),
        h('h1', { class: 'ptitle' }, name, page.gmOnly ? h('span', { class: 'gmbadge', title: 'Only admins see this page' }, 'GM only') : null),
        h('div', { class: 'secof' }, 'Part of ', h('a', { href: ctx.wikiHref(page.path) }, ctx.isOwner(page) ? page.folders[page.folders.length - 1] : page.title),
          parentIdx >= 0 ? [' › ', h('a', { href: sectionHref(page, allNames[parentIdx]) }, allNames[parentIdx])] : null, ` · ${si + 1} of ${sib.length}`),
        gapBanner(page, name),
        part,
        h('div', { class: 'secnav' }, prev ? h('a', { href: sectionHref(page, prev) }, '‹ ' + prev) : h('span'), h('a', { class: 'mid', href: ctx.wikiHref(page.path) }, 'The whole page'),
          next ? h('a', { href: sectionHref(page, next) }, next + ' ›') : h('span'))].filter(Boolean));
      renderNav(page, art);
      document.title = `${name} · ${page.title} · ${site}`;
      return;
    }
    renderTop(page, { sections: outline });
    const here = linksHere(page);
    const foot = h('div', { class: 'wfoot' },
      b.cats.length ? h('div', { class: 'catlinks' }, h('a', { href: '#/wiki/Special:Categories' }, b.cats.length > 1 ? 'Categories' : 'Category'), ': ',
        b.cats.map((c, i) => [i ? ' | ' : '', h('a', { href: catHref(c) }, c)])) : null,
      here.length ? h('details', { class: 'linkshere' }, h('summary', null, `Mentioned on ${here.length} other page${here.length === 1 ? '' : 's'}`),
        h('ul', null, here.sort((a, c) => natural(a.title, c.title)).map(p => h('li', null, h('a', { href: ctx.wikiHref(p.path) }, ctx.isOwner(p) ? p.folders[p.folders.length - 1] : p.title))))) : null,
      h('p', { class: 'lastmod' }, page.updated ? `This page was last edited on ${fmtDate(page.updated)}${page.by ? ' by ' + page.by : ''}.` : ''));
    art.replaceChildren(...[tabsFor(page, 'read'),
      h('h1', { class: 'ptitle' }, page.title, page.gmOnly ? h('span', { class: 'gmbadge', title: 'Only admins see this page' }, 'GM only') : null),
      h('div', { class: 'fromwiki' }, `From ${site}`),
      b.short ? h('div', { class: 'shortdesc' }, b.short) : null,
      b.el, ctx.wikiOnMap(page), foot].filter(Boolean));
    renderNav(page, art);
  }

  // ───────── special pages ─────────
  function renderSpecial(name, arg, params) {
    const art = $('#wikiArticle');
    renderNav(null, null);
    renderTop(null, { label: name.replace(/^Category:/, 'Category: ') });
    const pages = ctx.pages();
    // a random part that hasn't been written yet (or a page with nothing in it), to fill in
    if (name === 'Unfinished') {
      const gaps = unfinished();
      if (!gaps.length) { art.replaceChildren(h('h1', { class: 'ptitle' }, 'Nothing unfinished'), h('p', null, 'Every part of every page has something in it. Well done.')); return true; }
      const g = gaps[Math.floor(Math.random() * gaps.length)];
      try { sessionStorage.setItem('valanar-gap', g.page.path + '\n' + (g.name || '')); } catch (e) { /* */ }
      location.replace(g.name ? ctx.lore.sectionHref(g.page, g.name) : ctx.wikiHref(g.page.path) + (ctx.isOwner(g.page) ? '' : ''));
      return true;
    }
    if (name === 'Names' && ctx.names) return ctx.names.page(art, params);
    if (name === 'Random') { const p = pages[Math.floor(Math.random() * pages.length)]; if (p) location.replace(ctx.wikiHref(p.path)); return true; }
    if (name === 'Recent') {
      const list = pages.filter(p => p.updated).sort((a, b) => b.updated - a.updated).slice(0, 100);
      art.replaceChildren(h('h1', { class: 'ptitle' }, 'Recent changes'), h('div', { class: 'fromwiki' }, `The latest edits to ${site}`),
        h('ul', { class: 'speclist' }, list.map(p => h('li', null, h('span', { class: 'when' }, fmtDate(p.updated)), ' · ', h('a', { href: ctx.wikiHref(p.path) }, p.title),
          p.by ? h('span', { class: 'muted' }, ' · ' + p.by) : null))));
      return true;
    }
    if (name === 'Categories') {
      const by = new Map();
      for (const p of pages) for (const c of categoriesOf(p)) { if (!by.has(c)) by.set(c, []); by.get(c).push(p); }
      art.replaceChildren(h('h1', { class: 'ptitle' }, 'Categories'),
        by.size ? h('ul', { class: 'speclist cols' }, [...by.keys()].sort(natural).map(c => h('li', null, h('a', { href: catHref(c) }, c), h('span', { class: 'muted' }, ` (${by.get(c).length})`))))
          : h('p', { class: 'muted' }, 'No categories yet. Add [[Category:Name]] anywhere on a page to file it.'));
      return true;
    }
    if (name.toLowerCase().startsWith('category:')) {
      const c = name.slice(9).trim(), members = pages.filter(p => categoriesOf(p).some(x => wkey(x) === wkey(c))).sort((a, b) => natural(a.title, b.title));
      const groups = new Map(); for (const p of members) { const L = p.title[0].toUpperCase(); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(p); }
      art.replaceChildren(h('h1', { class: 'ptitle' }, 'Category: ' + c), h('div', { class: 'fromwiki' }, `From ${site}`),
        h('p', null, `${members.length} page${members.length === 1 ? '' : 's'} in this category.`),
        h('div', { class: 'catgroups' }, [...groups].map(([L, ps]) => h('div', null, h('h3', null, L), h('ul', null, ps.map(p => h('li', null, h('a', { href: ctx.wikiHref(p.path) }, p.title))))))));
      return true;
    }
    if (library && /^(Timeline|Constellation|Bookshelf|Book)$/.test(name)) { document.body.classList.add('wiki-wide'); return library.show(name, arg, params, art); }
    if (!admin && /^(New|Edit|History|Import)$/.test(name)) { art.replaceChildren(h('h1', null, 'Admins only'), h('p', null, 'Log in as an admin to edit the wiki.')); return true; }
    if (name === 'New') { edit(null, { title: params.get('title') || '', folder: params.get('folder') || '' }); return true; }
    if (name === 'Edit') { const p = pages.find(x => x.id === arg); if (p) edit(p, null, params && params.get('at')); else art.replaceChildren(h('h1', null, 'No such page')); return true; }
    if (name === 'History') { const p = pages.find(x => x.id === arg); if (p) history_(p); else art.replaceChildren(h('h1', null, 'No such page')); return true; }
    if (name === 'Import') { importer(); return true; }
    return false;
  }

  // ───────── editing ─────────
  let dirty = false;
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  // the parts not written yet: headings with nothing (or only a placeholder) under them, and pages with nothing at all
  function unfinished() {
    const out = [], L = ctx.lore;
    if (!L) return out;
    for (const p of ctx.pages()) {
      if (p.deleted) continue;
      let hs; try { hs = L.headingsOf(p).heads; } catch (e) { continue; }
      for (const hd of hs) if (hd.empty) out.push({ page: p, name: hd.name });
      if (!hs.length && L.isEmptyText(L.clean(p.md.replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[\s*category\s*:[^\]]*\]\]/gi, '')))) out.push({ page: p, name: '' });
    }
    return out;
  }
  ctx.unfinishedCount = () => unfinished().length;
  function edit(page, draft, at) {
    const art = $('#wikiArticle');
    draft = draft || {};
    const folders = [...new Set(ctx.allFolders())].sort(natural);
    const title = h('input', { class: 'etitle', value: page ? page.title : draft.title || '', placeholder: 'Page title' });
    const folder = h('input', { class: 'efolder', value: page ? page.folder : draft.folder || '', placeholder: 'Folder (e.g. History/Kings)', list: 'wfolders' });
    const gm = h('input', { type: 'checkbox', checked: page ? page.gmOnly : !!draft.gmOnly });
    const ta = h('textarea', { class: 'esrc', spellcheck: 'true', value: page ? page.md : draft.md || '' });
    ta.value = page ? page.md : draft.md || '';
    if (at) setTimeout(() => {   // straight to the part to write (Special:Edit/<id>?at=<heading>)
      const want = ctx.wkey(at.replace(/\s*\(\d+\)$/, '')), lines = ta.value.split('\n');
      let i = lines.findIndex(l => /^\s*(#{1,6}\s|\*\*|__)/.test(l) && ctx.wkey(ctx.lore ? ctx.lore.clean(l.replace(/^#+\s*/, '')) : l) === want);
      if (i < 0) i = lines.findIndex(l => ctx.wkey(ctx.lore ? ctx.lore.clean(l.replace(/^#+\s*/, '')) : l) === want);
      if (i < 0) return;
      const pos = lines.slice(0, i + 1).join('\n').length;
      ta.focus(); ta.setSelectionRange(pos, pos);
      ta.scrollTop = Math.max(0, i / lines.length * ta.scrollHeight - ta.clientHeight / 3);
    }, 60);
    const prev = h('div', { class: 'epreview' });
    const summary = h('input', { class: 'esum', placeholder: 'What did you change? (optional)', value: draft.summary || '' });
    let timer = null;
    const draw = () => { const b = body(ta.value, page || { title: title.value, path: title.value, folders: [] }); prev.replaceChildren(h('h1', { class: 'ptitle' }, title.value || 'Untitled'), b.short ? h('div', { class: 'shortdesc' }, b.short) : '', b.el); };
    ta.addEventListener('input', () => { dirty = true; clearTimeout(timer); timer = setTimeout(draw, 250); });
    title.addEventListener('input', () => { dirty = true; clearTimeout(timer); timer = setTimeout(draw, 250); });
    // toolbar
    const wrap = (a, b, ph) => {
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph || '';
      ta.setRangeText(a + sel + b, s, e, 'end');
      if (!ta.value.slice(s, e) && ph) { ta.selectionStart = s + a.length; ta.selectionEnd = s + a.length + sel.length; }
      ta.focus(); ta.dispatchEvent(new Event('input'));
    };
    const line = (text) => { const s = ta.selectionStart, before = ta.value.slice(0, s); const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''; ta.setRangeText(lead + text + '\n\n', s, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
    const tb = (label, title_, fn) => h('button', { type: 'button', title: title_, onclick: fn }, label);
    const pageList = h('datalist', { id: 'wpages' }, ...ctx.pages().map(p => h('option', { value: p.path })));
    const toolbar = h('div', { class: 'etools' },
      tb(h('b', null, 'B'), 'Bold (Ctrl+B)', () => wrap('**', '**', 'bold text')),
      tb(h('i', null, 'I'), 'Italic (Ctrl+I)', () => wrap('*', '*', 'italic text')),
      tb('H2', 'Section heading', () => line('## Heading')),
      tb('H3', 'Sub-heading', () => line('### Sub-heading')),
      h('span', { class: 'sep' }),
      tb('[[ ]]', 'Link to a page', () => {
        const t = prompt('Link to which page? (start typing; the full name works best)', ta.value.slice(ta.selectionStart, ta.selectionEnd));
        if (t) wrap('[[' + t.trim() + (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd) !== t ? '|' : ''), ']]', '');
      }),
      tb('Picture', 'A picture from Files (or upload one)', () => ctx.pickFile({ images: true }).then(f => { if (f) line(`![${f.name.replace(/\.[^.]+$/, '')}](${f.url})`); })),
      tb('Infobox', 'The box of facts at the side', () => line('{{Infobox\n| name = ' + (title.value || 'Name') + '\n| image = \n| caption = \n| Born = \n| Died = \n}}')),
      tb('Table', 'A table', () => line('| Heading | Heading |\n|---|---|\n| Cell | Cell |')),
      tb('Ref', 'A reference or footnote', () => { const n = (ta.value.match(/\[\^\d+\]:/g) || []).length + 1; wrap(`[^${n}]`, ''); ta.value += `\n\n[^${n}]: Source`; ta.dispatchEvent(new Event('input')); }),
      tb('Quote', 'A set-off quotation', () => line('{{Quote|The words.|Who said them}}')),
      tb('Main', 'A "Main article" note under a heading', () => line('{{Main|Page name}}')),
      tb('GM only', 'Only admins will see this part', () => wrap('{{gm}}\n', '\n{{/gm}}', 'Secret notes')),
      tb('Category', 'File the page in a category', () => { const c = prompt('Category name'); if (c) { ta.value = ta.value.replace(/\s*$/, '') + `\n\n[[Category:${c.trim()}]]\n`; ta.dispatchEvent(new Event('input')); } }),
      h('span', { class: 'grow' }),
      h('a', { href: '#', class: 'ehelp', onclick: e => { e.preventDefault(); help.hidden = !help.hidden; } }, 'Formatting help'));
    const help = h('div', { class: 'ehelpbox', hidden: true });
    help.innerHTML = '<b>**bold**</b>, <i>*italic*</i>, <code>## Heading</code>, <code>- list item</code>, <code>[[Page]]</code> or <code>[[Page|shown text]]</code>, <code>[[Category:Name]]</code>, <code>![caption](picture link)</code>, footnotes <code>text[^1]</code> then <code>[^1]: source</code>, and templates: <code>{{Infobox | name = … | Field = value}}</code>, <code>{{Short description|…}}</code>, <code>{{Main|Page}}</code>, <code>{{See also|A|B}}</code>, <code>{{Quote|words|who}}</code>, <code>{{gm}}secret{{/gm}}</code>, <code>{{TBD}}</code>.';
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**', 'bold text'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*', 'italic text'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });
    // pictures dropped or pasted into the text are uploaded to Files › Wiki pictures
    const upload = async file => {
      const f = await ctx.uploadFile(file, 'Wiki pictures').catch(e => { toast(e.message, true); return null; });
      if (f) line(`![${f.name.replace(/\.[^.]+$/, '')}](${f.url})`);
    };
    ta.addEventListener('drop', e => { const fs = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); fs.forEach(upload); } });
    ta.addEventListener('paste', e => { const fs = [...(e.clipboardData.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); fs.forEach(upload); } });
    const status = h('span', { class: 'estatus' });
    const save = async (force) => {
      const b = { title: title.value.trim(), folder: folder.value.trim(), md: ta.value, gmOnly: gm.checked, summary: summary.value.trim() };
      if (!b.title) { toast('Give the page a title', true); title.focus(); return; }
      status.textContent = 'Saving…';
      try {
        const r = page ? await api('/wiki/' + page.id, json('PUT', Object.assign(b, { baseRev: page.rev, force: !!force })))
          : await api('/wiki', json('POST', Object.assign(b, { source: draft.source })));
        dirty = false;
        await ctx.reload();
        toast('Saved');
        location.hash = ctx.wikiHref(r.page.path);
        ctx.route();
      } catch (e) {
        status.textContent = '';
        if (e.status === 409 && confirm(e.message + '. Save yours over it anyway? (Theirs stays in the history.)')) return save(true);
        toast(e.message, true);
      }
    };
    art.replaceChildren(...[tabsFor(page, 'edit'),
      h('div', { class: 'editor' },
        h('div', { class: 'ehead' }, title, folder, h('datalist', { id: 'wfolders' }, ...folders.map(f => h('option', { value: f }))), pageList,
          h('label', { class: 'egm', title: 'Only admins will see the page' }, gm, 'GM only')),
        toolbar, help,
        h('div', { class: 'esplit' }, ta, prev),
        h('div', { class: 'efoot' }, summary, status,
          h('button', { class: 'btn', onclick: () => { if (!dirty || confirm('Leave without saving?')) { dirty = false; history.back(); } } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => save() }, page ? 'Save changes' : 'Create page')))].filter(Boolean));
    document.body.classList.add('wiki-editing');
    draw();
    (page ? ta : title).focus();
  }

  // ───────── bringing documents in ─────────
  function importer() {
    const art = $('#wikiArticle');
    const out = h('div', { class: 'impout' });
    const go = async (promise) => {
      out.replaceChildren(h('p', { class: 'muted' }, 'Reading the document…'));
      try {
        const r = await promise;
        if (r.pictures) toast(`${r.pictures} picture${r.pictures === 1 ? '' : 's'} brought in too (Files › Wiki pictures › ${r.title || 'Imported'})`);
        if (r.picturesSkipped) toast(`${r.picturesSkipped} picture${r.picturesSkipped === 1 ? '' : 's'} couldn’t be brought in (a kind of picture browsers can’t show, or a link that had expired)`, true);
        edit(null, { title: r.title, md: r.md, source: r.source, summary: 'Imported' });
      }
      catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
    };
    const url = h('input', { type: 'url', placeholder: 'https://docs.google.com/document/d/…', class: 'impurl' });
    const file = h('input', { type: 'file', accept: '.md,.markdown,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      go(fetch('/api/site/wiki/import?name=' + encodeURIComponent(f.name), { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } })
        .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; }));
    });
    const paste = h('textarea', { rows: 6, placeholder: 'Or paste Markdown here' });
    art.replaceChildren(h('h1', { class: 'ptitle' }, 'Import a document'),
      h('p', null, 'Bring a document in as a new page. You see it in the editor before it’s saved. A bold title line becomes the page title, ',
        h('code', null, '**Field** - value'), ' lines under a heading become an infobox, links to Google Docs you’ve already imported become wiki links, and pictures in the document come along (into Files › Wiki pictures).'),
      h('h3', null, 'From a Google Doc'),
      h('p', { class: 'muted' }, 'The document must be shared as “Anyone with the link can view”.'),
      h('div', { class: 'row' }, url, h('button', { class: 'btn primary', onclick: () => url.value.trim() && go(api('/wiki/import', json('POST', { url: url.value.trim() }))) }, 'Import')),
      h('h3', null, 'From a file'),
      h('p', { class: 'muted' }, 'Markdown (.md, from Google Docs: File › Download › Markdown), Word (.docx) or plain text.'), file,
      h('h3', null, 'Pasted'), paste, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => paste.value.trim() && go(api('/wiki/import', json('POST', { text: paste.value }))) }, 'Use this text')),
      out);
  }

  // ───────── history ─────────
  async function history_(page) {
    const art = $('#wikiArticle');
    art.replaceChildren(tabsFor(page, 'history'), h('h1', { class: 'ptitle' }, page.title + ': history'), h('p', { class: 'muted' }, 'Loading…'));
    let r; try { r = await api(`/wiki/${page.id}/history`); } catch (e) { toast(e.message, true); return; }
    const view = h('div', { class: 'histview' });
    const show = async (rev, compare) => {
      const old = rev === page.rev ? { md: page.md, rev: page.rev } : (await api(`/wiki/${page.id}/history/${rev}`)).rev;
      if (compare) { view.replaceChildren(h('h2', null, `Changes from version ${rev} to the current one`), diff(old.md, page.md)); return; }
      const b = body(old.md, page);
      view.replaceChildren(h('div', { class: 'oldbanner' }, `Version ${rev} from ${fmtDate(old.updated)}${old.by ? ' by ' + old.by : ''}.`,
        rev !== page.rev ? h('button', { class: 'btn sm', onclick: () => { if (confirm('Make this version the current one? The current text stays in the history.'))
          api('/wiki/' + page.id, json('PUT', { md: old.md, title: old.title, folder: old.folder, summary: `Restored version ${rev}`, baseRev: page.rev })).then(reloadTo(page.id)).catch(e => toast(e.message, true)); } }, 'Restore this version') : null), b.el);
      view.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    const row = (v, cur) => h('tr', null, h('td', null, cur ? h('b', null, 'current') : v.rev), h('td', null, fmtDate(v.updated)), h('td', null, v.by || ''), h('td', null, v.summary || ''),
      h('td', null, h('button', { class: 'btn sm', onclick: () => show(cur ? page.rev : v.rev) }, 'View'), cur ? null : h('button', { class: 'btn sm', onclick: () => show(v.rev, true) }, 'Compare')));
    art.replaceChildren(tabsFor(page, 'history'), h('h1', { class: 'ptitle' }, page.title + ': history'),
      h('table', { class: 'wikitable histtable' }, h('tr', null, ...['Version', 'When', 'Who', 'Summary', ''].map(t => h('th', null, t))), row(r.current, true), ...r.revs.map(v => row(v))),
      r.revs.length ? null : h('p', { class: 'muted' }, 'No earlier versions yet.'), view);
  }
  // line by line, what was taken out and put in
  function diff(a, b) {
    const A = String(a).split('\n'), B = String(b).split('\n');
    const n = A.length, m = B.length;
    if (n * m > 4e6) return h('p', { class: 'muted' }, 'Too long to compare here.');
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push(['=', A[i]]); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { out.push(['+', B[j]]); j++; }
      else { out.push(['-', A[i]]); i++; }
    }
    // only the changes, with a line around them
    const keep = out.map((x, k) => x[0] !== '=' || (out[k - 1] && out[k - 1][0] !== '=') || (out[k + 1] && out[k + 1][0] !== '='));
    const rows = []; let gap = false;
    out.forEach((x, k) => { if (keep[k]) { rows.push(h('div', { class: 'd' + (x[0] === '+' ? ' add' : x[0] === '-' ? ' del' : '') }, h('span', null, x[0] === '=' ? ' ' : x[0]), x[1] || ' ')); gap = false; } else if (!gap) { rows.push(h('div', { class: 'd gap' }, '⋯')); gap = true; } });
    return h('div', { class: 'diff' }, rows.length ? rows : h('p', null, 'No differences.'));
  }

  const library = window.ValanarLibrary ? window.ValanarLibrary(Object.assign({}, ctx, { body, renderNav, renderTop, sectionsOf, sectionNodes, headText, markEmpty, admin, site })) : null;
  return {
    render(page, asked, section) { document.body.classList.remove('wiki-editing', 'wiki-wide'); if (library) library.leave(); renderPage(page, asked, section); },
    leave() { document.body.classList.remove('wiki-wide'); if (library) library.leave(); },
    special(name, arg, params) { document.body.classList.remove('wiki-editing', 'wiki-wide'); if (library) library.leave(); return renderSpecial(name, arg, params); },
    body, renderMarkdown: render, get dirty() { return dirty; }, set dirty(v) { dirty = v; },
    // a folder's introduction (its own page), for the folder's page
    intro(page) {
      const b = body(page.md, page);
      if (b.el.firstElementChild && b.el.firstElementChild.tagName === 'H1') b.el.firstElementChild.remove();
      markEmpty(b.el);
      const sec = sectionsOf(b.el);
      if (sec) for (const hd of sec.heads) if (!hd.classList.contains('emptysec')) hd.append(h('a', { class: 'hsec', href: sectionHref(page, headText(hd)), title: 'Read this part on its own' }, '⤢ on its own'));
      if (!b.el.textContent.trim()) return null;
      return { el: b.el, short: b.short };
    }
  };
};
