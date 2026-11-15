// The catalogue's extra knowledge about a piece, kept beside the original table (src/core/catalog.ts) instead of widening it: which tray
// category it is in, which generator draws it, how a walker uses it (lie, sit, sit on a swing, stand at it, or just see its size), the
// clearance zones that make its verdict honest (a swing's arc, a fridge door, a recliner's footrest, a WC's front space) and where it may
// stand. Pure data and pure maths, no three.js. Rows of the original table (beds, sofas, wardrobes...) have no rule here and behave as before.
import type { RoomType, Side } from '../types';
import { MORE_PIECES } from './catalog-more';
import { SPACE_PIECES } from './catalog-spaces';

export type PieceCategory = 'seating' | 'beds' | 'storage' | 'tables' | 'kitchen' | 'kids' | 'balcony' | 'fitness' | 'swing' | 'bathroom'
  // the shared spaces of a building (src/core/places.ts decides which of them a kind of space shows)
  | 'cardio' | 'strength' | 'freeweights' | 'studio' | 'amenities' | 'reception' | 'decor' | 'stage' | 'games';
export const CATEGORIES: { id: PieceCategory; label: string }[] = [
  { id: 'seating', label: 'Seating' },
  { id: 'beds', label: 'Beds' },
  { id: 'storage', label: 'Storage & utility' },
  { id: 'tables', label: 'Tables' },
  { id: 'kitchen', label: 'Kitchen & appliances' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'kids', label: 'Kids' },
  { id: 'balcony', label: 'Balcony' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'swing', label: 'Swing' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'strength', label: 'Strength' },
  { id: 'freeweights', label: 'Free weights' },
  { id: 'studio', label: 'Studio' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'reception', label: 'Reception & security' },
  { id: 'decor', label: 'Plants & decor' },
  { id: 'stage', label: 'Stage & AV' },
  { id: 'games', label: 'Games' },
];

/** What the walker does at a piece. `swing` is a seat that rocks; `stand` is "stand at the counter"; `dims` is the size card. */
export type PoseKind = 'lie' | 'sit' | 'chair' | 'swing' | 'stand' | 'dims' | 'walk-on';

/**
 * Where a walker sits on a machine, a bench, a bike or a rower: the hips `z` metres from the middle of the footprint toward its front (negative: toward the back),
 * facing `face` (+1 the front, -1 the back), with the seat at the item's `surfaceHeightM`.
 */
export interface SeatSpec { z: number; face: 1 | -1 }

/** The finish families a piece can name (src/look/finishes.ts is the owner of the slots). */
export type PieceFamily = 'bed' | 'sofa' | 'wardrobe' | 'table' | 'chair' | 'swing' | 'storage' | 'appliance' | 'pouf' | 'bunk' | 'plain' | 'sanitary';

/**
 * Space a piece needs beyond one of its sides. `needM` is measured from the footprint edge. A swing computes it from the length of its
 * chains and a swing angle (`swing`). Below `tightFrac` of the need the piece is blocked, between that and the need it is tight.
 */
export interface Zone {
  id: string;
  sides: Side[];
  needM: number;
  /** length of the zone across the side, default the side's own length */
  widthM?: number;
  tightFrac?: number;
  /** the zone is "in front", "behind", "in front and behind", "on each side": how the need is worded */
  where: string;
  /** the assumed dimension behind the need, spoken after it (a function of the footprint when a resized piece changes it) */
  assumption: string | ((fp: { w: number; d: number }) => string);
  /** what happens when it is blocked and when it is tight, `{obs}` is "the wall" or "the furniture" */
  blockedText: string;
  tightText: string;
  /** a pendulum: the chains hang from `hang` (the ceiling, or a height in metres) and swing `angleDeg` each way */
  swing?: { angleDeg: number; hang: 'ceiling' | number; seatHalfM: number; seatTopM: number; minCeilingM?: number };
  /** how the zone's sentence names the piece when it is a hung one that is not a swing (a heavy bag): "Heavy bag needs ..." */
  label?: string;
  /** never less than this, whatever the arc maths gives */
  minNeedM?: number;
  /** a door as wide as the piece (or a share of it): the need is `widthFrac * footprint width + needM` instead of a fixed number */
  doorOfWidth?: { frac: number };
  /** a bed that folds out to a square: the need is the footprint's width minus its depth, plus `needM` */
  opensToSquare?: boolean;
}

export interface PieceRule {
  id: string;
  category: PieceCategory;
  keywords: string[];
  /** which generator (a LookKind of src/look/gen) and the params that make this row the piece it is */
  look: { kind: string; params?: Record<string, unknown> };
  family: PieceFamily | null;
  pose: PoseKind;
  prompt?: string;
  upPrompt?: string;
  /** height of the piece's lowest part above the floor, for wall-mounted pieces (a basin, a geyser, a mandir) */
  mountY?: number;
  /** needs a wall behind it */
  wall?: boolean;
  /** the piece is as tall as the ceiling allows (a loft unit): its height is set when it is placed */
  fullHeight?: boolean;
  /** where it belongs; elsewhere it is allowed, with a note */
  rooms?: RoomType[];
  roomNote?: string;
  zones?: Zone[];
  /** a sentence for the piece's card: what is assumed */
  note?: string;
  /** a hung swing: the line that says its hook is not on the drawing */
  hung?: boolean;
  /** a surface the tests probe from above (x, z in the piece's frame) */
  probe?: [number, number];
  /** where a walker sits (`pose` 'sit' or 'chair' on a machine): see `SeatSpec` */
  seat?: SeatSpec;
}

/**
 * Which sizes of a piece the viewer may try (the steppers of edit-all, src/buyer/resize.ts): `none` for a seat on chains, round pieces and
 * pieces whose parts have a fixed size (a stool, a bunk bed with its ladder, a shower rail); `wd` width and depth about the catalogue size;
 * `wdh` also the height, for storage whose shelves and doors simply stretch. A wall piece, an appliance, a fitting and a ceiling-height unit keep
 * their standard height (a basin's rim, a geyser's base), so they never offer it.
 */
export type SizeMode = 'none' | 'wd' | 'wdh';
const FIXED_SIZE = new Set(['coffee-round', 'dining-round-4', 'planter-pot', 'bar-stool', 'office-chair', 'bunk-bed', 'diwan', 'shower-over', 'shower-hand', 'balcony-chair', 'hang-chair', 'hang-chair-stand', 'bean-bag', 'floor-drain', 'yoga-mat']);
const NO_STRETCH = new Set<PieceCategory>(['cardio', 'strength', 'freeweights', 'studio', 'amenities', 'stage', 'games', 'decor']);
const STRETCH_HEIGHT = new Set(['shoe-rack', 'bookshelf-narrow', 'bookshelf-wide', 'chest-drawers', 'crockery-unit', 'sideboard', 'steel-almirah']);
export function sizeModeOf(id: string | undefined | null): SizeMode | null {
  const r = pieceRule(id);
  if (!r) return null;
  // equipment, stage modules and fixed fittings have parts of one size: only the lobby and hall furniture below can stretch
  if (r.look.kind === 'swing' || FIXED_SIZE.has(r.id) || NO_STRETCH.has(r.category)) return 'none';
  return STRETCH_HEIGHT.has(r.id) ? 'wdh' : 'wd';
}

export const PIECE_RULES: Record<string, PieceRule> = Object.fromEntries([...MORE_PIECES, ...SPACE_PIECES].map((p) => [p.rule.id, p.rule]));

export function pieceRule(catalogId: string | undefined | null): PieceRule | null {
  return catalogId ? (PIECE_RULES[catalogId] ?? null) : null;
}

/** The tray category of any catalogue row; the original rows are named here. */
const LEGACY: Record<string, PieceCategory> = {
  'bed-single': 'beds', 'bed-double': 'beds', 'bed-queen': 'beds', 'bed-king': 'beds',
  'sofa-3': 'seating', 'sofa-2': 'seating', 'sofa-l': 'seating', armchair: 'seating',
  'dining-6': 'tables', 'study-table': 'tables', 'side-table': 'tables',
  'wardrobe-2': 'storage', 'wardrobe-3': 'storage', 'wardrobe-4': 'storage',
};
export function categoryOf(id: string): PieceCategory {
  return pieceRule(id)?.category ?? LEGACY[id] ?? 'storage';
}
export function categoryLabel(c: PieceCategory): string {
  return CATEGORIES.find((x) => x.id === c)?.label ?? c;
}

// ---------------------------------------------------------------- the swing

/** The horizontal travel of a seat on chains `lengthM` long, swung `angleDeg` each way from the vertical. */
export function swingReachM(lengthM: number, angleDeg: number): number {
  return Math.max(0, lengthM * Math.sin((angleDeg * Math.PI) / 180));
}

/** Hook (or frame beam) height of a swing under `ceilingM`. */
export function hangHeightM(z: Zone, ceilingM: number): number {
  const sw = z.swing;
  if (!sw) return ceilingM;
  return sw.hang === 'ceiling' ? ceilingM : sw.hang;
}

/** Chain length from the hook to the seat top. */
export function chainLengthM(z: Zone, ceilingM: number): number {
  const sw = z.swing;
  if (!sw) return 0;
  return Math.max(0, hangHeightM(z, ceilingM) - sw.seatTopM);
}

/** The swing zone of a piece, if it is a swing. */
export function swingZone(id: string | undefined | null): Zone | null {
  return pieceRule(id)?.zones?.find((z) => !!z.swing) ?? null;
}
