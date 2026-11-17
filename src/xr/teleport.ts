// The pure parts of moving about in VR: the arc of the teleport ray, where it lands, whether the landing is walkable floor, the snap turn,
// and whether a door can be seen from where the pointer is. No three, no DOM: the walk grid and the layout come in as data (SPEC 4.2, 4.3).
//
// "Walkable" is exactly what the walker of the normal site may stand on: the collision grid cell is free for a body's radius, and the spot is in a
// room that is whole on the drawing. Nothing here is a new rule.
import { ARC_GRAVITY, ARC_MAX_S, ARC_SPEED, ARC_STEP_S, SNAP_PRESS, SNAP_RELEASE, SNAP_TURN_DEG } from './config';
import { CHARACTER_RADIUS_M, GRID_VOID } from '../types';
import type { Grid, Layout } from '../types';
import { cellValue } from '../core/grid-codec';
import { circleFree, nearestFree } from '../core/grid-query';
import { roomAt } from '../core/layout-geom';

export interface V3 { x: number; y: number; z: number }

/** Points of the ballistic arc: it leaves `origin` along the unit vector `dir` at `speed` and falls under `gravity`. Starts with the origin itself. */
export function arcPoints(origin: V3, dir: V3, opts: { speed?: number; gravity?: number; step?: number; maxT?: number } = {}): V3[] {
  const speed = opts.speed ?? ARC_SPEED, g = opts.gravity ?? ARC_GRAVITY, dt = opts.step ?? ARC_STEP_S, maxT = opts.maxT ?? ARC_MAX_S;
  const pts: V3[] = [];
  for (let t = 0; t <= maxT + 1e-9; t += dt) {
    pts.push({ x: origin.x + dir.x * speed * t, y: origin.y + dir.y * speed * t - 0.5 * g * t * t, z: origin.z + dir.z * speed * t });
  }
  return pts;
}

export type ArcEnd =
  /** reached the floor (y = 0) at `point` */
  | { kind: 'floor'; point: V3; points: V3[] }
  /** met something solid first (a wall, the top of a piece of furniture, the ceiling) at `point` */
  | { kind: 'blocked'; point: V3; points: V3[] }
  /** ran out of time in the air */
  | { kind: 'none'; point: V3; points: V3[] };

/** The grid's height at a point in metres: 0 for a free cell and for the void (a gap in the floor stops nothing in the air), the obstacle's height otherwise. */
export function obstacleHeightM(grid: Grid, x: number, z: number): number {
  const v = cellValue(grid, x, z);
  return v === GRID_VOID ? 0 : v / 100;
}

/**
 * Follows the arc through the walk grid. A sample is blocked when it is lower than the obstacle in its cell (walls are 2.5 m, a sofa 0.8 m: the arc
 * passes over low things and lands on the floor behind them, and is stopped by a wall), or higher than the ceiling. The first sample at or under the
 * floor ends it there. Finer than the arc's own step: a wall is 0.05 m thick.
 */
export function marchArc(grid: Grid, ceilingM: number, points: V3[], sampleM = 0.03): ArcEnd {
  let prev = points[0];
  const used: V3[] = [prev];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / sampleM));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      if (p.y <= 0) {
        // the crossing of the floor plane, on the segment from `prev`
        const q = prev.y > 0 ? prev.y / (prev.y - p.y) : 1;
        const hit = { x: prev.x + (p.x - prev.x) * q, y: 0, z: prev.z + (p.z - prev.z) * q };
        used.push(hit);
        return { kind: 'floor', point: hit, points: used };
      }
      if (p.y > ceilingM || p.y < obstacleHeightM(grid, p.x, p.z)) {
        // the piece of the arc up to the wall: the last free sample
        used.push(prev);
        return { kind: 'blocked', point: prev, points: used };
      }
      prev = p;
    }
    used.push(b);
  }
  return { kind: 'none', point: prev, points: used };
}

export type TeleportCheck = { ok: true; x: number; z: number; roomId: string } | { ok: false; reason: 'not-floor' | 'no-room' | 'partial-room' | 'blocked' };

/** How far a landing is moved to the nearest free spot when it is a hair inside a wall or a piece, metres. */
export const SNAP_LANDING_M = 0.3;

/**
 * May the viewer stand at (x, z)? The room there must be a whole room on the drawing, and a body's circle must be free on the walk grid. A landing
 * that touches a wall or a piece is moved to the nearest free spot within `SNAP_LANDING_M`, if that spot is in the same room.
 */
export function validateTeleport(grid: Grid, layout: Layout, p: { x: number; z: number }): TeleportCheck {
  const room = roomAt(layout, p);
  if (!room) return { ok: false, reason: 'no-room' };
  if (room.partial) return { ok: false, reason: 'partial-room' };
  if (circleFree(grid, p.x, p.z, CHARACTER_RADIUS_M)) return { ok: true, x: p.x, z: p.z, roomId: room.id };
  const q = nearestFree(grid, p.x, p.z, CHARACTER_RADIUS_M, SNAP_LANDING_M);
  if (q && roomAt(layout, q)?.id === room.id) return { ok: true, x: q.x, z: q.z, roomId: room.id };
  return { ok: false, reason: 'blocked' };
}

/** The whole aim: the arc, where it ends, and whether the viewer may go there. */
export interface Aim { end: ArcEnd; check: TeleportCheck | null }

export function aimTeleport(grid: Grid, layout: Layout, origin: V3, dir: V3, opts?: Parameters<typeof arcPoints>[2]): Aim {
  const end = marchArc(grid, layout.wallHeightM, arcPoints(origin, dir, opts));
  return { end, check: end.kind === 'floor' ? validateTeleport(grid, layout, end.point) : null };
}

/**
 * Whether a straight line on the floor plan from `a` to `b` is open: no cell on it is a tall obstacle, stopping `stopShortM` before `b` (so the leaf of
 * the door at `b`, which the grid stamps as an obstacle, does not hide itself). Used to decide that a door is in sight, not behind a wall.
 */
export function lineClear(grid: Grid, a: { x: number; z: number }, b: { x: number; z: number }, stopShortM = 0.2, tallCm = 170): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const end = len - stopShortM;
  for (let s = 0; s < end; s += grid.cellM / 2) {
    const f = s / len;
    const v = cellValue(grid, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f);
    if (v !== GRID_VOID && v >= tallCm) return false;
  }
  return true;
}

/**
 * The snap turn of the thumbstick. A flick past `SNAP_PRESS` turns once; the stick must come back under `SNAP_RELEASE` before it can turn again,
 * so holding it never spins the view. Returns -1 (turn left), 0 or +1 (turn right).
 */
export class SnapTurn {
  private armed = true;
  update(stickX: number): -1 | 0 | 1 {
    if (Math.abs(stickX) < SNAP_RELEASE) { this.armed = true; return 0; }
    if (this.armed && Math.abs(stickX) >= SNAP_PRESS) { this.armed = false; return stickX > 0 ? 1 : -1; }
    return 0;
  }
  reset(): void { this.armed = true; }
}

/** The change of the play space's yaw (radians) for a snap turn: turning the view right turns the home the other way about the viewer. */
export function snapDeltaYaw(dir: -1 | 0 | 1, deg = SNAP_TURN_DEG): number {
  return (-dir * deg * Math.PI) / 180;
}
