// C12c. SPEC 17.4 "views" and 17.7 "Reading an elevation", the geometry half: split a sheet into views (connected linework separated
// by white gaps), find the floor line, the ceiling soffit and the two end walls of an elevation, and name the blocks drawn between
// them (a window, a door, a built-in unit, a bed). Pure geometry on one normalised page (y down, page units): no metres here, no
// text, no plan. Metres come later, when a scale is known (elevation-read.ts). Nothing names a drawing, a firm or a file.
import type { VectorPage, VFill, VStroke } from '../import/types';

export type Pt = [number, number];
export type Box4 = [number, number, number, number];

/** A straight piece of linework. `h` and `v` mean axis-aligned within a third of a point. */
export interface Seg { a: Pt; b: Pt; len: number; w: number; h: boolean; v: boolean; src: 'stroke' | 'fill'; owner: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number; src: 'stroke' | 'fill'; owner: number; w: number }

const AX = 0.35;
const hyp = Math.hypot;

// ---------------------------------------------------------------- extraction
function polySegs(pts: Pt[], closed: boolean, w: number, src: 'stroke' | 'fill', owner: number, out: Seg[]): void {
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = hyp(b[0] - a[0], b[1] - a[1]);
    if (len < 0.4) continue;
    out.push({ a, b, len, w, h: Math.abs(a[1] - b[1]) <= AX, v: Math.abs(a[0] - b[0]) <= AX, src, owner });
  }
}
const ptsOf = (s: VStroke): Pt[] => s.points.map((p) => [p.x, p.y] as Pt);

/** Straight pieces of the strokes (arcs and circles left out) and of the fills' rings. */
export function segmentsOf(strokes: VStroke[], fills: VFill[]): Seg[] {
  const out: Seg[] = [];
  strokes.forEach((s, i) => { if (!s.hasCurve && s.points.length >= 2) polySegs(ptsOf(s), s.closed, s.width, 'stroke', i, out); });
  fills.forEach((f, i) => f.rings.forEach((r) => polySegs(r.map((p) => [p.x, p.y] as Pt), true, 0, 'fill', i, out)));
  return out;
}

const axisRect = (pts: Pt[]): Box4 | null => {
  let p = pts;
  if (p.length === 5 && hyp(p[0][0] - p[4][0], p[0][1] - p[4][1]) < 0.4) p = p.slice(0, 4);
  if (p.length !== 4) return null;
  for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; if (!(Math.abs(a[0] - b[0]) <= AX || Math.abs(a[1] - b[1]) <= AX)) return null; }
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const b: Box4 = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return b[2] - b[0] > 0.4 && b[3] - b[1] > 0.4 ? b : null;
};

/** Axis-aligned rectangles: closed four-point strokes and four-point fills. */
export function rectsOf(strokes: VStroke[], fills: VFill[]): Rect[] {
  const out: Rect[] = [];
  strokes.forEach((s, i) => { if (s.closed && !s.hasCurve) { const b = axisRect(ptsOf(s)); if (b) out.push({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], src: 'stroke', owner: i, w: s.width }); } });
  fills.forEach((f, i) => { if (f.rings.length === 1) { const b = axisRect(f.rings[0].map((p) => [p.x, p.y] as Pt)); if (b) out.push({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], src: 'fill', owner: i, w: 0 }); } });
  return out;
}

// ---------------------------------------------------------------- views
export interface View { id: string; box: Box4; strokes: number[]; fills: number[] }

const strokeBox = (s: VStroke): Box4 => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return [x0, y0, x1, y1];
};

/**
 * Connected groups of linework: two pieces are in one group when their boxes come within `gap` of each other. A piece that
 * spans most of the page (the sheet border) joins nothing. `skip` leaves out pieces the caller placed elsewhere (the plan).
 */
export function clusterLinework(page: VectorPage, gap: number, skip?: { stroke?: (i: number, b: Box4) => boolean; fill?: (i: number, b: Box4) => boolean }): View[] {
  interface It { kind: 'stroke' | 'fill'; i: number; b: Box4 }
  const items: It[] = [];
  const frameW = 0.6 * page.width, frameH = 0.6 * page.height;
  page.strokes.forEach((s, i) => {
    if (s.points.length < 2) return;
    const b = strokeBox(s);
    if (b[2] - b[0] > frameW && b[3] - b[1] > frameH) return;
    if (skip?.stroke?.(i, b)) return;
    items.push({ kind: 'stroke', i, b });
  });
  page.fills.forEach((f, i) => {
    if (f.bbox[2] - f.bbox[0] > frameW && f.bbox[3] - f.bbox[1] > frameH) return;
    if (skip?.fill?.(i, f.bbox)) return;
    items.push({ kind: 'fill', i, b: f.bbox });
  });
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  // sweep over x so the pairwise test stays cheap on a busy sheet
  const order = items.map((_, i) => i).sort((p, q) => items[p].b[0] - items[q].b[0]);
  for (let ai = 0; ai < n; ai++) {
    const A = items[order[ai]].b;
    for (let bi = ai + 1; bi < n; bi++) {
      const B = items[order[bi]].b;
      if (B[0] > A[2] + gap) break;
      if (B[1] > A[3] + gap || B[3] < A[1] - gap) continue;
      parent[find(order[bi])] = find(order[ai]);
    }
  }
  const groups = new Map<number, View>();
  items.forEach((it, k) => {
    const r = find(k);
    let g = groups.get(r);
    if (!g) { g = { id: `g${r}`, box: [Infinity, Infinity, -Infinity, -Infinity], strokes: [], fills: [] }; groups.set(r, g); }
    (it.kind === 'stroke' ? g.strokes : g.fills).push(it.i);
    g.box = [Math.min(g.box[0], it.b[0]), Math.min(g.box[1], it.b[1]), Math.max(g.box[2], it.b[2]), Math.max(g.box[3], it.b[3])];
  });
  return [...groups.values()];
}

// ---------------------------------------------------------------- structure of an elevation
export interface Structure {
  /** y of the floor line and of the underside of the ceiling slab, page units */
  floorY: number; soffitY: number;
  /** x of the inner faces of the two end walls (the clear width runs between them) */
  left: number; right: number;
  /** thickness of the end walls (0 when only a line was drawn) */
  wallT: number;
  /** the end walls were found as full-height pieces (otherwise the floor line's ends stand in) */
  walls: boolean;
}

const dedupe = (xs: number[], tol: number): number[] => {
  const s = [...xs].sort((a, b) => a - b); const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
};

/** The floor line, the ceiling soffit and the end walls of an elevation, or null when the group is not one. */
export function findStructure(segs: Seg[]): Structure | null {
  const H = segs.filter((s) => s.h);
  if (!H.length) return null;
  // collinear pieces of one drawn line are joined first (a floor line broken at a door is still one line)
  const rows = new Map<number, { x0: number; x1: number }[]>();
  for (const s of H) {
    const y = Math.round((s.a[1] + s.b[1]) / 2 * 2) / 2;
    const arr = rows.get(y) ?? []; arr.push({ x0: Math.min(s.a[0], s.b[0]), x1: Math.max(s.a[0], s.b[0]) }); rows.set(y, arr);
  }
  const lines: { y: number; x0: number; x1: number }[] = [];
  for (const [y, arr] of rows) {
    arr.sort((a, b) => a.x0 - b.x0);
    let cur = { ...arr[0] };
    for (const r of arr.slice(1)) { if (r.x0 <= cur.x1 + 1.2) cur.x1 = Math.max(cur.x1, r.x1); else { lines.push({ y, ...cur }); cur = { ...r }; } }
    lines.push({ y, ...cur });
  }
  const maxLen = Math.max(...lines.map((l) => l.x1 - l.x0));
  if (maxLen < 30) return null;
  const group = lines.filter((l) => l.x1 - l.x0 >= 0.97 * maxLen && Math.abs((l.x0 + l.x1) / 2 - (lines.find((q) => q.x1 - q.x0 === maxLen)!.x0 + maxLen / 2)) < 2);
  const ys = [...new Set(group.map((l) => Math.round(l.y * 2) / 2))].sort((a, b) => b - a);
  if (ys.length < 2) return null;
  const floorY = ys[0];
  const above = ys.slice(1).filter((y) => floorY - y >= 0.2 * maxLen);
  if (!above.length) return null;
  const soffitY = above[0];
  const x0 = Math.min(...group.map((l) => l.x0)), x1 = Math.max(...group.map((l) => l.x1));
  // full-height verticals: floor to soffit
  const tol = 1.6;
  const V = segs.filter((s) => s.v && Math.abs(Math.max(s.a[1], s.b[1]) - floorY) <= tol && Math.abs(Math.min(s.a[1], s.b[1]) - soffitY) <= tol);
  const xs = dedupe(V.map((s) => (s.a[0] + s.b[0]) / 2).filter((x) => x >= x0 - 2 && x <= x1 + 2), 0.8);
  if (xs.length >= 4) return { floorY, soffitY, left: xs[1], right: xs[xs.length - 2], wallT: xs[1] - xs[0], walls: true };
  if (xs.length >= 2) return { floorY, soffitY, left: xs[0], right: xs[xs.length - 1], wallT: 0, walls: true };
  return { floorY, soffitY, left: x0, right: x1, wallT: 0, walls: false };
}

// ---------------------------------------------------------------- blocks
export type BlockKind = 'unit' | 'window' | 'door' | 'bed' | 'other';
export interface Block {
  kind: BlockKind;
  /** page units */ box: Box4;
  /** the rectangles of the block (its outer outline first) */
  rects: Rect[];
  /** a rectangle drawn inside the outline (a door's panel) */
  inner: Rect[];
  /** distance of its underside above the floor, page units */
  floating: number;
}

/** Two outlines belong together when they share an edge (a mattress on its frame, a table top on its legs), not when one merely overlaps the other. */
const touches = (a: Rect, b: Rect, tol: number): boolean => {
  const xo = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), yo = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (xo > 0.5 && (Math.abs(a.y1 - b.y0) <= tol || Math.abs(b.y1 - a.y0) <= tol)) return true;
  if (yo > 0.5 && (Math.abs(a.x1 - b.x0) <= tol || Math.abs(b.x1 - a.x0) <= tol)) return true;
  return false;
};
const within = (a: Rect, o: Rect, tol: number): boolean => a.x0 >= o.x0 - tol && a.x1 <= o.x1 + tol && a.y0 >= o.y0 - tol && a.y1 <= o.y1 + tol;

/**
 * The things drawn on the wall between the end walls: connected outlines, named by what they are made of. A rectangle with
 * a panel inside that stands on the floor is a door; one clear of the floor with a cross inside is a window; a tall one cut by
 * full-height verticals is a built-in unit; three stacked outlines of one width low on the wall are a bed.
 */
export function findBlocks(segs: Seg[], rects: Rect[], st: Structure): Block[] {
  const clearH = st.floorY - st.soffitY;
  const tol = 0.9;
  const inside = rects.filter((r) => r.x0 >= st.left - tol && r.x1 <= st.right + tol && r.y0 >= st.soffitY - tol && r.y1 <= st.floorY + tol && !(r.y0 <= st.soffitY + tol && r.y1 >= st.floorY - tol));
  // an outline repeated by a fill and a stroke counts once
  const uniq: Rect[] = [];
  for (const r of inside) if (!uniq.some((q) => Math.abs(q.x0 - r.x0) < 0.5 && Math.abs(q.x1 - r.x1) < 0.5 && Math.abs(q.y0 - r.y0) < 0.5 && Math.abs(q.y1 - r.y1) < 0.5)) uniq.push(r);
  // groups of touching outlines, where an outline inside another belongs to it
  const outer = uniq.filter((r) => !uniq.some((o) => o !== r && within(r, o, 0.6) && (o.x1 - o.x0) * (o.y1 - o.y0) > (r.x1 - r.x0) * (r.y1 - r.y0) * 1.05));
  const parent = outer.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) if (touches(outer[i], outer[j], 1.5)) parent[find(j)] = find(i);
  const groups = new Map<number, Rect[]>();
  outer.forEach((r, i) => { const k = find(i); const a = groups.get(k) ?? []; a.push(r); groups.set(k, a); });
  const out: Block[] = [];
  for (const list of groups.values()) {
    const box: Box4 = [Math.min(...list.map((r) => r.x0)), Math.min(...list.map((r) => r.y0)), Math.max(...list.map((r) => r.x1)), Math.max(...list.map((r) => r.y1))];
    const bw = box[2] - box[0], bh = box[3] - box[1];
    const floating = st.floorY - box[3];
    const innerRects = uniq.filter((r) => !list.includes(r) && list.some((o) => within(r, o, 0.6)));
    // full-height verticals inside the outline
    const fullV = segs.filter((s) => s.v && s.len >= 0.93 * bh && s.a[0] > box[0] + 1 && s.a[0] < box[2] - 1 && Math.min(s.a[1], s.b[1]) <= box[1] + 1.6 && Math.max(s.a[1], s.b[1]) >= box[3] - 1.6);
    const wide = list.filter((r) => r.x1 - r.x0 >= 0.7 * bw);
    let kind: BlockKind = 'other';
    if (list.length >= 3 && wide.length >= 3 && floating <= 0.12 * clearH && bh <= 0.7 * clearH) kind = 'bed';
    else if (list.length === 1) {
      if (floating > 0.12 * clearH && bh <= 0.7 * clearH) kind = 'window';
      else if (bh >= 0.55 * clearH) kind = innerRects.length > 0 && fullV.length === 0 ? 'door' : 'unit';
    }
    out.push({ kind, box, rects: [...list].sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0)), inner: innerRects, floating });
  }
  return out.sort((a, b) => a.box[0] - b.box[0]);
}
