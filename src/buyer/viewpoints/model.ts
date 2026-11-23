// What the Views' page side decides, without a DOM or three (SPEC 2.10): which rings to show from where you stand, how big, the next and previous
// view, how a move to a view is made, and the `vp=` of an address.
import type { Grid, Vec2 } from '../../types';
import { sightLine } from './compose';
import type { Viewpoint } from './compose';

/** Rings in the scene: at most this many, the nearest first, and none further than RING_MAX_M or nearer than RING_MIN_M. */
export const RING_COUNT = 4;
export const RING_MAX_M = 9;
export const RING_MIN_M = 0.8;

const DEG = Math.PI / 180;
const wrap = (d: number): number => { const r = ((((d + 180) % 360) + 360) % 360) - 180; return r === -180 ? 180 : r; };

/** Can the eye at `from` see the floor at `to`: nothing taller than the eye (a wall, a wardrobe, a shut door) and no open air between. */
export function inSight(grid: Grid, from: Vec2, to: Vec2): boolean {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d < 1e-6) return true;
  const s = sightLine(grid, from, Math.atan2(to.x - from.x, to.z - from.z) / DEG, d);
  return !s.outlook && s.d >= d - 0.06;
}

/** The other views to ring from `from`: in sight, nearest first, at most `n`. */
export function ringTargets(list: readonly Viewpoint[], from: Vec2, currentId: string | null, grid: Grid, n = RING_COUNT): Viewpoint[] {
  return list
    .filter((v) => v.id !== currentId)
    .map((v) => ({ v, d: Math.hypot(v.x - from.x, v.z - from.z) }))
    .filter(({ v, d }) => d >= RING_MIN_M && d <= RING_MAX_M && inSight(grid, from, v))
    .sort((a, b) => a.d - b.d || (a.v.id < b.v.id ? -1 : 1))
    // two views that stand side by side (a doorway seen from two rooms) would be two rings on top of each other: the nearer one stands for both
    .reduce<Viewpoint[]>((out, { v }) => (out.length < n && !out.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < RING_APART_M) ? [...out, v] : out), []);
}
/** rings closer together than this are one ring (the nearer view's) */
export const RING_APART_M = 0.9;

/** A ring's radius on the floor, metres: a little larger far away, so a distant ring still reads (and is easy to hit) without the near ones shouting. */
export function ringRadiusM(distM: number): number {
  return Math.max(0.22, Math.min(0.5, 0.16 + 0.045 * distM));
}

/** The view `dir` steps from `currentId` (wrapping round); the first (or last) when there is no current one. */
export function stepView(list: readonly Viewpoint[], currentId: string | null, dir: 1 | -1): Viewpoint | null {
  if (!list.length) return null;
  const i = currentId ? list.findIndex((v) => v.id === currentId) : -1;
  if (i < 0) return dir > 0 ? list[0] : list[list.length - 1];
  return list[(i + dir + list.length) % list.length];
}

export interface Pose { x: number; y: number; z: number; yawDeg: number; pitchDeg: number }

/** How a move to a view is made: a glide when the eye can see where it is going and it is not far, a fade with a short glide in when a wall is between, a cut with reduced motion. */
export function movePlan(from: Pose, to: Pose, clear: boolean, reduced: boolean): { mode: 'glide' | 'fade' | 'cut'; seconds: number } {
  if (reduced) return { mode: 'cut', seconds: 0 };
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const turn = Math.abs(wrap(to.yawDeg - from.yawDeg));
  if (clear && d <= 7) return { mode: 'glide', seconds: Math.max(0.6, Math.min(1.5, 0.5 + 0.17 * d + turn / 300)) };
  return { mode: 'fade', seconds: 0.7 };
}

const smootherstep = (t: number): number => { const k = Math.max(0, Math.min(1, t)); return k * k * k * (k * (k * 6 - 15) + 10); };

/** The pose `t` (0..1) of the way from `a` to `b`, eased at both ends, turning the short way round. */
export function poseAt(a: Pose, b: Pose, t: number): Pose {
  const k = smootherstep(t);
  return {
    x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
    yawDeg: a.yawDeg + wrap(b.yawDeg - a.yawDeg) * k, pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
  };
}

/** The point 5 m along a pose's view (for a camera's look-at). */
export function lookPoint(p: Pose): { x: number; y: number; z: number } {
  const y = p.yawDeg * DEG, pt = p.pitchDeg * DEG;
  return { x: p.x + Math.sin(y) * Math.cos(pt) * 5, y: p.y - Math.sin(pt) * 5, z: p.z + Math.cos(y) * Math.cos(pt) * 5 };
}

/** `vp=<id>` of an address: a view id as the generator and the override write them, or null. */
export function parseVpParam(search: string): string | null {
  const v = new URLSearchParams(search).get('vp');
  return v && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v) ? v : null;
}

/** The dots on the plans (the floor plan card and the Plan view): one for every view, at its point, named as the list names it. */
export function planMarks(list: readonly Viewpoint[]): { id: string; x: number; z: number; label: string }[] {
  return list.map((v) => ({ id: v.id, x: v.x, z: v.z, label: v.name }));
}
