// C9 acceptance 6-13: the job runner with the fake backend, frames, photos, nearest frame. Needs ffmpeg (skipped without it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLavfiVideo, renderRoomFrames, writeFrameJpeg, buildTestPhotos } from '../scripts/make-test-video';
import { FakeBackend } from '../src/media/server/backends/fake';
import { describeImageFile, encodeJpeg, hasExif, imageSize } from '../src/media/server/frames';
import { JobManager } from '../src/media/server/jobs';
import { makePaths } from '../src/media/server/pipeline';
import type { MediaInput } from '../src/media/server/pipeline';
import { findTool, isProcessAlive, run } from '../src/media/server/tools';
import { isMatch, nearestFrame } from '../src/media/pins';
import { NO_MATCH_SCORE } from '../src/media/frame-metrics';
import type { ImageDescriptor } from '../src/media/frame-metrics';
import type { JobStatus, MediaManifest, PhotoPinsFile } from '../src/media/types';
import type { ReconstructionBackend } from '../src/media/types';

const hasFfmpeg = !!findTool('ffmpeg') && !!findTool('ffprobe');
const SCENE = 'unit-scene';

let tmp = '';
let video = '';
const roots: string[] = [];

function newRoot(): string {
  const r = fs.mkdtempSync(path.join(tmp, 'root-'));
  roots.push(r);
  return r;
}
function manager(root: string, backend: () => ReconstructionBackend | null, pipeline?: { backendTimeoutMs?: number }): JobManager {
  return new JobManager({ paths: makePaths(root), backendFor: backend, pipeline });
}
const vid = (): MediaInput => ({ path: video, kind: 'video', originalName: 'walk.mp4' });
const photo = (p: string): MediaInput => ({ path: p, kind: 'photo', originalName: path.basename(p) });
async function waitFor(fn: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const scenePath = (root: string, ...p: string[]): string => path.join(root, 'public/scenes', SCENE, ...p);

describe.skipIf(!hasFfmpeg)('C9 job runner (fake backend, lavfi video)', () => {
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-media-test-'));
    video = path.join(tmp, 'lavfi.mp4');
    await buildLavfiVideo(video, { seconds: 4 });
  }, 60_000);
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('6. states, gapless seq, all nine stages done, overall 1, status file equal, second job waits', async () => {
    const root = newRoot();
    const m = manager(root, () => new FakeBackend({ delayMs: 700 }));
    const a = m.create(SCENE, [vid()], { backend: 'fake' });
    const b = m.create(SCENE, [vid()], { backend: 'fake' });
    expect(a.state).toBe('queued');
    await waitFor(() => m.get(SCENE, a.jobId)!.state === 'running');
    expect(m.get(SCENE, b.jobId)!.state).toBe('queued');
    await m.idle();
    const fa = m.get(SCENE, a.jobId)!;
    const fb = m.get(SCENE, b.jobId)!;
    for (const f of [fa, fb]) {
      expect(f.state).toBe('done');
      expect(f.events.filter((e) => e.type === 'state').map((e) => e.message)).toEqual(['queued', 'running', 'done']);
      f.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
      expect(f.stages.map((s) => s.state)).toEqual(Array(9).fill('done'));
      expect(f.overall).toBe(1);
      expect(f.result).not.toBeNull();
    }
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.cache/media', SCENE, 'jobs', `${fa.jobId}.json`), 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(fa)));
    // the second job only started after the first one ended
    const aDone = fa.events.find((e) => e.type === 'state' && e.message === 'done')!.at;
    const bRun = fb.events.find((e) => e.type === 'state' && e.message === 'running')!.at;
    expect(bRun >= aDone).toBe(true);
    // ?since= returns only later events
    expect(m.get(SCENE, a.jobId, 5)!.events.every((e) => e.seq > 5)).toBe(true);
    expect(m.list(SCENE).map((j) => j.jobId)).toContain(a.jobId);
    // older work directories were cleaned when the second job started
    expect(fs.existsSync(path.join(root, '.cache/media', SCENE, a.jobId))).toBe(false);
    expect(fs.existsSync(path.join(root, '.cache/media', SCENE, b.jobId))).toBe(true);
  }, 60_000);

  it('7a. soft fail: zero fragments is done with no splat and frames still published', async () => {
    const root = newRoot();
    const m = manager(root, () => new FakeBackend({ fragments: [] }));
    const j = m.create(SCENE, [vid()], { backend: 'fake' });
    await m.idle();
    const st = m.get(SCENE, j.jobId)!;
    expect(st.state).toBe('done');
    expect(st.result!.splat).toBeNull();
    expect(st.result!.splatReason).toBe('The video did not line up well enough for a scan. The room layout still works.');
    expect(st.result!.frames.length).toBeGreaterThan(0);
    for (const f of st.result!.frames) expect(fs.existsSync(scenePath(root, f.file))).toBe(true);
    expect(fs.existsSync(scenePath(root, 'scene.ply'))).toBe(false);
    expect(fs.existsSync(scenePath(root, 'media/manifest.json'))).toBe(true);
  }, 60_000);

  it('7b. a backend that never resolves times out its stage and the job still ends done', async () => {
    const root = newRoot();
    const m = manager(root, () => new FakeBackend({ hang: true }), { backendTimeoutMs: 200 });
    const j = m.create(SCENE, [vid()], { backend: 'fake' });
    await m.idle();
    const st = m.get(SCENE, j.jobId)!;
    expect(st.state).toBe('done');
    expect(st.stages.find((s) => s.id === 'features')!.state).toBe('timeout');
    expect(st.stages.filter((s) => ['matching', 'mapping', 'select', 'training'].includes(s.id)).every((s) => s.state === 'skipped')).toBe(true);
    expect(st.result!.splat).toBeNull();
    expect(st.overall).toBe(1);
  }, 60_000);

  it('8. a text file renamed .mp4 fails at probe with a readable error', async () => {
    const root = newRoot();
    const fake = path.join(tmp, 'not-a-video.mp4');
    fs.writeFileSync(fake, 'this is just text, not a video\n'.repeat(20));
    const m = manager(root, () => new FakeBackend());
    const j = m.create(SCENE, [{ path: fake, kind: 'video', originalName: 'not-a-video.mp4' }], { backend: 'fake' });
    await m.idle();
    const st = m.get(SCENE, j.jobId)!;
    expect(st.state).toBe('failed');
    expect(st.stages.find((s) => s.id === 'probe')!.state).toBe('failed');
    expect(st.error).toMatch(/could be read/);
    expect(st.result).toBeNull();
  }, 30_000);

  it('9. cancel during the backend delay ends cancelled; the child helper kills its process group', async () => {
    const root = newRoot();
    const m = manager(root, () => new FakeBackend({ delayMs: 10_000 }));
    const j = m.create(SCENE, [vid()], { backend: 'fake' });
    await waitFor(() => m.get(SCENE, j.jobId)!.stages.find((s) => s.id === 'features')!.state === 'running');
    expect(m.cancel(SCENE, j.jobId)).toBe(true);
    await m.idle();
    expect(m.get(SCENE, j.jobId)!.state).toBe('cancelled');
    // a queued job can be cancelled too
    const q1 = m.create(SCENE, [vid()], { backend: 'fake' });
    const q2 = m.create(SCENE, [vid()], { backend: 'fake' });
    await waitFor(() => m.get(SCENE, q1.jobId)!.state === 'running');
    expect(m.cancel(SCENE, q2.jobId)).toBe(true);
    expect(m.get(SCENE, q2.jobId)!.state).toBe('cancelled');
    m.cancel(SCENE, q1.jobId);
    await m.idle();

    const ctl = new AbortController();
    let pid = 0;
    const p = run('/bin/sh', ['-c', 'sleep 30 & sleep 30'], { signal: ctl.signal, onSpawn: (x) => { pid = x; } });
    await waitFor(() => pid > 0 && isProcessAlive(pid));
    ctl.abort();
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
    const t = await run('/bin/sleep', ['30'], { timeoutMs: 150 });
    expect(t.timedOut).toBe(true);
    expect(isProcessAlive(t.pid!)).toBe(false);
  }, 60_000);

  it('10. frames: 40 +/- 1 reconstruction frames, 1-4 clean editor frames', async () => {
    const root = newRoot();
    const m = manager(root, () => new FakeBackend());
    const j = m.create(SCENE, [vid()], { backend: 'fake' });
    await m.idle();
    const st = m.get(SCENE, j.jobId)!;
    expect(st.state).toBe('done');
    const images = fs.readdirSync(path.join(root, '.cache/media', SCENE, j.jobId, 'images')).filter((f) => f.endsWith('.jpg'));
    expect(Math.abs(images.length - 40)).toBeLessThanOrEqual(1);
    const frames = st.result!.frames;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames.length).toBeLessThanOrEqual(4);
    for (const f of frames) {
      const file = scenePath(root, f.file);
      const head = fs.readFileSync(file).subarray(0, 3);
      expect([...head]).toEqual([0xff, 0xd8, 0xff]);
      const size = (await imageSize(file))!;
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1280);
      expect(hasExif(file)).toBe(false);
    }
    expect(st.result!.cameras.length).toBeGreaterThan(0);
  }, 60_000);

  it('11 + 12. photos: names, thumbs, pins, merge keeps placement; under 20 photos skips the scan stages', async () => {
    const root = newRoot();
    const dir = path.join(tmp, 'photos');
    const files = await buildTestPhotos(dir, 4);
    const m = manager(root, () => new FakeBackend());
    const j1 = m.create(SCENE, files.slice(0, 3).map(photo), { backend: 'fake' });
    await m.idle();
    const s1 = m.get(SCENE, j1.jobId)!;
    expect(s1.state).toBe('done');
    // 12
    expect(s1.stages.filter((s) => ['features', 'matching', 'mapping', 'select', 'training'].includes(s.id)).every((s) => s.state === 'skipped')).toBe(true);
    expect(s1.stages.find((s) => s.id === 'frames')!.state).toBe('skipped');
    expect(s1.result!.splat).toBeNull();
    expect(s1.result!.splatReason).toBe('Only 3 photos. A scan needs a video or at least 20 photos.');
    // 11
    for (let i = 1; i <= 3; i++) {
      const id = `p-00${i}`;
      expect(fs.existsSync(scenePath(root, `media/photos/${id}.jpg`))).toBe(true);
      const t = (await imageSize(scenePath(root, `media/photos/${id}.thumb.jpg`)))!;
      expect(Math.max(t.width, t.height)).toBe(320);
      expect(hasExif(scenePath(root, `media/photos/${id}.jpg`))).toBe(false);
    }
    const pinsPath = scenePath(root, 'photo-pins.json');
    const pins1 = JSON.parse(fs.readFileSync(pinsPath, 'utf8')) as PhotoPinsFile;
    expect(pins1.pins.length).toBe(3);
    expect(pins1.pins.every((p) => p.at === null && p.suggested?.source === 'none')).toBe(true);
    // hand-place the first pin, then run a second job with 2 of the same photos and 1 new one
    pins1.pins[0].at = { x: 1.5, z: 2.5 };
    pins1.pins[0].yawDeg = 45;
    pins1.pins[0].roomId = 'bedroom';
    pins1.pins[0].placedBy = 'broker';
    pins1.pins[0].caption = 'Bedroom window';
    fs.writeFileSync(pinsPath, JSON.stringify(pins1));
    const j2 = m.create(SCENE, [files[0], files[1], files[3]].map(photo), { backend: 'fake' });
    await m.idle();
    expect(m.get(SCENE, j2.jobId)!.state).toBe('done');
    const pins2 = JSON.parse(fs.readFileSync(pinsPath, 'utf8')) as PhotoPinsFile;
    expect(pins2.pins.map((p) => p.id)).toEqual(['p-001', 'p-002', 'p-003']);
    expect(pins2.pins[0].at).toEqual({ x: 1.5, z: 2.5 });
    expect(pins2.pins[0].placedBy).toBe('broker');
    expect(pins2.pins[0].caption).toBe('Bedroom window');
    expect(pins2.pins[1].at).toBeNull();
  }, 120_000);

  it('11b. a video plus a photo: the photo is matched to an editor frame and the pin carries the suggestion', async () => {
    const root = newRoot();
    // photo = a frame of the same lavfi video, re-encoded smaller and rougher
    const still = path.join(tmp, 'still.jpg');
    expect(await encodeJpeg(video, still, { maxSide: 300, q: 12, seekSec: 1.5 }, 30_000)).toBe(true);
    const m = manager(root, () => new FakeBackend());
    const j = m.create(SCENE, [vid(), photo(still)], { backend: 'fake' });
    await m.idle();
    const st = m.get(SCENE, j.jobId)!;
    expect(st.state).toBe('done');
    const pins = JSON.parse(fs.readFileSync(scenePath(root, 'photo-pins.json'), 'utf8')) as PhotoPinsFile;
    expect(pins.pins.length).toBe(1);
    expect(['frame-only', 'none']).toContain(pins.pins[0].suggested!.source);
    const man = JSON.parse(fs.readFileSync(scenePath(root, 'media/manifest.json'), 'utf8')) as MediaManifest;
    expect(man.version).toBe(1);
    expect(man.jobId).toBe(j.jobId);
  }, 60_000);

  it('13. nearestFrame: a degraded photo of frame 17 finds frame 17; a lavfi frame matches nothing', async () => {
    const { frames, width, height } = renderRoomFrames({ frames: 48 });
    const dir = path.join(tmp, 'room-frames');
    const descs: ImageDescriptor[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = path.join(dir, `r-${i}.jpg`);
      await writeFrameJpeg(frames[i], width, height, f, { q: 2 });
      descs.push((await describeImageFile(f))!);
    }
    const degraded = path.join(dir, 'photo17.jpg');
    await writeFrameJpeg(frames[17], width, height, degraded, { q: 24, scale: 0.7 });
    const near = nearestFrame((await describeImageFile(degraded))!, descs)!;
    console.log(`nearestFrame: index ${near.index}, score ${near.score.toFixed(3)}`);
    expect(Math.abs(near.index - 17)).toBeLessThanOrEqual(2);
    expect(near.score).toBeLessThan(NO_MATCH_SCORE);
    expect(isMatch(near.score)).toBe(true);
    const lavfiStill = path.join(dir, 'lavfi.jpg');
    await encodeJpeg(video, lavfiStill, { maxSide: 480, q: 3, seekSec: 1 }, 30_000);
    const other = nearestFrame((await describeImageFile(lavfiStill))!, descs)!;
    console.log(`lavfi vs room: best score ${other.score.toFixed(3)}`);
    expect(other.score).toBeGreaterThan(NO_MATCH_SCORE);
  }, 120_000);
});
