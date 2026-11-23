// The Views of a home as a renderer reads them (SPEC 2.10): `npx tsx scripts/export-viewpoints.ts <sceneId> [--building <id> --space <id>]`.
// Prints JSON: the scene, the frame's conventions and, for every view, its id, room, name, tab, the camera position (x, y, z: metres, three.js frame,
// y up, y = eye height) and its heading and composed pitch. These are the very points the page shows (the same pure code, the same inputs: the scene
// file's layout and furniture as drawn, and the space's or the scene's own `viewpoints` list when there is one). It reads files and prints; it writes nothing.
// `--poses` prints instead the poses file the panorama renderer reads (`npm run pano -- <scene> --poses <file>`): a list of { id, x, y, z, yaw, pitch,
// label } with the pitch up-positive as that renderer counts it, so its manifest's ids are the views' ids and the page attaches each picture to its view.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProperty } from '../src/core/layout-validate';
import { fixturesToItems } from '../src/core/fixtures';
import { fixturesFromExtras } from '../src/buyer/fixtures-load';
import { resolveViewpoints } from '../src/buyer/viewpoints/resolve';
import { exportList, posesForRenderer } from '../src/buyer/viewpoints/pano';

const args = process.argv.slice(2);
const flag = (name: string): string | null => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const sceneId = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!sceneId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(sceneId)) {
  console.error('usage: npx tsx scripts/export-viewpoints.ts <sceneId> [--building <id> --space <id>] [--poses]');
  process.exit(2);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const property = validateProperty(JSON.parse(fs.readFileSync(path.join(root, 'scenes', sceneId, 'property.json'), 'utf8')));
let extras: unknown = null;
try { extras = JSON.parse(fs.readFileSync(path.join(root, 'scenes', sceneId, 'proposal-extras.json'), 'utf8')); } catch { /* optional */ }
const own = new Set(property.furniture.map((f) => f.id));
const fixtures = fixturesToItems(fixturesFromExtras(extras), property.layout, property.furniture).filter((f) => !own.has(f.id));
// a building's space may carry its own list (and pictures)
let space: { viewpoints?: unknown[]; viewpointPanos?: Record<string, unknown> } | null = null;
const buildingId = flag('building'), spaceId = flag('space');
if (buildingId && spaceId) {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'buildings', buildingId, 'building.json'), 'utf8')) as { levels: { spaces: { id: string; sceneId: string; viewpoints?: unknown[]; viewpointPanos?: Record<string, unknown> }[] }[] };
  space = b.levels.flatMap((l) => l.spaces).find((s) => s.id === spaceId) ?? null;
  if (!space) { console.error(`no space "${spaceId}" in building "${buildingId}"`); process.exit(2); }
}
const r = resolveViewpoints({
  layout: property.layout, furniture: [...property.furniture, ...fixtures],
  override: space?.viewpoints ?? property.viewpoints, panos: space?.viewpointPanos ?? property.viewpointPanos, sceneBase: `/scenes/${sceneId}/`,
});
for (const w of r.warnings) console.error(`warning: ${w}`);
if (args.includes('--poses')) { console.log(JSON.stringify(posesForRenderer(r.views), null, 2)); process.exit(0); }
console.log(JSON.stringify({
  sceneId,
  frame: 'three.js scene frame: metres, y up, floor at y = 0; heading yawDeg looks along (sin yaw, 0, cos yaw); pitchDeg is degrees below level. A panorama is rendered level, its middle column along the heading, the right half to the viewer\'s right.',
  source: r.source,
  views: exportList(r.views),
}, null, 2));
