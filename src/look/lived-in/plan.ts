// "Lived-in" decor: WHERE everyday Indian-home decor goes. Pure (no three, no DOM), deterministic for a given home.
//
// The honesty rule (SPEC 16.2): decor is never a fact about the property and must never change one. So this file only READS the
// layout, the real furniture and the walking grid; it never edits them, and what it places is kept out of the grid and out of the
// measure tool's raycasts (see index.ts / build.ts). Placement rules, all enforced here:
//   - never in a room that is `partial` (its shape is a guess), never outside a room's polygon;
//   - floor pieces (plant, shoes) stand on cells the grid says are free, away from every doorway and open edge, and must not cut the
//     walkable floor in two (a flood fill at the character's radius, before and after);
//   - the rug is flat: it may run under its sofa but never across a doorway or another piece of furniture;
//   - surface pieces (cushions, books, kitchen things) sit on the top of an existing real item, inside its box, at its surface height;
//   - wall pieces (curtains, clock, picture, pooja shelf) hang on a plain wall edge, clear of every door and window and of anything
//     tall that stands against the wall.
import { CHARACTER_RADIUS_M, GRID_FREE } from '../../types';
import type { Box, EdgeFrame, FurnitureItem, Grid, Layout, Opening, RoomTag, Vec2 } from '../../types';
import { computeEdgeFrames } from '../../core/layout-geom';
import { boxAxes, boxCorners, distanceToPolygon, distanceToSegment, mulberry32, pointInBox, pointInPolygon } from '../../core/geometry';
import { cellIndex } from '../../core/grid-codec';
import { furnitureLook } from '../furniture-real';

export type DecorKind =
  | 'cushion' | 'throw' | 'books' | 'lamp' | 'cooker' | 'dabbas' | 'fruit' | 'jug'
  | 'plant' | 'rug' | 'shoes' | 'curtain' | 'clock' | 'frame' | 'pooja';

export type DecorPlace = 'floor' | 'surface' | 'wall';

export interface DecorPiece {
  id: string;
  kind: DecorKind;
  roomId: string;
  place: DecorPlace;
  /** world position of the piece's origin: the centre of its base for floor and surface pieces, the point on the wall plane for wall pieces */
  x: number;
  y: number;
  z: number;
  /** heading as a Box's yawDeg: local +Z (the piece's front) is (sin yaw, cos yaw). For a wall piece it faces into the room. */
  yawDeg: number;
  /** plan footprint: width along local x, depth along local z */
  w: number;
  d: number;
  /** overall height above `y` */
  height: number;
  /** the real item this sits on (surface pieces) */
  hostId?: string;
  seed: number;
  /** 0..7: which colour of the warm palette */
  tone: number;
  /** a cushion's lean back, degrees */
  tiltDeg?: number;
}

export interface PlanInput {
  layout: Layout;
  /** the real furniture; virtual items are ignored */
  items: FurnitureItem[];
  /** the walking grid with the real furniture (and the chairs) stamped in; never edited here */
  grid: Grid;
}

/** The footprint of a piece in plan, as a Box. For a wall piece the box starts at the wall and reaches into the room. */
export function pieceBox(p: Pick<DecorPiece, 'x' | 'z' | 'yawDeg' | 'w' | 'd' | 'place'>): Box {
  if (p.place !== 'wall') return { cx: p.x, cz: p.z, w: p.w, d: p.d, yawDeg: p.yawDeg };
  const { a } = boxAxes({ cx: 0, cz: 0, w: 1, d: 1, yawDeg: p.yawDeg });
  return { cx: p.x + a.x * p.d / 2, cz: p.z + a.z * p.d / 2, w: p.w, d: p.d, yawDeg: p.yawDeg };
}

const DEG = Math.PI / 180;
const POOJA_RE = /pooja|puja|mandir|mandap|prayer/i;
/** footprint sampling step, metres */
const STEP = 0.05;
/** doors: how far from a doorway's centre floor pieces keep, beyond half its width */
const DOOR_KEEP_M = 0.7;
/** extra walkway kept around a floor piece when checking the floor stays connected */
const WALKWAY_EXTRA_M = 0.25;
const MAX_FLOOR_PLANTS_BEDROOM = 1;
/** a patch of walkable floor smaller than this (0.3 m2) does not count as a place when checking the floor stays in one piece */
const MIN_PLACE_CELLS = 120;

// ---------------------------------------------------------------- small geometry

const world = (box: Box, lx: number, lz: number): Vec2 => {
  const { a, b } = boxAxes(box);
  return { x: box.cx + a.x * lz + b.x * lx, z: box.cz + a.z * lz + b.z * lx };
};

/** Points covering a box (its corners, edge midpoints and a STEP lattice), for "is all of it on free floor". */
function samples(box: Box, inset = 0): Vec2[] {
  const out: Vec2[] = [];
  const hw = Math.max(0, box.w / 2 - inset), hd = Math.max(0, box.d / 2 - inset);
  const nx = Math.max(1, Math.ceil((2 * hw) / STEP)), nz = Math.max(1, Math.ceil((2 * hd) / STEP));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push(world(box, -hw + (2 * hw * i) / nx, -hd + (2 * hd * j) / nz));
  return out;
}

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  const ca = boxCorners({ ...a, w: a.w + 2 * pad, d: a.d + 2 * pad });
  for (const p of ca) if (pointInBox(p, b)) return true;
  const cb = boxCorners(b);
  for (const p of cb) if (pointInBox(p, { ...a, w: a.w + 2 * pad, d: a.d + 2 * pad })) return true;
  // crossing edges with no corner inside the other (a plus sign)
  const grow = { ...a, w: a.w + 2 * pad, d: a.d + 2 * pad };
  for (const p of samples(grow)) if (pointInBox(p, b)) return true;
  return false;
}

// ---------------------------------------------------------------- the walkable floor

/** The character-sized walkable floor, so a piece can be tested for "does this cut the home in two". */
class Walk {
  readonly nx: number;
  readonly nz: number;
  private readonly base: Uint8Array;
  private blocked: Uint8Array;
  private baseline: number;
  constructor(private readonly grid: Grid, r: number) {
    this.nx = grid.nx;
    this.nz = grid.nz;
    this.base = new Uint8Array(grid.nx * grid.nz);
    const c = grid.cellM;
    const reach = Math.ceil(r / c);
    const r2 = r * r;
    for (let j = 0; j < grid.nz; j++) {
      for (let i = 0; i < grid.nx; i++) {
        if (grid.cells[j * grid.nx + i] !== GRID_FREE) continue;
        let ok = true;
        for (let dj = -reach; dj <= reach && ok; dj++) {
          for (let di = -reach; di <= reach; di++) {
            if ((di * di + dj * dj) * c * c > r2) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= grid.nx || jj >= grid.nz || grid.cells[jj * grid.nx + ii] !== GRID_FREE) { ok = false; break; }
          }
        }
        if (ok) this.base[j * grid.nx + i] = 1;
      }
    }
    this.blocked = new Uint8Array(grid.nx * grid.nz);
    this.baseline = this.count(null);
  }
  private count(extra: Uint8Array | null): number {
    const { nx, nz, base, blocked } = this;
    const seen = new Uint8Array(nx * nz);
    const stack: number[] = [];
    let comps = 0;
    for (let s = 0; s < nx * nz; s++) {
      if (!base[s] || blocked[s] || (extra && extra[s]) || seen[s]) continue;
      seen[s] = 1;
      stack.push(s);
      let size = 0;
      while (stack.length) {
        const k = stack.pop()!;
        size++;
        const i = k % nx, j = (k - i) / nx;
        for (let n = 0; n < 4; n++) {
          const ii = i + (n === 0 ? 1 : n === 1 ? -1 : 0), jj = j + (n === 2 ? 1 : n === 3 ? -1 : 0);
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const q = jj * nx + ii;
          if (!base[q] || blocked[q] || (extra && extra[q]) || seen[q]) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      // a sliver of floor nobody could stand in (a hand's breadth between a wall and a cupboard) is not a place to keep open
      if (size >= MIN_PLACE_CELLS) comps++;
    }
    return comps;
  }
  private stamp(cx: number, cz: number, r: number): Uint8Array {
    const out = new Uint8Array(this.nx * this.nz);
    const c = this.grid.cellM;
    const i0 = Math.floor((cx - r - this.grid.originX) / c), i1 = Math.floor((cx + r - this.grid.originX) / c);
    const j0 = Math.floor((cz - r - this.grid.originZ) / c), j1 = Math.floor((cz + r - this.grid.originZ) / c);
    for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const x = this.grid.originX + (i + 0.5) * c, z = this.grid.originZ + (j + 0.5) * c;
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) out[j * this.nx + i] = 1;
      }
    }
    return out;
  }
  /** Blocks a disc (a piece plus a walkway around it) if that leaves the walkable floor in no more pieces than before. */
  tryBlock(cx: number, cz: number, r: number): boolean {
    const extra = this.stamp(cx, cz, r);
    const n = this.count(extra);
    if (n > this.baseline) return false;
    for (let k = 0; k < extra.length; k++) if (extra[k]) this.blocked[k] = 1;
    this.baseline = n;
    return true;
  }
}

// ---------------------------------------------------------------- the planner

interface DoorInfo { opening: Opening; at: Vec2; frame: EdgeFrame; entry: boolean }

class Planner {
  readonly pieces: DecorPiece[] = [];
  private readonly frames: EdgeFrame[];
  private readonly frameOf = new Map<string, EdgeFrame>();
  private readonly doors: DoorInfo[] = [];
  private readonly whole: RoomTag[];
  private readonly partial: RoomTag[];
  private readonly items: FurnitureItem[];
  private readonly walk: Walk;
  private readonly floorBoxes: Box[] = [];
  private counter = 0;

  constructor(private readonly input: PlanInput) {
    const { layout } = input;
    this.frames = computeEdgeFrames(layout);
    for (const f of this.frames) this.frameOf.set(`${f.roomId}:${f.edge}`, f);
    this.whole = layout.rooms.filter((r) => !r.partial && r.polygon.length >= 3);
    this.partial = layout.rooms.filter((r) => r.partial);
    this.items = input.items.filter((i) => i.source === 'real');
    this.walk = new Walk(input.grid, CHARACTER_RADIUS_M);
    for (const o of layout.openings) {
      if (o.type === 'window') continue;
      const f = this.frameOf.get(`${o.roomId}:${o.edge}`);
      if (!f) continue;
      const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
      // an entry door leads nowhere: no other room's outline lies within a wall's thickness of it
      const leads = layout.rooms.some((r) => r.id !== o.roomId && distanceToPolygon(at, r.polygon) <= 0.6);
      this.doors.push({ opening: o, at, frame: f, entry: !leads });
    }
  }

  // ---- shared checks

  private roomAt(p: Vec2): RoomTag | null {
    for (const r of this.input.layout.rooms) if (pointInPolygon(p, r.polygon)) return r;
    return null;
  }
  private insidePartial(p: Vec2): boolean {
    return this.partial.some((r) => pointInPolygon(p, r.polygon));
  }
  private seedFor(roomId: string, what: string): number {
    let h = 2166136261;
    for (const ch of `${roomId}|${what}|${this.counter}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  private push(p: Omit<DecorPiece, 'id' | 'seed' | 'tone'>, key = '', tone?: number): DecorPiece {
    const seed = this.seedFor(p.roomId, `${p.kind}${key}`);
    const piece: DecorPiece = { ...p, id: `${p.kind}-${this.counter++}`, seed, tone: tone ?? Math.floor(mulberry32(seed)() * 8) };
    this.pieces.push(piece);
    return piece;
  }
  /** is the point on a free cell of the walking grid (or inside one of `allow`'s boxes)? */
  private freeAt(p: Vec2, allow: Box[] = []): boolean {
    const k = cellIndex(this.input.grid, p.x, p.z);
    if (k >= 0 && this.input.grid.cells[k] === GRID_FREE) return true;
    return allow.some((b) => pointInBox(p, b, -0.02));
  }
  /** all of the box is inside `room`, on free floor, and in no partial room */
  private onFreeFloor(box: Box, room: RoomTag, allow: Box[] = []): boolean {
    for (const p of samples(box)) {
      if (!pointInPolygon(p, room.polygon) || this.insidePartial(p) || !this.freeAt(p, allow)) return false;
    }
    return true;
  }
  /** a doorway or an open edge within reach of the box */
  private nearDoorway(box: Box, keepM: number, except?: Opening): boolean {
    const pts = samples(box);
    for (const d of this.doors) {
      if (except && d.opening.id === except.id) continue;
      const r = Math.max(0.45, d.opening.widthM / 2) + keepM;
      if (pts.some((p) => Math.hypot(p.x - d.at.x, p.z - d.at.z) < r)) return true;
    }
    for (const f of this.frames) {
      if (f.kind !== 'none') continue;
      if (pts.some((p) => distanceToSegment(p, f.a, f.b) < keepM + 0.2)) return true;
    }
    return false;
  }
  private clashesFloor(box: Box): boolean {
    return this.floorBoxes.some((b) => boxesOverlap(box, b, 0.1));
  }
  private itemRoom(it: FurnitureItem): RoomTag | null {
    const r = this.roomAt({ x: it.box.cx, z: it.box.cz });
    return r && !r.partial ? r : null;
  }

  // ---- floor pieces

  /** Places a floor piece on the first of `candidates` that passes every rule; returns it or null. */
  private placeFloor(kind: DecorKind, room: RoomTag, candidates: { x: number; z: number; yawDeg: number }[], w: number, d: number, height: number, opts: { doorKeepM?: number; except?: Opening } = {}): DecorPiece | null {
    for (const c of candidates) {
      const box: Box = { cx: c.x, cz: c.z, w, d, yawDeg: c.yawDeg };
      if (!this.onFreeFloor(box, room)) continue;
      if (this.nearDoorway(box, opts.doorKeepM ?? DOOR_KEEP_M, opts.except)) continue;
      if (this.clashesFloor(box)) continue;
      if (!this.walk.tryBlock(c.x, c.z, Math.hypot(w, d) / 2 + CHARACTER_RADIUS_M + WALKWAY_EXTRA_M)) continue;
      this.floorBoxes.push(box);
      return this.push({ kind, roomId: room.id, place: 'floor', x: c.x, y: 0, z: c.z, yawDeg: c.yawDeg, w, d, height });
    }
    return null;
  }

  private windowsOf(room: RoomTag): { o: Opening; f: EdgeFrame }[] {
    const out: { o: Opening; f: EdgeFrame }[] = [];
    for (const o of this.input.layout.openings) {
      if (o.type !== 'window' || o.roomId !== room.id) continue;
      const f = this.frameOf.get(`${o.roomId}:${o.edge}`);
      if (f && f.kind === 'wall') out.push({ o, f });
    }
    return out;
  }

  private plantFor(room: RoomTag): DecorPiece | null {
    const cands: { x: number; z: number; yawDeg: number }[] = [];
    const inward = (f: EdgeFrame): Vec2 => ({ x: -f.out.x, z: -f.out.z });
    for (const { o, f } of this.windowsOf(room)) {
      const n = inward(f);
      const yaw = Math.atan2(n.x, n.z) / DEG;
      for (const u of [o.centreM - o.widthM / 2 - 0.2, o.centreM + o.widthM / 2 + 0.2, o.centreM]) {
        if (u < 0.3 || u > f.length - 0.3) continue;
        cands.push({ x: f.a.x + f.dir.x * u + n.x * 0.24, z: f.a.z + f.dir.z * u + n.z * 0.24, yawDeg: yaw });
      }
    }
    // then the room's corners: where a pot would stand and nobody walks
    const poly = room.polygon;
    const L = poly.length;
    for (let i = 0; i < L; i++) {
      const prev = poly[(i + L - 1) % L], v = poly[i], next = poly[(i + 1) % L];
      const e1 = unit(next.x - v.x, next.z - v.z), e0 = unit(prev.x - v.x, prev.z - v.z);
      if (Math.abs(e1.x * e0.x + e1.z * e0.z) > 0.3) continue; // not a corner
      const p = { x: v.x + (e1.x + e0.x) * 0.26, z: v.z + (e1.z + e0.z) * 0.26 };
      if (!pointInPolygon(p, poly)) continue;
      cands.push({ x: p.x, z: p.z, yawDeg: (Math.atan2(-(e1.x + e0.x), -(e1.z + e0.z)) / DEG) });
    }
    return this.placeFloor('plant', room, cands, 0.36, 0.36, 0.78);
  }

  private rugFor(room: RoomTag): DecorPiece | null {
    const sofa = this.items.find((i) => i.kind === 'sofa' && i.box.w >= 1.2 && i.box.d <= 1.3 && this.itemRoom(i)?.id === room.id);
    const others = this.items.filter((i) => i !== sofa).map((i) => i.box);
    const tryBox = (box: Box, allow: Box[]): boolean => {
      if (!this.onFreeFloor(box, room, allow)) return false;
      if (others.some((b) => boxesOverlap(box, b, 0.02))) return false;
      if (this.nearDoorway(box, 0.35)) return false;
      return true;
    };
    const cands: Box[] = [];
    if (sofa) {
      for (const k of [1, 0.85, 0.7]) {
        const W = Math.min(2.4, Math.max(1.4, sofa.box.w + 0.1)) * k, D = 1.6 * k;
        const centre = world(sofa.box, 0, sofa.box.d / 2 - 0.25 + D / 2);
        cands.push({ cx: centre.x, cz: centre.z, w: W, d: D, yawDeg: sofa.box.yawDeg });
      }
    }
    // no sofa (or no room in front of it): the roomiest spot, lined up with the room's longest wall
    const longest = this.frames.filter((f) => f.roomId === room.id && f.kind === 'wall').sort((a, b) => b.length - a.length)[0];
    if (longest) {
      const yaw = Math.atan2(longest.out.x, longest.out.z) / DEG;
      const c = centroidOf(room.polygon);
      for (const k of [1, 0.8, 0.65]) cands.push({ cx: c.x, cz: c.z, w: 1.9 * k, d: 1.3 * k, yawDeg: yaw });
    }
    for (const box of cands) {
      if (!tryBox(box, sofa ? [sofa.box] : [])) continue;
      return this.push({ kind: 'rug', roomId: room.id, place: 'floor', x: box.cx, y: 0.008, z: box.cz, yawDeg: box.yawDeg, w: box.w, d: box.d, height: 0.012 }, 'rug');
    }
    return null;
  }

  private shoes(): void {
    const entries = this.doors.filter((d) => d.entry && this.whole.some((r) => r.id === d.opening.roomId));
    // the door of the living room first, else the widest
    entries.sort((a, b) => {
      const la = this.whole.find((r) => r.id === a.opening.roomId)?.roomType === 'living' ? 1 : 0;
      const lb = this.whole.find((r) => r.id === b.opening.roomId)?.roomType === 'living' ? 1 : 0;
      return lb - la || b.opening.widthM - a.opening.widthM;
    });
    const d = entries[0];
    if (!d) return;
    const room = this.whole.find((r) => r.id === d.opening.roomId)!;
    const f = d.frame;
    const n = { x: -f.out.x, z: -f.out.z };
    const toWall = Math.atan2(f.out.x, f.out.z) / DEG; // toes to the wall
    const cands: { x: number; z: number; yawDeg: number }[] = [];
    const along = d.opening.widthM / 2 + 0.5;
    for (const s of [1, -1]) {
      const u = d.opening.centreM + s * along;
      if (u < 0.35 || u > f.length - 0.35) continue;
      cands.push({ x: f.a.x + f.dir.x * u + n.x * 0.18, z: f.a.z + f.dir.z * u + n.z * 0.18, yawDeg: toWall });
    }
    // the sides are tried with the entry door's own keep-out only as wide as the door itself
    this.placeFloor('shoes', room, cands, 0.56, 0.3, 0.12, { doorKeepM: 0.12, except: d.opening });
  }

  // ---- wall pieces

  /** wall edges of whole rooms, with the stretches of them that something occupies */
  private wallBlocks(f: EdgeFrame, bottomY: number): { u0: number; u1: number }[] {
    const out: { u0: number; u1: number }[] = [];
    for (const o of this.input.layout.openings) {
      if (o.roomId !== f.roomId || o.edge !== f.edge) continue;
      out.push({ u0: o.centreM - o.widthM / 2 - 0.1, u1: o.centreM + o.widthM / 2 + 0.1 });
    }
    // an opening cut into the facing room's wall at this spot (a door seen from both sides)
    for (const d of this.doors) {
      if (d.frame === f) continue;
      const rel = { x: d.at.x - f.a.x, z: d.at.z - f.a.z };
      const u = rel.x * f.dir.x + rel.z * f.dir.z, o = rel.x * f.out.x + rel.z * f.out.z;
      if (Math.abs(o) < 0.5) out.push({ u0: u - d.opening.widthM / 2 - 0.1, u1: u + d.opening.widthM / 2 + 0.1 });
    }
    for (const it of this.items) {
      if (it.heightM <= bottomY - 0.05) continue;
      let lo = Infinity, hi = -Infinity, near = false;
      for (const c of boxCorners(it.box)) {
        const rel = { x: c.x - f.a.x, z: c.z - f.a.z };
        lo = Math.min(lo, rel.x * f.dir.x + rel.z * f.dir.z);
        hi = Math.max(hi, rel.x * f.dir.x + rel.z * f.dir.z);
        if (rel.x * f.out.x + rel.z * f.out.z > -0.45) near = true;
      }
      if (near) out.push({ u0: lo - 0.05, u1: hi + 0.05 });
    }
    return out;
  }
  private wallFree(f: EdgeFrame, u0: number, u1: number, bottomY: number): boolean {
    if (u0 < 0.12 || u1 > f.length - 0.12) return false;
    return !this.wallBlocks(f, bottomY).some((b) => u0 < b.u1 && u1 > b.u0);
  }
  private wallPiece(kind: DecorKind, room: RoomTag, f: EdgeFrame, u: number, y: number, w: number, d: number, height: number): DecorPiece {
    return this.push({
      kind, roomId: room.id, place: 'wall',
      x: f.a.x + f.dir.x * u, y, z: f.a.z + f.dir.z * u,
      yawDeg: Math.atan2(-f.out.x, -f.out.z) / DEG, w, d, height,
    });
  }
  private wallsOf(room: RoomTag): EdgeFrame[] {
    return this.frames.filter((f) => f.roomId === room.id && f.kind === 'wall' && f.length >= 1.2 && !this.insidePartial({ x: (f.a.x + f.b.x) / 2 - f.out.x * 0.3, z: (f.a.z + f.b.z) / 2 - f.out.z * 0.3 }));
  }

  /** the longest stretch of `f` that is free for a piece `w` wide at `bottomY`, as the centre u, or null; `avoid` lists stretches already used */
  private freeSpot(f: EdgeFrame, w: number, bottomY: number, avoid: { f: EdgeFrame; u0: number; u1: number }[] = []): number | null {
    const blocks = [...this.wallBlocks(f, bottomY), ...avoid.filter((a) => a.f === f)].sort((a, b) => a.u0 - b.u0);
    const best: { len: number; mid: number } = { len: -1, mid: 0 };
    let cursor = 0.12;
    const consider = (a: number, b: number): void => {
      if (b - a >= w && b - a > best.len) { best.len = b - a; best.mid = (a + b) / 2; }
    };
    for (const b of blocks) {
      if (b.u0 > cursor) consider(cursor, Math.min(b.u0, f.length - 0.12));
      cursor = Math.max(cursor, b.u1);
    }
    if (cursor < f.length - 0.12) consider(cursor, f.length - 0.12);
    return best.len >= 0 ? best.mid : null;
  }

  private curtains(room: RoomTag): void {
    if (room.roomType !== 'bedroom' && room.roomType !== 'living') return;
    const H = this.input.layout.wallHeightM;
    for (const { o, f } of this.windowsOf(room)) {
      const need = o.widthM + 0.5;
      const u0 = Math.max(0.1, o.centreM - need / 2), u1 = Math.min(f.length - 0.1, o.centreM + need / 2);
      if (u1 - u0 < o.widthM + 0.15) continue;
      // anything standing under the window decides how long the curtain can hang
      let under = 0;
      for (const it of this.items) {
        let near = false, lo = Infinity, hi = -Infinity;
        for (const c of boxCorners(it.box)) {
          const rel = { x: c.x - f.a.x, z: c.z - f.a.z };
          const u = rel.x * f.dir.x + rel.z * f.dir.z;
          lo = Math.min(lo, u); hi = Math.max(hi, u);
          if (rel.x * f.out.x + rel.z * f.out.z > -0.3) near = true;
        }
        if (near && lo < u1 && hi > u0) under = Math.max(under, it.heightM);
      }
      const rod = Math.min(o.headM + 0.12, H - 0.12);
      const bottom = under > 0 ? Math.max(under + 0.05, o.sillM - 0.1) : 0.06;
      if (rod - bottom < 0.5 || under > o.sillM + 0.1) continue;
      // no door in the curtain's stretch of the wall
      const doorHere = this.doors.some((d) => d.frame === f && d.opening.centreM + d.opening.widthM / 2 > u0 - 0.1 && d.opening.centreM - d.opening.widthM / 2 < u1 + 0.1);
      if (doorHere) continue;
      this.wallPiece('curtain', room, f, (u0 + u1) / 2, bottom, u1 - u0, 0.12, rod - bottom);
    }
  }

  private pictures(room: RoomTag): void {
    if (room.roomType !== 'bedroom' && room.roomType !== 'living') return;
    const used: { f: EdgeFrame; u0: number; u1: number }[] = [];
    const walls = this.wallsOf(room);
    // a picture over the bed's head or the sofa's back, when that stands against a wall
    const hosts = this.items.filter((i) => (i.kind === 'bed' || i.kind === 'sofa') && this.itemRoom(i)?.id === room.id && i.box.w >= 0.9 && i.box.d <= 2.2);
    for (const h of hosts) {
      const back = world(h.box, 0, -h.box.d / 2);
      const f = walls.find((w) => {
        const o = (back.x - w.a.x) * w.out.x + (back.z - w.a.z) * w.out.z;
        const u = (back.x - w.a.x) * w.dir.x + (back.z - w.a.z) * w.dir.z;
        const { a } = boxAxes(h.box);
        return Math.abs(o) < 0.25 && u > 0 && u < w.length && a.x * w.out.x + a.z * w.out.z < -0.9;
      });
      if (!f) continue;
      const u = (h.box.cx - f.a.x) * f.dir.x + (h.box.cz - f.a.z) * f.dir.z;
      const w = Math.min(0.9, Math.max(0.5, h.box.w * 0.45));
      const bottom = Math.max(1.3, h.heightM + 0.4);
      if (bottom + w * 0.75 > this.input.layout.wallHeightM - 0.25) continue;
      if (!this.wallFree(f, u - w / 2, u + w / 2, bottom)) continue;
      this.wallPiece('frame', room, f, u, bottom, w, 0.03, w * 0.75);
      used.push({ f, u0: u - w / 2 - 0.1, u1: u + w / 2 + 0.1 });
      break;
    }
    if (room.roomType !== 'living') return;
    // the living room also gets a clock, on the longest free stretch of another wall
    const wallH = this.input.layout.wallHeightM;
    const y = Math.min(1.95, wallH - 0.55);
    for (const f of [...walls].sort((a, b) => b.length - a.length)) {
      const u = this.freeSpot(f, 0.7, y, used);
      if (u === null) continue;
      this.wallPiece('clock', room, f, u, y, 0.32, 0.05, 0.32);
      break;
    }
    if (!used.length) {
      // no sofa wall: a picture on the longest free wall instead
      for (const f of [...walls].sort((a, b) => b.length - a.length)) {
        const u = this.freeSpot(f, 1.0, 1.3, [...this.pieces.filter((p) => p.place === 'wall' && p.roomId === room.id).map((p) => ({ f, u0: projectU(f, p) - p.w / 2 - 0.15, u1: projectU(f, p) + p.w / 2 + 0.15 }))]);
        if (u === null) continue;
        this.wallPiece('frame', room, f, u, 1.3, 0.62, 0.03, 0.46);
        break;
      }
    }
  }

  private pooja(room: RoomTag): void {
    if (!POOJA_RE.test(room.label)) return;
    const H = this.input.layout.wallHeightM;
    const w = 0.7;
    const walls = this.wallsOf(room).sort((a, b) => b.length - a.length);
    for (const f of walls) {
      const u = this.freeSpot(f, w + 0.2, 0.9);
      if (u === null) continue;
      if (0.95 + 0.62 > H - 0.1) continue;
      this.wallPiece('pooja', room, f, u, 0.95, w, 0.24, 0.62);
      return;
    }
  }

  // ---- surface pieces

  private dress(it: FurnitureItem): void {
    const room = this.itemRoom(it);
    if (!room) return;
    const { w, d } = it.box;
    const S = it.surfaceHeightM;
    // one colour story per host: the two cushions on a bed match, the throw is another note of the palette
    const hostTone = Math.floor(mulberry32(this.seedFor(room.id, it.id))() * 8);
    const on = (kind: DecorKind, lx: number, lz: number, y: number, pw: number, pd: number, height: number, yawOffset = 0, tiltDeg?: number, toneShift = 0): void => {
      const c = world(it.box, lx, lz);
      this.push({ kind, roomId: room.id, place: 'surface', hostId: it.id, x: c.x, y, z: c.z, yawDeg: it.box.yawDeg + yawOffset, w: pw, d: pd, height, ...(tiltDeg !== undefined ? { tiltDeg } : {}) }, it.id, (hostTone + toneShift) % 8);
    };
    if (it.kind === 'bed') {
      if (w < 0.8 || d < 1.5) return;
      const mw = it.inner ? Math.min(it.inner.w, w - 0.01) : w - 0.03;
      const md = it.inner ? Math.min(it.inner.d, d - 0.01) : d - 0.03;
      const xs = mw >= 1.2 ? [-mw / 4, mw / 4] : [0];
      xs.forEach((x, k) => on('cushion', x, -d / 2 + 0.66, S, 0.38, 0.14, 0.38, k ? 6 : -6, 16));
      on('throw', 0, md / 2 - 0.27, S + 0.026, Math.min(mw * 0.88, 1.5), 0.36, 0.03, 0, undefined, 3);
      return;
    }
    if (it.kind === 'sofa') {
      if (w < 1.2 || d > 1.3) return;
      const seatTop = S + 0.03;
      const aw = 0.16;
      const e = w / 2 - aw - 0.22;
      on('cushion', -e, -d / 2 + 0.43, seatTop, 0.4, 0.15, 0.4, 8, 14);
      on('cushion', e, -d / 2 + 0.43, seatTop, 0.4, 0.15, 0.4, -8, 14);
      if (w >= 1.8) on('throw', 0.02, d / 2 - 0.3, seatTop, 0.52, 0.34, 0.04, 6, undefined, 3);
      return;
    }
    if (it.kind === 'dining') {
      if (w < 1.0 || d < 1.2) return;
      on('fruit', 0, 0, S, 0.3, 0.3, 0.16);
      on('jug', 0.34, 0.1, S, 0.13, 0.13, 0.22);
      return;
    }
    if (it.kind === 'counter') {
      const look = furnitureLook(it);
      if (room.roomType === 'kitchen' && look === 'counter' && S >= 0.8) {
        if (w < 0.6 || d < 0.5) return;
        const z = -d / 2 + 0.22;
        on('cooker', -w / 2 + 0.28, z, S, 0.24, 0.24, 0.26);
        if (w >= 1.0) on('dabbas', -w / 2 + 0.7, z, S, 0.2, 0.2, 0.3);
        if (w >= 1.5) on('fruit', w / 2 - 0.35, z + 0.02, S, 0.28, 0.28, 0.14);
        return;
      }
      if (room.roomType === 'kitchen') return;
      if (look === 'side' || (w <= 0.6 && S < 0.7)) {
        if (w < 0.38 || d < 0.35) return;
        on('lamp', 0, -d / 2 + Math.min(0.17, d / 2 - 0.05), it.heightM, 0.22, 0.22, 0.34);
        return;
      }
      if ((look === 'study' || look === 'counter') && S >= 0.6 && S <= 0.82 && w >= 0.9) {
        const left = look === 'study' ? -w / 2 + 0.3 : -w / 2 + 0.28;
        on('books', left, -d / 2 + 0.2, S, 0.22, 0.28, 0.14, -8);
        on('lamp', w / 2 - 0.22, -d / 2 + 0.18, S, 0.2, 0.2, 0.32);
      }
    }
  }

  run(): DecorPiece[] {
    const { layout } = this.input;
    // surface pieces first (they never move anything), then the floor, then the walls
    for (const it of this.items) this.dress(it);

    const living = this.whole.filter((r) => r.roomType === 'living');
    for (const r of living) this.rugFor(r);

    let bedroomPlants = 0;
    const byArea = (a: RoomTag, b: RoomTag): number => polyArea(b.polygon) - polyArea(a.polygon);
    for (const r of [...living].sort(byArea)) this.plantFor(r);
    for (const r of this.whole.filter((x) => x.roomType === 'bedroom').sort(byArea)) {
      if (bedroomPlants >= MAX_FLOOR_PLANTS_BEDROOM) break;
      if (this.plantFor(r)) bedroomPlants++;
    }
    for (const r of this.whole.filter((x) => x.roomType === 'balcony')) { this.plantFor(r); break; }
    this.shoes();

    for (const r of this.whole) {
      this.curtains(r);
      this.pictures(r);
      this.pooja(r);
    }
    void layout;
    return this.pieces;
  }
}

function unit(x: number, z: number): Vec2 {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}
function polyArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i].x * p[(i + 1) % p.length].z - p[(i + 1) % p.length].x * p[i].z;
  return Math.abs(s / 2);
}
function centroidOf(p: Vec2[]): Vec2 {
  let x = 0, z = 0;
  for (const q of p) { x += q.x; z += q.z; }
  const c = { x: x / p.length, z: z / p.length };
  if (pointInPolygon(c, p)) return c;
  // L shapes: the sampled point furthest from the outline
  let best = p[0], bestD = -1;
  const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
  for (let a = Math.min(...xs); a <= Math.max(...xs); a += 0.1) {
    for (let b = Math.min(...zs); b <= Math.max(...zs); b += 0.1) {
      const q = { x: a, z: b };
      if (!pointInPolygon(q, p)) continue;
      let d = Infinity;
      for (let i = 0; i < p.length; i++) d = Math.min(d, distanceToSegment(q, p[i], p[(i + 1) % p.length]));
      if (d > bestD) { best = q; bestD = d; }
    }
  }
  return best;
}
function projectU(f: EdgeFrame, p: { x: number; z: number }): number {
  return (p.x - f.a.x) * f.dir.x + (p.z - f.a.z) * f.dir.z;
}

/**
 * The decor for one home. Deterministic: the same layout and furniture always give the same list, so a buyer sees the same
 * home on every visit. Nothing in `input` is changed.
 */
export function planLivedIn(input: PlanInput): DecorPiece[] {
  if (input.layout.rooms.length === 0) return [];
  return new Planner(input).run();
}
