# Your world

## The map picture

Draw or export your world map as one PNG at the size you want people to zoom into: there's no real limit (maps of
20,000+ pixels across work well). Any map-making tool will do (Wonderdraft, Inkarnate, Photoshop, hand-drawn and scanned).

**A transparent sea** is worth it: the site draws an animated sea under the map, and works out the coastline from the
transparency so the borders layer stops at the shore.

Then cut it into tiles:

```
python tools/make_tiles.py my_world.png          # .webp tiles, small and sharp
python tools/make_tiles.py my_world.png --png    # lossless, several times bigger
```

It uses [libvips](https://www.libvips.org) if installed (fast, and happy with huge maps), otherwise Pillow
(`pip install pillow`; slower, and needs about 4 bytes of memory per map pixel). On Windows, drag the PNG onto
`make_tiles.bat`: it downloads libvips the first time. Reload the site afterwards.

It writes `tiles/`, `mapinfo.js` (the picture's size) and, with a transparent sea, `data/land.js` (the coastline).
Places keep their positions as long as the new picture is the same size.

## Places

Switch **Edit map** on (top right; admins only). Pick an icon type from the palette and click the map; drag places
to move them; click one to edit its name, type, nation and details, or link it to a wiki page. **Types** sets each
type's icon, size, and the zoom levels where it shows and where its name appears.

**From a spreadsheet:** *Import CSV* takes columns like Name, Type, Nation, Region, Population. Imported places wait
in *Unplaced* until you click each one onto the map.

**Your own icons:** upload pictures (PNG, WebP or SVG) into a Files folder called **Map icons**, then *Rescan icons*
in the edit bar. The default set is in `icons/default`.

## Nations and borders

**Borders** in the edit bar: add nations with names and colours, draw borders with the pen, or *claim* land by
clicking it, which fills the area inside its borders and the coast. Visitors see nations with the Borders button (B).

## Distances

The ruler needs to know how many miles one map pixel is. Measure a route you know the length of (Ruler, click
along it), then in Edit mode press **Set the scale from this route** and type its length in miles. Travel paces
(miles per hour and hours a day for each way of travelling) can be changed in the ruler box while editing.

## Pages

Start with **Wiki › New page**, or bring what you have:

- **Google Docs:** *Import a document*, paste the link (shared as anyone with the link). Each import becomes a new
  page; links between docs you've imported become wiki links.
- **Word or Markdown files:** *Import a document*, choose the file.
- **A whole folder of Markdown (Obsidian, another wiki):** zip it and upload it in **Admin › Bring in a wiki**.

Link a place to a page (its *wiki* field, or a page with the same name) and clicking the place opens the page; the
page gets a *Show on the map* button. A nation's page lists its settlements.

See the *Help/Formatting* page in the example wiki for infoboxes, references, categories and GM-only notes.

## Clearing out the example

Delete the example pages in **Files** (and empty the Bin), and the example places in Edit map. Or start completely
fresh: stop the site, delete `vtt-data/site/`, replace `data/markers.js` and `data/wiki.js` with your own (or
empty ones), and start it again: those two files are only read the first time.
