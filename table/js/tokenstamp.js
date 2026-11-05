/* Token stamp: a round, framed token made from a character's portrait, here on the table (no more token-stamp sites).
 *  - V.stampTokenFor(ch): opens the stamp: drag the picture to frame the face, the wheel or slider to zoom, pick a
 *    frame. "Use" saves a 512 px PNG as the character's token (ch.token) and swaps it onto their tokens.
 *  - V.charTokenImg(ch): the picture for a new token of this character: its token, or (once, quietly) one stamped
 *    from its portrait with a first guess at the framing, or the portrait itself if that can't be done.
 * The portrait (ch.avatar) is left as it is: the journal, sheets and handouts keep using it. */
'use strict';
(function () {
  const { h, state } = V;
  const OUT = 512;
  const FRAMES = [
    ['gold', 'Gold', ['#5a3f12', '#f6d98a', '#a9792c', '#fbe7a8', '#6b4a16']],
    ['silver', 'Silver', ['#3c4148', '#f2f4f7', '#8d949d', '#ffffff', '#4a5058']],
    ['bronze', 'Bronze', ['#4a2410', '#e8a46a', '#8c4e24', '#f3c08f', '#552a12']],
    ['iron', 'Iron', ['#101214', '#6d737a', '#2b2f34', '#8b9198', '#15171a']],
    ['wood', 'Wood', ['#2b170a', '#a8733f', '#5e3a1b', '#c58e55', '#331c0c']],
    ['none', 'None', null]
  ];
  const loadImg = src => new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => rej(new Error('That picture could not be loaded'));
    im.src = src;
  });
  // the first guess: the circle covers the picture's short side; on a tall picture it sits high, where faces usually are
  const guess = im => ({ zoom: 1, cx: 0.5, cy: im.naturalHeight > im.naturalWidth * 1.1 ? 0.36 : 0.5 });
  // draw the token onto a canvas context of size S. v = { zoom, cx, cy } (centre as a fraction of the picture)
  function paint(g, im, v, frame, S) {
    const W = im.naturalWidth, H = im.naturalHeight, r = S / 2;
    const fw = frame && frame !== 'none' ? S * 0.07 : 0;
    const base = S / Math.min(W, H) * v.zoom;               // picture px → canvas px
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(r, r, r - fw * 0.5, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#222'; g.fillRect(0, 0, S, S);
    g.drawImage(im, r - v.cx * W * base, r - v.cy * H * base, W * base, H * base);
    g.restore();
    const f = FRAMES.find(x => x[0] === frame);
    if (f && f[2]) {
      const [d1, l1, m, l2, d2] = f[2], gr = g.createLinearGradient(0, 0, S, S);
      gr.addColorStop(0, l1); gr.addColorStop(0.3, m); gr.addColorStop(0.5, l2); gr.addColorStop(0.75, m); gr.addColorStop(1, d2);
      g.lineWidth = fw; g.strokeStyle = gr; g.beginPath(); g.arc(r, r, r - fw / 2, 0, Math.PI * 2); g.stroke();
      g.lineWidth = Math.max(1, S * 0.008); g.strokeStyle = d1;
      g.beginPath(); g.arc(r, r, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(r, r, r - fw, 0, Math.PI * 2); g.stroke();
    }
  }
  const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('The token could not be made')), 'image/png'));
  async function render(im, v, frame, name) {
    const cv = document.createElement('canvas'); cv.width = cv.height = OUT;
    paint(cv.getContext('2d'), im, v, frame, OUT);
    const blob = await toBlob(cv);   // throws on a picture from another site that won't allow it (a "tainted" canvas)
    return V.upload(new File([blob], (name || 'token').replace(/[^\w-]+/g, '_').slice(0, 40) + '-token.png', { type: 'image/png' }));
  }
  // save it as the character's token, and put it on their tokens that still show the old picture
  async function useToken(ch, url) {
    const old = new Set([ch.token, ch.avatar, null, undefined, ''].filter(x => x !== undefined));
    await V.op({ t: 'char.update', id: ch.id, patch: { token: url } });
    const sc = state.scene; if (!sc) return;
    const ops = [...sc.tokens.values()].filter(t => t.sheet === ch.id && (old.has(t.img) || !t.img))
      .map(t => ({ t: 'token.update', scene: sc.id, id: t.id, patch: { img: url } }));
    if (ops.length) await V.op({ t: 'batch', ops }).catch(() => {});
  }

  V.charTokenImg = async function (ch) {
    if (!ch) return null;
    if (ch.token) return ch.token;
    if (!ch.avatar) return null;
    const mine = V.isGM() || (ch.owners || []).includes(state.me.id);
    if (!mine) return ch.avatar;
    try {
      const im = await loadImg(ch.avatar);
      const url = await render(im, guess(im), 'gold', ch.name);
      await V.op({ t: 'char.update', id: ch.id, patch: { token: url } });
      return url;
    } catch (e) { return ch.avatar; }
  };

  V.stampTokenFor = async function (ch, done) {
    const src = ch.avatar || ch.token;
    if (!src) return V.toast('Add a picture first: the token is made from it.', true);
    let im;
    try { im = await loadImg(src); } catch (e) { return V.toast(e.message, true); }
    const v = guess(im); let frame = 'gold';
    const S = 300, cv = h('canvas', { width: S * 2, height: S * 2, class: 'stampcv', title: 'Drag to move the picture, scroll to zoom' });
    const g = cv.getContext('2d');
    const draw = () => paint(g, im, v, frame, S * 2);
    const zoom = h('input', { type: 'range', min: 1, max: 5, step: 0.01, value: 1, oninput: e => { v.zoom = +e.target.value; draw(); } });
    const frames = h('div', { class: 'stampframes' });
    const drawFrames = () => frames.replaceChildren(...FRAMES.map(([id, name, c]) => h('button', {
      class: 'stampfr' + (id === frame ? ' on' : ''), title: name, onclick: () => { frame = id; drawFrames(); draw(); },
      style: c ? `background: linear-gradient(135deg, ${c[1]}, ${c[2]} 45%, ${c[3]} 60%, ${c[4]})` : '' }, c ? '' : '∅')));
    drawFrames();
    // drag to pan: canvas px → picture fraction
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = v.cx, oy = v.cy;
      const per = (S / Math.min(im.naturalWidth, im.naturalHeight)) * v.zoom;   // screen px per picture px
      const move = ev => { v.cx = ox - (ev.clientX - sx) / per / im.naturalWidth; v.cy = oy - (ev.clientY - sy) / per / im.naturalHeight; draw(); };
      const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
      cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); v.zoom = V.clamp(v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 5); zoom.value = v.zoom; draw(); }, { passive: false });
    const modal = $m(); const close = () => { modal.hidden = true; modal.replaceChildren(); };
    const useBtn = h('button', { class: 'btn primary', onclick: async () => {
      useBtn.disabled = true; useBtn.textContent = 'Saving…';
      try { const url = await render(im, v, frame, ch.name); await useToken(ch, url); close(); V.toast(`${ch.name}’s token is ready.`); if (done) done(url); }
      catch (e) { useBtn.disabled = false; useBtn.textContent = 'Use this token'; V.toast(/tainted|insecure/i.test(e.message) ? 'That picture is on another site that doesn’t allow this. Upload the picture here first (Change, in the character’s settings).' : e.message, true); }
    } }, 'Use this token');
    modal.replaceChildren(h('div', { class: 'dialog stampdlg' },
      h('div', { class: 'dh' }, h('h2', null, `Token for ${ch.name}`), h('button', { onclick: close }, '×')),
      h('div', { class: 'db' },
        h('p', { class: 'muted small' }, 'Drag the picture to put the face in the circle; scroll or use the slider to zoom. The portrait itself stays as it is.'),
        h('div', { class: 'stampwrap' }, cv),
        h('label', null, 'Zoom'), zoom,
        h('label', null, 'Frame'), frames),
      h('div', { class: 'df' },
        ch.token ? h('button', { class: 'btn', title: 'Go back to using the portrait for tokens', onclick: async () => { await V.op({ t: 'char.update', id: ch.id, patch: { token: null } }); close(); if (done) done(null); } }, 'Use the portrait instead') : null,
        h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), useBtn)));
    modal.hidden = false;
    draw();
  };
  function $m() { return document.getElementById('modal'); }
})();
