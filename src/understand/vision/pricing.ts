// C12d. SPEC 17.13: what a call costs. A snapshot of the price pages on 13 Nov 2026, kept as data with the date each
// price changes, so a run logs real dollars and the estimate before a live run uses the same table.
export interface Price { inPerM: number; outPerM: number; /** from this date (ISO) the next entry applies */ until?: string }
export const PRICES: Record<string, Price[]> = {
  'gemini-3.8-flash': [{ inPerM: 0.75, outPerM: 3.75, until: '2027-01-01' }, { inPerM: 1.5, outPerM: 7.5 }],
  'gemini-3.1-pro-preview': [{ inPerM: 2, outPerM: 12 }],
  'gemini-4-carbon': [{ inPerM: 2, outPerM: 10, until: '2026-11-30' }, { inPerM: 4, outPerM: 20 }],
  'claude-opus-5-5': [{ inPerM: 4, outPerM: 20 }],
};
export function priceOf(model: string, on: Date = new Date()): Price | null {
  const list = PRICES[model];
  if (!list) return null;
  const day = on.toISOString().slice(0, 10);
  for (const p of list) if (!p.until || day < p.until) return p;
  return list[list.length - 1];
}
export function usdOf(model: string, inputTokens: number, outputTokens: number, on?: Date): number {
  const p = priceOf(model, on);
  return p ? (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1e6 : 0;
}
/** Image tokens as Google documents them for earlier Gemini models: 258 per 768 px tile, at least 258. The price page does not
 *  say how the 3.x models count images, so this is a guess that the live run replaces with the real usageMetadata. */
export function estimateImageTokens(w: number, h: number): number {
  return Math.max(1, Math.ceil(w / 768)) * Math.max(1, Math.ceil(h / 768)) * 258;
}
export const estimateTextTokens = (chars: number): number => Math.ceil(chars / 3.6);
/** Reasoning tokens a model spends before it answers, billed as output. Guesses: a Pro model reads a plan for a while. */
export const THINKING_GUESS = { view: 5000, crops: 700 };

/** Running total for one provider instance. */
export class UsageMeter {
  calls = 0; inputTokens = 0; outputTokens = 0; usd = 0;
  readonly log: { kind: string; model: string; ms: number; inputTokens: number; outputTokens: number; usd: number; images: number }[] = [];
  add(kind: string, model: string, ms: number, inputTokens: number, outputTokens: number, images: number): void {
    const usd = usdOf(model, inputTokens, outputTokens);
    this.calls++; this.inputTokens += inputTokens; this.outputTokens += outputTokens; this.usd += usd;
    this.log.push({ kind, model, ms, inputTokens, outputTokens, usd, images });
  }
  snapshot(): { calls: number; inputTokens: number; outputTokens: number; usd: number } {
    return { calls: this.calls, inputTokens: this.inputTokens, outputTokens: this.outputTokens, usd: this.usd };
  }
}
