// Door leaves: the panel in each `door` opening, where it hangs, and where it can swing. Pure: no DOM, no three.
//
// Data: `Opening.leaf` (hinge side, swing side, hinged or sliding, `assumed`). The importer fills it from the drawing's swing arc
// (src/import/openings.ts, passage.ts). A door without one (an older scene, a hand-placed door) gets one here by rule, always
// marked `assumed`. Sizes are standard unless the opening says otherwise: 35 mm thick, as high as the opening's head, a 50 mm frame
// post each side (the shell's frames, SPEC 5).
//
// Frames: along the opening's edge u runs from `a` to `b`; `out` is the edge's outward normal (SPEC 3.1). The leaf hangs in the
// middle of the wall (offset depth / 2 from the room's face). 'in' swings to the opening's own room (-out), 'out' to the other
// side (+out). A hinged leaf's position is its angle (radians, 0 closed); a sliding leaf's is the distance it has slid (metres).
import { CHARACTER_RADIUS_M, GRID_FREE, GRID_VOID } from '../types';
import type { Box, DoorLeaf, Grid, Layout, Opening, RoomTag, Vec2 } from '../types';
import { cellValue } from './grid-codec';
import { distanceToSegment, pointInBox, pointInPolygon, polygonArea } from './geometry';
import { computeEdgeFrames, computeTunnels } from './layout-geom';
import { stampFurniture } from './layout-raster';

const DEG = Math.PI / 180;

/** A flush door leaf is 35 mm thick (standard; the drawing does not give it). */
export const DOOR_THICKNESS_M = 0.035;
/** Used when an opening gives no usable head height. */
export const DOOR_STANDARD_HEIGHT_M = 2.1;
/** The shell's frame posts (SPEC 5 `frames`): the leaf hangs between them. */
export const DOOR_POST_M = 0.05;
/** Gap at the free edge, metres. */
const LEAF_CLEARANCE_M = 0.008;
/** How far above the floor the panel starts, and how far under the frame head it stops. */
export const DOOR_FLOOR_GAP_M = 0.01;
const FRAME_HEAD_M = 0.05;
/**
 * Width of the strip a leaf stamps into the walk grid. This is the grid's resolution (a cell is 5 cm, a cell is "in" a shape when
 * its centre is), NOT the leaf's thickness (35 mm): thinner would let a walker slip between two cells on a diagonal.
 */
export const DOOR_STRIP_M = 0.07;
/** A hinged leaf opens to a quarter turn, unless something stops it earlier. */
export const DOOR_OPEN_RAD = Math.PI / 2;
/** A quarter turn takes this long, seconds. */
export const DOOR_SWING_SECONDS = 0.5;
/** The walker's centre may not come closer than this to the leaf's centre line while it moves: body radius + half strip + a cell. */
export const DOOR_WALKER_MARGIN_M = CHARACTER_RADIUS_M + DOOR_STRIP_M / 2 + 0.05;

export interface Door {
  /** the opening's id */
  id: string;
  roomId: string;
  edge: number;
  /** "Bedroom 1": the room this is the door of (the more private side) */
  roomLabel: string;
  /** the room the leaf swings into, or null when nothing is modelled there (the outside) */
  swingRoomId: string | null;
  /** both rooms the door joins (the second is null for an outside door) */
  rooms: [string, string | null];
  kind: DoorLeaf['kind'];
  hinge: DoorLeaf['hinge'];
  swing: DoorLeaf['swing'];
  /** true when the drawing gave no swing arc and the side was chosen by rule */
  assumed: boolean;
  /** how the leaf's thickness and height were set: 'drawing' only when the opening's head is not the standard 2.1 m */
  heightFrom: 'drawing' | 'standard';
  widthM: number;
  /** the leaf panel, between the frame posts */
  panelWidthM: number;
  /** top of the panel above the floor, metres */
  topM: number;
  headM: number;
  /** wall plane, world: the point `u` along the edge at the middle of the wall */
  edgeA: Vec2;
  dir: Vec2;
  out: Vec2;
  u0: number;
  u1: number;
  depth: number;
  /** where the leaf hangs when shut: hinge point (world) and the unit direction hinge -> free edge */
  hingeAt: Vec2;
  closedDir: Vec2;
  /** unit direction the leaf swings towards (hinged) or the face it slides along (sliding) */
  swingNormal: Vec2;
  /** the furthest position: a quarter turn (radians), or how far a sliding leaf can travel (metres) */
  maxPos: number;
}

// ---------------------------------------------------------------- leaves by rule

/** Rooms where a door is wanted on the room's own side, most private first. A passage is a type `other` like a utility room or a pooja room, so its name decides. */
const PRIVACY: Record<RoomTag['roomType'], number> = { bathroom: 0, bedroom: 1, kitchen: 2, living: 3, other: 4, balcony: 5 };
const PASSAGE_NAME = /\b(passage|lobby|corridor|foyer|hall|hallway|entrance|entry|vestibule|landing|lounge)\b/i;
const rankOf = (r: RoomTag): number => (r.roomType === 'other' && PASSAGE_NAME.test(r.label) ? 6 : PRIVACY[r.roomType] ?? 4);

const roomArea = (r: RoomTag): number => Math.abs(polygonArea(r.polygon));

/** How far a straight line from `from` along `dir` stays inside the polygon (to `maxM`). */
function runInside(poly: Vec2[], from: Vec2, dir: Vec2, maxM = 3): number {
  for (let t = 0.05; t <= maxM; t += 0.05) {
    if (!pointInPolygon({ x: from.x + dir.x * t, z: from.z + dir.z * t }, poly)) return t - 0.05;
  }
  return maxM;
}

interface Site {
  room: RoomTag;
  other: RoomTag | null;
  u0: number;
  u1: number;
  depth: number;
  a: Vec2;
  dir: Vec2;
  out: Vec2;
  length: number;
}

/** The leaf a door gets when the drawing shows no swing: into the more private room, hinged by the nearer wall. Always assumed. */
export function ruleLeaf(site: Site): DoorLeaf {
  const { room, other } = site;
  let swing: DoorLeaf['swing'] = 'in';
  if (other) {
    swing = rankOf(other) < rankOf(room) ? 'out' : 'in';
  }
  const swingRoom = swing === 'in' ? room : other;
  const sn = swing === 'in' ? { x: -site.out.x, z: -site.out.z } : { x: site.out.x, z: site.out.z };
  const mid = (site.u0 + site.u1) / 2;
  const base: Vec2 = {
    x: site.a.x + site.dir.x * mid + site.out.x * (site.depth / 2) + sn.x * 0.5,
    z: site.a.z + site.dir.z * mid + site.out.z * (site.depth / 2) + sn.z * 0.5,
  };
  // the wall the door opens against: the nearer end of the swing room along the wall
  let hinge: DoorLeaf['hinge'] = 'start';
  if (swingRoom) {
    const toStart = runInside(swingRoom.polygon, base, { x: -site.dir.x, z: -site.dir.z });
    const toEnd = runInside(swingRoom.polygon, base, site.dir);
    hinge = toStart <= toEnd ? 'start' : 'end';
  } else {
    hinge = site.u0 <= site.length - site.u1 ? 'start' : 'end';
  }
  return { hinge, swing, kind: 'hinged', assumed: true };
}

// ---------------------------------------------------------------- resolving every door of a layout

/** The rooms on each side of a door, from points a little to either side of the wall's middle. */
function sideRooms(layout: Layout, site: { a: Vec2; dir: Vec2; out: Vec2; depth: number; u0: number; u1: number }, own: RoomTag): { other: RoomTag | null } {
  const mid = (site.u0 + site.u1) / 2;
  const at = (o: number): Vec2 => ({ x: site.a.x + site.dir.x * mid + site.out.x * o, z: site.a.z + site.dir.z * mid + site.out.z * o });
  for (const o of [site.depth + 0.15, site.depth + 0.4]) {
    const p = at(o);
    const hit = layout.rooms.find((r) => r.id !== own.id && pointInPolygon(p, r.polygon));
    if (hit) return { other: hit };
  }
  return { other: null };
}

/**
 * Every door that gets a leaf: openings of type `door` on a wall edge, except a door between a whole room and a `partial` one (the
 * drawing ends there; the shell draws that doorway as the drawing's edge). The leaf is the opening's own, or the rule's.
 */
export function resolveDoors(layout: Layout): Door[] {
  const frames = computeEdgeFrames(layout);
  const tunnels = computeTunnels(layout);
  const frameOf = new Map(frames.map((f) => [`${f.roomId}:${f.edge}`, f]));
  const tunnelOf = new Map(tunnels.filter((t) => t.openingId !== null).map((t) => [t.openingId as string, t]));
  const out: Door[] = [];
  for (const o of layout.openings) {
    if (o.type !== 'door') continue;
    const room = layout.rooms.find((r) => r.id === o.roomId);
    const f = frameOf.get(`${o.roomId}:${o.edge}`);
    const t = tunnelOf.get(o.id);
    if (!room || !f || !t || f.kind === 'none' || room.partial) continue;
    const site = { room, other: null as RoomTag | null, u0: t.u0, u1: t.u1, depth: t.depth, a: f.a, dir: f.dir, out: f.out, length: f.length };
    site.other = sideRooms(layout, site, room).other;
    if (site.other?.partial) continue;
    const d = buildDoor(layout, o, site);
    if (d) out.push(d);
  }
  return out;
}

function buildDoor(layout: Layout, o: Opening, site: Site): Door | null {
  const leaf = o.leaf ?? ruleLeaf(site);
  const { room, other, u0, u1, depth } = site;
  const width = u1 - u0;
  if (!(width > 0.3)) return null;
  const edgeLen = site.length;
  const sn: Vec2 = leaf.swing === 'in' ? { x: -site.out.x, z: -site.out.z } : { x: site.out.x, z: site.out.z };
  const swingRoom = leaf.swing === 'in' ? room : other;
  const labelRoom = other && rankOf(other) < rankOf(room) ? other : room;
  const planeAt = (u: number): Vec2 => ({
    x: site.a.x + site.dir.x * u + site.out.x * (depth / 2),
    z: site.a.z + site.dir.z * u + site.out.z * (depth / 2),
  });
  const headM = Number.isFinite(o.headM) && o.headM >= 1.8 && o.headM <= layout.wallHeightM ? o.headM : DOOR_STANDARD_HEIGHT_M;
  const common = {
    id: o.id, roomId: room.id, edge: o.edge, roomLabel: labelRoom.label || labelRoom.id, swingRoomId: swingRoom?.id ?? null,
    rooms: [room.id, other?.id ?? null] as [string, string | null],
    kind: leaf.kind, hinge: leaf.hinge, swing: leaf.swing, assumed: !!leaf.assumed,
    heightFrom: Math.abs(headM - DOOR_STANDARD_HEIGHT_M) > 1e-6 ? ('drawing' as const) : ('standard' as const),
    widthM: width, topM: headM - FRAME_HEAD_M - 0.002, headM,
    edgeA: site.a, dir: site.dir, out: site.out, u0, u1, depth, swingNormal: sn,
  };
  if (leaf.kind === 'sliding') {
    // a sliding leaf parks in front of the wall beside the opening, on its swing side; it can travel as far as that wall runs
    const room2 = (leaf.hinge === 'start' ? u0 : edgeLen - u1) - 0.02;
    // a little narrower than the opening, so it neither touches the jambs nor reads as overlapping them
    const panel = width - 0.06;
    const closedDir = { x: site.dir.x * (leaf.hinge === 'start' ? 1 : -1), z: site.dir.z * (leaf.hinge === 'start' ? 1 : -1) };
    return {
      ...common, panelWidthM: panel, hingeAt: planeAt(leaf.hinge === 'start' ? u0 + 0.03 : u1 - 0.03), closedDir,
      maxPos: room2 > 0.3 ? depth / 2 + SLIDE_PROUD_M + Math.min(panel, room2) : 0,
    };
  }
  const panel = Math.max(0.2, width - 2 * DOOR_POST_M - LEAF_CLEARANCE_M);
  const hingeU = leaf.hinge === 'start' ? u0 + DOOR_POST_M : u1 - DOOR_POST_M;
  const closedDir = { x: site.dir.x * (leaf.hinge === 'start' ? 1 : -1), z: site.dir.z * (leaf.hinge === 'start' ? 1 : -1) };
  return { ...common, panelWidthM: panel, hingeAt: planeAt(hingeU), closedDir, maxPos: DOOR_OPEN_RAD };
}

// ---------------------------------------------------------------- the leaf at a position

export interface LeafSegment { a: Vec2; b: Vec2; /** unit direction a -> b */ dir: Vec2 }

/** A sliding leaf first steps out in front of the wall face by this much more than half the wall (so it clears the wall's cells), then slides. */
const SLIDE_PROUD_M = 0.04;
/** How far a sliding leaf steps out before it slides: it is the first part of its travel. */
export const slideLiftM = (d: Door): number => d.depth / 2 + SLIDE_PROUD_M;

/** The leaf's centre line at `pos` (angle for a hinged leaf; for a sliding one metres of travel, first stepping out, then sliding). */
export function leafSegment(d: Door, pos: number): LeafSegment {
  if (d.kind === 'sliding') {
    const lift = Math.min(Math.max(0, pos), slideLiftM(d));
    const slide = Math.max(0, pos - slideLiftM(d));
    // slides along the wall away from the doorway, towards the hinge side
    const away = { x: -d.closedDir.x, z: -d.closedDir.z };
    const shift = { x: away.x * slide + d.swingNormal.x * lift, z: away.z * slide + d.swingNormal.z * lift };
    const a = { x: d.hingeAt.x + shift.x, z: d.hingeAt.z + shift.z };
    const dir = d.closedDir;
    return { a, b: { x: a.x + dir.x * d.panelWidthM, z: a.z + dir.z * d.panelWidthM }, dir };
  }
  const c = Math.cos(pos);
  const s = Math.sin(pos);
  const dir = { x: d.closedDir.x * c + d.swingNormal.x * s, z: d.closedDir.z * c + d.swingNormal.z * s };
  return { a: d.hingeAt, b: { x: d.hingeAt.x + dir.x * d.panelWidthM, z: d.hingeAt.z + dir.z * d.panelWidthM }, dir };
}

/**
 * The thin box the leaf stamps into the walk grid at `pos`, full panel height. Shut, it runs from jamb to jamb (past the posts, so
 * nothing slips between it and the wall); ajar, it is the panel itself.
 */
export function leafObstacle(d: Door, pos: number): { box: Box; heightM: number } {
  let seg = leafSegment(d, pos);
  if (d.kind === 'hinged' && pos <= 1e-6) {
    const a = { x: d.edgeA.x + d.dir.x * (d.u0 - 0.03) + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * (d.u0 - 0.03) + d.out.z * (d.depth / 2) };
    const b = { x: d.edgeA.x + d.dir.x * (d.u1 + 0.03) + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * (d.u1 + 0.03) + d.out.z * (d.depth / 2) };
    seg = { a, b, dir: d.dir };
  } else if (d.kind === 'sliding' && pos <= 1e-6) {
    const a = { x: d.edgeA.x + d.dir.x * (d.u0 - 0.03) + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * (d.u0 - 0.03) + d.out.z * (d.depth / 2) };
    const b = { x: d.edgeA.x + d.dir.x * (d.u1 + 0.03) + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * (d.u1 + 0.03) + d.out.z * (d.depth / 2) };
    seg = { a, b, dir: d.dir };
  }
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
  const yawDeg = (((Math.atan2(seg.dir.x, seg.dir.z) / DEG) % 360) + 360) % 360;
  return {
    box: { cx: (seg.a.x + seg.b.x) / 2, cz: (seg.a.z + seg.b.z) / 2, w: DOOR_STRIP_M, d: len, yawDeg },
    heightM: d.topM,
  };
}

// ---------------------------------------------------------------- what a leaf touches

export type LeafHit = 'free' | 'obstacle' | 'void';

/**
 * Does the leaf at `pos` overlap a non-free cell of `grid`? `grid` must not hold this door's own stamp. Samples the panel every
 * 3 cm along its length and on both faces (half the strip either side). 'void' means it reaches past the drawn floor (an outside
 * door opening onto nothing), 'obstacle' a wall, furniture or another door.
 */
export function leafHitsGrid(grid: Grid, d: Door, pos: number): LeafHit {
  const seg = leafSegment(d, pos);
  const len = d.panelWidthM;
  const nx = -seg.dir.z, nz = seg.dir.x;
  const half = DOOR_STRIP_M / 2;
  let worst: LeafHit = 'free';
  for (let r = 0; r <= len + 1e-9; r += 0.03) {
    const rr = Math.min(r, len);
    const x = seg.a.x + seg.dir.x * rr, z = seg.a.z + seg.dir.z * rr;
    for (const k of [-half, 0, half]) {
      const v = cellValue(grid, x + nx * k, z + nz * k);
      if (v === GRID_FREE) continue;
      if (v === GRID_VOID) { worst = 'void'; continue; }
      return 'obstacle';
    }
  }
  return worst;
}

/** The furthest `pos` (up to the door's maximum) a leaf reaches stepping from `from` before it touches something in `grid`. */
export function freePos(grid: Grid, d: Door, from = 0, step = d.kind === 'sliding' ? 0.03 : DEG): { pos: number; hit: LeafHit } {
  let pos = from;
  let hit: LeafHit = 'free';
  while (pos < d.maxPos - 1e-9) {
    const next = Math.min(d.maxPos, pos + step);
    const h = leafHitsGrid(grid, d, next);
    if (h !== 'free') { hit = h; break; }
    pos = next;
  }
  return { pos, hit };
}

/** Distance from a point to the leaf's centre line at `pos`. */
export function distanceToLeaf(d: Door, pos: number, p: Vec2): number {
  const s = leafSegment(d, pos);
  return distanceToSegment(p, s.a, s.b);
}

/** True when a walker standing at `p` is too close to the leaf to let it be at `pos` (it would be touching, or inside, the panel). */
export function walkerInLeaf(d: Door, pos: number, p: Vec2, margin = DOOR_WALKER_MARGIN_M): boolean {
  return distanceToLeaf(d, pos, p) < margin;
}

/** The leaf (at `posA`) against another door's leaf (at `posB`): do the two panels touch? */
export function leavesTouch(a: Door, posA: number, b: Door, posB: number): boolean {
  const s = leafSegment(a, posA), t = leafSegment(b, posB);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const p = { x: s.a.x + ((s.b.x - s.a.x) * i) / steps, z: s.a.z + ((s.b.z - s.a.z) * i) / steps };
    if (distanceToSegment(p, t.a, t.b) < DOOR_STRIP_M) return true;
  }
  return false;
}

/**
 * The furthest a door can open before a furniture box stops it, as a position, or null when the box is clear of the whole sweep.
 * Only the box matters here (walls and the walker are checked elsewhere): the leaf is stepped from shut to its maximum and the
 * first position that puts either face of the panel inside the box is the stop.
 */
export function boxStopsDoorAt(d: Door, box: Box): number | null {
  const step = d.kind === 'sliding' ? 0.03 : DEG;
  const half = DOOR_STRIP_M / 2;
  for (let pos = 0; pos <= d.maxPos + 1e-9; pos += step) {
    const p = Math.min(pos, d.maxPos);
    const seg = leafSegment(d, p);
    const nx = -seg.dir.z, nz = seg.dir.x;
    for (let r = 0; r <= d.panelWidthM + 1e-9; r += 0.02) {
      const rr = Math.min(r, d.panelWidthM);
      const x = seg.a.x + seg.dir.x * rr, z = seg.a.z + seg.dir.z * rr;
      for (const k of [-half, 0, half]) {
        if (pointInBox({ x: x + nx * k, z: z + nz * k }, box)) return p;
      }
    }
  }
  return null;
}

/** True when the walker disc at `p` (radius `r`) lies on the leaf or in the sweep of any door (any position from shut to open). */
export function inDoorSweep(doors: Door[], p: Vec2, r = CHARACTER_RADIUS_M): boolean {
  for (const d of doors) {
    const step = d.kind === 'sliding' ? Math.max(0.05, d.maxPos / 8) : 5 * DEG;
    for (let pos = 0; pos <= d.maxPos + 1e-9; pos += step) {
      if (distanceToLeaf(d, Math.min(pos, d.maxPos), p) < r + DOOR_STRIP_M / 2) return true;
    }
    if (distanceToLeaf(d, d.maxPos, p) < r + DOOR_STRIP_M / 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------- words

/** "Blocks the Bedroom door from opening." and its softer form, or null when the box leaves the door free. */
export function doorBlockSentence(d: Door, box: Box): string | null {
  const stop = boxStopsDoorAt(d, box);
  if (stop === null) return null;
  if (d.kind === 'sliding') return `Blocks the ${d.roomLabel} door from sliding open.`;
  // a door that still opens past about 45 degrees can be walked through; less than that and it is blocked
  if (stop < 45 * DEG) return `Blocks the ${d.roomLabel} door from opening.`;
  return `Stops the ${d.roomLabel} door opening fully.`;
}

/** The standard-size note, worded like the seat-height card's (SPEC 16.2: say what the drawing did not give). */
export const DOOR_STANDARD_NOTE = 'Thickness (35 mm) is a standard assumption. The drawing does not give it.';
export const DOOR_SWING_ASSUMED_NOTE = 'Swing side assumed: the drawing does not show it';

// ---------------------------------------------------------------- the frame posts, for the drawn body

/**
 * The frame posts of every door (SPEC 5 `frames`: 50 mm each side, inside the hole, through the wall) as thin boxes. The walk grid leaves
 * them out on purpose (a 0.62 m toilet door keeps its full width for the walker's circle), but the body is drawn between them (SPEC 4.12).
 */
export function doorPosts(doors: Door[]): { box: Box; heightM: number }[] {
  const out: { box: Box; heightM: number }[] = [];
  for (const d of doors) {
    const w = Math.min(DOOR_POST_M, (d.u1 - d.u0) / 2);
    const depth = Math.max(d.depth, 0.02);
    const yawDeg = (((Math.atan2(d.out.x, d.out.z) / DEG) % 360) + 360) % 360;
    for (const u of [d.u0 + w / 2, d.u1 - w / 2]) {
      out.push({
        box: { cx: d.edgeA.x + d.dir.x * u + d.out.x * (depth / 2), cz: d.edgeA.z + d.dir.z * u + d.out.z * (depth / 2), w, d: depth, yawDeg },
        heightM: d.headM,
      });
    }
  }
  return out;
}

/**
 * Returns a function that gives a walk grid with this layout's frame posts stamped on it: the grid the drawn body is fitted to. The
 * result is kept per source grid, so asking every frame costs nothing until the walk grid itself is replaced.
 */
export function bodyGridOf(layout: Layout): (walk: Grid) => Grid {
  const posts = doorPosts(resolveDoors(layout)).map((o, i) => ({
    id: `door-post:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'door frame', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM,
  }));
  let kept: { src: Grid; out: Grid } | null = null;
  return (walk) => {
    if (posts.length === 0) return walk;
    if (!kept || kept.src !== walk) kept = { src: walk, out: stampFurniture(walk, posts) };
    return kept.out;
  };
}
