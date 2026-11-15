// Sample Tower (made-up): a whole building a buyer can walk through, and its empty twin. Run: npm run make:building
//   tsx scripts/building/make-sample-building.ts --write     rebuild public/buildings/sample-tower*, public/scenes/st-* and se-*
//   tsx scripts/building/make-sample-building.ts --check     build in memory and print the building-level validation
// Flats come from synthetic drawings run through the real reader (scripts/building/flats.ts); everything else is authored here
// (scripts/building/spaces.ts). The output is committed, like the sample homes, and is the same on every run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBuilding } from '../../src/building/validate';
import { parseBuilding } from '../../src/building/parse';
import type { BuildingFile, Level, Portal, Space } from '../../src/building/types';
import type { PropertyFile } from '../../src/types';
import { FLATS, readFlat } from './flats';
import type { FlatDesign } from './flats';
import { composeTypicalFloor, mirrorId } from './plate';
import type { Plate } from './plate';
import { LIFT_CAR, UPDATED_AT, clubhouseScenes, corridorScene, groundLobbyScene } from './spaces';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface SceneBundle { property: PropertyFile; designs?: unknown | null; extras?: unknown | null; design?: unknown | null }
export interface Built { buildings: BuildingFile[]; scenes: Map<string, SceneBundle> }

/** Which flat sits where on the typical floor: east side from the north end, then west side from the north end. */
const TYPICAL: { slot: string; side: 'E' | 'W'; type: string }[] = [
  { slot: '01', side: 'E', type: '3bhk' },
  { slot: '02', side: 'E', type: '1bhk' },
  { slot: '03', side: 'W', type: '2bhk-a' },
  { slot: '04', side: 'W', type: '2bhk-b' },
];
/** The typical floors above the clubhouse level. */
const TYPICAL_FLOORS = [2, 3];

const withFixedDate = (p: PropertyFile): PropertyFile => ({ ...p, updatedAt: UPDATED_AT });

export async function buildSample(scratch: string): Promise<Built> {
  const designs: Record<string, FlatDesign> = {};
  for (const s of FLATS) designs[s.typeId] = await readFlat(s, scratch);
  const plate: Plate = composeTypicalFloor(TYPICAL.map((t) => ({ key: t.slot, side: t.side, design: designs[t.type] })));
  const scenes = new Map<string, SceneBundle>();
  const buildings: BuildingFile[] = [];
  for (const variant of ['full', 'empty'] as const) buildings.push(assemble(variant, designs, plate, scenes));
  return { buildings, scenes };
}

function assemble(variant: 'full' | 'empty', designs: Record<string, FlatDesign>, plate: Plate, scenes: Map<string, SceneBundle>): BuildingFile {
  const empty = variant === 'empty';
  const pre = empty ? 'se' : 'st';
  /** the empty twin has its own flats and lobby (unfurnished); the rest is bare in both, so the twin uses the same scenes */
  const flatScene = (typeId: string, mirror: boolean): string => {
    const base = FLATS.find((f) => f.typeId === typeId)!.sceneId.replace(/^st-/, `${pre}-`);
    return mirror ? mirrorId(base) : base;
  };
  const add = (id: string, b: SceneBundle): void => { if (!scenes.has(id)) scenes.set(id, b); };

  // flats (and the mirror images the plate needed)
  const mirroredTypes = new Set<string>();
  for (const f of plate.flats) {
    const t = TYPICAL.find((x) => x.slot === f.key)!.type;
    const d = designs[t];
    const plain = (p: PropertyFile, id: string): PropertyFile => withFixedDate({ ...p, id, furniture: empty ? [] : p.furniture });
    if (!scenes.has(flatScene(t, false))) add(flatScene(t, false), { property: plain(d.property, flatScene(t, false)), designs: empty ? null : d.designs, extras: d.extras, design: empty ? null : d.design });
    if (f.mirrored) {
      mirroredTypes.add(t);
      const id = flatScene(t, true);
      if (!scenes.has(id)) add(id, { property: plain(f.property, id), designs: empty ? null : f.designs, extras: d.extras, design: empty ? null : d.design });
    }
  }
  // the typical floor's corridor (bare, shared by both variants)
  const corridor = corridorScene(plate, 'st-corridor');
  add('st-corridor', { property: corridor.property });
  // the ground lobby
  const lobbyId = `${pre}-lobby`;
  const lobby = groundLobbyScene(lobbyId, !empty);
  add(lobbyId, { property: lobby.property });
  // the clubhouse level (bare in both)
  const ids = { foyer: 'st-1-foyer', hall: 'st-1-hall', gym: 'st-1-gym', pool: 'st-1-pool', garden: 'st-1-garden' };
  const club = clubhouseScenes(ids);
  for (const [k, v] of Object.entries(club)) if (k !== 'doors') add(ids[k as keyof typeof ids], { property: v as PropertyFile });

  // ---- the building
  const lift = (id: string, opening: string): Portal => ({ id, kind: 'lift', opening, lift: id });
  const stairs = (opening: string): Portal => ({ id: 'stairs', kind: 'stairs', opening, label: 'Stairs' });
  const ground: Level = {
    id: 'g', label: 'Ground', short: 'G', summary: 'Entrance lobby, lifts', floorToFloorM: 4.2,
    spaces: [{
      id: lobbyId, kind: 'lobby', name: 'Entrance lobby', sceneId: lobbyId, placement: { x: 0, z: 0, rotDeg: 0 },
      notes: empty ? ['Unfurnished'] : ['Reception desk, seating and security desk. The letterbox wall is not drawn yet.'],
      portals: [
        { id: 'street', kind: 'outside', opening: lobby.street, label: 'The street', look: 'glass' },
        lift('lift-a', lobby.liftA), lift('lift-b', lobby.liftB), stairs(lobby.stairs),
        { id: 'clubhouse', kind: 'door', opening: lobby.clubhouse, to: { space: 'st-1-foyer', portal: 'walkway' }, label: 'The clubhouse (level 1)', look: 'glass' },
      ],
    }],
  };
  const clubhouse: Level = {
    id: 'l1', label: 'Level 1', short: '1', summary: 'Clubhouse: hall, gym, pool, garden', floorToFloorM: 4.2,
    spaces: [
      {
        id: ids.foyer, kind: 'corridor', name: 'Clubhouse foyer', sceneId: ids.foyer, placement: { x: 0, z: 0, rotDeg: 0 },
        portals: [
          lift('lift-a', 'lift-a'), lift('lift-b', 'lift-b'), stairs('door-stairs'),
          { id: 'walkway', kind: 'door', opening: club.doors.walkway, to: { space: lobbyId, portal: 'clubhouse' }, label: 'The ground floor', look: 'glass' },
          { id: 'hall', kind: 'door', opening: club.doors.hall, to: { space: ids.hall, portal: 'foyer' }, label: 'Community hall', look: 'plain' },
          { id: 'gym', kind: 'door', opening: club.doors.gym, to: { space: ids.gym, portal: 'foyer' }, label: 'Gym', look: 'plain' },
          { id: 'pool', kind: 'door', opening: club.doors.pool, to: { space: ids.pool, portal: 'foyer' }, label: 'Pool area', look: 'plain' },
          { id: 'garden', kind: 'door', opening: club.doors.garden, to: { space: ids.garden, portal: 'foyer' }, label: 'Garden', look: 'plain' },
        ],
      },
      amenity(ids.hall, 'hall', 'Community hall', ids.foyer, 'hall', ['Empty hall, about 12 × 8.4 m.']),
      amenity(ids.gym, 'gym', 'Gym', ids.foyer, 'gym', ['Empty room, about 8 × 12 m. A mirror wall on the long west side comes in the next stage.']),
      { ...amenity(ids.pool, 'pool', 'Pool area', ids.foyer, 'pool', ['A plain room the size of the pool deck, about 16 × 9 m. No water yet.']), comingNext: true },
      { ...amenity(ids.garden, 'garden', 'Garden', ids.foyer, 'garden', ['A plain room the size of the garden, about 14 × 10 m. No planting yet.']), comingNext: true },
    ],
  };
  const typical = (n: number): Level => {
    const cid = `f${n}-corridor`;
    const spaces: Space[] = [];
    const cportals: Portal[] = [lift('lift-a', corridor.liftA), lift('lift-b', corridor.liftB), stairs(corridor.stairs)];
    const flatSpaces: Space[] = [];
    for (const t of TYPICAL) {
      const f = plate.flats.find((x) => x.key === t.slot)!;
      const num = `${n}${t.slot}`;
      const d = designs[t.type];
      const sceneId = flatScene(t.type, f.mirrored);
      cportals.push({ id: `flat-${num}`, kind: 'door', opening: corridor.flatDoor[t.slot], to: { space: `f${n}-${num}`, portal: 'main' }, label: `Flat ${num}`, look: 'main', plate: num });
      flatSpaces.push({
        id: `f${n}-${num}`, kind: 'flat', name: `Flat ${num} · ${d.spec.name}`, sceneId, type: t.type, ...(f.mirrored ? { mirrored: true } : {}),
        placement: f.placement,
        portals: [{ id: 'main', kind: 'door', opening: d.mainOpening, to: { space: cid, portal: `flat-${num}` }, label: 'The corridor', look: 'main', plate: num }],
      });
    }
    spaces.push({ id: cid, kind: 'corridor', name: 'Corridor and lift lobby', sceneId: 'st-corridor', placement: { x: 0, z: 0, rotDeg: 0 }, portals: cportals }, ...flatSpaces);
    return { id: `l${n}`, label: `Level ${n}`, short: String(n), summary: `Flats ${n}01 to ${n}04`, spaces };
  };
  const levels: Level[] = [ground, clubhouse, ...TYPICAL_FLOORS.map(typical)];
  const flatTypes: BuildingFile['flatTypes'] = {};
  for (const f of FLATS) flatTypes[f.typeId] = { name: f.name, sceneId: flatScene(f.typeId, false), ...(mirroredTypes.has(f.typeId) ? { mirrorSceneId: flatScene(f.typeId, true) } : {}) };
  return {
    version: 1,
    id: empty ? 'sample-tower-empty' : 'sample-tower',
    name: empty ? 'Sample Tower, empty (made-up)' : 'Sample Tower (made-up)',
    subtitle: empty ? 'The same tower with every room unfurnished: where a builder starts' : 'Lobby, lifts, four flats a floor and a clubhouse level',
    sample: true,
    note: 'Sample layout for demonstration',
    floorToFloorM: 3.1,
    flatTypes,
    lifts: ['lift-a', 'lift-b'].map((id, i) => ({ id, name: `Lift ${i === 0 ? 'A' : 'B'}`, car: { ...LIFT_CAR }, serves: levels.map((l) => l.id) })),
    levels,
    startSpace: lobbyId,
    ...(empty ? { bare: true } : {}),
  };
}

function amenity(id: string, kind: Space['kind'], name: string, foyer: string, portalToFoyer: string, notes: string[]): Space {
  return {
    id, kind, name, sceneId: id, placement: { x: 0, z: 0, rotDeg: 0 }, notes,
    portals: [{ id: 'foyer', kind: 'door', opening: 'door-foyer', to: { space: foyer, portal: portalToFoyer }, label: 'The clubhouse foyer', look: 'plain' }],
  };
}

// ---------------------------------------------------------------- writing

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
function writeIf(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function writeAll(b: Built, root = ROOT): void {
  for (const [id, s] of b.scenes) {
    const dir = path.join(root, 'public', 'scenes', id);
    fs.rmSync(dir, { recursive: true, force: true });
    writeIf(path.join(dir, 'property.json'), json(s.property));
    if (s.designs) writeIf(path.join(dir, 'designs.json'), json(s.designs));
    if (s.extras) writeIf(path.join(dir, 'proposal-extras.json'), json(s.extras));
    if (s.design) writeIf(path.join(dir, 'design.json'), json(s.design));
  }
  for (const bd of b.buildings) writeIf(path.join(root, 'public', 'buildings', bd.id, 'building.json'), json(bd));
}

export function lookupOf(b: Built): (sceneId: string) => PropertyFile | undefined {
  return (id) => b.scenes.get(id)?.property;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-building-'));
  try {
    const built = await buildSample(scratch);
    for (const bd of built.buildings) {
      parseBuilding(JSON.parse(JSON.stringify(bd)));
      const rep = validateBuilding(bd, lookupOf(built));
      console.log(`${bd.id}: ${rep.errors.length} errors, ${rep.warnings.length} warnings`);
      for (const e of rep.errors) console.log('  ERROR ', e);
      for (const w of rep.warnings) console.log('  warning', w);
      if (rep.errors.length > 0 && args.includes('--write')) throw new Error(`${bd.id} does not validate; nothing written`);
    }
    if (args.includes('--write')) { writeAll(built); console.log(`wrote ${built.buildings.length} buildings and ${built.scenes.size} scenes`); }
    else if (!args.includes('--check')) { console.error('usage: tsx scripts/building/make-sample-building.ts --write | --check'); process.exit(2); }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
