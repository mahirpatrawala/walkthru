// Which rooms a tour visits and in what order. Pure: no DOM, no three.
//
// Every whole room that has a place to stand (the same smart spawn the start page uses) and can be reached on the walk grid is one
// stop. The order is the nearest unvisited room by walking distance, with a surcharge on the ones nobody wants to see early (toilets
// last, utility rooms and balconies after the living areas), so a flat reads living first, then bedrooms and kitchen, then the rest.
import type { Grid, Layout, RoomTag, Vec2 } from '../../types';
import { chooseSpawn } from '../../core/spawn';
import type { Spawn } from '../../core/spawn';

export type RoomKind = 'main' | 'balcony' | 'other' | 'wet' | 'transit';

const TRANSIT_NAME = /\b(passage|lobby|corridor|foyer|hall|hallway|entrance|entry|vestibule|landing|link)\b/i;

/** What kind of stop a room is, from its type and its name (a passage is a type `other`, like a utility room, so the name decides). */
export function roomKind(room: Pick<RoomTag, 'roomType' | 'label'>): RoomKind {
  if (room.roomType === 'bathroom') return 'wet';
  if (room.roomType === 'balcony') return 'balcony';
  if (room.roomType === 'other') return TRANSIT_NAME.test(room.label) ? 'transit' : 'other';
  return 'main';
}

/** Seconds a tour stays in a room: a look round in a living area, a glance into a toilet, a moment in a passage. */
export const DWELL_S: Record<RoomKind, number> = { main: 5.5, balcony: 4, other: 3.5, wet: 3, transit: 1.6 };
/** Metres of walking a room is made to seem further away when the next stop is chosen. */
export const ORDER_PENALTY_M: Record<RoomKind, number> = { main: 0, transit: 0, balcony: 4, other: 5, wet: 12 };

export interface TourStop { room: RoomTag; kind: RoomKind; spot: Spawn }
export interface Skipped { roomId: string; label: string; why: 'not on the drawing' | 'no place to stand' | 'not reachable'; /** what went wrong, for the console and the tests (not shown to the buyer) */ detail?: string }

/** The stops of a tour of this layout (every whole room with a place to stand), and the rooms that have none. `grid` carries the furniture. */
export function tourStops(layout: Layout, grid: Grid): { stops: TourStop[]; skipped: Skipped[] } {
  const stops: TourStop[] = [];
  const skipped: Skipped[] = [];
  for (const room of layout.rooms) {
    if (room.partial) { skipped.push({ roomId: room.id, label: room.label, why: 'not on the drawing' }); continue; }
    const spot = chooseSpawn(layout, room.id, grid);
    if (!spot) { skipped.push({ roomId: room.id, label: room.label, why: 'no place to stand' }); continue; }
    stops.push({ room, kind: roomKind(room), spot });
  }
  return { stops, skipped };
}

/** The next stop: least (walking distance + surcharge). `lengthTo` gives Infinity for a stop that cannot be reached; those are returned apart. */
export function pickNext(remaining: readonly TourStop[], lengthTo: (spot: Vec2) => number): { next: TourStop | null; lengthM: number; unreachable: TourStop[] } {
  let best: TourStop | null = null, bestCost = Infinity, bestLen = Infinity;
  const unreachable: TourStop[] = [];
  for (const s of remaining) {
    const len = lengthTo(s.spot);
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
