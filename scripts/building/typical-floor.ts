// The typical floor's corridor scene, drawn from where the flats' doors fell (plate.ts): one straight corridor 1.8 m wide, a bay of corridor out to
// each recessed door, the flat across the north end entered at the corridor's end, and the lift lobby at the south end. The rooms are authored with
// the same typed-spec machinery as the flats (flat-spec.ts).
import { buildLayout, printedPlan } from './flat-spec';
import type { OpeningSpec, RoomSpec, Side } from './flat-spec';
import { finishes } from './scene-kit';
import type { Layout, PropertyFile, Vec2 } from '../../src/types';
import type { Plate, PlacedFlat } from './plate';

export const LIFT_DOOR_M = 0.9;
const UPDATED_AT = '2026-11-16T00:00:00.000Z';
const SAMPLE_SUBTITLE = 'Sample building · made-up layout for demonstration';
const STONE = { floorColor: '#BDB5A8', tile: { wM: 0.8, lM: 0.8 }, groutColor: '#A29A8D', wallColor: '#EEE8DC', ceilingColor: '#F7F4EE' } as const;

export interface TypicalCorridor {
  property: PropertyFile;
  /** the plate flat key -> the corridor scene's opening for its main door */
  flatDoor: Record<string, string>;
  liftA: string; liftB: string; stairs: string;
  lobby: { x0: number; z0: number; x1: number; z1: number };
}

const rect = (id: string, label: string, x0: number, z0: number, x1: number, z1: number): RoomSpec => ({
  id, label, type: 'other', finish: 'dry',
  // a corridor is not a drawn room: its printed size is its own (the check of flat-spec.ts is not run on it)
  parts: [{ x: x0, z: z0, w: x1 - x0, d: z1 - z0, printed: printedPlan(x1 - x0, z1 - z0) }],
});

/** The compass side of the hinge post of a door the flat hangs on `hinge`, for a door in a wall running along z (E or W) or along x (N or S). */
const hingeSide = (wall: Side, centre: Vec2, hinge: Vec2 | null): Side | undefined => {
  if (!hinge) return undefined;
  if (wall === 'E' || wall === 'W') return hinge.z < centre.z ? 'N' : 'S';
  return hinge.x < centre.x ? 'W' : 'E';
};

export function corridorScene(plate: Plate, id: string): TypicalCorridor {
  const zc = plate.lobbyTopZ - 0.12;
  const x0 = plate.corridor.x0, x1 = plate.corridor.x1;
  const rooms: RoomSpec[] = [];
  const openings: OpeningSpec[] = [];
  const bayOf: PlacedFlat[] = plate.flats.filter((f) => f.bay);
  // the corridor and its bays are ONE room (a bay is where the corridor reaches a recessed door), so a walker landing at a door is in the corridor
  const stem = rect('corridor', 'Corridor', x0, 0, x1, zc);
  stem.parts.push(...bayOf.map((f) => { const b = f.bay!; return { x: b.x0, z: b.z0, w: b.x1 - b.x0, d: b.z1 - b.z0, printed: printedPlan(b.x1 - b.x0, b.z1 - b.z0) }; }));
  rooms.push(stem);
  const lobby = { x0: -3, z0: plate.lobbyTopZ, x1: 3, z1: plate.lobbyTopZ + 4.2 };
  rooms.push(rect('lift-lobby', 'Lift lobby', lobby.x0, lobby.z0, lobby.x1, lobby.z1));

  const flatDoor: Record<string, string> = {};
  const count: Record<'E' | 'W', number> = { E: 0, W: 0 };
  for (const f of plate.flats) {
    const slot = f.side === 'N' ? 'n' : f.side === 'E' ? ['ne', 'se'][count.E++] : ['nw', 'sw'][count.W++];
    const oid = `door-${slot}`;
    flatDoor[f.key] = oid;
    // the door sits in the wall that faces the flat: the bay's end wall, the corridor's side wall, or the corridor's north end
    const wall: Side = f.side === 'N' ? 'N' : f.side;
    const room = 'corridor';
    const at = f.side === 'N' ? f.door.centre.x : f.door.centre.z;
    openings.push({ id: oid, room, wall, at, widthM: f.door.widthM, headM: f.door.headM, kind: 'door', hinge: hingeSide(wall, f.door.centre, f.door.hinge), swing: 'out' });
  }
  const lobbyTop = lobby.z0;
  openings.push({ id: 'opening-corridor', room: 'lift-lobby', wall: 'N', at: 0, widthM: 1.8, kind: 'opening' });
  openings.push({ id: 'lift-a', room: 'lift-lobby', wall: 'S', at: -0.9, widthM: LIFT_DOOR_M, kind: 'door', hinge: 'E', swing: 'out' });
  openings.push({ id: 'lift-b', room: 'lift-lobby', wall: 'S', at: 0.9, widthM: LIFT_DOOR_M, kind: 'door', hinge: 'E', swing: 'out' });
  openings.push({ id: 'door-stairs', room: 'lift-lobby', wall: 'E', at: lobbyTop + 1.1, widthM: 1.0, kind: 'door', hinge: 'N', swing: 'out' });
  openings.push({ id: 'window-lobby', room: 'lift-lobby', wall: 'W', at: lobbyTop + 2.1, widthM: 1.6, kind: 'window' });
  // a window at the corridor's north end only when no flat is entered there
  if (!plate.flats.some((f) => f.side === 'N')) openings.push({ id: 'window-end', room: 'corridor', wall: 'N', at: 0, widthM: 1.2, kind: 'window' });

  const built = buildLayout({ rooms, openings });
  if (built.errors.length > 0) throw new Error(`the typical floor's corridor scene: ${built.errors.join('; ')}`);
  const layout: Layout = {
    wallHeightM: 2.85, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: built.rooms, openings: built.openings,
    finishes: finishes({ ...STONE }), scaleSource: 'typed-sizes',
  };
  const property: PropertyFile = {
    version: 1, id, title: 'Corridor and lift lobby', subtitle: SAMPLE_SUBTITLE, layout, furniture: [],
    spawn: { x: 0, z: zc - 1, yawDeg: 180 }, unlisted: true, spaceKind: 'corridor', updatedAt: UPDATED_AT,
  };
  return { property, flatDoor, liftA: 'lift-a', liftB: 'lift-b', stairs: 'door-stairs', lobby };
}
