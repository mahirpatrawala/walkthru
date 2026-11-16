// SPEC 16.21 "Realistic materials": an optional layer of photographed PBR texture sets (Poly Haven, CC0) over the procedural shell. Off is the
// procedural look (the default on phones and the low tier, and the fallback while a set loads or if a fetch fails); 1K and 2K add a colour, a normal
// and a roughness map per family, mapped in world metres, tinted by the pack's colour (the map only modulates around its own mean), with the hairline
// joints of tiles and planks still procedural on top. Pure (no three, no DOM): the table, the level rules and the file paths; the loader and the shader
// side are in look.ts and materials.ts.
import type { Tier } from './types';

export type RealismLevel = 'off' | '1k' | '2k';
export const REALISM_LEVELS: RealismLevel[] = ['off', '1k', '2k'];
export const REALISM_KEY = 'walkthru:materials';
export const REALISM_LABEL = 'Realistic materials';
export const REALISM_CHOICE: Record<RealismLevel, string> = { off: 'Off', '1k': '1K', '2k': '2K' };
export const REALISM_NOTE: Record<RealismLevel, string> = {
  off: 'Basic materials, drawn by the program: the lightest.',
  '1k': 'Photographed material maps, faster. They download once, then stay cached.',
  '2k': 'Photographed material maps, sharper (about 5 times the download of 1K). They download once, then stay cached.',
};

export function parseRealism(v: string | null | undefined): RealismLevel | null {
  const s = (v ?? '').toLowerCase();
  return s === 'off' || s === '1k' || s === '2k' ? s : null;
}
export function realismFromQuery(search: string): RealismLevel | null {
  try { return parseRealism(new URLSearchParams(search).get('materials')); } catch { return null; }
}
/** Off on a phone or tablet and on the low tier, 1K on a desktop at medium or high; 2K only when chosen. */
export function defaultRealism(o: { touch: boolean; tier: Tier }): RealismLevel {
  return o.touch || o.tier === 'low' ? 'off' : '1k';
}

/** The families of the table: the surfaces of a flat that a photographed set can sharpen. */
export type RealisticFamily = 'plank' | 'tile' | 'wall' | 'veneer';

export interface RealisticSet {
  /** the Poly Haven slug (CC0), recorded with its hashes in public/look/tex/realistic/realistic.lock.json */
  slug: string;
  /** what it is used for */
  use: string;
  /** metres one repeat of the map covers, on the surface */
  tileM: number;
  /** strength of the normal map (kept low: nothing may look bumpy or noisy) */
  normalScale: number;
  /** the roughness range the roughness map is remapped into */
  rough: [number, number];
  /** the map's light and dark is allowed to show this much around the pack's colour */
  clamp: [number, number];
  /** the grain runs along the texture's v, so a frame member swaps u and v */
  swap?: boolean;
}

export const REALISTIC_SETS: Record<RealisticFamily, RealisticSet> = {
  plank: { slug: 'oak_wood_planks', use: 'wood-look vitrified plank floor (grain per plank; the 200 x 1200 mm layout and joints stay procedural)', tileM: 1.0, normalScale: 0.32, rough: [0.34, 0.66], clamp: [0.6, 1.55] },
  tile: { slug: 'grey_plaster', use: 'stone and vitrified tile (surface variation under the procedural joints and bevel)', tileM: 1.2, normalScale: 0.16, rough: [0.1, 0.3], clamp: [0.82, 1.22] },
  wall: { slug: 'painted_plaster_wall', use: 'wall paint and ceilings (a fine plaster normal)', tileM: 1.6, normalScale: 0.3, rough: [0.78, 0.95], clamp: [0.93, 1.07] },
  veneer: { slug: 'oak_veneer_01', use: 'timber for frames (and the furniture carcasses: the furniture kit loads the same set)', tileM: 0.6, normalScale: 0.38, rough: [0.3, 0.62], clamp: [0.62, 1.5], swap: true },
};

/** Furniture sets that have a 2K file (the furniture kit takes the same photographs: oak veneer for timber, linen for upholstery). */
export const REALISTIC_FURNITURE_2K = new Set(['oak_veneer_01', 'rough_linen']);

/** Files of a set at a level: the roughness map is always the 1K one (it carries no fine detail, and a 2K one costs a third of the texture memory). */
export function realisticPaths(slug: string, level: Exclude<RealismLevel, 'off'>): { diff: string; nor: string; rough: string } {
  const r = level;
  return {
    diff: `tex/realistic/${r}/${slug}/${slug}_diff_${r}.jpg`,
    nor: `tex/realistic/${r}/${slug}/${slug}_nor_gl_${r}.jpg`,
    rough: `tex/realistic/1k/${slug}/${slug}_rough_1k.jpg`,
  };
}

/** The level actually drawn: the governor may have dropped 2K to 1K for speed (never persisted). */
export function effectiveRealism(chosen: RealismLevel, droppedFor2k: boolean): RealismLevel {
  return chosen === '2k' && droppedFor2k ? '1k' : chosen;
}
