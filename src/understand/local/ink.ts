// Local raster path, pixels. Walls are the thick dark structures of a drawing, text is the thin dark marks, and a room is the space a
// ray from its label can travel before it meets a wall. Pure TypeScript on the grey image of the page; nothing here knows a drawing.
import type { Gray, Rect } from '../pixels/image';
import { newGray } from '../pixels/image';

export interface Comp { id: number; x0: number; y0: number; x1: number; y1: number; area: number }

/** Binary mask of pixels darker than `thr` (1 = ink). */
export function darkMask(g: Gray, thr: number): Uint8Array {
  const m = new Uint8Array(g.width * g.height);
  for (let i = 0; i < m.length; i++) m[i] = g.data[i] < thr ? 1 : 0;
  return m;
}

/** Separable box minimum then maximum: a binary opening by a k x k square (removes ink thinner than k in either direction). */
export function openSquare(m: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return m.slice();
  const run = (src: Uint8Array, horizontal: boolean, erode: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    const n = horizontal ? w : h, lines = horizontal ? h : w;
    const half = Math.floor(k / 2);
    for (let l = 0; l < lines; l++) {
      // sliding window count of ones over the line
      const idx = (p: number): number => (horizontal ? l * w + p : p * w + l);
      let cnt = 0;
      const lo0 = -half, hi0 = k - 1 - half;
      for (let p = 0; p < Math.min(n, hi0 + 1); p++) cnt += src[idx(p)];
      for (let p = 0; p < n; p++) {
        const lo = p + lo0, hi = p + hi0;
        if (p > 0) { if (hi < n) cnt += src[idx(hi)]; if (lo - 1 >= 0) cnt -= src[idx(lo - 1)]; }
        const win = Math.min(n - 1, hi) - Math.max(0, lo) + 1;
        out[idx(p)] = erode ? (cnt === k && win === k ? 1 : 0) : (cnt > 0 ? 1 : 0);
      }
    }
    return out;
  };
  const e = run(run(m, true, true), false, true);
  return run(run(e, true, false), false, false);
}

/** 4-connected components of a binary mask, with boxes and areas. `labels` holds each pixel's component id (0 = none). */
export function components(m: Uint8Array, w: number, h: number): { comps: Comp[]; labels: Int32Array } {
  const labels = new Int32Array(w * h);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || labels[s]) continue;
    const id = comps.length + 1;
    const c: Comp = { id, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    stack.push(s); labels[s] = id;
    while (stack.length) {
      const p = stack.pop()!; const x = p % w, y = (p - x) / w;
      c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && m[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && m[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && m[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && m[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
    }
    comps.push(c);
  }
  return { comps, labels };
}

/**
 * The page with only its text left: ink components that are small enough to be glyphs, black on white. Walls, furniture outlines and
 * large symbols are components far taller or wider than a line of text, so they are dropped.
 */
export function textLayer(g: Gray, opts: { thr?: number; maxSide?: number } = {}): { image: Gray; glyphs: Comp[] } {
  const thr = opts.thr ?? 120;
  const m = darkMask(g, thr);
  const { comps } = components(m, g.width, g.height);
  const maxSide = opts.maxSide ?? Math.max(24, Math.round(0.035 * Math.max(g.width, g.height)));
  const out = newGray(g.width, g.height, 255);
  const { labels } = components(m, g.width, g.height);
  const keep = new Set<number>(); const glyphs: Comp[] = [];
  for (const c of comps) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (w > maxSide || h > maxSide) continue;
    if (c.area < 4) continue;
    keep.add(c.id); glyphs.push(c);
  }
  for (let i = 0; i < labels.length; i++) if (labels[i] && keep.has(labels[i])) out.data[i] = 0;
  return { image: out, glyphs };
}

export type { Rect };

export interface TextBlock { rect: Rect; lines: Rect[]; glyphs: number; lineH: number }

/**
 * Glyph components grouped into lines (same baseline band, small gaps) and lines into blocks (stacked, overlapping along the line).
 * Boxes only: reading them is the OCR's job. A line of text is a run of at least two glyphs (or one tall one), so lone specks go.
 */
export function textBlocks(glyphs: Comp[], imgW: number, imgH: number, opts: { gap?: number } = {}): TextBlock[] {
  const GAP = opts.gap ?? 0.9;
  const gs = glyphs.filter((c) => { const h = c.y1 - c.y0 + 1, w = c.x1 - c.x0 + 1; return h >= 5 && h <= 0.04 * Math.max(imgW, imgH) && w <= 2.2 * h + 4; });
  if (!gs.length) return [];
  const hs = gs.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)];
  // line grouping: sort by x, union glyphs whose vertical centres are close and whose gap is small
  const parent = gs.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
  const order = gs.map((_, i) => i).sort((a, b) => gs[a].x0 - gs[b].x0);
  for (let oi = 0; oi < order.length; oi++) {
    const a = gs[order[oi]]; const ha = a.y1 - a.y0 + 1;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const b = gs[order[oj]];
      const gap = b.x0 - a.x1;
      if (gap > GAP * Math.max(ha, medH)) { if (b.x0 - a.x1 > 3 * medH + GAP * medH) break; continue; }
      const hb = b.y1 - b.y0 + 1; const k = Math.max(ha, hb);
      const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      // dots, quotes and punctuation sit anywhere in the band: accept overlap with the taller one's band
      if (ov >= 0.35 * Math.min(ha, hb) && Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) <= 0.8 * k) parent[find(order[oi])] = find(order[oj]);
    }
  }
  const lineMap = new Map<number, number[]>();
  gs.forEach((_, i) => { const r = find(i); (lineMap.get(r) ?? lineMap.set(r, []).get(r)!).push(i); });
  const lines: { rect: Rect; n: number; h: number }[] = [];
  for (const ids of lineMap.values()) {
    const cs = ids.map((i) => gs[i]);
    const rect: Rect = [Math.min(...cs.map((c) => c.x0)), Math.min(...cs.map((c) => c.y0)), Math.max(...cs.map((c) => c.x1)) + 1, Math.max(...cs.map((c) => c.y1)) + 1];
    const tall = cs.filter((c) => c.y1 - c.y0 + 1 >= 0.7 * medH).length;
    if (cs.length < 2 || tall < 1) continue;
    lines.push({ rect, n: cs.length, h: rect[3] - rect[1] });
  }
  // lines into blocks: next line below, similar height, overlapping horizontally
  const lp = lines.map((_, i) => i);
  const lf = (i: number): number => { while (lp[i] !== i) { lp[i] = lp[lp[i]]; i = lp[i]; } return lp[i]; };
  for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
    if (i === j) continue;
    const A = lines[i].rect, B = lines[j].rect; const h = Math.max(lines[i].h, lines[j].h);
    const gapY = B[1] - A[3];
    if (gapY < -0.3 * h || gapY > 0.9 * h) continue;
    if (Math.max(lines[i].h, lines[j].h) > 1.8 * Math.min(lines[i].h, lines[j].h)) continue;
    const cxA = (A[0] + A[2]) / 2, cxB = (B[0] + B[2]) / 2;
    if (Math.abs(cxA - cxB) > 0.6 * Math.max(A[2] - A[0], B[2] - B[0]) + h) continue;
    lp[lf(i)] = lf(j);
  }
  const bm = new Map<number, number[]>();
  lines.forEach((_, i) => { const r = lf(i); (bm.get(r) ?? bm.set(r, []).get(r)!).push(i); });
  const out: TextBlock[] = [];
  for (const ids of bm.values()) {
    const ls = ids.map((i) => lines[i]).sort((a, b) => a.rect[1] - b.rect[1]);
    out.push({ rect: [Math.min(...ls.map((l) => l.rect[0])), Math.min(...ls.map((l) => l.rect[1])), Math.max(...ls.map((l) => l.rect[2])), Math.max(...ls.map((l) => l.rect[3]))], lines: ls.map((l) => l.rect), glyphs: ls.reduce((a, l) => a + l.n, 0), lineH: ls.reduce((a, l) => a + l.h, 0) / ls.length });
  }
  return out;
}

/**
 * Walls: the thick dark structures. Thin ink (text, furniture, door arcs, dimension lines) is opened away. Walls are drawn in many greys
 * (black, a mid grey, a dark brown), so the threshold is found from the picture: as it rises, the thick ink grows in a jump when the walls
 * come in, then flattens (the plateau), then grows again when floor fills do. The first plateau above 2% of the page is the walls.
 */
export function wallLayer(g: Gray, opts: { thr?: number; k?: number } = {}): { mask: Uint8Array; k: number; thr: number } {
  const k = opts.k ?? Math.max(3, Math.round(0.0036 * Math.max(g.width, g.height)));
  const area = (m: Uint8Array): number => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n / m.length; };
  let thr = opts.thr ?? 0;
  if (!thr) {
    const ts: number[] = []; for (let t = 80; t <= 200; t += 10) ts.push(t);
    const as = ts.map((t) => area(openSquare(darkMask(g, t), g.width, g.height, k)));
    thr = 140;
    for (let i = 0; i + 1 < ts.length; i++) if (as[i] >= 0.02 && as[i + 1] / as[i] < 1.08) { thr = ts[i]; break; }
  }
  return { mask: openSquare(darkMask(g, thr), g.width, g.height, k), k, thr };
}

export interface Spans { left: number | null; right: number | null; up: number | null; down: number | null; hits: { l: number; r: number; u: number; d: number }; samples: number }
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The wall face most hits agree on (within `tol` pixels), needing `need` hits in the cluster; ties go to the nearer one. */
function modeFace(hits: number[], from: number, tol: number, need: number, nearest = false): number | null {
  if (hits.length < need) return null;
  let best: { n: number; at: number; d: number } | null = null;
  for (const h of hits) {
    const grp = hits.filter((x) => Math.abs(x - h) <= tol);
    if (grp.length < need) continue;
    const at = median(grp), d = Math.abs(at - from);
    if (!best || (nearest ? d < best.d : grp.length > best.n || (grp.length === best.n && d < best.d))) best = { n: grp.length, at, d };
  }
  return best ? best.at : null;
}

/**
 * Where the walls around a label are. A first look through the label itself gives a rough room; then rows across the room's whole height
 * (columns across its width) hit the left and right (top and bottom) walls many times, and the face most of them agree on is the wall.
 * A window or a door leaves a gap in a wall, so those rows hit something farther off and are outvoted. A side with no cluster is null.
 */
export function roomSpans(mask: Uint8Array, w: number, h: number, centre: [number, number], step: number, cap: number, n = 21): Spans {
  const [cx, cy] = [Math.round(centre[0]), Math.round(centre[1])];
  const hit = (axis: 'x' | 'y', dir: -1 | 1, fixed: number): number | null => {
    if (axis === 'x') { // scan along a row
      if (fixed < 0 || fixed >= h) return null;
      for (let x = cx; x >= 0 && x <= w - 1 && Math.abs(x - cx) <= cap; x += dir) if (mask[fixed * w + x]) return dir < 0 ? x + 1 : x;
    } else {
      if (fixed < 0 || fixed >= w) return null;
      for (let y = cy; y >= 0 && y <= h - 1 && Math.abs(y - cy) <= cap; y += dir) if (mask[y * w + fixed]) return dir < 0 ? y + 1 : y;
    }
    return null;
  };
  const collect = (offsets: number[]): { L: number[]; R: number[]; U: number[]; D: number[] } => {
    const L: number[] = [], R: number[] = [], U: number[] = [], D: number[] = [];
    for (const o of offsets) {
      const l = hit('x', -1, cy + o), r = hit('x', 1, cy + o), u = hit('y', -1, cx + o), d = hit('y', 1, cx + o);
      if (l !== null) L.push(l); if (r !== null) R.push(r); if (u !== null) U.push(u); if (d !== null) D.push(d);
    }
    return { L, R, U, D };
  };
  // look 1: rough, through the label
  const near = Array.from({ length: 9 }, (_, j) => (j - 4) * step);
  const a = collect(near);
  // the nearest wall that two of the nine looks agree on (a far wall seen through a door or window is not the room's)
  const nearest = (hs: number[], dflt: number): number => { const f = modeFace(hs, dflt > 0 ? 0 : 0, 2.5, 2, true); return f ?? dflt; };
  const rough = { l: nearest(a.L.map((v) => cx - v), cap / 4) * -1 + cx, r: nearest(a.R.map((v) => v - cx), cap / 4) + cx, u: nearest(a.U.map((v) => cy - v), cap / 4) * -1 + cy, d: nearest(a.D.map((v) => v - cy), cap / 4) + cy };
  // look 2: across the room (rows over its height for the side walls, columns over its width for the top and bottom)
  const rowsH = Math.max(0, (rough.d - rough.u) / 2 - 3 * step), colsH = Math.max(0, (rough.r - rough.l) / 2 - 3 * step);
  const rows = Array.from({ length: n }, (_, j) => ((j / (n - 1)) * 2 - 1) * rowsH + ((rough.u + rough.d) / 2 - cy));
  const cols = Array.from({ length: n }, (_, j) => ((j / (n - 1)) * 2 - 1) * colsH + ((rough.l + rough.r) / 2 - cx));
  const L: number[] = [], R: number[] = [], U: number[] = [], D: number[] = [];
  for (const o of rows) { const l = hit('x', -1, cy + Math.round(o)), r = hit('x', 1, cy + Math.round(o)); if (l !== null) L.push(l); if (r !== null) R.push(r); }
  for (const o of cols) { const u = hit('y', -1, cx + Math.round(o)), d = hit('y', 1, cx + Math.round(o)); if (u !== null) U.push(u); if (d !== null) D.push(d); }
  if (process.env.WT_DEBUG) console.log('rough', rough, 'L', L.map(Math.round).join(','), 'R', R.map(Math.round).join(','));
  const need = Math.max(3, Math.ceil(0.22 * n)), tol = 2.5;
  return { left: modeFace(L, cx, tol, need), right: modeFace(R, cx, tol, need), up: modeFace(U, cy, tol, need), down: modeFace(D, cy, tol, need), hits: { l: L.length, r: R.length, u: U.length, d: D.length }, samples: n };
}
