// Stage 2 (SPEC 16.17): the Sample Tower's gym, community hall and lobby, furnished from the shared-space catalogue with `sampleLayout`, each in its own
// scene's real bounds and with its own doors kept clear. Kept apart from spaces.ts and make-sample-building.ts so the other stages' edits to those files merge.
// Pure: a bare scene in, a furnished copy out; the same scene always gives the same pieces.
import type { Opening, PropertyFile, Vec2 } from '../../src/types';
import { clearRoutes } from '../../src/building/clear-routes';
import { sampleLayout } from '../../src/core/space-samples';
import type { RoomBounds, SampleAnchor, SampleDoor, SampleKind, Wall } from '../../src/core/space-samples';

const bboxOf = (p: PropertyFile, roomId: string): RoomBounds => {
  const r = p.layout.rooms.find((x) => x.id === roomId);
  if (!r) throw new Error(`${p.id} has no room "${roomId}"`);
  const xs = r.polygon.map((q) => q.x), zs = r.polygon.map((q) => q.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};

/** where an opening's middle is, in the scene frame */
function openingPoint(p: PropertyFile, o: Opening): Vec2 {
  const room = p.layout.rooms.find((r) => r.id === o.roomId)!;
  const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: a.x + ((b.x - a.x) / len) * o.centreM, z: a.z + ((b.z - a.z) / len) * o.centreM };
}

/** the doors and open passages (not windows) that lie on the walls of `bounds`, in `sampleLayout`'s terms (the wall, metres along it from its low end, width) */
export function doorsOn(p: PropertyFile, bounds: RoomBounds): SampleDoor[] {
  const out: SampleDoor[] = [];
  for (const o of p.layout.openings) {
    if (o.type === 'window') continue;
    const c = openingPoint(p, o);
    const tol = 0.4;
    const cand = ([
      { wall: 'north', d: Math.abs(c.z - bounds.z0), at: c.x - bounds.x0 }, { wall: 'south', d: Math.abs(c.z - bounds.z1), at: c.x - bounds.x0 },
      { wall: 'west', d: Math.abs(c.x - bounds.x0), at: c.z - bounds.z0 }, { wall: 'east', d: Math.abs(c.x - bounds.x1), at: c.z - bounds.z0 },
    ] as Array<{ wall: Wall; d: number; at: number }>).filter((w) => w.d <= tol && w.at > 0 && w.at < (w.wall === 'north' || w.wall === 'south' ? bounds.x1 - bounds.x0 : bounds.z1 - bounds.z0));
    cand.sort((a, b) => a.d - b.d);
    if (cand[0]) out.push({ wall: cand[0].wall, atM: Math.round(cand[0].at * 1000) / 1000, widthM: o.widthM });
  }
  return out;
}

/** a bare scene, furnished with the sample layout of `kind` in the room `roomId` (the scene keeps its id unless `id` is given) */
export function furnishScene(bare: PropertyFile, kind: SampleKind, roomId: string, o: { id?: string; anchors?: SampleAnchor[] } = {}): PropertyFile {
  const bounds = bboxOf(bare, roomId);
  const furniture = sampleLayout(kind, bounds, { doors: doorsOn(bare, bounds), idPrefix: `${kind}`, ...(o.anchors ? { anchors: o.anchors } : {}) });
  const all = [...bare.furniture, ...furniture];
  return { ...bare, id: o.id ?? bare.id, furniture: clearRoutes(bare.layout, all, bare.spawn).furniture };
}

/** the same scene under another id, with nothing in it (the empty tower's hall and gym) */
export const bareCopy = (bare: PropertyFile, id: string): PropertyFile => ({ ...bare, id, furniture: [] });
