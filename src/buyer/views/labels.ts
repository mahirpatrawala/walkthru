// Room name tags floating over the doll house, pure: where each one goes on the screen and how visible it is. A tag fades with distance
// (a room far from the camera is small, its name would be a smudge) and when it would sit on top of a more important tag.
import { pointInPolygon, distanceToSegment } from '../../core/geometry';
import { polygonCentroid } from '../../core/spawn';
import type { Vec2 } from '../../types';

export interface LabelCandidate {
  id: string;
  /** screen centre, CSS px; `ok` false when it is behind the camera or off the picture */
  sx: number; sy: number; ok: boolean;
  /** box size, CSS px */
  w: number; h: number;
  /** distance from the camera, metres */
  dist: number;
  /** larger first: the bigger room keeps its name when two collide */
  weight: number;
}

export interface LabelPlacement { id: string; opacity: number }

const overlaps = (a: LabelCandidate, b: LabelCandidate, gap: number): boolean =>
  Math.abs(a.sx - b.sx) < (a.w + b.w) / 2 + gap && Math.abs(a.sy - b.sy) < (a.h + b.h) / 2 + gap;

/** 1 up close, fading to `floor` at `far` metres (and a little more by half again, to zero). */
export function distanceOpacity(dist: number, near: number, far: number, floor = 0.45): number {
  if (dist <= near) return 1;
  if (dist <= far) return 1 - (1 - floor) * ((dist - near) / Math.max(1e-6, far - near));
  const k = (dist - far) / Math.max(1e-6, far * 0.5);
  return Math.max(0, floor * (1 - k));
}

/**
 * Greedy placement: the heaviest tag first, each later tag that would overlap a placed one is dimmed to nothing, the rest fade with distance.
 * `near` and `far` are the camera distances (metres) at which fading begins and is mostly done; pass the doll house's current distance and a multiple.
 */
export function placeLabels(items: readonly LabelCandidate[], opts: { near: number; far: number; gap?: number }): LabelPlacement[] {
  const gap = opts.gap ?? 4;
  const order = [...items].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const placed: LabelCandidate[] = [];
  const out = new Map<string, number>();
  for (const it of order) {
    if (!it.ok) { out.set(it.id, 0); continue; }
    if (placed.some((p) => overlaps(it, p, gap))) { out.set(it.id, 0); continue; }
    placed.push(it);
    out.set(it.id, distanceOpacity(it.dist, opts.near, opts.far));
  }
  return items.map((i) => ({ id: i.id, opacity: out.get(i.id) ?? 0 }));
}

/** Where to hang a room's tag in plan: its centroid, or the roomiest point when the centroid falls outside the room (an L shape). */
export function labelPoint(poly: readonly Vec2[]): Vec2 {
  const pts = [...poly];
  const c = polygonCentroid(pts);
  if (pointInPolygon(c, pts)) return c;
  let best = pts[0], bestD = -1;
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
      const q = { x, z };
      if (!pointInPolygon(q, pts)) continue;
      let d = Infinity;
      for (let i = 0; i < pts.length; i++) d = Math.min(d, distanceToSegment(q, pts[i], pts[(i + 1) % pts.length]));
      if (d > bestD) { best = q; bestD = d; }
    }
  }
  return best;
}
