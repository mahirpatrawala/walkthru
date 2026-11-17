// Fetches the CC0 Poly Haven texture sets of the 2K top-quality level that are not part of "Realistic materials" (SPEC 16.24): the pool deck, paving and
// coping stone, at 2K (deck, paving) and 1K (coping). Writes public/look/tex/premium/<slug>/<slug>_<map>_<res>.jpg, the SOURCES.txt (URL, licence, size, MD5 of
// every file) and premium.lock.json (with SHA-256). The API gives each file's size and MD5; a file that differs is refused.
//   node scripts/fetch-premium.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/tex/premium');
/** slug, resolution of the diffuse and normal, resolution of the roughness map */
const SETS = [
  ['wood_floor_deck', '2k', '1k', 'pool deck timber'],
  ['red_sandstone_pavement', '2k', '1k', 'paving round the pool and the podium'],
  ['stone_tiles', '1k', '1k', 'pool coping stone'],
];
const MAPS = [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['Rough', 'rough']];
const lock = { generated: new Date().toISOString().slice(0, 10), licence: 'CC0 1.0 (Poly Haven), https://polyhaven.com/license', files: [] };
const lines = [];
for (const [slug, res, rres, use] of SETS) {
  const api = await (await fetch(`https://api.polyhaven.com/files/${slug}`)).json();
  for (const [key, tag] of MAPS) {
    const r = tag === 'rough' ? rres : res;
    const f = api[key]?.[r]?.jpg;
    if (!f) throw new Error(`${slug} ${r} ${key}: not offered`);
    const dest = path.join(OUT, slug, `${slug}_${tag}_${r}.jpg`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let buf;
    if (fs.existsSync(dest) && crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex') === f.md5) buf = fs.readFileSync(dest);
    else {
      buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      if (md5 !== f.md5 || buf.length !== f.size) throw new Error(`${slug} ${r} ${key}: md5 or size differs from the API (${md5} vs ${f.md5})`);
      fs.writeFileSync(dest, buf);
    }
    const rel = path.relative(OUT, dest);
    lock.files.push({ path: rel, url: f.url, size: buf.length, md5: f.md5, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    lines.push(`${rel}\n  source: ${f.url}\n  licence: CC0 1.0 (public domain), https://polyhaven.com/license, no credit required\n  use: ${use}\n  size: ${buf.length} bytes, md5 ${f.md5}`);
  }
}
fs.writeFileSync(path.join(OUT, 'premium.lock.json'), JSON.stringify(lock, null, 1));
fs.writeFileSync(path.join(OUT, 'SOURCES.txt'), `Textures of the 2K top-quality level (SPEC 16.24). All from Poly Haven (https://polyhaven.com), CC0 1.0, fetched ${lock.generated} by scripts/fetch-premium.mjs.\n\n${lines.join('\n\n')}\n`);
console.log('done', lock.files.reduce((a, x) => a + x.size, 0), 'bytes');
