import type { MapDef, Vec, Rect, Rng } from './maps';

/**
 * Maillage de navigation 3D d'une carte (généré par tools/build_nav.py à partir des fichiers du jeu) :
 * - zones polygonales en pixels du radar officiel, chacune avec sa hauteur z (unités du jeu) ;
 * - liaisons orientées entre zones (une chute ne se remonte pas, les échelles marchent dans les deux sens),
 *   avec un point de passage entre deux zones ;
 * - visibilité entre zones, calculée à l'avance par lancer de rayons à hauteur des yeux dans le maillage
 *   de collision : murs, caisses, rebords et plafonds en 3D.
 * Deux zones superposées (une passerelle au-dessus d'un couloir) sont deux zones distinctes à des z différents.
 */

interface RawArea {
  p: number[];
  pz?: number[];
  c: [number, number];
  z: number;
  l: [number, number, number, number, number, number][];
}
interface RawNav {
  map: string;
  scale: number;
  size: number;
  zMedian: number;
  areas: RawArea[];
  vis: string;
}

export interface Area {
  poly: Vec[];
  /** hauteur de chaque coin */
  pz: number[];
  c: Vec;
  z: number;
  /** liaisons : sortie `a` sur le bord de cette zone, entrée `b` sur le bord de la zone voisine */
  links: { to: number; cost: number; a: Vec; b: Vec }[];
  box: [number, number, number, number];
}

const BUCKET = 32;

/** Point d'un trajet : `jump` = on y arrive en franchissant un petit vide entre deux zones (marche, seuil, saut) ;
 *  `anchor` = point à atteindre exactement (sortie de zone avant un tel franchissement) ; `area` = zone du point. */
export interface PathPt extends Vec {
  jump?: boolean;
  anchor?: boolean;
  area?: number;
}

/** Fente tolérée entre deux polygones voisins sur une ligne droite (px radar) : au-delà, c'est un mur. */
const GAP_TOL = 1.2;

export class Nav {
  readonly areas: Area[];
  readonly n: number;
  readonly zMedian: number;
  /** unités du jeu par pixel du radar */
  readonly scale: number;
  private vis: Uint8Array;
  private buckets = new Map<number, number[]>();

  constructor(d: RawNav) {
    this.scale = d.scale;
    this.zMedian = d.zMedian;
    this.areas = d.areas.map((a) => {
      const poly: Vec[] = [];
      for (let i = 0; i < a.p.length; i += 2) poly.push({ x: a.p[i], y: a.p[i + 1] });
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      return {
        poly,
        pz: a.pz ?? poly.map(() => a.z),
        c: { x: a.c[0], y: a.c[1] },
        z: a.z,
        links: a.l.map(([to, cost, ax, ay, bx, by]) => ({ to, cost, a: { x: ax, y: ay }, b: { x: bx, y: by } })),
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
    this.n = this.areas.length;
    const raw = atob(d.vis);
    this.vis = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.vis[i] = raw.charCodeAt(i);
    this.areas.forEach((a, i) => {
      for (let bx = Math.floor(a.box[0] / BUCKET); bx <= Math.floor(a.box[2] / BUCKET); bx++) {
        for (let by = Math.floor(a.box[1] / BUCKET); by <= Math.floor(a.box[3] / BUCKET); by++) {
          const k = by * 4096 + bx;
          const list = this.buckets.get(k);
          if (list) list.push(i);
          else this.buckets.set(k, [i]);
        }
      }
    });
  }

  private inside(i: number, x: number, y: number): boolean {
    const a = this.areas[i];
    if (x < a.box[0] - 0.5 || x > a.box[2] + 0.5 || y < a.box[1] - 0.5 || y > a.box[3] + 0.5) return false;
    const p = a.poly;
    let inside = false;
    for (let k = 0, j = p.length - 1; k < p.length; j = k++) {
      if ((p[k].y > y) !== (p[j].y > y) && x < ((p[j].x - p[k].x) * (y - p[k].y)) / (p[j].y - p[k].y || 1e-9) + p[k].x) inside = !inside;
    }
    if (inside) return true;
    // tolérance d'un demi-pixel sur les bords
    for (let k = 0, j = p.length - 1; k < p.length; j = k++) {
      if (segDist(x, y, p[j], p[k]) < 0.6) return true;
    }
    return false;
  }

  /** Zone qui contient le point (si plusieurs zones superposées : celle dont la hauteur est la plus proche de `z`). */
  locate(p: Vec, hint = -1, z?: number): number {
    if (hint >= 0 && this.inside(hint, p.x, p.y)) return hint;
    if (hint >= 0) {
      for (const l of this.areas[hint].links) if (this.inside(l.to, p.x, p.y)) return l.to;
    }
    const list = this.buckets.get(Math.floor(p.y / BUCKET) * 4096 + Math.floor(p.x / BUCKET)) ?? [];
    const zRef = z ?? (hint >= 0 ? this.areas[hint].z : undefined);
    let best = -1;
    let bd = Infinity;
    for (const i of list) {
      if (!this.inside(i, p.x, p.y)) continue;
      const d = zRef === undefined ? 0 : Math.abs(this.zAt(i, p) - zRef);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Zone la plus proche d'un point (même s'il est hors du maillage). */
  nearestArea(p: Vec, z?: number): number {
    const hit = this.locate(p, -1, z);
    if (hit >= 0) return hit;
    let best = 0;
    let bd = Infinity;
    for (let r = 1; r <= 4 && bd === Infinity; r++) {
      const bx = Math.floor(p.x / BUCKET);
      const by = Math.floor(p.y / BUCKET);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (const i of this.buckets.get((by + dy) * 4096 + bx + dx) ?? []) {
            const d = Math.hypot(this.areas[i].c.x - p.x, this.areas[i].c.y - p.y);
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
    }
    if (bd === Infinity) {
      this.areas.forEach((a, i) => {
        const d = Math.hypot(a.c.x - p.x, a.c.y - p.y);
        if (d < bd) { bd = d; best = i; }
      });
    }
    return best;
  }

  /** Point sur le maillage le plus proche de `p` (et sa zone). */
  snap(p: Vec, z?: number): { p: Vec; area: number } {
    const i = this.locate(p, -1, z);
    if (i >= 0) return { p: { ...p }, area: i };
    const j = this.nearestArea(p, z);
    const a = this.areas[j];
    // on glisse vers le centre jusqu'à entrer dans la zone
    for (let k = 1; k <= 10; k++) {
      const q = { x: p.x + (a.c.x - p.x) * (k / 10), y: p.y + (a.c.y - p.y) * (k / 10) };
      if (this.inside(j, q.x, q.y)) return { p: q, area: j };
    }
    return { p: { ...a.c }, area: j };
  }

  /** Les deux zones se voient-elles (rayon à hauteur des yeux, calculé à l'avance) ? */
  visible(i: number, j: number): boolean {
    if (i < 0 || j < 0) return false;
    if (i === j) return true;
    if (i > j) [i, j] = [j, i];
    const k = i * (2 * this.n - i - 1) / 2 + (j - i - 1);
    return ((this.vis[k >> 3] >> (7 - (k & 7))) & 1) === 1;
  }

  /** Plus court chemin (A* sur les zones, liaisons orientées) : points de passage puis la destination. */
  path(from: Vec, fromArea: number, to: Vec, toArea: number): PathPt[] {
    if (fromArea < 0 || toArea < 0) return [{ ...to }];
    if (fromArea === toArea) return [{ ...to }];
    const n = this.n;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const via: ({ a: Vec; b: Vec } | null)[] = new Array(n).fill(null);
    const goal = this.areas[toArea].c;
    const h = (i: number) => Math.hypot(this.areas[i].c.x - goal.x, this.areas[i].c.y - goal.y);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    cost[fromArea] = 0;
    push(h(fromArea), fromArea);
    let found = false;
    while (heap.length) {
      const [f, cur] = pop();
      if (cur === toArea) { found = true; break; }
      if (f - h(cur) > cost[cur] + 1e-6) continue;
      for (const l of this.areas[cur].links) {
        const c = cost[cur] + l.cost;
        if (c < cost[l.to]) {
          cost[l.to] = c;
          prev[l.to] = cur;
          via[l.to] = l;
          push(c + h(l.to), l.to);
        }
      }
    }
    if (!found) return [];
    const rev: PathPt[] = [{ ...to, area: toArea }];
    for (let i = toArea; i !== fromArea && i >= 0; i = prev[i]) {
      const l = via[i];
      if (!l) continue;
      const gapLen = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
      if (gapLen > 0.8) {
        rev.push({ ...l.b, jump: true, anchor: true, area: i });
        rev.push({ ...l.a, anchor: true, area: prev[i] });
      } else {
        rev.push({ ...l.b, area: i });
      }
    }
    rev.reverse();
    return this.smooth(from, fromArea, rev);
  }

  /**
   * Le segment a→b reste-t-il sur le maillage, sans saut de hauteur (pas de raccourci à travers un mur,
   * ni par-dessus le vide, ni d'un étage à l'autre) ? Renvoie la zone d'arrivée, ou -1.
   */
  straight(a: Vec, b: Vec, area: number, tol = GAP_TOL): number {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    let h = area;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const k = this.locate(q, h);
      if (k < 0) {
        // les polygones du maillage ne se touchent pas parfaitement : fente de moins de 3 px tolérée
        if (this.gap(q, h) > tol) return -1;
        continue;
      }
      if (h >= 0 && k !== h && !this.canPass(h, k, q)) return -1;
      h = k;
    }
    return h;
  }

  /** Distance libre (px) en marchant tout droit depuis `p` dans la direction `ang`, jusqu'à `max`. */
  freeRun(p: Vec, area: number, ang: number, max = 120): number {
    const dx = Math.cos(ang) * 3;
    const dy = Math.sin(ang) * 3;
    let h = area;
    let q = p;
    for (let d = 3; d <= max; d += 3) {
      q = { x: q.x + dx, y: q.y + dy };
      const k = this.locate(q, h);
      if (k < 0) {
        // pour le regard, une fente entre deux polygones (rebord, marche) ne bouche pas la vue ; un mur, si
        if (this.gap(q, h) > 4) return d - 3;
        continue;
      }
      // un sol nettement plus haut devant soi (muret, caisse, étage) bouche la vue ; un escalier ou un sol plus bas non
      if (h >= 0 && k !== h && this.zAt(k, q) - this.zAt(h, q) > 40 && !this.linked(h, k)) return d - 3;
      h = k;
    }
    return max;
  }

  /**
   * Direction de regard depuis `p` : la plus proche de `want` (d'où viendra l'ennemi) parmi celles qui ne donnent
   * pas sur un mur tout proche. On évite ainsi les joueurs qui fixent un mur.
   */
  openAngle(p: Vec, area: number, want: number): number {
    if (area < 0) return want;
    let best = want;
    let score = -Infinity;
    for (let i = 0; i < 24; i++) {
      const ang = want + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 12;
      const free = this.freeRun(p, area, ang);
      const diff = Math.abs(Math.atan2(Math.sin(ang - want), Math.cos(ang - want)));
      const sc = Math.min(free, 90) / 90 * 1.4 + Math.cos(diff) - (free < 35 ? 2 : 0);
      if (sc > score) { score = sc; best = ang; }
    }
    return best;
  }

  /** Hauteur du sol au point `p` de la zone `i` (interpolée entre les coins). */
  zAt(i: number, p: Vec): number {
    const a = this.areas[i];
    let w = 0;
    let z = 0;
    for (let k = 0; k < a.poly.length; k++) {
      const d = Math.hypot(a.poly[k].x - p.x, a.poly[k].y - p.y);
      if (d < 0.05) return a.pz[k];
      const wk = 1 / (d * d);
      w += wk;
      z += wk * a.pz[k];
    }
    return w ? z / w : a.z;
  }

  /**
   * Passage au point `q` de la zone i à la zone j : par une liaison du maillage, ou de plain-pied
   * (sol continu, moins d'une marche d'écart). Jamais d'un étage à l'autre à travers le sol.
   */
  canPass(i: number, j: number, q: Vec): boolean {
    if (i < 0 || j < 0 || i === j) return true;
    if (Math.abs(this.zAt(i, q) - this.zAt(j, q)) <= 20) return true;
    return this.linked(i, j);
  }

  /** On peut passer de la zone i à la zone j (liaison directe ou via une petite zone intermédiaire). */
  linked(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i === j) return true;
    const li = this.areas[i].links;
    for (const l of li) if (l.to === j) return true;
    for (const l of li) for (const l2 of this.areas[l.to].links) if (l2.to === j) return true;
    return false;
  }

  /** Distance (px radar) d'un point au maillage, à l'étage de la zone `hint`. */
  gap(p: Vec, hint: number): number {
    const sn = this.snap(p, hint >= 0 ? this.areas[hint].z : undefined);
    return Math.hypot(sn.p.x - p.x, sn.p.y - p.y);
  }

  /** Lissage « ficelle tendue » : on saute les points de passage tant que la ligne droite reste praticable. */
  private smooth(from: Vec, fromArea: number, pts: PathPt[]): PathPt[] {
    const raw: PathPt[] = [{ ...from, area: fromArea }, ...pts];
    const out: PathPt[] = [];
    let i = 0;
    let area = fromArea;
    while (i < raw.length - 1) {
      // on ne saute jamais un point obligatoire (sortie de zone / arrivée d'un franchissement)
      let limit = Math.min(raw.length - 1, i + 14);
      for (let k = i + 1; k <= limit; k++) if (raw[k].anchor) { limit = k; break; }
      let j = limit;
      let reached = -1;
      if (!raw[i + 1].jump) {
        for (; j > i + 1; j--) {
          reached = this.straight(raw[i], raw[j], area);
          if (reached >= 0) break;
        }
      } else j = i + 1;
      out.push(raw[j]);
      area = raw[j].area ?? (reached >= 0 ? reached : this.nearestArea(raw[j]));
      i = j;
    }
    return out;
  }

  /** Point au hasard sur le maillage dans un rectangle (le plus proche du centre si aucun). */
  randomIn(r: Rect, rng: Rng, margin = 0): { p: Vec; area: number } {
    for (let i = 0; i < 30; i++) {
      const p = { x: r.x + margin + rng() * Math.max(1, r.w - 2 * margin), y: r.y + margin + rng() * Math.max(1, r.h - 2 * margin) };
      const a = this.locate(p);
      if (a >= 0 && (this.roomy(a) || i > 20)) return { p, area: a };
    }
    return this.snap({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  }

  /** Zone assez large pour s'y poster (pas un rebord ou une marche de 2 px). */
  roomy(i: number): boolean {
    const b = this.areas[i].box;
    return b[2] - b[0] >= 5 && b[3] - b[1] >= 5;
  }

  /** Point au hasard proche de `p`, à peu près au même étage. */
  scatter(p: Vec, area: number, radius: number, rng: Rng): { p: Vec; area: number } {
    const z = area >= 0 ? this.areas[area].z : undefined;
    for (let i = 0; i < 14; i++) {
      const q = { x: p.x + (rng() - 0.5) * 2 * radius, y: p.y + (rng() - 0.5) * 2 * radius };
      const a = this.locate(q, area, z);
      if (a >= 0 && (z === undefined || Math.abs(this.areas[a].z - z) < 70) && this.roomy(a)) return { p: q, area: a };
    }
    return { p: { ...p }, area };
  }
}

function segDist(x: number, y: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
  return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
}

/* ---------- chargement ---------- */
const cache = new Map<string, Nav>();
const loading = new Map<string, Promise<Nav>>();

export function loadNav(map: MapDef): Promise<Nav> {
  const hit = cache.get(map.id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(map.id);
  if (!p) {
    p = fetch(`/nav/${map.id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`nav ${map.id} : ${r.status}`);
        return r.json();
      })
      .then((d: RawNav) => {
        const nav = new Nav(d);
        cache.set(map.id, nav);
        return nav;
      });
    loading.set(map.id, p);
  }
  return p;
}

/** Maillage déjà chargé (loadNav doit avoir été attendu avant le match). */
export function navOf(map: MapDef): Nav {
  const n = cache.get(map.id);
  if (!n) throw new Error(`maillage ${map.id} non chargé`);
  return n;
}
