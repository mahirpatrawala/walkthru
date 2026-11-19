// The browser's side of the inventory (SPEC 22.3): read a building's statuses, send one change. The static site works without any of it: an unreachable
// service is `null` here and the pages say "Status unavailable"; a status is never made up. No secret lives in this file: the admin's passcode is typed
// by the person and sent in a header.
import { ADMIN_HEADER, INVENTORY_PATH } from './types';
import type { InventoryChange, InventoryChanged, InventoryErr, InventoryOk, UnitStatus } from './types';

type Fetch = typeof fetch;
export interface ClientOptions { fetchImpl?: Fetch; /** skip every cache (the admin page) */ fresh?: boolean }

const cache = new Map<string, Promise<InventoryOk | null>>();

/** The statuses and settings of a building, or null when the service cannot be reached or has nothing for it. Cached for the page's life unless `fresh`. */
export function fetchInventory(building: string, o: ClientOptions = {}): Promise<InventoryOk | null> {
  const key = building;
  if (!o.fresh) { const hit = cache.get(key); if (hit) return hit; }
  const f = o.fetchImpl ?? fetch;
  const url = `${INVENTORY_PATH}?building=${encodeURIComponent(building)}${o.fresh ? `&t=${Date.now()}` : ''}`;
  const p = (async (): Promise<InventoryOk | null> => {
    try {
      const res = await f(url, { cache: o.fresh ? 'no-store' : 'default', headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      return isOk(body) ? body : null;
    } catch { return null; }
  })();
  if (!o.fresh) { cache.set(key, p); void p.then((v) => { if (!v) cache.delete(key); }); }
  return p;
}
export const forgetInventory = (building?: string): void => { if (building) cache.delete(building); else cache.clear(); };

function isOk(v: unknown): v is InventoryOk {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const s = o.settings as Record<string, unknown> | undefined;
  return o.ok === true && typeof o.building === 'string' && typeof o.units === 'object' && o.units !== null && !!s && typeof s.vastuEnabled === 'boolean' && typeof s.demo === 'boolean';
}

/** Is the building's Vastu checklist switched on? False whenever the service cannot say. */
export async function vastuEnabledFor(building: string, o: ClientOptions = {}): Promise<boolean> {
  return (await fetchInventory(building, o))?.settings.vastuEnabled === true;
}

export type ChangeResult = { ok: true; body: InventoryChanged } | { ok: false; status: number; error: InventoryErr['error'] | 'network'; message: string };

/** One change, with the passcode in the header (never in the address). */
export async function sendChange(change: InventoryChange | { building: string; check: true }, passcode: string, o: ClientOptions = {}): Promise<ChangeResult> {
  const f = o.fetchImpl ?? fetch;
  try {
    const res = await f(INVENTORY_PATH, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', [ADMIN_HEADER]: passcode }, body: JSON.stringify(change) });
    const body = (await res.json()) as InventoryChanged | InventoryErr;
    if (res.ok && body.ok) { forgetInventory(change.building); return { ok: true, body }; }
    return { ok: false, status: res.status, error: body.ok ? 'server-error' : body.error, message: body.ok ? 'Unexpected answer.' : body.message };
  } catch {
    return { ok: false, status: 0, error: 'network', message: 'Could not reach the server.' };
  }
}

// ---------------------------------------------------------------- the words

export const STATUS_WORD: Record<UnitStatus, string> = { available: 'Available', sold: 'Sold' };
/** "Available", "Sold" or "Status unavailable": never a made-up status */
export const statusWord = (s: UnitStatus | undefined | null): string => (s ? STATUS_WORD[s] : 'Status unavailable');
export const DEMO_TAG = 'Demo data';

/** How many of each, over `ids`; a unit with no status is counted as unknown, never as available. */
export function tally(ids: readonly string[], units: Record<string, UnitStatus> | null): { available: number; sold: number; unknown: number } {
  const t = { available: 0, sold: 0, unknown: 0 };
  for (const id of ids) { const s = units?.[id]; if (s === 'available') t.available++; else if (s === 'sold') t.sold++; else t.unknown++; }
  return t;
}
