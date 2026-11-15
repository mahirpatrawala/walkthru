// The sample plan behind "Try a sample plan" on the start page: a made-up flat from the synthetic drawing sets (scripts/drawing-sets, a known
// generator seed), written as a vector PDF to public/upload/sample-plan.pdf. It runs in `npm run make:room`, so the Vercel build writes it fresh.
// The PDF holds no real drawing, firm or person, and the page labels it as made-up.
//   tsx scripts/make-upload-sample.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSet, pdfOf } from './make-drawing-sets';

/** Chosen for a quick, whole read (every room found and named) that still shows the honest parts: see tests/upload-*.test.ts */
export const SAMPLE_SEED = 32;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function writeSample(dest = path.join(ROOT, 'public', 'upload', 'sample-plan.pdf')): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const bytes = pdfOf(buildSet(SAMPLE_SEED));
  if (!fs.existsSync(dest) || !Buffer.from(bytes).equals(fs.readFileSync(dest))) fs.writeFileSync(dest, bytes);
  return dest;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) console.log(`wrote ${path.relative(ROOT, writeSample())}`);
