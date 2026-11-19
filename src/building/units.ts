// The units of a tower (SPEC 22.3): the flats a buyer can be sold, floor by floor, as opposed to the flats the walk models. A building file may
// say `units: { firstFloor, floors, perFloor }`: every floor from `firstFloor` up has the same units, each of a flat type. Pure.
import type { BuildingFile, Space } from './types';

export interface UnitPlan {
  /** the number of the lowest floor that has units (the sample's flats start on floor 2; the ground and the clubhouse level have none) */
  firstFloor: number;
  /** how many floors have units */
  floors: number;
  /** the units of one floor, in the order they are listed: `number` is the two digits after the floor ("04" of 1204), `type` a key of `flatTypes` */
  perFloor: { number: number; type: string }[];
}

export interface Unit {
  /** the unit's number as a buyer says it: floor then two digits, "1204" */
  id: string;
  floor: number;
  /** its place on the floor, 1 to 99 */
  number: number;
  /** a key of the building's `flatTypes` */
  type: string;
}

export const MAX_UNITS = 2000;
/** a unit id: digits only, 3 to 6 of them (a floor of one to four digits and two for the unit) */
export const UNIT_ID_RE = /^[0-9]{3,6}$/;

export const unitId = (floor: number, number: number): string => `${floor}${String(number).padStart(2, '0')}`;

/** Every unit, lowest floor first, in each floor's own order. Deterministic: the same plan always gives the same list. */
export function generateUnits(plan: UnitPlan): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < plan.floors; i++) {
    const floor = plan.firstFloor + i;
    for (const u of plan.perFloor) out.push({ id: unitId(floor, u.number), floor, number: u.number, type: u.type });
  }
  return out;
}

export const unitsOf = (b: Pick<BuildingFile, 'units'>): Unit[] => (b.units ? generateUnits(b.units) : []);

/** Problems with a unit plan that the shape check cannot see: an unknown flat type, a repeated number, too many units. Empty when it holds together. */
export function unitPlanProblems(plan: UnitPlan, flatTypes: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const u of plan.perFloor) {
    if (!(u.type in flatTypes)) out.push(`units: the type "${u.type}" is not in flatTypes`);
    if (seen.has(u.number)) out.push(`units: the number ${u.number} is used twice on a floor`);
    seen.add(u.number);
  }
  if (plan.floors * plan.perFloor.length > MAX_UNITS) out.push(`units: ${plan.floors * plan.perFloor.length} units is more than the ${MAX_UNITS} allowed`);
  return out;
}

export interface FloorRow { floor: number; units: Unit[] }
/** The units grouped by floor, the top floor first (the way a tower is read). */
export function byFloor(units: readonly Unit[]): FloorRow[] {
  const m = new Map<number, Unit[]>();
  for (const u of units) { const l = m.get(u.floor); if (l) l.push(u); else m.set(u.floor, [u]); }
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([floor, us]) => ({ floor, units: us }));
}

export interface WalkTarget {
  space: Space;
  /** true: this very unit is modelled (the plate of its door says so). False: it is the building's walkable flat of the same type. */
  exact: boolean;
}

/**
 * Where "Walk this flat" goes. The unit's own space when the building models that floor; otherwise the lowest modelled flat of the same type (every
 * floor of a type has the same plan). Null when no flat of that type is modelled: the unit cannot be walked and says so.
 */
export function walkTargetOf(b: BuildingFile, unit: Unit): WalkTarget | null {
  let first: Space | null = null;
  for (const level of b.levels) {
    for (const s of level.spaces) {
      if (s.kind !== 'home' || s.comingNext) continue;
      if (s.portals.some((p) => p.kind === 'door' && p.plate === unit.id) || new RegExp(`^Flat ${unit.id}(?!\\d)`).test(s.name)) return { space: s, exact: true };
      if (!first && s.type === unit.type) first = s;
    }
  }
  return first ? { space: first, exact: false } : null;
}

export const findUnit = (b: Pick<BuildingFile, 'units'>, id: string): Unit | null => unitsOf(b).find((u) => u.id === id) ?? null;
