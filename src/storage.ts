import type { SaveData, TeamIds, TeamInfo } from './types';
import { emptyTeam, defaultTeamInfo } from './types';

const KEY = 'cs2tb:v1';
export const STARTING_COINS = 1000;

const fresh = (): SaveData => ({
  profile: null, team: emptyTeam(), teamInfo: defaultTeamInfo(), coins: STARTING_COINS, owned: [],
});

/** Reprend l'identité sauvegardée en vérifiant chaque champ (anciennes sauvegardes, données abîmées). */
function loadTeamInfo(raw: Partial<TeamInfo> | undefined): TeamInfo {
  const def = defaultTeamInfo();
  if (!raw || typeof raw !== 'object') return def;
  const logo = raw.logo;
  const validLogo =
    logo && ((logo.kind === 'emoji' && typeof logo.emoji === 'string' && typeof logo.color === 'string') ||
      (logo.kind === 'image' && typeof logo.dataUrl === 'string' && logo.dataUrl.startsWith('data:image/')));
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : def.name,
    logo: validLogo ? logo : def.logo,
    wins: count(raw.wins),
    losses: count(raw.losses),
  };
}

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
      teamInfo: loadTeamInfo(data.teamInfo),
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
