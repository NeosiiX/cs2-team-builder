"""Génère la grille des zones praticables (src/data/mapgrids.json) à partir des radars de public/maps/.
Usage : python3 tools/make_maps.py [--overlay]   (--overlay écrit des aperçus dans /tmp/claude-0/maps/)"""
import base64, json, sys, heapq
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

CELL = 8
MAPS = ['dust2', 'mirage', 'inferno']

def load(name):
    a = np.array(Image.open(f'public/maps/{name}.png').convert('RGB')).astype(float)
    return a, a.mean(axis=2)

def build(name):
    a, lum = load(name)
    px = (lum >= 38) & (lum <= 105)          # sol, zones colorées ; exclut fond, contours et caisses
    h, w = px.shape
    rows, cols = h // CELL, w // CELL
    frac = px[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).mean(axis=(1, 3))
    dark = (lum < 34)[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).any(axis=(1, 3))
    return bridge(frac >= 0.88, dark)

def los_mask(name):
    """Murs pour la ligne de vue, à demi-résolution : fond noir, traits gris et caisses bloquent la vue.
    Les marquages colorés (contour jaune des sites, vert des spawns) et les lettres blanches ne bloquent pas."""
    a, lum = load(name)
    grey = (a.max(axis=2) - a.min(axis=2)) < 28
    solid = (lum < 34) | (grey & (lum > 100) & (lum <= 200))
    h, w = solid.shape
    return solid[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2).any(axis=(1, 3))

def bridge(g, dark, radius=2):
    """Les fins traits gris du radar (marches, portes, contours de zone) coupent la carte en îlots :
    on ouvre toute cellule bloquée qui touche, dans un rayon de `radius` cellules, deux zones différentes,
    sauf si elle contient du fond noir (un vrai mur)."""
    lab, k = ndimage.label(g, structure=np.ones((3, 3)))
    out = g.copy()
    rows, cols = g.shape
    for r in range(rows):
        for c in range(cols):
            if g[r, c] or dark[r, c]:
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
        L = los_mask(n)
        out[n] = {'cell': CELL, 'cols': int(g.shape[1]), 'rows': int(g.shape[0]), 'bits': pack(g),
                  'los': {'scale': 2, 'cols': int(L.shape[1]), 'rows': int(L.shape[0]), 'bits': pack(L)}}
        if '--overlay' in sys.argv:
            Image.fromarray((~L * 255).astype(np.uint8)).save(f'/tmp/claude-0/maps/{n}_los.png')
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
