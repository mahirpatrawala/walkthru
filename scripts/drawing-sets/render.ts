// C12a: design-frame primitives -> the rotated sheet as VectorPage objects (what pdf.js yields) and as a real PDF 1.4.
import type { VectorPage, VFill, VStroke, VText } from '../../src/import/types';
import type { Prim } from './draw';
import { realTextWidth } from './draw';
import type { PageOut } from './sheet';

export type Rot = 0 | 90 | 180 | 270;
export type UserPrim =
  | { t: 'fill'; color: string; pts: [number, number][]; rect: boolean }
  | { t: 'stroke'; color: string; width: number; pts: [number, number][]; closed: boolean; curve: boolean; dash: boolean }
  | { t: 'text'; str: string; x: number; y: number; size: number; angle: number };
export interface UserPage { width: number; height: number; prims: UserPrim[] }

const wrap180 = (d: number): number => { let a = ((d % 360) + 360) % 360; if (a > 180) a -= 360; return a; };

/** Design frame (y down) -> PDF user space (y up) with the sheet turned by `rot` degrees counter-clockwise. */
export function toUserPage(page: PageOut, rot: Rot): UserPage {
  const Wd = page.widthPt, Hd = page.heightPt;
  const map = ((): ((x: number, y: number) => [number, number]) => {
    if (rot === 0) return (x, y) => [x, Hd - y];
    if (rot === 90) return (x, y) => [y, x];
    if (rot === 180) return (x, y) => [Wd - x, y];
    return (x, y) => [Hd - y, Wd - x];
  })();
  const out: UserPrim[] = [];
  for (const p of page.prims as Prim[]) {
    if (p.t === 'fill') out.push({ t: 'fill', color: p.color, pts: p.pts.map(([x, y]) => map(x, y)), rect: !!p.rect });
    else if (p.t === 'stroke') out.push({ t: 'stroke', color: p.color, width: p.width, pts: p.pts.map(([x, y]) => map(x, y)), closed: p.closed, curve: !!p.curve, dash: !!p.dash });
    else { const [x, y] = map(p.x, p.y); out.push({ t: 'text', str: p.str, x, y, size: p.size, angle: wrap180(rot - p.rot) }); }
  }
  const rotated = rot === 90 || rot === 270;
  return { width: rotated ? Hd : Wd, height: rotated ? Wd : Hd, prims: out };
}

const areaOf = (pts: [number, number][]): number => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

export function toVectorPage(u: UserPage, index: number): VectorPage {
  const fills: VFill[] = []; const strokes: VStroke[] = []; const texts: VText[] = [];
  for (const p of u.prims) {
    if (p.t === 'fill') {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      fills.push({ color: p.color, rings: [p.pts.map(([x, y]) => ({ x, y }))], area: areaOf(p.pts), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    } else if (p.t === 'stroke') {
      strokes.push({ color: p.color, width: p.width, points: p.pts.map(([x, y]) => ({ x, y })), closed: p.closed, hasCurve: p.curve });
    } else {
      texts.push({ str: p.str, x: p.x, y: p.y, width: realTextWidth(p.str, p.size), size: p.size, angle: p.angle });
    }
  }
  return { index, width: u.width, height: u.height, fills, strokes, texts, imageCoverage: 0 };
}

// ---------------------------------------------------------------- PDF
const n3 = (v: number): string => (Math.round(v * 1000) / 1000).toString();
const rgb = (hex: string): string => [1, 3, 5].map((i) => n3(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Smooth cubic path through the points (Catmull-Rom to Bezier), so arcs and circles are real curves in the PDF. */
function curvePath(pts: [number, number][], closed: boolean): string {
  const n = pts.length;
  const P = (i: number): [number, number] => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `${n3(pts[0][0])} ${n3(pts[0][1])} m`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` ${n3(c1[0])} ${n3(c1[1])} ${n3(c2[0])} ${n3(c2[1])} ${n3(p2[0])} ${n3(p2[1])} c`;
  }
  return closed ? `${d} h` : d;
}

function contentStream(u: UserPage): string {
  const o: string[] = ['q'];
  for (const p of u.prims) {
    if (p.t === 'fill') {
      o.push(`${rgb(p.color)} rg`);
      if (p.rect && p.pts.length === 4) {
        const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        o.push(`${n3(x0)} ${n3(y0)} ${n3(Math.max(...xs) - x0)} ${n3(Math.max(...ys) - y0)} re f`);
      } else o.push(p.pts.map((q, i) => `${n3(q[0])} ${n3(q[1])} ${i ? 'l' : 'm'}`).join(' ') + ' h f');
    } else if (p.t === 'stroke') {
      o.push(`${rgb(p.color)} RG ${n3(p.width)} w ${p.dash ? '[2 1.5] 0 d' : '[] 0 d'}`);
      if (p.curve && p.pts.length >= 3) o.push(`${curvePath(p.pts, p.closed)} S`);
      else o.push(p.pts.map((q, i) => `${n3(q[0])} ${n3(q[1])} ${i ? 'l' : 'm'}`).join(' ') + (p.closed ? ' h S' : ' S'));
    } else {
      const a = (p.angle * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      o.push(`0 g BT /F1 ${n3(p.size)} Tf ${n3(c)} ${n3(s)} ${n3(-s)} ${n3(c)} ${n3(p.x)} ${n3(p.y)} Tm (${esc(p.str)}) Tj ET`);
    }
  }
  o.push('Q');
  return o.join('\n');
}

/** A real PDF 1.4: Helvetica, one content stream per page, correct xref table. No library. */
export function toPdf(pages: UserPage[]): Uint8Array {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n3(p.width)} ${n3(p.height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const s = contentStream(p);
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
