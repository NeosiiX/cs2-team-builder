import type { Player, Rarity } from './types';

export interface PackDef {
  id: string;
  name: string;
  tagline: string;
  price: number;
  /** probabilités en % — la somme doit faire 100 */
  odds: Record<Rarity, number>;
  accent: string;
}

export const PACKS: PackDef[] = [
  {
    id: 'bronze',
    name: 'Caisse Recrue',
    tagline: 'Pour démarrer ta collection',
    price: 100,
    odds: { silver: 80, gold: 19, legend: 1 },
    accent: '#9ca3af',
  },
  {
    id: 'pro',
    name: 'Caisse Pro',
    tagline: 'De bonnes chances de tomber sur un Gold',
    price: 300,
    odds: { silver: 50, gold: 44, legend: 6 },
    accent: '#fbbf24',
  },
  {
    id: 'elite',
    name: 'Caisse Légende',
    tagline: 'Les meilleurs joueurs de l’histoire de CS',
    price: 800,
    odds: { silver: 15, gold: 65, legend: 20 },
    accent: '#a855f7',
  },
];

export const RARITY_LABEL: Record<Rarity, string> = {
  silver: 'Silver Elite',
  gold: 'Gold Star',
  legend: 'Légende',
};

/** Pièces rendues quand on tire un joueur qu'on possède déjà */
export const DUPLICATE_REFUND: Record<Rarity, number> = { silver: 40, gold: 120, legend: 400 };

export function rollRarity(odds: Record<Rarity, number>, rng: () => number = Math.random): Rarity {
  const total = odds.silver + odds.gold + odds.legend;
  let r = rng() * total;
  for (const rarity of ['legend', 'gold', 'silver'] as Rarity[]) {
    r -= odds[rarity];
    if (r < 0) return rarity;
  }
  return 'silver';
}

export function rollPlayer(pack: PackDef, players: Player[], rng: () => number = Math.random): Player {
  const rarity = rollRarity(pack.odds, rng);
  const pool = players.filter((p) => p.rarity === rarity);
  const list = pool.length ? pool : players;
  return list[Math.floor(rng() * list.length)];
}
