// Writes public/scenes/index.json: the list of homes the start page shows, found by scanning public/scenes/*/property.json.
// Run by `npm run make:room` (so Vercel's build does it), by the Vite build, and on every request of the dev server (vite.config.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSceneIndex } from '../src/start/manifest';
import type { SceneFiles, SceneIndex } from '../src/start/manifest';

/**
 * Homes kept in the repo (they still open by ?scene=<id>) but taken off the gallery.
 * Five of the six made-up sample homes (test-sample-*) came off on 17 Nov 2026, when the four flats that follow a published brochure took their
 * place. To list them again, remove their line here.
 */
export const GALLERY_HIDDEN: RegExp[] = [
  // every made-up sample home except the first (the 1 BHK, kept on the gallery at the owner's wish)
  /^test-sample-(?!1$)/,
  // the phone-video scenes (all of them made-up samples today), off the gallery with them
  /^video-/,
];

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/scenes');

function readJson(file: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Scans `<dir>/*\/property.json` (and each folder's optional proposal-extras.json). Missing dir means no scenes. */
export function scanScenes(dir: string = DEFAULT_DIR, warn: (msg: string) => void = console.warn, hidden: readonly RegExp[] = GALLERY_HIDDEN): SceneIndex {
  if (!fs.existsSync(dir)) return { version: 1, scenes: [] };
  const files: SceneFiles[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const propertyPath = path.join(dir, d.name, 'property.json');
    if (!fs.existsSync(propertyPath)) continue;
    const property = readJson(propertyPath);
    // a scene that asks for the gallery (`gallery: true`: a building's flat worth opening on its own) is listed whatever its name
    const asked = (property as { gallery?: unknown } | undefined)?.gallery === true;
    if (!asked) {
      // developer fixtures (test-* other than the sample homes) still open by ?scene= but are not listed in the gallery
      if (/^test-/.test(d.name) && !/^test-sample-/.test(d.name)) continue;
      if (hidden.some((re) => re.test(d.name))) continue;
    }
    if (property === undefined) { warn(`scene index: skipped "${d.name}" (property.json is not valid JSON)`); continue; }
    // link-only homes (a client's design): they open by ?scene= but are not listed in the gallery
    if (!asked && (property as { unlisted?: unknown }).unlisted === true) continue;
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
