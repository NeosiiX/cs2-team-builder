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

# Analyse des cartes : par défaut, un fin trait gris qui sépare deux zones praticables est franchissable
# (seuil de porte, marquage de site, marche). Exceptions relevées carte par carte :
# - "wall" : vrai mur ou corniche infranchissable ;
# - "drop" : corniche qu'on peut sauter dans un seul sens (dx, dy = sens de la descente).
RULES = {
    # nouveau radar Dust II (style CS2) : la zone rayée (à côté du spawn CT) est un dénivelé où l'on ne voit pas à travers
    'dust2': {'wall': [], 'drop': [], 'nosight': [(616, 148, 66, 118)], 'style': 'cs2'},
    'mirage': {
        # le trait entre le haut T et le couloir des apparts T est un mur, pas un passage
        'wall': [(1046, 222, 96, 36)],
        # Short (catwalk, en hauteur) → Mid : on saute de la corniche, on ne la remonte pas
        'drop': [(674, 478, 20, 112, 1, 0)],
    },
    'inferno': {'wall': [], 'drop': []},
}

def stairs_cells(a, lum, rows, cols):
    """Escaliers : motif de hachures (au moins 3 traits fins parallèles sur 16 px)."""
    sat = a.max(axis=2) - a.min(axis=2)
    L = ((lum > 95) & (lum < 200) & (sat < 30)).astype(int)
    ex = np.zeros_like(L); ex[:, 1:] = (L[:, 1:] == 1) & (L[:, :-1] == 0)
    ey = np.zeros_like(L); ey[1:, :] = (L[1:, :] == 1) & (L[:-1, :] == 0)
    k = np.ones((1, 16))
    kx = ndimage.convolve(ex.astype(float), k, mode='constant')
    ky = ndimage.convolve(ey.astype(float), k.T, mode='constant')
    hx = ndimage.uniform_filter((kx >= 3).astype(float), size=(10, 1)) > 0.8
    hy = ndimage.uniform_filter((ky >= 3).astype(float), size=(1, 10)) > 0.8
    st = hx | hy
    return st[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).mean(axis=(1, 3)) > 0.15

def in_rects(r, c, rects):
    x, y = c * CELL + 4, r * CELL + 4
    for R in rects:
        if R[0] <= x <= R[0] + R[2] and R[1] <= y <= R[1] + R[3]:
            return R
    return None

def floor_px(name, a, lum):
    if RULES[name].get('style') == 'cs2':
        return (lum >= 52) & (lum <= 97)       # sol du bleu foncé (bas) à l'olive (haut)
    return (lum >= 38) & (lum <= 105)          # sol, zones colorées ; exclut fond, contours et caisses

def build(name):
    """Grille de marche (cellules de 8 px) + cellules à sens unique : {index: [dx, dy]}."""
    a, lum = load(name)
    px = floor_px(name, a, lum)
    h, w = px.shape
    rows, cols = h // CELL, w // CELL
    frac = px[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).mean(axis=(1, 3))
    dark = (lum < (45 if RULES[name].get('style') == 'cs2' else 34))[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL).any(axis=(1, 3))
    g = (frac >= 0.88) | (stairs_cells(a, lum, rows, cols) & ~dark)
    rules = RULES[name]
    lab, k = ndimage.label(g)
    out = g.copy()
    oneway = {}
    for r in range(rows):
        for c in range(cols):
            if g[r, c] or dark[r, c]:
                continue
            win = lab[max(0, r - 2):r + 3, max(0, c - 2):c + 3]
            if len(set(win[win > 0].tolist())) < 2:
                continue
            if in_rects(r, c, rules['wall']):
                continue
            d = in_rects(r, c, rules['drop'])
            out[r, c] = True
            if d:
                oneway[r * cols + c] = [d[4], d[5]]
    lab2, k2 = ndimage.label(out, structure=np.ones((3, 3)))
    sizes = ndimage.sum(out, lab2, range(1, k2 + 1))
    # on ne garde que la carte (pas les lettres et chiffres de la grille du radar)
    big = int(np.argmax(sizes)) + 1
    out &= lab2 == big
    lab2, k2 = ndimage.label(out, structure=np.ones((3, 3)))
    sizes = ndimage.sum(out, lab2, range(1, k2 + 1))
    print(name, 'zones connexes', k2, 'tailles', sorted([int(x) for x in sizes], reverse=True)[:4])
    return out, oneway

def los_mask(name):
    """Murs pour la ligne de vue, à demi-résolution : fond noir, traits gris et caisses bloquent la vue.
    Les marquages colorés (contour jaune des sites, vert des spawns) et les lettres blanches ne bloquent pas."""
    a, lum = load(name)
    grey = (a.max(axis=2) - a.min(axis=2)) < 28
    if RULES[name].get('style') == 'cs2':
        solid = (lum < 45) | (grey & (lum > 97))   # noir = mur ; gris clair = caisses et murets
    else:
        solid = (lum < 34) | (grey & (lum > 100) & (lum <= 200))
    for x, y, w2, h2 in RULES[name].get('nosight', []):
        solid[y:y + h2, x:x + w2] = True
    # corniches à sauter : on voit par-dessus (ex. Short qui domine Mid sur Mirage)
    for d in RULES[name]['drop']:
        x, y, w2, h2 = d[:4]
        solid[y:y + h2, x:x + w2] &= (lum[y:y + h2, x:x + w2] < 34)
    h, w = solid.shape
    return solid[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2).any(axis=(1, 3))

def levels(name, walk):
    """Étage de chaque cellule d'après la teinte du sol (radars CS2 : plus clair = plus haut) : -1, 0 ou 1."""
    if RULES[name].get('style') != 'cs2':
        return None
    a, lum = load(name)
    px = floor_px(name, a, lum)
    rows, cols = walk.shape
    L = np.where(px, lum, np.nan)[:rows * CELL, :cols * CELL].reshape(rows, CELL, cols, CELL)
    with np.errstate(all='ignore'):
        med = np.nanmedian(L.transpose(0, 2, 1, 3).reshape(rows, cols, -1), axis=2)
    lv = np.zeros((rows, cols), dtype=int)
    lv[med < 70] = -1
    lv[med > 83] = 1
    # lissage : un étage isolé de 1-2 cellules prend l'étage majoritaire autour
    lv = np.round(ndimage.median_filter(lv, size=3)).astype(int)
    lv[~walk] = 0
    return ''.join('012'[v + 1] for v in lv.flatten())

def pack(grid):
    return base64.b64encode(np.packbits(grid.astype(np.uint8).flatten()).tobytes()).decode()

if __name__ == '__main__':
    out = {}
    for n in MAPS:
        g, oneway = build(n)
        L = los_mask(n)
        out[n] = {'cell': CELL, 'cols': int(g.shape[1]), 'rows': int(g.shape[0]), 'bits': pack(g), 'oneway': oneway,
                  'levels': levels(n, g),
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
