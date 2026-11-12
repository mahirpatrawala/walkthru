// Owned by C9. SPEC 14.10: run the media pipeline on files without the dev server.
//   tsx scripts/media-worker.ts <files...> --scene <id> [--tiny] [--backend local|fake|none] [--extra-fragments 60] [--skip-training] [--no-patch]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobManager, kindFromName } from '../src/media/server/jobs';
import { makePaths } from '../src/media/server/pipeline';
import type { MediaInput } from '../src/media/server/pipeline';
import type { JobEvent, JobStatus, MediaOptions } from '../src/media/types';

export interface CliArgs { files: string[]; scene: string; options: Partial<MediaOptions>; verbose: boolean }

export function parseArgs(argv: string[]): CliArgs {
  const files: string[] = [];
  let scene = '';
  const options: Partial<MediaOptions> = { patchProperty: true };
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--scene') scene = next();
    else if (a === '--tiny') options.mode = 'tiny';
    else if (a === '--backend') {
      const v = next();
      if (v !== 'local' && v !== 'fake' && v !== 'none' && v !== 'cloud') throw new Error('--backend must be local, fake or none');
      options.backend = v;
    } else if (a === '--extra-fragments') options.trainExtraFragmentsMin = Number(next());
    else if (a === '--skip-training') options.skipTraining = true;
    else if (a === '--no-patch') options.patchProperty = false;
    else if (a === '--verbose') verbose = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else files.push(a);
  }
  if (!scene) throw new Error('--scene <id> is required');
  if (files.length === 0) throw new Error('give at least one video or photo file');
  return { files, scene, options, verbose };
}

function line(e: JobEvent, verbose: boolean): string | null {
  switch (e.type) {
    case 'state': return `[job] ${e.message}`;
    case 'stage-start': return `[${e.stage}] start${e.message ? ` ${e.message}` : ''}`;
    case 'progress': return `[${e.stage}] ${Math.round((e.fraction ?? 0) * 100)}%${e.message ? ` ${e.message}` : ''}`;
    case 'stage-end': return `[${e.stage}] ${e.stageState}${e.message ? ` ${e.message}` : ''}`;
    case 'warning': return `[warning] ${e.message}`;
    case 'log': return verbose ? `[log] ${e.message}` : null;
  }
}

/** Runs one job and prints its events. Returns the exit code: 0 for done, 1 otherwise. */
export async function main(argv: string[], root: string, out: (s: string) => void = console.log): Promise<number> {
  let args: CliArgs;
  try { args = parseArgs(argv); } catch (e) { out(`media: ${(e as Error).message}`); return 1; }
  const inputs: MediaInput[] = [];
  for (const f of args.files) {
    const abs = path.resolve(f);
    const kind = kindFromName(abs);
    if (!kind) { out(`media: ${f} is not a video or photo file type`); return 1; }
    if (!fs.existsSync(abs)) { out(`media: ${f} does not exist`); return 1; }
    inputs.push({ path: abs, kind, originalName: path.basename(abs) });
  }
  const manager = new JobManager({ paths: makePaths(root) });
  const started = manager.create(args.scene, inputs, args.options);
  let since = 0;
  const stageStart = new Map<string, number>();
  const stageTime = new Map<string, number>();
  let st: JobStatus = started;
  for (;;) {
    st = manager.get(args.scene, started.jobId, since) ?? st;
    for (const e of st.events) {
      since = e.seq;
      const l = line(e, args.verbose);
      if (l) out(l);
      if (e.type === 'stage-start' && e.stage) stageStart.set(e.stage, Date.parse(e.at));
      if (e.type === 'stage-end' && e.stage && stageStart.has(e.stage)) stageTime.set(e.stage, (Date.parse(e.at) - stageStart.get(e.stage)!) / 1000);
    }
    if (st.state === 'done' || st.state === 'failed' || st.state === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  out('--');
  out(`stage seconds: ${[...stageTime.entries()].map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
  if (st.state !== 'done') { out(`media: job ${st.state}${st.error ? `: ${st.error}` : ''}`); return 1; }
  const r = st.result!;
  const c = r.fragments[0]?.coverage;
  if (c) out(`Scan covers ${c.secondsCovered} s of ${c.secondsTotal} s (${c.registeredFrames} of ${c.totalFrames} frames).`);
  out(r.splatReason);
  out(`${r.frames.length} frames for colour sampling, ${r.photos.length} photos, ${r.fragments.length} fragment(s).`);
  const ply = path.join(root, 'public/scenes', args.scene, 'scene.ply');
  if (r.splat && fs.existsSync(ply)) out(`scene.ply ${(fs.statSync(ply).size / 1e6).toFixed(1)} MB, ${r.fragments[0].splatCount ?? '?'} splats`);
  for (const w of r.warnings) out(`warning: ${w}`);
  return 0;
}

const isMain = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await main(process.argv.slice(2), root));
}
