// The four flat designs of the sample tower: each is a synthetic drawing run through the real reader (scripts/make-sample-homes.ts
// readSet, the same job a broker upload runs), then given the one thing a drawing set of a single flat does not draw: a main door onto the
// corridor, with the door's own width and swing. Nothing else is changed except names the reader could not read (a broker's rename).
import fs from 'node:fs';
import path from 'node:path';
import { readSet } from '../make-sample-homes';
import { pointInPolygon } from '../../src/core/geometry';
import { computeEdgeFrames } from '../../src/core/layout-geom';
import { resolveDoors } from '../../src/core/doors';
import type { Layout, Opening, PropertyFile, Vec2 } from '../../src/types';

export interface FlatSpec {
  typeId: string;
  name: string;
  seed: number;
  sceneId: string;
  /** where the main door goes when the drawing has none: a room of the layout, the wall it is on, by the direction that wall faces */
  entry: { roomId: string; facing: 'N' | 'E' | 'S' | 'W' };
  /** renames a broker would make in the editor for rooms the reader could not name */
  labels?: Record<string, string>;
}

export const MAIN_DOOR_M = 1.0;
export const MAIN_DOOR_ID = 'door-main';

/** Seeds picked in the scan: the reader found every room and every door, and every room can be walked into. */
export const FLATS: FlatSpec[] = [
  { typeId: '1bhk', name: '1 BHK', seed: 32, sceneId: 'st-flat-1bhk', entry: { roomId: 'lobby', facing: 'S' } },
  { typeId: '2bhk-a', name: '2 BHK (A)', seed: 93, sceneId: 'st-flat-2bhk-a', entry: { roomId: 'passage', facing: 'W' } },
  { typeId: '2bhk-b', name: '2 BHK (B)', seed: 45, sceneId: 'st-flat-2bhk-b', entry: { roomId: 'passage', facing: 'E' } },
  { typeId: '3bhk', name: '3 BHK', seed: 130, sceneId: 'st-flat-3bhk', entry: { roomId: 'lobby', facing: 'W' }, labels: { 'room-9': 'Bath 1', 'room-10': 'Bath 2', 'room-11': 'Puja room' } },
];

const DIR: Record<'N' | 'E' | 'S' | 'W', Vec2> = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };

/** The door that leads outside already in the layout (the drawing drew one), if any. */
export function outsideDoor(layout: Layout): Opening | null {
  const d = resolveDoors(layout).filter((x) => x.rooms[1] === null && (x.widthM ?? 0) >= 0.9);
  if (d.length === 0) return null;
  return layout.openings.find((o) => o.id === d[0].id) ?? null;
}

/** Adds the main door to the entry room's outside wall facing `facing`, centred on that wall. Throws when there is no such wall. */
export function addMainDoor(layout: Layout, entry: FlatSpec['entry']): Opening {
  const room = layout.rooms.find((r) => r.id === entry.roomId);
  if (!room) throw new Error(`entry room "${entry.roomId}" is not in the layout (${layout.rooms.map((r) => r.id).join(', ')})`);
  const frames = computeEdgeFrames(layout).filter((f) => f.roomId === room.id);
  const want = DIR[entry.facing];
  let best: { f: (typeof frames)[number]; score: number } | null = null;
  for (const f of frames) {
    if (f.kind !== 'wall') continue;
    const facing = f.out.x * want.x + f.out.z * want.z;
    if (facing < 0.99) continue;
    const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
    // outside: nothing of this flat just beyond the wall
    const beyond = [0.3, 0.6, 0.9].some((o) => layout.rooms.some((r) => r.id !== room.id && pointInPolygon({ x: mid.x + f.out.x * o, z: mid.z + f.out.z * o }, r.polygon)));
    if (beyond) continue;
    if (f.length < MAIN_DOOR_M + 0.15) continue;
    // an existing opening on this wall would collide
    if (layout.openings.some((o) => o.roomId === room.id && o.edge === f.edge)) continue;
    if (!best || f.length > best.f.length) best = { f, score: f.length };
  }
  if (!best) throw new Error(`room "${room.id}" has no free outside wall facing ${entry.facing}`);
  const door: Opening = {
    id: MAIN_DOOR_ID, roomId: room.id, edge: best.f.edge, type: 'door', centreM: best.f.length / 2, widthM: MAIN_DOOR_M, sillM: 0, headM: 2.1,
    leaf: { hinge: 'start', swing: 'in', kind: 'hinged' },
  };
  layout.openings.push(door);
  return door;
}

export interface FlatDesign {
  spec: FlatSpec;
  property: PropertyFile;
  designs: unknown | null;
  extras: unknown | null;
  design: unknown | null;
  mainOpening: string;
}

/** Runs the reader on the flat's drawing set and shapes the result into a scene. */
export async function readFlat(spec: FlatSpec, scratch: string): Promise<FlatDesign> {
  const r = await readSet(spec.seed, spec.sceneId, scratch, `Flat · ${spec.name}`);
  const property: PropertyFile = JSON.parse(JSON.stringify(r.property));
  property.id = spec.sceneId;
  property.title = `Flat · ${spec.name}`;
  property.subtitle = 'Sample building · synthetic drawing, made-up flat';
  property.unlisted = true;
  for (const [id, label] of Object.entries(spec.labels ?? {})) {
    const room = property.layout.rooms.find((x) => x.id === id);
    if (!room) throw new Error(`label override for "${id}": no such room in ${spec.sceneId} (${property.layout.rooms.map((x) => x.id).join(', ')})`);
    room.label = label;
  }
  const existing = outsideDoor(property.layout);
  const main = existing ?? addMainDoor(property.layout, spec.entry);
  const read = (f: string): unknown | null => { const p = path.join(r.dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  return { spec, property, designs: read('designs.json'), extras: read('proposal-extras.json'), design: read('design.json'), mainOpening: main.id };
}
