// SPEC 16.13: what each baked component is multiplied by for the light in force. Pure: the compositor (lightmap) and the probe volume
// use the same numbers, so a movable piece and the wall behind it are lit by the same sun, sky and lamps.
import type { Grade, Rgb } from '../grade';
import { PRESET_HOURS } from '../grade';
import type { ComponentId } from './types';

export type Weights = Record<ComponentId, Rgb>;
const ZERO: Rgb = [0, 0, 0];
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** how brightly the room is lit by the lamps at full level, relative to the calibration of the bake (mean floor irradiance 1 = one three light unit) */
export const LAMP_STRENGTH = 1.0;
export const COVE_STRENGTH = 1.0;
/** the lamp colour: warm white of the tube and downlights */
export const LAMP_TINT: Rgb = [1.0, 0.87, 0.7];
export const COVE_TINT: Rgb = [1.0, 0.8, 0.55];

/** daylight in a room is warm: the bounce off floors and walls is not the blue of the sky. The sky component is tinted this far towards it */
export const DAYLIGHT_WARM: Rgb = [1.25, 1.0, 0.75]; // mean 1, so it changes the colour and not the brightness
export const SKY_WARMTH = 0.55;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** the colour moved towards warm daylight at the same brightness */
const warmed = (c: Rgb, t: number): Rgb => { const lum = (c[0] + c[1] + c[2]) / 3; return mixRgb(c, [DAYLIGHT_WARM[0] * lum, DAYLIGHT_WARM[1] * lum, DAYLIGHT_WARM[2] * lum], t); };

/** cross-fade of the baked suns by hour: [Morning, Afternoon, Evening] weights summing to 1 */
export function sunBlend(hour: number, hours: [number, number, number] = [PRESET_HOURS.morning, PRESET_HOURS.afternoon, PRESET_HOURS.evening]): [number, number, number] {
  const [a, b, c] = hours;
  if (hour <= a) return [1, 0, 0];
  if (hour >= c) return [0, 0, 1];
  if (hour <= b) { const t = (hour - a) / (b - a); return [1 - t, t, 0]; }
  const t = (hour - b) / (c - b);
  return [0, 1 - t, t];
}

export interface WeightInput {
  grade: Pick<Grade, 'hour' | 'sunColour' | 'sunIntensity' | 'hemiSky' | 'hemiIntensity' | 'interior' | 'night'>;
  /** tier multipliers of look.ts, so a tier that is meant to be brighter stays so */
  skyScale: number;
  sunScale: number;
  /** sun hours that were baked, in order sun0, sun1, sun2 (absent = not baked) */
  sunHours: (number | null)[];
  /** extra ambient from the sky so rooms read airy (16.13 "fill") */
  skyBoost: number;
}

export function componentWeights(i: WeightInput): Weights {
  const g = i.grade;
  const sunOn = !g.night && g.sunIntensity > 0.01;
  const blend = sunBlend(g.hour);
  const have = i.sunHours.map((h) => h !== null);
  // renormalise over the suns that exist; when the two neighbours of this hour were not baked, the nearest one that was takes it all
  let sum = 0;
  blend.forEach((b, k) => { if (have[k]) sum += b; });
  let nearest = -1;
  if (sum <= 0) {
    let best = Infinity;
    i.sunHours.forEach((h, k) => { if (h !== null && Math.abs(h - g.hour) < best) { best = Math.abs(h - g.hour); nearest = k; } });
  }
  const sunRgb = scale(g.sunColour, g.sunIntensity * i.sunScale);
  const sunW = (k: number): Rgb => (!sunOn || !have[k] ? ZERO : sum > 0 ? scale(sunRgb, blend[k] / sum) : k === nearest ? sunRgb : ZERO);
  // when only one sun was baked it stands for the whole day; when several, a missing neighbour hands its share to the nearest one
  return {
    sky: scale(warmed(g.hemiSky, SKY_WARMTH), g.hemiIntensity * i.skyScale * i.skyBoost),
    sun0: sunW(0), sun1: sunW(1), sun2: sunW(2),
    lamps: [LAMP_TINT[0] * LAMP_STRENGTH * g.interior.tube, LAMP_TINT[1] * LAMP_STRENGTH * g.interior.tube, LAMP_TINT[2] * LAMP_STRENGTH * g.interior.tube],
    cove: [COVE_TINT[0] * COVE_STRENGTH * g.interior.cove, COVE_TINT[1] * COVE_STRENGTH * g.interior.cove, COVE_TINT[2] * COVE_STRENGTH * g.interior.cove],
    ao: ZERO,
  };
}

/** a little light from everywhere, so a corridor with no window is dim and not black: a fraction of the hemisphere light (E units, rgb) */
export const FILL_FRACTION = 0.6;
export function ambientFill(g: Pick<Grade, 'hemiSky' | 'hemiGround' | 'hemiIntensity'>, fraction = FILL_FRACTION): Rgb {
  const k = g.hemiIntensity * fraction;
  const mid: Rgb = [0.5 * (g.hemiSky[0] + g.hemiGround[0]), 0.5 * (g.hemiSky[1] + g.hemiGround[1]), 0.5 * (g.hemiSky[2] + g.hemiGround[2])];
  return scale(warmed(mid, SKY_WARMTH), k);
}
