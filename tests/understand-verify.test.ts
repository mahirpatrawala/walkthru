// C12b: the status rules (SPEC 17.1, 17.5 "The checks", 17.12 item 7). Pure: dimension lines are built by hand, so every case
// is about the rule and nothing else. Always runs.
import { describe, expect, it } from 'vitest';
import type { DimLine } from '../src/understand/dimensions';
import type { TextRead } from '../src/understand/reads';
import { parseLengthLoose } from '../src/understand/units';
import { extractDimension, labelAreaCheck, sideCheck, verifyDimensions } from '../src/understand/verify';
import { isFact } from '../src/understand/types';

const S = 37.3;
let n = 0;
function dim(str: string, lengthM: number, opts: { method?: 'pdf-text' | 'glyph'; chain?: string; overall?: boolean; spans?: string[]; tentative?: boolean; incomplete?: boolean; x?: number; page?: number } = {}): DimLine {
  const read: TextRead = { id: `r${n}`, method: opts.method ?? 'pdf-text', str, bbox: [0, 0, 10, 4], angle: 0, size: 6, origin: [0, 0], length: 10, confidence: 0.9, tentative: opts.tentative, glyphs: opts.tentative ? [...str].map((ch) => ({ ch, d: 0.1, cluster: 7, tentative: true, a: 0, b: 1 })) : undefined };
  const parsed = parseLengthLoose(str)!;
  const x = opts.x ?? n * 40;
  return {
    id: `d${n++}`, a: [x, 100], b: [x + lengthM * S, 100], lengthPt: lengthM * S, angle: 0, anchors: ['tick', 'tick'], line: { a: [x, 100], b: [x + lengthM * S, 100] },
    run: { read, parts: [read], str, parsed, centre: [x, 96], len: 10, angle: 0, cap: 4.3 }, centring: 0.1, view: 0, page: opts.page ?? 0,
    chain: opts.chain, overall: opts.overall, spans: opts.spans, incomplete: opts.incomplete,
  };
}
const set = (): DimLine[] => { n = 0; return [dim("12'0\"", 3.6576), dim("9'6\"", 2.8956), dim("5'0\"", 1.524), dim("14'6\"", 4.4196), dim("8'0\"", 2.4384), dim("6'6\"", 1.9812)]; };
const status = (dims: DimLine[]): string[] => verifyDimensions({ dims }).flatMap((p) => p.verdicts).map((v) => v.status);

describe('geometry', () => {
  it('a string that matches the dimension line at the scale the others give is verified, with a geometry check recorded', () => {
    const dims = set();
    const v = verifyDimensions({ dims })[0].verdicts;
    expect(v.map((x) => x.status)).toEqual(Array(6).fill('verified'));
    expect(v[0].checks.some((c) => c.kind === 'geometry' && c.ok)).toBe(true);
    expect(v[0].confidence).toBeCloseTo(0.99);
  });
  it('a glyph read is verified at 0.95, never higher', () => {
    n = 0;
    const dims = [dim("12'0\"", 3.6576, { method: 'glyph' }), dim("9'6\"", 2.8956), dim("5'0\"", 1.524), dim("14'6\"", 4.4196), dim("8'0\"", 2.4384)];
    expect(verifyDimensions({ dims })[0].verdicts[0].confidence).toBeCloseTo(0.95);
  });
  it('a planted wrong string is a conflict with both numbers kept, and the others stay verified', () => {
    n = 0;
    // eight agreeing dimensions pin the scale tightly enough to vouch for one another; the last is drawn 6'6" and printed 7'0"
    const dims = [dim("12'0\"", 3.6576), dim("9'6\"", 2.8956), dim("5'0\"", 1.524), dim("14'6\"", 4.4196), dim("8'0\"", 2.4384), dim("10'0\"", 3.048), dim("11'0\"", 3.3528), dim("7'0\"", 1.9812)];
    const v = verifyDimensions({ dims })[0].verdicts;
    expect(v[7].status).toBe('conflict');
    expect(v[7].message).toMatch(/drawing says 7'0", measures 6'/);
    const e = extractDimension(v[7], 1, 'p1');
    expect(e.status).toBe('conflict');
    expect(e.alternatives![0].value).toBeCloseTo(1.9812, 2);
    expect(v.slice(0, 7).every((x) => x.status === 'verified')).toBe(true);
  });
  it('a string two inches off a 3 m line is not verified: the verified band is the inner 60% of the 2% tolerance', () => {
    n = 0;
    const dims = [dim("12'0\"", 3.6576), dim("9'6\"", 2.8956), dim("5'0\"", 1.524), dim("14'6\"", 4.4196), dim("8'0\"", 2.4384), dim("10'2\"", 3.0988 - 0.0508)]; // printed 10'2" = 3.099 m, drawn 3.048 m
    const v = verifyDimensions({ dims })[0].verdicts;
    expect(isFact(v[5].status)).toBe(false);
  });
  it('with fewer than three other agreeing dimensions nothing is verified: no scale, nothing to check against', () => {
    n = 0;
    expect(status([dim("12'0\"", 3.6576), dim("9'6\"", 2.8956)])).toEqual(['unverified', 'unverified']);
  });
  it('the dimension being checked never votes for its own scale', () => {
    n = 0;
    // three strings that agree with each other and one that is wrong: the wrong one cannot drag the fit
    const dims = [dim("12'0\"", 3.6576), dim("9'6\"", 2.8956), dim("5'0\"", 1.524), dim("9'0\"", 4.4196)];
    const v = verifyDimensions({ dims })[0].verdicts;
    expect(v[3].status).not.toBe('verified');
    expect(isFact(v[0].status)).toBe(false); // only two others agree for each good one: no independent scale
  });
  it('lettering left unread beside a string (the front of a longer one) keeps it unverified', () => {
    n = 0;
    const dims = set(); dims[2].incomplete = true;
    expect(verifyDimensions({ dims })[0].verdicts[2].status).toBe('unverified');
  });
});

describe('chains', () => {
  it('members that sum to the overall do not verify one another (rounded strings cancel), and a chain that does not sum is a conflict', () => {
    n = 0;
    const good = [dim("5'0\"", 1.524, { chain: 'c' }), dim("7'0\"", 2.1336, { chain: 'c' }), dim("12'0\"", 3.6576, { overall: true, spans: ['d0', 'd1'] })];
    expect(status(good)).toEqual(['unverified', 'unverified', 'unverified']);
    n = 0;
    const bad = [dim("5'0\"", 1.524, { chain: 'c' }), dim("8'0\"", 2.4384, { chain: 'c' }), dim("12'0\"", 3.6576, { overall: true, spans: ['d0', 'd1'] })];
    expect(status(bad)).toEqual(['conflict', 'conflict', 'conflict']);
  });
  it('a chain that misses its overall by an inch does not verify on its own (stricter than the spec inch)', () => {
    n = 0;
    const dims = [dim("5'0\"", 1.524, { chain: 'c' }), dim("7'0\"", 2.1336, { chain: 'c' }), dim("12'1\"", 3.6576, { overall: true, spans: ['d0', 'd1'] })];
    expect(status(dims).every((s) => s !== 'verified')).toBe(true);
  });
});

describe('unconfirmed glyph shapes', () => {
  it('dimensions read in a shape cluster no clean dimension has vouched for are not verified without five agreeing others', () => {
    n = 0;
    const dims = set().map((d) => { d.run.read.tentative = true; d.run.read.glyphs = [...d.run.str].map((ch) => ({ ch, d: 0.1, cluster: 3, tentative: true, a: 0, b: 1 })); d.run.read.method = 'glyph'; return d; });
    const s = status(dims);
    expect(s.filter((x) => x === 'verified').length).toBeLessThanOrEqual(6);
    // six agreeing dimensions can vouch for each other, but never fewer than the cluster rule asks (three other lines)
    expect(s.every((x) => x !== 'conflict')).toBe(true);
    n = 0;
    const few = set().slice(0, 4).map((d) => { d.run.read.tentative = true; d.run.read.glyphs = [...d.run.str].map((ch) => ({ ch, d: 0.1, cluster: 3, tentative: true, a: 0, b: 1 })); return d; });
    expect(status(few).every((x) => x !== 'verified')).toBe(true);
  });
});

describe('label checks', () => {
  it('a labelled area is checked against the traced polygon within 3%, a labelled side within the dimension tolerance', () => {
    expect(labelAreaCheck(13.4, 13.5).ok).toBe(true);
    expect(labelAreaCheck(13.4, 14.2).ok).toBe(false);
    expect(sideCheck(3.35, 3.36).ok).toBe(true);
    expect(sideCheck(3.35, 3.45).ok).toBe(false);
  });
});
