// C12a: score a pipeline on synthetic sets and on real sets from a folder outside the repo (SPEC 17.11).
//   tsx scripts/eval-understand.ts [--synthetic 24] [--dir ~/walkthru-tools/drawings] [--json out.json] [--pipeline c8|c12b|oracle]
// Real sets: <dir>/<set>/{drawing.pdf | drawing.png | drawing.jpg}, truth.json (partial is fine), meta.json {split, firm}.
// Synthetic sets are generated in memory from seeds 1..N; 24 are the fixed sets of `npm test`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSet, rasterDims } from './eval/synthetic';
import type { EvalSet } from './eval/run';
import { formatReport, loadFolder, runEval, wrongVerified } from './eval/run';
import { c12bPipeline, c12cPipeline, c8Pipeline, oraclePipeline } from './eval/adapters';
import type { TruthLite } from './eval/types';

export async function syntheticSets(n: number): Promise<{ sets: EvalSet[]; truths: Map<string, TruthLite> }> {
  const sets: EvalSet[] = []; const truths = new Map<string, TruthLite>();
  for (let seed = 1; seed <= n; seed++) {
    const e = buildSet(seed);
    sets.push(e.set); truths.set(e.set.id, e.set.truth);
  }
  void rasterDims;
  return { sets, truths };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const n = Number(val('--synthetic') ?? 24);
  const dir = val('--dir') ?? path.join(os.homedir(), 'walkthru-tools', 'drawings');
  const which = val('--pipeline') ?? 'c8';
  const syn = await syntheticSets(n);
  const real = await loadFolder(dir);
  const sets = [...syn.sets, ...real.filter((r) => r.origin === 'real')];
  const truthOf = (id: string): TruthLite => syn.truths.get(id) ?? real.find((r) => r.id === id)!.truth;
  const pipeline = which === 'oracle' ? oraclePipeline(truthOf) : which === 'c12c' ? c12cPipeline : which === 'c12b' ? c12bPipeline : c8Pipeline;
  const rep = await runEval(sets, pipeline);
  console.log(formatReport(rep, `Pipeline: ${which}. ${syn.sets.length} synthetic sets, ${real.filter((r) => r.origin === 'real').length} real sets from ${fs.existsSync(dir) ? dir : `${dir} (absent)`}`));
  const wv = wrongVerified(rep);
  console.log(`\nHonesty bar: ${wv.wrong} wrong of ${wv.n} verified values${wv.rate === null ? ' (no value was marked verified, so the bar is met vacuously)' : ` = ${(wv.rate * 100).toFixed(2)}% (bar <= 0.5%)`}`);
  const out = val('--json');
  if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1));
  if (wv.rate !== null && wv.rate > 0.005) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();
