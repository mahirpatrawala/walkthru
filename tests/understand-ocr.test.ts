// C12b: the OCR adapter (SPEC 17.5 item 3). Tesseract and RapidOCR are not installed by the project; this tests the interface, the
// "not available" path (which the pipeline must survive) and a stand-in engine. No process is spawned for the engine under test.
import { describe, expect, it } from 'vitest';
import { DIMENSION_WHITELIST, availableEngine, readCrops } from '../src/understand/ocr';
import type { OcrEngine, OcrStatus } from '../src/understand/ocr';

const place = (): { bbox: [number, number, number, number]; angle: number; size: number; origin: [number, number]; length: number } => ({ bbox: [0, 0, 20, 5], angle: 270, size: 6, origin: [0, 5], length: 20 });

describe('ocr adapter', () => {
  it('with no engine it says why and returns no reads, so the pipeline carries on with PDF text and glyphs', async () => {
    const none: OcrStatus = { available: false, reason: 'No local OCR engine is installed' };
    const r = await readCrops(none, [{ id: 'a', png: new Uint8Array([1, 2, 3]), hint: 'dimension' }], place);
    expect(r.reads).toEqual([]);
    expect(r.reason).toMatch(/OCR engine/);
  });
  it('an engine\'s answers become reads with method ocr, a box and a direction; empty answers are dropped', async () => {
    const fake: OcrEngine = { name: 'fake', read: async (crops) => crops.map((c, i) => ({ id: c.id, text: i === 1 ? '' : '2\'-11"', confidence: 0.4 })) };
    const r = await readCrops({ available: true, engine: fake }, [{ id: 'a', png: new Uint8Array() }, { id: 'b', png: new Uint8Array() }], place);
    expect(r.reads.length).toBe(1);
    expect(r.reads[0]).toMatchObject({ method: 'ocr', str: '2\'-11"', angle: 270 });
  });
  it('availableEngine never installs anything and answers with a status either way', async () => {
    const s = await availableEngine();
    expect(typeof s.available).toBe('boolean');
    if (!s.available) expect(s.reason.length).toBeGreaterThan(10);
  });
  it('the whitelist holds exactly what a dimension string is made of', () => {
    for (const ch of ['0', '9', "'", '"', '-', '.', '/', '½', 'x', 'm']) expect(DIMENSION_WHITELIST).toContain(ch);
    expect(DIMENSION_WHITELIST).not.toMatch(/[a-ln-wyzA-LN-WYZ]/); // no letters but x and m
  });
});
