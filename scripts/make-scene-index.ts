// Writes public/scenes/index.json: the list of homes the start page shows, found by scanning public/scenes/*/property.json.
// Run by `npm run make:room` (so Vercel's build does it), by the Vite build, and on every request of the dev server (vite.config.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSceneIndex } from '../src/start/manifest';
import type { SceneFiles, SceneIndex } from '../src/start/manifest';

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/scenes');

function readJson(file: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Scans `<dir>/*\/property.json` (and each folder's optional proposal-extras.json). Missing dir means no scenes. */
export function scanScenes(dir: string = DEFAULT_DIR, warn: (msg: string) => void = console.warn): SceneIndex {
  if (!fs.existsSync(dir)) return { version: 1, scenes: [] };
  const files: SceneFiles[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    // developer fixtures (test-* other than the sample homes) still open by ?scene= but are not listed in the gallery
    if (/^test-/.test(d.name) && !/^test-sample-/.test(d.name)) continue;
    const propertyPath = path.join(dir, d.name, 'property.json');
    if (!fs.existsSync(propertyPath)) continue;
    const property = readJson(propertyPath);
    if (property === undefined) { warn(`scene index: skipped "${d.name}" (property.json is not valid JSON)`); continue; }
    files.push({ id: d.name, property, extras: readJson(path.join(dir, d.name, 'proposal-extras.json')) });
  }
  return buildSceneIndex(files, warn);
}

export function writeSceneIndex(dir: string = DEFAULT_DIR): SceneIndex {
  const index = scanScenes(dir);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index) + '\n');
  return index;
}

const isMain = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const index = writeSceneIndex();
  console.log(`scene index: ${index.scenes.length} homes (${index.scenes.map((s) => s.id).join(', ')}) -> public/scenes/index.json`);
}
