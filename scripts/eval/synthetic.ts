// C12a: a generated set as an EvalSet for the harness.
import { buildSet as build } from '../make-drawing-sets';
import { vectorPagesOf } from '../make-drawing-sets';
import type { EvalSet } from './run';
import type { TruthLite } from './types';

export const rasterDims = (w: number, h: number, dpi: number): { width: number; height: number } => ({ width: Math.round((w * dpi) / 72), height: Math.round((h * dpi) / 72) });

export function buildSet(seed: number): { set: EvalSet } {
  const b = build(seed);
  const t = b.truth;
  const set: EvalSet = {
    id: t.id, split: t.split, firm: t.firm, origin: 'synthetic', truth: t as unknown as TruthLite,
    vector: () => vectorPagesOf(b),
    raster: { pageCount: t.page.pages, ...rasterDims(t.page.widthPt, t.page.heightPt, t.options.raster.dpi) },
  };
  return { set };
}
