// C8 CLI (SPEC 13.7): tsx scripts/import-drawing.ts <file.pdf> --scene <id> [--force] [--page <n>]
// Writes public/scenes/<id>/proposal.json, proposal-extras.json and (when absent, or with --force) a draft
// property.json, then prints a review summary. Never copies the source PDF anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVectorPages } from '../src/import/pdfjs-adapter';
import { proposeFromPages } from '../src/import/propose';
import { ImportError } from '../src/import/types';
import type { ImportResult } from '../src/import/types';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { formatArea, formatFtIn } from '../src/core/units';
import { polygonArea } from '../src/core/geometry';
import type { PropertyFile } from '../src/types';

/** The draft property.json of SPEC 13.4, built only from existing fields. */
export function buildDraftProperty(id: string, result: ImportResult): PropertyFile {
  const p = createEmptyProperty(id);
  p.title = id.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  p.layout.rooms = result.proposal.rooms;
  p.layout.openings = result.proposal.openings;
  if (result.proposal.wallHeightM !== undefined) p.layout.wallHeightM = result.proposal.wallHeightM;
  p.layout.scaleSource = 'plan-dimensions';
  p.furniture = result.extras.furniture;
  if (result.extras.spawn) p.spawn = result.extras.spawn;
  return validateProperty(JSON.parse(JSON.stringify(p)));
}

export function reviewSummary(result: ImportResult): string {
  const e = result.extras; const out: string[] = [];
  out.push(`Source: ${e.sourceFile}, plan on page ${e.planPage}`);
  out.push(`Scale: ${e.scale.ptPerM.toFixed(2)} pt per m, ${e.scale.agreeing} of ${e.scale.votes.length} votes agree, spread ${e.scale.disagreementPct.toFixed(1)}%`);
  for (const v of e.scale.votes) out.push(`  vote ${v.ptPerM.toFixed(2)}  ${v.source}`);
  out.push(`Rooms (${e.rooms.length}):`);
  for (const r of e.rooms) {
    const room = result.proposal.rooms.find((x) => x.id === r.id)!;
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    out.push(`  ${r.label} (${r.roomType}) by ${r.method}, confidence ${r.confidence}: ${w.toFixed(2)} x ${d.toFixed(2)} m (${formatFtIn(w)} x ${formatFtIn(d)}), ${formatArea(Math.abs(polygonArea(room.polygon))).text}`
      + (r.labelDims ? `; label ${formatFtIn(r.labelDims.w)} x ${formatFtIn(r.labelDims.l)}` : '') + (r.labelAreaM2 ? ` ${formatArea(r.labelAreaM2).text}` : ''));
  }
  const byType: Record<string, number> = {};
  for (const o of result.proposal.openings) byType[o.type] = (byType[o.type] ?? 0) + 1;
  out.push(`Openings: ${result.proposal.openings.length} (${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})`);
  for (const o of result.proposal.openings) out.push(`  ${o.id} on ${o.roomId} edge ${o.edge}: ${o.type}, ${o.widthM.toFixed(2)} m wide at ${o.centreM.toFixed(2)} m, sill ${o.sillM}, head ${o.headM}`);
  out.push(`Ceiling: ${e.ceiling.heightM.toFixed(2)} m by ${e.ceiling.method}, confidence ${e.ceiling.confidence}` + (e.ceiling.candidatesM.length > 1 ? ` (candidates ${e.ceiling.candidatesM.map((c) => c.toFixed(2)).join(', ')})` : ''));
  out.push(`Furniture placed (${e.furniture.length}):`);
  for (const f of e.furniture) out.push(`  ${f.id} ${f.label}: ${f.box.w.toFixed(2)} x ${f.box.d.toFixed(2)} m, yaw ${f.box.yawDeg.toFixed(0)}` + (f.inner ? `, mattress ${f.inner.w.toFixed(2)} x ${f.inner.d.toFixed(2)}` : ''));
  out.push(`Not mapped (${e.unmapped.length}):`);
  for (const u of e.unmapped) out.push(`  ${u.label}${u.sizeM ? ` ${u.sizeM.w.toFixed(2)} x ${u.sizeM.l.toFixed(2)} m` : ''}: ${u.reason}`);
  out.push(e.spawn ? `Spawn: (${e.spawn.x.toFixed(2)}, ${e.spawn.z.toFixed(2)}) yaw ${e.spawn.yawDeg}` : 'Spawn: none');
  out.push(`Warnings (${e.warnings.length}):`);
  for (const w of e.warnings) out.push(`  ${w}`);
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--scene' && args[i - 1] !== '--page');
  const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const scene = flag('--scene');
  if (!file || !scene) { console.error('Usage: tsx scripts/import-drawing.ts <file.pdf> --scene <id> [--force] [--page <n>]'); process.exit(1); }
  const force = args.includes('--force');
  const pageN = flag('--page');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(root, 'public', 'scenes', scene);
  let result: ImportResult;
  try {
    const pages = await loadVectorPages(new Uint8Array(fs.readFileSync(file)));
    result = proposeFromPages(pages, path.basename(file), scene, pageN ? { planPage: parseInt(pageN, 10) - 1 } : {});
  } catch (err) {
    if (err instanceof ImportError) {
      console.error(err.message);
      process.exit(err.code === 'raster-plan' ? 2 : 1);
    }
    throw err;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.json'), JSON.stringify(result.proposal, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'proposal-extras.json'), JSON.stringify(result.extras, null, 2) + '\n');
  const propFile = path.join(dir, 'property.json');
  let wrote = 'kept the existing property.json (use --force to replace it)';
  if (force || !fs.existsSync(propFile)) {
    fs.writeFileSync(propFile, JSON.stringify(buildDraftProperty(scene, result), null, 2) + '\n');
    wrote = 'wrote a draft property.json';
  }
  console.log(reviewSummary(result));
  console.log(`\nWrote proposal.json and proposal-extras.json, ${wrote}, in public/scenes/${scene}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
