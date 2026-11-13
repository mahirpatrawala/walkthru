// C12d. SPEC 17.13: what a raster run will cost and take, before it is started. Built from the price table and the same guesses the
// simulated provider uses; `--live` runs print this and wait for --yes. Every figure is an estimate until a live run replaces it
// with the real usageMetadata.
import { THINKING_GUESS, estimateImageTokens, estimateTextTokens, usdOf } from './pricing';

export interface EstimateIn {
  pages: number;
  /** drawings the page splitter will find (default one per page) */ drawings?: number;
  /** longest side of the plan crop sent to the plan model (default 2000) */ planSide?: number;
  /** dimension strings and labels to re-read from crops (default 38) */ crops?: number;
  proModel?: string; flashModel?: string;
}
export interface Estimate { calls: number; inputTokens: number; outputTokens: number; usd: number; seconds: number; lines: string[] }

export function estimateRaster(i: EstimateIn): Estimate {
  const pro = i.proModel ?? 'gemini-3.1-pro-preview', flash = i.flashModel ?? 'gemini-3.8-flash';
  const drawings = i.drawings ?? i.pages, side = i.planSide ?? 2000, crops = i.crops ?? 38;
  const rows: { what: string; model: string; calls: number; inTok: number; outTok: number; sec: number }[] = [];
  const thumb = estimateImageTokens(512, 362);
  rows.push({ what: 'layout (title block) per page', model: flash, calls: i.pages, inTok: i.pages * (thumb + estimateTextTokens(400)), outTok: i.pages * (60 + THINKING_GUESS.crops), sec: i.pages * 3 });
  const cls = Math.ceil(drawings / 12);
  rows.push({ what: 'which drawing is the plan', model: flash, calls: cls, inTok: drawings * estimateImageTokens(384, 270) + cls * estimateTextTokens(300), outTok: cls * THINKING_GUESS.crops + drawings * 30, sec: cls * 3 });
  rows.push({ what: 'read the plan (whole crop)', model: pro, calls: 1, inTok: estimateImageTokens(Math.round(side * 0.7), side) + estimateTextTokens(900), outTok: 3500 + THINKING_GUESS.view, sec: 45 });
  const rc = Math.ceil(crops / 12);
  rows.push({ what: 'tight crops: each dimension and label', model: flash, calls: rc, inTok: crops * estimateImageTokens(160, 60) + rc * estimateTextTokens(500), outTok: crops * 25 + rc * THINKING_GUESS.crops, sec: rc * 6 });
  let calls = 0, inT = 0, outT = 0, usd = 0, sec = 0; const lines: string[] = [];
  for (const r of rows) {
    const u = usdOf(r.model, r.inTok, r.outTok);
    calls += r.calls; inT += r.inTok; outT += r.outTok; usd += u; sec += r.sec;
    lines.push(`${r.what}: ${r.calls} call${r.calls === 1 ? '' : 's'} on ${r.model}, about ${Math.round(r.inTok)} in / ${Math.round(r.outTok)} out tokens, $${u.toFixed(3)}`);
  }
  return { calls, inputTokens: inT, outputTokens: outT, usd, seconds: sec, lines };
}
