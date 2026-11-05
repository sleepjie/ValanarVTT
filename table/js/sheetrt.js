/* Character sheet runtime: runs a Roll20-format sheet (HTML, CSS, sheet workers) in this page.
 *
 * The sheet's fields are named attr_<name>; their values live on the server with the character and arrive here.
 * Fields with disabled + a formula ("@{strength}+2") are worked out here for display. Repeating sections
 * (<fieldset class="repeating_x">) become lists of rows. Roll buttons fill in @{attributes} and ?{queries} and
 * send the roll to the table; action buttons and changes run the sheet's workers in a Web Worker.
 */
'use strict';
(function () {
const { $, h } = V;
const RS = window.RS = {};

// ───────────────────────── state ─────────────────────────

let char = null;           // { id, name, sheet, owners, canEdit }
let attrs = {};            // lower-case name -> string
const defaults = {};       // non-repeating name -> default value
const formulas = {};       // autocalc name -> formula
const sections = {};       // section name -> { tpl, fields: { field: { def, formula } }, container }
let root = null;           // div.charsheet
let worker = null;
let canEdit = false;
const pendingSave = { set: {}, remove: new Set() };
let saveTimer = 0;
let recalcUntil = 0;

const lc = s => String(s).toLowerCase();
const REP = /^repeating_([^_]+)_(-[^_]+)_(.+)$/;

// ───────────────────────── values ─────────────────────────

function sectionIds(sec) {
  const order = (attrs['_reporder_repeating_' + sec] || '').split(',').map(lc).filter(Boolean);
  const found = new Set();
  for (const k of Object.keys(attrs)) { const m = REP.exec(k); if (m && m[1] === sec) found.add(m[2]); }
  const ids = [...new Set(order)];
  for (const id of found) if (!ids.includes(id)) ids.push(id);
  return ids;
}
function rowDefault(name) {
  const m = REP.exec(name); if (!m) return undefined;
  const f = sections[m[1]] && sections[m[1]].fields[m[3]];
  return f ? (f.formula != null ? f.formula : f.def) : undefined;
}
function isFormula(name) {
  if (formulas[name] != null) return true;
  const m = REP.exec(name);
  return !!(m && sections[m[1]] && sections[m[1]].fields[m[3]] && sections[m[1]].fields[m[3]].formula != null);
}
// What @{name} stands for: the stored value, the field's default, or (for worked-out fields) its formula.
function rawValue(name) {
  name = lc(name);
  if (name === 'character_name') return char ? char.name : '';
  if (name === 'character_id') return char ? char.id : '';
  if (isFormula(name)) return formulas[name] != null ? formulas[name] : rowDefault(name);
  if (attrs[name] != null) return attrs[name];
  if (defaults[name] != null) return defaults[name];
  const d = rowDefault(name);
  return d != null ? d : undefined;
}

// Fill in @{...} (again and again, up to 99 levels as Roll20 does). row = { sec, id } for buttons inside a row.
function expandAttrs(text, row) {
  let out = String(text), n = 0;
  for (;;) {
    const next = out.replace(/@\{([^}]+)\}/g, (m, ref) => {
      let name = ref.trim();
      const bar = name.lastIndexOf('|');
      if (bar >= 0) name = name.slice(bar + 1);     // selected|x, target|x, Character Name|x: all this character
      name = lc(name);
      const idx = /^repeating_([^_]+)_\$(\d+)_(.+)$/.exec(name);
      if (idx) { const id = sectionIds(idx[1])[+idx[2]]; name = id ? `repeating_${idx[1]}_${id}_${idx[3]}` : ''; }
      else if (row && sections[row.sec] && sections[row.sec].fields[name]) name = `repeating_${row.sec}_${row.id}_${name}`;
      else if (row && name.startsWith(`repeating_${row.sec}_`) && name[11 + row.sec.length] !== '-') name = `repeating_${row.sec}_${row.id}_${name.slice(11 + row.sec.length)}`;
      const v = rawValue(name);
      return v == null ? '' : String(v);
    });
    if (next === out || ++n > 99) return next;
    out = next;
  }
}
// The number a worked-out field shows.
const calcCache = new Map();
function calcValue(name, row) {
  if (calcCache.has(name)) return calcCache.get(name);
  const f = rawValue(name);
  const text = expandAttrs(f, row);
  let v;
  try { v = R20.evaluate(text.replace(/\[\[|\]\]/g, ''), () => 0, []).total; v = Math.round(v * 1000) / 1000; }
  catch (e) { v = text; }
  calcCache.set(name, v);
  return v;
}

// ───────────────────────── building the sheet ─────────────────────────

// Keep &#123; and friends inside value="" attributes as text, so ?{queries} can still tell their braces apart.
function protect(html) {
  return html.replace(/(\svalue=")([^"]*)"/g, (m, a, v) => a + v.replace(/&(#\d+;?|#x[\da-f]+;?)/gi, '&amp;$1') + '"');
}
const ENT = { '&#123;': '{', '&#125;': '}', '&#124;': '|', '&#44;': ',', '&#64;': '@', '&#91;': '[', '&#93;': ']', '&#40;': '(', '&#41;': ')', '&#42;': '*', '&#58;': ':', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' };
function decode(s) {
  return s.replace(/&#(\d+);?|&#x([\da-f]+);?|&(amp|quot|lt|gt);/gi, (m, d, x, n) => d ? String.fromCharCode(+d) : x ? String.fromCharCode(parseInt(x, 16)) : ENT['&' + n.toLowerCase() + ';']);
}

function defaultOf(el) {
  const tag = el.tagName, type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'SELECT') { const o = el.querySelector('option[selected]') || el.querySelector('option'); return o ? (o.getAttribute('value') ?? o.textContent) : ''; }
  if (tag === 'TEXTAREA') return el.textContent;
  if (tag === 'IMG') return el.getAttribute('src') || '';
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return el.textContent;
  if (type === 'checkbox') return el.hasAttribute('checked') ? (el.getAttribute('value') ?? 'on') : '0';
  if (type === 'radio') return el.hasAttribute('checked') ? (el.getAttribute('value') ?? 'on') : undefined;
  return el.getAttribute('value') ?? '';
}
function formulaOf(el) {
  const v = el.getAttribute('value');
  return el.tagName === 'INPUT' && el.hasAttribute('disabled') && v && /@\{/.test(v) ? v : null;
}

// Roll20's translation keys: data-i18n (text), -placeholder, -title, -label, -aria-label
RS.translate = function (el) {
  const tr = RS.tr || {}, has = k => k && Object.prototype.hasOwnProperty.call(tr, k);
  if (!Object.keys(tr).length) return;
  for (const e of el.querySelectorAll('[data-i18n]')) {
    const k = e.getAttribute('data-i18n'); if (!has(k)) continue;
    const v = String(tr[k]);
    if (!/[<&]/.test(v)) { e.textContent = v; continue; }
    const t = document.createElement('template'); t.innerHTML = v;   // some translations carry a little markup
    for (const x of t.content.querySelectorAll('script, iframe, object, embed, style')) x.remove();
    for (const x of t.content.querySelectorAll('*')) for (const at of [...x.attributes]) if (/^on|^(src|href)$/i.test(at.name)) x.removeAttribute(at.name);
    e.replaceChildren(t.content);
  }
  for (const a of ['placeholder', 'title', 'label', 'aria-label', 'alt'])
    for (const e of el.querySelectorAll(`[data-i18n-${a}]`)) { const k = e.getAttribute('data-i18n-' + a); if (has(k)) e.setAttribute(a, tr[k]); }
  for (const e of el.querySelectorAll('[data-i18n-list]')) {   // sort a list's items by their translated text
    const items = [...e.querySelectorAll(':scope > [data-i18n-list-item]')];
    items.sort((x, y) => (tr[x.getAttribute('data-i18n-list-item')] || '').localeCompare(tr[y.getAttribute('data-i18n-list-item')] || ''));
    for (const it of items) e.append(it);
  }
};
RS.build = function (html, css, tr) {
  let workerCode = '';
  RS.tr = tr || {};
  html = html.replace(/<script type="text\/worker">([\s\S]*?)<\/script>/gi, (m, code) => { workerCode += code + '\n'; return ''; })
             .replace(/<rolltemplate[\s\S]*?<\/rolltemplate>/gi, '')
             .replace(/<charmancer[\s\S]*?<\/charmancer>/gi, '');   // Roll20's character builder needs its compendium
  root = h('div', { class: 'charsheet' });
  root.innerHTML = protect(html);
  RS.translate(root);
  for (const s of root.querySelectorAll('script, iframe, object, embed')) s.remove();
  for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  // repeating sections: keep the template, add a list and its buttons
  for (const fs of root.querySelectorAll('fieldset')) {
    const cls = [...fs.classList].find(c => /^repeating_/i.test(c));
    if (!cls) continue;
    const sec = lc(cls.slice(10));
    const fields = {};
    for (const el of fs.querySelectorAll('[name^="attr_"]')) {
      const f = lc(el.getAttribute('name').slice(5));
      const fo = formulaOf(el);
      if (fo != null) fields[f] = { formula: fo };
      else {
        const d = defaultOf(el), form = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        if (!fields[f] || (fields[f].weak && form) || (d !== undefined && fields[f].def === undefined)) fields[f] = { def: d, weak: !form };
      }
    }
    const container = h('div', { class: 'repcontainer', 'data-groupname': 'repeating_' + sec });
    const control = h('div', { class: 'repcontrol', 'data-groupname': 'repeating_' + sec },
      h('button', { class: 'btn repcontrol_edit', type: 'button' }, 'Modify'),
      h('button', { class: 'btn repcontrol_add', type: 'button' }, '+Add'));
    fs.style.display = 'none';
    fs.after(container, control);
    sections[sec] = { tpl: fs.innerHTML, fields, container, rendered: '' };
    control.querySelector('.repcontrol_add').addEventListener('click', () => { if (canEdit) addRow(sec); });
    control.querySelector('.repcontrol_edit').addEventListener('click', e => {
      const on = container.classList.toggle('editmode');
      e.target.textContent = on ? 'Done' : 'Modify';
      control.classList.toggle('editmode', on);
    });
  }
  // everything else: defaults and formulas
  for (const el of root.querySelectorAll('[name^="attr_"]')) {
    if (el.closest('fieldset')) continue;
    const name = lc(el.getAttribute('name').slice(5));
    const fo = formulaOf(el);
    if (fo != null) { formulas[name] = fo; continue; }
    // form fields that give a value set defaults; a valueless field or a display span only if nothing else does
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || (el.tagName === 'INPUT' && !/^(checkbox|radio)$/i.test(el.type) && !el.hasAttribute('value'))) continue;
    const d = defaultOf(el);
    if (d !== undefined && defaults[name] === undefined) defaults[name] = d;
  }
  for (const el of root.querySelectorAll('[name^="attr_"]')) {
    if (el.closest('fieldset') || /^(SELECT|TEXTAREA)$/.test(el.tagName) || (el.tagName === 'INPUT' && (el.hasAttribute('value') || /^(checkbox|radio)$/i.test(el.type)))) continue;
    const name = lc(el.getAttribute('name').slice(5));
    if (formulas[name] == null && defaults[name] === undefined) defaults[name] = defaultOf(el);
  }
  // radios with nothing checked default to the first
  for (const el of root.querySelectorAll('input[type=radio][name^="attr_"]')) {
    const name = lc(el.getAttribute('name').slice(5));
    if (defaults[name] === undefined) defaults[name] = el.getAttribute('value') ?? 'on';
  }
  const style = h('style', null, css);
  $('#sheet').replaceChildren(style, root);
  root.addEventListener('change', onFieldChange);
  root.addEventListener('click', onClick);
  if (workerCode.trim()) startWorker(workerCode);
};

// ───────────────────────── showing values ─────────────────────────

function bindRow(sec, id, rowEl) {
  for (const el of rowEl.querySelectorAll('[name^="attr_"]')) el.dataset.full = `repeating_${sec}_${id}_${lc(el.getAttribute('name').slice(5))}`;
  // radio groups in different rows must not share a name
  for (const el of rowEl.querySelectorAll('input[type=radio][name^="attr_"]')) el.name = el.getAttribute('name') + '__' + id;
}
function renderRows() {
  for (const [sec, s] of Object.entries(sections)) {
    const ids = sectionIds(sec), key = ids.join(',');
    if (key === s.rendered) continue;
    const existing = new Map([...s.container.children].map(r => [r.dataset.reprowid, r]));
    const rows = ids.map(id => {
      let r = existing.get(id);
      if (!r) {
        r = h('div', { class: 'repitem', 'data-reprowid': id });
        r.innerHTML = s.tpl;
        r.prepend(h('div', { class: 'itemcontrol' },
          h('button', { class: 'btn btn-danger pictos repcontrol_del', type: 'button', title: 'Delete this row' }, '#'),
          h('button', { class: 'btn repcontrol_up', type: 'button', title: 'Move up' }, '↑')));
        bindRow(sec, id, r);
      }
      return r;
    });
    s.container.replaceChildren(...rows);
    s.rendered = key;
  }
}
RS.render = function () {
  if (!root) return;
  renderRows();
  calcCache.clear();
  const active = document.activeElement;
  for (const el of root.querySelectorAll('[name^="attr_"]')) {
    if (el.closest('fieldset')) continue;
    const name = el.dataset.full || lc(el.getAttribute('name').slice(5)).replace(/__.*$/, '');
    const rowEl = el.closest('.repitem');
    const row = rowEl ? { sec: rowEl.parentNode.dataset.groupname.slice(10), id: rowEl.dataset.reprowid } : null;
    const tag = el.tagName, type = (el.getAttribute('type') || '').toLowerCase();
    let v;
    if (isFormula(name)) v = String(calcValue(name, row));
    else { v = rawValue(name); if (v == null) v = ''; v = String(v); }
    if (tag === 'IMG') { const ok = /^(https?:\/\/|\/vtt-data\/)/i.test(v); if (ok && el.getAttribute('src') !== v) el.src = v; else if (!ok) el.removeAttribute('src'); el.hidden = !ok; continue; }
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) { if (el.textContent !== v) el.textContent = v; continue; }
    if (type === 'checkbox') { el.checked = v === (el.getAttribute('value') ?? 'on'); }
    else if (type === 'radio') { el.checked = v === (el.getAttribute('value') ?? 'on'); }
    else if (el === active) continue;
    else if (tag === 'SELECT') { if ([...el.options].some(o => o.value === v)) el.value = v; else if (el.options.length && v === '') el.selectedIndex = 0; }
    else if (el.value !== v) el.value = v;
    if (!canEdit && !isFormula(name)) el.disabled = true;
  }
};

// ───────────────────────── editing ─────────────────────────

function fieldName(el) { return el.dataset.full || lc(el.getAttribute('name').slice(5)).replace(/__.*$/, ''); }
function onFieldChange(e) {
  const el = e.target;
  if (!el.getAttribute || !/^attr_/.test(el.getAttribute('name') || '') || !canEdit) return;
  const name = fieldName(el), type = (el.getAttribute('type') || '').toLowerCase();
  if (isFormula(name)) return;
  let v;
  if (type === 'checkbox') v = el.checked ? (el.getAttribute('value') ?? 'on') : '0';
  else if (type === 'radio') { if (!el.checked) return; v = el.getAttribute('value') ?? 'on'; }
  else v = el.value;
  setAttrs({ [name]: v }, 'player');
}
// Change values, save them, re-draw, and tell the workers.
function setAttrs(values, source, silent) {
  const changed = [];
  for (let [k, v] of Object.entries(values)) {
    k = lc(k); v = v == null ? '' : String(v);
    if (k === 'character_name') { if (char && v && v !== char.name) { char.name = v; V.send({ t: 'op', op: { t: 'char.update', id: char.id, patch: { name: v } } }).catch(() => {}); RS.onName && RS.onName(v); } continue; }
    const prev = rawValue(k);
    attrs[k] = v;
    pendingSave.set[k] = v; pendingSave.remove.delete(k);
    // (while catching up after a switch or import, unchanged values count too, as on Roll20, so stale copies don't stall the chain)
    if (String(prev ?? '') !== v || (recalcUntil > Date.now() && source !== 'player')) changed.push([k, prev, v]);
  }
  scheduleSave();
  RS.render();
  if (!silent) for (const [k, prev, v] of changed) fire(k, prev, v, source);
}
function saveNow() {
  clearTimeout(saveTimer);
  const set = pendingSave.set, remove = [...pendingSave.remove];
  pendingSave.set = {}; pendingSave.remove.clear();
  if (!Object.keys(set).length && !remove.length) return Promise.resolve();
  return V.send({ t: 'charAttrs', char: char.id, set, remove }).catch(e => V.toast(e.message, true));
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 120);
}
function genId() {   // Roll20-style row id
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '-' + Date.now().toString(36).slice(-6);
  while (s.length < 20) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function addRow(sec, id) {
  id = lc(id || genId());
  const ids = sectionIds(sec);
  if (!ids.includes(id)) ids.push(id);
  setAttrs({ ['_reporder_repeating_' + sec]: ids.join(',') }, 'player', true);
  return id;
}
function removeRow(sec, id) {
  const prefix = `repeating_${sec}_${id}_`, removed = {};
  for (const k of Object.keys(attrs)) if (k.startsWith(prefix)) { removed[k] = attrs[k]; delete attrs[k]; pendingSave.remove.add(k); delete pendingSave.set[k]; }
  const ids = sectionIds(sec).filter(x => x !== id);
  attrs['_reporder_repeating_' + sec] = ids.join(','); pendingSave.set['_reporder_repeating_' + sec] = ids.join(',');
  scheduleSave(); RS.render();
  emit(`remove:repeating_${sec}`, { sourceAttribute: `repeating_${sec}_${id}`, removedInfo: removed, triggerName: `remove:repeating_${sec}` });
}
function moveRowUp(sec, id) {
  const ids = sectionIds(sec), i = ids.indexOf(id);
  if (i <= 0) return;
  [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
  setAttrs({ ['_reporder_repeating_' + sec]: ids.join(',') }, 'player', true);
}

function onClick(e) {
  const btn = e.target.closest('button');
  if (!btn || !root.contains(btn)) return;
  const rowEl = btn.closest('.repitem');
  const row = rowEl ? { sec: rowEl.parentNode.dataset.groupname.slice(10), id: rowEl.dataset.reprowid } : null;
  if (btn.classList.contains('repcontrol_del')) { if (canEdit) removeRow(row.sec, row.id); return; }
  if (btn.classList.contains('repcontrol_up')) { if (canEdit) moveRowUp(row.sec, row.id); return; }
  const type = (btn.getAttribute('type') || '').toLowerCase();
  if (type === 'roll') { e.preventDefault(); RS.roll(btn.getAttribute('value') || '', row); }
  else if (type === 'action') {
    e.preventDefault();
    const name = lc((btn.getAttribute('name') || '').replace(/^act_/i, ''));
    if (row) emit(`clicked:repeating_${row.sec}:${name}`, { sourceAttribute: `repeating_${row.sec}_${row.id}_${name}`, triggerName: `clicked:repeating_${row.sec}_${row.id}_${name}` });
    else emit(`clicked:${name}`, { sourceAttribute: name, triggerName: `clicked:${name}` });
  }
}

// ───────────────────────── rolling ─────────────────────────

// ?{Prompt|default} or ?{Prompt|Label,value|Label,value}: ask once per prompt text.
async function answerQueries(text) {
  const answers = new Map();
  let guard = 0;
  for (;;) {
    const start = text.indexOf('?{');
    if (start < 0 || guard++ > 50) return text;
    let depth = 0, end = -1;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { if (--depth === 0) { end = i; break; } }
    }
    if (end < 0) return text;
    const body = text.slice(start + 2, end);
    const parts = body.split('|');
    const prompt = parts[0];
    let answer;
    if (answers.has(prompt)) answer = answers.get(prompt);
    else {
      answer = await ask(prompt, parts.slice(1));
      if (answer == null) throw new Error('cancelled');
      answers.set(prompt, answer);
    }
    text = text.slice(0, start) + answer + text.slice(end + 1);
  }
}
function ask(prompt, opts) {
  return new Promise(resolve => {
    const modal = $('#modal');
    let input;
    const choices = opts.length > 1 ? opts.map(o => { const c = o.indexOf(','); return c < 0 ? [o, o] : [o.slice(0, c), o.slice(c + 1)]; }) : null;
    if (choices) input = h('select', { style: 'width:100%' }, ...choices.map(([l, v], i) => h('option', { value: i }, decode(l))));
    else input = h('input', { value: decode(opts[0] || ''), style: 'width:100%' });
    const done = ok => { modal.hidden = true; modal.replaceChildren(); resolve(ok ? (choices ? choices[+input.value][1] : input.value) : null); };
    modal.replaceChildren(h('div', { class: 'dialog' },
      h('div', { class: 'dh' }, h('h2', null, decode(prompt) || 'Roll')),
      h('div', { class: 'db' }, input),
      h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(true) }, 'Roll'))));
    modal.hidden = false;
    input.focus(); if (input.select) input.select();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  });
}
// Inside a repeating row, Roll20 reads "repeating_attack_name" (no row id) as this row's field.
function rowRefs(text, row) {
  if (!row) return text;
  const re = new RegExp('([@~]\\{?|\\(~)repeating_' + row.sec + '_(?!-)', 'gi');
  return text.replace(re, (m, pre) => `${pre}repeating_${row.sec}_${row.id}_`);
}
function translateKeys(text) { return text.replace(/\^\{([^}]+)\}/g, (m, k) => (RS.tr && RS.tr[k] != null ? RS.tr[k] : k)); }
async function prepare(text, row) {
  let t = expandAttrs(rowRefs(String(text), row), row);
  t = rowRefs(t, row);
  t = await answerQueries(t);
  t = expandAttrs(t, row);     // a chosen answer can hold more @{...}
  return translateKeys(decode(t)).replace(/%\{[^}]*\}/g, '');
}
// Roll one of the sheet's roll buttons by its Roll20 ability name ("attack_dmg" or "repeating_attack_<row>_attack_dmg").
RS.runButton = function (ref) {
  ref = String(ref).replace(/^.*\|/, '');
  const m = REP.exec(lc(ref));
  let scope = root, name = ref;
  if (m) {
    scope = root.querySelector(`.repcontainer[data-groupname="repeating_${m[1]}" i] .repitem[data-reprowid="${m[2]}" i]`) || null;
    name = m[3];
  }
  const btn = scope && [...scope.querySelectorAll('button[name]')].find(b => lc(b.getAttribute('name')) === 'roll_' + lc(name));
  if (!btn) { V.toast('That roll isn’t on this sheet any more', true); return false; }
  btn.click();
  return true;
};
RS.roll = async function (text, row) {
  if (!canEdit) return V.toast('You can only roll from your own sheets', true);
  try {
    const t = await prepare(text, row);
    await V.send({ t: 'sheetRoll', char: char.id, text: t });
    RS.onRolled && RS.onRolled();
  } catch (e) { if (e.message !== 'cancelled') V.toast(e.message, true); }
};

// ───────────────────────── sheet workers ─────────────────────────

let listeners = false;
function startWorker(code) {
  // (no 'use strict' here: Roll20 runs sheet workers in sloppy mode and some rely on it)
  const prelude = `
const __cb = new Map(); let __n = 0; const __on = [];
const __call = (t, args, cb) => { const id = ++__n; if (cb) __cb.set(id, cb); postMessage({ t, id, args }); };
self.on = (events, fn) => { for (const ev of String(events).toLowerCase().split(/\\s+/).filter(Boolean)) __on.push([ev, fn]); postMessage({ t: 'listen' }); };
self.getAttrs = (names, cb) => __call('getAttrs', [names], cb);
self.setAttrs = (values, opts, cb) => { if (typeof opts === 'function') { cb = opts; opts = {}; } __call('setAttrs', [values, opts || {}], cb); };
self.getSectionIDs = (sec, cb) => __call('getSectionIDs', [sec], cb);
self.removeRepeatingRow = id => __call('removeRepeatingRow', [id]);
self.generateRowID = () => { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = '-' + Date.now().toString(36).slice(-6); while (s.length < 20) s += c[Math.floor(Math.random() * c.length)]; return s; };
const __tr = ${JSON.stringify(RS.tr || {})};
self.getTranslationByKey = k => Object.prototype.hasOwnProperty.call(__tr, k) ? __tr[k] : false;
self.getTranslationLanguage = () => 'en';
self.setSectionOrder = (sec, order, cb) => __call('setSectionOrder', [sec, order], cb);
self.setDefaultToken = () => {};
self.getCompendiumPage = (n, cb) => cb && cb({});
self.startRoll = (text, cb) => new Promise(res => __call('startRoll', [text], r => { if (cb) cb(r); res(r); }));
self.finishRoll = (rollId, computed) => __call('finishRoll', [rollId, computed || {}]);
self.log = (...a) => console.log(...a);
onmessage = e => {
  const m = e.data;
  if (m.t === 'reply') { const cb = __cb.get(m.id); __cb.delete(m.id); if (cb) try { cb(m.value); } catch (err) { console.error(err); } return; }
  if (m.t === 'event') {
    for (const [ev, fn] of __on) {
      if (ev === m.name || m.alt.includes(ev)) try { fn(m.info); } catch (err) { console.error('Sheet worker error:', err); }
    }
  }
};
`;
  const blob = new Blob([prelude, '\n', RS.underscore || '', '\n;(function(){\n', code, '\n})();\n'], { type: 'text/javascript' });
  worker = new Worker(URL.createObjectURL(blob));
  worker.onerror = e => console.error('Sheet worker failed:', e.message);
  worker.onmessage = e => {
    const m = e.data;
    const reply = value => worker.postMessage({ t: 'reply', id: m.id, value });
    switch (m.t) {
      case 'listen': listeners = true; return;
      case 'getAttrs': {
        const out = {};
        for (const n of m.args[0] || []) { const v = isFormula(lc(n)) ? rawValue(n) : rawValue(n); out[n] = v == null ? '' : String(v); }
        return reply(out);
      }
      case 'setAttrs': {
        if (!canEdit) return reply();
        setAttrs(m.args[0] || {}, 'sheetworker', !!(m.args[1] && m.args[1].silent));
        return reply();
      }
      case 'getSectionIDs': return reply(sectionIds(lc(m.args[0]).replace(/^repeating_/, '')));
      case 'removeRepeatingRow': {
        const mm = /^repeating_([^_]+)_(-[^_]+)/.exec(lc(m.args[0] || ''));
        if (mm && canEdit) removeRow(mm[1], mm[2]);
        return;
      }
      case 'setSectionOrder': {
        const sec = lc(m.args[0]).replace(/^repeating_/, '');
        setAttrs({ ['_reporder_repeating_' + sec]: (m.args[1] || []).map(lc).join(',') }, 'sheetworker', true);
        return reply();
      }
      case 'startRoll':
        prepare(m.args[0] || '', null)
          .then(t => V.send({ t: 'startRoll', char: char.id, text: t }))
          .then(r => reply({ rollId: r.rollId, results: r.results }))
          .catch(err => { if (err.message !== 'cancelled') V.toast(err.message, true); });
        return;
      case 'finishRoll':
        V.send({ t: 'finishRoll', rollId: m.args[0], computed: m.args[1] }).catch(err => V.toast(err.message, true));
        return;
    }
  };
}
// Tell the workers something happened. "change:repeating_x_ID_field" also matches change:repeating_x:field and change:repeating_x.
function emit(name, info) {
  if (!worker) return;
  name = lc(name);
  const alt = [];
  const m = /^change:repeating_([^_]+)_(-[^_]+)_(.+)$/.exec(name);
  if (m) alt.push(`change:repeating_${m[1]}:${m[3]}`, `change:repeating_${m[1]}`);
  const c = /^clicked:repeating_([^:]+):(.+)$/.exec(name);
  if (c) alt.push(name);
  worker.postMessage({ t: 'event', name, alt, info });
}
function fire(attr, prev, v, source) {
  emit('change:' + attr, { sourceAttribute: attr, sourceType: source, previousValue: prev == null ? undefined : String(prev), newValue: v, triggerName: 'change:' + attr });
  if (/_max$/.test(attr)) return;
}

// ───────────────────────── from the server ─────────────────────────

RS.load = function (c) {
  char = c; attrs = Object.assign({}, c.attrs || {}); canEdit = !!c.canEdit;
  RS.render();
  if (worker && canEdit) setTimeout(() => emit('sheet:opened', { triggerName: 'sheet:opened' }), 50);
  // attributes written from outside the sheet (switching sheets, an import): let its workers work them through
  const todo = (worker && canEdit && c.recalc) ? c.recalc.map(lc).filter(k => attrs[k] != null) : [];
  if (todo.length) {
    let i = 0;
    recalcUntil = Date.now() + 6000;
    const step = () => {
      for (const k of todo.slice(i, i + 40)) fire(k, '', attrs[k], 'player');
      i += 40;
      if (i < todo.length) setTimeout(step, 40);
      else setTimeout(() => { V.send({ t: 'charRecalced', char: char.id }).catch(() => {}); RS.onRecalced && RS.onRecalced(); }, 800);
    };
    setTimeout(step, 400);
  } else if (RS.onRecalced) setTimeout(RS.onRecalced, 600);
};
RS.remote = function (m) {
  for (const [k, v] of Object.entries(m.set || {})) attrs[k] = v;
  for (const k of m.remove || []) delete attrs[k];
  if (m.name) char.name = m.name;
  RS.render();
};
RS.char = () => char;
RS.attrs = () => attrs;
// before the character leaves this sheet (a switch to the other one): the field being typed in, and anything not saved yet
RS.flush = async function () {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); }
  await new Promise(r => setTimeout(r, 250));   // sheet workers answering that change
  await saveNow();
};
RS.expand = expandAttrs;
RS.setAttrs = (v, src) => setAttrs(v, src || 'player');
RS.addRow = addRow;
RS.removeRow = removeRow;
RS.calc = name => { calcCache.clear(); return calcValue(lc(name)); };
})();
