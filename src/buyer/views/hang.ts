// What the doll house takes away so the view from above is clear, pure: the rules that say, by an object's name, tags and height, whether it is a
// ceiling slab (faded out), something that hangs from the ceiling or would stand in the way from above (hidden), or a merged mesh that
// holds ceiling parts among wall parts (its ceiling triangles are filtered out). The three side (dollhouse.ts) applies them and puts everything back.
//
// How the rest of the app names its objects (so the rules stay generic, never per scene):
//   shell      `ceiling:<roomId>` slabs
//   look kit   `kit:cove`, `kit:cove-led`, `kit:fan-light`, `kit:fan-blades`, `kit:tube-lens` (all ceiling or high-wall light parts), and
//              `kit:fixtures` / `kit:edited-fixtures`, one mesh with the switchboards (low on the wall) AND the fan body (at the ceiling) and
//              the wall tube (high): its triangles near the ceiling are the ones to drop
//   lights     `userData.walkthruLight` = 'tube' | 'cove' | 'fan' | 'lamp' ('lamp' is a standing lamp: stays)
//   signs      `door-labels` (a board over every door) and `portal-signs` (a building's door and lift signs)

export type HangVerdict = 'fade' | 'hide' | 'filter' | 'keep';

/** The top band of a wall, metres: anything in it that is a fixture (a fan body, a wall tube, a cove) is ceiling kit. */
export const CEILING_BAND_M = 0.8;
/** A piece in the furniture tree that starts this far under the ceiling or higher is hung from it (a pendant, a chandelier). */
export const HUNG_FROM_M = 0.75;

const HIDE_KIT = new Set(['kit:cove', 'kit:cove-led', 'kit:fan-light', 'kit:fan-blades', 'kit:tube-lens', 'kit:edited-fan-light', 'kit:edited-tube-lens', 'kit:downlight-lens']);
const FILTER_KIT = new Set(['kit:fixtures', 'kit:edited-fixtures']);
const HIDE_GROUPS = new Set(['door-labels', 'portal-signs']);
const HUNG_LIGHTS = new Set(['tube', 'cove', 'fan']);

export interface HangProbe {
  name: string;
  /** `userData.walkthruLight` */
  light?: string;
  /** world-space lowest point of the object, or null when not known (a group not measured) */
  minY?: number | null;
  /** the object lives under the furniture root (so the height rule may apply to it) */
  inFurniture?: boolean;
}

/** What the doll house does with an object of this name and kind. `wallH` is the layout's wall height. */
export function classifyHang(p: HangProbe, wallH: number): HangVerdict {
  if (p.name.startsWith('ceiling:')) return 'fade';
  if (HIDE_GROUPS.has(p.name)) return 'hide';
  if (HIDE_KIT.has(p.name)) return 'hide';
  if (FILTER_KIT.has(p.name)) return 'filter';
  if (p.light && HUNG_LIGHTS.has(p.light)) return 'hide';
  if (p.inFurniture && typeof p.minY === 'number' && p.minY >= wallH - HUNG_FROM_M) return 'hide';
  return 'keep';
}

/**
 * The triangles of an indexed or plain triangle list that do NOT sit in the ceiling band: a triangle goes when all three corners are at or
 * above `minY`. Returns the vertex indices to draw (a fresh index list) and how many triangles were dropped. `positions` is x, y, z, ...
 * in the mesh's own space; `yOffset` lifts it to world height (the kit's meshes sit at the origin, so it is 0 there).
 */
export function keepBelow(positions: ArrayLike<number>, index: ArrayLike<number> | null, minY: number, yOffset = 0): { index: Uint32Array; dropped: number } {
  const count = index ? index.length : Math.floor(positions.length / 3);
  const tris = Math.floor(count / 3);
  const out = new Uint32Array(tris * 3);
  let n = 0, dropped = 0;
  const vi = (k: number): number => (index ? index[k] : k);
  for (let t = 0; t < tris; t++) {
    const a = vi(t * 3), b = vi(t * 3 + 1), c = vi(t * 3 + 2);
    const ya = positions[a * 3 + 1] + yOffset, yb = positions[b * 3 + 1] + yOffset, yc = positions[c * 3 + 1] + yOffset;
    if (ya >= minY && yb >= minY && yc >= minY) { dropped++; continue; }
    out[n++] = a; out[n++] = b; out[n++] = c;
  }
  return { index: out.subarray(0, n), dropped };
}

/** The height from which a merged fixture mesh's triangles count as ceiling kit. */
export const ceilingBandStart = (wallH: number): number => wallH - CEILING_BAND_M;

/** Opacity of the ceiling while the camera flies: gone by 55% of the flight, so the room is open before the view is. */
export function ceilingOpacity(flightRaw: number): number {
  const k = Math.min(1, Math.max(0, flightRaw / 0.55));
  return 1 - k * k * (3 - 2 * k);
}
/** The other hung things go at once the flight has begun a little (they would look odd fading). Hidden above this raw progress. */
export const HIDE_FROM_RAW = 0.18;
