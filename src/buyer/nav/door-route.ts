// Doors on a route. Pure: no DOM, no three. A route is planned on the grid without any shut leaf, so it may run through a shut door;
// these helpers find the first such door and the spot to stand on (outside the leaf's whole swing) to open it from.
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Vec2 } from '../../types';
import { inDoorSweep, leafObstacle } from '../../core/doors';
import type { Door } from '../../core/doors';
import { stampFurniture } from '../../core/layout-raster';

/** A leaf opened less than this fraction of its way still blocks the doorway: it is treated as shut and opened further. */
export const OPEN_ENOUGH = 0.5;
/** How far outside the leaf's swing the walker stands to open a door, metres (body radius and a little more). */
const STAND_CLEAR_M = CHARACTER_RADIUS_M + 0.12;
/** The most the standing spot backs off from the doorway, metres. */
const STAND_BACK_MAX_M = 3;

export interface LeafState { door: Door; pos: number }

export const isOpenEnough = (l: LeafState): boolean => l.pos >= l.door.maxPos * OPEN_ENOUGH - 1e-9;

/** The doorway's centre line, jamb to jamb, at the middle of the wall. */
export function doorway(d: Door): { a: Vec2; b: Vec2 } {
  const at = (u: number): Vec2 => ({ x: d.edgeA.x + d.dir.x * u + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * u + d.out.z * (d.depth / 2) });
  return { a: at(d.u0), b: at(d.u1) };
}

/** Where (0..1 along a -> b) the segment crosses the doorway's centre line, or null. */
export function crossesDoorway(d: Door, a: Vec2, b: Vec2): number | null {
  const w = doorway(d);
  const rx = b.x - a.x, rz = b.z - a.z;
  const sx = w.b.x - w.a.x, sz = w.b.z - w.a.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = w.a.x - a.x, qz = w.a.z - a.z;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  // a hair past each jamb counts: a route that clips the doorway's corner still goes through the door
  return t >= 0 && t <= 1 && u >= -0.05 && u <= 1.05 ? t : null;
}

export interface Crossing { door: Door; /** metres along the route to the doorway */ atM: number }

/** The first of the `shut` doors the route goes through, in walking order. */
export function firstCrossing(points: readonly Vec2[], shut: readonly Door[]): Crossing | null {
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let best: Crossing | null = null;
    for (const d of shut) {
      const t = crossesDoorway(d, a, b);
      if (t !== null && (!best || t * len < best.atM - walked)) best = { door: d, atM: walked + t * len };
    }
    if (best) return best;
    walked += len;
  }
  return null;
}

/** The point at `m` metres along the route (clamped). */
export function pointAlong(points: readonly Vec2[], m: number): Vec2 {
  let left = Math.max(0, m);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === points.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= len;
  }
  return points[0];
}

/** The route cut at `m` metres: the corners before it and the point itself last. */
export function cutRoute(points: readonly Vec2[], m: number): Vec2[] {
  const out: Vec2[] = [points[0]];
  let left = Math.max(0, m);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len + 1e-9) {
      const t = len > 0 ? left / len : 0;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      return out;
    }
    out.push(b);
    left -= len;
  }
  return out;
}

/**
 * How far along the route (metres) to stand to open the door at `crossAtM`: the nearest point back from the doorway that is outside the
 * leaf's whole swing, so the leaf never meets the body. 0 (the start) when the route begins inside the swing.
 */
export function standOffM(points: readonly Vec2[], crossAtM: number, door: Door): number {
  for (let back = 0; back <= STAND_BACK_MAX_M; back += 0.05) {
    const m = crossAtM - back;
    if (m <= 0) return 0;
    if (!inDoorSweep([door], pointAlong(points, m), STAND_CLEAR_M)) return m;
  }
  return Math.max(0, crossAtM - STAND_BACK_MAX_M);
}

/** `statics` (walls, furniture, people, no leaf) with the leaves that stand open enough stamped on it: the grid to plan routes on. */
export function planGridOf(statics: Grid, leaves: readonly LeafState[]): Grid {
  const open = leaves.filter(isOpenEnough);
  if (open.length === 0) return statics;
  return stampFurniture(statics, open.map((l, i) => {
    const o = leafObstacle(l.door, l.pos);
    return { id: `nav-leaf:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'door leaf', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM };
  }));
}
