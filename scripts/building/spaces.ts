// The sample tower's own spaces, authored as ordinary scenes: the typical floor's corridor and lift lobby (drawn from where the flats'
// doors fell), the ground lobby, and the clubhouse level (foyer, hall, gym, pool, garden). Sizes are ordinary Indian apartment sizes:
// corridor 1.8 m, lift car 1.1 x 1.4 m with a 0.9 m door, main doors 1.0 m. The pool and the garden are plain rooms until stage 3.
import { catalogItem } from '../../src/core/catalog';
import type { DoorLeaf, FurnitureItem, Opening, PropertyFile, RoomTag } from '../../src/types';
import { finishes, openingAt, rectRoom, sceneFile, windowAt } from './scene-kit';
import type { Rect, Side } from './scene-kit';
import type { Plate } from './plate';

export const UPDATED_AT = '2026-11-16T00:00:00.000Z';
export const SAMPLE_SUBTITLE = 'Sample building · made-up layout for demonstration';
export const LIFT_DOOR_M = 0.9;
export const LIFT_CAR = { widthM: 1.1, depthM: 1.4, doorM: LIFT_DOOR_M };
export const MAIN_DOOR_M = 1.0;
const OUT: DoorLeaf = { hinge: 'start', swing: 'out', kind: 'hinged' };

/** Which end of the wall (smaller or larger plan coordinate) the edge's `start` is, for each side: N and E run towards larger, S and W towards smaller. */
const startIsLow: Record<Side, boolean> = { N: true, E: true, S: false, W: false };
/** The leaf field for a hinge post at the `low` or `high` end of the wall's plan coordinate. */
export function hingeEnd(side: Side, phys: 'low' | 'high'): 'start' | 'end' {
  return (phys === 'low') === startIsLow[side] ? 'start' : 'end';
}
const other = (s: Side): Side => ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[s];
export { other as oppositeSide };

/** The two sides of one doorway between two scenes drawn in the same plan frame: the leaf opens into B, hinged on the same post. */
export function doorPair(a: { room: RoomTag; side: Side; at: number; id: string }, b: { room: RoomTag; id: string }, width: number, phys: 'low' | 'high' = 'low'): { a: Opening; b: Opening } {
  const bSide = other(a.side);
  return {
    a: openingAt(a.room, a.side, a.at, { id: a.id, widthM: width, leaf: { hinge: hingeEnd(a.side, phys), swing: 'out', kind: 'hinged' } }),
    b: openingAt(b.room, bSide, a.at, { id: b.id, widthM: width, leaf: { hinge: hingeEnd(bSide, phys), swing: 'in', kind: 'hinged' } }),
  };
}

function piece(id: string, catalogId: string, cx: number, cz: number, yawDeg: number): FurnitureItem {
  const s = catalogItem(catalogId);
  return {
    id, source: 'virtual', kind: s.kind, catalogId, label: s.name, box: { cx, cz, w: s.footprint.w, d: s.footprint.d, yawDeg },
    heightM: s.heightM, surfaceHeightM: s.surfaceHeightM,
  };
}
function desk(id: string, label: string, cx: number, cz: number, w: number, d: number, yawDeg: number): FurnitureItem {
  return { id, source: 'real', kind: 'counter', label, box: { cx, cz, w, d, yawDeg }, heightM: 1.05, surfaceHeightM: 1.05 };
}

const STONE = { floorColor: '#BDB5A8', tile: { wM: 0.8, lM: 0.8 }, groutColor: '#A29A8D', wallColor: '#EEE8DC', ceilingColor: '#F7F4EE' } as const;
const WARM = { floorColor: '#C9B79C', tile: { wM: 0.8, lM: 0.8 }, groutColor: '#B3A185', wallColor: '#EFE7D8', ceilingColor: '#F7F4EE' } as const;

// ---------------------------------------------------------------- the typical floor

export interface CorridorOut {
  property: PropertyFile;
  /** the plate flat key -> the corridor's opening for its main door */
  flatDoor: Record<string, string>;
  liftA: string; liftB: string; stairs: string;
  lobby: Rect;
}

/** The corridor and lift lobby of the typical floor, in the plate's frame. Doors sit where the flats' main doors fell. */
export function corridorScene(plate: Plate, id: string): CorridorOut {
  const zc = plate.lobbyTopZ - 0.12;
  const corridor = rectRoom('corridor', 'Corridor', 'other', { x0: plate.corridor.x0, z0: 0, x1: plate.corridor.x1, z1: zc });
  const lobbyRect: Rect = { x0: -3, z0: plate.lobbyTopZ, x1: 3, z1: plate.lobbyTopZ + 4.2 };
  const lobby = rectRoom('lift-lobby', 'Lift lobby', 'other', lobbyRect);
  const openings: Opening[] = [];
  const flatDoor: Record<string, string> = {};
  const count: Record<'E' | 'W', number> = { E: 0, W: 0 };
  for (const f of plate.flats) {
    const slot = `${f.side === 'E' ? ['ne', 'se'][count.E++] : ['nw', 'sw'][count.W++]}`;
    const side: Side = f.side;
    const oid = `door-${slot}`;
    flatDoor[f.key] = oid;
    // the hinge post of the flat's own door, seen from the corridor edge
    const hingeLow = f.door.hinge ? f.door.hinge.z < f.door.centre.z : true;
    const phys: 'low' | 'high' = hingeLow ? 'low' : 'high';
    openings.push(openingAt(corridor, side, f.door.centre.z, { id: oid, widthM: f.door.widthM, headM: f.door.headM, leaf: { hinge: hingeEnd(side, phys), swing: 'out', kind: 'hinged' } }));
  }
  openings.push(openingAt(lobby, 'N', 0, { id: 'opening-corridor', type: 'opening', widthM: 1.8 }));
  openings.push(openingAt(lobby, 'S', -0.9, { id: 'lift-a', widthM: LIFT_DOOR_M, leaf: OUT }));
  openings.push(openingAt(lobby, 'S', 0.9, { id: 'lift-b', widthM: LIFT_DOOR_M, leaf: OUT }));
  openings.push(openingAt(lobby, 'E', lobbyRect.z0 + 1.1, { id: 'door-stairs', widthM: 1.0, leaf: OUT }));
  openings.push(windowAt(corridor, 'N', 0, 'window-end', 1.2));
  openings.push(windowAt(lobby, 'W', lobbyRect.z0 + 2.1, 'window-lobby', 1.6));
  const property = sceneFile({
    id, title: 'Corridor and lift lobby', subtitle: SAMPLE_SUBTITLE, wallHeightM: 2.85, rooms: [corridor, lobby], openings,
    finishes: finishes({ ...STONE }), spawn: { x: 0, z: zc - 1, yawDeg: 180 }, updatedAt: UPDATED_AT,
  });
  return { property, flatDoor, liftA: 'lift-a', liftB: 'lift-b', stairs: 'door-stairs', lobby: lobbyRect };
}

// ---------------------------------------------------------------- the ground lobby

export interface LobbyOut { property: PropertyFile; street: string; clubhouse: string; liftA: string; liftB: string; stairs: string }

export function groundLobbyScene(id: string, furnished: boolean): LobbyOut {
  const entrance = rectRoom('entrance-lobby', 'Entrance lobby', 'other', { x0: 0, z0: 0, x1: 9, z1: 7 });
  const liftsRect: Rect = { x0: 9.12, z0: 0, x1: 15.12, z1: 4.2 };
  const lifts = rectRoom('lift-lobby', 'Lift lobby', 'other', liftsRect);
  const openings: Opening[] = [
    openingAt(entrance, 'S', 4.5, { id: 'door-street', widthM: 1.2, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } }),
    openingAt(entrance, 'N', 2.2, { id: 'door-clubhouse', widthM: MAIN_DOOR_M, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } }),
    openingAt(lifts, 'W', 2.4, { id: 'opening-lobby', type: 'opening', widthM: 2.6 }),
    openingAt(lifts, 'E', 1.2, { id: 'lift-a', widthM: LIFT_DOOR_M, leaf: OUT }),
    openingAt(lifts, 'E', 3.0, { id: 'lift-b', widthM: LIFT_DOOR_M, leaf: OUT }),
    openingAt(lifts, 'S', 10.6, { id: 'door-stairs', widthM: 1.0, leaf: OUT }),
    windowAt(entrance, 'S', 1.8, 'window-s1', 2.0, 0.0, 2.6),
    windowAt(entrance, 'S', 7.2, 'window-s2', 2.0, 0.0, 2.6),
    windowAt(entrance, 'W', 3.0, 'window-w', 2.4, 0.0, 2.6),
  ];
  const furniture: FurnitureItem[] = furnished ? [
    desk('reception-desk', 'Reception desk', 6.0, 0.95, 3.2, 0.7, 0),
    desk('security-desk', 'Security desk', 7.7, 5.9, 1.6, 0.6, 90),
    piece('lobby-sofa-1', 'sofa-3', 0.65, 4.9, 90),
    piece('lobby-sofa-2', 'sofa-2', 3.6, 4.6, 270),
    piece('lobby-table', 'side-table', 2.1, 4.75, 0),
    piece('lobby-armchair', 'armchair', 2.0, 2.9, 0),
  ] : [];
  const property = sceneFile({
    id, title: 'Entrance lobby', subtitle: SAMPLE_SUBTITLE, wallHeightM: 3.6, rooms: [entrance, lifts], openings, furniture,
    finishes: finishes({ ...WARM }), spawn: { x: 4.5, z: 5.6, yawDeg: 0 }, updatedAt: UPDATED_AT,
  });
  return { property, street: 'door-street', clubhouse: 'door-clubhouse', liftA: 'lift-a', liftB: 'lift-b', stairs: 'door-stairs' };
}

// ---------------------------------------------------------------- the clubhouse level (plan frame, one scene per space)

export interface ClubhouseOut {
  foyer: PropertyFile; hall: PropertyFile; gym: PropertyFile; pool: PropertyFile; garden: PropertyFile;
  doors: { hall: string; gym: string; pool: string; garden: string; walkway: string };
}

export function clubhouseScenes(ids: { foyer: string; hall: string; gym: string; pool: string; garden: string }): ClubhouseOut {
  const foyerR: Rect = { x0: 0, z0: 0, x1: 12, z1: 6 };
  const foyerRoom = rectRoom('foyer', 'Clubhouse foyer', 'other', foyerR);
  const hallRoom = rectRoom('hall', 'Community hall', 'other', { x0: -12.3, z0: -5.4, x1: -0.3, z1: 3.0 });
  const gymRoom = rectRoom('gym', 'Gym', 'other', { x0: 2, z0: -12.3, x1: 10, z1: -0.3 });
  const poolRoom = rectRoom('pool', 'Pool area (placeholder)', 'other', { x0: 12.3, z0: -3, x1: 28.3, z1: 6 });
  const gardenRoom = rectRoom('garden', 'Garden (placeholder)', 'other', { x0: 1, z0: 6.3, x1: 15, z1: 16.3 });
  const hall = doorPair({ room: foyerRoom, side: 'W', at: 1.5, id: 'door-hall' }, { room: hallRoom, id: 'door-foyer' }, 1.2);
  const gym = doorPair({ room: foyerRoom, side: 'N', at: 6, id: 'door-gym' }, { room: gymRoom, id: 'door-foyer' }, 1.2);
  const pool = doorPair({ room: foyerRoom, side: 'E', at: 2, id: 'door-pool' }, { room: poolRoom, id: 'door-foyer' }, 1.2);
  const garden = doorPair({ room: foyerRoom, side: 'S', at: 9.5, id: 'door-garden' }, { room: gardenRoom, id: 'door-foyer' }, 1.2);
  const foyerOpenings: Opening[] = [
    hall.a, gym.a, pool.a, garden.a,
    openingAt(foyerRoom, 'W', 4.8, { id: 'door-walkway', widthM: MAIN_DOOR_M, leaf: { hinge: 'start', swing: 'in', kind: 'hinged' } }),
    openingAt(foyerRoom, 'S', 2.0, { id: 'lift-a', widthM: LIFT_DOOR_M, leaf: OUT }),
    openingAt(foyerRoom, 'S', 3.8, { id: 'lift-b', widthM: LIFT_DOOR_M, leaf: OUT }),
    openingAt(foyerRoom, 'S', 6.0, { id: 'door-stairs', widthM: 1.0, leaf: OUT }),
  ];
  const mk = (id: string, title: string, h: number, rooms: RoomTag[], openings: Opening[], fin: ReturnType<typeof finishes>, spawn: { x: number; z: number; yawDeg: number }): PropertyFile =>
    sceneFile({ id, title, subtitle: SAMPLE_SUBTITLE, wallHeightM: h, rooms, openings, finishes: fin, spawn, updatedAt: UPDATED_AT });
  const foyer = mk(ids.foyer, 'Clubhouse foyer', 3.6, [foyerRoom], foyerOpenings, finishes({ ...WARM }), { x: 6, z: 3, yawDeg: 0 });
  const hallScene = mk(ids.hall, 'Community hall', 3.6, [hallRoom], [hall.b, windowAt(hallRoom, 'W', -1.2, 'window-w1', 2.4, 0.0, 2.6), windowAt(hallRoom, 'N', -6.3, 'window-n1', 2.4, 0.9, 2.6), windowAt(hallRoom, 'N', -2.5, 'window-n2', 2.4, 0.9, 2.6)], finishes({ floorColor: '#B79F7C', tile: null, wallColor: '#EFE8DA' }), { x: -6.3, z: -1.2, yawDeg: 90 });
  const gymScene = mk(ids.gym, 'Gym', 3.6, [gymRoom], [gym.b, windowAt(gymRoom, 'E', -6.3, 'window-e1', 2.4, 0.9, 2.6), windowAt(gymRoom, 'E', -10.5, 'window-e2', 2.4, 0.9, 2.6)], finishes({ floorColor: '#6E6A66', tile: null, wallColor: '#ECE9E2' }), { x: 6, z: -2, yawDeg: 180 });
  const poolScene = mk(ids.pool, 'Pool area (placeholder)', 4.2, [poolRoom], [pool.b], finishes({ floorColor: '#CFC6B6', tile: { wM: 0.6, lM: 0.6 }, groutColor: '#B8AE9C', wallColor: '#EDE9DF' }), { x: 14, z: 1.5, yawDeg: 90 });
  const gardenScene = mk(ids.garden, 'Garden (placeholder)', 3.6, [gardenRoom], [garden.b], finishes({ floorColor: '#A9B58F', tile: null, wallColor: '#EDEADF' }), { x: 9.5, z: 8, yawDeg: 180 });
  return { foyer, hall: hallScene, gym: gymScene, pool: poolScene, garden: gardenScene, doors: { hall: 'door-hall', gym: 'door-gym', pool: 'door-pool', garden: 'door-garden', walkway: 'door-walkway' } };
}
