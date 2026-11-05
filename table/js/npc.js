/* Quick NPC (the Journal's button, GM): a named, statted character in a few clicks — the innkeeper, the guard at the
 * gate, a bandit chief — rather than a blank sheet to fill in. Pick what they are (a 5e stat line, or a 2D6 tier), give
 * them a name (or let the Name Forge make one from the world's own lists of names) and a line about who they are; they
 * go in the Journal's NPCs folder, and a token can go straight onto the scene you're looking at.
 * V.quickNPC() */
'use strict';
(function () {
const { $, h, state } = V;

// 5e: the SRD 5.1 stat lines (AC, hit dice, CR, STR DEX CON INT WIS CHA, what they are)
const FIVE = [
  ['Commoner', 10, '1d8', '0', [10, 10, 10, 10, 10, 10], 'Medium humanoid (any race), any alignment'],
  ['Guard', 16, '2d8+2', '1/8', [13, 12, 12, 10, 11, 10], 'Medium humanoid (any race), any alignment'],
  ['Bandit', 12, '2d8+2', '1/8', [11, 12, 12, 10, 10, 10], 'Medium humanoid (any race), any non-lawful alignment'],
  ['Cultist', 12, '2d8', '1/8', [11, 12, 10, 10, 11, 10], 'Medium humanoid (any race), any non-good alignment'],
  ['Noble', 15, '2d8', '1/8', [11, 12, 11, 12, 14, 16], 'Medium humanoid (any race), any alignment'],
  ['Acolyte', 10, '2d8', '1/4', [10, 10, 10, 10, 14, 11], 'Medium humanoid (any race), any alignment'],
  ['Scout', 13, '3d8+3', '1/2', [11, 14, 12, 11, 13, 11], 'Medium humanoid (any race), any alignment'],
  ['Thug', 11, '5d8+10', '1/2', [15, 11, 14, 10, 10, 11], 'Medium humanoid (any race), any non-good alignment'],
  ['Priest', 13, '5d8+5', '2', [10, 10, 12, 13, 16, 13], 'Medium humanoid (any race), any alignment'],
  ['Bandit captain', 15, '10d8+20', '2', [15, 16, 14, 14, 11, 14], 'Medium humanoid (any race), any non-lawful alignment'],
  ['Knight', 18, '8d8+16', '3', [16, 11, 14, 11, 11, 15], 'Medium humanoid (any race), any alignment'],
  ['Veteran', 17, '9d8+18', '3', [16, 13, 14, 10, 11, 10], 'Medium humanoid (any race), any alignment'],
  ['Mage', 12, '9d8', '6', [9, 14, 11, 17, 12, 11], 'Medium humanoid (any race), any alignment']
];
// 2D6: tiers (hit points, armour, the attributes on the 0–6 dots)
const TWO = [
  ['Bystander', 4, 0, 1, 'Someone in the way: a farmer, a clerk, a child.'],
  ['Minion', 6, 0, 1, 'Goes down in a hit or two.'],
  ['Soldier', 12, 1, 2, 'Trained and armed: a guard, a bandit, a sailor.'],
  ['Veteran', 18, 2, 3, 'Has seen fighting and lived.'],
  ['Elite', 24, 3, 4, 'A captain, a duellist, a mage of some power.'],
  ['Boss', 36, 4, 5, 'The one the party came for.']
];
const ABIL = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SHORT2 = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const mod = v => Math.floor((v - 10) / 2);
function rollDice(expr) {   // "5d8+10" → a roll; avg when asked
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr); if (!m) return 1;
  let t = +(m[3] || 0); for (let i = 0; i < +m[1]; i++) t += 1 + Math.floor(Math.random() * +m[2]);
  return Math.max(1, t);
}
const average = expr => { const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr); return m ? Math.max(1, Math.floor(+m[1] * (+m[2] + 1) / 2) + +(m[3] || 0)) : 1; };

// ───────── names: the Name Forge (the site's, from the wiki's "Common Names of …" pages), or a plain fallback ─────────
let forge = null;
function loadForge() {
  if (forge) return forge;
  forge = (async () => {
    if (!window.ValanarNames) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/app/names.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
    const j = await fetch('/api/site/wiki', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { pages: [] });
    const pages = (j.pages || []).map(p => Object.assign({ folders: String(p.folder || '').split('/').filter(Boolean) }, p));
    const N = window.ValanarNames({ h, toast: V.toast, pages: () => pages, data: () => ({ markers: [], nations: [] }), typeOf: () => null, nationOfMarker: () => '', wikiHref: () => '#' });
    return N;
  })().catch(() => null);
  return forge;
}
const SYL = { a: ['Al', 'Bran', 'Cor', 'Da', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lu', 'Mar', 'Ned', 'Os', 'Per', 'Ro', 'Sev', 'Tor', 'Ul', 'Var', 'Wil', 'Bo', 'Dre', 'Mi', 'Ta'],
  b: ['ric', 'win', 'a', 'en', 'ar', 'mund', 'is', 'o', 'eth', 'yn', 'ard', 'old', 'ia', 'ek', 'an', 'rad', 'mir', 'na', 'ka', 'helm'] };
const pick = a => a[Math.floor(Math.random() * a.length)];
const plainName = () => pick(SYL.a) + pick(SYL.b) + ' ' + pick(SYL.a) + pick(['wood', 'son', 'ley', 'mere', 'ford', 'ov', 'ek', 'ard', 'holt', 'brook']);

V.quickNPC = async function () {
  if (!V.isGM()) return;
  const c = state.camp, mode = c.mode === '2d6' ? '2d6' : '5e';
  const sheets = Object.entries(c.sheets || {}).filter(([, v]) => v.mode === mode);
  const sheet = (($('#newSheet') && $('#newSheet').value && (c.sheets[$('#newSheet').value] || {}).mode === mode) ? $('#newSheet').value : (sheets[0] || [])[0]) || (mode === '2d6' ? '2d6' : 'dnd5e');
  const kinds = mode === '2d6' ? TWO : FIVE;
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const remembered = V.store.get('vtt-npc-last', {});
  const was = kinds.findIndex(k => k[0] === remembered.kind);
  let kind = was >= 0 ? was : mode === '2d6' ? 2 : 1;
  const name = h('input', { type: 'text', placeholder: 'Their name', style: 'flex:1', value: '' });
  const who = h('input', { type: 'text', placeholder: 'Who they are: “keeps the Drowned Rat, owes the guild money”', style: 'width:100%' });
  const people = h('select', { title: 'Whose names to forge from (the wiki’s “Common Names of …” pages)', style: 'max-width:46%' }, h('option', { value: '' }, 'Names: anyone'));
  const sex = h('select', { title: 'A man’s or a woman’s name' }, h('option', { value: '' }, 'Either'), h('option', { value: 'm' }, 'Man'), h('option', { value: 'f' }, 'Woman'));
  let PEOPLE = [];
  const roll = async () => {
    const N = await loadForge();
    const p = PEOPLE[+people.value];
    let nm = '';
    try {
      if (N && p) nm = (N.forgePeople(p, sex.value || 'any', 1)[0] || {}).name || '';
      else if (N && PEOPLE.length) { const q = pick(PEOPLE); nm = (N.forgePeople(q, sex.value || 'any', 1)[0] || {}).name || ''; }
    } catch (e) { nm = ''; }
    name.value = nm || plainName();
  };
  loadForge().then(N => {
    if (!N) return;
    try { PEOPLE = N.people(); } catch (e) { PEOPLE = []; }
    PEOPLE.forEach((p, i) => people.append(h('option', { value: i, selected: remembered.people === p.key || null }, `${p.race} · ${p.nation}`)));
    if (!name.value) roll();
  });
  const hpOut = h('b'), statLine = h('div', { class: 'muted small npcstats' });
  let rolled = null;
  const draw = () => {
    const k = kinds[kind];
    if (mode === '2d6') { statLine.textContent = `${k[1]} HP · armour ${k[2]} · attributes about ${k[3]} · ${k[4]}`; return; }
    const hp = rolled == null ? average(k[2]) : rolled;
    statLine.replaceChildren(`AC ${k[1]} · `, h('b', null, `${hp} HP`), ` (${k[2]}) · CR ${k[3]}`,
      h('div', null, ABIL.map((ab, i) => `${ab.slice(0, 3).toUpperCase()} ${k[4][i]} (${mod(k[4][i]) >= 0 ? '+' : ''}${mod(k[4][i])})`).join(' · ')));
  };
  const kindSel = h('select', { style: 'width:100%', onchange: e => { kind = +e.target.value; rolled = null; draw(); } },
    ...kinds.map((k, i) => h('option', { value: i, selected: i === kind || null }, mode === '2d6' ? `${k[0]} (${k[1]} HP, armour ${k[2]})` : `${k[0]} (CR ${k[3]}, AC ${k[1]})`)));
  const rollHP = mode === '5e' ? h('button', { class: 'btn sm', title: 'Roll their hit points rather than taking the average', onclick: () => { rolled = rollDice(kinds[kind][2]); draw(); } }, '🎲 Roll HP') : null;
  const canPlace = !!state.scene;
  const place = h('input', { type: 'checkbox', checked: canPlace && remembered.place !== false || null, disabled: !canPlace || null });
  const hidden = h('input', { type: 'checkbox', checked: remembered.hidden || null, disabled: !canPlace || null });
  const openIt = h('input', { type: 'checkbox', checked: remembered.open || null });
  const make = async () => {
    const k = kinds[kind], nm = name.value.trim() || plainName();
    V.store.set('vtt-npc-last', { kind: k[0], people: PEOPLE[+people.value] ? PEOPLE[+people.value].key : '', place: place.checked, hidden: hidden.checked, open: openIt.checked });
    go.disabled = true;
    try {
      const r = await V.op({ t: 'char.create', char: { name: nm, sheet } });
      const cid = r && r.op && r.op.char && r.op.char.id; if (!cid) throw new Error('No character made');
      // the stats on the sheet
      const set = { character_name: nm };
      if (mode === '2d6') {
        Object.assign(set, { hp: k[1], hp_max: k[1], armour: k[2], level: Math.max(1, kind), notes: who.value.trim() || k[4] });
        SHORT2.forEach(a => { set[a] = k[3]; });
      } else {
        const hp = rolled == null ? average(k[2]) : rolled;
        Object.assign(set, { is_npc: 1, npc_type: who.value.trim() ? who.value.trim() : k[5], npc_ac: k[1], npc_actype: '', npc_hp: hp, npc_hp_max: hp, npc_hp_hit_dice: k[2], npc_challenge: k[3],
          hp, hp_max: hp, ac: k[1], npc_speed: '30 ft.', npc_languages: 'Common' });
        ABIL.forEach((a, i) => { set[a] = k[4][i]; set['npc_' + a] = k[4][i]; });
        if (who.value.trim()) set.npc_traits = who.value.trim();
      }
      await V.send({ t: 'charAttrs', char: cid, set });
      // in the Journal's NPCs folder
      let f = (c.charFolders || []).find(x => /^npcs?$/i.test(x.name));
      if (!f) { await V.op({ t: 'folders.set', folders: (c.charFolders || []).concat([{ id: 'npcs', name: 'NPCs' }]) }).catch(() => null); f = { id: 'npcs' }; }
      await V.op({ t: 'char.update', id: cid, patch: { folder: f.id } }).catch(() => null);
      // a token on the scene, in the middle of the view
      if (place.checked && state.scene) {
        const p = V.viewCenter(), g = V.grid ? V.grid() : null;
        const [x, y] = window.Geom && g ? Geom.snap(g, p.x, p.y, 1) : [p.x, p.y];
        const hpv = +set.hp || 1;
        const tr = await V.op({ t: 'token.create', scene: state.scene.id, token: { name: nm, sheet: cid, x, y, size: 1, layer: hidden.checked ? 'gm' : (state.layer === 'gm' ? 'gm' : 'tokens'), hp: { v: hpv, max: hpv } } }).catch(() => null);
        if (tr && tr.op && tr.op.token && V.setSel) V.setSel([tr.op.token.id]);
      }
      close();
      V.toast(`${nm} is in the Journal (NPCs).`);
      if (openIt.checked) V.openSheet(cid);
    } catch (e) { V.toast('Couldn’t make them: ' + (e.message || e), true); go.disabled = false; }
  };
  const go = h('button', { class: 'btn primary', onclick: make }, 'Make them');
  modal.replaceChildren(h('div', { class: 'dialog npcdlg' },
    h('div', { class: 'dh' }, h('h2', null, 'Quick NPC'), h('button', { onclick: close }, '×')),
    h('div', { class: 'db' },
      h('label', null, 'Name'),
      h('div', { class: 'row' }, name, h('button', { class: 'btn', title: 'A name from the Name Forge, in the style of the world’s own names', onclick: roll }, '✦ Forge')),
      h('div', { class: 'row', style: 'margin-top:6px' }, people, sex),
      h('label', null, mode === '2d6' ? 'What they are (2D6)' : 'What they are (5e, the SRD’s stat lines)'), kindSel,
      h('div', { class: 'row', style: 'align-items:flex-start;margin-top:6px' }, statLine, rollHP),
      h('label', null, 'Who they are'), who,
      h('div', { class: 'npcopts' },
        h('label', { class: 'inline', title: canPlace ? '' : 'Open a scene first' }, place, ' Put a token in the middle of the scene'),
        h('label', { class: 'inline' }, hidden, ' Hidden from the players (the GM layer)'),
        h('label', { class: 'inline' }, openIt, ' Open their sheet afterwards'))),
    h('div', { class: 'df' }, h('span', { class: 'muted small' }, 'They go in the Journal’s NPCs folder.'), h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), go)));
  modal.hidden = false;
  draw();
  name.addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
  setTimeout(() => name.focus(), 30);
};
})();
