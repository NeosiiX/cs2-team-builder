
/**
 * Cartes du match en direct : radar officiel (public/maps/) + maillage de navigation 3D (public/nav/, voir nav.ts
 * et tools/build_nav.py) + repères tactiques posés à la main : spawns, sites, itinéraires, lieux nommés.
 */

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Rng = () => number;
export type SiteId = 'A' | 'B';

/** Lieu nommé (callout) et son étage : 1 = en hauteur / à l'étage, 0 = sol, -1 = en contrebas / souterrain. */
export interface Place {
  name: string;
  level: -1 | 0 | 1;
  r: Rect;
}

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
  /** lieux nommés : le premier rectangle qui contient le point l'emporte (les petits d'abord) */
  places: Place[];
}

const P = (name: string, level: -1 | 0 | 1, x: number, y: number, w: number, h: number): Place => ({ name, level, r: { x, y, w, h } });

export const MAPS: MapDef[] = [
  {
    // radar Dust II style CS2 (1024 × 1024) : murs noirs, sol du bleu (bas) à l'olive (haut), zone rayée = dénivelé
    id: 'dust2', name: 'Dust II', image: '/maps/dust2.png', w: 1024, h: 1024,
    view: { x: 50, y: 18, w: 930, h: 994 },
    tSpawn: { x: 298, y: 878, w: 186, h: 74 },
    ctSpawn: { x: 577, y: 160, w: 34, h: 96 },
    sites: { A: { x: 784, y: 142, w: 60, h: 60 }, B: { x: 172, y: 86, w: 80, h: 84 } },
    bomb: { A: { x: 812, y: 172 }, B: { x: 212, y: 130 } },
    routes: {
      A: [
        [{ x: 640, y: 880 }, { x: 700, y: 650 }, { x: 870, y: 520 }, { x: 900, y: 300 }],
        [{ x: 470, y: 700 }, { x: 490, y: 400 }, { x: 600, y: 400 }, { x: 645, y: 330 }, { x: 700, y: 230 }],
      ],
      B: [
        [{ x: 230, y: 700 }, { x: 175, y: 560 }, { x: 120, y: 460 }, { x: 115, y: 340 }],
        [{ x: 470, y: 700 }, { x: 480, y: 300 }, { x: 400, y: 225 }, { x: 290, y: 200 }],
      ],
    },
    mid: { x: 470, y: 290 },
    places: [
      P('Short A', 1, 614, 150, 72, 220), P('Spawn CT', -1, 560, 150, 56, 115), P('Site A', 1, 680, 120, 195, 145),
      P('Goose', 1, 790, 15, 135, 105), P('Long A', 0, 840, 200, 135, 260), P('Long doors', 0, 668, 450, 330, 250),
      P('Outside long', 0, 590, 690, 420, 320), P('Catwalk', 0, 505, 360, 180, 170), P('Tunnels bas', -1, 280, 380, 170, 130),
      P('Portes B', 0, 255, 140, 150, 130), P('CT mid', -1, 400, 145, 230, 115), P('Mid', 0, 395, 255, 115, 625),
      P('Site B', 1, 40, 15, 225, 300), P('Tunnels', 1, 50, 300, 260, 300), P('Spawn T', 1, 50, 580, 560, 430),
    ],
  },
  {
    id: 'mirage', name: 'Mirage', image: '/maps/mirage.png', w: 1024, h: 1024,
    view: { x: 100, y: 150, w: 850, h: 730 },
    tSpawn: { x: 870, y: 327, w: 60, h: 90 },
    ctSpawn: { x: 237, y: 657, w: 114, h: 93 },
    sites: { A: { x: 519, y: 748, w: 71, h: 63 }, B: { x: 199, y: 252, w: 71, h: 78 } },
    bomb: { A: { x: 554, y: 779 }, B: { x: 234, y: 290 } },
    routes: {
      A: [
        [{ x: 899, y: 483 }, { x: 895, y: 599 }, { x: 829, y: 707 }, { x: 754, y: 790 }],
        [{ x: 895, y: 284 }, { x: 721, y: 234 }, { x: 705, y: 375 }, { x: 589, y: 483 }, { x: 522, y: 599 }],
      ],
      B: [
        [{ x: 895, y: 284 }, { x: 729, y: 225 }, { x: 605, y: 176 }, { x: 431, y: 230 }, { x: 323, y: 226 }],
        [{ x: 895, y: 284 }, { x: 721, y: 234 }, { x: 705, y: 375 }, { x: 589, y: 483 }, { x: 439, y: 433 }, { x: 431, y: 317 }],
      ],
    },
    mid: { x: 439, y: 483 },
    places: [
      P('Underpass', -1, 428, 267, 36, 158), P('Short', 1, 383, 342, 48, 249), P('Connector', 0, 477, 504, 75, 91),
      P('Apparts', 1, 249, 155, 369, 120), P('Site B', 0, 104, 222, 240, 174), P('Market', 0, 157, 387, 187, 104),
      P('Palais', 1, 638, 682, 232, 149), P('Ramp', 0, 572, 599, 174, 91), P('Rampe T', 0, 738, 541, 191, 149),
      P('Site A', 0, 472, 673, 166, 199), P('Jungle', 0, 356, 582, 133, 116), P('Spawn CT', 0, 224, 640, 133, 116),
      P('Haut T', 0, 667, 151, 265, 124), P('Spawn T', 0, 858, 267, 83, 166), P('Mid', 0, 423, 396, 332, 141),
      P('Couloir B', 0, 290, 392, 99, 274),
    ],
  },
  {
    id: 'inferno', name: 'Inferno', image: '/maps/inferno.png', w: 1024, h: 1024,
    view: { x: 60, y: 60, w: 925, h: 900 },
    tSpawn: { x: 74, y: 630, w: 59, h: 93 },
    ctSpawn: { x: 883, y: 298, w: 63, h: 133 },
    sites: { A: { x: 795, y: 648, w: 70, h: 106 }, B: { x: 460, y: 176, w: 79, h: 90 } },
    bomb: { A: { x: 831, y: 700 }, B: { x: 499, y: 225 } },
    routes: {
      A: [
        [{ x: 268, y: 646 }, { x: 400, y: 628 }, { x: 519, y: 673 }, { x: 698, y: 682 }],
        [{ x: 205, y: 772 }, { x: 340, y: 861 }, { x: 564, y: 826 }, { x: 698, y: 808 }],
      ],
      B: [
        [{ x: 268, y: 646 }, { x: 455, y: 560 }, { x: 483, y: 413 }, { x: 591, y: 323 }, { x: 591, y: 234 }],
        [{ x: 268, y: 646 }, { x: 455, y: 560 }, { x: 465, y: 431 }, { x: 573, y: 341 }, { x: 609, y: 252 }],
      ],
    },
    mid: { x: 716, y: 600 },
    places: [
      P('Pit', -1, 833, 799, 139, 103), P('Site A', 0, 730, 525, 206, 282), P('Library', 0, 913, 655, 63, 251),
      P('Balcon', 1, 613, 767, 215, 143), P('Apparts', 1, 290, 696, 193, 99), P('Apparts', 1, 148, 655, 108, 238),
      P('Site B', 0, 416, 117, 161, 184), P('Construction', 0, 537, 50, 166, 126), P('Banana', 0, 389, 301, 256, 350),
      P('Arch', 0, 774, 422, 54, 117), P('Spawn CT', 0, 748, 171, 233, 278), P('Spawn T', 0, 57, 592, 90, 233),
      P('Mid', 0, 290, 592, 421, 269),
    ],
  },
];

export const mapById = (id: string): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];

const NOWHERE: Place = { name: '', level: 0, r: { x: 0, y: 0, w: 0, h: 0 } };
/** Lieu (callout + étage) d'un point du radar. */
export function placeAt(map: MapDef, p: Vec): Place {
  for (const pl of map.places) {
    const r = pl.r;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return pl;
  }
  return NOWHERE;
}

export const rectCenter = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
