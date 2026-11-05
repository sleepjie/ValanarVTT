/* Small things that save time at the table.
 *
 *  · Quick HP: with tokens selected, type -7 (hurt), +4 (heal) or =20 (set), then Enter: every selected token you can
 *    move takes it at once (a fireball over five goblins). -12/2 halves it first (a made save). The numbers float up
 *    off each token. Esc lets it go.
 *  (The token action bar — attacks, spells, features, inventory — lives in hotbar.js.) */
'use strict';
(function () {
const { $, h, state, on } = V;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ───────────────────────── quick HP ─────────────────────────
let buf = null, badge = null;
function hpTargets() { return state.scene ? V.selectedTokens().filter(t => V.canControl(t) && t.hp && (t.hp.max || t.hp.v != null)) : []; }
function showBuf() {
  if (!badge) { badge = h('div', { class: 'hpq' }); document.body.append(badge); }
  if (buf == null) { badge.hidden = true; return; }
  const ts = hpTargets(), p = parse(buf);
  const what = !p ? 'type a number' : p.op === '=' ? `set to ${p.n}` : p.op === '-' ? `${p.n} damage${p.half ? ' (halved)' : ''}` : `heal ${p.n}`;
  badge.replaceChildren(h('b', null, buf || ''), h('span', null, ` ${what} · ${ts.length} token${ts.length === 1 ? '' : 's'} · Enter`));
  badge.hidden = false;
  const r = ts[0] && V.tokenRect(ts[0].id);
  if (r) { badge.style.left = Math.round(r.left + r.width / 2) + 'px'; badge.style.top = Math.round(r.top - 12) + 'px'; }
  else { badge.style.left = '50%'; badge.style.top = '80px'; }
}
function parse(s) {
  const m = /^([-+=])\s*(\d{1,5})(\s*\/\s*2)?$/.exec(String(s || '').replace('−', '-'));
  if (!m) return null;
  let n = +m[2]; const half = !!m[3]; if (half) n = Math.floor(n / 2);
  return { op: m[1], n, half };
}
function apply() {
  const p = parse(buf), ts = hpTargets();
  buf = null; showBuf();
  if (!p || !ts.length) return;
  const ops = [];
  for (const t of ts) {
    const cur = +t.hp.v || 0, max = +t.hp.max || 0;
    const v = p.op === '=' ? p.n : p.op === '-' ? cur - p.n : max ? Math.min(max, cur + p.n) : cur + p.n;
    if (v === cur) continue;
    ops.push({ t: 'token.update', scene: state.scene.id, id: t.id, patch: { hp: { v: Math.max(-999, v), max: t.hp.max } } });
    floatNum(t.id, v - cur);
  }
  if (ops.length) V.op(ops.length === 1 ? ops[0] : { t: 'batch', ops }).catch(e => V.toast(e.message, true));
}
// the change floating up off a token, red for hurt and green for healed
function floatNum(id, d) {
  const r = V.tokenRect(id); if (!r) return;
  const el = h('div', { class: 'hpfloat ' + (d < 0 ? 'hurt' : 'heal'), style: `left:${Math.round(r.left + r.width / 2)}px;top:${Math.round(r.top + r.height * 0.3)}px` }, (d > 0 ? '+' : '−') + Math.abs(d));
  document.body.append(el); setTimeout(() => el.remove(), 1500);
}
document.addEventListener('keydown', e => {
  if (V.isTyping() || e.ctrlKey || e.metaKey || e.altKey || !$('#modal').hidden) return;
  if (buf == null) {
    if (!['-', '+', '=', '−'].includes(e.key) || !hpTargets().length) return;
    buf = e.key === '−' ? '-' : e.key;
  } else if (/^[0-9]$/.test(e.key) || (e.key === '/' && !buf.includes('/')) || (e.key === '2' && buf.endsWith('/'))) buf += e.key;
  else if (e.key === 'Backspace') buf = buf.length > 1 ? buf.slice(0, -1) : null;
  else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); return; }
  else if (e.key === 'Escape') buf = null;
  else return;
  e.preventDefault(); e.stopPropagation();   // (so 0 doesn't zoom out, nor Backspace delete the token)
  showBuf();
}, true);
on('sel', () => { if (buf != null && !hpTargets().length) { buf = null; showBuf(); } });

})();
