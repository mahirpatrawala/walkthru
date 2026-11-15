// Reads and checks a building.json. Throws an Error with a readable message that names where the problem is.
// Shape first (types, ids, ranges), then the links between parts (portals pair up, lifts serve real levels, flat types exist).
import { SPACE_KINDS } from './types';
import type { BuildingFile, DoorLook, FlatType, Level, Lift, Placement, Portal, Space, SpaceKind } from './types';

export const BUILDING_ID_RE = /^[a-z0-9-]{1,40}$/;
export const SPACE_ID_RE = /^[a-z0-9-]{1,40}$/;
const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

export class BuildingFormatError extends Error {
  constructor(public path: string, message: string) { super(`building.json: ${path} ${message}`); this.name = 'BuildingFormatError'; }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (path: string, msg: string): never => { throw new BuildingFormatError(path, msg); };

function str(o: Record<string, unknown>, k: string, path: string, opt = false): string {
  const v = o[k];
  if (v === undefined && opt) return '';
  if (typeof v !== 'string' || v.trim() === '') return fail(`${path}.${k}`, 'must be a non-empty text');
  return v;
}
function num(o: Record<string, unknown>, k: string, path: string, min: number, max: number): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${path}.${k}`, 'must be a number');
  if (v < min || v > max) return fail(`${path}.${k}`, `must be between ${min} and ${max} (got ${v})`);
  return v;
}
function arr(o: Record<string, unknown>, k: string, path: string, minLen = 0): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) return fail(`${path}.${k}`, 'must be a list');
  if (v.length < minLen) return fail(`${path}.${k}`, `needs at least ${minLen} ${minLen === 1 ? 'entry' : 'entries'}`);
  return v;
}

function parsePlacement(v: unknown, path: string): Placement {
  if (!isObj(v)) return fail(path, 'must be {x, z, rotDeg}');
  const rot = v.rotDeg ?? 0;
  if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) return fail(`${path}.rotDeg`, `must be 0, 90, 180 or 270 (got ${String(rot)})`);
  return { x: num(v, 'x', path, -500, 500), z: num(v, 'z', path, -500, 500), rotDeg: rot };
}

function parsePortal(v: unknown, path: string): Portal {
  if (!isObj(v)) return fail(path, 'must be an object');
  const id = str(v, 'id', path);
  const opening = str(v, 'opening', path);
  const kind = v.kind;
  const look = (): DoorLook | undefined => {
    if (v.look === undefined) return undefined;
    if (v.look !== 'main' && v.look !== 'glass' && v.look !== 'plain' && v.look !== 'lift' && v.look !== 'stairs') return fail(`${path}.look`, `must be main, glass, plain, lift or stairs (got ${String(v.look)})`);
    return v.look;
  };
  if (kind === 'door') {
    const to = v.to;
    if (!isObj(to)) return fail(`${path}.to`, 'must be {space, portal}');
    return { id, kind, opening, to: { space: str(to, 'space', `${path}.to`), portal: str(to, 'portal', `${path}.to`) }, label: str(v, 'label', path), look: look(), ...(typeof v.prompt === 'string' ? { prompt: v.prompt } : {}), ...(typeof v.plate === 'string' ? { plate: v.plate } : {}) };
  }
  if (kind === 'lift') return { id, kind, opening, lift: str(v, 'lift', path), ...(typeof v.label === 'string' ? { label: v.label } : {}) };
  if (kind === 'stairs') return { id, kind, opening, ...(typeof v.label === 'string' ? { label: v.label } : {}) };
  if (kind === 'outside') return { id, kind, opening, label: str(v, 'label', path), look: look(), ...(typeof v.prompt === 'string' ? { prompt: v.prompt } : {}) };
  return fail(`${path}.kind`, `must be door, lift, stairs or outside (got ${String(kind)})`);
}

function parseSpace(v: unknown, path: string): Space {
  if (!isObj(v)) return fail(path, 'must be an object');
  const id = str(v, 'id', path);
  if (!SPACE_ID_RE.test(id)) fail(`${path}.id`, `"${id}" is not a valid id (lower-case letters, digits and hyphens, up to 40)`);
  const kind = v.kind as SpaceKind;
  if (!SPACE_KINDS.includes(kind)) fail(`${path}.kind`, `must be one of ${SPACE_KINDS.join(', ')} (got ${String(v.kind)})`);
  const sceneId = str(v, 'sceneId', path);
  if (!SCENE_ID_RE.test(sceneId)) fail(`${path}.sceneId`, `"${sceneId}" is not a valid scene id`);
  const s: Space = {
    id, kind, name: str(v, 'name', path), sceneId,
    placement: v.placement === undefined ? { x: 0, z: 0, rotDeg: 0 } : parsePlacement(v.placement, `${path}.placement`),
    portals: arr(v, 'portals', path).map((p, i) => parsePortal(p, `${path}.portals[${i}]`)),
  };
  if (v.type !== undefined) s.type = str(v, 'type', path);
  if (v.mirrored !== undefined) { if (typeof v.mirrored !== 'boolean') fail(`${path}.mirrored`, 'must be true or false'); s.mirrored = v.mirrored as boolean; }
  if (v.comingNext !== undefined) s.comingNext = v.comingNext === true;
  if (v.outdoor !== undefined) { if (typeof v.outdoor !== 'boolean') fail(`${path}.outdoor`, 'must be true or false'); s.outdoor = v.outdoor as boolean; }
  if (v.pack !== undefined) s.pack = str(v, 'pack', path);
  if (v.notes !== undefined) s.notes = arr(v, 'notes', path).map((n, i) => (typeof n === 'string' ? n : fail(`${path}.notes[${i}]`, 'must be text')));
  return s;
}

function parseLevel(v: unknown, path: string): Level {
  if (!isObj(v)) return fail(path, 'must be an object');
  const l: Level = {
    id: str(v, 'id', path), label: str(v, 'label', path), short: str(v, 'short', path), summary: str(v, 'summary', path, true),
    spaces: arr(v, 'spaces', path, 1).map((s, i) => parseSpace(s, `${path}.spaces[${i}]`)),
  };
  if (v.floorToFloorM !== undefined) l.floorToFloorM = num(v, 'floorToFloorM', path, 2.4, 8);
  return l;
}

function parseLift(v: unknown, path: string): Lift {
  if (!isObj(v)) return fail(path, 'must be an object');
  const car = v.car;
  if (!isObj(car)) return fail(`${path}.car`, 'must be {widthM, depthM, doorM}');
  return {
    id: str(v, 'id', path), name: str(v, 'name', path),
    car: { widthM: num(car, 'widthM', `${path}.car`, 0.8, 3), depthM: num(car, 'depthM', `${path}.car`, 0.8, 3.5), doorM: num(car, 'doorM', `${path}.car`, 0.6, 1.5) },
    serves: arr(v, 'serves', path, 1).map((s, i) => (typeof s === 'string' ? s : fail(`${path}.serves[${i}]`, 'must be a level id'))),
  };
}

/** Every problem in the links between the parts (shape already checked). Empty when the building holds together. */
export function checkLinks(b: BuildingFile): string[] {
  const out: string[] = [];
  const levelIds = new Set<string>();
  const spaces = new Map<string, { space: Space; level: Level }>();
  for (const l of b.levels) {
    if (levelIds.has(l.id)) out.push(`levels: the id "${l.id}" is used twice`);
    levelIds.add(l.id);
    for (const s of l.spaces) {
      if (spaces.has(s.id)) out.push(`spaces: the id "${s.id}" is used twice`);
      spaces.set(s.id, { space: s, level: l });
    }
  }
  const liftIds = new Set(b.lifts.map((x) => x.id));
  if (liftIds.size !== b.lifts.length) out.push('lifts: an id is used twice');
  for (const lift of b.lifts) for (const lv of lift.serves) if (!levelIds.has(lv)) out.push(`lift "${lift.id}" serves level "${lv}", which does not exist`);
  if (b.startSpace && !spaces.has(b.startSpace)) out.push(`startSpace "${b.startSpace}" is not a space of this building`);
  for (const { space } of spaces.values()) {
    const where = `space "${space.id}"`;
    if (space.kind === 'flat') {
      if (!space.type) out.push(`${where} is a flat but has no type`);
      else {
        const t = b.flatTypes[space.type];
        if (!t) out.push(`${where} has the type "${space.type}", which is not in flatTypes`);
        else {
          const want = space.mirrored ? t.mirrorSceneId : t.sceneId;
          if (space.mirrored && !t.mirrorSceneId) out.push(`${where} is mirrored but type "${space.type}" has no mirrorSceneId`);
          else if (want && space.sceneId !== want) out.push(`${where} uses scene "${space.sceneId}" but its ${space.mirrored ? 'mirrored ' : ''}type "${space.type}" is scene "${want}"`);
        }
      }
    } else if (space.type || space.mirrored) out.push(`${where} is not a flat, so it takes no type or mirror`);
    const pids = new Set<string>();
    const openings = new Set<string>();
    for (const p of space.portals) {
      if (pids.has(p.id)) out.push(`${where}: the portal id "${p.id}" is used twice`);
      pids.add(p.id);
      if (openings.has(p.opening)) out.push(`${where}: the opening "${p.opening}" has two portals`);
      openings.add(p.opening);
      if (p.kind === 'door') {
        const far = spaces.get(p.to.space);
        if (!far) { out.push(`${where}, portal "${p.id}": leads to space "${p.to.space}", which does not exist`); continue; }
        const back = far.space.portals.find((q) => q.id === p.to.portal);
        if (!back) out.push(`${where}, portal "${p.id}": space "${p.to.space}" has no portal "${p.to.portal}"`);
        else if (back.kind !== 'door') out.push(`${where}, portal "${p.id}": the far side "${p.to.portal}" is a ${back.kind}, not a door`);
        else if (back.to.space !== space.id || back.to.portal !== p.id) out.push(`${where}, portal "${p.id}": the far side does not lead back (it leads to "${back.to.space}/${back.to.portal}")`);
      } else if (p.kind === 'lift') {
        const lift = b.lifts.find((x) => x.id === p.lift);
        if (!lift) out.push(`${where}, portal "${p.id}": lift "${p.lift}" is not defined`);
        else {
          const here = spaces.get(space.id)!.level.id;
          if (!lift.serves.includes(here)) out.push(`${where}, portal "${p.id}": lift "${p.lift}" does not serve this level ("${here}")`);
        }
      }
    }
  }
  // each lift needs exactly one lift door on each level it serves, or the lift panel has nowhere to land
  for (const lift of b.lifts) {
    for (const lv of lift.serves) {
      const level = b.levels.find((l) => l.id === lv);
      if (!level) continue;
      const doors = level.spaces.flatMap((s) => s.portals.filter((p) => p.kind === 'lift' && p.lift === lift.id));
      if (doors.length !== 1) out.push(`level "${lv}": lift "${lift.id}" must have exactly one lift door there (found ${doors.length})`);
    }
  }
  return out;
}

/** Parses and checks a building.json. Throws an Error naming the first problem. */
export function parseBuilding(json: unknown): BuildingFile {
  if (!isObj(json)) return fail('the file', 'must be a JSON object');
  if (json.version !== 1) fail('version', 'must be 1');
  const id = str(json, 'id', 'building');
  if (!BUILDING_ID_RE.test(id)) fail('id', `"${id}" is not a valid id (lower-case letters, digits and hyphens, up to 40)`);
  const flatTypes: Record<string, FlatType> = {};
  const ft = json.flatTypes ?? {};
  if (!isObj(ft)) fail('flatTypes', 'must be an object');
  for (const [k, v] of Object.entries(ft as Record<string, unknown>)) {
    if (!isObj(v)) return fail(`flatTypes.${k}`, 'must be an object');
    flatTypes[k] = { name: str(v, 'name', `flatTypes.${k}`), sceneId: str(v, 'sceneId', `flatTypes.${k}`), ...(typeof v.mirrorSceneId === 'string' ? { mirrorSceneId: v.mirrorSceneId } : {}) };
  }
  const b: BuildingFile = {
    version: 1, id, name: str(json, 'name', 'building'),
    sample: json.sample === true,
    note: str(json, 'note', 'building', json.sample !== true),
    floorToFloorM: num(json, 'floorToFloorM', 'building', 2.4, 8),
    flatTypes,
    lifts: (json.lifts === undefined ? [] : arr(json, 'lifts', 'building')).map((l, i) => parseLift(l, `lifts[${i}]`)),
    levels: arr(json, 'levels', 'building', 1).map((l, i) => parseLevel(l, `levels[${i}]`)),
  };
  if (typeof json.subtitle === 'string') b.subtitle = json.subtitle;
  if (typeof json.startSpace === 'string') b.startSpace = json.startSpace;
  if (json.unlisted === true) b.unlisted = true;
  if (json.bare === true) b.bare = true;
  if (b.sample && !b.note) b.note = 'Sample layout for demonstration';
  const problems = checkLinks(b);
  if (problems.length) throw new BuildingFormatError('links', `${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`);
  return b;
}

// ---------------------------------------------------------------- lookups

export interface Located { space: Space; level: Level; levelIndex: number }
export function spaceIndex(b: BuildingFile): Map<string, Located> {
  const m = new Map<string, Located>();
  b.levels.forEach((level, levelIndex) => { for (const space of level.spaces) m.set(space.id, { space, level, levelIndex }); });
  return m;
}
export function findSpace(b: BuildingFile, id: string | null | undefined): Located | null {
  if (!id) return null;
  return spaceIndex(b).get(id) ?? null;
}
/** The space the entry page starts in. */
export function startSpaceOf(b: BuildingFile): Located {
  return findSpace(b, b.startSpace) ?? findSpace(b, b.levels[0].spaces[0].id)!;
}
/** The lift door of `lift` on `levelId`, with its space. */
export function liftDoorAt(b: BuildingFile, liftId: string, levelId: string): { space: Space; portal: Extract<Portal, { kind: 'lift' }> } | null {
  const level = b.levels.find((l) => l.id === levelId);
  if (!level) return null;
  for (const space of level.spaces) for (const portal of space.portals) if (portal.kind === 'lift' && portal.lift === liftId) return { space, portal };
  return null;
}
/** Flats on a level, for "Flats 201–204". */
export const flatCount = (b: BuildingFile): number => b.levels.reduce((n, l) => n + l.spaces.filter((s) => s.kind === 'flat').length, 0);
