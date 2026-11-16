// The clubhouse level's scale (SPEC 20): the 25 m lap pool is the only drawn dimension, everything else is scaled from it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unionOutline } from '../src/outdoor/outline';
import * as P from '../scripts/building/podium-plan';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('the scale: the 25 m lap pool is the only drawn dimension', () => {
  it('anchors the scale: 25 m is the lap pool\'s long edge in pixels', () => {
    expect(P.ANCHOR.printedM).toBe(25);
    expect(P.PX_PER_M).toBeCloseTo((P.ANCHOR.toPx - P.ANCHOR.fromPx) / 25, 9);
    const lap = P.WATER_PX.lap;
    expect(P.lenM(lap[3] - lap[1])).toBeCloseTo(25, 2);
    expect(lap[1]).toBe(P.ANCHOR.fromPx);
    expect(lap[3]).toBe(P.ANCHOR.toPx);
  });
  it('the data file says every size is scaled from the drawing, not measured, and imports nothing', () => {
    const text = fs.readFileSync(path.join(ROOT, 'scripts/building/podium-plan.ts'), 'utf8');
    expect(text).toMatch(/SCALED FROM THE DRAWING, NOT MEASURED/);
    expect(text).toMatch(/only drawn dimension/i);
    expect(text).not.toMatch(/^import /m);
  });
});

describe('unionOutline (the shape of a deck hole round basins that touch)', () => {
  it('one rectangle is its four corners; two that touch along an edge are one L of six corners; a ring leaves a hole', () => {
    expect(unionOutline([{ x0: 0, z0: 0, x1: 2, z1: 1 }])).toEqual([[{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 0, z: 1 }]]);
    const l = unionOutline([{ x0: 0, z0: 0, x1: 2, z1: 1 }, { x0: 0, z0: 1, x1: 1, z1: 3 }]);
    expect(l).toHaveLength(1);
    expect(l[0]).toHaveLength(6);
    const ring = unionOutline([{ x0: 0, z0: 0, x1: 3, z1: 1 }, { x0: 0, z0: 2, x1: 3, z1: 3 }, { x0: 0, z0: 1, x1: 1, z1: 2 }, { x0: 2, z0: 1, x1: 3, z1: 2 }]);
    expect(ring).toHaveLength(2);
  });
});
