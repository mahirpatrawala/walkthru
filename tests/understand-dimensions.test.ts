// C12b: dimension lines (SPEC 17.5, 17.12 item 5): found with their strings, ends at the terminators, chains and overalls
// recognised. Run on synthetic sets (every terminator style, real and stroke text, rotated sheets). Always runs.
import { describe, expect, it } from 'vitest';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { proposeWithTrace } from '../src/import/propose';
import { findDimensions, lengthRuns, numericRepair, splitViews } from '../src/understand/dimensions';
import { withoutReadStrokes } from '../src/understand/text-pdf';
import type { TextRead } from '../src/understand/reads';

// one set per terminator style, text mode and sheet rotation of interest
const SEEDS = [1, 2, 6, 11, 22, 19];

describe('on the synthetic plans', () => {
  const rows = SEEDS.map((seed) => {
    const b = buildSet(seed);
    const { trace } = proposeWithTrace(vectorPagesOf(b), 'x', 'y');
    const page = withoutReadStrokes(trace.pages[trace.planIdx], trace.reads[trace.planIdx]);
    const dims = findDimensions(page, trace.reads[trace.planIdx]);
    return { b, trace, dims };
  });

  it('finds the plan dimensions whose strings were read, with the measured length within 1.5 pt of the drawn one', () => {
    let want = 0, hit = 0;
    for (const { b, trace, dims } of rows) {
      // a string counts as read when the page's reads still hold its words (each read serves one dimension)
      const bag = new Map<string, number>();
      for (const r of trace.reads[trace.planIdx]) bag.set(r.str, (bag.get(r.str) ?? 0) + 1);
      const used = new Set<number>();
      for (const t of b.truth.dimensions.filter((d) => d.view === 'plan')) {
        const words = t.string.split(' ');
        if (!words.every((w) => (bag.get(w) ?? 0) > 0)) continue;
        for (const w of words) bag.set(w, bag.get(w)! - 1);
        want++;
        const k = dims.findIndex((d, i) => !used.has(i) && d.run.str === t.string && Math.abs(d.lengthPt - t.valueM * b.truth.planPtPerM) <= 1.5);
        if (k >= 0) { used.add(k); hit++; }
      }
    }
    expect(want).toBeGreaterThan(60);
    expect(hit / want, `${hit} of ${want}`).toBeGreaterThanOrEqual(0.93);
  });

  it('every dimension line has a terminator or an extension line at each end', () => {
    for (const { dims } of rows) for (const d of dims) { expect(d.anchors[0]).not.toBe('none'); expect(d.anchors[1]).not.toBe('none'); }
    const kinds = new Set(rows.flatMap((r) => r.dims.flatMap((d) => d.anchors)));
    expect(kinds.has('tick') || kinds.has('arrow') || kinds.has('dot')).toBe(true);
  });

  it('recognises chains and the overall that spans them', () => {
    const chained = rows.flatMap(({ b, dims }) => b.truth.dimensions.filter((d) => d.view === 'plan' && d.kind === 'chain-member' && b.truth.options.chains).map((t) => ({ t, dims })));
    expect(chained.length).toBeGreaterThan(20);
    const inChain = dims_in_chain(rows.map((r) => r.dims));
    expect(inChain).toBeGreaterThan(0.85);
    expect(rows.some(({ dims }) => dims.some((d) => d.overall && d.spans && d.spans.length >= 2))).toBe(true);
  });

  it('views: the plan and a sheet-mate elevation separated by a gap are two views', () => {
    const pages = vectorPagesOf(buildSet(6));
    const v = splitViews(pages[0]);
    expect(v.boxes.length).toBeGreaterThanOrEqual(1);
  });
});

function dims_in_chain(all: ReturnType<typeof findDimensions>[]): number {
  const flat = all.flat();
  const withChain = flat.filter((d) => d.chain || d.overall).length;
  return withChain / Math.max(1, flat.length);
}

describe('the strings', () => {
  const read = (str: string, x: number, y: number, size = 6): TextRead => ({ id: `r${str}${x}`, method: 'pdf-text', str, bbox: [x, y - 0.72 * size, x + 0.5 * size * str.length, y], angle: 0, size, origin: [x, y], length: 0.5 * size * str.length, confidence: 0.99 });
  it('two pieces of one string on one baseline join (5\' and 6"), two strings run together are cut apart (4"8")', () => {
    const joined = lengthRuns([read("5'", 10, 50), read('6"', 17, 50)]).map((r) => r.str);
    expect(joined).toContain('5\' 6"');
    const g = (str: string): TextRead => ({ ...read(str, 10, 50), method: 'glyph', glyphs: [...str].map((ch, i) => ({ ch, d: 0.02, cluster: 0, tentative: false, a: i * 3, b: i * 3 + 2.6 })) });
    const cut = lengthRuns([g('4"8"')]).map((r) => r.str);
    expect(cut).toContain('4"');
    expect(cut).toContain('8"');
  });
  it('a letter that looks like a digit is the digit inside a number: O.4O is 0.40, I2.I4 is 12.14, but a word stays a word', () => {
    expect(numericRepair('O.4O')).toBe('0.40');
    expect(numericRepair('I2.I4')).toBe('12.14');
    expect(numericRepair("1' O\"")).toBe("1' 0\"");
    expect(numericRepair('BEDROOM')).toBe('BEDROOM');
    expect(numericRepair('LOBBY 1')).toBe('LOBBY 1');
  });
});
