// C12d. A vision provider that answers from a known description of the page instead of calling a model (SPEC 17.8 `recorded`
// provider's job, and 17.10 "recorded vision answers ... generated from truth with seeded noise"). It exists so the whole raster
// path and the honesty statuses can be tested with no network, and so a LYING model can be simulated on purpose.
//
// It does not look at pixels. It is told where things are on the uploaded page (`MockWorld`, in the page's own pixels) and
// uses the picture's lineage (pixels/lineage.ts) to place them in whatever picture it is shown: the plan crop, a dimension
// crop, a thumbnail. Errors are configurable, per kind, and seeded.
import { mulberry32 } from '../../core/geometry';
import type { ImportResult } from '../../import/types';
import type { PlanVisionInput } from '../../import/vision';
import { UsageMeter, THINKING_GUESS, estimateImageTokens, estimateTextTokens } from './pricing';
import { LAYOUT_SCHEMA_ID, PLAN_SCHEMA_ID, STRINGS_SCHEMA_ID } from './prompts';
import type { Box, ClassRead, CropIn, LayoutRead, PlanRead, StringRead, VisionProvider, VisionUsage } from './provider';
import { VisionError } from './provider';
import { applyMat } from '../pixels/image';
import type { Pt, Rect } from '../pixels/image';
import { lineageOf } from '../pixels/lineage';
import { parseLengthLoose } from '../units';

export interface MockPageWorld {
  rooms: { label: string; sizeText: string; areaText: string; polyPx: Pt[] }[];
  dims: { text: string; aPx: Pt; bPx: Pt }[];
  openings: { kind: 'door' | 'window' | 'opening'; polyPx: Pt[] }[];
  symbols: { cls: string; label?: string; polyPx: Pt[] }[];
  /** title block, notes and legend areas, in page pixels */
  textBlocks: Rect[];
  /** what a region of the page is: 'plan', 'elevation', 'notes' ... (rect in page pixels) */
  classify(rect: Rect): string;
}
export type MockWorld = Record<string, MockPageWorld>;

export interface MockErrors {
  seed?: number;
  /** probability a printed number has one digit changed */ wrongDigits?: number;
  /** probability an answer comes back without a box (the provider layer drops it) */ missingBoxes?: number;
  /** probability a true item is left out of the answer */ dropped?: number;
  /** invented items per kind (rooms, dimensions, openings, symbols) */ hallucinated?: number;
  /** probability a room label or symbol class is swapped with another */ swapped?: number;
  /** box noise, as a share of the picture's long side (one standard deviation) */ jitter?: number;
  /** every printed number multiplied by this (a consistent lie) */ uniformScale?: number;
  /** the same item gets the same wrong text every time it is asked (a model that is wrong the same way twice) */ consistent?: boolean;
  /** a number of the read is wrong on the same digit in both the view read and the crop read */
}
/** One knob for the sweep: every error kind at about this rate. Rate 0 is an exact model: whatever it gets wrong, the pixel path did. */
export const errorsAtRate = (rate: number, seed = 1): MockErrors => ({ seed, wrongDigits: rate, missingBoxes: rate / 2, dropped: rate, hallucinated: rate > 0 ? Math.max(1, Math.round(rate * 12)) : 0, swapped: rate, jitter: rate > 0 ? 0.0015 + rate * 0.004 : 0 });

const SWAP: Record<string, string> = { wc: 'basin', basin: 'wc', bed: 'sofa', sofa: 'bed', sink: 'hob', hob: 'sink', wardrobe: 'tv unit', 'tv unit': 'wardrobe', desk: 'dining', dining: 'desk', shower: 'wc', counter: 'desk' };
const FAKE_LABELS = ['STORE', 'STUDY', 'BED ROOM', 'DINING', 'POOJA'];
const FAKE_CLASSES = ['bed', 'sofa', 'wc', 'hob', 'wardrobe'];
const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock';
  readonly model = 'mock-view';
  readonly cropModel = 'mock-crops';
  readonly meter = new UsageMeter();
  /** what a real call would take, for the latency estimate: guesses, see SPEC 17.13 */
  /** price list entries the simulated calls are costed as (the SPEC 17.8 defaults) */
  priceAs = { view: 'gemini-3.1-pro-preview', crops: 'gemini-3.8-flash' };
  latencyMs = { view: 45000, crops: 6000, classify: 3000 };
  private rnd: () => number;
  private world: MockWorld; private err: Required<MockErrors>;
  /** answers dropped for lacking a box */
  droppedAnswers = 0;
  constructor(world: MockWorld, errors: MockErrors = {}) {
    this.world = world;
    this.err = { seed: 1, wrongDigits: 0, missingBoxes: 0, dropped: 0, hallucinated: 0, swapped: 0, jitter: 0, uniformScale: 1, consistent: false, ...errors };
    this.rnd = mulberry32(this.err.seed * 7919 + 13);
  }
  usage(): VisionUsage { return this.meter.snapshot(); }

  // ---------------------------------------------------------------- randomness
  private roll(p: number, key?: string): boolean {
    if (p <= 0) return false;
    if (this.err.consistent && key) return mulberry32(hashStr(`${this.err.seed}|${key}`))() < p;
    return this.rnd() < p;
  }
  private gauss(): number { const u = Math.max(1e-9, this.rnd()), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  private wrongDigits(text: string, key: string): string {
    const idx: number[] = []; for (let i = 0; i < text.length; i++) if (/\d/.test(text[i])) idx.push(i);
    if (!idx.length) return text;
    const r = this.err.consistent ? mulberry32(hashStr(`${this.err.seed}|d|${key}`)) : this.rnd;
    const i = idx[Math.floor(r() * idx.length)];
    const d = (Number(text[i]) + 1 + Math.floor(r() * 8)) % 10;
    return text.slice(0, i) + d + text.slice(i + 1);
  }
  private scaleText(text: string): string {
    const f = this.err.uniformScale;
    if (f === 1) return text;
    const p = parseLengthLoose(text);
    if (!p) return text;
    const m = p.m * f;
    if (p.kind === 'ftin') { const inch = Math.round(m / 0.0254); return `${Math.floor(inch / 12)}'-${inch % 12}"`; }
    if (p.kind === 'bare-m' || p.kind === 'm') return m.toFixed(2);
    return String(Math.round(m * 1000));
  }
  /** a printed number as the model reports it */
  private says(text: string, key: string): string {
    if (!text) return text;
    let t = this.scaleText(text);
    if (this.roll(this.err.wrongDigits, key)) t = this.wrongDigits(t, key);
    return t;
  }
  private jit(v: number, scale: number): number { return this.err.jitter ? v + this.gauss() * this.err.jitter * scale : v; }
  private box(r: Rect, long: number): Box { return [this.jit(r[0], long), this.jit(r[1], long), this.jit(r[2], long), this.jit(r[3], long)]; }

  // ---------------------------------------------------------------- metering
  private meterCall(kind: string, tier: 'view' | 'crops', images: { w: number; h: number }[], promptChars: number, outChars: number): void {
    const inTok = images.reduce((a, i) => a + estimateImageTokens(i.w, i.h), 0) + estimateTextTokens(promptChars);
    const outTok = estimateTextTokens(outChars) + (tier === 'view' ? THINKING_GUESS.view : THINKING_GUESS.crops);
    const ms = kind === 'read-view' ? this.latencyMs.view : kind === 'classify' ? this.latencyMs.classify : this.latencyMs.crops;
    this.meter.add(kind, tier === 'view' ? this.priceAs.view : this.priceAs.crops, ms, inTok, outTok, images.length);
  }
  private locate(png: Uint8Array): { page: MockPageWorld; map: (p: Pt) => Pt; w: number; h: number; rect: Rect } {
    const L = lineageOf(png);
    if (!L) throw new VisionError('bad-answer', 'The mock provider was shown a picture it has no record of.');
    const page = this.world[L.pageId];
    if (!page) throw new VisionError('bad-answer', `The mock has no description of page ${L.pageId}.`);
    return { page, map: (p) => applyMat(L.fromOriginal, p), w: L.size.w, h: L.size.h, rect: L.rectOriginal };
  }

  // ---------------------------------------------------------------- the interface
  async readView(png: Uint8Array, kind: 'plan' | 'elevation', schema: object): Promise<PlanRead | LayoutRead> {
    if (kind !== 'plan') throw new VisionError('bad-answer', 'The mock reads plans only.');
    void PLAN_SCHEMA_ID;
    if ((schema as { $id?: string } | null)?.$id === LAYOUT_SCHEMA_ID) return this.readLayout(png);
    const { page, map, w, h } = this.locate(png);
    const long = Math.max(w, h);
    const inside = (c: Pt): boolean => c[0] >= 0 && c[1] >= 0 && c[0] <= w && c[1] <= h;
    const out: PlanRead = { rooms: [], dimensions: [], openings: [], symbols: [] };
    const bb = (pts: Pt[]): Rect => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const rooms = page.rooms.map((r, i) => ({ r, i, b: bb(r.polyPx.map(map)) })).filter((x) => inside([(x.b[0] + x.b[2]) / 2, (x.b[1] + x.b[3]) / 2]));
    // swapped labels: pairs of neighbouring rooms trade their names
    const names = rooms.map((x) => x.r.label);
    for (let k = 0; k + 1 < rooms.length; k += 2) if (this.roll(this.err.swapped, `swap${k}`)) [names[k], names[k + 1]] = [names[k + 1], names[k]];
    rooms.forEach((x, k) => {
      if (this.roll(this.err.dropped, `room${x.i}`)) return;
      const cx = (x.b[0] + x.b[2]) / 2, cy = (x.b[1] + x.b[3]) / 2, rw = x.b[2] - x.b[0], rh = x.b[3] - x.b[1];
      const lb: Rect = [cx - Math.max(10, rw * 0.2), cy - Math.max(7, rh * 0.06), cx + Math.max(10, rw * 0.2), cy + Math.max(7, rh * 0.06)];
      const withBox = !this.roll(this.err.missingBoxes);
      if (!withBox) { this.droppedAnswers++; return; }
      out.rooms.push({ label: names[k], sizeText: x.r.sizeText ? this.says(x.r.sizeText, `size${x.i}`) : undefined, areaText: x.r.areaText ? this.says(x.r.areaText, `area${x.i}`) : undefined, box: this.box(x.b, long), labelBox: x.r.label ? this.box(lb, long * 0.3) : undefined });
    });
    page.dims.forEach((d, i) => {
      const a = map(d.aPx), b = map(d.bPx);
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!inside(m) || this.roll(this.err.dropped, `dim${i}`)) return;
      if (this.roll(this.err.missingBoxes)) { this.droppedAnswers++; return; }
      const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      const tw = Math.max(18, d.text.length * 6), th = 11;
      const tb: Rect = horiz ? [m[0] - tw / 2, m[1] - th - 2, m[0] + tw / 2, m[1] - 2] : [m[0] - th - 2, m[1] - tw / 2, m[0] - 2, m[1] + tw / 2];
      out.dimensions.push({ text: this.says(d.text, `dim${i}`), box: this.box(tb, long * 0.3), line: [this.jit(a[0], long * 0.3), this.jit(a[1], long * 0.3), this.jit(b[0], long * 0.3), this.jit(b[1], long * 0.3)] });
    });
    page.openings.forEach((o, i) => {
      const r = bb(o.polyPx.map(map));
      if (!inside([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]) || this.roll(this.err.dropped, `open${i}`)) return;
      if (this.roll(this.err.missingBoxes)) { this.droppedAnswers++; return; }
      out.openings.push({ kind: o.kind, box: this.box(r, long) });
    });
    page.symbols.forEach((s, i) => {
      const r = bb(s.polyPx.map(map));
      if (!inside([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]) || this.roll(this.err.dropped, `sym${i}`)) return;
      if (this.roll(this.err.missingBoxes)) { this.droppedAnswers++; return; }
      const cls = this.roll(this.err.swapped, `cls${i}`) && SWAP[s.cls] ? SWAP[s.cls] : s.cls;
      out.symbols.push({ cls, label: s.label, box: this.box(r, long) });
    });
    // made-up items on blank paper or in the middle of a room
    for (let k = 0; k < this.err.hallucinated; k++) {
      const rb = (): Rect => { const bw = (0.08 + this.rnd() * 0.15) * w, bh = (0.08 + this.rnd() * 0.15) * h, x = this.rnd() * (w - bw), y = this.rnd() * (h - bh); return [x, y, x + bw, y + bh]; };
      const kind = k % 4;
      if (kind === 0) out.rooms.push({ label: FAKE_LABELS[k % FAKE_LABELS.length], sizeText: `${8 + (k % 5)}'0"X${9 + (k % 4)}'0"`, box: rb() });
      else if (kind === 1) { const b = rb(); out.dimensions.push({ text: `${3 + (k % 7)}'-${(k * 3) % 12}"`, box: b, line: [b[0], b[3] + 6, b[2], b[3] + 6] }); }
      else if (kind === 2) out.openings.push({ kind: 'door', box: rb() });
      else out.symbols.push({ cls: FAKE_CLASSES[k % FAKE_CLASSES.length], box: rb() });
    }
    this.meterCall('read-view', 'view', [{ w, h }], 900, JSON.stringify(out).length);
    return out;
  }

  private readLayout(png: Uint8Array): LayoutRead {
    const { page, map, w, h } = this.locate(png);
    const boxes: LayoutRead['boxes'] = [];
    page.textBlocks.forEach((r, i) => {
      if (this.roll(this.err.dropped * 0.5, `tb${i}`)) return;
      const a = map([r[0], r[1]]), b = map([r[2], r[3]]), c = map([r[0], r[3]]), d = map([r[2], r[1]]);
      const xs = [a[0], b[0], c[0], d[0]], ys = [a[1], b[1], c[1], d[1]];
      const box: Box = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(w, Math.max(...xs)), Math.min(h, Math.max(...ys))];
      if (box[2] > box[0] && box[3] > box[1]) boxes.push({ kind: 'title-block', box: this.box(box, Math.max(w, h) * 0.5) });
    });
    this.meterCall('read-layout', 'crops', [{ w, h }], 400, boxes.length * 60);
    return { boxes };
  }

  async readStrings(crops: CropIn[]): Promise<StringRead[]> {
    void STRINGS_SCHEMA_ID;
    const res: StringRead[] = [];
    for (let s = 0; s < crops.length; s += 12) {
      const part = crops.slice(s, s + 12);
      for (const c of part) {
        const { page, map, w, h } = this.locate(c.png);
        const centre: Pt = [w / 2, h / 2];
        let text = '', cx = 0, cy = 0, key = '';
        if (c.hint === 'label') {
          let best: { d: number; text: string; at: Pt; key: string } | null = null;
          page.rooms.forEach((r, i) => {
            if (!r.label) return;
            const p = map([r.polyPx.reduce((a, q) => a + q[0], 0) / r.polyPx.length, r.polyPx.reduce((a, q) => a + q[1], 0) / r.polyPx.length]);
            const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
            // a model that mixes up two neighbouring names does so on the second look as well
            const nm = this.roll(this.err.swapped, `lswap${i}`) ? (page.rooms[(i + 1) % page.rooms.length].label || r.label) : r.label;
            if (p[0] >= 0 && p[1] >= 0 && p[0] <= w && p[1] <= h && (!best || d < best.d)) best = { d, text: `${nm}\n${this.says(r.sizeText, `size${i}`)}${r.areaText ? ` ${this.says(r.areaText, `area${i}`)}` : ''}`, at: p, key: `label${i}` };
          });
          if (best) { const b = best as { text: string; at: Pt; key: string }; text = b.text; cx = b.at[0]; cy = b.at[1]; key = b.key; }
        } else {
          let best: { d: number; text: string; at: Pt; key: string } | null = null;
          page.dims.forEach((d, i) => {
            const a = map(d.aPx), b = map(d.bPx); const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const dist = Math.hypot(m[0] - centre[0], m[1] - centre[1]);
            if (m[0] >= 0 && m[1] >= 0 && m[0] <= w && m[1] <= h && (!best || dist < best.d)) best = { d: dist, text: this.says(d.text, `dim${i}`), at: m, key: `dim${i}` };
          });
          if (best) { const b = best as { text: string; at: Pt; key: string }; text = b.text; cx = b.at[0]; cy = b.at[1]; key = b.key; }
        }
        if (!text || this.roll(this.err.dropped * 0.5, `miss${key}`)) continue;
        if (this.roll(this.err.missingBoxes)) { this.droppedAnswers++; continue; }
        res.push({ id: c.id, text, box: [cx - 20, cy - 8, cx + 20, cy + 8], confidence: 0.8 });
      }
      this.meterCall('read-strings', 'crops', part.map((c) => { const L = lineageOf(c.png); return { w: L?.size.w ?? 128, h: L?.size.h ?? 48 }; }), 500, part.length * 60);
    }
    return res;
  }

  async classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<ClassRead[]> {
    const out: ClassRead[] = [];
    for (const c of crops) {
      const { page, rect } = this.locate(c.png);
      const choice = page.classify(rect);
      out.push({ id: c.id, choice: choices.includes(choice) ? choice : 'detail', confidence: 0.9 });
    }
    this.meterCall('classify', 'crops', crops.map((c) => { const L = lineageOf(c.png); return { w: L?.size.w ?? 384, h: L?.size.h ?? 384 }; }), 300, crops.length * 40);
    return out;
  }

  async propose(input: PlanVisionInput): Promise<ImportResult> {
    const { proposeFromRaster } = await import('../raster');
    return proposeFromRaster(this, input);
  }
}
