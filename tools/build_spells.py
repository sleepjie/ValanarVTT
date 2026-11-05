"""Build table/data/spells-srd.json: every spell in the D&D 5e System Reference Document 5.1, one card each.

Source: the 5e-bits/5e-database repository (MIT), src/2014/en/5e-SRD-Spells.json, which holds the SRD 5.1 text.
The SRD 5.1 is by Wizards of the Coast LLC under the Creative Commons Attribution 4.0 International licence.

    python build_spells.py <5e-database>/src/2014/en <site>/table/data/spells-srd.json

Spells from other books (the Player's Handbook beyond the SRD, Xanathar's Guide…) aren't free to share; the GM
brings them in with Spells › Import (a 5etools-format .json file or link), and they're kept on that server only.
"""
import json, re, sys, os

src, out = sys.argv[1], sys.argv[2]
spells = json.load(open(os.path.join(src, '5e-SRD-Spells.json'), encoding='utf-8'))

def paras(lines):
    """SRD description lines → markdown paragraphs; '- ' lines become lists, '|' lines tables."""
    outl, table = [], []
    for l in lines:
        l = l.strip()
        if l.startswith('|'):
            table.append(l); continue
        if table:
            outl.append('\n'.join(table)); table = []
        # "***Bold.*** text" in the SRD source
        l = re.sub(r'\*\*\*(.+?)\*\*\*', r'**\1**', l)
        if l.startswith('- ') and outl and outl[-1].split('\n')[-1].startswith('- '): outl[-1] += '\n' + l   # one list
        else: outl.append(l)
    if table: outl.append('\n'.join(table))
    return '\n\n'.join(outl)

def comps(s):
    c = ', '.join(s.get('components', []))
    return c

res = []
for s in spells:
    sp = {
        'id': 'srd:' + s['index'], 'name': s['name'], 'level': s['level'], 'school': s['school']['name'].lower(),
        'time': s.get('casting_time', ''), 'range': s.get('range', ''), 'components': comps(s),
        'duration': s.get('duration', ''), 'source': 'SRD',
        'classes': [c['name'] for c in s.get('classes', [])],
        'text': paras(s.get('desc', [])),
    }
    if s.get('material'): sp['material'] = s['material'].rstrip('.')
    if s.get('concentration'): sp['concentration'] = True
    if s.get('ritual'): sp['ritual'] = True
    if s.get('higher_level'): sp['higher'] = paras(s['higher_level'])
    if s.get('attack_type'): sp['attack'] = s['attack_type']
    if s.get('dc'): sp['save'] = s['dc']['dc_type']['name'].upper()
    dmg = s.get('damage') or {}
    if isinstance(dmg, list): dmg = dmg[0] if dmg else {}
    if dmg.get('damage_type'): sp['damage'] = dmg['damage_type']['name'].lower()
    lv = dmg.get('damage_at_slot_level') or dmg.get('damage_at_character_level') or {}
    if lv:
        k = sorted(lv, key=int)[0]
        sp['dice'] = lv[k]
    if s.get('heal_at_slot_level'):
        k = sorted(s['heal_at_slot_level'], key=int)[0]
        sp['heal'] = s['heal_at_slot_level'][k]
    if s.get('area_of_effect'): sp['area'] = f"{s['area_of_effect']['size']}-foot {s['area_of_effect']['type']}"
    res.append(sp)

res.sort(key=lambda x: (x['level'], x['name']))
json.dump({'source': 'SRD 5.1', 'credit': 'Spells from the System Reference Document 5.1 by Wizards of the Coast LLC, '
           'available under the Creative Commons Attribution 4.0 International License (creativecommons.org/licenses/by/4.0). '
           'Data prepared by the 5e-bits/5e-database project (MIT).', 'spells': res},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(res), 'spells →', out)
