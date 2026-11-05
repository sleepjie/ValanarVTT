"""Build table/data/items-srd.json: every item in the D&D 5e System Reference Document 5.1 (weapons, armour,
adventuring gear, tools, mounts and vehicles, magic items) as one card each.

Source: the 5e-bits/5e-database repository (MIT), src/2014/en, which holds the SRD 5.1 text. The SRD 5.1 is
by Wizards of the Coast LLC under the Creative Commons Attribution 4.0 International licence.

    python build_items.py <5e-database>/src/2014/en <site>/table/data/items-srd.json
"""
import json, re, sys, os

src, out = sys.argv[1], sys.argv[2]
load = lambda n: json.load(open(os.path.join(src, n), encoding='utf-8'))
eq, mi, wp = load('5e-SRD-Equipment.json'), load('5e-SRD-Magic-Items.json'), load('5e-SRD-Weapon-Properties.json')
EQ = {e['index']: e for e in eq}

# short glosses of the weapon properties (our own wording; the full rules are in the SRD)
GLOSS = {
    'ammunition': 'Needs ammunition to fire; recover half after the fight.',
    'finesse': 'Use Strength or Dexterity to attack and for damage.',
    'heavy': 'Small creatures attack with it at disadvantage.',
    'light': 'Good for fighting with a weapon in each hand.',
    'loading': 'Fires once per action, bonus action or reaction.',
    'reach': 'Adds 5 feet to your reach when you attack with it.',
    'special': 'Has special rules: see below.',
    'thrown': 'Can be thrown for a ranged attack.',
    'two-handed': 'Needs two hands to attack with.',
    'versatile': 'Can be used with one or two hands.',
    'monk': None,
}

def cost(c):
    if not c: return ''
    q = c.get('quantity'); u = c.get('unit', 'gp')
    return f'{q:,} {u}' if isinstance(q, int) else f'{q} {u}'

def paras(lines):
    """SRD description lines → markdown: paragraphs, and tables with a header rule."""
    out, table = [], []
    def flush():
        if not table: return
        rows = table[:]
        if len(rows) < 2 or not re.match(r'^\|\s*:?-{2,}', rows[1]):
            cols = rows[0].count('|') - 1
            rows.insert(1, '|' + '---|' * max(1, cols))
        out.append('\n'.join(rows)); table.clear()
    for l in lines:
        l = l.strip()
        if not l: continue
        if l.startswith('|'): table.append(l); continue
        flush()
        out.append(l)
    flush()
    return '\n\n'.join(out)

def pick(name, rules, default):
    n = name.lower()
    for words, ic in rules:
        if any(re.search(r'\b' + w, n) for w in words.split()): return ic
    return default

WEAPON_ICONS = [('crossbow', 'crossbow'), ('bow', 'bow'), ('sling', 'sling'), ('dart javelin spear pike trident lance halberd glaive', 'spear'),
    ('dagger', 'dagger'), ('axe', 'axe'), ('hammer maul', 'hammer'), ('mace club flail morningstar', 'mace'), ('whip net', 'whip'),
    ('staff quarterstaff', 'staff'), ('sword scimitar rapier sickle blade vorpal', 'sword')]
WONDROUS = [('amulet necklace periapt medallion scarab brooch talisman', 'amulet'), ('cloak robe mantle cape', 'cloak'), ('boots slippers horseshoes', 'boots'),
    ('bag sack pouch quiver haversack', 'bag'), ('glove gauntlet bracer', 'gloves'), ('helm hat circlet headband crown', 'helm'), ('belt girdle', 'belt'),
    ('manual tome libram book', 'book'), ('stone gem pearl ioun jewel crystal', 'gem'), ('horn drum lyre pipes harp chime instrument fochlucan mac-fuirmidh doss canaith cli anstruth ollamh', 'instrument'),
    ('lantern candle lamp', 'lantern'), ('deck', 'cards'), ('figurine', 'figurine'), ('eyes goggles lenses', 'goggles'), ('carpet broom', 'carpet'),
    ('mirror', 'mirror'), ('orb sphere crystal ball', 'orb'), ('chest', 'chest'), ('rope', 'rope'), ('dust oil ointment', 'potion'), ('ring', 'ring'), ('shield', 'shield')]
GEAR = [('arrow bolt bullet needle', 'arrow'), ('torch', 'torch'), ('lantern lamp candle', 'lantern'), ('rope chain', 'rope'),
    ('vial flask potion oil acid antitoxin holy water perfume ink bottle', 'potion'), ('book spellbook', 'book'), ('paper parchment map scroll', 'scroll'),
    ('chest barrel crate case box', 'chest'), ('backpack sack pouch basket bag quiver', 'bag'), ('pack', 'bag'), ('tent bedroll blanket', 'tent'),
    ('manacles lock', 'chain'), ('crystal orb', 'orb'), ('wand', 'wand'), ('staff', 'staff'), ('rod', 'rod'), ('amulet emblem reliquary', 'amulet'),
    ('ring', 'ring'), ('mirror', 'mirror'), ('hammer pick shovel crowbar piton', 'tool'), ('clothes robe', 'cloak'), ('rations', 'food')]

items = []
def add(it):
    it = {k: v for k, v in it.items() if v not in (None, '', [], {})}
    items.append(it)

# ── mundane equipment
for e in eq:
    cat = e['equipment_category']['index']
    it = {'id': 'srd:' + e['index'], 'name': e['name'], 'rarity': 'mundane', 'cost': cost(e.get('cost')), 'weight': e.get('weight'),
          'text': paras(e.get('desc') or [])}
    if cat == 'weapon':
        props = [p['index'] for p in e.get('properties', [])]
        rng = e.get('range') or {}; thr = e.get('throw_range') or {}
        rtxt = f"{rng['normal']}/{rng['long']} ft" if rng.get('long') else ''
        names = []
        for p in props:
            if p == 'monk': continue
            n = next((x['name'] for x in wp if x['index'] == p), p.title())
            if p == 'thrown' and thr: n += f" ({thr['normal']}/{thr['long']} ft)"
            if p == 'ammunition' and rtxt: n += f' ({rtxt})'
            if p == 'versatile' and e.get('two_handed_damage'): n += f" ({e['two_handed_damage']['damage_dice']})"
            names.append(n)
        dmg = e.get('damage') or {}
        lines = [f'**{n}.** {GLOSS[p]}' for n, p in zip(names, [p for p in props if p != 'monk']) if GLOSS.get(p)]
        lines += e.get('special') or []
        it.update(kind='weapon', type=f"{e['category_range']} Weapon", text='\n\n'.join(lines),
                  icon=pick(e['name'], WEAPON_ICONS, 'sword'), props=names,
                  weapon={'damage': dmg.get('damage_dice', ''), 'dtype': (dmg.get('damage_type') or {}).get('name', '').lower(),
                          'range': rtxt or (f"{thr['normal']}/{thr['long']} ft" if thr else ''), 'ranged': e.get('weapon_range') == 'Ranged',
                          'finesse': 'finesse' in props})
        if 'net' in e['index']: it['weapon']['damage'] = ''
    elif cat == 'armor':
        ac = e['armor_class']; shield = e['armor_category'] == 'Shield'
        actxt = f"+{ac['base']}" if shield else str(ac['base']) + (' + Dex' + (f" (max {ac['max_bonus']})" if ac.get('max_bonus') else '') if ac.get('dex_bonus') else '')
        lines = []
        if e.get('str_minimum'): lines.append(f"**Strength {e['str_minimum']}.** Slower by 10 feet unless your Strength is {e['str_minimum']} or more.")
        if e.get('stealth_disadvantage'): lines.append('**Noisy.** Disadvantage on Dexterity (Stealth) checks.')
        it.update(kind='armor', type='Shield' if shield else f"{e['armor_category']} Armor", icon='shield' if shield else 'armor', ac=actxt, text='\n\n'.join(lines))
    elif cat == 'tools':
        it.update(kind='tool', type=e.get('tool_category', 'Tool'), icon='instrument' if 'Instrument' in e.get('tool_category', '') else pick(e['name'], [('dice playing', 'cards'), ('kit', 'bag')], 'tool'))
    elif cat == 'mounts-and-vehicles':
        vc = e.get('vehicle_category', '')
        sp = e.get('speed'); extra = []
        if sp: extra.append(f"**Speed.** {sp['quantity']} {sp['unit']}")
        if e.get('capacity'): extra.append(f"**Carrying capacity.** {e['capacity']}")
        it.update(kind='mount', type=vc or 'Mount', icon='ship' if 'Water' in vc else 'horse' if 'Mount' in vc else pick(e['name'], [('saddle bit bridle barding feed stabling', 'saddle')], 'cart'),
                  text='\n\n'.join(extra + ([it['text']] if it['text'] else [])))
    else:   # adventuring gear
        gc = (e.get('gear_category') or {}).get('name', 'Adventuring Gear')
        if e.get('contents'):
            it['text'] = 'Contains: ' + ', '.join((f"{c['quantity']} × " if c['quantity'] > 1 else '') + c['item']['name'] for c in e['contents']) + '.' + ('\n\n' + it['text'] if it['text'] else '')
        icon = {'Ammunition': 'arrow', 'Arcane Foci': 'orb', 'Druidic Foci': 'staff', 'Holy Symbols': 'amulet', 'Equipment Packs': 'bag'}.get(gc) or pick(e['name'], GEAR, 'pack')
        if gc == 'Arcane Foci': icon = pick(e['name'], [('wand', 'wand'), ('staff', 'staff'), ('rod', 'rod'), ('orb crystal', 'orb')], 'orb')
        if gc == 'Druidic Foci': icon = pick(e['name'], [('staff', 'staff'), ('wand', 'wand')], 'leaf')
        it.update(kind='gear', type=gc if gc != 'Standard Gear' else 'Adventuring Gear', icon=icon)
        if e.get('quantity', 1) > 1: it['type'] += f" · {e['quantity']}"
    add(it)

# ── magic items: the variants stand alone, so a "+1, +2 or +3" parent is left out
MI_KIND = {'potion': 'potion', 'ring': 'ring', 'wand': 'wand', 'staff': 'staff', 'rod': 'rod', 'scroll': 'scroll', 'ammunition': 'arrow'}
for m in mi:
    if m.get('variants'): continue
    desc = m.get('desc') or []
    head = desc[0] if desc else ''
    rar = m['rarity']['name'].lower()
    att = re.search(r'\(requires attunement([^)]*)\)', head)
    cat = m['equipment_category']['index']
    if cat == 'weapon': icon = pick(m['name'] + ' ' + head, WEAPON_ICONS, 'sword')
    elif cat == 'armor': icon = 'shield' if 'shield' in (m['name'] + head).lower() else 'armor'
    elif cat in MI_KIND: icon = MI_KIND[cat]
    else: icon = pick(m['name'], WONDROUS, 'sparkle')
    tline = re.sub(r'\s*\(requires attunement[^)]*\)', '', head)
    tline = re.sub(r',\s*(common|uncommon|rare|very rare|legendary|artifact|rarity varies)\b.*$', '', tline, flags=re.I).strip()
    add({'id': 'srd:' + m['index'], 'name': m['name'], 'kind': 'magic', 'type': tline[:1].upper() + tline[1:] if tline else m['equipment_category']['name'],
         'rarity': 'varies' if rar == 'varies' else rar, 'attune': (att.group(1).strip() or True) if att else None,
         'text': paras(desc[1:]), 'icon': icon})

items.sort(key=lambda x: (['weapon', 'armor', 'gear', 'tool', 'mount', 'magic'].index(x['kind']), x['name']))
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({'source': 'SRD 5.1', 'credit': 'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, https://creativecommons.org/licenses/by/4.0/legalcode.',
           'items': items}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(items), 'items', dict(Counter(i['kind'] for i in items)), dict(Counter(i['icon'] for i in items)))
