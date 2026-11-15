// The catalogue's extra knowledge about a piece, kept beside the original table (src/core/catalog.ts) instead of widening it: which tray
// category it is in, which generator draws it, how a walker uses it (lie, sit, sit on a swing, stand at it, or just see its size), the
// clearance zones that make its verdict honest (a swing's arc, a fridge door, a recliner's footrest, a WC's front space) and where it may
// stand. Pure data and pure maths, no three.js. Rows of the original table (beds, sofas, wardrobes...) have no rule here and behave as before.
import type { RoomType, Side } from '../types';
import { MORE_PIECES } from './catalog-more';

export type PieceCategory = 'seating' | 'beds' | 'storage' | 'tables' | 'kitchen' | 'kids' | 'balcony' | 'fitness' | 'swing' | 'bathroom';
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
];

/** What the walker does at a piece. `swing` is a seat that rocks; `stand` is "stand at the counter"; `dims` is the size card. */
export type PoseKind = 'lie' | 'sit' | 'chair' | 'swing' | 'stand' | 'dims';

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
  /** the assumed dimension behind the need, spoken after it */
  assumption: string;
  /** what happens when it is blocked and when it is tight, `{obs}` is "the wall" or "the furniture" */
  blockedText: string;
  tightText: string;
  /** a pendulum: the chains hang from `hang` (the ceiling, or a height in metres) and swing `angleDeg` each way */
  swing?: { angleDeg: number; hang: 'ceiling' | number; seatHalfM: number; seatTopM: number; minCeilingM?: number };
  /** never less than this, whatever the arc maths gives */
  minNeedM?: number;
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
}

export const PIECE_RULES: Record<string, PieceRule> = Object.fromEntries(MORE_PIECES.map((p) => [p.rule.id, p.rule]));

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
