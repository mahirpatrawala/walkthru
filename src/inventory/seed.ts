// Deterministic made-up statuses for a demonstration building (SPEC 22.3): the same ids always give the same answer, so a re-run of the setup
// script writes the same rows. About a third of the units are sold, more on the lower floors, as a tower sells. Pure.
import type { UnitStatus } from './types';

/** FNV-1a, 32 bit: small, stable, no dependency. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** `floorShare` is 0 (the lowest floor) to 1 (the highest). The chance of "sold" falls from about 55 % at the bottom to about 15 % at the top. */
export function seedStatus(buildingId: string, unitId: string, floorShare: number): UnitStatus {
  const u = hash32(`${buildingId}/${unitId}`) / 0x100000000; // [0, 1)
  const pSold = 0.55 - 0.4 * Math.min(1, Math.max(0, floorShare));
  return u < pSold ? 'sold' : 'available';
}

export function seedStatuses(buildingId: string, units: readonly { id: string; floor: number }[]): { unitId: string; status: UnitStatus }[] {
  const floors = units.map((u) => u.floor);
  const lo = Math.min(...floors), hi = Math.max(...floors);
  return units.map((u) => ({ unitId: u.id, status: seedStatus(buildingId, u.id, hi === lo ? 0 : (u.floor - lo) / (hi - lo)) }));
}
