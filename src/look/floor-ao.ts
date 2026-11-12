// Owned by C11a. SPEC 16.5 "Ambient occlusion that needs no ray tracing": a soft contact-shadow field from the collision grid.
// Pure: no three, no DOM. The material code uploads `data` as an R8 texture and samples it by world position.
import { GRID_VOID } from '../types';
import type { Grid } from '../types';

export interface AoField {
  nx: number; nz: number; cellM: number; originX: number; originZ: number;
  /** 0..1 per cell, row-major like the grid (index = j * nx + i), after the 3 x 3 blur */
  values: Float32Array;
  /** the same as 0..255 for an R8 texture */
  data: Uint8Array;
}

export const AO_MIN = 0.62;
export const AO_RANGE_M = 0.45;
/** obstacles lower than this (cm) do not occlude: a rug is not a wall */
export const AO_MIN_OBSTACLE_CM = 20;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Chamfer distance transform (3 x 3, weights 1 and sqrt 2): distance in cells to the nearest `blocked` cell. */
export function distanceCells(blocked: Uint8Array, nx: number, nz: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(nx * nz);
  for (let k = 0; k < d.length; k++) d[k] = blocked[k] ? 0 : INF;
  const S = Math.SQRT2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - nx] + 1);
        if (i > 0) v = Math.min(v, d[k - nx - 1] + S);
        if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + S);
      }
      d[k] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < nz - 1) {
        v = Math.min(v, d[k + nx] + 1);
        if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + S);
        if (i > 0) v = Math.min(v, d[k + nx - 1] + S);
      }
      d[k] = v;
    }
  }
  return d;
}

/**
 * `ao = 0.62 + 0.38 * smoothstep(0, 0.45 m, distance)`, distance measured from the face of the nearest blocked cell
 * (walls, void and obstacles of at least `minObstacleCm`), then a 3 x 3 box blur.
 */
export function buildAoField(grid: Grid, opts: { minObstacleCm?: number } = {}): AoField {
  const { nx, nz, cellM } = grid;
  const minCm = opts.minObstacleCm ?? AO_MIN_OBSTACLE_CM;
  const blocked = new Uint8Array(nx * nz);
  for (let k = 0; k < blocked.length; k++) {
    const v = grid.cells[k];
    blocked[k] = v === GRID_VOID || v >= minCm ? 1 : 0;
  }
  const dist = distanceCells(blocked, nx, nz);
  const raw = new Float32Array(nx * nz);
  for (let k = 0; k < raw.length; k++) {
    if (blocked[k]) { raw[k] = AO_MIN; continue; }
    const m = Math.max(0, dist[k] - 0.5) * cellM;
    raw[k] = AO_MIN + (1 - AO_MIN) * smoothstep(0, AO_RANGE_M, m);
  }
  const values = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nz) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          s += raw[jj * nx + ii]; n++;
        }
      }
      values[j * nx + i] = s / n;
    }
  }
  const data = new Uint8Array(nx * nz);
  for (let k = 0; k < data.length; k++) data[k] = Math.round(values[k] * 255);
  return { nx, nz, cellM, originX: grid.originX, originZ: grid.originZ, values, data };
}

/** Bilinear AO at a world position (cell centres are the sample points). 1 outside the field. */
export function aoAt(f: AoField, x: number, z: number): number {
  const fx = (x - f.originX) / f.cellM - 0.5;
  const fz = (z - f.originZ) / f.cellM - 0.5;
  if (fx < -1 || fz < -1 || fx > f.nx || fz > f.nz) return 1;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const at = (i: number, j: number): number => f.values[Math.min(f.nz - 1, Math.max(0, j)) * f.nx + Math.min(f.nx - 1, Math.max(0, i))];
  return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
}
