// A small kit for authoring the building's own spaces (corridors, lobbies, amenity rooms) as ordinary scenes: rectangle rooms with a
// wall on every side, doors and openings placed by where they are on the plan. The flats come from the drawing reader instead.
import { DEFAULT_FINISHES } from '../../src/types';
import type { DoorLeaf, EdgeKind, Finishes, FurnitureItem, Layout, Opening, PropertyFile, RoomTag, RoomType, SpaceKind, Vec2 } from '../../src/types';

export type Side = 'N' | 'E' | 'S' | 'W';
const EDGE_OF: Record<Side, number> = { N: 0, E: 1, S: 2, W: 3 };
export const OUT_OF: Record<Side, Vec2> = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** A rectangle room, corners NW, NE, SE, SW (edge 0 is the north wall, 1 east, 2 south, 3 west), the winding every scene uses. */
export function rectRoom(id: string, label: string, roomType: RoomType, r: Rect, edges?: EdgeKind[]): RoomTag {
  return {
    id, roomType, label,
    polygon: [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }],
    edges: edges ?? ['wall', 'wall', 'wall', 'wall'],
  };
}

export function rectOf(room: RoomTag): Rect {
  const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/** Distance along edge `side` from its start to the plan coordinate `at` (x for the north and south walls, z for east and west). */
export function alongEdge(r: Rect, side: Side, at: number): number {
  switch (side) {
    case 'N': return at - r.x0;
    case 'E': return at - r.z0;
    case 'S': return r.x1 - at;
    case 'W': return r.z1 - at;
  }
}

export interface DoorOpts {
  id: string;
  type?: 'door' | 'opening';
  widthM: number;
  headM?: number;
  leaf?: DoorLeaf;
}

/** An opening in `room`'s wall on `side`, centred at plan coordinate `at`. */
export function openingAt(room: RoomTag, side: Side, at: number, o: DoorOpts): Opening {
  const r = rectOf(room);
  const op: Opening = {
    id: o.id, roomId: room.id, edge: EDGE_OF[side], type: o.type ?? 'door', centreM: alongEdge(r, side, at), widthM: o.widthM,
    sillM: 0, headM: o.headM ?? 2.1,
  };
  if ((o.type ?? 'door') === 'door') op.leaf = o.leaf ?? { hinge: 'start', swing: 'in', kind: 'hinged' };
  return op;
}

export function windowAt(room: RoomTag, side: Side, at: number, id: string, widthM: number, sillM = 0.9, headM = 2.1): Opening {
  const r = rectOf(room);
  return { id, roomId: room.id, edge: EDGE_OF[side], type: 'window', centreM: alongEdge(r, side, at), widthM, sillM, headM };
}

export function finishes(over: Partial<Finishes>): Finishes {
  return { ...DEFAULT_FINISHES, ...over };
}

export interface SceneParts {
  id: string;
  title: string;
  subtitle: string;
  wallHeightM: number;
  rooms: RoomTag[];
  openings: Opening[];
  furniture?: FurnitureItem[];
  finishes?: Finishes;
  spawn?: { x: number; z: number; yawDeg: number };
  /** the generator's fixed time stamp, so the files are identical on every run */
  updatedAt: string;
  /** what kind of place the scene is (`PropertyFile.spaceKind`) */
  spaceKind: SpaceKind;
}

export function sceneFile(p: SceneParts): PropertyFile {
  const first = p.rooms[0];
  const c = first.polygon.reduce((a, q) => ({ x: a.x + q.x / first.polygon.length, z: a.z + q.z / first.polygon.length }), { x: 0, z: 0 });
  const layout: Layout = {
    wallHeightM: p.wallHeightM, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: p.rooms, openings: p.openings,
    finishes: p.finishes ?? DEFAULT_FINISHES, scaleSource: 'typed-sizes',
  };
  return {
    version: 1, id: p.id, title: p.title, subtitle: p.subtitle, layout, furniture: p.furniture ?? [],
    spawn: p.spawn ?? { x: c.x, z: c.z, yawDeg: 0 }, unlisted: true, spaceKind: p.spaceKind, updatedAt: p.updatedAt,
  };
}
