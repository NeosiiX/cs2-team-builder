"""Génère la grille des zones praticables (src/data/mapgrids.json) à partir des radars de public/maps/.
Usage : python3 tools/make_maps.py [--overlay]   (--overlay écrit des aperçus dans /tmp/claude-0/maps/)"""
import base64, json, sys, heapq
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

CELL = 8
MAPS = ['dust2', 'mirage', 'inferno']

def build(name):
    a = np.array(Image.open(f'public/maps/{name}.png').convert('RGB')).astype(float)
    lum = a.mean(axis=2)
    px = (lum >= 38) & (lum <= 105)          # sol, zones colorées ; exclut fond, contours et caisses
    h, w = px.shape
    rows, cols = h // CELL, w // CELL
    frac = px[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).mean(axis=(1, 3))
    return bridge(frac >= 0.88)

def bridge(g, radius=2):
    """Les fins traits gris du radar (marches, portes, contours de zone) coupent la carte en îlots :
    on ouvre toute cellule bloquée qui touche, dans un rayon de `radius` cellules, deux zones différentes."""
    lab, k = ndimage.label(g, structure=np.ones((3, 3)))
    out = g.copy()
    rows, cols = g.shape
    for r in range(rows):
        for c in range(cols):
            if g[r, c]:
                continue
            win = lab[max(0, r - radius):r + radius + 1, max(0, c - radius):c + radius + 1]
            if len(set(win[win > 0].tolist())) >= 2:
                out[r, c] = True
    return out

def pack(grid):
    return base64.b64encode(np.packbits(grid.astype(np.uint8).flatten()).tobytes()).decode()

if __name__ == '__main__':
    out = {}
    for n in MAPS:
        g = build(n)
        out[n] = {'cell': CELL, 'cols': int(g.shape[1]), 'rows': int(g.shape[0]), 'bits': pack(g)}
        if '--overlay' in sys.argv:
            im = Image.open(f'public/maps/{n}.png').convert('RGB')
            d = ImageDraw.Draw(im, 'RGBA')
            for r in range(g.shape[0]):
                for c in range(g.shape[1]):
                    if g[r, c]:
                        d.rectangle([c * CELL, r * CELL, c * CELL + CELL - 1, r * CELL + CELL - 1], fill=(0, 255, 120, 70))
            im.save(f'/tmp/claude-0/maps/{n}_mask.png')
    json.dump(out, open('src/data/mapgrids.json', 'w'))
    print({k: (v['cols'], v['rows'], len(v['bits'])) for k, v in out.items()})
