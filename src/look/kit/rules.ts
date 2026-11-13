// Owned by C11 look-kit. Placement rules for the fixtures that make a flat read as an Indian home (fan, tube light, modular
// switchboards, window grills, MS railings, cove ceiling, skirting, floor tile grid). Pure: no three, no DOM, so every rule is a
// unit test. Nothing here is read from the drawing, and nothing here feeds a fit check, a clearance, an area or the collision grid:
// the functions take the layout and the furniture as read-only input and return sites for decor meshes (SPEC 16.2).
import type { Box, EdgeFrame, FurnitureItem, Layout, RoomTag, RoomType, Vec2, WallPiece } from '../../types';
import { boxCorners, distanceToSegment, pointInPolygon, polygonArea, sideEdge } from '../../core/geometry';
import { computeEdgeFrames, computeTunnels, computeWallPieces } from '../../core/layout-geom';

/** The one line that says what this is (rooms sheet and look panel). */
export const KIT_NOTE = 'Fan, lights, switches, grills and tiles are typical fittings, not from your drawing.';

// ---- numbers (all visual conventions of an Indian flat, none of them measured)
export const FAN_MIN_ROOM_M2 = 7;
/** a fan needs a ceiling this high to hang clear of a tall person and the follow camera */
export const FAN_MIN_WALL_M = 2.4;
export const COVE_DROP_M = 0.3;
export const COVE_MIN_CLEAR_M = 2.4;
export const COVE_WIDTH_M = 0.45;
export const SWITCH_Y_M = 1.2;
export const BEDHEAD_SWITCH_Y_M = 1.1;
export const PLATE_W_M = 0.12;
export const PLATE_H_M = 0.2;
export const SWITCH_GAP_M = 0.06;
export const TUBE_LEN_M = 1.22;
export const TUBE_Y_M = 2.05;
export const SKIRTING_H_M = 0.1;
export const SKIRTING_T_M = 0.014;
/** at least this much clear wall either side of a plate or a tube */
const CORNER_PAD_M = 0.08;
const DOOR_PAD_M = 0.06;
const WINDOW_PAD_M = 0.05;

const HABITABLE: RoomType[] = ['bedroom', 'living'];
export const roomArea = (r: RoomTag): number => Math.abs(polygonArea(r.polygon));
const isPartial = (r: RoomTag): boolean => !!r.partial;

// ---------------------------------------------------------------- wall spans (doors, openings, windows) seen from inside a room

export interface WallSpan { u0: number; u1: number; type: 'door' | 'opening' | 'window'; sillM: number; headM: number; own: boolean }
export interface WallInfo { room: RoomTag; frame: EdgeFrame; spans: WallSpan[] }

const COS10 = Math.cos((10 * Math.PI) / 180);
/** Same test the shell uses (SPEC 4.1) to decide that two edges are one wall seen from both sides. */
function facing(e: EdgeFrame, f: EdgeFrame): { g: number } | null {
  if (Math.abs(e.dir.x * f.dir.x + e.dir.z * f.dir.z) < COS10) return null;
  if (e.out.x * f.out.x + e.out.z * f.out.z >= 0) return null;
  const da = (f.a.x - e.a.x) * e.out.x + (f.a.z - e.a.z) * e.out.z;
  const db = (f.b.x - e.a.x) * e.out.x + (f.b.z - e.a.z) * e.out.z;
  const g = (da + db) / 2;
  if (g < -0.02 || g > 0.45) return null;
  const pa = (f.a.x - e.a.x) * e.dir.x + (f.a.z - e.a.z) * e.dir.z;
  const pb = (f.b.x - e.a.x) * e.dir.x + (f.b.z - e.a.z) * e.dir.z;
  if (Math.min(Math.max(pa, pb), e.length) - Math.max(Math.min(pa, pb), 0) <= 0.05) return null;
  return { g };
}

/** Every wall edge of every room with the openings that cut it, own and the facing room's (a door is a door from both sides). */
export function wallInfos(layout: Layout): WallInfo[] {
  const frames = computeEdgeFrames(layout);
  const tunnels = computeTunnels(layout);
  const roomOf = new Map(layout.rooms.map((r) => [r.id, r]));
  const key = (id: string, e: number): string => `${id}:${e}`;
  const byEdge = new Map<string, typeof tunnels>();
  for (const t of tunnels) { const k = key(t.roomId, t.edge); const l = byEdge.get(k) ?? []; l.push(t); byEdge.set(k, l); }
  const out: WallInfo[] = [];
  for (const f of frames) {
    const room = roomOf.get(f.roomId);
    if (!room) continue;
    const spans: WallSpan[] = [];
    for (const t of byEdge.get(key(f.roomId, f.edge)) ?? []) spans.push({ u0: t.u0, u1: t.u1, type: t.type, sillM: t.sillM, headM: t.headM, own: true });
    for (const o of frames) {
      if (o.roomId === f.roomId || !facing(f, o)) continue;
      for (const t of byEdge.get(key(o.roomId, o.edge)) ?? []) {
        const ua = (o.a.x + o.dir.x * t.u0 - f.a.x) * f.dir.x + (o.a.z + o.dir.z * t.u0 - f.a.z) * f.dir.z;
        const ub = (o.a.x + o.dir.x * t.u1 - f.a.x) * f.dir.x + (o.a.z + o.dir.z * t.u1 - f.a.z) * f.dir.z;
        const u0 = Math.max(0, Math.min(ua, ub)), u1 = Math.min(f.length, Math.max(ua, ub));
        if (u1 - u0 < 0.05) continue;
        // the same hole listed on both sides counts once
        if (spans.some((s) => Math.min(s.u1, u1) - Math.max(s.u0, u0) > 0.5 * (u1 - u0))) continue;
        spans.push({ u0, u1, type: t.type, sillM: t.sillM, headM: t.headM, own: false });
      }
    }
    spans.sort((a, b) => a.u0 - b.u0);
      out.push({ room, frame: f, spans });
  }
  return out;
}

// ---------------------------------------------------------------- furniture that stands against a wall

/** The stretch of an edge (u0..u1) that an item stands in front of, when it comes within `nearM` of the wall and is taller than `minH`. */
export function furnitureOnWall(f: EdgeFrame, item: Pick<FurnitureItem, 'box' | 'heightM'>, minH: number, nearM = 0.3): [number, number] | null {
  if (item.heightM <= minH) return null;
  let u0 = Infinity, u1 = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (const p of boxCorners(item.box)) {
    const u = (p.x - f.a.x) * f.dir.x + (p.z - f.a.z) * f.dir.z;
    const d = -((p.x - f.a.x) * f.out.x + (p.z - f.a.z) * f.out.z); // metres into the room
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
  }
  if (dMin > nearM || dMax < -0.1) return null;
  return [u0, u1];
}

type Interval = [number, number];

/** Blocked stretches of an edge for something at height `y` that is `thick` deep: openings, tall furniture, and the corners. */
function blocked(info: WallInfo, items: FurnitureItem[], opts: { y: number; skip?: WallSpan }): Interval[] {
  const f = info.frame;
  const iv: Interval[] = [[-1, CORNER_PAD_M], [f.length - CORNER_PAD_M, f.length + 1]];
  for (const s of info.spans) {
    if (s === opts.skip) continue;
    const pad = s.type === 'window' ? WINDOW_PAD_M : DOOR_PAD_M;
    // a window whose sill is above the plate does not block a plate under it, and one below blocks it
    if (s.type === 'window' && s.sillM > opts.y + 0.15) continue;
    iv.push([s.u0 - pad, s.u1 + pad]);
  }
  for (const it of items) {
    const span = furnitureOnWall(f, it, Math.max(0.2, opts.y - 0.15));
    if (span) iv.push([span[0] - 0.02, span[1] + 0.02]);
  }
  return iv.sort((a, b) => a[0] - b[0]);
}

/** Free stretches (>= minLen) left between blocked intervals. */
export function freeRuns(f: EdgeFrame, iv: Interval[], minLen: number): Interval[] {
  const runs: Interval[] = [];
  const merged: Interval[] = [];
  for (const [a, b] of iv) {
    if (merged.length && a <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    else merged.push([a, b]);
  }
  let at = 0;
  for (const [a, b] of merged) {
    if (a - at >= minLen) runs.push([at, a]);
    at = Math.max(at, b);
  }
  if (f.length - at >= minLen) runs.push([at, f.length]);
  return runs;
}

const wallEdges = (layout: Layout): WallInfo[] => wallInfos(layout).filter((w) => w.frame.kind === 'wall' && !isPartial(w.room));

// ---------------------------------------------------------------- centre of a room

function clearance(pt: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Area centroid; when that falls outside (an L-shape) or hugs a wall, the interior point furthest from every wall. */
export function roomCentre(room: RoomTag): Vec2 {
  const p = room.polygon;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length];
    const w = q.x * r.z - r.x * q.z;
    a += w; cx += (q.x + r.x) * w; cz += (q.z + r.z) * w;
  }
  const c: Vec2 = Math.abs(a) > 1e-9 ? { x: cx / (3 * a), z: cz / (3 * a) } : { x: p[0].x, z: p[0].z };
  if (pointInPolygon(c, p) && clearance(c, p) >= 0.6) return c;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  let best = c, bestD = pointInPolygon(c, p) ? clearance(c, p) : -1;
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const t = { x: x0 + ((x1 - x0) * i) / 24, z: z0 + ((z1 - z0) * j) / 24 };
    if (!pointInPolygon(t, p)) continue;
    const d = clearance(t, p);
    if (d > bestD) { bestD = d; best = t; }
  }
  return best;
}

// ---------------------------------------------------------------- 1. ceiling fans

export interface FanSite { roomId: string; x: number; z: number; /** blade radius, m */ radiusM: number; wallHeightM: number }

/** A fan at the centre of every bedroom and living room of 7 m2 or more that is fully on the drawing. */
export function fanSites(layout: Layout): FanSite[] {
  if (layout.wallHeightM < FAN_MIN_WALL_M) return [];
  const out: FanSite[] = [];
  for (const r of layout.rooms) {
    if (!HABITABLE.includes(r.roomType) || isPartial(r) || roomArea(r) < FAN_MIN_ROOM_M2) continue;
    const c = roomCentre(r);
    // the blades never reach within 0.5 m of a wall
    const radiusM = Math.min(0.6, Math.max(0.35, clearance(c, r.polygon) - 0.5));
    out.push({ roomId: r.id, x: c.x, z: c.z, radiusM, wallHeightM: layout.wallHeightM });
  }
  return out;
}

// ---------------------------------------------------------------- 2. tube lights

export interface WallSite { roomId: string; edge: number; /** centre along the edge, m */ u: number; y: number }
export interface TubeSite extends WallSite { lengthM: number }

/** One batten on the longest wall of each bedroom, living room and kitchen that has room for one (clear of openings and tall furniture). */
export function tubeSites(layout: Layout, furniture: FurnitureItem[] = []): TubeSite[] {
  const infos = wallEdges(layout);
  const out: TubeSite[] = [];
  for (const r of layout.rooms) {
    if (isPartial(r) || !(HABITABLE.includes(r.roomType) || r.roomType === 'kitchen')) continue;
    const mine = infos.filter((w) => w.room.id === r.id).sort((a, b) => b.frame.length - a.frame.length);
    for (const w of mine) {
      const runs = freeRuns(w.frame, blocked(w, furniture, { y: TUBE_Y_M }), 0.9).sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
      if (runs.length === 0) continue;
      const [a, b] = runs[0];
      out.push({ roomId: r.id, edge: w.frame.edge, u: (a + b) / 2, y: Math.min(TUBE_Y_M, layout.wallHeightM - 0.45), lengthM: Math.min(TUBE_LEN_M, b - a - 0.1) });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. switchboards

export interface BoardSite extends WallSite { kind: 'door' | 'bedhead'; side: 'low' | 'high' }

const BOARD_ROOMS = (r: RoomTag): boolean => !isPartial(r) && (HABITABLE.includes(r.roomType) || r.roomType === 'kitchen' || (r.roomType === 'other' && roomArea(r) >= 4));

/**
 * One board beside each door, on the latch side. The door's hinge is on the side nearer the corner (the leaf folds back against the
 * short run of wall), so the latch side is the one with MORE clear wall; on a tie, the higher-u side. When that side has no room for a
 * plate the other side is used; when neither has, the door gets none. Bathrooms get none inside (the switch is outside).
 */
export function doorBoards(layout: Layout, furniture: FurnitureItem[] = []): BoardSite[] {
  const out: BoardSite[] = [];
  const need = SWITCH_GAP_M + PLATE_W_M + 0.04;
  for (const w of wallEdges(layout)) {
    if (!BOARD_ROOMS(w.room)) continue;
    const f = w.frame;
    for (const door of w.spans) {
      if (door.type !== 'door') continue;
      const iv = blocked(w, furniture, { y: SWITCH_Y_M, skip: door });
      let lo = 0, hi = f.length;
      for (const [a, b] of iv) { if (b <= door.u0 + 1e-6) lo = Math.max(lo, b); if (a >= door.u1 - 1e-6) hi = Math.min(hi, a); }
      const lowRun = door.u0 - lo, highRun = hi - door.u1;
      const prefer: ('low' | 'high')[] = highRun >= lowRun - 1e-6 ? ['high', 'low'] : ['low', 'high'];
      for (const side of prefer) {
        const run = side === 'low' ? lowRun : highRun;
        if (run < need) continue;
        const u = side === 'low' ? door.u0 - SWITCH_GAP_M - PLATE_W_M / 2 : door.u1 + SWITCH_GAP_M + PLATE_W_M / 2;
        out.push({ roomId: w.room.id, edge: f.edge, u, y: SWITCH_Y_M, kind: 'door', side });
        break;
      }
    }
  }
  return out;
}

/** One board by the head of each bed: on the wall behind the headboard, just past the bed's side (over the bedside table), free side first. */
export function bedheadBoards(layout: Layout, furniture: FurnitureItem[]): BoardSite[] {
  const infos = wallEdges(layout);
  const out: BoardSite[] = [];
  for (const bed of furniture) {
    if (bed.kind !== 'bed') continue;
    const room = layout.rooms.find((r) => !isPartial(r) && pointInPolygon({ x: bed.box.cx, z: bed.box.cz }, r.polygon));
    if (!room) continue;
    const back = sideEdge(bed.box as Box, 'back');
    let best: { w: WallInfo; d: number } | null = null;
    for (const w of infos) {
      if (w.room.id !== room.id) continue;
      const f = w.frame;
      if (Math.abs(f.dir.x * back.along.x + f.dir.z * back.along.z) < 0.97) continue;
      if (f.out.x * back.normal.x + f.out.z * back.normal.z < 0.9) continue;
      const d = (back.mid.x - f.a.x) * -f.out.x + (back.mid.z - f.a.z) * -f.out.z; // head to wall, m
      if (d < -0.05 || d > 0.5) continue;
      if (!best || d < best.d) best = { w, d };
    }
    if (!best) continue;
    const f = best.w.frame;
    const um = (back.mid.x - f.a.x) * f.dir.x + (back.mid.z - f.a.z) * f.dir.z;
    // the bed's two ends on the edge, then the bedside spot a plate's width past each
    const ends = [um - back.half, um + back.half].sort((a, b) => a - b);
    const iv = blocked(best.w, furniture.filter((it) => it.kind !== 'bed' && it.id !== bed.id), { y: BEDHEAD_SWITCH_Y_M });
    const cands: { u: number; side: 'low' | 'high'; room: number }[] = [
      { u: ends[0] - 0.3, side: 'low', room: 0 }, { u: ends[1] + 0.3, side: 'high', room: 0 },
    ];
    for (const c of cands) {
      const lo = c.u - PLATE_W_M / 2 - 0.02, hi = c.u + PLATE_W_M / 2 + 0.02;
      c.room = iv.some(([a, b]) => a < hi && b > lo) ? -1 : Math.min(c.u, f.length - c.u);
    }
    const pick = cands.filter((c) => c.room >= 0).sort((a, b) => b.room - a.room)[0];
    if (pick) out.push({ roomId: room.id, edge: f.edge, u: pick.u, y: BEDHEAD_SWITCH_Y_M, kind: 'bedhead', side: pick.side });
  }
  return out;
}

// ---------------------------------------------------------------- 4. window grills, mesh shutters, railings

export interface WindowSite { roomId: string; edge: number; u0: number; u1: number; sillM: number; headM: number; depthM: number }

/** Every window gets a grill and a mosquito-mesh shutter frame. Partial rooms have none (their walls are not on the drawing). */
export function windowSites(layout: Layout): WindowSite[] {
  const partial = new Set(layout.rooms.filter(isPartial).map((r) => r.id));
  return computeTunnels(layout).filter((t) => t.openingId !== null && t.type === 'window' && !partial.has(t.roomId))
    .map((t) => ({ roomId: t.roomId, edge: t.edge, u0: t.u0, u1: t.u1, sillM: t.sillM, headM: t.headM, depthM: t.depth }));
}

/** The railing pieces of the shell (the same pieces the shell draws as a solid box): the MS railing is drawn inside exactly these. */
export function railingPieces(layout: Layout): WallPiece[] {
  const partial = new Set(layout.rooms.filter(isPartial).map((r) => r.id));
  const all = computeWallPieces(layout).filter((p) => p.kind === 'railing');
  // the shell draws every railing as one solid mesh that the kit hides when it replaces it: with a railing in a partial room (no kit
  // there) the solid one stays and the kit adds none, so a partial room never changes
  return all.some((p) => partial.has(p.roomId)) ? [] : all;
}

// ---------------------------------------------------------------- 6. false-ceiling cove

/** "Master": by its label, else the largest bedroom when the flat has more than one. */
export function masterBedroomId(layout: Layout): string | null {
  const beds = layout.rooms.filter((r) => r.roomType === 'bedroom' && !isPartial(r));
  const named = beds.find((r) => /master|\bmbr\b|\bm\.?\s*-?\s*bed|\bm\.?\s*b\.?\s*r\b/i.test(r.label) || /master|mbr/i.test(r.id));
  if (named) return named.id;
  if (beds.length < 2) return null;
  return [...beds].sort((a, b) => roomArea(b) - roomArea(a))[0].id;
}

/** Move every edge inward by `d` and join with mitres. Null when the result is not a clean smaller polygon. */
export function insetPolygon(poly: Vec2[], d: number): Vec2[] | null {
  const n = poly.length;
  if (n < 3) return null;
  const inward: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // outward normal is (dz, -dx) / l (SPEC 3.1), so inward is its negative
    inward.push({ x: -(b.z - a.z) / l, z: (b.x - a.x) / l });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const n1 = inward[(i - 1 + n) % n], n2 = inward[i];
    const k = 1 + n1.x * n2.x + n1.z * n2.z;
    if (k < 0.3) return null;
    out.push({ x: poly[i].x + (d * (n1.x + n2.x)) / k, z: poly[i].z + (d * (n1.z + n2.z)) / k });
  }
  const a0 = polygonArea(poly), a1 = polygonArea(out);
  if (a1 <= 0.5 || a1 >= a0 || a1 < 0.25 * a0) return null;
  return out;
}

export interface CoveSite { roomId: string; outer: Vec2[]; inner: Vec2[]; dropM: number; wallHeightM: number }

/** Living rooms and the master bedroom, where the ceiling minus the drop still leaves 2.4 m. */
export function coveSites(layout: Layout, furniture: FurnitureItem[] = []): CoveSite[] {
  if (layout.wallHeightM - COVE_DROP_M < COVE_MIN_CLEAR_M - 1e-9) return [];
  const master = masterBedroomId(layout);
  const out: CoveSite[] = [];
  for (const r of layout.rooms) {
    if (isPartial(r) || !(r.roomType === 'living' || r.id === master)) continue;
    const inner = insetPolygon(r.polygon, COVE_WIDTH_M);
    if (!inner) continue;
    // a wardrobe taller than the dropped ceiling would stand through it
    if (furniture.some((it) => it.heightM > layout.wallHeightM - COVE_DROP_M - 0.01 && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon))) continue;
    out.push({ roomId: r.id, outer: r.polygon, inner, dropM: COVE_DROP_M, wallHeightM: layout.wallHeightM });
  }
  return out;
}

// ---------------------------------------------------------------- 8. skirting

export interface SkirtingRun { roomId: string; edge: number; u0: number; u1: number }

/** 100 mm skirting along every wall, wherever the wall reaches the floor (not under doors, not on railings). */
export function skirtingRuns(layout: Layout): SkirtingRun[] {
  const partial = new Set(layout.rooms.filter(isPartial).map((r) => r.id));
  const lengths = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f.length]));
  const out: SkirtingRun[] = [];
  for (const p of computeWallPieces(layout)) {
    if (p.kind !== 'wall' || p.y0 > 1e-6 || partial.has(p.roomId)) continue;
    const len = lengths.get(`${p.roomId}:${p.edge}`) ?? 0;
    const u0 = Math.max(0, p.u0), u1 = Math.min(len, p.u1);
    if (u1 - u0 > 0.05) out.push({ roomId: p.roomId, edge: p.edge, u0, u1 });
  }
  return out;
}

// ---------------------------------------------------------------- 5. floor tiles

export interface FloorSpec {
  roomId: string;
  /** tile size along the grid's u and v axes, m. Equal unless the drawing gave a non-square tile */
  tileU: number; tileV: number;
  /** grid axis u (a unit vector along the room's longest wall) and its origin: the room's bounding corner in that frame */
  axisX: number; axisZ: number; originX: number; originZ: number;
  groutM: number;
  /** bathrooms: small non-slip tile, no gloss */
  antiSkid: boolean;
  /** balconies: matt */
  matt: boolean;
  /** the drawing gave the tile: its size is used as is */
  drawn: boolean;
}

export const DEFAULT_TILE_M = 0.6;

/** The drawing gave a tile when it is not the 600 x 600 default (or says the floor is plain). */
export function drawnTile(layout: Layout): { wM: number; lM: number } | null {
  const t = layout.finishes.tile;
  if (!t) return null;
  return Math.abs(t.wM - DEFAULT_TILE_M) < 1e-6 && Math.abs(t.lM - DEFAULT_TILE_M) < 1e-6 ? null : t;
}

/** The longest edge of a room that is a wall (any edge when none is). */
function longestEdge(room: RoomTag): { a: Vec2; b: Vec2; len: number } {
  let best = { a: room.polygon[0], b: room.polygon[1], len: -1 };
  const n = room.polygon.length;
  for (let i = 0; i < n; i++) {
    const a = room.polygon[i], b = room.polygon[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > best.len + 1e-9) best = { a, b, len };
  }
  return best;
}

/** `null` when the drawing says the floor is plain (no tile grid), else the grid for this room: aligned to the longest wall, square tiles, never stretched. */
export function floorTileSpec(room: RoomTag, layout: Layout): FloorSpec | null {
  if (layout.finishes.tile === null) return null;
  const e = longestEdge(room);
  const ax = (e.b.x - e.a.x) / e.len, az = (e.b.z - e.a.z) / e.len;
  // v axis is perpendicular to u
  const vx = -az, vz = ax;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of room.polygon) {
    const u = p.x * ax + p.z * az, v = p.x * vx + p.z * vz;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  const shortSide = Math.min(uMax - uMin, vMax - vMin);
  const area = roomArea(room);
  const drawn = drawnTile(layout);
  const bath = room.roomType === 'bathroom';
  let tileU: number, tileV: number;
  if (drawn) { tileU = drawn.wM; tileV = drawn.lM; }
  else if (bath) { tileU = tileV = 0.3; }
  else if (room.roomType === 'balcony') { tileU = tileV = 0.6; }
  else { tileU = tileV = area >= 12 && shortSide >= 3 ? 0.8 : 0.6; }
  return {
    roomId: room.id, tileU, tileV, axisX: ax, axisZ: az,
    originX: uMin * ax + vMin * vx, originZ: uMin * az + vMin * vz,
    groutM: bath ? 0.003 : 0.0025, antiSkid: bath, matt: room.roomType === 'balcony', drawn: !!drawn,
  };
}

// ---------------------------------------------------------------- the whole plan

export interface KitPlan {
  fans: FanSite[]; tubes: TubeSite[]; boards: BoardSite[]; bedheads: BoardSite[]; windows: WindowSite[]; railings: WallPiece[];
  coves: CoveSite[]; skirting: SkirtingRun[]; floors: FloorSpec[];
}

export function kitPlan(layout: Layout, furniture: FurnitureItem[] = []): KitPlan {
  const floors: FloorSpec[] = [];
  for (const r of layout.rooms) {
    if (isPartial(r) || r.polygon.length < 3) continue;
    const s = floorTileSpec(r, layout);
    if (s) floors.push(s);
  }
  return {
    fans: fanSites(layout), tubes: tubeSites(layout, furniture),
    boards: doorBoards(layout, furniture), bedheads: bedheadBoards(layout, furniture),
    windows: windowSites(layout), railings: railingPieces(layout), coves: coveSites(layout, furniture), skirting: skirtingRuns(layout), floors,
  };
}

/** Axes of a room's tile grid as a rotation angle about y (for tests and the shader uniform). */
export function tileAngle(spec: FloorSpec): number { return Math.atan2(spec.axisZ, spec.axisX); }

