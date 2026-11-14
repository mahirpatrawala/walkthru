// Style generators (src/look/gen). Makes the two small tileable maps no CC0 set gives us, and records them in
// public/look/assets.lock.json under `derived` WITHOUT touching the entries other scripts wrote there. All three are drawn here
// from formulas (our own, nothing copied), 512 x 512, tileable: needs ffmpeg on PATH (it only encodes the JPG).
//  - tex/gen/quilt_nor.jpg     diamond quilting: soft puffs between stitch lines (a bedcover, a quilted headboard)
//  - tex/gen/stripe_diff.jpg   navy and cream ticking stripes for cushions (a colour map: used as is, not tinted)
// It also prints the mean linear luminance of the diffuse maps the generators use as detail around a tint.
// Run after `npm run fetch:look`: npx tsx scripts/make-gen-textures.ts
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look');
const N = 512;

function encode(rgb: Uint8Array, rel: string): void {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = dest + '.raw';
  fs.writeFileSync(raw, rgb);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${N}x${N}`, '-i', raw, '-q:v', '2', dest]);
  fs.unlinkSync(raw);
  console.log(`${rel}: ${fs.statSync(dest).size} bytes`);
}

/** a tangent-space normal map (OpenGL convention, +Y up) from a height function, finite differences on the torus */
function normalMap(h: (x: number, y: number) => number, strength: number): Uint8Array {
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = h(i / N, j / N);
  const out = new Uint8Array(N * N * 3);
  const at = (i: number, j: number): number => H[((j + N) % N) * N + ((i + N) % N)];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * 0.5 * N;
      const dy = (at(i, j + 1) - at(i, j - 1)) * 0.5 * N;
      // image rows run down, +Y of the normal points up the image
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (j * N + i) * 3;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

const fract = (v: number): number => v - Math.floor(v);
function hash2(x: number, y: number): number { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
/** value noise that tiles with period `p` cells */
function tnoise(x: number, y: number, p: number): number {
  const xi = Math.floor(x * p), yi = Math.floor(y * p);
  const fx = x * p - xi, fy = y * p - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const g = (a: number, b: number): number => hash2(((a % p) + p) % p, ((b % p) + p) % p);
  return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy;
}

// quilt: 4 diamonds across the tile on the diagonal grid; each is a soft pillow (sin x sin), stitch lines are the valleys
encode(normalMap((x, y) => {
  const fu = fract(4 * (x + y)), fv = fract(4 * (x - y));
  const pillow = Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), 0.7);
  return pillow * 0.9 + 0.12 * tnoise(x, y, 24) + 0.05 * tnoise(x, y, 96);
}, 0.06), 'tex/gen/quilt_nor.jpg');

// ticking stripes: navy bands of 6 and cream bands of 4 (out of 32 per tile), slightly uneven like woven cloth
{
  const rgb = new Uint8Array(N * N * 3);
  const navy = [43, 58, 92], cream = [236, 231, 220];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N;
      const band = fract(x * 16) < 0.58;
      const wob = 1 + 0.06 * (tnoise(x, y, 64) - 0.5) + 0.05 * (tnoise(x * 1, y, 180) - 0.5);
      const c = band ? navy : cream;
      const o = (j * N + i) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.max(0, Math.min(255, Math.round(c[k] * wob)));
    }
  }
  encode(rgb, 'tex/gen/stripe_diff.jpg');
}

function textureMean(file: string): number {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 4 });
  const table = Array.from({ length: 256 }, (_, i) => { const s = i / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += 0.2126 * table[raw[i * 3]] + 0.7152 * table[raw[i * 3 + 1]] + 0.0722 * table[raw[i * 3 + 2]];
  return sum / (w * h);
}
const means: Record<string, number> = {};
for (const f of ['tex/oak_veneer_01/oak_veneer_01_diff_1k.jpg', 'tex/curly_teddy_natural/curly_teddy_natural_diff_1k.jpg']) {
  means[path.basename(f).replace(/_1k\.jpg$/, '')] = +textureMean(path.join(OUT, f)).toFixed(4);
}
console.log('mean linear luminance (paste into furniture-materials.ts MEAN):', JSON.stringify(means));

const lockPath = path.join(OUT, 'assets.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.derived ??= {};
for (const f of ['tex/gen/quilt_nor.jpg', 'tex/gen/stripe_diff.jpg']) {
  const b = fs.readFileSync(path.join(OUT, f));
  lock.derived[f] = { size: b.length, sha256: createHash('sha256').update(b).digest('hex'), from: 'scripts/make-gen-textures.ts' };
}
lock.derived.textureMeans = { ...(lock.derived.textureMeans ?? {}), ...means };
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
