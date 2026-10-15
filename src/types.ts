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

export interface SaveData {
  profile: UserProfile | null;
  team: TeamIds;
}