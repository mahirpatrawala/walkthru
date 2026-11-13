// C12c. SPEC 17.7 "Which elevation shows which wall". Finds the elevation views on every page (linework split into views, each with
// its caption), reads the key marker on the plan (a ring with tags around it), and links each view to a wall of a room on the plan.
// Three signals are scored per (view, wall) pair and the assignment is solved over all views together:
//   1. the key: the tag in the caption is the tag drawn beside the marker, and the side it sits on is the way it looks;
//   2. width: the view's clear width, at the view's own scale, against the wall's length (a ratio against the ceiling height
//      when the view has no scale of its own);
//   3. content: what stands along the wall (window, door, wardrobe, bed head) with its offsets, read as seen from inside, against
//      the plan's sequence along that wall. The mirrored order is tried too and costs a point.
// A link under 0.6 is `unverified` and handed to the broker as one question. Pure TypeScript; the elevation's reading is elevation-read.ts.
import { boxCorners, pointInPolygon } from '../core/geometry';
import type { Box, Vec2 } from '../types';
import type { ImportResult, VectorPage } from '../import/types';
import type { ProposeTrace } from '../import/propose';
import type { DimVerdict, PageVerdict } from './verify';
import type { PlanRead } from './plan-read';
import type { TextRead } from './reads';
import { captionOf } from './lexicon';
import { fitScale } from './scale-fit';
import type { ScaleFit } from './scale-fit';
import { clusterLinework, findBlocks, findStructure, rectsOf, segmentsOf } from './elevation-view';
import type { Block, Box4, Rect, Seg, Structure } from './elevation-view';

// ---------------------------------------------------------------- the plan, as the link needs it
export interface WallRef {
  roomId: string; edge: number;
  /** u runs from p to q: clockwise on the plan, the left-to-right of someone inside the room facing the wall */
  p: Vec2; q: Vec2; length: number; mid: Vec2;
  /** the edge's own start (for edge-relative offsets) */
  reversed: boolean;
}
export type FeatureKind = 'unit' | 'window' | 'door' | 'bed';
export interface PlanFeature { kind: FeatureKind; u0: number; u1: number; /** furniture item id, opening id */ id: string }
export interface PlanItem { id: string; cls: string; box: Box; label: string; fromSymbol: boolean }

/** Every wall of every room: the room polygon's edges (positive area, so they already run clockwise). */
export function wallsOf(result: ImportResult): WallRef[] {
  const out: WallRef[] = [];
  for (const r of result.proposal.rooms) {
    const n = r.polygon.length;
    for (let e = 0; e < n; e++) {
      const p = r.polygon[e], q = r.polygon[(e + 1) % n];
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length < 0.4) continue;
      out.push({ roomId: r.id, edge: e, p, q, length, mid: { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, reversed: false });
    }
  }
  return out;
}

const FURN_CLS: Record<string, string> = { wardrobe: 'wardrobe', bed: 'bed', counter: 'table', study: 'table', desk: 'table', 'side table': 'table', 'tv unit': 'table', dressing: 'wardrobe' };
/** Furniture on the plan: the importer's items, and the furniture symbols it did not turn into one. */
export function planItems(result: ImportResult, plan: PlanRead): PlanItem[] {
  const out: PlanItem[] = result.extras.furniture.map((f) => ({ id: f.id, cls: FURN_CLS[f.kind] ?? f.kind, box: f.box, label: f.label ?? '', fromSymbol: false }));
  for (const s of plan.symbols) {
    if (!s.furniture) continue;
    const cls = FURN_CLS[s.cls] ?? s.cls;
    if (out.some((i) => i.cls === cls && Math.hypot(i.box.cx - s.box.cx, i.box.cz - s.box.cz) < 0.6)) continue;
    out.push({ id: s.id, cls, box: s.box, label: '', fromSymbol: true });
  }
  return out;
}

const distToLine = (a: Vec2, p: Vec2, q: Vec2): { d: number; t: number } => {
  const L = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  const ux = (q.x - p.x) / L, uz = (q.z - p.z) / L;
  return { d: Math.abs((a.x - p.x) * -uz + (a.z - p.z) * ux), t: (a.x - p.x) * ux + (a.z - p.z) * uz };
};

/** What stands on or is cut into a wall, in u (metres from p along the wall). */
export function featuresOnWall(w: WallRef, result: ImportResult, items: PlanItem[]): PlanFeature[] {
  const out: PlanFeature[] = [];
  for (const o of result.proposal.openings) {
    if (o.roomId !== w.roomId || o.edge !== w.edge) continue;
    const kind: FeatureKind | null = o.type === 'window' ? 'window' : o.type === 'door' ? 'door' : null;
    if (!kind) continue;
    out.push({ kind, u0: o.centreM - o.widthM / 2, u1: o.centreM + o.widthM / 2, id: o.id });
  }
  const room = result.proposal.rooms.find((r) => r.id === w.roomId);
  for (const it of items) {
    const kind: FeatureKind | null = it.cls === 'wardrobe' ? 'unit' : it.cls === 'bed' ? 'bed' : null;
    if (!kind) continue;
    const c = boxCorners(it.box);
    // the side of the box that lies on the wall: two neighbouring corners within a hand of the wall line, inside its span
    let best: { u0: number; u1: number; gap: number } | null = null;
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const da = distToLine(a, w.p, w.q), db = distToLine(b, w.p, w.q);
      const gap = Math.max(da.d, db.d);
      const u0 = Math.min(da.t, db.t), u1 = Math.max(da.t, db.t);
      if (gap > 0.14 || u1 - u0 < 0.25 || u0 < -0.15 || u1 > w.length + 0.15) continue;
      if (!best || gap < best.gap) best = { u0, u1, gap };
    }
    if (!best) continue;
    // the item must be inside the room that owns the wall
    if (room && !pointInPolygon({ x: it.box.cx, z: it.box.cz }, room.polygon)) continue;
    out.push({ kind, u0: Math.max(0, best.u0), u1: Math.min(w.length, best.u1), id: it.id });
  }
  return out.sort((a, b) => a.u0 - b.u0);
}

// ---------------------------------------------------------------- views
export interface Caption { text: string; tag: string; parentTag: string | null; internal: boolean; box: Box4 }
export interface ViewDim {
  v: DimVerdict; vertical: boolean; horizontal: boolean;
  /** measured end points, page units, y down */
  x0: number; y0: number; x1: number; y1: number;
}
export interface ElevView {
  id: string; page: number; box: Box4;
  /** floor, soffit and end walls; null for an internal view (a unit seen from inside, no wall) */
  st: Structure | null;
  internal: boolean;
  caption: Caption | null;
  /** the page's linework as the view was read from (text strokes already taken out) */
  segs: Seg[]; rects: Rect[]; blocks: Block[];
  dims: ViewDim[];
  /** a scale from this view's own dimensions */
  fit: ScaleFit | null;
}

const insideBox = (x: number, y: number, b: Box4, pad = 0): boolean => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;

function planZone(result: ImportResult, trace: ProposeTrace): Box4 | null {
  if (!trace.frame || !result.proposal.rooms.length) return null;
  const k = trace.frame.ptPerM;
  const pts = result.proposal.rooms.flatMap((r) => r.polygon);
  const xs = pts.map((p) => p.x * k + trace.frame!.cx), ys = pts.map((p) => p.z * k + trace.frame!.cy);
  // dimension lines hug a building: a couple of metres each way, but only a little off its right side where a sheet-mate elevation starts
  return [Math.min(...xs) - 2.2 * k, Math.min(...ys) - 2.2 * k, Math.max(...xs) + 0.35 * k, Math.max(...ys) + 2.2 * k];
}

const LOOKALIKE_DIGIT: Record<string, string> = { I: '1', L: '1', O: '0', S: '5', Z: '2', B: '8' };

/**
 * Captions on a page. A caption comes out of the reader whole ("ELEVATION-3") or in pieces ("WALL", then "3", then "(INTERNAL)"),
 * because a stroke reader breaks a line at every wide space: neighbours on one baseline are joined before the caption words are looked for.
 */
export function captionsOf(reads: TextRead[]): Caption[] {
  const out: Caption[] = [];
  const level = reads.filter((r) => r.angle === 0 || r.angle === 360);
  const seen = new Set<TextRead>();
  const push = (text: string, box: Box4): void => {
    const info = captionOf(text);
    if (info) out.push({ text: text.trim(), tag: info.tag, parentTag: info.parentTag, internal: info.internal, box });
  };
  for (const r of reads) if (captionOf(r.str)) { seen.add(r); push(r.str, r.bbox); }
  // word + tag + (INTERNAL): pieces that sit on one baseline within a couple of letter heights of each other
  const sameLine = (a: TextRead, b: TextRead): boolean => Math.abs(a.origin[1] - b.origin[1]) <= 0.45 * Math.max(a.size, b.size) && b.bbox[0] - a.bbox[2] >= -0.3 * a.size && b.bbox[0] - a.bbox[2] <= 2.4 * a.size;
  for (const a of level) {
    if (seen.has(a)) continue;
    let text = a.str, box: Box4 = [...a.bbox] as Box4, tail = a;
    for (let step = 0; step < 3; step++) {
      const next = level.filter((b) => b !== tail && b !== a && sameLine(tail, b) && b.str.trim().length <= 12).sort((p, q) => p.bbox[0] - q.bbox[0])[0];
      if (!next) break;
      text = `${text} ${next.str}`; box = [Math.min(box[0], next.bbox[0]), Math.min(box[1], next.bbox[1]), Math.max(box[2], next.bbox[2]), Math.max(box[3], next.bbox[3])]; tail = next;
      if (captionOf(text)) { push(text, box); break; }
    }
  }
  return out;
}

/** Tags that look like letters but are digits where the sheet numbers its views ("I" for 1 in a stroke font). */
export function repairTags(caps: Caption[]): void {
  const numeric = caps.filter((c) => !c.internal && /^\d+$/.test(c.tag)).length;
  if (numeric < 2) return;
  for (const c of caps) {
    const fix = (t: string): string => t.replace(/^([A-Z])(?=[A-Z]?$)/, (m) => LOOKALIKE_DIGIT[m] ?? m);
    if (!c.internal && /^[ILOSZB]$/.test(c.tag)) {
      const to = LOOKALIKE_DIGIT[c.tag];
      c.text = c.text.replace(new RegExp(`${c.tag}\\s*$`, 'i'), to); c.tag = to;
    } else if (c.internal && c.parentTag && /^[ILOSZB]$/.test(c.parentTag)) { c.parentTag = fix(c.parentTag); }
  }
}

/** The caption that belongs to a view: the nearest one under it (or beside it) whose centre is not far off its horizontal extent. */
function captionFor(box: Box4, caps: Caption[], pageH: number): Caption | null {
  let best: { c: Caption; score: number } | null = null;
  for (const c of caps) {
    const cx = (c.box[0] + c.box[2]) / 2;
    const below = c.box[1] - box[3];
    if (cx < box[0] - 20 || cx > box[2] + 20) continue;
    const h = box[3] - box[1];
    if (below < -0.2 * h || below > 0.3 * pageH) continue;
    const score = below < 0 ? 0.5 * -below + 0.01 : below;
    if (!best || score < best.score) best = { c, score };
  }
  return best ? best.c : null;
}

/** Dimension lines (with their verdicts) whose middle lies in the box. */
function dimsIn(pv: PageVerdict | undefined, box: Box4): ViewDim[] {
  if (!pv) return [];
  const out: ViewDim[] = [];
  for (const v of pv.verdicts) {
    const d = v.dim;
    const mx = (d.a[0] + d.b[0]) / 2, my = (d.a[1] + d.b[1]) / 2;
    if (!insideBox(mx, my, box, 3)) continue;
    const ang = d.angle;
    out.push({ v, vertical: ang > 80 && ang < 100, horizontal: ang < 10 || ang > 170, x0: d.a[0], y0: d.a[1], x1: d.b[0], y1: d.b[1] });
  }
  return out;
}

/**
 * The page as linework: the strokes that drew a stroke-read string are taken out, except a clean closed rectangle (a mattress, a
 * bed leg, a handle) which a reader may have taken for a zero or a dash: lettering is never a rectangle.
 */
function lineworkOf(page: VectorPage, reads: TextRead[]): VectorPage {
  const drop = new Set<number>(reads.flatMap((r) => (r.method === 'glyph' ? r.strokes ?? [] : [])));
  if (!drop.size) return page;
  const rectLike = (s: VectorPage['strokes'][number]): boolean => {
    if (!s.closed || s.hasCurve || s.points.length < 4 || s.points.length > 5) return false;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return w >= 1.2 && h >= 1.2 && s.points.every((p, i) => { const q = s.points[(i + 1) % s.points.length]; return Math.abs(p.x - q.x) < 0.35 || Math.abs(p.y - q.y) < 0.35; });
  };
  return { ...page, strokes: page.strokes.filter((s, i) => !drop.has(i) || rectLike(s)) };
}

const MIN_ITEMS = 6;
export interface Discovery { views: ElevView[]; zone: Box4 | null }

/**
 * Split every page into views and keep those that are elevations (a floor line, a ceiling soffit, end walls) or internal views
 * (captioned INTERNAL, no floor). On the sheet that holds the plan, the plan's own area is left out first.
 */
export function discoverViews(result: ImportResult, trace: ProposeTrace, pagesVerdicts: PageVerdict[]): Discovery {
  const zone = planZone(result, trace);
  const views: ElevView[] = [];
  trace.pages.forEach((pg0, pi) => {
    if (trace.kinds[pi] === 'raster') return;
    const reads = trace.reads[pi];
    const pg = lineworkOf(pg0, reads);
    const caps = captionsOf(reads);
    const skipZone = pi === trace.planIdx && zone ? zone : null;
    const skip = skipZone ? { stroke: (_i: number, b: Box4) => insideBox((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, skipZone), fill: (_i: number, b: Box4) => insideBox((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, skipZone) } : undefined;
    const maxDim = Math.max(pg.width, pg.height);
    // a gap of 3% of the sheet, narrower for a group that holds more than one caption (two stacked views a short way apart)
    let groups = clusterLinework(pg, 0.03 * maxDim, skip);
    for (let gap = 0.02 * maxDim, round = 0; round < 3; round++, gap *= 0.6) {
      const next: typeof groups = [];
      let split = false;
      for (const g of groups) {
        const holds = caps.filter((c) => insideBox((c.box[0] + c.box[2]) / 2, c.box[1] - 4, g.box, 2) || (c.box[1] - g.box[3] >= -12 && c.box[1] - g.box[3] < 14 && (c.box[0] + c.box[2]) / 2 >= g.box[0] && (c.box[0] + c.box[2]) / 2 <= g.box[2]));
        if (holds.length < 2) { next.push(g); continue; }
        const sub = clusterSubset(pg, g, gap);
        if (sub.length > 1) split = true;
        next.push(...sub);
      }
      groups = next;
      if (!split) break;
    }
    // a window or a door can sit far from the walls and the floor: a group lying wholly inside another one is part of it
    groups = [...groups].sort((p, q) => (q.box[2] - q.box[0]) * (q.box[3] - q.box[1]) - (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]));
    for (let i = 0; i < groups.length; i++) {
      for (let j = groups.length - 1; j > i; j--) {
        const A = groups[i].box, B = groups[j].box;
        if (B[0] >= A[0] - 2 && B[2] <= A[2] + 2 && B[1] >= A[1] - 2 && B[3] <= A[3] + 2) {
          groups[i] = { ...groups[i], strokes: [...groups[i].strokes, ...groups[j].strokes], fills: [...groups[i].fills, ...groups[j].fills] };
          groups.splice(j, 1);
        }
      }
    }
    const pv = pagesVerdicts.find((p) => p.page === pi);
    for (const g of groups) {
      if (g.strokes.length + g.fills.length < MIN_ITEMS) continue;
      const strokes = g.strokes.map((k) => pg.strokes[k]), fills = g.fills.map((k) => pg.fills[k]);
      const segs = segmentsOf(strokes, fills);
      const rects = rectsOf(strokes, fills);
      const st = findStructure(segs);
      const cap = captionFor(g.box, caps, pg.height);
      const internal = !!cap?.internal;
      if ((!st || !st.walls) && !internal) continue;
      if (st && !internal && (st.floorY - st.soffitY < 30 || st.right - st.left < 30)) continue;
      if (st && !internal && st.right - st.left > 6 * (st.floorY - st.soffitY)) continue;
      // a box with its lines inside (a title block) has a top, a bottom and two sides, but it is one drawn rectangle, not a wall
      if (st && !internal && rects.some((r) => r.src === 'stroke' && Math.abs(r.x0 - st.left) < 2.5 && Math.abs(r.x1 - st.right) < 2.5 && Math.abs(r.y0 - st.soffitY) < 2.5 && Math.abs(r.y1 - st.floorY) < 2.5)) continue;
      const dims = dimsIn(pv, g.box);
      const pairs = dims.filter((d) => !d.v.dim.run.parts.some((p) => p.tentative)).map((d) => ({ id: d.v.dim.id, lenPt: d.v.dim.lengthPt, valueM: d.v.dim.run.parsed.m, group: d.v.dim.chain ?? d.v.dim.id, source: 'dimension' as const }));
      const fit = fitScale(pairs);
      const useSt = internal ? null : st;
      views.push({
        id: `ev${views.length + 1}`, page: pi, box: g.box, st: useSt, internal, caption: cap,
        segs, rects, blocks: useSt ? findBlocks(segs, rects, useSt) : [], dims, fit,
      });
    }
  });
  repairTags(views.map((v) => v.caption).filter((c): c is Caption => !!c));
  return { views, zone };
}

function clusterSubset(pg: VectorPage, g: { strokes: number[]; fills: number[] }, gap: number): ReturnType<typeof clusterLinework> {
  const ss = new Set(g.strokes), ff = new Set(g.fills);
  return clusterLinework(pg, gap, { stroke: (i) => !ss.has(i), fill: (i) => !ff.has(i) });
}

// ---------------------------------------------------------------- the key marker
export interface KeyMarker { page: number; centre: [number, number]; roomId: string | null; tags: { tag: string; side: 'N' | 'E' | 'S' | 'W'; at: [number, number] }[] }

/**
 * A key marker on the plan: a small ring with tags beside it, one on each side it looks toward. Found from the ring and the
 * one-character reads that sit around it. Returns null when there is none or fewer than three tags read.
 */
export function findKeyMarker(result: ImportResult, trace: ProposeTrace, extraReads: TextRead[] = []): KeyMarker | null {
  const pi = trace.planIdx;
  const pg = trace.pages[pi];
  if (!trace.frame || !result.proposal.rooms.length) return null;
  const k = trace.frame.ptPerM;
  const reads = [...trace.reads[pi], ...extraReads];
  const tagReads = reads.filter((r) => /^[A-Za-z]$|^\d$/.test(r.str.trim()));
  let best: KeyMarker | null = null;
  for (const s of pg.strokes) {
    if (!s.closed || !s.hasCurve || s.points.length < 8) continue;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (w > 0.6 * k || h > 0.6 * k || w < 0.04 * k || Math.abs(w - h) > 0.2 * Math.max(w, h)) continue;
    const c: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const r = Math.max(w, h) / 2;
    const near = tagReads.filter((t) => { const tx = (t.bbox[0] + t.bbox[2]) / 2, ty = (t.bbox[1] + t.bbox[3]) / 2; const d = Math.hypot(tx - c[0], ty - c[1]); return d > 0.5 * r && d < 6 * r + 6; });
    const sides = new Map<string, { tag: string; side: 'N' | 'E' | 'S' | 'W'; at: [number, number]; d: number }>();
    for (const t of near) {
      const tx = (t.bbox[0] + t.bbox[2]) / 2, ty = (t.bbox[1] + t.bbox[3]) / 2;
      const dx = tx - c[0], dy = ty - c[1];
      const side: 'N' | 'E' | 'S' | 'W' = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
      // a tag sits on the axis of its side: the other offset is small beside the one that names the side
      if (Math.min(Math.abs(dx), Math.abs(dy)) > 0.7 * Math.max(Math.abs(dx), Math.abs(dy))) continue;
      const d = Math.hypot(dx, dy);
      const prev = sides.get(side);
      if (!prev || d < prev.d) sides.set(side, { tag: t.str.trim().toUpperCase(), side, at: [tx, ty], d });
    }
    if (sides.size < 3) continue;
    const tags = [...sides.values()].map(({ tag, side, at }) => ({ tag, side, at }));
    if (new Set(tags.map((t) => t.tag)).size < tags.length) continue;
    const centreW: Vec2 = { x: (c[0] - trace.frame.cx) / k, z: (c[1] - trace.frame.cy) / k };
    const room = result.proposal.rooms.find((rm) => pointInPolygon(centreW, rm.polygon));
    const m: KeyMarker = { page: pi, centre: c, roomId: room?.id ?? null, tags };
    if (!best || m.tags.length > best.tags.length) best = m;
  }
  return best;
}

/** The edge of a room that faces a side of the page (N is up the page, the smaller z). */
export function wallFacing(walls: WallRef[], roomId: string, side: 'N' | 'E' | 'S' | 'W'): WallRef | null {
  const mine = walls.filter((w) => w.roomId === roomId);
  // a clockwise edge runs east along a north wall, south along an east wall, west along a south wall, north along a west wall
  const want = side === 'N' ? [1, 0] : side === 'E' ? [0, 1] : side === 'S' ? [-1, 0] : [0, -1];
  let best: WallRef | null = null;
  for (const w of mine) {
    const ux = (w.q.x - w.p.x) / w.length, uz = (w.q.z - w.p.z) / w.length;
    if (ux * want[0] + uz * want[1] < 0.85) continue;
    if (!best || w.length > best.length) best = w;
  }
  return best;
}

// ---------------------------------------------------------------- scoring
export interface LinkResult {
  view: string;
  wall: { roomId: string; edge: number; mid: Vec2; length: number } | null;
  /** 0 to 1; under 0.6 the link is unverified and goes to the broker */
  confidence: number;
  /** what each signal said, for the review screen and the tests */
  evidence: { key: number; width: number; content: number; mirrored: boolean };
  /** the factor the plan's lengths were corrected by to compare them with the views' (1 unless the plan's own scale was a guess the views disagree with) */
  planScale?: number;
  /** another reading of the same view (the next best wall), when it was close */
  runnerUp?: { roomId: string; edge: number; score: number };
}
export interface ViewScale { ptPerM: number; source: 'dimensions' | 'ceiling-ratio' }

const clearWidthPt = (v: ElevView): number => (v.st ? v.st.right - v.st.left : 0);
const clearHeightPt = (v: ElevView): number => (v.st ? v.st.floorY - v.st.soffitY : 0);

/** The wall length a view implies: at its own scale, or from the ceiling it prints against its width/height ratio. */
export function impliedWallLength(v: ElevView): { lengthM: number; source: ViewScale['source'] } | null {
  if (!v.st) return null;
  if (v.fit && !v.fit.notToScale) return { lengthM: clearWidthPt(v) / v.fit.ptPerM, source: 'dimensions' };
  // the ceiling: a vertical dimension that runs floor to soffit
  const ceil = v.dims.find((d) => d.vertical && Math.abs(Math.max(d.y0, d.y1) - v.st!.floorY) <= 2 && Math.abs(Math.min(d.y0, d.y1) - v.st!.soffitY) <= 2);
  if (ceil && ceil.v.valueM >= 1.8 && ceil.v.valueM <= 4.5) return { lengthM: (clearWidthPt(v) / clearHeightPt(v)) * ceil.v.valueM, source: 'ceiling-ratio' };
  return null;
}

/**
 * When the plan's own scale is a guess (no room label or dimension agreed on it), the views can say what it should have been: a
 * factor that brings the lengths the views imply onto the plan's walls for most of them. 1 when the plan needs no correction.
 */
export function planScaleCorrection(views: ElevView[], walls: WallRef[]): number {
  const implied = views.filter((v) => v.st && !v.internal).map((v) => impliedWallLength(v)?.lengthM).filter((x): x is number => !!x);
  if (implied.length < 3 || !walls.length) return 1;
  const count = (r: number): number => implied.filter((L) => walls.some((w) => Math.abs((r * w.length) / L - 1) <= 0.03)).length;
  const base = count(1);
  let best = { r: 1, n: base };
  for (const L of implied) for (const w of walls) {
    const r = L / w.length;
    if (r < 0.45 || r > 2.2) continue;
    const n = count(r);
    if (n > best.n || (n === best.n && Math.abs(Math.log(r)) < Math.abs(Math.log(best.r)))) best = { r, n };
  }
  return best.n >= 3 && best.n >= 0.6 * implied.length && best.n > base && Math.abs(best.r - 1) > 0.04 ? best.r : 1;
}

const KIND_OF_BLOCK: Partial<Record<Block['kind'], FeatureKind>> = { unit: 'unit', window: 'window', door: 'door', bed: 'bed' };

function contentScore(v: ElevView, feats: PlanFeature[], wallLen: number, mirrored: boolean): number {
  if (!v.st) return 0;
  const W = clearWidthPt(v);
  if (W <= 0) return 0;
  const blocks = v.blocks.filter((b) => KIND_OF_BLOCK[b.kind]);
  const eb = blocks.map((b) => ({ kind: KIND_OF_BLOCK[b.kind]!, c: ((b.box[0] + b.box[2]) / 2 - v.st!.left) / W, w: (b.box[2] - b.box[0]) / W }));
  const pf = feats.map((f) => ({ kind: f.kind, c: mirrored ? 1 - (f.u0 + f.u1) / 2 / wallLen : (f.u0 + f.u1) / 2 / wallLen, w: (f.u1 - f.u0) / wallLen }));
  let s = 0;
  const used = new Set<number>();
  for (const e of eb) {
    let bestK = -1, bestD = 0.09;
    pf.forEach((p, k) => { if (used.has(k) || p.kind !== e.kind) return; const d = Math.abs(p.c - e.c); if (d < bestD) { bestD = d; bestK = k; } });
    if (bestK >= 0) { used.add(bestK); s += 1.2 - bestD * 6; } else s -= 0.8;
  }
  pf.forEach((p, k) => { if (!used.has(k) && p.kind !== 'door') s -= 0.5; });
  return s;
}

interface Cand { wi: number; total: number; key: number; width: number; content: number; mirrored: boolean }

/**
 * Link every non-internal view to a wall. `scaleOf` is the wall length a view implies (null when it cannot say).
 * Internal views take the wall of the view their caption names.
 */
export function linkViews(
  views: ElevView[], walls: WallRef[], result: ImportResult, items: PlanItem[], key: KeyMarker | null, opts: { planScaleOk?: boolean } = {},
): LinkResult[] {
  const plain = views.filter((v) => v.st && !v.internal);
  const kScale = opts.planScaleOk ? 1 : planScaleCorrection(views, walls);
  const feats = walls.map((w) => featuresOnWall(w, result, items));
  const cands = new Map<string, Cand[]>();
  for (const v of plain) {
    const implied = impliedWallLength(v);
    const tag = v.caption?.tag ?? null;
    const keySide = key && tag ? key.tags.find((t) => t.tag === tag)?.side ?? null : null;
    const list: Cand[] = [];
    walls.forEach((w, wi) => {
      let kScore = 0;
      if (key && key.roomId) {
        if (keySide) {
          const target = wallFacing(walls, key.roomId, keySide);
          kScore = target && target.roomId === w.roomId && target.edge === w.edge ? 3.5 : w.roomId === key.roomId ? -1.5 : -2.5;
        } else kScore = w.roomId === key.roomId ? 0.4 : -0.6;
      }
      let wScore = 0;
      if (implied) {
        const r = implied.lengthM / (w.length * kScale);
        const dev = Math.abs(r - 1);
        const weight = implied.source === 'dimensions' ? 1 : 0.75;
        // a graded score: two walls a few centimetres apart in length are told apart by which one the view matches more closely
        wScore = weight * (dev <= 0.09 ? 2.4 - 25 * dev : -2);
      }
      const fwd = contentScore(v, feats[wi], w.length, false);
      const rev = contentScore(v, feats[wi], w.length, true) - 1;
      const mirrored = rev > fwd;
      const cScore = Math.max(fwd, rev);
      list.push({ wi, total: kScore + wScore + cScore, key: kScore, width: wScore, content: cScore, mirrored });
    });
    list.sort((a, b) => b.total - a.total);
    cands.set(v.id, list.slice(0, 5));
  }
  // assignment over all the views: each wall at most once, a set of views usually shows one room (a point off for each extra room)
  const ids = plain.map((v) => v.id);
  let bestTotal = -Infinity; let bestPick: (Cand | null)[] = [];
  const pick: (Cand | null)[] = [];
  const dfs = (i: number, total: number): void => {
    if (i === ids.length) {
      const rooms = new Set(pick.filter((c): c is Cand => !!c).map((c) => walls[c.wi].roomId));
      const t = total - 1.5 * Math.max(0, rooms.size - 1);
      if (t > bestTotal) { bestTotal = t; bestPick = [...pick]; }
      return;
    }
    const list = cands.get(ids[i]) ?? [];
    for (const c of list) {
      if (pick.some((p) => p && p.wi === c.wi)) continue;
      pick[i] = c; dfs(i + 1, total + c.total);
    }
    pick[i] = null; dfs(i + 1, total - 1.5);
    pick.length = i;
  };
  dfs(0, 0);
  const out: LinkResult[] = [];
  plain.forEach((v, i) => {
    const c = bestPick[i] ?? null;
    if (!c) { out.push({ view: v.id, wall: null, confidence: 0, evidence: { key: 0, width: 0, content: 0, mirrored: false } }); return; }
    const w = walls[c.wi];
    const list = cands.get(v.id) ?? [];
    const second = list.find((x) => x.wi !== c.wi);
    const margin = second ? c.total - second.total : 3;
    // confidence: a key match or a clear margin makes a link; a total near zero does not
    let conf = 0.35 + 0.1 * Math.min(4, Math.max(0, c.total)) + 0.12 * Math.min(3, Math.max(0, margin));
    if (c.key >= 3) conf = Math.max(conf, 0.85);
    conf = Math.min(0.97, conf);
    out.push({
      view: v.id, wall: { roomId: w.roomId, edge: w.edge, mid: w.mid, length: w.length }, confidence: conf,
      evidence: { key: c.key, width: c.width, content: c.content, mirrored: c.mirrored }, ...(kScale !== 1 ? { planScale: kScale } : {}),
      ...(second && margin < 1.5 ? { runnerUp: { roomId: walls[second.wi].roomId, edge: walls[second.wi].edge, score: second.total } } : {}),
    });
  });
  // internal views: the wall of the view they belong to
  for (const v of views.filter((x) => x.internal)) {
    const parentTag = v.caption?.parentTag;
    const parent = parentTag ? plain.find((p) => p.caption?.tag === parentTag) : undefined;
    const pl = parent ? out.find((o) => o.view === parent.id) : undefined;
    out.push({ view: v.id, wall: pl?.wall ?? null, confidence: pl ? Math.min(pl.confidence, 0.9) : 0, evidence: { key: 0, width: 0, content: 0, mirrored: false } });
  }
  return out;
}
