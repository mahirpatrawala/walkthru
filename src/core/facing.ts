// Which way things face, once north is known (SPEC 22.1, 22.2): the main door, each balcony and each room, as 8-way labels, and the zones of the
// flat (a 3 x 3 grid laid on the flat's box turned to true north). Pure. Nothing here guesses: with no north there is no reading.
import { mainEntrance } from './entrance';
import { computeEdgeFrames } from './layout-geom';
import { facingOf, toCompass } from './north';
import type { Dir8, NorthRef } from './north';
import type { Layout, RoomTag, Vec2 } from '../types';

/** A zone of the flat: one of the 8 directions round the middle, or the middle itself. */
export type Zone = Dir8 | 'C';

export interface ZoneGrid {
  north: NorthRef;
  /** the flat's box in the compass frame: metres east and north of the plan's origin */
  e0: number; e1: number; n0: number; n1: number;
}

export const polygonCentroid = (poly: Vec2[]): Vec2 => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const k = p.x * q.z - q.x * p.z;
    a += k; cx += (p.x + q.x) * k; cz += (p.z + q.z) * k;
  }
  if (Math.abs(a) < 1e-9) { // a sliver: the average of its corners
    return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
};

/**
 * The 3 x 3 grid: the box of the flat in the compass frame (turned to true north, so it is the smallest box with its sides running north-south and
 * east-west that holds the flat), split into thirds each way. Balconies and decks stand outside the walls, so they do not stretch the box (a
 * balcony's own zone is where its centre falls, which the nearest cell takes when it is outside). A layout of balconies alone uses them all.
 */
export function zoneGrid(layout: Pick<Layout, 'rooms'>, north: NorthRef): ZoneGrid | null {
  const inside = layout.rooms.filter((r) => r.roomType !== 'balcony');
  const rooms = inside.length ? inside : layout.rooms;
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const r of rooms) for (const p of r.polygon) { const c = toCompass(north, p); e0 = Math.min(e0, c.e); e1 = Math.max(e1, c.e); n0 = Math.min(n0, c.n); n1 = Math.max(n1, c.n); }
  return Number.isFinite(e0) ? { north, e0, e1, n0, n1 } : null;
}

/** The zone a point falls in (outside the box: the nearest cell). */
export function zoneOf(g: ZoneGrid, p: Vec2): Zone {
  const c = toCompass(g.north, p);
  const col = c.e < g.e0 + (g.e1 - g.e0) / 3 ? -1 : c.e > g.e0 + (2 * (g.e1 - g.e0)) / 3 ? 1 : 0; // -1 west, 1 east
  const row = c.n < g.n0 + (g.n1 - g.n0) / 3 ? -1 : c.n > g.n0 + (2 * (g.n1 - g.n0)) / 3 ? 1 : 0; // -1 south, 1 north
  const NAMES: Record<string, Zone> = { '0,1': 'N', '1,1': 'NE', '1,0': 'E', '1,-1': 'SE', '0,-1': 'S', '-1,-1': 'SW', '-1,0': 'W', '-1,1': 'NW', '0,0': 'C' };
  return NAMES[`${col},${row}`];
}

export interface RoomReading {
  roomId: string;
  label: string;
  roomType: RoomTag['roomType'];
  /** where the room sits in the flat */
  zone: Zone;
  /** the way its outer opening looks (a window, a sliding door, a balcony's railing); null for a room with no outside wall opening */
  facing: Dir8 | null;
  centre: Vec2;
}

export interface FacingReading {
  north: NorthRef;
  grid: ZoneGrid;
  mainDoor: { openingId: string; facing: Dir8; at: Vec2 } | null;
  rooms: RoomReading[];
}

/** The way a room looks out: a balcony its longest open railing, any other room its widest window or door on a wall nothing faces. */
function roomOutlook(layout: Layout, frames: ReturnType<typeof computeEdgeFrames>, room: RoomTag): Vec2 | null {
  const mine = frames.filter((f) => f.roomId === room.id && f.partnerGap === null);
  if (room.roomType === 'balcony') {
    const rail = mine.filter((f) => f.kind === 'railing').sort((a, b) => b.length - a.length)[0];
    return rail ? rail.out : null;
  }
  let best: { out: Vec2; w: number } | null = null;
  for (const o of layout.openings) {
    if (o.roomId !== room.id || (o.type !== 'window' && o.type !== 'door')) continue;
    const f = mine.find((x) => x.edge === o.edge && x.kind !== 'none');
    if (f && (!best || o.widthM > best.w)) best = { out: f.out, w: o.widthM };
  }
  return best ? best.out : null;
}

export function readFacing(layout: Layout, north: NorthRef): FacingReading | null {
  const grid = zoneGrid(layout, north);
  if (!grid) return null;
  const frames = computeEdgeFrames(layout);
  const door = mainEntrance(layout);
  return {
    north, grid,
    mainDoor: door ? { openingId: door.openingId, facing: facingOf(north, door.out), at: door.at } : null,
    rooms: layout.rooms.map((r) => {
      const centre = polygonCentroid(r.polygon);
      const look = roomOutlook(layout, frames, r);
      return { roomId: r.id, label: r.label, roomType: r.roomType, zone: zoneOf(grid, centre), facing: look ? facingOf(north, look) : null, centre };
    }),
  };
}
