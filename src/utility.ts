import type { Vec, SiteId } from './maps';

/**
 * Module de stuff (fumigènes, molotovs, flashs).
 *
 * Rien n'est lancé au hasard : chaque carte a des placements nommés et des séquences reprises des schémas
 * qu'on retrouve dans les matchs pros (Vitality, Spirit, etc.) et les guides de lineups :
 * - exécution T : fumigènes qui coupent les rotations CT, puis molotovs sur les positions de défense,
 *   puis flashs « pop » juste avant l'entrée, puis entrée sur le site ;
 * - retardement CT : incendiaire (et flash) quand les T se montrent à un passage clé ;
 * - reprise CT : flash au-dessus du site et fumigène sur la position de garde des T ;
 * - après la pose : molotov des T sur la bombe quand un CT commence à désamorcer ;
 * - débuts de manche classiques (ex. fumigène Xbox sur Dust II).
 *
 * Les cibles reprennent les callouts des cartes ; les points de lancer et les durées de vol sont calculés (voir Lineup).
 */

import lineups from './data/lineups.json';

export type NadeKind = 'smoke' | 'flash' | 'molotov';

/**
 * Un lancer du module : d'où le joueur lance (`from`), où la grenade arrive (`at`), comment (debout, sauté, en
 * courant…) et combien de temps elle vole (`air`). Tout est calculé par tools/build_lineups.py avec la physique des
 * grenades de CS2 et le maillage de collision de la carte : chaque lancer est réalisable dans le vrai jeu.
 */
export interface Lineup {
  kind: NadeKind;
  name: string;
  at: Vec;
  from: Vec;
  /** durée de vol jusqu'au premier impact (s) */
  air: number;
  throw: 'stand' | 'jump' | 'mid' | 'lob' | 'runjump' | 'direct';
  /** ordre dans la séquence (s) */
  delay: number;
}

export interface CtDelay {
  /** zone qui déclenche (un T y entre) */
  zone: Vec;
  r: number;
  nades: Lineup[];
}

export interface EarlyNade extends Lineup {
  side: 'T' | 'CT';
  /** probabilité qu'elle soit jouée dans une manche donnée */
  p: number;
}

export interface MapUtility {
  execute: Record<SiteId, Lineup[]>;
  ctDelay: CtDelay[];
  retake: Record<SiteId, Lineup[]>;
  early: EarlyNade[];
}

export const UTILITY = lineups as unknown as Record<string, MapUtility>;

/** Type de lancer affiché à côté du nom. */
export const THROW_LABEL: Record<Lineup['throw'], string> = {
  stand: '', jump: 'jumpthrow', mid: 'mi-force', lob: 'lob', runjump: 'run + jumpthrow', direct: '',
};

/** Qui lance quoi en priorité (rôle tactique). L'entry (RIF) ne se flashe pas lui-même. */
export const THROW_PRIORITY: Record<NadeKind, string[]> = {
  smoke: ['IGL', 'SUP', 'LRK', 'AWP', 'RIF'],
  molotov: ['SUP', 'LRK', 'IGL', 'RIF', 'AWP'],
  flash: ['SUP', 'IGL', 'LRK', 'AWP', 'RIF'],
};

/** Durées (secondes de jeu, valeurs de CS2). */
export const NADE_TIME = { smoke: 18, molotov: 7, flashBurst: 0.35 };
/** Une flash éclate 1,6 s après le lancer, une fumée se déclenche ~0,6 s après son premier impact (elle roule). */
export const FLASH_FUSE = 1.6;
export const SMOKE_POP = 0.6;
/** Temps pour dégoupiller, viser et lancer. */
export const WINDUP = 0.4;
