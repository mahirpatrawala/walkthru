// SPEC 19.12 (22 Nov 2026): the raw files behind the photographic outdoor look (leaf photos for the crowns, grass blades, deck timber, bark,
// the pool's glass mosaic, a coconut palm model). Downloads ONLY model, texture and image files into a cache outside the repo
// (~/walkthru-tools/outdoor-raw/real, override with OUTDOOR_RAW), checks each one, and writes public/look/outdoor/sources.lock.json with the
// source URL, author, licence, the page the licence was read on, the date it was read, the size and the SHA-256 of every raw file.
//   - Poly Haven (CC0): size and MD5 must equal what the Poly Haven API lists for the file, or the file is refused.
//   - ambientCG (CC0) and Objaverse (CC-BY 4.0): the SHA-256 must equal the one pinned below (read on 22 Nov 2026), or the file is refused.
// Nothing downloaded is executed. The ambientCG zip also holds a .blend, a .usdc and a .tres: only the two JPGs named below are extracted.
// tools/optimise-outdoor-real.mjs then turns these into the small files the app ships (public/look/outdoor/) and records their SHA-256.
// Run: node scripts/fetch-outdoor-real.mjs   (safe to re-run: files already in the cache are re-checked, not re-downloaded)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = process.env.OUTDOOR_RAW || path.join(os.homedir(), 'walkthru-tools/outdoor-raw/real');
const LOCK = path.join(ROOT, 'public/look/outdoor/sources.lock.json');
const UA = 'walkthru-asset-fetch/1.0 (+https://walkthru-ivory.vercel.app)';
const READ_ON = '2026-11-22';

const PH_LICENCE = { licence: 'CC0 1.0', licencePage: 'https://polyhaven.com/license' };
const ACG_LICENCE = { licence: 'CC0 1.0', licencePage: 'https://docs.ambientcg.com/license/' };

/** Poly Haven assets: slug, the map keys used (as the API names them), and the authors the API lists */
export const POLYHAVEN = [
  { slug: 'jacaranda_tree', maps: ['leaves_diff', 'leaves_alpha'], kind: 'models', authors: 'Rico Cilliers; Rob Tuytel (guidance)', use: 'compound-leaf photos for the neem and gulmohar crowns' },
  { slug: 'island_tree_02', maps: ['leaves_diff', 'leaves_alpha'], kind: 'models', authors: 'Rob Tuytel (scanning, processing); Rico Cilliers (cleanup, processing)', use: 'broad-leaf photos for frangipani, ficus, croton, petals and bracts' },
  { slug: 'shrub_01', maps: ['Diffuse', 'Alpha'], kind: 'models', authors: 'Rico Cilliers', use: 'serrated-leaf photos for hibiscus and bougainvillea' },
  { slug: 'grass_bermuda_01', maps: ['Diffuse', 'Alpha'], kind: 'models', authors: 'Rico Cilliers', use: 'grass-blade tufts on the lawns' },
  { slug: 'wooden_planks', maps: ['Diffuse', 'nor_gl'], kind: 'textures', authors: 'Charlotte Baglioni (photography); Dario Barresi (processing)', use: 'timber decking with open joints' },
  { slug: 'bark_platanus', maps: ['Diffuse'], kind: 'textures', authors: 'Dimitrios Savva', use: 'tree bark' },
];

/** pinned files from sources without a checksum API */
export const PINNED = [
  {
    id: 'Tiles132A', file: 'Tiles132A_1K-JPG.zip', url: 'https://ambientcg.com/get?file=Tiles132A_1K-JPG.zip', page: 'https://ambientcg.com/view?id=Tiles132A',
    author: 'Lennart Demes (ambientCG)', ...ACG_LICENCE, bytes: 5331847, sha256: '6e70e35a0df83de344c717eb6cdc7dcc3f38bbefab6e89449cefaff5f38228d1',
    extract: ['Tiles132A_1K-JPG_Color.jpg', 'Tiles132A_1K-JPG_NormalGL.jpg'], use: 'glass mosaic of the pool basins',
  },
  {
    id: 'coconut-palm', file: '26e787f2ff2e4c0fb004c3b0210805a3.glb', url: 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-004/26e787f2ff2e4c0fb004c3b0210805a3.glb',
    page: 'https://sketchfab.com/3d-models/26e787f2ff2e4c0fb004c3b0210805a3', title: 'Coconut Palm', author: 'evolveduk (https://sketchfab.com/evolveduk)',
    licence: 'CC-BY 4.0', licencePage: 'https://creativecommons.org/licenses/by/4.0/', licenceSource: 'Objaverse metadata/000-004.json.gz: "license": "by" (Sketchfab, published 2022-05-08)',
    bytes: 14630204, sha256: 'df749a540d2766dd10cc822b0017eeb03166a46e91c573c13c2d9f8f44a912d3', use: 'the coconut palms (two trunks a plant), and the frond picture of the procedural palms',
  },
];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const md5 = (b) => createHash('md5').update(b).digest('hex');
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const lock = { generatedBy: 'scripts/fetch-outdoor-real.mjs', readOn: READ_ON, raw: '~/walkthru-tools/outdoor-raw/real (not in the repo)', files: {} };
  for (const a of POLYHAVEN) {
    const api = JSON.parse((await get(`https://api.polyhaven.com/files/${a.slug}`)).toString());
    for (const k of a.maps) {
      const ent = api[k]?.['1k']?.jpg ?? api[k]?.['1k']?.png;
      if (!ent) throw new Error(`${a.slug}: no 1k file for ${k}`);
      const name = path.basename(new URL(ent.url).pathname);
      const dest = path.join(RAW, a.slug, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let buf = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      if (!buf || buf.length !== ent.size || md5(buf) !== ent.md5) { buf = await get(ent.url); }
      if (buf.length !== ent.size || md5(buf) !== ent.md5) throw new Error(`${name}: size or MD5 differs from the Poly Haven API, refused`);
      fs.writeFileSync(dest, buf);
      lock.files[`${a.slug}/${name}`] = { source: ent.url, page: `https://polyhaven.com/a/${a.slug}`, author: a.authors, ...PH_LICENCE, bytes: buf.length, md5: ent.md5, sha256: sha256(buf), use: a.use };
      console.log('ok', a.slug, name, buf.length);
    }
  }
  for (const p of PINNED) {
    const dest = path.join(RAW, p.id, p.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let buf = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (!buf || sha256(buf) !== p.sha256) buf = await get(p.url);
    if (buf.length !== p.bytes || sha256(buf) !== p.sha256) throw new Error(`${p.file}: SHA-256 differs from the one pinned on ${READ_ON}, refused`);
    fs.writeFileSync(dest, buf);
    const { extract, bytes: _b, sha256: _s, file: _f, id: _i, ...meta } = p;
    lock.files[`${p.id}/${p.file}`] = { source: p.url, ...meta, bytes: buf.length, sha256: sha256(buf) };
    if (extract) {
      // unzip only the named images (the archive also has a .blend, .usdc, .mtlx and .tres: never extracted, never run)
      execFileSync('unzip', ['-o', '-j', dest, ...extract, '-d', path.dirname(dest)], { stdio: 'ignore' });
      for (const e of extract) {
        const b = fs.readFileSync(path.join(path.dirname(dest), e));
        lock.files[`${p.id}/${e}`] = { source: `${p.url} (extracted)`, page: p.page, author: p.author, licence: p.licence, licencePage: p.licencePage, bytes: b.length, sha256: sha256(b), use: p.use };
      }
    }
    console.log('ok', p.id, p.file, buf.length);
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log('wrote', path.relative(ROOT, LOCK));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
