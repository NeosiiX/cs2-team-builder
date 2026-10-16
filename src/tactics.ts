/**
 * Module de stratégies : chaque manche tire un plan T et un placement CT différents, pondérés par l'économie
 * et par ce qui vient d'être joué (on évite de rejouer trois fois la même chose, on change après une manche perdue).
 */

export type TStrat = 'execute' | 'split' | 'rush' | 'default' | 'fake' | 'lurk' | 'contact';
export type CtSetup = 'standard' | 'stackA' | 'stackB' | 'aggro' | 'deep';
export type Eco = 'pistol' | 'eco' | 'half' | 'full';
export type Rng = () => number;

export const T_LABEL: Record<TStrat, string> = {
  execute: 'Exécution',
  split: 'Split',
  rush: 'Rush',
  default: 'Default puis exécution tardive',
  fake: 'Fake',
  lurk: 'Exécution + lurker',
  contact: 'Contact play',
};

export const CT_LABEL: Record<CtSetup, string> = {
  standard: '2-1-2',
  stackA: 'Stack A',
  stackB: 'Stack B',
  aggro: 'Agressif (push pour l’info)',
  deep: 'Positions reculées (retake)',
};

const T_WEIGHTS: Record<Eco, Record<TStrat, number>> = {
  pistol: { execute: 3, split: 2, rush: 3, default: 2, fake: 1, lurk: 1, contact: 1 },
  eco: { execute: 1, split: 1, rush: 4, default: 1, fake: 0.5, lurk: 0.5, contact: 3 },
  half: { execute: 3, split: 2, rush: 2, default: 2, fake: 1, lurk: 1, contact: 1.5 },
  full: { execute: 4, split: 3, rush: 1, default: 3, fake: 2, lurk: 2, contact: 1 },
};

const CT_WEIGHTS: Record<Eco, Record<CtSetup, number>> = {
  pistol: { standard: 4, stackA: 1, stackB: 1, aggro: 2, deep: 1 },
  eco: { standard: 2, stackA: 2, stackB: 2, aggro: 3, deep: 1 },
  half: { standard: 4, stackA: 1.5, stackB: 1.5, aggro: 2, deep: 1.5 },
  full: { standard: 4, stackA: 1.5, stackB: 1.5, aggro: 2, deep: 2 },
};

export interface RoundPlan {
  t: TStrat;
  ct: CtSetup;
  site: 'A' | 'B';
  /** temps de jeu (s) au-delà duquel les T exécutent quoi qu'il arrive */
  timing: number;
  /** répartition des T entre l'itinéraire principal et le secondaire */
  groups: [number, number];
  /** distance (px) du point de regroupement au site */
  stage: number;
}

function pick<K extends string>(w: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(w) as [K, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let x = rng() * total;
  for (const [k, v] of entries) {
    x -= v;
    if (x < 0) return k;
  }
  return entries[0][0];
}

export interface History {
  t: TStrat[];
  ct: CtSetup[];
  /** les T ont-ils perdu la manche précédente ? */
  tLost: boolean;
}

export function pickPlan(tEco: Eco, ctEco: Eco, h: History, rng: Rng): RoundPlan {
  const tw = { ...T_WEIGHTS[tEco] };
  const [l1, l2] = [h.t[h.t.length - 1], h.t[h.t.length - 2]];
  if (l1) tw[l1] *= h.tLost ? 0.15 : 0.45;
  if (l1 && l1 === l2) tw[l1] *= 0.1;
  const t = pick(tw, rng);

  const cw = { ...CT_WEIGHTS[ctEco] };
  const c1 = h.ct[h.ct.length - 1];
  if (c1) cw[c1] *= 0.4;
  const ct = pick(cw, rng);

  const site = rng() < 0.5 ? 'A' : 'B';
  const groups: [number, number] =
    t === 'split' ? (rng() < 0.5 ? [3, 2] : [2, 3]) : t === 'rush' ? [5, 0] : ([[5, 0], [4, 1], [3, 2]] as [number, number][])[Math.floor(rng() * 3)];
  const timing = t === 'default' ? 55 + rng() * 25 : t === 'contact' ? 50 + rng() * 15 : 22 + rng() * 30;
  const stage = t === 'split' ? 240 + rng() * 60 : 170 + rng() * 90;
  return { t, ct, site, timing, groups, stage };
}
