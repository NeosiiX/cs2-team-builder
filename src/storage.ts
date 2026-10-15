import type { SaveData } from './types';
import { emptyTeam } from './types';

const KEY = 'cs2tb:v1';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { profile: null, team: emptyTeam() };
    const data = JSON.parse(raw) as Partial<SaveData>;
    return {
      profile: data.profile ?? null,
      team: { ...emptyTeam(), ...(data.team ?? {}) },
    };
  } catch {
    return { profile: null, team: emptyTeam() };
  }
}

export function persist(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
  }
}