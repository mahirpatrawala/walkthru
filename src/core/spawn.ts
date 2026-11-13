// Where the buyer first stands in a chosen room. Pure: no DOM, no three.
//
// The rule (start page, "Where do you want to start?"): inside the room, just in from its main door (or, with no door,
// near the wall farthest from the room's centre), at least 0.6 m clear of walls and furniture on the collision grid,
// facing the room's centre so the room fills the first view. Never in a room that is only partly on the drawing.
import { CHARACTER_RADIUS_M, GRID_VOID } from '../types';
import type { Grid, Layout, Opening, RoomTag, Vec2 } from '../types';
import { cellValue } from './grid-codec';
import { distanceToPolygon, distanceToSegment, pointInPolygon, polygonArea } from './geometry';
import { boomDistance, circleFree, nearestFree } from './grid-query';

/** The clear space asked of the spawn point, metres (walls and furniture). */
export const SPAWN_CLEAR_M = 0.6;
/** Used only when no point in the room has SPAWN_CLEAR_M of clear space (a tiny or crowded room), widest first. */
const RELAXED_CLEAR_M = [0.45, 0.33, CHARACTER_RADIUS_M];
/** How far in from the door line the buyer stands, metres. */
const DOOR_INSET_M = 1.0;
/**
 * The walking camera (SPEC 2.4: boom 2.0 m, pitch 12 degrees, pivot 0.85 of the height, 0.20 m over the shoulder) is repeated here
 * so the first frame can be judged without three.js: a boom between HIDDEN and ROOMY leaves the figure's back filling the view.
 */
const CAM_BOOM_M = 2.0, CAM_PITCH_DEG = 12, CAM_SHOULDER_M = 0.2, CAM_PIVOT_RATIO = 0.85, CAM_HEIGHT_M = 1.75;
const BOOM_HIDDEN_BELOW_M = 0.7, BOOM_ROOMY_FROM_M = 1.5;
/** What the awkward-boom zone costs, as extra metres of distance from the wanted spot. */
const BOOM_PENALTY_M = 1.5;
/** Candidate spacing, metres. */
const STEP_M = 0.05;

export interface Spawn {
  x: number;
  z: number;
  yawDeg: number;
  roomId: string;
  /** which rule picked the point: just inside the main door, near the farthest wall, or the clear cell nearest the centre */
  how: 'door' | 'wall' | 'centre';
  /** the clear radius the point really has (SPAWN_CLEAR_M unless the room is too crowded for it) */
  clearM: number;
}

/** Area centroid of a polygon (positive or negative area both fine); the vertex mean for a degenerate one. */
export function polygonCentroid(p: Vec2[]): Vec2 {
  let a2 = 0, cx = 0, cz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const k = a.x * b.z - b.x * a.z;
    a2 += k;
    cx += (a.x + b.x) * k;
    cz += (a.z + b.z) * k;
  }
  if (Math.abs(a2) < 1e-9) {
    return { x: p.reduce((s, q) => s + q.x, 0) / p.length, z: p.reduce((s, q) => s + q.z, 0) / p.length };
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) };
}

/** Heading in degrees that looks from `from` to `to` (forward is (sin yaw, cos yaw), SPEC 3.1). */
export function yawToward(from: Vec2, to: Vec2): number {
  return (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI;
}

interface DoorHit { opening: Opening; at: Vec2; normal: Vec2; connected: boolean }

/** World centre of an opening and the unit normal of the wall it is in. Null when the room or edge does not exist. */
function openingPoint(layout: Layout, o: Opening): { at: Vec2; normal: Vec2 } | null {
  const room = layout.rooms.find((r) => r.id === o.roomId);
  if (!room) return null;
  const n = room.polygon.length;
  const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % n];
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-9) return null;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  return { at: { x: a.x + dx * o.centreM, z: a.z + dz * o.centreM }, normal: { x: dz, z: -dx } };
}

/** Doors and plain openings that belong to this room: on its own walls, or in a neighbour's wall right against it. */
function doorsOf(layout: Layout, room: RoomTag, centre: Vec2): DoorHit[] {
  const out: DoorHit[] = [];
  for (const o of layout.openings) {
    if (o.type === 'window') continue;
    const p = openingPoint(layout, o);
    if (!p) continue;
    const own = o.roomId === room.id;
    if (own) {
      if (room.edges[o.edge] === 'none') continue;
    } else if (distanceToSegmentOfPolygon(p.at, room.polygon) > 0.5) {
      continue;
    }
    // does it lead somewhere? (another room's outline within a wall's thickness of the doorway)
    const connected = !own || layout.rooms.some((r) => r.id !== room.id && distanceToPolygon(p.at, r.polygon) <= 0.6);
    // inward = the side of the wall the room's centre is on
    const sign = (centre.x - p.at.x) * p.normal.x + (centre.z - p.at.z) * p.normal.z >= 0 ? 1 : -1;
    out.push({ opening: o, at: p.at, normal: { x: p.normal.x * sign, z: p.normal.z * sign }, connected });
  }
  return out;
}

function distanceToSegmentOfPolygon(pt: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** The door a buyer would come in by: one that leads to another room first, then a real door over a bare opening, then the wider. */
function mainDoor(doors: DoorHit[]): DoorHit | null {
  let best: DoorHit | null = null;
  let bestScore = -Infinity;
  for (const d of doors) {
    const score = (d.connected ? 10 : 0) + (d.opening.type === 'door' ? 2 : 1) + Math.min(d.opening.widthM, 2) / 10;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** A point well inside the polygon: the centroid when it is inside, else the roomiest sampled point (L and U shapes). */
function interiorPoint(poly: Vec2[], centroid: Vec2): Vec2 {
  if (pointInPolygon(centroid, poly)) return centroid;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  let best = poly[0], bestD = -1;
  for (let x = minX; x <= maxX; x += STEP_M) {
    for (let z = minZ; z <= maxZ; z += STEP_M) {
      const q = { x, z };
      if (!pointInPolygon(q, poly)) continue;
      const d = distanceToSegmentOfPolygon(q, poly);
      if (d > bestD) { best = q; bestD = d; }
    }
  }
  return best;
}

/** Every lattice point inside the room with `clearM` of free space around it on the grid. */
function clearPoints(poly: Vec2[], grid: Grid, clearM: number): Vec2[] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const out: Vec2[] = [];
  for (let x = minX; x <= maxX; x += STEP_M) {
    for (let z = minZ; z <= maxZ; z += STEP_M) {
      const q = { x, z };
      if (pointInPolygon(q, poly) && circleFree(grid, x, z, clearM)) out.push(q);
    }
  }
  return out;
}

/**
 * The buyer's first position in `roomId`. Null when the room does not exist, is only partly on the drawing (`partial`),
 * or has nowhere to stand at all; the caller then keeps whatever spawn it had.
 * `grid` is the walking grid with furniture stamped in, so the 0.6 m is clear of beds and wardrobes too.
 */
export function chooseSpawn(layout: Layout, roomId: string, grid: Grid): Spawn | null {
  const room = layout.rooms.find((r) => r.id === roomId);
  if (!room || room.partial || room.polygon.length < 3) return null;
  const poly = room.polygon;
  const centroid = polygonCentroid(poly);
  const anchor = interiorPoint(poly, centroid);

  // where we would like to stand
  let how: Spawn['how'];
  let target: Vec2;
  let lookFallback = 0;
  const door = mainDoor(doorsOf(layout, room, anchor));
  if (door) {
    how = 'door';
    target = { x: door.at.x + door.normal.x * DOOR_INSET_M, z: door.at.z + door.normal.z * DOOR_INSET_M };
    lookFallback = yawToward({ x: 0, z: 0 }, door.normal);
  } else {
    // no door: near the wall whose middle is farthest from the room's centre
    how = 'wall';
    let far = -1;
    target = anchor;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      if (room.edges[i] === 'none') continue;
      const a = poly[i], b = poly[(i + 1) % n];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const d = Math.hypot(mid.x - anchor.x, mid.z - anchor.z);
      if (d > far) {
        far = d;
        const len = Math.hypot(mid.x - anchor.x, mid.z - anchor.z) || 1;
        // from the wall's middle, towards the centre
        target = { x: mid.x + ((anchor.x - mid.x) / len) * DOOR_INSET_M, z: mid.z + ((anchor.z - mid.z) / len) * DOOR_INSET_M };
        lookFallback = yawToward(mid, anchor);
      }
    }
  }

  const face = (p: Vec2): number => (Math.hypot(centroid.x - p.x, centroid.z - p.z) < 0.3 ? lookFallback : yawToward(p, centroid));

  // how far the walking camera could pull back from p when it looks along the heading `yawDeg`
  const boomAt = (p: Vec2, yawDeg: number): number => {
    const yr = (yawDeg * Math.PI) / 180, pr = (CAM_PITCH_DEG * Math.PI) / 180;
    const pivot = { x: p.x - Math.cos(yr) * CAM_SHOULDER_M, y: CAM_PIVOT_RATIO * CAM_HEIGHT_M, z: p.z + Math.sin(yr) * CAM_SHOULDER_M };
    const dir = { x: -Math.sin(yr) * Math.cos(pr), y: Math.sin(pr), z: -Math.cos(yr) * Math.cos(pr) };
    const boom = boomDistance(grid, pivot, dir, CAM_BOOM_M, layout.wallHeightM);
    // The camera must end up in the room (or be tucked in at the figure, hidden below HIDDEN). A window does not stop it (it passes
    // over the sill) and neither does a doorway, so a boom straight back through one ends outside the room: never that.
    if (boom >= BOOM_HIDDEN_BELOW_M) {
      const end = { x: pivot.x + dir.x * boom, z: pivot.z + dir.z * boom };
      if (!pointInPolygon(end, poly) || cellValue(grid, end.x, end.z) === GRID_VOID) return -1;
    }
    return boom;
  };

  for (const clearM of [SPAWN_CLEAR_M, ...RELAXED_CLEAR_M]) {
    const pts = clearPoints(poly, grid, clearM);
    if (pts.length === 0) continue;
    // nearest the wanted spot, but not where the camera is squeezed to a metre behind a figure that then fills the screen
    let at = pts[0], bestCost = Infinity;
    for (const q of pts) {
      const boom = boomAt(q, face(q));
      const awkward = boom < 0 ? 3 * BOOM_PENALTY_M : boom >= BOOM_HIDDEN_BELOW_M && boom < BOOM_ROOMY_FROM_M ? BOOM_PENALTY_M : 0;
      const cost = Math.hypot(q.x - target.x, q.z - target.z) + awkward;
      if (cost < bestCost) { at = q; bestCost = cost; }
    }
    return { x: at.x, z: at.z, yawDeg: face(at), roomId, how, clearM };
  }
  // nothing has even a body's width of room: the clear cell nearest the centre, if it is still in the room
  const near = nearestFree(grid, anchor.x, anchor.z, CHARACTER_RADIUS_M, 3);
  if (near && pointInPolygon(near, poly)) {
    return { x: near.x, z: near.z, yawDeg: face(near), roomId, how: 'centre', clearM: CHARACTER_RADIUS_M };
  }
  return null;
}

/** Room area in m2, for choosing a default start room. */
export function roomAreaM2(room: RoomTag): number {
  return Math.abs(polygonArea(room.polygon));
}
