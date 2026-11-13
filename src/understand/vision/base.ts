// C12d. Shared behaviour of the two network providers: batching crops, turning model JSON into the interface's answers,
// dropping answers without a box, and keeping the usage meter. A subclass only has to send one request.
import type { ImportResult } from '../../import/types';
import type { PlanVisionInput } from '../../import/vision';
import { LAYOUT_SCHEMA, LAYOUT_SCHEMA_ID, PLAN_SCHEMA, STRINGS_SCHEMA, SYSTEM, boxFromNorm, classifyPrompt, classifySchema, layoutPrompt, parseLayout, parsePlanRead, planPrompt, stringsPrompt } from './prompts';
import { UsageMeter } from './pricing';
import type { ClassRead, CropIn, LayoutRead, PlanRead, StringRead, VisionProvider, VisionUsage } from './provider';
import { VisionError } from './provider';
import { pngSize } from './png-size';

export interface GenerateIn { system: string; prompt: string; images: { label: string; png: Uint8Array }[]; schema: object; tier: 'view' | 'crops' }
export interface GenerateOut { json: unknown; inputTokens: number; outputTokens: number; ms: number }

export abstract class HttpVisionProvider implements VisionProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract readonly cropModel: string;
  readonly meter = new UsageMeter();
  /** crops per request */
  protected batch = 12;
  /** answers dropped for lacking a box, for the run log */
  droppedAnswers = 0;
  protected abstract generate(i: GenerateIn): Promise<GenerateOut>;
  protected modelFor(tier: GenerateIn['tier']): string { return tier === 'view' ? this.model : this.cropModel; }

  usage(): VisionUsage { return this.meter.snapshot(); }

  private async call(kind: string, i: GenerateIn): Promise<unknown> {
    const out = await this.generate(i);
    this.meter.add(kind, this.modelFor(i.tier), out.ms, out.inputTokens, out.outputTokens, i.images.length);
    return out.json;
  }

  async readStrings(crops: CropIn[]): Promise<StringRead[]> {
    const res: StringRead[] = [];
    for (let s = 0; s < crops.length; s += this.batch) {
      const part = crops.slice(s, s + this.batch);
      const json = await this.call('read-strings', {
        system: SYSTEM, prompt: stringsPrompt(part.map((c) => c.hint ?? 'text')), schema: STRINGS_SCHEMA, tier: 'crops',
        images: part.map((c) => ({ label: c.id, png: c.png })),
      });
      const items = ((json as { items?: unknown[] } | null)?.items ?? []) as Record<string, unknown>[];
      for (const c of part) {
        const it = items.find((x) => x && x.id === c.id);
        if (!it) continue;
        const { w, h } = pngSize(c.png);
        const b = boxFromNorm(it.box, w, h);
        const text = typeof it.text === 'string' ? it.text.trim() : '';
        if (!b || !text) { this.droppedAnswers++; continue; }
        res.push({ id: c.id, text, box: b, confidence: typeof it.confidence === 'number' ? Math.min(1, Math.max(0, it.confidence)) : 0.5 });
      }
    }
    return res;
  }

  async classify(crops: { id: string; png: Uint8Array }[], choices: string[]): Promise<ClassRead[]> {
    const res: ClassRead[] = [];
    for (let s = 0; s < crops.length; s += this.batch) {
      const part = crops.slice(s, s + this.batch);
      const json = await this.call('classify', { system: SYSTEM, prompt: classifyPrompt(choices), schema: classifySchema(choices), tier: 'crops', images: part.map((c) => ({ label: c.id, png: c.png })) });
      for (const it of (((json as { items?: unknown[] } | null)?.items ?? []) as Record<string, unknown>[])) {
        if (it && typeof it.id === 'string' && typeof it.choice === 'string' && choices.includes(it.choice) && part.some((c) => c.id === it.id)) res.push({ id: it.id, choice: it.choice, confidence: typeof it.confidence === 'number' ? it.confidence : 0.5 });
      }
    }
    return res;
  }

  async readView(png: Uint8Array, kind: 'plan' | 'elevation', schema: object): Promise<PlanRead | LayoutRead> {
    if (kind !== 'plan') throw new VisionError('bad-answer', 'Only plan views are read from images for now.');
    const { w, h } = pngSize(png);
    if ((schema as { $id?: string } | null)?.$id === LAYOUT_SCHEMA_ID) {
      // a thumbnail: where the title block and notes are. The cheap model is enough.
      const lj = await this.call('read-layout', { system: SYSTEM, prompt: layoutPrompt(w, h), schema: LAYOUT_SCHEMA, tier: 'crops', images: [{ label: 'sheet', png }] });
      return { boxes: parseLayout(lj, w, h) };
    }
    const json = await this.call('read-view', { system: SYSTEM, prompt: planPrompt(w, h), schema: PLAN_SCHEMA, tier: 'view', images: [{ label: 'plan', png }] });
    const { read, dropped } = parsePlanRead(json, w, h);
    this.droppedAnswers += dropped;
    return read;
  }

  /** C8's interface: a whole raster plan in, a proposal out. Runs the raster path with this provider. */
  async propose(input: PlanVisionInput): Promise<ImportResult> {
    const { proposeFromRaster } = await import('../raster');
    return proposeFromRaster(this, input);
  }
}
