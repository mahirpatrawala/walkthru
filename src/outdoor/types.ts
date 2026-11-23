// Outdoor spaces (SPEC 19): the pool deck, the garden and any other open-air space of a residential project. The data lives in an
// `outdoor.json` beside the scene's property.json (public/scenes/<id>/outdoor.json), in the scene's own frame, metres. Pure data, no three.
// The scene's layout still carries the room (its polygon and the walls that stop the walker); this file says what the ground is, where the
// water is, what each boundary looks like, and what grows where.
import type { Vec2 } from '../types';

export type Vec2Like = Vec2;
export type Side = 'N' | 'E' | 'S' | 'W';
export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** What the ground is. `bed` is a planting bed (soil and mulch, a low kerb round it), `path` interlocking pavers, `track` a rubberised jogging track, `rubber` safety surfacing. */
export const GROUND_FINISHES = ['paving', 'deck', 'lawn', 'gravel', 'bed', 'path', 'rubber', 'track'] as const;
export type GroundFinish = (typeof GROUND_FINISHES)[number];

/** One patch of ground. Later areas are drawn over earlier ones; `holes` are left open (a pool basin, a tree pit). */
export interface GroundArea {
  id: string;
  finish: GroundFinish;
  polygon: Vec2[];
  holes?: Vec2[][];
  /** the colour of rubber, track and (as a tint) paving, '#rrggbb' */
  colour?: string;
  /** lawn: mown stripes (alternate light and dark bands) */
  stripes?: boolean;
  /** a kerb along the edge: the height above the ground in metres, 0.05 to 0.3 (a bed's raised edge, a path's edging) */
  edgingM?: number;
  /** a span over open ground (a bridge between two wings): drawn with a slab edge and a soffit under it, not with the storeys below (SPEC 19.13) */
  bridge?: boolean;
}

/** What stands on an edge of the space. `facade` is the wall of the building the space attaches to: the shell draws it (with the door in it) and it rises as a building. */
export const BOUNDARY_KINDS = ['compound', 'parapet', 'hedge', 'glass', 'facade'] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];
export interface Boundary {
  /** the layout room and its edge (0 = the first edge of the polygon) */
  room: string;
  edge: number;
  kind: BoundaryKind;
  /** compound wall 1.8 to 2.4 m, parapet 1.0 to 1.2 m, hedge 1.2 to 2.2 m, glass 1.0 to 1.2 m; the facade takes the layout's wall height */
  heightM?: number;
  /** wall paint, '#rrggbb' */
  colour?: string;
  /**
   * SPEC 19.14 (23 Nov 2026), a facade only: the building the space attaches to is wider than the space's edge. Its face continues along the
   * edge's line `beforeM` before the edge's start and `afterM` past its end, and the building stands `depthM` behind it: read off the plan
   * (the indoor rooms on that line), so a narrow edge (a bridge's end) does not stand alone as a pillar. Drawn as decor outside the space.
   */
  building?: { beforeM: number; afterM: number; depthM: number };
}

/** Steps into a pool along one of its edges: `count` treads, the top one `topDepthM` under the water, each next one `riserM` lower. */
export interface PoolSteps { edge: Side; /** from the edge's low end, metres */ fromM: number; widthM: number; count: number; treadM?: number; riserM?: number; topDepthM?: number }
/** A ladder (two stainless handrails and two under-water rungs) at the edge, `atM` from the edge's low end. */
export interface PoolLadder { edge: Side; atM: number }

export interface PoolBasin {
  id: string;
  /** the water and the basin under it, in the scene frame */
  rect: Rect;
  /** the end where it is shallow: the depth then changes along the other axis */
  shallowEnd: Side;
  /** [position along the pool 0 (shallow end) to 1 (deep end), depth in metres below the water] */
  profile: [number, number][];
  /** the water surface sits this far below the deck (a skimmer pool: about 0.12) */
  waterBelowDeckM: number;
  /** the stone edge round the basin, metres wide */
  copingM: number;
  steps: PoolSteps[];
  ladders: PoolLadder[];
  /** lane lines painted on the floor (0 for none) */
  lanes: number;
  /** depth markers on the coping and the wall (tile numbers) */
  markers: boolean;
  /** a children's pool: its depth is the standing depth for a small child, not for swimming */
  kids?: boolean;
  tile: 'blue' | 'turquoise' | 'white';
}

/** The kinds of plant. See src/outdoor/species.ts. */
export const SPECIES_IDS = ['royal-palm', 'areca-palm', 'frangipani', 'neem', 'gulmohar', 'ficus', 'bougainvillea', 'hibiscus', 'croton', 'coconut-palm'] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export interface PlantSpot { species: SpeciesId; x: number; z: number; /** 1 = the species' usual size */ scale?: number; rotDeg?: number }
/** A bed planted at random inside its polygon (a seeded scatter, so the same file always grows the same bed). */
export interface PlantBed { id: string; polygon: Vec2[]; species: { id: SpeciesId; weight: number }[]; /** plants per square metre */ density: number; seed: number; scale?: number }
/** A hedge or a row of plants along a line. `hedge` is one clipped, continuous mass; `row` is separate plants `spacingM` apart. */
export interface PlantRow { id: string; from: Vec2; to: Vec2; species: SpeciesId; style: 'hedge' | 'row'; spacingM?: number; widthM?: number; heightM?: number; scale?: number }

/** A roof over part of the space (a covered pool deck, a verandah): the slab, and the columns that hold it. `pergola` is open slats. */
export interface Roof { id: string; rect: Rect; heightM: number; kind: 'slab' | 'pergola'; columns: Vec2[]; thicknessM?: number; colour?: string }

export interface OutdoorFile {
  version: 1;
  /** a sample or a bare space for a builder to dress */
  note?: string;
  /** compass bearing of the plan's -z direction, degrees: gives the sun a real path (look.json's own `northDeg` wins) */
  northDeg?: number;
  /** seeds the small variations (a leaf's colour, a tree's lean) so the same file always looks the same */
  seed: number;
  /** SPEC 19.13: how far the space's ground is above the site's ground, metres (the storeys under it, from the building's levels). With it the
   *  storeys' face is drawn down from every open edge and a plain, hazy ground lies below and beyond: not the real site, nothing is on it */
  aboveGroundM?: number;
  areas: GroundArea[];
  pools: PoolBasin[];
  boundary: Boundary[];
  trees: PlantSpot[];
  beds: PlantBed[];
  rows: PlantRow[];
  roofs: Roof[];
}

export const EMPTY_OUTDOOR: OutdoorFile = { version: 1, seed: 1, areas: [], pools: [], boundary: [], trees: [], beds: [], rows: [], roofs: [] };

// ---------------------------------------------------------------- parse

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SIDES: Side[] = ['N', 'E', 'S', 'W'];
const HEX = /^#[0-9a-fA-F]{6}$/;

function fail(path: string, msg: string): never { throw new Error(`outdoor.json: ${path} ${msg}`); }
function point(v: unknown, path: string): Vec2 {
  if (!isObj(v) || !num(v.x) || !num(v.z)) fail(path, 'must be { x, z } in metres');
  return { x: v.x as number, z: v.z as number };
}
function polygon(v: unknown, path: string): Vec2[] {
  if (!Array.isArray(v) || v.length < 3) fail(path, 'must be a polygon of at least 3 points');
  return v.map((p, i) => point(p, `${path}[${i}]`));
}
function rect(v: unknown, path: string): Rect {
  if (!isObj(v) || !num(v.x0) || !num(v.z0) || !num(v.x1) || !num(v.z1)) fail(path, 'must be { x0, z0, x1, z1 }');
  const r = v as unknown as Rect;
  if (!(r.x1 > r.x0 && r.z1 > r.z0)) fail(path, 'must have x1 > x0 and z1 > z0');
  return { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 };
}
function oneOf<T extends string>(v: unknown, list: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) fail(path, `must be one of ${list.join(', ')}`);
  return v as T;
}
function inRange(v: unknown, lo: number, hi: number, path: string): number {
  if (!num(v) || v < lo || v > hi) fail(path, `must be a number from ${lo} to ${hi}`);
  return v as number;
}

/** Reads and checks an outdoor.json. Throws an Error that names the place (`outdoor.json: pools[0].profile ...`). */
export function parseOutdoor(json: unknown): OutdoorFile {
  if (!isObj(json)) fail('', 'is not an object');
  if (json.version !== 1) fail('version', 'must be 1');
  const out: OutdoorFile = { ...EMPTY_OUTDOOR, seed: num(json.seed) ? Math.floor(json.seed) : 1, areas: [], pools: [], boundary: [], trees: [], beds: [], rows: [], roofs: [] };
  if (typeof json.note === 'string') out.note = json.note.slice(0, 200);
  if (json.northDeg !== undefined) out.northDeg = inRange(json.northDeg, -360, 360, 'northDeg');
  if (json.aboveGroundM !== undefined) out.aboveGroundM = inRange(json.aboveGroundM, 0, 300, 'aboveGroundM');
  const list = (key: string): unknown[] => { const v = json[key]; if (v === undefined) return []; if (!Array.isArray(v)) fail(key, 'must be a list'); return v as unknown[]; };
  const seen = new Set<string>();
  const unique = (id: unknown, path: string): string => {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) fail(`${path}.id`, 'must be 1 to 40 lower-case letters, digits or hyphens');
    if (seen.has(id as string)) fail(`${path}.id`, `"${id}" is used twice`);
    seen.add(id as string);
    return id as string;
  };
  list('areas').forEach((a, i) => {
    const p = `areas[${i}]`;
    if (!isObj(a)) fail(p, 'must be an object');
    const area: GroundArea = { id: unique(a.id, p), finish: oneOf(a.finish, GROUND_FINISHES, `${p}.finish`), polygon: polygon(a.polygon, `${p}.polygon`) };
    if (a.holes !== undefined) { if (!Array.isArray(a.holes)) fail(`${p}.holes`, 'must be a list of polygons'); area.holes = a.holes.map((h, k) => polygon(h, `${p}.holes[${k}]`)); }
    if (a.colour !== undefined) { if (typeof a.colour !== 'string' || !HEX.test(a.colour)) fail(`${p}.colour`, 'must be #rrggbb'); area.colour = a.colour; }
    if (a.stripes !== undefined) area.stripes = a.stripes === true;
    if (a.edgingM !== undefined) area.edgingM = inRange(a.edgingM, 0.05, 0.3, `${p}.edgingM`);
    if (a.bridge === true) area.bridge = true;
    out.areas.push(area);
  });
  list('pools').forEach((b, i) => {
    const p = `pools[${i}]`;
    if (!isObj(b)) fail(p, 'must be an object');
    const prof = b.profile;
    if (!Array.isArray(prof) || prof.length < 2) fail(`${p}.profile`, 'must be at least two [position, depth] pairs');
    const profile = (prof as unknown[]).map((q, k): [number, number] => {
      if (!Array.isArray(q) || q.length !== 2 || !num(q[0]) || !num(q[1])) fail(`${p}.profile[${k}]`, 'must be [position 0..1, depth in metres]');
      return [inRange(q[0], 0, 1, `${p}.profile[${k}][0]`), inRange(q[1], 0.2, 5, `${p}.profile[${k}][1]`)];
    });
    for (let k = 1; k < profile.length; k++) if (!(profile[k][0] > profile[k - 1][0])) fail(`${p}.profile`, 'positions must increase');
    if (profile[0][0] !== 0 || profile[profile.length - 1][0] !== 1) fail(`${p}.profile`, 'must start at 0 and end at 1');
    const steps = (b.steps === undefined ? [] : Array.isArray(b.steps) ? (b.steps as unknown[]) : fail(`${p}.steps`, 'must be a list')).map((s, k): PoolSteps => {
      const q = `${p}.steps[${k}]`;
      if (!isObj(s)) fail(q, 'must be an object');
      return {
        edge: oneOf(s.edge, SIDES, `${q}.edge`), fromM: inRange(s.fromM, 0, 100, `${q}.fromM`), widthM: inRange(s.widthM, 0.5, 20, `${q}.widthM`), count: inRange(s.count, 1, 8, `${q}.count`),
        ...(s.treadM !== undefined ? { treadM: inRange(s.treadM, 0.2, 0.6, `${q}.treadM`) } : {}), ...(s.riserM !== undefined ? { riserM: inRange(s.riserM, 0.1, 0.4, `${q}.riserM`) } : {}),
        ...(s.topDepthM !== undefined ? { topDepthM: inRange(s.topDepthM, 0.1, 0.6, `${q}.topDepthM`) } : {}),
      };
    });
    const ladders = (b.ladders === undefined ? [] : Array.isArray(b.ladders) ? (b.ladders as unknown[]) : fail(`${p}.ladders`, 'must be a list')).map((s, k): PoolLadder => {
      const q = `${p}.ladders[${k}]`;
      if (!isObj(s)) fail(q, 'must be an object');
      return { edge: oneOf(s.edge, SIDES, `${q}.edge`), atM: inRange(s.atM, 0, 100, `${q}.atM`) };
    });
    out.pools.push({
      id: unique(b.id, p), rect: rect(b.rect, `${p}.rect`), shallowEnd: oneOf(b.shallowEnd, SIDES, `${p}.shallowEnd`), profile,
      waterBelowDeckM: inRange(b.waterBelowDeckM ?? 0.12, 0, 0.5, `${p}.waterBelowDeckM`), copingM: inRange(b.copingM ?? 0.3, 0.1, 0.6, `${p}.copingM`),
      steps, ladders, lanes: inRange(b.lanes ?? 0, 0, 8, `${p}.lanes`), markers: b.markers !== false, ...(b.kids === true ? { kids: true } : {}),
      tile: oneOf(b.tile ?? 'blue', ['blue', 'turquoise', 'white'] as const, `${p}.tile`),
    });
  });
  list('boundary').forEach((b, i) => {
    const p = `boundary[${i}]`;
    if (!isObj(b)) fail(p, 'must be an object');
    if (typeof b.room !== 'string') fail(`${p}.room`, 'must name a room');
    const e: Boundary = { room: b.room, edge: inRange(b.edge, 0, 63, `${p}.edge`), kind: oneOf(b.kind, BOUNDARY_KINDS, `${p}.kind`) };
    if (!Number.isInteger(e.edge)) fail(`${p}.edge`, 'must be a whole number');
    if (b.heightM !== undefined) e.heightM = inRange(b.heightM, 0.4, 6, `${p}.heightM`);
    if (b.colour !== undefined) { if (typeof b.colour !== 'string' || !HEX.test(b.colour)) fail(`${p}.colour`, 'must be #rrggbb'); e.colour = b.colour; }
    if (b.building !== undefined) {
      if (e.kind !== 'facade') fail(`${p}.building`, 'is only for a facade');
      if (!isObj(b.building)) fail(`${p}.building`, 'must be an object');
      e.building = { beforeM: inRange(b.building.beforeM, 0, 200, `${p}.building.beforeM`), afterM: inRange(b.building.afterM, 0, 200, `${p}.building.afterM`), depthM: inRange(b.building.depthM, 0.3, 200, `${p}.building.depthM`) };
    }
    out.boundary.push(e);
  });
  const spot = (s: unknown, p: string): PlantSpot => {
    if (!isObj(s)) fail(p, 'must be an object');
    return { species: oneOf(s.species, SPECIES_IDS, `${p}.species`), x: num(s.x) ? s.x : fail(`${p}.x`, 'must be a number'), z: num(s.z) ? s.z : fail(`${p}.z`, 'must be a number'), ...(s.scale !== undefined ? { scale: inRange(s.scale, 0.3, 2.5, `${p}.scale`) } : {}), ...(s.rotDeg !== undefined ? { rotDeg: inRange(s.rotDeg, -360, 360, `${p}.rotDeg`) } : {}) };
  };
  list('trees').forEach((s, i) => out.trees.push(spot(s, `trees[${i}]`)));
  list('beds').forEach((b, i) => {
    const p = `beds[${i}]`;
    if (!isObj(b)) fail(p, 'must be an object');
    if (!Array.isArray(b.species) || b.species.length === 0) fail(`${p}.species`, 'must list at least one species with a weight');
    out.beds.push({
      id: unique(b.id, p), polygon: polygon(b.polygon, `${p}.polygon`), density: inRange(b.density, 0.2, 12, `${p}.density`), seed: num(b.seed) ? Math.floor(b.seed) : 1,
      species: (b.species as unknown[]).map((s, k) => { if (!isObj(s)) fail(`${p}.species[${k}]`, 'must be { id, weight }'); return { id: oneOf(s.id, SPECIES_IDS, `${p}.species[${k}].id`), weight: inRange(s.weight, 0.01, 100, `${p}.species[${k}].weight`) }; }),
      ...(b.scale !== undefined ? { scale: inRange(b.scale, 0.3, 2.5, `${p}.scale`) } : {}),
    });
  });
  list('rows').forEach((r, i) => {
    const p = `rows[${i}]`;
    if (!isObj(r)) fail(p, 'must be an object');
    out.rows.push({
      id: unique(r.id, p), from: point(r.from, `${p}.from`), to: point(r.to, `${p}.to`), species: oneOf(r.species, SPECIES_IDS, `${p}.species`), style: oneOf(r.style ?? 'row', ['hedge', 'row'] as const, `${p}.style`),
      ...(r.spacingM !== undefined ? { spacingM: inRange(r.spacingM, 0.3, 12, `${p}.spacingM`) } : {}), ...(r.widthM !== undefined ? { widthM: inRange(r.widthM, 0.3, 3, `${p}.widthM`) } : {}),
      ...(r.heightM !== undefined ? { heightM: inRange(r.heightM, 0.3, 4, `${p}.heightM`) } : {}), ...(r.scale !== undefined ? { scale: inRange(r.scale, 0.3, 2.5, `${p}.scale`) } : {}),
    });
  });
  list('roofs').forEach((r, i) => {
    const p = `roofs[${i}]`;
    if (!isObj(r)) fail(p, 'must be an object');
    if (!Array.isArray(r.columns)) fail(`${p}.columns`, 'must be a list of { x, z }');
    out.roofs.push({
      id: unique(r.id, p), rect: rect(r.rect, `${p}.rect`), heightM: inRange(r.heightM, 2, 8, `${p}.heightM`), kind: oneOf(r.kind ?? 'slab', ['slab', 'pergola'] as const, `${p}.kind`),
      columns: (r.columns as unknown[]).map((c, k) => point(c, `${p}.columns[${k}]`)),
      ...(r.thicknessM !== undefined ? { thicknessM: inRange(r.thicknessM, 0.05, 0.6, `${p}.thicknessM`) } : {}), ...(r.colour !== undefined && typeof r.colour === 'string' && HEX.test(r.colour) ? { colour: r.colour } : {}),
    });
  });
  return out;
}

/** The rectangle of a basin's water, and its long and short axes. */
export const rectW = (r: Rect): number => r.x1 - r.x0;
export const rectD = (r: Rect): number => r.z1 - r.z0;
