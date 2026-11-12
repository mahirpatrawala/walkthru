// Owned by C11a. Derives the small things the look needs from the fetched CC0 files (needs ffmpeg on PATH):
//  - public/look/hdri/<name>_bg.jpg: a tone-mapped 2048 x 1024 picture of each HDRI, the low-tier backdrop (the low tier
//    budget is 1.8 MB, and a 1k .hdr alone is 1.4 to 1.6 MB).
//  - public/look/hdri/meta.json: where the brightest part of each HDRI is (azimuth in three's equirect convention).
//  - prints the mean linear luminance of every diffuse texture (pasted into src/look/materials.ts as constants).
// Run after `npm run fetch:look`: npx tsx scripts/derive-look-assets.ts
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/look');
const NAMES = ['rooftop_night', 'rooftop_day', 'kloofendal_48d_partly_cloudy_puresky'];
const BG_W = 2048;
const BG_H = 1024;
const EXPOSURE = 1.15;

/** Radiance .hdr (RGBE, new-style RLE) to float RGB. */
function readHdr(file: string): { w: number; h: number; rgb: Float32Array } {
  const buf = fs.readFileSync(file);
  let p = 0;
  const line = (): string => { let s = ''; while (buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error(`${file}: not a Radiance file`);
  let l = line();
  while (l !== '') l = line();
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error(`${file}: unsupported orientation`);
  const h = +m[1];
  const w = +m[2];
  const rgb = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] !== 2 || buf[p + 1] !== 2 || (buf[p + 2] & 0x80)) throw new Error(`${file}: not RLE`);
    p += 4;
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let n = buf[p++];
        if (n > 128) { n -= 128; const v = buf[p++]; while (n-- > 0) scan[(x++) * 4 + c] = v; }
        else { while (n-- > 0) scan[(x++) * 4 + c] = buf[p++]; }
      }
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e === 0 ? 0 : Math.pow(2, e - 136);
      const o = (y * w + x) * 3;
      rgb[o] = scan[x * 4] * f; rgb[o + 1] = scan[x * 4 + 1] * f; rgb[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, rgb };
}

/** Khronos PBR Neutral, the same operator three's NeutralToneMapping uses. */
function neutral(c: [number, number, number]): [number, number, number] {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const o: [number, number, number] = [c[0] - offset, c[1] - offset, c[2] - offset];
  const peak = Math.max(o[0], o[1], o[2]);
  if (peak < startCompression) return o;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const k = newPeak / peak;
  const r: [number, number, number] = [o[0] * k, o[1] * k, o[2] * k];
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [r[0] + (newPeak - r[0]) * g, r[1] + (newPeak - r[1]) * g, r[2] + (newPeak - r[2]) * g];
}
const toSrgb = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function deriveBackdrop(name: string, meta: Record<string, unknown>): void {
  const { w, h, rgb } = readHdr(path.join(OUT, `hdri/${name}_2k.hdr`));
  // brightest direction: luminance-weighted mean of the brightest 0.2% of the sky pixels (clamped so one firefly cannot win)
  const lums = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lums[i] = lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  // only the sky half (above the horizon) counts: the night HDRI's brightest pixels are lamps on the roof
  const sky = Float32Array.from(lums.subarray(0, (w * h) / 2)).sort();
  const cut = sky[Math.floor(sky.length * 0.998)];
  let sx = 0, sy = 0, sz = 0, sw = 0;
  for (let j = 0; j < h / 2; j++) for (let i = 0; i < w; i++) {
    const v = lums[j * w + i];
    if (v < cut) continue;
    // three's equirect: u = atan2(z, x) / 2pi + 0.5, v measured from the bottom (flipY), elevation = (v - 0.5) * pi
    const az = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
    const el = (0.5 - (j + 0.5) / h) * Math.PI;
    const wt = Math.min(v, cut * 4);
    sx += wt * Math.cos(el) * Math.cos(az); sy += wt * Math.sin(el); sz += wt * Math.cos(el) * Math.sin(az); sw += wt;
  }
  const azDeg = (Math.atan2(sz, sx) * 180) / Math.PI;
  const elDeg = (Math.asin(sy / Math.hypot(sx, sy, sz)) * 180) / Math.PI;
  meta[name] = { peakAzimuthDeg: +azDeg.toFixed(1), peakElevationDeg: +elDeg.toFixed(1), meanLuminance: +(lums.reduce((s, v) => s + v, 0) / lums.length).toFixed(4) };

  // downsample (box filter in linear light) and tone map
  const out = Buffer.alloc(BG_W * BG_H * 3);
  for (let j = 0; j < BG_H; j++) for (let i = 0; i < BG_W; i++) {
    const x0 = Math.floor((i * w) / BG_W), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / BG_W));
    const y0 = Math.floor((j * h) / BG_H), y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / BG_H));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * w + x) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; n++; }
    const t = neutral([(r / n) * EXPOSURE, (g / n) * EXPOSURE, (b / n) * EXPOSURE]);
    const o = (j * BG_W + i) * 3;
    out[o] = toSrgb(t[0]); out[o + 1] = toSrgb(t[1]); out[o + 2] = toSrgb(t[2]);
  }
  const raw = path.join(OUT, `hdri/${name}_bg.rgb`);
  fs.writeFileSync(raw, out);
  const jpg = path.join(OUT, `hdri/${name}_bg.jpg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${BG_W}x${BG_H}`, '-i', raw, '-q:v', '5', jpg]);
  fs.unlinkSync(raw);
  console.log(`${name}: backdrop ${fs.statSync(jpg).size} bytes, peak az ${azDeg.toFixed(1)} el ${elDeg.toFixed(1)}`);
}

function textureMean(file: string): number {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 4 });
  const lin = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const table = Array.from({ length: 256 }, (_, i) => lin(i));
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += lum(table[raw[i * 3]], table[raw[i * 3 + 1]], table[raw[i * 3 + 2]]);
  return sum / (w * h);
}

const meta: Record<string, unknown> = {};
for (const n of NAMES) deriveBackdrop(n, meta);
fs.writeFileSync(path.join(OUT, 'hdri/meta.json'), JSON.stringify(meta, null, 2) + '\n');

const means: Record<string, number> = {};
for (const dir of fs.readdirSync(path.join(OUT, 'tex'))) {
  for (const f of fs.readdirSync(path.join(OUT, 'tex', dir))) {
    if (!f.includes('_diff_')) continue;
    means[f.replace(/_1k\.jpg$/, '')] = +textureMean(path.join(OUT, 'tex', dir, f)).toFixed(4);
  }
}
console.log('mean linear luminance of each diffuse texture:', JSON.stringify(means, null, 1));

// record the derived files in the lock
const lockPath = path.join(OUT, 'assets.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.derived = {};
for (const f of [...NAMES.map((n) => `hdri/${n}_bg.jpg`), 'hdri/meta.json']) {
  const b = fs.readFileSync(path.join(OUT, f));
  lock.derived[f] = { size: b.length, sha256: createHash('sha256').update(b).digest('hex'), from: 'scripts/derive-look-assets.ts' };
}
lock.derived.textureMeans = means;
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
