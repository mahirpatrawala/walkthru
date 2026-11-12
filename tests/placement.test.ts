import { describe, expect, it } from 'vitest';
import { truthGrid } from '../scripts/make-test-room';
import { boxAxes, sideEdge } from '../src/core/geometry';
import { catalogItem } from '../src/core/catalog';
import { checkPlacement, placementMessage, snapToWalls } from '../src/core/placement';
import type { Box } from '../src/types';

const empty = truthGrid('empty');
const king = catalogItem('bed-king');
const kingBox: Box = { cx: 1.06, cz: 3.415, w: 1.93, d: 2.08, yawDeg: 90 };

describe('checkPlacement (acceptance)', () => {
  it('king bed head on the west wall fits, with the measured clearances and the exact message', () => {
    const r = checkPlacement(empty, king, kingBox, 2.6);
    console.log('king bed clearances', JSON.stringify(r.clearanceM), r.message);
    expect(r.verdict).toBe('fits');
    expect(r.reason).toBe('ok');
    expect(r.tone).toBe('good');
    expect(Math.abs(r.clearanceM.left - 0.62)).toBeLessThan(0.06);
    expect(Math.abs(r.clearanceM.right - 2.45)).toBeLessThan(0.06);
    expect(Math.abs(r.clearanceM.front - 1.9)).toBeLessThan(0.06);
    expect(r.clearanceM.back).toBeLessThan(0.06);
    expect(r.message).toBe('King bed fits. 62 cm walking space on the left.');
  });

  it('at cz = 4.3 the bed overlaps the passage wall: blocked / collides', () => {
    const r = checkPlacement(empty, king, { ...kingBox, cz: 4.3 }, 2.6);
    expect(r.verdict).toBe('blocked');
    expect(r.reason).toBe('collides');
    expect(r.tone).toBe('bad');
    expect(r.message).toBe('King bed does not fit here.');
    // clearances are still computed when blocked (here the left ray starts in the passage, so it reads about a metre)
    expect(r.clearanceM.left).toBeGreaterThan(0.9);
    expect(r.clearanceM.right).toBeGreaterThan(1.0);
  });

  it('at cz = 3.9 (left 0.135) it still fits, because the right side is wide open', () => {
    const r = checkPlacement(empty, king, { ...kingBox, cz: 3.9 }, 2.6);
    expect(Math.abs(r.clearanceM.left - 0.135)).toBeLessThan(0.02);
    expect(r.verdict).toBe('fits');
  });

  it('a single bed across the passage is tight: both sides under 0.60', () => {
    const r = checkPlacement(empty, catalogItem('bed-single'), { cx: 2, cz: 5.72, w: 1.01, d: 1.93, yawDeg: 90 }, 2.6);
    console.log('single bed in passage', JSON.stringify(r.clearanceM), r.message);
    expect(r.verdict).toBe('tight');
    expect(r.reason).toBe('access');
    expect(r.tone).toBe('warn');
    expect(r.message.startsWith('Single bed fits, but it is tight. ')).toBe(true);
    expect(r.clearanceM.left).toBeLessThan(0.6);
    expect(r.clearanceM.right).toBeLessThan(0.6);
  });

  it('a wardrobe under a 2.0 m ceiling is blocked / too-tall with the exact message', () => {
    const r = checkPlacement(empty, catalogItem('wardrobe-2'), { cx: 2, cz: 2.5, w: 1.2, d: 0.6, yawDeg: 0 }, 2.0);
    expect(r.verdict).toBe('blocked');
    expect(r.reason).toBe('too-tall');
    expect(r.message).toBe('2-door wardrobe is too tall for this ceiling (2.0 m).');
  });

  it('too-tall wins over a collision; outside beats collides', () => {
    const tall = checkPlacement(empty, catalogItem('wardrobe-2'), { cx: 2, cz: 5.0, w: 1.2, d: 0.6, yawDeg: 0 }, 2.0);
    expect(tall.reason).toBe('too-tall');
    // a box hanging off the north of the flat, over void
    const out = checkPlacement(empty, king, { cx: 2, cz: -1.0, w: 1.93, d: 2.08, yawDeg: 0 }, 2.6);
    expect(out.reason).toBe('outside');
  });

  it('a box beyond the grid is outside', () => {
    const r = checkPlacement(empty, king, { cx: 50, cz: 50, w: 1.93, d: 2.08, yawDeg: 0 }, 2.6);
    expect(r.reason).toBe('outside');
  });

  it('ceiling text keeps 2 decimals when needed', () => {
    const r = checkPlacement(empty, catalogItem('wardrobe-2'), { cx: 2, cz: 2.5, w: 1.2, d: 0.6, yawDeg: 0 }, 2.1);
    expect(r.message).toBe('2-door wardrobe is too tall for this ceiling (2.1 m).');
    const r2 = checkPlacement(empty, catalogItem('wardrobe-2'), { cx: 2, cz: 2.5, w: 1.2, d: 0.6, yawDeg: 0 }, 2.115);
    expect(r2.message).toContain('(2.12 m)');
  });
});

describe('placementMessage', () => {
  const base = { verdict: 'fits' as const, reason: 'ok' as const, tone: 'good' as const };
  const clr = (front: number, back: number, left: number, right: number) => ({ front, back, left, right });
  it('says "Plenty of space around it" when every side is 1.5 m or more', () => {
    expect(placementMessage(king, { ...base, clearanceM: clr(3, 0, 2, 1.5) }, 2.6)).toBe('King bed fits. Plenty of space around it.');
  });
  it('lists up to two sides, smallest first, never the back', () => {
    const m = placementMessage(king, { ...base, clearanceM: clr(0.9, 0.1, 0.5, 1.2) }, 2.6);
    expect(m).toBe('King bed fits. 50 cm walking space on the left and 90 cm at the foot.');
    const tight = placementMessage(king, { ...base, verdict: 'tight', reason: 'access', tone: 'warn', clearanceM: clr(2, 0, 0.3, 0.4) }, 2.6);
    expect(tight).toBe('King bed fits, but it is tight. 30 cm walking space on the left and 40 cm on the right.');
  });
  it('uses the spec side words of the item', () => {
    const sofa = catalogItem('sofa-3');
    expect(placementMessage(sofa, { ...base, clearanceM: clr(1.0, 0, 3, 3) }, 2.6)).toBe('3-seat sofa fits. 100 cm walking space in front.');
  });
});

describe('snapToWalls (acceptance)', () => {
  /** angle (deg) between the box's back edge and the wall x = 0, and the gap from the wall */
  function wallStats(box: Box): { angleDeg: number; gap: number } {
    const e = sideEdge(box, 'back');
    const { b } = boxAxes(box);
    const angleDeg = (Math.asin(Math.max(-1, Math.min(1, b.x))) * 180) / Math.PI; // b.x = 0 when the edge is parallel to x = 0
    return { angleDeg, gap: e.mid.x };
  }
  it('squares up a king bed 0.20 m off the west wall and rotated 8 degrees', () => {
    for (const rot of [8, -8]) {
      const start: Box = { cx: 0.2 + 1.04, cz: 3.0, w: 1.93, d: 2.08, yawDeg: 90 + rot };
      const out = snapToWalls(empty, start);
      const s = wallStats(out);
      console.log('snap rot', rot, 'angle', s.angleDeg.toFixed(3), 'gap', s.gap.toFixed(4));
      expect(Math.abs(s.angleDeg)).toBeLessThan(1.5);
      expect(Math.abs(s.gap - 0.02)).toBeLessThan(0.03);
    }
  });
  it('pulls a box that is 0.30 m off the wall and square to the wall to 0.02 m', () => {
    const out = snapToWalls(empty, { cx: 0.3 + 1.04, cz: 3.0, w: 1.93, d: 2.08, yawDeg: 90 });
    expect(Math.abs(out.cx - (0.02 + 1.04))).toBeLessThan(0.005);
    expect(out.yawDeg).toBeCloseTo(90, 6);
  });
  it('leaves a box in the open alone (no wall within 0.40 m behind it)', () => {
    const box: Box = { cx: 2, cz: 2.5, w: 1.0, d: 1.0, yawDeg: 0 };
    expect(snapToWalls(empty, box)).toEqual(box);
  });
  it('does not rotate by more than 20 degrees', () => {
    const start: Box = { cx: 0.2 + 1.04, cz: 3.0, w: 1.93, d: 2.08, yawDeg: 90 + 40 };
    const out = snapToWalls(empty, start);
    expect(out.yawDeg).toBeCloseTo(130, 6);
  });
  it('pulls toward a side wall that is closer than 0.25 m', () => {
    // wardrobe with its back on the south wall of the bedroom (z = 5) and 0.20 m from the east wall (x = 4)
    const start: Box = { cx: 3.2, cz: 4.65, w: 1.2, d: 0.6, yawDeg: 180 };
    const out = snapToWalls(empty, start);
    console.log('side pull', JSON.stringify(out));
    expect(Math.abs(out.cx - 3.38)).toBeLessThan(0.01); // right edge 0.02 from the east wall
    expect(Math.abs(out.cz - 4.68)).toBeLessThan(0.01); // back edge 0.02 from the south wall
    expect(out.yawDeg).toBeCloseTo(180, 4);
  });
  it('returns the original box when the snapped result would overlap', () => {
    // a box overlapping the sliding-opening wall corner region: squeeze a deep box between wall and wall
    const start: Box = { cx: 2, cz: 0.3, w: 5.0, d: 0.5, yawDeg: 0 };
    const out = snapToWalls(empty, start);
    expect(out).toEqual(start);
  });
});
