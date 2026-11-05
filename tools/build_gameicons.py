"""Pick a game-icons.net picture for every item, spell and feature card, and bundle the pictures the table uses.

    python build_gameicons.py <game-icons/icons checkout> <site>

Writes <site>/table/data/gameicons.js (window.GAME_ICONS: name → [path data], plus the rules that choose a picture
for spells brought in later) and adds a "gi" field to the cards in items-srd.json and spells-srd.json.

The icons are by Lorc, Delapouite and the other game-icons.net authors, CC BY 3.0 (see table/data/ICONS-LICENSE.txt).
Which picture goes with which item or spell is in gameicons_rules.py.
"""
import json, os, re, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gameicons_rules as R

repo, site = sys.argv[1], sys.argv[2]
data = os.path.join(site, 'table', 'data')
# where each icon lives; the same name by two authors: prefer Lorc, then Delapouite
PREF = ['lorc', 'delapouite']
files = {}
for f in sorted(glob.glob(os.path.join(repo, '*', '*.svg')), key=lambda p: (PREF.index(p.split(os.sep)[-2]) if p.split(os.sep)[-2] in PREF else 9, p)):
    files.setdefault(os.path.basename(f)[:-4], f)
authors = {}

items = json.load(open(os.path.join(data, 'items-srd.json'), encoding='utf-8'))
for it in items['items']: it['gi'] = R.item_icon(it)
spells = json.load(open(os.path.join(data, 'spells-srd.json'), encoding='utf-8'))
for sp in spells['spells']: sp['gi'] = R.spell_icon(sp)

fpath = os.path.join(data, 'features-srd.json')
features = json.load(open(fpath, encoding='utf-8')) if os.path.exists(fpath) else {'features': []}
for f in features['features']: f['gi'] = R.feature_icon(f)
want = set(f['gi'] for f in features['features']) | set(R.STANDARD_ICONS) | set(R.CLASS_ICON.values()) | set(it['gi'] for it in items['items']) | set(sp['gi'] for sp in spells['spells']) | set(R.EXTRA) \
    | set(i for _, i in R.SPELL_RULES) | set(R.SPELL_DAMAGE.values()) | set(R.SPELL_SCHOOL.values()) | set(R.ITEM_FALLBACK.values())
missing = sorted(w for w in want if w not in files)
if missing: sys.exit('No such icons: ' + ', '.join(missing))

def paths(svg):
    # every path but the black square behind; numbers trimmed to 1 decimal place (the icons are 512 units across)
    ds = []
    for m in re.finditer(r'<path([^>]*)/?>', svg):
        a = m.group(1)
        d = re.search(r'\sd="([^"]+)"', a)
        if not d: continue
        d = d.group(1)
        if d.strip() in ('M0 0h512v512H0z', 'M0 0h512v512H0V0z'): continue
        ds.append(re.sub(r'(\d+\.\d)\d+', r'\1', d))
    return ds

icons = {}
for w in sorted(want):
    icons[w] = paths(open(files[w], encoding='utf-8').read())
    authors.setdefault(files[w].split(os.sep)[-2], []).append(w)

rules = {'spell': [[p, i] for p, i in R.SPELL_RULES], 'damage': R.SPELL_DAMAGE, 'school': R.SPELL_SCHOOL}
js = ('/* Pictures from game-icons.net (CC BY 3.0, by ' + ', '.join(sorted(authors)) + '). Built by tools/build_gameicons.py. */\n'
      'window.GAME_ICONS=' + json.dumps(icons, separators=(',', ':')) + ';\n'
      'window.GAME_ICON_RULES=' + json.dumps(rules, separators=(',', ':')) + ';\n')
open(os.path.join(data, 'gameicons.js'), 'w', encoding='utf-8').write(js)
json.dump(items, open(os.path.join(data, 'items-srd.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(spells, open(os.path.join(data, 'spells-srd.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
if features['features']: json.dump(features, open(fpath, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
lic = ('The pictures in gameicons.js come from game-icons.net (https://game-icons.net), by\n'
       + '\n'.join(f'  {a}: {len(v)} icons' for a, v in sorted(authors.items())) +
       '\nand are available under the Creative Commons Attribution 3.0 Unported licence\n'
       '(https://creativecommons.org/licenses/by/3.0/). They are used unchanged apart from colour.\n')
open(os.path.join(data, 'ICONS-LICENSE.txt'), 'w', encoding='utf-8').write(lic)
print(f'{len(icons)} icons, {os.path.getsize(os.path.join(data, "gameicons.js")) // 1024} KB')
