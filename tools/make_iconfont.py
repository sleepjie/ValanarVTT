"""Builds vtt-icons.woff2: a stand-in for Roll20's Pictos icon font (which is Roll20's, not ours to ship).
Known Pictos letters map to similar symbols from DejaVu Sans (free licence, renamed as its licence asks);
every other printable ASCII letter draws nothing, so sheets don't show stray 'y' or 'k'."""
import sys
from fontTools.ttLib import TTFont
from fontTools import subset
SRC = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MAP = {'&': 0x271A, '(': 0x270E, ')': 0x2713, '3': 0x2713, '#': 0x2715, 'y': 0x2699, 'x': 0x2715, '+': 0x271A,
       'k': 0x2630, 'E': 0x270E, 'l': 0x2630, '%': 0x2699, '0': 0x2630, 'Q': 0x2630, 'r': 0x21BB, '9': 0x2713}
f = TTFont(SRC)
cmap = f.getBestCmap()
need = {cmap[u] for u in MAP.values()} | {cmap[0x20]}
opts = subset.Options(); opts.glyph_names = True; opts.notdef_outline = True; opts.layout_features = []
sub = subset.Subsetter(opts); sub.populate(glyphs=sorted(need)); sub.subset(f)
space = cmap[0x20]
for t in f['cmap'].tables:
    if not t.isUnicode(): continue
    t.cmap = {}
    for c in range(0x21, 0x7F): t.cmap[c] = space
    for ch, u in MAP.items(): t.cmap[ord(ch)] = cmap[u]
    t.cmap[0x20] = space
for rec in f['name'].names:
    if rec.nameID in (1, 3, 4, 6, 16): rec.string = 'VTT Icons'
f.flavor = 'woff2'
f.save(sys.argv[1])
