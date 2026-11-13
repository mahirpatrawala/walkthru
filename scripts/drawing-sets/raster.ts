// C12a: rasterise a sheet and degrade it like a brochure scan or a phone photo (SPEC 17.10 "Raster variants").
// Pure TypeScript grayscale; the 8x8 DCT round trip gives JPEG-style block artefacts without an encoder.
import { deflateSync } from 'node:zlib';
import { mulberry32 } from '../../src/core/geometry';
import type { UserPage } from './render';
import { strokeText } from './glyphs';

export interface Gray { width: number; height: number; data: Uint8ClampedArray }

const lum = (hex: string): number => 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);

function fillPoly(g: Gray, pts: [number, number][], v: number): void {
  if (pts.length < 3) return;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(g.height - 1, Math.ceil(y1));
  const xs: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5; xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(g.width, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) g.data[y * g.width + x] = v;
    }
  }
}
function strokeSeg(g: Gray, a: [number, number], b: [number, number], w: number, v: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1e-6) { fillPoly(g, [[a[0] - w / 2, a[1] - w / 2], [a[0] + w / 2, a[1] - w / 2], [a[0] + w / 2, a[1] + w / 2], [a[0] - w / 2, a[1] + w / 2]], v); return; }
  const nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
  const ex = (dx / L) * (w / 2), ey = (dy / L) * (w / 2);
  fillPoly(g, [[a[0] + nx - ex, a[1] + ny - ey], [b[0] + nx + ex, b[1] + ny + ey], [b[0] - nx + ex, b[1] - ny + ey], [a[0] - nx - ex, a[1] - ny - ey]], v);
}

export function rasterize(page: UserPage, dpi: number): Gray {
  const k = dpi / 72;
  const g: Gray = { width: Math.round(page.width * k), height: Math.round(page.height * k), data: new Uint8ClampedArray(Math.round(page.width * k) * Math.round(page.height * k)).fill(255) };
  const P = (p: [number, number]): [number, number] => [p[0] * k, g.height - p[1] * k];
  for (const p of page.prims) {
    if (p.t === 'fill') fillPoly(g, p.pts.map(P), lum(p.color));
    else if (p.t === 'stroke') {
      const pts = p.pts.map(P); const w = Math.max(1.3, p.width * k); const v = lum(p.color);
      for (let i = 0; i + 1 < pts.length; i++) { if (p.dash && i % 2 === 1) continue; strokeSeg(g, pts[i], pts[i + 1], w, v); }
      if (p.closed && pts.length > 2) strokeSeg(g, pts[pts.length - 1], pts[0], w, v);
    } else {
      // real text is drawn with the stroke font in the raster (no font engine here); user-space angle is CCW, glyphs are y down
      const rot = -p.angle;
      for (const s of strokeText(p.str, p.x, -p.y, { capH: p.size * 0.72, font: 'simplex', slantDeg: 0, widthScale: 1, rot })) {
        const pts = s.pts.map(([x, y]) => P([x, -y]));
        for (let i = 0; i + 1 < pts.length; i++) strokeSeg(g, pts[i], pts[i + 1], Math.max(1.3, p.size * 0.045 * k), 0);
      }
    }
  }
  return g;
}

function boxBlur(g: Gray, r: number): Gray {
  if (r < 1) return g;
  const out = new Uint8ClampedArray(g.data.length), tmp = new Float32Array(g.data.length);
  const { width: w, height: h } = g;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += g.data[y * w + xx]; c++; } } tmp[y * w + x] = s / c; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } } out[y * w + x] = s / c; }
  return { width: w, height: h, data: out };
}

const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const COS: number[][] = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
/** 8x8 DCT, quantise at the given JPEG quality, inverse: the visible block artefacts of a JPEG, no entropy coding. */
export function jpegRoundTrip(g: Gray, quality: number): Gray {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const q = QL.map((v) => Math.max(1, Math.round((v * scale + 50) / 100)));
  const out = new Uint8ClampedArray(g.data.length);
  const blk = new Float32Array(64), co = new Float32Array(64), tmp = new Float32Array(64);
  for (let by = 0; by < g.height; by += 8) for (let bx = 0; bx < g.width; bx += 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = g.data[Math.min(g.height - 1, by + y) * g.width + Math.min(g.width - 1, bx + x)] - 128;
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += blk[v * 8 + x] * COS[u][x]; tmp[v * 8 + u] = s * (u === 0 ? Math.SQRT1_2 : 1) / 2; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v][y]; co[v * 8 + u] = Math.round((s * (v === 0 ? Math.SQRT1_2 : 1) / 2) / q[v * 8 + u]) * q[v * 8 + u]; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let v = 0; v < 8; v++) { let t = 0; for (let u = 0; u < 8; u++) t += co[v * 8 + u] * (u === 0 ? Math.SQRT1_2 : 1) * COS[u][x]; s += t * (v === 0 ? Math.SQRT1_2 : 1) * COS[v][y]; }
      const yy = by + y, xx = bx + x;
      if (yy < g.height && xx < g.width) out[yy * g.width + xx] = s / 4 + 128;
    }
  }
  return { width: g.width, height: g.height, data: out };
}

/** Where the sheet's corners land in a phone photo. Consumes two draws from `r`. */
function phoneCorners(w: number, h: number, warpDeg: number, r: () => number): { src: [number, number][]; dst: [number, number][] } {
  const t = Math.tan((warpDeg * Math.PI) / 180);
  // destination corners: the top edge shrinks and the sides lean, by up to warpDeg of tilt
  const j = (): number => (r() - 0.5) * 0.4;
  const src: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const dst: [number, number][] = [[w * (0.04 + t * (1 + j())), h * (0.03 + t * 0.6)], [w * (0.96 - t * (1 + j())), h * (0.03 + t * 0.2)], [w * (0.97 - t * 0.2), h * 0.97], [w * (0.03 + t * 0.2), h * (0.97 - t * 0.3)]];
  return { src, dst };
}
/** The map (rasterised page pixels -> photo pixels) that `phonePhoto` applied for these arguments. */
export function phoneForward(w: number, h: number, warpDeg: number, seed: number): number[] {
  const { src, dst } = phoneCorners(w, h, warpDeg, mulberry32(seed));
  const H = homography(src, dst);
  return [...H, 1];
}

/** Projective warp by a small camera tilt, uneven light, blur and sensor noise: a phone photo of a printed sheet. */
export function phonePhoto(g: Gray, warpDeg: number, seed: number): Gray {
  const r = mulberry32(seed);
  const { width: w, height: h } = g;
  const { src, dst } = phoneCorners(w, h, warpDeg, r);
  const H = homography(dst, src); // maps destination pixel -> source pixel
  const out = new Uint8ClampedArray(w * h);
  const nl = (x: number, y: number): number => 0.82 + 0.18 * (x / w) - 0.12 * Math.hypot(x / w - 0.5, y / h - 0.5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = H[6] * x + H[7] * y + 1;
    const sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
    let v = 70;
    if (sx >= 0 && sy >= 0 && sx < w - 1 && sy < h - 1) {
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const a = g.data[y0 * w + x0], b = g.data[y0 * w + x0 + 1], c = g.data[(y0 + 1) * w + x0], e = g.data[(y0 + 1) * w + x0 + 1];
      v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
    }
    out[y * w + x] = v * nl(x, y) + (r() - 0.5) * 8;
  }
  return boxBlur({ width: w, height: h, data: out }, 1);
}
function homography(from: [number, number][], to: [number, number][]): number[] {
  // solve 8 unknowns h0..h7 for to = H(from)
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[8] / row[i]);
}

/** The raster twin of a sheet: render at the set's dpi, then the scan or photo degradation, then the JPEG round trip. */
export function rasterTwin(page: UserPage, o: { dpi: number; jpegQuality: number; phone: boolean; warpDeg: number }, seed: number): Gray {
  let g = rasterize(page, o.dpi);
  g = boxBlur(g, o.phone ? 1 : 0);
  if (o.phone) g = phonePhoto(g, o.warpDeg, seed);
  else { const r = mulberry32(seed); for (let i = 0; i < g.data.length; i++) g.data[i] = g.data[i] + (r() - 0.5) * 6; }
  return jpegRoundTrip(g, o.jpegQuality);
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
  for (let y = 0; y < g.height; y++) { raw[y * (g.width + 1)] = 0; raw.set(g.data.subarray(y * g.width, (y + 1) * g.width), y * (g.width + 1) + 1); }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
