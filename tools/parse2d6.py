"""Pull feats, spells and miracles out of the 2D6 rules document into JSON for the sheet."""
import re, json, sys
src = open(sys.argv[1], encoding='utf-8').read().splitlines()
clean = lambda s: re.sub(r'\*+', '', s).strip().strip('|').strip()
def cells(line): return [clean(c) for c in line.strip().strip('|').split('|')]
feats, spells = [], []
h1 = h2 = h3 = h4 = ''
cls = None; lvl = ''
for line in src:
    m = re.match(r'^(#+)\s*(.*)$', line)
    if m:
        depth, title = len(m.group(1)), clean(m.group(2))
        if depth == 1: h1 = title
        if depth == 3: h3 = title
        if depth == 4: h4 = title
        if depth == 4 and h1 == 'Character Creation' and title in ('Fighter','Mage','Cleric','Ranger','Barbarian','Rogue'): cls = title
        if depth == 4 and title == 'General Feats': cls = 'General'
        if depth == 3 and title.startswith('Step 3'): cls = None
        continue
    if not line.startswith('|') or re.match(r'^\|\s*-', line): continue
    c = cells(line)
    if cls and len(c) >= 3:
        if c[0].lower().startswith('feat') or c[0].lower().startswith('**feat'): continue
        if cls == 'General' and len(c) >= 3:
            if c[0] in ('Feat Name',): continue
            feats.append({'cls': 'General', 'tier': '', 'name': c[0], 'pre': c[1], 'effect': c[2]})
        elif len(c) >= 4:
            if c[1] in ('Feat Name',): continue
            if c[0]: lvl = re.sub(r'[^0-9]', '', c[0]) or lvl
            if c[1]: feats.append({'cls': cls, 'tier': lvl, 'name': c[1], 'pre': c[2], 'effect': c[3]})
    if h3 == 'Conjunctive Spells' and len(c) >= 6 and c[0] != 'Spell Name':
        tn = {'Basic': '10', 'Advanced': '12', 'Master': '14'}.get(c[2], '12')
        spells.append({'name': c[0], 'school': 'Conjunctive: ' + c[1], 'tier': c[2], 'effect': c[3], 'range': c[4], 'tn': tn, 'scaling': c[-1]})
        continue
    if h3 in ('Spell Tiers & Costs',): continue
    if h1 in ('Spellcasting', 'Miracles') and len(c) >= 5 and c[0] not in ('Spell Name', 'Miracle'):
        school = h3.replace(' Spells', '') if h1 == 'Spellcasting' else 'Miracle'
        tier = (h4 if h1 == 'Spellcasting' else h3.replace(' Miracles', '')) or 'Basic'
        if h3 == 'Conjunctive Spells': tier = 'Advanced'
        if not re.match(r'^\d+$', c[3] or 'x') and not re.match(r'^\d', c[3] or ''): continue
        spells.append({'name': c[0], 'school': school, 'tier': tier if tier in ('Basic','Advanced','Master') else 'Basic', 'effect': c[1], 'range': c[2], 'tn': c[3], 'scaling': c[4]})
json.dump({'feats': feats, 'spells': spells}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(feats), 'feats', len(spells), 'spells')
from collections import Counter
print(Counter(f['cls'] for f in feats)); print(Counter((s['school'], s['tier']) for s in spells))
