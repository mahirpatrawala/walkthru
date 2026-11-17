// Loose furniture and decor never shut a room away (owner, 17 Nov 2026: the balcony of a flat was effectively unreachable because two chairs left
// 0.45 m at its sliding door). One rule for every home: every room the empty home lets a person walk to is still reachable from the entrance with a
// body CLEAR_RADIUS_M clear on all sides, and every door keeps a clear strip through it (0.9 m, or the door's own width when it is narrower).
// Only the movable pieces (sofas and chairs, dining sets, coffee and side tables, planters, banquet sets) are ever moved: a bed, a wardrobe, a WC or a
// counter is where the drawing puts it, and where those alone leave a room out of reach (a 0.62 m toilet door) that is the drawing's, not the dressing's.
// Pure: no I/O.
import { boxAxes, boxCorners, pointInBox, pointInPolygon } from '../core/geometry';
import { cellIndex } from '../core/grid-codec';
import { circleFree, nearestFree } from '../core/grid-query';
import { rasterizeLayout, stampFurniture } from '../core/layout-raster';
import { polygonCentroid } from '../core/spawn';
import { leafObstacle, resolveDoors } from '../core/doors';
import { GRID_FREE } from '../types';
import type { Box, FurnitureItem, Grid, Layout, Vec2 } from '../types';
import { arrivalAtDoor } from './arrival';
import { doorFrame } from './geom';

/**
 * The same question as `reachable` (src/building/arrival.ts: a flood over a 10 cm lattice, the body's radius clear) answered from one distance
 * transform of the grid instead of a circle test per lattice point: 10 to 30 times faster, which matters on a big deck, where this pass runs inside
 * a search. A cell outside the grid counts as an obstacle.
 */
export function reachableFast(grid: Grid, from: Vec2, targets: Vec2[], radius: number): boolean[] {
  const { nx, nz, cellM } = grid;
  const INF = 1e12;
  // squared distance (in cells) from each cell to the nearest obstacle cell, Felzenszwalb and Huttenlocher's two passes of the 1-D transform
  const f = new Float64Array(nx * nz);
  for (let k = 0; k < f.length; k++) f[k] = grid.cells[k] === GRID_FREE ? INF : 0;
  const edt1 = (get: (i: number) => number, set: (i: number, v: number) => void, n: number, v: Int32Array, z: Float64Array): void => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let sIdx: number;
      for (;;) {
        const p = v[k];
        sIdx = ((get(q) + q * q) - (get(p) + p * p)) / (2 * q - 2 * p);
        if (sIdx <= z[k] && k > 0) k--; else break;
      }
      k++; v[k] = q; z[k] = sIdx; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; set(q, (q - p) * (q - p) + get(p)); }
  };
  const vN = new Int32Array(Math.max(nx, nz) + 1), zN = new Float64Array(Math.max(nx, nz) + 2);
  const col = new Float64Array(Math.max(nx, nz));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) col[j] = f[j * nx + i];
    edt1((q) => col[q], (q, val) => { f[q * nx + i] = val; }, nz, vN, zN);
  }
  const row = new Float64Array(nx);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) row[i] = f[j * nx + i];
    edt1((q) => row[q], (q, val) => { f[j * nx + q] = val; }, nx, vN, zN);
  }
  const r2 = (radius / cellM) ** 2;
  // a lattice node is free when no obstacle cell lies within the radius, and it is inside the grid with the radius to spare of its edge
  const edge = Math.ceil(radius / cellM);
  const free = (i: number, j: number): boolean => i >= edge && j >= edge && i < nx - edge && j < nz - edge && f[j * nx + i] > r2;
  const step = 2;
  const ix0 = Math.floor((from.x - grid.originX) / cellM), iz0 = Math.floor((from.z - grid.originZ) / cellM);
  const seen = new Uint8Array(nx * nz);
  if (!free(ix0, iz0)) return targets.map(() => false);
  const stack: number[] = [ix0, iz0];
  seen[iz0 * nx + ix0] = 1;
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!;
    for (const [di, dj] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a] || !free(a, b)) continue;
      seen[b * nx + a] = 1;
      stack.push(a, b);
    }
  }
  return targets.map((t) => {
    const a = Math.round((t.x - grid.originX) / cellM - 0.5), b = Math.round((t.z - grid.originZ) / cellM - 0.5);
    for (let da = -step; da <= step; da++) for (let db = -step; db <= step; db++) if (a + da >= 0 && b + db >= 0 && a + da < nx && b + db < nz && seen[(b + db) * nx + a + da]) return true;
    return false;
  });
}

/** the walker's effective clearance (another change raises the walker's own radius to this; both agree on 0.30 m) */
export const CLEAR_RADIUS_M = 0.3;
/** the clear strip through a door */
export const DOOR_STRIP_M = 0.9;
/** how far a piece is moved at most */
const MAX_MOVE_M = 1.6;

/** a piece the dressing may move: seating, dining sets, loose tables, planters, banquet sets */
export function isMovable(it: FurnitureItem): boolean {
  if (it.kind === 'sofa' || it.kind === 'dining') return !/^(lobby-|gym-)/.test(it.catalogId ?? '');
  return /coffee|side-table|planter|banquet|cafe-set/.test(it.catalogId ?? '');
}

/** a loose accent piece the dressing may leave out when it has nowhere to stand: a footstool, an accent chair, a planter, a side or coffee table */
export function isDroppable(it: FurnitureItem): boolean {
  return /^ottoman/.test(it.id) || /armchair|planter|side-table|coffee|cafe-set/.test(it.catalogId ?? '');
}

/** where a person comes in: the home's main door, else a door with no room beyond it, else the spawn point */
export function entryOf(layout: Layout, grid: Grid, spawn?: { x: number; z: number }): Vec2 | null {
  const doors = resolveDoors(layout);
  const d = doors.find((x) => x.id === 'door-main') ?? doors.find((x) => x.rooms[1] === null || x.rooms[0] === null);
  if (d) { const a = arrivalAtDoor(layout, grid, d.id); if (a) return { x: a.x, z: a.z }; }
  return spawn && circleFree(grid, spawn.x, spawn.z, CLEAR_RADIUS_M) ? { x: spawn.x, z: spawn.z } : null;
}

const spotsOf = (layout: Layout, grid: Grid): { id: string; at: Vec2 }[] =>
  layout.rooms.filter((r) => !r.partial && r.polygon.length >= 3).map((r) => {
    const c0 = polygonCentroid(r.polygon);
    const c = pointInPolygon(c0, r.polygon) ? c0 : r.polygon[0];
    return { id: r.id, at: nearestFree(grid, c.x, c.z, 0.25, 1.2) ?? c };
  });

/** the door strips that `bare` leaves free and `grid` does not */
export function blockedDoorStrips(layout: Layout, bare: Grid, grid: Grid): string[] {
  return Object.keys(blockedDoorPoints(layout, bare, grid));
}
/** per door, how many sample points of its strip a piece blocks (a finer measure than blocked or not, so a nudge that frees most of it counts) */
export function blockedDoorPoints(layout: Layout, bare: Grid, grid: Grid): Record<string, number> {
  const out: Record<string, number> = {};
  const free = (g: Grid, p: Vec2): boolean => { const k = cellIndex(g, p.x, p.z); return k >= 0 && g.cells[k] === GRID_FREE; };
  for (const o of layout.openings) {
    if (o.type === 'window') continue;
    const f = doorFrame(layout, o.id);
    if (!f) continue;
    // a clear run of `need` metres somewhere across the opening, at every depth from 0.2 to 0.6 m on both sides of it
    // a sliding door opens about half its width (its other pane is fixed): 0.7 m of a 2 m door, never under 0.6 m, is the run it must keep
    const slider = f.leaf?.kind === 'sliding' && f.widthM >= 1.4;
    const need = (slider ? 0.6 : Math.min(DOOR_STRIP_M, f.widthM)) - 1e-6;
    const half = f.widthM / 2 - 0.02;
    // a sliding door is walked straight through (a body 0.3 m clear, 0.6 m wide): 0.15 to 0.45 m either side; any other door keeps 0.2 to 0.6 m
    const depths = slider ? [-0.45, -0.3, -0.15, 0.15, 0.3, 0.45] : [-0.6, -0.4, -0.2, 0.2, 0.4, 0.6];
    let run = 0, bestRun = 0, anyBlocked = false;
    // each depth's own best run too: it gives the clearing pass a slope when two pieces, one on each side of the door, share the blame (moving one alone leaves the common run short)
    const runT = depths.map(() => 0), bestT = depths.map(() => 0);
    for (let u = -half; u <= half + 1e-9; u += 0.05) {
      let ok = true;
      depths.forEach((t, i) => {
        const p = { x: f.centre.x + f.dir.x * u + f.out.x * t, z: f.centre.z + f.dir.z * u + f.out.z * t };
        const bad = free(bare, p) && !free(grid, p);
        if (bad) { ok = false; anyBlocked = true; }
        runT[i] = bad ? 0 : runT[i] + 0.05;
        bestT[i] = Math.max(bestT[i], runT[i]);
      });
      run = ok ? run + 0.05 : 0;
      bestRun = Math.max(bestRun, run);
    }
    if (anyBlocked && bestRun + 0.05 < need) {
      const slope = bestT.reduce((sum, r) => sum + Math.max(0, Math.ceil((need - r) / 0.05)), 0);
      out[o.id] = Math.max(1, Math.ceil((need - bestRun) / 0.05)) + slope;
    }
  }
  return out;
}

export interface RouteReport {
  /** rooms the empty home reaches and the furnished one does not */
  shut: string[];
  /** doors whose strip a piece blocks */
  blockedDoors: string[];
  /** how many sample points of those strips are blocked (the measure the pass minimises) */
  blockedPoints: number;
}

/** What the furniture shuts away: `fixedOnly` is the home with only its immovable pieces (what the drawing alone allows). */
export interface RouteCtx { bare: Grid; fixed: Grid; eB: Vec2 | null; roomsF: { id: string; at: Vec2 }[]; okF: boolean[] }
/** What a pass asks again and again and only the movable pieces change: the empty home's grid and everything about the home with just its fixed pieces. */
export function routeCtx(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }, radius = CLEAR_RADIUS_M): RouteCtx {
  const bare = withSlidersOpen(rasterizeLayout(layout), layout);
  const fixed = stampFurniture(bare, furniture.filter((i) => !isMovable(i)));
  const eB = entryOf(layout, fixed, spawn);
  const roomsF = spotsOf(layout, fixed);
  return { bare, fixed, eB, roomsF, okF: eB ? reachableFast(fixed, eB, roomsF.map((r) => r.at), radius) : [] };
}

/**
 * The empty home with every sliding door slid open: what stands in such a doorway then is its fixed pane (src/core/doors.ts). A balcony, a deck or a utility room
 * is reached through that opening, so the loose pieces beside it are held to "reachable through this door when it is open" (the 0.9 m run and a body 0.30 m
 * clear), not to the whole shut doorway.
 */
export function withSlidersOpen(grid: Grid, layout: Layout): Grid {
  const sliders = resolveDoors(layout).filter((d) => d.kind === 'sliding' && d.panes === 2 && d.maxPos > 0);
  if (sliders.length === 0) return grid;
  return stampFurniture(grid, sliders.map((d, i) => { const o = leafObstacle(d, d.maxPos); return { id: `slider:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'fixed pane', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM }; }));
}

export function routeReport(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }, radius = CLEAR_RADIUS_M, ctx?: RouteCtx): RouteReport {
  const { bare, fixed, eB, roomsF, okF } = ctx ?? routeCtx(layout, furniture, spawn, radius);
  const grid = stampFurniture(bare, furniture);
  const eG = entryOf(layout, grid, spawn);
  const rooms = spotsOf(layout, grid);
  let shut: string[] = [];
  if (eB) {
    const okG = eG ? reachableFast(grid, eG, rooms.map((r) => r.at), radius) : rooms.map(() => false);
    shut = rooms.filter((r) => { const iF = roomsF.findIndex((q) => q.id === r.id); return iF >= 0 && okF[iF] && !okG[rooms.indexOf(r)]; }).map((r) => r.id);
  }
  const pts = blockedDoorPoints(layout, fixed, grid);
  return { shut, blockedDoors: Object.keys(pts), blockedPoints: Object.values(pts).reduce((a, b) => a + b, 0) };
}

/** do two footprints overlap (`pad` metres of margin round the first)? Corners, then a 3 x 3 sample of the grown box for a plus sign */
function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  const grow = { ...a, w: a.w + 2 * pad, d: a.d + 2 * pad };
  if (boxCorners(grow).some((p) => pointInBox(p, b)) || boxCorners(b).some((p) => pointInBox(p, grow))) return true;
  const { a: da, b: db } = boxAxes(grow);
  for (const u of [-0.5, 0, 0.5]) for (const v of [-0.5, 0, 0.5]) {
    if (pointInBox({ x: grow.cx + db.x * u * grow.w + da.x * v * grow.d, z: grow.cz + db.z * u * grow.w + da.z * v * grow.d }, b)) return true;
  }
  return false;
}

const cost = (r: RouteReport): number => r.shut.length * 1000 + r.blockedPoints;
const DIRS = Array.from({ length: 12 }, (_, k) => ({ x: Math.cos((k / 12) * Math.PI * 2), z: Math.sin((k / 12) * Math.PI * 2) }));

/** a sofa, with a back that stands against a wall (not an armchair, which faces its view, not a footstool, not a lobby or gym seat) */
export function hasBack(it: FurnitureItem): boolean {
  return it.kind === 'sofa' && !/^(lobby-|gym-)/.test(it.catalogId ?? '') && !/^ottoman|armchair|chair/.test(`${it.id} ${it.catalogId ?? ''}`) && it.box.w >= 1.2 && it.box.d >= 0.7;
}

export interface WallEdge { a: Vec2; dir: Vec2; into: Vec2; length: number }
/** the edges of a room's outline, each with the unit vector along it and the one pointing into the room */
export function wallEdges(poly: Vec2[]): WallEdge[] {
  const out: WallEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.3) continue;
    const dir = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    let into = { x: -dir.z, z: dir.x };
    const mid = { x: (a.x + b.x) / 2 + into.x * 0.1, z: (a.z + b.z) / 2 + into.z * 0.1 };
    if (!pointInPolygon(mid, poly)) into = { x: -into.x, z: -into.z };
    out.push({ a, dir, into, length });
  }
  return out;
}

/** The wall a back stands against: the edge, how far along it the piece's centre is, and the gap between back and wall; null when it stands free. */
function wallOfBack(it: FurnitureItem, edges: WallEdge[]): { e: WallEdge; u: number; gap: number } | null {
  const { a } = boxAxes(it.box);
  const back = { x: it.box.cx - a.x * it.box.d / 2, z: it.box.cz - a.z * it.box.d / 2 };
  let best: { e: WallEdge; u: number; gap: number } | null = null;
  for (const e of edges) {
    if (Math.abs(a.x * e.dir.x + a.z * e.dir.z) > 0.2 || a.x * e.into.x + a.z * e.into.z < 0.9) continue;
    const gap = (back.x - e.a.x) * e.into.x + (back.z - e.a.z) * e.into.z;
    const u = (it.box.cx - e.a.x) * e.dir.x + (it.box.cz - e.a.z) * e.dir.z;
    if (gap < -0.05 || gap > 0.25 || u < 0 || u > e.length) continue;
    if (!best || gap < best.gap) best = { e, u, gap };
  }
  return best;
}

/**
 * Where a piece with a back may stand against a wall of its room, nearest first: along the wall it was on (a slide), then the other walls
 * (turned to face into the room, back to the wall, the same gap). Never floating, never skewed.
 */
function wallSpots(layout: Layout, it: FurnitureItem, room: { polygon: Vec2[] }, from: { e: WallEdge; u: number; gap: number }, edges: WallEdge[]): Box[] {
  const out: { box: Box; key: number }[] = [];
  // what is cut into a wall (a door, an opening, a window whose sill is under the piece's top, from either room) stays in the open
  const cuts: { e: WallEdge; u0: number; u1: number }[] = [];
  for (const o of layout.openings) {
    if (o.type === 'window' && o.sillM >= it.heightM + 0.05) continue;
    const f = doorFrame(layout, o.id);
    if (!f) continue;
    for (const e of edges) {
      const off = (f.centre.x - e.a.x) * e.into.x + (f.centre.z - e.a.z) * e.into.z;
      const u = (f.centre.x - e.a.x) * e.dir.x + (f.centre.z - e.a.z) * e.dir.z;
      if (Math.abs(off) < 0.35 && u > -0.2 && u < e.length + 0.2) cuts.push({ e, u0: u - f.widthM / 2 - 0.05, u1: u + f.widthM / 2 + 0.05 });
    }
  }
  const gap = Math.min(0.1, Math.max(0.02, from.gap));
  for (const e of edges) {
    const half = it.box.w / 2 + 0.03;
    if (e.length < it.box.w + 0.06) continue;
    const yawDeg = Math.round((Math.atan2(e.into.x, e.into.z) * 180) / Math.PI * 1000) / 1000;
    for (let u = half; u <= e.length - half + 1e-9; u += 0.05) {
      const cx = e.a.x + e.dir.x * u + e.into.x * (it.box.d / 2 + gap), cz = e.a.z + e.dir.z * u + e.into.z * (it.box.d / 2 + gap);
      const box = { ...it.box, cx: Math.round(cx * 1000) / 1000, cz: Math.round(cz * 1000) / 1000, yawDeg };
      if (!boxCorners(box).every((p) => pointInPolygon(p, room.polygon))) continue;
      if (cuts.some((c) => c.e === e && u - it.box.w / 2 < c.u1 && u + it.box.w / 2 > c.u0)) continue;
      const move = Math.hypot(box.cx - it.box.cx, box.cz - it.box.cz);
      // the same wall first (by how far it slides), then the others by how far the piece travels
      out.push({ box, key: (e === from.e ? 0 : 100) + move });
    }
  }
  return out.sort((x, y) => x.key - y.key).map((o) => o.box);
}

export function clearRoutes(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): ClearResult {
  const key = JSON.stringify([layout.rooms.map((r) => [r.id, r.polygon]), layout.openings.map((o) => [o.id, o.edge, o.centreM, o.widthM, o.leaf ? [o.leaf.kind, o.leaf.hinge, o.leaf.swing] : null]), furniture.map((f) => [f.id, f.kind, f.catalogId, f.box]), spawn ?? null]);
  const hit = CACHE.get(key);
  if (hit) return hit;
  const out = clearRoutesUncached(layout, furniture, spawn);
  if (CACHE.size >= 48) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, out);
  return out;
}
export interface ClearResult { furniture: FurnitureItem[]; dropped: string[]; moved: { id: string; dx: number; dz: number }[]; left: RouteReport }
const CACHE = new Map<string, ClearResult>();
/** the whole pass is given this long (ms); a plan too tangled to settle in it keeps what it has */
/** A work budget, counted in route measurements, not in time: the result must be the same on a slow machine as on a fast one (the generator's output is committed and tested). */
const BUDGET_MEASURES = 60000;
/** the most one joint nudge may use of it */
const JOINT_SLICE = 9000;
/** a joint nudge moves a piece at most this far from where the drawing put it, metres */
const NUDGE_MAX_M = 1.0;

/**
 * Before a loose accent piece is left out: slide it and its neighbours (the movable pieces of its room, and any within 2.5 m) a little each, by
 * coordinate descent on "rooms shut and door strips blocked first, then how far everything has travelled from the drawing". Returns the items
 * when that clears every route with the piece kept, else null. The pieces stay inside their own room and clear of each other.
 */
function jointNudge(layout: Layout, items: FurnitureItem[], original: FurnitureItem[], keepId: string, spawn: { x: number; z: number } | undefined, ctx: RouteCtx, work: { left: number }, accentsOnly = false): FurnitureItem[] | null {
  const orig = new Map(original.map((f) => [f.id, f]));
  const target = items.find((x) => x.id === keepId);
  const t0 = orig.get(keepId);
  if (!target || !t0) return null;
  const roomOf = (it: FurnitureItem) => layout.rooms.find((r) => !r.partial && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon));
  const tr = roomOf(t0);
  const pool = items.filter((it) => {
    const o = orig.get(it.id);
    if (!o || !isMovable(it) || (accentsOnly && !isDroppable(it))) return false;
    return it.id === keepId || (tr && roomOf(o) === tr) || Math.hypot(o.box.cx - t0.box.cx, o.box.cz - t0.box.cz) < 2.5;
  }).slice(0, 6);
  const inPool = new Set(pool.map((p) => p.id));
  const fixed = items.filter((x) => !inPool.has(x.id));
  // the search starts from the drawing's own places (pieces an earlier step slid are put back: the best answer is often another piece's small move)
  let cur = items.map((x) => (inPool.has(x.id) ? { ...x, box: { ...orig.get(x.id)!.box } } : x));
  // two pool pieces may overlap on the way (a piece cannot step out of another's way before the other has moved): each overlapping pair costs 400, and a result with any is refused
  const overlaps = (list: FurnitureItem[]): number => {
    const ps = list.filter((x) => inPool.has(x.id));
    let n = 0;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (boxesOverlap(ps[i].box, ps[j].box, 0.03)) n++;
    return n;
  };
  const travelled = (list: FurnitureItem[]): number => pool.reduce((s, p) => { const a = list.find((x) => x.id === p.id)!.box, b = orig.get(p.id)!.box; return s + Math.hypot(a.cx - b.cx, a.cz - b.cz); }, 0);
  const measure = (list: FurnitureItem[]): { score: number; ok: boolean } => {
    work.left--;
    const c = cost(routeReport(layout, list, spawn, CLEAR_RADIUS_M, ctx));
    const o = overlaps(list);
    return { score: c * 1000 + o * 400 + travelled(list), ok: c === 0 && o === 0 };
  };
  let best = measure(cur);
  for (let sweep = 0; sweep < 4 && work.left > 0 && !best.ok; sweep++) {
    let improved = false;
    for (const p of pool) {
      const o = orig.get(p.id)!;
      const room = roomOf(o);
      const here = cur.find((x) => x.id === p.id)!;
      const spots: Box[] = [];
      for (let dx = -NUDGE_MAX_M; dx <= NUDGE_MAX_M + 1e-9; dx += 0.1) {
        for (let dz = -NUDGE_MAX_M; dz <= NUDGE_MAX_M + 1e-9; dz += 0.1) {
          const box = { ...o.box, cx: Math.round((o.box.cx + dx) * 100) / 100, cz: Math.round((o.box.cz + dz) * 100) / 100 };
          if (Math.hypot(dx, dz) > NUDGE_MAX_M || (box.cx === here.box.cx && box.cz === here.box.cz)) continue;
          if (room && !boxCorners(box).every((q) => pointInPolygon(q, room.polygon))) continue;
          if (fixed.some((q) => boxesOverlap(box, q.box, 0.03))) continue;
          spots.push(box);
        }
      }
      let bestSpot: { cand: FurnitureItem[]; m: { score: number; ok: boolean } } | null = null;
      for (const box of spots) {
        if (work.left <= 0) break;
        const cand = cur.map((x) => (x.id === p.id ? { ...x, box } : x));
        const m = measure(cand);
        if (m.score < (bestSpot?.m.score ?? best.score) - 1e-9) bestSpot = { cand, m };
      }
      if (bestSpot) { cur = bestSpot.cand; best = bestSpot.m; improved = true; if (best.ok) break; }
    }
    if (!improved) break;
  }
  return best.ok ? cur : null;
}

/**
 * The part of a sliding door that is open when the door is: the near half of the opening (the other half is the fixed pane), as far as a body needs it, and 0.45 m
 * out on both sides. Loose pieces keep out of it (a footstool and a chair either side of a balcony door, each alone no great harm, shut it between them).
 */
export function sliderZoneCandidates(layout: Layout): Box[][] {
  return resolveDoors(layout).filter((d) => d.kind === 'sliding' && d.panes === 2 && d.maxPos > 0).map((d) => {
    const full = d.widthM - 0.06, open = full - d.panelWidthM, need = 0.6;
    const len = Math.min(open, need);
    const yawDeg = (((Math.atan2(d.out.x, d.out.z) * 180) / Math.PI) % 360 + 360) % 360;
    // the clear run may sit anywhere in the open half
    const out: Box[] = [];
    for (let off = 0; off <= open - len + 1e-9; off += 0.05) out.push({ cx: d.hingeAt.x + d.closedDir.x * (off + len / 2), cz: d.hingeAt.z + d.closedDir.z * (off + len / 2), w: len, d: 0.9, yawDeg });
    return out;
  });
}

/** a piece that may be slid clear of a sliding door's open half: the loose pieces, and a fridge or a washer (a freestanding appliance, 5 to 10 cm either way on a brochure plan anyway) */
const slidable = (it: FurnitureItem): boolean => isMovable(it) || /^(fridge|washer)/.test(it.catalogId ?? '');

/** Slides every movable piece out of the open-slider zones, the least each, inside its own room and clear of the rest; where its place is taken by another loose piece, that one is slid on (one step); a loose accent piece with nowhere to go is the only thing left out. */
function clearSliderZones(layout: Layout, items: FurnitureItem[], dropped: string[]): FurnitureItem[] {
  const cands = sliderZoneCandidates(layout);
  if (cands.length === 0) return items;
  // door by door, the place for the clear run that costs the fewest pieces left out, then the least sliding
  const chosen: Box[] = [];
  let cur = items;
  for (const list of cands) {
    let best: { cur: FurnitureItem[]; dropped: string[]; score: number; zone: Box } | null = null;
    for (const zone of list) {
      const dr: string[] = [];
      const res = slideOutOf(layout, cur, [...chosen, zone], dr);
      // a zone with a fixed piece (a fridge, a WC) in it is no place for the clear run
      const fixedHits = items.filter((it) => !slidable(it) && boxesOverlap(zone, it.box, 0)).length;
      const score = fixedHits * 5000 + dr.length * 1000 + res.reduce((sum, it) => { const o = items.find((x) => x.id === it.id); return sum + (o ? Math.hypot(o.box.cx - it.box.cx, o.box.cz - it.box.cz) : 0); }, 0);
      if (!best || score < best.score - 1e-9) best = { cur: res, dropped: dr, score, zone };
    }
    if (best) { cur = best.cur; dropped.push(...best.dropped); chosen.push(best.zone); }
  }
  return cur;
}

/** What the sliding doors of a layout cost the loose pieces: pieces left out (1000 each) and metres slid. The cheap half of the pass, for choosing which side a sliding pane parks on. */
export function sliderCost(layout: Layout, furniture: FurnitureItem[]): number {
  const dropped: string[] = [];
  const res = clearSliderZones(layout, furniture, dropped);
  const fixedHits = sliderZoneCandidates(layout).reduce((n, list) => n + Math.min(...list.map((z) => furniture.filter((it) => !slidable(it) && boxesOverlap(z, it.box, 0)).length)), 0);
  return fixedHits * 5000 + dropped.length * 1000 + res.reduce((sum, it) => { const o = furniture.find((x) => x.id === it.id); return sum + (o ? Math.hypot(o.box.cx - it.box.cx, o.box.cz - it.box.cz) : 0); }, 0);
}

function slideOutOf(layout: Layout, items: FurnitureItem[], zones: Box[], dropped: string[]): FurnitureItem[] {
  let cur = items;
  const hit = (b: Box): boolean => zones.some((z) => boxesOverlap(b, z, 0.04));
  const roomOf = (it: FurnitureItem) => layout.rooms.find((r) => !r.partial && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon));
  const spotsOf = (it: FurnitureItem, reach: number): Box[] => {
    const out: { box: Box; d: number }[] = [];
    for (let dx = -reach; dx <= reach + 1e-9; dx += 0.05) for (let dz = -reach; dz <= reach + 1e-9; dz += 0.05) {
      const dd = Math.hypot(dx, dz);
      if (dd > reach || dd < 1e-9) continue;
      out.push({ box: { ...it.box, cx: Math.round((it.box.cx + dx) * 100) / 100, cz: Math.round((it.box.cz + dz) * 100) / 100 }, d: dd });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.box);
  };
  const inside = (it: FurnitureItem, b: Box): boolean => { const r = roomOf(it); return !r || boxCorners(b).every((p) => pointInPolygon(p, r.polygon)); };
  for (const it0 of items) {
    const it = cur.find((x) => x.id === it0.id);
    if (!it || !slidable(it) || !hit(it.box)) continue;
    let done = false;
    for (const box of spotsOf(it, 1.6)) {
      if (!inside(it, box) || hit(box)) continue;
      const blockers = cur.filter((o) => o.id !== it.id && boxesOverlap(box, o.box, 0.03));
      if (blockers.length === 0) { cur = cur.map((x) => (x.id === it.id ? { ...x, box } : x)); done = true; break; }
      // another loose piece stands there: it steps aside (to the nearest place clear of the zone and of everything, this piece included)
      if (blockers.length > 1 || !slidable(blockers[0])) continue;
      const bl = blockers[0], moved = { ...it, box };
      const alt = spotsOf(bl, 1.0).find((b2) => inside(bl, b2) && !hit(b2) && !boxesOverlap(b2, box, 0.03) && !cur.some((o) => o.id !== it.id && o.id !== bl.id && boxesOverlap(b2, o.box, 0.03)));
      if (alt) { cur = cur.map((x) => (x.id === it.id ? moved : x.id === bl.id ? { ...x, box: alt } : x)); done = true; break; }
    }
    if (!done && isDroppable(it)) { cur = cur.filter((x) => x.id !== it.id); dropped.push(it.id); }
  }
  return cur;
}

function clearRoutesUncached(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): { furniture: FurnitureItem[]; dropped: string[]; moved: { id: string; dx: number; dz: number }[]; left: RouteReport } {
  const dropped: string[] = [];
  let items = clearSliderZones(layout, furniture, dropped);
  const moved = new Map<string, { dx: number; dz: number }>();
  const ctx = routeCtx(layout, furniture, spawn);
  const report = (list: FurnitureItem[]): RouteReport => routeReport(layout, list, spawn, CLEAR_RADIUS_M, ctx);
  let rep = report(items);
  const work = { left: BUDGET_MEASURES };
  for (let guard = 0; guard < 24 && cost(rep) > 0 && work.left > 0; guard++) {
    // the pieces whose removal helps, the one that helps most first; the first of them that has somewhere harmless (or less harmful) to go is moved
    const helps: { id: string; c: number }[] = [];
    for (const it of items) {
      if (!isMovable(it)) continue;
      const c = cost(report(items.filter((x) => x.id !== it.id)));
      if (c < cost(rep)) helps.push({ id: it.id, c });
    }
    helps.sort((a, b) => a.c - b.c);
    let progressed = false;
    for (const best of helps) {
      const it = items.find((x) => x.id === best.id)!;
      const room = layout.rooms.find((r) => !r.partial && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon));
      // a sofa that stood against a wall goes against a wall: slid along it, else on another wall of its room, facing in
      let pick: { it: FurnitureItem; r: RouteReport } | null = null;
      if (room && hasBack(it)) {
        const edges = wallEdges(room.polygon);
        const from = wallOfBack(furniture.find((x) => x.id === it.id) ?? it, edges);
        if (from) {
          for (const box of wallSpots(layout, it, room, from, edges)) {
            if (items.some((o) => o.id !== it.id && boxesOverlap(box, o.box, 0.03))) continue;
            const cand = { ...it, box };
            const r = report(items.map((x) => (x.id === it.id ? cand : x)));
            if (cost(r) <= best.c) { pick = { it: cand, r }; break; }
          }
        }
      }
      // the nearest spot where the piece does no harm (the cost of the home without it), else the spot that harms least
      if (!pick) outer: for (let dist = 0.05; dist <= MAX_MOVE_M + 1e-9; dist += 0.1) {
        for (const d of DIRS) {
          const box = { ...it.box, cx: Math.round((it.box.cx + d.x * dist) * 100) / 100, cz: Math.round((it.box.cz + d.z * dist) * 100) / 100 };
          if (room && !boxCorners(box).every((p) => pointInPolygon(p, room.polygon))) continue;
          if (items.some((o) => o.id !== it.id && boxesOverlap(box, o.box, 0.03))) continue;
          const cand = { ...it, box };
          const r = report(items.map((x) => (x.id === it.id ? cand : x)));
          if (cost(r) < cost(rep) && (!pick || cost(r) < cost(pick.r))) pick = { it: cand, r };
          if (cost(r) <= best.c) { pick = { it: cand, r }; break outer; }
        }
      }
      if (!pick) continue;
      items = items.map((x) => (x.id === it.id ? pick!.it : x));
      const first = furniture.find((x) => x.id === it.id)!;
      moved.set(it.id, { dx: pick.it.box.cx - first.box.cx, dz: pick.it.box.cz - first.box.cz });
      rep = pick.r;
      progressed = true;
      break;
    }
    if (!progressed) {
      // nowhere to put it on its own: the piece and its neighbours are nudged together, and only when that clears nothing is a loose accent piece left out
      const droppable = helps.filter((h) => isDroppable(items.find((x) => x.id === h.id)!));
      const drop = droppable[0];
      if (!drop) break;
      let kept = false;
      for (const d of droppable) {
        // the accent pieces alone first (a footstool, a chair and a table sliding a little is the smallest change), then the sofa and dining set too
        const tryJoint = (accentsOnly: boolean): FurnitureItem[] | null => {
          // each attempt gets a slice of the work, so one hopeless piece cannot use up what the next could have solved with
          const slice = { left: Math.min(work.left, JOINT_SLICE) };
          const r = jointNudge(layout, items, furniture, d.id, spawn, ctx, slice, accentsOnly);
          work.left -= Math.min(work.left, JOINT_SLICE) - slice.left;
          return r;
        };
        const joint = tryJoint(true) ?? tryJoint(false);
        if (!joint) continue;
        items = joint;
        for (const j of joint) {
          const first = furniture.find((x) => x.id === j.id)!;
          if (j.box.cx !== first.box.cx || j.box.cz !== first.box.cz) moved.set(j.id, { dx: j.box.cx - first.box.cx, dz: j.box.cz - first.box.cz });
          else moved.delete(j.id);
        }
        kept = true;
        break;
      }
      if (kept) { rep = report(items); continue; }
      items = items.filter((x) => x.id !== drop.id);
      dropped.push(drop.id);
      moved.delete(drop.id);
      rep = report(items);
    }
  }
  // what moved is read off the result against the drawing (the slider zones and the search both move pieces)
  const was = new Map(furniture.map((f) => [f.id, f.box]));
  void moved;
  const movedOut = items.flatMap((it) => { const b = was.get(it.id); return b && (Math.abs(b.cx - it.box.cx) > 1e-9 || Math.abs(b.cz - it.box.cz) > 1e-9) ? [{ id: it.id, dx: it.box.cx - b.cx, dz: it.box.cz - b.cz }] : []; });
  return { furniture: items, dropped, moved: movedOut, left: rep };
}
