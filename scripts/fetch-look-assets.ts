// Owned by C11a. SPEC 16.3: downloads the CC0 Poly Haven assets the look needs into public/look/, checks every file's
// MD5 against the SPEC table (a mismatch aborts), and writes public/look/assets.lock.json (size, MD5, SHA-256).
// Run: npm run fetch:look. Safe to re-run: files that already match are kept. `--no-2k` skips the 2k HDRIs.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look');
const BASE = 'https://dl.polyhaven.org/file/ph-assets/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

interface Entry { path: string; url: string; size: number; md5: string; group: string }

// path = where it lands under public/look/; url = under BASE; size and md5 are the Poly Haven API's values (SPEC 16.3).
export const MANIFEST: Entry[] = [
  { path: 'hdri/rooftop_night_1k.hdr', url: 'HDRIs/hdr/1k/rooftop_night_1k.hdr', size: 1624479, md5: 'c812bf5033f4b57c0f769a71267471d4', group: 'hdri-1k' },
  { path: 'hdri/rooftop_night_2k.hdr', url: 'HDRIs/hdr/2k/rooftop_night_2k.hdr', size: 6509158, md5: '966095e85f971fbc00aeb67e7d60d1c9', group: 'hdri-2k' },
  { path: 'hdri/rooftop_day_1k.hdr', url: 'HDRIs/hdr/1k/rooftop_day_1k.hdr', size: 1545499, md5: '3d6f39e531c024b4951d8cb29ddbed27', group: 'hdri-1k' },
  { path: 'hdri/rooftop_day_2k.hdr', url: 'HDRIs/hdr/2k/rooftop_day_2k.hdr', size: 6155760, md5: '5ea41f53536f1a23741e8adb7d589720', group: 'hdri-2k' },
  { path: 'hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', url: 'HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr', size: 1435119, md5: 'c69498687e876bf68d2a8b8a62234eb9', group: 'hdri-1k' },
  { path: 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr', url: 'HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr', size: 5451493, md5: '2eba3a4d7eeb23cbfbeca364c97e7980', group: 'hdri-2k' },
  { path: 'tex/marble_01/marble_01_nor_gl_1k.jpg', url: 'Textures/jpg/1k/marble_01/marble_01_nor_gl_1k.jpg', size: 110230, md5: 'fa073d722cde733c1bd6cc6e8897c8e3', group: 'texture' },
  { path: 'tex/marble_01/marble_01_rough_1k.jpg', url: 'Textures/jpg/1k/marble_01/marble_01_rough_1k.jpg', size: 91848, md5: '59cef1be1b7376c9d0dcc7a64adf7882', group: 'texture' },
  { path: 'tex/marble_01/marble_01_diff_1k.jpg', url: 'Textures/jpg/1k/marble_01/marble_01_diff_1k.jpg', size: 305029, md5: '04325ced5018eb8a2e598a4ef69cb176', group: 'texture' },
  { path: 'tex/plastered_wall_04/plastered_wall_04_nor_gl_1k.jpg', url: 'Textures/jpg/1k/plastered_wall_04/plastered_wall_04_nor_gl_1k.jpg', size: 427268, md5: 'f18e649235bb688732fb0ef1d61a5286', group: 'texture' },
  { path: 'tex/plastered_wall_04/plastered_wall_04_arm_1k.jpg', url: 'Textures/jpg/1k/plastered_wall_04/plastered_wall_04_arm_1k.jpg', size: 212525, md5: '4d3c55b7cbb32cce818af5b2a1f18ffa', group: 'texture' },
  { path: 'tex/plastered_wall_04/plastered_wall_04_diff_1k.jpg', url: 'Textures/jpg/1k/plastered_wall_04/plastered_wall_04_diff_1k.jpg', size: 299230, md5: '3a45e9e3ff0c6aa179371dff02bded1f', group: 'texture' },
  { path: 'tex/walnut_veneer/walnut_veneer_diff_1k.jpg', url: 'Textures/jpg/1k/walnut_veneer/walnut_veneer_diff_1k.jpg', size: 496596, md5: '70e160b3d44d414728a2fb4194fde2a6', group: 'texture' },
  { path: 'tex/walnut_veneer/walnut_veneer_arm_1k.jpg', url: 'Textures/jpg/1k/walnut_veneer/walnut_veneer_arm_1k.jpg', size: 641173, md5: '7db3474a1d0d1ed15e0cc349541ac1e3', group: 'texture' },
  { path: 'tex/dark_wood/dark_wood_diff_1k.jpg', url: 'Textures/jpg/1k/dark_wood/dark_wood_diff_1k.jpg', size: 754754, md5: '47fa883f1bb33acc5711245f64b75975', group: 'texture' },
  { path: 'tex/dark_wood/dark_wood_nor_gl_1k.jpg', url: 'Textures/jpg/1k/dark_wood/dark_wood_nor_gl_1k.jpg', size: 344338, md5: 'ca74ffa4c1b7ff5afe7316bbfa87f9a0', group: 'texture' },
  { path: 'tex/dark_wood/dark_wood_rough_1k.jpg', url: 'Textures/jpg/1k/dark_wood/dark_wood_rough_1k.jpg', size: 574415, md5: 'b1acb7bf90785d3945a85eca408dbc6c', group: 'texture' },
  { path: 'tex/rough_linen/rough_linen_diff_1k.jpg', url: 'Textures/jpg/1k/rough_linen/rough_linen_diff_1k.jpg', size: 835801, md5: '663db789fb075462b685c1f740e58930', group: 'texture' },
  { path: 'tex/rough_linen/rough_linen_nor_gl_1k.jpg', url: 'Textures/jpg/1k/rough_linen/rough_linen_nor_gl_1k.jpg', size: 916843, md5: '3350269a2e9c472aa406bd3cc1eaf2c8', group: 'texture' },
  { path: 'tex/cotton_jersey/cotton_jersey_diff_1k.jpg', url: 'Textures/jpg/1k/cotton_jersey/cotton_jersey_diff_1k.jpg', size: 581360, md5: 'd2f4493fdd48634b50d40f810ce9deb7', group: 'texture' },
  { path: 'tex/cotton_jersey/cotton_jersey_nor_gl_1k.jpg', url: 'Textures/jpg/1k/cotton_jersey/cotton_jersey_nor_gl_1k.jpg', size: 678670, md5: '2dcc9dda3b726477f607c808e52f1833', group: 'texture' },
  { path: 'models/sofa_02/sofa_02_1k.gltf', url: 'Models/gltf/1k/sofa_02/sofa_02_1k.gltf', size: 4183, md5: 'ec2590dc8433a523d0fe9e507766c16f', group: 'model' },
  { path: 'models/sofa_02/textures/sofa_02_diff_1k.jpg', url: 'Models/jpg/1k/sofa_02/sofa_02_diff_1k.jpg', size: 86514, md5: '0452c7d8dd3ef414d5ed3055085028a1', group: 'model' },
  { path: 'models/sofa_02/textures/sofa_02_arm_1k.jpg', url: 'Models/jpg/1k/sofa_02/sofa_02_arm_1k.jpg', size: 121752, md5: '78799d978a1117ba83dbffed9af0fa33', group: 'model' },
  { path: 'models/sofa_02/textures/sofa_02_nor_gl_1k.jpg', url: 'Models/jpg/1k/sofa_02/sofa_02_nor_gl_1k.jpg', size: 139858, md5: '968528a369bced172d34275dba5aebf1', group: 'model' },
  { path: 'models/sofa_02/sofa_02.bin', url: 'Models/gltf/4k/sofa_02/sofa_02.bin', size: 74864, md5: '024d6f57a7c2ee7915430cd6e1c2651e', group: 'model' },
  { path: 'models/dining_chair_02/dining_chair_02_1k.gltf', url: 'Models/gltf/1k/dining_chair_02/dining_chair_02_1k.gltf', size: 2723, md5: '5aff75016e0943e84161de89dcc3ceb8', group: 'model' },
  { path: 'models/dining_chair_02/dining_chair_02.bin', url: 'Models/gltf/8k/dining_chair_02/dining_chair_02.bin', size: 544592, md5: 'b7f8a91c0a5249d02de7885f3b242c4e', group: 'model' },
  { path: 'models/dining_chair_02/textures/dining_chair_02_nor_gl_1k.jpg', url: 'Models/jpg/1k/dining_chair_02/dining_chair_02_nor_gl_1k.jpg', size: 119612, md5: '9c0e1003f9c8859a2e5c2c7f92a8f238', group: 'model' },
  { path: 'models/dining_chair_02/textures/dining_chair_02_diff_1k.jpg', url: 'Models/jpg/1k/dining_chair_02/dining_chair_02_diff_1k.jpg', size: 91518, md5: '6b7b8e4ac0a3aad9ecdf314a97b0ef75', group: 'model' },
  { path: 'models/dining_chair_02/textures/dining_chair_02_arm_1k.jpg', url: 'Models/jpg/1k/dining_chair_02/dining_chair_02_arm_1k.jpg', size: 162630, md5: '2b16c9ddb3ea83d200b02de54a4fdcb8', group: 'model' },
];

const LICENCE = `Everything under public/look/ comes from Poly Haven (https://polyhaven.com) and is CC0 1.0 (public domain).
https://polyhaven.com/license

Files named hdri/*_bg.jpg are derived from those HDRIs by scripts/derive-look-assets.ts (also CC0).
assets.lock.json lists every file with its size, MD5 (checked against the Poly Haven API) and SHA-256.
`;

const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const skip2k = process.argv.includes('--no-2k');
  const lockPath = path.join(OUT, 'assets.lock.json');
  let previous: { derived?: unknown } = {};
  try { previous = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* first run */ }
  const files: Record<string, { size: number; md5: string; sha256: string; source: string }> = {};
  for (const e of MANIFEST) {
    if (skip2k && e.group === 'hdri-2k') continue;
    const dest = path.join(OUT, e.path);
    let buf: Buffer | null = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (buf && md5(buf) !== e.md5) buf = null;
    if (!buf) {
      console.log(`downloading ${e.path} (${e.size} bytes)`);
      buf = await download(BASE + e.url);
      if (buf.length !== e.size) throw new Error(`${e.path}: expected ${e.size} bytes, got ${buf.length}`);
      if (md5(buf) !== e.md5) throw new Error(`${e.path}: MD5 ${md5(buf)} does not match the SPEC table (${e.md5}). Refusing to store it.`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + '.part', buf);
      fs.renameSync(dest + '.part', dest);
    }
    files[e.path] = { size: buf.length, md5: md5(buf), sha256: sha256(buf), source: BASE + e.url };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'), LICENCE);
  const lock = { generatedBy: 'scripts/fetch-look-assets.ts', licence: 'CC0 1.0 (Poly Haven)', files, derived: previous.derived ?? {} };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  const total = Object.values(files).reduce((s, f) => s + f.size, 0);
  console.log(`done: ${Object.keys(files).length} files, ${(total / 1e6).toFixed(1)} MB, lock at public/look/assets.lock.json`);
}

main().catch((err) => { console.error(String(err)); process.exit(1); });
