// C12c. SPEC 17.7 "Reading an elevation": the levels (floor, ceiling, sills, heads, bed layers) with the vertical dimensions that end
// on them, the openings, and each built-in unit as a `UnitDesign`: bays, shutters per bay, drawer strip, base gap, loft, handle, and
// the hinge side of every bay from the handle and from the opening mark. Every number goes through 17.5: a height is `verified`
// only when its printed string agrees with the elevation's geometry at the elevation's scale, and a stack that is added up is
// checked against where its top really is. The hinge is `verified` only when the handle and the mark say the same side,
// `conflict` when they disagree, `unknown` when neither is drawn. Pure TypeScript, no plan, no files.
import type { Check, Extracted, Method, SourceRef, Status, UnitDesign } from './types';
import type { TextRead } from './reads';
import { verifyBand } from './verify';
import { tolFor } from './scale-fit';
import { parseLengthLoose } from './units';
import type { Block, Box4, Seg } from './elevation-view';
import type { ElevView, ViewDim } from './elevation-link';

const hyp = Math.hypot;
const fnv = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

export interface ReadScale { ptPerM: number; source: 'dimensions' | 'wall'; /** relative uncertainty of the scale */ delta: number; /** the scale rests on evidence the strings do not own: where a printed value and the measure disagree, the measure is the better number */ trusted: boolean; /** an independent ruler (the linked wall's length) when the view also has a scale of its own */ wall?: { ptPerM: number; delta: number } }
export type LevelKind = 'ceiling' | 'sill' | 'head' | 'bed-base' | 'mattress-top' | 'headboard-top' | 'door-head' | 'unit-top';
export interface Level { kind: LevelKind; y: number; e: Extracted<number>; block?: number }
export interface OpeningRead { type: 'window' | 'door'; box: Box4; /** metres from the left end wall's inner face (null without a scale) */ u0M: number | null; u1M: number | null; width: Extracted<number> | null; sill?: Extracted<number>; head?: Extracted<number> }
export interface HandleRead { yM: number | null; lengthM: number | null }
export interface UnitRead {
  box: Box4; u0M: number | null; u1M: number | null;
  design: UnitDesign;
  /** the unit's overall width and height */
  width: Extracted<number> | null; height: Extracted<number> | null;
  /** what each shutter's handle and opening mark said, per bay (for the review screen and the tests) */
  signals: { mark: ('left' | 'right' | null)[]; handle: ('left' | 'right' | null)[] }[];
  notes: string[];
}
export interface BedRead { box: Box4; levels: Level[] }
export interface ViewRead {
  view: string; page: number;
  scale: ReadScale | null;
  ceiling: Extracted<number> | null;
  levels: Level[];
  openings: OpeningRead[];
  units: UnitRead[];
  beds: BedRead[];
  /** the full-width unit seen from inside: zones bottom-up per bay (an internal view only) */
  interior: { zonesBottomUp: { kind: string; height: Extracted<number> }[] }[] | null;
}

// ---------------------------------------------------------------- dimension verdicts at the view's scale
export interface DimEval { status: Status; checks: Check[]; message?: string; upgraded: boolean; confidence: number }

/** The uncertainty of a scale fitted from dimensions, as C12b's judge reckons it. */
export const fitDelta = (weight: number, spread: number): number => Math.max(1 / Math.sqrt(Math.max(weight, 1)), spread / 2);
/** How close a measured length must be to a printed one to say they agree, given the scale's uncertainty; null when it cannot say. */
export function tightBand(valueM: number, delta: number): number | null {
  const tolH = tolFor(valueM);
  const tight = Math.min(verifyBand(valueM), tolH - 1.5 * delta * valueM);
  return tight < 0.25 * tolH ? null : tight;
}

/**
 * The status of every dimension in a view. Dimensions the page's models already judged keep their verdict. A dimension nothing
 * could check (no scale on its page) is checked against the view's scale when that scale is independent of it: the linked wall's
 * length is a ruler the elevation does not own.
 */
export function evaluateDims(view: ElevView, scale: ReadScale | null): Map<string, DimEval> {
  const ruler = scale ? (scale.source === 'wall' ? { ptPerM: scale.ptPerM, delta: scale.delta } : scale.wall ?? null) : null;
  const out = new Map<string, DimEval>();
  for (const d of view.dims) {
    const v = d.v;
    const base: DimEval = { status: v.status, checks: v.checks, message: v.message, upgraded: false, confidence: v.confidence };
    out.set(v.dim.id, base);
    if (v.status !== 'unverified' || !ruler || v.dim.incomplete || v.dim.run.parts.some((p) => p.tentative)) continue;
    const value = v.valueM;
    const band = tightBand(value, ruler.delta);
    if (band === null) continue;
    const got = v.dim.lengthPt / ruler.ptPerM;
    const ok = Math.abs(got - value) <= band;
    const method = v.method;
    out.set(v.dim.id, {
      status: ok ? 'verified' : 'conflict', checks: [...v.checks, { kind: 'geometry', expected: value, got, ok }],
      message: ok ? undefined : `drawing says ${v.dim.run.str}, measures ${(got).toFixed(3)} m at the wall's scale`,
      upgraded: true, confidence: ok ? (method === 'pdf-text' ? 0.97 : 0.93) : 0.3,
    });
  }
  return out;
}

// ---------------------------------------------------------------- building Extracted values
interface Ctx { view: ElevView; sheet: string; page: number; scale: ReadScale | null; dimEval: Map<string, DimEval>; reads: TextRead[] }
const SHEET_OK = /^[A-Za-z][\w\s.\-()]{0,30}$/;
function mk<T>(c: Ctx, path: string, value: T, method: Method, status: Status, confidence: number, bbox: Box4, extra: Partial<Extracted<T>> = {}): Extracted<T> {
  const source: SourceRef = { page: c.page + 1, view: c.view.id, sheet: c.sheet, bbox: bbox.map((x) => Math.round(x * 10) / 10) as Box4, ...(extra.source?.text ? { text: extra.source.text } : {}) };
  const { source: _s, ...rest } = extra; void _s;
  return { id: `ev-${fnv(`${path}|${source.page}|${source.bbox.join(',')}`)}`, value, method, status, confidence, source, checks: [], ...rest };
}

// ---------------------------------------------------------------- the level graph
interface Node { y: number; h: number | null; dims: ViewDim[]; status: Status; checks: Check[]; alt?: number; text?: string }
const NODE_TOL = 1.5;

/** Levels of an elevation: the floor is 0, each vertical dimension joins two levels, heights flow outward from the floor. */
class Levels {
  nodes: Node[] = [];
  constructor(private c: Ctx, private floorY: number) {
    this.node(floorY).h = 0;
    this.nodes[0].status = 'verified';
  }
  node(y: number): Node {
    let n = this.nodes.find((q) => Math.abs(q.y - y) <= NODE_TOL);
    if (!n) { n = { y, h: null, dims: [], status: 'unverified', checks: [] }; this.nodes.push(n); }
    return n;
  }
  /** Add the vertical dimensions, then flow heights out from the floor. */
  build(dims: ViewDim[]): void {
    const edges = dims.filter((d) => d.vertical && !d.v.dim.incomplete).map((d) => {
      const yTop = Math.min(d.y0, d.y1), yBot = Math.max(d.y0, d.y1);
      return { d, top: this.node(yTop), bot: this.node(yBot), m: d.v.valueM, ev: this.c.dimEval.get(d.v.dim.id)! };
    });
    const known = (n: Node): boolean => n.h !== null;
    let changed = true;
    const pathStatus = (a: Node[], ev: DimEval): Status => {
      const all = [...a.map((n) => n.status), ev.status];
      if (all.includes('conflict')) return 'conflict';
      if (all.includes('unverified')) return 'unverified';
      return 'verified';
    };
    // the floor is verified by definition (it is where the height is counted from)
    while (changed) {
      changed = false;
      for (const e of edges) {
        const hasTop = known(e.top), hasBot = known(e.bot);
        if (hasBot && !hasTop) {
          e.top.h = e.bot.h! + e.m; e.top.dims = [...e.bot.dims, e.d]; e.top.status = pathStatus([e.bot], e.ev);
          e.top.checks = [...e.bot.checks, ...e.ev.checks]; changed = true;
        } else if (hasTop && !hasBot) {
          e.bot.h = e.top.h! - e.m; e.bot.dims = [...e.top.dims, e.d]; e.bot.status = pathStatus([e.top], e.ev);
          e.bot.checks = [...e.top.checks, ...e.ev.checks]; changed = true;
        } else if (hasTop && hasBot) {
          // a second path to a known level: the two must agree
          const diff = (e.bot.h! + e.m) - e.top.h!;
          if (Math.abs(diff) > Math.max(0.02, 0.01 * e.m)) { e.top.status = 'conflict'; e.bot.status = 'conflict'; }
        }
      }
    }
  }
  /** Height of a y with its status: from the dimension path when there is one, else measured (needs a scale). */
  heightAt(y: number): { value: number; status: Status; node: Node | null; method: Method; checks: Check[]; measured: number | null; alt?: number } | null {
    const S = this.c.scale;
    const measured = S ? (this.floorY - y) / S.ptPerM : null;
    const n = this.nodes.find((q) => Math.abs(q.y - y) <= NODE_TOL);
    if (n && n.h !== null && n !== this.nodes[0]) {
      const method: Method = n.dims.every((d) => d.v.method === 'pdf-text') ? 'pdf-text' : n.dims.some((d) => d.v.method === 'vision') ? 'vision' : n.dims.some((d) => d.v.method === 'ocr') ? 'ocr' : 'glyph';
      let status = n.status;
      const checks = [...n.checks];
      let value = n.h; let alt: number | undefined;
      if (measured !== null && S) {
        const band = tightBand(Math.abs(n.h), S.delta);
        // a sum of several strings is held to the band of its own size: every term has its rounding
        const ok = band !== null && Math.abs(measured - n.h) <= band;
        checks.push({ kind: 'geometry', expected: n.h, got: measured, ok });
        if (!ok) status = status === 'verified' ? (band === null ? 'unverified' : 'conflict') : status;
        // printed and measured disagree beyond what the scale could blame: on a scale that can be trusted the drawing's own geometry is the number
        // the model uses, the printed one is kept beside it for the broker
        if (S.trusted && (status === 'conflict' || (band !== null && Math.abs(measured - n.h) > Math.max(band, 0.02)))) { status = 'conflict'; alt = n.h; value = measured; }
      } else if (status === 'verified') status = 'unverified'; // nothing to measure it against
      return { value, status, node: n, method: alt !== undefined ? 'vector' : method, checks, measured, ...(alt !== undefined ? { alt } : {}) };
    }
    if (n && n === this.nodes[0]) return { value: 0, status: 'verified', node: n, method: 'derived', checks: [], measured: 0 };
    if (measured !== null) return { value: measured, status: 'unverified', node: null, method: 'vector', checks: [], measured };
    return null;
  }
}

const rawWithin = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;


type H = NonNullable<ReturnType<Levels['heightAt']>>;
/** A level as an Extracted value: the printed number's path, its checks, and the printed value kept beside the measured one when they disagree. */
function levelEx(c: Ctx, path: string, h: H, bbox: Box4, text?: string): Extracted<number> {
  const printed = text ?? h.node?.dims.map((d) => d.v.dim.run.str).join(' + ') ?? h.node?.text;
  const e = mk(c, path, h.value, h.method, h.status, h.status === 'verified' ? 0.96 : h.status === 'conflict' ? 0.4 : 0.3, bbox, { unit: 'm', checks: h.checks, ...(printed ? { source: { page: 0, view: '', sheet: '', bbox, text: printed } } : {}) });
  if (h.alt !== undefined) e.alternatives = [{ value: h.alt, method: h.node?.dims.every((d) => d.v.method === 'pdf-text') ? 'pdf-text' : 'glyph', source: { ...e.source } }];
  return e;
}

// ---------------------------------------------------------------- loose length strings (a label with no dimension line)
interface Loose { read: TextRead; valueM: number }
function looseReads(view: ElevView, reads: TextRead[]): Loose[] {
  const used = new Set<TextRead>();
  for (const d of view.dims) { d.v.dim.run.parts.forEach((p) => used.add(p)); used.add(d.v.dim.run.read); }
  const out: Loose[] = [];
  for (const r of reads) {
    if (used.has(r)) continue;
    const cx = (r.bbox[0] + r.bbox[2]) / 2, cy = (r.bbox[1] + r.bbox[3]) / 2;
    if (cx < view.box[0] || cx > view.box[2] || cy < view.box[1] || cy > view.box[3]) continue;
    const p = parseLengthLoose(r.str);
    if (p) out.push({ read: r, valueM: p.m });
  }
  return out;
}

// ---------------------------------------------------------------- units
const uniqSorted = (xs: number[], tol: number): number[] => { const s = [...xs].sort((a, b) => a - b); const o: number[] = []; for (const x of s) if (!o.length || x - o[o.length - 1] > tol) o.push(x); return o; };
const noteShutters = /(\d)\s*(?:shutter|door|leaf)/i;

function horizontalRuns(segs: Seg[], box: Box4): { y: number; cover: number }[] {
  // collinear pieces joined; the cover is the share of the box's width one row spans
  const rows = new Map<number, [number, number][]>();
  for (const s of segs) {
    if (!s.h || s.src === 'fill') continue;
    const y = Math.round(((s.a[1] + s.b[1]) / 2) * 2) / 2;
    if (y <= box[1] + 1.2 || y >= box[3] - 1.2) continue;
    const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]);
    if (x1 < box[0] - 1 || x0 > box[2] + 1) continue;
    const arr = rows.get(y) ?? []; arr.push([Math.max(x0, box[0]), Math.min(x1, box[2])]); rows.set(y, arr);
  }
  const out: { y: number; cover: number }[] = [];
  for (const [y, arr] of rows) {
    arr.sort((a, b) => a[0] - b[0]);
    let cover = 0, cur = arr[0].slice() as [number, number];
    for (const r of arr.slice(1)) { if (r[0] <= cur[1] + 1.2) cur[1] = Math.max(cur[1], r[1]); else { cover += cur[1] - cur[0]; cur = r.slice() as [number, number]; } }
    cover += cur[1] - cur[0];
    out.push({ y, cover: cover / (box[2] - box[0]) });
  }
  return out;
}

function readUnit(c: Ctx, lv: Levels, block: Block, blockIdx: number): UnitRead | null {
  const st = c.view.st!;
  const [bx0, by0, bx1, by1] = block.box;
  const bh = by1 - by0;
  const segs = c.view.segs.filter((s) => !(s.v && false));
  // ---- bays: full-height verticals inside the outline. A line between two shutters of one bay runs just as high when the unit has no
  // drawer strip or loft, so the printed chain under the floor says where the bays end, and a heavier line weight does when there is no chain.
  const fullV = segs.filter((s) => s.v && s.len >= 0.93 * bh && s.a[0] > bx0 + 1 && s.a[0] < bx1 - 1 && Math.min(s.a[1], s.b[1]) <= by0 + 1.6 && Math.max(s.a[1], s.b[1]) >= by1 - 1.6);
  const fullXs = uniqSorted(fullV.map((s) => s.a[0]), 0.9);
  const chainAll = c.view.dims.filter((d) => d.horizontal && Math.min(d.y0, d.y1) > st.floorY + 3);
  const memberAnchors = uniqSorted(chainAll.flatMap((d) => [d.x0, d.x1]).filter((x) => x >= bx0 - 1.8 && x <= bx1 + 1.8), 1.8);
  const spansAll = (d: ViewDim): boolean => Math.abs(Math.min(d.x0, d.x1) - bx0) <= 1.8 && Math.abs(Math.max(d.x0, d.x1) - bx1) <= 1.8;
  const members = chainAll.filter((d) => !spansAll(d) && Math.min(d.x0, d.x1) >= bx0 - 1.8 && Math.max(d.x0, d.x1) <= bx1 + 1.8);
  let seps: number[] = fullXs;
  const innerAnchors = memberAnchors.filter((x) => x > bx0 + 2 && x < bx1 - 2);
  if (members.length >= 2 && innerAnchors.length === members.length - 1 && innerAnchors.every((x) => fullXs.some((f) => Math.abs(f - x) <= 1.8))) seps = fullXs.filter((f) => innerAnchors.some((x) => Math.abs(f - x) <= 1.8));
  else {
    const wts = [...new Set(fullV.map((s) => Math.round(s.w * 20) / 20))].sort((a, b) => b - a);
    if (wts.length >= 2) seps = uniqSorted(fullV.filter((s) => Math.round(s.w * 20) / 20 >= wts[0] - 1e-9).map((s) => s.a[0]), 0.9);
  }
  const edges = [bx0, ...seps, bx1];
  const nBays = edges.length - 1;
  const bboxOf = (x0: number, x1: number): Box4 => [x0, by0, x1, by1];
  // ---- horizontal rows that run across the unit: the drawer line and the loft line
  const rows = horizontalRuns(segs, block.box).filter((r) => r.cover >= 0.9);
  const rel = (y: number): number => (by1 - y) / bh; // 0 at the bottom, 1 at the top
  const drawerY = rows.filter((r) => rel(r.y) < 0.4).sort((a, b) => a.y - b.y)[0]?.y ?? null;
  const loftY = rows.filter((r) => rel(r.y) > 0.65).sort((a, b) => b.y - a.y)[0]?.y ?? null;
  const loftTop = loftY ?? by0;
  // ---- shutters per bay, from the verticals that run most of the way up a bay
  const midLines: number[][] = [];
  for (let i = 0; i < nBays; i++) {
    const xs = segs.filter((s) => s.v && s.a[0] > edges[i] + 1.2 && s.a[0] < edges[i + 1] - 1.2 && s.len >= 0.35 * bh && Math.min(s.a[1], s.b[1]) >= by0 - 1 && Math.max(s.a[1], s.b[1]) <= by1 + 1 && Math.max(s.a[1], s.b[1]) >= loftTop + 0.2 * bh).map((s) => s.a[0]);
    midLines.push(uniqSorted(xs, 1.2));
  }
  const shutterEdges = midLines.map((m, i) => [edges[i], ...m, edges[i + 1]]);
  // ---- opening marks: two diagonal strokes that meet in a point on a shutter's edge; handles: short bars near an edge
  const diag = segs.filter((s) => !s.h && !s.v && s.a[0] >= bx0 - 1 && s.b[0] <= bx1 + 1 && s.b[0] >= bx0 - 1 && s.a[0] <= bx1 + 1 && Math.min(s.a[1], s.b[1]) >= by0 - 1 && Math.max(s.a[1], s.b[1]) <= by1 + 1 && s.len > 0.12 * bh);
  const markOf = (x0: number, x1: number): 'left' | 'right' | null => {
    const mine = diag.filter((s) => Math.min(s.a[0], s.b[0]) >= x0 - 1.2 && Math.max(s.a[0], s.b[0]) <= x1 + 1.2);
    let left = 0, right = 0;
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const A = mine[i], B = mine[j];
      for (const pa of [A.a, A.b]) for (const pb of [B.a, B.b]) {
        if (hyp(pa[0] - pb[0], pa[1] - pb[1]) > 1.2) continue;
        // the two other ends: on the far edge, one above the other
        const oa = pa === A.a ? A.b : A.a, ob = pb === B.a ? B.b : B.a;
        if (Math.abs(oa[0] - ob[0]) > 1.5 || Math.abs(oa[1] - ob[1]) < 0.15 * bh) continue;
        const ax = pa[0];
        if (Math.abs(ax - x0) <= 1.5 && Math.abs(oa[0] - x1) <= 1.5) left++;
        else if (Math.abs(ax - x1) <= 1.5 && Math.abs(oa[0] - x0) <= 1.5) right++;
      }
    }
    return left && !right ? 'left' : right && !left ? 'right' : null;
  };
  const bars = segs.filter((s) => s.v && s.len >= 0.04 * bh && s.len <= 0.3 * bh && s.src === 'stroke' && s.a[0] > bx0 + 0.3 && s.a[0] < bx1 - 0.3 && Math.min(s.a[1], s.b[1]) >= loftTop + 0.5 && Math.max(s.a[1], s.b[1]) <= (drawerY ?? by1) - 0.5 + (drawerY ? 0 : 0) + 0);
  // a handle is drawn bolder than the lines around it
  const widths = segs.filter((s) => s.src === 'stroke' && s.w > 0).map((s) => s.w).sort((a, b) => a - b);
  const medianW = widths.length ? widths[widths.length >> 1] : 0;
  const handleOf = (x0: number, x1: number): { side: 'left' | 'right' | null; y: number | null; len: number | null } => {
    const band = 0.22 * (x1 - x0);
    const cands = bars.filter((s) => s.a[0] > x0 + 0.3 && s.a[0] < x1 - 0.3 && (s.a[0] - x0 <= band || x1 - s.a[0] <= band) && s.w >= 1.4 * medianW);
    if (cands.length !== 1) return { side: null, y: null, len: null };
    const s = cands[0];
    const side = s.a[0] - x0 < x1 - s.a[0] ? 'left' : 'right';
    return { side, y: (s.a[1] + s.b[1]) / 2, len: s.len };
  };

  // ---- hinge per bay
  const hinge: Extracted<'left' | 'right' | 'outer-edges' | 'unknown'>[] = [];
  const shutters: Extracted<number>[] = [];
  const signals: UnitRead['signals'] = [];
  const handleYs: number[] = [], handleLens: number[] = [];
  // printed chain under the floor: horizontal dimensions whose ends sit on the bay edges
  const chain = c.view.dims.filter((d) => d.horizontal && Math.min(d.y0, d.y1) > st.floorY + 3);
  const matchChain = (x0: number, x1: number): ViewDim | undefined => chain.find((d) => (rawWithin(Math.min(d.x0, d.x1), x0, 1.8) && rawWithin(Math.max(d.x0, d.x1), x1, 1.8)));
  for (let i = 0; i < nBays; i++) {
    const se = shutterEdges[i];
    const nSh = se.length - 1;
    const marks: ('left' | 'right' | null)[] = [], hands: ('left' | 'right' | null)[] = [];
    const perHinge: ('left' | 'right' | 'unknown' | 'conflict')[] = [];
    let bothAll = true;
    for (let s = 0; s < nSh; s++) {
      const m = markOf(se[s], se[s + 1]), h = handleOf(se[s], se[s + 1]);
      marks.push(m); hands.push(h.side);
      if (h.y !== null) { handleYs.push(h.y); handleLens.push(h.len!); }
      const fromHandle = h.side === 'left' ? 'right' : h.side === 'right' ? 'left' : null;
      if (m && fromHandle) { perHinge.push(m === fromHandle ? m : 'conflict'); if (m !== fromHandle) bothAll = false; }
      else if (m || fromHandle) { perHinge.push((m ?? fromHandle)!); bothAll = false; }
      else { perHinge.push('unknown'); bothAll = false; }
    }
    signals.push({ mark: marks, handle: hands });
    const box = bboxOf(edges[i], edges[i + 1]);
    let value: 'left' | 'right' | 'outer-edges' | 'unknown' = 'unknown';
    let status: Status = 'unverified';
    let alternatives: Extracted<'left' | 'right' | 'outer-edges' | 'unknown'>['alternatives'];
    if (perHinge.includes('conflict') || (nSh === 2 && marks[0] && hands[0] && hands[1] && marks[1] && false)) {
      status = 'conflict';
      const fm = (marks[0] ?? null);
      alternatives = [{ value: nSh === 2 ? 'outer-edges' : fm ?? 'unknown', method: 'vector', source: { page: c.page + 1, view: c.view.id, sheet: c.sheet, bbox: box, text: 'opening mark' } },
        { value: nSh === 2 ? 'unknown' : hands[0] === 'left' ? 'right' : hands[0] === 'right' ? 'left' : 'unknown', method: 'vector', source: { page: c.page + 1, view: c.view.id, sheet: c.sheet, bbox: box, text: 'handle' } }];
    } else if (nSh === 1 && perHinge[0] !== 'unknown') { value = perHinge[0] as 'left' | 'right'; status = bothAll ? 'verified' : 'unverified'; }
    else if (nSh === 2 && perHinge.every((p) => p !== 'unknown')) {
      // a pair hinges at its outer edges: the left shutter's hinge is on the left, the right shutter's on the right
      if (perHinge[0] === 'left' && perHinge[1] === 'right') { value = 'outer-edges'; status = bothAll ? 'verified' : 'unverified'; }
    }
    const method: Method = 'vector';
    const conf = status === 'verified' ? 0.9 : status === 'conflict' ? 0.4 : 0.35;
    const checks: Check[] = bothAll && status === 'verified' ? [{ kind: 'geometry', expected: marks[0] === 'left' ? 0 : 1, got: marks[0] === 'left' ? 0 : 1, ok: true }] : [];
    hinge.push(mk(c, `unit.hinge.${blockIdx}.${i}`, value, method, status, conf, box, { checks, ...(alternatives ? { alternatives } : {}) }));
    // shutter count: the vertical lines, corroborated by a second drawn thing (marks, handles) or a note reading "2 SHUTTER"
    const nMarks = marks.filter(Boolean).length, nHandles = hands.filter(Boolean).length;
    const corr = (nMarks === nSh && nMarks > 0) || (nHandles === nSh && nHandles > 0);
    const note = c.reads.map((r) => { const m = noteShutters.exec(r.str); const cx = (r.bbox[0] + r.bbox[2]) / 2, cy = (r.bbox[1] + r.bbox[3]) / 2; return m && cx >= edges[i] && cx <= edges[i + 1] && cy >= by0 && cy <= by1 ? Number(m[1]) : null; }).find((x) => x !== null) ?? null;
    const noteOk = note !== null && note === nSh;
    const noteBad = note !== null && note !== nSh;
    shutters.push(mk(c, `unit.shutters.${blockIdx}.${i}`, nSh, 'vector', noteBad ? 'conflict' : corr || noteOk ? 'verified' : 'unverified', noteBad ? 0.4 : corr || noteOk ? 0.9 : 0.4, box, {
      checks: corr || noteOk ? [{ kind: 'geometry', expected: nSh, got: noteOk ? note! : nMarks === nSh ? nMarks : nHandles, ok: true }] : [],
    }));
  }

  // ---- bay widths
  const S = c.scale;
  const bayWidths: Extracted<number>[] = [];
  let chainAgrees = 0;
  for (let i = 0; i < nBays; i++) {
    const d = matchChain(edges[i], edges[i + 1]);
    const box = bboxOf(edges[i], edges[i + 1]);
    if (d) {
      chainAgrees++;
      const ev = c.dimEval.get(d.v.dim.id)!;
      const method: Method = d.v.method;
      bayWidths.push(mk(c, `unit.bay.${blockIdx}.${i}`, d.v.valueM, method, ev.status, ev.confidence, box, { unit: 'm', checks: ev.checks, source: { page: 0, view: '', sheet: '', bbox: box, text: d.v.dim.run.str } }));
    } else if (S) bayWidths.push(mk(c, `unit.bay.${blockIdx}.${i}`, (edges[i + 1] - edges[i]) / S.ptPerM, 'vector', 'unverified', 0.3, box, { unit: 'm' }));
  }
  // the overall: a printed dimension across the whole unit
  const overall = chain.find((d) => rawWithin(Math.min(d.x0, d.x1), bx0, 1.8) && rawWithin(Math.max(d.x0, d.x1), bx1, 1.8));
  let width: Extracted<number> | null = null;
  if (overall) {
    const ev = c.dimEval.get(overall.v.dim.id)!;
    width = mk(c, `unit.width.${blockIdx}`, overall.v.valueM, overall.v.method, ev.status, ev.confidence, block.box, { unit: 'm', checks: ev.checks, source: { page: 0, view: '', sheet: '', bbox: block.box, text: overall.v.dim.run.str } });
  } else if (S) width = mk(c, `unit.width.${blockIdx}`, (bx1 - bx0) / S.ptPerM, 'vector', 'unverified', 0.3, block.box, { unit: 'm' });
  // bays: the lines, checked against the printed chain when there is one
  const chainMembers = chain.filter((d) => !(overall && d === overall) && Math.min(d.x0, d.x1) >= bx0 - 1.8 && Math.max(d.x0, d.x1) <= bx1 + 1.8);
  let baysStatus: Status = 'unverified'; let baysChecks: Check[] = [];
  if (chainMembers.length >= 2 && chainAgrees === nBays && chainMembers.length === nBays) { baysStatus = 'verified'; baysChecks = [{ kind: 'chain', expected: chainMembers.length, got: nBays, ok: true }]; }
  else if (chainMembers.length >= 2 && chainMembers.length !== nBays) { baysStatus = 'conflict'; baysChecks = [{ kind: 'chain', expected: chainMembers.length, got: nBays, ok: false }]; }
  const bays = mk(c, `unit.bays.${blockIdx}`, nBays, baysStatus === 'verified' ? 'derived' : 'vector', baysStatus, baysStatus === 'verified' ? 0.9 : baysStatus === 'conflict' ? 0.4 : 0.4, block.box, { unit: 'count', checks: baysChecks });

  // ---- heights through the level graph
  const hTop = lv.heightAt(by0);
  const hGap = by1 >= st.floorY - NODE_TOL ? { value: 0, status: 'unverified' as Status, node: null, method: 'vector' as Method, checks: [] as Check[], measured: 0 } : lv.heightAt(by1);
  const mkLen = (path: string, value: number, from: ReturnType<Levels['heightAt']>, to: ReturnType<Levels['heightAt']>, box: Box4, zeroIsGiven = false): Extracted<number> => {
    // a length between two levels: verified when both ends are
    const status: Status = !from || !to ? 'unverified' : from.status === 'conflict' || to.status === 'conflict' ? 'conflict' : from.status === 'verified' && to.status === 'verified' ? 'verified' : 'unverified';
    void zeroIsGiven;
    return mk(c, path, Math.max(0, value), status === 'verified' ? 'derived' : 'vector', status, status === 'verified' ? 0.9 : 0.3, box, {
      unit: 'm', checks: [...(from?.checks ?? []), ...(to?.checks ?? [])].filter((k) => k.kind === 'geometry').slice(0, 2),
      ...(status === 'verified' ? { derivedFrom: { ids: [], how: 'difference of two verified levels' } } : {}),
    });
  };
  let baseGap: Extracted<number> | undefined, drawerStrip: Extracted<number> | undefined, loft: Extracted<number> | undefined;
  const gapPt = st.floorY - by1;
  if (S || hGap?.node) {
    if (gapPt <= NODE_TOL) {
      // on the floor: zero, verified when a printed stack starts at the floor right beside the unit
      const startsAtFloor = c.view.dims.some((d) => d.vertical && Math.abs(Math.max(d.y0, d.y1) - st.floorY) <= NODE_TOL && Math.min(d.x0, d.x1) > bx1 - 2 && Math.min(d.x0, d.x1) < bx1 + 40 && c.dimEval.get(d.v.dim.id)?.status === 'verified');
      baseGap = mk(c, `unit.gap.${blockIdx}`, 0, startsAtFloor ? 'derived' : 'vector', startsAtFloor ? 'verified' : 'unverified', startsAtFloor ? 0.85 : 0.3, [bx0, by1, bx1, by1 + 1], { unit: 'm' });
    } else if (hGap) baseGap = mkLen(`unit.gap.${blockIdx}`, hGap.value, hGap, { value: 0, status: 'verified', node: null, method: 'derived', checks: [], measured: 0 }, [bx0, by1, bx1, st.floorY]);
  }
  if (drawerY !== null && hGap) { const hd = lv.heightAt(drawerY); if (hd) drawerStrip = mkLen(`unit.drawer.${blockIdx}`, hd.value - hGap.value, hd, hGap, [bx0, drawerY, bx1, by1]); }
  else if (S || hGap) drawerStrip = mk(c, `unit.drawer.${blockIdx}`, 0, 'vector', 'unverified', 0.3, [bx0, by1 - 1, bx1, by1], { unit: 'm' });
  if (loftY !== null && hTop) { const hl = lv.heightAt(loftY); if (hl) loft = mkLen(`unit.loft.${blockIdx}`, hTop.value - hl.value, hTop, hl, [bx0, by0, bx1, loftY]); }
  else if (S || hTop) loft = mk(c, `unit.loft.${blockIdx}`, 0, 'vector', 'unverified', 0.3, [bx0, by0, bx1, by0 + 1], { unit: 'm' });

  const design: UnitDesign = { bays, bayWidths, shuttersPerBay: shutters, hinge };
  if (drawerStrip) design.drawerStrip = drawerStrip;
  if (baseGap) design.baseGap = baseGap;
  if (loft) design.loft = loft;
  if (S && handleYs.length) {
    const med = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1];
    const y = (st.floorY - med(handleYs)) / S.ptPerM, len = med(handleLens) / S.ptPerM;
    design.handle = { y: mk(c, `unit.handle.y.${blockIdx}`, y, 'vector', 'unverified', 0.3, block.box, { unit: 'm' }), length: mk(c, `unit.handle.l.${blockIdx}`, len, 'vector', 'unverified', 0.3, block.box, { unit: 'm' }) };
  }
  const height = hTop ? levelEx(c, `unit.height.${blockIdx}`, hTop, block.box) : null;
  const notes = c.reads.filter((r) => { const cx = (r.bbox[0] + r.bbox[2]) / 2, cy = (r.bbox[1] + r.bbox[3]) / 2; return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1 && /[A-Za-z]{4}/.test(r.str); }).map((r) => r.str.trim());
  return {
    box: block.box, u0M: S ? (bx0 - st.left) / S.ptPerM : null, u1M: S ? (bx1 - st.left) / S.ptPerM : null,
    design, width, height, signals, notes,
  };
}

// ---------------------------------------------------------------- the view
export function readView(view: ElevView, scale: ReadScale | null, dimEval: Map<string, DimEval>, reads: TextRead[], sheet: string): ViewRead {
  const st = view.st;
  const base: ViewRead = { view: view.id, page: view.page, scale, ceiling: null, levels: [], openings: [], units: [], beds: [], interior: null };
  const cap = view.caption?.text ?? sheet;
  const c: Ctx = { view, sheet: SHEET_OK.test(cap) ? cap : '', page: view.page, scale, dimEval, reads };
  if (view.internal || !st) { base.interior = readInterior(c, view, scale); return base; }
  const lv = new Levels(c, st.floorY);
  lv.build(view.dims);
  const S = scale;
  // ---- the ceiling: the level at the soffit
  const hc = lv.heightAt(st.soffitY);
  if (hc) {
    const e = levelEx(c, 'ceiling', hc, [view.box[0], st.soffitY, view.box[2], st.soffitY + 1]);
    base.ceiling = e; base.levels.push({ kind: 'ceiling', y: st.soffitY, e });
  }
  const loose = S ? looseReads(view, reads) : [];
  // ---- blocks
  view.blocks.forEach((b, bi) => {
    if (b.kind === 'unit') { const u = readUnit(c, lv, b, bi); if (u) { base.units.push(u); if (u.height) base.levels.push({ kind: 'unit-top', y: b.box[1], e: u.height, block: bi }); } }
    else if (b.kind === 'window' || b.kind === 'door') {
      const sillY = b.box[3], headY = b.box[1];
      let hs = lv.heightAt(sillY);
      // a sill printed as a loose label under the window (no dimension line of its own): the label stands for the level when it matches the measure
      if (b.kind === 'window' && S && hs && hs.node === null) {
        const near = loose.filter((l) => { const cx = (l.read.bbox[0] + l.read.bbox[2]) / 2, cy = (l.read.bbox[1] + l.read.bbox[3]) / 2; return cx >= b.box[0] - 25 && cx <= b.box[2] + 25 && cy > sillY && cy < st.floorY; });
        const band = tightBand(hs.measured ?? 1, S.delta);
        const hit = near.find((l) => band !== null && Math.abs(l.valueM - hs!.measured!) <= band);
        if (hit) {
          const node = lv.node(sillY); node.h = hit.valueM; node.status = 'verified'; node.dims = [];
          node.checks = [{ kind: 'geometry', expected: hit.valueM, got: hs.measured!, ok: true }]; node.text = hit.read.str;
          // the head hangs off the sill: its own dimension line starts there
          lv.build(view.dims);
          hs = { value: hit.valueM, status: 'verified', node, method: hit.read.method === 'pdf-text' ? 'pdf-text' : hit.read.method === 'ocr' ? 'ocr' : 'glyph', checks: node.checks, measured: hs.measured };
        }
      }
      const hh = lv.heightAt(headY);
      const widthE = S ? mk(c, `open.w.${bi}`, (b.box[2] - b.box[0]) / S.ptPerM, 'vector', 'unverified', 0.3, b.box, { unit: 'm' }) : null;
      const o: OpeningRead = { type: b.kind, box: b.box, u0M: S ? (b.box[0] - st.left) / S.ptPerM : null, u1M: S ? (b.box[2] - st.left) / S.ptPerM : null, width: widthE };
      if (b.kind === 'window') {
        if (hs && hs.node !== null) o.sill = levelEx(c, `open.sill.${bi}`, hs, [b.box[0], sillY, b.box[2], sillY + 1]);
        else if (hs) o.sill = mk(c, `open.sill.${bi}`, hs.value, 'vector', 'unverified', 0.3, [b.box[0], sillY, b.box[2], sillY + 1], { unit: 'm' });
        if (hh) o.head = levelEx(c, `open.head.${bi}`, hh, [b.box[0], headY, b.box[2], headY + 1]);
        if (o.sill) base.levels.push({ kind: 'sill', y: sillY, e: o.sill, block: bi });
        if (o.head) base.levels.push({ kind: 'head', y: headY, e: o.head, block: bi });
      } else if (hh) {
        o.head = levelEx(c, `open.head.${bi}`, hh, [b.box[0], headY, b.box[2], headY + 1]);
        base.levels.push({ kind: 'door-head', y: headY, e: o.head, block: bi });
      }
      base.openings.push(o);
    } else if (b.kind === 'bed') {
      const wide = b.rects.filter((r) => r.x1 - r.x0 >= 0.7 * (b.box[2] - b.box[0])).sort((p, q) => q.y1 - p.y1);
      const names: LevelKind[] = ['bed-base', 'mattress-top', 'headboard-top'];
      const levels: Level[] = [];
      if (wide.length === 3) wide.forEach((r, k) => {
        const h = lv.heightAt(r.y0);
        if (!h) return;
        const e = levelEx(c, `bed.${names[k]}.${bi}`, h, [r.x0, r.y0, r.x1, r.y0 + 1]);
        levels.push({ kind: names[k], y: r.y0, e, block: bi });
      });
      base.beds.push({ box: b.box, levels }); base.levels.push(...levels);
    }
  });
  return base;
}

// ---------------------------------------------------------------- internal view of a unit: zones bottom-up per bay
function readInterior(c: Ctx, view: ElevView, scale: ReadScale | null): ViewRead['interior'] {
  void scale;
  const rects = view.rects;
  if (!rects.length) return null;
  const big = rects.reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
  const box: Box4 = [big.x0, big.y0, big.x1, big.y1];
  const bh = big.y1 - big.y0;
  const segs = view.segs;
  const seps = uniqSorted(segs.filter((s) => s.v && s.len >= 0.93 * bh && s.a[0] > box[0] + 1 && s.a[0] < box[2] - 1).map((s) => s.a[0]), 0.9);
  const edges = [box[0], ...seps, box[2]];
  const out: NonNullable<ViewRead['interior']> = [];
  // vertical dimensions to the right of the unit: the zones of the first bay
  const dims = view.dims.filter((d) => d.vertical && d.v.status !== undefined).sort((a, b) => Math.max(b.y0, b.y1) - Math.max(a.y0, a.y1));
  for (let i = 0; i < edges.length - 1; i++) {
    const ys = uniqSorted(segs.filter((s) => s.h && s.src === 'stroke' && s.a[1] > box[1] + 1.2 && s.a[1] < box[3] - 1.2 && Math.min(s.a[0], s.b[0]) <= edges[i] + 1.5 && Math.max(s.a[0], s.b[0]) >= edges[i + 1] - 1.5).map((s) => s.a[1]), 1.2).reverse();
    const levels = [box[3], ...ys, box[1]];
    const zones: { kind: string; height: Extracted<number> }[] = [];
    for (let k = 0; k + 1 < levels.length; k++) {
      const yb = levels[k], yt = levels[k + 1];
      const d = dims.find((q) => Math.abs(Math.max(q.y0, q.y1) - yb) <= 1.8 && Math.abs(Math.min(q.y0, q.y1) - yt) <= 1.8);
      const bbox: Box4 = [edges[i], yt, edges[i + 1], yb];
      if (d && i === 0) {
        const ev = c.dimEval.get(d.v.dim.id)!;
        zones.push({ kind: 'zone', height: mk(c, `int.${i}.${k}`, d.v.valueM, d.v.method, ev.status, ev.confidence, bbox, { unit: 'm', checks: ev.checks, source: { page: 0, view: '', sheet: '', bbox, text: d.v.dim.run.str } }) });
      } else if (c.scale) zones.push({ kind: 'zone', height: mk(c, `int.${i}.${k}`, (yb - yt) / c.scale.ptPerM, 'vector', 'unverified', 0.3, bbox, { unit: 'm' }) });
    }
    out.push({ zonesBottomUp: zones });
  }
  return out;
}

