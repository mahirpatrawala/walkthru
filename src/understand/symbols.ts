// C12c. SPEC 17.7 "Plan symbols with no label". Furniture and fixtures are drawn as repeated blocks, with or without a word beside
// them. Strokes that touch are grouped into candidate symbols, shapes inside another symbol become its parts, and each symbol is
// named by rules in METRES (after the plan's scale), never by position on one sheet: bed, sofa, dining set, chair, swivel chair,
// wardrobe (hanger strokes or shutter marks), desk, side table, TV unit, counter, WC, basin, shower, sink, hob. What no rule can
// name is returned as a candidate for the vision provider (C12d), which names it from a crop; a model's name is never a fact.
// Pure TypeScript. Page frame: y down, page units.
import type { Px } from '../types';
import type { VStroke } from '../import/types';

export type SymbolClassName =
  | 'bed' | 'sofa' | 'dining' | 'chair' | 'wardrobe' | 'desk' | 'side table' | 'tv unit' | 'counter'
  | 'wc' | 'basin' | 'shower' | 'sink' | 'hob';
export const FURNITURE_CLASSES: SymbolClassName[] = ['bed', 'sofa', 'dining', 'wardrobe', 'desk', 'side table', 'tv unit', 'counter'];
export const FIXTURE_CLASSES: SymbolClassName[] = ['wc', 'basin', 'shower', 'sink', 'hob', 'chair'];

/** A rectangle in page units: centre, the long and short side, and the direction of the long side. */
export interface Obb { cx: number; cy: number; a: number; b: number; ang: number; corners: Px[] }
export interface FoundSymbol {
  id: string; cls: SymbolClassName; /** 0 to 1, for ordering only */ confidence: number;
  /** the outline that sizes it, page units */ outline: Obb;
  bbox: [number, number, number, number];
  /** why the rules named it */ evidence: string;
  /** stroke count of the symbol with its parts */ strokes: number;
}
export interface SymbolCandidate { id: string; bbox: [number, number, number, number]; outline: Obb; strokes: number; sizeM: [number, number] }
export interface SymbolResult { symbols: FoundSymbol[]; candidates: SymbolCandidate[]; /** components found, for the report */ components: number }

const D2R = Math.PI / 180;

// ---------------------------------------------------------------- geometry
function obbOf(pts: Px[]): Obb {
  let best: Obb | null = null; let bestArea = Infinity;
  const n = pts.length;
  const tryAng = (ang: number): void => {
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const r of pts) { const u = r.x * c + r.y * s, v = -r.x * s + r.y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      let a = u1 - u0, b = v1 - v0, angle = ang;
      if (b > a) { [a, b] = [b, a]; angle += Math.PI / 2; }
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const cx = cu * c - cv * s, cy = cu * s + cv * c;
      const cu2 = Math.cos(angle), su2 = Math.sin(angle);
      const corner = (du: number, dv: number): Px => ({ x: cx + du * cu2 - dv * su2, y: cy + du * su2 + dv * cu2 });
      best = { cx, cy, a, b, ang: angle, corners: [corner(-a / 2, -b / 2), corner(a / 2, -b / 2), corner(a / 2, b / 2), corner(-a / 2, b / 2)] };
    }
  };
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue;
    tryAng(Math.atan2(q.y - p.y, q.x - p.x));
  }
  if (!best) tryAng(0);
  return best!;
}

interface Shape {
  i: number; s: VStroke; pts: Px[]; closed: boolean; curve: boolean;
  bbox: [number, number, number, number]; len: number;
  kind: 'rect' | 'round' | 'line' | 'poly' | 'arc';
  /** rect: its outline */ obb?: Obb;
}
const bboxOf = (pts: Px[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return [x0, y0, x1, y1];
};
const pathLen = (pts: Px[], closed: boolean): number => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (closed && pts.length > 2) L += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return L;
};

function isRectRing(pts: Px[], tolDeg = 4): boolean {
  let p = pts;
  if (p.length === 5 && Math.hypot(p[0].x - p[4].x, p[0].y - p[4].y) < 1e-6) p = p.slice(0, 4);
  if (p.length !== 4) return false;
  const c = Math.cos((90 - tolDeg) * D2R);
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], d = p[(i + 2) % 4];
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y;
    const L = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (L < 1e-9 || Math.abs(ux * vx + uy * vy) / L > c) return false;
  }
  return true;
}

function shapeOf(s: VStroke, i: number): Shape | null {
  let pts = s.points;
  if (pts.length < 2) return null;
  // a closed stroke written with its first point repeated
  const closed = s.closed || (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.3);
  if (closed && !s.closed) pts = pts.slice(0, -1);
  const bbox = bboxOf(pts);
  const len = pathLen(pts, closed);
  let kind: Shape['kind'];
  let obb: Obb | undefined;
  if (closed) {
    if (!s.hasCurve && isRectRing(pts)) { kind = 'rect'; obb = obbOf(pts); }
    else if (s.hasCurve || pts.length >= 12) kind = 'round';
    else { kind = 'poly'; }
  } else if (s.hasCurve && pts.length >= 4) kind = 'arc';
  else {
    // open: straight when every vertex sits near the chord
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = 0;
    for (const p of pts) worst = Math.max(worst, L < 1e-9 ? 0 : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
    kind = L > 0 && worst <= 0.1 * Math.max(L, 1) + 0.2 ? 'line' : 'poly';
    // an open three- or four-sided rectangle (a bed drawn open at the head) is a rectangle path
    if (kind === 'poly' && !s.hasCurve && pts.length >= 4 && pts.length <= 5) {
      const o = obbOf(pts);
      if (len >= 0.7 * 2 * (o.a + o.b) && pts.every((p) => Math.abs(p.x - Math.round(p.x)) >= 0)) { /* keep as poly; rectangles are closed in real drawings */ }
    }
  }
  return { i, s, pts, closed, curve: s.hasCurve, bbox, len, kind, obb };
}

// ---------------------------------------------------------------- grouping
interface Comp {
  id: number; shapes: Shape[]; bbox: [number, number, number, number]; children: Comp[]; parent: Comp | null;
}
const bboxArea = (b: [number, number, number, number]): number => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const contains = (a: [number, number, number, number], b: [number, number, number, number], m: number): boolean => b[0] >= a[0] - m && b[1] >= a[1] - m && b[2] <= a[2] + m && b[3] <= a[3] + m;

/**
 * Chains of strokes that meet end to end become one stroke, closed when the chain returns to its start. A rectangle exploded into
 * four lines is a rectangle again. Chaining stops at a point where three or more strokes meet.
 */
export function joinStrokes(strokes: VStroke[], eps = 0.35): VStroke[] {
  const open = strokes.map((s, i) => ({ s, i })).filter((x) => !x.s.closed && x.s.points.length >= 2 && x.s.points.length <= 40);
  if (open.length < 3) return strokes;
  const cell = Math.max(eps * 4, 1);
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const ends = new Map<string, { k: number; end: 0 | 1 }[]>();
  open.forEach((o, k) => { for (const end of [0, 1] as const) { const p = end ? o.s.points[o.s.points.length - 1] : o.s.points[0]; const kk = key(p.x, p.y); const l = ends.get(kk); if (l) l.push({ k, end }); else ends.set(kk, [{ k, end }]); } });
  const at = (k: number, end: 0 | 1): Px => (end ? open[k].s.points[open[k].s.points.length - 1] : open[k].s.points[0]);
  const near = (k: number, end: 0 | 1): { k: number; end: 0 | 1 }[] => {
    const p = at(k, end); const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    const out: { k: number; end: 0 | 1 }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of ends.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (q.k === k && q.end === end) continue;
      const e = at(q.k, q.end);
      if (Math.hypot(e.x - p.x, e.y - p.y) <= eps) out.push(q);
    }
    return out;
  };
  const used = new Set<number>(); const out: VStroke[] = []; const gone = new Set<number>();
  for (let k0 = 0; k0 < open.length; k0++) {
    if (used.has(k0)) continue;
    // walk from k0 in both directions through degree-2 nodes
    const pts: Px[] = [...open[k0].s.points]; used.add(k0);
    let curve = open[k0].s.hasCurve; let closed = false;
    let members = [k0];
    for (const dir of [1, 0] as const) {
      let k = k0, end: 0 | 1 = dir;
      for (;;) {
        // strokes meeting at this end, besides the one we came along
        const nb = near(k, end);
        const free = nb.filter((q) => !used.has(q.k) || q.k === k0);
        if (nb.length !== 1) break;
        const q = nb[0];
        if (q.k === k0 && !(q.k === k && q.end === end)) {
          // back at the start: a loop
          if (members.length >= 3 && (dir === 1 || true)) closed = true;
          break;
        }
        if (!free.length || used.has(q.k)) break;
        // the neighbour's own far end must not be shared by a third stroke (a T)
        const farEnd: 0 | 1 = q.end ? 0 : 1;
        const sp = open[q.k].s.points;
        const add = q.end === 0 ? sp : [...sp].reverse();
        if (dir === 1) pts.push(...add.slice(1)); else pts.unshift(...[...add].reverse().slice(0, -1));
        curve = curve || open[q.k].s.hasCurve;
        used.add(q.k); members.push(q.k);
        k = q.k; end = farEnd;
      }
    }
    if (members.length === 1) { used.delete(k0); continue; }
    if (!closed && pts.length >= 4 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= eps) { closed = true; pts.pop(); }
    const first = open[members[0]].s;
    out.push({ ...first, points: pts, closed, hasCurve: curve });
    members.forEach((m) => gone.add(open[m].i));
    members = [];
  }
  if (!gone.size) return strokes;
  return [...strokes.filter((_, i) => !gone.has(i)), ...out];
}

/** The closed shapes of a plan form a tree by containment; open strokes attach to the smallest closed shape that holds them. */
function buildTree(shapes: Shape[], ptPerM: number): { tops: Comp[]; count: number; loose: Shape[] } {
  const closed = shapes.filter((s) => s.closed && (s.kind === 'rect' || s.kind === 'round' || s.kind === 'poly'));
  const open = shapes.filter((s) => !closed.includes(s));
  const m = Math.max(0.5, 0.012 * ptPerM);
  const comps: Comp[] = closed.map((s, i) => ({ id: i, shapes: [s], bbox: s.bbox, children: [], parent: null }));
  const order = [...comps].sort((x, y) => bboxArea(x.bbox) - bboxArea(y.bbox));
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    for (let j = i + 1; j < order.length; j++) {
      const p = order[j];
      if (bboxArea(p.bbox) <= bboxArea(c.bbox) + 1e-6) continue;
      if (contains(p.bbox, c.bbox, m)) { c.parent = p; p.children.push(c); break; }
    }
  }
  const loose: Shape[] = [];
  for (const o of open) {
    const host = order.find((p) => contains(p.bbox, o.bbox, m));
    if (host) host.shapes.push(o); else loose.push(o);
  }
  // a small rectangle that meets a rounded shape (a cistern against its bowl) is one thing
  const tops = comps.filter((c) => !c.parent);
  const merged = new Set<Comp>();
  for (const a of tops) {
    if (merged.has(a) || a.shapes[0].kind !== 'rect') continue;
    const sa = Math.max(a.bbox[2] - a.bbox[0], a.bbox[3] - a.bbox[1]) / ptPerM;
    if (sa > 0.7 || a.children.length) continue;
    for (const b of tops) {
      if (b === a || merged.has(b) || b.shapes[0].kind !== 'round') continue;
      const sb = Math.max(b.bbox[2] - b.bbox[0], b.bbox[3] - b.bbox[1]) / ptPerM;
      if (sb > 0.75 || sb < 0.25) continue;
      const gx = Math.max(0, Math.max(a.bbox[0], b.bbox[0]) - Math.min(a.bbox[2], b.bbox[2])), gy = Math.max(0, Math.max(a.bbox[1], b.bbox[1]) - Math.min(a.bbox[3], b.bbox[3]));
      if (Math.hypot(gx, gy) > 0.06 * ptPerM) continue;
      // merge b into a: b's shapes and children become a's
      a.shapes.push(...b.shapes); a.children.push(...b.children);
      a.bbox = [Math.min(a.bbox[0], b.bbox[0]), Math.min(a.bbox[1], b.bbox[1]), Math.max(a.bbox[2], b.bbox[2]), Math.max(a.bbox[3], b.bbox[3])];
      merged.add(b);
      break;
    }
  }
  return { tops: tops.filter((c) => !merged.has(c)), count: comps.length, loose };
}

// ---------------------------------------------------------------- features of a component, in its outline's frame
interface Part { kind: Shape['kind']; /** along the long axis and across it, centre, metres from the outline centre */ u: number; v: number;
  /** extents along and across, metres */ lu: number; lv: number; len: number; shape: Shape; /** an axis-parallel line: 'long' | 'short' | 'diag' */ dir: 'long' | 'short' | 'diag' }

interface Feat {
  comp: Comp; outer: Shape | null; box: Obb; a: number; b: number; ellipse: boolean;
  parts: Part[]; allShapes: Shape[];
  rects: Part[]; rounds: Part[]; lines: Part[];
}

function flat(c: Comp): Shape[] { return [...c.shapes, ...c.children.flatMap(flat)]; }

function features(c: Comp, ptPerM: number): Feat | null {
  const shapes = flat(c);
  // the outline: the largest closed rectangle or round shape of the component
  const closed = shapes.filter((s) => (s.kind === 'rect' || s.kind === 'round') && s.closed);
  let outer: Shape | null = null;
  for (const s of closed) if (!outer || bboxArea(s.bbox) > bboxArea(outer.bbox)) outer = s;
  const all = shapes.flatMap((s) => s.pts);
  const box = outer && outer.kind === 'rect' && outer.obb ? outer.obb : obbOf(outer ? outer.pts : all);
  if (!box.a || !box.b) return null;
  const cu = Math.cos(box.ang), su = Math.sin(box.ang);
  const mk = (sh: Shape): Part => {
    const bb = sh.pts.map((p) => ({ u: ((p.x - box.cx) * cu + (p.y - box.cy) * su) / ptPerM, v: (-(p.x - box.cx) * su + (p.y - box.cy) * cu) / ptPerM }));
    const us = bb.map((p) => p.u), vs = bb.map((p) => p.v);
    const lu = Math.max(...us) - Math.min(...us), lv = Math.max(...vs) - Math.min(...vs);
    let dir: Part['dir'] = 'diag';
    if (sh.kind === 'line') {
      const a = bb[0], b = bb[bb.length - 1];
      const du = Math.abs(b.u - a.u), dv = Math.abs(b.v - a.v);
      if (dv <= 0.12 * du + 0.01) dir = 'long'; else if (du <= 0.12 * dv + 0.01) dir = 'short';
    }
    return { kind: sh.kind, u: (Math.min(...us) + Math.max(...us)) / 2, v: (Math.min(...vs) + Math.max(...vs)) / 2, lu, lv, len: sh.len / ptPerM, shape: sh, dir };
  };
  const parts = shapes.filter((s) => s !== outer).map(mk);
  return {
    comp: c, outer, box, a: box.a / ptPerM, b: box.b / ptPerM, ellipse: !!outer && outer.kind === 'round', parts, allShapes: shapes,
    rects: parts.filter((p) => p.kind === 'rect'), rounds: parts.filter((p) => p.kind === 'round'), lines: parts.filter((p) => p.kind === 'line'),
  };
}

// ---------------------------------------------------------------- the rules (metres)
const within = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;
const roundish = (p: Part): boolean => p.lu > 0 && p.lv > 0 && Math.max(p.lu, p.lv) / Math.min(p.lu, p.lv) <= 1.25;

/** Repeated short strokes across the long axis, evenly spaced: a hanger symbol row. */
function hangerRow(f: Feat): number {
  const across = f.lines.filter((l) => l.dir === 'short' && l.len >= 0.04 && l.len <= 0.85 * f.b);
  if (across.length < 5) return 0;
  const us = across.map((l) => l.u).sort((x, y) => x - y);
  const gaps = us.slice(1).map((v, i) => v - us[i]).filter((g) => g > 0.02);
  if (gaps.length < 4) return 0;
  const m = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - m) ** 2, 0) / gaps.length);
  return sd <= 0.45 * m ? across.length : 0;
}

type Verdict = { cls: SymbolClassName; confidence: number; evidence: string };

function nameIt(f: Feat): Verdict | null {
  const { a, b } = f;
  const rect = !!f.outer && f.outer.kind === 'rect';
  const round = !!f.outer && f.outer.kind === 'round';
  const roundParts = f.rounds;
  // ---- hob: a rectangle with two to four burner circles
  if (rect && within(a, 0.3, 0.95) && within(b, 0.25, 0.7)) {
    const burners = roundParts.filter((p) => roundish(p) && within(Math.max(p.lu, p.lv), 0.08, 0.26));
    if (burners.length >= 2 && burners.length <= 6 && f.rects.length === 0) return { cls: 'hob', confidence: 0.85, evidence: `${burners.length} burner circles in a ${a.toFixed(2)} x ${b.toFixed(2)} m plate` };
  }
  // ---- shower: a square with two crossing diagonals
  if (rect && within(a, 0.65, 1.3) && within(b, 0.65, 1.3) && a / b <= 1.25) {
    const diags = f.lines.filter((l) => l.dir === 'diag' && l.len >= 0.7 * Math.hypot(a, b));
    if (diags.length >= 2) return { cls: 'shower', confidence: 0.85, evidence: 'a square with two crossing diagonals' };
  }
  // ---- WC: a tank rectangle against a rounded bowl
  if (f.outer === null || !rect) {
    const bowls = f.rounds.filter((p) => within(p.lu, 0.28, 0.55) && within(p.lv, 0.3, 0.7));
    const tanks = f.rects.filter((p) => within(Math.max(p.lu, p.lv), 0.28, 0.6) && within(Math.min(p.lu, p.lv), 0.08, 0.32));
    const whole = f.comp.bbox;
    void whole;
    if ((round || f.outer === null) && bowls.length && tanks.length && within(a, 0.5, 0.95) && within(b, 0.3, 0.6)) return { cls: 'wc', confidence: 0.85, evidence: 'a tank rectangle and a rounded bowl' };
  }
  if (round && within(a, 0.3, 0.7) && within(b, 0.28, 0.6)) {
    // a bowl with a tank beside it (the component's outer happened to be the bowl)
    const tank = f.rects.find((p) => within(Math.max(p.lu, p.lv), 0.28, 0.6) && within(Math.min(p.lu, p.lv), 0.08, 0.32));
    if (tank) return { cls: 'wc', confidence: 0.8, evidence: 'a bowl with a tank' };
  }
  // ---- chair, swivel chair
  if (round && a / b <= 1.25 && within(a, 0.3, 0.7)) {
    const spokes = f.lines.filter((l) => l.len >= 0.25 * a && l.len <= 0.7 * a);
    if (spokes.length >= 4) return { cls: 'chair', confidence: 0.85, evidence: 'a seat circle with spokes (swivel chair)' };
  }
  if (rect && within(a, 0.3, 0.7) && within(b, 0.3, 0.7) && a / b <= 1.4) {
    // a back strip: a thin closed rectangle along one edge
    const strip = f.rects.find((p) => Math.min(p.lu, p.lv) <= 0.14 && Math.max(p.lu, p.lv) >= 0.7 * Math.min(a, b));
    if (strip) return { cls: 'chair', confidence: 0.85, evidence: 'a seat with a thickened back' };
  }
  // ---- basin: a small rectangle holding a wide oval
  if (rect && within(a, 0.3, 0.75) && within(b, 0.3, 0.6)) {
    const oval = f.rounds.find((p) => Math.max(p.lu, p.lv) >= 0.55 * Math.min(a, b) && Math.min(p.lu, p.lv) >= 0.4 * b * 0.5);
    if (oval && !f.rounds.every((p) => roundish(p) && Math.max(p.lu, p.lv) < 0.45 * Math.min(a, b))) return { cls: 'basin', confidence: 0.8, evidence: 'a rectangle holding a wide oval' };
  }
  // ---- side table: a small square with a diagonal or a small circle
  if (rect && within(a, 0.3, 0.65) && within(b, 0.3, 0.65) && a / b <= 1.35) {
    const diag = f.lines.some((l) => l.dir === 'diag' && l.len >= 0.7 * Math.hypot(a, b));
    const circle = f.rounds.some((p) => roundish(p) && Math.max(p.lu, p.lv) <= 0.5 * Math.min(a, b));
    if (diag || circle) return { cls: 'side table', confidence: 0.7, evidence: diag ? 'a small square crossed by a diagonal' : 'a small square with a circle' };
  }
  // ---- everything below is a long rectangle
  if (!rect) return null;
  const hangers = hangerRow(f);
  // wardrobe: a deep-enough box with hanger strokes (or shutter lines and the short back strokes)
  if (within(b, 0.42, 0.85) && a >= 0.8 && hangers >= 5) return { cls: 'wardrobe', confidence: 0.85, evidence: `${hangers} hanger strokes in a ${a.toFixed(2)} x ${b.toFixed(2)} m box` };
  // sofa: depth 0.75 to 1.05, a back line along the long side, arms or seat divisions across it
  if (within(b, 0.7, 1.08) && within(a, 1.2, 3.4)) {
    const back = f.lines.find((l) => l.dir === 'long' && l.len >= 0.7 * a && Math.abs(Math.abs(l.v) - b / 2) >= 0.06 && Math.abs(Math.abs(l.v) - b / 2) <= 0.32);
    const across = f.lines.filter((l) => l.dir === 'short' && l.len >= 0.4 * b);
    if (back && across.length >= 1) return { cls: 'sofa', confidence: 0.85, evidence: 'a long box with a back line and seat divisions' };
  }
  // bed: 0.8 to 2.4 wide, 1.75 to 2.5 long, pillow rectangles at one short end
  if (within(b, 0.8, 2.4) && within(a, 1.75, 2.6) && a / b <= 2.6) {
    const pillows = f.rects.filter((p) => Math.max(p.lu, p.lv) <= 0.8 && Math.min(p.lu, p.lv) >= 0.2 && Math.abs(Math.abs(p.u) - a / 2) <= 0.5);
    if (pillows.length >= 1) return { cls: 'bed', confidence: 0.9, evidence: `${pillows.length} pillow rectangle(s) at one end of a ${b.toFixed(2)} x ${a.toFixed(2)} m box` };
  }
  // counter (kitchen platform): with a sink or a hob inside, or simply long and shallow
  const hasFixture = f.rects.some((p) => f.rounds.some((r) => Math.abs(r.u - p.u) <= p.lu / 2 && Math.abs(r.v - p.v) <= p.lv / 2));
  if (hasFixture && within(b, 0.45, 0.8) && a >= 1.2) return { cls: 'counter', confidence: 0.85, evidence: 'a platform with a sink or a hob inside' };
  // tv unit: shallow, one line down the middle
  if (within(b, 0.28, 0.55) && within(a, 0.9, 2.4)) {
    const mid = f.lines.filter((l) => l.dir === 'long' && Math.abs(l.v) <= 0.08 && l.len >= 0.6 * a);
    if (mid.length === 1 && f.lines.length <= 3) return { cls: 'tv unit', confidence: 0.65, evidence: 'a shallow box with one line down its middle' };
  }
  // desk / counter by length: a plain box of table depth
  if (within(b, 0.4, 0.85) && within(a, 0.9, 3.6)) {
    const plainish = f.parts.length <= 3 && !f.lines.some((l) => l.dir === 'short');
    if (plainish) return a > 1.85 ? { cls: 'counter', confidence: 0.5, evidence: 'a long plain box of table depth' } : { cls: 'desk', confidence: 0.55, evidence: 'a plain box of table size' };
  }
  // bed without pillows (a plain mattress outline)
  if (within(b, 0.85, 2.2) && within(a, 1.85, 2.5) && f.parts.length >= 1 && a / b <= 2.5 && f.lines.length >= 1) return { cls: 'bed', confidence: 0.45, evidence: `a ${b.toFixed(2)} x ${a.toFixed(2)} m box with internal lines` };
  return null;
}

/** Sink bowls and hob plates are parts of a platform: look inside every component for them. */
function nameParts(top: Comp, ptPerM: number, out: FoundSymbol[], counter: { n: number }): Set<Comp> {
  const taken = new Set<Comp>();
  const walk = (c: Comp): void => {
    for (const k of c.children) walk(k);
    if (c === top) return;
    const f = features(c, ptPerM);
    if (!f || !f.outer || f.outer.kind !== 'rect') return;
    const v = nameIt(f);
    if (v && v.cls === 'hob') {
      out.push(sym(counter, 'hob', v.confidence, f, v.evidence));
      taken.add(c);
      return;
    }
    // a bowl: a rectangle of bowl size with one small circle (the drain)
    const drains = f.rounds.filter((p) => roundish(p) && Math.max(p.lu, p.lv) <= 0.1);
    if (drains.length === 1 && f.rects.length === 0 && within(f.a, 0.25, 1.05) && within(f.b, 0.25, 0.6)) {
      out.push(sym(counter, 'sink', 0.8, f, 'a bowl with a drain'));
      taken.add(c);
    }
  };
  walk(top);
  return taken;
}

function sym(counter: { n: number }, cls: SymbolClassName, confidence: number, f: Feat, evidence: string): FoundSymbol {
  const bb = bboxOf(f.allShapes.flatMap((s) => s.pts));
  return { id: `sym-${++counter.n}`, cls, confidence, outline: f.box, bbox: bb, evidence, strokes: f.allShapes.length };
}

/** Two bowls side by side are one double sink. */
function mergeSinks(found: FoundSymbol[]): FoundSymbol[] {
  const sinks = found.filter((s) => s.cls === 'sink');
  const drop = new Set<FoundSymbol>(); const add: FoundSymbol[] = [];
  for (const s of sinks) {
    if (drop.has(s)) continue;
    const mate = sinks.find((o) => o !== s && !drop.has(o) && Math.abs(o.outline.cx - s.outline.cx) + Math.abs(o.outline.cy - s.outline.cy) <= 1.6 * (s.outline.a + s.outline.b) / 2 && Math.abs(o.outline.a - s.outline.a) <= 0.2 * s.outline.a);
    if (!mate) continue;
    drop.add(s); drop.add(mate);
    const pts = [...s.outline.corners, ...mate.outline.corners];
    add.push({ ...s, id: s.id, outline: obbOf(pts), bbox: bboxOf(pts), evidence: 'two bowls side by side', strokes: s.strokes + mate.strokes });
  }
  return [...found.filter((s) => !drop.has(s)), ...add];
}

/**
 * Names the symbols of a plan. `strokes` must not include text (stroke lettering) or wall strokes; `ptPerM` is the plan's scale.
 * Components bigger than `maxM` (a border, a balcony rail, dimension rows) are not symbols.
 */
export function findPlanSymbols(strokes: VStroke[], ptPerM: number, opts: { minM?: number; maxM?: number } = {}): SymbolResult {
  const minM = opts.minM ?? 0.15, maxM = opts.maxM ?? 3.6;
  const shapes: Shape[] = [];
  joinStrokes(strokes).forEach((s, i) => {
    const sh = shapeOf(s, i);
    if (!sh) return;
    const w = (sh.bbox[2] - sh.bbox[0]) / ptPerM, h = (sh.bbox[3] - sh.bbox[1]) / ptPerM;
    if (Math.max(w, h) > maxM || sh.len < 0.4) return;
    shapes.push(sh);
  });
  const { tops: top, count: nComps } = buildTree(shapes, ptPerM);
  const counter = { n: 0 };
  let found: FoundSymbol[] = []; const candidates: SymbolCandidate[] = [];
  for (const c of top) {
    const w = (c.bbox[2] - c.bbox[0]) / ptPerM, h = (c.bbox[3] - c.bbox[1]) / ptPerM;
    if (Math.max(w, h) < minM || Math.max(w, h) > maxM) continue;
    // a symbol has a closed outline or a round part; a bare line, a dimension, a door leaf and its arc have none
    const hasLoop = flat(c).some((s) => s.closed);
    if (!hasLoop) continue;
    const taken = nameParts(c, ptPerM, found, counter);
    const f = features(c, ptPerM);
    if (!f) continue;
    const v = taken.size && f.rects.every((r) => ![...taken].some((t) => t.shapes.includes(r.shape))) ? nameIt(f) : nameIt(f);
    if (v) found.push(sym(counter, v.cls, v.confidence, f, v.evidence));
    else if (!taken.size) candidates.push({ id: `cand-${c.id}`, bbox: c.bbox, outline: f.box, strokes: f.allShapes.length, sizeM: [f.a, f.b] });
  }
  found = mergeSinks(found);
  // dining: a free table with four or more chairs around it
  const chairs = found.filter((s) => s.cls === 'chair');
  const upgraded: FoundSymbol[] = [];
  for (const s of found) {
    if (s.cls !== 'desk' && s.cls !== 'counter' && s.cls !== 'side table') { upgraded.push(s); continue; }
    const near = chairs.filter((c) => {
      const dx = Math.abs(c.outline.cx - s.outline.cx), dy = Math.abs(c.outline.cy - s.outline.cy);
      const reach = (s.outline.a + s.outline.b) / 2 + 0.5 * ptPerM;
      return Math.hypot(dx, dy) <= reach && (c.outline.a + c.outline.b) / 2 <= 0.6 * ptPerM;
    });
    // chairs on both long sides of a table of dining size
    if (near.length >= 4 && s.outline.a / ptPerM >= 1.0 && s.outline.b / ptPerM >= 0.7) upgraded.push({ ...s, cls: 'dining', confidence: 0.8, evidence: `${near.length} chairs around a ${(s.outline.b / ptPerM).toFixed(2)} x ${(s.outline.a / ptPerM).toFixed(2)} m table` });
    else upgraded.push(s);
  }
  // a plain table with chairs: round tables and tables whose outline matched no rule
  for (const c of candidates.slice()) {
    const near = chairs.filter((ch) => Math.hypot(ch.outline.cx - c.outline.cx, ch.outline.cy - c.outline.cy) <= (c.sizeM[0] + c.sizeM[1]) / 2 * ptPerM * 0.5 + 0.6 * ptPerM);
    if (near.length >= 4 && c.sizeM[0] >= 1.0 && c.sizeM[1] >= 0.7) {
      upgraded.push({ id: `sym-${++counter.n}`, cls: 'dining', confidence: 0.75, outline: c.outline, bbox: c.bbox, evidence: `${near.length} chairs around a table`, strokes: c.strokes });
      candidates.splice(candidates.indexOf(c), 1);
    }
  }
  return { symbols: upgraded, candidates, components: nComps };
}

/**
 * The type of a room that has no label, from what is drawn in it (SPEC 17.4: a bed makes a bedroom). 'other' when nothing says.
 */
export function roomTypeFromSymbols(classes: SymbolClassName[]): 'bedroom' | 'living' | 'kitchen' | 'bathroom' | 'other' {
  const has = (c: SymbolClassName): number => classes.filter((x) => x === c).length;
  if (has('wc') || has('shower') || (has('basin') && !has('bed') && !has('sofa'))) return 'bathroom';
  if (has('hob') || has('sink')) return 'kitchen';
  if (has('bed')) return 'bedroom';
  if (has('sofa') || has('dining') || has('tv unit')) return 'living';
  if (has('wardrobe') && has('desk')) return 'bedroom';
  return 'other';
}

// ---------------------------------------------------------------- door swings drawn as pieces
/**
 * A door-swing arc drawn as a chain of short straight strokes (what an exploded CAD file gives) becomes one curved stroke, so the
 * importer's door finder (which wants a quarter circle) sees it. Chains that do not turn steadily the same way are left alone.
 */
export function joinExplodedArcs(strokes: VStroke[]): VStroke[] {
  const seg: { i: number; a: Px; b: Px; len: number }[] = [];
  strokes.forEach((s, i) => { if (!s.closed && !s.hasCurve && s.points.length === 2) { const L = Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y); if (L > 0.3 && L < 40) seg.push({ i, a: s.points[0], b: s.points[1], len: L }); } });
  if (seg.length < 6) return strokes;
  const cell = 2;
  const grid = new Map<string, { si: number; end: 0 | 1 }[]>();
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  seg.forEach((s, si) => { for (const end of [0, 1] as const) { const p = end ? s.b : s.a; const k = key(p.x, p.y); const l = grid.get(k); if (l) l.push({ si, end }); else grid.set(k, [{ si, end }]); } });
  const neighbours = (p: Px, self: number): { si: number; end: 0 | 1 }[] => {
    const out: { si: number; end: 0 | 1 }[] = [];
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (q.si === self) continue;
      const e = q.end ? seg[q.si].b : seg[q.si].a;
      if (Math.hypot(e.x - p.x, e.y - p.y) <= 0.35) out.push(q);
    }
    return out;
  };
  const used = new Set<number>();
  const replaced = new Map<number, VStroke>(); const dropped = new Set<number>();
  for (let s0 = 0; s0 < seg.length; s0++) {
    if (used.has(s0)) continue;
    // walk to one end of the chain, then along it
    const chain: { si: number; flip: boolean }[] = [{ si: s0, flip: false }];
    const seen = new Set([s0]);
    for (const dir of [0, 1]) {
      let cur = { si: s0, flip: false }; let tail = dir ? seg[s0].b : seg[s0].a;
      const side: { si: number; flip: boolean }[] = [];
      for (;;) {
        const nb = neighbours(tail, cur.si).filter((q) => !seen.has(q.si) && !used.has(q.si));
        if (nb.length !== 1) break;
        const q = nb[0];
        seen.add(q.si);
        const flip = q.end === 1;
        side.push({ si: q.si, flip });
        tail = flip ? seg[q.si].a : seg[q.si].b;
        cur = { si: q.si, flip };
      }
      if (dir === 0) chain.unshift(...side.reverse().map((x) => ({ si: x.si, flip: !x.flip }))); else chain.push(...side);
    }
    if (chain.length < 6) continue;
    // order the points
    const pts: Px[] = [];
    chain.forEach((c, k) => {
      const s = seg[c.si];
      const a = c.flip ? s.b : s.a, b = c.flip ? s.a : s.b;
      if (k === 0) pts.push(a);
      pts.push(b);
    });
    // steady turning, near-equal pieces
    const turns: number[] = [];
    for (let k = 1; k + 1 < pts.length; k++) {
      const a1 = Math.atan2(pts[k].y - pts[k - 1].y, pts[k].x - pts[k - 1].x), a2 = Math.atan2(pts[k + 1].y - pts[k].y, pts[k + 1].x - pts[k].x);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      turns.push(d / D2R);
    }
    const sign = Math.sign(turns.reduce((s, t) => s + t, 0));
    if (!sign || turns.some((t) => t * sign < 1 || t * sign > 40)) continue;
    const lens = chain.map((c) => seg[c.si].len);
    const mean = lens.reduce((s, l) => s + l, 0) / lens.length;
    if (lens.some((l) => Math.abs(l - mean) > 0.4 * mean)) continue;
    const sweep = turns.reduce((s, t) => s + Math.abs(t), 0);
    if (sweep < 40) continue;
    for (const c of chain) { used.add(c.si); dropped.add(seg[c.si].i); }
    const first = strokes[seg[chain[0].si].i];
    replaced.set(seg[chain[0].si].i, { ...first, points: pts, closed: false, hasCurve: true });
    dropped.delete(seg[chain[0].si].i);
  }
  if (!replaced.size) return strokes;
  const out: VStroke[] = [];
  strokes.forEach((s, i) => { if (dropped.has(i)) return; out.push(replaced.get(i) ?? s); });
  return out;
}
