/* Import from Roll20 (GM): characters (their sheet attributes come straight over: the table runs the same Roll20
 * sheets), handouts, and pages with their map, grid, walls, doors and tokens. Roll20 has no export of its own, so
 * this takes what VTT Enhancement Suite (a character's .json) or R20Exporter (a campaign's campaign.json) writes.
 * The pictures are fetched from Roll20 by the server, on the computer the table runs on. */
'use strict';
(function () {
const { $, h, state } = V;
const R20 = { kind(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.attribs) || Array.isArray(d.attributes)) return 'character';
  if (Array.isArray(d.graphics) || Array.isArray(d.paths) || (d.width != null && d.height != null && d.scale_number != null)) return 'page';
  if (('notes' in d || 'blobNotes' in d) && d.name != null) return 'handout';
  return null;
} };
async function readDocs(files) {
  const docs = [];
  for (const f of files) {
    let j; try { j = JSON.parse(await f.text()); } catch (e) { throw new Error(`${f.name} isn't readable JSON`); }
    const add = x => {
      if (Array.isArray(x)) return x.forEach(add);
      if (!x || typeof x !== 'object') return;
      if (R20.kind(x)) docs.push(x);
      for (const k of ['characters', 'handouts', 'pages', 'journal']) if (Array.isArray(x[k])) x[k].forEach(add);
      if (x.campaign && typeof x.campaign === 'object') add(x.campaign);
    };
    add(j);
  }
  return docs;
}
V.openRoll20Import = function () {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const sheets = Object.entries(state.camp.sheets || {}).filter(([k]) => /^dnd5e/.test(k));
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.json', style: 'width:100%' });
  const sheetSel = h('select', { style: 'width:100%' }, h('option', { value: 'auto' }, 'Whichever sheet the attributes come from'), ...sheets.map(([k, v]) => h('option', { value: k }, v.name)));
  const out = h('div', { class: 'small', style: 'margin-top:10px' });
  const go = h('button', { class: 'btn primary', onclick: run }, 'Import');
  const count = h('div', { class: 'muted small' });
  fileIn.onchange = async () => {
    try {
      const docs = await readDocs([...fileIn.files]);
      const n = k => docs.filter(d => R20.kind(d) === k).length;
      count.textContent = docs.length ? `In these: ${n('character')} character(s), ${n('handout')} handout(s), ${n('page')} page(s).` : 'Nothing from Roll20 in these files.';
    } catch (e) { count.textContent = e.message; }
  };
  async function run() {
    const files = [...fileIn.files];
    if (!files.length) { out.textContent = 'Pick the files first.'; return; }
    go.disabled = true; out.textContent = 'Reading…';
    try {
      const docs = await readDocs(files);
      if (!docs.length) throw new Error('Nothing from Roll20 in these files.');
      out.textContent = 'Importing (and fetching the pictures from Roll20: a big campaign takes a minute)…';
      const r = await V.api(`/api/campaigns/${state.camp.id}/roll20`, { method: 'POST', body: { docs, sheet: sheetSel.value } });
      const bits = [[r.characters, 'character'], [r.handouts, 'handout'], [r.scenes, 'scene']].filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`);
      out.replaceChildren(
        h('p', null, `Imported ${bits.join(', ') || 'nothing'}.` + ' Ctrl+Z on the table undoes the lot.'),
        r.missing.length ? h('div', null, h('p', { class: 'err' }, `${r.missing.length} picture${r.missing.length === 1 ? '' : 's'} couldn’t be fetched; they still point at Roll20 (or are left blank). Set them by hand if they go missing:`),
          h('ul', { style: 'max-height:140px;overflow:auto;margin:4px 0;word-break:break-all' }, ...r.missing.map(m => h('li', null, m)))) : null);
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
    go.disabled = false;
  }
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(580px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Import from Roll20'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('p', { class: 'muted small' }, 'Roll20 has no export button of its own, so use one of these, then pick what they save here (several files at once is fine):'),
      h('ul', { class: 'muted small', style: 'margin:0 0 8px 1.1em;padding:0' },
        h('li', null, h('b', null, 'VTT Enhancement Suite'), ' (a browser extension): open a character in Roll20, then Export in its journal menu. One .json per character: its whole sheet comes over.'),
        h('li', null, h('b', null, 'R20Exporter'), ' (a browser extension): exports the whole campaign as a .zip. Unzip it and pick campaign.json: characters, handouts, and the pages with their maps, grid, walls, doors and tokens.')),
      h('label', null, 'Files'), fileIn, count,
      sheets.length ? [h('label', null, 'Sheet for characters'), sheetSel] : null,
      h('p', { class: 'muted small' }, 'Characters keep their attributes as they were on Roll20 (the table runs the same sheets); a bio becomes a handout beside them. Pictures are fetched from Roll20 into this campaign.'),
      out),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Close'), go)));
  modal.hidden = false;
};
})();
