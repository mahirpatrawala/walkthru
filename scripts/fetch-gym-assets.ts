// Fetches the photographed textures and the free 3D models of the gym (SPEC 16.17.1), checks every file, and records source, author, licence,
// the date the licence was read and SHA-256 in public/look/gym/gym.lock.json and public/look/gym/LICENCE.txt. Raw downloads go to a cache outside
// the repo; tools/optimise-gym-assets.mjs turns them into what ships under public/look/gym/ (small GLBs, resized JPEG maps).
//
//   npx tsx scripts/fetch-gym-assets.ts [--cache <dir>] [--update]
//
// Licence order (SPEC 16.17.1): CC0 first (Poly Haven, ambientCG), then CC BY 4.0 with the author credited (Sketchfab models as archived in
// Objaverse 1.0 on Hugging Face, which needs no login). Nothing with no licence, a non-commercial or no-derivatives licence, a brand logo or a
// game rip is listed here. Only image and model files are downloaded; an archive is unpacked for two named image files and nothing else.
// Safe to re-run: a cached file that matches the lock is kept; a hash that differs from the lock aborts (`--update` accepts the new one).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/gym');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const READ = '2026-11-22';

interface Asset {
  id: string;
  name: string;
  kind: 'texture' | 'model';
  authors: string[];
  page: string;
  licence: 'CC0 1.0' | 'CC BY 4.0';
  licenceUrl: string;
  /** the wording relied on, as read on the licence page or the source's API on READ */
  licenceWords: string;
  use: string;
  /** `polyhaven:<slug>` stands for the model's 1k glTF and the files it includes */
  files: { path: string; url: string; size?: number; md5?: string; sha256?: string; unzip?: string[] }[];
}

/** what is fetched; `size`/`md5`/`sha256` are the values the source itself publishes (checked before a file is kept) */
export const ASSETS: Asset[] = [
  {
    id: 'leather_white', name: 'Leather White', kind: 'texture', authors: ['Rob Tuytel'], page: 'https://polyhaven.com/a/leather_white',
    licence: 'CC0 1.0', licenceUrl: 'https://polyhaven.com/license', licenceWords: 'Our assets are all licensed as CC0',
    use: 'normal map of the vinyl upholstery of every gym pad (the grain of real leather, tinted black)',
    files: [{ path: 'leather_white_nor_gl_1k.jpg', url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leather_white/leather_white_nor_gl_1k.jpg', size: 670610 }],
  },
  {
    id: 'Rubber001', name: 'Rubber 001', kind: 'texture', authors: ['Lennart Demes (ambientCG)'], page: 'https://ambientcg.com/view?id=Rubber001',
    licence: 'CC0 1.0', licenceUrl: 'https://docs.ambientcg.com/license/', licenceWords: 'All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License',
    use: 'the black EPDM-fleck rubber gym floor (colour and normal), and the normal of rubber parts (belts, feet, grips, mats)',
    files: [{ path: 'Rubber001_1K-JPG.zip', url: 'https://ambientcg.com/get?file=Rubber001_1K-JPG.zip', unzip: ['Rubber001_1K-JPG_Color.jpg', 'Rubber001_1K-JPG_NormalGL.jpg'] }],
  },
  {
    id: 'sketchfab-fa481412927e43dfbeab9f6da464c15b', name: 'Weight Room Set 2', kind: 'model', authors: ['Tytan (tylerhalterman)'], page: 'https://sketchfab.com/3d-models/weight-room-set-2-fa481412927e43dfbeab9f6da464c15b',
    licence: 'CC BY 4.0', licenceUrl: 'http://creativecommons.org/licenses/by/4.0/', licenceWords: 'Sketchfab API v3/models/fa481412927e43dfbeab9f6da464c15b: license "CC Attribution", "Author must be credited. Commercial use is allowed."',
    use: 'one hex dumbbell (rubber head, chrome handle), instanced at every weight of a dumbbell rack',
    files: [{ path: 'fa481412927e43dfbeab9f6da464c15b.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-076/fa481412927e43dfbeab9f6da464c15b.glb', size: 4440108, sha256: '1c9770a4cfed964a41aa708e757103fa911203d21c29d5372d52241fa0d4cec7' }],
  },
  {
    id: 'sketchfab-2e09cbcbde964a658d51838e2f9866bb', name: 'kettlebell', kind: 'model', authors: ['anesbe89'], page: 'https://sketchfab.com/3d-models/kettlebell-2e09cbcbde964a658d51838e2f9866bb',
    licence: 'CC BY 4.0', licenceUrl: 'http://creativecommons.org/licenses/by/4.0/', licenceWords: 'Sketchfab API v3/models/2e09cbcbde964a658d51838e2f9866bb: license "CC Attribution", "Author must be credited. Commercial use is allowed."',
    use: 'a competition kettlebell, scaled to each weight of a kettlebell rack',
    files: [{ path: '2e09cbcbde964a658d51838e2f9866bb.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-077/2e09cbcbde964a658d51838e2f9866bb.glb' }],
  },
  {
    id: 'chess_set', name: 'Chess Set', kind: 'model', authors: ['Riley Queen'], page: 'https://polyhaven.com/a/chess_set',
    licence: 'CC0 1.0', licenceUrl: 'https://polyhaven.com/license', licenceWords: 'Our assets are all licensed as CC0',
    use: 'the board and the 32 men on the chess table of the games room (SPEC 16.17.2)',
    files: [{ path: 'chess_set', url: 'polyhaven:chess_set' }],
  },
];

interface LockFile { path: string; url: string; size: number; md5: string; sha256: string }
interface LockEntry extends Omit<Asset, 'files'> { licenceRead: string; fetched: string; files: LockFile[] }
/** `outputs` (what ships, with its SHA-256) is written by tools/optimise-gym-assets.mjs and kept here on a re-run */
interface Lock { generatedBy: string; read: string; assets: Record<string, LockEntry>; rejected: { what: string; url: string; why: string }[]; outputs?: Record<string, { bytes: number; sha256: string }> }

const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** what the source publishes for a file we did not pin by hand: the Hugging Face LFS SHA-256, the Poly Haven API's MD5 */
async function published(url: string): Promise<{ sha256?: string; md5?: string; size?: number }> {
  const hf = url.match(/huggingface\.co\/datasets\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/);
  if (hf) {
    const res = await fetch(`https://huggingface.co/api/datasets/${hf[1]}/paths-info/main`, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ paths: [hf[2]] }) });
    const j = (await res.json()) as { lfs?: { oid: string; size: number } }[];
    return j[0]?.lfs ? { sha256: j[0].lfs.oid, size: j[0].lfs.size } : {};
  }
  const ph = url.match(/ph-assets\/Textures\/jpg\/1k\/([^/]+)\/(.+)$/);
  if (ph) {
    const j = (await (await fetch(`https://api.polyhaven.com/files/${ph[1]}`, { headers: { 'User-Agent': UA } })).json()) as Record<string, Record<string, Record<string, { url: string; md5: string; size: number }>>>;
    for (const m of Object.values(j)) for (const r of Object.values(m)) for (const f of Object.values(r)) if (f && f.url === url) return { md5: f.md5, size: f.size };
  }
  return {};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const ci = args.indexOf('--cache');
  const cache = ci >= 0 ? path.resolve(args[ci + 1]) : path.join(os.homedir(), 'walkthru-tools', 'gym-assets-raw');
  const lockPath = path.join(OUT, 'gym.lock.json');
  let prev: Lock | null = null;
  try { prev = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lock; } catch { /* first run */ }
  const lock: Lock = { generatedBy: 'scripts/fetch-gym-assets.ts', read: READ, assets: {}, rejected: REJECTED, ...(prev?.outputs ? { outputs: prev.outputs } : {}) };

  for (const a of ASSETS) {
    const files: LockFile[] = [];
    // a Poly Haven model is its 1k glTF and every file it includes, each with the size and MD5 the API lists
    const list = (await Promise.all(a.files.map(async (f) => {
      const ph = f.url.match(/^polyhaven:(.+)$/);
      if (!ph) return [f];
      const j = (await (await fetch(`https://api.polyhaven.com/files/${ph[1]}`, { headers: { 'User-Agent': UA } })).json()) as { gltf: { '1k': { gltf: { url: string; size: number; md5: string; include: Record<string, { url: string; size: number; md5: string }> } } } };
      const g = j.gltf['1k'].gltf;
      return [{ path: `${ph[1]}_1k.gltf`, url: g.url, size: g.size, md5: g.md5 }, ...Object.entries(g.include).map(([rel, x]) => ({ path: rel, url: x.url, size: x.size, md5: x.md5 }))];
    }))).flat();
    for (const f of list) {
      const dest = path.join(cache, a.id, f.path);
      const locked = prev?.assets[a.id]?.files.find((x) => x.path === f.path);
      const pub = { ...(await published(f.url)), ...(f.sha256 ? { sha256: f.sha256 } : {}), ...(f.size ? { size: f.size } : {}), ...(f.md5 ? { md5: f.md5 } : {}) };
      let buf: Buffer | null = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      const good = (b: Buffer): boolean => (!pub.sha256 || sha256(b) === pub.sha256) && (!pub.md5 || md5(b) === pub.md5) && (!pub.size || b.length === pub.size) && (!locked || update || sha256(b) === locked.sha256);
      if (buf && !good(buf)) buf = null;
      if (!buf) {
        process.stdout.write(`downloading ${a.id}/${f.path}\n`);
        buf = await download(f.url);
        if (!good(buf)) throw new Error(`${a.id}/${f.path}: the download does not match what the source publishes or the lock (sha256 ${sha256(buf)}). Refusing to store it.`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest + '.part', buf);
        fs.renameSync(dest + '.part', dest);
      }
      if (f.unzip) {
        // only the named image files come out of the archive; nothing in it is run
        for (const name of f.unzip) if (!/\.(jpg|png)$/i.test(name)) throw new Error(`refusing to unpack ${name}`);
        execFileSync('unzip', ['-o', '-q', dest, ...f.unzip, '-d', path.dirname(dest)]);
      }
      files.push({ path: f.path, url: f.url, size: buf.length, md5: md5(buf), sha256: sha256(buf) });
    }
    const { files: _f, ...meta } = a;
    void _f;
    lock.assets[a.id] = { ...meta, licenceRead: READ, fetched: prev?.assets[a.id]?.fetched ?? READ, files };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  writeLicence(lock);
  console.log(`done: ${Object.keys(lock.assets).length} assets, raw cache ${cache}`);
}

/** looked at on READ and not used, with the reason (kept in the lock and the licence file so nobody fetches them again by mistake) */
const REJECTED: Lock['rejected'] = [
  { what: 'Treadmill Machine (Sousinho), CC BY', url: 'https://sketchfab.com/3d-models/treadmill-machine-faed3a2a275b4fd68089e1d8bdfb7f89', why: 'a maker\'s logo is printed on the deck and the textures are worn and blurred' },
  { what: 'Gym Machine_ Body Solid (Hu), CC BY', url: 'https://sketchfab.com/3d-models/gym-machine--body-solid-4d1d0fb6879f42a9bccf1666a752c276', why: 'a maker\'s name and logo on the upright and the placard' },
  { what: 'Modular Gym (Kristen Brown), CC BY', url: 'https://sketchfab.com/3d-models/modular-gym-86e8cc43d76c44e3925e625fdab155f3', why: 'a whole room in feet: its treadmill is 1.3 m wide (the catalogue box is 0.9 m, a 30 % squeeze) with a worn low-resolution texture; its bike is a recumbent with a red marble texture' },
  { what: 'Gym Lat Pulldown (neilken), CC BY', url: 'https://sketchfab.com/3d-models/gym-lat-pulldown-50fb1df222e6468f9d7ada63c45d673d', why: 'one untextured white mesh with no part split (frame, pads and stack cannot be told apart to colour them), in centimetres at a different footprint' },
  { what: 'Incline Bench and Flat Bench (Sousinho), CC BY', url: 'https://sketchfab.com/3d-models/incline-bench-bdc274649c234c188d2d4f4c732acb1c', why: 'worn, scratched leather and rusty frame textures: reads as a garage, not a clubhouse' },
  { what: 'Treadmill ProForm, Tunturi T85, Matrix treadmill, Assault Bike (various), CC BY', url: 'https://sketchfab.com/search?q=treadmill&type=models', why: 'named after and printed with a maker\'s brand' },
  { what: 'Every other gym search result on Sketchfab (treadmill, spin bike, lat pulldown, chest press, leg press, dumbbell rack, bench, yoga mat)', url: 'https://api.sketchfab.com/v3/search?type=models&q=gym', why: 'not in the Objaverse archive (a Sketchfab download needs an account token, which this project does not use), stylised low-poly, a whole scene, or not gym equipment' },
  { what: 'Carrom (mfb64), CC BY', url: 'https://sketchfab.com/3d-models/carrom-57203e19a1514e57929000c9bb4a10df', why: 'its maps are bound through a material extension three.js no longer reads (the board renders white), and each of its 19 coins is 6 600 triangles; the generated board stays' },
  { what: 'Table Tennis (denis98), Pool Table (Juanpa Velazquez), Foosball Table (owestgate), CC BY', url: 'https://sketchfab.com/3d-models/table-tennis-5849544053924fecb1dee018fa815bf6', why: 'proportions far from a real table (the tennis table stands at a third of its length, not 0.28), a pool table inside a room scene at a height that does not match its footprint, a foosball cabinet 16 % lower than the 90 cm box (over the 12 % fit rule of 16.15)' },
  { what: 'Lockers (several authors), CC BY', url: 'https://api.sketchfab.com/v3/search?type=models&q=locker', why: 'rusted, dented school lockers: not a clubhouse changing room' },
  { what: 'Poly Haven models', url: 'https://api.polyhaven.com/assets?t=models', why: 'no gym equipment in the library (re-checked: sports props are balls and a bat)' },
];

function writeLicence(lock: Lock): void {
  const cc0 = Object.values(lock.assets).filter((a) => a.licence === 'CC0 1.0');
  const by = Object.values(lock.assets).filter((a) => a.licence === 'CC BY 4.0');
  const line = (a: LockEntry): string => `  ${a.name} by ${a.authors.join(', ')}\n    ${a.page}\n    licence: ${a.licence} ${a.licenceUrl} (read ${a.licenceRead}: "${a.licenceWords}")\n    used for: ${a.use}\n`;
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'),
    `Gym assets under public/look/gym/ (SPEC 16.17.1). Fetched and checked by scripts/fetch-gym-assets.ts; gym.lock.json has every source URL, size, MD5 and SHA-256.\n` +
    `The files here are our own conversions (tools/optimise-gym-assets.mjs): a model is cut down to the one object used, decimated, re-centred, split into parts that take the app's own materials, and meshopt-compressed; a map is resized and re-encoded.\n\n` +
    `CREDITS (CC BY 4.0: the author must be credited; the item card of a rack that shows a model also says the credit, see PROP_CREDITS in src/look/gym/props.ts):\n${by.map(line).join('')}\n` +
    `CC0 1.0 (public domain, no credit required, credited anyway):\n${cc0.map(line).join('')}\n` +
    `Looked at on ${lock.read} and NOT used:\n${lock.rejected.map((r) => `  ${r.what}\n    ${r.url}\n    why: ${r.why}\n`).join('')}`);
}

main().catch((err) => { console.error(String(err)); process.exit(1); });
