// Furnished sample layouts for the shared spaces (SPEC 16.17): a gym, a lobby and a hall, built from the catalogue at the size of whatever room they are given.
// A building generator adopts them with one call: `sampleLayout('gym', bounds, { doors })` returns the pieces as ordinary `FurnitureItem`s (virtual, so
// their clearance zones and verdicts show), with stable ids, a function of the room and nothing else. Pure; no file is read.
//
// How the room is read: its bounding rectangle `bounds`, whose long side is the run of the room (a gym 8 x 12 m runs along z). `doors` name the walls the
// doors are on, where along the wall (metres from its low end) and how wide; the 1.4 m of floor inside each stays clear, and a piece that would stand there is left out.
// A piece that would not fit the room (a smaller room than the sample was drawn for) is left out too, never squeezed: the room size is the record.
import type { Box, FurnitureItem } from '../types';
import { catalogItem, itemFromCatalog } from './catalog';
import { boxCorners } from './geometry';
import { rowGapM } from './space-layout';

export interface RoomBounds { x0: number; z0: number; x1: number; z1: number }
export type Wall = 'north' | 'south' | 'east' | 'west';
export interface SampleDoor { wall: Wall; atM: number; widthM: number }
export interface SampleOptions { doors?: SampleDoor[]; idPrefix?: string }
export type SampleKind = 'gym' | 'lobby' | 'hall';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** local frame (u across the short side, v along the long side) to the world: the long side runs along z, or along x by a quarter turn */
function frameOf(b: RoomBounds): { W: number; L: number; at(u: number, v: number): { x: number; z: number }; yaw(psi: number): number; turned: boolean } {
  const dx = b.x1 - b.x0, dz = b.z1 - b.z0;
  if (dz >= dx) return { W: dx, L: dz, at: (u, v) => ({ x: b.x0 + u, z: b.z0 + v }), yaw: (p) => p, turned: false };
  return { W: dz, L: dx, at: (u, v) => ({ x: b.x0 + v, z: b.z1 - u }), yaw: (p) => (p + 90) % 360, turned: true };
}

interface Builder { items: FurnitureItem[]; W: number; L: number; put(id: string, u: number, v: number, psi: number): FurnitureItem | null }

function builder(room: RoomBounds, o: SampleOptions, kind: SampleKind): Builder {
  const f = frameOf(room);
  const prefix = o.idPrefix ?? `sample-${kind}`;
  const landings: Array<{ x0: number; x1: number; z0: number; z1: number }> = [];
  for (const d of o.doors ?? []) {
    // the landing in world terms: 1.4 m inside the wall, as wide as the door and 0.3 m either side
    const half = d.widthM / 2 + 0.3;
    const wall = d.wall;
    if (wall === 'south') landings.push({ x0: room.x0 + d.atM - half, x1: room.x0 + d.atM + half, z0: room.z1 - 1.4, z1: room.z1 });
    else if (wall === 'north') landings.push({ x0: room.x0 + d.atM - half, x1: room.x0 + d.atM + half, z0: room.z0, z1: room.z0 + 1.4 });
    else if (wall === 'west') landings.push({ x0: room.x0, x1: room.x0 + 1.4, z0: room.z0 + d.atM - half, z1: room.z0 + d.atM + half });
    else landings.push({ x0: room.x1 - 1.4, x1: room.x1, z0: room.z0 + d.atM - half, z1: room.z0 + d.atM + half });
  }
  const items: FurnitureItem[] = [];
  const put = (id: string, u: number, v: number, psi: number): FurnitureItem | null => {
    const spec = catalogItem(id);
    const p = f.at(u, v);
    const box: Box = { cx: r3(p.x), cz: r3(p.z), w: spec.footprint.w, d: spec.footprint.d, yawDeg: f.yaw(psi) };
    const cs = boxCorners(box);
    const xs = cs.map((c) => c.x), zs = cs.map((c) => c.z);
    const inside = Math.min(...xs) >= room.x0 - 1e-6 && Math.max(...xs) <= room.x1 + 1e-6 && Math.min(...zs) >= room.z0 - 1e-6 && Math.max(...zs) <= room.z1 + 1e-6;
    if (!inside) return null;
    // flat pieces and wall pieces may lie over a doorway landing; nothing that stands may
    if (spec.heightM >= 0.06 && landings.some((l) => Math.min(...xs) < l.x1 && Math.max(...xs) > l.x0 && Math.min(...zs) < l.z1 && Math.max(...zs) > l.z0)) return null;
    const item = itemFromCatalog(id, box, 'virtual');
    item.id = `${prefix}-${items.length + 1}-${id}`;
    items.push(item);
    return item;
  };
  return { items, W: f.W, L: f.L, put };
}

/** a run of pieces along a wall, each at its own spacing: `start` is the first piece's edge, along the wall; returns where the run ends */
function run(b: Builder, ids: string[], wall: 'west' | 'east' | 'north' | 'south', start: number, o: { offset?: number } = {}): number {
  let at = start;
  const depthOffset = o.offset ?? 0.03;
  for (const id of ids) {
    const s = catalogItem(id);
    const gap = rowGapM(id);
    const c = at + s.footprint.w / 2;
    if (wall === 'west') b.put(id, s.footprint.d / 2 + depthOffset, c, 90);
    else if (wall === 'east') b.put(id, b.W - s.footprint.d / 2 - depthOffset, c, 270);
    else if (wall === 'north') b.put(id, c, s.footprint.d / 2 + depthOffset, 0);
    else b.put(id, c, b.L - s.footprint.d / 2 - depthOffset, 180);
    at = c + s.footprint.w / 2 + gap;
  }
  return at;
}

// ---------------------------------------------------------------- the gym

/**
 * A gym for a room about 8 x 12 m: a mirror wall on the west with the cardio row facing it (four treadmills, two cross trainers, two bikes), selectorised
 * strength machines along the east wall, a free-weights area (power rack, bench press, benches, dumbbells, a plate tree, kettlebells) at the south end on
 * rubber flooring, a studio corner at the north with a heavy bag, wall bars and mats, and water, towels and fans. A 1.5 m walkway runs down the middle.
 */
function gymPieces(room: RoomBounds, o: SampleOptions): FurnitureItem[] {
  const b = builder(room, o, 'gym');
  const { W, L } = b;
  // the mirror wall: panels of 1.2 m the whole length of the west wall
  const nMirror = Math.floor(L / 1.2 + 1e-6);
  for (let i = 0; i < nMirror; i++) b.put('gym-mirror', 0.015, 0.6 + i * 1.2 + (L - nMirror * 1.2) / 2, 90);
  // rubber flooring under the free weights and across the south end
  b.put('gym-floor-4x2', 3.0, L - 1.0, 0);
  b.put('gym-floor-2x2', 5.5, L - 1.0, 0);
  // cardio, facing the mirror, from 2.8 m down the wall: the console end is at the wall
  let v = run(b, ['gym-treadmill', 'gym-treadmill', 'gym-treadmill'], 'west', 3.2, { offset: 0.06 });
  v = run(b, ['gym-cross'], 'west', v);
  run(b, ['gym-upright-bike'], 'west', v);
  // strength machines along the east wall, one after another at their own spacing
  run(b, ['gym-chest-press', 'gym-shoulder-press', 'gym-pec-fly', 'gym-lat-pulldown', 'gym-seated-row', 'gym-leg-extension'], 'east', 0.42);
  // free weights at the south end: the power rack against the wall, the bench press with its head end toward the room so a spotter has room
  b.put('gym-power-rack', 2.2, L - 0.8 - 0.03, 180);
  b.put('gym-bench-press', 4.95, L - 0.8 - 0.03, 0);
  // north: wall bars, kettlebells and dumbbells along the wall, two benches in front of them
  b.put('gym-wall-bars', 1.0, 0.06 + 0.03, 0);
  b.put('gym-kettlebell-rack', 2.2, 0.25 + 0.03, 0);
  b.put('gym-dumbbell-rack', 4.5, 0.32 + 0.03, 0);
  b.put('gym-bench-flat', 3.5, 2.5, 0);
  b.put('gym-bench-adjustable', 4.9, 2.6, 0);
  // studio: mats by the walkway, a plyo box, a heavy bag hung clear of everything
  b.put('yoga-mat', 4.35, 4.2, 0);
  b.put('yoga-mat', 5.05, 4.2, 0);
  b.put('gym-plyo-box', 5.15, 5.65, 180);
  b.put('gym-heavy-bag', 4.9, 7.4, 0);
  // amenities: water and a towel station by the door, a scale, fans on the long walls
  b.put('gym-towel-station', W - 0.2 - 0.03, 9.55, 270);
  b.put('gym-water', W - 0.19 - 0.03, 10.2, 270);
  b.put('gym-scale', 7.0, 8.8, 0);
  b.put('gym-wall-fan', 0.15 + 0.03, 11.0, 90);
  b.put('gym-wall-fan', W - 0.15 - 0.03, 9.0, 270);
  return b.items;
}

// ---------------------------------------------------------------- the lobby

/** A lobby for a room about 9 x 7 m: a reception desk and the security desk at the back, a letterbox bank and directory on a side wall, a seating group, planters, art, a notice board. */
function lobbyPieces(room: RoomBounds, o: SampleOptions): FurnitureItem[] {
  const b = builder(room, o, 'lobby');
  const { W, L } = b;
  // the long side is the run of the room: reception stands out from the far (north) wall so the staff have room behind it; the entry is at the south
  b.put('lobby-desk', W / 2, 0.4 + 0.8 + 0.5, 0);
  b.put('lobby-security-desk', 1.4, 0.375 + 0.03, 0);
  b.put('lobby-art-panel', 0.03, 2.4, 90);
  b.put('lobby-letterboxes', W - 0.075 - 0.03, 3.6, 270);
  b.put('lobby-directory', W - 0.025 - 0.03, 5.2, 270);
  b.put('lobby-notice-board', W - 0.02 - 0.03, 7.0, 270);
  b.put('lobby-planter-large', W - 0.55, 0.6, 0);
  b.put('lobby-planter-large', 0.55, L - 0.6, 0);
  b.put('lobby-planter-trough', W - 1.4, L - 0.25 - 0.05, 180);
  // a seating group by the west wall: a 3-seater, an armchair and a side table
  b.put('sofa-3', 0.45 + 0.03, L / 2 + 0.2, 90);
  b.put('armchair', 2.25, L / 2 - 0.9, 180);
  b.put('side-table', 0.5, L / 2 - 1.7, 0);
  b.put('lobby-bench', 0.225 + 0.03, L - 2.0, 90);
  return b.items;
}

// ---------------------------------------------------------------- the hall

/**
 * A hall for a room about 12 x 8.4 m: a stage of three platform modules with a podium and a projector screen at one short end, rows of stacking chairs
 * with a centre aisle facing it, a refreshments table, and a games corner (table tennis and carrom) at the back.
 */
function hallPieces(room: RoomBounds, o: SampleOptions): FurnitureItem[] {
  const b = builder(room, o, 'hall');
  const { W, L } = b;
  // the stage fills the north end: three 1.2 x 2.4 m modules side by side across it (turned so the 2.4 m side is across)
  const nMod = Math.max(1, Math.floor((W - 2.4) / 2.4));
  const modW = 2.4;
  const x0 = (W - nMod * modW) / 2;
  for (let r = 0; r < 2; r++) for (let i = 0; i < nMod; i++) b.put('hall-stage-40', x0 + modW * (i + 0.5), 0.17 + 0.6 + r * 1.2, 90);
  b.put('hall-podium', 0.8, 1.6, 180);
  b.put('hall-speaker', W - 0.6, 1.0, 0);
  b.put('hall-speaker', W - 0.6, 2.0, 0);
  b.put('hall-screen', W / 2, 0.05 + 0.03, 0);
  // the seating block: rows of 12 with an aisle in the middle, facing the stage; the rows start a metre from it
  const cols = Math.max(2, Math.floor((W - 2.4) / 0.49 / 2) * 2);
  const rows = Math.max(2, Math.floor((L - 3.4 - 3.4) / 0.9));
  const aisle = 1.2;
  const width = cols * 0.46 + (cols - 1) * 0.03 + aisle;
  for (let r = 0; r < rows; r++) {
    let x = W / 2 - width / 2;
    for (let c = 0; c < cols; c++) {
      if (c === cols / 2) x += aisle;
      b.put('hall-chair', x + 0.23, 3.4 + r * 0.9, 180);
      x += 0.49;
    }
  }
  // refreshments and a games corner at the back (south)
  b.put('hall-table-rect', 5.0, L - 1.4, 0);
  b.put('hall-table-rect', 7.2, L - 1.4, 0);
  b.put('hall-table-round', 2.0, L - 1.6, 0);
  return b.items;
}

/** The pieces of a furnished sample of `kind` for a room of these bounds (SPEC 16.17). Deterministic: the same room gives the same pieces, ids included. */
export function sampleLayout(kind: SampleKind, room: RoomBounds, o: SampleOptions = {}): FurnitureItem[] {
  return kind === 'gym' ? gymPieces(room, o) : kind === 'lobby' ? lobbyPieces(room, o) : hallPieces(room, o);
}
