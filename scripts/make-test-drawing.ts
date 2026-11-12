// C8 synthetic fixture (SPEC 13.10). Draws the truth flat (6.1, furnished variant) in the reference drawing's style:
// scale 31.7 pt per metre, every mark rotated 90 degrees on an A4 page, walls as grey fills, exploded dimension
// lines, glyph noise and hatching. Exports `buildDrawingPages` (already-parsed pages, PDF user space, y up) and
// `buildDrawingPdf` (a real minimal PDF 1.4, no library). Pure functions; running it writes nothing.
import type { Px } from '../src/types';
import type { VectorPage, VFill, VStroke, VText } from '../src/import/types';
import { mulberry32 } from '../src/core/geometry';

export const PT_PER_M = 31.7;
export const ELEV_PT_PER_M = 27.3;
const A4_W = 595, A4_H = 842;
/** where the world origin (the truth frame's (0, 0)) sits in the design frame, points */
const OX = 300, OY = 200;

/** Truth-frame metres -> design frame (x right, y down, text reads left to right), points. */
export const designOf = (x: number, z: number): Px => ({ x: OX + x * PT_PER_M, y: OY + z * PT_PER_M });
/** Design frame -> raw PDF user space. The content is rotated 90 degrees on the page, like the reference. */
const rawOf = (p: Px): Px => ({ x: p.y, y: p.x });

/** The importer puts its origin at the centre of the wall bbox. In the truth frame that centre is here. */
export const WALL_BBOX_M = { x0: -0.23, x1: 4.23, z0: -0.12, z1: 6.55 };
export const IMPORT_ORIGIN_M = { x: (WALL_BBOX_M.x0 + WALL_BBOX_M.x1) / 2, z: (WALL_BBOX_M.z0 + WALL_BBOX_M.z1) / 2 };
/** truth frame -> the importer's frame */
export const truthToImport = (x: number, z: number): { x: number; z: number } => ({ x: x - IMPORT_ORIGIN_M.x, z: z - IMPORT_ORIGIN_M.z });
export const importToTruth = (x: number, z: number): { x: number; z: number } => ({ x: x + IMPORT_ORIGIN_M.x, z: z + IMPORT_ORIGIN_M.z });

type Prim =
  | { t: 'fill'; color: string; pts: Px[]; rect?: boolean }
  | { t: 'stroke'; color: string; width: number; pts: Px[]; closed: boolean }
  | { t: 'arc'; color: string; width: number; c: Px; r: number; a0: number; a1: number }
  | { t: 'text'; str: string; x: number; y: number; size: number };

// ---------------------------------------------------------------- Helvetica widths (AFM, per 1000)
const W: Record<string, number> = {
  ' ': 278, "'": 191, '"': 355, '=': 584, '-': 333, '.': 278, '1': 556, '0': 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
};
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += W[ch] ?? (ch >= '0' && ch <= '9' ? 556 : 556);
  return (w / 1000) * size;
}

// ---------------------------------------------------------------- the plan page

/** Axis-aligned rectangle in truth metres as design points, 4 corners clockwise on screen. */
function rectM(x0: number, z0: number, x1: number, z1: number): Px[] {
  return [designOf(x0, z0), designOf(x1, z0), designOf(x1, z1), designOf(x0, z1)];
}
function triPair(color: string, q: Px[]): Prim[] {
  return [{ t: 'fill', color, pts: [q[0], q[1], q[2]] }, { t: 'fill', color, pts: [q[0], q[2], q[3]] }];
}

function arcM(cx: number, cz: number, r: number, aDeg0: number, aDeg1: number): Prim {
  const c = designOf(cx, cz);
  return { t: 'arc', color: '#000000', width: 0.15, c, r: r * PT_PER_M, a0: (aDeg0 * Math.PI) / 180, a1: (aDeg1 * Math.PI) / 180 };
}

function textM(str: string, xM: number, zM: number, size: number): Prim {
  const p = designOf(xM, zM);
  return { t: 'text', str, x: p.x, y: p.y, size };
}

function planPrims(): Prim[] {
  const P: Prim[] = [];
  const OUTER = '#666666', PART = '#b3b3b3';
  // outer walls, 0.23 m, as triangle pairs like the reference's CAD export
  const outer: [number, number, number, number][] = [
    [-0.23, -0.12, 0, 3.4],      // west, above the window
    [-0.23, 4.6, 0, 6.55],       // west, below the window
    [4, -0.12, 4.23, 5.27],      // east, above the main door
    [4, 6.17, 4.23, 6.55],       // east, below the main door
    [0, 6.32, 4, 6.55],          // south
  ];
  for (const r of outer) P.push(...triPair(OUTER, rectM(...r)));
  // partitions, 0.12 m, plain rectangles
  const part: [number, number, number, number][] = [
    [0, -0.12, 1.2, 0],          // north of the bedroom, left of the sliding opening
    [2.8, -0.12, 4, 0],          // right of it
    // The stub left of the door runs under the west wall to the outer face. At 31.7 pt per metre a bare 0.4 x 0.12 m
    // stub is 48 pt^2, under the 0.01% of an A4 page (50 pt^2) that 13.5 step 3 asks of a wall candidate.
    [-0.23, 5, 0.4, 5.12],       // bedroom / passage, left of the door
    [1.3, 5, 4, 5.12],           // right of it
  ];
  for (const r of part) P.push({ t: 'fill', color: PART, pts: rectM(...r), rect: true });
  // hairline outlines of the wall fills, as fill-and-stroke leaves them in the reference
  for (const r of outer) P.push({ t: 'stroke', color: OUTER, width: 0, pts: rectM(...r), closed: true });

  // door swings: quarter circles, the hinge on one end of the gap
  P.push(arcM(0.4, 5.06, 0.9, 0, -90));
  P.push(arcM(4.115, 6.17, 0.9, -90, -180));
  // window: three parallel strokes across the gap in the west wall
  for (const x of [-0.23, -0.115, 0]) P.push({ t: 'stroke', color: '#333333', width: 0.04, pts: [designOf(x, 3.4), designOf(x, 4.6)], closed: false });
  // balcony railing: one stroke on three sides
  P.push({ t: 'stroke', color: '#000000', width: 0.3, pts: [designOf(0.5, -0.12), designOf(0.5, -1.62), designOf(3.5, -1.62), designOf(3.5, -0.12)], closed: false });

  // furniture outlines
  const box = (x0: number, z0: number, x1: number, z1: number): Prim => ({ t: 'stroke', color: '#000000', width: 0.15, pts: rectM(x0, z0, x1, z1), closed: true });
  P.push(box(0, 1.5, 2.0, 3.0));        // bed
  P.push(box(3.1, 2.5, 4.0, 4.5));      // sofa
  P.push(box(3.45, 0.6, 3.9, 1.2));     // side table, 45 x 60 cm

  // drawing border and title block
  const bx0 = 30, by0 = 30, bx1 = 812, by1 = 565;
  P.push({ t: 'stroke', color: '#000000', width: 0.5, pts: [{ x: bx0, y: by0 }, { x: bx1, y: by0 }, { x: bx1, y: by1 }, { x: bx0, y: by1 }], closed: true });
  P.push({ t: 'stroke', color: '#000000', width: 0.3, pts: [{ x: 560, y: 490 }, { x: bx1, y: 490 }, { x: bx1, y: by1 }, { x: 560, y: by1 }], closed: true });

  // text, design frame, reads left to right
  P.push(textM('BEDROOM 1', 1.6, 3.55, 6.5));
  P.push(textM('13\'1"X16\'5"', 1.6, 3.55 + 0.3, 5.5));
  P.push(textM('215 SQFT', 1.6, 3.55 + 0.56, 5.5));
  P.push(textM('BALCONY', 1.4, -1.15, 6.5));
  P.push(textM('9\'10"X4\'11"', 1.4, -0.87, 5.5));
  P.push(textM('PASSAGE', 1.2, 5.5, 6.5));
  P.push(textM('13\'1"X3\'11"', 1.2, 5.77, 5.5));
  P.push(textM('BED', 0.4, 2.15, 4.5));
  P.push(textM('4\'11"X6\'7"', 0.4, 2.3, 4.5));
  P.push(textM('SOFA', 3.25, 2.95, 4.5));
  P.push(textM('6\'7"X2\'11"', 3.2, 3.1, 4.5));
  P.push(textM('SIDE TABLE', 2.4, 0.95, 4.5));
  P.push(textM('2\'0"X1\'6"', 2.4, 1.1, 4.5));
  P.push({ t: 'text', str: 'PLAN', x: 690, y: 520, size: 12 });
  P.push({ t: 'text', str: 'TEST FLAT', x: 580, y: 520, size: 9 });
  return P;
}

/** Six dimension lines with ticks outside the walls, a hatch of 200 short strokes, 300 glyph-like black shapes. */
function noisePrims(seed: number): Prim[] {
  const P: Prim[] = [];
  const rnd = mulberry32(seed);
  const dim = (a: Px, b: Px): void => {
    P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [a, b], closed: false });
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const nx = -dy / L * 4, ny = dx / L * 4;
    for (const e of [a, b]) P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [{ x: e.x - nx, y: e.y - ny }, { x: e.x + nx, y: e.y + ny }], closed: false });
    // the dimension text is an exploded font: a few tiny strokes at the middle
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    for (let i = 0; i < 4; i++) P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [{ x: mx + i * 2.5 - 5, y: my - 3 }, { x: mx + i * 2.5 - 4, y: my - 1 }, { x: mx + i * 2.5 - 5, y: my + 1 }], closed: false });
  };
  dim(designOf(-0.23, -2.3), designOf(4.23, -2.3));
  dim(designOf(-0.9, -0.12), designOf(-0.9, 6.55));
  dim(designOf(-0.23, 7.3), designOf(4.23, 7.3));
  dim(designOf(5.0, -0.12), designOf(5.0, 6.55));
  dim(designOf(-1.5, 0), designOf(-1.5, 5));
  dim(designOf(5.6, 0), designOf(5.6, 5));
  // hatch: short diagonal strokes in a block to the right of the flat
  for (let i = 0; i < 200; i++) {
    const x = 520 + (i % 20) * 6, y = 150 + Math.floor(i / 20) * 14;
    P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [{ x, y }, { x: x + 4, y: y + 5 }], closed: false });
  }
  // glyph noise: tiny black polygons around the title block, notes area and far margins
  for (let i = 0; i < 300; i++) {
    const x = 40 + rnd() * 500 + (i % 3 === 0 ? 0 : 0), y = 440 + rnd() * 45;
    const s = 1.5 + rnd() * 1.5;
    P.push({ t: 'fill', color: '#000000', pts: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s * 0.4 }, { x: x + s * 0.4, y: y + s * 0.4 }, { x: x + s * 0.4, y: y + s }, { x, y: y + s }] });
  }
  return P;
}

// ---------------------------------------------------------------- the elevation page

function elevationPrims(variant: 'A' | 'B'): Prim[] {
  const S = ELEV_PT_PER_M;
  const P: Prim[] = [];
  const X0 = 300, X1 = X0 + 5.0 * S;          // clear width 5.0 m
  const slabUnder = 150, floor = slabUnder + 2.6 * S; // clear height 2.6 m
  const wallT = 0.23 * S, slabT = 0.25 * S;
  const GREY = '#666666';
  const rect = (x0: number, y0: number, x1: number, y1: number): Px[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const slab = rect(X0 - wallT, slabUnder - slabT, X1 + wallT, slabUnder);
  P.push({ t: 'fill', color: GREY, pts: [slab[0], slab[1], slab[2]] }, { t: 'fill', color: GREY, pts: [slab[0], slab[2], slab[3]] });
  P.push({ t: 'fill', color: GREY, pts: rect(X0 - wallT, slabUnder, X0, floor), rect: true });
  P.push({ t: 'fill', color: GREY, pts: rect(X1, slabUnder, X1 + wallT, floor), rect: true });
  P.push({ t: 'stroke', color: '#000000', width: 0.4, pts: [{ x: X0 - wallT, y: floor }, { x: X1 + wallT, y: floor }], closed: false });
  // a window drawn on the elevation, some linework, the border
  P.push({ t: 'stroke', color: '#000000', width: 0.15, pts: rect(X0 + 40, slabUnder + 15, X0 + 100, slabUnder + 50), closed: true });
  for (let i = 0; i < 12; i++) P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [{ x: X0 + 42 + i * 5, y: slabUnder + 50 }, { x: X0 + 50 + i * 5, y: slabUnder + 17 }], closed: false });
  P.push({ t: 'stroke', color: '#000000', width: 0.5, pts: [{ x: 30, y: 30 }, { x: 812, y: 30 }, { x: 812, y: 565 }, { x: 30, y: 565 }], closed: true });
  P.push({ t: 'text', str: 'ELEVATION-1', x: 690, y: 520, size: 12 });
  P.push({ t: 'text', str: 'TEST FLAT', x: 580, y: 520, size: 9 });
  if (variant === 'A') P.push({ t: 'text', str: 'CLG HT 8\'6"', x: X0 + 20, y: floor + 25, size: 6 });
  // dimension-like strokes for the 5.0 m width (an exploded font, no text)
  P.push({ t: 'stroke', color: '#000000', width: 0.04, pts: [{ x: X0, y: floor + 14 }, { x: X1, y: floor + 14 }], closed: false });
  return P;
}

// ---------------------------------------------------------------- prims -> VectorPage

function flattenArc(p: Extract<Prim, { t: 'arc' }>): Px[] {
  const n = 12;
  const out: Px[] = [];
  for (let i = 0; i <= n; i++) {
    const a = p.a0 + ((p.a1 - p.a0) * i) / n;
    out.push({ x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) });
  }
  return out;
}

function areaOf(pts: Px[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
}

function toPage(index: number, prims: Prim[]): VectorPage {
  const fills: VFill[] = []; const strokes: VStroke[] = []; const texts: VText[] = [];
  for (const p of prims) {
    if (p.t === 'fill') {
      const pts = p.pts.map(rawOf);
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      fills.push({ color: p.color, rings: [pts], area: areaOf(pts), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    } else if (p.t === 'stroke') {
      strokes.push({ color: p.color, width: p.width, points: p.pts.map(rawOf), closed: p.closed, hasCurve: false });
    } else if (p.t === 'arc') {
      strokes.push({ color: p.color, width: p.width, points: flattenArc(p).map(rawOf), closed: false, hasCurve: true });
    } else {
      const q = rawOf({ x: p.x, y: p.y });
      texts.push({ str: p.str, x: q.x, y: q.y, width: textWidth(p.str, p.size), size: p.size, angle: 90 });
    }
  }
  return { index, width: A4_W, height: A4_H, fills, strokes, texts, imageCoverage: 0 };
}

function allPrims(variant: 'A' | 'B'): Prim[][] {
  return [[...planPrims(), ...noisePrims(7)], elevationPrims(variant)];
}

/** Already-parsed pages in PDF user space (y up, text angle 90), as `loadVectorPages` returns them. */
export function buildDrawingPages(variant: 'A' | 'B'): VectorPage[] {
  return allPrims(variant).map((p, i) => toPage(i, p));
}

// ---------------------------------------------------------------- minimal PDF 1.4 writer

const n3 = (v: number): string => (Math.round(v * 1000) / 1000).toString();
const rgb = (hex: string): string => [1, 3, 5].map((i) => n3(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function contentStream(prims: Prim[]): string {
  const o: string[] = ['q 1 0 0 1 0 0 cm'];
  for (const p of prims) {
    if (p.t === 'fill') {
      const pts = p.pts.map(rawOf);
      o.push(`${rgb(p.color)} rg`);
      const isRect = p.rect && pts.length === 4;
      if (isRect) {
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        o.push(`${n3(x0)} ${n3(y0)} ${n3(Math.max(...xs) - x0)} ${n3(Math.max(...ys) - y0)} re f`);
      } else {
        o.push(pts.map((q, i) => `${n3(q.x)} ${n3(q.y)} ${i ? 'l' : 'm'}`).join(' ') + ' h f');
      }
    } else if (p.t === 'stroke') {
      const pts = p.pts.map(rawOf);
      o.push(`${rgb(p.color)} RG ${n3(p.width)} w`);
      o.push(pts.map((q, i) => `${n3(q.x)} ${n3(q.y)} ${i ? 'l' : 'm'}`).join(' ') + (p.closed ? ' h S' : ' S'));
    } else if (p.t === 'arc') {
      // one cubic per quarter circle
      const segs = Math.max(1, Math.ceil(Math.abs(p.a1 - p.a0) / (Math.PI / 2) - 1e-9));
      const step = (p.a1 - p.a0) / segs;
      const k = (4 / 3) * Math.tan(step / 4);
      o.push(`${rgb(p.color)} RG ${n3(p.width)} w`);
      const at = (a: number): Px => rawOf({ x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) });
      const d = (a: number): Px => rawOf({ x: -p.r * Math.sin(a), y: p.r * Math.cos(a) });
      const s0 = at(p.a0);
      let path = `${n3(s0.x)} ${n3(s0.y)} m`;
      for (let i = 0; i < segs; i++) {
        const a = p.a0 + step * i, b = a + step;
        const A = at(a), B = at(b), dA = d(a), dB = d(b);
        path += ` ${n3(A.x + k * dA.x)} ${n3(A.y + k * dA.y)} ${n3(B.x - k * dB.x)} ${n3(B.y - k * dB.y)} ${n3(B.x)} ${n3(B.y)} c`;
      }
      o.push(`${path} S`);
    } else {
      const q = rawOf({ x: p.x, y: p.y });
      o.push(`0 g BT /F1 ${n3(p.size)} Tf 0 1 -1 0 ${n3(q.x)} ${n3(q.y)} Tm (${esc(p.str)}) Tj ET`);
    }
  }
  o.push('Q');
  return o.join('\n');
}

/** A real, minimal PDF 1.4: Helvetica, one content stream per page, correct xref table and trailer. */
export function buildDrawingPdf(variant: 'A' | 'B'): Uint8Array {
  const pages = allPrims(variant);
  const objs: string[] = [];
  const nPages = pages.length;
  // 1 catalog, 2 pages, 3 font, then (page, contents) pairs
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
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

/** A page that is one full-page image and no paths, as a raster scan reads. */
export function buildRasterPage(index = 0): VectorPage {
  return { index, width: A4_W, height: A4_H, fills: [], strokes: [], texts: [], imageCoverage: 1 };
}

// ---------------------------------------------------------------- truth for the tests

export const FIXTURE_TRUTH = {
  ptPerM: PT_PER_M,
  elevationPtPerM: ELEV_PT_PER_M,
  /** gap widths the importer should find, metres */
  gapWidthsM: [0.9, 1.6, 1.2, 0.9],
  rooms: [
    { label: 'Bedroom 1', type: 'bedroom', areaM2: 20.0, method: 'walls', polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 5 }, { x: 0, z: 5 }] },
    { label: 'Passage', type: 'other', areaM2: 4.8, method: 'walls', polygon: [{ x: 0, z: 5.12 }, { x: 4, z: 5.12 }, { x: 4, z: 6.32 }, { x: 0, z: 6.32 }] },
    { label: 'Balcony', type: 'balcony', areaM2: 4.5, method: 'walls+strokes', polygon: [{ x: 0.5, z: -1.62 }, { x: 3.5, z: -1.62 }, { x: 3.5, z: -0.12 }, { x: 0.5, z: -0.12 }] },
  ],
  /** truth-frame openings, as in SPEC 3.3 */
  openings: [
    { type: 'door', room: 'Bedroom 1', edge: 2, centreM: 3.15, widthM: 0.9 },
    { type: 'opening', room: 'Bedroom 1', edge: 0, centreM: 2.0, widthM: 1.6 },
    { type: 'window', room: 'Bedroom 1', edge: 3, centreM: 1.0, widthM: 1.2 },
    { type: 'door', room: 'Passage', edge: 1, centreM: 0.6, widthM: 0.9 },
  ],
  bed: { cx: 1.0, cz: 2.25, w: 1.5, d: 2.0, yawDeg: 90 },
  sofa: { cx: 3.55, cz: 3.5, w: 2.0, d: 0.9, yawDeg: 270 },
  ceilingM: { A: 2.5908, B: 2.6 },
};
