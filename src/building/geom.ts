// Plan geometry for buildings: where a space sits on its level, where a door is, a scene turned into its mirror image.
// Pure: no DOM, no three.
import { computeEdgeFrames } from '../core/layout-geom';
import { normalizeRoom } from '../core/layout-validate';
import type { DoorLeaf, EdgeFrame, FurnitureItem, Layout, Opening, PropertyFile, RoomTag, Vec2 } from '../types';
import type { Placement } from './types';

// ---------------------------------------------------------------- placement (turn about the scene origin, then move)

const COS: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/** A point of the space's own scene on the level's plan. x east, z south; the turn is clockwise on the plan (x towards z). */
export function toLevel(p: Vec2, pl: Placement): Vec2 {
  const c = COS[pl.rotDeg], s = SIN[pl.rotDeg];
  return { x: p.x * c - p.z * s + pl.x, z: p.x * s + p.z * c + pl.z };
}
/** A direction (no move). */
export function dirToLevel(d: Vec2, pl: Placement): Vec2 {
  const c = COS[pl.rotDeg], s = SIN[pl.rotDeg];
  return { x: d.x * c - d.z * s, z: d.x * s + d.z * c };
}
/** The inverse of toLevel: a point of the level's plan in the space's scene frame. */
export function fromLevel(p: Vec2, pl: Placement): Vec2 {
  const c = COS[pl.rotDeg], s = SIN[pl.rotDeg];
  const x = p.x - pl.x, z = p.z - pl.z;
  return { x: x * c + z * s, z: -x * s + z * c };
}
export const yawToLevel = (yawDeg: number, pl: Placement): number => yawDeg + pl.rotDeg;

export function roomsOnLevel(layout: Layout, pl: Placement): RoomTag[] {
  return layout.rooms.map((r) => normalizeRoom({ ...r, polygon: r.polygon.map((p) => toLevel(p, pl)), edges: [...r.edges] }));
}

// ---------------------------------------------------------------- a door opening in the world

export interface DoorFrame {
  openingId: string;
  roomId: string;
  edge: number;
  /** the middle of the doorway on the room's inside face line */
  centre: Vec2;
  /** unit, out of the room through the doorway */
  out: Vec2;
  /** unit, along the wall, from the edge's start to its end */
  dir: Vec2;
  widthM: number;
  headM: number;
  thicknessM: number;
  leaf: DoorLeaf | undefined;
  /** the hinge post on the inside face line, or null for a leaf with no hinge (a sliding one) */
  hinge: Vec2 | null;
}

export function doorFrame(layout: Layout, openingId: string, frames: EdgeFrame[] = computeEdgeFrames(layout)): DoorFrame | null {
  const o = layout.openings.find((q) => q.id === openingId);
  if (!o) return null;
  const f = frames.find((q) => q.roomId === o.roomId && q.edge === o.edge);
  if (!f) return null;
  const at = (u: number): Vec2 => ({ x: f.a.x + f.dir.x * u, z: f.a.z + f.dir.z * u });
  const hingeU = o.leaf?.kind === 'hinged' ? (o.leaf.hinge === 'start' ? o.centreM - o.widthM / 2 : o.centreM + o.widthM / 2) : null;
  return {
    openingId, roomId: o.roomId, edge: o.edge, centre: at(o.centreM), out: f.out, dir: f.dir, widthM: o.widthM, headM: o.headM,
    thicknessM: f.thickness, leaf: o.leaf, hinge: hingeU === null ? null : at(hingeU),
  };
}

// ---------------------------------------------------------------- mirror image (x -> -x)

/** The other way round, for the leaf's hinge: the edge now runs the other way, so start and end swap. */
function mirrorLeaf(leaf: DoorLeaf | undefined): DoorLeaf | undefined {
  return leaf ? { ...leaf, hinge: leaf.hinge === 'start' ? 'end' : 'start' } : undefined;
}

export function mirrorLayout(layout: Layout): Layout {
  const rooms: RoomTag[] = [];
  const nOf = new Map<string, number>();
  const lenOf = new Map<string, number[]>();
  for (const r of layout.rooms) {
    const flipped = { ...r, polygon: r.polygon.map((p) => ({ x: -p.x, z: p.z })), edges: [...r.edges] };
    const n = r.polygon.length;
    nOf.set(r.id, n);
    // lengths of the NEW edges, so a centre measured from the old start can be measured from the new one
    const norm = normalizeRoom(flipped);
    lenOf.set(r.id, norm.polygon.map((p, i) => { const q = norm.polygon[(i + 1) % n]; return Math.hypot(q.x - p.x, q.z - p.z); }));
    rooms.push(norm);
  }
  const openings: Opening[] = layout.openings.map((o) => {
    const n = nOf.get(o.roomId);
    if (n === undefined) return { ...o, leaf: mirrorLeaf(o.leaf) } as Opening;
    // the same segment runs the other way, and is edge n-2-edge of the mirrored room (the rule of normalizeRoom)
    const edge = (((n - 2 - o.edge) % n) + n) % n;
    const len = lenOf.get(o.roomId)![edge];
    const out: Opening = { ...o, edge, centreM: len - o.centreM };
    if (o.leaf) out.leaf = mirrorLeaf(o.leaf);
    return out;
  });
  const { underlay, ...rest } = layout;
  void underlay;
  return { ...rest, rooms, openings };
}

function mirrorItem(i: FurnitureItem): FurnitureItem {
  return { ...i, box: { ...i.box, cx: -i.box.cx, yawDeg: -i.box.yawDeg } };
}

export function mirrorProperty(p: PropertyFile, id: string, title: string, subtitle: string | undefined): PropertyFile {
  const out: PropertyFile = {
    ...p, id, title, ...(subtitle !== undefined ? { subtitle } : {}),
    layout: mirrorLayout(p.layout),
    furniture: p.furniture.map(mirrorItem),
    spawn: { x: -p.spawn.x, z: p.spawn.z, yawDeg: -p.spawn.yawDeg },
  };
  if (out.splat) delete out.splat;
  return out;
}

/**
 * designs.json for the mirror image. The heights, bed base and bay counts the sample drawings give do not depend on which way round
 * the piece stands, so they pass through. A decor piece tied to an item is placed in the item's own frame, which the mirror turns
 * round: its sideways offset changes sign. Anything else that depends on left and right (an openable wardrobe's bays) is refused
 * rather than guessed.
 */
export function mirrorDesigns(designs: unknown): unknown {
  if (!designs || typeof designs !== 'object') return designs;
  const d = JSON.parse(JSON.stringify(designs)) as { items?: Record<string, { openable?: unknown }>; decor?: { offset?: { x: number } }[] };
  for (const [id, it] of Object.entries(d.items ?? {})) {
    if (it && it.openable !== undefined) throw new Error(`mirrorDesigns: item "${id}" has an openable design, whose bays depend on left and right. Mirror it by hand.`);
  }
  for (const c of d.decor ?? []) if (c.offset) c.offset = { ...c.offset, x: -c.offset.x };
  return d;
}
