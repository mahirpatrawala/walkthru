// Walkable paths over the collision grid, for the room bar's jump, the minimap tap and the tour. Pure: no DOM, no three.
//
// The grid is 5 cm cells. Paths are searched on a 10 cm lattice laid over it: a node is walkable when a body of the planning radius
// fits there (`circleFree`), looked up lazily so a search costs only what it visits. The search is a Dijkstra with a small extra cost
// near walls, so a route runs down the middle of a doorway instead of grazing its jamb; the node path is then pulled straight
// wherever the body fits along the straight line (the same clearance), which leaves a short list of corners to walk to.
//
// Nothing here knows about doors: a shut leaf is just cells on the grid you hand in. The caller plans on a grid without the shut
// leaves and opens each one on the way (src/buyer/nav/driver.ts).
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, Vec2 } from '../../types';
import { circleFree } from '../../core/grid-query';

/** Lattice spacing of the search, metres (a cell is 5 cm: two cells). */
export const PATH_STEP_M = 0.1;
/** The room a walking body is given while planning: its radius plus a hand's breadth, so routes keep off walls and jambs. */
export const PLAN_RADIUS_M = CHARACTER_RADIUS_M + 0.08;
/** Tried when nothing fits at PLAN_RADIUS_M (a narrow doorway, a crowded room): the body's own radius plus a finger. */
export const PLAN_RADIUS_TIGHT_M = CHARACTER_RADIUS_M + 0.03;
/** Nodes with less than this much free space round them cost more to cross (routes centre themselves in doorways). */
const COMFORT_RADIUS_M = CHARACTER_RADIUS_M + 0.22;
const COMFORT_COST = 0.6;
/** How far from a requested point the nearest walkable node may be, metres. */
const SNAP_M = 0.45;

export interface Route {
  /** the corners to walk to, first the start, last the goal */
  points: Vec2[];
  lengthM: number;
}

export function routeLength(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return s;
}

/** True when a body of `r` can walk the straight line a -> b (sampled every 5 cm; the start is not tested, a body may begin pressed up to a wall). */
export function lineFree(grid: Grid, a: Vec2, b: Vec2, r: number): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.05));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!circleFree(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
  }
  return true;
}

/** Pulls a corner list straight: from each corner, the furthest later corner it can reach in a straight line. */
export function pullStraight(grid: Grid, pts: Vec2[], r: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineFree(grid, pts[i], pts[j], r)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): { key: number; val: number } {
    const k = this.keys, v = this.vals;
    const top = { key: k[0], val: v[0] };
    const lk = k.pop() as number, lv = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export interface RouteField {
  /** the length of the shortest route to `p`, metres; Infinity when there is none (or it is longer than the search limit) */
  lengthTo(p: Vec2): number;
  /** the route to `p`, pulled straight; null when there is none */
  routeTo(p: Vec2): Route | null;
}

const NO_FIELD: RouteField = { lengthTo: () => Infinity, routeTo: () => null };

/**
 * Shortest walkable routes from `from` to every point in `targets` (one search for all of them). `maxLenM` stops the search where it
 * is not worth going on (a route over 12 m is a fade, not a walk). Tries the roomy body first and the tight one when `from` or a
 * target does not fit it.
 */
export function routesFrom(grid: Grid, from: Vec2, targets: readonly Vec2[], maxLenM = Infinity): RouteField {
  const roomy = search(grid, from, targets, maxLenM, PLAN_RADIUS_M);
  if (roomy && targets.every((t) => roomy.lengthTo(t) < Infinity)) return roomy;
  const tight = search(grid, from, targets, maxLenM, PLAN_RADIUS_TIGHT_M);
  if (!roomy) return tight ?? NO_FIELD;
  if (!tight) return roomy;
  // each target takes the better of the two (the tight body fits where the roomy one does not)
  return {
    lengthTo: (p) => Math.min(roomy.lengthTo(p), tight.lengthTo(p)),
    routeTo: (p) => (roomy.lengthTo(p) <= tight.lengthTo(p) ? roomy.routeTo(p) ?? tight.routeTo(p) : tight.routeTo(p) ?? roomy.routeTo(p)),
  };
}

/** One route from `from` to `to`, or null. */
export function findRoute(grid: Grid, from: Vec2, to: Vec2, maxLenM = Infinity): Route | null {
  return routesFrom(grid, from, [to], maxLenM).routeTo(to);
}

function search(grid: Grid, from: Vec2, targets: readonly Vec2[], maxLenM: number, radius: number): RouteField | null {
  const step = PATH_STEP_M;
  const ox = grid.originX + step / 2, oz = grid.originZ + step / 2;
  const nx = Math.floor((grid.nx * grid.cellM) / step), nz = Math.floor((grid.nz * grid.cellM) / step);
  if (nx <= 0 || nz <= 0) return null;
  const N = nx * nz;
  // 0 not looked at yet, 1 walkable, 2 not, filled as the search reaches a node
  const state = new Uint8Array(N);
  const comfy = new Uint8Array(N); // 1 comfortable, 2 tight, 0 unknown
  const px = (i: number): number => ox + (i % nx) * step;
  const pz = (i: number): number => oz + Math.floor(i / nx) * step;
  const walkable = (i: number): boolean => {
    let s = state[i];
    if (s === 0) { s = circleFree(grid, px(i), pz(i), radius) ? 1 : 2; state[i] = s; }
    return s === 1;
  };
  const extra = (i: number): number => {
    let c = comfy[i];
    if (c === 0) { c = circleFree(grid, px(i), pz(i), COMFORT_RADIUS_M) ? 1 : 2; comfy[i] = c; }
    return c === 2 ? COMFORT_COST * step : 0;
  };
  const nodeOf = (p: Vec2): number => {
    const ci = Math.round((p.x - ox) / step), cj = Math.round((p.z - oz) / step);
    let best = -1, bestD = SNAP_M;
    const ring = Math.ceil(SNAP_M / step);
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const idx = j * nx + i;
        const d = Math.hypot(ox + i * step - p.x, oz + j * step - p.z);
        if (d < bestD && walkable(idx)) { best = idx; bestD = d; }
      }
    }
    return best;
  };

  const start = nodeOf(from);
  if (start < 0) return null;
  const goalNodes = targets.map(nodeOf);
  const pending = new Set(goalNodes.filter((g) => g >= 0));
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(0, start);
  const D = step * Math.SQRT2;
  while (heap.size > 0 && pending.size > 0) {
    const { key, val: u } = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (key > maxLenM + 1) break;
    pending.delete(u);
    const ui = u % nx, uj = (u - ui) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const i = ui + di, j = uj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const v = j * nx + i;
        if (done[v] || !walkable(v)) continue;
        const diagonal = di !== 0 && dj !== 0;
        // a diagonal step may not cut the corner of a blocked node beside it
        if (diagonal && (!walkable(uj * nx + i) || !walkable(j * nx + ui))) continue;
        const nd = key + (diagonal ? D : step) + extra(v);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
      }
    }
  }

  const goalOf = new Map<Vec2, number>();
  targets.forEach((t, k) => goalOf.set(t, goalNodes[k]));
  const nodeFor = (p: Vec2): number => {
    const known = goalOf.get(p);
    return known !== undefined ? known : nodeOf(p);
  };
  const rawLength = (g: number): number => {
    // the lattice cost counts the comfort surcharge: measure the walked length instead
    let s = 0;
    for (let c = g; prev[c] >= 0; c = prev[c]) s += Math.hypot(px(c) - px(prev[c]), pz(c) - pz(prev[c]));
    return s;
  };
  const reach = (p: Vec2): number => {
    const g = nodeFor(p);
    return g >= 0 && done[g] && dist[g] < Infinity ? g : -1;
  };
  return {
    lengthTo(p) {
      const g = reach(p);
      if (g < 0) return Infinity;
      return rawLength(g) + Math.hypot(px(start) - from.x, pz(start) - from.z) + Math.hypot(px(g) - p.x, pz(g) - p.z);
    },
    routeTo(p) {
      const g = reach(p);
      if (g < 0) return null;
      const nodes: Vec2[] = [];
      for (let c = g; c >= 0; c = prev[c]) nodes.push({ x: px(c), z: pz(c) });
      nodes.reverse();
      const pts = [{ x: from.x, z: from.z }, ...nodes, { x: p.x, z: p.z }];
      const pulled = pullStraight(grid, pts, radius);
      return { points: pulled, lengthM: routeLength(pulled) };
    },
  };
}
