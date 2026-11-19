// Where the inventory lives (SPEC 22.3). The handler talks to an `InventoryStore`; production uses Postgres through the Neon driver (`neonStore`),
// the dev server and the tests can use a store in memory (`memoryStore`). Server side only: nothing the browser loads imports this file.
import type { InventorySettings, UnitStatus } from '../types';

export interface InventoryRead { units: Record<string, UnitStatus>; settings: InventorySettings }

export interface InventoryStore {
  read(building: string): Promise<InventoryRead>;
  /** true when the status changed (or the unit had none); false when it already had this status, and nothing is written or logged */
  setStatus(building: string, unit: string, status: UnitStatus): Promise<boolean>;
  setVastu(building: string, on: boolean): Promise<void>;
}

/** The one thing the Neon driver gives us that we use: a parameterised query returning rows (`neon(url).query(text, params)`). */
export type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export const SQL = {
  units: 'SELECT unit_id, status FROM units WHERE building_id = $1',
  settings: 'SELECT vastu_enabled, demo FROM building_settings WHERE building_id = $1',
  // one statement, so it is one transaction: the row is written only when the status differs, and the log line only when the row was written
  setStatus:
    'WITH old AS (SELECT status FROM units WHERE building_id = $1 AND unit_id = $2), ' +
    'up AS (INSERT INTO units (building_id, unit_id, status, updated_at) VALUES ($1, $2, $3, now()) ' +
    'ON CONFLICT (building_id, unit_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now() WHERE units.status IS DISTINCT FROM EXCLUDED.status RETURNING status) ' +
    'INSERT INTO units_log (building_id, unit_id, old_status, new_status, at) SELECT $1::text, $2::text, (SELECT status FROM old), up.status, now() FROM up RETURNING new_status',
  setVastu:
    'INSERT INTO building_settings (building_id, vastu_enabled, updated_at) VALUES ($1, $2, now()) ' +
    'ON CONFLICT (building_id) DO UPDATE SET vastu_enabled = EXCLUDED.vastu_enabled, updated_at = now()',
} as const;

export function neonStore(query: Query): InventoryStore {
  return {
    async read(building) {
      const [rows, set] = await Promise.all([query(SQL.units, [building]), query(SQL.settings, [building])]);
      const units: Record<string, UnitStatus> = {};
      for (const r of rows) if (r.status === 'available' || r.status === 'sold') units[String(r.unit_id)] = r.status;
      return { units, settings: { vastuEnabled: set[0]?.vastu_enabled === true, demo: set[0]?.demo === true } };
    },
    async setStatus(building, unit, status) {
      const rows = await query(SQL.setStatus, [building, unit, status]);
      return rows.length > 0;
    },
    async setVastu(building, on) { await query(SQL.setVastu, [building, on]); },
  };
}

/** A store in memory, for the dev server and the tests. `log` is the append-only log. */
export function memoryStore(seed: { units?: Record<string, Record<string, UnitStatus>>; settings?: Record<string, Partial<InventorySettings>> } = {}): InventoryStore & { log: { building: string; unit: string; old: UnitStatus | null; next: UnitStatus }[] } {
  const units = new Map<string, Map<string, UnitStatus>>(Object.entries(seed.units ?? {}).map(([b, m]) => [b, new Map(Object.entries(m))]));
  const settings = new Map<string, InventorySettings>(Object.entries(seed.settings ?? {}).map(([b, s]) => [b, { vastuEnabled: s.vastuEnabled === true, demo: s.demo === true }]));
  const log: { building: string; unit: string; old: UnitStatus | null; next: UnitStatus }[] = [];
  return {
    log,
    async read(building) {
      return { units: Object.fromEntries(units.get(building) ?? []), settings: { ...(settings.get(building) ?? { vastuEnabled: false, demo: false }) } };
    },
    async setStatus(building, unit, status) {
      const m = units.get(building) ?? new Map<string, UnitStatus>();
      units.set(building, m);
      const old = m.get(unit) ?? null;
      if (old === status) return false;
      m.set(unit, status);
      log.push({ building, unit, old, next: status });
      return true;
    },
    async setVastu(building, on) { settings.set(building, { ...(settings.get(building) ?? { vastuEnabled: false, demo: false }), vastuEnabled: on }); },
  };
}
