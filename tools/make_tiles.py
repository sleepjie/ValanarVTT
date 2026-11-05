#!/usr/bin/env python3
"""Cut a world map picture into map tiles for the site.

    python tools/make_tiles.py my_world.png            # webp tiles (small, look the same)
    python tools/make_tiles.py my_world.png --png      # lossless png tiles (several times bigger)

Writes, next to index.html:
    tiles/<zoom>/<row>/<column>.webp   the tiles (256 x 256), the old tiles folder is replaced
    mapinfo.js                         the picture's size, read by the map
    data/land.js                       a land mask (only when the picture has a transparent sea): the animated
                                       sea shows through and the borders layer follows the coast

Uses libvips when it's installed (fast, handles huge maps in little memory: https://www.libvips.org), otherwise
Pillow (pip install pillow), which is slower and needs memory about 4 bytes per map pixel.
On Windows, make_tiles.bat does the same with libvips, downloading it the first time.
"""
import base64, io, math, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE = 256


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    png = '--png' in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    src = os.path.abspath(args[0])
    if not os.path.exists(src):
        sys.exit(f'Cannot find {src}')
    out = os.path.join(ROOT, 'tiles')
    if os.path.exists(out):
        shutil.rmtree(out)
    ext = '.png' if png else '.webp'
    if shutil.which('vips') and shutil.which('vipsheader'):
        w, h, transparent = with_vips(src, out, png)
    else:
        w, h, transparent = with_pillow(src, out, ext)
    with open(os.path.join(ROOT, 'mapinfo.js'), 'w') as f:
        f.write(f'window.MAP_INFO = {{ width: {w}, height: {h}, ext: "{ext}", transparent: {"true" if transparent else "false"} }};\n')
    print(f'Done: {w} x {h} map, tiles in {out}')


def with_vips(src, out, png):
    head = lambda field: subprocess.check_output(['vipsheader', '-f', field, src], text=True).strip()
    w, h, bands = int(head('width')), int(head('height')), int(head('bands'))
    transparent = bands in (2, 4)
    print(f'Map {w} x {h}, tiling with libvips…')
    suffix = '.png' if png else '.webp[Q=90]'
    subprocess.check_call(['vips', 'dzsave', src, out, '--layout', 'google', '--suffix', suffix, '--background', '0', '--skip-blanks', '0'])
    if transparent:
        tmp = os.path.join(ROOT, 'tools', '_land.png')
        subprocess.check_call(['vips', 'shrink', src, tmp + '.v', '8', '8'])
        subprocess.check_call(['vips', 'extract_band', tmp + '.v', tmp, str(bands - 1)])
        write_land(open(tmp, 'rb').read())
        os.remove(tmp); os.remove(tmp + '.v')
    return w, h, transparent


def with_pillow(src, out, ext):
    try:
        from PIL import Image
    except ImportError:
        sys.exit('Install libvips (https://www.libvips.org) or Pillow (pip install pillow) first.')
    Image.MAX_IMAGE_PIXELS = None
    img = Image.open(src)
    transparent = img.mode in ('RGBA', 'LA', 'PA') or 'transparency' in img.info
    img = img.convert('RGBA' if transparent else 'RGB')
    w, h = img.size
    top = max(0, math.ceil(math.log2(max(w, h) / TILE)))
    print(f'Map {w} x {h}, {top + 1} zoom levels, tiling with Pillow…')
    level = img
    for z in range(top, -1, -1):
        k = 2 ** (z - top)
        lw, lh = max(1, round(w * k)), max(1, round(h * k))
        if level.size != (lw, lh):
            level = level.resize((lw, lh), Image.LANCZOS)
        cols, rows = math.ceil(lw / TILE), math.ceil(lh / TILE)
        for y in range(rows):
            os.makedirs(os.path.join(out, str(z), str(y)), exist_ok=True)
            for x in range(cols):
                tile = Image.new(level.mode, (TILE, TILE), (0, 0, 0, 0) if transparent else (0, 0, 0))
                tile.paste(level.crop((x * TILE, y * TILE, min(lw, (x + 1) * TILE), min(lh, (y + 1) * TILE))), (0, 0))
                path = os.path.join(out, str(z), str(y), f'{x}{ext}')
                if ext == '.webp':
                    tile.save(path, 'WEBP', quality=90, method=4)
                else:
                    tile.save(path, 'PNG', optimize=True)
        print(f'  zoom {z}: {cols} x {rows} tiles')
    if transparent:
        small = img.getchannel('A').resize((max(1, w // 8), max(1, h // 8)), Image.BOX)
        buf = io.BytesIO(); small.save(buf, 'PNG', optimize=True)
        write_land(buf.getvalue())
    return w, h, transparent


def write_land(png_bytes):
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'land.js'), 'w') as f:
        f.write("// Land mask from the map's transparency: 1 pixel per 8 map pixels, white = land.\n")
        f.write("window.VALANAR_LAND = { scale: 8, src: 'data:image/png;base64," + base64.b64encode(png_bytes).decode() + "' };\n")
    print('Land mask written to data/land.js')


if __name__ == '__main__':
    main()
