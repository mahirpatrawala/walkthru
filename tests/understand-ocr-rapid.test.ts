// The PP-OCR style reader for pictures of plans (SPEC 17.17), tested with no engine and no network: a stand-in backend answers `page` and
// `lines` with canned reads shaped like the real engine's (lines with corners and a confidence), and a stub worker script speaks the
// JSON-lines protocol of tools/understand/rapid-worker.py. Strings are made up (other numbers than any real plan) but carry the same
// confusions the engine makes: a lost foot mark, a quote read as a star, an x read as a multiplication sign, a dash read as a minus.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGray } from '../src/understand/pixels/image';
import type { Gray } from '../src/understand/pixels/image';
import type { TextBlock } from '../src/understand/local/ink';
import { ocrNormalise, ocrSizeCandidates } from '../src/understand/local/sizes';
import { NO_ENGINE_NOTE, rapidPythonBackend } from '../src/understand/local/ocr-backend';
import type { OcrBackend, OcrLine } from '../src/understand/local/ocr-backend';
import { lineCrop, mergeRows, pageLines, readBlocksRapid, readScale } from '../src/understand/local/ocr-rapid';
import { labelFromRead } from '../src/understand/raster-local';

const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const line = (text: string, r: [number, number, number, number], conf = 0.95): OcrLine => ({ box: box(...r), text, conf });
const fakeBackend = (lines: OcrLine[], rec: (n: number) => { text: string; conf: number } = () => ({ text: '', conf: 0 })): OcrBackend & { calls: { page: number; rec: number } } => {
  const calls = { page: 0, rec: 0 };
  return { name: 'fake', info: 'fake', calls, page: async () => { calls.page++; return lines; }, lines: async (imgs) => { calls.rec += imgs.length; return imgs.map((_, i) => rec(i)); }, close: () => undefined, stats: () => ({ cpuSeconds: 0, peakRssMb: 0, calls: calls.page + calls.rec }) };
};
const sizes = (t: string): string[] => ocrSizeCandidates(t).map((c) => `${c.w.toFixed(2)}x${c.l.toFixed(2)}`);

describe('size repairs for the confusions a PP-OCR engine makes', () => {
  it('normalises dashes, marks, multiplication signs and digits read as letters, only next to digits', () => {
    expect(ocrNormalise('11′–6″ × 9′–0″')).toBe('11\'-6" x 9\'-0"');
    expect(ocrNormalise('BEDRO0M')).toBe('BEDROOM');
    expect(ocrNormalise('7-O" X 12-0"')).toBe('7-0" X 12-0"');
    expect(ocrNormalise('KITCHEN')).toBe('KITCHEN');
    expect(ocrNormalise('9\'-01/2"')).toBe('9\'-0 1/2"');
  });
  it('a foot mark lost, a quote read as a star, a trailing mark of either kind', () => {
    expect(sizes('HALL 11-6"X9-0"')[0]).toBe('3.51x2.74');
    expect(sizes('HALL 11-6*×9-0*')[0]).toBe('3.51x2.74');
    expect(sizes("HALL 11-6'x9-0")[0]).toBe('3.51x2.74');
  });
  it('fractions of an inch, also glued to the digit before them', () => {
    expect(sizes('Study :9\'-01/2"X13\'-1"')[0]).toBe('2.76x3.99');
    expect(sizes('Study : 9\'-0 1/2" X 13\'-1"')[0]).toBe('2.76x3.99');
  });
  it('an inch mark read as one more digit gives the shorter reading, never above eleven inches', () => {
    expect(sizes('HALL 11-22X9-0')).toContain('3.40x2.74');
    expect(sizes('HALL 11-81X9-0')).toContain('3.56x2.74');
    // a valid inch value is left alone
    expect(sizes('HALL 11-11X9-0')[0]).toBe('3.63x2.74');
  });
  it('plain metric sizes with a comma or a multiplication sign still read', () => {
    expect(sizes('LIVING 4,20 × 3,10')[0]).toBe('4.20x3.10');
  });
});

describe('reading a page with a detection and recognition engine', () => {
  const page = (): Gray => newGray(1200, 800, 255);
  const ink = (rects: [number, number, number, number][]): TextBlock[] => rects.map((r) => ({ rect: r, lines: [r], glyphs: 8, lineH: r[3] - r[1] }));

  it('scales a page so text is about 14 px tall, never past 2000 px or under 1100 px on the long side', () => {
    const g = page();
    expect(readScale(g, [7])).toBeCloseTo(2000 / 1200, 5); // 14/7 = 2 would be 2400 px: capped at 2000
    expect(readScale(g, [10])).toBeCloseTo(1.4, 5);
    expect(readScale(g, [30])).toBeCloseTo(1100 / 1200, 5); // big text still gets the detector its minimum input
    expect(readScale(newGray(4000, 3000, 255), [20])).toBeCloseTo(0.5, 5);
  });

  it('drops empty and low-confidence lines and tells upright from vertical text', () => {
    const ls = pageLines([line('KITCHEN', [10, 10, 110, 30]), line('', [0, 0, 5, 5]), line('noise', [0, 0, 30, 10], 0.1), line('ENTRY', [200, 100, 220, 300])], 1);
    expect(ls.map((l) => l.text)).toEqual(['KITCHEN', 'ENTRY']);
    expect(ls[0].vertical).toBe(false); expect(ls[1].vertical).toBe(true);
  });

  it('a name and a size read as two lines on one baseline become one line, two names side by side do not', () => {
    const merged = mergeRows(pageLines([line('Study', [100, 50, 180, 80]), line(': 9\'-0" X 12\'-0"', [330, 52, 520, 80]), line('HALL', [100, 200, 160, 228]), line('LOBBY', [200, 201, 280, 229])], 1));
    expect(merged.map((l) => l.text).sort()).toEqual(['HALL', 'LOBBY', 'Study : 9\'-0" X 12\'-0"']);
  });

  it('a name over its size is one block, and a primary read beats a noisier second opinion', async () => {
    const be = fakeBackend([line('BEDROOM', [100, 100, 220, 124]), line('11\'-0"X10\'-0"', [90, 128, 230, 152])], () => ({ text: 'V.99x10-0', conf: 0.7 }));
    const reads = await readBlocksRapid(page(), ink([[100, 100, 220, 124], [90, 128, 230, 152]]), be);
    expect(reads.length).toBe(1);
    expect(reads[0].text).toBe('BEDROOM\n11\'-0"X10\'-0"');
    // the second opinion read the crops at a lower confidence than the page pass: it is not offered
    expect(reads[0].more).toEqual([]);
    const l = labelFromRead(reads[0], 'a')!;
    expect(l.name).toBe('Bedroom');
    expect(l.cands[0].w).toBeCloseTo(3.35, 2); expect(l.cands[0].l).toBeCloseTo(3.05, 2);
  });

  it('a second opinion as sure as the first is offered, and a name read with a zero for an O is taken from it', async () => {
    const be = fakeBackend([line('BEDR0OM', [100, 100, 220, 124], 0.9), line('11-0"X10-0"', [90, 128, 230, 152], 0.9)], (i) => ({ text: i % 2 ? '11\'-0"X10\'-0"' : 'BEDROOM', conf: 0.95 }));
    const reads = await readBlocksRapid(page(), [], be);
    expect(reads[0].more.length).toBeGreaterThan(0);
    const l = labelFromRead(reads[0], 'a')!;
    expect(l.name).toBe('Bedroom');
    expect(l.cands.length).toBeGreaterThan(0);
  });

  it('a table row stays out of the stack above and below it, and a name over its size is still one block', async () => {
    const be = fakeBackend([
      line('TOILET', [290, 130, 370, 154]), line('4\'-6"X7\'-0"', [285, 158, 375, 182]),
      line('Kitchen', [700, 400, 780, 424]), line(': 9\'-0" X 8\'-0"', [850, 401, 1000, 425]), line('Utility', [700, 440, 780, 464]), line(': 5\'-0" X 4\'-0"', [850, 441, 1000, 465]),
    ]);
    const reads = await readBlocksRapid(page(), [], be);
    const texts = reads.map((r) => r.text).sort();
    expect(texts).toContain('TOILET\n4\'-6"X7\'-0"');
    expect(texts).toContain('Kitchen : 9\'-0" X 8\'-0"');
    expect(texts).toContain('Utility : 5\'-0" X 4\'-0"');
  });

  it('text running up the page is read from its crop turned each way, and the surer reading is kept', async () => {
    const be = fakeBackend([line('BALCONY', [500, 100, 524, 220], 0.9)], (i) => (i % 2 ? { text: 'BALCONY', conf: 0.97 } : { text: 'xxo', conf: 0.2 }));
    const reads = await readBlocksRapid(page(), [], be, { second: () => true });
    expect(reads[0].text).toBe('BALCONY');
    expect(reads[0].lineH).toBeLessThan(30);
  });

  it('ink the detector missed is read from its crop, and an ink block it did find is not read twice', async () => {
    const be = fakeBackend([line('HALL', [100, 100, 160, 124])], () => ({ text: 'STORE', conf: 0.9 }));
    const reads = await readBlocksRapid(page(), ink([[102, 102, 158, 122], [600, 500, 680, 520]]), be);
    expect(reads.map((r) => r.text).sort()).toEqual(['HALL', 'STORE']);
  });

  it('crops a line with air around it and brings it to the asked height', () => {
    const c = lineCrop(newGray(500, 300, 255), [100, 100, 300, 120], 48, 0.3);
    expect(c.height).toBeGreaterThan(48);
    expect(c.width / c.height).toBeGreaterThan(4);
  });
});

describe('the worker protocol and the way a missing engine is reported', () => {
  const stub = (script: string): string => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-stub-ocr-'));
    fs.mkdirSync(path.join(home, 'venv', 'bin'), { recursive: true }); fs.mkdirSync(path.join(home, 'models'));
    const py = path.join(home, 'venv', 'bin', 'python3');
    fs.writeFileSync(py, script); fs.chmodSync(py, 0o755);
    return home;
  };
  it('with no environment installed it says why instead of failing', async () => {
    const s = await rapidPythonBackend(path.join(os.tmpdir(), 'walkthru-no-such-ocr-home'));
    expect(s.engine).toBeNull();
    if (!s.engine) { expect(s.reason).toMatch(/no Python environment/); expect(NO_ENGINE_NOTE(s.reason)).toMatch(/Tesseract/); expect(NO_ENGINE_NOTE(s.reason)).toMatch(/setup-ocr\.sh/); }
  });
  it('a worker that reports missing models is a clear reason, not a hang', async () => {
    const home = stub('#!/bin/sh\necho \'{"ready":false,"error":"model file missing: x.onnx (run tools/understand/setup-ocr.sh)"}\'\nexit 3\n');
    try {
      const s = await rapidPythonBackend(home);
      expect(s.engine).toBeNull();
      if (!s.engine) expect(s.reason).toMatch(/model file missing/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  it('speaks one JSON line per request: page reads, crop reads, and cost counters', async () => {
    const home = stub(`#!/bin/sh
echo '{"ready":true,"models":{"det":"d.onnx","rec":"r.onnx"},"bytes":{"det":2000000,"rec":5000000}}'
while read line; do
  id=$(echo "$line" | sed 's/.*"id":\\([0-9]*\\).*/\\1/')
  case "$line" in
    *'"op":"page"'*) echo "{\\"id\\":$id,\\"lines\\":[{\\"box\\":[[1,2],[41,2],[41,12],[1,12]],\\"text\\":\\"HALL\\",\\"conf\\":0.9}],\\"cpu\\":1.5,\\"rssMb\\":120}";;
    *'"op":"rec"'*) echo "{\\"id\\":$id,\\"reads\\":[{\\"text\\":\\"9 x 8\\",\\"conf\\":0.8},{\\"text\\":\\"\\",\\"conf\\":0}],\\"cpu\\":2.5,\\"rssMb\\":130}";;
    *quit*) exit 0;;
  esac
done
`);
    try {
      const s = await rapidPythonBackend(home);
      expect(s.engine).not.toBeNull();
      if (!s.engine) return;
      const lines = await s.engine.page(newGray(50, 20, 255));
      expect(lines[0]).toMatchObject({ text: 'HALL', conf: 0.9 });
      const reads = await s.engine.lines([newGray(30, 10, 255), newGray(30, 10, 255)]);
      expect(reads.map((r) => r.text)).toEqual(['9 x 8', '']);
      expect(s.engine.stats()).toMatchObject({ cpuSeconds: 2.5, peakRssMb: 130, calls: 2 });
      expect(s.engine.info).toMatch(/d\.onnx \(2\.0 MB\)/);
      s.engine.close();
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
