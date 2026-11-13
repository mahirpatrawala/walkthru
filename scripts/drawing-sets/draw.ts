// C12a: drawing primitives (design frame: points, x right, y down), text in real or stroke form, and the number formats.
import type { Font, FtinFormat, SetOptions } from './types';
import { strokeText, strokeWidth } from './glyphs';

export type Prim =
  | { t: 'fill'; color: string; pts: [number, number][]; rect?: boolean }
  | { t: 'stroke'; color: string; width: number; pts: [number, number][]; closed: boolean; curve?: boolean; dash?: boolean }
  | { t: 'text'; str: string; x: number; y: number; size: number; /** degrees on screen, 0 reads right, -90 reads up */ rot: number };

// Helvetica widths per 1000 (AFM) for the characters a drawing uses; lower case from the same table.
const HW: Record<string, number> = {
  ' ': 278, "'": 191, '"': 355, '=': 584, '-': 333, '.': 278, '/': 278, ',': 278, '(': 333, ')': 333, ':': 278, '½': 834, '×': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
export function realTextWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += HW[ch] ?? (ch >= '0' && ch <= '9' ? 556 : 556);
  return (w / 1000) * size;
}
const CAP = 0.72;
export interface TextStyle { mode: 'real' | 'glyph'; font: Font; slantDeg: number; widthScale: number }
export function textWidth(s: string, size: number, st: TextStyle): number {
  if (st.mode === 'real') return realTextWidth(s, size);
  return strokeWidth(s, size * CAP, st.font, st.slantDeg, st.widthScale);
}

export class Canvas {
  prims: Prim[] = [];
  fill(color: string, pts: [number, number][], rect = false): void { this.prims.push({ t: 'fill', color, pts, rect }); }
  rectFill(color: string, x0: number, y0: number, x1: number, y1: number, tri = false): void {
    const p: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (tri) { this.fill(color, [p[0], p[1], p[2]]); this.fill(color, [p[0], p[2], p[3]]); } else this.fill(color, p, true);
  }
  line(color: string, width: number, a: [number, number], b: [number, number], dash = false): void { this.prims.push({ t: 'stroke', color, width, pts: [a, b], closed: false, dash }); }
  poly(color: string, width: number, pts: [number, number][], closed = false): void { this.prims.push({ t: 'stroke', color, width, pts, closed }); }
  rect(color: string, width: number, x0: number, y0: number, x1: number, y1: number): void { this.poly(color, width, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true); }
  arc(color: string, width: number, cx: number, cy: number, r: number, a0: number, a1: number): void {
    const n = 14; const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    this.prims.push({ t: 'stroke', color, width, pts, closed: false, curve: true });
  }
  circle(color: string, width: number, cx: number, cy: number, r: number): void {
    const n = 20; const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    this.prims.push({ t: 'stroke', color, width, pts, closed: true, curve: true });
  }
  ellipse(color: string, width: number, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
    const n = 20; const pts: [number, number][] = [];
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n; const x = rx * Math.cos(a), y = ry * Math.sin(a); pts.push([cx + x * c - y * s, cy + x * s + y * c]); }
    this.prims.push({ t: 'stroke', color, width, pts, closed: true, curve: true });
  }
  /** Text with its anchor at (x, y) on the baseline: 'start' at the left end, 'mid' centred. */
  text(str: string, x: number, y: number, size: number, st: TextStyle, rot = 0, anchor: 'start' | 'mid' = 'start', color = '#000000'): void {
    const w = textWidth(str, size, st);
    const r = (rot * Math.PI) / 180;
    const off = anchor === 'mid' ? -w / 2 : 0;
    const ox = x + off * Math.cos(r), oy = y + off * Math.sin(r);
    if (st.mode === 'real') { this.prims.push({ t: 'text', str, x: ox, y: oy, size, rot }); return; }
    for (const p of strokeText(str, ox, oy, { capH: size * CAP, font: st.font, slantDeg: st.slantDeg, widthScale: st.widthScale, rot })) {
      this.prims.push({ t: 'stroke', color, width: Math.max(0.2, size * 0.04), pts: p.pts, closed: p.closed });
    }
  }
}

// ---------------------------------------------------------------- number formats
const IN = 0.0254;
const HALF = '½';
export function fmtFtIn(m: number, fmt: FtinFormat): { s: string; shownM: number } {
  const half = fmt === 'fraction';
  const total = half ? Math.round(m / IN * 2) / 2 : Math.round(m / IN);
  const ft = Math.floor(total / 12 + 1e-9);
  let inch = total - ft * 12;
  const isHalf = Math.abs(inch - Math.floor(inch) - 0.5) < 1e-9;
  const whole = Math.floor(inch + 1e-9);
  const inchStr = (): string => (isHalf ? `${whole === 0 ? '' : whole}${fmt === 'space' ? (whole === 0 ? '1/2' : ' 1/2') : HALF}` : `${whole}`);
  let s: string;
  if (ft === 0) s = `${inchStr()}"`;
  else if (fmt === 'tight') s = `${ft}'${inchStr()}"`;
  else if (fmt === 'space') s = `${ft}' ${inchStr()}"`;
  else s = `${ft}'-${inchStr()}"`;
  inch = total - ft * 12;
  return { s, shownM: total * IN };
}
export function trimNum(v: number, dp: number): string { return v.toFixed(dp).replace(/\.?0+$/, ''); }
/** One length in the set's units. Returns the string and the length the string actually states. */
export function fmtLen(m: number, o: SetOptions): { s: string; shownM: number } {
  if (o.units === 'ftin') return fmtFtIn(m, o.ftinFormat);
  if (o.units === 'mm') { const mm = Math.round(m * 1000); return { s: `${mm}`, shownM: mm / 1000 }; }
  const v = Math.round(m * 1000) / 1000;
  return { s: trimNum(v, 3).replace(/^(\d+\.\d)$/, '$10'), shownM: v };
}
/** A label's size string "11'0"X12'6"" (tight feet and inches whatever the dimension-line format). */
export function fmtSize(w: number, l: number, o: SetOptions, lower = false): { s: string; w: number; l: number } {
  const x = lower ? 'x' : 'X';
  if (o.units === 'ftin') {
    const a = fmtFtIn(w, 'tight'), b = fmtFtIn(l, 'tight');
    return { s: `${a.s}${x}${b.s}`, w: a.shownM, l: b.shownM };
  }
  if (o.units === 'mm') { const a = Math.round(w * 1000), b = Math.round(l * 1000); return { s: `${a} ${x} ${b}`, w: a / 1000, l: b / 1000 }; }
  const a = Math.round(w * 100) / 100, b = Math.round(l * 100) / 100;
  return { s: `${a.toFixed(2)} ${x} ${b.toFixed(2)} M`, w: a, l: b };
}
export function fmtArea(m2: number, o: SetOptions, variant: number): string {
  if (o.areaUnit === 'sqft') { const v = Math.round(m2 / 0.09290304); return `${v} ${variant % 2 ? 'SQ.FT.' : 'SQFT'}`; }
  return `${Math.round(m2 * 10) / 10} ${variant % 2 ? 'SQ.M.' : 'SQ M'}`;
}
export const caseOf = (s: string, o: SetOptions): string => (o.upper ? s.toUpperCase() : s.toLowerCase().replace(/(^|[\s/])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()));

// ---------------------------------------------------------------- walls
export interface WallPaint { style: 'fill-dark' | 'fill-grey' | 'fill-two-grey' | 'double' | 'hatch'; step: number }
export const WALL_COLORS = { 'fill-dark': ['#000000', '#000000'], 'fill-grey': ['#666666', '#666666'], 'fill-two-grey': ['#666666', '#b3b3b3'] } as const;
/** One wall piece in points. `part` = a partition (second grey in the two-grey style). `tri` tessellates a fill like a CAD export. */
export function drawWallRect(cv: Canvas, wp: WallPaint, x0: number, y0: number, x1: number, y1: number, part: boolean, tri: boolean): void {
  if (wp.style === 'double' || wp.style === 'hatch') {
    cv.rect('#000000', 0.5, x0, y0, x1, y1);
    if (wp.style === 'hatch') {
      // diagonal hatch clipped to the rectangle
      const w = x1 - x0, h = y1 - y0; const step = wp.step;
      for (let k = step; k < w + h; k += step) {
        const a: [number, number] = [x0 + Math.min(k, w), y0 + Math.max(0, k - w)];
        const b: [number, number] = [x0 + Math.max(0, k - h), y0 + Math.min(k, h)];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.4) cv.line('#000000', 0.12, a, b);
      }
    }
    return;
  }
  const cols = WALL_COLORS[wp.style];
  cv.rectFill(part ? cols[1] : cols[0], x0, y0, x1, y1, tri);
}
