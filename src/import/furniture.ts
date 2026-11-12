// C8. SPEC 13.5 step 8: labelled furniture -> FurnitureItem. Pure TypeScript.
import type { Box, FurnitureItem, FurnitureKind, Px, Vec2 } from '../types';
import type { FurnitureLabel } from './labels';
import type { Bitmap } from './bitmap';
import { WALL } from './bitmap';
import type { Outline } from './scale';
import { matchOutline } from './scale';
import type { ProposalExtras, VStroke } from './types';

type Unmapped = ProposalExtras['unmapped'][number];

const SPEC: Partial<Record<FurnitureLabel['key'], { kind: FurnitureKind; heightM: number; surfaceHeightM: number }>> = {
  bed: { kind: 'bed', heightM: 0.9, surfaceHeightM: 0.5 },
  sofa: { kind: 'sofa', heightM: 0.85, surfaceHeightM: 0.43 },
  dining: { kind: 'dining', heightM: 0.95, surfaceHeightM: 0.75 },
  study: { kind: 'counter', heightM: 0.75, surfaceHeightM: 0.75 },
  desk: { kind: 'counter', heightM: 0.75, surfaceHeightM: 0.75 },
  // The wardrobe height is 2.13 m (7 ft) unless an elevation gives one; no elevation here carries height as text.
  wardrobe: { kind: 'wardrobe', heightM: 2.13, surfaceHeightM: 2.13 },
  dressing: { kind: 'wardrobe', heightM: 2.13, surfaceHeightM: 2.13 },
  // SPEC-GAP: the catalogue has no side-table kind, so a side table is a low counter item (types.ts is not widened).
  'side table': { kind: 'counter', heightM: 0.55, surfaceHeightM: 0.55 },
};

/** Distance in page units from `from` along `dir` to the first wall pixel, capped. */
function rayToWall(walls: Bitmap, from: Px, dir: Px, cap: number): number {
  const step = walls.px * 0.5;
  for (let d = 0; d <= cap; d += step) if (walls.at({ x: from.x + dir.x * d, y: from.y + dir.y * d }) === WALL) return d;
  return cap;
}

/** A Box from an outline, its back on the side nearest a wall face (ties: opposite the label's reading direction). */
export function boxFromOutline(o: Outline, walls: Bitmap, ptPerM: number, toWorld: (p: Px) => Vec2, readingAngleRad: number): Box {
  const u = { x: Math.cos(o.ang), y: Math.sin(o.ang) };
  const v = { x: -Math.sin(o.ang), y: Math.cos(o.ang) };
  const sides: { n: Px; mid: Px; len: number }[] = [
    { n: { x: -u.x, y: -u.y }, mid: { x: o.cx - (u.x * o.a) / 2, y: o.cy - (u.y * o.a) / 2 }, len: o.b },
    { n: { x: u.x, y: u.y }, mid: { x: o.cx + (u.x * o.a) / 2, y: o.cy + (u.y * o.a) / 2 }, len: o.b },
    { n: { x: -v.x, y: -v.y }, mid: { x: o.cx - (v.x * o.b) / 2, y: o.cy - (v.y * o.b) / 2 }, len: o.a },
    { n: { x: v.x, y: v.y }, mid: { x: o.cx + (v.x * o.b) / 2, y: o.cy + (v.y * o.b) / 2 }, len: o.a },
  ];
  const cap = 2.5 * ptPerM;
  const dists = sides.map((s) => rayToWall(walls, { x: s.mid.x + s.n.x * walls.px * 0.5, y: s.mid.y + s.n.y * walls.px * 0.5 }, s.n, cap));
  const dmin = Math.min(...dists);
  const tied = sides.map((_, i) => i).filter((i) => dists[i] - dmin <= Math.max(walls.px, 1.0));
  let back = tied[0];
  if (tied.length > 1) {
    const rd = { x: Math.cos(readingAngleRad), y: Math.sin(readingAngleRad) };
    // the side whose outward normal points against the reading direction
    back = tied.reduce((a, b) => ((sides[b].n.x * rd.x + sides[b].n.y * rd.y) < (sides[a].n.x * rd.x + sides[a].n.y * rd.y) ? b : a));
  }
  const nb = sides[back].n;                   // outward normal of the back side
  const aDir = { x: -nb.x, y: -nb.y };        // front direction a
  const depthPt = back < 2 ? o.a : o.b;       // extent along a
  const widthPt = back < 2 ? o.b : o.a;
  const c = toWorld({ x: o.cx, y: o.cy });
  let yaw = (Math.atan2(aDir.x, aDir.y) * 180) / Math.PI;
  yaw = ((yaw % 360) + 360) % 360;
  return { cx: c.x, cz: c.z, w: widthPt / ptPerM, d: depthPt / ptPerM, yawDeg: yaw };
}

/**
 * A built-in wardrobe given as "WARDROBE=9'0"RFT": the run of shutter and hanger strokes beside the label, against the
 * nearest wall. The label sits on the open side of the band, so the band lies between the label and the wall.
 * Returns the band as an oriented rectangle (back on the wall), or null.
 */
export function wardrobeBand(
  label: FurnitureLabel, strokes: VStroke[], wallColors: string[], walls: Bitmap, ptPerM: number, wallRings: Px[][] = [],
): Outline | null {
  if (!label.runningLengthM) return null;
  const L = label.runningLengthM * ptPerM;
  const a = (label.angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  const cap = 1.5 * ptPerM;
  const c = label.centre;
  const dPlus = rayToWall(walls, c, v, cap), dMinus = rayToWall(walls, c, { x: -v.x, y: -v.y }, cap);
  if (Math.min(dPlus, dMinus) >= cap) return null;
  const n = dPlus <= dMinus ? v : { x: -v.x, y: -v.y };
  let dWall = Math.min(dPlus, dMinus);
  // the ray is pixel-quantised; move it onto the exact face of the wall piece it hit
  let exact = Infinity;
  for (const r of wallRings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ex = b.x - a.x, ey = b.y - a.y; const den = n.x * ey - n.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const dx = a.x - c.x, dy = a.y - c.y;
    const d = (dx * ey - dy * ex) / den, k = (dx * n.y - dy * n.x) / den;
    if (k >= -1e-6 && k <= 1 + 1e-6 && d > 0 && Math.abs(d - dWall) <= 2 * walls.px) exact = Math.min(exact, d);
  }
  if (Number.isFinite(exact)) dWall = exact;
  const tol = walls.px * 0.5 + 0.5;
  let s0 = Infinity, s1 = -Infinity, d0 = Infinity, count = 0;
  for (const st of strokes) {
    if (wallColors.includes(st.color)) continue;
    let ok = true;
    let a0 = Infinity, a1 = -Infinity, e0 = Infinity;
    for (const p of st.points) {
      const dx = p.x - c.x, dy = p.y - c.y;
      const ss = dx * u.x + dy * u.y, dd = dx * n.x + dy * n.y;
      if (Math.abs(ss) > 0.5 * L + 1 || dd < -1 || dd > dWall + tol) { ok = false; break; }
      a0 = Math.min(a0, ss); a1 = Math.max(a1, ss); e0 = Math.min(e0, dd);
    }
    if (!ok) continue;
    s0 = Math.min(s0, a0); s1 = Math.max(s1, a1); d0 = Math.min(d0, e0); count++;
  }
  if (count < 6) return null;
  const measured = s1 - s0, depth = dWall - d0;
  if (Math.abs(measured - L) / L > 0.15 || depth < 0.3 * ptPerM || depth > 1.0 * ptPerM) return null;
  const length = L; // the label gives the run; the strokes only place it
  const sMid = (s0 + s1) / 2, dMid = (d0 + dWall) / 2;
  const cx = c.x + u.x * sMid + n.x * dMid, cy = c.y + u.y * sMid + n.y * dMid;
  const ang = Math.atan2(u.y, u.x);
  const corner = (ss: number, dd: number): Px => ({ x: cx + u.x * ss + n.x * dd, y: cy + u.y * ss + n.y * dd });
  return { cx, cy, a: length, b: depth, ang, corners: [corner(-length / 2, -depth / 2), corner(length / 2, -depth / 2), corner(length / 2, depth / 2), corner(-length / 2, depth / 2)], closed: false };
}

export function buildFurniture(
  labels: FurnitureLabel[], outlines: Outline[], t: number, ptPerM: number, toWorld: (p: Px) => Vec2, walls: Bitmap,
  strokes: VStroke[] = [], wallColors: string[] = [], wallRings: Px[][] = [],
): { items: FurnitureItem[]; unmapped: Unmapped[]; matched: Map<FurnitureLabel, Outline> } {
  const items: FurnitureItem[] = []; const unmapped: Unmapped[] = []; const matched = new Map<FurnitureLabel, Outline>();
  const counts: Partial<Record<FurnitureKind, number>> = {};
  const used = new Set<Outline>();
  // sized labels first so that an unsized label (Dressing / storage) only takes an outline nobody else owns
  const ordered = [...labels].sort((x, y) => Number(!!y.dims) - Number(!!x.dims));
  for (const l of ordered) {
    const at = toWorld(l.centre);
    const sizeM = l.dims ? { w: Math.min(l.dims.w, l.dims.l), l: Math.max(l.dims.w, l.dims.l) } : undefined;
    const spec = SPEC[l.key];
    if (!spec) { unmapped.push({ label: l.name, sizeM, at, reason: `No furniture kind for a ${l.key}.` }); continue; }
    let o: Outline | null = null;
    if (l.key === 'wardrobe') {
      o = wardrobeBand(l, strokes, wallColors, walls, ptPerM, wallRings);
      if (!o) { unmapped.push({ label: l.name, sizeM: l.runningLengthM ? { w: 0, l: l.runningLengthM } : undefined, at, reason: 'Wardrobe run only, and no band of shutter strokes against a wall of that length beside the label.' }); continue; }
    } else if (l.key === 'dressing') {
      // no size on the label: the nearest drawn rectangle (closed, or three-sided) that no other label has taken
      const dist = (q: Outline): number => {
        const dx = l.centre.x - q.cx, dy = l.centre.y - q.cy, cs = Math.cos(q.ang), sn = Math.sin(q.ang);
        const uu = dx * cs + dy * sn, vv = -dx * sn + dy * cs;
        return Math.hypot(Math.max(0, Math.abs(uu) - q.a / 2), Math.max(0, Math.abs(vv) - q.b / 2));
      };
      const free = outlines.filter((q) => !used.has(q) && Math.min(q.a, q.b) >= 0.1 * ptPerM && Math.max(q.a, q.b) <= 2.5 * ptPerM && dist(q) <= 0.8 * ptPerM)
        .sort((x, y) => dist(x) - dist(y) || x.a * x.b - y.a * y.b);
      o = free[0] ?? null;
      if (!o) { unmapped.push({ label: l.name, at, reason: 'No drawn outline near the label that another label has not taken.' }); continue; }
    } else {
      o = matchOutline(l, outlines.filter((q) => !used.has(q) || l.key === 'side table'), t);
      if (!o) { unmapped.push({ label: l.name, sizeM, at, reason: 'No outline of the labelled proportions near the label.' }); continue; }
    }
    used.add(o);
    matched.set(l, o);
    const box = boxFromOutline(o, walls, ptPerM, toWorld, (l.angle * Math.PI) / 180);
    counts[spec.kind] = (counts[spec.kind] ?? 0) + 1;
    const item: FurnitureItem = {
      id: `${spec.kind}-${counts[spec.kind]}`, source: 'real', kind: spec.kind, label: l.name, box,
      heightM: spec.heightM, surfaceHeightM: spec.surfaceHeightM,
    };
    if (spec.kind === 'bed' && sizeM) item.inner = { w: sizeM.w, d: sizeM.l };
    items.push(item);
  }
  return { items, unmapped, matched };
}
