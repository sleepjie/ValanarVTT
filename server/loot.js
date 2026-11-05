/* Loot: what's in a chest, a barrel, a dead bandit's pockets. A loot table is
 *   { id, name, picks: '1d4' (how many draws), entries: [{ ref: 'srd:…' | 'camp:…', item?: {…}, w: weight, qty: '1' | '1d6' }],
 *     coins: { cp, sp, ep, gp, pp: dice } }
 * The presets are made from the SRD item cards (table/data/items-srd.json); the GM's own tables live in the campaign
 * (c.lootTables) and can draw on its homebrew cards too. Rolling one gives a list of { item, qty } to put in a container. */
'use strict';
const fs = require('fs');
const path = require('path');
const Dice = require('../table/shared/dice.js');

let srd = null;
function items() {
  if (!srd) { try { srd = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'table', 'data', 'items-srd.json'), 'utf8')).items || []; } catch (e) { srd = []; } }
  return srd;
}
const gpOf = cost => { const m = /([\d,.]+)\s*(cp|sp|ep|gp|pp)/i.exec(String(cost || '')); if (!m) return 0; return parseFloat(m[1].replace(/,/g, '')) * { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 }[m[2].toLowerCase()]; };
const COIN = { cp: 'Copper pieces', sp: 'Silver pieces', ep: 'Electrum pieces', gp: 'Gold pieces', pp: 'Platinum pieces' };
const coinItem = k => ({ id: 'coin:' + k, name: COIN[k], kind: 'treasure', type: 'Coins', rarity: 'mundane', gi: 'coins', weight: 0.02,
  text: `Coins: fifty to the pound. ${{ cp: 'A hundred to a gold piece', sp: 'Ten to a gold piece', ep: 'Two to a gold piece', gp: 'The coin most trade is reckoned in', pp: 'Worth ten gold pieces' }[k]}.` });
const TREASURE = [
  { id: 'gem:10', name: 'Gemstone (10 gp)', kind: 'treasure', type: 'Gem', rarity: 'mundane', gi: 'gems', cost: '10 gp', text: 'A small stone: azurite, banded agate, hematite, lapis lazuli, malachite, obsidian or turquoise.' },
  { id: 'gem:50', name: 'Gemstone (50 gp)', kind: 'treasure', type: 'Gem', rarity: 'mundane', gi: 'gems', cost: '50 gp', text: 'A fine stone: bloodstone, carnelian, chalcedony, citrine, jasper, moonstone, onyx or zircon.' },
  { id: 'gem:100', name: 'Gemstone (100 gp)', kind: 'treasure', type: 'Gem', rarity: 'mundane', gi: 'gems', cost: '100 gp', text: 'A precious stone: amber, amethyst, coral, garnet, jade, jet, pearl, spinel or tourmaline.' },
  { id: 'art:25', name: 'Art object (25 gp)', kind: 'treasure', type: 'Art object', rarity: 'mundane', gi: 'gem-pendant', cost: '25 gp', text: 'A silver ewer, a carved bone statuette, a small gold bracelet, cloth-of-gold vestments, a black velvet mask stitched with silver thread.' },
  { id: 'art:250', name: 'Art object (250 gp)', kind: 'treasure', type: 'Art object', rarity: 'mundane', gi: 'crown', cost: '250 gp', text: 'A gold ring set with bloodstones, a carved ivory statuette, a large gold bracelet, a silver necklace with a gemstone pendant, a bronze crown.' }
];
// the presets: which SRD cards each draws on
function presets() {
  const it = items();
  const pick = (f, w) => it.filter(f).map(x => ({ ref: x.id, w: w ? w(x) : 1, qty: '1' }));
  const named = (re, qty, w) => it.filter(x => re.test(x.name)).map(x => ({ ref: x.id, w: w || 1, qty: qty || '1' }));
  const tr = (ids, w) => TREASURE.filter(x => ids.includes(x.id)).map(x => ({ item: x, w: w || 1, qty: '1' }));
  return [
    { id: 'preset:clutter', name: 'Odds and ends', picks: '1d3', preset: true,
      entries: pick(x => x.kind === 'gear' && gpOf(x.cost) <= 2 && !/pack$/i.test(x.name)), coins: { cp: '1d10' } },
    { id: 'preset:bandit', name: 'A bandit’s stash', picks: '1d4', preset: true,
      entries: [...named(/^(Dagger|Shortsword|Club|Handaxe|Light crossbow|Crossbow bolt|Rope, hempen|Rations|Manacles|Waterskin|Torch|Crowbar)/i), ...tr(['gem:10', 'art:25'], 0.5)],
      coins: { sp: '2d10', gp: '1d6' } },
    { id: 'preset:adventurer', name: 'An adventurer’s leavings', picks: '1d4', preset: true,
      entries: [...named(/^(Torch|Rope, (hempen|silk)|Rations|Bedroll|Tinderbox|Waterskin|Healer's Kit|Lantern, hooded|Oil \(flask\)|Piton|Grappling hook|Crowbar|Backpack|Mess kit)/i), ...named(/^Potion of Healing$/, '1', 0.6)],
      coins: { gp: '1d10' } },
    { id: 'preset:armoury', name: 'An armoury rack', picks: '1d3', preset: true,
      entries: pick(x => (x.kind === 'weapon' || x.kind === 'armor') && x.rarity === 'mundane', x => x.kind === 'armor' ? 0.5 : 1) },
    { id: 'preset:alchemist', name: 'An alchemist’s shelf', picks: '1d4', preset: true,
      entries: [...named(/^(Acid \(vial\)|Alchemist's fire|Antitoxin|Holy water|Vial|Bottle, glass|Flask or tankard|Herbalism Kit|Perfume)/i),
        ...pick(x => /^Potion of/i.test(x.name) && (x.rarity === 'common' || x.rarity === 'uncommon'), () => 0.5)] },
    { id: 'preset:minor', name: 'A minor magic item', picks: '1', preset: true, entries: pick(x => x.kind === 'magic' && x.rarity === 'uncommon') },
    { id: 'preset:hoard', name: 'A rare hoard', picks: '1d2', preset: true,
      entries: [...pick(x => x.kind === 'magic' && x.rarity === 'rare'), ...tr(['gem:50', 'gem:100', 'art:250'], 1.5)], coins: { gp: '6d20', pp: '1d6' } },
    { id: 'preset:purse', name: 'A coin purse', picks: '0', preset: true, entries: [], coins: { cp: '3d6', sp: '2d6', gp: '1d4' } },
    // what a kind of room keeps (the map generator fills its chests and barrels from these)
    { id: 'preset:pantry', name: 'Kitchen stores', picks: '1d4', preset: true,
      entries: named(/^(Rations|Pot, iron|Jug or pitcher|Flask or tankard|Mess Kit|Cook's utensils|Soap|Candle|Oil \(flask\)|Waterskin|Sack|Bucket|Basket|Small knife)/i) },
    { id: 'preset:cellar', name: 'Cellar stores', picks: '1d3', preset: true,
      entries: named(/^(Rations|Jug or pitcher|Flask or tankard|Bottle, glass|Oil \(flask\)|Candle|Sack|Brewer's Supplies|Lamp|Torch|String)/i) },
    { id: 'preset:study', name: 'A scholar’s desk', picks: '1d3', preset: true,
      entries: [...named(/^(Book|Ink \(1 ounce bottle\)|Ink pen|Paper|Parchment|Sealing wax|Case, map or scroll|Hourglass|Magnifying glass|Abacus|Calligrapher's Supplies|Cartographer's Tools|Spyglass)/i),
        ...pick(x => /^Spell Scroll/i.test(x.name) && (x.rarity === 'common' || x.rarity === 'uncommon'), () => 0.3)], coins: { sp: '1d6' } },
    { id: 'preset:shrine', name: 'Temple offerings', picks: '1d3', preset: true,
      entries: [...named(/^(Holy water|Block of incense|Candle|Censer|Amulet|Emblem|Reliquary|Vestments|Alms box|Bell)/i), ...tr(['gem:10', 'art:25'], 0.5)], coins: { cp: '2d10', sp: '1d10' } },
    { id: 'preset:workshop', name: 'Tools and stock', picks: '1d3', preset: true,
      entries: [...pick(x => x.kind === 'tool' && /(Tools|Supplies)$/.test(x.name)), ...named(/^(Hammer|Spike, iron|Chain|Crowbar|Lock|Whetstone|Pick, miner's|Shovel|Block and tackle|Piton)/i)] },
    { id: 'preset:wardrobe', name: 'Personal belongings', picks: '1d3', preset: true,
      entries: [...named(/^(Clothes, (common|fine|traveler's)|Perfume|Mirror, steel|Signet ring|Blanket|Soap|Dice Set|Playing Card Set|Pouch|Book|Candle)/i), ...tr(['art:25'], 0.4)],
      coins: { sp: '1d10', gp: '1d4' } },
    { id: 'preset:tomb', name: 'Grave goods', picks: '1d3', preset: true,
      entries: [...tr(['gem:50', 'art:25'], 1.2), ...tr(['art:250'], 0.5), ...named(/^(Amulet|Signet ring|Reliquary|Emblem)/i), ...pick(x => x.kind === 'magic' && x.rarity === 'uncommon', () => 0.012)],
      coins: { sp: '3d10', gp: '2d10' } }
  ];
}
const roll = f => { const s = String(f == null ? '' : f).trim(); if (!s || s === '0') return 0; if (/^\d+$/.test(s)) return +s; try { return Math.max(0, Dice.roll(s).total); } catch (e) { return 0; } };
// a table's draws: [{ item, qty }]; find(ref) turns a reference into an item card
function rollTable(tb, find) {
  const out = [];
  const add = (item, qty) => { if (!item || qty <= 0) return; const same = out.find(e => e.item.id === item.id); if (same) same.qty += qty; else out.push({ item, qty }); };
  const entries = (tb.entries || []).map(e => ({ e, item: e.item || find(e.ref) })).filter(x => x.item && (+x.e.w || 0) > 0);
  const total = entries.reduce((s, x) => s + (+x.e.w || 0), 0);
  const n = Math.min(50, roll(tb.picks));
  for (let i = 0; i < n && total > 0; i++) {
    let r = Math.random() * total;
    for (const x of entries) { r -= +x.e.w || 0; if (r <= 0) { add(x.item, Math.max(1, roll(x.e.qty || '1'))); break; } }
  }
  for (const k of Object.keys(COIN)) { const q = tb.coins ? roll(tb.coins[k]) : 0; if (q > 0) add(coinItem(k), q); }
  return out;
}
const findSrd = ref => items().find(x => x.id === ref) || TREASURE.find(x => x.id === ref) || null;
module.exports = { presets, rollTable, findSrd, coinItem, TREASURE };
