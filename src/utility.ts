import type { Vec, SiteId } from './maps';

/**
 * Module de stuff (fumigènes, molotovs, flashs).
 *
 * Rien n'est lancé au hasard : chaque carte a des placements nommés et des séquences reprises des schémas
 * qu'on retrouve dans les matchs pros (Vitality, Spirit, etc.) et les guides de lineups :
 * - exécution T : fumigènes qui coupent les rotations CT, puis molotovs sur les positions de défense,
 *   puis flashs « pop » juste avant l'entrée, puis entrée sur le site ;
 * - retardement CT : incendiaire (et flash) quand les T se montrent à un passage clé ;
 * - reprise CT : flash au-dessus du site et fumigène sur la position de garde des T ;
 * - après la pose : molotov des T sur la bombe quand un CT commence à désamorcer ;
 * - débuts de manche classiques (ex. fumigène Xbox sur Dust II).
 *
 * Les positions sont en pixels du radar (images de public/maps/), placées sur les callouts des cartes.
 */

export type NadeKind = 'smoke' | 'flash' | 'molotov';

export interface NadeSpec {
  kind: NadeKind;
  name: string;
  at: Vec;
  /** secondes après le début de la séquence */
  delay: number;
}

export interface CtDelay {
  /** zone qui déclenche (un T y entre) */
  zone: Vec;
  r: number;
  nades: NadeSpec[];
}

export interface EarlyNade extends NadeSpec {
  side: 'T' | 'CT';
  /** probabilité qu'elle soit jouée dans une manche donnée */
  p: number;
}

export interface MapUtility {
  execute: Record<SiteId, NadeSpec[]>;
  ctDelay: CtDelay[];
  retake: Record<SiteId, NadeSpec[]>;
  early: EarlyNade[];
}

const s = (name: string, x: number, y: number, delay = 0): NadeSpec => ({ kind: 'smoke', name, at: { x, y }, delay });
const m = (name: string, x: number, y: number, delay = 0): NadeSpec => ({ kind: 'molotov', name, at: { x, y }, delay });
const f = (name: string, x: number, y: number, delay = 0): NadeSpec => ({ kind: 'flash', name, at: { x, y }, delay });

export const UTILITY: Record<string, MapUtility> = {
  dust2: {
    // positions sur le radar Dust II style CS2 (1024 × 1024)
    execute: {
      A: [
        s('Fumée CT', 712, 222, 0), s('Fumée Cross', 880, 250, 0.3),
        m('Molotov Goose', 860, 120, 1.0), m('Molotov Default', 812, 172, 1.3),
        f('Flash Long', 905, 330, 2.0), f('Flash site A', 805, 160, 2.3),
      ],
      B: [
        s('Fumée Portes B', 395, 232, 0), s('Fumée Fenêtre', 290, 150, 0.3),
        m('Molotov Back plat', 110, 60, 1.0), m('Molotov Default B', 212, 130, 1.3),
        f('Flash sortie tunnel', 115, 300, 2.0), f('Flash site B', 200, 150, 2.3),
      ],
    },
    ctDelay: [
      { zone: { x: 740, y: 620 }, r: 100, nades: [m('Incendiaire Long doors', 700, 625, 0), f('Flash Long', 860, 560, 0.4)] },
      { zone: { x: 150, y: 480 }, r: 110, nades: [m('Incendiaire Tunnels', 115, 360, 0), f('Flash sortie tunnel', 120, 330, 0.5)] },
      { zone: { x: 575, y: 410 }, r: 75, nades: [m('Incendiaire Short', 640, 345, 0)] },
    ],
    retake: {
      A: [f('Flash retake A', 812, 172, 0), s('Fumée Long', 905, 330, 0.3)],
      B: [f('Flash retake B', 212, 130, 0), s('Fumée Tunnels', 115, 350, 0.3)],
    },
    early: [
      { side: 'T', p: 0.7, ...s('Fumée Xbox', 470, 575, 6) },
      { side: 'CT', p: 0.5, ...s('Fumée Mid doors', 470, 270, 3) },
    ],
  },
  mirage: {
    execute: {
      A: [
        s('Fumée CT', 431, 790, 0), s('Fumée Jungle', 420, 640, 0.25), s('Fumée Stairs', 493, 723, 0.5),
        m('Molotov Firebox', 518, 748, 1.1), m('Molotov Default', 584, 777, 1.4),
        f('Flash Palace', 605, 790, 2.0), f('Flash Ramp', 589, 682, 2.3),
      ],
      B: [
        s('Fumée Kitchen', 216, 383, 0), s('Fumée Short', 405, 380, 0.3),
        m('Molotov Bench', 137, 284, 1.0), m('Molotov Van', 257, 334, 1.3),
        f('Flash Apps', 294, 238, 2.0), f('Flash site B', 232, 284, 2.3),
      ],
    },
    ctDelay: [
      { zone: { x: 754, y: 649 }, r: 108, nades: [m('Incendiaire Ramp', 630, 665, 0), f('Flash Ramp', 688, 649, 0.4)] },
      { zone: { x: 787, y: 781 }, r: 91, nades: [m('Incendiaire Palace', 680, 790, 0)] },
      { zone: { x: 489, y: 209 }, r: 116, nades: [m('Incendiaire Apps', 323, 230, 0), f('Flash Apps', 390, 209, 0.4)] },
    ],
    retake: {
      A: [f('Flash retake A', 554, 769, 0), s('Fumée Palace', 663, 794, 0.3)],
      B: [f('Flash retake B', 234, 284, 0), s('Fumée Apps', 323, 230, 0.3)],
    },
    early: [],
  },
  inferno: {
    execute: {
      A: [
        s('Fumée CT', 904, 592, 0), s('Fumée Library', 940, 754, 0.25), s('Fumée Arch', 797, 512, 0.5),
        m('Molotov Pit', 904, 852, 1.1), m('Molotov Site', 833, 736, 1.4),
        f('Flash Long', 725, 646, 2.0), f('Flash Balcon', 788, 799, 2.3),
      ],
      B: [
        s('Fumée CT', 650, 225, 0), s('Fumée Coffins', 434, 198, 0.3),
        m('Molotov New box', 510, 261, 1.0), m('Molotov Dark', 546, 283, 1.3),
        f('Flash Banana', 580, 345, 2.0), f('Flash site B', 501, 216, 2.3),
      ],
    },
    ctDelay: [
      { zone: { x: 483, y: 503 }, r: 143, nades: [m('Incendiaire Banana', 510, 431, 0), s('Fumée Banana', 537, 386, 0.3), f('Flash Banana', 537, 377, 0.6)] },
      { zone: { x: 653, y: 817 }, r: 126, nades: [m('Incendiaire Balcon', 743, 799, 0)] },
      { zone: { x: 707, y: 646 }, r: 99, nades: [f('Flash Long', 716, 610, 0)] },
    ],
    retake: {
      A: [f('Flash retake A', 831, 700, 0), s('Fumée Pit', 904, 844, 0.3)],
      B: [f('Flash retake B', 499, 225, 0), s('Fumée Banana', 570, 360, 0.3)],
    },
    early: [{ side: 'T', p: 0.45, ...m('Molotov Car', 591, 359, 9) }],
  },
};

/** Qui lance quoi en priorité (rôle tactique). L'entry (RIF) ne se flashe pas lui-même. */
export const THROW_PRIORITY: Record<NadeKind, string[]> = {
  smoke: ['IGL', 'SUP', 'LRK', 'AWP', 'RIF'],
  molotov: ['SUP', 'LRK', 'IGL', 'RIF', 'AWP'],
  flash: ['SUP', 'IGL', 'LRK', 'AWP', 'RIF'],
};

/** Durées (secondes de jeu). */
export const NADE_TIME = { smoke: 18, molotovT: 7, molotovCT: 5.5, flashBurst: 0.35 };
