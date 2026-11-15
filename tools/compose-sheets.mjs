// Tiles the posed cells written by `make_family.py --sheets` into contact sheets.
//   node tools/compose-sheets.mjs <cellsDir> <outDir> [tag]
// One PNG per person and sheet: rows are views, columns are frames. Dev-only: needs `sharp` (install it in a scratch directory).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [dir, out, tag = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const groups = new Map();
for (const f of fs.readdirSync(dir)) {
  const m = /^(.+?)__(.+?)__(.+?)__(\d+)\.png$/.exec(f);
  if (!m) continue;
  const [, who, sheet, view, i] = m;
  const k = `${who}__${sheet}`;
  if (!groups.has(k)) groups.set(k, new Map());
  const rows = groups.get(k);
  if (!rows.has(view)) rows.set(view, []);
  rows.get(view)[+i] = path.join(dir, f);
}
for (const [k, rows] of groups) {
  const views = [...rows.keys()];
  const cols = Math.max(...views.map((v) => rows.get(v).length));
  const meta = await sharp(rows.get(views[0]).find(Boolean)).metadata();
  const w = meta.width, h = meta.height;
  const per = cols > 6 ? 6 : cols;                 // wrap long sheets (12 frames) into rows of 6
  const lines = Math.ceil(cols / per);
  const comp = [];
  views.forEach((v, r) => {
    rows.get(v).forEach((file, i) => {
      if (!file) return;
      comp.push({ input: file, left: (i % per) * w, top: (r * lines + Math.floor(i / per)) * h });
    });
  });
  const W = per * w, Hh = views.length * lines * h;
  await sharp({ create: { width: W, height: Hh, channels: 3, background: '#444' } }).composite(comp).png().toFile(path.join(out, `${tag}${k}.png`));
  console.log(`${tag}${k}.png`, W, 'x', Hh);
}
