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

/**
 * The parameters that describe how this screen is run rather than where it is, and so go with the viewer from space to space and survive a reload:
 * the chrome's level (`chrome`, `autohide`), the kiosk (`kiosk`, `idle`), the area unit, and the debug and look switches. The place (`building`, `space`),
 * the spot and view of a shared link (`at`, `cam`, `view`) are not here: they say where, and are rewritten at every door.
 */
export const CARRIED_PARAMS = ['kiosk', 'idle', 'chrome', 'autohide', 'units', 'debug', 'glass', 'materials', 'models'] as const;

/** `carry`: the query string the page has now; its display parameters are kept (a kiosk that reloads is still a kiosk). */
export function buildingUrl(u: BuildingUrl, carry = ''): string {
  const q = new URLSearchParams();
  q.set('building', u.building);
  if (u.space) q.set('space', u.space);
  if (carry) {
    try {
      const from = new URLSearchParams(carry);
      for (const k of CARRIED_PARAMS) { const v = from.get(k); if (v !== null && v.length <= 40) q.set(k, v); }
    } catch { /* an unreadable query: nothing to carry */ }
  }
  return `/?${q.toString()}`;
}
