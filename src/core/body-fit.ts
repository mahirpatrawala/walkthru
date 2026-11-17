// Keeping the drawn body out of the walls (SPEC 4.12). Pure: no DOM, no three.
//
// The walk grid stops a 0.22 m circle. The body drawn on that spot is wider than the circle: the standing figure has one foot behind the
// other and its hands away from its hips, a walk swings the arms and leans the head forward, a jog more so. So the circle touching a wall
// meant a head, a hand or a shoe drawn through it. Widening the circle to the body would close the narrow doors of a real flat (0.62 m),
// so the circle stays and the body is fitted into the room it has: the engine holds the arms in and shifts the drawn body off the wall
// (src/engine/character.ts), and this file answers the two questions it asks.
//
// 1. Where may the body be? `sightField`: the cells the walker can see from the spot it stands on, at a few heights. A cell counts as room
//    for the body when nothing stands between it and the walker (a hand that has passed through a thin wall into the next room is in free
//    floor, but it is not in sight of the walker, so it is not room for the body). Low furniture only hides what is below its top: an arm
//    may hang over a bed, a shin may not stand in it.
// 2. How far must the body move? `solveBodyFit`: the smallest shift of a set of points (the body's skin) that puts every one of them inside
//    that region with a margin, and when two walls leave less room than the body needs, the shift that shares the shortfall between them.
import { GRID_FREE } from '../types';
import type { Grid } from '../types';

/**
 * How far the skin keeps from a blocked cell, metres. A cell is blocked when its CENTRE is in a wall, so the wall's real face can be up to
 * half a cell (2.5 cm) nearer than the cell's edge; the rest (2 cm) is the gap one sees, and covers what projects from a wall without being
 * in the grid (an architrave 8 mm, its bead 16 mm, a skirting).
 */
export const BODY_FIT_MARGIN_M = 0.06;
/** The drawn body never moves further than this from the spot the walker stands on. */
export const BODY_FIT_MAX_SHIFT_M = 0.3;
/** Heights (metres) the region is worked out at: a point of the body is checked against everything taller than the band it is in. */
export const BODY_BANDS_M = [0, 0.4, 0.8, 1.2] as const;

export const bandOf = (yM: number): number => (yM < BODY_BANDS_M[1] ? 0 : yM < BODY_BANDS_M[2] ? 1 : yM < BODY_BANDS_M[3] ? 2 : 3);

export interface SightField {
  /** the spot the walker stands on */
  cx: number; cz: number;
  cellM: number;
  /** world position of the window's corner cell (its low corner), and its size in cells */
  x0: number; z0: number; n: number;
  /** per band: 1 where the body may be (free at that height and in sight of the walker), else 0 */
  masks: Uint8Array[];
  /** true when nothing at all stands in the window: the body cannot touch anything */
  open: boolean;
  /** false when the walker's own spot is not free (inside something: nothing to fit to) */
  valid: boolean;
}

/** blocked for a body point in band `b`: void, a wall, or furniture taller than the band's floor */
const blocksBand = (v: number, b: number): boolean => v !== GRID_FREE && v > BODY_BANDS_M[b] * 100;

/**
 * The region in sight of (cx, cz) within `radiusM`, per height band. A cell is in sight when it is free at that height and the straight
 * line from the walker to its centre crosses no blocked cell (every cell the line passes through is looked at, so a one-cell strip such as
 * a door leaf cannot be seen through).
 */
export function sightField(grid: Grid, cx: number, cz: number, radiusM: number): SightField {
  const c = grid.cellM;
  const half = Math.ceil(radiusM / c) + 1;
  const ci = Math.floor((cx - grid.originX) / c), cj = Math.floor((cz - grid.originZ) / c);
  const i0 = ci - half, j0 = cj - half, n = 2 * half + 1;
  const local = new Uint8Array(n * n);
  let any = false, low = false;
  for (let j = 0; j < n; j++) {
    const gj = j0 + j;
    for (let i = 0; i < n; i++) {
      const gi = i0 + i;
      const v = gi < 0 || gj < 0 || gi >= grid.nx || gj >= grid.nz ? 255 : grid.cells[gj * grid.nx + gi];
      local[j * n + i] = v;
      if (v !== GRID_FREE) { any = true; if (v <= BODY_BANDS_M[3] * 100) low = true; }
    }
  }
  const field: SightField = { cx, cz, cellM: c, x0: grid.originX + i0 * c, z0: grid.originZ + j0 * c, n, masks: [], open: !any, valid: local[half * n + half] === GRID_FREE };
  if (!any || !field.valid) {
    const all = new Uint8Array(n * n).fill(1);
    field.masks = [all, all, all, all];
    return field;
  }
  // where the walker stands inside its own cell, in cells
  const fx = (cx - field.x0) / c, fz = (cz - field.z0) / c;
  for (let b = 0; b < BODY_BANDS_M.length; b++) {
    if (b > 0 && !low) { field.masks.push(field.masks[0]); continue; } // only walls here: every height sees the same
    const mask = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (blocksBand(local[j * n + i], b)) continue;
        mask[j * n + i] = lineClear(local, n, b, fx, fz, i + 0.5, j + 0.5) ? 1 : 0;
      }
    }
    field.masks.push(mask);
  }
  return field;
}

/** every cell the segment (ax, az) to (bx, bz) passes through is free at band `b` (cell units; a grid walk, not a sampling) */
function lineClear(local: Uint8Array, n: number, b: number, ax: number, az: number, bx: number, bz: number): boolean {
  let i = Math.floor(ax), j = Math.floor(az);
  const ti = Math.floor(bx), tj = Math.floor(bz);
  const dx = bx - ax, dz = bz - az;
  const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? i + 1 - ax : ax - i) * tdx : Infinity;
  let tz = dz !== 0 ? (dz > 0 ? j + 1 - az : az - j) * tdz : Infinity;
  for (let guard = 0; guard < 4 * n; guard++) {
    if (i === ti && j === tj) return true;
    if (tx < tz) { i += si; tx += tdx; } else { j += sj; tz += tdz; }
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    if (blocksBand(local[j * n + i], b)) return false;
  }
  return true;
}

const OUT = { nx: 0, nz: 0 };

/**
 * How far the point (x, z) in band `b` has to move to be `margin` inside the region, metres (0 when it already is), with the direction to
 * move in left in `out`. Inside the region it is the shortfall to the nearest cell outside it; outside, the distance to the nearest cell
 * inside it plus the margin. Both are exact distances to cell squares, so the answer changes smoothly as the point moves.
 */
export function sightPush(f: SightField, b: number, x: number, z: number, margin: number, out: { nx: number; nz: number } = OUT): number {
  const mask = f.masks[b];
  const n = f.n, c = f.cellM;
  const px = (x - f.x0) / c, pz = (z - f.z0) / c;
  const pi = Math.floor(px), pj = Math.floor(pz);
  const inside = pi >= 0 && pj >= 0 && pi < n && pj < n && mask[pj * n + pi] === 1;
  const m = margin / c;
  let best = Infinity, bx = 0, bz = 0;
  const reach = inside ? Math.ceil(m) : 2 * n;
  for (let k = 1; k <= reach; k++) {
    if (best <= k - 1) break; // every cell of ring k is at least k - 1 cells away
    for (let dj = -k; dj <= k; dj++) {
      const edge = dj === -k || dj === k;
      for (let di = -k; di <= k; di += edge ? 1 : 2 * k) {
        const i = pi + di, j = pj + dj;
        const off = i < 0 || j < 0 || i >= n || j >= n;
        const isIn = !off && mask[j * n + i] === 1;
        if (isIn === inside) continue;
        if (off && !inside) continue;
        // nearest point of that cell's square
        const qx = Math.min(i + 1, Math.max(i, px)), qz = Math.min(j + 1, Math.max(j, pz));
        const d = Math.hypot(qx - px, qz - pz);
        if (d < best) { best = d; bx = qx - px; bz = qz - pz; }
      }
    }
  }
  if (inside) {
    if (!(best < m)) return 0;
    if (best < 1e-9) { out.nx = 0; out.nz = 0; return 0; }
    out.nx = -bx / best; out.nz = -bz / best; // away from the nearest cell outside
    return (m - best) * c;
  }
  if (!isFinite(best)) {
    // nothing in sight anywhere near: head back to the walker's spot
    const dx = f.cx - x, dz = f.cz - z, d = Math.hypot(dx, dz) || 1;
    out.nx = dx / d; out.nz = dz / d;
    return d;
  }
  if (best < 1e-9) {
    const dx = f.cx - x, dz = f.cz - z, d = Math.hypot(dx, dz) || 1;
    out.nx = dx / d; out.nz = dz / d;
    return margin;
  }
  out.nx = bx / best; out.nz = bz / best;
  return (best + m) * c;
}

/** The deepest any of the points is past the margin with the body shifted by (ox, oz). `pts` holds x, z, band per point. */
export function fitResidual(f: SightField, pts: ArrayLike<number>, count: number, margin: number, ox: number, oz: number): number {
  let worst = 0;
  for (let k = 0; k < count; k++) {
    const d = sightPush(f, pts[3 * k + 2], pts[3 * k] + ox, pts[3 * k + 1] + oz, margin);
    if (d > worst) worst = d;
  }
  return worst;
}

export interface BodyFit { x: number; z: number; /** what is still past the margin after the shift, metres (0 = the body fits) */ residual: number }

/**
 * The shift (x, z) that fits the points into the region. Starts from (startX, startZ) (last frame's shift, eased towards none), and moves
 * only as far as the points require: a body that fits is left where it starts. Each round finds the deepest point and moves along the way it
 * has to go, and across it, by what the points on each side ask for; where both sides ask (a gap narrower than the body) it settles half way,
 * so neither wall gets all of it. The shift never exceeds `maxShift`.
 */
export function solveBodyFit(f: SightField, pts: ArrayLike<number>, count: number, margin = BODY_FIT_MARGIN_M, startX = 0, startZ = 0, maxShift = BODY_FIT_MAX_SHIFT_M): BodyFit {
  let ox = startX, oz = startZ;
  if (!f.valid || f.open) return { x: ox, z: oz, residual: 0 };
  const dir = { nx: 0, nz: 0 };
  let residual = 0;
  for (let round = 0; round < 6; round++) {
    // the deepest point sets the axis
    let deep = 0, ax = 0, az = 0;
    for (let k = 0; k < count; k++) {
      const d = sightPush(f, pts[3 * k + 2], pts[3 * k] + ox, pts[3 * k + 1] + oz, margin, dir);
      if (d > deep) { deep = d; ax = dir.nx; az = dir.nz; }
    }
    residual = deep;
    if (deep < 5e-4 || round === 5) break;
    // what is asked along the axis and against it, and across it both ways
    let a = 0, b = 0, p = 0, q = 0;
    for (let k = 0; k < count; k++) {
      const d = sightPush(f, pts[3 * k + 2], pts[3 * k] + ox, pts[3 * k + 1] + oz, margin, dir);
      if (d <= 0) continue;
      const along = d * (dir.nx * ax + dir.nz * az), across = d * (-dir.nx * az + dir.nz * ax);
      if (along > a) a = along; else if (-along > b) b = -along;
      if (across > p) p = across; else if (-across > q) q = -across;
    }
    const mAlong = a > 0 && b > 0 ? (a - b) / 2 : a - b;
    const mAcross = p > 0 && q > 0 ? (p - q) / 2 : p - q;
    if (Math.abs(mAlong) < 2e-4 && Math.abs(mAcross) < 2e-4) break; // squeezed: this is the middle
    ox += ax * mAlong - az * mAcross;
    oz += az * mAlong + ax * mAcross;
    const len = Math.hypot(ox, oz);
    if (len > maxShift) { ox *= maxShift / len; oz *= maxShift / len; }
  }
  return { x: ox, z: oz, residual };
}
