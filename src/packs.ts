import type { Rarity } from './types';

export interface PackDef {
  id: string;
  name: string;
  tagline: string;
  price: number;
  /** probabilités de base par rareté, en % (ramenées à 100 % selon les joueurs éligibles) */
  odds: Record<Rarity, number>;
  /** note maximale / minimale des joueurs qui peuvent tomber dans la caisse */
  maxOvr?: number;
  minOvr?: number;
  accent: string;
}

export const PACKS: PackDef[] = [
  {
    id: 'recrue',
    name: 'Caisse Recrue',
    tagline: 'Aucune star : note maximale 77',
    price: 100,
    maxOvr: 77,
    odds: { silver: 70, gold: 30, legend: 0 },
    accent: '#9fb0c9',
  },
  {
    id: 'pro',
    name: 'Caisse Pro',
    tagline: 'Tous les joueurs, les légendes sont très rares',
    price: 400,
    odds: { silver: 60, gold: 39.75, legend: 0.25 },
    accent: '#e8a838',
  },
  {
    id: 'elite',
    name: 'Caisse Élite',
    tagline: 'Que du haut niveau : note minimale 78',
    price: 1000,
    minOvr: 78,
    odds: { silver: 0, gold: 99, legend: 1 },
    accent: '#9b7bff',
  },
];

export const RARITY_LABEL: Record<Rarity, string> = {
  silver: 'Silver Elite',
  gold: 'Gold Star',
  legend: 'Légende',
};
