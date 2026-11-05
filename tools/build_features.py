"""Build table/data/features-srd.json: every class feature, racial trait and feat in the D&D 5e SRD 5.1, one card each.

Source: the 5e-bits/5e-database repository (MIT), src/2014/en/5e-SRD-Features.json, -Traits.json, -Feats.json and
-Subclasses.json, which hold the SRD 5.1 text. The SRD 5.1 is by Wizards of the Coast LLC under the Creative Commons
Attribution 4.0 International licence.

    python build_features.py <5e-database>/src/2014/en <site>/table/data/features-srd.json

Then run build_gameicons.py again so the pictures the cards use are bundled.

A feature that grows (Bardic Inspiration d6 → d12, Extra Attack, Channel Divinity 1/rest → 3/rest) is one card with
its steps; one that comes again (Ability Score Improvement) is one card with its levels. Choices (a Fighting Style,
an Eldritch Invocation, Metamagic) are cards of their own under the feature they're chosen for.
"""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gameicons_rules as R

src, out = sys.argv[1], sys.argv[2]
load = lambda n: json.load(open(os.path.join(src, n), encoding='utf-8'))
features, traits, feats, subs = load('5e-SRD-Features.json'), load('5e-SRD-Traits.json'), load('5e-SRD-Feats.json'), load('5e-SRD-Subclasses.json')
subname = {s['index']: f"{s['name']} ({s['subclass_flavor']})" for s in subs}

def paras(lines):
    """SRD description lines → markdown paragraphs; '- ' lines become lists, '|' lines tables."""
    outl, table = [], []
    for l in lines:
        l = l.strip()
        if not l: continue
        if l.startswith('|'):
            table.append(l); continue
        if table:
            outl.append('\n'.join(table)); table = []
        l = re.sub(r'\*\*\*(.+?)\*\*\*', r'**\1**', l)
        if l.startswith('- ') and outl and outl[-1].split('\n')[-1].startswith('- '): outl[-1] += '\n' + l
        else: outl.append(l)
    if table: outl.append('\n'.join(table))
    return '\n\n'.join(outl)

def use_of(text):
    """how it's used, from the rules text: an action, a bonus action, a reaction — or always on"""
    t = text.lower()
    if re.search(r'use your reaction|as a reaction|you can use a reaction|reaction to', t): return 'reaction'
    if re.search(r'bonus action', t): return 'bonus'
    if re.search(r'use your action|as an action|use an action|take an action|your action to|an action to|magic action', t): return 'action'
    return None

def rest_of(text):
    t = text.lower()
    if re.search(r'finish a short or long rest|finish a short rest|short or long rest', t): return 'short'
    if re.search(r'finish a long rest', t): return 'long'
    return None

STUB = re.compile(r'(path|college|domain|circle|archetype|tradition|oath|origin|patron) feature$', re.I)
SCALE = re.compile(r'^(.*?)\s*\(([^)]*)\)$')
cards, by_key = [], {}
for f in features:
    name = f['name']
    if STUB.search(name): continue          # "Path feature": just says the subclass gives one at this level
    cls = f['class']['name']
    sub = subname.get(f['subclass']['index'], f['subclass']['name']) if f.get('subclass') else None
    m = SCALE.match(name)
    base, step = (m.group(1), m.group(2)) if m and not name.startswith('Draconic Ancestry') else (name, '')
    text = paras(f.get('desc', []))
    key = (cls, sub, base)
    if key in by_key:                        # the same feature, again or grown
        c = by_key[key]
        c['steps'].append([f['level'], step])
        if len(text) > len(c['text']): c['text'] = text
        continue
    c = {'id': 'srdf:' + f['index'], 'name': base, 'kind': 'class', 'cls': cls, 'level': f['level'], 'text': text, 'steps': [[f['level'], step]]}
    if sub: c['sub'] = sub
    if f.get('parent'): c['parent'] = re.sub(r'\s*\(.*\)$', '', f['parent']['name'])
    by_key[key] = c
    cards.append(c)

for t in traits:
    c = {'id': 'srdt:' + t['index'], 'name': t['name'], 'kind': 'race', 'text': paras(t.get('desc', [])),
         'races': [r['name'] for r in t.get('races', [])] + [s['name'] for s in t.get('subraces', [])]}
    if t.get('parent'): c['parent'] = t['parent']['name']
    m = re.match(r'^Draconic Ancestry \((\w+)\)$', t['name'])
    if m: c['parent'] = 'Draconic Ancestry'
    cards.append(c)
for t in feats:
    cards.append({'id': 'srdx:' + t['index'], 'name': t['name'], 'kind': 'feat', 'text': paras(t.get('desc', [])),
                  'prereq': ', '.join(f"{p['ability_score']['name']} {p['minimum_score']}" for p in t.get('prerequisites', []) if p.get('ability_score'))})

# where reading the text gets it wrong: Action Surge talks of bonus actions but costs nothing; these happen on a hit
USE_FIX = {'Action Surge': 'free', 'Divine Smite': 'free', 'Sneak Attack': 'free', 'Stunning Strike': 'free', 'Reckless Attack': 'free',
           'Channel Divinity': 'action', 'Ki': None, 'Font of Magic': None}
for c in cards:
    st = c.pop('steps', None)
    if st and (len(st) > 1 or st[0][1]): c['steps'] = st
    u, r = use_of(c['text']), rest_of(c['text'])
    if c['name'] in USE_FIX: u = USE_FIX[c['name']]
    if u: c['use'] = u
    if r: c['rest'] = r
    c['gi'] = R.feature_icon(c)

ORDER = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard']
cards.sort(key=lambda c: ({'class': 0, 'race': 1, 'feat': 2}[c['kind']], ORDER.index(c['cls']) if c.get('cls') in ORDER else 99, c.get('sub') or '', c.get('level', 0)))
json.dump({'source': 'SRD 5.1', 'credit': 'Class features, racial traits and feats from the System Reference Document 5.1 by Wizards of the Coast LLC, '
           'available under the Creative Commons Attribution 4.0 International License (creativecommons.org/licenses/by/4.0). '
           'Data prepared by the 5e-bits/5e-database project (MIT).', 'features': cards},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(cards), 'cards →', out)
