// C12b. SPEC 17.5 "Scale": a robust scale from many dimensions. Every dimension with a parsed read gives a pair (length in page
// units, value in metres). The fit is RANSAC over those pairs: a pair is an inlier when it is within 2% or 1 inch (25.4 mm),
// whichever is larger. It needs at least three inliers that are not all repeats of one value, or it says nothing.
// `fitExcluding` redoes the fit without one dimension, which is how a dimension is checked without voting for itself.
export interface Pair {
  id: string;
  /** length on the page, page units */ lenPt: number;
  /** what the drawing says it is, metres */ valueM: number;
  /** pairs from one drawn line (or one room) count once toward independence */ group: string;
  source: 'dimension' | 'label';
}
export interface ScaleFit {
  ptPerM: number;
  inliers: string[];
  /** pairs considered */ n: number;
  /** relative spread (max - min) / mean of the inliers' implied scales */ spread: number;
  /** distinct values among the inliers (to the inch) */ distinctValues: number;
  /** how tightly the inliers pin the scale: the sum of (value / tolerance)^2; a handful of one-inch-wide short dimensions pins nothing */ weight: number;
  /** share of pairs that are inliers */ inlierShare: number;
  /** the drawing is not to scale: fewer than 80% of the pairs agree */ notToScale: boolean;
}

export const IN_M = 0.0254;
/** about 1.7% scale uncertainty (1 / sqrt(3500)): below this the inliers are too short or too few to say what the scale is */
export const MIN_WEIGHT = 3500;
export const tolFor = (valueM: number): number => Math.max(0.02 * valueM, IN_M);

const near = (p: Pair, s: number): boolean => Math.abs(p.lenPt / s - p.valueM) <= tolFor(p.valueM);

function refine(pairs: Pair[], s0: number): { s: number; inl: Pair[] } {
  let s = s0;
  let inl = pairs.filter((p) => near(p, s));
  for (let it = 0; it < 4 && inl.length; it++) {
    // least squares of length on value through the origin
    let num = 0, den = 0;
    for (const p of inl) { num += p.lenPt * p.valueM; den += p.valueM * p.valueM; }
    const s2 = num / den;
    const next = pairs.filter((p) => near(p, s2));
    s = s2;
    if (next.length === inl.length && next.every((p, i) => p === inl[i])) { inl = next; break; }
    inl = next;
  }
  return { s, inl };
}

/** The scale, or null when there is no agreement among at least three pairs of at least two distinct values. */
export function fitScale(pairs: Pair[], minInliers = 3): ScaleFit | null {
  const usable = pairs.filter((p) => p.lenPt > 0 && p.valueM > 0 && isFinite(p.lenPt) && isFinite(p.valueM));
  if (usable.length < minInliers) return null;
  let best: { s: number; inl: Pair[]; resid: number } | null = null;
  const seen = new Set<number>();
  for (const p of usable) {
    const s0 = p.lenPt / p.valueM;
    const key = Math.round(s0 * 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = refine(usable, s0);
    if (r.inl.length < minInliers) continue;
    const resid = r.inl.reduce((a, q) => a + ((q.lenPt / r.s - q.valueM) / q.valueM) ** 2, 0) / r.inl.length;
    // more inliers first; among equals the tighter fit
    if (!best || r.inl.length > best.inl.length || (r.inl.length === best.inl.length && resid < best.resid)) best = { s: r.s, inl: r.inl, resid };
  }
  if (!best) return null;
  const distinct = new Set(best.inl.map((q) => Math.round(q.valueM / IN_M))).size;
  const groups = new Set(best.inl.map((q) => q.group)).size;
  if (distinct < 2 || groups < 2) return null;
  const sc = best.inl.map((q) => q.lenPt / q.valueM);
  const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  const weight = best.inl.reduce((a, q) => a + (q.valueM / tolFor(q.valueM)) ** 2, 0);
  if (weight < MIN_WEIGHT) return null;
  return {
    ptPerM: best.s, inliers: best.inl.map((q) => q.id), n: usable.length,
    spread: (Math.max(...sc) - Math.min(...sc)) / mean, weight, distinctValues: distinct, inlierShare: best.inl.length / usable.length,
    notToScale: best.inl.length / usable.length < 0.8,
  };
}

/** The fit with some pairs left out (a dimension must not vote for itself). */
export function fitExcluding(pairs: Pair[], ids: Set<string>, minInliers = 3): ScaleFit | null {
  return fitScale(pairs.filter((p) => !ids.has(p.id)), minInliers);
}

export interface Model { fit: ScaleFit; pairs: Pair[] }
/**
 * Sequential RANSAC: the best scale, then the best among the pairs it left over, and so on. A page that holds a plan and an
 * elevation at their own scales gives two models; a stray wrong string belongs to none.
 */
export function fitModels(pairs: Pair[], minInliers = 3, max = 6): Model[] {
  const models: Model[] = [];
  let rest = pairs;
  for (let k = 0; k < max; k++) {
    const fit = fitScale(rest, minInliers);
    if (!fit) break;
    const inl = new Set(fit.inliers);
    models.push({ fit, pairs: rest.filter((p) => inl.has(p.id)) });
    rest = rest.filter((p) => !inl.has(p.id));
    if (rest.length < minInliers) break;
  }
  return models;
}
