// C12d. SPEC 17.8 raster input: make a phone photo or a scan look like a flat, evenly lit, upright page before anything is read.
//   1. perspective fix: find the sheet as the largest bright region, fit its four edges, map them to a rectangle;
//   2. even out the lighting (divide by a blurred paper estimate);
//   3. deskew by the projection profile of the ink (a small tilt only; quarter turns are the model's job).
// Every step returns the 3x3 map from the ORIGINAL pixels to the new ones, so a box a model draws on the cleaned image can be
// carried back to the file the broker uploaded. Pure TypeScript.
import { IDENTITY, homographyOf, matMul, newGray, rotateMat, shrinkBy, warpGray, resizeGray } from './image';
import type { Gray, Mat3, Pt } from './image';

export interface Preprocessed { image: Gray; /** original pixels -> image pixels */ toImage: Mat3; steps: string[]; quad: Pt[] | null; deskewDeg: number }

export function otsu(hist: ArrayLike<number>, total: number): number {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
export function histogram(g: Gray): Uint32Array { const h = new Uint32Array(256); for (let i = 0; i < g.data.length; i++) h[g.data[i]]++; return h; }

/** Least squares v = a + b*u over the points, dropping the worst 15% twice. */
function fitLine(pts: Pt[]): { a: number; b: number } | null {
  let P = pts;
  for (let pass = 0; pass < 3; pass++) {
    if (P.length < 8) return null;
    const n = P.length; let su = 0, sv = 0, suu = 0, suv = 0;
    for (const [u, v] of P) { su += u; sv += v; suu += u * u; suv += u * v; }
    const den = n * suu - su * su; if (Math.abs(den) < 1e-9) return null;
    const b = (n * suv - su * sv) / den, a = (sv - b * su) / n;
    if (pass === 2) return { a, b };
    const r = P.map((p) => ({ p, e: Math.abs(p[1] - (a + b * p[0])) })).sort((x, y) => x.e - y.e);
    P = r.slice(0, Math.floor(r.length * 0.85)).map((x) => x.p);
  }
  return null;
}

/** The corners of the sheet in a photo (TL, TR, BR, BL, in the image's pixels), or null when the picture is the sheet already. */
export function findSheetQuad(g: Gray): { quad: Pt[] | null; why: string } {
  const long = Math.max(g.width, g.height);
  const k = Math.max(1, Math.floor(long / 600));
  const a = shrinkBy(g, k);
  const hist = histogram(a);
  const thr = otsu(hist, a.data.length);
  // a sheet on a darker surface: two clear populations. A scan has paper everywhere.
  let dark = 0; for (let t = 0; t <= thr; t++) dark += hist[t];
  let meanLo = 0, meanHi = 0, nLo = 0, nHi = 0;
  for (let t = 0; t < 256; t++) { if (t <= thr) { meanLo += t * hist[t]; nLo += hist[t]; } else { meanHi += t * hist[t]; nHi += hist[t]; } }
  meanLo = nLo ? meanLo / nLo : 0; meanHi = nHi ? meanHi / nHi : 255;
  if (dark / a.data.length < 0.03 || meanHi - meanLo < 50) return { quad: null, why: 'no dark surround: treated as a flat scan' };
  // a photo has the table around the sheet: the picture's edge is mostly dark. A scan's edge is paper.
  {
    const band = Math.max(2, Math.round(0.015 * Math.max(a.width, a.height))); let edge = 0, edgeDark = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (x >= band && x < a.width - band && y >= band && y < a.height - band) { x = Math.max(x, a.width - band - 1); continue; }
      edge++; if (a.data[y * a.width + x] <= thr) edgeDark++;
    }
    if (edgeDark / Math.max(1, edge) < 0.3) return { quad: null, why: 'paper to the edge of the picture: treated as a flat scan' };
  }
  // the largest bright component that is mostly paper (fills with dark ink do not matter: only the outline is used)
  const W = a.width, H = a.height;
  const lab = new Int32Array(W * H); let best = -1, bestN = 0, id = 0;
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (lab[i] || a.data[i] <= thr) continue;
    id++; let sp = 0, n = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const q = stack[--sp]; n++;
      const x = q % W, y = (q / W) | 0;
      if (x > 0 && !lab[q - 1] && a.data[q - 1] > thr) { lab[q - 1] = id; stack[sp++] = q - 1; }
      if (x < W - 1 && !lab[q + 1] && a.data[q + 1] > thr) { lab[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && !lab[q - W] && a.data[q - W] > thr) { lab[q - W] = id; stack[sp++] = q - W; }
      if (y < H - 1 && !lab[q + W] && a.data[q + W] > thr) { lab[q + W] = id; stack[sp++] = q + W; }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  if (best < 0 || bestN < 0.3 * W * H) return { quad: null, why: 'no sheet found' };
  const inside = (x: number, y: number): boolean => lab[y * W + x] === best;
  // boundary points of each side: topmost / bottommost per column, leftmost / rightmost per row, middle 60% of each side
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const top: Pt[] = [], bot: Pt[] = [], left: Pt[] = [], right: Pt[] = [];
  const cx0 = x0 + 0.2 * (x1 - x0), cx1 = x0 + 0.8 * (x1 - x0), cy0 = y0 + 0.2 * (y1 - y0), cy1 = y0 + 0.8 * (y1 - y0);
  for (let x = Math.ceil(cx0); x <= cx1; x++) {
    let t = -1, b = -1;
    for (let y = 0; y < H; y++) if (inside(x, y)) { if (t < 0) t = y; b = y; }
    if (t >= 0) { top.push([x, t]); bot.push([x, b + 1]); }
  }
  for (let y = Math.ceil(cy0); y <= cy1; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (inside(x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0) { left.push([y, l]); right.push([y, r + 1]); }
  }
  const T = fitLine(top), B = fitLine(bot), L = fitLine(left), R = fitLine(right);
  if (!T || !B || !L || !R) return { quad: null, why: 'sheet edges not straight' };
  // lines: top/bottom y = a + b x ; left/right x = a + b y. intersect.
  const hit = (h: { a: number; b: number }, v: { a: number; b: number }): Pt => {
    // y = h.a + h.b x ; x = v.a + v.b y  ->  y = h.a + h.b (v.a + v.b y)
    const y = (h.a + h.b * v.a) / (1 - h.b * v.b);
    return [v.a + v.b * y, y];
  };
  const q: Pt[] = [hit(T, L), hit(T, R), hit(B, R), hit(B, L)];
  const full = q.map((p): Pt => [(p[0] + 0.5) * k - 0.5, (p[1] + 0.5) * k - 0.5]);
  // sanity: convex, roughly rectangular, big enough
  const e = (i: number): number => Math.hypot(full[(i + 1) % 4][0] - full[i][0], full[(i + 1) % 4][1] - full[i][1]);
  const area = Math.abs(full.reduce((s, p, i) => s + p[0] * full[(i + 1) % 4][1] - full[(i + 1) % 4][0] * p[1], 0)) / 2;
  if (area < 0.3 * g.width * g.height) return { quad: null, why: 'sheet too small in the photo' };
  for (let i = 0; i < 4; i++) {
    const p = full[i], n = full[(i + 1) % 4], pr = full[(i + 3) % 4];
    const c = ((n[0] - p[0]) * (pr[0] - p[0]) + (n[1] - p[1]) * (pr[1] - p[1])) / (e(i) * e((i + 3) % 4));
    if (Math.abs(c) > 0.5) return { quad: null, why: 'sheet corners are not square enough' };
  }
  // already the whole picture: nothing to fix
  const corners: Pt[] = [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]];
  const slack = 0.012 * long;
  if (full.every((p, i) => Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]) < slack)) return { quad: null, why: 'sheet fills the picture' };
  return { quad: full, why: 'sheet found' };
}

const A_RATIO = Math.SQRT2;
/**
 * Width / height of the real sheet from its four corners in a photo (Zhang and He): the sheet is a rectangle, so two of its
 * sides are at right angles, which fixes the camera's focal length when the principal point is the picture's centre.
 * Null when the corners are not consistent with a camera.
 */
export function aspectFromQuad(quad: Pt[], w: number, h: number): number | null {
  const c = quad.map((p): Pt => [p[0] - w / 2, p[1] - h / 2]);
  let H: Mat3;
  try { H = homographyOf([[0, 0], [1, 0], [1, 1], [0, 1]], c); } catch { return null; }
  const h1 = [H[0], H[3], H[6]], h2 = [H[1], H[4], H[7]];
  const den = h1[2] * h2[2];
  if (Math.abs(den) < 1e-12) return null;
  const f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / den;
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  const n1 = Math.sqrt((h1[0] * h1[0] + h1[1] * h1[1]) / f2 + h1[2] * h1[2]), n2 = Math.sqrt((h2[0] * h2[0] + h2[1] * h2[1]) / f2 + h2[2] * h2[2]);
  const r = n1 / n2;
  return r > 0.4 && r < 2.5 ? r : null;
}
/** Flatten a photographed sheet to a rectangle. */
export function rectify(g: Gray, quad: Pt[]): { image: Gray; map: Mat3; aspect: number } {
  const d = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wAvg = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, hAvg = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  let r = aspectFromQuad(quad, g.width, g.height) ?? wAvg / hAvg;
  // a sheet of the ISO family is within a hair of the root-two ratio: snap when close
  const long = Math.max(r, 1 / r);
  if (Math.abs(long / A_RATIO - 1) < 0.03) r = r >= 1 ? A_RATIO : 1 / A_RATIO;
  const area = wAvg * hAvg;
  const W = Math.round(Math.sqrt(area * r)), H = Math.round(Math.sqrt(area / r));
  const map = homographyOf(quad, [[0, 0], [W, 0], [W, H], [0, H]]);
  return { image: warpGray(g, map, W, H, 255), map, aspect: r };
}

/** Divide by a paper estimate so shading and a lamp gradient do not decide what counts as ink. */
export function evenLighting(g: Gray): Gray {
  const k = Math.max(2, Math.floor(Math.max(g.width, g.height) / 160));
  const s = shrinkBy(g, k);
  const W = s.width, H = s.height;
  // max filter removes ink (thin on this scale), then a blur smooths the paper
  const mx = (src: Float32Array, r: number): Float32Array => {
    const t = new Float32Array(W * H), o = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W && src[y * W + xx] > m) m = src[y * W + xx]; } t[y * W + x] = m; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H && t[yy * W + x] > m) m = t[yy * W + x]; } o[y * W + x] = m; }
    return o;
  };
  const bl = (src: Float32Array, r: number): Float32Array => {
    const t = new Float32Array(W * H), o = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) { a += src[y * W + xx]; n++; } } t[y * W + x] = a / n; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) { a += t[yy * W + x]; n++; } } o[y * W + x] = a / n; }
    return o;
  };
  const f = Float32Array.from(s.data);
  const bg = bl(mx(f, 3), 3);
  const out = newGray(g.width, g.height);
  for (let y = 0; y < g.height; y++) {
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < g.width; x++) {
      const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      const b = (bg[y0 * W + x0] * (1 - tx) + bg[y0 * W + x1] * tx) * (1 - ty) + (bg[y1 * W + x0] * (1 - tx) + bg[y1 * W + x1] * tx) * ty;
      out.data[y * g.width + x] = Math.min(255, (g.data[y * g.width + x] / Math.max(60, b)) * 250);
    }
  }
  return out;
}

/** Tilt of the content in degrees (positive = clockwise as seen), searched within +-limit, or 0 when nothing beats upright. */
export function estimateSkew(g: Gray, limitDeg = 6): number {
  const long = Math.max(g.width, g.height);
  const k = Math.max(1, Math.floor(long / 900));
  const a = shrinkBy(g, k);
  const pts: number[] = [];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (a.data[y * a.width + x] < 120) pts.push(x, y);
  const n = pts.length / 2;
  if (n < 200) return 0;
  const stride = Math.max(1, Math.floor(n / 60000));
  const bins = Math.ceil(Math.hypot(a.width, a.height)) * 2 + 4;
  const score = (deg: number): number => {
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    const rows = new Float64Array(bins), cols = new Float64Array(bins); const off = bins / 2;
    for (let i = 0; i < n; i += stride) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      rows[Math.floor(y * c - x * s + off)]++; cols[Math.floor(x * c + y * s + off)]++;
    }
    let t = 0; for (let i = 0; i < bins; i++) t += rows[i] * rows[i] + cols[i] * cols[i];
    return t;
  };
  const base = score(0);
  let bestD = 0, bestS = base;
  for (let d = -limitDeg; d <= limitDeg + 1e-9; d += 0.25) { const v = score(d); if (v > bestS) { bestS = v; bestD = d; } }
  for (let d = bestD - 0.25; d <= bestD + 0.25 + 1e-9; d += 0.05) { const v = score(d); if (v > bestS) { bestS = v; bestD = d; } }
  if (Math.abs(bestD) < 0.12 || bestS < base * 1.03) return 0;
  return bestD;
}

/** The full clean-up. `maxSide` bounds the result (a model does not need more than the page's own detail). */
export function preprocess(g: Gray, opts: { maxSide?: number } = {}): Preprocessed {
  const steps: string[] = [];
  let image = g, toImage: Mat3 = IDENTITY, quad: Pt[] | null = null, deskewDeg = 0;
  const q = findSheetQuad(g);
  steps.push(q.why);
  if (q.quad) {
    const r = rectify(g, q.quad);
    image = r.image; toImage = r.map; quad = q.quad;
    steps.push(`perspective fixed (${image.width} x ${image.height})`);
  }
  image = evenLighting(image);
  steps.push('lighting evened');
  const sk = estimateSkew(image);
  if (sk !== 0) {
    const m = rotateMat((-sk * Math.PI) / 180, image.width / 2, image.height / 2);
    image = warpGray(image, m, image.width, image.height, 255);
    toImage = matMul(m, toImage); deskewDeg = sk;
    steps.push(`deskewed ${sk.toFixed(2)} degrees`);
  }
  const maxSide = opts.maxSide ?? 0;
  if (maxSide && Math.max(image.width, image.height) > maxSide) {
    const f = maxSide / Math.max(image.width, image.height);
    const r = resizeGray(image, Math.round(image.width * f), Math.round(image.height * f));
    image = r.image; toImage = matMul(r.map, toImage);
    steps.push(`reduced to ${image.width} x ${image.height}`);
  }
  return { image, toImage, steps, quad, deskewDeg };
}
