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
  /** image affichée sur la caisse (fichier dans public/crates/) */
  image: string;
}

export const PACKS: PackDef[] = [
  {
    id: 'recrue',
    name: 'Caisse Recrue',
    tagline: 'Aucune star : note maximale 77',
    price: 100,
    maxOvr: 77,
    odds: { silver: 70, gold: 30, legend: 0, icon: 0 },
    accent: '#9fb0c9',
    image: '/crates/ak-asiimov.png',
  },
  {
    id: 'pro',
    name: 'Caisse Pro',
    tagline: 'Tous les joueurs, légendes et icônes très rares',
    price: 400,
    odds: { silver: 60, gold: 39.65, legend: 0.25, icon: 0.1 },
    accent: '#e8a838',
    image: '/crates/awp-dragon-lore.png',
  },
  {
    id: 'elite',
    name: 'Caisse Élite',
    tagline: 'Que du haut niveau : note minimale 78',
    price: 1000,
    minOvr: 78,
    odds: { silver: 0, gold: 98.25, legend: 1, icon: 0.75 },
    accent: '#9b7bff',
    image: '/crates/karambit-ruby.png',
  },
];

export const RARITY_LABEL: Record<Rarity, string> = {
  silver: 'Silver Elite',
  gold: 'Gold Star',
  legend: 'Légende',
  icon: 'Icône',
};
