// SPEC 16.19 "Daylight": every window and glazed door of a home is a soft light source for the look's shell shader, so a room has a visible
// direction of light and a gradient away from its windows; a room with no window is lit by its own downlights. Pure (no three, no DOM): the sources
// come from the layout, the nearest few to the walker are chosen, and the colour and strength come from the day's grade.
//
// This is skylight, never a sun: nothing here knows a sun direction, so a flat that faces away from the sun gets no sun patch (honesty, 16.2).
import { computeEdgeFrames, computeTunnels } from '../core/layout-geom';
import { resolveDoors } from '../core/doors';
import type { Layout } from '../types';
import { planDownlights } from './baked/lights';
import type { Grade, Rgb } from './grade';

/** how many window lights and lamp pools the shader takes at once (the nearest to the walker) */
export const MAX_WINDOW_LIGHTS = 6;
export const MAX_LAMP_POOLS = 6;

export interface WindowSource {
  roomId: string;
  /** centre of the opening, world metres, on the wall's mid line */
  x: number; y: number; z: number;
  /** unit normal pointing INTO the room, on the floor plan */
  nx: number; nz: number;
  hw: number; hh: number;
}
export interface LampSource { roomId: string; x: number; y: number; z: number }

/** Every window, and every glazed (sliding) door, of every whole room. */
export function windowSources(layout: Layout): WindowSource[] {
  const partial = new Set(layout.rooms.filter((r) => r.partial).map((r) => r.id));
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const out: WindowSource[] = [];
  const glazed = new Set(resolveDoors(layout).filter((d) => d.kind === 'sliding').map((d) => d.id));
  for (const t of computeTunnels(layout)) {
    if (t.openingId === null || partial.has(t.roomId)) continue;
    const isWindow = t.type === 'window';
    if (!isWindow && !(t.type === 'door' && glazed.has(t.openingId))) continue;
    const f = frames.get(`${t.roomId}:${t.edge}`);
    if (!f) continue;
    const um = (t.u0 + t.u1) / 2;
    const sill = isWindow ? t.sillM : 0, head = t.headM;
    out.push({
      roomId: t.roomId,
      x: f.a.x + f.dir.x * um + f.out.x * (t.depth / 2), y: (sill + head) / 2, z: f.a.z + f.dir.z * um + f.out.z * (t.depth / 2),
      nx: -f.out.x, nz: -f.out.z, hw: (t.u1 - t.u0) / 2, hh: Math.max(0.1, (head - sill) / 2),
    });
  }
  return out;
}

/** The downlights of every whole room that has no window or glazed door: by day they are the light of that room. */
export function lampSources(layout: Layout, windows: readonly WindowSource[]): LampSource[] {
  const lit = new Set(windows.map((w) => w.roomId));
  return planDownlights(layout).filter((f) => !lit.has(f.roomId)).map((f) => ({ roomId: f.roomId, x: f.position[0], y: f.position[1], z: f.position[2] }));
}

/** The n sources nearest to a point on the plan (stable for ties). */
export function nearestTo<T extends { x: number; z: number }>(list: readonly T[], x: number, z: number, n: number): T[] {
  return list.map((s, i) => ({ s, i, d: (s.x - x) ** 2 + (s.z - z) ** 2 })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, n).map((e) => e.s);
}

/**
 * The colour (linear, strength folded in) of the light a window lets in. The sky half of the grade, a little cool; warmer as the day goes to
 * evening (towards the horizon colour); a window at night lets in almost nothing; a preset with no sun (true colours) lets in none.
 */
export function skylightColour(g: Grade, trueColours: boolean): Rgb {
  if (trueColours) return [0, 0, 0];
  const day = g.night ? 0.06 : 1;
  const warm = Math.min(1, Math.max(0, (g.sunColour[0] - g.sunColour[2]) / 0.9)); // 0 at midday, up as the sun reddens
  const mixK = 0.18 + 0.5 * warm;
  const c: Rgb = [
    g.hemiSky[0] + (g.sky.horizon[0] - g.hemiSky[0]) * mixK,
    g.hemiSky[1] + (g.sky.horizon[1] - g.hemiSky[1]) * mixK,
    g.hemiSky[2] + (g.sky.horizon[2] - g.hemiSky[2]) * mixK,
  ];
  const cool: Rgb = [0.96, 0.99, 1.05];
  const k = WINDOW_STRENGTH * day * Math.max(0.6, g.hemiIntensity);
  return [c[0] * cool[0] * k, c[1] * cool[1] * k, c[2] * cool[2] * k];
}
/** a window's light relative to the hemisphere's irradiance, before the falloff (tuned by eye on Flat 204) */
export const WINDOW_STRENGTH = 1.4;

/** The warm light of a downlight pool, linear. In a room with no window it is on all day. */
export function lampColour(g: Grade, trueColours: boolean): Rgb {
  if (trueColours) return [0, 0, 0];
  const k = LAMP_STRENGTH * (g.night ? 1.3 : 1);
  return [1.0 * k, 0.86 * k, 0.66 * k];
}
export const LAMP_STRENGTH = 2.1;
