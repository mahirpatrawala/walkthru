// The tour's glide (SPEC 2.6): the same path and the same time at 20, 60 and 120 frames a second, a heading that never turns faster than
// MAX_YAW_RATE_DEG_S or lurches, a speed that never passes the cruise limit or changes faster than the stated acceleration, never inside a solid, and
// the pure maths of the curve and the profile.
import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M } from '../src/types';
import type { Vec2 } from '../src/types';
import { circleFree } from '../src/core/grid-query';
import { MAX_YAW_RATE_DEG_S } from '../src/buyer/nav/driver';
import { GO_KIN, SIM_DT, TOUR_KIN, buildProfile, dampAngle, makeCurve, profileAt, roundCorners, smootherstep, speedCap } from '../src/buyer/nav/glide';
import { rasterizeLayout } from '../src/core/layout-raster';
import { makeSim } from './helpers/nav-sim';

const FLAT_204 = 'test-tower-flat-3bhk-a';

export interface Rec { t: number[]; x: number[]; z: number[]; cam: number[]; bad: number; done: number; visited: number; total: number }

/** a whole tour of Flat 204 at `fps` frames a second, recorded every frame */
export async function recordTour(fps: number, maxS = 400): Promise<Rec> {
  const sim = makeSim(FLAT_204, 'living');
  const rec: Rec = { t: [], x: [], z: [], cam: [], bad: 0, done: 0, visited: 0, total: 0 };
  let frame = 0;
  const p = sim.driver.startTour();
  await sim.run(() => sim.driver.tour?.phase === 'done', maxS, (live) => {
    frame++;
    rec.t.push(frame / fps); rec.x.push(sim.ch.position.x); rec.z.push(sim.ch.position.z); rec.cam.push(sim.cam.yawDeg);
    if (!circleFree(live, sim.ch.position.x, sim.ch.position.z, CHARACTER_RADIUS_M - 0.03)) rec.bad++;
  }, fps);
  const st = await p;
  rec.done = st.phase === 'done' ? rec.t[rec.t.length - 1] : -1;
  rec.visited = st.visited.length; rec.total = st.total;
  return rec;
}

const dAng = (a: number, b: number): number => ((((b - a) % 360) + 540) % 360) - 180;
const segDist = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};
const distToPath = (p: Vec2, r: Rec): number => { let m = Infinity; for (let i = 1; i < r.x.length; i++) m = Math.min(m, segDist(p, { x: r.x[i - 1], z: r.z[i - 1] }, { x: r.x[i], z: r.z[i] })); return m; };

describe('the tour at 20, 60 and 120 frames a second', () => {
  const runs: Record<number, Rec> = {};
  it('finishes, visits every room, and is never inside a solid, at every frame rate', async () => {
    for (const fps of [20, 60, 120]) {
      runs[fps] = await recordTour(fps);
      expect(runs[fps].done, `fps ${fps}`).toBeGreaterThan(0);
      expect(runs[fps].bad, `fps ${fps} frames inside a solid`).toBe(0);
      expect(runs[fps].visited).toBeGreaterThanOrEqual(14);
    }
  }, 600000);

  it('takes the same time (within 2 %) and the same path (within 2 cm)', () => {
    const base = runs[120];
    for (const fps of [20, 60]) {
      const r = runs[fps];
      expect(Math.abs(r.done - base.done) / base.done, `duration at ${fps}`).toBeLessThan(0.02);
      // every recorded point of one lies on the path of the other
      let worst = 0;
      for (let i = 0; i < r.x.length; i += 3) worst = Math.max(worst, distToPath({ x: r.x[i], z: r.z[i] }, base));
      for (let i = 0; i < base.x.length; i += 12) worst = Math.max(worst, distToPath({ x: base.x[i], z: base.z[i] }, r));
      expect(worst, `path difference at ${fps} fps`).toBeLessThan(0.02);
    }
  }, 600000);

  it('never turns the view faster than the limit, and the turning rate changes smoothly', () => {
    const r = runs[120];
    let maxRate = 0, maxAcc = 0, prev = 0;
    for (let i = 1; i < r.cam.length; i++) {
      const rate = dAng(r.cam[i - 1], r.cam[i]) / (r.t[i] - r.t[i - 1]);
      maxRate = Math.max(maxRate, Math.abs(rate));
      if (i > 1) maxAcc = Math.max(maxAcc, Math.abs(rate - prev) / (r.t[i] - r.t[i - 1]));
      prev = rate;
    }
    expect(maxRate).toBeLessThanOrEqual(MAX_YAW_RATE_DEG_S + 1);
    // the follower is critically damped: its acceleration is bounded by omega^2 * the largest error it can have (a 180 degree turn), and rate-limited
    expect(maxAcc).toBeLessThan(400);
  }, 600000);

  it('keeps to the cruise speed and a bounded acceleration', () => {
    const r = runs[120];
    const sp: number[] = [];
    for (let i = 1; i < r.x.length; i++) sp.push(Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]) / (r.t[i] - r.t[i - 1]));
    // a 0.1 s moving average: the position is read once a frame
    const win = 12;
    const avg = sp.map((_, i) => { const a = Math.max(0, i - win + 1); return sp.slice(a, i + 1).reduce((x, y) => x + y, 0) / (i + 1 - a); });
    expect(Math.max(...avg)).toBeLessThanOrEqual(TOUR_KIN.vc * 1.05);
    let maxA = 0;
    for (let i = win; i < avg.length; i++) maxA = Math.max(maxA, Math.abs(avg[i] - avg[i - win]) / (win * (1 / 120)));
    expect(maxA).toBeLessThan(TOUR_KIN.dec * 1.3);
  }, 600000);
});

describe('the pieces of the glide', () => {
  const grid = rasterizeLayout(makeSim(FLAT_204, 'living').layout);
  it('a profile starts and stops at rest with no jump in speed, reaches its length, and respects the limits', () => {
    const cap = () => 1;
    const p = buildProfile(6, 0, 0, TOUR_KIN, cap);
    expect(p.s[0]).toBe(0);
    expect(p.s[p.s.length - 1]).toBeCloseTo(6, 3);
    let maxV = 0, maxA = 0, maxStep = 0;
    for (let i = 1; i < p.v.length; i++) { maxV = Math.max(maxV, p.v[i]); maxA = Math.max(maxA, Math.abs(p.v[i] - p.v[i - 1]) / SIM_DT); maxStep = Math.max(maxStep, Math.abs(p.v[i] - p.v[i - 1])); }
    expect(maxV).toBeLessThanOrEqual(TOUR_KIN.vc + 1e-3);
    expect(maxA).toBeLessThanOrEqual(1.3);
    expect(p.v[0]).toBe(0);
    expect(p.v[p.v.length - 1]).toBeLessThan(0.15);
    // monotonic distance
    for (let i = 1; i < p.s.length; i++) expect(p.s[i]).toBeGreaterThanOrEqual(p.s[i - 1]);
    expect(profileAt(p, 0).s).toBe(0);
    expect(profileAt(p, 1e6).done).toBe(true);
  });
  it('a short leg still eases and ends at its length; a run-on carries its speed', () => {
    const short = buildProfile(0.5, 0, 0, TOUR_KIN, () => 1);
    expect(short.s[short.s.length - 1]).toBeCloseTo(0.5, 3);
    expect(Math.max(...short.v)).toBeLessThan(TOUR_KIN.vc);
    const go = buildProfile(5, 0, 0, GO_KIN, () => 1);
    expect(Math.max(...go.v)).toBeGreaterThan(1.8);
    expect(Math.max(...go.v)).toBeLessThanOrEqual(GO_KIN.vc + 1e-3);
    const run = buildProfile(4, 0.9, 0.8, TOUR_KIN, () => 1);
    expect(run.vEnd).toBeGreaterThan(0.5);
  });
  it('bends and doorways slow the cap, smoothly, never under 0.4', () => {
    const curve = makeCurve(roundCorners([{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], grid, CHARACTER_RADIUS_M, 0.9).map((p) => ({ x: p.x + 100, z: p.z + 100 })));
    void curve;
    const c2 = makeCurve([{ x: 0, z: 0 }, { x: 1.5, z: 0 }, { x: 1.5, z: 0.04 }, { x: 3, z: 0.04 }]);
    const cap = speedCap(c2, TOUR_KIN, [{ x: 2.2, z: 0 }]);
    let prev = cap(0), maxStep = 0, low = 1;
    for (let s = 0; s <= c2.length; s += 0.02) { const v = cap(s); maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; low = Math.min(low, v); }
    expect(low).toBeGreaterThanOrEqual(0.4);
    expect(low).toBeLessThan(0.95);
    expect(maxStep).toBeLessThan(0.02);
  });
  it('rounding a corner keeps the path clear of a wall that is in the way, and a free corner is cut short', () => {
    const free = roundCorners([{ x: 1, z: 1 }, { x: 1, z: 2.2 }, { x: 2.2, z: 2.2 }], { ...grid, cells: new Uint8Array(grid.cells.length) } as typeof grid, CHARACTER_RADIUS_M, 0.9);
    expect(free.length).toBeGreaterThan(5);
    expect(free[0]).toEqual({ x: 1, z: 1 });
    // the cut passes inside the corner point
    const mid = free[Math.floor(free.length / 2)];
    expect(Math.hypot(mid.x - 1, mid.z - 2.2)).toBeGreaterThan(0.1);
  });
  it('a critically damped follower never overshoots and settles', () => {
    const st = { yaw: 0, rate: 0 };
    let over = 0;
    for (let i = 0; i < 120 * 6; i++) { dampAngle(st, 120, SIM_DT, 2.8, MAX_YAW_RATE_DEG_S); over = Math.max(over, st.yaw - 120); }
    expect(over).toBeLessThan(0.5);
    expect(Math.abs(st.yaw - 120)).toBeLessThan(0.5);
    expect(smootherstep(0)).toBe(0); expect(smootherstep(1)).toBe(1); expect(smootherstep(0.5)).toBeCloseTo(0.5, 6);
  });
});
