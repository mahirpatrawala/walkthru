// SPEC 16.18: the camera's smoothing functions: same end state at any frame rate, no overshoot, bounded change per frame.
import { describe, expect, it } from 'vitest';
import { MAX_SMOOTH_DT, angleDelta, clampDt, damp, dampAngle, springAngleTo, springTo } from '../src/engine/smooth';
import type { Spring } from '../src/engine/smooth';

const run = (fps: number, sec: number, f: (dt: number) => void): void => { for (let i = 0; i < Math.round(fps * sec); i++) f(1 / fps); };

describe('damp (exponential approach)', () => {
  it('reaches the same value after one second at 30, 60 and 120 fps', () => {
    const at = (fps: number): number => { let v = 0; run(fps, 1, (dt) => { v = damp(v, 10, 0.2, dt); }); return v; };
    expect(at(30)).toBeCloseTo(at(120), 9);
    expect(at(60)).toBeCloseTo(at(120), 9);
    expect(at(60)).toBeCloseTo(10 * (1 - Math.exp(-5)), 9);
  });
  it('never overshoots and never moves more than the distance left', () => {
    let v = 0, prev = 0;
    for (let i = 0; i < 200; i++) { v = damp(v, 5, 0.07, 1 / 60); expect(v).toBeLessThanOrEqual(5); expect(v).toBeGreaterThanOrEqual(prev); expect(v - prev).toBeLessThanOrEqual(5 - prev + 1e-12); prev = v; }
  });
  it('a long frame cannot jump: it counts as at most 0.1 s', () => {
    expect(clampDt(2)).toBe(MAX_SMOOTH_DT);
    expect(damp(0, 10, 0.2, 2)).toBeCloseTo(damp(0, 10, 0.2, MAX_SMOOTH_DT), 12);
    expect(damp(3, 10, 0.2, 0)).toBe(3);
    expect(damp(3, 10, 0.2, -1)).toBe(3);
  });
  it('a zero time constant is a snap', () => { expect(damp(0, 4, 0, 1 / 60)).toBe(4); });
});

describe('angles', () => {
  it('angleDelta is the short way', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20, 9);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 9);
    expect(Math.abs(angleDelta(0, 180))).toBe(180);
  });
  it('dampAngle goes round the short way and agrees across frame rates', () => {
    const at = (fps: number): number => { let a = 350; run(fps, 0.5, (dt) => { a = dampAngle(a, 10, 0.1, dt); }); return a; };
    expect(at(30)).toBeCloseTo(at(120), 8);
    expect(at(60)).toBeGreaterThan(350); // up through 360, not down through 180
    expect(at(60)).toBeLessThan(370.5);
  });
});

describe('springTo (critically damped)', () => {
  const fresh = (): Spring => ({ value: 0, velocity: 0 });
  it('same end state at 30, 60 and 120 fps', () => {
    const at = (fps: number): Spring => { const s = fresh(); run(fps, 0.6, (dt) => { springTo(s, 1, 0.3, dt); }); return s; };
    expect(at(30).value).toBeCloseTo(at(120).value, 9);
    expect(at(60).velocity).toBeCloseTo(at(120).velocity, 9);
  });
  it('from rest it is monotone, never overshoots, and settles in about three smooth times', () => {
    for (const fps of [30, 60, 120]) {
      const s = fresh();
      let prev = 0;
      run(fps, 1.5, (dt) => { springTo(s, 1, 0.3, dt); expect(s.value).toBeLessThanOrEqual(1 + 1e-12); expect(s.value).toBeGreaterThanOrEqual(prev - 1e-12); prev = s.value; });
      expect(s.value).toBeGreaterThan(0.999);
    }
    const mid = fresh();
    run(60, 0.3, (dt) => { springTo(mid, 1, 0.3, dt); });
    expect(mid.value).toBeCloseTo(1 - 3 * Math.exp(-2), 9); // 59 % of the way after one smooth time, 99 % after three
  });
  it('change per frame is bounded by the speed the system can reach: a target that jumps makes it glide, not step', () => {
    const s = fresh();
    let prev = 0, worst = 0;
    run(60, 1, (dt) => { springTo(s, 100, 0.3, dt); worst = Math.max(worst, Math.abs(s.value - prev)); prev = s.value; });
    // peak speed of a critically damped approach from rest is 4 / (e^2 smoothTime) of the distance per second: 0.18 of it per 1/60 s at most
    expect(worst).toBeLessThan(100 * (2 / 0.3) * Math.exp(-1) / 60 + 1e-9);
  });
  it('a long frame counts as 0.1 s at most', () => {
    const a = fresh(), b = fresh();
    springTo(a, 1, 0.3, 5);
    springTo(b, 1, 0.3, MAX_SMOOTH_DT);
    expect(a.value).toBeCloseTo(b.value, 12);
  });
  it('a target that changes mid-flight keeps the velocity (no corner)', () => {
    const s = fresh();
    run(60, 0.2, (dt) => { springTo(s, 1, 0.3, dt); });
    const v = s.velocity;
    springTo(s, -1, 0.3, 1 / 600);
    expect(Math.abs(s.velocity - v)).toBeLessThan(0.1 * Math.abs(v) + 0.5);
  });
  it('springAngleTo takes the short way across 0 and 360', () => {
    const s: Spring = { value: 350, velocity: 0 };
    run(60, 1, (dt) => { springAngleTo(s, 10, 0.2, dt); });
    expect(s.value).toBeGreaterThan(359);
    expect(s.value).toBeLessThan(370.01);
  });
});
