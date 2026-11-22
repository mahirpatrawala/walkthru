// The Sample Tower's clubhouse level, drawn after the amenity-level plan of a published builder brochure (SPEC 18.8, 19.8, 20): the foyer and passages,
// the indoor games area, the gym with its changing rooms, three banquet rooms with their deck, the pool wing (lap pool, shallow pool, lawn and a bridge to the
// building) and the aqua-play court. Every position and size comes from scripts/building/podium-plan.ts, which is scaled from the plan's one printed
// dimension (the 25 m lap pool): nothing here is measured. Pure data in, scenes and a level out; the same every run.
import { catalogItem } from '../../src/core/catalog';
import type { FurnitureItem, Opening, PropertyFile, SpaceKind, Vec2 } from '../../src/types';
import type { DoorLook, Level, Portal, Space } from '../../src/building/types';
import { EMPTY_OUTDOOR } from '../../src/outdoor/types';
import type { Boundary, GroundArea, OutdoorFile, PlantBed, PlantRow, PlantSpot, PoolBasin, Rect } from '../../src/outdoor/types';
import { TYPICAL_PROFILE } from '../../src/outdoor/pool';
import { easeWalkway } from '../../src/outdoor/walkway';
import { growRect, unionOutline } from '../../src/outdoor/outline';
import { finishes } from './scene-kit';
import { LIFT_DOOR_M, UPDATED_AT, piece } from './spaces';
import type { Draft } from './podium-kit';
import { addDoor, addDoorPair, addWindow, propertyOf, roomOf, roomOfRects } from './podium-kit';
import * as P from './podium-plan';

const FACADE_M = 10.6;
export const PODIUM_SUBTITLE = 'Sample building · clubhouse level after a published builder brochure, scaled from its one printed dimension, not measured';
const px = (r: P.PxRect): Rect => ({ x0: P.mx(r[0]), z0: P.mz(r[1]), x1: P.mx(r[2]), z1: P.mz(r[3]) });
const pts = (list: readonly P.PxPoint[]): Vec2[] => list.map((p) => P.toM(p));
const rectPoly = (r: Rect): Vec2[] => [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
const at = (p: P.PxPoint): Vec2 => P.toM(p);

const SAND = { floorColor: '#D2C2A3', tile: { wM: 0.8, lM: 0.8 }, groutColor: '#B9A98A', wallColor: '#EFE7D8', ceilingColor: '#F7F4EE' } as const;
const RUBBER = { floorColor: '#6E6A66', tile: null, wallColor: '#ECE9E2', ceilingColor: '#F7F4EE' } as const;
const TILE_WET = { floorColor: '#CBD3D6', tile: { wM: 0.3, lM: 0.3 }, groutColor: '#AEB7BB', wallColor: '#E9EEF0', ceilingColor: '#F7F4EE' } as const;
const OPEN_AIR = { floorColor: '#C9B9A0', tile: null, wallColor: '#EFE6D3' } as const;

/** every id a scene or a space of this level has: the empty twin has its own copy of every scene that is furnished or planted */
export interface PodiumIds { foyer: string; games: string; link: string; gym: string; changing1: string; changing2: string; hall1: string; lounge: string; hall2: string; deck: string; aqua: string; wing: string }
export const FULL_IDS: PodiumIds = {
  foyer: 'test-tower-club-foyer', games: 'test-tower-club-games', link: 'test-tower-club-link', gym: 'test-tower-club-gym', changing1: 'test-tower-club-changing-1', changing2: 'test-tower-club-changing-2',
  hall1: 'test-tower-club-hall-1', lounge: 'test-tower-club-lounge', hall2: 'test-tower-club-hall-2', deck: 'test-tower-club-deck', aqua: 'test-tower-club-aqua', wing: 'test-tower-club-pool',
};
export const EMPTY_IDS: PodiumIds = {
  ...FULL_IDS, games: 'test-tower-empty-club-games', gym: 'test-tower-empty-club-gym', changing1: 'test-tower-empty-club-changing-1', changing2: 'test-tower-empty-club-changing-2',
  hall1: 'test-tower-empty-club-hall-1', lounge: 'test-tower-empty-club-lounge', hall2: 'test-tower-empty-club-hall-2', deck: 'test-tower-empty-club-deck', aqua: 'test-tower-empty-club-aqua', wing: 'test-tower-empty-club-pool',
};

export interface PodiumScene { property: PropertyFile; outdoor?: OutdoorFile }
export interface Podium { scenes: Map<string, PodiumScene>; level: Level; /** the foyer's own door ids, for the ground lobby's link and the lifts */ ids: PodiumIds }

// ---------------------------------------------------------------- the rooms

const draft = (id: string, title: string, kind: SpaceKind, wallH: number, room: Draft['rooms'][number], fin: ReturnType<typeof finishes>, spawn: Draft['spawn']): Draft => ({
  id, title, kind, wallHeightM: wallH, rooms: [room], openings: [], furniture: [], finishes: fin, spawn, subtitle: PODIUM_SUBTITLE, updatedAt: UPDATED_AT,
});
const rects = (list: readonly P.PxRect[]): Rect[] => list.map(px);

interface Drafts { foyer: Draft; games: Draft; link: Draft; gym: Draft; changing1: Draft; changing2: Draft; hall1: Draft; lounge: Draft; hall2: Draft; deck: Draft; aqua: Draft; wing: Draft }

/** an edge of an open-air room is the building's face (`facade`) when it is the one the doors are on: the test says which */
function outdoorRoom(id: string, label: string, poly: Vec2[], isFacade: (a: Vec2, b: Vec2) => boolean): ReturnType<typeof roomOf> {
  return roomOf(id, label, poly, (_m, a, b) => (isFacade(a, b) ? 'wall' : 'railing'));
}
const onLine = (a: Vec2, b: Vec2, axis: 'x' | 'z', v: number): boolean => Math.abs(a[axis] - v) < 0.02 && Math.abs(b[axis] - v) < 0.02;

function draftRooms(ids: PodiumIds): Drafts {
  const IND = 3.6;
  const foyer = draft(ids.foyer, 'Clubhouse foyer', 'corridor', IND, roomOfRects('foyer', 'Clubhouse foyer', rects(P.SPACES_PX.foyer)), finishes({ ...SAND, frameColor: '#A8B0B5' }), { ...at([2108, 1300]), yawDeg: 180 });
  const games = draft(ids.games, 'Indoor games area', 'games', IND, roomOfRects('games', 'Indoor games area', rects(P.SPACES_PX.games)), finishes({ ...SAND }), { ...at([2400, 1150]), yawDeg: 90 });
  const link = draft(ids.link, 'Link passage', 'corridor', IND, roomOfRects('link', 'Link passage', rects(P.SPACES_PX.link)), finishes({ ...SAND }), { ...at([2800, 1045]), yawDeg: 90 });
  const gym = draft(ids.gym, 'Gymnasium', 'gym', IND, roomOfRects('gym', 'Gymnasium', rects(P.SPACES_PX.gym)), finishes({ ...RUBBER }), { ...at([2060, 1560]), yawDeg: 180 });
  const changing1 = draft(ids.changing1, 'Changing room 1', 'gym', IND, roomOfRects('changing-1', 'Changing room 1', rects(P.SPACES_PX.changing1)), finishes({ ...TILE_WET }), { ...at([2040, 1298]), yawDeg: 270 });
  const changing2 = draft(ids.changing2, 'Changing room 2', 'gym', IND, roomOfRects('changing-2', 'Changing room 2', rects(P.SPACES_PX.changing2)), finishes({ ...TILE_WET }), { ...at([2040, 1381]), yawDeg: 270 });
  const hall1 = draft(ids.hall1, 'Banquet hall 1', 'hall', IND, roomOfRects('hall-1', 'Banquet hall 1', rects(P.SPACES_PX.hall1)), finishes({ ...SAND }), { ...at([3200, 920]), yawDeg: 0 });
  const lounge = draft(ids.lounge, 'Banquet lounge', 'hall', IND, roomOfRects('lounge', 'Banquet lounge', rects(P.SPACES_PX.lounge)), finishes({ ...SAND }), { ...at([3180, 1043]), yawDeg: 90 });
  const hall2 = draft(ids.hall2, 'Banquet hall 2', 'hall', IND, roomOf('hall-2', 'Banquet hall 2', pts(P.SPACES_PX.hall2)), finishes({ ...SAND }), { ...at([3250, 1175]), yawDeg: 90 });
  const dx = P.mx(3348), ax = P.mx(1897), ay = P.mz(1253);
  const deck = draft(ids.deck, 'Banquet deck', 'garden', FACADE_M, outdoorRoom('deck', 'Banquet deck', rectPoly(px([3348, 718, 3436, 1367])), (a, b) => onLine(a, b, 'x', dx)), finishes({ ...OPEN_AIR }), { ...at([3390, 1040]), yawDeg: 270 });
  const aquaLoops = unionOutline(rects(P.SPACES_PX.aqua));
  const aqua = draft(ids.aqua, 'Aqua play', 'pool', FACADE_M, outdoorRoom('aqua', 'Aqua play', aquaLoops[0], (a, b) => onLine(a, b, 'z', ay)), finishes({ ...OPEN_AIR }), { ...at([2350, 1300]), yawDeg: 90 });
  const wing = draft(ids.wing, 'Pool area', 'pool', FACADE_M, outdoorRoom('pool', 'Pool area', pts(P.SPACES_PX.wing), (a, b) => onLine(a, b, 'x', ax)), finishes({ ...OPEN_AIR }), { ...at([1860, 1450]), yawDeg: 270 });
  return { foyer, games, link, gym, changing1, changing2, hall1, lounge, hall2, deck, aqua, wing };
}

const W = 1.2;
function doors(d: Drafts): void {
  const D = P.DOORS_PX;
  addDoor(d.foyer, at(D.foyerStairs), { id: 'door-stairs', widthM: 1.0 }, 'out');
  P.LIFT_AT_PX.forEach((x, i) => addDoor(d.foyer, at([x, 1098]), { id: i === 0 ? 'lift-a' : 'lift-b', widthM: LIFT_DOOR_M }, 'out'));
  addDoor(d.foyer, at(D.foyerGround), { id: 'door-walkway', widthM: 1.0 });
  addDoorPair(d.foyer, 'door-gym', d.gym, 'door-foyer', at(D.foyerGym), W);
  addDoorPair(d.foyer, 'door-changing-1', d.changing1, 'door-foyer', at(D.foyerChanging1), 1.0);
  addDoorPair(d.foyer, 'door-changing-2', d.changing2, 'door-foyer', at(D.foyerChanging2), 1.0);
  addDoorPair(d.foyer, 'door-games', d.games, 'door-foyer', at(D.foyerGames), W);
  addDoorPair(d.foyer, 'door-aqua', d.aqua, 'door-foyer', at(D.foyerDeck), W);
  addDoorPair(d.foyer, 'door-bridge', d.wing, 'door-foyer', at(D.foyerBridge), W);
  addDoorPair(d.games, 'door-link', d.link, 'door-games', at(D.gamesLink), W);
  addDoorPair(d.link, 'door-lounge', d.lounge, 'door-link', at(D.linkLounge), W);
  addDoorPair(d.link, 'door-aqua', d.aqua, 'door-link', at(D.linkDeck), W);
  addDoor(d.link, at(D.linkStairs), { id: 'door-stairs', widthM: 1.0 }, 'out');
  addDoorPair(d.hall1, 'door-lounge', d.lounge, 'door-hall-1', at(D.hall1Lounge), 1.0);
  addDoorPair(d.lounge, 'door-hall-2', d.hall2, 'door-lounge', at(D.loungeHall2), 1.0);
  addDoorPair(d.hall1, 'door-deck', d.deck, 'door-hall-1', at(D.hall1Deck), W);
  addDoorPair(d.lounge, 'door-deck', d.deck, 'door-lounge', at(D.loungeDeck), W);
  addDoorPair(d.hall2, 'door-deck', d.deck, 'door-hall-2', at(D.hall2Deck), W);
  // the glazing of the three banquet rooms onto their deck: two windows each, either side of the door
  for (const [dr, label, door, wy] of [[d.hall1, 'hall1', D.hall1Deck, [758, 895]], [d.lounge, 'lounge', D.loungeDeck, [975, 1105]], [d.hall2, 'hall2', D.hall2Deck, [1185, 1325]]] as const) {
    void door;
    wy.forEach((y, i) => addWindow(dr, at([3348, y]), `window-e${i + 1}`, 2.0, 0.0, 2.6));
    void label;
  }
}

// ---------------------------------------------------------------- the pieces the plan draws

type Add = (catalogId: string, p: Vec2, yaw: number) => FurnitureItem;
function adder(into: FurnitureItem[], prefix: string): Add {
  let n = 0;
  return (cat, p, yaw) => { const it = piece(`${prefix}-${cat}-${++n}`, cat, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100, yaw); into.push(it); return it; };
}

const rows = (n: number, a: number, b: number): number[] => Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)));

function gamesPieces(d: Draft): void {
  const add = adder(d.furniture, 'games'), G = P.GAMES_PX;
  add('games-card-set', at(G.cardTable), 0);
  add('games-chess-set', at(G.chessTable), 90);
  add('games-foosball', at(G.foosball), 0);
  add('games-carrom-set', at(G.carrom), 0);
  add('hall-table-tennis', at(G.tableTennis), 0);
  add('hall-pool-table', at(G.pool), 0);
  // the curved sofa of the plan, as a 3-seat sofa facing east to its round table
  add('sofa-3', at(G.sofa), 90);
  add('coffee-round', at(G.sofaTable), 0);
}

function gymPieces(d: Draft): void {
  const add = adder(d.furniture, 'gym'), G = P.GYM_PX;
  // treadmills along the west wall, their consoles against it (the plan draws seven; at the typical 50 cm each side seven need 10.3 m of wall and the room is about 9.5 m, so six stand)
  rows(G.treadmillCount, G.treadmillY[0], G.treadmillY[1]).forEach((y) => add('gym-treadmill', { x: P.mx(P.SPACES_PX.gym[0][0]) + 1.06, z: P.mz(y) }, 90));
  // spin bikes in a row along the south wall
  rows(4, G.bikesX[0], G.bikesX[1]).forEach((x) => add('gym-spin-bike', { x: P.mx(x), z: P.mz(G.bikesY) }, 180));
  // a column of selectorised machines against the glass partition, a rack of dumbbells, mats and a bench
  const machines = ['gym-lat-pulldown', 'gym-seated-row', 'gym-chest-press', 'gym-shoulder-press'];
  G.machinesY.forEach((y, i) => add(machines[i], { x: P.mx(G.machinesX), z: P.mz(y) }, 270));
  G.matsY.forEach((y) => G.matsX.forEach((x) => add('yoga-mat', at([x, y]), 0)));
  add('gym-dumbbell-rack', at(G.dumbbellAt), 0);
  add('gym-locker-bench', at(G.benchAt), 0);
  // SPEC 16.17.1 (22 Nov 2026, sample furnishing, not on the plan): a mirror wall beside the mats and in front of the bikes, and rubber flooring
  // under the strength, free-weight and bike areas (2 m modules from the treadmill row to the mats; the strip by the door and the treadmill row keep the room's floor)
  const r = P.SPACES_PX.gym[0], gx0 = P.mx(r[0]), gx1 = P.mx(r[2]), gz1 = P.mz(r[3]);
  for (let i = 0; i < 7; i++) add('gym-mirror', { x: gx1 - 0.02, z: gz1 - 8.9 + 0.6 + i * 1.2 }, 270);
  for (let i = 0; i < 5; i++) add('gym-mirror', { x: gx0 + 4.48 + i * 1.2, z: gz1 - 0.02 }, 180);
  for (let j = 0; j < 4; j++) {
    const z = gz1 - 1.1 - j * 2;
    add('gym-floor-4x2', { x: gx0 + 2.18 + 2, z }, 0); add('gym-floor-4x2', { x: gx0 + 2.18 + 6, z }, 0); add('gym-floor-2x2', { x: gx0 + 2.18 + 9, z }, 0);
  }
}

function changingPieces(d: Draft, big: boolean): void {
  const add = adder(d.furniture, 'chg');
  const r = d.rooms[0].polygon, x0 = Math.min(...r.map((p) => p.x)), x1 = Math.max(...r.map((p) => p.x)), z0 = Math.min(...r.map((p) => p.z)), z1 = Math.max(...r.map((p) => p.z));
  // lockers along the north wall, their doors to the room; the larger room also has a bench along the south wall (the smaller one is too shallow for both and a walkway)
  const wall = z0 + 0.225;
  if (big) { add('gym-lockers-12', { x: x0 + 1.1, z: wall }, 0); add('gym-lockers-6', { x: x0 + 2.45, z: wall }, 0); add('gym-lockers-6', { x: x0 + 3.4, z: wall }, 0); add('gym-locker-bench', { x: (x0 + x1) / 2 - 0.3, z: z1 - 0.45 }, 0); }
  else { add('gym-lockers-6', { x: x0 + 0.7, z: wall }, 0); add('gym-lockers-6', { x: x0 + 1.65, z: wall }, 0); add('gym-lockers-6', { x: x0 + 2.6, z: wall }, 0); }
}

function banquetPieces(d: Draft, tables: readonly P.PxPoint[], id: 'hall-banquet-set-4' | 'hall-cafe-set-2'): void {
  const add = adder(d.furniture, 'banq');
  for (const t of tables) add(id, at(t), 0);
}

// ---------------------------------------------------------------- open-air spaces

const COPING = 0.3;
const basin = (id: string, r: P.PxRect, shallowEnd: PoolBasin['shallowEnd'], profile: [number, number][], o: Partial<PoolBasin> = {}): PoolBasin => ({
  id, rect: px(r), shallowEnd, profile, waterBelowDeckM: 0.12, copingM: COPING, steps: [], ladders: [], lanes: 0, markers: true, tile: 'blue', ...o,
});
export const wingPools = (): PoolBasin[] => [
  basin('shallow', P.WATER_PX.shallow, 'W', [[0, 0.9], [1, 1.2]]),
  basin('lap', P.WATER_PX.lap, 'N', TYPICAL_PROFILE.map((p) => [...p] as [number, number])),
  basin('ledge', P.WATER_PX.ledge, 'W', [[0, 0.45], [1, 0.45]], { markers: false, tile: 'turquoise' }),
];
export const aquaPools = (): PoolBasin[] => [basin('aqua', P.WATER_PX.aqua, 'S', [[0, 0.3], [1, 0.45]], { kids: true, tile: 'turquoise', copingM: 0.25, waterBelowDeckM: 0.1 })];

const holeFor = (pools: PoolBasin[]): Vec2[][] => unionOutline(pools.map((p) => growRect(p.rect, p.copingM)));
const boundariesFor = (d: Draft, id: string, edge: { facadeKind: 'facade'; others: Boundary['kind'] }): Boundary[] =>
  d.rooms[0].edges.map((k, i): Boundary => (k === 'wall' ? { room: id, edge: i, kind: edge.facadeKind } : { room: id, edge: i, kind: edge.others, heightM: 1.1, colour: '#E9DCC2' }));

const strip = (id: string, r: P.PxRect): GroundArea => ({ id, finish: 'bed', polygon: rectPoly(px(r)), edgingM: 0.1 });
const scatter = (id: string, r: P.PxRect, seed: number, species: PlantBed['species'], density = 2.4): PlantBed => ({ id: `planting-${id}`, polygon: rectPoly(px(r)), species, density, seed, scale: 1 });
const FLOWERS: PlantBed['species'] = [{ id: 'hibiscus', weight: 3 }, { id: 'bougainvillea', weight: 3 }, { id: 'croton', weight: 2 }];

/** SPEC 19.13: the clubhouse level stands on the tower's Ground level (make-sample-building.ts, floor to floor 4.2 m), so the open-air spaces are
 *  4.2 m above the site: the storeys' face goes down that far and the plain ground lies there (the brochure calls the level a podium; the
 *  sample building has one storey under it, and the map and the walk follow the sample building) */
export const ABOVE_GROUND_M = 4.2;

export function wingOutdoor(d: Draft, bare: boolean): OutdoorFile {
  const pools = wingPools();
  const [sh, lap, led] = [pools[0].rect, pools[1].rect, pools[2].rect];
  const cm = COPING, gap = 0.01;
  // the wing is lawn under everything (a finish drawn over another needs the lower one to lift less: lawn is the lowest), then the timber decks as rectangles that stop at the
  // coping, then the three lawn patches with their kerbs (item 5 is the south one), then the bridge in stone
  const areas: GroundArea[] = [{ id: 'ground', finish: 'lawn', polygon: d.rooms[0].polygon.map((p) => ({ ...p })), holes: holeFor(pools) }];
  const timber = (id: string, r: Rect): void => { areas.push({ id, finish: 'deck', polygon: rectPoly(r) }); };
  const L = P.WING_LINES_PX, wx0 = P.mx(L.westInnerX), wx1 = P.mx(L.eastX), centreBot = led.z0 - cm - gap;
  timber('deck-north', { x0: wx0, z0: P.mz(L.northInnerY), x1: sh.x1, z1: sh.z0 - cm });
  timber('deck-west', { x0: wx0, z0: sh.z0 - cm, x1: sh.x0 - cm, z1: sh.z1 + cm });
  timber('deck-south-west', { x0: P.mx(L.centreWestX), z0: centreBot, x1: led.x0 - cm, z1: P.mz(L.southWestBottomY) });
  timber('deck-south', { x0: led.x0 - cm, z0: led.z1 + cm, x1: wx1, z1: P.mz(L.southStripBottomY) });
  timber('deck-bridge-head', { x0: lap.x1 + cm, z0: P.mz(L.bridgeY[0]), x1: wx1, z1: P.mz(L.bridgeY[1]) });
  areas.push({ id: 'lawn-bay', finish: 'lawn', polygon: rectPoly({ x0: sh.x1 + cm + gap, z0: P.mz(L.northInnerY), x1: P.mx(L.eastInnerX), z1: lap.z0 - cm - gap }), edgingM: 0.12 });
  areas.push({ id: 'lawn-centre', finish: 'lawn', polygon: [{ x: wx0, z: sh.z1 + cm + gap }, { x: lap.x0 - cm - gap, z: sh.z1 + cm + gap }, { x: lap.x0 - cm - gap, z: centreBot }, { x: P.mx(L.centreWestX), z: centreBot }, { x: P.mx(L.centreWestX), z: P.mz(L.centreLawnNotchY) }, { x: wx0, z: P.mz(L.centreLawnNotchY) }], edgingM: 0.12 });
  areas.push({ id: 'lawn-south', finish: 'lawn', polygon: rectPoly(px(P.LAWN_PX.south)), edgingM: 0.12 });
  areas.push({ id: 'bridge', finish: 'paving', bridge: true, polygon: rectPoly({ x0: wx1, z0: P.mz(L.bridgeY[0]), x1: P.mx(L.bridgeEndX), z1: P.mz(L.bridgeY[1]) }) });
  const beds: PlantBed[] = [], trees: PlantSpot[] = [], rows: PlantRow[] = [];
  const edges = Object.entries(L.strips) as [string, P.PxRect][];
  if (!bare) {
    for (const [id, r] of edges) { areas.push(strip(`bed-${id}`, r)); beds.push(scatter(id, r, 31 + id.length * 7 + id.charCodeAt(0), FLOWERS, 2.2)); }
    // SPEC 19.12: the three trees the plan draws on the centre lawn, by the water, are coconut palms (two) and a frangipani, as a resort pool has them;
    // the north bay and the south lawn keep their shade trees (neem). Species are a typical choice, not the brochure's (it names none)
    const centre: Record<number, PlantSpot['species']> = { 3: 'coconut-palm', 4: 'frangipani', 5: 'coconut-palm' };
    P.WING_PX.trees.forEach(([x, y], i) => trees.push({ species: centre[i] ?? 'neem', ...at([x, y]), scale: centre[i] === 'frangipani' ? 1.1 : centre[i] ? 0.95 : 1.05 }));
  }
  const boundary = boundariesFor(d, 'pool', { facadeKind: 'facade', others: 'parapet' });
  return { ...EMPTY_OUTDOOR, note: bare ? 'The pool wing, bare: the deck, the pools and the lawns, with nothing placed or planted' : 'Sample pool wing after a published builder brochure, scaled from its one printed dimension', northDeg: P.NORTH_DEG, seed: 7, aboveGroundM: ABOVE_GROUND_M, areas, pools, boundary, trees, beds, rows, roofs: [] };
}

function wingPieces(d: Draft): void {
  const add = adder(d.furniture, 'wing'), W = P.WING_PX;
  // five loungers on the north deck and ten down the west deck, feet to the water; seven chairs down the south-west deck, facing the pool
  W.loungersTop.x.forEach((x) => add('pool-lounger', at([x, W.loungersTop.y]), 0));
  rows(W.loungersWest.n, W.loungersWest.y0, W.loungersWest.y1).forEach((y) => add('pool-lounger', at([W.loungersWest.x, y]), 90));
  W.chairsY.forEach((y) => add('pool-chair', at([W.chairsX, y]), 90));
}

export function aquaOutdoor(d: Draft, bare: boolean): OutdoorFile {
  const pools = aquaPools();
  const areas: GroundArea[] = [{ id: 'deck', finish: 'deck', polygon: d.rooms[0].polygon.map((p) => ({ ...p })), holes: holeFor(pools) }];
  const beds: PlantBed[] = [], trees: PlantSpot[] = [], rows: PlantRow[] = [];
  areas.push({ id: 'slope', finish: 'bed', polygon: rectPoly(px(P.AQUA_PX.slopeBed)), edgingM: 0.12 });
  if (!bare) {
    beds.push(scatter('slope', P.AQUA_PX.slopeBed, 41, [{ id: 'croton', weight: 3 }, { id: 'areca-palm', weight: 2 }, { id: 'hibiscus', weight: 2 }], 2.6));
    for (const [x, y] of [[2905, 1385], [2985, 1400], [3060, 1380]] as const) trees.push({ species: 'neem', ...at([x, y]), scale: 1.0 });
    // the two palms the plan draws in the water stand at the pool's corners (a basin here has no island to carry a tree)
    // SPEC 19.12: coconut palms (a model, CC-BY), as Indian pool courts plant them
    for (const [x, y] of [[2385, 1470], [2850, 1470]] as const) trees.push({ species: 'coconut-palm', ...at([x, y]), scale: 0.95 });
    // the clipped shrubs along the south and east edges
    rows.push({ id: 'hedge-south', from: at([2340, P.AQUA_PX.southHedgeY]), to: at([2850, P.AQUA_PX.southHedgeY]), species: 'ficus', style: 'hedge', widthM: 1.7, heightM: 1.5 });
    rows.push({ id: 'hedge-east', from: at([P.AQUA_PX.eastHedgeX + 14, 1480]), to: at([P.AQUA_PX.eastHedgeX + 14, 1770]), species: 'ficus', style: 'hedge', widthM: 1.7, heightM: 1.5 });
  }
  const boundary = boundariesFor(d, 'aqua', { facadeKind: 'facade', others: 'parapet' });
  return { ...EMPTY_OUTDOOR, note: bare ? 'Aqua play, bare: the timber court and the shallow pool, with nothing placed or planted' : 'Sample aqua-play court after a published builder brochure, scaled from its one printed dimension', northDeg: P.NORTH_DEG, seed: 9, aboveGroundM: ABOVE_GROUND_M, areas, pools, boundary, trees, beds, rows, roofs: [] };
}

function aquaPieces(d: Draft): void {
  const add = adder(d.furniture, 'aqua'), A = P.AQUA_PX;
  add('aqua-tower', at(A.towerAt), 0);
  add('aqua-sun', at(A.sunAt), 0);
  add('aqua-mushroom', at(A.mushroomAt), 0);
  add('aqua-jets', at(A.jetsAt), 0);
  A.chairsY.forEach((y) => add('pool-chair', at([A.chairsX, y]), 90));
  add('garden-bench', at([2363, 1277]), 180);
  add('garden-bench', at([2828, 1317]), 270);
}

export function deckOutdoor(d: Draft, bare: boolean): OutdoorFile {
  const areas: GroundArea[] = [{ id: 'deck', finish: 'deck', polygon: d.rooms[0].polygon.map((p) => ({ ...p })) }];
  const beds: PlantBed[] = [], rows: PlantRow[] = [];
  if (!bare) {
    areas.push(strip('bed-south', [3348, 1349, 3436, 1367]));
    beds.push(scatter('south', [3348, 1349, 3436, 1367], 51, FLOWERS, 3));
    rows.push({ id: 'hedge-east', from: at([3428, 735]), to: at([3428, 1345]), species: 'ficus', style: 'hedge', widthM: 0.6, heightM: 1.0 });
  }
  const boundary = boundariesFor(d, 'deck', { facadeKind: 'facade', others: 'parapet' });
  return { ...EMPTY_OUTDOOR, note: bare ? 'The banquet deck, bare: timber decking only' : 'Sample banquet deck after a published builder brochure, scaled from its one printed dimension', northDeg: P.NORTH_DEG, seed: 11, aboveGroundM: ABOVE_GROUND_M, areas, pools: [], boundary, trees: [], beds, rows, roofs: [] };
}

function deckPieces(d: Draft): void {
  const add = adder(d.furniture, 'deck');
  add('garden-bench', at([3395, 765]), 270);
  add('garden-bench', at([3395, 1310]), 270);
}

// ---------------------------------------------------------------- the level

const portal = (id: string, opening: string, to: { space: string; portal: string }, label: string, prompt: string, look: DoorLook = 'plain'): Portal => ({ id, kind: 'door', opening, to, label, prompt, look });
const NOTE_SCALE = 'Scaled from the one printed dimension of the plan (the 25 m lap pool), not measured.';

export function buildPodium(empty: boolean): Podium {
  const ids = empty ? EMPTY_IDS : FULL_IDS;
  const d = draftRooms(ids);
  doors(d);
  if (!empty) {
    gamesPieces(d.games); gymPieces(d.gym); changingPieces(d.changing1, false); changingPieces(d.changing2, true);
    banquetPieces(d.hall1, P.HALL1_TABLES_PX, 'hall-banquet-set-4'); banquetPieces(d.hall2, P.HALL2_TABLES_PX, 'hall-banquet-set-4'); banquetPieces(d.lounge, P.LOUNGE_TABLES_PX, 'hall-cafe-set-2');
    wingPieces(d.wing); aquaPieces(d.aqua); deckPieces(d.deck);
  }
  const scenes = new Map<string, PodiumScene>();
  // a sample deck is dressed to leave the pool's walkway where the deck is wide enough (easeWalkway slides loungers and chairs back from the water)
  const put = (dr: Draft, outdoor?: OutdoorFile): void => {
    const property = propertyOf(dr);
    const dressed = outdoor && outdoor.pools.length && property.furniture.length ? { ...property, furniture: easeWalkway(outdoor.pools, property.layout.rooms[0].polygon, property.furniture) } : property;
    scenes.set(dr.id, { property: dressed, ...(outdoor ? { outdoor } : {}) });
  };
  put(d.foyer); put(d.games); put(d.link); put(d.gym); put(d.changing1); put(d.changing2); put(d.hall1); put(d.lounge); put(d.hall2);
  put(d.deck, deckOutdoor(d.deck, empty)); put(d.aqua, aquaOutdoor(d.aqua, empty)); put(d.wing, wingOutdoor(d.wing, empty));

  const lift = (id: string): Portal => ({ id, kind: 'lift', opening: id, lift: id });
  const stairs: Portal = { id: 'stairs', kind: 'stairs', opening: 'door-stairs', label: 'Stairs' };
  const space = (id: string, kind: SpaceKind, name: string, sceneId: string, portals: Portal[], notes: string[], outdoor = false): Space => ({
    id, kind, name, sceneId, placement: { x: 0, z: 0, rotDeg: 0 }, portals, notes, ...(outdoor ? { outdoor: true } : {}),
  });
  const E = empty;
  const spaces: Space[] = [
    space('clubhouse', 'corridor', 'Clubhouse foyer', ids.foyer, [
      lift('lift-a'), lift('lift-b'), stairs,
      { id: 'walkway', kind: 'door', opening: 'door-walkway', to: { space: 'lobby', portal: 'clubhouse' }, label: 'The ground floor', prompt: 'To the ground floor', look: 'glass' },
      portal('games', 'door-games', { space: 'games', portal: 'foyer' }, 'Indoor games area', 'Enter the indoor games area'),
      portal('gym', 'door-gym', { space: 'gym', portal: 'foyer' }, 'Gymnasium', 'Enter the gymnasium'),
      portal('changing-1', 'door-changing-1', { space: 'changing-1', portal: 'foyer' }, 'Changing room 1', 'Enter changing room 1'),
      portal('changing-2', 'door-changing-2', { space: 'changing-2', portal: 'foyer' }, 'Changing room 2', 'Enter changing room 2'),
      portal('aqua', 'door-aqua', { space: 'aqua', portal: 'foyer' }, 'Aqua play and deck', 'Go out to the aqua-play deck', 'glass'),
      portal('pool', 'door-bridge', { space: 'pool', portal: 'foyer' }, 'Pool area, by the bridge', 'Cross the bridge to the pool area', 'glass'),
    ], [`The lift lobby and the passages of the amenity level, after the plan of a published builder brochure. ${NOTE_SCALE}`]),
    space('games', 'games', 'Indoor games area', ids.games, [portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'games' }, 'The clubhouse foyer', 'To the clubhouse foyer'), portal('link', 'door-link', { space: 'link', portal: 'games' }, 'The link passage', 'To the link passage')],
      E ? ['Empty. Item 7 of the plan: cards, carrom, chess, table tennis, foosball and a pool table go here.', NOTE_SCALE] : ['Item 7 of the plan: a pool table, table tennis, foosball, carrom, chess and cards, and a lounge, placed where the plan draws them (sample furnishing).', NOTE_SCALE]),
    space('link', 'corridor', 'Link passage', ids.link, [
      portal('games', 'door-games', { space: 'games', portal: 'link' }, 'Indoor games area', 'To the indoor games area'),
      portal('lounge', 'door-lounge', { space: 'lounge', portal: 'link' }, 'Banquet lounge', 'Enter the banquet lounge'),
      portal('aqua', 'door-aqua', { space: 'aqua', portal: 'link' }, 'Aqua play and deck', 'Go out to the aqua-play deck', 'glass'),
      stairs,
    ], ['The passage east of the games area that leads to the banquet rooms, with the second stair core.', NOTE_SCALE]),
    space('gym', 'gym', 'Gymnasium', ids.gym, [portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'gym' }, 'The clubhouse foyer', 'To the clubhouse foyer')],
      E ? ['Empty. Item 6 of the plan, about 16 x 9.5 m.', NOTE_SCALE] : ['Item 6 of the plan: six treadmills along the west wall (the plan draws seven), spin bikes along the south, a column of strength machines, mats and dumbbells, as the plan draws them (sample equipment).', NOTE_SCALE]),
    space('changing-1', 'gym', 'Changing room 1', ids.changing1, [portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'changing-1' }, 'The clubhouse foyer', 'To the clubhouse foyer')], [E ? 'Empty changing room of the gymnasium.' : 'The gymnasium\'s changing room (sample lockers and bench; the plan draws cubicles).', NOTE_SCALE]),
    space('changing-2', 'gym', 'Changing room 2', ids.changing2, [portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'changing-2' }, 'The clubhouse foyer', 'To the clubhouse foyer')], [E ? 'Empty changing room of the gymnasium.' : 'The gymnasium\'s second changing room (sample lockers and bench; the plan draws cubicles).', NOTE_SCALE]),
    space('hall-1', 'hall', 'Banquet hall 1', ids.hall1, [portal('lounge', 'door-lounge', { space: 'lounge', portal: 'hall-1' }, 'The banquet lounge', 'To the banquet lounge'), portal('deck', 'door-deck', { space: 'deck', portal: 'hall-1' }, 'The banquet deck', 'Go out to the deck', 'glass')],
      E ? ['Empty. One of the two banquet halls of item 3.', NOTE_SCALE] : ['One of the two banquet halls of item 3, six round tables as the plan draws them (sample furnishing).', NOTE_SCALE]),
    space('lounge', 'hall', 'Banquet lounge', ids.lounge, [
      portal('link', 'door-link', { space: 'link', portal: 'lounge' }, 'The link passage', 'To the link passage'),
      portal('hall-1', 'door-hall-1', { space: 'hall-1', portal: 'lounge' }, 'Banquet hall 1', 'Enter banquet hall 1'),
      portal('hall-2', 'door-hall-2', { space: 'hall-2', portal: 'lounge' }, 'Banquet hall 2', 'Enter banquet hall 2'),
      portal('deck', 'door-deck', { space: 'deck', portal: 'lounge' }, 'The banquet deck', 'Go out to the deck', 'glass'),
    ], [E ? 'Empty. The room between the two banquet halls of item 3.' : 'The room between the two banquet halls, with four café tables as the plan draws them (sample furnishing). The plan does not name it.', NOTE_SCALE]),
    space('hall-2', 'hall', 'Banquet hall 2', ids.hall2, [portal('lounge', 'door-lounge', { space: 'lounge', portal: 'hall-2' }, 'The banquet lounge', 'To the banquet lounge'), portal('deck', 'door-deck', { space: 'deck', portal: 'hall-2' }, 'The banquet deck', 'Go out to the deck', 'glass')],
      E ? ['Empty. The second banquet hall of item 3, one corner cut on the diagonal the plan draws.', NOTE_SCALE] : ['The second banquet hall of item 3, five round tables as the plan draws them (sample furnishing). One corner is cut on the diagonal the plan draws.', NOTE_SCALE]),
    space('deck', 'garden', 'Banquet deck', ids.deck, [
      portal('hall-1', 'door-hall-1', { space: 'hall-1', portal: 'deck' }, 'Banquet hall 1', 'Enter banquet hall 1', 'glass'),
      portal('lounge', 'door-lounge', { space: 'lounge', portal: 'deck' }, 'Banquet lounge', 'Enter the banquet lounge', 'glass'),
      portal('hall-2', 'door-hall-2', { space: 'hall-2', portal: 'deck' }, 'Banquet hall 2', 'Enter banquet hall 2', 'glass'),
    ], [E ? 'Open air. The outdoor deck of item 3, bare timber decking.' : 'Open air. The outdoor deck of item 3 along the three banquet rooms. The sky is a plain graded sky, not the real view.', NOTE_SCALE], true),
    space('aqua', 'pool', 'Aqua play', ids.aqua, [
      portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'aqua' }, 'The clubhouse foyer', 'To the clubhouse foyer', 'glass'),
      portal('link', 'door-link', { space: 'link', portal: 'aqua' }, 'The link passage', 'To the link passage', 'glass'),
    ], [E ? 'Open air. Item 4 of the plan: the shallow play pool and its deck, bare.' : 'Open air. Item 4 of the plan: a shallow play pool with a water-play tower, a sun spray, a water mushroom and a row of ground jets, on a timber court. Water, sky and sun are drawn; the surroundings beyond the walls are not. Pool depths are typical, not from the plan.', NOTE_SCALE], true),
    space('pool', 'pool', 'Pool area', ids.wing, [portal('foyer', 'door-foyer', { space: 'clubhouse', portal: 'pool' }, 'The clubhouse foyer (by the bridge)', 'To the clubhouse foyer', 'glass')],
      [E ? 'Open air. Items 1, 2 and 5 of the plan: the 25 m lap pool, the shallow pool and the lawns, bare.' : 'Open air. Items 1, 2 and 5 of the plan: the 25 m lap pool (the one dimension the plan prints) and the shallow pool as one L-shaped body of water, loungers, lawn and trees. Pool depths are typical, not from the plan.', NOTE_SCALE], true),
  ];
  const level: Level = { id: 'l1', label: 'Level 1', short: '1', summary: 'Clubhouse: games, gym, banquet halls, pools', floorToFloorM: 4.2, spaces };
  return { scenes, level, ids };
}

/** the clubhouse's id for each space of the level, by plan item, for the map's notes and the tests */
export const ITEMS = { lapPool: 1, shallowPool: 2, banquetHalls: 3, aquaPlay: 4, lawn: 5, gymnasium: 6, gamesArea: 7 } as const;
void catalogItem; void ({} as Opening);
