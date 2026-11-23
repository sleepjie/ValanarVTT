/* The character creator: a new D&D 5e character, step by step, by this table's rules.
 *   - ability scores rolled by the server and shown in the chat: 3d6+2 per score (a set averaging under 12 is
 *     rolled again), or 4d6 dropping the lowest
 *   - the most hit points at 1st level (the hit die plus Constitution); after that the average
 *   - a free feat at level 0 (an origin feat, if the GM has brought in a book with them)
 * Species, classes, subclasses and feats come from the Features side (the SRD and whatever books the GM has brought
 * in); the class and racial features the character has at their level go straight onto the new sheet.
 * V.openCreator() */
'use strict';
(function () {
const { $, h, state } = V;

const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const AB_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const DIE = { Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10, Sorcerer: 6, Wizard: 6 };
const SAVES = { Artificer: ['con', 'int'], Barbarian: ['str', 'con'], Bard: ['dex', 'cha'], Cleric: ['wis', 'cha'], Druid: ['int', 'wis'], Fighter: ['str', 'con'],
  Monk: ['str', 'dex'], Paladin: ['wis', 'cha'], Ranger: ['str', 'dex'], Rogue: ['dex', 'int'], Sorcerer: ['con', 'cha'], Warlock: ['wis', 'cha'], Wizard: ['int', 'wis'] };
// the order the scores usually go in, best first
const PRIORITY = { Artificer: 'int con dex wis cha str', Barbarian: 'str con dex wis cha int', Bard: 'cha dex con wis int str', Cleric: 'wis con str dex cha int',
  Druid: 'wis con dex int cha str', Fighter: 'str con dex wis cha int', Monk: 'dex wis con str int cha', Paladin: 'str cha con wis dex int',
  Ranger: 'dex wis con str int cha', Rogue: 'dex con int wis cha str', Sorcerer: 'cha con dex wis int str', Warlock: 'cha con dex wis int str', Wizard: 'int con dex wis cha str' };
const SKILL_NAME = { acrobatics: 'Acrobatics', animal_handling: 'Animal Handling', arcana: 'Arcana', athletics: 'Athletics', deception: 'Deception', history: 'History',
  insight: 'Insight', intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Medicine', nature: 'Nature', perception: 'Perception',
  performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion', sleight_of_hand: 'Sleight of Hand', stealth: 'Stealth', survival: 'Survival' };
const ALL_SKILLS = Object.keys(SKILL_NAME);
// [how many, from which] (the 2024 Player's Handbook)
const CLASS_SKILLS = {
  Artificer: [2, 'arcana history investigation medicine nature perception sleight_of_hand'], Barbarian: [2, 'animal_handling athletics intimidation nature perception survival'],
  Bard: [3, ALL_SKILLS.join(' ')], Cleric: [2, 'history insight medicine persuasion religion'], Druid: [2, 'arcana animal_handling insight medicine nature perception religion survival'],
  Fighter: [2, 'acrobatics animal_handling athletics history insight intimidation persuasion perception survival'], Monk: [2, 'acrobatics athletics history insight religion stealth'],
  Paladin: [2, 'athletics insight intimidation medicine persuasion religion'], Ranger: [3, 'animal_handling athletics insight investigation nature perception stealth survival'],
  Rogue: [4, 'acrobatics athletics deception insight intimidation investigation perception persuasion sleight_of_hand stealth'],
  Sorcerer: [2, 'arcana deception insight intimidation persuasion religion'], Warlock: [2, 'arcana deception history intimidation investigation nature religion'],
  Wizard: [2, 'arcana history insight investigation medicine nature religion'] };
const BACKGROUND_SKILLS = 2;
const mod = v => Math.floor((v - 10) / 2);
const sg = n => (n >= 0 ? '+' : '') + n;
const md = t => { const d = h('div', { class: 'cc-text' }); d.innerHTML = V.itemTextHTML ? V.itemTextHTML(t || '') : String(t || ''); return d; };
const shortName = f => (f.name.includes(': ') ? f.name.slice(f.name.indexOf(': ') + 2) : f.name);

V.openCreator = async function () {
  const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
  const sheets = Object.entries(state.camp.sheets || {}).filter(([k]) => /^dnd5e/.test(k));
  if (!sheets.length) return V.toast('The character creator makes D&D 5e characters, and this campaign has no 5e sheet', true);
  try { await V.loadFeatures(); } catch (e) { return V.toast('Couldn’t load the features: ' + e.message, true); }
  const all = V.allFeatures();

  const races = [...new Set(all.filter(f => f.kind === 'race').flatMap(f => f.races || []))].sort();
  const classes = [...new Set(all.filter(f => f.kind === 'class' && f.cls).map(f => f.cls))].sort();
  const subsOf = cls => {
    const m = new Map();
    for (const f of all) if (f.kind === 'class' && f.cls === cls && f.sub && !f.parent) m.set(f.sub, Math.min(m.get(f.sub) || 99, f.level || 3));
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const feats = all.filter(f => f.kind === 'feat' && !f.parent);
  const bgs = all.filter(f => f.kind === 'background').sort((a, b) => a.name.localeCompare(b.name));
  // a background's feat ("Magic Initiate (Cleric)" is the Magic Initiate card)
  const bgFeat = bg => { const n = String(bg.feat || '').toLowerCase(); return feats.find(f => f.name.toLowerCase() === n) || feats.find(f => f.name.toLowerCase() === n.replace(/\s*\(.*\)\s*$/, '')); };
  const pickBg = name => {
    c.background = name; const bg = bgs.find(b => b.name === name); if (!bg) return;
    c.bgSkills = (bg.skills || []).filter(k => SKILL_NAME[k]).slice(0, BACKGROUND_SKILLS);
    c.classSkills = c.classSkills.filter(k => !c.bgSkills.includes(k));
    // the 2024 way: +2 to one of its three abilities and +1 to another
    if (bg.abilities && bg.abilities.length) { for (const k of AB) c.bonus[k] = 0; c.bonus[bg.abilities[0]] = 2; if (bg.abilities[1]) c.bonus[bg.abilities[1]] = 1; }
  };
  const isOrigin = f => /^\*?origin feat/i.test(String(f.text || '').trim());

  const c = { name: '', sheet: (sheets.find(([, v]) => v.mode === state.camp.mode) || sheets[0])[0], level: 1, race: '', cls: classes.includes('Fighter') ? 'Fighter' : classes[0] || '',
    sub: '', method: '3d6', scores: null, assign: {}, bonus: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, classSkills: [], bgSkills: [], feat: '', background: '', allFeats: false };
  const STEPS = ['Who', 'Species', 'Class', 'Abilities', 'Skills', 'Feat', 'Done'];
  let step = 0, rolling = false;

  const final = k => (c.scores && c.assign[k] != null ? c.scores[c.assign[k]] : 10) + (+c.bonus[k] || 0);
  const die = () => DIE[c.cls] || 8;
  const hp = () => {
    const cm = mod(final('con'));
    let t = Math.max(1, die() + cm);   // the most at 1st level
    for (let l = 2; l <= c.level; l++) t += Math.max(1, Math.floor(die() / 2) + 1 + cm);
    return t;
  };
  const subLevel = () => { const s = subsOf(c.cls).find(([n]) => n === c.sub); return s ? s[1] : 3; };
  const gained = () => {
    const fs = V.featuresFor({ class: c.cls, base_level: c.level, subclass: c.sub && c.level >= subLevel() ? c.sub : '', race: c.race });
    const seen = new Map();
    for (const f of fs) {
      if (/^(ability score improvement|epic boon)$/i.test(f.name) || / Subclass$/.test(f.name)) continue;
      const k = f.kind + '|' + shortName(f).toLowerCase();
      if (!seen.has(k) || (f.level || 0) > (seen.get(k).level || 0)) seen.set(k, f);   // Indomitable at 9, 13 and 17: the latest
    }
    return [...seen.values()];
  };
  const autoAssign = () => {
    if (!c.scores) return;
    const order = (PRIORITY[c.cls] || 'str dex con int wis cha').split(' ');
    const idx = c.scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    c.assign = {}; order.forEach((k, i) => { c.assign[k] = idx[i]; });
  };

  const body = h('div', { class: 'db cc-body' });
  const nav = h('div', { class: 'cc-steps' });
  const back = h('button', { class: 'btn', onclick: () => go(step - 1) }, 'Back');
  const next = h('button', { class: 'btn primary', onclick: () => go(step + 1) }, 'Next');
  const why = h('span', { class: 'muted small cc-why' });
  modal.replaceChildren(h('div', { class: 'dialog cc' },
    h('div', { class: 'dh' }, h('h2', null, 'New character'), h('button', { onclick: close }, '×')),
    nav, body,
    h('div', { class: 'df' }, back, why, h('div', { class: 'grow' }), next)));
  modal.hidden = false;

  // what stops the next step
  const blocker = s => {
    if (s === 0 && !c.name.trim()) return 'Give them a name';
    if (s === 1 && !c.race) return 'Pick a species';
    if (s === 2 && !c.cls) return 'Pick a class';
    if (s === 3 && !c.scores) return 'Roll the ability scores';
    if (s === 4) { const need = (CLASS_SKILLS[c.cls] || [2])[0]; if (c.classSkills.length < need) return `Pick ${need - c.classSkills.length} more class skill${need - c.classSkills.length === 1 ? '' : 's'}`; }
    if (s === 5 && !c.feat && feats.length) return 'Pick a feat';
    return '';
  };
  function go(s) {
    if (s > step) for (let i = step; i < s; i++) { const b = blocker(i); if (b) { step = i; draw(); why.textContent = b; return; } }
    if (s >= STEPS.length) return make();
    step = Math.max(0, s); draw();
  }
  function draw() {
    nav.replaceChildren(...STEPS.map((n, i) => h('button', { class: 'cc-step' + (i === step ? ' on' : '') + (i < step ? ' done' : ''), onclick: () => go(i) }, `${i + 1}. ${n}`)));
    back.disabled = step === 0;
    next.textContent = step === STEPS.length - 1 ? 'Make the character' : 'Next';
    why.textContent = '';
    body.replaceChildren(...[who, species, klass, abilities, skills, feat, done][step]());
  }

  // ── 1. who ──
  function who() {
    const nm = h('input', { value: c.name, placeholder: 'Their name', style: 'width:100%', oninput: e => { c.name = e.target.value; } });
    setTimeout(() => nm.focus(), 0);
    return [h('label', null, 'Name'), nm,
      h('label', null, 'Background'), bgs.length
        ? h('select', { style: 'width:100%', onchange: e => { pickBg(e.target.value); draw(); } }, h('option', { value: '' }, '(none)'),
          ...bgs.map(b => h('option', { value: b.name, selected: b.name === c.background || null }, `${b.name}${b.feat ? ' · ' + b.feat : ''}${b.skills ? ' · ' + b.skills.map(k => SKILL_NAME[k] || k).join(', ') : ''}`)))
        : h('input', { value: c.background, placeholder: 'Soldier, Sage, Acolyte…', style: 'width:100%', oninput: e => { c.background = e.target.value; } }),
      bgs.some(b => b.name === c.background) ? h('p', { class: 'muted small' }, 'The background gives its two skills, its own feat (on top of your free level 0 feat) and +2/+1 to its ability scores; change the skills and bonuses on the later steps.') : null,
      h('div', { class: 'row', style: 'gap:12px;margin-top:10px' },
        h('label', null, 'Starting level ', h('input', { type: 'number', min: 1, max: 20, value: c.level, style: 'width:64px', onchange: e => { c.level = Math.max(1, Math.min(20, +e.target.value || 1)); } })),
        sheets.length > 1 ? h('label', null, 'Sheet ', h('select', { onchange: e => { c.sheet = e.target.value; } }, ...sheets.map(([k, v]) => h('option', { value: k, selected: k === c.sheet || null }, v.name)))) : null),
      h('p', { class: 'muted small' }, 'Hit points: the most at 1st level (the whole hit die plus Constitution), then the average for each level after.')];
  }
  // ── 2. species ──
  function species() {
    const traits = h('div', { class: 'cc-preview' });
    const show = () => {
      const fs = all.filter(f => f.kind === 'race' && !f.parent && (f.races || []).includes(c.race));
      traits.replaceChildren(...(c.race ? [h('h3', null, c.race), ...fs.map(f => h('div', { class: 'cc-feat' }, h('b', null, shortName(f)), md(f.text)))] : [h('p', { class: 'muted' }, 'Pick one to see their traits.')]));
    };
    const list = h('div', { class: 'cc-list' }, ...races.map(r => h('button', { class: 'cc-pick' + (r === c.race ? ' on' : ''), onclick: e => {
      c.race = r; for (const b of list.children) b.classList.toggle('on', b === e.currentTarget); show();
    } }, r)));
    show();
    return [h('div', { class: 'cc-split' }, list, traits)];
  }
  // ── 3. class ──
  function klass() {
    const preview = h('div', { class: 'cc-preview' });
    const subSel = h('select', { style: 'width:100%' });
    const fill = () => {
      const subs = subsOf(c.cls);
      if (!subs.some(([n]) => n === c.sub)) c.sub = '';
      subSel.replaceChildren(h('option', { value: '' }, subs.length ? '(choose later)' : '(none brought in)'), ...subs.map(([n, lv]) => h('option', { value: n, selected: n === c.sub || null }, `${n} (level ${lv})`)));
      const fs = gained().filter(f => f.kind === 'class');
      preview.replaceChildren(h('h3', null, `${c.cls} ${c.level}`), h('p', { class: 'muted small' }, `Hit die d${die()} · saving throws ${(SAVES[c.cls] || []).map(k => AB_NAME[k]).join(' and ')}`),
        ...fs.map(f => h('details', { class: 'cc-feat' }, h('summary', null, h('b', null, shortName(f)), h('span', { class: 'muted small' }, ` level ${f.level}${f.sub ? ' · ' + f.sub : ''}`)), md(f.text))));
    };
    subSel.onchange = e => { c.sub = e.target.value; fill(); };
    const list = h('div', { class: 'cc-list' }, ...classes.map(k => h('button', { class: 'cc-pick' + (k === c.cls ? ' on' : ''), onclick: e => {
      c.cls = k; c.classSkills = []; if (c.scores) autoAssign(); for (const b of list.children) b.classList.toggle('on', b === e.currentTarget); fill();
    } }, k)));
    fill();
    return [h('div', { class: 'cc-split' }, list, h('div', null, h('label', null, 'Subclass'), subSel, preview))];
  }
  // ── 4. abilities ──
  function abilities() {
    const out = h('div');
    const redraw = () => out.replaceChildren(...inner());
    const roll = async () => {
      if (rolling) return; rolling = true;
      try {
        const r = await V.send({ t: 'statRoll', method: c.method, name: c.name.trim() });
        c.scores = r.scores; autoAssign(); redraw();
      } catch (e) { V.toast(e.message, true); }
      rolling = false;
    };
    const inner = () => {
      const methods = h('div', { class: 'cc-methods' },
        ...[['3d6', '3d6+2 each', 'A set that averages under 12 is rolled again'], ['4d6', '4d6, drop the lowest', 'Each score: four dice, the best three']].map(([k, n, d]) =>
          h('label', { class: 'cc-method' + (c.method === k ? ' on' : '') }, h('input', { type: 'radio', name: 'ccm', checked: c.method === k || null, disabled: !!c.scores || null, onchange: () => { c.method = k; redraw(); } }),
            h('b', null, n), h('span', { class: 'muted small' }, d))));
      if (!c.scores) return [methods, h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: roll }, '🎲 Roll the ability scores'),
        h('p', { class: 'muted small' }, 'The server rolls them and they go in the chat for everyone to see.')];
      const used = Object.values(c.assign);
      const rows = AB.map(k => {
        const sel = h('select', { onchange: e => {
          const v = +e.target.value, other = AB.find(x => x !== k && c.assign[x] === v);
          if (other) c.assign[other] = c.assign[k];   // swap with whoever had that score
          c.assign[k] = v; redraw();
        } }, ...c.scores.map((s, i) => h('option', { value: i, selected: c.assign[k] === i || null }, String(s))));
        const bonus = h('select', { onchange: e => { c.bonus[k] = +e.target.value; redraw(); } }, ...[-2, -1, 0, 1, 2].map(b => h('option', { value: b, selected: (+c.bonus[k] || 0) === b || null }, b ? sg(b) : '—')));
        const v = final(k);
        return h('tr', { class: (SAVES[c.cls] || []).includes(k) ? 'cc-save' : '' }, h('th', null, AB_NAME[k]), h('td', null, sel), h('td', null, bonus), h('td', { class: 'cc-total' }, String(v)), h('td', { class: 'cc-mod' }, sg(mod(v))));
      });
      const sum = c.scores.reduce((a, b) => a + b, 0), extra = AB.reduce((a, k) => a + (+c.bonus[k] || 0), 0);
      return [h('p', null, 'Rolled: ', h('b', null, c.scores.slice().sort((a, b) => b - a).join(', ')), h('span', { class: 'muted small' }, `  (average ${(sum / 6).toFixed(1)})`)),
        h('table', { class: 'cc-abil' }, h('tr', null, h('th'), h('th', null, 'Score'), h('th', { title: 'From the background or species: usually +2 and +1, or +1 three times' }, 'Bonus'), h('th', null, 'Total'), h('th', null, 'Mod')), ...rows),
        h('p', { class: 'muted small' }, `Pick which score goes where (two the same: they swap). Bonuses so far: ${sg(extra)}, usually +3 in all. `,
          h('a', { href: '#', onclick: e => { e.preventDefault(); autoAssign(); redraw(); } }, `Arrange them for a ${c.cls}`), '.'),
        V.isGM() ? h('p', { class: 'muted small' }, h('a', { href: '#', onclick: e => { e.preventDefault(); c.scores = null; c.assign = {}; redraw(); } }, 'Roll again'), ' (you’re the GM)') : null,
        h('p', null, `Hit points at level ${c.level}: `, h('b', null, String(hp())))];
    };
    redraw();
    return [out];
  }
  // ── 5. skills ──
  function skills() {
    const [n, from] = CLASS_SKILLS[c.cls] || [2, ALL_SKILLS.join(' ')];
    const pool = from.split(' ');
    const out = h('div');
    const redraw = () => {
      const box = (list, k, max, allowed) => {
        const on = list.includes(k), taken = (list === c.classSkills ? c.bgSkills : c.classSkills).includes(k);
        return h('label', { class: 'cc-skill' + (on ? ' on' : '') + (taken ? ' taken' : '') }, h('input', { type: 'checkbox', checked: on || null, disabled: taken || (!on && list.length >= max) || !allowed || null,
          onchange: e => { if (e.target.checked) list.push(k); else list.splice(list.indexOf(k), 1); redraw(); } }), SKILL_NAME[k]);
      };
      out.replaceChildren(
        h('h3', null, `${c.cls}: choose ${n}`), h('div', { class: 'cc-skills' }, ...pool.map(k => box(c.classSkills, k, n, true))),
        h('h3', null, `Background: any ${BACKGROUND_SKILLS}`), h('div', { class: 'cc-skills' }, ...ALL_SKILLS.map(k => box(c.bgSkills, k, BACKGROUND_SKILLS, true))),
        h('p', { class: 'muted small' }, `Saving throws: ${(SAVES[c.cls] || []).map(k => AB_NAME[k]).join(' and ')} (from the class).`));
    };
    redraw();
    return [out];
  }
  // ── 6. the level 0 feat ──
  function feat() {
    if (!feats.length) return [h('p', { class: 'muted' }, 'There are no feats to pick from yet: the GM can bring in a book with them (Spells tab › Import). Skip this for now and add one later by dragging it onto the sheet.')];
    const origin = feats.filter(isOrigin);
    const list = h('div', { class: 'cc-list' }), preview = h('div', { class: 'cc-preview' });
    const show = () => { const f = feats.find(x => x.id === c.feat); preview.replaceChildren(...(f ? [h('h3', null, f.name), f.prereq ? h('p', { class: 'muted small' }, 'Prerequisite: ' + f.prereq) : null, md(f.text)] : [h('p', { class: 'muted' }, 'Your free feat at level 0. Pick one to read it.')])); };
    const fill = () => {
      const shown = (origin.length && !c.allFeats ? origin : feats).slice().sort((a, b) => a.name.localeCompare(b.name));
      list.replaceChildren(...shown.map(f => h('button', { class: 'cc-pick' + (f.id === c.feat ? ' on' : ''), title: f.prereq ? 'Prerequisite: ' + f.prereq : '', onclick: e => {
        c.feat = f.id; for (const b of list.children) b.classList.toggle('on', b === e.currentTarget); show();
      } }, f.name, f.prereq ? h('span', { class: 'muted small' }, ' *') : null)));
    };
    fill(); show();
    return [origin.length ? h('label', { class: 'row', style: 'gap:6px;margin-bottom:6px' }, h('input', { type: 'checkbox', checked: c.allFeats || null, onchange: e => { c.allFeats = e.target.checked; fill(); } }),
      `Show every feat, not just the ${origin.length} origin feats`) : null, h('div', { class: 'cc-split' }, list, preview)];
  }
  // ── 7. done ──
  function done() {
    const fs = gained(), f = feats.find(x => x.id === c.feat), bg = bgs.find(b => b.name === c.background), bf = bg && bg.feat ? bg.feat : '';
    return [h('div', { class: 'cc-sum' },
      h('h3', null, c.name || 'Unnamed'),
      h('p', null, [c.race, `${c.cls} ${c.level}`, c.sub && c.level >= subLevel() ? c.sub : '', c.background].filter(Boolean).join(' · ')),
      h('p', null, AB.map(k => `${k.toUpperCase()} ${final(k)} (${sg(mod(final(k)))})`).join(' · ')),
      h('p', null, `${hp()} hit points · d${die()} hit dice · saves ${(SAVES[c.cls] || []).map(k => k.toUpperCase()).join(', ')}`),
      h('p', null, 'Skills: ' + (c.classSkills.concat(c.bgSkills).map(k => SKILL_NAME[k]).join(', ') || 'none')),
      h('p', null, 'Feat: ' + (f ? f.name : 'none') + (bf ? ` · from the background: ${bf}` : '')),
      h('p', { class: 'muted small' }, `Onto the sheet: ${fs.length + (f ? 1 : 0)} features and traits (${fs.map(shortName).concat(f ? [f.name] : []).join(', ')}).`),
      c.level >= subLevel() && !c.sub && subsOf(c.cls).length ? h('p', { class: 'muted small' }, 'No subclass picked: add its features later by dragging them onto the sheet.') : null,
      h('p', { class: 'muted small' }, 'Spells, equipment and anything else go on the sheet afterwards: drag spells and item cards onto it.'))];
  }

  async function make() {
    for (let i = 0; i < STEPS.length - 1; i++) { const b = blocker(i); if (b) { step = i; draw(); why.textContent = b; return; } }
    next.disabled = true;
    const f = feats.find(x => x.id === c.feat);
    const bg = bgs.find(b => b.name === c.background), bgf = bg && bg.feat ? (bgFeat(bg) ? { name: bg.feat, text: bgFeat(bg).text } : { name: bg.feat, text: `From the ${bg.name} background.` }) : null;
    const features = gained().map(x => ({ name: shortName(x), text: x.text, kind: x.kind })).concat(f ? [{ name: f.name, text: f.text, kind: 'feat' }] : [])
      .concat(bgf && (!f || f.name.toLowerCase() !== bgf.name.toLowerCase()) ? [{ name: bgf.name, text: bgf.text, kind: 'feat' }] : []);
    const abilitiesOut = {}; for (const k of AB) abilitiesOut[k] = final(k);
    try {
      const r = await V.send({ t: 'createChar5e', char: { name: c.name.trim(), sheet: c.sheet, level: c.level, cls: c.cls, sub: c.level >= subLevel() ? c.sub : '', race: c.race,
        background: c.background.trim(), abilities: abilitiesOut, saves: SAVES[c.cls] || [], skills: c.classSkills.concat(c.bgSkills), hp: hp(), features } });
      close();
      V.toast(`${c.name.trim()} is ready`);
      // open their sheet once they're in the Journal
      for (let i = 0; i < 40 && !(state.camp.characters || []).some(x => x.id === r.id); i++) await new Promise(res => setTimeout(res, 100));
      if (V.openSheet) V.openSheet(r.id);
    } catch (e) { V.toast(e.message, true); next.disabled = false; }
  }
  draw();
};
})();
