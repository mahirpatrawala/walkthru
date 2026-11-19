// North, the one place that knows how a plan is turned against the compass (SPEC 22.1). Pure: no DOM, no three.
//
// A plan's coordinates are x east-ish and z south-ish ON THE PAGE: "up" the page is -z. `NorthRef.deg` says how far true north is turned from
// the plan's up, clockwise: 0 = north is up the page, 90 = north points to the right (so east is down the page), 270 = north is to the left.
// Compass bearings are degrees clockwise from true north (0 N, 90 E, 180 S, 270 W). Never guessed: a plan with no `NorthRef` has no compass.
//
// Careful: `look.json` `northDeg` (SPEC 16.4) is the OTHER way round, the bearing of the plan's up. `lookNorthDeg` / `northFromLook` convert,
// and they are each other's inverse.
import type { Vec2 } from '../types';

export type NorthSource = 'drawing' | 'builder';
export const NORTH_SOURCES: readonly NorthSource[] = ['drawing', 'builder'];

export interface NorthRef {
  /** degrees clockwise from the plan's up (-z) to true north, [0, 360) */
  deg: number;
  /** `drawing`: read from a north arrow on the drawing. `builder`: set by the builder or the broker by hand. */
  source: NorthSource;
}

export const normDeg = (d: number): number => { const r = d % 360; return r < 0 ? r + 360 : r === 0 ? 0 : r; };

/** Reads a `north` field; throws an Error naming what is wrong (callers put the path in front). */
export function parseNorth(v: unknown): NorthRef {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('must be {deg, source}');
  const o = v as Record<string, unknown>;
  if (typeof o.deg !== 'number' || !Number.isFinite(o.deg)) throw new Error('.deg must be a number of degrees');
  if (o.source !== 'drawing' && o.source !== 'builder') throw new Error(`.source must be "drawing" or "builder" (got ${String(o.source)})`);
  return { deg: normDeg(o.deg), source: o.source };
}

/** True for a usable north (a finite bearing), so a caller can write `if (hasNorth(n))` and carry nothing when it is absent. */
export const hasNorth = (n: NorthRef | null | undefined): n is NorthRef => !!n && Number.isFinite(n.deg);

/** `look.json` northDeg (the bearing of the plan's up) and `NorthRef.deg` convert into each other. */
export const lookNorthDeg = (deg: number): number => normDeg(360 - deg);
export const northFromLook = (lookDeg: number, source: NorthSource = 'builder'): NorthRef => ({ deg: normDeg(360 - lookDeg), source });

/** A scene placed on a building's plate turned `rotDeg` clockwise: the scene's own up is `rotDeg` round from the plate's up, so north is `rotDeg` less far from it. */
export function northInScene(plate: NorthRef, rotDeg: number): NorthRef {
  return { deg: normDeg(plate.deg - rotDeg), source: plate.source };
}

// ---------------------------------------------------------------- directions

export const DIRS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Dir8 = (typeof DIRS8)[number];
export const DIR_WORDS: Record<Dir8, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

/** The 8-way label of a bearing: each covers 45 degrees centred on its own point (N is 337.5 to 22.5). */
export const dir8 = (bearingDeg: number): Dir8 => DIRS8[Math.round(normDeg(bearingDeg) / 45) % 8];

/** The angle of a plan vector, degrees clockwise from the plan's up (-z). */
export const planAngle = (v: Vec2): number => normDeg((Math.atan2(v.x, -v.z) * 180) / Math.PI);

/** The compass bearing of a direction on the plan. */
export const bearingOf = (north: NorthRef, v: Vec2): number => normDeg(planAngle(v) - north.deg);
export const facingOf = (north: NorthRef, v: Vec2): Dir8 => dir8(bearingOf(north, v));

/** The compass bearing the walker looks along when the camera's yaw is `yawDeg` (forward is (sin yaw, cos yaw), SPEC 3.1). */
export const viewBearing = (north: NorthRef, yawDeg: number): number => normDeg(180 - yawDeg - north.deg);

/** The direction of a compass bearing on the plan (unit). */
export function planDirOf(north: NorthRef, bearingDeg: number): Vec2 {
  const a = ((bearingDeg + north.deg) * Math.PI) / 180;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

/** A plan point in the compass frame: `e` metres east, `n` metres north of the plan's origin. */
export function toCompass(north: NorthRef, p: Vec2): { e: number; n: number } {
  const e = planDirOf(north, 90), n = planDirOf(north, 0);
  return { e: p.x * e.x + p.z * e.z, n: p.x * n.x + p.z * n.z };
}
