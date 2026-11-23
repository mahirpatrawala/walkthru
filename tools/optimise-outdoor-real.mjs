// SPEC 19.12 (22 Nov 2026): turns the raw downloads of scripts/fetch-outdoor-real.mjs into the small files the open-air spaces ship, under
// public/look/outdoor/, and writes their SHA-256 into public/look/outdoor/files.lock.json.
//
//   node optimise-outdoor-real.mjs <repo>        (run from a scratch install, see below; OUTDOOR_RAW overrides the raw cache)
//
// Dev-only. Needs (not in package.json: copy this file next to a scratch install, e.g. ~/walkthru-tools/gltf, and run it there):
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// What it makes:
//  - leaves/<species>.webp (512 px) and .low.webp (256 px): a SPRAY card for each species, composed here from real leaf photographs (Poly Haven
//    leaf atlases, alpha-cut): each leaf is cut out of its atlas by its alpha, turned, scaled and shaded onto a twig, and the species' blossom is
//    made of real leaf shapes tinted to the flower's colour (a bougainvillea's bracts are leaves; petals are leaf-shaped). Seeded: the same input
//    always gives the same card.
//  - leaves/hedge-ficus.jpg: a dense tileable mat of small leaf photos for the clipped hedges.
//  - grass/tufts.webp: four grass tufts (Poly Haven grass_bermuda_01) in a strip, for the blades on the lawns.
//  - tex/deck_*.jpg, tex/bark_*.jpg, tex/mosaic_*.jpg: the timber deck, the bark and the pool's glass mosaic (diffuse 1024 or 512, normal 512).
//  - sky/sky_day.jpg (2048 x 640) and .low.jpg (1024 x 320): the upper hemisphere of the Poly Haven kloofendal_48d_partly_cloudy_puresky HDRI
//    already in public/look/hdri (CC0, a photograph of a sky with nothing else in it), tone mapped, elevation -8 to +90 degrees.
//  - models/coconut-palm.glb and .low.glb: the CC-BY coconut palm, origin at the foot of its trunks, textures to WebP (512 / 256), normal maps
//    dropped on low, meshopt; and leaves/palm-frond.webp, its frond picture, for the procedural palms.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, getBounds, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.argv[2];
if (!REPO || !fs.existsSync(path.join(REPO, 'SPEC.md'))) { console.error('usage: node optimise-outdoor-real.mjs <repo>'); process.exit(1); }
const RAW = process.env.OUTDOOR_RAW || path.join(os.homedir(), 'walkthru-tools/outdoor-raw/real');
const OUT = path.join(REPO, 'public/look/outdoor');
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !only || only.has(k);
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const written = [];
const put = async (rel, buf) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); written.push(rel); console.log(rel, buf.length); };

// ------------------------------------------------------------------ raster helpers (premultiplied float RGBA)
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const canvas = (w, h) => ({ w, h, px: new Float32Array(w * h * 4) });
async function atlas(diff, alpha, size = 1024) {
  const rgb = await sharp(diff).resize(size, size).removeAlpha().raw().toBuffer();
  const a = await sharp(alpha).resize(size, size).extractChannel(0).raw().toBuffer();
  return { w: size, h: size, rgb, a };
}
/** connected components of alpha >= 128 */
function components(img, minArea) {
  const { w, h, a } = img; const lab = new Int32Array(w * h).fill(-1); const out = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] >= 0 || a[s] < 128) continue;
    const id = out.length; const st = [s]; lab[s] = id; let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    while (st.length) {
      const p = st.pop(); const x = p % w, y = (p / w) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && lab[p - 1] < 0 && a[p - 1] >= 128) { lab[p - 1] = id; st.push(p - 1); }
      if (x < w - 1 && lab[p + 1] < 0 && a[p + 1] >= 128) { lab[p + 1] = id; st.push(p + 1); }
      if (y > 0 && lab[p - w] < 0 && a[p - w] >= 128) { lab[p - w] = id; st.push(p - w); }
      if (y < h - 1 && lab[p + w] < 0 && a[p + w] >= 128) { lab[p + w] = id; st.push(p + w); }
    }
    out.push({ id, x0, y0, x1, y1, n });
  }
  return { list: out.filter((c) => c.n >= minArea), lab };
}
/**
 * A sprite: the component's pixels only, with its own axis from BASE (where it joins the twig) to TIP. The axis is the principal axis of the
 * alpha; the base is the end with less leaf in its last 10 % (the stalk), unless `baseDown` says the base is the lowest point (grass tufts).
 */
function sprite(img, comp, lab, baseDown = false) {
  const { w, rgb, a } = img; const m = 3;
  const x0 = Math.max(0, comp.x0 - m), y0 = Math.max(0, comp.y0 - m), x1 = Math.min(w - 1, comp.x1 + m), y1 = Math.min(img.h - 1, comp.y1 + m);
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1; const px = new Float32Array(sw * sh * 4);
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const p = (y0 + y) * w + (x0 + x), o = (y * sw + x) * 4;
    const own = lab[p] === comp.id || (lab[p] < 0 && a[p] > 0 && a[p] < 128);
    const al = own ? a[p] / 255 : 0;
    px[o] = (rgb[p * 3] / 255) * al; px[o + 1] = (rgb[p * 3 + 1] / 255) * al; px[o + 2] = (rgb[p * 3 + 2] / 255) * al; px[o + 3] = al;
    if (al > 0.5) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; n++; }
  }
  const cx = sx / n, cy = sy / n, vxx = sxx / n - cx * cx, vyy = syy / n - cy * cy, vxy = sxy / n - cx * cy;
  const ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
  let ux = Math.cos(ang), uy = Math.sin(ang);
  // extent along the axis, and how much leaf sits in each end
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (px[(y * sw + x) * 4 + 3] > 0.5) { const t = (x - cx) * ux + (y - cy) * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  let mLo = 0, mHi = 0; const L = hi - lo;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (px[(y * sw + x) * 4 + 3] > 0.5) { const t = (x - cx) * ux + (y - cy) * uy; if (t < lo + L * 0.1) mLo++; if (t > hi - L * 0.1) mHi++; }
  let baseAtLo = mLo < mHi;
  if (baseDown) baseAtLo = (uy > 0) ? false : true; // image y grows down: the base is the larger y
  if (!baseAtLo) { ux = -ux; uy = -uy; const t = lo; lo = -hi; hi = -t; }
  const base = { x: cx + ux * lo, y: cy + uy * lo }, tip = { x: cx + ux * hi, y: cy + uy * hi };
  // mean colour, for tints
  let r = 0, g = 0, b = 0, s = 0; for (let i = 0; i < sw * sh; i++) { const al = px[i * 4 + 3]; if (al > 0.5) { r += px[i * 4] / al; g += px[i * 4 + 1] / al; b += px[i * 4 + 2] / al; s++; } }
  return { w: sw, h: sh, px, base, tip, len: Math.hypot(tip.x - base.x, tip.y - base.y), mean: [r / s, g / s, b / s] };
}
async function leafSprites(slug, stem, minArea, keep, baseDown = false) {
  const img = await atlas(path.join(RAW, slug, `${stem}_diff_1k.jpg`), path.join(RAW, slug, `${stem}_alpha_1k.jpg`));
  const { list, lab } = components(img, minArea);
  return list.filter((c) => keep(c)).map((c) => sprite(img, c, lab, baseDown));
}
function sample(s, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; const o = [0, 0, 0, 0];
  for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const X = x0 + dx, Y = y0 + dy; if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
    const p = (Y * s.w + X) * 4; o[0] += s.px[p] * wt; o[1] += s.px[p + 1] * wt; o[2] += s.px[p + 2] * wt; o[3] += s.px[p + 3] * wt;
  }
  return o;
}
/**
 * Draws sprite `s` with its base at (bx, by) pointing at angle `ang` (0 = straight up, radians clockwise), `len` px from base to tip,
 * mirrored across its axis if `flip`, its colour through `shade(r, g, b) -> [r, g, b]` (straight, not premultiplied).
 */
function draw(c, s, bx, by, ang, len, flip, shade, wide = 1) {
  const k = len / s.len; const dx = Math.sin(ang), dy = -Math.cos(ang); // target axis
  const ux = (s.tip.x - s.base.x) / s.len, uy = (s.tip.y - s.base.y) / s.len; const vx = -uy, vy = ux; // sprite axis and its normal
  const pdx = -dy, pdy = dx; // target normal
  const R = Math.hypot(s.w, s.h) * k * Math.max(1, wide);
  const X0 = Math.max(0, Math.floor(bx - R)), X1 = Math.min(c.w - 1, Math.ceil(bx + R)), Y0 = Math.max(0, Math.floor(by - R)), Y1 = Math.min(c.h - 1, Math.ceil(by + R));
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const qx = (x + 0.5 - bx) / k, qy = (y + 0.5 - by) / k;
    const u = qx * dx + qy * dy; let v = (qx * pdx + qy * pdy) / wide; if (flip) v = -v;
    const sx = s.base.x + u * ux + v * vx - 0.5, sy = s.base.y + u * uy + v * vy - 0.5;
    if (sx < -1 || sy < -1 || sx > s.w || sy > s.h) continue;
    const p = sample(s, sx, sy); if (p[3] < 0.004) continue;
    const [r, g, b] = shade(p[0] / p[3], p[1] / p[3], p[2] / p[3], u / s.len);
    const o = (y * c.w + x) * 4, al = p[3], inv = 1 - al;
    c.px[o] = r * al + c.px[o] * inv; c.px[o + 1] = g * al + c.px[o + 1] * inv; c.px[o + 2] = b * al + c.px[o + 2] * inv; c.px[o + 3] = al + c.px[o + 3] * inv;
  }
}
/** a twig: discs stamped along a quadratic curve, tapering, in bark colours */
function twig(c, x0, y0, cx, cy, x1, y1, r0, r1, col) {
  const L = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(cx - x0, cy - y0); const n = Math.max(8, Math.ceil(L));
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
    const x = a * x0 + b * cx + d * x1, y = a * y0 + b * cy + d * y1, r = r0 + (r1 - r0) * t;
    for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++) for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue;
      const dd = Math.hypot(xx + 0.5 - x, yy + 0.5 - y); const al = Math.min(1, Math.max(0, r + 0.5 - dd)); if (al <= 0) continue;
      const side = (xx + 0.5 - x) / Math.max(0.5, r); const sh = 0.8 + 0.25 * side; // a lit side
      const o = (yy * c.w + xx) * 4, inv = 1 - al;
      c.px[o] = col[0] * sh * al + c.px[o] * inv; c.px[o + 1] = col[1] * sh * al + c.px[o + 1] * inv; c.px[o + 2] = col[2] * sh * al + c.px[o + 2] * inv; c.px[o + 3] = al + c.px[o + 3] * inv;
    }
  }
}
/** RGBA8 out of a premultiplied float canvas, the colour of the nearest leaf pushed into the empty pixels (no dark fringe when mipmapped) */
function toRGBA8(c) {
  const { w, h, px } = c; const out = Buffer.alloc(w * h * 4); const col = new Float32Array(w * h * 3); const has = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const al = px[i * 4 + 3]; if (al > 0.02) { col[i * 3] = px[i * 4] / al; col[i * 3 + 1] = px[i * 4 + 1] / al; col[i * 3 + 2] = px[i * 4 + 2] / al; has[i] = 1; } }
  for (let pass = 0; pass < 24; pass++) {
    const add = [];
    for (let i = 0; i < w * h; i++) {
      if (has[i]) continue; const x = i % w, y = (i / w) | 0; let r = 0, g = 0, b = 0, n = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && has[j]) { r += col[j * 3]; g += col[j * 3 + 1]; b += col[j * 3 + 2]; n++; }
      if (n) add.push([i, r / n, g / n, b / n]);
    }
    if (!add.length) break;
    for (const [i, r, g, b] of add) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; has[i] = 1; }
  }
  for (let i = 0; i < w * h; i++) {
    const s = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    out[i * 4] = s(col[i * 3]); out[i * 4 + 1] = s(col[i * 3 + 1]); out[i * 4 + 2] = s(col[i * 3 + 2]); out[i * 4 + 3] = s(px[i * 4 + 3]);
  }
  return out;
}
const webp = (c, size, opts = {}) => sharp(toRGBA8(c), { raw: { width: c.w, height: c.h, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 78, alphaQuality: 85, effort: 6, ...opts }).toBuffer();
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// ------------------------------------------------------------------ the sprays
/** a leaf's own colour scaled toward a target mean, keeping the photo's light and dark */
const toward = (mean, target, amount = 1, gain = 1) => (r, g, b) => {
  const L = (x) => 0.3 * x[0] + 0.59 * x[1] + 0.11 * x[2]; const k = (0.3 * r + 0.59 * g + 0.11 * b) / Math.max(0.02, L(mean));
  return [r * (1 - amount) + target[0] * k * amount, g * (1 - amount) + target[1] * k * amount, b * (1 - amount) + target[2] * k * amount].map((v) => v * gain);
};
/** a petal: the leaf's light and dark (high contrast cut down) over a flower colour, a little lighter at the tip */
const petal = (mean, colour, centre) => (r, g, b, t) => {
  const k = 0.75 + 0.25 * ((0.3 * r + 0.59 * g + 0.11 * b) / Math.max(0.02, 0.3 * mean[0] + 0.59 * mean[1] + 0.11 * mean[2]));
  const c = centre && t < 0.28 ? centre.map((v, i) => v + (colour[i] - v) * (t / 0.28)) : colour;
  return c.map((v) => v * k * (0.9 + 0.15 * t));
};

const SPRAYS = {
  // compound leaves fanned off a twig; neem darker and a little blue, gulmohar fresh and with flame-red clusters
  neem: { leaves: 'pinnate', n: 16, len: [0.32, 0.46], tint: '#3E6A2C', amt: 0.55, twig: '#5E5043', flowers: null },
  gulmohar: { leaves: 'pinnate', n: 15, len: [0.3, 0.44], tint: '#5A8C38', amt: 0.4, twig: '#62564A', flowers: { colour: '#E0461C', centre: '#F6C343', clusters: 9, petals: 5, size: 0.055, wide: 1.6 } },
  // big leaves in whorls at the tips, cream flowers with a yellow eye
  frangipani: { leaves: 'broad', n: 16, tips: true, len: [0.3, 0.42], tint: '#4E8A3E', amt: 0.25, twig: '#8E8A80', flowers: { colour: '#FBF3E0', centre: '#F2C94C', clusters: 6, petals: 5, size: 0.085, wide: 1.45, rosette: true } },
  ficus: { leaves: 'broad', n: 120, len: [0.085, 0.125], tint: '#2F6A2E', amt: 0.45, twig: '#6A5F52', flowers: null },
  hibiscus: { leaves: 'serrate', n: 36, len: [0.15, 0.21], tint: '#3E7A34', amt: 0.3, twig: '#6C5B49', flowers: { colour: '#D7262E', centre: '#F4E07A', clusters: 4, petals: 5, size: 0.12, wide: 2.1, rosette: true } },
  bougainvillea: { leaves: 'serrate', n: 34, len: [0.1, 0.14], tint: '#4F8A3A', amt: 0.35, twig: '#6C5B49', flowers: { colour: '#D63384', centre: null, clusters: 42, petals: 3, size: 0.065, wide: 1.55, bract: true } },
  croton: { leaves: 'broad', n: 24, len: [0.22, 0.3], tint: null, amt: 0, twig: '#6C5B49', flowers: null, variegate: ['#C9892B', '#E4B94C', '#8E3E22', '#4E7A2E'] },
};

async function makeSprays() {
  const pinnate = await leafSprites('jacaranda_tree', 'jacaranda_tree_leaves', 8000, () => true);
  const broad = await leafSprites('island_tree_02', 'island_tree_02_leaves', 8000, () => true);
  // shrub_01: the green serrated leaves only (not the bark strip, the flower disc or the yellowing leaves)
  const serrAll = await leafSprites('shrub_01', 'shrub_01', 3000, (c) => c.x1 - c.x0 < 400 && c.y1 - c.y0 < 600);
  const serrate = serrAll.filter((s) => s.mean[1] > s.mean[0] * 1.12 && s.mean[1] > s.mean[2] * 1.3);
  console.log('sprites: pinnate', pinnate.length, 'broad', broad.length, 'serrate', serrate.length, 'of', serrAll.length);
  const sets = { pinnate, broad, serrate };
  const S = 1024; // drawn at 1024, shipped at 512 and 256
  for (const [id, spec] of Object.entries(SPRAYS)) {
    if (!want(`spray:${id}`) && !want('sprays')) continue;
    const r = rng([...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 11));
    const c = canvas(S, S);
    const set = sets[spec.leaves];
    const bark = hex(spec.twig).map((v) => v * 0.9);
    // the twig: from the bottom centre up and out, with side shoots; leaves hang off it, back ones darker (they are in the crown's shade)
    const stems = [];
    const main = { x0: S / 2, y0: S - 2, cx: S / 2 + (r() - 0.5) * 90, cy: S * 0.5, x1: S / 2 + (r() - 0.5) * 160, y1: S * 0.07 };
    stems.push(main);
    for (let i = 0; i < 7; i++) {
      const t = 0.18 + i * 0.1, sx = main.x0 + (main.x1 - main.x0) * t, sy = main.y0 + (main.y1 - main.y0) * t, side = i % 2 ? 1 : -1;
      const reach = 260 + r() * 170 - i * 18;
      stems.push({ x0: sx, y0: sy, cx: sx + side * reach * 0.55, cy: sy - 70 - r() * 60, x1: Math.min(S - 40, Math.max(40, sx + side * reach)), y1: Math.max(40, sy - 150 - r() * 150) });
    }
    for (const st of stems) twig(c, st.x0, st.y0, st.cx, st.cy, st.x1, st.y1, st === main ? 7 : 4, 2, bark);
    const along = (st, t) => { const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; return { x: a * st.x0 + b * st.cx + d * st.x1, y: a * st.y0 + b * st.cy + d * st.y1 }; };
    const target = spec.tint ? hex(spec.tint) : null;
    const items = [];
    for (let i = 0; i < spec.n; i++) {
      const st = stems[i % stems.length];
      const t = spec.tips ? 0.72 + r() * 0.28 : (st === main ? 0.35 : 0.15) + r() * (st === main ? 0.65 : 0.85); // frangipani: leaves in whorls at the tips
      const p = along(st, t);
      const dirUp = Math.atan2(st.x1 - st.x0, -(st.y1 - st.y0));
      const ang = dirUp + (r() - 0.5) * 2.6;
      const len = S * (spec.len[0] + r() * (spec.len[1] - spec.len[0]));
      const s = set[Math.floor(r() * set.length)];
      const depth = r(); // 0 back .. 1 front
      const gain = 0.62 + 0.48 * depth;
      let shade;
      if (spec.variegate) { const v = hex(spec.variegate[Math.floor(r() * spec.variegate.length)]); shade = toward(s.mean, v, 0.7, gain); }
      else shade = toward(s.mean, target, spec.amt, gain);
      items.push({ depth, f: () => draw(c, s, p.x, p.y, ang, len, r() < 0.5, shade) });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((it) => it.f());
    if (spec.flowers) {
      const fl = spec.flowers; const col = hex(fl.colour), cen = fl.centre ? hex(fl.centre) : null;
      for (let k = 0; k < fl.clusters; k++) {
        const st = stems[k % stems.length]; const p = along(st, 0.55 + r() * 0.45);
        const cx = p.x + (r() - 0.5) * 160, cy = p.y + (r() - 0.5) * 160;
        const size = S * fl.size * (0.8 + r() * 0.4);
        const rot = r() * 6.283;
        // petals: leaf shapes from the broad set, short and wide, round a centre; a cluster of gulmohar is several small flowers
        const flowers = fl.rosette || fl.bract ? 1 : 3;
        for (let f = 0; f < flowers; f++) {
          const fx = cx + (flowers > 1 ? (r() - 0.5) * size * 2.2 : 0), fy = cy + (flowers > 1 ? (r() - 0.5) * size * 2.2 : 0);
          for (let q = 0; q < fl.petals; q++) {
            const s = broad[Math.floor(r() * broad.length)];
            const a = rot + (q / fl.petals) * 6.283 + (r() - 0.5) * 0.3;
            draw(c, s, fx, fy, a, size * (fl.bract ? 0.9 : 1), r() < 0.5, petal(s.mean, col.map((v) => v * (0.9 + r() * 0.15)), fl.bract ? null : cen), fl.wide ?? 1);
          }
        }
      }
    }
    await put(`leaves/${id}.webp`, await webp(c, 512));
    await put(`leaves/${id}.low.webp`, await webp(c, 256));
  }
}

/**
 * SPEC 19.14 (23 Nov 2026): the frangipani's tip atlas, for the branching frangipani of src/outdoor/foliage.ts. Left half: ONE long leaf, a real
 * leaf photograph (island_tree_02, alpha-cut) drawn base at the bottom centre, stretched to a frangipani's long obovate leaf and tinted its green.
 * Right half: a cluster of flowers seen from above, each five overlapping cream petals turning in a pinwheel round a yellow throat (petal shapes
 * drawn here, shaded for their curl; a frangipani has no leaf-shaped petal), with a few buds. Ships at 512 x 256 and 256 x 128.
 */
async function makeFrangipaniTip() {
  const broad = await leafSprites('island_tree_02', 'island_tree_02_leaves', 8000, () => true);
  // the longest, least torn leaves
  const leaves = broad.filter((s) => s.len > 0).sort((a, b) => b.len / Math.max(b.w, b.h) - a.len / Math.max(a.w, a.h)).slice(0, 6);
  const S = 1024; const c = canvas(S * 2, S); const r = rng(4242);
  const s = leaves[0];
  draw(c, s, S / 2, S - 6, 0, S * 0.97, false, toward(s.mean, hex('#3F7A33'), 0.45, 1.0), 0.8);
  // flowers: a petal is an obovate blade from the throat out, its width greatest two thirds out, the near edge turned under (darker)
  const cream = hex('#FBF6EA'), throat = hex('#F2BE3C');
  const petalAt = (fx, fy, a, len, wid, twist) => {
    const R = len * 1.1; const ca = Math.cos(a), sa = Math.sin(a);
    for (let y = Math.floor(fy - R); y <= fy + R; y++) for (let x = Math.floor(fx - R); x <= fx + R; x++) {
      if (x < S || x >= 2 * S || y < 0 || y >= S) continue;
      const dx = x + 0.5 - fx, dy = y + 0.5 - fy; const u = (dx * ca + dy * sa) / len, v = (-dx * sa + dy * ca) / wid;
      if (u < 0 || u > 1) continue;
      const half = Math.sin(Math.PI * Math.pow(u, 0.75)) * (0.55 + 0.45 * u); // obovate
      const vv = v - twist * u * u; if (Math.abs(vv) > half) continue;
      const edge = Math.min(1, (half - Math.abs(vv)) * wid * 0.6); // a soft pixel at the rim
      const curl = vv > 0 ? 0.86 + 0.14 * (1 - vv / half) : 1.0; // one side of each petal tucks under the next
      const t = Math.min(1, u / 0.42); const col = cream.map((cv, i) => throat[i] + (cv - throat[i]) * (t * t * (3 - 2 * t)));
      const k = curl * (0.9 + 0.1 * u) * (0.97 + 0.06 * Math.sin(v * 9 + u * 3));
      const o = (y * c.w + x) * 4, al = edge, inv = 1 - al;
      c.px[o] = col[0] * k * al + c.px[o] * inv; c.px[o + 1] = col[1] * k * al + c.px[o + 1] * inv; c.px[o + 2] = col[2] * k * al + c.px[o + 2] * inv; c.px[o + 3] = al + c.px[o + 3] * inv;
    }
  };
  const spots = [];
  for (let i = 0; i < 400 && spots.length < 12; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * S * 0.33; const p = { x: S * 1.5 + Math.cos(a) * d, y: S * 0.5 + Math.sin(a) * d, rr: S * (0.085 + r() * 0.035) };
    if (spots.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > (q.rr + p.rr) * 0.72)) spots.push(p);
  }
  // buds first (under the open flowers): short closed spindles, cream with a pink-tinged tip
  for (let i = 0; i < 6; i++) { const a = r() * 6.283, d = S * (0.2 + r() * 0.2); petalAt(S * 1.5 + Math.cos(a) * d * 0.6, S * 0.5 + Math.sin(a) * d * 0.6, a, S * 0.07, S * 0.018, 0); }
  for (const p of spots) { const rot = r() * 6.283; for (let k = 0; k < 5; k++) petalAt(p.x, p.y, rot + (k / 5) * 6.283, p.rr, p.rr * 0.5, 0.35); }
  const out = (w, h) => sharp(toRGBA8(c), { raw: { width: c.w, height: c.h, channels: 4 } }).resize(w, h, { kernel: 'lanczos3' }).webp({ quality: 80, alphaQuality: 88, effort: 6 }).toBuffer();
  await put('leaves/frangipani-tip.webp', await out(512, 256));
  await put('leaves/frangipani-tip.low.webp', await out(256, 128));
}

/** a clipped hedge: small leaf photos packed densely over a dark green, wrapped at the edges so it tiles */
async function makeHedge() {
  const broad = await leafSprites('island_tree_02', 'island_tree_02_leaves', 8000, () => true);
  const S = 1024; const c = canvas(S, S); const r = rng(77); const base = hex('#1E3F1C');
  for (let i = 0; i < S * S; i++) { c.px[i * 4] = base[0]; c.px[i * 4 + 1] = base[1]; c.px[i * 4 + 2] = base[2]; c.px[i * 4 + 3] = 1; }
  const target = hex('#2F6A2E');
  for (let i = 0; i < 1500; i++) {
    const s = broad[Math.floor(r() * broad.length)]; const x = r() * S, y = r() * S, ang = r() * 6.283, len = 60 + r() * 40, depth = i / 1500;
    const shade = toward(s.mean, target, 0.5, 0.55 + 0.55 * depth);
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) if (x + ox > -120 && x + ox < S + 120 && y + oy > -120 && y + oy < S + 120) draw(c, s, x + ox, y + oy, ang, len, i % 2 === 0, shade);
  }
  const rgb = toRGBA8(c);
  await put('leaves/hedge-ficus.jpg', await sharp(rgb, { raw: { width: S, height: S, channels: 4 } }).removeAlpha().resize(512, 512).jpeg({ quality: 84, mozjpeg: true }).toBuffer());
}

/** grass: four tufts side by side, each in a 128 x 256 cell with its base on the bottom edge */
async function makeGrass() {
  const tufts = await leafSprites('grass_bermuda_01', 'grass_bermuda_01', 2500, (c) => c.y1 - c.y0 > 150 && c.x1 - c.x0 > 60 && c.x1 - c.x0 < 300, true);
  tufts.sort((a, b) => b.len - a.len);
  console.log('grass tufts', tufts.length);
  const W = 1024, H = 512; const c = canvas(W, H);
  for (let i = 0; i < 4; i++) {
    const s = tufts[i % tufts.length];
    draw(c, s, (i + 0.5) * (W / 4), H - 2, 0, H * 0.94, i % 2 === 1, toward(s.mean, hex('#5E8C3A'), 0.35, 1));
  }
  const buf = toRGBA8(c);
  await put('grass/tufts.webp', await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).resize(512, 256).webp({ quality: 86, alphaQuality: 90 }).toBuffer());
}

// ------------------------------------------------------------------ surfaces
async function makeSurfaces() {
  const jpg = (f, size, q = 84) => sharp(f).resize(size, size).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  await put('tex/deck_diff.jpg', await jpg(path.join(RAW, 'wooden_planks/wooden_planks_diff_1k.jpg'), 1024, 82));
  await put('tex/deck_nor.jpg', await jpg(path.join(RAW, 'wooden_planks/wooden_planks_nor_gl_1k.jpg'), 512, 86));
  await put('tex/bark_diff.jpg', await jpg(path.join(RAW, 'bark_platanus/bark_platanus_diff_1k.jpg'), 512, 82));
  await put('tex/mosaic_diff.jpg', await jpg(path.join(RAW, 'Tiles132A/Tiles132A_1K-JPG_Color.jpg'), 512, 86));
  await put('tex/mosaic_nor.jpg', await jpg(path.join(RAW, 'Tiles132A/Tiles132A_1K-JPG_NormalGL.jpg'), 512, 88));
}

// ------------------------------------------------------------------ the sky
function readHdr(file) {
  const buf = fs.readFileSync(file); let p = 0;
  const line = () => { let s = ''; while (buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error('not a Radiance file');
  let l = line(); while (l !== '') l = line();
  const m = /-Y (\d+) \+X (\d+)/.exec(line()); const h = +m[1], w = +m[2];
  const rgb = new Float32Array(w * h * 3); const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    p += 4;
    for (let c = 0; c < 4; c++) { let x = 0; while (x < w) { let n = buf[p++]; if (n > 128) { n -= 128; const v = buf[p++]; while (n-- > 0) scan[(x++) * 4 + c] = v; } else { while (n-- > 0) scan[(x++) * 4 + c] = buf[p++]; } } }
    for (let x = 0; x < w; x++) { const e = scan[x * 4 + 3]; const f = e === 0 ? 0 : Math.pow(2, e - 136); const o = (y * w + x) * 3; rgb[o] = scan[x * 4] * f; rgb[o + 1] = scan[x * 4 + 1] * f; rgb[o + 2] = scan[x * 4 + 2] * f; }
  }
  return { w, h, rgb };
}
async function makeSky() {
  const hdr = readHdr(path.join(REPO, 'public/look/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr'));
  // rows from elevation +90 (top) down to -8 degrees; the sun's disc is clipped so the picture is a sky, not a light source (the scene's own sun is the light)
  const elTop = 90, elBot = -8; const W = hdr.w, H = Math.round(hdr.h * (elTop - elBot) / 180);
  const out = Buffer.alloc(W * H * 3);
  // exposure: the median of the clear sky maps to about 0.55 before the curve
  const lum = []; for (let y = Math.round(hdr.h * 0.1); y < hdr.h * 0.45; y += 4) for (let x = 0; x < W; x += 8) { const o = (y * W + x) * 3; lum.push(0.2126 * hdr.rgb[o] + 0.7152 * hdr.rgb[o + 1] + 0.0722 * hdr.rgb[o + 2]); }
  lum.sort((a, b) => a - b); const k = 0.42 / lum[lum.length >> 1];
  const curve = (v) => { const x = v * k; const y = x / (1 + x * 0.55); return Math.pow(Math.min(1, y), 1 / 2.2); };
  for (let y = 0; y < H; y++) {
    const el = elTop - (y + 0.5) / H * (elTop - elBot); const sy = Math.min(hdr.h - 1, Math.round((90 - el) / 180 * hdr.h));
    for (let x = 0; x < W; x++) { const i = (sy * W + x) * 3, o = (y * W + x) * 3; for (let c = 0; c < 3; c++) out[o + c] = Math.round(curve(hdr.rgb[i + c]) * 255); }
  }
  // which column is the sun (brightest), for turning the picture to the scene's sun
  let best = 0, bx = 0; for (let y = 0; y < hdr.h / 2; y += 2) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; const v = hdr.rgb[o] + hdr.rgb[o + 1] + hdr.rgb[o + 2]; if (v > best) { best = v; bx = x; } }
  const sunU = (bx + 0.5) / W;
  await put('sky/sky_day.jpg', await sharp(out, { raw: { width: W, height: H, channels: 3 } }).resize(2048, 640, { fit: 'fill' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer());
  await put('sky/sky_day.low.jpg', await sharp(out, { raw: { width: W, height: H, channels: 3 } }).resize(1024, 320, { fit: 'fill' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
  return { sunU, elTop, elBot };
}

// ------------------------------------------------------------------ the coconut palm
async function makePalm() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder });
  const src = path.join(RAW, 'coconut-palm/26e787f2ff2e4c0fb004c3b0210805a3.glb');
  const facts = {};
  for (const tier of ['low', 'full']) {
    const doc = await io.read(src);
    const root = doc.getRoot();
    await doc.transform(flatten());
    // bake every node's world transform into its vertices, so the model is one level of meshes at the scene's origin
    for (const node of root.listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION'); const nor = prim.getAttribute('NORMAL');
        const a = pos.getArray().slice(); for (let i = 0; i < a.length; i += 3) { const x = a[i], y = a[i + 1], z = a[i + 2]; a[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; a[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; a[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]; }
        pos.setArray(a);
        if (nor) { const b = nor.getArray().slice(); for (let i = 0; i < b.length; i += 3) { const x = b[i], y = b[i + 1], z = b[i + 2]; let nx = m[0] * x + m[4] * y + m[8] * z, ny = m[1] * x + m[5] * y + m[9] * z, nz = m[2] * x + m[6] * y + m[10] * z; const l = Math.hypot(nx, ny, nz) || 1; b[i] = nx / l; b[i + 1] = ny / l; b[i + 2] = nz / l; } nor.setArray(b); }
      }
      node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    // the foot: the middle of the trunk vertices within 25 cm of the ground
    let sx = 0, sz = 0, n = 0, minY = Infinity;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const a = prim.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) minY = Math.min(minY, a[i + 1]); }
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const a = prim.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) if (a[i + 1] < minY + 0.25) { sx += a[i]; sz += a[i + 2]; n++; } }
    const fx = sx / n, fz = sz / n;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const p = prim.getAttribute('POSITION'); const a = p.getArray().slice(); for (let i = 0; i < a.length; i += 3) { a[i] -= fx; a[i + 1] -= minY; a[i + 2] -= fz; } p.setArray(a); }
    // parts by material: trunk (Tree_0), fibre net (Tree_1), fronds (Tree_2, alpha), crown shaft (Tree_3), nuts and stalks (Tree_4)
    const PART = { Tree_0Mat: 'trunk', Tree_1Mat: 'fibre', Tree_2Mat: 'fronds', Tree_3Mat: 'crown', Tree_4Mat: 'nuts' };
    for (const mat of root.listMaterials()) {
      const part = PART[mat.getName()] ?? mat.getName(); mat.setName(part);
      if (part === 'fronds') { mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.45); mat.setDoubleSided(true); }
      mat.setMetallicRoughnessTexture(null); mat.setMetallicFactor(0); mat.setRoughnessFactor(0.85);
      if (tier === 'low') mat.setNormalTexture(null);
    }
    for (const node of root.listNodes()) { const mesh = node.getMesh(); if (mesh) { const mat = mesh.listPrimitives()[0].getMaterial(); node.setName(mat.getName()); mesh.setName(mat.getName()); } }
    await doc.transform(prune(), dedup(), weld());
    if (tier === 'low') await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.004, lockBorder: true }));
    // textures: WebP, 512 (full) / 256 (low); the frond keeps its alpha
    const normals = new Set(root.listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
    const fronds = root.listMaterials().find((m) => m.getName() === 'fronds')?.getBaseColorTexture();
    for (const t of root.listTextures()) {
      // the fronds' picture carries the look (512 full); the bark-like parts and every normal map are small on screen (256; low 256 / 128)
      const size = tier === 'low' ? (t === fronds ? 256 : 128) : (t === fronds || !normals.has(t) && t === root.listMaterials().find((m) => m.getName() === 'trunk')?.getBaseColorTexture() ? 512 : 256);
      const img = sharp(Buffer.from(t.getImage())).resize(size, size, { fit: 'inside' });
      const meta = await sharp(Buffer.from(t.getImage())).metadata();
      const buf = await img.webp({ quality: 82, alphaQuality: 90, effort: 6, ...(meta.hasAlpha ? {} : { alphaQuality: 100 }) }).toBuffer();
      t.setImage(new Uint8Array(buf)); t.setMimeType('image/webp'); t.setURI('');
    }
    doc.createExtension(EXTTextureWebP).setRequired(true);
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const b = getBounds(root.listScenes()[0]);
    let tris = 0; for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    const bytes = await io.writeBinary(doc);
    await put(`models/coconut-palm${tier === 'low' ? '.low' : ''}.glb`, Buffer.from(bytes));
    facts[tier] = { tris: Math.round(tris), min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) };
    if (tier === 'full') {
      // the frond picture, for the procedural palms
      const fr = root.listMaterials().find((m) => m.getName() === 'fronds').getBaseColorTexture();
      await put('leaves/palm-frond.webp', await sharp(Buffer.from(fr.getImage())).resize(256, 512, { fit: 'fill' }).webp({ quality: 86, alphaQuality: 90 }).toBuffer());
    }
  }
  return facts;
}

// ------------------------------------------------------------------ run
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
if (want('sprays') || [...(only ?? [])].some((k) => k.startsWith('spray:'))) await makeSprays();
if (want('hedge')) await makeHedge();
if (want('frangipani-tip')) await makeFrangipaniTip();
if (want('grass')) await makeGrass();
if (want('surfaces')) await makeSurfaces();
if (want('sky')) manifest.sky = await makeSky();
if (want('palm')) manifest.coconutPalm = await makePalm();
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
// the lock of every shipped file
const lockFile = path.join(OUT, 'files.lock.json');
const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : { generatedBy: 'tools/optimise-outdoor-real.mjs', files: {} };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
lock.files = {};
for (const f of walk(OUT).sort()) {
  const rel = path.relative(OUT, f); if (rel.endsWith('.json') || rel.endsWith('.txt')) continue;
  const b = fs.readFileSync(f); lock.files[rel] = { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log('wrote', written.length, 'files; lock has', Object.keys(lock.files).length);
