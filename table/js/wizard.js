/* Scene setup: drop an image, find the grid (automatically, or by dragging a box over one square), nudge it, save. */
'use strict';
(function () {
const { $, h, state } = V;

// ───────────────────────── grid detection ─────────────────────────
//
// Grid lines make the image's brightness change at regular intervals. Sum the edge strength down each column
// (and along each row), then find the spacing that repeats best (autocorrelation) and where the lines fall.

function period(p) {
  const n = p.length, win = 15, q = new Float64Array(n);
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - win), b = Math.min(n, i + win + 1); q[i] = p[i] - (pre[b] - pre[a]) / (b - a); }
  let mean = 0; for (const v of q) mean += v; mean /= n;
  let sd = 0; for (let i = 0; i < n; i++) { q[i] -= mean; sd += q[i] * q[i]; } sd = Math.sqrt(sd / n) || 1;
  for (let i = 0; i < n; i++) q[i] /= sd;
  const maxLag = Math.min(500, Math.floor(n / 3)), ac = new Float64Array(maxLag + 2);
  for (let lag = 5; lag <= maxLag + 1; lag++) { acc = 0; for (let i = 0; i + lag < n; i++) acc += q[i] * q[i + lag]; ac[lag] = acc / (n - lag); }
  const peaks = [];
  for (let lag = 6; lag <= maxLag; lag++) if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0.05) peaks.push(lag);
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map(l => ac[l]));
  const lag = peaks.find(l => ac[l] >= best * 0.8);
  // sub-pixel: fit a parabola through the peak
  const y0 = ac[lag - 1], y1 = ac[lag], y2 = ac[lag + 1], den = y0 - 2 * y1 + y2;
  const P = lag + (den ? 0.5 * (y0 - y2) / den : 0);
  // where the lines sit
  let bo = 0, bs = -Infinity;
  for (let o = 0; o < P; o += 0.5) {
    let s = 0;
    for (let x = o; x < n; x += P) { const i = Math.round(x); if (i < n) s += q[i]; }
    if (s > bs) { bs = s; bo = o; }
  }
  return { p: P, o: bo, conf: ac[lag] };
}
V.detectGrid = function (img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const k = Math.min(1, 2000 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), hh = Math.max(8, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, hh);
  const d = ctx.getImageData(0, 0, w, hh).data, g = new Float32Array(w * hh);
  for (let i = 0; i < w * hh; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const col = new Float64Array(w), row = new Float64Array(hh);
  for (let y = 0; y < hh - 1; y++) for (let x = 0; x < w - 1; x++) {
    const v = g[y * w + x];
    col[x] += Math.abs(g[y * w + x + 1] - v);
    row[y] += Math.abs(g[(y + 1) * w + x] - v);
  }
  const px = period(col), py = period(row);
  if (!px || !py) return null;
  let size;
  if (Math.abs(px.p - py.p) / Math.max(px.p, py.p) < 0.05) size = (px.p + py.p) / 2;
  else size = px.conf >= py.conf ? px.p : py.p;
  const conf = Math.min(px.conf, py.conf) * (Math.abs(px.p - py.p) / Math.max(px.p, py.p) < 0.05 ? 1 : 0.5);
  const S = size / k;
  return { size: Math.round(S * 100) / 100, ox: Math.round((px.o / k) % S * 10) / 10, oy: Math.round((py.o / k) % S * 10) / 10, conf, across: W / S, down: H / S };
};

// ───────────────────────── the dialog ─────────────────────────

V.openWizard = function (sceneId) {
  const old = sceneId ? state.camp.scenes.find(s => s.id === sceneId) : null;
  const cur = old && state.scene && state.scene.id === sceneId ? state.scene.meta : null;
  if (sceneId && !cur) {   // settings for a scene not on screen: look at it first
    V.once('scene', () => { if (state.scene && state.scene.id === sceneId) V.openWizard(sceneId); });
    V.viewScene(sceneId);
    return;
  }
  const W = {
    id: sceneId, name: cur ? cur.name : 'New scene', image: cur ? cur.image : null, file: null, imgEl: null,
    grid: Object.assign({ type: 'square', size: 100, ox: 0, oy: 0, feet: 5, units: 'ft', diagonal: 'one', color: '#000000', alpha: 0.35 }, cur ? cur.grid : {}),
    darkness: cur ? cur.darkness || 0 : 0, fog: cur ? !!cur.fog : false, vision: cur ? !!cur.vision : false, bg: cur ? cur.bg || '#1b1d22' : '#1b1d22', rings: cur ? cur.rings !== false : true,
    clock: cur ? !!cur.clock : false, weather: cur ? !!cur.weather : false,
    blank: cur ? !cur.image : false, cols: cur && cur.area ? cur.area.cols : 30, rows: cur && cur.area ? cur.area.rows : 20, detect: null, boxing: false
  };
  const view = { s: 1, x: 0, y: 0 };
  const modal = $('#modal');
  const canvas = h('canvas');
  const dropZone = h('div', { class: 'drop' },
    h('b', null, 'Drop a battle map here'), h('span', null, 'PNG, JPG or WebP'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => fileIn.click() }, 'Choose an image'),
      h('button', { class: 'btn', onclick: () => { W.blank = true; W.image = null; if (W.grid.color === '#000000') { W.grid.color = '#d8cfba'; W.grid.alpha = 0.2; } dropZone.hidden = true; fitView(); draw(); renderSide(); } }, 'Blank scene, no image')),
    // or make one: the map generator (planner.js), with walls, doors, lights and loot
    !sceneId && V.openDungeonGenerator ? h('div', { class: 'wizgen' },
      h('span', { class: 'or' }, 'or'),
      h('button', { class: 'btn primary', onclick: () => { close(); V.openDungeonGenerator({ back: () => V.openWizard() }); } }, '⚄ Generate a map'),
      h('span', { class: 'muted small' }, 'A dungeon, caves or a building (tavern, manor, shop…): walls, doors, lights and loot included')) : null);
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: () => fileIn.files[0] && takeFile(fileIn.files[0]) });
  const hint = h('div', { class: 'pvhint' });
  const pv = h('div', { class: 'pvw' }, canvas, dropZone, hint, fileIn);
  const side = h('div', { class: 'side' });
  const status = h('span', { class: 'muted small grow' });
  const saveBtn = h('button', { class: 'btn primary', onclick: save }, sceneId ? 'Save' : 'Create scene');
  const dlg = h('div', { class: 'dialog wide' },
    h('div', { class: 'dh' }, h('h2', null, sceneId ? 'Scene settings' : 'New scene'), h('button', { title: 'Close', onclick: close }, '×')),
    h('div', { class: 'db' }, h('div', { class: 'wiz' }, pv, side)),
    h('div', { class: 'df' }, status, h('button', { class: 'btn', onclick: close }, 'Cancel'), saveBtn));
  modal.replaceChildren(dlg); modal.hidden = false;
  dropZone.hidden = !!(W.image || W.blank);
  const esc = e => { if (e.key === 'Escape' && !W.boxing) close(); else if (e.key === 'Escape') { W.boxing = false; canvas.classList.remove('boxing'); draw(); } };
  document.addEventListener('keydown', esc);
  function close() { document.removeEventListener('keydown', esc); modal.hidden = true; modal.replaceChildren(); if (W.objUrl) URL.revokeObjectURL(W.objUrl); }

  // --- image ---
  pv.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
  pv.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  pv.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type)); if (f) takeFile(f); });
  async function takeFile(f) {
    try {
      const r = await V.imageSize(f);
      const maxTex = maxTexture();
      let file = f, w = r.w, hh = r.h, img = r.img;
      if (Math.max(w, hh) > maxTex) {   // too big for the graphics card: shrink once, here
        const k = maxTex / Math.max(w, hh), c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.92));
        file = new File([blob], f.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
        const r2 = await V.imageSize(file); w = r2.w; hh = r2.h; img = r2.img;
        V.toast(`That image was larger than your graphics card can show (${maxTex}px), so it was scaled down to ${w}×${hh}.`);
      }
      W.file = file; W.imgEl = img; W.objUrl = img.src; W.image = { url: null, w, h: hh }; W.blank = false;
      if (!sceneId || W.name === 'New scene') W.name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b(\d+x\d+|gridded|grid|day|night|hd|4k)\b/gi, '').replace(/\s+/g, ' ').trim() || 'New scene';
      dropZone.hidden = true;
      autoDetect();
      fitView(); draw(); renderSide();
    } catch (e) { V.toast(e.message, true); }
  }
  function maxTexture() {
    try { const app = V.stageApp(); const gl = app.renderer.gl; return Math.min(16384, gl.getParameter(gl.MAX_TEXTURE_SIZE)); } catch (e) { return 8192; }
  }
  function autoDetect() {
    if (!W.imgEl) return;
    const d = V.detectGrid(W.imgEl);
    W.detect = d;
    if (d && d.conf > 0.12 && d.size >= 12) Object.assign(W.grid, { type: W.grid.type === 'none' ? 'square' : W.grid.type, size: d.size, ox: d.ox, oy: d.oy });
  }
  if (W.image && W.image.url) {
    const img = new Image();
    img.onload = () => { W.imgEl = img; fitView(); draw(); };
    img.src = W.image.url;
  }

  // --- preview: zoom with the wheel, drag to pan; "draw one square" drags a box ---
  const sz = () => W.image ? [W.image.w, W.image.h] : [W.cols * W.grid.size, W.rows * W.grid.size];
  function fitView() {
    const r = pv.getBoundingClientRect(), [w, hh] = sz();
    view.s = Math.min(r.width / w, r.height / hh) * 0.95;
    view.x = (r.width - w * view.s) / 2; view.y = (r.height - hh * view.s) / 2;
  }
  let box = null, pan = null;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.pow(1.0018, -e.deltaY), s1 = V.clamp(view.s * f, 0.02, 20);
    view.x = mx - (mx - view.x) * s1 / view.s; view.y = my - (my - view.y) * s1 / view.s; view.s = s1;
    draw();
  }, { passive: false });
  const toImg = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.s, (e.clientY - r.top - view.y) / view.s]; };
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    if (W.boxing && e.button === 0) { const p = toImg(e); box = { a: p, b: p }; return; }
    pan = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
  });
  canvas.addEventListener('pointermove', e => {
    if (box) { box.b = toImg(e); draw(); return; }
    if (pan) { view.x = pan.x + e.clientX - pan.sx; view.y = pan.y + e.clientY - pan.sy; draw(); }
  });
  canvas.addEventListener('pointerup', () => {
    if (box) {
      const [ax, ay] = box.a, [bx, by] = box.b, bw = Math.abs(bx - ax), bh = Math.abs(by - ay);
      if (bw > 4 && bh > 4) {
        const g = W.grid, x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
        if (g.type === 'square' || g.type === 'none') { g.type = 'square'; g.size = Math.round((bw + bh) / 2 * 10) / 10; g.ox = Math.round(x0 % g.size * 10) / 10; g.oy = Math.round(y0 % g.size * 10) / 10; }
        else { g.size = Math.round((g.type === 'hexr' ? bw : bh) * 10) / 10; g.ox = x0 + bw / 2; g.oy = y0 + bh / 2; }
        W.detect = null;
      }
      box = null; W.boxing = false; canvas.classList.remove('boxing');
      draw(); renderSide();
    }
    pan = null;
  });
  new ResizeObserver(() => { draw(); }).observe(pv);

  function draw() {
    const r = pv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    if (!(W.image || W.blank)) return;
    const [w, hh] = sz();
    ctx.save();
    ctx.translate(view.x, view.y); ctx.scale(view.s, view.s);
    ctx.fillStyle = W.bg; ctx.fillRect(0, 0, w, hh);
    if (W.imgEl) ctx.drawImage(W.imgEl, 0, 0, w, hh);
    // grid, drawn bright so it's easy to line up
    const g = W.grid;
    if (g.type !== 'none' && g.size > 2) {
      ctx.lineWidth = 1.5 / view.s; ctx.strokeStyle = 'rgba(255, 60, 120, 0.85)';
      ctx.beginPath();
      if (g.type === 'square') {
        for (let x = g.ox - Math.floor(g.ox / g.size) * g.size; x <= w; x += g.size) { ctx.moveTo(x, 0); ctx.lineTo(x, hh); }
        for (let y = g.oy - Math.floor(g.oy / g.size) * g.size; y <= hh; y += g.size) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      } else {
        const S3 = Geom.S3, lim = 20000; let n = 0;
        const add = (q, rr) => { const [cx, cy] = Geom.hexCentre(g, q, rr), c = Geom.hexCorners(g, cx, cy); ctx.moveTo(c[0], c[1]); for (let i = 2; i < 12; i += 2) ctx.lineTo(c[i], c[i + 1]); ctx.closePath(); n++; };
        if (g.type === 'hexr') { const rowH = g.size * S3 / 2; for (let rr = Math.floor((-g.size - g.oy) / rowH); g.oy + rr * rowH <= hh + g.size && n < lim; rr++) for (let q = Math.floor((-g.size - g.ox) / g.size - rr / 2); g.ox + g.size * (q + rr / 2) <= w + g.size && n < lim; q++) add(q, rr); }
        else { const colW = g.size * S3 / 2; for (let q = Math.floor((-g.size - g.ox) / colW); g.ox + q * colW <= w + g.size && n < lim; q++) for (let rr = Math.floor((-g.size - g.oy) / g.size - q / 2); g.oy + g.size * (rr + q / 2) <= hh + g.size && n < lim; rr++) add(q, rr); }
      }
      ctx.stroke();
    }
    if (box) {
      const [ax, ay] = box.a, [bx, by] = box.b;
      ctx.lineWidth = 2 / view.s; ctx.strokeStyle = '#c9a45c'; ctx.fillStyle = 'rgba(201,164,92,0.2)';
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }
    ctx.restore();
    hint.textContent = W.boxing ? 'Drag a box exactly over one grid square' : 'Scroll to zoom, drag to move. The pink lines are the grid.';
  }

  // --- settings ---
  function renderSide() {
    const g = W.grid;
    const num = (val, attrs, onch) => h('input', Object.assign({ type: 'number', value: val, onchange: e => { onch(+e.target.value); draw(); renderSide(); } }, attrs));
    const nudge = (dx, dy) => () => { g.ox = Math.round((g.ox + dx) * 10) / 10; g.oy = Math.round((g.oy + dy) * 10) / 10; draw(); renderSide(); };
    const resize = d => () => { g.size = Math.max(4, Math.round((g.size + d) * 100) / 100); draw(); renderSide(); };
    const hasImg = !!W.image;
    const d = W.detect;
    side.replaceChildren(
      h('h3', null, 'Scene'),
      h('label', null, 'Name'), h('input', { value: W.name, style: 'width:100%', oninput: e => { W.name = e.target.value; } }),
      hasImg ? h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted small grow' }, `${W.image.w} × ${W.image.h} px`), h('button', { class: 'btn sm', onclick: () => fileIn.click() }, 'Change image')) : null,
      W.blank ? h('div', { class: 'two' },
        h('div', null, h('label', null, 'Width (squares)'), num(W.cols, { min: 1, max: 200, style: 'width:100%' }, v => { W.cols = V.clamp(v, 1, 200); fitView(); })),
        h('div', null, h('label', null, 'Height (squares)'), num(W.rows, { min: 1, max: 200, style: 'width:100%' }, v => { W.rows = V.clamp(v, 1, 200); fitView(); }))) : null,

      h('h3', null, 'Grid'),
      h('div', { class: 'seg' }, ...[['square', 'Square'], ['hexr', 'Hex rows'], ['hexc', 'Hex cols'], ['none', 'None']].map(([k, l]) =>
        h('button', { class: g.type === k ? 'on' : null, title: k === 'hexr' ? 'Pointy-topped hexes in rows' : k === 'hexc' ? 'Flat-topped hexes in columns' : null, onclick: () => { g.type = k; draw(); renderSide(); } }, l))),
      hasImg && g.type !== 'none' ? h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', onclick: () => { autoDetect(); draw(); renderSide(); }, disabled: g.type !== 'square' }, 'Find the grid'),
        h('button', { class: 'btn sm' + (W.boxing ? ' primary' : ''), onclick: () => { W.boxing = !W.boxing; canvas.classList.toggle('boxing', W.boxing); draw(); renderSide(); } }, W.boxing ? 'Drag a box…' : 'Draw one square')) : null,
      d && hasImg && g.type === 'square' ? h('div', { class: 'detect ' + (d.conf > 0.3 ? 'good' : 'poor') },
        d.conf > 0.12 ? `Found a grid of about ${Math.round(d.across * 10) / 10} × ${Math.round(d.down * 10) / 10} squares${d.conf > 0.3 ? '.' : '. Not certain: check the pink lines.'}`
          : 'Couldn’t find a grid. Use “Draw one square”, or type the number of squares across.') : null,
      g.type !== 'none' ? h('div', null,
        h('div', { class: 'two' },
          h('div', null, h('label', null, g.type === 'square' ? 'Square size (px)' : 'Hex size (px)'),
            h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:3px' }, h('button', { class: 'btn sm', onclick: resize(-0.1), title: '−0.1 px' }, '−'),
              num(g.size, { step: 0.1, min: 4, style: 'width:100%' }, v => { g.size = Math.max(4, v); }), h('button', { class: 'btn sm', onclick: resize(0.1), title: '+0.1 px' }, '+'))),
          hasImg && g.type === 'square' ? h('div', null, h('label', null, 'Squares across'),
            num(Math.round(W.image.w / g.size * 100) / 100, { step: 1, min: 1, style: 'width:100%' }, v => { if (v > 0) g.size = Math.round(W.image.w / v * 100) / 100; })) : h('div')),
        h('label', null, 'Line up the grid (1 px per click)'),
        h('div', { class: 'row', style: 'align-items:flex-start' },
          h('div', { class: 'nudge' }, h('span'), h('button', { onclick: nudge(0, -1) }, '↑'), h('span'), h('button', { onclick: nudge(-1, 0) }, '←'),
            h('button', { onclick: () => { g.ox = 0; g.oy = 0; draw(); renderSide(); }, title: 'Reset' }, '0'), h('button', { onclick: nudge(1, 0) }, '→'), h('span'), h('button', { onclick: nudge(0, 1) }, '↓'), h('span')),
          h('div', { class: 'small muted', style: 'padding-top:4px' }, `Offset ${g.ox}, ${g.oy}`)),
        h('div', { class: 'two' },
          h('div', null, h('label', null, 'Each square is'), h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' },
            num(g.feet, { step: 0.5, min: 0.01, style: 'width:64px' }, v => { g.feet = v > 0 ? v : 5; }),
            h('input', { value: g.units, style: 'width:56px', onchange: e => { g.units = e.target.value.trim() || 'ft'; } }))),
          g.type === 'square' ? h('div', null, h('label', null, 'Diagonals'), h('select', { style: 'width:100%', onchange: e => { g.diagonal = e.target.value; } },
            ...[['one', 'Count as one square (5e)'], ['alt', 'Alternate 5/10'], ['euclid', 'True distance']].map(([k, l]) => h('option', { value: k, selected: g.diagonal === k || null }, l)))) : h('div')),
        h('div', { class: 'two' },
          h('div', null, h('label', null, 'Line colour'), h('input', { type: 'color', value: g.color, onchange: e => { g.color = e.target.value; } })),
          h('div', null, h('label', null, `Line strength ${Math.round(g.alpha * 100)}%`), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: g.alpha, oninput: e => { g.alpha = +e.target.value; e.target.previousSibling.textContent = `Line strength ${Math.round(g.alpha * 100)}%`; } })))) : null,

      h('h3', null, 'Light and sight'),
      h('label', null, `Darkness ${Math.round(W.darkness * 100)}%`),
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: W.darkness, oninput: e => { W.darkness = +e.target.value; e.target.previousSibling.textContent = `Darkness ${Math.round(W.darkness * 100)}%`; } }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: W.fog, onchange: e => { W.fog = e.target.checked; } }), 'Fog of war (reveal areas with the fog tool)'),
      h('label', { class: 'inline', title: 'Players see only what their tokens can see: draw walls with the walls tool and place lights with the lights tool.' }, h('input', { type: 'checkbox', checked: W.vision, onchange: e => { W.vision = e.target.checked; } }), 'Token sight (players see only what their tokens see)'),
      h('label', { class: 'inline', title: 'The darkness follows the world’s clock: bright by day, dark at night (the clock is in the top bar). For outdoor scenes.' }, h('input', { type: 'checkbox', checked: W.clock, onchange: e => { W.clock = e.target.checked; } }), 'Light follows the time of day: dark at night, its colour with the hour'),
      h('label', { class: 'inline', title: 'Rain, snow, fog and the shadows of clouds, from the weather set by the clock in the top bar.' }, h('input', { type: 'checkbox', checked: W.weather, onchange: e => { W.weather = e.target.checked; if (W.weather && !W.clock) { W.clock = true; renderSide(); } } }), 'Show the weather on this scene (and the time of day)'),
      h('h3', null, 'Tokens'),
      h('label', { class: 'inline', title: 'Off: tokens show their bare picture with no round frame (good for sprites). Each token can still choose for itself.' }, h('input', { type: 'checkbox', checked: W.rings, onchange: e => { W.rings = e.target.checked; } }), 'Round tokens with a ring'),
      !hasImg ? h('div', null, h('label', null, 'Background colour'), h('input', { type: 'color', value: W.bg, onchange: e => { W.bg = e.target.value; draw(); } })) : null
    );
    saveBtn.disabled = !(W.image || W.blank);
  }

  async function save() {
    saveBtn.disabled = true; status.textContent = W.file ? 'Uploading the image…' : 'Saving…';
    try {
      let image = W.image ? { url: W.image.url, w: W.image.w, h: W.image.h } : null;
      if (W.file) image.url = await V.upload(W.file);
      const meta = { name: W.name.trim() || 'Scene', image: W.blank ? null : image, grid: W.grid, darkness: W.darkness, fog: W.fog, vision: W.vision, bg: W.bg, rings: W.rings, clock: W.clock, weather: W.weather, area: { cols: W.cols, rows: W.rows } };
      if (sceneId) await V.op({ t: 'scene.update', id: sceneId, patch: meta });
      else {
        const r = await V.op({ t: 'scene.create', scene: meta });
        if (r.op && r.op.scene) V.viewScene(r.op.scene.id);
      }
      close();
    } catch (e) { status.textContent = ''; saveBtn.disabled = false; V.toast(e.message, true); }
  }
  setTimeout(() => { fitView(); draw(); }, 0);
  renderSide();
};
})();
