/* Postcards: the map as you see it (the hour, the weather, the borders, a journey drawn on it…), framed and sent
 * home. Frame the view, give it a caption (and a note, if you like), and it comes out as a picture to save or copy:
 * a postcard with a stamp of the nation's arms and the world's date in the postmark, an old engraved print, or just
 * the picture.
 *
 * The picture is made by the browser drawing the map's own page over again (lib/html-to-image.js, loaded the first
 * time one is made); the frame, the stamp and the lettering are drawn here.
 * ValanarPostcard(ctx) → { open(), close(), active() } */
'use strict';
window.ValanarPostcard = function (ctx) {
  const { map, L, h, toast, toPixel } = ctx;
  const Cal = window.WorldCalendar;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const STYLES = [['postcard', 'Postcard'], ['print', 'Old print'], ['plain', 'Plain']];
  const RANK = { capital: 6, city: 5, 'free-city': 5, town: 4, village: 3, fortress: 2, hamlet: 1 };
  const SERIF = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
  const SCRIPT = '"Segoe Script", "Lucida Handwriting", "Brush Script MT", "Apple Chancery", cursive';
  let ui = null, style = 'postcard', caption = '', capAuto = true, note = '', busy = false;
  try { style = localStorage.getItem('valanar-postcard-style') || 'postcard'; } catch (e) { /* private */ }
  if (!STYLES.some(s => s[0] === style)) style = 'postcard';

  // ───────── the library, the first time ─────────
  let lib = null;
  function loadLib() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    if (lib) return lib;
    lib = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = 'lib/html-to-image.js';
      s.onload = () => (window.htmlToImage ? ok(window.htmlToImage) : no(new Error('the picture-maker didn’t load')));
      s.onerror = () => { lib = null; no(new Error('lib/html-to-image.js is missing')); };
      document.head.append(s);
    });
    return lib;
  }

  // ───────── where we are: the place to send greetings from ─────────
  function frameRect() {
    const s = map.getSize(), bottom = 118;
    let w = Math.min(s.x - 80, 1100), hh = w / 1.5;
    if (hh > s.y - bottom - 40) { hh = s.y - bottom - 40; w = hh * 1.5; }
    return { x: Math.round((s.x - w) / 2), y: Math.round(Math.max(16, (s.y - bottom - hh) / 2)), w: Math.round(w), h: Math.round(hh) };
  }
  function frameBounds() {
    const r = frameRect();
    return L.latLngBounds(map.containerPointToLatLng([r.x, r.y + r.h]), map.containerPointToLatLng([r.x + r.w, r.y]));
  }
  function here() {
    const b = frameBounds(), c = toPixel(b.getCenter());
    const nat = ctx.nationAt ? ctx.nationAt(c.x, c.y) : null;
    // the biggest place in the frame, the nearer the middle the better; else the nation
    let best = null, bs = -Infinity;
    const r = toPixel(b.getNorthEast()), l = toPixel(b.getSouthWest()), span = Math.max(1, Math.abs(r.x - l.x));
    for (const m of ctx.data().markers) {
      if (m.unnamed || !m.name || !isFinite(m.x) || !b.contains(ctx.toLatLng(m.x, m.y))) continue;
      const rank = RANK[m.type]; if (!rank && m.type !== 'landmark' && m.type !== 'feature') continue;
      const d = Math.hypot(m.x - c.x, m.y - c.y) / span, sc = (rank || 2.5) - d * 6;
      if (sc > bs) { bs = sc; best = m; }
    }
    const zoomedOut = map.getZoom() < ctx.NATIVE - 3.2;
    const name = zoomedOut && nat ? nat.name : best ? best.name : nat ? nat.name : (ctx.siteName || document.title || 'the world');
    return { name, nation: nat, marker: zoomedOut ? null : best };
  }
  function worldDate() {
    const sk = ctx.sky && ctx.sky(), c = sk && sk.calendar;
    if (!c || !Cal) return null;
    const d = Cal.date(c.cal, c.t);
    return { day: `${d.day} ${d.monthName}`, year: d.yearText || String(d.year), label: Cal.label(c.cal, c.t, { short: true }) };
  }

  // ───────── framing it ─────────
  function open() {
    if (ui) return;
    if (ctx.view() !== 'map') ctx.showMap();
    ctx.closePanel();
    const at = here();
    if (capAuto || !caption) { caption = `Greetings from ${at.name}`; capAuto = true; }
    ui = {};
    const cont = map.getContainer();
    ui.frame = h('div', { class: 'pcframe' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }), h('span', { class: 'pchint' }, 'Move and zoom the map to frame your postcard'));
    const seg = h('div', { class: 'segs pcstyles' }, ...STYLES.map(([k, l]) => h('button', { class: k === style ? 'on' : null, onclick: e => { style = k; try { localStorage.setItem('valanar-postcard-style', k); } catch (er) { /* private */ } for (const b of seg.children) b.classList.toggle('on', b === e.currentTarget); } }, l)));
    ui.cap = h('input', { type: 'text', value: caption, maxlength: 60, placeholder: 'A caption', spellcheck: 'false', oninput: e => { caption = e.target.value; capAuto = false; } });
    ui.note = h('input', { type: 'text', value: note, maxlength: 90, placeholder: 'A note, in your own hand (optional)', oninput: e => { note = e.target.value; } });
    ui.go = h('button', { class: 'btn primary pcgo', onclick: take }, '✦ Take it');
    ui.ctl = h('div', { class: 'pcctl' },
      h('div', { class: 'pcrow' }, h('b', { class: 'pcttl' }, 'A postcard'), seg, h('span', { class: 'sp' }), h('button', { class: 'x', title: 'Put it away (Esc)', onclick: close }, '×')),
      h('div', { class: 'pcrow' }, ui.cap, ui.note, ui.go));
    ui.root = h('div', { class: 'pcroot' }, ui.frame, ui.ctl);
    cont.append(ui.root);
    L.DomEvent.disableClickPropagation(ui.ctl); L.DomEvent.disableScrollPropagation(ui.ctl);
    document.body.classList.add('postcard-on');
    place();
    map.on('resize', place); map.on('moveend', onMoved);
    document.addEventListener('keydown', keys, true);
    requestAnimationFrame(() => ui && ui.root.classList.add('on'));
  }
  function place() {
    if (!ui) return;
    const r = frameRect();
    Object.assign(ui.frame.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
  function onMoved() { if (ui && capAuto) { caption = `Greetings from ${here().name}`; ui.cap.value = caption; } }
  function keys(e) {
    if (!ui) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (ui.view) closeView(); else close(); }
    else if (e.key === 'Enter' && !ui.view && !busy && (e.target === ui.cap || e.target === ui.note)) { e.preventDefault(); take(); }
  }
  function close() {
    if (!ui) return;
    map.off('resize', place); map.off('moveend', onMoved);
    document.removeEventListener('keydown', keys, true);
    const r = ui.root; r.classList.remove('on'); setTimeout(() => r.remove(), 300);
    if (ui.view) ui.view.remove();
    if (ui.url) URL.revokeObjectURL(ui.url);
    ui = null;
    document.body.classList.remove('postcard-on', 'pc-taking');
  }

  // ───────── taking it ─────────
  async function take() {
    if (!ui || busy) return;
    busy = true; ui.go.disabled = true; ui.go.textContent = 'Developing…';
    const at = here();
    let shot = null;
    try {
      const H2I = await loadLib();
      const cont = map.getContainer(), cr = cont.getBoundingClientRect(), r = frameRect();
      const fx = cr.left + r.x, fy = cr.top + r.y;
      const pr = clamp(window.devicePixelRatio || 1, 2, 3);
      document.body.classList.add('pc-taking');
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const SKIP = ['leaflet-control-container', 'pcroot', 'peercur', 'peerping', 'pingedge', 'reachtip', 'ambtitle', 'ages', 'agepill', 'followbar', 'wfglass', 'talepin'];
      const filter = node => {
        if (!(node instanceof Element)) return true;
        if (node.id === 'skyBtn' || node.id === 'ages' || node.id === 'agepill') return false;
        for (const k of SKIP) if (node.classList.contains(k)) return false;
        // only what's in the frame (the map keeps every place's icon, near and far)
        if (node.classList.contains('leaflet-marker-icon') || node.classList.contains('leaflet-tile') || node.classList.contains('leaflet-tooltip')) {
          const b = node.getBoundingClientRect();
          if (b.right < fx - 60 || b.left > fx + r.w + 60 || b.bottom < fy - 60 || b.top > fy + r.h + 60) return false;
        }
        return true;
      };
      const full = await H2I.toCanvas(cont, { pixelRatio: pr, filter, cacheBust: false, skipFonts: true, imagePlaceholder: TRANSPARENT,
        width: cont.clientWidth, height: cont.clientHeight, style: { left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0' } });
      shot = document.createElement('canvas'); shot.width = Math.round(r.w * pr); shot.height = Math.round(r.h * pr);
      shot.getContext('2d').drawImage(full, Math.round(r.x * pr), Math.round(r.y * pr), shot.width, shot.height, 0, 0, shot.width, shot.height);
    } catch (e) {
      console.warn(e);
      toast('Couldn’t make the picture: ' + (e.message || e), true);
    }
    document.body.classList.remove('pc-taking');
    if (!ui) { busy = false; return; }
    if (shot) {
      try { const card = await compose(shot, at); showCard(card, at); }
      catch (e) { console.warn(e); toast('Couldn’t finish the postcard: ' + (e.message || e), true); }
    }
    busy = false;
    if (ui) { ui.go.disabled = false; ui.go.textContent = '✦ Take it'; }
  }
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // ───────── the card itself ─────────
  const canvas = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(hh); return c; };
  const svgImage = svg => new Promise(ok => {
    if (!svg) { ok(null); return; }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), im = new Image();
    im.onload = () => { ok(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = () => { ok(null); URL.revokeObjectURL(url); };
    im.src = url;
  });
  // a few grains of paper
  function paper(g, w, hh, base, seed) {
    g.fillStyle = base; g.fillRect(0, 0, w, hh);
    let a = seed || 7; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < w * hh / 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,96,60' : '255,255,255'},${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * hh, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  }
  // the biggest size of a font that fits the text in a width
  function fit(g, text, font, max, start) {
    let s = start;
    for (; s > 8; s -= 2) { g.font = font(s); if (g.measureText(text).width <= max) break; }
    return s;
  }
  async function compose(img, at) {
    const W = img.width, H = img.height, U = W / 1000;   // U: a thousandth of the picture's width
    const date = worldDate();
    const nation = at.nation;
    if (style === 'plain') {
      if (!note) return img;
      const c = canvas(W, H), g = c.getContext('2d'); g.drawImage(img, 0, 0); handNote(g, W, H, U, '#fffaf0', 0, 'br'); return c;
    }
    if (style === 'print') return print(img, at, date, U);
    // ── a postcard: a white border, the picture, big letters, a stamp and a postmark ──
    const B = Math.round(34 * U), c = canvas(W + B * 2, H + B * 2), g = c.getContext('2d');
    paper(g, c.width, c.height, '#f6f0e1', 11);
    g.save(); g.shadowColor = 'rgba(40,28,10,.35)'; g.shadowBlur = 6 * U; g.drawImage(img, B, B); g.restore();
    g.strokeStyle = 'rgba(60,44,20,.35)'; g.lineWidth = Math.max(1, U); g.strokeRect(B + 0.5, B + 0.5, W - 1, H - 1);
    // the greeting: "Greetings from" in a hand, and the name in great letters
    const m = /^greetings from (.+)$/i.exec(caption.trim());
    const big = (m ? m[1] : caption.trim()).toUpperCase(), small = m ? 'Greetings from' : '';
    if (big) {
      const maxW = W * 0.72, size = fit(g, big, s => `bold ${s}px ${SERIF}`, maxW, Math.round(120 * U));
      g.font = `bold ${size}px ${SERIF}`; g.textBaseline = 'alphabetic';
      const x = B + 36 * U, y = B + H - 40 * U;
      const tw = g.measureText(big).width;
      // the letters: dark edge, a drop of shadow, and a warm fill like an old tinted card
      g.save(); g.lineJoin = 'round';
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10 * U; g.shadowOffsetX = 4 * U; g.shadowOffsetY = 5 * U;
      g.lineWidth = Math.max(3, size * 0.14); g.strokeStyle = '#1d140a'; g.strokeText(big, x, y);
      g.restore();
      const gr = g.createLinearGradient(0, y - size * 0.8, 0, y);
      gr.addColorStop(0, '#fff3c4'); gr.addColorStop(0.45, '#f2c35a'); gr.addColorStop(1, '#c0602a');
      g.fillStyle = gr; g.fillText(big, x, y);
      g.lineWidth = Math.max(1, size * 0.025); g.strokeStyle = 'rgba(255,250,230,.8)'; g.strokeText(big, x, y);
      if (small) {
        const ss = Math.round(size * 0.42);
        g.save(); g.font = `${ss}px ${SCRIPT}`; g.fillStyle = '#fffaf0'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6 * U; g.shadowOffsetY = 2 * U;
        g.translate(x + 6 * U, y - size * 0.92); g.rotate(-0.06); g.fillText(small, 0, 0); g.restore();
      }
      void tw;
    }
    if (note) handNote(g, W, H, U, '#fffaf0', B, 'tl');   // (top left: the greeting has the bottom, the stamp the top right)
    // the stamp, over the top right corner, and the postmark across it
    const sw = Math.round(118 * U), sh = Math.round(142 * U), sx = c.width - B - sw - 18 * U, sy = B + 16 * U;
    await stamp(g, sx, sy, sw, sh, U, nation);
    postmark(g, sx - 34 * U, sy + sh * 0.62, 62 * U, U, at, date);
    return c;
  }
  function handNote(g, W, H, U, colour, B, at) {
    B = B || 0;
    const size = Math.round(30 * U), tl = at === 'tl';
    g.save(); g.font = `${size}px ${SCRIPT}`; g.textAlign = tl ? 'left' : 'right';
    const lines = wrap(g, note, W * (tl ? 0.5 : 0.42));
    if (tl) g.translate(B + 34 * U, B + 30 * U + size); else g.translate(B + W - 30 * U, B + H - 34 * U - (lines.length - 1) * size * 1.15);
    g.rotate(-0.045);
    g.fillStyle = colour; g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 5 * U; g.shadowOffsetY = 1.5 * U;
    lines.forEach((ln, i) => g.fillText(ln, 0, i * size * 1.15));
    g.restore();
  }
  function wrap(g, text, max) {
    const words = String(text).split(/\s+/), out = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out.slice(0, 3);
  }
  async function stamp(g, x, y, w, hh, U, nation) {
    const s = canvas(w + 8 * U, hh + 8 * U), sg = s.getContext('2d'), p = 4 * U;
    // the paper, with its perforated edge (holes bitten out along every side)
    paper(sg, s.width, s.height, '#fbf6ea', 23);
    sg.globalCompositeOperation = 'destination-out';
    const r = 3.6 * U, step = 10.5 * U;
    for (let t = 0; t <= s.width; t += step) { sg.beginPath(); sg.arc(t, 0, r, 0, Math.PI * 2); sg.arc(t, s.height, r, 0, Math.PI * 2); sg.fill(); }
    for (let t = 0; t <= s.height; t += step) { sg.beginPath(); sg.arc(0, t, r, 0, Math.PI * 2); sg.arc(s.width, t, r, 0, Math.PI * 2); sg.fill(); }
    sg.globalCompositeOperation = 'source-over';
    // the design: a coloured ground, the arms, the name
    const ix = p + 7 * U, iy = p + 7 * U, iw = s.width - 2 * ix, ih = s.height - 2 * iy;
    const col = nation && nation.color ? nation.color : '#7a5a3a';
    sg.fillStyle = col; sg.fillRect(ix, iy, iw, ih);
    const gr = sg.createLinearGradient(0, iy, 0, iy + ih); gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
    sg.fillStyle = gr; sg.fillRect(ix, iy, iw, ih);
    sg.strokeStyle = 'rgba(255,250,235,.85)'; sg.lineWidth = 1.6 * U; sg.strokeRect(ix + 4 * U, iy + 4 * U, iw - 8 * U, ih - 8 * U);
    const arms = nation && ctx.armsSvg ? await svgImage(ctx.armsSvg(nation, 200)) : null;
    if (arms) {
      const aw = iw * 0.62, ah = aw * (arms.height / arms.width || 1.15);
      sg.save(); sg.shadowColor = 'rgba(0,0,0,.4)'; sg.shadowBlur = 3 * U; sg.drawImage(arms, ix + (iw - aw) / 2, iy + ih * 0.16, aw, Math.min(ah, ih * 0.6)); sg.restore();
    }
    sg.fillStyle = '#fffaf0'; sg.textAlign = 'center';
    const top = String(ctx.siteName || document.title || 'Postage').toUpperCase();
    sg.font = `bold ${Math.round(10 * U)}px ${SERIF}`; sg.fillText(top, ix + iw / 2, iy + 15 * U);
    const nm = (nation ? nation.name : 'Postage').toUpperCase();
    const fs = fit(sg, nm, z => `bold ${z}px ${SERIF}`, iw - 14 * U, Math.round(12 * U));
    sg.font = `bold ${fs}px ${SERIF}`; sg.fillText(nm, ix + iw / 2, iy + ih - 9 * U);
    sg.font = `bold ${Math.round(15 * U)}px ${SERIF}`; sg.textAlign = 'left'; sg.fillText('2', ix + 7 * U, iy + 32 * U);
    g.save(); g.translate(x + w / 2, y + hh / 2); g.rotate(0.035);
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 4 * U; g.shadowOffsetY = 1.5 * U;
    g.drawImage(s, -s.width / 2, -s.height / 2); g.restore();
  }
  function postmark(g, cx, cy, R, U, at, date) {
    g.save(); g.translate(cx, cy); g.rotate(-0.2);
    const ink = 'rgba(28,24,40,.72)';
    g.strokeStyle = ink; g.fillStyle = ink;
    g.lineWidth = 2.4 * U; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.2 * U; g.beginPath(); g.arc(0, 0, R * 0.64, 0, Math.PI * 2); g.stroke();
    // the place round the top, the day round the bottom, the year across the middle
    const ring = (text, r, top) => {
      const fs = Math.round(R * 0.2); g.font = `bold ${fs}px ${SERIF}`;
      const chars = [...text], step = Math.min(0.24, (Math.PI * 0.9) / Math.max(1, chars.length));
      const start = top ? -Math.PI / 2 - step * (chars.length - 1) / 2 : Math.PI / 2 + step * (chars.length - 1) / 2;
      chars.forEach((ch, i) => { const a = top ? start + i * step : start - i * step; g.save(); g.rotate(a); g.translate(r, 0); g.rotate(top ? Math.PI / 2 : -Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, 0); g.restore(); });
    };
    ring((at.name || '').toUpperCase().slice(0, 22), R * 0.82, true);
    if (date) ring(date.day.toUpperCase().slice(0, 22), R * 0.82, false);
    g.font = `bold ${Math.round(R * 0.26)}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(date ? date.year : '✦', 0, 0);
    // the cancelling waves, running off to the left
    g.lineWidth = 2 * U;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.02) { const xx = -R * 1.05 - t * R * 3.2, yy = k * R * 0.28 + Math.sin(t * Math.PI * 5) * R * 0.07; if (t === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
      g.stroke();
    }
    g.restore();
  }
  // ── an old engraved print: browned, the corners darkened, ruled round, and titled underneath ──
  function print(img, at, date, U) {
    const W = img.width, H = img.height, M = Math.round(70 * U), T = Math.round((note ? 150 : 120) * U);
    const c = canvas(W + M * 2, H + M + T), g = c.getContext('2d');
    paper(g, c.width, c.height, '#efe3c6', 5);
    const t = canvas(W, H), tg = t.getContext('2d');
    tg.filter = 'sepia(.82) saturate(.9) contrast(1.06) brightness(1.03)'; tg.drawImage(img, 0, 0); tg.filter = 'none';
    const v = tg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, 'rgba(60,40,15,0)'); v.addColorStop(1, 'rgba(60,40,15,.5)'); tg.fillStyle = v; tg.fillRect(0, 0, W, H);
    g.drawImage(t, M, M);
    g.strokeStyle = '#3b2a17'; g.lineWidth = 2.6 * U; g.strokeRect(M - 9 * U, M - 9 * U, W + 18 * U, H + 18 * U);
    g.lineWidth = 0.9 * U; g.strokeRect(M - 15 * U, M - 15 * U, W + 30 * U, H + 30 * U); g.strokeRect(M, M, W, H);
    g.fillStyle = '#2e2112'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const title = (caption.trim() || at.name).toUpperCase();
    const fs = fit(g, title, s => `${s}px ${SERIF}`, W * 0.9, Math.round(40 * U));
    g.font = `${fs}px ${SERIF}`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(fs * 0.12)}px`;
    g.fillText(title, c.width / 2, M + H + 15 * U + fs * 1.05);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    const sub = [at.nation && at.nation.name !== at.name ? at.nation.name : '', date ? date.label : ''].filter(Boolean).join(' · ');
    g.font = `italic ${Math.round(fs * 0.5)}px ${SERIF}`; g.fillStyle = '#5a4428';
    if (sub) g.fillText(sub, c.width / 2, M + H + 15 * U + fs * 1.05 + fs * 0.85);
    if (note) { g.font = `${Math.round(22 * U)}px ${SCRIPT}`; g.textAlign = 'right'; g.fillStyle = '#4a3218'; g.fillText(note.slice(0, 90), c.width - M, c.height - 22 * U); }
    g.font = `italic ${Math.round(13 * U)}px ${SERIF}`; g.textAlign = 'left'; g.fillStyle = '#6b5434';
    g.fillText(`Plate ${roman(1 + Math.floor(Math.random() * 39))}`, M, c.height - 22 * U);
    return c;
  }
  function roman(n) { const R = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, l] of R) while (n >= v) { s += l; n -= v; } return s; }

  // ───────── showing it, saving it ─────────
  function showCard(card, at) {
    card.toBlob(blob => {
      if (!ui || !blob) return;
      if (ui.url) URL.revokeObjectURL(ui.url);
      ui.url = URL.createObjectURL(blob); ui.blob = blob;
      const file = `Postcard from ${(at.name || 'the world').replace(/[\\/:*?"<>|]+/g, '')}.png`;
      const canCopy = !!(navigator.clipboard && window.ClipboardItem && window.isSecureContext);
      const save = () => { const a = h('a', { href: ui.url, download: file }); document.body.append(a); a.click(); a.remove(); };
      const copy = async () => {
        try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': ui.blob })]); toast('Copied: paste it wherever you like.'); }
        catch (e) { toast('Couldn’t copy the picture here: save it instead.', true); }
      };
      if (ui.view) ui.view.remove();
      ui.view = h('div', { class: 'pcview' },
        h('div', { class: 'pcshot' }, h('img', { src: ui.url, alt: caption || 'A postcard' })),
        h('div', { class: 'pcbar' },
          h('button', { class: 'btn primary', onclick: save }, '⤓ Save the picture'),
          canCopy ? h('button', { class: 'btn', onclick: copy }, 'Copy it') : null,
          h('button', { class: 'btn', onclick: closeView }, 'Take another'),
          h('button', { class: 'btn', onclick: close }, 'Done')));
      ui.view.addEventListener('click', e => { if (e.target === ui.view) closeView(); });
      document.body.append(ui.view);
      requestAnimationFrame(() => ui && ui.view && ui.view.classList.add('on'));
    }, 'image/png');
  }
  function closeView() { if (ui && ui.view) { const v = ui.view; ui.view = null; v.classList.remove('on'); setTimeout(() => v.remove(), 250); } }

  return { open, close, active: () => !!ui };
};
