// C8. SPEC 13.5 step 8: labelled furniture -> FurnitureItem. Pure TypeScript.
import type { Box, FurnitureItem, FurnitureKind, Px, Vec2 } from '../types';
import type { FurnitureLabel } from './labels';
import type { Bitmap } from './bitmap';
import { WALL } from './bitmap';
import type { Outline } from './scale';
import { matchOutline } from './scale';
import type { ProposalExtras } from './types';

type Unmapped = ProposalExtras['unmapped'][number];

const SPEC: Partial<Record<FurnitureLabel['key'], { kind: FurnitureKind; heightM: number; surfaceHeightM: number }>> = {
  bed: { kind: 'bed', heightM: 0.9, surfaceHeightM: 0.5 },
  sofa: { kind: 'sofa', heightM: 0.85, surfaceHeightM: 0.43 },
  dining: { kind: 'dining', heightM: 0.95, surfaceHeightM: 0.75 },
  study: { kind: 'counter', heightM: 0.75, surfaceHeightM: 0.75 },
  desk: { kind: 'counter', heightM: 0.75, surfaceHeightM: 0.75 },
  wardrobe: { kind: 'wardrobe', heightM: 2.1, surfaceHeightM: 2.1 },
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

export function buildFurniture(
  labels: FurnitureLabel[], outlines: Outline[], t: number, ptPerM: number, toWorld: (p: Px) => Vec2, walls: Bitmap,
): { items: FurnitureItem[]; unmapped: Unmapped[]; matched: Map<FurnitureLabel, Outline> } {
  const items: FurnitureItem[] = []; const unmapped: Unmapped[] = []; const matched = new Map<FurnitureLabel, Outline>();
  const counts: Partial<Record<FurnitureKind, number>> = {};
  for (const l of labels) {
    const at = toWorld(l.centre);
    const sizeM = l.dims ? { w: Math.min(l.dims.w, l.dims.l), l: Math.max(l.dims.w, l.dims.l) } : undefined;
    const spec = SPEC[l.key];
    if (!spec) { unmapped.push({ label: l.name, sizeM, at, reason: `No furniture kind for a ${l.key}.` }); continue; }
    let o: Outline | null = null;
    if (l.key === 'wardrobe') {
      // a closed outline at least 0.45 m deep that contains or touches the label, and spans the labelled run
      const need = 0.45 * ptPerM;
      const near = outlines.filter((q) => {
        if (Math.min(q.a, q.b) < need) return false;
        const dx = l.centre.x - q.cx, dy = l.centre.y - q.cy;
        const cs = Math.cos(q.ang), sn = Math.sin(q.ang);
        const uu = dx * cs + dy * sn, vv = -dx * sn + dy * cs;
        return Math.hypot(Math.max(0, Math.abs(uu) - q.a / 2), Math.max(0, Math.abs(vv) - q.b / 2)) <= 0.15 * ptPerM;
      }).sort((x, y) => x.a * x.b - y.a * y.b);
      o = near[0] ?? null;
      if (o && l.runningLengthM) {
        const longM = Math.max(o.a, o.b) / ptPerM;
        if (Math.abs(longM - l.runningLengthM) / l.runningLengthM > 0.25) {
          unmapped.push({ label: l.name, sizeM: { w: 0, l: l.runningLengthM }, at, reason: `Wardrobe run ${l.runningLengthM.toFixed(2)} m, but the outline beside the label is ${longM.toFixed(2)} m. Not boxed.` });
          continue;
        }
      }
      if (!o) { unmapped.push({ label: l.name, sizeM: l.runningLengthM ? { w: 0, l: l.runningLengthM } : undefined, at, reason: 'Wardrobe run only, no closed outline beside the label.' }); continue; }
    } else {
      o = matchOutline(l, outlines, t);
      if (!o) { unmapped.push({ label: l.name, sizeM, at, reason: 'No outline of the labelled proportions near the label.' }); continue; }
    }
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
