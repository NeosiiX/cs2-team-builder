export type Role = 'IGL' | 'RIF' | 'AWP' | 'SUP' | 'LRK';
export type Rarity = 'silver' | 'gold' | 'legend';
export type StatKey = 'aim' | 'utl' | 'pos' | 'clu';
export type Stats = Record<StatKey, number>;

export interface Player {
  id: string;
  nickname: string;
  ovr: number;
  role: Role;
  countryCode: string;
  team: string;
  period: { from: number; to?: number };
  rarity: Rarity;
  stats: Stats;
  realName?: string;
  dataSource?: string;
}

export type SlotId = 'igl' | 'rifler' | 'awp' | 'support' | 'lurker' | 'coach';

export interface SlotDef {
  id: SlotId;
  label: string;
  role: Role | null; // null = coach (pas de rôle de jeu)
}

export const SLOTS: SlotDef[] = [
  { id: 'igl', label: 'IGL', role: 'IGL' },
  { id: 'rifler', label: 'RIFLER', role: 'RIF' },
  { id: 'awp', label: 'AWP', role: 'AWP' },
  { id: 'support', label: 'SUPPORT', role: 'SUP' },
  { id: 'lurker', label: 'LURKER', role: 'LRK' },
  { id: 'coach', label: 'COACH', role: null },
];

export type TeamIds = Record<SlotId, string | null>;

export const emptyTeam = (): TeamIds => ({
  igl: null, rifler: null, awp: null, support: null, lurker: null, coach: null,
});

export interface UserProfile {
  username: string;
  createdAt: string;
}

export type TeamLogo =
  | { kind: 'emoji'; emoji: string; color: string }
  | { kind: 'image'; dataUrl: string };

export interface TeamInfo {
  name: string;
  logo: TeamLogo;
  /** résultats : pour l'instant à 0, seront alimentés par les futurs matchs */
  wins: number;
  losses: number;
}

export const defaultTeamInfo = (): TeamInfo => ({
  name: 'Mon équipe',
  logo: { kind: 'emoji', emoji: '🎯', color: '#e8a838' },
  wins: 0,
  losses: 0,
});

export type ModeId = 'scrim' | 'showmatch' | 'lan';

export interface MatchRecord {
  id: string;
  ts: number;
  mode: ModeId;
  opponent: { name: string; emoji: string; ovr: number };
  /** note de ton équipe au moment du match */
  myOvr: number;
  myScore: number;
  oppScore: number;
  won: boolean;
  /** ticket d'entrée payé et gain reçu (le bilan est gain - entrée) */
  entry: number;
  payout: number;
}

export interface SaveData {
  profile: UserProfile | null;
  team: TeamIds;
  teamInfo: TeamInfo;
  history: MatchRecord[];
  /** dernier lancement de chaque mode (pour le temps de recharge) */
  lastPlayed: Partial<Record<ModeId, number>>;
  coins: number;
  /** ids des joueurs débloqués (via les caisses) */
  owned: string[];
}