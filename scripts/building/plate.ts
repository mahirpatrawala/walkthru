// The typical floor's plate: the flats' real footprints on both sides of one corridor, each turned (and, where its balcony would
// otherwise face its neighbour, mirrored) so its main door opens onto the corridor and its balcony faces outside. The corridor scene is
// then drawn from where the doors fell. Pure given the flats; the generator and the tests both use it.
import { overlapAreaM2 } from '../../src/core/layout-validate';
import { doorFrame, dirToLevel, mirrorDesigns, mirrorProperty, roomsOnLevel, toLevel } from '../../src/building/geom';
import type { Placement } from '../../src/building/types';
import type { PropertyFile, RoomTag, Vec2 } from '../../src/types';
import type { FlatDesign } from './flats';

export const CORRIDOR_M = 1.8;
/** Between a flat's wall and the corridor's: two walls and a little more, so the two scenes' walls do not touch. */
export const WALL_GAP_M = 0.3;
/** Between two flats on one side (their party wall). */
export const PARTY_GAP_M = 0.3;

/** `mirror`: the builder draws this flat as the mirror image of its design (the plan asks for it, whatever the balcony does) */
export interface PlateInput { key: string; side: 'E' | 'W'; design: FlatDesign; mirror?: boolean }

export interface PlacedFlat {
  key: string;
  side: 'E' | 'W';
  design: FlatDesign;
  mirrored: boolean;
  placement: Placement;
  /** the scene used: the design itself, or its mirror image */
  property: PropertyFile;
  designs: unknown | null;
  /** the main door on the plan */
  door: { centre: Vec2; out: Vec2; hinge: Vec2 | null; widthM: number; headM: number };
  /** the flat's rooms on the plan */
  rooms: RoomTag[];
}

export interface Plate {
  corridor: { x0: number; x1: number; z0: number; z1: number };
  /** the lift lobby's room on the plan sits below the corridor: its top edge */
  lobbyTopZ: number;
  flats: PlacedFlat[];
}

const TRANSFORMS: { mirror: boolean; rot: 0 | 90 | 180 | 270 }[] = [
  { mirror: false, rot: 0 }, { mirror: false, rot: 90 }, { mirror: false, rot: 180 }, { mirror: false, rot: 270 },
  { mirror: true, rot: 0 }, { mirror: true, rot: 90 }, { mirror: true, rot: 180 }, { mirror: true, rot: 270 },
];

export function mirrorId(sceneId: string): string { return `${sceneId}-m`; }

/** The mirror image of a flat design as a scene (and its designs.json). */
export function mirrored(d: FlatDesign): { property: PropertyFile; designs: unknown | null } {
  const p = mirrorProperty(d.property, mirrorId(d.property.id), d.property.title, d.property.subtitle);
  return { property: p, designs: d.designs ? mirrorDesigns(d.designs) : null };
}

interface Box { x0: number; x1: number; z0: number; z1: number }
function bboxOf(rooms: RoomTag[]): Box {
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x)), zs = rooms.flatMap((r) => r.polygon.map((p) => p.z));
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
const shift = (r: RoomTag, dx: number, dz: number): RoomTag => ({ ...r, polygon: r.polygon.map((p) => ({ x: p.x + dx, z: p.z + dz })) });

/** Every way of turning one flat so its door faces the corridor on `side`, given where the stack on that side has reached. */
function candidates(inp: PlateInput, cursorZ: number): PlacedFlat[] {
  const want: Vec2 = inp.side === 'E' ? { x: -1, z: 0 } : { x: 1, z: 0 };
  const out: PlacedFlat[] = [];
  for (const t of TRANSFORMS) {
    if (inp.mirror !== undefined && inp.mirror !== t.mirror) continue;
    const m = t.mirror ? mirrored(inp.design) : { property: inp.design.property, designs: inp.design.designs as unknown | null };
    const pl0: Placement = { x: 0, z: 0, rotDeg: t.rot };
    const f = doorFrame(m.property.layout, inp.design.mainOpening);
    if (!f) throw new Error(`${inp.key}: main door "${inp.design.mainOpening}" not found`);
    const o = dirToLevel(f.out, pl0);
    if (o.x * want.x + o.z * want.z < 0.99) continue;
    const rooms0 = roomsOnLevel(m.property.layout, pl0);
    const body = bboxOf(rooms0.filter((r) => r.roomType !== 'balcony'));
    const c0 = toLevel(f.centre, pl0);
    // the door's wall is the flat's face towards the corridor
    const faceX = inp.side === 'E' ? body.x0 : body.x1;
    if (Math.abs(c0.x - faceX) > 0.06) continue;
    const tx = (inp.side === 'E' ? CORRIDOR_M / 2 + WALL_GAP_M : -CORRIDOR_M / 2 - WALL_GAP_M) - faceX;
    const tz = cursorZ - body.z0;
    const placement: Placement = { x: tx, z: tz, rotDeg: t.rot };
    out.push({
      key: inp.key, side: inp.side, design: inp.design, mirrored: t.mirror, placement, property: m.property, designs: m.designs,
      door: { centre: toLevel(f.centre, placement), out: o, hinge: f.hinge ? toLevel(f.hinge, placement) : null, widthM: f.widthM, headM: f.headM },
      rooms: rooms0.map((r) => shift(r, tx, tz)),
    });
  }
  return out;
}

const clashes = (a: PlacedFlat, placed: PlacedFlat[]): boolean => placed.some((o) => a.rooms.some((ra) => o.rooms.some((rb) => overlapAreaM2(ra.polygon, rb.polygon) > 0.02)));
/** Two main doors facing each other across the corridor (closer than this along it) are not drawn: a flat is turned or mirrored to stagger them. */
export const DOOR_STAGGER_M = 2.2;
const doorsFace = (a: PlacedFlat, placed: PlacedFlat[]): boolean => placed.some((o) => o.side !== a.side && Math.abs(o.door.centre.z - a.door.centre.z) < DOOR_STAGGER_M);
const bodyEndZ = (f: PlacedFlat): number => Math.max(...f.rooms.filter((r) => r.roomType !== 'balcony').flatMap((r) => r.polygon.map((p) => p.z)));

export function composeTypicalFloor(input: PlateInput[]): Plate {
  // depth first, non-mirrored turns tried before mirrored ones: the first way that puts every door on the corridor with no balcony on a neighbour
  const solve = (i: number, placed: PlacedFlat[], cursor: Record<'E' | 'W', number>): PlacedFlat[] | null => {
    if (i === input.length) return placed;
    const inp = input[i];
    for (const c of candidates(inp, cursor[inp.side])) {
      if (clashes(c, placed) || doorsFace(c, placed)) continue;
      const next = solve(i + 1, [...placed, c], { ...cursor, [inp.side]: bodyEndZ(c) + PARTY_GAP_M });
      if (next) return next;
    }
    return null;
  };
  const placed = solve(0, [], { E: 0, W: 0 });
  if (!placed) throw new Error('no way of turning the flats puts every door on the corridor with every balcony clear of its neighbours');
  const bottom = Math.max(...placed.flatMap((f) => f.rooms.map((r) => Math.max(...r.polygon.map((p) => p.z)))));
  const z1 = Math.max(...placed.map(bodyEndZ));
  return { corridor: { x0: -CORRIDOR_M / 2, x1: CORRIDOR_M / 2, z0: 0, z1 }, lobbyTopZ: Math.max(bottom, z1) + 0.3, flats: placed };
}
