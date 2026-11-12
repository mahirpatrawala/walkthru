// Owned by C9. SPEC 14.6 "Local backend": COLMAP (CPU) for the camera poses, Brush for the splat.
import fs from 'node:fs';
import path from 'node:path';
import { camerasFromImages, parseImagesTxt, plyVertexCount, rankModels } from '../../colmap-model';
import type {
  FragmentInfo, ReconFragment, ReconHooks, ReconInput, ReconResult, ReconstructionBackend, StageState,
} from '../../types';
import { findTool, run } from '../tools';
import type { RunResult } from '../tools';

type BackendStage = 'features' | 'matching' | 'mapping' | 'select' | 'training';

const MIN = 60_000;
/** SPEC 14.6 timeouts, full / tiny */
export const TIMEOUTS = {
  features: [10 * MIN, 2 * MIN], matching: [15 * MIN, 2 * MIN], mapping: [20 * MIN, 3 * MIN],
  select: [MIN, MIN], training: [25 * MIN, 3 * MIN],
} as const;
const timeoutFor = (id: keyof typeof TIMEOUTS, mode: 'full' | 'tiny'): number => TIMEOUTS[id][mode === 'tiny' ? 1 : 0];

export const MIN_FRAGMENT_FRAMES = { full: 30, tiny: 8 } as const;

/** The COLMAP arguments of each command, exactly as SPEC 14.6 lists them. Exported so a test can read them. */
export function colmapArgs(mode: 'full' | 'tiny', ordered: boolean, dirs: { db: string; images: string; sparse: string }) {
  const tiny = mode === 'tiny';
  const features = [
    'feature_extractor', '--database_path', dirs.db, '--image_path', dirs.images,
    '--ImageReader.single_camera', ordered ? '1' : '0', '--ImageReader.camera_model', 'OPENCV',
    '--FeatureExtraction.use_gpu', '0',
    '--SiftExtraction.max_num_features', tiny ? '3000' : '12000',
    '--SiftExtraction.peak_threshold', '0.003',
    '--SiftExtraction.domain_size_pooling', '1',
  ];
  // SiftMatching.cpu_brute_force_matcher is MANDATORY on every matcher call: COLMAP 4.2.1's faiss matcher crashes.
  const matching = ordered
    ? ['sequential_matcher', '--database_path', dirs.db, '--FeatureMatching.use_gpu', '0',
      '--SiftMatching.cpu_brute_force_matcher', '1', '--SequentialMatching.overlap', tiny ? '8' : '25']
    : ['exhaustive_matcher', '--database_path', dirs.db, '--FeatureMatching.use_gpu', '0',
      '--SiftMatching.cpu_brute_force_matcher', '1'];
  const mapping = [
    'mapper', '--database_path', dirs.db, '--image_path', dirs.images, '--output_path', dirs.sparse,
    '--Mapper.init_min_num_inliers', '50', '--Mapper.abs_pose_min_num_inliers', '15',
    '--Mapper.abs_pose_min_inlier_ratio', '0.15', '--Mapper.init_min_tri_angle', '4', '--Mapper.min_model_size', '5',
  ];
  return { features, matching, mapping };
}

export function brushArgs(mode: 'full' | 'tiny', fragDir: string): { args: string[]; totalSteps: number; outDir: string } {
  const tiny = mode === 'tiny';
  const totalSteps = tiny ? 300 : 15000;
  const outDir = path.join(fragDir, 'out');
  return {
    totalSteps, outDir,
    args: [fragDir, '--total-steps', String(totalSteps), '--max-splats', tiny ? '20000' : '800000',
      '--max-resolution', tiny ? '320' : '720', '--export-every', tiny ? '300' : '5000',
      '--export-path', outDir, '--export-name', 'splat_{iter}.ply'],
  };
}

/** Highest-iteration `splat_<iter>.ply` in a folder. */
export function latestExport(dir: string): { iter: number; file: string } | null {
  let best: { iter: number; file: string } | null = null;
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const n of names) {
    const m = /^splat_(\d+)\.ply$/.exec(n);
    if (m && (!best || Number(m[1]) > best.iter)) best = { iter: Number(m[1]), file: path.join(dir, n) };
  }
  return best;
}

function readPlyCount(file: string): number | null {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      return plyVertexCount(new Uint8Array(buf.buffer, buf.byteOffset, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export class LocalColmapBrushBackend implements ReconstructionBackend {
  readonly name = 'local-colmap-brush';

  async available(): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];
    if (!findTool('colmap')) missing.push('colmap');
    return { ok: missing.length === 0, missing };
  }

  async reconstruct(input: ReconInput, hooks: ReconHooks): Promise<ReconResult> {
    const colmap = findTool('colmap');
    const none = (warnings: string[]): ReconResult => ({ fragments: [], upPreset: 'flip-x', warnings });
    if (!colmap) return none(['COLMAP is not installed.']);
    const work = input.workDir;
    const db = path.join(work, 'db.db');
    const sparse = path.join(work, 'sparse');
    fs.rmSync(db, { force: true });
    fs.rmSync(sparse, { recursive: true, force: true });
    fs.rmSync(path.join(work, 'txt'), { recursive: true, force: true });
    fs.mkdirSync(sparse, { recursive: true });
    const n = input.frames.length;
    const args = colmapArgs(input.mode, input.ordered, { db, images: input.imagesDir, sparse });
    const skipRest = (from: BackendStage[], message: string): void => { for (const id of from) hooks.stage(id, 'skipped', message); };

    const aborted = (): never => { throw new Error('aborted'); };

    // ---- the three COLMAP commands
    const steps: { id: 'features' | 'matching' | 'mapping'; args: string[]; parse: (l: string) => number | null }[] = [
      { id: 'features', args: args.features, parse: bracketFraction },
      { id: 'matching', args: args.matching, parse: bracketFraction },
      { id: 'mapping', args: args.mapping, parse: (l) => {
        const m = /Registering image #\d+ \((\d+)\)/.exec(l);
        return m && n > 0 ? Math.min(1, Number(m[1]) / n) : null;
      } },
    ];
    const order: BackendStage[] = ['features', 'matching', 'mapping', 'select', 'training'];
    for (let si = 0; si < steps.length; si++) {
      const s = steps[si];
      if (input.signal.aborted) aborted();
      hooks.stage(s.id, 'running');
      let lastFrac = -1;
      const r: RunResult = await run(colmap, s.args, {
        timeoutMs: timeoutFor(s.id, input.mode), signal: input.signal, cwd: work,
        onLine: (line) => {
          hooks.log(line);
          try {
            const f = s.parse(line);
            if (f !== null && f > lastFrac) { lastFrac = f; hooks.progress(s.id, f); }
          } catch { /* progress is best effort */ }
        },
      });
      if (r.aborted) aborted();
      if (r.timedOut || r.code !== 0) {
        const state: StageState = r.timedOut ? 'timeout' : 'failed';
        const msg = r.timedOut ? `COLMAP ${s.id} ran out of time.` : `COLMAP ${s.id} stopped with an error (${r.spawnError ?? `exit ${r.code}`}).`;
        hooks.stage(s.id, state, msg);
        skipRest(order.slice(si + 1), msg);
        return none([msg]);
      }
      hooks.stage(s.id, 'done');
    }

    // ---- select
    if (input.signal.aborted) aborted();
    hooks.stage('select', 'running');
    const timeOf = new Map(input.frames.map((f) => [f.file, f.timeSec]));
    const models = fs.readdirSync(sparse).filter((d) => /^\d+$/.test(d) && fs.statSync(path.join(sparse, d)).isDirectory());
    interface Model { dir: string; images: ReturnType<typeof parseImagesTxt>; registered: number }
    const parsed: Model[] = [];
    for (const m of models.sort((a, b) => Number(a) - Number(b))) {
      const txt = path.join(work, 'txt', m);
      fs.mkdirSync(txt, { recursive: true });
      const r = await run(colmap, ['model_converter', '--input_path', path.join(sparse, m), '--output_path', txt, '--output_type', 'TXT'],
        { timeoutMs: timeoutFor('select', input.mode), signal: input.signal, cwd: work });
      if (r.aborted) aborted();
      const imgFile = path.join(txt, 'images.txt');
      if (r.code !== 0 || !fs.existsSync(imgFile)) { hooks.log(`model_converter failed for model ${m}`); continue; }
      const images = parseImagesTxt(fs.readFileSync(imgFile, 'utf8'));
      parsed.push({ dir: m, images, registered: images.length });
    }
    const ranked = rankModels(parsed);
    const minFrames = MIN_FRAGMENT_FRAMES[input.mode];
    if (ranked.length === 0) {
      hooks.stage('select', 'done', 'No camera path was found.');
      skipRest(['training'], 'No camera path was found.');
      return none(['COLMAP could not line up any frames.']);
    }
    if (ranked[0].registered < minFrames) {
      const msg = `Only ${ranked[0].registered} frames lined up. Not enough for a scan.`;
      hooks.stage('select', 'done', msg);
      skipRest(['training'], msg);
      return none([msg]);
    }
    const fragments: ReconFragment[] = ranked.map((m) => {
      const registered = m.images
        .map((im) => ({ file: im.name, timeSec: timeOf.get(im.name) ?? NaN }))
        .filter((f) => Number.isFinite(f.timeSec))
        .sort((a, b) => a.timeSec - b.timeSec);
      return {
        registered,
        cameras: camerasFromImages(m.images, (name) => timeOf.get(name) ?? null),
        plyPath: null, splatCount: null, trainState: 'skipped' as FragmentInfo['trainState'],
      };
    });
    hooks.stage('select', 'done', `${ranked.length} piece${ranked.length === 1 ? '' : 's'}, the largest has ${ranked[0].registered} frames.`);

    // ---- training
    const warnings: string[] = [];
    const brush = findTool('brush');
    const chosen = ranked.map((m, i) => ({ m, i })).filter(({ m, i }) =>
      i === 0 || (input.trainExtraFragmentsMin > 0 && m.registered >= input.trainExtraFragmentsMin));
    if (input.skipTraining) {
      hooks.stage('training', 'skipped', 'Training was switched off.');
    } else if (!brush) {
      hooks.stage('training', 'skipped', 'Scan tools not installed: brush');
    } else {
      hooks.stage('training', 'running');
      for (let ci = 0; ci < chosen.length; ci++) {
        if (input.signal.aborted) aborted();
        const { m, i } = chosen[ci];
        const fragDir = path.join(work, `frag-${i}`);
        fs.rmSync(fragDir, { recursive: true, force: true });
        fs.mkdirSync(path.join(fragDir, 'sparse', '0'), { recursive: true });
        fs.symlinkSync(input.imagesDir, path.join(fragDir, 'images'), 'dir');
        for (const f of fs.readdirSync(path.join(sparse, m.dir))) {
          fs.copyFileSync(path.join(sparse, m.dir, f), path.join(fragDir, 'sparse', '0', f));
        }
        const b = brushArgs(input.mode, fragDir);
        const poll = setInterval(() => {
          const e = latestExport(b.outDir);
          if (e) hooks.progress('training', (ci + Math.min(1, e.iter / b.totalSteps)) / chosen.length, `step ${e.iter} of ${b.totalSteps}`);
        }, 5000);
        let r: RunResult;
        try {
          r = await run(brush, b.args, {
            timeoutMs: timeoutFor('training', input.mode), signal: input.signal, cwd: fragDir,
            onLine: (line) => hooks.log(line),
          });
        } finally {
          clearInterval(poll);
        }
        if (r.aborted) aborted();
        const e = latestExport(b.outDir);
        const frag = fragments[i];
        const finished = !!e && e.iter >= b.totalSteps;
        if (e && (r.code === 0 || r.timedOut || finished)) {
          frag.plyPath = e.file;
          frag.splatCount = readPlyCount(e.file);
          frag.trainState = r.timedOut && !finished ? 'timeout' : 'trained';
        } else {
          frag.trainState = r.timedOut ? 'timeout' : 'failed';
        }
        if (frag.trainState !== 'trained') {
          warnings.push(`Training piece ${i + 1} ${r.timedOut ? 'ran out of time' : `failed (${r.spawnError ?? `exit ${r.code}`})`}.`);
        }
        hooks.progress('training', (ci + 1) / chosen.length);
      }
      const t0 = fragments[0].trainState;
      hooks.stage('training', t0 === 'timeout' ? 'timeout' : t0 === 'failed' ? 'failed' : 'done',
        t0 === 'timeout' ? 'Scan training ran out of time.' : t0 === 'failed' ? 'Scan training failed.' : undefined);
    }
    return { fragments, upPreset: 'flip-x', warnings };
  }
}

function bracketFraction(line: string): number | null {
  const m = /\[(\d+)\s*\/\s*(\d+)\]/.exec(line);
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? Math.min(1, Number(m[1]) / total) : null;
}
