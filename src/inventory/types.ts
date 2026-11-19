// The inventory of a building's units (SPEC 22.3): what the service answers and what the viewer reads. Shared by the function, the pages and the tests.
// Two statuses only, available or sold. No prices, no enquiries.

export const UNIT_STATUSES = ['available', 'sold'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export const isStatus = (v: unknown): v is UnitStatus => v === 'available' || v === 'sold';

export interface InventorySettings {
  /** the building shows its Vastu checklist to buyers (only where north is set) */
  vastuEnabled: boolean;
  /** the statuses are made-up demonstration data: the viewer says so beside them */
  demo: boolean;
}

/** GET /api/inventory?building=<id> */
export interface InventoryOk {
  ok: true;
  building: string;
  /** unit id -> status; a unit with no row is simply not in it ("Status unavailable" for that unit) */
  units: Record<string, UnitStatus>;
  settings: InventorySettings;
}

export type InventoryErrorCode = 'bad-request' | 'unknown-building' | 'unknown-unit' | 'unauthorized' | 'admin-not-configured' | 'not-configured' | 'rate-limited' | 'method-not-allowed' | 'server-error';
export interface InventoryErr { ok: false; error: InventoryErrorCode; message: string }

/** POST /api/inventory, header `x-admin-passcode`: one change. */
export type InventoryChange =
  | { building: string; unit: string; status: UnitStatus }
  | { building: string; vastuEnabled: boolean };
export interface InventoryChanged { ok: true; building: string; changed: boolean; unit?: string; status?: UnitStatus; vastuEnabled?: boolean }

export const ADMIN_HEADER = 'x-admin-passcode';
export const INVENTORY_PATH = '/api/inventory';
