// C12b. SPEC 17.5 "Dimension lines": find the dimension lines on a page, attach the strings that belong to them, and join them
// into chains and overalls. A dimension is a straight stroke with a terminator at each end (a tick, an arrowhead or a dot),
// usually with extension lines at right angles, and a string within a couple of text heights of its middle, parallel to it.
// The measured length runs between the terminators, not between the line's ends. Pure TypeScript, y-down page units.
import type { VectorPage } from '../import/types';
import type { TextRead } from './reads';
import { isYDown, subRead } from './reads';
import { parseLengthLoose } from './units';
import { numericRepair } from './plausible';
export { numericRepair };
import type { ParsedLength } from './units';

type Pt = [number, number];
const hypot = Math.hypot;
const D2R = Math.PI / 180;

export interface Run { read: TextRead; /** the pieces joined, in order */ parts: TextRead[]; str: string; parsed: ParsedLength; centre: Pt; len: number; angle: number; cap: number }
export type TerminatorKind = 'tick' | 'arrow' | 'dot' | 'extension' | 'none';
export interface DimLine {
  id: string;
  /** measured end points: the anchors, page units, y down */
  a: Pt; b: Pt; lengthPt: number;
  /** direction of a to b, degrees 0 to 180 */ angle: number;
  anchors: [TerminatorKind, TerminatorKind];
  /** the drawn line's own extent along its direction, for reference */ line: { a: Pt; b: Pt };
  run: Run;
  /** how well the string is centred on the line: 0 is dead centre, in units of the string's length */
  centring: number;
  /** page index (set by the caller) */ page: number;
  view: number;
  chain?: string;
  overall?: boolean;
  /** members of the chain this overall spans */ spans?: string[];
  /** unread lettering sits against either end of the string: the read may be a piece of a longer one, so it cannot be verified */
  incomplete?: boolean;
}

interface Seg { i: number; a: Pt; b: Pt; len: number; ang: number; ux: number; uy: number }

function straightSegs(page: VectorPage, maxLen: number): Seg[] {
  const H = page.height; const flip = !isYDown(page);
  const out: Seg[] = [];
  page.strokes.forEach((s, i) => {
    const P = s.points;
    if (P.length < 2 || s.hasCurve) return;
    const a: Pt = [P[0].x, flip ? H - P[0].y : P[0].y], b: Pt = [P[P.length - 1].x, flip ? H - P[P.length - 1].y : P[P.length - 1].y];
    const len = hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5 || len > maxLen) return;
    // a polyline counts as straight when every vertex sits within 0.15 of the chord
    for (let k = 1; k < P.length - 1; k++) {
      const y = flip ? H - P[k].y : P[k].y;
      const d = Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - P[k].x) * (b[1] - a[1])) / len;
      if (d > 0.15) return;
    }
    let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R + 360) % 180;
    if (ang >= 180) ang -= 180;
    out.push({ i, a, b, len, ang, ux: (b[0] - a[0]) / len, uy: (b[1] - a[1]) / len });
  });
  return out;
}

const angDiff = (a: number, b: number): number => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

// ---------------------------------------------------------------- the strings that could be dimensions
const JOIN_GAP = 1.5;
/** Candidate dimension strings: each read alone, each read cut where two strings ran together, and runs of neighbours joined. */
export function lengthRuns(reads: TextRead[], bare: 'auto' | 'm' | 'mm' | 'ft' = 'auto'): Run[] {
  const runs: Run[] = [];
  const mk = (parts: TextRead[], str0: string): void => {
    let str = str0;
    let p = parseLengthLoose(str, bare);
    if (!p) { const fixed = numericRepair(str0); if (fixed !== str0) { p = parseLengthLoose(fixed, bare); if (p) str = fixed; } }
    if (!p) return;
    // a dangling dash or slash is a string cut short (3'- for 3'-0"), not a length
    if (/[-./]\s*$/.test(str)) return;
    const first = parts[0], last = parts[parts.length - 1];
    const r = (first.angle * Math.PI) / 180;
    const u: Pt = [Math.cos(r), Math.sin(r)], dn: Pt = [-Math.sin(r), Math.cos(r)];
    const cap = 0.72 * Math.max(...parts.map((q) => q.size));
    const end: Pt = [last.origin[0] + u[0] * last.length, last.origin[1] + u[1] * last.length];
    const len = (end[0] - first.origin[0]) * u[0] + (end[1] - first.origin[1]) * u[1];
    const mid: Pt = [(first.origin[0] + end[0]) / 2 - dn[0] * cap * 0.5, (first.origin[1] + end[1]) / 2 - dn[1] * cap * 0.5];
    runs.push({ read: first, parts, str, parsed: p, centre: mid, len, angle: first.angle, cap });
  };
  const sorted = [...reads].sort((a, b) => a.angle - b.angle || a.origin[0] - b.origin[0] || a.origin[1] - b.origin[1]);
  for (const r of sorted) {
    mk([r], r.str);
    if (r.glyphs && r.str.length > 2) {
      // `4"8"`: a closing inch mark followed by a digit is where one string ends and the next begins
      for (let k = 1; k < r.str.length - 1; k++) if (r.str[k] === '"' && /\d/.test(r.str[k + 1])) {
        const a = subRead(r, 0, k + 1), b = subRead(r, k + 1, r.str.length);
        if (a && b) { mk([a], a.str); mk([b], b.str); }
      }
    }
  }
  // joins: neighbours on one baseline with a gap no wider than a space or two
  for (let i = 0; i < sorted.length; i++) {
    const A = sorted[i];
    const rA = (A.angle * Math.PI) / 180; const u: Pt = [Math.cos(rA), Math.sin(rA)], dn: Pt = [-Math.sin(rA), Math.cos(rA)];
    const cap = 0.72 * A.size;
    let tail = A; const parts = [A];
    for (let step = 0; step < 3; step++) {
      let next: TextRead | null = null; let bestGap = Infinity;
      for (const B of sorted) {
        if (B === tail || parts.includes(B) || Math.abs(((B.angle - A.angle + 540) % 360) - 180) > 1) continue;
        const dx = B.origin[0] - tail.origin[0], dy = B.origin[1] - tail.origin[1];
        const along = dx * u[0] + dy * u[1] - tail.length, perp = dx * dn[0] + dy * dn[1];
        if (Math.abs(perp) > 0.35 * cap || along < -0.2 * cap || along > JOIN_GAP * cap || Math.abs(B.size - A.size) > 0.3 * A.size) continue;
        if (along < bestGap) { bestGap = along; next = B; }
      }
      if (!next) break;
      parts.push(next); tail = next;
      mk([...parts], parts.map((p) => p.str).join(' '));
    }
  }
  return runs;
}

// ---------------------------------------------------------------- terminators
interface Anchor { kind: TerminatorKind; t: number; dist: number }

interface Ctx { page: VectorPage; segs: Seg[]; fills: { box: [number, number, number, number]; pts: Pt[] }[]; rings: { box: [number, number, number, number]; c: Pt; size: number; closed: boolean }[] }

function buildCtx(page: VectorPage): Ctx {
  const H = page.height; const flip = !isYDown(page);
  const fills = page.fills.filter((f) => f.rings[0] && f.bbox).map((f) => {
    const pts = f.rings[0].map((p) => [p.x, flip ? H - p.y : p.y] as Pt);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number], pts };
  }).filter((f) => Math.max(f.box[2] - f.box[0], f.box[3] - f.box[1]) < 20);
  const rings: Ctx['rings'] = [];
  page.strokes.forEach((s) => {
    if (!s.closed && !(s.points.length > 5 && hypot(s.points[0].x - s.points[s.points.length - 1].x, s.points[0].y - s.points[s.points.length - 1].y) < 0.3)) return;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => (flip ? H - p.y : p.y));
    const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const size = Math.max(box[2] - box[0], box[3] - box[1]);
    if (size < 20) rings.push({ box, c: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], size, closed: true });
  });
  return { page, segs: [], fills, rings };
}

/**
 * Where, along the line (parameter t from a point P0 with unit direction u), the terminator near parameter `t0` sits. `perp` is
 * the line's normal. Searches within `R` of the end.
 */
function findAnchor(ctx: Ctx, P0: Pt, u: Pt, t0: number, R: number, cap: number, ownI: Set<number>, ang: number): Anchor | null {
  const dn: Pt = [-u[1], u[0]];
  const E: Pt = [P0[0] + u[0] * t0, P0[1] + u[1] * t0];
  let best: Anchor | null = null;
  const consider = (k: TerminatorKind, t: number, dist: number): void => { if (!best || dist < best.dist || (rank(k) > rank(best.kind) && dist < best.dist + 0.5 * cap)) best = { kind: k, t, dist }; };
  const rank = (k: TerminatorKind): number => (k === 'tick' || k === 'arrow' || k === 'dot' ? 2 : k === 'extension' ? 1 : 0);
  // strokes: a tick crosses the line, an extension line stops at it or crosses it
  for (const s of ctx.segs) {
    if (ownI.has(s.i)) continue;
    const mid: Pt = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    if (hypot(mid[0] - E[0], mid[1] - E[1]) > R + s.len / 2) continue;
    const da = angDiff(s.ang, ang);
    if (da < 20) continue;
    // intersection of the segment with the infinite line
    const sx = s.b[0] - s.a[0], sy = s.b[1] - s.a[1];
    const den = sx * dn[0] + sy * dn[1];
    if (Math.abs(den) < 1e-9) continue;
    const lam = ((P0[0] - s.a[0]) * dn[0] + (P0[1] - s.a[1]) * dn[1]) / den; // along the segment
    const X: Pt = [s.a[0] + sx * lam, s.a[1] + sy * lam];
    const t = (X[0] - P0[0]) * u[0] + (X[1] - P0[1]) * u[1];
    if (lam >= -0.02 && lam <= 1.02) {
      if (Math.abs(t - t0) > R) continue;
      // crosses the line: a tick when short, an extension line when long
      consider(s.len <= 3.2 * cap ? 'tick' : 'extension', t, Math.abs(t - t0));
    } else if (da > 70) {
      // stops short of the line: an extension line whose near end is within a few text heights
      const nearEnd: Pt = lam < 0 ? s.a : s.b;
      const gap = hypot(nearEnd[0] - X[0], nearEnd[1] - X[1]);
      if (gap <= 2.6 * cap && Math.abs(t - t0) <= R && s.len > 1.2 * cap) consider('extension', t, Math.abs(t - t0) + 0.3 * cap);
    }
  }
  for (const f of ctx.fills) {
    const size = Math.max(f.box[2] - f.box[0], f.box[3] - f.box[1]);
    const c: Pt = [(f.box[0] + f.box[2]) / 2, (f.box[1] + f.box[3]) / 2];
    if (hypot(c[0] - E[0], c[1] - E[1]) > R + size) continue;
    const perp = Math.abs((c[0] - P0[0]) * dn[0] + (c[1] - P0[1]) * dn[1]);
    if (perp > 0.9 * size + 0.3 * cap) continue;
    if (f.pts.length <= 4 && size <= 4 * cap) {
      // an arrowhead: its tip is the vertex that reaches furthest along the line away from the rest
      const ts = f.pts.map((p) => (p[0] - P0[0]) * u[0] + (p[1] - P0[1]) * u[1]);
      const ps = f.pts.map((p) => Math.abs((p[0] - P0[0]) * dn[0] + (p[1] - P0[1]) * dn[1]));
      const toward = (t0 > 0 ? 1 : 0); // the far end of the line is the one with the larger t
      void toward;
      let tip = 0;
      const centreT = ts.reduce((a, b) => a + b, 0) / ts.length;
      f.pts.forEach((_, k) => { if (ps[k] <= 0.45 * size + 0.1 && Math.abs(ts[k] - centreT) > Math.abs(ts[tip] - centreT)) tip = k; });
      const baseVerts = ts.filter((_, k) => k !== tip);
      const spread = baseVerts.length ? Math.max(...baseVerts) - Math.min(...baseVerts) : 0;
      const kind: TerminatorKind = spread < 0.35 * size && f.pts.length === 3 ? 'arrow' : size <= 2.4 * cap ? 'dot' : 'arrow';
      const at = kind === 'dot' ? c : f.pts[tip];
      const tAt = (at[0] - P0[0]) * u[0] + (at[1] - P0[1]) * u[1];
      if (Math.abs(tAt - t0) <= R) consider(kind, tAt, Math.abs(tAt - t0));
    }
  }
  for (const r of ctx.rings) {
    if (hypot(r.c[0] - E[0], r.c[1] - E[1]) > R + r.size) continue;
    const perp = Math.abs((r.c[0] - P0[0]) * dn[0] + (r.c[1] - P0[1]) * dn[1]);
    if (perp > 0.5 * r.size + 0.3 * cap || r.size > 2.6 * cap) continue;
    const t = (r.c[0] - P0[0]) * u[0] + (r.c[1] - P0[1]) * u[1];
    if (Math.abs(t - t0) <= R) consider('dot', t, Math.abs(t - t0));
  }
  return best;
}

/** Small strokes (glyph-sized, not ticks or lines) within two text heights past either end of a string, along its baseline. */
function unreadLetteringBeside(page: VectorPage, run: Run): boolean {
  const H = page.height; const flip = !isYDown(page);
  const r = (run.angle * Math.PI) / 180;
  const u: Pt = [Math.cos(r), Math.sin(r)], dn: Pt = [-Math.sin(r), Math.cos(r)];
  const cap = run.cap;
  const first = run.parts[0], last = run.parts[run.parts.length - 1];
  const a0: Pt = first.origin, a1: Pt = [last.origin[0] + u[0] * last.length, last.origin[1] + u[1] * last.length];
  for (const s of page.strokes) {
    if (s.points.length < 2) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) { const y = flip ? H - p.y : p.y; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const size = Math.max(x1 - x0, y1 - y0);
    if (size > 1.15 * cap || size < 0.05) continue;
    const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
    for (const [end, dir] of [[a0, -1], [a1, 1]] as [Pt, number][]) {
      const along = ((c[0] - end[0]) * u[0] + (c[1] - end[1]) * u[1]) * dir;
      const up = -((c[0] - end[0]) * dn[0] + (c[1] - end[1]) * dn[1]);
      if (along > -0.1 * cap && along < 2.2 * cap && up > -0.4 * cap && up < 1.3 * cap) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- finding the lines
export interface FindOptions { bare?: 'auto' | 'm' | 'mm' | 'ft' }

/**
 * Dimension lines of a page (a normalised or a raw page), each with the string that belongs to it. A string with no line
 * around it is not a dimension and is left alone; a line with no string is not returned (nothing to say about it).
 */
export function findDimensions(page: VectorPage, reads: TextRead[], opts: FindOptions = {}): DimLine[] {
  const maxLen = 0.95 * Math.max(page.width, page.height);
  const ctx = buildCtx(page);
  ctx.segs = straightSegs(page, maxLen);
  const runs = lengthRuns(reads, opts.bare ?? 'auto');
  interface Cand { run: Run; seg: Seg; score: number; line: { t0: number; t1: number; P0: Pt; u: Pt }; own: Set<number>; perp: number }
  const cands: Cand[] = [];
  // index the long-ish segments by direction
  const segs = ctx.segs;
  for (const run of runs) {
    const r = (run.angle * Math.PI) / 180;
    const ru: Pt = [Math.cos(r), Math.sin(r)], dn: Pt = [-Math.sin(r), Math.cos(r)];
    const ang = ((run.angle % 180) + 180) % 180;
    const cap = run.cap;
    let best: Cand | null = null;
    for (const s of segs) {
      if (angDiff(s.ang, ang) > 2.5) continue;
      if (s.len < 0.6 * cap) continue;
      const perp = (run.centre[0] - s.a[0]) * dn[0] + (run.centre[1] - s.a[1]) * dn[1];
      // the string sits just above or below the line, or the line runs through it
      if (Math.abs(perp) > 2.4 * cap) continue;
      // extent of the line along the reading axis, joined with collinear pieces on either side of the string
      const proj = (p: Pt): number => (p[0] - run.centre[0]) * ru[0] + (p[1] - run.centre[1]) * ru[1];
      let t0 = Math.min(proj(s.a), proj(s.b)), t1 = Math.max(proj(s.a), proj(s.b));
      const own = new Set<number>([s.i]);
      for (let pass = 0; pass < 3; pass++) {
        for (const o of segs) {
          if (own.has(o.i) || angDiff(o.ang, ang) > 1.5) continue;
          const operp = (o.a[0] - s.a[0]) * dn[0] + (o.a[1] - s.a[1]) * dn[1];
          const operp2 = (o.b[0] - s.a[0]) * dn[0] + (o.b[1] - s.a[1]) * dn[1];
          if (Math.abs(operp) > 0.3 * cap || Math.abs(operp2) > 0.3 * cap) continue;
          const o0 = Math.min(proj(o.a), proj(o.b)), o1 = Math.max(proj(o.a), proj(o.b));
          // a line is drawn in two halves only where the string sits in the gap; neighbours that meet end to end are other dimensions
          const gapLo = o1 < t0 ? o1 : t1, gapHi = o1 < t0 ? t0 : o0;
          const gap = gapHi - gapLo;
          if (gap < 0.2 * cap || gap > run.len + 2 * cap) continue;
          if (gapHi < -run.len / 2 - cap || gapLo > run.len / 2 + cap) continue;
          if (o1 < t0 ? false : o0 < t1) continue; // overlapping pieces are not a gap
          // a gap that another collinear piece sits in is a chain of dimensions, not a line broken for its string
          if (segs.some((q) => q !== o && q !== s && !own.has(q.i) && angDiff(q.ang, ang) <= 1.5 && Math.abs((q.a[0] - s.a[0]) * dn[0] + (q.a[1] - s.a[1]) * dn[1]) <= 0.3 * cap && Math.min(proj(q.a), proj(q.b)) >= gapLo - 0.2 * cap && Math.max(proj(q.a), proj(q.b)) <= gapHi + 0.2 * cap && q.len > 0.3 * cap)) continue;
          own.add(o.i); t0 = Math.min(t0, o0); t1 = Math.max(t1, o1);
        }
      }
      if (!(t0 <= 0 && t1 >= 0)) continue;
      const mid = (t0 + t1) / 2;
      const score = Math.abs(mid) / Math.max(run.len, 2 * cap) + 0.35 * Math.abs(perp) / (2 * cap);
      // the base point is the string's centre dropped onto the line itself, so everything measured from it lies on the line
      const onLine: Pt = [run.centre[0] - dn[0] * perp + dn[0] * 0, run.centre[1] - dn[1] * perp];
      if (!best || score < best.score) best = { run, seg: s, score, line: { t0, t1, P0: onLine, u: ru }, own, perp };
    }
    if (best) cands.push(best);
  }
  // each line serves one string: the best-centred one
  cands.sort((x, y) => x.score - y.score);
  const takenLine = new Set<number>(); const takenRead = new Set<TextRead>();
  const dims: DimLine[] = [];
  for (const c of cands) {
    if ([...c.own].some((i) => takenLine.has(i)) || c.run.parts.some((p) => takenRead.has(p))) continue;
    if (c.score > 1.3) continue;
    const { P0, u } = c.line;
    const ang = ((c.run.angle % 180) + 180) % 180;
    const cap = c.run.cap;
    const R = Math.max(2.5 * cap, 3);
    const A0 = findAnchor(ctx, P0, u, c.line.t0, R, cap, c.own, ang);
    const A1 = findAnchor(ctx, P0, u, c.line.t1, R, cap, c.own, ang);
    const terminated = (a: Anchor | null): boolean => !!a && a.kind !== 'extension';
    // a dimension needs a mark at each end (a terminator or an extension line); a bare line is not one
    if (!A0 || !A1) continue;
    void terminated;
    const t0 = A0.t, t1 = A1.t;
    if (Math.abs(t1 - t0) < 1) continue;
    const a: Pt = [P0[0] + u[0] * t0, P0[1] + u[1] * t0], b: Pt = [P0[0] + u[0] * t1, P0[1] + u[1] * t1];
    // move the anchors onto the line itself (the string's centre is only near it): project onto the drawn segment
    const s = c.seg;
    const proj = (p: Pt): Pt => { const k = (p[0] - s.a[0]) * s.ux + (p[1] - s.a[1]) * s.uy; return [s.a[0] + s.ux * k, s.a[1] + s.uy * k]; };
    const pa = proj(a), pb = proj(b);
    const dirx = pb[0] - pa[0], diry = pb[1] - pa[1];
    const lengthPt = hypot(dirx, diry);
    let angle = (Math.atan2(diry, dirx) / D2R + 360) % 180; if (angle >= 180) angle -= 180;
    dims.push({
      id: `d${dims.length}`, a: pa, b: pb, lengthPt, angle, anchors: [A0.kind, A1.kind],
      line: { a: proj([P0[0] + u[0] * c.line.t0, P0[1] + u[1] * c.line.t0]), b: proj([P0[0] + u[0] * c.line.t1, P0[1] + u[1] * c.line.t1]) },
      run: c.run, centring: c.score, view: 0, page: 0, incomplete: c.run.parts.some((q) => q.method === 'glyph') && unreadLetteringBeside(page, c.run),
    });
    for (const i of c.own) takenLine.add(i);
    for (const p of c.run.parts) takenRead.add(p);
  }
  chainsAndOveralls(dims);
  return dims;
}

// ---------------------------------------------------------------- chains and overalls
/**
 * A chain: dimensions on one line (same direction, same offset) that meet end to end. An overall: a dimension on a parallel
 * line whose ends are the chain's first and last point. Sets `chain`, `overall` and `spans` in place.
 */
export function chainsAndOveralls(dims: DimLine[]): void {
  const tol = (d: DimLine): number => Math.max(1.5, 0.6 * d.run.cap);
  const used = new Set<DimLine>();
  let n = 0;
  const unit = (d: DimLine): Pt => [(d.b[0] - d.a[0]) / d.lengthPt, (d.b[1] - d.a[1]) / d.lengthPt];
  const normal = (d: DimLine): Pt => { const u = unit(d); return [-u[1], u[0]]; };
  const chains: { id: string; members: DimLine[]; u: Pt; off: number; t0: number; t1: number }[] = [];
  for (const d of dims) {
    if (used.has(d)) continue;
    const u = unit(d), nrm = normal(d);
    const off = d.a[0] * nrm[0] + d.a[1] * nrm[1];
    const same = dims.filter((o) => !used.has(o) && angDiff(o.angle, d.angle) < 2.5 && Math.abs(o.a[0] * nrm[0] + o.a[1] * nrm[1] - off) <= tol(d));
    // order along the line and keep the run that is connected to d
    const pos = (o: DimLine): [number, number] => { const ta = o.a[0] * u[0] + o.a[1] * u[1], tb = o.b[0] * u[0] + o.b[1] * u[1]; return [Math.min(ta, tb), Math.max(ta, tb)]; };
    same.sort((x, y) => pos(x)[0] - pos(y)[0]);
    const run: DimLine[] = [d];
    let lo = pos(d)[0], hi = pos(d)[1];
    for (let pass = 0; pass < same.length; pass++) {
      let grew = false;
      for (const o of same) {
        if (run.includes(o)) continue;
        const [p0, p1] = pos(o);
        if (Math.abs(p0 - hi) <= tol(d) || Math.abs(p1 - lo) <= tol(d)) { run.push(o); lo = Math.min(lo, p0); hi = Math.max(hi, p1); grew = true; }
      }
      if (!grew) break;
    }
    if (run.length >= 2) {
      const id = `c${n++}`;
      for (const m of run) { m.chain = id; used.add(m); }
      chains.push({ id, members: run, u, off, t0: lo, t1: hi });
    }
  }
  // an overall: a single dimension (not itself in a chain of its own) spanning a chain's extent from a parallel line
  for (const d of dims) {
    if (d.chain) continue;
    const u = unit(d);
    for (const c of chains) {
      if (angDiff(d.angle, Math.atan2(c.u[1], c.u[0]) / D2R) > 2.5) continue;
      const ta = d.a[0] * c.u[0] + d.a[1] * c.u[1], tb = d.b[0] * c.u[0] + d.b[1] * c.u[1];
      const p0 = Math.min(ta, tb), p1 = Math.max(ta, tb);
      const nrm: Pt = [-c.u[1], c.u[0]];
      const off = d.a[0] * nrm[0] + d.a[1] * nrm[1];
      if (Math.abs(off - c.off) <= tol(d)) continue; // the same line: a chain member, not an overall
      if (Math.abs(p0 - c.t0) <= 2 * tol(d) && Math.abs(p1 - c.t1) <= 2 * tol(d)) { d.overall = true; d.spans = c.members.map((m) => m.id); break; }
    }
    void u;
  }
}

// ---------------------------------------------------------------- views
/**
 * Split a page into views: groups of linework separated by blank gaps wider than 5% of the page. Long rules (the sheet border)
 * and tiny specks are ignored. Returns a view index per point query and the boxes.
 */
export function splitViews(page: VectorPage): { boxes: [number, number, number, number][]; of: (p: Pt) => number } {
  const W = page.width, H = page.height;
  const cell = Math.max(2, 0.012 * Math.max(W, H));
  const nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1;
  const occ = new Uint8Array(nx * ny);
  const flip = !isYDown(page);
  const mark = (x: number, y: number): void => { const cx = Math.max(0, Math.min(nx - 1, Math.floor(x / cell))), cy = Math.max(0, Math.min(ny - 1, Math.floor(y / cell))); occ[cy * nx + cx] = 1; };
  for (const s of page.strokes) {
    const pts = s.points.map((p) => [p.x, flip ? H - p.y : p.y] as Pt);
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 0.7 * Math.max(W, H) && pts.length <= 5) continue; // border, title rules
    for (let i = 0; i + 1 < pts.length; i++) {
      const L = hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const k = Math.max(1, Math.ceil(L / (cell * 0.5)));
      for (let q = 0; q <= k; q++) mark(pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * q) / k, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * q) / k);
    }
    void len;
  }
  for (const f of page.fills) {
    const b = f.bbox; const w = b[2] - b[0], h = b[3] - b[1];
    if (Math.max(w, h) > 0.7 * Math.max(W, H)) continue;
    const y0 = flip ? H - b[3] : b[1], y1 = flip ? H - b[1] : b[3];
    for (let x = b[0]; x <= b[2] + cell; x += cell) for (let y = y0; y <= y1 + cell; y += cell) mark(Math.min(x, b[2]), Math.min(y, y1));
  }
  // texts keep their neighbourhood together too
  for (const t of page.texts) { const y = flip ? H - t.y : t.y; mark(t.x, y); mark(t.x + t.width, y); }
  const gap = Math.max(1, Math.round((0.05 * Math.max(W, H)) / cell));
  const dil = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (occ[y * nx + x]) {
    for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && X < nx && Y >= 0 && Y < ny && dx * dx + dy * dy <= gap * gap) dil[Y * nx + X] = 1; }
  }
  const lab = new Int32Array(nx * ny).fill(-1);
  const boxes: [number, number, number, number][] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!dil[y * nx + x] || lab[y * nx + x] >= 0) continue;
    const id = boxes.length; boxes.push([Infinity, Infinity, -Infinity, -Infinity]);
    const stack = [[x, y]];
    lab[y * nx + x] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      const b = boxes[id];
      if (occ[cy * nx + cx]) { b[0] = Math.min(b[0], cx * cell); b[1] = Math.min(b[1], cy * cell); b[2] = Math.max(b[2], (cx + 1) * cell); b[3] = Math.max(b[3], (cy + 1) * cell); }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = cx + dx, Y = cy + dy; if (X >= 0 && X < nx && Y >= 0 && Y < ny && dil[Y * nx + X] && lab[Y * nx + X] < 0) { lab[Y * nx + X] = id; stack.push([X, Y]); } }
    }
  }
  const real = boxes.map((b, i) => ({ b, i })).filter((x) => isFinite(x.b[0]));
  return {
    boxes: real.map((x) => x.b),
    of: (p) => {
      const cx = Math.max(0, Math.min(nx - 1, Math.floor(p[0] / cell))), cy = Math.max(0, Math.min(ny - 1, Math.floor(p[1] / cell)));
      // the label of the nearest occupied-or-dilated cell
      for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || X >= nx || Y < 0 || Y >= ny) continue;
        const id = lab[Y * nx + X];
        if (id >= 0) return real.findIndex((x) => x.i === id);
      }
      return 0;
    },
  };
}
