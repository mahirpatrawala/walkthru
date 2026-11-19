// What the walk says about direction once north is known (SPEC 22.1, 22.2): which north applies, the lines of the facing card, the letters on the
// mini plan's edge, the compass dial's turn. Pure: no DOM, no three. Nothing here runs when north is not set.
import { DIR_WORDS, bearingOf, dir8, northFromLook, planDirOf, viewBearing } from '../../core/north';
import type { Dir8, NorthRef } from '../../core/north';
import { readFacing } from '../../core/facing';
import type { FacingReading, RoomReading, Zone } from '../../core/facing';
import type { Vec2 } from '../../types';

/**
 * The north of the space being walked: the building's, already turned into this scene by its placement (`SpaceHost.north`), else the property file's own, else the
 * scene's look.json `northDeg` (the bearing of the plan's up, SPEC 16.4, set by a builder by hand), else none. Never a guess.
 */
export function resolveNorth(o: { host?: NorthRef | null; property?: NorthRef | undefined; lookNorthDeg?: number | undefined }): NorthRef | null {
  if (o.host) return o.host;
  if (o.property) return o.property;
  if (typeof o.lookNorthDeg === 'number' && Number.isFinite(o.lookNorthDeg)) return northFromLook(o.lookNorthDeg, 'builder');
  return null;
}

export const dirWord = (d: Dir8): string => DIR_WORDS[d];
const ZONE_WORD: Record<Zone, string> = { ...DIR_WORDS, C: 'centre' };
export const zoneWord = (z: Zone): string => ZONE_WORD[z];

export interface DirectionLine { /** what it is: "Main door", "Balcony", "Master bedroom" */ what: string; /** "faces north-east" */ text: string; /** the 8-way letters, for a chip */ tag: string | null }

/** The facing card: the main door first, then each balcony, then every other room by where it sits (and what its window looks onto). */
export function facingLines(r: FacingReading): DirectionLine[] {
  const out: DirectionLine[] = [];
  out.push(r.mainDoor ? { what: 'Main door', text: `faces ${dirWord(r.mainDoor.facing)}`, tag: r.mainDoor.facing } : { what: 'Main door', text: 'no door to the outside found on the drawing', tag: null });
  const room = (x: RoomReading): DirectionLine => {
    const sits = x.zone === 'C' ? 'in the centre of the flat' : `in the ${dirWord(x.zone)} of the flat`;
    const looks = x.facing ? `, ${x.roomType === 'balcony' ? 'faces' : 'window looks'} ${dirWord(x.facing)}` : '';
    return { what: x.label, text: `${sits}${looks}`, tag: x.roomType === 'balcony' ? x.facing ?? (x.zone === 'C' ? null : x.zone) : x.zone === 'C' ? null : x.zone };
  };
  for (const x of r.rooms.filter((y) => y.roomType === 'balcony')) out.push(room(x));
  for (const x of r.rooms.filter((y) => y.roomType !== 'balcony')) out.push(room(x));
  return out;
}

/** The two short lines of the identity card: the door and the balcony(ies). */
export function cardLines(r: FacingReading): string[] {
  const lines: string[] = [];
  if (r.mainDoor) lines.push(`Main door faces ${dirWord(r.mainDoor.facing)}`);
  const bal = r.rooms.filter((x) => x.roomType === 'balcony' && x.facing);
  if (bal.length) lines.push(`${bal.length === 1 ? bal[0].label : 'Balconies'} face${bal.length === 1 ? 's' : ''} ${[...new Set(bal.map((b) => dirWord(b.facing as Dir8)))].join(' and ')}`);
  return lines;
}

// ---------------------------------------------------------------- the mini plan

export interface EdgeMark { dir: 'N' | 'E' | 'S' | 'W'; x: number; z: number }

/**
 * Where the four compass letters go on a plan drawn in the box `vb` (the plan's own viewBox): on the edge of the box, along the ray from its
 * middle towards that compass direction, `inset` in from the edge so the letter stays whole. A turned plan puts N where north really is.
 */
export function edgeMarks(north: NorthRef, vb: { x: number; y: number; width: number; height: number }, inset: number): EdgeMark[] {
  const cx = vb.x + vb.width / 2, cz = vb.y + vb.height / 2;
  const hx = Math.max(0.01, vb.width / 2 - inset), hz = Math.max(0.01, vb.height / 2 - inset);
  return ([['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const).map(([dir, bearing]) => {
    const d = planDirOf(north, bearing);
    const k = Math.min(Math.abs(d.x) > 1e-9 ? hx / Math.abs(d.x) : Infinity, Math.abs(d.z) > 1e-9 ? hz / Math.abs(d.z) : Infinity);
    return { dir, x: cx + d.x * k, z: cz + d.z * k };
  });
}

/** Where a facing tag goes: a little way out from a point (a door's middle) along the way it faces. */
export const tagAt = (p: Vec2, out: Vec2, offset: number): Vec2 => ({ x: p.x + out.x * offset, z: p.z + out.z * offset });

// ---------------------------------------------------------------- the compass dial

/** The dial's turn and its centre word for a camera looking along (dx, dz) on the plan (the camera's forward projected to the floor). Null when it looks straight up or down. */
export function dialState(north: NorthRef, forward: Vec2): { bearing: number; label: Dir8 } | null {
  if (Math.hypot(forward.x, forward.z) < 1e-4) return null;
  const bearing = bearingOf(north, forward);
  return { bearing, label: dir8(bearing) };
}
export { viewBearing };

/** A reading of this flat, or null: no north, no reading. */
export function readingFor(layout: Parameters<typeof readFacing>[0], north: NorthRef | null): FacingReading | null {
  return north ? readFacing(layout, north) : null;
}
