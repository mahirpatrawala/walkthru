// Owned by C11a. SPEC 16.5 "Sun and time of day". Pure: no three, no DOM.
import { computeEdgeFrames, roomAt } from '../core/layout-geom';
import type { Layout, Vec2 } from '../types';
import { DEFAULT_HOUR, HOUR_MAX, HOUR_MIN, LABEL_SUN_KNOWN, LABEL_SUN_UNKNOWN } from './types';
import type { LookFile } from './types';

const RAD = Math.PI / 180;
/** Peak elevation of the slider's sun. // SPEC-GAP: 16.5 says 62 degrees, which gives 35.2 degrees at 16:30 and fails the
 *  16.8 check 2 range (20 to 35). 60 degrees gives 34.1 degrees and keeps the shape of the curve. */
export const SUN_PEAK_ELEVATION_DEG = 60;
export const SUN_MIN_ELEVATION_DEG = 3;
/** how far from the opening's inward normal the sun sits at the default hour (16:30) when north is unknown */
export const SUN_BASE_OFFSET_DEG = 30;
/** the unknown-north sun sweeps this far either side of the opening's normal across the day */
export const SUN_SWEEP_DEG = 50;

export const clampHour = (h: number): number => Math.min(HOUR_MAX, Math.max(HOUR_MIN, h));

export function sunElevationDeg(hour: number): number {
  const h = clampHour(hour);
  return Math.max(SUN_MIN_ELEVATION_DEG, SUN_PEAK_ELEVATION_DEG * Math.sin((Math.PI * (h - 6)) / 13));
}

/** 2,200 K at 6:00 and 19:00, 5,600 K at 12:30. */
export function sunKelvin(hour: number): number {
  return 2200 + 3400 * Math.sin((Math.PI * (clampHour(hour) - 6)) / 13);
}

/** Tanner Helland's black-body fit, returned as linear RGB scaled so the largest channel is 1. */
export function kelvinToLinearRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const lin = (v: number): number => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const c: [number, number, number] = [lin(r), lin(g), lin(b)];
  const m = Math.max(c[0], c[1], c[2]) || 1;
  return [c[0] / m, c[1] / m, c[2] / m];
}

/** `3.0 * sin(elevation)`, minimum 0.4, in three's light units. */
export function sunIntensity(hour: number): number {
  return Math.max(0.4, 3.0 * Math.sin(sunElevationDeg(hour) * RAD));
}

export interface SunOpening {
  openingId: string; roomId: string; edge: number;
  /** centre of the opening on the room's wall line */ centre: Vec2;
  /** unit, pointing out of the room through the opening */ out: Vec2;
  /** unit, along the edge */ dir: Vec2;
  widthM: number;
  /** +1 or -1: which way along `dir` the light travels sideways so it heads for the middle of the room */
  lateralSign: number;
}

/**
 * The widest window or opening that faces outdoors: its edge has no partner room, or the partner is a balcony.
 * Openings of balcony rooms themselves are skipped. // SPEC-GAP: 16.5 says "an edge with no partner", but on the truth flat
 * the sliding opening's edge faces the balcony (so it has a partner) and 16.8 check 2 expects it to be chosen, so a balcony
 * partner counts as outdoors.
 */
export function findSunOpening(layout: Layout): SunOpening | null {
  const frames = computeEdgeFrames(layout);
  let best: SunOpening | null = null;
  for (const o of layout.openings) {
    if (o.type !== 'window' && o.type !== 'opening') continue;
    const room = layout.rooms.find((r) => r.id === o.roomId);
    const f = frames.find((x) => x.roomId === o.roomId && x.edge === o.edge);
    if (!room || !f || room.roomType === 'balcony') continue;
    const centre: Vec2 = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    let outdoors = f.partnerGap === null;
    if (!outdoors) {
      const probe: Vec2 = { x: centre.x + f.out.x * (f.thickness + 0.3), z: centre.z + f.out.z * (f.thickness + 0.3) };
      outdoors = roomAt(layout, probe)?.roomType === 'balcony';
    }
    if (!outdoors) continue;
    let cx = 0, cz = 0;
    for (const p of room.polygon) { cx += p.x; cz += p.z; }
    cx /= room.polygon.length; cz /= room.polygon.length;
    const side = (cx - centre.x) * f.dir.x + (cz - centre.z) * f.dir.z;
    const cand: SunOpening = {
      openingId: o.id, roomId: o.roomId, edge: o.edge, centre, out: { ...f.out }, dir: { ...f.dir },
      widthM: o.widthM, lateralSign: side < 0 ? -1 : 1,
    };
    if (!best || cand.widthM > best.widthM) best = cand;
  }
  return best;
}

/** Outward normal of the longest outside edge; the fallback when a flat has no window at all. */
function fallbackOut(layout: Layout): Vec2 {
  let best: Vec2 = { x: 0, z: -1 };
  let len = 0;
  for (const f of computeEdgeFrames(layout)) if (f.partnerGap === null && f.length > len) { len = f.length; best = { ...f.out }; }
  return best;
}

export interface SunState {
  hour: number;
  elevationDeg: number;
  /** unit vector from the scene towards the sun, y up */
  toSun: [number, number, number];
  /** unit horizontal direction the light travels (plan x, z): from outside into the room */
  lightDirXZ: Vec2;
  /** direction of the sun in plan space, degrees, atan2(z, x) of the horizontal part of `toSun` */
  planAzimuthDeg: number;
  /** compass azimuth (0 = north, clockwise) when the broker set north, else null */
  bearingDeg: number | null;
  kelvin: number;
  /** linear RGB, largest channel 1 */ colour: [number, number, number];
  intensity: number;
  known: boolean;
  /** the fixed label of SPEC 16.2 rule 4 */ label: string;
  opening: SunOpening | null;
}

export function sunState(layout: Layout, look: Pick<LookFile, 'northDeg'> | null, hourIn: number = DEFAULT_HOUR): SunState {
  const hour = clampHour(hourIn);
  const elevationDeg = sunElevationDeg(hour);
  const opening = findSunOpening(layout);
  let hx: number, hz: number;
  let bearingDeg: number | null = null;
  const north = look?.northDeg;
  if (north !== undefined && Number.isFinite(north)) {
    bearingDeg = 90 + (180 * (hour - 6)) / 13; // 90 at 6:00, 180 at 12:30, 270 at 19:00
    const a = (bearingDeg - north) * RAD;     // clockwise from the plan's -z
    hx = Math.sin(a); hz = -Math.cos(a);
  } else {
    const out = opening?.out ?? fallbackOut(layout);
    const lat: Vec2 = opening ? { x: -opening.dir.x * opening.lateralSign, z: -opening.dir.z * opening.lateralSign } : { x: -out.z, z: out.x };
    const theta = (SUN_BASE_OFFSET_DEG + (SUN_SWEEP_DEG * (hour - DEFAULT_HOUR)) / 6.5) * RAD;
    hx = out.x * Math.cos(theta) + lat.x * Math.sin(theta);
    hz = out.z * Math.cos(theta) + lat.z * Math.sin(theta);
  }
  const el = elevationDeg * RAD;
  const toSun: [number, number, number] = [hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)];
  const kelvin = sunKelvin(hour);
  return {
    hour, elevationDeg, toSun,
    lightDirXZ: { x: -hx, z: -hz },
    planAzimuthDeg: (Math.atan2(hz, hx) * 180) / Math.PI,
    bearingDeg, kelvin, colour: kelvinToLinearRgb(kelvin), intensity: sunIntensity(hour),
    known: bearingDeg !== null,
    label: bearingDeg !== null ? LABEL_SUN_KNOWN : LABEL_SUN_UNKNOWN,
    opening,
  };
}

/** "16:30" */
export function formatHour(h: number): string {
  const total = Math.round(clampHour(h) * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A word for the time of day, for the slider label. */
export function dayPart(h: number): string {
  if (h < 8) return 'early morning';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17.5) return 'late afternoon';
  return 'evening';
}
