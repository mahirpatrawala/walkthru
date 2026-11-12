// Owned by C1. SPEC 5.5: layout validation, room normalisation, property.json validation.
import { DEFAULT_FINISHES } from '../types';
import type {
  EdgeKind, Finishes, FurnitureItem, Layout, Opening, OpeningType, PlanUnderlay, PropertyFile, RoomTag, RoomType, Vec2,
} from '../types';
import { polygonArea, polygonSelfIntersects, pointInPolygon } from './geometry';
import { computeEdgeFrames, computeTunnels } from './layout-geom';

// ---------------------------------------------------------------- polygon overlap (exact, via triangles)

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/** Ear clipping for a simple polygon. Triangles come out with positive orientation (cross > 0). */
function triangulate(p: Vec2[]): Vec2[][] {
  const idx = p.map((_, i) => i);
  if (polygonArea(p) < 0) idx.reverse();
  const tris: Vec2[][] = [];
  const inTri = (q: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean =>
    cross(b.x - a.x, b.z - a.z, q.x - a.x, q.z - a.z) >= -1e-12 &&
    cross(c.x - b.x, c.z - b.z, q.x - b.x, q.z - b.z) >= -1e-12 &&
    cross(a.x - c.x, a.z - c.z, q.x - c.x, q.z - c.z) >= -1e-12;
  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.z === b.z;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    const n = idx.length;
    let cut = -1;
    let collinear = -1;
    for (let k = 0; k < n; k++) {
      const a = p[idx[(k + n - 1) % n]];
      const b = p[idx[k]];
      const c = p[idx[(k + 1) % n]];
      const o = cross(b.x - a.x, b.z - a.z, c.x - b.x, c.z - b.z);
      if (Math.abs(o) <= 1e-12) { if (collinear < 0) collinear = k; continue; }
      if (o < 0) continue;
      let ok = true;
      for (const j of idx) {
        const q = p[j];
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        if (inTri(q, a, b, c)) { ok = false; break; }
      }
      if (ok) { cut = k; break; }
    }
    if (cut >= 0) {
      const n2 = idx.length;
      tris.push([p[idx[(cut + n2 - 1) % n2]], p[idx[cut]], p[idx[(cut + 1) % n2]]]);
      idx.splice(cut, 1);
    } else if (collinear >= 0) {
      idx.splice(collinear, 1);
    } else break;
  }
  if (idx.length === 3) tris.push([p[idx[0]], p[idx[1]], p[idx[2]]]);
  return tris;
}

/** Sutherland-Hodgman: `subject` clipped to the convex positive-orientation `clip` triangle. */
function clipArea(subject: Vec2[], clip: Vec2[]): number {
  let poly = subject;
  for (let i = 0; i < clip.length && poly.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (q: Vec2): number => cross(b.x - a.x, b.z - a.z, q.x - a.x, q.z - a.z);
    const next: Vec2[] = [];
    for (let k = 0; k < poly.length; k++) {
      const cur = poly[k];
      const prev = poly[(k + poly.length - 1) % poly.length];
      const sc = side(cur);
      const sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) next.push(lerp(prev, cur, sp / (sp - sc)));
        next.push(cur);
      } else if (sp >= 0) {
        next.push(lerp(prev, cur, sp / (sp - sc)));
      }
    }
    poly = next;
  }
  return Math.abs(polygonArea(poly));
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function overlapAreaM2(a: Vec2[], b: Vec2[]): number {
  const bb = (p: Vec2[]) => ({
    x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)),
    z0: Math.min(...p.map((q) => q.z)), z1: Math.max(...p.map((q) => q.z)),
  });
  const A = bb(a);
  const B = bb(b);
  if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.z1 <= B.z0 || B.z1 <= A.z0) return 0;
  const ta = triangulate(a);
  const tb = triangulate(b);
  let s = 0;
  for (const x of ta) for (const y of tb) s += clipArea(x, y);
  return s;
}

// ---------------------------------------------------------------- validateLayout

const num = (v: number): string => String(+v.toFixed(2));

export function validateLayout(layout: Layout): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (r: RoomTag): string => r.label || r.id;

  const valid = new Set<string>();
  for (const r of layout.rooms) {
    let ok = true;
    if (r.polygon.length < 3) {
      errors.push(`${name(r)} has fewer than 3 corners.`);
      continue;
    }
    const area = polygonArea(r.polygon);
    if (Math.abs(area) < 1e-6) { errors.push(`${name(r)} has no area.`); ok = false; }
    else if (area < 0) {
      // SPEC-GAP: 5.5 lists no error for a clockwise polygon, but every algorithm assumes positive area.
      errors.push(`${name(r)} is drawn the wrong way round (negative area). Run normalizeRoom on it.`);
      ok = false;
    }
    if (polygonSelfIntersects(r.polygon)) { errors.push(`${name(r)} crosses itself.`); ok = false; }
    if (r.edges.length !== r.polygon.length) {
      errors.push(`${name(r)} has ${r.edges.length} edge kinds for ${r.polygon.length} corners.`);
      ok = false;
    }
    if (ok) valid.add(r.id);
  }

  // overlapping interiors
  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      const a = layout.rooms[i];
      const b = layout.rooms[j];
      if (!valid.has(a.id) || !valid.has(b.id)) continue;
      const ov = overlapAreaM2(a.polygon, b.polygon);
      if (ov > 0.05) errors.push(`${name(a)} and ${name(b)} overlap by ${num(ov)} m². Leave the wall thickness as a gap between rooms.`);
    }
  }

  // openings
  for (const o of layout.openings) {
    const room = layout.rooms.find((r) => r.id === o.roomId);
    if (!room) { errors.push(`Opening ${o.id} is on a room that does not exist (${o.roomId}).`); continue; }
    const n = room.polygon.length;
    if (!Number.isInteger(o.edge) || o.edge < 0 || o.edge >= n) {
      errors.push(`Opening ${o.id} is on edge ${o.edge}, which ${name(room)} does not have.`);
      continue;
    }
    const a = room.polygon[o.edge];
    const b = room.polygon[(o.edge + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (o.centreM - o.widthM / 2 < -1e-6 || o.centreM + o.widthM / 2 > len + 1e-6) {
      errors.push(`Opening ${o.id} runs past the end of its wall (${num(len)} m long) in ${name(room)}.`);
    }
    if (o.type === 'door' && (o.widthM < 0.6 || o.widthM > 1.2)) {
      warnings.push(`Door ${num(o.widthM)} m wide. Check the scale.`);
    }
  }

  // rooms: size and a way out
  const goodRooms = layout.rooms.filter((r) => r.polygon.length >= 3 && r.edges.length === r.polygon.length);
  for (const r of goodRooms) {
    const area = Math.abs(polygonArea(r.polygon));
    if (area > 0 && area < 1.5) warnings.push(`${name(r)} is only ${num(area)} m². Check the scale.`);
    if (area > 60) warnings.push(`${name(r)} is ${num(area)} m². Check the scale.`);
  }
  if (goodRooms.length > 0 && goodRooms.every((r) => valid.has(r.id))) {
    const served = new Set<string>();
    const frames = computeEdgeFrames(layout);
    for (const t of computeTunnels(layout)) {
      if (!t.passable) continue;
      served.add(t.roomId);
      // the room on the far side is served too: probe a point just past the hole
      const f = frames.find((q) => q.roomId === t.roomId && q.edge === t.edge);
      if (!f) continue;
      const um = (t.u0 + t.u1) / 2;
      const o = t.depth + 0.03;
      const probe = { x: f.a.x + f.dir.x * um + f.out.x * o, z: f.a.z + f.dir.z * um + f.out.z * o };
      for (const r of goodRooms) if (r.id !== t.roomId && pointInPolygon(probe, r.polygon)) served.add(r.id);
    }
    for (const r of goodRooms) if (!served.has(r.id)) warnings.push(`${name(r)} has no door or opening, so nobody can walk in.`);
  }

  if (layout.wallHeightM < 2.4 || layout.wallHeightM > 3.6) {
    warnings.push(`Wall height ${num(layout.wallHeightM)} m is unusual. Usually 2.75 to 3.0 m.`);
  }
  if (layout.underlay && layout.underlay.disagreementPct > 3) {
    warnings.push(`The plan dimensions disagree by ${num(layout.underlay.disagreementPct)}%. Check what you typed, or the plan image may be stretched.`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------- normalizeRoom

/**
 * Positive signed area (3.1). A negative-area polygon is reversed, and `edges` is remapped so that each
 * segment keeps its kind: new edge i runs polygon'[i] -> polygon'[i+1] = old p[n-1-i] -> p[n-2-i], i.e. old edge n-2-i.
 */
export function normalizeRoom(room: RoomTag): RoomTag {
  const n = room.polygon.length;
  if (n < 3 || polygonArea(room.polygon) >= 0) return room;
  return {
    ...room,
    polygon: [...room.polygon].reverse().map((p) => ({ ...p })),
    edges: room.polygon.map((_, i) => room.edges[(((n - 2 - i) % n) + n) % n] ?? 'wall'),
  };
}

// ---------------------------------------------------------------- property files

export function createEmptyProperty(id: string): PropertyFile {
  return {
    version: 1,
    id,
    title: id,
    layout: {
      wallHeightM: 2.75,
      wallThicknessM: 0.12,
      railingHeightM: 1.1,
      rooms: [],
      openings: [],
      finishes: { ...DEFAULT_FINISHES, tile: DEFAULT_FINISHES.tile ? { ...DEFAULT_FINISHES.tile } : null },
      scaleSource: 'typed-sizes',
    },
    furniture: [],
    spawn: { x: 0, z: 0, yawDeg: 0 },
    updatedAt: new Date().toISOString(),
  };
}

class Bad extends Error {}
const fail = (path: string, what: string): never => { throw new Bad(`property.json: ${path} ${what}.`); };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function numAt(o: Record<string, unknown>, k: string, path: string, fallback?: number): number {
  const v = o[k];
  if (v === undefined && fallback !== undefined) return fallback;
  return isNum(v) ? v : fail(`${path}.${k}`, 'must be a number');
}
function strAt(o: Record<string, unknown>, k: string, path: string, fallback?: string): string {
  const v = o[k];
  if (v === undefined && fallback !== undefined) return fallback;
  return isStr(v) ? v : fail(`${path}.${k}`, 'must be text');
}
function arrAt(o: Record<string, unknown>, k: string, path: string): unknown[] {
  const v = o[k];
  return Array.isArray(v) ? v : fail(`${path}.${k}`, 'must be a list');
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  return allowed.includes(v as T) ? (v as T) : fail(path, `must be one of ${allowed.join(', ')}`);
}

const ROOM_TYPES: readonly RoomType[] = ['bedroom', 'living', 'kitchen', 'bathroom', 'balcony', 'other'];
const EDGE_KINDS: readonly EdgeKind[] = ['wall', 'railing', 'none'];
const OPENING_TYPES: readonly OpeningType[] = ['door', 'opening', 'window'];
const FURNITURE_KINDS = ['bed', 'sofa', 'dining', 'wardrobe', 'counter'] as const;

function parseRoom(v: unknown, path: string): RoomTag {
  if (!isObj(v)) return fail(path, 'must be an object');
  const polyRaw = arrAt(v, 'polygon', path);
  if (polyRaw.length < 3) fail(`${path}.polygon`, 'needs at least 3 points');
  const polygon = polyRaw.map((p, i): Vec2 => {
    if (!isObj(p) || !isNum(p.x) || !isNum(p.z)) return fail(`${path}.polygon[${i}]`, 'must be {x, z} numbers');
    return { x: p.x as number, z: p.z as number };
  });
  const edgesRaw = arrAt(v, 'edges', path);
  if (edgesRaw.length !== polygon.length) fail(`${path}.edges`, `has ${edgesRaw.length} entries for ${polygon.length} corners`);
  const room: RoomTag = {
    id: strAt(v, 'id', path),
    roomType: oneOf(v.roomType, ROOM_TYPES, `${path}.roomType`),
    label: strAt(v, 'label', path, ''),
    polygon,
    edges: edgesRaw.map((e, i) => oneOf(e, EDGE_KINDS, `${path}.edges[${i}]`)),
  };
  if (isStr(v.wallColor)) room.wallColor = v.wallColor;
  if (isStr(v.floorColor)) room.floorColor = v.floorColor;
  return room;
}

function parseOpening(v: unknown, path: string): Opening {
  if (!isObj(v)) return fail(path, 'must be an object');
  return {
    id: strAt(v, 'id', path),
    roomId: strAt(v, 'roomId', path),
    edge: numAt(v, 'edge', path),
    type: oneOf(v.type, OPENING_TYPES, `${path}.type`),
    centreM: numAt(v, 'centreM', path),
    widthM: numAt(v, 'widthM', path),
    sillM: numAt(v, 'sillM', path, 0),
    headM: numAt(v, 'headM', path),
  };
}

function parseFinishes(v: unknown, path: string): Finishes {
  const out: Finishes = { ...DEFAULT_FINISHES, tile: DEFAULT_FINISHES.tile ? { ...DEFAULT_FINISHES.tile } : null };
  if (v === undefined) return out;
  if (!isObj(v)) return fail(path, 'must be an object');
  for (const k of ['wallColor', 'floorColor', 'groutColor', 'frameColor', 'ceilingColor', 'railingColor'] as const) {
    if (v[k] !== undefined) out[k] = strAt(v, k, path);
  }
  if (v.tile === null) out.tile = null;
  else if (isObj(v.tile)) out.tile = { wM: numAt(v.tile, 'wM', `${path}.tile`), lM: numAt(v.tile, 'lM', `${path}.tile`) };
  else if (v.tile !== undefined) fail(`${path}.tile`, 'must be {wM, lM} or null');
  if (v.source === 'default' || v.source === 'sampled') out.source = v.source;
  return out;
}

function parseFurniture(v: unknown, path: string): FurnitureItem {
  if (!isObj(v)) return fail(path, 'must be an object');
  if (!isObj(v.box)) return fail(`${path}.box`, 'must be an object');
  const box = {
    cx: numAt(v.box, 'cx', `${path}.box`), cz: numAt(v.box, 'cz', `${path}.box`),
    w: numAt(v.box, 'w', `${path}.box`), d: numAt(v.box, 'd', `${path}.box`),
    yawDeg: numAt(v.box, 'yawDeg', `${path}.box`),
  };
  const item: FurnitureItem = {
    id: strAt(v, 'id', path),
    source: oneOf(v.source, ['real', 'virtual'] as const, `${path}.source`),
    kind: oneOf(v.kind, FURNITURE_KINDS, `${path}.kind`),
    label: strAt(v, 'label', path, ''),
    box,
    heightM: numAt(v, 'heightM', path),
    surfaceHeightM: numAt(v, 'surfaceHeightM', path),
  };
  if (isStr(v.catalogId)) item.catalogId = v.catalogId;
  if (isObj(v.inner) && isNum(v.inner.w) && isNum(v.inner.d)) item.inner = { w: v.inner.w, d: v.inner.d };
  return item;
}

/**
 * Parses and checks a property.json. Throws an Error with a readable message. Missing optional parts
 * (finishes, furniture, updatedAt) are defaulted; rooms drawn clockwise are normalised, and the openings on
 * them are remapped so they stay where they were drawn.
 */
export function validateProperty(json: unknown): PropertyFile {
  if (!isObj(json)) return fail('the file', 'must be a JSON object');
  if (json.version !== 1) fail('version', 'must be 1');
  const id = strAt(json, 'id', 'property');
  const lay = json.layout;
  if (!isObj(lay)) return fail('layout', 'is missing');

  const rooms: RoomTag[] = [];
  const flipped = new Map<string, number>();
  arrAt(lay, 'rooms', 'layout').forEach((r, i) => {
    const parsed = parseRoom(r, `layout.rooms[${i}]`);
    const norm = normalizeRoom(parsed);
    if (norm !== parsed) flipped.set(parsed.id, parsed.polygon.length);
    rooms.push(norm);
  });
  const openings = arrAt(lay, 'openings', 'layout').map((o, i) => {
    const op = parseOpening(o, `layout.openings[${i}]`);
    const n = flipped.get(op.roomId);
    if (n !== undefined && Number.isInteger(op.edge) && op.edge >= 0 && op.edge < n) {
      const room = rooms.find((r) => r.id === op.roomId)!;
      // the same segment now runs the other way, and is edge n-2-edge
      const newEdge = (((n - 2 - op.edge) % n) + n) % n;
      const a = room.polygon[newEdge];
      const b = room.polygon[(newEdge + 1) % n];
      return { ...op, edge: newEdge, centreM: Math.hypot(b.x - a.x, b.z - a.z) - op.centreM };
    }
    return op;
  });

  const layout: Layout = {
    wallHeightM: numAt(lay, 'wallHeightM', 'layout', 2.75),
    wallThicknessM: numAt(lay, 'wallThicknessM', 'layout', 0.12),
    railingHeightM: numAt(lay, 'railingHeightM', 'layout', 1.1),
    rooms,
    openings,
    finishes: parseFinishes(lay.finishes, 'layout.finishes'),
    scaleSource: oneOf(lay.scaleSource ?? 'typed-sizes', ['plan-dimensions', 'typed-sizes', 'scan'] as const, 'layout.scaleSource'),
  };
  if (lay.underlay !== undefined) {
    const u = lay.underlay;
    if (!isObj(u) || !isObj(u.originPx)) return fail('layout.underlay', 'must be an object with originPx');
    layout.underlay = {
      file: strAt(u, 'file', 'layout.underlay'),
      pxPerM: numAt(u, 'pxPerM', 'layout.underlay'),
      originPx: { x: numAt(u.originPx, 'x', 'layout.underlay.originPx'), y: numAt(u.originPx, 'y', 'layout.underlay.originPx') },
      dimensions: Array.isArray(u.dimensions) ? (u.dimensions as PlanUnderlay['dimensions']) : [],
      disagreementPct: numAt(u, 'disagreementPct', 'layout.underlay', 0),
    };
    if (!(layout.underlay.pxPerM > 0)) fail('layout.underlay.pxPerM', 'must be above 0');
  }

  const furniture = json.furniture === undefined ? [] : arrAt(json, 'furniture', 'property').map((f, i) => parseFurniture(f, `furniture[${i}]`));
  const sp = json.spawn;
  const spawn = isObj(sp)
    ? { x: numAt(sp, 'x', 'spawn'), z: numAt(sp, 'z', 'spawn'), yawDeg: numAt(sp, 'yawDeg', 'spawn', 0) }
    : fail('spawn', 'must be {x, z, yawDeg}');

  const out: PropertyFile = {
    version: 1,
    id,
    title: strAt(json, 'title', 'property', id),
    layout,
    furniture,
    spawn,
    updatedAt: strAt(json, 'updatedAt', 'property', new Date().toISOString()),
  };
  if (isStr(json.subtitle)) out.subtitle = json.subtitle;
  if (json.splat !== undefined) {
    const s = json.splat;
    if (!isObj(s) || !isStr(s.file) || !isObj(s.transform)) return fail('splat', 'must have file and transform');
    const t = s.transform;
    if (!Array.isArray(t.rotation) || t.rotation.length !== 4 || !t.rotation.every(isNum)) fail('splat.transform.rotation', 'must be 4 numbers');
    if (!Array.isArray(t.position) || t.position.length !== 3 || !t.position.every(isNum)) fail('splat.transform.position', 'must be 3 numbers');
    out.splat = {
      file: s.file,
      format: oneOf(s.format, ['ply', 'spz', 'splat'] as const, 'splat.format'),
      upPreset: oneOf(s.upPreset, ['as-is', 'flip-x', 'z-up', 'manual'] as const, 'splat.upPreset'),
      transform: {
        rotation: t.rotation as [number, number, number, number],
        scale: numAt(t, 'scale', 'splat.transform'),
        position: t.position as [number, number, number],
      },
      mode: oneOf(s.mode ?? 'overlay', ['overlay', 'replace'] as const, 'splat.mode'),
    };
  }
  return out;
}
