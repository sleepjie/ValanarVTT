/* Roll20-style rolling, shared by the server (which rolls) and the table (which draws the results).
 *
 * A roll message is text like a Roll20 macro after attributes and queries have been filled in:
 *   &{template:5eDefault} {{title=STR save}} {{roll1=[[ 1d20 + [[3]] + [[0]] ]]}} {{showadvroll=1}} {{roll2=[[ 1d20 + 3 ]]}}
 *
 * rollMessage(text) rolls every inline roll ([[ ... ]], innermost first; a nested roll counts as its total)
 * and returns { template, props: [[key, value]], text, rolls, whisperGM, emote }.
 * Values and text keep a marker \u0001N\u0002 where inline roll N goes.
 *
 * Inside a roll: numbers, NdX, d%, groups {a, b}, + - * / % **, ( ), floor ceil round abs,
 * dice modifiers kh kl k dh dl d (drop low), r ro (reroll, with < > =), ! (explode), cs cf (crit range),
 * > < = (count successes), and [labels]. &{tracker} sends the roll to the initiative tracker.
 */
(function (root) {
  'use strict';
  const MAX_DICE = 1000, MAX_SIDES = 100000, MAX_ROLLS = 100;

  function rnd(rng, sides) { return 1 + Math.floor(rng() * sides); }

  // ───────────────── one inline roll ─────────────────

  function evaluate(src, rng, inner) {
    let s = src, i = 0;
    const labels = [], dice = [], tip = [];
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peek = () => { ws(); return s[i]; };
    const err = m => { throw new Error(m + (i < s.length ? ` near "${s.slice(i, i + 12)}"` : '')); };
    const num = () => {
      ws();
      const m = /^(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) return null;
      i += m[0].length;
      return +m[0];
    };
    const cmp = () => {   // optional comparison: >N <N =N or bare N
      ws();
      let op = '=';
      if (s[i] === '>' || s[i] === '<' || s[i] === '=') { op = s[i]; i++; }
      const n = num();
      if (n == null) return null;
      return { op, n };
    };
    const match = (c, v) => c.op === '>' ? v >= c.n : c.op === '<' ? v <= c.n : v === c.n;

    function diceTerm(count) {
      i++;   // the d
      let sides;
      if (s[i] === '%') { sides = 100; i++; }
      else if (s[i] === 'F') { sides = 'F'; i++; }
      else if (s[i] === '(') { i++; sides = Math.floor(expr()); if (peek() !== ')') err('Missing )'); i++; }
      else { sides = num(); if (sides == null) err('Dice need a number of sides'); }
      count = Math.floor(count);
      if (count < 0 || count > MAX_DICE) err(`Up to ${MAX_DICE} dice`);
      if (sides !== 'F' && (sides < 0 || sides > MAX_SIDES)) err('Too many sides');
      const mods = { keep: null, drop: null, reroll: [], once: false, explode: null, cs: null, cf: null, target: null, fail: null };
      for (;;) {
        const rest = s.slice(i);
        let m;
        if ((m = /^(kh|kl|k)/.exec(rest)) && /\d/.test(rest[m[0].length] || '')) { i += m[0].length; mods.keep = { high: m[1] !== 'kl', n: num() }; }
        else if ((m = /^(dh|dl|d)/.exec(rest)) && /\d/.test(rest[m[0].length] || '')) { i += m[0].length; mods.drop = { high: m[1] === 'dh', n: num() }; }
        else if (/^ro/.test(rest)) { i += 2; const c = cmp(); if (c) mods.reroll.push(c); mods.once = true; }
        else if (/^r/.test(rest) && /[<>=\d]/.test(rest[1] || '')) { i += 1; const c = cmp(); if (c) mods.reroll.push(c); }
        else if (/^!/.test(rest)) { i += 1; while (s[i] === '!' || s[i] === 'p') i++; const save = i; const c = cmp(); if (c) mods.explode = c; else { i = save; mods.explode = { op: '=', n: sides === 'F' ? 1 : sides }; } }
        else if (/^cs/.test(rest)) { i += 2; mods.cs = cmp(); }
        else if (/^cf/.test(rest)) { i += 2; mods.cf = cmp(); }
        else if (/^(sa|sd|s)(?![a-z])/.test(rest)) { i += /^(sa|sd)/.test(rest) ? 2 : 1; }
        else if (/^f[<>=]/.test(rest)) { i += 1; mods.fail = cmp(); }
        else if (/^[<>]/.test(rest)) { mods.target = cmp(); }
        else break;
      }
      const roll1 = () => sides === 'F' ? rnd(rng, 3) - 2 : rnd(rng, sides);
      const out = [];
      let n = 0;
      for (let k = 0; k < count; k++) {
        let v = roll1(), guard = 0;
        while (mods.reroll.some(c => match(c, v)) && guard++ < 100) { v = roll1(); if (mods.once) break; }
        out.push({ v, kept: true });
        if (mods.explode && sides !== 'F' && sides > 1) {
          let e = v;
          while (match(mods.explode, e) && n++ < 100) { e = roll1(); out.push({ v: e, kept: true, ex: true }); }
        }
      }
      const idx = out.map((d, k) => k);
      if (mods.keep) { idx.sort((a, b) => mods.keep.high ? out[b].v - out[a].v : out[a].v - out[b].v); idx.slice(mods.keep.n).forEach(k => { out[k].kept = false; }); }
      else if (mods.drop) { idx.sort((a, b) => mods.drop.high ? out[b].v - out[a].v : out[a].v - out[b].v); idx.slice(0, mods.drop.n).forEach(k => { out[k].kept = false; }); }
      const top = sides === 'F' ? 1 : sides, bottom = sides === 'F' ? -1 : 1;
      for (const d of out) {
        d.crit = mods.cs ? match(mods.cs, d.v) : d.v === top;
        d.fail = mods.cf ? match(mods.cf, d.v) : d.v === bottom;
      }
      let value;
      if (mods.target) {
        value = out.filter(d => d.kept && match(mods.target, d.v)).length - (mods.fail ? out.filter(d => d.kept && match(mods.fail, d.v)).length : 0);
      } else value = out.reduce((a, d) => a + (d.kept ? d.v : 0), 0);
      const term = { sides, dice: out, value };
      dice.push(term);
      tip.push('(' + out.map(d => d.kept ? String(d.v) : `~${d.v}~`).join('+') + ')');
      return value;
    }

    function group() {
      i++;   // {
      const parts = [];
      for (;;) {
        const t0 = tip.length;
        const v = expr();
        parts.push({ v, tip: tip.splice(t0).join('') });
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; break; }
        err('Missing }');
      }
      let keep = null, target = null;
      const rest = s.slice(i);
      let m;
      if ((m = /^(kh|kl|k)(\d+)/.exec(rest))) { i += m[0].length; keep = { high: m[1] !== 'kl', n: +m[2] }; }
      else if ((m = /^(dh|dl|d)(\d+)/.exec(rest))) { i += m[0].length; keep = { high: m[1] !== 'dh', n: parts.length - +m[2] }; }
      else if (/^[<>]/.test(rest)) target = cmp();
      const order = parts.map((p, k) => k).sort((a, b) => keep && keep.high ? parts[b].v - parts[a].v : parts[a].v - parts[b].v);
      const kept = new Set(keep ? order.slice(0, keep.n) : parts.map((p, k) => k));
      tip.push('{' + parts.map((p, k) => kept.has(k) ? p.tip || p.v : `~${p.tip || p.v}~`).join(', ') + '}');
      if (target) return parts.filter((p, k) => kept.has(k) && match(target, p.v)).length;
      return parts.reduce((a, p, k) => a + (kept.has(k) ? p.v : 0), 0);
    }

    function primary() {
      ws();
      const c = s[i];
      if (c === '(') {
        i++; tip.push('('); const v = expr(); if (peek() !== ')') err('Missing )'); i++;
        tip.push(')');
        if (s[i] === 'd' && /[\d%F(]/.test(s[i + 1] || '')) return diceTerm(v);
        return v;
      }
      if (c === '{') return group();
      if (c === '\u0001') {   // a nested inline roll, already rolled
        const e = s.indexOf('\u0002', i); const k = +s.slice(i + 1, e); i = e + 1;
        const v = inner[k] ? inner[k].total : 0;
        tip.push(String(v));
        return v;
      }
      const fn = /^(floor|ceil|round|abs)\s*\(/.exec(s.slice(i));
      if (fn) {
        i += fn[0].length; tip.push(fn[1] + '(');
        const v = expr(); if (peek() !== ')') err('Missing )'); i++; tip.push(')');
        return Math[fn[1]](v);
      }
      if (c === 'd' && /[\d%F(]/.test(s[i + 1] || '')) return diceTerm(1);
      const n = num();
      if (n == null) err('Expected a number or dice');
      if (s[i] === 'd' && /[\d%F(]/.test(s[i + 1] || '')) return diceTerm(n);
      tip.push(String(n));
      return n;
    }
    function label() {
      for (;;) {
        ws();
        if (s[i] !== '[') return;
        const e = s.indexOf(']', i);
        if (e < 0) err('Missing ]');
        labels.push(s.slice(i + 1, e)); i = e + 1;
      }
    }
    function unary() {
      ws();
      if (s[i] === '-') { i++; tip.push('-'); return -unary(); }
      if (s[i] === '+') { i++; return unary(); }
      const v = primary(); label();
      ws();
      if (s[i] === '*' && s[i + 1] === '*') { i += 2; tip.push('**'); return Math.pow(v, unary()); }
      return v;
    }
    function term() {
      let v = unary();
      for (;;) {
        ws();
        const c = s[i];
        if (c === '*' && s[i + 1] !== '*') { i++; tip.push('*'); v *= unary(); }
        else if (c === '/') { i++; tip.push('/'); const d = unary(); v = d === 0 ? 0 : v / d; }
        else if (c === '%') { i++; tip.push('%'); const d = unary(); v = d === 0 ? 0 : v % d; }
        else return v;
      }
    }
    function expr() {
      label();
      let v = term();
      for (;;) {
        ws();
        const c = s[i];
        if (c === '+') { i++; tip.push('+'); v += term(); }
        else if (c === '-') { i++; tip.push('-'); v -= term(); }
        else return v;
      }
    }
    const total = s.trim() ? expr() : 0;
    ws();
    if (i < s.length) err('Unexpected text');
    const kept = dice.flatMap(t => t.dice.filter(d => d.kept));
    return {
      total: Math.round(total * 1e6) / 1e6, dice, labels, tip: tip.join(''),
      crit: kept.some(d => d.crit), fumble: kept.some(d => d.fail)
    };
  }

  // ───────────────── a whole message ─────────────────

  // The first [[ ]] with no [[ inside it. Labels like [STR] count as brackets, so "2[PROF]]]" closes after the label.
  function innerRoll(t) {
    let from = 0;
    for (;;) {
      const start = t.indexOf('[[', from);
      if (start < 0) return null;
      let depth = 0, i = start + 2, restart = -1;
      for (; i < t.length; i++) {
        if (t[i] === '[' && t[i + 1] === '[') { restart = i; break; }
        if (t[i] === '[') depth++;
        else if (t[i] === ']') {
          if (depth > 0) depth--;
          else if (t[i + 1] === ']') return { index: start, 0: t.slice(start, i + 2), 1: t.slice(start + 2, i) };
        }
      }
      if (restart < 0) return null;
      from = restart;
    }
  }

  function rollMessage(text, rng) {
    rng = rng || Math.random;
    let t = String(text || '');
    const rolls = [];
    // innermost [[ ]] first
    let m, guard = 0;
    while ((m = innerRoll(t)) && guard++ < 500) {
      if (rolls.length >= MAX_ROLLS) throw new Error('Too many rolls in one message');
      let body = m[1], tracker = false;
      if (/&\{tracker(:[+-])?\}/.test(body)) { tracker = true; body = body.replace(/&\{tracker(:[+-])?\}/g, ''); }
      const usedInner = [];
      body.replace(/\u0001(\d+)\u0002/g, (x, k) => { usedInner.push(+k); return x; });
      const r = evaluate(body, rng, rolls);
      const k = rolls.length;
      r.expr = body.replace(/\u0001(\d+)\u0002/g, (x, n) => `[[${rolls[+n] ? rolls[+n].expr : ''}]]`).replace(/\s+/g, ' ').trim();
      r.tracker = tracker || usedInner.some(n => rolls[n] && rolls[n].tracker);
      for (const n of usedInner) if (rolls[n]) rolls[n].nested = true;
      rolls.push(r);
      t = t.slice(0, m.index) + `\u0001${k}\u0002` + t.slice(m.index + m[0].length);
    }
    // commands
    let whisperGM = false, emote = false;
    const cmd = /^\s*\/(w|whisper)\s+gm\s+/i.exec(t);
    if (cmd) { whisperGM = true; t = t.slice(cmd[0].length); }
    else if (/^\s*\/(em|me)\s+/i.test(t)) { emote = true; t = t.replace(/^\s*\/(em|me)\s+/i, ''); }
    const tm = /&\{template:([^}\s]+)\}/.exec(t);
    let template = null, props = null;
    if (tm) {
      template = tm[1];
      props = [];
      const body = t.slice(0, tm.index) + t.slice(tm.index + tm[0].length);
      const pr = /\{\{([\s\S]*?)\}\}/g;
      let p;
      while ((p = pr.exec(body))) {
        const eq = p[1].indexOf('=');
        const key = (eq < 0 ? p[1] : p[1].slice(0, eq)).trim();
        if (!key) continue;
        const val = eq < 0 ? '' : p[1].slice(eq + 1).trim();
        const at = props.findIndex(x => x[0] === key);
        if (at >= 0) props[at][1] = val; else props.push([key, val]);
      }
      t = '';
    }
    // only rolls that show (not nested in another) matter to the reader
    return { template, props, text: t.trim(), rolls: rolls.map(r => ({ expr: r.expr, total: r.total, tip: r.tip, crit: r.crit, fumble: r.fumble,
      dice: r.dice.map(d => ({ sides: d.sides, d: d.dice.map(x => [x.v, x.kept ? 1 : 0]) })), tracker: r.tracker, nested: !!r.nested, labels: r.labels })), whisperGM, emote };
  }

  // ───────────────── drawing a template (browser) ─────────────────

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // A roll as Roll20 shows it inline: the total, with the working in a tooltip.
  function rollHTML(r) {
    if (!r) return '';
    const shown = r.computed != null ? r.computed : r.total;
    const cls = 'inlinerollresult showtip tipsy-n-right' + (r.crit && r.fumble ? ' importantroll' : r.crit ? ' fullcrit' : r.fumble ? ' fullfail' : '');
    // a value a sheet worked out from a placeholder roll ([[0]]) has no working worth showing
    if (r.computed != null && r.expr === '0') return `<span class="${cls} computed">${esc(shown)}</span>`;
    const title = `Rolling ${r.expr} = ${r.tip}` + (r.computed != null && String(r.computed) !== String(r.total) ? ` (shown as ${r.computed})` : '');
    return `<span class="${cls}" title="${esc(title)}">${esc(shown)}</span>`;
  }
  // text with roll markers → HTML
  function valueHTML(v, rolls) {
    return esc(v)
      // [label](~ability): a button that rolls another of the sheet's buttons (Roll20's ability links)
      .replace(/\[([^\]\n]{1,120})\]\(~([A-Za-z0-9_\-|]{1,120})\)/g, (x, label, ab) => `<a href="~${ab}" class="sheet-abilitylink" data-ab="${ab}">${label}</a>`)
      .replace(/\u0001(\d+)\u0002/g, (x, k) => rollHTML(rolls[+k])).replace(/\n/g, '<br>');
  }
  function firstRoll(v, rolls) { const m = /\u0001(\d+)\u0002/.exec(v || ''); return m ? rolls[+m[1]] : null; }
  function numOf(arg, props, rolls) {
    if (/^-?\d+(\.\d+)?$/.test(arg)) return +arg;
    const p = props.find(x => x[0] === arg);
    if (!p) return NaN;
    const r = firstRoll(p[1], rolls);
    return r ? +(r.computed != null ? r.computed : r.total) : parseFloat(p[1]);
  }

  // Roll20's logic-less template language: {{name}}, {{#name}}…{{/name}}, {{#^name}}, and helpers.
  function renderTemplate(html, props, rolls) {
    const get = k => { const p = props.find(x => x[0] === k); return p ? p[1] : undefined; };
    const truthy = k => {
      const v = get(k);
      if (v === undefined || String(v).trim() === '') return false;
      const m = /^\s*\u0001(\d+)\u0002\s*$/.exec(v);   // a lone roll a sheet emptied out counts as empty
      return !(m && rolls[+m[1]] && rolls[+m[1]].computed === '');
    };
    function helper(name, args, ctx) {
      const total = a => numOf(a, props, rolls);
      switch (name) {
        case 'rollWasCrit': { const r = firstRoll(get(args[0]), rolls); return !!(r && r.crit); }
        case 'rollWasFumble': { const r = firstRoll(get(args[0]), rolls); return !!(r && r.fumble); }
        case 'rollTotal': return total(args[0]) === total(args[1]);
        case 'rollGreater': return total(args[0]) > total(args[1]);
        case 'rollLess': return total(args[0]) < total(args[1]);
        case 'rollBetween': { const v = total(args[0]); return v >= total(args[1]) && v <= total(args[2]); }
        default: return false;
      }
    }
    // turn the template into a tree of sections
    const tokRe = /\{\{\s*([#/]\^?|\^)?\s*([^}]*?)\s*\}\}/g;   // {{x}} {{#x}} {{^x}} {{#^x}} {{/x}}
    function render(src, ctx) {
      let out = '', last = 0, m;
      tokRe.lastIndex = 0;
      const re = new RegExp(tokRe.source, 'g');
      while ((m = re.exec(src))) {
        out += src.slice(last, m.index);
        last = re.lastIndex;
        const sigil = m[1] === '^' ? '#^' : (m[1] || ''), body = m[2];
        if (sigil.startsWith('#')) {
          // find the matching close tag
          const open = body, depthRe = new RegExp(tokRe.source, 'g');
          depthRe.lastIndex = re.lastIndex;
          let depth = 1, mm, end = -1, endTagEnd = -1;
          while ((mm = depthRe.exec(src))) {
            const sg = mm[1] === '^' ? '#^' : (mm[1] || '');
            if (sg.startsWith('#') && mm[2] === open) depth++;
            else if (sg.startsWith('/') && mm[2].replace(/^\^/, '') === open.replace(/^\^/, '')) { if (--depth === 0) { end = mm.index; endTagEnd = depthRe.lastIndex; break; } }
          }
          if (end < 0) continue;
          const inner = src.slice(re.lastIndex, end);
          const inverse = sigil === '#^';
          const hm = /^(\w+)\(\)\s*(.*)$/.exec(open);
          if (hm && hm[1] === 'allprops') {
            if (!inverse) {
              const skip = new Set(hm[2].split(/\s+/).filter(Boolean));
              for (const [k, v] of props) if (!skip.has(k)) out += render(inner, { key: k, value: v });
            }
          } else {
            const ok = hm ? helper(hm[1], hm[2].split(/\s+/).filter(Boolean), ctx) : truthy(open);
            if (ok !== inverse) out += render(inner, ctx);
          }
          last = endTagEnd; re.lastIndex = endTagEnd;
        } else if (sigil === '/') { /* stray close */ }
        else {
          if (ctx && body === 'key') out += esc(ctx.key);
          else if (ctx && body === 'value') out += valueHTML(ctx.value, rolls);
          else { const v = get(body); if (v !== undefined) out += valueHTML(v, rolls); }
        }
      }
      return out + src.slice(last);
    }
    return render(html, null);
  }

  const api = { evaluate, rollMessage, renderTemplate, rollHTML, valueHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.R20 = api;
})(this);
