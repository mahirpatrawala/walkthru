// C12b: the stroke-glyph reader (SPEC 17.5 item 2, 17.12 item 4). Strings are drawn with the Hershey faces, leaned and
// stretched, at all four reading directions, and read back. Always runs; no real file, no network.
import { describe, expect, it } from 'vitest';
import type { VectorPage } from '../src/import/types';
import { layoutString } from '../src/understand/hershey';
import type { Face } from '../src/understand/hershey';
import { readGlyphs } from '../src/understand/glyphs';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { c12bPipeline } from '../scripts/eval/adapters';
import { scoreSet } from '../scripts/eval/score';

const STRINGS = ["2'-11\"", "8'-6\"", "1'-5½\"", "12'0\"", '9"', "29'-11\"", "5' 6\"", "2'11\"", '4½"', '2440', '1550', '115', '230', '3.050', '0.45', '12.14', '7635', '16755', "4'-0\"", "10'-0\"", "1'-8\"", "6'-4\"", "13'6\"", '0.178', '1.413', '900', "21'-11\"", "3'-2\"", "11'-6\"", "8'-6\""];

function page(face: Face, slantDeg: number, widthScale: number, rotDeg: number, strings = STRINGS, capH = 4.3): VectorPage {
  const strokes: VectorPage['strokes'] = [];
  strings.forEach((s, k) => {
    const ox = 40 + (k % 5) * 90, oy = 40 + Math.floor(k / 5) * 40;
    for (const poly of layoutString(s, { capH, face, slantDeg, widthScale })) strokes.push({ color: '#000000', width: 0.2, points: poly.map(([x, yy]) => ({ x: ox + x, y: oy - yy })), closed: false, hasCurve: false });
  });
  const c = Math.cos((rotDeg * Math.PI) / 180), sn = Math.sin((rotDeg * Math.PI) / 180);
  for (const s of strokes) s.points = s.points.map((p) => ({ x: 250 + (p.x - 250) * c - (p.y - 150) * sn, y: 150 + (p.x - 250) * sn + (p.y - 150) * c }));
  return { index: 0, width: 500, height: 300, fills: [], strokes, texts: [], imageCoverage: 0, normalized: true } as VectorPage;
}
/** how many of the strings come back exactly (a string with a space comes back as its words) */
function hits(reads: string[], strings = STRINGS): number {
  const bag = [...reads]; let ok = 0;
  for (const s of strings) { const toks = s.split(' '); if (toks.every((t) => bag.includes(t))) { ok++; for (const t of toks) bag.splice(bag.indexOf(t), 1); } }
  return ok;
}

describe('17.12 item 4: the glyph reader on the three Hershey faces, slant up to 15 degrees', () => {
  it('reads at least 96% of dimension strings exactly across faces, slants, widths and reading directions', () => {
    let ok = 0, n = 0;
    for (const face of ['simplex', 'duplex', 'complex'] as Face[]) for (const [slant, ws, rot] of [[15, 1.1, 270], [0, 1, 90], [8, 0.9, 180]] as [number, number, number][]) {
      const reads = readGlyphs(page(face, slant, ws, rot)).reads.map((r) => r.str);
      ok += hits(reads); n += STRINGS.length;
    }
    expect(ok / n, `${ok} of ${n}`).toBeGreaterThanOrEqual(0.96);
  }, 60000);
  it('reads words and mixed lines too (room names), in any direction, and says which way they read', () => {
    const words = ['MASTER BEDROOM', 'LIVING ROOM', 'KITCHEN', 'WARDROBE', 'FLOOR PLAN'];
    for (const rot of [0, 90, 180, 270]) {
      const r = readGlyphs(page('simplex', 0, 1, rot, words, 5)).reads;
      const got = r.map((x) => x.str);
      for (const w of words.flatMap((x) => x.split(' '))) expect(got, `${w} at ${rot}`).toContain(w);
      expect(new Set(r.map((x) => x.angle))).toEqual(new Set([rot]));
    }
  });
  it('each read carries its strokes and a box, and the strokes belong to it', () => {
    const p = page('simplex', 0, 1, 0, ["2'-11\"", '1550']);
    const { reads, consumed } = readGlyphs(p);
    expect(reads.length).toBe(2);
    for (const r of reads) { expect(r.method).toBe('glyph'); expect(r.strokes!.length).toBeGreaterThan(3); expect(r.bbox[2]).toBeGreaterThan(r.bbox[0]); expect(r.glyphs!.length).toBe(r.str.length); }
    expect(consumed.size).toBe(p.strokes.length);
  });
});

describe('what is not text is left alone', () => {
  it('hatching, ruled lines, circles and rectangles of text size produce no read', () => {
    const strokes: VectorPage['strokes'] = [];
    for (let k = 0; k < 200; k++) strokes.push({ color: '#000', width: 0.1, points: [{ x: 20 + k * 2, y: 50 }, { x: 28 + k * 2, y: 58 }], closed: false, hasCurve: false });
    for (let k = 0; k < 20; k++) { const cx = 30 + k * 20, cy = 150; const pts = Array.from({ length: 20 }, (_, i) => ({ x: cx + 3 * Math.cos((i * 2 * Math.PI) / 20), y: cy + 3 * Math.sin((i * 2 * Math.PI) / 20) })); strokes.push({ color: '#000', width: 0.2, points: pts, closed: true, hasCurve: true }); }
    for (let k = 0; k < 20; k++) strokes.push({ color: '#000', width: 0.2, points: [{ x: 30 + k * 20, y: 200 }, { x: 36 + k * 20, y: 200 }, { x: 36 + k * 20, y: 204 }, { x: 30 + k * 20, y: 204 }], closed: true, hasCurve: false });
    const r = readGlyphs({ index: 0, width: 500, height: 300, fills: [], strokes, texts: [], imageCoverage: 0, normalized: true } as VectorPage).reads;
    expect(r.filter((x) => /\d{2}|[A-Z]{3}/.test(x.str))).toEqual([]);
  });
});

describe('a font the templates do not hold', () => {
  it('a seeded distortion of Simplex: reads fall back to tentative shape clusters, and no wrong value becomes verified', async () => {
    let tentative = 0, verified = 0, wrong = 0;
    for (const seed of [19]) {
      const b = buildSet(seed, { textMode: 'glyph', font: 'distorted', slantDeg: 0, widthScale: 1, notToScale: false } as never);
      const pages = vectorPagesOf(b);
      tentative += pages.flatMap((p) => readGlyphs(p).reads).filter((r) => r.tentative).length;
      const pred = await c12bPipeline({ kind: 'vector', id: 'x', pages });
      const sc = scoreSet(pred, b.truth as never);
      verified += sc.verified.n; wrong += sc.verified.wrong;
    }
    expect(tentative).toBeGreaterThan(0);
    expect(wrong).toBe(0);
    void verified;
  }, 90000);
});
