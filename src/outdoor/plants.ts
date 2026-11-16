// Planting as numbers (SPEC 19.4): a seeded scatter for a bed, spacing for a row, hedge segments, and what a tier draws. Pure, no three.
// The same file always grows the same garden: every random choice comes from a seed in the file.
import { pointInPolygon } from '../core/geometry';
import type { Tier } from '../look/types';
import type { OutdoorFile, PlantBed, PlantRow, PlantSpot, SpeciesId, Vec2Like } from './types';
import { speciesOf } from './species';

export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function polyBounds(p: Vec2Like[]): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  return { x0, z0, x1, z1 };
}
export function polyArea(p: Vec2Like[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.z - q.x * p[i].z; }
  return Math.abs(a) / 2;
}

/** A bed's plants: a jittered grid of cells `1/sqrt(density)` apart, kept inside the polygon, each given a species by weight, a size and a turn. */
export function scatterBed(bed: PlantBed): PlantSpot[] {
  const r = rng(bed.seed * 7919 + 13);
  const step = 1 / Math.sqrt(bed.density);
  const b = polyBounds(bed.polygon);
  const total = bed.species.reduce((s, q) => s + q.weight, 0);
  const pick = (): SpeciesId => { let t = r() * total; for (const s of bed.species) { t -= s.weight; if (t <= 0) return s.id; } return bed.species[bed.species.length - 1].id; };
  const out: PlantSpot[] = [];
  for (let z = b.z0 + step / 2; z < b.z1; z += step) {
    for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      const p = { x: x + (r() - 0.5) * step * 0.8, z: z + (r() - 0.5) * step * 0.8 };
      if (!pointInPolygon(p, bed.polygon)) { r(); r(); r(); continue; }
      out.push({ species: pick(), x: p.x, z: p.z, scale: (bed.scale ?? 1) * (0.8 + r() * 0.4), rotDeg: r() * 360 });
    }
  }
  return out;
}

/** "Plant a row": one plant every `spacingM` along a line, both ends included. */
export function plantRow(row: PlantRow): PlantSpot[] {
  const dx = row.to.x - row.from.x, dz = row.to.z - row.from.z;
  const len = Math.hypot(dx, dz);
  const sp = row.spacingM ?? Math.max(0.5, speciesOf(row.species).crownR * 1.6);
  const n = Math.max(1, Math.round(len / sp));
  const out: PlantSpot[] = [];
  const r = rng(Math.round(row.from.x * 131 + row.from.z * 733) + 5);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push({ species: row.species, x: row.from.x + dx * t, z: row.from.z + dz * t, scale: (row.scale ?? 1) * (0.94 + r() * 0.12), rotDeg: r() * 360 });
  }
  return out;
}

export interface HedgeSeg { x: number; z: number; /** the direction of the hedge, degrees (atan2 of dx over dz) */ yawDeg: number; lenM: number; widthM: number; heightM: number; species: SpeciesId; id: string }
const HEDGE_SEG_M = 1.0;
/** A clipped hedge: one block per metre (they overlap a little so it reads as one mass). */
export function hedgeSegments(row: PlantRow): HedgeSeg[] {
  const dx = row.to.x - row.from.x, dz = row.to.z - row.from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return [];
  const n = Math.max(1, Math.round(len / HEDGE_SEG_M));
  const yawDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  const sp = speciesOf(row.species);
  const out: HedgeSeg[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.push({ x: row.from.x + dx * t, z: row.from.z + dz * t, yawDeg, lenM: (len / n) * 1.08, widthM: row.widthM ?? 0.7, heightM: row.heightM ?? Math.min(1.6, sp.heightM[1]), species: row.species, id: row.id });
  }
  return out;
}

/** every plant of the file: the trees, each bed's scatter, each row of separate plants */
export function allPlants(f: OutdoorFile): PlantSpot[] {
  return [...f.trees, ...f.beds.flatMap(scatterBed), ...f.rows.filter((r) => r.style === 'row').flatMap(plantRow)];
}
export const allHedges = (f: OutdoorFile): HedgeSeg[] => f.rows.filter((r) => r.style === 'hedge').flatMap(hedgeSegments);

// ---------------------------------------------------------------- what a tier draws

/** the share of a bed's shrubs a tier draws (trees and palms are always all drawn), and how many leaf cards a clump of foliage gets */
export const VEG_TIER: Record<Tier, { shrubShare: number; cardsPerClump: number; wind: boolean; clumpsPerTree: number }> = {
  low: { shrubShare: 0.55, cardsPerClump: 9, wind: false, clumpsPerTree: 9 },
  medium: { shrubShare: 1, cardsPerClump: 22, wind: true, clumpsPerTree: 18 },
  high: { shrubShare: 1, cardsPerClump: 30, wind: true, clumpsPerTree: 26 },
};
const isShrub = (s: SpeciesId): boolean => { const f = speciesOf(s).form; return f === 'shrub' || f === 'bush'; };

function keep(i: number, share: number): boolean {
  if (share >= 1) return true;
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  return h / 4294967296 < share;
}

/** The plants a tier draws: all the trees and palms, a deterministic share of the shrubs. */
export function plantsForTier(f: OutdoorFile, tier: Tier): PlantSpot[] {
  const share = VEG_TIER[tier].shrubShare;
  return allPlants(f).filter((p, i) => !isShrub(p.species) || keep(i, share));
}

export interface PlantBudget {
  plants: number;
  hedgeSegments: number;
  /** instanced meshes: one per species used (foliage) plus one for the trunks of the species that have one */
  drawCalls: number;
  /** triangles of every instance together (an estimate from the generator's card counts) */
  triangles: number;
  perSpecies: Record<string, number>;
}

/** Cards in one plant of a species at a tier (a card is two triangles; a trunk is a short tube). Mirrors foliage.ts. */
export function cardsPerPlant(species: SpeciesId, tier: Tier): number {
  const sp = speciesOf(species);
  const t = VEG_TIER[tier];
  switch (sp.form) {
    case 'palm': return Math.round(t.cardsPerClump * 1.9);
    case 'clumping-palm': return Math.round(t.cardsPerClump * 2.4);
    case 'crown': case 'umbrella': return t.clumpsPerTree * t.cardsPerClump;
    case 'shrub': return Math.round(t.cardsPerClump * 3);
    case 'bush': return Math.round(t.cardsPerClump * 1.6);
  }
}

/** `trisOf(species, tier)` is the exact triangle count of one plant (foliage.ts `speciesTriangles`); without it a rough estimate from the card counts is used */
export function plantBudget(f: OutdoorFile, tier: Tier, trisOf?: (s: SpeciesId, t: Tier) => number, hedgeTris: (t: Tier) => number = () => 752): PlantBudget {
  const plants = plantsForTier(f, tier);
  const hedges = allHedges(f);
  const perSpecies: Record<string, number> = {};
  let tri = 0;
  for (const p of plants) { perSpecies[p.species] = (perSpecies[p.species] ?? 0) + 1; tri += trisOf ? trisOf(p.species, tier) : cardsPerPlant(p.species, tier) * 2 + (speciesOf(p.species).trunkR >= 0.1 ? 120 : 0); }
  for (const h of hedges) { perSpecies[`hedge:${h.species}`] = (perSpecies[`hedge:${h.species}`] ?? 0) + 1; tri += hedgeTris(tier); }
  const species = Object.keys(perSpecies).length;
  return { plants: plants.length, hedgeSegments: hedges.length, drawCalls: species * 2, triangles: tri, perSpecies };
}
