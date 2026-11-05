"""Builds table/sheets/dnd5e_legacy from Roll20's DD5thEditionLegacy files.
Usage: build_legacy.py <dir with legacy.html legacy.css legacy_en.json> <out dir>"""
import re, json, sys, os, shutil
sys.path.insert(0, os.path.dirname(__file__)); import legacy_prefix as L
src, out = sys.argv[1], sys.argv[2]
IMG = 'https://raw.githubusercontent.com/Roll20/roll20-character-sheets/master/DD5thEditionLegacy/images/'
LOCAL = '/table/sheets/dnd5e_legacy/images/'
s = open(os.path.join(src, 'legacy.html'), encoding='utf-8').read()
# skip Roll20's character builder (it needs Roll20's compendium)
s = s.replace("<input type='hidden' name='attr_l1mancer_status' value=''>", "<input type='hidden' name='attr_l1mancer_status' value='completed'>")
s = L.run(s).replace(IMG, LOCAL)
# Roll20's SRD5 / Roll20 logo makes way for a plain title of the same height
s = re.sub(r'<img src="/table/sheets/dnd5e_legacy/images/srd5_360\.png"[^>]*>', '<div class="sheet-vtt-title">Dungeons &amp; Dragons<span>5th Edition</span></div>', s)
open(os.path.join(out, 'sheet.html'), 'w', encoding='utf-8').write(s)
open(os.path.join(out, 'templates.html'), 'w', encoding='utf-8').write('\n'.join(re.findall(r'<rolltemplate[\s\S]*?</rolltemplate>', s)))
css = open(os.path.join(src, 'legacy.css'), encoding='utf-8').read().replace(IMG, LOCAL)
# Our fields sit a little shorter than Roll20's, so the page tabs (placed at a fixed height) would land on the third column
css += '''
/* the death-save boxes: snug enough that three fit beside the label */
.sheet-hdice-dsaves-container .sheet-row-container { white-space: nowrap; margin-right: 2px; }
.sheet-hdice-dsaves-container .sheet-row-container input[type=checkbox] { margin: 2px 1px; }
.sheet-vtt-title { height: 38px; margin-bottom: 5px; font: 700 21px/1 Georgia, "Times New Roman", serif; color: #8b1e1e; letter-spacing: 0.01em; padding-top: 4px; white-space: nowrap; }
.sheet-vtt-title span { display: block; font: italic 12px/1.4 Georgia, serif; color: #6b5a48; }
/* Valanar table: lift the page tabs clear of the columns */
input[type=radio].sheet-tab-button, input[type=radio].sheet-tab-button + span, .sheet-advantagetoggle { top: 76px; }
input[type=radio].sheet-tab-button + span { z-index: 1; }
'''
open(os.path.join(out, 'sheet.css'), 'w', encoding='utf-8').write(css)
json.dump(json.load(open(os.path.join(src, 'legacy_en.json'), encoding='utf-8')), open(os.path.join(out, 'translation.json'), 'w', encoding='utf-8'), ensure_ascii=False)
