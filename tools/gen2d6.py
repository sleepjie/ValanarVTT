"""Builds the 2D6 character sheet (Roll20 format: HTML, CSS, sheet worker, roll template) from the rules' data.

    python gen2d6.py 2d6data.json ../site/table/sheets/2d6
"""
import json, sys, html, os

data = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
E = lambda s: html.escape(str(s), quote=True)

# ───────────── rules data ─────────────
ATTRS = [('str', 'STR', 'Strength'), ('dex', 'DEX', 'Dexterity'), ('int', 'INT', 'Intellect'), ('cha', 'CHA', 'Charisma')]
SKILLS = [   # (category, name, attributes it can use) in the order of the printed sheet
    ('Physical', 'Athletics', ['str']), ('Physical', 'Acrobatics', ['dex']), ('Physical', 'Endurance', ['str']),
    ('Wilderness', 'Survival', ['int', 'str']), ('Wilderness', 'Animal Handling', ['cha']), ('Wilderness', 'Herblore', ['int']),
    ('Wilderness', 'Tracking', ['int']), ('Wilderness', 'Medicine', ['int']),
    ('Crafting', 'Blacksmithing', ['str', 'int']), ('Crafting', 'Alchemy', ['int']), ('Crafting', 'Tinkering', ['int', 'dex']),
    ('Crafting', 'Engineering', ['int']), ('Crafting', 'Tailoring', ['int', 'dex']),
    ('Social', 'Persuasion', ['cha']), ('Social', 'Deception', ['cha']), ('Social', 'Diplomacy', ['cha']),
    ('Social', 'Intimidation', ['str', 'cha']), ('Social', 'Performance', ['cha', 'dex']), ('Social', 'Bartering', ['cha', 'int']),
    ('Utility', 'Demolition', ['int']), ('Utility', 'Cooking', ['dex', 'int']), ('Utility', 'Appraisal', ['int']),
    ('Subterfuge', 'Stealth', ['dex']), ('Subterfuge', 'Sleight of Hand', ['dex']), ('Subterfuge', 'Security', ['dex']), ('Subterfuge', 'Forgery', ['dex', 'int']),
    ('Magical', 'Runecrafting', ['int']), ('Magical', 'Lore', ['int']), ('Magical', 'Enchanting', ['int']), ('Magical', 'Arcana', ['int']),
    ('Exploration', 'Perception', ['int']), ('Exploration', 'Investigation', ['int']), ('Exploration', 'Cartography', ['int', 'dex']), ('Exploration', 'Navigation', ['int']),
    ('Specialised', 'Mining', ['str', 'int']), ('Specialised', 'Sailing', ['dex', 'int']), ('Specialised', 'Horseriding', ['dex', 'str']),
]
LEFT_CATS = ['Physical', 'Wilderness', 'Crafting', 'Social']
RIGHT_CATS = ['Utility', 'Subterfuge', 'Magical', 'Exploration', 'Specialised']
key = lambda n: n.lower().replace(' ', '_')

RACES = {
    'Miren': {'label': 'Miren (Human)', 'traits': ['Adaptive Heritage: once per session, reroll a failed roll.', 'Versatile Training: one additional skill proficiency of your choice at character creation.']},
    'Dwarrow': {'label': 'Dwarrow (Dwarf)', 'traits': ['Stonebound Resilience: +2 TN while underground or in rocky environments.', 'Master Artisan: Advantage on crafting rolls (Blacksmithing, Tinkering).'], 'adv': ['blacksmithing', 'tinkering']},
    "Ende'hel": {'label': "Ende'hel (High Elf)", 'traits': ["Wisdom of the Serende'hel: +1 to Lore and Arcana rolls.", 'Radiant Barrier: +1 Defence against magical attacks.'], 'flat': {'lore': 1, 'arcana': 1}},
    'Mirenadriel': {'label': 'Mirenadriel (Half Elf)', 'traits': ['Keen Senses: Advantage on Perception rolls in natural environments.', 'Timeless Grace: +1 to Dexterity-based rolls.'], 'dexrolls': 1},
    'Enadriel': {'label': 'Enadriel (Dark Elf)', 'traits': ['Martial Prowess: once per encounter, teleport up to 10 feet to a shadowed location.', 'Sixth Sense: Advantage on Perception rolls.'], 'adv': ['perception']},
    'Orkryn': {'label': 'Orkryn (Orc)', 'traits': ['Brutal Strength: +1 to STR (max +6).', 'Natural Resilience: Advantage on Endurance rolls.'], 'adv': ['endurance'], 'attr': {'str': 1}},
    'Drakkahn': {'label': 'Drakkahn (Draconian)', 'traits': ['Draconic Breath: 1D6 elemental damage in a 15-foot cone (fire, ice, lightning or acid, chosen at creation).', 'Scaled Resilience: +1 base TN.'], 'tn': 1},
    'Kanin': {'label': 'Kanin (Rabbitkin)', 'traits': ['Long Jumper: Advantage on Acrobatics rolls; jump distance doubled.', 'Superior Hearing: Advantage on Tracking and Perception rolls.'], 'adv': ['acrobatics', 'tracking', 'perception']},
    'Glimmerhin': {'label': 'Glimmerhin (Gnome)', 'traits': ['Lateral Thinker: Advantage on Engineering and Tinkering rolls.', 'Stubborn Spirit: once per long rest, resist being frightened or charmed.'], 'adv': ['engineering', 'tinkering']},
    'Lithfolk': {'label': 'Lithfolk (Halfling)', 'traits': ['Shrewd Bargains: Advantage on (and against) Bartering checks.', 'Lucky Stars: once per session, reroll any failed roll (does not stack with the Lucky feat).'], 'adv': ['bartering']},
}
CLASSES = {
    'Fighter': {'skills': 'Athletics, Endurance, Acrobatics, Intimidation, Blacksmithing, Perception, Horseriding', 'weapons': ['l', 'm', 'h'], 'armour': ['light', 'medium', 'heavy', 'shield']},
    'Mage': {'skills': 'Spellcasting plus two of: Alchemy, Arcana, Lore, Investigation, Herblore, Appraisal', 'weapons': ['l', 'm'], 'armour': ['light', 'medium', 'shield'], 'spell': 1},
    'Cleric': {'skills': 'Spellcasting plus two of: Diplomacy, Lore, Perception, Persuasion, Medicine, Tailoring', 'weapons': ['l', 'm'], 'armour': ['light', 'medium', 'shield'], 'spell': 1},
    'Ranger': {'skills': 'Survival, Tracking, Animal Handling, Navigation, Stealth, Herblore', 'weapons': ['l', 'm'], 'armour': ['light', 'medium']},
    'Barbarian': {'skills': 'Athletics, Endurance, Intimidation, Tracking, Perception, Survival', 'weapons': ['l', 'm', 'h'], 'armour': ['light', 'medium']},
    'Rogue': {'skills': 'Stealth, Sleight of Hand, Deception, Acrobatics, Lockpicking, Perception', 'weapons': ['l', 'm'], 'armour': ['light']},
}
BACKGROUNDS = {
    'Alchemist': 'Alchemy, Arcana, Herblore', 'Apprentice': 'Tinkering, Lore, Arcana', 'Artisan': 'Tinkering, Bartering, Appraisal',
    'Beggar': 'Stealth, Persuasion, Sleight of Hand', 'Blacksmith': 'Blacksmithing, Endurance, Appraisal', 'Clergy': 'Lore, Persuasion, Arcana',
    'Entertainer': 'Performance, Persuasion, Acrobatics', 'Explorer': 'Cartography, Navigation, Perception', 'Farmer': 'Survival, Animal Handling, Cooking',
    'Herbalist': 'Herblore, Medicine, Survival', 'Hunter': 'Survival, Herblore, Tracking', 'Knight': 'Horseriding, Athletics, Diplomacy',
    'Mercenary': 'Athletics, Intimidation, Bartering', 'Merchant': 'Bartering, Appraisal, Persuasion', 'Miner': 'Mining, Endurance, Demolition',
    'Noble': 'Diplomacy, Persuasion, Horseriding', 'Nomad': 'Horseriding, Survival, Cartography', 'Outlander': 'Survival, Navigation, Athletics',
    'Sailor': 'Sailing, Navigation, Cartography', 'Scholar': 'Lore, Arcana, Investigation', 'Servant': 'Cooking, Persuasion, Endurance',
    'Soldier': 'Athletics, Endurance, Intimidation', 'Spy': 'Forgery, Deception, Investigation', 'Thief': 'Stealth, Sleight of Hand, Security',
    'Labourer': 'Engineering, Bartering, Endurance', 'Priest': 'Lore, Diplomacy, Medicine',
}
ARMOUR = [   # name, class, TN bonus, Dex cap (from the Armour table)
    ("Traveler's Clothes", 'light', 1, 3), ('Padded Jacket', 'light', 2, 3), ('Reinforced Clothing', 'light', 2, 3), ('Leather Armor', 'light', 2, 3),
    ('Quilted Vest', 'light', 3, 3), ('Studded Leather', 'light', 3, 3), ('Bone Armor', 'light', 3, 3), ('Shadowweave Armor', 'light', 2, 3),
    ('Hide Armor', 'medium', 3, 3), ('Chain Shirt', 'medium', 4, 3), ('Scale Mail', 'medium', 5, 2), ('Breastplate', 'medium', 5, 2), ('Brigandine', 'medium', 6, 1),
    ('Chainmail', 'heavy', 7, 1), ('Splint Armor', 'heavy', 8, 1), ('Plate Armor', 'heavy', 9, 0), ('Full Plate', 'heavy', 10, 0),
]
SHIELDS = [('Buckler', 1), ('Kite Shield', 2), ('Tower Shield', 4)]
SCHOOLS = ['Evocation', 'Illusion', 'Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Necromancy', 'Transmutation', 'Conjunctive', 'Miracle']
MISCAST = ['Void Backlash: the spell collapses inward. Take 1D6 Force damage per tier of the spell.', 'Mana Burn: lose an additional 1D6 SP.',
           'Wild Surge: the spell takes effect, but the GM chooses a new target or point of origin within range.', 'Sensory Bleed: you are Dazed until the end of your next turn.',
           'Nosebleed: you are Bleeding until you spend a Minor Action to staunch it.', 'Fizzle: a harmless shower of sparks. No further effect.']

# ───────────── HTML ─────────────
def pips(name, top, start=1, cls='sheet-pips', zero=True, default=None):
    """Radio pips that fill from the left: drawn right-to-left so CSS '~' can fill the lower ones."""
    s = f'<span class="{cls}">'
    for v in range(top, start - 1, -1):
        chk = ' checked' if default == v else ''
        s += f'<input type="radio" class="sheet-pip" name="attr_{name}" value="{v}" title="{v}"{chk}>'
    if zero:
        chk = ' checked' if default == 0 else ''
        s += f'<input type="radio" class="sheet-pip sheet-zero" name="attr_{name}" value="0" title="0"{chk}>'
    return s + '</span>'

def skill_row(cat, name, attrs):
    k = key(name)
    sel = ''
    if len(attrs) > 1:
        sel = f'<select class="sheet-attrsel" name="attr_skill_{k}_attr" title="Attribute used">' + ''.join(f'<option value="{a}">{a.upper()}</option>' for a in attrs) + '</select>'
    else:
        sel = f'<span class="sheet-attrfix">{attrs[0].upper()}</span>'
    return (f'<div class="sheet-skill"><input type="checkbox" class="sheet-pip" name="attr_skill_{k}_prof" value="1" title="Proficient">'
            f'<button type="action" class="sheet-skillbtn" name="act_skill_{k}" title="Roll {E(name)}">{E(name)}</button>{sel}'
            f'<span class="sheet-mod" name="attr_skill_{k}_total">+0</span></div>')

def skill_col(cats):
    s = ''
    for c in cats:
        s += f'<div class="sheet-cat">{c}</div>' + ''.join(skill_row(*x) for x in SKILLS if x[0] == c)
    return s

def box(title, body, cls=''):
    return f'<div class="sheet-box {cls}"><div class="sheet-h">{title}</div><div class="sheet-b">{body}</div></div>'

def field(label, name, typ='text', cls='', extra=''):
    return f'<label class="sheet-f {cls}"><span>{label}</span><input type="{typ}" name="attr_{name}" {extra}></label>'

race_opts = '<option value="">—</option>' + ''.join(f'<option value="{E(k)}">{E(v["label"])}</option>' for k, v in RACES.items())
class_opts = '<option value="">—</option>' + ''.join(f'<option value="{k}">{k}</option>' for k in CLASSES) + '<option value="Other">Other</option>'
bg_opts = '<option value="">—</option>' + ''.join(f'<option value="{k}">{k}</option>' for k in BACKGROUNDS)
armour_opts = '<option value="">No armour</option>' + ''.join(f'<option value="{E(n)}">{E(n)} ({c}, +{b} TN, Dex max +{cap})</option>' for n, c, b, cap in ARMOUR)
shield_opts = '<option value="">No shield</option>' + ''.join(f'<option value="{E(n)}">{E(n)} (+{b} TN)</option>' for n, b in SHIELDS)

details = (field('Name', 'character_name', cls='sheet-wide') +
    f'<label class="sheet-f"><span>Class</span><select name="attr_class">{class_opts}</select></label>' +
    f'<div class="sheet-levelrow"><span>Level</span>{pips("level", 10, 1, zero=False, default=1)}</div>' +
    '<div class="sheet-xprow"><label class="sheet-f"><span>XP</span><input type="number" name="attr_xp" value="0"></label>'
    '<span class="sheet-small">next level at <b name="attr_xp_next">100</b></span></div>')
attributes = ''.join(
    f'<div class="sheet-attr"><button type="action" class="sheet-attrbtn" name="act_attr_{a}" title="{"Saving throw" if a in ("str", "dex") else "Check"}: 2D6 + {full}">{lab}</button>'
    f'{pips(a, 6, 1, default=0)}<span class="sheet-attrnote" name="attr_{a}_note"></span></div>' for a, lab, full in ATTRS) + \
    '<div class="sheet-attrfoot"><span class="sheet-small">Points spent <b name="attr_attr_points">0</b> (8 at level 1)</span>' \
    '<button type="action" class="sheet-minibtn" name="act_save_will" title="Willpower save: 2D6 + the higher of Intellect and Charisma">Willpower save</button></div>'
appearance = '<div class="sheet-grid3">' + ''.join([
    field('Age', 'age'), field('Gender', 'gender'),
    f'<label class="sheet-f"><span>Race</span><select name="attr_race">{race_opts}</select></label>',
    field('Hair', 'hair'), field('Weight', 'weight'),
    f'<label class="sheet-f"><span>Background</span><select name="attr_background">{bg_opts}</select></label>',
    field('Skin', 'skin'), field('Height', 'height'), field('Alignment', 'alignment')]) + '</div>' + \
    '<div class="sheet-hints"><span name="attr_class_hint"></span><span name="attr_bg_hint"></span></div>' + field('Subrace', 'subrace', cls='sheet-wide sheet-thin')
portrait = '<div class="sheet-portrait"><img name="attr_portrait" alt=""><input type="text" name="attr_portrait" class="sheet-porturl" placeholder="Picture address (https://…)"></div>'

skills = (f'<div class="sheet-skillcols"><div>{skill_col(LEFT_CATS)}</div><div>{skill_col(RIGHT_CATS)}</div></div>'
    '<div class="sheet-profrow"><span class="sheet-proflabel">Armour</span>' +
    ''.join(f'<label title="{t}"><input type="checkbox" class="sheet-pip" name="attr_prof_armour_{n}" value="1"><span>{l}</span></label>' for n, l, t in [('light', 'L', 'Light armour'), ('medium', 'M', 'Medium armour'), ('heavy', 'H', 'Heavy armour'), ('shield', 'S', 'Shields')]) +
    '<span class="sheet-proflabel">Weapons</span>' +
    ''.join(f'<label title="{t}"><input type="checkbox" class="sheet-pip" name="attr_prof_{n}" value="1"><span>{l}</span></label>' for n, l, t in [('martial', 'Ma', 'Martial arts'), ('spell', 'Sp', 'Spellcasting'), ('wl', 'L', 'Light weapons'), ('wm', 'M', 'Medium weapons'), ('wh', 'H', 'Heavy weapons')]) +
    '</div><div class="sheet-customs">' +
    ''.join(f'<div class="sheet-custom"><input type="checkbox" class="sheet-pip" name="attr_custom{i}_prof" value="1" title="Proficient">'
            f'<input type="text" name="attr_custom{i}_name" placeholder="Custom skill {i}">'
            + ''.join(f'<label class="sheet-sdic"><input type="radio" name="attr_custom{i}_attr" value="{a}"{" checked" if a == "str" else ""}><span>{a[0].upper()}</span></label>' for a, _, _ in ATTRS) +
            f'<button type="action" class="sheet-minibtn" name="act_custom{i}">Roll</button></div>' for i in (1, 2, 3)) + '</div>')

weapons = ('<div class="sheet-thead sheet-wpn"><span>Weapon</span><span>Type</span><span>Range</span><span>Properties</span></div>'
    '<fieldset class="repeating_weapons"><div class="sheet-wpn">'
    '<input type="text" name="attr_name" placeholder="Longsword">'
    '<select name="attr_type"><option value="light">Light</option><option value="medium" selected>Medium</option><option value="heavy">Heavy</option></select>'
    '<input type="text" name="attr_range" placeholder="Melee">'
    '<input type="text" name="attr_props" placeholder="Versatile"></div>'
    '<div class="sheet-wpn2">'
    '<select name="attr_attr" title="Attribute for attacks"><option value="auto">Auto attribute</option><option value="str">Strength</option><option value="dex">Dexterity</option><option value="int">Intellect</option><option value="cha">Charisma</option></select>'
    '<input type="number" name="attr_bonus" value="0" title="Attack bonus">'
    '<input type="text" name="attr_damage" placeholder="Damage (by type)" title="Damage dice, e.g. 1D6, 1D6A, 2D6+1">'
    '<span class="sheet-btns"><button type="action" class="sheet-minibtn" name="act_attack">Attack</button><button type="action" class="sheet-minibtn" name="act_damage">Damage</button></span>'
    '</div></fieldset>'
    '<p class="sheet-note">Auto attribute: Dexterity for Finesse and ranged weapons, otherwise Strength. Blank damage uses the type: Light 1D6, Medium 1D6A (roll two, keep the higher), Heavy 2D6.</p>')

vitals = ('<div class="sheet-hp"><div class="sheet-hpcell"><span>Current</span><input type="number" name="attr_hp" value="6"></div>'
    '<div class="sheet-heart" title="Hit points">&#9829;</div>'
    '<div class="sheet-hpcell"><span>Max.</span><input type="number" name="attr_hp_max" value="6" readonly title="6 + 2 × Strength, plus hit points gained from levels"></div></div>'
    '<div class="sheet-hp2"><div class="sheet-hpcell"><span>Temp.</span><input type="number" name="attr_hp_temp" value="0"></div>'
    '<div class="sheet-hpcell sheet-tn"><span>T.N.</span><input type="number" name="attr_tn" value="6" readonly title="6 + armour + Dexterity (up to the armour’s cap) + shield"></div></div>')
death = ('<div class="sheet-death"><div class="sheet-h2">Death coin</div>'
    '<div class="sheet-dc"><span>Pass</span>' + ''.join(f'<input type="checkbox" class="sheet-pip" name="attr_death_pass{i}" value="1">' for i in (1, 2, 3)) + '</div>'
    '<div class="sheet-dc"><span>Fail</span>' + ''.join(f'<input type="checkbox" class="sheet-pip sheet-fail" name="attr_death_fail{i}" value="1">' for i in (1, 2, 3)) + '</div>'
    '<div class="sheet-dc"><span>Speed</span><b name="attr_speed">25</b>&nbsp;ft</div>'
    '<div class="sheet-dc"><span>Size</span><input type="text" name="attr_size" value="Medium"></div>'
    '<button type="action" class="sheet-minibtn" name="act_init" title="2D6 initiative, added to the tracker">Initiative</button></div>'
    '<div class="sheet-lang"><div class="sheet-h2">Languages</div><textarea name="attr_languages"></textarea></div>')
defence = ('<details class="sheet-adjust"><summary>Armour, shield and adjustments</summary><div class="sheet-grid2">'
    f'<label class="sheet-f"><span>Armour</span><select name="attr_armour">{armour_opts}</select></label>'
    f'<label class="sheet-f"><span>Shield</span><select name="attr_shield">{shield_opts}</select></label>'
    + field('TN bonus', 'tn_bonus', 'number', extra='value="0"') + field('Speed bonus (ft)', 'speed_bonus', 'number', extra='value="0"')
    + field('HP gained from levels', 'hp_levels', 'number', extra='value="0" title="Each level: 1D6 + Strength"') + field('Max HP bonus', 'hp_bonus', 'number', extra='value="0"')
    + field('Initiative bonus', 'init_bonus', 'number', extra='value="0"')
    + '<button type="action" class="sheet-minibtn" name="act_levelhp" title="Roll 1D6 + Strength and add it to HP gained from levels">Roll HP for a new level</button>'
    '</div><p class="sheet-note" name="attr_armour_note"></p></details>')

feats = ('<div class="sheet-h2">Racial Bonuses</div><textarea name="attr_racial" class="sheet-tall"></textarea>'
    '<div class="sheet-h2">Class Feats</div>'
    '<fieldset class="repeating_feats"><div class="sheet-feat"><input type="text" name="attr_name" list="sheet-featlist" placeholder="Feat name (pick from the list)">'
    '<input type="text" name="attr_tier" class="sheet-tier" placeholder="Tier"><textarea name="attr_effect" placeholder="What it does"></textarea></div></fieldset>'
    '<div class="sheet-h2">Other Feats &amp; Abilities</div><textarea name="attr_other_feats" class="sheet-tall"></textarea>')
featlist = '<datalist id="sheet-featlist">' + ''.join(f'<option value="{E(f["name"])}">{E(f["cls"] + (" " + f["tier"] if f["tier"] else ""))}</option>' for f in data['feats']) + '</datalist>'
spelllist = '<datalist id="sheet-spelllist">' + ''.join(f'<option value="{E(s["name"])}">{E(s["school"] + " · " + s["tier"])}</option>' for s in data['spells']) + '</datalist>'

inventory = ('<div class="sheet-thead sheet-inv"><span>Item</span><span>Weight</span><span>Qty.</span></div>'
    '<fieldset class="repeating_inventory"><div class="sheet-inv"><input type="text" name="attr_name"><input type="number" name="attr_weight" step="0.1"><input type="number" name="attr_qty" value="1"></div></fieldset>'
    '<div class="sheet-invtotal">Total weight <b name="attr_inv_weight">0</b> lb</div>'
    '<div class="sheet-coins">' + ''.join(f'<label><span>{c}</span><input type="number" name="attr_coin_{c.lower()}" value="0"></label>' for c in ('CP', 'SP', 'GP', 'PP')) + '</div>')
treasures = ('<fieldset class="repeating_treasures"><div class="sheet-inv2"><input type="text" name="attr_name" placeholder="Treasure or loot"><input type="text" name="attr_qty" placeholder="Qty / value"></div></fieldset>')
spells = ('<div class="sheet-sp"><div class="sheet-hpcell"><span>Spell points</span><input type="number" name="attr_sp" value="0"></div>'
    '<div class="sheet-hpcell"><span>Max.</span><input type="number" name="attr_sp_max" value="0" readonly></div>'
    '<label class="sheet-f"><span>Casting attribute</span><select name="attr_cast_attr"><option value="auto">Auto (Cleric: CHA, else INT)</option><option value="int">Intellect</option><option value="cha">Charisma</option><option value="best">Whichever is higher</option></select></label>'
    + field('SP bonus', 'sp_bonus', 'number', extra='value="0"') +
    '<label class="sheet-check"><input type="checkbox" name="attr_sp_flat" value="1"><span>4 SP pool (feat or background caster)</span></label>'
    '<label class="sheet-check"><input type="checkbox" name="attr_sp_auto" value="1" checked><span>Spend SP when casting</span></label>'
    '<button type="action" class="sheet-minibtn" name="act_sp_rest">Long rest: refill SP</button></div>'
    '<div class="sheet-thead sheet-spl"><span>Name</span><span>School</span><span>Tier</span><span>TN</span><span>Range</span><span>Effect</span><span>Scaling</span><span></span></div>'
    '<fieldset class="repeating_spells"><div class="sheet-spl">'
    '<input type="text" name="attr_name" list="sheet-spelllist" placeholder="Spell or miracle">'
    '<select name="attr_school">' + ''.join(f'<option value="{s}">{s}</option>' for s in SCHOOLS) + '</select>'
    '<select name="attr_tier"><option value="Basic">Basic</option><option value="Advanced">Advanced</option><option value="Master">Master</option></select>'
    '<input type="number" name="attr_tn" value="10">'
    '<input type="text" name="attr_range">'
    '<textarea name="attr_effect"></textarea>'
    '<div class="sheet-scal"><input type="text" name="attr_scaling"><label title="Extra SP spent on scaling this cast"><span>+SP</span><input type="number" name="attr_extra" value="0"></label></div>'
    '<span class="sheet-btns"><button type="action" class="sheet-minibtn" name="act_cast">Cast</button></span>'
    '</div></fieldset>'
    '<p class="sheet-note">Pick a name from the list to fill in the rest. Casting rolls 2D6 + Intellect (Charisma for miracles) against the TN, at Disadvantage without Spellcasting proficiency. A natural 2 rolls on the miscast table.</p>')

page1 = (
    '<div class="sheet-row1">' + box('Details', details, 'sheet-details') + box('Attributes', attributes, 'sheet-attrs') + box('Appearance', appearance, 'sheet-appear') + box('Portrait', portrait, 'sheet-port') + '</div>'
    '<div class="sheet-row2"><div class="sheet-colL">' + box('Skill Proficiencies', skills, 'sheet-skills') + '</div>'
    '<div class="sheet-colR">' + box('Equipment', weapons, 'sheet-equip') +
    '<div class="sheet-pair">' + box('Personality', '<textarea name="attr_personality"></textarea>') + box('Oaths &amp; Flaws', '<textarea name="attr_oaths"></textarea>') + '</div>'
    '<div class="sheet-pair sheet-vitalsrow"><div>' + box('Health', vitals + defence, 'sheet-vitals') + box('Scars &amp; Wounds', '<textarea name="attr_scars"></textarea>') + '</div>' + box('', death, 'sheet-deathbox') + '</div>'
    + box('Biography', '<textarea name="attr_biography" class="sheet-tall"></textarea>') + box('Feats &amp; Abilities', feats) + '</div></div>')
page2 = '<div class="sheet-pair">' + box('Inventory', inventory) + box('Treasures &amp; Other Loot', treasures) + '</div>'
page3 = box('Spells &amp; Miracles', spells) + box('Notes', '<textarea name="attr_notes" class="sheet-xtall"></textarea>')

TEMPLATE = '''<rolltemplate class="sheet-rolltemplate-2d6">
<div class="sheet-rt">
  <div class="sheet-rt-head"><div class="sheet-rt-name">{{name}}</div>{{#sub}}<div class="sheet-rt-sub">{{sub}}</div>{{/sub}}</div>
  {{#total}}<div class="sheet-rt-main"><div class="sheet-rt-total">{{total}}</div><div class="sheet-rt-dice">{{dice}}</div></div>{{/total}}
  {{#mode}}<div class="sheet-rt-mode">{{mode}}</div>{{/mode}}
  {{#outcome}}<div class="sheet-rt-outcome">{{outcome}}</div>{{/outcome}}
  {{#damage}}<div class="sheet-rt-dmg"><span class="sheet-rt-key">Damage</span> {{damage}}{{#dmgnote}} <span class="sheet-rt-dnote">{{dmgnote}}</span>{{/dmgnote}}</div>{{/damage}}
  {{#miscast}}<div class="sheet-rt-miscast">{{miscast}}</div>{{/miscast}}
  {{#spent}}<div class="sheet-rt-spent">{{spent}}</div>{{/spent}}
  {{#desc}}<div class="sheet-rt-desc">{{desc}}</div>{{/desc}}
</div>
</rolltemplate>'''

# ───────────── worker ─────────────
skills_js = json.dumps([{'k': key(n), 'name': n, 'attrs': a} for c, n, a in SKILLS])
races_js = json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'label'} for k, v in RACES.items()})
WORKER = '''
const SKILLS = %s;
const RACES = %s;
const CLASSES = %s;
const BACKGROUNDS = %s;
const ARMOUR = %s;
const SHIELDS = %s;
const FEATS = %s;
const SPELLS = %s;
const MISCAST = %s;
const ATTRS = ['str', 'dex', 'int', 'cha'];
const FULL = { str: 'Strength', dex: 'Dexterity', int: 'Intellect', cha: 'Charisma' };
const int = v => parseInt(v, 10) || 0;
const sign = n => (n >= 0 ? '+' : '-') + Math.abs(n);
const clean = s => String(s == null ? '' : s).replace(/[{}\\[\\]]/g, '').replace(/\\|/g, '/');

// ---- derived numbers ----
const DERIVED_IN = ['str', 'dex', 'int', 'cha', 'level', 'race', 'class', 'background', 'armour', 'shield', 'tn_bonus', 'speed_bonus', 'hp_levels', 'hp_bonus',
  'sp_flat', 'sp_bonus', 'cast_attr', 'prof_spell', 'prof_armour_light', 'prof_armour_medium', 'prof_armour_heavy', 'prof_armour_shield', 'xp']
  .concat(SKILLS.map(s => 'skill_' + s.k + '_attr'));
function effective(v) {
  const race = RACES[v.race] || {}, out = {};
  for (const a of ATTRS) out[a] = Math.min(6, int(v[a]) + ((race.attr || {})[a] || 0));
  return out;
}
function armourInfo(v) {
  const a = ARMOUR.find(x => x[0] === v.armour), s = SHIELDS.find(x => x[0] === v.shield);
  const cls = a ? a[1] : null;
  const prof = !a || v['prof_armour_' + cls] === '1';
  const shieldProf = !s || v.prof_armour_shield === '1';
  return { a, s, cls, prof, shieldProf };
}
function castAttr(v, school) {
  const e = effective(v);
  if (school === 'Miracle') return 'cha';
  if (v.cast_attr === 'int' || v.cast_attr === 'cha') return v.cast_attr;
  if (v.cast_attr === 'best') return e.cha > e.int ? 'cha' : 'int';
  return v.class === 'Cleric' ? 'cha' : 'int';
}
function recalc() {
  getAttrs(DERIVED_IN, v => {
    const e = effective(v), race = RACES[v.race] || {}, set = {};
    set.hp_max = 6 + 2 * e.str + int(v.hp_levels) + int(v.hp_bonus);
    const ai = armourInfo(v);
    let dexPart = e.dex;
    if (ai.a) dexPart = ai.prof ? Math.min(e.dex, ai.a[3]) : 0;
    set.tn = 6 + (ai.a ? ai.a[2] : 0) + dexPart + (ai.s ? ai.s[1] : 0) + int(v.tn_bonus) + (race.tn || 0);
    let speed = 25 + Math.min(Math.max(e.dex, 0), 3) + int(v.speed_bonus);
    if (ai.cls === 'heavy') speed = Math.min(speed, 20);
    set.speed = speed;
    const notes = [];
    if (ai.a && !ai.prof) notes.push('Not proficient with ' + ai.cls + ' armour: Dexterity counts as 0 for TN and attacks are at Major Disadvantage.');
    if (ai.s && !ai.shieldProf) notes.push('Not proficient with shields.');
    if (ai.cls === 'heavy') notes.push('Heavy armour: movement is at most 20 ft.');
    set.armour_note = notes.join(' ');
    const lvl = Math.max(1, int(v.level) || 1);
    const ca = castAttr(v, '');
    set.sp_max = (v.sp_flat === '1' ? 4 : v.prof_spell === '1' ? e[ca] * 2 + lvl * 2 : 0) + int(v.sp_bonus);
    set.xp_next = lvl >= 10 ? 'max level' : String(lvl * lvl * 100);
    set.attr_points = ATTRS.reduce((a, k) => a + int(v[k]), 0);
    for (const a of ATTRS) set[a + '_note'] = (race.attr || {})[a] ? '+' + race.attr[a] + ' racial' : '';
    for (const s of SKILLS) {
      const at = s.attrs.includes(v['skill_' + s.k + '_attr']) ? v['skill_' + s.k + '_attr'] : s.attrs[0];
      let m = e[at] + ((race.flat || {})[s.k] || 0) + (at === 'dex' && race.dexrolls ? race.dexrolls : 0);
      set['skill_' + s.k + '_total'] = sign(m);
    }
    const c = CLASSES[v.class];
    set.class_hint = c ? v.class + ': ' + c.skills + '.' : '';
    set.bg_hint = BACKGROUNDS[v.background] ? v.background + ' — pick two of: ' + BACKGROUNDS[v.background] + '.' : '';
    setAttrs(set, { silent: true });
  });
}
on('sheet:opened ' + DERIVED_IN.map(n => 'change:' + n).join(' '), recalc);

// race: fill in the racial bonuses (unless they've been rewritten by hand)
on('change:race', ev => {
  getAttrs(['racial'], v => {
    const old = RACES[ev.previousValue], now = RACES[ev.newValue];
    const oldText = old ? old.traits.join('\\n') : '';
    if (!v.racial || v.racial === oldText) setAttrs({ racial: now ? now.traits.join('\\n') : '' });
  });
});
// class: tick its weapon and armour proficiencies (if none are ticked yet)
on('change:class', ev => {
  const c = CLASSES[ev.newValue]; if (!c) return;
  const names = ['prof_wl', 'prof_wm', 'prof_wh', 'prof_armour_light', 'prof_armour_medium', 'prof_armour_heavy', 'prof_armour_shield', 'prof_spell'];
  getAttrs(names, v => {
    if (names.some(n => v[n] === '1')) return;
    const set = {};
    for (const w of c.weapons) set['prof_w' + w] = '1';
    for (const a of c.armour) set['prof_armour_' + a] = '1';
    if (c.spell) set.prof_spell = '1';
    setAttrs(set);
  });
});
// inventory weight
function weight() {
  getSectionIDs('inventory', ids => {
    const names = ids.flatMap(id => ['repeating_inventory_' + id + '_weight', 'repeating_inventory_' + id + '_qty']);
    getAttrs(names, v => {
      let t = 0;
      for (const id of ids) t += (parseFloat(v['repeating_inventory_' + id + '_weight']) || 0) * (v['repeating_inventory_' + id + '_qty'] === '' ? 1 : (parseFloat(v['repeating_inventory_' + id + '_qty']) || 0));
      setAttrs({ inv_weight: Math.round(t * 10) / 10 }, { silent: true });
    });
  });
}
on('sheet:opened change:repeating_inventory remove:repeating_inventory', weight);
// picking a known feat or spell fills in the rest
on('change:repeating_feats:name', ev => {
  const f = FEATS.find(x => x.name.toLowerCase() === String(ev.newValue || '').trim().toLowerCase()); if (!f) return;
  const p = ev.sourceAttribute.replace(/_name$/, '_');
  getAttrs([p + 'effect', p + 'tier'], v => {
    const set = {};
    if (!v[p + 'effect']) set[p + 'effect'] = f.effect + (f.pre && f.pre !== 'None' ? ' (Requires: ' + f.pre + ')' : '');
    if (!v[p + 'tier']) set[p + 'tier'] = f.cls === 'General' ? 'General' : f.cls + ' ' + f.tier;
    setAttrs(set);
  });
});
on('change:repeating_spells:name', ev => {
  const s = SPELLS.find(x => x.name.toLowerCase() === String(ev.newValue || '').trim().toLowerCase()); if (!s) return;
  const p = ev.sourceAttribute.replace(/_name$/, '_');
  getAttrs([p + 'effect', p + 'range', p + 'scaling'], v => {
    const set = {};
    if (!v[p + 'effect']) set[p + 'effect'] = s.effect;
    if (!v[p + 'range']) set[p + 'range'] = s.range;
    if (!v[p + 'scaling']) set[p + 'scaling'] = s.scaling;
    set[p + 'school'] = s.school.startsWith('Conjunctive') ? 'Conjunctive' : s.school;
    set[p + 'tier'] = s.tier;
    set[p + 'tn'] = parseInt(s.tn, 10) || ({ Basic: 10, Advanced: 12, Master: 14 })[s.tier];
    setAttrs(set);
  });
});
on('change:repeating_spells:tier', ev => {
  const p = ev.sourceAttribute.replace(/_tier$/, '_');
  if (ev.sourceType === 'player') setAttrs({ [p + 'tn']: ({ Basic: 10, Advanced: 12, Master: 14 })[ev.newValue] || 10 });
});

// ---- rolling ----
// Every check rolls three dice. Normally the two on the left count; Advantage keeps the best two, Disadvantage
// the worst two, Major Advantage all three, Major Disadvantage the first one. The third die is always shown,
// so a GM can apply Advantage after the fact without a reroll.
const MODES = { normal: 0, adv: 1, dis: -1, majadv: 2, majdis: -2 };
const MODE_NAME = { '-2': 'Major disadvantage', '-1': 'Disadvantage', '0': '', '1': 'Advantage', '2': 'Major advantage' };
function outcomeOf(total, natural, tn, kind) {
  if (kind === 'attack') {
    if (natural === 12) return 'Natural 12: critical hit, extra damage';
    if (natural === 2) return 'Natural 2: fumble';
    return 'Hits if it meets the target’s TN';
  }
  if (tn) {
    const hit = total >= tn;
    if (natural === 12 && kind === 'cast') return 'Critical success vs TN ' + tn + ': double damage dice or extend the duration';
    if (natural === 2 && kind === 'cast') return 'Miscast vs TN ' + tn;
    return (hit ? 'Success' : 'Failure') + ' vs TN ' + tn;
  }
  if (natural === 12 || total >= 12) return 'Critical success';
  if (total >= 10) return 'Full success';
  if (total >= 7) return 'Partial success: it works, at a cost';
  if (total >= 1) return 'Failure';
  return 'Critical failure';
}
function roll2d6(o) {
  getAttrs(['rollmode', 'whisper'], v => {
    const chosen = MODES[v.rollmode] || 0;
    const steps = Math.max(-2, Math.min(2, (o.steps || 0) + chosen));
    const why = (o.why || []).slice();
    if (chosen) why.push('chosen on the sheet');
    let text = (v.whisper === '1' ? '/w gm ' : '') + '&{template:2d6} {{name=' + clean(o.name) + '}}' + (o.sub ? ' {{sub=' + clean(o.sub) + '}}' : '') +
      ' {{total=[[0' + (o.tracker ? ' &{tracker}' : '') + ']]}} {{dice=[[3d6]]}}' + (o.noOutcome ? '' : ' {{outcome=[[0]]}}');
    if (MODE_NAME[steps]) text += ' {{mode=' + MODE_NAME[steps] + (why.length ? ' (' + clean(why.join(', ')) + ')' : '') + '}}';
    else if (why.length) text += ' {{mode=Advantage and Disadvantage cancel out (' + clean(why.join(', ')) + ')}}';
    if (o.cast) text += ' {{miscast=[[1d6]]}}';
    if (o.spend) text += ' {{spent=[[0]]}}';
    if (o.desc) text += ' {{desc=' + clean(o.desc) + '}}';
    startRoll(text, r => {
      const d = (r.results.dice && r.results.dice.dice) || [1, 1, 1];
      const idx = [0, 1, 2];
      let keep;
      if (steps === 0) keep = [0, 1];
      else if (steps === 2) keep = [0, 1, 2];
      else if (steps === -2) keep = [0];
      else { const s = idx.slice().sort((a, b) => steps > 0 ? d[b] - d[a] : d[a] - d[b]); keep = s.slice(0, 2).sort(); }
      const sum = keep.reduce((a, i) => a + d[i], 0);
      const total = sum + (o.mod || 0);
      const natural = keep.length === 2 ? sum : null;
      const comp = { total, dice: d.map((x, i) => keep.includes(i) ? String(x) : '(' + x + ')').join(' ') + (o.mod ? '  ' + sign(o.mod) : '') };
      if (!o.noOutcome) comp.outcome = outcomeOf(total, natural, o.tn, o.kind);
      if (o.cast) comp.miscast = natural === 2 ? 'Miscast (' + r.results.miscast.result + '): ' + MISCAST[r.results.miscast.result - 1] : '';
      if (o.spend) comp.spent = o.spend;
      finishRoll(r.rollId, comp);
      if (o.after) o.after(total, natural);
    });
  });
}
function simpleRoll(name, sub, formula, extra) {
  getAttrs(['whisper'], v => {
    startRoll((v.whisper === '1' ? '/w gm ' : '') + '&{template:2d6} {{name=' + clean(name) + '}} {{sub=' + clean(sub) + '}} {{damage=[[' + formula + ']]}}' + (extra || ''), r => finishRoll(r.rollId, {}));
  });
}
const RACE_FIELDS = ['race'];
// skills
for (const s of SKILLS) {
  on('clicked:skill_' + s.k, () => {
    getAttrs(['str', 'dex', 'int', 'cha', 'race', 'skill_' + s.k + '_attr', 'skill_' + s.k + '_prof'], v => {
      const e = effective(v), race = RACES[v.race] || {};
      const at = s.attrs.includes(v['skill_' + s.k + '_attr']) ? v['skill_' + s.k + '_attr'] : s.attrs[0];
      const mod = e[at] + ((race.flat || {})[s.k] || 0) + (at === 'dex' && race.dexrolls ? race.dexrolls : 0);
      let steps = 0; const why = [];
      if (v['skill_' + s.k + '_prof'] !== '1') { steps--; why.push('not proficient'); }
      if ((race.adv || []).includes(s.k)) { steps++; why.push(v.race); }
      roll2d6({ name: s.name, sub: FULL[at] + ' ' + sign(mod), mod, steps, why, kind: 'check' });
    });
  });
}
for (const i of [1, 2, 3]) {
  on('clicked:custom' + i, () => {
    getAttrs(['str', 'dex', 'int', 'cha', 'race', 'custom' + i + '_name', 'custom' + i + '_attr', 'custom' + i + '_prof'], v => {
      const e = effective(v), at = ATTRS.includes(v['custom' + i + '_attr']) ? v['custom' + i + '_attr'] : 'str';
      const steps = v['custom' + i + '_prof'] === '1' ? 0 : -1;
      roll2d6({ name: v['custom' + i + '_name'] || 'Custom skill', sub: FULL[at] + ' ' + sign(e[at]), mod: e[at], steps, why: steps ? ['not proficient'] : [], kind: 'check' });
    });
  });
}
// attributes and saves
for (const a of ATTRS) {
  on('clicked:attr_' + a, () => {
    getAttrs(['str', 'dex', 'int', 'cha', 'race'], v => {
      const e = effective(v);
      const save = a === 'str' || a === 'dex';
      roll2d6({ name: save ? FULL[a] + ' save' : FULL[a] + ' check', sub: FULL[a] + ' ' + sign(e[a]), mod: e[a], kind: 'check' });
    });
  });
}
on('clicked:save_will', () => {
  getAttrs(['str', 'dex', 'int', 'cha', 'race'], v => {
    const e = effective(v), a = e.cha > e.int ? 'cha' : 'int';
    roll2d6({ name: 'Willpower save', sub: FULL[a] + ' ' + sign(e[a]), mod: e[a], kind: 'check' });
  });
});
on('clicked:init', () => {
  getAttrs(['init_bonus'], v => roll2d6({ name: 'Initiative', sub: int(v.init_bonus) ? 'Bonus ' + sign(int(v.init_bonus)) : '', mod: int(v.init_bonus), tracker: true, noOutcome: true }));
});
on('clicked:levelhp', () => {
  getAttrs(['str', 'race', 'hp_levels', 'whisper'], v => {
    const e = effective(v);
    startRoll('&{template:2d6} {{name=Level-up hit points}} {{sub=1D6 + Strength ' + sign(e.str) + '}} {{damage=[[1d6 + ' + e.str + ']]}}', r => {
      const gain = Math.max(1, r.results.damage.result);
      finishRoll(r.rollId, { damage: gain });
      setAttrs({ hp_levels: int(v.hp_levels) + gain });
    });
  });
});
on('clicked:sp_rest', () => getAttrs(['sp_max'], v => setAttrs({ sp: v.sp_max })));
// weapons
function weaponAttr(v, p, e) {
  const chosen = v[p + 'attr'];
  if (chosen && chosen !== 'auto') return chosen;
  const props = (v[p + 'props'] || '').toLowerCase(), range = (v[p + 'range'] || '').toLowerCase();
  const ranged = /bow|crossbow|sling/.test((v[p + 'name'] || '').toLowerCase()) || (range && !/melee|touch|reach/.test(range) && /\\d/.test(range) && !/thrown/.test(props));
  return /finesse/.test(props) || ranged ? 'dex' : 'str';
}
function damageFormula(v, p) {
  let f = (v[p + 'damage'] || '').trim();
  if (!f) f = { light: '1D6', medium: '1D6A', heavy: '2D6' }[v[p + 'type']] || '1D6';
  return f.replace(/(\\d*)d6a/ig, (m, n) => { const k = parseInt(n || '1', 10); return (k + 1) + 'd6kh' + k; }).replace(/D/g, 'd');
}
on('clicked:repeating_weapons:attack', ev => {
  const p = ev.sourceAttribute.replace(/attack$/, '');
  getAttrs(['str', 'dex', 'int', 'cha', 'race', 'armour', 'prof_wl', 'prof_wm', 'prof_wh', 'prof_armour_light', 'prof_armour_medium', 'prof_armour_heavy']
    .concat(['name', 'type', 'range', 'props', 'attr', 'bonus'].map(n => p + n)), v => {
    const e = effective(v), race = RACES[v.race] || {};
    const at = weaponAttr(v, p, e);
    const mod = e[at] + int(v[p + 'bonus']) + (at === 'dex' && race.dexrolls ? race.dexrolls : 0);
    let steps = 0; const why = [];
    const need = { light: 'prof_wl', medium: 'prof_wm', heavy: 'prof_wh' }[v[p + 'type']];
    if (need && v[need] !== '1') { steps--; why.push('not proficient with ' + v[p + 'type'] + ' weapons'); }
    const ai = armourInfo(v);
    if (ai.a && !ai.prof) { steps -= 2; why.push('armour without proficiency'); }
    roll2d6({ name: v[p + 'name'] || 'Attack', sub: FULL[at] + ' ' + sign(mod) + (v[p + 'props'] ? ' · ' + v[p + 'props'] : ''), mod, steps, why, kind: 'attack' });
  });
});
on('clicked:repeating_weapons:damage', ev => {
  const p = ev.sourceAttribute.replace(/damage$/, '');
  getAttrs(['name', 'type', 'damage'].map(n => p + n), v => {
    simpleRoll((v[p + 'name'] || 'Weapon') + ' damage', (v[p + 'type'] || '') + ' weapon', damageFormula(v, p));
  });
});
// spells
on('clicked:repeating_spells:cast', ev => {
  const p = ev.sourceAttribute.replace(/cast$/, '');
  getAttrs(['str', 'dex', 'int', 'cha', 'race', 'class', 'cast_attr', 'prof_spell', 'sp', 'sp_auto'].concat(['name', 'school', 'tier', 'tn', 'effect', 'extra'].map(n => p + n)), v => {
    const e = effective(v);
    const school = v[p + 'school'] || 'Evocation', tier = v[p + 'tier'] || 'Basic';
    const at = castAttr(v, school);
    const tn = int(v[p + 'tn']) || ({ Basic: 10, Advanced: 12, Master: 14 })[tier];
    const cost = ({ Basic: 1, Advanced: 3, Master: 5 })[tier] + Math.max(0, int(v[p + 'extra']));
    let steps = 0; const why = [];
    if (v.prof_spell !== '1') { steps--; why.push('no Spellcasting proficiency'); }
    const desc = (tier === 'Master' && v.prof_spell !== '1') ? 'Without Spellcasting proficiency, Master spells cannot be cast.' : (v[p + 'effect'] || '');
    const spend = v.sp_auto === '1' ? cost + ' SP spent (' + Math.max(0, int(v.sp) - cost) + ' left)' : '';
    roll2d6({ name: v[p + 'name'] || 'Spell', sub: school + ' · ' + tier + ' · ' + FULL[at] + ' ' + sign(e[at]), mod: e[at], steps, why, tn, kind: 'cast', cast: true, desc, spend });
    if (v.sp_auto === '1') setAttrs({ sp: int(v.sp) - cost });
  });
});
''' % (skills_js, races_js, json.dumps(CLASSES), json.dumps(BACKGROUNDS), json.dumps(ARMOUR), json.dumps(SHIELDS),
       json.dumps(data['feats'], ensure_ascii=False), json.dumps(data['spells'], ensure_ascii=False), json.dumps(MISCAST))

sheet_html = f'''<div class="sheet-2d6">
<div class="sheet-topbar">
  <span class="sheet-brand">2D6</span>
  <label class="sheet-mode" title="Applies to every roll until you change it back"><span>Rolling with</span><select name="attr_rollmode">
    <option value="normal">Normal</option><option value="adv">Advantage</option><option value="dis">Disadvantage</option><option value="majadv">Major advantage</option><option value="majdis">Major disadvantage</option></select></label>
  <label class="sheet-check"><input type="checkbox" name="attr_whisper" value="1"><span>Roll to the GM only</span></label>
</div>
<div class="sheet-tabs">
  <input type="radio" name="attr_tab" value="1" class="sheet-tab sheet-t1" checked><span class="sheet-tablabel">Character</span>
  <input type="radio" name="attr_tab" value="2" class="sheet-tab sheet-t2"><span class="sheet-tablabel">Inventory</span>
  <input type="radio" name="attr_tab" value="3" class="sheet-tab sheet-t3"><span class="sheet-tablabel">Spells &amp; Notes</span>
  <div class="sheet-page sheet-p1">{page1}</div>
  <div class="sheet-page sheet-p2">{page2}</div>
  <div class="sheet-page sheet-p3">{page3}</div>
</div>
{featlist}{spelllist}
</div>
{TEMPLATE}
<script type="text/worker">{WORKER}</script>
'''
open(os.path.join(out, 'sheet.html'), 'w', encoding='utf-8').write(sheet_html)
open(os.path.join(out, 'templates.html'), 'w', encoding='utf-8').write(TEMPLATE)
print('sheet.html', len(sheet_html))
