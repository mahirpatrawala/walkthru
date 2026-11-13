// C12b: dimension lines whose string could not be read are cut out and handed to another reader (OCR, a vision model) as candidates;
// whatever comes back is tentative, and only the geometry check can make it a fact (SPEC 17.5 item 4, 17.8). A stand-in reader that
// answers from the printed strings stands for the model; no network, no process.
import { describe, expect, it } from 'vitest';
import { buildSet, vectorPagesOf } from '../scripts/make-drawing-sets';
import { proposeWithTrace } from '../src/import/propose';
import { analyseTrace, routeUnread } from '../src/understand/text-dims';
import type { CropReader } from '../src/understand/text-dims';
import { parseLengthLoose } from '../src/understand/units';
import { isFact } from '../src/understand/types';

describe('routing unreadable dimension crops', () => {
  const b = buildSet(11);
  const full = vectorPagesOf(b);
  const whole = proposeWithTrace(full, 'x', 'y').trace;
  // what a good reader would see: every length string of the page, where it sits
  const oracle = whole.reads.map((rs) => rs.filter((r) => r.method === 'pdf-text' && parseLengthLoose(r.str)));
  const stripped = full.map((p) => ({ ...p, texts: p.texts.filter((t) => !parseLengthLoose(t.str.trim())) }));
  const bare = proposeWithTrace(stripped, 'x', 'y');

  it('finds the terminated lines that carry no string, asks for them, and takes only answers that are lengths', async () => {
    const seen: string[] = [];
    const reader: CropReader = {
      readStrings: async (crops) => crops.map((c) => {
        const [page, box] = JSON.parse(new TextDecoder().decode(c.png)) as [number, number[]];
        seen.push(c.id);
        const hit = oracle[page].find((r) => (r.bbox[0] + r.bbox[2]) / 2 >= box[0] && (r.bbox[0] + r.bbox[2]) / 2 <= box[2] && (r.bbox[1] + r.bbox[3]) / 2 >= box[1] && (r.bbox[1] + r.bbox[3]) / 2 <= box[3]);
        return hit ? { id: c.id, text: hit.str, box: [0, 0, 10, 4] as [number, number, number, number], confidence: 0.8 } : { id: c.id, text: 'not a length', box: [0, 0, 1, 1] as [number, number, number, number], confidence: 0.2 };
      }),
    };
    const r = await routeUnread(bare.trace, { reader, method: 'vision', render: async (page, box) => new TextEncoder().encode(JSON.stringify([page, box])) });
    expect(r.asked).toBeGreaterThanOrEqual(4);
    expect(r.answered).toBeGreaterThanOrEqual(3);
    expect(r.answered).toBeLessThan(r.asked + 1);
    const answers = r.extra.flat();
    expect(answers.length).toBe(r.answered);
    for (const a of answers) { expect(a.method).toBe('vision'); expect(a.tentative).toBe(true); expect(parseLengthLoose(a.str)).not.toBeNull(); expect(a.confidence).toBeLessThanOrEqual(0.6); }
    // with the answers in, strings sit on lines; any that is called a fact passed the geometry check, and none is a wrong string
    const before = analyseTrace(bare.result, bare.trace);
    const after = analyseTrace(bare.result, bare.trace, r.extra);
    expect(after.dims.length).toBeGreaterThan(before.dims.length);
    for (const d of after.dims.filter((x) => isFact(x.status))) {
      expect(d.verdict.checks.some((c) => c.kind === 'geometry' && c.ok)).toBe(true);
      expect(d.verdict.method === 'vision' ? d.verdict.confidence <= 0.9 : true).toBe(true);
    }
  }, 120000);

  it('an answer with no box is dropped for a vision reader, and a reader that says nothing adds nothing', async () => {
    const noBox: CropReader = { readStrings: async (crops) => crops.map((c) => ({ id: c.id, text: "5'-0\"", confidence: 0.9 })) };
    const r1 = await routeUnread(bare.trace, { reader: noBox, method: 'vision', render: async () => new Uint8Array([1]) });
    expect(r1.answered).toBe(0);
    const r2 = await routeUnread(bare.trace, { reader: noBox, method: 'ocr', render: async () => new Uint8Array([1]) });
    expect(r2.answered).toBeGreaterThan(0);
    const silent: CropReader = { readStrings: async () => [] };
    expect((await routeUnread(bare.trace, { reader: silent, method: 'ocr', render: async () => new Uint8Array([1]) })).answered).toBe(0);
  }, 60000);
});
