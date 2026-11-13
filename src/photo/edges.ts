// C12f. SPEC 17.14: the size sanity check. Edge maps of the rendered frame and of the model's picture, then the three tests:
// an image edge within 1.5% of the diagonal of every sampled edge point (80% per item, 85% overall), and the two edge maps
// agreeing (mean nearest-edge distance under 1% of the diagonal). Pure: works on pixel arrays, so it runs under Node.
//
// One addition to the spec's wording, to keep the test meaningful on a textured photograph: the image edge near a sampled
// point must also run in about the same direction as the projected edge (within 25 degrees). Without it, the busy edges of
// a real photograph would satisfy a 1.5% window almost anywhere.
import type { SamplePoint } from './geometry';
import { isItemGroup } from './geometry';

export interface Gray { w: number; h: number; data: Float32Array }

export const CHECK = {
  /** analysis size, long side in pixels */ longSide: 384,
  /** window around a point, fraction of the diagonal */ nearFrac: 0.015,
  /** share of points needing an edge, per item */ perItem: 0.8,
  /** share of points needing an edge, overall */ overall: 0.85,
  /** mean nearest-edge distance of the frame's edges to the picture's, fraction of the diagonal */ meanFrac: 0.01,
  /** direction tolerance */ angRad: (25 * Math.PI) / 180,
  /** an item with fewer samples than this is judged only inside the overall figure */ minItemPoints: 8,
  /** fewer checkable points than this and the view cannot be checked at all */ minPoints: 30,
  /** edge pixels are at most this share of the image */ maxDensity: 0.06,
  /** the output's aspect must match the frame's within this */ aspectTol: 0.02,
} as const;

export function lumaOf(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data };
}

/** Box-filter resize to exactly w x h (nearest when it has to grow, which only happens for an unusually small answer). */
export function resizeTo(g: Gray, w: number, h: number): Gray {
  if (g.w === w && g.h === h) return g;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(g.h - 1, Math.floor((y * g.h) / h)), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * g.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(g.w - 1, Math.floor((x * g.w) / w)), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * g.w) / w));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g.data[yy * g.w + xx];
      data[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return { w, h, data };
}

/** Shrink so that the long side is `longSide` (no growth). */
export function shrink(g: Gray, longSide: number): Gray {
  const k = Math.max(g.w, g.h) / longSide;
  if (k <= 1) return g;
  return resizeTo(g, Math.max(1, Math.round(g.w / k)), Math.max(1, Math.round(g.h / k)));
}

export interface EdgeMap { w: number; h: number; edge: Uint8Array; /** edge direction, radians in [0, PI) */ ang: Float32Array; count: number }

/** Sobel on a lightly blurred copy, thinned along the gradient, thresholded relative to the strong edges and capped in density. */
export function edgeMap(g: Gray): EdgeMap {
  const { w, h } = g;
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += g.data[yy * w + xx]; n++;
    }
    b[y * w + x] = s / n;
  }
  const mag = new Float32Array(w * h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const a = b[i - w - 1], bb = b[i - w], c = b[i - w + 1], d = b[i - 1], f = b[i + 1], gg = b[i + w - 1], hh = b[i + w], ii = b[i + w + 1];
    const sx = (c + 2 * f + ii) - (a + 2 * d + gg);
    const sy = (gg + 2 * hh + ii) - (a + 2 * bb + c);
    gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
  }
  // thin: keep a pixel only when it is a local maximum across the edge
  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const m = mag[i];
    if (m <= 0) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    let o1: number, o2: number;
    if (ay <= ax * 0.4142) { o1 = i - 1; o2 = i + 1; }
    else if (ay >= ax * 2.4142) { o1 = i - w; o2 = i + w; }
    else if (gx[i] * gy[i] > 0) { o1 = i - w - 1; o2 = i + w + 1; }
    else { o1 = i - w + 1; o2 = i + w - 1; }
    if (m >= mag[o1] && m >= mag[o2]) thin[i] = m;
  }
  const vals = Array.from(thin).filter((v) => v > 0).sort((p, q) => p - q);
  if (vals.length === 0) return { w, h, edge: new Uint8Array(w * h), ang: new Float32Array(w * h), count: 0 };
  const p99 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.99))];
  let thr = Math.max(24, 0.1 * p99);
  const cap = Math.floor(CHECK.maxDensity * w * h);
  const above = vals.length - vals.findIndex((v) => v >= thr);
  if (vals.findIndex((v) => v >= thr) >= 0 && above > cap) thr = Math.max(thr, vals[vals.length - cap]);
  const edge = new Uint8Array(w * h);
  const ang = new Float32Array(w * h);
  let count = 0;
  for (let i = 0; i < edge.length; i++) {
    if (thin[i] >= thr) {
      edge[i] = 1; count++;
      ang[i] = (((Math.atan2(gy[i], gx[i]) + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI;
    }
  }
  return { w, h, edge, ang, count };
}

/** Distance (pixels) from every pixel to the nearest edge pixel; chamfer 3-4 in two passes. Infinity when there are no edges. */
export function distanceField(em: EdgeMap): Float32Array {
  const { w, h } = em;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = em.edge[i] ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 1);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 1.4142);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.4142);
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 1);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.4142);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 1.4142);
    }
    d[i] = v;
  }
  return d;
}

const angDiff = (a: number, b: number): number => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };

/** Is there an edge pixel within `r` pixels of (x, y) that runs along `ang`? */
function edgeNear(em: EdgeMap, x: number, y: number, r: number, ang: number): boolean {
  const xi = Math.round(x), yi = Math.round(y);
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    const yy = yi + dy;
    if (yy < 0 || yy >= em.h) continue;
    for (let dx = -ri; dx <= ri; dx++) {
      const xx = xi + dx;
      if (xx < 0 || xx >= em.w || dx * dx + dy * dy > r * r) continue;
      const i = yy * em.w + xx;
      if (em.edge[i] && angDiff(em.ang[i], ang) <= CHECK.angRad) return true;
    }
  }
  return false;
}

export interface GroupResult { group: string; n: number; hit: number; share: number; judged: boolean; ok: boolean }
export interface CheckResult {
  ok: boolean;
  reason: 'ok' | 'aspect' | 'few-points' | 'item' | 'overall' | 'edge-maps';
  overallShare: number;
  meanDistFrac: number;
  groups: GroupResult[];
  /** sampled points, and how many of them sit on an edge that the frame itself shows (only those are judged) */
  total?: number; usable?: number;
  /** the group that failed, when `reason` is 'item' */ failedGroup?: string;
}

/**
 * `points` are in the pixels of `frame`. `output` must have the same aspect ratio (the capture was cropped to an aspect the
 * model returns, so a differing one means it moved the framing).
 */
export function checkFaithful(frame: Gray, output: Gray, points: SamplePoint[]): CheckResult {
  const none = (reason: CheckResult['reason']): CheckResult => ({ ok: false, reason, overallShare: 0, meanDistFrac: Infinity, groups: [] });
  if (Math.abs(output.w / output.h / (frame.w / frame.h) - 1) > CHECK.aspectTol) return none('aspect');
  if (points.length < CHECK.minPoints) return none('few-points');
  const a = shrink(frame, CHECK.longSide);
  const k = a.w / frame.w;
  const sized = resizeTo(output, a.w, a.h);
  const ea = edgeMap(a);
  const eo = edgeMap(sized);
  const diag = Math.hypot(a.w, a.h);
  const r = CHECK.nearFrac * diag;

  // Only points where the frame itself shows an edge can say anything: a wall corner between two walls of the same tone is
  // invisible in the render too, and asking the picture to show it would fail faithful photographs.
  const sy = a.h / frame.h;
  const usable = points.filter((p) => edgeNear(ea, p.x * k, p.y * sy, r, p.ang));
  if (usable.length < CHECK.minPoints) return { ...none('few-points'), usable: usable.length, total: points.length };

  const by = new Map<string, { n: number; hit: number }>();
  let hits = 0;
  for (const p of usable) {
    const ok = edgeNear(eo, p.x * k, p.y * sy, r, p.ang);
    const g = by.get(p.group) ?? { n: 0, hit: 0 };
    g.n++; if (ok) g.hit++;
    by.set(p.group, g);
    if (ok) hits++;
  }
  const groups: GroupResult[] = [...by.entries()].map(([group, g]) => {
    const judged = isItemGroup(group) && g.n >= CHECK.minItemPoints;
    const share = g.hit / g.n;
    return { group, n: g.n, hit: g.hit, share, judged, ok: !judged || share >= CHECK.perItem };
  });
  const overallShare = hits / usable.length;

  // the two edge maps: how far the frame's edges are from the nearest edge in the picture
  const field = eo.count > 0 ? distanceField(eo) : null;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < ea.edge.length; i++) if (ea.edge[i]) { sum += field ? field[i] : diag; cnt++; }
  const meanDistFrac = cnt === 0 ? Infinity : sum / cnt / diag;

  const bad = groups.find((g) => !g.ok);
  let reason: CheckResult['reason'] = 'ok';
  if (bad) reason = 'item';
  else if (overallShare < CHECK.overall) reason = 'overall';
  else if (!(meanDistFrac < CHECK.meanFrac)) reason = 'edge-maps';
  return { ok: reason === 'ok', reason, overallShare, meanDistFrac, groups, total: points.length, usable: usable.length, failedGroup: bad?.group };
}
