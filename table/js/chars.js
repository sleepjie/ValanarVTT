/* Characters: the journal tab, sheet panels (and pop-outs), token links, and sheet rolls in the chat. */
'use strict';
(function () {
const { $, h, state, on } = V;

// ───────────────────────── roll templates in the chat ─────────────────────────
//
// A sheet's roll template is drawn inside its own shadow root with the sheet's CSS, so the sheet's styles
// can't leak into the table and the table's can't spoil the template.

const sheetCache = new Map();   // sheet id -> Promise<{ templates: Map, css: CSSStyleSheet }>
const BASE_CSS = new CSSStyleSheet();
BASE_CSS.replaceSync(`
  :host { display: block; }
  .wrap { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: #333; }
  .inlinerollresult { display: inline-block; min-width: 1.4em; text-align: center; padding: 0 3px; font-weight: bold; cursor: help;
    background: #fef68e; color: #000; border: 2px solid #fef68e; border-radius: 3px; }
  .inlinerollresult.fullcrit { border-color: #3fb315; }
  .inlinerollresult.fullfail { border-color: #b31515; }
  .inlinerollresult.importantroll { border-color: #4a57ed; }
  .plain { color: #e8e2d0; padding: 2px 2px; white-space: pre-wrap; }
  .sheet-pictos, .sheet-pictos-three, .sheet-pictos-custom, .sheet-d6-font, .sheet-d20-font { display: none !important; }
  table.sheet-rolltemplate-default { width: 100%; border-collapse: collapse; background: #fff; color: #333; border: 1px solid #999; }
  table.sheet-rolltemplate-default caption { background: #5c5c5c; color: #fff; font-weight: bold; padding: 4px; caption-side: top; }
  table.sheet-rolltemplate-default td { padding: 3px 6px; border-top: 1px solid #ddd; vertical-align: top; }
  table.sheet-rolltemplate-default td:first-child { font-weight: bold; width: 40%; }
`);
const DEFAULT_TEMPLATE = '<table class="sheet-rolltemplate-default"><caption>{{name}}</caption>{{#allprops() name}}<tr><td>{{key}}</td><td>{{value}}</td></tr>{{/allprops() name}}</table>';
function loadSheet(id) {
  if (!sheetCache.has(id)) sheetCache.set(id, (async () => {
    const [tpl, css] = await Promise.all([
      fetch(`/table/sheets/${id}/templates.html`).then(r => r.ok ? r.text() : ''),
      fetch(`/table/sheets/${id}/sheet.css`).then(r => r.ok ? r.text() : '')]);
    const templates = new Map();
    tpl.replace(/<rolltemplate\s+class="sheet-rolltemplate-([^"]+)"\s*>([\s\S]*?)<\/rolltemplate>/gi, (m, name, body) => { templates.set(name, body); return m; });
    const sheet = new CSSStyleSheet();
    try { sheet.replaceSync(css); } catch (e) { /* a broken rule shouldn't stop the template */ }
    return { templates, css: sheet };
  })());
  return sheetCache.get(id);
}
V.r20MsgEl = function (m) {
  const priv = m.gmOnly;
  const body = h('div', { class: 'r20body' });
  const shadow = body.attachShadow({ mode: 'open' });
  const el = h('div', { class: 'msg r20' + (priv ? ' private' : ''), style: `--c:${m.color || '#c9a45c'}` },
    h('div', { class: 'who' }, m.from, priv ? h('span', { class: 'tag' }, 'GM only') : null), body);
  const draw = (pack) => {
    shadow.adoptedStyleSheets = pack ? [BASE_CSS, pack.css] : [BASE_CSS];
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    if (m.template) {
      const tpl = (pack && pack.templates.get(m.template)) || DEFAULT_TEMPLATE;
      const holder = document.createElement('div');
      holder.className = 'sheet-rolltemplate-' + m.template + (pack && pack.templates.has(m.template) ? '' : ' sheet-rolltemplate-default');
      holder.innerHTML = R20.renderTemplate(tpl, m.props || [], m.rolls || []);
      wrap.append(holder);
    } else {
      const p = document.createElement('div');
      p.className = 'plain';
      p.innerHTML = (m.emote ? '<i>' : '') + R20.valueHTML(m.text || '', m.rolls || []) + (m.emote ? '</i>' : '');
      wrap.append(p);
    }
    shadow.replaceChildren(wrap);
  };
  draw(null);
  if (m.sheet) loadSheet(m.sheet).then(draw, () => {});
  shadow.addEventListener('click', e => {   // [Longsword](~attack_dmg): roll that button of the same character
    const a = e.target.closest && e.target.closest('[data-ab]'); if (!a) return;
    e.preventDefault();
    if (m.char) V.runSheetButton(m.char, a.dataset.ab);
  });
  return el;
};

// ───────────────────────── the Characters tab ─────────────────────────

let folderOpen = {};
try { folderOpen = JSON.parse(localStorage.getItem('vtt-char-folders') || '{}'); } catch (e) { folderOpen = {}; }
function bagIcon() { return V.icon ? V.icon('bag') : '🎒'; }
function saveFolderOpen() { try { localStorage.setItem('vtt-char-folders', JSON.stringify(folderOpen)); } catch (e) { /* not kept */ } }
const DRAG_TYPE = 'text/x-vtt-char', HO_TYPE = 'text/x-vtt-handout';
// who plays a character: everyone in the campaign, the GMs marked; ticking one gives it to them
const everyone = () => (state.camp.members || []).slice().sort((a, b) => (b.role === 'gm') - (a.role === 'gm') || a.name.localeCompare(b.name));
const setOwners = (ch, owners) => V.op({ t: 'char.update', id: ch.id, patch: { owners } });
function ownerPicker(ch, after) {
  const me = state.me && state.me.id;
  return h('div', { class: 'ownlist' }, ...everyone().map(u => h('label', { class: 'ownopt' + ((ch.owners || []).includes(u.id) ? ' on' : ''), style: `--c:${u.color || '#8a8f98'}` },
    h('input', { type: 'checkbox', checked: (ch.owners || []).includes(u.id), onchange: e => {
      const o = new Set(ch.owners || []); e.target.checked ? o.add(u.id) : o.delete(u.id); ch.owners = [...o];
      setOwners(ch, ch.owners).then(() => after && after());
    } }),
    h('span', { class: 'odot' }, V.initials(u.name)), h('span', null, u.name + (u.id === me ? ' (you)' : '')), u.role === 'gm' ? h('span', { class: 'muted small' }, 'GM') : null)));
}
let ownPop = null;
function closeOwnPop() { if (ownPop) { ownPop.remove(); ownPop = null; } }
document.addEventListener('pointerdown', e => { if (ownPop && !ownPop.contains(e.target) && !e.target.closest('.ownchip')) closeOwnPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOwnPop(); });
function playedBy(ch) {
  const os = (ch.owners || []).map(V.member).filter(Boolean);
  // whoever else owns it plays it; mine alone is "Yours"; nobody's is "Unowned"
  const me = state.me && state.me.id, players = os.filter(u => u.id !== me);
  const label = !os.length ? 'Unowned' : players.length ? 'Played by ' + players.map(u => u.name).join(', ') : 'Yours';
  return h('button', { class: 'ownchip' + (players.length ? ' has' : ''), title: 'Who plays this character: click to choose', onclick: e => {
    e.stopPropagation();
    if (ownPop && ownPop._cid === ch.id) return closeOwnPop();
    closeOwnPop();
    const r = e.currentTarget.getBoundingClientRect();
    ownPop = h('div', { class: 'ownpop' }, h('div', { class: 'small muted', style: 'margin-bottom:4px' }, `Who plays ${ch.name}?`), ownerPicker(ch),
      ch.shared ? null : h('label', { class: 'inline small', style: 'margin-top:6px' }, h('input', { type: 'checkbox', onchange: e2 => V.op({ t: 'char.update', id: ch.id, patch: { shared: e2.target.checked } }) }), 'Everyone can view the sheet'));
    ownPop._cid = ch.id;
    ownPop.style.left = Math.min(r.left, innerWidth - 250) + 'px'; ownPop.style.top = (r.bottom + 4) + 'px';
    document.body.append(ownPop);
  } },
    ...os.slice(0, 4).map(u => h('span', { class: 'odot', style: `--c:${u.color || '#8a8f98'}` }, V.initials(u.name))),
    h('span', { class: 'olab' }, label), ch.shared ? h('span', { class: 'muted' }, ' · everyone can view') : null);
}
// ───── your characters in your other campaigns: a folder at the bottom, a sub-folder each ─────
let elsewhere = null, elseFor = null, elseBusy = false;
function loadElsewhere(force) {
  const cid = state.camp && state.camp.id; if (!cid || V.isGuest() || elseBusy) return;
  if (!force && elseFor === cid) return;
  elseBusy = true; elseFor = cid;
  V.send({ t: 'elsewhere' }).then(r => { elsewhere = r.campaigns || []; }).catch(() => { elsewhere = []; }).finally(() => { elseBusy = false; renderChars(); });
}
function otherCampaigns() {
  loadElsewhere();
  if (!elsewhere || !elsewhere.length) return null;
  const n = elsewhere.reduce((s, c) => s + c.chars.length, 0), open = !!folderOpen['oc'];
  const sub = oc => {
    const k = 'oc:' + oc.id, o = !!folderOpen[k];
    return h('div', { class: 'cfold sub' + (o ? ' open' : '') },
      h('div', { class: 'cfh' }, h('button', { class: 'nm', onclick: () => { folderOpen[k] = !o; saveFolderOpen(); renderChars(); } },
        h('span', { class: 'tw' }, o ? '▾' : '▸'), h('span', { class: 'fi' }, '📁'), h('b', null, oc.name), h('span', { class: 'muted small' }, ` ${oc.chars.length}`))),
      o ? h('div', { class: 'cfb' }, ...oc.chars.map(ch => h('div', { class: 'crow2 elsewhere' },
        h('span', { class: 'av', style: ch.avatar ? `background-image:url("${ch.avatar}")` : '' }, ch.avatar ? '' : V.initials(ch.name)),
        h('div', { class: 'nmwrap' }, h('button', { class: 'nm', title: `Open the sheet (in ${oc.name})`, onclick: () => framePanel('x:' + ch.id, `/table/sheet.html?c=${oc.id}&ch=${ch.id}&embed=1`, `${ch.name} · ${oc.name}`, { night: true }) }, h('b', null, ch.name)),
          h('span', { class: 'muted small' }, 'in ' + oc.name)),
        h('button', { class: 'btn sm', title: `A copy of ${ch.name} in this campaign (the one in ${oc.name} stays as it is)`, onclick: async e => {
          e.currentTarget.disabled = true;
          const r = await V.op({ t: 'char.copy', from: oc.id, id: ch.id }).catch(() => null);
          if (r) V.toast(`${ch.name} copied into this campaign`);
        } }, 'Copy here')))) : null);
  };
  return h('div', { class: 'cfold elsefold' + (open ? ' open' : '') },
    h('div', { class: 'cfh' },
      h('button', { class: 'nm', onclick: () => { folderOpen['oc'] = !open; saveFolderOpen(); renderChars(); } },
        h('span', { class: 'tw' }, open ? '▾' : '▸'), h('span', { class: 'fi' }, '🗂'), h('b', null, 'Other Campaigns'), h('span', { class: 'muted small' }, ` ${n}`)),
      h('button', { class: 'btn sm', title: 'Look again', onclick: () => loadElsewhere(true) }, '↻')),
    open ? h('div', { class: 'cfb' }, ...elsewhere.map(sub)) : null);
}
function renderChars() {
  const box = $('#tab-chars'), c = state.camp;
  if (!c) return;
  const gm = V.isGM();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const list = (c.characters || []).slice().sort(byName);
  const hos = (c.handouts || []).slice().sort(byName);
  const folders = c.charFolders || [];
  const sheets = Object.entries(c.sheets || {});
  const defSheet = (sheets.find(([, v]) => v.mode === c.mode) || sheets[0] || ['dnd5e'])[0];
  const ownerNames = ch => ch.owners.map(V.member).filter(u => u && u.role !== 'gm').map(u => u.name).join(', ');
  const bagIcon2 = ch => (ch.items || []).length ? h('button', { class: 'btn sm bagbtn', title: 'Inventory: their item cards', onclick: () => V.openInventory(ch.id) }, bagIcon(), h('span', null, (ch.items || []).reduce((s, e) => s + e.qty, 0))) : null;
  const row = ch => (V.itemDropTarget ? V.itemDropTarget : x => x)(h('div', { class: 'crow2', draggable: gm ? 'true' : null,
      title: gm ? 'Drag onto the map for a token, or onto a folder' : null,
      ondragstart: e => { e.dataTransfer.setData(DRAG_TYPE, ch.id); e.dataTransfer.setData('text/plain', ch.name); e.dataTransfer.effectAllowed = 'copyMove'; } },
    h('span', { class: 'av', style: ch.avatar ? `background-image:url("${ch.avatar}")` : '' }, ch.avatar ? '' : V.initials(ch.name)),
    h('div', { class: 'nmwrap' },
      h('button', { class: 'nm', title: 'Open the sheet', onclick: () => V.openSheet(ch.id) }, h('b', null, ch.name)),
      gm ? playedBy(ch) : h('span', { class: 'muted small' }, [ownerNames(ch) ? 'played by ' + ownerNames(ch) : '', ch.shared ? 'everyone can view' : ''].filter(Boolean).join(' · '))),
    bagIcon2(ch),
    ch.canEdit ? h('button', { class: 'btn sm', title: 'Settings', onclick: () => charSettings(ch.id) }, '⋯') : null), ch.id);
  const viewers = ho => ho.shared ? 'everyone' : (ho.viewers || []).map(V.member).filter(Boolean).map(u => u.name).join(', ');
  const hrow = ho => h('div', { class: 'crow2 hrow', draggable: gm ? 'true' : null, title: gm ? 'Drag onto a folder' : null,
      ondragstart: e => { e.dataTransfer.setData(HO_TYPE, ho.id); e.dataTransfer.setData('text/plain', ho.name); e.dataTransfer.effectAllowed = 'move'; } },
    h('span', { class: 'av hav', style: ho.img ? `background-image:url("${ho.img}")` : '' }, ho.img ? '' : '📜'),
    h('button', { class: 'nm', title: 'Open the handout', onclick: () => V.openHandout(ho.id) }, h('b', null, ho.name),
      h('span', { class: 'muted small' }, 'Handout' + (gm ? ' · ' + (viewers(ho) ? 'seen by ' + viewers(ho) : 'GM only') : ''))),
    gm ? h('button', { class: 'btn sm', title: 'Show it to everyone now', onclick: () => V.send({ t: 'showHandout', id: ho.id }).then(() => V.toast('Shown to everyone')) }, '👁') : null);
  // a drop zone that files dragged characters into a folder (null = no folder)
  const dropInto = (el, fid) => {
    if (!gm) return el;
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes(HO_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('dropping'); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('dropping'); });
    el.addEventListener('drop', e => {
      el.classList.remove('dropping');
      const cid = e.dataTransfer.getData(DRAG_TYPE), hid = e.dataTransfer.getData(HO_TYPE); if (!cid && !hid) return;
      e.preventDefault(); e.stopPropagation();
      if (fid) { folderOpen[fid] = true; saveFolderOpen(); }
      V.op(cid ? { t: 'char.update', id: cid, patch: { folder: fid } } : { t: 'handout.update', id: hid, patch: { folder: fid } });
    });
    return el;
  };
  const inFolder = fid => list.filter(ch => (ch.folder || null) === fid);
  const hoIn = fid => hos.filter(ho => (ho.folder || null) === fid);
  const folderEl = f => {
    const kids = inFolder(f.id), hk = hoIn(f.id), open = !!folderOpen[f.id];
    return dropInto(h('div', { class: 'cfold' + (open ? ' open' : '') },
      h('div', { class: 'cfh' },
        h('button', { class: 'nm', onclick: () => { folderOpen[f.id] = !open; saveFolderOpen(); renderChars(); } },
          h('span', { class: 'tw' }, open ? '▾' : '▸'), h('span', { class: 'fi' }, '📁'), h('b', null, f.name), h('span', { class: 'muted small' }, ` ${kids.length + hk.length}`)),
        gm ? h('button', { class: 'btn sm', title: 'Folder settings', onclick: () => folderSettings(f.id) }, '⋯') : null),
      open ? h('div', { class: 'cfb' }, kids.length || hk.length ? [kids.map(row), hk.map(hrow)] : h('p', { class: 'muted small', style: 'margin:4px 8px' }, gm ? 'Empty. Drag characters here.' : 'Empty.')) : null), f.id);
  };
  const loose = inFolder(null).concat(list.filter(ch => ch.folder && !folders.some(f => f.id === ch.folder)));
  const looseH = hoIn(null).concat(hos.filter(ho => ho.folder && !folders.some(f => f.id === ho.folder)));
  box.replaceChildren(
    h('div', { class: 'jhead' },
      V.isGuest() ? null : h('button', { class: 'btn primary', onclick: () => newChar(defSheet), title: 'A new character with a blank sheet' }, 'Character'),
      gm && V.quickNPC ? h('button', { class: 'btn', title: 'A statted NPC in a few clicks: what they are, a name from the Name Forge, a token on the scene', onclick: () => V.quickNPC() }, 'Quick NPC') : null,
      gm ? h('button', { class: 'btn', onclick: newHandout, title: 'A new handout' }, 'Handout') : null,
      gm ? h('button', { class: 'btn', onclick: newFolder, title: 'A new folder' }, 'Folder') : null,
      gm && sheets.length > 1 ? h('label', { class: 'jsheet' }, h('span', null, 'New characters get'), h('select', { id: 'newSheet', title: 'Sheet for new characters' }, ...sheets.map(([k, v]) => h('option', { value: k, selected: k === defSheet || null }, v.name)))) : null),
    h('h3', null, `Journal · ${list.length} character${list.length === 1 ? '' : 's'}` + (hos.length ? `, ${hos.length} handout${hos.length === 1 ? '' : 's'}` : '')),
    list.length || folders.length || hos.length ? null : h('p', { class: 'muted' }, gm ? 'No characters yet. Make one, then give it to a player in its settings.' : 'You have no characters yet. Make one, or ask the GM to give you one.'),
    ...folders.map(folderEl),
    dropInto(h('div', { class: 'cloose' }, ...loose.map(row), ...looseH.map(hrow), gm && folders.length ? h('p', { class: 'muted small droptip' }, 'Drag a character here to take it out of its folder.') : null), null),
    gm && list.length ? h('p', { class: 'muted small', style: 'margin-top:10px' }, 'Drag a character onto the map to place a token linked to its sheet.') : null,
    otherCampaigns(),
    !V.isGuest() ? h('div', { class: 'jimport' }, h('span', { class: 'muted small' }, 'Bring in from'),
      V.openDDBImport ? h('button', { class: 'btn sm', title: 'A character from D&D Beyond, by its link', onclick: () => V.openDDBImport() }, 'D&D Beyond') : null,
      gm && V.openRoll20Import ? h('button', { class: 'btn sm', title: 'Characters, handouts and pages exported from Roll20', onclick: () => V.openRoll20Import() }, 'Roll20') : null,
      gm ? h('button', { class: 'btn sm', title: 'Scenes and characters from Foundry VTT', onclick: () => V.openFoundryImport() }, 'Foundry') : null) : null);
}
async function newHandout() {
  const r = await V.op({ t: 'handout.create', handout: { name: 'New handout' } }).catch(() => null);
  if (r && r.op && r.op.handout) V.openHandout(r.op.handout.id);
}
function newFolder() {
  const fs = (state.camp.charFolders || []).slice();
  let n = 'New folder', i = 2; while (fs.some(f => f.name === n)) n = `New folder ${i++}`;
  const id = 'd' + Math.random().toString(36).slice(2, 12);
  folderOpen[id] = true; saveFolderOpen();
  V.op({ t: 'folders.set', folders: fs.concat([{ id, name: n }]) }).then(() => folderSettings(id));
}
function folderSettings(fid) {
  const fs = (state.camp.charFolders || []).slice(), i = fs.findIndex(f => f.id === fid); if (i < 0) return;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const save = list => V.op({ t: 'folders.set', folders: list });
  const move = d => { const j = i + d; if (j < 0 || j >= fs.length) return; const l = fs.slice(); [l[i], l[j]] = [l[j], l[i]]; save(l).then(close); };
  const name = h('input', { value: fs[i].name, style: 'width:100%', onkeydown: e => { if (e.key === 'Enter') done(); } });
  const done = () => { const v = name.value.trim(); if (v && v !== fs[i].name) save(fs.map(f => f.id === fid ? { id: fid, name: v } : f)); close(); };
  const count = (state.camp.characters || []).filter(c => c.folder === fid).length;
  modal.replaceChildren(h('div', { class: 'dialog' },
    h('div', { class: 'dh' }, h('h2', null, 'Folder'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' }, h('label', null, 'Name'), name,
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm', disabled: i === 0 || null, onclick: () => move(-1) }, 'Move up'),
        h('button', { class: 'btn sm', disabled: i === fs.length - 1 || null, onclick: () => move(1) }, 'Move down'))),
    h('div', { class: 'df' },
      h('button', { class: 'btn danger', title: count ? 'Its characters move out of the folder; they are not deleted' : '', onclick: () => { save(fs.filter(f => f.id !== fid)); close(); } }, 'Delete folder'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: done }, 'Done'))));
  modal.hidden = false;
  name.focus(); name.select();
}
V.charDragType = DRAG_TYPE;
on('meta', renderChars);
async function newChar(defSheet) {
  const sheet = ($('#newSheet') && $('#newSheet').value) || defSheet;
  const r = await V.op({ t: 'char.create', char: { name: 'New character', sheet } }).catch(() => null);
  if (r && r.op && r.op.char) V.openSheet(r.op.char.id);
}
function charSettings(cid) {
  const ch = (state.camp.characters || []).find(x => x.id === cid); if (!ch) return;
  const gm = V.isGM();
  const modal = $('#modal');
  const set = patch => V.op({ t: 'char.update', id: cid, patch });
  const close = () => { modal.hidden = true; modal.replaceChildren(); };
  const players = state.camp.members.filter(m => m.role !== 'gm');
  modal.replaceChildren(h('div', { class: 'dialog' },
    h('div', { class: 'dh' }, h('h2', null, ch.name), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('label', null, 'Name'), h('input', { value: ch.name, style: 'width:100%', onchange: e => set({ name: e.target.value }) }),
      h('label', null, 'Picture'),
      h('div', { class: 'row' }, h('span', { class: 'av big', style: ch.avatar ? `background-image:url("${ch.avatar}")` : '' }),
        h('button', { class: 'btn sm', onclick: () => V.pickImage(url => set({ avatar: url, token: null }).then(() => charSettings(cid))) }, ch.avatar ? 'Change' : 'Add a picture'),
        ch.avatar ? h('button', { class: 'btn sm', onclick: () => set({ avatar: null }).then(() => charSettings(cid)) }, 'Remove') : null),
      h('label', null, 'Token'),
      h('div', { class: 'row' }, h('span', { class: 'av big tokav', style: (ch.token || ch.avatar) ? `background-image:url("${ch.token || ch.avatar}")` : '' }),
        h('button', { class: 'btn sm', disabled: !(ch.avatar || ch.token) || null, title: 'Frame the portrait as a round token, with a frame', onclick: () => V.stampTokenFor(ch, () => charSettings(cid)) }, ch.token ? 'Adjust the token' : 'Make a token from the picture'),
        ch.token ? null : h('span', { class: 'muted small' }, ch.avatar ? 'One is made for you when you place them.' : '')),
      gm ? [h('label', null, 'Played by'),
        ownerPicker(ch),
        players.length ? null : h('p', { class: 'muted small' }, 'No players in this campaign yet: add them in Admin.'),
        (state.camp.charFolders || []).length ? [h('label', null, 'Folder'), h('select', { onchange: e => set({ folder: e.target.value || null }) },
          h('option', { value: '' }, '(none)'), ...state.camp.charFolders.map(f => h('option', { value: f.id, selected: ch.folder === f.id || null }, f.name)))] : null,
        h('label', { class: 'inline', style: 'margin-top:10px' }, h('input', { type: 'checkbox', checked: ch.shared, onchange: e => set({ shared: e.target.checked }) }), 'Everyone can view this sheet (read only)')] : null),
    h('div', { class: 'df' },
      h('button', { class: 'btn danger', onclick: () => { if (confirm(`Delete ${ch.name}? Ctrl+Z on the table brings them back.`)) { V.op({ t: 'char.delete', id: cid }); close(); } } }, 'Delete'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: close }, 'Done'))));
  modal.hidden = false;
}

// ───────────────────────── sheet panels ─────────────────────────

const panels = new Map();   // character or handout id -> panel
// A floating panel holding a page (a sheet or a handout) over the map, clear of the side panel; ⧉ tears it off.
function framePanel(key, url, title, opts) {
  if (panels.has(key)) { const p = panels.get(key); p.style.zIndex = ++zTop; p.classList.remove('min'); return p; }
  const box = $('#panels').getBoundingClientRect(), stage = $('#stage').getBoundingClientRect();
  const right = stage.right - box.left, left = stage.left - box.left;
  const w = Math.max(360, Math.min(opts.width || 900, right - left - 20)), hh = Math.min(box.height - 20, opts.height || 900);
  const p = h('div', { class: 'panel sheetpanel', style: `left:${Math.max(left + 10, right - w - 10 - panels.size * 30)}px; top:${10 + panels.size * 30}px; width:${w}px; height:${hh}px; z-index:${++zTop}` });
  const head = h('div', { class: 'ph' }, h('b', null, title), h('span', { class: 'muted small ro', style: 'margin-left:8px', hidden: !opts.readOnly }, 'read only'),
    opts.extra || null,
    opts.night ? h('button', { title: 'Night mode on or off', onclick: () => {
      let v = null; try { v = localStorage.getItem('vtt-sheet-night'); } catch (e) { /* blocked */ }
      const on = v == null ? matchMedia('(prefers-color-scheme: dark)').matches : v === '1';
      try { localStorage.setItem('vtt-sheet-night', on ? '0' : '1'); } catch (e) { /* blocked */ }
      // other windows hear about it from the storage event; a frame on this page may not, so tell it too
      for (const f of document.querySelectorAll('.sheetpanel iframe')) f.contentWindow && f.contentWindow.postMessage({ t: 'night' }, location.origin);
    } }, '☾') : null,
    h('button', { title: 'Open in its own window', onclick: () => { window.open(url.replace('&embed=1', ''), 'win-' + key, `width=${opts.popW || 920},height=${opts.popH || 960}`); close(); } }, '⧉'),
    h('button', { title: 'Close', onclick: () => close() }, '×'));
  const frame = h('iframe', { src: url, class: 'sheetframe', title });
  p.append(head, frame);
  $('#panels').append(p);
  V.dragPanel(p, head);
  p.addEventListener('pointerdown', () => { p.style.zIndex = ++zTop; });
  head.addEventListener('dblclick', e => { if (!e.target.closest('button')) p.classList.toggle('min'); });   // fold to the title bar and back
  head.title = 'Double-click to fold away';
  panels.set(key, p);
  function close() { p.remove(); panels.delete(key); }
  return p;
}
// The two 5e sheets: a button in the sheet's title bar flips between them (the character comes along).
function otherSheet(ch) {
  const sheets = state.camp.sheets || {}, mode = sheets[ch.sheet] && sheets[ch.sheet].mode;
  return Object.keys(sheets).find(k => k !== ch.sheet && sheets[k].mode === mode) || null;
}
const shortName = id => ({ dnd5e: 'Community', dnd5e_legacy: 'Legacy' }[id] || ((state.camp.sheets || {})[id] || {}).name || id);
function styleSwitch(ch) {
  if (!ch || !ch.canEdit || !otherSheet(ch)) return null;
  return h('button', { class: 'styleSw', title: 'Switch to the other sheet style; the character comes along',
    onclick: async e => {
      const c = (state.camp.characters || []).find(x => x.id === ch.id), o = c && otherSheet(c); if (!o) return;
      const btn = e.currentTarget; btn.disabled = true;
      // the sheet saves what's still being typed first, so nothing is left behind
      for (const f of document.querySelectorAll('iframe')) {
        if (!(f.src || '').includes('ch=' + ch.id)) continue;
        try { if (f.contentWindow.RS && f.contentWindow.RS.flush) await f.contentWindow.RS.flush(); } catch (err) { /* not loaded */ }
      }
      try { await V.op({ t: 'char.update', id: ch.id, patch: { sheet: o } }); } finally { btn.disabled = false; }
    } },
    '⇄ ' + shortName(otherSheet(ch)));
}
V.openSheet = function (cid) {
  const ch = (state.camp.characters || []).find(x => x.id === cid);
  const bag = ch && V.openInventory ? h('button', { class: 'bagbtn', title: 'Inventory: their item cards', onclick: () => V.openInventory(cid) }, bagIcon()) : null;
  const p = framePanel(cid, `/table/sheet.html?c=${state.camp.id}&ch=${cid}&embed=1`, ch ? ch.name : 'Character', { readOnly: ch && !ch.canEdit, night: true, extra: [styleSwitch(ch), bag] });
  if (p && !p._items && V.itemDropTarget) { p._items = true; V.itemDropTarget(p, cid); }   // drop item cards on the sheet: into the inventory
};
V.openHandout = function (hid) {
  const ho = (state.camp.handouts || []).find(x => x.id === hid);
  framePanel(hid, `/table/handout.html?c=${state.camp.id}&h=${hid}&embed=1`, ho ? ho.name : 'Handout', { width: 620, height: 760, popW: 680, popH: 820 });
};
on('handoutShow', id => V.openHandout(id));
let zTop = 30;
// Rolls a sheet button from outside its sheet (a link in the chat): through the open sheet panel, or a hidden one.
// Rolling a sheet's button without its panel open: a hidden copy of the sheet does it. It's kept warm for a while,
// so the next roll from the same character (the action bar, a link in the chat) is instant.
const warm = new Map();   // char id → { fr, ready, queue, t }
const HIDDEN = 'position:absolute;width:10px;height:10px;left:-9999px;top:0;border:0';
function touchWarm(cid, w) { clearTimeout(w.t); w.t = setTimeout(() => { w.fr.remove(); warm.delete(cid); }, 10 * 60 * 1000); }
V.warmSheet = function (cid, ref) {
  const ch = (state.camp.characters || []).find(x => x.id === cid);
  if (!ch || !ch.canEdit) return;
  let w = warm.get(cid);
  if (w && document.body.contains(w.fr)) { touchWarm(cid, w); if (ref) { if (w.ready) w.fr.contentWindow.postMessage({ t: 'runButton', ref }, location.origin); else w.queue.push(ref); } return; }
  const fr = h('iframe', { src: `/table/sheet.html?c=${state.camp.id}&ch=${cid}&embed=1&` + (ref ? 'run=' + encodeURIComponent(ref) : 'warm=1'), style: HIDDEN, 'aria-hidden': 'true', class: 'warmsheet' });
  w = { fr, ready: false, queue: [] };
  warm.set(cid, w); touchWarm(cid, w);
  document.body.append(fr);
};
V.runSheetButton = function (cid, ref) {
  const ch = (state.camp.characters || []).find(x => x.id === cid);
  if (!ch) return V.toast('That character is gone', true);
  if (!ch.canEdit) return V.toast('You can only roll for your own characters', true);
  const p = panels.get(cid), fr = p && p.querySelector('iframe');
  if (fr && fr.contentWindow) return fr.contentWindow.postMessage({ t: 'runButton', ref }, location.origin);
  V.warmSheet(cid, ref);
};
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data) return;
  for (const [cid, w] of warm) if (w.fr.contentWindow === e.source) {
    if (e.data.t === 'ranButton') {
      w.fr.style.cssText = HIDDEN;
      if (!w.ready) { w.ready = true; for (const r of w.queue.splice(0)) w.fr.contentWindow.postMessage({ t: 'runButton', ref: r }, location.origin); }
    }
    if (e.data.t === 'runNeedsUI') w.fr.style.cssText = 'position:fixed;left:50%;top:30%;transform:translate(-50%,0);width:440px;height:320px;border:0;z-index:200;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);background:transparent';
    void cid;
  }
  if (e.data.t === 'sheetPoppedOut' || e.data.t === 'poppedOut') { const k = e.data.ch || e.data.key, p = panels.get(k); if (p) { p.remove(); panels.delete(k); } }
});
on('meta', () => {   // keep panel titles current; close the panels of deleted (or no longer shared) characters and handouts
  for (const [key, p] of panels) {
    const ch = (state.camp.characters || []).find(c => c.id === key), ho = (state.camp.handouts || []).find(x => x.id === key);
    if (!ch && !ho) { p.remove(); panels.delete(key); continue; }
    p.querySelector('.ph b').textContent = (ch || ho).name;
    p.querySelector('.ph .ro').hidden = !ch || ch.canEdit;
    const sw = p.querySelector('.ph .styleSw'); if (sw && ch && otherSheet(ch)) sw.textContent = '⇄ ' + shortName(otherSheet(ch));
  }
});

// ───────────────────────── token ↔ character ─────────────────────────

V.tokenPanelExtras = function (t, set) {
  const chars = (state.camp && state.camp.characters) || [];
  const ch = t.sheet && chars.find(c => c.id === t.sheet);
  return h('div', { class: 'tokchar' },
    V.isGM() ? h('div', null, h('label', null, 'Character sheet'),
      h('select', { style: 'width:100%', onchange: e => {
        const id = e.target.value || null;
        const c2 = id && chars.find(c => c.id === id);
        set(Object.assign({ sheet: id }, c2 && (!t.name || t.name === 'New token') ? { name: c2.name } : {}, c2 && c2.avatar && !t.img ? { img: c2.avatar } : {}));
      } }, h('option', { value: '' }, 'None'), ...chars.map(c => h('option', { value: c.id, selected: c.id === t.sheet || null }, c.name)))) : null,
    ch ? h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => V.openSheet(ch.id) }, `Open ${ch.name}’s sheet`),
      h('span', { class: 'muted small' }, 'Hit points follow the sheet.')) : null);
};
})();
