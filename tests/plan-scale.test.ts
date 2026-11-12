import { describe, expect, it } from 'vitest';
import { buildPlan, buildTruthProperty } from '../scripts/make-test-room';
import { mulberry32, polygonArea } from '../src/core/geometry';
import { pxToWorld, scaleFromDimensions, worldToPx } from '../src/core/plan-scale';
import { parseLength } from '../src/core/units';

const { truth } = buildPlan();

describe('scaleFromDimensions', () => {
  it('the two truth dimension lines with typed labels give 53 px/m within 0.6%, disagreement under 1%', () => {
    const dims = truth.dimensions.map((d) => ({ a: d.a, b: d.b, lengthM: parseLength(d.label)! }));
    expect(dims.map((d) => d.lengthM)).toEqual([expect.closeTo(3.9878, 3), expect.closeTo(5.0038, 3)]);
    const s = scaleFromDimensions(dims);
    expect(Math.abs(s.pxPerM - 53) / 53).toBeLessThan(0.006);
    expect(s.disagreementPct).toBeLessThan(1);
  });
  it('one dimension has disagreement 0; mean and spread follow the definition', () => {
    expect(scaleFromDimensions([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, lengthM: 2 }])).toEqual({ pxPerM: 50, disagreementPct: 0 });
    const s = scaleFromDimensions([
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, lengthM: 2 },   // 50
      { a: { x: 0, y: 0 }, b: { x: 0, y: 108 }, lengthM: 2 },   // 54
    ]);
    expect(s.pxPerM).toBe(52);
    expect(s.disagreementPct).toBeCloseTo((4 / 52) * 100, 9);
  });
});

describe('pxToWorld / worldToPx', () => {
  const u = { pxPerM: 53, originPx: { x: 182, y: 285.5 } };
  it('follow 3.1 and round-trip', () => {
    expect(pxToWorld({ x: 182 + 53, y: 285.5 - 106 }, u)).toEqual({ x: 1, z: -2 });
    const p = worldToPx({ x: 1.5, z: 2.25 }, u);
    expect(p).toEqual({ x: 182 + 79.5, y: 285.5 + 119.25 });
    const w = pxToWorld(p, u);
    expect(w.x).toBeCloseTo(1.5, 9);
    expect(w.z).toBeCloseTo(2.25, 9);
  });
});

describe('plan tracing, headless', () => {
  it('rooms from jittered (+-1.5 px) corners have areas within 2% / 5% / 6% of truth', () => {
    const dims = truth.dimensions.map((d) => ({ a: d.a, b: d.b, lengthM: parseLength(d.label)! }));
    const { pxPerM } = scaleFromDimensions(dims);
    const origin = buildTruthProperty('empty').layout.underlay!.originPx;
    const rnd = mulberry32(1234);
    const tol: Record<string, number> = { bedroom: 0.02, balcony: 0.05, passage: 0.06 };
    for (const r of truth.rooms) {
      const poly = r.cornersPx.map((c) => pxToWorld({ x: c.x + (rnd() * 2 - 1) * 1.5, y: c.y + (rnd() * 2 - 1) * 1.5 }, { pxPerM, originPx: origin }));
      const a = polygonArea(poly);
      expect(Math.abs(a - r.areaM2) / r.areaM2).toBeLessThan(tol[r.id]);
    }
  });
});
