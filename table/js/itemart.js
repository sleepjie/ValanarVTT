/* Pictures for item cards: one small illustration per kind of thing (a sword, a potion, a ring…), drawn here as
 * SVG so every card has art without any image files. Shapes use a few shared paints (metal, wood, leather, cloth,
 * glass, parchment, flame) and the card's own colour (--gem) for gems, liquids and magic.
 *
 * V.itemArt(key) → an <svg> element; V.itemArtURL(item) → a self-contained data: URL (for map tokens). */
'use strict';
(function () {
const O = 'stroke="#1c1712" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';
const M = `fill="url(#ia-metal)" ${O}`, W = `fill="url(#ia-wood)" ${O}`, Lth = `fill="url(#ia-leather)" ${O}`,
  G = `fill="url(#ia-gem)" ${O}`, C = `fill="url(#ia-cloth)" ${O}`, P = `fill="url(#ia-parch)" ${O}`, F = `fill="url(#ia-flame)" ${O}`,
  D = `fill="#2a231b" ${O}`, Gold = `fill="url(#ia-gold)" ${O}`, Line = `fill="none" ${O}`;
const shine = (d) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>`;
// weapons are drawn upright and turned to lie across the card
const tilt = s => `<g transform="rotate(40 32 32)">${s}</g>`;

const ART = {
  sword: tilt(`<path d="M32 3l4 6v33h-8V9z" ${M}/>${shine('M33.5 9v31')}<path d="M19 42h26v5H19z" ${Gold}/><path d="M29.5 47h5v10h-5z" ${Lth}/><circle cx="32" cy="59.5" r="3.3" ${Gold}/>`),
  dagger: tilt(`<path d="M32 12l3.5 5v20h-7V17z" ${M}/>${shine('M33.2 17v18')}<path d="M23 37h18l-2 4H25z" ${Gold}/><path d="M30 41h4v12h-4z" ${Lth}/><circle cx="32" cy="55.5" r="3" ${Gold}/>`),
  axe: tilt(`<path d="M30.5 6h3.5v54h-3.5z" ${W}/><path d="M34 9c12-3 21 5 21 16-8-3-14-2-21 2z" ${M}/>${shine('M37 12c7-1 12 2 14.5 7')}<path d="M30.5 13l-8 3 8 4z" ${M}/>`),
  hammer: tilt(`<path d="M30.5 16h3.5v44h-3.5z" ${W}/><path d="M17 6h30v13H17z" ${M}/>${shine('M19 9h26')}<path d="M29 19h6v4h-6z" ${D}/>`),
  mace: tilt(`<path d="M30.5 22h3.5v38h-3.5z" ${W}/><path d="M24 8l8-4 8 4 2 10-10 6-10-6z" ${M}/>${shine('M27 9l5-2.5')}<path d="M32 4v20M22 18l20-10M42 18L22 8" fill="none" stroke="#1c1712" stroke-width="1"/>`),
  spear: tilt(`<path d="M31 18h2.5v43H31z" ${W}/><path d="M32.2 2l5 12-5 6-5-6z" ${M}/>${shine('M33 7l2.5 7')}<path d="M29 20h7v3h-7z" ${Lth}/>`),
  whip: `<path d="M14 54c-6-8-2-22 12-26s26 4 22 14-18 8-18 0 10-10 18-4" fill="none" stroke="#1c1712" stroke-width="5" stroke-linecap="round"/><path d="M14 54c-6-8-2-22 12-26s26 4 22 14-18 8-18 0 10-10 18-4" fill="none" stroke="url(#ia-leather)" stroke-width="3" stroke-linecap="round"/><path d="M10 52l8 4-3 6-8-4z" ${Lth}/>`,
  bow: `<path d="M18 4c26 10 26 46 0 56" fill="none" stroke="#1c1712" stroke-width="6.5" stroke-linecap="round"/><path d="M18 4c26 10 26 46 0 56" fill="none" stroke="url(#ia-wood)" stroke-width="4" stroke-linecap="round"/><path d="M18 4v56" fill="none" stroke="#e8dcc0" stroke-width="1.1"/><path d="M33 28h5v8h-5z" ${Lth}/><path d="M8 32h40" fill="none" stroke="#1c1712" stroke-width="1.6"/><path d="M48 32l-6-3v6z" ${M}/><path d="M8 32l-3-3M8 32l-3 3" fill="none" stroke="#a33" stroke-width="2"/>`,
  crossbow: `<path d="M29.5 14h5v46h-5z" ${W}/><path d="M7 22c8-9 42-9 50 0" fill="none" stroke="#1c1712" stroke-width="6" stroke-linecap="round"/><path d="M7 22c8-9 42-9 50 0" fill="none" stroke="url(#ia-metal)" stroke-width="3.5" stroke-linecap="round"/><path d="M7 22l25 9 25-9" fill="none" stroke="#e8dcc0" stroke-width="1.1"/><path d="M32 4v26" fill="none" stroke="#1c1712" stroke-width="2.4"/><path d="M32 2l-3 5h6z" ${M}/><path d="M28 40h8v4h-8z" ${M}/>`,
  sling: `<path d="M10 8c10 10 14 24 20 34M54 8c-10 10-14 24-20 34" fill="none" stroke="#6b4a2a" stroke-width="2.2"/><path d="M24 42c4 10 12 10 16 0z" ${Lth}/><circle cx="32" cy="38" r="5" fill="#8d8a80" ${O}/>`,
  staff: tilt(`<path d="M30.6 14h3v48h-3z" ${W}/><circle cx="32" cy="9" r="7" ${G}/>${shine('M29 6.5a4 4 0 0 1 4-2')}<path d="M27 14c2 3 8 3 10 0" fill="none" stroke="#1c1712" stroke-width="1.6"/><path d="M29 14h6v3h-6z" ${Gold}/>`),
  wand: tilt(`<path d="M31 14h2.4v44H31z" ${W}/><path d="M30.4 50h3.6v8h-3.6z" ${Gold}/><path d="M32 2l2.2 6.5 6.8.5-5.3 4.2 1.8 6.6L32 16l-5.5 3.8 1.8-6.6L23 9l6.8-.5z" ${G}/>`),
  rod: tilt(`<path d="M30.5 16h3.5v44h-3.5z" ${M}/><path d="M24 6h16l-3 12h-10z" ${Gold}/><circle cx="32" cy="11" r="3.5" ${G}/><path d="M28 34h8v4h-8zM28 46h8v4h-8z" ${Gold}/>`),
  arrow: tilt(`<path d="M31.2 10h2v44h-2z" ${W}/><path d="M32.2 1l5 10h-10z" ${M}/><path d="M32.2 46l-5 6v8l5-5 5 5v-8z" fill="#e9e1cf" ${O}/>`),
  shield: `<path d="M32 4l24 7c0 25-8 41-24 49C16 52 8 36 8 11z" ${M}/><path d="M32 10l18 5c0 19-6 32-18 38-12-6-18-19-18-38z" ${W}/><path d="M32 10v43M14.5 22h35" fill="none" stroke="url(#ia-gold)" stroke-width="3"/><circle cx="32" cy="27" r="5.5" ${G}/>${shine('M12 13c3 0 6-1 9-2')}`,
  armor: `<path d="M19 9l8-4c1 6 9 6 10 0l8 4 9 14-8 5v27c-7 5-27 5-34 0V28l-8-5z" ${M}/><path d="M32 12v44" fill="none" stroke="#1c1712" stroke-width="1.4"/><path d="M19 36c8 3 18 3 26 0M19 46c8 3 18 3 26 0" fill="none" stroke="#1c1712" stroke-width="1.2" stroke-opacity=".7"/>${shine('M23 14c-1 6-1 14 0 20')}<circle cx="32" cy="22" r="3.6" ${G}/>`,
  helm: `<path d="M12 38c0-19 9-29 20-29s20 10 20 29v12H41V38H23v12H12z" ${M}/><path d="M30 22h4v18h-4z" ${D}/><path d="M17 30h12M35 30h12" fill="none" stroke="#1c1712" stroke-width="2.6"/>${shine('M18 24c2-6 6-10 11-11')}<path d="M32 9c0-4 0-6 2-7" fill="none" stroke="url(#ia-cloth)" stroke-width="4" stroke-linecap="round"/>`,
  potion: `<path d="M27 5h10v5h-1.5v9c8 3 13 10 13 19 0 11-8 20-16.5 20S15.5 49 15.5 38c0-9 5-16 13-19v-9H27z" fill="#cfe3ea" fill-opacity=".3" ${O}/><path d="M17.5 36c4 2 9 2 14 0s9-2 15 0c.5 10-6 19.5-14.5 19.5S17 46 17.5 36z" ${G}/><path d="M26.5 2h11v5h-11z" ${W}/>${shine('M22 31c-2 3-3 7-2 11')}<circle cx="38" cy="44" r="1.6" fill="#fff" fill-opacity=".7"/><circle cx="34" cy="49" r="1" fill="#fff" fill-opacity=".6"/>`,
  ring: `<ellipse cx="32" cy="38" rx="17" ry="15" fill="none" stroke="#1c1712" stroke-width="9"/><ellipse cx="32" cy="38" rx="17" ry="15" fill="none" stroke="url(#ia-gold)" stroke-width="6"/>${shine('M18 32c2-5 6-8 11-9')}<path d="M24 22l8-14 8 14-8 6z" ${G}/><path d="M24 22h16M32 8v20" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>`,
  amulet: `<path d="M14 4c0 18 6 26 18 26S50 22 50 4" fill="none" stroke="#1c1712" stroke-width="4"/><path d="M14 4c0 18 6 26 18 26S50 22 50 4" fill="none" stroke="url(#ia-gold)" stroke-width="2" stroke-dasharray="3 1.5"/><circle cx="32" cy="42" r="14" ${Gold}/><circle cx="32" cy="42" r="8.5" ${G}/>${shine('M27 37a7 7 0 0 1 6-3')}`,
  cloak: `<path d="M24 6h16l4 9c7 13 11 29 12 43H8c1-14 5-30 12-43z" ${C}/><path d="M26 15c-3 12-5 28-5 43M38 15c3 12 5 28 5 43" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1.6"/><path d="M24 6c2 6 14 6 16 0" fill="none" stroke="#1c1712" stroke-width="1.6"/><circle cx="32" cy="13" r="4.2" ${Gold}/><circle cx="32" cy="13" r="2" ${G}/>`,
  boots: `<path d="M12 6h16v32l14 6c6 2 10 6 10 12v2H12z" ${Lth}/><path d="M12 54h40v6H12z" ${D}/><path d="M12 12h16M12 20h16" fill="none" stroke="#1c1712" stroke-width="1.3"/><path d="M10 4h20v6H10z" ${C}/>`,
  gloves: `<path d="M18 58V34c-3-4-5-10-4-14 2-1 4 0 5 3l2 7V10c0-3 4-3 4 0v14V7c0-3 4-3 4 0v17V9c0-3 4-3 4 0v16V13c0-3 4-3 4 0v25c0 8-3 14-7 20z" ${Lth}/><path d="M17 50h22" fill="none" stroke="url(#ia-gold)" stroke-width="4"/><circle cx="28" cy="50" r="2.2" ${G}/>`,
  belt: `<path d="M4 26h56v12H4z" ${Lth}/><path d="M22 22h16v20H22z" ${Gold}/><path d="M26 26h8v12h-8z" ${D}/><path d="M30 32h12" fill="none" stroke="url(#ia-metal)" stroke-width="2.6"/><circle cx="12" cy="32" r="1.8" fill="#1c1712"/><circle cx="50" cy="32" r="1.8" fill="#1c1712"/>`,
  bag: `<path d="M22 20c-9 9-12 23-6 33 5 6 27 6 32 0 6-10 3-24-6-33z" ${Lth}/><path d="M24 14c-4-4-1-9 3-7l5 6 5-6c4-2 7 3 3 7z" ${Lth}/><path d="M21 19c6 3 16 3 22 0" fill="none" stroke="url(#ia-gold)" stroke-width="3"/><circle cx="32" cy="38" r="4" ${G}/>${shine('M20 33c0-4 2-8 4-10')}`,
  pack: `<path d="M16 16c0-6 6-10 16-10s16 4 16 10v40c0 3-3 4-6 4H22c-3 0-6-1-6-4z" ${Lth}/><path d="M16 24h32v14H16z" ${Lth}/><path d="M22 38v20M42 38v20" fill="none" stroke="#1c1712" stroke-width="1.4"/><path d="M28 28h8v6h-8z" ${Gold}/><path d="M20 4h24v5H20z" fill="#9c8b6a" ${O}/>`,
  chest: `<path d="M8 28h48v28H8z" ${W}/><path d="M8 28c0-12 10-18 24-18s24 6 24 18z" ${W}/><path d="M8 28h48M14 13v43M50 13v43" fill="none" stroke="url(#ia-metal)" stroke-width="4"/><path d="M27 24h10v12H27z" ${Gold}/><circle cx="32" cy="30" r="2" fill="#1c1712"/>`,
  book: `<path d="M13 8h32a5 5 0 0 1 5 5v43H18a5 5 0 0 1-5-5z" ${Lth}/><path d="M18 51h32v5H18a2.5 2.5 0 0 1 0-5z" fill="#efe4c6" ${O}/><path d="M22 14h22v30H22z" fill="none" stroke="url(#ia-gold)" stroke-width="1.6"/><path d="M33 20l6 9-6 9-6-9z" ${G}/>`,
  scroll: `<path d="M16 12h32v40H16z" ${P}/><path d="M22 20h20M22 26h20M22 32h16M22 38h18" fill="none" stroke="#6b5434" stroke-width="1.4"/><rect x="11" y="6" width="42" height="9" rx="4.5" ${W}/><rect x="11" y="49" width="42" height="9" rx="4.5" ${W}/><circle cx="40" cy="44" r="4" ${G}/>`,
  gem: `<path d="M18 14h28l11 13-25 31L7 27z" ${G}/><path d="M7 27h50M18 14l7 13 7-13 7 13 7-13M25 27l7 31 7-31" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.1"/>${shine('M21 17l-5 8')}`,
  orb: `<circle cx="32" cy="28" r="20" ${G}/><circle cx="32" cy="28" r="20" fill="url(#ia-orbshade)"/>${shine('M20 20a14 14 0 0 1 9-8')}<path d="M18 50h28l-4 8H22z" ${Gold}/><path d="M22 46c5 3 15 3 20 0" fill="none" stroke="#1c1712" stroke-width="1.6"/>`,
  instrument: `<ellipse cx="25" cy="42" rx="15" ry="16" ${W}/><circle cx="25" cy="42" r="4.5" fill="#2a231b"/><path d="M32 30L52 7l4 4-20 25z" ${W}/><path d="M50 5l8 8-3 3-8-8z" ${Lth}/><path d="M19 52l31-41" fill="none" stroke="#efe4c6" stroke-width=".8"/><path d="M15 46h12" fill="none" stroke="#1c1712" stroke-width="2"/>`,
  lantern: `<path d="M26 4h12l2 5H24z" ${M}/><path d="M20 12h24l-2 6H22z" ${M}/><path d="M22 18h20v28H22z" fill="#ffd77a" fill-opacity=".85" ${O}/><path d="M28 40c-3-5 0-10 4-16 4 6 7 11 4 16-2 3-6 3-8 0z" ${F}/><path d="M22 18v28M42 18v28M32 18v28" fill="none" stroke="url(#ia-metal)" stroke-width="2.4"/><path d="M18 46h28v6H18z" ${M}/><path d="M28 1a4 4 0 0 1 8 0" fill="none" stroke="#1c1712" stroke-width="1.8"/>`,
  torch: tilt(`<path d="M30 24h4.5l-1 36h-2.5z" ${W}/><path d="M28 22h8.5v5H28z" fill="#6b5434" ${O}/><path d="M32.2 2c6 6 9 11 6 17-2 4-10 4-12 0-3-6 0-11 6-17z" ${F}/><path d="M32.2 10c3 3 4 6 2 9-1 1.5-3 1.5-4 0-2-3-1-6 2-9z" fill="#fff6c8"/>`),
  rope: `<ellipse cx="32" cy="36" rx="22" ry="17" fill="none" stroke="#1c1712" stroke-width="8"/><ellipse cx="32" cy="36" rx="22" ry="17" fill="none" stroke="#c6a26a" stroke-width="5.5" stroke-dasharray="3 2"/><ellipse cx="32" cy="36" rx="13" ry="10" fill="none" stroke="#1c1712" stroke-width="7"/><ellipse cx="32" cy="36" rx="13" ry="10" fill="none" stroke="#c6a26a" stroke-width="4.5" stroke-dasharray="3 2"/><path d="M50 26c4-8 8-14 10-20" fill="none" stroke="#c6a26a" stroke-width="4" stroke-linecap="round"/>`,
  chain: `<g fill="none" stroke-width="6" stroke="#1c1712"><ellipse cx="14" cy="18" rx="9" ry="6"/><ellipse cx="27" cy="27" rx="9" ry="6" transform="rotate(45 27 27)"/><ellipse cx="38" cy="38" rx="9" ry="6"/><ellipse cx="50" cy="48" rx="9" ry="6" transform="rotate(45 50 48)"/></g><g fill="none" stroke-width="3.4" stroke="url(#ia-metal)"><ellipse cx="14" cy="18" rx="9" ry="6"/><ellipse cx="27" cy="27" rx="9" ry="6" transform="rotate(45 27 27)"/><ellipse cx="38" cy="38" rx="9" ry="6"/><ellipse cx="50" cy="48" rx="9" ry="6" transform="rotate(45 50 48)"/></g>`,
  tool: tilt(`<path d="M30.5 14h3.5v46h-3.5z" ${W}/><path d="M14 6c8-2 28-2 36 0l-2 8c-8-3-24-3-32 0z" ${M}/>`) + `<g transform="rotate(-40 32 32)"><path d="M30.5 18h3.5v40h-3.5z" ${M}/><path d="M25 4c0 8 4 12 7 12s7-4 7-12l-4 3-3-3-3 3z" ${M}/></g>`,
  horse: `<path d="M22 58c0-12 2-20 8-26-6-2-14 2-18 6l-6-6c4-8 10-14 18-20l2-8 5 6c10 2 17 10 19 22 1 8 0 18-2 26z" fill="#8a5a36" ${O}/><path d="M28 10c6 2 12 8 16 16 2 6 3 12 2 20" fill="none" stroke="#2a1d12" stroke-width="5"/><circle cx="20" cy="22" r="1.8" fill="#1c1712"/><path d="M8 34l4-2" fill="none" stroke="#1c1712" stroke-width="1.4"/><path d="M16 26c4 2 10 2 14-2" fill="none" stroke="url(#ia-leather)" stroke-width="2.4"/>`,
  saddle: `<path d="M8 30c8-6 18-6 24 0 6-6 16-6 24 0l-4 10c-6-3-14-3-20 2-6-5-14-5-20-2z" ${Lth}/><path d="M14 22c2-6 6-8 10-8 2 6 4 10 8 12 4-2 6-6 8-12 4 0 8 2 10 8" ${Lth}/><path d="M30 42h4v12h-4z" ${Lth}/><path d="M26 54h12l-2 6h-8z" ${M}/>`,
  cart: `<path d="M6 24h44v18H6z" ${W}/><path d="M50 30h12" fill="none" stroke="#1c1712" stroke-width="3"/><path d="M6 30h44M6 36h44" fill="none" stroke="#1c1712" stroke-width="1" stroke-opacity=".6"/><circle cx="16" cy="48" r="10" ${W}/><circle cx="42" cy="48" r="10" ${W}/><path d="M16 38v20M6 48h20M42 38v20M32 48h20" fill="none" stroke="#1c1712" stroke-width="1.4"/><circle cx="16" cy="48" r="2.5" ${M}/><circle cx="42" cy="48" r="2.5" ${M}/>`,
  ship: `<path d="M4 40h56l-9 15H13z" ${W}/><path d="M31 4h3v36h-3z" ${W}/><path d="M34 6c14 6 18 20 10 30H34z" fill="#efe4c6" ${O}/><path d="M31 10c-10 6-14 16-10 26h10z" fill="#e4d6b4" ${O}/><path d="M33 4l10 3-10 3z" ${C}/><path d="M2 58c6-3 10-3 15 0s10 3 15 0 10-3 15 0 10 3 15 0" fill="none" stroke="#5b8fd1" stroke-width="2"/>`,
  cards: `<rect x="10" y="12" width="26" height="38" rx="3" transform="rotate(-14 23 31)" ${P}/><rect x="26" y="10" width="26" height="38" rx="3" transform="rotate(12 39 29)" fill="#f4ecd8" ${O}/><path d="M39 22l5 7-5 7-5-7z" ${G} transform="rotate(12 39 29)"/><circle cx="21" cy="30" r="5" ${G}/>`,
  figurine: `<path d="M16 50h32l-3 8H19z" ${M}/><path d="M22 50c-2-8 0-16 6-20-2-6 0-12 6-14 4 0 6 4 5 8 6 4 8 14 5 26z" fill="url(#ia-gem)" ${O}/><circle cx="35" cy="15" r="5" ${G}/>${shine('M27 32c-2 4-2 10-1 14')}`,
  goggles: `<circle cx="20" cy="32" r="11" ${G}/><circle cx="44" cy="32" r="11" ${G}/><circle cx="20" cy="32" r="11" fill="none" stroke="url(#ia-gold)" stroke-width="3"/><circle cx="44" cy="32" r="11" fill="none" stroke="url(#ia-gold)" stroke-width="3"/><path d="M31 31c1-2 1-2 2 0M9 30l-6-3M55 30l6-3" fill="none" stroke="#1c1712" stroke-width="2.4"/>${shine('M15 27a6 6 0 0 1 5-3')}${shine('M39 27a6 6 0 0 1 5-3')}`,
  carpet: `<path d="M6 18l52-6v32L6 50z" ${C}/><path d="M12 22l40-4.6v22.6L12 44z" fill="none" stroke="url(#ia-gold)" stroke-width="2"/><path d="M32 22l6 9-6 9-6-9z" ${G}/><path d="M6 18l-4 1M6 26l-4 1M6 34l-4 1M6 42l-4 1M6 50l-4 1M58 12l4-.5M58 20l4-.5M58 28l4-.5M58 36l4-.5M58 44l4-.5" stroke="#c9a45c" stroke-width="1.6"/>`,
  mirror: `<ellipse cx="32" cy="26" rx="16" ry="20" ${Gold}/><ellipse cx="32" cy="26" rx="12" ry="16" fill="#cfe3ea" ${O}/><ellipse cx="32" cy="26" rx="12" ry="16" fill="url(#ia-gem)" fill-opacity=".35"/>${shine('M25 18c1-4 3-7 6-8')}<path d="M29 46h6v14h-6z" ${Gold}/>`,
  tent: `<path d="M32 6L4 56h56z" fill="#c9b48a" ${O}/><path d="M32 6l-8 50h16z" fill="#2a231b" ${O}/><path d="M32 6l-6 50" fill="none" stroke="#efe4c6" stroke-width="1.2"/><path d="M32 6V2" fill="none" stroke="#6b4a2a" stroke-width="2.5"/><path d="M2 58h60" fill="none" stroke="#1c1712" stroke-width="2"/>`,
  food: `<path d="M8 40c0-12 10-20 24-20s24 8 24 20c0 6-4 10-10 10H18c-6 0-10-4-10-10z" fill="#c8893f" ${O}/><path d="M20 28l4 8M30 24l3 9M40 26l3 8" fill="none" stroke="#7a4a1c" stroke-width="2"/>${shine('M14 34c2-5 6-8 11-10')}`,
  leaf: `<path d="M32 58C10 46 8 22 20 8c6 8 22 8 26 2 10 18 8 40-14 48z" fill="#5f9a4a" ${O}/><path d="M32 58C30 40 30 24 26 14M31 40l-9-6M31 32l8-8M30 48l10-6" fill="none" stroke="#2c4a22" stroke-width="1.6"/>`,
  sparkle: `<path d="M32 4l5 18 18 5-18 5-5 18-5-18-18-5 18-5z" ${G}/><path d="M50 40l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM14 42l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" ${G}/>${shine('M30 14l-2 8')}`,
  coin: `<ellipse cx="26" cy="40" rx="17" ry="9" ${Gold}/><ellipse cx="26" cy="36" rx="17" ry="9" ${Gold}/><ellipse cx="38" cy="26" rx="17" ry="9" ${Gold}/><ellipse cx="38" cy="22" rx="17" ry="9" ${Gold}/><path d="M32 22h12M38 17v10" fill="none" stroke="#7a5a1c" stroke-width="1.6"/>`,
};
const DEFS = `<defs>
<linearGradient id="ia-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f4f0"/><stop offset=".45" stop-color="#a9adb3"/><stop offset=".55" stop-color="#cfd2d6"/><stop offset="1" stop-color="#5c6168"/></linearGradient>
<linearGradient id="ia-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#d4a03c"/><stop offset="1" stop-color="#7a5418"/></linearGradient>
<linearGradient id="ia-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a3a1e"/><stop offset=".5" stop-color="#9a6a3c"/><stop offset="1" stop-color="#4a2e16"/></linearGradient>
<linearGradient id="ia-leather" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3714a"/><stop offset="1" stop-color="#5a361c"/></linearGradient>
<linearGradient id="ia-parch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6ecd2"/><stop offset="1" stop-color="#d9c398"/></linearGradient>
<radialGradient id="ia-flame" cx=".5" cy=".75" r=".7"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffb43c"/><stop offset="1" stop-color="#d8431c"/></radialGradient>
<radialGradient id="ia-orbshade" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
</defs>`;
// the colours of each rarity: gems, liquids, cloth and magic take the card's colour
const GEMS = { mundane: ['#e8d9b0', '#9c7f52', '#4a3a22'], common: ['#f0f0ea', '#a8a8a0', '#4a4a44'], uncommon: ['#a8f0b0', '#3f9a50', '#123a1a'],
  rare: ['#a8d4ff', '#3b74c6', '#10284e'], 'very rare': ['#e2b8ff', '#8a4cc0', '#2c1048'], legendary: ['#ffe0a0', '#e0882a', '#5a2a08'],
  artifact: ['#ffb0a0', '#c03a2a', '#4a0e08'], varies: ['#a8f0e8', '#2a9a8a', '#0a3a34'] };
const rk = r => (GEMS[r] ? r : 'mundane').replace(' ', '-');
const tinted = (r, suffix) => {
  const [hi, mid, lo] = GEMS[r] || GEMS.mundane, k = rk(r) + (suffix || '');
  const cloth = r === 'mundane' || !GEMS[r] ? ['#b25a4a', '#4a1c16'] : [mid, lo];
  return `<linearGradient id="ia-gem-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>`
    + `<linearGradient id="ia-cloth-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${cloth[0]}"/><stop offset="1" stop-color="${cloth[1]}"/></linearGradient>`;
};
const forRarity = (svg, r) => svg.replace(/url\(#ia-(gem|cloth)\)/g, (m, k) => `url(#ia-${k}-${rk(r)})`);
// the gradients once, for every card on the page
const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
host.setAttribute('width', '0'); host.setAttribute('height', '0'); host.setAttribute('aria-hidden', 'true');
host.style.position = 'absolute';
host.innerHTML = DEFS.replace('</defs>', Object.keys(GEMS).map(r => tinted(r)).join('') + '</defs>');
(document.body ? Promise.resolve() : new Promise(r => document.addEventListener('DOMContentLoaded', r))).then(() => document.body.prepend(host));

// ───────── game-icons.net pictures (data/gameicons.js), coloured by what the thing is ─────────
// items: metal for weapons and armour, bronze for gear and tools, the rarity's colour for magic; spells: their school's
const SCHOOLS = { abjuration: ['#d6ecff', '#4f8fd6', '#123056'], conjuration: ['#fff0bf', '#e0a43a', '#5a3608'], divination: ['#ffffff', '#b9c6d8', '#3e4a5e'],
  enchantment: ['#ffd6ef', '#d0569c', '#4e1036'], evocation: ['#ffd9b0', '#e2582c', '#5a1406'], illusion: ['#ecd6ff', '#9a5ad6', '#2e1050'],
  necromancy: ['#d8f0c0', '#6c9a48', '#1a2a10'], transmutation: ['#c8f5ea', '#2fa58c', '#0a3a30'] };
V.SPELL_SCHOOLS = SCHOOLS;
const PALETTES = Object.assign({ metal: ['#ffffff', '#b8bcc2', '#545a62'], warm: ['#fbecc4', '#c9984c', '#5e3c16'], blood: ['#ffc4b8', '#d0342c', '#4e0a08'] },
  Object.fromEntries(Object.entries(GEMS).map(([k, v]) => ['r-' + k.replace(' ', '-'), v])),
  Object.fromEntries(Object.entries(SCHOOLS).map(([k, v]) => ['s-' + k, v])));
const grad = k => { const [a, b, c] = PALETTES[k] || PALETTES.warm; return `<linearGradient id="gi-${k}" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`; };
host.innerHTML = host.innerHTML.replace('</defs>', Object.keys(PALETTES).map(grad).join('') + '</defs>');
const GI = () => window.GAME_ICONS || {};
V.hasGameIcon = name => !!GI()[name];
V.gameIconNames = () => Object.keys(GI());
const paletteOf = it => it.gi === 'health-potion' ? 'blood' : it.school ? 's-' + it.school : it.rarity && it.rarity !== 'mundane' ? 'r-' + it.rarity.replace(' ', '-') : it.kind === 'weapon' || it.kind === 'armor' ? 'metal' : 'warm';
const giInner = (name, pal) => (GI()[name] || GI().sparkles || []).map(d => `<path d="${d}" fill="url(#gi-${pal})" stroke="#14110d" stroke-width="16" stroke-linejoin="round" paint-order="stroke"/>`).join('');
// a game icon as an <svg>: name, and palette (or an item/spell to choose one)
V.gameIcon = function (name, pal, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '-24 -24 560 560'); s.setAttribute('class', cls || 'iart gi');
  s.innerHTML = giInner(name, typeof pal === 'string' ? pal : paletteOf(pal || {}));
  return s;
};
// the picture for an item or spell card: its own picture, its game icon, or one of the drawings above
V.itemPic = function (it) {
  if (it.img) return h('img', { src: it.img, alt: '', draggable: 'false' });
  const gi = it.gi || (it.school ? V.spellIconName(it) : null);
  if (gi && GI()[gi]) return V.gameIcon(gi, it);
  return V.itemArt(it.icon || 'sparkle', it.rarity);
};
// a spell brought in later has no icon chosen: the same rules as tools/gameicons_rules.py
V.spellIconName = function (sp) {
  if (sp.gi && GI()[sp.gi]) return sp.gi;
  const R = window.GAME_ICON_RULES; if (!R) return 'magic-swirl';
  const n = String(sp.name || '').toLowerCase();
  for (const [p, i] of R.spell) if (new RegExp(p).test(n)) return i;
  for (const [k, i] of Object.entries(R.damage)) if (String(sp.damage || '').toLowerCase().includes(k)) return i;
  return R.school[sp.school] || 'magic-swirl';
};
// a game icon in the colour of the text around it (for buttons and tabs)
V.uiIcon = function (name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 512 512'); s.setAttribute('class', cls || 'uic'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = (GI()[name] || []).map(d => `<path d="${d}" fill="currentColor"/>`).join('');
  return s;
};
const { h } = V;
V.ITEM_ART = Object.keys(ART);
V.itemArt = function (key, rarity) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('class', 'iart');
  s.innerHTML = forRarity(ART[key] || ART.sparkle, rarity);
  return s;
};
V.ITEM_GEMS = GEMS;
const urlCache = new Map();
V.itemArtURL = function (item) {
  const gi = item.gi || (item.school ? V.spellIconName(item) : null);
  if (gi && GI()[gi]) {
    const pal = paletteOf(item), key = 'gi|' + gi + '|' + pal;
    if (urlCache.has(key)) return urlCache.get(key);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 592 592" width="256" height="256"><defs>${grad(pal)}</defs>${giInner(gi, pal)}</svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    urlCache.set(key, url);
    return url;
  }
  const key = (item.icon || 'sparkle') + '|' + (item.rarity || 'mundane');
  if (urlCache.has(key)) return urlCache.get(key);
  // a picture on its own: its own copy of the paints
  const defs = DEFS.replace('</defs>', tinted(item.rarity) + '</defs>');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 72 72" width="256" height="256">${defs}<g>${forRarity(ART[item.icon] || ART.sparkle, item.rarity)}</g></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  urlCache.set(key, url);
  return url;
};
})();
