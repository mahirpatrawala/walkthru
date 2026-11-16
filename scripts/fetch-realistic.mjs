// Fetches the CC0 Poly Haven texture sets of the optional "Realistic materials" layer (SPEC 16.21) into public/look/tex/realistic/<res>/<slug>/.
// For each slug and each of 1k and 2k: diffuse, GL normal and roughness JPGs. The API gives the size and MD5 of every file; a file whose MD5 differs is
// refused. Writes public/look/tex/realistic/realistic.lock.json (url, size, md5, sha256, date) and LICENCE.txt.
//   node scripts/fetch-realistic.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/tex/realistic');
export const SLUGS = ['oak_wood_planks', 'grey_plaster', 'painted_plaster_wall', 'oak_veneer_01', 'rough_linen'];
const RES = ['1k', '2k'];
const MAPS = [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['Rough', 'rough']];

const lock = { generated: new Date().toISOString().slice(0, 10), licence: 'CC0 1.0 (Poly Haven), https://polyhaven.com/license, read 16 Nov 2026', files: [] };
for (const slug of SLUGS) {
  const api = await (await fetch(`https://api.polyhaven.com/files/${slug}`)).json();
  for (const res of RES) for (const [key, tag] of MAPS) {
    if (tag === 'rough' && res !== '1k') continue; // the roughness map is always the 1K one (SPEC 16.21)
    const f = api[key]?.[res]?.jpg;
    if (!f) throw new Error(`${slug} ${res} ${key}: not offered`);
    const dest = path.join(OUT, res, slug, `${slug}_${tag}_${res}.jpg`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let buf;
    if (fs.existsSync(dest) && crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex') === f.md5) buf = fs.readFileSync(dest);
    else {
      buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      if (md5 !== f.md5 || buf.length !== f.size) throw new Error(`${slug} ${res} ${key}: md5 or size differs from the API (${md5} vs ${f.md5})`);
      fs.writeFileSync(dest, buf);
    }
    lock.files.push({ path: path.relative(OUT, dest), url: f.url, size: buf.length, md5: f.md5, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  }
}
fs.writeFileSync(path.join(OUT, 'realistic.lock.json'), JSON.stringify(lock, null, 1));
fs.writeFileSync(path.join(OUT, 'LICENCE.txt'), `Textures in this folder are from Poly Haven (https://polyhaven.com), licensed CC0 1.0 (public domain): https://polyhaven.com/license, read 16 Nov 2026. No credit is required.\nSets: ${SLUGS.join(', ')}. Source URL, size, MD5 and SHA-256 of every file are in realistic.lock.json; the MD5 is the one the Poly Haven API gives, checked on download.\n`);
const total = Object.fromEntries(RES.map((r) => [r, lock.files.filter((x) => x.path.startsWith(r + '/')).reduce((a, x) => a + x.size, 0)]));
console.log('done', total);
