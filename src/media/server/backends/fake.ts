// Owned by C9. SPEC 14.3: canned result for tests. Writes a tiny valid binary PLY.
import fs from 'node:fs';
import path from 'node:path';
import type { FrameCamera, ReconFragment, ReconHooks, ReconInput, ReconResult, ReconstructionBackend } from '../../types';

export interface FakeOptions {
  /** wait this long (abortable) inside reconstruct, ticking progress */
  delayMs?: number;
  /** fragments to return: sizes as a fraction of the frames, e.g. [0.6, 0.2]. Default [0.6]. [] = nothing lined up. */
  fragments?: number[];
  /** write a PLY for each fragment (default true) */
  writePly?: boolean;
  missing?: string[];
  /** never resolves (until aborted, which is ignored) */
  hang?: boolean;
}

/** A small binary PLY with `count` splats: the property list Brush writes, minus the spherical harmonics. */
export function tinyPly(count: number): Buffer {
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = Buffer.from('ply\nformat binary_little_endian 1.0\n' + `element vertex ${count}\n` +
    props.map((p) => `property float ${p}\n`).join('') + 'end_header\n', 'latin1');
  const body = Buffer.alloc(count * props.length * 4);
  for (let i = 0; i < count; i++) {
    const o = i * props.length * 4;
    body.writeFloatLE(Math.sin(i), o); body.writeFloatLE(Math.cos(i * 1.3), o + 4); body.writeFloatLE((i % 50) / 25, o + 8);
    for (let k = 3; k < 6; k++) body.writeFloatLE(0.5, o + k * 4);
    body.writeFloatLE(2, o + 6 * 4);
    for (let k = 7; k < 10; k++) body.writeFloatLE(-4, o + k * 4);
    body.writeFloatLE(1, o + 10 * 4);
  }
  return Buffer.concat([head, body]);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(t); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class FakeBackend implements ReconstructionBackend {
  readonly name = 'fake';
  constructor(private readonly opts: FakeOptions = {}) {}

  async available(): Promise<{ ok: boolean; missing: string[] }> {
    const missing = this.opts.missing ?? [];
    return { ok: missing.length === 0, missing };
  }

  async reconstruct(input: ReconInput, hooks: ReconHooks): Promise<ReconResult> {
    if (this.opts.hang) await new Promise<void>(() => { /* never */ });
    const delay = this.opts.delayMs ?? 0;
    const stages = ['features', 'matching', 'mapping'] as const;
    for (const id of stages) {
      hooks.stage(id, 'running');
      const steps = delay > 0 ? 4 : 1;
      for (let i = 1; i <= steps; i++) {
        if (delay > 0) await sleep(delay / (stages.length * steps), input.signal);
        hooks.progress(id, i / steps);
      }
      hooks.stage(id, 'done');
    }
    hooks.stage('select', 'running');
    const sizes = this.opts.fragments ?? [0.6];
    const fragments: ReconFragment[] = sizes.map((frac, fi) => {
      const n = Math.max(1, Math.round(input.frames.length * frac));
      const registered = input.frames.slice(0, n);
      const cameras: FrameCamera[] = registered.map((f, i) => ({
        frame: f.file, timeSec: f.timeSec, centre: { x: i * 0.05, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 },
      }));
      return { registered, cameras, plyPath: null, splatCount: null, trainState: 'skipped' as const };
    });
    hooks.stage('select', 'done');
    if (fragments.length === 0) {
      hooks.stage('training', 'skipped', 'Nothing lined up.');
      return { fragments, upPreset: 'flip-x', warnings: [] };
    }
    hooks.stage('training', 'running');
    for (let i = 0; i < fragments.length; i++) {
      if (input.skipTraining || (i > 0 && (input.trainExtraFragmentsMin <= 0 || fragments[i].registered.length < input.trainExtraFragmentsMin))) continue;
      if (delay > 0) await sleep(delay / 4, input.signal);
      if (this.opts.writePly !== false) {
        const out = path.join(input.workDir, `fake-${i}.ply`);
        fs.mkdirSync(input.workDir, { recursive: true });
        fs.writeFileSync(out, tinyPly(2000));
        fragments[i].plyPath = out;
        fragments[i].splatCount = 2000;
        fragments[i].trainState = 'trained';
      }
      hooks.progress('training', (i + 1) / fragments.length);
    }
    hooks.stage('training', input.skipTraining ? 'skipped' : 'done');
    return { fragments, upPreset: 'flip-x', warnings: [] };
  }
}
