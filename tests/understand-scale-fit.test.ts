// C12b: the robust scale fit (SPEC 17.5 "Scale") and its leave-one-out use. Pure; always runs.
import { describe, expect, it } from 'vitest';
import { fitExcluding, fitModels, fitScale, tolFor } from '../src/understand/scale-fit';
import type { Pair } from '../src/understand/scale-fit';

const S = 37.3;
const pair = (id: string, valueM: number, group = id, noise = 1): Pair => ({ id, valueM, lenPt: valueM * S * noise, group, source: 'dimension' });
const GOOD: Pair[] = [pair('a', 3.66, 'c1'), pair('b', 2.74, 'c1'), pair('c', 1.52, 'c1'), pair('d', 8.0, 'o'), pair('e', 2.4, 'v'), pair('f', 4.2, 'w')];

describe('fitScale', () => {
  it('recovers the scale to within 0.5% from a handful of dimensions', () => {
    const f = fitScale(GOOD)!;
    expect(Math.abs(f.ptPerM / S - 1)).toBeLessThan(0.005);
    expect(f.inliers.length).toBe(6);
    expect(f.notToScale).toBe(false);
  });
  it('is not fooled by a wrong string or two', () => {
    const f = fitScale([...GOOD, pair('x', 3.0, 'x', 1.25), pair('y', 1.0, 'y', 0.7)])!;
    expect(Math.abs(f.ptPerM / S - 1)).toBeLessThan(0.005);
    expect(f.inliers).not.toContain('x');
    expect(f.inliers).not.toContain('y');
  });
  it('wants three inliers of at least two distinct values on at least two lines', () => {
    expect(fitScale([pair('a', 3.66, 'c1'), pair('b', 2.74, 'c1')])).toBeNull();
    expect(fitScale([pair('a', 2.0, 'c1'), pair('b', 2.0, 'c1'), pair('c', 2.0, 'c1')])).toBeNull(); // three repeats of one value on one line
    expect(fitScale([pair('a', 3.66, 'c1'), pair('b', 2.74, 'c2'), pair('c', 1.52, 'c3')])).not.toBeNull();
  });
  it('declines a handful of short dimensions: one inch of slack on each pins nothing', () => {
    expect(fitScale([pair('a', 0.23, 'a'), pair('b', 0.115, 'b'), pair('c', 0.3, 'c'), pair('d', 0.12, 'd')])).toBeNull();
  });
  it('flags a drawing where fewer than 80% of the dimensions agree as not to scale', () => {
    const odd = [pair('a', 3.66, 'c1'), pair('b', 2.74, 'c2'), pair('c', 5.5, 'c3'), pair('d', 4.0, 'c4', 1.12), pair('e', 3.2, 'c5', 1.2), pair('f', 6.0, 'c6', 0.85), pair('g', 2.1, 'c7', 1.3)];
    expect(fitScale(odd)!.notToScale).toBe(true);
  });
});

describe('leave one out', () => {
  it('a dimension is checked against the scale the others give, never one it helped make', () => {
    const wrong = pair('w', 3.0, 'w', 1.3);
    const all = [...GOOD, wrong];
    const loo = fitExcluding(all, new Set(['w']))!;
    expect(Math.abs(wrong.lenPt / loo.ptPerM - wrong.valueM)).toBeGreaterThan(tolFor(wrong.valueM));
    // and with only three others there is no independent scale for it
    expect(fitExcluding([pair('a', 3.66, 'c1'), pair('b', 2.74, 'c2'), pair('w', 3.0, 'w', 1.3)], new Set(['w']))).toBeNull();
  });
});

describe('fitModels', () => {
  it('a sheet drawn at two scales gives two models', () => {
    const second: Pair[] = [2.4, 3.0, 1.2, 0.9].map((v, i) => ({ id: `e${i}`, valueM: v, lenPt: v * 96, group: `g${i}`, source: 'dimension' as const }));
    const m = fitModels([...GOOD, ...second]);
    expect(m.length).toBe(2);
    expect(Math.abs(m[0].fit.ptPerM / S - 1)).toBeLessThan(0.01);
    expect(Math.abs(m[1].fit.ptPerM / 96 - 1)).toBeLessThan(0.01);
  });
});
