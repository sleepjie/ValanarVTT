/* Import from Foundry VTT (GM): scenes with their walls, doors, lights and tokens, and D&D 5e actors as characters.
 * In Foundry, right-click a scene or actor in its sidebar > Export Data, and pick the .json files here
 * (an older world's scenes.db and actors.db work too). Pictures are copied from Foundry's data folder on this PC;
 * any it can't find can be picked here alongside the files. */
'use strict';
(function () {
const { $, h, state } = V;

async function readDocs(files) {
  const docs = [];
  for (const f of files) {
    const text = await f.text();
    if (/\.db$/i.test(f.name)) { for (const line of text.split('\n')) { const l = line.trim(); if (l) try { docs.push(JSON.parse(l)); } catch (e) { /* not a document */ } } continue; }
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error(`${f.name} isn't readable JSON`); }
    const add = x => { if (Array.isArray(x)) x.forEach(add); else if (x && typeof x === 'object') { docs.push(x); for (const k of ['scenes', 'actors']) if (Array.isArray(x[k])) x[k].forEach(add); } };
    add(j);
  }
  return docs;
}
V.openFoundryImport = async function () {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  let info = { foundryData: '', found: [] };
  try { info = await V.api('/api/foundry'); } catch (e) { /* fine */ }
  const sheets = Object.entries(state.camp.sheets || {}).filter(([k]) => /^dnd5e/.test(k));
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.json,.db,image/*', style: 'width:100%' });
  const dataIn = h('input', { type: 'text', value: info.foundryData, placeholder: info.found[0] || 'e.g. C:\\Users\\you\\AppData\\Local\\FoundryVTT\\Data', style: 'width:100%' });
  const sheetSel = h('select', { style: 'width:100%' }, ...sheets.map(([k, v]) => h('option', { value: k }, v.name)));
  const out = h('div', { class: 'small', style: 'margin-top:10px' });
  const go = h('button', { class: 'btn primary', onclick: run }, 'Import');
  async function run() {
    const files = [...fileIn.files];
    if (!files.length) { out.textContent = 'Pick the files first.'; return; }
    go.disabled = true; out.textContent = 'Reading…';
    try {
      const docs = await readDocs(files.filter(f => /\.(json|db)$/i.test(f.name)));
      const images = {};
      const pics = files.filter(f => /^image\//.test(f.type));
      for (const [i, f] of pics.entries()) { out.textContent = `Uploading pictures ${i + 1}/${pics.length}…`; const url = await V.upload(f); images[f.name] = url; images[f.name.toLowerCase()] = url; }
      out.textContent = 'Importing…';
      const r = await V.api(`/api/campaigns/${state.camp.id}/foundry`, { method: 'POST', body: { docs, images, sheet: sheetSel.value, foundryData: dataIn.value } });
      out.replaceChildren(
        h('p', null, `Imported ${r.scenes} scene${r.scenes === 1 ? '' : 's'} and ${r.characters} character${r.characters === 1 ? '' : 's'}.` + (r.skipped ? ` ${r.skipped} other thing${r.skipped === 1 ? ' was' : 's were'} left out.` : '') + ' Ctrl+Z on the table undoes the lot.'),
        r.missing.length ? h('div', null, h('p', { class: 'err' }, `${r.missing.length} picture${r.missing.length === 1 ? '' : 's'} weren’t found in Foundry’s data folder. Pick them above with the files and import again, or set them by hand:`),
          h('ul', { style: 'max-height:140px;overflow:auto;margin:4px 0' }, ...r.missing.map(m => h('li', null, m)))) : null);
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
    go.disabled = false;
  }
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(560px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Import from Foundry'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('p', { class: 'muted small' }, 'In Foundry, right-click a scene or an actor in the sidebar and choose Export Data. Pick those .json files here (you can pick several at once). Scenes come with their map, grid, walls, doors, lights and tokens; D&D 5e actors become characters, and tokens of imported actors are linked to them.'),
      h('label', null, 'Files'), fileIn,
      h('label', null, 'Foundry’s data folder (to copy the pictures from)'), dataIn,
      info.found.length ? h('div', { class: 'muted small' }, 'Found: ' + info.found.join(', ')) : h('div', { class: 'muted small' }, 'Not found automatically. In Foundry: Settings > Configure > User Data Path, plus \\Data.'),
      sheets.length ? [h('label', null, 'Sheet for characters'), sheetSel] : null,
      out),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Close'), go)));
  modal.hidden = false;
};
})();
