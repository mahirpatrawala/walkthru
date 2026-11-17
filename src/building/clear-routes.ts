// Loose furniture and decor never shut a room away (owner, 17 Nov 2026: the balcony of a flat was effectively unreachable because two chairs left
// 0.45 m at its sliding door). One rule for every home: every room the empty home lets a person walk to is still reachable from the entrance with a
// body CLEAR_RADIUS_M clear on all sides, and every door keeps a clear strip through it (0.9 m, or the door's own width when it is narrower).
// Only the movable pieces (sofas and chairs, dining sets, coffee and side tables, planters, banquet sets) are ever moved: a bed, a wardrobe, a WC or a
// counter is where the drawing puts it, and where those alone leave a room out of reach (a 0.62 m toilet door) that is the drawing's, not the dressing's.
// Pure: no I/O.
import { boxCorners, pointInPolygon } from '../core/geometry';
import { cellIndex } from '../core/grid-codec';
import { circleFree, nearestFree } from '../core/grid-query';
import { rasterizeLayout, stampFurniture } from '../core/layout-raster';
import { polygonCentroid } from '../core/spawn';
import { resolveDoors } from '../core/doors';
import { boxesOverlap } from '../look/lived-in/plan';
import { GRID_FREE } from '../types';
import type { FurnitureItem, Grid, Layout, Vec2 } from '../types';
import { arrivalAtDoor, reachable } from './arrival';
import { doorFrame } from './geom';

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
    const need = Math.min(DOOR_STRIP_M, f.widthM) - 1e-6;
    const half = f.widthM / 2 - 0.02;
    let run = 0, bestRun = 0, anyBlocked = false;
    for (let u = -half; u <= half + 1e-9; u += 0.05) {
      let ok = true;
      for (const t of [-0.6, -0.4, -0.2, 0.2, 0.4, 0.6]) {
        const p = { x: f.centre.x + f.dir.x * u + f.out.x * t, z: f.centre.z + f.dir.z * u + f.out.z * t };
        if (free(bare, p) && !free(grid, p)) { ok = false; anyBlocked = true; break; }
      }
      run = ok ? run + 0.05 : 0;
      bestRun = Math.max(bestRun, run);
    }
    if (anyBlocked && bestRun + 0.05 < need) out[o.id] = Math.max(1, Math.ceil((need - bestRun) / 0.05));
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
export function routeReport(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }, radius = CLEAR_RADIUS_M): RouteReport {
  const bare = rasterizeLayout(layout);
  const fixed = stampFurniture(bare, furniture.filter((i) => !isMovable(i)));
  const grid = stampFurniture(bare, furniture);
  const eB = entryOf(layout, fixed, spawn), eG = entryOf(layout, grid, spawn);
  const rooms = spotsOf(layout, grid);
  const roomsF = spotsOf(layout, fixed);
  let shut: string[] = [];
  if (eB) {
    const okF = reachable(fixed, eB, roomsF.map((r) => r.at), radius);
    const okG = eG ? reachable(grid, eG, rooms.map((r) => r.at), radius) : rooms.map(() => false);
    shut = rooms.filter((r, i) => okF[i] && !okG[i]).map((r) => r.id);
  }
  const pts = blockedDoorPoints(layout, fixed, grid);
  return { shut, blockedDoors: Object.keys(pts), blockedPoints: Object.values(pts).reduce((a, b) => a + b, 0) };
}

const cost = (r: RouteReport): number => r.shut.length * 1000 + r.blockedPoints;
const DIRS = Array.from({ length: 12 }, (_, k) => ({ x: Math.cos((k / 12) * Math.PI * 2), z: Math.sin((k / 12) * Math.PI * 2) }));

/**
 * Moves the movable pieces, the fewest and the least, until nothing is shut away and no door strip is blocked: the piece whose removal helps most is
 * slid (in 5 cm steps, 16 directions, the nearest spot first) to a spot inside its own room, clear of every other piece, that leaves fewer rooms shut or
 * doors blocked. Returns the new furniture (the same objects where nothing moved) and what moved. Deterministic.
 */
export function clearRoutes(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): ClearResult {
  const key = JSON.stringify([layout.rooms.map((r) => [r.id, r.polygon]), layout.openings.map((o) => [o.id, o.edge, o.centreM, o.widthM]), furniture.map((f) => [f.id, f.kind, f.catalogId, f.box]), spawn ?? null]);
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
const BUDGET_MS = 8000;
function clearRoutesUncached(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): { furniture: FurnitureItem[]; dropped: string[]; moved: { id: string; dx: number; dz: number }[]; left: RouteReport } {
  let items = furniture;
  const moved = new Map<string, { dx: number; dz: number }>();
  const dropped: string[] = [];
  let rep = routeReport(layout, items, spawn);
  const t0 = Date.now();
  for (let guard = 0; guard < 24 && cost(rep) > 0 && Date.now() - t0 < BUDGET_MS; guard++) {
    // the pieces whose removal helps, the one that helps most first; the first of them that has somewhere harmless (or less harmful) to go is moved
    const helps: { id: string; c: number }[] = [];
    for (const it of items) {
      if (!isMovable(it)) continue;
      const c = cost(routeReport(layout, items.filter((x) => x.id !== it.id), spawn));
      if (c < cost(rep)) helps.push({ id: it.id, c });
    }
    helps.sort((a, b) => a.c - b.c);
    let progressed = false;
    for (const best of helps) {
      const it = items.find((x) => x.id === best.id)!;
      const room = layout.rooms.find((r) => !r.partial && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon));
      // the nearest spot where the piece does no harm (the cost of the home without it), else the spot that harms least
      let pick: { it: FurnitureItem; r: RouteReport } | null = null;
      outer: for (let dist = 0.05; dist <= MAX_MOVE_M + 1e-9; dist += 0.1) {
        for (const d of DIRS) {
          const box = { ...it.box, cx: Math.round((it.box.cx + d.x * dist) * 100) / 100, cz: Math.round((it.box.cz + d.z * dist) * 100) / 100 };
          if (room && !boxCorners(box).every((p) => pointInPolygon(p, room.polygon))) continue;
          if (items.some((o) => o.id !== it.id && boxesOverlap(box, o.box, 0.03))) continue;
          const cand = { ...it, box };
          const r = routeReport(layout, items.map((x) => (x.id === it.id ? cand : x)), spawn);
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
      // nowhere to put it without shutting something: a loose accent piece goes (the home loses a footstool, not a room)
      const drop = helps.find((h) => isDroppable(items.find((x) => x.id === h.id)!));
      if (!drop) break;
      items = items.filter((x) => x.id !== drop.id);
      dropped.push(drop.id);
      moved.delete(drop.id);
      rep = routeReport(layout, items, spawn);
    }
  }
  return { furniture: items, dropped, moved: [...moved].map(([id, v]) => ({ id, ...v })), left: rep };
}
