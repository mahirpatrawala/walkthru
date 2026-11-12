// C8. SPEC 13.6. The only file in src/import that imports pdfjs-dist. Node/tests/CLI only, never bundled.
// Output is in PDF user space, origin at the page's media box corner, y UP, text angles as written.
// `normalizePage` (vector-page.ts) turns that into the y-down, text-reads-left-to-right model.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Px } from '../types';
import { ImportError } from './types';
import type { VectorPage, VFill, VStroke, VText } from './types';

// SPEC-GAP: SPEC 13.6 says to compare against pdfjs.OPS, never literal numbers. That holds for the paint
// operators below. The path draw codes (moveTo 0, lineTo 1, cubic 2, quadratic 3, close 4) are the stream codes
// of 13.6; pdfjs-dist 6.4.299 does not export its DrawOPS table (it is module-private), so they are literals here.
const D = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

type M = [number, number, number, number, number, number];
const IDENT: M = [1, 0, 0, 1, 0, 0];
/** row-vector convention: result = a applied first, then b */
function mul(a: M, b: M): M {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function apply(m: M, x: number, y: number): Px { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }

interface GState { ctm: M; fill: string; stroke: string; lw: number }

function shape(op: string, what: string): never {
  throw new ImportError('pdfjs-shape', `pdf.js shape changed: operator ${op} ${what}. Expected pdfjs-dist 6.4.x.`);
}

function ringArea(r: Px[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
function inRing(p: Px, r: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]; const b = r[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Group rings into outer + holes by nesting depth (even-odd), one VFill per outer ring. */
function ringsToFills(rings: Px[][], color: string): VFill[] {
  const items = rings.map((r) => ({ r, a: Math.abs(ringArea(r)) })).filter((i) => i.r.length >= 3 && i.a > 1e-9);
  items.sort((p, q) => q.a - p.a);
  const parent: number[] = items.map(() => -1);
  const depth: number[] = items.map(() => 0);
  for (let i = 0; i < items.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (inRing(items[i].r[0], items[j].r) && inRing(items[i].r[Math.floor(items[i].r.length / 2)], items[j].r)) {
        parent[i] = j; depth[i] = depth[j] + 1; break;
      }
    }
  }
  const out: VFill[] = [];
  const outerOf = new Map<number, VFill>();
  for (let i = 0; i < items.length; i++) {
    if (depth[i] % 2 === 0) {
      const xs = items[i].r.map((p) => p.x); const ys = items[i].r.map((p) => p.y);
      const f: VFill = { color, rings: [items[i].r], area: items[i].a, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
      outerOf.set(i, f); out.push(f);
    } else {
      // hole of the nearest even-depth ancestor
      let p = parent[i];
      while (p >= 0 && depth[p] % 2 !== 0) p = parent[p];
      const f = outerOf.get(p);
      if (f) { f.rings.push(items[i].r); f.area -= items[i].a; }
    }
  }
  return out;
}

function flattenCubic(out: Px[], p0: Px, p1: Px, p2: Px, p3: Px, tol: number, depth = 0): void {
  // flatness: max distance of control points from the chord
  const dx = p3.x - p0.x; const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  const d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / len;
  const d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / len;
  if (depth >= 12 || Math.max(d1, d2) <= tol) { out.push(p3); return; }
  const m = (a: Px, b: Px): Px => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = m(p0, p1); const p12 = m(p1, p2); const p23 = m(p2, p3);
  const p012 = m(p01, p12); const p123 = m(p12, p23); const mid = m(p012, p123);
  flattenCubic(out, p0, p01, p012, mid, tol, depth + 1);
  flattenCubic(out, mid, p123, p23, p3, tol, depth + 1);
}

interface Sub { pts: Px[]; closed: boolean; curve: boolean }

function parseSubpaths(op: string, data: ArrayLike<number>, ctm: M): Sub[] {
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let i = 0;
  const n = data.length;
  const need = (k: number): void => { if (i + k > n) shape(op, 'path data is shorter than its draw codes'); };
  while (i < n) {
    const code = data[i++];
    if (code === D.moveTo) {
      need(2);
      cur = { pts: [apply(ctm, data[i], data[i + 1])], closed: false, curve: false }; i += 2; subs.push(cur);
    } else if (code === D.lineTo) {
      need(2);
      if (!cur) shape(op, 'lineTo before moveTo');
      cur!.pts.push(apply(ctm, data[i], data[i + 1])); i += 2;
    } else if (code === D.curveTo) {
      need(6);
      if (!cur) shape(op, 'curveTo before moveTo');
      const p0 = cur!.pts[cur!.pts.length - 1];
      flattenCubic(cur!.pts, p0, apply(ctm, data[i], data[i + 1]), apply(ctm, data[i + 2], data[i + 3]), apply(ctm, data[i + 4], data[i + 5]), 0.25);
      cur!.curve = true; i += 6;
    } else if (code === D.quadraticCurveTo) {
      need(4);
      if (!cur) shape(op, 'quadratic before moveTo');
      // a quadratic (p0, c, p) as a cubic
      const p0 = cur!.pts[cur!.pts.length - 1];
      const c = apply(ctm, data[i], data[i + 1]); const p = apply(ctm, data[i + 2], data[i + 3]);
      const c1 = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
      const c2 = { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) };
      flattenCubic(cur!.pts, p0, c1, c2, p, 0.25);
      cur!.curve = true; i += 4;
    } else if (code === D.closePath) {
      if (cur) { cur.closed = true; }
    } else shape(op, `has unknown draw code ${code}`);
  }
  return subs;
}

export async function loadVectorPages(data: Uint8Array): Promise<VectorPage[]> {
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  if (!OPS) throw new ImportError('pdfjs-shape', 'pdf.js shape changed: OPS is missing. Expected pdfjs-dist 6.4.x.');
  const need = (name: string): number => {
    const v = OPS[name];
    if (typeof v !== 'number') shape(name, 'is missing from OPS');
    return v;
  };
  const OP = {
    save: need('save'), restore: need('restore'), transform: need('transform'), constructPath: need('constructPath'),
    setLineWidth: need('setLineWidth'), setFillRGBColor: need('setFillRGBColor'), setStrokeRGBColor: need('setStrokeRGBColor'),
    fill: need('fill'), eoFill: need('eoFill'), stroke: need('stroke'), closeStroke: need('closeStroke'),
    fillStroke: need('fillStroke'), eoFillStroke: need('eoFillStroke'), closeFillStroke: need('closeFillStroke'),
    closeEOFillStroke: need('closeEOFillStroke'), endPath: need('endPath'),
    formBegin: need('paintFormXObjectBegin'), formEnd: need('paintFormXObjectEnd'),
    img: need('paintImageXObject'), inlineImg: need('paintInlineImageXObject'),
    imgRepeat: OPS.paintImageXObjectRepeat, jpeg: OPS.paintJpegXObject, setGState: OPS.setGState,
  };
  const FILL = new Set([OP.fill, OP.eoFill, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
  const STROKE = new Set([OP.stroke, OP.closeStroke, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
  const IMAGES = new Set([OP.img, OP.inlineImg, OP.imgRepeat, OP.jpeg].filter((v) => typeof v === 'number'));

  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: VectorPage[] = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const [vx0, vy0, vx1, vy1] = page.view as number[];
    const width = vx1 - vx0; const height = vy1 - vy0;
    const base: M = [1, 0, 0, 1, -vx0, -vy0];
    const ol = await page.getOperatorList();
    const fills: VFill[] = []; const strokes: VStroke[] = [];
    let imageArea = 0;
    let st: GState = { ctm: base, fill: '#000000', stroke: '#000000', lw: 1 };
    const stack: GState[] = [];
    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k]; const args = ol.argsArray[k] as unknown;
      if (fn === OP.save) stack.push({ ...st });
      else if (fn === OP.restore) { const p = stack.pop(); if (p) st = p; }
      else if (fn === OP.transform) {
        if (!Array.isArray(args) || args.length < 6) shape('transform', 'has no 6-number matrix');
        st.ctm = mul(args as unknown as M, st.ctm);
      } else if (fn === OP.formBegin) {
        stack.push({ ...st });
        if (Array.isArray(args) && args.length >= 6 && typeof args[0] === 'number') st.ctm = mul(args as unknown as M, st.ctm);
      } else if (fn === OP.formEnd) { const p = stack.pop(); if (p) st = p; }
      else if (fn === OP.setFillRGBColor || fn === OP.setStrokeRGBColor) {
        const c = Array.isArray(args) ? args[0] : undefined;
        if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) shape(fn === OP.setFillRGBColor ? 'setFillRGBColor' : 'setStrokeRGBColor', 'argument is not a #rrggbb string');
        if (fn === OP.setFillRGBColor) st.fill = c.toLowerCase(); else st.stroke = c.toLowerCase();
      } else if (fn === OP.setLineWidth) {
        const w = Array.isArray(args) ? args[0] : undefined;
        if (typeof w !== 'number') shape('setLineWidth', 'argument is not a number');
        st.lw = w as number;
      } else if (fn === OP.setGState && Array.isArray(args) && Array.isArray(args[0])) {
        for (const kv of args[0] as unknown[]) if (Array.isArray(kv) && kv[0] === 'LW' && typeof kv[1] === 'number') st.lw = kv[1];
      } else if (IMAGES.has(fn)) {
        imageArea += Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2]);
      } else if (fn === OP.constructPath) {
        if (!Array.isArray(args) || args.length < 2) shape('constructPath', 'arguments are not [paintOp, [data], minMax]');
        const [paintOp, pathArgs] = args as [number, unknown];
        if (typeof paintOp !== 'number' || !Array.isArray(pathArgs) || !pathArgs[0] || typeof (pathArgs[0] as ArrayLike<number>).length !== 'number') {
          shape('constructPath', 'arguments are not [paintOp, [Float32Array], minMax]');
        }
        if (paintOp === OP.endPath) continue;
        const doFill = FILL.has(paintOp); const doStroke = STROKE.has(paintOp);
        if (!doFill && !doStroke) continue;
        const subs = parseSubpaths('constructPath', pathArgs[0] as ArrayLike<number>, st.ctm);
        const scale = Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2]));
        if (doFill) {
          const rings = subs.filter((s) => s.pts.length >= 3).map((s) => s.pts);
          fills.push(...ringsToFills(rings, st.fill));
        }
        if (doStroke) {
          for (const s of subs) {
            if (s.pts.length < 2) continue;
            let pts = s.pts; let closed = s.closed;
            const f = pts[0]; const l = pts[pts.length - 1];
            if (pts.length > 2 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) { closed = true; pts = pts.slice(0, -1); }
            strokes.push({ color: st.stroke, width: st.lw * scale, points: pts, closed, hasCurve: s.curve });
          }
        }
      }
    }
    const tc = await page.getTextContent();
    const texts: VText[] = [];
    for (const it of tc.items as unknown as { str?: string; transform?: number[]; width?: number }[]) {
      if (typeof it.str !== 'string' || !Array.isArray(it.transform) || it.transform.length < 6) continue;
      if (it.str.trim() === '') continue;
      const [a, b, , , e, f] = it.transform;
      texts.push({
        str: it.str, x: e - vx0, y: f - vy0, width: it.width ?? 0,
        size: Math.hypot(a, b), angle: (Math.atan2(b, a) * 180) / Math.PI,
      });
    }
    pages.push({ index: pn - 1, width, height, fills, strokes, texts, imageCoverage: Math.min(1, imageArea / (width * height)) });
  }
  try { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  return pages;
}
