// What a unit's card says (SPEC 22.3): its type, its area with where the figure comes from, the way it faces when north is known, and where "Walk this
// flat" goes. Everything comes from the building file and the scene of its flat type; nothing is made up, and no price appears anywhere.
import { readFacing } from '../core/facing';
import { northInScene } from '../core/north';
import type { Dir8 } from '../core/north';
import type { SceneInfo } from './load';
import type { BuildingFile } from './types';
import type { Unit } from './units';
import { walkTargetOf } from './units';
import type { WalkTarget } from './units';

export interface UnitArea { /** "1,117 sq ft" or "103.76 m²" */ text: string; /** where the figure comes from, in words */ source: string }

/** The stated carpet area: the figure in the type's name ("3 BHK · 1,117 sq ft") and, for a flat the walk models, the metric figure its notes state. */
export function unitArea(b: BuildingFile, unit: Unit, target: WalkTarget | null = walkTargetOf(b, unit)): UnitArea | null {
  const type = b.flatTypes[unit.type];
  const named = type ? /([\d,]+(?:\.\d+)?)\s*sq\s*ft/i.exec(type.name) : null;
  const noted = (target?.space.notes ?? []).map((n) => /Stated RERA carpet area\s+([\d.,]+)\s*sq m\s*\(([\d.,]+)\s*sq ft\)/i.exec(n)).find((m) => m);
  if (noted) return { text: `${noted[2]} sq ft · ${noted[1]} m²`, source: b.sample ? "Stated RERA carpet area, from the published builder brochure the flat plans follow" : 'Stated RERA carpet area, as the builder gives it' };
  if (named) return { text: `${named[1]} sq ft`, source: b.sample ? 'Stated carpet area in the sample building file (from the builder brochure the plans follow)' : 'Stated carpet area, as the builder gives it' };
  return null;
}

export interface UnitFacing { door: Dir8 | null; balconies: Dir8[] }

/** Which way the unit's main door and balcony face. Null when the building has no north (then nothing is said) or the flat cannot be read. */
export async function unitFacing(b: BuildingFile, unit: Unit, load: (sceneId: string) => Promise<SceneInfo>): Promise<UnitFacing | null> {
  if (!b.north) return null;
  const target = walkTargetOf(b, unit);
  if (!target) return null;
  try {
    const scene = await load(target.space.sceneId);
    const r = readFacing(scene.property.layout, northInScene(b.north, target.space.placement.rotDeg));
    if (!r) return null;
    return { door: r.mainDoor?.facing ?? null, balconies: [...new Set(r.rooms.filter((x) => x.roomType === 'balcony' && x.facing).map((x) => x.facing as Dir8))] };
  } catch { return null; }
}
