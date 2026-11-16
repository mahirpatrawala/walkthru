// The sample tower's two open-air spaces (SPEC 19.8): the pool area and the garden of the clubhouse level, each as an ordinary scene
// (property.json) with an outdoor.json beside it, in the clubhouse plan's frame. `bare` is the empty tower's version: the same deck, basins,
// lawn and boundaries with nothing planted and nothing placed, for a builder to dress. Pure data, deterministic.
import type { FurnitureItem, Opening, PropertyFile, RoomTag } from '../../src/types';
import { EMPTY_OUTDOOR } from '../../src/outdoor/types';
import type { Boundary, GroundArea, OutdoorFile, PlantBed, PlantRow, PlantSpot, PoolBasin, Rect, Roof } from '../../src/outdoor/types';
import { roundedRectOutline } from '../../src/outdoor/geo';
import { TYPICAL_PROFILE } from '../../src/outdoor/pool';
import { finishes, rectRoom, sceneFile } from './scene-kit';
import { SAMPLE_SUBTITLE, UPDATED_AT, piece } from './spaces';

/** the rooms in the clubhouse plan's frame (they replace the 16 x 9 and 14 x 10 m placeholders of stage 1) */
export const POOL_RECT: Rect = { x0: 12.3, z0: -8, x1: 32.3, z1: 6 };
export const GARDEN_RECT: Rect = { x0: -4, z0: 6.3, x1: 30, z1: 26.3 };
/** the facade is the room's west edge for the pool (edge 3) and its north edge for the garden (edge 0) */
export const POOL_FACADE_EDGE = 3;
export const GARDEN_FACADE_EDGE = 0;
/** where the door from the clubhouse foyer sits on the facade (the plan coordinate along it: z for the pool, x for the garden) */
export const POOL_DOOR_AT = 2;
export const GARDEN_DOOR_AT = 9.5;
/** the height of the building's face above the deck: the podium (4.2 m) and two storeys of flats */
export const FACADE_M = 10.6;

const rectPoly = (r: Rect): { x: number; z: number }[] => [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });
const circle = (cx: number, cz: number, r: number, n = 28): { x: number; z: number }[] => Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * r, z: cz + Math.sin((i / n) * Math.PI * 2) * r }));
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
const rounded = (r: Rect, rad: number): { x: number; z: number }[] => roundedRectOutline(r.x0, r.z0, r.x1, r.z1, rad, 7);

// ---------------------------------------------------------------- rooms (shared with spaces.ts, which makes the door pairs)

/** the pool room: west wall is the facade (the door from the foyer), north is a compound wall, east a glass balustrade, south a compound wall */
export function poolRoom(): RoomTag {
  return rectRoom('pool', 'Pool area', 'other', POOL_RECT, ['wall', 'railing', 'wall', 'wall']);
}
/** the garden room: north is the facade, east and west compound walls, south a clipped ficus hedge */
export function gardenRoom(): RoomTag {
  return rectRoom('garden', 'Garden', 'other', GARDEN_RECT, ['wall', 'wall', 'wall', 'wall']);
}

// ---------------------------------------------------------------- the pool area

const MAIN_POOL: PoolBasin = {
  id: 'main', rect: R(17.0, -5.0, 28.0, -0.5), shallowEnd: 'W', profile: TYPICAL_PROFILE.map((p) => [...p] as [number, number]), waterBelowDeckM: 0.12, copingM: 0.3,
  steps: [{ edge: 'W', fromM: 0.45, widthM: 3.6, count: 3 }], ladders: [{ edge: 'S', atM: 6.2 }, { edge: 'S', atM: 9.2 }], lanes: 0, markers: true, tile: 'blue',
};
const KIDS_POOL: PoolBasin = {
  id: 'kids', rect: R(29.4, -4.8, 31.4, -2.6), shallowEnd: 'W', profile: [[0, 0.45], [1, 0.6]], waterBelowDeckM: 0.1, copingM: 0.25,
  steps: [{ edge: 'W', fromM: 0.5, widthM: 1.2, count: 1 }], ladders: [], lanes: 0, markers: true, kids: true, tile: 'turquoise',
};

export function poolOutdoor(bare: boolean): OutdoorFile {
  const pools = [MAIN_POOL, KIDS_POOL].map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })), ladders: p.ladders.map((l) => ({ ...l })), profile: p.profile.map((q) => [...q] as [number, number]) }));
  const holes = pools.map((p) => rectPoly(grow(p.rect, p.copingM)));
  const areas: GroundArea[] = [{ id: 'deck', finish: 'paving', polygon: rectPoly(POOL_RECT), holes }];
  const beds: PlantBed[] = [], trees: PlantSpot[] = [], rows: PlantRow[] = [], roofs: Roof[] = [];
  if (!bare) {
    areas.push({ id: 'sun-deck', finish: 'deck', polygon: rectPoly(R(15.4, 0.3, 31.0, 3.7)) });
    const bedA = rectPoly(R(12.9, -7.9, 20.6, -6.95)), bedB = rectPoly(R(24.6, -7.9, 31.8, -6.95)), bedS = rectPoly(R(12.9, 5.0, 31.8, 5.9));
    for (const [id, polygon] of [['bed-n1', bedA], ['bed-n2', bedB], ['bed-s', bedS]] as const) areas.push({ id, finish: 'bed', polygon, edgingM: 0.15 });
    beds.push(
      { id: 'planting-n1', polygon: bedA, species: [{ id: 'hibiscus', weight: 3 }, { id: 'croton', weight: 3 }, { id: 'bougainvillea', weight: 2 }], density: 2.6, seed: 11, scale: 1 },
      { id: 'planting-n2', polygon: bedB, species: [{ id: 'hibiscus', weight: 3 }, { id: 'croton', weight: 3 }, { id: 'bougainvillea', weight: 2 }], density: 2.6, seed: 12, scale: 1 },
      { id: 'planting-s', polygon: bedS, species: [{ id: 'croton', weight: 4 }, { id: 'hibiscus', weight: 2 }, { id: 'areca-palm', weight: 1 }], density: 2.2, seed: 13, scale: 1 },
    );
    trees.push(
      { species: 'royal-palm', x: 15.6, z: -7.4, scale: 1 }, { species: 'royal-palm', x: 19.4, z: -7.4, scale: 0.95 },
      { species: 'royal-palm', x: 27.2, z: -7.4, scale: 1.05 }, { species: 'royal-palm', x: 30.8, z: -7.4, scale: 0.92 },
      { species: 'frangipani', x: 16.6, z: 5.45, scale: 1 }, { species: 'frangipani', x: 23.0, z: 5.45, scale: 1.1 }, { species: 'frangipani', x: 29.4, z: 5.45, scale: 0.95 },
    );
    // the covered verandah along the facade: the semi-outdoor part. A slab at 3.6 m on columns at 15.5 m.
    roofs.push({ id: 'verandah', rect: R(12.3, -8, 15.9, 6), heightM: 3.6, kind: 'slab', columns: [-7.4, -3.8, 0.0, 4.2, 5.6].map((z) => ({ x: 15.5, z })), thicknessM: 0.22 });
  }
  const boundary: Boundary[] = [
    { room: 'pool', edge: 0, kind: 'compound', heightM: 2.2, colour: '#E9DCC2' },
    { room: 'pool', edge: 1, kind: 'glass', heightM: 1.1 },
    { room: 'pool', edge: 2, kind: 'compound', heightM: 2.2, colour: '#E9DCC2' },
    { room: 'pool', edge: POOL_FACADE_EDGE, kind: 'facade' },
  ];
  return { ...EMPTY_OUTDOOR, note: bare ? 'The pool area, bare: deck, pool, no furniture or planting' : 'Sample pool area for demonstration', northDeg: 0, seed: 7, areas, pools, boundary, trees, beds, rows, roofs };
}

export function poolFurniture(): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  let n = 0;
  const add = (cat: string, x: number, z: number, yaw: number): void => { out.push(piece(`${cat}-${++n}`, cat, x, z, yaw)); };
  // three groups of two loungers and a parasol between, on the timber deck south of the pool (feet to the water)
  for (const gx of [17.5, 22.0, 26.5]) { add('pool-lounger', gx, 1.9, 180); add('pool-umbrella', gx + 1.55, 1.9, 0); add('pool-lounger', gx + 3.1, 1.9, 180); }
  // two table groups under the verandah and one on the south deck
  for (const [tx, tz] of [[13.9, -4.4], [13.9, 3.9]] as const) { add('pool-table', tx, tz, 0); add('pool-chair', tx - 0.9, tz, 90); add('pool-chair', tx + 0.9, tz, 270); }
  add('pool-table', 25.0, 4.2, 0); add('pool-chair', 24.1, 4.2, 90); add('pool-chair', 25.9, 4.2, 270);
  add('pool-lifeguard-chair', 14.4, -2.2, 90);
  add('pool-life-ring', 21.8, -7.65, 0); add('pool-shower', 23.2, -7.65, 0); add('pool-shower', 14.9, 0.4, 0);
  add('pool-towel-rack', 29.2, 4.5, 180);
  // lamp posts on the south deck and bollards along the north walkway, lit from the evening
  for (const [x, z] of [[16.5, 4.5], [22.8, 4.6], [31.5, 3.0]] as const) add('garden-lamp-post', x, z, 0);
  for (const [x, z] of [[21.0, -6.35], [24.0, -6.35]] as const) add('garden-bollard', x, z, 0);
  add('pool-depth-sign', 18.0, -6.35, 0); add('pool-depth-sign', 26.5, -6.35, 0);
  add('pool-deck-planter', 31.4, 0.5, 0); add('pool-deck-planter', 31.1, -0.9, 0); add('pool-deck-planter', 13.9, 0.2, 0);
  // the changing-room markers beside the door on the facade
  out.push(piece('pool-sign-1', 'pool-changing-sign', 12.33, -0.5, 90), piece('pool-sign-2', 'pool-changing-sign', 12.33, 4.4, 90));
  return out;
}

export function poolProperty(id: string, door: Opening, bare: boolean): { property: PropertyFile; outdoor: OutdoorFile } {
  const room = poolRoom();
  const property = sceneFile({
    id, title: bare ? 'Pool area (bare)' : 'Pool area', subtitle: SAMPLE_SUBTITLE, wallHeightM: FACADE_M, rooms: [room], openings: [door],
    furniture: bare ? [] : poolFurniture(), finishes: finishes({ floorColor: '#C9B9A0', tile: null, wallColor: '#EFE6D3' }), spawn: { x: 14.0, z: 2, yawDeg: 90 }, updatedAt: UPDATED_AT, spaceKind: 'pool',
  });
  return { property, outdoor: poolOutdoor(bare) };
}

// ---------------------------------------------------------------- the garden

export function gardenOutdoor(bare: boolean): OutdoorFile {
  const room = rectPoly(GARDEN_RECT);
  const trackOuter = R(-2.4, 9.8, 28.4, 24.8), trackInner = R(-0.6, 11.6, 26.6, 23.0);
  const areas: GroundArea[] = [{ id: 'lawn', finish: 'lawn', polygon: room, stripes: !bare }];
  areas.push({ id: 'plaza-a', finish: 'paving', polygon: rectPoly(R(5.0, 6.3, 14.0, 9.0)) });
  areas.push({ id: 'path-1', finish: 'path', polygon: rectPoly(R(8.4, 9.0, 10.6, 13.2)), edgingM: 0.05 });
  const beds: PlantBed[] = [], trees: PlantSpot[] = [], rows: PlantRow[] = [];
  if (!bare) {
    areas.push({ id: 'track', finish: 'track', polygon: rounded(trackOuter, 3.2), holes: [rounded(trackInner, 1.6)] });
    areas.push({ id: 'plaza-b', finish: 'paving', polygon: circle(9.5, 17.3, 2.6) });
    areas.push({ id: 'path-4', finish: 'path', polygon: rectPoly(R(8.7, 19.8, 10.3, 24.8)), edgingM: 0.05 });
    areas.push({ id: 'path-west', finish: 'path', polygon: rectPoly(R(-0.6, 16.7, 6.9, 17.9)), edgingM: 0.05 });
    areas.push({ id: 'path-east', finish: 'path', polygon: rectPoly(R(12.1, 16.7, 14.4, 17.9)), edgingM: 0.05 });
    areas.push({ id: 'play', finish: 'rubber', polygon: rectPoly(R(14.0, 12.2, 25.4, 22.6)), colour: '#4B8A5A', edgingM: 0.08 });
    // coloured islands of safety surfacing under each piece, a little wider than its fall zone's first metre
    for (const [id, r, colour] of [['play-swing', R(14.6, 12.9, 19.4, 16.3), '#B5483A'], ['play-slide', R(21.3, 13.9, 23.7, 18.7), '#D9A93A'], ['play-seesaw', R(15.2, 19.1, 18.8, 20.9), '#3F6FA8'], ['play-climber', R(21.5, 18.5, 24.5, 21.5), '#B5483A']] as const) areas.push({ id, finish: 'rubber', polygon: rectPoly(r), colour });
    const bw = rectPoly(R(-3.7, 7.0, -2.6, 25.9)), be = rectPoly(R(28.8, 7.0, 29.7, 25.9)), bs = rectPoly(R(-2.0, 25.2, 29.0, 25.9)), bn1 = rectPoly(R(-3.7, 6.5, 4.4, 7.4)), bn2 = rectPoly(R(15.0, 6.5, 29.7, 7.4));
    for (const [id, polygon] of [['bed-w', bw], ['bed-e', be], ['bed-s', bs], ['bed-n1', bn1], ['bed-n2', bn2]] as const) areas.push({ id, finish: 'bed', polygon, edgingM: 0.15 });
    beds.push(
      { id: 'planting-w', polygon: bw, species: [{ id: 'bougainvillea', weight: 3 }, { id: 'hibiscus', weight: 2 }, { id: 'croton', weight: 2 }], density: 2.4, seed: 21, scale: 1 },
      { id: 'planting-e', polygon: be, species: [{ id: 'bougainvillea', weight: 3 }, { id: 'hibiscus', weight: 2 }, { id: 'croton', weight: 2 }], density: 2.4, seed: 22, scale: 1 },
      { id: 'planting-s', polygon: bs, species: [{ id: 'croton', weight: 3 }, { id: 'hibiscus', weight: 2 }, { id: 'bougainvillea', weight: 2 }], density: 2.4, seed: 23, scale: 1 },
      { id: 'planting-n1', polygon: bn1, species: [{ id: 'areca-palm', weight: 2 }, { id: 'croton', weight: 3 }, { id: 'hibiscus', weight: 1 }], density: 2.6, seed: 24, scale: 1 },
      { id: 'planting-n2', polygon: bn2, species: [{ id: 'areca-palm', weight: 2 }, { id: 'croton', weight: 3 }, { id: 'hibiscus', weight: 1 }], density: 2.6, seed: 25, scale: 1 },
    );
    trees.push(
      { species: 'royal-palm', x: 6.2, z: 8.2, scale: 1 }, { species: 'royal-palm', x: 12.8, z: 8.2, scale: 1.05 },
      { species: 'neem', x: 12.6, z: 12.8, scale: 1 }, { species: 'neem', x: 26.0, z: 12.8, scale: 1.1 },
      { species: 'gulmohar', x: 6.6, z: 22.2, scale: 1 }, { species: 'gulmohar', x: 21.6, z: 24.0, scale: 0.9 },
      { species: 'frangipani', x: 5.6, z: 19.6, scale: 1 }, { species: 'frangipani', x: 7.0, z: 14.0, scale: 0.95 }, { species: 'frangipani', x: 12.6, z: 20.8, scale: 1.05 },
    );
    rows.push({ id: 'areca-row', from: { x: 1, z: 25.55 }, to: { x: 27, z: 25.55 }, species: 'areca-palm', style: 'row', spacingM: 3.6, scale: 0.9 });
    rows.push({ id: 'ficus-hedge-a', from: { x: 5.0, z: 9.4 }, to: { x: 8.0, z: 9.4 }, species: 'ficus', style: 'hedge', widthM: 0.6, heightM: 0.9 });
    rows.push({ id: 'ficus-hedge-b', from: { x: 11.0, z: 9.4 }, to: { x: 14.0, z: 9.4 }, species: 'ficus', style: 'hedge', widthM: 0.6, heightM: 0.9 });
  }
  const boundary: Boundary[] = [
    { room: 'garden', edge: GARDEN_FACADE_EDGE, kind: 'facade' },
    { room: 'garden', edge: 1, kind: 'compound', heightM: 2.1, colour: '#E9DCC2' },
    { room: 'garden', edge: 2, kind: 'hedge', heightM: 2.0 },
    { room: 'garden', edge: 3, kind: 'compound', heightM: 2.1, colour: '#E9DCC2' },
  ];
  return { ...EMPTY_OUTDOOR, note: bare ? 'The garden, bare: a plain lawn, a paved entrance and a path' : 'Sample garden for demonstration', northDeg: 0, seed: 9, areas, pools: [], boundary, trees, beds, rows, roofs: [] };
}

export function gardenFurniture(): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  let n = 0;
  const add = (cat: string, x: number, z: number, yaw: number): void => { out.push(piece(`${cat}-${++n}`, cat, x, z, yaw)); };
  // the central plaza: a water feature and two benches facing it
  add('garden-fountain', 9.5, 17.3, 0); add('garden-bench', 7.4, 17.3, 90); add('garden-bench', 11.6, 17.3, 270);
  // senior seating beside the west path, the pergola at the end of it, the yoga deck on the lawn
  add('garden-bench-senior', 1.4, 19.2, 180); add('garden-bench-senior', 4.2, 19.2, 180);
  add('garden-pergola', 1.5, 22.4, 0); add('garden-yoga-deck', 2.2, 13.9, 0);
  // the children's play area: swings, a slide, a see-saw and a climbing frame, each with its fall zone clear
  add('garden-swingset', 17.0, 14.6, 0); add('garden-slide', 22.5, 15.5, 0); add('garden-seesaw', 17.0, 20.0, 0); add('garden-climber', 23.0, 19.8, 0);
  // lamp posts along the entrance and the plaza, bollards along the track
  for (const [x, z] of [[6.0, 6.9], [13.0, 6.9], [7.6, 13.2], [11.4, 13.2], [6.8, 20.4], [12.2, 20.4]] as const) add('garden-lamp-post', x, z, 0);
  for (const [x, z] of [[2.2, 11.8], [14.0, 11.8], [22.6, 11.8], [26.4, 15.0], [26.4, 20.0], [22.6, 22.8], [14.0, 22.8], [4.6, 22.8], [-0.4, 20.0], [-0.4, 14.5]] as const) add('garden-bollard', x, z, 0);
  add('pool-deck-planter', 5.3, 7.6, 0); add('pool-deck-planter', 13.7, 7.6, 0);
  return out;
}

export function gardenProperty(id: string, door: Opening, bare: boolean): { property: PropertyFile; outdoor: OutdoorFile } {
  const room = gardenRoom();
  const property = sceneFile({
    id, title: bare ? 'Garden (bare)' : 'Garden', subtitle: SAMPLE_SUBTITLE, wallHeightM: FACADE_M, rooms: [room], openings: [door],
    furniture: bare ? [] : gardenFurniture(), finishes: finishes({ floorColor: '#6C9A47', tile: null, wallColor: '#EFE6D3' }), spawn: { x: 9.5, z: 8.2, yawDeg: 0 }, updatedAt: UPDATED_AT, spaceKind: 'garden',
  });
  return { property, outdoor: gardenOutdoor(bare) };
}
