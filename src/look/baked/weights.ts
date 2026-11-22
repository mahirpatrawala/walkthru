// SPEC 16.14: what each baked component is multiplied by for the light in force. Pure: the compositor (lightmap) and the probe volume
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

/**
 * White balance of the baked light (SPEC 16.14 "White balance"). A baked room must read in the same tones as the same room lit live:
 * the pack's warm white stays warm white. Three things used to turn it cream, and each is now a number here:
 *   1. the sky component was tinted 55 % towards a warm daylight (written when the sky half of the ambient was blue; it is near neutral now).
 *      It is now the colour the live look gives a wall: the hemisphere's sky and ground halves, half and half, warmed only `SKY_WARMTH`.
 *   2. the bounce carries the colour of what it bounced off (an oak floor makes every wall and the ceiling orange). `BOUNCE_SATURATION`
 *      of that colour is kept: a hint of the floor in the light, as a camera's white balance leaves it.
 *   3. the sun's own tint, right on its patch, flooded the room through the bounce. The patch keeps the sun's colour; light that is
 *      only bounce (`SUN_DIRECT_E` and below, in irradiance per unit of sun) keeps `SUN_BOUNCE_TINT` of it.
 */
export const DAYLIGHT_WARM: Rgb = [1.25, 1.0, 0.75]; // mean 1, so it changes the colour and not the brightness
export const SKY_WARMTH = 0;
export const BOUNCE_SATURATION = 0.2;
export const SUN_BOUNCE_TINT = 0.1;
/** irradiance (per unit of sun) below the first number is bounce alone, above the second it is the sun's own patch */
export const SUN_DIRECT_E: [number, number] = [0.05, 0.3];
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
export const luma = (c: Rgb): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
/** the colour with only `keep` of its saturation, at the same luminance */
export const desaturate = (c: Rgb, keep: number): Rgb => { const l = luma(c); return [l + (c[0] - l) * keep, l + (c[1] - l) * keep, l + (c[2] - l) * keep]; };
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

/**
 * SPEC 16.26: by day the recessed downlights are shown lit (their glass glows, `grade.interior.glow`), so their light is in the room too: this share of the
 * lamps component, a soft scallop up the wall beside each downlight and a little warmth on the floor under it, never enough to change the day's exposure.
 */
export const DAY_LAMP_SHARE = 0.22;
export const lampLevel = (i: { tube: number; glow?: number }): number => Math.max(i.tube, (i.glow ?? 0) * DAY_LAMP_SHARE);

export interface WeightInput {
  grade: Pick<Grade, 'hour' | 'sunColour' | 'sunIntensity' | 'hemiSky' | 'hemiGround' | 'hemiIntensity' | 'interior' | 'night'>;
  /** tier multipliers of look.ts, so a tier that is meant to be brighter stays so */
  skyScale: number;
  sunScale: number;
  /** sun hours that were baked, in order sun0, sun1, sun2 (absent = not baked) */
  sunHours: (number | null)[];
  /** extra ambient from the sky so rooms read airy (16.14 "fill") */
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
    sky: scale(warmed(mixRgb(g.hemiSky, g.hemiGround, 0.5), SKY_WARMTH), g.hemiIntensity * i.skyScale * i.skyBoost),
    sun0: sunW(0), sun1: sunW(1), sun2: sunW(2),
    lamps: [LAMP_TINT[0] * LAMP_STRENGTH * lampLevel(g.interior), LAMP_TINT[1] * LAMP_STRENGTH * lampLevel(g.interior), LAMP_TINT[2] * LAMP_STRENGTH * lampLevel(g.interior)],
    cove: [COVE_TINT[0] * COVE_STRENGTH * g.interior.cove, COVE_TINT[1] * COVE_STRENGTH * g.interior.cove, COVE_TINT[2] * COVE_STRENGTH * g.interior.cove],
    ao: ZERO,
  };
}

/**
 * The same weights for light that reached a surface by bounce alone: the suns keep `SUN_BOUNCE_TINT` of their tint (same luminance),
 * everything else is unchanged. The compositor blends from these to `componentWeights` by how much direct sun a texel has; the probes
 * (which hold the room's bounce, never the direct sun) use these alone.
 */
export function bounceWeights(w: Weights): Weights {
  return { ...w, sun0: desaturate(w.sun0, SUN_BOUNCE_TINT), sun1: desaturate(w.sun1, SUN_BOUNCE_TINT), sun2: desaturate(w.sun2, SUN_BOUNCE_TINT) };
}

/**
 * The room's ambient level: this fraction of the hemisphere light reaches every surface, shaded by the static AO (E units, rgb). It is the
 * larger part of a baked room's light by day, so a room far from its window is as bright as the live look makes it and the sky component
 * (`SKY_BOOST` in runtime.ts) adds the gradient towards the window on top. (It was 0.6 with a sky gain of 1.3: rooms with a small window,
 * and every ceiling, came out a fifth to a third darker than the same room lit live. 1.45 from 16.23 to 16.26; SPEC 16.27 brought it to 0.7 and the sky gain
 * up to 1.5, so the light that falls off away from the windows is the larger share and the room is not one even wash. With a low fill the AO's share must
 * stay modest: at 0.9 its denoising blotches printed on plain walls.)
 */
export const FILL_FRACTION = 0.7;
/** how much of the static AO shades the ambient level: at 1 a corner 1.1 m from everything went grey, 0.6 keeps it a soft shade (16.23). Since 16.27 the
 *  fill is the smaller share and the sky component (whose corners are shaded by the bake itself) the larger, so corners darken without more of the AO;
 *  0.65, and never past 0.8: the AO picture is the noisiest one, and its blotches show on a plain wall */
export const AO_SHADE = 0.65;
/** SPEC 16.27: the static AO is never taken below this before it shades the fill. A real corner at 1.1 m never reaches it; a texel the bake shut (the end face
 *  of a thin column, a face inside another) does, and printed as black blotches once the fill came down. Shut texels now keep 1 - 0.65 x 0.7 = 0.55 of the fill (0.4 before) */
export const AO_FLOOR = 0.3;
export function ambientFill(g: Pick<Grade, 'hemiSky' | 'hemiGround' | 'hemiIntensity'>, fraction = FILL_FRACTION): Rgb {
  const k = g.hemiIntensity * fraction;
  const mid: Rgb = [0.5 * (g.hemiSky[0] + g.hemiGround[0]), 0.5 * (g.hemiSky[1] + g.hemiGround[1]), 0.5 * (g.hemiSky[2] + g.hemiGround[2])];
  return scale(warmed(mid, SKY_WARMTH), k);
}
