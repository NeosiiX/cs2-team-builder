import grids from './data/mapgrids.json';

/**
 * Cartes du match en direct. Chaque carte = une image radar (public/maps/) + une grille des zones praticables
 * (générée depuis l'image par tools/make_maps.py) + quelques repères : spawns, sites, routes d'attaque.
 * Les déplacements sont calculés sur la grille (A*), donc les joueurs suivent vraiment les couloirs du radar.
 */

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Rng = () => number;
export type SiteId = 'A' | 'B';

export interface MapDef {
  id: string;
  name: string;
  image: string;
  w: number;
  h: number;
  /** partie de l'image affichée (le radar n'en occupe qu'une partie) */
  view: Rect;
  tSpawn: Rect;
  ctSpawn: Rect;
  sites: Record<SiteId, Rect>;
  /** emplacement de la bombe sur chaque site */
  bomb: Record<SiteId, Vec>;
  /** itinéraires d'attaque vers chaque site : points de passage (le joueur finit sur le site) */
  routes: Record<SiteId, Vec[][]>;
  /** poste des CT au milieu de la carte */
  mid: Vec;
}

export const MAPS: MapDef[] = [
  {
    id: 'dust2', name: 'Dust II', image: '/maps/dust2.png', w: 1600, h: 1200,
    view: { x: 300, y: 70, w: 1000, h: 1060 },
    tSpawn: { x: 540, y: 990, w: 165, h: 80 },
    ctSpawn: { x: 866, y: 240, w: 92, h: 104 },
    sites: { A: { x: 1070, y: 218, w: 66, h: 68 }, B: { x: 452, y: 166, w: 80, h: 86 } },
    bomb: { A: { x: 1102, y: 254 }, B: { x: 490, y: 208 } },
    routes: {
      A: [
        [{ x: 900, y: 1040 }, { x: 1010, y: 700 }, { x: 1180, y: 560 }],
        [{ x: 790, y: 900 }, { x: 760, y: 560 }, { x: 930, y: 470 }, { x: 940, y: 330 }],
      ],
      B: [
        [{ x: 560, y: 900 }, { x: 455, y: 640 }, { x: 400, y: 520 }, { x: 385, y: 420 }],
        [{ x: 790, y: 900 }, { x: 750, y: 540 }, { x: 700, y: 330 }, { x: 600, y: 240 }],
      ],
    },
    mid: { x: 745, y: 430 },
  },
  {
    id: 'mirage', name: 'Mirage', image: '/maps/mirage.png', w: 1600, h: 1200,
    view: { x: 290, y: 150, w: 1020, h: 900 },
    tSpawn: { x: 1220, y: 372, w: 72, h: 108 },
    ctSpawn: { x: 456, y: 770, w: 138, h: 112 },
    sites: { A: { x: 796, y: 880, w: 86, h: 76 }, B: { x: 410, y: 281, w: 86, h: 94 } },
    bomb: { A: { x: 838, y: 917 }, B: { x: 452, y: 328 } },
    routes: {
      A: [
        [{ x: 1255, y: 560 }, { x: 1250, y: 700 }, { x: 1170, y: 830 }, { x: 1080, y: 930 }],
        [{ x: 1250, y: 320 }, { x: 1040, y: 260 }, { x: 1020, y: 430 }, { x: 880, y: 560 }, { x: 800, y: 700 }],
      ],
      B: [
        [{ x: 1250, y: 320 }, { x: 1050, y: 215 }, { x: 900, y: 190 }, { x: 690, y: 255 }, { x: 560, y: 250 }],
        [{ x: 1250, y: 320 }, { x: 1040, y: 260 }, { x: 1020, y: 430 }, { x: 880, y: 560 }, { x: 700, y: 500 }, { x: 690, y: 360 }],
      ],
    },
    mid: { x: 700, y: 560 },
  },
  {
    id: 'inferno', name: 'Inferno', image: '/maps/inferno.png', w: 1600, h: 1200,
    view: { x: 270, y: 80, w: 1060, h: 1040 },
    tSpawn: { x: 304, y: 742, w: 66, h: 104 },
    ctSpawn: { x: 1206, y: 372, w: 70, h: 148 },
    sites: { A: { x: 1108, y: 762, w: 78, h: 118 }, B: { x: 734, y: 236, w: 88, h: 100 } },
    bomb: { A: { x: 1148, y: 820 }, B: { x: 778, y: 290 } },
    routes: {
      A: [
        [{ x: 520, y: 760 }, { x: 640, y: 790 }, { x: 800, y: 790 }, { x: 1000, y: 800 }],
        [{ x: 450, y: 900 }, { x: 600, y: 1000 }, { x: 850, y: 960 }, { x: 1000, y: 940 }],
      ],
      B: [
        [{ x: 520, y: 760 }, { x: 700, y: 640 }, { x: 760, y: 500 }, { x: 880, y: 400 }, { x: 880, y: 300 }],
        [{ x: 520, y: 760 }, { x: 700, y: 640 }, { x: 740, y: 520 }, { x: 860, y: 420 }, { x: 900, y: 320 }],
      ],
    },
    mid: { x: 950, y: 720 },
  },
];

export const mapById = (id: string): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];

/* ---------- grille des zones praticables ---------- */
export class Grid {
  cols: number;
  rows: number;
  cell: number;
  private bits: Uint8Array;

  constructor(g: { cell: number; cols: number; rows: number; bits: string }) {
    this.cols = g.cols;
    this.rows = g.rows;
    this.cell = g.cell;
    const raw = atob(g.bits);
    this.bits = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.bits[i] = raw.charCodeAt(i);
  }
  walkCell(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const i = r * this.cols + c;
    return ((this.bits[i >> 3] >> (7 - (i & 7))) & 1) === 1;
  }
  walk(p: Vec): boolean {
    return this.walkCell(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
  }
  /** Cellule praticable la plus proche (recherche en anneaux). */
  snap(p: Vec): [number, number] {
    const c0 = Math.floor(p.x / this.cell);
    const r0 = Math.floor(p.y / this.cell);
    if (this.walkCell(c0, r0)) return [c0, r0];
    for (let d = 1; d < Math.max(this.cols, this.rows); d++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dr = -d; dr <= d; dr++) {
        for (let dc = -d; dc <= d; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
          if (!this.walkCell(c0 + dc, r0 + dr)) continue;
          const dd = dr * dr + dc * dc;
          if (dd < bd) { bd = dd; best = [c0 + dc, r0 + dr]; }
        }
      }
      if (best) return best;
    }
    return [c0, r0];
  }
  private near: Uint8Array | null = null;
  /** Cellule collée à un mur : le chemin préfère le milieu des couloirs. */
  nearWall(c: number, r: number): boolean {
    if (!this.near) {
      this.near = new Uint8Array(this.cols * this.rows);
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          let hit = 0;
          for (let dr = -1; dr <= 1 && !hit; dr++) for (let dc = -1; dc <= 1; dc++) if (!this.walkCell(cc + dc, rr + dr)) { hit = 1; break; }
          this.near[rr * this.cols + cc] = hit;
        }
      }
    }
    return this.near[r * this.cols + c] === 1;
  }
  center(c: number, r: number): Vec {
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell };
  }
  /** Le segment a→b reste-t-il en zone praticable (avec une petite marge de chaque côté) ? */
  clear(a: Vec, b: Vec): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return true;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const steps = Math.ceil(len / 4);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (!this.walk({ x, y }) || !this.walk({ x: x + nx * 4, y: y + ny * 4 }) || !this.walk({ x: x - nx * 4, y: y - ny * 4 })) return false;
    }
    return true;
  }
}

const gridCache = new Map<string, Grid>();
export function gridOf(map: MapDef): Grid {
  let g = gridCache.get(map.id);
  if (!g) {
    g = new Grid((grids as Record<string, { cell: number; cols: number; rows: number; bits: string }>)[map.id]);
    gridCache.set(map.id, g);
  }
  return g;
}

/** Point praticable au hasard dans un rectangle (le centre si aucun n'est trouvé). */
export function randomIn(map: MapDef, r: Rect, rng: Rng, margin = 0): Vec {
  const g = gridOf(map);
  for (let i = 0; i < 24; i++) {
    const p = { x: r.x + margin + rng() * Math.max(1, r.w - 2 * margin), y: r.y + margin + rng() * Math.max(1, r.h - 2 * margin) };
    if (g.walk(p)) return p;
  }
  const [c, rr] = g.snap({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  return g.center(c, rr);
}

/** Point praticable proche de `p` (à moins de `radius`), sinon `p` lui-même. */
export function scatter(map: MapDef, p: Vec, radius: number, rng: Rng): Vec {
  const g = gridOf(map);
  for (let i = 0; i < 12; i++) {
    const q = { x: p.x + (rng() - 0.5) * 2 * radius, y: p.y + (rng() - 0.5) * 2 * radius };
    if (g.walk(q) && g.clear(p, q)) return q;
  }
  return p;
}

export const rectCenter = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/* ---------- plus court chemin (A* sur la grille) ---------- */
const SQRT2 = Math.SQRT2;

/** Chemin de `from` à `to` (le point de départ n'est pas inclus), lissé en quelques segments droits. */
export function findPath(map: MapDef, from: Vec, to: Vec): Vec[] {
  const g = gridOf(map);
  const [sc, sr] = g.snap(from);
  const [gc, gr] = g.snap(to);
  const W = g.cols;
  const start = sr * W + sc;
  const goal = gr * W + gc;
  if (start === goal) return [{ ...to }];

  const N = g.cols * g.rows;
  const cost = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
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
  const h = (i: number) => {
    const dx = Math.abs((i % W) - gc);
    const dy = Math.abs(Math.floor(i / W) - gr);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  cost[start] = 0;
  push(h(start), start);
  let found = false;
  while (heap.length) {
    const [, cur] = pop();
    if (cur === goal) { found = true; break; }
    const c = cur % W;
    const r = Math.floor(cur / W);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!g.walkCell(nc, nr)) continue;
        if (dr && dc && (!g.walkCell(c + dc, r) || !g.walkCell(c, r + dr))) continue;
        const ni = nr * W + nc;
        const nCost = cost[cur] + (dr && dc ? SQRT2 : 1) + (g.nearWall(nc, nr) ? 1.2 : 0);
        if (nCost < cost[ni]) {
          cost[ni] = nCost;
          prev[ni] = cur;
          push(nCost + h(ni), ni);
        }
      }
    }
  }
  if (!found) return [{ ...to }];

  const cells: Vec[] = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push(g.center(i % W, Math.floor(i / W)));
  cells.reverse();
  cells[0] = { ...from };
  cells[cells.length - 1] = { ...to };
  if (!g.walk(to)) cells[cells.length - 1] = g.center(gc, gr);

  // lissage : on saute à la plus lointaine cellule visible en ligne droite
  const out: Vec[] = [];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !g.clear(cells[i], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  return out;
}

/** Longueur d'un trajet partant de `from`. */
export function pathLength(pts: Vec[], from: Vec): number {
  let l = 0;
  let p = from;
  for (const q of pts) { l += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
  return l;
}
