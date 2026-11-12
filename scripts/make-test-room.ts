// Synthetic test flat with known truth (SPEC section 6). Exports pure builders (tests import these and
// never read files). Run directly (`npm run make:room`) to write public/scenes/test-flat-empty and test-flat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRID_CELL_M, GRID_FREE, GRID_VOID, DEFAULT_FINISHES,
} from '../src/types';
import type {
  FurnitureItem, Grid, Opening, OpeningType, PropertyFile, Px, Quat, RawCloud, RoomTag, RoomType, Vec3,
} from '../src/types';
import { mulberry32, quatFromAxisAngle, quatFromUnitVectors, quatInvert, quatMul, rotateY, polygonArea } from '../src/core/geometry';
import { createGrid, cellCentre } from '../src/core/grid-codec';
import { formatFtIn } from '../src/core/units';

// ---------------------------------------------------------------- truth constants

const SCALE = 0.37;
const TILT_DEG = 3;
const RAW_OFFSET: Vec3 = { x: 5, y: -2, z: 7 };
const WALL_H = 2.6;

/**
 * `landmarks` (SPEC 6.5: "6 room corners and jambs"): the four bedroom floor corners plus the two door jambs.
 * All world frame (the truth frame, not the editor's).
 */
export const TRUTH: {
  scale: 0.37; tiltDeg: 3; rawOffset: Vec3; wallHeightM: 2.6; doorJambs: [Vec3, Vec3]; landmarks: Vec3[];
} = {
  scale: SCALE,
  tiltDeg: TILT_DEG,
  rawOffset: RAW_OFFSET,
  wallHeightM: WALL_H,
  doorJambs: [{ x: 0.4, y: 1, z: 5 }, { x: 1.3, y: 1, z: 5 }],
  landmarks: [
    { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 5 }, { x: 0, y: 0, z: 5 },
    { x: 0.4, y: 1, z: 5 }, { x: 1.3, y: 1, z: 5 },
  ],
};

const SPAWN = { x: 2.6, z: 0.8, yawDeg: 0 };

function rooms(): RoomTag[] {
  return [
    { id: 'bedroom', roomType: 'bedroom', label: 'Bedroom 1',
      polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 5 }, { x: 0, z: 5 }],
      edges: ['wall', 'wall', 'wall', 'wall'] },
    { id: 'balcony', roomType: 'balcony', label: 'Balcony',
      polygon: [{ x: 0.5, z: -1.62 }, { x: 3.5, z: -1.62 }, { x: 3.5, z: -0.12 }, { x: 0.5, z: -0.12 }],
      edges: ['railing', 'railing', 'wall', 'railing'] },
    { id: 'passage', roomType: 'other', label: 'Passage',
      polygon: [{ x: 0, z: 5.12 }, { x: 4, z: 5.12 }, { x: 4, z: 6.32 }, { x: 0, z: 6.32 }],
      edges: ['wall', 'wall', 'wall', 'wall'] },
  ];
}

function openings(): Opening[] {
  return [
    { id: 'door-bed', roomId: 'bedroom', edge: 2, type: 'door', centreM: 3.15, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'slider', roomId: 'bedroom', edge: 0, type: 'opening', centreM: 2.0, widthM: 1.6, sillM: 0, headM: 2.2 },
    { id: 'window', roomId: 'bedroom', edge: 3, type: 'window', centreM: 1.0, widthM: 1.2, sillM: 0.9, headM: 2.1 },
    { id: 'door-main', roomId: 'passage', edge: 1, type: 'door', centreM: 0.6, widthM: 0.9, sillM: 0, headM: 2.1 },
  ];
}

function furniture(): FurnitureItem[] {
  return [
    { id: 'bed-1', source: 'real', kind: 'bed', label: 'Bed',
      box: { cx: 1.0, cz: 2.25, w: 1.5, d: 2.0, yawDeg: 90 }, heightM: 0.55, surfaceHeightM: 0.55 },
    { id: 'sofa-1', source: 'real', kind: 'sofa', label: 'Sofa',
      box: { cx: 3.55, cz: 3.5, w: 2.0, d: 0.9, yawDeg: 270 }, heightM: 0.85, surfaceHeightM: 0.42 },
  ];
}

// ---------------------------------------------------------------- the raw frame of the synthetic splat

/** R0 = Rx(180 deg) * Rz(3 deg), the Rz applied first. */
function r0(): Quat {
  const rx = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI);
  const rz = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, (TILT_DEG * Math.PI) / 180);
  return quatMul(rx, rz);
}

/** p_raw = R0 * p_true / 0.37 + o */
export function rawFromTruth(p: Vec3): Vec3 {
  const r = rotateY(r0(), p);
  return { x: r.x / SCALE + RAW_OFFSET.x, y: r.y / SCALE + RAW_OFFSET.y, z: r.z / SCALE + RAW_OFFSET.z };
}

// ---------------------------------------------------------------- property.json

export function buildTruthProperty(variant: 'empty' | 'furnished'): PropertyFile {
  const furnished = variant === 'furnished';
  const prop: PropertyFile = {
    version: 1,
    id: furnished ? 'test-flat' : 'test-flat-empty',
    title: furnished ? 'Test flat, 1 bedroom' : 'Test flat, 1 bedroom (empty)',
    subtitle: 'Synthetic scene with known sizes',
    layout: {
      wallHeightM: WALL_H,
      wallThicknessM: 0.12,
      railingHeightM: 1.1,
      rooms: rooms(),
      openings: openings(),
      finishes: { ...DEFAULT_FINISHES, tile: DEFAULT_FINISHES.tile ? { ...DEFAULT_FINISHES.tile } : null },
      scaleSource: 'plan-dimensions',
      // originPx is the pixel of world (0, 0), so the underlay lines up with these truth-frame polygons.
      // (SPEC 3.3's example shows the image centre here, which would offset the plan from the layout.)
      underlay: { file: 'plan.svg', pxPerM: PX_PER_M, originPx: pxOf(0, 0), dimensions: [], disagreementPct: 0 },
    },
    furniture: furnished ? furniture() : [],
    spawn: { ...SPAWN },
    updatedAt: '2026-11-12T00:00:00.000Z',
  };
  if (furnished) {
    const inv = quatInvert(r0());
    const o = rotateY(inv, RAW_OFFSET);
    prop.splat = {
      file: 'scene.ply',
      format: 'ply',
      upPreset: 'flip-x',
      mode: 'overlay',
      transform: {
        rotation: [inv[0], inv[1], inv[2], inv[3]],
        scale: SCALE,
        position: [-SCALE * o.x, -SCALE * o.y, -SCALE * o.z],
      },
    };
  }
  return prop;
}

// ---------------------------------------------------------------- independent oracle (hand-written rectangles)

interface Rect { x0: number; x1: number; z0: number; z1: number }
interface HRect extends Rect { h: number }

const ROOM_RECTS: Rect[] = [
  { x0: 0, x1: 4, z0: 0, z1: 5 },          // bedroom
  { x0: 0.5, x1: 3.5, z0: -1.62, z1: -0.12 }, // balcony
  { x0: 0, x1: 4, z0: 5.12, z1: 6.32 },    // passage
];

/**
 * Wall slabs as SPEC 4.1 builds them (heights in cm): rooms facing each other build 0.06 m each, outer walls
 * 0.12 m, railings 0.05 m, corners closed by the edge's own thickness. Window sill is 90.
 */
const BANDS: HRect[] = [
  // bedroom
  { x0: -0.06, x1: 4.06, z0: -0.06, z1: 0, h: 250 },
  { x0: 4, x1: 4.12, z0: -0.12, z1: 5.12, h: 250 },
  { x0: -0.06, x1: 4.06, z0: 5, z1: 5.06, h: 250 },
  { x0: -0.12, x1: 0, z0: -0.12, z1: 3.4, h: 250 },
  { x0: -0.12, x1: 0, z0: 3.4, z1: 4.6, h: 90 },   // window sill
  { x0: -0.12, x1: 0, z0: 4.6, z1: 5.12, h: 250 },
  // balcony
  { x0: 0.45, x1: 3.55, z0: -1.67, z1: -1.62, h: 110 },
  { x0: 3.5, x1: 3.55, z0: -1.67, z1: -0.07, h: 110 },
  { x0: 0.45, x1: 0.5, z0: -1.67, z1: -0.07, h: 110 },
  { x0: 0.44, x1: 3.56, z0: -0.12, z1: -0.06, h: 250 },
  // passage
  { x0: -0.06, x1: 4.06, z0: 5.06, z1: 5.12, h: 250 },
  { x0: 4, x1: 4.12, z0: 5.0, z1: 6.44, h: 250 },
  { x0: -0.12, x1: 4.12, z0: 6.32, z1: 6.44, h: 250 },
  { x0: -0.12, x1: 0, z0: 5.0, z1: 6.44, h: 250 },
];

/** Passable holes through the walls: -0.02 .. depth + 0.02 outward, as in SPEC 4.2 step 4. */
const CLEARS: Rect[] = [
  { x0: 0.4, x1: 1.3, z0: 4.98, z1: 5.14 },   // bedroom door
  { x0: 1.2, x1: 2.8, z0: -0.14, z1: 0.02 },  // sliding opening
  { x0: 3.98, x1: 4.14, z0: 5.27, z1: 6.17 }, // main door (leads nowhere)
];

function furnitureRects(variant: 'empty' | 'furnished'): HRect[] {
  if (variant === 'empty') return [];
  return [
    { x0: 0, x1: 2.0, z0: 1.5, z1: 3.0, h: 55 },   // bed
    { x0: 3.1, x1: 4.0, z0: 2.5, z1: 4.5, h: 85 }, // sofa
  ];
}

function inRect(x: number, z: number, r: Rect): boolean {
  return x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
}

function distToRectOutline(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
}

/** Cell value (0 free, 1..250 obstacle cm, 255 void) at a point, from the rectangles above. */
function truthValue(x: number, z: number, variant: 'empty' | 'furnished'): number {
  let v: number = GRID_VOID;
  for (const r of ROOM_RECTS) if (inRect(x, z, r)) v = GRID_FREE;
  let wall = 0;
  for (const b of BANDS) if (inRect(x, z, b)) wall = Math.max(wall, b.h);
  if (wall > 0) v = wall;
  for (const c of CLEARS) if (inRect(x, z, c)) v = GRID_FREE;
  for (const f of furnitureRects(variant)) if (inRect(x, z, f)) v = Math.min(250, Math.max(20, Math.round(f.h)));
  return v;
}

/** Independent oracle: hand-written rectangle logic, NOT a call to rasterizeLayout. */
export function truthGrid(variant: 'empty' | 'furnished'): Grid {
  // bounds: all room rectangles padded by 1.0 m, snapped outward to multiples of the cell size (as 4.2 step 1)
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of ROOM_RECTS) {
    minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
    minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
  }
  const eps = 1e-9;
  const ox = Math.floor((minX - 1) / GRID_CELL_M + eps) * GRID_CELL_M;
  const oz = Math.floor((minZ - 1) / GRID_CELL_M + eps) * GRID_CELL_M;
  const nx = Math.ceil((maxX + 1) / GRID_CELL_M - eps) - Math.round(ox / GRID_CELL_M);
  const nz = Math.ceil((maxZ + 1) / GRID_CELL_M - eps) - Math.round(oz / GRID_CELL_M);
  const grid = createGrid(ox, oz, nx, nz, GRID_VOID);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = cellCentre(grid, i, j);
      grid.cells[j * nx + i] = truthValue(c.x, c.z, variant);
    }
  }
  return grid;
}

/** 'edge' = within 0.10 m of any boundary; tests skip those samples. */
export function classifyTruth(x: number, z: number, variant: 'empty' | 'furnished'): 'free' | 'obstacle' | 'void' | 'edge' {
  const shapes: Rect[] = [...ROOM_RECTS, ...BANDS, ...CLEARS, ...furnitureRects(variant)];
  for (const s of shapes) if (distToRectOutline(x, z, s) < 0.1) return 'edge';
  const v = truthValue(x, z, variant);
  if (v === GRID_VOID) return 'void';
  return v === GRID_FREE ? 'free' : 'obstacle';
}

// ---------------------------------------------------------------- the synthetic splat fragment

const SIGMA_IN = 0.011;
const SIGMA_N = 0.002;
const ALPHA = 0.95;
const JITTER = 0.004;

type Cat = 'floor' | 'wall' | 'ceiling' | 'other';
interface Patch {
  o: Vec3; u: Vec3; v: Vec3; lenU: number; lenV: number; n: Vec3;
  rgb: [number, number, number]; step: number; cat: Cat;
  /** true = drop this lattice point (hole) */
  skip?: (p: Vec3) => boolean;
}

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Y: Vec3 = { x: 0, y: 1, z: 0 };
const Z: Vec3 = { x: 0, y: 0, z: 1 };
const nX: Vec3 = { x: -1, y: 0, z: 0 };
const nY: Vec3 = { x: 0, y: -1, z: 0 };
const nZ: Vec3 = { x: 0, y: 0, z: -1 };

const C_FLOOR: [number, number, number] = [0.72, 0.58, 0.42];
const C_BALC: [number, number, number] = [0.6, 0.6, 0.62];
const C_CEIL: [number, number, number] = [0.97, 0.97, 0.97];
const C_WALL: [number, number, number] = [0.92, 0.9, 0.86];
const C_RAIL: [number, number, number] = [0.2, 0.2, 0.22];
const C_BED: [number, number, number] = [0.25, 0.4, 0.7];
const C_SOFA: [number, number, number] = [0.3, 0.55, 0.4];

function wallPatches(): Patch[] {
  const door = (p: Vec3) => p.x >= 0.4 && p.x <= 1.3 && p.y < 2.1;
  const slider = (p: Vec3) => p.x >= 1.2 && p.x <= 2.8 && p.y < 2.2;
  const window_ = (p: Vec3) => p.z >= 3.4 && p.z <= 4.6 && p.y > 0.9 && p.y < 2.1;
  const wall = (o: Vec3, u: Vec3, lenU: number, n: Vec3, skip?: (p: Vec3) => boolean): Patch =>
    ({ o, u, v: Y, lenU, lenV: WALL_H, n, rgb: C_WALL, step: 0.025, cat: 'wall', skip });
  return [
    wall({ x: 0, y: 0, z: 0 }, Z, 5, X, window_),            // x = 0
    wall({ x: 4, y: 0, z: 0 }, Z, 5, nX),                    // x = 4
    wall({ x: 0, y: 0, z: 0 }, X, 4, Z, slider),             // z = 0
    wall({ x: 0, y: 0, z: 5 }, X, 4, nZ, door),              // z = 5
  ];
}

function surfacePatches(): Patch[] {
  const p: Patch[] = [];
  p.push({ o: { x: 0, y: 0, z: 0 }, u: X, v: Z, lenU: 4, lenV: 5, n: Y, rgb: C_FLOOR, step: 0.025, cat: 'floor' });
  p.push({ o: { x: 1.2, y: 0, z: -0.12 }, u: X, v: Z, lenU: 1.6, lenV: 0.12, n: Y, rgb: C_FLOOR, step: 0.025, cat: 'floor' });
  p.push({ o: { x: 0.5, y: 0, z: -1.62 }, u: X, v: Z, lenU: 3, lenV: 1.5, n: Y, rgb: C_BALC, step: 0.025, cat: 'floor' });
  p.push({ o: { x: 0, y: WALL_H, z: 0 }, u: X, v: Z, lenU: 4, lenV: 5, n: nY, rgb: C_CEIL, step: 0.035, cat: 'ceiling' });
  p.push(...wallPatches());
  const rail = (o: Vec3, u: Vec3, lenU: number, n: Vec3): Patch =>
    ({ o, u, v: Y, lenU, lenV: 1.1, n, rgb: C_RAIL, step: 0.025, cat: 'other' });
  p.push(rail({ x: 0.5, y: 0, z: -1.62 }, Z, 1.5, X));
  p.push(rail({ x: 3.5, y: 0, z: -1.62 }, Z, 1.5, nX));
  p.push(rail({ x: 0.5, y: 0, z: -1.62 }, X, 3, Z));
  // bed 150 x 200 x 55, x 0..2, z 1.5..3.0, head on x = 0
  const b = (o: Vec3, u: Vec3, v: Vec3, lenU: number, lenV: number, n: Vec3): Patch =>
    ({ o, u, v, lenU, lenV, n, rgb: C_BED, step: 0.025, cat: 'other' });
  p.push(b({ x: 0, y: 0.55, z: 1.5 }, X, Z, 2, 1.5, Y));
  p.push(b({ x: 2, y: 0, z: 1.5 }, Z, Y, 1.5, 0.55, X));
  p.push(b({ x: 0, y: 0, z: 1.5 }, X, Y, 2, 0.55, nZ));
  p.push(b({ x: 0, y: 0, z: 3 }, X, Y, 2, 0.55, Z));
  // sofa x 3.1..4.0, z 2.5..4.5, seat 0.42 (x to 3.75), back to 0.85, back on x = 4
  const s = (o: Vec3, u: Vec3, v: Vec3, lenU: number, lenV: number, n: Vec3): Patch =>
    ({ o, u, v, lenU, lenV, n, rgb: C_SOFA, step: 0.025, cat: 'other' });
  p.push(s({ x: 3.1, y: 0.42, z: 2.5 }, X, Z, 0.65, 2, Y));
  p.push(s({ x: 3.75, y: 0.85, z: 2.5 }, X, Z, 0.25, 2, Y));
  p.push(s({ x: 3.1, y: 0, z: 2.5 }, Z, Y, 2, 0.42, nX));
  p.push(s({ x: 3.75, y: 0.42, z: 2.5 }, Z, Y, 2, 0.43, nX));
  p.push(s({ x: 3.1, y: 0, z: 2.5 }, X, Y, 0.65, 0.42, nZ));
  p.push(s({ x: 3.75, y: 0, z: 2.5 }, X, Y, 0.25, 0.85, nZ));
  p.push(s({ x: 3.1, y: 0, z: 4.5 }, X, Y, 0.65, 0.42, Z));
  p.push(s({ x: 3.75, y: 0, z: 4.5 }, X, Y, 0.25, 0.85, Z));
  return p;
}

function lattice(len: number, step: number): number {
  return Math.max(1, Math.round(len / step));
}

export function buildSplatFragment(opts?: { degraded?: boolean; seed?: number }):
  { cloud: RawCloud; scales: Float32Array; rotations: Float32Array } {
  const degraded = opts?.degraded ?? false;
  const rng = mulberry32(opts?.seed ?? 1);
  const R0 = r0();
  const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

  interface P { p: Vec3; n: Vec3; rgb: [number, number, number]; alpha: number; sig: [number, number, number] }
  const pts: P[] = [];

  const inWallHole = (p: Vec3): boolean =>
    (Math.abs(p.x - 4) < 1e-6 && p.z >= 0.4 && p.z <= 1.6 && p.y >= 0.3 && p.y <= 2.3) ||
    (Math.abs(p.z - 5) < 1e-6 && p.x >= 2.0 && p.x <= 3.4 && p.y >= 0.2 && p.y <= 2.4);
  const FLOOR_HOLES = [{ x: 1.0, z: 0.8 }, { x: 2.8, z: 3.6 }, { x: 2.0, z: -0.8 }];
  const inFloorHole = (p: Vec3): boolean => FLOOR_HOLES.some((h) => Math.hypot(p.x - h.x, p.z - h.z) <= 0.35);

  for (const patch of surfacePatches()) {
    const nu = lattice(patch.lenU, patch.step);
    const nv = lattice(patch.lenV, patch.step);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = ((i + 0.5) * patch.lenU) / nu;
        const b = ((j + 0.5) * patch.lenV) / nv;
        const lat: Vec3 = {
          x: patch.o.x + patch.u.x * a + patch.v.x * b,
          y: patch.o.y + patch.u.y * a + patch.v.y * b,
          z: patch.o.z + patch.u.z * a + patch.v.z * b,
        };
        if (patch.skip?.(lat)) continue;
        const p: Vec3 = {
          x: lat.x + (rng() * 2 - 1) * JITTER,
          y: lat.y + (rng() * 2 - 1) * JITTER,
          z: lat.z + (rng() * 2 - 1) * JITTER,
        };
        if (degraded) {
          if (patch.cat === 'wall' && inWallHole(lat)) continue;
          if (patch.cat === 'floor' && inFloorHole(lat)) continue;
        }
        pts.push({ p, n: patch.n, rgb: patch.rgb, alpha: ALPHA, sig: [SIGMA_IN, SIGMA_IN, SIGMA_N] });
        if (degraded && (patch.cat === 'wall' || patch.cat === 'ceiling') && rng() < 0.3) {
          pts.push({
            p: { x: p.x, y: -p.y, z: p.z },
            n: { x: patch.n.x, y: -patch.n.y, z: patch.n.z },
            rgb: patch.rgb,
            alpha: 0.1 + rng() * 0.5,
            sig: [SIGMA_IN, SIGMA_IN, SIGMA_N],
          });
        }
      }
    }
  }

  if (degraded) {
    const floater = (n: number, aLo: number, aHi: number): void => {
      for (let k = 0; k < n; k++) {
        const g = 0.3 + rng() * 0.6;
        pts.push({
          p: { x: rng() * 4, y: rng() * WALL_H, z: rng() * 5 },
          n: Z_AXIS, rgb: [g, g, g], alpha: aLo + rng() * (aHi - aLo), sig: [0.02, 0.02, 0.02],
        });
      }
    };
    floater(400, 0.05, 0.25);
    floater(60, 0.5, 0.9);
  }

  const count = pts.length;
  const positions = new Float32Array(count * 3);
  const opacity = new Uint8Array(count);
  const rgb = new Uint8Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) {
    const s = pts[k];
    const raw = rawFromTruth(s.p);
    positions[k * 3] = raw.x; positions[k * 3 + 1] = raw.y; positions[k * 3 + 2] = raw.z;
    opacity[k] = Math.round(s.alpha * 255);
    for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round(s.rgb[c] * 255);
    // scales: linear sigma in raw units (encodePly takes the log)
    scales[k * 3] = s.sig[0] / SCALE; scales[k * 3 + 1] = s.sig[1] / SCALE; scales[k * 3 + 2] = s.sig[2] / SCALE;
    // rotation (w, x, y, z) = R0 o q_surface, q_surface turns local +Z onto the surface normal
    const q = quatMul(R0, quatFromUnitVectors(Z_AXIS, s.n));
    rotations[k * 4] = q[3]; rotations[k * 4 + 1] = q[0]; rotations[k * 4 + 2] = q[1]; rotations[k * 4 + 3] = q[2];
  }
  return { cloud: { count, positions, opacity, rgb }, scales, rotations };
}

// ---------------------------------------------------------------- PLY encoder (SPEC 6.4)

const SH_C0 = 0.28209479177387814;

export function encodePly(f: ReturnType<typeof buildSplatFragment>, opts?: { sh1?: boolean }): Uint8Array {
  const sh1 = opts?.sh1 ?? false;
  const { cloud, scales, rotations } = f;
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  if (sh1) for (let i = 0; i < 9; i++) props.push(`f_rest_${i}`);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  const header =
    'ply\nformat binary_little_endian 1.0\n' +
    `element vertex ${cloud.count}\n` +
    props.map((p) => `property float ${p}\n`).join('') +
    'end_header\n';
  const head = new TextEncoder().encode(header);
  const stride = props.length * 4;
  const out = new Uint8Array(head.length + stride * cloud.count);
  out.set(head, 0);
  const dv = new DataView(out.buffer);
  let off = head.length;
  const put = (v: number): void => { dv.setFloat32(off, v, true); off += 4; };
  for (let k = 0; k < cloud.count; k++) {
    put(cloud.positions[k * 3]); put(cloud.positions[k * 3 + 1]); put(cloud.positions[k * 3 + 2]);
    put(0); put(0); put(0);
    for (let c = 0; c < 3; c++) put((cloud.rgb[k * 3 + c] / 255 - 0.5) / SH_C0);
    if (sh1) for (let i = 0; i < 9; i++) put(0);
    const a = cloud.opacity[k] / 255;
    put(Math.log(a / (1 - a)));
    put(Math.log(scales[k * 3])); put(Math.log(scales[k * 3 + 1])); put(Math.log(scales[k * 3 + 2]));
    put(rotations[k * 4]); put(rotations[k * 4 + 1]); put(rotations[k * 4 + 2]); put(rotations[k * 4 + 3]);
  }
  return out;
}

// ---------------------------------------------------------------- the brochure floor plan

export interface PlanTruth {
  pxPerM: 53;
  dimensions: { a: Px; b: Px; label: string; lengthM: number }[];   // the two dimension lines; lengthM is the true value
  rooms: { id: string; label: string; roomType: RoomType; cornersPx: Px[]; areaM2: number }[];
  openings: { id: string; roomId: string; edge: number; type: OpeningType; centrePx: Px; widthM: number }[];
}

const PX_PER_M = 53 as const;
const PLAN_W = 364;
const PLAN_H = 571;

function pxOf(x: number, z: number): Px {
  return { x: 60 + (x + 0.3) * PX_PER_M, y: 60 + (z + 1.9) * PX_PER_M };
}

const f2 = (n: number): string => n.toFixed(2);

function svgRect(r: Rect, fill: string): string {
  const a = pxOf(r.x0, r.z0);
  const b = pxOf(r.x1, r.z1);
  return `<rect x="${f2(a.x)}" y="${f2(a.y)}" width="${f2(b.x - a.x)}" height="${f2(b.y - a.y)}" fill="${fill}"/>`;
}

function svgLine(a: Px, b: Px, extra: string): string {
  return `<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(b.x)}" y2="${f2(b.y)}" ${extra}/>`;
}

function sizeLabel(name: string, w: number, l: number): string {
  return `${name} ${formatFtIn(w)} x ${formatFtIn(l)}`;
}

export function buildPlan(): { svg: string; truth: PlanTruth } {
  const rs = rooms();
  const ops = openings();
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PLAN_W}" height="${PLAN_H}" viewBox="0 0 ${PLAN_W} ${PLAN_H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push('<title>Test flat floor plan, 1 bedroom</title>');
  out.push(`<rect width="${PLAN_W}" height="${PLAN_H}" fill="#ffffff"/>`);

  // walls: 0.12 m dark bands around every room
  const walls: Rect[] = [
    { x0: -0.12, x1: 4.12, z0: -0.12, z1: 0 },   // bedroom north
    { x0: 4, x1: 4.12, z0: 0, z1: 6.44 },        // east, bedroom and passage
    { x0: -0.12, x1: 0, z0: 0, z1: 6.44 },       // west, bedroom and passage
    { x0: 0, x1: 4, z0: 5, z1: 5.12 },           // bedroom / passage divider
    { x0: -0.12, x1: 4.12, z0: 6.32, z1: 6.44 }, // passage south
  ];
  out.push('<g id="walls">');
  for (const w of walls) out.push(svgRect(w, '#222222'));
  out.push('</g>');
  // gaps: bedroom door, sliding opening, main door, window
  out.push('<g id="openings">');
  out.push(svgRect({ x0: 0.4, x1: 1.3, z0: 5, z1: 5.12 }, '#ffffff'));
  out.push(svgRect({ x0: 1.2, x1: 2.8, z0: -0.12, z1: 0 }, '#ffffff'));
  out.push(svgRect({ x0: 4, x1: 4.12, z0: 5.27, z1: 6.17 }, '#ffffff'));
  out.push(svgRect({ x0: -0.12, x1: 0, z0: 3.4, z1: 4.6 }, '#ffffff'));
  // window: thin double line plus end ticks
  for (const x of [-0.09, -0.03]) out.push(svgLine(pxOf(x, 3.4), pxOf(x, 4.6), 'stroke="#222222" stroke-width="1"'));
  for (const z of [3.4, 4.6]) out.push(svgLine(pxOf(-0.12, z), pxOf(0, z), 'stroke="#222222" stroke-width="1"'));
  // door leaf for the bedroom door
  out.push(svgLine(pxOf(0.4, 5.12), pxOf(0.4, 5.9), 'stroke="#222222" stroke-width="1"'));
  out.push('</g>');
  // balcony railing, dashed
  const rail = [pxOf(0.5, -0.12), pxOf(0.5, -1.62), pxOf(3.5, -1.62), pxOf(3.5, -0.12)];
  out.push(`<polyline id="railing" points="${rail.map((p) => `${f2(p.x)},${f2(p.y)}`).join(' ')}" fill="none" stroke="#222222" stroke-width="2" stroke-dasharray="6 4"/>`);

  // room names with brochure-style dimensions
  const labels: { id: string; text: string; at: Px; name: string }[] = [
    { id: 'bedroom', text: sizeLabel('BEDROOM', 4, 5), at: pxOf(2, 2.5), name: 'Bedroom 1' },
    { id: 'balcony', text: sizeLabel('BALCONY', 3, 1.5), at: pxOf(2, -0.85), name: 'Balcony' },
    { id: 'passage', text: sizeLabel('PASSAGE', 4, 1.2), at: pxOf(2, 5.72), name: 'Passage' },
  ];
  out.push('<g id="labels" font-size="10" fill="#222222" text-anchor="middle">');
  for (const l of labels) {
    out.push(`<g id="label-${l.id}"><title>${l.name}</title><text x="${f2(l.at.x)}" y="${f2(l.at.y)}">${l.text}</text></g>`);
  }
  out.push('</g>');

  // two explicit dimension lines with end ticks
  const dimH = { a: pxOf(0, -2.3), b: pxOf(4, -2.3), label: formatFtIn(4), lengthM: 4 };
  const dimV = { a: pxOf(4.5, 0), b: pxOf(4.5, 5), label: formatFtIn(5), lengthM: 5 };
  out.push('<g id="dimensions" stroke="#555555" stroke-width="1" fill="#555555" font-size="10">');
  out.push(svgLine(dimH.a, dimH.b, ''));
  out.push(svgLine({ x: dimH.a.x, y: dimH.a.y - 5 }, { x: dimH.a.x, y: dimH.a.y + 5 }, ''));
  out.push(svgLine({ x: dimH.b.x, y: dimH.b.y - 5 }, { x: dimH.b.x, y: dimH.b.y + 5 }, ''));
  out.push(`<text x="${f2((dimH.a.x + dimH.b.x) / 2)}" y="${f2(dimH.a.y - 7)}" text-anchor="middle" stroke="none">${dimH.label}</text>`);
  out.push(svgLine(dimV.a, dimV.b, ''));
  out.push(svgLine({ x: dimV.a.x - 5, y: dimV.a.y }, { x: dimV.a.x + 5, y: dimV.a.y }, ''));
  out.push(svgLine({ x: dimV.b.x - 5, y: dimV.b.y }, { x: dimV.b.x + 5, y: dimV.b.y }, ''));
  out.push(`<text x="${f2(dimV.a.x + 8)}" y="${f2((dimV.a.y + dimV.b.y) / 2 + 3)}" text-anchor="start" stroke="none">${dimV.label}</text>`);
  out.push('</g>');
  out.push('</svg>');

  const truth: PlanTruth = {
    pxPerM: PX_PER_M,
    dimensions: [dimH, dimV].map((d) => ({ a: d.a, b: d.b, label: d.label, lengthM: d.lengthM })),
    rooms: rs.map((r) => ({
      id: r.id, label: r.label, roomType: r.roomType,
      cornersPx: r.polygon.map((p) => pxOf(p.x, p.z)),
      areaM2: polygonArea(r.polygon),
    })),
    openings: ops.map((o) => {
      const room = rs.find((r) => r.id === o.roomId)!;
      const a = room.polygon[o.edge];
      const b = room.polygon[(o.edge + 1) % room.polygon.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const c = { x: a.x + ((b.x - a.x) / len) * o.centreM, z: a.z + ((b.z - a.z) / len) * o.centreM };
      return { id: o.id, roomId: o.roomId, edge: o.edge, type: o.type, centrePx: pxOf(c.x, c.z), widthM: o.widthM };
    }),
  };
  return { svg: out.join('\n') + '\n', truth };
}

// ---------------------------------------------------------------- writing the scene folders

function truthJson(variant: 'empty' | 'furnished'): unknown {
  const prop = buildTruthProperty(variant);
  const areas = Object.fromEntries(prop.layout.rooms.map((r) => [r.id, polygonArea(r.polygon)]));
  return {
    description: 'Ground truth for the synthetic test flat. World frame in metres, Y up.',
    variant,
    scale: TRUTH.scale,
    tiltDeg: TRUTH.tiltDeg,
    rawOffset: TRUTH.rawOffset,
    wallHeightM: TRUTH.wallHeightM,
    doorJambs: TRUTH.doorJambs,
    landmarks: TRUTH.landmarks,
    roomAreasM2: areas,
    roomAreasSqFt: { bedroom: 215, balcony: 48, passage: 52 },
    carpetAreaM2: areas.bedroom + areas.passage,
    carpetAreaSqFt: 267,
    furniture: prop.furniture,
    spawn: prop.spawn,
  };
}

export function writeScenes(root: string): string[] {
  const written: string[] = [];
  const plan = buildPlan();
  for (const variant of ['empty', 'furnished'] as const) {
    const prop = buildTruthProperty(variant);
    const dir = path.join(root, 'public/scenes', prop.id);
    fs.mkdirSync(dir, { recursive: true });
    const w = (name: string, data: string | Uint8Array): void => {
      fs.writeFileSync(path.join(dir, name), data);
      written.push(path.join(prop.id, name));
    };
    w('property.json', JSON.stringify(prop, null, 2) + '\n');
    w('plan.svg', plan.svg);
    w('plan-truth.json', JSON.stringify(plan.truth, null, 2) + '\n');
    w('truth.json', JSON.stringify(truthJson(variant), null, 2) + '\n');
    if (variant === 'furnished') w('scene.ply', encodePly(buildSplatFragment()));
  }
  return written;
}

const isMain = process.argv[1] !== undefined &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of writeScenes(root)) {
    const size = fs.statSync(path.join(root, 'public/scenes', f)).size;
    console.log(`wrote public/scenes/${f} (${size} bytes)`);
  }
}
