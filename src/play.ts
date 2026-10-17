import type { ModeId } from './types';

/**
 * Moteur de match. Un match oppose ton équipe (note = moyenne des 5 titulaires + bonus d'alchimie)
 * à une équipe adverse dont la note est tirée au hasard selon le mode.
 */

export type Rng = () => number;

export interface ModeDef {
  id: ModeId;
  name: string;
  tagline: string;
  /** temps de recharge en millisecondes (0 = jouable tout le temps) */
  cooldownMs: number;
  /** ticket d'entrée, payé avant le match */
  entry: number;
  /** gains en cas de victoire / de défaite (hors ticket d'entrée) */
  win: number;
  loss: number;
  /** niveau des adversaires : moyenne et écart-type de leur note */
  opp: { mean: number; sd: number };
  accent: string;
  /** texte d'accroche, petit titre et badge hexagonal de la carte */
  desc: string;
  eyebrow: string;
  badge: { big: string; small?: string };
}

const MIN = 60_000;

export const MODES: ModeDef[] = [
  {
    id: 'scrim', name: 'Scrim', tagline: 'Entraînement libre, aucune attente',
    cooldownMs: 0, entry: 0, win: 10, loss: 0, opp: { mean: 72, sd: 6 }, accent: '#4f8cff',
    desc: 'Des matchs d’entraînement contre des équipes de ton niveau. Gratuit, sans attente\u00a0: gagne et empoche 10\u00a0🪙 à chaque victoire.',
    eyebrow: 'Scrim · toujours ouvert', badge: { big: 'VS' },
  },
  {
    id: 'showmatch', name: 'Showmatch', tagline: 'Un match de démonstration toutes les 5 minutes',
    cooldownMs: 5 * MIN, entry: 0, win: 35, loss: 15, opp: { mean: 79, sd: 5 }, accent: '#e8a838',
    desc: 'Un match de démonstration toutes les 5 minutes. Pas de ticket d’entrée, et tu gagnes des pièces même si tu perds.',
    eyebrow: 'Étape 1', badge: { big: '1', small: 'SHOWMATCH' },
  },
  {
    id: 'lan', name: 'LAN Cup', tagline: 'Une finale toutes les 30 minutes, ticket d’entrée payant',
    cooldownMs: 30 * MIN, entry: 200, win: 400, loss: 0, opp: { mean: 87, sd: 4 }, accent: '#9b7bff',
    desc: 'La grande finale, une fois toutes les 30 minutes. Ticket d’entrée de 200\u00a0🪙\u00a0: 400\u00a0🪙 si tu gagnes, rien si tu perds.',
    eyebrow: 'Étape 2', badge: { big: '2', small: 'LAN' },
  },
];

export const modeById = (id: ModeId): ModeDef => MODES.find((m) => m.id === id)!;

/** Équipes adverses fictives. */
const OPPONENTS: [string, string][] = [
  ['Nova Five', '🌟'], ['Iron Wolves', '🐺'], ['Crimson Rush', '🩸'], ['Static Noise', '📡'], ['Polar Peak', '🐻‍❄️'],
  ['Night Owls', '🦉'], ['Silent Push', '🤫'], ['Cobalt Squad', '🔷'], ['Ghost Protocol', '👻'], ['Flash Point', '💥'],
  ['Backsite Kings', '👑'], ['Dust Devils', '🌪️'], ['Mirage Club', '🏜️'], ['Long Hold', '🛡️'], ['Banana Control', '🍌'],
  ['Overpass Crew', '🌉'], ['Eco Rounders', '💸'], ['Smoke Cartel', '💨'], ['Retake Squad', '🔁'], ['Clutch Factory', '🏭'],
];

function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Probabilité que ton équipe gagne : 50 % à note égale, ~62 % avec 3 points d'avance, bornée entre 3 % et 97 %. */
export function winChance(myOvr: number, oppOvr: number): number {
  const p = 1 / (1 + Math.exp(-(myOvr - oppOvr) / 6));
  return Math.min(0.97, Math.max(0.03, p));
}

/** Chance de victoire moyenne contre l'ensemble des adversaires possibles d'un mode (intégrale sur la loi normale). */
export function averageWinChance(mode: ModeDef, myOvr: number): number {
  let total = 0;
  let weights = 0;
  for (let z = -3; z <= 3; z += 0.25) {
    const w = Math.exp(-(z * z) / 2);
    total += w * winChance(myOvr, mode.opp.mean + z * mode.opp.sd);
    weights += w;
  }
  return total / weights;
}

export interface MatchOutcome {
  opponent: { name: string; emoji: string; ovr: number };
  won: boolean;
  myScore: number;
  oppScore: number;
  entry: number;
  payout: number;
}

export function simulateMatch(mode: ModeDef, myOvr: number, rng: Rng = Math.random): MatchOutcome {
  const [name, emoji] = OPPONENTS[Math.floor(rng() * OPPONENTS.length)];
  const ovr = Math.min(97, Math.max(60, Math.round(mode.opp.mean + gaussian(rng) * mode.opp.sd)));
  const pWin = winChance(myOvr, ovr);
  const won = rng() < pWin;

  // score en 13 manches : plus le vainqueur était favori, plus l'écart est grand
  const favourite = won ? pWin : 1 - pWin;
  const base = 13 * (0.35 + 0.65 * (1 - favourite));
  const loserRounds = Math.min(12, Math.max(0, Math.round(base * (0.7 + rng() * 0.6))));

  return {
    opponent: { name, emoji, ovr },
    won,
    myScore: won ? 13 : loserRounds,
    oppScore: won ? loserRounds : 13,
    entry: mode.entry,
    payout: won ? mode.win : mode.loss,
  };
}

/** Temps restant avant de pouvoir rejouer (borné au délai du mode si l'horloge a reculé). */
export function cooldownLeft(mode: ModeDef, last: number | undefined, now: number = Date.now()): number {
  if (!mode.cooldownMs || last === undefined) return 0;
  return Math.min(mode.cooldownMs, Math.max(0, last + mode.cooldownMs - now));
}

export function fmtCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtCooldown(ms: number): string {
  return ms ? `${ms / MIN} min` : 'Aucun';
}
