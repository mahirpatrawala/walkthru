// C9 acceptance 18: tiny mode on the synthetic room video, with the real tools. Runs only when COLMAP is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRoomVideo } from '../scripts/make-test-video';
import { plyVertexCount } from '../src/media/colmap-model';
import { JobManager } from '../src/media/server/jobs';
import { makePaths } from '../src/media/server/pipeline';
import { findTool } from '../src/media/server/tools';

const hasColmap = !!findTool('colmap') && !!findTool('ffmpeg');
const hasBrush = !!findTool('brush');

describe.skipIf(!hasColmap)('C9 tiny mode with COLMAP' + (hasBrush ? ' and Brush' : ''), () => {
  let tmp = '';
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-tools-test-')); });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('18. the synthetic room video runs to done; reports how much registered', async () => {
    const video = path.join(tmp, 'room.mp4');
    await buildRoomVideo(video);
    const root = path.join(tmp, 'root');
    fs.mkdirSync(root);
    const m = new JobManager({ paths: makePaths(root) });
    const t0 = Date.now();
    const j = m.create('tiny-room', [{ path: video, kind: 'video', originalName: 'room.mp4' }], { backend: 'local', mode: 'tiny' });
    await m.idle();
    const st = m.get('tiny-room', j.jobId)!;
    const r = st.result;
    const frag = r?.fragments[0];
    console.log(`tiny room: state ${st.state}, ${((Date.now() - t0) / 1000).toFixed(1)} s, fragments ${r?.fragments.length}, ` +
      `registered ${frag?.registeredFrames}/${frag?.coverage.totalFrames}, train ${frag?.trainState}, splats ${frag?.splatCount}, ` +
      `reason "${r?.splatReason}", stages ${st.stages.map((s) => `${s.id}:${s.state}`).join(' ')}, warnings ${JSON.stringify(r?.warnings)}`);
    expect(st.state).toBe('done');
    expect(st.stages.length).toBe(9);
    if (frag) {
      expect(frag.registeredFrames).toBeGreaterThanOrEqual(12);
      if (hasBrush && frag.ply) {
        const ply = path.join(root, 'public/scenes/tiny-room/scene.ply');
        expect(fs.existsSync(ply)).toBe(true);
        expect(plyVertexCount(new Uint8Array(fs.readFileSync(ply).subarray(0, 4096)))).toBeGreaterThanOrEqual(1000);
        expect(r!.splat?.upPreset).toBe('flip-x');
      }
    }
  }, 8 * 60_000);
});
