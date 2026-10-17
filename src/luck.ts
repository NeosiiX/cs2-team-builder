import type { Player, Rarity } from './types';
import type { PackDef } from './packs';

/**
 * Module de chance : tout le tirage au sort passe par ici.
 * - les % de drop sont définis par caisse (rareté), puis on tire un joueur parmi ceux qui sont éligibles
 * - un plafond / plancher de note peut exclure des joueurs d'une caisse
 * - les % affichés à l'écran sont ceux réellement utilisés (voir effectiveOdds)
 */

export const RARITIES: Rarity[] = ['icon', 'legend', 'gold', 'silver'];

/** Valeur de revente d'un doublon : toujours très inférieure au prix d'une caisse. */
export const DUPLICATE_REFUND: Record<Rarity, number> = { silver: 25, gold: 80, legend: 300, icon: 500 };

export type Rng = () => number;

/** Joueurs qui peuvent tomber dans cette caisse (selon la note min/max). */
export function eligiblePlayers(pack: PackDef, players: Player[]): Player[] {
  return players.filter(
    (p) => (pack.minOvr === undefined || p.ovr >= pack.minOvr) && (pack.maxOvr === undefined || p.ovr <= pack.maxOvr),
  );
}

/**
 * % réels par rareté : une rareté sans joueur éligible est retirée et le reste est ramené à 100 %.
 * C'est cette valeur qui est affichée et utilisée pour le tirage.
 */
export function effectiveOdds(pack: PackDef, players: Player[]): Record<Rarity, number> {
  const pool = eligiblePlayers(pack, players);
  const raw = {} as Record<Rarity, number>;
  let total = 0;
  for (const r of RARITIES) {
    raw[r] = pool.some((p) => p.rarity === r) ? pack.odds[r] : 0;
    total += raw[r];
  }
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = total > 0 ? (raw[r] / total) * 100 : 0;
  return out;
}

export function rollRarity(odds: Record<Rarity, number>, rng: Rng = Math.random): Rarity {
  const total = RARITIES.reduce((sum, r) => sum + odds[r], 0);
  let x = rng() * total;
  for (const r of RARITIES) {
    x -= odds[r];
    if (x < 0 && odds[r] > 0) return r;
  }
  // arrondi flottant : on retombe sur la rareté la plus commune qui a une chance > 0
  return [...RARITIES].reverse().find((r) => odds[r] > 0) ?? 'silver';
}

export function rollPlayer(pack: PackDef, players: Player[], rng: Rng = Math.random): Player {
  const pool = eligiblePlayers(pack, players);
  const rarity = rollRarity(effectiveOdds(pack, players), rng);
  const list = pool.filter((p) => p.rarity === rarity);
  return list[Math.floor(rng() * list.length)];
}

/**
 * Valeur de revente moyenne d'un tirage (cas où tout est un doublon) et part du prix qu'elle représente.
 * Un taux < 100 % veut dire que la caisse « coûte » toujours plus de pièces qu'elle n'en rend en moyenne.
 */
export function expectedRefund(pack: PackDef, players: Player[]): { value: number; returnRate: number } {
  const odds = effectiveOdds(pack, players);
  const value = RARITIES.reduce((sum, r) => sum + (odds[r] / 100) * DUPLICATE_REFUND[r], 0);
  return { value, returnRate: (value / pack.price) * 100 };
}

/** Pourcentage lisible : 0,25 % reste 0,25 %, 30 % reste 30 %. */
export const fmtPct = (n: number): string => `${Number(n.toFixed(2)).toLocaleString('fr-FR')} %`;
