/* Dice notation, shared by the server (which does the rolling) and the table (which explains it).
 *
 *   1d20+5          d20 plus five
 *   2d20kh1         keep the highest one (advantage); kl1 keeps the lowest (disadvantage)
 *   3d6kh2          2D6 advantage
 *   4d6k3           k is short for kh
 *   d%              a percentile die
 *   2d6+1d4-1 Fire  anything after the formula is a label
 *
 * roll(text, rng) returns { formula, label, total, parts: [{ dice: [{ v, kept }], sides, sign } | { n, sign }] }
 * or throws an Error with a readable message.
 */
(function (root) {
  'use strict';
  const MAX_DICE = 100, MAX_SIDES = 1000, MAX_TERMS = 20;

  function parse(text) {
    const src = String(text || '').trim();
    const m = /^([0-9dDkKhHlL%+\-\s]+?)(?:\s+(?![0-9+\-]|[dD](?:\d|%))(.*))?$/.exec(src) || [null, src, ''];
    let formula = (m[1] || '').replace(/\s+/g, '').toLowerCase(), label = (m[2] || '').trim();
    if (!formula) throw new Error('Nothing to roll');
    const terms = [];
    const re = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?|(\d+))/y;
    let i = 0;
    while (i < formula.length) {
      re.lastIndex = i;
      const t = re.exec(formula);
      if (!t || (!t[1] && terms.length)) throw new Error(`Can't read "${formula.slice(i)}"`);
      const sign = t[1] === '-' ? -1 : 1;
      if (t[6] != null) terms.push({ n: +t[6], sign });
      else {
        const count = t[2] === '' ? 1 : +t[2], sides = t[3] === '%' ? 100 : +t[3];
        if (count < 1 || count > MAX_DICE) throw new Error(`Between 1 and ${MAX_DICE} dice, please`);
        if (sides < 1 || sides > MAX_SIDES) throw new Error(`Dice need 1 to ${MAX_SIDES} sides`);
        let keep = null;
        if (t[4]) {
          const k = +t[5];
          if (k < 1 || k > count) throw new Error(`Can't keep ${k} of ${count} dice`);
          keep = { high: t[4] !== 'kl', n: k };
        }
        terms.push({ count, sides, keep, sign });
      }
      if (terms.length > MAX_TERMS) throw new Error('Too many terms');
      i = re.lastIndex;
    }
    return { formula: terms.map((t, j) => (t.sign < 0 ? '-' : j ? '+' : '') + (t.sides
      ? `${t.count}d${t.sides === 100 && /%/.test(formula) ? '%' : t.sides}${t.keep ? (t.keep.high ? 'kh' : 'kl') + t.keep.n : ''}`
      : t.n)).join(''), label, terms };
  }

  function roll(text, rng) {
    rng = rng || Math.random;
    const p = parse(text);
    let total = 0;
    const parts = p.terms.map(t => {
      if (!t.sides) { total += t.sign * t.n; return { n: t.n, sign: t.sign }; }
      const dice = Array.from({ length: t.count }, () => ({ v: 1 + Math.floor(rng() * t.sides), kept: true }));
      if (t.keep) {
        const order = dice.map((d, i) => i).sort((a, b) => t.keep.high ? dice[b].v - dice[a].v : dice[a].v - dice[b].v);
        order.slice(t.keep.n).forEach(i => { dice[i].kept = false; });
      }
      const sum = dice.reduce((s, d) => s + (d.kept ? d.v : 0), 0);
      total += t.sign * sum;
      return { sides: t.sides, sign: t.sign, dice, keep: t.keep ? (t.keep.high ? 'kh' : 'kl') + t.keep.n : null };
    });
    return { formula: p.formula, label: p.label, total, parts };
  }

  // Quick-roll buttons per game mode.
  // Quick-roll buttons per game mode. No advantage buttons: a d20 always shows two rolls (the left one is the roll),
  // and 2d6 always rolls a third die so advantage or disadvantage can be read straight off it.
  const PRESETS = {
    '5e': [
      { label: 'd20', f: '1d20', preset: 'pair', title: 'Two d20s side by side: the left one is your roll' },
      { label: 'd4', f: '1d4' }, { label: 'd6', f: '1d6' }, { label: 'd8', f: '1d8' }, { label: 'd10', f: '1d10' }, { label: 'd12', f: '1d12' }, { label: 'd%', f: '1d%' }
    ],
    '2d6': [
      { label: '2d6', f: '3d6', preset: 'three', title: 'The left two dice are your roll; the third shows advantage or disadvantage' },
      { label: 'd6', f: '1d6' }, { label: 'd66', f: '1d6', preset: 'pair', title: 'Two d6s side by side' }
    ]
  };
  const INIT_DIE = { '5e': '1d20', '2d6': '2d6' };

  const api = { parse, roll, PRESETS, INIT_DIE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Dice = api;
})(this);
