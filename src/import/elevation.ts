// C8. SPEC 13.5 step 9: ceiling height (and sill / head when text allows) from the elevation pages. Pure TypeScript.
import { parseLength } from '../core/units';
import type { CeilingFinding, VectorPage, VText } from './types';
import { selectWalls } from './walls';

const KEY_RE = /CEILING|CLG|C\.?H\.?\b|HEIGHT|\bHT\b|FFL|SLAB/i;
const LEN_IN_TEXT = /(\d+(?:\.\d+)?\s*'\s*(?:\d+(?:\.\d+)?\s*")?|\d+(?:\.\d+)?\s*(?:mm|cm|m)\b)/i;

const MIN_H = 2.3, MAX_H = 3.4, MAX_TEXT_H = 3.6;

function lengthsIn(str: string): number[] {
  const out: number[] = [];
  const re = new RegExp(LEN_IN_TEXT.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) { const v = parseLength(m[1].replace(/\s+/g, '')); if (v !== null) out.push(v); }
  return out;
}

function rotatedDist(a: VText, b: VText): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** The designer's dimensions as real text: a length next to a ceiling keyword, or the largest height-like length token. */
export function ceilingFromText(pages: VectorPage[]): { heightM: number; page: number } | null {
  for (const pg of pages) {
    const keyed: number[] = [];
    for (const t of pg.texts) {
      if (!KEY_RE.test(t.str)) continue;
      const own = lengthsIn(t.str);
      if (own.length) { keyed.push(...own); continue; }
      // within 3 lines: the nearest length-only runs
      const near = pg.texts
        .filter((o) => o !== t && rotatedDist(o, t) <= 3 * Math.max(t.size, o.size) * 1.6 + o.width)
        .flatMap((o) => (parseLength(o.str.trim()) !== null && /^[\d.'"\sxmcmm]+$/i.test(o.str.trim()) ? [parseLength(o.str.trim())!] : []));
      keyed.push(...near);
    }
    const ok = keyed.filter((v) => v >= MIN_H && v <= MAX_TEXT_H);
    if (ok.length) return { heightM: ok[0], page: pg.index };
  }
  for (const pg of pages) {
    const pure = pg.texts.filter((t) => /^\s*[\d.]+\s*('|"|m|cm|mm)/.test(t.str) && lengthsIn(t.str).length === 1 && !/[xX×]/.test(t.str))
      .map((t) => lengthsIn(t.str)[0]).filter((v) => v >= MIN_H && v <= MAX_TEXT_H);
    if (pure.length) return { heightM: Math.max(...pure), page: pg.index };
  }
  return null;
}

/** SILL / LINTEL (or HEAD) tokens. */
export function windowHeightsFromText(pages: VectorPage[]): { sillM?: number; headM?: number } {
  let sillM: number | undefined; let headM: number | undefined;
  for (const pg of pages) for (const t of pg.texts) {
    const v = lengthsIn(t.str)[0];
    if (v === undefined) continue;
    if (/SILL/i.test(t.str) && sillM === undefined) sillM = v;
    if (/LINTEL|\bHEAD\b/i.test(t.str) && headM === undefined) headM = v;
  }
  return { sillM, headM };
}

export interface ElevationBox { page: number; clearWidthPt: number; clearHeightPt: number; aspect: number }

/** Geometry of the room box on one elevation page, or null when the pieces are not found. */
export function elevationBox(pg: VectorPage): ElevationBox | null {
  const walls = selectWalls(pg);
  const rects = walls.polys.filter((p) => p.isRect);
  const horiz = rects.filter((p) => p.bbox[2] - p.bbox[0] >= 2 * (p.bbox[3] - p.bbox[1]));
  if (!horiz.length) return null;
  const slab = horiz.reduce((a, b) => ((b.bbox[2] - b.bbox[0]) > (a.bbox[2] - a.bbox[0]) ? b : a));
  const slabUnder = slab.bbox[3];
  const t = walls.t || 1;
  // floor line: the longest horizontal run below the slab, within the slab's horizontal extent
  let floorY: number | null = null; let best = 0;
  for (const s of pg.strokes) {
    if (s.points.length < 2) continue;
    if (s.closed) {
      const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
      if (Math.max(...xs) - Math.min(...xs) >= 0.7 * pg.width) continue; // drawing border, title block
    }
    const n = s.points.length; const last = s.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = s.points[i], b = s.points[(i + 1) % n];
      if (Math.abs(a.y - b.y) > 0.3) continue;
      const L = Math.abs(b.x - a.x);
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      if (a.y <= slabUnder + 4 * t) continue;
      if (lo < slab.bbox[0] - t || hi > slab.bbox[2] + t) continue;
      if (L > best) { best = L; floorY = a.y; }
    }
  }
  if (floorY === null) {
    // fall back to the bottom edge of the wall fills
    floorY = Math.max(...rects.map((p) => p.bbox[3]));
  }
  const clearHeightPt = floorY - slabUnder;
  const vert = rects.filter((p) => (p.bbox[3] - p.bbox[1]) >= (p.bbox[2] - p.bbox[0]) && (p.bbox[3] - p.bbox[1]) >= 2 * t);
  if (vert.length < 2 || clearHeightPt <= 0) return null;
  const left = vert.reduce((a, b) => (b.bbox[0] < a.bbox[0] ? b : a));
  const right = vert.reduce((a, b) => (b.bbox[2] > a.bbox[2] ? b : a));
  const clearWidthPt = right.bbox[0] - left.bbox[2];
  if (clearWidthPt <= 0) return null;
  return { page: pg.index, clearWidthPt, clearHeightPt, aspect: clearWidthPt / clearHeightPt };
}

/**
 * Step 9. `extentsM` are the plan rooms' wall-to-wall extents in metres (both bbox sides of every room).
 * `elevations` are the normalised elevation pages.
 */
export function findCeiling(elevations: VectorPage[], extentsM: number[]): { ceiling: CeilingFinding; warnings: string[]; boxes: ElevationBox[] } {
  const warnings: string[] = [];
  const text = ceilingFromText(elevations);
  if (text) {
    return { ceiling: { heightM: text.heightM, method: 'text', page: text.page, candidatesM: [text.heightM], confidence: 0.9 }, warnings, boxes: [] };
  }
  const boxes = elevations.map((p) => elevationBox(p)).filter((b): b is ElevationBox => !!b);
  const dedup = (vals: number[]): number[] => {
    const s = [...vals].sort((a, b) => a - b); const out: number[] = [];
    for (const v of s) if (!out.length || Math.abs(v - out[out.length - 1]) > 0.02) out.push(v);
    return out;
  };
  const ext = dedup(extentsM);
  const perPage = boxes.map((b) => ({ b, c: dedup(ext.map((d) => d / b.aspect)).filter((h) => h >= MIN_H && h <= MAX_H) }));
  const all = dedup(perPage.flatMap((p) => p.c));
  const mk = (h: number, conf: number, page: number | null, cands: number[]): CeilingFinding => ({ heightM: h, method: 'geometry', page, candidatesM: cands, confidence: conf });
  if (!perPage.length) {
    warnings.push('Ceiling height not found on the elevation pages. Using 2.75 m. Confirm it.');
    return { ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 }, warnings, boxes };
  }
  if (all.length === 0) {
    warnings.push('Elevation geometry gave no ceiling height between 2.3 and 3.4 m. Using 2.75 m. Confirm it.');
    return { ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 }, warnings, boxes };
  }
  if (all.length === 1) return { ceiling: mk(all[0], 0.7, perPage.find((p) => p.c.length)!.b.page, all), warnings, boxes };
  // several: prefer the candidate that other elevation pages also produce (within 3%)
  const pagesFor = (h: number): number => perPage.filter((p) => p.c.some((c) => Math.abs(c - h) / h <= 0.03)).length;
  const counts = all.map((h) => ({ h, n: pagesFor(h) }));
  const top = Math.max(...counts.map((c) => c.n));
  const lead = counts.filter((c) => c.n === top).map((c) => c.h);
  const pageOf = (h: number): number | null => perPage.find((p) => p.c.some((c) => Math.abs(c - h) / h <= 0.03))?.b.page ?? null;
  if (top >= 2 && lead.length === 1) return { ceiling: mk(lead[0], 0.7, pageOf(lead[0]), all), warnings, boxes };
  const nearest = (top >= 2 ? lead : all).reduce((a, b) => (Math.abs(b - 2.75) < Math.abs(a - 2.75) ? b : a));
  warnings.push(`Ceiling height is a guess between ${all.map((v) => v.toFixed(2)).join(', ')} m. Confirm it.`);
  return { ceiling: mk(nearest, 0.3, pageOf(nearest), all), warnings, boxes };
}
