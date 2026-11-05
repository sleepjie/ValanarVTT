/* The jukebox: three channels (music, ambience, effects) everyone hears in step, playlists, crossfades, presets
 * and a soundboard. The GM runs it from the Jukebox tab; everyone sets their own volume there.
 * The server keeps the clock: each channel says which track and when it (notionally) started. */
'use strict';
(function () {
const { $, h, state, on } = V;
const CH = [['music', 'Music'], ['ambience', 'Ambience'], ['effects', 'Effects']];
const now = () => Date.now() + (V.clockSkew || 0);
const local = (() => { let v = {}; try { v = JSON.parse(localStorage.getItem('vtt-audio-vol') || '{}'); } catch (e) { /* none saved */ } return Object.assign({ master: 0.8, music: 1, ambience: 1, effects: 1, table: 0.7 }, v); })();
// how loud this person has a kind of sound (their own sliders): ambient sounds on the map follow Ambience
V.mixLevel = k => (local[k] == null ? 1 : local[k]) * local.master;
const saveLocal = () => { try { localStorage.setItem('vtt-audio-vol', JSON.stringify(local)); } catch (e) { /* not kept */ } };
const audio = () => state.camp && state.camp.audio;
const send = (op, extra) => V.send(Object.assign({ t: 'audio', op }, extra || {})).catch(e => V.toast(e.message, true));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ───────────────────────── playing ─────────────────────────

const decks = {};   // channel -> { el, key, url } (plus elements fading out)
let blocked = false;
function level(ch) { const a = audio(); return a ? a.ch[ch].vol * local[ch] * local.master : 0; }
function fadeTo(el, target, secs, done) {
  clearInterval(el._fade); el._fading = true;
  const from = el.volume, t0 = performance.now(), dur = Math.max(0.05, secs) * 1000;
  el._fade = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
    if (k >= 1) { clearInterval(el._fade); el._fading = false; if (done) done(); }
  }, 40);
}
function tryPlay(el) {
  const p = el.play();
  if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') { blocked = true; $('#joinAudio').hidden = false; } });
}
function sync() {
  const a = audio(); if (!a) return;
  for (const [ch] of CH) {
    const c = a.ch[ch], t = c.track && a.tracks.find(x => x.id === c.track);
    let d = decks[ch];
    const key = t ? t.id + '@' + c.started : null;
    if (!t) { if (d) { const old = d.el; fadeTo(old, 0, a.fade || 0.3, () => { old.pause(); old.removeAttribute('src'); }); delete decks[ch]; } continue; }
    const pos = c.paused != null ? c.paused : (now() - c.started) / 1000;
    if (!d || d.key !== key) {
      // a different track (or the same one started again): fade the old one out as the new one fades in
      if (d) { const old = d.el; fadeTo(old, 0, a.fade || 0.3, () => { old.pause(); old.removeAttribute('src'); }); }
      const el = new Audio();
      el.preload = 'auto'; el.src = t.url; el.volume = 0;
      const startAt = () => { try { el.currentTime = Math.max(0, t.dur ? pos % Math.max(1, t.dur) : pos); } catch (e) { /* not seekable yet */ } };
      el.addEventListener('loadedmetadata', startAt, { once: true });
      d = decks[ch] = { el, key };
      if (c.paused == null) { tryPlay(el); fadeTo(el, level(ch), d && a.fade ? a.fade : 0.3); }
      continue;
    }
    // same track: follow pause and volume, and keep in step
    if (c.paused != null && !d.el.paused) { d.el.pause(); try { d.el.currentTime = c.paused; } catch (e) { /* not seekable */ } }
    else if (c.paused == null && d.el.paused && !blocked) { try { d.el.currentTime = pos; } catch (e) { /* not seekable */ } tryPlay(d.el); }
    if (!d.el._fading) d.el.volume = Math.min(1, level(ch));
  }
}
// drift: if a player's track wandered more than a second from the GM's clock, jump back in step
setInterval(() => {
  const a = audio(); if (!a) return;
  for (const [ch] of CH) {
    const d = decks[ch], c = a.ch[ch];
    if (!d || c.paused != null || d.el.paused || d.el.readyState < 2) continue;
    const want = (now() - c.started) / 1000;
    if (Math.abs(d.el.currentTime - want) > 1.2 && want < (d.el.duration || 1e9)) try { d.el.currentTime = want; } catch (e) { /* not seekable */ }
  }
  if (state.camp && $('#tab-audio').classList.contains('on')) renderTimes();
}, 1000);
$('#joinAudio').onclick = () => {
  blocked = false; $('#joinAudio').hidden = true;
  for (const d of Object.values(decks)) if (d.el.paused && audio()) tryPlay(d.el);
  sync();
};
on('meta', sync);
V.jukeboxNow = () => Object.fromEntries(Object.entries(decks).map(([k, d]) => [k, { src: d.el.src.replace(location.origin, ''), t: Math.round(d.el.currentTime * 10) / 10, paused: d.el.paused, vol: Math.round(d.el.volume * 100) / 100 }]));
on('sfx', m => { const el = new Audio(m.url); el.volume = Math.min(1, (m.vol ?? 0.8) * local.effects * local.master); tryPlay(el); });

// ───────────────────────── the Jukebox tab ─────────────────────────
//
// Now playing (music, ambience, effects volume) · Scenes (saved moods) · the Library: sounds in folders.
// A folder is also a playlist: it plays on its channel (Music or Ambience) in order or shuffled;
// an Effects folder is a soundboard of pads that play once for everyone.

const SVG = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM16 5h3v14h-3z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/></svg>',
  loop1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/><path d="M11 10.5l1.5-1v5.5" stroke-width="1.7"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  ear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity="0.85"/></svg>'
};
const icon = (k, title, onclick, cls) => { const b = h('button', { class: 'ib' + (cls ? ' ' + cls : ''), title, onclick }); b.innerHTML = SVG[k]; return b; };
const KIND = { music: 'Music', ambience: 'Ambience', effects: 'Effects' };
const NEXT_KIND = { music: 'ambience', ambience: 'effects', effects: 'music' };
let openF = new Set((() => { try { return JSON.parse(localStorage.getItem('vtt-audio-open') || '[]'); } catch (e) { return []; } })());
const saveOpen = () => { try { localStorage.setItem('vtt-audio-open', JSON.stringify([...openF])); } catch (e) { /* not kept */ } };
let presetName = '', filter = '', renaming = null, preview = null;
const SND = 'text/x-vtt-sound';

function renderTimes() {
  const a = audio(); if (!a) return;
  for (const [ch] of CH) {
    const c = a.ch[ch], t = c.track && a.tracks.find(x => x.id === c.track), el = $(`#ab-${ch} .tm`), bar = $(`#ab-${ch} .prog i`);
    if (!el) continue;
    const pos = !t ? 0 : c.paused != null ? c.paused : (now() - c.started) / 1000;
    el.textContent = t ? `${fmt(pos)} / ${fmt(t.dur)}` : '';
    if (bar) bar.style.width = t && t.dur ? Math.min(100, pos / t.dur * 100) + '%' : '0';
  }
}
function slider(val, oninput, title) {
  return h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: val, title, oninput: e => oninput(+e.target.value) });
}
function guessKind(name, dur) {
  if (dur && dur < 12) return 'effects';
  return /rain|wind|forest|tavern|crowd|cave|sea|ocean|storm|fire|night|ambien|river|birds|market|dungeon/i.test(name) ? 'ambience' : 'music';
}
async function uploadSounds(files, list) {
  files = files.filter(f => /^audio\//.test(f.type) || /\.(mp3|ogg|wav|m4a|flac|webm)$/i.test(f.name));
  if (!files.length) return V.toast('Those aren’t sound files (MP3, OGG, WAV, M4A, FLAC)', true);
  let n = 0;
  for (const f of files) {
    if (files.length > 1) V.toast(`Adding ${f.name} (${++n} of ${files.length})…`);
    try {
      const dur = await new Promise(res => { const el = new Audio(); el.preload = 'metadata'; el.onloadedmetadata = () => res(el.duration || 0); el.onerror = () => res(0); el.src = URL.createObjectURL(f); });
      const url = await V.upload(f);
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      await send('add', { url, name, dur: isFinite(dur) ? dur : 0, kind: guessKind(name, dur), list: list || null });
    } catch (e) { V.toast(e.message, true); }
  }
}
function togglePreview(t) {
  if (preview) { preview.el.pause(); const same = preview.id === t.id; preview = null; render(); if (same) return; }
  const el = new Audio(t.url); el.volume = Math.min(1, local.master); el.play().catch(() => {});
  el.onended = () => { preview = null; render(); };
  preview = { id: t.id, el }; render();
}
// files or sounds dropped onto a folder (or the unsorted list)
function dropTarget(el, listId) {
  el.addEventListener('dragover', e => {
    const types = [...e.dataTransfer.types];
    if (types.includes('Files') || types.includes(SND)) { e.preventDefault(); el.classList.add('over'); }
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', e => {
    el.classList.remove('over');
    const sid = e.dataTransfer.getData(SND);
    if (sid) { e.preventDefault(); e.stopPropagation(); send('move', { id: sid, to: listId }); if (listId) { openF.add(listId); saveOpen(); } return; }
    if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); uploadSounds([...e.dataTransfer.files], listId); }
  });
  return el;
}

function render() {
  const box = $('#tab-audio'); if (!box || !state.camp) return;
  const a = audio(), gm = V.isGM();
  const mine = h('div', { class: 'aud-mine' },
    h('h3', null, 'Your volume'),
    ...[['master', 'Everything'], ...CH, ['table', 'Dice and chat']].map(([k, l]) => h('div', { class: 'arow' }, h('span', { class: 'albl' }, l), slider(local[k], v => { local[k] = v; saveLocal(); sync(); }))),
    blocked ? h('button', { class: 'btn primary', onclick: () => $('#joinAudio').click() }, '🔊 Join audio') : null);
  if (!gm || !a) { box.replaceChildren(mine, h('p', { class: 'muted small' }, 'The GM chooses the music. These sliders only change what you hear.')); return; }
  const tname = id => (a.tracks.find(t => t.id === id) || {}).name || '';
  const folderOf = id => a.playlists.find(l => l.tracks.includes(id));

  // now playing
  const deck = (ch, label) => {
    const c = a.ch[ch], playing = c.track && c.paused == null, l = c.list && a.playlists.find(x => x.id === c.list);
    if (ch === 'effects') return h('div', { class: 'astrip fx', id: 'ab-' + ch },
      h('div', { class: 'ahead' }, h('b', null, label), h('span', { class: 'muted small np' }, 'one-off sounds from the soundboard')),
      h('div', { class: 'arow' }, h('span', { class: 'volic', html: SVG.vol }), slider(c.vol, v => { clearTimeout(render['t' + ch]); render['t' + ch] = setTimeout(() => send('vol', { ch, vol: v }), 120); }, 'Effects volume for everyone')));
    return h('div', { class: 'astrip' + (playing ? ' live' : ''), id: 'ab-' + ch },
      h('div', { class: 'ahead' }, h('b', null, label),
        h('span', { class: 'np' }, c.track ? h('span', null, tname(c.track), l ? h('span', { class: 'muted' }, ' · ' + l.name) : null) : h('span', { class: 'muted' }, 'Nothing playing')),
        h('span', { class: 'tm muted small' })),
      h('div', { class: 'prog' }, h('i')),
      h('div', { class: 'arow' },
        icon(playing ? 'pause' : 'play', playing ? 'Pause for everyone' : c.track ? 'Carry on' : 'Pick a sound or folder below to play', () => c.track && send(playing ? 'pause' : 'resume', { ch }), c.track ? 'big' : 'big off'),
        icon('next', l ? 'Next in “' + l.name + '”' : 'Play it again from the start', () => c.track && send('next', { ch }), c.track ? '' : 'off'),
        icon('stop', 'Stop (fades out)', () => c.track && send('stop', { ch }), c.track ? '' : 'off'),
        // repeat: off → the folder → this one song → off (with no folder: off ↔ this song)
        icon(c.loop === 'one' ? 'loop1' : 'loop', c.loop === 'one' ? 'Repeating this song: click to stop repeating' : c.loop ? (l ? 'Repeating the folder: click to repeat just this song' : 'Repeating: click to play once') : (l ? 'Play the folder once: click to repeat it' : 'Play once: click to repeat'),
          () => send('loop', { ch, loop: c.loop === 'one' ? false : c.loop ? (l ? 'one' : false) : (l ? true : 'one') }), c.loop ? 'on' : ''),
        h('span', { class: 'volic', html: SVG.vol }),
        slider(c.vol, v => { clearTimeout(render['t' + ch]); render['t' + ch] = setTimeout(() => send('vol', { ch, vol: v }), 120); }, 'Volume for everyone')));
  };

  // a sound in the library
  const row = (t, l) => {
    const isFx = t.kind === 'effects', live = CH.some(([ch]) => a.ch[ch].track === t.id && a.ch[ch].paused == null);
    const play = () => isFx ? send('sfx', { id: t.id }) : send('play', { ch: t.kind, track: t.id, list: l ? l.id : undefined });
    const nameEl = renaming === t.id
      ? h('input', { type: 'text', value: t.name, class: 'grow', onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { renaming = null; render(); } },
          onblur: e => { renaming = null; if (e.target.value.trim() && e.target.value !== t.name) send('edit', { id: t.id, name: e.target.value.trim() }); else render(); } })
      : h('span', { class: 'grow tn', title: 'Double-click to rename', ondblclick: () => { renaming = t.id; render(); } }, t.name);
    const r = h('div', { class: 'srow' + (live ? ' live' : ''), draggable: 'true', ondragstart: e => { e.dataTransfer.setData(SND, t.id); e.dataTransfer.effectAllowed = 'move'; } },
      icon('play', isFx ? 'Play once for everyone' : `Play for everyone (${KIND[t.kind]})`, play, 'pl'),
      nameEl,
      l ? null : h('button', { class: 'kind k-' + t.kind, title: 'Which channel it plays on: click to change', onclick: () => send('edit', { id: t.id, kind: NEXT_KIND[t.kind] }) }, KIND[t.kind]),
      h('span', { class: 'muted small dur' }, fmt(t.dur)),
      icon('ear', preview && preview.id === t.id ? 'Stop listening' : 'Listen on your own (players don’t hear it)', () => togglePreview(t), preview && preview.id === t.id ? 'on' : ''),
      h('button', { class: 'x', title: 'Delete the sound', onclick: () => { if (confirm(`Delete “${t.name}”?`)) send('remove', { id: t.id }); } }, '×'));
    if (renaming === t.id) setTimeout(() => { const i = r.querySelector('input'); if (i) { i.focus(); i.select(); } });
    return r;
  };
  const match = t => !filter || t.name.toLowerCase().includes(filter.toLowerCase());

  // a folder
  const folder = l => {
    const open = openF.has(l.id) || !!filter, tracks = l.tracks.map(id => a.tracks.find(t => t.id === id)).filter(Boolean).filter(match);
    if (filter && !tracks.length) return null;
    const save = patch => send('list', { list: Object.assign({}, l, patch) });
    const live = CH.some(([ch]) => a.ch[ch].list === l.id && a.ch[ch].track && a.ch[ch].paused == null);
    const head = h('div', { class: 'fhead' },
      h('button', { class: 'tw', onclick: () => { open ? openF.delete(l.id) : openF.add(l.id); saveOpen(); render(); } }, open ? '▾' : '▸'),
      h('span', { class: 'fic', html: SVG.folder }),
      renaming === l.id
        ? h('input', { type: 'text', value: l.name, class: 'grow', onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { renaming = null; render(); } },
            onblur: e => { renaming = null; if (e.target.value.trim() && e.target.value !== l.name) save({ name: e.target.value.trim() }); else render(); } })
        : h('b', { class: 'grow fn', title: 'Double-click to rename', ondblclick: () => { renaming = l.id; render(); }, onclick: () => { open ? openF.delete(l.id) : openF.add(l.id); saveOpen(); render(); } }, l.name, h('span', { class: 'muted small' }, ` ${l.tracks.length}`)),
      h('button', { class: 'kind k-' + l.kind, title: 'Which channel the folder plays on: click to change', onclick: () => save({ kind: NEXT_KIND[l.kind] }) }, KIND[l.kind]),
      l.kind !== 'effects' ? icon('shuffle', l.shuffle ? 'Shuffled: click to play in order' : 'In order: click to shuffle', () => save({ shuffle: !l.shuffle }), l.shuffle ? 'on' : '') : null,
      l.kind !== 'effects' ? icon('play', `Play the folder on ${KIND[l.kind]}`, () => l.tracks.length && send('play', { ch: l.kind, list: l.id }), 'pl' + (live ? ' on' : '')) : null,
      h('button', { class: 'x', title: 'Delete the folder (its sounds go to Unsorted)', onclick: () => { if (confirm(`Delete the folder “${l.name}”? Its sounds stay, in Unsorted.`)) send('unlist', { id: l.id }); } }, '×'));
    if (renaming === l.id) setTimeout(() => { const i = head.querySelector('input'); if (i) { i.focus(); i.select(); } });
    const body = !open ? null : l.kind === 'effects'
      ? h('div', { class: 'aboard' }, ...tracks.map(t => h('button', { class: 'pad', draggable: 'true', title: 'Play once for everyone · drag to another folder',
          ondragstart: e => { e.dataTransfer.setData(SND, t.id); }, onclick: () => send('sfx', { id: t.id }), oncontextmenu: e => { e.preventDefault(); togglePreview(t); } }, t.name)),
          tracks.length ? null : h('p', { class: 'muted small empty' }, 'Drop sound files or sounds here.'))
      : h('div', { class: 'fbody' }, ...tracks.map(t => row(t, l)), tracks.length ? null : h('p', { class: 'muted small empty' }, 'Drop sound files or sounds here.'));
    return dropTarget(h('div', { class: 'folder' + (open ? ' open' : '') + (live ? ' live' : '') }, head, body), l.id);
  };

  const fileIn = h('input', { type: 'file', accept: 'audio/*,.mp3,.ogg,.wav,.m4a,.flac', multiple: true, hidden: true, onchange: e => uploadSounds([...e.target.files], null) });
  const unsorted = a.tracks.filter(t => !folderOf(t.id)).filter(match);
  box.replaceChildren(
    h('div', { class: 'asec' }, h('h3', null, 'Now playing'), deck('music', 'Music'), deck('ambience', 'Ambience'), deck('effects', 'Effects'),
      h('div', { class: 'arow small' }, h('span', { class: 'muted' }, 'Crossfade between sounds'), h('input', { type: 'number', min: 0, max: 20, step: 0.5, value: a.fade, style: 'width:56px', onchange: e => send('fade', { fade: +e.target.value }) }), h('span', { class: 'muted' }, 'sec'))),
    h('div', { class: 'asec' }, h('h3', null, 'Scenes'),
      a.presets.length ? h('div', { class: 'achips' }, ...a.presets.map(p => h('span', { class: 'achip' },
        h('button', { class: 'go', title: 'Play this mood', onclick: () => send('apply', { id: p.id }) }, '▶ ' + p.name),
        h('button', { class: 'x', title: 'Forget this scene', onclick: () => send('unpreset', { id: p.id }) }, '×')))) : h('p', { class: 'muted small' }, 'Save the music and ambience that are playing as a scene, like “Tavern at night”, to bring the mood back in one click.'),
      h('div', { class: 'arow' }, h('input', { type: 'text', placeholder: 'Name what’s playing…', value: presetName, oninput: e => { presetName = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') e.target.nextSibling.click(); }, style: 'flex:1' }),
        h('button', { class: 'btn sm', onclick: () => { if (!['music', 'ambience'].some(k => a.ch[k].track)) return V.toast('Play some music or ambience first', true); send('preset', { name: presetName || 'Scene ' + (a.presets.length + 1) }); presetName = ''; } }, 'Save scene'))),
    dropTarget(h('div', { class: 'asec lib' },
      h('div', { class: 'libhead' }, h('h3', null, 'Library'),
        h('button', { class: 'btn sm', onclick: () => send('list', { list: { name: 'New folder', kind: 'music', tracks: [] } }).then(() => { const ls = audio().playlists; const nl = ls[ls.length - 1]; if (nl) { openF.add(nl.id); saveOpen(); renaming = nl.id; render(); } }) }, '+ Folder'),
        h('button', { class: 'btn sm', onclick: () => fileIn.click() }, '+ Sounds'), fileIn),
      a.tracks.length > 6 ? h('input', { type: 'search', class: 'afilter', placeholder: 'Find a sound…', value: filter, oninput: e => { filter = e.target.value; render(); setTimeout(() => { const i = $('#tab-audio .afilter'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); } }) : null,
      ...a.playlists.map(folder).filter(Boolean),
      h('div', { class: 'folder unsorted open' },
        h('div', { class: 'fhead' }, h('b', { class: 'grow fn' }, a.playlists.length ? 'Unsorted' : 'Sounds', h('span', { class: 'muted small' }, ` ${unsorted.length}`))),
        h('div', { class: 'fbody' }, ...unsorted.map(t => row(t, null)))),
      h('div', { class: 'adrop', onclick: () => fileIn.click() }, a.tracks.length ? 'Drop more sound files here, or onto a folder' : 'Drop sound files here (MP3, OGG, WAV, M4A, FLAC), or click to choose them'),
      h('p', { class: 'muted small' }, 'Drag sounds between folders. A folder plays on its channel; an Effects folder is a soundboard. Double-click a name to rename it. 🎧 listens on your own. The library is shared by all your campaigns.')), null),
    mine);
  renderTimes();
}
// don't redraw under someone typing a name or dragging a slider; catch up when they let go
let holding = false;
$('#tab-audio').addEventListener('pointerdown', e => { if (e.target.type === 'range') holding = true; });
document.addEventListener('pointerup', () => { if (holding) { holding = false; setTimeout(render, 250); } });
on('meta', () => { const ae = document.activeElement; if (holding || (ae && ae.closest && ae.closest('#tab-audio') && ae.tagName === 'INPUT' && ae.type !== 'range')) return; render(); });
on('me', render);
// ───────── the table's own little sounds: dice rattling when someone rolls, a soft note when someone else writes ─────────
// Made on the spot (nothing to download), at your own volume (Your volume › Dice and chat).
(function () {
  let ac = null;
  const ctx = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } };
  let noise = null;
  const noiseBuf = a => { if (noise) return noise; const b = a.createBuffer(1, a.sampleRate * 0.25, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return (noise = b); };
  function dice(vol) {
    const a = ctx(); if (!a) return;
    const out = a.createGain(); out.gain.value = vol; out.connect(a.destination);
    let t = a.currentTime + 0.01, gap = 0.035;
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const src = a.createBufferSource(); src.buffer = noiseBuf(a);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 2600; bp.Q.value = 3 + Math.random() * 4;
      const g = a.createGain(), peak = (i === 0 ? 0.9 : 0.75) * Math.pow(0.86, i);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
      src.connect(bp); bp.connect(g); g.connect(out); src.start(t, Math.random() * 0.2); src.stop(t + 0.08);
      // the wooden knock under the click
      if (i % 2 === 0) { const o = a.createOscillator(), og = a.createGain(); o.frequency.value = 180 + Math.random() * 140; og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.25 * Math.pow(0.8, i), t + 0.003); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.06); }
      t += gap * (0.7 + Math.random() * 0.6); gap *= 1.22;
    }
  }
  function note(vol) {
    const a = ctx(); if (!a) return;
    const T = a.currentTime, g = a.createGain(); g.connect(a.destination);
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.12 * vol, T + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.45);
    [[988, 0], [1318.5, 0.07]].forEach(([f, d]) => { const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(T + d); o.stop(T + 0.5); });
  }
  let last = 0;
  V.on('chat', m => {
    if (!m || m.reset || !Array.isArray(m.msgs) || !m.msgs.length) return;
    const vol = (local.table == null ? 0.7 : local.table) * (local.master == null ? 0.8 : local.master);
    if (vol <= 0.001) return;
    const now = Date.now(); if (now - last < 120) return; last = now;
    const me = V.state.me && V.state.me.id;
    const rolled = m.msgs.some(x => x.kind === 'roll' || x.kind === 'r20' || x.roll);
    if (rolled) dice(vol);
    else if (m.msgs.some(x => x.uid !== me && x.kind !== 'system')) note(vol);
  });
})();

})();
