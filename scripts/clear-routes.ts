// One-off data pass (round 5): slides the movable pieces of the committed homes (src/building/clear-routes.ts) until nothing shuts a room away.
// usage: tsx scripts/clear-routes.ts [--write] [sceneId ...]   (no ids: every scene with a property.json). Flats and tower spaces are built by their
// own scripts, which call the same pass, so this is for the homes that are committed as drawn (the samples).
import fs from 'node:fs';
import path from 'node:path';
import { clearRoutes } from '../src/building/clear-routes';
import { validateProperty } from '../src/core/layout-validate';

const root = path.resolve(import.meta.dirname, '../public/scenes');
const args = process.argv.slice(2);
const write = args.includes('--write');
const ids = args.filter((a) => !a.startsWith('--'));
for (const id of ids.length ? ids : fs.readdirSync(root)) {
  const f = path.join(root, id, 'property.json');
  if (!fs.existsSync(f)) continue;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = validateProperty(raw);
  const out = clearRoutes(p.layout, p.furniture, p.spawn);
  if (!out.moved.length && !out.dropped.length && !out.left.shut.length && !out.left.blockedDoors.length) continue;
  console.log(id, 'moved', out.moved.map((m) => `${m.id} ${m.dx.toFixed(2)},${m.dz.toFixed(2)}`).join('; ') || 'none', '| dropped', out.dropped.join(',') || '-', '| left shut', out.left.shut.join(',') || '-', 'doors', out.left.blockedDoors.join(',') || '-');
  if (write && (out.moved.length || out.dropped.length)) {
    const by = new Map(out.furniture.map((i) => [i.id, i.box]));
    raw.furniture = raw.furniture.filter((it: { id: string }) => !out.dropped.includes(it.id));
    const mv = new Set(out.moved.map((m) => m.id));
    for (const it of raw.furniture) { const b = by.get(it.id); if (b && mv.has(it.id)) { it.box.cx = Math.round(b.cx * 1000) / 1000; it.box.cz = Math.round(b.cz * 1000) / 1000; } }
    fs.writeFileSync(f, JSON.stringify(raw, null, 2) + '\n');
  }
}
