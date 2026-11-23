// The plants of an Indian residential landscape (SPEC 19.4). Pure data: what each species is, how big, what colour. The geometry is
// made from it in foliage.ts (procedural, no model files, so no licence to carry). Sizes are typical mature heights for a society garden,
// not a botanical survey.
import type { SpeciesId } from './types';
import type { OutdoorModelId } from './real';

/** `candelabra` (SPEC 19.13, 23 Nov 2026): a frangipani, a short trunk forking into thick upturned branches with a rosette of long leaves and a
 *  cluster of flowers at every tip */
export type PlantForm = 'palm' | 'crown' | 'umbrella' | 'shrub' | 'bush' | 'clumping-palm' | 'candelabra';
export interface Species {
  id: SpeciesId;
  name: string;
  form: PlantForm;
  /** typical height of a plant in the ground, metres, [smallest, tallest] of the variation within a planting */
  heightM: [number, number];
  /** crown radius at the usual height, metres */
  crownR: number;
  /** a leaf's colours: mid, light and dark (sRGB hex) */
  leaf: [string, string, string];
  /** blossom colour and how much of the crown it covers 0..1 (0 for none) */
  flower: string | null;
  flowerAmount: number;
  trunk: string;
  /** how wide a trunk of the usual height is at the base */
  trunkR: number;
  /** a shrub is also used as a clipped hedge */
  hedge?: boolean;
  /** SPEC 19.12: drawn by a model (src/outdoor/real.ts) once it arrives; until then (and in Node) by the procedural form */
  model?: OutdoorModelId;
}

export const SPECIES: Record<SpeciesId, Species> = {
  'royal-palm': { id: 'royal-palm', name: 'Royal palm', form: 'palm', heightM: [7.5, 10], crownR: 2.3, leaf: ['#3F7A33', '#5F9A45', '#2B5A27'], flower: null, flowerAmount: 0, trunk: '#B9B4A8', trunkR: 0.26, model: 'royal-palm' },
  'areca-palm': { id: 'areca-palm', name: 'Areca palm', form: 'clumping-palm', heightM: [2.6, 4.2], crownR: 1.3, leaf: ['#5F9F38', '#86B94B', '#3F7A2C'], flower: null, flowerAmount: 0, trunk: '#9C9A58', trunkR: 0.04, model: 'areca-palm' },
  frangipani: { id: 'frangipani', name: 'Frangipani (champa)', form: 'candelabra', heightM: [3.2, 4.8], crownR: 1.7, leaf: ['#4E8A3E', '#6FA04E', '#386A32'], flower: '#FBF3E0', flowerAmount: 0.3, trunk: '#8E8A80', trunkR: 0.13 },
  neem: { id: 'neem', name: 'Neem', form: 'umbrella', heightM: [6, 8.5], crownR: 3.4, leaf: ['#4A7F35', '#6A9A45', '#34602A'], flower: null, flowerAmount: 0, trunk: '#6B5A48', trunkR: 0.17, model: 'neem' },
  gulmohar: { id: 'gulmohar', name: 'Gulmohar', form: 'umbrella', heightM: [6, 8], crownR: 3.8, leaf: ['#5C9A3E', '#7DB652', '#3F7A30'], flower: '#E2491F', flowerAmount: 0.4, trunk: '#6F6153', trunkR: 0.15 },
  ficus: { id: 'ficus', name: 'Ficus', form: 'crown', heightM: [1.5, 6], crownR: 2.2, leaf: ['#2F6A2E', '#4A8838', '#1F4F23'], flower: null, flowerAmount: 0, trunk: '#6A5F52', trunkR: 0.2, hedge: true },
  bougainvillea: { id: 'bougainvillea', name: 'Bougainvillea', form: 'shrub', heightM: [1.3, 2.2], crownR: 1.0, leaf: ['#4F8A3A', '#6BA047', '#3B6D2E'], flower: '#D63384', flowerAmount: 0.6, trunk: '#6C5B49', trunkR: 0.03 },
  hibiscus: { id: 'hibiscus', name: 'Hibiscus', form: 'shrub', heightM: [1.2, 1.9], crownR: 0.8, leaf: ['#3E7A34', '#5B9544', '#2D5E2A'], flower: '#D7262E', flowerAmount: 0.18, trunk: '#6C5B49', trunkR: 0.025 },
  // a coconut palm: the model is a pair of trunks from one foot (CC-BY 4.0, evolveduk; SPEC 19.12), the size of a mature garden coconut
  'coconut-palm': { id: 'coconut-palm', name: 'Coconut palm', form: 'palm', heightM: [6.8, 8.4], crownR: 3.0, leaf: ['#4F8A3A', '#6FA04E', '#386A32'], flower: null, flowerAmount: 0, trunk: '#A39276', trunkR: 0.2, model: 'coconut-palm' },
  croton: { id: 'croton', name: 'Croton', form: 'bush', heightM: [0.7, 1.2], crownR: 0.45, leaf: ['#C9892B', '#E4B94C', '#8E3E22'], flower: null, flowerAmount: 0, trunk: '#6C5B49', trunkR: 0.02 },
};

export const speciesOf = (id: SpeciesId): Species => SPECIES[id];
