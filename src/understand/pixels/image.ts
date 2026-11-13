// C12d. Pixels for the raster path: an 8-bit grey image, a PNG codec, a baseline JPEG reader, resampling and 3x3 maps.
// Pure TypeScript. Node only (zlib), never imported by the client bundle. Colour is dropped on decode: drawings are read as
// ink on paper, and a grey PNG is also the smallest thing to send to a model.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Gray { width: number; height: number; data: Uint8ClampedArray }
export type Pt = [number, number];
export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (pixels, y down)
export class ImageError extends Error {
  constructor(message: string) { super(message); this.name = 'ImageError'; }
}
export const newGray = (w: number, h: number, v = 255): Gray => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).fill(v) });

// ---------------------------------------------------------------- 3x3 maps (row major, homogeneous)
export type Mat3 = number[];
export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function matMul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
export function matInv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) throw new ImageError('singular map');
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}
export function applyMat(m: Mat3, p: Pt): Pt {
  const w = m[6] * p[0] + m[7] * p[1] + m[8];
  return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w];
}
export const translateMat = (dx: number, dy: number): Mat3 => [1, 0, dx, 0, 1, dy, 0, 0, 1];
export const scaleMat = (sx: number, sy: number): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
export const rotateMat = (rad: number, cx: number, cy: number): Mat3 => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
};
/** The map that takes the four `from` points to the four `to` points. */
export function homographyOf(from: Pt[], to: Pt[]): Mat3 {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new ImageError('degenerate corners');
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

// ---------------------------------------------------------------- resampling
export function cropGray(g: Gray, r: Rect, fill = 255): Gray {
  const x0 = Math.round(r[0]), y0 = Math.round(r[1]), w = Math.max(1, Math.round(r[2]) - x0), h = Math.max(1, Math.round(r[3]) - y0);
  const out = newGray(w, h, fill);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= g.height) continue;
    for (let x = 0; x < w; x++) { const sx = x0 + x; if (sx >= 0 && sx < g.width) out.data[y * w + x] = g.data[sy * g.width + sx]; }
  }
  return out;
}
/** Area-average shrink by an integer factor. */
export function shrinkBy(g: Gray, k: number): Gray {
  if (k <= 1) return g;
  const w = Math.max(1, Math.floor(g.width / k)), h = Math.max(1, Math.floor(g.height / k));
  const out = newGray(w, h);
  const n = k * k;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) { const row = (y * k + dy) * g.width + x * k; for (let dx = 0; dx < k; dx++) s += g.data[row + dx]; }
    out.data[y * w + x] = s / n;
  }
  return out;
}
export function bilinear(g: Gray, x: number, y: number, outside = 255): number {
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return outside;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1);
  const a = g.data[y0 * g.width + x0], b = g.data[y0 * g.width + x1], c = g.data[y1 * g.width + x0], d = g.data[y1 * g.width + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
/** Resize to w x h: area-average when shrinking a lot, then bilinear. Returns the map from source pixels to result pixels. */
export function resizeGray(g: Gray, w: number, h: number): { image: Gray; map: Mat3 } {
  const k = Math.max(1, Math.floor(Math.min(g.width / w, g.height / h)));
  const s = shrinkBy(g, k);
  const out = newGray(w, h);
  const sx = s.width / w, sy = s.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data[y * w + x] = bilinear(s, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
  return { image: out, map: scaleMat(w / g.width, h / g.height) };
}
/** Resample through a map: output pixel (x, y) takes the source value at inv(map)(x, y). */
export function warpGray(src: Gray, srcToDst: Mat3, w: number, h: number, outside = 255): Gray {
  const inv = matInv(srcToDst);
  const out = newGray(w, h, outside);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = inv[6] * x + inv[7] * y + inv[8];
    out.data[y * w + x] = bilinear(src, (inv[0] * x + inv[1] * y + inv[2]) / d, (inv[3] * x + inv[4] * y + inv[5]) / d, outside);
  }
  return out;
}
/** Paint a rectangle white (redaction). */
export function whiteOut(g: Gray, r: Rect): void {
  const x0 = Math.max(0, Math.floor(r[0])), y0 = Math.max(0, Math.floor(r[1])), x1 = Math.min(g.width, Math.ceil(r[2])), y1 = Math.min(g.height, Math.ceil(r[3]));
  for (let y = y0; y < y1; y++) g.data.fill(255, y * g.width + x0, y * g.width + x1);
}

/** Turn the picture by a multiple of 90 degrees clockwise. Returns the image and the map from old pixels to new ones. */
export function rotateQuarter(g: Gray, cw: 0 | 90 | 180 | 270): { image: Gray; map: Mat3 } {
  if (cw === 0) return { image: g, map: IDENTITY };
  const w = g.width, h = g.height;
  if (cw === 180) { const o = newGray(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.data[(h - 1 - y) * w + (w - 1 - x)] = g.data[y * w + x]; return { image: o, map: [-1, 0, w, 0, -1, h, 0, 0, 1] }; }
  const o = newGray(h, w);
  if (cw === 90) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.data[x * h + (h - 1 - y)] = g.data[y * w + x]; return { image: o, map: [0, -1, h, 1, 0, 0, 0, 0, 1] }; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.data[(w - 1 - x) * h + y] = g.data[y * w + x];
  return { image: o, map: [0, 1, 0, -1, 0, w, 0, 0, 1] };
}

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function encodePng(g: Gray): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, g.width); dv.setUint32(4, g.height); ihdr[8] = 8; ihdr[9] = 0;
  const raw = new Uint8Array((g.width + 1) * g.height);
  for (let y = 0; y < g.height; y++) raw.set(g.data.subarray(y * g.width, (y + 1) * g.width), y * (g.width + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function isPng(b: Uint8Array): boolean { return b.length > 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71; }
export function isJpeg(b: Uint8Array): boolean { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8; }

/** 8-bit, non-interlaced PNG of colour type grey, RGB, grey+alpha or RGBA. Transparent pixels become white. */
export function decodePng(b: Uint8Array): Gray {
  if (!isPng(b)) throw new ImageError('not a PNG');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p); const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const body = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = b[p + 16]; ctype = b[p + 17]; interlace = b[p + 20]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(ctype)) throw new ImageError(`unsupported PNG (depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype as 0 | 2 | 4 | 6];
  const cat = new Uint8Array(idat.reduce((a, x) => a + x.length, 0));
  let o = 0; for (const x of idat) { cat.set(x, o); o += x.length; }
  const raw = inflateSync(cat);
  const stride = w * bpp;
  if (raw.length < (stride + 1) * h) throw new ImageError('truncated PNG');
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = newGray(w, h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += up; else if (ft === 3) v += (a + up) >> 1;
      else if (ft === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      let v: number, alpha = 255;
      if (ctype === 0) v = cur[x]; else if (ctype === 4) { v = cur[x * 2]; alpha = cur[x * 2 + 1]; }
      else { v = 0.299 * cur[x * bpp] + 0.587 * cur[x * bpp + 1] + 0.114 * cur[x * bpp + 2]; if (ctype === 6) alpha = cur[x * 4 + 3]; }
      out.data[y * w + x] = alpha === 255 ? v : (v * alpha + 255 * (255 - alpha)) / 255;
    }
    prev.set(cur);
  }
  return out;
}

// ---------------------------------------------------------------- baseline JPEG (luma only)
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const IDCT_C = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2));
interface Huff { maxcode: number[]; valptr: number[]; mincode: number[]; vals: Uint8Array }
function buildHuff(counts: number[], vals: Uint8Array): Huff {
  const maxcode = new Array<number>(18).fill(-1), valptr = new Array<number>(17).fill(0), mincode = new Array<number>(17).fill(0);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) { valptr[l] = k; mincode[l] = code; code += counts[l - 1]; k += counts[l - 1]; maxcode[l] = counts[l - 1] ? code - 1 : -1; code <<= 1; }
  return { maxcode, valptr, mincode, vals };
}
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  // APP1 "Exif\0\0" + TIFF header
  if (end - start < 14 || b[start] !== 0x45 || b[start + 1] !== 0x78) return 1;
  const t = start + 6; const le = b[t] === 0x49;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number): number => dv.getUint16(o, le), u32 = (o: number): number => dv.getUint32(o, le);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > end) break; if (u16(e) === 0x0112) return u16(e + 8); }
  return 1;
}
function orient(g: Gray, o: number): Gray {
  if (o === 1 || o < 1 || o > 8) return g;
  const swap = o >= 5;
  const w = swap ? g.height : g.width, h = swap ? g.width : g.height;
  const out = newGray(w, h);
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    let X = x, Y = y;
    switch (o) {
      case 2: X = g.width - 1 - x; break;
      case 3: X = g.width - 1 - x; Y = g.height - 1 - y; break;
      case 4: Y = g.height - 1 - y; break;
      case 5: X = y; Y = x; break;
      case 6: X = g.height - 1 - y; Y = x; break;
      case 7: X = g.height - 1 - y; Y = g.width - 1 - x; break;
      case 8: X = y; Y = g.width - 1 - x; break;
    }
    out.data[Y * w + X] = g.data[y * g.width + x];
  }
  return out;
}
/** Baseline / extended-sequential Huffman JPEG, any subsampling, restart markers, EXIF orientation. Progressive is refused. */
export function decodeJpeg(b: Uint8Array): Gray {
  if (!isJpeg(b)) throw new ImageError('not a JPEG');
  const qt: Uint16Array[] = []; const dc: Huff[] = [], ac: Huff[] = [];
  let p = 2, w = 0, h = 0, restart = 0, orientation = 1;
  let comps: { id: number; h: number; v: number; tq: number; td: number; ta: number }[] = [];
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    if (m === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3]; const s = p + 4, e = p + 2 + len;
    if (m === 0xe1) orientation = exifOrientation(b, s, e);
    else if (m === 0xdb) {
      for (let q = s; q < e;) { const pq = b[q] >> 4, tq = b[q] & 15; q++; const t = new Uint16Array(64); for (let i = 0; i < 64; i++) { t[ZIGZAG[i]] = pq ? (b[q] << 8) | b[q + 1] : b[q]; q += pq ? 2 : 1; } qt[tq] = t; }
    } else if (m === 0xc0 || m === 0xc1) {
      if (b[s] !== 8) throw new ImageError('JPEG precision not 8');
      h = (b[s + 1] << 8) | b[s + 2]; w = (b[s + 3] << 8) | b[s + 4];
      comps = []; for (let i = 0; i < b[s + 5]; i++) comps.push({ id: b[s + 6 + i * 3], h: b[s + 7 + i * 3] >> 4, v: b[s + 7 + i * 3] & 15, tq: b[s + 8 + i * 3], td: 0, ta: 0 });
    } else if (m === 0xc2 || m === 0xc3 || (m >= 0xc5 && m <= 0xcf && m !== 0xc8 && m !== 0xcc)) throw new ImageError('progressive or lossless JPEG is not supported: save the photo as a normal JPEG or PNG');
    else if (m === 0xc4) {
      for (let q = s; q < e;) { const tc = b[q] >> 4, th = b[q] & 15; q++; const counts = Array.from(b.subarray(q, q + 16)); q += 16; const n = counts.reduce((a, c) => a + c, 0); const vals = b.slice(q, q + n); q += n; (tc ? ac : dc)[th] = buildHuff(counts, vals); }
    } else if (m === 0xdd) restart = (b[s] << 8) | b[s + 1];
    else if (m === 0xda) {
      const ns = b[s];
      for (let i = 0; i < ns; i++) { const c = comps.find((x) => x.id === b[s + 1 + i * 2]); if (c) { c.td = b[s + 2 + i * 2] >> 4; c.ta = b[s + 2 + i * 2] & 15; } }
      return orient(scan(b, e, w, h, comps, qt, dc, ac, restart), orientation);
    }
    p = e;
  }
  throw new ImageError('JPEG has no image data');
}
function scan(b: Uint8Array, start: number, w: number, h: number, comps: { id: number; h: number; v: number; tq: number; td: number; ta: number }[], qt: Uint16Array[], dc: Huff[], ac: Huff[], restart: number): Gray {
  const hmax = Math.max(...comps.map((c) => c.h)), vmax = Math.max(...comps.map((c) => c.v));
  if (comps[0].h !== hmax || comps[0].v !== vmax) throw new ImageError('unusual JPEG sampling');
  const mcux = Math.ceil(w / (8 * hmax)), mcuy = Math.ceil(h / (8 * vmax));
  const yw = mcux * hmax * 8, yh = mcuy * vmax * 8;
  const Y = new Uint8ClampedArray(yw * yh);
  let pos = start, bits = 0, nbits = 0;
  const fill = (): number => {
    let v = b[pos++] ?? 0;
    if (v === 0xff) { const n = b[pos]; if (n === 0) pos++; else { pos--; v = 0; } }
    return v;
  };
  const readBit = (): number => { if (!nbits) { bits = fill(); nbits = 8; } nbits--; return (bits >> nbits) & 1; };
  const readBits = (n: number): number => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v; };
  const decode = (t: Huff): number => {
    let code = 0;
    for (let l = 1; l <= 16; l++) { code = (code << 1) | readBit(); if (t.maxcode[l] >= 0 && code <= t.maxcode[l] && code >= t.mincode[l]) return t.vals[t.valptr[l] + code - t.mincode[l]]; }
    throw new ImageError('bad JPEG Huffman code');
  };
  const ext = (v: number, n: number): number => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const pred = comps.map(() => 0);
  const blk = new Float32Array(64), tmp = new Float32Array(64);
  let mcuCount = 0;
  for (let my = 0; my < mcuy; my++) for (let mx = 0; mx < mcux; mx++) {
    if (restart && mcuCount && mcuCount % restart === 0) {
      nbits = 0; while (pos < b.length && !(b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) pos++;
      pos += 2; pred.fill(0);
    }
    mcuCount++;
    comps.forEach((c, ci) => {
      for (let by = 0; by < c.v; by++) for (let bx = 0; bx < c.h; bx++) {
        blk.fill(0);
        const t = decode(dc[c.td]); pred[ci] += ext(readBits(t), t);
        const q = qt[c.tq];
        blk[0] = pred[ci] * q[0];
        for (let k = 1; k < 64;) {
          const rs = decode(ac[c.ta]); const r = rs >> 4, s = rs & 15;
          if (!s) { if (r === 15) { k += 16; continue; } break; }
          k += r; if (k > 63) break;
          blk[ZIGZAG[k]] = ext(readBits(s), s) * q[ZIGZAG[k]]; k++;
        }
        if (ci !== 0) continue;
        for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += blk[v * 8 + u] * IDCT_C[x][u]; tmp[v * 8 + x] = s; }
        const ox = (mx * hmax + bx) * 8, oy = (my * vmax + by) * 8;
        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += tmp[v * 8 + x] * IDCT_C[y][v]; Y[(oy + y) * yw + ox + x] = s + 128; }
      }
    });
  }
  const out = newGray(w, h);
  for (let y = 0; y < h; y++) out.data.set(Y.subarray(y * yw, y * yw + w), y * w);
  return out;
}

/** Decode a PNG or a baseline JPEG to grey. Other formats (WebP, HEIC) must be converted by the caller (see the CLI). */
export function decodeImage(bytes: Uint8Array): Gray {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  throw new ImageError('Unsupported image format. Use PNG or JPEG.');
}
