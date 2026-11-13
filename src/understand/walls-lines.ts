// C12c. Walls drawn as lines: double-line walls (two parallel faces, nothing between), hatched walls (two faces and diagonal
// hatching), and any mix of those with filled walls. C8 only knows filled walls, so a drawing in either line style found no
// walls and therefore no rooms (SPEC 17.4 and 17.10 "Wall style"). Nothing here depends on one drawing: the wall thickness is
// whatever pair spacing carries the most paired length, in page units, and the pen weight of the walls is whatever those pairs
// are drawn with (cut lines are the heavy class of every drawing; windows, furniture and dimensions are lighter).
//
// The result is a page the unchanged C8 wall, gap, region and opening code can read: each band between a pair of faces becomes a
// filled rectangle, and the strokes that drew the band (faces, end caps, hatching) are taken out of the stroke list so nothing
// downstream mistakes them for furniture, barriers or window lines. Pure TypeScript, y-down page units.
import type { Px } from '../types';
import type { VFill, VStroke, VectorPage } from '../import/types';
import type { WallSet } from '../import/walls';
import { Bitmap, FREE, WALL } from '../import/bitmap';
import { bridgeGaps } from '../import/walls';

export const LINE_WALL_COLOR = 'line-walls';
const D2R = Math.PI / 180;

export interface Band {
  /** corners in the page frame */ ring: Px[];
  /** thickness, page units */ t: number;
  /** direction of the long side: true = along x of the levelled frame */ h: boolean;
  lo: number; hi: number; c0: number; c1: number;
  /** a hatch (diagonal strokes) lies inside */ hatched: boolean;
}
export interface LineWalls {
  /** the page with the bands added as fills and the strokes that drew them removed */
  page: VectorPage;
  bands: Band[];
  /** the wall thicknesses found, page units, strongest first */
  thicknessPt: number[];
  style: 'double' | 'hatch' | 'mixed-with-fill';
  /** strokes removed from the page */ consumed: number;
  /** pen weight of the walls */ weightPt: number;
}

interface Seg { h: boolean; c: number; lo: number; hi: number; w: number; stroke: number; edge: number; len: number }
interface Line { h: boolean; c: number; lo: number; hi: number; w: number; segs: number[] }
interface Pair { i: number; j: number; d: number; lo: number; hi: number; w: number; len: number }

const rotPt = (p: Px, a: number): Px => ({ x: Math.cos(a) * p.x + Math.sin(a) * p.y, y: -Math.sin(a) * p.x + Math.cos(a) * p.y });

/** Dominant direction of the long straight strokes, radians in [-pi/4, pi/4); snapped to 0 when within a degree and a half. */
function dominantAngle(page: VectorPage): number {
  const hist = new Array(90).fill(0);
  for (const s of page.strokes) {
    if (s.hasCurve) continue;
    const P = s.points;
    const n = s.closed ? P.length : P.length - 1;
    for (let k = 0; k < n; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 12) continue;
      let ang = (Math.atan2(b.y - a.y, b.x - a.x) / D2R) % 90;
      if (ang < 0) ang += 90;
      hist[Math.min(89, Math.round(ang) % 90)] += L;
    }
  }
  let bi = 0;
  for (let i = 1; i < 90; i++) if (hist[i] > hist[bi]) bi = i;
  let d = bi; if (d > 45) d -= 90;
  return Math.abs(d) <= 1.5 ? 0 : d * D2R;
}

function segsOf(page: VectorPage, ang: number): { segs: Seg[]; diag: { stroke: number; edge: number; a: Px; b: Px; w: number }[] } {
  const segs: Seg[] = []; const diag: { stroke: number; edge: number; a: Px; b: Px; w: number }[] = [];
  const tol = Math.tan(2 * D2R);
  page.strokes.forEach((s, si) => {
    if (s.hasCurve) return;
    const P = s.points.map((p) => (ang ? rotPt(p, ang) : p));
    const n = s.closed ? P.length : P.length - 1;
    for (let k = 0; k < n; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      if (Math.abs(dy) <= tol * Math.abs(dx)) segs.push({ h: true, c: (a.y + b.y) / 2, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), w: s.width, stroke: si, edge: k, len: L });
      else if (Math.abs(dx) <= tol * Math.abs(dy)) segs.push({ h: false, c: (a.x + b.x) / 2, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), w: s.width, stroke: si, edge: k, len: L });
      else diag.push({ stroke: si, edge: k, a, b, w: s.width });
    }
  });
  return { segs, diag };
}

/** Collinear segments that touch or overlap become one line. */
function mergeLines(segs: Seg[]): Line[] {
  const out: Line[] = [];
  for (const h of [true, false]) {
    const list = segs.map((s, i) => ({ s, i })).filter((x) => x.s.h === h).sort((p, q) => p.s.c - q.s.c);
    const groups: { s: Seg; i: number }[][] = [];
    for (const x of list) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(x.s.c - g[0].s.c) <= 0.35) g.push(x); else groups.push([x]);
    }
    for (const g of groups) {
      g.sort((p, q) => p.s.lo - q.s.lo);
      let cur: Line | null = null; let wSum = 0, wLen = 0;
      const flush = (): void => { if (cur) { cur.w = wLen ? wSum / wLen : 0; out.push(cur); } };
      for (const { s, i } of g) {
        if (cur && s.lo <= cur.hi + 0.6) {
          cur.hi = Math.max(cur.hi, s.hi); cur.segs.push(i); wSum += s.w * s.len; wLen += s.len;
          cur.c = (cur.c * (cur.segs.length - 1) + s.c) / cur.segs.length;
        } else {
          flush();
          cur = { h, c: s.c, lo: s.lo, hi: s.hi, w: s.w, segs: [i] }; wSum = s.w * s.len; wLen = s.len;
        }
      }
      flush();
    }
  }
  return out;
}

const bin = (d: number): number => Math.round(Math.log(d) / Math.log(1.08));

/** Offset clusters of the pairs: the strongest ones, as [lo, hi] offset ranges with their total paired length. */
function clusters(pairs: Pair[]): { d: number; lo: number; hi: number; weight: number }[] {
  const w = new Map<number, number>();
  for (const p of pairs) w.set(bin(p.d), (w.get(bin(p.d)) ?? 0) + p.len);
  const smooth = new Map<number, number>();
  for (const [b] of w) smooth.set(b, (w.get(b - 1) ?? 0) + (w.get(b) ?? 0) + (w.get(b + 1) ?? 0));
  const peaks: { b: number; v: number }[] = [];
  for (const [b, v] of smooth) if (v >= (smooth.get(b - 1) ?? 0) && v >= (smooth.get(b + 1) ?? 0)) peaks.push({ b, v });
  peaks.sort((x, y) => y.v - x.v);
  if (!peaks.length) return [];
  const top = peaks[0].v;
  const out: { d: number; lo: number; hi: number; weight: number }[] = [];
  for (const p of peaks) {
    if (p.v < 0.2 * top) break;
    const d = Math.pow(1.08, p.b);
    if (out.some((o) => Math.abs(Math.log(o.d / d)) < 0.2)) continue;
    out.push({ d, lo: d / 1.14, hi: d * 1.14, weight: p.v });
  }
  return out;
}

/** Morphological closing of a 0/1 mask with a square element of radius r pixels: gaps up to 2r wide between walls are closed. */
function closeMask(m: Uint8Array, nx: number, ny: number, r: number): Uint8Array {
  const pass = (src: Uint8Array, dilate: boolean): Uint8Array => {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    const want = dilate ? 1 : 0;
    // horizontal then vertical: a pixel is set when any (dilate) / all (erode: any unset => unset) pixel in the window equals `want`
    const cnt = new Int32Array(Math.max(nx, ny) + 1);
    for (let j = 0; j < ny; j++) {
      cnt[0] = 0;
      for (let i = 0; i < nx; i++) cnt[i + 1] = cnt[i] + (src[j * nx + i] === want ? 1 : 0);
      for (let i = 0; i < nx; i++) { const hit = cnt[Math.min(nx, i + r + 1)] - cnt[Math.max(0, i - r)] > 0; tmp[j * nx + i] = dilate ? (hit ? 1 : 0) : (hit ? 0 : 1); }
    }
    for (let i = 0; i < nx; i++) {
      cnt[0] = 0;
      for (let j = 0; j < ny; j++) cnt[j + 1] = cnt[j] + (tmp[j * nx + i] === want ? 1 : 0);
      for (let j = 0; j < ny; j++) { const hit = cnt[Math.min(ny, j + r + 1)] - cnt[Math.max(0, j - r)] > 0; out[j * nx + i] = dilate ? (hit ? 1 : 0) : (hit ? 0 : 1); }
    }
    return out;
  };
  return pass(pass(m, true), false);
}

interface Rect { h: boolean; lo: number; hi: number; c0: number; c1: number }
const overlapRect = (a: Rect, b: Rect, m = 0): boolean => {
  const ax0 = a.h ? a.lo : a.c0, ax1 = a.h ? a.hi : a.c1, ay0 = a.h ? a.c0 : a.lo, ay1 = a.h ? a.c1 : a.hi;
  const bx0 = b.h ? b.lo : b.c0, bx1 = b.h ? b.hi : b.c1, by0 = b.h ? b.c0 : b.lo, by1 = b.h ? b.c1 : b.hi;
  return ax0 <= bx1 + m && ax1 >= bx0 - m && ay0 <= by1 + m && ay1 >= by0 - m;
};

/** Union-find over bands that touch. */
function components(bands: Rect[], m: number): number[] {
  const parent = bands.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) if (overlapRect(bands[i], bands[j], m)) parent[find(i)] = find(j);
  return bands.map((_, i) => find(i));
}

function ringOf(b: Rect): Px[] {
  return b.h
    ? [{ x: b.lo, y: b.c0 }, { x: b.hi, y: b.c0 }, { x: b.hi, y: b.c1 }, { x: b.lo, y: b.c1 }]
    : [{ x: b.c0, y: b.lo }, { x: b.c1, y: b.lo }, { x: b.c1, y: b.hi }, { x: b.c0, y: b.hi }];
}

/**
 * Walls drawn as lines, or null when the page has none (or has only filled walls). `fill` is C8's result for the same page: with
 * filled walls present, line walls are added only when they are a different thickness and join the filled ones (a window
 * between two filled walls is drawn as parallel lines of the wall thickness and must stay a window).
 */
export function deriveLineWalls(page: VectorPage, fill: WallSet | null): LineWalls | null {
  const dbg = (...a: unknown[]): void => { if (typeof process !== 'undefined' && process.env?.LW_DEBUG) console.log('[line-walls]', ...a); };
  if (page.strokes.length < 12) { dbg('few strokes'); return null; }
  const hasFill = !!fill && fill.colors.length > 0 && fill.polys.length > 0;
  const ang = dominantAngle(page);
  const { segs, diag } = segsOf(page, ang);
  if (segs.length < 8) { dbg('few segs'); return null; }
  const lines = mergeLines(segs).filter((l) => l.hi - l.lo >= 6);
  dbg('segs', segs.length, 'lines', lines.length, 'ang', ang);
  if (lines.length < 6) return null;
  const dmaxPt = 0.045 * Math.max(page.width, page.height);
  const pageDim = Math.max(page.width, page.height);

  // ---- pairs of parallel lines that overlap along most of the shorter one
  const pairsAll: Pair[] = [];
  for (const h of [true, false]) {
    const ids = lines.map((l, i) => i).filter((i) => lines[i].h === h).sort((a, b) => lines[a].c - lines[b].c);
    for (let x = 0; x < ids.length; x++) {
      const a = lines[ids[x]];
      for (let y = x + 1; y < ids.length; y++) {
        const b = lines[ids[y]];
        const d = b.c - a.c;
        if (d > dmaxPt) break;
        if (d < 1.2) continue;
        const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
        // the pair must be longer than it is wide, so a window's two jamb marks or a table's legs are not a wall
        if (hi - lo < Math.max(2.2 * d, 8)) continue;
        // a pair that spans the whole page (a border) is not a wall
        if (hi - lo > 0.9 * pageDim) continue;
        pairsAll.push({ i: ids[x], j: ids[y], d, lo, hi, w: Math.min(a.w, b.w), len: hi - lo });
      }
    }
  }
  dbg('pairs', pairsAll.length);
  if (pairsAll.length < 4) return null;
  // ---- one attempt per pen weight present among the pairs; the weight whose bands enclose the most space is the walls'
  const inCl = (p: Pair, cl: { lo: number; hi: number }[]): boolean => cl.some((c) => p.d >= c.lo && p.d <= c.hi);
  const wTotals = new Map<number, number>();
  for (const p of pairsAll) { const k = Math.round(p.w / 0.05); wTotals.set(k, (wTotals.get(k) ?? 0) + p.len); }
  const maxTotal = Math.max(...wTotals.values());
  const weights = [...wTotals.entries()].filter(([, v]) => v >= 0.12 * maxTotal).map(([k]) => k * 0.05).sort((x, y) => y - x);
  dbg('weights', weights);
  interface Attempt { W: number; rects: (Rect & { t: number })[]; keep: number[]; comp: number[]; tMed: number; score: number }
  const attempt = (W: number): Attempt | null => {
    const heavy = (w: number): boolean => w >= 0.85 * W - 1e-9;
    const pairs = pairsAll.filter((p) => heavy(p.w) && p.w <= 1.5 * W + 0.05);
    if (pairs.length < 4) return null;
    let cl = clusters(pairs);
    // with filled walls present, the line walls must be a different thickness
    if (hasFill) cl = cl.filter((c) => { const r = c.d / fill!.t; return (r < 0.75 && r >= 0.4) || (r > 1.32 && r <= 1.7); });
    dbg('W', W, 'clusters', cl.map((c) => [c.d.toFixed(1), c.weight.toFixed(0)]), 'pairs', pairs.length);
    if (!cl.length) return null;
    const use = pairs.filter((p) => inCl(p, cl));
    if (use.length < 4) return null;

    // bands: the overlap of each pair, grown to the longer face where the other stops within a wall thickness (a corner)
    let rects: (Rect & { t: number })[] = [];
    const seen = new Set<string>();
    for (const p of use) {
      const a = lines[p.i], b = lines[p.j];
      let lo = p.lo, hi = p.hi;
      const loU = Math.min(a.lo, b.lo), hiU = Math.max(a.hi, b.hi);
      if (lo - loU <= 1.3 * p.d) lo = loU;
      if (hiU - hi <= 1.3 * p.d) hi = hiU;
      const key = `${a.h}|${a.c.toFixed(1)}|${b.c.toFixed(1)}|${lo.toFixed(1)}|${hi.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push({ h: a.h, lo, hi, c0: a.c, c1: b.c, t: p.d });
    }
    // a pair that sits inside a longer band of the same faces is the same wall
    rects = rects.filter((r, i) => !rects.some((o, k) => k !== i && o.h === r.h && Math.abs(o.c0 - r.c0) < 0.5 && Math.abs(o.c1 - r.c1) < 0.5 && o.lo <= r.lo + 0.5 && o.hi >= r.hi - 0.5 && (o.hi - o.lo > r.hi - r.lo + 0.5)));
    // bridge a collinear gap of at most 1.3 wall thicknesses where another wall meets it (the face stops at a T)
    const tMed = [...rects.map((r) => r.t)].sort((x, y) => x - y)[rects.length >> 1] ?? 0;
    const extra: (Rect & { t: number })[] = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.h !== b.h || Math.abs(a.c0 - b.c0) > 0.3 * a.t || Math.abs(a.c1 - b.c1) > 0.3 * a.t) continue;
      const first = a.lo <= b.lo ? a : b, second = first === a ? b : a;
      const gap = second.lo - first.hi;
      if (gap < 0.2 || gap > 1.3 * a.t) continue;
      const g: Rect = { h: a.h, lo: first.hi, hi: second.lo, c0: a.c0, c1: a.c1 };
      if (rects.some((q) => q.h !== a.h && overlapRect(q, g, 0.4))) extra.push({ ...g, t: a.t });
    }
    rects.push(...extra);
    if (rects.length < 3) return null;

    // keep what holds together
    const comp = components(rects, 0.4 * (tMed || 4));
    const byComp = new Map<number, number[]>();
    comp.forEach((c, i) => { const l = byComp.get(c); if (l) l.push(i); else byComp.set(c, [i]); });
    const area = (i: number): number => (rects[i].hi - rects[i].lo) * (rects[i].c1 - rects[i].c0);
    const size = new Map([...byComp].map(([c, ids]) => [c, ids.reduce((s, i) => s + area(i), 0)]));
    const biggest = Math.max(...size.values());
    const keepComp = new Set([...byComp.keys()].filter((c) => size.get(c)! >= 0.2 * biggest && byComp.get(c)!.length >= (hasFill ? 2 : 4)));
    let keep = rects.map((_, i) => i).filter((i) => keepComp.has(comp[i]));
    if (false) dbg('rects', rects.map((r) => `${r.h ? 'h' : 'v'} ${r.lo.toFixed(0)}-${r.hi.toFixed(0)} ${r.c0.toFixed(0)}-${r.c1.toFixed(0)}`));
    dbg('W', W, 'rects', rects.length, 'comps', byComp.size, 'keep', keep.length);
    if (!keep.length) return null;
    let score = 0;
    if (hasFill) {
      // joined to the filled walls: a component is kept when any of its bands touches a filled wall
      const fillBoxes: Rect[] = fill!.polys.map((q) => {
        const rr = q.ring.map((p) => (ang ? rotPt(p, ang) : p));
        const xs = rr.map((p) => p.x), ys = rr.map((p) => p.y);
        return { h: true, lo: Math.min(...xs), hi: Math.max(...xs), c0: Math.min(...ys), c1: Math.max(...ys) };
      });
      const touching = new Set(keep.filter((i) => fillBoxes.some((f) => overlapRect(rects[i], f, 0.6))));
      const okComp = new Set([...touching].map((i) => comp[i]));
      keep = keep.filter((i) => okComp.has(comp[i]));
      const bandArea = keep.reduce((sum, i) => sum + area(i), 0);
      // a handful of short bands is a door leaf or a table edge, not a second kind of wall: they must be a real share (40%) of the filled walls
      if (keep.length < 6 || bandArea < 0.4 * fill!.polys.reduce((sum, q) => sum + q.area, 0)) return null;
      score = bandArea;
    } else {
      // enclosure: a component of bands must close off free regions of real size (room-like), as a flat's walls do; dimension rows,
      // tables and the floor and side walls of an elevation drawn beside the plan enclose none
      const tt = tMed || 4;
      let px = Math.max(tt / 3, 0.6);
      while ((page.width / px) * (page.height / px) > 3e6) px *= 1.25;
      const enclosure = (ids: number[]): number => {
        const bm = new Bitmap(page.width, page.height, px);
        const rings = ids.map((i) => ringOf(rects[i]).map((p) => (ang ? rotPt(p, -ang) : p)));
        for (const r of rings) bm.fillRing(r, WALL);
        // doors and windows are gaps in the bands: bridge them the way the wall stage will, then ask what is enclosed
        const asWalls = { polys: rings.map((r) => ({ ring: r, color: LINE_WALL_COLOR, area: 0, bbox: [0, 0, 0, 0] as [number, number, number, number], isRect: true, long: 0, short: 0 })), t: tt } as unknown as WallSet;
        for (const g of bridgeGaps(asWalls, bm)) bm.fillRing(g.band, WALL);
        const N = bm.nx * bm.ny, seen2 = new Uint8Array(N), stack = new Int32Array(N);
        let area = 0;
        for (let k0 = 0; k0 < N; k0++) {
          if (seen2[k0] || bm.data[k0] !== FREE) continue;
          let sp = 0, count = 0, border = false;
          stack[sp++] = k0; seen2[k0] = 1;
          while (sp) {
            const k = stack[--sp]; count++;
            const i = k % bm.nx, j = (k - i) / bm.nx;
            if (i === 0 || j === 0 || i === bm.nx - 1 || j === bm.ny - 1) border = true;
            if (i > 0 && !seen2[k - 1] && bm.data[k - 1] === FREE) { seen2[k - 1] = 1; stack[sp++] = k - 1; }
            if (i < bm.nx - 1 && !seen2[k + 1] && bm.data[k + 1] === FREE) { seen2[k + 1] = 1; stack[sp++] = k + 1; }
            if (j > 0 && !seen2[k - bm.nx] && bm.data[k - bm.nx] === FREE) { seen2[k - bm.nx] = 1; stack[sp++] = k - bm.nx; }
            if (j < bm.ny - 1 && !seen2[k + bm.nx] && bm.data[k + bm.nx] === FREE) { seen2[k + bm.nx] = 1; stack[sp++] = k + bm.nx; }
          }
          if (!border && count * px * px >= 20 * tt * tt) area += count * px * px;
        }
        return area;
      };
      const kept2: number[] = [];
      for (const [c, ids] of byComp) {
        const mine = ids.filter((i) => keep.includes(i));
        if (!mine.length) continue;
        const a2 = enclosure(mine);
        dbg('W', W, 'component', c, 'bands', mine.length, 'enclosed', a2.toFixed(0));
        if (a2 > 0) { kept2.push(...mine); score += a2; }
      }
      if (!kept2.length) return null;
      keep = kept2;
    }
    return { W, rects, keep, comp, tMed, score };
  };
  // the heaviest pen weight whose bands enclose a real share of what any weight encloses: cut lines are the heavy class, and lighter
  // weights only add furniture, dimension rows and window lines that happen to join the walls
  const tried = weights.map((W) => attempt(W)).filter((a): a is Attempt => !!a);
  if (!tried.length) return null;
  const top = Math.max(...tried.map((a) => a.score));
  const best = tried.find((a) => a.score >= 0.5 * top) ?? null;
  if (!best) return null;
  const { W, rects, keep } = best;
  const heavy = (w: number): boolean => w >= 0.85 * W - 1e-9;
  if (keep.length < 2) return null;
  void bin;
  const kept = keep.map((i) => rects[i]);
  const back = (r: Px[]): Px[] => (ang ? r.map((p) => rotPt(p, -ang)) : r);

  // ---- hatch: diagonal strokes lying inside a band
  const inBand = (p: Px, m = 0.4): boolean => kept.some((r) => (r.h ? p.x >= r.lo - m && p.x <= r.hi + m && p.y >= r.c0 - m && p.y <= r.c1 + m : p.y >= r.lo - m && p.y <= r.hi + m && p.x >= r.c0 - m && p.x <= r.c1 + m));
  const bandHatch = new Set<number>();
  const consumedEdge = new Set<string>();
  for (const d of diag) {
    if (inBand(d.a) && inBand(d.b)) {
      consumedEdge.add(`${d.stroke}:${d.edge}`);
      kept.forEach((r, k) => { const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }; if ((r.h ? m.x >= r.lo && m.x <= r.hi && m.y >= r.c0 && m.y <= r.c1 : m.y >= r.lo && m.y <= r.hi && m.x >= r.c0 && m.x <= r.c1)) bandHatch.add(k); });
    }
  }
  // axis strokes of the wall pen weight that lie on or in a band are the wall's own faces, caps and joins
  for (const s of segs) {
    if (!heavy(s.w) && s.w > 0) continue;
    const a: Px = s.h ? { x: s.lo, y: s.c } : { x: s.c, y: s.lo }, b: Px = s.h ? { x: s.hi, y: s.c } : { x: s.c, y: s.hi };
    if (inBand(a) && inBand(b)) consumedEdge.add(`${s.stroke}:${s.edge}`);
  }
  // light axis strokes strictly inside a band (a hatch drawn square, a centre line) go too
  for (const s of segs) {
    if (heavy(s.w)) continue;
    const a: Px = s.h ? { x: s.lo, y: s.c } : { x: s.c, y: s.lo }, b: Px = s.h ? { x: s.hi, y: s.c } : { x: s.c, y: s.hi };
    if (inBand(a, -0.6) && inBand(b, -0.6)) consumedEdge.add(`${s.stroke}:${s.edge}`);
  }

  // ---- rebuild the strokes without the consumed edges
  const strokes: VStroke[] = [];
  let consumed = 0;
  page.strokes.forEach((s, si) => {
    const n = s.closed ? s.points.length : s.points.length - 1;
    if (s.hasCurve || n < 1) { strokes.push(s); return; }
    const gone = Array.from({ length: n }, (_, k) => consumedEdge.has(`${si}:${k}`));
    if (!gone.some(Boolean)) { strokes.push(s); return; }
    consumed++;
    if (gone.every(Boolean)) return;
    // runs of surviving edges
    let run: Px[] = [];
    const emit = (): void => { if (run.length >= 2) strokes.push({ ...s, points: run, closed: false }); run = []; };
    for (let k = 0; k < n; k++) {
      if (gone[k]) { emit(); continue; }
      const a = s.points[k], b = s.points[(k + 1) % s.points.length];
      if (!run.length) run.push(a);
      run.push(b);
    }
    emit();
  });

  const fills: VFill[] = [...page.fills];
  const bands: Band[] = kept.map((r, k) => {
    const ring = back(ringOf(r));
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    const f: VFill = { color: LINE_WALL_COLOR, rings: [ring], area: Math.abs((r.hi - r.lo) * (r.c1 - r.c0)), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    fills.push(f);
    return { ring, t: r.t, h: r.h, lo: r.lo, hi: r.hi, c0: r.c0, c1: r.c1, hatched: bandHatch.has(k) };
  });
  const hatched = bands.filter((b) => b.hatched).length;
  const out: VectorPage = { ...page, fills, strokes };
  const ts = new Map<number, number>();
  for (const b of bands) { const k = Math.round(b.t * 4) / 4; ts.set(k, (ts.get(k) ?? 0) + (b.hi - b.lo)); }
  return {
    page: Object.assign(out, { normalized: (page as { normalized?: boolean }).normalized }) as VectorPage, bands,
    thicknessPt: [...ts.entries()].sort((x, y) => y[1] - x[1]).map((x) => x[0]),
    style: hasFill ? 'mixed-with-fill' : hatched >= bands.length / 2 ? 'hatch' : 'double', consumed, weightPt: W,
  };
}
