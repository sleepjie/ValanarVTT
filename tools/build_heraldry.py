"""Build app/heraldry-charges.js: the extra charges for coats of arms (beasts, birds, monsters, plants, things),
drawn from game-icons.net pictures.

    python build_heraldry.py <game-icons/icons checkout> <site>

The pictures are by Lorc, Delapouite and the other game-icons.net authors, CC BY 3.0. Each is kept as its path
data in its own 512-unit box (numbers rounded to whole units), and heraldry.js scales it onto the shield.
"""
import json, os, re, sys, glob

repo, site = sys.argv[1], sys.argv[2]

# key: (icon, name, plural, category)
CH = [
    # beasts
    ('lion', 'lion', 'lion’s head', 'lions’ heads', 'Beasts'),
    ('tiger', 'tiger-head', 'tiger’s head', 'tigers’ heads', 'Beasts'),
    ('bear', 'polar-bear', 'bear passant', 'bears passant', 'Beasts'),
    ('bearhead', 'bear-head', 'bear’s head', 'bears’ heads', 'Beasts'),
    ('boar', 'boar', 'boar passant', 'boars passant', 'Beasts'),
    ('stag', 'deer', 'stag statant', 'stags statant', 'Beasts'),
    ('staghead', 'stag-head', 'stag’s head caboshed', 'stags’ heads caboshed', 'Beasts'),
    ('horse', 'horse-head', 'horse’s head', 'horses’ heads', 'Beasts'),
    ('unicorn', 'unicorn', 'unicorn’s head', 'unicorns’ heads', 'Beasts'),
    ('bull', 'charging-bull', 'bull', 'bulls', 'Beasts'),
    ('bullhead', 'bull', 'bull’s head caboshed', 'bulls’ heads caboshed', 'Beasts'),
    ('ram', 'ram-profile', 'ram’s head', 'rams’ heads', 'Beasts'),
    ('goat', 'goat', 'goat', 'goats', 'Beasts'),
    ('wolfg', 'wolf-head', 'wolf’s head', 'wolves’ heads', 'Beasts'),
    ('fox', 'fox', 'fox sejant', 'foxes sejant', 'Beasts'),
    ('hound', 'hound', 'hound’s head', 'hounds’ heads', 'Beasts'),
    ('hare', 'rabbit', 'hare', 'hares', 'Beasts'),
    ('squirrel', 'squirrel', 'squirrel sejant', 'squirrels sejant', 'Beasts'),
    ('cat', 'cat', 'cat sejant', 'cats sejant', 'Beasts'),
    ('lynx', 'lynx-head', 'lynx’s head', 'lynxes’ heads', 'Beasts'),
    ('badger', 'badger', 'badger’s head', 'badgers’ heads', 'Beasts'),
    ('elephant', 'elephant', 'elephant', 'elephants', 'Beasts'),
    ('camel', 'camel', 'camel', 'camels', 'Beasts'),
    ('bison', 'bison', 'bison', 'bison', 'Beasts'),
    ('hedgehog', 'hedgehog', 'hedgehog', 'hedgehogs', 'Beasts'),
    # birds
    ('eagleg', 'eagle-emblem', 'eagle rising', 'eagles rising', 'Birds'),
    ('eaglehead', 'eagle-head', 'eagle’s head', 'eagles’ heads', 'Birds'),
    ('falcon', 'hawk-emblem', 'falcon displayed', 'falcons displayed', 'Birds'),
    ('raven', 'raven', 'raven', 'ravens', 'Birds'),
    ('owl', 'owl', 'owl', 'owls', 'Birds'),
    ('swan', 'swan', 'swan', 'swans', 'Birds'),
    ('cock', 'rooster', 'cock', 'cocks', 'Birds'),
    ('dove', 'dove', 'dove volant', 'doves volant', 'Birds'),
    ('heron', 'heron', 'heron', 'herons', 'Birds'),
    ('pelican', 'eating-pelican', 'pelican in her piety', 'pelicans in their piety', 'Birds'),
    # monsters
    ('dragon', 'dragon-head', 'dragon’s head', 'dragons’ heads', 'Monsters'),
    ('wyvern', 'wyvern', 'wyvern', 'wyverns', 'Monsters'),
    ('griffin', 'griffin-symbol', 'griffin segreant', 'griffins segreant', 'Monsters'),
    ('pegasus', 'pegasus', 'pegasus', 'pegasi', 'Monsters'),
    ('seaserpent', 'sea-serpent', 'sea-serpent', 'sea-serpents', 'Monsters'),
    ('hydra', 'hydra', 'hydra', 'hydras', 'Monsters'),
    ('minotaur', 'minotaur', 'minotaur', 'minotaurs', 'Monsters'),
    ('centaur', 'centaur', 'centaur', 'centaurs', 'Monsters'),
    ('mermaid', 'mermaid', 'mermaid', 'mermaids', 'Monsters'),
    ('harpy', 'harpy', 'harpy', 'harpies', 'Monsters'),
    ('sphinx', 'greek-sphinx', 'sphinx', 'sphinxes', 'Monsters'),
    ('werewolf', 'werewolf', 'wolf-man rampant', 'wolf-men rampant', 'Monsters'),
    ('salamander', 'salamander', 'salamander in flames', 'salamanders in flames', 'Monsters'),
    ('kraken', 'kraken-tentacle', 'kraken', 'krakens', 'Monsters'),
    # the sea, and small creatures
    ('dolphin', 'dolphin', 'dolphin', 'dolphins', 'Sea & small'),
    ('fishes', 'double-fish', 'pair of fish', 'pairs of fish', 'Sea & small'),
    ('seahorse', 'seahorse', 'sea-horse', 'sea-horses', 'Sea & small'),
    ('octopus', 'octopus', 'octopus', 'octopuses', 'Sea & small'),
    ('crab', 'crab', 'crab', 'crabs', 'Sea & small'),
    ('turtle', 'turtle', 'tortoise', 'tortoises', 'Sea & small'),
    ('whale', 'sperm-whale', 'whale', 'whales', 'Sea & small'),
    ('scorpion', 'scorpion', 'scorpion', 'scorpions', 'Sea & small'),
    ('serpent', 'snake', 'serpent', 'serpents', 'Sea & small'),
    ('frog', 'frog', 'frog', 'frogs', 'Sea & small'),
    ('bee', 'bee', 'bee', 'bees', 'Sea & small'),
    ('butterfly', 'butterfly', 'butterfly', 'butterflies', 'Sea & small'),
    ('spider', 'spider-alt', 'spider', 'spiders', 'Sea & small'),
    ('scarab', 'scarab-beetle', 'scarab', 'scarabs', 'Sea & small'),
    ('dragonfly', 'dragonfly', 'dragonfly', 'dragonflies', 'Sea & small'),
    # plants
    ('oak', 'oak', 'oak tree', 'oak trees', 'Plants'),
    ('pine', 'pine-tree', 'pine tree', 'pine trees', 'Plants'),
    ('oakleaf', 'oak-leaf', 'oak leaf', 'oak leaves', 'Plants'),
    ('acorn', 'acorn', 'acorn', 'acorns', 'Plants'),
    ('garb', 'wheat', 'garb of wheat', 'garbs of wheat', 'Plants'),
    ('grapes', 'grapes', 'bunch of grapes', 'bunches of grapes', 'Plants'),
    ('mushroom', 'mushroom', 'mushroom', 'mushrooms', 'Plants'),
    ('lotus', 'lotus', 'lotus', 'lotuses', 'Plants'),
    ('sunflower', 'sunflower', 'sunflower', 'sunflowers', 'Plants'),
    ('cinquefoil', 'flower-emblem', 'cinquefoil', 'cinquefoils', 'Plants'),
    ('clover', 'clover', 'quatrefoil', 'quatrefoils', 'Plants'),
    ('lily', 'trefoil-lily', 'lily', 'lilies', 'Plants'),
    # arms and armour
    ('crossedswords', 'crossed-swords', 'two swords in saltire', 'pairs of swords in saltire', 'Arms & armour'),
    ('crossedaxes', 'crossed-axes', 'two axes in saltire', 'pairs of axes in saltire', 'Arms & armour'),
    ('battleaxe', 'battle-axe', 'battle-axe', 'battle-axes', 'Arms & armour'),
    ('mace', 'flanged-mace', 'mace', 'maces', 'Arms & armour'),
    ('spear', 'barbed-spear', 'spear', 'spears', 'Arms & armour'),
    ('trident', 'trident', 'trident', 'tridents', 'Arms & armour'),
    ('bow', 'bow-arrow', 'bow and arrow', 'bows and arrows', 'Arms & armour'),
    ('helm', 'visored-helm', 'helm', 'helms', 'Arms & armour'),
    ('gauntlet', 'mailed-fist', 'gauntlet clenched', 'gauntlets clenched', 'Arms & armour'),
    ('armsword', 'sword-brandish', 'arm holding a sword', 'arms holding swords', 'Arms & armour'),
    ('cannon', 'cannon', 'cannon', 'cannons', 'Arms & armour'),
    # things
    ('castle', 'medieval-gate', 'castle', 'castles', 'Things'),
    ('bridge', 'bridge', 'bridge', 'bridges', 'Things'),
    ('windmill', 'windmill', 'windmill', 'windmills', 'Things'),
    ('well', 'well', 'well', 'wells', 'Things'),
    ('wall', 'stone-wall', 'wall', 'walls', 'Things'),
    ('longship', 'drakkar', 'longship', 'longships', 'Things'),
    ('galleon', 'galleon', 'galleon', 'galleons', 'Things'),
    ('shipwheel', 'ship-wheel', 'ship’s wheel', 'ships’ wheels', 'Things'),
    ('grail', 'holy-grail', 'grail', 'grails', 'Things'),
    ('chalice', 'jeweled-chalice', 'chalice', 'chalices', 'Things'),
    ('lyre', 'lyre', 'lyre', 'lyres', 'Things'),
    ('harp', 'harp', 'harp', 'harps', 'Things'),
    ('scales', 'scales', 'balance', 'balances', 'Things'),
    ('hourglass', 'hourglass', 'hourglass', 'hourglasses', 'Things'),
    ('candle', 'candle-light', 'candle', 'candles', 'Things'),
    ('lantern', 'lantern', 'lantern', 'lanterns', 'Things'),
    ('torch', 'torch', 'torch', 'torches', 'Things'),
    ('anvil', 'anvil', 'anvil', 'anvils', 'Things'),
    ('horseshoe', 'horseshoe', 'horseshoe', 'horseshoes', 'Things'),
    ('quill', 'quill', 'quill', 'quills', 'Things'),
    ('scroll', 'scroll-unfurled', 'scroll', 'scrolls', 'Things'),
    ('seal', 'wax-seal', 'seal', 'seals', 'Things'),
    ('cog', 'cog', 'cogwheel', 'cogwheels', 'Things'),
    ('sickle', 'sickle', 'sickle', 'sickles', 'Things'),
    ('scythe', 'scythe', 'scythe', 'scythes', 'Things'),
    ('pitchfork', 'pitchfork', 'pitchfork', 'pitchforks', 'Things'),
    ('bones', 'crossed-bones', 'two bones in saltire', 'pairs of bones in saltire', 'Things'),
    # signs
    ('eye', 'all-seeing-eye', 'eye in glory', 'eyes in glory', 'Signs'),
    ('hand', 'hand', 'hand', 'hands', 'Signs'),
    ('crownedheart', 'crowned-heart', 'crowned heart', 'crowned hearts', 'Signs'),
    ('laurel', 'laurel-crown', 'crown within a wreath', 'crowns within wreaths', 'Signs'),
    ('jerusalem', 'jerusalem-cross', 'Jerusalem cross', 'Jerusalem crosses', 'Signs'),
    ('ankh', 'ankh', 'ankh', 'ankhs', 'Signs'),
    ('pentacle', 'pentacle', 'pentacle', 'pentacles', 'Signs'),
    ('snowflake', 'snowflake-1', 'snowflake', 'snowflakes', 'Signs'),
    ('wave', 'wave-crest', 'wave', 'waves', 'Signs'),
    ('goutte', 'water-drop', 'goutte', 'gouttes', 'Signs'),
    ('moon', 'moon', 'moon', 'moons', 'Signs'),
    ('compass', 'compass', 'compass rose', 'compass roses', 'Signs'),
    ('crystal', 'crystal-ball', 'crystal ball', 'crystal balls', 'Signs'),
]

PREF = ['lorc', 'delapouite']
files = {}
for f in sorted(glob.glob(os.path.join(repo, '*', '*.svg')), key=lambda p: (PREF.index(p.split(os.sep)[-2]) if p.split(os.sep)[-2] in PREF else 9, p)):
    files.setdefault(os.path.basename(f)[:-4], f)

def rnd(m):
    return str(round(float(m.group(0))))
def path_of(svg):
    ds = []
    for m in re.finditer(r'<path([^>]*)/?>', svg):
        d = re.search(r'\sd="([^"]+)"', m.group(1))
        if not d: continue
        d = d.group(1).strip()
        if d in ('M0 0h512v512H0z', 'M0 0h512v512H0V0z'): continue
        ds.append(re.sub(r'(\d+\.\d)\d+', r'\1', d))   # (to a tenth: the numbers run together, "1.5.5", so they're cut, not rounded)
    return ' '.join(ds)

out, authors = {}, {}
for key, icon, name, pl, cat in CH:
    if icon not in files: sys.exit('No such icon: ' + icon)
    svg = open(files[icon], encoding='utf-8').read()
    if 'viewBox="0 0 512 512"' not in svg: sys.exit('Not a 512 icon: ' + icon)
    out[key] = {'name': name, 'pl': pl, 'cat': cat, 'box': 512, 'd': path_of(svg)}
    authors.setdefault(files[icon].split(os.sep)[-2], []).append(icon)

credit = ', '.join(f'{a} ({len(v)})' for a, v in sorted(authors.items()))
js = ('/* Extra charges for coats of arms (app/heraldry.js): pictures from game-icons.net by ' + credit + ',\n'
      ' * under the Creative Commons Attribution 3.0 licence (https://creativecommons.org/licenses/by/3.0/).\n'
      ' * Built by tools/build_heraldry.py; each is path data in a 512-unit box. */\n'
      'window.VALANAR_CHARGES=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
dst = os.path.join(site, 'app', 'heraldry-charges.js')
open(dst, 'w', encoding='utf-8').write(js)
print(len(out), 'charges,', os.path.getsize(dst) // 1024, 'KB →', dst)
