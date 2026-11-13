// A floor plate or a sheet of unit plans holds several flats. Read as one plan they become one layout of 30 or 45 merged rooms. This finds
// the flats: rooms that touch (within a wall) form a flat, lobbies and passages shared by several flats are left out of the grouping, and a
// small stray piece (a balcony on its own) joins the nearest flat. When there is more than one, the import says so and lists them, so the
// broker keeps one flat and the walk-through is of that flat (SPEC 17.2, the multi-unit sheets of the real evaluation). Pure TypeScript.
import type { ImportResult } from '../import/types';
import { tokens } from './lexicon';
import { addNote } from './label-apply';

export interface FlatUnit { id: string; label: string; roomIds: string[] }
const SHARED = new Set(['lobby', 'passage', 'corridor', 'foyer', 'lift', 'entrance', 'landing', 'staircase', 'stair', 'common']);
const GAP_M = 0.5, MIN_ROOMS = 3;

export function findUnits(result: ImportResult): FlatUnit[] {
  const rooms = result.proposal.rooms.map((r) => {
    const xs = r.polygon.map((p) => p.x), zs = r.polygon.map((p) => p.z);
    return { id: r.id, label: r.label ?? r.id, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as [number, number, number, number], shared: tokens(r.label ?? '').some((t) => SHARED.has(t)) };
  });
  const flat = rooms.filter((r) => !r.shared);
  if (flat.length < 2 * MIN_ROOMS) return [];
  const gap = (a: (typeof rooms)[number], b: (typeof rooms)[number]): number => Math.hypot(Math.max(0, Math.max(a.box[0], b.box[0]) - Math.min(a.box[2], b.box[2])), Math.max(0, Math.max(a.box[1], b.box[1]) - Math.min(a.box[3], b.box[3])));
  const parent = flat.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) if (gap(flat[i], flat[j]) <= GAP_M) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  flat.forEach((_, i) => { const g = groups.get(find(i)); if (g) g.push(i); else groups.set(find(i), [i]); });
  const big = [...groups.values()].filter((g) => g.length >= MIN_ROOMS);
  if (big.length < 2) return [];
  const units: { rooms: typeof rooms }[] = big.map((g) => ({ rooms: g.map((i) => flat[i]) }));
  for (const g of groups.values()) {
    if (g.length >= MIN_ROOMS) continue;
    for (const i of g) { let best = 0, bd = Infinity; units.forEach((u, k) => { const d = Math.min(...u.rooms.map((r) => gap(r, flat[i]))); if (d < bd) { bd = d; best = k; } }); units[best].rooms.push(flat[i]); }
  }
  // a unit with a place in the sheet: left to right, top to bottom
  const ordered = units.map((u) => ({ ...u, cx: u.rooms.reduce((a, r) => a + (r.box[0] + r.box[2]) / 2, 0) / u.rooms.length, cz: u.rooms.reduce((a, r) => a + (r.box[1] + r.box[3]) / 2, 0) / u.rooms.length })).sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  return ordered.map((u, k) => ({ id: `flat-${k + 1}`, label: `Flat ${k + 1}`, roomIds: u.rooms.map((r) => r.id) }));
}

/** Records the flats on the import and says so in the warnings. Returns them (empty for a single flat). */
export function applyUnits(result: ImportResult): FlatUnit[] {
  const units = findUnits(result);
  if (!units.length) return units;
  result.extras.units = units;
  const msg = `This sheet holds ${units.length} flats (${units.map((u) => `${u.label}: ${u.roomIds.length} rooms`).join(', ')}). The rooms of all of them are listed, but a walk-through is of one flat: keep the rooms of one flat and delete the rest in the editor.`;
  addNote(result, msg, true);
  return units;
}
