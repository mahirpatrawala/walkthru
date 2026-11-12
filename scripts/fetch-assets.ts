// Downloads the Quaternius "Universal Animation Library (Standard)" mannequin (CC0) and checks hashes.
// `--sample` also downloads the local-test-only room.splat (SPEC 6.6, no stated licence, never commit it).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const CHAR_DIR = path.join(ROOT, 'public/characters');

const ZIP_URL = 'https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip';
const ZIP_BYTES = 14_541_205;
const ZIP_SHA = '18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2';
const GLB_IN_ZIP = 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb';
const GLB_BYTES = 6_671_104;
const GLB_SHA = '1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c';

const SAMPLE_URL = 'https://huggingface.co/cakewalk/splat-data/resolve/main/room.splat';
const SAMPLE_BYTES = 50_988_032;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileOk(file: string, sha: string): boolean {
  return fs.existsSync(file) && sha256(file) === sha;
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + '.part', buf);
  fs.renameSync(dest + '.part', dest);
  console.log(`  saved ${buf.length} bytes to ${path.relative(ROOT, dest)}`);
}

function findFile(dir: string, name: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (e.name.toLowerCase() === name.toLowerCase()) {
      return p;
    }
  }
  return null;
}

async function fetchMannequin(): Promise<void> {
  const glbOut = path.join(CHAR_DIR, 'mannequin.glb');
  const licOut = path.join(CHAR_DIR, 'LICENSE.txt');
  if (fileOk(glbOut, GLB_SHA) && fs.existsSync(licOut)) {
    console.log('mannequin.glb already present, hash ok');
    return;
  }

  const zip = path.join(CACHE, 'universal_animation_librarystandard.zip');
  if (!fileOk(zip, ZIP_SHA)) {
    await download(ZIP_URL, zip);
    const got = sha256(zip);
    if (got !== ZIP_SHA) {
      fs.rmSync(zip, { force: true });
      throw new Error(`zip SHA-256 mismatch: expected ${ZIP_SHA}, got ${got} (size should be ${ZIP_BYTES})`);
    }
  }
  console.log('zip SHA-256 ok');

  const extractDir = path.join(CACHE, 'ual');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', extractDir]);

  const glbSrc = path.join(extractDir, GLB_IN_ZIP);
  if (!fs.existsSync(glbSrc)) throw new Error(`expected file missing from zip: ${GLB_IN_ZIP}`);
  const licSrc = findFile(extractDir, 'License.txt');
  if (!licSrc) throw new Error('License.txt not found in zip');

  fs.mkdirSync(CHAR_DIR, { recursive: true });
  fs.copyFileSync(glbSrc, glbOut);
  fs.copyFileSync(licSrc, licOut);

  const got = sha256(glbOut);
  if (got !== GLB_SHA) {
    fs.rmSync(glbOut, { force: true });
    throw new Error(`GLB SHA-256 mismatch: expected ${GLB_SHA}, got ${got}`);
  }
  console.log(`mannequin.glb ok (${fs.statSync(glbOut).size} bytes, expected ${GLB_BYTES}), LICENSE.txt copied`);
}

async function fetchSample(): Promise<void> {
  const out = path.join(ROOT, 'public/scenes/sample-room/scene.splat');
  if (fs.existsSync(out) && fs.statSync(out).size === SAMPLE_BYTES) {
    console.log('sample-room/scene.splat already present');
    return;
  }
  await download(SAMPLE_URL, out);
  const size = fs.statSync(out).size;
  if (size !== SAMPLE_BYTES) throw new Error(`room.splat size ${size}, expected ${SAMPLE_BYTES}`);
  console.log('room.splat ok. Local testing only: no stated licence, never commit or redistribute it.');
}

async function main(): Promise<void> {
  await fetchMannequin();
  if (process.argv.includes('--sample')) await fetchSample();
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
