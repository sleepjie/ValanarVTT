/* Ambient sounds on a battle map: a crackling fire, a waterfall, a tavern's hubbub, each looped and heard within its
 * range, louder the nearer you are. Each says what walls do to it: let it through, muffle it (quieter and dull, as
 * through a door), or stop it. A player hears from their tokens (the nearest one that hears it best); the GM from the
 * tokens they've selected, or else from the middle of the screen. Volume follows each person's Ambience slider.
 * The GM places them with the sound tool (N): click to add one, drag to move it, pick its sound in the bar. */
'use strict';
(function () {
const { h, state, on } = V;
const ST = () => V.stage;
const sounds = () => state.scene && state.scene.sounds ? [...state.scene.sounds.values()] : [];
let sel = null, drag = null;

// ───────── hearing ─────────
const pxPerFoot = () => { const g = state.scene && state.scene.meta.grid; return ST().gs() / ((g && g.feet) || 5); };
function listeners() {
  const nodes = ST().nodes, here = t => { const n = nodes.get(t.id); return n ? [n.x, n.y] : [t.x, t.y]; };
  const toks = state.scene ? [...state.scene.tokens.values()] : [];
  if (V.isGM()) {
    const sel = [...state.sel].map(id => state.scene.tokens.get(id)).filter(Boolean);
    if (sel.length) return sel.map(here);
    const c = V.viewCenter(); return [[c.x, c.y]];
  }
  const mine = toks.filter(t => t.layer !== 'gm' && (t.owners || []).includes(state.me && state.me.id));
  if (mine.length) return mine.map(here);
  const c = V.viewCenter(); return [[c.x, c.y]];
}
// does a line from a to b cross a wall that sound minds? 0: no, 1: only thin things (windows, open doors' frames), 2: solid
function cross(p, q, a, b) {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (!d) return false;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d, u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 0.001 && t < 0.999 && u >= 0 && u <= 1;
}
function between(p, q) {
  let solid = 0, thin = 0;
  for (const w of state.scene.walls.values()) {
    if (w.kind === 'invisible' || ((w.kind === 'door' || w.kind === 'secret') && w.open)) continue;
    if (!cross(p, q, w.a, w.b)) continue;
    if (w.kind === 'window') thin++; else solid++;
  }
  return { solid, thin };
}
// how loud a sound is here, and whether it comes muffled
function hear(o, at) {
  const r = o.range * pxPerFoot(), d = Math.hypot(at[0] - o.x, at[1] - o.y);
  if (!o.on || !o.url || d >= r) return { g: 0, muffle: 0 };
  let g = o.vol * (0.5 + 0.5 * Math.cos(Math.PI * d / r)), muffle = 0;
  if (o.walls !== 'through') {
    const w = between([o.x, o.y], at);
    if (w.solid && o.walls === 'block') return { g: 0, muffle: 0 };
    if (w.solid) { g *= Math.pow(0.4, Math.min(3, w.solid)); muffle = 1; }
    else if (w.thin) { g *= 0.7; muffle = 0.5; }
  }
  return { g, muffle };
}

// ───────── playing ─────────
let ac = null;
const decks = new Map();   // sound id → { el, src, filt, gain, url, quietSince }
function ctx() {
  if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); if (decks.size) for (const d of decks.values()) if (d.want && d.el.paused) d.el.play().catch(() => {}); }, true);
function deck(o) {
  let d = decks.get(o.id);
  if (d && d.url !== o.url) { drop(o.id); d = null; }
  if (d) return d;
  const a = ctx(); if (!a) return null;
  const el = new Audio(); el.src = o.url; el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
  const src = a.createMediaElementSource(el), filt = a.createBiquadFilter(), gain = a.createGain();
  filt.type = 'lowpass'; filt.frequency.value = 20000; gain.gain.value = 0;
  src.connect(filt); filt.connect(gain); gain.connect(a.destination);
  d = { el, src, filt, gain, url: o.url, want: false, quietSince: 0 };
  el.addEventListener('loadedmetadata', () => { try { el.currentTime = Math.random() * (el.duration || 0); } catch (e) { /* fine */ } }, { once: true });   // (two of the same fire shouldn't crackle in step)
  decks.set(o.id, d);
  return d;
}
function drop(id) {
  const d = decks.get(id); if (!d) return;
  try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); d.gain.disconnect(); } catch (e) { /* gone */ }
  decks.delete(id);
}
function tick() {
  const list = state.scene && !(V.inWorldScene && V.inWorldScene()) ? sounds() : [];
  const live = new Set();
  if (list.length && !document.hidden && !document.body.classList.contains('siteview')) {
    const ears = listeners(), mix = V.mixLevel ? V.mixLevel('ambience') : 1;
    for (const o of list) {
      let best = { g: 0, muffle: 0 };
      for (const at of ears) { const x = hear(o, at); if (x.g > best.g) best = x; }
      const g = best.g * mix;
      let d = decks.get(o.id);
      if (g <= 0.001 && !d) continue;
      d = d || deck(o); if (!d) continue;
      live.add(o.id);
      const T = ac.currentTime;
      d.gain.gain.setTargetAtTime(g, T, 0.35);
      d.filt.frequency.setTargetAtTime(best.muffle ? (best.muffle >= 1 ? 550 : 2500) : 20000, T, 0.3);
      d.want = g > 0.001;
      if (d.want) { d.quietSince = 0; if (d.el.paused) d.el.play().catch(() => {}); }
      else if (!d.quietSince) d.quietSince = performance.now();
      else if (performance.now() - d.quietSince > 4000) { drop(o.id); live.delete(o.id); }
    }
  }
  for (const id of [...decks.keys()]) if (!live.has(id)) {   // gone, switched off, or another scene: fade, then let go
    const d = decks.get(id); d.gain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    if (!d.quietSince) d.quietSince = performance.now(); else if (performance.now() - d.quietSince > 1500) drop(id);
  }
  if (lastS !== ST().scale() && state.tool === 'sounds') draw();
}
setInterval(tick, 200);
V.ambientSounds = { hear, listeners, playing: () => [...decks.entries()].map(([id, d]) => ({ id, gain: d.gain.gain.value, cut: d.filt.frequency.value, paused: d.el.paused })) };

// ───────── the GM's tool ─────────
let lastS = 0;
function draw() {
  const box = ST().L.soundIcons; box.removeChildren().forEach(c => c.destroy({ children: true }));
  lastS = ST().scale();
  if (!(V.isGM() && state.tool === 'sounds') || !state.scene) return;
  const S = ST().scale(), k = pxPerFoot();
  for (const o of sounds()) {
    const g = new PIXI.Graphics(), on1 = o.id === sel, col = !o.on ? 0x777777 : !o.url ? 0xd06a5a : 0x6cc6e8;
    g.lineStyle(on1 ? 2 / S : 1 / S, col, on1 ? 0.9 : 0.45).beginFill(col, on1 ? 0.08 : 0.04).drawCircle(0, 0, o.range * k).endFill();
    g.lineStyle(2 / S, on1 ? 0xffffff : 0x1b2028, 1).beginFill(col, 1).drawCircle(0, 0, 10 / S).endFill();
    // a little speaker
    g.lineStyle(0).beginFill(0x10141a, 1).drawPolygon([-4 / S, -2 / S, -1 / S, -2 / S, 3 / S, -5 / S, 3 / S, 5 / S, -1 / S, 2 / S, -4 / S, 2 / S]).endFill();
    g.position.set(o.x, o.y);
    box.addChild(g);
    if (on1 || S > 0.4) {
      const t = new PIXI.Text(o.name + (o.on ? '' : ' (off)'), { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
      t.scale.set(1 / S); t.anchor.set(0.5, 0); t.position.set(o.x, o.y + 13 / S);
      box.addChild(t);
    }
  }
}
on('sounds', () => { if (sel && !state.scene.sounds.has(sel)) sel = null; draw(); if (state.tool === 'sounds') V.renderSubtools(); });
on('scene', () => { sel = null; draw(); });
on('tool', () => draw());
const near = (p, q, px) => Math.hypot(p[0] - q[0], p[1] - q[1]) * ST().scale() <= px;
V.toolHandlers.sounds = {
  down(p) {
    if (!state.scene) return false;
    const hit = sounds().find(o => near([p.x, p.y], [o.x, o.y], 13));
    if (hit) { sel = hit.id; drag = { id: hit.id, to: null }; draw(); V.renderSubtools(); V.hud(); return true; }
    const last = sel && state.scene.sounds.get(sel);   // a new one starts as a copy of the one picked (its sound, range, walls)
    const base = last ? { url: last.url, name: last.name, range: last.range, vol: last.vol, walls: last.walls } : { range: 30, vol: 0.7, walls: 'muffle' };
    V.op({ t: 'sound.add', scene: state.scene.id, sound: Object.assign(base, { x: Math.round(p.x), y: Math.round(p.y) }) })
      .then(r => { if (r.op && r.op.sound) { sel = r.op.sound.id; draw(); V.renderSubtools(); V.hud(); } });
    return false;
  },
  move(p, e, dragging) {
    if (!dragging || !drag) return;
    const o = state.scene.sounds.get(drag.id); if (!o) return;
    drag.to = [Math.round(p.x), Math.round(p.y)]; o.x = drag.to[0]; o.y = drag.to[1];
    draw();
  },
  up() { const d = drag; drag = null; if (d && d.to) V.op({ t: 'sound.update', scene: state.scene.id, id: d.id, patch: { x: d.to[0], y: d.to[1] } }); },
  key(e) {
    if (e.key === 'Escape' && sel) { sel = null; draw(); V.renderSubtools(); V.hud(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { V.op({ t: 'sound.delete', scene: state.scene.id, id: sel }); sel = null; return true; }
    return false;
  },
  hud() {
    if (sel) return 'Drag the sound to move it · Delete removes it · click elsewhere for another like it · you hear from your selected tokens, or the middle of the screen';
    return 'Click to place a sound · its ring is how far it carries · you hear from your selected tokens, or the middle of the screen';
  },
  subtools(box) {
    const o = sel && state.scene && state.scene.sounds.get(sel);
    if (!o) { box.append(h('span', { class: 'subnote' }, `${sounds().length} sound${sounds().length === 1 ? '' : 's'} on this map`)); return; }
    const set = patch => V.op({ t: 'sound.update', scene: state.scene.id, id: o.id, patch });
    const a = state.camp.audio || { tracks: [], playlists: [] };
    const inList = new Set(a.playlists.flatMap(l => l.tracks));
    const opt = t => h('option', { value: t.id, selected: t.url === o.url || null }, t.name);
    const pick = h('select', { title: 'The sound (from the Jukebox)', style: 'max-width:200px', onchange: async e => {
      const v = e.target.value;
      if (v === '+') {   // a new sound from this computer: into the Jukebox's library too
        const f = h('input', { type: 'file', accept: 'audio/*' });
        f.onchange = async () => {
          const file = f.files[0]; if (!file) return;
          try {
            V.toast('Uploading ' + file.name + '…');
            const url = await V.upload(file), name = file.name.replace(/\.[^.]+$/, '');
            await V.send({ t: 'audio', op: 'add', url, name, dur: 0, kind: 'ambience' });
            set({ url, name });
          } catch (err) { V.toast(err.message, true); }
        };
        f.click(); e.target.value = '';
        return;
      }
      const t = a.tracks.find(x => x.id === v); if (t) set({ url: t.url, name: t.name });
    } },
      h('option', { value: '', selected: !o.url || null }, o.url ? '' : 'Pick a sound…'),
      ...a.playlists.filter(l => l.tracks.length).map(l => h('optgroup', { label: l.name || 'Folder' }, ...l.tracks.map(id => a.tracks.find(t => t.id === id)).filter(Boolean).map(opt))),
      ...(a.tracks.some(t => !inList.has(t.id)) ? [h('optgroup', { label: 'Not in a folder' }, ...a.tracks.filter(t => !inList.has(t.id)).map(opt))] : []),
      h('option', { value: '+' }, 'Upload a sound…'));
    box.append(pick,
      h('label', { class: 'subfield', title: 'How far it carries, in feet' }, 'Range', h('input', { type: 'number', min: 5, step: 5, value: o.range, style: 'width:60px', onchange: e => set({ range: +e.target.value || 30 }) })),
      h('label', { class: 'subfield', title: 'How loud it is, close up' }, 'Volume', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: o.vol, style: 'width:80px', onchange: e => set({ vol: +e.target.value }) })),
      h('select', { title: 'What walls do to it (doors count while shut; windows only dull it a little)', onchange: e => set({ walls: e.target.value }) },
        ...[['through', 'Walls: heard through'], ['muffle', 'Walls: muffled'], ['block', 'Walls: stopped']].map(([k, l]) => h('option', { value: k, selected: o.walls === k || null }, l))),
      h('button', { class: o.on ? 'on' : null, title: 'Switch it on or off (off, the players don’t even know it’s there)', onclick: () => set({ on: !o.on }) }, o.on ? 'On' : 'Off'),
      h('button', { onclick: () => { V.op({ t: 'sound.delete', scene: state.scene.id, id: o.id }); sel = null; } }, 'Delete'));
  }
};
})();
