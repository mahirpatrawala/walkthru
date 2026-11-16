// Which rooms a tour visits and in what order. Pure: no DOM, no three.
//
// Every whole room that has a place to stand (the same smart spawn the start page uses) and can be reached on the walk grid is one
// stop. The order is the nearest unvisited room by walking distance, with a surcharge on the ones nobody wants to see early (toilets
// last, utility rooms and balconies after the living areas), so a flat reads living first, then bedrooms and kitchen, then the rest.
import type { Grid, Layout, RoomTag, Vec2 } from '../../types';
import { chooseSpawn, polygonCentroid, yawToward } from '../../core/spawn';
import type { Spawn } from '../../core/spawn';
import { cellValue } from '../../core/grid-codec';
import { circleFree } from '../../core/grid-query';
import { pointInPolygon } from '../../core/geometry';
import { CHARACTER_RADIUS_M, GRID_TALL_CM, GRID_VOID } from '../../types';

export type RoomKind = 'main' | 'balcony' | 'other' | 'wet' | 'transit';

const TRANSIT_NAME = /\b(passage|lobby|corridor|foyer|hall|hallway|entrance|entry|vestibule|landing|link)\b/i;

/** What kind of stop a room is, from its type and its name (a passage is a type `other`, like a utility room, so the name decides). */
export function roomKind(room: Pick<RoomTag, 'roomType' | 'label'>): RoomKind {
  if (room.roomType === 'bathroom') return 'wet';
  if (room.roomType === 'balcony') return 'balcony';
  if (room.roomType === 'other') return TRANSIT_NAME.test(room.label) ? 'transit' : 'other';
  return 'main';
}

/** Seconds a tour stays in a room: one slow arc toward what the room is for (5 to 7 s in a living area, less in a toilet). A passage is glided through: no stop. */
export const DWELL_S: Record<RoomKind, number> = { main: 6.5, balcony: 5, other: 5, wet: 4.5, transit: 0 };
/** Metres of walking a room is made to seem further away when the next stop is chosen. */
export const ORDER_PENALTY_M: Record<RoomKind, number> = { main: 0, transit: 0, balcony: 4, other: 5, wet: 12 };

/** Where to stand and what to look at: `focal` is the thing the room is about (bed, sofa, table, counter, a window, else the middle). */
export interface Vantage { x: number; z: number; yawDeg: number; focal: Vec2 }
export interface TourStop { room: RoomTag; kind: RoomKind; spot: Spawn; /** where the camera dwells (the standing spot when no better one was found) */ vantage: Vantage }
export interface Skipped { roomId: string; label: string; why: 'not on the drawing' | 'no place to stand' | 'not reachable'; /** what went wrong, for the console and the tests (not shown to the buyer) */ detail?: string }

/** The stops of a tour of this layout (every whole room with a place to stand), and the rooms that have none. `grid` carries the furniture. */
export function tourStops(layout: Layout, grid: Grid, focalOf?: (roomId: string) => Vec2 | null): { stops: TourStop[]; skipped: Skipped[] } {
  const stops: TourStop[] = [];
  const skipped: Skipped[] = [];
  for (const room of layout.rooms) {
    if (room.partial) { skipped.push({ roomId: room.id, label: room.label, why: 'not on the drawing' }); continue; }
    const spot = chooseSpawn(layout, room.id, grid);
    if (!spot) { skipped.push({ roomId: room.id, label: room.label, why: 'no place to stand' }); continue; }
    stops.push({ room, kind: roomKind(room), spot, vantage: vantageFor(layout, grid, room, spot, focalOf?.(room.id) ?? windowSpot(layout, room) ?? polygonCentroid(room.polygon)) });
  }
  return { stops, skipped };
}

/** The next stop: least (walking distance + surcharge). `lengthTo` gives Infinity for a stop that cannot be reached; those are returned apart. */
export function pickNext(remaining: readonly TourStop[], lengthTo: (spot: Vec2) => number, spotOf: (s: TourStop) => Vec2 = (s) => s.spot): { next: TourStop | null; lengthM: number; unreachable: TourStop[] } {
  let best: TourStop | null = null, bestCost = Infinity, bestLen = Infinity;
  const unreachable: TourStop[] = [];
  for (const s of remaining) {
    const len = lengthTo(spotOf(s));
    if (!Number.isFinite(len)) { unreachable.push(s); continue; }
    const cost = len + ORDER_PENALTY_M[s.kind];
    if (cost < bestCost) { best = s; bestCost = cost; bestLen = len; }
  }
  return { next: best, lengthM: bestLen, unreachable };
}

/** Words for the end of a tour: what was left out and why, or null when nothing was. */
export function skippedNote(skipped: readonly Skipped[]): string | null {
  if (skipped.length === 0) return null;
  const why = (s: Skipped): string => (s.why === 'not reachable' ? 'could not be reached' : s.why === 'not on the drawing' ? 'is only partly on the drawing' : 'has no clear place to stand');
  if (skipped.length === 1) return `${skipped[0].label} ${why(skipped[0])}.`;
  return `Left out: ${skipped.map((s) => s.label).join(', ')}.`;
}

/** The middle of the first window of a room, if it has one (a view worth looking at when nothing else is). */
export function windowSpot(layout: Layout, room: RoomTag): Vec2 | null {
  const w = layout.openings.find((o) => o.roomId === room.id && o.type === 'window');
  if (!w) return null;
  const a = room.polygon[w.edge], b = room.polygon[(w.edge + 1) % room.polygon.length];
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  if (l < 1e-6) return null;
  return { x: a.x + ((b.x - a.x) * w.centreM) / l, z: a.z + ((b.z - a.z) * w.centreM) / l };
}

/** How far a ray from `p` along `yawDeg` runs through clear floor before a wall or a tall piece, metres (to `maxM`). */
export function sightM(grid: Grid, p: Vec2, yawDeg: number, maxM = 8): number {
  const a = (yawDeg * Math.PI) / 180, dx = Math.sin(a), dz = Math.cos(a);
  for (let d = 0.2; d <= maxM; d += 0.1) {
    const v = cellValue(grid, p.x + dx * d, p.z + dz * d);
    if (v === GRID_VOID || v >= GRID_TALL_CM) return d;
  }
  return maxM;
}

/**
 * Where a tour stands in a room and what it faces. The candidates are a 0.5 m lattice of points with the body's clearance and 0.45 m more to
 * every wall; a point scores by the clear sight it has in a 90 degree fan toward the focal point (longest sight lines), by the focal point
 * being seen at all and not too close (2.2 to 5 m is a good distance), and loses a little the further it is from the standing spot just in
 * from the door (so the glide into the room is short). The standing spot itself is the fallback and the tie-break.
 */
export function vantageFor(layout: Layout, grid: Grid, room: RoomTag, spot: Spawn, focal: Vec2): Vantage {
  const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
  const fallback: Vantage = { x: spot.x, z: spot.z, yawDeg: Math.hypot(focal.x - spot.x, focal.z - spot.z) > 0.3 ? yawToward(spot, focal) : spot.yawDeg, focal };
  void layout;
  let best: Vantage | null = null, bestScore = -Infinity;
  for (let x = Math.min(...xs) + 0.4; x <= Math.max(...xs) - 0.4; x += 0.5) {
    for (let z = Math.min(...zs) + 0.4; z <= Math.max(...zs) - 0.4; z += 0.5) {
      const p = { x, z };
      if (!pointInPolygon(p, room.polygon)) continue;
      if (!circleFree(grid, x, z, CHARACTER_RADIUS_M + 0.45)) continue;
      const dist = Math.hypot(focal.x - x, focal.z - z);
      if (dist < 1.0) continue;
      const yaw = yawToward(p, focal);
      let fan = 0;
      const offs = [-45, -30, -15, 0, 15, 30, 45];
      for (const o of offs) fan += Math.min(6, sightM(grid, p, yaw + o, 6));
      fan /= offs.length;
      const seen = sightM(grid, p, yaw, dist + 0.4) >= dist - 0.35 ? 1 : 0; // nothing tall between the eyes and the focal point
      const distScore = dist < 2.2 ? -(2.2 - dist) * 1.2 : dist > 5 ? -(dist - 5) * 0.6 : 0.6;
      const score = fan + 2.2 * seen + distScore - 0.25 * Math.hypot(x - spot.x, z - spot.z);
      if (score > bestScore) { bestScore = score; best = { x, z, yawDeg: yaw, focal }; }
    }
  }
  return best ?? fallback;
}
