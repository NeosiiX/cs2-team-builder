"""
Construit src/data/lineups.json : les lancers de grenades du match en direct, tous réalisables dans le vrai jeu.

Chaque grenade a un point d'arrivée (callout pro : fumée CT, molotov default...) et une zone d'où elle est lancée
(celle où se trouvent les joueurs à ce moment de la manche : long corner, upper tunnels, haut de banana...).
On cherche dans cette zone l'endroit le plus proche du point préféré d'où un lancer de CS2 (debout, sauté, mi-force,
lob ou en courant + saut) atteint la cible sans toucher la géométrie (voir grenades.py). Le résultat donne la position
du lanceur, le type de lancer et la vraie durée de vol.

Usage : python3 tools/build_lineups.py [dossier_assets_awpy]
"""
import json, math, os, sys
import numpy as np
import awpy

sys.path.insert(0, os.path.dirname(__file__))
import grenades as gr

ASSETS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/awpy'
MAPS = {'dust2': 'de_dust2', 'mirage': 'de_mirage', 'inferno': 'de_inferno'}

# --- définitions ------------------------------------------------------------------------------------------------
# (type, nom, cible x, y, zone de lancer (x, y, rayon), délai dans la séquence)
def S(name, at, frm, delay=0.0): return dict(kind='smoke', name=name, at=at, frm=frm, delay=delay)
def M(name, at, frm, delay=0.0): return dict(kind='molotov', name=name, at=at, frm=frm, delay=delay)
def F(name, at, frm, delay=0.0): return dict(kind='flash', name=name, at=at, frm=frm, delay=delay)

DEFS = {
    'dust2': {
        # zones de lancer (point préféré, rayon de recherche)
        'zones': {
            'longCorner': (905, 405, 50), 'tunnelMouth': (125, 300, 35), 'longDoors': (700, 640, 45), 'catBottom': (585, 415, 45),
            'upperTunnel': (110, 410, 55), 'tunnelExit': (120, 330, 30), 'tSpawn': (470, 870, 40),
            'aSite': (850, 225, 45), 'longTop': (930, 270, 40), 'shortTop': (650, 260, 35), 'longMid': (905, 415, 30), 'ctSpawn': (600, 205, 35), 'ctRamp': (690, 195, 30), 'ctMid': (500, 215, 40), 'bDoorsIn': (300, 215, 35),
            'bSite': (190, 230, 55), 'bDoors': (470, 215, 35),
        },
        'execute': {
            'A': [S('Fumée CT', (690, 180), 'longCorner'), S('Fumée Short', (648, 300), 'catBottom'),
                  M('Molotov Goose', (850, 70), 'longCorner'), M('Molotov Default', (812, 172), 'longCorner'),
                  F('Flash Long', (905, 330), 'longCorner'), F('Flash site A', (850, 185), 'longCorner')],
            'B': [S('Fumée Portes B', (278, 235), 'tunnelMouth'), S('Fumée Fenêtre', (285, 130), 'tunnelMouth'),
                  M('Molotov Back plat', (110, 60), 'upperTunnel'), M('Molotov Default B', (212, 130), 'tunnelMouth'),
                  F('Flash sortie tunnel', (120, 300), 'tunnelExit'), F('Flash site B', (190, 190), 'tunnelExit')],
        },
        'ctDelay': [
            dict(zone=(740, 620), r=100, nades=[M('Incendiaire Long doors', (725, 535), 'longMid'), F('Flash Long', (860, 520), 'longTop', 0.4)]),
            dict(zone=(150, 480), r=110, nades=[M('Incendiaire Tunnels', (115, 355), 'bSite'), F('Flash sortie tunnel', (120, 330), 'bSite', 0.5)]),
            dict(zone=(575, 410), r=75, nades=[M('Incendiaire Catwalk', (640, 330), 'shortTop')]),
        ],
        'retake': {
            'A': [F('Flash retake A', (790, 160), 'ctRamp'), S('Fumée Long', (905, 330), 'ctRamp', 0.3)],
            'B': [F('Flash retake B', (212, 130), ['bDoorsIn', 'bSite']), S('Fumée Tunnels', (112, 296), 'bDoorsIn', 0.3)],
        },
        'early': [
            dict(side='T', p=0.7, **S('Fumée Xbox', (470, 575), 'tSpawn', 4)),
            dict(side='CT', p=0.5, **S('Fumée Mid doors', (465, 330), 'ctMid', 3)),
        ],
    },
    'mirage': {
        'zones': {
            'tRamp': (765, 560, 45), 'mid': (560, 470, 50), 'aRampTop': (690, 640, 30), 'palaceExit': (655, 745, 25), 'palace': (770, 760, 55), 'apps': (340, 200, 40), 'underpass': (445, 330, 35),
            'aSiteCT': (520, 800, 45), 'jungleCT': (430, 640, 35), 'bSiteCT': (230, 300, 50), 'shortCT': (405, 420, 35),
            'ctSpawn': (330, 705, 40), 'ticket': (430, 760, 45), 'market': (250, 440, 45), 'tSpawn': (890, 360, 40),
        },
        'execute': {
            'A': [S('Fumée Jungle', (420, 640), ['tRamp', 'aRampTop']),
                  S('Fumée Stairs', (493, 723), ['tRamp', 'aRampTop']),
                  M('Molotov Firebox', (518, 748), ['palaceExit', 'aRampTop']), M('Molotov Default', (560, 785), ['palaceExit', 'aRampTop']),
                  F('Flash Palace', (605, 790), ['palaceExit', 'aRampTop']), F('Flash Ramp', (620, 680), ['aRampTop', 'tRamp'])],
            'B': [S('Fumée Kitchen', (216, 383), 'apps'),
                  M('Molotov Bench', (137, 284), 'apps'), M('Molotov Van', (270, 345), 'apps'),
                  F('Flash Apps', (300, 235), 'apps'), F('Flash site B', (232, 284), 'apps')],
        },
        'ctDelay': [
            dict(zone=(754, 649), r=108, nades=[M('Incendiaire Ramp', (650, 660), 'aSiteCT'), F('Flash Ramp', (690, 649), 'aSiteCT', 0.4)]),
            dict(zone=(787, 781), r=91, nades=[M('Incendiaire Palace', (630, 795), 'aSiteCT')]),
            dict(zone=(489, 209), r=116, nades=[M('Incendiaire Apps', (330, 230), 'bSiteCT'), F('Flash Apps', (390, 209), 'bSiteCT', 0.4)]),
        ],
        'retake': {
            'A': [F('Flash retake A', (554, 769), ['ticket', 'jungleCT', 'ctSpawn']), S('Fumée Palace', (630, 795), ['ticket', 'jungleCT', 'ctSpawn'], 0.3)],
            'B': [F('Flash retake B', (234, 284), 'market'), S('Fumée Apps', (323, 230), 'market', 0.3)],
        },
        'early': [],
    },
    'inferno': {
        'zones': {
            'banana': (500, 420, 55), 'secondMid': (700, 690, 45), 'apps': (650, 820, 45),
            'bSiteCT': (520, 235, 45), 'archCT': (800, 500, 35), 'aSiteCT': (845, 660, 45), 'ctSpawn': (880, 380, 45),
            'construction': (620, 150, 45), 'aBack': (860, 600, 40), 'bBack': (560, 200, 45), 'bananaBottom': (440, 520, 40), 'balcony': (740, 805, 35), 'bananaTop': (545, 350, 30), 'bananaTopCT': (515, 370, 20), 'tSpawn': (110, 700, 40), 'midT': (300, 650, 40),
        },
        'execute': {
            'A': [S('Fumée CT', (904, 592), 'secondMid'), S('Fumée Arch', (800, 545), 'secondMid'),
                  M('Molotov Pit', (880, 852), 'balcony'),
                  F('Flash Long', (740, 650), 'secondMid'), F('Flash Balcon', (788, 799), ['balcony', 'apps'])],
            'B': [S('Fumée CT', (610, 240), 'banana'), S('Fumée Coffins', (440, 190), 'banana'),
                  M('Molotov Dark', (546, 283), 'bananaTop'),
                  F('Flash Banana', (520, 345), 'banana'), F('Flash site B', (501, 216), ['bananaTop', 'banana'])],
        },
        'ctDelay': [
            dict(zone=(483, 503), r=143, nades=[M('Incendiaire Banana', (500, 450), 'bananaTopCT'), S('Fumée Banana', (515, 400), 'bSiteCT', 0.3), F('Flash Banana', (520, 380), 'bananaTopCT', 0.6)]),
            dict(zone=(653, 817), r=126, nades=[M('Incendiaire Balcon', (735, 800), ['aSiteCT', 'aBack'])]),
            dict(zone=(707, 646), r=99, nades=[F('Flash Long', (765, 670), ['aSiteCT', 'aBack'])]),
        ],
        'retake': {
            'A': [F('Flash retake A', (831, 700), 'aBack'), S('Fumée Pit', (880, 844), 'aBack', 0.3)],
            'B': [F('Flash retake B', (499, 225), 'bBack'), S('Fumée Banana', (520, 360), 'bSiteCT', 0.3)],
        },
        'early': [dict(side='T', p=0.45, **M('Molotov Car', (560, 380), 'bananaBottom', 9))],
    },
}

# repères de chaque carte : centres des sites et du spawn T (ligne de front des lanceurs)
SITES = {'dust2': {'A': (814, 172), 'B': (212, 128), 'T': (391, 915)},
         'mirage': {'A': (554, 779), 'B': (234, 291), 'T': (900, 372)},
         'inferno': {'A': (830, 701), 'B': (499, 221), 'T': (103, 676)}}
FLASH_FUSE = 1.6
MOLLY_MAX_AIR = 2.0


def walk_dist(nav, geo, src):
    """Distance de marche (px) de chaque zone du maillage jusqu'au point src (Dijkstra sur les liaisons)."""
    import heapq
    n = len(nav['areas'])
    out = [math.inf] * n
    fl = geo.floors(*src)
    if not fl:
        return out
    # graphe inversé : on veut la distance de chaque zone vers src
    rev = [[] for _ in range(n)]
    for i, a in enumerate(nav['areas']):
        for l in a['l']:
            rev[l[0]].append((i, l[1]))
    h = []
    for _, i in fl:  # tous les étages du point de départ
        out[i] = 0.0
        h.append((0.0, i))
    while h:
        d, i = heapq.heappop(h)
        if d > out[i]:
            continue
        for j, c in rev[i]:
            if d + c < out[j]:
                out[j] = d + c
                heapq.heappush(h, (d + c, j))
    return out


def dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def build_map(key, name):
    md = json.load(open(os.path.join(ASSETS, 'map_data.json')))[name]
    nav = json.load(open(f'public/nav/{key}.json'))
    vis = awpy.VisibilityChecker(os.path.join(ASSETS, 'geo', f'{name}.mesh'))
    geo = gr.MapGeo(nav, md, vis)
    D = DEFS[key]
    report = []
    cache = {}

    def walk(p):
        if p not in cache:
            cache[p] = walk_dist(nav, geo, p)
        return cache[p]

    def solve(spec, side, toward):
        zones = spec['frm'] if isinstance(spec['frm'], (list, tuple)) else [spec['frm']]
        # la cible exacte d'abord, puis des points voisins (une fumée couvre ~30 px, un molotov ~20 px) :
        # le lancer reste fidèle au placement pro tout en étant réalisable
        tx0, ty0 = spec['at']
        rings = [(0, 0)] + [(round(r * math.cos(a), 1), round(r * math.sin(a), 1))
                            for r in (6, 12, 18) for a in [k * math.pi / 4 for k in range(8)]]
        for ox, oy in rings:
            s2 = dict(spec, at=(tx0 + ox, ty0 + oy))
            for zname in zones:
                r = solve_zone(s2, zname, toward, last=False)
                if r:
                    if ox or oy:
                        report.append(f"  ~ {spec['name']} : cible décalée de {math.hypot(ox, oy):.0f} px")
                    return r
        report.append(f"  !! {spec['name']} ({spec['kind']}) : aucun lancer depuis {spec['frm']}")
        return None

    def solve_zone(spec, zname, toward, last):
        zx, zy, R0 = D['zones'][zname]
        tx, ty = spec['at']
        ft = geo.floor_near(tx, ty)
        if ft is None:
            # cible posée à la main juste à côté du sol (bord de mur) : on la ramène sur le sol le plus proche
            near = [(math.hypot(ox, oy), tx + ox, ty + oy) for ox in range(-15, 16, 1) for oy in range(-15, 16, 1)
                    if geo.floor_near(tx + ox, ty + oy) is not None]
            if not near:
                report.append(f"  !! {spec['name']} : cible hors du sol ({tx}, {ty})")
                return None
            _, tx, ty = min(near)
            ft = geo.floor_near(tx, ty)
            pass
        zt = ft[0]
        # centre de zone posé à la main contre un mur : ramené sur le sol le plus proche
        if not geo.floors(zx, zy):
            near = [(math.hypot(ox, oy), zx + ox, zy + oy) for ox in range(-20, 21) for oy in range(-20, 21)
                    if geo.floors(zx + ox, zy + oy)]
            if near:
                _, zx, zy = min(near)
        # étage de la zone de lancer : celui qui est relié au reste de la carte (pas un toit ou un rebord isolé)
        wt = walk(toward)
        fz = [f for f in geo.floors(zx, zy) if wt[f[1]] < math.inf]
        zpref = min(fz, key=lambda f: wt[f[1]]) if fz else geo.floor_near(zx, zy)
        for R in (R0, int(R0 * 1.8)):
            best = search(spec, zx, zy, R, tx, ty, zt, zpref, toward)
            if best:
                break
        if best is None:
            return None
        _, x, y, typ, t, elev = best
        report.append(f"  {spec['name']:<26} {spec['kind']:<8} depuis {zname:<12} ({x:.0f}, {y:.0f}) {typ:<8} {t:.2f} s  {elev:.0f}°")
        return dict(kind=spec['kind'], name=spec['name'], at=dict(x=tx, y=ty), **{'from': dict(x=round(x, 1), y=round(y, 1))},
                    air=round(t, 2), throw=typ, delay=spec['delay'])

    def search(spec, zx, zy, R, tx, ty, zt, zpref, toward):
        best = None
        wd = walk(toward)
        zc = geo.floor_near(zx, zy, zpref[0] if zpref else None)
        front = (wd[zc[1]] if zc else math.inf) - 30
        wz = walk((zx, zy))
        # candidats : grille de 3 px dans le disque, au même étage que le point préféré, triés par distance
        cands = []
        for dx in range(-R, R + 1, 3):
            for dy in range(-R, R + 1, 3):
                if dx * dx + dy * dy > R * R:
                    continue
                x, y = zx + dx, zy + dy
                f = geo.floor_near(x, y, zpref[0] if zpref else None)
                if f is None or (zpref and abs(f[0] - zpref[0]) > 80):
                    continue
                # pas plus avancé vers l'adversaire que la zone prévue (en distance de marche), et atteignable
                # depuis la zone sans faire un grand détour (pas de l'autre côté d'un mur)
                if wd[f[1]] < front or wz[f[1]] > R * 1.5 + 10:
                    continue
                # pas collé à un mur (le joueur fait 32 u de large)
                if any(geo.floor_near(x + ox, y + oy, f[0]) is None for ox, oy in ((3, 0), (-3, 0), (0, 3), (0, -3))):
                    continue
                cands.append((math.hypot(dx, dy), x, y, f[0]))
        cands.sort()
        for d, x, y, z in cands:
            if best and d > best[0]:
                break  # plus loin que le meilleur coût trouvé : inutile de continuer
            # un molotov qui vole plus de 2 s éclate en l'air sans prendre feu ; une flash éclate 1,6 s après le lancer
            max_air = {'molotov': MOLLY_MAX_AIR, 'flash': FLASH_FUSE + 0.3}.get(spec['kind'], 5.0)
            sols = gr.solve(geo, geo.world(x, y), z, geo.world(tx, ty), zt, max_air=max_air)
            for pen, typ, t, elev, apex in sols:
                cost = d + pen * 3 + t * 6
                if best is None or cost < best[0]:
                    best = (cost, x, y, typ, t, elev)
        return best

    res = {'execute': {}, 'ctDelay': [], 'retake': {}, 'early': []}
    P = SITES[key]
    for site, specs in D['execute'].items():
        report.append(f'{key} — exécution {site}')
        res['execute'][site] = [s for s in (solve(x, 'T', P[site]) for x in specs) if s]
    report.append(f'{key} — retardements CT')
    for d in D['ctDelay']:
        nades = [s for s in (solve(x, 'CT', P['T']) for x in d['nades']) if s]
        res['ctDelay'].append(dict(zone=dict(x=d['zone'][0], y=d['zone'][1]), r=d['r'], nades=nades))
    for site, specs in D['retake'].items():
        report.append(f'{key} — reprise {site}')
        res['retake'][site] = [s for s in (solve(x, 'CT', P['T']) for x in specs) if s]
    report.append(f'{key} — début de manche')
    for e in D['early']:
        s = solve(e, e['side'], P['T'] if e['side'] == 'CT' else P['A' if dist2(e['at'], P['A']) < dist2(e['at'], P['B']) else 'B'])
        if s:
            s.update(side=e['side'], p=e['p'])
            res['early'].append(s)
    print('\n'.join(report))
    return res


if __name__ == '__main__':
    only = sys.argv[2:] or list(MAPS)
    path = 'src/data/lineups.json'
    data = json.load(open(path)) if os.path.exists(path) else {}
    for key in only:
        data[key] = build_map(key, MAPS[key])
    json.dump(data, open(path, 'w'), ensure_ascii=False, indent=1)
