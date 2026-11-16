// Sample Tower (made-up): a whole building a buyer can walk through, and its empty twin. Run: npm run make:building
//   tsx scripts/building/make-sample-building.ts --write     rebuild public/buildings/sample-tower*, public/scenes/test-tower-*
//   tsx scripts/building/make-sample-building.ts --check     build in memory and print the building-level validation
// Flats come from synthetic drawings run through the real reader (scripts/building/flats.ts); everything else is authored here
// (scripts/building/spaces.ts). The output is committed, like the sample homes, and is the same on every run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBuilding } from '../../src/building/validate';
import { validateOutdoor } from '../../src/outdoor/validate';
import { parseBuilding } from '../../src/building/parse';
import type { BuildingFile, Level, Portal, Space } from '../../src/building/types';
import type { PropertyFile } from '../../src/types';
import type { OutdoorFile } from '../../src/outdoor/types';
import { FLATS, readFlat } from './flats';
import type { FlatDesign } from './flats';
import { composeTypicalFloor, mirrorId } from './plate';
import type { Plate } from './plate';
import { LIFT_CAR, UPDATED_AT, clubhouseScenes, groundLobbyScene } from './spaces';
import { corridorScene } from './typical-floor';
import { bareCopy, furnishScene } from './furnish-spaces';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface SceneBundle { property: PropertyFile; designs?: unknown | null; extras?: unknown | null; design?: unknown | null; /** look.json: where north is */ look?: unknown | null; /** an open-air space's outdoor.json (SPEC 19.2) */ outdoor?: OutdoorFile | null }
export interface Built { buildings: BuildingFile[]; scenes: Map<string, SceneBundle> }

/**
 * Which flat sits where on the typical floor: east side from the north end, then west side from the north end, then the flat entered at the corridor's
 * north end (its entrance recess is the corridor's end). The flats are the brochure's four plans, none mirrored; the arrangement around the lift lobby is ours.
 */
const TYPICAL: { slot: string; side: 'E' | 'W' | 'N'; type: string; mirror?: boolean }[] = [
  { slot: '01', side: 'E', type: '2bhk-b4' },
  { slot: '02', side: 'E', type: '2bhk-b2' },
  { slot: '03', side: 'W', type: '3bhk-b' },
  { slot: '04', side: 'N', type: '3bhk-a' },
];
const ARRANGEMENT_NOTE = 'Flat plans follow a published builder brochure. The floor arrangement around the lift lobby is ours.';
/** The typical floors above the clubhouse level. */
const TYPICAL_FLOORS = [2, 3];

const withFixedDate = (p: PropertyFile): PropertyFile => ({ ...p, updatedAt: UPDATED_AT });

export async function buildSample(scratch: string): Promise<Built> {
  const designs: Record<string, FlatDesign> = {};
  for (const s of FLATS) designs[s.typeId] = await readFlat(s, scratch);
  // the flat across the north end is placed first: the side flats stack south of whatever of it stands out beside its door
  const plate: Plate = composeTypicalFloor([...TYPICAL].sort((a, b) => Number(b.side === 'N') - Number(a.side === 'N')).map((t) => ({ key: t.slot, side: t.side, design: designs[t.type], ...(t.mirror ? { mirror: true } : {}) })));
  const scenes = new Map<string, SceneBundle>();
  const buildings: BuildingFile[] = [];
  for (const variant of ['full', 'empty'] as const) buildings.push(assemble(variant, designs, plate, scenes));
  return { buildings, scenes };
}

function assemble(variant: 'full' | 'empty', designs: Record<string, FlatDesign>, plate: Plate, scenes: Map<string, SceneBundle>): BuildingFile {
  const empty = variant === 'empty';
  /** the empty twin has its own flats and lobby (unfurnished); the rest is bare in both, so the twin uses the same scenes */
  const flatScene = (typeId: string, mirror: boolean): string => {
    const base = FLATS.find((f) => f.typeId === typeId)!.sceneId;
    const own = empty ? base.replace(/^test-tower-/, 'test-tower-empty-') : base;
    return mirror ? mirrorId(own) : own;
  };
  const add = (id: string, b: SceneBundle): void => { if (!scenes.has(id)) scenes.set(id, b); };

  // flats (and the mirror images the plate needed)
  const mirroredTypes = new Set<string>();
  for (const f of plate.flats) {
    const t = TYPICAL.find((x) => x.slot === f.key)!.type;
    const d = designs[t];
    const plain = (p: PropertyFile, id: string): PropertyFile => withFixedDate({ ...p, id, furniture: empty ? [] : p.furniture });
    if (!scenes.has(flatScene(t, false))) add(flatScene(t, false), { property: plain(d.property, flatScene(t, false)), designs: empty ? null : d.designs, extras: d.extras, design: empty ? d.designBare : d.design, look: d.look });
    if (f.mirrored) {
      mirroredTypes.add(t);
      const id = flatScene(t, true);
      if (!scenes.has(id)) add(id, { property: plain(f.property, id), designs: empty ? null : f.designs, extras: d.extras, design: empty ? d.designBare : d.design, look: d.look });
    }
  }
  // the typical floor's corridor (bare, shared by both variants)
  const corridorScene_ = 'test-tower-corridor';
  const corridor = corridorScene(plate, corridorScene_);
  add(corridorScene_, { property: corridor.property });
  // the ground lobby
  const lobbyScene = empty ? 'test-tower-empty-lobby' : 'test-tower-lobby';
  const lobby = groundLobbyScene(lobbyScene, false);
  // stage 2: the full tower's lobby is furnished from the shared-space catalogue ON the building's marked positions (furnish-spaces.ts)
  add(lobbyScene, { property: empty ? lobby.property : furnishScene(lobby.property, 'lobby', 'entrance-lobby', { anchors: lobby.anchors }) });
  // the clubhouse level
  const ids = { foyer: 'test-tower-club-foyer', hall: 'test-tower-club-hall', gym: 'test-tower-club-gym', pool: 'test-tower-club-pool', garden: 'test-tower-club-garden', poolBare: 'test-tower-empty-club-pool', gardenBare: 'test-tower-empty-club-garden' };
  const club = clubhouseScenes(ids);
  add(ids.foyer, { property: club.foyer });
  // stage 2: the full tower's hall and gym are furnished in their own bounds, the empty twin keeps bare copies under their own ids (furnish-spaces.ts)
  const roomScene = { hall: empty ? 'test-tower-empty-club-hall' : ids.hall, gym: empty ? 'test-tower-empty-club-gym' : ids.gym };
  if (empty) { add(roomScene.hall, { property: bareCopy(club.hall, roomScene.hall) }); add(roomScene.gym, { property: bareCopy(club.gym, roomScene.gym) }); }
  else { scenes.set(ids.hall, { property: furnishScene(club.hall, 'hall', 'hall') }); scenes.set(ids.gym, { property: furnishScene(club.gym, 'gym', 'gym') }); }
  // stage 3: the pool area and the garden are open-air spaces, finished in the sample and bare in the empty tower (SPEC 19.8)
  const poolScene = empty ? ids.poolBare : ids.pool, gardenScene = empty ? ids.gardenBare : ids.garden;
  add(poolScene, { property: empty ? club.poolBare : club.pool, outdoor: empty ? club.outdoor.poolBare : club.outdoor.pool });
  add(gardenScene, { property: empty ? club.gardenBare : club.garden, outdoor: empty ? club.outdoor.gardenBare : club.outdoor.garden });

  // ---- the building
  const lift = (id: string, opening: string): Portal => ({ id, kind: 'lift', opening, lift: id });
  const stairs = (opening: string): Portal => ({ id: 'stairs', kind: 'stairs', opening, label: 'Stairs' });
  const ground: Level = {
    id: 'g', label: 'Ground', short: 'G', summary: 'Entrance lobby, lifts', floorToFloorM: 4.2,
    spaces: [{
      id: 'lobby', kind: 'lobby', name: 'Entrance lobby', sceneId: lobbyScene, placement: { x: 0, z: 0, rotDeg: 0 },
      lobbyAnchors: lobby.anchors,
      notes: empty ? ['Unfurnished. The reception, security, seating and letterbox positions are marked in lobbyAnchors.'] : ['Reception desk, security desk, visitor seating and letterbox banks from the catalogue, on the marked positions (lobbyAnchors).'],
      portals: [
        { id: 'street', kind: 'outside', opening: lobby.street, label: 'The street', prompt: 'To the street', look: 'glass' },
        lift('lift-a', lobby.liftA), lift('lift-b', lobby.liftB), stairs(lobby.stairs),
        { id: 'clubhouse', kind: 'door', opening: lobby.clubhouse, to: { space: 'clubhouse', portal: 'walkway' }, label: 'The clubhouse (level 1)', prompt: 'To the clubhouse', look: 'glass' },
      ],
    }],
  };
  const clubhouse: Level = {
    id: 'l1', label: 'Level 1', short: '1', summary: 'Clubhouse: hall, gym, pool area, garden', floorToFloorM: 4.2,
    spaces: [
      {
        id: 'clubhouse', kind: 'corridor', name: 'Clubhouse foyer', sceneId: ids.foyer, placement: { x: 0, z: 0, rotDeg: 0 },
        portals: [
          lift('lift-a', 'lift-a'), lift('lift-b', 'lift-b'), stairs('door-stairs'),
          { id: 'walkway', kind: 'door', opening: club.doors.walkway, to: { space: 'lobby', portal: 'clubhouse' }, label: 'The ground floor', prompt: 'To the ground floor', look: 'glass' },
          { id: 'hall', kind: 'door', opening: club.doors.hall, to: { space: 'hall', portal: 'foyer' }, label: 'Community hall', prompt: 'Enter the community hall', look: 'plain' },
          { id: 'gym', kind: 'door', opening: club.doors.gym, to: { space: 'gym', portal: 'foyer' }, label: 'Gym', prompt: 'Enter the gym', look: 'plain' },
          { id: 'pool', kind: 'door', opening: club.doors.pool, to: { space: 'pool', portal: 'foyer' }, label: 'Pool area', prompt: 'Enter the pool area', look: 'plain' },
          { id: 'garden', kind: 'door', opening: club.doors.garden, to: { space: 'garden', portal: 'foyer' }, label: 'Garden', prompt: 'Enter the garden', look: 'plain' },
        ],
      },
      amenity('hall', roomScene.hall, 'hall', 'Community hall', 'clubhouse', 'hall', empty ? ['Empty hall, about 12 × 8.4 m.'] : ['Hall of about 12 × 8.4 m with a stage, a podium, a screen, 60 chairs and tables (sample layout).']),
      amenity('gym', roomScene.gym, 'gym', 'Gym', 'clubhouse', 'gym', empty ? ['Empty room, about 8 × 12 m.'] : ['Gym of about 8 × 12 m with a mirror wall, cardio, strength and free-weight equipment (sample layout).']),
      { ...amenity('pool', poolScene, 'pool', 'Pool area', 'clubhouse', 'pool', empty
        ? ['The pool area, bare: the deck, an 11 × 4.5 m pool and a children\'s pool, a covered verandah left out. Nothing placed or planted.']
        : ['Open air, about 20 × 14 m: an 11 × 4.5 m pool (1.2 to 1.7 m deep) with steps, a children\'s pool, a covered verandah, loungers, parasols and planting. Water, sky and sun are drawn; the surroundings beyond the walls are not.']), outdoor: true },
      { ...amenity('garden', gardenScene, 'garden', 'Garden', 'clubhouse', 'garden', empty
        ? ['The garden, bare: a plain lawn, a paved entrance and a path, about 34 × 20 m. Nothing placed or planted.']
        : ['Open air, about 34 × 20 m: lawn with a jogging track round it, a paved plaza with a water feature, a children\'s play area, benches, a pergola and Indian garden planting. The sky is a plain graded sky, not the real view.']), outdoor: true },
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
      cportals.push({ id: `flat-${num}`, kind: 'door', opening: corridor.flatDoor[t.slot], to: { space: `f${n}-${num}`, portal: 'main' }, label: `Flat ${num}`, prompt: `Enter Flat ${num}`, look: 'main', plate: num });
      flatSpaces.push({
        id: `f${n}-${num}`, kind: 'home', name: `Flat ${num} · ${d.spec.name}`, sceneId, type: t.type, ...(f.mirrored ? { mirrored: true } : {}),
        placement: f.placement, notes: flatNotes(d, empty),
        portals: [{ id: 'main', kind: 'door', opening: d.mainOpening, to: { space: cid, portal: `flat-${num}` }, label: 'The corridor', prompt: 'To the corridor', look: 'main', plate: num }],
      });
    }
    spaces.push({ id: cid, kind: 'corridor', name: 'Corridor and lift lobby', sceneId: corridorScene_, placement: { x: 0, z: 0, rotDeg: 0 }, notes: [ARRANGEMENT_NOTE], portals: cportals }, ...flatSpaces);
    return { id: `l${n}`, label: `Level ${n}`, short: String(n), summary: `Flats ${n}01 to ${n}04`, spaces };
  };
  const levels: Level[] = [ground, clubhouse, ...TYPICAL_FLOORS.map(typical)];
  const flatTypes: BuildingFile['flatTypes'] = {};
  for (const f of FLATS) flatTypes[f.typeId] = { name: f.name, sceneId: flatScene(f.typeId, false), ...(mirroredTypes.has(f.typeId) ? { mirrorSceneId: flatScene(f.typeId, true) } : {}) };
  return {
    version: 1,
    id: empty ? 'sample-tower-empty' : 'sample-tower',
    name: empty ? 'Sample Tower, empty (made-up)' : 'Sample Tower (made-up)',
    subtitle: `${empty ? 'The same tower with every room unfurnished: where a builder starts' : 'Lobby, lifts, four flats a floor and a clubhouse level'}. ${ARRANGEMENT_NOTE}`,
    sample: true,
    note: 'Sample layout for demonstration',
    floorToFloorM: 3.1,
    flatTypes,
    lifts: ['lift-a', 'lift-b'].map((id, i) => ({ id, name: `Lift ${i === 0 ? 'A' : 'B'}`, car: { ...LIFT_CAR }, serves: levels.map((l) => l.id) })),
    levels,
    startSpace: 'lobby',
    ...(empty ? { bare: true } : {}),
  };
}

/** The lines of a flat's card on the building map: where the plan comes from, what its carpet area is, what the furniture is. */
function flatNotes(d: FlatDesign, empty: boolean): string[] {
  const a = d.authored, r = d.report.area;
  const sqft = (m2: number): string => Math.round(m2 * 10.764).toLocaleString('en-IN');
  return [
    `${a.origin}. Stated RERA carpet area ${a.carpetAreaM2} sq m (${sqft(a.carpetAreaM2)} sq ft), which counts the walls between rooms. The carpet line above adds up the rooms alone (the utility included, a balcony not), so it is smaller; the rooms and the walls between them come to ${(r.roomsM2 + r.partitionsM2).toFixed(1)} sq m.`,
    empty ? 'Unfurnished.' : "Furniture is the plan's artist's conception: illustrative sample pieces you can move or delete.",
  ];
}

function amenity(id: string, sceneId: string, kind: Space['kind'], name: string, foyer: string, portalToFoyer: string, notes: string[]): Space {
  return {
    id, kind, name, sceneId, placement: { x: 0, z: 0, rotDeg: 0 }, notes,
    portals: [{ id: 'foyer', kind: 'door', opening: 'door-foyer', to: { space: foyer, portal: portalToFoyer }, label: 'The clubhouse foyer', prompt: 'To the clubhouse foyer', look: 'plain' }],
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
    if (s.look) writeIf(path.join(dir, 'look.json'), json(s.look));
    if (s.outdoor) writeIf(path.join(dir, 'outdoor.json'), json(s.outdoor));
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
    for (const [id, sc] of built.scenes) {
      if (!sc.outdoor) continue;
      const rep = validateOutdoor(sc.outdoor, sc.property.layout);
      console.log(`${id}: outdoor ${rep.errors.length} errors, ${rep.warnings.length} warnings`);
      for (const e of rep.errors) console.log('  ERROR ', e);
      for (const w of rep.warnings) console.log('  warning', w);
      if (rep.errors.length > 0 && args.includes('--write')) throw new Error(`${id} outdoor.json does not validate; nothing written`);
    }
    if (args.includes('--write')) { writeAll(built); console.log(`wrote ${built.buildings.length} buildings and ${built.scenes.size} scenes`); }
    else if (!args.includes('--check')) { console.error('usage: tsx scripts/building/make-sample-building.ts --write | --check'); process.exit(2); }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
