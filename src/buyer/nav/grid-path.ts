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
/** Last resort when even that leaves a target out of reach (a toilet whose open door leaves a hand's breadth): the body's own radius, a hair over. */
export const PLAN_RADIUS_BODY_M = CHARACTER_RADIUS_M + 0.005;
/** Nodes with less than this much free space round them cost more to cross (routes centre themselves in doorways). */
const COMFORT_RADIUS_M = CHARACTER_RADIUS_M + 0.22;
const COMFORT_COST = 0.6;
/** How far from a requested point the nearest walkable node may be, metres. */
const SNAP_M = 0.45;

/**
 * A doorway as a place the planner knows how to cross: the wall's depth, the jambs and which way through is square. A body is planned right
 * up to the door's approach point (GATE_APPROACH_M outside the wall) at the usual clearance, then straight through the doorway along its
 * normal, at the body's own radius only (the clearance is for open rooms, a doorway is as wide as it is), then on again. Without this a 0.62 to
 * 0.68 m door, whose free width is a few cells once its own leaf is open, falls between the nodes of the 10 cm lattice.
 */
export interface Gate {
  /** the middle of the doorway, in the wall's depth */
  c: Vec2;
  /** unit vector along the wall, jamb to jamb */
  along: Vec2;
  /** unit vector through the doorway */
  n: Vec2;
  /** the wall's depth, metres */
  depth: number;
  /** jamb to jamb, metres */
  width: number;
}
/** How far outside the wall a gate's approach point is, metres. */
export const GATE_APPROACH_M = 0.55;
/** The body radius inside a doorway. */
export const GATE_RADIUS_M = CHARACTER_RADIUS_M;

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

/** True when a body of `r` can walk the straight line a -> b, sampled every 2.5 cm and including the start. */
export function fineLineFree(grid: Grid, a: Vec2, b: Vec2, r: number): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.025));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!circleFree(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
  }
  return true;
}

/** Pulls a corner list straight: from each corner, the furthest later corner it can reach in a straight line. */
export function pullStraight(grid: Grid, pts: Vec2[], r: number, keep: ReadonlySet<Vec2> = new Set()): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    // a gate's approach points are kept: a line may not skip the doorway's square crossing
    for (let q = i + 1; q < j; q++) if (keep.has(pts[q])) { j = Math.min(j, q); break; }
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
export function routesFrom(grid: Grid, from: Vec2, targets: readonly Vec2[], maxLenM = Infinity, gates: readonly Gate[] = []): RouteField {
  const roomy = search(grid, from, targets, maxLenM, PLAN_RADIUS_M, []);
  if (roomy && targets.every((t) => roomy.lengthTo(t) < Infinity)) return roomy;
  const tight = search(grid, from, targets, maxLenM, PLAN_RADIUS_TIGHT_M, []);
  const plain = [roomy, tight].filter((f): f is RouteField => !!f);
  // what the open-room planner reaches is routed as it always was (the same route at every frame rate, whatever a door happens to be doing);
  // only a target it cannot reach is planned again with the doorways as gates, then at the body's own radius
  const reaches = (f: RouteField, p: Vec2): boolean => f.lengthTo(p) < Infinity;
  const late: RouteField[] = [];
  if (!targets.every((t) => plain.some((f) => reaches(f, t)))) {
    if (gates.length) for (const r of [PLAN_RADIUS_M, PLAN_RADIUS_TIGHT_M, PLAN_RADIUS_BODY_M]) { const f = search(grid, from, targets, maxLenM, r, gates); if (f) late.push(f); }
    else { const f = search(grid, from, targets, maxLenM, PLAN_RADIUS_BODY_M, []); if (f) late.push(f); }
  }
  if (plain.length + late.length === 0) return NO_FIELD;
  const pick = (p: Vec2): RouteField => {
    const have = plain.filter((f) => reaches(f, p));
    const pool = have.length ? have : late.filter((f) => reaches(f, p));
    if (pool.length === 0) return plain[0] ?? late[0];
    // the shortest of the fields that reach it (a roomier route is preferred on a tie)
    return pool.reduce((a, c) => (c.lengthTo(p) < a.lengthTo(p) - 1e-9 ? c : a));
  };
  return { lengthTo: (p) => pick(p).lengthTo(p), routeTo: (p) => pick(p).routeTo(p) };
}

/** One route from `from` to `to`, or null. */
export function findRoute(grid: Grid, from: Vec2, to: Vec2, maxLenM = Infinity, gates: readonly Gate[] = []): Route | null {
  return routesFrom(grid, from, [to], maxLenM, gates).routeTo(to);
}

function search(grid: Grid, from: Vec2, targets: readonly Vec2[], maxLenM: number, radius: number, gates: readonly Gate[]): RouteField | null {
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

  // each gate that a body can cross becomes an edge between the lattice nodes outside its two faces, through points on its centre line
  const gateOut = new Map<number, { to: number; cost: number; via: Vec2[] }[]>();
  for (const g of gates) {
    const off = g.depth / 2 + GATE_APPROACH_M;
    // the line through the doorway: the middle of it if free, else the nearest line to the middle that is (a sliding leaf stands in part of the opening)
    const span = g.width / 2 - GATE_RADIUS_M;
    let best: { A: Vec2; B: Vec2; t: number } | null = null;
    for (let k = 0; k <= 40 && !best; k++) {
      for (const sg of k ? [1, -1] : [1]) {
        const t = sg * k * 0.025;
        if (Math.abs(t) > Math.max(0, span) + 1e-9) continue;
        const cx = g.c.x + g.along.x * t, cz = g.c.z + g.along.z * t;
        const A = { x: cx - g.n.x * off, z: cz - g.n.z * off }, B = { x: cx + g.n.x * off, z: cz + g.n.z * off };
        if (!fineLineFree(grid, A, B, GATE_RADIUS_M)) continue;
        best = { A, B, t };
        break;
      }
    }
    if (!best) continue;
    const nA = nodeOf(best.A), nB = nodeOf(best.B);
    if (nA < 0 || nB < 0 || nA === nB) continue;
    // the way from each node to its approach point must be free at the body's own radius
    const pa = { x: px(nA), z: pz(nA) }, pb = { x: px(nB), z: pz(nB) };
    if (!fineLineFree(grid, pa, best.A, GATE_RADIUS_M) || !fineLineFree(grid, best.B, pb, GATE_RADIUS_M)) continue;
    const len = Math.hypot(pa.x - best.A.x, pa.z - best.A.z) + Math.hypot(best.A.x - best.B.x, best.A.z - best.B.z) + Math.hypot(best.B.x - pb.x, best.B.z - pb.z);
    (gateOut.get(nA) ?? gateOut.set(nA, []).get(nA)!).push({ to: nB, cost: len, via: [best.A, best.B] });
    (gateOut.get(nB) ?? gateOut.set(nB, []).get(nB)!).push({ to: nA, cost: len, via: [best.B, best.A] });
  }

  const start = nodeOf(from);
  if (start < 0) return null;
  const goalNodes = targets.map(nodeOf);
  const pending = new Set(goalNodes.filter((g) => g >= 0));
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  // the nodes reached through a gate: the points on the way (on the doorway's line) and the walked length of that hop
  const viaOf = new Map<number, { via: Vec2[]; len: number }>();
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
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; viaOf.delete(v); heap.push(nd, v); }
      }
    }
    for (const e of gateOut.get(u) ?? []) {
      if (done[e.to]) continue;
      const nd = key + e.cost;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; viaOf.set(e.to, { via: e.via, len: e.cost }); heap.push(nd, e.to); }
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
    for (let c = g; prev[c] >= 0; c = prev[c]) { const v = viaOf.get(c); s += v ? v.len : Math.hypot(px(c) - px(prev[c]), pz(c) - pz(prev[c])); }
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
      const gatePoints = new Set<Vec2>();
      for (let c = g; c >= 0; c = prev[c]) {
        nodes.push({ x: px(c), z: pz(c) });
        const v = viaOf.get(c);
        if (v) for (let k = v.via.length - 1; k >= 0; k--) { const q = { x: v.via[k].x, z: v.via[k].z }; nodes.push(q); gatePoints.add(q); }
      }
      nodes.reverse();
      const pts = [{ x: from.x, z: from.z }, ...nodes, { x: p.x, z: p.z }];
      const pulled = pullStraight(grid, pts, radius, gatePoints);
      return { points: pulled, lengthM: routeLength(pulled) };
    },
  };
}
