/* The site's colours, chosen by each person (the palette button in the top bar, on the map and the tabletop):
 *  - a theme: the colour of the bars, panels and text (dark ones, and two light ones), kept as "valanar-base";
 *  - an accent: set on every page as --gold, with a darker and a lighter shade, kept as "valanar-accent".
 * Both live in this browser (localStorage). Loaded in <head> so a page never flashes the old colours.
 * A theme sets --k0 (the deepest background) and --k1 (the most raised), which the stylesheets mix between,
 * --fg (text), --hi (the light used for hovers and edges) and --fg-hi (text at its brightest). */
'use strict';
(function () {
  const KEY = 'valanar-accent', DEF = '#c9a45c', BKEY = 'valanar-base', BDEF = 'night';
  const PRESETS = [['#c9a45c', 'Gold'], ['#d08a5a', 'Copper'], ['#d98a8a', 'Rose'], ['#b39ddb', 'Lavender'], ['#7fb2dc', 'Sky'], ['#6fc2b5', 'Teal'], ['#8fbf8a', 'Sage'], ['#b8bcc4', 'Silver']];
  const BASES = {
    night:     { name: 'Night',     k0: '#090b0e', k1: '#2f343c', fg: '#e8e2d0' },
    midnight:  { name: 'Midnight',  k0: '#060915', k1: '#27324f', fg: '#e2e6f2' },
    forest:    { name: 'Forest',    k0: '#070c09', k1: '#29382e', fg: '#e2e8d8' },
    wine:      { name: 'Wine',      k0: '#0f080b', k1: '#3c2832', fg: '#f0e2e4' },
    umber:     { name: 'Umber',     k0: '#0d0a07', k1: '#3b3127', fg: '#eee2cc' },
    ash:       { name: 'Ash',       k0: '#0a0a0a', k1: '#363636', fg: '#e6e6e6' },
    parchment: { name: 'Parchment', k0: '#d6c9ad', k1: '#fdf9f0', fg: '#2b2217', hi: '#3b2a14', fgHi: '#000000', light: true },
    linen:     { name: 'Linen',     k0: '#cdd2d9', k1: '#fcfdfe', fg: '#1d232b', hi: '#1d2a3c', fgHi: '#000000', light: true }
  };
  const store = (k, v, def) => { try { if (!v || v === def) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* not kept */ } };
  const load = (k, def) => { try { return localStorage.getItem(k) || def; } catch (e) { return def; } };
  const get = () => load(KEY, DEF);
  const getBase = () => (BASES[load(BKEY, BDEF)] ? load(BKEY, BDEF) : BDEF);
  const rgb = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
  const lum = c => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  // dark text sits on the accent, and the accent is text on the bars: on a dark theme a colour picked too dark is
  // lightened until it reads, on a light theme one too light is darkened
  function readable(c) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) c = DEF;
    let t = 0;
    if (BASES[getBase()].light) { while (lum(mix(c, '#000000', t)) > 0.46 && t < 0.9) t += 0.05; return mix(c, '#000000', t); }
    while (lum(mix(c, '#ffffff', t)) < 0.5 && t < 0.9) t += 0.05; return mix(c, '#ffffff', t);
  }
  function applyBase(id) {
    const b = BASES[id] || BASES[BDEF], s = document.documentElement.style;
    s.setProperty('--k0', b.k0); s.setProperty('--k1', b.k1); s.setProperty('--fg', b.fg);
    s.setProperty('--hi', b.hi || '#ffffff'); s.setProperty('--fg-hi', b.fgHi || '#ffffff');
    document.documentElement.dataset.base = b.light ? 'light' : 'dark';
    s.colorScheme = b.light ? 'light' : 'dark';
  }
  function apply(c) {
    c = readable(c);
    const s = document.documentElement.style;
    s.setProperty('--gold', c); s.setProperty('--gold-dark', mix(c, '#000000', 0.25)); s.setProperty('--gold-light', mix(c, '#ffffff', 0.4));
    return c;
  }
  function set(c) { store(KEY, c, DEF); apply(c || DEF); }
  function setBase(id) { store(BKEY, id, BDEF); applyBase(id); apply(get()); }
  applyBase(getBase()); apply(get());
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === BKEY) { applyBase(getBase()); apply(get()); } });   // another tab changed it

  // the palette button, next to the full-screen one in the top bar
  function button() {
    if (!document.getElementById('accentCss')) {
      const st = document.createElement('style'); st.id = 'accentCss';
      st.textContent = `.accentpop { position: fixed; z-index: 10000; width: 232px; padding: 10px 12px 12px; background: color-mix(in srgb, var(--k1) 50%, var(--k0)); color: var(--fg); border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent); border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.45); font: 13px 'Segoe UI', system-ui, sans-serif; }
.accentpop b { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: color-mix(in srgb, var(--fg) 65%, transparent); margin: 0 0 8px; }
.accentpop b + .sw + b { margin-top: 14px; }
.accentpop .sw { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.accentpop .sw button { height: 30px; border-radius: 50%; border: 2px solid rgba(0,0,0,.35); cursor: pointer; padding: 0; }
.accentpop .sw.bases button { border-radius: 6px; height: 34px; font: 600 9.5px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .02em; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px; }
.accentpop .sw button.on { box-shadow: 0 0 0 2px var(--fg); }
.accentpop label { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.accentpop input { width: 44px; height: 26px; border: 0; padding: 0; background: none; cursor: pointer; }`;
      document.head.append(st);
    }
    const fs = document.getElementById('fsBtn');
    if (!fs || document.getElementById('accentBtn')) return;
    const b = document.createElement('button');
    b.id = 'accentBtn'; b.className = 'fsbtn'; b.title = 'Colours: the site’s theme and accent, for you';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7" r="1" fill="currentColor"/></svg>';
    fs.parentNode.insertBefore(b, fs);
    let pop = null;
    const close = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', away, true); } };
    const away = e => { if (pop && !pop.contains(e.target) && e.target !== b && !b.contains(e.target)) close(); };
    b.addEventListener('click', () => {
      if (pop) return close();
      pop = document.createElement('div'); pop.className = 'accentpop';
      const draw = () => {
        const now = get().toLowerCase(), base = getBase();
        pop.innerHTML = '<b>Theme</b><div class="sw bases"></div><b>Accent colour</b><div class="sw acc"></div><label>Your own <input type="color"></label>';
        const bs = pop.querySelector('.bases');
        for (const [id, t] of Object.entries(BASES)) {
          const x = document.createElement('button'); x.title = t.name + (t.light ? ' (light)' : ''); x.textContent = t.name;
          x.style.background = `linear-gradient(160deg, ${t.k1} 0 45%, ${mix(t.k0, t.k1, 0.25)} 45%)`; x.style.color = t.fg;
          if (id === base) x.className = 'on';
          x.onclick = () => { setBase(id); draw(); }; bs.append(x);
        }
        const sw = pop.querySelector('.acc');
        for (const [c, name] of PRESETS) {
          const x = document.createElement('button'); x.title = name; x.style.background = readable(c); if (c === now) x.className = 'on';
          x.onclick = () => { set(c); draw(); }; sw.append(x);
        }
        const inp = pop.querySelector('input'); inp.value = readable(now);
        inp.oninput = () => apply(inp.value); inp.onchange = () => { set(inp.value); draw(); };
      };
      draw();
      const r = b.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
      document.body.append(pop);
      document.addEventListener('pointerdown', away, true);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', button); else button();
  window.ValanarTheme = { set, get, apply, setBase, getBase, bases: BASES };
})();
