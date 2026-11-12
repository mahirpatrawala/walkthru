// C8 (post-commit real-file fix). A room that the drawing leaves with no door is given one at its swing arc, and when
// that happens an assumed passage along the bottom is added so the rooms join. Pure TypeScript.
import type { Opening, Px, RoomTag, Vec2 } from '../types';
import { Bitmap, BARRIER, WALL, pointInRing, ringArea } from './bitmap';
import { polygonFromMask, snapLines } from './regions';
import type { WallSet } from './walls';
import type { RoomLabel } from './labels';
import { pointInPolygon } from '../core/geometry';
import type { VectorPage } from './types';
import type { Gap } from './walls';

export interface DoorArc { centre: Px; r: number; points: Px[] }

function fitCircle(pts: Px[]): { c: Px; r: number } | null {
  const n = pts.length;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  const c = { x: (b1 * svv - b2 * suv) / det + mx, y: (b2 * suu - b1 * suv) / det + my };
  let r = 0; for (const p of pts) r += Math.hypot(p.x - c.x, p.y - c.y);
  return { c, r: r / n };
}

/** Quarter-circle-ish strokes of door size (0.55 to 1.3 m radius) that no bridged gap already explains. */
export function findDoorArcs(page: VectorPage, ptPerM: number, gaps: Gap[], t: number): DoorArc[] {
  const out: DoorArc[] = [];
  for (const s of page.strokes) {
    if (s.closed || s.points.length < 10) continue;
    const f = fitCircle(s.points);
    if (!f) continue;
    const r = f.r / ptPerM;
    if (r < 0.55 || r > 1.3) continue;
    let worst = 0; for (const p of s.points) worst = Math.max(worst, Math.abs(Math.hypot(p.x - f.c.x, p.y - f.c.y) - f.r));
    if (worst > 0.1 * f.r) continue;
    let sweep = 0; let prev = Math.atan2(s.points[0].y - f.c.y, s.points[0].x - f.c.x);
    for (let i = 1; i < s.points.length; i++) {
      const a = Math.atan2(s.points[i].y - f.c.y, s.points[i].x - f.c.x);
      let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      sweep += d; prev = a;
    }
    if (Math.abs(sweep) < (60 * Math.PI) / 180) continue;
    if (gaps.some((g) => Math.min(Math.hypot(f.c.x - g.a.x, f.c.y - g.a.y), Math.hypot(f.c.x - g.b.x, f.c.y - g.b.y)) <= 1.5 * t)) continue;
    out.push({ centre: f.c, r: f.r, points: s.points });
  }
  return out;
}

export interface ArcDoorResult { doors: Opening[]; warnings: string[]; used: Set<DoorArc> }

/**
 * For every room without an opening: a door where a swing arc hinges on one of its edges (hinge within 0.3 m of the
 * edge, arc running along it). With no hinged arc, 0.76 m at the nearest arc.
 */
export function doorsFromArcs(
  rooms: RoomTag[], openings: Opening[], arcs: DoorArc[], toWorld: (p: Px) => Vec2, used: Set<DoorArc>, existingIds: Set<string>,
): ArcDoorResult {
  const warnings: string[] = []; const doors: Opening[] = [];
  const closed = rooms.filter((r) => !openings.some((o) => o.roomId === r.id) && !doors.some((o) => o.roomId === r.id));
  for (const room of closed) {
    const poly = room.polygon; const n = poly.length;
    interface C { edge: number; dist: number; u0: number; u1: number; arc: DoorArc; hinged: boolean }
    let best: C | null = null;
    for (const arc of arcs) {
      if (used.has(arc)) continue;
      const h = toWorld(arc.centre);
      const pts = arc.points.map(toWorld);
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        const L = Math.hypot(q.x - p.x, q.z - p.z); if (L < 1e-9) continue;
        const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
        const uh = (h.x - p.x) * e.x + (h.z - p.z) * e.z;
        const off = Math.abs((h.x - p.x) * -e.z + (h.z - p.z) * e.x);
        const us = pts.map((w) => (w.x - p.x) * e.x + (w.z - p.z) * e.z);
        const far = us.reduce((a, b) => (Math.abs(b - uh) > Math.abs(a - uh) ? b : a), uh);
        const u0 = Math.min(uh, far), u1 = Math.max(uh, far);
        const hinged = off <= 0.3 && u0 >= -0.05 && u1 <= L + 0.05;
        if (!best || (hinged && !best.hinged) || (hinged === best.hinged && off < best.dist)) best = { edge: i, dist: off, u0, u1, arc, hinged };
      }
    }
    if (!best) { warnings.push(`${room.label} has no door on the drawing and no swing arc was found. Add one in the editor.`); continue; }
    used.add(best.arc);
    let { u0, u1 } = best;
    const p = poly[best.edge], q = poly[(best.edge + 1) % n];
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    if (!best.hinged) {
      const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
      const pts = best.arc.points.map(toWorld);
      const cx = pts.reduce((s, w) => s + w.x, 0) / pts.length, cz = pts.reduce((s, w) => s + w.z, 0) / pts.length;
      const u = Math.max(0.38, Math.min(L - 0.38, (cx - p.x) * e.x + (cz - p.z) * e.z));
      u0 = u - 0.38; u1 = u + 0.38;
      warnings.push(`${room.label}: no swing arc hinges on a wall, so a 0.76 m door was placed at the nearest arc.`);
    } else {
      warnings.push(`${room.label} has no door on the drawing. A door ${(u1 - u0).toFixed(2)} m wide was placed where its swing arc hinges on the wall.`);
    }
    let k = openings.length + doors.length + 1; while (existingIds.has(`door-${k}`)) k++;
    existingIds.add(`door-${k}`);
    doors.push({ id: `door-${k}`, roomId: room.id, edge: best.edge, type: 'door', centreM: (u0 + u1) / 2, widthM: u1 - u0, sillM: 0, headM: 2.1 });
  }
  return { doors, warnings, used };
}

/**
 * A corridor is as deep as most of its length. The traced region can bulge where the drawing's walls stop short (a jamb
 * block, a wall that ends before the border). Keep only the rows (or columns) between the walls that bound most of it.
 */
function trimToCorridor(bm: Bitmap, mask: Uint8Array): Uint8Array {
  const { nx, ny } = bm;
  const modal = (lines: number, len: number, at: (a: number, b: number) => boolean): { lo: number; hi: number; n: number; total: number } | null => {
    const freq = new Map<string, { lo: number; hi: number; n: number }>(); let total = 0;
    for (let a = 0; a < lines; a++) {
      let lo = -1, hi = -1;
      for (let b = 0; b < len; b++) if (at(a, b)) { if (lo < 0) lo = b; hi = b; }
      if (lo < 0) continue;
      total++;
      const k = `${lo},${hi}`; const e = freq.get(k);
      if (e) e.n++; else freq.set(k, { lo, hi, n: 1 });
    }
    let best: { lo: number; hi: number; n: number } | null = null;
    for (const e of freq.values()) if (!best || e.n > best.n) best = e;
    return best ? { ...best, total } : null;
  };
  const col = modal(nx, ny, (i, j) => mask[j * nx + i] === 1);
  const row = modal(ny, nx, (j, i) => mask[j * nx + i] === 1);
  const cands: { axis: 'col' | 'row'; depth: number; m: NonNullable<typeof col> }[] = [];
  if (col && col.n >= 0.3 * col.total) cands.push({ axis: 'col', depth: col.hi - col.lo + 1, m: col });
  if (row && row.n >= 0.3 * row.total) cands.push({ axis: 'row', depth: row.hi - row.lo + 1, m: row });
  if (!cands.length) return mask;
  cands.sort((a, b) => a.depth - b.depth);
  const c = cands[0];
  const out = new Uint8Array(mask.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!mask[j * nx + i]) continue;
    const v = c.axis === 'col' ? j : i;
    if (v >= c.m.lo && v <= c.m.hi) out[j * nx + i] = 1;
  }
  return out;
}

export interface PassageRegion { polygon: Px[]; areaPt2: number; leaksAtBorder: boolean }

/**
 * Wall-bounded regions with no label that a door or opening leads to. Flooded from `seeds` (a point just beyond each
 * door), with the labelled rooms' outlines and the drawing border as barriers so that a room the walls do not close
 * is not swallowed. A region is accepted at 1.5 to 12 m2 and at most 2.0 m wide; the exterior is neither.
 */
export function findPassages(
  base: Bitmap, walls: WallSet, gaps: Gap[], page: VectorPage, roomRings: Px[][], labels: RoomLabel[], barrierSegs: [Px, Px][], seeds: Px[], ptPerM: number,
): PassageRegion[] {
  const bm = base.clone();
  const segs: [Px, Px][] = [...barrierSegs];
  const addRing = (r: Px[]): void => { for (let i = 0; i < r.length; i++) segs.push([r[i], r[(i + 1) % r.length]]); };
  for (const r of roomRings) addRing(r);
  let borderClosed = false;
  for (const s of page.strokes) {
    if (!s.closed || s.points.length < 4) continue;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) >= 0.7 * page.width && Math.max(...ys) - Math.min(...ys) >= 0.7 * page.height) { addRing(s.points); borderClosed = true; }
  }
  void borderClosed;
  for (const [a, b] of segs) bm.drawSegment(a, b, bm.px * 1.5, BARRIER);
  const out: PassageRegion[] = [];
  const taken = new Uint8Array(bm.nx * bm.ny);
  for (const sd of seeds) {
    if (roomRings.some((r) => pointInRing(sd, r))) continue;
    const f = bm.nearestFree(bm.ix(sd.x), bm.iy(sd.y), 3);
    if (!f || taken[f[1] * bm.nx + f[0]]) continue;
    const fl = bm.flood(f[0], f[1]);
    for (let i = 0; i < fl.mask.length; i++) if (fl.mask[i]) taken[i] = 1;
    if (fl.touchesBorder) continue;
    const areaM2 = (fl.count * bm.px * bm.px) / (ptPerM * ptPerM);
    if (areaM2 < 1.5 || areaM2 > 12) continue;
    if (labels.some((l) => fl.mask[bm.iy(l.centre.y) * bm.nx + bm.ix(l.centre.x)] === 1)) continue;
    const trimmed = trimToCorridor(bm, fl.mask);
    const poly = polygonFromMask(bm, trimmed, walls, snapLines(walls, gaps, segs));
    if (poly.length < 3) continue;
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / ptPerM;
    if (minSide > 2.0) continue;
    // an open end against the drawing border: the region reaches the border stroke
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    let leaks = false;
    for (const s of page.strokes) {
      if (!s.closed || s.points.length < 4) continue;
      const sx = s.points.map((p) => p.x), sy = s.points.map((p) => p.y);
      if (Math.max(...sx) - Math.min(...sx) < 0.7 * page.width || Math.max(...sy) - Math.min(...sy) < 0.7 * page.height) continue;
      const tol = 3 * bm.px;
      if (Math.abs(bx0 - Math.min(...sx)) <= tol || Math.abs(bx1 - Math.max(...sx)) <= tol || Math.abs(by0 - Math.min(...sy)) <= tol || Math.abs(by1 - Math.max(...sy)) <= tol) leaks = true;
    }
    out.push({ polygon: poly, areaPt2: Math.abs(ringArea(poly)), leaksAtBorder: leaks });
  }
  return out;
}

/** Contiguous stretches of a gap between two facing room edges that no wall fill blocks. */
export function wallLessJunctions(
  a: RoomTag, b: RoomTag, wallAt: (w: Vec2) => boolean,
): { aEdge: number; bEdge: number; p0: Vec2; p1: Vec2 }[] {
  const out: { aEdge: number; bEdge: number; p0: Vec2; p1: Vec2 }[] = [];
  const na = a.polygon.length, nb = b.polygon.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const p = a.polygon[i], q = a.polygon[(i + 1) % na], r = b.polygon[j], s = b.polygon[(j + 1) % nb];
    const La = Math.hypot(q.x - p.x, q.z - p.z), Lb = Math.hypot(s.x - r.x, s.z - r.z);
    if (La < 1e-6 || Lb < 1e-6) continue;
    const ea = { x: (q.x - p.x) / La, z: (q.z - p.z) / La }, eb = { x: (s.x - r.x) / Lb, z: (s.z - r.z) / Lb };
    if (ea.x * eb.x + ea.z * eb.z > -Math.cos((10 * Math.PI) / 180)) continue; // facing edges run in opposite directions
    const outA = { x: ea.z, z: -ea.x };
    const g = ((r.x - p.x) * outA.x + (r.z - p.z) * outA.z + (s.x - p.x) * outA.x + (s.z - p.z) * outA.z) / 2;
    if (g < -0.05 || g > 0.45) continue;
    // overlap along a's axis
    const ur = (r.x - p.x) * ea.x + (r.z - p.z) * ea.z, us = (s.x - p.x) * ea.x + (s.z - p.z) * ea.z;
    const lo = Math.max(0, Math.min(ur, us)), hi = Math.min(La, Math.max(ur, us));
    if (hi - lo < 0.55) continue;
    let runStart: number | null = null;
    const step = 0.05;
    for (let u = lo; u <= hi + 1e-9; u += step) {
      const w = { x: p.x + ea.x * u + outA.x * (g / 2), z: p.z + ea.z * u + outA.z * (g / 2) };
      const blocked = wallAt(w);
      if (!blocked && runStart === null) runStart = u;
      if ((blocked || u + step > hi + 1e-9) && runStart !== null) {
        const end = blocked ? u - step : u;
        if (end - runStart >= 0.55 && end - runStart <= 2.0) {
          out.push({ aEdge: i, bEdge: j, p0: { x: p.x + ea.x * runStart, z: p.z + ea.z * runStart }, p1: { x: p.x + ea.x * end, z: p.z + ea.z * end } });
        }
        runStart = null;
      }
    }
  }
  return out;
}

export { WALL };
