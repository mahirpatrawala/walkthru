// C12b. SPEC 17.5 items 1 and 2 together: every readable string on a page, as candidates with their method. PDF text is read
// as it is; stroke text goes through the glyph reader (glyphs.ts) and comes back as ordinary text runs, so the C8 label code
// (labels.ts) and the dimension stage see one thing. Pure TypeScript.
import type { VText, VectorPage } from '../import/types';
import { isYDown, readToVText, vtextBox, wrap180, wrap360 } from './reads';
import type { TextRead } from './reads';
import { readGlyphs } from './glyphs';
import { plausibleText } from './plausible';
import { findArea, findSize } from './units';
import { fixtureClassOf, furnitureOf, isRoomLabel } from './lexicon';
import type { GlyphOptions } from './glyphs';
import { parseLabels } from '../import/labels';

/** C8's label parser, wrapped: rooms and furniture labels found in a page's text runs. */
export const labelsOf = (page: VectorPage): ReturnType<typeof parseLabels> => parseLabels(page.texts);

/** Real PDF text of a page as candidate reads (y-down frame). Runs that were synthesised from glyphs are not PDF text. */
export function pdfReads(page: VectorPage): TextRead[] {
  const yDown = isYDown(page);
  const out: TextRead[] = [];
  page.texts.forEach((t, i) => {
    if (t.src === 'glyph' || !t.str.trim()) return;
    const b = vtextBox(t, yDown, page.height);
    out.push({ id: `p${i}`, method: 'pdf-text', str: t.str.trim(), bbox: b.box, angle: b.angle, size: t.size, origin: b.origin, length: t.width, confidence: 0.99 });
  });
  return out;
}

/** A string C8's label code would use: a room or furniture word, a fixture, a size or an area (not a bare length, not a caption word). */
export function labelLike(str: string): boolean {
  return isRoomLabel(str) || !!furnitureOf(str, false) || !!fixtureClassOf(str) || !!findSize(str) || !!findArea(str);
}

export interface PageText {
  /** the page with glyph-read strings added as text runs and the strokes they used removed (raw frame, ready to normalise) */
  page: VectorPage;
  /** the glyph reads, y-down frame of the raw page */
  glyphReads: TextRead[];
  consumed: number;
}

/**
 * Read stroke text on a raw page and fold it in. Only strings that look like drawing text are added as runs; the strokes
 * themselves stay where they are.
 */
export function readPageText(page: VectorPage, opts: GlyphOptions & { glyphs?: boolean } = {}): PageText {
  if (opts.glyphs === false || page.strokes.length < 8) return { page, glyphReads: [], consumed: 0 };
  const { reads } = readGlyphs(page, opts);
  // A page that already has its own text (a drawing whose labels are text and whose dimensions are strokes) keeps C8's text
  // exactly as it was; stroke-read strings join it only when they say something C8 reads (a room, a piece of furniture, a
  // size or area), never as bare lengths, which the dimension stage takes from the reads directly. A page with next to no
  // text is lettered in strokes throughout and takes every plausible string.
  const strokeLettered = page.texts.length < 8;
  const keep = reads.filter((r) => {
    const md = r.glyphs ? r.glyphs.reduce((a, g) => a + g.d, 0) / r.glyphs.length : 1;
    if (r.tentative || !plausibleText(r.str, md)) return false;
    return strokeLettered || labelLike(r.str);
  });
  const texts: VText[] = [...page.texts, ...keep.map((r) => ({ ...readToVText(r, page), src: 'glyph' as const }))];
  // the strokes stay in the linework: taking them out changed the outline of a wardrobe symbol on a real drawing, and C8 has always
  // met stroked lettering as strokes
  const used = new Set<number>(keep.flatMap((r) => r.strokes ?? []));
  return { page: { ...page, texts }, glyphReads: reads, consumed: used.size };
}

/**
 * The page as the dimension stage should see it: the strokes that drew a glyph-read string taken out, so the digits' own stems
 * are never mistaken for ticks or dimension lines. (The importer's page keeps them: C8 has always met stroked lettering as strokes.)
 */
export function withoutReadStrokes(norm: VectorPage, reads: TextRead[]): VectorPage {
  const drop = new Set<number>(reads.flatMap((r) => (r.method === 'glyph' ? r.strokes ?? [] : [])));
  return drop.size ? { ...norm, strokes: norm.strokes.filter((_, i) => !drop.has(i)) } : norm;
}

/** Where a raw-frame point (y-down) lands after `normalizePage` turned the page by -phi. */
function rotateWith(phiDeg: number, W: number, H: number): { map: (x: number, y: number) => [number, number]; dAngle: number } {
  const rad = (phiDeg * Math.PI) / 180;
  const c = Math.round(Math.cos(rad)), s = Math.round(Math.sin(rad));
  const rot = (x: number, y: number): [number, number] => [c * x + s * y, -s * x + c * y];
  const corners = [rot(0, 0), rot(W, 0), rot(0, H), rot(W, H)];
  const minX = Math.min(...corners.map((q) => q[0])), minY = Math.min(...corners.map((q) => q[1]));
  return { map: (x, y) => { const r = rot(x, y); return [r[0] - minX, r[1] - minY]; }, dAngle: -phiDeg };
}

/** A box of the normalised page as a box of the raw page (y down), for cutting a crop out of the page as it was drawn. */
export function normalisedBoxToRaw(box: [number, number, number, number], raw: VectorPage, norm: VectorPage): [number, number, number, number] {
  const rotationDeg = (norm as { rotationDeg?: number }).rotationDeg ?? 0;
  const phi = -rotationDeg;
  const rad = (phi * Math.PI) / 180;
  const c = Math.round(Math.cos(rad)), s = Math.round(Math.sin(rad));
  const W = raw.width, H = raw.height;
  const rot = (x: number, y: number): [number, number] => [c * x + s * y, -s * x + c * y];
  const corners = [rot(0, 0), rot(W, 0), rot(0, H), rot(W, H)];
  const minX = Math.min(...corners.map((q) => q[0])), minY = Math.min(...corners.map((q) => q[1]));
  const inv = (xn: number, yn: number): [number, number] => { const a = xn + minX, b = yn + minY; return [c * a - s * b, s * a + c * b]; };
  const pts = [inv(box[0], box[1]), inv(box[2], box[1]), inv(box[0], box[3]), inv(box[2], box[3])];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** Glyph reads (raw y-down frame) moved into the frame of the same page after normalisation. */
export function readsToNormalised(reads: TextRead[], raw: VectorPage, norm: VectorPage): TextRead[] {
  const rotationDeg = (norm as { rotationDeg?: number }).rotationDeg ?? 0;
  const { map, dAngle } = rotateWith(-rotationDeg, raw.width, raw.height);
  return reads.map((r) => {
    const pts = [[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[1]], [r.bbox[0], r.bbox[3]], [r.bbox[2], r.bbox[3]]].map(([x, y]) => map(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { ...r, origin: map(r.origin[0], r.origin[1]), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as TextRead['bbox'], angle: wrap360(r.angle + dAngle) };
  });
}

/**
 * Every candidate read of a normalised page: its PDF text plus the glyph reads that were accepted as text. Duplicates (the same
 * place read twice) keep the PDF text.
 */
export function pageReads(norm: VectorPage, glyphReadsNorm: TextRead[]): TextRead[] {
  const pdf = pdfReads(norm);
  const glyph = glyphReadsNorm.filter((g) => !g.tentative || true).filter((g) => {
    const md = g.glyphs ? g.glyphs.reduce((a, x) => a + x.d, 0) / g.glyphs.length : 1;
    return plausibleText(g.str, md);
  });
  const overlap = (a: TextRead, b: TextRead): number => {
    const w = Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]), h = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]);
    if (w <= 0 || h <= 0) return 0;
    const ia = w * h, ua = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
    return ia / Math.max(1e-9, ua);
  };
  return [...pdf, ...glyph.filter((g) => !pdf.some((p) => overlap(g, p) > 0.5))];
}

export { wrap180, plausibleText };
