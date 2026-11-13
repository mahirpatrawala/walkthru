// C12d. SPEC 17.8: Gemini over its REST API with plain fetch (no SDK). Server side only. Flash reads the many small crops,
// Pro reads whole raster views. The key goes in a header, never in the URL.
// UNVERIFIED (no key exists yet): the model ids below come from SPEC 17.8, the field names from Google's public REST docs for
// earlier models, and whether these models return usable boxes on line drawings is exactly what the first live run measures.
import { HttpVisionProvider } from './base';
import type { GenerateIn, GenerateOut } from './base';
import { VisionError } from './provider';
import { redact } from './keys';

export const GEMINI_FLASH = 'gemini-3.8-flash';
export const GEMINI_PRO = 'gemini-3.1-pro-preview';
export interface GeminiOptions {
  key: string; model?: string; cropModel?: string; baseUrl?: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number;
}

/** The subset of JSON Schema Gemini's responseSchema accepts: no $id, no additionalProperties. */
export function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) { if (k === '$id' || k === '$schema' || k === 'additionalProperties') continue; o[k] = geminiSchema(v); }
  return o;
}
const b64 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');

export class GeminiProvider extends HttpVisionProvider {
  readonly name = 'gemini';
  readonly model: string; readonly cropModel: string;
  private key: string; private base: string; private f: typeof fetch; private sleep: (ms: number) => Promise<void>; private retries: number; private timeoutMs: number;
  constructor(o: GeminiOptions) {
    super();
    if (!o.key) throw new VisionError('no-key', 'No Gemini key.');
    this.key = o.key; this.model = o.model ?? GEMINI_PRO; this.cropModel = o.cropModel ?? GEMINI_FLASH;
    this.base = o.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.f = o.fetch ?? ((...a) => fetch(...a));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retries = o.maxRetries ?? 3; this.timeoutMs = o.timeoutMs ?? 180_000;
  }

  /** The request body for one call (exported through `buildRequest` for tests: no network, no key in it). */
  buildRequest(i: GenerateIn): { url: string; headers: Record<string, string>; body: unknown } {
    const parts: unknown[] = [{ text: i.prompt }];
    for (const im of i.images) { parts.push({ text: `id: ${im.label}` }); parts.push({ inline_data: { mime_type: 'image/png', data: b64(im.png) } }); }
    return {
      url: `${this.base}/models/${this.modelFor(i.tier)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: {
        systemInstruction: { parts: [{ text: i.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(i.schema), maxOutputTokens: i.tier === 'view' ? 32768 : 8192 },
      },
    };
  }

  protected async generate(i: GenerateIn): Promise<GenerateOut> {
    const req = this.buildRequest(i);
    const t0 = Date.now();
    let lastErr = 'no attempt';
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await this.sleep(Math.min(20_000, 1500 * 2 ** (attempt - 1)));
      let res: Response;
      try {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
        try { res = await this.f(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctl.signal }); } finally { clearTimeout(timer); }
      } catch (e) { lastErr = redact(`network: ${(e as Error).message}`, this.key); continue; }
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) { lastErr = redact(`HTTP ${res.status}`, this.key); continue; }
      if (!res.ok) throw new VisionError('http', redact(`Gemini answered HTTP ${res.status}: ${text.slice(0, 300)}`, this.key));
      let data: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; promptFeedback?: { blockReason?: string } };
      try { data = JSON.parse(text); } catch { throw new VisionError('bad-answer', 'Gemini answered with something that is not JSON.'); }
      const cand = data.candidates?.[0];
      if (!cand) throw new VisionError('refused', `Gemini returned no answer${data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}.`);
      const out = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      let json: unknown;
      try { json = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new VisionError('bad-answer', `Gemini's answer was not valid JSON (finish reason ${cand.finishReason ?? 'unknown'}).`); }
      const u = data.usageMetadata ?? {};
      return { json, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), ms: Date.now() - t0 };
    }
    throw new VisionError('network', `Gemini did not answer after ${this.retries + 1} tries (${lastErr}).`);
  }
}
