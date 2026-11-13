// C12d: score the raster path on the synthetic raster twins with the simulated vision provider (no network, no key).
//   tsx scripts/eval-raster.ts [--sets 24] [--seeds 1,2] [--rates 0,0.05,0.1,0.2] [--lie] [--consistent] [--no-vision] [--json out.json] [--verbose]
// --rates sweeps the simulated model's error rate (wrong digits, missing boxes, dropped and invented items, swapped labels, box noise).
// --lie adds a consistent lie on top: every printed number scaled by 1.25, and the same wrong digits every time.
// --no-vision runs with vision off: every picture is refused. Reports the raster fields of SPEC 17.11, the honesty bar, cost and latency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSet } from './make-drawing-sets';
import type { EvalSet } from './eval/run';
import { formatReport, runEval, wrongVerified } from './eval/run';
import { buildTwin, planOnlyTruth } from './eval/raster-world';
import type { RasterTwin } from './eval/raster-world';
import { rasterPipeline } from './eval/raster-pipeline';
import type { RasterRun } from '../src/understand/raster';
import { MockVisionProvider, errorsAtRate } from '../src/understand/vision/mock';
import type { MockErrors } from '../src/understand/vision/mock';
import { rasterDims } from './eval/synthetic';

export function buildTwins(seeds: number[]): { twins: Map<string, RasterTwin>; sets: EvalSet[] } {
  const twins = new Map<string, RasterTwin>(); const sets: EvalSet[] = [];
  for (const s of seeds) {
    const b = buildSet(s); const tw = buildTwin(b); twins.set(tw.id, tw);
    const t = b.truth;
    sets.push({ id: t.id, split: t.split, firm: t.firm, origin: 'synthetic', truth: planOnlyTruth(t), raster: { pageCount: t.page.pages, ...rasterDims(t.page.widthPt, t.page.heightPt, t.options.raster.dpi) } });
  }
  return { twins, sets };
}

export interface RateResult { label: string; report: string; wrong: number; verified: number; runs: { id: string; run: RasterRun }[]; json: unknown }
export async function evalRate(twins: Map<string, RasterTwin>, sets: EvalSet[], label: string, errors: MockErrors | null): Promise<RateResult> {
  const runs: { id: string; run: RasterRun }[] = [];
  const pipe = rasterPipeline(twins, { provider: (t) => (errors ? new MockVisionProvider(t.world, errors) : null), onRun: (id, run) => runs.push({ id, run }) });
  const rep = await runEval(sets, pipe);
  const wv = wrongVerified(rep);
  return { label, report: formatReport(rep, label), wrong: wv.wrong, verified: wv.n, runs, json: rep };
}
export const costSummary = (runs: { run: RasterRun }[]): { calls: number; usd: number; seconds: number; inTok: number; outTok: number; n: number } => {
  const ok = runs.filter((r) => r.run.status === 'ok');
  const mean = (f: (r: RasterRun) => number): number => ok.reduce((a, r) => a + f(r.run), 0) / (ok.length || 1);
  return { n: ok.length, calls: mean((r) => r.cost.visionCalls), usd: mean((r) => r.cost.usd), seconds: mean((r) => r.cost.seconds), inTok: mean((r) => r.cost.inputTokens), outTok: mean((r) => r.cost.outputTokens) };
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const seeds = val('--seeds') ? val('--seeds')!.split(',').map(Number) : Array.from({ length: Number(val('--sets') ?? 24) }, (_, i) => i + 1);
  const rates = (val('--rates') ?? '0,0.05,0.1,0.2').split(',').map(Number);
  const t0 = Date.now();
  const { twins, sets } = buildTwins(seeds);
  console.log(`${sets.length} raster twins built in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  const all: unknown[] = [];
  if (args.includes('--no-vision')) {
    const r = await evalRate(twins, sets, 'Vision OFF (--no-vision)', null);
    console.log(r.report); console.log('(vision off: every picture refused, nothing sent, cost 0)');
    return;
  }
  for (const rate of rates) {
    const base = errorsAtRate(rate, 11);
    const errors: MockErrors = args.includes('--lie') ? { ...base, uniformScale: 1.25, consistent: true, wrongDigits: Math.max(rate, 0.2) } : args.includes('--consistent') ? { ...base, consistent: true } : base;
    const r = await evalRate(twins, sets, `Simulated model, error rate ${rate}${args.includes('--lie') ? ' + consistent 1.25x lie' : ''}`, errors);
    console.log(r.report);
    const c = costSummary(r.runs);
    const refused = r.runs.filter((x) => x.run.status !== 'ok').length;
    console.log(`Verified-wrong: ${r.wrong} of ${r.verified}. Refused: ${refused}. Per set: ${c.calls.toFixed(1)} calls, ${Math.round(c.inTok)} in / ${Math.round(c.outTok)} out tokens, $${c.usd.toFixed(3)}, ~${c.seconds.toFixed(0)} s on the wire (simulated latency)\n`);
    if (args.includes('--verbose')) for (const x of r.runs) console.log(`  ${x.id}: ${x.run.status} ${x.run.reason ?? ''} ${x.run.understanding.warnings.join(' | ')}`);
    all.push({ rate, report: r.json, cost: c, wrong: r.wrong, verified: r.verified });
  }
  const out = val('--json'); if (out) fs.writeFileSync(out, JSON.stringify(all, null, 1));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();
