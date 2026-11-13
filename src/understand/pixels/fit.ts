// C12d. SPEC 17.5 applied to a picture: fit pixels-per-metre from every (pixel length, printed value) pair, and the checks that
// decide whether a read value may be called `verified`. The same RANSAC idea as the vector path, over pixel lengths measured
// on the cleaned page. A pair is an inlier within the larger of 2% and 1 inch. A value never counts as its own evidence:
// `looFit` refits without it. (C12b's scale-fit.ts is the vector twin; this one is local so the two chunks do not depend on each other.)
/** A dimension line: its pixel length along one image axis and the length printed on it. */
export interface Pair { id: string; /** what to leave out when checking this thing */ owner: string; px: number; m: number; axis: 'x' | 'y'; src: 'dim' }
/** A room label "a x b": the room's drawn size in pixels along x and y, and the two printed lengths in either order. */
export interface LabelPair { id: string; owner: string; wPx: number; hPx: number; a: number; b: number }
export interface Evidence { dims: Pair[]; labels: LabelPair[] }
export interface ScaleFit {
  /** pixels per metre along x and y; equal in 'iso' mode */
  sx: number; sy: number; mode: 'iso' | 'axis';
  /** items (dimension lines and labels) that agree, of all */
  inliers: number; total: number; dimInliers: number;
  /** relative spread of px/m over the inliers */ spread: number;
  /** enough independent items agree */ ok: boolean;
  /** fewer than 80% agree even with one scale per direction: the drawing is not to scale */ notToScale: boolean;
  /** the two directions need different scales (a photo taken at an angle, a scan stretched on one axis, a stretched drawing) */ aniso: boolean;
}
export const REL_TOL = 0.02, ABS_TOL_M = 0.0254;
export const tolM = (m: number, rel = REL_TOL): number => Math.max(rel * Math.abs(m), ABS_TOL_M);

const dimOk = (d: Pair, sx: number, sy: number): boolean => Math.abs(d.px / (d.axis === 'x' ? sx : sy) - d.m) <= tolM(d.m);
/** Which way round the printed lengths fit the drawn sides (0: a on x, 1: b on x), or -1 when neither does. Smaller error wins. */
export function labelFit(l: LabelPair, sx: number, sy: number, rel = REL_TOL): { orient: 0 | 1 | -1; /** the orientation with the smaller error, whether or not it fits */ best: 0 | 1; err: number } {
  const e0 = Math.max(Math.abs(l.wPx / sx - l.a) / l.a, Math.abs(l.hPx / sy - l.b) / l.b), e1 = Math.max(Math.abs(l.wPx / sx - l.b) / l.b, Math.abs(l.hPx / sy - l.a) / l.a);
  const ok = (o: 0 | 1): boolean => {
    const [mx, my] = o === 0 ? [l.a, l.b] : [l.b, l.a];
    return Math.abs(l.wPx / sx - mx) <= tolM(mx, rel) && Math.abs(l.hPx / sy - my) <= tolM(my, rel);
  };
  const o: 0 | 1 = e0 <= e1 ? 0 : 1;
  return { orient: ok(o) ? o : -1, best: o, err: Math.min(e0, e1) };
}
interface Hit { dims: Pair[]; labels: { l: LabelPair; orient: 0 | 1 }[] }
const hitsOf = (e: Evidence, sx: number, sy: number): Hit => {
  const labels: Hit['labels'] = [];
  for (const l of e.labels) { const f = labelFit(l, sx, sy); if (f.orient >= 0) labels.push({ l, orient: f.orient as 0 | 1 }); }
  return { dims: e.dims.filter((d) => dimOk(d, sx, sy)), labels };
};
const weight = (h: Hit): number => h.dims.length + 2 * h.labels.length;
/** Least squares on the agreeing items. Iso: one scale. Axis: one per direction. */
function refine(h: Hit, aniso: boolean, start: [number, number]): [number, number] {
  const acc = { x: [0, 0], y: [0, 0] };
  const put = (axis: 'x' | 'y', px: number, m: number): void => { acc[axis][0] += px * m; acc[axis][1] += m * m; };
  for (const d of h.dims) put(d.axis, d.px, d.m);
  for (const { l, orient } of h.labels) { put('x', l.wPx, orient === 0 ? l.a : l.b); put('y', l.hPx, orient === 0 ? l.b : l.a); }
  if (!aniso) { const n = acc.x[0] + acc.y[0], d = acc.x[1] + acc.y[1]; return d ? [n / d, n / d] : start; }
  return [acc.x[1] ? acc.x[0] / acc.x[1] : start[0], acc.y[1] ? acc.y[0] / acc.y[1] : start[1]];
}
function search(e: Evidence, aniso: boolean): { sx: number; sy: number; hit: Hit } | null {
  const hyps: [number, number][] = [];
  if (!aniso) {
    for (const d of e.dims) { const s = d.px / d.m; hyps.push([s, s]); }
    for (const l of e.labels) for (const [mx, my] of [[l.a, l.b], [l.b, l.a]]) { const s1 = l.wPx / mx, s2 = l.hPx / my; hyps.push([(s1 + s2) / 2, (s1 + s2) / 2]); }
  } else {
    const xs = e.dims.filter((d) => d.axis === 'x'), ys = e.dims.filter((d) => d.axis === 'y');
    for (const x of xs) for (const y of ys) hyps.push([x.px / x.m, y.px / y.m]);
    for (const l of e.labels) for (const [mx, my] of [[l.a, l.b], [l.b, l.a]]) hyps.push([l.wPx / mx, l.hPx / my]);
  }
  let best: { sx: number; sy: number; hit: Hit } | null = null;
  for (const [sx0, sy0] of hyps) {
    if (!(sx0 > 0 && sy0 > 0) || !Number.isFinite(sx0 + sy0)) continue;
    if (aniso && (sx0 / sy0 > 1.6 || sy0 / sx0 > 1.6)) continue;
    let h = hitsOf(e, sx0, sy0), sx = sx0, sy = sy0;
    for (let it = 0; it < 3; it++) { const [rx, ry] = refine(h, aniso, [sx, sy]); const h2 = hitsOf(e, rx, ry); if (weight(h2) < weight(h)) break; sx = rx; sy = ry; h = h2; }
    const better = !best || weight(h) > weight(best.hit) || (weight(h) === weight(best.hit) && h.dims.length > best.hit.dims.length);
    if (better) best = { sx, sy, hit: h };
  }
  return best;
}
function summarise(e: Evidence, r: { sx: number; sy: number; hit: Hit }): { inliers: number; total: number; dimInliers: number; spread: number; ok: boolean } {
  const ratios: number[] = [];
  for (const d of r.hit.dims) ratios.push(d.px / d.m / (d.axis === 'x' ? r.sx : r.sy));
  for (const { l, orient } of r.hit.labels) { ratios.push(l.wPx / (orient === 0 ? l.a : l.b) / r.sx, l.hPx / (orient === 0 ? l.b : l.a) / r.sy); }
  const mean = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
  const spread = ratios.length ? (Math.max(...ratios) - Math.min(...ratios)) / mean : 1;
  const owners = new Set([...r.hit.dims.map((d) => d.owner), ...r.hit.labels.map((x) => x.l.owner)]).size;
  const ms = [...r.hit.dims.map((d) => d.m), ...r.hit.labels.flatMap((x) => [x.l.a, x.l.b])];
  const distinct = ms.length > 0 && (Math.max(...ms) / Math.min(...ms) > 1.1 || new Set(ms.map((m) => Math.round(m * 20))).size >= 3);
  const inl = r.hit.dims.length + r.hit.labels.length;
  return { inliers: inl, total: e.dims.length + e.labels.length, dimInliers: r.hit.dims.length, spread, ok: inl >= 3 && owners >= 3 && distinct };
}

/** The best scale for the evidence: one isotropic scale, or one per direction when the picture is stretched on one axis. */
export function fitScale(e: Evidence): ScaleFit | null {
  const iso = search(e, false);
  if (!iso) return null;
  const si = summarise(e, iso);
  const total = e.dims.length + e.labels.length;
  const weightTotal = e.dims.length + 2 * e.labels.length;
  const fracIso = weight(iso.hit) / (weightTotal || 1);
  const mkIso = (over: Partial<ScaleFit> = {}): ScaleFit => ({ sx: iso.sx, sy: iso.sy, mode: 'iso', ...si, notToScale: false, aniso: false, ...over });
  if (total >= 4 && fracIso < 0.9) {
    const ax = search(e, true);
    if (ax) {
      const sa = summarise(e, ax);
      const fracAx = weight(ax.hit) / (weightTotal || 1);
      if (sa.ok && fracAx > fracIso + 0.05) return { sx: ax.sx, sy: ax.sy, mode: 'axis', ...sa, notToScale: fracAx < 0.8, aniso: true };
    }
    return mkIso({ notToScale: fracIso < 0.8 });
  }
  return mkIso();
}
/** The scale with everything that belongs to `owner` left out. */
export const looFit = (e: Evidence, owner: string): ScaleFit | null => fitScale({ dims: e.dims.filter((p) => p.owner !== owner), labels: e.labels.filter((p) => p.owner !== owner) });

export const scaleFor = (f: ScaleFit, axis: 'x' | 'y' | 'any'): number => (axis === 'y' ? f.sy : axis === 'x' ? f.sx : (f.sx + f.sy) / 2);
/** How far (metres) the pixels can be trusted to say a length: about two pixels at each end of a measured line. */
export const pixelSlackM = (f: ScaleFit, axis: 'x' | 'y' | 'any'): number => 4 / scaleFor(f, axis);
/** A printed value is only called WRONG when it is out by more than both the tolerance and what the pixels can resolve. */
export const clearlyWrong = (px: number, m: number, f: ScaleFit, axis: 'x' | 'y' | 'any', rel = REL_TOL): boolean =>
  Math.abs(px / scaleFor(f, axis) - m) > Math.max(tolM(m, rel), pixelSlackM(f, axis));
/** Does a pixel length read as this many metres on this scale? */
export const agrees = (px: number, m: number, f: ScaleFit, axis: 'x' | 'y' | 'any', rel = REL_TOL): boolean => Math.abs(px / scaleFor(f, axis) - m) <= tolM(m, rel);

// ---------------------------------------------------------------- chains
export interface LineDim { id: string; axis: 'x' | 'y'; lo: number; hi: number; perp: number; m: number | null }
export interface Chain { overall: string; members: string[]; sumM: number; overallM: number; ok: boolean }
/** Runs of dimensions that tile a longer dimension (SPEC 17.5 "Chain"). `tol` is in pixels. */
export function findChains(dims: LineDim[], tol: number): Chain[] {
  const out: Chain[] = [];
  for (const D of dims) {
    if (D.m === null) continue;
    const cand = dims.filter((q) => q.id !== D.id && q.axis === D.axis && q.m !== null && q.lo >= D.lo - tol && q.hi <= D.hi + tol && q.hi - q.lo < D.hi - D.lo - tol);
    if (cand.length < 2) continue;
    const sorted = [...cand].sort((a, b) => a.lo - b.lo);
    // keep one line of members: the offset with the most members that tile the span
    const byPerp = new Map<number, LineDim[]>();
    for (const q of sorted) { const k = Math.round(q.perp / (tol * 2)); (byPerp.get(k) ?? byPerp.set(k, []).get(k)!).push(q); }
    for (const line of byPerp.values()) {
      if (line.length < 2) continue;
      if (Math.abs(line[0].lo - D.lo) > tol || Math.abs(line[line.length - 1].hi - D.hi) > tol) continue;
      let tiles = true;
      for (let i = 1; i < line.length; i++) if (Math.abs(line[i].lo - line[i - 1].hi) > tol) { tiles = false; break; }
      if (!tiles) continue;
      const sum = line.reduce((a, q) => a + (q.m as number), 0);
      out.push({ overall: D.id, members: line.map((q) => q.id), sumM: sum, overallM: D.m, ok: Math.abs(sum - D.m) <= ABS_TOL_M * 1.01 });
    }
  }
  return out;
}
