import { describe, expect, it } from 'vitest';
import { truthGrid } from '../scripts/make-test-room';
import { cellValue, createGrid } from '../src/core/grid-codec';
import { boomDistance, circleFree, clearance, moveCircle, nearestFree } from '../src/core/grid-query';
import { mulberry32 } from '../src/core/geometry';
import { CHARACTER_RADIUS_M, GRID_FREE, GRID_VOID } from '../src/types';
import type { Grid, Vec2 } from '../src/types';

const R = CHARACTER_RADIUS_M;
const empty = truthGrid('empty');
const furnished = truthGrid('furnished');

/** Walk in 0.1 m pushes (as a game loop would) and check every position stays circle-free. */
function walk(grid: Grid, from: Vec2, delta: Vec2): { end: Vec2; everNonFree: boolean } {
  const n = Math.ceil(Math.hypot(delta.x, delta.z) / 0.1);
  let p = { ...from };
  let bad = !circleFree(grid, p.x, p.z, R);
  for (let i = 0; i < n; i++) {
    p = moveCircle(grid, p, { x: delta.x / n, z: delta.z / n }, R);
    if (!circleFree(grid, p.x, p.z, R) || cellValue(grid, p.x, p.z) !== GRID_FREE) bad = true;
  }
  return { end: p, everNonFree: bad };
}

describe('circleFree', () => {
  it('is true in the middle of the room and false beside a wall, outside the grid and in void', () => {
    expect(circleFree(empty, 2, 2.5, R)).toBe(true);
    expect(circleFree(empty, 3.95, 2.5, R)).toBe(false);
    expect(circleFree(empty, 100, 100, R)).toBe(false);
    expect(circleFree(empty, 2, -3, R)).toBe(false);
  });
  it('treats the radius as a disc, not a square', () => {
    const g = createGrid(0, 0, 40, 40, GRID_FREE);
    g.cells[20 * 40 + 24] = 100; // one obstacle cell, centre (1.225, 1.025)
    expect(circleFree(g, 1.0, 1.0, 0.22)).toBe(true);  // centre is 0.2264 away: outside the disc
    expect(circleFree(g, 1.0, 1.0, 0.23)).toBe(false); // now inside it
    g.cells[20 * 40 + 24] = 0;
    g.cells[24 * 40 + 24] = 100; // centre (1.225, 1.225): diagonal 0.318 away, inside the 0.22 square but outside the disc
    expect(circleFree(g, 1.0, 1.0, 0.22)).toBe(true);
  });
});

describe('moveCircle (acceptance)', () => {
  it('stops at the east wall: from (2, 2.5) by (+5, 0) ends at x = 4 - 0.22 within 0.06', () => {
    const { end, everNonFree } = walk(empty, { x: 2, z: 2.5 }, { x: 5, z: 0 });
    console.log('east wall stop x =', end.x.toFixed(4), 'expected', (4 - R).toFixed(4));
    expect(Math.abs(end.x - (4 - R))).toBeLessThan(0.06);
    expect(end.z).toBeCloseTo(2.5, 6);
    expect(everNonFree).toBe(false);
  });
  it('slides into the corner: from (2, 2.5) by (+5, +5) ends within 0.1 of (3.78, 4.78)', () => {
    const { end, everNonFree } = walk(empty, { x: 2, z: 2.5 }, { x: 5, z: 5 });
    console.log('corner slide end =', end.x.toFixed(4), end.z.toFixed(4));
    expect(Math.hypot(end.x - 3.78, end.z - 4.78)).toBeLessThan(0.1);
    expect(everNonFree).toBe(false);
  });
  it('passes the bedroom door: from (0.85, 4.5) by (0, +1.5) ends at z > 5.5', () => {
    const { end, everNonFree } = walk(empty, { x: 0.85, z: 4.5 }, { x: 0, z: 1.5 });
    console.log('door end z =', end.z.toFixed(4));
    expect(end.z).toBeGreaterThan(5.5);
    expect(everNonFree).toBe(false);
  });
  it('passes the sliding opening and stops at the railing: from (2, 0.5) by (0, -3) ends at z = -1.62 + 0.22 within 0.06', () => {
    const { end, everNonFree } = walk(empty, { x: 2, z: 0.5 }, { x: 0, z: -3 });
    console.log('railing stop z =', end.z.toFixed(4), 'expected', (-1.62 + R).toFixed(4));
    expect(Math.abs(end.z - (-1.62 + R))).toBeLessThan(0.06);
    expect(everNonFree).toBe(false);
  });
  it('also works as one big call (sub-stepping)', () => {
    const end = moveCircle(empty, { x: 2, z: 2.5 }, { x: 5, z: 0 }, R);
    expect(Math.abs(end.x - (4 - R))).toBeLessThan(0.06);
    expect(circleFree(empty, end.x, end.z, R)).toBe(true);
  });
  it('is blocked by the furnished bed and sofa', () => {
    const bed = walk(furnished, { x: 2.8, z: 2.25 }, { x: -3, z: 0 });
    expect(bed.end.x).toBeGreaterThan(2.0 + R - 0.06);
    expect(bed.everNonFree).toBe(false);
    const sofa = walk(furnished, { x: 2, z: 3.5 }, { x: 3, z: 0 });
    expect(sofa.end.x).toBeLessThan(3.1 - R + 0.06);
    expect(sofa.everNonFree).toBe(false);
  });
  it('zero delta is a no-op', () => {
    expect(moveCircle(empty, { x: 2, z: 2.5 }, { x: 0, z: 0 }, R)).toEqual({ x: 2, z: 2.5 });
  });
  it('never enters a non-free cell over 2,000 random pushes', () => {
    const rnd = mulberry32(7);
    let p = { x: 2.6, z: 2.5 };
    for (let i = 0; i < 2000; i++) {
      const a = rnd() * Math.PI * 2;
      p = moveCircle(furnished, p, { x: Math.cos(a) * 0.3, z: Math.sin(a) * 0.3 }, R);
      expect(circleFree(furnished, p.x, p.z, R)).toBe(true);
    }
  });
});

describe('nearestFree', () => {
  it('returns the point itself when free', () => {
    expect(nearestFree(empty, 2, 2.5, R)).toEqual({ x: 2, z: 2.5 });
  });
  it('moves a point inside the bed out of it, to the nearest free spot', () => {
    const p = nearestFree(furnished, 1.0, 2.25, R)!;
    expect(p).not.toBeNull();
    expect(circleFree(furnished, p.x, p.z, R)).toBe(true);
    // nearest exit from the middle of the bed (x 0..2, z 1.5..3.0) is the +z or -z side or +x end; at most ~0.97 away
    expect(Math.hypot(p.x - 1.0, p.z - 2.25)).toBeLessThan(1.1);
  });
  it('is no farther than a brute-force search', () => {
    const rnd = mulberry32(3);
    for (let n = 0; n < 40; n++) {
      const x = 0.3 + rnd() * 3.4;
      const z = 0.3 + rnd() * 4.4;
      const got = nearestFree(furnished, x, z, R, 3);
      let best = Infinity;
      for (let j = -60; j <= 60; j++) for (let i = -60; i <= 60; i++) {
        const px = x + i * 0.05;
        const pz = z + j * 0.05;
        if (circleFree(furnished, px, pz, R)) best = Math.min(best, Math.hypot(px - x, pz - z));
      }
      if (best <= 3) expect(Math.hypot(got!.x - x, got!.z - z)).toBeLessThanOrEqual(best + 1e-9);
    }
  });
  it('returns null when nothing is free within maxM', () => {
    expect(nearestFree(empty, 50, 50, R, 1)).toBeNull();
  });
});

describe('clearance', () => {
  it('measures the true distance to the wall, not a multiple of the 2.5 cm step', () => {
    expect(clearance(empty, { x: 2, z: 2.5 }, { x: 1, z: 0 })).toBeCloseTo(2.0, 3);
    expect(clearance(empty, { x: 2.013, z: 2.5 }, { x: 1, z: 0 })).toBeCloseTo(1.987, 3);
    expect(clearance(empty, { x: 3.3, z: 2.5 }, { x: 0, z: -1 })).toBeCloseTo(2.5, 3);
  });
  it('returns maxM when nothing blocks and 0 when the origin is blocked', () => {
    expect(clearance(empty, { x: 2, z: 2.5 }, { x: 1, z: 0 }, 1.0)).toBe(1.0);
    expect(clearance(empty, { x: 4.05, z: 2.5 }, { x: 1, z: 0 })).toBe(0);
  });
  it('treats void as blocked', () => {
    const g = createGrid(0, 0, 20, 20, GRID_VOID);
    g.cells.fill(GRID_FREE, 0, 20 * 10);
    expect(clearance(g, { x: 0.5, z: 0.25 }, { x: 0, z: 1 })).toBeCloseTo(0.25, 3);
  });
});

describe('boomDistance (acceptance)', () => {
  it('stops 0.20 short of the east wall: pivot (2, 1.5, 2.5) toward +x returns 2.0 - 0.20 within 0.06', () => {
    const d = boomDistance(empty, { x: 2, y: 1.5, z: 2.5 }, { x: 1, y: 0, z: 0 }, 3, 2.6);
    console.log('boom to east wall =', d.toFixed(4));
    expect(Math.abs(d - 1.8)).toBeLessThan(0.06);
  });
  it('passes over the furnished bed at y 1.5 and is stopped by it at y 0.4', () => {
    const over = boomDistance(furnished, { x: 2.5, y: 1.5, z: 2.25 }, { x: -1, y: 0, z: 0 }, 3, 2.6);
    const low = boomDistance(furnished, { x: 2.5, y: 0.4, z: 2.25 }, { x: -1, y: 0, z: 0 }, 3, 2.6);
    console.log('boom over bed =', over.toFixed(4), ' at 0.4 m =', low.toFixed(4));
    expect(over).toBeGreaterThan(2.0);
    expect(low).toBeLessThan(0.5);
  });
  it('returns maxDist when nothing blocks, and never blocks on void', () => {
    expect(boomDistance(empty, { x: 2, y: 1.5, z: 2.5 }, { x: 1, y: 0, z: 0 }, 1.0, 2.6)).toBe(1.0);
    // outside the flat (void) at mid height
    expect(boomDistance(empty, { x: 2, y: 1.5, z: 9 }, { x: 1, y: 0, z: 0 }, 2.0, 2.6)).toBe(2.0);
  });
  it('is stopped by the ceiling and the floor margins', () => {
    // straight up from 1.5 m with a 2.6 m ceiling: blocks above 2.45, i.e. after about 0.95 m, minus 0.2
    expect(boomDistance(empty, { x: 2, y: 1.5, z: 2.5 }, { x: 0, y: 1, z: 0 }, 3, 2.6)).toBeCloseTo(0.95 - 0.2, 1);
    // straight down: blocks below 0.15
    expect(boomDistance(empty, { x: 2, y: 1.5, z: 2.5 }, { x: 0, y: -1, z: 0 }, 3, 2.6)).toBeCloseTo(1.35 - 0.2, 1);
  });
  it('lower cells block only below their top plus 15 cm (railing 1.10 m)', () => {
    const above = boomDistance(empty, { x: 2, y: 1.4, z: -0.8 }, { x: 0, y: 0, z: -1 }, 3, 2.6);
    const below = boomDistance(empty, { x: 2, y: 1.0, z: -0.8 }, { x: 0, y: 0, z: -1 }, 3, 2.6);
    expect(above).toBe(3);
    expect(below).toBeLessThan(1.0);
  });
  it('returns 0 when the pivot is already against a wall', () => {
    expect(boomDistance(empty, { x: 3.95, y: 1.5, z: 2.5 }, { x: 1, y: 0, z: 0 }, 3, 2.6)).toBe(0);
  });
});
