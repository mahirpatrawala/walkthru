// Owned by C7. SPEC 4.11 `renderPlanImage`: the scan seen from straight above, for the plan canvas. Pure TypeScript (no canvas).
import type { LevelResult, RawCloud } from '../../types';
import { toLevelled } from './floor';

const MIN_BYTE = 77;
const MAX_SIDE = 4096;
const MAX_SAMPLE = 400_000;

function pct(sorted: Float32Array, p: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/** Opaque points of the levelled cloud, stride-sampled for statistics. */
function sampleStats(raw: RawCloud, lv: Float32Array): { x: Float32Array; y: Float32Array; z: Float32Array } {
  let kept = 0;
  for (let i = 0; i < raw.count; i++) if (raw.opacity[i] >= MIN_BYTE) kept++;
  const stride = Math.max(1, Math.ceil(kept / MAX_SAMPLE));
  const n = Math.ceil(kept / stride);
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  let m = 0, seen = 0;
  for (let i = 0; i < raw.count && m < n; i++) {
    if (raw.opacity[i] < MIN_BYTE) continue;
    if (seen++ % stride !== 0) continue;
    x[m] = lv[i * 3]; y[m] = lv[i * 3 + 1]; z[m] = lv[i * 3 + 2]; m++;
  }
  return { x: x.subarray(0, m).sort(), y: y.subarray(0, m).sort(), z: z.subarray(0, m).sort() };
}

export interface PlanBounds { x0: number; x1: number; z0: number; z1: number; top: number }

/**
 * Where the plan image sits in the levelled frame: the 0.5th to 99.5th percentile of x and z (so a few floaters do not
 * blow the image up) and the 99.5th percentile height. // SPEC-GAP: 4.11 gives no bounds rule; this is ours.
 */
export function planBounds(raw: RawCloud, level: LevelResult): PlanBounds {
  const s = sampleStats(raw, toLevelled(raw, level));
  return { x0: pct(s.x, 0.005), x1: pct(s.x, 0.995), z0: pct(s.z, 0.005), z1: pct(s.z, 0.995), top: pct(s.y, 0.995) };
}

/** A pixel density that makes the longer side about `targetPx` pixels. */
export function suggestPxPerUnit(raw: RawCloud, level: LevelResult, targetPx = 1200): number {
  const b = planBounds(raw, level);
  const span = Math.max(b.x1 - b.x0, b.z1 - b.z0, 1e-9);
  return targetPx / span;
}

/**
 * For each pixel keep the colour of the highest point whose height is between 2 % below and 75 % above the floor, as a share of the
 * cloud's height range (so ceilings and mirrored geometry are excluded and the floor still shows; SPEC-GAP in the code). Transparent where empty. +x is right, +z is down (a true
 * top-down view). Pixel (i, j) covers levelled x in [originX + i*u, originX + (i+1)*u) and z in [originZ + j*u, ...), u = unitsPerPx.
 * The image is capped at 4096 px on a side by lowering the density; `unitsPerPx` tells what was used.
 * `opts.footprint` (not in SPEC, default 0 = exactly as above) paints each point into a (2f+1) x (2f+1) pixel block, so a sparse scan
 * does not come out as dots; higher points still win a pixel. `opts.minOpacity` (fraction, default 0.3 = byte 77) can be lowered for
 * scans whose splats are mostly faint (the real Brush sample has only 5 % above 0.3).
 */
export function renderPlanImage(raw: RawCloud, level: LevelResult, pxPerUnit: number, opts?: { footprint?: number; minOpacity?: number }):
  { rgba: Uint8ClampedArray; width: number; height: number; originX: number; originZ: number; unitsPerPx: number } {
  const lv = toLevelled(raw, level);
  const s = sampleStats(raw, lv);
  const x0 = pct(s.x, 0.005), x1 = pct(s.x, 0.995), z0 = pct(s.z, 0.005), z1 = pct(s.z, 0.995);
  const top = Math.max(pct(s.y, 0.995), 1e-6);
  // SPEC-GAP: 4.11 says 2 % to 75 % of the height range ABOVE the floor, but then the floor itself (height 0, give or take its
  // thickness) is cut and "the floor still shows" cannot hold. The lower bound is therefore 2 % BELOW the floor; mirrored geometry
  // under a glossy floor sits further down and stays out.
  const hLo = -0.02 * top, hHi = 0.75 * top;
  let upp = 1 / Math.max(pxPerUnit, 1e-9);
  upp = Math.max(upp, (x1 - x0) / MAX_SIDE, (z1 - z0) / MAX_SIDE);
  const width = Math.max(1, Math.ceil((x1 - x0) / upp) + 1);
  const height = Math.max(1, Math.ceil((z1 - z0) / upp) + 1);
  const f = Math.max(0, Math.floor(opts?.footprint ?? 0));
  const minByte = Math.ceil((opts?.minOpacity ?? 0.3) * 255 - 1e-6);
  const best = new Float32Array(width * height).fill(-Infinity);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < raw.count; i++) {
    if (raw.opacity[i] < minByte) continue;
    const y = lv[i * 3 + 1];
    if (y < hLo || y > hHi) continue;
    const x = lv[i * 3], z = lv[i * 3 + 2];
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const px = Math.min(width - 1, Math.floor((x - x0) / upp));
    const pz = Math.min(height - 1, Math.floor((z - z0) / upp));
    for (let dz = -f; dz <= f; dz++) {
      const qz = pz + dz;
      if (qz < 0 || qz >= height) continue;
      for (let dx = -f; dx <= f; dx++) {
        const qx = px + dx;
        if (qx < 0 || qx >= width) continue;
        const k = qz * width + qx;
        if (y > best[k]) {
          best[k] = y;
          rgba[k * 4] = raw.rgb[i * 3];
          rgba[k * 4 + 1] = raw.rgb[i * 3 + 1];
          rgba[k * 4 + 2] = raw.rgb[i * 3 + 2];
          rgba[k * 4 + 3] = 255;
        }
      }
    }
  }
  return { rgba, width, height, originX: x0, originZ: z0, unitsPerPx: upp };
}
