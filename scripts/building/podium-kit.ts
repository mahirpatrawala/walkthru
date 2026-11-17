// Drawing a level of rooms that are not all rectangles (the clubhouse level of the Sample Tower, scripts/building/podium-level.ts): a room from the union of
// rectangles or from a polygon, doors placed by their position on the plan, the two sides of one doorway made to agree. Pure.
import { DEFAULT_FINISHES } from '../../src/types';
import type { DoorLeaf, EdgeKind, Finishes, FurnitureItem, Layout, Opening, PropertyFile, RoomTag, SpaceKind, Vec2 } from '../../src/types';
import { normalizeRoom } from '../../src/core/layout-validate';
import { doorFrame } from '../../src/building/geom';
import { clearRoutes } from '../../src/building/clear-routes';
import { unionOutline } from '../../src/outdoor/outline';
import type { Rect } from '../../src/outdoor/types';
import { sceneFile } from './scene-kit';

/** a room from a polygon (any winding), edges all 'wall' unless `kind` says otherwise (it is asked with the edge's middle, after the winding is fixed) */
export function roomOf(id: string, label: string, polygon: Vec2[], kind?: (mid: Vec2, a: Vec2, b: Vec2, i: number) => EdgeKind): RoomTag {
  const raw: RoomTag = { id, label, roomType: 'other', polygon: polygon.map((p) => ({ ...p })), edges: polygon.map(() => 'wall' as EdgeKind) };
  const room = normalizeRoom(raw);
  if (kind) room.edges = room.polygon.map((a, i) => { const b = room.polygon[(i + 1) % room.polygon.length]; return kind({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, a, b, i); });
  return room;
}

/** a room that is the union of touching rectangles (it must be one piece) */
export function roomOfRects(id: string, label: string, rects: readonly Rect[], kind?: Parameters<typeof roomOf>[3]): RoomTag {
  const loops = unionOutline(rects);
  if (loops.length !== 1) throw new Error(`${id}: the rectangles make ${loops.length} outlines, not one`);
  return roomOf(id, label, loops[0], kind);
}

/** the edge of `room` that passes nearest to `p`, with the distance along it from its start to the foot of `p` */
export function edgeNear(room: RoomTag, p: Vec2): { edge: number; at: number; dist: number; len: number } {
  let best = { edge: -1, at: 0, dist: Infinity, len: 0 };
  room.polygon.forEach((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(len, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len));
    const q = { x: a.x + (dx / len) * t, z: a.z + (dz / len) * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best.dist) best = { edge: i, at: t, dist: d, len };
  });
  return best;
}

/** A scene being drawn: its one room (or several), its openings and its pieces. */
export interface Draft {
  id: string;
  title: string;
  kind: SpaceKind;
  wallHeightM: number;
  rooms: RoomTag[];
  openings: Opening[];
  furniture: FurnitureItem[];
  finishes: Finishes;
  spawn: { x: number; z: number; yawDeg: number };
  subtitle: string;
  updatedAt: string;
}

export const layoutOf = (d: Draft): Layout => ({
  wallHeightM: d.wallHeightM, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: d.rooms, openings: d.openings, finishes: d.finishes ?? DEFAULT_FINISHES, scaleSource: 'typed-sizes',
});

export const propertyOf = (d: Draft): PropertyFile => sceneFile({
  id: d.id, title: d.title, subtitle: d.subtitle, wallHeightM: d.wallHeightM, rooms: d.rooms, openings: d.openings,
  // loose seating and sets never shut a room away or block a door (src/building/clear-routes.ts)
  furniture: clearRoutes(layoutOf(d), d.furniture, d.spawn).furniture, finishes: d.finishes, spawn: d.spawn, updatedAt: d.updatedAt, spaceKind: d.kind,
});

export interface DoorSpec { id: string; widthM: number; headM?: number; type?: 'door' | 'opening' }

/** an opening on the wall of `room` nearest to the plan point `p` (which must lie within `tolM` of a wall) */
function openingAtPoint(room: RoomTag, p: Vec2, spec: DoorSpec, leaf: DoorLeaf | undefined, tolM: number): Opening {
  const e = edgeNear(room, p);
  if (e.edge < 0 || e.dist > tolM) throw new Error(`door "${spec.id}": the point (${p.x}, ${p.z}) is ${e.dist.toFixed(2)} m from the nearest wall of ${room.id}`);
  const half = spec.widthM / 2;
  const centre = Math.min(e.len - half - 0.02, Math.max(half + 0.02, e.at));
  const op: Opening = { id: spec.id, roomId: room.id, edge: e.edge, type: spec.type ?? 'door', centreM: Math.round(centre * 1000) / 1000, widthM: spec.widthM, sillM: 0, headM: spec.headM ?? 2.1 };
  if ((spec.type ?? 'door') === 'door' && leaf) op.leaf = leaf;
  return op;
}

/** a door on one side only (a lift, the stairs, the door to a level below) */
export function addDoor(d: Draft, p: Vec2, spec: DoorSpec, swing: 'in' | 'out' = 'in'): void {
  d.openings.push(openingAtPoint(d.rooms.find((r) => edgeNear(r, p).dist < 0.4) ?? d.rooms[0], p, spec, { hinge: 'start', swing, kind: 'hinged' }, 0.4));
}

/**
 * One doorway between two scenes drawn in the same frame: the same plan point on both walls, the leaf hinged on the same post and swinging from `a` into `b`.
 * The hinge of `b` is chosen by looking where each choice puts the post (`doorFrame`), so the pair always agrees whichever way the two walls run.
 */
export function addDoorPair(a: Draft, ida: string, b: Draft, idb: string, p: Vec2, widthM: number, o: { headM?: number } = {}): void {
  const roomA = a.rooms.find((r) => edgeNear(r, p).dist < 0.4);
  const roomB = b.rooms.find((r) => edgeNear(r, p).dist < 0.4);
  if (!roomA || !roomB) throw new Error(`doorway ${ida} / ${idb}: (${p.x}, ${p.z}) is not on a wall of both rooms`);
  const spec = (id: string): DoorSpec => ({ id, widthM, ...(o.headM ? { headM: o.headM } : {}) });
  const opA = openingAtPoint(roomA, p, spec(ida), { hinge: 'start', swing: 'out', kind: 'hinged' }, 0.4);
  a.openings.push(opA);
  const post = doorFrame(layoutOf(a), ida)!.hinge!;
  let best: Opening | null = null, bestD = Infinity;
  for (const hinge of ['start', 'end'] as const) {
    const opB = openingAtPoint(roomB, p, spec(idb), { hinge, swing: 'in', kind: 'hinged' }, 0.4);
    const tmp: Draft = { ...b, openings: [...b.openings, opB] };
    const h = doorFrame(layoutOf(tmp), idb)!.hinge!;
    // along the wall: the two posts are the same post when they coincide along it
    const dd = Math.hypot(h.x - post.x, h.z - post.z);
    if (dd < bestD) { bestD = dd; best = opB; }
  }
  b.openings.push(best!);
}

/** a window on the wall nearest to `p` */
export function addWindow(d: Draft, p: Vec2, id: string, widthM: number, sillM = 0.9, headM = 2.1): void {
  const room = d.rooms.find((r) => edgeNear(r, p).dist < 0.4) ?? d.rooms[0];
  const e = edgeNear(room, p);
  const half = widthM / 2;
  d.openings.push({ id, roomId: room.id, edge: e.edge, type: 'window', centreM: Math.min(e.len - half - 0.05, Math.max(half + 0.05, e.at)), widthM, sillM, headM });
}
