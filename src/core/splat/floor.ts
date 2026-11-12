// Owned by C7. SPEC 4.11: find the floor of a splat, level it, and find the ceiling. Pure TypeScript, no DOM.
import type { LevelResult, Quat, RawCloud, SceneTransform, UpPreset, Vec3 } from '../../types';
import { quatFromUnitVectors, quatInvert, quatMul, rotateY } from '../geometry';

export const PRESET_QUAT: Record<UpPreset, Quat> = {
  'as-is': [0, 0, 0, 1],
  'flip-x': [1, 0, 0, 0],
  'z-up': [-0.70710678, 0, 0, 0.70710678],
};

const MAX_POINTS = 400_000;
const BINS = 512;
const LOW_CONFIDENCE_BELOW = 3;
const MAX_TILT_DEG = 30; // integrator: real WhatsApp scans come out ~21° tilted; was 15

/** Row-major 3x3 from a unit quaternion [x, y, z, w]. */
export function matFromQuat(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function percentile(sortedAsc: Float32Array, p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function boxSmooth5(a: Float64Array): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) s += a[j]; }
    out[i] = s / 5;
  }
  return out;
}

/** Median of all bins; when that is zero (a mostly empty histogram) the mean of the non-empty bins. */
function medianBin(a: Float64Array): number {
  const s = Float64Array.from(a).sort();
  const med = (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2;
  if (med > 0) return med;
  let sum = 0, cnt = 0;
  for (const v of a) if (v > 0) { sum += v; cnt++; }
  return cnt > 0 ? sum / cnt : 1;
}

interface Hist { lo: number; bw: number; raw: Float64Array; smooth: Float64Array }

function histogram(ys: Float32Array, ws: Float32Array): Hist {
  const sorted = Float32Array.from(ys).sort();
  const lo = percentile(sorted, 0.005);
  const hi = percentile(sorted, 0.995);
  const span = Math.max(hi - lo, 1e-9);
  const bw = span / BINS;
  const raw = new Float64Array(BINS);
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (y < lo || y > hi) continue;
    let b = Math.floor((y - lo) / bw);
    if (b >= BINS) b = BINS - 1;
    raw[b] += ws[i];
  }
  return { lo, bw, raw, smooth: boxSmooth5(raw) };
}

/** Heaviest local maximum of `smooth` among bins [from, to). A plateau counts at its first bin. */
function heaviestPeak(smooth: Float64Array, from: number, to: number): number {
  let best = -1;
  for (let i = from; i < to; i++) {
    const l = i > 0 ? smooth[i - 1] : -Infinity;
    const r = i + 1 < smooth.length ? smooth[i + 1] : -Infinity;
    if (smooth[i] > l && smooth[i] >= r && (best < 0 || smooth[i] > smooth[best])) best = i;
  }
  return best;
}

/** Smallest-eigenvalue eigenvector of a symmetric 3x3 (cyclic Jacobi). */
function smallestEigenvector(c: number[]): [number, number, number] {
  const a = c.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 30; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = cs * akp - sn * akq;
        a[k * 3 + q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = cs * apk - sn * aqk;
        a[q * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = cs * vkp - sn * vkq;
        v[k * 3 + q] = sn * vkp + cs * vkq;
      }
    }
  }
  let m = 0;
  if (a[4] < a[0]) m = 1;
  if (a[8] < a[m * 3 + m]) m = 2;
  return [v[m], v[3 + m], v[6 + m]];
}

interface Plane { n: [number, number, number]; c: [number, number, number] }

function fitPlane(xyz: number[], idx: number[]): Plane | null {
  const m = idx.length;
  if (m < 3) return null;
  let sx = 0, sy = 0, sz = 0;
  for (const i of idx) { sx += xyz[i * 3]; sy += xyz[i * 3 + 1]; sz += xyz[i * 3 + 2]; }
  const cx = sx / m, cy = sy / m, cz = sz / m;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const i of idx) {
    const dx = xyz[i * 3] - cx, dy = xyz[i * 3 + 1] - cy, dz = xyz[i * 3 + 2] - cz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }
  let n = smallestEigenvector([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
  return { n, c: [cx, cy, cz] };
}

function noFloor(preset: UpPreset): LevelResult {
  return { rotation: PRESET_QUAT[preset], floorOffsetRaw: 0, ceilingRaw: null, tiltDeg: 0, confidence: 0, lowConfidence: true };
}

/**
 * SPEC-GAP: the tilt search. 4.11 step 4 fits a plane (PCA) to the points within 2 bins of the 1-D peak. On a tilted floor those
 * points are a thin horizontal slab: it holds a strip of floor but also every wall point at that height, and the walls span far
 * more in x and z than the strip does, so the fit comes out nearly flat (measured on the synthetic flat: 0.2 degrees for a true 3).
 * Fix: before step 3, search the tilt (both axes, up to MAX_SEARCH_DEG) that makes the floor peak sharpest, coarse to fine, then
 * run 4.11 steps 3 and 4 in that frame, where the slab really is the floor.
 */
const MAX_SEARCH_DEG = 30;

interface Pts { x: Float32Array; y: Float32Array; z: Float32Array; w: Float32Array }

function subsample(p: Pts, n: number): Pts {
  const m = p.y.length;
  if (m <= n) return p;
  const stride = m / n;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), w = new Float32Array(n);
  for (let k = 0; k < n; k++) { const i = Math.floor(k * stride); x[k] = p.x[i]; y[k] = p.y[i]; z[k] = p.z[i]; w[k] = p.w[i]; }
  return { x, y, z, w };
}

let scratch = new Float32Array(0);

/** How sharp the floor peak is for the plane normal (-a, 1, -b)/|.|: the heaviest smoothed bin in the lower 70 % of the range. */
function sharpness(p: Pts, a: number, b: number, bw: number): number {
  const n = p.y.length;
  const inv = 1 / Math.sqrt(1 + a * a + b * b);
  if (scratch.length < n) scratch = new Float32Array(n);
  const h = scratch;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = (p.y[i] - a * p.x[i] - b * p.z[i]) * inv;
    h[i] = v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const nb = Math.min(4096, Math.max(8, Math.floor((mx - mn) / bw) + 1));
  const bwe = Math.max(bw, (mx - mn) / nb + 1e-12);
  const hist = new Float64Array(nb);
  let total = 0;
  for (let i = 0; i < n; i++) { hist[Math.min(nb - 1, Math.floor((h[i] - mn) / bwe))] += p.w[i]; total += p.w[i]; }
  let cum = 0, lo = 0, hi = nb - 1, gotLo = false;
  for (let i = 0; i < nb; i++) {
    cum += hist[i];
    if (!gotLo && cum >= 0.005 * total) { lo = i; gotLo = true; }
    if (cum >= 0.995 * total) { hi = i; break; }
  }
  const cut = lo + Math.floor(0.7 * (hi - lo));
  let best = 0;
  for (let i = lo; i <= cut; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < nb) s += hist[j]; }
    if (s > best) best = s;
  }
  return best;
}

function searchTilt(all: Pts, bw: number, maxDeg: number): { a: number; b: number } {
  const maxSlope = Math.tan((maxDeg * Math.PI) / 180);
  let best = { a: 0, b: 0, s: -1 };
  const scan = (pts: Pts, a0: number, b0: number, half: number, step: number): void => {
    const k = Math.round(half / step);
    for (let i = -k; i <= k; i++) {
      for (let j = -k; j <= k; j++) {
        const a = a0 + i * step, b = b0 + j * step;
        if (Math.hypot(a, b) > maxSlope) continue;
        const s = sharpness(pts, a, b, bw);
        if (s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && Math.hypot(a, b) < Math.hypot(best.a, best.b))) best = { a, b, s };
      }
    }
  };
  const t1 = Math.tan(Math.PI / 180);
  scan(subsample(all, 20_000), 0, 0, maxSlope, 1.25 * t1);
  scan(subsample(all, 60_000), best.a, best.b, 1.5 * t1, 0.3 * t1);
  scan(subsample(all, 150_000), best.a, best.b, 0.4 * t1, 0.1 * t1);
  return { a: best.a, b: best.b };
}

/**
 * SPEC 4.11 `levelSplat`. Steps 1 to 5 as written, with these choices where the text is silent or fails:
 * - `minOpacity` is a fraction (0.3 = byte 77).
 * - The tilt search above runs between steps 2 and 3, so the histogram of step 3 and the fit of step 4 see an aligned floor.
 *   Step 2/3 on the plain preset frame is still computed: it is the "un-tilted peak" kept when the tilt is over 15 degrees.
 * - `confidence` is read from the histogram of the aligned frame (a tilted floor smears the plain one).
 * - The ceiling is searched in a second histogram of the final levelled points, with the floor's weight read from that same
 *   histogram; `ceilingRaw` is the weighted centre of the peak, not just its first bin.
 * - `opts.maxTiltDeg` (not in SPEC, default 30) is the tilt above which the plane is refused. The editor raises it when the broker
 *   chooses "use the detected floor anyway": real COLMAP output is levelled to the first camera, which can be pitched 20 degrees.
 * - When the tilt is over `maxTiltDeg` (30 by default): `rotation` is the preset alone, `floorOffsetRaw` the un-tilted peak height, `tiltDeg` the
 *   over-15 angle that was found, `ceilingRaw` null, and `lowConfidence` true.
 */
export function levelSplat(raw: RawCloud, preset: UpPreset, opts?: { minOpacity?: number; maxTiltDeg?: number }): LevelResult {
  const minByte = Math.ceil((opts?.minOpacity ?? 0.3) * 255 - 1e-6);
  const qp = PRESET_QUAT[preset];
  const mp = matFromQuat(qp);
  const maxTilt = opts?.maxTiltDeg ?? MAX_TILT_DEG;

  // 1. preset rotation, opacity filter, stride subsample
  let kept = 0;
  for (let i = 0; i < raw.count; i++) if (raw.opacity[i] >= minByte) kept++;
  if (kept < 10) return noFloor(preset);
  const stride = Math.max(1, Math.ceil(kept / MAX_POINTS));
  const cap = Math.ceil(kept / stride);
  const all: Pts = { x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), w: new Float32Array(cap) };
  let m = 0, seen = 0;
  for (let i = 0; i < raw.count; i++) {
    if (raw.opacity[i] < minByte) continue;
    if (seen++ % stride !== 0) continue;
    const x = raw.positions[i * 3], y = raw.positions[i * 3 + 1], z = raw.positions[i * 3 + 2];
    all.x[m] = mp[0] * x + mp[1] * y + mp[2] * z;
    all.y[m] = mp[3] * x + mp[4] * y + mp[5] * z;
    all.z[m] = mp[6] * x + mp[7] * y + mp[8] * z;
    all.w[m] = raw.opacity[i] / 255;
    m++;
  }

  // 2. and 3. on the plain preset frame: this gives the un-tilted peak (the fallback) and the bin width for the tilt search
  const H0 = histogram(all.y, all.w);
  const lowerEnd = Math.floor(BINS * 0.7);
  let peak0 = heaviestPeak(H0.smooth, 0, lowerEnd);
  if (peak0 < 0) peak0 = H0.smooth.indexOf(Math.max(...H0.smooth));
  const untiltedPeakY = H0.lo + (peak0 + 0.5) * H0.bw;

  // tilt search, then rotate the points into the aligned frame
  const tilt0 = searchTilt(all, H0.bw, Math.max(MAX_SEARCH_DEG, (opts?.maxTiltDeg ?? MAX_TILT_DEG) + 5));
  const n0 = (() => { const l = Math.sqrt(1 + tilt0.a * tilt0.a + tilt0.b * tilt0.b); return { x: -tilt0.a / l, y: 1 / l, z: -tilt0.b / l }; })();
  const q0 = quatFromUnitVectors(n0, { x: 0, y: 1, z: 0 });
  const m0 = matFromQuat(q0);
  const xyz: number[] = new Array(m * 3);
  const ys = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = all.x[i], y = all.y[i], z = all.z[i];
    xyz[i * 3] = m0[0] * x + m0[1] * y + m0[2] * z;
    const ny = m0[3] * x + m0[4] * y + m0[5] * z;
    xyz[i * 3 + 1] = ny;
    xyz[i * 3 + 2] = m0[6] * x + m0[7] * y + m0[8] * z;
    ys[i] = ny;
  }
  const H = histogram(ys, all.w);
  let peak = heaviestPeak(H.smooth, 0, lowerEnd);
  if (peak < 0) peak = H.smooth.indexOf(Math.max(...H.smooth));
  const confidence = H.smooth[peak] / medianBin(H.smooth);

  // 4. plane fit through the points within 2 bins of the peak, three rounds of 2-sigma clipping
  const yLo = H.lo + (peak - 2) * H.bw;
  const yHi = H.lo + (peak + 3) * H.bw;
  let idx: number[] = [];
  for (let i = 0; i < m; i++) if (ys[i] >= yLo && ys[i] < yHi) idx.push(i);
  let plane = fitPlane(xyz, idx);
  for (let round = 0; round < 3 && plane; round++) {
    const { n, c } = plane;
    const res = idx.map((i) => Math.abs((xyz[i * 3] - c[0]) * n[0] + (xyz[i * 3 + 1] - c[1]) * n[1] + (xyz[i * 3 + 2] - c[2]) * n[2]));
    const sigma = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, res.length));
    const next = idx.filter((_, k) => res[k] <= 2 * sigma);
    if (next.length < 3 || next.length === idx.length) break;
    idx = next;
    plane = fitPlane(xyz, idx) ?? plane;
  }

  // total correction: the plane normal expressed in the preset frame is q0^-1 (n1)
  let q2 = q0;
  let tiltDeg = 0;
  let floorOffset = untiltedPeakY;
  let tooTilted = true;
  if (plane) {
    const q1 = quatFromUnitVectors({ x: plane.n[0], y: plane.n[1], z: plane.n[2] }, { x: 0, y: 1, z: 0 });
    q2 = quatMul(q1, q0);
    const back = rotateY(quatInvert(q2), { x: 0, y: 1, z: 0 });
    tiltDeg = (Math.acos(Math.min(1, Math.max(-1, back.y))) * 180) / Math.PI;
    tooTilted = tiltDeg > maxTilt;
    if (!tooTilted) {
      const mq = matFromQuat(q1);
      let sum = 0;
      for (const i of idx) sum += mq[3] * xyz[i * 3] + mq[4] * xyz[i * 3 + 1] + mq[5] * xyz[i * 3 + 2];
      floorOffset = sum / idx.length;
    }
  } else tiltDeg = (Math.atan(Math.hypot(tilt0.a, tilt0.b)) * 180) / Math.PI;
  if (tooTilted) q2 = [0, 0, 0, 1];

  // 5. ceiling, read from the final levelled points
  const ml = matFromQuat(q2);
  const yl = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = all.x[i], y = all.y[i], z = all.z[i];
    yl[i] = ml[3] * x + ml[4] * y + ml[5] * z - floorOffset;
  }
  let ceilingRaw: number | null = null;
  if (!tooTilted) {
    const L = histogram(yl, all.w);
    const floorBin = Math.min(BINS - 1, Math.max(0, Math.floor((0 - L.lo) / L.bw)));
    let floorWeight = 0;
    for (let b = Math.max(0, floorBin - 2); b <= Math.min(BINS - 1, floorBin + 2); b++) floorWeight = Math.max(floorWeight, L.smooth[b]);
    const cb = heaviestPeak(L.smooth, Math.floor(BINS * 0.6), BINS);
    if (cb >= 0 && floorWeight > 0 && L.smooth[cb] >= 0.25 * floorWeight) {
      let sw = 0, sy = 0;
      for (let b = Math.max(0, cb - 3); b <= Math.min(BINS - 1, cb + 3); b++) { sw += L.raw[b]; sy += L.raw[b] * (L.lo + (b + 0.5) * L.bw); }
      const cy = sw > 0 ? sy / sw : L.lo + (cb + 0.5) * L.bw;
      if (cy > 0) ceilingRaw = cy;
    }
  }

  return {
    rotation: quatMul(q2, qp),
    floorOffsetRaw: floorOffset,
    ceilingRaw,
    tiltDeg,
    confidence,
    lowConfidence: confidence < LOW_CONFIDENCE_BELOW || tooTilted,
  };
}

/**
 * SPEC 4.11 `levelFromThreePoints`: the plane through three raw-space picks, its normal turned toward `hint` (the camera).
 * The rotation is from raw space directly (no preset). `tiltDeg` is the angle between that normal and raw +Y, i.e. how much
 * correction was applied. `confidence` is 99.
 * // SPEC-GAP: three collinear picks give no plane; this throws, and the editor asks for three spots that are not in a line.
 */
export function levelFromThreePoints(a: Vec3, b: Vec3, c: Vec3, hint: Vec3): LevelResult {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  let n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const len = Math.hypot(n.x, n.y, n.z);
  if (!(len > 1e-12)) throw new Error('The three points are in a line. Pick three spots that are not in a line.');
  n = { x: n.x / len, y: n.y / len, z: n.z / len };
  if ((hint.x - a.x) * n.x + (hint.y - a.y) * n.y + (hint.z - a.z) * n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
  const q = quatFromUnitVectors(n, { x: 0, y: 1, z: 0 });
  const m = matFromQuat(q);
  const mean = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
  return {
    rotation: q,
    floorOffsetRaw: m[3] * mean.x + m[4] * mean.y + m[5] * mean.z,
    ceilingRaw: null,
    tiltDeg: (Math.acos(Math.min(1, Math.max(-1, n.y))) * 180) / Math.PI,
    confidence: 99,
    lowConfidence: false,
  };
}

/**
 * The levelling a saved overlay implies: its transform's rotation levels the cloud, and the floor sits at
 * `-position.y / scale`. Lets the editor re-open a saved overlay (preset or manual) without the original picks.
 * Ceiling is unknown (null).
 */
export function levelFromTransform(t: SceneTransform): LevelResult {
  return { rotation: t.rotation, floorOffsetRaw: -t.position[1] / t.scale, ceilingRaw: null, tiltDeg: 0, confidence: 99, lowConfidence: false };
}

/** Levelled frame: `p_L = rotate(level.rotation, p_raw) - (0, floorOffsetRaw, 0)`. Raw units, Y up, floor at 0. */
export function toLevelled(raw: RawCloud, level: LevelResult): Float32Array {
  const m = matFromQuat(level.rotation);
  const out = new Float32Array(raw.count * 3);
  const p = raw.positions;
  for (let i = 0; i < raw.count; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    out[i * 3] = m[0] * x + m[1] * y + m[2] * z;
    out[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z - level.floorOffsetRaw;
    out[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
  return out;
}
