// Test scenes for the shared spaces (SPEC 16.17): an empty gym, lobby and hall, and a furnished sample of each, written to public/scenes/test-<space>-empty and
// test-<space>-sample. Each has `spaceKind` set, so the catalogue shows what belongs there. The `test-` prefix keeps them out of the gallery (they open by ?scene=).
// Run: `npx tsx scripts/make-space-scenes.ts`. The output is identical on every run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FINISHES } from '../src/types';
import type { FurnitureItem, Layout, Opening, PropertyFile, RoomTag, SpaceKind } from '../src/types';
import { sampleLayout } from '../src/core/space-samples';
import type { RoomBounds, SampleDoor, SampleKind } from '../src/core/space-samples';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/scenes');
const UPDATED = '2026-11-16T00:00:00.000Z';

interface SpaceDef {
  kind: SampleKind;
  spaceKind: SpaceKind;
  title: string;
  w: number; d: number; wallHeightM: number;
  finishes: Partial<typeof DEFAULT_FINISHES>;
  door: SampleDoor;
  /** the window or second opening, if any */
  roomType: RoomTag['roomType'];
  label: string;
  spawn: { x: number; z: number; yawDeg: number };
}

export const SPACES: SpaceDef[] = [
  { kind: 'gym', spaceKind: 'gym', title: 'Test gym', w: 8, d: 12, wallHeightM: 3.2, roomType: 'other', label: 'Gym',
    finishes: { wallColor: '#E9E8E6', floorColor: '#6D7075', groutColor: '#27292C', tile: { wM: 0.5, lM: 0.5 }, ceilingColor: '#F4F4F2' },
    door: { wall: 'south', atM: 7.0, widthM: 1.0 }, spawn: { x: 7.0, z: 11.2, yawDeg: 180 } },
  { kind: 'lobby', spaceKind: 'lobby', title: 'Test lobby', w: 7, d: 9, wallHeightM: 3.6, roomType: 'other', label: 'Entrance lobby',
    finishes: { wallColor: '#EDE6DA', floorColor: '#CBC3B6', groutColor: '#B4AB9C', tile: { wM: 0.8, lM: 0.8 }, ceilingColor: '#FAFAF8' },
    door: { wall: 'south', atM: 3.5, widthM: 1.6 }, spawn: { x: 3.5, z: 8.2, yawDeg: 180 } },
  { kind: 'hall', spaceKind: 'hall', title: 'Test hall', w: 12, d: 8.4, wallHeightM: 3.6, roomType: 'other', label: 'Community hall',
    finishes: { wallColor: '#EFEAE0', floorColor: '#B48D5C', groutColor: '#A47F52', tile: { wM: 0.9, lM: 0.9 }, ceilingColor: '#FAFAF8' },
    door: { wall: 'east', atM: 6.2, widthM: 1.2 }, spawn: { x: 11.0, z: 6.2, yawDeg: 270 } },
];

/** the room's layout: one room, one door (its swing set by rule at load) */
export function layoutOf(s: SpaceDef): Layout {
  const room: RoomTag = {
    id: s.kind, roomType: s.roomType, label: s.label,
    polygon: [{ x: 0, z: 0 }, { x: s.w, z: 0 }, { x: s.w, z: s.d }, { x: 0, z: s.d }],
    edges: ['wall', 'wall', 'wall', 'wall'],
    // the room's own colours: a made-up room names its floor and walls (finishes of source 'default' are only a fallback)
    ...(s.finishes.floorColor ? { floorColor: s.finishes.floorColor } : {}), ...(s.finishes.wallColor ? { wallColor: s.finishes.wallColor } : {}),
  };
  // edges run: 0 north (x 0 to w), 1 east (z 0 to d), 2 south (x w to 0), 3 west (z d to 0)
  const wallEdge = { north: 0, east: 1, south: 2, west: 3 }[s.door.wall];
  const along = s.door.wall === 'north' ? s.door.atM : s.door.wall === 'east' ? s.door.atM : s.door.wall === 'south' ? s.w - s.door.atM : s.d - s.door.atM;
  const door: Opening = { id: `${s.kind}-door`, roomId: s.kind, edge: wallEdge, type: 'door', centreM: along, widthM: s.door.widthM, sillM: 0, headM: 2.1 };
  return {
    wallHeightM: s.wallHeightM, wallThicknessM: 0.12, railingHeightM: 1.1,
    rooms: [room], openings: [door],
    finishes: { ...DEFAULT_FINISHES, ...s.finishes },
    scaleSource: 'typed-sizes',
  };
}

export function propertyOf(s: SpaceDef, furnished: boolean): PropertyFile {
  const layout = layoutOf(s);
  const bounds: RoomBounds = { x0: 0, z0: 0, x1: s.w, z1: s.d };
  const furniture: FurnitureItem[] = furnished ? sampleLayout(s.kind, bounds, { doors: [s.door], idPrefix: `${s.kind}` }) : [];
  return {
    version: 1, id: `test-${s.kind}-${furnished ? 'sample' : 'empty'}`, title: furnished ? `${s.title}, furnished` : `${s.title}, empty`,
    subtitle: furnished ? 'Made-up sample layout for demonstration.' : 'Test scene. Made-up room, not a real space.',
    layout, furniture, spawn: s.spawn, spaceKind: s.spaceKind, updatedAt: UPDATED,
  };
}

export function writeScenes(dir: string = DIR): string[] {
  const out: string[] = [];
  for (const s of SPACES) for (const furnished of [false, true]) {
    const p = propertyOf(s, furnished);
    const folder = path.join(dir, p.id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'property.json'), JSON.stringify(p, null, 2) + '\n');
    out.push(`${p.id} (${p.furniture.length} pieces)`);
  }
  return out;
}

const isMain = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) console.log(writeScenes().join('\n'));
