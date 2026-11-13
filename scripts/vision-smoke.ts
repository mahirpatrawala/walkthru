// C12d: ONE live smoke test of the vision providers. It runs only when the key file exists and skips (exit 0) otherwise.
//   tsx scripts/vision-smoke.ts [--yes] [--claude] [--env-key] [--seed 2]
// What it does: builds one synthetic raster page (no real drawing, nothing private), prints the number of calls and the estimated
// cost, and stops there unless --yes is given. With --yes it runs the whole raster path against the real model and prints
//   - the raster fields of SPEC 17.11 scored against the page's truth,
//   - the honesty bar (verified values that are wrong),
//   - the first thing SPEC 17.16 item 4 asks for: do the boxes line up with the drawing? (rooms matched by overlap, mean overlap),
//   - real calls, tokens, dollars and seconds (replacing the estimates).
// Key: ~/walkthru-tools/.gemini-key (or .anthropic-key with --claude). The environment is read only with --env-key, so a
// stray variable in a shell can never be picked up. Never any other key.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSet } from './make-drawing-sets';
import { buildTwin, planOnlyTruth } from './eval/raster-world';
import { rasterPipeline } from './eval/raster-pipeline';
import { formatReport, runEval, wrongVerified } from './eval/run';
import type { EvalSet } from './eval/run';
import { rasterDims } from './eval/synthetic';
import { GEMINI_KEY_FILE, ANTHROPIC_KEY_FILE, resolveAnthropicKey, resolveGeminiKey } from '../src/understand/vision/keys';
import type { KeyEnv } from '../src/understand/vision/keys';
import { GeminiProvider } from '../src/understand/vision/gemini';
import { ClaudeProvider } from '../src/understand/vision/claude';
import { estimateRaster } from '../src/understand/vision/estimate';
import { VISION_NOTICE } from '../src/understand/notice';
import type { VisionProvider } from '../src/understand/vision/provider';
import type { RasterRun } from '../src/understand/raster';

export interface SmokeOpts extends KeyEnv { yes?: boolean; claude?: boolean; envKey?: boolean; seed?: number; log?: (s: string) => void; fetch?: typeof fetch }
export interface SmokeResult { status: 'skipped' | 'estimated' | 'ran'; why?: string; estimateUsd?: number; wrongVerified?: { n: number; wrong: number }; usd?: number }

/** The skip rule, on its own so it can be tested: no key file, no live run. */
export function smokeKey(o: SmokeOpts): { provider: 'gemini' | 'claude'; key: string; from: string } | null {
  if (o.claude) {
    try { const k = resolveAnthropicKey({ home: o.home, env: o.envKey ? o.env : {}, readFile: o.readFile }); return { provider: 'claude', key: k.key, from: k.from }; } catch { return null; }
  }
  const k = resolveGeminiKey({ home: o.home, env: o.env, readFile: o.readFile, allowEnv: !!o.envKey });
  return k ? { provider: 'gemini', key: k.key, from: k.from } : null;
}

export async function runSmoke(o: SmokeOpts): Promise<SmokeResult> {
  const log = o.log ?? ((s: string) => console.log(s));
  const k = smokeKey(o);
  if (!k) {
    const file = o.claude ? ANTHROPIC_KEY_FILE(o.home) : GEMINI_KEY_FILE(o.home);
    log(`SKIP: no key at ${file}${o.envKey ? ' and none in the environment' : ''}. Nothing was sent anywhere.`);
    return { status: 'skipped', why: 'no key' };
  }
  const b = buildSet(o.seed ?? 2);
  const tw = buildTwin(b);
  const est = estimateRaster({ pages: tw.pages.length, drawings: tw.pages.length, crops: tw.world.p1.dims.length + tw.world.p1.rooms.length });
  log(VISION_NOTICE);
  log(`This is a synthetic page (seed ${b.truth.seed}); nothing private. Key from ${k.from}.`);
  log('Estimated live run (13 Nov 2026 prices, guessed token counts):');
  for (const l of est.lines) log(`  ${l}`);
  log(`  total: ${est.calls} calls, about $${est.usd.toFixed(3)}, about ${Math.round(est.seconds)} s`);
  if (!o.yes) { log('Not run. Add --yes to spend this.'); return { status: 'estimated', estimateUsd: est.usd }; }
  const provider: VisionProvider = k.provider === 'gemini' ? new GeminiProvider({ key: k.key, fetch: o.fetch }) : new ClaudeProvider({ key: k.key, fetch: o.fetch });
  const t = b.truth;
  const set: EvalSet = { id: t.id, split: t.split, firm: t.firm, origin: 'synthetic', truth: planOnlyTruth(t), raster: { pageCount: t.page.pages, ...rasterDims(t.page.widthPt, t.page.heightPt, t.options.raster.dpi) } };
  let run: RasterRun | null = null;
  const rep = await runEval([set], rasterPipeline(new Map([[tw.id, tw]]), { provider: () => provider, onRun: (_id, r) => { run = r; } }));
  log(formatReport(rep, `Live smoke: ${provider.name} (${provider.model} for the plan, ${provider.cropModel} for crops)`));
  const wv = wrongVerified(rep);
  log(`Honesty bar: ${wv.wrong} wrong of ${wv.n} verified values.`);
  const r = run as RasterRun | null;
  if (r) {
    log(`Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}. Rooms found: ${r.understanding.rooms.length} of ${tw.truth.rooms.length}. Dimensions found: ${r.understanding.dimensions.length} of ${tw.world.p1.dims.length}. Warnings: ${r.understanding.warnings.length}.`);
    log(`Real usage: ${r.cost.visionCalls} calls, ${r.cost.inputTokens} in / ${r.cost.outputTokens} out tokens, $${r.cost.usd.toFixed(4)}, ${r.cost.seconds.toFixed(1)} s on the wire (${r.cost.wallSeconds.toFixed(1)} s wall).`);
    log(`What was sent: ${r.sent.map((s) => `${s.kind} ${s.w}x${s.h}`).join(', ')}.`);
    log('Read the SPEC 17.16 item 4 question off the table above: if rooms and dimension strings were found and the room size scores are high, the boxes are usable. If rooms were dropped for having no walls under them, the boxes are not lining up.');
  }
  return { status: 'ran', wrongVerified: { n: wv.n, wrong: wv.wrong }, usd: r?.cost.usd };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const res = await runSmoke({ yes: args.includes('--yes'), claude: args.includes('--claude'), envKey: args.includes('--env-key'), seed: val('--seed') ? Number(val('--seed')) : undefined });
  if (res.wrongVerified && res.wrongVerified.n && res.wrongVerified.wrong / res.wrongVerified.n > 0.005) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();
