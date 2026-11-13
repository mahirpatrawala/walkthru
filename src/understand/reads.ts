// C12b. SPEC 17.5: what a text reader hands to the dimension stage. One TextRead is one candidate string at one place, with the
// method that produced it. Frame: page units, y DOWN (the normalised page frame). Pure types and small helpers.
import type { VText, VectorPage } from '../import/types';

export type ReadMethod = 'pdf-text' | 'glyph' | 'ocr' | 'vision';
export interface TextRead {
  id: string;
  method: ReadMethod;
  str: string;
  /** ink box, y down */
  bbox: [number, number, number, number];
  /** reading direction in degrees on the y-down page: 0 reads right, 90 reads down, 180 reads left, 270 reads up */
  angle: number;
  /** font size (em); the cap height is about 0.72 of it */
  size: number;
  /** start of the baseline, y down */
  origin: [number, number];
  /** length of the string along the reading direction */
  length: number;
  /** 0 to 1, for ordering only */
  confidence: number;
  /** glyph reads: the strokes (indices into the page the read came from) that drew it */
  strokes?: number[];
  /** glyph reads: one entry per character, `cluster` is the shape cluster it came from */
  glyphs?: { ch: string; d: number; cluster: number; tentative: boolean; /** ink extent along the reading direction, page units from the start of the read */ a: number; b: number }[];
  /** true when a character came from a shape cluster whose label no dimension has confirmed yet (SPEC 17.5 item 2) */
  tentative?: boolean;
}

export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;
export const wrap180 = (d: number): number => { const a = wrap360(d); return a > 180 ? a - 360 : a; };

/** A page as a y-down frame: a page that is already normalised is, a raw one (PDF user space) is flipped on y. */
export function isYDown(page: VectorPage): boolean { return !!(page as { normalized?: boolean }).normalized; }

/** A glyph read as a VText of the page it came from, in that page's own frame (raw y-up pages or normalised y-down pages). */
export function readToVText(r: TextRead, page: VectorPage): VText {
  const up = !isYDown(page);
  const H = page.height;
  const ang = up ? wrap180(-r.angle) : wrap180(r.angle);
  return { str: r.str, x: r.origin[0], y: up ? H - r.origin[1] : r.origin[1], width: r.length, size: r.size, angle: ang };
}

/** The ink box of a VText in the y-down frame, assuming a cap height of 0.72 of its size. */
export function vtextBox(t: VText, yDown: boolean, H: number): { box: [number, number, number, number]; origin: [number, number]; angle: number } {
  const ang = yDown ? t.angle : -t.angle; // y-down angle, clockwise positive
  const oy = yDown ? t.y : H - t.y;
  const r = (ang * Math.PI) / 180;
  const u = [Math.cos(r), Math.sin(r)], dn = [-Math.sin(r), Math.cos(r)];
  const cap = 0.72 * t.size;
  // along the reading direction u, and up from the baseline (up = minus the reader's down)
  const pts: [number, number][] = ([[0, 0], [t.width, 0], [t.width, cap], [0, cap]] as [number, number][]).map(([a, c]) => [t.x + u[0] * a - dn[0] * c, oy + u[1] * a - dn[1] * c] as [number, number]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], origin: [t.x, oy], angle: wrap360(ang) };
}

/**
 * Characters i0..i1-1 of a glyph read as a read of their own (same line, same size). Used to cut a read where two dimension
 * strings were set so close that they ran together, and to join the pieces of one string back up.
 */
export function subRead(r: TextRead, i0: number, i1: number): TextRead | null {
  if (!r.glyphs || i1 <= i0) return null;
  const g = r.glyphs.slice(i0, i1);
  const a = g[0].a, b = g[g.length - 1].b;
  const rad = (r.angle * Math.PI) / 180;
  const u: [number, number] = [Math.cos(rad), Math.sin(rad)], dn: [number, number] = [-Math.sin(rad), Math.cos(rad)];
  const origin: [number, number] = [r.origin[0] + u[0] * a, r.origin[1] + u[1] * a];
  const cap = 0.72 * r.size;
  const pts: [number, number][] = ([[0, 0], [b - a, 0], [b - a, cap], [0, cap]] as [number, number][]).map(([p, c]) => [origin[0] + u[0] * p - dn[0] * c, origin[1] + u[1] * p - dn[1] * c] as [number, number]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { ...r, id: `${r.id}.${i0}-${i1}`, str: g.map((x) => x.ch).join(''), origin, length: b - a, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], glyphs: g.map((x) => ({ ...x, a: x.a - a, b: x.b - a })), tentative: g.some((x) => x.tentative) };
}
