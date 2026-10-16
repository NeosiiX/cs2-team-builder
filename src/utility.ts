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
        s('Fumée CT', 690, 930, 0), s('Fumée Jungle', 700, 790, 0.25), s('Fumée Stairs', 765, 850, 0.5),
        m('Molotov Firebox', 795, 880, 1.1), m('Molotov Default', 875, 915, 1.4),
        f('Flash Palace', 900, 930, 2.0), f('Flash Ramp', 880, 800, 2.3),
      ],
      B: [
        s('Fumée Kitchen', 430, 440, 0), s('Fumée Short', 600, 400, 0.3),
        m('Molotov Bench', 335, 320, 1.0), m('Molotov Van', 480, 380, 1.3),
        f('Flash Apps', 525, 265, 2.0), f('Flash site B', 450, 320, 2.3),
      ],
    },
    ctDelay: [
      { zone: { x: 1080, y: 760 }, r: 130, nades: [m('Incendiaire Ramp', 930, 780, 0), f('Flash Ramp', 1000, 760, 0.4)] },
      { zone: { x: 1120, y: 920 }, r: 110, nades: [m('Incendiaire Palace', 990, 930, 0)] },
      { zone: { x: 760, y: 230 }, r: 140, nades: [m('Incendiaire Apps', 560, 255, 0), f('Flash Apps', 640, 230, 0.4)] },
    ],
    retake: {
      A: [f('Flash retake A', 838, 905, 0), s('Fumée Palace', 970, 935, 0.3)],
      B: [f('Flash retake B', 452, 320, 0), s('Fumée Apps', 560, 255, 0.3)],
    },
    early: [],
  },
  inferno: {
    execute: {
      A: [
        s('Fumée CT', 1230, 700, 0), s('Fumée Library', 1270, 880, 0.25), s('Fumée Arch', 1110, 610, 0.5),
        m('Molotov Pit', 1230, 990, 1.1), m('Molotov Site', 1150, 860, 1.4),
        f('Flash Long', 1030, 760, 2.0), f('Flash Balcon', 1100, 930, 2.3),
      ],
      B: [
        s('Fumée CT', 930, 275, 0), s('Fumée Coffins', 705, 260, 0.3),
        m('Molotov New box', 790, 330, 1.0), m('Molotov Dark', 830, 355, 1.3),
        f('Flash Banana', 820, 420, 2.0), f('Flash site B', 780, 280, 2.3),
      ],
    },
    ctDelay: [
      { zone: { x: 760, y: 600 }, r: 160, nades: [m('Incendiaire Banana', 790, 520, 0), s('Fumée Banana', 820, 470, 0.3), f('Flash Banana', 820, 460, 0.6)] },
      { zone: { x: 950, y: 950 }, r: 140, nades: [m('Incendiaire Balcon', 1050, 930, 0)] },
      { zone: { x: 1010, y: 760 }, r: 110, nades: [f('Flash Long', 1020, 720, 0)] },
    ],
    retake: {
      A: [f('Flash retake A', 1148, 820, 0), s('Fumée Pit', 1230, 980, 0.3)],
      B: [f('Flash retake B', 778, 290, 0), s('Fumée Banana', 840, 420, 0.3)],
    },
    early: [{ side: 'T', p: 0.45, ...m('Molotov Car', 880, 440, 9) }],
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
