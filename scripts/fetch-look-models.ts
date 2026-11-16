// Fetches the CC0 furniture and prop models of the model library (SPEC 16.15) from Poly Haven, checks every file against the
// size and MD5 that the Poly Haven API lists for it, and records source URL, author, licence page, date and SHA-256 in
// public/look/models/models.lock.json. The raw downloads (1k glTF + the full-poly .bin + 1k jpg maps, 1 to 8 MB a model) go to a cache
// directory outside the repo; tools/optimise-look-models.mjs turns them into the small GLBs that ship under public/look/models/.
//
//   npx tsx scripts/fetch-look-models.ts [--cache <dir>] [--update]
//
// Safe to re-run: a file already in the cache that matches the lock is kept. A hash that differs from the lock aborts (`--update`
// accepts the new one and rewrites the lock). Licence: every Poly Haven asset is CC0 1.0, verified on https://polyhaven.com/license
// (the page says "Our assets are all licensed as CC0", no credit needed, any purpose); the date it was read is in the lock.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/models');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const API = 'https://api.polyhaven.com';
export const LICENCE_URL = 'https://polyhaven.com/license';
export const LICENCE_VERIFIED = '2026-11-15';

/** The Poly Haven slugs of the library. What each is used for lives in src/look/models/library.ts. */
export const MODEL_IDS = [
  // furniture (fit rule, SPEC 16.15)
  'dining_chair_02', 'side_table_01', 'modern_wooden_cabinet',
  // decor
  'potted_plant_01', 'potted_plant_02', 'jug_01', 'ceramic_vase_01', 'ceramic_vase_02', 'ceramic_vase_04',
  'wooden_bowl_01', 'food_apple_01', 'lemon', 'food_pomegranate_01',
  'wall_clock',
] as const;

interface ApiFile { url: string; size: number; md5: string }
interface Source { path: string; url: string; size: number; md5: string; sha256: string }
interface LockEntry { id: string; name: string; authors: string[]; page: string; licence: string; licenceUrl: string; licenceVerified: string; fetched: string; sources: Source[]; outputs?: Record<string, { bytes: number; sha256: string }> }
interface Lock { generatedBy: string; licence: string; licenceUrl: string; models: Record<string, LockEntry> }

const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const ci = args.indexOf('--cache');
  const cache = ci >= 0 ? path.resolve(args[ci + 1]) : path.join(os.homedir(), 'walkthru-tools', 'look-models-raw');
  const lockPath = path.join(OUT, 'models.lock.json');
  let prev: Lock | null = null;
  try { prev = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lock; } catch { /* first run */ }
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/look-model-routes.json'), 'utf8')) as { read: string; summary: string; sources: { name: string; url: string; licence: string; result: string }[] };
  const lock: Lock & { routes: unknown } = { generatedBy: 'scripts/fetch-look-models.ts', licence: 'CC0 1.0 (Poly Haven)', licenceUrl: LICENCE_URL, models: {}, routes };

  for (const id of MODEL_IDS) {
    const files = await getJson<{ gltf: { '1k': { gltf: ApiFile & { include: Record<string, ApiFile> } } } }>(`${API}/files/${id}`);
    const info = await getJson<{ name: string; authors: Record<string, string> }>(`${API}/info/${id}`);
    const g = files.gltf['1k'].gltf;
    const want: { rel: string; f: ApiFile }[] = [{ rel: `${id}_1k.gltf`, f: g }, ...Object.entries(g.include).map(([rel, f]) => ({ rel, f }))];
    const sources: Source[] = [];
    for (const { rel, f } of want) {
      const dest = path.join(cache, id, rel);
      const locked = prev?.models[id]?.sources.find((s) => s.path === rel);
      if (locked && !update && locked.md5 !== f.md5) throw new Error(`${id}/${rel}: Poly Haven now lists MD5 ${f.md5}, the lock has ${locked.md5}. Re-run with --update to accept it.`);
      let buf: Buffer | null = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      if (buf && md5(buf) !== f.md5) buf = null;
      if (!buf) {
        process.stdout.write(`downloading ${id}/${rel} (${(f.size / 1e6).toFixed(2)} MB)\n`);
        buf = await download(f.url);
        if (buf.length !== f.size) throw new Error(`${id}/${rel}: expected ${f.size} bytes, got ${buf.length}`);
        if (md5(buf) !== f.md5) throw new Error(`${id}/${rel}: MD5 ${md5(buf)} does not match the Poly Haven API (${f.md5}). Refusing to store it.`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest + '.part', buf);
        fs.renameSync(dest + '.part', dest);
      }
      sources.push({ path: rel, url: f.url, size: buf.length, md5: md5(buf), sha256: sha256(buf) });
    }
    lock.models[id] = {
      id, name: info.name, authors: Object.keys(info.authors), page: `https://polyhaven.com/a/${id}`, licence: 'CC0 1.0',
      licenceUrl: LICENCE_URL, licenceVerified: LICENCE_VERIFIED, fetched: prev?.models[id]?.fetched ?? new Date().toISOString().slice(0, 10), sources,
      ...(prev?.models[id]?.outputs ? { outputs: prev.models[id].outputs } : {}),
    };
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  const lines = Object.values(lock.models).map((m) => `  ${m.name} (${m.id}) by ${m.authors.join(', ')}  ${m.page}`);
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'),
    `Every model under public/look/models/ is derived from a Poly Haven asset (https://polyhaven.com) and is CC0 1.0 (public domain), no credit required.\n${LICENCE_URL}\n` +
    `Licence read on the official page on ${LICENCE_VERIFIED}: "Our assets are all licensed as CC0".\n\n` +
    `Source models and their authors:\n${lines.join('\n')}\n\n` +
    `The GLB files here are our own optimised conversions (decimated, textures resized to WebP, meshopt-compressed) by tools/optimise-look-models.mjs.\n` +
    `models.lock.json records every source file's URL, size, MD5 (checked against the Poly Haven API) and SHA-256, and the SHA-256 of every output.\n` +
    `\n${routes.summary}\nRead on ${routes.read}:\n${routes.sources.map((x) => `  ${x.name}\n    ${x.url}\n    licence: ${x.licence}\n    result: ${x.result}\n`).join('')}`);
  console.log(`done: ${Object.keys(lock.models).length} models, raw cache ${cache}`);
}

main().catch((err) => { console.error(String(err)); process.exit(1); });
