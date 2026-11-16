// The four flat designs of the sample tower: two 3 BHKs and two 2 BHKs whose plans follow a published builder brochure. Each is a typed spec of the
// brochure's printed room sizes (brochure-flats/*.ts, authored with flat-spec.ts), checked against its own numbers, then shaped into a scene: the
// layout, the sample furniture the brochure's plan draws ("artist's conception", so illustrative), the room finishes of the brochure's internal
// specification as a design sheet, and the notes about what the plan did not give. Nothing here reads a drawing: the sizes are typed.
import { buildFlatScene, buildLayout, checkFlat, SIDE_EDGE } from './flat-spec';
import type { AcSpec, AuthoredFlat, FlatReport } from './flat-spec';
import { flat3bhkA } from './brochure-flats/3bhk-a';
import { flat3bhkB } from './brochure-flats/3bhk-b';
import { flat2bhkB2 } from './brochure-flats/2bhk-b2';
import { flat2bhkB4 } from './brochure-flats/2bhk-b4';
import type { PropertyFile } from '../../src/types';

/** What the rest of the generator reads of a flat type. */
export interface FlatSpec { typeId: string; name: string; sceneId: string }
export const MAIN_DOOR_ID = 'door-main';

/** The flats, in the order of the building's flat types. */
export const AUTHORED: AuthoredFlat[] = [flat3bhkA, flat3bhkB, flat2bhkB2, flat2bhkB4];
export const FLATS: FlatSpec[] = AUTHORED.map((a) => ({ typeId: a.typeId, name: a.name, sceneId: a.sceneId }));

export interface FlatDesign {
  spec: FlatSpec;
  authored: AuthoredFlat;
  report: FlatReport;
  property: PropertyFile;
  designs: unknown | null;
  extras: unknown | null;
  design: unknown | null;
  /** the same sheet without the decor, for the empty twin */
  designBare: unknown | null;
  /** look.json: where north is */
  look: unknown | null;
  mainOpening: string;
}

const SUBTITLE = 'Sample building · plan follows a published builder brochure, furniture illustrative';
/** the generator's fixed time stamp, so the files are identical on every run */
const STAMP = '2026-11-16T00:00:00.000Z';

// ---------------------------------------------------------------- the internal specification, as the scene format can say it

/**
 * The brochure's internal specification, mapped to what a scene can express (SPEC 18.13): finish ids of the look's own table (src/look/finishes.ts)
 * per room, through the design sheet. Vitrified floors in the dry rooms and the kitchen; premium tiles in the utility, the balcony and the toilets;
 * the toilets' walls take the tile colour whole (the format has no dado height); a quartz platform; flush doors with a laminate finish.
 */
export const SPEC_FINISHES = {
  dry: { floor: 'tile-ivory-gloss' },
  kitchen: { floor: 'tile-ivory-gloss' },
  wet: { floor: 'tile-grey', wall: 'tile-grey' },
  utility: { floor: 'tile-sand' },
  balcony: { floor: 'tile-sand' },
} as const;
export const SPEC_COUNTER_TOP = 'white-stone';
export const SPEC_DOOR_FINISH = 'oak-warm';
export const SPEC_PACK = 'clean-contrast';

function acFixtures(spec: AuthoredFlat, acs: AcSpec[]): { kind: 'ac'; roomId: string; edge: number; u: number; y: number }[] {
  const built = buildLayout(spec);
  return acs.map((a) => {
    const room = built.rooms.find((r) => r.id === a.room);
    if (!room) throw new Error(`${spec.sceneId}: ac names no room "${a.room}"`);
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const p = room.polygon[i], q = room.polygon[(i + 1) % n];
      const side = Math.abs(q.z - p.z) < 1e-9 ? (q.x > p.x ? 'N' : 'S') : q.z > p.z ? 'E' : 'W';
      if (side !== a.wall || room.edges[i] !== 'wall') continue;
      const horiz = a.wall === 'N' || a.wall === 'S';
      const lo = horiz ? Math.min(p.x, q.x) : Math.min(p.z, q.z), hi = horiz ? Math.max(p.x, q.x) : Math.max(p.z, q.z);
      if (a.at < lo + 0.4 || a.at > hi - 0.4) continue;
      const u = horiz ? (q.x > p.x ? a.at - p.x : p.x - a.at) : (q.z > p.z ? a.at - p.z : p.z - a.at);
      return { kind: 'ac' as const, roomId: a.room, edge: i, u: Math.round(u * 1000) / 1000, y: a.y ?? 2.1 };
    }
    throw new Error(`${spec.sceneId}: no free ${a.wall} wall of "${a.room}" at ${a.at} for the AC`);
  });
}
void SIDE_EDGE;

/** `bare`: the specification only (finishes of the rooms and the doors), none of the typical decor (the AC points): the empty twin, a builder starting from nothing */
function designSheet(spec: AuthoredFlat, bare: boolean): unknown {
  const rooms: Record<string, { wall?: string; floor?: string }> = {};
  for (const r of spec.rooms) rooms[r.id] = { ...SPEC_FINISHES[r.finish] };
  const items: Record<string, unknown> = { decor: { roles: { door: SPEC_DOOR_FINISH } } };
  if (!bare) for (const p of spec.pieces) if (/kitchen counter/i.test(p.label)) items[p.id] = { roles: { top: SPEC_COUNTER_TOP } };
  return {
    version: 1, pack: SPEC_PACK, source: 'typical',
    note: 'The internal specification of a published builder brochure, as finishes of this look: vitrified floors in the living, dining, bedrooms, kitchen and passages; premium tiles in the utility, the balcony and the toilets; a quartz kitchen platform; flush doors with a laminate finish. Colours are typical, the specification gives none.',
    items, rooms, fixtures: bare ? [] : acFixtures(spec, spec.ac ?? []),
  };
}

function extrasOf(spec: AuthoredFlat, report: FlatReport): unknown {
  return {
    version: 1,
    sourceFile: 'typed room sizes from a published builder brochure',
    planPage: 1,
    scale: { ptPerM: 0, votes: [], agreeing: 0, disagreementPct: 0, note: 'sizes are typed, not measured off an image' },
    rooms: report.rooms.map((r) => ({
      id: r.id, label: r.label, roomType: spec.rooms.find((x) => x.id === r.id)!.type, method: 'label-rect', confidence: 1,
      labelDims: { w: r.parts[0].printed[0], l: r.parts[0].printed[1] }, areaM2: r.areaM2, verified: true,
    })),
    // the brochure gives no ceiling height: the scene's 2.75 m is typical, and is not confirmed
    ceiling: { heightM: spec.wallHeightM, method: 'default', page: null, candidatesM: [], confidence: 0.1, verified: false },
    furniture: [], unmapped: [], spawn: spec.spawn,
    carpet: {
      statedM2: spec.carpetAreaM2, usableM2: spec.usableAreaM2 ?? null, roomsM2: round(report.area.roomsM2), partitionsM2: round(report.area.partitionsM2),
      deviationPct: round(report.area.deviationFrac * 100), tolerancePct: spec.carpetToleranceFrac * 100,
    },
    assumptions: [
      'Room sizes are the plan\'s printed sizes. Where a room sits is scaled off the plan\'s picture, to about 10 cm.',
      'Door and window widths, sill and head heights, wall thicknesses and the ceiling height are not printed: they are scaled off the picture or typical, and not measured.',
      'Furniture, fittings and the balcony chairs are the plan\'s "artist\'s conception": drawn where the plan draws them, at catalogue sizes, illustrative.',
      ...spec.notes,
    ],
    warnings: [
      'Ceiling height not given by the source. Using 2.75 m. Not confirmed.',
      'Door and window sizes are scaled from the plan, not measured.',
    ],
  };
}
const round = (v: number): number => Math.round(v * 100) / 100;

/** Builds one flat: the spec is checked first (flat-spec.ts), and a spec that contradicts its own printed numbers builds nothing. */
export async function readFlat(spec: FlatSpec, _scratch?: string): Promise<FlatDesign> {
  void _scratch;
  const authored = AUTHORED.find((a) => a.typeId === spec.typeId);
  if (!authored) throw new Error(`no authored flat "${spec.typeId}"`);
  const { property, report } = buildFlatScene(authored, STAMP);
  property.subtitle = SUBTITLE;
  property.title = authored.title;
  return {
    spec, authored, report, property,
    designs: { version: 1, source: 'Typed room sizes, no drawing set', items: {} },
    extras: extrasOf(authored, report),
    design: designSheet(authored, false),
    designBare: designSheet(authored, true),
    look: { version: 1, northDeg: authored.northDeg },
    mainOpening: authored.mainDoor,
  };
}

export { checkFlat };
