// The admin page's pure parts (SPEC 22.3): which buildings it can manage, the sheet of floors x unit numbers, the totals. No DOM.
import { byFloor } from '../building/units';
import type { Unit, UnitPlan } from '../building/units';
import { tally } from '../inventory/client';
import type { UnitStatus } from '../inventory/types';

export interface Sheet {
  /** the unit numbers across the top, in the order the building lists them */
  columns: { number: number; type: string }[];
  /** top floor first; a cell is null where a floor has no such unit */
  rows: { floor: number; cells: (Unit | null)[] }[];
}

export function sheetOf(plan: UnitPlan, units: readonly Unit[]): Sheet {
  const columns = plan.perFloor.map((p) => ({ number: p.number, type: p.type }));
  return { columns, rows: byFloor(units).map((r) => ({ floor: r.floor, cells: columns.map((c) => r.units.find((u) => u.number === c.number) ?? null) })) };
}

export interface Totals { available: number; sold: number; unknown: number; total: number }
export function totals(units: readonly Unit[], statuses: Record<string, UnitStatus> | null): Totals {
  const t = tally(units.map((u) => u.id), statuses);
  return { ...t, total: units.length };
}

/** The sentence under the passcode box for each way a try can end. */
export function problemText(error: string): string {
  switch (error) {
    case 'admin-not-configured': return 'Admin is not set up on this site yet: no passcode has been configured on the server, so nothing can be changed.';
    case 'unauthorized': return 'That passcode is not right.';
    case 'rate-limited': return 'Too many wrong passcodes. Wait a minute and try again.';
    case 'not-configured': return 'The inventory database is not connected on this site.';
    case 'network': return 'Could not reach the server. Check the connection and try again.';
    default: return 'That did not work. Try again.';
  }
}
