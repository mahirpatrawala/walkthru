// Sample homes for the start page gallery. Each is a synthetic drawing set (scripts/make-drawing-sets.ts, known truth) run through the
// same job a broker upload runs (src/understand/server/run.ts: open the PDF, render, understand, write), then turned into a scene the way
// the editor turns a proposal into a draft (applyProposal). Nothing is copied from the generator's truth: the gallery shows what the
// reader made. Output: public/scenes/test-sample-<n>/ (property.json, proposal.json, proposal-extras.json, designs.json).
//   tsx scripts/make-sample-homes.ts --eval 1,2,3          read these seeds into a scratch folder and print reader vs truth
//   tsx scripts/make-sample-homes.ts --write               rebuild every home in SAMPLES into public/scenes/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSet, pdfOf } from './make-drawing-sets';
import { makeRunner } from '../src/understand/server/run';
import { makePaths } from '../src/understand/server/store';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { applyProposal, proposalToPatch } from '../src/editor/save';
import { chooseSpawn } from '../src/import/propose';
import { polygonArea } from '../src/core/geometry';
import type { PropertyFile } from '../src/types';

/** n -> generator seed. Chosen by `--eval` for variety (BHK, units, text, wall style) and for a reader result that matches the truth. */
export const SAMPLES: { n: number; seed: number; title: string }[] = [
  { n: 1, seed: 1, title: 'Sample 1 BHK' },
  { n: 2, seed: 32, title: 'Sample 1 BHK (metric drawing)' },
  { n: 3, seed: 93, title: 'Sample 2 BHK (metric drawing)' },
  { n: 4, seed: 195, title: 'Sample 2 BHK with utility room' },
  { n: 5, seed: 102, title: 'Sample 3 BHK with pooja room' },
  { n: 6, seed: 42, title: 'Sample studio flat' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BHK: Record<string, string> = { studio: 'Studio', '1bhk': '1 BHK', '2bhk': '2 BHK', '3bhk': '3 BHK', 'single-bedroom': 'Single bedroom' };

export interface Read { sceneId: string; dir: string; property: PropertyFile; truth: ReturnType<typeof buildSet>['truth']; warnings: string[] }

/** Generate the set, write its PDF to a scratch folder (never into the repo), run the upload job on it, and build the property. */
export async function readSet(seed: number, sceneId: string, scratch: string, title?: string): Promise<Read> {
  const b = buildSet(seed);
  const pdf = path.join(scratch, `${sceneId}.pdf`);
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(pdf, pdfOf(b));
  const paths = makePaths(path.join(scratch, 'root'));
  const noop = { stageStart() {}, progress() {}, stageEnd() {}, warning() {} };
  const run = makeRunner();
  await run({ jobId: 'j-sample', sceneId, options: { vision: false }, inputs: [{ path: pdf, kind: 'pdf', bytes: fs.statSync(pdf).size }], paths, signal: new AbortController().signal }, noop);
  const dir = path.join(paths.scenesDir, sceneId);
  const proposal = JSON.parse(fs.readFileSync(path.join(dir, 'proposal.json'), 'utf8'));
  const extras = JSON.parse(fs.readFileSync(path.join(dir, 'proposal-extras.json'), 'utf8'));
  const p = createEmptyProperty(sceneId);
  const patch = proposalToPatch(proposal, extras);
  applyProposal(p, patch);
  // a spawn that is a valid point; the buyer page's smart spawn replaces it
  // the largest living room, else bedroom, else any room (the importer's own pick is the largest room, which can be a store)
  const area = (r: (typeof p.layout.rooms)[number]): number => Math.abs(polygonArea(r.polygon));
  const best = (rooms: typeof p.layout.rooms): (typeof p.layout.rooms)[number] | undefined => [...rooms].sort((a, b) => area(b) - area(a))[0];
  const home = best(p.layout.rooms.filter((x) => x.roomType === 'living' && !x.partial)) ?? best(p.layout.rooms.filter((x) => x.roomType === 'bedroom' && !x.partial)) ?? best(p.layout.rooms);
  p.spawn = (home && chooseSpawn({ ...p.layout, rooms: [home], openings: [] }, p.furniture)) ?? patch.spawn ?? chooseSpawn(p.layout, p.furniture) ?? { x: 0, z: 0, yawDeg: 0 };
  p.title = title ?? `Sample ${BHK[b.truth.options.template]}`;
  p.subtitle = 'Synthetic sample drawing, made-up flat';
  p.updatedAt = new Date().toISOString();
  return { sceneId, dir, property: validateProperty(JSON.parse(JSON.stringify(p))), truth: b.truth, warnings: extras.warnings ?? [] };
}

/** One line per room: what the reader found against what the generator drew. */
export function compare(r: Read): string[] {
  const out: string[] = [];
  const found = r.property.layout.rooms;
  const truth = r.truth.rooms;
  out.push(`${r.sceneId} seed ${r.truth.seed} ${r.truth.options.template} ${r.truth.options.wallStyle} ${r.truth.options.textMode} ${r.truth.options.units} ${r.truth.options.labelStyle}: found ${found.length} rooms, truth ${truth.length}; openings ${r.property.layout.openings.length} (truth ${r.truth.openings.length}); furniture ${r.property.furniture.length} (truth items ${r.truth.items.length}); wall ${r.property.layout.wallHeightM.toFixed(2)} m (truth ${r.truth.ceilingM.toFixed(2)})`);
  const used = new Set<number>();
  for (const t of truth) {
    let best = -1, bd = Infinity;
    found.forEach((f, i) => { if (used.has(i)) return; const d = Math.abs(Math.abs(polygonArea(f.polygon)) - t.areaM2); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 0.35 * t.areaM2) { used.add(best); const f = found[best]; out.push(`  ${t.kind.padEnd(8)} truth ${t.areaM2.toFixed(1)} m2  found "${f.label}" ${Math.abs(polygonArea(f.polygon)).toFixed(1)} m2 ${f.roomType}${f.partial ? ' PARTIAL' : ''}`); }
    else out.push(`  ${t.kind.padEnd(8)} truth ${t.areaM2.toFixed(1)} m2  NOT FOUND`);
  }
  found.forEach((f, i) => { if (!used.has(i)) out.push(`  extra    "${f.label}" ${Math.abs(polygonArea(f.polygon)).toFixed(1)} m2 ${f.roomType}${f.partial ? ' PARTIAL' : ''}`); });
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-samples-'));
  try {
    if (val('--eval')) {
      for (const seed of val('--eval')!.split(',').map(Number)) {
        try { const r = await readSet(seed, `test-eval-${seed}`, scratch); console.log(compare(r).join('\n')); }
        catch (e) { console.log(`seed ${seed}: FAILED ${(e as Error).message}`); }
      }
    } else if (args.includes('--write')) {
      for (const s of SAMPLES) {
        const id = `test-sample-${s.n}`;
        const r = await readSet(s.seed, id, scratch, s.title);
        const dest = path.join(ROOT, 'public', 'scenes', id);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'property.json'), JSON.stringify(r.property, null, 2) + '\n');
        for (const f of ['proposal.json', 'proposal-extras.json', 'designs.json']) if (fs.existsSync(path.join(r.dir, f))) fs.copyFileSync(path.join(r.dir, f), path.join(dest, f));
        console.log(compare(r).join('\n'));
      }
    } else { console.error('usage: tsx scripts/make-sample-homes.ts --eval 1,2,3 | --write'); process.exit(2); }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
