// Owned by C11a. Derives what the look needs from the fetched CC0 files (needs ffmpeg on PATH):
//  - public/look/hdri/view_{day,dusk,sky}_bg.jpg (2048 x 1024) and _bg4k.jpg (4096 x 2048): the view out of the window as an
//    equirectangular picture, sampled per view direction so it sits at infinity. The sky is a Poly Haven HDRI, tone mapped; the
//    city (hazy low-rise blocks in three layers, towers, a hazy street below the horizon, lit windows at dusk) is drawn here from
//    a seeded random generator. It is an illustration and is labelled so in the look panel.
//  - public/look/hdri/meta.json: where the brightest part of each sky is, so the look can turn the view to the sun.
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
const EXPOSURE = 1.0;

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

// ---------------------------------------------------------------- the window views

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (x: number, y: number): number => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

interface View {
  name: string;
  /** which HDRI supplies the sky */ sky: string;
  /** camera height above the street, metres: the horizon sits at elevation 0 and buildings are measured against it */ camH: number;
  night: boolean;
  /** building heights (min, max) in metres, tower share */ heights: [number, number]; towers: number;
  /** haze towards the far layers, 0..1 */ haze: number;
  seed: number;
}
const VIEWS: View[] = [
  // a flat on about the 8th floor, by day: low-rise city below and around the horizon, towers poking above it
  { name: 'view_day', sky: 'kloofendal_48d_partly_cloudy_puresky', camH: 24, night: false, heights: [9, 22], towers: 0.07, haze: 0.42, seed: 11 },
  // the same view after sunset: the dusk sky, dark blocks, lit windows
  { name: 'view_dusk', sky: 'rooftop_night', camH: 24, night: true, heights: [9, 22], towers: 0.07, haze: 0.4, seed: 11 },
  // below the 5th floor (and True colours): the pure sky over a hazy low skyline
  { name: 'view_sky', sky: 'kloofendal_48d_partly_cloudy_puresky', camH: 7, night: false, heights: [5, 12], towers: 0, haze: 0.55, seed: 5 },
];

interface Sky { w: number; h: number; rgb: Float32Array; low: Float32Array }
function loadSky(name: string): Sky {
  const { w, h, rgb } = readHdr(path.join(OUT, `hdri/${name}_2k.hdr`));
  // 64 x 32 box average, for the smooth glow near the horizon
  const lw = 64, lh = 32;
  const low = new Float32Array(lw * lh * 3);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor((j * h) / lh); y < Math.floor(((j + 1) * h) / lh); y += 2) for (let x = Math.floor((i * w) / lw); x < Math.floor(((i + 1) * w) / lw); x += 2) { const o = (y * w + x) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; n++; }
    low.set([r / n, g / n, b / n], (j * lw + i) * 3);
  }
  return { w, h, rgb, low };
}
function sampleBilinear(buf: Float32Array, w: number, h: number, u: number, v: number): RGB {
  const x = u * w - 0.5, y = Math.min(h - 1.001, Math.max(0, v * h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const at = (xx: number, yy: number, c: number): number => buf[(yy * w + (((xx % w) + w) % w)) * 3 + c];
  const o: number[] = [0, 0, 0];
  for (let c = 0; c < 3; c++) o[c] = (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty;
  return o as RGB;
}

interface Layer { dist: number; top: Float32Array; kind: Uint8Array; id: Int32Array; baseEl: number; colours: RGB[] }

function buildLayers(v: View, W: number): Layer[] {
  const rand = rng(v.seed);
  const dists = [900, 480, 230];
  const palette: RGB[] = v.night
    ? [[0.07, 0.06, 0.09], [0.09, 0.08, 0.1], [0.06, 0.06, 0.08]]
    : [[0.4, 0.36, 0.32], [0.48, 0.45, 0.41], [0.34, 0.35, 0.38], [0.52, 0.42, 0.34], [0.43, 0.4, 0.36]];
  return dists.map((dist, k) => {
    const top = new Float32Array(W).fill(-90);
    const kind = new Uint8Array(W);
    const id = new Int32Array(W);
    let x = 0, n = 0;
    while (x < W) {
      const widthM = 12 + rand() * 38;
      const wPx = Math.max(2, Math.round(((widthM / dist) * W) / (2 * Math.PI)));
      const tower = rand() < v.towers * (k === 0 ? 1.6 : 1);
      const hM = tower ? 38 + rand() * 40 : v.heights[0] + rand() * (v.heights[1] - v.heights[0]);
      const gap = rand() < 0.18 ? Math.round(wPx * rand() * 0.6) : 0; // a street between blocks
      const el = (Math.atan((hM - v.camH) / dist) * 180) / Math.PI;
      for (let i = 0; i < wPx && x + i < W; i++) { if (i >= wPx - gap) continue; top[x + i] = el; kind[x + i] = tower ? 2 : 1; id[x + i] = n; }
      x += wPx; n++;
    }
    return { dist, top, kind, id, baseEl: -(Math.atan(v.camH / dist) * 180) / Math.PI, colours: palette };
  });
}

/** The city seen from above: streets, plots with roofs of a few kinds, trees, water tanks, fading into haze with distance. */
function ground(i: number, j: number, W: number, H: number, v: View, haze: RGB): RGB {
  const SS = 2;
  const acc: RGB = [0, 0, 0];
  const hz: RGB = [haze[0] * EXPOSURE, haze[1] * EXPOSURE, haze[2] * EXPOSURE];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const elDeg = (0.5 - (j + (sy + 0.5) / SS) / H) * 180;
    const az = ((i + (sx + 0.5) / SS) / W - 0.5) * 2 * Math.PI;
    const d = v.camH / Math.tan((-Math.min(elDeg, -0.02) * Math.PI) / 180);
    const dist = Math.min(d, 5000);
    const X = dist * Math.cos(az), Z = dist * Math.sin(az);
    const bx = Math.floor(X / 58), bz = Math.floor(Z / 58);
    const fx = X / 58 - bx, fz = Z / 58 - bz;
    let col: RGB;
    if (fx < 0.1 || fz < 0.1) {
      col = v.night ? [0.03, 0.03, 0.035] : [0.18, 0.18, 0.19]; // a street
      if (hash2(Math.floor(X / 3), Math.floor(Z / 3)) > 0.93) col = v.night ? [0.5, 0.35, 0.2] : [0.62, 0.6, 0.57]; // a parked car
    } else {
      const P = 9; // plot size in metres
      const cx = Math.floor(X / P), cz = Math.floor(Z / P);
      const h = hash2(cx, cz);
      const h2 = hash2(cx + 91, cz + 17);
      if (h > 0.9) col = v.night ? [0.03, 0.05, 0.03] : [0.34, 0.45, 0.27];            // a tree or a garden
      else if (h > 0.7) col = v.night ? [0.08, 0.06, 0.06] : [0.55, 0.34, 0.26];       // terracotta
      else if (h > 0.32) col = v.night ? [0.07, 0.07, 0.08] : [0.5, 0.49, 0.47];       // concrete roof
      else col = v.night ? [0.06, 0.06, 0.07] : [0.72, 0.69, 0.62];                      // pale terrace
      const lx = (X / P) % 1, lz = (Z / P) % 1;
      const edge = Math.min(lx, 1 - lx, lz, 1 - lz) < 0.07 ? 0.78 : 1; // parapet shadow
      const tone = (0.82 + 0.34 * h2) * edge * (0.95 + 0.1 * hash2(Math.floor(X), Math.floor(Z)));
      col = [col[0] * tone, col[1] * tone, col[2] * tone];
      if (h2 > 0.93 && lx > 0.3 && lx < 0.5 && lz > 0.3 && lz < 0.5) col = v.night ? [0.04, 0.04, 0.04] : [0.18, 0.2, 0.22]; // a water tank
      if (v.night && h2 > 0.84) col = [0.9, 0.6, 0.3]; // lit windows
    }
    const t = smooth(150, 1700, dist);
    col = mix(col, hz, Math.min(1, 0.04 + t * 0.96 * v.haze + (t > 0.99 ? 1 : 0)));
    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
  }
  return [acc[0] / (SS * SS), acc[1] / (SS * SS), acc[2] / (SS * SS)];
}

function deriveView(v: View, size: [number, number], file: string, skies: Map<string, Sky>, meta: Record<string, unknown>): void {
  const [W, H] = size;
  const sky = skies.get(v.sky)!;
  const layers = buildLayers(v, W);
  // the brightest part of the sky, recorded so the look can turn the picture to the sun
  if (!meta[v.name]) {
    const lums = new Float32Array((sky.w * sky.h) / 2);
    for (let i = 0; i < lums.length; i++) lums[i] = lum(sky.rgb[i * 3], sky.rgb[i * 3 + 1], sky.rgb[i * 3 + 2]);
    const sorted = Float32Array.from(lums).sort();
    const cut = sorted[Math.floor(sorted.length * 0.998)];
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < sky.h / 2; j++) for (let i = 0; i < sky.w; i++) {
      const l = lums[j * sky.w + i];
      if (l < cut) continue;
      const az = ((i + 0.5) / sky.w - 0.5) * 2 * Math.PI, el = (0.5 - (j + 0.5) / sky.h) * Math.PI, wt = Math.min(l, cut * 4);
      sx += wt * Math.cos(el) * Math.cos(az); sy += wt * Math.sin(el); sz += wt * Math.cos(el) * Math.sin(az);
    }
    meta[v.name] = { peakAzimuthDeg: +((Math.atan2(sz, sx) * 180) / Math.PI).toFixed(1), peakElevationDeg: +((Math.asin(sy / Math.hypot(sx, sy, sz)) * 180) / Math.PI).toFixed(1), camHeightM: v.camH };
  }
  const haze: RGB = [0, 0, 0]; // the colour of the air at the horizon, measured from the sky itself
  {
    let n = 0;
    for (let i = 0; i < 64; i++) { const c = sampleBilinear(sky.low, 64, 32, (i + 0.5) / 64, 0.5 - (v.night ? 9 : 4) / 180); haze[0] += c[0]; haze[1] += c[1]; haze[2] += c[2]; n++; }
    haze[0] /= n; haze[1] /= n; haze[2] /= n;
    if (v.night) { haze[0] *= 0.55; haze[1] *= 0.5; haze[2] *= 0.6; }
  }
  const out = Buffer.alloc(W * H * 3);
  const GROUND_NEAR: RGB = v.night ? [0.025, 0.025, 0.03] : [0.2, 0.19, 0.17];
  for (let j = 0; j < H; j++) {
    const elDeg = (0.5 - (j + 0.5) / H) * 180;
    const vv = (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      let c: RGB;
      if (elDeg >= 0) {
        // sky. Near the horizon the dusk picture is replaced by its smooth glow: the real one has a roof and lamps in it.
        const full = sampleBilinear(sky.rgb, sky.w, sky.h, u, vv);
        if (v.night) {
          const soft = sampleBilinear(sky.low, 64, 32, u, vv);
          c = mix(soft, full, smooth(12, 22, elDeg));
        } else c = full;
        c = [c[0] * EXPOSURE, c[1] * EXPOSURE, c[2] * EXPOSURE];
      } else {
        c = ground(i, j, W, H, v, haze);
      }
      // the skyline, far to near
      for (let k = 0; k < layers.length; k++) {
        const L = layers[k];
        const top = L.top[i];
        if (elDeg > top || elDeg < L.baseEl) continue;
        const idx = L.id[i];
        const base = L.colours[(idx * 7 + k * 3) % L.colours.length];
        const tint = 0.9 + 0.2 * hash2(idx, k + 40);
        let b: RGB = [base[0] * tint, base[1] * tint, base[2] * tint];
        const hz = v.haze * (k === 0 ? 1 : k === 1 ? 0.62 : 0.38);
        // storeys and bays on the nearer blocks
        if (k >= 1) {
          const yM = v.camH + Math.tan((elDeg * Math.PI) / 180) * L.dist;
          const xM = ((u * 2 * Math.PI) * L.dist);
          const fy = (yM / 3.1) % 1, fx = (xM / 3.4) % 1;
          const win = fy > 0.35 && fy < 0.8 && fx > 0.2 && fx < 0.75;
          if (v.night) {
            if (win && hash2(Math.floor(yM / 3.1) + idx * 31, Math.floor(xM / 3.4)) > 0.78) b = [1.0, 0.72, 0.4];
          } else if (win) b = [b[0] * 0.82, b[1] * 0.84, b[2] * 0.88];
          else b = [b[0] * 1.02, b[1] * 1.02, b[2] * 1.0];
          if (L.kind[i] === 2 && !v.night) b = [b[0] * 0.96, b[1] * 0.98, b[2]];
        }
        const edge = Math.min(1, (top - elDeg) / 0.6); // soft rooftop line
        const shade = v.night ? 1 : 0.86 + 0.14 * smooth(L.baseEl, top, elDeg);
        const hzC = mix(b, [haze[0] * EXPOSURE, haze[1] * EXPOSURE, haze[2] * EXPOSURE], hz);
        const col: RGB = [hzC[0] * shade, hzC[1] * shade, hzC[2] * shade];
        c = mix(c, col, Math.min(1, 0.25 + edge * 0.75));
      }
      const t = neutral(c);
      const o = (j * W + i) * 3;
      // a little contrast and colour, so the view reads against the pale walls
      const px = [toSrgb(t[0]), toSrgb(t[1]), toSrgb(t[2])];
      const mean = (px[0] + px[1] + px[2]) / 3;
      for (let k = 0; k < 3; k++) out[o + k] = Math.round(Math.min(255, Math.max(0, 128 + (mean + (px[k] - mean) * 1.2 - 128) * 1.34)));
    }
  }
  const raw = path.join(OUT, `hdri/${file}.rgb`);
  fs.writeFileSync(raw, out);
  const jpg = path.join(OUT, `hdri/${file}.jpg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', raw, '-q:v', W > 3000 ? '4' : '3', jpg]);
  fs.unlinkSync(raw);
  console.log(`${file}: ${fs.statSync(jpg).size} bytes`);
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
const skies = new Map<string, Sky>();
for (const n of NAMES.filter((x) => x !== 'rooftop_day')) skies.set(n, loadSky(n));
const outputs: string[] = [];
for (const v of VIEWS) {
  deriveView(v, [2048, 1024], `${v.name}_bg`, skies, meta);
  deriveView(v, [4096, 2048], `${v.name}_bg4k`, skies, meta);
  outputs.push(`hdri/${v.name}_bg.jpg`, `hdri/${v.name}_bg4k.jpg`);
}
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
for (const f of [...outputs, 'hdri/meta.json']) {
  const b = fs.readFileSync(path.join(OUT, f));
  lock.derived[f] = { size: b.length, sha256: createHash('sha256').update(b).digest('hex'), from: 'scripts/derive-look-assets.ts' };
}
lock.derived.textureMeans = means;
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
