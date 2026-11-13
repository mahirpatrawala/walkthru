// C12d. SPEC 17.8 `recorded.ts`: record what a provider answered, and replay it later with no network. A request is keyed by
// its kind and a hash of the picture bytes (and the choices or hints), so the same page gives the same key on every run.
// Replay never touches the network and never needs a key; asking for something that was not recorded is an error, not a guess.
import { createHash } from 'node:crypto';
import type { ImportResult } from '../../import/types';
import type { PlanVisionInput } from '../../import/vision';
import type { ClassRead, CropIn, StringRead, VisionProvider, VisionUsage } from './provider';
import { VisionError } from './provider';

export interface Recording { version: 1; provider: string; entries: Record<string, unknown>; usage: VisionUsage }
const h = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex').slice(0, 16);
const keyView = (png: Uint8Array, schema: object): string => `view:${(schema as { $id?: string }).$id ?? ''}:${h(png)}`;
const keyStrings = (c: CropIn): string => `str:${c.hint ?? ''}:${h(c.png)}`;
const keyClass = (png: Uint8Array, choices: string[]): string => `cls:${choices.join('|')}:${h(png)}`;

/** Wraps a provider; every answer is kept in `recording`. */
export class RecordingProvider implements VisionProvider {
  readonly recording: Recording;
  constructor(private inner: VisionProvider) { this.recording = { version: 1, provider: inner.name, entries: {}, usage: { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 } }; }
  get name(): string { return this.inner.name; }
  get model(): string { return this.inner.model; }
  get cropModel(): string { return this.inner.cropModel; }
  usage(): VisionUsage { return this.inner.usage(); }
  async readView(png: Uint8Array, kind: 'plan' | 'elevation', schema: object): Promise<unknown> {
    const out = await this.inner.readView(png, kind, schema); this.recording.entries[keyView(png, schema)] = out; this.recording.usage = this.inner.usage(); return out;
  }
  async readStrings(crops: CropIn[]): Promise<StringRead[]> {
    const out = await this.inner.readStrings(crops);
    for (const c of crops) this.recording.entries[keyStrings(c)] = out.find((o) => o.id === c.id) ?? null;
    this.recording.usage = this.inner.usage(); return out;
  }
  async classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<ClassRead[]> {
    const out = await this.inner.classify(crops, choices);
    for (const c of crops) this.recording.entries[keyClass(c.png, choices)] = out.find((o) => o.id === c.id) ?? null;
    this.recording.usage = this.inner.usage(); return out;
  }
  async propose(input: PlanVisionInput): Promise<ImportResult> { const { proposeFromRaster } = await import('../raster'); return proposeFromRaster(this, input); }
}

/** Plays a recording back. */
export class ReplayProvider implements VisionProvider {
  readonly name: string; readonly model = 'replay'; readonly cropModel = 'replay';
  constructor(private rec: Recording) { this.name = `replay:${rec.provider}`; }
  usage(): VisionUsage { return { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }; }
  private miss(what: string): never { throw new VisionError('bad-answer', `Nothing was recorded for this ${what}. Record it again with a live run.`); }
  async readView(png: Uint8Array, _kind: 'plan' | 'elevation', schema: object): Promise<unknown> {
    const k = keyView(png, schema); if (!(k in this.rec.entries)) this.miss('picture'); return this.rec.entries[k];
  }
  async readStrings(crops: CropIn[]): Promise<StringRead[]> {
    const out: StringRead[] = [];
    for (const c of crops) { const k = keyStrings(c); if (!(k in this.rec.entries)) this.miss('crop'); const e = this.rec.entries[k] as StringRead | null; if (e) out.push({ ...e, id: c.id }); }
    return out;
  }
  async classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<ClassRead[]> {
    const out: ClassRead[] = [];
    for (const c of crops) { const k = keyClass(c.png, choices); if (!(k in this.rec.entries)) this.miss('thumbnail'); const e = this.rec.entries[k] as ClassRead | null; if (e) out.push({ ...e, id: c.id }); }
    return out;
  }
  async propose(input: PlanVisionInput): Promise<ImportResult> { const { proposeFromRaster } = await import('../raster'); return proposeFromRaster(this, input); }
}
