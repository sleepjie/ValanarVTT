/* Heraldry: a coat of arms for each nation, drawn as a shield (SVG) and told as a blazon.
 *
 * Arms are a small description: { field: { div, t1, t2 }, ord: { kind, t }, charge: { kind, t, n } }. Tinctures are
 * the heraldic ones (or, argent, gules, azure, vert, sable, purpure), or a colour of the nation's own ('#rrggbb').
 * A nation without arms of its own gets some made up from its name, in its colour, keeping the rule of tincture
 * (metal on colour, colour on metal); an admin can change them, or roll new ones, in Borders (the nation's panel).
 *
 * ValanarHeraldry = { make(seed, colour), svg(arms, opts), blazon(arms), editor(h, arms, onChange), DIVS, ORDS, CHARGES, TINCTURES } */
'use strict';
window.ValanarHeraldry = (function () {
  const TINCTURES = {
    or: { name: 'Or', c: '#d9b13b', metal: true }, argent: { name: 'Argent', c: '#f0eee6', metal: true },
    gules: { name: 'Gules', c: '#b3262b' }, azure: { name: 'Azure', c: '#2552a3' }, vert: { name: 'Vert', c: '#2d7a3b' },
    sable: { name: 'Sable', c: '#1e1c1a' }, purpure: { name: 'Purpure', c: '#6d2f7e' },
    // the rarer colours and the furs (the heraldry workshop has them; arms made up from a name never use them)
    tenne: { name: 'Tenné', c: '#c06a21' }, sanguine: { name: 'Sanguine', c: '#7a1f24' }, celeste: { name: 'Celeste', c: '#7fb2dc' },
    ermine: { name: 'Ermine', c: '#f4f1e8', fur: true }, vair: { name: 'Vair', c: '#5f7fb3', fur: true }
  };
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lum = c => { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const colourOf = t => TINCTURES[t] ? TINCTURES[t].c : /^#[0-9a-f]{6}$/i.test(t || '') ? t : '#888888';
  const isMetal = t => TINCTURES[t] ? !!TINCTURES[t].metal : lum(colourOf(t)) > 0.62;
  const isFur = t => !!(TINCTURES[t] && TINCTURES[t].fur);
  // shield shapes (all in the same 100 × 120 box, so the charges sit right in any of them)
  const SHAPES = {
    heater: { name: 'Heater', d: 'M4,4 H96 V54 C96,86 75,105 50,117 C25,105 4,86 4,54 Z' },
    french: { name: 'French', d: 'M4,4 H96 V92 C96,104 88,110 76,110 H62 Q53,110 50,118 Q47,110 38,110 H24 C12,110 4,104 4,92 Z' },
    kite: { name: 'Kite', d: 'M50,3 C80,3 97,14 97,34 C97,66 70,97 50,118 C30,97 3,66 3,34 C3,14 20,3 50,3 Z' },
    round: { name: 'Round', d: 'M50,12 A48,48 0 1,1 49.99,12 Z' },
    lozenge: { name: 'Lozenge', d: 'M50,2 L98,60 L50,118 L2,60 Z' },
    banner: { name: 'Banner', d: 'M4,4 H96 V116 H4 Z' }
  };
  // the nearest heraldic name for a colour of the nation's own (for the blazon)
  function nameOf(t) {
    if (TINCTURES[t]) return TINCTURES[t].name;
    const [r, g, b] = hex(t);
    let best = 'gules', bd = 1e9;
    for (const [k, v] of Object.entries(TINCTURES)) { const [r2, g2, b2] = hex(v.c); const d = (r - r2) ** 2 * 0.3 + (g - g2) ** 2 * 0.59 + (b - b2) ** 2 * 0.11; if (d < bd) { bd = d; best = k; } }
    return TINCTURES[best].name;
  }

  // ───────── the parts ─────────
  // the field, divided (or not); then an ordinary over it; then charges: all in a 100 × 120 box, cut to the shield
  const SHIELD = 'M4,4 H96 V54 C96,86 75,105 50,117 C25,105 4,86 4,54 Z';
  const DIVS = {
    plain: { name: '', draw: () => '' },
    pale: { name: 'Per pale', draw: c => `<rect x="50" y="0" width="50" height="120" fill="${c}"/>` },
    fess: { name: 'Per fess', draw: c => `<rect x="0" y="54" width="100" height="70" fill="${c}"/>` },
    bend: { name: 'Per bend', draw: c => `<polygon points="0,0 100,120 0,120" fill="${c}"/>` },
    bendsin: { name: 'Per bend sinister', draw: c => `<polygon points="100,0 100,120 0,120" fill="${c}"/>` },
    saltire: { name: 'Per saltire', draw: c => `<polygon points="0,0 50,58 0,120" fill="${c}"/><polygon points="100,0 50,58 100,120" fill="${c}"/>` },
    quarterly: { name: 'Quarterly', draw: c => `<rect x="50" y="0" width="50" height="54" fill="${c}"/><rect x="0" y="54" width="50" height="70" fill="${c}"/>` },
    chevron: { name: 'Per chevron', draw: c => `<polygon points="50,44 104,104 104,124 -4,124 -4,104" fill="${c}"/>` },
    paly: { name: 'Paly', draw: c => [1, 3, 5].map(i => `<rect x="${i * 100 / 6}" y="0" width="${100 / 6}" height="120" fill="${c}"/>`).join('') },
    barry: { name: 'Barry', draw: c => [1, 3, 5, 7].map(i => `<rect x="0" y="${i * 15}" width="100" height="15" fill="${c}"/>`).join('') },
    gyronny: { name: 'Gyronny', draw: c => { const cx = 50, cy = 56, R = 140; let s = ''; for (let k = 0; k < 8; k += 2) { const a0 = k * Math.PI / 4 - Math.PI / 2, a1 = a0 + Math.PI / 4; s += `<polygon points="${cx},${cy} ${(cx + R * Math.cos(a0)).toFixed(1)},${(cy + R * Math.sin(a0)).toFixed(1)} ${(cx + R * Math.cos(a1)).toFixed(1)},${(cy + R * Math.sin(a1)).toFixed(1)}" fill="${c}"/>`; } return s; } },
    bendy: { name: 'Bendy', draw: c => [-4, -2, 0, 2, 4].map(i => `<line x1="${-10 + i * 26}" y1="-10" x2="${110 + i * 26}" y2="130" stroke="${c}" stroke-width="13"/>`).join('') },
    lozengy: { name: 'Lozengy', draw: c => { let s = ''; for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) s += `<polygon points="${x * 20 + 10},${y * 24 - 12} ${x * 20 + 20},${y * 24} ${x * 20 + 10},${y * 24 + 12} ${x * 20},${y * 24}" fill="${c}"/>`; return s; } },
    chequy: { name: 'Chequy', draw: c => { let s = ''; for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) if ((x + y) % 2) s += `<rect x="${x * 20}" y="${y * 20}" width="20" height="20" fill="${c}"/>`; return s; } }
  };
  const ORDS = {
    none: { name: '', draw: () => '' },
    fess: { name: 'a fess', draw: c => `<rect x="0" y="42" width="100" height="26" fill="${c}"/>` },
    pale: { name: 'a pale', draw: c => `<rect x="37" y="0" width="26" height="120" fill="${c}"/>` },
    bend: { name: 'a bend', draw: c => `<line x1="-6" y1="-6" x2="106" y2="128" stroke="${c}" stroke-width="22"/>` },
    bendsin: { name: 'a bend sinister', draw: c => `<line x1="106" y1="-6" x2="-6" y2="128" stroke="${c}" stroke-width="22"/>` },
    chevron: { name: 'a chevron', draw: c => `<polyline points="-4,108 50,50 104,108" fill="none" stroke="${c}" stroke-width="20" stroke-linejoin="miter"/>` },
    cross: { name: 'a cross', draw: c => `<rect x="40" y="0" width="20" height="120" fill="${c}"/><rect x="0" y="45" width="100" height="20" fill="${c}"/>` },
    saltire: { name: 'a saltire', draw: c => `<line x1="-4" y1="-4" x2="104" y2="124" stroke="${c}" stroke-width="18"/><line x1="104" y1="-4" x2="-4" y2="124" stroke="${c}" stroke-width="18"/>` },
    chief: { name: 'a chief', draw: c => `<rect x="0" y="0" width="100" height="34" fill="${c}"/>` },
    bordure: { name: 'a bordure', draw: (c, shape) => `<path d="${shape || SHIELD}" fill="none" stroke="${c}" stroke-width="20"/>` },
    canton: { name: 'a canton', draw: c => `<rect x="0" y="0" width="40" height="40" fill="${c}"/>` },
    pall: { name: 'a pall', draw: c => `<polyline points="-4,-4 50,50 104,-4" fill="none" stroke="${c}" stroke-width="18"/><line x1="50" y1="48" x2="50" y2="124" stroke="${c}" stroke-width="18"/>` },
    pile: { name: 'a pile', draw: c => `<polygon points="18,0 82,0 50,98" fill="${c}"/>` }
  };
  // charges, each drawn in a 100 × 100 box
  const star = (n, r0, r1, cx = 50, cy = 52) => { let s = ''; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r1 : r0; s += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; } return s + 'Z'; };
  const rays = (n, r0, r1, w) => { let s = ''; for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n, b = a + w, c2 = a - w; s += `M${(50 + r0 * Math.cos(c2)).toFixed(1)},${(50 + r0 * Math.sin(c2)).toFixed(1)}L${(50 + r1 * Math.cos(a)).toFixed(1)},${(50 + r1 * Math.sin(a)).toFixed(1)}L${(50 + r0 * Math.cos(b)).toFixed(1)},${(50 + r0 * Math.sin(b)).toFixed(1)}Z`; } return s; };
  const CHARGES = {
    none: { name: '' },
    mullet: { name: 'mullet', pl: 'mullets', d: star(5, 46, 19) },
    sun: { name: 'sun in splendour', pl: 'suns in splendour', d: 'M50,27a23,23 0 1,0 0.01,0Z' + rays(16, 26, 47, 0.13) },
    crescent: { name: 'crescent', pl: 'crescents', d: 'M18.2,34.2 A38,38 0 1,0 81.8,34.2 A32,32 0 1,1 18.2,34.2 Z' },
    tower: { name: 'tower', pl: 'towers', d: 'M27,94 V42 H21 V22 H32 V31 H43 V22 H57 V31 H68 V22 H79 V42 H73 V94 Z M43,94 V76 A7,7 0 0,1 57,76 V94 Z M46,46 h8 v12 h-8 Z', rule: 'evenodd' },
    crown: { name: 'crown', pl: 'crowns', d: 'M14,72 L20,32 L35,52 L50,22 L65,52 L80,32 L86,72 Z M14,76 H86 V90 H14 Z M20,30m-5,0a5,5 0 1,0 10,0a5,5 0 1,0 -10,0 M50,20m-5,0a5,5 0 1,0 10,0a5,5 0 1,0 -10,0 M80,30m-5,0a5,5 0 1,0 10,0a5,5 0 1,0 -10,0' },
    key: { name: 'key', pl: 'keys', d: 'M50,4 A17,17 0 1,1 49.99,4 Z M50,13 A8,8 0 1,0 50.01,13 Z M45.5,36 H54.5 V96 H45.5 Z M54.5,72 H68 V80 H54.5 Z M54.5,86 H63 V94 H54.5 Z', rule: 'evenodd' },
    sword: { name: 'sword', pl: 'swords', d: 'M50,2 L56,14 V64 H44 V14 Z M28,64 H72 V71 H28 Z M45.5,71 H54.5 V88 H45.5 Z M50,88 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0' },
    tree: { name: 'tree', pl: 'trees', d: 'M45,58 H55 V86 L66,96 H34 L45,86 Z M50,8 a22,22 0 1,1 -0.01,0 Z M30,26 a17,17 0 1,1 -0.01,0 Z M70,26 a17,17 0 1,1 -0.01,0 Z M50,30 a20,20 0 1,1 -0.01,0 Z' },
    mountain: { name: 'mount', pl: 'mounts', d: 'M4,92 L30,44 L42,60 L60,22 L96,92 Z' },
    fleur: { name: 'fleur-de-lis', pl: 'fleurs-de-lis', d: 'M50,4 C38,20 36,40 45,58 L55,58 C64,40 62,20 50,4 Z M45,58 C36,58 20,52 18,38 C16,26 28,22 34,30 C28,30 26,40 34,46 C38,49 42,50 45,50 Z M55,58 C64,58 80,52 82,38 C84,26 72,22 66,30 C72,30 74,40 66,46 C62,49 58,50 55,50 Z M28,58 H72 V66 H28 Z M45,66 C42,78 34,84 26,82 C30,90 42,92 48,82 Z M55,66 C58,78 66,84 74,82 C70,90 58,92 52,82 Z M46,66 H54 L52,90 H48 Z' },
    rose: { name: 'rose', pl: 'roses', d: [0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5, x = 50 + 22 * Math.cos(a), y = 52 + 22 * Math.sin(a); return `M${(x - 20).toFixed(1)},${y.toFixed(1)}a20,20 0 1,0 40,0a20,20 0 1,0 -40,0Z`; }).join('') + star(5, 44, 30, 50, 52), inner: 'M50,42 a10,10 0 1,0 0.01,0Z' },
    anchor: { name: 'anchor', pl: 'anchors', d: 'M50,4 a9,9 0 1,1 -0.01,0 Z M50,10 a4,4 0 1,0 0.01,0 Z M46,20 H54 V86 H46 Z M30,28 H70 V35 H30 Z M14,58 L22,54 C24,74 36,84 50,86 C64,84 76,74 78,54 L86,58 L80,62 C78,82 64,96 50,96 C36,96 22,82 20,62 Z', rule: 'evenodd' },
    axe: { name: 'axe', pl: 'axes', d: 'M44,6 H52 V96 H44 Z M52,18 L60,20 C68,10 84,10 94,20 C88,34 88,52 94,68 C84,78 68,76 60,64 L52,66 Z M38,14 L44,16 V24 L38,26 Z' },
    ship: { name: 'lymphad', pl: 'lymphads', d: 'M6,66 H94 C88,82 76,90 50,90 C24,90 12,82 6,66 Z M48,10 H52 V66 H48 Z M52,14 C70,22 74,40 70,58 H52 Z M48,18 C34,26 30,42 34,58 H48 Z M52,8 L66,12 L52,16 Z' },
    eagle: { name: 'eagle displayed', pl: 'eagles displayed', d: 'M50,10 C56,10 58,16 58,20 L64,22 L58,25 C60,30 58,34 56,36 C70,26 84,18 96,20 C92,26 94,30 88,34 C92,38 88,42 82,44 C84,48 78,52 72,52 C66,54 62,54 58,56 C60,64 62,72 66,78 L72,94 L62,86 L58,96 L52,86 L50,96 L48,86 L42,96 L38,86 L28,94 L34,78 C38,72 40,64 42,56 C38,54 34,54 28,52 C22,52 16,48 18,44 C12,42 8,38 12,34 C6,30 8,26 4,20 C16,18 30,26 44,36 C42,34 40,30 42,25 C42,18 44,10 50,10 Z' }
  };
  Object.assign(CHARGES, {
    roundel: { name: 'roundel', pl: 'roundels', d: 'M50,12 a38,38 0 1,0 0.01,0Z' },
    annulet: { name: 'annulet', pl: 'annulets', d: 'M50,10 a40,40 0 1,0 0.01,0Z M50,26 a24,24 0 1,1 -0.01,0Z', rule: 'evenodd' },
    lozenge: { name: 'lozenge', pl: 'lozenges', d: 'M50,4 L80,50 L50,96 L20,50 Z' },
    heart: { name: 'heart', pl: 'hearts', d: 'M50,92 C30,74 8,58 8,36 C8,20 20,10 33,10 C42,10 47,15 50,22 C53,15 58,10 67,10 C80,10 92,20 92,36 C92,58 70,74 50,92 Z' },
    wheel: { name: 'wheel', pl: 'wheels', d: 'M50,6 a44,44 0 1,0 0.01,0Z M50,16 a34,34 0 1,1 -0.01,0Z M50,40 a10,10 0 1,0 0.01,0Z M47,16 H53 V40 H47Z M47,60 H53 V84 H47Z M16,47 H40 V53 H16Z M60,47 H84 V53 H60Z M24.5,28.7 L28.7,24.5 L45.7,41.5 L41.5,45.7Z M58.5,54.3 L54.3,58.5 L71.3,75.5 L75.5,71.3Z M71.3,24.5 L75.5,28.7 L58.5,45.7 L54.3,41.5Z M41.5,54.3 L45.7,58.5 L28.7,75.5 L24.5,71.3Z', rule: 'evenodd' },
    hammer: { name: 'hammer', pl: 'hammers', d: 'M18,10 H82 V34 H18 Z M44,34 H56 V96 H44 Z' },
    arrow: { name: 'arrow', pl: 'arrows', d: 'M50,2 L62,24 H54 V78 L62,90 V98 L50,88 L38,98 V90 L46,78 V24 H38 Z' },
    book: { name: 'book', pl: 'books', d: 'M8,22 C24,16 40,18 49,26 V88 C40,80 24,78 8,84 Z M51,26 C60,18 76,16 92,22 V84 C76,78 60,80 51,88 Z' },
    flame: { name: 'flame', pl: 'flames', d: 'M50,4 C62,22 80,34 80,60 C80,80 66,96 50,96 C34,96 20,80 20,60 C20,46 28,38 34,30 C34,44 40,52 46,54 C42,36 46,20 50,4 Z' },
    bell: { name: 'bell', pl: 'bells', d: 'M44,4 H56 V12 C72,16 78,30 78,48 C78,64 84,74 92,80 V86 H8 V80 C16,74 22,64 22,48 C22,30 28,16 44,12 Z M50,88 a8,8 0 1,0 0.01,0Z' },
    skull: { name: 'skull', pl: 'skulls', d: 'M50,6 C26,6 12,22 12,44 C12,58 20,66 28,70 V86 H40 V78 H46 V86 H54 V78 H60 V86 H72 V70 C80,66 88,58 88,44 C88,22 74,6 50,6 Z M34,38 a10,10 0 1,0 0.01,0Z M66,38 a10,10 0 1,0 0.01,0Z M50,56 L56,66 H44 Z', rule: 'evenodd' },
    pattee: { name: 'cross pattée', pl: 'crosses pattée', d: 'M38,6 H62 L56,40 L94,38 V62 L56,60 L62,94 H38 L44,60 L6,62 V38 L44,40 Z' },
    wolf: { name: 'wolf’s head erased', pl: 'wolves’ heads erased', d: 'M30,10 L40,30 C46,28 54,28 60,30 L70,10 L76,36 C86,44 92,54 94,64 L72,66 L80,76 C70,80 60,78 54,74 L50,94 L42,82 L34,90 L32,76 C22,70 16,62 16,50 C16,40 22,32 26,30 Z M56,44 a4,4 0 1,0 0.01,0Z', rule: 'evenodd' }
  });
  // what kind of thing each is (the workshop sorts them so), and the many more from app/heraldry-charges.js
  const CAT0 = { mullet: 'Signs', sun: 'Signs', crescent: 'Signs', tower: 'Things', crown: 'Signs', key: 'Things', sword: 'Arms & armour', tree: 'Plants',
    mountain: 'Things', fleur: 'Plants', rose: 'Plants', anchor: 'Things', axe: 'Arms & armour', ship: 'Things', eagle: 'Birds', roundel: 'Shapes',
    annulet: 'Shapes', lozenge: 'Shapes', heart: 'Signs', wheel: 'Things', hammer: 'Things', arrow: 'Arms & armour', book: 'Things', flame: 'Signs',
    bell: 'Things', skull: 'Signs', pattee: 'Shapes', wolf: 'Beasts' };
  for (const [k, c] of Object.entries(CAT0)) if (CHARGES[k]) CHARGES[k].cat = c;
  if (window.VALANAR_CHARGES) for (const [k, c] of Object.entries(window.VALANAR_CHARGES)) if (!CHARGES[k]) CHARGES[k] = c;
  const CATS = ['Beasts', 'Birds', 'Monsters', 'Sea & small', 'Plants', 'Arms & armour', 'Things', 'Signs', 'Shapes'];
  const ORDER = ['mullet', 'crescent', 'tower', 'crown', 'key', 'sword', 'tree', 'mountain', 'fleur', 'rose', 'anchor', 'axe', 'ship', 'eagle', 'sun'];
  // where the charges go, by the ordinary and how many
  function places(ord, n) {
    if (n <= 0) return [];
    const L = {
      none: { 1: [[50, 56, 60]], 2: [[29, 52, 34], [71, 52, 34]], 3: [[29, 34, 30], [71, 34, 30], [50, 80, 30]] },
      fess: { 1: [[50, 55, 22]], 2: [[30, 22, 24], [70, 22, 24]], 3: [[26, 55, 18], [50, 55, 18], [74, 55, 18]] },
      pale: { 1: [[50, 54, 22]], 2: [[20, 54, 22], [80, 54, 22]], 3: [[50, 22, 20], [50, 54, 20], [50, 86, 20]] },
      bend: { 1: [[72, 30, 24]], 2: [[72, 30, 24], [28, 86, 24]], 3: [[30, 36, 16], [50, 60, 16], [70, 84, 16]] },
      bendsin: { 1: [[28, 30, 24]], 2: [[28, 30, 24], [72, 86, 24]], 3: [[70, 36, 16], [50, 60, 16], [30, 84, 16]] },
      chevron: { 1: [[50, 86, 22]], 2: [[24, 26, 22], [76, 26, 22]], 3: [[24, 26, 22], [76, 26, 22], [50, 90, 22]] },
      cross: { 1: [[50, 55, 18]], 2: [[25, 24, 20], [75, 24, 20]], 3: [[25, 24, 20], [75, 24, 20], [50, 90, 16]] },
      saltire: { 1: [[50, 58, 18]], 2: [[50, 22, 18], [50, 96, 14]], 3: [[50, 22, 18], [16, 58, 16], [84, 58, 16]] },
      chief: { 1: [[50, 17, 24]], 2: [[30, 17, 22], [70, 17, 22]], 3: [[22, 17, 20], [50, 17, 20], [78, 17, 20]] },
      bordure: { 1: [[50, 56, 48]], 2: [[33, 54, 26], [67, 54, 26]], 3: [[34, 38, 22], [66, 38, 22], [50, 76, 22]] },
      pile: { 1: [[50, 34, 26]], 2: [[50, 24, 18], [50, 56, 16]], 3: [[50, 18, 16], [50, 44, 14], [50, 68, 10]] },
      canton: { 1: [[20, 20, 26]], 2: [[72, 34, 30], [50, 82, 30]], 3: [[72, 28, 26], [28, 72, 26], [72, 82, 26]] },
      pall: { 1: [[50, 92, 22]], 2: [[18, 64, 20], [82, 64, 20]], 3: [[50, 14, 18], [18, 64, 20], [82, 64, 20]] }
    };
    return ((L[ord] || L.none)[Math.min(3, n)]) || [];
  }
  // a charge sits on the ordinary (and must stand out from it) when it's placed on it
  const onOrdinary = (ord, n) => ({ fess: n !== 2, pale: n !== 2, bend: n === 3, bendsin: n === 3, cross: n === 1, saltire: n === 1, chief: true, pile: true, canton: n === 1 })[ord] || false;

  // ───────── made up from a name ─────────
  function rng(seed) {
    let s = 0; for (const ch of String(seed)) s = (Math.imul(s ^ ch.charCodeAt(0), 2654435761) + 0x9e3779b9) | 0;
    return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const METALS = ['or', 'argent'], COLOURS = ['gules', 'azure', 'vert', 'sable', 'purpure'];
  function make(seed, own) {
    const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
    // the nation's colour as the field's colour (unless it's so pale it counts as a metal)
    const mine = /^#[0-9a-f]{6}$/i.test(own || '') ? own : pick(COLOURS);
    const metal = pick(METALS);
    const t1 = isMetal(mine) ? metal : mine, contra = t => isMetal(t) ? pick(COLOURS.filter(c => colourOf(c) !== colourOf(t))) : pick(METALS);
    const divs = ['plain', 'plain', 'plain', 'pale', 'fess', 'bend', 'quarterly', 'chevron', 'saltire', 'paly', 'barry', 'gyronny', 'chequy', 'bendsin'];
    const div = pick(divs);
    const t2 = div === 'plain' ? contra(t1) : isMetal(t1) ? pick(COLOURS) : metal;
    // a divided field takes a plain ordinary in a metal or colour against both; keep it simple and readable
    const ordKinds = div === 'plain' ? ['none', 'fess', 'pale', 'bend', 'chevron', 'cross', 'saltire', 'chief', 'bordure', 'pile', 'bendsin', 'none'] : ['none', 'none', 'none', 'chief', 'bordure', 'fess'];
    const ord = pick(ordKinds);
    const unlike = (...ts) => { const pool = METALS.concat(COLOURS).filter(t => !ts.some(x => colourOf(x) === colourOf(t))); return pool.length ? pool[Math.floor(r() * pool.length)] : 'or'; };
    const tOrd = ord === 'none' ? null : div === 'plain' ? contra(t1) : (isMetal(t1) && isMetal(t2) ? pick(COLOURS) : !isMetal(t1) && !isMetal(t2) ? metal : unlike(t1, t2, ...(isMetal(t1) ? [] : COLOURS.filter(c => c !== 'sable'))));
    const n = ord === 'none' ? pick([1, 1, 1, 2, 3]) : pick([0, 1, 1, 3, 3, 2]);
    const kind = n ? ORDER[Math.floor(r() * ORDER.length)] : 'none';
    const under = n && onOrdinary(ord, n) ? tOrd : t1;
    const tCh = !n ? null : (div !== 'plain' && !onOrdinary(ord, n)) ? (isMetal(t1) !== isMetal(t2) ? pick(isMetal(t1) ? COLOURS : METALS) : contra(t1)) : contra(under);
    return { field: { div, t1, t2 }, ord: { kind: ord, t: tOrd || 'or' }, charge: { kind: n ? kind : 'none', t: tCh || 'argent', n: n || 1 } };
  }

  // ───────── drawing ─────────
  let seq = 0;
  function svg(a, o) {
    o = o || {};
    if (!a || !a.field) return '';
    const id = 'ar' + (++seq);
    const F = a.field, O = a.ord || { kind: 'none' }, C = a.charge || { kind: 'none' };
    const div = DIVS[F.div] || DIVS.plain, ord = ORDS[O.kind] || ORDS.none, ch = CHARGES[C.kind] || CHARGES.none;
    const shape = (SHAPES[o.shape || a.shape] || SHAPES.heater).d;
    // a tincture as paint: a colour, or a fur's pattern
    const furs = new Set();
    const paint = t => { if (isFur(t)) { furs.add(t); return `url(#${id}${t})`; } return colourOf(t); };
    let s = `<rect x="0" y="0" width="100" height="120" fill="${paint(F.t1)}"/>` + div.draw(paint(F.t2));
    s += ord.draw(paint(O.t), shape);
    // (a charge's own box: 100 for the drawn ones, 512 for the pictures; it can be made bigger or smaller, and turned to face the other way)
    const unit = ch.box || 100, grow = Math.max(0.6, Math.min(1.4, +C.sz || 1));
    if (ch.d) for (const [cx, cy, size0] of places(O.kind, C.kind === 'none' ? 0 : (C.n || 1))) {
      const size = size0 * grow, k = size / unit;
      const flip = C.flip ? ` translate(${unit},0) scale(-1,1)` : '';
      s += `<g transform="translate(${(cx - size / 2).toFixed(1)},${(cy - size * 0.52).toFixed(1)}) scale(${k.toFixed(4)})${flip}"><path d="${ch.d}" fill="rgba(20,12,6,.7)" fill-rule="${ch.rule || 'nonzero'}" stroke="rgba(20,12,6,.7)" stroke-width="${(3 / k).toFixed(2)}" stroke-linejoin="round"/><path d="${ch.d}" fill="${paint(C.t)}" fill-rule="${ch.rule || 'nonzero'}"/>`
        + (ch.inner ? `<path d="${ch.inner}" fill="${isMetal(C.t) ? '#b3262b' : '#d9b13b'}" stroke="rgba(20,12,6,.55)" stroke-width="${(1.4 / k).toFixed(2)}"/>` : '') + '</g>';
    }
    const w = o.size || 60, hgt = Math.round(w * 1.2);
    return `<svg class="arms" viewBox="0 0 100 120" width="${w}" height="${hgt}" xmlns="http://www.w3.org/2000/svg" aria-label="${(o.label || blazon(a)).replace(/"/g, '&quot;')}">`
      + `<defs><clipPath id="${id}c"><path d="${shape}"/></clipPath>`
      + (furs.has('ermine') ? `<pattern id="${id}ermine" width="16" height="18" patternUnits="userSpaceOnUse"><rect width="16" height="18" fill="#f4f1e8"/><g fill="#1e1c1a"><path d="M8,3 l1.6,5 h-3.2z"/><circle cx="8" cy="3" r="1.1"/><circle cx="5.6" cy="5.4" r="1"/><circle cx="10.4" cy="5.4" r="1"/><path d="M0,12 l1.6,5 h-3.2z M16,12 l1.6,5 h-3.2z"/></g></pattern>` : '')
      + (furs.has('vair') ? `<pattern id="${id}vair" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#f0eee6"/><path d="M0,10 L3,4 V0 H17 V4 L20,10 Z" fill="#2552a3"/><path d="M-10,20 L-7,14 V10 H7 V14 L10,20 Z M10,20 L13,14 V10 H27 V14 L30,20 Z" fill="#2552a3"/></pattern>` : '')
      + `<radialGradient id="${id}g" cx="32%" cy="22%" r="85%"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></radialGradient></defs>`
      + `<g clip-path="url(#${id}c)">${s}<rect x="0" y="0" width="100" height="120" fill="url(#${id}g)"/></g>`
      + `<path d="${shape}" fill="none" stroke="#2a1a0e" stroke-width="3" stroke-linejoin="round"/></svg>`;
  }
  function blazon(a) {
    if (!a || !a.field) return '';
    const F = a.field, O = a.ord || { kind: 'none' }, C = a.charge || { kind: 'none' };
    const T = t => nameOf(t);
    let s = F.div && F.div !== 'plain' ? `${DIVS[F.div].name} ${T(F.t1)} and ${T(F.t2)}` : T(F.t1);
    const n = C.kind !== 'none' ? (C.n || 1) : 0, num = ['', 'a', 'two', 'three'][n] || n;
    const chName = n ? (n === 1 ? (/^[aeiou]/i.test(CHARGES[C.kind].name) ? 'an ' : 'a ') + CHARGES[C.kind].name : `${num} ${CHARGES[C.kind].pl}`) + (C.flip ? ' contourné' : '') : '';
    const on = n && onOrdinary(O.kind, n);
    if (O.kind === 'chief' || O.kind === 'bordure' || O.kind === 'canton') {
      // the field's charges first, then the chief or bordure (with what's on it)
      if (n && !on) s += `, ${chName} ${T(C.t)}`;
      s += `, ${ORDS[O.kind].name} ${T(O.t)}` + (on ? ` charged with ${chName} ${T(C.t)}` : '');
    } else if (O.kind !== 'none') {
      s += `, ${ORDS[O.kind].name} ${T(O.t)}`;
      if (n) s += on ? ` charged with ${chName} ${T(C.t)}` : n === 1 ? `, in ${O.kind === 'chevron' || O.kind === 'saltire' ? 'base' : 'chief'} ${chName} ${T(C.t)}` : ` between ${chName} ${T(C.t)}`;
    } else if (n) s += `, ${chName} ${T(C.t)}`;
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  // ───────── the editor (Borders › a nation, for admins) ─────────
  function editor(h, arms, onChange, opts) {
    opts = opts || {};
    const a = JSON.parse(JSON.stringify(arms));
    const pic = h('div', { class: 'armspic', html: svg(a, { size: 72 }) }), text = h('div', { class: 'blazon' }, blazon(a));
    const redraw = () => { pic.innerHTML = svg(a, { size: 72 }); text.textContent = blazon(a); };
    const commit = () => { redraw(); onChange(JSON.parse(JSON.stringify(a))); };
    const tinctSel = (get, set) => h('select', { onchange: e => { set(e.target.value); commit(); } },
      ...Object.entries(TINCTURES).map(([k, v]) => h('option', { value: k, selected: get() === k || null }, v.name)),
      opts.own ? h('option', { value: opts.own, selected: get() === opts.own || null }, 'Its colour') : null,
      !TINCTURES[get()] && get() !== opts.own ? h('option', { value: get(), selected: true }, 'Its old colour') : null);
    const sel = (list, get, set, blank) => h('select', { onchange: e => { set(e.target.value); commit(); } },
      ...Object.entries(list).map(([k, v]) => h('option', { value: k, selected: get() === k || null }, (k === 'none' || k === 'plain') ? blank : (v.name || k).replace(/^a /, ''))));
    return h('div', { class: 'armsed' },
      h('div', { class: 'armstop' }, pic, h('div', null, text,
        h('div', { class: 'btnrow', style: 'margin-top:6px' },
          h('button', { class: 'btn sm', title: 'Roll a new coat of arms', onclick: () => { const nb = make(Math.random().toString(36), opts.own); Object.assign(a, nb); commit(); } }, '⚄ New arms'),
          opts.onReset ? h('button', { class: 'btn sm', onclick: opts.onReset }, 'As it was made') : null))),
      h('div', { class: 'armsgrid' },
        h('label', null, 'Field'), sel(DIVS, () => a.field.div, v => { a.field.div = v; }, 'Plain'), tinctSel(() => a.field.t1, v => { a.field.t1 = v; }), tinctSel(() => a.field.t2, v => { a.field.t2 = v; }),
        h('label', null, 'Ordinary'), sel(ORDS, () => a.ord.kind, v => { a.ord.kind = v; }, 'None'), tinctSel(() => a.ord.t, v => { a.ord.t = v; }), h('span'),
        h('label', null, 'Charge'), sel(CHARGES, () => a.charge.kind, v => { a.charge.kind = v; }, 'None'), tinctSel(() => a.charge.t, v => { a.charge.t = v; }),
        h('select', { onchange: e => { a.charge.n = +e.target.value; commit(); } }, ...[1, 2, 3].map(n => h('option', { value: n, selected: (a.charge.n || 1) === n || null }, ['One', 'Two', 'Three'][n - 1])))));
  }
  return { make, svg, blazon, editor, DIVS, ORDS, CHARGES, CATS, TINCTURES, SHAPES, ORDER, isMetal, isFur, colourOf, onOrdinary };
})();
