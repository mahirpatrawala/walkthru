// How the look's interior-tuned light is brought outdoors (SPEC 19.1). The presets (src/look/grade.ts) were set by looking at rooms with a
// sun patch through a window; in the open the same sun lights everything, so the exposure comes down a little, and a tier with no shadow
// map still lets the sun light the faces it hits (indoors it turns it down so a sun patch does not light the whole floor). Pure.
import type { Grade } from '../look/grade';

/** the exposure multiplier outdoors, by how bright the day is: full sun is held down, dusk and night are not */
export function outdoorExposure(g: Pick<Grade, 'sunIntensity' | 'night'>): number {
  if (g.night) return 1;
  const sun = Math.min(1, g.sunIntensity / 5.9);
  return 1 - 0.3 * sun;
}

/** the low tier has no sun shadow, so indoors its sun is turned right down (0.1); outdoors it needs most of its strength to read as sunlight at all */
export function outdoorSunScale(tierScale: number): number { return Math.max(tierScale, 0.8); }
