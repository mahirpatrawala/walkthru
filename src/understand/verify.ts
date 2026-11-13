// C12b. SPEC 17.1 and 17.5 "The checks": the only place a value becomes `verified`. A text read is verified when it passes at
// least one independent check and fails none. The checks are geometry (the string against the dimension's measured length at a
// scale fitted WITHOUT that dimension), chain (members sum to the overall), cross-sheet and label area. A read that fails
// geometry is a `conflict` with both numbers kept; a read with nothing to check it against stays `unverified`.
// The honesty bar (verified values that are wrong at most 0.5%) outranks coverage: every threshold here errs toward conflict.
import type { Check, Extracted, SourceRef, Status } from './types';
import type { DimLine } from './dimensions';
import { fitExcluding, fitModels, IN_M, tolFor } from './scale-fit';
import type { Pair, ScaleFit } from './scale-fit';

/**
 * Fraction of the spec's tolerance (2% or 1 inch) a measurement must stay inside to count as agreeing. A string off by exactly
 * the tolerance is as likely wrong as right once the scale itself is an estimate, so the verified band is the inner 40% of it;
 * the rest is a conflict the broker sees. The honesty bar outranks coverage (SPEC 17.11).
 */
const MARGIN = 0.4;
/** On a long dimension 2% is a foot of slack: no string is verified more than this far (2.5 in) from the drawn length, whatever 2% allows. */
const CAP_M = 0.0635;
export const verifyBand = (valueM: number): number => MARGIN * Math.min(tolFor(valueM), CAP_M);
/** Dimensions read in an unconfirmed glyph cluster need this many agreeing others to produce a scale, and each cluster this many lines. */
const TENTATIVE_INLIERS = 5;
export const CLUSTER_LINES = 3;

export interface DimVerdict {
  dim: DimLine;
  /** value read, metres */ valueM: number;
  /** length measured on the page at the independent scale, metres (null when there is no scale) */ measuredM: number | null;
  status: Status;
  method: 'pdf-text' | 'glyph' | 'ocr';
  confidence: number;
  checks: Check[];
  message?: string;
  /** which scale model of the page the dimension was judged against (-1: none) */
  model: number;
}
export interface ModelInfo {
  fit: ScaleFit;
  /** where its dimensions sit: page units, y down */ region: [number, number, number, number];
  /** fewer than 80% of the dimensions in its region agree with it */ notToScale: boolean;
  /** the model the plan's own room labels agreed with */ hasLabels: boolean;
}
export interface PageVerdict { page: number; models: ModelInfo[]; verdicts: DimVerdict[] }

const methodOf = (d: DimLine): DimVerdict['method'] => (d.run.parts.every((p) => p.method === 'pdf-text') ? 'pdf-text' : d.run.parts.some((p) => p.method === 'ocr') ? 'ocr' : 'glyph');
const tentativeIn = (d: DimLine): boolean => d.run.parts.some((p) => p.tentative);
const mid = (d: DimLine): [number, number] => [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];

export interface VerifyInput {
  dims: DimLine[];
  /** pairs from outside the dimension lines (room label sizes against traced rooms), for the page that holds the plan */
  extra?: (page: number) => Pair[];
  /** the longer side of each page, page units (how near is near) */
  pageSize?: (page: number) => number;
}

const inside = (p: [number, number], r: [number, number, number, number], pad: number): boolean => p[0] >= r[0] - pad && p[0] <= r[2] + pad && p[1] >= r[1] - pad && p[1] <= r[3] + pad;

export function verifyDimensions(input: VerifyInput): PageVerdict[] {
  const pages = [...new Set(input.dims.map((d) => d.page))].sort((a, b) => a - b);
  const out: PageVerdict[] = [];
  for (const page of pages) {
    const dims = input.dims.filter((d) => d.page === page);
    const pad = 0.08 * (input.pageSize ? input.pageSize(page) : 842);
    const pairOf = (d: DimLine): Pair => ({ id: d.id, lenPt: d.lengthPt, valueM: d.run.parsed.m, group: d.chain ? `${d.chain}` : d.id, source: 'dimension' });
    const extra = input.extra ? input.extra(page) : [];
    const solid = dims.filter((d) => !tentativeIn(d));
    // models: scales that several dimensions agree on (clean reads first; a page read only in an unconfirmed hand needs more agreement)
    let models = fitModels([...solid.map(pairOf), ...extra], 3);
    const tentative = dims.filter(tentativeIn);
    if (tentative.length) models = [...models, ...fitModels(tentative.map(pairOf), TENTATIVE_INLIERS).filter((m) => !models.some((o) => Math.abs(o.fit.ptPerM / m.fit.ptPerM - 1) < 0.02))];
    const byId = new Map(dims.map((d) => [d.id, d]));
    const regionOf = (m: { pairs: Pair[] }): [number, number, number, number] => {
      const pts = m.pairs.map((p) => byId.get(p.id)).filter((d): d is DimLine => !!d).flatMap((d) => [d.a, d.b]);
      if (!pts.length) return [0, 0, 0, 0];
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    };
    const infos: (ModelInfo & { pairs: Pair[]; minInl: number })[] = models.map((m) => {
      const region = regionOf(m);
      const near = dims.filter((d) => inside(mid(d), region, pad));
      const ids = new Set(m.pairs.map((p) => p.id));
      const agree = near.filter((d) => ids.has(d.id)).length;
      return { fit: m.fit, region, notToScale: near.length > 0 && agree / near.length < 0.8, hasLabels: m.pairs.some((p) => p.source === 'label'), pairs: m.pairs, minInl: m.pairs.every((p) => solid.some((d) => d.id === p.id) || p.source === 'label') ? 3 : TENTATIVE_INLIERS };
    });
    const verdicts: DimVerdict[] = [];
    for (const d of dims) {
      // the model this dimension belongs to: the one it is an inlier of, else the one whose region it sits in
      let k = infos.findIndex((m) => m.pairs.some((p) => p.id === d.id));
      let fit: ScaleFit | null = null;
      if (k >= 0) {
        const m = infos[k];
        fit = fitExcluding(m.pairs, new Set([d.id]), m.minInl);
        if (!fit) { /* the model needs this dimension to exist: no independent check */ }
      } else {
        k = infos.findIndex((m) => inside(mid(d), m.region, pad));
        if (k >= 0) fit = infos[k].fit;
      }
      const info = k >= 0 ? infos[k] : null;
      verdicts.push(judge(d, fit && info && !info.notToScale ? fit : null, k));
    }
    chainChecks(dims, verdicts);
    confirmClusters(dims, verdicts);
    out.push({ page, models: infos.map((m) => ({ fit: m.fit, region: m.region, notToScale: m.notToScale, hasLabels: m.hasLabels })), verdicts });
  }
  return out;
}

function judge(d: DimLine, fit: ScaleFit | null, model: number): DimVerdict {
  const value = d.run.parsed.m;
  // lettering left unread against the string: the read may be the front of a longer one (4' for 4'-6"), so no geometry check can speak for it
  if (d.incomplete) return { dim: d, valueM: value, measuredM: null, status: 'unverified', method: methodOf(d), confidence: 0.4, checks: [], message: 'there is lettering beside this string that was not read', model };
  const method = methodOf(d);
  const v: DimVerdict = { dim: d, valueM: value, measuredM: null, status: 'unverified', method, confidence: 0.4, checks: [], model };
  // a drawing that is not to scale has no geometry check (the caller passes null then)
  if (fit) {
    const got = d.lengthPt / fit.ptPerM;
    v.measuredM = got;
    // The scale is itself an estimate. A string verified at `tight` from the measured length is within the spec tolerance of the true
    // length only if `tight` plus the scale's uncertainty on this length fits inside it; where it does not, nothing is claimed.
    const tolH = tolFor(value);
    const delta = Math.max(1 / Math.sqrt(Math.max(fit.weight, 1)), fit.spread / 2);
    const tight = Math.min(verifyBand(value), tolH - 1.5 * delta * value);
    if (tight < 0.25 * tolH) { v.message = 'the scale is not tight enough to check this length'; return v; }
    const ok = Math.abs(got - value) <= tight;
    v.checks.push({ kind: 'geometry', expected: value, got, ok });
    if (ok) { v.status = 'verified'; v.confidence = method === 'pdf-text' ? 0.99 : 0.95; }
    else { v.status = 'conflict'; v.confidence = 0.3; v.message = `drawing says ${d.run.str}, measures ${fmtM(got)}`; }
  }
  return v;
}

const fmtM = (m: number): string => {
  const inches = Math.round(m / IN_M);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
};

function chainChecks(dims: DimLine[], verdicts: DimVerdict[]): void {
  const byDim = new Map(verdicts.map((v) => [v.dim.id, v]));
  const chains = new Map<string, DimLine[]>();
  for (const d of dims) if (d.chain) { const a = chains.get(d.chain); if (a) a.push(d); else chains.set(d.chain, [d]); }
  for (const d of dims) {
    if (!d.overall || !d.spans) continue;
    const members = d.spans.map((id) => dims.find((x) => x.id === id)).filter((x): x is DimLine => !!x);
    if (members.length < 2) continue;
    const sum = members.reduce((a, m) => a + m.run.parsed.m, 0);
    // stricter than the spec's inch: two rounded strings can cancel inside an inch, and a chain alone can verify
    const ok = Math.abs(sum - d.run.parsed.m) <= MARGIN * IN_M;
    const all = [d, ...members];
    for (const x of all) {
      const v = byDim.get(x.id)!;
      const own = x === d ? d.run.parsed.m : x.run.parsed.m;
      v.checks.push({ kind: 'chain', expected: d.run.parsed.m, got: sum, ok });
      if (ok) {
        // the strings agree with each other: enough on their own when nothing else was available
        if (v.status === 'unverified') { v.status = 'verified'; v.confidence = v.method === 'pdf-text' ? 0.99 : 0.95; }
      } else if (v.status === 'unverified') {
        v.status = 'conflict'; v.confidence = 0.3;
        v.message = `the chain does not sum: ${fmtM(sum)} against ${d.run.str} (this string: ${x.run.str})`;
      }
      void own;
    }
  }
}

/** A glyph cluster that no clean dimension vouched for must be backed by `CLUSTER_LINES` other lines that pass geometry. */
function confirmClusters(dims: DimLine[], verdicts: DimVerdict[]): void {
  const passing = new Map<number, Set<string>>();
  for (const v of verdicts) {
    if (v.status !== 'verified' || !v.checks.some((c) => c.kind === 'geometry' && c.ok)) continue;
    for (const p of v.dim.run.parts) for (const g of p.glyphs ?? []) if (g.tentative) { let s = passing.get(g.cluster); if (!s) passing.set(g.cluster, (s = new Set())); s.add(v.dim.id); }
  }
  for (const v of verdicts) {
    if (!tentativeIn(v.dim) || v.status !== 'verified') continue;
    const clusters = new Set(v.dim.run.parts.flatMap((p) => (p.glyphs ?? []).filter((g) => g.tentative).map((g) => g.cluster)));
    const backed = [...clusters].every((c) => [...(passing.get(c) ?? [])].filter((id) => id !== v.dim.id).length >= CLUSTER_LINES);
    if (!backed) { v.status = 'unverified'; v.confidence = 0.4; v.message = 'read in a letter shape no other dimension has confirmed'; }
  }
}

// ---------------------------------------------------------------- label checks (rooms)
export const AREA_TOL = 0.03;
/** The labelled area against the traced polygon's area. */
export const labelAreaCheck = (labelM2: number, polyM2: number): Check => ({ kind: 'label-area', expected: labelM2, got: polyM2, ok: Math.abs(polyM2 / labelM2 - 1) <= AREA_TOL * MARGIN });
/** A labelled side against a traced side, within the dimension tolerance. */
export const sideCheck = (labelM: number, tracedM: number): Check => ({ kind: 'geometry', expected: labelM, got: tracedM, ok: Math.abs(tracedM - labelM) <= verifyBand(labelM) });

// ---------------------------------------------------------------- Extracted values
let hashSeed = 0;
const hash = (s: string): string => { let h = 2166136261 ^ hashSeed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** A verdict as an `Extracted<number>` in metres, with its source box and, for a conflict, the measured value as an alternative. */
export function extractDimension(v: DimVerdict, page: number, sheet: string): Extracted<number> {
  const r = v.dim.run;
  const xs = r.parts.flatMap((p) => [p.bbox[0], p.bbox[2]]), ys = r.parts.flatMap((p) => [p.bbox[1], p.bbox[3]]);
  const source: SourceRef = { page, view: `v${v.dim.view}`, sheet, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], text: r.str };
  const e: Extracted<number> = {
    id: `dim-${hash(`${page}:${source.bbox.map((n) => n.toFixed(1)).join(',')}`)}`,
    value: v.valueM, unit: 'm', method: v.method, status: v.status, confidence: v.confidence, source, checks: v.checks,
  };
  if (v.status === 'conflict' && v.measuredM !== null) e.alternatives = [{ value: v.measuredM, method: 'vector', source }];
  return e;
}
