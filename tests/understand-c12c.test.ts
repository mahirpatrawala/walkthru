// C12c: line walls (double, hatch), unlabelled rooms, plan symbols and exploded door arcs, on the synthetic drawing sets. No real file.
import { describe, expect, it } from 'vitest';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { Canvas } from '../scripts/drawing-sets/draw';
import { drawSymbol } from '../scripts/drawing-sets/symbols';
import { proposeWithTrace } from '../src/import/propose';
import { findPlanSymbols, joinExplodedArcs, joinStrokes, roomTypeFromSymbols } from '../src/understand/symbols';
import { findDoorArcs } from '../src/import/passage';
import type { VStroke } from '../src/import/types';

const run = (seed: number) => { const b = buildSet(seed); return { b, ...proposeWithTrace(vectorPagesOf(b), 'x', 'y') }; };

describe('walls drawn as lines', () => {
  it('a double-line set and a hatch set find their rooms (they found none before)', () => {
    const d = run(19); expect(d.b.truth.options.wallStyle).toBe('double');
    expect(d.trace.lineWalls?.bands.length ?? 0).toBeGreaterThan(3);
    expect(d.result.proposal.rooms.length).toBe(d.b.truth.rooms.length);
    const h = run(14); expect(h.b.truth.options.wallStyle).toBe('hatch');
    expect(h.trace.lineWalls?.style).toBe('hatch');
    expect(h.result.proposal.rooms.length).toBe(h.b.truth.rooms.length);
  }, 60000);
  it('filled walls are left alone', () => {
    const f = run(4); expect(f.b.truth.options.wallStyle.startsWith('fill')).toBe(true);
    expect(f.trace.lineWalls ?? null).toBeNull();
  }, 60000);
  it('a plan with no room labels still gets its rooms, as unnamed spaces', () => {
    const d = run(16); expect(d.b.truth.options.labelStyle).toBe('none');
    expect(d.result.proposal.rooms.length).toBe(1);
  }, 60000);
});

describe('plan symbols', () => {
  const S = 40;
  const named = (cls: string, variant: number, w: number, d: number): string[] => {
    const cv = new Canvas();
    drawSymbol(cv, (x, z) => [100 + x * S, 100 + z * S], cls as never, variant, { cx: 3, cz: 3, w, d, yawDeg: 0 });
    const strokes = cv.prims.filter((p) => p.t === 'stroke').map((p) => { const q = p as { pts: [number, number][]; closed: boolean; curve?: boolean; width: number }; return { color: '#000', width: q.width, points: q.pts.map(([x, y]) => ({ x, y })), closed: q.closed, hasCurve: !!q.curve } as VStroke; });
    return findPlanSymbols(strokes, S).symbols.map((s) => s.cls);
  };
  it('names furniture by its shape and size in metres, in every drawn variant', () => {
    for (const v of [0, 1, 2]) {
      expect(named('bed', v, 1.5, 1.85)).toEqual(['bed']);
      expect(named('sofa', v, 1.98, 0.91)).toEqual(['sofa']);
      expect(named('wardrobe', v, 2.3, 0.6)).toEqual(['wardrobe']);
      expect(named('wc', v, 0.4, 0.7)).toEqual(['wc']);
      expect(named('shower', v, 0.9, 0.9)).toEqual(['shower']);
      expect(named('hob', v, 0.6, 0.5)).toEqual(['hob']);
    }
  });
  it('a plan with a bed is a bedroom, a hob a kitchen, a WC a bathroom', () => {
    expect(roomTypeFromSymbols(['bed', 'wardrobe'])).toBe('bedroom');
    expect(roomTypeFromSymbols(['hob', 'counter'])).toBe('kitchen');
    expect(roomTypeFromSymbols(['wc', 'basin'])).toBe('bathroom');
    expect(roomTypeFromSymbols([])).toBe('other');
  });
  it('rectangles exploded into four lines are closed again, and an exploded swing arc becomes one arc the door finder reads', () => {
    const line = (a: [number, number], b: [number, number]): VStroke => ({ color: '#000', width: 0.3, points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], closed: false, hasCurve: false });
    const rect = [line([0, 0], [20, 0]), line([20, 0], [20, 10]), line([20, 10], [0, 10]), line([0, 10], [0, 0])];
    const joined = joinStrokes(rect);
    expect(joined.length).toBe(1); expect(joined[0].closed).toBe(true);
    const pieces: VStroke[] = []; const r = 30;
    for (let k = 0; k < 12; k++) { const a0 = (k / 12) * (Math.PI / 2), a1 = ((k + 1) / 12) * (Math.PI / 2); pieces.push(line([100 + r * Math.cos(a0), 100 + r * Math.sin(a0)], [100 + r * Math.cos(a1), 100 + r * Math.sin(a1)])); }
    const one = joinExplodedArcs(pieces);
    expect(one.length).toBe(1); expect(one[0].hasCurve).toBe(true);
    const arcs = findDoorArcs({ index: 0, width: 300, height: 300, fills: [], strokes: one, texts: [], imageCoverage: 0 }, 40, [], 4);
    expect(arcs.length).toBe(1);
  });
});
