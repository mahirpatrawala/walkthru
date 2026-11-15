// "Upload your floor plan": what is a supported file and the plain-English answer for each way a file can fail (preflight, before any long work).
import { describe, expect, it } from 'vitest';
import { LIMITS, PICTURE_MESSAGE, preflightFile, preflightPages, preflightRead, problem, problemFromError, sniff } from '../src/upload/problems';
import type { ProblemCode } from '../src/upload/problems';
import type { VectorPage } from '../src/import/types';
import { ImportError } from '../src/import/types';
import { imageOnlyPdf, textOnlyPdf } from './helpers/upload-pdfs';

const bytes = (s: string | number[]): Uint8Array => (typeof s === 'string' ? new TextEncoder().encode(s) : Uint8Array.from(s));
const page = (over: Partial<VectorPage> = {}): VectorPage => ({ index: 0, width: 600, height: 400, fills: [], strokes: [], texts: [], imageCoverage: 0, ...over });
const strokes = (n: number): VectorPage['strokes'] => Array.from({ length: n }, (_, i) => ({ color: '#000', width: 1, points: [{ x: i, y: 0 }, { x: i, y: 10 }], closed: false, hasCurve: false }));

describe('the first bytes decide what a file is', () => {
  it('finds a PDF by its header, even when something precedes it', () => {
    expect(sniff(bytes('%PDF-1.7\n'))).toBe('pdf');
    expect(sniff(bytes('\n\n   junk %PDF-1.4 more'))).toBe('pdf');
    expect(sniff(imageOnlyPdf().subarray(0, 1100))).toBe('pdf');
  });
  it('recognises pictures and everything else', () => {
    expect(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('image');
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniff(bytes('RIFF....WEBPVP8 '))).toBe('image');
    expect(sniff(bytes('hello, this is a note'))).toBe('other');
    expect(sniff(bytes('PK\u0003\u0004 a word document'))).toBe('other');
  });
});

describe('preflightFile', () => {
  const head = (s: string): Uint8Array => bytes(s);
  it('lets a PDF through', () => { expect(preflightFile({ size: 5000, name: 'plan.pdf' }, head('%PDF-1.4'))).toBeNull(); });
  it('lets a PDF through whatever it is called: the content decides, not the name', () => { expect(preflightFile({ size: 5000, name: 'plan.txt' }, head('%PDF-1.4'))).toBeNull(); });
  it('says "Upload a PDF" for anything that is not one', () => {
    const p = preflightFile({ size: 40, name: 'notes.docx' }, head('PK\u0003\u0004'));
    expect(p?.code).toBe('not-pdf');
    expect(p?.title).toBe('Upload a PDF');
    expect(p?.tips.length).toBeGreaterThan(0);
  });
  it('says photos are coming, and still asks for a PDF', () => {
    const p = preflightFile({ size: 400_000, name: 'flat.jpg', type: 'image/jpeg' }, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(p?.code).toBe('image-file');
    expect(p?.title).toBe('Upload a PDF');
    expect(p?.detail).toContain('Photo and image plans are coming');
  });
  it('refuses an empty file and one over the size limit, naming the limit', () => {
    expect(preflightFile({ size: 0 }, head(''))?.code).toBe('empty');
    const big = preflightFile({ size: LIMITS.maxBytes + 1 }, head('%PDF-1.4'));
    expect(big?.code).toBe('too-big');
    expect(big?.detail).toContain('30 MB');
  });
});

describe('preflightPages (the PDF is open)', () => {
  it('a PDF whose pages are pictures gets the exact message', () => {
    const p = preflightPages([page({ imageCoverage: 0.9 })]);
    expect(p?.code).toBe('picture-pdf');
    expect(p?.detail).toBe('This PDF is a picture of a plan. For now Walkthru reads plans saved from drawing software. Photo and image plans are coming.');
    expect(p?.detail).toBe(PICTURE_MESSAGE);
  });
  it('uses the reader’s own picture test: a picture with line work on it is a plan', () => {
    expect(preflightPages([page({ imageCoverage: 0.2, strokes: strokes(300) })])).toBeNull();
  });
  it('a letter has text and no drawing, an empty page has nothing', () => {
    expect(preflightPages([page({ texts: [{ str: 'Dear sir', x: 1, y: 1, width: 20, size: 10, angle: 0 }] })])?.code).toBe('not-a-plan');
    expect(preflightPages([page()])?.code).toBe('blank');
    expect(preflightPages([])?.code).toBe('blank');
  });
  it('a mixed set (one picture page, one drawn page) goes on', () => {
    expect(preflightPages([page({ imageCoverage: 0.9 }), page({ strokes: strokes(400) })])).toBeNull();
  });
});

describe('preflightRead (the reader ran)', () => {
  it('no rooms found: what to try', () => {
    const p = preflightRead({}, 0);
    expect(p?.code).toBe('no-rooms');
    expect(p?.tips.join(' ')).toMatch(/floor plan/i);
  });
  it('several flats refuses only on strong evidence: three groups, or two groups holding 14 rooms or more', () => {
    const flat = (n: number, rooms = 6): { id: string; label: string; roomIds: string[] } => ({ id: `f${n}`, label: `Flat ${n}`, roomIds: Array.from({ length: rooms }, (_, i) => `r${n}-${i}`) });
    const p = preflightRead({ units: [flat(1, 8), flat(2, 8)] }, 16);
    expect(p?.code).toBe('several-flats');
    expect(p?.detail).toContain('2 flats');
    expect(preflightRead({ units: [flat(1, 4), flat(2, 4), flat(3, 4)] }, 12)?.code).toBe('several-flats');
    // the splitter reads one 3 BHK as 5 + 5 rooms, and one 2 BHK as 4 + 4: a note, not a refusal
    expect(preflightRead({ units: [flat(1, 5), flat(2, 5)] }, 10)).toBeNull();
    expect(preflightRead({ units: [flat(1, 4), flat(2, 4)] }, 8)).toBeNull();
    expect(preflightRead({}, 6)).toBeNull();
  });
});

describe('problemFromError', () => {
  it('maps pdf.js and importer failures to something a visitor can act on', () => {
    expect(problemFromError(Object.assign(new Error('No password given'), { name: 'PasswordException' })).code).toBe('encrypted');
    expect(problemFromError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' })).code).toBe('unreadable');
    expect(problemFromError(new ImportError('too-many-pages', 'This PDF has 40 pages (the limit is 12).')).code).toBe('too-many-pages');
    expect(problemFromError(new ImportError('too-many-pages', 'This PDF has 40 pages (the limit is 12).')).detail).toContain('40');
    expect(problemFromError(new ImportError('too-complex', 'x')).code).toBe('too-complex');
    expect(problemFromError(new ImportError('raster-plan')).code).toBe('picture-pdf');
    expect(problemFromError(new Error('boom')).code).toBe('failed');
  });
  it('every problem has a title, a reason and a way forward', () => {
    const codes: ProblemCode[] = ['no-file', 'several-files', 'empty', 'not-pdf', 'image-file', 'too-big', 'unreadable', 'encrypted', 'too-many-pages', 'too-complex', 'picture-pdf', 'blank', 'not-a-plan', 'no-rooms', 'several-flats', 'failed', 'timeout', 'no-worker'];
    for (const c of codes) {
      const p = problem(c, { size: 40_000_000, pages: 20, flats: 3 });
      expect(p.code).toBe(c);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.detail.length).toBeGreaterThan(20);
      expect(p.tips.length).toBeGreaterThan(0);
    }
  });
});

describe('the helper PDFs are what they claim', () => {
  it('are PDFs by header', () => { for (const b of [imageOnlyPdf(), textOnlyPdf()]) expect(sniff(b.subarray(0, 1100))).toBe('pdf'); });
});
