// C12b. SPEC 17.5 item 2: the stroke-glyph reader. Exploded CAD text arrives as many short vector strokes. This groups them into
// glyphs, glyphs into lines (any of the four reading directions), and matches each glyph against the Hershey templates
// (hershey.ts: simplex, duplex, complex; the common CAD stroke fonts descend from them). Local, pure TypeScript, no network.
// Frame: everything here works in y-down page units; a raw (y-up) page is flipped on read.
import type { VectorPage } from '../import/types';
import { CAP_H, FACES, fontOf } from './hershey';
import type { Face } from './hershey';
import { isYDown, wrap360 } from './reads';
import type { TextRead } from './reads';
import { plausibleText } from './plausible';

type Pt = [number, number];
const hypot = Math.hypot;

// ---------------------------------------------------------------- geometry helpers
function resample(polys: Pt[][], maxPts: number, minSpacing: number): Pt[] {
  let len = 0;
  for (const p of polys) for (let i = 0; i + 1 < p.length; i++) len += hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  const spacing = Math.max(minSpacing, len / maxPts);
  const out: Pt[] = [];
  for (const p of polys) {
    if (p.length === 1) { out.push(p[0]); continue; }
    out.push(p[0]);
    let carry = 0;
    for (let i = 0; i + 1 < p.length; i++) {
      const dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1], L = hypot(dx, dy);
      if (L === 0) continue;
      let t = spacing - carry;
      while (t <= L) { out.push([p[i][0] + (dx * t) / L, p[i][1] + (dy * t) / L]); t += spacing; }
      carry = L - (t - spacing);
      if (carry >= spacing) carry = 0;
    }
    out.push(p[p.length - 1]);
  }
  return out;
}
const bboxOf = (pts: Pt[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
};
function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  // distance between segments ab and cd
  const inter = ((): boolean => {
    const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  })();
  if (inter) return 0;
  const pd = (p: Pt, q: Pt, r: Pt): number => {
    const dx = r[0] - q[0], dy = r[1] - q[1], L2 = dx * dx + dy * dy;
    let t = L2 === 0 ? 0 : ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return hypot(p[0] - (q[0] + t * dx), p[1] - (q[1] + t * dy));
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}
function polyDist(A: Pt[], B: Pt[], stop: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < A.length || (A.length === 1 && i === 0); i++) {
    const a = A[i], b = A[Math.min(i + 1, A.length - 1)];
    for (let j = 0; j + 1 < B.length || (B.length === 1 && j === 0); j++) {
      const c = B[j], d = B[Math.min(j + 1, B.length - 1)];
      const v = segDist(a, b, c, d);
      if (v < best) { best = v; if (best <= stop) return best; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- templates
interface Template {
  ch: string; face: Face; advance: number; strokes: number;
  box: [number, number, number, number];
  /** sampled ink, glyph units, y up from the baseline, x from the glyph's left bound */
  pts: Pt[];
  /** the ink box's width and height, cached */
  w: number; h: number;
  /** number of separate pieces the glyph is drawn as (connected components), the reader's multi-piece rule uses it */
  pieces: number;
}
let TEMPLATES: Template[] | null = null;
const SAMPLE_MAX = 36;
function piecesOf(strokes: Pt[][]): number {
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
  for (let i = 0; i < strokes.length; i++) for (let j = i + 1; j < strokes.length; j++) if (polyDist(strokes[i], strokes[j], 0.3) <= 0.3) parent[find(i)] = find(j);
  return new Set(strokes.map((_, i) => find(i))).size;
}
export function templates(): Template[] {
  if (TEMPLATES) return TEMPLATES;
  const out: Template[] = [];
  for (const face of FACES) {
    for (const [ch, g] of fontOf(face)) {
      if (ch === ' ' || ch === '×' || !g.strokes.length) continue;
      const strokes = g.strokes as Pt[][];
      const pts = resample(strokes, SAMPLE_MAX, 0.9);
      out.push({ ch, face, advance: g.advance, strokes: strokes.length, box: g.box, pts, w: g.box[2] - g.box[0], h: g.box[3] - g.box[1], pieces: piecesOf(strokes) });
    }
  }
  TEMPLATES = out;
  return out;
}

// ---------------------------------------------------------------- components
interface Comp {
  id: number; strokes: number[]; polys: Pt[][]; box: [number, number, number, number]; size: number;
  /** drawn as exactly one straight segment */ single: boolean;
}
export interface GlyphOptions {
  /** biggest glyph the reader will consider, page units; default 5% of the longer page side */
  maxGlyph?: number;
  /** a match is a glyph when its distance (in cap heights) is at most this */
  accept?: number;
  /** a match this close is trusted as the font itself; between accept and this the cluster is tentative */
  tentativeTo?: number;
}

/** `skip`: strokes already read. `maxStraight`: a lone straight stroke longer than this is a rule or a tick, not a glyph piece. */
function components(page: VectorPage, maxGlyph: number, skip?: Set<number>, maxStraight = Infinity): Comp[] {
  const H = page.height;
  const flip = !isYDown(page);
  const strokes = page.strokes;
  const polys: (Pt[] | null)[] = strokes.map((s) => {
    if (s.points.length < 2) return null;
    return s.points.map((p) => [p.x, flip ? H - p.y : p.y] as Pt);
  });
  const boxes = polys.map((p) => (p ? bboxOf(p) : null));
  const cand: number[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const b = boxes[i];
    if (!b) continue;
    const w = b[2] - b[0], h = b[3] - b[1];
    if (Math.max(w, h) > maxGlyph || Math.max(w, h) < 0.05) continue;
    if (skip?.has(i)) continue;
    if (polys[i]!.length === 2 && Math.hypot(w, h) > maxStraight) continue;
    cand.push(i);
  }
  // spatial hash
  const cell = Math.max(2, maxGlyph / 2);
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number): string => `${cx},${cy}`;
  const eps = (i: number): number => 0.03 * Math.max(boxes[i]![2] - boxes[i]![0], boxes[i]![3] - boxes[i]![1]) + 0.02;
  for (const i of cand) {
    const b = boxes[i]!; const e = eps(i);
    for (let cx = Math.floor((b[0] - e) / cell); cx <= Math.floor((b[2] + e) / cell); cx++) for (let cy = Math.floor((b[1] - e) / cell); cy <= Math.floor((b[3] + e) / cell); cy++) {
      const k = key(cx, cy); const g = grid.get(k); if (g) g.push(i); else grid.set(k, [i]);
    }
  }
  const parent = new Map<number, number>(cand.map((i) => [i, i]));
  const find = (i: number): number => { let r = i; while (parent.get(r) !== r) r = parent.get(r)!; let c = i; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  for (const i of cand) {
    const b = boxes[i]!; const e = eps(i);
    const seen = new Set<number>();
    for (let cx = Math.floor((b[0] - e) / cell); cx <= Math.floor((b[2] + e) / cell); cx++) for (let cy = Math.floor((b[1] - e) / cell); cy <= Math.floor((b[3] + e) / cell); cy++) {
      for (const j of grid.get(key(cx, cy)) ?? []) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        if (find(i) === find(j)) continue;
        const c = boxes[j]!; const ee = Math.max(e, eps(j));
        if (c[0] > b[2] + ee || c[2] < b[0] - ee || c[1] > b[3] + ee || c[3] < b[1] - ee) continue;
        if (polyDist(polys[i]!, polys[j]!, ee) <= ee) parent.set(find(i), find(j));
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of cand) { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); }
  const comps: Comp[] = [];
  for (const g of groups.values()) {
    const ps = g.map((i) => polys[i]!);
    const box = bboxOf(ps.flat());
    const size = Math.max(box[2] - box[0], box[3] - box[1]);
    if (size > maxGlyph) continue;
    comps.push({ id: comps.length, strokes: g, polys: ps, box, size, single: g.length === 1 && ps[0].length === 2 });
  }
  return comps;
}

// ---------------------------------------------------------------- matching
interface Match { t: Template; d: number }
interface Placed { rcs: { c: Comp }[]; pts: Pt[]; box: [number, number, number, number]; u0: number; u1: number }
const UNMATCHED = 0.3;
const ITEM_COST = 0.045;

/** symmetric chamfer between two point sets, in cap heights; `cut` ends early when the result cannot beat it */
function chamfer(A: Pt[], B: Pt[], cut: number): number {
  const lim = cut * CAP_H * 1.7;
  let sa = 0;
  const na = A.length, nb = B.length;
  const budgetA = lim * na;
  for (let i = 0; i < na; i++) {
    const ax = A[i][0], ay = A[i][1];
    let m = Infinity;
    for (let j = 0; j < nb; j++) { const dx = ax - B[j][0], dy = ay - B[j][1]; const d = dx * dx + dy * dy; if (d < m) m = d; }
    sa += Math.sqrt(m);
    if (sa > budgetA) return sa / (i + 1) / CAP_H;
  }
  sa /= na;
  let sb = 0;
  const budgetB = lim * nb;
  for (let j = 0; j < nb; j++) {
    const bx = B[j][0], by = B[j][1];
    let m = Infinity;
    for (let i = 0; i < na; i++) { const dx = bx - A[i][0], dy = by - A[i][1]; const d = dx * dx + dy * dy; if (d < m) m = d; }
    sb += Math.sqrt(m);
    if (sb > budgetB) return Math.max(sa, sb / (j + 1)) / CAP_H;
  }
  sb /= nb;
  return (Math.max(sa, sb) * 0.7 + Math.min(sa, sb) * 0.3) / CAP_H;
}

function matchPlaced(pl: Placed, cands: Template[], top = 2): Match[] {
  const [cx0, cy0, cx1, cy1] = pl.box;
  const cw = cx1 - cx0, chh = cy1 - cy0;
  const res: Match[] = [];
  const stCount = pl.rcs.reduce((a, r) => a + r.c.strokes.length, 0);
  for (const t of cands) {
    // placement in the line: bottom and top within 4.5 glyph units, size within a third
    if (Math.abs(cy0 - t.box[1]) > 4.5 || Math.abs(cy1 - t.box[3]) > 4.5) continue;
    if (t.h > 8 ? (chh / t.h < 0.78 || chh / t.h > 1.28) : Math.abs(chh - t.h) > 3.5) continue;
    let sx = 1;
    if (t.w > 5 && cw > 3) { sx = cw / t.w; if (sx < 0.62 || sx > 1.5) continue; } else if (Math.abs(cw - t.w) > 4.5) continue;
    if (t.pieces > pl.rcs.length + 1 || pl.rcs.length > t.pieces + 1) { if (!(t.strokes >= stCount - 1 && t.strokes <= stCount + 2)) continue; }
    const shift = (cx0 + cx1) / 2 - (sx * (t.box[0] + t.box[2])) / 2;
    const T = t.pts.map((p) => [p[0] * sx + shift, p[1]] as Pt);
    const worst = res.length >= top ? res[res.length - 1].d : 0.3;
    const d = chamfer(pl.pts, T, worst);
    if (d < worst || res.length < top) {
      res.push({ t, d });
      res.sort((a, b) => a.d - b.d);
      if (res.length > top) res.pop();
    }
  }
  return res;
}

// ---------------------------------------------------------------- lines
/** A component seen in a reading frame: u along the text, v down the page of the reader. */
interface RC { c: Comp; polys: Pt[][]; u0: number; u1: number; v0: number; v1: number }
interface Item { ch: string; d: number; t: Template | null; comps: RC[]; u0: number; u1: number; sx: number }
interface RowResult { items: Item[]; cost: number; matched: number; total: number; baseline: number; H: number; shear: number; theta: number; origin: number }

const frameOf = (deg: number): [number, number] => [Math.round(Math.cos((deg * Math.PI) / 180)), Math.round(Math.sin((deg * Math.PI) / 180))];
function toReading(c: Comp, theta: number): RC {
  const [cs, sn] = frameOf(theta);
  const polys = c.polys.map((p) => p.map(([x, y]) => [x * cs + y * sn, -x * sn + y * cs] as Pt));
  const b = bboxOf(polys.flat());
  return { c, polys, u0: b[0], u1: b[2], v0: b[1], v1: b[3] };
}

/** Taller comps seed the rows; shorter ones join the row whose band they sit in. */
function makeRows(rc: RC[]): RC[][] {
  const order = [...rc].sort((a, b) => (b.v1 - b.v0) - (a.v1 - a.v0));
  const rows: { items: RC[]; v0: number; v1: number; h: number }[] = [];
  for (const c of order) {
    const h = c.v1 - c.v0;
    let best = -1, bestO = -1;
    rows.forEach((r, k) => {
      const lo = Math.max(c.v0, r.v0 - 0.2 * r.h), hi = Math.min(c.v1, r.v1 + 0.3 * r.h);
      const ov = hi - lo;
      const inside = c.v0 >= r.v0 - 0.15 * r.h && c.v1 <= r.v1 + 0.3 * r.h;
      if ((ov >= 0.6 * Math.min(h, r.h) && h >= 0.45 * r.h) || (h < 0.5 * r.h && inside)) { if (ov > bestO) { bestO = ov; best = k; } }
    });
    if (best < 0) rows.push({ items: [c], v0: c.v0, v1: c.v1, h });
    else {
      const r = rows[best]; r.items.push(c);
      if (h >= 0.75 * r.h) { r.v0 = Math.min(r.v0, c.v0); r.v1 = Math.max(r.v1, c.v1); r.h = r.v1 - r.v0; }
    }
  }
  return rows.map((r) => r.items);
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

interface Placed2 { rcs: RC[]; pts: Pt[]; box: [number, number, number, number]; u0: number; u1: number }

/** Decode one row with a given shear (tangent) and cap-height hypothesis. */
function decodeRow(row: RC[], theta: number, shear: number, capScale: number, cands: Template[]): RowResult | null {
  // glyph-like pieces (more than one straight segment) set the scale; ticks, rules and hatching do not
  const solid = row.filter((c) => !c.c.single);
  const basis = solid.length ? solid : row;
  const tall = basis.filter((c) => c.v1 - c.v0 >= 0.72 * Math.max(...basis.map((x) => x.v1 - x.v0)));
  const baseline = median(tall.map((c) => c.v1));
  const Hraw = median(tall.map((c) => c.v1 - c.v0));
  const H = Hraw * capScale;
  if (H < 0.4) return null;
  const s = H / CAP_H;
  const uRef = Math.min(...row.map((c) => c.u0));
  const placeOf = (rcs: RC[]): Placed2 => {
    const polys: Pt[][] = [];
    for (const r of rcs) for (const p of r.polys) polys.push(p.map(([u, v]) => { const gy = (baseline - v) / s; return [(u - uRef) / s - shear * gy, gy] as Pt; }));
    const pts = resample(polys, 28, 0.9);
    const b = bboxOf(polys.flat());
    return { rcs, pts, box: b, u0: b[0], u1: b[2] };
  };
  const order = [...row].sort((a, b) => a.u0 - b.u0 || a.v0 - b.v0);
  const n = order.length;
  const single = order.map((c) => placeOf([c]));
  const sMatch = single.map((pl) => matchPlaced(pl, cands, 2));
  type Opt = { len: number; item: Item };
  const options: Opt[][] = order.map(() => []);
  const addOpt = (i: number, len: number, pl: Placed2, m: Match | undefined): void => {
    if (!m) return;
    options[i].push({ len, item: { ch: m.t.ch, d: m.d, t: m.t, comps: pl.rcs, u0: pl.u0, u1: pl.u1, sx: 1 } });
  };
  for (let i = 0; i < n; i++) {
    if (sMatch[i][0]) addOpt(i, 1, single[i], sMatch[i][0]);
    // groups of two and three pieces: stacked (they share u) or very close
    for (const len of [2, 3]) {
      if (i + len > n) continue;
      const grp = order.slice(i, i + len);
      const pl = placeOf(grp);
      if (pl.box[2] - pl.box[0] > 27 || pl.box[3] - pl.box[1] > 31) continue;
      let ok = true;
      for (let k = 0; k + 1 < grp.length && ok; k++) {
        const a = single[i + k], b = single[i + k + 1];
        const gap = Math.max(0, b.u0 - a.u1, a.u0 - b.u1);
        if (gap > 9) ok = false;
      }
      if (!ok) continue;
      const m = matchPlaced(pl, cands.filter((t) => t.pieces >= len - 0 && t.pieces <= len + 1), 1)[0];
      if (m && m.d <= 0.09) addOpt(i, len, pl, { t: m.t, d: m.d - 0.004 * len });
    }
  }
  // DP: stacked comps may not be consecutive singles
  const INF = 1e9;
  const best: number[] = Array(n + 1).fill(INF); const via: ({ len: number; item: Item | null } | null)[] = Array(n + 1).fill(null);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] >= INF) continue;
    const cand: Opt[] = [...options[i]];
    if (!cand.some((o) => o.len === 1)) cand.push({ len: 1, item: { ch: '?', d: UNMATCHED, t: null, comps: [order[i]], u0: single[i].u0, u1: single[i].u1, sx: 1 } });
    for (const o of cand) {
      let pen = 0;
      if (o.len === 1 && i > 0 && via[i]?.len === 1) {
        const a = single[i - 1], b = single[i];
        const ov = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
        if (ov > 0.45 * Math.min(a.u1 - a.u0, b.u1 - b.u0) && Math.min(a.u1 - a.u0, b.u1 - b.u0) < 14) pen = 0.35;
      }
      // a small charge per glyph, so two perfect fragments never beat one good glyph that spans them
      const c = best[i] + (o.item.t ? Math.min(o.item.d, UNMATCHED) + ITEM_COST : UNMATCHED) + pen;
      if (c < best[i + o.len]) { best[i + o.len] = c; via[i + o.len] = { len: o.len, item: o.item }; }
    }
  }
  if (best[n] >= INF) return null;
  let items: Item[] = [];
  for (let k = n; k > 0;) { const v = via[k]!; items.unshift(v.item!); k -= v.len; }
  items = quoteFallback(items, cands, baseline, H);
  const matched = items.filter((it) => it.t).length;
  return { items, cost: best[n], matched, total: items.length, baseline, H, shear, theta, origin: uRef };
}

/**
 * A mark in the upper part of the line that matched no template (a quote or foot mark in a hand the templates do not hold) is
 * read as a quote: one mark is ', two side by side are ". These stand with a distance high enough that their shape cluster is
 * tentative, so a string that relies on one is verified only when other dimensions vouch for the shape (verify.ts).
 */
function quoteFallback(items: Item[], cands: Template[], baseline: number, H: number): Item[] {
  const quote = cands.find((t) => t.ch === "'" && t.face === 'simplex'), dquote = cands.find((t) => t.ch === '"' && t.face === 'simplex');
  if (!quote || !dquote) return items;
  // a piece of mark size that hangs in the upper part of the line
  const markLike = (it: Item): boolean => !it.t && it.comps.length === 1 && it.comps[0].c.size <= 0.55 * H && it.comps[0].v1 <= baseline - 0.35 * H;
  const out: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!markLike(it)) { out.push(it); continue; }
    const group = [it];
    while (i + 1 < items.length && markLike(items[i + 1]) && Math.abs(items[i + 1].u0 - group[group.length - 1].u1) < 9) { i++; group.push(items[i]); }
    const t = group.length >= 2 ? dquote : quote;
    out.push({ ch: t.ch, d: 0.09, t, comps: group.flatMap((g) => g.comps), u0: Math.min(...group.map((g) => g.u0)), u1: Math.max(...group.map((g) => g.u1)), sx: 1 });
  }
  return out;
}

/** Insert spaces where the gap between two glyphs is wider than their own spacing allows. */
function textOf(items: Item[], s: number, uRef: number): string {
  let out = '';
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (k > 0 && it.t && items[k - 1].t) {
      const a = items[k - 1], b = it;
      const expected = (a.t!.advance - a.t!.box[2]) + b.t!.box[0];
      const gap = b.u0 - a.u1;
      const extra = gap - expected;
      if (extra > SPACE_GAP) out += ' '.repeat(Math.min(3, Math.max(1, Math.round(extra / 14))));
    }
    out += it.ch;
  }
  void s; void uRef;
  return out;
}

const SPACE_GAP = 7;
const WEAK = new Set("-_/|\\'\".,:;`Il i!".split(''));
const SHEARS = [0, Math.tan((15 * Math.PI) / 180), Math.tan((8 * Math.PI) / 180), Math.tan((4 * Math.PI) / 180), Math.tan((11 * Math.PI) / 180), -Math.tan((8 * Math.PI) / 180), -Math.tan((15 * Math.PI) / 180)];

/**
 * Slant of a row (tangent): the shear that makes its glyphs narrowest. An italic glyph is wider than its upright self by
 * tan(slant) times its height, so shearing the row back until the summed glyph widths are least recovers the lean.
 */
function estimateShear(row: RC[], H: number): number | null {
  const comps = row.filter((c) => !c.c.single && c.v1 - c.v0 >= 0.5 * H);
  if (comps.length < 1) return null;
  let best = 0, bestW = Infinity, zeroW = 0;
  for (let deg = -22; deg <= 22; deg += 2) {
    const sh = Math.tan((deg * Math.PI) / 180);
    let w = 0;
    for (const c of comps) {
      let u0 = Infinity, u1 = -Infinity;
      for (const p of c.polys) for (const [u, v] of p) { const x = u - sh * (-v); if (x < u0) u0 = x; if (x > u1) u1 = x; }
      w += u1 - u0;
    }
    if (deg === 0) zeroW = w;
    if (w < bestW - 1e-9) { bestW = w; best = sh; }
  }
  // a lean smaller than the noise is no lean
  return Math.abs(best) < 0.04 || bestW > zeroW * 0.97 ? null : best;
}

function bestRow(row: RC[], theta: number, cands: Template[], goodMean: number): RowResult | null {
  let best: RowResult | null = null;
  const score = (r: RowResult): number => r.cost / Math.max(1, r.total) + (r.total - r.matched) * 0.1;
  const consider = (r: RowResult | null): boolean => {
    if (!r) return false;
    if (!best || score(r) < score(best)) best = r;
    return r.matched === r.total && r.cost / r.total <= goodMean;
  };
  const hs0 = row.filter((c) => !c.c.single).map((c) => c.v1 - c.v0);
  const est = hs0.length ? estimateShear(row, Math.max(...hs0)) : null;
  const tries: number[] = est !== null ? [est, 0] : [0];
  for (const sh of tries) if (consider(decodeRow(row, theta, sh, 1, cands))) return best;
  // the estimate can be off by a couple of degrees: nearby grid slants
  if (est !== null) for (const sh of SHEARS) if (Math.abs(sh - est) < 0.06 && !tries.includes(sh)) { tries.push(sh); if (consider(decodeRow(row, theta, sh, 1, cands))) return best; }
  // an all-lowercase row of x-height letters reads at 1.5x
  const hs = row.map((c) => c.v1 - c.v0);
  if (row.length >= 2 && Math.max(...hs) - Math.min(...hs) < 0.2 * Math.max(...hs)) for (const sh of SHEARS.slice(0, 3)) if (consider(decodeRow(row, theta, sh, 1.5, cands))) return best;
  return best;
}

export interface GlyphRead extends TextRead { method: 'glyph' }
interface Segment { items: Item[]; theta: number; res: RowResult }

function segmentsOf(res: RowResult, accept: number): Segment[] {
  const out: Segment[] = [];
  let cur: Item[] = [];
  const flush = (): void => {
    if (!cur.length) return;
    const mean = cur.reduce((a, b) => a + b.d, 0) / cur.length;
    const chars = cur.map((i) => i.ch);
    const solid = chars.filter((c) => !WEAK.has(c)).length;
    // one glyph on its own is a stray stroke (a quote mark of a bigger size, a symbol's corner) far more often than text
    // (a digit read very cleanly may be the start of a string whose marks went to the next glyph; the merge pass joins it back)
    const lone = cur.length === 1 && !(/\d/.test(cur[0].ch) && cur[0].d <= 0.035);
    // only strings a drawing could say take strokes away from the other readings (a junk read in a small size must not eat
    // the serif of a letter in a bigger one)
    const words = textOf(cur, 1, 0).split(' ').map((w) => w).filter(Boolean);
    const fixed = contextRepair(cur.map((i) => i.ch)).join('');
    const sensible = words.length > 1 ? words.some((w) => plausibleText(contextRepair([...w]).join(''), mean)) : plausibleText(fixed, mean) || (cur.length === 1 && /\d/.test(cur[0].ch));
    if (mean <= accept && solid >= 1 && !lone && sensible) out.push({ items: cur, theta: res.theta, res });
    cur = [];
  };
  for (const it of res.items) { if (!it.t || it.d > accept) flush(); else cur.push(it); }
  flush();
  return out;
}

// ---------------------------------------------------------------- joining runs that the blobs cut apart
type Seg = { seg: Segment; ids: number[] };
/** Two runs on one baseline, one size, close along the reading direction, are one string (marks may sit on either side of a cut). */
function mergeSegments(ms: Seg[]): Seg[] {
  const info = (m: Seg): { s: number; a0: number; a1: number } => {
    const res = m.seg.res; const s = res.H / CAP_H;
    return { s, a0: res.origin + Math.min(...m.seg.items.map((i) => i.u0)) * s, a1: res.origin + Math.max(...m.seg.items.map((i) => i.u1)) * s };
  };
  const sorted = [...ms].sort((x, y) => x.seg.theta - y.seg.theta || info(x).a0 - info(y).a0);
  const used = new Set<Seg>(); const out: Seg[] = [];
  for (const A0 of sorted) {
    if (used.has(A0)) continue;
    used.add(A0);
    let cur = A0;
    for (let guard = 0; guard < 12; guard++) {
      const ia = info(cur);
      let next: Seg | null = null;
      for (const B of sorted) {
        if (used.has(B) || B.seg.theta !== cur.seg.theta) continue;
        const ra = cur.seg.res, rb = B.seg.res, ib = info(B);
        const H = Math.max(ra.H, rb.H);
        if (Math.abs(ra.baseline - rb.baseline) > 0.3 * H || H / Math.min(ra.H, rb.H) > 1.3) continue;
        const gap = ib.a0 - ia.a1;
        if (gap < -0.15 * H || gap > 1.6 * H) continue;
        // the cut falls inside a word when the gap is no wider than the glyphs' own spacing allows
        const lastA = [...cur.seg.items].sort((x, y) => x.u1 - y.u1)[cur.seg.items.length - 1];
        const firstB = [...B.seg.items].sort((x, y) => x.u0 - y.u0)[0];
        if (!lastA.t || !firstB.t) continue;
        const expected = (lastA.t.advance - lastA.t.box[2]) + firstB.t.box[0];
        if (gap / (ra.H / CAP_H) - expected > SPACE_GAP) continue;
        if (!next || ib.a0 < info(next).a0) next = B;
      }
      if (!next) break;
      used.add(next);
      const ra = cur.seg.res, rb = next.seg.res, sa = ra.H / CAP_H, sb = rb.H / CAP_H;
      const moved = next.seg.items.map((it) => ({ ...it, u0: (rb.origin + it.u0 * sb - ra.origin) / sa, u1: (rb.origin + it.u1 * sb - ra.origin) / sa }));
      const items = [...cur.seg.items, ...moved].sort((x, y) => x.u0 - y.u0);
      cur = { seg: { items, theta: cur.seg.theta, res: ra }, ids: [...cur.ids, ...next.ids] };
    }
    out.push(cur);
  }
  return out;
}

// ---------------------------------------------------------------- context
/**
 * O and 0, I and 1 and l, are the same shape in many stroke fonts. A word with other digits or length marks in it is a number,
 * a word with other letters is a word; the lookalikes follow.
 */
function contextRepair(chars: string[]): string[] {
  const amb = new Set(['O', 'o', '0', 'I', '1', 'l']);
  const digits = chars.filter((c) => /[2-9]/.test(c)).length;
  const marks = chars.filter((c) => /['"\-./½¼¾]/.test(c)).length;
  const letters = chars.filter((c) => /[A-Za-z]/.test(c) && !amb.has(c)).length;
  const numeric = digits + marks > 0 && digits + marks >= letters;
  const texty = letters >= 2 && letters > digits + marks;
  if (numeric === texty) return chars;
  return chars.map((c) => (numeric ? (c === 'O' || c === 'o' ? '0' : c === 'I' || c === 'l' ? '1' : c) : texty ? (c === '0' ? 'O' : c === '1' ? 'I' : c) : c));
}

// ---------------------------------------------------------------- the reader
const ODD = new Set('@#$%&*^~`\\|{}[]<>?_+;'.split(''));
const DIRS = [0, 270, 90, 180];

/** Read every run of stroke text on a page. */
export function readGlyphs(page: VectorPage, opts: GlyphOptions = {}): { reads: GlyphRead[]; consumed: Set<number> } {
  const maxGlyph = opts.maxGlyph ?? 0.05 * Math.max(page.width, page.height);
  const accept = opts.accept ?? 0.12;
  const trust = opts.tentativeTo ?? 0.07;
  const comps = components(page, maxGlyph);
  const cands = templates();
  const reads: GlyphRead[] = [];
  const consumed = new Set<number>();
  const allMatches: { seg: Segment; ids: number[] }[] = [];
  const gapOf = (a: Comp, b: Comp): number => {
    const gx = Math.max(0, Math.max(a.box[0], b.box[0]) - Math.min(a.box[2], b.box[2])), gy = Math.max(0, Math.max(a.box[1], b.box[1]) - Math.min(a.box[3], b.box[3]));
    return hypot(gx, gy);
  };
  // Text on a drawing is set in a few sizes. For each size class (largest first) the glyph pieces of about that size are linked
  // when they sit close to each other, small marks (a dash, a quote, a dot) are attached to the nearest piece, and each blob is
  // decoded in the four reading directions. A symbol of another size therefore can never chain text into a giant blob.
  const takenStrokes = new Set<number>();
  const minClass = Math.max(2.4, 0.0025 * Math.max(page.width, page.height));
  const bins = new Map<number, number>();
  for (const c of comps) if (!c.single && c.size >= minClass) { const k = Math.floor(Math.log(c.size) / Math.log(1.15)); bins.set(k, Math.max(bins.get(k) ?? 0, c.size)); }
  // largest first: a bigger class must read its own strings (and the marks beside them) before a smaller class can mistake those marks for text
  const classes = [...bins.entries()].sort((x, y) => y[0] - x[0]).map(([, v]) => v);
  for (const S of classes) {
    const here = components(page, maxGlyph, takenStrokes, 1.55 * S);
    const elig = here.filter((c) => !c.single && c.size >= 0.5 * S && c.size <= 1.3 * S);
    if (!elig.length) continue;
    const eligSet = new Set(elig);
    const marks = here.filter((c) => !eligSet.has(c) && (c.single ? c.size <= 1.45 * S : c.size < 0.5 * S));
    const cell = 3 * S;
    const grid = new Map<string, number[]>();
    const cellOf = (c: Comp): [number, number] => [Math.floor((c.box[0] + c.box[2]) / 2 / cell), Math.floor((c.box[1] + c.box[3]) / 2 / cell)];
    elig.forEach((c, i) => { const [cx, cy] = cellOf(c); const k = `${cx},${cy}`; const g = grid.get(k); if (g) g.push(i); else grid.set(k, [i]); });
    const near = (c: Comp, fn: (j: number) => void): void => { const [cx, cy] = cellOf(c); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) fn(j); };
    const parent = elig.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
    elig.forEach((a, i) => near(a, (j) => { if (j > i && gapOf(a, elig[j]) <= 1.4 * Math.min(a.size, elig[j].size)) parent[find(i)] = find(j); }));
    const blobs = new Map<number, Comp[]>();
    elig.forEach((c, i) => { const r = find(i); const g = blobs.get(r); if (g) g.push(c); else blobs.set(r, [c]); });
    const attachedTo = new Map<Comp, number>();
    const tryAttach = (m: Comp): boolean => {
      let best = -1, bg = Infinity;
      near(m, (j) => {
        const g = elig[j];
        if (m.single && m.size > 1.45 * g.size) return;
        const gap = gapOf(m, g);
        if (gap > 1.3 * g.size || gap >= bg) return;
        bg = gap; best = j;
      });
      if (best < 0) {
        // a second quote or dot beside a mark that already belongs to a blob
        for (const [o, root] of attachedTo) { if (o !== m && gapOf(m, o) <= 0.5 * S && m.size <= 1.45 * S) { best = root; break; } }
      }
      if (best >= 0) { blobs.get(find(best))!.push(m); attachedTo.set(m, best); return true; }
      return false;
    };
    const left = marks.filter((m) => !tryAttach(m));
    for (const m of left) tryAttach(m);
    for (const blob of blobs.values()) {
      if (blob.length > 120) continue;
      let remaining = blob;
      for (let pass = 0; pass < 2 && remaining.length; pass++) {
        let chosen: { segs: Segment[]; used: Set<Comp>; cost: number } | null = null;
        for (const theta of DIRS) {
          const rc = remaining.map((c) => toReading(c, theta));
          const rows = makeRows(rc);
          // a wrong direction splits the blob into many one-piece rows
          if (remaining.length >= 4 && rows.length > 0.7 * remaining.length) continue;
          const segs: Segment[] = []; const used = new Set<Comp>(); let cost = 0;
          for (const row of rows) {
            const r = bestRow(row, theta, cands, 0.05);
            if (!r) continue;
            for (const sg of segmentsOf(r, accept)) { segs.push(sg); for (const it of sg.items) for (const rc2 of it.comps) used.add(rc2.c); cost += sg.items.reduce((a, b) => a + b.d, 0); }
          }
          // an upside-down or sideways reading often matches other glyphs well, so every direction is scored, and a reading that
          // needs characters no dimension or label uses (@ # * and the like) pays for each one
          const odd = segs.reduce((a, sg) => a + sg.items.filter((i) => ODD.has(i.ch)).length, 0);
          // numbers do not start with a zero (900 turned over reads 006)
          const zeroLed = segs.reduce((a, sg) => a + (/^0\d/.test(sg.items.map((i) => i.ch).join('')) ? 1 : 0), 0);
          const score = cost + 0.09 * odd + 0.12 * zeroLed + (remaining.length - used.size) * 0.12;
          if (!chosen || score < chosen.cost) chosen = { segs, used, cost: score };
        }
        if (!chosen || !chosen.used.size) break;
        for (const sg of chosen.segs) allMatches.push({ seg: sg, ids: sg.items.flatMap((it) => it.comps.flatMap((r) => r.c.strokes)) });
        for (const c of chosen.used) for (const id of c.strokes) takenStrokes.add(id);
        remaining = remaining.filter((c) => !chosen!.used.has(c));
      }
    }
  }
  allMatches.splice(0, allMatches.length, ...mergeSegments(allMatches));
  // shape clusters among the glyphs that were read, by the character they were read as
  type G = { it: Item; pts: Pt[]; seg: Segment };
  const byChar = new Map<string, G[]>();
  for (const m of allMatches) for (const it of m.seg.items) {
    if (!it.t) continue;
    const res = m.seg.res; const s = res.H / CAP_H;
    const polys: Pt[][] = [];
    for (const r of it.comps) for (const p of r.polys) polys.push(p.map(([u, v]) => { const gy = (res.baseline - v) / s; return [(u - it.u0) / s - res.shear * gy, gy] as Pt; }));
    const g: G = { it, pts: resample(polys, 24, 0.9), seg: m.seg };
    const arr = byChar.get(it.ch); if (arr) arr.push(g); else byChar.set(it.ch, [g]);
  }
  const clusterOf = new Map<Item, { id: number; tentative: boolean }>();
  let clusterNo = 0;
  for (const arr of byChar.values()) {
    const leaders: { g: G; id: number; ds: number[]; items: Item[] }[] = [];
    for (const g of arr) {
      // shapes are compared in their own box so size and slant noise does not split a cluster
      const gb = bboxOf(g.pts);
      let hit = leaders.find((l) => {
        const lb = bboxOf(l.g.pts);
        if (Math.abs((gb[2] - gb[0]) - (lb[2] - lb[0])) > 4 || Math.abs((gb[3] - gb[1]) - (lb[3] - lb[1])) > 3) return false;
        const A = g.pts.map((p) => [p[0] - gb[0], p[1] - gb[1]] as Pt), B = l.g.pts.map((p) => [p[0] - lb[0], p[1] - lb[1]] as Pt);
        return chamfer(A, B, 0.06) <= 0.045;
      });
      if (!hit) { hit = { g, id: clusterNo++, ds: [], items: [] }; leaders.push(hit); }
      hit.ds.push(g.it.d); hit.items.push(g.it);
    }
    for (const l of leaders) {
      const mean = l.ds.reduce((a, b) => a + b, 0) / l.ds.length;
      for (const it of l.items) clusterOf.set(it, { id: l.id, tentative: mean > trust });
    }
  }
  let n = 0;
  for (const m of allMatches) {
    const sg = m.seg; const res = sg.res;
    const s = res.H / CAP_H;
    // a segment is cut into words wherever the gap is a space; a word is one read
    const words: Item[][] = [];
    let cur: Item[] = [];
    sg.items.forEach((it, k) => {
      const prev = sg.items[k - 1];
      if (k > 0 && it.t && prev.t && it.u0 - prev.u1 - ((prev.t.advance - prev.t.box[2]) + it.t.box[0]) > SPACE_GAP) { words.push(cur); cur = []; }
      cur.push(it);
    });
    if (cur.length) words.push(cur);
    for (const items of words) {
      const fixed = contextRepair(items.map((i) => i.ch));
      items.forEach((it, k) => { if (it.t) it.ch = fixed[k]; });
      const str = items.map((i) => i.ch).join('');
      const solid = [...str].filter((c) => !WEAK.has(c)).length;
      if (!str.trim() || solid < 1 || (items.length === 1 && /[Il1i|!]/.test(str))) continue;
      const u0 = Math.min(...items.map((i) => i.u0)), u1 = Math.max(...items.map((i) => i.u1));
      const [cs, sn] = frameOf(sg.theta);
      // back to the page: reading frame (u, v) -> (x, y) = (u cs - v sn, u sn + v cs)
      const toPage = (u: number, v: number): Pt => [u * cs - v * sn, u * sn + v * cs];
      const origin = toPage(res.origin + u0 * s, res.baseline);
      const xsAll: number[] = [], ysAll: number[] = [];
      for (const it of items) for (const r of it.comps) { xsAll.push(r.c.box[0], r.c.box[2]); ysAll.push(r.c.box[1], r.c.box[3]); }
      const glyphs = items.map((it) => { const cl = clusterOf.get(it) ?? { id: -1, tentative: true }; return { ch: it.ch, d: it.d, cluster: cl.id, tentative: cl.tentative, a: (it.u0 - u0) * s, b: (it.u1 - u0) * s }; });
      const strokes = [...new Set(items.flatMap((it) => it.comps.flatMap((r) => r.c.strokes)))];
      const meanD = items.reduce((a, b) => a + b.d, 0) / items.length;
      reads.push({
        id: `g${n++}`, method: 'glyph', str, bbox: [Math.min(...xsAll), Math.min(...ysAll), Math.max(...xsAll), Math.max(...ysAll)],
        angle: wrap360(sg.theta), size: res.H / 0.72, origin, length: (u1 - u0) * s, confidence: Math.max(0.05, 0.95 - 3 * meanD),
        strokes, glyphs, tentative: glyphs.some((g) => g.tentative),
      });
      for (const id of strokes) consumed.add(id);
    }
  }
  return { reads, consumed };
}
