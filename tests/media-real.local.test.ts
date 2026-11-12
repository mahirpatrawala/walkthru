// C9 acceptance 19 and 20: the real WhatsApp video. Local only: needs the video and COLMAP.
// WALKTHRU_REAL_VIDEO overrides the path; WALKTHRU_TRAIN=1 adds the Brush run (about 11 minutes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { JobManager } from '../src/media/server/jobs';
import { makePaths } from '../src/media/server/pipeline';
import { findTool } from '../src/media/server/tools';

const REAL = process.env.WALKTHRU_REAL_VIDEO ?? '/Users/mahir/Downloads/WhatsApp Video 2026-11-12 at 19.00.04.mp4';
const enabled = fs.existsSync(REAL) && !!findTool('colmap') && !!findTool('ffmpeg');
const train = process.env.WALKTHRU_TRAIN === '1' && !!findTool('brush');

describe.skipIf(!enabled)('C9 real video', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-real-test-'));
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('19. full mode, no training: 355 frames, at least 100 registered, at least 9 s covered', async () => {
    const m = new JobManager({ paths: makePaths(tmp) });
    const t0 = Date.now();
    const j = m.create('real-video', [{ path: REAL, kind: 'video', originalName: path.basename(REAL) }], { backend: 'local', mode: 'full', skipTraining: true });
    await m.idle();
    const st = m.get('real-video', j.jobId)!;
    const r = st.result!;
    const f0 = r.fragments[0];
    const stageSecs = st.stages.map((s) => `${s.id} ${s.startedAt && s.endedAt ? ((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000).toFixed(0) : '-'}s`).join(', ');
    console.log(`real video: ${st.state}, ${((Date.now() - t0) / 1000).toFixed(0)} s total; ${f0?.coverage.totalFrames} frames, registered ${f0?.registeredFrames}, ` +
      `${r.fragments.length} fragments (${r.fragments.map((f) => f.registeredFrames).join(', ')}), covered ${f0?.coverage.secondsCovered} s of ${f0?.coverage.secondsTotal} s, ` +
      `${r.frames.length} editor frames; stages: ${stageSecs}; reason "${r.splatReason}"`);
    expect(st.state).toBe('done');
    expect(Math.abs(f0.coverage.totalFrames - 355)).toBeLessThanOrEqual(2);
    expect(f0.registeredFrames).toBeGreaterThanOrEqual(100);
    expect(f0.coverage.secondsCovered).toBeGreaterThanOrEqual(9);
    expect(r.frames.length).toBeGreaterThanOrEqual(15);
    expect(r.frames.length).toBeLessThanOrEqual(36);
  }, 25 * 60_000);

  it.skipIf(!train)('20. with training: scene.ply 10 to 80 MB, flip-x, reason starts "Scan made from"', async () => {
    const m = new JobManager({ paths: makePaths(tmp) });
    const j = m.create('real-video-train', [{ path: REAL, kind: 'video', originalName: path.basename(REAL) }], { backend: 'local', mode: 'full' });
    await m.idle();
    const st = m.get('real-video-train', j.jobId)!;
    expect(st.state).toBe('done');
    const ply = path.join(tmp, 'public/scenes/real-video-train/scene.ply');
    expect(fs.existsSync(ply)).toBe(true);
    const mb = fs.statSync(ply).size / 1e6;
    expect(mb).toBeGreaterThanOrEqual(10);
    expect(mb).toBeLessThanOrEqual(80);
    expect(st.result!.splat?.upPreset).toBe('flip-x');
    expect(st.result!.splatReason.startsWith('Scan made from')).toBe(true);
  }, 25 * 60_000);
});
