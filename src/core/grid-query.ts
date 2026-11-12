// Grid queries (SPEC 4.3). Pure: no DOM, no three.
import { GRID_FREE, GRID_TALL_CM } from '../types';
import type { Grid, Vec2, Vec3 } from '../types';
import { cellValue } from './grid-codec';

/** Longest single step moveCircle takes, metres. */
const MOVE_STEP_M = 0.04;
/** Sample spacing of `clearance`, metres. */
const CLEARANCE_STEP_M = 0.025;
/** Sample spacing of `boomDistance`, metres. */
const BOOM_STEP_M = 0.04;
/** The camera boom stops this far short of the first blocking cell (2.4). */
const BOOM_STOP_M = 0.2;

/** True when every cell whose centre is within `r` of (x, z) is GRID_FREE. Cells outside the grid are void. */
export function circleFree(grid: Grid, x: number, z: number, r: number): boolean {
  const c = grid.cellM;
  const i0 = Math.floor((x - r - grid.originX) / c) - 1;
  const i1 = Math.floor((x + r - grid.originX) / c) + 1;
  const j0 = Math.floor((z - r - grid.originZ) / c) - 1;
  const j1 = Math.floor((z + r - grid.originZ) / c) + 1;
  const r2 = r * r;
  for (let j = j0; j <= j1; j++) {
    const cz = grid.originZ + (j + 0.5) * c;
    const dz = cz - z;
    for (let i = i0; i <= i1; i++) {
      const cx = grid.originX + (i + 0.5) * c;
      const dx = cx - x;
      if (dx * dx + dz * dz > r2) continue;
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return false;
      if (grid.cells[j * grid.nx + i] !== GRID_FREE) return false;
    }
  }
  return true;
}

/**
 * Moves a circle of radius `r` by `delta` in sub-steps of at most 0.04 m. Per sub-step it tries the full step,
 * then the x part alone, then the z part alone, and stops when none is free. This gives wall sliding.
 */
export function moveCircle(grid: Grid, from: Vec2, delta: Vec2, r: number): Vec2 {
  const len = Math.hypot(delta.x, delta.z);
  let x = from.x;
  let z = from.z;
  if (len === 0) return { x, z };
  const n = Math.max(1, Math.ceil(len / MOVE_STEP_M));
  const sx = delta.x / n;
  const sz = delta.z / n;
  for (let k = 0; k < n; k++) {
    if (circleFree(grid, x + sx, z + sz, r)) {
      x += sx;
      z += sz;
    } else if (sx !== 0 && circleFree(grid, x + sx, z, r)) {
      x += sx;
    } else if (sz !== 0 && circleFree(grid, x, z + sz, r)) {
      z += sz;
    } else {
      break;
    }
  }
  return { x, z };
}

/**
 * Nearest point to (x, z) where a circle of radius `r` is free, searched on the cell lattice around (x, z)
 * in rings of one cell, within `maxM` (default 3). Null when there is none.
 */
export function nearestFree(grid: Grid, x: number, z: number, r: number, maxM = 3): Vec2 | null {
  if (circleFree(grid, x, z, r)) return { x, z };
  const c = grid.cellM;
  const maxRing = Math.ceil(maxM / c);
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let k = 1; k <= maxRing; k++) {
    // every point of ring k is at least k * c away (Chebyshev), so once we have a hit closer than that we are done
    if (best && bestD <= k * c) break;
    for (let dj = -k; dj <= k; dj++) {
      const edge = dj === -k || dj === k;
      const step = edge ? 1 : 2 * k;
      for (let di = -k; di <= k; di += step) {
        const px = x + di * c;
        const pz = z + dj * c;
        const d = Math.hypot(di * c, dj * c);
        if (d > maxM || d >= bestD) continue;
        if (circleFree(grid, px, pz, r)) {
          best = { x: px, z: pz };
          bestD = d;
        }
      }
    }
  }
  return best;
}

/**
 * Distance from `origin` along `dir` (unit) to the first cell that is not GRID_FREE, `maxM` (default 3) when there
 * is none. Samples every 0.025 m; the boundary between the last free sample and the first blocked one is then
 * refined by bisection (to about 0.1 mm) so the answer is the true distance, not a multiple of the step.
 * Returns 0 when the origin itself is not free.
 */
export function clearance(grid: Grid, origin: Vec2, dir: Vec2, maxM = 3): number {
  if (cellValue(grid, origin.x, origin.z) !== GRID_FREE) return 0;
  let prev = 0;
  for (let t = CLEARANCE_STEP_M; ; t += CLEARANCE_STEP_M) {
    const tt = Math.min(t, maxM);
    if (cellValue(grid, origin.x + dir.x * tt, origin.z + dir.z * tt) !== GRID_FREE) {
      let lo = prev;
      let hi = tt;
      for (let it = 0; it < 10; it++) {
        const mid = (lo + hi) / 2;
        if (cellValue(grid, origin.x + dir.x * mid, origin.z + dir.z * mid) !== GRID_FREE) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    if (tt >= maxM) return maxM;
    prev = tt;
  }
}

/**
 * How far a camera boom can extend from `pivot` along unit `dir` (SPEC 4.3 and 2.4). Marches in 0.04 m steps.
 * A sample blocks when its cell value v is in [GRID_TALL_CM, 250]; or 0 < v < GRID_TALL_CM and the sample is
 * lower than v/100 + 0.15; or the sample is above ceilingM - 0.15 or below 0.15. Void never blocks.
 * Returns max(0, hitDistance - 0.20), or `maxDist` when nothing blocks.
 */
export function boomDistance(
  grid: Grid, pivot: Vec3, dir: Vec3, maxDist: number, ceilingM: number, ignoreLow = false,
): number {
  // ignoreLow (integrator addition): low furniture (beds, sofas, sills) never blocks. Used while the camera is
  // focused on a piece of furniture, where the pivot sits on that furniture's own surface.
  const top = ceilingM - 0.15;
  for (let t = BOOM_STEP_M; t <= maxDist + 1e-9; t += BOOM_STEP_M) {
    const x = pivot.x + dir.x * t;
    const y = pivot.y + dir.y * t;
    const z = pivot.z + dir.z * t;
    let blocked = y > top || y < 0.15;
    if (!blocked) {
      const v = cellValue(grid, x, z);
      if (v >= GRID_TALL_CM && v <= 250) blocked = true;
      else if (!ignoreLow && v > 0 && v < GRID_TALL_CM && y < v / 100 + 0.15) blocked = true;
    }
    if (blocked) return Math.max(0, t - BOOM_STOP_M);
  }
  return maxDist;
}
