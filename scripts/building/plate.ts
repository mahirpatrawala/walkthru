// The typical floor's plate: the flats' real footprints on both sides of one corridor (and, where a flat asks for it, across its north end), each
// turned (and, only if it must be, mirrored) so its main door opens onto the corridor and its balcony faces outside. A flat whose entrance sits in a
// recess of its own outline (a block of rooms standing out beside the door) gets a short bay of corridor out to the door. The corridor scene is then
// drawn from where the doors fell (typical-floor.ts). Pure given the flats; the generator and the tests both use it.
import { overlapAreaM2 } from '../../src/core/layout-validate';
import { doorFrame, dirToLevel, mirrorDesigns, mirrorProperty, roomsOnLevel, toLevel } from '../../src/building/geom';
import { computeEdgeFrames } from '../../src/core/layout-geom';
import { pointInPolygon } from '../../src/core/geometry';
import type { Placement } from '../../src/building/types';
import type { PropertyFile, RoomTag, Vec2 } from '../../src/types';
import type { FlatDesign } from './flats';

export const CORRIDOR_M = 1.8;
/** Between a flat's wall and the corridor's: two walls and a little more, so the two scenes' walls do not touch. */
export const WALL_GAP_M = 0.3;
/** Between two flats on one side (their party wall). */
export const PARTY_GAP_M = 0.3;
/** The width of a bay of corridor out to a recessed door: the door, and room beside it. */
export const BAY_WIDTH_M = 1.9;
/** The deepest recess a bay may reach, metres. */
export const MAX_RECESS_M = 6;
/** A door that sits this close to its flat's face needs no bay (the two walls between the doors already allow it). */
export const NO_BAY_M = 0.06;
/** How far a window or a balcony railing must see clear, metres, before it is said to look at a wall. */
export const OUTLOOK_M = 1.2;

/**
 * `side`: E or W beside the corridor, stacked from the north end; N across the corridor's north end (the corridor runs into the flat's own entrance
 * recess). `mirror`: the builder draws this flat as the mirror image of its design (the plan asks for it, whatever the balcony does).
 */
export interface PlateInput { key: string; side: 'E' | 'W' | 'N'; design: FlatDesign; mirror?: boolean }

export interface Box { x0: number; x1: number; z0: number; z1: number }

export interface PlacedFlat {
  key: string;
  side: 'E' | 'W' | 'N';
  design: FlatDesign;
  mirrored: boolean;
  placement: Placement;
  /** the scene used: the design itself, or its mirror image */
  property: PropertyFile;
  designs: unknown | null;
  /** the main door on the plan */
  door: { centre: Vec2; out: Vec2; hinge: Vec2 | null; widthM: number; headM: number };
  /** the bay of corridor out to a recessed door, on the plan, or null when the door is on the flat's face */
  bay: Box | null;
  /** how deep the door sits behind the flat's face, metres */
  recessM: number;
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

function bboxOf(rooms: RoomTag[]): Box {
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x)), zs = rooms.flatMap((r) => r.polygon.map((p) => p.z));
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
const shift = (r: RoomTag, dx: number, dz: number): RoomTag => ({ ...r, polygon: r.polygon.map((p) => ({ x: p.x + dx, z: p.z + dz })) });
const shiftBox = (b: Box, dx: number, dz: number): Box => ({ x0: b.x0 + dx, x1: b.x1 + dx, z0: b.z0 + dz, z1: b.z1 + dz });
const boxPoly = (b: Box): Vec2[] => [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];

/** the room of a flat that counts as its body: everything but balconies and decks */
const isBody = (r: RoomTag): boolean => r.roomType !== 'balcony';

/** Every way of turning one flat so its door faces the corridor on its side, given where the stack on that side has reached. */
function candidates(inp: PlateInput, cursorZ: number): PlacedFlat[] {
  const want: Vec2 = inp.side === 'E' ? { x: -1, z: 0 } : inp.side === 'W' ? { x: 1, z: 0 } : { x: 0, z: 1 };
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
    const body = bboxOf(rooms0.filter(isBody));
    const c0 = toLevel(f.centre, pl0);
    let recess: number;
    let tx: number, tz: number;
    if (inp.side === 'N') {
      // the door's plane is the flat's front wall; the body lies north of it, and anything that stands out beside the door runs south of it
      recess = body.z1 - c0.z;
      tx = -c0.x;
      tz = -WALL_GAP_M - c0.z;
    } else {
      // the door's wall is the flat's face towards the corridor, or a recess behind it
      const faceX = inp.side === 'E' ? body.x0 : body.x1;
      recess = Math.abs(c0.x - faceX);
      tx = (inp.side === 'E' ? CORRIDOR_M / 2 + WALL_GAP_M : -CORRIDOR_M / 2 - WALL_GAP_M) - faceX;
      tz = 0; // set below, once the bay's reach along the corridor is known
    }
    if (recess < -0.06 || recess > MAX_RECESS_M) continue;
    const bayHalf = BAY_WIDTH_M / 2;
    const rel = (z: number): number => z;
    let bay: Box | null = null;
    let zLo = body.z0;
    if (inp.side !== 'N' && recess > NO_BAY_M) {
      // from the corridor's wall out to the door's plane (less the two walls between the doors)
      const doorX = c0.x + tx; // after tx
      bay = inp.side === 'E'
        ? { x0: CORRIDOR_M / 2, x1: doorX - WALL_GAP_M, z0: rel(c0.z - bayHalf), z1: rel(c0.z + bayHalf) }
        : { x0: doorX + WALL_GAP_M, x1: -CORRIDOR_M / 2, z0: rel(c0.z - bayHalf), z1: rel(c0.z + bayHalf) };
      zLo = Math.min(body.z0, bay.z0);
    }
    if (inp.side !== 'N') tz = cursorZ - zLo;
    const placement: Placement = { x: tx, z: tz, rotDeg: t.rot };
    out.push({
      key: inp.key, side: inp.side, design: inp.design, mirrored: t.mirror, placement, property: m.property, designs: m.designs,
      door: { centre: toLevel(f.centre, placement), out: o, hinge: f.hinge ? toLevel(f.hinge, placement) : null, widthM: f.widthM, headM: f.headM },
      bay: bay ? shiftBox(bay, 0, tz) : null, recessM: Math.max(0, recess),
      rooms: rooms0.map((r) => shift(r, tx, tz)),
    });
  }
  return out;
}

const bodyOf = (f: PlacedFlat): RoomTag[] => f.rooms.filter(isBody);
/** a flat's rooms, its bay, nothing else */
const solids = (f: PlacedFlat): Vec2[][] => [...f.rooms.map((r) => r.polygon), ...(f.bay ? [boxPoly(f.bay)] : [])];
const clashes = (a: PlacedFlat, placed: PlacedFlat[]): boolean => placed.some((o) => solids(a).some((pa) => solids(o).some((pb) => overlapAreaM2(pa, pb) > 0.02)));
/** Two main doors facing each other across the corridor (closer than this along it) are not drawn: a flat is turned or mirrored to stagger them. */
export const DOOR_STAGGER_M = 2.2;
const doorsFace = (a: PlacedFlat, placed: PlacedFlat[]): boolean => a.side !== 'N' && placed.some((o) => o.side !== 'N' && o.side !== a.side && Math.abs(o.door.centre.z - a.door.centre.z) < DOOR_STAGGER_M);
/** the south-most reach of the flat's body and bay on one side of the corridor (beyond its walls, `west`) or both (null) */
const endZ = (f: PlacedFlat, west: boolean | null = null): number => {
  const polys = [...bodyOf(f).map((r) => r.polygon), ...(f.bay ? [boxPoly(f.bay)] : [])]
    .filter((p) => west === null || p.some((q) => (west ? q.x < -1 : q.x > 1)));
  return polys.length === 0 ? -Infinity : Math.max(...polys.flat().map((p) => p.z));
};

export function composeTypicalFloor(input: PlateInput[]): Plate {
  // depth first, non-mirrored turns tried before mirrored ones: the first way that puts every door on the corridor with no balcony on a neighbour
  const solve = (i: number, placed: PlacedFlat[], cursor: Record<'E' | 'W', number>): PlacedFlat[] | null => {
    if (i === input.length) return placed;
    const inp = input[i];
    const list = inp.side === 'N' ? candidates(inp, 0) : candidates(inp, cursor[inp.side]);
    for (const c of list) {
      if (clashes(c, placed) || doorsFace(c, placed)) continue;
      let next = cursor;
      if (c.side === 'N') next = { E: Math.max(cursor.E, endZ(c, false) + PARTY_GAP_M), W: Math.max(cursor.W, endZ(c, true) + PARTY_GAP_M) };
      else next = { ...cursor, [c.side]: endZ(c) + PARTY_GAP_M };
      const rest = solve(i + 1, [...placed, c], next);
      if (rest) return rest;
    }
    return null;
  };
  const placed = solve(0, [], { E: 0, W: 0 });
  if (!placed) throw new Error('no way of turning the flats puts every door on the corridor with every balcony clear of its neighbours');
  const sideFlats = placed.filter((f) => f.side !== 'N');
  const bottom = Math.max(...placed.flatMap((f) => f.rooms.map((r) => Math.max(...r.polygon.map((p) => p.z)))));
  const z1 = Math.max(...sideFlats.map((f) => endZ(f)), 6);
  const plate: Plate = { corridor: { x0: -CORRIDOR_M / 2, x1: CORRIDOR_M / 2, z0: 0, z1 }, lobbyTopZ: Math.max(bottom, z1) + 0.3, flats: placed };
  const bad = plateProblems(plate);
  if (bad.length > 0) throw new Error(`the typical floor has ${bad.length} problem(s):\n  ${bad.join('\n  ')}`);
  return plate;
}

// ---------------------------------------------------------------- the checks the generator and the tests share

/** Is there a room of anything else on the plan within `reach` metres straight out from `p` along `n`? (its own flat's rooms do not count) */
function seesWall(p: Vec2, n: Vec2, reach: number, others: Vec2[][]): boolean {
  for (let d = 0.05; d <= reach + 1e-9; d += 0.1) {
    const q = { x: p.x + n.x * d, z: p.z + n.z * d };
    if (others.some((poly) => pointInPolygon(q, poly))) return true;
  }
  return false;
}

/**
 * What would make the floor wrong: a main door not on the corridor (or its bay), two flats overlapping, a window that looks at a neighbour's wall or
 * the corridor's, a balcony railing that faces a neighbour.
 */
export function plateProblems(plate: Plate): string[] {
  const bad: string[] = [];
  const corridorPoly = boxPoly({ x0: plate.corridor.x0, x1: plate.corridor.x1, z0: plate.corridor.z0, z1: plate.corridor.z1 });
  const lobbyPoly = boxPoly({ x0: -3, x1: 3, z0: plate.lobbyTopZ, z1: plate.lobbyTopZ + 4.2 });
  for (const a of plate.flats) {
    for (const b of plate.flats) if (a.key < b.key && solids(a).some((pa) => solids(b).some((pb) => overlapAreaM2(pa, pb) > 0.02))) bad.push(`flats ${a.key} and ${b.key} overlap`);
    if (solids(a).some((p) => overlapAreaM2(p, corridorPoly) > 0.02)) bad.push(`flat ${a.key} runs into the corridor`);
    if (solids(a).some((p) => overlapAreaM2(p, lobbyPoly) > 0.02)) bad.push(`flat ${a.key} runs into the lift lobby`);
    // the main door: out of the flat towards the corridor (or its bay)
    const target = a.side === 'E' ? { x: -1, z: 0 } : a.side === 'W' ? { x: 1, z: 0 } : { x: 0, z: 1 };
    if (a.door.out.x * target.x + a.door.out.z * target.z < 0.99) bad.push(`flat ${a.key}: the main door does not face the corridor`);
    // looks: windows and railings of this flat see clear of every other flat, the corridor, its bays and the lobby, unless it is the flat's own wall
    const others: Vec2[][] = [corridorPoly, lobbyPoly];
    for (const o of plate.flats) if (o !== a) others.push(...solids(o));
    const frames = computeEdgeFrames({ ...a.property.layout, rooms: a.property.layout.rooms });
    const toPlate = (p: Vec2): Vec2 => toLevel(p, a.placement);
    const dirPlate = (p: Vec2): Vec2 => dirToLevel(p, a.placement);
    const sees = (roomId: string, edge: number, centreM: number, what: string): void => {
      const fr = frames.find((q) => q.roomId === roomId && q.edge === edge);
      if (!fr) return;
      const c = toPlate({ x: fr.a.x + fr.dir.x * centreM, z: fr.a.z + fr.dir.z * centreM });
      const n = dirPlate(fr.out);
      if (seesWall(c, n, OUTLOOK_M, others)) bad.push(`flat ${a.key}: ${what} looks at a wall within ${OUTLOOK_M} m`);
    };
    for (const o of a.property.layout.openings) if (o.type === 'window') sees(o.roomId, o.edge, o.centreM, `window ${o.id}`);
    for (const r of a.property.layout.rooms) {
      if (r.roomType !== 'balcony') continue;
      r.edges.forEach((k, i) => { if (k === 'railing') { const fr = frames.find((q) => q.roomId === r.id && q.edge === i); if (fr) sees(r.id, i, fr.length / 2, `the railing of ${r.label}`); } });
    }
  }
  return bad;
}
