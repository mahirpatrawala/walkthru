// C12d: read a picture of a plan (PNG or JPEG: a brochure image, a phone photo, a page rendered from a scanned PDF).
//   tsx scripts/understand-raster.ts <image> [--no-vision] [--live --yes] [--claude] [--env-key]
//                                    [--replay rec.json] [--record rec.json] [--scene <id> --write] [--out <dir>]
// --no-vision   nothing is sent anywhere; the picture is refused (a picture cannot be read without a model) and the cost is zero.
// --live        use the real model. Prints the broker notice, the number of calls and the estimated cost, and needs --yes.
// --replay      play back a recording (no network, no key).  --record  save every answer of a live run for later replay.
// Outputs go to .cache/understand/<scene or 'picture'>/ (understanding.json, sent.json with what was sent, proposal.json,
// proposal-extras.json, designs.json). With --scene <id> --write the three scene files are also written to public/scenes/<id>/.
// This is the raster half of SPEC 17.3's `scripts/understand.ts`; the integrator folds the two together.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodeImage } from '../src/understand/pixels/image';
import type { Gray } from '../src/understand/pixels/image';
import { readRasterPages } from '../src/understand/raster';
import { visionNotice } from '../src/understand/notice';
import { estimateRaster } from '../src/understand/vision/estimate';
import { resolveAnthropicKey, resolveGeminiKey, GEMINI_KEY_FILE } from '../src/understand/vision/keys';
import { GeminiProvider } from '../src/understand/vision/gemini';
import { ClaudeProvider } from '../src/understand/vision/claude';
import { RecordingProvider, ReplayProvider } from '../src/understand/vision/recorded';
import type { Recording } from '../src/understand/vision/recorded';
import type { VisionProvider } from '../src/understand/vision/provider';

/** PNG and baseline JPEG are read here; anything else (WebP, HEIC, progressive JPEG) is converted with macOS `sips`. */
function load(file: string): Gray {
  const bytes = new Uint8Array(fs.readFileSync(file));
  try { return decodeImage(bytes); } catch (first) {
    const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'walkthru-img-')), 'in.png');
    try { execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' }); return decodeImage(new Uint8Array(fs.readFileSync(tmp))); }
    catch { throw new Error(`Could not read ${path.basename(file)}: ${(first as Error).message}`); }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a) => !a.startsWith('--') && a !== val('--scene') && a !== val('--out') && a !== val('--replay') && a !== val('--record'));
  if (!file) { console.error('usage: tsx scripts/understand-raster.ts <image> [--no-vision] [--live --yes] [--replay rec.json] [--scene id --write]'); process.exit(2); }
  const image = load(file);
  const noVision = args.includes('--no-vision');
  let provider: VisionProvider | null = null; let rec: RecordingProvider | null = null;
  if (!noVision) {
    if (val('--replay')) provider = new ReplayProvider(JSON.parse(fs.readFileSync(val('--replay')!, 'utf8')) as Recording);
    else if (args.includes('--live')) {
      const key = args.includes('--claude') ? resolveAnthropicKey({ env: args.includes('--env-key') ? process.env : {} }) : resolveGeminiKey({ allowEnv: args.includes('--env-key') });
      if (!key) { console.error(`No key at ${GEMINI_KEY_FILE()}. Nothing was sent.`); process.exit(1); }
      console.log(visionNotice(true)); console.log(`Key from ${key.from}.`);
      const e = estimateRaster({ pages: 1 });
      for (const l of e.lines) console.log(`  ${l}`);
      console.log(`Estimated: ${e.calls} calls, about $${e.usd.toFixed(3)}, about ${Math.round(e.seconds)} s.`);
      if (!args.includes('--yes')) { console.log('Not run. Add --yes to spend this.'); return; }
      provider = args.includes('--claude') ? new ClaudeProvider({ key: key.key }) : new GeminiProvider({ key: key.key });
      if (val('--record')) { rec = new RecordingProvider(provider) as RecordingProvider; provider = rec; }
    } else { console.error('Vision is on by default but needs a model: use --live (a key, and it costs money), --replay <recording>, or --no-vision.'); process.exit(2); }
  }
  console.log(visionNotice(!!provider));
  const run = await readRasterPages([{ id: 'p1', image }], { provider });
  console.log(`${run.status}${run.reason ? `: ${run.reason}` : ''}`);
  for (const w of run.understanding.warnings) console.log(`  - ${w}`);
  console.log(`Stages: ${run.stages.map((s) => `${s.stage} ${(s.ms / 1000).toFixed(2)} s`).join(', ')}`);
  console.log(`Cost: ${run.cost.visionCalls} calls, ${run.cost.inputTokens} in / ${run.cost.outputTokens} out tokens, $${run.cost.usd.toFixed(4)}, ${run.cost.seconds.toFixed(1)} s on the wire, ${run.cost.wallSeconds.toFixed(1)} s wall.`);
  console.log(`Sent: ${run.sent.length} picture${run.sent.length === 1 ? '' : 's'}${run.sent.length ? ` (${run.sent.map((s) => `${s.kind} ${s.w}x${s.h}`).join(', ')})` : ''}.`);
  const out = val('--out') ?? path.join('.cache', 'understand', val('--scene') ?? 'picture');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'understanding.json'), JSON.stringify(run.understanding, null, 1));
  fs.writeFileSync(path.join(out, 'sent.json'), JSON.stringify({ notice: run.notice, sent: run.sent, cost: run.cost }, null, 1));
  if (run.result) {
    fs.writeFileSync(path.join(out, 'proposal.json'), JSON.stringify(run.result.proposal, null, 1));
    fs.writeFileSync(path.join(out, 'proposal-extras.json'), JSON.stringify(run.result.extras, null, 1));
    fs.writeFileSync(path.join(out, 'designs.json'), JSON.stringify(run.designs, null, 1));
    if (args.includes('--write') && val('--scene')) {
      const dir = path.join('public', 'scenes', val('--scene')!);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of ['proposal.json', 'proposal-extras.json', 'designs.json']) fs.copyFileSync(path.join(out, f), path.join(dir, f));
      console.log(`Wrote the three scene files to ${dir}.`);
    }
  }
  if (rec && val('--record')) { fs.writeFileSync(val('--record')!, JSON.stringify(rec.recording)); console.log(`Recording saved to ${val('--record')}.`); }
  console.log(`Files in ${out}`);
  if (run.status !== 'ok') process.exitCode = 1;
}
void main();
