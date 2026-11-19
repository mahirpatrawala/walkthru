// A building's own unit list, read from its building.json on the server (SPEC 22.3): the ids the endpoint accepts are exactly the units that file
// generates, nothing else. The function ships the building files (vercel.json `includeFiles`); the dev server reads them from the repo.
// Server side only. (Relative imports carry .js because the Vercel function is ESM.)
import fs from 'node:fs';
import path from 'node:path';
import { generateUnits, MAX_UNITS } from '../../building/units.js';
import type { UnitPlan } from '../../building/units.js';
import { BUILDING_ID_RE } from './handler.js';

/** Reads `units` out of a parsed building.json without the app's whole parser: the shape, the ranges, nothing more. Null when it has none or is wrong. */
export function unitIdsOf(json: unknown): string[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const u = (json as { units?: unknown }).units;
  if (typeof u !== 'object' || u === null) return null;
  const p = u as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(p.firstFloor, 1, 200) || !int(p.floors, 1, 200) || !Array.isArray(p.perFloor) || p.perFloor.length < 1 || p.perFloor.length > 20) return null;
  const perFloor: UnitPlan['perFloor'] = [];
  for (const e of p.perFloor as unknown[]) {
    if (typeof e !== 'object' || e === null) return null;
    const r = e as Record<string, unknown>;
    if (!int(r.number, 1, 99) || typeof r.type !== 'string') return null;
    perFloor.push({ number: r.number, type: r.type });
  }
  if (p.floors * perFloor.length > MAX_UNITS) return null;
  return generateUnits({ firstFloor: p.firstFloor, floors: p.floors, perFloor }).map((x) => x.id);
}

export function fileUnitsLoader(root: string, ttlMs = 5 * 60_000): (building: string) => Promise<string[] | null> {
  const cache = new Map<string, { at: number; ids: string[] | null }>();
  return async (building) => {
    if (!BUILDING_ID_RE.test(building)) return null; // the id is a plain name before it is ever part of a path
    const hit = cache.get(building);
    if (hit && Date.now() - hit.at < ttlMs) return hit.ids;
    let ids: string[] | null = null;
    try { ids = unitIdsOf(JSON.parse(await fs.promises.readFile(path.join(root, 'public', 'buildings', building, 'building.json'), 'utf8'))); } catch { ids = null; }
    cache.set(building, { at: Date.now(), ids });
    return ids;
  };
}
