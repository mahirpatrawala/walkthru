// The address of a place in a building: `?building=<id>&space=<space id>`. Pure.
import { BUILDING_ID_RE, SPACE_ID_RE } from './parse';

export interface BuildingUrl {
  building: string;
  /** null: the building's map page (no walk yet) */
  space: string | null;
}

/** Reads a query string. Null when it names no valid building. A space that is not a valid id is dropped. */
export function parseBuildingUrl(search: string): BuildingUrl | null {
  const q = new URLSearchParams(search);
  const building = (q.get('building') ?? '').trim();
  if (!BUILDING_ID_RE.test(building)) return null;
  const space = (q.get('space') ?? '').trim();
  return { building, space: SPACE_ID_RE.test(space) ? space : null };
}

export function buildingUrl(u: BuildingUrl): string {
  const q = new URLSearchParams();
  q.set('building', u.building);
  if (u.space) q.set('space', u.space);
  return `/?${q.toString()}`;
}
