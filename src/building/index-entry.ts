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
    flatTypes: [...counts].map(([name, count]) => ({ name, count })), amenities, ...(b.bare ? { bare: true } : {}),
  };
}

/** the amenities as the start-page card says them: the first few names, then how many more ("A, B, C and 7 more"); the entry itself keeps them all */
export function amenityLine(names: readonly string[], max = 4): string {
  if (names.length <= max) return names.join(', ');
  const more = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${more} more`;
}

/** what the start-page card says a building is for: the furnished tower is walked as a buyer would, its empty twin is where you furnish it yourself */
export function purposeLine(b: { bare?: boolean }): string { return b.bare ? 'Empty: furnish it yourself' : 'Furnished: walk it as a buyer would'; }

/** the flat types in one short phrase: "2 and 3 BHK" for ["2 BHK · 644 sq ft", "3 BHK · 930 sq ft", ...]; names with no BHK are listed as they are */
export function flatKindsLine(types: readonly { name: string }[]): string {
  const bhk: number[] = [], other: string[] = [];
  for (const t of types) {
    const m = /^(\d+)\s*BHK\b/i.exec(t.name.trim());
    if (m) { if (!bhk.includes(Number(m[1]))) bhk.push(Number(m[1])); } else { const n = t.name.split(' · ')[0].trim(); if (n && !other.includes(n)) other.push(n); }
  }
  bhk.sort((a, b) => a - b);
  const parts: string[] = [];
  if (bhk.length) parts.push(bhk.length === 1 ? `${bhk[0]} BHK` : `${bhk.slice(0, -1).join(', ')} and ${bhk[bhk.length - 1]} BHK`);
  parts.push(...other);
  return parts.join(', ');
}
