// Authoring a flat from printed room sizes (SPEC 18.13). A builder's brochure prints every room's inside size ("LIVING 3.81 x 5.55") on its plan
// and RERA carpet area beside it. This module turns a typed spec of those rooms (rectangles in metres, doors and windows by the wall they are
// on and where along it, furniture by where the plan draws it) into an ordinary flat scene, and REFUSES to build one that contradicts its own
// numbers: every room's inside size must equal the printed size within 2 cm, no two rooms may overlap, every room must be walkable from the main
// door, and the rooms plus the partition walls between them must add up to the stated carpet area within the stated tolerance (3 %).
//
// What is a fact and what is not (SPEC 16.2): a room's size is the drawing's (printed). Where a room sits and where a door or window sits is
// scaled off the drawing's picture (about 5 cm); a door's width, a window's width, sills, heads, wall thicknesses and the ceiling are NOT printed
// and are scaled or typical: the scene says so (`proposal-extras.json` `assumptions`, the ceiling is marked not confirmed). Furniture is the
// drawing's "artist's conception": it is drawn where the plan draws it, at the catalogue's size, and is sample furniture a viewer can move or delete.
import { clearRoutes } from '../../src/building/clear-routes';
import { catalogItem } from '../../src/core/catalog';
import { DEFAULT_FINISHES } from '../../src/types';
import { boxCorners, pointInPolygon, polygonArea } from '../../src/core/geometry';
import { overlapAreaM2 } from '../../src/core/layout-validate';
import type { DoorLeaf, EdgeKind, FurnitureItem, FurnitureKind, Layout, Opening, PropertyFile, RoomTag, RoomType, Vec2 } from '../../src/types';

export type Side = 'N' | 'E' | 'S' | 'W';
const DIR: Record<Side, Vec2> = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };
const EDGE_OF: Record<Side, number> = { N: 0, E: 1, S: 2, W: 3 };

/** Where a printed size comes from: the plan's own label in metres, or the brochure's table in feet and inches. */
export interface Printed { aM: number; bM: number; from: 'plan' | 'table' }
/** One rectangle of a room: `x`, `z` its north-west inside corner, `w` east-west, `d` north-south, in metres in the flat's frame (x east, z south). */
export interface Part { x: number; z: number; w: number; d: number; printed: Printed }

export interface RoomSpec {
  id: string;
  label: string;
  type: RoomType;
  /** one rectangle, or several that touch and make one rectilinear room (an L). Each carries its own printed size. */
  parts: Part[];
  /** counts towards the carpet area. Default: everything but balconies, decks and utility areas (the brochure counts those apart). */
  carpet?: boolean;
  /** rooms this one is open to: no wall on the stretch they face each other */
  openTo?: string[];
  /** which finish group of the specification the room takes */
  finish: 'dry' | 'wet' | 'kitchen' | 'utility' | 'balcony';
  /** a balcony's sides that are solid wall or pier on the plan (an edge nothing faces is otherwise a railing) */
  solidSides?: Side[];
}

export interface OpeningSpec {
  id: string;
  /** the room whose wall carries it */
  room: string;
  /** the side of that room's wall */
  wall: Side;
  /** where its middle is along the wall, as the plan coordinate (x for a north or south wall, z for an east or west wall) */
  at: number;
  widthM: number;
  kind: 'door' | 'opening' | 'window' | 'sliding';
  /** the compass side of the jamb the leaf hangs on (N or S on an east or west wall, E or W on a north or south wall) */
  hinge?: Side;
  /** the room the leaf swings into: 'in' is this room, 'out' the one on the far side. Default 'in'. */
  swing?: 'in' | 'out';
  sillM?: number;
  headM?: number;
}

/** A piece of furniture or a fitting, where the plan draws it. `facing` is the compass side the piece's front looks to (a bed's foot, a sofa's seat, a WC's seat). */
export interface PieceSpec {
  id: string;
  kind: FurnitureKind;
  /** a catalogue piece: it takes the catalogue's size and heights. Without one, `w` and `d` (the drawing's) are used. */
  catalogId?: string;
  label: string;
  at: Vec2;
  facing: Side;
  w?: number;
  d?: number;
  h?: number;
}

/** A split AC the specification provides a point for: on a wall of a room, `at` along it, `y` above the floor. */
export interface AcSpec { room: string; wall: Side; at: number; y?: number }

export interface AuthoredFlat {
  typeId: string;
  /** the name the flat type carries on the building map and over its doors */
  name: string;
  sceneId: string;
  title: string;
  /** one honest line about where the plan comes from, without naming anybody */
  origin: string;
  /** the stated carpet area, m2, and the tolerance the source states (a fraction) */
  carpetAreaM2: number;
  carpetToleranceFrac: number;
  usableAreaM2?: number;
  /**
   * the source's own north: the compass bearing of the plan's -z direction (up the page). The letter N of a page's compass sits on one side of the rose and that
   * side is north: north to the left of the page puts east up the page (90), north to the right puts west up the page (270).
   */
  northDeg: number;
  /** the side of the compass the source says the plan faces ("facing west": the side the balcony and the main windows, at the bottom of the page, look to) */
  brochureFacing: 'N' | 'E' | 'S' | 'W';
  wallHeightM: number;
  rooms: RoomSpec[];
  openings: OpeningSpec[];
  pieces: PieceSpec[];
  ac?: AcSpec[];
  /** the main door's id and the room it opens into */
  mainDoor: string;
  /** where the walker starts: a point in the entry room */
  spawn: { x: number; z: number; yawDeg: number };
  /** things the plan shows that the scene does not draw, and readings of an ambiguous plan: they go to the scene's extras, word for word */
  notes: string[];
}

// ---------------------------------------------------------------- units

export const FT_M = 0.3048;
export const IN_M = 0.0254;
/** feet and inches to metres: `ft(12, 6)` for 12'6" */
export const ft = (feet: number, inches = 0): number => feet * FT_M + inches * IN_M;
export const printedPlan = (a: number, b: number): Printed => ({ aM: a, bM: b, from: 'plan' });
export const printedTable = (fa: [number, number], fb: [number, number]): Printed => ({ aM: ft(...fa), bM: ft(...fb), from: 'table' });

/** The size tolerance between a printed size and the built one: 2 cm (the plan prints two decimals, the table whole inches). */
export const SIZE_TOL_M = 0.02;

// ---------------------------------------------------------------- polygons from rectangles

interface Seg { a: Vec2; b: Vec2; kind: EdgeKind }
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The outline of touching rectangles, clockwise on the plan (positive area in the scene's frame), starting at the north-west corner. */
export function unionOutline(parts: { x: number; z: number; w: number; d: number }[]): Vec2[] {
  if (parts.length === 1) {
    const p = parts[0];
    return [{ x: r3(p.x), z: r3(p.z) }, { x: r3(p.x + p.w), z: r3(p.z) }, { x: r3(p.x + p.w), z: r3(p.z + p.d) }, { x: r3(p.x), z: r3(p.z + p.d) }];
  }
  const xs = [...new Set(parts.flatMap((p) => [r3(p.x), r3(p.x + p.w)]))].sort((a, b) => a - b);
  const zs = [...new Set(parts.flatMap((p) => [r3(p.z), r3(p.z + p.d)]))].sort((a, b) => a - b);
  const filled = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return parts.some((p) => cx > p.x && cx < p.x + p.w && cz > p.z && cz < p.z + p.d);
  };
  const next = new Map<string, Vec2>();
  const key = (p: Vec2): string => `${p.x},${p.z}`;
  const put = (a: Vec2, b: Vec2): void => { if (next.has(key(a))) throw new Error('rooms.parts: the rectangles pinch at a corner, which is not a room'); next.set(key(a), b); };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (!filled(i, j)) continue;
    const nw = { x: xs[i], z: zs[j] }, ne = { x: xs[i + 1], z: zs[j] }, se = { x: xs[i + 1], z: zs[j + 1] }, sw = { x: xs[i], z: zs[j + 1] };
    if (!filled(i, j - 1)) put(nw, ne);
    if (!filled(i + 1, j)) put(ne, se);
    if (!filled(i, j + 1)) put(se, sw);
    if (!filled(i - 1, j)) put(sw, nw);
  }
  // chain the unit edges from the north-west-most start; edges of a hole would be left over
  const starts = [...next.keys()].map((k) => { const [x, z] = k.split(',').map(Number); return { x, z }; }).sort((a, b) => a.z - b.z || a.x - b.x);
  const out: Vec2[] = [];
  let cur = starts[0];
  do { out.push(cur); cur = next.get(key(cur))!; } while (key(cur) !== key(starts[0]) && out.length < 1000);
  if (out.length < next.size) throw new Error('rooms.parts: the rectangles leave a hole or do not touch');
  // drop collinear points
  const keep = out.filter((p, i) => {
    const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
    return Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 1e-9;
  });
  return keep;
}

// ---------------------------------------------------------------- the layout

const GAP_MAX_M = 0.45;
/** a wall between two rooms thinner than this is reported (the plan draws walls from 6 cm up) */
export const THIN_WALL_M = 0.06;
interface Fac { room: string; a: Vec2; b: Vec2; side: Side }
const sideOf = (a: Vec2, b: Vec2): Side => {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dz) < 1e-9) return dx > 0 ? 'N' : 'S';
  return dz > 0 ? 'E' : 'W';
};
/** the interval along the wall (low to high plan coordinate) where two facing edges overlap, and the gap between them; null when they do not face */
function faceOverlap(e: Seg, f: Seg): { lo: number; hi: number; gap: number } | null {
  const se = sideOf(e.a, e.b), sf = sideOf(f.a, f.b);
  const opp: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  if (sf !== opp[se]) return null;
  const horiz = se === 'N' || se === 'S';
  const pe = horiz ? e.a.z : e.a.x, pf = horiz ? f.a.z : f.a.x;
  // f must lie on the outward side of e
  const gap = (pf - pe) * (se === 'N' || se === 'W' ? -1 : 1);
  if (gap < -0.02 || gap > GAP_MAX_M) return null;
  const e0 = horiz ? Math.min(e.a.x, e.b.x) : Math.min(e.a.z, e.b.z), e1 = horiz ? Math.max(e.a.x, e.b.x) : Math.max(e.a.z, e.b.z);
  const f0 = horiz ? Math.min(f.a.x, f.b.x) : Math.min(f.a.z, f.b.z), f1 = horiz ? Math.max(f.a.x, f.b.x) : Math.max(f.a.z, f.b.z);
  const lo = Math.max(e0, f0), hi = Math.min(e1, f1);
  return hi - lo > 0.05 ? { lo, hi, gap: Math.max(0, gap) } : null;
}

export interface BuiltLayout {
  rooms: RoomTag[];
  openings: Opening[];
  /** the edge each opening spec landed on, for the checks */
  placed: Map<string, { room: string; edge: number; side: Side; lo: number; hi: number }>;
  errors: string[];
}

export function buildLayout(spec: Pick<AuthoredFlat, 'rooms' | 'openings'>): BuiltLayout {
  const errors: string[] = [];
  const outline = new Map<string, Vec2[]>();
  for (const r of spec.rooms) outline.set(r.id, unionOutline(r.parts));
  const segs = new Map<string, Seg[]>();
  for (const r of spec.rooms) {
    const p = outline.get(r.id)!;
    segs.set(r.id, p.map((a, i) => ({ a, b: p[(i + 1) % p.length], kind: 'wall' as EdgeKind })));
  }
  // open stretches: split the edge where the two rooms face each other and mark that stretch 'none', in both rooms
  const openPairs = new Set<string>();
  for (const r of spec.rooms) for (const o of r.openTo ?? []) openPairs.add([r.id, o].sort().join('|'));
  for (const pair of openPairs) {
    const [ida, idb] = pair.split('|');
    if (!segs.has(ida) || !segs.has(idb)) { errors.push(`openTo: "${pair}" names a room that is not in the flat`); continue; }
    for (const [mine, other] of [[ida, idb], [idb, ida]] as const) {
      const out: Seg[] = [];
      let found = false;
      for (const e of segs.get(mine)!) {
        const hits = segs.get(other)!.map((f) => faceOverlap(e, f)).filter((h): h is NonNullable<typeof h> => h !== null && h.gap < 0.02);
        if (hits.length === 0 || e.kind === 'none') { out.push(e); continue; }
        found = true;
        const horiz = sideOf(e.a, e.b) === 'N' || sideOf(e.a, e.b) === 'S';
        const fwd = horiz ? e.b.x > e.a.x : e.b.z > e.a.z;
        const pt = (u: number): Vec2 => (horiz ? { x: u, z: e.a.z } : { x: e.a.x, z: u });
        const cuts = hits.map((h) => [h.lo, h.hi] as [number, number]).sort((a, b) => (fwd ? a[0] - b[0] : b[1] - a[1]));
        let cursor = horiz ? e.a.x : e.a.z;
        for (const [lo, hi] of cuts) {
          const s = fwd ? lo : hi, t = fwd ? hi : lo;
          if (Math.abs(s - cursor) > 1e-6) out.push({ a: pt(cursor), b: pt(s), kind: e.kind });
          out.push({ a: pt(s), b: pt(t), kind: 'none' });
          cursor = t;
        }
        const end = horiz ? e.b.x : e.b.z;
        if (Math.abs(end - cursor) > 1e-6) out.push({ a: pt(cursor), b: e.b, kind: e.kind });
      }
      if (!found) errors.push(`openTo: "${mine}" and "${other}" do not face each other within ${GAP_MAX_M} m, so there is no stretch to open`);
      segs.set(mine, out);
    }
  }
  // balconies: an edge nothing faces is a railing
  const rooms: RoomTag[] = spec.rooms.map((r) => {
    const ss = segs.get(r.id)!;
    const kinds = ss.map((e): EdgeKind => {
      if (e.kind !== 'wall' || r.type !== 'balcony') return e.kind;
      if (r.solidSides?.includes(sideOf(e.a, e.b))) return 'wall';
      const faced = spec.rooms.some((o) => o.id !== r.id && segs.get(o.id)!.some((f) => faceOverlap(e, f)));
      return faced ? 'wall' : 'railing';
    });
    return { id: r.id, roomType: r.type, label: r.label, polygon: ss.map((e) => ({ x: r3(e.a.x), z: r3(e.a.z) })), edges: kinds };
  });
  // openings
  const openings: Opening[] = [];
  const placed: BuiltLayout['placed'] = new Map();
  for (const o of spec.openings) {
    const room = rooms.find((r) => r.id === o.room);
    if (!room) { errors.push(`opening ${o.id}: no room "${o.room}"`); continue; }
    const n = room.polygon.length;
    const half = o.widthM / 2;
    let idx = -1;
    for (let i = 0; i < n && idx < 0; i++) {
      const a = room.polygon[i], b = room.polygon[(i + 1) % n];
      if (sideOf(a, b) !== o.wall) continue;
      const horiz = o.wall === 'N' || o.wall === 'S';
      const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.z, b.z), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
      if (o.at - half >= lo - 0.01 && o.at + half <= hi + 0.01) idx = i;
    }
    if (idx < 0) { errors.push(`opening ${o.id}: no ${o.wall} wall of "${o.room}" runs from ${r3(o.at - half)} to ${r3(o.at + half)}`); continue; }
    if (room.edges[idx] === 'none') { errors.push(`opening ${o.id}: that stretch of "${o.room}" is open already`); continue; }
    const a = room.polygon[idx], b = room.polygon[(idx + 1) % n];
    const horiz = o.wall === 'N' || o.wall === 'S';
    const along = horiz ? (b.x > a.x ? o.at - a.x : a.x - o.at) : (b.z > a.z ? o.at - a.z : a.z - o.at);
    const type: Opening['type'] = o.kind === 'window' ? 'window' : o.kind === 'opening' ? 'opening' : 'door';
    const op: Opening = {
      id: o.id, roomId: room.id, edge: idx, type, centreM: r3(along), widthM: o.widthM,
      sillM: type === 'window' ? (o.sillM ?? 0.9) : 0, headM: o.headM ?? 2.1,
    };
    if (type === 'door') {
      const startSide: Record<Side, Side> = { N: 'W', E: 'N', S: 'E', W: 'S' };
      const hingeAtStart = (o.hinge ?? startSide[o.wall]) === startSide[o.wall];
      const leaf: DoorLeaf = { hinge: hingeAtStart ? 'start' : 'end', swing: o.swing ?? 'in', kind: o.kind === 'sliding' ? 'sliding' : 'hinged' };
      if (!o.hinge && o.kind !== 'sliding') leaf.assumed = true;
      op.leaf = leaf;
    }
    openings.push(op);
    placed.set(o.id, { room: room.id, edge: idx, side: o.wall, lo: o.at - half, hi: o.at + half });
  }
  return { rooms, openings, placed, errors };
}

/** A wall between two rooms (the stretch where their edges face each other) thicker than this is two walls with a void between: a 230 mm double brick wall at most. */
export const MAX_WALL_M = 0.23;
export interface WallGap { a: string; b: string; gapM: number; lengthM: number }
/** The gaps between rooms that face each other across a wall (not the open stretches, which touch). */
export function wallGaps(spec: Pick<AuthoredFlat, 'rooms' | 'openings'>): WallGap[] {
  const built = buildLayout(spec);
  const out: WallGap[] = [];
  const segs = built.rooms.map((r) => r.polygon.map((a, k) => ({ a, b: r.polygon[(k + 1) % r.polygon.length], kind: r.edges[k] })));
  for (let i = 0; i < built.rooms.length; i++) for (let j = i + 1; j < built.rooms.length; j++) {
    for (const e of segs[i]) for (const f of segs[j]) {
      const h = faceOverlap(e, f);
      if (h && h.gap > 0.02) out.push({ a: built.rooms[i].id, b: built.rooms[j].id, gapM: h.gap, lengthM: h.hi - h.lo });
    }
  }
  return out;
}

// ---------------------------------------------------------------- furniture

const KIND_DEFAULTS: Record<FurnitureKind, { h: number; s: number }> = {
  bed: { h: 0.9, s: 0.5 }, sofa: { h: 0.85, s: 0.43 }, dining: { h: 0.95, s: 0.75 }, wardrobe: { h: 2.1, s: 2.1 }, counter: { h: 0.85, s: 0.85 },
};
const YAW_OF: Record<Side, number> = { S: 0, E: 90, N: 180, W: 270 };

export function buildPieces(spec: AuthoredFlat): FurnitureItem[] {
  return spec.pieces.map((p): FurnitureItem => {
    if (p.catalogId) {
      const c = catalogItem(p.catalogId);
      return {
        id: p.id, source: 'real', kind: c.kind, catalogId: p.catalogId, label: p.label || c.name,
        box: { cx: r3(p.at.x), cz: r3(p.at.z), w: c.footprint.w, d: c.footprint.d, yawDeg: YAW_OF[p.facing] },
        heightM: c.heightM, surfaceHeightM: c.surfaceHeightM, ...(c.inner ? { inner: { ...c.inner } } : {}),
      };
    }
    if (p.w === undefined || p.d === undefined) throw new Error(`piece ${p.id}: without a catalogue piece it needs w and d`);
    const k = KIND_DEFAULTS[p.kind];
    return {
      id: p.id, source: 'real', kind: p.kind, label: p.label, box: { cx: r3(p.at.x), cz: r3(p.at.z), w: p.w, d: p.d, yawDeg: YAW_OF[p.facing] },
      heightM: p.h ?? k.h, surfaceHeightM: p.h ?? k.s,
    };
  });
}

// ---------------------------------------------------------------- the checks

export interface FlatReport {
  errors: string[];
  warnings: string[];
  /** each room: id, printed sizes, built sizes (per part), area */
  rooms: { id: string; label: string; parts: { printed: [number, number]; built: [number, number]; from: 'plan' | 'table' }[]; areaM2: number; carpet: boolean }[];
  area: { roomsM2: number; partitionsM2: number; totalM2: number; statedM2: number; deviationFrac: number; toleranceFrac: number; withinTolerance: boolean; usableCheck?: { roomsAndPartitionsM2: number; statedM2: number; deviationFrac: number } };
}

const isCarpet = (r: RoomSpec): boolean => r.carpet ?? !(r.type === 'balcony' || r.finish === 'utility' || r.finish === 'balcony');

export function checkFlat(spec: AuthoredFlat): FlatReport {
  const built = buildLayout(spec);
  const errors = [...built.errors], warnings: string[] = [];
  const nameOf = (id: string): string => spec.rooms.find((r) => r.id === id)?.label ?? id;
  const rooms: FlatReport['rooms'] = [];
  // 1 printed sizes
  for (const r of spec.rooms) {
    const parts = r.parts.map((p) => {
      const printed: [number, number] = [Math.min(p.printed.aM, p.printed.bM), Math.max(p.printed.aM, p.printed.bM)];
      const b: [number, number] = [Math.min(p.w, p.d), Math.max(p.w, p.d)];
      if (Math.abs(printed[0] - b[0]) > SIZE_TOL_M || Math.abs(printed[1] - b[1]) > SIZE_TOL_M) {
        errors.push(`${r.label}: printed ${printed[0].toFixed(2)} x ${printed[1].toFixed(2)} m (${p.printed.from}), built ${b[0].toFixed(2)} x ${b[1].toFixed(2)} m, more than 2 cm apart`);
      }
      return { printed, built: b, from: p.printed.from };
    });
    const room = built.rooms.find((x) => x.id === r.id)!;
    rooms.push({ id: r.id, label: r.label, parts, areaM2: Math.abs(polygonArea(room.polygon)), carpet: isCarpet(r) });
  }
  // a wall between two rooms of the flat is one wall, 230 mm at the most: more is two walls with a void between
  for (const g of wallGaps(spec)) if (g.gapM > MAX_WALL_M + 1e-9 && g.lengthM > 0.5) warnings.push(`${nameOf(g.a)} and ${nameOf(g.b)} are ${(g.gapM * 100).toFixed(0)} cm apart over ${g.lengthM.toFixed(1)} m: two walls with a void between, not one`);
  // 2 overlaps (the rooms of one flat may touch, not overlap)
  for (let i = 0; i < built.rooms.length; i++) for (let j = i + 1; j < built.rooms.length; j++) {
    const ov = overlapAreaM2(built.rooms[i].polygon, built.rooms[j].polygon);
    if (ov > 0.02) errors.push(`${built.rooms[i].label} and ${built.rooms[j].label} overlap by ${ov.toFixed(2)} m2`);
  }
  // a gap between two rooms that are not open to each other is a wall: it must be a believable wall
  // 3 openings: a window is on an outside wall, a door has somewhere to go
  const roomAcross = (id: string, p: { room: string; edge: number }, from: 'door' | 'window'): string | null => {
    const room = built.rooms.find((r) => r.id === p.room)!;
    const a = room.polygon[p.edge], b = room.polygon[(p.edge + 1) % room.polygon.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const out = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
    const o = built.openings.find((q) => q.id === id)!;
    const c = { x: a.x + ((b.x - a.x) / len) * o.centreM, z: a.z + ((b.z - a.z) / len) * o.centreM };
    for (const d of from === 'door' ? [0.15, 0.3, 0.45] : [0.15, 0.3, 0.45]) {
      const q = { x: c.x + out.x * d, z: c.z + out.z * d };
      const hit = built.rooms.find((r) => r.id !== p.room && pointInPolygon(q, r.polygon));
      if (hit) return hit.id;
    }
    return null;
  };
  const link = new Map<string, Set<string>>();
  const join = (a: string, b: string): void => { (link.get(a) ?? link.set(a, new Set()).get(a)!).add(b); (link.get(b) ?? link.set(b, new Set()).get(b)!).add(a); };
  for (const r of spec.rooms) link.set(r.id, link.get(r.id) ?? new Set());
  for (const r of spec.rooms) for (const o of r.openTo ?? []) join(r.id, o);
  for (const o of spec.openings) {
    const p = built.placed.get(o.id);
    if (!p) continue;
    const across = roomAcross(o.id, p, o.kind === 'window' ? 'window' : 'door');
    if (o.kind === 'window' && across) errors.push(`window ${o.id} of ${nameOf(o.room)} looks into ${nameOf(across)}, not outside`);
    if (o.kind !== 'window' && across) join(o.room, across);
  }
  // the openings of one wall do not overlap
  for (let i = 0; i < spec.openings.length; i++) for (let j = i + 1; j < spec.openings.length; j++) {
    const a = built.placed.get(spec.openings[i].id), b = built.placed.get(spec.openings[j].id);
    if (a && b && a.room === b.room && a.edge === b.edge && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.02) errors.push(`${spec.openings[i].id} and ${spec.openings[j].id} overlap on one wall of ${nameOf(a.room)}`);
  }
  // 4 the main door is on an outside wall and every room is walkable from it
  const main = spec.openings.find((o) => o.id === spec.mainDoor);
  const mp = built.placed.get(spec.mainDoor);
  if (!main || !mp) errors.push(`the main door "${spec.mainDoor}" is not an opening of the flat`);
  else {
    if (main.kind !== 'door') errors.push('the main door must be a door');
    if (roomAcross(spec.mainDoor, mp, 'door')) errors.push(`the main door opens into another room of the flat, not outside`);
    const seen = new Set<string>([main.room]);
    const q = [main.room];
    while (q.length) for (const n of link.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    for (const r of spec.rooms) if (!seen.has(r.id)) errors.push(`${r.label} cannot be reached from the main door`);
  }
  // 5 furniture is inside one room, and not outside any wall
  for (const f of buildPieces(spec)) {
    const cs = boxCorners(f.box);
    // every corner is in a room (a table may stand across two rooms that are open to each other, a living and a dining room)
    const inside = cs.every((c) => built.rooms.some((r) => pointInPolygon(c, r.polygon) || nearPolygon(c, r.polygon, 0.03)));
    if (!inside) warnings.push(`${f.id} (${f.label}) is not inside the rooms`);
  }
  // 6 the carpet area: the rooms the brochure counts, plus the partition walls between them (RERA carpet area includes the area under internal walls)
  // the walls of the flat's inside count (RERA carpet area includes the area under internal partition walls, utility walls too); a balcony's wall is an outside wall
  const insideIds = new Set(spec.rooms.filter((r) => r.type !== 'balcony').map((r) => r.id));
  const roomsM2 = rooms.filter((r) => r.carpet).reduce((s, r) => s + r.areaM2, 0);
  const partitions = (ids: Set<string>): number => {
    let s = 0;
    const rs = built.rooms.filter((r) => ids.has(r.id));
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const ea = rs[i].polygon.map((a, k) => ({ a, b: rs[i].polygon[(k + 1) % rs[i].polygon.length], kind: 'wall' as EdgeKind }));
      const eb = rs[j].polygon.map((a, k) => ({ a, b: rs[j].polygon[(k + 1) % rs[j].polygon.length], kind: 'wall' as EdgeKind }));
      for (const e of ea) for (const f of eb) {
        const h = faceOverlap(e, f);
        if (!h) continue;
        s += (h.hi - h.lo) * h.gap;
        // a wall thinner than this is not a wall (rooms that touch are open to each other, or the check of the flat would have said so)
        if (h.gap > 0.02 && h.gap < THIN_WALL_M) warnings.push(`${rs[i].label} and ${rs[j].label} are ${(h.gap * 100).toFixed(0)} cm apart: a wall thinner than ${THIN_WALL_M * 100} cm`);
      }
    }
    return s;
  };
  const partitionsM2 = partitions(insideIds);
  const total = roomsM2 + partitionsM2;
  const dev = (total - spec.carpetAreaM2) / spec.carpetAreaM2;
  const area: FlatReport['area'] = {
    roomsM2, partitionsM2, totalM2: total, statedM2: spec.carpetAreaM2, deviationFrac: dev, toleranceFrac: spec.carpetToleranceFrac,
    withinTolerance: Math.abs(dev) <= spec.carpetToleranceFrac,
  };
  if (!area.withinTolerance) errors.push(`rooms ${roomsM2.toFixed(2)} m2 + partitions ${partitionsM2.toFixed(2)} m2 = ${total.toFixed(2)} m2 is ${(dev * 100).toFixed(1)} % from the stated carpet area ${spec.carpetAreaM2} m2 (tolerance ${(spec.carpetToleranceFrac * 100).toFixed(0)} %)`);
  if (spec.usableAreaM2) {
    const all = new Set(spec.rooms.map((r) => r.id));
    const u = rooms.reduce((s, r) => s + r.areaM2, 0) + partitions(all);
    area.usableCheck = { roomsAndPartitionsM2: u, statedM2: spec.usableAreaM2, deviationFrac: (u - spec.usableAreaM2) / spec.usableAreaM2 };
  }
  return { errors, warnings, rooms, area };
}

function nearPolygon(p: Vec2, poly: Vec2[], tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    if (Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) <= tol) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the scene

/** A scene is never built from a spec the checks refuse. */
export function buildFlatScene(spec: AuthoredFlat, updatedAt: string): { property: PropertyFile; report: FlatReport; built: BuiltLayout } {
  const report = checkFlat(spec);
  if (report.errors.length > 0) throw new Error(`${spec.sceneId} does not follow its printed numbers:\n  ${report.errors.join('\n  ')}`);
  const built = buildLayout(spec);
  const layout: Layout = {
    wallHeightM: spec.wallHeightM, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: built.rooms, openings: built.openings,
    finishes: { ...DEFAULT_FINISHES, tile: DEFAULT_FINISHES.tile ? { ...DEFAULT_FINISHES.tile } : null }, scaleSource: 'typed-sizes',
  };
  const property: PropertyFile = {
    version: 1, id: spec.sceneId, title: spec.title, layout, furniture: clearRoutes(layout, buildPieces(spec), spec.spawn).furniture, spawn: { ...spec.spawn }, unlisted: true, spaceKind: 'home', updatedAt,
  };
  return { property, report, built };
}

export { DIR as SIDE_DIR, EDGE_OF as SIDE_EDGE };
