// C12d. SPEC 17.8: "walls come from the model's room boxes and corner points, refined by snapping to dark line pixels in the
// image". The model gives a rough box; the pixels give the wall faces. A box with no wall under most of its edges is a room
// the model made up and is dropped. Dimension-line end points are snapped to the end marks the same way.
// Works in the pixels of the cleaned page. Pure TypeScript.
import type { Gray, Pt } from './image';

export class InkMap {
  readonly w: number; readonly h: number; private I: Int32Array; readonly g: Gray;
  constructor(g: Gray, thr = 195) {
    this.g = g; this.w = g.width; this.h = g.height;
    this.I = new Int32Array((g.width + 1) * (g.height + 1));
    const W1 = g.width + 1;
    for (let y = 0; y < g.height; y++) {
      let row = 0;
      for (let x = 0; x < g.width; x++) { row += g.data[y * g.width + x] < thr ? 1 : 0; this.I[(y + 1) * W1 + x + 1] = this.I[y * W1 + x + 1] + row; }
    }
  }
  /** ink pixels in [x0, x1) x [y0, y1) */
  count(x0: number, y0: number, x1: number, y1: number): number {
    const W1 = this.w + 1;
    const a = Math.max(0, Math.min(this.w, Math.round(x0))), b = Math.max(0, Math.min(this.w, Math.round(x1)));
    const c = Math.max(0, Math.min(this.h, Math.round(y0))), d = Math.max(0, Math.min(this.h, Math.round(y1)));
    if (b <= a || d <= c) return 0;
    return this.I[d * W1 + b] - this.I[c * W1 + b] - this.I[d * W1 + a] + this.I[c * W1 + a];
  }
}

/**
 * Sub-pixel position of a solid wall's face: on every row of the span where the wall is present, where the grey level crosses
 * halfway between the wall and the paper, then the median over rows. A pixel threshold alone sits about a pixel too far in.
 */
function refineFace(ink: InkMap, axis: 'v' | 'h', face: number, inward: 1 | -1, a: number, b: number): number | null {
  const g = ink.g; const f = Math.round(face);
  const at = (line: number, p: number): number => (axis === 'v' ? g.data[line * g.width + p] : g.data[p * g.width + line]);
  const lim = axis === 'v' ? g.width : g.height;
  const ts: number[] = [];
  for (let line = Math.ceil(a); line < Math.floor(b); line++) {
    const deep = f - 2 * inward, out = f + 3 * inward;
    if (deep < 0 || deep >= lim || out < 0 || out >= lim) continue;
    const W = at(line, deep), P = at(line, out);
    if (W > 150 || P < 215) continue; // no wall under this row, or something else beside it
    const L = (W + P) / 2;
    for (let p = f - 2 * inward; p !== f + 3 * inward; p += inward) {
      const v0 = at(line, p), v1 = at(line, p + inward);
      if (v0 <= L && v1 > L) { ts.push(p + 0.5 + inward * ((L - v0) / (v1 - v0))); break; }
    }
  }
  if (ts.length < 5) return null;
  ts.sort((x, y) => x - y);
  return ts[Math.floor(ts.length / 2)];
}
export interface EdgeSnap { pos: number; found: boolean; cover: number; thick: number }
/**
 * One axis-aligned wall edge. `axis` 'v' = a vertical edge at x = pos spanning y in [lo, hi]; 'h' = horizontal at y = pos.
 * `inward` is +1 when the room is on the larger-coordinate side, so the room face is the band's inner side.
 * Returns the position of the wall FACE nearest the guess, within +-win pixels.
 */
export function snapEdge(ink: InkMap, axis: 'v' | 'h', pos: number, lo: number, hi: number, inward: 1 | -1, win: number): EdgeSnap {
  const L = hi - lo, a = lo + 0.15 * L, b = hi - 0.15 * L;
  if (b - a < 4) return { pos, found: false, cover: 0, thick: 0 };
  const n = Math.ceil(win);
  // coverage: fraction of the span with ink in a 1 px strip, for every offset in the window
  const strip = (p: number): number => (axis === 'v' ? ink.count(p, a, p + 1, b) : ink.count(a, p, b, p + 1)) / (b - a);
  const c1: number[] = [];
  for (let d = -n; d <= n; d++) c1.push(strip(Math.round(pos) + d));
  // a wall with a window or a door in it covers only part of the span, so the bar is low; nearness and thickness decide between bands
  const TH = 0.2;
  type Band = { s: number; e: number; mean: number };
  const bands: Band[] = [];
  for (let i = 0; i < c1.length;) {
    if (c1[i] < TH) { i++; continue; }
    let j = i; while (j < c1.length && c1[j] >= TH) j++;
    // split a run where one strip dips well below both neighbours (a gap between a wall and a wardrobe drawn beside it)
    let from = i;
    for (let k = i + 1; k < j - 1; k++) {
      if (c1[k] <= 0.6 * c1[k - 1] && c1[k] <= 0.6 * c1[k + 1]) { bands.push(mkBand(from, k - 1)); from = k + 1; }
    }
    bands.push(mkBand(from, j - 1));
    i = j;
  }
  function mkBand(i0: number, i1: number): Band {
    // trim the room side while the strip is clearly weaker than the band's core (furniture touching the wall)
    let lo = i0, hi = i1;
    const core = Math.max(...c1.slice(i0, i1 + 1));
    if (inward === 1) while (hi > lo && c1[hi] < 0.65 * core) hi--; else while (lo < hi && c1[lo] < 0.65 * core) lo++;
    // (the wall side end is left alone: only the room side face matters)
    let sum = 0; for (let k = lo; k <= hi; k++) sum += c1[k];
    return { s: lo - n, e: hi - n, mean: sum / (hi - lo + 1) };
  }
  if (!bands.length) return { pos, found: false, cover: 0, thick: 0 };
  const T = 4;
  const scored = bands.map((bd) => {
    const thick = bd.e - bd.s + 1;
    const face = inward === 1 ? bd.e + 1 : bd.s; // the side of the band the room sees
    const dist = Math.abs(face);
    // nearness matters most: the model's box is close to the wall it means, and a thick wall further off is another room's
    return { bd, thick, face, score: (bd.mean * (1 + 0.3 * Math.min(thick, T))) / (1 + (dist / Math.max(2, win * 0.4)) ** 2) };
  });
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  // two thin lines (a double wall): the room side one is the face
  const solid = scored.filter((s) => s.thick >= 3);
  let pick = best;
  if (best.thick < 3 && !solid.length) {
    const near = scored.filter((s) => s.score >= 0.7 * best.score);
    pick = near.sort((x, y) => (inward === 1 ? y.face - x.face : x.face - y.face))[0];
  }
  const base = Math.round(pos);
  let face = base + pick.face;
  if (pick.thick >= 3) face = refineFace(ink, axis, face, inward, a, b) ?? face;
  else face = base + (pick.bd.s + pick.bd.e + 1) / 2; // a drawn line: the wall face is the middle of the stroke
  return { pos: face, found: true, cover: pick.bd.mean, thick: pick.thick };
}

const polyArea2 = (p: Pt[]): number => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const inside = (p: Pt[], q: Pt): boolean => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > q[1]) !== (p[j][1] > q[1]) && q[0] < ((p[j][0] - p[i][0]) * (q[1] - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; };

export interface PolySnap { polygon: Pt[]; edgesFound: number; edges: number; skipped: number }
/** Snap every axis-aligned edge of a rectilinear polygon to the wall face under it. Other edges are left as the model drew them. */
export function snapPolygon(ink: InkMap, poly: Pt[], win: number): PolySnap {
  const n = poly.length;
  const newX = poly.map((p) => p[0]), newY = poly.map((p) => p[1]);
  const orient = Math.sign(polyArea2(poly)) || 1;
  void orient;
  let found = 0, skipped = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const vertical = Math.abs(dx) < 1e-6 && Math.abs(dy) > 0, horizontal = Math.abs(dy) < 1e-6 && Math.abs(dx) > 0;
    if (!vertical && !horizontal) { skipped++; continue; }
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (vertical) {
      const toRight = inside(poly, [mid[0] + 3, mid[1]]);
      const r = snapEdge(ink, 'v', p[0], Math.min(p[1], q[1]), Math.max(p[1], q[1]), toRight ? 1 : -1, win);
      if (r.found) { found++; newX[i] = r.pos; newX[(i + 1) % n] = r.pos; }
    } else {
      const toDown = inside(poly, [mid[0], mid[1] + 3]);
      const r = snapEdge(ink, 'h', p[1], Math.min(p[0], q[0]), Math.max(p[0], q[0]), toDown ? 1 : -1, win);
      if (r.found) { found++; newY[i] = r.pos; newY[(i + 1) % n] = r.pos; }
    }
  }
  return { polygon: poly.map((_, i): Pt => [newX[i], newY[i]]), edgesFound: found, edges: n - skipped, skipped };
}

export interface EndSnap { a: Pt; b: Pt; ok: boolean }
/**
 * Snap the ends of an axis-aligned dimension line to the end marks near them. An end mark (tick, arrow, dot, extension line)
 * crosses the line, so it has ink on BOTH sides of it; text sits on one side only. The strength at a position is the smaller
 * of the two sides. The nearest strong peak to each guess wins.
 */
export function snapDimensionLine(ink: InkMap, a: Pt, b: Pt, win: number, half: number): EndSnap {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const horiz = Math.abs(dy) <= 0.3 * Math.abs(dx), vert = Math.abs(dx) <= 0.3 * Math.abs(dy);
  if (!horiz && !vert) return { a, b, ok: false };
  const along = horiz ? 0 : 1, perp = horiz ? 1 : 0;
  // the dimension line itself: the strip along the middle 60% of the span with the most ink, near the model's guess
  const guessAt = (a[perp] + b[perp]) / 2;
  const s0 = Math.min(a[along], b[along]), s1 = Math.max(a[along], b[along]);
  const m0 = s0 + 0.2 * (s1 - s0), m1 = s1 - 0.2 * (s1 - s0);
  if (m1 - m0 < 3) return { a, b, ok: false };
  const run = (p: number): number => (horiz ? ink.count(m0, p, m1, p + 1) : ink.count(p, m0, p + 1, m1)) / (m1 - m0);
  let lineAt = guessAt, lineCov = 0;
  for (let p = Math.round(guessAt) - Math.ceil(win); p <= Math.round(guessAt) + Math.ceil(win); p++) {
    const c = run(p);
    if (c > lineCov + 1e-9 || (Math.abs(c - lineCov) < 1e-9 && Math.abs(p - guessAt) < Math.abs(lineAt - 0.5 - guessAt))) { lineCov = c; lineAt = p + 0.5; }
  }
  if (lineCov < 0.5) return { a, b, ok: false };
  const lo = Math.round(lineAt - 1.5), hi = Math.round(lineAt + 1.5);
  const side = (t: number, from: number, to: number): number => (horiz ? ink.count(t, from, t + 1, to) : ink.count(from, t, to, t + 1));
  const f = (t: number): number => Math.min(side(t, lo - Math.round(half), lo), side(t, hi, hi + Math.round(half)));
  const one = (guess: number): number | null => {
    const g = Math.round(guess), w = Math.ceil(win);
    const vals: number[] = []; for (let t = g - w - 1; t <= g + w + 1; t++) vals.push(f(t));
    let best: { t: number; d: number; v: number } | null = null;
    for (let i = 1; i < vals.length - 1; i++) {
      const v = vals[i];
      if (v < 2 || v < vals[i - 1] || v < vals[i + 1]) continue;
      const t = g - w - 1 + i, d = Math.abs(t - g);
      if (!best || d < best.d || (d === best.d && v > best.v)) best = { t, d, v };
    }
    if (!best) return null;
    // centre of the plateau of positions nearly as strong (a thick tick or a dot)
    let s0 = 0, e0 = 0;
    for (let t = best.t; t >= best.t - 5 && f(t) >= 0.6 * best.v; t--) s0 = best.t - t;
    for (let t = best.t; t <= best.t + 5 && f(t) >= 0.6 * best.v; t++) e0 = t - best.t;
    return best.t + (e0 - s0) / 2 + 0.5;
  };
  const sa = one(a[along]), sb = one(b[along]);
  if (sa === null || sb === null || Math.abs(sb - sa) < 4) return { a, b, ok: false };
  const A: Pt = horiz ? [sa, lineAt] : [lineAt, sa], B: Pt = horiz ? [sb, lineAt] : [lineAt, sb];
  return { a: A, b: B, ok: true };
}
