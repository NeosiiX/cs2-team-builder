"""
Physique des grenades de CS2 (reprise du code du jeu) et recherche de lancers réalisables.

- vitesse de lancer : 750 × 0,9 = 675 u/s (clic gauche), × 0,65 (deux clics, mi-distance), × 0,3 (clic droit, lob)
- le regard est relevé de 10° à l'horizontale (angThrow.x -= (90 - |pitch|) × 10/90)
- vitesse du joueur ajoutée × 1,25 : en courant (+306 u/s vers l'avant), en sautant (jumpthrow : la grenade part au
  début du saut et hérite de l'élan vertical, ~+300 u/s)
- gravité des grenades : 800 × 0,4 = 320 u/s², pas de frottement de l'air
- départ à hauteur des yeux (64 u)

Un lancer est validé si la trajectoire balistique, découpée en petits segments, ne touche aucune géométrie du maillage
de collision (rayons awpy.VisibilityChecker) et retombe sur le point visé, au niveau du sol.
"""
import json, math
import numpy as np

G = 320.0
EYE = 64.0
JUMP_VZ = 300.0  # élan vertical hérité d'un jumpthrow
V = 675.0
RUN = 245.0 * 1.25  # grenade en main

# types de lancers : (nom, vitesse, élan vertical ajouté, vitesse de course ajoutée, pénalité de choix)
THROWS = [
    ('stand', V, 0.0, 0.0, 0.0),
    ('jump', V, JUMP_VZ, 0.0, 6.0),
    ('mid', V * 0.65, 0.0, 0.0, 4.0),
    ('lob', V * 0.3, 0.0, 0.0, 8.0),
    ('runjump', V, JUMP_VZ, RUN, 14.0),
]


class MapGeo:
    def __init__(self, nav_json, md, vis):
        self.nav = nav_json
        self.pos_x, self.pos_y, self.scale = md['pos_x'], md['pos_y'], md['scale']
        self.vis = vis
        self.polys = []
        for a in nav_json['areas']:
            p = a['p']
            self.polys.append((np.array(p[0::2]), np.array(p[1::2]), np.array(a['pz'])))
        self.boxes = np.array([[px.min(), py.min(), px.max(), py.max()] for px, py, _ in self.polys])

    def world(self, x, y):
        return (x * self.scale + self.pos_x, self.pos_y - y * self.scale)

    def radar(self, wx, wy):
        return ((wx - self.pos_x) / self.scale, (self.pos_y - wy) / self.scale)

    def floors(self, x, y):
        """Toutes les hauteurs de sol au point (x, y) (une par étage)."""
        out = []
        b = self.boxes
        idx = np.nonzero((b[:, 0] - 0.3 <= x) & (b[:, 2] + 0.3 >= x) & (b[:, 1] - 0.3 <= y) & (b[:, 3] + 0.3 >= y))[0]
        for i in idx:
            px, py, pz = self.polys[i]
            if inside(px, py, x, y):
                d = np.hypot(px - x, py - y)
                if d.min() < 1e-3:
                    z = float(pz[d.argmin()])
                else:
                    w = 1 / d ** 2
                    z = float((w * pz).sum() / w.sum())
                out.append((z, int(i)))
        return out

    def floor_near(self, x, y, zref=None):
        fl = self.floors(x, y)
        if not fl:
            return None
        if zref is None:
            return max(fl)  # plusieurs étages : celui du dessus (à ciel ouvert, là où retombe une grenade)
        return min(fl, key=lambda f: abs(f[0] - zref))

    def clear(self, a, b):
        return self.vis.is_visible(tuple(a), tuple(b))


def inside(px, py, x, y):
    n = len(px)
    c = False
    j = n - 1
    for i in range(n):
        if (py[i] > y) != (py[j] > y) and x < (px[j] - px[i]) * (y - py[i]) / (py[j] - py[i] + 1e-12) + px[i]:
            c = not c
        j = i
    return c


def landing(v, jump_vz, run, elev, dz):
    """Distance horizontale parcourue quand la grenade redescend à dz (relatif au départ), et durée de vol."""
    vx = v * math.cos(elev) + run
    vz = v * math.sin(elev) + jump_vz
    # z(t) = vz t - G t²/2 = dz  → t = (vz + sqrt(vz² - 2 G dz)) / G (racine descendante)
    disc = vz * vz - 2 * G * dz
    if disc < 0:
        return None
    t = (vz + math.sqrt(disc)) / G
    if t <= 0:
        return None
    return vx * t, t, vx, vz


def solve(geo, start_w, z0, target_w, zt, throws=THROWS, max_air=4.0, max_elev=80.0):
    """
    Lancers possibles depuis start_w (x, y monde), sol z0, vers target_w (x, y), sol zt.
    Renvoie une liste de (pénalité, type, durée de vol, élévation en degrés, apogée).
    """
    dx, dy = target_w[0] - start_w[0], target_w[1] - start_w[1]
    d = math.hypot(dx, dy)
    if d < 1:
        return []
    ux, uy = dx / d, dy / d
    out = []
    for name, v, eh, run, pen in throws:
        h0 = z0 + EYE
        dz = (zt + 6) - h0
        # recherche des élévations (regard effectif) qui retombent exactement à distance d
        prev = None
        cands = []
        for k in range(-60, 179):
            e = math.radians(k * 0.5)
            r = landing(v, eh, run, e, dz)
            f = None if r is None else r[0] - d
            if prev is not None and f is not None and prev[1] is not None and (prev[1] <= 0) != (f <= 0):
                lo, hi = prev[0], e
                flo = prev[1]
                for _ in range(30):
                    mid = (lo + hi) / 2
                    rm = landing(v, eh, run, mid, dz)
                    fm = rm[0] - d if rm else None
                    if fm is None:
                        break
                    if (fm <= 0) == (flo <= 0):
                        lo, flo = mid, fm
                    else:
                        hi = mid
                cands.append((lo + hi) / 2)
            prev = (e, f)
        for e in cands:
            r = landing(v, eh, run, e, dz)
            if not r:
                continue
            _, t, vx, vz = r
            if t > max_air or math.degrees(e) > max_elev:
                continue
            # trajectoire découpée en segments
            n = max(8, int(t / 0.05))
            pts = []
            for i in range(n + 1):
                tt = t * i / n
                s = vx * tt
                pts.append((start_w[0] + ux * s, start_w[1] + uy * s, h0 + vz * tt - G * tt * tt / 2))
            ok = all(geo.clear(pts[i], pts[i + 1]) for i in range(n))
            if not ok:
                continue
            apex = h0 + vz * vz / (2 * G) if vz > 0 else h0
            # visée « réaliste » : le regard (avant relèvement de 10°) reste entre -80° et 89°
            out.append((pen + (4 if math.degrees(e) > 65 else 0), name, t, math.degrees(e), apex))
    return out
