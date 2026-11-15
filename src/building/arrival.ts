// Where a walker lands after a portal: just inside the matching door, facing into the room, out of the leaf and the floor it sweeps.
// Pure: the grid is the scene's walk grid (walls and furniture; door leaves are not needed because the spot is chosen clear of them).
import { CHARACTER_RADIUS_M } from '../types';
import type { Grid, Layout, Vec2 } from '../types';
import { circleFree } from '../core/grid-query';
import { inDoorSweep, resolveDoors } from '../core/doors';
import { roomAt } from '../core/layout-geom';
import { yawToward } from '../core/spawn';
import { doorFrame } from './geom';

export interface Arrival { x: number; z: number; yawDeg: number; roomId: string }

/** How much free floor a landing spot wants round it (more than the body, so the first frame is not a wall in the face). */
export const ARRIVAL_CLEAR_M = 0.45;
/** The walker's margin from a door's leaf, at every angle the leaf can take. */
export const ARRIVAL_LEAF_CLEAR_M = CHARACTER_RADIUS_M + 0.05;

/**
 * The landing spot for the door opening `openingId` of `layout`, or null when the opening is not a door or no spot is clear.
 * It is searched along the line going into the room from the doorway's middle, nearest first, then a little to either side.
 */
export function arrivalAtDoor(layout: Layout, grid: Grid, openingId: string, fromM = 0.9): Arrival | null {
  const f = doorFrame(layout, openingId);
  if (!f) return null;
  const inward: Vec2 = { x: -f.out.x, z: -f.out.z };
  const doors = resolveDoors(layout);
  const room = layout.rooms.find((r) => r.id === f.roomId);
  if (!room) return null;
  for (let d = fromM; d <= 3.2 + 1e-9; d += 0.05) {
    for (const lat of [0, 0.15, -0.15, 0.3, -0.3]) {
      const p = { x: f.centre.x + inward.x * d + f.dir.x * lat, z: f.centre.z + inward.z * d + f.dir.z * lat };
      if (roomAt(layout, p)?.id !== room.id) continue;
      if (!circleFree(grid, p.x, p.z, ARRIVAL_CLEAR_M)) continue;
      if (doors.length && inDoorSweep(doors, p, ARRIVAL_LEAF_CLEAR_M)) continue;
      return { x: p.x, z: p.z, yawDeg: yawToward({ x: 0, z: 0 }, inward), roomId: room.id };
    }
  }
  return null;
}

/** Is each target reachable on foot from `from` on this grid (a 10 cm lattice, the body's radius clear)? Checks that a corridor reaches every door. */
export function reachable(grid: Grid, from: Vec2, targets: Vec2[], radius = CHARACTER_RADIUS_M): boolean[] {
  const step = 2;
  const key = (i: number, j: number): number => j * grid.nx + i;
  const ix0 = Math.floor((from.x - grid.originX) / grid.cellM), iz0 = Math.floor((from.z - grid.originZ) / grid.cellM);
  const seen = new Uint8Array(grid.nx * grid.nz);
  const free = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < grid.nx && j < grid.nz && circleFree(grid, grid.originX + (i + 0.5) * grid.cellM, grid.originZ + (j + 0.5) * grid.cellM, radius);
  if (!free(ix0, iz0)) return targets.map(() => false);
  const stack: number[] = [ix0, iz0];
  seen[key(ix0, iz0)] = 1;
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!;
    for (const [di, dj] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= grid.nx || b >= grid.nz || seen[key(a, b)] || !free(a, b)) continue;
      seen[key(a, b)] = 1;
      stack.push(a, b);
    }
  }
  return targets.map((t) => {
    const a = Math.round((t.x - grid.originX) / grid.cellM - 0.5), b = Math.round((t.z - grid.originZ) / grid.cellM - 0.5);
    for (let da = -step; da <= step; da++) for (let db = -step; db <= step; db++) if (a + da >= 0 && b + db >= 0 && a + da < grid.nx && b + db < grid.nz && seen[key(a + da, b + db)]) return true;
    return false;
  });
}
