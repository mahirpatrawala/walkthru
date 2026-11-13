// C12d: the raster path's pieces and its privacy rules. Always runs: no network, no key, no real drawing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSet, rasterPagesOf } from '../scripts/make-drawing-sets';
import { phoneForward } from '../scripts/drawing-sets/raster';
import { buildTwin } from '../scripts/eval/raster-world';
import { applyMat, decodeImage, decodeJpeg, decodePng, encodePng, newGray, rotateQuarter, warpGray, rotateMat, whiteOut } from '../src/understand/pixels/image';
import type { Gray, Pt } from '../src/understand/pixels/image';
import { estimateSkew, findSheetQuad, preprocess } from '../src/understand/pixels/preprocess';
import { findViews, redactTextBlocks } from '../src/understand/pixels/views';
import { InkMap, snapDimensionLine, snapEdge, snapPolygon } from '../src/understand/pixels/snap';
import { findChains, fitScale, labelFit, looFit } from '../src/understand/pixels/fit';
import type { Evidence } from '../src/understand/pixels/fit';
import { isTitleBlockText } from '../src/understand/pixels/privacy';
import { lineageOf } from '../src/understand/pixels/lineage';
import { readRasterPages, proposeFromRaster } from '../src/understand/raster';
import { MockVisionProvider } from '../src/understand/vision/mock';
import type { VisionProvider, CropIn, ClassRead, StringRead } from '../src/understand/vision/provider';
import { LAYOUT_SCHEMA_ID } from '../src/understand/vision/prompts';
import { ImportError } from '../src/import/types';
import { VISION_NOTICE, visionNotice } from '../src/understand/notice';

const hasSips = ((): boolean => { try { execFileSync('sips', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('image codecs', () => {
  it('a grey PNG survives a round trip exactly', () => {
    const g = newGray(37, 23); for (let i = 0; i < g.data.length; i++) g.data[i] = (i * 7) % 256;
    const back = decodePng(encodePng(g));
    expect([back.width, back.height]).toEqual([37, 23]);
    expect(Array.from(back.data)).toEqual(Array.from(g.data));
  });
  it('quarter turns put a mark where the map says', () => {
    const g = newGray(6, 4); g.data[1 * 6 + 4] = 0; // x 4, y 1
    for (const cw of [90, 180, 270] as const) {
      const r = rotateQuarter(g, cw);
      const [x, y] = applyMat(r.map, [4.5, 1.5]);
      expect(r.image.data[Math.floor(y) * r.image.width + Math.floor(x)]).toBe(0);
    }
  });
  it.skipIf(!hasSips)('a baseline JPEG written by the system encoder decodes close to the PNG it came from', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-jpg-'));
    const g = rasterPagesOf(buildSet(2))[0];
    const png = path.join(dir, 'a.png'), jpg = path.join(dir, 'a.jpg');
    fs.writeFileSync(png, encodePng(g));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', jpg], { stdio: 'ignore' });
    const d = decodeJpeg(new Uint8Array(fs.readFileSync(jpg)));
    expect([d.width, d.height]).toEqual([g.width, g.height]);
    let err = 0; for (let i = 0; i < g.data.length; i += 7) err += Math.abs(d.data[i] - g.data[i]);
    expect(err / (g.data.length / 7)).toBeLessThan(6);
    expect(decodeImage(new Uint8Array(fs.readFileSync(jpg))).width).toBe(g.width);
  }, 60000);
  it('refuses what it cannot read, in words', () => {
    expect(() => decodeImage(new Uint8Array([1, 2, 3, 4]))).toThrow(/Unsupported image/);
  });
});

describe('cleaning a photo', () => {
  const b6 = buildSet(6); // a phone photo, 3 degrees of warp
  const photo = rasterPagesOf(b6)[0];
  it('finds the sheet in a phone photo to within a few pixels and makes it flat', () => {
    const H = phoneForward(photo.width, photo.height, b6.truth.options.raster.warpDeg, b6.truth.seed * 31);
    const truthQ = ([[0, 0], [photo.width, 0], [photo.width, photo.height], [0, photo.height]] as Pt[]).map((p) => applyMat(H, p));
    const q = findSheetQuad(photo);
    expect(q.quad).not.toBeNull();
    q.quad!.forEach((p, i) => expect(Math.hypot(p[0] - truthQ[i][0], p[1] - truthQ[i][1])).toBeLessThan(5));
    const pre = preprocess(photo);
    expect(pre.steps.some((s) => s.includes('perspective fixed'))).toBe(true);
    // the sheet's own frame is a rectangle now: the page's margin is blank all round
    const meanOf = (x0: number, y0: number, x1: number, y1: number): number => { let a = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { a += pre.image.data[y * pre.image.width + x]; n++; } return a / n; };
    expect(meanOf(0, 4, pre.image.width, 12)).toBeGreaterThan(200);
    expect(meanOf(4, 0, 12, pre.image.height)).toBeGreaterThan(200);
  }, 60000);
  it('leaves a flat scan alone', () => {
    const scan = rasterPagesOf(buildSet(2))[0];
    expect(findSheetQuad(scan).quad).toBeNull();
    const pre = preprocess(scan);
    expect(pre.deskewDeg).toBe(0);
    expect(pre.image.width).toBe(scan.width);
  }, 60000);
  it('straightens a page that was scanned crooked', () => {
    const scan = rasterPagesOf(buildSet(2))[0];
    const crooked = warpGray(scan, rotateMat((2.5 * Math.PI) / 180, scan.width / 2, scan.height / 2), scan.width, scan.height, 255);
    const sk = estimateSkew(crooked);
    expect(Math.abs(Math.abs(sk) - 2.5)).toBeLessThan(0.5);
    const pre = preprocess(crooked);
    expect(Math.abs(pre.deskewDeg)).toBeGreaterThan(1.5);
    expect(Math.abs(estimateSkew(pre.image))).toBeLessThan(0.6);
  }, 60000);
});

describe('walls and dimension lines from pixels', () => {
  const page = (): Gray => {
    const g = newGray(400, 300);
    const box = (x0: number, y0: number, x1: number, y1: number, v = 20): void => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.data[y * 400 + x] = v; };
    box(50, 50, 250, 58); box(50, 200, 250, 208); box(50, 50, 58, 208); box(242, 50, 250, 208); // a room: walls 8 px thick, inside faces at 58..242 by 58..200
    box(120, 100, 180, 101, 30); // a line of furniture inside
    return g;
  };
  it('snaps a rough room box onto the inner faces of the walls', () => {
    const ink = new InkMap(page());
    const r = snapPolygon(ink, [[63, 52], [236, 52], [236, 205], [63, 205]], 12);
    expect(r.edgesFound).toBe(4);
    const [a, , c] = r.polygon;
    expect(Math.abs(a[0] - 58)).toBeLessThan(1.1); expect(Math.abs(a[1] - 58)).toBeLessThan(1.1);
    expect(Math.abs(c[0] - 242)).toBeLessThan(1.1); expect(Math.abs(c[1] - 200)).toBeLessThan(1.1);
  });
  it('a box on blank paper has no walls under it', () => {
    const ink = new InkMap(page());
    const r = snapPolygon(ink, [[290, 120], [380, 120], [380, 280], [290, 280]], 12);
    expect(r.edgesFound).toBe(0);
  });
  it('snaps a dimension line to its end marks and reports a line that is not there', () => {
    const g = newGray(400, 300);
    for (let x = 60; x <= 300; x++) g.data[150 * 400 + x] = 20;                    // the dimension line
    for (const x of [60, 300]) for (let y = 142; y <= 158; y++) g.data[y * 400 + x] = 20; // end marks crossing it
    const ink = new InkMap(g);
    const s = snapDimensionLine(ink, [66, 152], [295, 149], 12, 10);
    expect(s.ok).toBe(true);
    expect(Math.abs(s.a[0] - 60.5)).toBeLessThan(1.5); expect(Math.abs(s.b[0] - 300.5)).toBeLessThan(1.5);
    expect(snapDimensionLine(ink, [66, 252], [295, 252], 12, 10).ok).toBe(false);
  });
  it('a hairline next to a wall does not pull the face off the wall', () => {
    const g = page();
    for (let y = 60; y < 198; y++) g.data[y * 400 + 61] = 60; // a drawn line 3 px inside the left wall
    const r = snapEdge(new InkMap(g), 'v', 61, 58, 200, 1, 12);
    expect(r.found).toBe(true);
    expect(Math.abs(r.pos - 58)).toBeLessThan(1.6);
  });
});

describe('the scale fit and its checks', () => {
  const ev = (): Evidence => ({
    dims: [{ id: 'a', owner: 'a', px: 300, m: 3, axis: 'x', src: 'dim' }, { id: 'b', owner: 'b', px: 200, m: 2, axis: 'x', src: 'dim' }, { id: 'c', owner: 'c', px: 450, m: 4.5, axis: 'y', src: 'dim' }, { id: 'd', owner: 'd', px: 100, m: 2.5, axis: 'x', src: 'dim' }],
    labels: [{ id: 'r1', owner: 'r1', wPx: 400, hPx: 300, a: 4, b: 3 }, { id: 'r2', owner: 'r2', wPx: 250, hPx: 350, a: 3.5, b: 2.5 }],
  });
  it('finds 100 px per metre, calls a wrong printed value an outlier, and never lets a value vouch for itself', () => {
    const f = fitScale(ev())!;
    expect(f.ok).toBe(true);
    expect(f.sx).toBeCloseTo(100, 0); expect(f.sy).toBeCloseTo(100, 0);
    expect(f.inliers).toBe(5); // dimension d (2.5 m printed on 100 px) is the odd one out
    const loo = looFit(ev(), 'a')!;
    expect(loo.ok).toBe(true);
    // a set with only two items cannot be checked: leaving one out leaves too little
    expect(looFit({ dims: ev().dims.slice(0, 2), labels: [] }, 'a')?.ok ?? false).toBe(false);
  });
  it('a label is matched whichever way round it is printed', () => {
    expect(labelFit({ id: 'x', owner: 'x', wPx: 250, hPx: 350, a: 3.5, b: 2.5 }, 100, 100).orient).toBe(1);
    expect(labelFit({ id: 'x', owner: 'x', wPx: 350, hPx: 250, a: 3.5, b: 2.5 }, 100, 100).orient).toBe(0);
  });
  it('a picture stretched on one axis gets one scale per direction', () => {
    const e: Evidence = { dims: [], labels: [] };
    for (let i = 0; i < 6; i++) { const a = 2 + i * 0.7, b = 3 + i * 0.4; e.labels.push({ id: `r${i}`, owner: `r${i}`, wPx: a * 100, hPx: b * 125, a, b }); }
    for (let i = 0; i < 4; i++) { e.dims.push({ id: `x${i}`, owner: `x${i}`, px: (1.5 + i) * 100, m: 1.5 + i, axis: 'x', src: 'dim' }, { id: `y${i}`, owner: `y${i}`, px: (1.2 + i) * 125, m: 1.2 + i, axis: 'y', src: 'dim' }); }
    const f = fitScale(e)!;
    expect(f.mode).toBe('axis'); expect(f.aniso).toBe(true); expect(f.notToScale).toBe(false);
    expect(f.sx).toBeCloseTo(100, 0); expect(f.sy).toBeCloseTo(125, 0);
  });
  it('a chain that adds up is recognised, and so is one that does not', () => {
    const dims = [{ id: 'm1', axis: 'x' as const, lo: 0, hi: 100, perp: 10, m: 1.0 }, { id: 'm2', axis: 'x' as const, lo: 100, hi: 300, perp: 10, m: 2.0 }, { id: 'o', axis: 'x' as const, lo: 0, hi: 300, perp: 60, m: 3.0 }];
    const ok = findChains(dims, 4);
    expect(ok).toHaveLength(1); expect(ok[0].ok).toBe(true);
    dims[1].m = 2.1;
    expect(findChains(dims, 4)[0].ok).toBe(false);
  });
});

describe('what leaves the machine', () => {
  it('words that mark title-block or contact text are recognised; plan text is not', () => {
    for (const t of ['DRAWN BY AB', 'Sheet No A-101', ['info', 'example.org'].join('@'), 'Tel 98 7654 3210 11', 'Client approval', 'ALL RIGHTS RESERVED']) expect(isTitleBlockText(t), t).toBe(true);
    for (const t of ['MASTER BED ROOM', '12\'0"X11\'6"', '3050 X 4000', 'KITCHEN', 'WARDROBE 9\'0" RFT', '2\'-11"']) expect(isTitleBlockText(t), t).toBe(false);
  });
  it('the broker notice says that drawings are sent to a model provider, and that title blocks are blanked', () => {
    expect(visionNotice(true)).toBe(VISION_NOTICE);
    expect(VISION_NOTICE).toMatch(/sent to an AI model provider/);
    expect(VISION_NOTICE).toMatch(/Title blocks/);
    expect(visionNotice(false)).toMatch(/Nothing leaves this computer/);
  });
  it('text areas are painted white and the drawing is not touched', () => {
    const g = newGray(100, 100, 255); for (let i = 0; i < 100; i++) { g.data[10 * 100 + i] = 0; g.data[90 * 100 + i] = 0; }
    const out = redactTextBlocks(g, [{ id: 'v1', rect: [0, 80, 100, 100], kind: 'text', areaFrac: 0.2, inkPx: 1, thickFrac: 0, glyphs: 9, framed: false, longLines: 0, reason: 't' }], 0);
    expect(out.data[10 * 100 + 50]).toBe(0);
    expect(out.data[90 * 100 + 50]).toBe(255);
    const w = newGray(10, 10, 0); whiteOut(w, [2, 2, 5, 5]); expect(w.data[3 * 10 + 3]).toBe(255);
  });

  /** A provider that remembers every picture it is shown. */
  class Spy implements VisionProvider {
    readonly name = 'spy'; readonly model = 'm'; readonly cropModel = 'c';
    pics: { method: string; layout: boolean; png: Uint8Array }[] = [];
    constructor(public inner: MockVisionProvider) {}
    usage(): ReturnType<VisionProvider['usage']> { return this.inner.usage(); }
    async readView(png: Uint8Array, k: 'plan' | 'elevation', schema: object): Promise<unknown> { this.pics.push({ method: 'readView', layout: (schema as { $id?: string }).$id === LAYOUT_SCHEMA_ID, png }); return this.inner.readView(png, k, schema); }
    async readStrings(c: CropIn[]): Promise<StringRead[]> { for (const x of c) this.pics.push({ method: 'readStrings', layout: false, png: x.png }); return this.inner.readStrings(c); }
    async classify(c: { id: string; png: Uint8Array }[], ch: string[]): Promise<ClassRead[]> { for (const x of c) this.pics.push({ method: 'classify', layout: false, png: x.png }); return this.inner.classify(c, ch); }
    propose = (): never => { throw new Error('unused'); };
  }

  for (const [seed, shows] of [[2, true], [6, false], [24, true]] as [number, boolean][]) {
    it(`set ${seed}: every picture that carries drawing content is blank where the title block and notes were, and no whole page is sent`, async () => {
      const b = buildSet(seed); const tw = buildTwin(b);
      const spy = new Spy(new MockVisionProvider(tw.world));
      const run = await readRasterPages(tw.pages, { provider: spy });
      expect(run.status).toBe('ok');
      const world = tw.world.p1;
      let checked = 0;
      for (const p of spy.pics) {
        const L = lineageOf(p.png)!;
        const g = decodePng(p.png);
        if (p.layout) { expect(Math.max(g.width, g.height)).toBeLessThanOrEqual(512); continue; } // the layout thumbnail is unreadably small by design
        if (L.pageId !== 'p1') continue;
        for (const r of world.textBlocks) {
          // the part of the block that falls inside this picture
          const c = ([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] as Pt[]).map((q) => applyMat(L.fromOriginal, q));
          const x0 = Math.max(0, Math.ceil(Math.min(...c.map((q) => q[0])))), x1 = Math.min(g.width, Math.floor(Math.max(...c.map((q) => q[0]))));
          const y0 = Math.max(0, Math.ceil(Math.min(...c.map((q) => q[1])))), y1 = Math.min(g.height, Math.floor(Math.max(...c.map((q) => q[1]))));
          if (x1 - x0 < 6 || y1 - y0 < 6) continue;
          let dark = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.data[y * g.width + x] < 150) dark++;
          expect(dark / ((x1 - x0) * (y1 - y0)), `${p.method} picture still shows the text block`).toBeLessThan(0.001);
          checked++;
        }
      }
      if (shows) expect(checked).toBeGreaterThan(0); // in this set the plan crop reaches the text blocks, so they had to be blanked
      // minimal: the plan goes as one crop, never the page; crops are tight; counts are logged
      const page = tw.pages[0].image; const pageArea = page.width * page.height;
      const view = run.sent.find((s) => s.kind === 'view')!;
      expect(view).toBeTruthy();
      expect((view.rect[2] - view.rect[0]) * (view.rect[3] - view.rect[1])).toBeLessThan(0.95 * pageArea);
      const crops = run.sent.filter((s) => s.kind === 'crop');
      expect(crops.length).toBeGreaterThan(5);
      expect(Math.max(...crops.map((c) => c.w * c.h))).toBeLessThan(0.03 * pageArea);
      expect(run.sent.every((s) => s.bytes > 0 && s.purpose.length > 0)).toBe(true);
    }, 120000);
  }
});

describe('the whole path, no network', () => {
  it('vision off: nothing is sent; the local reader runs, and a picture it cannot read is refused in words', async () => {
    const tw = buildTwin(buildSet(2));
    const run = await readRasterPages(tw.pages, { provider: null });
    // the synthetic twin's lettering is stroke text that Tesseract cannot read (or no Tesseract is installed): either way, refused in words
    expect(run.status).toBe('refused');
    expect(run.reason).toMatch(/Vision is off/);
    expect(run.sent).toEqual([]);
    expect(run.cost.usd).toBe(0); expect(run.cost.visionCalls).toBe(0);
    expect(run.notice).toMatch(/Nothing leaves this computer/);
    await expect(proposeFromRaster(null, { image: encodePng(tw.pages[0].image), mime: 'image/png' })).rejects.toMatchObject({ code: 'vision-not-configured' });
    expect(new ImportError('vision-failed').code).toBe('vision-failed');
  }, 60000);

  it('C8\'s interface works end to end: PNG bytes in, a proposal out, with the three honesty fields on every value', async () => {
    const b = buildSet(2); const tw = buildTwin(b);
    const mock = new MockVisionProvider(tw.world);
    const res = await mock.propose({ image: encodePng(tw.pages[0].image), mime: 'image/png' });
    expect(res.proposal.rooms.length).toBe(b.truth.rooms.length);
    expect(res.proposal.openings.length).toBeGreaterThan(5);
    expect(res.extras.rooms.every((r) => typeof (r as { verified?: boolean }).verified === 'boolean')).toBe(true);
    const run = await readRasterPages(tw.pages, { provider: new MockVisionProvider(tw.world) });
    const u = run.understanding;
    for (const r of u.rooms) for (const v of [r.label, r.roomType, r.width, r.length, r.area]) {
      expect(['vision', 'derived']).toContain(v.method);
      expect(v.confidence).toBeGreaterThan(0); expect(v.confidence).toBeLessThanOrEqual(1);
      expect(['verified', 'unverified', 'conflict']).toContain(v.status);
    }
    // a model read starts unverified: nothing is `verified` unless it carries a passed check
    for (const v of [...u.rooms.flatMap((r) => [r.width, r.length, r.area]), ...u.dimensions.map((d) => d.value)]) if (v.status === 'verified') expect(v.checks.some((c) => c.ok)).toBe(true);
    // the buyer-facing file carries no unverified number
    expect(run.designs.items).toEqual({});
    expect(run.designs.source).toBe('Imported drawing set, 1 page');
    expect(run.understanding.input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(run.understanding)).not.toMatch(/\.(png|jpg|pdf)/i);
    expect(run.cost.visionCalls).toBeGreaterThanOrEqual(4);
    expect(run.cost.usd).toBeGreaterThan(0);
    expect(run.stages.map((s) => s.stage)).toEqual(expect.arrayContaining(['clean', 'classify', 'read-plan', 'snap', 'reread', 'fit-and-check', 'write']));
  }, 120000);
});
