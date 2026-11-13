// Which rooms a buyer may start in, and which one is preselected. Pure.
import type { RoomTag } from '../types';

/** All these functions need is the room list, so a trimmed layout (the start page's manifest) works too. */
type HasRooms = { rooms: RoomTag[] };
import { roomAreaM2 } from './spawn';

/** Not a place to start: passages, bathrooms and balconies (unless there is nothing else), and any room only partly on the drawing. */
const NOT_A_START: ReadonlySet<RoomTag['roomType']> = new Set(['bathroom', 'balcony', 'other']);

/**
 * The rooms the "Where do you want to start?" page lets the buyer tap. Whole rooms only (never `partial`); passages,
 * bathrooms and balconies are left out unless no room of another kind is left. Falls back to every whole room, and
 * to an empty list only when every room is partial.
 */
export function startableRooms(layout: HasRooms): RoomTag[] {
  const whole = layout.rooms.filter((r) => !r.partial);
  const main = whole.filter((r) => !NOT_A_START.has(r.roomType));
  return main.length > 0 ? main : whole;
}

/** `unverified` is the id -> reason map from `unverifiedRoomsFromExtras`; those rooms have no trusted size. */
export type UnverifiedMap = Record<string, string>;

/**
 * The preselected start room: the largest bedroom or living room, preferring rooms whose size is measured. Falls back to
 * the largest startable room, then null.
 */
export function defaultStartRoom(layout: HasRooms, unverified: UnverifiedMap = {}): RoomTag | null {
  const rooms = startableRooms(layout);
  if (rooms.length === 0) return null;
  const largest = (list: RoomTag[]): RoomTag | null =>
    list.reduce<RoomTag | null>((best, r) => (best === null || roomAreaM2(r) > roomAreaM2(best) ? r : best), null);
  const sleepOrSit = rooms.filter((r) => r.roomType === 'bedroom' || r.roomType === 'living');
  const measured = (list: RoomTag[]): RoomTag[] => list.filter((r) => !unverified[r.id]);
  return largest(measured(sleepOrSit)) ?? largest(sleepOrSit) ?? largest(measured(rooms)) ?? largest(rooms);
}

/** The room a URL's `room` parameter names, when it is one a buyer can start in; otherwise the default. */
export function resolveStartRoom(layout: HasRooms, requested: string | null, unverified: UnverifiedMap = {}): RoomTag | null {
  if (requested) {
    const hit = layout.rooms.find((r) => r.id === requested);
    if (hit && !hit.partial) return hit;
  }
  return defaultStartRoom(layout, unverified);
}
