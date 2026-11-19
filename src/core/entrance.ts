// The main entrance of a layout: the widest door whose far side is outside every room. Pure.
import { pointInPolygon } from './geometry';
import { computeEdgeFrames } from './layout-geom';
import type { Layout, Vec2 } from '../types';

export interface Entrance {
  openingId: string;
  /** unit, out of the flat, plan coordinates */
  out: Vec2;
  /** the middle of the doorway on the wall's inside face */
  at: Vec2;
  widthM: number;
}

/** Null when no door opens to the outside. A door onto a balcony of the same space is not the entrance. */
export function mainEntrance(layout: Layout): Entrance | null {
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  let best: Entrance | null = null;
  for (const o of layout.openings) {
    if (o.type !== 'door') continue;
    const f = frames.get(`${o.roomId}:${o.edge}`);
    if (!f || f.kind === 'none') continue;
    const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    const beyond = { x: at.x + f.out.x * (f.thickness + 0.45), z: at.z + f.out.z * (f.thickness + 0.45) };
    if (layout.rooms.some((r) => pointInPolygon(beyond, r.polygon))) continue;
    if (!best || o.widthM > best.widthM) best = { openingId: o.id, out: { x: f.out.x, z: f.out.z }, at, widthM: o.widthM };
  }
  return best;
}
