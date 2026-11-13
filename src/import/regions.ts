// C8. SPEC 13.5 step 5: room regions by flood fill, contour to polygon. Pure TypeScript.
import type { Px } from '../types';
import type { VectorPage, VStroke } from './types';
import type { RoomLabel } from './labels';
import type { Gap, WallSet } from './walls';
import { Bitmap, FREE, WALL, BARRIER, simplifyRing, mergeCollinear, ringArea } from './bitmap';

export interface RegionResult {
  label: RoomLabel;
  method: 'walls' | 'walls+strokes' | 'label-rect';
  /** page units, y down; null while still leaking (the label rectangle is built later, once the scale is known) */
  polygon: Px[] | null;
  areaPt2: number;
  /** barrier strokes that closed this region (for railing edges) */
  barrierSegments: [Px, Px][];
  /** set when the traced outline was set aside because it disagreed with the printed size by more than 5%: what the walls measured, metres */
  drawn?: { w: number; l: number };
}

interface Line { h: boolean; c: number; lo: number; hi: number }

const dist = (a: Px, b: Px): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pxSizeFor(page: VectorPage, t: number): number {
  let px = t / 4;
  while ((page.width / px) * (page.height / px) > 6e6) px *= 1.25;
  return px;
}

function rot(p: Px, a: number): Px { const c = Math.cos(a), s = Math.sin(a); return { x: c * p.x + s * p.y, y: -s * p.x + c * p.y }; }

function lineOf(a: Px, b: Px, tolDeg = 8): Line | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (ang <= tolDeg) return { h: true, c: (a.y + b.y) / 2, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) };
  if (ang >= 90 - tolDeg) return { h: false, c: (a.x + b.x) / 2, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) };
  return null;
}

/** Wall faces, gap bands and barrier strokes as snap lines, in the dominant frame. */
export function snapLines(walls: WallSet, gaps: Gap[], barriers: [Px, Px][]): Line[] {
  const out: Line[] = [];
  const d = walls.dominant;
  const addRing = (r: Px[]): void => {
    for (let i = 0; i < r.length; i++) { const l = lineOf(rot(r[i], d), rot(r[(i + 1) % r.length], d), 3); if (l) out.push(l); }
  };
  for (const p of walls.polys) addRing(p.ring);
  for (const g of gaps) addRing(g.band);
  for (const [a, b] of barriers) { const l = lineOf(rot(a, d), rot(b, d), 3); if (l) out.push(l); }
  return out;
}

export function polygonFromMask(bm: Bitmap, mask: Uint8Array, walls: WallSet, lines: Line[]): Px[] {
  const t = walls.t;
  let ring = bm.outerContour(mask);
  if (ring.length < 3) return ring;
  ring = mergeCollinear(simplifyRing(ring, 0.5 * t));
  const d = walls.dominant;
  const P = ring.map((p) => rot(p, d));
  const n = P.length;
  interface E { h: boolean | null; c: number; a: Px; b: Px }
  let edges: E[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const l = lineOf(a, b);
    edges.push(l ? { h: l.h, c: l.c, a, b } : { h: null, c: 0, a, b });
  }
  // snap axis edges onto wall faces within 1.6 pixels
  const tol = 1.6 * bm.px;
  for (const e of edges) {
    if (e.h === null) continue;
    const lo = e.h ? Math.min(e.a.x, e.b.x) : Math.min(e.a.y, e.b.y);
    const hi = e.h ? Math.max(e.a.x, e.b.x) : Math.max(e.a.y, e.b.y);
    let best: Line | null = null; let bd = tol + 1e-9;
    for (const l of lines) {
      if (l.h !== e.h) continue;
      const dd = Math.abs(l.c - e.c);
      if (dd > bd) continue;
      const ov = Math.min(hi, l.hi) - Math.max(lo, l.lo);
      if (ov < Math.min(bm.px, (hi - lo) * 0.3)) continue;
      best = l; bd = dd;
    }
    if (best) e.c = best.c;
  }
  // merge consecutive parallel edges (steps smaller than half a wall)
  let changed = true;
  while (changed && edges.length > 3) {
    changed = false;
    for (let i = 0; i < edges.length; i++) {
      const A = edges[i]; const B = edges[(i + 1) % edges.length];
      if (A.h !== null && A.h === B.h && Math.abs(A.c - B.c) <= 0.5 * t) {
        const la = Math.hypot(A.b.x - A.a.x, A.b.y - A.a.y), lb = Math.hypot(B.b.x - B.a.x, B.b.y - B.a.y);
        const c = (A.c * la + B.c * lb) / (la + lb || 1);
        edges[i] = { h: A.h, c, a: A.a, b: B.b };
        edges.splice((i + 1) % edges.length, 1);
        changed = true; break;
      }
    }
  }
  // rebuild vertices
  const m = edges.length;
  const out: Px[] = [];
  for (let i = 0; i < m; i++) {
    const A = edges[(i + m - 1) % m]; const B = edges[i];
    if (A.h !== null && B.h !== null && A.h !== B.h) out.push(A.h ? { x: B.c, y: A.c } : { x: A.c, y: B.c });
    else if (A.h !== null && B.h !== null) out.push(B.h ? { x: B.a.x, y: B.c } : { x: B.c, y: B.a.y });
    else out.push(B.a);
  }
  let res = mergeCollinear(out.map((p) => rot(p, -d)), 1e-6);
  // drop vertices closer than 0.5 t to the previous one
  const cleaned: Px[] = [];
  for (const p of res) if (!cleaned.length || dist(p, cleaned[cleaned.length - 1]) >= 0.5 * t) cleaned.push(p);
  while (cleaned.length > 3 && dist(cleaned[0], cleaned[cleaned.length - 1]) < 0.5 * t) cleaned.pop();
  res = mergeCollinear(cleaned, 1e-6);
  return res.length >= 3 ? res : ring;
}

function strokeLength(s: VStroke): number {
  let L = 0;
  for (let i = 1; i < s.points.length; i++) L += dist(s.points[i], s.points[i - 1]);
  if (s.closed && s.points.length > 2) L += dist(s.points[0], s.points[s.points.length - 1]);
  return L;
}

/** true when a wall pixel lies within `r` page units of the point */
function touchesWall(bm: Bitmap, p: Px, r: number): boolean {
  const ci = bm.ix(p.x), cj = bm.iy(p.y), n = Math.ceil(r / bm.px);
  for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
    if (di * di + dj * dj > n * n) continue;
    if (bm.get(ci + di, cj + dj) === WALL) return true;
  }
  return false;
}

/**
 * Pass 2 barrier segments. SPEC 13.5 says "every stroke segment at least 8 t long". Tightened (SPEC-GAP) to a straight
 * run of at least 8 t that spans from wall to wall: both ends touch a wall pixel. Without that, the bed a room label
 * sits on, dimension lines and extension lines slice rooms into pieces. An open polyline counts as one run (a railing
 * drawn on three sides is one stroke). Every segment must also run along a wall direction: the reference drawing's door
 * swings are exploded into straight pieces, and an arc between two walls is not a wall. Curves, the page border and
 * wall-fill hairlines are skipped.
 */
export function barrierSegments(page: VectorPage, walls: WallSet, wallPixels: Bitmap): { segs: [Px, Px][]; widths: number[] } {
  const t = walls.t;
  const segs: [Px, Px][] = []; const widths: number[] = [];
  const touch = 0.35 * t;
  const axial = (a: Px, b: Px): boolean => {
    let ang = (Math.atan2(b.y - a.y, b.x - a.x) - walls.dominant) * 180 / Math.PI;
    ang = ((ang % 90) + 90) % 90;
    return Math.min(ang, 90 - ang) <= 4;
  };
  for (const s of page.strokes) {
    if (s.hasCurve || s.points.length < 2) continue;
    if (s.closed && walls.colors.includes(s.color)) continue; // hairline outline of a wall fill
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    if (s.closed && (Math.max(...xs) - Math.min(...xs)) >= 0.7 * page.width && (Math.max(...ys) - Math.min(...ys)) >= 0.7 * page.height) continue;
    const n = s.points.length;
    if (!s.closed) {
      const total = strokeLength(s);
      let straight = true;
      for (let i = 0; i < n - 1 && straight; i++) straight = axial(s.points[i], s.points[i + 1]);
      if (straight && total >= 8 * t && touchesWall(wallPixels, s.points[0], touch) && touchesWall(wallPixels, s.points[n - 1], touch)) {
        for (let i = 0; i < n - 1; i++) { segs.push([s.points[i], s.points[i + 1]]); widths.push(s.width); }
        continue;
      }
    }
    const last = s.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = s.points[i], b = s.points[(i + 1) % n];
      if (dist(a, b) >= 8 * t && axial(a, b) && touchesWall(wallPixels, a, touch) && touchesWall(wallPixels, b, touch)) { segs.push([a, b]); widths.push(s.width); }
    }
  }
  return { segs, widths };
}

/**
 * Step 5, passes 1 and 2. Rooms that still leak come back with `polygon: null` and `method: 'label-rect'`.
 */
export function findRegions(page: VectorPage, walls: WallSet, gaps: Gap[], labels: RoomLabel[]): { regions: RegionResult[]; bitmap: Bitmap } {
  const t = walls.t;
  const px = pxSizeFor(page, t);
  const base = new Bitmap(page.width, page.height, px);
  for (const r of walls.coverage) base.fillRing(r, WALL);
  for (const g of gaps) base.fillRing(g.band, WALL);
  const seedOf = (bm: Bitmap, l: RoomLabel): [number, number] | null => bm.nearestFree(bm.ix(l.centre.x), bm.iy(l.centre.y), Math.ceil(t / px) * 2);
  const labelPix = labels.map((l) => [base.ix(l.centre.x), base.iy(l.centre.y)] as const);
  const regions: RegionResult[] = [];
  let pass2: { segs: [Px, Px][]; widths: number[] } | null = null;
  const baseLines = snapLines(walls, gaps, []);
  const attempt = (bm: Bitmap, idx: number): { mask: Uint8Array; leaked: boolean } | null => {
    const seed = seedOf(bm, labels[idx]);
    if (!seed) return null;
    const f = bm.flood(seed[0], seed[1]);
    let leaked = f.touchesBorder;
    if (!leaked) {
      for (let k = 0; k < labels.length; k++) {
        if (k === idx) continue;
        const [i, j] = labelPix[k];
        if (bm.inside(i, j) && f.mask[j * bm.nx + i] === 1) { leaked = true; break; }
      }
    }
    return { mask: f.mask, leaked };
  };
  labels.forEach((l, idx) => {
    const a1 = attempt(base, idx);
    if (a1 && !a1.leaked) {
      const poly = polygonFromMask(base, a1.mask, walls, baseLines);
      regions.push({ label: l, method: 'walls', polygon: poly, areaPt2: Math.abs(ringArea(poly)), barrierSegments: [] });
      return;
    }
    const b2 = base.clone();
    pass2 ??= barrierSegments(page, walls, base);
    const { segs, widths } = pass2;
    segs.forEach(([a, b], k) => b2.drawSegment(a, b, widths[k], BARRIER));
    const a2 = attempt(b2, idx);
    if (a2 && !a2.leaked) {
      const poly = polygonFromMask(b2, a2.mask, walls, snapLines(walls, gaps, segs));
      regions.push({ label: l, method: 'walls+strokes', polygon: poly, areaPt2: Math.abs(ringArea(poly)), barrierSegments: segs });
      return;
    }
    regions.push({ label: l, method: 'label-rect', polygon: null, areaPt2: 0, barrierSegments: [] });
  });
  return { regions, bitmap: base };
}

export { FREE };
