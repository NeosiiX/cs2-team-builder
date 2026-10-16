"""
Construit les cartes « 3D » du match en direct à partir des fichiers du jeu (via awpy-data) :
- les zones du maillage de navigation (polygones en pixels du radar officiel + hauteur z),
- leurs liaisons (orientées : une chute ne se remonte pas) avec un point de passage entre deux zones,
- la visibilité entre zones, calculée par lancer de rayons à hauteur des yeux dans le maillage de collision.

Prérequis : pip install awpy ; fichiers dans ASSETS (navs/, geometry/, images/, map_data.json d'une release
https://github.com/pnxenopoulos/awpy-data/releases).
Usage : python3 tools/build_nav.py [dossier_assets]
Sortie : public/nav/<carte>.json et public/maps/<carte>.png (radar officiel).
"""
import base64, json, math, os, shutil, sys, time

import numpy as np
import awpy

ASSETS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/awpy'
MAPS = {'dust2': 'de_dust2', 'mirage': 'de_mirage', 'inferno': 'de_inferno'}
EYE = 64.0  # hauteur des yeux (unités Hammer)


def closest_on_seg(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    return (ax + dx * t, ay + dy * t)


def portal(A, B):
    """Passage entre deux polygones voisins : (point sur le bord de A, point sur le bord de B), les plus proches.
    S'il reste un petit vide entre les deux (marche, seuil, saut), le joueur le franchit en ligne droite."""
    best = None
    for first in (True, False):
        poly1, poly2 = (A, B) if first else (B, A)
        n = len(poly2)
        for p in poly1:
            for i in range(n):
                q = closest_on_seg(p, poly2[i], poly2[(i + 1) % n])
                d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
                if best is None or d < best[0]:
                    best = (d, (p, q) if first else (q, p))
    # on rentre très légèrement dans chaque zone pour que les deux points soient bien dessus
    (a, b) = best[1]
    ca = (sum(x for x, _ in A) / len(A), sum(y for _, y in A) / len(A))
    cb = (sum(x for x, _ in B) / len(B), sum(y for _, y in B) / len(B))
    inset = lambda p, c: (p[0] + (c[0] - p[0]) * 0.04, p[1] + (c[1] - p[1]) * 0.04)
    return inset(a, ca), inset(b, cb)


def build(key, name):
    md = json.load(open(os.path.join(ASSETS, 'map_data.json')))[name]
    pos_x, pos_y, scale = md['pos_x'], md['pos_y'], md['scale']
    to_radar = lambda x, y: ((x - pos_x) / scale, (pos_y - y) / scale)

    nav = awpy.NavMesh(os.path.join(ASSETS, f'{name}.nav'))
    vis = awpy.VisibilityChecker(os.path.join(ASSETS, 'geo', f'{name}.mesh'))
    ids = sorted(nav.areas['area_id'].to_list())
    index = {a: i for i, a in enumerate(ids)}
    areas = [nav.area(a) for a in ids]
    n = len(areas)

    polys2d, out_areas = [], []
    for ar in areas:
        poly = [to_radar(c[0], c[1]) for c in ar['corners']]
        polys2d.append(poly)
        cx, cy = to_radar(ar['centroid'][0], ar['centroid'][1])
        out_areas.append({
            'p': [round(v, 1) for xy in poly for v in xy],
            'pz': [round(c[2], 1) for c in ar['corners']],
            'c': [round(cx, 1), round(cy, 1)],
            'z': round(ar['centroid'][2], 1),
        })

    # liaisons orientées (+ échelles, dans les deux sens)
    for i, ar in enumerate(areas):
        links = []
        targets = [(t, 1.0) for t in ar['connections']] + [(t, 1.6) for t in ar['ladders_above'] + ar['ladders_below']]
        for t, mult in targets:
            if t not in index:
                continue
            j = index[t]
            (ax, ay), (bx, by) = portal(polys2d[i], polys2d[j])
            if math.hypot(bx - ax, by - ay) > 40:
                continue  # liaison spéciale très lointaine (téléport, échelle mal placée) : ignorée
            ci, cj = out_areas[i]['c'], out_areas[j]['c']
            cost = (math.hypot(ax - ci[0], ay - ci[1]) + math.hypot(bx - ax, by - ay) + math.hypot(cj[0] - bx, cj[1] - by)) * mult
            links.append([j, round(cost, 1), round(ax, 1), round(ay, 1), round(bx, 1), round(by, 1)])
        out_areas[i]['l'] = links

    # liaisons manquantes : le maillage du jeu ne liste parfois une liaison que dans un sens, et deux zones qui se
    # touchent ne sont pas toujours reliées. On ajoute le sens retour et les contacts quand le sol est continu
    # (moins d'une marche d'écart au point de passage) ; les vraies chutes restent à sens unique.
    def z_at(i, p):
        cs = areas[i]['corners']
        w = z = 0.0
        for c in cs:
            rx, ry = to_radar(c[0], c[1])
            d = (rx - p[0]) ** 2 + (ry - p[1]) ** 2
            if d < 1e-6:
                return c[2]
            w += 1 / d; z += c[2] / d
        return z / w
    def add_link(i, j, max_gap=3.0):
        if any(l[0] == j for l in out_areas[i]['l']):
            return False
        (ax, ay), (bx, by) = portal(polys2d[i], polys2d[j])
        if math.hypot(bx - ax, by - ay) > max_gap or abs(z_at(i, (ax, ay)) - z_at(j, (bx, by))) > 20:
            return False
        ci, cj = out_areas[i]['c'], out_areas[j]['c']
        cost = math.hypot(ax - ci[0], ay - ci[1]) + math.hypot(bx - ax, by - ay) + math.hypot(cj[0] - bx, cj[1] - by)
        out_areas[i]['l'].append([j, round(cost, 1), round(ax, 1), round(ay, 1), round(bx, 1), round(by, 1)])
        return True
    added = 0
    for i in range(n):
        for l in list(out_areas[i]['l']):
            added += add_link(l[0], i)
    boxes = [(min(x for x, _ in P), min(y for _, y in P), max(x for x, _ in P), max(y for _, y in P)) for P in polys2d]
    for i in range(n):
        bi = boxes[i]
        for j in range(i + 1, n):
            bj = boxes[j]
            if bi[0] > bj[2] + 1 or bj[0] > bi[2] + 1 or bi[1] > bj[3] + 1 or bj[1] > bi[3] + 1:
                continue
            added += add_link(i, j, 1.0) + add_link(j, i, 1.0)  # contact : bords qui se touchent (< 4 unités)
    print(f'{key}: {added} liaisons ajoutées (retours et contacts de plain-pied)')

    # visibilité : centre → centre à hauteur des yeux ; pour les grandes zones, quelques points de plus
    samples = []
    for ar in areas:
        c = ar['centroid']
        pts = [(c[0], c[1], c[2] + EYE)]
        if ar['size'] > 2500:
            for k in (0, 2):
                k %= len(ar['corners'])
                q = ar['corners'][k]
                pts.append((c[0] + (q[0] - c[0]) * 0.6, c[1] + (q[1] - c[1]) * 0.6, c[2] + (q[2] - c[2]) * 0.6 + EYE))
        samples.append(pts)
    t0 = time.time()
    bits = np.zeros(n * (n - 1) // 2, dtype=np.uint8)
    k = 0
    for i in range(n):
        si = samples[i]
        for j in range(i + 1, n):
            sj = samples[j]
            ok = vis.is_visible(si[0], sj[0])
            if not ok and (len(si) > 1 or len(sj) > 1):
                ok = any(vis.is_visible(a, b) for a in si for b in sj)
            bits[k] = ok
            k += 1
    print(f'{key}: {n} zones, visibilité {time.time() - t0:.1f} s, {bits.mean() * 100:.1f} % de paires visibles')

    zs = np.array([a['z'] for a in out_areas])
    data = {
        'map': name, 'scale': scale, 'size': 1024,
        'zMedian': float(np.median(zs)),
        'areas': out_areas,
        'vis': base64.b64encode(np.packbits(bits).tobytes()).decode(),
    }
    os.makedirs('public/nav', exist_ok=True)
    json.dump(data, open(f'public/nav/{key}.json', 'w'), separators=(',', ':'))
    shutil.copy(os.path.join(ASSETS, 'img', 'radars', f'{name}.png'), f'public/maps/{key}.png')
    return data


if __name__ == '__main__':
    for key, name in MAPS.items():
        build(key, name)
