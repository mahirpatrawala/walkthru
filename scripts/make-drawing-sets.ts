// C12a synthetic drawing-set generator (SPEC 17.10).
//   tsx scripts/make-drawing-sets.ts --out <dir> [--seeds 1,2,3 | --count 24] [--png] [--jpeg] [--raster]
// Writes, per set: drawing.pdf (a real PDF), truth.json, meta.json, and with --raster the raster twin (PNG pages; with
// --jpeg converted by macOS `sips`). Every set is regenerated exactly from its seed. Pure functions are exported for tests.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { VectorPage } from '../src/import/types';
import type { SetTruth } from './drawing-sets/types';
import { FIXED_SET_COUNT, buildSet } from './drawing-sets/sheet';
import type { BuiltSet } from './drawing-sets/sheet';
import { toPdf, toUserPage, toVectorPage } from './drawing-sets/render';
import type { UserPage } from './drawing-sets/render';
import { encodePng, rasterTwin } from './drawing-sets/raster';
import type { Gray } from './drawing-sets/raster';

export { FIXED_SET_COUNT, buildSet };
export type { BuiltSet, SetTruth };
export const FIXED_SEEDS = Array.from({ length: FIXED_SET_COUNT }, (_, i) => i + 1);

export function userPagesOf(b: BuiltSet): UserPage[] { return b.pages.map((p) => toUserPage(p, b.truth.options.rotation)); }
/** The pages as pdf.js would return them (PDF user space, y up). */
export function vectorPagesOf(b: BuiltSet): VectorPage[] { return userPagesOf(b).map((u, i) => toVectorPage(u, i)); }
export function pdfOf(b: BuiltSet): Uint8Array { return toPdf(userPagesOf(b)); }
/** The raster twin: every page degraded like a brochure scan or a phone photo. */
export function rasterPagesOf(b: BuiltSet): Gray[] { return userPagesOf(b).map((u, i) => rasterTwin(u, b.truth.options.raster, b.truth.seed * 31 + i)); }

function writeSet(dir: string, b: BuiltSet, raster: boolean, jpeg: boolean): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'drawing.pdf'), pdfOf(b));
  fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify(b.truth, null, 1));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ split: b.truth.split, firm: b.truth.firm, synthetic: true, seed: b.truth.seed }, null, 1));
  if (!raster) return;
  rasterPagesOf(b).forEach((g, i) => {
    const png = path.join(dir, `raster-p${i + 1}.png`);
    fs.writeFileSync(png, encodePng(g));
    if (jpeg) {
      const out = path.join(dir, `raster-p${i + 1}.jpg`);
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(b.truth.options.raster.jpegQuality), png, '--out', out], { stdio: 'ignore' });
    }
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const out = val('--out');
  if (!out) { console.error('usage: tsx scripts/make-drawing-sets.ts --out <dir> [--seeds 1,2 | --count 24] [--raster] [--jpeg]'); process.exit(2); }
  const seeds = val('--seeds') ? val('--seeds')!.split(',').map(Number) : Array.from({ length: Number(val('--count') ?? FIXED_SET_COUNT) }, (_, i) => i + 1);
  const t0 = Date.now();
  for (const s of seeds) {
    const b = buildSet(s);
    writeSet(path.join(out, b.truth.id), b, args.includes('--raster') || args.includes('--jpeg'), args.includes('--jpeg'));
    console.log(`${b.truth.id} ${b.truth.split} ${b.truth.options.template} ${b.truth.options.wallStyle} ${b.truth.options.textMode} ${b.truth.options.units} rot${b.truth.options.rotation} pages ${b.pages.length}`);
  }
  console.log(`${seeds.length} sets in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
