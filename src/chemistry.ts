import type { Player, SlotId, Stats, StatKey } from './types';
import { SLOTS } from './types';

export const CHEM = {
  ROLE_POINTS: 12,
  ROLE_MAX: 60,
  PAIR_POINTS: 10,
  PAIR_MAX: 40,
  ROLE_MOD: 2, // +2 si bien placé, -2 sinon (sur chaque stat)
  BONUS_STEP: 10, // +1 par tranche de 10 pts d'alchimie
};

const CURRENT_YEAR = new Date().getFullYear();
const STAT_KEYS: StatKey[] = ['aim', 'utl', 'pos', 'clu'];

/** Deux périodes se chevauchent ? (to absent = toujours actif) */
export function periodsOverlap(a: Player['period'], b: Player['period']): boolean {
  const aTo = a.to ?? CURRENT_YEAR;
  const bTo = b.to ?? CURRENT_YEAR;
  return a.from <= bTo && b.from <= aTo;
}

/** Vrais coéquipiers = même équipe + périodes qui se chevauchent */
export function areTeammates(a: Player, b: Player): boolean {
  return a.team === b.team && periodsOverlap(a.period, b.period);
}

export interface ChemistryResult {
  rolePoints: number;
  teamPoints: number;
  total: number;
  bonus: number;
  /** true = bien placé, false = hors rôle, null = slot vide ou coach */
  fits: Record<SlotId, boolean | null>;
  pairs: [Player, Player][];
  teamOvr: number; // moyenne + bonus
  teamStats: Stats; // moyennes (avec modificateurs de rôle) + bonus
  filledStarters: number;
}

export function computeChemistry(team: Record<SlotId, Player | null>): ChemistryResult {
  const fits = {} as Record<SlotId, boolean | null>;
  const starters: { player: Player; fit: boolean }[] = [];

  for (const slot of SLOTS) {
    const p = team[slot.id];
    if (!slot.role || !p) {
      fits[slot.id] = null;
      continue;
    }
    const fit = p.role === slot.role;
    fits[slot.id] = fit;
    starters.push({ player: p, fit });
  }

  // 1) Rôles — max 60
  const rolePoints = Math.min(
    CHEM.ROLE_MAX,
    starters.filter((s) => s.fit).length * CHEM.ROLE_POINTS,
  );

  // 2) Vrais coéquipiers — max 40 (le coach n'est pas compté)
  const pairs: [Player, Player][] = [];
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) {
      if (areTeammates(starters[i].player, starters[j].player)) {
        pairs.push([starters[i].player, starters[j].player]);
      }
    }
  }
  const teamPoints = Math.min(CHEM.PAIR_MAX, pairs.length * CHEM.PAIR_POINTS);

  const total = rolePoints + teamPoints;
  const bonus = Math.floor(total / CHEM.BONUS_STEP);

  // 3) Note d'équipe et stats (modificateur de rôle ±2, puis bonus d'alchimie)
  const n = starters.length;
  const teamStats: Stats = { aim: 0, utl: 0, pos: 0, clu: 0 };
  let teamOvr = 0;

  if (n > 0) {
    for (const key of STAT_KEYS) {
      const sum = starters.reduce(
        (acc, s) => acc + s.player.stats[key] + (s.fit ? CHEM.ROLE_MOD : -CHEM.ROLE_MOD),
        0,
      );
      teamStats[key] = Math.round(sum / n) + bonus;
    }
    teamOvr = Math.round(starters.reduce((a, s) => a + s.player.ovr, 0) / n) + bonus;
  }

  return { rolePoints, teamPoints, total, bonus, fits, pairs, teamOvr, teamStats, filledStarters: n };
}