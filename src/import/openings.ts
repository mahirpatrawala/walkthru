// C8. SPEC 13.5 step 7: doors, windows and open gaps from the bridged gaps. Pure TypeScript.
import type { Opening, OpeningType, Px, RoomTag, Vec2 } from '../types';
import type { VectorPage } from './types';
import type { Gap } from './walls';

const dist = (a: Px, b: Px): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Kasa circle fit. */
function fitCircle(pts: Px[]): { c: Px; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
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
  const uc = (b1 * svv - b2 * suv) / det, vc = (b2 * suu - b1 * suv) / det;
  const c = { x: uc + mx, y: vc + my };
  let r = 0; for (const p of pts) r += dist(p, c);
  return { c, r: r / n };
}

export function classifyGap(gap: Gap, page: VectorPage, t: number): OpeningType {
  const w = gap.widthPt;
  const mid = { x: (gap.a.x + gap.b.x) / 2, y: (gap.a.y + gap.b.y) / 2 };
  const d = gap.dir;
  // window: two or more straight strokes across the gap, parallel to it
  const lateral: number[] = [];
  for (const s of page.strokes) {
    const n = s.points.length;
    const last = s.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p = s.points[i], q = s.points[(i + 1) % n];
      const L = dist(p, q);
      if (L < 0.8 * w) continue;
      const sx = (q.x - p.x) / L, sy = (q.y - p.y) / L;
      if (Math.abs(sx * d.y - sy * d.x) > Math.sin((8 * Math.PI) / 180)) continue;
      const u0 = (p.x - gap.a.x) * d.x + (p.y - gap.a.y) * d.y;
      const u1 = (q.x - gap.a.x) * d.x + (q.y - gap.a.y) * d.y;
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
      const span = Math.min(hi, w) - Math.max(lo, 0);
      if (span < 0.8 * w) continue;
      if (lo < -0.25 * w || hi > 1.25 * w) continue;
      const lat = (p.x - mid.x) * -d.y + (p.y - mid.y) * d.x;
      if (Math.abs(lat) > 1.1 * t) continue;
      if (!lateral.some((l) => Math.abs(l - lat) < 0.1 * t)) lateral.push(lat);
    }
  }
  if (lateral.length >= 2) return 'window';
  // door: an arc about one end of the gap
  for (const s of page.strokes) {
    if (s.closed || s.points.length < 6) continue;
    if (!s.points.some((p) => dist(p, mid) <= 1.8 * w)) continue;
    const fit = fitCircle(s.points);
    if (!fit) continue;
    if (Math.abs(fit.r - w) > 0.2 * w) continue;
    let worst = 0; for (const p of s.points) worst = Math.max(worst, Math.abs(dist(p, fit.c) - fit.r));
    if (worst > 0.1 * fit.r) continue;
    if (Math.min(dist(fit.c, gap.a), dist(fit.c, gap.b)) > 1.5 * t) continue;
    // sweep
    const angs = s.points.map((p) => Math.atan2(p.y - fit.c.y, p.x - fit.c.x));
    let sweep = 0; for (let i = 1; i < angs.length; i++) { let da = angs[i] - angs[i - 1]; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; sweep += da; }
    if (Math.abs(sweep) < (45 * Math.PI) / 180) continue;
    return 'door';
  }
  return 'opening';
}

export interface OpeningResult { openings: Opening[]; warnings: string[]; /** index into the input gaps, per opening */ gapIndex: number[] }

/**
 * Classify every bridged gap, drop the implausible widths, and attach each to the polygon edge it lies on.
 * `rooms` are in world metres in the order the proposal lists them (first room wins a shared edge).
 */
export function buildOpenings(
  gaps: Gap[], page: VectorPage, t: number, ptPerM: number, toWorld: (p: Px) => Vec2, rooms: RoomTag[],
  windowHeights?: { sillM?: number; headM?: number },
): OpeningResult {
  const warnings: string[] = []; const openings: Opening[] = []; const gapIndex: number[] = [];
  const counts: Record<OpeningType, number> = { door: 0, window: 0, opening: 0 };
  const tM = t / ptPerM;
  const windowGaps = gaps.filter((g) => classifyGap(g, page, t) === 'window').length;
  gaps.forEach((g, gi) => {
    const widthM = g.widthPt / ptPerM;
    if (widthM > 2.0 || widthM < 0.55) { warnings.push(`A gap ${widthM.toFixed(2)} m wide was left out. Doors are 0.55 to 2.0 m. Check the scale or add it by hand.`); return; }
    const type = classifyGap(g, page, t);
    const A = toWorld(g.a), B = toWorld(g.b);
    const M = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    const gl = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const gd = { x: (B.x - A.x) / gl, z: (B.z - A.z) / gl };
    for (const room of rooms) {
      const n = room.polygon.length;
      for (let i = 0; i < n; i++) {
        const p = room.polygon[i], q = room.polygon[(i + 1) % n];
        const L = Math.hypot(q.x - p.x, q.z - p.z); if (L < 1e-9) continue;
        const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
        if (Math.abs(e.x * gd.z - e.z * gd.x) > Math.sin((10 * Math.PI) / 180)) continue;
        const u = (M.x - p.x) * e.x + (M.z - p.z) * e.z;
        const off = Math.abs((M.x - p.x) * -e.z + (M.z - p.z) * e.x);
        if (off > 1.5 * tM) continue;
        if (u - widthM / 2 < -0.05 || u + widthM / 2 > L + 0.05) continue;
        counts[type]++;
        const sill = type === 'window' ? (windowGaps === 1 && windowHeights?.sillM !== undefined ? windowHeights.sillM : 0.9) : 0;
        const head = type === 'window' && windowGaps === 1 && windowHeights?.headM !== undefined ? windowHeights.headM : 2.1;
        openings.push({ id: `${type}-${counts[type]}`, roomId: room.id, edge: i, type, centreM: u, widthM, sillM: sill, headM: head });
        gapIndex.push(gi);
        return;
      }
    }
    warnings.push(`A ${type} ${widthM.toFixed(2)} m wide lies on no room edge and was left out.`);
  });
  return { openings, warnings, gapIndex };
}
