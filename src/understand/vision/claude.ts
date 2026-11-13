// C12d. SPEC 17.8 alternate: Claude over the Messages API with plain fetch (the SPEC says the official SDK; the brief for this
// chunk asked for no new dependency, so this is REST. Swapping to @anthropic-ai/sdk later only changes `generate`).
// The key is passed in explicitly. The generic ANTHROPIC_API_KEY is never read here: `resolveAnthropicKey` refuses to start
// when that is the only key. Structured output uses output_config.format (forced tool_choice is rejected by this model).
// UNVERIFIED: no key exists yet, so request and response shapes follow Anthropic's docs and have not met the live API.
import { HttpVisionProvider } from './base';
import type { GenerateIn, GenerateOut } from './base';
import { VisionError } from './provider';
import { redact } from './keys';

export const CLAUDE_OPUS = 'claude-opus-5-5';
export interface ClaudeOptions { key: string; model?: string; cropModel?: string; baseUrl?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }

/** Structured outputs want closed objects and no $id. */
export function claudeSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(claudeSchema);
  if (!s || typeof s !== 'object') return s;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) { if (k === '$id' || k === '$schema') continue; o[k] = claudeSchema(v); }
  if (o.type === 'object') o.additionalProperties = false;
  return o;
}
const b64 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');

export class ClaudeProvider extends HttpVisionProvider {
  readonly name = 'claude';
  readonly model: string; readonly cropModel: string;
  private key: string; private base: string; private f: typeof fetch; private sleep: (ms: number) => Promise<void>; private retries: number; private timeoutMs: number;
  constructor(o: ClaudeOptions) {
    super();
    if (!o.key) throw new VisionError('no-key', 'No Anthropic key.');
    this.key = o.key; this.model = o.model ?? CLAUDE_OPUS; this.cropModel = o.cropModel ?? this.model;
    this.base = o.baseUrl ?? 'https://api.anthropic.com/v1';
    this.f = o.fetch ?? ((...a) => fetch(...a));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retries = o.maxRetries ?? 3; this.timeoutMs = o.timeoutMs ?? 300_000;
    this.batch = 8;
  }

  buildRequest(i: GenerateIn): { url: string; headers: Record<string, string>; body: unknown } {
    const content: unknown[] = [];
    for (const im of i.images) {
      content.push({ type: 'text', text: `id: ${im.label}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(im.png) } });
    }
    content.push({ type: 'text', text: i.prompt });
    return {
      url: `${this.base}/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      body: {
        model: this.modelFor(i.tier), max_tokens: i.tier === 'view' ? 32000 : 8000, system: i.system,
        output_config: { effort: i.tier === 'view' ? 'medium' : 'low', format: { type: 'json_schema', schema: claudeSchema(i.schema) } },
        messages: [{ role: 'user', content }],
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
      if (res.status === 429 || res.status === 529 || res.status >= 500) { lastErr = redact(`HTTP ${res.status}`, this.key); continue; }
      if (!res.ok) throw new VisionError('http', redact(`Claude answered HTTP ${res.status}: ${text.slice(0, 300)}`, this.key));
      let data: { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      try { data = JSON.parse(text); } catch { throw new VisionError('bad-answer', 'Claude answered with something that is not JSON.'); }
      if (data.stop_reason === 'refusal') throw new VisionError('refused', 'Claude declined to read this image.');
      const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      let json: unknown;
      try { json = JSON.parse(out); } catch { throw new VisionError('bad-answer', `Claude's answer was not valid JSON (stop reason ${data.stop_reason ?? 'unknown'}).`); }
      return { json, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, ms: Date.now() - t0 };
    }
    throw new VisionError('network', `Claude did not answer after ${this.retries + 1} tries (${lastErr}).`);
  }
}
