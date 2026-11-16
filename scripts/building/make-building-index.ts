// Writes public/buildings/index.json: the list of buildings the start page shows, found by scanning public/buildings/*/building.json.
// Run by `npm run make:room` (so Vercel's build does it) and by `npm run make:building`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildingIndexEntry } from '../../src/building/index-entry';
import { parseBuilding } from '../../src/building/parse';
import type { BuildingIndex } from '../../src/building/types';

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/buildings');

export function scanBuildings(dir: string = DEFAULT_DIR, warn: (msg: string) => void = console.warn): BuildingIndex {
  const out: BuildingIndex = { version: 1, buildings: [] };
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!d.isDirectory()) continue;
    const file = path.join(dir, d.name, 'building.json');
    if (!fs.existsSync(file)) continue;
    try {
      const b = parseBuilding(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (b.id !== d.name) { warn(`building index: skipped "${d.name}" (its id is "${b.id}")`); continue; }
      if (b.unlisted) continue;
      out.buildings.push(buildingIndexEntry(b));
    } catch (err) { warn(`building index: skipped "${d.name}" (${err instanceof Error ? err.message : String(err)})`); }
  }
  return out;
}

export function writeBuildingIndex(dir: string = DEFAULT_DIR): BuildingIndex {
  const index = scanBuildings(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index) + '\n');
  return index;
}

const isMain = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const index = writeBuildingIndex();
  console.log(`building index: ${index.buildings.length} buildings (${index.buildings.map((b) => b.id).join(', ')}) -> public/buildings/index.json`);
}
