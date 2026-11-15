// Dev-set probe: what the local reader sees on one DEV picture (refuses held-out sets): each block's primary read, the second opinions,
// and the size candidates it turned into. For tuning the engine's repairs; prints raw text of dev plans only.
//   tsx scripts/eval/probe-ocr.ts r12
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodeImage } from '../../src/understand/pixels/image';
import { preprocess } from '../../src/understand/pixels/preprocess';
import { readLabels } from '../../src/understand/raster-local';
import { closeOcrEngine } from '../../src/understand/local/ocr-backend';

const root = path.join(os.homedir(), 'walkthru-tools', 'eval', 'real');
const id = process.argv[2];
const split = JSON.parse(fs.readFileSync(path.join(root, 'split.json'), 'utf8')) as { sets: { dev: { set: string }[] } };
if (!split.sets.dev.some((s) => s.set === id)) { console.error(`${id} is not a development set`); process.exit(2); }
const dir = path.join(root, id);
let file = ['drawing.png', 'drawing.jpg', 'drawing.jpeg'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-probe-'));
  execFileSync('pdftocairo', ['-png', '-singlefile', '-r', '200', path.join(dir, 'drawing.pdf'), path.join(tmp, 'p')]);
  file = path.join(tmp, 'p.png');
}
let image;
try { image = decodeImage(new Uint8Array(fs.readFileSync(file))); } catch {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-img-')), 'in.png');
  execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' });
  image = decodeImage(new Uint8Array(fs.readFileSync(tmp)));
}
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')) as { rooms: { name: string; printed: string[] }[] };
console.log('TRUTH', truth.rooms.map((r) => `${r.name} ${r.printed.join('|')}`).join(' ; '));
const labels = await readLabels(preprocess(image).image, {});
for (const l of labels) console.log(JSON.stringify({ name: l.name, text: l.text, twoReads: l.twoReads, cands: l.cands.map((c) => `${c.w.toFixed(2)}x${c.l.toFixed(2)}/r${c.rank}`) }));
await closeOcrEngine();
