// Owned by stage 3 (outdoor spaces). Downloads the CC0 Poly Haven ground textures the pool deck, the garden and the play area use,
// checks every original's size and MD5 against the Poly Haven API, scales it to 512 x 512 (ffmpeg, JPEG) and writes the result into
// public/look/tex/outdoor/. The originals are not kept: 512 px is plenty at 1 to 2 m a repeat and keeps a phone's download small.
// It also writes public/look/tex/outdoor/outdoor.lock.json (source URL, original MD5, derived SHA-256, and the mean linear luminance of
// each diffuse map, which src/outdoor/textures.ts uses as the "detail around a tint" mean) and prints the means.
// Run: npx tsx scripts/fetch-outdoor-assets.ts   (needs ffmpeg on PATH; safe to re-run: derived files that exist are kept)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look/tex/outdoor');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SIZE = 512;

/** slug -> which maps are used. 'diff' is the colour, 'nor_gl' the OpenGL normal map. */
export const OUTDOOR_TEXTURES: Record<string, ('diff' | 'nor_gl')[]> = {
  leafy_grass: ['diff', 'nor_gl'],
  wood_floor_deck: ['diff', 'nor_gl'],
  red_sandstone_pavement: ['diff', 'nor_gl'],
  interlocking_concrete_pavers: ['diff', 'nor_gl'],
  gravel_floor_02: ['diff', 'nor_gl'],
  farm_soil: ['diff', 'nor_gl'],
  rubber_tiles: ['diff'],
};

const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const srgbToLinear = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function download(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`download failed: ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/** mean linear luminance of an sRGB JPG, by scaling it to one pixel (the mean of the sRGB values: close enough for a detail mean) */
function meanLinear(file: string): number {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', 'scale=64:64:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
  let s = 0;
  const n = raw.length / 3;
  for (let i = 0; i < raw.length; i += 3) s += 0.2126 * srgbToLinear(raw[i]) + 0.7152 * srgbToLinear(raw[i + 1]) + 0.0722 * srgbToLinear(raw[i + 2]);
  return s / n;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-outdoor-'));
  const lock: { generatedBy: string; licence: string; files: Record<string, { source: string; originalMd5: string; originalBytes: number; sha256: string; bytes: number }>; means: Record<string, number> } = {
    generatedBy: 'scripts/fetch-outdoor-assets.ts', licence: 'CC0 1.0 (Poly Haven, https://polyhaven.com/license)', files: {}, means: {},
  };
  for (const [slug, maps] of Object.entries(OUTDOOR_TEXTURES)) {
    const info = await getJson(`https://api.polyhaven.com/files/${slug}`);
    for (const map of maps) {
      const entry = info[map === 'diff' ? 'Diffuse' : 'nor_gl']?.['1k']?.jpg;
      if (!entry) throw new Error(`${slug}: no 1k ${map} jpg in the Poly Haven listing`);
      const rel = `${slug}/${slug}_${map}.jpg`;
      const dest = path.join(OUT, rel);
      const original = path.join(tmp, `${slug}_${map}.jpg`);
      const buf = await download(entry.url);
      if (buf.length !== entry.size) throw new Error(`${slug} ${map}: expected ${entry.size} bytes, got ${buf.length}`);
      if (md5(buf) !== entry.md5) throw new Error(`${slug} ${map}: MD5 ${md5(buf)} does not match the Poly Haven API (${entry.md5}). Refusing to store it.`);
      fs.writeFileSync(original, buf);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', original, '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos`, '-q:v', '4', dest]);
      const out = fs.readFileSync(dest);
      lock.files[rel] = { source: entry.url, originalMd5: entry.md5, originalBytes: entry.size, sha256: sha256(out), bytes: out.length };
      if (map === 'diff') lock.means[slug] = +meanLinear(dest).toFixed(4);
      console.log(`${rel}: ${out.length} bytes (original ${entry.size})`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'outdoor.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'LICENCE.txt'), 'Everything in this folder is derived from CC0 1.0 textures by Poly Haven (https://polyhaven.com), scaled to 512 x 512.\nSee outdoor.lock.json for the source URL and the original MD5 of each file.\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('mean linear luminance:', JSON.stringify(lock.means));
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
