// Owned by C11a. SPEC 16.4: the optional per-property sidecar public/scenes/<id>/look.json, and shared small types.

export type Tier = 'low' | 'medium' | 'high';
export type Backdrop = 'rooftop_day' | 'rooftop_night' | 'sky';

export interface LookFile {
  version: 1;
  /** storey the flat is on; picks the backdrop. Default 8. */
  floorNumber?: number;
  /** compass bearing of the plan's -z direction, degrees clockwise from north. Absent = unknown. */
  northDeg?: number;
  /** default hour for the time slider, 6..21. Absent = the Afternoon preset (grade.ts). */
  hour?: number;
  /** default preset (morning, afternoon, evening, night); `hour` wins when both are set */
  preset?: 'morning' | 'afternoon' | 'evening' | 'night';
  /** broker's choice of backdrop, overriding floorNumber */
  backdrop?: Backdrop;
}

export const DEFAULT_HOUR = 16.5;
export const DEFAULT_FLOOR_NUMBER = 8;
export const HOUR_MIN = 6;
/** the slider runs to 21:00 so it can reach the Night preset (the sun itself is modelled 6:00 to 19:00, sun.ts) */
export const HOUR_MAX = 21;

/** The three fixed labels of SPEC 16.2 rule 4. */
export const LABEL_VIEW = 'Outside the window is a plain sky, not the real view.';
export const LABEL_SUN_UNKNOWN = 'Sun direction assumed: the drawing has no north arrow.';
export const LABEL_SUN_KNOWN = 'Sun direction is approximate.';
export const LABEL_FURNITURE = 'Furniture style is illustrative. Sizes are exact.';

const BACKDROPS: Backdrop[] = ['rooftop_day', 'rooftop_night', 'sky'];

/** Reads look.json leniently: anything that is not usable is dropped, never thrown. A missing or malformed file means all defaults. */
export function parseLookFile(json: unknown): LookFile | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const out: LookFile = { version: 1 };
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const fl = num(o.floorNumber);
  if (fl !== undefined) out.floorNumber = Math.round(fl);
  const north = num(o.northDeg);
  if (north !== undefined) out.northDeg = ((north % 360) + 360) % 360;
  const hour = num(o.hour);
  if (hour !== undefined) out.hour = Math.min(HOUR_MAX, Math.max(HOUR_MIN, hour));
  if (typeof o.preset === 'string' && ['morning', 'afternoon', 'evening', 'night'].includes(o.preset)) out.preset = o.preset as LookFile['preset'];
  if (typeof o.backdrop === 'string' && (BACKDROPS as string[]).includes(o.backdrop)) out.backdrop = o.backdrop as Backdrop;
  return out;
}
