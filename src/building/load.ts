// Fetching a building's files: building.json, the list of buildings, and the scenes behind its spaces. Every file is read the way the
// walk reads a home (no-cache, and a dev server's index page is "missing").
import { validateProperty } from '../core/layout-validate';
import { unverifiedRoomsFromExtras } from '../core/room-trust';
import type { PropertyFile } from '../types';
import { BUILDING_ID_RE, parseBuilding } from './parse';
import type { BuildingFile, BuildingIndex } from './types';

export class NotFound extends Error { constructor(what: string) { super(`${what} is not here.`); this.name = 'NotFound'; } }

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try { res = await fetch(url, { cache: 'no-cache' }); } catch (err) { throw new Error(`Could not reach the server (${String(err)}).`); }
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status} for ${url}.`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new NotFound(url);
  try { return JSON.parse(text); } catch { throw new Error(`${url} is not valid JSON.`); }
}

const buildings = new Map<string, Promise<BuildingFile>>();
export function fetchBuilding(id: string): Promise<BuildingFile> {
  if (!BUILDING_ID_RE.test(id)) return Promise.reject(new NotFound(`The building "${id}"`));
  let p = buildings.get(id);
  if (!p) {
    p = getJson(`/buildings/${id}/building.json`).then(parseBuilding, (e) => { throw e instanceof NotFound ? new NotFound(`The building "${id}"`) : e; });
    p.catch(() => buildings.delete(id));
    buildings.set(id, p);
  }
  return p;
}

export async function fetchBuildingIndex(): Promise<BuildingIndex> {
  try {
    const json = (await getJson('/buildings/index.json')) as BuildingIndex;
    if (!json || !Array.isArray(json.buildings)) return { version: 1, buildings: [] };
    return json;
  } catch (e) {
    if (e instanceof NotFound) return { version: 1, buildings: [] };
    throw e;
  }
}

export interface SceneInfo { property: PropertyFile; /** room id -> why its size was not measured */ unverified: Record<string, string> }
const scenes = new Map<string, Promise<SceneInfo>>();
export function fetchScene(sceneId: string): Promise<SceneInfo> {
  let p = scenes.get(sceneId);
  if (!p) {
    p = (async () => {
      const property = validateProperty(await getJson(`/scenes/${sceneId}/property.json`));
      let unverified: Record<string, string> = {};
      try { unverified = unverifiedRoomsFromExtras(await getJson(`/scenes/${sceneId}/proposal-extras.json`)); } catch { /* optional */ }
      return { property, unverified };
    })();
    p.catch(() => scenes.delete(sceneId));
    scenes.set(sceneId, p);
  }
  return p;
}
