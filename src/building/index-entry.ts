// The slim entry the start page lists for a building. Pure.
import type { BuildingFile, BuildingIndexEntry } from './types';

export function buildingIndexEntry(b: BuildingFile): BuildingIndexEntry {
  const spaces = b.levels.flatMap((l) => l.spaces);
  const flats = spaces.filter((s) => s.kind === 'home');
  const counts = new Map<string, number>();
  for (const f of flats) { const name = b.flatTypes[f.type ?? '']?.name ?? 'Flat'; counts.set(name, (counts.get(name) ?? 0) + 1); }
  const amenities = spaces.filter((s) => s.kind === 'gym' || s.kind === 'hall' || s.kind === 'games' || s.kind === 'pool' || s.kind === 'garden').map((s) => s.name);
  return {
    id: b.id, name: b.name, ...(b.subtitle ? { subtitle: b.subtitle } : {}), sample: b.sample, levels: b.levels.length, flats: flats.length,
    flatTypes: [...counts].map(([name, count]) => ({ name, count })), amenities,
  };
}

/** the amenities as the start-page card says them: the first few names, then how many more ("A, B, C and 7 more"); the entry itself keeps them all */
export function amenityLine(names: readonly string[], max = 4): string {
  if (names.length <= max) return names.join(', ');
  const more = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${more} more`;
}
