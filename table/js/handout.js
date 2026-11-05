/* A handout page: /table/handout.html?c=<campaign>&h=<handout>[&embed=1]
 * Everyone who may see it reads it here; the GM can also edit it (name, picture, text in Markdown, GM notes, who sees it). */
'use strict';
(function () {
  const { $, h, state } = V;
  const p = new URLSearchParams(location.search);
  const cid = p.get('c'), hid = p.get('h'), embed = p.has('embed');
  document.body.classList.toggle('embed', embed);
  let editing = false, draft = null, saveTimer = 0;

  // Markdown to safe HTML: the text is the GM's, but nothing in it should run.
  function md(text) {
    const t = document.createElement('template');
    t.innerHTML = window.marked ? marked.parse(String(text || ''), { breaks: true }) : h('div', null, text).innerHTML;
    for (const x of t.content.querySelectorAll('script, iframe, object, embed, style, link, meta, form')) x.remove();
    for (const x of t.content.querySelectorAll('*')) for (const a of [...x.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*(javascript|data):/i.test(a.value) && !/^data:image\//i.test(a.value))) x.removeAttribute(a.name);
    }
    for (const a of t.content.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener'; }
    return t.content;
  }
  const handout = () => (state.camp && state.camp.handouts || []).find(x => x.id === hid);
  const save = patch => V.send({ t: 'op', op: { t: 'handout.update', id: hid, patch } }).catch(e => V.toast(e.message, true));
  const saveSoon = patch => { Object.assign(draft, patch); clearTimeout(saveTimer); saveTimer = setTimeout(() => save(patch), 700); };

  function render() {
    const ho = handout(), page = $('#page');
    if (!ho) { page.replaceChildren(h('p', { class: 'empty' }, state.camp ? 'This handout is gone, or it isn’t shared with you.' : 'Loading…')); return; }
    document.title = ho.name + ' · Handout';
    $('#title').textContent = ho.name;
    const gm = V.isGM();
    $('#editBtn').hidden = !gm;
    $('#editBtn').textContent = editing ? 'Done' : 'Edit';
    if (gm) {
      const names = (ho.viewers || []).map(V.member).filter(Boolean).map(u => u.name);
      $('#who').textContent = ho.shared ? 'Everyone can see this' : names.length ? 'Seen by ' + names.join(', ') : 'Only you can see this';
    }
    if (editing && gm) return renderEdit(ho);
    page.replaceChildren(
      h('h1', { class: 'name' }, ho.name),
      ho.img ? h('img', { class: 'pic', src: ho.img, alt: '', title: 'Open the full picture', onclick: () => window.open(ho.img, '_blank', 'noopener') }) : null,
      ho.text ? h('div', { class: 'text' }, md(ho.text)) : (!ho.img ? h('p', { class: 'empty' }, gm ? 'Empty so far. Press Edit to write it.' : 'Nothing written here yet.') : null),
      gm && ho.gmNotes ? h('div', { class: 'gmnotes' }, h('div', { class: 'lbl' }, 'GM notes · only you see these'), h('div', { class: 'text' }, md(ho.gmNotes))) : null,
      gm && embed ? h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { editing = true; render(); } }, 'Edit'),
        h('button', { class: 'btn', onclick: show }, 'Show to everyone now')) : null);
  }

  function renderEdit(ho) {
    if (!draft) draft = { name: ho.name, text: ho.text || '', gmNotes: ho.gmNotes || '' };
    const players = (state.camp.members || []).filter(m => m.role !== 'gm');
    const preview = h('div', { class: 'preview text' }, md(draft.text));
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const url = await V.upload(f); await save({ img: url }); } catch (err) { V.toast(err.message, true); }
    } });
    $('#page').replaceChildren(h('div', { class: 'edit' },
      h('label', null, 'Name'),
      h('input', { type: 'text', value: draft.name, oninput: e => saveSoon({ name: e.target.value }) }),
      h('label', null, 'Picture'),
      h('div', { class: 'row' }, h('div', { class: 'thumb', style: ho.img ? `background-image:url("${ho.img}")` : '' }), fileIn,
        h('button', { class: 'btn sm', onclick: () => fileIn.click() }, ho.img ? 'Change' : 'Add a picture'),
        ho.img ? h('button', { class: 'btn sm', onclick: () => save({ img: null }) }, 'Remove') : null),
      h('label', null, 'Text'),
      h('div', { class: 'cols' },
        h('textarea', { oninput: e => { saveSoon({ text: e.target.value }); preview.replaceChildren(md(e.target.value)); } }, draft.text),
        preview),
      h('div', { class: 'hint' }, 'Markdown: **bold**, *italic*, # heading, > quote, - list. The preview on the right is what players see.'),
      h('label', null, 'GM notes (players never see these)'),
      h('textarea', { class: 'notes', oninput: e => saveSoon({ gmNotes: e.target.value }) }, draft.gmNotes),
      h('label', null, 'Who can see it'),
      h('div', null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ho.shared, onchange: e => save({ shared: e.target.checked }) }), 'Everyone'),
        ...players.map(u => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ho.shared || (ho.viewers || []).includes(u.id), disabled: ho.shared || null,
          onchange: e => { const v = new Set(ho.viewers || []); e.target.checked ? v.add(u.id) : v.delete(u.id); save({ viewers: [...v] }); } }), u.name))),
      h('div', { class: 'foot' },
        h('button', { class: 'btn primary', onclick: () => { flush(); editing = false; draft = null; render(); } }, 'Done'),
        h('button', { class: 'btn', onclick: show }, 'Show to everyone now'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', onclick: () => { if (confirm(`Delete “${ho.name}”? Ctrl+Z on the table brings it back.`)) V.send({ t: 'op', op: { t: 'handout.delete', id: hid } }); } }, 'Delete'))));
  }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; const d = {}; const ho = handout(); if (ho) for (const k of ['name', 'text', 'gmNotes']) if (draft && draft[k] !== ho[k]) d[k] = draft[k]; if (Object.keys(d).length) save(d); } }
  function show() { flush(); V.send({ t: 'showHandout', id: hid }).then(() => V.toast('Shown to everyone'), e => V.toast(e.message, true)); }

  $('#editBtn').onclick = () => { if (editing) { flush(); draft = null; } editing = !editing; render(); };
  V.on('conn', ok => $('#conn').classList.toggle('bad', !ok));
  // re-draw on changes, but never under the GM's typing (their own edits come back as the same text)
  V.on('meta', () => { if (!(editing && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(); else { const ho = handout(); if (!ho) render(); } });
  V.on('me', render);
  window.addEventListener('beforeunload', flush);
  if (!cid || !hid) { $('#page').textContent = 'No handout chosen.'; return; }
  V.connect(cid, null, { lite: true });
})();
