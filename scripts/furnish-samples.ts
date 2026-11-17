// tsx scripts/furnish-samples.ts [--write] [sceneId ...]: gives the living rooms of the made-up sample homes their TV wall, centre table and dining table
// (scripts/furnish-living.ts) and then lets the clearing pass (src/building/clear-routes.ts) settle the loose pieces. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { clearRoutes } from '../src/building/clear-routes';
import { validateProperty } from '../src/core/layout-validate';
import { furnishKitchen, furnishLiving, freeSpawn } from './furnish-living';

const root = path.resolve(import.meta.dirname, '../public/scenes');
const args = process.argv.slice(2);
const write = args.includes('--write');
const ids = args.filter((a) => !a.startsWith('--'));
for (const id of ids.length ? ids : ['test-sample-1', 'test-sample-2', 'test-sample-3', 'test-sample-4', 'test-sample-5']) {
  const f = path.join(root, id, 'property.json');
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = validateProperty(JSON.parse(JSON.stringify(raw)));
  const dressed = furnishKitchen(p.layout, furnishLiving(p.layout, p.furniture, p.spawn), p.spawn);
  const sp = freeSpawn(p.layout, dressed, p.spawn);
  const out = clearRoutes(p.layout, dressed, sp);
  const names = out.furniture.filter((i) => i.id.startsWith('dress-') || i.id === 'sofa-1').map((i) => `${i.id} (${i.box.cx.toFixed(2)},${i.box.cz.toFixed(2)}) yaw ${i.box.yawDeg}`);
  console.log(id, 'dropped', out.dropped, 'left', out.left.shut, out.left.blockedDoors, '\n  ', names.join('\n   '));
  if (write) {
    const by = new Map(out.furniture.map((i) => [i.id, i]));
    const keep = raw.furniture.filter((i: { id: string }) => !i.id.startsWith('dress-') && by.has(i.id)).map((i: { id: string; box: Record<string, number> }) => ({ ...i, box: { ...i.box, cx: by.get(i.id)!.box.cx, cz: by.get(i.id)!.box.cz, yawDeg: by.get(i.id)!.box.yawDeg } }));
    const added = out.furniture.filter((i) => i.id.startsWith('dress-'));
    raw.furniture = [...keep, ...added];
    const sp2 = freeSpawn(p.layout, out.furniture, p.spawn);
    raw.spawn = { ...raw.spawn, x: sp2.x, z: sp2.z };
    fs.writeFileSync(f, JSON.stringify(raw, null, 2) + '\n');
  }
}
