/* Bring in a D&D Beyond character (anyone: players bring their own). Paste the character's link: the table's own
 * computer asks D&D Beyond for it (the character must be set to Public there). If it isn't, or D&D Beyond won't
 * answer, open the link this shows, save what the page says as a .json file, and pick that file instead. */
'use strict';
(function () {
const { $, h, state } = V;
V.openDDBImport = function () {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const sheets = Object.entries(state.camp.sheets || {}).filter(([k]) => /^dnd5e/.test(k));
  const links = h('textarea', { rows: 3, placeholder: 'https://www.dndbeyond.com/characters/12345678\n(one per line)', style: 'width:100%' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.json,application/json', style: 'width:100%' });
  const sheetSel = h('select', { style: 'width:100%' }, ...sheets.map(([k, v]) => h('option', { value: k }, v.name)));
  const out = h('div', { class: 'small', style: 'margin-top:10px' });
  const raw = h('div', { class: 'muted small' });
  links.oninput = () => {
    const ids = links.value.split(/\s+/).map(x => (/(?:characters\/|^)(\d{4,12})(?:\/|$|\?)/.exec(x.trim()) || [])[1]).filter(Boolean);
    raw.replaceChildren(...(ids.length ? ['If it won’t come: open ', ...ids.flatMap((id, i) => [i ? ', ' : '', h('a', { href: `https://character-service.dndbeyond.com/character/v5/character/${id}`, target: '_blank', rel: 'noopener' }, 'this')]), ' (signed in to D&D Beyond), save the page as a .json file, and pick it below.'] : []));
  };
  const go = h('button', { class: 'btn primary', onclick: run }, 'Bring in');
  async function run() {
    const ls = links.value.split(/\s+/).map(x => x.trim()).filter(Boolean), files = [...fileIn.files];
    if (!ls.length && !files.length) { out.textContent = 'Paste a link or pick a file first.'; return; }
    go.disabled = true; out.textContent = 'Asking D&D Beyond…';
    try {
      const json = [];
      for (const f of files) { try { json.push(JSON.parse(await f.text())); } catch (e) { throw new Error(`${f.name} isn't readable JSON`); } }
      const r = await V.api(`/api/campaigns/${state.camp.id}/ddb`, { method: 'POST', body: { links: ls, json, sheet: sheetSel.value } });
      out.replaceChildren(
        r.characters.length ? h('p', null, `Brought in ${r.characters.join(', ')}. ` + 'They’re in the Journal; check the armour class and anything magic, which D&D Beyond works out in ways it doesn’t fully share.') : null,
        r.errors.length ? h('ul', { class: 'err', style: 'margin:4px 0 0 1.1em;padding:0' }, ...r.errors.map(e => h('li', null, e))) : null);
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
    go.disabled = false;
  }
  modal.replaceChildren(h('div', { class: 'dialog', style: 'width:min(560px,100%)' },
    h('div', { class: 'dh' }, h('h2', null, 'Bring in from D&D Beyond'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('p', { class: 'muted small' }, 'Paste a character’s link from D&D Beyond. Its privacy must be Public (on D&D Beyond: the character > Manage > Character Settings > Character Privacy). It comes over with its ability scores, saves and skills, hit points, armour class, weapons, spells, inventory, and its class features, racial traits and feats with their text.'),
      h('label', null, 'Links'), links, raw,
      h('label', null, 'Or the saved .json files'), fileIn,
      sheets.length > 1 ? [h('label', null, 'Sheet'), sheetSel] : null,
      out),
    h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Close'), go)));
  modal.hidden = false;
  setTimeout(() => links.focus(), 30);
};
})();
