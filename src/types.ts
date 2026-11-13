// ---------- maths ----------
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };
/** [x, y, z, w] */
export type Quat = [number, number, number, number];
export type Px = { x: number; y: number };

// ---------- layout ----------
export type RoomType = 'bedroom' | 'living' | 'kitchen' | 'bathroom' | 'balcony' | 'other';
export type EdgeKind = 'wall' | 'railing' | 'none';
export interface RoomTag {
  id: string;
  roomType: RoomType;
  label: string;
  /** inside faces of the walls, world XZ, >= 3 points, positive signed area, not self-intersecting */
  polygon: Vec2[];
  /** same length as polygon; edges[i] is the edge polygon[i] -> polygon[i+1] */
  edges: EdgeKind[];
  /** '#rrggbb' overrides of the global finishes */
  wallColor?: string;
  floorColor?: string;
  /** set when the room is only partly on the drawing (e.g. runs off the sheet): its shape is a guess, it is not a start point */
  partial?: { reason: string };
}
export type OpeningType = 'door' | 'opening' | 'window';
export interface Opening {
  id: string;
  roomId: string;
  edge: number;
  type: OpeningType;
  /** distance along the edge from polygon[edge] to the opening's centre */
  centreM: number;
  widthM: number;
  /** bottom of the hole above the floor; 0 for doors and openings */
  sillM: number;
  /** top of the hole above the floor */
  headM: number;
}
export interface Finishes {
  wallColor: string;
  floorColor: string;
  /** tile size in metres, or null for a plain floor */
  tile: { wM: number; lM: number } | null;
  groutColor: string;
  frameColor: string;
  ceilingColor: string;
  railingColor: string;
  /** 'sampled' when any colour came from video frames */
  source: 'default' | 'sampled';
}
export const DEFAULT_FINISHES: Finishes = {
  wallColor: '#F2EFE9', floorColor: '#D9CFC1', tile: { wM: 0.6, lM: 0.6 }, groutColor: '#B9AE9F',
  frameColor: '#4A3528', ceilingColor: '#FAFAF8', railingColor: '#3A3A3C', source: 'default',
};
export interface PlanUnderlay {
  /** file in the scene folder, e.g. 'plan.jpg' */
  file: string;
  pxPerM: number;
  originPx: Px;
  /** the dimensions the broker clicked and typed */
  dimensions: { a: Px; b: Px; lengthM: number }[];
  disagreementPct: number;
}
export interface Layout {
  wallHeightM: number;      // default 2.75
  wallThicknessM: number;   // default 0.12, used where a wall has no room behind it
  railingHeightM: number;   // default 1.1
  rooms: RoomTag[];
  openings: Opening[];
  finishes: Finishes;
  scaleSource: 'plan-dimensions' | 'typed-sizes' | 'scan';
  underlay?: PlanUnderlay;
}
/** Phase 2 plug: what an automatic pipeline hands the editor. File: public/scenes/<id>/proposal.json */
export interface LayoutProposal {
  version: 1;
  source: string;                 // e.g. 'moge2+vggt@modal'
  rooms: RoomTag[];
  openings: Opening[];
  wallHeightM?: number;
  finishes?: Partial<Finishes>;
  confidence: number;             // 0..1
  notes?: string[];
}

// ---------- derived wall geometry (core/layout-geom.ts) ----------
export interface EdgeFrame {
  roomId: string; edge: number; kind: EdgeKind;
  a: Vec2; b: Vec2;
  /** unit a -> b */ dir: Vec2;
  /** unit outward normal */ out: Vec2;
  length: number;
  /** slab thickness for this edge, metres */ thickness: number;
  /** gap to the facing room's edge, or null when nothing faces it */ partnerGap: number | null;
}
/** A box of wall: along the edge from u0 to u1, outward by `thickness`, from y0 to y1. */
export interface WallPiece {
  roomId: string; edge: number; kind: 'wall' | 'railing';
  u0: number; u1: number; y0: number; y1: number; thickness: number;
}
/** The hole an opening (or a 'none' edge) cuts, measured on its own edge. */
export interface Tunnel {
  openingId: string | null;
  roomId: string; edge: number;
  type: OpeningType;
  u0: number; u1: number;
  /** how far outward the hole goes */ depth: number;
  sillM: number; headM: number;
  /** true for door, opening and 'none' edges */ passable: boolean;
}

// ---------- grid ----------
export const GRID_CELL_M = 0.05;
export const GRID_FREE = 0;
export const GRID_VOID = 255;
/** obstacle cells hold their height in cm, 1..250. >= GRID_TALL_CM means full height. */
export const GRID_TALL_CM = 170;
export const GRID_WALL_CM = 250;
/** Cell (i, j) covers x in [originX + i*cellM, +cellM), z likewise. Index = j*nx + i. */
export interface Grid {
  cellM: number; originX: number; originZ: number; nx: number; nz: number;
  /** 0 free, 1..250 obstacle height in cm, 255 void (no floor) */
  cells: Uint8Array;
}

// ---------- furniture ----------
export interface Box { cx: number; cz: number; w: number; d: number; yawDeg: number }
export type Side = 'front' | 'back' | 'left' | 'right';
export type FurnitureKind = 'bed' | 'sofa' | 'dining' | 'wardrobe' | 'counter';
export interface AccessRule { sides: Side[]; minM: number; mode: 'any' | 'all' }
export interface CatalogItem {
  id: string;
  kind: FurnitureKind;
  name: string;                         // 'King bed'
  sizeLabel: string;                    // '183 × 198 cm (72 × 78 in)'
  footprint: { w: number; d: number };  // outer, metres
  heightM: number;                      // overall, for collision and the ceiling check
  surfaceHeightM: number;               // mattress top, seat, table top, counter top
  inner?: { w: number; d: number };     // mattress, when smaller than the footprint
  access: AccessRule[];
  sideWords: Record<Side, string>;
}
export interface FurnitureItem {
  id: string;
  /** real = already in the flat, tagged by the broker, immovable. virtual = catalogue item. */
  source: 'real' | 'virtual';
  kind: FurnitureKind;
  catalogId?: string;
  label: string;
  box: Box;
  heightM: number;
  surfaceHeightM: number;
  inner?: { w: number; d: number };
}

// ---------- splat overlay ----------
export type UpPreset = 'as-is' | 'flip-x' | 'z-up';
export interface SceneTransform { rotation: Quat; scale: number; position: [number, number, number] }
export interface SplatOverlay {
  file: string;
  format: 'ply' | 'spz' | 'splat';
  upPreset: UpPreset | 'manual';
  transform: SceneTransform;
  mode: 'overlay' | 'replace';
}
/** Splat centres as read from a file. positions = xyz * count. */
export interface RawCloud { count: number; positions: Float32Array; opacity: Uint8Array; rgb: Uint8Array }
export interface LevelResult {
  /** takes raw points to a Y-up frame whose floor is horizontal */
  rotation: Quat;
  /** floor height in that frame, raw units */
  floorOffsetRaw: number;
  /** ceiling height above the floor, raw units, or null */
  ceilingRaw: number | null;
  tiltDeg: number;
  confidence: number;
  /** true when confidence < 3 or tiltDeg > 15 */
  lowConfidence: boolean;
}

// ---------- property.json ----------
export interface PropertyFile {
  version: 1;
  id: string;
  title: string;
  subtitle?: string;
  layout: Layout;
  furniture: FurnitureItem[];
  splat?: SplatOverlay;
  spawn: { x: number; z: number; yawDeg: number };
  updatedAt: string; // ISO 8601
}

// ---------- check results ----------
export type Tone = 'good' | 'warn' | 'bad';
export interface CheckCard { title: string; tone: Tone; headline: string; lines: string[]; footer?: string }
export interface BedFit { verdict: 'fits' | 'tight' | 'too-short'; spareCm: number; sleeps: 0 | 1 | 2; card: CheckCard }
export interface PlacementResult {
  verdict: 'fits' | 'tight' | 'blocked';
  reason: 'ok' | 'access' | 'collides' | 'outside' | 'too-tall';
  /** metres to the first non-free cell on each side, capped at 3.0 */
  clearanceM: Record<Side, number>;
  tone: Tone;
  message: string;
}

// ---------- poses ----------
export interface LiePose { feet: Vec2; yawDeg: number; surfaceY: number }
export interface SeatPose { root: Vec2; rootY: number; yawDeg: number }
export interface StandPose { root: Vec2; yawDeg: number }

// ---------- character constants ----------
export const CHARACTER_URL = '/characters/mannequin.glb';
export const HEIGHT_PRESETS_CM = [160, 175, 190] as const;
export const HEIGHT_MIN_CM = 140;
export const HEIGHT_MAX_CM = 200;
export const HEIGHT_TINTS = ['#1FA3A3', '#E8823A', '#7A5AF0'] as const;
export const CHARACTER_RADIUS_M = 0.22;
/** ratios of body height, read from the GLB's Sitting_Idle_Loop hips keyframes */
export const SIT_HIP_BACK_RATIO = 0.186;  // hips sit this far behind the root
export const SIT_SEAT_RATIO = 0.26;       // seat height the clip assumes
export const LIE_BACK_RATIO = 0.09;       // lift so the back rests on the surface
export const WALKWAY_M = 0.6;
