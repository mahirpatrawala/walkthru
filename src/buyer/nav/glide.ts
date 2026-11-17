// The maths of a glide (SPEC 2.6): turn the string-pulled grid path into a smooth curve, and decide how fast to go along it. Pure: no DOM, no three.
//
//  - `roundCorners`: every corner of the polyline is replaced by a quadratic curve, as wide as the free space allows (it is tried at full size and
//    halved until the whole curve keeps the body clear of walls and furniture on the grid; a corner that will not round stays a corner).
//  - `makeCurve`: the rounded path resampled every 4 cm, with arc length, tangent and curvature.
//  - `buildProfile`: the distance travelled as a function of time, worked out once when the leg is planned, with a jerk limit (so the speed eases in and
//    out, with no step in acceleration), a cap on speed from the curve's tightness and from doorways, and a braking curve that ends exactly at the
//    end of the leg (or at a given speed, to run on through a passage). It is sampled at the simulation step, so the motion is the same however
//    often the page draws.
import type { Grid, Vec2 } from '../../types';
import { circleFree } from '../../core/grid-query';

/** The simulation step (s): the driver integrates everything in steps of this size, whatever the frame rate. */
export const SIM_DT = 1 / 120;
const DS = 0.04;

export interface Kinematics {
  /** cruise speed (m/s) */
  vc: number;
  /** largest speed-up and slow-down (m/s^2) */
  acc: number;
  dec: number;
  /** largest change of acceleration (m/s^3) */
  jerk: number;
  /** sideways acceleration allowed in a bend (m/s^2): the speed in a bend is sqrt(this / curvature) */
  lateral: number;
  /** cruise speed as a fraction of itself through a doorway */
  doorway: number;
}
export const TOUR_KIN: Kinematics = { vc: 1.0, acc: 0.9, dec: 1.1, jerk: 1.5, lateral: 0.7, doorway: 0.72 };
/**
 * Going to a room (SPEC 2.6): a calm, brisk WALK, never a run. 1.4 m/s is the manual walk's own pace (locomotion.ts WALK_MPS), so the walk clip's
 * stride matches the ground it covers; it eases in over ~1.5 s and out over ~1.3 s, goes through a doorway at 0.7 of that and takes a bend at
 * sqrt(0.9 / curvature) (a 0.8 m radius turn at about 1.06 m/s).
 */
export const GO_KIN: Kinematics = { vc: 1.4, acc: 1.0, dec: 1.2, jerk: 2.2, lateral: 0.9, doorway: 0.7 };

const norm = (x: number, z: number): { x: number; z: number; l: number } => { const l = Math.hypot(x, z); return l > 1e-9 ? { x: x / l, z: z / l, l } : { x: 0, z: 0, l: 0 }; };

/** The polyline with its corners rounded (see the top of the file). `grid` is the planning grid; `radiusM` the body. */
export function roundCorners(route: readonly Vec2[], grid: Grid, radiusM: number, maxCutM = 0.9): Vec2[] {
  if (route.length < 3) return route.map((p) => ({ x: p.x, z: p.z }));
  const out: Vec2[] = [{ x: route[0].x, z: route[0].z }];
  // how much of each leg a corner may use: at most 45 % of it, so two corners never meet
  for (let i = 1; i < route.length - 1; i++) {
    const p = route[i];
    const a = norm(p.x - route[i - 1].x, p.z - route[i - 1].z), b = norm(route[i + 1].x - p.x, route[i + 1].z - p.z);
    const cos = a.x * b.x + a.z * b.z;
    if (cos > 0.9998 || a.l === 0 || b.l === 0) { out.push({ x: p.x, z: p.z }); continue; }
    const prevCut = i > 1 ? Math.min(maxCutM, a.l * 0.45) : maxCutM;
    let t = Math.min(maxCutM, a.l * 0.45, b.l * 0.45);
    void prevCut;
    let placed = false;
    for (let tries = 0; tries < 5 && t > 0.08; tries++, t *= 0.5) {
      const p0 = { x: p.x - a.x * t, z: p.z - a.z * t }, p2 = { x: p.x + b.x * t, z: p.z + b.z * t };
      const pts: Vec2[] = [];
      let ok = true;
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const u = k / n, w = 1 - u;
        const q = { x: w * w * p0.x + 2 * w * u * p.x + u * u * p2.x, z: w * w * p0.z + 2 * w * u * p.z + u * u * p2.z };
        if (!circleFree(grid, q.x, q.z, radiusM + 0.04)) { ok = false; break; }
        pts.push(q);
      }
      if (ok) { out.push(...pts); placed = true; break; }
    }
    if (!placed) out.push({ x: p.x, z: p.z });
  }
  out.push({ x: route[route.length - 1].x, z: route[route.length - 1].z });
  return out;
}

export interface Curve {
  /** the resampled points, 4 cm apart */
  pts: Vec2[];
  /** arc length at each point */
  cum: number[];
  length: number;
  pointAt(s: number): Vec2;
  /** unit direction of travel at `s` */
  tangentAt(s: number): Vec2;
  /** |turning| per metre at `s` (1/m) */
  curvatureAt(s: number): number;
}

export function makeCurve(poly: readonly Vec2[]): Curve {
  const pts: Vec2[] = [{ x: poly[0].x, z: poly[0].z }];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-9) continue;
    let d = DS - carry;
    for (; d <= l + 1e-9; d += DS) pts.push({ x: a.x + ((b.x - a.x) * d) / l, z: a.z + ((b.z - a.z) * d) / l });
    carry = l - (d - DS);
    if (carry < 1e-9) carry = 0;
  }
  const last = poly[poly.length - 1];
  if (Math.hypot(last.x - pts[pts.length - 1].x, last.z - pts[pts.length - 1].z) > 1e-6) pts.push({ x: last.x, z: last.z });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const length = cum[cum.length - 1];
  const idx = (s: number): number => {
    if (s <= 0) return 0;
    if (s >= length) return pts.length - 2;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    return lo;
  };
  const tan = (i: number): Vec2 => { const n = norm(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); return { x: n.x, z: n.z }; };
  return {
    pts, cum, length,
    pointAt(s) {
      if (pts.length === 1) return { ...pts[0] };
      const i = idx(s), seg = cum[i + 1] - cum[i];
      const t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / seg)) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t };
    },
    tangentAt(s) { return pts.length === 1 ? { x: 0, z: 1 } : tan(idx(s)); },
    curvatureAt(s) {
      if (pts.length < 3) return 0;
      const i = idx(s);
      const j0 = Math.max(0, i - 3), j1 = Math.min(pts.length - 2, i + 3);
      const t0 = tan(j0), t1 = tan(j1);
      const ang = Math.abs(Math.atan2(t0.x * t1.z - t0.z * t1.x, t0.x * t1.x + t0.z * t1.z));
      const ds = cum[j1 + 1] - cum[j0];
      return ds > 0 ? ang / ds : 0;
    },
  };
}

/** The speed cap along the curve (a fraction of cruise, 0.4 to 1) from bends and doorways, smoothed over a metre so it never steps. */
export function speedCap(curve: Curve, kin: Kinematics, doors: readonly Vec2[]): (s: number) => number {
  const n = Math.max(2, Math.ceil(curve.length / DS));
  const raw = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const s = Math.min(curve.length, k * DS);
    const kappa = curve.curvatureAt(s);
    let f = kappa > 1e-6 ? Math.sqrt(kin.lateral / kappa) / kin.vc : 1;
    const p = curve.pointAt(s);
    let nearest = Infinity;
    for (const d of doors) nearest = Math.min(nearest, Math.hypot(p.x - d.x, p.z - d.z));
    if (nearest < 0.9) { const u = 1 - nearest / 0.9; f = Math.min(f, 1 - (1 - kin.doorway) * u * u * (3 - 2 * u)); }
    raw[k] = Math.min(1, Math.max(0.4, f));
  }
  // a moving average over +-0.5 m, twice: no corner in the cap
  const W = Math.round(0.5 / DS);
  const blur = (src: Float64Array): Float64Array => {
    const pre = new Float64Array(src.length + 1);
    for (let i = 0; i < src.length; i++) pre[i + 1] = pre[i] + src[i];
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) { const a = Math.max(0, i - W), b = Math.min(src.length - 1, i + W); out[i] = (pre[b + 1] - pre[a]) / (b - a + 1); }
    return out;
  };
  const cap = blur(blur(raw));
  return (s) => { const f = Math.min(n, Math.max(0, s / DS)); const i = Math.floor(f); return cap[i] + (cap[Math.min(n, i + 1)] - cap[i]) * (f - i); };
}

export interface Profile {
  /** distance along the leg at simulated time k * SIM_DT */
  s: Float32Array;
  /** the same for the speed (m/s) */
  v: Float32Array;
  durationS: number;
  /** the speed at the end of the leg */
  vEnd: number;
}

/**
 * Distance against time for a leg of `length` metres, starting at speed `v0` and ending at `vEnd` (0: a stop). A jerk-limited controller follows
 * the target speed `min(cruise * cap(s), braking curve)`, so speeding up and slowing down are eased and the leg ends where it should.
 */
export function buildProfile(length: number, v0: number, vEnd: number, kin: Kinematics, cap: (s: number) => number): Profile {
  const sArr: number[] = [0], vArr: number[] = [v0];
  const A = kin.dec * 0.8, J = kin.jerk;
  // The speed as a function of distance is the smooth minimum of three limits: the cruise speed (less in bends and doorways), the ease-in from the
  // speed the leg starts at, and the ease-out to the speed it ends at. The two eases are one S-curve (a jerk-limited ramp: a triangle of acceleration,
  // or a trapezoid once it reaches A), written out as the distance a speed needs and its inverse, so the leg ends exactly where it should, at rest
  // or at speed, with no controller to lag behind it.
  const vKnee = (A * A) / J;
  const distOf = (u: number): number => (u <= vKnee ? Math.pow(u, 1.5) / Math.sqrt(J) : (u * u) / (2 * A) + (u * A) / (2 * J));
  const speedOf = (d: number): number => {
    const tri = Math.pow(Math.max(0, d) * Math.sqrt(J), 2 / 3);
    return tri <= vKnee ? tri : (-(A * A) / J + Math.sqrt((A ** 4) / (J * J) + 8 * A * d)) / 2;
  };
  const dStart = distOf(Math.min(v0, kin.vc)), dEnd = distOf(vEnd);
  const P = 8;
  const soft = (x: number, y: number, z: number): number => Math.pow(Math.pow(Math.max(x, 1e-6), -P) + Math.pow(Math.max(y, 1e-6), -P) + Math.pow(Math.max(z, 1e-6), -P), -1 / P);
  const speed = (s: number): number => soft(kin.vc * cap(s), speedOf(s + dStart), speedOf(length - s + dEnd));
  let s = 1e-5, v = v0;
  const maxSteps = Math.ceil(120 / SIM_DT);
  for (let step = 0; step < maxSteps; step++) {
    if (length - s <= 0.0008) break;
    const want = Math.max(speed(s), vEnd > 0 ? 0.05 : 0.003);
    // a leg that takes over from a faster one (a door that opened on the way) joins its speed without a step
    const dv = kin.dec * 1.6 * SIM_DT;
    v = step === 0 ? Math.max(v0, want) : Math.max(vEnd > 0 ? 0.05 : 0.003, Math.min(v + dv, Math.max(v - dv, want)));
    s = Math.min(length, s + v * SIM_DT);
    sArr.push(s); vArr.push(v);
  }
  if (sArr[sArr.length - 1] < length) { sArr.push(length); vArr.push(vEnd); }
  return { s: Float32Array.from(sArr), v: Float32Array.from(vArr), durationS: (sArr.length - 1) * SIM_DT, vEnd: vArr[vArr.length - 1] };
}

/** Distance and speed at time `t` (s) into the profile. */
export function profileAt(p: Profile, t: number): { s: number; v: number; done: boolean } {
  const f = Math.max(0, t) / SIM_DT;
  const i = Math.floor(f);
  if (i >= p.s.length - 1) return { s: p.s[p.s.length - 1], v: p.vEnd, done: true };
  const u = f - i;
  return { s: p.s[i] + (p.s[i + 1] - p.s[i]) * u, v: p.v[i] + (p.v[i + 1] - p.v[i]) * u, done: false };
}

/** Smooth ease 0..1 (zero slope and curvature at both ends). */
export const smootherstep = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * x * (x * (x * 6 - 15) + 10); };

/**
 * A critically damped follower of an angle (degrees): no overshoot. Advances `state` by `dt` towards `target`. A wanted turn of any size is
 * squashed (tanh) to the size that peaks at `maxRateDegS`, so a half turn is a long smooth sweep, never a clamp with corners.
 */
export function dampAngle(state: { yaw: number; rate: number }, target: number, dt: number, omega: number, maxRateDegS: number): void {
  const diff = ((((target - state.yaw) % 360) + 540) % 360) - 180;
  const reach = maxRateDegS / (0.37 * omega);
  const eff = reach * Math.tanh(diff / reach);
  const acc = omega * omega * eff - 2 * omega * state.rate;
  state.rate += acc * dt;
  if (state.rate > maxRateDegS) state.rate = maxRateDegS; else if (state.rate < -maxRateDegS) state.rate = -maxRateDegS;
  state.yaw += state.rate * dt;
}
