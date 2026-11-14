// SPEC 16.14: the light-probe grid. Pure maths for the runtime and the pipeline: fill probes that sit in walls, mix the baked components
// into one SH per probe, interpolate trilinearly, evaluate the irradiance of a normal. L2 spherical harmonics, y-up, per colour channel.
import type { ProbeGrid } from './types';

export const SH_COEFFS = 9;
/** floats per probe for one component: 9 coefficients x rgb */
export const SH_FLOATS = SH_COEFFS * 3;

/** Real SH basis (y-up, same convention as the bake's projection) at a unit direction. */
export function shBasis(x: number, y: number, z: number, out: Float32Array | number[] = new Float32Array(SH_COEFFS)): Float32Array | number[] {
  out[0] = 0.282095;
  out[1] = 0.488603 * y; out[2] = 0.488603 * z; out[3] = 0.488603 * x;
  out[4] = 1.092548 * x * y; out[5] = 1.092548 * y * z; out[6] = 0.315392 * (3 * z * z - 1); out[7] = 1.092548 * x * z; out[8] = 0.546274 * (x * x - y * y);
  return out;
}

/** cosine-lobe convolution (irradiance from radiance SH): A0 = pi, A1 = 2pi/3, A2 = pi/4 */
export const SH_COSINE = [Math.PI, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];

/** Irradiance (three units, rgb) of surface normal n from a radiance SH (27 floats: coefficient-major, rgb inside). */
export function shIrradiance(sh: ArrayLike<number>, nx: number, ny: number, nz: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const b = shBasis(nx, ny, nz) as Float32Array;
  let r = 0, g = 0, bl = 0;
  for (let k = 0; k < SH_COEFFS; k++) {
    const w = b[k] * SH_COSINE[k];
    r += sh[k * 3] * w; g += sh[k * 3 + 1] * w; bl += sh[k * 3 + 2] * w;
  }
  out[0] = Math.max(0, r); out[1] = Math.max(0, g); out[2] = Math.max(0, bl);
  return out;
}

/**
 * Probes with `valid[i] === 0` (inside a wall, outside the flat) take the mean of their valid 6-neighbours, repeated until the grid is
 * full (at most `maxPasses`); what is still empty after that takes the mean of all valid probes. `stride` floats per probe. Mutates `data`.
 */
export function fillInvalidProbes(data: Float32Array, valid: Uint8Array, dims: [number, number, number], stride: number, maxPasses = 6): void {
  const [nx, ny, nz] = dims;
  const have = Uint8Array.from(valid);
  const idx = (x: number, y: number, z: number): number => (y * nz + z) * nx + x;
  for (let pass = 0; pass < maxPasses; pass++) {
    const fillNow: { i: number; v: Float32Array }[] = [];
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const i = idx(x, y, z);
      if (have[i]) continue;
      const acc = new Float32Array(stride);
      let n = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
        const j = idx(xx, yy, zz);
        if (!have[j]) continue;
        for (let k = 0; k < stride; k++) acc[k] += data[j * stride + k];
        n++;
      }
      if (n) { for (let k = 0; k < stride; k++) acc[k] /= n; fillNow.push({ i, v: acc }); }
    }
    if (!fillNow.length) break;
    for (const f of fillNow) { data.set(f.v, f.i * stride); have[f.i] = 1; }
  }
  let anyMissing = false;
  const mean = new Float32Array(stride);
  let count = 0;
  for (let i = 0; i < have.length; i++) { if (!have[i]) { anyMissing = true; continue; } for (let k = 0; k < stride; k++) mean[k] += data[i * stride + k]; count++; }
  if (anyMissing && count) {
    for (let k = 0; k < stride; k++) mean[k] /= count;
    for (let i = 0; i < have.length; i++) if (!have[i]) data.set(mean, i * stride);
  }
}

/** The grid, with one SH per probe for the current mix of components. */
export class ProbeVolume {
  readonly grid: ProbeGrid;
  /** probe-major, then component, then 27 floats */
  private raw: Float32Array;
  private mixed: Float32Array;
  private comps: number;

  constructor(grid: ProbeGrid, data: Float32Array) {
    this.grid = grid;
    this.comps = grid.components.length;
    const total = grid.dims[0] * grid.dims[1] * grid.dims[2];
    if (data.length !== total * this.comps * SH_FLOATS) throw new Error('probe data does not match the grid');
    this.raw = data;
    this.mixed = new Float32Array(total * SH_FLOATS);
  }

  get count(): number { return this.grid.dims[0] * this.grid.dims[1] * this.grid.dims[2]; }

  /** weights: per component, an rgb multiplier. Rebuilds the mixed SH of every probe (cheap: it only runs when the light changes). */
  setWeights(w: Partial<Record<string, [number, number, number]>>, fill: [number, number, number] = [0, 0, 0]): void {
    const n = this.count, C = this.comps;
    const wr = this.grid.components.map((c) => w[c] ?? [0, 0, 0]);
    const m = this.mixed;
    m.fill(0);
    // a uniform ambient irradiance E adds only to the constant (L0) term: radiance E / pi, c0 = (E / pi) * 4 pi * Y00 = E * 2 / sqrt(pi)
    const k0 = 2 / Math.sqrt(Math.PI);
    for (let p = 0; p < n; p++) { m[p * SH_FLOATS] = fill[0] * k0; m[p * SH_FLOATS + 1] = fill[1] * k0; m[p * SH_FLOATS + 2] = fill[2] * k0; }
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < C; c++) {
        const [r, g, b] = wr[c];
        if (r === 0 && g === 0 && b === 0) continue;
        const o = (p * C + c) * SH_FLOATS, d = p * SH_FLOATS;
        for (let k = 0; k < SH_COEFFS; k++) {
          m[d + k * 3] += this.raw[o + k * 3] * r;
          m[d + k * 3 + 1] += this.raw[o + k * 3 + 1] * g;
          m[d + k * 3 + 2] += this.raw[o + k * 3 + 2] * b;
        }
      }
    }
  }

  /** Trilinear SH (27 floats) at a world point; the point is clamped into the grid. */
  sample(x: number, y: number, z: number, out: Float32Array = new Float32Array(SH_FLOATS)): Float32Array {
    const { origin, spacing, dims } = this.grid;
    const fx = clamp01Idx((x - origin[0]) / spacing[0], dims[0]);
    const fy = clamp01Idx((y - origin[1]) / spacing[1], dims[1]);
    const fz = clamp01Idx((z - origin[2]) / spacing[2], dims[2]);
    const x0 = Math.min(dims[0] - 2 < 0 ? 0 : dims[0] - 2, Math.floor(fx)), y0 = Math.min(dims[1] - 2 < 0 ? 0 : dims[1] - 2, Math.floor(fy)), z0 = Math.min(dims[2] - 2 < 0 ? 0 : dims[2] - 2, Math.floor(fz));
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    out.fill(0);
    const nz = dims[2], nx = dims[0];
    for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (w === 0) continue;
      const xx = Math.min(dims[0] - 1, x0 + dx), yy = Math.min(dims[1] - 1, y0 + dy), zz = Math.min(dims[2] - 1, z0 + dz);
      const o = ((yy * nz + zz) * nx + xx) * SH_FLOATS;
      for (let k = 0; k < SH_FLOATS; k++) out[k] += this.mixed[o + k] * w;
    }
    return out;
  }
}

const clamp01Idx = (v: number, n: number): number => Math.min(n - 1, Math.max(0, v));
