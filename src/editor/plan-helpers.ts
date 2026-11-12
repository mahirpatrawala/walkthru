// Owned by C5. Pure helpers behind the plan canvas and steps E2 to E4 (no DOM, no three).
// Factored out so the headless tests can drive exactly what the editor drives (SPEC 9, C5 acceptance).
import type { EdgeKind, Layout, Opening, OpeningType, PropertyFile, RoomTag, RoomType, Vec2 } from '../types';
import { distanceToSegment } from '../core/geometry';
import { defaultEdges } from '../core/layout-geom';
import { normalizeRoom } from '../core/layout-validate';
import { formatArea, formatFtIn } from '../core/units';

// ---------------------------------------------------------------- snapping (2.2 E3)

export const SNAP_PX = 8;
export const GRID_SNAP_M = 0.05;

export interface SnapOptions {
  rooms: RoomTag[];
  /** current zoom: screen pixels per world metre */
  pxPerMetre: number;
  /** a floor-plan image is showing: no grid snapping, the image is the ruler */
  hasUnderlay: boolean;
  /** extra corners to snap to, e.g. the points of the polygon being drawn */
  extraPoints?: Vec2[];
  /** override the 8 px radius */
  radiusPx?: number;
}
export interface SnapResult { point: Vec2; kind: 'corner' | 'edge' | 'grid' | 'none' }

function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 === 0) return { x: a.x, z: a.z };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/**
 * // SPEC-GAP: 2.2 E3 fixes the snap radius at 8 screen px and also says to leave the wall thickness as a gap between rooms.
 * // At low zoom a 12 cm wall is under 8 px, so a corner traced next to a neighbour snaps ONTO it and the gap closes (3 cm walls,
 * // see 12.8). Smallest fix: the radius stays 8 px, Alt turns snapping off, and the rooms panel tells the broker to zoom in.
 * Snaps to an existing corner within 8 screen px, else to an existing edge within 8 screen px, else (only when there
 * is no plan image) to the 5 cm grid. With a plan image and nothing close, the point is returned unchanged.
 */
export function snapPoint(p: Vec2, o: SnapOptions): SnapResult {
  const r = (o.radiusPx ?? SNAP_PX) / Math.max(1e-9, o.pxPerMetre);
  let best: Vec2 | null = null;
  let bestD = r;
  const consider = (c: Vec2): void => {
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d <= bestD) { bestD = d; best = c; }
  };
  for (const room of o.rooms) for (const c of room.polygon) consider(c);
  for (const c of o.extraPoints ?? []) consider(c);
  if (best) return { point: { x: (best as Vec2).x, z: (best as Vec2).z }, kind: 'corner' };

  let edgeBest: Vec2 | null = null;
  let edgeD = r;
  for (const room of o.rooms) {
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % n];
      const d = distanceToSegment(p, a, b);
      if (d <= edgeD) { edgeD = d; edgeBest = projectOnSegment(p, a, b); }
    }
  }
  if (edgeBest) return { point: edgeBest, kind: 'edge' };

  if (!o.hasUnderlay) {
    const g = GRID_SNAP_M;
    return { point: { x: Math.round(p.x / g) * g, z: Math.round(p.z / g) * g }, kind: 'grid' };
  }
  return { point: { x: p.x, z: p.z }, kind: 'none' };
}

// ---------------------------------------------------------------- ids and labels

export function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  let n = 1;
  for (const id of existing) {
    const m = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
  }
  let id = `${prefix}-${n}`;
  while (used.has(id)) id = `${prefix}-${++n}`;
  return id;
}

export const ROOM_TYPE_NAMES: Record<RoomType, string> = {
  bedroom: 'Bedroom', living: 'Living', kitchen: 'Kitchen', bathroom: 'Bathroom', balcony: 'Balcony', other: 'Other',
};

/** "Bedroom 1", "Bedroom 2", ... counting only default-style labels of the same type. "Other" becomes "Room N". */
export function defaultLabel(type: RoomType, rooms: RoomTag[]): string {
  const base = type === 'other' ? 'Room' : ROOM_TYPE_NAMES[type];
  let n = 1;
  const taken = new Set(rooms.map((r) => r.label));
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function isDefaultLabel(label: string): boolean {
  return /^(Bedroom|Living|Kitchen|Bathroom|Balcony|Room) \d+$/.test(label);
}

// ---------------------------------------------------------------- rooms

/** A rectangle whose first corner is `c1`, with positive signed area. Corners run c1, then along x, then c2, then along z. */
export function rectPolygon(c1: Vec2, c2: Vec2): Vec2[] {
  const a = { x: c1.x, z: c1.z };
  const b = { x: c2.x, z: c1.z };
  const c = { x: c2.x, z: c2.z };
  const d = { x: c1.x, z: c2.z };
  const dx = c2.x - c1.x;
  const dz = c2.z - c1.z;
  return dx * dz >= 0 ? [a, b, c, d] : [a, d, c, b];
}

export interface RectInfo { origin: Vec2; w: number; l: number; sx: 1 | -1; sz: 1 | -1; xFirst: boolean }

/** Reads an axis-aligned rectangle (4 corners). `w` is the x extent and `l` the z extent. Null for anything else. */
export function rectInfo(room: RoomTag): RectInfo | null {
  const p = room.polygon;
  if (p.length !== 4) return null;
  const eps = 1e-6;
  const xFirst = Math.abs(p[1].z - p[0].z) < eps && Math.abs(p[3].x - p[0].x) < eps;
  const zFirst = Math.abs(p[1].x - p[0].x) < eps && Math.abs(p[3].z - p[0].z) < eps;
  if (!xFirst && !zFirst) return null;
  if (!(Math.abs(p[2].x - (xFirst ? p[1].x : p[3].x)) < eps && Math.abs(p[2].z - (xFirst ? p[3].z : p[1].z)) < eps)) return null;
  const dx = p[2].x - p[0].x;
  const dz = p[2].z - p[0].z;
  if (Math.abs(dx) < eps || Math.abs(dz) < eps) return null;
  return { origin: { x: p[0].x, z: p[0].z }, w: Math.abs(dx), l: Math.abs(dz), sx: dx >= 0 ? 1 : -1, sz: dz >= 0 ? 1 : -1, xFirst };
}

/**
 * Resizes a rectangle from a typed size about its first corner (polygon[0]); the other three corners move, the
 * corner order is kept (so edge kinds stay with their sides). `w` is the x extent, `l` the z extent.
 */
export function resizeRect(room: RoomTag, w: number, l: number): RoomTag | null {
  const info = rectInfo(room);
  if (!info || !(w > 0) || !(l > 0)) return null;
  const o = info.origin;
  const far = { x: o.x + info.sx * w, z: o.z + info.sz * l };
  const alongX = { x: far.x, z: o.z };
  const alongZ = { x: o.x, z: far.z };
  const polygon = info.xFirst ? [{ ...o }, alongX, far, alongZ] : [{ ...o }, alongZ, far, alongX];
  return { ...room, polygon };
}

/** A new room with the default edge kinds (the balcony rule) and an id and label that do not clash. */
export function makeRoom(layout: Layout, polygon: Vec2[], roomType: RoomType, label?: string): RoomTag {
  const draft: RoomTag = {
    id: nextId('room', layout.rooms.map((r) => r.id)),
    roomType,
    label: label ?? defaultLabel(roomType, layout.rooms),
    polygon: polygon.map((p) => ({ x: p.x, z: p.z })),
    edges: polygon.map(() => 'wall' as EdgeKind),
  };
  const room = normalizeRoom(draft);
  return { ...room, edges: defaultEdges(room, layout.rooms) };
}

/** Changes a room's type; edges follow the balcony rule only when they were still the defaults. */
export function retypeRoom(layout: Layout, room: RoomTag, type: RoomType): RoomTag {
  const others = layout.rooms.filter((r) => r.id !== room.id);
  const was = defaultEdges(room, others);
  const untouched = was.length === room.edges.length && was.every((k, i) => k === room.edges[i]);
  const next: RoomTag = { ...room, roomType: type };
  if (isDefaultLabel(room.label)) next.label = defaultLabel(type, others);
  if (untouched) next.edges = defaultEdges(next, others);
  return next;
}

const KIND_CYCLE: EdgeKind[] = ['wall', 'railing', 'none'];
export function cycleEdgeKind(k: EdgeKind): EdgeKind {
  return KIND_CYCLE[(KIND_CYCLE.indexOf(k) + 1) % KIND_CYCLE.length];
}

/** "4.00 × 5.00 m · 13'1" × 16'5"" */
export function sizeText(w: number, l: number): string {
  return `${w.toFixed(2)} × ${l.toFixed(2)} m · ${formatFtIn(w)} × ${formatFtIn(l)}`;
}
export function areaText(m2: number): string {
  return formatArea(m2).text;
}

/** Tile helper (2.2 E3): count of tiles of `tileMm` along a side, in metres. */
export function tileSpanM(count: number, tileMm: number): number {
  return count * tileMm / 1000;
}
export function tileText(count: number, tileMm: number): string {
  return `${+count.toFixed(2)} tiles × ${tileMm} mm = ${tileSpanM(count, tileMm).toFixed(2)} m`;
}

// ---------------------------------------------------------------- edges and openings (2.2 E3, E4)

export interface EdgeHit {
  roomId: string; edge: number;
  /** distance from the point to the edge, metres */
  distM: number;
  /** distance along the edge from polygon[edge] to the projection of the point, clamped to the edge */
  u: number;
  lengthM: number;
  kind: EdgeKind;
}

export function edgeLength(room: RoomTag, edge: number): number {
  const n = room.polygon.length;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % n];
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Position along an edge. */
export function edgePoint(room: RoomTag, edge: number, u: number): Vec2 {
  const n = room.polygon.length;
  const a = room.polygon[edge];
  const b = room.polygon[(edge + 1) % n];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: a.x + ((b.x - a.x) / len) * u, z: a.z + ((b.z - a.z) / len) * u };
}

/**
 * The room edge nearest to `pt` within `maxDistM`. `kinds` limits which edge kinds count (default all).
 * `preferRoomId` wins ties within 1 cm, so that clicking the gap between two rooms picks the selected one.
 */
export function nearestEdge(
  layout: Layout, pt: Vec2, maxDistM: number, opts?: { kinds?: EdgeKind[]; preferRoomId?: string | null },
): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const room of layout.rooms) {
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const kind = room.edges[i] ?? 'wall';
      if (opts?.kinds && !opts.kinds.includes(kind)) continue;
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % n];
      const d = distanceToSegment(pt, a, b);
      if (d > maxDistM) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const u = len === 0 ? 0 : Math.max(0, Math.min(len, ((pt.x - a.x) * (b.x - a.x) + (pt.z - a.z) * (b.z - a.z)) / len));
      const hit: EdgeHit = { roomId: room.id, edge: i, distM: d, u, lengthM: len, kind };
      if (!best) { best = hit; continue; }
      const better = d < best.distM - 0.01 || (Math.abs(d - best.distM) <= 0.01 && room.id === opts?.preferRoomId && best.roomId !== room.id);
      if (better) best = hit;
    }
  }
  return best;
}

export interface OpeningPreset {
  id: string; label: string; type: OpeningType; widthM: number; sillM: number; headM: number;
}
/** SPEC 2.2 E4. */
export const OPENING_PRESETS: OpeningPreset[] = [
  { id: 'main-door', label: 'Main door', type: 'door', widthM: 0.9, sillM: 0, headM: 2.1 },
  { id: 'bedroom-door', label: 'Bedroom door', type: 'door', widthM: 0.8, sillM: 0, headM: 2.1 },
  { id: 'bathroom-door', label: 'Bathroom door', type: 'door', widthM: 0.75, sillM: 0, headM: 2.1 },
  { id: 'sliding', label: 'Sliding door / open archway', type: 'opening', widthM: 1.8, sillM: 0, headM: 2.1 },
  { id: 'window', label: 'Window', type: 'window', widthM: 1.2, sillM: 0.9, headM: 2.1 },
];

/** Keeps the opening on its edge: width at most the edge length, centre between width/2 and length - width/2. */
export function clampOpening(layout: Layout, o: Opening): Opening {
  const room = layout.rooms.find((r) => r.id === o.roomId);
  if (!room || !(o.edge >= 0 && o.edge < room.polygon.length)) return o;
  const len = edgeLength(room, o.edge);
  const widthM = Math.min(o.widthM, len);
  const centreM = Math.max(widthM / 2, Math.min(len - widthM / 2, o.centreM));
  return { ...o, widthM, centreM };
}

/**
 * Places a preset centred on the click, on the nearest wall (or railing) edge within `maxDistM`. Returns null when
 * no edge is close enough. `centreM` is clamped so the opening stays on the edge.
 */
export function placeOpening(
  layout: Layout, click: Vec2, preset: OpeningPreset, maxDistM: number, preferRoomId?: string | null,
): Opening | null {
  const hit = nearestEdge(layout, click, maxDistM, { kinds: ['wall', 'railing'], preferRoomId });
  if (!hit) return null;
  return clampOpening(layout, {
    id: nextId('opening', layout.openings.map((o) => o.id)),
    roomId: hit.roomId, edge: hit.edge, type: preset.type,
    centreM: hit.u, widthM: preset.widthM, sillM: preset.sillM, headM: preset.headM,
  });
}

/** Drags an opening along its own edge: projects `pt` on the edge and clamps. */
export function moveOpening(layout: Layout, o: Opening, pt: Vec2): Opening {
  const room = layout.rooms.find((r) => r.id === o.roomId);
  if (!room || !(o.edge >= 0 && o.edge < room.polygon.length)) return o;
  const n = room.polygon.length;
  const a = room.polygon[o.edge];
  const b = room.polygon[(o.edge + 1) % n];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const u = ((pt.x - a.x) * (b.x - a.x) + (pt.z - a.z) * (b.z - a.z)) / len;
  return clampOpening(layout, { ...o, centreM: u });
}

/** Distance from `pt` to the opening's span on its edge (metres), or Infinity when the room or edge is gone. */
export function distanceToOpening(layout: Layout, o: Opening, pt: Vec2): number {
  const room = layout.rooms.find((r) => r.id === o.roomId);
  if (!room || !(o.edge >= 0 && o.edge < room.polygon.length)) return Infinity;
  const p0 = edgePoint(room, o.edge, Math.max(0, o.centreM - o.widthM / 2));
  const p1 = edgePoint(room, o.edge, Math.min(edgeLength(room, o.edge), o.centreM + o.widthM / 2));
  return distanceToSegment(pt, p0, p1);
}

/** Re-clamps every opening on a room, after the room was resized. */
export function clampOpeningsOn(layout: Layout, roomId: string): void {
  layout.openings = layout.openings.map((o) => (o.roomId === roomId ? clampOpening(layout, o) : o));
}

// ---------------------------------------------------------------- scale change

/**
 * // SPEC-GAP: 2.2 E2 does not say what happens to rooms already traced when the scale changes (a second or removed dimension).
 * // Smallest fix: keep them glued to the plan image.
 * When the plan's pixels-per-metre changes, everything traced on the image has to stay glued to the image:
 * coordinates about the world origin (the image centre) scale by old/new. Sizes typed in metres (door width,
 * furniture size) do not change; distances along an edge do.
 */
export function rescaleDraft(draft: PropertyFile, ratio: number): void {
  if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-9) return;
  const lay = draft.layout;
  for (const r of lay.rooms) r.polygon = r.polygon.map((p) => ({ x: p.x * ratio, z: p.z * ratio }));
  for (const o of lay.openings) o.centreM *= ratio;
  for (const f of draft.furniture) { f.box.cx *= ratio; f.box.cz *= ratio; }
  draft.spawn.x *= ratio;
  draft.spawn.z *= ratio;
}

/** The tentative scale used before the broker has typed any dimension: the image spans about 12 m. */
export function tentativePxPerM(imageW: number, imageH: number): number {
  return Math.max(1, Math.max(imageW, imageH) / 12);
}
