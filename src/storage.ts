import type { SaveData, TeamIds } from './types';
import { emptyTeam } from './types';

const KEY = 'cs2tb:v1';
export const STARTING_COINS = 1000;

const fresh = (): SaveData => ({ profile: null, team: emptyTeam(), coins: STARTING_COINS, owned: [] });

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const data = JSON.parse(raw) as Partial<SaveData>;
    const team: TeamIds = { ...emptyTeam(), ...(data.team ?? {}) };

    // Ancienne sauvegarde (avant les caisses) : on garde les joueurs déjà dans l'équipe
    const owned = new Set<string>(
      Array.isArray(data.owned) ? data.owned : Object.values(team).filter((v): v is string => !!v),
    );

    return {
      profile: data.profile ?? null,
      team,
      coins: typeof data.coins === 'number' ? data.coins : STARTING_COINS,
      owned: [...owned],
    };
  } catch {
    return fresh();
  }
}

export function persist(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
  }
}
